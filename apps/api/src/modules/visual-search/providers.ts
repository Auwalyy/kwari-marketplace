import sharp from 'sharp';
import { env } from '../../config/env';
import { serviceUnavailable } from '../../utils/http';

/**
 * Provider-independent image embedding interface. Catalogue images and query images must be embedded by
 * the same provider + model with the same preprocessing (see embedding.service.ts).
 */
export interface ImageEmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  /** Similarity below which results are not shown at all. */
  readonly defaultMinSimilarity: number;
  /** True for providers that must never be used in production. */
  readonly developmentOnly?: boolean;
  embed(images: Buffer[]): Promise<number[][]>;
}

export class EmbeddingProviderError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.IMAGE_EMBEDDING_TIMEOUT_MS),
    });
  } catch (err) {
    throw new EmbeddingProviderError(`Embedding provider unreachable: ${(err as Error).message}`, true);
  }
  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new EmbeddingProviderError(`Embedding provider HTTP ${res.status}`, retryable);
  }
  return res.json();
}

function l2normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

/** Jina CLIP v2 — multimodal CLIP embeddings via https://api.jina.ai/v1/embeddings. */
class JinaClipProvider implements ImageEmbeddingProvider {
  readonly name = 'jina';
  readonly model = env.IMAGE_EMBEDDING_MODEL ?? 'jina-clip-v2';
  readonly dimensions = env.IMAGE_EMBEDDING_DIMENSIONS ?? 1024;
  readonly defaultMinSimilarity = 0.6;
  async embed(images: Buffer[]) {
    const json = (await postJson(
      'https://api.jina.ai/v1/embeddings',
      { model: this.model, dimensions: this.dimensions, normalized: true, input: images.map((b) => ({ image: b.toString('base64') })) },
      { authorization: `Bearer ${env.IMAGE_EMBEDDING_API_KEY}` },
    )) as { data?: { embedding: number[]; index: number }[] };
    const data = json.data ?? [];
    if (data.length !== images.length) throw new EmbeddingProviderError('Unexpected embedding response', true);
    return data.sort((a, b) => a.index - b.index).map((d) => l2normalize(d.embedding));
  }
}

/** Cohere Embed v4 — image embeddings via https://api.cohere.com/v2/embed. */
class CohereProvider implements ImageEmbeddingProvider {
  readonly name = 'cohere';
  readonly model = env.IMAGE_EMBEDDING_MODEL ?? 'embed-v4.0';
  readonly dimensions = env.IMAGE_EMBEDDING_DIMENSIONS ?? 1024;
  readonly defaultMinSimilarity = 0.5;
  async embed(images: Buffer[]) {
    const out: number[][] = [];
    // Cohere accepts one image per request for image input.
    for (const img of images) {
      const json = (await postJson(
        'https://api.cohere.com/v2/embed',
        {
          model: this.model,
          input_type: 'image',
          embedding_types: ['float'],
          output_dimension: this.dimensions,
          images: [`data:image/jpeg;base64,${img.toString('base64')}`],
        },
        { authorization: `Bearer ${env.IMAGE_EMBEDDING_API_KEY}` },
      )) as { embeddings?: { float?: number[][] } };
      const v = json.embeddings?.float?.[0];
      if (!v) throw new EmbeddingProviderError('Unexpected embedding response', true);
      out.push(l2normalize(v));
    }
    return out;
  }
}

/**
 * DEVELOPMENT-ONLY baseline. A genuine but simple hand-crafted visual descriptor (colour histogram in HSV,
 * spatial colour layout and gradient-orientation texture histogram). It captures colour combinations,
 * stripes/checks and overall layout well enough to exercise the full pipeline locally, but it is not a
 * learned model and must not be used in production (enforced in config).
 */
export class LocalBaselineProvider implements ImageEmbeddingProvider {
  readonly name = 'local-baseline';
  readonly model = 'hsv-layout-texture-v1';
  readonly dimensions = 108 + 48 + 32;
  readonly defaultMinSimilarity = 0.8;
  readonly developmentOnly = true;

  async embed(images: Buffer[]) {
    return Promise.all(images.map((img) => this.describe(img)));
  }

  private async describe(img: Buffer): Promise<number[]> {
    const size = 64;
    const { data } = await sharp(img).resize(size, size, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const hist = new Array(108).fill(0); // 12 hue × 3 sat × 3 val
    const layout = new Array(48).fill(0); // 4×4 grid × RGB
    const gray = new Float64Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const r = data[i * 3] / 255;
      const g = data[i * 3 + 1] / 255;
      const b = data[i * 3 + 2] / 255;
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      let h = 0;
      if (d > 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
      }
      const s = max === 0 ? 0 : d / max;
      const hb = Math.min(11, Math.floor(h / 30));
      const sb = Math.min(2, Math.floor(s * 3));
      const vb = Math.min(2, Math.floor(max * 3));
      hist[hb * 9 + sb * 3 + vb] += 1;
      const x = i % size;
      const y = Math.floor(i / size);
      const cell = Math.floor(y / 16) * 4 + Math.floor(x / 16);
      layout[cell * 3] += r;
      layout[cell * 3 + 1] += g;
      layout[cell * 3 + 2] += b;
    }
    // Texture: magnitude-weighted gradient orientation histograms at two scales (16 bins each).
    const texture = new Array(32).fill(0);
    for (const [scale, offset] of [
      [1, 0],
      [2, 16],
    ] as const) {
      for (let y = scale; y < size - scale; y++) {
        for (let x = scale; x < size - scale; x++) {
          const gx = gray[y * size + x + scale] - gray[y * size + x - scale];
          const gy = gray[(y + scale) * size + x] - gray[(y - scale) * size + x];
          const mag = Math.hypot(gx, gy);
          if (mag < 0.02) continue;
          const angle = (Math.atan2(gy, gx) + Math.PI) % Math.PI; // orientation, not direction
          texture[offset + Math.min(15, Math.floor((angle / Math.PI) * 16))] += mag;
        }
      }
    }
    const block = (v: number[], weight: number) => l2normalize(v.map(Math.sqrt)).map((x) => x * weight);
    return l2normalize([...block(hist, 1), ...block(layout, 0.8), ...block(texture, 0.9)]);
  }
}

let provider: ImageEmbeddingProvider | null | undefined;

/** Returns the configured provider, or null when visual search is not configured. */
export function embeddingProvider(): ImageEmbeddingProvider | null {
  if (provider !== undefined) return provider;
  switch (env.IMAGE_EMBEDDING_PROVIDER) {
    case 'jina':
      provider = env.IMAGE_EMBEDDING_API_KEY ? new JinaClipProvider() : null;
      break;
    case 'cohere':
      provider = env.IMAGE_EMBEDDING_API_KEY ? new CohereProvider() : null;
      break;
    case 'local-baseline':
      provider = env.NODE_ENV === 'production' ? null : new LocalBaselineProvider();
      break;
    default:
      provider = null;
  }
  return provider;
}

/** Test hook: inject a mocked provider (or null). */
export function setEmbeddingProvider(p: ImageEmbeddingProvider | null | undefined) {
  provider = p;
}

export function requireEmbeddingProvider(): ImageEmbeddingProvider {
  const p = embeddingProvider();
  if (!p) {
    throw serviceUnavailable(
      'Visual fabric search is not available right now. Try text search or browse categories.',
      'VISUAL_SEARCH_NOT_CONFIGURED',
    );
  }
  return p;
}
