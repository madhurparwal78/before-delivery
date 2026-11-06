# Lumenfold Dispatch

Hosted prepaid-credit generation queue for in-house product teams (Postgres + MinIO + Kill Bill + SMTP/Mailpit, simulated deterministic media).

## Commands

- `npm ci` — install from the committed lockfile
- `npm run build` — compile server TS (`tsconfig.json`) and browser TS (`tsconfig.browser.json`), copy `public/` into `dist/browser`
- `npm run start` — serve `dist/` on `0.0.0.0:$APP_PUBLIC_PORT` (4173 by default)

All service URLs and credentials come from the environment at start (see `src/server/config.ts`).

## Layout

- `src/shared/` — money (integer micro-credits, one half-up rounding), model catalogue with published unit rules, org-timezone calendar math (DST-safe). Reused by server and browser.
- `src/server/` — HTTP API (`api.ts`), domain rules (`domain.ts`), jobs + idempotency (`jobs.ts`), dispatcher (`dispatch.ts`), assets/lineage (`assets.ts`), webhooks (`webhooks.ts`), top-ups (`topups.ts`), policy (`policy.ts`), storage (hand-rolled SigV4 S3 client), Kill Bill client, SMTP client, SSRF-guarded outbound HTTP.
- `src/browser/` — no-framework TypeScript app: `main.ts` (router/session/service status), `ribbon.ts` (Reservation ribbon with reserve/replay/settle/release motion), `jobdialog.ts`, `screens/` (run, jobs, library, webhooks, finance, admin).
- `public/` — shell HTML, CSS design system (bone/graphite/teal/vermilion), bundled woff2 fonts (OFL-1.1).
- `scripts/` — `build.mjs` plus test harnesses: `test-journeys.py` (API journeys), `test-outage.py` (storage/billing outage journeys, needs the schema-isolated instance it boots itself), `test-frontend.mjs` (Playwright), `proxy.mjs` (TCP proxy used by outage tests), `clean-bucket.mjs`.

## Things that bit us

- pg returns `int8`/`bigint` columns as strings; wrap with `BigInt()` before any arithmetic.
- Kill Bill paths (swagger at `/swagger.json`): create account `POST /1.0/kb/accounts`, external charge invoice `POST /1.0/kb/invoices/charges/{accountId}?autoCommit=true`, payment method `POST /1.0/kb/accounts/{id}/paymentMethods` with `pluginName: __EXTERNAL_PAYMENT__` in the body, payment `POST /1.0/kb/invoices/{id}/payments`.
- `Intl.DateTimeFormat` needs every component listed explicitly or the offset math is wrong.
- The pending top-up retry loop must skip top-ups younger than ~30 s, or it races the synchronous Kill Bill call and double-pays (Kill Bill answers 4xx "already paid").
