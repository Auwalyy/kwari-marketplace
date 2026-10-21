import { z, type ZodType } from 'zod';
import { objectId } from '@kkdm/shared';
import { badRequest } from './http';

/** Parses untrusted input with a zod schema, raising a 400 with field-level details on failure. */
export function parse<S extends ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest(details[0]?.message ?? 'Invalid request', 'VALIDATION_ERROR', details);
  }
  return result.data;
}

/** Validates a route parameter as an ObjectId string. */
export function paramId(value: unknown, name = 'id'): string {
  const r = objectId.safeParse(value);
  if (!r.success) throw badRequest(`Invalid ${name}`, 'VALIDATION_ERROR', [{ path: name, message: 'Invalid id' }]);
  return r.data;
}

/** Reads a parent-route parameter on a `mergeParams` router (Express typings omit inherited params). */
export function parentId(req: { params: unknown }, name: string): string {
  return paramId((req.params as Record<string, unknown>)[name], name);
}
