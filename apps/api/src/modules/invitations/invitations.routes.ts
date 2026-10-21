import { Router } from 'express';
import { z } from 'zod';
import { createHouseInvitationSchema, createWorkerInvitationSchema, invitationCodeSchema, paginationSchema } from '@kkdm/shared';
import { HouseInvitation, ShopInvitation } from './invitation.models';
import {
  assertNotLockedOut,
  consumeInvitation,
  effectiveStatus,
  findHouseInvitation,
  findWorkerInvitation,
  invalidCodeError,
  newInvitationCode,
  recordCodeFailure,
  releaseInvitationUse,
  toHouseInvitationDto,
  toWorkerInvitationDto,
  unusableError,
} from './invitation.service';
import { House, HouseStaff } from '../markets/market.models';
import { Shop, ShopMembership } from '../shops/shop.models';
import { authenticate, requireAuth } from '../../middleware/auth';
import { invitationRedeemLimiter } from '../../middleware/rateLimit';
import { requireHouseAccess, requireShopAccess } from '../../services/access';
import { audit } from '../../services/audit';
import { breadcrumbFor } from '../../services/locations';
import { notify, notifyShopStaff } from '../notifications/notify';
import { parentId, parse, paramId } from '../../utils/validate';
import { conflict, forbidden, notFound, ok, pageMeta, paginated, skipFor } from '../../utils/http';
import { withTransaction } from '../../config/db';

const DAY = 86_400_000;

/* House → shop invitations (mounted at /houses/:houseId/invitations) --------------------------- */

export const houseInvitationsRouter = Router({ mergeParams: true });
houseInvitationsRouter.use(authenticate);

houseInvitationsRouter.post('/', async (req, res) => {
  const a = requireAuth(req);
  const { house } = await requireHouseAccess(a, parentId(req, 'houseId'), { requireVerifiedHead: true });
  if (house.status !== 'active') throw forbidden('This house is inactive');
  const input = parse(createHouseInvitationSchema, req.body);
  const { code, codeHash, preview } = newInvitationCode();
  const inv = await HouseInvitation.create({
    houseId: house._id,
    createdBy: a.userId,
    codeHash,
    codePreview: preview,
    expiresAt: new Date(Date.now() + input.expiresInDays * DAY),
    maxUses: input.maxUses,
    intendedShopName: input.intendedShopName,
    intendedShopNumber: input.intendedShopNumber,
    note: input.note,
  });
  await audit({ req, action: 'invitation.house_created', category: 'invitation', targetType: 'house_invitation', targetId: inv._id, houseId: house._id, metadata: { maxUses: input.maxUses, expiresInDays: input.expiresInDays } });
  const otherStaff = await HouseStaff.find({ houseId: house._id, status: 'active', userId: { $ne: a.userId } }).select('userId').lean();
  await notify(otherStaff.map((s) => s.userId), {
    type: 'house_invitation.created',
    title: 'Shop invitation created',
    body: `${a.fullName} created a shop invitation for House ${house.houseNumber}.`,
    data: { houseId: String(house._id), invitationId: String(inv._id) },
  });
  // The plain code is returned exactly once; only its hash is stored.
  ok(res, toHouseInvitationDto(inv, code), 201);
});

houseInvitationsRouter.get('/', async (req, res) => {
  const { house } = await requireHouseAccess(requireAuth(req), parentId(req, 'houseId'));
  const { page, limit } = parse(paginationSchema, req.query);
  const filter = { houseId: house._id };
  const [items, total] = await Promise.all([
    HouseInvitation.find(filter).sort({ createdAt: -1 }).skip(skipFor(page, limit)).limit(limit).lean(),
    HouseInvitation.countDocuments(filter),
  ]);
  paginated(res, items.map((i) => toHouseInvitationDto(i)), pageMeta(page, limit, total));
});

houseInvitationsRouter.post('/:invitationId/revoke', async (req, res) => {
  const a = requireAuth(req);
  const { house } = await requireHouseAccess(a, parentId(req, 'houseId'));
  const { reason } = parse(z.object({ reason: z.string().trim().max(300).optional() }), req.body);
  const inv = await HouseInvitation.findOne({ _id: paramId(req.params.invitationId), houseId: house._id });
  if (!inv) throw notFound('Invitation');
  if (inv.status === 'revoked') throw conflict('Invitation is already revoked');
  inv.set({ status: 'revoked', revokedAt: new Date(), revokedBy: a.userId, revokeReason: reason });
  await inv.save();
  await audit({ req, action: 'invitation.house_revoked', category: 'invitation', targetType: 'house_invitation', targetId: inv._id, houseId: house._id, reason });
  ok(res, toHouseInvitationDto(inv));
});

/** Revokes an invitation and issues a fresh code with the same settings. */
houseInvitationsRouter.post('/:invitationId/regenerate', async (req, res) => {
  const a = requireAuth(req);
  const { house } = await requireHouseAccess(a, parentId(req, 'houseId'), { requireVerifiedHead: true });
  const old = await HouseInvitation.findOne({ _id: paramId(req.params.invitationId), houseId: house._id });
  if (!old) throw notFound('Invitation');
  if (old.status !== 'revoked') old.set({ status: 'revoked', revokedAt: new Date(), revokedBy: a.userId, revokeReason: 'regenerated' });
  await old.save();
  const remainingMs = Math.max(old.expiresAt.getTime() - old.createdAt.getTime(), DAY);
  const { code, codeHash, preview } = newInvitationCode();
  const inv = await HouseInvitation.create({
    houseId: house._id,
    createdBy: a.userId,
    codeHash,
    codePreview: preview,
    expiresAt: new Date(Date.now() + remainingMs),
    maxUses: Math.max(old.maxUses - old.usedCount, 1),
    intendedShopName: old.intendedShopName,
    intendedShopNumber: old.intendedShopNumber,
    note: old.note,
    replacesId: old._id,
  });
  await audit({ req, action: 'invitation.house_regenerated', category: 'invitation', targetType: 'house_invitation', targetId: inv._id, houseId: house._id, metadata: { replaces: String(old._id) } });
  ok(res, toHouseInvitationDto(inv, code), 201);
});

/* Shop → worker invitations (mounted at /shops/:shopId/worker-invitations) --------------------- */

export const workerInvitationsRouter = Router({ mergeParams: true });
workerInvitationsRouter.use(authenticate);

workerInvitationsRouter.post('/', async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'owner');
  if (shop.status !== 'active') throw forbidden('Your shop must be approved before inviting workers', 'SHOP_NOT_ACTIVE');
  const input = parse(createWorkerInvitationSchema, req.body);
  const { code, codeHash, preview } = newInvitationCode();
  const inv = await ShopInvitation.create({
    shopId: shop._id,
    createdBy: a.userId,
    codeHash,
    codePreview: preview,
    permissions: input.permissions,
    title: input.title,
    expiresAt: new Date(Date.now() + input.expiresInDays * DAY),
    maxUses: input.maxUses,
  });
  await audit({ req, action: 'invitation.worker_created', category: 'invitation', targetType: 'shop_invitation', targetId: inv._id, shopId: shop._id, metadata: { permissions: input.permissions } });
  ok(res, toWorkerInvitationDto(inv, code), 201);
});

workerInvitationsRouter.get('/', async (req, res) => {
  const { shop } = await requireShopAccess(requireAuth(req), parentId(req, 'shopId'), 'owner', { allowSuspended: true });
  const { page, limit } = parse(paginationSchema, req.query);
  const filter = { shopId: shop._id };
  const [items, total] = await Promise.all([
    ShopInvitation.find(filter).sort({ createdAt: -1 }).skip(skipFor(page, limit)).limit(limit).lean(),
    ShopInvitation.countDocuments(filter),
  ]);
  paginated(res, items.map((i) => toWorkerInvitationDto(i)), pageMeta(page, limit, total));
});

workerInvitationsRouter.post('/:invitationId/revoke', async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'owner', { allowSuspended: true });
  const inv = await ShopInvitation.findOne({ _id: paramId(req.params.invitationId), shopId: shop._id });
  if (!inv) throw notFound('Invitation');
  if (inv.status === 'revoked') throw conflict('Invitation is already revoked');
  inv.set({ status: 'revoked', revokedAt: new Date(), revokedBy: a.userId });
  await inv.save();
  await audit({ req, action: 'invitation.worker_revoked', category: 'invitation', targetType: 'shop_invitation', targetId: inv._id, shopId: shop._id });
  ok(res, toWorkerInvitationDto(inv));
});

/* Code preview & worker redemption (mounted at /invitations) ----------------------------------- */

export const invitationsRouter = Router();
invitationsRouter.use(authenticate);

/** Shows which house a code belongs to before the user fills in shop details. Does not consume it. */
invitationsRouter.post('/house/preview', invitationRedeemLimiter, async (req, res) => {
  await assertNotLockedOut(req, 'house');
  const { code } = parse(invitationCodeSchema, req.body);
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
  const house = await House.findById(inv.houseId).lean();
  if (!house || house.status !== 'active') throw invalidCodeError();
  ok(res, {
    house: { id: String(house._id), houseNumber: house.houseNumber, name: house.name, breadcrumb: await breadcrumbFor(house._id) },
    expiresAt: inv.expiresAt.toISOString(),
    remainingUses: inv.maxUses - inv.usedCount,
    intendedShopName: inv.intendedShopName ?? null,
    intendedShopNumber: inv.intendedShopNumber ?? null,
    autoApprove: !!house.autoApproveMemberships,
  });
});

invitationsRouter.post('/worker/preview', invitationRedeemLimiter, async (req, res) => {
  await assertNotLockedOut(req, 'worker');
  const { code } = parse(invitationCodeSchema, req.body);
  const inv = await findWorkerInvitation(code);
  if (!inv) {
    await recordCodeFailure(req, 'worker', 'not_found');
    throw invalidCodeError();
  }
  const status = effectiveStatus(inv);
  if (status !== 'active') {
    await recordCodeFailure(req, 'worker', status, { invitationId: String(inv._id) });
    throw unusableError(status);
  }
  const shop = await Shop.findById(inv.shopId).select('name slug status houseId shopNumber').lean();
  if (!shop || shop.status !== 'active') throw invalidCodeError();
  ok(res, {
    shop: { id: String(shop._id), name: shop.name, slug: shop.slug, breadcrumb: await breadcrumbFor(shop.houseId, shop.shopNumber) },
    permissions: inv.permissions,
    title: inv.title ?? null,
    expiresAt: inv.expiresAt.toISOString(),
  });
});

/**
 * Joins a shop as a worker. Grants only the permissions on the invitation — never ownership — and
 * refuses to touch an existing membership in that shop.
 */
invitationsRouter.post('/worker/redeem', invitationRedeemLimiter, async (req, res) => {
  const a = requireAuth(req);
  await assertNotLockedOut(req, 'worker');
  const { code } = parse(invitationCodeSchema, req.body);
  const inv = await findWorkerInvitation(code);
  if (!inv) {
    await recordCodeFailure(req, 'worker', 'not_found');
    throw invalidCodeError();
  }
  const status = effectiveStatus(inv);
  if (status !== 'active') {
    await recordCodeFailure(req, 'worker', status, { invitationId: String(inv._id) });
    throw unusableError(status);
  }
  const shop = await Shop.findById(inv.shopId);
  if (!shop || shop.status !== 'active') throw invalidCodeError();
  if (String(shop.ownerId) === a.userId) throw conflict('You already own this shop', 'ALREADY_OWNER');
  if (await ShopMembership.exists({ shopId: shop._id, userId: a.userId, status: 'active' })) {
    throw conflict('You are already a member of this shop. Ask the owner to change your permissions instead.', 'ALREADY_MEMBER');
  }

  const membership = await withTransaction(async (session) => {
    const consumed = await consumeInvitation(ShopInvitation, inv._id, { userId: a.userId, shopId: shop._id }, session);
    if (!consumed) throw unusableError(effectiveStatus((await ShopInvitation.findById(inv._id).lean())!));
    try {
      const [m] = await ShopMembership.create(
        [{ shopId: shop._id, userId: a.userId, role: 'worker', permissions: inv.permissions, title: inv.title, invitationId: inv._id, addedBy: inv.createdBy }],
        { session },
      );
      return m;
    } catch (err) {
      if (!session) await releaseInvitationUse(ShopInvitation, inv._id, a.userId);
      if ((err as { code?: number }).code === 11000) throw conflict('You are already a member of this shop', 'ALREADY_MEMBER');
      throw err;
    }
  });

  await audit({ req, action: 'invitation.worker_redeem', category: 'invitation', targetType: 'shop_membership', targetId: membership._id, shopId: shop._id, metadata: { invitationId: String(inv._id), permissions: membership.permissions } });
  await notifyShopStaff(shop._id, 'owner', {
    type: 'worker_invitation.redeemed',
    title: 'New worker joined',
    body: `${a.fullName} joined ${shop.name} as a worker.`,
    data: { shopId: String(shop._id), membershipId: String(membership._id) },
    dedupeKey: `worker-joined:${membership._id}`,
  });
  ok(res, { shopId: String(shop._id), shopName: shop.name, permissions: membership.permissions }, 201);
});
