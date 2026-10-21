import { Router } from 'express';
import { Types } from 'mongoose';
import { marketSchema, marketUpdateSchema, paginationSchema, sectionSchema, sectionUpdateSchema, type MarketDto, type SectionDto } from '@kkdm/shared';
import { House, Market, MarketSection } from './market.models';
import { Shop } from '../shops/shop.models';
import { authenticate, optionalAuth, requireAuth, requirePlatformRole } from '../../middleware/auth';
import { assertMarketScope, canManageMarketScope } from '../../services/access';
import { audit } from '../../services/audit';
import { clearLocationCache } from '../../services/locations';
import { parse, paramId } from '../../utils/validate';
import { conflict, notFound, ok, pageMeta, paginated, skipFor } from '../../utils/http';

export const marketsRouter = Router();

type GeoLike = { lat?: number | null; lng?: number | null } | null | undefined;
const geo = (l: GeoLike) => (l && l.lat != null && l.lng != null ? { lat: l.lat, lng: l.lng } : null);

export function toMarketDto(m: any, stats?: MarketDto['stats']): MarketDto {
  return {
    id: String(m._id),
    name: m.name,
    slug: m.slug,
    description: m.description ?? undefined,
    region: m.region,
    city: m.city,
    country: m.country,
    usesSections: m.usesSections,
    location: geo(m.location),
    status: m.status,
    stats,
  };
}

export function toSectionDto(s: any, houseCount?: number): SectionDto {
  return {
    id: String(s._id),
    marketId: String(s.marketId),
    name: s.name,
    code: s.code,
    description: s.description ?? undefined,
    locationDescription: s.locationDescription ?? undefined,
    location: geo(s.location),
    houseCount,
  };
}

async function findMarket(idOrSlug: string) {
  const m = Types.ObjectId.isValid(idOrSlug) && idOrSlug.length === 24 ? await Market.findById(idOrSlug) : await Market.findOne({ slug: idOrSlug.toLowerCase() });
  if (!m) throw notFound('Market');
  return m;
}

marketsRouter.get('/', optionalAuth, async (req, res) => {
  const { page, limit } = parse(paginationSchema, req.query);
  const filter = req.auth?.platformRoles.includes('admin') ? {} : { status: 'active' };
  const [items, total] = await Promise.all([
    Market.find(filter).sort({ name: 1 }).skip(skipFor(page, limit)).limit(limit).lean(),
    Market.countDocuments(filter),
  ]);
  const ids = items.map((m) => m._id);
  const [sectionCounts, houseCounts, shopCounts] = await Promise.all([
    MarketSection.aggregate([{ $match: { marketId: { $in: ids }, status: 'active' } }, { $group: { _id: '$marketId', n: { $sum: 1 } } }]),
    House.aggregate([{ $match: { marketId: { $in: ids }, status: 'active' } }, { $group: { _id: '$marketId', n: { $sum: 1 } } }]),
    Shop.aggregate([{ $match: { marketId: { $in: ids }, status: 'active' } }, { $group: { _id: '$marketId', n: { $sum: 1 } } }]),
  ]);
  const count = (arr: { _id: unknown; n: number }[], id: unknown) => arr.find((x) => String(x._id) === String(id))?.n ?? 0;
  paginated(
    res,
    items.map((m) => toMarketDto(m, { sections: count(sectionCounts, m._id), houses: count(houseCounts, m._id), shops: count(shopCounts, m._id) })),
    pageMeta(page, limit, total),
  );
});

marketsRouter.get('/:idOrSlug', async (req, res) => {
  const m = await findMarket(String(req.params.idOrSlug));
  const [sections, houses, shops] = await Promise.all([
    MarketSection.countDocuments({ marketId: m._id, status: 'active' }),
    House.countDocuments({ marketId: m._id, status: 'active' }),
    Shop.countDocuments({ marketId: m._id, status: 'active' }),
  ]);
  ok(res, toMarketDto(m, { sections, houses, shops }));
});

marketsRouter.post('/', authenticate, requirePlatformRole('admin'), async (req, res) => {
  const input = parse(marketSchema, req.body);
  if (await Market.exists({ slug: input.slug })) throw conflict('A market with this slug already exists', 'SLUG_TAKEN');
  const m = await Market.create({ ...input, createdBy: requireAuth(req).userId });
  await audit({ req, action: 'market.created', category: 'market', targetType: 'market', targetId: m._id, marketId: m._id });
  ok(res, toMarketDto(m), 201);
});

marketsRouter.patch('/:id', authenticate, async (req, res) => {
  const m = await Market.findById(paramId(req.params.id));
  if (!m) throw notFound('Market');
  assertMarketScope(req.auth, { marketId: m._id });
  const input = parse(marketUpdateSchema, req.body);
  if (input.slug && input.slug !== m.slug && (await Market.exists({ slug: input.slug }))) throw conflict('Slug already in use', 'SLUG_TAKEN');
  if (input.usesSections === false && (await House.exists({ marketId: m._id, sectionId: { $ne: null } }))) {
    throw conflict('Move houses out of sections before disabling sections for this market', 'SECTIONS_IN_USE');
  }
  m.set(input);
  await m.save();
  clearLocationCache();
  await audit({ req, action: 'market.updated', category: 'market', targetType: 'market', targetId: m._id, marketId: m._id, metadata: { fields: Object.keys(input) } });
  ok(res, toMarketDto(m));
});

/* Sections ------------------------------------------------------------------------------------ */

marketsRouter.get('/:id/sections', async (req, res) => {
  const marketId = paramId(req.params.id);
  const sections = await MarketSection.find({ marketId, status: 'active' }).sort({ code: 1 }).limit(500).lean();
  const counts = await House.aggregate([
    { $match: { marketId: new Types.ObjectId(marketId), status: 'active' } },
    { $group: { _id: '$sectionId', n: { $sum: 1 } } },
  ]);
  ok(res, sections.map((s) => toSectionDto(s, counts.find((c) => String(c._id) === String(s._id))?.n ?? 0)));
});

marketsRouter.post('/:id/sections', authenticate, async (req, res) => {
  const m = await Market.findById(paramId(req.params.id));
  if (!m) throw notFound('Market');
  assertMarketScope(req.auth, { marketId: m._id });
  const input = parse(sectionSchema, req.body);
  if (!m.usesSections) throw conflict('This market is configured without sections', 'SECTIONS_DISABLED');
  if (await MarketSection.exists({ marketId: m._id, code: input.code })) throw conflict('A section with this code already exists', 'SECTION_CODE_TAKEN');
  const s = await MarketSection.create({ ...input, marketId: m._id });
  await audit({ req, action: 'section.created', category: 'market', targetType: 'section', targetId: s._id, marketId: m._id });
  ok(res, toSectionDto(s, 0), 201);
});

export const sectionsRouter = Router();

sectionsRouter.get('/:id', async (req, res) => {
  const s = await MarketSection.findById(paramId(req.params.id)).lean();
  if (!s) throw notFound('Section');
  ok(res, toSectionDto(s, await House.countDocuments({ sectionId: s._id, status: 'active' })));
});

sectionsRouter.patch('/:id', authenticate, async (req, res) => {
  const s = await MarketSection.findById(paramId(req.params.id));
  if (!s) throw notFound('Section');
  assertMarketScope(req.auth, { marketId: s.marketId, sectionId: s._id });
  const input = parse(sectionUpdateSchema, req.body);
  if (input.code && input.code !== s.code && (await MarketSection.exists({ marketId: s.marketId, code: input.code }))) {
    throw conflict('A section with this code already exists', 'SECTION_CODE_TAKEN');
  }
  s.set(input);
  await s.save();
  clearLocationCache();
  await audit({ req, action: 'section.updated', category: 'market', targetType: 'section', targetId: s._id, marketId: s.marketId });
  ok(res, toSectionDto(s));
});

/** Sections are deactivated, never hard-deleted, and only when no active houses remain in them. */
sectionsRouter.delete('/:id', authenticate, async (req, res) => {
  const s = await MarketSection.findById(paramId(req.params.id));
  if (!s) throw notFound('Section');
  assertMarketScope(req.auth, { marketId: s.marketId });
  if (await House.exists({ sectionId: s._id, status: 'active' })) throw conflict('Move or deactivate the houses in this section first', 'SECTION_NOT_EMPTY');
  s.status = 'inactive';
  await s.save();
  await audit({ req, action: 'section.deactivated', category: 'market', targetType: 'section', targetId: s._id, marketId: s.marketId });
  ok(res, { deactivated: true });
});

export { canManageMarketScope };
