import type { Request } from 'express';
import type { Types } from 'mongoose';
import type { HouseDto, HouseMembershipDto } from '@kkdm/shared';
import { House, HouseMembership, type HouseMembershipDoc } from '../markets/market.models';
import { Shop } from '../shops/shop.models';
import { User } from '../users/user.model';
import { breadcrumbKey, buildBreadcrumbs } from '../../services/locations';
import { audit } from '../../services/audit';
import { notify } from '../notifications/notify';
import { refreshShopListing } from '../shops/shop.service';
import { withTransaction } from '../../config/db';
import { conflict, iso } from '../../utils/http';

export async function toHouseDtos(houses: any[]): Promise<HouseDto[]> {
  const crumbs = await buildBreadcrumbs(houses.map((h) => ({ houseId: h._id })));
  return houses.map((h) => ({
    id: String(h._id),
    marketId: String(h.marketId),
    sectionId: h.sectionId ? String(h.sectionId) : null,
    houseNumber: h.houseNumber,
    name: h.name,
    description: h.description ?? undefined,
    addressDescription: h.addressDescription,
    location: h.location?.lat != null ? { lat: h.location.lat, lng: h.location.lng } : null,
    contactPhone: h.contactPhone ?? null,
    contactEmail: h.contactEmail ?? null,
    verificationStatus: h.verificationStatus,
    hasHead: !!h.headUserId,
    autoApproveMemberships: !!h.autoApproveMemberships,
    shopCount: h.shopCount ?? 0,
    breadcrumb: crumbs.get(breadcrumbKey(h._id))!,
  }));
}

export async function toMembershipDtos(list: any[]): Promise<HouseMembershipDto[]> {
  const shops = await Shop.find({ _id: { $in: list.map((m) => m.shopId) } }).select('name shopNumber ownerId status').lean();
  const owners = await User.find({ _id: { $in: shops.map((s) => s.ownerId) } }).select('fullName').lean();
  const shopMap = new Map(shops.map((s) => [String(s._id), s]));
  const ownerMap = new Map(owners.map((o) => [String(o._id), o.fullName]));
  return list.map((m) => {
    const s = shopMap.get(String(m.shopId));
    return {
      id: String(m._id),
      houseId: String(m.houseId),
      shopId: String(m.shopId),
      shop: {
        id: String(m.shopId),
        name: s?.name ?? 'Unknown shop',
        shopNumber: s?.shopNumber ?? '',
        ownerName: (s && ownerMap.get(String(s.ownerId))) ?? 'Unknown',
        status: s?.status ?? 'closed',
      },
      status: m.status,
      reason: m.reason ?? undefined,
      decidedAt: iso(m.decidedAt),
      createdAt: iso(m.createdAt)!,
      dispute: m.dispute?.status ? { ...m.dispute, openedAt: iso(m.dispute.openedAt), respondedAt: iso(m.dispute.respondedAt) } : undefined,
    } as HouseMembershipDto;
  });
}

export async function recountHouseShops(houseId: Types.ObjectId | string) {
  const n = await Shop.countDocuments({ houseId, status: 'active' });
  await House.updateOne({ _id: houseId }, { $set: { shopCount: n } });
}

/**
 * Approves or rejects a pending membership. Approval activates the shop and lists it; rejection frees
 * the shop number so it can be re-registered correctly.
 */
export async function decideMembership(
  membership: HouseMembershipDoc,
  decision: 'approve' | 'reject',
  actorId: string | null,
  reason: string | undefined,
  req?: Request,
  auto = false,
) {
  if (membership.status !== 'pending') throw conflict(`This request has already been ${membership.status}`, 'MEMBERSHIP_DECIDED');
  const approve = decision === 'approve';

  await withTransaction(async (session) => {
    const updated = await HouseMembership.findOneAndUpdate(
      { _id: membership._id, status: 'pending' },
      {
        $set: {
          status: approve ? 'approved' : 'rejected',
          live: approve,
          decidedBy: actorId,
          decidedAt: new Date(),
          reason,
        },
        $push: { history: { status: approve ? 'approved' : 'rejected', by: actorId, reason: auto ? 'auto-approved (trusted house)' : reason } },
      },
      { new: true, session },
    );
    if (!updated) throw conflict('This request was already decided', 'MEMBERSHIP_DECIDED');
    await Shop.updateOne(
      { _id: membership.shopId },
      approve
        ? { $set: { status: 'active', occupiesSlot: true, houseId: membership.houseId } }
        : { $set: { status: 'rejected', occupiesSlot: false } },
      { session },
    );
  });

  const shop = await Shop.findById(membership.shopId).select('ownerId name houseId').lean();
  await refreshShopListing(membership.shopId);
  await recountHouseShops(membership.houseId);
  await audit({
    req,
    actorId,
    action: approve ? 'house_membership.approved' : 'house_membership.rejected',
    category: 'house',
    targetType: 'house_membership',
    targetId: membership._id,
    houseId: membership.houseId,
    shopId: membership.shopId,
    reason,
    metadata: { auto },
  });
  if (shop) {
    await notify([shop.ownerId], {
      type: 'membership.updated',
      title: approve ? 'Shop approved' : 'Shop registration declined',
      body: approve
        ? `${shop.name} is now listed in the market directory.`
        : `Your house membership request for ${shop.name} was declined${reason ? `: ${reason}` : '.'}`,
      data: { shopId: String(membership.shopId), membershipId: String(membership._id) },
      dedupeKey: `membership:${membership._id}:${approve ? 'approved' : 'rejected'}`,
    });
  }
}

/** Removes an approved shop from a house (keeps the record; the shop must rejoin through a new code). */
export async function removeMembership(membership: HouseMembershipDoc, actorId: string, reason: string, req?: Request, by: 'house' | 'shop' = 'house') {
  if (membership.status !== 'approved' && membership.status !== 'pending') {
    throw conflict('Only pending or approved memberships can be ended', 'MEMBERSHIP_NOT_ACTIVE');
  }
  const status = by === 'shop' ? 'left' : 'removed';
  await HouseMembership.updateOne(
    { _id: membership._id },
    { $set: { status, live: false, decidedBy: actorId, decidedAt: new Date(), reason }, $push: { history: { status, by: actorId, reason } } },
  );
  await Shop.updateOne({ _id: membership.shopId }, { $set: { status: 'pending_membership', occupiesSlot: false } });
  await refreshShopListing(membership.shopId);
  await recountHouseShops(membership.houseId);
  await audit({
    req,
    actorId,
    action: by === 'shop' ? 'house_membership.left' : 'house_membership.removed',
    category: 'house',
    targetType: 'house_membership',
    targetId: membership._id,
    houseId: membership.houseId,
    shopId: membership.shopId,
    reason,
  });
  const shop = await Shop.findById(membership.shopId).select('ownerId name').lean();
  if (shop && by === 'house') {
    await notify([shop.ownerId], {
      type: 'membership.updated',
      title: 'Removed from house',
      body: `${shop.name} was removed from its house: ${reason}. You can open a dispute from the shop settings.`,
      data: { shopId: String(membership.shopId), membershipId: String(membership._id) },
      dedupeKey: `membership:${membership._id}:removed`,
    });
  }
}
