import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { HOUSE_MEMBERSHIP_STATUSES, VERIFICATION_STATUSES } from '@kkdm/shared';

const geo = { lat: { type: Number }, lng: { type: Number } };

const marketSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: String,
    region: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String, default: 'NG' },
    usesSections: { type: Boolean, default: true },
    location: { type: geo, default: undefined },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export type MarketDoc = HydratedDocument<InferSchemaType<typeof marketSchema>>;
export const Market = model('Market', marketSchema);

const sectionSchema = new Schema(
  {
    marketId: { type: Schema.Types.ObjectId, ref: 'Market', required: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    description: String,
    locationDescription: String,
    location: { type: geo, default: undefined },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true },
);
sectionSchema.index({ marketId: 1, code: 1 }, { unique: true });
export type SectionDoc = HydratedDocument<InferSchemaType<typeof sectionSchema>>;
export const MarketSection = model('MarketSection', sectionSchema);

const houseSchema = new Schema(
  {
    marketId: { type: Schema.Types.ObjectId, ref: 'Market', required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'MarketSection', default: null },
    houseNumber: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: String,
    addressDescription: { type: String, required: true },
    location: { type: geo, default: undefined },
    contactPhone: String,
    contactEmail: String,
    headUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** Verification of the house record itself (it exists, number/location correct). */
    verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'unverified' },
    /** Verification that headUserId is the legitimate house head. Required to create invitations. */
    headVerificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'unverified' },
    /** Admin-enabled: valid invitation codes complete membership without manual approval. */
    autoApproveMemberships: { type: Boolean, default: false },
    /** Admin-enabled: the head may appoint assistants. */
    allowAssistants: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    shopCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
houseSchema.index({ marketId: 1, houseNumber: 1 }, { unique: true });
houseSchema.index({ sectionId: 1, houseNumber: 1 });
houseSchema.index({ headUserId: 1 });
houseSchema.index({ name: 'text', houseNumber: 'text', addressDescription: 'text' });
export type HouseDoc = HydratedDocument<InferSchemaType<typeof houseSchema>>;
export const House = model('House', houseSchema);

/** House management roles (head and admin-permitted assistants), with history retained. */
const houseStaffSchema = new Schema(
  {
    houseId: { type: Schema.Types.ObjectId, ref: 'House', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['head', 'assistant'], required: true },
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revokedAt: Date,
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: String,
  },
  { timestamps: true },
);
houseStaffSchema.index({ houseId: 1, userId: 1, status: 1 });
houseStaffSchema.index({ userId: 1, status: 1 });
houseStaffSchema.index(
  { houseId: 1, role: 1 },
  { unique: true, partialFilterExpression: { role: 'head', status: 'active' } },
);
export const HouseStaff = model('HouseStaff', houseStaffSchema);

/**
 * Association between a shop and a house. Records are never deleted; each change of state appends to
 * `history` so ownership/location moves keep an audit trail.
 */
const houseMembershipSchema = new Schema(
  {
    houseId: { type: Schema.Types.ObjectId, ref: 'House', required: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    invitationId: { type: Schema.Types.ObjectId, ref: 'HouseInvitation', default: null },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: HOUSE_MEMBERSHIP_STATUSES, default: 'pending' },
    /** true while pending/approved; enforces at most one live membership per shop. */
    live: { type: Boolean, default: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    reason: String,
    dispute: {
      openedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      openedAt: Date,
      statement: String,
      response: String,
      respondedAt: Date,
      status: { type: String, enum: ['open', 'responded', 'resolved'] },
      resolution: String,
    },
    history: [
      {
        status: String,
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        reason: String,
        at: { type: Date, default: Date.now },
        _id: false,
      },
    ],
  },
  { timestamps: true },
);
houseMembershipSchema.index({ shopId: 1 }, { unique: true, partialFilterExpression: { live: true } });
houseMembershipSchema.index({ houseId: 1, status: 1, createdAt: -1 });
export type HouseMembershipDoc = HydratedDocument<InferSchemaType<typeof houseMembershipSchema>>;
export const HouseMembership = model('HouseMembership', houseMembershipSchema);
