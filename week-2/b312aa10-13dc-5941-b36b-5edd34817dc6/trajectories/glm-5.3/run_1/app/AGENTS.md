# Lineboard

Booking and billing board for shared commercial kitchens. TypeScript on Node 22, one Express server serving the API (`/api/*`) and the browser app from a single origin.

## Run

`run.json` holds the manifest: `npm ci`, `npm run build`, `npm run start`. The server binds `0.0.0.0:$APP_PUBLIC_PORT` (4173 by default) and waits for PostgreSQL at boot; Kill Bill, mail and MinIO being unreachable never stops it.

## Layout

- `src/server/` — API server. `main.ts` holds the published route table and the server boundary (cross-origin rule, body limits, caching, static serving). Domain rules live in one place each: `booking.ts` (state machine, offered actions, occupancy), `pricing.ts` (rates, peak windows, rounding), `hourbank.ts` (per-member-month locking), `idempotency.ts`, `documents.ts` (expiry ladder), `errors.ts` (the published copy of every error code), `time.ts` (kitchen-time rules, 24:00, DST resolution).
- `src/server/routes/` — endpoint handlers. `bookings.ts` (holds/confirms) also exports the Kill Bill delivery helper used by the outbox.
- `src/client/` — browser app, no framework: `main.ts` (frame, router, sign-in), `board.ts` (line board, tickets, dialogs, keyboard moves), one module per other screen.
- `public/` — the built browser app: `app.js`, `app.css`, `fonts/` (Archivo Black, IBM Plex Sans).
- `scripts/` — verification scripts, not part of the served app: `api-test.mjs` (full API suite), `e2e.mjs`/`e2e2.mjs` (Playwright browser suites), `outage-test.mjs`/`recovery-test.mjs` + `proxy.mjs` (billing/storage outage and recovery), `reset-db.mjs` (drops and re-seeds all Lineboard tables).

## Notes learned while building

- pg returns `date` columns as Date objects; `src/server/db.ts` installs a type parser so they arrive as ISO date strings, since Lineboard reasons in kitchen-local dates.
- Handlers answer inside `withContentionRetry` transactions, so `src/server/pipeline.ts` buffers each response and flushes it only after the commit; otherwise a following request can race the commit.
- Kill Bill creates a fresh draft invoice per `externalCharges`/`credits` call; Lineboard attributes each draft to a month through the `lineboard:<itemId>` itemDetails marker and groups deliveries by member and month, so month close can read each member's drafts back and compare totals.
- Kill Bill refuses duplicate `externalKey`s with 409; account creation falls back to a search by external key and reuses the account.
- Every rate/concurrency rule that must be settled one at a time takes an advisory lock: `month:<kitchenId>:<month>` (actions vs closes), `<memberId>:<month>` (hour bank), `signin:<email>` (throttle), `rate:<stationId>` (versions), `kitchen:<id>` (rules version).
- Seed data is applied idempotently at start; first-start dates and instants are stored in PostgreSQL and never recomputed. Seed objects that could not be stored during a storage outage are written by the outbox sweep later, outside the queued counts.
- Sign-in failures are counted in their own committed transaction; the request that fails answers 401 after the count is recorded.
