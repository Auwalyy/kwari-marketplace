import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { isTest } from '../config/env';

/**
 * In-memory rate limiters. For multi-instance deployments plug a shared store (e.g. rate-limit-redis)
 * into `store` — see docs/deployment.md.
 */
function limiter(name: string, windowMs: number, limit: number, byUser = false, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit: isTest ? Math.max(limit * 50, 1000) : limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const ip = ipKeyGenerator(req.ip ?? 'unknown');
      return byUser && req.auth ? `${name}:u:${req.auth.userId}` : `${name}:ip:${ip}`;
    },
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' },
      });
    },
    ...extra,
  });
}

const MIN = 60_000;

export const globalLimiter = limiter('global', MIN, 300);
export const authLimiter = limiter('auth', 15 * MIN, 30);
export const otpLimiter = limiter('otp', 15 * MIN, 8);
export const invitationRedeemLimiter = limiter('invite', 15 * MIN, 15, true);
export const messagingLimiter = limiter('msg', MIN, 60, true);
export const searchLimiter = limiter('search', MIN, 90);
export const visualSearchLimiter = limiter('vsearch', MIN, 10, true);
export const uploadLimiter = limiter('upload', MIN, 30, true);
export const paymentLimiter = limiter('payment', MIN, 10, true);
export const writeLimiter = limiter('write', MIN, 120, true);
