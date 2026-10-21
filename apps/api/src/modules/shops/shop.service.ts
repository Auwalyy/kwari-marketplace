import type { Types } from 'mongoose';
import type { LocationBreadcrumb, MeasurementUnit, PaymentMethod, ShopDto, ShopSummaryDto } from '@kkdm/shared';
import { Shop, type ShopAttrs } from './shop.models';
import { Category, Product } from '../products/product.models';
import { ProductEmbedding } from '../visual-search/embedding.model';
import { breadcrumbKey, buildBreadcrumbs } from '../../services/locations';
import { iso } from '../../utils/http';
import { randomCode } from '../../utils/crypto';
import { slugify } from '../../utils/http';

type ShopLike = ShopAttrs & { _id: Types.ObjectId; createdAt?: Date };

export async function categoryNameMap(ids: (Types.ObjectId | string)[]) {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return new Map<string, string>();
  const cats = await Category.find({ _id: { $in: unique } }).select('name').lean();
  return new Map(cats.map((c) => [String(c._id), c.name]));
}

export async function toShopSummaries(shops: ShopLike[], opts: { sponsoredIds?: Set<string> } = {}): Promise<ShopSummaryDto[]> {
  const crumbs = await buildBreadcrumbs(shops.map((s) => ({ houseId: s.houseId, shopNumber: s.shopNumber })));
  const cats = await categoryNameMap(shops.flatMap((s) => s.categoryIds ?? []));
  return shops.map((s) => summary(s, crumbs.get(breadcrumbKey(s.houseId, s.shopNumber))!, cats, opts.sponsoredIds));
}

function summary(s: ShopLike, breadcrumb: LocationBreadcrumb, cats: Map<string, string>, sponsoredIds?: Set<string>): ShopSummaryDto {
  return {
    id: String(s._id),
    name: s.name,
    slug: s.slug,
    shopNumber: s.shopNumber,
    logoUrl: s.logoUrl ?? null,
    coverUrl: s.coverUrl ?? null,
    verificationStatus: s.verificationStatus,
    ratingAverage: Math.round((s.ratingAverage ?? 0) * 10) / 10,
    ratingCount: s.ratingCount ?? 0,
    wholesaleAvailable: !!s.wholesaleAvailable,
    activeProductCount: s.activeProductCount ?? 0,
    breadcrumb,
    categoryNames: (s.categoryIds ?? []).map((id) => cats.get(String(id))).filter((x): x is string => !!x),
    sponsored: sponsoredIds?.has(String(s._id)) || undefined,
  };
}

export async function toShopSummary(s: ShopLike): Promise<ShopSummaryDto> {
  return (await toShopSummaries([s]))[0];
}

export async function toShopDto(s: ShopLike): Promise<ShopDto> {
  const base = await toShopSummary(s);
  return {
    ...base,
    shopCode: s.shopCode,
    description: s.description ?? undefined,
    categoryIds: (s.categoryIds ?? []).map(String),
    status: s.status,
    locationDescription: s.locationDescription ?? undefined,
    contactPhone: s.contactPreferences?.phone ? (s.contactPhone ?? null) : null,
    contactEmail: s.contactEmail ?? null,
    whatsappPhone: s.contactPreferences?.whatsapp ? (s.whatsappPhone ?? null) : null,
    contactPreferences: {
      chat: s.contactPreferences?.chat !== false,
      phone: !!s.contactPreferences?.phone,
      whatsapp: !!s.contactPreferences?.whatsapp,
    },
    businessHours: (s.businessHours ?? []).map((h) => ({ day: h.day!, open: h.open!, close: h.close!, closed: !!h.closed })),
    pickupAvailable: !!s.pickupAvailable,
    pickupInstructions: s.pickupInstructions ?? undefined,
    deliveryAvailable: !!s.deliveryAvailable,
    deliveryOptions: (s.deliveryOptions ?? []).map((o: any) => ({
      id: String(o._id),
      name: o.name,
      description: o.description ?? undefined,
      feeKobo: o.feeKobo ?? null,
      estimatedDays: o.estimatedDays ?? undefined,
      areas: o.areas ?? [],
      active: o.active !== false,
    })),
    acceptedPaymentMethods: (s.acceptedPaymentMethods ?? []) as PaymentMethod[],
    bankTransferInstructions: s.bankTransferInstructions ?? undefined,
    enabledUnits: (s.enabledUnits ?? []) as MeasurementUnit[],
    ownerId: String(s.ownerId),
    createdAt: iso(s.createdAt)!,
  };
}

/** Owner/staff view includes contact details regardless of public contact preferences. */
export async function toShopDtoForStaff(s: ShopLike): Promise<ShopDto> {
  const dto = await toShopDto(s);
  return { ...dto, contactPhone: s.contactPhone ?? null, whatsappPhone: s.whatsappPhone ?? null };
}

export async function uniqueShopSlug(name: string): Promise<string> {
  const base = slugify(name) || 'shop';
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}-${randomCode(4).toLowerCase()}`;
    if (!(await Shop.exists({ slug: candidate }))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function uniqueShopCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = `KK-${randomCode(5)}`;
    if (!(await Shop.exists({ shopCode: code }))) return code;
  }
  throw new Error('Could not allocate a shop code');
}

/**
 * Re-derives listing flags on a shop's products and embeddings after a status / verification /
 * location change, so search and visual search never return products from unlisted shops.
 */
export async function refreshShopListing(shopId: Types.ObjectId | string): Promise<void> {
  const shop = await Shop.findById(shopId).select('status verificationStatus marketId sectionId houseId').lean();
  if (!shop) return;
  const listed = shop.status === 'active';
  await Product.updateMany(
    { shopId: shop._id },
    { $set: { shopListed: listed, shopVerified: shop.verificationStatus === 'verified', marketId: shop.marketId, sectionId: shop.sectionId, houseId: shop.houseId } },
  );
  if (!listed) {
    await ProductEmbedding.updateMany({ shopId: shop._id }, { $set: { searchable: false, marketId: shop.marketId, houseId: shop.houseId } });
  } else {
    const products = await Product.find({ shopId: shop._id }).select('status moderationStatus').lean();
    const searchableIds = products.filter((p) => p.status === 'published' && p.moderationStatus === 'approved').map((p) => p._id);
    await ProductEmbedding.updateMany({ shopId: shop._id }, { $set: { searchable: false, marketId: shop.marketId, houseId: shop.houseId } });
    if (searchableIds.length) await ProductEmbedding.updateMany({ productId: { $in: searchableIds } }, { $set: { searchable: true } });
  }
  await recountShopProducts(shop._id);
}

export async function recountShopProducts(shopId: Types.ObjectId | string) {
  const n = await Product.countDocuments({ shopId, status: 'published', moderationStatus: 'approved' });
  await Shop.updateOne({ _id: shopId }, { $set: { activeProductCount: n } });
}
