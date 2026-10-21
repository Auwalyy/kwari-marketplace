import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { DELIVERY_STATUSES, FULFILMENT_METHODS } from '@kkdm/shared';

const deliverySchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    method: { type: String, enum: FULFILMENT_METHODS, required: true },
    status: { type: String, enum: DELIVERY_STATUSES, required: true },
    optionId: { type: Schema.Types.ObjectId, default: null },
    optionName: String,
    feeKobo: { type: Number, default: null },
    /** Address snapshot at checkout time. */
    address: {
      label: String,
      recipientName: String,
      phone: String,
      line1: String,
      line2: String,
      city: String,
      state: String,
      landmark: String,
      location: { lat: Number, lng: Number },
    },
    pickupInstructions: String,
    estimatedDelivery: String,
    /** 'self' when the seller delivers; otherwise the external provider name. */
    provider: { type: String, default: 'self' },
    providerReference: String,
    history: {
      type: [{ status: String, note: String, actorId: Schema.Types.ObjectId, at: { type: Date, default: Date.now }, _id: false }],
      default: [],
    },
  },
  { timestamps: true },
);
deliverySchema.index({ shopId: 1, status: 1 });
export type DeliveryDoc = HydratedDocument<InferSchemaType<typeof deliverySchema>>;
export const Delivery = model('Delivery', deliverySchema);
