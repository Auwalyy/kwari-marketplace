import { z } from 'zod';
import {
  FULFILMENT_METHODS,
  INVITATION_POLICY,
  MEASUREMENT_UNITS,
  PAYMENT_METHODS,
  PRODUCT_STATUSES,
  REPORT_CATEGORIES,
  REPORT_TARGETS,
  SHOP_PERMISSIONS,
  VERIFICATION_TYPES,
  SALE_PAYMENT_METHODS,
  EXPENSE_CATEGORIES,
  BOOKS_PERIODS,
  PROMOTION_TYPES,
  NOTIFICATION_PREFERENCE_GROUPS,
} from './constants';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/**
 * Builds a PATCH schema: every field optional and *without* defaults. (In Zod 4 `.partial()` keeps
 * defaults, which would silently reset omitted fields on update.)
 */
export function partialUpdate<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(schema.shape)) {
    let inner = value as z.ZodType;
    while (inner instanceof z.ZodDefault) inner = inner.unwrap() as z.ZodType;
    shape[key] = inner.optional();
  }
  return z.object(shape) as unknown as z.ZodObject<{ [K in keyof T]: z.ZodOptional<z.ZodType<z.output<T[K]>, z.input<T[K]>>> }>;
}

/** Normalises Nigerian phone numbers to E.164 (+234XXXXXXXXXX). Other E.164 numbers are accepted as-is. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, '');
  if (/^\+234[789][01]\d{8}$/.test(digits)) return digits;
  if (/^234[789][01]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^0[789][01]\d{8}$/.test(digits)) return `+234${digits.slice(1)}`;
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number, e.g. 0803 123 4567' });
      return z.NEVER;
    }
    return n;
  });

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

const name = z.string().trim().min(2, 'Too short').max(80, 'Too long');
const optionalText = (max: number) => z.string().trim().max(max).optional();
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes')
  .max(80);

/* ----------------------------------------------------------------------------------------------- */
/* Auth                                                                                            */
/* ----------------------------------------------------------------------------------------------- */

export const registerSchema = z
  .object({
    fullName: name,
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
  })
  .refine((v) => v.email || v.phone, { message: 'Provide an email address or a phone number', path: ['email'] });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email or phone number').max(120),
  password: z.string().min(1, 'Enter your password').max(128),
  deviceName: z.string().trim().max(80).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(500) });

export const requestVerificationSchema = z.object({ channel: z.enum(['email', 'phone']) });
export const confirmVerificationSchema = z.object({
  channel: z.enum(['email', 'phone']),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const forgotPasswordSchema = z.object({ identifier: z.string().trim().min(3).max(120) });
export const resetPasswordSchema = z.object({
  identifier: z.string().trim().min(3).max(120),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  newPassword: passwordSchema,
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  fullName: name.optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  avatarUrl: z.url().optional().nullable(),
});

export const notificationPreferencesSchema = z.object({
  push: z.boolean().optional(),
  groups: z.partialRecord(z.enum(NOTIFICATION_PREFERENCE_GROUPS), z.boolean()).optional(),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(128),
  reason: optionalText(500),
});

/* ----------------------------------------------------------------------------------------------- */
/* Market hierarchy                                                                                */
/* ----------------------------------------------------------------------------------------------- */

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const marketSchema = z.object({
  name: name,
  slug: slugSchema,
  description: optionalText(2000),
  region: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  country: z.string().trim().length(2).default('NG'),
  usesSections: z.boolean().default(true),
  location: geoPointSchema.optional(),
  status: z.enum(['active', 'inactive']).default('active'),
});

export const sectionSchema = z.object({
  name: name,
  code: z.string().trim().toUpperCase().min(1).max(12),
  description: optionalText(1000),
  locationDescription: optionalText(500),
  location: geoPointSchema.optional(),
});

export const houseSchema = z.object({
  marketId: objectId,
  sectionId: objectId.optional().nullable(),
  houseNumber: z.string().trim().toUpperCase().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  description: optionalText(2000),
  addressDescription: z.string().trim().min(3).max(500),
  location: geoPointSchema.optional(),
  contactPhone: phoneSchema.optional(),
  contactEmail: emailSchema.optional(),
});

export const houseUpdateSchema = partialUpdate(houseSchema.omit({ marketId: true, sectionId: true, houseNumber: true }));

export const houseClaimSchema = z.object({
  houseId: objectId,
  evidence: z.string().trim().min(10, 'Describe your evidence of house headship').max(2000),
  documentUrls: z.array(z.url()).max(5).default([]),
});

export const createHouseInvitationSchema = z.object({
  expiresInDays: z.number().int().min(1).max(INVITATION_POLICY.maxExpiryDays).default(INVITATION_POLICY.defaultExpiryDays),
  maxUses: z.number().int().min(1).max(INVITATION_POLICY.maxUses).default(INVITATION_POLICY.defaultMaxUses),
  intendedShopName: optionalText(120),
  intendedShopNumber: optionalText(20),
  note: optionalText(500),
});

export const createWorkerInvitationSchema = z.object({
  permissions: z.array(z.enum(SHOP_PERMISSIONS)).min(1, 'Select at least one permission'),
  title: optionalText(60),
  expiresInDays: z.number().int().min(1).max(INVITATION_POLICY.maxExpiryDays).default(INVITATION_POLICY.defaultExpiryDays),
  maxUses: z.number().int().min(1).max(10).default(1),
});

export const invitationCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^[A-Z0-9]{8,16}$/, 'Enter a valid invitation code')),
});

export const membershipDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: optionalText(500),
});

/* ----------------------------------------------------------------------------------------------- */
/* Shops & products                                                                                */
/* ----------------------------------------------------------------------------------------------- */

const businessHoursSchema = z
  .array(
    z.object({
      day: z.number().int().min(0).max(6),
      open: z.string().regex(/^\d{2}:\d{2}$/),
      close: z.string().regex(/^\d{2}:\d{2}$/),
      closed: z.boolean().default(false),
    }),
  )
  .max(7);

export const deliveryOptionSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: optionalText(300),
  feeKobo: z.number().int().min(0).nullable().describe('null = fee quoted per order'),
  estimatedDays: optionalText(40),
  areas: z.array(z.string().trim().max(60)).max(30).default([]),
  active: z.boolean().default(true),
});

export const shopFulfilmentSchema = z.object({
  pickupAvailable: z.boolean(),
  pickupInstructions: optionalText(500),
  deliveryAvailable: z.boolean(),
  deliveryOptions: z.array(deliveryOptionSchema).max(10).default([]),
  acceptedPaymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1),
  bankTransferInstructions: optionalText(500),
});

export const shopRegistrationSchema = z.object({
  invitationCode: invitationCodeSchema.shape.code,
  name: z.string().trim().min(2).max(100),
  shopNumber: z.string().trim().toUpperCase().min(1).max(20),
  description: optionalText(2000),
  categoryIds: z.array(objectId).max(10).default([]),
  locationDescription: optionalText(500),
  contactPhone: phoneSchema.optional(),
  contactEmail: emailSchema.optional(),
  whatsappPhone: phoneSchema.optional(),
});
export type ShopRegistrationInput = z.infer<typeof shopRegistrationSchema>;

export const shopUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: optionalText(2000),
  categoryIds: z.array(objectId).max(10).optional(),
  locationDescription: optionalText(500),
  contactPhone: phoneSchema.optional().nullable(),
  contactEmail: emailSchema.optional().nullable(),
  whatsappPhone: phoneSchema.optional().nullable(),
  businessHours: businessHoursSchema.optional(),
  wholesaleAvailable: z.boolean().optional(),
  contactPreferences: z
    .object({ chat: z.boolean(), phone: z.boolean(), whatsapp: z.boolean() })
    .partial()
    .optional(),
  enabledUnits: z.array(z.enum(MEASUREMENT_UNITS)).min(1).optional(),
});

const priceKobo = z.number().int().min(0).max(1_000_000_000_00);
const quantity = z.number().min(0).max(10_000_000).multipleOf(0.01);

export const variantSchema = z.object({
  _id: objectId.optional(),
  label: z.string().trim().min(1).max(60),
  colour: optionalText(40),
  pattern: optionalText(60),
  size: optionalText(40),
  sku: optionalText(40),
  priceOverrideKobo: priceKobo.optional().nullable(),
  stockQuantity: quantity.default(0),
  active: z.boolean().default(true),
});

const productBase = z.object({
  name: z.string().trim().min(2).max(140),
  description: optionalText(4000),
  categoryId: objectId,
  subcategory: optionalText(80),
  retailPriceKobo: priceKobo,
  wholesalePriceKobo: priceKobo.optional().nullable(),
  wholesaleMinQuantity: quantity.optional().nullable(),
  /** What one unit cost the shop. Private to the owner and staff with finance access. */
  costPriceKobo: priceKobo.optional().nullable(),
  minOrderQuantity: quantity.min(0.01).default(1),
  unit: z.enum(MEASUREMENT_UNITS),
  stockQuantity: quantity.default(0),
  lowStockThreshold: quantity.default(5),
  trackInventory: z.boolean().default(true),
  variants: z.array(variantSchema).max(50).default([]),
  material: optionalText(80),
  brand: optionalText(80),
  colours: z.array(z.string().trim().toLowerCase().max(30)).max(12).default([]),
  patterns: z.array(z.string().trim().toLowerCase().max(40)).max(12).default([]),
  keywords: z.array(z.string().trim().toLowerCase().max(40)).max(25).default([]),
  status: z.enum(PRODUCT_STATUSES).default('draft'),
});

function refineWholesale<T extends z.ZodType<{ wholesalePriceKobo?: number | null; wholesaleMinQuantity?: number | null; retailPriceKobo?: number }>>(s: T) {
  return s.superRefine((v, ctx) => {
    const hasPrice = v.wholesalePriceKobo != null;
    const hasMin = v.wholesaleMinQuantity != null;
    if (hasPrice !== hasMin) {
      ctx.addIssue({ code: 'custom', path: ['wholesaleMinQuantity'], message: 'Wholesale price and minimum quantity must be set together' });
    }
    if (hasPrice && v.retailPriceKobo != null && v.wholesalePriceKobo! > v.retailPriceKobo) {
      ctx.addIssue({ code: 'custom', path: ['wholesalePriceKobo'], message: 'Wholesale price should not exceed the retail price' });
    }
  });
}

export const productCreateSchema = refineWholesale(productBase);
export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export const productUpdateSchema = refineWholesale(partialUpdate(productBase));
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export const inventoryAdjustSchema = z.object({
  variantId: objectId.optional(),
  delta: z.number().min(-10_000_000).max(10_000_000).multipleOf(0.01).refine((v) => v !== 0, 'Change cannot be zero'),
  reason: z.enum(['restock', 'adjustment', 'damaged']),
  note: optionalText(300),
  /** Restock only: what each unit cost. Updates the product's average cost price. */
  unitCostKobo: priceKobo.optional(),
  /** Restock only: also record the purchase in the shop's expenses as "Buying stock". */
  recordExpense: z.boolean().default(false),
});

/* Shop books ----------------------------------------------------------------------------------- */

export const saleItemInputSchema = z
  .object({
    /** A product from the shop's catalogue; stock is taken from it. Leave out for items not listed. */
    productId: objectId.optional(),
    variantId: objectId.optional(),
    /** Required for items that are not in the catalogue. */
    name: optionalText(140),
    unit: z.enum(MEASUREMENT_UNITS).optional(),
    quantity: quantity.min(0.01),
    /** Defaults to the product's retail or wholesale price for the quantity. */
    unitPriceKobo: priceKobo.optional(),
    /** Items not in the catalogue: what one unit cost, for profit. */
    unitCostKobo: priceKobo.optional(),
  })
  .refine((v) => !!v.productId || (!!v.name && v.unitPriceKobo != null), { message: 'Choose a product, or enter a name and price', path: ['name'] });

export const saleCreateSchema = z.object({
  items: z.array(saleItemInputSchema).min(1, 'Add at least one item').max(50),
  discountKobo: priceKobo.default(0),
  /** Defaults to the full total. Less than the total records the rest as owed by the customer. */
  amountPaidKobo: priceKobo.optional(),
  paymentMethod: z.enum(SALE_PAYMENT_METHODS).default('cash'),
  customerName: optionalText(80),
  customerPhone: optionalText(20),
  /** When the sale happened; defaults to now. Can be back-dated up to 60 days. */
  soldAt: z.coerce.date().optional(),
  note: optionalText(300),
  /** Set by the app so a retried request can't record the same sale twice. */
  clientRef: z.string().trim().max(64).optional(),
});
export type SaleCreateInput = z.infer<typeof saleCreateSchema>;

export const salePaymentSchema = z.object({
  amountKobo: priceKobo.min(1, 'Enter an amount'),
  method: z.enum(SALE_PAYMENT_METHODS).default('cash'),
  note: optionalText(200),
});

export const voidSchema = z.object({ reason: z.string().trim().min(3, 'Say why').max(200) });

export const expenseCreateSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amountKobo: priceKobo.min(1, 'Enter an amount'),
  method: z.enum(SALE_PAYMENT_METHODS).default('cash'),
  spentAt: z.coerce.date().optional(),
  note: optionalText(200),
});
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;

export const booksPeriodSchema = z.object({ period: z.enum(BOOKS_PERIODS).default('month') });

export const salesListSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  period: z.enum(BOOKS_PERIODS).optional(),
  /** Only sales the customer still owes money on. */
  owing: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().max(80).optional(),
});

export const expensesListSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  period: z.enum(BOOKS_PERIODS).optional(),
});

export const bulkProductActionSchema = z.object({
  productIds: z.array(objectId).min(1).max(100),
  action: z.enum(['publish', 'unpublish', 'archive']),
});

/* ----------------------------------------------------------------------------------------------- */
/* Search                                                                                          */
/* ----------------------------------------------------------------------------------------------- */

export const productSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: objectId.optional(),
  marketId: objectId.optional(),
  sectionId: objectId.optional(),
  houseId: objectId.optional(),
  shopId: objectId.optional(),
  minPriceKobo: z.coerce.number().int().min(0).optional(),
  maxPriceKobo: z.coerce.number().int().min(0).optional(),
  wholesaleOnly: z.coerce.boolean().optional(),
  inStockOnly: z.coerce.boolean().optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  colour: z.string().trim().toLowerCase().max(30).optional(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc', 'rating']).default('relevance'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ProductSearchQuery = z.infer<typeof productSearchSchema>;

export const visualSearchFiltersSchema = z.object({
  categoryId: objectId.optional(),
  marketId: objectId.optional(),
  houseId: objectId.optional(),
  minPriceKobo: z.coerce.number().int().min(0).optional(),
  maxPriceKobo: z.coerce.number().int().min(0).optional(),
  wholesaleOnly: z.coerce.boolean().optional(),
  inStockOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).max(10).default(1),
  limit: z.coerce.number().int().min(1).max(40).default(20),
});
export type VisualSearchFilters = z.infer<typeof visualSearchFiltersSchema>;

/* ----------------------------------------------------------------------------------------------- */
/* Commerce                                                                                        */
/* ----------------------------------------------------------------------------------------------- */

export const addressSchema = z.object({
  label: z.string().trim().min(1).max(40),
  recipientName: name,
  phone: phoneSchema,
  line1: z.string().trim().min(3).max(200),
  line2: optionalText(200),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  landmark: optionalText(200),
  location: geoPointSchema.optional(),
  isDefault: z.boolean().default(false),
});

export const cartItemSchema = z.object({
  productId: objectId,
  variantId: objectId.optional().nullable(),
  quantity: quantity.min(0.01),
});

export const cartItemUpdateSchema = z.object({ quantity: quantity.min(0.01) });

export const checkoutSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(100),
  shops: z
    .array(
      z.object({
        shopId: objectId,
        fulfilmentMethod: z.enum(FULFILMENT_METHODS),
        deliveryOptionId: objectId.optional(),
        paymentMethod: z.enum(PAYMENT_METHODS),
        note: optionalText(500),
      }),
    )
    .min(1),
  addressId: objectId.optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const orderTransitionSchema = z.object({
  status: z.string(),
  reason: optionalText(500),
  deliveryFeeKobo: z.number().int().min(0).optional(),
  estimatedDelivery: optionalText(120),
  trackingNote: optionalText(300),
});

export const quotationRequestSchema = z.object({
  shopId: objectId,
  items: z
    .array(
      z.object({
        productId: objectId,
        variantId: objectId.optional().nullable(),
        quantity: quantity.min(0.01),
        targetUnitPriceKobo: priceKobo.optional(),
      }),
    )
    .min(1)
    .max(20),
  message: optionalText(1000),
});

export const quotationOfferSchema = z.object({
  items: z
    .array(z.object({ itemId: objectId, unitPriceKobo: priceKobo, quantity: quantity.min(0.01).optional() }))
    .min(1),
  validForHours: z.number().int().min(1).max(24 * 14).default(72),
  sellerNote: optionalText(1000),
});

export const quotationRespondSchema = z.object({
  action: z.enum(['accept', 'reject', 'counter']),
  counterItems: z.array(z.object({ itemId: objectId, unitPriceKobo: priceKobo })).optional(),
  note: optionalText(1000),
});

export const paymentInitSchema = z.object({
  orderId: objectId,
  idempotencyKey: z.string().trim().min(8).max(100),
});

/* ----------------------------------------------------------------------------------------------- */
/* Communication & trust                                                                           */
/* ----------------------------------------------------------------------------------------------- */

export const startConversationSchema = z.object({
  shopId: objectId,
  productId: objectId.optional(),
  message: z.string().trim().min(1).max(2000).optional(),
});

export const sendMessageSchema = z
  .object({
    clientMessageId: z.string().trim().min(6).max(64),
    type: z.enum(['text', 'image', 'product', 'order', 'quotation']).default('text'),
    text: z.string().trim().max(4000).optional(),
    imageUrl: z.url().optional(),
    productId: objectId.optional(),
    orderId: objectId.optional(),
    quotationId: objectId.optional(),
  })
  .superRefine((v, ctx) => {
    const required: Record<string, unknown> = {
      text: v.text,
      image: v.imageUrl,
      product: v.productId,
      order: v.orderId,
      quotation: v.quotationId,
    };
    if (!required[v.type]) ctx.addIssue({ code: 'custom', message: `A ${v.type} message needs its content`, path: ['type'] });
  });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const reviewSchema = z.object({
  orderId: objectId,
  productId: objectId.optional(),
  rating: z.number().int().min(1).max(5),
  text: optionalText(2000),
});

export const reviewResponseSchema = z.object({ text: z.string().trim().min(1).max(1000) });

export const reportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: objectId,
  category: z.enum(REPORT_CATEGORIES),
  description: z.string().trim().min(5).max(2000),
});

export const verificationRequestSchema = z.object({
  type: z.enum(VERIFICATION_TYPES),
  targetId: objectId,
  evidence: z.string().trim().min(10).max(2000),
  documentUrls: z.array(z.url()).max(5).default([]),
});

export const promotionSchema = z.object({
  type: z.enum(PROMOTION_TYPES),
  shopId: objectId,
  productId: objectId.optional(),
  keywords: z.array(z.string().trim().toLowerCase().max(40)).max(10).default([]),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  note: optionalText(500),
});

export const deviceTokenSchema = z.object({
  token: z.string().trim().min(10).max(300),
  platform: z.enum(['ios', 'android', 'web']),
  deviceName: optionalText(80),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;

export const addressUpdateSchema = partialUpdate(addressSchema);
export const marketUpdateSchema = partialUpdate(marketSchema);
export const sectionUpdateSchema = partialUpdate(sectionSchema);
