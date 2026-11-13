# Stationhouse — repository notes

Shared-commercial-kitchen booking desk (single web app + its own server).

## Architecture

- `src/server` — Node 22 HTTP server (bundled by esbuild to `dist/server.js`).
  Strict TypeScript (`tsconfig.server.json`, no DOM lib).
- `src/browser` — single-page app (bundled to `public/assets/app.js`).
  Strict TypeScript (`tsconfig.json`, DOM lib).
- `build/build.mjs` — bundles both, copies fonts to `public/assets/fonts`,
  writes `public/index.html`, copies `schema.sql` next to the server bundle.
- `run.json` — `npm ci` / `npm run build` / `npm run start` (port 4173 or
  `APP_PUBLIC_PORT`).

## Backend services

Postgres is the only system of record (schema + idempotent seed in
`src/server/schema.sql`, applied under an ACCESS EXCLUSIVE lock on every boot;
seeding is skipped when the owner account already exists). Kill Bill is
reachable at `/1.0/kb/*` with `X-Killbill-CreatedBy` required; account lookup
by external key uses `/1.0/kb/accounts/search/{key}` (NOT `?searchKey=`),
external charges use `POST /1.0/kb/invoices/charges/{accountId}?autoCommit=true`
with `amount` (not `rate`), and payments need `accountId` +
`targetInvoiceId` in the body. MinIO speaks sigv4 with the payload hash signed
(`x-amz-content-sha256` header must be signed; `UNSIGNED-PAYLOAD` is rejected).
Mail is delivered over raw SMTP (`src/server/mail/smtp.ts`), not a mail library.

## Gotchas learned while building

- node-postgres returns int8 (bigint) as strings; `main.ts` installs a type
  parser so every epoch-millisecond column reads as a number.
- `end` is a reserved word in Postgres: the bookings column is `"end"` and
  every SQL mention of it must be quoted; TypeScript property access is fine.
- Failed sign-in attempts and counted claims must be recorded in their own
  committed transaction, or the 401/409 rollback un-counts them.
- The no-overlap rule for occupied periods is enforced inside Postgres with an
  exclusion constraint (`booking_occupancies` + btree_gist); rows exist exactly
  while a booking is live, and 23P01 (exclusion violation) maps to 409
  `slot_taken`.
- The browser must compute claim times in the kitchen's zone (two-pass offset
  resolution, same technique as the server's `KitchenClock`).

## Verification

`scripts/` holds dev-only test scripts (not part of the app):
`reset-db.mjs` (drops tables), `smoke.mjs` (60 API checks),
`journeys.mjs` (approve/upload/renewal/hold-expiry/claim-limit),
`door.mjs` (check-in/out inside the window), `concurrency.mjs`
(simultaneous claims/confirms/cancels/move-vs-rival). Each stateful script
expects a fresh database: run `reset-db.mjs` and restart the server first.
