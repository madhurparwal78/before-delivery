# Plotwright — repository notes

A hosted browser sandbox for friend groups: rented world servers, characters on
a tile map, in-world tables for chess, four in a row and a four-player trick
game, coins on a balanced ledger, and billing held by Kill Bill.

## Layout

```
run.json                  install / build / serve manifest (run-manifest-v1)
public/                   styles.css and the three self-hosted woff2 fonts
src/shared/               copy.ts, domain.ts, types.ts — used by server and browser
src/server/
  config.ts               every environment variable; tunable defaults in one place
  errors.ts               the one error builder (codes, statuses, Retry-After)
  validate.ts             published field rules and the unknown-field check
  http/                   boundary, session, ETag/If-Match, idempotency
  db/                     pool, schema.ts (SQL as a string), seed.ts
  domain/                 one module per rule (see below)
  services/               killbill.ts, storage.ts (own SigV4), smtp.ts, mail.ts
  routes/                 one module per area; all mounted under /api
  workers.ts              every background loop
src/web/                  React app: router.tsx, shell.tsx, ui.tsx, pages/
```

## One place per rule

| Rule | Module |
|---|---|
| billing status machine | `domain/billing.ts` (`decide`, `decideByClock`) |
| suspension cascade | `domain/suspension.ts` |
| table lifecycle | `domain/tables.ts` |
| chess legality | `domain/chess.ts` |
| four in a row | `domain/four.ts` |
| trick game | `domain/tricks.ts` |
| card visibility filter | `domain/visibility.ts` |
| settlement split and end copy | `domain/settlement.ts` |
| leadership succession | `domain/party.ts` (`removeMember`) |
| trade state machine | `domain/trade.ts` |
| turn clock | `games.ts` deadlines + `workers.ts` `turnClockLoop` |
| per-server query scoping | `domain/servers.ts` (`scopeBySlug`, `scopeByServerId`) |

Every error response is built by `buildError` in `errors.ts`, including the
global 500, the static-file 404 and the event-stream `error` event.

## Kill Bill, as this tenant actually behaves

These were found by probing the live instance; they are easy to get wrong.

- The tenant exists but may hold **no catalog**. `ensureCatalog` uploads one
  through `POST /1.0/kb/catalog/simplePlan` (the hand-written XML catalog was
  rejected as invalid). Plan changes are forced with `?policy=IMMEDIATE`.
- `GET /accounts/{id}/invoices` returns invoices with **amount and balance 0 and
  no items**. Each invoice must be fetched by id with `?withItems=true`.
- An account's payments carry **`targetInvoiceId: null`**. Payments are matched
  to invoices by our own external key, `pw-pay-<invoice id>`.
- A plan change is invoiced on Kill Bill's own bus, a moment after the call
  returns. `requestPlanChange` waits for the new plan's invoice before the
  status machine reads the account, and `decide` only confirms a change when the
  plan-carrying invoice's own balance is settled too. Without both, the server
  briefly reads a half-built state and wrongly confirms the change.
- The account balance needs `?accountWithBalance=true`.

## Other traps met while building this

- `pg` is CommonJS: `import pg from 'pg'` then `const { Pool } = pg`. A named
  import fails at runtime under ESM.
- `SELECT max(...) ... FOR UPDATE` is rejected by Postgres. Save numbering uses
  `pg_advisory_xact_lock` instead.
- **Session advisory locks must be taken and released on one connection.**
  `pg_advisory_lock` is session-scoped, so unlocking through the pool can land
  on a different connection, silently leave the lock held and wedge the feature
  for good — Approve payment answered `payment_pending` for ever and parallel
  coin purchases blocked. Everything now goes through `pool.withLock`, which
  keeps one checked-out client for the lock, the work and the release. No other
  module may call `pg_advisory_lock` directly.
- A 413 must be answered **before** draining: destroying the request socket
  leaves the caller with a closed connection instead of the error.
- `nodemailer` is MIT-0, which is not on the allowed licence list, so
  `services/smtp.ts` speaks SMTP directly. `@aws-sdk/client-s3` was likewise
  avoided; `services/storage.ts` signs its own SigV4 requests.
- `pg-native` appears in `npm ls --omit=dev` with no version because it is an
  optional peer of `pg` that is not installed. It is listed in the notices as
  BSD-3-Clause with that note.
- Seats are numbered from 1 but hands are a 0-based array; `tricks.ts` converts
  with `seat - 1`. Getting this wrong makes every legal-move list empty.

## Running and checking it

```
npm ci && npm run build && npm run start      # serves on APP_PUBLIC_PORT
sh /tmp/restart.sh build                      # rebuild + restart (scratch helper)
```

Schema and seed are applied at every serve under advisory lock 728411, so two
instances starting together duplicate nothing.

Seeded sign-in: handle `mara`, passcode `mara-plots-01` (see `db/seed.ts` for
all eleven). Seeded servers start `pending_approval` and the billing loop gives
them their Kill Bill account and first payment within about 30 seconds.

**When testing extra instances locally**, remember they share the primary's
database. A copy with a short `BILLING_GRACE_SECONDS` will fight the primary
over `suspends_at`, because whichever instance first sees the unpaid invoice
writes the suspension time. Stop the primary when checking the cascade, or give
the copy its own database as `APP_SHORT_URL` does.
