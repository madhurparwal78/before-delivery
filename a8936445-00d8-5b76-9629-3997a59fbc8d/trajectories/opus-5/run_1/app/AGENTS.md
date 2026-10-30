# Stationkeeper — repository notes

Booking, compliance and billing desk for Larder Row Kitchen, a single shared-use commercial
kitchen. TypeScript everywhere; one Node process serves both the browser app and the API.

## Layout

```
run.json                 install / build / serve manifest
public/fonts             self-hosted woff2 (Bricolage Grotesque, Public Sans, JetBrains Mono)
scripts/notices.mjs      regenerates THIRD_PARTY_NOTICES.md from the production dependency tree
src/server/config.ts     every service URL and credential, read from the environment
src/server/domain        pure rules: kitchen time, availability, hold-over, cancellation,
                         document validity, tenant status, invoice totals
src/server/db            pool, schema DDL, seed, idempotency store, repo/* query modules
src/server/providers     killbill, storage (MinIO via hand-rolled SigV4), smtp, pdf
src/server/services      use cases; unitOfWork.ts holds the multi-system transaction rule
src/server/routes        HTTP wiring plus the published-field serializers
src/client               React SPA: dial, bookings, documents, billing, tenants, settings,
                         public inspector page
```

Build: `npm run build` runs `vite build` (client → `dist/client`) then `tsc` (server →
`dist/server`). `npm start` serves both from `APP_PUBLIC_PORT` (default 4173).

## Things worth remembering

- **Kitchen time is America/Chicago.** `src/server/domain/time.ts` resolves wall-clock times with
  `Intl` only (no tz library). `resolveLocal` returns `null` for times skipped by the spring
  change and picks the first (daylight) occurrence for repeated times.
- **Idempotent responses are stored as text, not `jsonb`.** `jsonb` reorders object keys, so a
  replay would not be byte-identical to the first response.
- **Kill Bill** runs at 0.24.x. Accounts get the `AUTO_PAY_OFF` control tag and an
  `__EXTERNAL_PAYMENT__` payment method on creation. `GET /1.0/kb/accounts/{id}/invoices` does not
  return items even with `withItems=true`; fetch each invoice by id to see them. Transaction
  external keys are unique for the life of the Kill Bill tenant, so `purchase` treats a refused
  create whose key Kill Bill already holds as a payment that is already recorded — that is what
  makes a retry after a lost response safe. Resetting PostgreSQL without resetting Kill Bill can
  still reuse an invoice number on a *different* tenant's account; that only happens in a
  half-reset development environment.
- **Units of work** (`services/unitOfWork.ts`): records are written in an uncommitted transaction,
  then Kill Bill, then MinIO, then any synchronous email, then commit. A provider failure rolls
  back, deletes stored objects and reverses Kill Bill records as `Reversal: <description>`;
  reversals Kill Bill refuses are parked in `pending_reversals` and retried by the sweep.
- **Tenant status** for `active`/`suspended` is derived at every request from document validity;
  only the other states are stored.
- **Station contention** uses `pg_advisory_xact_lock` keyed by station; hour-pack spending uses one
  keyed by tenant.
- Seeded document PDFs live in `documents.seed_pdf` until the sweep can write them to MinIO, so
  the app boots with storage unreachable.

## Checking the work

No test framework ships with the app. Ad-hoc harnesses used during development (Playwright for the
browser, plain `fetch` scripts for the API) lived in `/tmp/pw`. Useful probes:

- `curl -s localhost:4173/api/health`
- Mailpit UI/API at `$MAILPIT_URL` for every email.
- To simulate an outage, start a second instance with `KILLBILL_URL`/`S3_ENDPOINT`/`SMTP_HOST`
  pointing at a dead port, then start a TCP proxy to prove recovery needs no restart.
