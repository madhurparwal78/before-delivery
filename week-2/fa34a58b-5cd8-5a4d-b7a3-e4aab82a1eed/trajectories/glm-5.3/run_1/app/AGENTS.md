# Gablework Nightplan — agent notes

Self-hosted home hub for one household: room-first plan page with a 24-hour scrubber,
lighting/climate scenes on a daily timetable, simulated devices, on-prem clip storage
and plain household notices. PostgreSQL + MinIO + Mailpit (SMTP) only.

## Layout

- `run.json` — run manifest (`npm ci`, `npm run build`, `node dist/server.js`, port 4173 / `APP_PUBLIC_PORT`).
- `src/domain/time.ts` — the single place for household time (America/Chicago): offsets,
  day boundaries, DST transitions, slot occurrence across daylight-saving changes, wall-time
  parsing. Every server and browser copy of a time fact flows through here.
- `src/server/` — Express app, ws socket, tick engine, PostgreSQL schema/seed, MinIO + SMTP
  clients, notice outbox.
- `src/client/` — React client: plan page (floor plan, scrubber, sweep), schedules, scenes,
  guests, day log, notices; shared `sheet.tsx` (focus trap, 320ms slide, close-cancel).
- `public/` is the built client; `dist/server.js` the built server.

## Domain rules decided in one place each

- Slot occurrence and DST: `wallToInstant` / `occurrencesForDay` (fall-back repeated hour runs
  at its first pass; spring-forward skipped hour resolves to 03:00).
- Room owner at an instant: `ownerOf` / `ownersAll` (guest scene first, then latest slot
  occurrence looking back seven days).
- Guest scene transitions: `guestTransition` + `guestsDue` in the tick engine; the server ends
  a guest scene at its end instant with no browser open.
- Schedule revision check and version write: one transaction in `PUT /api/schedules/:id`.
- Clip confirmation: MinIO PUT then HEAD; stored only when HEAD size equals the declared size,
  otherwise the object is deleted and the clip is `size_mismatch` forever.
- Schedule-change notice timing: `queueScheduleNotices` (tick window) and
  `queueScheduleNoticeForSave` (save already past the 05:00 effect instant).
- Notice delivery: outbox rows claimed with `FOR UPDATE SKIP LOCKED`; `sent` only after SMTP
  accepts.

## Environment

`DATABASE_URL`, `S3_*`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `APP_PUBLIC_PORT`. The dev
services are reachable as `postgres`, `minio`, `mailpit` hosts. The hub clock can be moved via
`PUT /api/sim/clock` (moves last until restart). Seeded household: Alder Lane house,
America/Chicago, nine rooms, six scenes, weekday/weekend schedules from 2026-01-01.

## Gotchas learned here

- `pg` runs one statement per `query()`; split multi-statement schema strings. `DROP INDEX IF
  NOT EXISTS` is not valid SQL (only `CREATE INDEX IF NOT EXISTS` is).
- `app.use('/prefix', fn)` strips the prefix from `req.path`, and `app.use` does not match
  route params — match clip-byte paths with a regex on `req.path` at root level.
- In `ws` no-server mode, `handleUpgrade`'s callback is the wiring point; the `connection`
  event is never emitted. Only a *foreign* Origin may be refused — non-browser clients send
  none.
- jsonb does not preserve key order: canonicalise bodies before comparing idempotent replays.
- DST instants: spring forward at 02:00 CST (08:00Z), fall back at 02:00 CDT (07:00Z).
- nodemailer ≥ 6.9.3 is MIT-0; 6.9.2 is the newest MIT-licensed release (IF-03 allows MIT).
