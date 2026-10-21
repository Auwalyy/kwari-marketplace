import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { houseClaimSchema, houseSchema, houseUpdateSchema, membershipDecisionSchema, objectId, paginationSchema } from '@kkdm/shared';
import { House, HouseMembership, HouseStaff, Market, MarketSection } from '../markets/market.models';
import { Shop } from '../shops/shop.models';
import { User } from '../users/user.model';
import { HouseInvitation } from '../invitations/invitation.models';
import { AuditLog } from '../admin/admin.models';
import { VerificationRequest } from '../reports/trust.models';
import { authenticate, optionalAuth, requireAuth } from '../../middleware/auth';
import { assertMarketScope, requireHouseAccess } from '../../services/access';
import { audit } from '../../services/audit';
import { clearLocationCache } from '../../services/locations';
import { notify } from '../notifications/notify';
import { decideMembership, removeMembership, toHouseDtos, toMembershipDtos } from './house.service';
import { refreshShopListing } from '../shops/shop.service';
import { parse, paramId } from '../../utils/validate';
import { badRequest, conflict, escapeRegex, forbidden, iso, notFound, ok, pageMeta, paginated, skipFor } from '../../utils/http';

export const housesRouter = Router();

const listQuery = paginationSchema.extend({
  marketId: objectId.optional(),
  sectionId: objectId.optional(),
  q: z.string().trim().max(60).optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  noSection: z.coerce.boolean().optional(),
});

housesRouter.get('/', optionalAuth, async (req, res) => {
  const q = parse(listQuery, req.query);
  const filter: Record<string, unknown> = { status: 'active' };
  if (q.marketId) filter.marketId = q.marketId;
  if (q.sectionId) filter.sectionId = q.sectionId;
  if (q.noSection) filter.sectionId = null;
  if (q.verifiedOnly) filter.verificationStatus = 'verified';
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ houseNumber: rx }, { name: rx }];
  }
  const [items, total] = await Promise.all([
    House.find(filter).sort({ houseNumber: 1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    House.countDocuments(filter),
  ]);
  paginated(res, await toHouseDtos(items), pageMeta(q.page, q.limit, total));
});

housesRouter.get('/:id', async (req, res) => {
  const h = await House.findById(paramId(req.params.id)).lean();
  if (!h || h.status !== 'active') throw notFound('House');
  ok(res, (await toHouseDtos([h]))[0]);
});

/** Create a house (admins / market managers within scope). Validates the market–section relationship. */
housesRouter.post('/', authenticate, async (req, res) => {
  const input = parse(houseSchema, req.body);
  const market = await Market.findById(input.marketId);
  if (!market) throw badRequest('Market not found', 'INVALID_MARKET');
  if (input.sectionId) {
    if (!market.usesSections) throw badRequest('This market does not use sections', 'SECTIONS_DISABLED');
    const section = await MarketSection.findOne({ _id: input.sectionId, marketId: market._id, status: 'active' });
    if (!section) throw badRequest('The section does not belong to this market', 'INVALID_SECTION');
  }
  assertMarketScope(req.auth, { marketId: market._id, sectionId: input.sectionId });
  if (await House.exists({ marketId: market._id, houseNumber: input.houseNumber })) {
    throw conflict(`House ${input.houseNumber} already exists in this market`, 'HOUSE_NUMBER_TAKEN');
  }
  const h = await House.create({ ...input, sectionId: input.sectionId ?? null });
  await audit({ req, action: 'house.created', category: 'house', targetType: 'house', targetId: h._id, houseId: h._id, marketId: market._id });
  ok(res, (await toHouseDtos([h.toObject()]))[0], 201);
});

/** Profile fields — editable by the house head (or permitted assistant) and managers in scope. */
housesRouter.patch('/:id', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { house } = await requireHouseAccess(a, paramId(req.params.id));
  const input = parse(houseUpdateSchema, req.body);
  house.set(input);
  await house.save();
  clearLocationCache();
  await audit({ req, action: 'house.updated', category: 'house', targetType: 'house', targetId: house._id, houseId: house._id, metadata: { fields: Object.keys(input) } });
  ok(res, (await toHouseDtos([house.toObject()]))[0]);
});

/** Structural / trust settings — administrators and market managers only. */
const houseAdminSchema = z.object({
  sectionId: objectId.nullable().optional(),
  houseNumber: z.string().trim().toUpperCase().min(1).max(20).optional(),
  autoApproveMemberships: z.boolean().optional(),
  allowAssistants: z.boolean().optional(),
  verificationStatus: z.enum(['unverified', 'pending', 'verified', 'rejected']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  reason: z.string().trim().max(500).optional(),
});

housesRouter.patch('/:id/admin', authenticate, async (req, res) => {
  const house = await House.findById(paramId(req.params.id));
  if (!house) throw notFound('House');
  assertMarketScope(req.auth, { marketId: house.marketId, sectionId: house.sectionId });
  const input = parse(houseAdminSchema, req.body);
  if (input.sectionId !== undefined && String(input.sectionId) !== String(house.sectionId)) {
    if (input.sectionId) {
      const section = await MarketSection.findOne({ _id: input.sectionId, marketId: house.marketId, status: 'active' });
      if (!section) throw badRequest('The section does not belong to this market', 'INVALID_SECTION');
    }
    house.sectionId = input.sectionId ? new Types.ObjectId(input.sectionId) : null;
  }
  if (input.houseNumber && input.houseNumber !== house.houseNumber) {
    if (await House.exists({ marketId: house.marketId, houseNumber: input.houseNumber })) throw conflict('House number already in use', 'HOUSE_NUMBER_TAKEN');
    house.houseNumber = input.houseNumber;
  }
  for (const k of ['autoApproveMemberships', 'allowAssistants', 'verificationStatus', 'status'] as const) {
    if (input[k] !== undefined) house.set(k, input[k]);
  }
  await house.save();
  clearLocationCache();
  // Location changes cascade to every shop/product in the house.
  if (input.sectionId !== undefined) {
    await Shop.updateMany({ houseId: house._id }, { $set: { sectionId: house.sectionId } });
    const shops = await Shop.find({ houseId: house._id }).select('_id').lean();
    for (const s of shops) await refreshShopListing(s._id);
  }
  await audit({ req, action: 'house.admin_updated', category: 'house', targetType: 'house', targetId: house._id, houseId: house._id, reason: input.reason, metadata: { fields: Object.keys(input) } });
  ok(res, (await toHouseDtos([house.toObject()]))[0]);
});

/* Head assignment ----------------------------------------------------------------------------- */

housesRouter.post('/:id/head', authenticate, async (req, res) => {
  const house = await House.findById(paramId(req.params.id));
  if (!house) throw notFound('House');
  assertMarketScope(req.auth, { marketId: house.marketId, sectionId: house.sectionId });
  const input = parse(z.object({ userId: objectId, markVerified: z.boolean().default(false), reason: z.string().trim().max(500).optional() }), req.body);
  const user = await User.findOne({ _id: input.userId, status: 'active' });
  if (!user) throw badRequest('User not found or inactive', 'INVALID_USER');
  const a = requireAuth(req);
  await HouseStaff.updateMany({ houseId: house._id, role: 'head', status: 'active' }, { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: a.userId, reason: 'replaced' } });
  await HouseStaff.create({ houseId: house._id, userId: user._id, role: 'head', assignedBy: a.userId, reason: input.reason });
  house.headUserId = user._id;
  house.headVerificationStatus = input.markVerified ? 'verified' : 'pending';
  await house.save();
  await audit({ req, action: 'house.head_assigned', category: 'house', targetType: 'house', targetId: house._id, houseId: house._id, reason: input.reason, metadata: { userId: input.userId, verified: input.markVerified } });
  await notify([user._id], {
    type: 'verification.updated',
    title: 'House head assignment',
    body: `You are now the house head for House ${house.houseNumber}.${input.markVerified ? '' : ' Verification is pending.'}`,
    data: { houseId: String(house._id) },
  });
  ok(res, (await toHouseDtos([house.toObject()]))[0]);
});

housesRouter.delete('/:id/head', authenticate, async (req, res) => {
  const house = await House.findById(paramId(req.params.id));
  if (!house) throw notFound('House');
  assertMarketScope(req.auth, { marketId: house.marketId, sectionId: house.sectionId });
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
  const a = requireAuth(req);
  await HouseStaff.updateMany({ houseId: house._id, status: 'active' }, { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: a.userId, reason } });
  // Outstanding invitations from the old head are revoked with them.
  await HouseInvitation.updateMany({ houseId: house._id, status: 'active' }, { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: a.userId, revokeReason: 'head_removed' } });
  house.headUserId = null;
  house.headVerificationStatus = 'unverified';
  await house.save();
  await audit({ req, action: 'house.head_removed', category: 'house', targetType: 'house', targetId: house._id, houseId: house._id, reason });
  ok(res, (await toHouseDtos([house.toObject()]))[0]);
});

/** A user claims headship of a house that has no head; an administrator reviews the evidence. */
housesRouter.post('/claims', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(houseClaimSchema, req.body);
  const house = await House.findById(input.houseId);
  if (!house || house.status !== 'active') throw notFound('House');
  if (house.headUserId) throw conflict('This house already has a head. Contact support to dispute it.', 'HOUSE_HAS_HEAD');
  if (await VerificationRequest.exists({ type: 'house_head', targetId: house._id, requestedBy: a.userId, status: 'pending' })) {
    throw conflict('You already have a pending claim for this house', 'CLAIM_PENDING');
  }
  const vr = await VerificationRequest.create({
    type: 'house_head',
    targetId: house._id,
    marketId: house.marketId,
    requestedBy: a.userId,
    evidence: input.evidence,
    documentUrls: input.documentUrls,
    history: [{ status: 'pending', actorId: a.userId }],
  });
  await audit({ req, action: 'house.claim_submitted', category: 'house', targetType: 'verification_request', targetId: vr._id, houseId: house._id });
  ok(res, { id: String(vr._id), status: vr.status }, 201);
});

/* Assistants ---------------------------------------------------------------------------------- */

housesRouter.get('/:id/staff', authenticate, async (req, res) => {
  const { house } = await requireHouseAccess(requireAuth(req), paramId(req.params.id));
  const staff = await HouseStaff.find({ houseId: house._id, status: 'active' }).lean();
  const users = await User.find({ _id: { $in: staff.map((s) => s.userId) } }).select('fullName phone email').lean();
  ok(
    res,
    staff.map((s) => {
      const u = users.find((x) => String(x._id) === String(s.userId));
      return { id: String(s._id), userId: String(s.userId), fullName: u?.fullName ?? '', role: s.role, since: iso(s.createdAt) };
    }),
  );
});

housesRouter.post('/:id/assistants', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { house } = await requireHouseAccess(a, paramId(req.params.id), { headOnly: true, allowManagers: false });
  if (!house.allowAssistants) throw forbidden('An administrator must enable assistants for this house', 'ASSISTANTS_DISABLED');
  const { identifier } = parse(z.object({ identifier: z.string().trim().min(3).max(120) }), req.body);
  const user = identifier.includes('@') ? await User.findOne({ email: identifier.toLowerCase(), status: 'active' }) : await User.findOne({ phone: identifier, status: 'active' });
  if (!user) throw notFound('User');
  if (await HouseStaff.exists({ houseId: house._id, userId: user._id, status: 'active' })) throw conflict('Already a member of house staff');
  await HouseStaff.create({ houseId: house._id, userId: user._id, role: 'assistant', assignedBy: a.userId });
  await audit({ req, action: 'house.assistant_added', category: 'house', targetType: 'user', targetId: user._id, houseId: house._id });
  ok(res, { added: true }, 201);
});

housesRouter.delete('/:id/assistants/:userId', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { house } = await requireHouseAccess(a, paramId(req.params.id), { headOnly: true });
  const userId = paramId(req.params.userId, 'userId');
  const r = await HouseStaff.updateOne({ houseId: house._id, userId, role: 'assistant', status: 'active' }, { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: a.userId } });
  if (!r.modifiedCount) throw notFound('Assistant');
  await audit({ req, action: 'house.assistant_removed', category: 'house', targetType: 'user', targetId: userId, houseId: house._id });
  ok(res, { removed: true });
});

/* Membership management ----------------------------------------------------------------------- */

housesRouter.get('/:id/memberships', authenticate, async (req, res) => {
  const { house } = await requireHouseAccess(requireAuth(req), paramId(req.params.id));
  const q = parse(paginationSchema.extend({ status: z.enum(['pending', 'approved', 'rejected', 'removed', 'left']).optional() }), req.query);
  const filter: Record<string, unknown> = { houseId: house._id };
  if (q.status) filter.status = q.status;
  const [items, total] = await Promise.all([
    HouseMembership.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    HouseMembership.countDocuments(filter),
  ]);
  paginated(res, await toMembershipDtos(items), pageMeta(q.page, q.limit, total));
});

housesRouter.get('/:id/memberships/:membershipId', authenticate, async (req, res) => {
  const { house } = await requireHouseAccess(requireAuth(req), paramId(req.params.id));
  const m = await HouseMembership.findOne({ _id: paramId(req.params.membershipId), houseId: house._id }).lean();
  if (!m) throw notFound('Membership');
  const [dto] = await toMembershipDtos([m]);
  const shop = await Shop.findById(m.shopId).select('shopCode description locationDescription contactPhone verificationStatus ownershipVerificationStatus categoryIds createdAt').lean();
  ok(res, {
    ...dto,
    history: (m.history ?? []).map((h) => ({ status: h.status, reason: h.reason, at: iso(h.at) })),
    shopDetails: shop
      ? {
          shopCode: shop.shopCode,
          description: shop.description,
          locationDescription: shop.locationDescription,
          contactPhone: shop.contactPhone,
          verificationStatus: shop.verificationStatus,
          ownershipVerificationStatus: shop.ownershipVerificationStatus,
          registeredAt: iso(shop.createdAt),
        }
      : null,
  });
});

housesRouter.post('/:id/memberships/:membershipId/decision', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { house } = await requireHouseAccess(a, paramId(req.params.id));
  const input = parse(membershipDecisionSchema, req.body);
  if (input.decision === 'reject' && !input.reason) throw badRequest('Give a reason for rejecting', 'REASON_REQUIRED');
  const m = await HouseMembership.findOne({ _id: paramId(req.params.membershipId), houseId: house._id });
  if (!m) throw notFound('Membership');
  await decideMembership(m, input.decision, a.userId, input.reason, req);
  const fresh = await HouseMembership.findById(m._id).lean();
  ok(res, (await toMembershipDtos([fresh]))[0]);
});

housesRouter.post('/:id/memberships/:membershipId/remove', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { house } = await requireHouseAccess(a, paramId(req.params.id), { headOnly: true });
  const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Explain why the shop is being removed').max(500) }), req.body);
  const m = await HouseMembership.findOne({ _id: paramId(req.params.membershipId), houseId: house._id });
  if (!m) throw notFound('Membership');
  await removeMembership(m, a.userId, reason, req);
  const fresh = await HouseMembership.findById(m._id).lean();
  ok(res, (await toMembershipDtos([fresh]))[0]);
});

/** House head responds to a dispute raised by a shop owner. */
housesRouter.post('/:id/memberships/:membershipId/dispute-response', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { house } = await requireHouseAccess(a, paramId(req.params.id));
  const { response } = parse(z.object({ response: z.string().trim().min(5).max(2000) }), req.body);
  const m = await HouseMembership.findOne({ _id: paramId(req.params.membershipId), houseId: house._id });
  if (!m || m.dispute?.status !== 'open') throw notFound('Open dispute');
  m.set('dispute.response', response);
  m.set('dispute.respondedAt', new Date());
  m.set('dispute.status', 'responded');
  await m.save();
  await audit({ req, action: 'house_membership.dispute_responded', category: 'house', targetType: 'house_membership', targetId: m._id, houseId: house._id, shopId: m.shopId });
  const shop = await Shop.findById(m.shopId).select('ownerId').lean();
  if (shop) await notify([shop.ownerId], { type: 'membership.updated', title: 'Dispute response', body: `House ${house.houseNumber} responded to your dispute.`, data: { membershipId: String(m._id) } });
  ok(res, (await toMembershipDtos([m.toObject()]))[0]);
});

/* Dashboard & activity ------------------------------------------------------------------------ */

housesRouter.get('/:id/dashboard', authenticate, async (req, res) => {
  const { house } = await requireHouseAccess(requireAuth(req), paramId(req.params.id));
  const hid = house._id;
  const [memberships, shopsByStatus, verification, invitations, recent] = await Promise.all([
    HouseMembership.aggregate([{ $match: { houseId: hid } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Shop.aggregate([{ $match: { houseId: hid } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Shop.aggregate([{ $match: { houseId: hid, status: 'active' } }, { $group: { _id: '$verificationStatus', n: { $sum: 1 } } }]),
    HouseInvitation.aggregate([
      { $match: { houseId: hid } },
      { $group: { _id: null, created: { $sum: 1 }, redeemed: { $sum: '$usedCount' }, active: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$expiresAt', new Date()] }] }, 1, 0] } } } },
    ]),
    AuditLog.find({ houseId: hid }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  const toObj = (arr: { _id: string; n: number }[]) => Object.fromEntries(arr.map((x) => [x._id ?? 'none', x.n]));
  const shopStatus = toObj(shopsByStatus);
  ok(res, {
    house: (await toHouseDtos([house.toObject()]))[0],
    headVerificationStatus: house.headVerificationStatus,
    shops: { total: Object.values(shopStatus).reduce((a, b) => a + b, 0), active: shopStatus.active ?? 0, pending: shopStatus.pending_membership ?? 0, byStatus: shopStatus },
    membershipRequests: toObj(memberships),
    verification: toObj(verification),
    invitations: invitations[0] ? { created: invitations[0].created, redeemed: invitations[0].redeemed, active: invitations[0].active } : { created: 0, redeemed: 0, active: 0 },
    recentActivity: recent.map(activityDto),
  });
});

function activityDto(l: any) {
  return { id: String(l._id), action: l.action, outcome: l.outcome, reason: l.reason ?? undefined, targetType: l.targetType, at: iso(l.createdAt) };
}

housesRouter.get('/:id/activity', authenticate, async (req, res) => {
  const { house } = await requireHouseAccess(requireAuth(req), paramId(req.params.id));
  const { page, limit } = parse(paginationSchema, req.query);
  const filter = { houseId: house._id };
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skipFor(page, limit)).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  paginated(res, items.map(activityDto), pageMeta(page, limit, total));
});

/** Houses the signed-in user manages (head / assistant). */
housesRouter.get('/mine/list', authenticate, async (req, res) => {
  const staff = await HouseStaff.find({ userId: requireAuth(req).userId, status: 'active' }).lean();
  const houses = await House.find({ _id: { $in: staff.map((s) => s.houseId) } }).lean();
  const dtos = await toHouseDtos(houses);
  ok(
    res,
    dtos.map((d) => {
      const h = houses.find((x) => String(x._id) === d.id)!;
      const role = staff.find((s) => String(s.houseId) === d.id)!.role;
      return { ...d, role, headVerificationStatus: h.headVerificationStatus, allowAssistants: h.allowAssistants };
    }),
  );
});
