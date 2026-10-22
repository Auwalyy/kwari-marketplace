import type { Model, Types } from 'mongoose';
import { Job } from '../jobs/job.model';
import { AuditLog } from '../modules/admin/admin.models';
import { RefreshToken, UserSession, VerificationCode } from '../modules/auth/auth.models';
import { Conversation, ConversationParticipant, Message } from '../modules/chats/chat.models';
import { Delivery } from '../modules/deliveries/delivery.model';
import { recountHouseShops } from '../modules/houses/house.service';
import { HouseInvitation, ShopInvitation } from '../modules/invitations/invitation.models';
import { House, HouseMembership, HouseStaff, MarketSection } from '../modules/markets/market.models';
import { DeviceToken, Notification } from '../modules/notifications/notification.models';
import { Cart, CheckoutSession, Order, Quotation } from '../modules/orders/order.models';
import { Payment, Refund } from '../modules/payments/payment.models';
import { Favorite, InventoryMovement, Product, RecentlyViewed, SearchHistory } from '../modules/products/product.models';
import { Promotion, SubscriptionEntitlement } from '../modules/promotions/promotion.models';
import { Block, Report, VerificationRequest } from '../modules/reports/trust.models';
import { Review } from '../modules/reviews/review.model';
import { Shop, ShopMembership } from '../modules/shops/shop.models';
import { Address, User } from '../modules/users/user.model';
import { ProductEmbedding, VisualSearchCache } from '../modules/visual-search/embedding.model';
import { storage } from '../services/storage';

/** Every demo account uses this email domain (.test addresses can never receive real mail). */
export const DEMO_EMAIL_DOMAIN = 'demo.kantinkwari.test';
export const DEMO_EMAIL = /@demo\.kantinkwari\.test$/i;
/** Seeded houses carry this marker at the end of their address description. */
export const DEMO_HOUSE_MARKER = '(sample data)';
export const DEMO_SECTIONS: [code: string, name: string][] = [
  ['A', 'Section A — Main Gate'],
  ['B', 'Section B — Lace Row'],
  ['C', 'Section C — Brocade Lane'],
];

type Ids = Types.ObjectId[];
// The cleanup works across many collections with different document types; it only builds filters.
type AnyModel = Model<any>;

export interface DemoRemovalSummary {
  deleted: Record<string, number>;
  cartsCleaned: number;
  housesKept: number;
  filesDeleted: number;
}

/**
 * Removes everything the demo seed created, and everything that only exists because of it: demo
 * accounts and their sessions, demo shops with their products, images and search data, and orders,
 * chats, reviews and reports involving them, including ones real customers made with demo shops.
 *
 * Real data is protected:
 * - Real customers' carts only lose the demo items.
 * - A demo house or section is deleted only when no real shop or house still uses it.
 *   Otherwise it is kept and its demo head is removed.
 * - The market and categories are never touched.
 *
 * With `dryRun`, nothing is changed and the summary shows what would be removed.
 */
export async function removeDemoData({ dryRun = false } = {}): Promise<DemoRemovalSummary> {
  const ids = async (model: AnyModel, filter: object): Promise<Ids> => (await model.find(filter).select('_id').lean()).map((d) => d._id as Types.ObjectId);

  const users = await ids(User, { email: DEMO_EMAIL });
  const shops = await ids(Shop, { ownerId: { $in: users } });
  const products = await ids(Product, { shopId: { $in: shops } });
  const orders = await ids(Order, { $or: [{ shopId: { $in: shops } }, { customerId: { $in: users } }] });
  const conversations = await ids(Conversation, { $or: [{ shopId: { $in: shops } }, { customerId: { $in: users } }] });
  const payments = await ids(Payment, { $or: [{ orderId: { $in: orders } }, { shopId: { $in: shops } }, { customerId: { $in: users } }] });
  const sessions = await ids(UserSession, { userId: { $in: users } });
  const targets = [...users, ...shops, ...products];

  // Files to delete from storage, gathered before the records that point to them disappear.
  const files: string[] = [];
  for (const p of await Product.find({ _id: { $in: products } }).select('images').lean()) {
    for (const img of p.images ?? []) files.push(img.key, img.thumbnailKey);
  }
  for (const s of await Shop.find({ _id: { $in: shops } }).select('coverKey logoKey').lean()) files.push(...[s.coverKey, s.logoKey].filter((k): k is string => !!k));
  for (const m of await Message.find({ conversationId: { $in: conversations } }).select('imageKey').lean()) if (m.imageKey) files.push(m.imageKey);

  const plan: [string, AnyModel, object][] = [
    ['refresh tokens', RefreshToken, { $or: [{ userId: { $in: users } }, { sessionId: { $in: sessions } }] }],
    ['device tokens', DeviceToken, { $or: [{ userId: { $in: users } }, { sessionId: { $in: sessions } }] }],
    ['sessions', UserSession, { _id: { $in: sessions } }],
    ['verification codes', VerificationCode, { userId: { $in: users } }],
    ['addresses', Address, { userId: { $in: users } }],
    ['notifications', Notification, { userId: { $in: users } }],
    ['favourites', Favorite, { $or: [{ userId: { $in: users } }, { targetId: { $in: targets } }] }],
    ['recently viewed', RecentlyViewed, { $or: [{ userId: { $in: users } }, { productId: { $in: products } }] }],
    ['search history', SearchHistory, { userId: { $in: users } }],
    ['carts', Cart, { userId: { $in: users } }],
    ['checkout sessions', CheckoutSession, { userId: { $in: users } }],
    ['refunds', Refund, { $or: [{ orderId: { $in: orders } }, { paymentId: { $in: payments } }] }],
    ['payments', Payment, { _id: { $in: payments } }],
    ['deliveries', Delivery, { $or: [{ orderId: { $in: orders } }, { shopId: { $in: shops } }, { customerId: { $in: users } }] }],
    ['reviews', Review, { $or: [{ authorId: { $in: users } }, { shopId: { $in: shops } }, { productId: { $in: products } }, { orderId: { $in: orders } }] }],
    ['quotations', Quotation, { $or: [{ shopId: { $in: shops } }, { customerId: { $in: users } }, { conversationId: { $in: conversations } }] }],
    ['orders', Order, { _id: { $in: orders } }],
    ['messages', Message, { conversationId: { $in: conversations } }],
    ['chat participants', ConversationParticipant, { $or: [{ conversationId: { $in: conversations } }, { userId: { $in: users } }] }],
    ['conversations', Conversation, { _id: { $in: conversations } }],
    ['reports', Report, { $or: [{ reporterId: { $in: users } }, { targetId: { $in: targets } }, { shopId: { $in: shops } }] }],
    ['blocks', Block, { $or: [{ blockerId: { $in: [...users, ...shops] } }, { blockedId: { $in: [...users, ...shops] } }] }],
    ['verification requests', VerificationRequest, { $or: [{ requestedBy: { $in: users } }, { targetId: { $in: [...users, ...shops] } }] }],
    ['promotions', Promotion, { $or: [{ shopId: { $in: shops } }, { productId: { $in: products } }] }],
    ['subscriptions', SubscriptionEntitlement, { shopId: { $in: shops } }],
    ['image search data', ProductEmbedding, { $or: [{ shopId: { $in: shops } }, { productId: { $in: products } }] }],
    ['inventory movements', InventoryMovement, { $or: [{ shopId: { $in: shops } }, { productId: { $in: products } }] }],
    ['shop invitations', ShopInvitation, { shopId: { $in: shops } }],
    ['shop memberships', ShopMembership, { $or: [{ shopId: { $in: shops } }, { userId: { $in: users } }] }],
    ['house memberships', HouseMembership, { shopId: { $in: shops } }],
    ['house staff', HouseStaff, { userId: { $in: users } }],
    ['background jobs', Job, { 'payload.productId': { $in: products.map(String) } }],
    ['audit log entries', AuditLog, { actorId: { $in: users } }],
    ['products', Product, { _id: { $in: products } }],
    ['shops', Shop, { _id: { $in: shops } }],
    ['accounts', User, { _id: { $in: users } }],
  ];

  const deleted: Record<string, number> = {};
  for (const [label, model, filter] of plan) {
    const n = dryRun ? await model.countDocuments(filter) : (await model.deleteMany(filter)).deletedCount;
    if (n) deleted[label] = n;
  }

  // Real customers keep their carts; only demo items are taken out.
  const demoItem = { $or: [{ productId: { $in: products } }, { shopId: { $in: shops } }] };
  const cartsCleaned = dryRun
    ? await Cart.countDocuments({ items: { $elemMatch: demoItem } })
    : (await Cart.updateMany({ items: { $elemMatch: demoItem } }, { $pull: { items: demoItem } })).modifiedCount;
  if (!dryRun) await CheckoutSession.updateMany({ orderIds: { $in: orders } }, { $pull: { orderIds: { $in: orders } } });

  // Demo houses: delete when empty; when a real shop has joined, keep the house and drop the demo head.
  let housesKept = 0;
  const removedHouses: Ids = [];
  const houses = await House.find({ $or: [{ headUserId: { $in: users } }, { addressDescription: { $regex: `${escapeRegex(DEMO_HOUSE_MARKER)}$` } }] }).select('_id');
  for (const h of houses) {
    const inUse = await Shop.exists({ houseId: h._id, _id: { $nin: shops } });
    if (inUse) {
      housesKept++;
      if (!dryRun) {
        await House.updateOne({ _id: h._id, headUserId: { $in: users } }, { $set: { headUserId: null, headVerificationStatus: 'unverified' } });
        await HouseStaff.deleteMany({ houseId: h._id, userId: { $in: users } });
        await recountHouseShops(h._id);
      }
      continue;
    }
    deleted.houses = (deleted.houses ?? 0) + 1;
    removedHouses.push(h._id);
    if (!dryRun) {
      await Promise.all([HouseStaff.deleteMany({ houseId: h._id }), HouseInvitation.deleteMany({ houseId: h._id }), HouseMembership.deleteMany({ houseId: h._id })]);
      await House.deleteOne({ _id: h._id });
    }
  }

  // Demo sections go only when nothing real is filed under them.
  for (const [code, name] of DEMO_SECTIONS) {
    const section = await MarketSection.findOne({ code, name }).select('_id');
    if (!section) continue;
    const inUse =
      (await House.exists({ sectionId: section._id, _id: { $nin: removedHouses } })) ||
      (await Shop.exists({ sectionId: section._id, _id: { $nin: shops } })) ||
      (await User.exists({ managedSectionIds: section._id, _id: { $nin: users } }));
    if (inUse) continue;
    deleted.sections = (deleted.sections ?? 0) + 1;
    if (!dryRun) await MarketSection.deleteOne({ _id: section._id });
  }

  let filesDeleted = 0;
  if (!dryRun) {
    // Cached image-search results may still list demo products.
    await VisualSearchCache.deleteMany({});
    for (const key of files) {
      try {
        await storage().delete(key);
        filesDeleted++;
      } catch {
        // A file that is already gone is not a reason to stop the cleanup.
      }
    }
  } else {
    filesDeleted = files.length;
  }

  return { deleted, cartsCleaned, housesKept, filesDeleted };
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
