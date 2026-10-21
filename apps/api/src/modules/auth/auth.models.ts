import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * A login session on one device. Refresh tokens rotate within a session; presenting an already-rotated
 * token is treated as theft and revokes the entire session.
 */
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceName: { type: String, maxlength: 80 },
    userAgent: { type: String, maxlength: 300 },
    ip: { type: String, maxlength: 64 },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokeReason: { type: String },
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
export type SessionDoc = HydratedDocument<InferSchemaType<typeof sessionSchema>>;
export const UserSession = model('UserSession', sessionSchema);

const refreshTokenSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'UserSession', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** HMAC of the opaque token; the token itself is never stored. */
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    rotatedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });
export const RefreshToken = model('RefreshToken', refreshTokenSchema);

const verificationCodeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: ['verify_email', 'verify_phone', 'password_reset'], required: true },
    target: { type: String, required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
verificationCodeSchema.index({ userId: 1, purpose: 1, createdAt: -1 });
verificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });
export const VerificationCode = model('VerificationCode', verificationCodeSchema);
