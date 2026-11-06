# Lineboard — repository notes

Booking and billing board for independent shared commercial kitchens. One
install serves several kitchens; each kitchen sees only its own records.

## Running it

```
npm ci          # install
npm run build   # tsc --noEmit, then esbuild the server and the browser app
npm run start   # node dist/server.js, binds 0.0.0.0 on APP_PUBLIC_PORT (4173)
```

`/app/run.json` holds those three commands. Every service URL and credential is
read from the environment at start (see `src/server/config.ts`); nothing is
written into source or sent to the browser.

Backing services: PostgreSQL (system of record), Kill Bill (accounts, draft
invoices, commits), Mailpit over plain SMTP, and S3-compatible object storage.
The Kill Bill, SMTP and S3 clients are written directly against `fetch`,
`node:net` and SigV4 so the shipped dependency tree is just `pg`.

## Where each domain rule lives

Each rule is decided in exactly one place:

| Rule | Module |
|---|---|
| cross-site decision on state-changing requests | `src/server/http/crossSite.ts` |
| published route table, outside which `/api` answers 404 | `src/server/http/router.ts` |
| error-precedence order | `dispatch` in `src/server/http/router.ts`, then each route handler |
| published copy of every error code and field error | `src/server/http/errors.ts` |
| booking transitions, grace instant, automatic lapses, offered actions | `src/server/domain/transitions.ts` |
| kitchen time, the 24:00 rule, wall-time resolution | `src/server/domain/time.ts` |
| rate versions, their status, peak quarters, pricing and rounding | `src/server/domain/rates.ts` |
| block validation and pricing for holds and moves | `src/server/api/blocks.ts` |
| occupancy, shelf capacity, one winner | `takenFor` in `src/server/routes/bookings.ts` with the locks in `src/server/db/pool.ts` |
| hour ledger paired with each Kill Bill item | `src/server/store/ledger.ts` |
| hour-bank claim order (per member and month, ascending) | `lockHours` and `hoursRefusal` in `src/server/routes/bookings.ts` |
| 48-hour cutoff and the late fee | `cancelBooking` in `src/server/routes/bookings.ts` |
| current document, expiry status, notice ladder, check-in rule | `src/server/domain/documents.ts` |
| adjustment month for a post-close waiver | `earliestOpenMonth` in `src/server/store/months.ts` |
| Kill Bill amount and the pre-close comparison | `src/server/services/killbill.ts`, `closeMonthRoute` |
| statement body layout | `statementMessage` in `src/server/api/emails.ts` |
| usage CSV rows, numeric cells and text neutralisation | `src/server/api/usageCsv.ts` |
| idempotent request comparison and replay | `src/server/http/idempotency.ts` |
| text normalisation, counting, refused business-name characters | `src/server/domain/text.ts` |
| sign-in throttle | `signIn` in `src/server/routes/session.ts` |
| the seed and its first-start date | `src/server/db/seed.ts` |
| role shape of member records | `memberRecord` in `src/server/api/shapes.ts` |
| accepted keys of each write body | `exactBody` in `src/server/api/validate.ts` plus each handler's key list |
| which screens each role reaches, and return addresses | `src/client/routes.ts` |
| keyboard handling of a block in hand | `stepGhost` in `src/client/screens/board.ts` |
| member picker opening, active option and selection | `src/client/components/memberPicker.ts` |
| board dialogs over the board, focus and scroll restoration | `src/client/components/dialog.ts` |

`src/shared/` holds what the server and browser both need: calendar arithmetic
and labels (`calendar.ts`) and the published placeholder formats, status words
and block labels (`format.ts`).

## One-at-a-time rules

All settled in PostgreSQL with transaction-scoped advisory locks, taken in this
global order so no transaction can deadlock with another:

1. `monthClose` per kitchen and month, ascending month order
2. `station`, ascending station id
3. `booking`
4. `memberMonthHours` per member and month, ascending month order

Other classes (`kitchenRules`, `memberDocumentType`, `inspectorLink`,
`signinEmail`) are taken alone. `transact` retries serialisation failures and
deadlocks inside the request, so contention never answers 5xx.

## Money and hours

Money is integer cents end to end. Hours are stored as integer quarter hours
(`quarter_hours`, `peak_quarters`, `allowance_quarters`) and divided by four only
when a response is shaped, so no amount or balance ever touches floating point.

## Outages

`billing_items` rows with `recorded_at` null are the Kill Bill queue and the
invoice lines at once; `sanitation_reports` rows with status `queued` are the
storage queue. `src/services/outbox.ts` retries both every five seconds, in
queue order per member, and also writes seed document objects and Kill Bill
accounts that could not be created at first start. Those last two are never
counted in `GET /api/service-status`.

## Testing notes

There is no checked-in test suite. The journeys were exercised against the real
services with throwaway scripts; two things are worth knowing if you write more:

- Give each run a fresh database (the harness does this per instance). Reusing
  one makes block-taken and hour-bank checks fail on leftover bookings.
- To exercise recovery without a restart, start the server with
  `KILLBILL_URL=http://127.0.0.1:18080` (or `S3_ENDPOINT=http://127.0.0.1:19000`)
  where nothing listens, then start a TCP forwarder on that port to the real
  service. Queued work completes within about ten seconds.
