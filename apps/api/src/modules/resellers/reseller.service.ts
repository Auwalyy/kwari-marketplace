import type { Types } from 'mongoose';
import {
  BOOKS_PERIOD_LABELS,
  lineTotalKobo,
  type BooksPeriod,
  type MeasurementUnit,
  type ResellerListingDto,
  type ResellerMeDto,
  type ResellerPublicDto,
  type ResellerRequestDto,
  type ResellerSaleCreateInput,
  type ResellerSaleDto,
  type ResellerSummaryDto,
  type SalePaymentMethod,
  type StockStatus,
} from '@kkdm/shared';
import { Reseller, ResellerListing, ResellerRequest, ResellerSale, type ResellerAttrs, type ResellerListingAttrs, type ResellerSaleAttrs } from './reseller.models';
import { Category, Product } from '../products/product.models';
import { isPubliclyVisible } from '../products/product.service';
import { Shop } from '../shops/shop.models';
import { User } from '../users/user.model';
import { newOrderReference } from '../orders/order.service';
import { periodRange } from '../books/books.service';
import { badRequest, iso, slugify } from '../../utils/http';
import { randomCode } from '../../utils/crypto';

type ResellerDoc = ResellerAttrs & { _id: Types.ObjectId; createdAt?: Date };
type ListingDoc = ResellerListingAttrs & { _id: Types.ObjectId; createdAt?: Date };

export async function uniqueResellerSlug(name: string, excludeId?: Types.ObjectId) {
  const base = slugify(name) || 'reseller';
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}-${randomCode(4).toLowerCase()}`;
    if (!(await Reseller.exists({ slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function toResellerPublic(r: ResellerDoc): Promise<ResellerPublicDto> {
  return {
    id: String(r._id),
    businessName: r.businessName,
    slug: r.slug,
    area: r.area ?? undefined,
    about: r.about ?? undefined,
    phone: r.phone ?? undefined,
    whatsapp: r.whatsapp ?? undefined,
    listingCount: await ResellerListing.countDocuments({ resellerId: r._id, status: 'active' }),
  };
}

export async function toResellerMe(r: ResellerDoc): Promise<ResellerMeDto> {
  return { ...(await toResellerPublic(r)), status: r.status, decisionReason: r.decisionReason ?? undefined, appliedAt: iso(r.createdAt)! };
}

type ProductLean = Awaited<ReturnType<typeof loadProducts>>[number];
async function loadProducts(ids: unknown[]) {
  return Product.find({ _id: { $in: ids } }).lean();
}

/**
 * Whether customers can see and buy a listing right now. A listing drops out on its own when the shop
 * stops reselling the product, unpublishes it, or raises the reseller price above the reseller's price.
 */
export function listingAvailability(l: Pick<ListingDoc, 'status' | 'priceKobo'>, p: ProductLean | undefined, r: Pick<ResellerDoc, 'status'> | undefined): { available: boolean; reason?: string } {
  if (!r || r.status !== 'approved') return { available: false, reason: 'This reseller is not active' };
  if (!p || !isPubliclyVisible(p)) return { available: false, reason: 'The shop is no longer selling this product' };
  if (p.resellerPriceKobo == null) return { available: false, reason: 'The shop stopped offering this product for reselling' };
  if (l.priceKobo < p.resellerPriceKobo) return { available: false, reason: 'The shop raised its reseller price above your price — update your price' };
  if (l.status !== 'active') return { available: false, reason: 'Paused' };
  return { available: true };
}

/** Listings for customers (shop hidden) or for the reseller who owns them (`owner`: includes the source shop and margin). */
export async function toListingDtos(listings: ListingDoc[], opts: { owner?: boolean } = {}): Promise<ResellerListingDto[]> {
  if (!listings.length) return [];
  const [products, resellers] = await Promise.all([
    loadProducts(listings.map((l) => l.productId)),
    Reseller.find({ _id: { $in: listings.map((l) => l.resellerId) } }).lean(),
  ]);
  const categories = new Map((await Category.find({ _id: { $in: products.map((p) => p.categoryId) } }).select('name').lean()).map((c) => [String(c._id), c.name]));
  const shops = opts.owner ? new Map((await Shop.find({ _id: { $in: listings.map((l) => l.shopId) } }).select('name slug').lean()).map((s) => [String(s._id), s])) : new Map();
  const publicResellers = new Map(await Promise.all(resellers.map(async (r) => [String(r._id), await toResellerPublic(r as ResellerDoc)] as const)));

  return listings.map((l) => {
    const p = products.find((x) => String(x._id) === String(l.productId));
    const r = resellers.find((x) => String(x._id) === String(l.resellerId));
    const a = listingAvailability(l, p, r as ResellerDoc | undefined);
    const images = [...(p?.images ?? [])].sort((x, y) => (x.position ?? 0) - (y.position ?? 0)).map((i) => ({ url: i.url, thumbnailUrl: i.thumbnailUrl }));
    const shop = shops.get(String(l.shopId));
    return {
      id: String(l._id),
      priceKobo: l.priceKobo,
      note: l.note ?? undefined,
      status: l.status as 'active' | 'paused',
      available: a.available,
      unavailableReason: a.reason,
      product: {
        name: p?.name ?? 'Unavailable product',
        description: p?.description ?? undefined,
        unit: (p?.unit ?? 'piece') as MeasurementUnit,
        images,
        thumbnailUrl: images[0]?.thumbnailUrl ?? null,
        stockStatus: (p?.stockStatus ?? 'out_of_stock') as StockStatus,
        minOrderQuantity: p?.minOrderQuantity ?? 1,
        colours: p?.colours ?? [],
        material: p?.material ?? undefined,
        categoryName: p ? categories.get(String(p.categoryId)) : undefined,
      },
      reseller: publicResellers.get(String(l.resellerId))!,
      ...(opts.owner && p
        ? {
            source: {
              productId: String(p._id),
              shopName: shop?.name ?? '',
              shopSlug: shop?.slug ?? '',
              resellerPriceKobo: p.resellerPriceKobo ?? null,
              retailPriceKobo: p.retailPriceKobo,
              profitPerUnitKobo: p.resellerPriceKobo != null ? l.priceKobo - p.resellerPriceKobo : null,
            },
          }
        : {}),
      createdAt: iso(l.createdAt)!,
    };
  });
}

/** Listings customers can see, newest first, optionally matching a search. */
export async function publicListings(filter: { resellerId?: Types.ObjectId; q?: string }, page: number, limit: number) {
  const approved = filter.resellerId ? [filter.resellerId] : (await Reseller.find({ status: 'approved' }).select('_id').lean()).map((r) => r._id);
  const productFilter: Record<string, unknown> = { status: 'published', moderationStatus: 'approved', shopListed: true, resellerPriceKobo: { $ne: null } };
  if (filter.q) productFilter.name = new RegExp(filter.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const products = await Product.find(productFilter).select('_id resellerPriceKobo').limit(2000).lean();
  const minPrice = new Map(products.map((p) => [String(p._id), p.resellerPriceKobo as number]));
  const candidates = await ResellerListing.find({ resellerId: { $in: approved }, status: 'active', productId: { $in: products.map((p) => p._id) } })
    .sort({ createdAt: -1 })
    .lean();
  const visible = candidates.filter((l) => l.priceKobo >= (minPrice.get(String(l.productId)) ?? Infinity));
  const slice = visible.slice((page - 1) * limit, page * limit);
  return { items: await toListingDtos(slice as ListingDoc[]), total: visible.length };
}

export async function toRequestDtos(requests: (InstanceType<typeof ResellerRequest> | Record<string, any>)[]): Promise<ResellerRequestDto[]> {
  const listings = await ResellerListing.find({ _id: { $in: requests.map((r) => r.listingId) } }).lean();
  const products = await loadProducts(listings.map((l) => l.productId));
  const customers = await User.find({ _id: { $in: requests.map((r) => r.customerId) } }).select('fullName phone').lean();
  return requests.map((r) => {
    const l = listings.find((x) => String(x._id) === String(r.listingId));
    const p = l ? products.find((x) => String(x._id) === String(l.productId)) : undefined;
    const c = customers.find((x) => String(x._id) === String(r.customerId));
    const cover = [...(p?.images ?? [])].sort((x, y) => (x.position ?? 0) - (y.position ?? 0))[0];
    return {
      id: String(r._id),
      listing: { id: String(r.listingId), name: p?.name ?? 'Product', thumbnailUrl: cover?.thumbnailUrl ?? null, priceKobo: l?.priceKobo ?? 0, unit: (p?.unit ?? 'piece') as MeasurementUnit },
      customer: { id: String(r.customerId), fullName: c?.fullName ?? 'Customer', phone: r.phone ?? c?.phone ?? undefined },
      quantity: r.quantity,
      note: r.note ?? undefined,
      status: r.status,
      createdAt: iso(r.createdAt)!,
    };
  });
}

/* Reseller sales --------------------------------------------------------------------------------- */

type SaleDoc = ResellerSaleAttrs & { _id: Types.ObjectId };

export function toResellerSaleDto(s: SaleDoc): ResellerSaleDto {
  return {
    id: String(s._id),
    number: s.number,
    soldAt: iso(s.soldAt)!,
    listingId: s.listingId ? String(s.listingId) : null,
    name: s.name,
    unit: s.unit as MeasurementUnit,
    quantity: s.quantity,
    unitPriceKobo: s.unitPriceKobo,
    unitCostKobo: s.unitCostKobo ?? null,
    totalKobo: s.totalKobo,
    profitKobo: s.unitCostKobo != null ? s.totalKobo - lineTotalKobo(s.unitCostKobo, s.quantity) : null,
    amountPaidKobo: s.amountPaidKobo ?? 0,
    balanceKobo: s.balanceKobo ?? 0,
    payments: (s.payments ?? []).map((p) => ({ amountKobo: p.amountKobo ?? 0, method: p.method as SalePaymentMethod, at: iso(p.at)! })),
    customerName: s.customerName ?? undefined,
    customerPhone: s.customerPhone ?? undefined,
    status: s.status as 'completed' | 'voided',
    note: s.note ?? undefined,
  };
}

export async function recordResellerSale(reseller: ResellerDoc, input: ResellerSaleCreateInput) {
  if (input.clientRef) {
    const existing = await ResellerSale.findOne({ resellerId: reseller._id, clientRef: input.clientRef });
    if (existing) return existing;
  }
  let name = input.name;
  let unit = input.unit ?? 'piece';
  let price = input.unitPriceKobo;
  let cost = input.unitCostKobo ?? null;
  if (input.listingId) {
    const l = await ResellerListing.findOne({ _id: input.listingId, resellerId: reseller._id }).lean();
    if (!l) throw badRequest('That product is not in your list', 'INVALID_LISTING');
    const p = await Product.findById(l.productId).select('name unit resellerPriceKobo').lean();
    name = p?.name ?? name ?? 'Product';
    unit = (p?.unit ?? unit) as typeof unit;
    price ??= l.priceKobo;
    cost = input.unitCostKobo ?? p?.resellerPriceKobo ?? null;
  }
  const totalKobo = lineTotalKobo(price!, input.quantity);
  const paid = input.amountPaidKobo ?? totalKobo;
  if (paid > totalKobo) throw badRequest('The amount paid is more than the total', 'OVERPAID');
  if (paid < totalKobo && !input.customerName) throw badRequest('Add the customer’s name so you can track what they owe', 'CUSTOMER_REQUIRED');
  const soldAt = input.soldAt ?? new Date();
  const sale = await ResellerSale.create({
    resellerId: reseller._id,
    number: newOrderReference('R'),
    soldAt,
    listingId: input.listingId ?? null,
    requestId: input.requestId ?? null,
    name,
    unit,
    quantity: input.quantity,
    unitPriceKobo: price,
    unitCostKobo: cost,
    totalKobo,
    payments: paid > 0 ? [{ amountKobo: paid, method: input.paymentMethod, at: soldAt }] : [],
    amountPaidKobo: paid,
    balanceKobo: totalKobo - paid,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    note: input.note,
    clientRef: input.clientRef,
  });
  if (input.requestId) await ResellerRequest.updateOne({ _id: input.requestId, resellerId: reseller._id }, { $set: { status: 'completed' } });
  return sale;
}

export async function resellerSummary(reseller: ResellerDoc, key: BooksPeriod): Promise<ResellerSummaryDto> {
  const r = periodRange(key);
  const [sales, collected, owed, newRequests, listings] = await Promise.all([
    ResellerSale.find({ resellerId: reseller._id, status: 'completed', soldAt: { $gte: r.from, $lt: r.to } }).lean(),
    ResellerSale.aggregate([
      { $match: { resellerId: reseller._id, status: 'completed', 'payments.at': { $gte: r.from, $lt: r.to } } },
      { $unwind: '$payments' },
      { $match: { 'payments.at': { $gte: r.from, $lt: r.to } } },
      { $group: { _id: null, kobo: { $sum: '$payments.amountKobo' } } },
    ]),
    ResellerSale.aggregate([{ $match: { resellerId: reseller._id, status: 'completed', balanceKobo: { $gt: 0 } } }, { $group: { _id: null, kobo: { $sum: '$balanceKobo' } } }]),
    ResellerRequest.countDocuments({ resellerId: reseller._id, status: 'new' }),
    ResellerListing.find({ resellerId: reseller._id }).lean(),
  ]);
  const products = await loadProducts(listings.map((l) => l.productId));
  const salesKobo = sales.reduce((s, x) => s + x.totalKobo, 0);
  const costKobo = sales.reduce((s, x) => s + (x.unitCostKobo != null ? lineTotalKobo(x.unitCostKobo, x.quantity) : 0), 0);
  const attention = listings.filter((l) => l.status === 'active' && !listingAvailability(l, products.find((p) => String(p._id) === String(l.productId)), reseller).available).length;
  return {
    period: { key, label: BOOKS_PERIOD_LABELS[key] },
    salesKobo,
    salesCount: sales.length,
    costKobo,
    profitKobo: salesKobo - costKobo,
    collectedKobo: collected[0]?.kobo ?? 0,
    owedKobo: owed[0]?.kobo ?? 0,
    newRequests,
    activeListings: listings.filter((l) => l.status === 'active').length,
    listingsNeedingAttention: attention,
  };
}

