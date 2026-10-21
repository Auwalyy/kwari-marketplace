import { Router } from 'express';
import { z } from 'zod';
import { objectId, paginationSchema, reportSchema, verificationRequestSchema } from '@kkdm/shared';
import { Block, Report, VerificationRequest } from './trust.models';
import { Shop } from '../shops/shop.models';
import { Product } from '../products/product.models';
import { Message } from '../chats/chat.models';
import { Review } from '../reviews/review.model';
import { User } from '../users/user.model';
import { Order } from '../orders/order.models';
import { House } from '../markets/market.models';
import { authenticate, requireAuth } from '../../middleware/auth';
import { writeLimiter } from '../../middleware/rateLimit';
import { requireConversationAccess } from '../chats/chat.service';
import { requireHouseAccess, requireShopAccess } from '../../services/access';
import { audit } from '../../services/audit';
import { parse, paramId } from '../../utils/validate';
import { badRequest, conflict, forbidden, iso, notFound, ok } from '../../utils/http';

/* Reports ------------------------------------------------------------------------------------- */

export const reportsRouter = Router();
reportsRouter.use(authenticate);

/** Resolves the reported target (and checks the reporter may see it) to scope the report by market/shop. */
async function resolveTarget(auth: ReturnType<typeof requireAuth>, type: string, id: string) {
  switch (type) {
    case 'shop': {
      const s = await Shop.findById(id).select('marketId').lean();
      if (!s) throw notFound('Shop');
      return { marketId: s.marketId, shopId: s._id };
    }
    case 'product': {
      const p = await Product.findById(id).select('marketId shopId').lean();
      if (!p) throw notFound('Product');
      return { marketId: p.marketId, shopId: p.shopId };
    }
    case 'message': {
      const m = await Message.findById(id).select('conversationId').lean();
      if (!m) throw notFound('Message');
      // Only conversation participants can report a message.
      const { conversation } = await requireConversationAccess(auth, String(m.conversationId));
      const s = await Shop.findById(conversation.shopId).select('marketId').lean();
      return { marketId: s?.marketId ?? null, shopId: conversation.shopId };
    }
    case 'review': {
      const r = await Review.findById(id).select('shopId').lean();
      if (!r) throw notFound('Review');
      const s = await Shop.findById(r.shopId).select('marketId').lean();
      return { marketId: s?.marketId ?? null, shopId: r.shopId };
    }
    case 'order': {
      const o = await Order.findById(id).select('customerId shopId marketId').lean();
      if (!o) throw notFound('Order');
      if (String(o.customerId) !== auth.userId) await requireShopAccess(auth, String(o.shopId), 'orders.manage', { allowSuspended: true });
      return { marketId: o.marketId, shopId: o.shopId };
    }
    case 'user': {
      if (!(await User.exists({ _id: id }))) throw notFound('User');
      return { marketId: null, shopId: null };
    }
    default:
      throw badRequest('Unsupported report target');
  }
}

reportsRouter.post('/', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(reportSchema, req.body);
  if (input.targetType === 'user' && input.targetId === a.userId) throw badRequest('You cannot report yourself');
  const scope = await resolveTarget(a, input.targetType, input.targetId);
  if (await Report.exists({ reporterId: a.userId, targetType: input.targetType, targetId: input.targetId, status: { $in: ['open', 'investigating'] } })) {
    throw conflict('You already have an open report about this', 'REPORT_EXISTS');
  }
  const r = await Report.create({ ...input, ...scope, reporterId: a.userId });
  await audit({ req, action: 'report.created', category: 'trust', targetType: input.targetType, targetId: input.targetId, shopId: scope.shopId, metadata: { category: input.category } });
  ok(res, { id: String(r._id), status: r.status }, 201);
});

reportsRouter.get('/mine', async (req, res) => {
  const list = await Report.find({ reporterId: requireAuth(req).userId }).sort({ createdAt: -1 }).limit(100).lean();
  ok(
    res,
    list.map((r) => ({ id: String(r._id), targetType: r.targetType, targetId: String(r.targetId), category: r.category, description: r.description, status: r.status, resolution: r.resolution, createdAt: iso(r.createdAt) })),
  );
});

/* Blocks -------------------------------------------------------------------------------------- */

export const blocksRouter = Router();
blocksRouter.use(authenticate);

const blockInput = z.object({
  blockedType: z.enum(['user', 'shop']),
  blockedId: objectId,
  /** When set, the block is made on behalf of a shop (requires chats.manage). */
  asShopId: objectId.optional(),
  reason: z.string().trim().max(300).optional(),
});

blocksRouter.post('/', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(blockInput, req.body);
  let blockerType: 'user' | 'shop' = 'user';
  let blockerId = a.userId;
  if (input.asShopId) {
    await requireShopAccess(a, input.asShopId, 'chats.manage');
    if (input.blockedType !== 'user') throw badRequest('Shops can block customers only');
    blockerType = 'shop';
    blockerId = input.asShopId;
  }
  if (input.blockedType === 'user' && input.blockedId === a.userId) throw badRequest('You cannot block yourself');
  const exists = input.blockedType === 'user' ? await User.exists({ _id: input.blockedId }) : await Shop.exists({ _id: input.blockedId });
  if (!exists) throw notFound(input.blockedType === 'user' ? 'User' : 'Shop');
  await Block.updateOne(
    { blockerType, blockerId, blockedType: input.blockedType, blockedId: input.blockedId },
    { $setOnInsert: { createdBy: a.userId, reason: input.reason } },
    { upsert: true },
  );
  await audit({ req, action: 'block.created', category: 'trust', targetType: input.blockedType, targetId: input.blockedId, shopId: blockerType === 'shop' ? blockerId : null });
  ok(res, { blocked: true }, 201);
});

blocksRouter.get('/', async (req, res) => {
  const a = requireAuth(req);
  const q = parse(z.object({ asShopId: objectId.optional() }), req.query);
  if (q.asShopId) await requireShopAccess(a, q.asShopId, 'chats.manage', { allowSuspended: true });
  const list = await Block.find(q.asShopId ? { blockerType: 'shop', blockerId: q.asShopId } : { blockerType: 'user', blockerId: a.userId }).sort({ createdAt: -1 }).limit(200).lean();
  const users = await User.find({ _id: { $in: list.filter((b) => b.blockedType === 'user').map((b) => b.blockedId) } }).select('fullName').lean();
  const shops = await Shop.find({ _id: { $in: list.filter((b) => b.blockedType === 'shop').map((b) => b.blockedId) } }).select('name').lean();
  ok(
    res,
    list.map((b) => ({
      id: String(b._id),
      blockedType: b.blockedType,
      blockedId: String(b.blockedId),
      name: b.blockedType === 'user' ? users.find((u) => String(u._id) === String(b.blockedId))?.fullName : shops.find((s) => String(s._id) === String(b.blockedId))?.name,
      createdAt: iso(b.createdAt),
    })),
  );
});

blocksRouter.delete('/:id', async (req, res) => {
  const a = requireAuth(req);
  const b = await Block.findById(paramId(req.params.id));
  if (!b) throw notFound('Block');
  if (b.blockerType === 'user' && String(b.blockerId) !== a.userId) throw forbidden();
  if (b.blockerType === 'shop') await requireShopAccess(a, String(b.blockerId), 'chats.manage', { allowSuspended: true });
  await b.deleteOne();
  ok(res, { unblocked: true });
});

/** Convenience: block the other side of a conversation. */
blocksRouter.post('/conversation/:conversationId', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { conversation, side } = await requireConversationAccess(a, paramId(req.params.conversationId));
  const doc =
    side === 'customer'
      ? { blockerType: 'user', blockerId: a.userId, blockedType: 'shop', blockedId: conversation.shopId }
      : { blockerType: 'shop', blockerId: conversation.shopId, blockedType: 'user', blockedId: conversation.customerId };
  await Block.updateOne(doc, { $setOnInsert: { createdBy: a.userId } }, { upsert: true });
  await audit({ req, action: 'block.created', category: 'trust', targetType: doc.blockedType, targetId: doc.blockedId as any });
  ok(res, { blocked: true }, 201);
});

/* Verification requests ----------------------------------------------------------------------- */

export const verificationsRouter = Router();
verificationsRouter.use(authenticate);

/**
 * Requests verification of a house or shop (house-head claims and ownership transfers have their own
 * endpoints). A valid invitation code is never treated as proof of ownership.
 */
verificationsRouter.post('/', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(verificationRequestSchema, req.body);
  let marketId = null;
  if (input.type === 'house') {
    const { house } = await requireHouseAccess(a, input.targetId, { allowManagers: false });
    marketId = house.marketId;
  } else if (input.type === 'shop') {
    const { shop } = await requireShopAccess(a, input.targetId, 'owner', { allowSuspended: true });
    if (shop.status !== 'active') throw badRequest('The shop must be approved by its house first', 'SHOP_NOT_ACTIVE');
    marketId = shop.marketId;
  } else if (input.type === 'house_head') {
    const { house } = await requireHouseAccess(a, input.targetId, { headOnly: true, allowManagers: false });
    marketId = house.marketId;
  } else {
    throw badRequest('Use the ownership transfer flow for shop ownership', 'USE_OWNERSHIP_FLOW');
  }
  if (await VerificationRequest.exists({ type: input.type, targetId: input.targetId, status: 'pending' })) throw conflict('A verification request is already pending', 'VERIFICATION_PENDING');
  const vr = await VerificationRequest.create({ ...input, marketId, requestedBy: a.userId, history: [{ status: 'pending', actorId: a.userId }] });
  if (input.type === 'house') await House.updateOne({ _id: input.targetId, verificationStatus: { $ne: 'verified' } }, { $set: { verificationStatus: 'pending' } });
  if (input.type === 'house_head') await House.updateOne({ _id: input.targetId, headVerificationStatus: { $ne: 'verified' } }, { $set: { headVerificationStatus: 'pending' } });
  if (input.type === 'shop') await Shop.updateOne({ _id: input.targetId, verificationStatus: { $ne: 'verified' } }, { $set: { verificationStatus: 'pending' } });
  await audit({ req, action: 'verification.requested', category: 'trust', targetType: input.type, targetId: input.targetId });
  ok(res, { id: String(vr._id), status: vr.status }, 201);
});

verificationsRouter.get('/mine', async (req, res) => {
  const q = parse(paginationSchema, req.query);
  const list = await VerificationRequest.find({ requestedBy: requireAuth(req).userId }).sort({ createdAt: -1 }).limit(q.limit).lean();
  ok(
    res,
    list.map((v) => ({ id: String(v._id), type: v.type, targetId: String(v.targetId), status: v.status, decisionReason: v.decisionReason, appeal: v.appeal?.statement ? { statement: v.appeal.statement, at: iso(v.appeal.at) } : null, createdAt: iso(v.createdAt), reviewedAt: iso(v.reviewedAt) })),
  );
});

verificationsRouter.post('/:id/appeal', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { statement } = parse(z.object({ statement: z.string().trim().min(10).max(2000) }), req.body);
  const vr = await VerificationRequest.findOne({ _id: paramId(req.params.id), requestedBy: a.userId });
  if (!vr) throw notFound('Verification request');
  if (vr.status !== 'rejected') throw conflict('Only rejected requests can be appealed');
  vr.set({ status: 'appealed', appeal: { statement, at: new Date() } });
  vr.history.push({ status: 'appealed', actorId: a.userId, note: statement } as any);
  await vr.save();
  await audit({ req, action: 'verification.appealed', category: 'trust', targetType: 'verification_request', targetId: vr._id });
  ok(res, { id: String(vr._id), status: vr.status });
});
