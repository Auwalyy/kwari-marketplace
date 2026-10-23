import type { Types } from 'mongoose';
import type { ShopPermission } from '@kkdm/shared';
import type { AuthContext } from '../types/express';
import { Shop, ShopMembership, type ShopDoc } from '../modules/shops/shop.models';
import { House, HouseStaff, type HouseDoc } from '../modules/markets/market.models';
import { forbidden, notFound } from '../utils/http';

/**
 * Resource-level authorisation helpers. Every check re-reads memberships from the database; nothing the
 * client sends about roles, shops or houses is trusted.
 */

export const isAdmin = (auth?: AuthContext) => !!auth?.platformRoles.includes('admin');
export const isMarketManager = (auth?: AuthContext) => !!auth?.platformRoles.includes('market_manager');

type IdLike = Types.ObjectId | string | null | undefined;

/** True for admins, or market managers whose assigned scope covers the market / section. */
export function canManageMarketScope(auth: AuthContext | undefined, scope: { marketId: IdLike; sectionId?: IdLike }) {
  if (!auth) return false;
  if (isAdmin(auth)) return true;
  if (!isMarketManager(auth)) return false;
  if (scope.marketId && auth.managedMarketIds.includes(String(scope.marketId))) return true;
  if (scope.sectionId && auth.managedSectionIds.includes(String(scope.sectionId))) return true;
  return false;
}

export function assertMarketScope(auth: AuthContext | undefined, scope: { marketId: IdLike; sectionId?: IdLike }) {
  if (!canManageMarketScope(auth, scope)) throw forbidden('This record is outside your management scope');
}

/** Mongo filter restricting a market-scoped collection to what the caller manages (admins: no restriction). */
export function marketScopeFilter(auth: AuthContext): Record<string, unknown> {
  if (isAdmin(auth)) return {};
  const or: Record<string, unknown>[] = [];
  if (auth.managedMarketIds.length) or.push({ marketId: { $in: auth.managedMarketIds } });
  if (auth.managedSectionIds.length) or.push({ sectionId: { $in: auth.managedSectionIds } });
  return or.length ? { $or: or } : { _id: null };
}

export interface ShopAccess {
  shop: ShopDoc;
  role: 'owner' | 'worker';
  permissions: ShopPermission[];
  isOwner: boolean;
}

export async function getShopAccess(userId: string, shopId: string): Promise<ShopAccess | null> {
  const [shop, membership] = await Promise.all([
    Shop.findById(shopId),
    ShopMembership.findOne({ shopId, userId, status: 'active' }).lean(),
  ]);
  if (!shop) throw notFound('Shop');
  if (!membership) return null;
  const isOwner = membership.role === 'owner' && String(shop.ownerId) === userId;
  return {
    shop,
    role: isOwner ? 'owner' : 'worker',
    permissions: (membership.permissions ?? []) as ShopPermission[],
    isOwner,
  };
}

/**
 * Requires the caller to be the shop owner, or a worker holding `permission`. Pass 'owner' for
 * owner-only capabilities (workers, payouts, house membership, ownership, settings).
 */
export async function requireShopAccess(
  auth: AuthContext,
  shopId: string,
  permission: ShopPermission | 'owner' | 'any',
  opts: { allowSuspended?: boolean } = {},
): Promise<ShopAccess> {
  const access = await getShopAccess(auth.userId, shopId);
  if (!access) throw forbidden('You are not a member of this shop');
  if (!opts.allowSuspended && (access.shop.status === 'suspended' || access.shop.status === 'closed')) {
    throw forbidden(`This shop is ${access.shop.status}`, 'SHOP_INACTIVE');
  }
  if (permission === 'any') return access;
  if (permission === 'owner') {
    if (!access.isOwner) throw forbidden('Only the shop owner can do this');
    return access;
  }
  if (!access.isOwner && !access.permissions.includes(permission)) {
    throw forbidden('Your shop role does not include this permission', 'MISSING_SHOP_PERMISSION');
  }
  return access;
}

/** Money figures (cost prices, profit, expenses, debts) are for the owner and staff given finance access. */
export function canSeeFinance(access: Pick<ShopAccess, 'isOwner' | 'permissions'>) {
  return access.isOwner || access.permissions.includes('finance.view');
}

export async function hasShopPermission(auth: AuthContext | undefined, shopId: string, permission: ShopPermission) {
  if (!auth) return false;
  const access = await getShopAccess(auth.userId, shopId).catch(() => null);
  return !!access && (access.isOwner || access.permissions.includes(permission));
}

export interface HouseAccess {
  house: HouseDoc;
  role: 'head' | 'assistant' | 'manager';
}

/**
 * Requires the caller to manage the house: its active head, an admin-permitted assistant, or an
 * admin / market manager in scope. `requireVerifiedHead` additionally demands a verified head
 * (used for issuing invitations).
 */
export async function requireHouseAccess(
  auth: AuthContext,
  houseId: string,
  opts: { headOnly?: boolean; requireVerifiedHead?: boolean; allowManagers?: boolean } = {},
): Promise<HouseAccess> {
  const house = await House.findById(houseId);
  if (!house) throw notFound('House');
  const staff = await HouseStaff.findOne({ houseId, userId: auth.userId, status: 'active' }).lean();

  if (staff) {
    if (staff.role === 'assistant') {
      if (opts.headOnly) throw forbidden('Only the house head can do this');
      if (!house.allowAssistants) throw forbidden('House assistants are not enabled for this house');
    }
    if (opts.requireVerifiedHead && house.headVerificationStatus !== 'verified') {
      throw forbidden('The house head must be verified before invitations can be issued', 'HEAD_NOT_VERIFIED');
    }
    return { house, role: staff.role as 'head' | 'assistant' };
  }
  if (opts.allowManagers !== false && canManageMarketScope(auth, { marketId: house.marketId, sectionId: house.sectionId })) {
    if (opts.requireVerifiedHead) throw forbidden('Only a verified house head can issue invitations');
    return { house, role: 'manager' };
  }
  throw forbidden('You do not manage this house');
}
