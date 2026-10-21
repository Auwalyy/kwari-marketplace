import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { MESSAGE_TYPES } from '@kkdm/shared';

/**
 * A conversation is between one customer and one shop. Any shop member with `chats.manage` (and the
 * owner) can participate on the shop side. Unread counters are tracked per side.
 */
const conversationSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    lastMessage: {
      text: String,
      type: { type: String },
      senderId: Schema.Types.ObjectId,
      at: Date,
    },
    lastMessageAt: { type: Date, default: Date.now },
    customerUnread: { type: Number, default: 0 },
    shopUnread: { type: Number, default: 0 },
    customerLastReadAt: { type: Date, default: null },
    shopLastReadAt: { type: Date, default: null },
    status: { type: String, enum: ['open', 'archived'], default: 'open' },
  },
  { timestamps: true },
);
conversationSchema.index({ shopId: 1, customerId: 1 }, { unique: true });
conversationSchema.index({ customerId: 1, lastMessageAt: -1 });
conversationSchema.index({ shopId: 1, lastMessageAt: -1 });
export type ConversationDoc = HydratedDocument<InferSchemaType<typeof conversationSchema>>;
export const Conversation = model('Conversation', conversationSchema);

/** Per-user participation state (who has engaged, personal read marker, mute). */
const participantSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    side: { type: String, enum: ['customer', 'shop'], required: true },
    lastReadAt: { type: Date, default: null },
    muted: { type: Boolean, default: false },
  },
  { timestamps: true },
);
participantSchema.index({ conversationId: 1, userId: 1 }, { unique: true });
export const ConversationParticipant = model('ConversationParticipant', participantSchema);

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    senderSide: { type: String, enum: ['customer', 'shop', 'system'], required: true },
    /** Client-generated id; with senderId it de-duplicates resends after reconnects. */
    clientMessageId: { type: String, default: null },
    type: { type: String, enum: MESSAGE_TYPES, required: true },
    text: { type: String, maxlength: 4000 },
    imageUrl: String,
    imageKey: String,
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    quotationId: { type: Schema.Types.ObjectId, ref: 'Quotation', default: null },
    readAt: { type: Date, default: null },
    hiddenAt: { type: Date, default: null },
  },
  { timestamps: true },
);
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index(
  { senderId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } },
);
export type MessageDoc = HydratedDocument<InferSchemaType<typeof messageSchema>>;
export const Message = model('Message', messageSchema);
