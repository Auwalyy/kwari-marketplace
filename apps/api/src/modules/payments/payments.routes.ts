import { Router } from 'express';
import { paymentInitSchema } from '@kkdm/shared';
import { Payment, PaymentEvent } from './payment.models';
import { paymentProvider, PaymentProviderError } from './providers';
import { applyVerification, markRefundCompleted, toPaymentDto } from './payment.service';
import { Order } from '../orders/order.models';
import { User } from '../users/user.model';
import { authenticate, requireAuth } from '../../middleware/auth';
import { paymentLimiter } from '../../middleware/rateLimit';
import { hasShopPermission, isAdmin } from '../../services/access';
import { audit } from '../../services/audit';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { randomCode, sha256 } from '../../utils/crypto';
import { AppError, badRequest, conflict, forbidden, notFound, ok, serviceUnavailable } from '../../utils/http';
import { parse, paramId } from '../../utils/validate';

export const paymentsRouter = Router();

paymentsRouter.get('/config', (_req, res) => {
  const p = paymentProvider();
  ok(res, {
    onlineAvailable: !!p,
    provider: p?.name ?? null,
    message: p ? null : 'Online payment is not available yet. Pay with cash on pickup or arrange a bank transfer with the seller.',
  });
});

const PAYABLE_STATUSES = ['accepted', 'processing', 'ready', 'dispatched', 'delivered'];

/**
 * Starts a gateway payment for an accepted order. The amount always comes from the stored order total.
 * Repeating the call with the same idempotency key returns the same payment.
 */
paymentsRouter.post('/initialize', authenticate, paymentLimiter, async (req, res) => {
  const a = requireAuth(req);
  const provider = paymentProvider();
  if (!provider) throw new AppError(503, 'ONLINE_PAYMENT_UNAVAILABLE', 'Online payment is not available yet. Use cash on pickup or bank transfer.');
  const input = parse(paymentInitSchema, req.body);
  const order = await Order.findOne({ _id: input.orderId, customerId: a.userId });
  if (!order) throw notFound('Order');
  if (order.paymentMethod !== 'online') throw badRequest('This order is not set up for online payment', 'NOT_ONLINE_PAYMENT');
  if (!PAYABLE_STATUSES.includes(order.status)) throw conflict('You can pay once the seller has accepted the order', 'ORDER_NOT_PAYABLE');
  if (order.paymentStatus === 'paid') throw conflict('This order is already paid', 'ALREADY_PAID');

  const existing = await Payment.findOne({ orderId: order._id, idempotencyKey: input.idempotencyKey });
  if (existing) {
    ok(res, toPaymentDto(existing));
    return;
  }
  const user = await User.findById(a.userId).select('email').lean();
  if (!user?.email) throw badRequest('Add an email address to your profile to pay online (the payment provider requires it).', 'EMAIL_REQUIRED');

  // Supersede earlier unfinished attempts so only one pending payment exists per order.
  await Payment.updateMany({ orderId: order._id, status: 'pending' }, { $set: { status: 'cancelled' }, $push: { history: { status: 'cancelled', source: 'superseded' } } });
  const reference = `KKP-${order.reference}-${randomCode(6)}`;
  const payment = await Payment.create({
    orderId: order._id,
    customerId: a.userId,
    shopId: order.shopId,
    method: 'online',
    provider: provider.name,
    reference,
    idempotencyKey: input.idempotencyKey,
    amountKobo: order.totalKobo,
    status: 'pending',
    history: [{ status: 'pending', source: 'initialize' }],
  });
  try {
    const init = await provider.initialize({
      reference,
      amountKobo: order.totalKobo,
      email: user.email,
      callbackUrl: env.PAYMENT_CALLBACK_URL,
      metadata: { orderId: String(order._id), orderReference: order.reference },
    });
    payment.authorizationUrl = init.authorizationUrl;
    payment.accessCode = init.accessCode;
    await payment.save();
  } catch (err) {
    payment.status = 'failed';
    payment.failureReason = (err as Error).message.slice(0, 200);
    await payment.save();
    logger.warn({ reference, err: (err as Error).message }, 'Payment initialisation failed');
    throw serviceUnavailable('We could not start the payment. Please try again shortly.', 'PAYMENT_INIT_FAILED');
  }
  await Order.updateOne({ _id: order._id }, { $set: { paymentStatus: 'pending' } });
  await audit({ req, action: 'payment.initialized', category: 'payment', targetType: 'payment', targetId: payment._id, shopId: order.shopId, metadata: { amountKobo: order.totalKobo, provider: provider.name } });
  ok(res, toPaymentDto(payment), 201);
});

/** Called by the app after returning from the payment page; asks the provider for the real status. */
paymentsRouter.post('/:reference/verify', authenticate, paymentLimiter, async (req, res) => {
  const a = requireAuth(req);
  const provider = paymentProvider();
  if (!provider) throw new AppError(503, 'ONLINE_PAYMENT_UNAVAILABLE', 'Online payment is not available.');
  const payment = await Payment.findOne({ reference: String(req.params.reference).slice(0, 80), customerId: a.userId });
  if (!payment) throw notFound('Payment');
  if (payment.status !== 'pending') {
    ok(res, toPaymentDto(payment));
    return;
  }
  try {
    const result = await provider.verify(payment.reference);
    ok(res, toPaymentDto(await applyVerification(payment, result, 'verify')));
  } catch (err) {
    if (err instanceof PaymentProviderError) throw serviceUnavailable('Could not confirm the payment status yet. We will keep checking automatically.', 'PAYMENT_VERIFY_FAILED');
    throw err;
  }
});

paymentsRouter.get('/order/:orderId', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const order = await Order.findById(paramId(req.params.orderId, 'orderId')).lean();
  if (!order) throw notFound('Order');
  const allowed = String(order.customerId) === a.userId || isAdmin(a) || (await hasShopPermission(a, String(order.shopId), 'orders.manage'));
  if (!allowed) throw forbidden();
  const payments = await Payment.find({ orderId: order._id }).sort({ createdAt: -1 }).limit(20).lean();
  ok(
    res,
    payments.map((p) => ({ ...toPaymentDto(p), method: p.method, confirmedBySeller: p.status === 'seller_confirmed', note: p.confirmationNote })),
  );
});

/* Webhooks (raw body; mounted before the JSON parser) ----------------------------------------- */

export const paymentWebhookRouter = Router();

paymentWebhookRouter.post('/:provider', async (req, res) => {
  const provider = paymentProvider();
  const raw = req.body as Buffer;
  if (!provider || provider.name !== req.params.provider) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Unknown payment provider' } });
    return;
  }
  if (!Buffer.isBuffer(raw) || !provider.verifyWebhookSignature(raw, req.headers)) {
    await audit({ req, action: 'payment.webhook_rejected', category: 'payment', outcome: 'failure', reason: 'bad_signature' });
    res.status(401).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } });
    return;
  }
  let body: any;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    res.status(400).json({ success: false, error: { code: 'INVALID_JSON', message: 'Malformed body' } });
    return;
  }
  const event = provider.parseWebhook(body);
  try {
    await PaymentEvent.create({ provider: provider.name, eventKey: event.eventKey, type: event.type, reference: event.reference, payloadSha256: sha256(raw) });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    throw err;
  }

  let outcome: 'applied' | 'ignored' | 'failed' = 'ignored';
  try {
    if (event.kind === 'charge' && event.reference) {
      const payment = await Payment.findOne({ reference: event.reference, provider: provider.name });
      if (payment) {
        // Defence in depth: even a signed webhook is confirmed against the verification API.
        await applyVerification(payment, await provider.verify(event.reference), 'webhook');
        outcome = 'applied';
      }
    } else if (event.kind === 'refund' && event.reference && /processed|completed/i.test(event.type + JSON.stringify(body?.data?.status ?? ''))) {
      const payment = await Payment.findOne({ reference: event.reference, provider: provider.name });
      if (payment) {
        await markRefundCompleted(payment.orderId, `${provider.name} webhook`);
        outcome = 'applied';
      }
    }
  } catch (err) {
    outcome = 'failed';
    logger.error({ err: (err as Error).message, type: event.type }, 'Webhook processing failed');
    // Allow the provider to retry: remove the idempotency record.
    await PaymentEvent.deleteOne({ provider: provider.name, eventKey: event.eventKey });
    res.status(500).json({ success: false, error: { code: 'WEBHOOK_FAILED', message: 'Processing failed' } });
    return;
  }
  await PaymentEvent.updateOne({ provider: provider.name, eventKey: event.eventKey }, { $set: { outcome } });
  res.status(200).json({ received: true });
});
