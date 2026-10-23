import { Schema, model, type InferSchemaType } from 'mongoose';
import { MEASUREMENT_UNITS, RESELLER_REQUEST_STATUSES, RESELLER_STATUSES, SALE_PAYMENT_METHODS } from '@kkdm/shared';

/**
 * Resellers are independent agents: once an admin approves them they can see shops' reseller prices,
 * re-list those products at their own price, and keep the difference. They collect from their
 * customers themselves; the app records the sales and orders from the shop at the reseller price.
 */
const resellerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    businessName: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    whatsapp: String,
    area: String,
    about: String,
    status: { type: String, enum: RESELLER_STATUSES, default: 'pending' },
    decisionReason: String,
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: Date,
  },
  { timestamps: true },
);
resellerSchema.index({ status: 1, createdAt: -1 });
export type ResellerAttrs = InferSchemaType<typeof resellerSchema>;
export const Reseller = model('Reseller', resellerSchema);

const listingSchema = new Schema(
  {
    resellerId: { type: Schema.Types.ObjectId, ref: 'Reseller', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    priceKobo: { type: Number, required: true, min: 1 },
    note: String,
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
  },
  { timestamps: true },
);
listingSchema.index({ resellerId: 1, productId: 1 }, { unique: true });
listingSchema.index({ productId: 1, status: 1 });
export type ResellerListingAttrs = InferSchemaType<typeof listingSchema>;
export const ResellerListing = model('ResellerListing', listingSchema);

/** A customer's "I want to buy" sent to a reseller from a listing. */
const requestSchema = new Schema(
  {
    resellerId: { type: Schema.Types.ObjectId, ref: 'Reseller', required: true },
    listingId: { type: Schema.Types.ObjectId, ref: 'ResellerListing', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    quantity: { type: Number, required: true, min: 0.01 },
    note: String,
    phone: String,
    status: { type: String, enum: RESELLER_REQUEST_STATUSES, default: 'new' },
  },
  { timestamps: true },
);
requestSchema.index({ resellerId: 1, status: 1, createdAt: -1 });
requestSchema.index({ customerId: 1, createdAt: -1 });
export type ResellerRequestAttrs = InferSchemaType<typeof requestSchema>;
export const ResellerRequest = model('ResellerRequest', requestSchema);

/** A sale the reseller made to their own customer (they collect the money themselves). */
const resellerSaleSchema = new Schema(
  {
    resellerId: { type: Schema.Types.ObjectId, ref: 'Reseller', required: true },
    number: { type: String, required: true },
    soldAt: { type: Date, required: true },
    listingId: { type: Schema.Types.ObjectId, ref: 'ResellerListing', default: null },
    requestId: { type: Schema.Types.ObjectId, ref: 'ResellerRequest', default: null },
    name: { type: String, required: true },
    unit: { type: String, enum: MEASUREMENT_UNITS, required: true },
    quantity: { type: Number, required: true, min: 0.01 },
    unitPriceKobo: { type: Number, required: true, min: 0 },
    unitCostKobo: { type: Number, default: null },
    totalKobo: { type: Number, required: true },
    payments: {
      type: [{ amountKobo: Number, method: { type: String, enum: SALE_PAYMENT_METHODS }, at: Date, _id: false }],
      default: [],
    },
    amountPaidKobo: { type: Number, default: 0 },
    balanceKobo: { type: Number, default: 0 },
    customerName: String,
    customerPhone: String,
    status: { type: String, enum: ['completed', 'voided'], default: 'completed' },
    note: String,
    clientRef: String,
  },
  { timestamps: true },
);
resellerSaleSchema.index({ resellerId: 1, soldAt: -1 });
resellerSaleSchema.index({ resellerId: 1, clientRef: 1 }, { unique: true, partialFilterExpression: { clientRef: { $type: 'string' } } });
export type ResellerSaleAttrs = InferSchemaType<typeof resellerSaleSchema>;
export const ResellerSale = model('ResellerSale', resellerSaleSchema);
