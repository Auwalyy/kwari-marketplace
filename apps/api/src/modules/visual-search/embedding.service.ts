import { Types } from 'mongoose';
import type { VisualSearchFilters } from '@kkdm/shared';
import { ProductEmbedding } from './embedding.model';
import { EmbeddingProviderError, embeddingProvider, requireEmbeddingProvider, type ImageEmbeddingProvider } from './providers';
import { Product } from '../products/product.models';
import { normalizeForEmbedding } from '../../services/images';
import { storage } from '../../services/storage';
import { enqueueJob, registerJobHandler } from '../../jobs/queue';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { serviceUnavailable } from '../../utils/http';

/* Embedding generation ------------------------------------------------------------------------- */

export async function generateProductImageEmbedding(image: Buffer, p: ImageEmbeddingProvider = requireEmbeddingProvider()) {
  const [vector] = await p.embed([await normalizeForEmbedding(image)]);
  return vector;
}

/** Identical preprocessing to catalogue images so both sides of the comparison are consistent. */
export async function generateQueryImageEmbedding(image: Buffer, p: ImageEmbeddingProvider = requireEmbeddingProvider()) {
  try {
    const [vector] = await p.embed([await normalizeForEmbedding(image)]);
    return vector;
  } catch (err) {
    if (err instanceof EmbeddingProviderError) {
      logger.warn({ provider: p.name, error: err.message }, 'Query embedding failed');
      throw serviceUnavailable('Visual search is temporarily unavailable. Please try again, or use text search.', 'VISUAL_SEARCH_PROVIDER_ERROR');
    }
    throw err;
  }
}

/** Queue embedding generation for one image (deduplicated while a job for it is pending). */
export async function queueImageEmbedding(productId: Types.ObjectId | string, imageId: Types.ObjectId | string) {
  if (!embeddingProvider()) {
    await Product.updateOne({ _id: productId, 'images._id': imageId }, { $set: { 'images.$.embeddingStatus': 'disabled' } });
    return;
  }
  await enqueueJob('embedding.generate', { productId: String(productId), imageId: String(imageId) }, { dedupeKey: `embed:${imageId}`, maxAttempts: 5 });
}

export function embeddingFilterFields(p: {
  shopId: unknown;
  marketId: unknown;
  houseId: unknown;
  categoryId: unknown;
  status: string;
  moderationStatus: string;
  shopListed: boolean;
  stockStatus: string;
  retailPriceKobo: number;
  wholesalePriceKobo?: number | null;
}) {
  return {
    shopId: p.shopId,
    marketId: p.marketId,
    houseId: p.houseId,
    categoryId: p.categoryId,
    searchable: p.status === 'published' && p.moderationStatus === 'approved' && p.shopListed,
    inStock: p.stockStatus !== 'out_of_stock',
    retailPriceKobo: p.retailPriceKobo,
    wholesale: p.wholesalePriceKobo != null,
  };
}

/** Keeps denormalised filter fields on embeddings in sync with the product. */
export async function syncProductEmbeddingFilters(productId: Types.ObjectId | string) {
  const p = await Product.findById(productId).lean();
  if (!p) {
    await ProductEmbedding.deleteMany({ productId });
    return;
  }
  const imageIds = (p.images ?? []).map((i) => i._id);
  await ProductEmbedding.deleteMany({ productId, imageId: { $nin: imageIds } });
  await ProductEmbedding.updateMany({ productId }, { $set: embeddingFilterFields(p as any) });
}

registerJobHandler('embedding.generate', async (payload, job) => {
  const provider = embeddingProvider();
  const { productId, imageId } = payload as { productId: string; imageId: string };
  if (!provider) {
    await Product.updateOne({ _id: productId, 'images._id': imageId }, { $set: { 'images.$.embeddingStatus': 'disabled' } });
    return;
  }
  const product = await Product.findById(productId).lean();
  const image = product?.images?.find((i) => String(i._id) === imageId);
  if (!product || !image) return; // image was deleted meanwhile
  await Product.updateOne({ _id: productId, 'images._id': imageId }, { $set: { 'images.$.embeddingStatus': 'processing' }, $inc: { 'images.$.embeddingAttempts': 1 } });
  try {
    const buffer = await storage().get(image.key);
    const vector = await generateProductImageEmbedding(buffer, provider);
    await ProductEmbedding.updateOne(
      { imageId: image._id, provider: provider.name, model: provider.model },
      {
        $set: {
          productId: product._id,
          dimensions: vector.length,
          embedding: vector,
          ...embeddingFilterFields(product as any),
        },
      },
      { upsert: true },
    );
    await Product.updateOne(
      { _id: productId, 'images._id': imageId },
      { $set: { 'images.$.embeddingStatus': 'ready', 'images.$.embeddingUpdatedAt': new Date() }, $unset: { 'images.$.embeddingError': '' } },
    );
  } catch (err) {
    const retryable = !(err instanceof EmbeddingProviderError) || err.retryable;
    const final = !retryable || job.attempts >= job.maxAttempts;
    await Product.updateOne(
      { _id: productId, 'images._id': imageId },
      { $set: { 'images.$.embeddingStatus': final ? 'failed' : 'pending', 'images.$.embeddingError': (err as Error).message.slice(0, 200) } },
    );
    if (retryable) throw err;
  }
});

/* Similarity retrieval ------------------------------------------------------------------------- */

export interface SimilarCandidate {
  productId: string;
  imageId: string;
  score: number;
}

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function prefilter(p: ImageEmbeddingProvider, f: Partial<VisualSearchFilters>, excludeProductId?: string) {
  const filter: Record<string, unknown> = { provider: p.name, model: p.model, searchable: true };
  if (f.categoryId) filter.categoryId = new Types.ObjectId(f.categoryId);
  if (f.marketId) filter.marketId = new Types.ObjectId(f.marketId);
  if (f.houseId) filter.houseId = new Types.ObjectId(f.houseId);
  if (f.wholesaleOnly) filter.wholesale = true;
  if (f.inStockOnly) filter.inStock = true;
  if (f.minPriceKobo != null || f.maxPriceKobo != null) {
    filter.retailPriceKobo = { ...(f.minPriceKobo != null ? { $gte: f.minPriceKobo } : {}), ...(f.maxPriceKobo != null ? { $lte: f.maxPriceKobo } : {}) };
  }
  if (excludeProductId) filter.productId = { $ne: new Types.ObjectId(excludeProductId) };
  return filter;
}

/**
 * Finds visually similar products. Uses Atlas `$vectorSearch` when configured, otherwise an exhaustive
 * cosine scan bounded by VECTOR_SEARCH_EXHAUSTIVE_LIMIT (suitable for development and small catalogues).
 * Multiple images of one product are consolidated to the best-scoring image.
 */
export async function findSimilarProducts(
  embedding: number[],
  filters: Partial<VisualSearchFilters>,
  opts: { candidates?: number; excludeProductId?: string; provider?: ImageEmbeddingProvider } = {},
): Promise<SimilarCandidate[]> {
  const p = opts.provider ?? requireEmbeddingProvider();
  const k = opts.candidates ?? 200;
  const filter = prefilter(p, filters, opts.excludeProductId);
  let raw: SimilarCandidate[];

  if (env.VECTOR_SEARCH_PROVIDER === 'atlas') {
    try {
      const rows = await ProductEmbedding.aggregate([
        {
          $vectorSearch: {
            index: env.VECTOR_SEARCH_INDEX_NAME,
            path: 'embedding',
            queryVector: embedding,
            numCandidates: Math.min(k * 10, 10_000),
            limit: k,
            filter,
          },
        },
        { $project: { productId: 1, imageId: 1, score: { $meta: 'vectorSearchScore' } } },
      ]);
      // Atlas cosine score is (1 + cos) / 2; convert back to cosine similarity.
      raw = rows.map((r) => ({ productId: String(r.productId), imageId: String(r.imageId), score: r.score * 2 - 1 }));
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Atlas vector search failed — is the vector index created?');
      throw serviceUnavailable('Visual search is temporarily unavailable. Please try again, or use text search.', 'VECTOR_INDEX_UNAVAILABLE');
    }
  } else {
    const top: SimilarCandidate[] = [];
    const cursor = ProductEmbedding.find(filter).select('productId imageId embedding').limit(env.VECTOR_SEARCH_EXHAUSTIVE_LIMIT).lean().cursor();
    for await (const doc of cursor) {
      const score = cosine(embedding, doc.embedding as number[]);
      if (top.length < k || score > top[top.length - 1].score) {
        top.push({ productId: String(doc.productId), imageId: String(doc.imageId), score });
        top.sort((a, b) => b.score - a.score);
        if (top.length > k) top.pop();
      }
    }
    raw = top;
  }

  const best = new Map<string, SimilarCandidate>();
  for (const c of raw) {
    const prev = best.get(c.productId);
    if (!prev || c.score > prev.score) best.set(c.productId, c);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

export function minSimilarity(p: ImageEmbeddingProvider) {
  return env.VISUAL_SEARCH_MIN_SIMILARITY ?? p.defaultMinSimilarity;
}

/** Maps a raw similarity to a band relative to the threshold. Never "exact". */
export function relevanceBand(score: number, threshold: number): 'very_similar' | 'similar' | 'somewhat_similar' {
  const rel = (score - threshold) / Math.max(1 - threshold, 1e-6);
  if (rel >= 0.6) return 'very_similar';
  if (rel >= 0.3) return 'similar';
  return 'somewhat_similar';
}
