import { Router } from 'express';
import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { z } from 'zod';
import { objectId, sendMessageSchema, startConversationSchema } from '@kkdm/shared';
import { Conversation, Message } from './chat.models';
import { getOrCreateConversation, markRead, postMessage, requireConversationAccess, toConversationDtos, toMessageDtos } from './chat.service';
import { ShopMembership } from '../shops/shop.models';
import { authenticate, requireAuth } from '../../middleware/auth';
import { imageUpload } from '../../middleware/upload';
import { messagingLimiter, uploadLimiter } from '../../middleware/rateLimit';
import { requireShopAccess } from '../../services/access';
import { processUploadedImage } from '../../services/images';
import { storage, storageKey } from '../../services/storage';
import { parse, paramId } from '../../utils/validate';
import { badRequest, notFound, ok, pageMeta, paginated, skipFor } from '../../utils/http';

export const chatsRouter = Router();
chatsRouter.use(authenticate);

const listQuery = z.object({
  as: z.enum(['customer', 'shop']).default('customer'),
  shopId: objectId.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

chatsRouter.get('/', async (req, res) => {
  const a = requireAuth(req);
  const q = parse(listQuery, req.query);
  let filter: Record<string, unknown>;
  if (q.as === 'shop') {
    if (!q.shopId) throw badRequest('shopId is required for shop conversations');
    await requireShopAccess(a, q.shopId, 'chats.manage', { allowSuspended: true });
    filter = { shopId: q.shopId };
  } else filter = { customerId: a.userId };
  const [items, total] = await Promise.all([
    Conversation.find(filter).sort({ lastMessageAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    Conversation.countDocuments(filter),
  ]);
  paginated(res, await toConversationDtos(items, q.as), pageMeta(q.page, q.limit, total));
});

/** Unread totals for the customer inbox and each shop inbox the user staffs. */
chatsRouter.get('/unread-count', async (req, res) => {
  const a = requireAuth(req);
  const [customer] = await Conversation.aggregate([{ $match: { customerId: new Types.ObjectId(a.userId) } }, { $group: { _id: null, n: { $sum: '$customerUnread' } } }]);
  const memberships = await ShopMembership.find({ userId: a.userId, status: 'active' }).lean();
  const shopIds = memberships.filter((m) => m.role === 'owner' || (m.permissions as string[]).includes('chats.manage')).map((m) => m.shopId);
  const shops = await Conversation.aggregate([{ $match: { shopId: { $in: shopIds } } }, { $group: { _id: '$shopId', n: { $sum: '$shopUnread' } } }]);
  ok(res, { customer: customer?.n ?? 0, shops: Object.fromEntries(shops.map((s) => [String(s._id), s.n])) });
});

chatsRouter.post('/', messagingLimiter, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(startConversationSchema, req.body);
  const conversation = await getOrCreateConversation(a.userId, input.shopId, input.productId);
  const access = { conversation, side: 'customer' as const };
  if (input.productId) await postMessage(access, a.userId, { type: 'product', productId: input.productId, clientMessageId: `start-${crypto.randomUUID()}` });
  if (input.message) await postMessage(access, a.userId, { type: 'text', text: input.message, clientMessageId: `start-${crypto.randomUUID()}` });
  const fresh = await Conversation.findById(conversation._id).lean();
  ok(res, (await toConversationDtos([fresh], 'customer'))[0], 201);
});

chatsRouter.get('/:id', async (req, res) => {
  const a = requireAuth(req);
  const access = await requireConversationAccess(a, paramId(req.params.id));
  ok(res, { ...(await toConversationDtos([access.conversation.toObject()], access.side))[0], viewerSide: access.side });
});

/** Cursor pagination: newest first; pass `before` (ISO date) to load older messages. */
chatsRouter.get('/:id/messages', async (req, res) => {
  const a = requireAuth(req);
  const access = await requireConversationAccess(a, paramId(req.params.id));
  const q = parse(z.object({ before: z.coerce.date().optional(), after: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }), req.query);
  const filter: Record<string, unknown> = { conversationId: access.conversation._id };
  if (q.before) filter.createdAt = { $lt: q.before };
  if (q.after) filter.createdAt = { $gt: q.after };
  const items = await Message.find(filter).sort({ createdAt: q.after ? 1 : -1 }).limit(q.limit + 1).lean();
  const hasMore = items.length > q.limit;
  const page = items.slice(0, q.limit);
  ok(res, { messages: await toMessageDtos(page, access.side), hasMore, viewerSide: access.side });
});

chatsRouter.post('/:id/messages', messagingLimiter, async (req, res) => {
  const a = requireAuth(req);
  const access = await requireConversationAccess(a, paramId(req.params.id));
  const input = parse(sendMessageSchema, req.body);
  if (input.type === 'image') throw badRequest('Upload images with POST /conversations/:id/images', 'USE_IMAGE_UPLOAD');
  ok(res, await postMessage(access, a.userId, input), 201);
});

chatsRouter.post('/:id/images', uploadLimiter, imageUpload.single('image'), async (req, res) => {
  const a = requireAuth(req);
  const access = await requireConversationAccess(a, paramId(req.params.id));
  if (!req.file) throw badRequest('Attach an image in the "image" field');
  const { clientMessageId, text } = parse(z.object({ clientMessageId: z.string().trim().min(6).max(64), text: z.string().trim().max(1000).optional() }), req.body);
  const img = await processUploadedImage(req.file.buffer, { maxDimension: 1600 });
  const key = storageKey('private', 'chat', String(access.conversation._id), `${crypto.randomUUID()}.webp`);
  await storage().put(key, img.full, img.contentType, 'private');
  ok(res, await postMessage(access, a.userId, { type: 'image', clientMessageId, text, imageUrl: 'private', imageKey: key }), 201);
});

/**
 * Streams a private chat image to an authorised participant. It is never a redirect to a signed storage
 * URL: phones re-send the login header on redirects, and S3/R2 reject a request carrying two kinds of
 * authorisation (HTTP 400), which left chat photos blank.
 */
chatsRouter.get('/:id/messages/:messageId/image', async (req, res) => {
  const a = requireAuth(req);
  const access = await requireConversationAccess(a, paramId(req.params.id));
  const m = await Message.findOne({ _id: paramId(req.params.messageId), conversationId: access.conversation._id, type: 'image', hiddenAt: null }).lean();
  if (!m?.imageKey) throw notFound('Image');
  const buf = await storage().get(m.imageKey);
  res.setHeader('content-type', 'image/webp');
  res.setHeader('cache-control', 'private, max-age=300');
  res.send(buf);
});

chatsRouter.post('/:id/read', async (req, res) => {
  const a = requireAuth(req);
  const access = await requireConversationAccess(a, paramId(req.params.id));
  await markRead(access, a.userId);
  ok(res, { read: true });
});
