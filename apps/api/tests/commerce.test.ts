import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, createActiveShop, createMarketFixture, createPublishedProduct, registerUser, useTestDatabase, type MarketFixture, type TestUser } from './helpers';
import { Product } from '../src/modules/products/product.models';
import { Order } from '../src/modules/orders/order.models';
import { Payment, PaymentEvent } from '../src/modules/payments/payment.models';
import { setPaymentProvider, type PaymentProvider, type VerifyResult } from '../src/modules/payments/providers';
import { User } from '../src/modules/users/user.model';

useTestDatabase();

/** Mock gateway: verification results are controlled by the test; webhook signature is an HMAC. */
class MockGateway implements PaymentProvider {
  name = 'paystack';
  results = new Map<string, VerifyResult>();
  secret = 'whsec_test';
  async initialize(input: { reference: string }) {
    return { authorizationUrl: `https://pay.example/${input.reference}` };
  }
  async verify(reference: string) {
    return this.results.get(reference) ?? { status: 'pending' as const, amountKobo: 0, currency: 'NGN', rawStatus: 'pending' };
  }
  verifyWebhookSignature(raw: Buffer, headers: Record<string, string | string[] | undefined>) {
    return headers['x-paystack-signature'] === crypto.createHmac('sha512', this.secret).update(raw).digest('hex');
  }
  parseWebhook(body: any) {
    return { eventKey: `${body.event}:${body.data.id}`, type: body.event, reference: body.data.reference, kind: 'charge' as const };
  }
  async refund() {
    return { refundId: 'rf_1', status: 'completed' as const };
  }
}
const gateway = new MockGateway();

let fx: MarketFixture;
let shopA: { owner: TestUser; shopId: string };
let shopB: { owner: TestUser; shopId: string };
let customer: TestUser;
let addressId: string;

beforeAll(async () => {
  setPaymentProvider(gateway);
  fx = await createMarketFixture();
  shopA = await createActiveShop(fx);
  shopB = await createActiveShop(fx);
  customer = await registerUser('Customer');
  const addr = await api().post('/api/v1/users/me/addresses').set(auth(customer)).send({ label: 'Home', recipientName: 'Customer One', phone: '08030000000', line1: '12 Zoo Road', city: 'Kano', state: 'Kano' });
  addressId = addr.body.data.id;
});
afterAll(() => setPaymentProvider(undefined));

async function shopsFor(cart: any) {
  return cart.groups.map((g: any) => g.shop.id);
}

describe('cart', () => {
  it('prices lines on the server, applies wholesale tiers and groups by seller', async () => {
    const p1 = await createPublishedProduct(shopA.owner, shopA.shopId, fx.categoryId, { name: 'Wax A', retailPriceKobo: 500000, wholesalePriceKobo: 400000, wholesaleMinQuantity: 20, stockQuantity: 100 });
    const p2 = await createPublishedProduct(shopB.owner, shopB.shopId, fx.categoryId, { name: 'Lace B', retailPriceKobo: 1250050, stockQuantity: 10, wholesalePriceKobo: null, wholesaleMinQuantity: null });
    await api().post('/api/v1/cart').set(auth(customer));
    let res = await api().post('/api/v1/cart/items').set(auth(customer)).send({ productId: p1.id, quantity: 2.5, unitPriceKobo: 1 });
    expect(res.status).toBe(201);
    const line = res.body.data.groups[0].lines[0];
    expect(line.unitPriceKobo).toBe(500000); // client-sent price ignored
    expect(line.lineTotalKobo).toBe(1250000); // 2.5 yards
    res = await api().post('/api/v1/cart/items').set(auth(customer)).send({ productId: p1.id, quantity: 17.5 });
    const merged = res.body.data.groups.find((g: any) => g.shop.id === shopA.shopId).lines[0];
    expect(merged.quantity).toBe(20);
    expect(merged.wholesaleApplied).toBe(true);
    expect(merged.lineTotalKobo).toBe(8000000);
    res = await api().post('/api/v1/cart/items').set(auth(customer)).send({ productId: p2.id, quantity: 1 });
    expect(await shopsFor(res.body.data)).toHaveLength(2);
    expect(res.body.data.subtotalKobo).toBe(8000000 + 1250050);
    const over = await api().post('/api/v1/cart/items').set(auth(customer)).send({ productId: p2.id, quantity: 50 });
    expect(over.status).toBe(409);
    await api().delete('/api/v1/cart').set(auth(customer));
  });

  it('enforces minimum order quantity', async () => {
    const p = await createPublishedProduct(shopA.owner, shopA.shopId, fx.categoryId, { name: 'Bundle only', minOrderQuantity: 5, stockQuantity: 50 });
    const res = await api().post('/api/v1/cart/items').set(auth(customer)).send({ productId: p.id, quantity: 2 });
    expect(res.body.error.code).toBe('BELOW_MINIMUM');
  });
});

describe('checkout and orders', () => {
  it('creates one order per seller, reserves stock, snapshots prices, and is idempotent', async () => {
    const pA = await createPublishedProduct(shopA.owner, shopA.shopId, fx.categoryId, { name: 'Checkout A', retailPriceKobo: 100000, stockQuantity: 10 });
    const pB = await createPublishedProduct(shopB.owner, shopB.shopId, fx.categoryId, { name: 'Checkout B', retailPriceKobo: 200000, stockQuantity: 5 });
    await api().post('/api/v1/cart/items').set(auth(customer)).send({ productId: pA.id, quantity: 3 });
    await api().post('/api/v1/cart/items').set(auth(customer)).send({ productId: pB.id, quantity: 2 });
    const cart = await api().get('/api/v1/cart').set(auth(customer));
    const kanoOption = cart.body.data.groups.find((g: any) => g.shop.id === shopB.shopId).shop.deliveryOptions.find((o: any) => o.feeKobo === 150000);
    const key = crypto.randomUUID();
    const body = {
      idempotencyKey: key,
      addressId,
      shops: [
        { shopId: shopA.shopId, fulfilmentMethod: 'pickup', paymentMethod: 'cash_on_pickup' },
        { shopId: shopB.shopId, fulfilmentMethod: 'delivery', deliveryOptionId: kanoOption.id, paymentMethod: 'bank_transfer' },
      ],
    };
    const res = await api().post('/api/v1/checkout').set(auth(customer)).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.orders).toHaveLength(2);
    const orderB = res.body.data.orders.find((o: any) => o.shop.id === shopB.shopId);
    expect(orderB.subtotalKobo).toBe(400000);
    expect(orderB.deliveryFeeKobo).toBe(150000);
    expect(orderB.totalKobo).toBe(550000);
    expect(orderB.status).toBe('pending_acceptance');
    expect((await Product.findById(pA.id).lean())!.stockQuantity).toBe(7);
    expect((await Product.findById(pB.id).lean())!.stockQuantity).toBe(3);

    // Replay returns the same orders without duplicating them.
    const replay = await api().post('/api/v1/checkout').set(auth(customer)).send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.data.replayed).toBe(true);
    expect(await Order.countDocuments({ checkoutId: res.body.data.checkoutId })).toBe(2);

    // Price changes after purchase don't rewrite history.
    await api().patch(`/api/v1/shops/${shopA.shopId}/products/${pA.id}`).set(auth(shopA.owner)).send({ retailPriceKobo: 999999 });
    const order = await api().get(`/api/v1/orders/${res.body.data.orders[0].id}`).set(auth(customer));
    expect(order.body.data.items[0].unitPriceKobo).toBe(order.body.data.shop.id === shopA.shopId ? 100000 : 200000);
    expect((await api().get('/api/v1/cart').set(auth(customer))).body.data.itemCount).toBe(0);
  });

  it('prevents overselling under concurrent checkouts', async () => {
    const p = await createPublishedProduct(shopA.owner, shopA.shopId, fx.categoryId, { name: 'Last pieces', retailPriceKobo: 1000, stockQuantity: 3 });
    const buyers = await Promise.all(Array.from({ length: 5 }, (_, i) => registerUser(`Buyer ${i}`)));
    for (const b of buyers) await api().post('/api/v1/cart/items').set(auth(b)).send({ productId: p.id, quantity: 1 });
    const results = await Promise.all(
      buyers.map((b) => api().post('/api/v1/checkout').set(auth(b)).send({ idempotencyKey: crypto.randomUUID(), shops: [{ shopId: shopA.shopId, fulfilmentMethod: 'pickup', paymentMethod: 'cash_on_pickup' }] })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    const after = await Product.findById(p.id).lean();
    expect(after!.stockQuantity).toBe(0);
    expect(after!.stockStatus).toBe('out_of_stock');
  });

  it('validates fulfilment and payment choices against the shop', async () => {
    const p = await createPublishedProduct(shopA.owner, shopA.shopId, fx.categoryId, { name: 'Choice test', stockQuantity: 5 });
    const u = await registerUser();
    await api().post('/api/v1/cart/items').set(auth(u)).send({ productId: p.id, quantity: 1 });
    const cashDelivery = await api().post('/api/v1/checkout').set(auth(u)).send({ idempotencyKey: crypto.randomUUID(), shops: [{ shopId: shopA.shopId, fulfilmentMethod: 'delivery', paymentMethod: 'cash_on_pickup' }] });
    expect(cashDelivery.status).toBe(400);
    const noAddress = await api().post('/api/v1/checkout').set(auth(u)).send({ idempotencyKey: crypto.randomUUID(), shops: [{ shopId: shopA.shopId, fulfilmentMethod: 'delivery', paymentMethod: 'bank_transfer' }] });
    expect(noAddress.body.error.code).toBe('ADDRESS_REQUIRED');
  });

  it('enforces the order state machine and restores stock on cancellation', async () => {
    const p = await createPublishedProduct(shopA.owner, shopA.shopId, fx.categoryId, { name: 'Flow test', retailPriceKobo: 5000, stockQuantity: 10 });
    await api().post('/api/v1/cart/items').set(auth(customer)).send({ productId: p.id, quantity: 4 });
    const co = await api().post('/api/v1/checkout').set(auth(customer)).send({ idempotencyKey: crypto.randomUUID(), shops: [{ shopId: shopA.shopId, fulfilmentMethod: 'pickup', paymentMethod: 'cash_on_pickup' }] });
    const orderId = co.body.data.orders[0].id;
    // Customer cannot mark delivered; seller cannot skip acceptance.
    expect((await api().post(`/api/v1/orders/${orderId}/transition`).set(auth(customer)).send({ status: 'delivered' })).status).toBe(400);
    expect((await api().post(`/api/v1/shops/${shopA.shopId}/orders/${orderId}/transition`).set(auth(shopA.owner)).send({ status: 'delivered' })).status).toBe(400);
    // Another shop cannot touch the order.
    expect((await api().post(`/api/v1/shops/${shopB.shopId}/orders/${orderId}/transition`).set(auth(shopB.owner)).send({ status: 'accepted' })).status).toBe(404);
    expect((await api().post(`/api/v1/shops/${shopA.shopId}/orders/${orderId}/transition`).set(auth(shopA.owner)).send({ status: 'accepted' })).status).toBe(200);
    const cancel = await api().post(`/api/v1/orders/${orderId}/transition`).set(auth(customer)).send({ status: 'cancelled', reason: 'Changed my mind' });
    expect(cancel.status).toBe(200);
    expect((await Product.findById(p.id).lean())!.stockQuantity).toBe(10);
    // Cancelling twice doesn't restore twice.
    expect((await api().post(`/api/v1/orders/${orderId}/transition`).set(auth(customer)).send({ status: 'cancelled', reason: 'again' })).status).toBe(400);
    expect((await Product.findById(p.id).lean())!.stockQuantity).toBe(10);
  });

  it('runs a full pickup lifecycle and only then allows a review', async () => {
    const p = await createPublishedProduct(shopA.owner, shopA.shopId, fx.categoryId, { name: 'Review me', retailPriceKobo: 5000, stockQuantity: 10 });
    await api().post('/api/v1/cart/items').set(auth(customer)).send({ productId: p.id, quantity: 1 });
    const co = await api().post('/api/v1/checkout').set(auth(customer)).send({ idempotencyKey: crypto.randomUUID(), shops: [{ shopId: shopA.shopId, fulfilmentMethod: 'pickup', paymentMethod: 'cash_on_pickup' }] });
    const orderId = co.body.data.orders[0].id;
    const early = await api().post('/api/v1/reviews').set(auth(customer)).send({ orderId, rating: 5 });
    expect(early.status).toBe(403);
    for (const status of ['accepted', 'processing', 'ready', 'delivered']) {
      const r = await api().post(`/api/v1/shops/${shopA.shopId}/orders/${orderId}/transition`).set(auth(shopA.owner)).send({ status });
      expect(r.status, status).toBe(200);
    }
    const confirm = await api().post(`/api/v1/shops/${shopA.shopId}/orders/${orderId}/confirm-payment`).set(auth(shopA.owner)).send({ note: 'Cash received' });
    expect(confirm.body.data.paymentStatus).toBe('seller_confirmed');
    const done = await api().post(`/api/v1/orders/${orderId}/transition`).set(auth(customer)).send({ status: 'completed' });
    expect(done.status).toBe(200);
    const review = await api().post('/api/v1/reviews').set(auth(customer)).send({ orderId, rating: 4, text: 'Good quality' });
    expect(review.status).toBe(201);
    expect((await api().post('/api/v1/reviews').set(auth(customer)).send({ orderId, rating: 1 })).status).toBe(409);
    const stranger = await registerUser();
    expect((await api().post('/api/v1/reviews').set(auth(stranger)).send({ orderId, rating: 1 })).status).toBe(404);
    const shop = await api().get(`/api/v1/shops/${shopA.shopId}`);
    expect(shop.body.data.ratingCount).toBe(1);
    expect(shop.body.data.ratingAverage).toBe(4);
  });

  it('requires a delivery fee quote before accepting quoted-delivery orders', async () => {
    const p = await createPublishedProduct(shopA.owner, shopA.shopId, fx.categoryId, { name: 'Far away', retailPriceKobo: 5000, stockQuantity: 10 });
    await api().post('/api/v1/cart/items').set(auth(customer)).send({ productId: p.id, quantity: 1 });
    const cart = await api().get('/api/v1/cart').set(auth(customer));
    const quoted = cart.body.data.groups[0].shop.deliveryOptions.find((o: any) => o.feeKobo === null);
    const co = await api().post('/api/v1/checkout').set(auth(customer)).send({ idempotencyKey: crypto.randomUUID(), addressId, shops: [{ shopId: shopA.shopId, fulfilmentMethod: 'delivery', deliveryOptionId: quoted.id, paymentMethod: 'bank_transfer' }] });
    const orderId = co.body.data.orders[0].id;
    expect(co.body.data.orders[0].delivery.status).toBe('awaiting_quote');
    const noFee = await api().post(`/api/v1/shops/${shopA.shopId}/orders/${orderId}/transition`).set(auth(shopA.owner)).send({ status: 'accepted' });
    expect(noFee.body.error.code).toBe('DELIVERY_FEE_REQUIRED');
    const withFee = await api().post(`/api/v1/shops/${shopA.shopId}/orders/${orderId}/transition`).set(auth(shopA.owner)).send({ status: 'accepted', deliveryFeeKobo: 300000 });
    expect(withFee.body.data.totalKobo).toBe(305000);
  });
});

describe('quotations', () => {
  it('negotiates a wholesale price and checks out at the agreed price', async () => {
    const p = await createPublishedProduct(shopA.owner, shopA.shopId, fx.categoryId, { name: 'Bulk lace', retailPriceKobo: 800000, stockQuantity: 200 });
    const req = await api().post('/api/v1/quotations').set(auth(customer)).send({ shopId: shopA.shopId, items: [{ productId: p.id, quantity: 50, targetUnitPriceKobo: 600000 }], message: 'Price for 50 yards?' });
    expect(req.status).toBe(201);
    const qid = req.body.data.id;
    const itemId = req.body.data.items[0].id;
    // Customer cannot offer; seller offers.
    expect((await api().post(`/api/v1/quotations/${qid}/offer`).set(auth(customer)).send({ items: [{ itemId, unitPriceKobo: 1 }] })).status).toBe(403);
    const offer = await api().post(`/api/v1/quotations/${qid}/offer`).set(auth(shopA.owner)).send({ items: [{ itemId, unitPriceKobo: 650000 }], validForHours: 24 });
    expect(offer.body.data.status).toBe('offered');
    expect(offer.body.data.totalOfferedKobo).toBe(650000 * 50);
    const accept = await api().post(`/api/v1/quotations/${qid}/respond`).set(auth(customer)).send({ action: 'accept' });
    expect(accept.body.data.status).toBe('accepted');
    await api().post(`/api/v1/quotations/${qid}/add-to-cart`).set(auth(customer));
    const cart = await api().get('/api/v1/cart').set(auth(customer));
    const line = cart.body.data.groups[0].lines.find((l: any) => l.quotationId === qid);
    expect(line.unitPriceKobo).toBe(650000);
    const co = await api().post('/api/v1/checkout').set(auth(customer)).send({ idempotencyKey: crypto.randomUUID(), shops: [{ shopId: shopA.shopId, fulfilmentMethod: 'pickup', paymentMethod: 'bank_transfer' }] });
    expect(co.status).toBe(201);
    expect(co.body.data.orders[0].totalKobo).toBe(650000 * 50);
    const q = await api().get(`/api/v1/quotations/${qid}`).set(auth(customer));
    expect(q.body.data.status).toBe('converted');
    // The conversation contains the quotation reference.
    const conv = await api().get(`/api/v1/conversations/${q.body.data.conversationId}/messages`).set(auth(customer));
    expect(conv.body.data.messages.some((m: any) => m.quotationRef?.id === qid)).toBe(true);
  });
});

describe('payments', () => {
  async function acceptedOnlineOrder() {
    const p = await createPublishedProduct(shopA.owner, shopA.shopId, fx.categoryId, { name: `Online ${crypto.randomUUID().slice(0, 4)}`, retailPriceKobo: 250000, stockQuantity: 10 });
    await api().post('/api/v1/cart/items').set(auth(customer)).send({ productId: p.id, quantity: 2 });
    const co = await api().post('/api/v1/checkout').set(auth(customer)).send({ idempotencyKey: crypto.randomUUID(), shops: [{ shopId: shopA.shopId, fulfilmentMethod: 'pickup', paymentMethod: 'online' }] });
    const orderId = co.body.data.orders[0].id;
    const early = await api().post('/api/v1/payments/initialize').set(auth(customer)).send({ orderId, idempotencyKey: crypto.randomUUID() });
    expect(early.body.error.code).toBe('ORDER_NOT_PAYABLE');
    await api().post(`/api/v1/shops/${shopA.shopId}/orders/${orderId}/transition`).set(auth(shopA.owner)).send({ status: 'accepted' });
    return orderId;
  }

  it('only marks paid after server-side verification of the amount', async () => {
    const orderId = await acceptedOnlineOrder();
    const key = crypto.randomUUID();
    const init = await api().post('/api/v1/payments/initialize').set(auth(customer)).send({ orderId, idempotencyKey: key });
    expect(init.status).toBe(201);
    expect(init.body.data.amountKobo).toBe(500000);
    const again = await api().post('/api/v1/payments/initialize').set(auth(customer)).send({ orderId, idempotencyKey: key });
    expect(again.body.data.reference).toBe(init.body.data.reference);
    const ref = init.body.data.reference;

    // Provider says pending -> still pending.
    let v = await api().post(`/api/v1/payments/${ref}/verify`).set(auth(customer));
    expect(v.body.data.status).toBe('pending');
    // Provider reports a smaller amount -> rejected as mismatch.
    gateway.results.set(ref, { status: 'success', amountKobo: 100, currency: 'NGN', rawStatus: 'success' });
    v = await api().post(`/api/v1/payments/${ref}/verify`).set(auth(customer));
    expect(v.body.data.status).toBe('failed');
    expect((await Order.findById(orderId).lean())!.paymentStatus).not.toBe('paid');

    const init2 = await api().post('/api/v1/payments/initialize').set(auth(customer)).send({ orderId, idempotencyKey: crypto.randomUUID() });
    gateway.results.set(init2.body.data.reference, { status: 'success', amountKobo: 500000, currency: 'NGN', rawStatus: 'success', transactionId: 't1' });
    v = await api().post(`/api/v1/payments/${init2.body.data.reference}/verify`).set(auth(customer));
    expect(v.body.data.status).toBe('paid');
    expect(v.body.data.verified).toBe(true);
    expect((await Order.findById(orderId).lean())!.paymentStatus).toBe('paid');
  });

  it('processes signed webhooks idempotently and rejects bad signatures', async () => {
    const orderId = await acceptedOnlineOrder();
    const init = await api().post('/api/v1/payments/initialize').set(auth(customer)).send({ orderId, idempotencyKey: crypto.randomUUID() });
    const ref = init.body.data.reference;
    gateway.results.set(ref, { status: 'success', amountKobo: 500000, currency: 'NGN', rawStatus: 'success' });
    const payload = JSON.stringify({ event: 'charge.success', data: { id: 99, reference: ref, status: 'success' } });
    const bad = await api().post('/api/v1/payments/webhooks/paystack').set('content-type', 'application/json').set('x-paystack-signature', 'nope').send(payload);
    expect(bad.status).toBe(401);
    expect((await Payment.findOne({ reference: ref }).lean())!.status).toBe('pending');
    const sig = crypto.createHmac('sha512', gateway.secret).update(payload).digest('hex');
    const ok1 = await api().post('/api/v1/payments/webhooks/paystack').set('content-type', 'application/json').set('x-paystack-signature', sig).send(payload);
    expect(ok1.status).toBe(200);
    const ok2 = await api().post('/api/v1/payments/webhooks/paystack').set('content-type', 'application/json').set('x-paystack-signature', sig).send(payload);
    expect(ok2.body.duplicate).toBe(true);
    expect(await PaymentEvent.countDocuments({ reference: ref })).toBe(1);
    expect((await Payment.findOne({ reference: ref }).lean())!.status).toBe('paid');
  });

  it('opens a refund when a paid order is cancelled', async () => {
    const orderId = await acceptedOnlineOrder();
    const init = await api().post('/api/v1/payments/initialize').set(auth(customer)).send({ orderId, idempotencyKey: crypto.randomUUID() });
    gateway.results.set(init.body.data.reference, { status: 'success', amountKobo: 500000, currency: 'NGN', rawStatus: 'success', transactionId: 't9' });
    await api().post(`/api/v1/payments/${init.body.data.reference}/verify`).set(auth(customer));
    await api().post(`/api/v1/shops/${shopA.shopId}/orders/${orderId}/transition`).set(auth(shopA.owner)).send({ status: 'cancelled', reason: 'Out of this colour' });
    expect((await Order.findById(orderId).lean())!.status).toBe('refund_pending');
    const refund = await api().post(`/api/v1/admin/orders/${orderId}/refund`).set(auth(fx.admin)).send({ mode: 'gateway', note: 'Refund issued' });
    expect(refund.status).toBe(200);
    expect(refund.body.data.status).toBe('refunded');
  });

  it('shows online payment as unavailable when no provider is configured', async () => {
    setPaymentProvider(null);
    const cfg = await api().get('/api/v1/payments/config');
    expect(cfg.body.data.onlineAvailable).toBe(false);
    const p = await createPublishedProduct(shopA.owner, shopA.shopId, fx.categoryId, { name: 'No gateway', stockQuantity: 3 });
    await api().post('/api/v1/cart/items').set(auth(customer)).send({ productId: p.id, quantity: 1 });
    const co = await api().post('/api/v1/checkout').set(auth(customer)).send({ idempotencyKey: crypto.randomUUID(), shops: [{ shopId: shopA.shopId, fulfilmentMethod: 'pickup', paymentMethod: 'online' }] });
    expect(co.status).toBe(503);
    expect(co.body.error.code).toBe('ONLINE_PAYMENT_UNAVAILABLE');
    setPaymentProvider(gateway);
    void User;
  });
});
