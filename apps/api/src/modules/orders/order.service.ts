import type { Request } from 'express';
import { Types, type ClientSession } from 'mongoose';
import {
  ORDER_STATUS_LABELS,
  ORDER_STOCK_HOLDING_STATUSES,
  ORDER_TRANSITIONS,
  SOCKET_EVENTS,
  type OrderActor,
  type OrderDto,
  type OrderStatus,
} from '@kkdm/shared';
import { Order, type OrderDoc } from './order.models';
import { Delivery } from '../deliveries/delivery.model';
import { InventoryMovement, Product } from '../products/product.models';
import { applyStockDerivations } from '../products/product.service';
import { syncProductEmbeddingFilters } from '../visual-search/embedding.service';
import { Shop } from '../shops/shop.models';
import { toShopSummaries } from '../shops/shop.service';
import { User } from '../users/user.model';
import { Review } from '../reviews/review.model';
import { Refund, Payment } from '../payments/payment.models';
import { notify, notifyShopStaff } from '../notifications/notify';
import { emitToShopStaff, emitToUser } from '../../services/realtime';
import { audit } from '../../services/audit';
import { withTransaction } from '../../config/db';
import { randomCode } from '../../utils/crypto';
import { badRequest, conflict, forbidden, iso } from '../../utils/http';

export function newOrderReference(prefix = 'KK') {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${prefix}-${ymd}-${randomCode(6)}`;
}

interface StockLine {
  productId: Types.ObjectId;
  variantId?: Types.ObjectId | null;
  quantity: number;
  trackInventory?: boolean;
  productName?: string;
}

/**
 * Reserves stock with guarded atomic decrements. If any line fails, already-reserved lines are released
 * (or rolled back by the surrounding transaction) and an INSUFFICIENT_STOCK error is raised. Overselling
 * is impossible because each decrement only matches when enough stock remains.
 */
export async function reserveStock(lines: StockLine[], session?: ClientSession): Promise<void> {
  const done: StockLine[] = [];
  try {
    for (const line of lines) {
      if (line.trackInventory === false) continue;
      const filter: Record<string, unknown> = { _id: line.productId, stockQuantity: { $gte: line.quantity } };
      const update: Record<string, unknown> = { $inc: { stockQuantity: -line.quantity } };
      if (line.variantId) {
        filter.variants = { $elemMatch: { _id: line.variantId, stockQuantity: { $gte: line.quantity } } };
        update.$inc = { stockQuantity: -line.quantity, 'variants.$.stockQuantity': -line.quantity };
      }
      const r = await Product.updateOne(filter, update, { session });
      if (r.modifiedCount !== 1) {
        throw conflict(`Not enough stock for ${line.productName ?? 'an item'}. Please update your cart.`, 'INSUFFICIENT_STOCK');
      }
      done.push(line);
    }
  } catch (err) {
    if (!session) await releaseStock(done);
    throw err;
  }
}

export async function releaseStock(lines: StockLine[], session?: ClientSession) {
  for (const line of lines) {
    if (line.trackInventory === false) continue;
    if (line.variantId) {
      await Product.updateOne(
        { _id: line.productId, 'variants._id': line.variantId },
        { $inc: { stockQuantity: line.quantity, 'variants.$.stockQuantity': line.quantity } },
        { session },
      );
    } else {
      await Product.updateOne({ _id: line.productId }, { $inc: { stockQuantity: line.quantity } }, { session });
    }
  }
}

/** Recomputes stock status flags after quantity changes (outside the hot path). */
export async function refreshStockStatus(productIds: Types.ObjectId[]) {
  for (const id of new Set(productIds.map(String))) {
    const p = await Product.findById(id);
    if (!p) continue;
    const before = p.stockStatus;
    applyStockDerivations(p);
    if (p.stockStatus !== before) {
      await Product.updateOne({ _id: p._id }, { $set: { stockStatus: p.stockStatus } });
      await syncProductEmbeddingFilters(p._id);
      if (p.stockStatus === 'out_of_stock') {
        await notifyShopStaff(p.shopId, 'inventory.manage', {
          type: 'product.out_of_stock',
          title: 'Out of stock',
          body: `${p.name} is now out of stock.`,
          data: { shopId: String(p.shopId), productId: String(p._id) },
        });
      }
    }
  }
}

export function allowedTransitions(status: OrderStatus, actor: OrderActor): OrderStatus[] {
  return Object.entries(ORDER_TRANSITIONS[status] ?? {})
    .filter(([, actors]) => actors?.includes(actor))
    .map(([s]) => s as OrderStatus);
}

export async function toOrderDtos(orders: any[], viewer: OrderActor): Promise<OrderDto[]> {
  if (!orders.length) return [];
  const shops = await Shop.find({ _id: { $in: orders.map((o) => o.shopId) } }).lean();
  const summaries = await toShopSummaries(shops as any);
  const customers = await User.find({ _id: { $in: orders.map((o) => o.customerId) } }).select('fullName phone').lean();
  const deliveries = await Delivery.find({ orderId: { $in: orders.map((o) => o._id) } }).lean();
  const reviewed = viewer === 'customer' ? await Review.find({ orderId: { $in: orders.map((o) => o._id) }, scope: 'shop' }).select('orderId').lean() : [];

  return orders.map((o) => {
    const c = customers.find((u) => String(u._id) === String(o.customerId));
    const d = deliveries.find((x) => String(x.orderId) === String(o._id));
    const shop = summaries.find((s) => s.id === String(o.shopId))!;
    return {
      id: String(o._id),
      reference: o.reference,
      checkoutId: String(o.checkoutId),
      customer: {
        id: String(o.customerId),
        fullName: c?.fullName ?? 'Customer',
        // The customer's phone is shared with the seller only for fulfilment of an active order.
        phone: viewer === 'seller' && !['completed', 'cancelled', 'rejected', 'refunded'].includes(o.status) ? (c?.phone ?? null) : undefined,
      },
      shop,
      items: o.items.map((i: any) => ({
        id: String(i._id),
        productId: String(i.productId),
        variantId: i.variantId ? String(i.variantId) : null,
        productName: i.productName,
        variantLabel: i.variantLabel,
        thumbnailUrl: i.thumbnailUrl,
        unit: i.unit,
        quantity: i.quantity,
        unitPriceKobo: i.unitPriceKobo,
        wholesaleApplied: i.wholesaleApplied,
        lineTotalKobo: i.lineTotalKobo,
      })),
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      fulfilmentMethod: o.fulfilmentMethod,
      subtotalKobo: o.subtotalKobo,
      deliveryFeeKobo: o.deliveryFeeKobo,
      totalKobo: o.totalKobo,
      note: o.note ?? undefined,
      delivery: d
        ? {
            id: String(d._id),
            method: d.method,
            status: d.status,
            optionName: d.optionName ?? undefined,
            feeKobo: d.feeKobo ?? null,
            address: d.address?.line1
              ? {
                  id: '',
                  label: d.address.label ?? '',
                  recipientName: d.address.recipientName ?? '',
                  phone: d.address.phone ?? '',
                  line1: d.address.line1,
                  line2: d.address.line2 ?? undefined,
                  city: d.address.city ?? '',
                  state: d.address.state ?? '',
                  landmark: d.address.landmark ?? undefined,
                  location: d.address.location?.lat != null ? { lat: d.address.location.lat, lng: d.address.location.lng! } : null,
                  isDefault: false,
                }
              : null,
            pickupInstructions: d.pickupInstructions ?? undefined,
            estimatedDelivery: d.estimatedDelivery ?? undefined,
            provider: d.provider ?? undefined,
            history: (d.history ?? []).map((h: any) => ({ status: h.status, note: h.note, at: iso(h.at)! })),
          }
        : null,
      events: (o.events ?? []).map((e: any) => ({ status: e.status, actorRole: e.actorRole, note: e.note, at: iso(e.at)! })),
      quotationId: o.quotationId ? String(o.quotationId) : null,
      allowedTransitions: viewer === 'customer' || viewer === 'seller' || viewer === 'admin' ? allowedTransitions(o.status, viewer) : [],
      reviewable: viewer === 'customer' && ['completed', 'delivered'].includes(o.status) && !reviewed.some((r) => String(r.orderId) === String(o._id)),
      createdAt: iso(o.createdAt)!,
      updatedAt: iso(o.updatedAt)!,
    };
  });
}

export interface TransitionOptions {
  reason?: string;
  deliveryFeeKobo?: number;
  estimatedDelivery?: string;
  trackingNote?: string;
}

const DELIVERY_STATUS_FOR: Partial<Record<OrderStatus, (pickup: boolean) => string>> = {
  ready: (pickup) => (pickup ? 'scheduled' : 'scheduled'),
  dispatched: () => 'out_for_delivery',
  delivered: (pickup) => (pickup ? 'collected' : 'delivered'),
};

/**
 * Applies an order status change after validating it against the transition table for the actor.
 * Uses a compare-and-set on the current status so concurrent updates cannot both succeed.
 */
export async function transitionOrder(order: OrderDoc, to: OrderStatus, actor: OrderActor, actorId: string | null, opts: TransitionOptions = {}, req?: Request) {
  const from = order.status as OrderStatus;
  const allowedActors = ORDER_TRANSITIONS[from]?.[to];
  if (!allowedActors) throw badRequest(`An order that is "${ORDER_STATUS_LABELS[from]}" cannot become "${ORDER_STATUS_LABELS[to] ?? to}"`, 'INVALID_TRANSITION');
  if (!allowedActors.includes(actor)) throw forbidden(`You cannot mark this order as ${ORDER_STATUS_LABELS[to]}`, 'TRANSITION_NOT_ALLOWED');
  if ((to === 'rejected' || to === 'cancelled' || to === 'disputed') && !opts.reason) throw badRequest('Please give a reason', 'REASON_REQUIRED');
  if (to === 'dispatched' && order.fulfilmentMethod !== 'delivery') throw badRequest('Pickup orders are not dispatched; mark them as collected', 'INVALID_TRANSITION');

  const set: Record<string, unknown> = { status: to };
  const now = new Date();
  if (to === 'accepted') {
    set.acceptedAt = now;
    if (order.fulfilmentMethod === 'delivery') {
      const delivery = await Delivery.findOne({ orderId: order._id });
      if (delivery && delivery.feeKobo == null) {
        if (opts.deliveryFeeKobo == null) throw badRequest('Enter the delivery fee before accepting this order', 'DELIVERY_FEE_REQUIRED');
        set.deliveryFeeKobo = opts.deliveryFeeKobo;
        set.totalKobo = order.subtotalKobo + opts.deliveryFeeKobo;
      }
    }
  }
  if (to === 'delivered') set.deliveredAt = now;
  if (to === 'completed') set.completedAt = now;
  if (to === 'cancelled' || to === 'rejected') {
    set.cancelledAt = now;
    set.cancelReason = opts.reason;
  }

  const releasing = (to === 'cancelled' || to === 'rejected') && ORDER_STOCK_HOLDING_STATUSES.includes(from) && !order.stockReleasedAt;
  const paidOnline = order.paymentStatus === 'paid';

  const updated = await withTransaction(async (session) => {
    const doc = await Order.findOneAndUpdate(
      { _id: order._id, status: from },
      {
        $set: { ...set, ...(releasing ? { stockReleasedAt: now } : {}) },
        $push: { events: { status: to, actorId, actorRole: actor, note: opts.reason ?? opts.trackingNote, at: now } },
      },
      { new: true, session },
    );
    if (!doc) throw conflict('The order was updated by someone else. Refresh and try again.', 'ORDER_CHANGED');
    if (releasing) {
      await releaseStock(doc.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, trackInventory: i.stockTracked })), session);
      await InventoryMovement.insertMany(
        doc.items.filter((i) => i.stockTracked).map((i) => ({ productId: i.productId, variantId: i.variantId, shopId: doc.shopId, delta: i.quantity, reason: 'order_released', orderId: doc._id, actorId })),
        { session },
      );
    }
    if (to === 'completed') {
      for (const i of doc.items) await Product.updateOne({ _id: i.productId }, { $inc: { salesQuantity: i.quantity } }, { session });
    }
    return doc;
  });

  // Delivery tracking mirrors fulfilment-related order states.
  const deliveryStatus = DELIVERY_STATUS_FOR[to]?.(order.fulfilmentMethod === 'pickup');
  const deliverySet: Record<string, unknown> = {};
  if (deliveryStatus) deliverySet.status = deliveryStatus;
  if (to === 'accepted' && opts.deliveryFeeKobo != null) Object.assign(deliverySet, { feeKobo: opts.deliveryFeeKobo, status: 'quoted' });
  if (opts.estimatedDelivery) deliverySet.estimatedDelivery = opts.estimatedDelivery;
  if (Object.keys(deliverySet).length) {
    await Delivery.updateOne(
      { orderId: order._id },
      { $set: deliverySet, $push: { history: { status: (deliverySet.status as string) ?? 'updated', note: opts.trackingNote ?? opts.reason, actorId, at: now } } },
    );
  }

  if (releasing) await refreshStockStatus(updated.items.map((i) => i.productId));

  // Cancelling an order that was paid through the gateway opens a refund.
  if (to === 'cancelled' && paidOnline) {
    const payment = await Payment.findOne({ orderId: order._id, status: 'paid', verified: true });
    if (payment) {
      await Refund.create({ paymentId: payment._id, orderId: order._id, amountKobo: payment.amountKobo, status: 'pending', provider: payment.provider, reason: opts.reason, requestedBy: actorId });
      await Order.updateOne({ _id: order._id, status: 'cancelled' }, { $set: { status: 'refund_pending', paymentStatus: 'refund_pending' }, $push: { events: { status: 'refund_pending', actorRole: 'system', note: 'Refund opened for verified online payment', at: new Date() } } });
    }
  }

  await audit({ req, actorId, actorRole: actor, action: `order.${to}`, category: 'order', targetType: 'order', targetId: order._id, shopId: order.shopId, reason: opts.reason, metadata: { from } });
  await broadcastOrderUpdate(updated._id);
  return Order.findById(updated._id);
}

const CUSTOMER_MESSAGES: Partial<Record<OrderStatus, string>> = {
  accepted: 'was accepted by the seller',
  rejected: 'was declined by the seller',
  processing: 'is being prepared',
  ready: 'is ready',
  dispatched: 'has been dispatched',
  delivered: 'was marked delivered / collected',
  cancelled: 'was cancelled',
  refund_pending: 'has a refund in progress',
  refunded: 'was refunded',
  completed: 'is complete',
  disputed: 'is under dispute',
};

/** Emits real-time updates and notifications to both sides of an order. */
export async function broadcastOrderUpdate(orderId: Types.ObjectId) {
  const o = await Order.findById(orderId).lean();
  if (!o) return;
  const payload = { orderId: String(o._id), reference: o.reference, status: o.status, paymentStatus: o.paymentStatus, updatedAt: iso(o.updatedAt) };
  emitToUser(String(o.customerId), SOCKET_EVENTS.orderUpdated, payload);
  emitToShopStaff(String(o.shopId), SOCKET_EVENTS.orderUpdated, payload);
  const last = o.events[o.events.length - 1];
  if (last && last.actorRole !== 'customer' && CUSTOMER_MESSAGES[o.status as OrderStatus]) {
    await notify([o.customerId], {
      type: 'order.updated',
      title: `Order ${o.reference}`,
      body: `Your order ${CUSTOMER_MESSAGES[o.status as OrderStatus]}.${o.status === 'ready' && o.fulfilmentMethod === 'pickup' ? ' You can collect it from the shop.' : ''}`,
      data: { orderId: String(o._id) },
      dedupeKey: `order:${o._id}:${o.status}:${o.events.length}`,
    });
  }
  if (last && last.actorRole === 'customer') {
    await notifyShopStaff(o.shopId, 'orders.manage', {
      type: 'order.updated',
      title: `Order ${o.reference}`,
      body: `The customer ${o.status === 'cancelled' ? 'cancelled' : `marked the order ${ORDER_STATUS_LABELS[o.status as OrderStatus].toLowerCase()}`}.`,
      data: { orderId: String(o._id), shopId: String(o.shopId) },
      dedupeKey: `order:${o._id}:${o.status}:${o.events.length}`,
    });
  }
}

export function idOrNull(v: unknown) {
  return v ? new Types.ObjectId(String(v)) : null;
}
