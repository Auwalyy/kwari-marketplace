import { Types } from 'mongoose';
import {
  BOOKS_PERIOD_LABELS,
  BUSINESS_TIMEZONE,
  EXPENSE_CATEGORIES,
  UNIT_LABELS,
  formatNaira,
  lineTotalKobo,
  resolveUnitPrice,
  type BooksPeriod,
  type BooksSummaryDto,
  type ExpenseCategory,
  type MeasurementUnit,
  type SaleCreateInput,
  type SalePaymentMethod,
  type ShopDashboardDto,
  type ShopExpenseDto,
  type ShopInsightDto,
  type ShopSaleDto,
  type StockForecastDto,
} from '@kkdm/shared';
import { ShopExpense, ShopSale, type ShopExpenseAttrs, type ShopSaleAttrs } from './books.models';
import { InventoryMovement, Product } from '../products/product.models';
import { Order, Quotation } from '../orders/order.models';
import { Payment } from '../payments/payment.models';
import { Conversation } from '../chats/chat.models';
import { User } from '../users/user.model';
import { newOrderReference, refreshStockStatus, releaseStock, reserveStock } from '../orders/order.service';
import { withTransaction } from '../../config/db';
import { badRequest, conflict, iso } from '../../utils/http';

/* Periods ------------------------------------------------------------------------------------------ */

const DAY = 86_400_000;
/** Africa/Lagos is UTC+1 all year (no daylight saving), so day boundaries are a fixed offset. */
const LAGOS_OFFSET = 60 * 60 * 1000;

function lagosMidnight(t: number) {
  return Math.floor((t + LAGOS_OFFSET) / DAY) * DAY - LAGOS_OFFSET;
}

export interface Range {
  from: Date;
  to: Date;
}

/** Start and end of a reporting period, in Lagos time. */
export function periodRange(key: BooksPeriod, now = Date.now()): Range {
  const today = lagosMidnight(now);
  const local = new Date(now + LAGOS_OFFSET);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const at = (ms: number) => new Date(ms);
  switch (key) {
    case 'today':
      return { from: at(today), to: at(now) };
    case 'yesterday':
      return { from: at(today - DAY), to: at(today) };
    case 'week': {
      const sinceMonday = (local.getUTCDay() + 6) % 7;
      return { from: at(today - sinceMonday * DAY), to: at(now) };
    }
    case 'month':
      return { from: at(Date.UTC(y, m, 1) - LAGOS_OFFSET), to: at(now) };
    case 'last_month':
      return { from: at(Date.UTC(y, m - 1, 1) - LAGOS_OFFSET), to: at(Date.UTC(y, m, 1) - LAGOS_OFFSET) };
    case '30d':
      return { from: at(now - 30 * DAY), to: at(now) };
    case '90d':
      return { from: at(now - 90 * DAY), to: at(now) };
    case 'year':
      return { from: at(Date.UTC(y, 0, 1) - LAGOS_OFFSET), to: at(now) };
  }
}

/** The period of the same length just before `r`, for "up 12% on last week" comparisons. */
function previousRange(r: Range): Range {
  const len = r.to.getTime() - r.from.getTime();
  return { from: new Date(r.from.getTime() - len), to: r.from };
}

/* Formatting for messages --------------------------------------------------------------------------- */

function qty(n: number, unit: MeasurementUnit) {
  const rounded = Math.round(n * 10) / 10;
  const label = UNIT_LABELS[unit] ?? { singular: unit, plural: `${unit}s` };
  return `${rounded.toLocaleString('en-NG')} ${rounded === 1 ? label.singular : label.plural}`;
}

/* Recording sales ----------------------------------------------------------------------------------- */

const COMPLETED_ORDER = ['delivered', 'completed'];
/** Orders that count as demand for stock forecasting (anything not cancelled or rejected). */
const LIVE_ORDER = ['pending_acceptance', 'accepted', 'processing', 'ready', 'dispatched', 'delivered', 'completed', 'disputed'];

/**
 * Records a sale made in the shop. Stock is taken atomically (it can't go below zero), and the sale,
 * its stock movements and the payment are saved together. A repeated `clientRef` returns the first sale.
 */
export async function recordSale(shopId: Types.ObjectId, userId: string, input: SaleCreateInput) {
  if (input.clientRef) {
    const existing = await ShopSale.findOne({ shopId, clientRef: input.clientRef });
    if (existing) return existing;
  }
  const now = Date.now();
  const soldAt = input.soldAt ?? new Date(now);
  if (soldAt.getTime() > now + 5 * 60_000) throw badRequest('The sale date can’t be in the future', 'INVALID_DATE');
  if (soldAt.getTime() < now - 60 * DAY) throw badRequest('Sales can be back-dated by up to 60 days', 'INVALID_DATE');

  const productIds = input.items.filter((i) => i.productId).map((i) => new Types.ObjectId(i.productId));
  const products = new Map((await Product.find({ _id: { $in: productIds }, shopId }).lean()).map((p) => [String(p._id), p]));

  const items = input.items.map((i) => {
    if (!i.productId) {
      const unitPriceKobo = i.unitPriceKobo!;
      return {
        productId: null,
        variantId: null,
        name: i.name!,
        unit: (i.unit ?? 'piece') as MeasurementUnit,
        quantity: i.quantity,
        unitPriceKobo,
        unitCostKobo: i.unitCostKobo ?? null,
        lineTotalKobo: lineTotalKobo(unitPriceKobo, i.quantity),
        stockTaken: false,
        trackInventory: false,
      };
    }
    const p = products.get(i.productId);
    if (!p) throw badRequest('One of the products is not in this shop', 'INVALID_PRODUCT');
    const activeVariants = (p.variants ?? []).filter((v) => v.active !== false);
    if (activeVariants.length && !i.variantId) throw badRequest(`Choose which option of ${p.name} was sold`, 'VARIANT_REQUIRED');
    const variant = i.variantId ? activeVariants.find((v) => String(v._id) === i.variantId) : null;
    if (i.variantId && !variant) throw badRequest(`That option of ${p.name} no longer exists`, 'INVALID_VARIANT');
    const unitPriceKobo = i.unitPriceKobo ?? variant?.priceOverrideKobo ?? resolveUnitPrice(p, i.quantity).unitPriceKobo;
    const tracked = p.trackInventory !== false;
    return {
      productId: p._id,
      variantId: variant?._id ?? null,
      name: variant ? `${p.name} — ${variant.label}` : p.name,
      unit: p.unit as MeasurementUnit,
      quantity: i.quantity,
      unitPriceKobo,
      unitCostKobo: p.costPriceKobo ?? null,
      lineTotalKobo: lineTotalKobo(unitPriceKobo, i.quantity),
      stockTaken: tracked,
      trackInventory: tracked,
    };
  });

  const subtotalKobo = items.reduce((s, i) => s + i.lineTotalKobo, 0);
  if (input.discountKobo > subtotalKobo) throw badRequest('The discount is more than the sale total', 'INVALID_DISCOUNT');
  const totalKobo = subtotalKobo - input.discountKobo;
  const paid = input.amountPaidKobo ?? totalKobo;
  if (paid > totalKobo) throw badRequest('The amount paid is more than the total', 'OVERPAID');
  if (paid < totalKobo && !input.customerName) {
    throw badRequest('Add the customer’s name so you can track what they owe', 'CUSTOMER_REQUIRED');
  }

  const stockLines = items.filter((i) => i.trackInventory).map((i) => ({ productId: i.productId!, variantId: i.variantId, quantity: i.quantity, productName: i.name }));
  const sale = await withTransaction(async (session) => {
    try {
      await reserveStock(stockLines, session);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'INSUFFICIENT_STOCK') {
        throw conflict(`${(err as Error).message.replace('Please update your cart.', '').trim()} Add the stock in Inventory first, or correct the quantity.`, 'INSUFFICIENT_STOCK');
      }
      throw err;
    }
    const create = () => ShopSale.create(
      [
        {
          shopId,
          number: newOrderReference('S'),
          soldAt,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          items: items.map(({ trackInventory: _t, ...rest }) => rest),
          subtotalKobo,
          discountKobo: input.discountKobo,
          totalKobo,
          payments: paid > 0 ? [{ amountKobo: paid, method: input.paymentMethod, at: soldAt, recordedBy: userId }] : [],
          amountPaidKobo: paid,
          balanceKobo: totalKobo - paid,
          note: input.note,
          clientRef: input.clientRef,
          recordedBy: userId,
        },
      ],
      { session },
    );
    try {
      const [created] = await create();
      return created;
    } catch (err) {
      // Without a transaction to roll back, put the stock back by hand.
      if (!session) await releaseStock(stockLines);
      throw err;
    }
  });

  await recordMovements(shopId, userId, sale.items, 'sale_in_shop', -1, `Sale ${sale.number}`);
  return sale;
}

async function recordMovements(shopId: Types.ObjectId, userId: string, items: ShopSaleAttrs['items'], reason: 'sale_in_shop' | 'sale_voided', sign: 1 | -1, note: string) {
  const taken = items.filter((i) => i.stockTaken && i.productId);
  if (!taken.length) return;
  const after = new Map((await Product.find({ _id: { $in: taken.map((i) => i.productId) } }).select('stockQuantity variants').lean()).map((p) => [String(p._id), p]));
  await InventoryMovement.insertMany(
    taken.map((i) => {
      const p = after.get(String(i.productId));
      const variant = i.variantId ? p?.variants?.find((v) => String(v._id) === String(i.variantId)) : null;
      return { productId: i.productId, variantId: i.variantId ?? null, shopId, delta: sign * i.quantity, balanceAfter: variant ? variant.stockQuantity : p?.stockQuantity, reason, note, actorId: userId };
    }),
  );
  await refreshStockStatus(taken.map((i) => i.productId as Types.ObjectId));
}

/** Records money received later for a sale bought on credit. */
export async function recordSalePayment(shopId: Types.ObjectId, saleId: string, userId: string, input: { amountKobo: number; method: SalePaymentMethod; note?: string }) {
  const updated = await ShopSale.findOneAndUpdate(
    { _id: saleId, shopId, status: 'completed', balanceKobo: { $gte: input.amountKobo } },
    {
      $push: { payments: { amountKobo: input.amountKobo, method: input.method, at: new Date(), note: input.note, recordedBy: userId } },
      $inc: { amountPaidKobo: input.amountKobo, balanceKobo: -input.amountKobo },
    },
    { new: true },
  );
  if (!updated) {
    const sale = await ShopSale.findOne({ _id: saleId, shopId }).select('status balanceKobo').lean();
    if (!sale) return null;
    if (sale.status !== 'completed') throw conflict('This sale was cancelled', 'SALE_VOIDED');
    throw badRequest(`The customer only owes ${formatNaira(sale.balanceKobo)}`, 'OVERPAID');
  }
  return updated;
}

/** Cancels a sale recorded by mistake: the stock goes back and it drops out of the totals. */
export async function voidSale(shopId: Types.ObjectId, saleId: string, userId: string, reason: string) {
  const sale = await ShopSale.findOneAndUpdate(
    { _id: saleId, shopId, status: 'completed' },
    { $set: { status: 'voided', voidReason: reason, voidedAt: new Date(), voidedBy: userId } },
    { new: true },
  );
  if (!sale) {
    const exists = await ShopSale.exists({ _id: saleId, shopId });
    if (!exists) return null;
    throw conflict('This sale is already cancelled', 'SALE_VOIDED');
  }
  const back = sale.items.filter((i) => i.stockTaken && i.productId).map((i) => ({ productId: i.productId as Types.ObjectId, variantId: i.variantId as Types.ObjectId | null, quantity: i.quantity }));
  await releaseStock(back);
  await recordMovements(shopId, userId, sale.items, 'sale_voided', 1, `Cancelled sale ${sale.number}`);
  return sale;
}

/* DTOs ------------------------------------------------------------------------------------------------ */

async function userNames(ids: unknown[]) {
  const users = await User.find({ _id: { $in: [...new Set(ids.map(String))] } }).select('fullName').lean();
  return new Map(users.map((u) => [String(u._id), u.fullName]));
}

type SaleLike = ShopSaleAttrs & { _id: Types.ObjectId; createdAt?: Date };

export async function toSaleDtos(sales: SaleLike[], opts: { finance: boolean }): Promise<ShopSaleDto[]> {
  const names = await userNames(sales.map((s) => s.recordedBy));
  const thumbs = new Map(
    (await Product.find({ _id: { $in: sales.flatMap((s) => s.items.map((i) => i.productId).filter(Boolean)) } }).select('images').lean()).map((p) => [
      String(p._id),
      [...(p.images ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.thumbnailUrl ?? null,
    ]),
  );
  return sales.map((s) => ({
    id: String(s._id),
    number: s.number,
    soldAt: iso(s.soldAt)!,
    customerName: s.customerName ?? undefined,
    customerPhone: s.customerPhone ?? undefined,
    items: s.items.map((i) => ({
      productId: i.productId ? String(i.productId) : null,
      variantId: i.variantId ? String(i.variantId) : null,
      name: i.name,
      unit: i.unit as MeasurementUnit,
      quantity: i.quantity,
      unitPriceKobo: i.unitPriceKobo,
      lineTotalKobo: i.lineTotalKobo,
      ...(opts.finance ? { unitCostKobo: i.unitCostKobo ?? null } : {}),
      thumbnailUrl: i.productId ? (thumbs.get(String(i.productId)) ?? null) : null,
    })),
    subtotalKobo: s.subtotalKobo,
    discountKobo: s.discountKobo ?? 0,
    totalKobo: s.totalKobo,
    amountPaidKobo: s.amountPaidKobo ?? 0,
    balanceKobo: s.balanceKobo ?? 0,
    payments: (s.payments ?? []).map((p) => ({ amountKobo: p.amountKobo, method: p.method as SalePaymentMethod, at: iso(p.at)!, note: p.note ?? undefined })),
    status: s.status as 'completed' | 'voided',
    voidReason: s.voidReason ?? undefined,
    note: s.note ?? undefined,
    recordedBy: { id: String(s.recordedBy), fullName: names.get(String(s.recordedBy)) ?? '' },
    createdAt: iso(s.createdAt)!,
  }));
}

type ExpenseLike = ShopExpenseAttrs & { _id: Types.ObjectId };

export async function toExpenseDtos(expenses: ExpenseLike[]): Promise<ShopExpenseDto[]> {
  const names = await userNames(expenses.map((e) => e.recordedBy));
  return expenses.map((e) => ({
    id: String(e._id),
    category: e.category as ExpenseCategory,
    amountKobo: e.amountKobo,
    method: e.method as SalePaymentMethod,
    spentAt: iso(e.spentAt)!,
    note: e.note ?? undefined,
    status: e.status as 'active' | 'voided',
    recordedBy: { id: String(e.recordedBy), fullName: names.get(String(e.recordedBy)) ?? '' },
  }));
}

/* Stock forecasting --------------------------------------------------------------------------------- */

/** Units sold per product (app orders + in-shop sales) since `since`. */
async function unitsSold(shopId: Types.ObjectId, since: Date) {
  const [app, shop] = await Promise.all([
    Order.aggregate([
      { $match: { shopId, status: { $in: LIVE_ORDER }, createdAt: { $gte: since } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.productId', q: { $sum: '$items.quantity' } } },
    ]),
    ShopSale.aggregate([
      { $match: { shopId, status: 'completed', soldAt: { $gte: since } } },
      { $unwind: '$items' },
      { $match: { 'items.productId': { $ne: null } } },
      { $group: { _id: '$items.productId', q: { $sum: '$items.quantity' } } },
    ]),
  ]);
  const sold = new Map<string, number>();
  for (const r of [...app, ...shop]) sold.set(String(r._id), (sold.get(String(r._id)) ?? 0) + r.q);
  return sold;
}

/**
 * How long each product's stock will last at its recent selling rate, and how much to buy. The rate
 * uses the last 30 days, or the product's age when it is newer (at least a week, so one early sale
 * doesn't look like a trend).
 */
export async function stockForecasts(shopId: Types.ObjectId, opts: { finance: boolean }): Promise<StockForecastDto[]> {
  const now = Date.now();
  const [products, sold] = await Promise.all([
    Product.find({ shopId, status: { $ne: 'archived' }, trackInventory: { $ne: false } })
      .select('name unit images stockQuantity stockStatus costPriceKobo retailPriceKobo createdAt')
      .lean(),
    unitsSold(shopId, new Date(now - 30 * DAY)),
  ]);
  return products
    .map((p) => {
      const soldLast30 = Math.round((sold.get(String(p._id)) ?? 0) * 100) / 100;
      const ageDays = (now - new Date(p.createdAt as Date).getTime()) / DAY;
      const window = Math.min(30, Math.max(7, ageDays));
      const dailyRate = soldLast30 / window;
      const daysLeft = dailyRate > 0 ? Math.floor(p.stockQuantity / dailyRate) : null;
      const suggestedReorder = dailyRate > 0 ? Math.max(0, Math.ceil(dailyRate * 30 - p.stockQuantity)) : 0;
      return {
        productId: String(p._id),
        name: p.name,
        unit: p.unit as MeasurementUnit,
        thumbnailUrl: [...(p.images ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.thumbnailUrl ?? null,
        stockQuantity: p.stockQuantity,
        stockStatus: p.stockStatus as StockForecastDto['stockStatus'],
        soldLast30,
        dailyRate: Math.round(dailyRate * 100) / 100,
        daysLeft,
        suggestedReorder,
        ...(opts.finance ? { costPriceKobo: p.costPriceKobo ?? null } : {}),
        retailPriceKobo: p.retailPriceKobo,
        ageDays,
      };
    })
    .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.stockQuantity - b.stockQuantity)
    .map(({ ageDays: _a, ...f }) => f);
}

/* Money ---------------------------------------------------------------------------------------------- */

interface Money {
  appKobo: number;
  appCount: number;
  inShopKobo: number;
  inShopCount: number;
}

/** App orders count as sales when they are delivered or completed, dated by when that happened. */
function appSalesMatch(shopId: Types.ObjectId, r: Range) {
  return [
    { $match: { shopId, status: { $in: COMPLETED_ORDER } } },
    { $addFields: { doneAt: { $ifNull: ['$completedAt', { $ifNull: ['$deliveredAt', '$updatedAt'] }] } } },
    { $match: { doneAt: { $gte: r.from, $lt: r.to } } },
  ];
}

async function revenue(shopId: Types.ObjectId, r: Range): Promise<Money> {
  const [app, shop] = await Promise.all([
    Order.aggregate([...appSalesMatch(shopId, r), { $group: { _id: null, kobo: { $sum: '$totalKobo' }, n: { $sum: 1 } } }]),
    ShopSale.aggregate([
      { $match: { shopId, status: 'completed', soldAt: { $gte: r.from, $lt: r.to } } },
      { $group: { _id: null, kobo: { $sum: '$totalKobo' }, n: { $sum: 1 } } },
    ]),
  ]);
  return { appKobo: app[0]?.kobo ?? 0, appCount: app[0]?.n ?? 0, inShopKobo: shop[0]?.kobo ?? 0, inShopCount: shop[0]?.n ?? 0 };
}

async function collected(shopId: Types.ObjectId, r: Range) {
  const [app, shop] = await Promise.all([
    Payment.aggregate([
      { $match: { shopId, status: { $in: ['paid', 'seller_confirmed'] } } },
      { $addFields: { at: { $ifNull: ['$paidAt', '$updatedAt'] } } },
      { $match: { at: { $gte: r.from, $lt: r.to } } },
      { $group: { _id: '$method', kobo: { $sum: '$amountKobo' } } },
    ]),
    ShopSale.aggregate([
      { $match: { shopId, status: 'completed', 'payments.at': { $gte: r.from, $lt: r.to } } },
      { $unwind: '$payments' },
      { $match: { 'payments.at': { $gte: r.from, $lt: r.to } } },
      { $group: { _id: '$payments.method', kobo: { $sum: '$payments.amountKobo' } } },
    ]),
  ]);
  // App payment methods map onto how the money actually arrived.
  const appMethod: Record<string, SalePaymentMethod | 'online'> = { online: 'online', cash_on_pickup: 'cash', bank_transfer: 'transfer' };
  const byMethod = new Map<SalePaymentMethod | 'online', number>();
  for (const a of app) byMethod.set(appMethod[a._id] ?? 'online', (byMethod.get(appMethod[a._id] ?? 'online') ?? 0) + a.kobo);
  for (const s of shop) byMethod.set(s._id, (byMethod.get(s._id) ?? 0) + s.kobo);
  const list = [...byMethod.entries()].map(([method, kobo]) => ({ method, kobo })).sort((a, b) => b.kobo - a.kobo);
  return { totalKobo: list.reduce((s, m) => s + m.kobo, 0), byMethod: list };
}

/** Sold lines in the period with their cost (in-shop: cost when sold; app: the product's current cost). */
async function soldLines(shopId: Types.ObjectId, r: Range) {
  const [app, shop] = await Promise.all([
    Order.aggregate([
      ...appSalesMatch(shopId, r),
      { $unwind: '$items' },
      { $project: { productId: '$items.productId', name: '$items.productName', unit: '$items.unit', quantity: '$items.quantity', revenue: '$items.lineTotalKobo' } },
    ]),
    ShopSale.aggregate([
      { $match: { shopId, status: 'completed', soldAt: { $gte: r.from, $lt: r.to } } },
      { $unwind: '$items' },
      { $project: { productId: '$items.productId', name: '$items.name', unit: '$items.unit', quantity: '$items.quantity', revenue: '$items.lineTotalKobo', unitCost: '$items.unitCostKobo' } },
    ]),
  ]);
  const costs = new Map(
    (await Product.find({ _id: { $in: app.map((l) => l.productId) } }).select('costPriceKobo').lean()).map((p) => [String(p._id), p.costPriceKobo ?? null]),
  );
  return [
    ...app.map((l) => ({ ...l, unitCost: costs.get(String(l.productId)) ?? null })),
    ...shop,
  ] as { productId: Types.ObjectId | null; name: string; unit: MeasurementUnit; quantity: number; revenue: number; unitCost: number | null }[];
}

async function owedSummary(shopId: Types.ObjectId) {
  const twoWeeksAgo = new Date(Date.now() - 14 * DAY);
  const rows = await ShopSale.aggregate([
    { $match: { shopId, status: 'completed', balanceKobo: { $gt: 0 } } },
    {
      $group: {
        _id: { $toLower: { $ifNull: ['$customerPhone', '$customerName'] } },
        kobo: { $sum: '$balanceKobo' },
        overdue: { $sum: { $cond: [{ $lt: ['$soldAt', twoWeeksAgo] }, '$balanceKobo', 0] } },
      },
    },
  ]);
  return {
    totalKobo: rows.reduce((s, r) => s + r.kobo, 0),
    customers: rows.length,
    overdueKobo: rows.reduce((s, r) => s + r.overdue, 0),
  };
}

export async function booksSummary(shopId: Types.ObjectId, key: BooksPeriod): Promise<BooksSummaryDto> {
  const r = periodRange(key);
  const prev = previousRange(r);
  const daily = r.to.getTime() - r.from.getTime() <= 93 * DAY;
  const bucket = (field: string) => ({ $dateToString: { format: daily ? '%Y-%m-%d' : '%Y-%m', date: field, timezone: BUSINESS_TIMEZONE } });

  const [money, before, cash, lines, expenseRows, owed, trendApp, trendShop, trendExp, stockRows] = await Promise.all([
    revenue(shopId, r),
    revenue(shopId, prev),
    collected(shopId, r),
    soldLines(shopId, r),
    ShopExpense.aggregate([{ $match: { shopId, status: 'active', spentAt: { $gte: r.from, $lt: r.to } } }, { $group: { _id: '$category', kobo: { $sum: '$amountKobo' } } }]),
    owedSummary(shopId),
    Order.aggregate([...appSalesMatch(shopId, r), { $group: { _id: bucket('$doneAt'), kobo: { $sum: '$totalKobo' } } }]),
    ShopSale.aggregate([{ $match: { shopId, status: 'completed', soldAt: { $gte: r.from, $lt: r.to } } }, { $group: { _id: bucket('$soldAt'), kobo: { $sum: '$totalKobo' } } }]),
    ShopExpense.aggregate([{ $match: { shopId, status: 'active', spentAt: { $gte: r.from, $lt: r.to } } }, { $group: { _id: bucket('$spentAt'), kobo: { $sum: '$amountKobo' } } }]),
    Product.find({ shopId, status: { $ne: 'archived' }, trackInventory: { $ne: false }, stockQuantity: { $gt: 0 } }).select('stockQuantity retailPriceKobo costPriceKobo').lean(),
  ]);

  const totalKobo = money.appKobo + money.inShopKobo;
  const beforeTotal = before.appKobo + before.inShopKobo;
  const lineRevenue = lines.reduce((s, l) => s + l.revenue, 0);
  const costed = lines.filter((l) => l.unitCost != null);
  const costOfGoodsKobo = Math.round(costed.reduce((s, l) => s + (l.unitCost as number) * l.quantity, 0));
  const costedRevenue = costed.reduce((s, l) => s + l.revenue, 0);
  const costCoverage = lineRevenue > 0 ? Math.round((costedRevenue / lineRevenue) * 100) / 100 : 1;

  const byCategory = EXPENSE_CATEGORIES.map((c) => ({ category: c, kobo: expenseRows.find((e) => e._id === c)?.kobo ?? 0 })).filter((e) => e.kobo > 0).sort((a, b) => b.kobo - a.kobo);
  const expensesTotal = byCategory.reduce((s, e) => s + e.kobo, 0);
  const stockPurchasesKobo = byCategory.find((e) => e.category === 'stock_purchase')?.kobo ?? 0;
  // Buying stock is not a cost until the stock is sold; profit uses the cost of what was sold instead.
  const operatingKobo = expensesTotal - stockPurchasesKobo;
  const grossProfitKobo = totalKobo - costOfGoodsKobo;

  const days = new Map<string, { appKobo: number; inShopKobo: number; expensesKobo: number }>();
  const touch = (k: string) => days.get(k) ?? days.set(k, { appKobo: 0, inShopKobo: 0, expensesKobo: 0 }).get(k)!;
  for (const t of trendApp) touch(t._id).appKobo = t.kobo;
  for (const t of trendShop) touch(t._id).inShopKobo = t.kobo;
  for (const t of trendExp) touch(t._id).expensesKobo = t.kobo;

  const top = new Map<string, { productId: string | null; name: string; unit: MeasurementUnit; quantity: number; revenueKobo: number; cost: number; costKnown: boolean }>();
  for (const l of lines) {
    const k = l.productId ? String(l.productId) : `name:${l.name.toLowerCase()}`;
    const t = top.get(k) ?? { productId: l.productId ? String(l.productId) : null, name: l.name, unit: l.unit, quantity: 0, revenueKobo: 0, cost: 0, costKnown: true };
    t.quantity += l.quantity;
    t.revenueKobo += l.revenue;
    if (l.unitCost == null) t.costKnown = false;
    else t.cost += l.unitCost * l.quantity;
    top.set(k, t);
  }

  return {
    period: { key, label: BOOKS_PERIOD_LABELS[key], from: r.from.toISOString(), to: r.to.toISOString() },
    revenue: {
      totalKobo,
      appKobo: money.appKobo,
      inShopKobo: money.inShopKobo,
      appCount: money.appCount,
      inShopCount: money.inShopCount,
      changePct: beforeTotal > 0 ? Math.round(((totalKobo - beforeTotal) / beforeTotal) * 100) : null,
    },
    collected: cash,
    owed,
    costOfGoodsKobo,
    costCoverage,
    expenses: { totalKobo: expensesTotal, operatingKobo, stockPurchasesKobo, byCategory },
    grossProfitKobo,
    netProfitKobo: grossProfitKobo - operatingKobo,
    trend: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    topProducts: [...top.values()]
      .sort((a, b) => b.revenueKobo - a.revenueKobo)
      .slice(0, 8)
      .map(({ cost, costKnown, ...t }) => ({ ...t, quantity: Math.round(t.quantity * 100) / 100, profitKobo: costKnown ? Math.round(t.revenueKobo - cost) : null })),
    stock: {
      retailValueKobo: Math.round(stockRows.reduce((s, p) => s + p.stockQuantity * p.retailPriceKobo, 0)),
      costValueKobo: Math.round(stockRows.reduce((s, p) => s + p.stockQuantity * (p.costPriceKobo ?? 0), 0)),
      productsMissingCost: stockRows.filter((p) => p.costPriceKobo == null).length,
    },
    insights: await shopInsights(shopId, { finance: true, operations: false }),
  };
}

/* Advice ---------------------------------------------------------------------------------------------- */

/**
 * Plain-language advice from the shop's own numbers. Every rule is explainable: restock timing from
 * the selling rate, items that stopped selling, prices below cost, debts, and week-on-week trend.
 */
export async function shopInsights(shopId: Types.ObjectId, opts: { finance: boolean; operations: boolean }): Promise<ShopInsightDto[]> {
  const out: ShopInsightDto[] = [];

  if (opts.operations) {
    const [pending, unread] = await Promise.all([
      Order.countDocuments({ shopId, status: 'pending_acceptance' }),
      Conversation.countDocuments({ shopId, shopUnread: { $gt: 0 } }),
    ]);
    if (pending) out.push({ id: 'orders', kind: 'orders', severity: 'urgent', title: `${pending} order${pending > 1 ? 's' : ''} waiting for you`, message: 'Accept or decline so the customer knows what is happening.', action: 'orders' });
    if (unread) out.push({ id: 'enquiries', kind: 'enquiries', severity: 'warning', title: `${unread} customer chat${unread > 1 ? 's' : ''} to answer`, message: 'Quick replies win more sales.', action: 'enquiries' });
  }

  const forecasts = await stockForecasts(shopId, { finance: opts.finance });
  const soldOut = forecasts.filter((f) => f.stockQuantity <= 0 && f.soldLast30 > 0).sort((a, b) => b.soldLast30 - a.soldLast30);
  for (const f of soldOut.slice(0, 2)) {
    out.push({ id: `sold_out:${f.productId}`, kind: 'sold_out', severity: 'urgent', title: `${f.name} is sold out`, message: `You sold ${qty(f.soldLast30, f.unit)} in the last 30 days. Customers can’t buy it until you restock.`, productId: f.productId, action: 'inventory' });
  }
  const running = forecasts.filter((f) => f.stockQuantity > 0 && f.daysLeft != null && f.daysLeft <= 7);
  for (const f of running.slice(0, 3)) {
    out.push({
      id: `reorder:${f.productId}`,
      kind: 'reorder',
      severity: (f.daysLeft ?? 0) <= 3 ? 'urgent' : 'warning',
      title: `Restock ${f.name} soon`,
      message: `${qty(f.stockQuantity, f.unit)} left — about ${f.daysLeft === 0 ? 'less than a day' : `${f.daysLeft} day${f.daysLeft === 1 ? '' : 's'}`} at ${qty(f.dailyRate, f.unit)} a day. Buy about ${qty(f.suggestedReorder, f.unit)} to last a month.`,
      productId: f.productId,
      action: 'inventory',
    });
  }
  if (running.length > 3) out.push({ id: 'reorder:more', kind: 'reorder', severity: 'warning', title: `${running.length - 3} more products running low`, message: 'See Inventory for how long each will last.', action: 'inventory' });
  // Below the seller's own alert level, even without recent sales to estimate from.
  const flagged = new Set([...soldOut, ...running].map((f) => f.productId));
  const belowAlert = forecasts.filter((f) => f.stockQuantity > 0 && f.stockStatus === 'low_stock' && !flagged.has(f.productId));
  for (const f of belowAlert.slice(0, 2)) {
    out.push({ id: `low:${f.productId}`, kind: 'reorder', severity: 'warning', title: `${f.name} is running low`, message: `Only ${qty(f.stockQuantity, f.unit)} left.`, productId: f.productId, action: 'inventory' });
  }
  const outQuiet = forecasts.filter((f) => f.stockQuantity <= 0 && f.soldLast30 === 0);
  if (outQuiet.length) {
    out.push({
      id: 'sold_out:quiet',
      kind: 'sold_out',
      severity: 'info',
      title: outQuiet.length === 1 ? `${outQuiet[0].name} is out of stock` : `${outQuiet.length} products are out of stock`,
      message: outQuiet.length === 1 ? 'Customers can’t buy it. Restock it, or archive it if you no longer sell it.' : 'Customers can’t buy them. Restock, or archive the ones you no longer sell.',
      action: 'inventory',
    });
  }

  const products = await Product.find({ shopId, status: { $ne: 'archived' } }).select('name stockQuantity retailPriceKobo costPriceKobo createdAt trackInventory').lean();
  const oldEnough = new Set(products.filter((p) => Date.now() - new Date(p.createdAt as Date).getTime() > 21 * DAY).map((p) => String(p._id)));
  const slow = forecasts.filter((f) => f.stockQuantity > 0 && f.soldLast30 === 0 && oldEnough.has(f.productId));
  if (slow.length) {
    const tiedUp = slow.reduce((s, f) => s + f.stockQuantity * (opts.finance && f.costPriceKobo != null ? f.costPriceKobo : f.retailPriceKobo), 0);
    out.push({
      id: 'slow_moving',
      kind: 'slow_moving',
      severity: 'info',
      title: `${slow.length} product${slow.length > 1 ? 's have' : ' has'} not sold in 30 days`,
      message: `${opts.finance ? `About ${formatNaira(Math.round(tiedUp))} of stock is waiting. ` : ''}A better photo, a lower price or a promotion can help${slow.length === 1 ? ` (${slow[0].name})` : ''}.`,
      action: 'inventory',
    });
  }

  if (opts.finance) {
    const below = products.filter((p) => p.costPriceKobo != null && p.retailPriceKobo < p.costPriceKobo);
    for (const p of below.slice(0, 2)) {
      out.push({ id: `below_cost:${p._id}`, kind: 'below_cost', severity: 'warning', title: `${p.name} sells below cost`, message: `It costs you ${formatNaira(p.costPriceKobo!)} but sells for ${formatNaira(p.retailPriceKobo)}. Check the price.`, productId: String(p._id), action: 'product' });
    }
    const missing = products.filter((p) => p.costPriceKobo == null && p.stockQuantity > 0 && p.trackInventory !== false);
    if (missing.length) {
      out.push({ id: 'missing_cost', kind: 'missing_cost', severity: 'info', title: `Add cost prices for ${missing.length} product${missing.length > 1 ? 's' : ''}`, message: 'Then your profit is calculated exactly instead of estimated.', action: 'products' });
    }
    const owed = await owedSummary(shopId);
    if (owed.totalKobo > 0) {
      out.push({
        id: 'debts',
        kind: 'debts',
        severity: owed.overdueKobo > 0 ? 'warning' : 'info',
        title: `Customers owe you ${formatNaira(owed.totalKobo)}`,
        message: `${owed.customers} customer${owed.customers > 1 ? 's' : ''}${owed.overdueKobo > 0 ? ` · ${formatNaira(owed.overdueKobo)} is over 2 weeks old` : ''}. Tap to see who.`,
        action: 'sales_owing',
      });
    }
    const week = { from: new Date(Date.now() - 7 * DAY), to: new Date() };
    const [now, before] = await Promise.all([revenue(shopId, week), revenue(shopId, previousRange(week))]);
    const a = now.appKobo + now.inShopKobo;
    const b = before.appKobo + before.inShopKobo;
    if (b > 0 && Math.abs(a - b) / b >= 0.15) {
      const pct = Math.round(((a - b) / b) * 100);
      out.push({
        id: 'trend',
        kind: 'trend',
        severity: pct > 0 ? 'good' : 'warning',
        title: pct > 0 ? `Sales up ${pct}% this week` : `Sales down ${Math.abs(pct)}% this week`,
        message: `${formatNaira(a)} in the last 7 days, against ${formatNaira(b)} the week before.`,
        action: 'books',
      });
    }
  }

  const bestWeek = await unitsSold(shopId, new Date(Date.now() - 7 * DAY));
  const best = [...bestWeek.entries()].sort((x, y) => y[1] - x[1])[0];
  if (best) {
    const p = forecasts.find((f) => f.productId === best[0]);
    if (p) out.push({ id: `best:${p.productId}`, kind: 'best_seller', severity: 'good', title: `Best seller this week: ${p.name}`, message: `${qty(best[1], p.unit)} sold in 7 days.`, productId: p.productId, action: 'product' });
  }

  const order = { urgent: 0, warning: 1, info: 2, good: 3 };
  return out.sort((x, y) => order[x.severity] - order[y.severity]);
}

/* Shop home -------------------------------------------------------------------------------------------- */

export async function shopDashboard(shopId: Types.ObjectId, opts: { finance: boolean; sales: boolean; operations: boolean }): Promise<ShopDashboardDto> {
  const today = periodRange('today');
  const [money, cash, pendingOrders, unreadEnquiries, pendingQuotations, low, out, owed, insights] = await Promise.all([
    revenue(shopId, today),
    collected(shopId, today),
    Order.countDocuments({ shopId, status: 'pending_acceptance' }),
    Conversation.countDocuments({ shopId, shopUnread: { $gt: 0 } }),
    Quotation.countDocuments({ shopId, status: { $in: ['requested', 'countered'] } }),
    Product.countDocuments({ shopId, status: { $ne: 'archived' }, stockStatus: 'low_stock' }),
    Product.countDocuments({ shopId, status: { $ne: 'archived' }, stockStatus: 'out_of_stock' }),
    opts.finance ? owedSummary(shopId) : Promise.resolve(null),
    shopInsights(shopId, { finance: opts.finance, operations: opts.operations }),
  ]);
  let profitKobo: number | null = null;
  if (opts.finance) {
    const s = await booksSummaryLite(shopId, today);
    profitKobo = s;
  }
  const showSales = opts.finance || opts.sales;
  return {
    today: {
      salesKobo: showSales ? money.appKobo + money.inShopKobo : 0,
      salesCount: showSales ? money.appCount + money.inShopCount : 0,
      collectedKobo: showSales ? cash.totalKobo : 0,
      appOrdersKobo: showSales ? money.appKobo : 0,
      inShopKobo: showSales ? money.inShopKobo : 0,
      profitKobo,
    },
    pendingOrders,
    unreadEnquiries,
    pendingQuotations,
    owedKobo: owed?.totalKobo ?? null,
    lowStockCount: low,
    outOfStockCount: out,
    insights,
  };
}

/** Net profit for a range without the rest of the summary (for the shop home). */
async function booksSummaryLite(shopId: Types.ObjectId, r: Range) {
  const [money, lines, exp] = await Promise.all([
    revenue(shopId, r),
    soldLines(shopId, r),
    ShopExpense.aggregate([{ $match: { shopId, status: 'active', category: { $ne: 'stock_purchase' }, spentAt: { $gte: r.from, $lt: r.to } } }, { $group: { _id: null, kobo: { $sum: '$amountKobo' } } }]),
  ]);
  const cogs = lines.reduce((s, l) => s + (l.unitCost != null ? l.unitCost * l.quantity : 0), 0);
  return Math.round(money.appKobo + money.inShopKobo - cogs - (exp[0]?.kobo ?? 0));
}
