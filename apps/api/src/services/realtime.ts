import type { Server } from 'socket.io';

/**
 * Thin holder for the Socket.IO server so domain services can emit events without importing the socket
 * layer. Emitting is best-effort: state is always persisted in MongoDB first, and clients re-fetch from
 * the REST API after reconnecting.
 */
let io: Server | null = null;

export function setRealtimeServer(server: Server | null) {
  io = server;
}

export const rooms = {
  user: (id: string) => `user:${id}`,
  shopStaff: (id: string) => `shop:${id}`,
  conversation: (id: string) => `conversation:${id}`,
};

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(rooms.user(userId)).emit(event, payload);
}

export function emitToShopStaff(shopId: string, event: string, payload: unknown) {
  io?.to(rooms.shopStaff(shopId)).emit(event, payload);
}

export function emitToConversation(conversationId: string, event: string, payload: unknown, exceptSocketId?: string) {
  if (!io) return;
  const target = io.to(rooms.conversation(conversationId));
  (exceptSocketId ? target.except(exceptSocketId) : target).emit(event, payload);
}

export function realtimeServer(): Server | null {
  return io;
}
