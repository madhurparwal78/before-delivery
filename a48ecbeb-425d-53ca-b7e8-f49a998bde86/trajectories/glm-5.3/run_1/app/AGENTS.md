# Ceibo Shop & Cellar - project memory

## What this app is
The online shop + back office for Ceibo (organic sparkling yerba mate, Canada).
Storefront (crate building, subscriptions, stockists) plus a back office for
fulfilment, support and the owner. Everything is TypeScript; the run manifest is
`/app/run.json` (`npm ci`, `npm run build`, `npm run start`, port `APP_PUBLIC_PORT`).

## Service quirks learned the hard way (verified by probing 2026-11-01)
- **Kill Bill** (0.24.21-like mock): auth uses `X-Killbill-ApiKey`/`X-Killbill-ApiSecret`
  headers (NOT the official `X-Killbill-Api-Key` names), plus basic auth and
  `X-Killbill-CreatedBy`. `GET /1.0/kb/tenants` needs `?apiKey=`.
- Plans are created with `POST /1.0/kb/catalog/simplePlan` (billingPeriod `BIMESTRIAL`
  for two months). `DELETE /1.0/kb/catalog` wipes all versions.
- Accounts carry `AUTO_PAY_OFF` **and** `AUTO_INVOICING_DRAFT` tags. In DRAFT mode the
  subscription-linked invoice stays DRAFT so charge items (`POST /invoices/charges/{accountId}`
  with `invoiceId` in each item) can join it before `commitInvoice`.
- Payments: `POST /invoices/{id}/payments?paymentMethodId=..&externalPayment=true` with
  `paymentExternalKey` = `<database>/<order number>`. Overpaying an invoice 400s; reusing a
  payment external key 400s ("Invalid payment transition PURCHASE from PURCHASE_SUCCESS").
  Payment keys are never reusable - order numbers must never repeat.
- Renewal invoices get their recurring item asynchronously (timing varies, minutes not
  seconds), so the renewal job adds a full set of charge items when the item has not
  appeared. `POST /invoices?accountId=&targetDate=` only works for cycles after the
  current one.
- `chargedThroughDate` only advances when a DRAFT invoice with the subscription-linked
  recurring item is committed; it stays null before that, so the app keeps its own
  `subscriptions.next_cycle` (start + period) as the renewal/cutoff source of truth.
- Blocking states resolve by latest `effectiveDate` (ties: later insert wins), so
  "resume" inserts `CEIBO_ACTIVE` effective on the pause's from-date.
- **PocketBase**: realtime is SSE at `/api/realtime` (PB_CONNECT gives a clientId) then
  `POST /api/realtime` with `{clientId, subscriptions:["stock_levels","reviews"]}`.
- **MinIO**: S3 SigV4 implemented by hand in `server/services/s3.ts`; the bucket already
  exists (never create one).
- Postgres `DATE` columns come back as JS Dates; always normalize with `ymd()` from
  `server/domain/subscriptions.ts` before serialising.

## Layout
- `server/` - compiled to `dist/server` (rootDir is the repo root). Entry `dist/server/main.js`.
- `web/` - vanilla TS, bundled by esbuild to `dist/web/assets/app.js`; static assets
  copied from `public/` to `dist/public` during build.
- Kill Bill, subscription cycles, dunning and refunds are driven by `server/jobs.ts`;
  every job claims a row in `job_locks` so multiple processes share the work.
- Test cards (no real network): 4242... always approves, 4000...0002 always declines,
  4000...0341 approves the charge in the request that enters it and declines after.

## Testing shortcuts
- To test dunning quickly run the server with `DUNNING_DAY_SECONDS=3`.
- Clean test data with the script pattern in the smoke tests; keep
  `order_numbers.last_number` at 100003 (Kill Bill payment keys gf_dev/CB-100001..100003
  already exist and are not deletable).
