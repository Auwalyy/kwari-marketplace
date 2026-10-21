import { Types } from 'mongoose';
import { NOTIFICATION_GROUP_OF, SOCKET_EVENTS, type NotificationType, type ShopPermission } from '@kkdm/shared';
import { DeviceToken, Notification } from './notification.models';
import { User } from '../users/user.model';
import { ShopMembership } from '../shops/shop.models';
import { emitToUser } from '../../services/realtime';
import { enqueueJob, registerJobHandler } from '../../jobs/queue';
import { pushEnabled, sendExpoPush } from '../../services/push';
import { logger } from '../../config/logger';
import { iso } from '../../utils/http';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Stable key; the same key for the same user never creates a second notification or push. */
  dedupeKey?: string;
}

export function toNotificationDto(n: {
  _id: unknown;
  type: string;
  title: string;
  body: string;
  data?: Map<string, string> | Record<string, string> | null;
  readAt?: Date | null;
  createdAt?: Date;
}) {
  const data = n.data instanceof Map ? Object.fromEntries(n.data) : (n.data ?? {});
  return {
    id: String(n._id),
    type: n.type,
    title: n.title,
    body: n.body,
    data,
    read: !!n.readAt,
    createdAt: iso(n.createdAt)!,
  };
}

/**
 * Creates in-app notifications (always kept as history), emits them over Socket.IO and queues push
 * delivery for users whose preferences allow it. Safe to call repeatedly with the same dedupeKey.
 */
export async function notify(userIds: (string | Types.ObjectId)[], input: NotifyInput): Promise<void> {
  const unique = [...new Set(userIds.map(String))];
  if (!unique.length) return;
  const users = await User.find({ _id: { $in: unique }, status: 'active' }).select('notificationPreferences').lean();
  const group = NOTIFICATION_GROUP_OF[input.type];

  for (const u of users) {
    const prefs = u.notificationPreferences;
    const groups = (prefs?.groups ?? {}) as Record<string, boolean>;
    const groupEnabled = groups[group] !== false;
    const wantsPush = pushEnabled() && prefs?.push !== false && groupEnabled;
    try {
      const doc = await Notification.create({
        userId: u._id,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? {},
        dedupeKey: input.dedupeKey ?? null,
        push: { status: wantsPush ? 'queued' : 'skipped' },
      });
      emitToUser(String(u._id), SOCKET_EVENTS.notificationNew, toNotificationDto(doc.toObject()));
      if (wantsPush) await enqueueJob('push.send', { notificationId: String(doc._id) }, { dedupeKey: `push:${doc._id}`, maxAttempts: 4 });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) continue; // duplicate event — already notified
      logger.error({ err, type: input.type }, 'Failed to create notification');
    }
  }
}

/** Notifies the owner and every active worker holding `permission` in a shop. */
export async function notifyShopStaff(shopId: string | Types.ObjectId, permission: ShopPermission | 'owner', input: NotifyInput) {
  const members = await ShopMembership.find({ shopId, status: 'active' }).select('userId role permissions').lean();
  const recipients = members
    .filter((m) => m.role === 'owner' || (permission !== 'owner' && (m.permissions as string[]).includes(permission)))
    .map((m) => m.userId);
  await notify(recipients, input);
}

registerJobHandler('push.send', async (payload) => {
  const n = await Notification.findById(payload.notificationId);
  if (!n || n.push?.status === 'sent') return;
  const tokens = await DeviceToken.find({ userId: n.userId, active: true }).select('token').lean();
  if (!tokens.length) {
    await Notification.updateOne({ _id: n._id }, { $set: { 'push.status': 'skipped', 'push.error': 'no active devices' } });
    return;
  }
  const data = Object.fromEntries((n.data as Map<string, string>) ?? []);
  const tickets = await sendExpoPush(
    tokens.map((t) => ({ to: t.token, title: n.title, body: n.body, data: { ...data, notificationId: String(n._id), type: n.type } })),
  );
  const invalid = tickets.filter((t) => t.deviceNotRegistered).map((t) => t.token);
  if (invalid.length) await DeviceToken.updateMany({ token: { $in: invalid } }, { $set: { active: false } });
  const okIds = tickets.filter((t) => t.status === 'ok' && t.id).map((t) => t.id!);
  const transientFailure = tickets.some((t) => t.status === 'error' && !t.deviceNotRegistered);
  await Notification.updateOne(
    { _id: n._id },
    { $set: { 'push.status': okIds.length ? 'sent' : 'failed', 'push.ticketIds': okIds, 'push.error': transientFailure ? 'partial failure' : undefined } },
  );
  // Retry only when nothing was delivered and the failure looks transient.
  if (!okIds.length && transientFailure) throw new Error('push delivery failed');
});
