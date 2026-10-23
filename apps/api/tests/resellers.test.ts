import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, auth, createActiveShop, createMarketFixture, createPublishedProduct, registerUser, useTestDatabase, type MarketFixture, type TestUser } from './helpers';

describe('resellers', () => {
  useTestDatabase();
  let fx: MarketFixture;
  let owner: TestUser;
  let shopId: string;
  let shopName: string;
  let productId: string;
  let reseller: TestUser;
  let customer: TestUser;
  let listingId: string;
  let slug: string;

  beforeAll(async () => {
    fx = await createMarketFixture();
    const s = await createActiveShop(fx);
    owner = s.owner;
    shopId = s.shopId;
    shopName = (await api().get(`/api/v1/shops/${shopId}`).set(auth(owner))).body.data.name;
    // Retail ₦5,000; resellers pay ₦4,000.
    const p = await createPublishedProduct(owner, shopId, fx.categoryId, { name: 'Holland Wax Print', retailPriceKobo: 500000, wholesalePriceKobo: null, wholesaleMinQuantity: null });
    productId = p.id;
    const set = await api().patch(`/api/v1/shops/${shopId}/products/${productId}`).set(auth(owner)).send({ resellerPriceKobo: 400000 });
    expect(set.status).toBe(200);
    expect(set.body.data.resellerPriceKobo).toBe(400000);
    reseller = await registerUser('Musa Agent');
    customer = await registerUser('Customer');
  });

  it('refuses a reseller price above the retail price', async () => {
    const r = await api().patch(`/api/v1/shops/${shopId}/products/${productId}`).set(auth(owner)).send({ resellerPriceKobo: 600000 });
    expect(r.status).toBe(400);
  });

  it('keeps the reseller price hidden from customers and from unapproved applicants', async () => {
    expect((await api().get(`/api/v1/products/${productId}`)).body.data.resellerPriceKobo).toBeUndefined();
    expect((await api().get(`/api/v1/products/${productId}`).set(auth(customer))).body.data.resellerPriceKobo).toBeUndefined();

    const apply = await api().post('/api/v1/resellers/apply').set(auth(reseller)).send({ businessName: 'Musa Fabrics Agent', phone: '08031234567', area: 'Fagge' });
    expect(apply.status).toBe(201);
    expect(apply.body.data.status).toBe('pending');
    slug = apply.body.data.slug;
    expect((await api().get('/api/v1/users/me').set(auth(reseller))).body.data.reseller.status).toBe('pending');
    expect((await api().get(`/api/v1/products/${productId}`).set(auth(reseller))).body.data.resellerPriceKobo).toBeUndefined();
    const early = await api().post('/api/v1/resellers/me/listings').set(auth(reseller)).send({ productId, priceKobo: 480000 });
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('RESELLER_NOT_APPROVED');
  });

  it('only admins approve resellers', async () => {
    const list = await api().get('/api/v1/admin/resellers').query({ status: 'pending' }).set(auth(fx.admin));
    expect(list.body.data).toHaveLength(1);
    const id = list.body.data[0].id;
    expect((await api().post(`/api/v1/admin/resellers/${id}/decision`).set(auth(owner)).send({ decision: 'approve' })).status).toBe(403);
    const ok = await api().post(`/api/v1/admin/resellers/${id}/decision`).set(auth(fx.admin)).send({ decision: 'approve' });
    expect(ok.body.data.status).toBe('approved');
    expect((await api().get(`/api/v1/products/${productId}`).set(auth(reseller))).body.data.resellerPriceKobo).toBe(400000);
  });

  it('re-lists a product at the reseller’s own price, never below the reseller price', async () => {
    const low = await api().post('/api/v1/resellers/me/listings').set(auth(reseller)).send({ productId, priceKobo: 350000 });
    expect(low.status).toBe(400);
    const res = await api().post('/api/v1/resellers/me/listings').set(auth(reseller)).send({ productId, priceKobo: 480000, note: 'Delivery anywhere in Kano' });
    expect(res.status).toBe(201);
    listingId = res.body.data.id;
    expect(res.body.data.source).toMatchObject({ shopName, resellerPriceKobo: 400000, profitPerUnitKobo: 80000 });
  });

  it('shows customers the reseller, never the shop', async () => {
    const pub = await api().get(`/api/v1/reseller-listings/${listingId}`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.reseller.businessName).toBe('Musa Fabrics Agent');
    expect(pub.body.data.priceKobo).toBe(480000);
    expect(pub.body.data.source).toBeUndefined();
    expect(JSON.stringify(pub.body)).not.toContain(shopName);
    expect(JSON.stringify(pub.body)).not.toContain('400000');

    const page = await api().get(`/api/v1/resellers/${slug}`);
    expect(page.body.data.listings).toHaveLength(1);
    const search = await api().get('/api/v1/reseller-listings').query({ q: 'holland' });
    expect(search.body.data.map((l: { id: string }) => l.id)).toContain(listingId);
  });

  it('serves shareable web pages for WhatsApp without revealing the shop', async () => {
    const page = await api().get(`/r/${slug}`);
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/html/);
    expect(page.text).toContain('Musa Fabrics Agent');
    expect(page.text).toContain('Holland Wax Print');
    expect(page.text).not.toContain(shopName);
    const one = await api().get(`/l/${listingId}`);
    expect(one.status).toBe(200);
    expect(one.text).toContain('og:image');
    expect(one.text).toContain('wa.me/2348031234567');
    expect(one.text).not.toContain(shopName);
    expect((await api().get('/r/nobody')).status).toBe(404);
  });

  it('passes customer requests to the reseller and records the reseller’s sale and profit', async () => {
    const rq = await api().post(`/api/v1/reseller-listings/${listingId}/requests`).set(auth(customer)).send({ quantity: 3, note: 'Need it Friday', phone: '08099999999' });
    expect(rq.status).toBe(201);
    const inbox = await api().get('/api/v1/resellers/me/requests').set(auth(reseller));
    expect(inbox.body.data[0]).toMatchObject({ quantity: 3, status: 'new', customer: { phone: '08099999999' } });

    const sale = await api()
      .post('/api/v1/resellers/me/sales')
      .set(auth(reseller))
      .send({ listingId, quantity: 3, amountPaidKobo: 1000000, customerName: 'Customer', requestId: rq.body.data.id, clientRef: 'r-1' });
    expect(sale.status).toBe(201);
    expect(sale.body.data).toMatchObject({ totalKobo: 1440000, unitCostKobo: 400000, profitKobo: 240000, balanceKobo: 440000 });
    const done = await api().get('/api/v1/resellers/me/requests').set(auth(reseller));
    expect(done.body.data[0].status).toBe('completed');

    const sum = await api().get('/api/v1/resellers/me/summary').query({ period: 'today' }).set(auth(reseller));
    expect(sum.body.data).toMatchObject({ salesKobo: 1440000, costKobo: 1200000, profitKobo: 240000, owedKobo: 440000, activeListings: 1 });
  });

  it('charges approved resellers the reseller price in the cart and tells the shop', async () => {
    const add = await api().post('/api/v1/cart/items').set(auth(reseller)).send({ productId, quantity: 3 });
    const line = add.body.data.groups[0].lines[0];
    expect(line).toMatchObject({ unitPriceKobo: 400000, resellerApplied: true });
    const normal = await api().post('/api/v1/cart/items').set(auth(customer)).send({ productId, quantity: 3 });
    expect(normal.body.data.groups[0].lines[0].unitPriceKobo).toBe(500000);

    const out = await api()
      .post('/api/v1/checkout')
      .set(auth(reseller))
      .send({ idempotencyKey: crypto.randomUUID(), shops: [{ shopId, fulfilmentMethod: 'pickup', paymentMethod: 'cash_on_pickup' }] });
    expect(out.status).toBe(201);
    expect(out.body.data.orders[0].totalKobo).toBe(1200000);
    const shopOrders = await api().get(`/api/v1/shops/${shopId}/orders`).set(auth(owner));
    const order = shopOrders.body.data.find((o: { id: string }) => o.id === out.body.data.orders[0].id);
    expect(order.reseller).toMatchObject({ businessName: 'Musa Fabrics Agent' });
  });

  it('hides a listing when the shop raises its reseller price above it, and tells the reseller why', async () => {
    await api().patch(`/api/v1/shops/${shopId}/products/${productId}`).set(auth(owner)).send({ resellerPriceKobo: 490000 });
    expect((await api().get(`/api/v1/reseller-listings/${listingId}`)).status).toBe(404);
    const own = await api().get(`/api/v1/reseller-listings/${listingId}`).set(auth(reseller));
    expect(own.body.data.available).toBe(false);
    expect(own.body.data.unavailableReason).toMatch(/raised/);
    const sum = await api().get('/api/v1/resellers/me/summary').query({ period: 'today' }).set(auth(reseller));
    expect(sum.body.data.listingsNeedingAttention).toBe(1);
    const fix = await api().patch(`/api/v1/resellers/me/listings/${listingId}`).set(auth(reseller)).send({ priceKobo: 520000 });
    expect(fix.body.data.available).toBe(true);
  });
});
