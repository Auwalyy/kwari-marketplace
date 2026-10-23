import type {
  BooksPeriod,
  ExpenseCategory,
  SalePaymentMethod,
  DeliveryStatus,
  FulfilmentMethod,
  HouseMembershipStatus,
  InvitationStatus,
  MeasurementUnit,
  MessageType,
  NotificationType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PlatformRole,
  ProductStatus,
  QuotationStatus,
  ShopPermission,
  ShopStatus,
  StockStatus,
  VerificationStatus,
} from './constants';

/* Envelope ------------------------------------------------------------------------------------- */

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PageMeta & Record<string, unknown>;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
    requestId?: string;
  };
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

/* Users & auth --------------------------------------------------------------------------------- */

export interface ShopMembershipSummary {
  shopId: string;
  shopName: string;
  shopSlug: string;
  role: 'owner' | 'worker';
  permissions: ShopPermission[];
  shopStatus: ShopStatus;
}

export interface HouseHeadSummary {
  houseId: string;
  houseNumber: string;
  houseName: string;
  marketName: string;
  verificationStatus: VerificationStatus;
}

export interface UserDto {
  id: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  avatarUrl?: string | null;
  platformRoles: PlatformRole[];
  managedMarketIds: string[];
  managedSectionIds: string[];
  status: 'active' | 'suspended' | 'deleted';
  notificationPreferences: { push: boolean; groups: Record<string, boolean> };
  createdAt: string;
}

export interface MeDto extends UserDto {
  shops: ShopMembershipSummary[];
  houses: HouseHeadSummary[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

export interface AuthResponse {
  user: MeDto;
  tokens: AuthTokens;
}

export interface SessionDto {
  id: string;
  deviceName?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

/* Market hierarchy ----------------------------------------------------------------------------- */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface MarketDto {
  id: string;
  name: string;
  slug: string;
  description?: string;
  region: string;
  city: string;
  country: string;
  usesSections: boolean;
  location?: GeoPoint | null;
  status: string;
  stats?: { sections: number; houses: number; shops: number };
}

export interface SectionDto {
  id: string;
  marketId: string;
  name: string;
  code: string;
  description?: string;
  locationDescription?: string;
  location?: GeoPoint | null;
  houseCount?: number;
}

export interface LocationBreadcrumb {
  marketId: string;
  marketName: string;
  sectionId?: string | null;
  sectionName?: string | null;
  sectionCode?: string | null;
  houseId: string;
  houseNumber: string;
  houseName?: string;
  shopNumber?: string;
  /** e.g. "Kantin Kwari → Section B → House KW-024 → Shop 015" */
  label: string;
}

export interface HouseDto {
  id: string;
  marketId: string;
  sectionId?: string | null;
  houseNumber: string;
  name: string;
  description?: string;
  addressDescription: string;
  location?: GeoPoint | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  verificationStatus: VerificationStatus;
  hasHead: boolean;
  autoApproveMemberships: boolean;
  shopCount: number;
  breadcrumb: LocationBreadcrumb;
}

export interface HouseInvitationDto {
  id: string;
  houseId: string;
  codePreview: string;
  /** Only present in the response that created the invitation. */
  code?: string;
  status: InvitationStatus;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  intendedShopName?: string;
  intendedShopNumber?: string;
  note?: string;
  createdAt: string;
  revokedAt?: string | null;
}

export interface WorkerInvitationDto {
  id: string;
  shopId: string;
  codePreview: string;
  code?: string;
  status: InvitationStatus;
  permissions: ShopPermission[];
  title?: string;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  createdAt: string;
  revokedAt?: string | null;
}

export interface HouseMembershipDto {
  id: string;
  houseId: string;
  shopId: string;
  shop: { id: string; name: string; shopNumber: string; ownerName: string; status: ShopStatus };
  status: HouseMembershipStatus;
  reason?: string;
  decidedAt?: string | null;
  createdAt: string;
  dispute?: {
    status: 'open' | 'responded' | 'resolved';
    statement?: string;
    response?: string;
    resolution?: string;
    openedAt?: string | null;
    respondedAt?: string | null;
  };
}

/* Shops ---------------------------------------------------------------------------------------- */

export interface DeliveryOptionDto {
  id: string;
  name: string;
  description?: string;
  feeKobo: number | null;
  estimatedDays?: string;
  areas: string[];
  active: boolean;
}

export interface ShopSummaryDto {
  id: string;
  name: string;
  slug: string;
  shopNumber: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  verificationStatus: VerificationStatus;
  ratingAverage: number;
  ratingCount: number;
  wholesaleAvailable: boolean;
  activeProductCount: number;
  breadcrumb: LocationBreadcrumb;
  categoryNames: string[];
  sponsored?: boolean;
}

export interface ShopDto extends ShopSummaryDto {
  shopCode: string;
  description?: string;
  categoryIds: string[];
  status: ShopStatus;
  locationDescription?: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  whatsappPhone?: string | null;
  contactPreferences: { chat: boolean; phone: boolean; whatsapp: boolean };
  businessHours: { day: number; open: string; close: string; closed: boolean }[];
  pickupAvailable: boolean;
  pickupInstructions?: string;
  deliveryAvailable: boolean;
  deliveryOptions: DeliveryOptionDto[];
  acceptedPaymentMethods: PaymentMethod[];
  bankTransferInstructions?: string;
  enabledUnits: MeasurementUnit[];
  ownerId: string;
  createdAt: string;
}

export interface ShopWorkerDto {
  membershipId: string;
  userId: string;
  fullName: string;
  title?: string;
  role: 'owner' | 'worker';
  permissions: ShopPermission[];
  status: 'active' | 'revoked';
  joinedAt: string;
}

/* Products ------------------------------------------------------------------------------------- */

export interface ProductImageDto {
  id: string;
  url: string;
  thumbnailUrl: string;
  width?: number;
  height?: number;
  embeddingStatus: 'pending' | 'processing' | 'ready' | 'failed' | 'disabled';
}

export interface ProductVariantDto {
  id: string;
  label: string;
  colour?: string;
  pattern?: string;
  size?: string;
  sku?: string;
  priceOverrideKobo?: number | null;
  stockQuantity: number;
  active: boolean;
}

export interface ProductSummaryDto {
  id: string;
  name: string;
  slug: string;
  thumbnailUrl?: string | null;
  retailPriceKobo: number;
  wholesalePriceKobo?: number | null;
  wholesaleMinQuantity?: number | null;
  unit: MeasurementUnit;
  stockStatus: StockStatus;
  status: ProductStatus;
  shop: { id: string; name: string; slug: string; verificationStatus: VerificationStatus; breadcrumb: LocationBreadcrumb };
  categoryName?: string;
  ratingAverage: number;
  ratingCount: number;
  sponsored?: boolean;
}

export interface ProductDto extends ProductSummaryDto {
  /** Shop staff with finance access only; never sent to customers. */
  costPriceKobo?: number | null;
  description?: string;
  categoryId: string;
  subcategory?: string;
  images: ProductImageDto[];
  variants: ProductVariantDto[];
  minOrderQuantity: number;
  stockQuantity: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  material?: string;
  brand?: string;
  colours: string[];
  patterns: string[];
  keywords: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parentId?: string | null;
  iconName?: string;
  productCount?: number;
}

export interface VisualMatchDto {
  product: ProductSummaryDto;
  /** Cosine similarity in [0,1] for the best-matching image of the product. */
  similarity: number;
  /**
   * Human-readable relevance band, graded against the threshold and the best score of the search.
   * `best_match` marks a strong top result clearly ahead of the rest; no band claims an identical fabric.
   */
  relevance: 'best_match' | 'very_similar' | 'similar' | 'somewhat_similar';
  matchedImageUrl: string;
}

export interface VisualSearchResponse {
  matches: VisualMatchDto[];
  meta: PageMeta & { provider: string; searchId: string };
}

/* Commerce ------------------------------------------------------------------------------------- */

export interface AddressDto {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  landmark?: string;
  location?: GeoPoint | null;
  isDefault: boolean;
}

export interface CartLineDto {
  id: string;
  productId: string;
  variantId?: string | null;
  productName: string;
  variantLabel?: string | null;
  thumbnailUrl?: string | null;
  unit: MeasurementUnit;
  quantity: number;
  unitPriceKobo: number;
  wholesaleApplied: boolean;
  lineTotalKobo: number;
  available: boolean;
  issue?: string | null;
  quotationId?: string | null;
}

export interface CartShopGroupDto {
  shop: ShopSummaryDto & {
    pickupAvailable: boolean;
    deliveryAvailable: boolean;
    deliveryOptions: DeliveryOptionDto[];
    acceptedPaymentMethods: PaymentMethod[];
  };
  lines: CartLineDto[];
  subtotalKobo: number;
}

export interface CartDto {
  groups: CartShopGroupDto[];
  itemCount: number;
  subtotalKobo: number;
}

export interface OrderItemDto {
  id: string;
  productId: string;
  variantId?: string | null;
  productName: string;
  variantLabel?: string | null;
  thumbnailUrl?: string | null;
  unit: MeasurementUnit;
  quantity: number;
  unitPriceKobo: number;
  wholesaleApplied: boolean;
  lineTotalKobo: number;
}

export interface OrderEventDto {
  status: OrderStatus;
  actorRole: string;
  note?: string;
  at: string;
}

export interface DeliveryDto {
  id: string;
  method: FulfilmentMethod;
  status: DeliveryStatus;
  optionName?: string;
  feeKobo?: number | null;
  address?: AddressDto | null;
  pickupInstructions?: string;
  estimatedDelivery?: string;
  provider?: string;
  history: { status: DeliveryStatus; note?: string; at: string }[];
}

export interface OrderDto {
  id: string;
  reference: string;
  checkoutId: string;
  customer: { id: string; fullName: string; phone?: string | null };
  shop: ShopSummaryDto;
  items: OrderItemDto[];
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  fulfilmentMethod: FulfilmentMethod;
  subtotalKobo: number;
  deliveryFeeKobo: number;
  totalKobo: number;
  note?: string;
  delivery?: DeliveryDto | null;
  events: OrderEventDto[];
  quotationId?: string | null;
  allowedTransitions: OrderStatus[];
  reviewable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutResultDto {
  checkoutId: string;
  orders: OrderDto[];
}

export interface PaymentDto {
  id: string;
  orderId: string;
  provider: string;
  reference: string;
  amountKobo: number;
  status: PaymentStatus;
  verified: boolean;
  authorizationUrl?: string | null;
  createdAt: string;
  paidAt?: string | null;
}

export interface QuotationItemDto {
  id: string;
  productId: string;
  variantId?: string | null;
  productName: string;
  unit: MeasurementUnit;
  quantity: number;
  targetUnitPriceKobo?: number | null;
  offeredUnitPriceKobo?: number | null;
  listUnitPriceKobo: number;
}

export interface QuotationDto {
  id: string;
  reference: string;
  shop: { id: string; name: string; slug: string };
  customer: { id: string; fullName: string };
  items: QuotationItemDto[];
  status: QuotationStatus;
  message?: string;
  sellerNote?: string;
  customerNote?: string;
  totalOfferedKobo?: number | null;
  expiresAt?: string | null;
  conversationId?: string | null;
  orderId?: string | null;
  history: { status: QuotationStatus; by: 'customer' | 'seller' | 'system'; note?: string; at: string }[];
  createdAt: string;
  updatedAt: string;
}

/* Communication -------------------------------------------------------------------------------- */

export interface ConversationDto {
  id: string;
  shop: { id: string; name: string; slug: string; logoUrl?: string | null };
  customer: { id: string; fullName: string; avatarUrl?: string | null };
  lastMessage?: { text: string; type: MessageType; at: string; senderId: string } | null;
  unreadCount: number;
  blocked: boolean;
  updatedAt: string;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  clientMessageId?: string;
  senderId: string;
  senderName: string;
  senderSide: 'customer' | 'shop' | 'system';
  type: MessageType;
  text?: string;
  imageUrl?: string;
  product?: { id: string; name: string; thumbnailUrl?: string | null; retailPriceKobo: number; unit: MeasurementUnit } | null;
  orderRef?: { id: string; reference: string; status: OrderStatus } | null;
  quotationRef?: { id: string; reference: string; status: QuotationStatus } | null;
  readByOtherSide: boolean;
  createdAt: string;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>;
  read: boolean;
  createdAt: string;
}

export interface ReviewDto {
  id: string;
  shopId: string;
  productId?: string | null;
  orderId: string;
  author: { id: string; fullName: string };
  rating: number;
  text?: string;
  response?: { text: string; at: string } | null;
  status: string;
  createdAt: string;
}

/* Shop books ----------------------------------------------------------------------------------- */

export interface ShopSaleItemDto {
  productId: string | null;
  variantId: string | null;
  name: string;
  unit: MeasurementUnit;
  quantity: number;
  unitPriceKobo: number;
  lineTotalKobo: number;
  /** Only for staff with finance access. */
  unitCostKobo?: number | null;
  thumbnailUrl?: string | null;
}

export interface ShopSaleDto {
  id: string;
  number: string;
  soldAt: string;
  customerName?: string;
  customerPhone?: string;
  items: ShopSaleItemDto[];
  subtotalKobo: number;
  discountKobo: number;
  totalKobo: number;
  amountPaidKobo: number;
  /** What the customer still owes. */
  balanceKobo: number;
  payments: { amountKobo: number; method: SalePaymentMethod; at: string; note?: string }[];
  status: 'completed' | 'voided';
  voidReason?: string;
  note?: string;
  recordedBy: { id: string; fullName: string };
  createdAt: string;
}

export interface ShopExpenseDto {
  id: string;
  category: ExpenseCategory;
  amountKobo: number;
  method: SalePaymentMethod;
  spentAt: string;
  note?: string;
  status: 'active' | 'voided';
  recordedBy: { id: string; fullName: string };
}

/** Advice the app shows the shop. Built from the shop's own sales, stock and books. */
export interface ShopInsightDto {
  id: string;
  kind: 'reorder' | 'sold_out' | 'slow_moving' | 'below_cost' | 'missing_cost' | 'debts' | 'trend' | 'best_seller' | 'orders' | 'enquiries';
  severity: 'urgent' | 'warning' | 'info' | 'good';
  title: string;
  message: string;
  productId?: string;
  /** Where the app goes when it is tapped. */
  action?: 'orders' | 'enquiries' | 'inventory' | 'products' | 'sales_owing' | 'product' | 'books';
}

export interface StockForecastDto {
  productId: string;
  name: string;
  unit: MeasurementUnit;
  thumbnailUrl: string | null;
  stockQuantity: number;
  stockStatus: StockStatus;
  /** Units sold over the last 30 days (app orders + in-shop sales). */
  soldLast30: number;
  dailyRate: number;
  /** null when nothing has sold recently. */
  daysLeft: number | null;
  /** Quantity to buy so stock lasts about a month at the current rate. */
  suggestedReorder: number;
  /** Only for staff with finance access. */
  costPriceKobo?: number | null;
  retailPriceKobo: number;
}

export interface ShopDashboardDto {
  today: { salesKobo: number; salesCount: number; collectedKobo: number; appOrdersKobo: number; inShopKobo: number; profitKobo: number | null };
  pendingOrders: number;
  unreadEnquiries: number;
  pendingQuotations: number;
  /** Total customers owe. Only with finance access. */
  owedKobo: number | null;
  lowStockCount: number;
  outOfStockCount: number;
  insights: ShopInsightDto[];
}

export interface BooksSummaryDto {
  period: { key: BooksPeriod; label: string; from: string; to: string };
  revenue: { totalKobo: number; appKobo: number; inShopKobo: number; appCount: number; inShopCount: number; changePct: number | null };
  collected: { totalKobo: number; byMethod: { method: SalePaymentMethod | 'online'; kobo: number }[] };
  owed: { totalKobo: number; customers: number; overdueKobo: number };
  costOfGoodsKobo: number;
  /** Share of sold value whose cost price is known (0–1). Below 1 the profit is an estimate. */
  costCoverage: number;
  expenses: { totalKobo: number; operatingKobo: number; stockPurchasesKobo: number; byCategory: { category: ExpenseCategory; kobo: number }[] };
  grossProfitKobo: number;
  netProfitKobo: number;
  trend: { date: string; appKobo: number; inShopKobo: number; expensesKobo: number }[];
  topProducts: { productId: string | null; name: string; unit: MeasurementUnit; quantity: number; revenueKobo: number; profitKobo: number | null }[];
  stock: { retailValueKobo: number; costValueKobo: number; productsMissingCost: number };
  insights: ShopInsightDto[];
}

/* Analytics ------------------------------------------------------------------------------------ */

export interface ShopAnalyticsDto {
  orderCounts: Partial<Record<OrderStatus, number>>;
  /** Sum of all non-cancelled/rejected orders (value of demand, not revenue). */
  orderValueKobo: number;
  /** Sum of orders that reached completed/delivered. */
  completedSalesKobo: number;
  /** Payments verified by the gateway. */
  gatewayVerifiedKobo: number;
  /** Cash / transfer payments confirmed by the seller (not independently verified). */
  sellerConfirmedKobo: number;
  bestSellers: { productId: string; name: string; quantity: number; valueKobo: number }[];
  inventoryAlerts: { productId: string; name: string; stockQuantity: number; stockStatus: StockStatus }[];
  pendingQuotations: number;
  openConversations: number;
  recentReviews: ReviewDto[];
  salesTrend: { date: string; orderValueKobo: number; completedSalesKobo: number; orders: number }[];
  workerActivity?: { userId: string; fullName: string; actions: number }[];
}
