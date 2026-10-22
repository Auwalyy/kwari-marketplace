# Development setup

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 LTS or newer (tested on 26) | `node -v` |
| npm | 10+ (tested on 11) | npm workspaces are used; no yarn/pnpm needed |
| MongoDB | 7+ replica set, or MongoDB Atlas | Not needed locally: `npm run dev:db` starts a development replica set |
| Expo tooling | via `npx` | Expo SDK 57 |
| Android Studio (emulator) / Xcode (iOS simulator, macOS only) | optional | or use a physical phone |
| EAS CLI | `npx eas-cli@latest` | for development / production builds |

## 1. Install

```bash
git clone <repo> kantin-kwari-digital-market
cd kantin-kwari-digital-market
npm install            # installs all workspaces and builds packages/shared
```

> npm 11 may warn that some packages' install scripts were not run (`argon2`, `esbuild`, `mongodb-memory-server`). They work without them: argon2 and sharp ship prebuilt binaries and mongodb-memory-server downloads MongoDB on first use. To run them anyway: `npm install-scripts approve argon2 esbuild mongodb-memory-server`.

## 2. Configure the API

```bash
cp .env.example .env
node -e "const c=require('crypto');console.log(c.randomBytes(48).toString('base64url'))"   # run twice
```

Put the two random strings in `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`. For a quick local start you can leave every external provider at its default (`none` / `console` / `local`). Everything works except online payment and push. Visual search needs `IMAGE_EMBEDDING_PROVIDER=local-baseline` (dev-only) or a real provider, see [visual-search.md](visual-search.md).

All variables are documented inline in `.env.example`. The API refuses to start with unsafe production settings (e.g. local storage, console verification codes, dev embedding baseline, `*` CORS).

## 3. Database

**Option A — no MongoDB installed:**

```bash
npm run dev:db      # persistent single-node replica set at mongodb://127.0.0.1:27017/kkdm?replicaSet=rs0 (data in .dev-mongo/)
```

**Option B — Atlas:** create a cluster (M0 works for development), a database user and network access rule, then set
`MONGODB_URI=mongodb+srv://USER:PASS@cluster0.xxxx.mongodb.net/kkdm?retryWrites=true&w=majority`.

Create indexes (safe to repeat; also creates the Atlas vector index when `VECTOR_SEARCH_PROVIDER=atlas`):

```bash
npm run db:indexes
```

Transactions are used automatically on replica sets / Atlas. On a standalone `mongod` set `MONGODB_TRANSACTIONS=false`; stock and invitation operations stay safe because they also use guarded atomic updates.

## 4. Seed development data (never in production)

```bash
npm run seed            # add --reset (npm run seed -- --reset) to wipe the database first
```

Creates the Kantin Kwari market with three sections, three houses, four shops, thirteen products with generated fabric-pattern images, and demo accounts. All demo records are labelled `[DEMO]` and every demo account uses the password **`DemoPass123`**:

| Account | Role |
|---|---|
| admin@demo.kantinkwari.test | Platform administrator |
| manager@demo.kantinkwari.test | Market manager (Kantin Kwari) |
| head1@demo.kantinkwari.test / head2@… | Verified house heads (KW-024, KW-031) |
| owner1@ … owner4@demo.kantinkwari.test | Shop owners |
| worker@demo.kantinkwari.test | Worker (products, inventory, chat) at Alhaji Sani Textiles |
| customer1@ / customer2@demo.kantinkwari.test | Customers |

To create a real first administrator instead: `npm run admin:create -w @kkdm/api -- --email you@example.com --name "Your Name" --password "Str0ngPass"`.

## 5. Run the API

```bash
npm run dev:api
```

- Health: http://localhost:4000/health, readiness: http://localhost:4000/ready
- Swagger UI: http://localhost:4000/api/docs, raw spec: http://localhost:4000/api/v1/openapi.json (also exported to `docs/openapi.json` via `npm run openapi:export -w @kkdm/api`)
- With `VERIFICATION_*_PROVIDER=console`, verification and reset codes are printed in the API log.

## 6. Run the mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env     # optional
npm run dev:mobile                               # = npx expo start in apps/mobile
```

### Which API URL does the app use?

`localhost` on a phone means the phone itself, so the app resolves the API like this (`apps/mobile/src/lib/config.ts`):

1. `EXPO_PUBLIC_API_URL` if set. Required for preview/production builds.
2. In development, the LAN IP of the computer running the Expo dev server, on port 4000. This works for physical devices on the same Wi-Fi network and for the iOS simulator.
3. Android emulator fallback: `http://10.0.2.2:4000`.

If a physical device can't connect: make sure phone and computer are on the same network, allow Node through the computer's firewall on port 4000, or set `EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:4000`. Also set `API_BASE_URL` in `.env` to the same reachable address so locally stored image URLs work on the device.

### Expo Go vs development build

The app uses only Expo modules plus `react-native-reanimated`, `gesture-handler`, `svg`, `flash-list` and `@gorhom/bottom-sheet`. It is intended to run in a **development build**:

```bash
cd apps/mobile
npx eas-cli@latest build --profile development --platform android   # or ios
# or locally (requires Android Studio / Xcode):
npx expo run:android
npx expo run:ios                                                      # macOS only
```

Push notifications always require a development or production build on a physical device, plus an EAS project id (`npx eas-cli@latest init` writes it to app config; or set `EXPO_PUBLIC_EAS_PROJECT_ID`).

### Android emulator

1. Install Android Studio and create an emulator (Pixel, recent API level).
2. Start the API (`npm run dev:api`), start Expo, press `a`.
3. The app uses `http://10.0.2.2:4000` automatically if no LAN host is detected.

### iOS simulator (macOS)

Install Xcode, then `npx expo run:ios` or press `i` in Expo. The simulator can reach `localhost` on the Mac.

## 7. Tests, types and lint

```bash
npm test                    # API test suite (Vitest + Supertest + in-memory MongoDB replica set)
npm run typecheck           # shared + API + mobile
npm run lint                # API (ESLint) + mobile (expo lint)
npx expo-doctor             # in apps/mobile — dependency/config health
```

The first test run downloads a MongoDB binary (~100 MB) for `mongodb-memory-server`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Invalid environment configuration` / `Configuration errors` at API start | Read the listed variables; production refuses unsafe settings by design. |
| App shows "No connection" | Check the API URL rules above; open `http://<API host>:4000/health` in the phone's browser. |
| Images don't load on a phone | `API_BASE_URL` must be an address the phone can reach (not `localhost`) when using local storage. |
| `Transaction numbers are only allowed on a replica set` | Use `npm run dev:db`/Atlas, or set `MONGODB_TRANSACTIONS=false`. |
| Visual search says "not available" | Set `IMAGE_EMBEDDING_PROVIDER` and run `npm run embeddings:backfill -w @kkdm/api` for existing products. |
| Online payment shows "unavailable" | Configure `PAYMENT_PROVIDER` and keys (see payments.md). Cash and transfer still work. |
| `Atlas vector search failed — is the vector index created?` in logs | Run `npm run db:indexes` with `VECTOR_SEARCH_PROVIDER=atlas` and wait until the index is READY in Atlas. |
| Metro can't resolve `@kkdm/shared` | Run `npm install` from the repository root (workspaces). |
| Too many requests (429) while testing | Limits are per IP/user per window; wait or restart the API (in-memory limiter). |
