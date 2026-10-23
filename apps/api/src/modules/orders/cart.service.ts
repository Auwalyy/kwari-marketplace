import { Types } from 'mongoose';
import { lineTotalKobo, resolveUnitPrice, type CartDto, type CartLineDto, type DeliveryOptionDto, type MeasurementUnit, type PaymentMethod } from '@kkdm/shared';
import { Cart, Quotation } from './order.models';
import { Product } from '../products/product.models';
import { isPubliclyVisible } from '../products/product.service';
import { Shop } from '../shops/shop.models';
import { toShopSummaries } from '../shops/shop.service';
import { approvedReseller } from '../resellers/reseller.access';

export interface PricedLine {
  lineId: string;
  productId: Types.ObjectId;
  variantId: Types.ObjectId | null;
  shopId: string;
  productName: string;
  variantLabel: string | null;
  thumbnailUrl: string | null;
  unit: MeasurementUnit;
  quantity: number;
  unitPriceKobo: number;
  wholesaleApplied: boolean;
  resellerApplied: boolean;
  lineTotalKobo: number;
  trackInventory: boolean;
  available: boolean;
  issue: string | null;
  quotationId: Types.ObjectId | null;
}

/**
 * Prices cart lines entirely from server data. Accepted, unexpired quotations lock the negotiated unit
 * price; otherwise retail / wholesale tiers (and variant price overrides) apply. Approved resellers pay
 * the shop's reseller price when it is lower.
 */
export async function priceCartItems(
  items: { _id?: unknown; productId: unknown; variantId?: unknown; shopId: unknown; quantity: number; quotationId?: unknown; quotationItemId?: unknown }[],
  opts: { reseller?: boolean } = {},
): Promise<PricedLine[]> {
  const products = await Product.find({ _id: { $in: items.map((i) => i.productId) } }).lean();
  const shops = await Shop.find({ _id: { $in: items.map((i) => i.shopId) } }).select('status').lean();
  const quotationIds = items.map((i) => i.quotationId).filter(Boolean);
  const quotations = quotationIds.length ? await Quotation.find({ _id: { $in: quotationIds } }).lean() : [];

  return items.map((item) => {
    const p = products.find((x) => String(x._id) === String(item.productId));
    const shop = shops.find((s) => String(s._id) === String(item.shopId));
    const variant = item.variantId && p ? p.variants.find((v) => String(v._id) === String(item.variantId)) : null;
    let issue: string | null = null;
    if (!p || !isPubliclyVisible(p)) issue = 'This product is no longer available';
    else if (!shop || shop.status !== 'active') issue = 'This shop is not accepting orders';
    else if (p.variants.length && !variant) issue = 'Choose an option for this product';
    else if (variant && variant.active === false) issue = 'This option is no longer available';

    let unitPriceKobo = 0;
    let wholesaleApplied = false;
    let resellerApplied = false;
    if (p) {
      const retail = variant?.priceOverrideKobo ?? p.retailPriceKobo;
      const r = resolveUnitPrice({ retailPriceKobo: retail, wholesalePriceKobo: p.wholesalePriceKobo, wholesaleMinQuantity: p.wholesaleMinQuantity }, item.quantity);
      unitPriceKobo = r.unitPriceKobo;
      wholesaleApplied = r.wholesale;
      if (opts.reseller && p.resellerPriceKobo != null && p.resellerPriceKobo < unitPriceKobo) {
        unitPriceKobo = p.resellerPriceKobo;
        wholesaleApplied = false;
        resellerApplied = true;
      }
      if (!issue && item.quantity < (p.minOrderQuantity ?? 0)) issue = `Minimum order is ${p.minOrderQuantity} ${p.unit}`;
      const stock = variant ? variant.stockQuantity : p.stockQuantity;
      if (!issue && p.trackInventory !== false && stock < item.quantity) issue = stock > 0 ? `Only ${stock} ${p.unit} left in stock` : 'Out of stock';
    }
    if (item.quotationId) {
      const q = quotations.find((x) => String(x._id) === String(item.quotationId));
      const qi = q?.items.find((x) => String(x._id) === String(item.quotationItemId));
      if (!q || q.status !== 'accepted' || !qi || qi.offeredUnitPriceKobo == null) issue ??= 'The quotation for this item is no longer valid';
      else if (q.expiresAt && q.expiresAt < new Date()) issue ??= 'The quotation for this item has expired';
      else {
        unitPriceKobo = qi.offeredUnitPriceKobo;
        wholesaleApplied = false;
        resellerApplied = false;
      }
    }
    const cover = p ? [...p.images].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0] : undefined;
    return {
      lineId: String(item._id ?? ''),
      productId: new Types.ObjectId(String(item.productId)),
      variantId: item.variantId ? new Types.ObjectId(String(item.variantId)) : null,
      shopId: String(item.shopId),
      productName: p?.name ?? 'Unavailable product',
      variantLabel: variant?.label ?? null,
      thumbnailUrl: cover?.thumbnailUrl ?? null,
      unit: (p?.unit ?? 'piece') as MeasurementUnit,
      quantity: item.quantity,
      unitPriceKobo,
      wholesaleApplied,
      resellerApplied,
      lineTotalKobo: lineTotalKobo(unitPriceKobo, item.quantity),
      trackInventory: p?.trackInventory !== false,
      available: !issue,
      issue,
      quotationId: item.quotationId ? new Types.ObjectId(String(item.quotationId)) : null,
    };
  });
}

export async function buildCartDto(userId: string): Promise<CartDto> {
  const cart = await Cart.findOne({ userId }).lean();
  const items = cart?.items ?? [];
  if (!items.length) return { groups: [], itemCount: 0, subtotalKobo: 0 };
  const priced = await priceCartItems(items as any, { reseller: !!(await approvedReseller(userId)) });
  const shops = await Shop.find({ _id: { $in: [...new Set(priced.map((l) => l.shopId))] } }).lean();
  const summaries = await toShopSummaries(shops as any);
  const groups = shops.map((shop) => {
    const lines: CartLineDto[] = priced
      .filter((l) => l.shopId === String(shop._id))
      .map((l) => ({
        id: l.lineId,
        productId: String(l.productId),
        variantId: l.variantId ? String(l.variantId) : null,
        productName: l.productName,
        variantLabel: l.variantLabel,
        thumbnailUrl: l.thumbnailUrl,
        unit: l.unit,
        quantity: l.quantity,
        unitPriceKobo: l.unitPriceKobo,
        wholesaleApplied: l.wholesaleApplied,
        resellerApplied: l.resellerApplied,
        lineTotalKobo: l.lineTotalKobo,
        available: l.available,
        issue: l.issue,
        quotationId: l.quotationId ? String(l.quotationId) : null,
      }));
    const summary = summaries.find((s) => s.id === String(shop._id))!;
    return {
      shop: {
        ...summary,
        pickupAvailable: !!shop.pickupAvailable,
        deliveryAvailable: !!shop.deliveryAvailable,
        deliveryOptions: (shop.deliveryOptions ?? [])
          .filter((o: any) => o.active !== false)
          .map((o: any): DeliveryOptionDto => ({ id: String(o._id), name: o.name, description: o.description, feeKobo: o.feeKobo ?? null, estimatedDays: o.estimatedDays, areas: o.areas ?? [], active: true })),
        acceptedPaymentMethods: (shop.acceptedPaymentMethods ?? []) as PaymentMethod[],
      },
      lines,
      subtotalKobo: lines.filter((l) => l.available).reduce((s, l) => s + l.lineTotalKobo, 0),
    };
  });
  return {
    groups,
    itemCount: priced.length,
    subtotalKobo: groups.reduce((s, g) => s + g.subtotalKobo, 0),
  };
}
