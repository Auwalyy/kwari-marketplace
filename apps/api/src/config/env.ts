import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const emptyToUndefined = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

/** Parses a duration such as "15m", "30d", "3600" (seconds) into seconds. */
function durationSeconds(def: string) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const v = raw && raw.trim() !== '' ? raw.trim() : def;
      const m = /^(\d+)\s*([smhd]?)$/.exec(v);
      if (!m) {
        ctx.addIssue({ code: 'custom', message: `Invalid duration "${v}"` });
        return z.NEVER;
      }
      const n = Number(m[1]);
      const mult = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2] as '' | 's' | 'm' | 'h' | 'd'];
      return n * mult;
    });
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  API_BASE_URL: z.string().default('http://localhost:4000'),
  MONGODB_URI: emptyToUndefined,
  /** Set to false for standalone MongoDB servers that do not support multi-document transactions. */
  MONGODB_TRANSACTIONS: bool(true),
  JWT_ACCESS_SECRET: emptyToUndefined,
  JWT_REFRESH_SECRET: emptyToUndefined,
  ACCESS_TOKEN_TTL: durationSeconds('15m'),
  REFRESH_TOKEN_TTL: durationSeconds('30d'),
  APP_ORIGIN: emptyToUndefined,
  CORS_ALLOWED_ORIGINS: csv,
  TRUST_PROXY: z.string().optional().default('loopback'),

  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('uploads'),
  STORAGE_PUBLIC_BASE_URL: emptyToUndefined,
  STORAGE_BUCKET: emptyToUndefined,
  STORAGE_REGION: emptyToUndefined,
  STORAGE_ENDPOINT: emptyToUndefined,
  STORAGE_ACCESS_KEY: emptyToUndefined,
  STORAGE_SECRET_KEY: emptyToUndefined,
  STORAGE_FORCE_PATH_STYLE: bool(false),

  IMAGE_EMBEDDING_PROVIDER: z.enum(['none', 'jina', 'cohere', 'local-baseline']).default('none'),
  IMAGE_EMBEDDING_API_KEY: emptyToUndefined,
  IMAGE_EMBEDDING_MODEL: emptyToUndefined,
  IMAGE_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),
  IMAGE_EMBEDDING_TIMEOUT_MS: z.coerce.number().int().default(20000),
  VECTOR_SEARCH_PROVIDER: z.enum(['atlas', 'exhaustive']).default('exhaustive'),
  VECTOR_SEARCH_INDEX_NAME: z.string().default('product_image_embeddings'),
  /** Upper bound for the exhaustive (non-Atlas) cosine scan. */
  VECTOR_SEARCH_EXHAUSTIVE_LIMIT: z.coerce.number().int().default(20000),
  /** Overrides the provider's default minimum similarity for showing a visual match. */
  VISUAL_SEARCH_MIN_SIMILARITY: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().min(0).max(1).optional()),

  PAYMENT_PROVIDER: z.enum(['none', 'paystack', 'flutterwave']).default('none'),
  PAYSTACK_SECRET_KEY: emptyToUndefined,
  FLUTTERWAVE_SECRET_KEY: emptyToUndefined,
  /** Flutterwave "secret hash" configured on the dashboard; Paystack signs with the secret key. */
  PAYMENT_WEBHOOK_SECRET: emptyToUndefined,
  PAYMENT_CALLBACK_URL: emptyToUndefined,

  VERIFICATION_EMAIL_PROVIDER: z.enum(['console', 'smtp', 'none']).default('console'),
  SMTP_HOST: emptyToUndefined,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: emptyToUndefined,
  SMTP_PASSWORD: emptyToUndefined,
  SMTP_FROM: z.string().default('Kantin Kwari Digital Market <no-reply@example.com>'),
  VERIFICATION_SMS_PROVIDER: z.enum(['console', 'termii', 'none']).default('console'),
  TERMII_API_KEY: emptyToUndefined,
  TERMII_SENDER_ID: z.string().default('KantinKwari'),
  TERMII_BASE_URL: z.string().default('https://api.ng.termii.com'),

  EXPO_ACCESS_TOKEN: emptyToUndefined,
  PUSH_NOTIFICATION_ENABLED: bool(false),
  MAPS_API_KEY: emptyToUndefined,

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JOBS_ENABLED: bool(true),
  SWAGGER_ENABLED: bool(true),
  SEED_ALLOW: bool(false),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV === 'test') {
    env.JWT_ACCESS_SECRET ??= 'test-access-secret-test-access-secret';
    env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-test-refresh-secret';
  }
  return env;
}

export const env = load();

/** Validates settings required to actually serve traffic; called at server start, not at import. */
export function assertRuntimeConfig(e: Env = env): void {
  const problems: string[] = [];
  if (!e.MONGODB_URI) problems.push('MONGODB_URI is required');
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const v = e[key];
    if (!v) problems.push(`${key} is required`);
    else if (e.NODE_ENV === 'production' && v.length < 32) problems.push(`${key} must be at least 32 characters in production`);
  }
  if (e.JWT_ACCESS_SECRET && e.JWT_ACCESS_SECRET === e.JWT_REFRESH_SECRET) problems.push('JWT access and refresh secrets must differ');
  if (e.STORAGE_PROVIDER === 's3' && (!e.STORAGE_BUCKET || !e.STORAGE_ACCESS_KEY || !e.STORAGE_SECRET_KEY)) {
    problems.push('STORAGE_BUCKET, STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY are required when STORAGE_PROVIDER=s3');
  }
  if (e.NODE_ENV === 'production') {
    if (e.STORAGE_PROVIDER === 'local') problems.push('STORAGE_PROVIDER=local is not allowed in production; configure s3');
    if (e.IMAGE_EMBEDDING_PROVIDER === 'local-baseline') {
      problems.push('IMAGE_EMBEDDING_PROVIDER=local-baseline is a development-only baseline; configure jina or cohere');
    }
    if (e.CORS_ALLOWED_ORIGINS.includes('*')) problems.push('CORS_ALLOWED_ORIGINS must not contain * in production');
  }
  if ((e.IMAGE_EMBEDDING_PROVIDER === 'jina' || e.IMAGE_EMBEDDING_PROVIDER === 'cohere') && !e.IMAGE_EMBEDDING_API_KEY) {
    problems.push(`IMAGE_EMBEDDING_API_KEY is required for IMAGE_EMBEDDING_PROVIDER=${e.IMAGE_EMBEDDING_PROVIDER}`);
  }
  if (e.PAYMENT_PROVIDER === 'paystack' && !e.PAYSTACK_SECRET_KEY) problems.push('PAYSTACK_SECRET_KEY is required for PAYMENT_PROVIDER=paystack');
  if (e.PAYMENT_PROVIDER === 'flutterwave' && (!e.FLUTTERWAVE_SECRET_KEY || !e.PAYMENT_WEBHOOK_SECRET)) {
    problems.push('FLUTTERWAVE_SECRET_KEY and PAYMENT_WEBHOOK_SECRET are required for PAYMENT_PROVIDER=flutterwave');
  }
  if (e.VERIFICATION_EMAIL_PROVIDER === 'smtp' && !e.SMTP_HOST) problems.push('SMTP_HOST is required for VERIFICATION_EMAIL_PROVIDER=smtp');
  if (e.VERIFICATION_SMS_PROVIDER === 'termii' && !e.TERMII_API_KEY) problems.push('TERMII_API_KEY is required for VERIFICATION_SMS_PROVIDER=termii');
  if (e.NODE_ENV === 'production' && (e.VERIFICATION_EMAIL_PROVIDER === 'console' || e.VERIFICATION_SMS_PROVIDER === 'console')) {
    problems.push('console verification providers print codes to logs and are not allowed in production');
  }
  if (problems.length) throw new Error(`Configuration errors:\n  - ${problems.join('\n  - ')}`);
}

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
