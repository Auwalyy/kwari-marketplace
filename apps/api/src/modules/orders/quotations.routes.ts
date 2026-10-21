import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import {
  SOCKET_EVENTS,
  lineTotalKobo,
  objectId,
  paginationSchema,
  quotationOfferSchema,
  quotationRequestSchema,
  quotationRespondSchema,
  type QuotationDto,
} from '@kkdm/shared';
import { Cart, Quotation, type QuotationDoc } from './order.models';
import { newOrderReference } from './order.service';
import { Product } from '../products/product.models';
import { isPubliclyVisible } from '../products/product.service';
import { Shop } from '../shops/shop.models';
import { User } from '../users/user.model';
import { getOrCreateConversation, postMessage, assertNotBlocked } from '../chats/chat.service';
import { Conversation } from '../chats/chat.models';
import { notify, notifyShopStaff } from '../notifications/notify';
import { authenticate, requireAuth } from '../../middleware/auth';
import { messagingLimiter, writeLimiter } from '../../middleware/rateLimit';
import { requireShopAccess } from '../../services/access';
import { emitToShopStaff, emitToUser } from '../../services/realtime';
import { audit } from '../../services/audit';
import { parse, paramId } from '../../utils/validate';
import { badRequest, conflict, forbidden, iso, notFound, ok, pageMeta, paginated, skipFor } from '../../utils/http';

export const quotationsRouter = Router();
quotationsRouter.use(authenticate);

function effective(q: { status: string; expiresAt?: Date | null }) {
  return q.status === 'offered' && q.expiresAt && q.expiresAt < new Date() ? 'expired' : q.status;
}

async function toDtos(list: any[]): Promise<QuotationDto[]> {
  const shops = await Shop.find({ _id: { $in: list.map((q) => q.shopId) } }).select('name slug').lean();
  const users = await User.find({ _id: { $in: list.map((q) => q.customerId) } }).select('fullName').lean();
  return list.map((q) => {
    const s = shops.find((x) => String(x._id) === String(q.shopId));
    const status = effective(q) as QuotationDto['status'];
    const offered = q.items.every((i: any) => i.offeredUnitPriceKobo != null);
    return {
      id: String(q._id),
      reference: q.reference,
      shop: { id: String(q.shopId), name: s?.name ?? '', slug: s?.slug ?? '' },
      customer: { id: String(q.customerId), fullName: users.find((u) => String(u._id) === String(q.customerId))?.fullName ?? 'Customer' },
      items: q.items.map((i: any) => ({
        id: String(i._id),
        productId: String(i.productId),
        variantId: i.variantId ? String(i.variantId) : null,
        productName: i.productName,
        unit: i.unit,
        quantity: i.quantity,
        targetUnitPriceKobo: i.targetUnitPriceKobo ?? null,
        offeredUnitPriceKobo: i.offeredUnitPriceKobo ?? null,
        listUnitPriceKobo: i.listUnitPriceKobo,
      })),
      status,
      message: q.message ?? undefined,
      sellerNote: q.sellerNote ?? undefined,
      customerNote: q.customerNote ?? undefined,
      totalOfferedKobo: offered ? q.items.reduce((s: number, i: any) => s + lineTotalKobo(i.offeredUnitPriceKobo, i.quantity), 0) : null,
      expiresAt: iso(q.expiresAt),
      conversationId: q.conversationId ? String(q.conversationId) : null,
      orderId: q.orderId ? String(q.orderId) : null,
      history: (q.history ?? []).map((h: any) => ({ status: h.status, by: h.by, note: h.note, at: iso(h.at)! })),
      createdAt: iso(q.createdAt)!,
      updatedAt: iso(q.updatedAt)!,
    };
  });
}

async function broadcast(q: QuotationDoc, by: 'customer' | 'seller', summary: string) {
  const payload = { quotationId: String(q._id), reference: q.reference, status: q.status };
  emitToUser(String(q.customerId), SOCKET_EVENTS.quotationUpdated, payload);
  emitToShopStaff(String(q.shopId), SOCKET_EVENTS.quotationUpdated, payload);
  const n = { type: 'quotation.updated' as const, title: `Quotation ${q.reference}`, body: summary, data: { quotationId: String(q._id) }, dedupeKey: `quotation:${q._id}:${q.status}:${q.history.length}` };
  if (by === 'seller') await notify([q.customerId], n);
  else await notifyShopStaff(q.shopId, 'quotations.manage', n);
  if (q.conversationId) {
    const conversation = await Conversation.findById(q.conversationId);
    if (conversation) await postMessage({ conversation, side: by === 'seller' ? 'shop' : 'customer' }, null, { type: 'system', text: summary, quotationId: String(q._id) }, { skipBlockCheck: true });
  }
}

/** Customer requests a (wholesale) quotation; it is linked to the customer–shop conversation. */
quotationsRouter.post('/', messagingLimiter, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(quotationRequestSchema, req.body);
  const shop = await Shop.findById(input.shopId).lean();
  if (!shop || shop.status !== 'active') throw notFound('Shop');
  await assertNotBlocked(a.userId, shop._id);
  const products = await Product.find({ _id: { $in: input.items.map((i) => i.productId) }, shopId: shop._id }).lean();
  const items = input.items.map((i) => {
    const p = products.find((x) => String(x._id) === i.productId);
    if (!p || !isPubliclyVisible(p)) throw badRequest('One of the products is not available from this shop', 'INVALID_PRODUCT');
    const v = i.variantId ? p.variants.find((x) => String(x._id) === i.variantId) : null;
    if (p.variants.length && !v) throw badRequest(`Choose an option for ${p.name}`, 'VARIANT_REQUIRED');
    return {
      productId: p._id,
      variantId: v?._id ?? null,
      productName: v ? `${p.name} — ${v.label}` : p.name,
      unit: p.unit,
      quantity: i.quantity,
      listUnitPriceKobo: v?.priceOverrideKobo ?? p.retailPriceKobo,
      targetUnitPriceKobo: i.targetUnitPriceKobo ?? null,
    };
  });
  const conversation = await getOrCreateConversation(a.userId, String(shop._id));
  const q = await Quotation.create({
    reference: newOrderReference('QT'),
    shopId: shop._id,
    customerId: a.userId,
    conversationId: conversation._id,
    items,
    message: input.message,
    history: [{ status: 'requested', by: 'customer', actorId: a.userId, note: input.message }],
  });
  await postMessage({ conversation, side: 'customer' }, a.userId, { type: 'quotation', quotationId: String(q._id), text: input.message, clientMessageId: `qt-${crypto.randomUUID()}` });
  await notifyShopStaff(shop._id, 'quotations.manage', { type: 'quotation.new', title: 'New quotation request', body: `${a.fullName} requested a quotation (${items.length} item${items.length > 1 ? 's' : ''}).`, data: { quotationId: String(q._id), shopId: String(shop._id) }, dedupeKey: `quotation-new:${q._id}` });
  ok(res, (await toDtos([q.toObject()]))[0], 201);
});

quotationsRouter.get('/', async (req, res) => {
  const a = requireAuth(req);
  const q = parse(paginationSchema.extend({ as: z.enum(['customer', 'shop']).default('customer'), shopId: objectId.optional(), status: z.string().max(20).optional() }), req.query);
  let filter: Record<string, unknown>;
  if (q.as === 'shop') {
    if (!q.shopId) throw badRequest('shopId is required');
    await requireShopAccess(a, q.shopId, 'quotations.manage', { allowSuspended: true });
    filter = { shopId: q.shopId };
  } else filter = { customerId: a.userId };
  if (q.status) filter.status = q.status;
  const [items, total] = await Promise.all([
    Quotation.find(filter).sort({ updatedAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    Quotation.countDocuments(filter),
  ]);
  paginated(res, await toDtos(items), pageMeta(q.page, q.limit, total));
});

async function loadForViewer(req: any, id: string) {
  const a = requireAuth(req);
  const q = await Quotation.findById(id);
  if (!q) throw notFound('Quotation');
  if (String(q.customerId) === a.userId) return { q, side: 'customer' as const };
  await requireShopAccess(a, String(q.shopId), 'quotations.manage', { allowSuspended: true });
  return { q, side: 'seller' as const };
}

quotationsRouter.get('/:id', async (req, res) => {
  const { q } = await loadForViewer(req, paramId(req.params.id));
  ok(res, (await toDtos([q.toObject()]))[0]);
});

/** Seller makes (or re-makes after a counter) a price offer. */
quotationsRouter.post('/:id/offer', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { q, side } = await loadForViewer(req, paramId(req.params.id));
  if (side !== 'seller') throw forbidden('Only the shop can make an offer');
  if (!['requested', 'countered', 'offered'].includes(effective(q))) throw conflict(`Quotation is ${effective(q)}`, 'QUOTATION_CLOSED');
  const input = parse(quotationOfferSchema, req.body);
  for (const it of q.items) {
    const offer = input.items.find((x) => x.itemId === String(it._id));
    if (!offer) throw badRequest('Provide a price for every item', 'INCOMPLETE_OFFER');
    it.offeredUnitPriceKobo = offer.unitPriceKobo;
    if (offer.quantity) it.quantity = offer.quantity;
  }
  q.set({ status: 'offered', sellerNote: input.sellerNote, expiresAt: new Date(Date.now() + input.validForHours * 3600_000), respondedBy: a.userId });
  q.history.push({ status: 'offered', by: 'seller', actorId: a.userId, note: input.sellerNote } as any);
  await q.save();
  await audit({ req, action: 'quotation.offered', category: 'order', targetType: 'quotation', targetId: q._id, shopId: q.shopId });
  await broadcast(q, 'seller', 'The shop sent a price offer.');
  ok(res, (await toDtos([q.toObject()]))[0]);
});

quotationsRouter.post('/:id/respond', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { q, side } = await loadForViewer(req, paramId(req.params.id));
  if (side !== 'customer') throw forbidden('Only the customer can respond to an offer');
  const input = parse(quotationRespondSchema, req.body);
  if (effective(q) !== 'offered') throw conflict(effective(q) === 'expired' ? 'This offer has expired; ask the shop for a new one' : `Quotation is ${effective(q)}`, 'QUOTATION_NOT_OFFERED');
  if (input.action === 'counter') {
    if (!input.counterItems?.length) throw badRequest('Provide your counter prices', 'COUNTER_REQUIRED');
    for (const c of input.counterItems) {
      const it = q.items.find((x) => String(x._id) === c.itemId);
      if (it) it.targetUnitPriceKobo = c.unitPriceKobo;
    }
  }
  const status = input.action === 'accept' ? 'accepted' : input.action === 'reject' ? 'rejected' : 'countered';
  q.set({ status, customerNote: input.note });
  q.history.push({ status, by: 'customer', actorId: a.userId, note: input.note } as any);
  await q.save();
  await audit({ req, action: `quotation.${status}`, category: 'order', targetType: 'quotation', targetId: q._id, shopId: q.shopId });
  await broadcast(q, 'customer', status === 'accepted' ? 'The customer accepted the offer.' : status === 'rejected' ? 'The customer declined the offer.' : 'The customer sent a counter-offer.');
  ok(res, (await toDtos([q.toObject()]))[0]);
});

quotationsRouter.post('/:id/reject', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { q, side } = await loadForViewer(req, paramId(req.params.id));
  if (side !== 'seller') throw forbidden();
  if (!['requested', 'countered', 'offered'].includes(effective(q))) throw conflict(`Quotation is ${effective(q)}`);
  const { note } = parse(z.object({ note: z.string().trim().max(500).optional() }), req.body);
  q.status = 'rejected';
  q.history.push({ status: 'rejected', by: 'seller', actorId: a.userId, note } as any);
  await q.save();
  await broadcast(q, 'seller', 'The shop declined the quotation request.');
  ok(res, (await toDtos([q.toObject()]))[0]);
});

quotationsRouter.post('/:id/cancel', async (req, res) => {
  const a = requireAuth(req);
  const { q, side } = await loadForViewer(req, paramId(req.params.id));
  if (side !== 'customer') throw forbidden();
  if (!['requested', 'countered', 'offered'].includes(effective(q))) throw conflict(`Quotation is ${effective(q)}`);
  q.status = 'cancelled';
  q.history.push({ status: 'cancelled', by: 'customer', actorId: a.userId } as any);
  await q.save();
  await broadcast(q, 'customer', 'The customer withdrew the quotation request.');
  ok(res, (await toDtos([q.toObject()]))[0]);
});

/**
 * Puts an accepted quotation into the customer's cart at the negotiated prices. Either the customer or
 * the seller can do this; checkout still validates stock and the quotation's validity.
 */
quotationsRouter.post('/:id/add-to-cart', writeLimiter, async (req, res) => {
  const { q, side } = await loadForViewer(req, paramId(req.params.id));
  if (effective(q) !== 'accepted') throw conflict('Only accepted quotations can be added to the cart', 'QUOTATION_NOT_ACCEPTED');
  if (q.expiresAt && q.expiresAt < new Date()) throw conflict('This quotation has expired', 'QUOTATION_EXPIRED');
  const cart = (await Cart.findOne({ userId: q.customerId })) ?? new Cart({ userId: q.customerId, items: [] });
  cart.items = cart.items.filter((i) => String(i.quotationId ?? '') !== String(q._id)) as any;
  for (const it of q.items) {
    cart.items.push({ productId: it.productId, variantId: it.variantId, shopId: q.shopId, quantity: it.quantity, quotationId: q._id, quotationItemId: it._id } as any);
  }
  await cart.save();
  if (side === 'seller') {
    await notify([q.customerId], { type: 'quotation.updated', title: `Quotation ${q.reference}`, body: 'The shop added your accepted quotation to your cart. Check out when ready.', data: { quotationId: String(q._id) } });
  }
  ok(res, { added: q.items.length });
});
