# Lintel Drive — repository notes

Company file drive for Lintelworks. Three services only: PostgreSQL (system of record),
MinIO (file bytes), PocketBase (people directory and sign-in).

## Layout

- `src/shared` — types and copy shared by the server and the browser. Every piece of
  user-facing copy lives in `src/shared/copy.ts`; the server builds its pushed notices from
  the same functions.
- `src/server` — Node HTTP server, no framework.
  - `http/` — the request pipeline: body limits and content types, origin check, session,
    routing, the single error shape (`http/errors.ts`) and the check order (`http/api.ts`).
  - `domain/` — one module per domain rule. `clock.ts` owns company time, `access.ts` owns
    effective access and hidden-folder naming, `moves.ts` owns the move winner, `uploads.ts`
    owns the upload state machine, `bin.ts` owns binning and purging, `grants.ts`,
    `handovers.ts` and `policies.ts` own their own rules.
  - `services/` — MinIO (hand-rolled SigV4 in `sigv4.ts`), PocketBase and the health probes.
  - `sweep.ts` — the expiry sweep: grant ends, purges, handover lapses, upload expiry.
  - `seed/` — the seed, with procedural PDF and PNG generators.
- `src/client` — React, built by Vite into `dist/client`.
  - `lib/` — API client, address state, the global store, the event socket, the homing
    flight and the upload manager.
  - `components/`, `screens/`, `Workspace.tsx` — the three-pane frame and its screens.

## Things worth remembering

- The server clock is real time plus an offset. `PUT /api/clock` works only when
  `LINTEL_CLOCK_CONTROL=on`, and runs the sweep before replying.
- America/Phoenix is a fixed UTC-7 zone, so dates are handled by shifting instants rather
  than by a time-zone library.
- `directory_cache` mirrors the people the drive knows about. The directory stays the system
  of record; the mirror exists so sessions, access checks and grant changes keep working
  while PocketBase is unreachable.
- Idempotency responses are stored in a `json` column, not `jsonb`, so a replay returns the
  stored bytes unchanged.
- The server publishes live events inside the request that causes them, so a client can
  receive the event before its own HTTP response. `Workspace.tsx` notes the moves it issued
  before sending them, so it never plays the homing flight twice.
- Preview responses carry `Content-Security-Policy: sandbox` as the brief requires. Chromium
  refuses to run its PDF viewer in a fully sandboxed document, so PDF previews fall back to
  the file name inside `<object>`. Images preview normally.

## Local loop

```bash
npm run build
LINTEL_CLOCK_CONTROL=on node dist/server/index.js
```

`GET /api/health` answers `ok` as soon as PostgreSQL does, even while MinIO or PocketBase is
unreachable. Seeding retries on a timer until the services it needs answer.
