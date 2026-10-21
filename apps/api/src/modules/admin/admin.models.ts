import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Append-only audit trail for security-relevant actions: auth events, ownership and membership changes,
 * invitations, administrative actions and payment status changes. Never store secrets or message bodies.
 */
const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String },
    action: { type: String, required: true },
    category: {
      type: String,
      enum: ['auth', 'market', 'house', 'invitation', 'shop', 'product', 'order', 'payment', 'admin', 'trust', 'account'],
      required: true,
    },
    targetType: { type: String },
    targetId: { type: Schema.Types.ObjectId, default: null },
    marketId: { type: Schema.Types.ObjectId, default: null },
    houseId: { type: Schema.Types.ObjectId, default: null },
    shopId: { type: Schema.Types.ObjectId, default: null },
    outcome: { type: String, enum: ['success', 'failure'], default: 'success' },
    reason: { type: String },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String },
    requestId: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ category: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, outcome: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ houseId: 1, createdAt: -1 });
auditLogSchema.index({ shopId: 1, createdAt: -1 });
auditLogSchema.index({ targetId: 1, createdAt: -1 });
export type AuditLogAttrs = InferSchemaType<typeof auditLogSchema>;
export const AuditLog = model('AuditLog', auditLogSchema);

/** Key/value platform settings editable by administrators (e.g. invitation policy, feature flags). */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export const PlatformSetting = model('PlatformSetting', settingSchema);

const announcementSchema = new Schema(
  {
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 2000 },
    audience: { type: String, enum: ['all', 'shop_owners', 'house_heads', 'customers'], default: 'all' },
    marketId: { type: Schema.Types.ObjectId, ref: 'Market', default: null },
    publishedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
announcementSchema.index({ publishedAt: -1 });
export const Announcement = model('Announcement', announcementSchema);
