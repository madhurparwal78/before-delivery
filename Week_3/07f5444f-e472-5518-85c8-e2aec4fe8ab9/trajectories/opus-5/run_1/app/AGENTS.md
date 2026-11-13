# Quirewell Stand Desk — repository notes

The working desk of a regional orchestra's music library: programmes, works, string counts,
cuts, marks, scans, folders and rental sets. Node 22, TypeScript everywhere, Postgres for
state, MinIO for scans, SMTP (Mailpit) for mail.

## Layout

- `server/` — HTTP server and domain.
  - `domain/` — one module per rule: `copies`, `running-time`, `marking`, `publish`,
    `seating`, `rental-dates`, `transitions`, `text` (single-line), `scan-file-names`,
    `sections`.
  - `data/` — aggregate loaders (`programmes`, `rentals`, `folders`).
  - `view/` — builders that turn aggregates into the API shapes.
  - `http/` — boundary, router (`api.ts`), errors, sessions, multipart, static files.
  - `routes/` — one module per resource group.
  - `services/` — `storage` (S3 SigV4 by hand), `smtp`/`mail`, `notices`, `reminders`,
    `idempotency`.
  - `db/` — pool, idempotent schema, seed.
- `client/` — React app (`src/screens/*`), built by Vite into `dist/client`.
- `shared/` — types and the London wall-clock helpers used by both sides.

## Conventions

- Server source imports use `.js` specifiers (Node ESM). Vite resolves them back to `.ts`
  through the small plugin in `vite.config.ts`.
- Every API error goes through `server/http/errors.ts` and the single order in
  `handleApiRequest`: boundary, 401, 404, 403, idempotent replay, 409, 422.
- Concurrency is enforced in Postgres: an exclusion constraint for one cut per bar, a
  primary key for one mark per part and cut, row locks for publish, rental returns,
  check-in counts and rental-set creation, and `idempotency_records` for replays.
- Times are instants in the database; responses are ISO 8601 with London's offset.
  `shared/london.ts` is the only place that converts wall-clock times.
- The client never derives a status from the device clock; it renders what the server sends.

## Running it

- `npm ci`, `npm run build`, `npm run start` (the commands in `/app/run.json`).
- Configuration comes from the environment: `DATABASE_URL`, `S3_*`, `SMTP_HOST`,
  `SMTP_PORT`, `MAIL_FROM`, `APP_PUBLIC_PORT`, `REMINDER_SWEEP_SECONDS`.
- The schema is applied and an empty database is seeded on every start, under an advisory
  lock, so several copies can share a database.
- Seeded passcode for every person: `stand-desk-26` (for example
  `rowan@quirewell.test` principal librarian, `priya@quirewell.test` assistant,
  `vn1-01@players.quirewell.test` Violin I section principal,
  `vn2-05@players.quirewell.test` player).

## Things worth remembering

- Copies needed: `ceil(section count / 2)` plus one spare from eight players; every
  non-string part needs one copy.
- Running times are derived from the bar map on every read and rounded once; the
  programme total rounds the sum of exact work milliseconds.
- Scan uploads write the object, read it back and check size and checksum before the
  catalogue row is created, so a catalogue row never points at a missing object.
- `npm run notices` rewrites `THIRD_PARTY_NOTICES.md` from the production dependency tree.
