# Kinfold

A shared care board for one ageing parent, shared between an organising adult
child, their siblings, a paid home aide and a helpful neighbour.

## Architecture

- **Front end** (`src/client/`) — TypeScript, no framework. `main.ts` owns the
  routing, live stream and render loop; `views.ts` draws screens; `dialogs.ts`
  draws dialogs; `state.ts` is the single owner of board state; `copy.ts`
  holds every published sentence.
- **Server** (`src/server/`) — Fastify, two worker processes behind one shared
  listening socket (`scripts/serve.mjs`). `rules.ts` decides each domain rule
  in exactly one place; `store.ts` is the data access layer;
  `worker-runtime.ts` owns the live stream registry and per-recipient event
  shaping; `storage-service.ts` and `relay-service.ts` are the MinIO and
  Valkey seams.
- **Data** — PostgreSQL is the system of record, MinIO stores attachments,
  Valkey relays board events between the two workers.

## Commands

- `npm run build` — type-checks, compiles the server and bundles the client
  into `server-dist/` and `public/`.
- `npm run serve` — starts two workers on `APP_PUBLIC_PORT` (default 4173).
- `npx tsc -p tsconfig.json --noEmit` — type-check only.

## Service configuration

Read from the environment at start: `DATABASE_URL`, `S3_ENDPOINT`,
`S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `VALKEY_URL`, `APP_PUBLIC_PORT`. Never hard-code these.

## Notes for future work

- The seed runs only when the database has no workspaces; it is guarded by a
  Postgres advisory lock so two workers can boot together.
- Concurrent same-version card writes use `SELECT ... FOR UPDATE` inside a
  transaction; exactly one wins (DP-29/DP-53).
- The redis client needs `reconnectStrategy: false` plus a bounded
  `withTimeout` wrapper, otherwise an unreachable Valkey hangs boot forever.
- `pg_advisory_lock` is session-level: the client that takes it must release it.
- The `rank` column must be nullable because archiving sets it to null.
- All copy strings are published verbatim in `src/client/copy.ts`; every
  change there must match the product brief character for character.
