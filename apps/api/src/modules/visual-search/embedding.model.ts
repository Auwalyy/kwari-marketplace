import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * One vector per product image. Filter fields are denormalised so the vector index can pre-filter
 * (Atlas `$vectorSearch` filter) without joins. They are refreshed whenever the product or shop changes.
 */
const productEmbeddingSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    imageId: { type: Schema.Types.ObjectId, required: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    marketId: { type: Schema.Types.ObjectId, required: true },
    houseId: { type: Schema.Types.ObjectId, required: true },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    dimensions: { type: Number, required: true },
    embedding: { type: [Number], required: true },
    /** Product searchable = published, approved moderation, shop listed. */
    searchable: { type: Boolean, default: false },
    inStock: { type: Boolean, default: false },
    retailPriceKobo: { type: Number, default: 0 },
    wholesale: { type: Boolean, default: false },
  },
  { timestamps: true },
);
productEmbeddingSchema.index({ imageId: 1, provider: 1, model: 1 }, { unique: true });
productEmbeddingSchema.index({ productId: 1 });
productEmbeddingSchema.index({ provider: 1, model: 1, searchable: 1 });
export type ProductEmbeddingAttrs = InferSchemaType<typeof productEmbeddingSchema>;
export const ProductEmbedding = model('ProductEmbedding', productEmbeddingSchema);

/** Short-lived cache of visual-search results keyed by the query image hash; images are never stored. */
const visualSearchCacheSchema = new Schema({
  key: { type: String, required: true, unique: true },
  results: { type: [{ productId: Schema.Types.ObjectId, imageId: Schema.Types.ObjectId, score: Number, _id: false }], default: [] },
  createdAt: { type: Date, default: Date.now },
});
visualSearchCacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 15 });
export const VisualSearchCache = model('VisualSearchCache', visualSearchCacheSchema);
