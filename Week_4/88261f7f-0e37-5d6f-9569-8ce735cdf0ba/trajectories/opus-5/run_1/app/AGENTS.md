# Nightroll — working notes

Tallybell Nightroll: front desk and property management for an owner-operated inn of 10 to 20
rooms. One account per hotel, roles owner / front desk / housekeeper, and an arriving guest with
no account who checks in from an emailed link.

## Running it

| Command | What it does |
| --- | --- |
| `npm ci` | install |
| `npm run build` | `tsc` for the server, esbuild for the browser bundle, copy `src/public` |
| `npm run start` | apply the schema, seed once, listen on `0.0.0.0:$APP_PUBLIC_PORT` (4173) |
| `npm run typecheck` | `tsc --noEmit` |
| `node tools/notices.js` | regenerate `THIRD_PARTY_NOTICES.md` and refuse a disallowed licence |

Services: Postgres (`DATABASE_URL`), Gotenberg (`GOTENBERG_URL`), MinIO (`S3_*`) and Mailpit
(`SMTP_HOST`/`SMTP_PORT`). Every provider is read per call, so the app starts with any of them
unreachable and recovers without a restart. `GET /api/health` answers `200` either way.

## Layout of the source

```
src/shared/    rules both the server and the browser need: money, dates, split shares,
               notice texts, folio names, room statuses, tax percentages, the no-figure dash
src/server/
  config.ts    every credential and address, read from the environment at start
  db.ts        pool, type parsers (dates as text), the idempotent schema
  domain/      one place per rule: clock and business date, nightly pricing, stay states,
               room status moves, report figures, image sniffing and EXIF stripping
  repo/        data access and the assembled API shapes (stays, folios, close, reports, setup)
  http/        router, the one error shape, sessions, page shell and static files
  routes/      one module per group of API routes; policy lives here, rules live in domain/
  services/    MinIO (SigV4 by hand), SMTP (spoken directly), Gotenberg, live stream
src/client/    plain TypeScript, no framework; screens/, dialogs/, closeSweep.ts
src/public/    index.html, app.css, favicon.svg — the only files served from disk
```

## Decisions worth remembering

- **Money** is integer cents everywhere. `divideRoundHalfUp` is the one rounding, used once per
  night, once per tax line and once per report figure.
- **The hotel's clock** is `hotels.clock_now` when the grading route has set it, otherwise real
  time. `nightOf` applies the 04:00 rule. The close opens exactly when
  `nightOf(now) > hotels.business_date`, which gets both daylight-saving dates right without any
  wall-time conversion.
- **Nights** live in `stay_nights`, with `room_cents` fixed when written and only ever repriced
  while `posted` is false. Tax and city tax are computed from the rate in force until the close
  posts them, when the posted amounts are stored alongside.
- **Rooms per night** come from `stay_segments`; a move from a chosen night splits the segment, so
  a stay can show one block per room.
- **Availability** is serialised by `select … from rooms … for update` on every room a create or
  move touches, so two clerks racing for the last room are resolved by server order.
- **Invoice numbers** are taken inside the same transaction that renders the PDF and stores it, so
  a failed render or upload rolls back and consumes no number.
- **Live updates** travel on Postgres `LISTEN/NOTIFY`. `pg_notify` is issued inside the
  transaction, so a change reaches every app instance only once it is committed. Owner and front
  desk get `StaffChange`; a housekeeper gets `HousekeeperChange`, which is an explicit allow-list
  of room, dates and status.
- **Idempotency** reserves the key in its own transaction before the stay is created, and the row
  is released if the create fails. The `New stay` dialog keeps one key until a field changes, so a
  double press replays rather than booking twice.
- **The browser holds one tab stop inside the timeline**: the current cell, or its stay block when
  there is one. Arrow Left from the first night column moves onto the key-rack, where Enter opens
  `Room status`. Dialogs take a `restoreFocus` callback for when a repaint has replaced the opener.
- **Night Close Sweep** plays only after the server's answer, and the end state (`data-stamp`, the
  figures, the new date) comes from the server, so a reload at any moment agrees.

## Checking the work

There is no test suite in the repository. Behaviour was checked with throwaway scripts against a
running copy: the published worked examples (pricing, tax changes, cancellation edges, splits,
report figures, both daylight-saving close instants), the browser journeys under Playwright at
375x812, 768x1024 and 1280x800, and the outage rows by running extra copies with one provider
pointed at a closed port each.
