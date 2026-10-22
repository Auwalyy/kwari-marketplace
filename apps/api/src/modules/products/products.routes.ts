import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  UPLOAD_LIMITS,
  bulkProductActionSchema,
  inventoryAdjustSchema,
  objectId,
  paginationSchema,
  productCreateSchema,
  productUpdateSchema,
} from '@kkdm/shared';
import { Category, InventoryMovement, Product, RecentlyViewed, type ProductDoc } from './product.models';
import { applyStockDerivations, isPubliclyVisible, toProductDto, toProductSummaries, uniqueProductSlug } from './product.service';
import { queueImageEmbedding, syncProductEmbeddingFilters } from '../visual-search/embedding.service';
import { ProductEmbedding } from '../visual-search/embedding.model';
import { recountShopProducts } from '../shops/shop.service';
import { Order } from '../orders/order.models';
import { authenticate, optionalAuth, requireAuth } from '../../middleware/auth';
import { imageUpload } from '../../middleware/upload';
import { uploadLimiter, writeLimiter } from '../../middleware/rateLimit';
import { getShopAccess, isAdmin, requireShopAccess } from '../../services/access';
import { audit } from '../../services/audit';
import { notifyShopStaff } from '../notifications/notify';
import { processUploadedImage } from '../../services/images';
import { storage, storageKey } from '../../services/storage';
import { parentId, parse, paramId } from '../../utils/validate';
import { badRequest, conflict, escapeRegex, forbidden, iso, notFound, ok, pageMeta, paginated, skipFor } from '../../utils/http';

/* Staff product management (mounted at /shops/:shopId/products) -------------------------------- */

export const shopProductsRouter = Router({ mergeParams: true });
shopProductsRouter.use(authenticate);

const staffListQuery = paginationSchema.extend({
  status: z.enum(['draft', 'published', 'archived']).optional(),
  stockStatus: z.enum(['in_stock', 'low_stock', 'out_of_stock']).optional(),
  q: z.string().trim().max(80).optional(),
});

shopProductsRouter.get('/', async (req, res) => {
  const a = requireAuth(req);
  const shopId = parentId(req, 'shopId');
  const access = await requireShopAccess(a, shopId, 'any', { allowSuspended: true });
  if (!access.isOwner && !access.permissions.some((p) => p === 'products.manage' || p === 'inventory.manage')) {
    throw forbidden('Your shop role does not include product access', 'MISSING_SHOP_PERMISSION');
  }
  const q = parse(staffListQuery, req.query);
  const filter: Record<string, unknown> = { shopId };
  if (q.status) filter.status = q.status;
  else filter.status = { $ne: 'archived' };
  if (q.stockStatus) filter.stockStatus = q.stockStatus;
  if (q.q) filter.name = new RegExp(escapeRegex(q.q), 'i');
  const [items, total] = await Promise.all([
    Product.find(filter).sort({ updatedAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).lean(),
    Product.countDocuments(filter),
  ]);
  const summaries = await toProductSummaries(items as any);
  paginated(
    res,
    summaries.map((s, i) => ({ ...s, stockQuantity: items[i].stockQuantity, moderationStatus: items[i].moderationStatus, imageCount: items[i].images.length })),
    pageMeta(q.page, q.limit, total),
  );
});

shopProductsRouter.get('/:productId', async (req, res) => {
  const a = requireAuth(req);
  const shopId = parentId(req, 'shopId');
  await requireShopAccess(a, shopId, 'any', { allowSuspended: true });
  const p = await Product.findOne({ _id: paramId(req.params.productId), shopId });
  if (!p) throw notFound('Product');
  ok(res, { ...(await toProductDto(p.toObject() as any)), moderationStatus: p.moderationStatus, moderationReason: p.moderationReason });
});

async function assertCategory(categoryId: string) {
  if (!(await Category.exists({ _id: categoryId, active: true }))) throw badRequest('Choose a valid category', 'INVALID_CATEGORY');
}

function assertPublishable(p: ProductDoc) {
  if (!p.images.length) throw badRequest('Add at least one photo before publishing', 'IMAGE_REQUIRED');
}

shopProductsRouter.post('/', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'products.manage');
  const input = parse(productCreateSchema, req.body);
  await assertCategory(input.categoryId);
  if (!shop.enabledUnits.includes(input.unit)) throw badRequest(`Your shop has not enabled the unit "${input.unit}"`, 'UNIT_NOT_ENABLED');
  // Products can be created as drafts before approval but are only published once they have images.
  const p = new Product({
    ...input,
    status: 'draft',
    shopId: shop._id,
    marketId: shop.marketId,
    sectionId: shop.sectionId,
    houseId: shop.houseId,
    slug: await uniqueProductSlug(shop._id, input.name),
    shopListed: shop.status === 'active',
    shopVerified: shop.verificationStatus === 'verified',
    createdBy: a.userId,
    updatedBy: a.userId,
  });
  applyStockDerivations(p);
  await p.save();
  if (p.stockQuantity > 0) {
    await InventoryMovement.create({ productId: p._id, shopId: shop._id, delta: p.stockQuantity, balanceAfter: p.stockQuantity, reason: 'initial', actorId: a.userId });
  }
  await audit({ req, action: 'product.created', category: 'product', targetType: 'product', targetId: p._id, shopId: shop._id });
  ok(res, await toProductDto(p.toObject() as any), 201);
});

shopProductsRouter.patch('/:productId', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const access = await requireShopAccess(a, parentId(req, 'shopId'), 'products.manage');
  const p = await Product.findOne({ _id: paramId(req.params.productId), shopId: access.shop._id });
  if (!p) throw notFound('Product');
  const input = parse(productUpdateSchema, req.body);
  // Stock levels change only through the inventory endpoint so every movement is recorded.
  if (input.stockQuantity !== undefined && input.stockQuantity !== p.stockQuantity) {
    throw badRequest('Use inventory adjustments to change stock levels', 'USE_INVENTORY_ENDPOINT');
  }
  delete input.stockQuantity;
  if (input.categoryId) await assertCategory(input.categoryId);
  if (input.unit && !access.shop.enabledUnits.includes(input.unit)) throw badRequest(`Your shop has not enabled the unit "${input.unit}"`, 'UNIT_NOT_ENABLED');
  const merged = { retail: input.retailPriceKobo ?? p.retailPriceKobo, wholesale: input.wholesalePriceKobo !== undefined ? input.wholesalePriceKobo : p.wholesalePriceKobo };
  if (merged.wholesale != null && merged.wholesale > merged.retail) throw badRequest('Wholesale price should not exceed the retail price', 'INVALID_WHOLESALE');

  if (input.variants) {
    // Variant stock is preserved for existing variants; new variants start from the supplied value.
    const existing = new Map(p.variants.map((v) => [String(v._id), v]));
    p.variants = input.variants.map((v) => {
      const prev = v._id ? existing.get(v._id) : undefined;
      return { ...v, _id: prev?._id ?? new Types.ObjectId(), stockQuantity: prev ? prev.stockQuantity : v.stockQuantity } as any;
    }) as any;
    delete input.variants;
  }
  if (input.name && input.name !== p.name) p.slug = await uniqueProductSlug(p.shopId, input.name, p._id);
  const wantsPublish = input.status === 'published' && p.status !== 'published';
  p.set({ ...input, updatedBy: a.userId });
  if (wantsPublish) {
    assertPublishable(p);
    p.publishedAt = new Date();
  }
  if (input.status === 'archived') p.archivedAt = new Date();
  applyStockDerivations(p);
  await p.save();
  await syncProductEmbeddingFilters(p._id);
  await recountShopProducts(p.shopId);
  await audit({ req, action: 'product.updated', category: 'product', targetType: 'product', targetId: p._id, shopId: p.shopId, metadata: { fields: Object.keys(input) } });
  ok(res, await toProductDto(p.toObject() as any));
});

/** Archives a product. Drafts that were never ordered can be permanently deleted with ?permanent=true. */
shopProductsRouter.delete('/:productId', async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'products.manage');
  const p = await Product.findOne({ _id: paramId(req.params.productId), shopId: shop._id });
  if (!p) throw notFound('Product');
  const permanent = parse(z.object({ permanent: z.coerce.boolean().optional() }), req.query).permanent;
  if (permanent) {
    if (p.status === 'published' || (await Order.exists({ 'items.productId': p._id }))) {
      throw conflict('Products that were published or ordered can only be archived', 'CANNOT_DELETE');
    }
    await Promise.all(p.images.flatMap((i) => [storage().delete(i.key).catch(() => undefined), storage().delete(i.thumbnailKey).catch(() => undefined)]));
    await ProductEmbedding.deleteMany({ productId: p._id });
    await p.deleteOne();
    await audit({ req, action: 'product.deleted', category: 'product', targetType: 'product', targetId: p._id, shopId: shop._id });
    ok(res, { deleted: true });
    return;
  }
  p.set({ status: 'archived', archivedAt: new Date(), updatedBy: a.userId });
  await p.save();
  await syncProductEmbeddingFilters(p._id);
  await recountShopProducts(shop._id);
  await audit({ req, action: 'product.archived', category: 'product', targetType: 'product', targetId: p._id, shopId: shop._id });
  ok(res, { archived: true });
});

shopProductsRouter.post('/bulk', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'products.manage');
  const input = parse(bulkProductActionSchema, req.body);
  const products = await Product.find({ _id: { $in: input.productIds }, shopId: shop._id });
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const p of products) {
    try {
      if (input.action === 'publish') {
        assertPublishable(p);
        p.set({ status: 'published', publishedAt: p.publishedAt ?? new Date() });
      } else if (input.action === 'unpublish') p.status = 'draft';
      else p.set({ status: 'archived', archivedAt: new Date() });
      p.updatedBy = new Types.ObjectId(a.userId);
      await p.save();
      await syncProductEmbeddingFilters(p._id);
      results.push({ id: String(p._id), ok: true });
    } catch (err) {
      results.push({ id: String(p._id), ok: false, error: (err as Error).message });
    }
  }
  await recountShopProducts(shop._id);
  await audit({ req, action: `product.bulk_${input.action}`, category: 'product', shopId: shop._id, metadata: { count: results.filter((r) => r.ok).length } });
  ok(res, { results, notFound: input.productIds.filter((id) => !products.some((p) => String(p._id) === id)) });
});

/* Images */

shopProductsRouter.post('/:productId/images', uploadLimiter, imageUpload.array('images', UPLOAD_LIMITS.maxImagesPerProduct), async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'products.manage');
  const p = await Product.findOne({ _id: paramId(req.params.productId), shopId: shop._id });
  if (!p) throw notFound('Product');
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest('Attach at least one image in the "images" field', 'IMAGE_REQUIRED');
  if (p.images.length + files.length > UPLOAD_LIMITS.maxImagesPerProduct) {
    throw badRequest(`A product can have at most ${UPLOAD_LIMITS.maxImagesPerProduct} images`, 'TOO_MANY_IMAGES');
  }
  // Validate and re-encode every file before storing any, so one bad file rejects the whole upload.
  const processed = await Promise.all(files.map((f) => processUploadedImage(f.buffer)));
  const duplicate = processed.find((img) => p.images.some((i) => i.sha256 === img.sha256));
  if (duplicate) throw conflict('This image is already attached to the product', 'DUPLICATE_IMAGE');
  const added: Types.ObjectId[] = [];
  let position = p.images.reduce((m, i) => Math.max(m, i.position ?? 0), -1) + 1;
  for (const img of processed) {
    const id = new Types.ObjectId();
    const base = storageKey('public', 'products', String(shop._id), String(p._id), String(id));
    const key = `${base}.webp`;
    const thumbnailKey = `${base}-thumb.webp`;
    await storage().put(key, img.full, img.contentType, 'public');
    await storage().put(thumbnailKey, img.thumbnail, img.contentType, 'public');
    p.images.push({
      _id: id,
      key,
      thumbnailKey,
      url: storage().publicUrl(key),
      thumbnailUrl: storage().publicUrl(thumbnailKey),
      width: img.width,
      height: img.height,
      bytes: img.bytes,
      sha256: img.sha256,
      position: position++,
      embeddingStatus: 'pending',
    } as any);
    added.push(id);
  }
  p.updatedBy = new Types.ObjectId(a.userId);
  await p.save();
  // Embeddings are generated in the background so uploads are not blocked by the provider.
  for (const id of added) await queueImageEmbedding(p._id, id);
  await audit({ req, action: 'product.images_added', category: 'product', targetType: 'product', targetId: p._id, shopId: shop._id, metadata: { count: added.length } });
  const fresh = await Product.findById(p._id).lean();
  ok(res, await toProductDto(fresh as any), 201);
});

shopProductsRouter.delete('/:productId/images/:imageId', async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'products.manage');
  const p = await Product.findOne({ _id: paramId(req.params.productId), shopId: shop._id });
  if (!p) throw notFound('Product');
  const imageId = paramId(req.params.imageId, 'imageId');
  const img = p.images.find((i) => String(i._id) === imageId);
  if (!img) throw notFound('Image');
  if (p.status === 'published' && p.images.length === 1) throw badRequest('A published product must keep at least one photo', 'IMAGE_REQUIRED');
  p.images.pull({ _id: img._id });
  await p.save();
  await ProductEmbedding.deleteMany({ imageId: img._id });
  await Promise.all([storage().delete(img.key).catch(() => undefined), storage().delete(img.thumbnailKey).catch(() => undefined)]);
  ok(res, await toProductDto(p.toObject() as any));
});

shopProductsRouter.put('/:productId/images/order', async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'products.manage');
  const { imageIds } = parse(z.object({ imageIds: z.array(objectId).min(1).max(UPLOAD_LIMITS.maxImagesPerProduct) }), req.body);
  const p = await Product.findOne({ _id: paramId(req.params.productId), shopId: shop._id });
  if (!p) throw notFound('Product');
  if (imageIds.length !== p.images.length || !p.images.every((i) => imageIds.includes(String(i._id)))) {
    throw badRequest('Provide every image id exactly once', 'INVALID_ORDER');
  }
  for (const img of p.images) img.position = imageIds.indexOf(String(img._id));
  await p.save();
  ok(res, await toProductDto(p.toObject() as any));
});

/** Re-queues embedding generation for images whose embedding failed. */
shopProductsRouter.post('/:productId/images/retry-embeddings', async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'products.manage');
  const p = await Product.findOne({ _id: paramId(req.params.productId), shopId: shop._id });
  if (!p) throw notFound('Product');
  let queued = 0;
  for (const img of p.images) {
    if (img.embeddingStatus === 'failed' || img.embeddingStatus === 'disabled' || img.embeddingStatus === 'pending') {
      await Product.updateOne({ _id: p._id, 'images._id': img._id }, { $set: { 'images.$.embeddingStatus': 'pending', 'images.$.embeddingAttempts': 0 } });
      await queueImageEmbedding(p._id, img._id);
      queued++;
    }
  }
  ok(res, { queued });
});

/* Inventory */

shopProductsRouter.post('/:productId/inventory', writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'inventory.manage');
  const input = parse(inventoryAdjustSchema, req.body);
  const productId = paramId(req.params.productId);
  const p = await Product.findOne({ _id: productId, shopId: shop._id });
  if (!p) throw notFound('Product');
  if (p.variants.length && !input.variantId) throw badRequest('Choose which variant to adjust', 'VARIANT_REQUIRED');

  // Atomic, guarded update: stock can never go below zero even with concurrent orders.
  let updated;
  if (input.variantId) {
    const guard = input.delta < 0 ? { $elemMatch: { _id: new Types.ObjectId(input.variantId), stockQuantity: { $gte: -input.delta } } } : { $elemMatch: { _id: new Types.ObjectId(input.variantId) } };
    updated = await Product.findOneAndUpdate(
      { _id: p._id, variants: guard, ...(input.delta < 0 ? { stockQuantity: { $gte: -input.delta } } : {}) },
      { $inc: { 'variants.$.stockQuantity': input.delta, stockQuantity: input.delta } },
      { new: true },
    );
  } else {
    updated = await Product.findOneAndUpdate(
      { _id: p._id, ...(input.delta < 0 ? { stockQuantity: { $gte: -input.delta } } : {}) },
      { $inc: { stockQuantity: input.delta } },
      { new: true },
    );
  }
  if (!updated) throw conflict('Not enough stock to remove that quantity', 'INSUFFICIENT_STOCK');
  const prevStatus = p.stockStatus;
  applyStockDerivations(updated);
  await Product.updateOne({ _id: updated._id }, { $set: { stockStatus: updated.stockStatus, stockQuantity: updated.stockQuantity } });
  const variant = input.variantId ? updated.variants.find((v) => String(v._id) === input.variantId) : null;
  await InventoryMovement.create({
    productId: p._id,
    variantId: input.variantId ?? null,
    shopId: shop._id,
    delta: input.delta,
    balanceAfter: variant ? variant.stockQuantity : updated.stockQuantity,
    reason: input.reason,
    note: input.note,
    actorId: a.userId,
  });
  await syncProductEmbeddingFilters(p._id);
  await audit({ req, action: 'inventory.adjusted', category: 'product', targetType: 'product', targetId: p._id, shopId: shop._id, metadata: { delta: input.delta, reason: input.reason } });
  if (updated.stockStatus === 'out_of_stock' && prevStatus !== 'out_of_stock') {
    await notifyShopStaff(shop._id, 'inventory.manage', {
      type: 'product.out_of_stock',
      title: 'Out of stock',
      body: `${updated.name} is now out of stock.`,
      data: { shopId: String(shop._id), productId: String(p._id) },
    });
  }
  ok(res, await toProductDto(updated.toObject() as any));
});

shopProductsRouter.get('/:productId/inventory', async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, parentId(req, 'shopId'), 'inventory.manage', { allowSuspended: true });
  const { page, limit } = parse(paginationSchema, req.query);
  const filter = { productId: paramId(req.params.productId), shopId: shop._id };
  const [items, total] = await Promise.all([
    InventoryMovement.find(filter).sort({ createdAt: -1 }).skip(skipFor(page, limit)).limit(limit).lean(),
    InventoryMovement.countDocuments(filter),
  ]);
  paginated(
    res,
    items.map((m) => ({
      id: String(m._id),
      variantId: m.variantId ? String(m.variantId) : null,
      delta: m.delta,
      balanceAfter: m.balanceAfter,
      reason: m.reason,
      note: m.note,
      orderId: m.orderId ? String(m.orderId) : null,
      at: iso(m.createdAt),
    })),
    pageMeta(page, limit, total),
  );
});

/* Public product detail (mounted at /products) ------------------------------------------------- */

export const productsRouter = Router();

productsRouter.get('/:id', optionalAuth, async (req, res) => {
  const p = await Product.findById(paramId(req.params.id)).lean();
  if (!p) throw notFound('Product');
  if (!isPubliclyVisible(p)) {
    const staff = req.auth ? await getShopAccess(req.auth.userId, String(p.shopId)).catch(() => null) : null;
    if (!staff && !isAdmin(req.auth)) throw notFound('Product');
  }
  if (req.auth && isPubliclyVisible(p)) {
    await RecentlyViewed.updateOne({ userId: req.auth.userId, productId: p._id }, { $set: { viewedAt: new Date() } }, { upsert: true });
  }
  ok(res, await toProductDto(p as any));
});
