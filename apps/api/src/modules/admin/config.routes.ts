import { Router } from 'express';
import { BUSINESS_TIMEZONE, CURRENCY, INVITATION_POLICY, MEASUREMENT_UNITS, UPLOAD_LIMITS } from '@kkdm/shared';
import { embeddingProvider } from '../visual-search/providers';
import { paymentProvider } from '../payments/providers';
import { pushEnabled } from '../../services/push';
import { env } from '../../config/env';
import { ok } from '../../utils/http';

/** Public runtime configuration so the app can show honest availability of optional services. */
export const configRouter = Router();

configRouter.get('/', (_req, res) => {
  const visual = embeddingProvider();
  const payment = paymentProvider();
  ok(res, {
    currency: CURRENCY,
    timezone: BUSINESS_TIMEZONE,
    units: MEASUREMENT_UNITS,
    invitationPolicy: INVITATION_POLICY,
    uploadLimits: UPLOAD_LIMITS,
    features: {
      visualSearch: { available: !!visual, provider: visual?.name ?? null, developmentOnly: !!visual?.developmentOnly },
      onlinePayment: { available: !!payment, provider: payment?.name ?? null },
      pushNotifications: pushEnabled(),
      maps: !!env.MAPS_API_KEY,
    },
  });
});
