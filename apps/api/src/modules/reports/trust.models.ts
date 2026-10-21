import { Schema, model } from 'mongoose';
import { REPORT_CATEGORIES, REPORT_STATUSES, REPORT_TARGETS, VERIFICATION_REQUEST_STATUSES, VERIFICATION_TYPES } from '@kkdm/shared';

const reportSchema = new Schema(
  {
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: REPORT_TARGETS, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    /** Resolved scope for routing to market managers. */
    marketId: { type: Schema.Types.ObjectId, default: null },
    shopId: { type: Schema.Types.ObjectId, default: null },
    category: { type: String, enum: REPORT_CATEGORIES, required: true },
    description: { type: String, required: true },
    status: { type: String, enum: REPORT_STATUSES, default: 'open' },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actions: {
      type: [
        {
          action: String,
          note: String,
          actorId: { type: Schema.Types.ObjectId, ref: 'User' },
          at: { type: Date, default: Date.now },
          _id: false,
        },
      ],
      default: [],
    },
    resolution: String,
    resolvedAt: Date,
  },
  { timestamps: true },
);
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, targetId: 1 });
reportSchema.index({ reporterId: 1, createdAt: -1 });
export const Report = model('Report', reportSchema);

/**
 * A block from a user (or a shop, acting through an authorised member) against a user or shop.
 * Enforced when starting conversations, sending messages and requesting quotations.
 */
const blockSchema = new Schema(
  {
    blockerType: { type: String, enum: ['user', 'shop'], required: true },
    blockerId: { type: Schema.Types.ObjectId, required: true },
    blockedType: { type: String, enum: ['user', 'shop'], required: true },
    blockedId: { type: Schema.Types.ObjectId, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: String,
  },
  { timestamps: true },
);
blockSchema.index({ blockerType: 1, blockerId: 1, blockedType: 1, blockedId: 1 }, { unique: true });
blockSchema.index({ blockedType: 1, blockedId: 1 });
export const Block = model('Block', blockSchema);

const verificationRequestSchema = new Schema(
  {
    type: { type: String, enum: VERIFICATION_TYPES, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    marketId: { type: Schema.Types.ObjectId, default: null },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    evidence: { type: String, required: true },
    documentUrls: { type: [String], default: [] },
    /** For shop_ownership requests: the user who should become the owner. */
    proposedOwnerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: VERIFICATION_REQUEST_STATUSES, default: 'pending' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: Date,
    decisionReason: String,
    appeal: {
      statement: String,
      at: Date,
    },
    history: {
      type: [{ status: String, actorId: Schema.Types.ObjectId, note: String, at: { type: Date, default: Date.now }, _id: false }],
      default: [],
    },
  },
  { timestamps: true },
);
verificationRequestSchema.index({ status: 1, type: 1, createdAt: 1 });
verificationRequestSchema.index({ type: 1, targetId: 1, status: 1 });
verificationRequestSchema.index({ requestedBy: 1, createdAt: -1 });
export const VerificationRequest = model('VerificationRequest', verificationRequestSchema);
