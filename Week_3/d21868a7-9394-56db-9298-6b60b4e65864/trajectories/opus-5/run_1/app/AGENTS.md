# Ditchbook — repository notes

Ditchbook is the water-ordering and headgate desk for the Wirrinbah Water
Trust: one TypeScript web app with its own API, backed by Postgres, a MinIO
evidence store and a Mailpit mail service.

## Running it

- `npm ci --include=dev`, then `npm run build`, then `npm run start`
  (the commands in `/app/run.json`).
- The server binds `0.0.0.0:4173`, or `APP_PUBLIC_PORT` when set, and applies
  the schema and the seed district on every start. Applying them again changes
  nothing.
- `GET /api/health` answers `{"status":"ok"}` once the schema and seed are in
  place, whether or not the store and mail service answer.
- Every service address and credential comes from the environment:
  `DATABASE_URL`, `S3_*`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- Seeded people all use the password `channel-season-26`.

## Layout

- `src/domain/` — the one place each domain rule is decided: `decimal.ts`
  (exact ML arithmetic in bigint thousandths), `time.ts` (district zone,
  window label with the repeated-hour mark, window status, instant format),
  `conversion.ts` (cap volume, turnout max volume, order rate), `ration.ts`
  (proportional shares), `orders.ts` (statuses and legal moves),
  `succession.ts`, `period.ts` (district-date periods), `routes.ts` (page
  routes per role and the return-path check), `packDocument.ts`, `errors.ts`.
- `src/server/` — `index.ts` (http server, static assets, page shell),
  `api.ts` (every endpoint), `service/` (guarded steps: orders, ration,
  restrictions, cards, capacity, packs, contractors, lapse), `records.ts`
  (serialisers), `reads.ts`, `notices.ts`, `store.ts` (hand-rolled SigV4),
  `mail.ts` (hand-rolled SMTP), `worker.ts` (retries).
- `src/client/` — vanilla TypeScript screens under `screens/`, with
  `dom.ts`, `dialog.ts`, `dwell.ts`, `table.ts`, `copy.ts` (published copy),
  `search.ts`, `counters.ts`.

## Rules worth remembering

- Every ML figure is a bigint count of thousandths; never floating point.
  Format once through `formatMl`.
- Placements, schedules, rations and restriction publishes all take the window
  row first (`for update`), then the allocation rows in grower-id order. Keep
  that order to avoid deadlocks.
- `applyDueLapses()` runs before every API request except `/api/health`, so a
  window's close is judged before any answer.
- The browser never computes a window status from the device clock: it shows
  the `status`, `orderable` and `window_status` the server returns, and polls
  every 2 seconds for live updates.
- Live repaints must never destroy a control a person is using. Screens repaint
  a block only when its figures change (`renderWhenChanged`), insert new gate
  cards in place, and keep dialogs in a separate host so typed values survive.
- Cobalt is reserved for the next irreversible action (the dwell control, Place
  order, Publish, Ration, Save table, Restore, Sign and submit pack, Erase for
  good). Links and other controls are ink.

## Checking it

There are no committed tests. During development the app was checked with
throwaway scripts in `/tmp`: API journeys with `fetch`, browser journeys with
Playwright at 375x812, 768x1024 and 1280x800, and an outage run that starts the
server against dead store and mail ports and then proxies them back up to prove
stalled work finishes by itself.
