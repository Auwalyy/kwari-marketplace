import { Schema, model, type InferSchemaType } from 'mongoose';
import { EXPENSE_CATEGORIES, MEASUREMENT_UNITS, SALE_PAYMENT_METHODS } from '@kkdm/shared';

/**
 * The shop's own books: sales made in the shop (walk-in customers, phone orders, credit sales) and
 * expenses. App orders live in the orders module; the finance summary combines both.
 */

const saleItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    variantId: { type: Schema.Types.ObjectId, default: null },
    name: { type: String, required: true },
    unit: { type: String, enum: MEASUREMENT_UNITS, required: true },
    quantity: { type: Number, required: true, min: 0.01 },
    unitPriceKobo: { type: Number, required: true, min: 0 },
    /** Cost of one unit when the sale was made (the product's average cost then), for profit. */
    unitCostKobo: { type: Number, default: null },
    lineTotalKobo: { type: Number, required: true, min: 0 },
    /** Whether stock was taken from the product, so a void knows to put it back. */
    stockTaken: { type: Boolean, default: false },
  },
  { _id: false },
);

const salePaymentSchema = new Schema(
  {
    amountKobo: { type: Number, required: true, min: 1 },
    method: { type: String, enum: SALE_PAYMENT_METHODS, required: true },
    at: { type: Date, required: true },
    note: String,
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: false },
);

const shopSaleSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    number: { type: String, required: true },
    soldAt: { type: Date, required: true },
    customerName: String,
    customerPhone: String,
    items: { type: [saleItemSchema], default: [] },
    subtotalKobo: { type: Number, required: true },
    discountKobo: { type: Number, default: 0 },
    totalKobo: { type: Number, required: true },
    payments: { type: [salePaymentSchema], default: [] },
    amountPaidKobo: { type: Number, default: 0 },
    /** What the customer still owes (0 when fully paid). */
    balanceKobo: { type: Number, default: 0 },
    status: { type: String, enum: ['completed', 'voided'], default: 'completed' },
    voidReason: String,
    voidedAt: Date,
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    note: String,
    clientRef: String,
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
shopSaleSchema.index({ shopId: 1, soldAt: -1 });
shopSaleSchema.index({ shopId: 1, status: 1, balanceKobo: 1 });
shopSaleSchema.index({ shopId: 1, number: 1 }, { unique: true });
shopSaleSchema.index({ shopId: 1, clientRef: 1 }, { unique: true, partialFilterExpression: { clientRef: { $type: 'string' } } });
shopSaleSchema.index({ shopId: 1, 'items.productId': 1, soldAt: -1 });
export type ShopSaleAttrs = InferSchemaType<typeof shopSaleSchema>;
export const ShopSale = model('ShopSale', shopSaleSchema);

const shopExpenseSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    amountKobo: { type: Number, required: true, min: 1 },
    method: { type: String, enum: SALE_PAYMENT_METHODS, default: 'cash' },
    spentAt: { type: Date, required: true },
    note: String,
    /** Set when the expense was created by a restock, so the two stay linked. */
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    status: { type: String, enum: ['active', 'voided'], default: 'active' },
    voidReason: String,
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
shopExpenseSchema.index({ shopId: 1, spentAt: -1 });
export type ShopExpenseAttrs = InferSchemaType<typeof shopExpenseSchema>;
export const ShopExpense = model('ShopExpense', shopExpenseSchema);
