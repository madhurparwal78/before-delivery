# Holdfast Register — repository notes

Equity register for one company, Tidecraft Robotics. TypeScript end to end, Node 22.

## Running it

- `/app/run.json` is the only entry point: `npm ci`, `npm run build`, `npm run start`.
- The server binds `0.0.0.0:4173` (or `APP_PUBLIC_PORT`) and applies the schema and seed on
  every start, seeding only an empty register.
- Services come from the environment: `DATABASE_URL`, `S3_*` (MinIO vault), `WIREMOCK_URL`
  (Quillon Pay). Windows and warnings: `OFFER_WINDOW_SECONDS`, `OFFER_WARNING_SECONDS`,
  `LEAVER_WINDOW_SECONDS`, `LEAVER_WARNINGS_SECONDS`. Nothing is hard-coded.

## Shape of the source

```
src/shared/     types, display formats and document texts used by both sides
src/server/
  domain/       pure rules: dates, money, vesting, ownership, allocation, scenario
  model/        read models over PostgreSQL (grants, orders, tenders, register totals)
  flows/        writes that cross tables: exercise, ledger, offers, tender close
  live/         event log, audiences and the WebSocket hub
  http/         boundary, errors, router and one file of routes per area
  scheduler.ts  every timed change (vesting, expiry, warnings, window end, tender close)
src/web/        vanilla TypeScript pages, one module per screen, built by Vite
```

Each domain rule lives in exactly one place:

- vesting dates and cumulative counts: `src/server/domain/vesting.ts`
- exercise cost rounding: `exerciseCostCents` in `src/server/domain/money.ts`
- largest-remainder ownership: `src/server/domain/ownership.ts`
- pro rata tender allocation: `src/server/domain/allocation.ts`
- round scenario arithmetic: `src/server/domain/scenario.ts`
- document texts: `src/shared/documents.ts`

## Things that are easy to get wrong

- Money is exact: cents and ten-thousandths as `bigint`, never floating point.
- Every timed state change is decided by `scheduler.ts` on the server clock; the browser
  only renders what the server returned or pushed.
- Writes go through `writeWithEvents`, which publishes live events only after the commit.
- Exercise orders serialise on the idempotency key and on the grant (`withLock`), so five
  simultaneous requests make one order and racing orders stay within exercisable.
- The grant form sends draft saves one at a time and ignores the live event its own save
  caused (compare `draft_version`), or it would wipe fields the person is typing.

## Checking it by hand

Seed logins all use `Tidecraft-demo-2026`. With the seed data on 3 Nov 2026, grant
TC-OPT-0007 has 21,000 of 48,000 vested, the cap table totals 8,800,000 and 100.00, and a
scenario of $40,000,000 / $10,000,000 / 12.00% gives a price of $4.3191 at 7.06× the
current fair market value.
