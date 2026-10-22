import { Router } from 'express';
import { objectId, promotionSchema } from '@kkdm/shared';
import { Promotion, SubscriptionEntitlement } from './promotion.models';
import { recordClick } from './promotion.service';
import { Product } from '../products/product.models';
import { authenticate, requireAuth } from '../../middleware/auth';
import { writeLimiter } from '../../middleware/rateLimit';
import { requireShopAccess } from '../../services/access';
import { audit } from '../../services/audit';
import { parse, paramId } from '../../utils/validate';
import { badRequest, iso, ok } from '../../utils/http';

export const promotionsRouter = Router();

export function toPromotionDto(p: any) {
  return {
    id: String(p._id),
    type: p.type,
    shopId: String(p.shopId),
    productId: p.productId ? String(p.productId) : null,
    keywords: p.keywords,
    startsAt: iso(p.startsAt),
    endsAt: iso(p.endsAt),
    status: p.status,
    billing: p.billing,
    note: p.note,
    reviewNote: p.reviewNote,
    impressions: p.impressions,
    clicks: p.clicks,
    createdAt: iso(p.createdAt),
  };
}

/**
 * Shop owners request a promotion; an administrator approves it. Paid promotion checkout is not live in
 * the MVP, so requests are recorded with billing "not_billed" and arranged manually.
 */
promotionsRouter.post('/', authenticate, writeLimiter, async (req, res) => {
  const a = requireAuth(req);
  const input = parse(promotionSchema, req.body);
  const { shop } = await requireShopAccess(a, input.shopId, 'owner');
  if (shop.status !== 'active') throw badRequest('Only approved shops can request promotions');
  if (input.endsAt <= input.startsAt) throw badRequest('End date must be after the start date');
  if (input.type !== 'featured_shop' && !input.productId) throw badRequest('Choose a product to promote');
  if (input.productId && !(await Product.exists({ _id: input.productId, shopId: shop._id, status: 'published' }))) throw badRequest('Choose a published product from your shop');
  if (input.type === 'sponsored_search' && !input.keywords.length) throw badRequest('Add at least one search keyword');
  const p = await Promotion.create({ ...input, requestedBy: a.userId, status: 'pending' });
  await audit({ req, action: 'promotion.requested', category: 'shop', targetType: 'promotion', targetId: p._id, shopId: shop._id });
  ok(res, toPromotionDto(p), 201);
});

promotionsRouter.get('/shop/:shopId', authenticate, async (req, res) => {
  const a = requireAuth(req);
  const { shop } = await requireShopAccess(a, paramId(req.params.shopId, 'shopId'), 'owner', { allowSuspended: true });
  const [promos, entitlements] = await Promise.all([
    Promotion.find({ shopId: shop._id }).sort({ createdAt: -1 }).limit(50).lean(),
    SubscriptionEntitlement.find({ shopId: shop._id }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  ok(res, {
    promotions: promos.map(toPromotionDto),
    plan: shop.subscriptionPlan,
    entitlements: entitlements.map((e) => ({ id: String(e._id), plan: e.plan, features: e.features, status: e.status, startsAt: iso(e.startsAt), endsAt: iso(e.endsAt) })),
    paymentsAvailable: false,
  });
});

promotionsRouter.post('/:id/click', async (req, res) => {
  const id = parse(objectId, req.params.id);
  await recordClick(id);
  ok(res, { recorded: true });
});
