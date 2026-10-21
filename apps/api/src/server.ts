import http from 'node:http';
import { assertRuntimeConfig, env } from './config/env';
import { logger } from './config/logger';
import { connectDatabase, disconnectDatabase } from './config/db';
import { createApp } from './app';
import { initSockets } from './sockets';
import { startJobWorker, stopJobWorker } from './jobs/queue';
import { startScheduler, stopScheduler } from './jobs/scheduler';
import { embeddingProvider } from './modules/visual-search/providers';
import { paymentProvider } from './modules/payments/providers';

async function main() {
  assertRuntimeConfig();
  await connectDatabase();

  const app = createApp();
  const server = http.createServer(app);
  const io = initSockets(server);
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  if (env.JOBS_ENABLED) {
    startJobWorker();
    startScheduler();
  }

  server.listen(env.PORT, () => {
    const visual = embeddingProvider();
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        storage: env.STORAGE_PROVIDER,
        visualSearch: visual ? `${visual.name}/${visual.model}${visual.developmentOnly ? ' (DEV ONLY)' : ''}` : 'not configured',
        vectorSearch: env.VECTOR_SEARCH_PROVIDER,
        payments: paymentProvider()?.name ?? 'not configured',
        push: env.PUSH_NOTIFICATION_ENABLED,
      },
      `Kantin Kwari API listening on ${env.API_BASE_URL}`,
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');
    const force = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15_000);
    force.unref();
    stopScheduler();
    stopJobWorker();
    io.close();
    server.close(async () => {
      await disconnectDatabase().catch(() => undefined);
      logger.info('Shutdown complete');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'Unhandled promise rejection'));
}

main().catch((err) => {
  logger.fatal({ err: err instanceof Error ? err.message : err }, 'Failed to start server');
  process.exit(1);
});
