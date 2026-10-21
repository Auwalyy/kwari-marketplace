import type { NextFunction, Request, Response } from 'express';
import type { PlatformRole } from '@kkdm/shared';
import { verifyAccessToken } from '../modules/auth/tokens';
import { User } from '../modules/users/user.model';
import { UserSession } from '../modules/auth/auth.models';
import { forbidden, unauthorized } from '../utils/http';
import type { AuthContext } from '../types/express';

function bearer(req: Request): string | null {
  const h = req.header('authorization');
  if (!h) return null;
  const [scheme, token] = h.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/**
 * Resolves an access token to an AuthContext. The user and session are re-checked on every request so
 * suspension, deletion, logout and "sign out everywhere" take effect immediately.
 */
export async function resolveAccessToken(token: string): Promise<AuthContext> {
  const claims = verifyAccessToken(token);
  const [user, session] = await Promise.all([
    User.findById(claims.sub).select('fullName status tokenVersion platformRoles managedMarketIds managedSectionIds').lean(),
    UserSession.findById(claims.sid).select('revokedAt expiresAt userId').lean(),
  ]);
  if (!user || user.status !== 'active') throw unauthorized('Account is not active', 'ACCOUNT_INACTIVE');
  if (user.tokenVersion !== claims.tv) throw unauthorized('Session expired. Please sign in again.', 'TOKEN_REVOKED');
  if (!session || session.revokedAt || String(session.userId) !== claims.sub || session.expiresAt <= new Date()) {
    throw unauthorized('Session has ended. Please sign in again.', 'SESSION_ENDED');
  }
  return {
    userId: String(user._id),
    sessionId: claims.sid,
    fullName: user.fullName,
    platformRoles: (user.platformRoles ?? []) as PlatformRole[],
    managedMarketIds: (user.managedMarketIds ?? []).map(String),
    managedSectionIds: (user.managedSectionIds ?? []).map(String),
  };
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) return next(unauthorized());
  req.auth = await resolveAccessToken(token);
  next();
}

/** Attaches auth when a valid token is present; guests continue anonymously. Invalid tokens still fail. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (token) req.auth = await resolveAccessToken(token);
  next();
}

export function requirePlatformRole(...roles: PlatformRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.some((r) => req.auth!.platformRoles.includes(r))) return next(forbidden());
    next();
  };
}

export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
