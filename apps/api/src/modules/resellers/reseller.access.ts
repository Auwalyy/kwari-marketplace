import type { Types } from 'mongoose';
import { Reseller } from './reseller.models';

/** The approved reseller account for a user, or null. Reseller prices are only ever shown or charged to these. */
export async function approvedReseller(userId: string | Types.ObjectId | undefined | null) {
  if (!userId) return null;
  return Reseller.findOne({ userId, status: 'approved' }).lean();
}
