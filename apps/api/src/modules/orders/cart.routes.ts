import { Router } from 'express';
import { Types } from 'mongoose';
import { SOCKET_EVENTS, cartItemSchema, cartItemUpdateSchema, checkoutSchema, formatNaira } from '@kkdm/shared';
import { Cart, CheckoutSession, Order, Quotation } from './order.models';
import { buildCartDto, priceCartItems, type PricedLine } from './cart.service';
import { newOrderReference, refreshStockStatus, releaseStock, reserveStock, toOrderDtos } from './order.service';
import { Product, InventoryMovement } from '../products/product.models';
import { isPubliclyVisible } from '../products/product.service';
import { Shop } from '../shops/shop.models';
import { Address } from '../users/user.model';
import { Delivery } from '../deliveries/delivery.model';
import { paymentProvider } from '../payments/providers';
import { notifyShopStaff } from '../notifications/notify';
import { authenticate, requireAuth } from '../../middleware/auth';
import { writeLimiter } from '../../middleware/rateLimit';
import { emitToShopStaff } from '../../services/realtime';
import { audit } from '../../services/audit';
import { withTransaction } from '../../config/db';
import { parse, paramId } from '../../utils/validate';
import { AppError, badRequest, conflict, notFound, ok } from '../../utils/http';

export const cartRouter = Router();
cartRouter.use(authenticate);

const MAX_CART_LINES = 100;

cartRouter.get('/', async (req, res) => {
  ok(res, await buildCartDto(requireAuth(req).userId));
});

cartRouter.post('/items', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(cartItemSchema, req.body);
  const p = await Product.findById(input.productId).lean();
  if (!p || !isPubliclyVisible(p)) throw notFound('Product');
  const shop = await Shop.findById(p.shopId).select('status').lean();
  if (!shop || shop.status !== 'active') throw badRequest('This shop is not accepting orders', 'SHOP_NOT_ACTIVE');
  if (p.variants.length && !input.variantId) throw badRequest('Choose an option (colour/pattern/size) first', 'VARIANT_REQUIRED');
  const variant = input.variantId ? p.variants.find((v) => String(v._id) === input.variantId && v.active !== false) : null;
  if (input.variantId && !variant) throw badRequest('That option is not available', 'INVALID_VARIANT');

  const cart = (await Cart.findOne({ userId: a.userId })) ?? new Cart({ userId: a.userId, items: [] });
  const existing = cart.items.find((i) => String(i.productId) === input.productId && String(i.variantId ?? '') === String(input.variantId ?? '') && !i.quotationId);
  const newQty = Math.round(((existing?.quantity ?? 0) + input.quantity) * 100) / 100;
  if (newQty < (p.minOrderQuantity ?? 0)) throw badRequest(`Minimum order is ${p.minOrderQuantity} ${p.unit}`, 'BELOW_MINIMUM');
  const stock = variant ? variant.stockQuantity : p.stockQuantity;
  if (p.trackInventory !== false && stock < newQty) throw conflict(stock > 0 ? `Only ${stock} ${p.unit} available` : 'Out of stock', 'INSUFFICIENT_STOCK');
  if (existing) existing.quantity = newQty;
  else {
    if (cart.items.length >= MAX_CART_LINES) throw badRequest('Your cart is full');
    cart.items.push({ productId: p._id, variantId: variant?._id ?? null, shopId: p.shopId, quantity: newQty } as any);
  }
  await cart.save();
  ok(res, await buildCartDto(a.userId), 201);
});

cartRouter.patch('/items/:lineId', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { quantity } = parse(cartItemUpdateSchema, req.body);
  const cart = await Cart.findOne({ userId: a.userId });
  const line = cart?.items.id(paramId(req.params.lineId));
  if (!cart || !line) throw notFound('Cart item');
  if (line.quotationId) throw badRequest('Quantities from an accepted quotation cannot be changed', 'QUOTATION_LINE');
  const p = await Product.findById(line.productId).lean();
  if (p && quantity < (p.minOrderQuantity ?? 0)) throw badRequest(`Minimum order is ${p.minOrderQuantity} ${p.unit}`, 'BELOW_MINIMUM');
  line.quantity = quantity;
  await cart.save();
  ok(res, await buildCartDto(a.userId));
});

cartRouter.delete('/items/:lineId', async (req, res) => {
  const a = requireAuth(req);
  await Cart.updateOne({ userId: a.userId }, { $pull: { items: { _id: paramId(req.params.lineId) } } });
  ok(res, await buildCartDto(a.userId));
});

cartRouter.delete('/', async (req, res) => {
  const a = requireAuth(req);
  await Cart.updateOne({ userId: a.userId }, { $set: { items: [] } });
  ok(res, await buildCartDto(a.userId));
});

/* Checkout ------------------------------------------------------------------------------------ */

export const checkoutRouter = Router();
checkoutRouter.use(authenticate);

/**
 * Creates one order per seller from the selected cart groups. Prices, fees, stock and payment options are
 * all resolved on the server. The idempotency key makes retries return the original result instead of
 * creating duplicate orders.
 */
checkoutRouter.post('/', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(checkoutSchema, req.body);

  let session;
  try {
    session = await CheckoutSession.create({ userId: a.userId, idempotencyKey: input.idempotencyKey });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    const prior = await CheckoutSession.findOne({ userId: a.userId, idempotencyKey: input.idempotencyKey });
    if (prior?.status === 'completed') {
      const orders = await Order.find({ _id: { $in: prior.orderIds } }).lean();
      ok(res, { checkoutId: String(prior._id), orders: await toOrderDtos(orders, 'customer'), replayed: true });
      return;
    }
    if (prior?.status === 'processing') throw conflict('This checkout is already being processed', 'CHECKOUT_IN_PROGRESS');
    throw conflict(`This checkout attempt failed earlier: ${prior?.error ?? 'unknown error'}. Start a new checkout.`, 'CHECKOUT_FAILED');
  }

  try {
    const result = await performCheckout(a.userId, input, session._id);
    await CheckoutSession.updateOne({ _id: session._id }, { $set: { status: 'completed', orderIds: result.map((o) => o._id), totalKobo: result.reduce((s, o) => s + o.totalKobo, 0) } });
    for (const o of result) {
      await audit({ req, action: 'order.created', category: 'order', targetType: 'order', targetId: o._id, shopId: o.shopId, metadata: { totalKobo: o.totalKobo } });
      emitToShopStaff(String(o.shopId), SOCKET_EVENTS.orderUpdated, { orderId: String(o._id), reference: o.reference, status: o.status });
      await notifyShopStaff(o.shopId, 'orders.manage', {
        type: 'order.new',
        title: 'New order',
        body: `Order ${o.reference} for ${formatNaira(o.totalKobo)} is waiting for your acceptance.`,
        data: { orderId: String(o._id), shopId: String(o.shopId) },
        dedupeKey: `order-new:${o._id}`,
      });
    }
    ok(res, { checkoutId: String(session._id), orders: await toOrderDtos(result, 'customer') }, 201);
  } catch (err) {
    await CheckoutSession.updateOne({ _id: session._id }, { $set: { status: 'failed', error: (err as Error).message.slice(0, 300) } });
    throw err;
  }
});

async function performCheckout(userId: string, input: ReturnType<typeof checkoutSchema.parse>, checkoutId: Types.ObjectId) {
  const cart = await Cart.findOne({ userId });
  if (!cart || !cart.items.length) throw badRequest('Your cart is empty', 'CART_EMPTY');
  const shopIds = [...new Set(input.shops.map((s) => s.shopId))];
  if (shopIds.length !== input.shops.length) throw badRequest('Each shop can only appear once', 'DUPLICATE_SHOP');

  const needsAddress = input.shops.some((s) => s.fulfilmentMethod === 'delivery');
  const address = input.addressId ? await Address.findOne({ _id: input.addressId, userId, deletedAt: null }).lean() : null;
  if (needsAddress && !address) throw badRequest('Choose a delivery address', 'ADDRESS_REQUIRED');

  const shops = await Shop.find({ _id: { $in: shopIds } }).lean();
  const plans: { shop: (typeof shops)[number]; sel: (typeof input.shops)[number]; items: (typeof cart.items)[number][]; lines: PricedLine[]; subtotal: number; fee: number | null; option: any }[] = [];
  for (const sel of input.shops) {
    const shop = shops.find((s) => String(s._id) === sel.shopId);
    if (!shop || shop.status !== 'active') throw badRequest('One of the shops is not accepting orders', 'SHOP_NOT_ACTIVE');
    const items = cart.items.filter((i) => String(i.shopId) === sel.shopId);
    if (!items.length) throw badRequest(`Your cart has no items from ${shop.name}`, 'NO_ITEMS_FOR_SHOP');
    const lines = await priceCartItems(items as any);
    const bad = lines.find((l) => !l.available);
    if (bad) throw conflict(`${bad.productName}: ${bad.issue}`, 'CART_ITEM_UNAVAILABLE');

    if (sel.fulfilmentMethod === 'pickup' && !shop.pickupAvailable) throw badRequest(`${shop.name} does not offer pickup`, 'PICKUP_UNAVAILABLE');
    let option: any = null;
    if (sel.fulfilmentMethod === 'delivery') {
      if (!shop.deliveryAvailable) throw badRequest(`${shop.name} does not deliver`, 'DELIVERY_UNAVAILABLE');
      option = shop.deliveryOptions.find((o: any) => String(o._id) === sel.deliveryOptionId && o.active !== false);
      if (!option) throw badRequest(`Choose a delivery option for ${shop.name}`, 'DELIVERY_OPTION_REQUIRED');
    }
    if (!shop.acceptedPaymentMethods.includes(sel.paymentMethod)) throw badRequest(`${shop.name} does not accept this payment method`, 'PAYMENT_METHOD_UNAVAILABLE');
    if (sel.paymentMethod === 'cash_on_pickup' && sel.fulfilmentMethod !== 'pickup') throw badRequest('Cash on pickup is only available for pickup orders', 'PAYMENT_METHOD_UNAVAILABLE');
    if (sel.paymentMethod === 'online' && !paymentProvider()) throw new AppError(503, 'ONLINE_PAYMENT_UNAVAILABLE', 'Online payment is not available yet. Choose cash on pickup or bank transfer.');

    const subtotal = lines.reduce((s, l) => s + l.lineTotalKobo, 0);
    const fee = option ? (option.feeKobo ?? null) : 0;
    plans.push({ shop, sel, items, lines, subtotal, fee, option });
  }

  const created = await withTransaction(async (txn) => {
    const orders = [];
    const allLines = plans.flatMap((p) => p.lines);
    await reserveStock(
      allLines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity, trackInventory: l.trackInventory, productName: l.productName })),
      txn,
    );
    try {
      for (const plan of plans) {
        const quotationId = plan.lines.find((l) => l.quotationId)?.quotationId ?? null;
        const [order] = await Order.create(
          [
            {
              reference: newOrderReference(),
              checkoutId,
              customerId: userId,
              shopId: plan.shop._id,
              marketId: plan.shop.marketId,
              houseId: plan.shop.houseId,
              items: plan.lines.map((l) => ({
                productId: l.productId,
                variantId: l.variantId,
                productName: l.productName,
                variantLabel: l.variantLabel,
                thumbnailUrl: l.thumbnailUrl,
                unit: l.unit,
                quantity: l.quantity,
                unitPriceKobo: l.unitPriceKobo,
                wholesaleApplied: l.wholesaleApplied,
                lineTotalKobo: l.lineTotalKobo,
                stockTracked: l.trackInventory,
              })),
              paymentMethod: plan.sel.paymentMethod,
              paymentStatus: 'unpaid',
              fulfilmentMethod: plan.sel.fulfilmentMethod,
              subtotalKobo: plan.subtotal,
              deliveryFeeKobo: plan.fee ?? 0,
              totalKobo: plan.subtotal + (plan.fee ?? 0),
              note: plan.sel.note,
              quotationId,
              events: [{ status: 'pending_acceptance', actorId: userId, actorRole: 'customer', at: new Date() }],
            },
          ],
          { session: txn },
        );
        await Delivery.create(
          [
            {
              orderId: order._id,
              shopId: plan.shop._id,
              customerId: userId,
              method: plan.sel.fulfilmentMethod,
              status: plan.sel.fulfilmentMethod === 'pickup' ? 'not_required' : plan.fee == null ? 'awaiting_quote' : 'quoted',
              optionId: plan.option?._id ?? null,
              optionName: plan.option?.name,
              feeKobo: plan.sel.fulfilmentMethod === 'pickup' ? 0 : plan.fee,
              address: plan.sel.fulfilmentMethod === 'delivery' && address ? { ...address, _id: undefined } : undefined,
              pickupInstructions: plan.sel.fulfilmentMethod === 'pickup' ? plan.shop.pickupInstructions : undefined,
              history: [{ status: 'created', at: new Date() }],
            },
          ],
          { session: txn },
        );
        await InventoryMovement.insertMany(
          plan.lines.filter((l) => l.trackInventory).map((l) => ({ productId: l.productId, variantId: l.variantId, shopId: plan.shop._id, delta: -l.quantity, reason: 'order_reserved', orderId: order._id, actorId: userId })),
          { session: txn },
        );
        const quotationIds = [...new Set(plan.lines.map((l) => l.quotationId).filter(Boolean).map(String))];
        if (quotationIds.length) {
          await Quotation.updateMany(
            { _id: { $in: quotationIds }, status: 'accepted' },
            { $set: { status: 'converted', orderId: order._id }, $push: { history: { status: 'converted', by: 'customer', actorId: userId, at: new Date() } } },
            { session: txn },
          );
        }
        orders.push(order);
      }
      const purchasedLineIds = plans.flatMap((p) => p.items.map((i) => i._id));
      await Cart.updateOne({ _id: cart._id }, { $pull: { items: { _id: { $in: purchasedLineIds } } } }, { session: txn });
      return orders;
    } catch (err) {
      if (!txn) {
        // Without transactions, compensate: return reserved stock and remove partial orders.
        await releaseStock(allLines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity, trackInventory: l.trackInventory })));
        await Order.deleteMany({ checkoutId });
        await Delivery.deleteMany({ orderId: { $in: orders.map((o) => o._id) } });
      }
      throw err;
    }
  });

  await refreshStockStatus(plans.flatMap((p) => p.lines.map((l) => l.productId)));
  return Order.find({ _id: { $in: created.map((o) => o._id) } }).lean();
}
