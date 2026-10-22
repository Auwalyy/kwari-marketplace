import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { SOCKET_EVENTS, objectId, sendMessageSchema } from '@kkdm/shared';
import { resolveAccessToken } from '../middleware/auth';
import { markRead, postMessage, requireConversationAccess } from '../modules/chats/chat.service';
import { ShopMembership } from '../modules/shops/shop.models';
import { rooms, setRealtimeServer } from '../services/realtime';
import { env, isProd } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/http';
import type { AuthContext } from '../types/express';

type Ack = (response: { ok: boolean; data?: unknown; error?: { code: string; message: string } }) => void;

interface SocketData {
  auth: AuthContext;
  /** conversationId -> side, for rooms this socket was authorised to join. */
  joined: Map<string, 'customer' | 'shop'>;
  bucket: { tokens: number; at: number };
}

const conversationRef = z.object({ conversationId: objectId });

/** Simple token bucket: 40 events per 10 seconds per socket. */
function allow(data: SocketData) {
  const now = Date.now();
  const refill = ((now - data.bucket.at) / 10_000) * 40;
  data.bucket = { tokens: Math.min(40, data.bucket.tokens + refill), at: now };
  if (data.bucket.tokens < 1) return false;
  data.bucket.tokens -= 1;
  return true;
}

function fail(ack: Ack | undefined, err: unknown) {
  const e = err instanceof AppError ? { code: err.code, message: err.message } : err instanceof z.ZodError ? { code: 'VALIDATION_ERROR', message: err.issues[0]?.message ?? 'Invalid payload' } : { code: 'INTERNAL_ERROR', message: 'Something went wrong' };
  if (!(err instanceof AppError) && !(err instanceof z.ZodError)) logger.error({ err }, 'Socket handler error');
  if (typeof ack === 'function') ack({ ok: false, error: e });
}

/** Wraps a handler with rate limiting, payload validation and uniform acknowledgements. */
function handler<T>(socket: Socket, schema: z.ZodType<T>, fn: (payload: T, data: SocketData) => Promise<unknown>) {
  return async (payload: unknown, ack?: Ack) => {
    const data = socket.data as SocketData;
    if (!allow(data)) return fail(ack, new AppError(429, 'RATE_LIMITED', 'Slow down'));
    try {
      const parsed = schema.parse(payload);
      const result = await fn(parsed, data);
      if (typeof ack === 'function') ack({ ok: true, data: result });
    } catch (err) {
      fail(ack, err);
    }
  };
}

export function initSockets(httpServer: HttpServer) {
  const allowed = new Set([...env.CORS_ALLOWED_ORIGINS, ...(env.APP_ORIGIN ? [env.APP_ORIGIN] : [])]);
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: (origin, cb) => cb(null, !origin || allowed.has(origin) || (!isProd && allowed.has('*'))) },
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000, skipMiddlewares: false },
  });

  // Every connection must present a valid access token; it is fully re-validated (user + session).
  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string })?.token;
      if (!token) return next(new Error('UNAUTHORIZED'));
      const auth = await resolveAccessToken(token);
      const exp = (jwt.decode(token) as { exp?: number } | null)?.exp;
      (socket.data as SocketData) = { auth, joined: new Map(), bucket: { tokens: 40, at: Date.now() } };
      if (exp) {
        // Disconnect when the access token expires; the client reconnects with a refreshed token.
        const ms = exp * 1000 - Date.now();
        const timer = setTimeout(() => {
          socket.emit('auth:expired');
          socket.disconnect(true);
        }, Math.max(ms, 0));
        socket.once('disconnect', () => clearTimeout(timer));
      }
      next();
    } catch (err) {
      next(new Error(err instanceof AppError ? err.code : 'UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const data = socket.data as SocketData;
    const userId = data.auth.userId;
    socket.join(rooms.user(userId));
    socket.on(
      SOCKET_EVENTS.conversationJoin,
      handler(socket, conversationRef, async ({ conversationId }) => {
        // Authorisation happens here for every join; knowing an id is not enough.
        const access = await requireConversationAccess(data.auth, conversationId);
        data.joined.set(conversationId, access.side);
        await socket.join(rooms.conversation(conversationId));
        socket.to(rooms.conversation(conversationId)).emit(SOCKET_EVENTS.conversationPresence, { conversationId, userId, side: access.side, online: true });
        const peers = await io.in(rooms.conversation(conversationId)).fetchSockets();
        const otherSideOnline = peers.some((s) => (s.data as SocketData).auth.userId !== userId && (s.data as SocketData).joined.get(conversationId) !== access.side);
        return { side: access.side, otherSideOnline };
      }),
    );

    socket.on(
      SOCKET_EVENTS.conversationLeave,
      handler(socket, conversationRef, async ({ conversationId }) => {
        const side = data.joined.get(conversationId);
        data.joined.delete(conversationId);
        await socket.leave(rooms.conversation(conversationId));
        if (side) socket.to(rooms.conversation(conversationId)).emit(SOCKET_EVENTS.conversationPresence, { conversationId, userId, side, online: false });
        return { left: true };
      }),
    );

    socket.on(
      SOCKET_EVENTS.messageSend,
      handler(socket, z.intersection(conversationRef, sendMessageSchema), async (payload) => {
        if (payload.type === 'image') throw new AppError(400, 'USE_IMAGE_UPLOAD', 'Upload images through the REST endpoint');
        // Access is re-checked on every send (membership may have been revoked since joining).
        const access = await requireConversationAccess(data.auth, payload.conversationId);
        return postMessage(access, userId, payload);
      }),
    );

    socket.on(
      SOCKET_EVENTS.messageRead,
      handler(socket, conversationRef, async ({ conversationId }) => {
        const access = await requireConversationAccess(data.auth, conversationId);
        await markRead(access, userId);
        return { read: true };
      }),
    );

    socket.on(
      SOCKET_EVENTS.conversationTyping,
      handler(socket, conversationRef.extend({ typing: z.boolean() }), async ({ conversationId, typing }) => {
        const side = data.joined.get(conversationId);
        if (!side) throw new AppError(403, 'NOT_JOINED', 'Join the conversation first');
        socket.to(rooms.conversation(conversationId)).emit(SOCKET_EVENTS.conversationTyping, { conversationId, userId, side, typing });
        return { sent: true };
      }),
    );

    socket.on('disconnect', () => {
      for (const [conversationId, side] of data.joined) {
        socket.to(rooms.conversation(conversationId)).emit(SOCKET_EVENTS.conversationPresence, { conversationId, userId, side, online: false });
      }
    });

    // Staff rooms receive shop-wide order / chat events for shops the user may act on.
    // Handlers are registered above first so no early client event is lost while this query runs.
    void ShopMembership.find({ userId, status: 'active' })
      .select('shopId role permissions')
      .lean()
      .then((memberships) => {
        for (const m of memberships) {
          const perms = m.permissions as string[];
          if (m.role === 'owner' || perms.includes('chats.manage') || perms.includes('orders.manage') || perms.includes('quotations.manage')) {
            socket.join(rooms.shopStaff(String(m.shopId)));
          }
        }
      })
      .catch((err) => logger.error({ err }, 'Failed to join staff rooms'));
  });

  setRealtimeServer(io);
  return io;
}
