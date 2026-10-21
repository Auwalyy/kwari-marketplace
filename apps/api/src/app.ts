import path from 'node:path';
import express, { Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env, isProd } from './config/env';
import { logger } from './config/logger';
import { isDatabaseReady } from './config/db';
import { requestId, rejectOperatorKeys } from './middleware/security';
import { globalLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './modules/auth/auth.routes';
import { usersRouter } from './modules/users/user.routes';
import { marketsRouter, sectionsRouter } from './modules/markets/markets.routes';
import { housesRouter } from './modules/houses/houses.routes';
import { houseInvitationsRouter, invitationsRouter, workerInvitationsRouter } from './modules/invitations/invitations.routes';
import { shopsRouter } from './modules/shops/shops.routes';
import { categoriesRouter } from './modules/categories/categories.routes';
import { productsRouter, shopProductsRouter } from './modules/products/products.routes';
import { searchRouter } from './modules/search/search.routes';
import { visualSearchRouter } from './modules/visual-search/visual-search.routes';
import { favoritesRouter } from './modules/favorites/favorites.routes';
import { cartRouter, checkoutRouter } from './modules/orders/cart.routes';
import { ordersRouter, shopOrdersRouter } from './modules/orders/orders.routes';
import { quotationsRouter } from './modules/orders/quotations.routes';
import { paymentsRouter, paymentWebhookRouter } from './modules/payments/payments.routes';
import { chatsRouter } from './modules/chats/chats.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { reviewsRouter } from './modules/reviews/reviews.routes';
import { reportsRouter, blocksRouter, verificationsRouter } from './modules/reports/reports.routes';
import { analyticsRouter } from './modules/analytics/analytics.routes';
import { promotionsRouter } from './modules/promotions/promotions.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { configRouter } from './modules/admin/config.routes';
import { buildOpenApiDocument } from './docs/openapi';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY === 'true' ? true : env.TRUST_PROXY === 'false' ? false : env.TRUST_PROXY);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId ?? '',
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
      serializers: { req: (req) => ({ id: req.id, method: req.method, url: req.url }) },
    }),
  );
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // Native mobile apps send no Origin header; browsers (Expo web, admin tools) must be allow-listed.
  const allowed = new Set([...env.CORS_ALLOWED_ORIGINS, ...(env.APP_ORIGIN ? [env.APP_ORIGIN] : [])]);
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || allowed.has(origin) || (!isProd && allowed.has('*'))) return cb(null, true);
        cb(null, false);
      },
      credentials: false,
      maxAge: 600,
    }),
  );

  // Health endpoints are outside the rate limiter and versioned API.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  });
  app.get('/ready', (_req, res) => {
    const ready = isDatabaseReady();
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', database: ready });
  });

  // Payment webhooks need the raw body for signature verification, so they are mounted before json().
  app.use('/api/v1/payments/webhooks', express.raw({ type: '*/*', limit: '1mb' }), paymentWebhookRouter);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(rejectOperatorKeys);

  if (env.STORAGE_PROVIDER === 'local') {
    // Development storage: only the public/ prefix is served. Private objects go through authorised routes.
    app.use(
      '/uploads/public',
      express.static(path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR, 'public'), { fallthrough: false, index: false, dotfiles: 'deny', maxAge: '7d' }),
    );
  }

  if (env.SWAGGER_ENABLED) {
    const doc = buildOpenApiDocument();
    app.get('/api/v1/openapi.json', (_req, res) => {
      res.json(doc);
    });
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(doc, { customSiteTitle: 'Kantin Kwari API' }));
  }

  const v1 = Router();
  v1.use(globalLimiter);
  v1.use('/config', configRouter);
  v1.use('/auth', authRouter);
  v1.use('/users', usersRouter);
  v1.use('/markets', marketsRouter);
  v1.use('/sections', sectionsRouter);
  v1.use('/houses/:houseId/invitations', houseInvitationsRouter);
  v1.use('/houses', housesRouter);
  v1.use('/invitations', invitationsRouter);
  v1.use('/shops/:shopId/worker-invitations', workerInvitationsRouter);
  v1.use('/shops/:shopId/products', shopProductsRouter);
  v1.use('/shops/:shopId/orders', shopOrdersRouter);
  v1.use('/shops', shopsRouter);
  v1.use('/categories', categoriesRouter);
  v1.use('/products', productsRouter);
  v1.use('/search', searchRouter);
  v1.use('/visual-search', visualSearchRouter);
  v1.use('/favorites', favoritesRouter);
  v1.use('/cart', cartRouter);
  v1.use('/checkout', checkoutRouter);
  v1.use('/orders', ordersRouter);
  v1.use('/quotations', quotationsRouter);
  v1.use('/payments', paymentsRouter);
  v1.use('/conversations', chatsRouter);
  v1.use('/notifications', notificationsRouter);
  v1.use('/reviews', reviewsRouter);
  v1.use('/reports', reportsRouter);
  v1.use('/blocks', blocksRouter);
  v1.use('/verifications', verificationsRouter);
  v1.use('/analytics', analyticsRouter);
  v1.use('/promotions', promotionsRouter);
  v1.use('/admin', adminRouter);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
