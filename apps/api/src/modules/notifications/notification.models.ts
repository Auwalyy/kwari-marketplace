import { Schema, model, type InferSchemaType } from 'mongoose';
import { NOTIFICATION_TYPES } from '@kkdm/shared';

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: Map, of: String, default: {} },
    /** Prevents duplicates from repeated webhooks / job retries. */
    dedupeKey: { type: String, default: null },
    readAt: { type: Date, default: null },
    push: {
      status: { type: String, enum: ['skipped', 'queued', 'sent', 'failed'], default: 'skipped' },
      ticketIds: [String],
      error: String,
    },
  },
  { timestamps: true },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });
export type NotificationAttrs = InferSchemaType<typeof notificationSchema>;
export const Notification = model('Notification', notificationSchema);

const deviceTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['ios', 'android', 'web'], required: true },
    deviceName: String,
    sessionId: { type: Schema.Types.ObjectId, ref: 'UserSession', default: null },
    active: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: Date.now },
    failureCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
deviceTokenSchema.index({ userId: 1, active: 1 });
export const DeviceToken = model('DeviceToken', deviceTokenSchema);
