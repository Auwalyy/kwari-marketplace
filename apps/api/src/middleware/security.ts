import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { badRequest } from '../utils/http';

/** Rejects request bodies / queries containing Mongo operator keys (`$where`, `a.b`) at any depth. */
export function rejectOperatorKeys(req: Request, _res: Response, next: NextFunction) {
  const bad = findOperatorKey(req.body) ?? findOperatorKey(req.query);
  if (bad) return next(badRequest(`Illegal field name "${bad}"`, 'ILLEGAL_FIELD'));
  next();
}

function findOperatorKey(value: unknown, depth = 0): string | null {
  if (depth > 12 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const r = findOperatorKey(v, depth + 1);
      if (r) return r;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor') return k;
    const r = findOperatorKey(v, depth + 1);
    if (r) return r;
  }
  return null;
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
