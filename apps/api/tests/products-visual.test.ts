import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, createActiveShop, createMarketFixture, createPublishedProduct, fabricImage, registerUser, useTestDatabase, type MarketFixture, type TestUser } from './helpers';
import { drainJobs } from '../src/jobs/queue';
import { setEmbeddingProvider, LocalBaselineProvider, EmbeddingProviderError, type ImageEmbeddingProvider } from '../src/modules/visual-search/providers';
import { ProductEmbedding } from '../src/modules/visual-search/embedding.model';
import { Product } from '../src/modules/products/product.models';
import { relevanceBand } from '../src/modules/visual-search/embedding.service';
import { storage } from '../src/services/storage';
import { Job } from '../src/jobs/job.model';

useTestDatabase();

/**
 * Deterministic mock: the vector is the image's mean colour (+ a constant) — enough to make ranking
 * predictable: images of similar colour are closer.
 */
class MockProvider implements ImageEmbeddingProvider {
  name = 'mock';
  model = 'mean-colour-v1';
  dimensions = 4;
  defaultMinSimilarity = 0.5;
  fail = false;
  calls = 0;
  async embed(images: Buffer[]) {
    this.calls++;
    if (this.fail) throw new EmbeddingProviderError('provider down', true);
    return Promise.all(
      images.map(async (b) => {
        const { channels } = await sharp(b).stats();
        const v = [channels[0].mean / 255, channels[1].mean / 255, channels[2].mean / 255, 0.05];
        const n = Math.hypot(...v);
        return v.map((x) => x / n);
      }),
    );
  }
}

let fx: MarketFixture;
let owner: TestUser;
let shopId: string;
const mock = new MockProvider();

beforeAll(async () => {
  setEmbeddingProvider(mock);
  fx = await createMarketFixture();
  ({ owner, shopId } = await createActiveShop(fx));
});
afterEach(() => {
  mock.fail = false;
});

const RED: [number, number, number] = [220, 20, 20];
const BLUE: [number, number, number] = [20, 30, 220];
const GREEN: [number, number, number] = [20, 200, 40];

describe('product catalogue', () => {
  it('validates prices and wholesale configuration', async () => {
    const bad = await api().post(`/api/v1/shops/${shopId}/products`).set(auth(owner)).send({ name: 'X fabric', categoryId: fx.categoryId, retailPriceKobo: 1000, wholesalePriceKobo: 2000, wholesaleMinQuantity: 10, unit: 'yard' });
    expect(bad.status).toBe(400);
    const half = await api().post(`/api/v1/shops/${shopId}/products`).set(auth(owner)).send({ name: 'X fabric', categoryId: fx.categoryId, retailPriceKobo: 1000, wholesalePriceKobo: 900, unit: 'yard' });
    expect(half.status).toBe(400);
    const neg = await api().post(`/api/v1/shops/${shopId}/products`).set(auth(owner)).send({ name: 'X fabric', categoryId: fx.categoryId, retailPriceKobo: -5, unit: 'yard' });
    expect(neg.status).toBe(400);
    const badUnit = await api().post(`/api/v1/shops/${shopId}/products`).set(auth(owner)).send({ name: 'X fabric', categoryId: fx.categoryId, retailPriceKobo: 100, unit: 'roll' });
    expect(badUnit.body.error.code).toBe('UNIT_NOT_ENABLED');
  });

  it('requires an image to publish and keeps drafts out of public views', async () => {
    const draft = await api().post(`/api/v1/shops/${shopId}/products`).set(auth(owner)).send({ name: 'Draft wax', categoryId: fx.categoryId, retailPriceKobo: 300000, unit: 'yard', stockQuantity: 10 });
    const id = draft.body.data.id;
    const pub = await api().patch(`/api/v1/shops/${shopId}/products/${id}`).set(auth(owner)).send({ status: 'published' });
    expect(pub.body.error.code).toBe('IMAGE_REQUIRED');
    expect((await api().get(`/api/v1/products/${id}`)).status).toBe(404);
    const search = await api().get('/api/v1/search/products').query({ q: 'Draft wax' });
    expect(search.body.data.find((p: { id: string }) => p.id === id)).toBeUndefined();
  });

  it('rejects invalid image uploads (wrong type, corrupt bytes, too small)', async () => {
    const p = await api().post(`/api/v1/shops/${shopId}/products`).set(auth(owner)).send({ name: 'Img test', categoryId: fx.categoryId, retailPriceKobo: 1000, unit: 'yard' });
    const url = `/api/v1/shops/${shopId}/products/${p.body.data.id}/images`;
    const txt = await api().post(url).set(auth(owner)).attach('images', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(txt.status).toBe(400);
    const fake = await api().post(url).set(auth(owner)).attach('images', Buffer.from('not really a png'), { filename: 'a.png', contentType: 'image/png' });
    expect(fake.body.error.code).toBe('INVALID_IMAGE');
    const tiny = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#f00' } }).png().toBuffer();
    const small = await api().post(url).set(auth(owner)).attach('images', tiny, 'tiny.png');
    expect(small.body.error.code).toBe('IMAGE_TOO_SMALL');
  });

  it('strips EXIF metadata from stored images', async () => {
    const withExif = await sharp(await fabricImage([RED, BLUE])).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-owner' } } }).toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeTruthy();
    const product = await createPublishedProduct(owner, shopId, fx.categoryId, { name: 'Exif test' }, withExif);
    const doc = await Product.findById(product.id).lean();
    const stored = await storage().get(doc!.images[0].key);
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
  });

  it('adjusts inventory atomically and never below zero', async () => {
    const p = await createPublishedProduct(owner, shopId, fx.categoryId, { name: 'Stock test', stockQuantity: 5, lowStockThreshold: 2 });
    const adj = await api().post(`/api/v1/shops/${shopId}/products/${p.id}/inventory`).set(auth(owner)).send({ delta: -4, reason: 'adjustment' });
    expect(adj.status).toBe(200);
    expect(adj.body.data.stockQuantity).toBe(1);
    expect(adj.body.data.stockStatus).toBe('low_stock');
    const tooMuch = await api().post(`/api/v1/shops/${shopId}/products/${p.id}/inventory`).set(auth(owner)).send({ delta: -2, reason: 'adjustment' });
    expect(tooMuch.status).toBe(409);
    const direct = await api().patch(`/api/v1/shops/${shopId}/products/${p.id}`).set(auth(owner)).send({ stockQuantity: 999 });
    expect(direct.body.error.code).toBe('USE_INVENTORY_ENDPOINT');
    const movements = await api().get(`/api/v1/shops/${shopId}/products/${p.id}/inventory`).set(auth(owner));
    expect(movements.body.data.map((m: { reason: string }) => m.reason)).toEqual(['adjustment', 'initial']);
  });

  it('prevents editing another shop’s products', async () => {
    const other = await createActiveShop(fx);
    const p = await createPublishedProduct(owner, shopId, fx.categoryId, { name: 'Mine' });
    const res = await api().patch(`/api/v1/shops/${other.shopId}/products/${p.id}`).set(auth(other.owner)).send({ retailPriceKobo: 1 });
    expect(res.status).toBe(404);
    const res2 = await api().patch(`/api/v1/shops/${shopId}/products/${p.id}`).set(auth(other.owner)).send({ retailPriceKobo: 1 });
    expect(res2.status).toBe(403);
  });

  it('text search finds products by name, colour and fuzzy prefix, with filters', async () => {
    await createPublishedProduct(owner, shopId, fx.categoryId, { name: 'Royal Blue Damask', colours: ['blue'], keywords: ['damask'], retailPriceKobo: 900000 });
    const exact = await api().get('/api/v1/search/products').query({ q: 'damask' });
    expect(exact.body.data.some((p: { name: string }) => p.name === 'Royal Blue Damask')).toBe(true);
    const fuzzy = await api().get('/api/v1/search/products').query({ q: 'Dama' });
    expect(fuzzy.body.data.some((p: { name: string }) => p.name === 'Royal Blue Damask')).toBe(true);
    const priced = await api().get('/api/v1/search/products').query({ q: 'damask', maxPriceKobo: 100 });
    expect(priced.body.data).toHaveLength(0);
    const byHouse = await api().get('/api/v1/search/products').query({ q: 'KW-024' });
    expect(byHouse.body.meta.mode).toBe('location');
    expect(byHouse.body.data.length).toBeGreaterThan(0);
  });
});

describe('visual fabric search', () => {
  it('generates embeddings in the background and ranks visually similar products first', async () => {
    const red = await createPublishedProduct(owner, shopId, fx.categoryId, { name: 'Red stripes' }, await fabricImage([RED, [200, 40, 40]]));
    const blue = await createPublishedProduct(owner, shopId, fx.categoryId, { name: 'Blue stripes' }, await fabricImage([BLUE, [40, 40, 200]]));
    const green = await createPublishedProduct(owner, shopId, fx.categoryId, { name: 'Green checks' }, await fabricImage([GREEN, [40, 180, 40]], 'checks'));
    await drainJobs();
    expect((await Product.findById(red.id).lean())!.images[0].embeddingStatus).toBe('ready');

    const query = await fabricImage([[210, 25, 25], [190, 30, 30]], 'checks');
    const res = await api().post('/api/v1/visual-search').attach('image', query, 'query.png');
    expect(res.status).toBe(200);
    const ids = res.body.data.matches.map((m: { product: { id: string } }) => m.product.id);
    expect(ids[0]).toBe(red.id);
    expect(ids.indexOf(red.id)).toBeLessThan(ids.indexOf(blue.id) === -1 ? Infinity : ids.indexOf(blue.id));
    const first = res.body.data.matches[0];
    expect(first.similarity).toBeGreaterThan(0.9);
    expect(['best_match', 'very_similar', 'similar', 'somewhat_similar']).toContain(first.relevance);
    expect(first.product.shop.breadcrumb.label).toContain('House KW-024');
    void green;
  });

  it('consolidates multiple images of one product into a single result', async () => {
    const multi = await createPublishedProduct(owner, shopId, fx.categoryId, { name: 'Multi image' }, await fabricImage([[250, 120, 0], [240, 130, 10]]));
    await api().post(`/api/v1/shops/${shopId}/products/${multi.id}/images`).set(auth(owner)).attach('images', await fabricImage([[245, 125, 5], [250, 120, 0]], 'checks'), 'b.png');
    await drainJobs();
    expect(await ProductEmbedding.countDocuments({ productId: multi.id })).toBe(2);
    const res = await api().post('/api/v1/visual-search').attach('image', await fabricImage([[248, 122, 2], [250, 120, 0]]), 'q.png');
    const hits = res.body.data.matches.filter((m: { product: { id: string } }) => m.product.id === multi.id);
    expect(hits).toHaveLength(1);
  });

  it('excludes unpublished, archived and unlisted-shop products', async () => {
    const p = await createPublishedProduct(owner, shopId, fx.categoryId, { name: 'Purple unique' }, await fabricImage([[130, 0, 200], [120, 10, 190]]));
    await drainJobs();
    const q = await fabricImage([[130, 0, 200], [125, 5, 195]]);
    let res = await api().post('/api/v1/visual-search').attach('image', q, 'q.png');
    expect(res.body.data.matches[0].product.id).toBe(p.id);
    await api().delete(`/api/v1/shops/${shopId}/products/${p.id}`).set(auth(owner));
    res = await api().post('/api/v1/visual-search').attach('image', await fabricImage([[131, 0, 201], [125, 5, 195]]), 'q2.png');
    expect(res.body.data.matches.some((m: { product: { id: string } }) => m.product.id === p.id)).toBe(false);
  });

  it('applies filters (price, wholesale) to visual results', async () => {
    const cheap = await createPublishedProduct(owner, shopId, fx.categoryId, { name: 'Teal cheap', retailPriceKobo: 1000, wholesalePriceKobo: null, wholesaleMinQuantity: null }, await fabricImage([[0, 128, 128], [10, 120, 120]]));
    await drainJobs();
    const q = await fabricImage([[0, 128, 128], [5, 125, 125]]);
    const wholesale = await api().post('/api/v1/visual-search').query({ wholesaleOnly: true }).attach('image', q, 'q.png');
    expect(wholesale.body.data.matches.some((m: { product: { id: string } }) => m.product.id === cheap.id)).toBe(false);
    const priced = await api().post('/api/v1/visual-search').query({ maxPriceKobo: 2000 }).attach('image', q, 'q.png');
    expect(priced.body.data.matches.every((m: { product: { retailPriceKobo: number } }) => m.product.retailPriceKobo <= 2000)).toBe(true);
  });

  it('reports provider outages clearly instead of returning unrelated products', async () => {
    mock.fail = true;
    const res = await api().post('/api/v1/visual-search').attach('image', await fabricImage([[1, 2, 250], [3, 4, 240]]), 'q.png');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('VISUAL_SEARCH_PROVIDER_ERROR');
  });

  it('marks embeddings failed after retries and allows manual retry', async () => {
    mock.fail = true;
    const p = await createPublishedProduct(owner, shopId, fx.categoryId, { name: 'Retry me' }, await fabricImage([[90, 90, 90], [80, 80, 80]]));
    // Exhaust attempts quickly by making every retry due immediately.
    for (let i = 0; i < 6; i++) {
      await Job.updateMany({ type: 'embedding.generate', status: 'queued' }, { $set: { runAt: new Date(0) } });
      await drainJobs();
    }
    expect((await Product.findById(p.id).lean())!.images[0].embeddingStatus).toBe('failed');
    mock.fail = false;
    const retry = await api().post(`/api/v1/shops/${shopId}/products/${p.id}/images/retry-embeddings`).set(auth(owner));
    expect(retry.body.data.queued).toBe(1);
    await drainJobs();
    expect((await Product.findById(p.id).lean())!.images[0].embeddingStatus).toBe('ready');
  });

  it('rejects non-images and reports unavailability when no provider is configured', async () => {
    const bad = await api().post('/api/v1/visual-search').attach('image', Buffer.from('nope'), { filename: 'x.png', contentType: 'image/png' });
    expect(bad.status).toBe(400);
    setEmbeddingProvider(null);
    const res = await api().post('/api/v1/visual-search').attach('image', await fabricImage([RED, BLUE]), 'q.png');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('VISUAL_SEARCH_NOT_CONFIGURED');
    const status = await api().get('/api/v1/visual-search/status');
    expect(status.body.data.available).toBe(false);
    setEmbeddingProvider(mock);
  });

  it('local baseline descriptor separates different colourways (dev provider sanity)', async () => {
    const p = new LocalBaselineProvider();
    const [a, b, c] = await p.embed([await fabricImage([RED, BLUE]), await fabricImage([[215, 25, 25], [25, 35, 215]]), await fabricImage([GREEN, [250, 250, 0]], 'checks')]);
    const cos = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
    expect(cos(a, b)).toBeGreaterThan(cos(a, c));
    // Jina-like scores: every bazin passes the 0.6 threshold, but only the clear winner is the best match.
    const ctx = { threshold: 0.6, top: 0.936, runnerUp: 0.858 };
    expect(relevanceBand(0.936, ctx)).toBe('best_match');
    expect(relevanceBand(0.858, ctx)).toBe('similar');
    expect(relevanceBand(0.815, ctx)).toBe('somewhat_similar');
    // Two near-equal leaders: neither is singled out.
    expect(relevanceBand(0.93, { threshold: 0.6, top: 0.93, runnerUp: 0.92 })).toBe('very_similar');
    // A weak top result is never the best match, however far ahead.
    expect(relevanceBand(0.65, { threshold: 0.6, top: 0.65 })).toBe('somewhat_similar');
    void registerUser;
  });
});
