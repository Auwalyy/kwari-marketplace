import type { MeDto, PlatformRole, ShopPermission, UserDto } from '@kkdm/shared';
import { User } from './user.model';
import { Shop, ShopMembership } from '../shops/shop.models';
import { House, HouseStaff, Market } from '../markets/market.models';
import { iso, notFound } from '../../utils/http';

/** Accepts hydrated documents and lean objects (where Maps are flattened to records). */
interface UserLike {
  _id: unknown;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  emailVerified?: boolean | null;
  phoneVerified?: boolean | null;
  avatarUrl?: string | null;
  platformRoles?: string[] | null;
  managedMarketIds?: unknown[] | null;
  managedSectionIds?: unknown[] | null;
  status: string;
  notificationPreferences?: { push?: boolean | null; groups?: Map<string, boolean> | Record<string, boolean> | null } | null;
  createdAt?: Date;
}

export function toUserDto(u: UserLike): UserDto {
  const groups = u.notificationPreferences?.groups;
  return {
    id: String(u._id),
    fullName: u.fullName,
    email: u.email ?? null,
    phone: u.phone ?? null,
    emailVerified: !!u.emailVerified,
    phoneVerified: !!u.phoneVerified,
    avatarUrl: u.avatarUrl ?? null,
    platformRoles: (u.platformRoles ?? []) as PlatformRole[],
    managedMarketIds: (u.managedMarketIds ?? []).map(String),
    managedSectionIds: (u.managedSectionIds ?? []).map(String),
    status: u.status as UserDto['status'],
    notificationPreferences: {
      push: u.notificationPreferences?.push !== false,
      groups: groups instanceof Map ? Object.fromEntries(groups) : (groups ?? {}),
    },
    createdAt: iso(u.createdAt) ?? new Date().toISOString(),
  };
}

/** Current user plus every shop and house they can act for (resolved server-side). */
export async function buildMe(userId: string): Promise<MeDto> {
  const user = await User.findById(userId).lean();
  if (!user) throw notFound('User');

  const memberships = await ShopMembership.find({ userId, status: 'active' }).lean();
  const shops = await Shop.find({ _id: { $in: memberships.map((m) => m.shopId) } }).select('name slug status ownerId').lean();
  const shopMap = new Map(shops.map((s) => [String(s._id), s]));

  const staff = await HouseStaff.find({ userId, status: 'active' }).lean();
  const houses = await House.find({ _id: { $in: staff.map((s) => s.houseId) } })
    .select('houseNumber name marketId headVerificationStatus')
    .lean();
  const markets = await Market.find({ _id: { $in: houses.map((h) => h.marketId) } }).select('name').lean();
  const marketNames = new Map(markets.map((m) => [String(m._id), m.name]));

  return {
    ...toUserDto(user),
    shops: memberships
      .filter((m) => shopMap.has(String(m.shopId)))
      .map((m) => {
        const s = shopMap.get(String(m.shopId))!;
        return {
          shopId: String(s._id),
          shopName: s.name,
          shopSlug: s.slug,
          role: m.role === 'owner' && String(s.ownerId) === userId ? ('owner' as const) : ('worker' as const),
          permissions: (m.permissions ?? []) as ShopPermission[],
          shopStatus: s.status,
        };
      }),
    houses: houses.map((h) => ({
      houseId: String(h._id),
      houseNumber: h.houseNumber,
      houseName: h.name,
      marketName: marketNames.get(String(h.marketId)) ?? '',
      verificationStatus: h.headVerificationStatus,
    })),
  };
}
