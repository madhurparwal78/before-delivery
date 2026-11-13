# Nachtwit Gevelwerk — working notes

A site survey and throw layout workspace for projection artists. Node.js with
strict TypeScript, Postgres for every record, MinIO for photos, tiles, sheet PDFs
and mask bundles, Gotenberg for the rig sheet press, WireMock as the rental house
(Kaaiverhuur).

## Running it

```
npm ci && npm run build && npm run serve      # binds 0.0.0.0:4173, honours APP_PUBLIC_PORT
npx tsc --noEmit                              # typecheck
```

Every address and credential comes from the environment: `DATABASE_URL`,
`S3_*`, `GOTENBERG_URL`, `WIREMOCK_URL`. Only `TECH_LINK_SECONDS`,
`READING_STALE_SECONDS` and `MASK_STEP_MILLISECONDS` have defaults.

Several serve processes share one database; nothing depends on a single
process's memory. Schema and seed apply under an advisory lock on each boot.

## Where each rule lives (one place each)

| Rule | File |
| --- | --- |
| Entered number grammar | `src/server/domain/numbers.ts` |
| Exact decimal arithmetic, half-even rounding | `src/server/domain/decimal.ts` |
| Half-even rounding of doubles (4 decimals, whole) | `src/server/domain/round.ts` |
| Unit conversion and canonical lux | `src/server/domain/units.ts` |
| Cell names, centres, half-metre grid | `src/server/domain/cells.ts` |
| Brussels wall-clock, DST gap and fold | `src/server/domain/brussels.ts` |
| Models, capacities, bands, derating | `src/server/domain/catalogue.ts` |
| Illuminance, blend share, contrast, pixels per metre | `src/server/domain/photometrics.ts` |
| Quote cents | `src/server/domain/quotes.ts` |
| Problem codes, statuses and copy | `src/server/http/problem.ts` |
| Field error copy | `src/server/http/fields.ts` |
| Error precedence, body limits, idempotency | `src/server/http/server.ts`, `idempotency.ts` |
| Kit ledger, locations, free counts | `src/server/data/kit.ts` |
| Hold state machine, lapse sweep, desk reconciliation (`claimDue`, `commitFenced`) | `src/server/data/holds.ts` |
| Layout writes, entity tags, overlap limit | `src/server/data/layouts.ts` |
| Layout hash | `src/server/domain/layouthash.ts` |
| Issue, bindings, links, rate limit, ticks | `src/server/data/sheets.ts` |
| Mask steps, claims, bundle bytes | `src/server/data/maskjobs.ts` |
| Transactional outbox and dense sequences | `src/server/events/outbox.ts` |

The browser renders server fields and holds no copy of a server rule; only
presentation (euro text, mm:ss, canvas drawing) lives in `src/client`.

## Things worth remembering

- **Sequences**: `events.sequence` is handed out by a dispatcher under
  `pg_advisory_xact_lock`, so it is dense and never lands behind a delivered
  event. Streams poll every 250 ms and survive a lost database session.
- **Claims**: holds and mask jobs are claimed with `FOR UPDATE SKIP LOCKED`,
  a lease and a `fence` column; late writes from a stopped process are refused
  by re-reading the fence inside the committing transaction.
- **Issue**: `issue_attempts` plus a `serial_bindings` primary key on the serial
  give exactly one winner. The sheet row is written only after the PDF comes back
  and its stored object's size and checksum are read back. A running attempt
  beats a heartbeat; one that stops beating for 12 s is swept.
- **Idempotency**: stored outcomes keep the serialised response bytes, so a
  replay is byte-identical. A 5xx is never stored. The key's lease is 15 s and
  renewed while the action runs, so a stopped process's key frees itself.
- **Desk calls** use `node:http` (the fetch standard blocks port 9, so a refused
  connection would never read as refused). A confirm is marked pending before the
  desk is called, so a process that stops mid-call leaves it to be replayed.
- **Determinism**: mask PNGs are hand-encoded (`media/png.ts`) and the bundle is
  a store-only ZIP with a fixed 1980 entry time (`media/zip.ts`).
- **Photos**: type and size come from the bytes (`media/image.ts`); the original
  is stored untouched and the upright copy is derived for every pixel coordinate.
- **Layout `sheetId`** is returned beside `sheetStatus` so the workspace can link
  to `/sheets/<sheetId>`; nothing else was added to the published shapes.

## Checking it by hand

```
curl -s localhost:4173/api/health
curl -s localhost:4173/api/sites | python3 -m json.tool | head
curl -s localhost:4173/api/layouts/zuiderhal-launch/cells | head -c 400
```

The seed site is `zuiderhal` with layout `zuiderhal-launch`; both ids are fixed.
