import { v2 as cloudinary } from 'cloudinary';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertRuntimeConfig, env, parseCloudinaryUrl, type Env } from '../src/config/env';
import { CloudinaryStorage } from '../src/services/storage';

cloudinary.config({ cloud_name: 'democloud', api_key: '123', api_secret: 'abc', secure: true });

/** Real URL helpers, recorded upload/destroy calls: nothing reaches Cloudinary. */
function fakeClient() {
  const uploads: { options: Record<string, unknown>; bytes: number }[] = [];
  const destroys: { publicId: string; options: Record<string, unknown> }[] = [];
  const client = {
    url: cloudinary.url,
    utils: cloudinary.utils,
    uploader: {
      upload_stream: (options: Record<string, unknown>, cb: (err?: Error) => void) => ({
        end: (body: Buffer) => {
          uploads.push({ options, bytes: body.length });
          cb();
        },
      }),
      destroy: async (publicId: string, options: Record<string, unknown>) => {
        destroys.push({ publicId, options });
        return { result: 'ok' };
      },
    },
  } as unknown as typeof cloudinary;
  return { client, uploads, destroys };
}

describe('Cloudinary storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uploads public images as delivery assets and private ones as private assets', async () => {
    const { client, uploads } = fakeClient();
    const s = new CloudinaryStorage(client, 'kantin-kwari');
    await s.put('public/products/s1/p1/img.webp', Buffer.alloc(10));
    await s.put('private/chat/c1/m1.webp', Buffer.alloc(20));
    expect(uploads[0].options).toMatchObject({ public_id: 'kantin-kwari/public/products/s1/p1/img', type: 'upload', resource_type: 'image', overwrite: true });
    expect(uploads[1].options).toMatchObject({ public_id: 'kantin-kwari/private/chat/c1/m1', type: 'private' });
    expect(uploads.map((u) => u.bytes)).toEqual([10, 20]);
  });

  it('builds public URLs and short-lived signed URLs for private files', async () => {
    const s = new CloudinaryStorage(fakeClient().client, 'kantin-kwari');
    expect(s.publicUrl('public/shops/s1/logo-1.webp')).toBe('https://res.cloudinary.com/democloud/image/upload/v1/kantin-kwari/public/shops/s1/logo-1.webp');
    const signed = new URL((await s.signedUrl('private/chat/c1/m1.webp', 300))!);
    expect(signed.host).toBe('api.cloudinary.com');
    expect(signed.searchParams.get('type')).toBe('private');
    expect(signed.searchParams.get('public_id')).toBe('kantin-kwari/private/chat/c1/m1');
    expect(Number(signed.searchParams.get('expires_at')) - Date.now() / 1000).toBeLessThanOrEqual(300);
    expect(signed.searchParams.get('signature')).toBeTruthy();
  });

  it('downloads private files through a signed URL and deletes with the matching type', async () => {
    const { client, destroys } = fakeClient();
    const s = new CloudinaryStorage(client, '');
    const fetchMock = vi.fn(async () => new Response(Buffer.from('webp-bytes')));
    vi.stubGlobal('fetch', fetchMock);
    expect((await s.get('private/chat/c1/m1.webp')).toString()).toBe('webp-bytes');
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/image/download?');
    await s.delete('private/chat/c1/m1.webp');
    expect(destroys[0]).toMatchObject({ publicId: 'private/chat/c1/m1', options: { type: 'private', resource_type: 'image' } });
  });

  it('rejects keys without a file extension or with path tricks', () => {
    const s = new CloudinaryStorage(fakeClient().client, 'kantin-kwari');
    expect(() => s.publicUrl('public/noext')).toThrow();
    expect(() => s.publicUrl('public/../secret.webp')).toThrow();
  });

  it('requires a valid CLOUDINARY_URL', () => {
    expect(parseCloudinaryUrl('cloudinary://123:abc@democloud')).toEqual({ cloudName: 'democloud', apiKey: '123', apiSecret: 'abc' });
    expect(parseCloudinaryUrl('https://democloud')).toBeNull();
    const base: Env = { ...env, MONGODB_URI: 'mongodb://x/kkdm', JWT_ACCESS_SECRET: 'a'.repeat(48), JWT_REFRESH_SECRET: 'b'.repeat(48), STORAGE_PROVIDER: 'cloudinary' };
    expect(() => assertRuntimeConfig({ ...base, CLOUDINARY_URL: undefined })).toThrow(/CLOUDINARY_URL is required/);
    expect(() => assertRuntimeConfig({ ...base, CLOUDINARY_URL: 'cloudinary://123:abc@democloud' })).not.toThrow();
  });
});
