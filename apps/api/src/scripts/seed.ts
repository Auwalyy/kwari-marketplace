/**
 * DEVELOPMENT-ONLY seed data. Every demo account and product is labelled "[DEMO]".
 * Refuses to run when NODE_ENV=production. Run: npm run seed  (add --reset to wipe the database first)
 */
import mongoose, { Types } from 'mongoose';
import sharp from 'sharp';
import { SHOP_PERMISSIONS, type MeasurementUnit } from '@kkdm/shared';
import { connectDatabase, disconnectDatabase } from '../config/db';
import { env } from '../config/env';
import { logger } from '../config/logger';
import '../app';
import { User } from '../modules/users/user.model';
import { hashPassword } from '../modules/auth/password';
import { House, HouseMembership, HouseStaff, Market, MarketSection } from '../modules/markets/market.models';
import { Shop, ShopMembership } from '../modules/shops/shop.models';
import { Category, InventoryMovement, Product } from '../modules/products/product.models';
import { processUploadedImage } from '../services/images';
import { storage, storageKey } from '../services/storage';
import { queueImageEmbedding } from '../modules/visual-search/embedding.service';
import { drainJobs } from '../jobs/queue';
import { slugify } from '../utils/http';
import { recountHouseShops } from '../modules/houses/house.service';
import { recountShopProducts } from '../modules/shops/shop.service';

const DEMO_PASSWORD = 'DemoPass123';
type RGB = [number, number, number];

async function patternImage(colours: RGB[], pattern: 'stripes' | 'checks' | 'dots' | 'waves' | 'diamonds', size = 512): Promise<Buffer> {
  const raw = Buffer.alloc(size * size * 3);
  const band = size / 12;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let idx = 0;
      switch (pattern) {
        case 'stripes':
          idx = Math.floor(x / band) % colours.length;
          break;
        case 'checks':
          idx = (Math.floor(x / band) + Math.floor(y / band)) % colours.length;
          break;
        case 'dots': {
          const cx = (x % (band * 2)) - band;
          const cy = (y % (band * 2)) - band;
          idx = cx * cx + cy * cy < band * band * 0.45 ? 1 + (Math.floor(x / (band * 2)) % (colours.length - 1)) : 0;
          break;
        }
        case 'waves':
          idx = Math.floor((y + Math.sin(x / (band / 1.5)) * band) / band) % colours.length;
          if (idx < 0) idx += colours.length;
          break;
        case 'diamonds':
          idx = Math.floor((Math.abs((x % (band * 2)) - band) + Math.abs((y % (band * 2)) - band)) / (band / 2)) % colours.length;
          break;
      }
      const c = colours[idx];
      const noise = (Math.random() - 0.5) * 18; // fabric-like texture
      const o = (y * size + x) * 3;
      raw[o] = Math.max(0, Math.min(255, c[0] + noise));
      raw[o + 1] = Math.max(0, Math.min(255, c[1] + noise));
      raw[o + 2] = Math.max(0, Math.min(255, c[2] + noise));
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
}

async function user(fullName: string, email: string, extra: Record<string, unknown> = {}) {
  const existing = await User.findOne({ email });
  if (existing) return existing;
  return User.create({ fullName: `[DEMO] ${fullName}`, email, emailVerified: true, passwordHash: await hashPassword(DEMO_PASSWORD), ...extra });
}

const C = {
  red: [196, 30, 45] as RGB,
  gold: [230, 180, 40] as RGB,
  royal: [30, 60, 170] as RGB,
  white: [245, 245, 240] as RGB,
  black: [25, 25, 25] as RGB,
  green: [20, 120, 60] as RGB,
  orange: [240, 120, 30] as RGB,
  purple: [110, 40, 140] as RGB,
  teal: [20, 140, 140] as RGB,
  cream: [240, 228, 200] as RGB,
  wine: [110, 20, 40] as RGB,
  sky: [120, 180, 230] as RGB,
};

interface ProductSeed {
  name: string;
  category: string;
  retail: number;
  wholesale?: [number, number];
  unit: MeasurementUnit;
  stock: number;
  colours: string[];
  palette: RGB[];
  pattern: 'stripes' | 'checks' | 'dots' | 'waves' | 'diamonds';
  material?: string;
  brand?: string;
  keywords?: string[];
  variants?: { label: string; colour: string; stock: number }[];
}

const CATALOGUE: Record<string, ProductSeed[]> = {
  'Alhaji Sani Textiles': [
    { name: 'Holland Wax Print — Red & Gold', category: 'ankara-wax', retail: 4500, wholesale: [3800, 20], unit: 'yard', stock: 180, colours: ['red', 'gold'], palette: [C.red, C.gold, C.cream], pattern: 'waves', material: 'Cotton', brand: 'Vlisco (resale)', keywords: ['holland', 'wax', 'ankara'] },
    { name: 'Super Wax — Royal Blue Circles', category: 'ankara-wax', retail: 3800, wholesale: [3200, 24], unit: 'yard', stock: 240, colours: ['blue', 'white'], palette: [C.royal, C.white], pattern: 'dots', material: 'Cotton', keywords: ['super wax', 'ankara'] },
    { name: 'Hitarget Ankara — Green Diamonds', category: 'ankara-wax', retail: 2500, wholesale: [2100, 30], unit: 'yard', stock: 300, colours: ['green', 'gold'], palette: [C.green, C.gold, C.black], pattern: 'diamonds', material: 'Cotton', keywords: ['hitarget', 'ankara'] },
    { name: 'Ankara Bundle (6 yards) — Orange Waves', category: 'ankara-wax', retail: 14000, unit: 'bundle', stock: 40, colours: ['orange', 'purple'], palette: [C.orange, C.purple, C.cream], pattern: 'waves', keywords: ['bundle', '6 yards'] },
  ],
  'Baba Lace House': [
    { name: 'Swiss Voile Lace — Wine', category: 'lace', retail: 12000, wholesale: [10500, 10], unit: 'yard', stock: 60, colours: ['wine'], palette: [C.wine, C.cream], pattern: 'dots', material: 'Cotton voile', keywords: ['swiss', 'voile', 'lace'], variants: [{ label: 'Wine', colour: 'wine', stock: 35 }, { label: 'Wine & cream', colour: 'cream', stock: 25 }] },
    { name: 'Cord Lace — Gold', category: 'lace', retail: 18000, wholesale: [16000, 10], unit: 'yard', stock: 45, colours: ['gold'], palette: [C.gold, C.cream], pattern: 'diamonds', material: 'Polyester cord', keywords: ['cord lace', 'asoebi'] },
    { name: 'French Lace — Sky Blue', category: 'lace', retail: 9500, unit: 'yard', stock: 3, colours: ['blue'], palette: [C.sky, C.white], pattern: 'dots', keywords: ['french lace'] },
  ],
  'Kwari Brocade Hub': [
    { name: 'Getzner Guinea Brocade — Cream', category: 'guinea-brocade', retail: 65000, wholesale: [60000, 5], unit: 'piece', stock: 25, colours: ['cream'], palette: [C.cream, C.white], pattern: 'diamonds', material: 'Cotton damask', brand: 'Getzner (resale)', keywords: ['getzner', 'brocade', 'shadda'] },
    { name: 'Atiku Material — Black', category: 'atiku', retail: 28000, wholesale: [25000, 10], unit: 'piece', stock: 50, colours: ['black'], palette: [C.black, [45, 45, 45]], pattern: 'stripes', keywords: ['atiku', 'senator'] },
    { name: 'Shadda Damask — Teal Stripes', category: 'guinea-brocade', retail: 3200, unit: 'yard', stock: 120, colours: ['teal'], palette: [C.teal, C.white], pattern: 'stripes', keywords: ['shadda', 'damask'] },
  ],
  'Hajiya Rolls & Plains': [
    { name: 'Plain Chiffon Roll — Purple', category: 'plain', retail: 95000, unit: 'roll', stock: 12, colours: ['purple'], palette: [C.purple, [120, 50, 150]], pattern: 'stripes', keywords: ['chiffon', 'roll'] },
    { name: 'Check Shirting — Red & Black', category: 'plain', retail: 1800, wholesale: [1500, 50], unit: 'metre', stock: 500, colours: ['red', 'black'], palette: [C.red, C.black], pattern: 'checks', keywords: ['check', 'shirting'] },
    { name: 'Aso Oke Set — Gold & Wine', category: 'aso-oke', retail: 75000, unit: 'set', stock: 8, colours: ['gold', 'wine'], palette: [C.gold, C.wine], pattern: 'stripes', keywords: ['aso oke', 'gele', 'ipele'] },
  ],
};

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  await connectDatabase();
  if (process.argv.includes('--reset')) {
    await mongoose.connection.dropDatabase();
    for (const m of Object.values(mongoose.models)) await m.syncIndexes();
    logger.warn('Database reset');
  }

  const admin = await user('Platform Admin', 'admin@demo.kantinkwari.test', { platformRoles: ['admin'] });
  const market =
    (await Market.findOne({ slug: 'kantin-kwari' })) ??
    (await Market.create({ name: 'Kantin Kwari', slug: 'kantin-kwari', description: '[DEMO] Kantin Kwari textile market, Kano — one of the largest textile markets in West Africa.', region: 'Kano', city: 'Kano', country: 'NG', usesSections: true, location: { lat: 12.0033, lng: 8.5167 }, createdBy: admin._id }));
  await user('Section Manager', 'manager@demo.kantinkwari.test', { platformRoles: ['market_manager'], managedMarketIds: [market._id] });

  const sections: Record<string, Types.ObjectId> = {};
  for (const [code, name] of [['A', 'Section A — Main Gate'], ['B', 'Section B — Lace Row'], ['C', 'Section C — Brocade Lane']]) {
    const s = (await MarketSection.findOne({ marketId: market._id, code })) ?? (await MarketSection.create({ marketId: market._id, code, name, locationDescription: `[DEMO] ${name}` }));
    sections[code] = s._id;
  }

  const categories: Record<string, Types.ObjectId> = {};
  const catDefs = [
    ['ankara-wax', 'Ankara & Wax Prints', 'shirt'],
    ['lace', 'Lace', 'sparkles'],
    ['guinea-brocade', 'Guinea Brocade & Shadda', 'gem'],
    ['atiku', 'Atiku & Senator', 'briefcase'],
    ['aso-oke', 'Aso Oke', 'crown'],
    ['plain', 'Plain & Shirting', 'layers'],
    ['accessories', 'Gele, Caps & Accessories', 'tag'],
  ];
  for (const [i, [slug, name, iconName]] of catDefs.entries()) {
    const c = (await Category.findOne({ slug })) ?? (await Category.create({ slug, name, iconName, sortOrder: i }));
    categories[slug] = c._id;
  }

  const head1 = await user('Alhaji Musa (House Head)', 'head1@demo.kantinkwari.test');
  const head2 = await user('Hajiya Binta (House Head)', 'head2@demo.kantinkwari.test');
  const houseDefs = [
    { houseNumber: 'KW-024', name: '[DEMO] Musa House', section: 'B', head: head1 },
    { houseNumber: 'KW-031', name: '[DEMO] Binta Plaza', section: 'C', head: head2 },
    { houseNumber: 'KW-002', name: '[DEMO] Gate House', section: 'A', head: null },
  ];
  const houses: Record<string, any> = {};
  for (const d of houseDefs) {
    let h = await House.findOne({ marketId: market._id, houseNumber: d.houseNumber });
    if (!h) {
      h = await House.create({
        marketId: market._id,
        sectionId: sections[d.section],
        houseNumber: d.houseNumber,
        name: d.name,
        addressDescription: `[DEMO] ${d.section === 'A' ? 'By the main gate' : d.section === 'B' ? 'Middle of Lace Row' : 'End of Brocade Lane'}`,
        verificationStatus: 'verified',
        headUserId: d.head?._id ?? null,
        headVerificationStatus: d.head ? 'verified' : 'unverified',
      });
      if (d.head) await HouseStaff.create({ houseId: h._id, userId: d.head._id, role: 'head', assignedBy: admin._id });
    }
    houses[d.houseNumber] = h;
  }

  const shopDefs = [
    { name: 'Alhaji Sani Textiles', number: '015', house: 'KW-024', owner: ['Sani Abdullahi', 'owner1@demo.kantinkwari.test'], verified: true, wholesale: true },
    { name: 'Baba Lace House', number: '016', house: 'KW-024', owner: ['Ibrahim Baba', 'owner2@demo.kantinkwari.test'], verified: true, wholesale: true },
    { name: 'Kwari Brocade Hub', number: '004', house: 'KW-031', owner: ['Zainab Yusuf', 'owner3@demo.kantinkwari.test'], verified: false, wholesale: true },
    { name: 'Hajiya Rolls & Plains', number: '009', house: 'KW-031', owner: ['Hadiza Lawal', 'owner4@demo.kantinkwari.test'], verified: false, wholesale: false },
  ];

  for (const d of shopDefs) {
    const owner = await user(d.owner[0], d.owner[1]);
    const house = houses[d.house];
    let shop = await Shop.findOne({ houseId: house._id, shopNumber: d.number });
    if (!shop) {
      shop = await Shop.create({
        name: d.name,
        slug: slugify(d.name),
        shopCode: `KK-DM${d.number}`,
        shopNumber: d.number,
        marketId: market._id,
        sectionId: house.sectionId,
        houseId: house._id,
        ownerId: owner._id,
        categoryIds: [...new Set(CATALOGUE[d.name].map((p) => categories[p.category]))],
        description: `[DEMO] ${d.name} — demonstration shop for development only.`,
        locationDescription: `First floor, door ${d.number}`,
        contactPhone: '+2348000000000',
        contactPreferences: { chat: true, phone: false, whatsapp: false },
        status: 'active',
        occupiesSlot: true,
        verificationStatus: d.verified ? 'verified' : 'unverified',
        pickupAvailable: true,
        pickupInstructions: 'Ask for the shop owner at the door. Bring your order reference.',
        deliveryAvailable: true,
        deliveryOptions: [
          { name: 'Within Kano city (1–2 days)', feeKobo: 200000, estimatedDays: '1–2 days', areas: ['Kano'] },
          { name: 'Other states (quoted)', feeKobo: null, estimatedDays: '3–7 days' },
        ],
        acceptedPaymentMethods: ['cash_on_pickup', 'bank_transfer', 'online'],
        bankTransferInstructions: '[DEMO] Ask the seller in chat for account details. Do not pay before the order is accepted.',
        wholesaleAvailable: d.wholesale,
        enabledUnits: ['yard', 'metre', 'piece', 'bundle', 'roll', 'set'],
      });
      await ShopMembership.create({ shopId: shop._id, userId: owner._id, role: 'owner', permissions: [...SHOP_PERMISSIONS], addedBy: owner._id });
      await HouseMembership.create({ houseId: house._id, shopId: shop._id, requestedBy: owner._id, status: 'approved', live: true, decidedBy: house.headUserId, decidedAt: new Date(), history: [{ status: 'pending', by: owner._id }, { status: 'approved', by: house.headUserId, reason: 'seed' }] });
    }

    for (const p of CATALOGUE[d.name]) {
      if (await Product.exists({ shopId: shop._id, name: `[DEMO] ${p.name}` })) continue;
      const productId = new Types.ObjectId();
      const images = [];
      for (const [i, palette] of [p.palette, [...p.palette].reverse()].entries()) {
        const img = await processUploadedImage(await patternImage(palette, p.pattern));
        const id = new Types.ObjectId();
        const base = storageKey('public', 'products', String(shop._id), String(productId), String(id));
        await storage().put(`${base}.webp`, img.full, img.contentType, 'public');
        await storage().put(`${base}-thumb.webp`, img.thumbnail, img.contentType, 'public');
        images.push({ _id: id, key: `${base}.webp`, thumbnailKey: `${base}-thumb.webp`, url: storage().publicUrl(`${base}.webp`), thumbnailUrl: storage().publicUrl(`${base}-thumb.webp`), width: img.width, height: img.height, bytes: img.bytes, sha256: img.sha256, position: i });
      }
      const stock = p.variants ? p.variants.reduce((s, v) => s + v.stock, 0) : p.stock;
      const product = await Product.create({
        _id: productId,
        shopId: shop._id,
        marketId: market._id,
        sectionId: shop.sectionId,
        houseId: shop.houseId,
        name: `[DEMO] ${p.name}`,
        slug: slugify(p.name),
        description: `[DEMO] ${p.name}. Demonstration product for development; images are generated patterns, not real stock photos.`,
        categoryId: categories[p.category],
        images,
        variants: (p.variants ?? []).map((v) => ({ label: v.label, colour: v.colour, stockQuantity: v.stock })),
        retailPriceKobo: p.retail * 100,
        wholesalePriceKobo: p.wholesale ? p.wholesale[0] * 100 : null,
        wholesaleMinQuantity: p.wholesale ? p.wholesale[1] : null,
        unit: p.unit,
        stockQuantity: stock,
        lowStockThreshold: 5,
        stockStatus: stock <= 0 ? 'out_of_stock' : stock <= 5 ? 'low_stock' : 'in_stock',
        material: p.material,
        brand: p.brand,
        colours: p.colours,
        patterns: [p.pattern],
        keywords: [...(p.keywords ?? []), 'demo'],
        status: 'published',
        publishedAt: new Date(),
        shopListed: true,
        shopVerified: d.verified,
        createdBy: owner._id,
      });
      await InventoryMovement.create({ productId: product._id, shopId: shop._id, delta: stock, balanceAfter: stock, reason: 'initial', actorId: owner._id, note: 'seed' });
      for (const img of images) await queueImageEmbedding(product._id, img._id);
    }
    await recountShopProducts(shop._id);
  }
  for (const h of Object.values(houses)) await recountHouseShops(h._id);

  // A worker for the first shop and two customers.
  const worker = await user('Musa (Shop Worker)', 'worker@demo.kantinkwari.test');
  const firstShop = await Shop.findOne({ slug: slugify('Alhaji Sani Textiles') });
  if (firstShop && !(await ShopMembership.exists({ shopId: firstShop._id, userId: worker._id, status: 'active' }))) {
    await ShopMembership.create({ shopId: firstShop._id, userId: worker._id, role: 'worker', permissions: ['products.manage', 'inventory.manage', 'chats.manage'], title: 'Sales assistant', addedBy: firstShop.ownerId });
  }
  await user('Aisha (Customer)', 'customer1@demo.kantinkwari.test', { phone: '+2348030000001' });
  await user('Emeka (Wholesale buyer)', 'customer2@demo.kantinkwari.test');

  let processed = 0;
  if (env.IMAGE_EMBEDDING_PROVIDER !== 'none') {
    for (;;) {
      const n = await drainJobs(50);
      processed += n;
      if (!n) break;
    }
  }
  logger.info(
    { password: DEMO_PASSWORD, accounts: ['admin@', 'manager@', 'head1@', 'head2@', 'owner1-4@', 'worker@', 'customer1-2@'].map((a) => `${a}demo.kantinkwari.test`), embeddingsProcessed: processed },
    'Development seed complete — all demo accounts share the password shown',
  );
  await disconnectDatabase();
}

main().catch(async (err) => {
  logger.fatal({ err: err.message }, 'Seed failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
