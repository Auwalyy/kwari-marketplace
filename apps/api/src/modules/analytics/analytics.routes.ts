import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { BUSINESS_TIMEZONE, type ShopAnalyticsDto } from '@kkdm/shared';
import { Order, Quotation } from '../orders/order.models';
import { Payment } from '../payments/payment.models';
import { Product, Favorite, RecentlyViewed } from '../products/product.models';
import { Conversation } from '../chats/chat.models';
import { Review } from '../reviews/review.model';
import { ShopMembership } from '../shops/shop.models';
import { AuditLog } from '../admin/admin.models';
import { User, Address } from '../users/user.model';
import { toReviewDtos } from '../reviews/reviews.routes';
import { toOrderDtos } from '../orders/order.service';
import { toProductSummaries } from '../products/product.service';
import { authenticate, requireAuth } from '../../middleware/auth';
import { requireShopAccess } from '../../services/access';
import { parse, paramId } from '../../utils/validate';
import { forbidden, ok } from '../../utils/http';

export const analyticsRouter = Router();
analyticsRouter.use(authenticate);

const DEMAND_STATUSES = ['pending_acceptance', 'accepted', 'processing', 'ready', 'dispatched', 'delivered', 'completed', 'disputed'];
const COMPLETED_STATUSES = ['delivered', 'completed'];

/**
 * Shop analytics from stored orders and payments. Three money figures are deliberately separate:
 * order value (demand), completed sales (fulfilled), and payments split into gateway-verified and
 * seller-confirmed.
 */
analyticsRouter.get('/shops/:shopId', async (req, res) => {
  const a = requireAuth(req);
  const access = await requireShopAccess(a, paramId(req.params.shopId, 'shopId'), 'any', { allowSuspended: true });
  if (!access.isOwner && !access.permissions.includes('reports.view')) throw forbidden('Your role does not include sales reports', 'MISSING_SHOP_PERMISSION');
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
  const shopId = access.shop._id;
  const since = new Date(Date.now() - days * 86_400_000);
  const range = { shopId, createdAt: { $gte: since } };

  const [statusCounts, money, payments, bestSellers, alerts, pendingQuotes, openConversations, reviews, trend] = await Promise.all([
    Order.aggregate([{ $match: range }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Order.aggregate([
      { $match: range },
      {
        $group: {
          _id: null,
          orderValue: { $sum: { $cond: [{ $in: ['$status', DEMAND_STATUSES] }, '$totalKobo', 0] } },
          completed: { $sum: { $cond: [{ $in: ['$status', COMPLETED_STATUSES] }, '$totalKobo', 0] } },
        },
      },
    ]),
    Payment.aggregate([{ $match: { shopId, createdAt: { $gte: since }, status: { $in: ['paid', 'seller_confirmed'] } } }, { $group: { _id: '$status', total: { $sum: '$amountKobo' } } }]),
    Order.aggregate([
      { $match: { ...range, status: { $in: COMPLETED_STATUSES } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.productId', name: { $first: '$items.productName' }, quantity: { $sum: '$items.quantity' }, value: { $sum: '$items.lineTotalKobo' } } },
      { $sort: { value: -1 } },
      { $limit: 5 },
    ]),
    Product.find({ shopId, status: 'published', trackInventory: true, stockStatus: { $in: ['low_stock', 'out_of_stock'] } }).select('name stockQuantity stockStatus').sort({ stockQuantity: 1 }).limit(20).lean(),
    Quotation.countDocuments({ shopId, status: { $in: ['requested', 'countered'] } }),
    Conversation.countDocuments({ shopId, shopUnread: { $gt: 0 } }),
    Review.find({ shopId, status: 'published' }).sort({ createdAt: -1 }).limit(5).lean(),
    Order.aggregate([
      { $match: range },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: BUSINESS_TIMEZONE } },
          orders: { $sum: 1 },
          orderValue: { $sum: { $cond: [{ $in: ['$status', DEMAND_STATUSES] }, '$totalKobo', 0] } },
          completed: { $sum: { $cond: [{ $in: ['$status', COMPLETED_STATUSES] }, '$totalKobo', 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  let workerActivity: ShopAnalyticsDto['workerActivity'];
  if (access.isOwner) {
    const members = await ShopMembership.find({ shopId, status: 'active', role: 'worker' }).lean();
    const counts = await AuditLog.aggregate([{ $match: { shopId, createdAt: { $gte: since }, actorId: { $in: members.map((m) => m.userId) } } }, { $group: { _id: '$actorId', n: { $sum: 1 } } }]);
    const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).select('fullName').lean();
    workerActivity = members.map((m) => ({
      userId: String(m.userId),
      fullName: users.find((u) => String(u._id) === String(m.userId))?.fullName ?? '',
      actions: counts.find((c) => String(c._id) === String(m.userId))?.n ?? 0,
    }));
  }

  const dto: ShopAnalyticsDto & { days: number } = {
    days,
    orderCounts: Object.fromEntries(statusCounts.map((s) => [s._id, s.n])),
    orderValueKobo: money[0]?.orderValue ?? 0,
    completedSalesKobo: money[0]?.completed ?? 0,
    gatewayVerifiedKobo: payments.find((p) => p._id === 'paid')?.total ?? 0,
    sellerConfirmedKobo: payments.find((p) => p._id === 'seller_confirmed')?.total ?? 0,
    bestSellers: bestSellers.map((b) => ({ productId: String(b._id), name: b.name, quantity: b.quantity, valueKobo: b.value })),
    inventoryAlerts: alerts.map((p) => ({ productId: String(p._id), name: p.name, stockQuantity: p.stockQuantity, stockStatus: p.stockStatus })),
    pendingQuotations: pendingQuotes,
    openConversations,
    recentReviews: await toReviewDtos(reviews),
    salesTrend: trend.map((t) => ({ date: t._id, orders: t.orders, orderValueKobo: t.orderValue, completedSalesKobo: t.completed })),
    workerActivity,
  };
  ok(res, dto);
});

/** Customer dashboard: recent orders, favourites, recently viewed, conversations, saved addresses. */
analyticsRouter.get('/me', async (req, res) => {
  const a = requireAuth(req);
  const uid = new Types.ObjectId(a.userId);
  const [orders, statusCounts, favShops, favProducts, views, conversations, addresses] = await Promise.all([
    Order.find({ customerId: uid }).sort({ createdAt: -1 }).limit(5).lean(),
    Order.aggregate([{ $match: { customerId: uid } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Favorite.countDocuments({ userId: uid, targetType: 'shop' }),
    Favorite.countDocuments({ userId: uid, targetType: 'product' }),
    RecentlyViewed.find({ userId: uid }).sort({ viewedAt: -1 }).limit(6).lean(),
    Conversation.find({ customerId: uid }).sort({ lastMessageAt: -1 }).limit(5).select('shopId customerUnread lastMessage lastMessageAt').lean(),
    Address.countDocuments({ userId: uid, deletedAt: null }),
  ]);
  const viewed = await Product.find({ _id: { $in: views.map((v) => v.productId) }, status: 'published', shopListed: true }).lean();
  ok(res, {
    recentOrders: await toOrderDtos(orders, 'customer'),
    orderStatusCounts: Object.fromEntries(statusCounts.map((s) => [s._id, s.n])),
    favouriteShops: favShops,
    favouriteProducts: favProducts,
    recentlyViewed: await toProductSummaries(viewed as any),
    unreadConversations: conversations.filter((c) => c.customerUnread > 0).length,
    savedAddresses: addresses,
  });
});
