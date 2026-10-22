# Payments

Supported methods:

| Method | How it is confirmed | Status shown |
|---|---|---|
| Cash on pickup | Seller taps "I received this payment" | `seller_confirmed` — "Paid · confirmed by seller" |
| Bank transfer (arranged with seller) | Seller confirms receipt | `seller_confirmed` |
| Online (Paystack or Flutterwave) | Server-side verification with the provider API (plus signed webhook) | `paid` — "Paid · verified" |

`seller_confirmed` and `paid` are always kept separate in the database, analytics and the UI. A chat message is never treated as proof of payment, and the mobile app never reports a payment as successful by itself.

## Flow (online)

1. Customer checks out with **Pay online**. Online payment is offered only when a provider is configured.
2. The seller accepts the order (and quotes delivery if needed). Payment can't be started before that, so rejected orders never need refunds.
3. App → `POST /api/v1/payments/initialize { orderId, idempotencyKey }`. The amount comes from the stored order total, never from the client. The same idempotency key returns the same payment, and older unfinished attempts are cancelled.
4. The app opens the provider's hosted checkout page (`authorizationUrl`) in an in-app browser. Card and bank details go only to the provider and are never stored.
5. When the browser closes, the app calls `POST /payments/:reference/verify`. The server asks the provider for the real status and checks the amount and currency. A mismatch is marked `failed` and audited.
6. The provider also sends a signed webhook to `POST /api/v1/payments/webhooks/<provider>`:
   - The signature is verified on the **raw body** (Paystack: HMAC-SHA512 with the secret key in `x-paystack-signature`; Flutterwave: `verif-hash` must equal your secret hash).
   - Each event is recorded once (`PaymentEvent` unique key), so retries and duplicates are ignored.
   - Even a signed webhook is re-verified with the provider's verification API before anything changes.
7. A reconciliation job re-checks payments left `pending` for 5+ minutes (missed webhooks, app closed mid-payment) every 10 minutes.

**Refunds:** if a seller or admin cancels an order that was paid online, a `Refund` record is opened and the order becomes `refund_pending`. An administrator issues it from Admin → Orders: through the gateway (Paystack `/refund`, Flutterwave `/transactions/:id/refund`) or by recording a manual refund. Provider refund webhooks complete the process.

## Paystack setup

1. Create an account at https://dashboard.paystack.com (test mode is available immediately; live mode requires business verification).
2. Settings → API Keys & Webhooks: copy the **Test Secret Key** (`sk_test_…`).
3. `.env`:
   ```
   PAYMENT_PROVIDER=paystack
   PAYSTACK_SECRET_KEY=sk_test_xxx
   PAYMENT_CALLBACK_URL=kantinkwari://payment-complete
   ```
4. Set the webhook URL to `https://<your-api>/api/v1/payments/webhooks/paystack`. It must be public HTTPS; for local testing use a tunnel such as `cloudflared tunnel` or `ngrok http 4000`.
5. Test with Paystack's test cards (https://paystack.com/docs/payments/test-payments).
6. For production, switch to `sk_live_…` and update the webhook URL in live mode.

## Flutterwave setup

1. Create an account at https://dashboard.flutterwave.com (test mode toggle in the dashboard).
2. Settings → API keys: copy the **Secret key**.
3. Settings → Webhooks: set the URL `https://<your-api>/api/v1/payments/webhooks/flutterwave` and choose a **Secret hash**.
4. `.env`:
   ```
   PAYMENT_PROVIDER=flutterwave
   FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-xxx
   PAYMENT_WEBHOOK_SECRET=<the secret hash you chose>
   PAYMENT_CALLBACK_URL=kantinkwari://payment-complete
   ```
5. Test with Flutterwave test cards (https://developer.flutterwave.com/docs/integration-guides/testing-helpers).

## Without a provider

With `PAYMENT_PROVIDER=none` (the default) the app keeps working with cash on pickup and bank transfer. Online payment is shown as unavailable and checkout rejects it with `503 ONLINE_PAYMENT_UNAVAILABLE`. Nothing is simulated.

## Adding another gateway

Implement `PaymentProvider` in `apps/api/src/modules/payments/providers.ts` (`initialize`, `verify`, `verifyWebhookSignature`, `parseWebhook`, `refund`) and register it in `paymentProvider()`. Orders, checkout and analytics don't change.

## Verification status

The integrations follow the providers' published APIs and are covered by automated tests using a mock provider (signature checks, idempotent webhooks, amount mismatch, refunds). **Live verification against Paystack/Flutterwave test mode has not been run in this repository** because no credentials are configured. Do that before launch.
