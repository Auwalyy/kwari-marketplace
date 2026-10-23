import { Router, type Request } from 'express';
import { booksPeriodSchema, expenseCreateSchema, expensesListSchema, saleCreateSchema, salePaymentSchema, salesListSchema, voidSchema, type ShopPermission } from '@kkdm/shared';
import { ShopExpense, ShopSale } from './books.models';
import { booksSummary, periodRange, recordSale, recordSalePayment, shopDashboard, stockForecasts, toExpenseDtos, toSaleDtos, voidSale } from './books.service';
import { authenticate, requireAuth } from '../../middleware/auth';
import { writeLimiter } from '../../middleware/rateLimit';
import { canSeeFinance, requireShopAccess, type ShopAccess } from '../../services/access';
import { audit } from '../../services/audit';
import { parentId, parse, paramId } from '../../utils/validate';
import { escapeRegex, forbidden, notFound, ok, pageMeta, paginated, skipFor } from '../../utils/http';

/** The shop's books (mounted at /shops/:shopId/books). Bookkeeping stays available while a shop is suspended. */
export const booksRouter = Router({ mergeParams: true });
booksRouter.use(authenticate);

async function access(req: Request) {
  return requireShopAccess(requireAuth(req), parentId(req, 'shopId'), 'any', { allowSuspended: true });
}
const has = (a: ShopAccess, p: ShopPermission) => a.isOwner || a.permissions.includes(p);

function requireAny(a: ShopAccess, perms: ShopPermission[], message: string) {
  if (!perms.some((p) => has(a, p))) throw forbidden(message, 'MISSING_SHOP_PERMISSION');
}
function requireFinance(a: ShopAccess) {
  if (!canSeeFinance(a)) throw forbidden('Only the owner and staff with finance access can see this', 'MISSING_SHOP_PERMISSION');
}

/** The shop home: today's figures, what needs attention, and advice. Content depends on the role. */
booksRouter.get('/dashboard', async (req, res) => {
  const a = await access(req);
  ok(res, await shopDashboard(a.shop._id, { finance: canSeeFinance(a), sales: has(a, 'sales.record') || has(a, 'reports.view'), operations: true }));
});

/** How long each product's stock will last and how much to reorder. */
booksRouter.get('/forecast', async (req, res) => {
  const a = await access(req);
  requireAny(a, ['inventory.manage', 'products.manage', 'finance.view'], 'Your role does not include inventory');
  ok(res, await stockForecasts(a.shop._id, { finance: canSeeFinance(a) }));
});

booksRouter.get('/summary', async (req, res) => {
  const a = await access(req);
  requireFinance(a);
  const { period } = parse(booksPeriodSchema, req.query);
  ok(res, await booksSummary(a.shop._id, period));
});

/* Sales ----------------------------------------------------------------------------------------------- */

booksRouter.get('/sales', async (req, res) => {
  const a = await access(req);
  requireAny(a, ['sales.record', 'finance.view'], 'Your role does not include the sales book');
  const q = parse(salesListSchema, req.query);
  const filter: Record<string, unknown> = { shopId: a.shop._id };
  if (q.period) {
    const r = periodRange(q.period);
    filter.soldAt = { $gte: r.from, $lt: r.to };
  }
  if (q.owing) Object.assign(filter, { status: 'completed', balanceKobo: { $gt: 0 } });
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ customerName: rx }, { customerPhone: rx }, { number: rx }, { 'items.name': rx }];
  }
  const [items, total] = await Promise.all([
    ShopSale.find(filter).sort({ soldAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    ShopSale.countDocuments(filter),
  ]);
  paginated(res, await toSaleDtos(items as any, { finance: canSeeFinance(a) }), pageMeta(q.page, q.limit, total));
});

booksRouter.post('/sales', writeLimiter, async (req, res) => {
  const a = await access(req);
  requireAny(a, ['sales.record'], 'Your role does not include recording sales');
  const input = parse(saleCreateSchema, req.body);
  const sale = await recordSale(a.shop._id, requireAuth(req).userId, input);
  await audit({ req, action: 'sale.recorded', category: 'order', targetType: 'sale', targetId: sale._id, shopId: a.shop._id, metadata: { totalKobo: sale.totalKobo, balanceKobo: sale.balanceKobo } });
  const [dto] = await toSaleDtos([sale.toObject() as any], { finance: canSeeFinance(a) });
  ok(res, dto, 201);
});

booksRouter.get('/sales/:saleId', async (req, res) => {
  const a = await access(req);
  requireAny(a, ['sales.record', 'finance.view'], 'Your role does not include the sales book');
  const sale = await ShopSale.findOne({ _id: paramId(req.params.saleId, 'saleId'), shopId: a.shop._id }).lean();
  if (!sale) throw notFound('Sale');
  const [dto] = await toSaleDtos([sale as any], { finance: canSeeFinance(a) });
  ok(res, dto);
});

/** Money received later from a customer who bought on credit. */
booksRouter.post('/sales/:saleId/payments', writeLimiter, async (req, res) => {
  const a = await access(req);
  requireAny(a, ['sales.record'], 'Your role does not include recording sales');
  const input = parse(salePaymentSchema, req.body);
  const sale = await recordSalePayment(a.shop._id, paramId(req.params.saleId, 'saleId'), requireAuth(req).userId, input);
  if (!sale) throw notFound('Sale');
  await audit({ req, action: 'sale.payment_recorded', category: 'order', targetType: 'sale', targetId: sale._id, shopId: a.shop._id, metadata: { amountKobo: input.amountKobo } });
  const [dto] = await toSaleDtos([sale.toObject() as any], { finance: canSeeFinance(a) });
  ok(res, dto);
});

/** Cancels a sale entered by mistake. Owner / finance only, because it changes the money figures. */
booksRouter.post('/sales/:saleId/void', writeLimiter, async (req, res) => {
  const a = await access(req);
  requireFinance(a);
  const { reason } = parse(voidSchema, req.body);
  const sale = await voidSale(a.shop._id, paramId(req.params.saleId, 'saleId'), requireAuth(req).userId, reason);
  if (!sale) throw notFound('Sale');
  await audit({ req, action: 'sale.voided', category: 'order', targetType: 'sale', targetId: sale._id, shopId: a.shop._id, metadata: { reason } });
  const [dto] = await toSaleDtos([sale.toObject() as any], { finance: true });
  ok(res, dto);
});

/* Expenses -------------------------------------------------------------------------------------------- */

booksRouter.get('/expenses', async (req, res) => {
  const a = await access(req);
  requireFinance(a);
  const q = parse(expensesListSchema, req.query);
  const filter: Record<string, unknown> = { shopId: a.shop._id };
  if (q.period) {
    const r = periodRange(q.period);
    filter.spentAt = { $gte: r.from, $lt: r.to };
  }
  const [items, total] = await Promise.all([
    ShopExpense.find(filter).sort({ spentAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    ShopExpense.countDocuments(filter),
  ]);
  paginated(res, await toExpenseDtos(items as any), pageMeta(q.page, q.limit, total));
});

booksRouter.post('/expenses', writeLimiter, async (req, res) => {
  const a = await access(req);
  requireFinance(a);
  const input = parse(expenseCreateSchema, req.body);
  const spentAt = input.spentAt ?? new Date();
  if (spentAt.getTime() > Date.now() + 5 * 60_000) throw forbidden('The date can’t be in the future', 'INVALID_DATE');
  const e = await ShopExpense.create({ ...input, spentAt, shopId: a.shop._id, recordedBy: requireAuth(req).userId });
  await audit({ req, action: 'expense.recorded', category: 'shop', targetType: 'expense', targetId: e._id, shopId: a.shop._id, metadata: { amountKobo: e.amountKobo, category: e.category } });
  const [dto] = await toExpenseDtos([e.toObject() as any]);
  ok(res, dto, 201);
});

booksRouter.post('/expenses/:expenseId/void', writeLimiter, async (req, res) => {
  const a = await access(req);
  requireFinance(a);
  const { reason } = parse(voidSchema, req.body);
  const e = await ShopExpense.findOneAndUpdate({ _id: paramId(req.params.expenseId, 'expenseId'), shopId: a.shop._id, status: 'active' }, { $set: { status: 'voided', voidReason: reason } }, { new: true });
  if (!e) throw notFound('Expense');
  await audit({ req, action: 'expense.voided', category: 'shop', targetType: 'expense', targetId: e._id, shopId: a.shop._id, metadata: { reason } });
  const [dto] = await toExpenseDtos([e.toObject() as any]);
  ok(res, dto);
});
