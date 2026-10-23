import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  RESELLER_STATUSES,
  booksPeriodSchema,
  paginationSchema,
  resellerApplySchema,
  resellerDecisionSchema,
  resellerListingCreateSchema,
  resellerListingUpdateSchema,
  resellerProfileUpdateSchema,
  resellerRequestSchema,
  resellerRequestStatusSchema,
  resellerSaleCreateSchema,
  salePaymentSchema,
  voidSchema,
  formatNaira,
} from '@kkdm/shared';
import { Reseller, ResellerListing, ResellerRequest, ResellerSale } from './reseller.models';
import { publicListings, recordResellerSale, resellerSummary, toListingDtos, toRequestDtos, toResellerMe, toResellerPublic, toResellerSaleDto, uniqueResellerSlug } from './reseller.service';
import { Product } from '../products/product.models';
import { isPubliclyVisible } from '../products/product.service';
import { User } from '../users/user.model';
import { notify } from '../notifications/notify';
import { authenticate, optionalAuth, requireAuth, requirePlatformRole } from '../../middleware/auth';
import { writeLimiter } from '../../middleware/rateLimit';
import { audit } from '../../services/audit';
import { parse, paramId } from '../../utils/validate';
import { badRequest, conflict, forbidden, notFound, ok, pageMeta, paginated, skipFor } from '../../utils/http';
import { periodRange } from '../books/books.service';

/* Reseller's own account (/resellers) ------------------------------------------------------------ */

export const resellersRouter = Router();

async function myReseller(req: Request) {
  const r = await Reseller.findOne({ userId: requireAuth(req).userId });
  if (!r) throw notFound('Reseller account');
  return r;
}
async function approved(req: Request) {
  const r = await myReseller(req);
  if (r.status !== 'approved') throw forbidden(r.status === 'pending' ? 'Your reseller application is still being reviewed' : 'Your reseller account is not active', 'RESELLER_NOT_APPROVED');
  return r;
}

resellersRouter.post('/apply', authenticate, writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(resellerApplySchema, req.body);
  const existing = await Reseller.findOne({ userId: a.userId });
  if (existing && existing.status !== 'rejected') throw conflict(existing.status === 'pending' ? 'Your application is already being reviewed' : 'You already have a reseller account', 'ALREADY_APPLIED');
  const r = existing ?? new Reseller({ userId: a.userId });
  r.set({ ...input, status: 'pending', decisionReason: undefined });
  if (!r.slug || existing?.businessName !== input.businessName) r.slug = await uniqueResellerSlug(input.businessName, r._id);
  await r.save();
  await audit({ req, action: 'reseller.applied', category: 'account', targetType: 'reseller', targetId: r._id });
  const admins = await User.find({ platformRoles: 'admin', status: 'active' }).select('_id').lean();
  await notify(
    admins.map((u) => u._id),
    { type: 'reseller.updated', title: 'New reseller application', body: `${input.businessName} wants to become a reseller.`, data: { resellerId: String(r._id) }, dedupeKey: `reseller-apply:${r._id}:${Date.now()}` },
  );
  ok(res, await toResellerMe(r.toObject() as any), 201);
});

resellersRouter.get('/me', authenticate, async (req, res) => {
  ok(res, await toResellerMe((await myReseller(req)).toObject() as any));
});

resellersRouter.patch('/me', authenticate, writeLimiter, async (req, res) => {
  const r = await myReseller(req);
  const input = parse(resellerProfileUpdateSchema, req.body);
  if (input.businessName && input.businessName !== r.businessName) r.slug = await uniqueResellerSlug(input.businessName, r._id);
  r.set(input);
  await r.save();
  ok(res, await toResellerMe(r.toObject() as any));
});

resellersRouter.get('/me/summary', authenticate, async (req, res) => {
  const r = await approved(req);
  const { period } = parse(booksPeriodSchema, req.query);
  ok(res, await resellerSummary(r.toObject() as any, period));
});

/* Listings ("Add to my products") */

resellersRouter.get('/me/listings', authenticate, async (req, res) => {
  const r = await approved(req);
  const { page, limit } = parse(paginationSchema, req.query);
  const filter = { resellerId: r._id };
  const [items, total] = await Promise.all([ResellerListing.find(filter).sort({ updatedAt: -1 }).skip(skipFor(page, limit)).limit(limit).lean(), ResellerListing.countDocuments(filter)]);
  paginated(res, await toListingDtos(items as any, { owner: true }), pageMeta(page, limit, total));
});

resellersRouter.post('/me/listings', authenticate, writeLimiter, async (req, res) => {
  const r = await approved(req);
  const input = parse(resellerListingCreateSchema, req.body);
  const p = await Product.findById(input.productId).lean();
  if (!p || !isPubliclyVisible(p)) throw notFound('Product');
  if (p.resellerPriceKobo == null) throw badRequest('This shop does not offer this product for reselling', 'NOT_RESELLABLE');
  if (input.priceKobo < p.resellerPriceKobo) throw badRequest(`Your price can’t be below the reseller price of ${formatNaira(p.resellerPriceKobo)}`, 'PRICE_BELOW_COST');
  if (await ResellerListing.exists({ resellerId: r._id, productId: p._id })) throw conflict('This product is already in your list — change its price there', 'ALREADY_LISTED');
  const l = await ResellerListing.create({ resellerId: r._id, productId: p._id, shopId: p.shopId, priceKobo: input.priceKobo, note: input.note });
  await audit({ req, action: 'reseller.listing_created', category: 'product', targetType: 'reseller_listing', targetId: l._id, metadata: { productId: String(p._id), priceKobo: input.priceKobo } });
  const [dto] = await toListingDtos([l.toObject() as any], { owner: true });
  ok(res, dto, 201);
});

resellersRouter.patch('/me/listings/:listingId', authenticate, writeLimiter, async (req, res) => {
  const r = await approved(req);
  const input = parse(resellerListingUpdateSchema, req.body);
  const l = await ResellerListing.findOne({ _id: paramId(req.params.listingId, 'listingId'), resellerId: r._id });
  if (!l) throw notFound('Listing');
  if (input.priceKobo !== undefined) {
    const p = await Product.findById(l.productId).select('resellerPriceKobo').lean();
    if (p?.resellerPriceKobo != null && input.priceKobo < p.resellerPriceKobo) throw badRequest(`Your price can’t be below the reseller price of ${formatNaira(p.resellerPriceKobo)}`, 'PRICE_BELOW_COST');
  }
  l.set(input);
  await l.save();
  const [dto] = await toListingDtos([l.toObject() as any], { owner: true });
  ok(res, dto);
});

resellersRouter.delete('/me/listings/:listingId', authenticate, async (req, res) => {
  const r = await approved(req);
  const d = await ResellerListing.deleteOne({ _id: paramId(req.params.listingId, 'listingId'), resellerId: r._id });
  if (!d.deletedCount) throw notFound('Listing');
  ok(res, { deleted: true });
});

/* Customer requests */

resellersRouter.get('/me/requests', authenticate, async (req, res) => {
  const r = await approved(req);
  const q = parse(paginationSchema.extend({ status: z.enum(['new', 'accepted', 'declined', 'completed']).optional() }), req.query);
  const filter: Record<string, unknown> = { resellerId: r._id };
  if (q.status) filter.status = q.status;
  const [items, total] = await Promise.all([ResellerRequest.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(), ResellerRequest.countDocuments(filter)]);
  paginated(res, await toRequestDtos(items), pageMeta(q.page, q.limit, total));
});

resellersRouter.post('/me/requests/:requestId/status', authenticate, writeLimiter, async (req, res) => {
  const r = await approved(req);
  const { status } = parse(resellerRequestStatusSchema, req.body);
  const rq = await ResellerRequest.findOneAndUpdate({ _id: paramId(req.params.requestId, 'requestId'), resellerId: r._id }, { $set: { status } }, { new: true }).lean();
  if (!rq) throw notFound('Request');
  if (status === 'accepted' || status === 'declined') {
    await notify([rq.customerId], {
      type: 'reseller.request',
      title: status === 'accepted' ? `${r.businessName} accepted your request` : `${r.businessName} can’t take your request`,
      body: status === 'accepted' ? `They will contact you to arrange payment and delivery. You can also call ${r.phone}.` : 'Try another seller, or contact them for details.',
      data: { listingId: String(rq.listingId) },
      dedupeKey: `reseller-request:${rq._id}:${status}`,
    });
  }
  ok(res, (await toRequestDtos([rq]))[0]);
});

/* Reseller's own sales */

resellersRouter.get('/me/sales', authenticate, async (req, res) => {
  const r = await approved(req);
  const q = parse(paginationSchema.extend({ period: booksPeriodSchema.shape.period.optional(), owing: z.enum(['true', 'false']).optional() }), req.query);
  const filter: Record<string, unknown> = { resellerId: r._id };
  if (q.period) {
    const range = periodRange(q.period);
    filter.soldAt = { $gte: range.from, $lt: range.to };
  }
  if (q.owing === 'true') Object.assign(filter, { status: 'completed', balanceKobo: { $gt: 0 } });
  const [items, total] = await Promise.all([ResellerSale.find(filter).sort({ soldAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(), ResellerSale.countDocuments(filter)]);
  paginated(res, items.map((s) => toResellerSaleDto(s as any)), pageMeta(q.page, q.limit, total));
});

resellersRouter.post('/me/sales', authenticate, writeLimiter, async (req, res) => {
  const r = await approved(req);
  const sale = await recordResellerSale(r.toObject() as any, parse(resellerSaleCreateSchema, req.body));
  ok(res, toResellerSaleDto(sale.toObject() as any), 201);
});

resellersRouter.post('/me/sales/:saleId/payments', authenticate, writeLimiter, async (req, res) => {
  const r = await approved(req);
  const input = parse(salePaymentSchema, req.body);
  const s = await ResellerSale.findOneAndUpdate(
    { _id: paramId(req.params.saleId, 'saleId'), resellerId: r._id, status: 'completed', balanceKobo: { $gte: input.amountKobo } },
    { $push: { payments: { amountKobo: input.amountKobo, method: input.method, at: new Date() } }, $inc: { amountPaidKobo: input.amountKobo, balanceKobo: -input.amountKobo } },
    { new: true },
  ).lean();
  if (!s) throw badRequest('That is more than the customer owes, or the sale was cancelled', 'OVERPAID');
  ok(res, toResellerSaleDto(s as any));
});

resellersRouter.post('/me/sales/:saleId/void', authenticate, writeLimiter, async (req, res) => {
  const r = await approved(req);
  const { reason } = parse(voidSchema, req.body);
  const s = await ResellerSale.findOneAndUpdate({ _id: paramId(req.params.saleId, 'saleId'), resellerId: r._id, status: 'completed' }, { $set: { status: 'voided', note: reason } }, { new: true }).lean();
  if (!s) throw notFound('Sale');
  ok(res, toResellerSaleDto(s as any));
});

/** A reseller's public page: who they are and what they sell (only listings customers can buy). */
resellersRouter.get('/:slug', async (req, res) => {
  const r = await Reseller.findOne({ slug: String(req.params.slug).toLowerCase(), status: 'approved' }).lean();
  if (!r) throw notFound('Reseller');
  const { page, limit } = parse(paginationSchema, req.query);
  const { items, total } = await publicListings({ resellerId: r._id }, page, limit);
  ok(res, { reseller: await toResellerPublic(r as any), listings: items, meta: pageMeta(page, limit, total) });
});

/* Public listings (/reseller-listings) ----------------------------------------------------------- */

export const resellerListingsRouter = Router();

resellerListingsRouter.get('/', async (req, res) => {
  const q = parse(paginationSchema.extend({ q: z.string().trim().max(80).optional() }), req.query);
  const { items, total } = await publicListings({ q: q.q }, q.page, q.limit);
  paginated(res, items, pageMeta(q.page, q.limit, total));
});

resellerListingsRouter.get('/:listingId', optionalAuth, async (req, res) => {
  const l = await ResellerListing.findById(paramId(req.params.listingId, 'listingId')).lean();
  if (!l) throw notFound('Product');
  const owner = req.auth ? !!(await Reseller.exists({ _id: l.resellerId, userId: req.auth.userId })) : false;
  const [dto] = await toListingDtos([l as any], { owner });
  if (!dto.available && !owner) throw notFound('Product');
  ok(res, dto);
});

/** "I want to buy": goes to the reseller with the customer's contact; payment is arranged between them. */
resellerListingsRouter.post('/:listingId/requests', authenticate, writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(resellerRequestSchema, req.body);
  const l = await ResellerListing.findById(paramId(req.params.listingId, 'listingId')).lean();
  if (!l) throw notFound('Product');
  const [dto] = await toListingDtos([l as any]);
  if (!dto.available) throw badRequest('This product is not available from this seller right now', 'LISTING_UNAVAILABLE');
  const r = await Reseller.findById(l.resellerId).lean();
  if (String(r!.userId) === a.userId) throw badRequest('This is your own product', 'OWN_LISTING');
  const rq = await ResellerRequest.create({ resellerId: l.resellerId, listingId: l._id, customerId: a.userId, quantity: input.quantity, note: input.note, phone: input.phone });
  const customer = await User.findById(a.userId).select('fullName').lean();
  await notify([r!.userId], {
    type: 'reseller.request',
    title: 'New customer request',
    body: `${customer?.fullName ?? 'A customer'} wants ${input.quantity} ${dto.product.unit} of ${dto.product.name}.`,
    data: { requestId: String(rq._id) },
    dedupeKey: `reseller-request:${rq._id}:new`,
  });
  ok(res, (await toRequestDtos([rq.toObject()]))[0], 201);
});

/* Admin (/admin/resellers) ------------------------------------------------------------------------ */

export const resellerAdminRouter = Router();
resellerAdminRouter.use(authenticate, requirePlatformRole('admin'));

resellerAdminRouter.get('/', async (req, res) => {
  const q = parse(paginationSchema.extend({ status: z.enum(RESELLER_STATUSES).optional() }), req.query);
  const filter = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([Reseller.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(), Reseller.countDocuments(filter)]);
  const users = await User.find({ _id: { $in: items.map((r) => r.userId) } }).select('fullName email phone').lean();
  paginated(
    res,
    await Promise.all(
      items.map(async (r) => {
        const u = users.find((x) => String(x._id) === String(r.userId));
        return { ...(await toResellerMe(r as any)), user: { id: String(r.userId), fullName: u?.fullName ?? '', email: u?.email ?? undefined, phone: u?.phone ?? undefined } };
      }),
    ),
    pageMeta(q.page, q.limit, total),
  );
});

resellerAdminRouter.post('/:resellerId/decision', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { decision, reason } = parse(resellerDecisionSchema, req.body);
  if ((decision === 'reject' || decision === 'suspend') && !reason) throw badRequest('Give a reason the applicant can act on', 'REASON_REQUIRED');
  const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'suspended';
  const r = await Reseller.findByIdAndUpdate(paramId(req.params.resellerId, 'resellerId'), { $set: { status, decisionReason: reason, decidedBy: a.userId, decidedAt: new Date() } }, { new: true }).lean();
  if (!r) throw notFound('Reseller');
  await audit({ req, action: `reseller.${status}`, category: 'admin', targetType: 'reseller', targetId: r._id, metadata: { reason } });
  await notify([r.userId], {
    type: 'reseller.updated',
    title: status === 'approved' ? 'You are now a reseller' : status === 'rejected' ? 'Reseller application not approved' : 'Reseller account suspended',
    body: status === 'approved' ? 'You can now see reseller prices and add products to your list at your own price.' : (reason ?? ''),
    data: { resellerId: String(r._id) },
    dedupeKey: `reseller-decision:${r._id}:${status}:${Date.now()}`,
  });
  ok(res, await toResellerMe(r as any));
});
