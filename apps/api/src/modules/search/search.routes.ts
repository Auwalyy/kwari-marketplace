import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { productSearchSchema, type ProductSearchQuery } from '@kkdm/shared';
import { Category, Product, RecentlyViewed, SearchHistory } from '../products/product.models';
import { PUBLIC_PRODUCT_FILTER, toProductSummaries } from '../products/product.service';
import { Shop } from '../shops/shop.models';
import { toShopSummaries } from '../shops/shop.service';
import { House } from '../markets/market.models';
import { activePromotions, recordImpressions } from '../promotions/promotion.service';
import { authenticate, optionalAuth, requireAuth } from '../../middleware/auth';
import { searchLimiter } from '../../middleware/rateLimit';
import { parse } from '../../utils/validate';
import { escapeRegex, ok, pageMeta, paginated, skipFor } from '../../utils/http';

export const searchRouter = Router();

function tokens(q: string) {
  return q
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
}

function baseFilter(q: ProductSearchQuery) {
  const f: Record<string, unknown> = { ...PUBLIC_PRODUCT_FILTER };
  for (const k of ['categoryId', 'marketId', 'sectionId', 'houseId', 'shopId'] as const) if (q[k]) f[k] = new Types.ObjectId(q[k]);
  if (q.minPriceKobo != null || q.maxPriceKobo != null) {
    f.retailPriceKobo = { ...(q.minPriceKobo != null ? { $gte: q.minPriceKobo } : {}), ...(q.maxPriceKobo != null ? { $lte: q.maxPriceKobo } : {}) };
  }
  if (q.wholesaleOnly) f.wholesalePriceKobo = { $ne: null };
  if (q.inStockOnly) f.stockStatus = { $ne: 'out_of_stock' };
  if (q.verifiedOnly) f.shopVerified = true;
  if (q.colour) f.colours = q.colour;
  return f;
}

function sortFor(q: ProductSearchQuery, text: boolean): Record<string, any> {
  switch (q.sort) {
    case 'newest':
      return { publishedAt: -1, _id: -1 };
    case 'price_asc':
      return { retailPriceKobo: 1, _id: 1 };
    case 'price_desc':
      return { retailPriceKobo: -1, _id: 1 };
    case 'rating':
      return { ratingAverage: -1, ratingCount: -1, _id: 1 };
    default:
      return text ? { score: { $meta: 'textScore' }, _id: 1 } : { salesQuantity: -1, publishedAt: -1, _id: 1 };
  }
}

/**
 * Text search over the published catalogue. Uses the weighted text index (stemmed, case-insensitive);
 * when that finds nothing it falls back to prefix matching on names/keywords/colours so partial words
 * and minor spelling differences still return results. House numbers and shop codes are also matched.
 * Visual similarity is never inferred from text — that is the visual-search endpoint's job.
 */
searchRouter.get('/products', optionalAuth, searchLimiter, async (req, res) => {
  const q = parse(productSearchSchema, req.query);
  if (q.minPriceKobo != null && q.maxPriceKobo != null && q.minPriceKobo > q.maxPriceKobo) [q.minPriceKobo, q.maxPriceKobo] = [q.maxPriceKobo, q.minPriceKobo];
  const filter = baseFilter(q);
  let usedText = false;
  let mode: 'all' | 'text' | 'fuzzy' | 'location' = 'all';

  if (q.q) {
    const houses = await House.find({ houseNumber: q.q.toUpperCase().replace(/\s+/g, '') }).select('_id').limit(5).lean();
    const shops = await Shop.find({ status: 'active', $or: [{ shopCode: q.q.toUpperCase() }] }).select('_id').limit(5).lean();
    if (houses.length || shops.length) {
      mode = 'location';
      filter.$or = [{ houseId: { $in: houses.map((h) => h._id) } }, { shopId: { $in: shops.map((s) => s._id) } }];
    } else {
      const textCount = await Product.countDocuments({ ...filter, $text: { $search: q.q } });
      if (textCount > 0) {
        filter.$text = { $search: q.q };
        usedText = true;
        mode = 'text';
      } else {
        const t = tokens(q.q);
        const regexes = t.map((tok) => new RegExp(escapeRegex(tok.length > 5 ? tok.slice(0, Math.ceil(tok.length * 0.7)) : tok), 'i'));
        filter.$and = regexes.map((rx) => ({ $or: [{ name: rx }, { keywords: rx }, { colours: rx }, { patterns: rx }, { material: rx }, { subcategory: rx }] }));
        mode = 'fuzzy';
      }
    }
  }

  const projection = usedText ? { score: { $meta: 'textScore' } } : undefined;
  const [items, total] = await Promise.all([
    Product.find(filter, projection).sort(sortFor(q, usedText)).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    Product.countDocuments(filter),
  ]);

  // Sponsored placement: up to two clearly labelled sponsored products on the first page.
  let sponsored: any[] = [];
  if (q.q && q.page === 1) {
    const promos = await activePromotions('sponsored_search', { keywords: tokens(q.q), limit: 2 });
    const ids = promos.map((p) => p.productId).filter(Boolean);
    if (ids.length) {
      sponsored = await Product.find({ _id: { $in: ids }, ...baseFilter(q) }).lean();
      await recordImpressions(promos.filter((p) => sponsored.some((s) => String(s._id) === String(p.productId))).map((p) => p._id));
    }
  }
  const sponsoredIds = new Set(sponsored.map((s) => String(s._id)));
  const organic = items.filter((i) => !sponsoredIds.has(String(i._id)));
  const summaries = await toProductSummaries([...sponsored, ...organic] as any, { sponsoredIds });

  if (req.auth && q.q && q.page === 1) {
    await SearchHistory.updateOne({ userId: req.auth.userId, query: q.q.toLowerCase() }, { $set: { at: new Date() } }, { upsert: true });
  }
  paginated(res, summaries, pageMeta(q.page, q.limit, total), { mode });
});

searchRouter.get('/suggestions', searchLimiter, async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(1).max(60) }), req.query);
  const rx = new RegExp(`^${escapeRegex(q)}`, 'i');
  const anywhere = new RegExp(escapeRegex(q), 'i');
  const [products, shops, categories, houses] = await Promise.all([
    Product.find({ ...PUBLIC_PRODUCT_FILTER, name: anywhere }).select('name').limit(6).lean(),
    Shop.find({ status: 'active', $or: [{ name: anywhere }, { shopCode: rx }] }).select('name slug shopCode').limit(4).lean(),
    Category.find({ active: true, name: anywhere }).select('name slug').limit(4).lean(),
    House.find({ status: 'active', houseNumber: rx }).select('houseNumber name').limit(3).lean(),
  ]);
  ok(res, {
    products: [...new Set(products.map((p) => p.name))],
    shops: shops.map((s) => ({ id: String(s._id), name: s.name, slug: s.slug, shopCode: s.shopCode })),
    categories: categories.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug })),
    houses: houses.map((h) => ({ id: String(h._id), houseNumber: h.houseNumber, name: h.name })),
  });
});

searchRouter.get('/recent', authenticate, async (req, res) => {
  const items = await SearchHistory.find({ userId: requireAuth(req).userId }).sort({ at: -1 }).limit(10).lean();
  ok(res, items.map((i) => i.query));
});

searchRouter.delete('/recent', authenticate, async (req, res) => {
  await SearchHistory.deleteMany({ userId: requireAuth(req).userId });
  ok(res, { cleared: true });
});

/** Home-screen discovery sections, computed from real catalogue data. */
searchRouter.get('/discovery', optionalAuth, async (req, res) => {
  const featuredPromos = await activePromotions('featured_shop', { limit: 8 });
  const featuredProductPromos = await activePromotions('featured_product', { limit: 8 });
  const [featuredShops, featuredProducts, recentProducts, topShops, wholesaleShops, popularCategories] = await Promise.all([
    Shop.find({ _id: { $in: featuredPromos.map((p) => p.shopId) }, status: 'active' }).lean(),
    Product.find({ _id: { $in: featuredProductPromos.map((p) => p.productId).filter(Boolean) }, ...PUBLIC_PRODUCT_FILTER }).lean(),
    Product.find(PUBLIC_PRODUCT_FILTER).sort({ publishedAt: -1 }).limit(10).lean(),
    Shop.find({ status: 'active', activeProductCount: { $gt: 0 } }).sort({ ratingAverage: -1, ratingCount: -1, activeProductCount: -1 }).limit(8).lean(),
    Shop.find({ status: 'active', wholesaleAvailable: true, activeProductCount: { $gt: 0 } }).sort({ ratingAverage: -1 }).limit(8).lean(),
    Product.aggregate([
      { $match: PUBLIC_PRODUCT_FILTER },
      { $group: { _id: '$categoryId', n: { $sum: 1 }, sales: { $sum: '$salesQuantity' } } },
      { $sort: { sales: -1, n: -1 } },
      { $limit: 8 },
    ]),
  ]);
  await recordImpressions([...featuredPromos.filter((p) => featuredShops.some((s) => String(s._id) === String(p.shopId))).map((p) => p._id), ...featuredProductPromos.filter((p) => featuredProducts.some((fp) => String(fp._id) === String(p.productId))).map((p) => p._id)]);
  const cats = await Category.find({ _id: { $in: popularCategories.map((c) => c._id) } }).lean();

  let recentlyViewed: any[] = [];
  if (req.auth) {
    const views = await RecentlyViewed.find({ userId: req.auth.userId }).sort({ viewedAt: -1 }).limit(10).lean();
    const prods = await Product.find({ _id: { $in: views.map((v) => v.productId) }, ...PUBLIC_PRODUCT_FILTER }).lean();
    recentlyViewed = views.map((v) => prods.find((p) => String(p._id) === String(v.productId))).filter(Boolean);
  }
  ok(res, {
    featuredShops: await toShopSummaries(featuredShops as any, { sponsoredIds: new Set(featuredShops.map((s) => String(s._id))) }),
    featuredProducts: await toProductSummaries(featuredProducts as any, { sponsoredIds: new Set(featuredProducts.map((p) => String(p._id))) }),
    recentlyAdded: await toProductSummaries(recentProducts as any),
    recommendedShops: await toShopSummaries(topShops as any),
    wholesaleSellers: await toShopSummaries(wholesaleShops as any),
    popularCategories: popularCategories
      .map((c) => {
        const cat = cats.find((x) => String(x._id) === String(c._id));
        return cat ? { id: String(cat._id), name: cat.name, slug: cat.slug, iconName: cat.iconName, productCount: c.n } : null;
      })
      .filter(Boolean),
    recentlyViewed: await toProductSummaries(recentlyViewed),
  });
});

/** Other shops in the same house or section as a given shop. */
searchRouter.get('/nearby-shops/:shopId', async (req, res) => {
  const shopId = parse(z.string().regex(/^[a-f\d]{24}$/i), req.params.shopId);
  const shop = await Shop.findById(shopId).select('houseId sectionId').lean();
  if (!shop) {
    ok(res, { sameHouse: [], sameSection: [] });
    return;
  }
  const [sameHouse, sameSection] = await Promise.all([
    Shop.find({ houseId: shop.houseId, status: 'active', _id: { $ne: shop._id } }).limit(10).lean(),
    shop.sectionId ? Shop.find({ sectionId: shop.sectionId, houseId: { $ne: shop.houseId }, status: 'active' }).sort({ ratingAverage: -1 }).limit(10).lean() : [],
  ]);
  ok(res, { sameHouse: await toShopSummaries(sameHouse as any), sameSection: await toShopSummaries(sameSection as any) });
});
