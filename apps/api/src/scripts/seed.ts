/**
 * Demo data: 4 shops with 10 real Sheradom bazin photos. Demo accounts are named "[DEMO] ..." and use
 * @demo.kantinkwari.test emails; every demo shop and product says it is sample data.
 *
 *   npm run seed               development database (add --reset to wipe it first)
 *   npm run seed -- --live     live database, until launch. Skips the demo admin and market manager, and
 *                              gives the demo accounts a random password that is printed once.
 *   npm run demo:remove        shows what would be removed; add -- --confirm to remove it
 */
import crypto from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SHOP_PERMISSIONS, type MeasurementUnit } from '@kkdm/shared';
import { connectDatabase, disconnectDatabase } from '../config/db';
import { env } from '../config/env';
import { logger } from '../config/logger';
import '../app';
import { User } from '../modules/users/user.model';
import { hashPassword } from '../modules/auth/password';
import { House, HouseMembership, HouseStaff, MarketSection } from '../modules/markets/market.models';
import { Shop, ShopMembership } from '../modules/shops/shop.models';
import { InventoryMovement, Product } from '../modules/products/product.models';
import { processUploadedImage } from '../services/images';
import { storage, storageKey } from '../services/storage';
import { queueImageEmbedding } from '../modules/visual-search/embedding.service';
import { drainJobs } from '../jobs/queue';
import { slugify } from '../utils/http';
import { recountHouseShops } from '../modules/houses/house.service';
import { recountShopProducts } from '../modules/shops/shop.service';
import { ensureReferenceData } from './reference-data';
import { DEMO_EMAIL_DOMAIN, DEMO_HOUSE_MARKER, DEMO_SECTIONS } from './demo-data';

const LIVE = process.argv.includes('--live');
/** Fixed in development for convenience; random on a live server, where the source code is no secret. */
const DEMO_PASSWORD = LIVE ? `Demo-${crypto.randomBytes(9).toString('base64url')}7a` : 'DemoPass123';
const demoEmail = (name: string) => `${name}@${DEMO_EMAIL_DOMAIN}`;

/** Real product photos used for the sample catalogue (apps/api/src/scripts/seed-assets/sheradom). */
const ASSETS = path.resolve(__dirname, 'seed-assets', 'sheradom');
const asset = (name: string) => fs.readFile(path.join(ASSETS, `${name}.jpg`));

async function user(fullName: string, email: string, extra: Record<string, unknown> = {}) {
  const existing = await User.findOne({ email });
  if (existing) return existing;
  return User.create({ fullName: `[DEMO] ${fullName}`, email, emailVerified: true, passwordHash: await hashPassword(DEMO_PASSWORD), ...extra });
}

interface ProductSeed {
  photo: string;
  name: string;
  colour: string;
  colours: string[];
  pattern: string;
  /** Naira per unit. */
  retail: number;
  /** [naira per unit, minimum quantity] */
  wholesale?: [number, number];
  unit: MeasurementUnit;
  stock: number;
}

const SHERADOM_DETAILS =
  'Sheradom Bazin Riche damask with a woven jacquard pattern and a high-lustre finish. Label: "Real non-fading — lasting luster after repeated washing", 100% cotton, 62/63" (160 cm) wide, 30 m per piece. Popular for kaftans, babban riga and asoebi.';

const CATALOGUE: Record<string, ProductSeed[]> = {
  'Alhaji Sani Textiles': [
    { photo: 'lilac-leopard', name: 'Sheradom Bazin Riche — Lilac Leopard', colour: 'lilac', colours: ['purple', 'lilac'], pattern: 'leopard', retail: 4500, wholesale: [3900, 30], unit: 'metre', stock: 240 },
    { photo: 'periwinkle-crackle', name: 'Sheradom Bazin Riche — Periwinkle Crackle', colour: 'periwinkle', colours: ['blue', 'purple'], pattern: 'crackle', retail: 4500, wholesale: [3900, 30], unit: 'metre', stock: 180 },
    { photo: 'cornflower-zigzag', name: 'Sheradom Bazin Riche — Cornflower Zigzag', colour: 'cornflower blue', colours: ['blue'], pattern: 'zigzag', retail: 4300, wholesale: [3800, 30], unit: 'metre', stock: 210 },
  ],
  'Baba Bazin & Shadda': [
    { photo: 'sky-blue-zebra', name: 'Sheradom Bazin Riche — Sky Blue Zebra', colour: 'sky blue', colours: ['blue', 'sky blue'], pattern: 'zebra', retail: 4400, wholesale: [3850, 30], unit: 'metre', stock: 150 },
    { photo: 'mint-zebra', name: 'Sheradom Bazin Riche — Mint Zebra', colour: 'mint', colours: ['green', 'mint'], pattern: 'zebra', retail: 4400, wholesale: [3850, 30], unit: 'metre', stock: 4 },
    { photo: 'white-zigzag', name: 'Sheradom Bazin Riche — White Zigzag', colour: 'white', colours: ['white'], pattern: 'zigzag', retail: 4800, wholesale: [4200, 30], unit: 'metre', stock: 300 },
  ],
  'Kwari Brocade Hub': [
    { photo: 'silver-check', name: 'Sheradom Bazin Riche — Silver Check', colour: 'silver grey', colours: ['grey', 'silver'], pattern: 'check', retail: 4600, wholesale: [4000, 30], unit: 'metre', stock: 120 },
    { photo: 'beige-dotted', name: 'Sheradom Bazin Riche — Beige Dot', colour: 'beige', colours: ['beige', 'brown'], pattern: 'dots', retail: 4600, wholesale: [4000, 30], unit: 'metre', stock: 90 },
  ],
  'Hajiya Rolls & Plains': [
    { photo: 'cream-dash', name: 'Sheradom Bazin Riche — Cream Dash (30 m piece)', colour: 'cream', colours: ['cream', 'gold'], pattern: 'dash', retail: 125000, wholesale: [115000, 5], unit: 'roll', stock: 18 },
    { photo: 'lime-crackle', name: 'Sheradom Bazin Riche — Lime Crackle (30 m piece)', colour: 'lime', colours: ['green', 'lime'], pattern: 'crackle', retail: 125000, wholesale: [115000, 5], unit: 'roll', stock: 0 },
  ],
};

async function main() {
  if (env.NODE_ENV === 'production' && !LIVE) throw new Error('Refusing to seed demo data in production (use --live to add removable demo shops)');
  if (LIVE && process.argv.includes('--reset')) throw new Error('--reset is never allowed with --live');
  await connectDatabase();
  if (process.argv.includes('--reset')) {
    await mongoose.connection.dropDatabase();
    for (const m of Object.values(mongoose.models)) await m.syncIndexes();
    logger.warn('Database reset');
  }

  // Staff accounts with platform-wide powers are never created on a live server.
  const admin = LIVE ? null : await user('Platform Admin', demoEmail('admin'), { platformRoles: ['admin'] });
  const { market, categories } = await ensureReferenceData(admin?._id);
  if (!LIVE) await user('Section Manager', demoEmail('manager'), { platformRoles: ['market_manager'], managedMarketIds: [market._id] });

  const sections: Record<string, Types.ObjectId> = {};
  for (const [code, name] of DEMO_SECTIONS) {
    const s = (await MarketSection.findOne({ marketId: market._id, code })) ?? (await MarketSection.create({ marketId: market._id, code, name, locationDescription: name }));
    sections[code] = s._id;
  }


  const head1 = await user('Alhaji Musa (House Head)', demoEmail('head1'));
  const head2 = await user('Hajiya Binta (House Head)', demoEmail('head2'));
  const houseDefs = [
    { houseNumber: 'KW-024', name: 'Musa House', section: 'B', head: head1 },
    { houseNumber: 'KW-031', name: 'Binta Plaza', section: 'C', head: head2 },
    { houseNumber: 'KW-002', name: 'Gate House', section: 'A', head: null },
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
        addressDescription: `${d.section === 'A' ? 'By the main gate' : d.section === 'B' ? 'Middle of Lace Row' : 'End of Brocade Lane'} ${DEMO_HOUSE_MARKER}`,
        verificationStatus: 'verified',
        headUserId: d.head?._id ?? null,
        headVerificationStatus: d.head ? 'verified' : 'unverified',
      });
      if (d.head) await HouseStaff.create({ houseId: h._id, userId: d.head._id, role: 'head', assignedBy: admin?._id ?? d.head._id });
    }
    houses[d.houseNumber] = h;
  }

  const shopDefs = [
    { name: 'Alhaji Sani Textiles', number: '015', house: 'KW-024', owner: ['Sani Abdullahi', demoEmail('owner1')], verified: true, wholesale: true, cover: 'stack' },
    { name: 'Baba Bazin & Shadda', number: '016', house: 'KW-024', owner: ['Ibrahim Baba', demoEmail('owner2')], verified: true, wholesale: true, cover: 'collage' },
    { name: 'Kwari Brocade Hub', number: '004', house: 'KW-031', owner: ['Zainab Yusuf', demoEmail('owner3')], verified: false, wholesale: true, cover: 'stack' },
    { name: 'Hajiya Rolls & Plains', number: '009', house: 'KW-031', owner: ['Hadiza Lawal', demoEmail('owner4')], verified: false, wholesale: true, cover: 'collage' },
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
        categoryIds: [categories.bazin],
        description: `${d.name} sells original Sheradom Bazin Riche by the metre and by the 30 m piece, retail and wholesale. (Demo shop — sample data.)`,
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
        bankTransferInstructions: 'Ask the seller in chat for account details. Do not pay before the order is accepted.',
        wholesaleAvailable: d.wholesale,
        enabledUnits: ['yard', 'metre', 'piece', 'bundle', 'roll', 'set'],
      });
      const cover = await processUploadedImage(await asset(d.cover), { maxDimension: 1600 });
      const coverKey = storageKey('public', 'shops', String(shop._id), `cover-${d.cover}.webp`);
      await storage().put(coverKey, cover.full, cover.contentType, 'public');
      shop.set({ coverUrl: storage().publicUrl(coverKey), coverKey });
      await shop.save();
      await ShopMembership.create({ shopId: shop._id, userId: owner._id, role: 'owner', permissions: [...SHOP_PERMISSIONS], addedBy: owner._id });
      await HouseMembership.create({ houseId: house._id, shopId: shop._id, requestedBy: owner._id, status: 'approved', live: true, decidedBy: house.headUserId, decidedAt: new Date(), history: [{ status: 'pending', by: owner._id }, { status: 'approved', by: house.headUserId, reason: 'seed' }] });
    }

    for (const p of CATALOGUE[d.name] ?? []) {
      if (await Product.exists({ shopId: shop._id, name: p.name })) continue;
      const productId = new Types.ObjectId();
      // Processed exactly like a seller's upload: validated, EXIF stripped, re-encoded with a thumbnail.
      const img = await processUploadedImage(await asset(p.photo));
      const imageId = new Types.ObjectId();
      const base = storageKey('public', 'products', String(shop._id), String(productId), String(imageId));
      await storage().put(`${base}.webp`, img.full, img.contentType, 'public');
      await storage().put(`${base}-thumb.webp`, img.thumbnail, img.contentType, 'public');
      const images = [
        { _id: imageId, key: `${base}.webp`, thumbnailKey: `${base}-thumb.webp`, url: storage().publicUrl(`${base}.webp`), thumbnailUrl: storage().publicUrl(`${base}-thumb.webp`), width: img.width, height: img.height, bytes: img.bytes, sha256: img.sha256, position: 0 },
      ];
      const perPiece = p.unit === 'roll';
      const lowStock = perPiece ? 2 : 10;
      const product = await Product.create({
        _id: productId,
        shopId: shop._id,
        marketId: market._id,
        sectionId: shop.sectionId,
        houseId: shop.houseId,
        name: p.name,
        slug: slugify(p.name),
        description: `${SHERADOM_DETAILS} ${perPiece ? 'Sold as a full 30 m piece.' : 'Cut to your length; buy 30 m or more for the wholesale price.'}\n\nDemo listing — sample data; prices are illustrative.`,
        categoryId: categories.bazin,
        subcategory: 'Bazin Riche',
        images,
        retailPriceKobo: p.retail * 100,
        wholesalePriceKobo: p.wholesale ? p.wholesale[0] * 100 : null,
        wholesaleMinQuantity: p.wholesale ? p.wholesale[1] : null,
        minOrderQuantity: perPiece ? 1 : 2,
        unit: p.unit,
        stockQuantity: p.stock,
        lowStockThreshold: lowStock,
        stockStatus: p.stock <= 0 ? 'out_of_stock' : p.stock <= lowStock ? 'low_stock' : 'in_stock',
        material: '100% cotton (as stated on label)',
        brand: 'Sheradom',
        colours: p.colours,
        patterns: [p.pattern, 'damask', 'jacquard'],
        keywords: ['bazin', 'bazin riche', 'shadda', 'damask', 'sheradom', 'non-fading', p.colour, 'kaftan', 'babban riga'],
        status: 'published',
        publishedAt: new Date(),
        shopListed: true,
        shopVerified: d.verified,
        createdBy: owner._id,
      });
      if (p.stock > 0) await InventoryMovement.create({ productId: product._id, shopId: shop._id, delta: p.stock, balanceAfter: p.stock, reason: 'initial', actorId: owner._id, note: 'seed' });
      await queueImageEmbedding(product._id, imageId);
    }
    await recountShopProducts(shop._id);
  }
  for (const h of Object.values(houses)) await recountHouseShops(h._id);

  // A worker for the first shop and two customers.
  const worker = await user('Musa (Shop Worker)', demoEmail('worker'));
  const firstShop = await Shop.findOne({ slug: slugify('Alhaji Sani Textiles') });
  if (firstShop && !(await ShopMembership.exists({ shopId: firstShop._id, userId: worker._id, status: 'active' }))) {
    await ShopMembership.create({ shopId: firstShop._id, userId: worker._id, role: 'worker', permissions: ['products.manage', 'inventory.manage', 'chats.manage'], title: 'Sales assistant', addedBy: firstShop.ownerId });
  }
  await user('Aisha (Customer)', demoEmail('customer1'), { phone: '+2348030000001' });
  await user('Emeka (Wholesale buyer)', demoEmail('customer2'));

  let processed = 0;
  if (env.IMAGE_EMBEDDING_PROVIDER !== 'none') {
    for (;;) {
      const n = await drainJobs(50);
      processed += n;
      if (!n) break;
    }
  }
  const accounts = [...(LIVE ? [] : ['admin', 'manager']), 'head1', 'head2', 'owner1', 'owner2', 'owner3', 'owner4', 'worker', 'customer1', 'customer2'].map(demoEmail);
  logger.info(
    { password: DEMO_PASSWORD, accounts, embeddingsProcessed: processed },
    LIVE
      ? 'Demo data added to the live database. New demo accounts use the password shown (it is not stored anywhere else); accounts that already existed keep their old password. Remove it all with: npm run demo:remove -- --confirm'
      : 'Development seed complete — all demo accounts share the password shown',
  );
  await disconnectDatabase();
}

main().catch(async (err) => {
  logger.fatal({ err: err.message }, 'Seed failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
