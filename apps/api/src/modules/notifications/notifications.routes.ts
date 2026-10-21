import { Router } from 'express';
import { z } from 'zod';
import { deviceTokenSchema, paginationSchema } from '@kkdm/shared';
import { DeviceToken, Notification } from './notification.models';
import { toNotificationDto } from './notify';
import { authenticate, requireAuth } from '../../middleware/auth';
import { isExpoPushToken, pushEnabled } from '../../services/push';
import { parse, paramId } from '../../utils/validate';
import { badRequest, ok, pageMeta, paginated, skipFor } from '../../utils/http';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get('/', async (req, res) => {
  const a = requireAuth(req);
  const q = parse(paginationSchema.extend({ unreadOnly: z.coerce.boolean().optional() }), req.query);
  const filter: Record<string, unknown> = { userId: a.userId };
  if (q.unreadOnly) filter.readAt = null;
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId: a.userId, readAt: null }),
  ]);
  paginated(res, items.map(toNotificationDto), pageMeta(q.page, q.limit, total), { unread });
});

notificationsRouter.get('/unread-count', async (req, res) => {
  ok(res, { unread: await Notification.countDocuments({ userId: requireAuth(req).userId, readAt: null }) });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  await Notification.updateOne({ _id: paramId(req.params.id), userId: requireAuth(req).userId, readAt: null }, { $set: { readAt: new Date() } });
  ok(res, { read: true });
});

notificationsRouter.post('/read-all', async (req, res) => {
  const r = await Notification.updateMany({ userId: requireAuth(req).userId, readAt: null }, { $set: { readAt: new Date() } });
  ok(res, { updated: r.modifiedCount });
});

/** Registers (or refreshes) an Expo push token for the current device/session. */
notificationsRouter.post('/devices', async (req, res) => {
  const a = requireAuth(req);
  const input = parse(deviceTokenSchema, req.body);
  if (!isExpoPushToken(input.token)) throw badRequest('Invalid Expo push token', 'INVALID_PUSH_TOKEN');
  await DeviceToken.updateOne(
    { token: input.token },
    { $set: { userId: a.userId, platform: input.platform, deviceName: input.deviceName, sessionId: a.sessionId, active: true, lastSeenAt: new Date(), failureCount: 0 } },
    { upsert: true },
  );
  ok(res, { registered: true, pushEnabled: pushEnabled() });
});

notificationsRouter.delete('/devices', async (req, res) => {
  const a = requireAuth(req);
  const { token } = parse(z.object({ token: z.string().min(10).max(300) }), req.body);
  await DeviceToken.updateOne({ token, userId: a.userId }, { $set: { active: false } });
  ok(res, { unregistered: true });
});
