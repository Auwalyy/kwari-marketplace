import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, api, auth, fabricImage, createActiveShop, createMarketFixture, createPublishedProduct, registerUser, useTestDatabase, type MarketFixture, type TestUser } from './helpers';
import { initSockets } from '../src/sockets';
import { setRealtimeServer } from '../src/services/realtime';
import { Message } from '../src/modules/chats/chat.models';
import { Notification } from '../src/modules/notifications/notification.models';
import { AuditLog } from '../src/modules/admin/admin.models';
import { Shop } from '../src/modules/shops/shop.models';
import { House } from '../src/modules/markets/market.models';
import { notify } from '../src/modules/notifications/notify';

useTestDatabase();

let server: http.Server;
let url: string;
let fx: MarketFixture;
let shop: { owner: TestUser; shopId: string };
let customer: TestUser;
const sockets: Socket[] = [];

function connect(user: TestUser): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(url, { auth: { token: user.token }, transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

function emit<T = any>(s: Socket, event: string, payload: unknown): Promise<{ ok: boolean; data?: T; error?: { code: string } }> {
  return new Promise((resolve) => s.emit(event, payload, resolve));
}

function once<T = any>(s: Socket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    s.once(event, (p: T) => {
      clearTimeout(t);
      resolve(p);
    });
  });
}

beforeAll(async () => {
  server = http.createServer(app);
  initSockets(server);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fx = await createMarketFixture();
  shop = await createActiveShop(fx);
  customer = await registerUser('Chat Customer');
});

afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  setRealtimeServer(null);
  await new Promise<void>((r) => server.close(() => r()));
});

describe('real-time chat', () => {
  let conversationId: string;

  it('rejects unauthenticated socket connections', async () => {
    await expect(
      new Promise((resolve, reject) => {
        const s = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
        sockets.push(s);
        s.on('connect', () => resolve(undefined));
        s.on('connect_error', reject);
      }),
    ).rejects.toThrow();
  });

  it('persists messages before broadcasting and delivers them live', async () => {
    const product = await createPublishedProduct(shop.owner, shop.shopId, fx.categoryId, { name: 'Chat product' });
    const start = await api().post('/api/v1/conversations').set(auth(customer)).send({ shopId: shop.shopId, productId: product.id, message: 'Is this available in blue?' });
    expect(start.status).toBe(201);
    conversationId = start.body.data.id;

    const cs = await connect(customer);
    const ss = await connect(shop.owner);
    expect((await emit(cs, 'conversation:join', { conversationId })).ok).toBe(true);
    const join = await emit(ss, 'conversation:join', { conversationId });
    expect(join.ok).toBe(true);
    expect(join.data.side).toBe('shop');

    const incoming = once(cs, 'message:new');
    const sent = await emit(ss, 'message:send', { conversationId, clientMessageId: 'shop-msg-0001', type: 'text', text: 'Yes, 30 yards in stock' });
    expect(sent.ok).toBe(true);
    const msg = await incoming;
    expect(msg.text).toBe('Yes, 30 yards in stock');
    expect(await Message.countDocuments({ conversationId, clientMessageId: 'shop-msg-0001' })).toBe(1);

    // Re-sending the same clientMessageId (e.g. after a reconnect) does not duplicate.
    const resend = await emit(ss, 'message:send', { conversationId, clientMessageId: 'shop-msg-0001', type: 'text', text: 'Yes, 30 yards in stock' });
    expect(resend.data.id).toBe(sent.data.id);
    expect(await Message.countDocuments({ conversationId, clientMessageId: 'shop-msg-0001' })).toBe(1);

    // Typing indicator reaches the other side.
    const typing = once(cs, 'conversation:typing');
    await emit(ss, 'conversation:typing', { conversationId, typing: true });
    expect((await typing).typing).toBe(true);
  });

  it('tracks unread counts and read status', async () => {
    let list = await api().get('/api/v1/conversations').set(auth(customer));
    expect(list.body.data[0].unreadCount).toBeGreaterThan(0);
    await api().post(`/api/v1/conversations/${conversationId}/read`).set(auth(customer));
    list = await api().get('/api/v1/conversations').set(auth(customer));
    expect(list.body.data[0].unreadCount).toBe(0);
    const history = await api().get(`/api/v1/conversations/${conversationId}/messages`).set(auth(shop.owner));
    const shopMsg = history.body.data.messages.find((m: any) => m.senderSide === 'shop');
    expect(shopMsg.readByOtherSide).toBe(true);
  });

  it('lets clients fetch missed messages after reconnecting', async () => {
    const before = new Date(Date.now() - 1000).toISOString();
    await api().post(`/api/v1/conversations/${conversationId}/messages`).set(auth(shop.owner)).send({ clientMessageId: 'offline-0001', type: 'text', text: 'Sent while you were offline' });
    const missed = await api().get(`/api/v1/conversations/${conversationId}/messages`).query({ after: before }).set(auth(customer));
    expect(missed.body.data.messages.some((m: any) => m.text === 'Sent while you were offline')).toBe(true);
  });

  it('refuses to let outsiders join rooms or read history by id', async () => {
    const outsider = await registerUser('Outsider');
    const os = await connect(outsider);
    const join = await emit(os, 'conversation:join', { conversationId });
    expect(join.ok).toBe(false);
    expect(join.error!.code).toBe('FORBIDDEN');
    const send = await emit(os, 'message:send', { conversationId, clientMessageId: 'evil-0001', type: 'text', text: 'hi' });
    expect(send.ok).toBe(false);
    expect((await api().get(`/api/v1/conversations/${conversationId}/messages`).set(auth(outsider))).status).toBe(403);
    // Typing without joining is rejected too.
    expect((await emit(os, 'conversation:typing', { conversationId, typing: true })).ok).toBe(false);
  });

  it('lets workers with chats.manage participate but not those without it', async () => {
    const inviteChat = await api().post(`/api/v1/shops/${shop.shopId}/worker-invitations`).set(auth(shop.owner)).send({ permissions: ['chats.manage'] });
    const chatWorker = await registerUser('Chat worker');
    await api().post('/api/v1/invitations/worker/redeem').set(auth(chatWorker)).send({ code: inviteChat.body.data.code });
    expect((await api().get(`/api/v1/conversations/${conversationId}`).set(auth(chatWorker))).status).toBe(200);
    const inviteProd = await api().post(`/api/v1/shops/${shop.shopId}/worker-invitations`).set(auth(shop.owner)).send({ permissions: ['products.manage'] });
    const prodWorker = await registerUser('Product worker');
    await api().post('/api/v1/invitations/worker/redeem').set(auth(prodWorker)).send({ code: inviteProd.body.data.code });
    expect((await api().get(`/api/v1/conversations/${conversationId}`).set(auth(prodWorker))).status).toBe(403);
  });

  it('enforces blocking for messages and new conversations', async () => {
    const block = await api().post(`/api/v1/blocks/conversation/${conversationId}`).set(auth(customer));
    expect(block.status).toBe(201);
    const send = await api().post(`/api/v1/conversations/${conversationId}/messages`).set(auth(shop.owner)).send({ clientMessageId: 'blocked-0001', type: 'text', text: 'hello?' });
    expect(send.status).toBe(403);
    expect(send.body.error.code).toBe('BLOCKED');
    const quote = await api().post('/api/v1/quotations').set(auth(customer)).send({ shopId: shop.shopId, items: [] });
    expect(quote.status).toBe(400);
    const blocks = await api().get('/api/v1/blocks').set(auth(customer));
    await api().delete(`/api/v1/blocks/${blocks.body.data[0].id}`).set(auth(customer));
    const after = await api().post(`/api/v1/conversations/${conversationId}/messages`).set(auth(shop.owner)).send({ clientMessageId: 'unblocked-0001', type: 'text', text: 'hello again' });
    expect(after.status).toBe(201);
  });

  it('serves chat images only to participants', async () => {
    const up = await api().post(`/api/v1/conversations/${conversationId}/images`).set(auth(customer)).field('clientMessageId', 'img-000001').attach('image', await fabricImage([[1, 2, 3], [200, 100, 50]]), 'photo.png');
    expect(up.status).toBe(201);
    const path = up.body.data.imageUrl as string;
    expect((await api().get(path).set(auth(shop.owner))).status).toBe(200);
    const outsider = await registerUser();
    expect((await api().get(path).set(auth(outsider))).status).toBe(403);
    expect((await api().get(path)).status).toBe(401);
  });
});

describe('notifications', () => {
  it('deduplicates repeated events', async () => {
    const u = await registerUser();
    await notify([u.id], { type: 'payment.updated', title: 'Paid', body: 'x', dedupeKey: 'evt-1' });
    await notify([u.id], { type: 'payment.updated', title: 'Paid', body: 'x', dedupeKey: 'evt-1' });
    expect(await Notification.countDocuments({ userId: u.id, dedupeKey: 'evt-1' })).toBe(1);
    const list = await api().get('/api/v1/notifications').set(auth(u));
    expect(list.body.meta.unread).toBe(1);
    await api().post('/api/v1/notifications/read-all').set(auth(u));
    expect((await api().get('/api/v1/notifications/unread-count').set(auth(u))).body.data.unread).toBe(0);
    const badToken = await api().post('/api/v1/notifications/devices').set(auth(u)).send({ token: 'not-an-expo-token', platform: 'android' });
    expect(badToken.status).toBe(400);
    const good = await api().post('/api/v1/notifications/devices').set(auth(u)).send({ token: 'ExponentPushToken[abcdefghijkl]', platform: 'android' });
    expect(good.status).toBe(200);
  });
});

describe('verification, reports and administration', () => {
  it('runs the shop verification workflow with audit history', async () => {
    const req = await api().post('/api/v1/verifications').set(auth(shop.owner)).send({ type: 'shop', targetId: shop.shopId, evidence: 'CAC certificate and market levy receipts attached' });
    expect(req.status).toBe(201);
    expect((await Shop.findById(shop.shopId).lean())!.verificationStatus).toBe('pending');
    const stranger = await registerUser();
    expect((await api().post('/api/v1/verifications').set(auth(stranger)).send({ type: 'shop', targetId: shop.shopId, evidence: 'I am definitely the owner here' })).status).toBe(403);
    expect((await api().post(`/api/v1/admin/verifications/${req.body.data.id}/decision`).set(auth(stranger)).send({ decision: 'approve', reason: 'ok' })).status).toBe(403);
    const decide = await api().post(`/api/v1/admin/verifications/${req.body.data.id}/decision`).set(auth(fx.admin)).send({ decision: 'approve', reason: 'Documents verified on site' });
    expect(decide.status).toBe(200);
    expect((await Shop.findById(shop.shopId).lean())!.verificationStatus).toBe('verified');
    expect(await AuditLog.countDocuments({ action: 'verification.approved', targetId: shop.shopId })).toBe(1);
  });

  it('handles house-head claims through admin review', async () => {
    const h = await api().post('/api/v1/houses').set(auth(fx.admin)).send({ marketId: fx.marketId, houseNumber: 'KW-777', name: 'Claimable', addressDescription: 'East wing' });
    const claimant = await registerUser('Claimant');
    const claim = await api().post('/api/v1/houses/claims').set(auth(claimant)).send({ houseId: h.body.data.id, evidence: 'Family property documents and association letter' });
    expect(claim.status).toBe(201);
    await api().post(`/api/v1/admin/verifications/${claim.body.data.id}/decision`).set(auth(fx.admin)).send({ decision: 'approve', reason: 'Confirmed with market association' });
    const house = await House.findById(h.body.data.id).lean();
    expect(String(house!.headUserId)).toBe(claimant.id);
    expect(house!.headVerificationStatus).toBe('verified');
    expect((await api().post(`/api/v1/houses/${h.body.data.id}/invitations`).set(auth(claimant)).send({})).status).toBe(201);
  });

  it('moderates reported messages and notifies the reporter', async () => {
    const other = await createActiveShop(fx);
    const conv = await api().post('/api/v1/conversations').set(auth(customer)).send({ shopId: other.shopId, message: 'Hello' });
    const reply = await api().post(`/api/v1/conversations/${conv.body.data.id}/messages`).set(auth(other.owner)).send({ clientMessageId: 'abuse-0001', type: 'text', text: 'abusive content' });
    const report = await api().post('/api/v1/reports').set(auth(customer)).send({ targetType: 'message', targetId: reply.body.data.id, category: 'harassment', description: 'Rude message from seller' });
    expect(report.status).toBe(201);
    const outsider = await registerUser();
    expect((await api().post('/api/v1/reports').set(auth(outsider)).send({ targetType: 'message', targetId: reply.body.data.id, category: 'spam', description: 'cannot see this' })).status).toBe(403);
    const queue = await api().get('/api/v1/admin/reports').set(auth(fx.admin));
    expect(queue.body.data.some((r: any) => r.id === report.body.data.id)).toBe(true);
    const act = await api().post(`/api/v1/admin/reports/${report.body.data.id}/action`).set(auth(fx.admin)).send({ action: 'hide_message', note: 'Violates community rules' });
    expect(act.body.data.status).toBe('resolved');
    const history = await api().get(`/api/v1/conversations/${conv.body.data.id}/messages`).set(auth(customer));
    expect(history.body.data.messages.find((m: any) => m.id === reply.body.data.id).text).toBe('This message was removed by a moderator.');
    expect(await Notification.countDocuments({ userId: customer.id, type: 'report.updated' })).toBe(1);
  });

  it('suspension revokes access immediately and is audited', async () => {
    const victim = await registerUser('Fraudster');
    const res = await api().post(`/api/v1/admin/users/${victim.id}/suspend`).set(auth(fx.admin)).send({ reason: 'Confirmed fraud reports' });
    expect(res.status).toBe(200);
    expect((await api().get('/api/v1/users/me').set(auth(victim))).status).toBe(401);
    const login = await api().post('/api/v1/auth/login').send({ identifier: victim.email, password: victim.password });
    expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(await AuditLog.countDocuments({ action: 'admin.user_suspended', targetId: victim.id })).toBe(1);
  });

  it('serves dashboards from stored data with role checks', async () => {
    const dash = await api().get('/api/v1/admin/dashboard').set(auth(fx.admin));
    expect(dash.status).toBe(200);
    expect(dash.body.data.houses).toBeGreaterThanOrEqual(2);
    const house = await api().get(`/api/v1/houses/${fx.houseId}/dashboard`).set(auth(fx.head));
    expect(house.body.data.shops.active).toBeGreaterThanOrEqual(1);
    const analytics = await api().get(`/api/v1/analytics/shops/${shop.shopId}`).set(auth(shop.owner));
    expect(analytics.status).toBe(200);
    expect(analytics.body.data).toHaveProperty('gatewayVerifiedKobo');
    expect(analytics.body.data).toHaveProperty('sellerConfirmedKobo');
    expect((await api().get(`/api/v1/analytics/shops/${shop.shopId}`).set(auth(customer))).status).toBe(403);
    expect((await api().get(`/api/v1/analytics/shops/${shop.shopId}`).set(auth(fx.head))).status).toBe(403);
    const openapi = await api().get('/api/v1/openapi.json');
    expect(Object.keys(openapi.body.paths).length).toBeGreaterThan(150);
  });
});
