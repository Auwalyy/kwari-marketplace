import pino from 'pino';
import { env, isProd, isTest } from './env';

/**
 * Structured logger. Sensitive fields are redacted so tokens, passwords, codes and private message
 * bodies never reach log storage.
 */
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-paystack-signature"]',
      'req.headers["verif-hash"]',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.refreshToken',
      '*.accessToken',
      '*.code',
      '*.token',
      '*.text',
      '*.secret',
    ],
    censor: '[redacted]',
  },
  transport:
    !isProd && !isTest
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } }
      : undefined,
});
