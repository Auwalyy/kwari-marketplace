/**
 * One-time production setup: creates the Kantin Kwari market and the fabric categories so sellers can
 * register houses and shops and list products. No demo users, shops or products. Safe to run again:
 * anything that already exists is left unchanged.
 *
 *   npm run setup:reference -w @kkdm/api
 */
import { connectDatabase, disconnectDatabase } from '../config/db';
import { logger } from '../config/logger';
import { ensureReferenceData } from './reference-data';

async function main() {
  await connectDatabase();
  const { market, categories, createdCategories } = await ensureReferenceData();
  logger.info({ market: market.name, categories: Object.keys(categories).length, createdCategories }, 'Reference data ready');
  await disconnectDatabase();
}

main().catch(async (err) => {
  logger.error({ err: (err as Error).message }, 'Reference data setup failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
