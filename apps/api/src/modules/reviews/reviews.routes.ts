import { Router } from 'express';
import { z } from 'zod';
import { objectId, paginationSchema, reviewResponseSchema, reviewSchema, type ReviewDto } from '@kkdm/shared';
import { Review } from './review.model';
import { Order } from '../orders/order.models';
import { Product } from '../products/product.models';
import { Shop } from '../shops/shop.models';
import { User } from '../users/user.model';
import { notifyShopStaff, notify } from '../notifications/notify';
import { authenticate, requireAuth } from '../../middleware/auth';
import { writeLimiter } from '../../middleware/rateLimit';
import { requireShopAccess } from '../../services/access';
import { parse, paramId } from '../../utils/validate';
import { badRequest, conflict, forbidden, iso, notFound, ok, pageMeta, paginated, skipFor } from '../../utils/http';
import { Types } from 'mongoose';

export const reviewsRouter = Router();

export async function toReviewDtos(list: any[]): Promise<ReviewDto[]> {
  const authors = await User.find({ _id: { $in: list.map((r) => r.authorId) } }).select('fullName').lean();
  return list.map((r) => ({
    id: String(r._id),
    shopId: String(r.shopId),
    productId: r.productId ? String(r.productId) : null,
    orderId: String(r.orderId),
    author: { id: String(r.authorId), fullName: authors.find((u) => String(u._id) === String(r.authorId))?.fullName ?? 'Customer' },
    rating: r.rating,
    text: r.text ?? undefined,
    response: r.response?.text ? { text: r.response.text, at: iso(r.response.at)! } : null,
    status: r.status,
    createdAt: iso(r.createdAt)!,
  }));
}

/** Recomputes rating aggregates from published reviews (never trusts incremental client values). */
export async function recomputeRatings(shopId: Types.ObjectId | string, productId?: Types.ObjectId | string | null) {
  const [shopAgg] = await Review.aggregate([{ $match: { shopId: new Types.ObjectId(String(shopId)), status: 'published', scope: 'shop' } }, { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } }]);
  await Shop.updateOne({ _id: shopId }, { $set: { ratingAverage: shopAgg?.avg ?? 0, ratingCount: shopAgg?.n ?? 0 } });
  if (productId) {
    const [pAgg] = await Review.aggregate([{ $match: { productId: new Types.ObjectId(String(productId)), status: 'published' } }, { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } }]);
    await Product.updateOne({ _id: productId }, { $set: { ratingAverage: pAgg?.avg ?? 0, ratingCount: pAgg?.n ?? 0 } });
  }
}

reviewsRouter.get('/', async (req, res) => {
  const q = parse(paginationSchema.extend({ shopId: objectId.optional(), productId: objectId.optional() }), req.query);
  if (!q.shopId && !q.productId) throw badRequest('shopId or productId is required');
  const filter: Record<string, unknown> = { status: 'published' };
  if (q.productId) filter.productId = q.productId;
  else {
    filter.shopId = q.shopId;
    filter.scope = 'shop';
  }
  const [items, total] = await Promise.all([
    Review.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    Review.countDocuments(filter),
  ]);
  paginated(res, await toReviewDtos(items), pageMeta(q.page, q.limit, total));
});

reviewsRouter.get('/mine', authenticate, async (req, res) => {
  const items = await Review.find({ authorId: requireAuth(req).userId }).sort({ createdAt: -1 }).limit(100).lean();
  ok(res, await toReviewDtos(items));
});

/**
 * Only the buyer of a delivered/completed order may review it — once for the shop and once per product
 * in the order. The unique (orderId, scope) index enforces no duplicates.
 */
reviewsRouter.post('/', authenticate, writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(reviewSchema, req.body);
  const order = await Order.findOne({ _id: input.orderId, customerId: a.userId }).lean();
  if (!order) throw notFound('Order');
  if (!['delivered', 'completed'].includes(order.status)) throw forbidden('You can review after the order is delivered or collected', 'NOT_ELIGIBLE');
  if (input.productId && !order.items.some((i) => String(i.productId) === input.productId)) throw badRequest('That product is not part of this order', 'INVALID_PRODUCT');
  const scope = input.productId ?? 'shop';
  if (await Review.exists({ orderId: order._id, scope })) throw conflict('You have already reviewed this', 'ALREADY_REVIEWED');
  let review;
  try {
    review = await Review.create({ orderId: order._id, shopId: order.shopId, productId: input.productId ?? null, authorId: a.userId, scope, rating: input.rating, text: input.text });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('You have already reviewed this', 'ALREADY_REVIEWED');
    throw err;
  }
  await recomputeRatings(order.shopId, input.productId);
  await notifyShopStaff(order.shopId, 'owner', { type: 'review.new', title: 'New review', body: `A customer left a ${input.rating}-star review.`, data: { shopId: String(order.shopId), reviewId: String(review._id) }, dedupeKey: `review:${review._id}` });
  ok(res, (await toReviewDtos([review.toObject()]))[0], 201);
});

reviewsRouter.post('/:id/response', authenticate, writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { text } = parse(reviewResponseSchema, req.body);
  const r = await Review.findById(paramId(req.params.id));
  if (!r || r.status === 'removed') throw notFound('Review');
  await requireShopAccess(a, String(r.shopId), 'owner');
  r.response = { text, by: a.userId as any, at: new Date() } as any;
  await r.save();
  await notify([r.authorId], { type: 'review.new', title: 'The shop replied', body: 'The shop responded to your review.', data: { reviewId: String(r._id), shopId: String(r.shopId) } });
  ok(res, (await toReviewDtos([r.toObject()]))[0]);
});

/** Shop-side listing including hidden reviews, for the reviews management screen. */
reviewsRouter.get('/shop/:shopId', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, paramId(req.params.shopId, 'shopId'), 'any', { allowSuspended: true });
  const q = parse(paginationSchema.extend({ unanswered: z.coerce.boolean().optional() }), req.query);
  const filter: Record<string, unknown> = { shopId: shop._id, status: { $ne: 'removed' } };
  if (q.unanswered) filter['response.text'] = { $exists: false };
  const [items, total] = await Promise.all([
    Review.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    Review.countDocuments(filter),
  ]);
  paginated(res, await toReviewDtos(items), pageMeta(q.page, q.limit, total));
});
