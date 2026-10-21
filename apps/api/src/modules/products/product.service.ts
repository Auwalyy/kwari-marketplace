import type { Types } from 'mongoose';
import type { MeasurementUnit, ProductDto, ProductSummaryDto, StockStatus } from '@kkdm/shared';
import { Product, type ProductAttrs, type ProductDoc } from './product.models';
import { Shop } from '../shops/shop.models';
import { breadcrumbKey, buildBreadcrumbs } from '../../services/locations';
import { categoryNameMap } from '../shops/shop.service';
import { iso, slugify } from '../../utils/http';
import { randomCode } from '../../utils/crypto';

type ProductLike = ProductAttrs & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date };

export function computeStockStatus(p: { trackInventory?: boolean | null; stockQuantity: number; lowStockThreshold?: number | null }): StockStatus {
  if (p.trackInventory === false) return 'in_stock';
  if (p.stockQuantity <= 0) return 'out_of_stock';
  if (p.stockQuantity <= (p.lowStockThreshold ?? 0)) return 'low_stock';
  return 'in_stock';
}

/** Recomputes the aggregate stock from variants (when present) and the derived stock status. */
export function applyStockDerivations(p: ProductDoc) {
  const activeVariants = (p.variants ?? []).filter((v) => v.active !== false);
  if (activeVariants.length) {
    p.stockQuantity = Math.round(activeVariants.reduce((sum, v) => sum + (v.stockQuantity ?? 0), 0) * 100) / 100;
  }
  p.stockStatus = computeStockStatus(p);
}

export async function uniqueProductSlug(shopId: Types.ObjectId | string, name: string, excludeId?: Types.ObjectId) {
  const base = slugify(name) || 'product';
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}-${randomCode(4).toLowerCase()}`;
    const exists = await Product.exists({ shopId, slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
    if (!exists) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function isPubliclyVisible(p: { status: string; moderationStatus: string; shopListed: boolean }) {
  return p.status === 'published' && p.moderationStatus === 'approved' && p.shopListed;
}

/** Public catalogue filter: only published, moderated products of listed shops. */
export const PUBLIC_PRODUCT_FILTER = { status: 'published', moderationStatus: 'approved', shopListed: true } as const;

export async function toProductSummaries(products: ProductLike[], opts: { sponsoredIds?: Set<string> } = {}): Promise<ProductSummaryDto[]> {
  if (!products.length) return [];
  const shops = await Shop.find({ _id: { $in: [...new Set(products.map((p) => String(p.shopId)))] } })
    .select('name slug verificationStatus houseId shopNumber')
    .lean();
  const shopMap = new Map(shops.map((s) => [String(s._id), s]));
  const crumbs = await buildBreadcrumbs(shops.map((s) => ({ houseId: s.houseId, shopNumber: s.shopNumber })));
  const cats = await categoryNameMap(products.map((p) => p.categoryId));
  return products.map((p) => {
    const s = shopMap.get(String(p.shopId));
    const cover = [...(p.images ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
    return {
      id: String(p._id),
      name: p.name,
      slug: p.slug,
      thumbnailUrl: cover?.thumbnailUrl ?? null,
      retailPriceKobo: p.retailPriceKobo,
      wholesalePriceKobo: p.wholesalePriceKobo ?? null,
      wholesaleMinQuantity: p.wholesaleMinQuantity ?? null,
      unit: p.unit as MeasurementUnit,
      stockStatus: p.stockStatus as StockStatus,
      status: p.status,
      shop: {
        id: String(p.shopId),
        name: s?.name ?? '',
        slug: s?.slug ?? '',
        verificationStatus: s?.verificationStatus ?? 'unverified',
        breadcrumb: s ? crumbs.get(breadcrumbKey(s.houseId, s.shopNumber))! : (undefined as never),
      },
      categoryName: cats.get(String(p.categoryId)),
      ratingAverage: Math.round((p.ratingAverage ?? 0) * 10) / 10,
      ratingCount: p.ratingCount ?? 0,
      sponsored: opts.sponsoredIds?.has(String(p._id)) || undefined,
    };
  });
}

export async function toProductDto(p: ProductLike): Promise<ProductDto> {
  const [summary] = await toProductSummaries([p]);
  return {
    ...summary,
    description: p.description ?? undefined,
    categoryId: String(p.categoryId),
    subcategory: p.subcategory ?? undefined,
    images: [...(p.images ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((i: any) => ({
        id: String(i._id),
        url: i.url,
        thumbnailUrl: i.thumbnailUrl,
        width: i.width ?? undefined,
        height: i.height ?? undefined,
        embeddingStatus: i.embeddingStatus,
      })),
    variants: (p.variants ?? []).map((v: any) => ({
      id: String(v._id),
      label: v.label,
      colour: v.colour ?? undefined,
      pattern: v.pattern ?? undefined,
      size: v.size ?? undefined,
      sku: v.sku ?? undefined,
      priceOverrideKobo: v.priceOverrideKobo ?? null,
      stockQuantity: v.stockQuantity ?? 0,
      active: v.active !== false,
    })),
    minOrderQuantity: p.minOrderQuantity ?? 1,
    stockQuantity: p.stockQuantity,
    lowStockThreshold: p.lowStockThreshold ?? 0,
    trackInventory: p.trackInventory !== false,
    material: p.material ?? undefined,
    brand: p.brand ?? undefined,
    colours: p.colours ?? [],
    patterns: p.patterns ?? [],
    keywords: p.keywords ?? [],
    createdAt: iso(p.createdAt)!,
    updatedAt: iso(p.updatedAt)!,
  };
}
