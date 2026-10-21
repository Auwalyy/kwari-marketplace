import type { Request } from 'express';
import type { ClientSession, Types } from 'mongoose';
import type { HouseInvitationDto, InvitationStatus, ShopPermission, WorkerInvitationDto } from '@kkdm/shared';
import { HouseInvitation, ShopInvitation } from './invitation.models';
import { AuditLog } from '../admin/admin.models';
import { env } from '../../config/env';
import { codePreview, formatCode, hashSecret, randomCode } from '../../utils/crypto';
import { AppError, badRequest, iso } from '../../utils/http';
import { audit } from '../../services/audit';

const CODE_LENGTH = 10;
const FAILED_ATTEMPT_WINDOW_MS = 15 * 60_000;
const MAX_FAILED_ATTEMPTS = 8;

const pepper = () => `invite:${env.JWT_REFRESH_SECRET}`;

export function hashInvitationCode(code: string) {
  return hashSecret(code.toUpperCase().replace(/[\s-]/g, ''), pepper());
}

export function newInvitationCode() {
  const code = randomCode(CODE_LENGTH);
  return { code, codeHash: hashInvitationCode(code), preview: codePreview(code), display: formatCode(code) };
}

export function effectiveStatus(inv: { status: string; expiresAt: Date; usedCount: number; maxUses: number }): InvitationStatus {
  if (inv.status === 'revoked') return 'revoked';
  if (inv.status === 'exhausted' || inv.usedCount >= inv.maxUses) return 'exhausted';
  if (inv.expiresAt <= new Date()) return 'expired';
  return 'active';
}

export function toHouseInvitationDto(inv: any, code?: string): HouseInvitationDto {
  return {
    id: String(inv._id),
    houseId: String(inv.houseId),
    codePreview: inv.codePreview,
    code: code ? formatCode(code) : undefined,
    status: effectiveStatus(inv),
    expiresAt: iso(inv.expiresAt)!,
    maxUses: inv.maxUses,
    usedCount: inv.usedCount,
    intendedShopName: inv.intendedShopName ?? undefined,
    intendedShopNumber: inv.intendedShopNumber ?? undefined,
    note: inv.note ?? undefined,
    createdAt: iso(inv.createdAt)!,
    revokedAt: iso(inv.revokedAt),
  };
}

export function toWorkerInvitationDto(inv: any, code?: string): WorkerInvitationDto {
  return {
    id: String(inv._id),
    shopId: String(inv.shopId),
    codePreview: inv.codePreview,
    code: code ? formatCode(code) : undefined,
    status: effectiveStatus(inv),
    permissions: inv.permissions as ShopPermission[],
    title: inv.title ?? undefined,
    expiresAt: iso(inv.expiresAt)!,
    maxUses: inv.maxUses,
    usedCount: inv.usedCount,
    createdAt: iso(inv.createdAt)!,
    revokedAt: iso(inv.revokedAt),
  };
}

/**
 * Brute-force guard: too many failed code attempts by the same user (or IP for anonymous callers)
 * within the window locks further attempts. Uses the audit log as the durable counter.
 */
export async function assertNotLockedOut(req: Request, kind: 'house' | 'worker') {
  const since = new Date(Date.now() - FAILED_ATTEMPT_WINDOW_MS);
  const filter: Record<string, unknown> = {
    action: `invitation.${kind}_redeem`,
    outcome: 'failure',
    createdAt: { $gt: since },
    ...(req.auth ? { actorId: req.auth.userId } : { ip: req.ip }),
  };
  const failures = await AuditLog.countDocuments(filter);
  if (failures >= MAX_FAILED_ATTEMPTS) {
    throw new AppError(429, 'TOO_MANY_CODE_ATTEMPTS', 'Too many invalid codes. Please wait 15 minutes before trying again.');
  }
}

export async function recordCodeFailure(req: Request, kind: 'house' | 'worker', reason: string, extra: Record<string, unknown> = {}) {
  await audit({ req, action: `invitation.${kind}_redeem`, category: 'invitation', outcome: 'failure', reason, metadata: extra });
}

const GENERIC_INVALID = 'This invitation code is not valid. Check the code and try again.';

/**
 * Explains why a found invitation cannot be used. Codes that do not exist get a generic message so the
 * endpoint cannot be used to probe for valid codes.
 */
export function unusableError(status: InvitationStatus) {
  switch (status) {
    case 'expired':
      return badRequest('This invitation code has expired. Ask for a new one.', 'INVITATION_EXPIRED');
    case 'revoked':
      return badRequest('This invitation code has been revoked.', 'INVITATION_REVOKED');
    case 'exhausted':
      return badRequest('This invitation code has already been used the maximum number of times.', 'INVITATION_EXHAUSTED');
    default:
      return badRequest(GENERIC_INVALID, 'INVITATION_INVALID');
  }
}

export async function findHouseInvitation(code: string) {
  return HouseInvitation.findOne({ codeHash: hashInvitationCode(code) });
}

export async function findWorkerInvitation(code: string) {
  return ShopInvitation.findOne({ codeHash: hashInvitationCode(code) });
}

export const invalidCodeError = () => badRequest(GENERIC_INVALID, 'INVITATION_INVALID');

type InvitationModel = typeof HouseInvitation | typeof ShopInvitation;

/**
 * Atomically consumes one use of an invitation. The guard (`status`, `expiresAt`, `usedCount < maxUses`)
 * is part of the update filter, so concurrent redemptions can never exceed `maxUses`.
 */
export async function consumeInvitation(
  model: InvitationModel,
  invitationId: Types.ObjectId,
  redemption: { userId: Types.ObjectId | string; shopId?: Types.ObjectId | string },
  session?: ClientSession,
) {
  const updated = await (model as typeof HouseInvitation).findOneAndUpdate(
    {
      _id: invitationId,
      status: 'active',
      expiresAt: { $gt: new Date() },
      $expr: { $lt: ['$usedCount', '$maxUses'] },
    },
    { $inc: { usedCount: 1 }, $push: { redemptions: { ...redemption, at: new Date() } } },
    { new: true, session },
  );
  if (!updated) return null;
  if (updated.usedCount >= updated.maxUses) {
    await (model as typeof HouseInvitation).updateOne({ _id: updated._id, status: 'active' }, { $set: { status: 'exhausted' } }, { session });
  }
  return updated;
}

/** Compensates a consumed use when the follow-up operation failed (used when transactions are unavailable). */
export async function releaseInvitationUse(model: InvitationModel, invitationId: Types.ObjectId, userId: Types.ObjectId | string) {
  await (model as typeof HouseInvitation).updateOne(
    { _id: invitationId, usedCount: { $gt: 0 } },
    { $inc: { usedCount: -1 }, $pull: { redemptions: { userId } } },
  );
  await (model as typeof HouseInvitation).updateOne(
    { _id: invitationId, status: 'exhausted', $expr: { $lt: ['$usedCount', '$maxUses'] } },
    { $set: { status: 'active' } },
  );
}
