import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { ORDER_STATUSES, PLATFORM_ROLES, PROMOTION_TYPES, SUBSCRIPTION_PLANS, normalizePhone, objectId, paginationSchema, promotionSchema } from '@kkdm/shared';
import { Announcement, AuditLog, PlatformSetting } from './admin.models';
import { User } from '../users/user.model';
import { toUserDto } from '../users/user.service';
import { Shop, ShopMembership } from '../shops/shop.models';
import { refreshShopListing, toShopSummaries } from '../shops/shop.service';
import { House, HouseMembership, HouseStaff, Market, MarketSection } from '../markets/market.models';
import { decideMembership, recountHouseShops, toMembershipDtos } from '../houses/house.service';
import { HouseInvitation, ShopInvitation } from '../invitations/invitation.models';
import { Product } from '../products/product.models';
import { toProductSummaries } from '../products/product.service';
import { syncProductEmbeddingFilters } from '../visual-search/embedding.service';
import { Order } from '../orders/order.models';
import { toOrderDtos, transitionOrder } from '../orders/order.service';
import { Payment, Refund } from '../payments/payment.models';
import { paymentProvider } from '../payments/providers';
import { markRefundCompleted, toPaymentDto } from '../payments/payment.service';
import { Report, VerificationRequest } from '../reports/trust.models';
import { Message } from '../chats/chat.models';
import { Review } from '../reviews/review.model';
import { recomputeRatings } from '../reviews/reviews.routes';
import { Promotion, SubscriptionEntitlement } from '../promotions/promotion.models';
import { toPromotionDto } from '../promotions/promotions.routes';
import { revokeAllSessions } from '../auth/tokens';
import { notify } from '../notifications/notify';
import { authenticate, requireAuth, requirePlatformRole } from '../../middleware/auth';
import { assertMarketScope, isAdmin, marketScopeFilter } from '../../services/access';
import { audit } from '../../services/audit';
import { parse, paramId } from '../../utils/validate';
import { badRequest, conflict, escapeRegex, forbidden, iso, notFound, ok, pageMeta, paginated, skipFor } from '../../utils/http';

export const adminRouter = Router();
adminRouter.use(authenticate, requirePlatformRole('admin', 'market_manager'));
const adminOnly = requirePlatformRole('admin');

/* Dashboard ----------------------------------------------------------------------------------- */

adminRouter.get('/dashboard', async (req, res) => {
  const a = requireAuth(req);
  const scope = marketScopeFilter(a);
  const day = new Date(Date.now() - 86_400_000);
  const month = new Date(Date.now() - 30 * 86_400_000);
  const [users, houses, shopsByStatus, products, ordersByStatus, payments, openReports, pendingVerifications, failedInvites, bySection, byHouse, pendingMemberships] = await Promise.all([
    isAdmin(a) ? User.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]) : Promise.resolve([]),
    House.countDocuments({ ...scope, status: 'active' }),
    Shop.aggregate([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Product.countDocuments({ ...scope, status: 'published', shopListed: true }),
    Order.aggregate([{ $match: { ...scope, createdAt: { $gte: month } } }, { $group: { _id: '$status', n: { $sum: 1 }, value: { $sum: '$totalKobo' } } }]),
    isAdmin(a) ? Payment.aggregate([{ $match: { createdAt: { $gte: month } } }, { $group: { _id: '$status', n: { $sum: 1 }, total: { $sum: '$amountKobo' } } }]) : Promise.resolve([]),
    Report.countDocuments({ ...scope, status: { $in: ['open', 'investigating'] } }),
    VerificationRequest.countDocuments({ ...scope, status: { $in: ['pending', 'appealed'] } }),
    AuditLog.countDocuments({ action: { $in: ['invitation.house_redeem', 'invitation.worker_redeem'] }, outcome: 'failure', createdAt: { $gte: day } }),
    Shop.aggregate([{ $match: { ...scope, status: 'active' } }, { $group: { _id: '$sectionId', shops: { $sum: 1 } } }, { $sort: { shops: -1 } }, { $limit: 20 }]),
    Order.aggregate([{ $match: { ...scope, createdAt: { $gte: month } } }, { $group: { _id: '$houseId', orders: { $sum: 1 }, value: { $sum: '$totalKobo' } } }, { $sort: { orders: -1 } }, { $limit: 10 }]),
    HouseMembership.countDocuments({ status: 'pending' }),
  ]);
  const sections = await MarketSection.find({ _id: { $in: bySection.map((s) => s._id).filter(Boolean) } }).select('name code').lean();
  const hs = await House.find({ _id: { $in: byHouse.map((h) => h._id) } }).select('houseNumber name').lean();
  const toObj = (arr: any[], key = 'n') => Object.fromEntries(arr.map((x) => [x._id ?? 'none', x[key]]));
  ok(res, {
    users: isAdmin(a) ? toObj(users) : null,
    houses,
    shops: toObj(shopsByStatus),
    publishedProducts: products,
    orders30d: { counts: toObj(ordersByStatus), valueKobo: toObj(ordersByStatus, 'value') },
    payments30d: isAdmin(a) ? { counts: toObj(payments), totalKobo: toObj(payments, 'total') } : null,
    queues: { openReports, pendingVerifications, pendingMemberships },
    invitationAbuse: { failedAttempts24h: failedInvites },
    activityBySection: bySection.map((s) => {
      const sec = sections.find((x) => String(x._id) === String(s._id));
      return { sectionId: s._id ? String(s._id) : null, name: sec ? `${sec.code} · ${sec.name}` : 'No section', shops: s.shops };
    }),
    activityByHouse: byHouse.map((h) => {
      const house = hs.find((x) => String(x._id) === String(h._id));
      return { houseId: String(h._id), houseNumber: house?.houseNumber ?? '', orders: h.orders, valueKobo: h.value };
    }),
  });
});

/* Users & roles ------------------------------------------------------------------------------- */

adminRouter.get('/users', adminOnly, async (req, res) => {
  const q = parse(paginationSchema.extend({ q: z.string().trim().max(80).optional(), role: z.enum(PLATFORM_ROLES).optional(), status: z.enum(['active', 'suspended', 'deleted']).optional() }), req.query);
  const filter: Record<string, unknown> = {};
  if (q.role) filter.platformRoles = q.role;
  if (q.status) filter.status = q.status;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ fullName: rx }, { email: rx }, { phone: rx }];
  }
  const [items, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(), User.countDocuments(filter)]);
  paginated(res, items.map(toUserDto), pageMeta(q.page, q.limit, total));
});

adminRouter.get('/users/:id', adminOnly, async (req, res) => {
  const u = await User.findById(paramId(req.params.id)).lean();
  if (!u) throw notFound('User');
  const [shops, houses, orders, reports] = await Promise.all([
    ShopMembership.find({ userId: u._id }).lean(),
    HouseStaff.find({ userId: u._id }).lean(),
    Order.countDocuments({ customerId: u._id }),
    Report.countDocuments({ targetType: 'user', targetId: u._id }),
  ]);
  ok(res, {
    ...toUserDto(u),
    suspendedReason: u.suspendedReason,
    lastLoginAt: iso(u.lastLoginAt),
    shopMemberships: shops.map((m) => ({ shopId: String(m.shopId), role: m.role, status: m.status, permissions: m.permissions })),
    houseRoles: houses.map((h) => ({ houseId: String(h.houseId), role: h.role, status: h.status })),
    orderCount: orders,
    reportsAgainst: reports,
  });
});

adminRouter.post('/users/:id/suspend', adminOnly, async (req, res) => {
  const a = requireAuth(req);
  const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), req.body);
  const id = paramId(req.params.id);
  if (id === a.userId) throw badRequest('You cannot suspend yourself');
  const u = await User.findById(id);
  if (!u || u.status === 'deleted') throw notFound('User');
  u.set({ status: 'suspended', suspendedReason: reason, suspendedAt: new Date() });
  await u.save();
  await revokeAllSessions(u._id, 'suspended');
  await audit({ req, action: 'admin.user_suspended', category: 'admin', targetType: 'user', targetId: u._id, reason });
  ok(res, toUserDto(u.toObject()));
});

adminRouter.post('/users/:id/reactivate', adminOnly, async (req, res) => {
  const u = await User.findById(paramId(req.params.id));
  if (!u || u.status !== 'suspended') throw notFound('Suspended user');
  u.set({ status: 'active', suspendedReason: undefined, suspendedAt: undefined });
  await u.save();
  await audit({ req, action: 'admin.user_reactivated', category: 'admin', targetType: 'user', targetId: u._id });
  ok(res, toUserDto(u.toObject()));
});

adminRouter.put('/users/:id/roles', adminOnly, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(z.object({ platformRoles: z.array(z.enum(PLATFORM_ROLES)), managedMarketIds: z.array(objectId).default([]), managedSectionIds: z.array(objectId).default([]), reason: z.string().trim().max(300).optional() }), req.body);
  const id = paramId(req.params.id);
  if (id === a.userId && !input.platformRoles.includes('admin')) throw badRequest('You cannot remove your own administrator role');
  if (input.platformRoles.includes('market_manager') && !input.managedMarketIds.length && !input.managedSectionIds.length) {
    throw badRequest('Assign at least one market or section to a market manager');
  }
  if ((await Market.countDocuments({ _id: { $in: input.managedMarketIds } })) !== input.managedMarketIds.length) throw badRequest('Unknown market');
  if ((await MarketSection.countDocuments({ _id: { $in: input.managedSectionIds } })) !== input.managedSectionIds.length) throw badRequest('Unknown section');
  const u = await User.findById(id);
  if (!u || u.status !== 'active') throw notFound('Active user');
  const before = { roles: [...u.platformRoles], markets: u.managedMarketIds.map(String) };
  u.set({ platformRoles: input.platformRoles, managedMarketIds: input.managedMarketIds, managedSectionIds: input.managedSectionIds });
  await u.save();
  await audit({ req, action: 'admin.roles_changed', category: 'admin', targetType: 'user', targetId: u._id, reason: input.reason, metadata: { before, after: input } });
  ok(res, toUserDto(u.toObject()));
});

/* Shops --------------------------------------------------------------------------------------- */

adminRouter.get('/shops', async (req, res) => {
  const a = requireAuth(req);
  const q = parse(paginationSchema.extend({ q: z.string().trim().max(80).optional(), status: z.string().max(30).optional(), verificationStatus: z.string().max(20).optional(), houseId: objectId.optional() }), req.query);
  const filter: Record<string, unknown> = { ...marketScopeFilter(a) };
  if (q.status) filter.status = q.status;
  if (q.verificationStatus) filter.verificationStatus = q.verificationStatus;
  if (q.houseId) filter.houseId = q.houseId;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$and = [{ $or: [{ name: rx }, { shopCode: rx }, { shopNumber: rx }] }];
  }
  const [items, total] = await Promise.all([Shop.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(), Shop.countDocuments(filter)]);
  const summaries = await toShopSummaries(items as any);
  paginated(res, summaries.map((s, i) => ({ ...s, status: items[i].status, ownerId: String(items[i].ownerId), ownershipVerificationStatus: items[i].ownershipVerificationStatus })), pageMeta(q.page, q.limit, total));
});

adminRouter.patch('/shops/:id', async (req, res) => {
  const shop = await Shop.findById(paramId(req.params.id));
  if (!shop) throw notFound('Shop');
  assertMarketScope(req.auth, { marketId: shop.marketId, sectionId: shop.sectionId });
  const input = parse(
    z.object({
      status: z.enum(['active', 'suspended']).optional(),
      verificationStatus: z.enum(['unverified', 'pending', 'verified', 'rejected']).optional(),
      ownershipVerificationStatus: z.enum(['unverified', 'pending', 'verified', 'rejected']).optional(),
      reason: z.string().trim().min(3).max(500),
    }),
    req.body,
  );
  if (input.status === 'active' && shop.status === 'suspended') {
    if (!(await HouseMembership.exists({ shopId: shop._id, status: 'approved', live: true }))) throw conflict('The shop has no approved house membership', 'NO_MEMBERSHIP');
  } else if (input.status === 'active' && shop.status !== 'active') throw conflict('Only suspended shops can be reactivated here');
  if (input.status) shop.set({ status: input.status, suspendedReason: input.status === 'suspended' ? input.reason : undefined });
  if (input.verificationStatus) shop.verificationStatus = input.verificationStatus;
  if (input.ownershipVerificationStatus) shop.ownershipVerificationStatus = input.ownershipVerificationStatus;
  await shop.save();
  await refreshShopListing(shop._id);
  await recountHouseShops(shop.houseId);
  await audit({ req, action: 'admin.shop_updated', category: 'admin', targetType: 'shop', targetId: shop._id, shopId: shop._id, reason: input.reason, metadata: { ...input } });
  await notify([shop.ownerId], { type: 'verification.updated', title: 'Shop status updated', body: `${shop.name}: ${input.reason}`, data: { shopId: String(shop._id) } });
  ok(res, { id: String(shop._id), status: shop.status, verificationStatus: shop.verificationStatus });
});

adminRouter.post('/shops/:id/entitlements', adminOnly, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(z.object({ plan: z.enum(SUBSCRIPTION_PLANS), features: z.array(z.string().max(40)).max(20).default([]), endsAt: z.coerce.date().optional(), note: z.string().max(300).optional() }), req.body);
  const shop = await Shop.findById(paramId(req.params.id));
  if (!shop) throw notFound('Shop');
  await SubscriptionEntitlement.updateMany({ shopId: shop._id, status: 'active' }, { $set: { status: 'cancelled' } });
  const e = await SubscriptionEntitlement.create({ shopId: shop._id, plan: input.plan, features: input.features, startsAt: new Date(), endsAt: input.endsAt ?? null, grantedBy: a.userId, note: input.note });
  shop.subscriptionPlan = input.plan;
  await shop.save();
  await audit({ req, action: 'admin.entitlement_granted', category: 'admin', targetType: 'shop', targetId: shop._id, shopId: shop._id, metadata: { plan: input.plan } });
  ok(res, { id: String(e._id), plan: e.plan, status: e.status }, 201);
});

/* Verification queue -------------------------------------------------------------------------- */

adminRouter.get('/verifications', async (req, res) => {
  const a = requireAuth(req);
  const q = parse(paginationSchema.extend({ status: z.enum(['pending', 'approved', 'rejected', 'appealed', 'withdrawn']).optional(), type: z.string().max(30).optional() }), req.query);
  const filter: Record<string, unknown> = { ...marketScopeFilter(a), status: q.status ?? { $in: ['pending', 'appealed'] } };
  if (q.type) filter.type = q.type;
  const [items, total] = await Promise.all([VerificationRequest.find(filter).sort({ createdAt: 1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(), VerificationRequest.countDocuments(filter)]);
  const users = await User.find({ _id: { $in: items.flatMap((v) => [v.requestedBy, v.proposedOwnerId].filter(Boolean)) } }).select('fullName email phone').lean();
  const houses = await House.find({ _id: { $in: items.map((v) => v.targetId) } }).select('houseNumber name').lean();
  const shops = await Shop.find({ _id: { $in: items.map((v) => v.targetId) } }).select('name shopNumber').lean();
  const name = (id: unknown) => users.find((u) => String(u._id) === String(id));
  paginated(
    res,
    items.map((v) => ({
      id: String(v._id),
      type: v.type,
      targetId: String(v.targetId),
      targetLabel: (() => {
        const h = houses.find((x) => String(x._id) === String(v.targetId));
        if (h) return `House ${h.houseNumber} · ${h.name}`;
        const s = shops.find((x) => String(x._id) === String(v.targetId));
        return s ? `${s.name} (Shop ${s.shopNumber})` : String(v.targetId);
      })(),
      requestedBy: { id: String(v.requestedBy), fullName: name(v.requestedBy)?.fullName, phone: name(v.requestedBy)?.phone, email: name(v.requestedBy)?.email },
      proposedOwner: v.proposedOwnerId ? { id: String(v.proposedOwnerId), fullName: name(v.proposedOwnerId)?.fullName } : null,
      evidence: v.evidence,
      documentUrls: v.documentUrls,
      status: v.status,
      appeal: v.appeal?.statement ? { statement: v.appeal.statement, at: iso(v.appeal.at) } : null,
      decisionReason: v.decisionReason,
      history: (v.history ?? []).map((h: any) => ({ status: h.status, note: h.note, at: iso(h.at) })),
      createdAt: iso(v.createdAt),
    })),
    pageMeta(q.page, q.limit, total),
  );
});

adminRouter.post('/verifications/:id/decision', async (req, res) => {
  const a = requireAuth(req);
  const input = parse(z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().min(3).max(1000) }), req.body);
  const vr = await VerificationRequest.findById(paramId(req.params.id));
  if (!vr) throw notFound('Verification request');
  if (!['pending', 'appealed'].includes(vr.status)) throw conflict('This request has already been decided');
  if (vr.marketId) assertMarketScope(a, { marketId: vr.marketId });
  else if (!isAdmin(a)) throw forbidden();
  const approve = input.decision === 'approve';
  const status = approve ? 'verified' : 'rejected';

  switch (vr.type) {
    case 'house':
      await House.updateOne({ _id: vr.targetId }, { $set: { verificationStatus: status } });
      break;
    case 'house_head': {
      const house = await House.findById(vr.targetId);
      if (!house) throw notFound('House');
      if (approve) {
        if (house.headUserId && String(house.headUserId) !== String(vr.requestedBy)) throw conflict('Another user is already head of this house; remove them first');
        if (!house.headUserId) {
          await HouseStaff.create({ houseId: house._id, userId: vr.requestedBy, role: 'head', assignedBy: a.userId, reason: 'verified claim' });
          house.headUserId = vr.requestedBy;
        }
        house.headVerificationStatus = 'verified';
      } else if (String(house.headUserId) === String(vr.requestedBy)) house.headVerificationStatus = 'rejected';
      await house.save();
      break;
    }
    case 'shop':
      await Shop.updateOne({ _id: vr.targetId }, { $set: { verificationStatus: status } });
      await refreshShopListing(vr.targetId);
      break;
    case 'shop_ownership': {
      const shop = await Shop.findById(vr.targetId);
      if (!shop) throw notFound('Shop');
      if (approve && vr.proposedOwnerId) {
        // Ownership transfer: previous owner's membership is ended, new owner gets the owner membership.
        const previousOwner = shop.ownerId;
        await ShopMembership.updateMany({ shopId: shop._id, userId: { $in: [previousOwner, vr.proposedOwnerId] }, status: 'active' }, { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: a.userId, revokeReason: 'ownership_transfer' } });
        await ShopMembership.create({ shopId: shop._id, userId: vr.proposedOwnerId, role: 'owner', permissions: ['products.manage', 'inventory.manage', 'orders.manage', 'chats.manage', 'quotations.manage', 'reports.view'], addedBy: a.userId });
        shop.ownerId = vr.proposedOwnerId;
        shop.ownershipVerificationStatus = 'verified';
        await audit({ req, action: 'shop.ownership_transferred', category: 'shop', targetType: 'shop', targetId: shop._id, shopId: shop._id, reason: input.reason, metadata: { from: String(previousOwner), to: String(vr.proposedOwnerId) } });
      } else if (!vr.proposedOwnerId) shop.ownershipVerificationStatus = status;
      await shop.save();
      break;
    }
  }
  vr.set({ status: approve ? 'approved' : 'rejected', reviewedBy: a.userId, reviewedAt: new Date(), decisionReason: input.reason });
  vr.history.push({ status: vr.status, actorId: a.userId, note: input.reason } as any);
  await vr.save();
  await audit({ req, action: `verification.${vr.status}`, category: 'trust', targetType: vr.type, targetId: vr.targetId, reason: input.reason });
  await notify([vr.requestedBy], { type: 'verification.updated', title: approve ? 'Verification approved' : 'Verification declined', body: input.reason, data: { verificationId: String(vr._id) }, dedupeKey: `verification:${vr._id}:${vr.status}:${vr.history.length}` });
  ok(res, { id: String(vr._id), status: vr.status });
});

/* Reports & disputes -------------------------------------------------------------------------- */

adminRouter.get('/reports', async (req, res) => {
  const a = requireAuth(req);
  const q = parse(paginationSchema.extend({ status: z.enum(['open', 'investigating', 'resolved', 'dismissed']).optional(), targetType: z.string().max(20).optional() }), req.query);
  const filter: Record<string, unknown> = { ...marketScopeFilter(a), status: q.status ?? { $in: ['open', 'investigating'] } };
  if (q.targetType) filter.targetType = q.targetType;
  const [items, total] = await Promise.all([Report.find(filter).sort({ createdAt: 1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(), Report.countDocuments(filter)]);
  const reporters = await User.find({ _id: { $in: items.map((r) => r.reporterId) } }).select('fullName').lean();
  paginated(
    res,
    items.map((r) => ({
      id: String(r._id),
      reporter: { id: String(r.reporterId), fullName: reporters.find((u) => String(u._id) === String(r.reporterId))?.fullName },
      targetType: r.targetType,
      targetId: String(r.targetId),
      shopId: r.shopId ? String(r.shopId) : null,
      category: r.category,
      description: r.description,
      status: r.status,
      actions: (r.actions ?? []).map((x: any) => ({ action: x.action, note: x.note, at: iso(x.at) })),
      resolution: r.resolution,
      createdAt: iso(r.createdAt),
    })),
    pageMeta(q.page, q.limit, total),
  );
});

/** Reviews the reported content in context (message text is only shown to moderators handling a report). */
adminRouter.get('/reports/:id/context', async (req, res) => {
  const a = requireAuth(req);
  const r = await Report.findById(paramId(req.params.id)).lean();
  if (!r) throw notFound('Report');
  if (r.marketId) assertMarketScope(a, { marketId: r.marketId });
  let context: unknown = null;
  if (r.targetType === 'message') {
    const m = await Message.findById(r.targetId).lean();
    context = m ? { type: m.type, text: m.text, senderSide: m.senderSide, createdAt: iso(m.createdAt), hidden: !!m.hiddenAt } : null;
  } else if (r.targetType === 'review') {
    const rv = await Review.findById(r.targetId).lean();
    context = rv ? { rating: rv.rating, text: rv.text, status: rv.status } : null;
  } else if (r.targetType === 'product') {
    const p = await Product.findById(r.targetId).lean();
    context = p ? (await toProductSummaries([p as any]))[0] : null;
  } else if (r.targetType === 'shop') {
    const s = await Shop.findById(r.targetId).lean();
    context = s ? (await toShopSummaries([s as any]))[0] : null;
  } else if (r.targetType === 'order') {
    const o = await Order.findById(r.targetId).lean();
    context = o ? (await toOrderDtos([o], 'admin'))[0] : null;
  } else if (r.targetType === 'user') {
    const u = await User.findById(r.targetId).lean();
    context = u ? { fullName: u.fullName, status: u.status, createdAt: iso(u.createdAt) } : null;
  }
  await audit({ req, action: 'admin.report_context_viewed', category: 'admin', targetType: 'report', targetId: r._id });
  ok(res, { context });
});

const reportActions = ['investigate', 'resolve', 'dismiss', 'hide_message', 'remove_review', 'flag_product', 'remove_product', 'suspend_shop', 'suspend_user'] as const;

adminRouter.post('/reports/:id/action', async (req, res) => {
  const a = requireAuth(req);
  const input = parse(z.object({ action: z.enum(reportActions), note: z.string().trim().min(3).max(1000) }), req.body);
  const r = await Report.findById(paramId(req.params.id));
  if (!r) throw notFound('Report');
  if (r.marketId) assertMarketScope(a, { marketId: r.marketId });
  switch (input.action) {
    case 'hide_message':
      if (r.targetType !== 'message') throw badRequest('Not a message report');
      await Message.updateOne({ _id: r.targetId }, { $set: { hiddenAt: new Date() } });
      break;
    case 'remove_review': {
      if (r.targetType !== 'review') throw badRequest('Not a review report');
      const rv = await Review.findByIdAndUpdate(r.targetId, { $set: { status: 'removed', moderationReason: input.note } });
      if (rv) await recomputeRatings(rv.shopId, rv.productId);
      break;
    }
    case 'flag_product':
    case 'remove_product': {
      if (r.targetType !== 'product') throw badRequest('Not a product report');
      await Product.updateOne({ _id: r.targetId }, { $set: { moderationStatus: input.action === 'flag_product' ? 'flagged' : 'removed', moderationReason: input.note } });
      await syncProductEmbeddingFilters(r.targetId);
      break;
    }
    case 'suspend_shop': {
      if (!r.shopId) throw badRequest('No shop linked to this report');
      await Shop.updateOne({ _id: r.shopId }, { $set: { status: 'suspended', suspendedReason: input.note } });
      await refreshShopListing(r.shopId);
      break;
    }
    case 'suspend_user': {
      if (!isAdmin(a)) throw forbidden('Only administrators can suspend accounts');
      if (r.targetType !== 'user') throw badRequest('Not a user report');
      await User.updateOne({ _id: r.targetId }, { $set: { status: 'suspended', suspendedReason: input.note, suspendedAt: new Date() } });
      await revokeAllSessions(r.targetId, 'suspended');
      break;
    }
  }
  const nextStatus = input.action === 'investigate' ? 'investigating' : input.action === 'dismiss' ? 'dismissed' : 'resolved';
  r.status = nextStatus;
  r.actions.push({ action: input.action, note: input.note, actorId: a.userId as any, at: new Date() } as any);
  if (nextStatus !== 'investigating') {
    r.resolution = input.note;
    r.resolvedAt = new Date();
  }
  await r.save();
  await audit({ req, action: `admin.report_${input.action}`, category: 'trust', targetType: r.targetType, targetId: r.targetId, shopId: r.shopId, reason: input.note });
  if (nextStatus !== 'investigating') {
    await notify([r.reporterId], { type: 'report.updated', title: 'Report update', body: nextStatus === 'dismissed' ? 'Your report was reviewed and closed.' : 'Your report was reviewed and action was taken.', data: { reportId: String(r._id) }, dedupeKey: `report:${r._id}:${nextStatus}` });
  }
  ok(res, { id: String(r._id), status: r.status });
});

adminRouter.get('/disputes', async (req, res) => {
  const items = await HouseMembership.find({ 'dispute.status': { $in: ['open', 'responded'] } }).sort({ 'dispute.openedAt': 1 }).limit(100).lean();
  const houseIds = items.map((m) => m.houseId);
  const houses = await House.find({ _id: { $in: houseIds } }).lean();
  const a = requireAuth(req);
  const visible = items.filter((m) => {
    const h = houses.find((x) => String(x._id) === String(m.houseId));
    return h && (isAdmin(a) || a.managedMarketIds.includes(String(h.marketId)) || (h.sectionId && a.managedSectionIds.includes(String(h.sectionId))));
  });
  ok(res, await toMembershipDtos(visible));
});

adminRouter.post('/disputes/:membershipId/resolve', async (req, res) => {
  const a = requireAuth(req);
  const input = parse(z.object({ resolution: z.string().trim().min(5).max(1000), reinstate: z.boolean().default(false) }), req.body);
  const m = await HouseMembership.findById(paramId(req.params.membershipId));
  if (!m || !['open', 'responded'].includes(m.dispute?.status ?? '')) throw notFound('Open dispute');
  const house = await House.findById(m.houseId);
  assertMarketScope(a, { marketId: house?.marketId, sectionId: house?.sectionId });
  if (input.reinstate) {
    if (await HouseMembership.exists({ shopId: m.shopId, live: true })) throw conflict('The shop already has an active membership elsewhere');
    // Reinstatement re-opens the membership as pending and approves it through the normal path.
    m.set({ status: 'pending', live: true });
    m.history.push({ status: 'pending', by: a.userId as any, reason: 'dispute reinstatement' } as any);
    await m.save();
    await Shop.updateOne({ _id: m.shopId }, { $set: { houseId: m.houseId, marketId: house!.marketId, sectionId: house!.sectionId, occupiesSlot: true } });
    await decideMembership(m, 'approve', a.userId, `Reinstated after dispute: ${input.resolution}`, req);
  }
  await HouseMembership.updateOne({ _id: m._id }, { $set: { 'dispute.status': 'resolved', 'dispute.resolution': input.resolution } });
  await audit({ req, action: 'admin.dispute_resolved', category: 'house', targetType: 'house_membership', targetId: m._id, houseId: m.houseId, shopId: m.shopId, reason: input.resolution, metadata: { reinstate: input.reinstate } });
  const shop = await Shop.findById(m.shopId).select('ownerId').lean();
  const staff = await HouseStaff.find({ houseId: m.houseId, status: 'active' }).select('userId').lean();
  await notify([...(shop ? [shop.ownerId] : []), ...staff.map((s) => s.userId)], { type: 'membership.updated', title: 'Dispute resolved', body: input.resolution, data: { membershipId: String(m._id) } });
  ok(res, { resolved: true });
});

/* Invitation monitoring ----------------------------------------------------------------------- */

adminRouter.get('/invitations/abuse', async (req, res) => {
  const { hours } = parse(z.object({ hours: z.coerce.number().int().min(1).max(24 * 30).default(24) }), req.query);
  const since = new Date(Date.now() - hours * 3600_000);
  const match = { action: { $in: ['invitation.house_redeem', 'invitation.worker_redeem'] }, outcome: 'failure', createdAt: { $gte: since } };
  const [byActor, byIp, byReason] = await Promise.all([
    AuditLog.aggregate([{ $match: { ...match, actorId: { $ne: null } } }, { $group: { _id: '$actorId', failures: { $sum: 1 }, last: { $max: '$createdAt' } } }, { $sort: { failures: -1 } }, { $limit: 25 }]),
    AuditLog.aggregate([{ $match: match }, { $group: { _id: '$ip', failures: { $sum: 1 }, actors: { $addToSet: '$actorId' }, last: { $max: '$createdAt' } } }, { $sort: { failures: -1 } }, { $limit: 25 }]),
    AuditLog.aggregate([{ $match: match }, { $group: { _id: '$reason', n: { $sum: 1 } } }]),
  ]);
  const users = await User.find({ _id: { $in: byActor.map((x) => x._id) } }).select('fullName status').lean();
  ok(res, {
    hours,
    byUser: byActor.map((x) => ({ userId: String(x._id), fullName: users.find((u) => String(u._id) === String(x._id))?.fullName, status: users.find((u) => String(u._id) === String(x._id))?.status, failures: x.failures, lastAt: iso(x.last) })),
    byIp: byIp.map((x) => ({ ip: x._id, failures: x.failures, distinctUsers: x.actors.filter(Boolean).length, lastAt: iso(x.last) })),
    byReason: Object.fromEntries(byReason.map((x) => [x._id ?? 'unknown', x.n])),
  });
});

adminRouter.get('/invitations', async (req, res) => {
  const q = parse(paginationSchema.extend({ kind: z.enum(['house', 'worker']).default('house'), houseId: objectId.optional(), shopId: objectId.optional() }), req.query);
  const model: any = q.kind === 'house' ? HouseInvitation : ShopInvitation;
  const filter: Record<string, unknown> = {};
  if (q.houseId) filter.houseId = q.houseId;
  if (q.shopId) filter.shopId = q.shopId;
  const [items, total] = await Promise.all([model.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(), model.countDocuments(filter)]);
  paginated(
    res,
    items.map((i: any) => ({ id: String(i._id), houseId: i.houseId ? String(i.houseId) : undefined, shopId: i.shopId ? String(i.shopId) : undefined, codePreview: i.codePreview, status: i.status, expiresAt: iso(i.expiresAt), usedCount: i.usedCount, maxUses: i.maxUses, createdBy: String(i.createdBy), createdAt: iso(i.createdAt), redemptions: i.redemptions.length })),
    pageMeta(q.page, q.limit, total),
  );
});

adminRouter.post('/invitations/:kind/:id/revoke', async (req, res) => {
  const a = requireAuth(req);
  const kind = parse(z.enum(['house', 'worker']), req.params.kind);
  const model: any = kind === 'house' ? HouseInvitation : ShopInvitation;
  const r = await model.updateOne({ _id: paramId(req.params.id), status: { $ne: 'revoked' } }, { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: a.userId, revokeReason: 'admin' } });
  if (!r.modifiedCount) throw notFound('Active invitation');
  await audit({ req, action: `admin.invitation_revoked`, category: 'invitation', targetType: `${kind}_invitation`, targetId: req.params.id as string });
  ok(res, { revoked: true });
});

/* Product moderation -------------------------------------------------------------------------- */

adminRouter.get('/products', async (req, res) => {
  const a = requireAuth(req);
  const q = parse(paginationSchema.extend({ moderationStatus: z.enum(['approved', 'flagged', 'removed']).optional(), q: z.string().trim().max(80).optional(), shopId: objectId.optional() }), req.query);
  const filter: Record<string, unknown> = { ...marketScopeFilter(a) };
  if (q.moderationStatus) filter.moderationStatus = q.moderationStatus;
  if (q.shopId) filter.shopId = q.shopId;
  if (q.q) filter.name = new RegExp(escapeRegex(q.q), 'i');
  const [items, total] = await Promise.all([Product.find(filter).sort({ updatedAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(), Product.countDocuments(filter)]);
  const summaries = await toProductSummaries(items as any);
  paginated(res, summaries.map((s, i) => ({ ...s, moderationStatus: items[i].moderationStatus, moderationReason: items[i].moderationReason })), pageMeta(q.page, q.limit, total));
});

adminRouter.post('/products/:id/moderate', async (req, res) => {
  const a = requireAuth(req);
  const input = parse(z.object({ moderationStatus: z.enum(['approved', 'flagged', 'removed']), reason: z.string().trim().min(3).max(500) }), req.body);
  const p = await Product.findById(paramId(req.params.id));
  if (!p) throw notFound('Product');
  assertMarketScope(a, { marketId: p.marketId, sectionId: p.sectionId });
  p.set({ moderationStatus: input.moderationStatus, moderationReason: input.reason });
  await p.save();
  await syncProductEmbeddingFilters(p._id);
  await audit({ req, action: 'admin.product_moderated', category: 'product', targetType: 'product', targetId: p._id, shopId: p.shopId, reason: input.reason, metadata: { status: input.moderationStatus } });
  const shop = await Shop.findById(p.shopId).select('ownerId').lean();
  if (shop && input.moderationStatus !== 'approved') await notify([shop.ownerId], { type: 'verification.updated', title: 'Product moderated', body: `${p.name}: ${input.reason}`, data: { productId: String(p._id), shopId: String(p.shopId) } });
  ok(res, { id: String(p._id), moderationStatus: p.moderationStatus });
});

/* Orders & payments --------------------------------------------------------------------------- */

adminRouter.get('/orders', async (req, res) => {
  const a = requireAuth(req);
  const q = parse(paginationSchema.extend({ status: z.enum(ORDER_STATUSES).optional(), shopId: objectId.optional(), reference: z.string().trim().max(40).optional() }), req.query);
  const filter: Record<string, unknown> = { ...marketScopeFilter(a) };
  if (q.status) filter.status = q.status;
  if (q.shopId) filter.shopId = q.shopId;
  if (q.reference) filter.reference = q.reference.toUpperCase();
  const [items, total] = await Promise.all([Order.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(), Order.countDocuments(filter)]);
  paginated(res, await toOrderDtos(items, 'admin'), pageMeta(q.page, q.limit, total));
});

adminRouter.post('/orders/:id/transition', async (req, res) => {
  const a = requireAuth(req);
  const input = parse(z.object({ status: z.enum(ORDER_STATUSES), reason: z.string().trim().min(3).max(500) }), req.body);
  const o = await Order.findById(paramId(req.params.id));
  if (!o) throw notFound('Order');
  assertMarketScope(a, { marketId: o.marketId });
  const updated = await transitionOrder(o, input.status, 'admin', a.userId, { reason: input.reason }, req);
  ok(res, (await toOrderDtos([updated!.toObject()], 'admin'))[0]);
});

adminRouter.get('/payments', adminOnly, async (req, res) => {
  const q = parse(paginationSchema.extend({ status: z.string().max(20).optional(), provider: z.string().max(20).optional() }), req.query);
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.provider) filter.provider = q.provider;
  const [items, total, refunds] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    Payment.countDocuments(filter),
    Refund.find({ status: { $in: ['pending', 'processing', 'manual'] } }).limit(50).lean(),
  ]);
  paginated(res, items.map((p) => ({ ...toPaymentDto(p), method: p.method, confirmedBySeller: p.status === 'seller_confirmed', failureReason: p.failureReason })), pageMeta(q.page, q.limit, total), {
    openRefunds: refunds.map((r) => ({ id: String(r._id), orderId: String(r.orderId), amountKobo: r.amountKobo, status: r.status, provider: r.provider })),
  });
});

/** Issues a gateway refund for a refund_pending order, or records a manual refund completed outside the gateway. */
adminRouter.post('/orders/:id/refund', adminOnly, async (req, res) => {
  const input = parse(z.object({ mode: z.enum(['gateway', 'manual']), note: z.string().trim().min(3).max(500) }), req.body);
  const o = await Order.findById(paramId(req.params.id));
  if (!o) throw notFound('Order');
  if (o.status !== 'refund_pending') throw conflict('The order is not awaiting a refund');
  const refund = await Refund.findOne({ orderId: o._id, status: { $in: ['pending', 'processing', 'manual'] } });
  const payment = await Payment.findOne({ orderId: o._id, status: 'paid', verified: true });
  if (input.mode === 'gateway') {
    const provider = paymentProvider();
    if (!provider || !payment || payment.provider !== provider.name) throw conflict('No verified gateway payment to refund through the configured provider');
    const r = await provider.refund({ reference: payment.reference, transactionId: payment.providerTransactionId ?? undefined, amountKobo: payment.amountKobo });
    if (refund) await Refund.updateOne({ _id: refund._id }, { $set: { status: r.status === 'completed' ? 'completed' : 'processing', providerRefundId: r.refundId } });
    if (r.status === 'completed') await markRefundCompleted(o._id, 'gateway');
  } else {
    if (refund) await Refund.updateOne({ _id: refund._id }, { $set: { status: 'manual', reason: input.note } });
    await markRefundCompleted(o._id, `manual: ${input.note}`);
  }
  await audit({ req, action: `admin.refund_${input.mode}`, category: 'payment', targetType: 'order', targetId: o._id, shopId: o.shopId, reason: input.note });
  ok(res, (await toOrderDtos([(await Order.findById(o._id).lean())!], 'admin'))[0]);
});

/* Promotions ---------------------------------------------------------------------------------- */

adminRouter.get('/promotions', adminOnly, async (req, res) => {
  const q = parse(paginationSchema.extend({ status: z.string().max(20).optional(), type: z.enum(PROMOTION_TYPES).optional() }), req.query);
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.type) filter.type = q.type;
  const [items, total] = await Promise.all([Promotion.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(), Promotion.countDocuments(filter)]);
  paginated(res, items.map(toPromotionDto), pageMeta(q.page, q.limit, total));
});

adminRouter.post('/promotions', adminOnly, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(promotionSchema.extend({ billing: z.enum(['not_billed', 'manual']).default('not_billed') }), req.body);
  if (input.endsAt <= input.startsAt) throw badRequest('End date must be after the start date');
  if (!(await Shop.exists({ _id: input.shopId, status: 'active' }))) throw badRequest('Shop must be active');
  const p = await Promotion.create({ ...input, status: 'approved', requestedBy: a.userId, reviewedBy: a.userId });
  await audit({ req, action: 'admin.promotion_created', category: 'admin', targetType: 'promotion', targetId: p._id, shopId: p.shopId });
  ok(res, toPromotionDto(p), 201);
});

adminRouter.post('/promotions/:id/decision', adminOnly, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(z.object({ decision: z.enum(['approve', 'reject', 'cancel']), note: z.string().trim().max(500).optional(), billing: z.enum(['not_billed', 'manual']).optional() }), req.body);
  const p = await Promotion.findById(paramId(req.params.id));
  if (!p) throw notFound('Promotion');
  const status = input.decision === 'approve' ? 'approved' : input.decision === 'reject' ? 'rejected' : 'cancelled';
  p.set({ status, reviewedBy: a.userId, reviewNote: input.note, ...(input.billing ? { billing: input.billing } : {}) });
  await p.save();
  await audit({ req, action: `admin.promotion_${status}`, category: 'admin', targetType: 'promotion', targetId: p._id, shopId: p.shopId });
  const shop = await Shop.findById(p.shopId).select('ownerId').lean();
  if (shop) await notify([shop.ownerId], { type: 'announcement', title: 'Promotion update', body: `Your promotion request was ${status}.${input.note ? ` ${input.note}` : ''}`, data: { promotionId: String(p._id) } });
  ok(res, toPromotionDto(p));
});

/* Settings, audit, announcements -------------------------------------------------------------- */

const SETTINGS: Record<string, z.ZodType> = {
  'invitations.maxExpiryDays': z.number().int().min(1).max(90),
  'invitations.maxUses': z.number().int().min(1).max(500),
  'orders.autoCompleteDays': z.number().int().min(1).max(60),
  'support.contact': z.object({ phone: z.string().max(30).optional(), email: z.string().max(120).optional(), whatsapp: z.string().max(30).optional() }),
};

adminRouter.get('/settings', adminOnly, async (_req, res) => {
  const items = await PlatformSetting.find({}).lean();
  ok(res, { keys: Object.keys(SETTINGS), values: Object.fromEntries(items.map((s) => [s.key, s.value])) });
});

adminRouter.put('/settings/:key', adminOnly, async (req, res) => {
  const a = requireAuth(req);
  const key = String(req.params.key);
  const schema = SETTINGS[key];
  if (!schema) throw notFound('Setting');
  const { value } = parse(z.object({ value: schema }), req.body);
  await PlatformSetting.updateOne({ key }, { $set: { value, updatedBy: a.userId } }, { upsert: true });
  await audit({ req, action: 'admin.setting_changed', category: 'admin', metadata: { key, value } });
  ok(res, { key, value });
});

adminRouter.get('/audit', adminOnly, async (req, res) => {
  const q = parse(paginationSchema.extend({ category: z.string().max(20).optional(), action: z.string().max(60).optional(), actorId: objectId.optional(), outcome: z.enum(['success', 'failure']).optional() }), req.query);
  const filter: Record<string, unknown> = {};
  if (q.category) filter.category = q.category;
  if (q.action) filter.action = new RegExp(`^${escapeRegex(q.action)}`);
  if (q.actorId) filter.actorId = q.actorId;
  if (q.outcome) filter.outcome = q.outcome;
  const [items, total] = await Promise.all([AuditLog.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(), AuditLog.countDocuments(filter)]);
  const actors = await User.find({ _id: { $in: items.map((i) => i.actorId).filter(Boolean) } }).select('fullName').lean();
  paginated(
    res,
    items.map((l) => ({
      id: String(l._id),
      action: l.action,
      category: l.category,
      outcome: l.outcome,
      actor: l.actorId ? { id: String(l.actorId), fullName: actors.find((u) => String(u._id) === String(l.actorId))?.fullName } : null,
      targetType: l.targetType,
      targetId: l.targetId ? String(l.targetId) : null,
      reason: l.reason,
      metadata: l.metadata,
      ip: l.ip,
      at: iso(l.createdAt),
    })),
    pageMeta(q.page, q.limit, total),
  );
});

adminRouter.post('/announcements', adminOnly, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(2000), audience: z.enum(['all', 'shop_owners', 'house_heads', 'customers']).default('all') }), req.body);
  const ann = await Announcement.create({ ...input, createdBy: a.userId, publishedAt: new Date() });
  let userIds: Types.ObjectId[] = [];
  if (input.audience === 'shop_owners') userIds = (await ShopMembership.find({ role: 'owner', status: 'active' }).distinct('userId')) as Types.ObjectId[];
  else if (input.audience === 'house_heads') userIds = (await HouseStaff.find({ role: 'head', status: 'active' }).distinct('userId')) as Types.ObjectId[];
  else userIds = (await User.find({ status: 'active' }).distinct('_id')) as Types.ObjectId[];
  // Fan out in chunks to bound memory; each notification is deduplicated per announcement.
  for (let i = 0; i < userIds.length; i += 500) {
    await notify(userIds.slice(i, i + 500), { type: 'announcement', title: input.title, body: input.body, data: { announcementId: String(ann._id) }, dedupeKey: `announcement:${ann._id}` });
  }
  await audit({ req, action: 'admin.announcement', category: 'admin', targetType: 'announcement', targetId: ann._id, metadata: { audience: input.audience, recipients: userIds.length } });
  ok(res, { id: String(ann._id), recipients: userIds.length }, 201);
});

/* Market structure helpers -------------------------------------------------------------------- */

adminRouter.get('/houses', async (req, res) => {
  const a = requireAuth(req);
  const q = parse(paginationSchema.extend({ marketId: objectId.optional(), q: z.string().trim().max(40).optional(), headless: z.coerce.boolean().optional() }), req.query);
  const filter: Record<string, unknown> = { ...marketScopeFilter(a) };
  if (q.marketId) filter.marketId = q.marketId;
  if (q.headless) filter.headUserId = null;
  if (q.q) filter.houseNumber = new RegExp(escapeRegex(q.q), 'i');
  const [items, total] = await Promise.all([House.find(filter).sort({ houseNumber: 1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(), House.countDocuments(filter)]);
  const heads = await User.find({ _id: { $in: items.map((h) => h.headUserId).filter(Boolean) } }).select('fullName phone').lean();
  paginated(
    res,
    items.map((h) => ({
      id: String(h._id),
      marketId: String(h.marketId),
      sectionId: h.sectionId ? String(h.sectionId) : null,
      houseNumber: h.houseNumber,
      name: h.name,
      status: h.status,
      verificationStatus: h.verificationStatus,
      headVerificationStatus: h.headVerificationStatus,
      autoApproveMemberships: h.autoApproveMemberships,
      allowAssistants: h.allowAssistants,
      shopCount: h.shopCount,
      head: h.headUserId ? { id: String(h.headUserId), fullName: heads.find((u) => String(u._id) === String(h.headUserId))?.fullName, phone: heads.find((u) => String(u._id) === String(h.headUserId))?.phone } : null,
    })),
    pageMeta(q.page, q.limit, total),
  );
});

/** Finds a user by email/phone for role or house-head assignment. */
adminRouter.get('/user-lookup', async (req, res) => {
  const { identifier } = parse(z.object({ identifier: z.string().trim().min(3).max(120) }), req.query);
  const phone = normalizePhone(identifier);
  const u = identifier.includes('@') ? await User.findOne({ email: identifier.toLowerCase() }).lean() : phone ? await User.findOne({ phone }).lean() : null;
  if (!u) throw notFound('User');
  ok(res, { id: String(u._id), fullName: u.fullName, status: u.status });
});
