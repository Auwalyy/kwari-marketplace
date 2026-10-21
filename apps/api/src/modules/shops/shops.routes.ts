import { Router } from 'express';
import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  SHOP_PERMISSIONS,
  invitationCodeSchema,
  objectId,
  paginationSchema,
  shopFulfilmentSchema,
  shopRegistrationSchema,
  shopUpdateSchema,
} from '@kkdm/shared';
import { Shop, ShopMembership } from './shop.models';
import { refreshShopListing, toShopDto, toShopDtoForStaff, toShopSummaries, uniqueShopCode, uniqueShopSlug } from './shop.service';
import { House, HouseMembership, HouseStaff } from '../markets/market.models';
import { HouseInvitation } from '../invitations/invitation.models';
import {
  assertNotLockedOut,
  consumeInvitation,
  effectiveStatus,
  findHouseInvitation,
  invalidCodeError,
  recordCodeFailure,
  releaseInvitationUse,
  unusableError,
} from '../invitations/invitation.service';
import { Category } from '../products/product.models';
import { User } from '../users/user.model';
import { Order } from '../orders/order.models';
import { VerificationRequest } from '../reports/trust.models';
import { AuditLog } from '../admin/admin.models';
import { decideMembership, recountHouseShops, toMembershipDtos } from '../houses/house.service';
import { authenticate, optionalAuth, requireAuth } from '../../middleware/auth';
import { imageUpload } from '../../middleware/upload';
import { invitationRedeemLimiter, uploadLimiter } from '../../middleware/rateLimit';
import { getShopAccess, isAdmin, requireShopAccess } from '../../services/access';
import { audit } from '../../services/audit';
import { notify } from '../notifications/notify';
import { processUploadedImage } from '../../services/images';
import { storage, storageKey } from '../../services/storage';
import { realtimeServer, rooms } from '../../services/realtime';
import { withTransaction } from '../../config/db';
import { parse, paramId } from '../../utils/validate';
import { badRequest, conflict, escapeRegex, forbidden, iso, notFound, ok, pageMeta, paginated, skipFor } from '../../utils/http';

export const shopsRouter = Router();

/* Directory ----------------------------------------------------------------------------------- */

const directoryQuery = paginationSchema.extend({
  q: z.string().trim().max(80).optional(),
  marketId: objectId.optional(),
  sectionId: objectId.optional(),
  houseId: objectId.optional(),
  categoryId: objectId.optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  wholesaleOnly: z.coerce.boolean().optional(),
  hasProducts: z.coerce.boolean().optional(),
  sort: z.enum(['rating', 'newest', 'name', 'products']).default('rating'),
});

shopsRouter.get('/', async (req, res) => {
  const q = parse(directoryQuery, req.query);
  const filter: Record<string, unknown> = { status: 'active' };
  for (const k of ['marketId', 'sectionId', 'houseId'] as const) if (q[k]) filter[k] = q[k];
  if (q.categoryId) filter.categoryIds = q.categoryId;
  if (q.verifiedOnly) filter.verificationStatus = 'verified';
  if (q.wholesaleOnly) filter.wholesaleAvailable = true;
  if (q.hasProducts) filter.activeProductCount = { $gt: 0 };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    const houses = await House.find({ houseNumber: rx }).select('_id').limit(50).lean();
    filter.$or = [{ name: rx }, { shopCode: rx }, { shopNumber: rx }, { houseId: { $in: houses.map((h) => h._id) } }];
  }
  const sort: Record<string, 1 | -1> =
    q.sort === 'newest' ? { createdAt: -1 } : q.sort === 'name' ? { name: 1 } : q.sort === 'products' ? { activeProductCount: -1 } : { ratingAverage: -1, ratingCount: -1 };
  const [items, total] = await Promise.all([
    Shop.find(filter).sort(sort).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    Shop.countDocuments(filter),
  ]);
  paginated(res, await toShopSummaries(items as any), pageMeta(q.page, q.limit, total));
});

/** Shops the caller belongs to (as owner or worker), including pending ones. */
shopsRouter.get('/mine', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const memberships = await ShopMembership.find({ userId: a.userId, status: 'active' }).lean();
  const shops = await Shop.find({ _id: { $in: memberships.map((m) => m.shopId) } }).lean();
  const summaries = await toShopSummaries(shops as any);
  ok(
    res,
    summaries.map((s) => {
      const shop = shops.find((x) => String(x._id) === s.id)!;
      const m = memberships.find((x) => String(x.shopId) === s.id)!;
      return { ...s, status: shop.status, role: m.role, permissions: m.permissions };
    }),
  );
});

shopsRouter.get('/:idOrSlug', optionalAuth, async (req, res) => {
  const key = String(req.params.idOrSlug);
  const shop = Types.ObjectId.isValid(key) && key.length === 24 ? await Shop.findById(key) : await Shop.findOne({ slug: key.toLowerCase() });
  if (!shop) throw notFound('Shop');
  const access = req.auth ? await getShopAccess(req.auth.userId, String(shop._id)).catch(() => null) : null;
  if (shop.status !== 'active' && !access && !isAdmin(req.auth)) throw notFound('Shop');
  ok(res, access ? { ...(await toShopDtoForStaff(shop)), viewerRole: access.role, viewerPermissions: access.isOwner ? [...SHOP_PERMISSIONS] : access.permissions } : await toShopDto(shop));
});

/* Registration through a house invitation ------------------------------------------------------ */

shopsRouter.post('/register', authenticate, invitationRedeemLimiter, async (req, res) => {
  const a = requireAuth(req);
  await assertNotLockedOut(req, 'house');
  const input = parse(shopRegistrationSchema, req.body);
  const code = parse(invitationCodeSchema, { code: input.invitationCode }).code;

  const inv = await findHouseInvitation(code);
  if (!inv) {
    await recordCodeFailure(req, 'house', 'not_found');
    throw invalidCodeError();
  }
  const status = effectiveStatus(inv);
  if (status !== 'active') {
    await recordCodeFailure(req, 'house', status, { invitationId: String(inv._id) });
    throw unusableError(status);
  }
  const house = await House.findById(inv.houseId);
  if (!house || house.status !== 'active') throw invalidCodeError();

  const existing = await Shop.findOne({ houseId: house._id, shopNumber: input.shopNumber, occupiesSlot: true }).lean();
  if (existing) {
    if (String(existing.ownerId) === a.userId) {
      throw conflict('You have already registered this shop. Check its status under My shops.', 'SHOP_ALREADY_REGISTERED');
    }
    throw conflict(`Shop ${input.shopNumber} is already registered in this house`, 'SHOP_NUMBER_TAKEN');
  }
  if (input.categoryIds.length) {
    const n = await Category.countDocuments({ _id: { $in: input.categoryIds }, active: true });
    if (n !== new Set(input.categoryIds).size) throw badRequest('One or more categories are invalid', 'INVALID_CATEGORY');
  }

  const [slug, shopCode] = await Promise.all([uniqueShopSlug(input.name), uniqueShopCode()]);
  const shopId = new Types.ObjectId();
  let consumedWithoutTxn = false;

  const membership = await withTransaction(async (session) => {
    const consumed = await consumeInvitation(HouseInvitation, inv._id, { userId: a.userId, shopId }, session);
    if (!consumed) throw unusableError(effectiveStatus((await HouseInvitation.findById(inv._id).lean())!));
    consumedWithoutTxn = !session;
    try {
      await Shop.create(
        [
          {
            _id: shopId,
            name: input.name,
            slug,
            shopCode,
            shopNumber: input.shopNumber,
            marketId: house.marketId,
            sectionId: house.sectionId,
            houseId: house._id,
            ownerId: a.userId,
            categoryIds: input.categoryIds,
            description: input.description,
            locationDescription: input.locationDescription,
            contactPhone: input.contactPhone ?? null,
            contactEmail: input.contactEmail ?? null,
            whatsappPhone: input.whatsappPhone ?? null,
            status: 'pending_membership',
            occupiesSlot: true,
          },
        ],
        { session },
      );
      await ShopMembership.create([{ shopId, userId: a.userId, role: 'owner', permissions: [...SHOP_PERMISSIONS], addedBy: a.userId }], { session });
      const [m] = await HouseMembership.create(
        [{ houseId: house._id, shopId, invitationId: inv._id, requestedBy: a.userId, status: 'pending', history: [{ status: 'pending', by: a.userId }] }],
        { session },
      );
      return m;
    } catch (err) {
      if (!session) {
        // No transaction support: compensate manually.
        await Promise.all([
          Shop.deleteOne({ _id: shopId }),
          ShopMembership.deleteMany({ shopId }),
          HouseMembership.deleteMany({ shopId }),
          releaseInvitationUse(HouseInvitation, inv._id, a.userId),
        ]);
      }
      if ((err as { code?: number }).code === 11000) throw conflict(`Shop ${input.shopNumber} is already registered in this house`, 'SHOP_NUMBER_TAKEN');
      throw err;
    }
  });
  void consumedWithoutTxn;

  await audit({ req, action: 'invitation.house_redeem', category: 'invitation', targetType: 'shop', targetId: shopId, houseId: house._id, shopId, metadata: { invitationId: String(inv._id) } });
  await audit({ req, action: 'shop.registered', category: 'shop', targetType: 'shop', targetId: shopId, houseId: house._id, shopId, marketId: house.marketId });

  if (house.autoApproveMemberships) {
    await decideMembership(membership, 'approve', null, 'Automatic approval enabled for this house', req, true);
  } else {
    const staff = await HouseStaff.find({ houseId: house._id, status: 'active' }).select('userId').lean();
    await notify(staff.map((s) => s.userId), {
      type: 'house_invitation.redeemed',
      title: 'New shop membership request',
      body: `${input.name} (Shop ${input.shopNumber}) used an invitation and is waiting for your approval.`,
      data: { houseId: String(house._id), membershipId: String(membership._id), shopId: String(shopId) },
      dedupeKey: `membership-request:${membership._id}`,
    });
  }
  const shop = await Shop.findById(shopId);
  ok(res, { shop: await toShopDtoForStaff(shop!), membership: (await toMembershipDtos([await HouseMembership.findById(membership._id).lean()]))[0] }, 201);
});

/** The owner's view of the shop's house membership (pending screen, history, disputes). */
shopsRouter.get('/:id/house-membership', authenticate, async (req, res) => {
  const { shop } = await requireShopAccess(requireAuth(req), paramId(req.params.id), 'owner', { allowSuspended: true });
  const list = await HouseMembership.find({ shopId: shop._id }).sort({ createdAt: -1 }).limit(20).lean();
  const dtos = await toMembershipDtos(list);
  ok(
    res,
    dtos.map((d, i) => ({ ...d, history: (list[i].history ?? []).map((h) => ({ status: h.status, reason: h.reason, at: iso(h.at) })) })),
  );
});

/** Re-joins a house (after removal) or moves the shop to a new house using a fresh invitation code. */
shopsRouter.post('/:id/house-membership', authenticate, invitationRedeemLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, paramId(req.params.id), 'owner', { allowSuspended: false });
  await assertNotLockedOut(req, 'house');
  const { code, shopNumber } = parse(invitationCodeSchema.extend({ shopNumber: z.string().trim().toUpperCase().min(1).max(20).optional() }), req.body);
  if (await HouseMembership.exists({ shopId: shop._id, live: true })) {
    throw conflict('This shop already has an active or pending house membership', 'MEMBERSHIP_EXISTS');
  }
  const inv = await findHouseInvitation(code);
  if (!inv) {
    await recordCodeFailure(req, 'house', 'not_found');
    throw invalidCodeError();
  }
  const status = effectiveStatus(inv);
  if (status !== 'active') {
    await recordCodeFailure(req, 'house', status);
    throw unusableError(status);
  }
  const house = await House.findById(inv.houseId);
  if (!house || house.status !== 'active') throw invalidCodeError();
  const number = shopNumber ?? shop.shopNumber;
  if (await Shop.exists({ houseId: house._id, shopNumber: number, occupiesSlot: true, _id: { $ne: shop._id } })) {
    throw conflict(`Shop ${number} is already registered in that house`, 'SHOP_NUMBER_TAKEN');
  }
  const consumed = await consumeInvitation(HouseInvitation, inv._id, { userId: a.userId, shopId: shop._id });
  if (!consumed) throw unusableError(effectiveStatus((await HouseInvitation.findById(inv._id).lean())!));
  const previousHouseId = shop.houseId;
  let membership;
  try {
    shop.set({ houseId: house._id, marketId: house.marketId, sectionId: house.sectionId, shopNumber: number, status: 'pending_membership', occupiesSlot: true });
    await shop.save();
    membership = await HouseMembership.create({ houseId: house._id, shopId: shop._id, invitationId: inv._id, requestedBy: a.userId, history: [{ status: 'pending', by: a.userId, reason: 'rejoin/move' }] });
  } catch (err) {
    await releaseInvitationUse(HouseInvitation, inv._id, a.userId);
    throw err;
  }
  await refreshShopListing(shop._id);
  await recountHouseShops(previousHouseId);
  await audit({ req, action: 'shop.house_change_requested', category: 'shop', targetType: 'shop', targetId: shop._id, shopId: shop._id, houseId: house._id, metadata: { from: String(previousHouseId), to: String(house._id) } });
  if (house.autoApproveMemberships) await decideMembership(membership, 'approve', null, 'Automatic approval enabled for this house', req, true);
  else {
    const staff = await HouseStaff.find({ houseId: house._id, status: 'active' }).select('userId').lean();
    await notify(staff.map((s) => s.userId), {
      type: 'house_invitation.redeemed',
      title: 'New shop membership request',
      body: `${shop.name} (Shop ${number}) is requesting to join House ${house.houseNumber}.`,
      data: { houseId: String(house._id), membershipId: String(membership._id) },
      dedupeKey: `membership-request:${membership._id}`,
    });
  }
  ok(res, (await toMembershipDtos([await HouseMembership.findById(membership._id).lean()]))[0], 201);
});

/** Shop owner disputes a rejection or removal; the house head may respond and an admin resolves. */
shopsRouter.post('/:id/house-membership/:membershipId/dispute', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, paramId(req.params.id), 'owner', { allowSuspended: true });
  const { statement } = parse(z.object({ statement: z.string().trim().min(10).max(2000) }), req.body);
  const m = await HouseMembership.findOne({ _id: paramId(req.params.membershipId), shopId: shop._id });
  if (!m) throw notFound('Membership');
  if (!['rejected', 'removed'].includes(m.status)) throw badRequest('Only rejected or removed memberships can be disputed');
  if (m.dispute?.status === 'open' || m.dispute?.status === 'responded') throw conflict('A dispute is already open');
  m.set('dispute', { openedBy: a.userId, openedAt: new Date(), statement, status: 'open' });
  await m.save();
  await audit({ req, action: 'house_membership.disputed', category: 'house', targetType: 'house_membership', targetId: m._id, houseId: m.houseId, shopId: shop._id });
  const staff = await HouseStaff.find({ houseId: m.houseId, status: 'active' }).select('userId').lean();
  await notify(staff.map((s) => s.userId), { type: 'membership.updated', title: 'Membership dispute', body: `${shop.name} disputed a membership decision.`, data: { houseId: String(m.houseId), membershipId: String(m._id) } });
  ok(res, (await toMembershipDtos([m.toObject()]))[0]);
});

/* Profile & settings -------------------------------------------------------------------------- */

shopsRouter.patch('/:id', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, paramId(req.params.id), 'owner', { allowSuspended: true });
  const input = parse(shopUpdateSchema, req.body);
  if (input.categoryIds?.length) {
    const n = await Category.countDocuments({ _id: { $in: input.categoryIds }, active: true });
    if (n !== new Set(input.categoryIds).size) throw badRequest('One or more categories are invalid', 'INVALID_CATEGORY');
  }
  const { contactPreferences, ...rest } = input;
  shop.set(rest);
  if (contactPreferences) for (const [k, v] of Object.entries(contactPreferences)) shop.set(`contactPreferences.${k}`, v);
  if (input.name && input.name !== shop.name) shop.slug = await uniqueShopSlug(input.name);
  await shop.save();
  await audit({ req, action: 'shop.updated', category: 'shop', targetType: 'shop', targetId: shop._id, shopId: shop._id, metadata: { fields: Object.keys(input) } });
  ok(res, await toShopDtoForStaff(shop));
});

shopsRouter.put('/:id/fulfilment', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, paramId(req.params.id), 'owner', { allowSuspended: true });
  const input = parse(shopFulfilmentSchema, req.body);
  if (!input.pickupAvailable && !input.deliveryAvailable) throw badRequest('Enable pickup, delivery, or both', 'NO_FULFILMENT');
  if (input.deliveryAvailable && !input.deliveryOptions.some((o) => o.active)) throw badRequest('Add at least one active delivery option', 'NO_DELIVERY_OPTION');
  if (input.acceptedPaymentMethods.includes('cash_on_pickup') && !input.pickupAvailable) {
    throw badRequest('Cash on pickup requires pickup to be enabled', 'INVALID_PAYMENT_METHOD');
  }
  shop.set({
    pickupAvailable: input.pickupAvailable,
    pickupInstructions: input.pickupInstructions,
    deliveryAvailable: input.deliveryAvailable,
    deliveryOptions: input.deliveryOptions,
    acceptedPaymentMethods: input.acceptedPaymentMethods,
    bankTransferInstructions: input.bankTransferInstructions,
  });
  await shop.save();
  await audit({ req, action: 'shop.fulfilment_updated', category: 'shop', targetType: 'shop', targetId: shop._id, shopId: shop._id });
  ok(res, await toShopDtoForStaff(shop));
});

for (const kind of ['logo', 'cover'] as const) {
  shopsRouter.post(`/:id/${kind}`, authenticate, uploadLimiter, imageUpload.single('image'), async (req, res) => {
    const a = requireAuth(req);
    const { shop } = await requireShopAccess(a, paramId(req.params.id), 'owner', { allowSuspended: true });
    if (!req.file) throw badRequest('Attach an image in the "image" field');
    const img = await processUploadedImage(req.file.buffer, kind === 'logo' ? { maxDimension: 512, thumbnailSize: 256 } : { maxDimension: 1600 });
    const key = storageKey('public', 'shops', String(shop._id), `${kind}-${crypto.randomUUID()}.webp`);
    await storage().put(key, kind === 'logo' ? img.thumbnail : img.full, img.contentType, 'public');
    const oldKey = kind === 'logo' ? shop.logoKey : shop.coverKey;
    shop.set(kind === 'logo' ? { logoUrl: storage().publicUrl(key), logoKey: key } : { coverUrl: storage().publicUrl(key), coverKey: key });
    await shop.save();
    if (oldKey) await storage().delete(oldKey).catch(() => undefined);
    ok(res, await toShopDtoForStaff(shop));
  });
}

shopsRouter.post('/:id/close', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, paramId(req.params.id), 'owner', { allowSuspended: true });
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
  const open = await Order.countDocuments({ shopId: shop._id, status: { $in: ['pending_acceptance', 'accepted', 'processing', 'ready', 'dispatched', 'disputed', 'refund_pending'] } });
  if (open > 0) throw conflict(`Resolve your ${open} open order(s) before closing the shop`, 'OPEN_ORDERS');
  shop.set({ status: 'closed', occupiesSlot: false, closedAt: new Date() });
  await shop.save();
  await HouseMembership.updateMany({ shopId: shop._id, live: true }, { $set: { status: 'left', live: false, reason: 'shop closed' }, $push: { history: { status: 'left', by: a.userId, reason: 'shop closed' } } });
  await ShopMembership.updateMany({ shopId: shop._id, role: 'worker', status: 'active' }, { $set: { status: 'revoked', revokedAt: new Date(), revokeReason: 'shop_closed' } });
  await refreshShopListing(shop._id);
  await recountHouseShops(shop.houseId);
  await audit({ req, action: 'shop.closed', category: 'shop', targetType: 'shop', targetId: shop._id, shopId: shop._id, houseId: shop.houseId, reason });
  ok(res, { closed: true });
});

/** Ownership transfer is a reviewed request; an administrator completes it after verification. */
shopsRouter.post('/:id/ownership-transfer', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, paramId(req.params.id), 'owner', { allowSuspended: true });
  const input = parse(z.object({ newOwnerIdentifier: z.string().trim().min(3).max(120), evidence: z.string().trim().min(10).max(2000) }), req.body);
  const target = input.newOwnerIdentifier.includes('@')
    ? await User.findOne({ email: input.newOwnerIdentifier.toLowerCase(), status: 'active' })
    : await User.findOne({ phone: input.newOwnerIdentifier, status: 'active' });
  if (!target) throw notFound('User');
  if (String(target._id) === a.userId) throw badRequest('You already own this shop');
  if (await VerificationRequest.exists({ type: 'shop_ownership', targetId: shop._id, status: 'pending' })) throw conflict('An ownership request is already pending');
  const vr = await VerificationRequest.create({
    type: 'shop_ownership',
    targetId: shop._id,
    marketId: shop.marketId,
    requestedBy: a.userId,
    proposedOwnerId: target._id,
    evidence: input.evidence,
    history: [{ status: 'pending', actorId: a.userId }],
  });
  await audit({ req, action: 'shop.ownership_transfer_requested', category: 'shop', targetType: 'verification_request', targetId: vr._id, shopId: shop._id, metadata: { proposedOwnerId: String(target._id) } });
  ok(res, { id: String(vr._id), status: vr.status }, 201);
});

/* Workers ------------------------------------------------------------------------------------- */

shopsRouter.get('/:id/workers', authenticate, async (req, res) => {
  const { shop } = await requireShopAccess(requireAuth(req), paramId(req.params.id), 'owner', { allowSuspended: true });
  const q = parse(z.object({ includeRevoked: z.coerce.boolean().optional() }), req.query);
  const members = await ShopMembership.find({ shopId: shop._id, ...(q.includeRevoked ? {} : { status: 'active' }) }).sort({ role: -1, createdAt: 1 }).limit(200).lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).select('fullName').lean();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const activity = await AuditLog.aggregate([
    { $match: { shopId: shop._id, createdAt: { $gt: since }, actorId: { $in: members.map((m) => m.userId) } } },
    { $group: { _id: '$actorId', n: { $sum: 1 } } },
  ]);
  ok(
    res,
    members.map((m) => ({
      membershipId: String(m._id),
      userId: String(m.userId),
      fullName: users.find((u) => String(u._id) === String(m.userId))?.fullName ?? '',
      title: m.title ?? undefined,
      role: m.role,
      permissions: m.permissions,
      status: m.status,
      joinedAt: iso(m.createdAt),
      actionsLast30Days: activity.find((x) => String(x._id) === String(m.userId))?.n ?? 0,
    })),
  );
});

shopsRouter.patch('/:id/workers/:membershipId', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, paramId(req.params.id), 'owner');
  const input = parse(z.object({ permissions: z.array(z.enum(SHOP_PERMISSIONS)).min(1).optional(), title: z.string().trim().max(60).optional() }), req.body);
  const m = await ShopMembership.findOne({ _id: paramId(req.params.membershipId), shopId: shop._id, status: 'active' });
  if (!m) throw notFound('Worker');
  if (m.role === 'owner') throw forbidden('Owner permissions cannot be changed');
  const before = [...m.permissions];
  if (input.permissions) m.permissions = input.permissions;
  if (input.title !== undefined) m.title = input.title;
  await m.save();
  await audit({ req, action: 'shop.worker_permissions_changed', category: 'shop', targetType: 'shop_membership', targetId: m._id, shopId: shop._id, metadata: { before, after: m.permissions } });
  ok(res, { membershipId: String(m._id), permissions: m.permissions, title: m.title });
});

shopsRouter.delete('/:id/workers/:membershipId', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, paramId(req.params.id), 'owner', { allowSuspended: true });
  const { reason } = parse(z.object({ reason: z.string().trim().max(300).optional() }), req.body ?? {});
  const m = await ShopMembership.findOne({ _id: paramId(req.params.membershipId), shopId: shop._id, status: 'active' });
  if (!m) throw notFound('Worker');
  if (m.role === 'owner') throw forbidden('The owner cannot be removed');
  m.set({ status: 'revoked', revokedAt: new Date(), revokedBy: a.userId, revokeReason: reason });
  await m.save();
  // Access is re-checked per request; also drop live socket subscriptions immediately.
  realtimeServer()?.in(rooms.user(String(m.userId))).socketsLeave(rooms.shopStaff(String(shop._id)));
  await audit({ req, action: 'shop.worker_removed', category: 'shop', targetType: 'shop_membership', targetId: m._id, shopId: shop._id, reason });
  ok(res, { removed: true });
});

/** A worker leaves a shop voluntarily. */
shopsRouter.post('/:id/leave', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const m = await ShopMembership.findOne({ shopId: paramId(req.params.id), userId: a.userId, status: 'active' });
  if (!m) throw notFound('Membership');
  if (m.role === 'owner') throw forbidden('Owners cannot leave their shop; transfer ownership or close it');
  m.set({ status: 'revoked', revokedAt: new Date(), revokedBy: a.userId, revokeReason: 'left' });
  await m.save();
  await audit({ req, action: 'shop.worker_left', category: 'shop', targetType: 'shop_membership', targetId: m._id, shopId: m.shopId });
  ok(res, { left: true });
});

/** Recent shop activity for the owner (actions by staff). */
shopsRouter.get('/:id/activity', authenticate, async (req, res) => {
  const { shop } = await requireShopAccess(requireAuth(req), paramId(req.params.id), 'owner', { allowSuspended: true });
  const { page, limit } = parse(paginationSchema, req.query);
  const [items, total] = await Promise.all([
    AuditLog.find({ shopId: shop._id }).sort({ createdAt: -1 }).skip(skipFor(page, limit)).limit(limit).lean(),
    AuditLog.countDocuments({ shopId: shop._id }),
  ]);
  const actors = await User.find({ _id: { $in: items.map((i) => i.actorId).filter(Boolean) } }).select('fullName').lean();
  paginated(
    res,
    items.map((l) => ({
      id: String(l._id),
      action: l.action,
      actorName: actors.find((u) => String(u._id) === String(l.actorId))?.fullName ?? 'System',
      reason: l.reason,
      at: iso(l.createdAt),
    })),
    pageMeta(page, limit, total),
  );
});
