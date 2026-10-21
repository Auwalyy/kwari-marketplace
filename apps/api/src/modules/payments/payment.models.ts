import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '@kkdm/shared';

/**
 * One payment attempt for an order. `verified` is true only when confirmed through the provider's
 * server-side API or a signed webhook. Card data never touches this system.
 */
const paymentSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    provider: { type: String, required: true },
    reference: { type: String, required: true, unique: true },
    idempotencyKey: { type: String, required: true },
    amountKobo: { type: Number, required: true },
    currency: { type: String, default: 'NGN' },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
    verified: { type: Boolean, default: false },
    verifiedAt: Date,
    paidAt: Date,
    authorizationUrl: String,
    accessCode: String,
    providerTransactionId: String,
    providerStatus: String,
    channel: String,
    /** For seller-confirmed cash / transfer payments. */
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    confirmationNote: String,
    failureReason: String,
    history: {
      type: [{ status: String, source: String, note: String, at: { type: Date, default: Date.now }, _id: false }],
      default: [],
    },
  },
  { timestamps: true },
);
paymentSchema.index({ orderId: 1, idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ orderId: 1, createdAt: -1 });
paymentSchema.index({ shopId: 1, status: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
export type PaymentDoc = HydratedDocument<InferSchemaType<typeof paymentSchema>>;
export const Payment = model('Payment', paymentSchema);

/** Records every processed provider event; the unique key makes webhook handling idempotent. */
const paymentEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    eventKey: { type: String, required: true },
    type: { type: String, required: true },
    reference: String,
    payloadSha256: String,
    outcome: { type: String, enum: ['applied', 'ignored', 'failed'], default: 'applied' },
    note: String,
  },
  { timestamps: true },
);
paymentEventSchema.index({ provider: 1, eventKey: 1 }, { unique: true });
export const PaymentEvent = model('PaymentEvent', paymentEventSchema);

const refundSchema = new Schema(
  {
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    amountKobo: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed', 'manual'], default: 'pending' },
    provider: String,
    providerRefundId: String,
    reason: String,
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    completedAt: Date,
  },
  { timestamps: true },
);
refundSchema.index({ orderId: 1 });
export const Refund = model('Refund', refundSchema);
