# Keel Outpost 2026 — repository notes

Agenda and workshop seat-booking site for a two-day conference. PostgreSQL is
the only backing service. Node.js 22, TypeScript everywhere, no runtime
framework: the HTTP server is `node:http` and the front end is a hand-rolled
single-page application.

## Layout

```
run.json                  install / build / serve manifest
build.mjs                 esbuild: server bundle, browser bundle, stylesheet, assets
assets/                   star-trail photograph and the Inter variable font
src/server/
  config.ts               every tunable read from the environment at start
  index.ts                entry point: dist/server.js
  db/                     pool, schema, idempotent seed, readiness, reads, booking,
                          accounts, contest, idempotency keys
  domain/                 venue time, bio renderer, search parser, calendar, csv,
                          leaderboard, safe-next, folding, passwords
  api/                    route table, v1/v2 shape builders, contract manifests
  http/                   server, error shapes, page shell
src/web/
  main.ts router.ts api.ts session.ts booking.ts live.ts motion.ts
  pages/ components/ styles.css
```

## Where each domain rule lives (one place each)

| Rule | File |
|---|---|
| venue wall clock → UTC instant | `src/server/domain/venueTime.ts` |
| overlap test, promotion, cascade, settling, seat events | `src/server/db/booking.ts` |
| seats left and every count | `seatCounts` in `src/server/db/booking.ts`, `SESSION_COLUMNS` in `src/server/db/reads.ts` |
| refusal order per endpoint | the handler's body in `src/server/api/routes.ts`, after the generic steps in `src/server/http/server.ts` |
| bio rendering (CommonMark subset) | `src/server/domain/bio.ts` |
| search grammar and recovery | `src/server/domain/search.ts` |
| contest state, guessing, reveal | `src/server/db/contest.ts` |
| leaderboard ranking and display name | `src/server/domain/leaderboard.ts` |
| CSV cell neutralisation | `src/server/domain/csv.ts` |
| calendar structure, folding, escaping | `src/server/domain/calendar.ts` |
| safe `next` check | `src/server/domain/safeNext.ts` (server) and `src/web/pages/auth.ts` (page) |
| sign-in throttle | `throttleRetryAfter` in `src/server/db/accounts.ts` |

## Things worth remembering

- **Stored instants are truncated to milliseconds** (`DB_NOW` in
  `src/server/db/sql.ts`). PostgreSQL keeps microseconds, the API reports
  milliseconds; truncating on write keeps roster cursors and `seat_events.at`
  exactly comparable with `holds.held_until`.
- **Hold expiry is never a timer.** Every route in the published settling list
  calls `BookingStore.settleDueSessions()`, which compares `held_until` against
  the database clock under the session's row lock. Stopping every instance past
  `held_until` and starting one again still settles the hold and passes the seat
  on.
- **Lock order is session id.** `BookingStore.locked()` locks the planned set in
  id order, grows the set through a `NeedsLocks` signal when the cascade
  discovers another session, and retries on serialisation conflicts.
- **The seed only plants the starting reservation on the first run** (the
  `firstRun` flag in `src/server/db/seed.ts`). A later start must not bring back
  a seat that was cancelled.
- **The contract digests are computed from the route and object definitions**
  in `src/server/api/manifest.ts` plus `ROUTES`. Changing a key order or adding
  a route changes `GET /api/_contract`, so v1's lists must stay frozen.
- **No v1 body is built from a v2 object.** `src/server/api/shapes.ts` spells
  out each version field by field.
- **The front end calls only `/api/v2` and `/api/health`.** It decides nothing
  about permissions; the server refuses a forbidden call whatever the page drew.
- **Focus after a booking answer** is driven by `data-focus-key` attributes
  (`seat:<id>`, `save:<id>`, `claim:<id>`, `release:<id>`) and the slot wishes in
  `src/web/booking.ts`. Pending buttons get `aria-disabled`, never the native
  disabled state, which would send focus to the page body.
- **Decorative text is drawn by pseudo-elements.** The stagger statement's echo
  copies use `content: attr(data-text)` so they are not text nodes, which keeps
  the contrast rules about real content only.

## Checking it

```sh
npm run typecheck
npm run build
DATABASE_URL=… node dist/server.js
```

`GET /api/health` answers `200 {"status":"ok"}` once the agenda can be read, and
`503 {"status":"starting"}` while PostgreSQL is out of reach.
