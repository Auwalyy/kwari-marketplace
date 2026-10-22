# Deploying the API to Render (no custom domain needed)

This guide takes you from "it runs on my laptop" to "the app on my phone talks to a live server".
You need three hosted services. None of them needs your own domain name:

| What | Service | Address you get for free |
| --- | --- | --- |
| API server | Render | `https://kantin-kwari-api.onrender.com` |
| Database | MongoDB Atlas | `mongodb+srv://…mongodb.net` |
| Product / shop images | Cloudinary (or Cloudflare R2) | `https://res.cloudinary.com/<cloud name>/…` |

A custom domain (for example `api.kantinkwari.ng`) can be added later without changing any code. You only
update the environment variables.

---

## 1. Image storage

The API stores two kinds of files:

- **Public images** (product photos, shop logos and covers, avatars). Anyone may view these, so they are
  served straight from the storage service's CDN.
- **Private files** (chat attachments). Only the people in the chat may see these. The API checks
  permission and hands out a link that expires after a few minutes.

The API resizes images, removes location data and converts them to WebP itself before uploading. The
storage service only stores and serves the files, so everything works the same on either option.

### Option A (recommended): Cloudinary

1. Sign up at cloudinary.com (the free plan is enough to start).
2. Dashboard → **API Keys** (or **Programmable Media → Dashboard**). Copy the **API environment
   variable**. It looks like `cloudinary://123456789012345:AbCdEf…@your-cloud-name`.
3. Values for Render:

   ```
   STORAGE_PROVIDER=cloudinary
   CLOUDINARY_URL=cloudinary://<api key>:<api secret>@<cloud name>
   CLOUDINARY_FOLDER=kantin-kwari
   ```

Public images are served from `https://res.cloudinary.com/<cloud name>/…`. Chat attachments are uploaded
as Cloudinary *private* assets: they have no public link, and the API hands out signed download links
that expire after 5 minutes. Locally, use `CLOUDINARY_FOLDER=kantin-kwari-dev` so test uploads stay apart.

Images uploaded before you switch providers keep their old links. Re-upload them, or re-run the seed in
development.

### Option B: Cloudflare R2

On R2, turning on public access makes **the whole bucket** public. So you use **two buckets**:

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket**:
   - `kantin-kwari-production`: public images.
   - `kantin-kwari-private`: chat attachments. **Never** turn on public access for this one.
2. Open `kantin-kwari-production` → **Settings** → **Public access** → **R2.dev subdomain** → **Allow**.
   Copy the URL it shows (`https://pub-….r2.dev`). This is your `STORAGE_PUBLIC_BASE_URL`.
   (Cloudflare rate-limits r2.dev URLs. This is fine to launch with. When traffic grows, connect a
   custom domain under the same **Public access** section and change only `STORAGE_PUBLIC_BASE_URL`.)
3. R2 overview page → **Manage R2 API Tokens** → **Create API token**:
   - Permission: **Object Read & Write**
   - Specify buckets: both buckets above
   - Create, then copy the **Access Key ID** and **Secret Access Key**. The secret is shown only once.
4. Your endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. The account ID is shown on the R2
   overview page.

Values for Render:

```
STORAGE_PROVIDER=s3
STORAGE_REGION=auto
STORAGE_BUCKET=kantin-kwari-production
STORAGE_PRIVATE_BUCKET=kantin-kwari-private
STORAGE_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
STORAGE_ACCESS_KEY=<Access Key ID>
STORAGE_SECRET_KEY=<Secret Access Key>
STORAGE_PUBLIC_BASE_URL=https://pub-xxxxxxxx.r2.dev
```

> For local development, either keep `STORAGE_PROVIDER=local` (files go in `apps/api/uploads`) or use a
> separate pair of dev buckets. Don't upload test images into the production bucket.

## 2. Database: MongoDB Atlas

1. **Database name.** Without one, Atlas silently uses a database called `test`. Set it with
   `MONGODB_DB_NAME`. This is the easiest way, and `render.yaml` already sets `kkdm`:

   ```
   MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/
   MONGODB_DB_NAME=kkdm
   ```

   You can also put the name in the connection string, right after `.net/`:
   `…mongodb.net/kkdm?retryWrites=true&w=majority`. You don't have to create the database in Atlas
   first. It appears automatically the first time the API saves something.

   Use a different name locally (for example `MONGODB_DB_NAME=kkdm_dev`) so `npm run seed` never touches
   real data. The seed script refuses to run with `NODE_ENV=production`.
2. **Database user.** Atlas → **Database Access** → create a user with a long random password (letters and
   digits only, so it needs no URL-escaping) and the role **Read and write to any database**.
3. **Network access.** Atlas → **Network Access** → **Add IP Address**. Render's outbound IPs are listed
   in your Render service under **Connect → Outbound**. Add those, or on Render plans without fixed IPs
   add `0.0.0.0/0` (allow from anywhere). The strong password is then what protects the database.
4. **Indexes.** After the first deploy, create the indexes once from your computer. Point the command at
   production only for this run:

   ```powershell
   $env:MONGODB_URI = "mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/"
   $env:MONGODB_DB_NAME = "kkdm"
   npm run db:indexes
   Remove-Item Env:MONGODB_URI, Env:MONGODB_DB_NAME
   ```

## 3. Deploy the API on Render

The repository contains a `render.yaml` blueprint that describes the service. It installs only the API
and shared packages (not the Expo app), compiles TypeScript, runs `node apps/api/dist/server.js` and uses
`/ready` as the health check.

1. Commit and push everything, including `package-lock.json` and `render.yaml`, to GitHub on `main`.
   **Never commit `.env`.**
2. On render.com: **New +** → **Blueprint** → connect GitHub → choose this repository.
3. Render reads `render.yaml` and asks for each value marked `sync: false`:
   - `MONGODB_URI`: from step 2. `MONGODB_DB_NAME=kkdm` is already set by `render.yaml`.
   - `CLOUDINARY_URL` from step 1. If you chose R2, change `STORAGE_PROVIDER` to `s3` and add the
     `STORAGE_*` values instead.
   - `API_BASE_URL`: enter `https://kantin-kwari-api.onrender.com`. If Render gives the service a
     different URL (shown at the top of the service page), change this value to match and redeploy.

   `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are generated by Render automatically. Don't copy your
   local ones.
4. Click **Apply**. The first build takes about 3–5 minutes.
5. Check that it works:
   - `https://<your-service>.onrender.com/ready` should return `{"status":"ready","database":true}`.
   - `https://<your-service>.onrender.com/api/docs` should show the API documentation.

   If the service fails to start, open **Logs**. The server prints exactly which setting is missing or
   wrong (for example `MONGODB_URI is required`).
6. Create your administrator account from your computer, against production:

   ```powershell
   $env:MONGODB_URI = "mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/"
   $env:MONGODB_DB_NAME = "kkdm"
   npm run admin:create -w @kkdm/api -- --email you@example.com --name "Your Name" --password "a-strong-password"
   Remove-Item Env:MONGODB_URI, Env:MONGODB_DB_NAME
   ```

**Plan:** `render.yaml` uses **Starter**. The free plan sleeps after 15 minutes without traffic. That
disconnects live chat, pauses background jobs and makes the next request wait about a minute. It is
fine for a quick trial: change `plan: starter` to `plan: free`, but don't launch on it.

Every push to `main` redeploys automatically.

## 4. Point the mobile app at the server

1. In `apps/mobile/eas.json`, replace every `https://api.example.com` with your Render URL, for example
   `https://kantin-kwari-api.onrender.com`. There is no trailing slash and no `/api`.
2. Build:

   ```bash
   cd apps/mobile
   npx eas build --profile preview --platform android   # installable APK for testing
   npx eas build --profile production --platform all    # store builds
   ```

   A release build with a missing, `example.com` or non-https URL shows an "App not configured" screen
   instead of failing silently.

## 5. Things that are switched off until you add a provider

These are set to `none` / `false` in `render.yaml`. The app hides or explains each feature instead of
pretending it works.

| Feature | Setting | What to add later |
| --- | --- | --- |
| Email / SMS codes (verification, password reset) | `VERIFICATION_EMAIL_PROVIDER`, `VERIFICATION_SMS_PROVIDER` | SMTP details or a Termii key, see `.env.example` |
| Online payment | `PAYMENT_PROVIDER` | Paystack or Flutterwave keys + webhook URL, see `docs/payments.md` |
| Visual (photo) fabric search | `IMAGE_EMBEDDING_PROVIDER` | Jina or Cohere key, see `docs/visual-search.md` |
| Push notifications | `PUSH_NOTIFICATION_ENABLED` | See `docs/push-notifications.md` |

To change a setting: Render service → **Environment** → edit → **Save, rebuild and deploy**.
