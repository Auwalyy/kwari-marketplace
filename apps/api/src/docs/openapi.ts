import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z, type ZodType } from 'zod';
import * as S from '@kkdm/shared';
import { env } from '../config/env';
import { logger } from '../config/logger';

extendZodWithOpenApi(z);

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface RouteDoc {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  auth?: 'required' | 'optional' | 'admin';
  body?: ZodType;
  query?: ZodType;
  multipart?: string[];
  status?: number;
}

const id = '{id}';
const R = (method: Method, path: string, tag: string, summary: string, extra: Omit<RouteDoc, 'method' | 'path' | 'tag' | 'summary'> = {}): RouteDoc => ({ method, path, tag, summary, auth: 'required', ...extra });
const pub = { auth: 'optional' as const };

/** Every public endpoint of /api/v1. Request schemas are the same zod schemas the server validates with. */
export const ROUTES: RouteDoc[] = [
  R('get', '/config', 'Config', 'Public runtime configuration and feature availability', pub),
  // Auth
  R('post', '/auth/register', 'Auth', 'Register with email and/or phone', { auth: 'optional', body: S.registerSchema, status: 201 }),
  R('post', '/auth/login', 'Auth', 'Log in', { auth: 'optional', body: S.loginSchema }),
  R('post', '/auth/refresh', 'Auth', 'Rotate refresh token (reuse revokes the session)', { auth: 'optional', body: S.refreshSchema }),
  R('post', '/auth/logout', 'Auth', 'Log out of this session'),
  R('post', '/auth/logout-all', 'Auth', 'Log out of every session'),
  R('post', '/auth/verification/request', 'Auth', 'Send an email/phone verification code', { body: S.requestVerificationSchema }),
  R('post', '/auth/verification/confirm', 'Auth', 'Confirm a verification code', { body: S.confirmVerificationSchema }),
  R('post', '/auth/password/forgot', 'Auth', 'Request a password reset code (non-revealing)', { auth: 'optional', body: S.forgotPasswordSchema }),
  R('post', '/auth/password/reset', 'Auth', 'Reset password with a code (revokes all sessions)', { auth: 'optional', body: S.resetPasswordSchema }),
  R('post', '/auth/password/change', 'Auth', 'Change password', { body: S.changePasswordSchema }),
  R('get', '/auth/sessions', 'Auth', 'List active sessions/devices'),
  R('delete', `/auth/sessions/${id}`, 'Auth', 'Revoke a session'),
  // Users
  R('get', '/users/me', 'Users', 'Current user with shop and house roles'),
  R('patch', '/users/me', 'Users', 'Update profile', { body: S.updateProfileSchema }),
  R('post', '/users/me/avatar', 'Users', 'Upload avatar', { multipart: ['image'] }),
  R('patch', '/users/me/notification-preferences', 'Users', 'Update notification preferences', { body: S.notificationPreferencesSchema }),
  R('delete', '/users/me', 'Users', 'Delete account', { body: S.deleteAccountSchema }),
  R('get', '/users/me/addresses', 'Users', 'List delivery addresses'),
  R('post', '/users/me/addresses', 'Users', 'Add address', { body: S.addressSchema, status: 201 }),
  R('patch', `/users/me/addresses/${id}`, 'Users', 'Update address', { body: S.addressUpdateSchema }),
  R('delete', `/users/me/addresses/${id}`, 'Users', 'Delete address'),
  // Markets
  R('get', '/markets', 'Markets', 'List markets', { ...pub, query: S.paginationSchema }),
  R('get', '/markets/{idOrSlug}', 'Markets', 'Market details', pub),
  R('post', '/markets', 'Markets', 'Create market (admin)', { auth: 'admin', body: S.marketSchema, status: 201 }),
  R('patch', `/markets/${id}`, 'Markets', 'Update market (admin / manager in scope)', { body: S.marketUpdateSchema }),
  R('get', `/markets/${id}/sections`, 'Markets', 'List sections of a market', pub),
  R('post', `/markets/${id}/sections`, 'Markets', 'Create section', { body: S.sectionSchema, status: 201 }),
  R('get', `/sections/${id}`, 'Markets', 'Section details', pub),
  R('patch', `/sections/${id}`, 'Markets', 'Update section', { body: S.sectionUpdateSchema }),
  R('delete', `/sections/${id}`, 'Markets', 'Deactivate empty section'),
  // Houses
  R('get', '/houses', 'Houses', 'House directory', pub),
  R('get', `/houses/${id}`, 'Houses', 'House details', pub),
  R('post', '/houses', 'Houses', 'Create house (admin / manager)', { body: S.houseSchema, status: 201 }),
  R('patch', `/houses/${id}`, 'Houses', 'Update house profile (head / manager)', { body: S.houseUpdateSchema }),
  R('patch', `/houses/${id}/admin`, 'Houses', 'Structural & trust settings (admin / manager)'),
  R('post', `/houses/${id}/head`, 'Houses', 'Assign house head'),
  R('delete', `/houses/${id}/head`, 'Houses', 'Remove house head'),
  R('post', '/houses/claims', 'Houses', 'Claim headship of a house without a head', { body: S.houseClaimSchema, status: 201 }),
  R('get', `/houses/${id}/staff`, 'Houses', 'House staff'),
  R('post', `/houses/${id}/assistants`, 'Houses', 'Add assistant (if enabled)'),
  R('delete', `/houses/${id}/assistants/{userId}`, 'Houses', 'Remove assistant'),
  R('get', `/houses/${id}/memberships`, 'Houses', 'Membership requests and members'),
  R('get', `/houses/${id}/memberships/{membershipId}`, 'Houses', 'Membership details'),
  R('post', `/houses/${id}/memberships/{membershipId}/decision`, 'Houses', 'Approve / reject membership', { body: S.membershipDecisionSchema }),
  R('post', `/houses/${id}/memberships/{membershipId}/remove`, 'Houses', 'Remove a shop from the house'),
  R('post', `/houses/${id}/memberships/{membershipId}/dispute-response`, 'Houses', 'Respond to a membership dispute'),
  R('get', `/houses/${id}/dashboard`, 'Houses', 'House dashboard'),
  R('get', `/houses/${id}/activity`, 'Houses', 'House activity history'),
  R('get', '/houses/mine/list', 'Houses', 'Houses I manage'),
  // Invitations
  R('post', '/houses/{houseId}/invitations', 'Invitations', 'Create shop invitation (verified head); code returned once', { body: S.createHouseInvitationSchema, status: 201 }),
  R('get', '/houses/{houseId}/invitations', 'Invitations', 'List house invitations'),
  R('post', '/houses/{houseId}/invitations/{invitationId}/revoke', 'Invitations', 'Revoke invitation'),
  R('post', '/houses/{houseId}/invitations/{invitationId}/regenerate', 'Invitations', 'Revoke and reissue invitation'),
  R('post', '/invitations/house/preview', 'Invitations', 'Preview a house invitation code', { body: S.invitationCodeSchema }),
  R('post', '/shops/{shopId}/worker-invitations', 'Invitations', 'Create worker invitation (owner)', { body: S.createWorkerInvitationSchema, status: 201 }),
  R('get', '/shops/{shopId}/worker-invitations', 'Invitations', 'List worker invitations'),
  R('post', '/shops/{shopId}/worker-invitations/{invitationId}/revoke', 'Invitations', 'Revoke worker invitation'),
  R('post', '/invitations/worker/preview', 'Invitations', 'Preview a worker invitation code', { body: S.invitationCodeSchema }),
  R('post', '/invitations/worker/redeem', 'Invitations', 'Join a shop as worker', { body: S.invitationCodeSchema, status: 201 }),
  // Shops
  R('get', '/shops', 'Shops', 'Shop directory with filters', pub),
  R('get', '/shops/mine', 'Shops', 'Shops I own or work in'),
  R('get', '/shops/{idOrSlug}', 'Shops', 'Shop storefront', pub),
  R('post', '/shops/register', 'Shops', 'Register a shop using a house invitation', { body: S.shopRegistrationSchema, status: 201 }),
  R('get', `/shops/${id}/house-membership`, 'Shops', 'House membership status & history'),
  R('post', `/shops/${id}/house-membership`, 'Shops', 'Rejoin / move house with a new code'),
  R('post', `/shops/${id}/house-membership/{membershipId}/dispute`, 'Shops', 'Dispute a rejection or removal'),
  R('patch', `/shops/${id}`, 'Shops', 'Update shop profile (owner)', { body: S.shopUpdateSchema }),
  R('put', `/shops/${id}/fulfilment`, 'Shops', 'Pickup, delivery & payment settings', { body: S.shopFulfilmentSchema }),
  R('post', `/shops/${id}/logo`, 'Shops', 'Upload logo', { multipart: ['image'] }),
  R('post', `/shops/${id}/cover`, 'Shops', 'Upload cover photo', { multipart: ['image'] }),
  R('post', `/shops/${id}/close`, 'Shops', 'Close shop'),
  R('post', `/shops/${id}/ownership-transfer`, 'Shops', 'Request ownership transfer (admin-reviewed)'),
  R('get', `/shops/${id}/workers`, 'Shops', 'Workers and permissions'),
  R('patch', `/shops/${id}/workers/{membershipId}`, 'Shops', 'Change worker permissions'),
  R('delete', `/shops/${id}/workers/{membershipId}`, 'Shops', 'Remove worker'),
  R('post', `/shops/${id}/leave`, 'Shops', 'Leave a shop (worker)'),
  R('get', `/shops/${id}/activity`, 'Shops', 'Shop staff activity'),
  // Products
  R('get', '/categories', 'Catalogue', 'Categories with product counts', pub),
  R('post', '/categories', 'Catalogue', 'Create category (admin)', { auth: 'admin', status: 201 }),
  R('patch', `/categories/${id}`, 'Catalogue', 'Update category (admin)', { auth: 'admin' }),
  R('get', '/shops/{shopId}/products', 'Catalogue', 'Staff product list'),
  R('post', '/shops/{shopId}/products', 'Catalogue', 'Create product', { body: S.productCreateSchema, status: 201 }),
  R('get', '/shops/{shopId}/products/{productId}', 'Catalogue', 'Staff product detail'),
  R('patch', '/shops/{shopId}/products/{productId}', 'Catalogue', 'Update product', { body: S.productUpdateSchema }),
  R('delete', '/shops/{shopId}/products/{productId}', 'Catalogue', 'Archive (or permanently delete a never-published draft)'),
  R('post', '/shops/{shopId}/products/bulk', 'Catalogue', 'Bulk publish/unpublish/archive', { body: S.bulkProductActionSchema }),
  R('post', '/shops/{shopId}/products/{productId}/images', 'Catalogue', 'Upload product images (queues embeddings)', { multipart: ['images'], status: 201 }),
  R('delete', '/shops/{shopId}/products/{productId}/images/{imageId}', 'Catalogue', 'Delete image'),
  R('put', '/shops/{shopId}/products/{productId}/images/order', 'Catalogue', 'Reorder images'),
  R('post', '/shops/{shopId}/products/{productId}/images/retry-embeddings', 'Catalogue', 'Retry failed embeddings'),
  R('post', '/shops/{shopId}/products/{productId}/inventory', 'Catalogue', 'Adjust stock (restock can set the unit cost and record the purchase as an expense)', { body: S.inventoryAdjustSchema }),
  // Shop books: in-shop sales, debts, expenses, profit and advice
  R('get', '/shops/{shopId}/books/dashboard', 'Books', 'Shop home: today’s money, items needing attention and advice (content depends on role)'),
  R('get', '/shops/{shopId}/books/forecast', 'Books', 'Days of stock left per product and suggested reorder quantity'),
  R('get', '/shops/{shopId}/books/summary', 'Books', 'Profit and loss for a period: sales (app + in shop), cost of goods, expenses, debts (finance access)', { query: S.booksPeriodSchema }),
  R('get', '/shops/{shopId}/books/sales', 'Books', 'Sales book (in-shop sales); filter by period or customers who still owe', { query: S.salesListSchema }),
  R('post', '/shops/{shopId}/books/sales', 'Books', 'Record a sale made in the shop; takes stock; part payment records a debt', { body: S.saleCreateSchema, status: 201 }),
  R('get', '/shops/{shopId}/books/sales/{saleId}', 'Books', 'One in-shop sale'),
  R('post', '/shops/{shopId}/books/sales/{saleId}/payments', 'Books', 'Record money received for a credit sale', { body: S.salePaymentSchema }),
  R('post', '/shops/{shopId}/books/sales/{saleId}/void', 'Books', 'Cancel a sale entered by mistake; stock goes back (finance access)', { body: S.voidSchema }),
  R('get', '/shops/{shopId}/books/expenses', 'Books', 'Expenses (finance access)', { query: S.expensesListSchema }),
  R('post', '/shops/{shopId}/books/expenses', 'Books', 'Record an expense (finance access)', { body: S.expenseCreateSchema, status: 201 }),
  R('post', '/shops/{shopId}/books/expenses/{expenseId}/void', 'Books', 'Remove an expense entered by mistake (finance access)', { body: S.voidSchema }),
  R('get', '/shops/{shopId}/products/{productId}/inventory', 'Catalogue', 'Inventory movements'),
  R('get', `/products/${id}`, 'Catalogue', 'Product details (records recently viewed)', pub),
  // Search
  R('get', '/search/products', 'Search', 'Text search with filters & sorting', { ...pub, query: S.productSearchSchema }),
  R('get', '/search/suggestions', 'Search', 'Search suggestions', pub),
  R('get', '/search/recent', 'Search', 'Recent searches'),
  R('delete', '/search/recent', 'Search', 'Clear recent searches'),
  R('get', '/search/discovery', 'Search', 'Home discovery sections', pub),
  R('get', '/search/nearby-shops/{shopId}', 'Search', 'Shops in the same house / section', pub),
  R('get', '/visual-search/status', 'Visual search', 'Visual search availability', pub),
  R('post', '/visual-search', 'Visual search', 'Find similar fabrics by image', { ...pub, multipart: ['image'], query: S.visualSearchFiltersSchema }),
  R('get', '/visual-search/results/{searchId}', 'Visual search', 'More pages of a visual search', { ...pub, query: S.visualSearchFiltersSchema }),
  R('get', `/visual-search/products/${id}/similar`, 'Visual search', 'Visually similar products', pub),
  // Favourites
  R('get', '/favorites', 'Favourites', 'Saved products or shops'),
  R('get', '/favorites/ids', 'Favourites', 'Saved ids'),
  R('post', '/favorites', 'Favourites', 'Save product/shop', { status: 201 }),
  R('delete', '/favorites/{type}/{id}', 'Favourites', 'Remove favourite'),
  R('get', '/favorites/recently-viewed', 'Favourites', 'Recently viewed products'),
  R('delete', '/favorites/recently-viewed', 'Favourites', 'Clear recently viewed'),
  // Commerce
  R('get', '/cart', 'Commerce', 'Cart grouped by seller (server-priced)'),
  R('post', '/cart/items', 'Commerce', 'Add item', { body: S.cartItemSchema, status: 201 }),
  R('patch', '/cart/items/{lineId}', 'Commerce', 'Update quantity', { body: S.cartItemUpdateSchema }),
  R('delete', '/cart/items/{lineId}', 'Commerce', 'Remove item'),
  R('delete', '/cart', 'Commerce', 'Clear cart'),
  R('post', '/checkout', 'Commerce', 'Checkout (idempotent; one order per seller)', { body: S.checkoutSchema, status: 201 }),
  R('get', '/orders', 'Orders', 'My orders'),
  R('get', `/orders/${id}`, 'Orders', 'Order details & tracking'),
  R('post', `/orders/${id}/transition`, 'Orders', 'Customer status change (cancel, confirm, dispute)', { body: S.orderTransitionSchema }),
  R('get', '/shops/{shopId}/orders', 'Orders', 'Shop orders'),
  R('get', `/shops/{shopId}/orders/${id}`, 'Orders', 'Shop order detail'),
  R('post', `/shops/{shopId}/orders/${id}/transition`, 'Orders', 'Seller status change', { body: S.orderTransitionSchema }),
  R('patch', `/shops/{shopId}/orders/${id}/delivery`, 'Orders', 'Update delivery details / fee quote'),
  R('post', `/shops/{shopId}/orders/${id}/confirm-payment`, 'Orders', 'Seller confirms cash/transfer payment'),
  R('post', '/quotations', 'Quotations', 'Request quotation', { body: S.quotationRequestSchema, status: 201 }),
  R('get', '/quotations', 'Quotations', 'List quotations (as customer or shop)'),
  R('get', `/quotations/${id}`, 'Quotations', 'Quotation details'),
  R('post', `/quotations/${id}/offer`, 'Quotations', 'Seller offer', { body: S.quotationOfferSchema }),
  R('post', `/quotations/${id}/respond`, 'Quotations', 'Customer accept/reject/counter', { body: S.quotationRespondSchema }),
  R('post', `/quotations/${id}/reject`, 'Quotations', 'Seller declines'),
  R('post', `/quotations/${id}/cancel`, 'Quotations', 'Customer withdraws'),
  R('post', `/quotations/${id}/add-to-cart`, 'Quotations', 'Put accepted quotation in cart'),
  R('get', '/payments/config', 'Payments', 'Online payment availability', pub),
  R('post', '/payments/initialize', 'Payments', 'Start gateway payment (idempotent)', { body: S.paymentInitSchema, status: 201 }),
  R('post', '/payments/{reference}/verify', 'Payments', 'Verify with provider'),
  R('get', '/payments/order/{orderId}', 'Payments', 'Payments for an order'),
  R('post', '/payments/webhooks/{provider}', 'Payments', 'Provider webhook (signature-verified)', { auth: 'optional' }),
  // Chat
  R('get', '/conversations', 'Chat', 'Conversation list'),
  R('get', '/conversations/unread-count', 'Chat', 'Unread totals'),
  R('post', '/conversations', 'Chat', 'Start conversation with a shop', { body: S.startConversationSchema, status: 201 }),
  R('get', `/conversations/${id}`, 'Chat', 'Conversation'),
  R('get', `/conversations/${id}/messages`, 'Chat', 'Message history (cursor)'),
  R('post', `/conversations/${id}/messages`, 'Chat', 'Send message', { body: S.sendMessageSchema, status: 201 }),
  R('post', `/conversations/${id}/images`, 'Chat', 'Send image', { multipart: ['image'], status: 201 }),
  R('get', `/conversations/${id}/messages/{messageId}/image`, 'Chat', 'Private image (participants only)'),
  R('post', `/conversations/${id}/read`, 'Chat', 'Mark read'),
  // Notifications
  R('get', '/notifications', 'Notifications', 'Notification history'),
  R('get', '/notifications/unread-count', 'Notifications', 'Unread count'),
  R('post', `/notifications/${id}/read`, 'Notifications', 'Mark read'),
  R('post', '/notifications/read-all', 'Notifications', 'Mark all read'),
  R('post', '/notifications/devices', 'Notifications', 'Register Expo push token', { body: S.deviceTokenSchema }),
  R('delete', '/notifications/devices', 'Notifications', 'Unregister push token'),
  // Trust
  R('get', '/reviews', 'Trust', 'Published reviews for shop/product', pub),
  R('get', '/reviews/mine', 'Trust', 'My reviews'),
  R('post', '/reviews', 'Trust', 'Review a delivered order', { body: S.reviewSchema, status: 201 }),
  R('post', `/reviews/${id}/response`, 'Trust', 'Seller response', { body: S.reviewResponseSchema }),
  R('get', '/reviews/shop/{shopId}', 'Trust', 'Shop reviews management'),
  R('post', '/reports', 'Trust', 'Report content or account', { body: S.reportSchema, status: 201 }),
  R('get', '/reports/mine', 'Trust', 'My reports'),
  R('post', '/blocks', 'Trust', 'Block a user or shop', { status: 201 }),
  R('get', '/blocks', 'Trust', 'Blocked list'),
  R('delete', `/blocks/${id}`, 'Trust', 'Unblock'),
  R('post', '/blocks/conversation/{conversationId}', 'Trust', 'Block the other side of a conversation', { status: 201 }),
  R('post', '/verifications', 'Trust', 'Request verification', { body: S.verificationRequestSchema, status: 201 }),
  R('get', '/verifications/mine', 'Trust', 'My verification requests'),
  R('post', `/verifications/${id}/appeal`, 'Trust', 'Appeal rejection'),
  // Analytics & promotions
  R('get', '/analytics/shops/{shopId}', 'Analytics', 'Shop analytics'),
  R('get', '/analytics/me', 'Analytics', 'Customer dashboard'),
  R('post', '/promotions', 'Promotions', 'Request promotion', { body: S.promotionSchema, status: 201 }),
  R('get', '/promotions/shop/{shopId}', 'Promotions', 'Shop promotions & plan'),
  R('post', `/promotions/${id}/click`, 'Promotions', 'Record promotion click', pub),
  // Admin
  ...(
    [
      ['get', '/admin/dashboard', 'Platform dashboard'],
      ['get', '/admin/users', 'Users'],
      ['get', `/admin/users/${id}`, 'User detail'],
      ['post', `/admin/users/${id}/suspend`, 'Suspend user'],
      ['post', `/admin/users/${id}/reactivate`, 'Reactivate user'],
      ['put', `/admin/users/${id}/roles`, 'Assign platform roles / manager scope'],
      ['get', '/admin/user-lookup', 'Find user by email/phone'],
      ['get', '/admin/houses', 'Houses with heads'],
      ['get', `/admin/houses/${id}`, 'House detail (admin)'],
      ['get', '/admin/shops', 'Shops'],
      ['patch', `/admin/shops/${id}`, 'Suspend / verify shop'],
      ['post', `/admin/shops/${id}/entitlements`, 'Grant subscription plan'],
      ['get', '/admin/verifications', 'Verification queue'],
      ['post', `/admin/verifications/${id}/decision`, 'Decide verification'],
      ['get', '/admin/reports', 'Report queue'],
      ['get', `/admin/reports/${id}/context`, 'Reported content'],
      ['post', `/admin/reports/${id}/action`, 'Act on report'],
      ['get', '/admin/disputes', 'Membership disputes'],
      ['post', '/admin/disputes/{membershipId}/resolve', 'Resolve dispute'],
      ['get', '/admin/invitations', 'Invitation monitoring'],
      ['get', '/admin/invitations/abuse', 'Invitation abuse indicators'],
      ['post', '/admin/invitations/{kind}/{id}/revoke', 'Revoke any invitation'],
      ['get', '/admin/products', 'Product moderation list'],
      ['post', `/admin/products/${id}/moderate`, 'Moderate product'],
      ['get', '/admin/orders', 'Order monitoring'],
      ['post', `/admin/orders/${id}/transition`, 'Admin order transition'],
      ['post', `/admin/orders/${id}/refund`, 'Process refund'],
      ['get', '/admin/payments', 'Payment monitoring'],
      ['get', '/admin/promotions', 'Promotions'],
      ['post', '/admin/promotions', 'Create promotion'],
      ['post', `/admin/promotions/${id}/decision`, 'Approve / reject promotion'],
      ['get', '/admin/settings', 'Platform settings'],
      ['put', '/admin/settings/{key}', 'Update setting'],
      ['get', '/admin/audit', 'Audit log'],
      ['post', '/admin/announcements', 'Send announcement'],
    ] as [Method, string, string][]
  ).map(([m, p, s]) => R(m, p, 'Admin', s, { auth: 'admin' })),
];

const errorSchema = z.object({
  success: z.literal(false),
  error: z.object({ code: z.string(), message: z.string(), details: z.array(z.object({ path: z.string(), message: z.string() })).optional(), requestId: z.string().optional() }),
});
const successSchema = z.object({ success: z.literal(true), data: z.any(), meta: z.record(z.string(), z.any()).optional() });

function routeDef(r: RouteDoc, bearerName: string, Success: ZodType, ErrorBody: ZodType, strip: boolean) {
  const params = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  return {
    method: r.method,
    path: `/api/v1${r.path}`,
    tags: [r.tag],
    summary: r.summary + (r.auth === 'admin' ? ' (administrators / market managers)' : ''),
    security: r.auth === 'optional' ? [] : [{ [bearerName]: [] }],
    request: {
      params: params.length ? z.object(Object.fromEntries(params.map((p) => [p, z.string()]))) : undefined,
      query: strip ? undefined : r.query,
      body: strip
        ? undefined
        : r.body
          ? { content: { 'application/json': { schema: r.body } } }
          : r.multipart
            ? { content: { 'multipart/form-data': { schema: z.object(Object.fromEntries(r.multipart.map((f) => [f, z.string().describe('binary image file (JPEG/PNG/WebP/HEIC, max 8 MB)')]))) } } }
            : undefined,
    },
    responses: {
      [r.status ?? 200]: { description: 'Success', content: { 'application/json': { schema: Success } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorBody } } },
      ...(r.auth !== 'optional' ? { 401: { description: 'Unauthenticated' }, 403: { description: 'Forbidden' } } : {}),
      429: { description: 'Rate limited' },
    },
  } as any;
}

/** True if the route's schemas can be expressed in OpenAPI (transform-based schemas sometimes cannot). */
function convertible(r: RouteDoc): boolean {
  if (!r.body && !r.query) return true;
  try {
    const reg = new OpenAPIRegistry();
    reg.registerPath(routeDef(r, 'bearerAuth', successSchema, errorSchema, false));
    new OpenApiGeneratorV3(reg.definitions).generateDocument({ openapi: '3.0.3', info: { title: 't', version: '1' } });
    return true;
  } catch (err) {
    logger.debug({ path: r.path, err: (err as Error).message }, 'OpenAPI schema fallback');
    return false;
  }
}

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  const ErrorBody = registry.register('Error', errorSchema);
  const Success = registry.register('Success', successSchema);
  for (const r of ROUTES) registry.registerPath(routeDef(r, bearer.name, Success, ErrorBody, !convertible(r)));

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Kantin Kwari Digital Market API',
      version: '1.0.0',
      description:
        'REST API for the Kantin Kwari Digital Market. Responses use the envelope `{ success, data, meta? }` or `{ success: false, error }`. Money is integer kobo (NGN). Real-time events are documented in docs/realtime-events.md.',
    },
    servers: [{ url: env.API_BASE_URL }],
  });
}
