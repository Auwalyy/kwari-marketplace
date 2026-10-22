# Deployment

The backend is a single Node.js service (a modular monolith: REST API, Socket.IO, background job worker). It needs MongoDB, S3-compatible object storage and optional providers.

## 1. Database (MongoDB Atlas)

1. Create a project and a cluster in the region nearest your users (e.g. `eu-west` / `af-south-1` if available). Use an M10+ dedicated tier for production; Atlas Vector Search and transactions are supported.
2. Create a database user with `readWrite` on the `kkdm` database only. Use a long random password.
3. Network access: allow only your API hosts' egress IPs (avoid `0.0.0.0/0`).
4. Enable continuous backups / point-in-time restore.
5. Set `MONGODB_URI`, then run `npm run db:indexes` once per deploy (see visual-search.md for the vector index). Production disables Mongoose auto-indexing, so this step is required.

## 2. Image storage

Any S3-compatible store works: AWS S3, Cloudflare R2, DigitalOcean Spaces, Backblaze B2, MinIO.

```
STORAGE_PROVIDER=s3
STORAGE_BUCKET=kkdm-images
STORAGE_REGION=auto                 # or e.g. eu-west-1
STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # omit for AWS
STORAGE_ACCESS_KEY=...
STORAGE_SECRET_KEY=...
STORAGE_PUBLIC_BASE_URL=https://images.example.com            # CDN / public domain for the bucket
```

Permissions:
- Give the API credentials `PutObject`, `GetObject` and `DeleteObject` on this bucket only.
- Make **only the `public/` prefix** publicly readable (catalogue, shop and avatar images), ideally through a CDN.
- Keep `private/` (chat attachments) private. The API streams those objects or issues 5-minute signed URLs to authorised participants only.
- Uploaded images are re-encoded to WebP with all metadata stripped before storage. Thumbnails (400 px) are used in lists.

## 3. API service

Any container or Node host works (Render, Railway, Fly.io, AWS ECS/App Runner, a VM with PM2).

```bash
npm ci
npm run build:api        # builds packages/shared and apps/api to dist/
NODE_ENV=production node apps/api/dist/server.js
```

Minimal Dockerfile:

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY . .
RUN npm ci && npm run build:api && npm prune --omit=dev
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
```

- Health check: `GET /health`. Readiness (includes the DB): `GET /ready`.
- Behind a load balancer / proxy set `TRUST_PROXY` (e.g. `1`) so rate limits and audit logs see real client IPs.
- Enable WebSockets on the proxy (sticky sessions are not required with the WebSocket transport).
- Shutdown is graceful on SIGTERM (stops jobs, closes sockets and HTTP, disconnects the DB; 15 s timeout).
- Logs are structured JSON (pino) with request IDs; tokens, passwords, codes and message text are redacted.

### Running more than one instance

- The job queue lives in MongoDB with atomic claiming, so several instances can share it safely. Set `JOBS_ENABLED=false` on extra instances if you want a single dedicated worker.
- Rate limiting is in-memory per instance. For strict global limits plug `rate-limit-redis` into `apps/api/src/middleware/rateLimit.ts`.
- Socket.IO rooms are per instance. Add `@socket.io/redis-adapter` in `apps/api/src/sockets/index.ts` so events reach users connected to other instances.

## 4. Mobile app

1. Set `EXPO_PUBLIC_API_URL` for each profile in `apps/mobile/eas.json` (HTTPS in production).
2. `npx eas-cli@latest build --profile production --platform all`
3. `npx eas-cli@latest submit` to Google Play / the App Store.
4. Set `APP_ORIGIN` / `CORS_ALLOWED_ORIGINS` on the API only if you also serve a web build.

## 5. Production security checklist

- [ ] `NODE_ENV=production`. The API refuses to start with local storage, console verification codes, the dev embedding baseline, `*` CORS, short or identical JWT secrets.
- [ ] JWT secrets: 48+ random bytes each, different from each other, stored in the host's secret manager (never committed). Rotating the refresh secret invalidates all sessions and invitation codes. Plan rotations accordingly.
- [ ] HTTPS everywhere (API, storage CDN, webhook URLs).
- [ ] MongoDB: least-privilege user, IP allow-list, backups, encryption at rest (Atlas default).
- [ ] Storage bucket: private by default, public read only on `public/`.
- [ ] Payment provider in live mode with the webhook URL configured and the signing secret set. Test a full payment and refund in test mode first.
- [ ] SMTP (verification emails) and Termii (SMS) configured; sender IDs approved.
- [ ] First administrator created with `npm run admin:create`; no demo data (`npm run seed` refuses in production).
- [ ] `SWAGGER_ENABLED=false` if you don't want public API docs.
- [ ] Log retention configured at the host; no request bodies are logged.
- [ ] Monitoring/alerts on `/ready`, 5xx rates, and the `jobs` collection (`status: failed`).
- [ ] Review the audit log regularly (Admin → Audit log), in particular `invitation.*_redeem` failures (Admin → Invitation monitoring) and `auth.refresh_reuse_detected`.
- [ ] Rate limits reviewed for expected traffic (`apps/api/src/middleware/rateLimit.ts`).
- [ ] Privacy policy and terms published; account deletion (Settings → Delete account) is available in-app, as app stores require.

## External services (accounts / keys needed)

| Service | Needed for | Paid? |
|---|---|---|
| MongoDB Atlas | Database (+ vector search) | Free tier for development; paid dedicated cluster recommended for production |
| S3-compatible storage (R2, S3, Spaces…) | Image storage | Pay-as-you-go (small) |
| Jina AI or Cohere | Visual search embeddings | Paid per request (free trial credits available) |
| Paystack or Flutterwave | Online payments | Per-transaction fees; business verification for live mode |
| SMTP provider (e.g. Postmark, SES, Mailgun) | Email verification / password reset | Usually paid beyond a free tier |
| Termii | SMS verification (Nigeria) | Paid per SMS |
| Expo / EAS | Builds and push notifications | Free tier available; Apple Developer ($99/yr) and Google Play ($25 one-time) accounts required to publish |
| Maps (optional) | Not required: the app uses written directions and opens the device's maps app with coordinates | — |
