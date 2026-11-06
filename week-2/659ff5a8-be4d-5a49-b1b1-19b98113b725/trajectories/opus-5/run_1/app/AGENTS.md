# Conecount Paddock — repository notes

Grassroots autocross club workspace (Pylonworks brief). Node 22 + TypeScript, no web
framework, no ORM. Postgres is the system of record; Gotenberg renders PDFs; MinIO stores
them; Mailpit receives mail.

## Layout

```
run.json                    install / build / serve manifest
build.mjs                   tsc (server + client typecheck) then esbuild bundles the client
assets/fonts/*.woff2        self-hosted Chakra Petch, IBM Plex Sans, JetBrains Mono (OFL-1.1)
src/shared/api.ts           response types shared by server and browser
src/server/config.ts        every env var is read here, once, at start
src/server/db/              schema.sql (applied on boot) and the idempotent seed
src/server/domain/          the single place each domain rule is decided
src/server/services/        gotenberg, S3 (hand-rolled SigV4), SMTP, delivery queue, PDF HTML
src/server/http/            router, one error shape, idempotency, request pipeline
src/server/api/             one module per endpoint group, assembled in api/index.ts
src/client/                 vanilla TS screens, one module per route, plus settle.ts
```

## Where each rule lives (one decision, one place)

| Rule | Module |
|---|---|
| event state machine, reported status, window/rota/check-in gates | `server/domain/eventState.ts` |
| adjusted and indexed time formula | `server/domain/indexedTime.ts` (uses `decimal.ts`) |
| positions, row order, rank-change badge text | `server/domain/standings.ts` |
| season points formula | `server/domain/seasonPoints.ts` |
| CSV neutralisation and quoting | `server/domain/csv.ts` |
| club time zone conversion and formatting | `server/domain/clubTime.ts` |
| error shape and precedence | `server/http/errors.ts` + `server/http/app.ts` |
| published UI copy | `client/copy.ts` |

## Conventions

- Times are integer thousandths in the database (`raw_time_ms`, `adjusted_ms`, `indexed_ms`);
  factors are integer ten-thousandths (`factor_tt`). Format only at the edge.
- An event's index table is resolved by date on every read, never stored on the event; runs
  keep the factor used at commit so published history cannot move.
- Run slots are inserted (status `pending`) when a registration is created, so commits are a
  guarded `UPDATE` and races resolve in the database.
- Station claims resolve with `UPDATE ... WHERE worker_registration_id IS NULL` plus a partial
  unique index for "one station per registration per event".
- The browser polls: standings and rota every 1–1.5 s, event/publish screens every 10 s and on
  focus. Open/closed state always comes from the server payload, never the device clock.
- The join screen gets its club name from a `paddock-club-name` meta tag injected into
  `index.html` by the server, because the brief publishes no club-lookup endpoint.

## Local checks

```
npm run build                       # typecheck both projects and bundle
node dist/server/index.js           # serve on APP_PUBLIC_PORT (4173)
curl -s localhost:4173/api/health   # {"status":"ok"}
```

Seeded password for every account is `conecount-2026`; the operator is
`ops@pylonworks.test`, the Ridgeline chair `chair@ridgeline.test`.

To wipe and reseed during development: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`
then restart the server (schema and seed are applied on every boot).
