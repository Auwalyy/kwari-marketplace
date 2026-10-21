import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import type { AuthTokens } from '@kkdm/shared';
import { env } from '../../config/env';
import { hashSecret, randomToken } from '../../utils/crypto';
import { unauthorized } from '../../utils/http';
import { RefreshToken, UserSession } from './auth.models';
import { User } from '../users/user.model';
import { audit } from '../../services/audit';

interface AccessClaims {
  sub: string;
  sid: string;
  tv: number;
  typ: 'access';
}

const accessSecret = () => env.JWT_ACCESS_SECRET!;
const refreshPepper = () => env.JWT_REFRESH_SECRET!;

export function signAccessToken(userId: string, sessionId: string, tokenVersion: number) {
  const expiresAt = new Date(Date.now() + env.ACCESS_TOKEN_TTL * 1000);
  const token = jwt.sign({ sid: sessionId, tv: tokenVersion, typ: 'access' }, accessSecret(), {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL,
    algorithm: 'HS256',
    issuer: 'kkdm-api',
  });
  return { token, expiresAt };
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const claims = jwt.verify(token, accessSecret(), { algorithms: ['HS256'], issuer: 'kkdm-api' }) as jwt.JwtPayload;
    if (claims.typ !== 'access' || !claims.sub || !claims.sid) throw new Error('bad claims');
    return { sub: claims.sub, sid: String(claims.sid), tv: Number(claims.tv ?? 0), typ: 'access' };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw unauthorized('Access token expired', 'TOKEN_EXPIRED');
    throw unauthorized('Invalid access token', 'INVALID_TOKEN');
  }
}

async function issueRefreshToken(sessionId: Types.ObjectId, userId: Types.ObjectId, expiresAt: Date) {
  const token = randomToken(48);
  await RefreshToken.create({ sessionId, userId, tokenHash: hashSecret(token, refreshPepper()), expiresAt });
  return token;
}

export async function createSession(
  user: { _id: Types.ObjectId; tokenVersion: number },
  meta: { deviceName?: string; userAgent?: string; ip?: string },
): Promise<{ tokens: AuthTokens; sessionId: string }> {
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000);
  const session = await UserSession.create({
    userId: user._id,
    deviceName: meta.deviceName?.slice(0, 80),
    userAgent: meta.userAgent?.slice(0, 300),
    ip: meta.ip,
    expiresAt,
  });
  const refreshToken = await issueRefreshToken(session._id, user._id, expiresAt);
  const access = signAccessToken(String(user._id), String(session._id), user.tokenVersion);
  return {
    sessionId: String(session._id),
    tokens: { accessToken: access.token, refreshToken, accessTokenExpiresAt: access.expiresAt.toISOString() },
  };
}

/**
 * Rotates a refresh token. Each token can be used exactly once; reuse of a rotated token indicates
 * theft, so the whole session is revoked and the event audited.
 */
export async function rotateRefreshToken(presented: string, meta: { ip?: string }): Promise<{ tokens: AuthTokens; userId: string }> {
  const tokenHash = hashSecret(presented, refreshPepper());
  const now = new Date();
  // Atomically mark the token as rotated so two concurrent refreshes cannot both succeed.
  const record = await RefreshToken.findOneAndUpdate(
    { tokenHash, rotatedAt: null, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { rotatedAt: now } },
    { new: true },
  );

  if (!record) {
    const existing = await RefreshToken.findOne({ tokenHash });
    if (existing && existing.rotatedAt) {
      await revokeSession(existing.sessionId, 'refresh_token_reuse');
      await audit({
        actorId: existing.userId,
        action: 'auth.refresh_reuse_detected',
        category: 'auth',
        outcome: 'failure',
        targetType: 'session',
        targetId: existing.sessionId,
        ip: meta.ip,
      });
      throw unauthorized('Session revoked for security reasons. Please sign in again.', 'REFRESH_TOKEN_REUSED');
    }
    throw unauthorized('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
  }

  const session = await UserSession.findById(record.sessionId);
  if (!session || session.revokedAt || session.expiresAt <= now) throw unauthorized('Session has ended', 'SESSION_ENDED');
  const user = await User.findById(record.userId).select('status tokenVersion');
  if (!user || user.status !== 'active') {
    await revokeSession(session._id, 'account_inactive');
    throw unauthorized('Account is not active', 'ACCOUNT_INACTIVE');
  }

  session.lastUsedAt = now;
  if (meta.ip) session.ip = meta.ip;
  await session.save();
  const refreshToken = await issueRefreshToken(session._id, user._id, session.expiresAt);
  const access = signAccessToken(String(user._id), String(session._id), user.tokenVersion);
  return {
    userId: String(user._id),
    tokens: { accessToken: access.token, refreshToken, accessTokenExpiresAt: access.expiresAt.toISOString() },
  };
}

export async function revokeSession(sessionId: Types.ObjectId | string, reason: string) {
  const now = new Date();
  await UserSession.updateOne({ _id: sessionId, revokedAt: null }, { $set: { revokedAt: now, revokeReason: reason } });
  await RefreshToken.updateMany({ sessionId, revokedAt: null }, { $set: { revokedAt: now } });
}

/** Revokes every session and invalidates all outstanding access tokens for a user. */
export async function revokeAllSessions(userId: Types.ObjectId | string, reason: string) {
  const now = new Date();
  await UserSession.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now, revokeReason: reason } });
  await RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now } });
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
}
