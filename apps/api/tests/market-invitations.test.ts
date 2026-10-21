import { beforeAll, describe, expect, it } from 'vitest';
import { api, auth, createActiveShop, createHouseInvitation, createMarketFixture, registerUser, useTestDatabase, type MarketFixture } from './helpers';
import { HouseInvitation, ShopInvitation } from '../src/modules/invitations/invitation.models';
import { AuditLog } from '../src/modules/admin/admin.models';
import { House, HouseMembership } from '../src/modules/markets/market.models';
import { Shop, ShopMembership } from '../src/modules/shops/shop.models';

useTestDatabase();

let fx: MarketFixture;
beforeAll(async () => {
  fx = await createMarketFixture();
});

describe('market hierarchy', () => {
  it('builds breadcrumbs with and without sections', async () => {
    const withSection = await api().get(`/api/v1/houses/${fx.houseId}`);
    expect(withSection.body.data.breadcrumb.label).toBe('Kantin Kwari → Section B → House KW-024');
    const direct = await api().get(`/api/v1/houses/${fx.directHouseId}`);
    expect(direct.body.data.breadcrumb.label).toBe('Kantin Kwari → House KW-100');
    expect(direct.body.data.sectionId).toBeNull();
  });

  it('rejects duplicate house numbers and sections from another market', async () => {
    const dup = await api().post('/api/v1/houses').set(auth(fx.admin)).send({ marketId: fx.marketId, houseNumber: 'kw-024', name: 'Dup', addressDescription: 'Somewhere' });
    expect(dup.status).toBe(409);
    const other = await api().post('/api/v1/markets').set(auth(fx.admin)).send({ name: 'Other Market', slug: 'other-market-x', region: 'Kano', city: 'Kano' });
    const bad = await api().post('/api/v1/houses').set(auth(fx.admin)).send({ marketId: other.body.data.id, sectionId: fx.sectionId, houseNumber: 'Z-1', name: 'Wrong', addressDescription: 'Somewhere' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_SECTION');
  });

  it('restricts market managers to their assigned scope', async () => {
    const manager = await registerUser('Manager');
    const other = await api().post('/api/v1/markets').set(auth(fx.admin)).send({ name: 'Sabon Gari', slug: 'sabon-gari-x', region: 'Kano', city: 'Kano' });
    const roles = await api().put(`/api/v1/admin/users/${manager.id}/roles`).set(auth(fx.admin)).send({ platformRoles: ['market_manager'], managedMarketIds: [other.body.data.id] });
    expect(roles.status).toBe(200);
    const denied = await api().post('/api/v1/houses').set(auth(manager)).send({ marketId: fx.marketId, houseNumber: 'MM-1', name: 'Nope', addressDescription: 'Somewhere' });
    expect(denied.status).toBe(403);
    const allowed = await api().post('/api/v1/houses').set(auth(manager)).send({ marketId: other.body.data.id, houseNumber: 'MM-1', name: 'Yes', addressDescription: 'Somewhere' });
    expect(allowed.status).toBe(201);
    const roleEsc = await api().put(`/api/v1/admin/users/${manager.id}/roles`).set(auth(manager)).send({ platformRoles: ['admin'] });
    expect(roleEsc.status).toBe(403);
  });
});

describe('house → shop invitations', () => {
  it('only a verified head may issue invitations; codes are stored hashed', async () => {
    const stranger = await registerUser();
    expect((await api().post(`/api/v1/houses/${fx.houseId}/invitations`).set(auth(stranger)).send({})).status).toBe(403);
    // Unverified head on the direct house cannot issue codes.
    const head2 = await registerUser('Unverified head');
    await api().post(`/api/v1/houses/${fx.directHouseId}/head`).set(auth(fx.admin)).send({ userId: head2.id });
    const unverified = await api().post(`/api/v1/houses/${fx.directHouseId}/invitations`).set(auth(head2)).send({});
    expect(unverified.status).toBe(403);
    expect(unverified.body.error.code).toBe('HEAD_NOT_VERIFIED');

    const inv = await createHouseInvitation(fx.head, fx.houseId, { maxUses: 2, expiresInDays: 3 });
    expect(inv.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/);
    const stored = await HouseInvitation.findById(inv.id).lean();
    expect(JSON.stringify(stored)).not.toContain(inv.code.replace(/-/g, ''));
    const list = await api().get(`/api/v1/houses/${fx.houseId}/invitations`).set(auth(fx.head));
    expect(list.body.data[0].code).toBeUndefined();
  });

  it('registers a pending shop, then the head approves it into the directory', async () => {
    const owner = await registerUser('Owner A');
    const inv = await createHouseInvitation(fx.head, fx.houseId);
    const preview = await api().post('/api/v1/invitations/house/preview').set(auth(owner)).send({ code: inv.code });
    expect(preview.status).toBe(200);
    expect(preview.body.data.house.houseNumber).toBe('KW-024');
    const reg = await api().post('/api/v1/shops/register').set(auth(owner)).send({ invitationCode: inv.code, name: 'Baba Textiles', shopNumber: '015', categoryIds: [fx.categoryId] });
    expect(reg.status).toBe(201);
    expect(reg.body.data.shop.status).toBe('pending_membership');
    const shopId = reg.body.data.shop.id;
    // Not in the public directory yet.
    expect((await api().get(`/api/v1/shops/${shopId}`)).status).toBe(404);
    const decision = await api().post(`/api/v1/houses/${fx.houseId}/memberships/${reg.body.data.membership.id}/decision`).set(auth(fx.head)).send({ decision: 'approve' });
    expect(decision.status).toBe(200);
    const pub = await api().get(`/api/v1/shops/${shopId}`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.breadcrumb.label).toBe('Kantin Kwari → Section B → House KW-024 → Shop 015');
    expect(pub.body.data.verificationStatus).toBe('unverified'); // invitation is not proof of ownership
    // Same shop number cannot be registered again in the house.
    const inv2 = await createHouseInvitation(fx.head, fx.houseId);
    const dup = await api().post('/api/v1/shops/register').set(auth(await registerUser())).send({ invitationCode: inv2.code, name: 'Copy', shopNumber: '015' });
    expect(dup.status).toBe(409);
    // The failed attempt must not consume the invitation.
    expect((await HouseInvitation.findById(inv2.id).lean())!.usedCount).toBe(0);
  });

  it('rejects expired, revoked and exhausted codes with clear errors, and unknown codes generically', async () => {
    const u = await registerUser();
    const expired = await createHouseInvitation(fx.head, fx.houseId);
    await HouseInvitation.updateOne({ _id: expired.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const e = await api().post('/api/v1/invitations/house/preview').set(auth(u)).send({ code: expired.code });
    expect(e.body.error.code).toBe('INVITATION_EXPIRED');

    const revoked = await createHouseInvitation(fx.head, fx.houseId);
    await api().post(`/api/v1/houses/${fx.houseId}/invitations/${revoked.id}/revoke`).set(auth(fx.head)).send({});
    const r = await api().post('/api/v1/invitations/house/preview').set(auth(u)).send({ code: revoked.code });
    expect(r.body.error.code).toBe('INVITATION_REVOKED');

    const single = await createHouseInvitation(fx.head, fx.houseId, { maxUses: 1 });
    await api().post('/api/v1/shops/register').set(auth(u)).send({ invitationCode: single.code, name: 'One', shopNumber: 'X01' });
    const ex = await api().post('/api/v1/shops/register').set(auth(await registerUser())).send({ invitationCode: single.code, name: 'Two', shopNumber: 'X02' });
    expect(ex.body.error.code).toBe('INVITATION_EXHAUSTED');

    const unknown = await api().post('/api/v1/invitations/house/preview').set(auth(u)).send({ code: 'ABCDEFGHJK' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('INVITATION_INVALID');
  });

  it('redeems atomically under concurrency (never exceeds maxUses)', async () => {
    const inv = await createHouseInvitation(fx.head, fx.houseId, { maxUses: 2 });
    const users = await Promise.all(Array.from({ length: 6 }, (_, i) => registerUser(`Racer ${i}`)));
    const results = await Promise.all(
      users.map((u, i) => api().post('/api/v1/shops/register').set(auth(u)).send({ invitationCode: inv.code, name: `Race ${i}`, shopNumber: `R${i}` })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    const stored = await HouseInvitation.findById(inv.id).lean();
    expect(stored!.usedCount).toBe(2);
    expect(stored!.status).toBe('exhausted');
    expect(await Shop.countDocuments({ shopNumber: { $in: users.map((_, i) => `R${i}`) } })).toBe(2);
  });

  it('locks out brute-force code guessing', async () => {
    const guesser = await registerUser('Guesser');
    let last;
    for (let i = 0; i < 9; i++) last = await api().post('/api/v1/invitations/house/preview').set(auth(guesser)).send({ code: `WRONGCODE${i}` });
    expect(last!.status).toBe(429);
    expect(last!.body.error.code).toBe('TOO_MANY_CODE_ATTEMPTS');
    expect(await AuditLog.countDocuments({ actorId: guesser.id, action: 'invitation.house_redeem', outcome: 'failure' })).toBeGreaterThanOrEqual(8);
  });

  it('auto-approves for trusted houses only when an admin enabled it', async () => {
    await api().patch(`/api/v1/houses/${fx.houseId}/admin`).set(auth(fx.admin)).send({ autoApproveMemberships: true, reason: 'trusted' });
    const inv = await createHouseInvitation(fx.head, fx.houseId);
    const reg = await api().post('/api/v1/shops/register').set(auth(await registerUser())).send({ invitationCode: inv.code, name: 'Auto Shop', shopNumber: 'A1' });
    expect(reg.status).toBe(201);
    expect((await Shop.findById(reg.body.data.shop.id).lean())!.status).toBe('active');
    await api().patch(`/api/v1/houses/${fx.houseId}/admin`).set(auth(fx.admin)).send({ autoApproveMemberships: false, reason: 'reset' });
  });

  it('prevents cross-house access', async () => {
    const otherHead = await registerUser('Other head');
    await api().post(`/api/v1/houses/${fx.directHouseId}/head`).set(auth(fx.admin)).send({ userId: otherHead.id, markVerified: true });
    const res = await api().get(`/api/v1/houses/${fx.houseId}/memberships`).set(auth(otherHead));
    expect(res.status).toBe(403);
    const inv = await api().get(`/api/v1/houses/${fx.houseId}/invitations`).set(auth(otherHead));
    expect(inv.status).toBe(403);
  });

  it('keeps membership history when a shop is removed and lets it dispute', async () => {
    const { owner, shopId } = await createActiveShop(fx);
    const m = await HouseMembership.findOne({ shopId, live: true });
    const removed = await api().post(`/api/v1/houses/${fx.houseId}/memberships/${m!._id}/remove`).set(auth(fx.head)).send({ reason: 'Shop vacated the premises' });
    expect(removed.status).toBe(200);
    expect((await Shop.findById(shopId).lean())!.status).toBe('pending_membership');
    const history = await HouseMembership.findById(m!._id).lean();
    expect(history!.history.map((h) => h.status)).toEqual(['pending', 'approved', 'removed']);
    const dispute = await api().post(`/api/v1/shops/${shopId}/house-membership/${m!._id}/dispute`).set(auth(owner)).send({ statement: 'We still occupy shop space here.' });
    expect(dispute.status).toBe(200);
    const disputes = await api().get('/api/v1/admin/disputes').set(auth(fx.admin));
    expect(disputes.body.data.some((d: { id: string }) => d.id === String(m!._id))).toBe(true);
  });
});

describe('shop → worker invitations', () => {
  it('grants only the listed permissions and blocks privilege escalation', async () => {
    const { owner, shopId } = await createActiveShop(fx);
    const worker = await registerUser('Worker');
    const create = await api().post(`/api/v1/shops/${shopId}/worker-invitations`).set(auth(owner)).send({ permissions: ['products.manage'], title: 'Sales' });
    expect(create.status).toBe(201);
    const stranger = await registerUser();
    expect((await api().post(`/api/v1/shops/${shopId}/worker-invitations`).set(auth(stranger)).send({ permissions: ['orders.manage'] })).status).toBe(403);

    const redeem = await api().post('/api/v1/invitations/worker/redeem').set(auth(worker)).send({ code: create.body.data.code });
    expect(redeem.status).toBe(201);
    const m = await ShopMembership.findOne({ shopId, userId: worker.id, status: 'active' }).lean();
    expect(m!.role).toBe('worker');
    expect(m!.permissions).toEqual(['products.manage']);

    // Worker cannot invite others, manage workers, change fulfilment/payment settings or see orders.
    expect((await api().post(`/api/v1/shops/${shopId}/worker-invitations`).set(auth(worker)).send({ permissions: ['orders.manage'] })).status).toBe(403);
    expect((await api().get(`/api/v1/shops/${shopId}/workers`).set(auth(worker))).status).toBe(403);
    expect((await api().put(`/api/v1/shops/${shopId}/fulfilment`).set(auth(worker)).send({ pickupAvailable: true, deliveryAvailable: false, acceptedPaymentMethods: ['bank_transfer'] })).status).toBe(403);
    expect((await api().get(`/api/v1/shops/${shopId}/orders`).set(auth(worker))).status).toBe(403);
    expect((await api().post(`/api/v1/houses/${fx.houseId}/invitations`).set(auth(worker)).send({})).status).toBe(403);
    // But can manage products.
    expect((await api().post(`/api/v1/shops/${shopId}/products`).set(auth(worker)).send({ name: 'Lace', categoryId: fx.categoryId, retailPriceKobo: 100000, unit: 'yard' })).status).toBe(201);

    // A second redemption by the same worker does not overwrite the membership.
    const again = await api().post(`/api/v1/shops/${shopId}/worker-invitations`).set(auth(owner)).send({ permissions: ['orders.manage', 'reports.view'] });
    const dup = await api().post('/api/v1/invitations/worker/redeem').set(auth(worker)).send({ code: again.body.data.code });
    expect(dup.status).toBe(409);
    expect((await ShopMembership.findOne({ shopId, userId: worker.id, status: 'active' }).lean())!.permissions).toEqual(['products.manage']);

    // Removing the worker revokes access immediately.
    const del = await api().delete(`/api/v1/shops/${shopId}/workers/${m!._id}`).set(auth(owner)).send({});
    expect(del.status).toBe(200);
    expect((await api().post(`/api/v1/shops/${shopId}/products`).set(auth(worker)).send({ name: 'Lace 2', categoryId: fx.categoryId, retailPriceKobo: 100000, unit: 'yard' })).status).toBe(403);
  });

  it('worker invitation codes never belong to a house', async () => {
    const { owner, shopId } = await createActiveShop(fx);
    const w = await api().post(`/api/v1/shops/${shopId}/worker-invitations`).set(auth(owner)).send({ permissions: ['chats.manage'] });
    const u = await registerUser();
    const asHouse = await api().post('/api/v1/shops/register').set(auth(u)).send({ invitationCode: w.body.data.code, name: 'Sneaky', shopNumber: 'Z9' });
    expect(asHouse.status).toBe(400);
    expect(asHouse.body.error.code).toBe('INVITATION_INVALID');
    expect(await ShopInvitation.countDocuments({ shopId })).toBe(1);
    void House;
  });
});
