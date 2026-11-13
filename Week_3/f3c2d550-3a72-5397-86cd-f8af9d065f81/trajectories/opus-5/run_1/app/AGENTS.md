# Stowdeck — repository notes

A private reference library for one independent product designer. Node 22, TypeScript
everywhere, no framework. Postgres is the system of record; MinIO holds photographs and
rendered PDFs; Meilisearch indexes references; Gotenberg renders contact sheets.

## Running it

```
npm ci        # install
npm run build # draws the stand-in photographs, then bundles browser + server
npm run start # serves on 0.0.0.0:4173, or APP_PUBLIC_PORT
```

`npm run typecheck` runs `tsc` over the server and the browser projects separately.

Environment: `DATABASE_URL`, `S3_*`, `MEILISEARCH_*`, `GOTENBERG_URL`, and optionally
`STOWDECK_NOW` (freezes the server clock) and `STOWDECK_TRASH_RETENTION_SECONDS`.

## Layout

- `src/shared/` — types, published copy, the seed data and the accepted zone list. Imported
  by both the server and the browser.
- `src/server/domain/` — one module per domain rule. Nothing here touches the database or a
  provider.
- `src/server/db/` — schema, pool, and one module per aggregate.
- `src/server/services/` — hand-rolled clients for the object store (SigV4), the search
  index, the printing service, plus the status checker.
- `src/server/workers/` — sheet rendering, purge sweeps and the search catch-up queue.
- `src/web/` — the browser app: shell, field (tile + fader), dialogs, motion and one module
  per screen.
- `src/build/` — the rasteriser and the object drawings, run at build time.

## Rules that live in exactly one place

| Rule | Module |
| --- | --- |
| Reference and sheet state machines, restore window | `src/server/domain/states.ts` |
| Size conversion and the inch no-drift rule | `src/server/domain/sizes.ts` |
| Photo type, header dimensions, upright pixels, display crop | `src/server/domain/photo.ts` |
| Swatch measurement and the Display P3 conversion | `src/server/domain/swatch.ts` |
| Pull day and next pull | `src/server/domain/pullDay.ts` |
| Local times in a zone | `src/server/domain/zones.ts` |
| Accepted zone list | `src/shared/zoneNames.ts` |
| Effective home zone and pending changes | `src/server/domain/homeZone.ts` |
| Idempotency holds and records | `src/server/db/idempotency.ts` |
| Error shape, codes and precedence | `src/server/domain/errors.ts` |
| Published copy | `src/shared/copy.ts` |

## Things worth remembering

- **The server clock decides everything the API publishes**; `realNowIso()` exists only for
  scheduling background work, because `STOWDECK_NOW` freezes `nowMs()` and a frozen clock
  would otherwise stall the sheet queue.
- **Every single-winner rule is decided by Postgres**: `FOR UPDATE` on the reel row for
  appends, `where version = $n` for reorders and facts edits, `insert … on conflict do
  nothing` for idempotency holds and the Daily Pull pick, and a conditional update for sheet
  retries. No in-process state is involved.
- **Pixel work runs in a worker thread** (`src/server/imageWorker.ts`) so decoding never
  holds up `/api/health`. The pixel limit is read from the file header before any decode.
- **Search writes are recorded in `search_update` inside the same transaction as the data
  change**, then drained in order under an advisory lock. A write waits for its own row to
  be applied, which is what makes a capture findable the moment its 201 arrives.
- **Landing is self-contained**: `src/generated/demo.ts` is written at build time with the
  three demo stops and their swatches, computed with the same swatch module the server uses.
  Landing never calls the API for them.
- **`src/web/field.ts` owns the Fader Pull.** A swap in flight is ended by painting its
  pending target before the next one starts, and every timer checks a token, so no older
  stop can be painted afterwards.
- `reset-dev.mjs` is deliberately absent; to start from scratch, drop the tables and the
  Meilisearch index and restart — the schema and seed are applied on every serve.
