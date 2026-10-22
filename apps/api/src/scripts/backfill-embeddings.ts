/**
 * Queues embedding generation for every product image that has no embedding for the currently
 * configured provider/model (after first configuring a provider, or switching models), then processes
 * the queue. Run: npm run embeddings:backfill
 */
import { connectDatabase, disconnectDatabase } from '../config/db';
import { logger } from '../config/logger';
import '../app';
import { Product } from '../modules/products/product.models';
import { ProductEmbedding } from '../modules/visual-search/embedding.model';
import { embeddingProvider } from '../modules/visual-search/providers';
import { queueImageEmbedding } from '../modules/visual-search/embedding.service';
import { drainJobs } from '../jobs/queue';

async function main() {
  const provider = embeddingProvider();
  if (!provider) throw new Error('IMAGE_EMBEDDING_PROVIDER is not configured');
  await connectDatabase();
  let queued = 0;
  const cursor = Product.find({ 'images.0': { $exists: true } }).select('images').lean().cursor();
  for await (const p of cursor) {
    for (const img of p.images) {
      const has = await ProductEmbedding.exists({ imageId: img._id, provider: provider.name, model: provider.model });
      if (!has) {
        await Product.updateOne({ _id: p._id, 'images._id': img._id }, { $set: { 'images.$.embeddingStatus': 'pending', 'images.$.embeddingAttempts': 0 } });
        await queueImageEmbedding(p._id, img._id);
        queued++;
      }
    }
  }
  logger.info({ queued, provider: provider.name, model: provider.model }, 'Embedding jobs queued; processing…');
  let processed = 0;
  for (;;) {
    const n = await drainJobs(50);
    processed += n;
    if (n === 0) break;
  }
  logger.info({ processed }, 'Backfill finished (failed images can be retried from the app or by re-running)');
  await disconnectDatabase();
}

main().catch(async (err) => {
  logger.fatal({ err: err.message }, 'Backfill failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
