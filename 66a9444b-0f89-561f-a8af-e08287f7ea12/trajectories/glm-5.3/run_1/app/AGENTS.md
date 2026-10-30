# Kerf Frequencies — app notes

Festival platform for Kerf Collective (Kerf Frequencies 2027, Brussels). TypeScript throughout:
`src/server` (Node HTTP server), `src/shared` (domain rules), `src/client` (browser modules, no bundler).

## Build and run

- `run.json` manifest: `npm ci` → `npm run build` (tsc + copy static assets) → `npm run start` (node dist/server/main.js).
- Server listens on `0.0.0.0:$APP_PUBLIC_PORT` (default 4173). Schema and seed data apply idempotently on every boot.
- Seeded staff/visitors all use password `kerf-festival-2027`.

## Environment

DATABASE_URL, KILLBILL_URL/USERNAME/PASSWORD/API_KEY/API_SECRET, SMTP_HOST/PORT, MAIL_FROM,
MAILPIT_URL, S3_ENDPOINT/REGION/BUCKET/FORCE_PATH_STYLE/ACCESS_KEY_ID/SECRET_ACCESS_KEY,
APP_PUBLIC_PORT, APP_SECRET (generated and stored in Postgres when unset), plus
HOLD_SECONDS, WAITLIST_CLAIM_SECONDS, PROOF_DECISION_SECONDS, BILLING_DAY_SECONDS, SIGNED_READ_SECONDS.

## Platform quirks learned (important)

- The Kill Bill endpoint answers payment creation (POST /accounts/{id}/payments, POST /payments/{id})
  with an **empty body**; the created payment must be read back from GET /accounts/{id}/payments and
  matched by `transactionExternalKey`. Tenant headers are `X-Killbill-Apikey`/`X-Killbill-Apisecret`
  (this casing), actor header is `X-Killbill-CreatedBy`.
- `POST /1.0/kb/accounts/{accountId}/charges` and every invoice-creation shape return 404 on this
  build: group invoices live in Postgres; collections are PURCHASE payments with external key
  `<invoice number>-<attempt>`, returns are CHARGEBACKs on the collected payment.
- MinIO SigV4: canonical header names MUST be lowercased (a capitalised `Content-Type` produced
  SignatureDoesNotMatch).
- pg is CommonJS: `import pg from "pg"` then `const { Pool } = pg`.

## Layout

- `src/shared/time.ts` — Europe/Brussels wall time, the repeated hour, festival day 05:00–05:00.
- `src/shared/money.ts` — cents, the published discount/voucher allocation rule, ref and pass codes.
- `src/server/http.ts` — request boundary (size limits, 415, cross-origin), route table with roles,
  sessions, signed file links, the mail outbox.
- `src/server/services/` — one home per domain rule: seats, state machine, refunds, vouchers/ledger,
  invoices, passes, image decode/resize/encode, Kill Bill adapter, idempotency.
- `src/server/scheduler.ts` — 2s sweep: hold expiry, waitlist offers, proof lapses, auto-publish,
  invoice collections and retries, mail delivery, pending refunds.
- `src/client/` — programme page with the WebGL lattice (and static SVG twin), checkout dialog, staff
  screens; every screen is a module in `src/client/pages/`.
