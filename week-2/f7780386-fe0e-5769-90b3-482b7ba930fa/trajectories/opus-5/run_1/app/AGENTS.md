# Passboard — repository notes

Booking, compliance and billing desk for one shared-use commercial kitchen
("Halsted Street Kitchen", `America/Chicago`).

## Running it

| Step | Command |
| --- | --- |
| install | `npm ci` |
| build | `npm run build` (server `tsc` → `dist/server`, browser `vite` → `dist/web`) |
| serve | `npm start` (listens on `APP_PUBLIC_PORT`, default 4173) |

`/app/run.json` holds exactly these three commands plus `_schema` and nothing
else. `npm run notices` regenerates `THIRD_PARTY_NOTICES.md` and fails if any
production dependency carries a licence outside the allowed set.

Environment read once at boot (`src/server/config.ts`): `DATABASE_URL`,
`KILLBILL_*`, `S3_*`, `SMTP_*`, `APP_PUBLIC_PORT`, `PASSBOARD_NOW`,
`PASSBOARD_HOLD_SECONDS`. Nothing is hard-coded or logged.

## Layout

```
src/shared/   domain rules shared by server and browser (time, cost, coverage, CSV)
src/server/   config, clock, db, domain, http (boundary, router, routes), services
src/web/      React app: board grid, ticket rail, drawer, role screens
public/fonts/ self-hosted Big Shoulders Display + Public Sans (OFL-1.1)
scripts/      third-party notices generator
```

## Rules that live in exactly one place

Each of these is decided once in `src/shared/` and reused by every caller,
including the browser's live cost tag:

- `computeCost` — prepaid minutes first, overage at the station rate.
- `lateCancellationFeeCents` — half the list price, rounded half up.
- `validateHoldPlacement` — grid, board hours, past, 28-day window.
- `freeCancelUntil` — the same kitchen wall clock two calendar days before.
- `documentCoversDate` / `documentHasExpired` — validity through the expiry date.
- `checkInWindow` / `isInsideCheckInWindow` — 15 minutes before to the end.
- `csvRow` / `neutraliseCsvCell` — quoting and formula neutralising.
- `src/shared/time.ts` — every instant ↔ kitchen wall clock conversion.

## Things worth remembering

- **One winner per cell** is enforced by the `cell_locks` table's primary key.
  The insert uses `ON CONFLICT ... DO UPDATE ... WHERE existing.expires_at <= now`,
  so an expired hold's cells are taken over atomically and concurrent requests
  serialise on the row lock. Correctness never waits for the sweep.
- **The server clock** is `ServerClock`, started from `PASSBOARD_NOW` and then
  advancing in real time. Request signing for S3 deliberately uses the real
  wall clock, because the object store validates skew; that is not a business
  decision.
- **Error precedence** is encoded in the router pipeline: auth → `resolve`
  (scoped lookup, 404) → role (403) → idempotency → handler. `resolve` must come
  before the role check so a record outside the caller's scope answers 404.
- **Kill Bill's account-scoped invoice list omits items and totals** on this
  build, so `listInvoices` reads each invoice individually.
- **busboy needs `preservePath: true`**, otherwise it silently trims a
  path-like upload name to its last segment and the rule cannot refuse it.
- **`pg` returns `DATE` columns as JS `Date`** by default; `src/server/db/pool.ts`
  installs a type parser so kitchen dates stay `YYYY-MM-DD` strings.
- Queued billing work and outbound mail live in `billing_jobs` and
  `email_outbox`; `runSweep` (every 3 s) drains both, marks expired holds,
  completes finished bookings, sends expiry warnings and writes seed objects.
- The overage worker holds the booking row lock across the Kill Bill call, so a
  cancellation during an outage either drops the queued charge or sees it paid —
  never both.

## Verifying changes

There is no test runner in the repository. Behaviour was verified against the
real PostgreSQL, Kill Bill, MinIO and Mailpit services with scripts driving the
HTTP API and a Chromium browser. When changing behaviour, re-check at least:
role scoping (404 before 403), the cell-collision race, hold expiry edges,
idempotent replay, billing outage and recovery, and the three viewports.
