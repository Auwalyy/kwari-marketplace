import crypto from 'node:crypto';
import mongoose from 'mongoose';
import sharp from 'sharp';
import supertest from 'supertest';
import { afterAll, beforeAll, inject } from 'vitest';
import { createApp } from '../src/app';
import { User } from '../src/modules/users/user.model';
import { resetTransactionDetection } from '../src/config/db';
import { clearLocationCache } from '../src/services/locations';
import { testOutbox } from '../src/services/verificationSender';

export const app = createApp();
export const api = () => supertest(app);

/** Connects this test file to its own database on the shared in-memory replica set. */
export function useTestDatabase() {
  beforeAll(async () => {
    const uri = inject('mongoUri');
    await mongoose.connect(uri, { dbName: `kkdm_test_${crypto.randomBytes(4).toString('hex')}` });
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    resetTransactionDetection();
  });
  afterAll(async () => {
    clearLocationCache();
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  });
}

export interface TestUser {
  id: string;
  token: string;
  refreshToken: string;
  email: string;
  password: string;
}

let counter = 0;
export async function registerUser(name = 'Test User', opts: { phone?: string } = {}): Promise<TestUser> {
  counter++;
  const email = `user${counter}-${crypto.randomBytes(3).toString('hex')}@example.com`;
  const password = 'Passw0rd!x';
  const res = await api()
    .post('/api/v1/auth/register')
    .send({ fullName: name, email, password, ...(opts.phone ? { phone: opts.phone } : {}) });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.data.user.id, token: res.body.data.tokens.accessToken, refreshToken: res.body.data.tokens.refreshToken, email, password };
}

export async function makeAdmin(user: TestUser) {
  await User.updateOne({ _id: user.id }, { $set: { platformRoles: ['admin'] } });
}

export const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

export function lastCode(to: string, purpose?: string) {
  const found = [...testOutbox].reverse().find((c) => c.to === to && (!purpose || c.purpose === purpose));
  return found?.code;
}

/** Generates a synthetic fabric-like image: stripes or checks in the given colours. */
export async function fabricImage(colours: [number, number, number][], pattern: 'stripes' | 'checks' | 'dots' = 'stripes', size = 256): Promise<Buffer> {
  const raw = Buffer.alloc(size * size * 3);
  const band = Math.max(8, Math.floor(size / 16));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let idx: number;
      if (pattern === 'stripes') idx = Math.floor(x / band) % colours.length;
      else if (pattern === 'checks') idx = (Math.floor(x / band) + Math.floor(y / band)) % colours.length;
      else {
        const cx = (x % (band * 2)) - band;
        const cy = (y % (band * 2)) - band;
        idx = cx * cx + cy * cy < (band * band) / 2 ? 1 % colours.length : 0;
      }
      const c = colours[idx];
      const o = (y * size + x) * 3;
      raw[o] = c[0];
      raw[o + 1] = c[1];
      raw[o + 2] = c[2];
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

export interface MarketFixture {
  admin: TestUser;
  marketId: string;
  sectionId: string;
  houseId: string;
  directHouseId: string;
  categoryId: string;
  head: TestUser;
}

/** Creates a market with a section, a house in it, a house directly under the market and a verified head. */
export async function createMarketFixture(): Promise<MarketFixture> {
  const admin = await registerUser('Admin');
  await makeAdmin(admin);
  const slug = `kantin-kwari-${crypto.randomBytes(3).toString('hex')}`;
  const market = await api().post('/api/v1/markets').set(auth(admin)).send({ name: 'Kantin Kwari', slug, region: 'Kano', city: 'Kano', country: 'NG', usesSections: true });
  if (market.status !== 201) throw new Error(JSON.stringify(market.body));
  const marketId = market.body.data.id;
  const section = await api().post(`/api/v1/markets/${marketId}/sections`).set(auth(admin)).send({ name: 'Section B', code: 'B' });
  const sectionId = section.body.data.id;
  const house = await api().post('/api/v1/houses').set(auth(admin)).send({ marketId, sectionId, houseNumber: 'KW-024', name: 'Alhaji Musa House', addressDescription: 'Behind the main gate' });
  const houseId = house.body.data.id;
  const direct = await api().post('/api/v1/houses').set(auth(admin)).send({ marketId, houseNumber: 'KW-100', name: 'Direct House', addressDescription: 'North row' });
  const directHouseId = direct.body.data.id;
  const category = await api().post('/api/v1/categories').set(auth(admin)).send({ name: 'Ankara', slug: `ankara-${crypto.randomBytes(2).toString('hex')}` });
  const head = await registerUser('House Head');
  const assign = await api().post(`/api/v1/houses/${houseId}/head`).set(auth(admin)).send({ userId: head.id, markVerified: true });
  if (assign.status !== 200) throw new Error(JSON.stringify(assign.body));
  return { admin, marketId, sectionId, houseId, directHouseId, categoryId: category.body.data.id, head };
}

export async function createHouseInvitation(head: TestUser, houseId: string, body: Record<string, unknown> = {}) {
  const res = await api().post(`/api/v1/houses/${houseId}/invitations`).set(auth(head)).send(body);
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.data as { id: string; code: string };
}

/** Registers a shop via invitation and has the house head approve it. */
export async function createActiveShop(fx: MarketFixture, owner?: TestUser, shopNumber = `S${crypto.randomBytes(2).toString('hex').toUpperCase()}`) {
  owner ??= await registerUser('Shop Owner');
  const inv = await createHouseInvitation(fx.head, fx.houseId);
  const reg = await api().post('/api/v1/shops/register').set(auth(owner)).send({ invitationCode: inv.code, name: `Shop ${shopNumber}`, shopNumber, categoryIds: [fx.categoryId] });
  if (reg.status !== 201) throw new Error(JSON.stringify(reg.body));
  const shopId = reg.body.data.shop.id;
  const membershipId = reg.body.data.membership.id;
  const dec = await api().post(`/api/v1/houses/${fx.houseId}/memberships/${membershipId}/decision`).set(auth(fx.head)).send({ decision: 'approve' });
  if (dec.status !== 200) throw new Error(JSON.stringify(dec.body));
  await api()
    .put(`/api/v1/shops/${shopId}/fulfilment`)
    .set(auth(owner))
    .send({
      pickupAvailable: true,
      deliveryAvailable: true,
      deliveryOptions: [
        { name: 'Kano city', feeKobo: 150000, areas: ['Kano'] },
        { name: 'Outside Kano', feeKobo: null },
      ],
      acceptedPaymentMethods: ['cash_on_pickup', 'bank_transfer', 'online'],
    });
  return { owner, shopId };
}

export async function createPublishedProduct(owner: TestUser, shopId: string, categoryId: string, overrides: Record<string, unknown> = {}, image?: Buffer) {
  // Only apply the default wholesale tier when the test keeps the default retail price.
  if ('retailPriceKobo' in overrides && !('wholesalePriceKobo' in overrides)) Object.assign(overrides, { wholesalePriceKobo: null, wholesaleMinQuantity: null });
  const res = await api()
    .post(`/api/v1/shops/${shopId}/products`)
    .set(auth(owner))
    .send({ name: 'Holland Wax Print', categoryId, retailPriceKobo: 500000, wholesalePriceKobo: 400000, wholesaleMinQuantity: 20, unit: 'yard', stockQuantity: 100, ...overrides });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  const productId = res.body.data.id;
  const img = image ?? (await fabricImage([[200, 30, 30], [250, 200, 0]]));
  const up = await api().post(`/api/v1/shops/${shopId}/products/${productId}/images`).set(auth(owner)).attach('images', img, 'fabric.png');
  if (up.status !== 201) throw new Error(JSON.stringify(up.body));
  const pub = await api().patch(`/api/v1/shops/${shopId}/products/${productId}`).set(auth(owner)).send({ status: 'published' });
  if (pub.status !== 200) throw new Error(JSON.stringify(pub.body));
  return pub.body.data as { id: string; images: { id: string }[] };
}
