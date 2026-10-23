import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { INVENTORY_MOVEMENT_REASONS, MEASUREMENT_UNITS, MODERATION_STATUSES, PRODUCT_STATUSES, STOCK_STATUSES } from '@kkdm/shared';

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    description: String,
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    iconName: String,
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
categorySchema.index({ parentId: 1, sortOrder: 1 });
export const Category = model('Category', categorySchema);

/** Product image metadata. Binaries live in object storage; only keys/URLs are stored here. */
export const productImageSchema = new Schema(
  {
    key: { type: String, required: true },
    thumbnailKey: { type: String, required: true },
    url: { type: String, required: true },
    thumbnailUrl: { type: String, required: true },
    width: Number,
    height: Number,
    bytes: Number,
    sha256: String,
    position: { type: Number, default: 0 },
    embeddingStatus: { type: String, enum: ['pending', 'processing', 'ready', 'failed', 'disabled'], default: 'pending' },
    embeddingError: String,
    embeddingAttempts: { type: Number, default: 0 },
    embeddingUpdatedAt: Date,
  },
  { timestamps: true },
);

export const productVariantSchema = new Schema(
  {
    label: { type: String, required: true },
    colour: String,
    pattern: String,
    size: String,
    sku: String,
    priceOverrideKobo: { type: Number, default: null },
    stockQuantity: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: false },
);

const productSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    // Location is denormalised from the shop for filtering without joins; kept in sync on shop moves.
    marketId: { type: Schema.Types.ObjectId, ref: 'Market', required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'MarketSection', default: null },
    houseId: { type: Schema.Types.ObjectId, ref: 'House', required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true },
    description: String,
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    subcategory: String,
    images: { type: [productImageSchema], default: [] },
    variants: { type: [productVariantSchema], default: [] },
    retailPriceKobo: { type: Number, required: true, min: 0 },
    wholesalePriceKobo: { type: Number, default: null },
    wholesaleMinQuantity: { type: Number, default: null },
    /** Average cost of one unit to the shop. Never shown to customers. */
    costPriceKobo: { type: Number, default: null, min: 0 },
    /** Price for approved resellers; null keeps the product out of reselling. Never shown to customers. */
    resellerPriceKobo: { type: Number, default: null, min: 0 },
    minOrderQuantity: { type: Number, default: 1 },
    unit: { type: String, enum: MEASUREMENT_UNITS, required: true },
    /** For products with variants this is the sum of variant stock. */
    stockQuantity: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 5 },
    trackInventory: { type: Boolean, default: true },
    stockStatus: { type: String, enum: STOCK_STATUSES, default: 'out_of_stock' },
    material: String,
    brand: String,
    colours: { type: [String], default: [] },
    patterns: { type: [String], default: [] },
    keywords: { type: [String], default: [] },
    status: { type: String, enum: PRODUCT_STATUSES, default: 'draft' },
    moderationStatus: { type: String, enum: MODERATION_STATUSES, default: 'approved' },
    moderationReason: String,
    /** Mirrors whether the owning shop is publicly listable; maintained when shop status changes. */
    shopListed: { type: Boolean, default: false },
    shopVerified: { type: Boolean, default: false },
    publishedAt: Date,
    archivedAt: Date,
    ratingAverage: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    salesQuantity: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
productSchema.index({ shopId: 1, slug: 1 }, { unique: true });
productSchema.index({ shopId: 1, status: 1, updatedAt: -1 });
productSchema.index({ status: 1, shopListed: 1, moderationStatus: 1, createdAt: -1 });
productSchema.index({ categoryId: 1, status: 1, retailPriceKobo: 1 });
productSchema.index({ marketId: 1, sectionId: 1, houseId: 1, status: 1 });
productSchema.index({ status: 1, wholesalePriceKobo: 1 });
productSchema.index({ colours: 1 });
productSchema.index(
  { name: 'text', keywords: 'text', colours: 'text', patterns: 'text', material: 'text', brand: 'text', description: 'text', subcategory: 'text' },
  { weights: { name: 10, keywords: 6, colours: 5, patterns: 5, material: 4, brand: 3, subcategory: 3, description: 1 }, name: 'product_text' },
);
export type ProductAttrs = InferSchemaType<typeof productSchema>;
export type ProductDoc = HydratedDocument<ProductAttrs>;
export const Product = model('Product', productSchema);

const inventoryMovementSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, default: null },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    delta: { type: Number, required: true },
    balanceAfter: { type: Number },
    reason: { type: String, enum: INVENTORY_MOVEMENT_REASONS, required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    note: String,
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
inventoryMovementSchema.index({ productId: 1, createdAt: -1 });
inventoryMovementSchema.index({ shopId: 1, createdAt: -1 });
export const InventoryMovement = model('InventoryMovement', inventoryMovementSchema);

const favoriteSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: ['shop', 'product'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
favoriteSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true });
favoriteSchema.index({ userId: 1, createdAt: -1 });
export const Favorite = model('Favorite', favoriteSchema);

const recentlyViewedSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  viewedAt: { type: Date, default: Date.now },
});
recentlyViewedSchema.index({ userId: 1, productId: 1 }, { unique: true });
recentlyViewedSchema.index({ userId: 1, viewedAt: -1 });
// History is automatically forgotten after 90 days.
recentlyViewedSchema.index({ viewedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
export const RecentlyViewed = model('RecentlyViewed', recentlyViewedSchema);

const searchHistorySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  query: { type: String, required: true },
  at: { type: Date, default: Date.now },
});
searchHistorySchema.index({ userId: 1, query: 1 }, { unique: true });
searchHistorySchema.index({ userId: 1, at: -1 });
searchHistorySchema.index({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
export const SearchHistory = model('SearchHistory', searchHistorySchema);
