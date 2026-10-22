# Kantin Kwari Digital Market

A mobile marketplace for the Kantin Kwari textile market in Kano, Nigeria. The app models the physical market (**Market → Section → House → Shop**) so every storefront is tied to its real location, and lets customers find fabrics **by photo**, compare retail and wholesale prices, chat and negotiate with sellers, and order for pickup or delivery.

- **Mobile:** Expo SDK 57 (React Native 0.86, React 19.2, TypeScript), Expo Router, NativeWind 4.2 (Tailwind 3), TanStack Query, Zustand, React Hook Form + Zod, Socket.IO client, FlashList, gorhom bottom sheet, sonner-native toasts, Lucide icons.
- **API:** Node.js + TypeScript, Express 5, MongoDB/Mongoose 8, Socket.IO, Zod, JWT access tokens with rotating refresh tokens, Argon2id, sharp, pino, Swagger/OpenAPI, Vitest + Supertest.
- **Shared:** `packages/shared`: domain constants, Zod schemas and DTO types used by both apps (no backend-only dependencies).

## Repository layout

```
apps/
  api/        Express + Socket.IO modular monolith
    src/config        env validation, logger, DB/transactions
    src/middleware    auth, rate limits, uploads, errors, security
    src/modules/      auth, users, markets (+sections), houses, invitations, shops, products,
                      categories, search, visual-search, favorites, orders (cart, checkout,
                      quotations), payments, deliveries, chats, notifications, reviews,
                      reports (reports, blocks, verifications), analytics, promotions, admin
    src/services      access control, storage (local/S3), images, audit, push, realtime, locations
    src/jobs          MongoDB-backed job queue + scheduled sweeps
    src/sockets       Socket.IO auth, rooms and events
    src/scripts       seed, index sync (incl. Atlas vector index), embedding backfill, create-admin
    tests/            66 integration tests (in-memory MongoDB replica set)
  mobile/     Expo app
    app/              91 Expo Router screens (tabs, auth, catalogue, commerce, seller, house, admin)
    src/              components, features, hooks, lib (API client, sockets, push), store
packages/shared/      constants, money helpers, Zod schemas, DTO types
docs/                 setup, visual search, payments, push, deployment, realtime events, API examples, openapi.json
scripts/dev-mongo.mjs local development replica set (no MongoDB install needed)
```

## Quick start

```bash
npm install
cp .env.example .env            # add two random JWT secrets (see docs/setup.md)
npm run dev:db                  # terminal 1: local MongoDB replica set (or use Atlas)
npm run db:indexes
npm run seed                    # development data; all demo accounts use DemoPass123
npm run dev:api                 # terminal 2: http://localhost:4000 (Swagger at /api/docs)
npm run dev:mobile              # terminal 3: Expo dev server
```

For visual search locally, set `IMAGE_EMBEDDING_PROVIDER=local-baseline` before seeding (dev-only baseline; use Jina or Cohere in production).

Full guide, including emulators, physical devices, iOS and troubleshooting: **[docs/setup.md](docs/setup.md)**.

| Command | What it does |
|---|---|
| `npm test` | API integration tests (auth, hierarchy, invitations, products, visual search, commerce, payments, chat/sockets, trust/admin) |
| `npm run typecheck` | shared + API + mobile type checks |
| `npm run lint` | ESLint for API and mobile |
| `npm run build:api` | production build of the API |
| `npm run embeddings:backfill -w @kkdm/api` | (re)generate image embeddings for the configured provider |
| `npm run admin:create -w @kkdm/api -- --email … --name … --password …` | create/promote an administrator |

## Architecture notes

- **Authorisation is server-side.** Every request re-loads the user and session (suspension and logout take effect immediately). Shop actions check the caller's `ShopMembership` and permission, house actions check `HouseStaff`, and market managers are limited to their assigned markets. Nothing the client sends about roles, prices, totals, stock or payment status is trusted. Hidden buttons in the app are convenience only.
- **Roles:** administrator, market manager, house head (+ optional assistants), shop owner, shop worker (granular permissions: products, inventory, orders, chats, quotations, reports), customer. One account can hold several.
- **Invitations:** codes are random (10 characters from an unambiguous alphabet), shown once and stored as HMACs. Redemption is atomic (a guarded `findOneAndUpdate` inside a transaction) and safe under concurrency. Failed attempts are audited, and 8 failures in 15 minutes locks further attempts. Worker codes can never grant ownership or house rights.
- **Money** is integer kobo. Order items snapshot prices. Stock is reserved with guarded atomic decrements (no overselling) and released exactly once on cancellation.
- **Checkout** creates one order per seller under a checkout record and is idempotent per key.
- **Payments:** only server-side verification (provider API plus signed, de-duplicated webhooks) marks an order `paid`. Cash and transfers are `seller_confirmed`, which is a separate status everywhere.
- **Visual search:** provider-independent embedding interface, background embedding jobs, Atlas `$vectorSearch` or a bounded exhaustive scan, multi-image consolidation, honest similarity bands. See [docs/visual-search.md](docs/visual-search.md).
- **Real-time:** messages are persisted before broadcast, room joins are authorised per event, sends are idempotent via `clientMessageId`, and clients re-fetch after reconnecting. See [docs/realtime-events.md](docs/realtime-events.md).
- **Audit log:** auth events, invitations, membership and ownership changes, admin actions, payment changes and moderation are all audited.

## Feature status

✅ implemented and covered by automated tests · 🟢 implemented, not covered by automated tests (type-checked, linted, bundled) · 🔑 implemented, needs external credentials for live use · ⛔ not available

| Area | Status | Notes |
|---|---|---|
| Registration, login, logout, refresh rotation + reuse detection, lockout, sessions, logout-all | ✅ | |
| Email/phone verification codes, password reset | ✅ / 🔑 | Codes go to the log in development; SMTP (email) and Termii (SMS) are needed in production |
| Account deletion with anonymisation and session revocation | ✅ | Blocked while the user owns an active shop |
| Market / section / house hierarchy, directory, breadcrumbs, scoped market managers | ✅ | |
| House-head assignment, claims, verification, assistants | ✅ | |
| House → shop invitations (atomic, brute-force protection, auto-approve option) | ✅ | |
| Shop registration, approval, removal, rejoin/move, disputes, ownership transfer | ✅ | |
| Worker invitations, permissions, immediate revocation | ✅ | |
| Products, variants, units, wholesale tiers, images (EXIF stripped), inventory ledger, bulk actions | ✅ | |
| Text search, filters, sorting, suggestions, recent searches, discovery | ✅ | |
| Visual fabric search pipeline (jobs, ranking, filters, multi-image, failures) | ✅ / 🔑 | Tested with mocked embeddings; the dev baseline works offline; production needs Jina/Cohere + an Atlas vector index |
| Favourites, recently viewed (90-day TTL, clearable) | ✅ | |
| Cart, multi-seller checkout, idempotency, concurrency-safe stock | ✅ | |
| Order state machine, delivery quotes/tracking history, pickup, auto-complete | ✅ | No live GPS tracking (not invented) |
| Quotations (offer / counter / accept → cart at agreed price) | ✅ | |
| Cash / transfer with seller confirmation | ✅ | |
| Online payments: Paystack / Flutterwave (init, verify, webhooks, reconcile, refunds) | ✅ / 🔑 | Tested with a mock gateway; **not yet run against provider test mode** |
| Real-time chat (sockets, typing, presence, read receipts, images, block, report) | ✅ | |
| In-app notifications with dedupe, preferences | ✅ | |
| Expo push notifications | 🔑 | Needs an EAS project, FCM/APNs credentials and `PUSH_NOTIFICATION_ENABLED=true`; not verified on devices here |
| Reviews (eligible buyers only, one per scope), seller responses | ✅ | |
| Reports, blocks, moderation actions, verification queue, disputes | ✅ | |
| Shop / house / customer / admin dashboards and analytics from stored data | ✅ | Order value, completed sales and payments shown separately |
| Promotions (featured / sponsored, approval, measured impressions), subscription entitlements | 🟢 | Paid promotion checkout is not live; billing is arranged manually and labelled as such |
| Maps | 🟢 | Written location + "Directions" opens the device's maps app; no embedded map SDK (avoids key requirements) |
| S3-compatible storage | 🔑 | Local disk storage in development only |
| Mobile app: 91 screens, role-aware navigation | 🟢 | Type-checked, linted, Android bundle builds, `expo-doctor` 20/20; not yet run on a physical device/emulator in this environment |
| Hausa language | ⛔ | Out of scope for this MVP (English only) |

## Documentation

- [docs/setup.md](docs/setup.md): requirements, install, env, database and indexes, seed, running, emulators/devices, iOS, tests, troubleshooting
- [docs/visual-search.md](docs/visual-search.md): providers, Atlas vector index, backfill, limits
- [docs/payments.md](docs/payments.md): Paystack/Flutterwave onboarding, webhooks, test mode, refunds
- [docs/push-notifications.md](docs/push-notifications.md): Expo push setup
- [docs/deployment.md](docs/deployment.md): backend/database/storage deployment, scaling, **production security checklist**, paid services
- [docs/realtime-events.md](docs/realtime-events.md): Socket.IO events and payloads
- [docs/api-examples.md](docs/api-examples.md): curl examples and error codes; [docs/openapi.json](docs/openapi.json): full OpenAPI spec (also at `/api/docs`)
