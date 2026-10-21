import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { ORDER_STATUSES, orderTransitionSchema, paginationSchema, type OrderStatus } from '@kkdm/shared';
import { Order } from './order.models';
import { broadcastOrderUpdate, toOrderDtos, transitionOrder } from './order.service';
import { Delivery } from '../deliveries/delivery.model';
import { Payment } from '../payments/payment.models';
import { notify } from '../notifications/notify';
import { authenticate, requireAuth } from '../../middleware/auth';
import { writeLimiter } from '../../middleware/rateLimit';
import { requireShopAccess } from '../../services/access';
import { audit } from '../../services/audit';
import { parentId, parse, paramId } from '../../utils/validate';
import { badRequest, conflict, notFound, ok, pageMeta, paginated, skipFor } from '../../utils/http';

const statusEnum = z.enum(ORDER_STATUSES);
const listQuery = paginationSchema.extend({
  status: z.union([statusEnum, z.enum(['active', 'closed'])]).optional(),
});

const ACTIVE: OrderStatus[] = ['pending_acceptance', 'accepted', 'processing', 'ready', 'dispatched', 'delivered', 'disputed', 'refund_pending'];

function statusFilter(s?: string) {
  if (!s) return {};
  if (s === 'active') return { status: { $in: ACTIVE } };
  if (s === 'closed') return { status: { $nin: ACTIVE } };
  return { status: s };
}

/* Customer (mounted at /orders) ---------------------------------------------------------------- */

export const ordersRouter = Router();
ordersRouter.use(authenticate);

ordersRouter.get('/', async (req, res) => {
  const a = requireAuth(req);
  const q = parse(listQuery, req.query);
  const filter = { customerId: a.userId, ...statusFilter(q.status) };
  const [items, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    Order.countDocuments(filter),
  ]);
  paginated(res, await toOrderDtos(items, 'customer'), pageMeta(q.page, q.limit, total));
});

ordersRouter.get('/:id', async (req, res) => {
  const a = requireAuth(req);
  const o = await Order.findOne({ _id: paramId(req.params.id), customerId: a.userId }).lean();
  if (!o) throw notFound('Order');
  ok(res, (await toOrderDtos([o], 'customer'))[0]);
});

ordersRouter.post('/:id/transition', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(orderTransitionSchema, req.body);
  const to = parse(statusEnum, input.status);
  const o = await Order.findOne({ _id: paramId(req.params.id), customerId: a.userId });
  if (!o) throw notFound('Order');
  const updated = await transitionOrder(o, to, 'customer', a.userId, { reason: input.reason }, req);
  ok(res, (await toOrderDtos([updated!.toObject()], 'customer'))[0]);
});

/* Seller (mounted at /shops/:shopId/orders) ---------------------------------------------------- */

export const shopOrdersRouter = Router({ mergeParams: true });
shopOrdersRouter.use(authenticate);

shopOrdersRouter.get('/', async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'orders.manage', { allowSuspended: true });
  const q = parse(listQuery, req.query);
  const filter = { shopId: shop._id, ...statusFilter(q.status) };
  const [items, total, counts] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    Order.countDocuments(filter),
    Order.aggregate([{ $match: { shopId: shop._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  paginated(res, await toOrderDtos(items, 'seller'), pageMeta(q.page, q.limit, total), {
    statusCounts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
  });
});

shopOrdersRouter.get('/:id', async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'orders.manage', { allowSuspended: true });
  const o = await Order.findOne({ _id: paramId(req.params.id), shopId: shop._id }).lean();
  if (!o) throw notFound('Order');
  ok(res, (await toOrderDtos([o], 'seller'))[0]);
});

shopOrdersRouter.post('/:id/transition', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'orders.manage');
  const input = parse(orderTransitionSchema, req.body);
  const to = parse(statusEnum, input.status);
  const o = await Order.findOne({ _id: paramId(req.params.id), shopId: shop._id });
  if (!o) throw notFound('Order');
  const updated = await transitionOrder(o, to, 'seller', a.userId, input, req);
  ok(res, (await toOrderDtos([updated!.toObject()], 'seller'))[0]);
});

/** Seller updates delivery details (fee quote before payment, ETA window, external provider, notes). */
shopOrdersRouter.patch('/:id/delivery', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'orders.manage');
  const input = parse(
    z.object({
      feeKobo: z.number().int().min(0).max(10_000_000_00).optional(),
      estimatedDelivery: z.string().trim().max(120).optional(),
      provider: z.string().trim().max(60).optional(),
      providerReference: z.string().trim().max(80).optional(),
      note: z.string().trim().max(300).optional(),
    }),
    req.body,
  );
  const o = await Order.findOne({ _id: paramId(req.params.id), shopId: shop._id });
  if (!o) throw notFound('Order');
  if (o.fulfilmentMethod !== 'delivery') throw badRequest('This is a pickup order', 'NOT_DELIVERY');
  const d = await Delivery.findOne({ orderId: o._id });
  if (!d) throw notFound('Delivery');
  if (input.feeKobo != null) {
    if (['dispatched', 'delivered', 'completed', 'cancelled', 'rejected'].includes(o.status)) throw conflict('The delivery fee can no longer be changed', 'FEE_LOCKED');
    if (['paid', 'pending', 'seller_confirmed'].includes(o.paymentStatus)) throw conflict('The fee cannot change after payment has started', 'FEE_LOCKED');
    await Order.updateOne({ _id: o._id }, { $set: { deliveryFeeKobo: input.feeKobo, totalKobo: o.subtotalKobo + input.feeKobo } });
    d.feeKobo = input.feeKobo;
    if (d.status === 'awaiting_quote') d.status = 'quoted';
  }
  if (input.estimatedDelivery !== undefined) d.estimatedDelivery = input.estimatedDelivery;
  if (input.provider !== undefined) d.provider = input.provider || 'self';
  if (input.providerReference !== undefined) d.providerReference = input.providerReference;
  d.history.push({ status: d.status, note: input.note ?? 'Delivery details updated', actorId: a.userId, at: new Date() } as any);
  await d.save();
  await audit({ req, action: 'delivery.updated', category: 'order', targetType: 'order', targetId: o._id, shopId: shop._id, metadata: { fields: Object.keys(input) } });
  await notify([o.customerId], {
    type: 'order.updated',
    title: `Order ${o.reference}`,
    body: input.feeKobo != null ? 'The seller quoted a delivery fee for your order.' : 'Delivery details for your order were updated.',
    data: { orderId: String(o._id) },
  });
  await broadcastOrderUpdate(o._id);
  ok(res, (await toOrderDtos([(await Order.findById(o._id).lean())!], 'seller'))[0]);
});

/**
 * Seller confirms receipt of a cash or bank-transfer payment. Recorded as `seller_confirmed`, which is
 * deliberately distinct from gateway-verified `paid`.
 */
shopOrdersRouter.post('/:id/confirm-payment', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'orders.manage');
  const { note } = parse(z.object({ note: z.string().trim().max(300).optional() }), req.body);
  const o = await Order.findOne({ _id: paramId(req.params.id), shopId: shop._id });
  if (!o) throw notFound('Order');
  if (o.paymentMethod === 'online') throw badRequest('Online payments are confirmed by the payment provider, not manually', 'GATEWAY_PAYMENT');
  if (['cancelled', 'rejected'].includes(o.status)) throw conflict('This order is closed');
  if (o.paymentStatus === 'seller_confirmed') throw conflict('Payment already confirmed');
  await Payment.create({
    orderId: o._id,
    customerId: o.customerId,
    shopId: shop._id,
    method: o.paymentMethod,
    provider: 'manual',
    reference: `MAN-${crypto.randomUUID()}`,
    idempotencyKey: `seller-confirm:${o._id}`,
    amountKobo: o.totalKobo,
    status: 'seller_confirmed',
    verified: false,
    confirmedBy: a.userId,
    confirmationNote: note,
    history: [{ status: 'seller_confirmed', source: 'seller', note }],
  });
  await Order.updateOne({ _id: o._id }, { $set: { paymentStatus: 'seller_confirmed' } });
  await audit({ req, action: 'payment.seller_confirmed', category: 'payment', targetType: 'order', targetId: o._id, shopId: shop._id, metadata: { method: o.paymentMethod, amountKobo: o.totalKobo } });
  await notify([o.customerId], {
    type: 'payment.updated',
    title: 'Payment confirmed by seller',
    body: `${shop.name} confirmed receiving payment for order ${o.reference}.`,
    data: { orderId: String(o._id) },
    dedupeKey: `payment-confirmed:${o._id}`,
  });
  await broadcastOrderUpdate(o._id);
  ok(res, (await toOrderDtos([(await Order.findById(o._id).lean())!], 'seller'))[0]);
});
