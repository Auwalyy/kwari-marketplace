/**
 * Domain constants shared by the API and the mobile app.
 * Nothing in this package may depend on Node-only or React Native-only libraries.
 */

export const CURRENCY = 'NGN' as const;
export const BUSINESS_TIMEZONE = 'Africa/Lagos' as const;

/** Platform-level roles. Shop / house roles are expressed through memberships, not here. */
export const PLATFORM_ROLES = ['admin', 'market_manager'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const ACCOUNT_STATUSES = ['active', 'suspended', 'deleted'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const RECORD_STATUSES = ['active', 'inactive', 'archived'] as const;

export const VERIFICATION_STATUSES = ['unverified', 'pending', 'verified', 'rejected'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_TYPES = ['house_head', 'house', 'shop', 'shop_ownership'] as const;
export type VerificationType = (typeof VERIFICATION_TYPES)[number];

export const VERIFICATION_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'appealed', 'withdrawn'] as const;

/** Shop lifecycle. A shop is only publicly listed when `active` and its house membership is approved. */
export const SHOP_STATUSES = ['pending_membership', 'active', 'rejected', 'suspended', 'closed'] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

export const HOUSE_MEMBERSHIP_STATUSES = ['pending', 'approved', 'rejected', 'removed', 'left'] as const;
export type HouseMembershipStatus = (typeof HOUSE_MEMBERSHIP_STATUSES)[number];

export const SHOP_MEMBER_ROLES = ['owner', 'worker'] as const;
export type ShopMemberRole = (typeof SHOP_MEMBER_ROLES)[number];

/**
 * Granular worker permissions. Owners implicitly hold all of them plus owner-only capabilities
 * (ownership transfer, payout details, house membership, worker management).
 */
export const SHOP_PERMISSIONS = [
  'products.manage',
  'inventory.manage',
  'orders.manage',
  'chats.manage',
  'quotations.manage',
  'reports.view',
  'sales.record',
  'finance.view',
] as const;
export type ShopPermission = (typeof SHOP_PERMISSIONS)[number];

export const SHOP_PERMISSION_LABELS: Record<ShopPermission, string> = {
  'products.manage': 'Manage products',
  'inventory.manage': 'Manage inventory',
  'orders.manage': 'Manage orders',
  'chats.manage': 'Answer customer chats',
  'quotations.manage': 'Manage quotations',
  'reports.view': 'View basic sales reports',
  'sales.record': 'Record in-shop sales and debt payments',
  'finance.view': 'See money: profit, expenses and debts',
};

export const INVITATION_STATUSES = ['active', 'revoked', 'expired', 'exhausted'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** Platform policy limits for invitation codes. */
export const INVITATION_POLICY = {
  maxExpiryDays: 30,
  defaultExpiryDays: 7,
  maxUses: 50,
  defaultMaxUses: 1,
} as const;

export const MEASUREMENT_UNITS = ['yard', 'metre', 'piece', 'bundle', 'roll', 'set', 'pack'] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

export const UNIT_LABELS: Record<MeasurementUnit, { singular: string; plural: string }> = {
  yard: { singular: 'yard', plural: 'yards' },
  metre: { singular: 'metre', plural: 'metres' },
  piece: { singular: 'piece', plural: 'pieces' },
  bundle: { singular: 'bundle', plural: 'bundles' },
  roll: { singular: 'roll', plural: 'rolls' },
  set: { singular: 'set', plural: 'sets' },
  pack: { singular: 'pack', plural: 'packs' },
};

export const PRODUCT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const MODERATION_STATUSES = ['approved', 'flagged', 'removed'] as const;

export const STOCK_STATUSES = ['in_stock', 'low_stock', 'out_of_stock'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const INVENTORY_MOVEMENT_REASONS = [
  'initial',
  'restock',
  'adjustment',
  'order_reserved',
  'order_released',
  'damaged',
  'sale_in_shop',
  'sale_voided',
] as const;

/* Shop books: sales made in the shop (not through the app) and expenses ------------------------- */

/** How a customer paid in the shop. A sale paid in part is "on credit" for the rest. */
export const SALE_PAYMENT_METHODS = ['cash', 'transfer', 'pos'] as const;
export type SalePaymentMethod = (typeof SALE_PAYMENT_METHODS)[number];
export const SALE_PAYMENT_METHOD_LABELS: Record<SalePaymentMethod, string> = {
  cash: 'Cash',
  transfer: 'Bank transfer',
  pos: 'POS / card',
};

export const EXPENSE_CATEGORIES = [
  'stock_purchase',
  'rent',
  'market_levy',
  'staff',
  'transport',
  'utilities',
  'phone_data',
  'packaging',
  'repairs',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  stock_purchase: 'Buying stock',
  rent: 'Shop rent',
  market_levy: 'Market levy & dues',
  staff: 'Staff pay',
  transport: 'Transport & loading',
  utilities: 'Electricity & generator',
  phone_data: 'Phone & data',
  packaging: 'Bags & packaging',
  repairs: 'Repairs',
  other: 'Other',
};

export const BOOKS_PERIODS = ['today', 'yesterday', 'week', 'month', 'last_month', '30d', '90d', 'year'] as const;
export type BooksPeriod = (typeof BOOKS_PERIODS)[number];
export const BOOKS_PERIOD_LABELS: Record<BooksPeriod, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  month: 'This month',
  last_month: 'Last month',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  year: 'This year',
};

export const FULFILMENT_METHODS = ['pickup', 'delivery'] as const;
export type FulfilmentMethod = (typeof FULFILMENT_METHODS)[number];

export const PAYMENT_METHODS = ['cash_on_pickup', 'bank_transfer', 'online'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash_on_pickup: 'Cash on pickup',
  bank_transfer: 'Bank transfer (arranged with seller)',
  online: 'Pay online',
};

/**
 * Payment status. `seller_confirmed` (bank transfer / cash acknowledged by the seller) is deliberately
 * distinct from `paid`, which is only ever set after gateway verification.
 */
export const PAYMENT_STATUSES = [
  'unpaid',
  'pending',
  'paid',
  'seller_confirmed',
  'failed',
  'cancelled',
  'refund_pending',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_STATUSES = [
  'pending_acceptance',
  'accepted',
  'rejected',
  'processing',
  'ready',
  'dispatched',
  'delivered',
  'completed',
  'cancelled',
  'refund_pending',
  'refunded',
  'disputed',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_acceptance: 'Pending seller acceptance',
  accepted: 'Accepted',
  rejected: 'Rejected',
  processing: 'Processing',
  ready: 'Ready',
  dispatched: 'Dispatched',
  delivered: 'Delivered / collected',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refund_pending: 'Refund pending',
  refunded: 'Refunded',
  disputed: 'Disputed',
};

export type OrderActor = 'customer' | 'seller' | 'admin' | 'system';

/**
 * Allowed order transitions and who may perform them. Enforced on the server; the mobile app uses this
 * map only to decide which buttons to show.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, Partial<Record<OrderStatus, OrderActor[]>>> = {
  pending_acceptance: {
    accepted: ['seller'],
    rejected: ['seller'],
    cancelled: ['customer', 'seller', 'admin', 'system'],
  },
  accepted: {
    processing: ['seller'],
    ready: ['seller'],
    cancelled: ['customer', 'seller', 'admin'],
  },
  processing: {
    ready: ['seller'],
    cancelled: ['seller', 'admin'],
  },
  ready: {
    dispatched: ['seller'],
    delivered: ['seller'],
    cancelled: ['seller', 'admin'],
  },
  dispatched: {
    delivered: ['seller'],
    disputed: ['customer', 'admin'],
  },
  delivered: {
    completed: ['customer', 'admin', 'system'],
    disputed: ['customer', 'admin'],
  },
  completed: {
    disputed: ['customer', 'admin'],
  },
  rejected: {},
  cancelled: {
    refund_pending: ['admin', 'system'],
  },
  refund_pending: {
    refunded: ['admin', 'system'],
  },
  refunded: {},
  disputed: {
    completed: ['admin'],
    refund_pending: ['admin'],
    cancelled: ['admin'],
  },
};

/** Statuses during which reserved stock should be returned if the order ends. */
export const ORDER_STOCK_HOLDING_STATUSES: OrderStatus[] = ['pending_acceptance', 'accepted', 'processing', 'ready'];

export const DELIVERY_STATUSES = [
  'not_required',
  'awaiting_quote',
  'quoted',
  'scheduled',
  'out_for_delivery',
  'delivered',
  'collected',
  'failed',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const QUOTATION_STATUSES = ['requested', 'offered', 'countered', 'accepted', 'rejected', 'expired', 'converted', 'cancelled'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const MESSAGE_TYPES = ['text', 'image', 'product', 'order', 'quotation', 'system'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const REPORT_TARGETS = ['shop', 'product', 'message', 'review', 'user', 'order'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_CATEGORIES = [
  'fraud',
  'counterfeit',
  'misleading_listing',
  'harassment',
  'spam',
  'inappropriate_content',
  'payment_issue',
  'delivery_issue',
  'other',
] as const;

export const REPORT_STATUSES = ['open', 'investigating', 'resolved', 'dismissed'] as const;

export const NOTIFICATION_TYPES = [
  'order.new',
  'order.updated',
  'payment.updated',
  'message.new',
  'quotation.new',
  'quotation.updated',
  'house_invitation.created',
  'house_invitation.redeemed',
  'membership.updated',
  'worker_invitation.redeemed',
  'product.out_of_stock',
  'review.new',
  'report.updated',
  'verification.updated',
  'announcement',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Preference groups the user can toggle; each notification type belongs to one group. */
export const NOTIFICATION_PREFERENCE_GROUPS = ['orders', 'payments', 'messages', 'quotations', 'shop', 'trust', 'announcements'] as const;
export type NotificationPreferenceGroup = (typeof NOTIFICATION_PREFERENCE_GROUPS)[number];

export const NOTIFICATION_GROUP_OF: Record<NotificationType, NotificationPreferenceGroup> = {
  'order.new': 'orders',
  'order.updated': 'orders',
  'payment.updated': 'payments',
  'message.new': 'messages',
  'quotation.new': 'quotations',
  'quotation.updated': 'quotations',
  'house_invitation.created': 'shop',
  'house_invitation.redeemed': 'shop',
  'membership.updated': 'shop',
  'worker_invitation.redeemed': 'shop',
  'product.out_of_stock': 'shop',
  'review.new': 'shop',
  'report.updated': 'trust',
  'verification.updated': 'trust',
  announcement: 'announcements',
};

export const PROMOTION_TYPES = ['featured_shop', 'featured_product', 'sponsored_search'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];
export const PROMOTION_STATUSES = ['pending', 'approved', 'rejected', 'active', 'ended', 'cancelled'] as const;

export const SUBSCRIPTION_PLANS = ['free', 'standard', 'premium'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

/** Socket.IO event names. Payload schemas are documented in docs/realtime-events.md. */
export const SOCKET_EVENTS = {
  messageNew: 'message:new',
  messageRead: 'message:read',
  messageSend: 'message:send',
  conversationJoin: 'conversation:join',
  conversationLeave: 'conversation:leave',
  conversationTyping: 'conversation:typing',
  conversationPresence: 'conversation:presence',
  orderUpdated: 'order:updated',
  quotationUpdated: 'quotation:updated',
  notificationNew: 'notification:new',
} as const;

export const UPLOAD_LIMITS = {
  maxImageBytes: 8 * 1024 * 1024,
  maxImagesPerProduct: 8,
  minImageDimension: 64,
  maxImageDimension: 12000,
  allowedImageMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
} as const;
