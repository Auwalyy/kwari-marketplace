import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { parseTrustProxy } from '../src/app';
import { assertRuntimeConfig, env, type Env } from '../src/config/env';
import { processUploadedImage } from '../src/services/images';
import { AppError } from '../src/utils/http';

const prodBase: Env = {
  ...env,
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://u:p@cluster0.example.mongodb.net/kkdm',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  API_BASE_URL: 'https://api.kantinkwari.ng',
  STORAGE_PROVIDER: 's3',
  STORAGE_BUCKET: 'kkdm',
  STORAGE_ACCESS_KEY: 'key',
  STORAGE_SECRET_KEY: 'secret',
  STORAGE_ENDPOINT: undefined,
  STORAGE_PUBLIC_BASE_URL: undefined,
  IMAGE_EMBEDDING_PROVIDER: 'none',
  VERIFICATION_EMAIL_PROVIDER: 'none',
  VERIFICATION_SMS_PROVIDER: 'none',
  CORS_ALLOWED_ORIGINS: [],
};

describe('runtime configuration', () => {
  it('parses TRUST_PROXY hop counts as numbers (Express treats numeric strings as IPs)', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('loopback')).toBe('loopback');
  });

  it('accepts a sane production configuration', () => {
    expect(() => assertRuntimeConfig(prodBase)).not.toThrow();
  });

  it('requires a public base URL for S3-compatible endpoints such as Cloudflare R2', () => {
    expect(() => assertRuntimeConfig({ ...prodBase, STORAGE_ENDPOINT: 'https://acc.r2.cloudflarestorage.com' })).toThrow(/STORAGE_PUBLIC_BASE_URL/);
    expect(() => assertRuntimeConfig({ ...prodBase, STORAGE_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', STORAGE_PUBLIC_BASE_URL: 'https://images.kantinkwari.ng' })).not.toThrow();
  });

  it('refuses unsafe production settings', () => {
    expect(() => assertRuntimeConfig({ ...prodBase, API_BASE_URL: 'http://api.kantinkwari.ng' })).toThrow(/https/);
    expect(() => assertRuntimeConfig({ ...prodBase, STORAGE_PROVIDER: 'local' })).toThrow(/local/);
    expect(() => assertRuntimeConfig({ ...prodBase, JWT_ACCESS_SECRET: 'short' })).toThrow(/32 characters/);
    expect(() => assertRuntimeConfig({ ...prodBase, IMAGE_EMBEDDING_PROVIDER: 'local-baseline' })).toThrow(/development-only/);
  });
});

describe('image uploads', () => {
  it('accepts JPEG and strips metadata', async () => {
    const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#7a5cff' } }).jpeg().withMetadata({ exif: { IFD0: { Make: 'TestCam' } } }).toBuffer();
    const out = await processUploadedImage(jpeg);
    expect(out.contentType).toBe('image/webp');
    expect((await sharp(out.full).metadata()).exif).toBeUndefined();
  });

  it('rejects files that are not images with a clear error', async () => {
    await expect(processUploadedImage(Buffer.from('definitely not an image'))).rejects.toMatchObject({ code: 'INVALID_IMAGE' } satisfies Partial<AppError>);
  });
});
