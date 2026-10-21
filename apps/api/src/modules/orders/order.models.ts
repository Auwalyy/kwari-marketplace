import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import {
  FULFILMENT_METHODS,
  MEASUREMENT_UNITS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  QUOTATION_STATUSES,
} from '@kkdm/shared';

const cartItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, default: null },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    quantity: { type: Number, required: true, min: 0.01 },
    /** Present when the line comes from an accepted quotation; locks the negotiated unit price. */
    quotationId: { type: Schema.Types.ObjectId, ref: 'Quotation', default: null },
    quotationItemId: { type: Schema.Types.ObjectId, default: null },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const cartSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true },
);
export type CartDoc = HydratedDocument<InferSchemaType<typeof cartSchema>>;
export const Cart = model('Cart', cartSchema);

/**
 * Groups seller orders created by one checkout. The (userId, idempotencyKey) unique index makes a
 * repeated submission return the original orders instead of creating duplicates.
 */
const checkoutSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    idempotencyKey: { type: String, required: true },
    status: { type: String, enum: ['processing', 'completed', 'failed'], default: 'processing' },
    orderIds: { type: [Schema.Types.ObjectId], ref: 'Order', default: [] },
    totalKobo: { type: Number, default: 0 },
    error: String,
  },
  { timestamps: true },
);
checkoutSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
export const CheckoutSession = model('CheckoutSession', checkoutSchema);

/** Immutable price snapshot of a purchased line. */
const orderItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, default: null },
  productName: { type: String, required: true },
  variantLabel: { type: String, default: null },
  thumbnailUrl: { type: String, default: null },
  unit: { type: String, enum: MEASUREMENT_UNITS, required: true },
  quantity: { type: Number, required: true },
  unitPriceKobo: { type: Number, required: true },
  wholesaleApplied: { type: Boolean, default: false },
  lineTotalKobo: { type: Number, required: true },
  stockTracked: { type: Boolean, default: true },
});

const orderEventSchema = new Schema(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, required: true },
    note: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true },
    checkoutId: { type: Schema.Types.ObjectId, ref: 'CheckoutSession', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    marketId: { type: Schema.Types.ObjectId, ref: 'Market', required: true },
    houseId: { type: Schema.Types.ObjectId, ref: 'House', required: true },
    items: { type: [orderItemSchema], required: true },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending_acceptance' },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'unpaid' },
    fulfilmentMethod: { type: String, enum: FULFILMENT_METHODS, required: true },
    subtotalKobo: { type: Number, required: true },
    deliveryFeeKobo: { type: Number, default: 0 },
    totalKobo: { type: Number, required: true },
    note: String,
    quotationId: { type: Schema.Types.ObjectId, ref: 'Quotation', default: null },
    events: { type: [orderEventSchema], default: [] },
    /** Set once reserved stock has been returned, so restoration can never happen twice. */
    stockReleasedAt: { type: Date, default: null },
    acceptedAt: Date,
    deliveredAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    cancelReason: String,
  },
  { timestamps: true },
);
orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ shopId: 1, status: 1, createdAt: -1 });
orderSchema.index({ shopId: 1, createdAt: -1 });
orderSchema.index({ checkoutId: 1 });
orderSchema.index({ status: 1, deliveredAt: 1 });
orderSchema.index({ marketId: 1, houseId: 1, createdAt: -1 });
export type OrderAttrs = InferSchemaType<typeof orderSchema>;
export type OrderDoc = HydratedDocument<OrderAttrs>;
export const Order = model('Order', orderSchema);

const quotationItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, default: null },
  productName: { type: String, required: true },
  unit: { type: String, enum: MEASUREMENT_UNITS, required: true },
  quantity: { type: Number, required: true },
  listUnitPriceKobo: { type: Number, required: true },
  targetUnitPriceKobo: { type: Number, default: null },
  offeredUnitPriceKobo: { type: Number, default: null },
});

const quotationSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', default: null },
    items: { type: [quotationItemSchema], required: true },
    status: { type: String, enum: QUOTATION_STATUSES, default: 'requested' },
    message: String,
    sellerNote: String,
    customerNote: String,
    expiresAt: { type: Date, default: null },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    respondedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    history: {
      type: [
        {
          status: { type: String, enum: QUOTATION_STATUSES },
          by: { type: String, enum: ['customer', 'seller', 'system'] },
          actorId: { type: Schema.Types.ObjectId, ref: 'User' },
          note: String,
          at: { type: Date, default: Date.now },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);
quotationSchema.index({ shopId: 1, status: 1, createdAt: -1 });
quotationSchema.index({ customerId: 1, createdAt: -1 });
export type QuotationDoc = HydratedDocument<InferSchemaType<typeof quotationSchema>>;
export const Quotation = model('Quotation', quotationSchema);
