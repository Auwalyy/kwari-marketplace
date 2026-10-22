/**
 * Removes the demo shops, products and accounts added by `npm run seed` (or `seed -- --live`).
 *
 *   npm run demo:remove                  shows what would be removed, changes nothing
 *   npm run demo:remove -- --confirm     removes it
 */
import { connectDatabase, disconnectDatabase } from '../config/db';
import { logger } from '../config/logger';
import '../app';
import { removeDemoData } from './demo-data';

async function main() {
  const confirm = process.argv.includes('--confirm');
  const conn = await connectDatabase();
  const summary = await removeDemoData({ dryRun: !confirm });
  logger.info({ database: conn.connection.name, ...summary }, confirm ? 'Demo data removed' : 'Preview only — nothing was changed. Run again with -- --confirm to remove this');
  await disconnectDatabase();
}

main().catch(async (err) => {
  logger.fatal({ err: (err as Error).message }, 'Demo data removal failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
