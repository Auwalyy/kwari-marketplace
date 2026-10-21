import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AuditLog, type AuditLogAttrs } from '../modules/admin/admin.models';
import { logger } from '../config/logger';

type Id = Types.ObjectId | string | null | undefined;

export interface AuditEntry {
  req?: Request;
  actorId?: Id;
  actorRole?: string;
  action: string;
  category: AuditLogAttrs['category'];
  targetType?: string;
  targetId?: Id;
  marketId?: Id;
  houseId?: Id;
  shopId?: Id;
  outcome?: 'success' | 'failure';
  reason?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

/**
 * Writes an audit record. Failures to audit are logged but never break the calling operation; callers
 * that must be atomic with their audit entry should write AuditLog inside their own transaction.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await AuditLog.create({
      actorId: entry.actorId ?? entry.req?.auth?.userId ?? null,
      actorRole: entry.actorRole,
      action: entry.action,
      category: entry.category,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      marketId: entry.marketId ?? null,
      houseId: entry.houseId ?? null,
      shopId: entry.shopId ?? null,
      outcome: entry.outcome ?? 'success',
      reason: entry.reason,
      metadata: entry.metadata ?? {},
      ip: entry.ip ?? entry.req?.ip,
      requestId: entry.req?.requestId,
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write audit log');
  }
}
