import sharp from 'sharp';
import { UPLOAD_LIMITS } from '@kkdm/shared';
import { badRequest } from '../utils/http';
import { sha256 } from '../utils/crypto';

sharp.cache(false);

export interface ProcessedImage {
  full: Buffer;
  thumbnail: Buffer;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  contentType: 'image/webp';
}

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);

/**
 * Decodes an untrusted upload, verifies that it really is an image of an allowed format and size,
 * auto-orients it and re-encodes it as WebP. Re-encoding drops all metadata (EXIF, GPS, ICC beyond sRGB)
 * and neutralises polyglot / malformed payloads.
 */
export async function processUploadedImage(
  input: Buffer,
  opts: { maxDimension?: number; thumbnailSize?: number; quality?: number } = {},
): Promise<ProcessedImage> {
  if (!input?.length) throw badRequest('Empty file', 'INVALID_IMAGE');
  if (input.length > UPLOAD_LIMITS.maxImageBytes) throw badRequest('The image is too large', 'IMAGE_TOO_LARGE');

  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: 80_000_000, failOn: 'error' }).metadata();
  } catch {
    throw badRequest('The file is not a valid image', 'INVALID_IMAGE');
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    throw badRequest('Only JPEG, PNG, WebP or HEIC images are allowed', 'UNSUPPORTED_FILE_TYPE');
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < UPLOAD_LIMITS.minImageDimension || h < UPLOAD_LIMITS.minImageDimension) {
    throw badRequest(`Images must be at least ${UPLOAD_LIMITS.minImageDimension}px on each side`, 'IMAGE_TOO_SMALL');
  }
  if (w > UPLOAD_LIMITS.maxImageDimension || h > UPLOAD_LIMITS.maxImageDimension) {
    throw badRequest('Image dimensions are too large', 'IMAGE_TOO_LARGE');
  }

  const maxDimension = opts.maxDimension ?? 1600;
  const quality = opts.quality ?? 82;
  try {
    const base = sharp(input, { limitInputPixels: 80_000_000, failOn: 'error' }).rotate();
    const full = await base
      .clone()
      .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await base
      .clone()
      .resize({ width: opts.thumbnailSize ?? 400, height: opts.thumbnailSize ?? 400, fit: 'cover', position: 'attention' })
      .webp({ quality: 75 })
      .toBuffer();
    return {
      full: full.data,
      thumbnail,
      width: full.info.width,
      height: full.info.height,
      bytes: full.data.length,
      sha256: sha256(full.data),
      contentType: 'image/webp',
    };
  } catch {
    throw badRequest('The image could not be processed', 'INVALID_IMAGE');
  }
}

/** Validates an untrusted image (format, size, dimensions) without re-encoding it. */
export async function assertValidImage(input: Buffer): Promise<void> {
  if (!input?.length) throw badRequest('Empty file', 'INVALID_IMAGE');
  if (input.length > UPLOAD_LIMITS.maxImageBytes) throw badRequest('The image is too large', 'IMAGE_TOO_LARGE');
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: 80_000_000, failOn: 'error' }).metadata();
  } catch {
    throw badRequest('The file is not a valid image', 'INVALID_IMAGE');
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) throw badRequest('Only JPEG, PNG, WebP or HEIC images are allowed', 'UNSUPPORTED_FILE_TYPE');
  if ((meta.width ?? 0) < UPLOAD_LIMITS.minImageDimension || (meta.height ?? 0) < UPLOAD_LIMITS.minImageDimension) {
    throw badRequest(`Images must be at least ${UPLOAD_LIMITS.minImageDimension}px on each side`, 'IMAGE_TOO_SMALL');
  }
  if ((meta.width ?? 0) > UPLOAD_LIMITS.maxImageDimension || (meta.height ?? 0) > UPLOAD_LIMITS.maxImageDimension) {
    throw badRequest('Image dimensions are too large', 'IMAGE_TOO_LARGE');
  }
}

/**
 * Normalises an image for embedding: orientation fixed, metadata removed, square-padded to a fixed size,
 * JPEG encoded. The same function is used for catalogue images and query images so both sides of the
 * similarity comparison see identical preprocessing.
 */
export async function normalizeForEmbedding(input: Buffer, size = 512): Promise<Buffer> {
  try {
    return await sharp(input, { limitInputPixels: 80_000_000, failOn: 'error' })
      .rotate()
      .resize({ width: size, height: size, fit: 'cover', position: 'centre' })
      .removeAlpha()
      .toColourspace('srgb')
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    throw badRequest('The image could not be processed', 'INVALID_IMAGE');
  }
}
