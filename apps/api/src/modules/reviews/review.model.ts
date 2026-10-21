import { Schema, model, type InferSchemaType } from 'mongoose';

const reviewSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** "shop" or the product id; with orderId this makes one review per order per scope. */
    scope: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, maxlength: 2000 },
    status: { type: String, enum: ['published', 'hidden', 'removed'], default: 'published' },
    moderationReason: String,
    response: {
      text: String,
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      at: Date,
    },
  },
  { timestamps: true },
);
reviewSchema.index({ orderId: 1, scope: 1 }, { unique: true });
reviewSchema.index({ shopId: 1, status: 1, createdAt: -1 });
reviewSchema.index({ productId: 1, status: 1, createdAt: -1 });
reviewSchema.index({ authorId: 1, createdAt: -1 });
export type ReviewAttrs = InferSchemaType<typeof reviewSchema>;
export const Review = model('Review', reviewSchema);
