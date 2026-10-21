import type { Request } from 'express';
import { normalizePhone, type AuthResponse, type LoginInput, type RegisterInput } from '@kkdm/shared';
import { User, type UserDoc } from '../users/user.model';
import { VerificationCode } from './auth.models';
import { hashPassword, verifyPassword, getDummyHash } from './password';
import { createSession, revokeAllSessions } from './tokens';
import { buildMe } from '../users/user.service';
import { audit } from '../../services/audit';
import { sendCode } from '../../services/verificationSender';
import { env } from '../../config/env';
import { hashSecret, randomDigits } from '../../utils/crypto';
import { AppError, badRequest, conflict, unauthorized } from '../../utils/http';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;

const codePepper = () => env.JWT_REFRESH_SECRET!;

function sessionMeta(req: Request, deviceName?: string) {
  return { deviceName: deviceName ?? req.header('x-device-name') ?? undefined, userAgent: req.header('user-agent'), ip: req.ip };
}

export async function findUserByIdentifier(identifier: string) {
  const trimmed = identifier.trim();
  if (trimmed.includes('@')) return User.findOne({ email: trimmed.toLowerCase() }).select('+passwordHash');
  const phone = normalizePhone(trimmed);
  if (!phone) return null;
  return User.findOne({ phone }).select('+passwordHash');
}

export async function register(input: RegisterInput, req: Request): Promise<AuthResponse> {
  if (input.email && (await User.exists({ email: input.email }))) {
    throw conflict('An account with this email already exists', 'EMAIL_TAKEN');
  }
  if (input.phone && (await User.exists({ phone: input.phone }))) {
    throw conflict('An account with this phone number already exists', 'PHONE_TAKEN');
  }
  const user = await User.create({
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    passwordHash: await hashPassword(input.password),
  });
  const { tokens } = await createSession(user, sessionMeta(req));
  await audit({ req, actorId: user._id, action: 'auth.register', category: 'auth', targetType: 'user', targetId: user._id });
  // Send verification codes for the supplied channels; failures don't block registration.
  if (user.email) await issueCode(user, 'verify_email', user.email).catch(() => undefined);
  if (user.phone) await issueCode(user, 'verify_phone', user.phone).catch(() => undefined);
  return { user: await buildMe(String(user._id)), tokens };
}

export async function login(input: LoginInput, req: Request): Promise<AuthResponse> {
  const user = await findUserByIdentifier(input.identifier);
  const invalid = () => unauthorized('Incorrect email/phone or password', 'INVALID_CREDENTIALS');

  if (!user) {
    await verifyPassword(await getDummyHash(), input.password);
    await audit({ req, action: 'auth.login', category: 'auth', outcome: 'failure', reason: 'unknown_identifier' });
    throw invalid();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes or reset your password.');
  }
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    const failed = (user.failedLoginCount ?? 0) + 1;
    await User.updateOne(
      { _id: user._id },
      failed >= MAX_FAILED_LOGINS
        ? { $set: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } }
        : { $set: { failedLoginCount: failed } },
    );
    await audit({ req, actorId: user._id, action: 'auth.login', category: 'auth', outcome: 'failure', reason: 'bad_password' });
    throw invalid();
  }
  if (user.status === 'suspended') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.');
  if (user.status !== 'active') throw invalid();

  await User.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const { tokens } = await createSession(user, sessionMeta(req, input.deviceName));
  await audit({ req, actorId: user._id, action: 'auth.login', category: 'auth' });
  return { user: await buildMe(String(user._id)), tokens };
}

type Purpose = 'verify_email' | 'verify_phone' | 'password_reset';

export async function issueCode(user: UserDoc, purpose: Purpose, target: string) {
  // Throttle: at most one code per minute per purpose.
  const recent = await VerificationCode.findOne({ userId: user._id, purpose, createdAt: { $gt: new Date(Date.now() - 60_000) } });
  if (recent) throw new AppError(429, 'CODE_RECENTLY_SENT', 'A code was sent recently. Please wait a minute before requesting another.');
  const code = randomDigits(6);
  await VerificationCode.updateMany({ userId: user._id, purpose, consumedAt: null }, { $set: { consumedAt: new Date() } });
  await VerificationCode.create({
    userId: user._id,
    purpose,
    target,
    codeHash: hashSecret(code, codePepper()),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  await sendCode(target.includes('@') ? 'email' : 'phone', target, code, purpose);
}

/** Checks a code; attempts are limited per code to stop guessing. */
export async function consumeCode(userId: unknown, purpose: Purpose, code: string, target: string) {
  const record = await VerificationCode.findOne({ userId, purpose, consumedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
  if (!record || record.target !== target) throw badRequest('The code is invalid or has expired', 'INVALID_CODE');
  if (record.attempts >= MAX_CODE_ATTEMPTS) throw badRequest('Too many attempts. Request a new code.', 'CODE_ATTEMPTS_EXCEEDED');
  if (record.codeHash !== hashSecret(code, codePepper())) {
    await VerificationCode.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
    throw badRequest('The code is invalid or has expired', 'INVALID_CODE');
  }
  record.consumedAt = new Date();
  await record.save();
}

export async function requestVerification(userId: string, channel: 'email' | 'phone') {
  const user = await User.findById(userId);
  if (!user) throw unauthorized();
  const target = channel === 'email' ? user.email : user.phone;
  if (!target) throw badRequest(`Add a ${channel === 'email' ? 'email address' : 'phone number'} to your profile first`, 'NO_TARGET');
  if (channel === 'email' ? user.emailVerified : user.phoneVerified) throw badRequest('Already verified', 'ALREADY_VERIFIED');
  await issueCode(user, channel === 'email' ? 'verify_email' : 'verify_phone', target);
}

export async function confirmVerification(userId: string, channel: 'email' | 'phone', code: string, req: Request) {
  const user = await User.findById(userId);
  if (!user) throw unauthorized();
  const target = channel === 'email' ? user.email : user.phone;
  if (!target) throw badRequest('Nothing to verify', 'NO_TARGET');
  await consumeCode(user._id, channel === 'email' ? 'verify_email' : 'verify_phone', code, target);
  await User.updateOne({ _id: user._id }, { $set: channel === 'email' ? { emailVerified: true } : { phoneVerified: true } });
  await audit({ req, actorId: user._id, action: `auth.verify_${channel}`, category: 'auth' });
}

/** Always resolves the same way whether or not the account exists (prevents account enumeration). */
export async function forgotPassword(identifier: string, req: Request) {
  const user = await findUserByIdentifier(identifier);
  if (!user || user.status !== 'active') return;
  const target = identifier.includes('@') ? user.email : user.phone;
  if (!target) return;
  await issueCode(user, 'password_reset', target).catch((err) => {
    if (err instanceof AppError && err.code === 'CODE_RECENTLY_SENT') return;
    throw err;
  });
  await audit({ req, actorId: user._id, action: 'auth.password_reset_requested', category: 'auth' });
}

export async function resetPassword(identifier: string, code: string, newPassword: string, req: Request) {
  const user = await findUserByIdentifier(identifier);
  if (!user || user.status !== 'active') throw badRequest('The code is invalid or has expired', 'INVALID_CODE');
  const target = identifier.includes('@') ? user.email! : user.phone!;
  await consumeCode(user._id, 'password_reset', code, target);
  await User.updateOne(
    { _id: user._id },
    { $set: { passwordHash: await hashPassword(newPassword), failedLoginCount: 0, lockedUntil: null } },
  );
  await revokeAllSessions(user._id, 'password_reset');
  await audit({ req, actorId: user._id, action: 'auth.password_reset', category: 'auth' });
}

export async function changePassword(userId: string, current: string, next: string, req: Request) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw unauthorized();
  if (!(await verifyPassword(user.passwordHash, current))) throw badRequest('Current password is incorrect', 'INVALID_PASSWORD');
  user.passwordHash = await hashPassword(next);
  await user.save();
  // Sign out other devices; the caller receives a fresh session.
  await revokeAllSessions(user._id, 'password_changed');
  const fresh = await User.findById(userId);
  const { tokens } = await createSession(fresh!, sessionMeta(req));
  await audit({ req, actorId: user._id, action: 'auth.password_changed', category: 'auth' });
  return tokens;
}
