import { Schema, model } from 'mongoose';
import { PROMOTION_STATUSES, PROMOTION_TYPES, SUBSCRIPTION_PLANS } from '@kkdm/shared';

const promotionSchema = new Schema(
  {
    type: { type: String, enum: PROMOTION_TYPES, required: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    keywords: { type: [String], default: [] },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    status: { type: String, enum: PROMOTION_STATUSES, default: 'pending' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewNote: String,
    note: String,
    /** Payment for promotions is not live in the MVP; this records how it was arranged. */
    billing: { type: String, enum: ['not_billed', 'manual', 'gateway'], default: 'not_billed' },
    /** Counters incremented when the promotion is actually served / tapped. Never estimated. */
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
  },
  { timestamps: true },
);
promotionSchema.index({ type: 1, status: 1, startsAt: 1, endsAt: 1 });
promotionSchema.index({ shopId: 1, createdAt: -1 });
promotionSchema.index({ keywords: 1, status: 1 });
export const Promotion = model('Promotion', promotionSchema);

const subscriptionEntitlementSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    plan: { type: String, enum: SUBSCRIPTION_PLANS, required: true },
    features: { type: [String], default: [] },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active' },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    note: String,
  },
  { timestamps: true },
);
subscriptionEntitlementSchema.index({ shopId: 1, status: 1 });
export const SubscriptionEntitlement = model('SubscriptionEntitlement', subscriptionEntitlementSchema);
