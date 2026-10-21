import { Types } from 'mongoose';
import type { PromotionType } from '@kkdm/shared';
import { Promotion } from './promotion.models';

/** Currently running, approved promotions of a type. */
export async function activePromotions(type: PromotionType, opts: { keywords?: string[]; limit?: number } = {}) {
  const now = new Date();
  const filter: Record<string, unknown> = { type, status: { $in: ['approved', 'active'] }, startsAt: { $lte: now }, endsAt: { $gt: now } };
  if (opts.keywords?.length) filter.keywords = { $in: opts.keywords };
  return Promotion.find(filter).sort({ startsAt: 1 }).limit(opts.limit ?? 10).lean();
}

/** Records real impressions for promotions that were actually served. */
export async function recordImpressions(ids: (Types.ObjectId | string)[]) {
  if (ids.length) await Promotion.updateMany({ _id: { $in: ids } }, { $inc: { impressions: 1 } });
}

export async function recordClick(id: string) {
  await Promotion.updateOne({ _id: id }, { $inc: { clicks: 1 } });
}
