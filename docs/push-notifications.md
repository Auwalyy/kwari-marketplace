# Push notifications (Expo)

In-app notifications always work: they are stored in MongoDB, delivered live over Socket.IO, and listed under Notifications. Push is an additional delivery channel.

## How it works

1. After sign-in, the app asks for notification permission (once, on a physical device) and registers its Expo push token with `POST /api/v1/notifications/devices`. Tokens are tied to the session and deactivated on logout.
2. When a notification is created, the API checks the user's preferences (global push switch and per-group toggles: orders, payments, messages, quotations, shop & house, trust, announcements) and queues a `push.send` job.
3. The job sends through the Expo Push API in batches of 100, with a 10 s timeout. Tokens reported as `DeviceNotRegistered` are deactivated. Transient failures retry with backoff (up to 4 attempts).
4. Each notification has a `dedupeKey` (e.g. `order:<id>:accepted:3`), so repeated webhooks or job retries never create a second notification or push.
5. Tapping a push opens the related screen (order, chat, quotation, membership…).

## Setup

1. Create an Expo account and EAS project: in `apps/mobile`, run `npx eas-cli@latest init`. This writes the project id to the app config. Alternatively set `EXPO_PUBLIC_EAS_PROJECT_ID`.
2. Android: configure FCM credentials for the project (`npx eas-cli@latest credentials`, or follow https://docs.expo.dev/push-notifications/fcm-credentials/). Upload the Google service account key to EAS.
3. iOS: an Apple Developer account is required; EAS generates the APNs key when you build (`npx eas-cli@latest build -p ios`).
4. API `.env`:
   ```
   PUSH_NOTIFICATION_ENABLED=true
   EXPO_ACCESS_TOKEN=<only if "Enhanced push security" is enabled for the project>
   ```
5. Build a development or production build (push does not work in Expo Go for SDK 53+ on Android), install it on a physical device, sign in and allow notifications.

To check delivery, look at the `push.status` field on documents in the `notifications` collection (`sent`, `failed`, `skipped`), or watch the API logs.

## Status

The send and receive code is complete. Device-token registration and validation are covered by automated tests. Delivery to real devices needs the Expo/FCM/APNs credentials above and has **not** been verified in this repository.
