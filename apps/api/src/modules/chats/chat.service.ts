import { Types } from 'mongoose';
import { SOCKET_EVENTS, type ConversationDto, type MessageDto, type SendMessageInput } from '@kkdm/shared';
import { Conversation, ConversationParticipant, Message, type ConversationDoc } from './chat.models';
import { Shop, ShopMembership } from '../shops/shop.models';
import { User } from '../users/user.model';
import { Product } from '../products/product.models';
import { Order, Quotation } from '../orders/order.models';
import { Block } from '../reports/trust.models';
import { notify, notifyShopStaff } from '../notifications/notify';
import { emitToConversation, emitToShopStaff, emitToUser } from '../../services/realtime';
import type { AuthContext } from '../../types/express';
import { badRequest, forbidden, iso, notFound } from '../../utils/http';

export type Side = 'customer' | 'shop';

export interface ConversationAccess {
  conversation: ConversationDoc;
  side: Side;
}

/**
 * Resolves which side of a conversation the user is on. Customers must be the conversation's customer;
 * shop staff must be the owner or a worker with chats.manage. Knowing a conversation id grants nothing.
 */
export async function requireConversationAccess(auth: AuthContext, conversationId: string): Promise<ConversationAccess> {
  if (!Types.ObjectId.isValid(conversationId)) throw notFound('Conversation');
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw notFound('Conversation');
  if (String(conversation.customerId) === auth.userId) return { conversation, side: 'customer' };
  const membership = await ShopMembership.findOne({ shopId: conversation.shopId, userId: auth.userId, status: 'active' }).lean();
  if (membership && (membership.role === 'owner' || (membership.permissions as string[]).includes('chats.manage'))) {
    return { conversation, side: 'shop' };
  }
  throw forbidden('You are not part of this conversation');
}

/** True if either party has blocked the other. */
export async function isBlocked(customerId: Types.ObjectId | string, shopId: Types.ObjectId | string) {
  const shop = await Shop.findById(shopId).select('ownerId').lean();
  return !!(await Block.exists({
    $or: [
      { blockerType: 'user', blockerId: customerId, blockedType: 'shop', blockedId: shopId },
      { blockerType: 'shop', blockerId: shopId, blockedType: 'user', blockedId: customerId },
      ...(shop ? [{ blockerType: 'user', blockerId: customerId, blockedType: 'user', blockedId: shop.ownerId }] : []),
    ],
  }));
}

export async function assertNotBlocked(customerId: Types.ObjectId | string, shopId: Types.ObjectId | string) {
  if (await isBlocked(customerId, shopId)) throw forbidden('Messaging is not available between you and this shop', 'BLOCKED');
}

export async function getOrCreateConversation(customerId: string, shopId: string, productId?: string | null) {
  const shop = await Shop.findById(shopId).select('status ownerId contactPreferences').lean();
  if (!shop || shop.status !== 'active') throw notFound('Shop');
  if (String(shop.ownerId) === customerId) throw badRequest('You cannot start a chat with your own shop', 'OWN_SHOP');
  await assertNotBlocked(customerId, shopId);
  const conversation = await Conversation.findOneAndUpdate(
    { shopId, customerId },
    { $setOnInsert: { shopId, customerId, productId: productId ?? null, lastMessageAt: new Date() } },
    { upsert: true, new: true },
  );
  return conversation!;
}

const previewText: Record<string, string> = {
  image: 'Photo',
  product: 'Shared a product',
  order: 'Order reference',
  quotation: 'Quotation',
  system: 'Update',
};

/**
 * Persists a message and only then broadcasts it. A repeated clientMessageId from the same sender returns
 * the original message (safe resends after reconnects).
 */
export async function postMessage(
  access: ConversationAccess,
  senderId: string | null,
  input: Omit<Partial<SendMessageInput>, 'type'> & { type: SendMessageInput['type'] | 'system'; imageKey?: string },
  opts: { skipBlockCheck?: boolean } = {},
): Promise<MessageDto> {
  const { conversation, side } = access;
  if (!opts.skipBlockCheck) await assertNotBlocked(conversation.customerId, conversation.shopId);

  if (senderId && input.clientMessageId) {
    const dup = await Message.findOne({ senderId, clientMessageId: input.clientMessageId });
    if (dup) return (await toMessageDtos([dup.toObject()], side))[0];
  }
  // References must belong to this conversation's shop / customer.
  if (input.productId && !(await Product.exists({ _id: input.productId, shopId: conversation.shopId }))) throw badRequest('Product does not belong to this shop', 'INVALID_REFERENCE');
  if (input.orderId && !(await Order.exists({ _id: input.orderId, shopId: conversation.shopId, customerId: conversation.customerId }))) throw badRequest('Order not found for this conversation', 'INVALID_REFERENCE');
  if (input.quotationId && !(await Quotation.exists({ _id: input.quotationId, shopId: conversation.shopId, customerId: conversation.customerId }))) throw badRequest('Quotation not found for this conversation', 'INVALID_REFERENCE');

  const senderSide = input.type === 'system' ? 'system' : side;
  let message;
  try {
    message = await Message.create({
      conversationId: conversation._id,
      senderId,
      senderSide,
      clientMessageId: input.clientMessageId ?? null,
      type: input.type,
      text: input.text,
      imageUrl: input.imageUrl,
      imageKey: input.imageKey,
      productId: input.productId ?? null,
      orderId: input.orderId ?? null,
      quotationId: input.quotationId ?? null,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000 && senderId && input.clientMessageId) {
      const dup = await Message.findOne({ senderId, clientMessageId: input.clientMessageId });
      if (dup) return (await toMessageDtos([dup.toObject()], side))[0];
    }
    throw err;
  }

  const unreadField = senderSide === 'customer' ? 'shopUnread' : senderSide === 'shop' ? 'customerUnread' : null;
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        lastMessage: { text: input.text?.slice(0, 140) ?? previewText[input.type] ?? '', type: input.type, senderId, at: message.createdAt },
        lastMessageAt: message.createdAt,
        status: 'open',
      },
      ...(unreadField ? { $inc: { [unreadField]: 1 } } : {}),
    },
  );
  if (senderId) {
    await ConversationParticipant.updateOne({ conversationId: conversation._id, userId: senderId }, { $set: { side, lastReadAt: new Date() } }, { upsert: true });
  }

  const [dtoForCustomer] = await toMessageDtos([message.toObject()], 'customer');
  emitToConversation(String(conversation._id), SOCKET_EVENTS.messageNew, dtoForCustomer);
  // Also deliver to personal / staff rooms so conversation lists update without joining the room.
  emitToUser(String(conversation.customerId), SOCKET_EVENTS.messageNew, dtoForCustomer);
  emitToShopStaff(String(conversation.shopId), SOCKET_EVENTS.messageNew, dtoForCustomer);

  if (senderSide !== 'system') {
    const sender = senderId ? await User.findById(senderId).select('fullName').lean() : null;
    const body = input.type === 'text' ? (input.text ?? '').slice(0, 120) : previewText[input.type];
    const notification = {
      type: 'message.new' as const,
      title: senderSide === 'customer' ? `${sender?.fullName ?? 'Customer'}` : 'New message from a shop',
      body,
      data: { conversationId: String(conversation._id) },
      dedupeKey: `message:${message._id}`,
    };
    if (senderSide === 'customer') await notifyShopStaff(conversation.shopId, 'chats.manage', notification);
    else await notify([conversation.customerId], notification);
  }
  return dtoForCustomer;
}

export async function toMessageDtos(messages: any[], _viewerSide: Side): Promise<MessageDto[]> {
  const senders = await User.find({ _id: { $in: messages.map((m) => m.senderId).filter(Boolean) } }).select('fullName').lean();
  const products = await Product.find({ _id: { $in: messages.map((m) => m.productId).filter(Boolean) } }).select('name images retailPriceKobo unit').lean();
  const orders = await Order.find({ _id: { $in: messages.map((m) => m.orderId).filter(Boolean) } }).select('reference status').lean();
  const quotes = await Quotation.find({ _id: { $in: messages.map((m) => m.quotationId).filter(Boolean) } }).select('reference status').lean();
  return messages.map((m) => {
    const p = m.productId ? products.find((x) => String(x._id) === String(m.productId)) : null;
    const o = m.orderId ? orders.find((x) => String(x._id) === String(m.orderId)) : null;
    const q = m.quotationId ? quotes.find((x) => String(x._id) === String(m.quotationId)) : null;
    return {
      id: String(m._id),
      conversationId: String(m.conversationId),
      clientMessageId: m.clientMessageId ?? undefined,
      senderId: m.senderId ? String(m.senderId) : '',
      senderName: senders.find((s) => String(s._id) === String(m.senderId))?.fullName ?? (m.senderSide === 'system' ? 'Kantin Kwari' : ''),
      senderSide: m.senderSide,
      type: m.type,
      text: m.hiddenAt ? 'This message was removed by a moderator.' : m.text,
      imageUrl: m.hiddenAt ? undefined : m.imageUrl ? `/api/v1/conversations/${m.conversationId}/messages/${m._id}/image` : undefined,
      product: p ? { id: String(p._id), name: p.name, thumbnailUrl: p.images?.[0]?.thumbnailUrl ?? null, retailPriceKobo: p.retailPriceKobo, unit: p.unit } : null,
      orderRef: o ? { id: String(o._id), reference: o.reference, status: o.status } : null,
      quotationRef: q ? { id: String(q._id), reference: q.reference, status: q.status } : null,
      readByOtherSide: !!m.readAt,
      createdAt: iso(m.createdAt)!,
    } as MessageDto;
  });
}

export async function toConversationDtos(list: any[], viewerSide: Side): Promise<ConversationDto[]> {
  const shops = await Shop.find({ _id: { $in: list.map((c) => c.shopId) } }).select('name slug logoUrl').lean();
  const customers = await User.find({ _id: { $in: list.map((c) => c.customerId) } }).select('fullName avatarUrl').lean();
  const blocks = await Promise.all(list.map((c) => isBlocked(c.customerId, c.shopId)));
  return list.map((c, i) => {
    const s = shops.find((x) => String(x._id) === String(c.shopId));
    const u = customers.find((x) => String(x._id) === String(c.customerId));
    return {
      id: String(c._id),
      shop: { id: String(c.shopId), name: s?.name ?? '', slug: s?.slug ?? '', logoUrl: s?.logoUrl ?? null },
      customer: { id: String(c.customerId), fullName: u?.fullName ?? 'Customer', avatarUrl: u?.avatarUrl ?? null },
      lastMessage: c.lastMessage?.at ? { text: c.lastMessage.text ?? '', type: c.lastMessage.type, at: iso(c.lastMessage.at)!, senderId: String(c.lastMessage.senderId ?? '') } : null,
      unreadCount: viewerSide === 'customer' ? c.customerUnread : c.shopUnread,
      blocked: blocks[i],
      updatedAt: iso(c.lastMessageAt ?? c.updatedAt)!,
    };
  });
}

/** Marks the other side's messages as read for the viewer's side and notifies the room. */
export async function markRead(access: ConversationAccess, userId: string) {
  const { conversation, side } = access;
  const otherSide = side === 'customer' ? 'shop' : 'customer';
  const now = new Date();
  await Message.updateMany({ conversationId: conversation._id, senderSide: { $in: [otherSide, 'system'] }, readAt: null }, { $set: { readAt: now } });
  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: side === 'customer' ? { customerUnread: 0, customerLastReadAt: now } : { shopUnread: 0, shopLastReadAt: now } },
  );
  await ConversationParticipant.updateOne({ conversationId: conversation._id, userId }, { $set: { side, lastReadAt: now } }, { upsert: true });
  emitToConversation(String(conversation._id), SOCKET_EVENTS.messageRead, { conversationId: String(conversation._id), side, readAt: now.toISOString() });
}
