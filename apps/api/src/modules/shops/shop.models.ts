import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { MEASUREMENT_UNITS, PAYMENT_METHODS, SHOP_PERMISSIONS, SHOP_STATUSES, SUBSCRIPTION_PLANS, VERIFICATION_STATUSES } from '@kkdm/shared';

const deliveryOptionSchema = new Schema({
  name: { type: String, required: true },
  description: String,
  /** null means the fee is quoted per order by the seller. */
  feeKobo: { type: Number, default: null },
  estimatedDays: String,
  areas: { type: [String], default: [] },
  active: { type: Boolean, default: true },
});

const shopSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    /** Platform-issued public code, e.g. KK-7Q4M2. */
    shopCode: { type: String, required: true, unique: true },
    shopNumber: { type: String, required: true, uppercase: true, trim: true },
    marketId: { type: Schema.Types.ObjectId, ref: 'Market', required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'MarketSection', default: null },
    houseId: { type: Schema.Types.ObjectId, ref: 'House', required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    categoryIds: { type: [Schema.Types.ObjectId], ref: 'Category', default: [] },
    description: String,
    logoUrl: { type: String, default: null },
    coverUrl: { type: String, default: null },
    logoKey: String,
    coverKey: String,
    locationDescription: String,
    contactPhone: { type: String, default: null },
    contactEmail: { type: String, default: null },
    whatsappPhone: { type: String, default: null },
    contactPreferences: {
      chat: { type: Boolean, default: true },
      phone: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
    },
    businessHours: {
      type: [{ day: Number, open: String, close: String, closed: Boolean, _id: false }],
      default: [],
    },
    status: { type: String, enum: SHOP_STATUSES, default: 'pending_membership' },
    /** True while pending or active — reserves the shop number inside its house. */
    occupiesSlot: { type: Boolean, default: true },
    verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'unverified' },
    ownershipVerificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'unverified' },
    pickupAvailable: { type: Boolean, default: true },
    pickupInstructions: String,
    deliveryAvailable: { type: Boolean, default: false },
    deliveryOptions: { type: [deliveryOptionSchema], default: [] },
    acceptedPaymentMethods: { type: [String], enum: PAYMENT_METHODS, default: ['cash_on_pickup', 'bank_transfer'] },
    bankTransferInstructions: String,
    wholesaleAvailable: { type: Boolean, default: false },
    enabledUnits: { type: [String], enum: MEASUREMENT_UNITS, default: ['yard', 'piece', 'bundle'] },
    ratingAverage: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    activeProductCount: { type: Number, default: 0 },
    subscriptionPlan: { type: String, enum: SUBSCRIPTION_PLANS, default: 'free' },
    suspendedReason: String,
    closedAt: Date,
  },
  { timestamps: true },
);
shopSchema.index({ houseId: 1, shopNumber: 1 }, { unique: true, partialFilterExpression: { occupiesSlot: true } });
shopSchema.index({ ownerId: 1 });
shopSchema.index({ marketId: 1, sectionId: 1, houseId: 1, status: 1 });
shopSchema.index({ status: 1, verificationStatus: 1, ratingAverage: -1 });
shopSchema.index({ categoryIds: 1, status: 1 });
shopSchema.index({ name: 'text', shopCode: 'text', shopNumber: 'text', description: 'text' }, { weights: { name: 10, shopCode: 8, shopNumber: 5, description: 1 } });
export type ShopAttrs = InferSchemaType<typeof shopSchema>;
export type ShopDoc = HydratedDocument<ShopAttrs>;
export const Shop = model('Shop', shopSchema);

/** Owner and worker memberships. Ownership is a membership with role=owner, kept in sync with Shop.ownerId. */
const shopMembershipSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'worker'], required: true },
    permissions: { type: [String], enum: SHOP_PERMISSIONS, default: [] },
    title: String,
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    invitationId: { type: Schema.Types.ObjectId, ref: 'ShopInvitation', default: null },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revokedAt: Date,
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revokeReason: String,
  },
  { timestamps: true },
);
shopMembershipSchema.index({ shopId: 1, userId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
shopMembershipSchema.index({ userId: 1, status: 1 });
export type ShopMembershipDoc = HydratedDocument<InferSchemaType<typeof shopMembershipSchema>>;
export const ShopMembership = model('ShopMembership', shopMembershipSchema);
