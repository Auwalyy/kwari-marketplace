import { Router } from 'express';
import {
  changePasswordSchema,
  confirmVerificationSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  requestVerificationSchema,
  resetPasswordSchema,
} from '@kkdm/shared';
import * as auth from './auth.service';
import { revokeAllSessions, revokeSession, rotateRefreshToken } from './tokens';
import { UserSession } from './auth.models';
import { authenticate, requireAuth } from '../../middleware/auth';
import { authLimiter, otpLimiter } from '../../middleware/rateLimit';
import { parse, paramId } from '../../utils/validate';
import { iso, notFound, ok } from '../../utils/http';
import { audit } from '../../services/audit';
import { DeviceToken } from '../notifications/notification.models';

export const authRouter = Router();

authRouter.post('/register', authLimiter, async (req, res) => {
  const result = await auth.register(parse(registerSchema, req.body), req);
  ok(res, result, 201);
});

authRouter.post('/login', authLimiter, async (req, res) => {
  ok(res, await auth.login(parse(loginSchema, req.body), req));
});

authRouter.post('/refresh', authLimiter, async (req, res) => {
  const { refreshToken } = parse(refreshSchema, req.body);
  const { tokens } = await rotateRefreshToken(refreshToken, { ip: req.ip });
  ok(res, tokens);
});

authRouter.post('/logout', authenticate, async (req, res) => {
  const a = requireAuth(req);
  await revokeSession(a.sessionId, 'logout');
  await DeviceToken.updateMany({ sessionId: a.sessionId }, { $set: { active: false } });
  await audit({ req, action: 'auth.logout', category: 'auth' });
  ok(res, { loggedOut: true });
});

authRouter.post('/logout-all', authenticate, async (req, res) => {
  const a = requireAuth(req);
  await revokeAllSessions(a.userId, 'logout_all');
  await DeviceToken.updateMany({ userId: a.userId }, { $set: { active: false } });
  await audit({ req, action: 'auth.logout_all', category: 'auth' });
  ok(res, { loggedOut: true });
});

authRouter.post('/verification/request', authenticate, otpLimiter, async (req, res) => {
  const { channel } = parse(requestVerificationSchema, req.body);
  await auth.requestVerification(requireAuth(req).userId, channel);
  ok(res, { sent: true });
});

authRouter.post('/verification/confirm', authenticate, otpLimiter, async (req, res) => {
  const { channel, code } = parse(confirmVerificationSchema, req.body);
  await auth.confirmVerification(requireAuth(req).userId, channel, code, req);
  ok(res, { verified: true });
});

authRouter.post('/password/forgot', otpLimiter, async (req, res) => {
  const { identifier } = parse(forgotPasswordSchema, req.body);
  await auth.forgotPassword(identifier, req);
  ok(res, { message: 'If an account matches, a reset code has been sent.' });
});

authRouter.post('/password/reset', otpLimiter, async (req, res) => {
  const input = parse(resetPasswordSchema, req.body);
  await auth.resetPassword(input.identifier, input.code, input.newPassword, req);
  ok(res, { reset: true });
});

authRouter.post('/password/change', authenticate, authLimiter, async (req, res) => {
  const input = parse(changePasswordSchema, req.body);
  const tokens = await auth.changePassword(requireAuth(req).userId, input.currentPassword, input.newPassword, req);
  ok(res, tokens);
});

authRouter.get('/sessions', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const sessions = await UserSession.find({ userId: a.userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .limit(50)
    .lean();
  ok(
    res,
    sessions.map((s) => ({
      id: String(s._id),
      deviceName: s.deviceName ?? null,
      userAgent: s.userAgent ?? null,
      ip: s.ip ?? null,
      createdAt: iso(s.createdAt),
      lastUsedAt: iso(s.lastUsedAt),
      current: String(s._id) === a.sessionId,
    })),
  );
});

authRouter.delete('/sessions/:id', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const id = paramId(req.params.id);
  const session = await UserSession.findOne({ _id: id, userId: a.userId });
  if (!session) throw notFound('Session');
  await revokeSession(session._id, 'user_revoked');
  await DeviceToken.updateMany({ sessionId: session._id }, { $set: { active: false } });
  await audit({ req, action: 'auth.session_revoked', category: 'auth', targetType: 'session', targetId: session._id });
  ok(res, { revoked: true });
});
