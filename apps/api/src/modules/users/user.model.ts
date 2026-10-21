import { Schema, model, type HydratedDocument, type InferSchemaType, Types } from 'mongoose';
import { ACCOUNT_STATUSES, PLATFORM_ROLES } from '@kkdm/shared';

const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },
    avatarUrl: { type: String, default: null },
    platformRoles: { type: [String], enum: PLATFORM_ROLES, default: [] },
    /** Scope for market managers. A manager only acts on these markets / sections. */
    managedMarketIds: { type: [Schema.Types.ObjectId], ref: 'Market', default: [] },
    managedSectionIds: { type: [Schema.Types.ObjectId], ref: 'MarketSection', default: [] },
    status: { type: String, enum: ACCOUNT_STATUSES, default: 'active', index: true },
    suspendedReason: { type: String },
    suspendedAt: { type: Date },
    deletedAt: { type: Date },
    deletionReason: { type: String },
    /** Incremented to invalidate every outstanding access token for the user immediately. */
    tokenVersion: { type: Number, default: 0 },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date },
    notificationPreferences: {
      push: { type: Boolean, default: true },
      groups: { type: Map, of: Boolean, default: {} },
    },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
userSchema.index({ platformRoles: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ fullName: 'text', email: 'text', phone: 'text' });

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);

const addressSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label: { type: String, required: true },
    recipientName: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    landmark: String,
    location: { lat: Number, lng: Number },
    isDefault: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
export type AddressDoc = HydratedDocument<InferSchemaType<typeof addressSchema>>;
export const Address = model('Address', addressSchema);

export function toObjectId(id: string | Types.ObjectId): Types.ObjectId {
  return typeof id === 'string' ? new Types.ObjectId(id) : id;
}
