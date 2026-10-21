import { Router } from 'express';
import crypto from 'node:crypto';
import { addressSchema, addressUpdateSchema, deleteAccountSchema, notificationPreferencesSchema, updateProfileSchema } from '@kkdm/shared';
import { Address, User } from './user.model';
import { buildMe } from './user.service';
import { authenticate, requireAuth } from '../../middleware/auth';
import { imageUpload } from '../../middleware/upload';
import { uploadLimiter } from '../../middleware/rateLimit';
import { parse, paramId } from '../../utils/validate';
import { badRequest, conflict, notFound, ok } from '../../utils/http';
import { verifyPassword, hashPassword } from '../auth/password';
import { revokeAllSessions } from '../auth/tokens';
import { audit } from '../../services/audit';
import { processUploadedImage } from '../../services/images';
import { storage, storageKey } from '../../services/storage';
import { Shop, ShopMembership } from '../shops/shop.models';
import { HouseStaff } from '../markets/market.models';
import { DeviceToken } from '../notifications/notification.models';
import { Favorite, RecentlyViewed, SearchHistory } from '../products/product.models';
import { Cart } from '../orders/order.models';

export const usersRouter = Router();
usersRouter.use(authenticate);

usersRouter.get('/me', async (req, res) => {
  ok(res, await buildMe(requireAuth(req).userId));
});

usersRouter.patch('/me', async (req, res) => {
  const a = requireAuth(req);
  const input = parse(updateProfileSchema, req.body);
  const user = await User.findById(a.userId);
  if (!user) throw notFound('User');
  if (input.email && input.email !== user.email) {
    if (await User.exists({ email: input.email, _id: { $ne: user._id } })) throw conflict('Email already in use', 'EMAIL_TAKEN');
    user.email = input.email;
    user.emailVerified = false;
  }
  if (input.phone && input.phone !== user.phone) {
    if (await User.exists({ phone: input.phone, _id: { $ne: user._id } })) throw conflict('Phone number already in use', 'PHONE_TAKEN');
    user.phone = input.phone;
    user.phoneVerified = false;
  }
  if (input.fullName) user.fullName = input.fullName;
  if (input.avatarUrl === null) user.avatarUrl = null;
  await user.save();
  ok(res, await buildMe(a.userId));
});

usersRouter.post('/me/avatar', uploadLimiter, imageUpload.single('image'), async (req, res) => {
  const a = requireAuth(req);
  if (!req.file) throw badRequest('Attach an image in the "image" field');
  const img = await processUploadedImage(req.file.buffer, { maxDimension: 512, thumbnailSize: 256 });
  const key = storageKey('public', 'avatars', a.userId, `${crypto.randomUUID()}.webp`);
  await storage().put(key, img.thumbnail, img.contentType, 'public');
  await User.updateOne({ _id: a.userId }, { $set: { avatarUrl: storage().publicUrl(key) } });
  ok(res, await buildMe(a.userId));
});

usersRouter.patch('/me/notification-preferences', async (req, res) => {
  const a = requireAuth(req);
  const input = parse(notificationPreferencesSchema, req.body);
  const set: Record<string, unknown> = {};
  if (input.push !== undefined) set['notificationPreferences.push'] = input.push;
  for (const [group, enabled] of Object.entries(input.groups ?? {})) set[`notificationPreferences.groups.${group}`] = enabled;
  if (Object.keys(set).length) await User.updateOne({ _id: a.userId }, { $set: set });
  ok(res, await buildMe(a.userId));
});

/**
 * Account deletion: personal data is erased/anonymised, sessions revoked. Orders, reviews and audit
 * records are retained (as "Deleted user") for legal, tax and dispute purposes. Shop owners must close
 * or transfer their shops first so customers with open orders are not stranded.
 */
usersRouter.delete('/me', async (req, res) => {
  const a = requireAuth(req);
  const input = parse(deleteAccountSchema, req.body);
  const user = await User.findById(a.userId).select('+passwordHash');
  if (!user) throw notFound('User');
  if (!(await verifyPassword(user.passwordHash, input.password))) throw badRequest('Password is incorrect', 'INVALID_PASSWORD');
  const ownedShops = await Shop.countDocuments({ ownerId: user._id, status: { $in: ['active', 'pending_membership', 'suspended'] } });
  if (ownedShops > 0) {
    throw conflict('Close your shop or transfer ownership before deleting your account', 'OWNS_ACTIVE_SHOP');
  }
  await revokeAllSessions(user._id, 'account_deleted');
  await Promise.all([
    DeviceToken.updateMany({ userId: user._id }, { $set: { active: false } }),
    ShopMembership.updateMany({ userId: user._id, status: 'active' }, { $set: { status: 'revoked', revokedAt: new Date(), revokeReason: 'account_deleted' } }),
    HouseStaff.updateMany({ userId: user._id, status: 'active' }, { $set: { status: 'revoked', revokedAt: new Date(), reason: 'account_deleted' } }),
    Address.updateMany({ userId: user._id }, { $set: { deletedAt: new Date(), line1: '[deleted]', phone: '[deleted]', recipientName: '[deleted]' } }),
    Favorite.deleteMany({ userId: user._id }),
    RecentlyViewed.deleteMany({ userId: user._id }),
    SearchHistory.deleteMany({ userId: user._id }),
    Cart.deleteOne({ userId: user._id }),
  ]);
  user.set({
    fullName: 'Deleted user',
    email: undefined,
    phone: undefined,
    avatarUrl: null,
    emailVerified: false,
    phoneVerified: false,
    platformRoles: [],
    status: 'deleted',
    deletedAt: new Date(),
    deletionReason: input.reason,
    passwordHash: await hashPassword(crypto.randomBytes(32).toString('hex')),
  });
  await user.save();
  await audit({ req, actorId: user._id, action: 'account.deleted', category: 'account', targetType: 'user', targetId: user._id });
  ok(res, { deleted: true });
});

/* Addresses ----------------------------------------------------------------------------------- */

function toAddressDto(a: InstanceType<typeof Address> | Record<string, any>) {
  return {
    id: String(a._id),
    label: a.label,
    recipientName: a.recipientName,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2 ?? undefined,
    city: a.city,
    state: a.state,
    landmark: a.landmark ?? undefined,
    location: a.location?.lat != null ? { lat: a.location.lat, lng: a.location.lng } : null,
    isDefault: !!a.isDefault,
  };
}
export { toAddressDto };

usersRouter.get('/me/addresses', async (req, res) => {
  const list = await Address.find({ userId: requireAuth(req).userId, deletedAt: null }).sort({ isDefault: -1, updatedAt: -1 }).limit(50).lean();
  ok(res, list.map(toAddressDto));
});

usersRouter.post('/me/addresses', async (req, res) => {
  const a = requireAuth(req);
  const input = parse(addressSchema, req.body);
  const count = await Address.countDocuments({ userId: a.userId, deletedAt: null });
  if (count >= 20) throw badRequest('You can save up to 20 addresses');
  const isDefault = input.isDefault || count === 0;
  if (isDefault) await Address.updateMany({ userId: a.userId }, { $set: { isDefault: false } });
  const doc = await Address.create({ ...input, isDefault, userId: a.userId });
  ok(res, toAddressDto(doc), 201);
});

usersRouter.patch('/me/addresses/:id', async (req, res) => {
  const a = requireAuth(req);
  const input = parse(addressUpdateSchema, req.body);
  const doc = await Address.findOne({ _id: paramId(req.params.id), userId: a.userId, deletedAt: null });
  if (!doc) throw notFound('Address');
  if (input.isDefault) await Address.updateMany({ userId: a.userId }, { $set: { isDefault: false } });
  doc.set(input);
  await doc.save();
  ok(res, toAddressDto(doc));
});

usersRouter.delete('/me/addresses/:id', async (req, res) => {
  const a = requireAuth(req);
  const r = await Address.updateOne({ _id: paramId(req.params.id), userId: a.userId, deletedAt: null }, { $set: { deletedAt: new Date(), isDefault: false } });
  if (!r.matchedCount) throw notFound('Address');
  ok(res, { deleted: true });
});
