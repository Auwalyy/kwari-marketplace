import type { Types } from 'mongoose';
import type { LocationBreadcrumb } from '@kkdm/shared';
import { House, Market, MarketSection } from '../modules/markets/market.models';

/**
 * Builds human-readable location breadcrumbs ("Kantin Kwari → Section B → House KW-024 → Shop 015").
 * Markets and sections change rarely, so they are cached briefly; houses are fetched per batch.
 */

interface CacheEntry<T> {
  value: T;
  at: number;
}
const TTL = 60_000;
const marketCache = new Map<string, CacheEntry<{ name: string; usesSections: boolean }>>();
const sectionCache = new Map<string, CacheEntry<{ name: string; code: string }>>();

export function clearLocationCache() {
  marketCache.clear();
  sectionCache.clear();
}

async function loadMarkets(ids: string[]) {
  const now = Date.now();
  const missing = ids.filter((id) => !marketCache.has(id) || now - marketCache.get(id)!.at > TTL);
  if (missing.length) {
    const docs = await Market.find({ _id: { $in: missing } }).select('name usesSections').lean();
    for (const d of docs) marketCache.set(String(d._id), { value: { name: d.name, usesSections: d.usesSections }, at: now });
  }
}

async function loadSections(ids: string[]) {
  const now = Date.now();
  const missing = ids.filter((id) => !sectionCache.has(id) || now - sectionCache.get(id)!.at > TTL);
  if (missing.length) {
    const docs = await MarketSection.find({ _id: { $in: missing } }).select('name code').lean();
    for (const d of docs) sectionCache.set(String(d._id), { value: { name: d.name, code: d.code }, at: now });
  }
}

export function formatBreadcrumbLabel(parts: { marketName: string; sectionName?: string | null; houseNumber: string; shopNumber?: string }) {
  return [parts.marketName, parts.sectionName, `House ${parts.houseNumber}`, parts.shopNumber ? `Shop ${parts.shopNumber}` : null]
    .filter(Boolean)
    .join(' → ');
}

type Id = Types.ObjectId | string;

/** Returns breadcrumbs keyed by `${houseId}|${shopNumber ?? ''}`. */
export async function buildBreadcrumbs(items: { houseId: Id; shopNumber?: string | null }[]): Promise<Map<string, LocationBreadcrumb>> {
  const houseIds = [...new Set(items.map((i) => String(i.houseId)))];
  const houses = await House.find({ _id: { $in: houseIds } }).select('marketId sectionId houseNumber name').lean();
  await Promise.all([
    loadMarkets([...new Set(houses.map((h) => String(h.marketId)))]),
    loadSections([...new Set(houses.filter((h) => h.sectionId).map((h) => String(h.sectionId)))]),
  ]);
  const houseMap = new Map(houses.map((h) => [String(h._id), h]));
  const out = new Map<string, LocationBreadcrumb>();
  for (const item of items) {
    const h = houseMap.get(String(item.houseId));
    if (!h) continue;
    const market = marketCache.get(String(h.marketId))?.value;
    const section = h.sectionId ? sectionCache.get(String(h.sectionId))?.value : undefined;
    const marketName = market?.name ?? 'Market';
    const sectionName = section ? section.name : null;
    const shopNumber = item.shopNumber ?? undefined;
    out.set(breadcrumbKey(item.houseId, item.shopNumber), {
      marketId: String(h.marketId),
      marketName,
      sectionId: h.sectionId ? String(h.sectionId) : null,
      sectionName,
      sectionCode: section?.code ?? null,
      houseId: String(h._id),
      houseNumber: h.houseNumber,
      houseName: h.name,
      shopNumber,
      label: formatBreadcrumbLabel({ marketName, sectionName, houseNumber: h.houseNumber, shopNumber }),
    });
  }
  return out;
}

export function breadcrumbKey(houseId: Id, shopNumber?: string | null) {
  return `${String(houseId)}|${shopNumber ?? ''}`;
}

export async function breadcrumbFor(houseId: Id, shopNumber?: string | null): Promise<LocationBreadcrumb | null> {
  const map = await buildBreadcrumbs([{ houseId, shopNumber }]);
  return map.get(breadcrumbKey(houseId, shopNumber)) ?? null;
}
