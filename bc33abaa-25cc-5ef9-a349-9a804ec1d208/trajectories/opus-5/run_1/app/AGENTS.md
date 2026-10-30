# Orrery Studio — repository notes

Orrery Studio is one TypeScript web application: an Express server plus a
bundled browser client. It is backed by PostgreSQL, PocketBase, MinIO, Kill Bill
and Mailpit. Everything is driven from `/app/run.json`
(`npm ci` → `npm run build` → `npm run start`), serving on port 4173 or
`APP_PUBLIC_PORT`.

## Layout

- `src/shared/` — code both sides use: graph types and canonical hashing
  (`graph.ts`), the operation table with validation, apply and inverse
  (`ops.ts`), plans and prices (`plans.ts`), formatting (`format.ts`), API DTOs
  (`api.ts`).
- `src/server/domain/` — one place per domain rule: `permissions.ts` (the
  permission table), `scenes.ts` (batches, locks, undo/redo/restore, hashing),
  `versions.ts` (version lifecycle), `subscription.ts` (subscription
  transitions), `uploads.ts` (upload checks), `time.ts` (every time rule),
  `workspace.ts` (seats, audit, billing contacts).
- `src/server/billing/` — Kill Bill orchestration: `engine.ts` (cards,
  idempotency, all-or-nothing payments), `dunning.ts`, `invoicePdf.ts`,
  `catalog.xml`.
- `src/server/http/` — `app.ts` (body limits, origin guard, static assets,
  shell routes), `routes/*.ts` (the API), `errors.ts` (every error shape).
- `src/server/services/` — PostgreSQL pool, PocketBase mirror, MinIO storage,
  Kill Bill client, SMTP client.
- `src/client/` — router, screens (`screens/`), editor (`editor/`), styles.

## Hard-won service details

- **Kill Bill 0.24.21**: re-uploading an identical catalog version answers 400,
  so `ensureCatalog` checks `GET /catalog` first. Account invoice lists omit
  amounts, so each invoice is fetched in full. `callCompletion=true` times out
  while `AUTO_INVOICING_OFF` is set, so mutations run without it and one
  invoice is generated per action by setting `AUTO_INVOICING_OFF`, making the
  changes, clearing the tag and polling for the new invoice. Chargebacks must
  go to `/invoicePayments/{paymentId}/chargebacks` to reopen the balance.
  `POST /invoices` answers 404 when there is nothing left to invoice.
- **PocketBase 0.22**: admin auth is `/api/admins/auth-with-password` and
  collections take a `schema` array where `json` fields need `maxSize`.
- **MinIO**: the bucket is created on first use; any non-4xx failure means the
  store is unreachable (503 `file_storage`).
- **Two serve instances share one database.** The short-clock instance runs
  with `TRIAL_LENGTH_SECONDS=20`, `DUNNING_DAY_SECONDS=5` and
  `TOKEN_WARNING_LEAD_SECONDS=15`, so every scheduled effect is claimed with a
  conditional UPDATE: mail rows, go-live, dunning steps, pending plan changes.
  Token warning instants are stored on the token at issue time so both
  instances agree.

## Testing notes

Seeded members all use the password `orrery-demo-2026`. Useful probes live
under `/tmp/tools` during development (Playwright with
`--use-gl=swiftshader`). The viewport's `data-graph-hash` is computed in the
browser from the same canonical serialisation the server uses, so it matches
`GET /api/scenes/:id` exactly.
