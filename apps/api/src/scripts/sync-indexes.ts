/**
 * Creates / syncs all MongoDB indexes and, when VECTOR_SEARCH_PROVIDER=atlas, the Atlas Vector Search
 * index for product image embeddings. Safe to run repeatedly.
 *
 *   npm run db:indexes
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db';
import { env } from '../config/env';
import { logger } from '../config/logger';
import '../app'; // registers every model
import { ProductEmbedding } from '../modules/visual-search/embedding.model';
import { embeddingProvider } from '../modules/visual-search/providers';

async function main() {
  await connectDatabase();
  for (const [name, model] of Object.entries(mongoose.models)) {
    const dropped = await model.syncIndexes();
    logger.info({ model: name, dropped }, 'Indexes synced');
  }

  if (env.VECTOR_SEARCH_PROVIDER === 'atlas') {
    const provider = embeddingProvider();
    if (!provider) throw new Error('Configure IMAGE_EMBEDDING_PROVIDER before creating the vector index (dimensions depend on it)');
    const definition = {
      fields: [
        { type: 'vector', path: 'embedding', numDimensions: provider.dimensions, similarity: 'cosine' },
        { type: 'filter', path: 'provider' },
        { type: 'filter', path: 'model' },
        { type: 'filter', path: 'searchable' },
        { type: 'filter', path: 'categoryId' },
        { type: 'filter', path: 'marketId' },
        { type: 'filter', path: 'houseId' },
        { type: 'filter', path: 'wholesale' },
        { type: 'filter', path: 'inStock' },
        { type: 'filter', path: 'retailPriceKobo' },
        { type: 'filter', path: 'productId' },
      ],
    };
    const coll = ProductEmbedding.collection;
    const existing = await coll.listSearchIndexes(env.VECTOR_SEARCH_INDEX_NAME).toArray();
    if (existing.length) {
      await coll.updateSearchIndex(env.VECTOR_SEARCH_INDEX_NAME, definition);
      logger.info({ index: env.VECTOR_SEARCH_INDEX_NAME }, 'Atlas vector index updated (rebuild runs in the background)');
    } else {
      await coll.createSearchIndex({ name: env.VECTOR_SEARCH_INDEX_NAME, type: 'vectorSearch', definition });
      logger.info({ index: env.VECTOR_SEARCH_INDEX_NAME, dimensions: provider.dimensions }, 'Atlas vector index created; wait until it is READY in the Atlas UI');
    }
  } else {
    logger.info('VECTOR_SEARCH_PROVIDER=exhaustive: no vector index needed (bounded cosine scan)');
  }
  await disconnectDatabase();
}

main().catch(async (err) => {
  logger.fatal({ err: err.message }, 'Index sync failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
