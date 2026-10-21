import { Router } from 'express';
import { z } from 'zod';
import { objectId, paginationSchema } from '@kkdm/shared';
import { Favorite, Product, RecentlyViewed } from '../products/product.models';
import { PUBLIC_PRODUCT_FILTER, toProductSummaries } from '../products/product.service';
import { Shop } from '../shops/shop.models';
import { toShopSummaries } from '../shops/shop.service';
import { authenticate, requireAuth } from '../../middleware/auth';
import { parse } from '../../utils/validate';
import { notFound, ok, pageMeta, paginated, skipFor } from '../../utils/http';

export const favoritesRouter = Router();
favoritesRouter.use(authenticate);

const typeSchema = z.enum(['shop', 'product']);

favoritesRouter.get('/', async (req, res) => {
  const a = requireAuth(req);
  const q = parse(paginationSchema.extend({ type: typeSchema.default('product') }), req.query);
  const filter = { userId: a.userId, targetType: q.type };
  const [favs, total] = await Promise.all([
    Favorite.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    Favorite.countDocuments(filter),
  ]);
  const ids = favs.map((f) => f.targetId);
  if (q.type === 'product') {
    const products = await Product.find({ _id: { $in: ids }, ...PUBLIC_PRODUCT_FILTER }).lean();
    const ordered = ids.map((id) => products.find((p) => String(p._id) === String(id))).filter(Boolean);
    paginated(res, await toProductSummaries(ordered as any), pageMeta(q.page, q.limit, total));
  } else {
    const shops = await Shop.find({ _id: { $in: ids }, status: 'active' }).lean();
    const ordered = ids.map((id) => shops.find((s) => String(s._id) === String(id))).filter(Boolean);
    paginated(res, await toShopSummaries(ordered as any), pageMeta(q.page, q.limit, total));
  }
});

/** Ids only — used by the app to render favourite toggles. */
favoritesRouter.get('/ids', async (req, res) => {
  const favs = await Favorite.find({ userId: requireAuth(req).userId }).select('targetType targetId').limit(2000).lean();
  ok(res, {
    products: favs.filter((f) => f.targetType === 'product').map((f) => String(f.targetId)),
    shops: favs.filter((f) => f.targetType === 'shop').map((f) => String(f.targetId)),
  });
});

favoritesRouter.post('/', async (req, res) => {
  const a = requireAuth(req);
  const input = parse(z.object({ targetType: typeSchema, targetId: objectId }), req.body);
  const exists =
    input.targetType === 'product'
      ? await Product.exists({ _id: input.targetId, ...PUBLIC_PRODUCT_FILTER })
      : await Shop.exists({ _id: input.targetId, status: 'active' });
  if (!exists) throw notFound(input.targetType === 'product' ? 'Product' : 'Shop');
  await Favorite.updateOne({ userId: a.userId, ...input }, { $setOnInsert: { userId: a.userId, ...input } }, { upsert: true });
  ok(res, { saved: true }, 201);
});

favoritesRouter.delete('/:type/:id', async (req, res) => {
  const a = requireAuth(req);
  const type = parse(typeSchema, req.params.type);
  const id = parse(objectId, req.params.id);
  await Favorite.deleteOne({ userId: a.userId, targetType: type, targetId: id });
  ok(res, { removed: true });
});

favoritesRouter.get('/recently-viewed', async (req, res) => {
  const a = requireAuth(req);
  const { page, limit } = parse(paginationSchema, req.query);
  const [views, total] = await Promise.all([
    RecentlyViewed.find({ userId: a.userId }).sort({ viewedAt: -1 }).skip(skipFor(page, limit)).limit(limit).lean(),
    RecentlyViewed.countDocuments({ userId: a.userId }),
  ]);
  const products = await Product.find({ _id: { $in: views.map((v) => v.productId) }, ...PUBLIC_PRODUCT_FILTER }).lean();
  const ordered = views.map((v) => products.find((p) => String(p._id) === String(v.productId))).filter(Boolean);
  paginated(res, await toProductSummaries(ordered as any), pageMeta(page, limit, total));
});

/** Privacy control: clear browsing history. */
favoritesRouter.delete('/recently-viewed', async (req, res) => {
  await RecentlyViewed.deleteMany({ userId: requireAuth(req).userId });
  ok(res, { cleared: true });
});
