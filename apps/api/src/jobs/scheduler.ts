import { enqueueJob, registerJobHandler } from './queue';
import { Order, Quotation } from '../modules/orders/order.models';
import { transitionOrder } from '../modules/orders/order.service';
import { PlatformSetting } from '../modules/admin/admin.models';
import { logger } from '../config/logger';

/**
 * Periodic maintenance, executed through the durable job queue so only one instance runs each sweep
 * per window (dedupeKey) even with several API replicas.
 */

registerJobHandler('orders.autocomplete', async () => {
  const setting = await PlatformSetting.findOne({ key: 'orders.autoCompleteDays' }).lean();
  const days = typeof setting?.value === 'number' ? setting.value : 7;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const due = await Order.find({ status: 'delivered', deliveredAt: { $lt: cutoff } }).limit(200);
  for (const o of due) {
    try {
      await transitionOrder(o, 'completed', 'system', null, { trackingNote: `Automatically completed ${days} days after delivery` });
    } catch (err) {
      logger.warn({ orderId: String(o._id), err: (err as Error).message }, 'Auto-complete failed');
    }
  }
});

registerJobHandler('quotations.expire', async () => {
  const now = new Date();
  await Quotation.updateMany(
    { status: 'offered', expiresAt: { $lt: now } },
    { $set: { status: 'expired' }, $push: { history: { status: 'expired', by: 'system', at: now } } },
  );
});

const SWEEPS: { type: string; everyMs: number }[] = [
  { type: 'orders.autocomplete', everyMs: 60 * 60_000 },
  { type: 'quotations.expire', everyMs: 10 * 60_000 },
  { type: 'payments.reconcile', everyMs: 10 * 60_000 },
];

let timers: NodeJS.Timeout[] = [];

export function startScheduler() {
  for (const s of SWEEPS) {
    const tick = () => enqueueJob(s.type, {}, { dedupeKey: `sweep:${s.type}:${Math.floor(Date.now() / s.everyMs)}`, maxAttempts: 1 }).catch(() => undefined);
    void tick();
    timers.push(setInterval(tick, s.everyMs));
  }
}

export function stopScheduler() {
  timers.forEach(clearInterval);
  timers = [];
}
