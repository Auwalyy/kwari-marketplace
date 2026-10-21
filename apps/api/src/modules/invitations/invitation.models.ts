import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { SHOP_PERMISSIONS } from '@kkdm/shared';

/**
 * Invitation codes are shown to the creator exactly once. Only an HMAC of the code is stored, so a
 * database leak does not reveal redeemable codes.
 */
const redemptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop' },
    membershipId: { type: Schema.Types.ObjectId },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const commonFields = {
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  codeHash: { type: String, required: true, unique: true },
  codePreview: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  maxUses: { type: Number, required: true, min: 1 },
  usedCount: { type: Number, default: 0 },
  /** Persisted state. `expired` and `exhausted` are also derived at read time from expiresAt/usedCount. */
  status: { type: String, enum: ['active', 'revoked', 'exhausted'], default: 'active' },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  revokeReason: String,
  redemptions: { type: [redemptionSchema], default: [] },
};

const houseInvitationSchema = new Schema(
  {
    houseId: { type: Schema.Types.ObjectId, ref: 'House', required: true },
    ...commonFields,
    intendedShopName: String,
    intendedShopNumber: String,
    note: String,
    /** When created as a regeneration of an earlier invitation. */
    replacesId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);
houseInvitationSchema.index({ houseId: 1, createdAt: -1 });
export type HouseInvitationDoc = HydratedDocument<InferSchemaType<typeof houseInvitationSchema>>;
export const HouseInvitation = model('HouseInvitation', houseInvitationSchema);

const shopInvitationSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    ...commonFields,
    /** Worker invitations can only ever grant these shop-scoped permissions — never ownership. */
    permissions: { type: [String], enum: SHOP_PERMISSIONS, required: true },
    title: String,
  },
  { timestamps: true },
);
shopInvitationSchema.index({ shopId: 1, createdAt: -1 });
export type ShopInvitationDoc = HydratedDocument<InferSchemaType<typeof shopInvitationSchema>>;
export const ShopInvitation = model('ShopInvitation', shopInvitationSchema);
