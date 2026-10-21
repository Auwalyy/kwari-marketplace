import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../utils/http';
import { logger } from '../config/logger';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: 'ROUTE_NOT_FOUND', message: `No route for ${req.method} ${req.path}`, requestId: req.requestId },
  });
}

/** Converts every error into the standard envelope. Internal details and stack traces are never sent. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong. Please try again.';
  let details: { path: string; message: string }[] | undefined;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    message = details[0]?.message ?? 'Invalid request';
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = `UPLOAD_${err.code}`;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large' : 'Invalid upload';
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'INVALID_ID';
    message = `Invalid value for ${err.path}`;
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    message = details[0]?.message ?? 'Invalid data';
  } else if (isDuplicateKey(err)) {
    status = 409;
    code = 'DUPLICATE';
    message = 'A record with these details already exists';
  } else if (isBodyParserError(err)) {
    status = err.status;
    code = err.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON';
    message = err.type === 'entity.too.large' ? 'Request body is too large' : 'Malformed JSON body';
  }

  if (status >= 500) logger.error({ err, requestId: req.requestId, path: req.path }, 'Unhandled error');
  else logger.debug({ code, path: req.path }, message);

  res.status(status).json({ success: false, error: { code, message, details, requestId: req.requestId } });
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

function isBodyParserError(err: unknown): err is { status: number; type: string } {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err && typeof (err as { status: unknown }).status === 'number';
}
