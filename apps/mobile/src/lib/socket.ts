import { io, type Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@kkdm/shared';
import { API_URL } from './config';

/**
 * One Socket.IO connection per signed-in session. The server authorises every room join, so the client
 * simply asks to join conversations it opens. After reconnects, screens refetch from the REST API to
 * fill any gap — sockets are never the source of truth.
 */
let socket: Socket | null = null;
let tokenGetter: () => string | null = () => null;
let refresher: () => Promise<unknown> = async () => undefined;
const joined = new Set<string>();
type Listener = (...args: any[]) => void;
const listeners = new Map<string, Set<Listener>>();
const reconnectHandlers = new Set<() => void>();

export function configureSocket(getToken: () => string | null, refresh: () => Promise<unknown>) {
  tokenGetter = getToken;
  refresher = refresh;
}

function attachListeners(s: Socket) {
  for (const [event, set] of listeners) for (const l of set) s.on(event, l);
}

export function getSocket(): Socket | null {
  return socket;
}

export function connectSocket() {
  const token = tokenGetter();
  if (!token) return;
  if (socket?.connected) return;
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = io(API_URL, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: (cb) => cb({ token: tokenGetter() }),
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15_000,
  });
  attachListeners(socket);
  socket.on('connect', () => {
    for (const id of joined) socket?.emit(SOCKET_EVENTS.conversationJoin, { conversationId: id }, () => undefined);
    reconnectHandlers.forEach((h) => h());
  });
  socket.on('auth:expired', async () => {
    await refresher();
  });
  socket.on('connect_error', async (err) => {
    if (/TOKEN|UNAUTHORIZED|SESSION/.test(err.message)) await refresher();
  });
}

export function reconnectSocket() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  connectSocket();
}

export function disconnectSocket() {
  joined.clear();
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

export function onSocket(event: string, listener: Listener) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(listener);
  socket?.on(event, listener);
  return () => {
    listeners.get(event)?.delete(listener);
    socket?.off(event, listener);
  };
}

export function onReconnect(handler: () => void) {
  reconnectHandlers.add(handler);
  return () => reconnectHandlers.delete(handler);
}

export function emitWithAck<T = unknown>(event: string, payload: unknown, timeoutMs = 8000): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }> {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve({ ok: false, error: { code: 'OFFLINE', message: 'Not connected' } });
    socket.timeout(timeoutMs).emit(event, payload, (err: Error | null, res: { ok: boolean; data?: T; error?: { code: string; message: string } }) => {
      resolve(err ? { ok: false, error: { code: 'TIMEOUT', message: 'No response' } } : res);
    });
  });
}

export function joinConversation(id: string) {
  joined.add(id);
  return emitWithAck<{ side: 'customer' | 'shop'; otherSideOnline: boolean }>(SOCKET_EVENTS.conversationJoin, { conversationId: id });
}

export function leaveConversation(id: string) {
  joined.delete(id);
  socket?.emit(SOCKET_EVENTS.conversationLeave, { conversationId: id }, () => undefined);
}
