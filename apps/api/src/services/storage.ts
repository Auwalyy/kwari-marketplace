import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v2 as cloudinary } from 'cloudinary';
import { env, parseCloudinaryUrl } from '../config/env';
import { badRequest } from '../utils/http';

export type Visibility = 'public' | 'private';

/**
 * Object storage abstraction. Public objects (catalogue, shop and profile images) are served from a
 * public base URL / CDN. Private objects (chat attachments, verification evidence) are only reachable
 * through authorised API endpoints that stream them or issue short-lived signed URLs.
 */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string, visibility: Visibility): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
  /** Short-lived URL for a private object, or null when the provider streams through the API instead. */
  signedUrl(key: string, ttlSeconds: number): Promise<string | null>;
}

function assertSafeKey(key: string) {
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(key) || key.includes('..') || key.startsWith('/')) throw badRequest('Invalid storage key');
}

class LocalStorage implements StorageProvider {
  readonly name = 'local';
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    assertSafeKey(key);
    return path.join(this.root, key);
  }
  async put(key: string, body: Buffer) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
  publicUrl(key: string) {
    const base = env.STORAGE_PUBLIC_BASE_URL ?? `${env.API_BASE_URL.replace(/\/$/, '')}/uploads`;
    return `${base}/${key}`;
  }
  async signedUrl() {
    return null;
  }
}

class S3Storage implements StorageProvider {
  readonly name = 's3';
  private client: S3Client;
  constructor(
    private readonly bucket: string,
    private readonly privateBucket: string = bucket,
  ) {
    this.client = new S3Client({
      region: env.STORAGE_REGION ?? 'auto',
      endpoint: env.STORAGE_ENDPOINT,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.STORAGE_ACCESS_KEY!, secretAccessKey: env.STORAGE_SECRET_KEY! },
    });
  }
  /** Keys under private/ live in the private bucket when one is configured. */
  private bucketFor(key: string) {
    return key.startsWith('private/') ? this.privateBucket : this.bucket;
  }
  async put(key: string, body: Buffer, contentType: string, visibility: Visibility) {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketFor(key),
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, no-store',
      }),
    );
  }
  async get(key: string) {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucketFor(key), Key: key }));
    const bytes = await out.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketFor(key), Key: key }));
  }
  publicUrl(key: string) {
    if (env.STORAGE_PUBLIC_BASE_URL) return `${env.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
    if (env.STORAGE_ENDPOINT) return `${env.STORAGE_ENDPOINT.replace(/\/$/, '')}/${this.bucket}/${key}`;
    return `https://${this.bucket}.s3.${env.STORAGE_REGION}.amazonaws.com/${key}`;
  }
  async signedUrl(key: string, ttlSeconds: number) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucketFor(key), Key: key }), { expiresIn: ttlSeconds });
  }
}

/**
 * Cloudinary. Every stored object is an already-processed WebP image, uploaded unchanged. Keys under
 * public/ are ordinary delivery assets (`upload` type). Keys under private/ use the `private` type: their
 * original can only be fetched through a signed download URL that expires.
 */
export class CloudinaryStorage implements StorageProvider {
  readonly name = 'cloudinary';
  constructor(
    private readonly client: typeof cloudinary,
    private readonly folder: string,
  ) {}

  /** `public/products/a/b.webp` → public id `<folder>/public/products/a/b` + format `webp`. */
  private asset(key: string) {
    assertSafeKey(key);
    const dot = key.lastIndexOf('.');
    if (dot <= key.lastIndexOf('/')) throw badRequest('Invalid storage key');
    const prefix = this.folder.replace(/^\/+|\/+$/g, '');
    return {
      publicId: `${prefix ? `${prefix}/` : ''}${key.slice(0, dot)}`,
      format: key.slice(dot + 1),
      type: key.startsWith('private/') ? ('private' as const) : ('upload' as const),
    };
  }
  async put(key: string, body: Buffer) {
    const { publicId, type } = this.asset(key);
    await new Promise<void>((resolve, reject) => {
      this.client.uploader
        .upload_stream(
          { public_id: publicId, resource_type: 'image', type, overwrite: true, invalidate: true, unique_filename: false, use_filename: false },
          (err) => (err ? reject(new Error(`Cloudinary upload failed: ${err.message}`)) : resolve()),
        )
        .end(body);
    });
  }
  async get(key: string) {
    const { type } = this.asset(key);
    const url = type === 'private' ? this.privateDownloadUrl(key, 60) : this.publicUrl(key);
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Cloudinary download failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  async delete(key: string) {
    const { publicId, type } = this.asset(key);
    await this.client.uploader.destroy(publicId, { resource_type: 'image', type, invalidate: true });
  }
  publicUrl(key: string) {
    const { publicId, format } = this.asset(key);
    return this.client.url(publicId, { resource_type: 'image', type: 'upload', format, secure: true, urlAnalytics: false });
  }
  private privateDownloadUrl(key: string, ttlSeconds: number) {
    const { publicId, format } = this.asset(key);
    return this.client.utils.private_download_url(publicId, format, {
      resource_type: 'image',
      type: 'private',
      expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
    });
  }
  async signedUrl(key: string, ttlSeconds: number) {
    return this.privateDownloadUrl(key, ttlSeconds);
  }
}

function cloudinaryStorage() {
  const creds = parseCloudinaryUrl(env.CLOUDINARY_URL)!;
  cloudinary.config({ cloud_name: creds.cloudName, api_key: creds.apiKey, api_secret: creds.apiSecret, secure: true });
  return new CloudinaryStorage(cloudinary, env.CLOUDINARY_FOLDER);
}

let instance: StorageProvider | null = null;

export function storage(): StorageProvider {
  if (!instance) {
    if (env.STORAGE_PROVIDER === 's3') instance = new S3Storage(env.STORAGE_BUCKET!, env.STORAGE_PRIVATE_BUCKET ?? env.STORAGE_BUCKET!);
    else if (env.STORAGE_PROVIDER === 'cloudinary') instance = cloudinaryStorage();
    else instance = new LocalStorage(path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR));
  }
  return instance;
}

export function setStorageProvider(p: StorageProvider | null) {
  instance = p;
}

/** Public objects live under public/, private ones under private/ — the local static handler only serves public/. */
export function storageKey(visibility: Visibility, ...parts: string[]) {
  return [visibility, ...parts].join('/');
}
