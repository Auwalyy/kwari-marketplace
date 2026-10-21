import { Router } from 'express';
import { z } from 'zod';
import { visualSearchFiltersSchema, type VisualMatchDto, type VisualSearchFilters } from '@kkdm/shared';
import { VisualSearchCache, ProductEmbedding } from './embedding.model';
import { embeddingProvider, requireEmbeddingProvider } from './providers';
import { findSimilarProducts, generateQueryImageEmbedding, minSimilarity, relevanceBand, type SimilarCandidate } from './embedding.service';
import { Product } from '../products/product.models';
import { PUBLIC_PRODUCT_FILTER, toProductSummaries } from '../products/product.service';
import { optionalAuth } from '../../middleware/auth';
import { imageUpload } from '../../middleware/upload';
import { visualSearchLimiter } from '../../middleware/rateLimit';
import { assertValidImage, normalizeForEmbedding } from '../../services/images';
import { env } from '../../config/env';
import { sha256 } from '../../utils/crypto';
import { badRequest, notFound, ok, pageMeta } from '../../utils/http';
import { parse, paramId } from '../../utils/validate';

export const visualSearchRouter = Router();

visualSearchRouter.get('/status', (_req, res) => {
  const p = embeddingProvider();
  ok(res, {
    available: !!p,
    provider: p?.name ?? null,
    model: p?.model ?? null,
    developmentOnly: !!p?.developmentOnly,
    vectorSearch: env.VECTOR_SEARCH_PROVIDER,
  });
});

function filterKey(f: Partial<VisualSearchFilters>) {
  const { page: _p, limit: _l, ...rest } = f;
  return JSON.stringify(Object.keys(rest).sort().map((k) => [k, (rest as Record<string, unknown>)[k]]));
}

/** Pages through ranked candidates, re-checking each product is still publicly available. */
async function buildPage(candidates: SimilarCandidate[], f: VisualSearchFilters, threshold: number) {
  const eligible = candidates.filter((c) => c.score >= threshold);
  const start = (f.page - 1) * f.limit;
  const slice = eligible.slice(start, start + f.limit);
  const products = await Product.find({ _id: { $in: slice.map((c) => c.productId) }, ...PUBLIC_PRODUCT_FILTER }).lean();
  const summaries = await toProductSummaries(products as any);
  const byId = new Map(summaries.map((s) => [s.id, s]));
  const productDocs = new Map(products.map((p) => [String(p._id), p]));
  const matches: VisualMatchDto[] = [];
  for (const c of slice) {
    const summary = byId.get(c.productId);
    const doc = productDocs.get(c.productId);
    if (!summary || !doc) continue;
    const img = doc.images.find((i) => String(i._id) === c.imageId) ?? doc.images[0];
    matches.push({
      product: summary,
      similarity: Math.max(0, Math.min(1, Math.round(c.score * 1000) / 1000)),
      relevance: relevanceBand(c.score, threshold),
      matchedImageUrl: img?.thumbnailUrl ?? summary.thumbnailUrl ?? '',
    });
  }
  return { matches, total: eligible.length };
}

/**
 * Search by fabric image. The uploaded image is validated, normalised (metadata removed) and embedded in
 * memory; it is never written to storage. Ranked candidate ids are cached briefly under a hash so the
 * client can page through results without re-uploading.
 */
visualSearchRouter.post('/', optionalAuth, visualSearchLimiter, imageUpload.single('image'), async (req, res) => {
  const provider = requireEmbeddingProvider();
  if (!req.file) throw badRequest('Attach a fabric photo in the "image" field', 'IMAGE_REQUIRED');
  const filters = parse(visualSearchFiltersSchema, { ...req.query, ...req.body });
  await assertValidImage(req.file.buffer);
  const normalized = await normalizeForEmbedding(req.file.buffer);
  req.file.buffer = Buffer.alloc(0); // release the original upload promptly

  const searchId = sha256(`${provider.name}|${provider.model}|${sha256(normalized)}|${filterKey(filters)}`).slice(0, 32);
  let candidates: SimilarCandidate[];
  const cached = await VisualSearchCache.findOne({ key: searchId }).lean();
  if (cached) {
    candidates = cached.results.map((r) => ({ productId: String(r.productId), imageId: String(r.imageId), score: r.score! }));
  } else {
    const embedding = await generateQueryImageEmbedding(normalized, provider);
    candidates = await findSimilarProducts(embedding, filters, { provider });
    await VisualSearchCache.updateOne(
      { key: searchId },
      { $set: { results: candidates.map((c) => ({ productId: c.productId, imageId: c.imageId, score: c.score })), createdAt: new Date() } },
      { upsert: true },
    );
  }
  const threshold = minSimilarity(provider);
  const { matches, total } = await buildPage(candidates, filters, threshold);
  ok(res, { matches, meta: { ...pageMeta(filters.page, filters.limit, total), provider: provider.name, searchId, developmentOnly: !!provider.developmentOnly } });
});

/** Further pages of an earlier visual search (results expire after 15 minutes). */
visualSearchRouter.get('/results/:searchId', optionalAuth, async (req, res) => {
  const provider = requireEmbeddingProvider();
  const searchId = parse(z.string().regex(/^[a-f0-9]{32}$/), req.params.searchId);
  const filters = parse(visualSearchFiltersSchema, req.query);
  const cached = await VisualSearchCache.findOne({ key: searchId }).lean();
  if (!cached) throw notFound('Search results (they expire after 15 minutes — search again)');
  const candidates = cached.results.map((r) => ({ productId: String(r.productId), imageId: String(r.imageId), score: r.score! }));
  const threshold = minSimilarity(provider);
  const { matches, total } = await buildPage(candidates, filters, threshold);
  ok(res, { matches, meta: { ...pageMeta(filters.page, filters.limit, total), provider: provider.name, searchId } });
});

/** "More like this" for a product, using its stored image embeddings as the query. */
visualSearchRouter.get('/products/:id/similar', async (req, res) => {
  const provider = requireEmbeddingProvider();
  const productId = paramId(req.params.id);
  const filters = parse(visualSearchFiltersSchema, req.query);
  const own = await ProductEmbedding.findOne({ productId, provider: provider.name, model: provider.model }).select('embedding').lean();
  if (!own) {
    ok(res, { matches: [], meta: { ...pageMeta(filters.page, filters.limit, 0), provider: provider.name, searchId: '' } });
    return;
  }
  const candidates = await findSimilarProducts(own.embedding as number[], filters, { provider, excludeProductId: productId, candidates: 60 });
  const { matches, total } = await buildPage(candidates, filters, minSimilarity(provider));
  ok(res, { matches, meta: { ...pageMeta(filters.page, filters.limit, total), provider: provider.name, searchId: '' } });
});
