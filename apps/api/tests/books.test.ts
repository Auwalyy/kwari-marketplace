import { beforeAll, describe, expect, it } from 'vitest';
import { api, auth, createActiveShop, createMarketFixture, createPublishedProduct, registerUser, useTestDatabase, type MarketFixture, type TestUser } from './helpers';
import { ShopMembership } from '../src/modules/shops/shop.models';
import { InventoryMovement, Product } from '../src/modules/products/product.models';
import { ShopSale } from '../src/modules/books/books.models';
import { periodRange } from '../src/modules/books/books.service';

describe('shop books: in-shop sales, debts, expenses and profit', () => {
  useTestDatabase();
  let fx: MarketFixture;
  let owner: TestUser;
  let shopId: string;
  let productId: string;
  let cashier: TestUser;
  const books = (path = '') => `/api/v1/shops/${shopId}/books${path}`;

  beforeAll(async () => {
    fx = await createMarketFixture();
    const s = await createActiveShop(fx);
    owner = s.owner;
    shopId = s.shopId;
    // Retail ₦5,000 / yard, wholesale ₦4,000 from 20 yards, 100 yards in stock.
    const p = await createPublishedProduct(owner, shopId, fx.categoryId);
    productId = p.id;
    const cost = await api().patch(`/api/v1/shops/${shopId}/products/${productId}`).set(auth(owner)).send({ costPriceKobo: 300000 });
    expect(cost.status).toBe(200);
    expect(cost.body.data.costPriceKobo).toBe(300000);
    // A cashier who can record sales but not see money.
    cashier = await registerUser('Cashier');
    await ShopMembership.create({ shopId, userId: cashier.id, role: 'worker', permissions: ['sales.record'], addedBy: owner.id });
  });

  it('never shows the cost price to customers or staff without finance access', async () => {
    const pub = await api().get(`/api/v1/products/${productId}`);
    expect(pub.body.data.costPriceKobo).toBeUndefined();
    const staff = await api().get(`/api/v1/shops/${shopId}/products/${productId}`).set(auth(cashier));
    expect(staff.status).toBe(200);
    expect(staff.body.data.costPriceKobo).toBeUndefined();
  });

  it('records a sale made in the shop, takes the stock and tracks what the customer owes', async () => {
    const res = await api()
      .post(books('/sales'))
      .set(auth(cashier))
      .send({
        items: [
          { productId, quantity: 4 },
          { name: 'Tailoring thread', unit: 'piece', quantity: 2, unitPriceKobo: 50000 },
        ],
        discountKobo: 100000,
        amountPaidKobo: 1500000,
        paymentMethod: 'transfer',
        customerName: 'Malam Bello',
        customerPhone: '08030000000',
        clientRef: 'phone-1',
      });
    expect(res.status).toBe(201);
    const sale = res.body.data;
    // 4 × ₦5,000 + 2 × ₦500 − ₦1,000 = ₦20,000
    expect(sale.totalKobo).toBe(2000000);
    expect(sale.amountPaidKobo).toBe(1500000);
    expect(sale.balanceKobo).toBe(500000);
    expect(sale.items[0].unitCostKobo).toBeUndefined(); // cashier has no finance access
    expect((await Product.findById(productId))!.stockQuantity).toBe(96);
    expect(await InventoryMovement.countDocuments({ productId, reason: 'sale_in_shop', delta: -4 })).toBe(1);

    // A retried request with the same clientRef does not record the sale twice.
    const again = await api().post(books('/sales')).set(auth(cashier)).send({ items: [{ productId, quantity: 4 }], clientRef: 'phone-1', customerName: 'x' });
    expect(again.status).toBe(201);
    expect(again.body.data.id).toBe(sale.id);
    expect((await Product.findById(productId))!.stockQuantity).toBe(96);
  });

  it('uses the wholesale price automatically for large quantities', async () => {
    const res = await api().post(books('/sales')).set(auth(owner)).send({ items: [{ productId, quantity: 20 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.items[0].unitPriceKobo).toBe(400000);
    expect(res.body.data.items[0].unitCostKobo).toBe(300000);
    expect(res.body.data.balanceKobo).toBe(0);
  });

  it('refuses unclear sales: more than the stock, or credit without a customer name', async () => {
    const tooMuch = await api().post(books('/sales')).set(auth(owner)).send({ items: [{ productId, quantity: 500 }] });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(tooMuch.body.error.message).toMatch(/Inventory/);
    const credit = await api().post(books('/sales')).set(auth(owner)).send({ items: [{ productId, quantity: 1 }], amountPaidKobo: 0 });
    expect(credit.status).toBe(400);
    expect(credit.body.error.code).toBe('CUSTOMER_REQUIRED');
    expect((await Product.findById(productId))!.stockQuantity).toBe(76);
  });

  it('records a debt repayment and refuses paying more than is owed', async () => {
    const owing = await api().get(books('/sales')).query({ owing: 'true' }).set(auth(cashier));
    expect(owing.body.data).toHaveLength(1);
    const saleId = owing.body.data[0].id;
    const over = await api().post(books(`/sales/${saleId}/payments`)).set(auth(cashier)).send({ amountKobo: 600000 });
    expect(over.status).toBe(400);
    const paid = await api().post(books(`/sales/${saleId}/payments`)).set(auth(cashier)).send({ amountKobo: 500000, method: 'cash' });
    expect(paid.status).toBe(200);
    expect(paid.body.data.balanceKobo).toBe(0);
    expect(paid.body.data.payments).toHaveLength(2);
  });

  it('keeps money pages from staff without finance access', async () => {
    for (const path of ['/summary', '/expenses']) {
      const r = await api().get(books(path)).set(auth(cashier));
      expect(r.status).toBe(403);
    }
    const v = await api().post(books(`/sales/${(await ShopSale.findOne({ shopId }))!._id}/void`)).set(auth(cashier)).send({ reason: 'mistake' });
    expect(v.status).toBe(403);
  });

  it('restock with a cost updates the average cost and can record the purchase as an expense', async () => {
    const r = await api()
      .post(`/api/v1/shops/${shopId}/products/${productId}/inventory`)
      .set(auth(owner))
      .send({ delta: 24, reason: 'restock', unitCostKobo: 360000, recordExpense: true });
    expect(r.status).toBe(200);
    // 76 yards at ₦3,000 + 24 at ₦3,600 → ₦3,144 average
    expect(r.body.data.costPriceKobo).toBe(314400);
    const exp = await api().get(books('/expenses')).set(auth(owner));
    expect(exp.body.data[0]).toMatchObject({ category: 'stock_purchase', amountKobo: 8640000 });
  });

  it('works out profit: sales minus cost of what was sold minus running costs (not stock purchases)', async () => {
    const rent = await api().post(books('/expenses')).set(auth(owner)).send({ category: 'rent', amountKobo: 1000000 });
    expect(rent.status).toBe(201);
    const s = await api().get(books('/summary')).query({ period: 'today' }).set(auth(owner));
    expect(s.status).toBe(200);
    const d = s.body.data;
    // Sales: ₦20,000 (cashier) + ₦80,000 (20 yd wholesale)
    expect(d.revenue).toMatchObject({ totalKobo: 10000000, inShopKobo: 10000000, inShopCount: 2, appKobo: 0 });
    // Cost of goods: 24 yd × ₦3,000; the thread has no cost, so coverage is below 1.
    expect(d.costOfGoodsKobo).toBe(7200000);
    expect(d.costCoverage).toBeLessThan(1);
    expect(d.expenses).toMatchObject({ totalKobo: 9640000, stockPurchasesKobo: 8640000, operatingKobo: 1000000 });
    expect(d.grossProfitKobo).toBe(2800000);
    expect(d.netProfitKobo).toBe(1800000);
    expect(d.collected.totalKobo).toBe(10000000);
    expect(d.owed.totalKobo).toBe(0);
    expect(d.topProducts[0]).toMatchObject({ productId, quantity: 24 });
  });

  it('voiding a sale puts the stock back and removes it from the totals', async () => {
    const before = (await Product.findById(productId))!.stockQuantity;
    const sale = await ShopSale.findOne({ shopId, 'items.quantity': 20 });
    const v = await api().post(books(`/sales/${sale!._id}/void`)).set(auth(owner)).send({ reason: 'Entered twice' });
    expect(v.status).toBe(200);
    expect(v.body.data.status).toBe('voided');
    expect((await Product.findById(productId))!.stockQuantity).toBe(before + 20);
    const s = await api().get(books('/summary')).query({ period: 'today' }).set(auth(owner));
    expect(s.body.data.revenue.totalKobo).toBe(2000000);
    const twice = await api().post(books(`/sales/${sale!._id}/void`)).set(auth(owner)).send({ reason: 'again' });
    expect(twice.status).toBe(409);
  });

  it('forecasts how long stock will last and gives advice on the shop home', async () => {
    // A fast seller with little stock left.
    const fast = await createPublishedProduct(owner, shopId, fx.categoryId, { name: 'Fast Ankara', stockQuantity: 30, retailPriceKobo: 200000 });
    await api().post(books('/sales')).set(auth(owner)).send({ items: [{ productId: fast.id, quantity: 25 }], amountPaidKobo: 0, customerName: 'Hajiya Amina' });
    const f = await api().get(books('/forecast')).set(auth(owner));
    const row = f.body.data.find((x: { productId: string }) => x.productId === fast.id);
    expect(row.daysLeft).toBeLessThanOrEqual(7);
    expect(row.suggestedReorder).toBeGreaterThan(0);

    const dash = await api().get(books('/dashboard')).set(auth(owner));
    expect(dash.status).toBe(200);
    const kinds = dash.body.data.insights.map((i: { kind: string }) => i.kind);
    expect(kinds).toContain('reorder');
    expect(kinds).toContain('debts');
    expect(dash.body.data.owedKobo).toBe(5000000);
    expect(dash.body.data.today.profitKobo).not.toBeNull();

    // The cashier sees today's sales but no money advice or profit.
    const cashierDash = await api().get(books('/dashboard')).set(auth(cashier));
    expect(cashierDash.body.data.today.profitKobo).toBeNull();
    expect(cashierDash.body.data.owedKobo).toBeNull();
    expect(cashierDash.body.data.insights.map((i: { kind: string }) => i.kind)).not.toContain('debts');
  });

  it('works out periods in Lagos time', () => {
    // 23:30 UTC on 1 March = 00:30 on 2 March in Lagos, so "today" starts at 23:00 UTC on 1 March.
    const now = Date.UTC(2026, 2, 1, 23, 30);
    expect(periodRange('today', now).from.toISOString()).toBe('2026-03-01T23:00:00.000Z');
    expect(periodRange('month', now).from.toISOString()).toBe('2026-02-28T23:00:00.000Z');
    expect(periodRange('last_month', now).to.toISOString()).toBe('2026-02-28T23:00:00.000Z');
  });
});
