import type { PaymentDto } from '@kkdm/shared';
import { formatNaira } from '@kkdm/shared';
import { Payment, Refund, type PaymentDoc } from './payment.models';
import { paymentProvider, type VerifyResult } from './providers';
import { Order } from '../orders/order.models';
import { broadcastOrderUpdate } from '../orders/order.service';
import { notify, notifyShopStaff } from '../notifications/notify';
import { audit } from '../../services/audit';
import { registerJobHandler } from '../../jobs/queue';
import { logger } from '../../config/logger';
import { iso } from '../../utils/http';

export function toPaymentDto(p: any): PaymentDto {
  return {
    id: String(p._id),
    orderId: String(p.orderId),
    provider: p.provider,
    reference: p.reference,
    amountKobo: p.amountKobo,
    status: p.status,
    verified: !!p.verified,
    authorizationUrl: p.status === 'pending' ? (p.authorizationUrl ?? null) : null,
    createdAt: iso(p.createdAt)!,
    paidAt: iso(p.paidAt),
  };
}

/**
 * Applies a result obtained directly from the provider's verification API. This is the only path that
 * can mark a payment `paid`; client claims and unsigned callbacks are never trusted. Idempotent.
 */
export async function applyVerification(payment: PaymentDoc, result: VerifyResult, source: 'webhook' | 'verify' | 'reconcile') {
  if (payment.status === 'paid' || payment.status === 'refunded' || payment.status === 'refund_pending') return payment;

  if (result.status === 'success') {
    if (result.amountKobo !== payment.amountKobo || result.currency !== 'NGN') {
      await Payment.updateOne(
        { _id: payment._id },
        { $set: { status: 'failed', failureReason: 'amount_or_currency_mismatch', providerStatus: result.rawStatus }, $push: { history: { status: 'failed', source, note: `amount mismatch: expected ${payment.amountKobo}, got ${result.amountKobo} ${result.currency}` } } },
      );
      await audit({ action: 'payment.amount_mismatch', category: 'payment', outcome: 'failure', targetType: 'payment', targetId: payment._id, shopId: payment.shopId, metadata: { expected: payment.amountKobo, received: result.amountKobo } });
      logger.error({ reference: payment.reference }, 'Payment amount mismatch — flagged for review');
      return Payment.findById(payment._id);
    }
    const r = await Payment.updateOne(
      { _id: payment._id, status: { $ne: 'paid' } },
      {
        $set: { status: 'paid', verified: true, verifiedAt: new Date(), paidAt: result.paidAt ?? new Date(), providerTransactionId: result.transactionId, providerStatus: result.rawStatus, channel: result.channel },
        $push: { history: { status: 'paid', source } },
      },
    );
    if (r.modifiedCount === 1) {
      const order = await Order.findOneAndUpdate({ _id: payment.orderId }, { $set: { paymentStatus: 'paid' } }, { new: true });
      await audit({ action: 'payment.verified', category: 'payment', targetType: 'payment', targetId: payment._id, shopId: payment.shopId, metadata: { source, amountKobo: payment.amountKobo, provider: payment.provider } });
      if (order) {
        await notify([order.customerId], { type: 'payment.updated', title: 'Payment received', body: `Your payment of ${formatNaira(payment.amountKobo)} for order ${order.reference} was verified.`, data: { orderId: String(order._id) }, dedupeKey: `payment:${payment._id}:paid` });
        await notifyShopStaff(order.shopId, 'orders.manage', { type: 'payment.updated', title: 'Payment verified', body: `Order ${order.reference} was paid online (${formatNaira(payment.amountKobo)}).`, data: { orderId: String(order._id), shopId: String(order.shopId) }, dedupeKey: `payment:${payment._id}:paid` });
        await broadcastOrderUpdate(order._id);
      }
    }
  } else if (result.status === 'failed' || result.status === 'abandoned') {
    const status = result.status === 'failed' ? 'failed' : 'cancelled';
    const r = await Payment.updateOne({ _id: payment._id, status: 'pending' }, { $set: { status, providerStatus: result.rawStatus }, $push: { history: { status, source } } });
    if (r.modifiedCount === 1) {
      await Order.updateOne({ _id: payment.orderId, paymentStatus: 'pending' }, { $set: { paymentStatus: 'failed' } });
      await audit({ action: `payment.${status}`, category: 'payment', targetType: 'payment', targetId: payment._id, shopId: payment.shopId, metadata: { source } });
      await notify([payment.customerId], { type: 'payment.updated', title: 'Payment not completed', body: 'Your online payment did not go through. You can try again from the order.', data: { orderId: String(payment.orderId) }, dedupeKey: `payment:${payment._id}:${status}` });
      await broadcastOrderUpdate(payment.orderId);
    }
  }
  return Payment.findById(payment._id);
}

/** Re-checks pending gateway payments with the provider (missed webhooks, app closed mid-payment). */
export async function reconcilePendingPayments(olderThanMs = 5 * 60_000) {
  const provider = paymentProvider();
  if (!provider) return 0;
  const pending = await Payment.find({ status: 'pending', provider: provider.name, createdAt: { $lt: new Date(Date.now() - olderThanMs), $gt: new Date(Date.now() - 7 * 86_400_000) } }).limit(50);
  for (const p of pending) {
    try {
      await applyVerification(p, await provider.verify(p.reference), 'reconcile');
    } catch (err) {
      logger.warn({ reference: p.reference, err: (err as Error).message }, 'Reconciliation check failed');
    }
  }
  return pending.length;
}

registerJobHandler('payments.reconcile', async () => {
  await reconcilePendingPayments();
});

/** Applies a provider refund event or result. */
export async function markRefundCompleted(orderId: unknown, source: string) {
  await Refund.updateMany({ orderId, status: { $in: ['pending', 'processing'] } }, { $set: { status: 'completed', completedAt: new Date() } });
  await Payment.updateMany({ orderId, status: 'paid' }, { $set: { status: 'refunded' }, $push: { history: { status: 'refunded', source } } });
  const o = await Order.findOneAndUpdate(
    { _id: orderId, status: 'refund_pending' },
    { $set: { status: 'refunded', paymentStatus: 'refunded' }, $push: { events: { status: 'refunded', actorRole: 'system', note: `Refund confirmed (${source})`, at: new Date() } } },
    { new: true },
  );
  if (o) {
    await audit({ action: 'payment.refunded', category: 'payment', targetType: 'order', targetId: o._id, shopId: o.shopId, metadata: { source } });
    await broadcastOrderUpdate(o._id);
  }
}
