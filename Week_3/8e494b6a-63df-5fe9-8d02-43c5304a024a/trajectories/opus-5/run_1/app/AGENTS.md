# Spoorline — repository notes

Log search and observability console. One TypeScript app: a Node 22 server plus a browser
client, backed by Postgres and MinIO only.

## Shape of the repository

- `run.json` — the run manifest (`install`, `build`, `serve`, `_schema`). Those three
  commands alone install, build and serve the app.
- `src/server/` — the API, the term index and every domain rule.
  - `env.ts` settings from the environment, `clock.ts` the server clock (frozen under
    `SPOOR_GRADING=1`), `errors.ts` the one error shape, `http.ts` the router and the one
    ordering point for errors, `db.ts` schema and pool, `storage.ts` a small S3 SigV4
    client, `live.ts` server-sent events and the per-space `seq`, `store.ts` events,
    mappings and the term index, `ingest.ts` bulk and file upload, `seed.ts` the start seed.
  - `src/server/domain/` — one place per rule: `analyze.ts` (analyzers), `mapping.ts`
    (types and conflicts), `query.ts` (Spoor Query), `search.ts` (matching, scoring,
    highlights), `histogram.ts` (interval and bucket edges), `tz.ts` (zones and display
    time), `pipeline.ts` (processors), `pipe.ts` (Spoor Pipe), `lifecycle.ts` (rollover and
    phases), `alerts.ts` (checks, flapping, maintenance), `cases.ts`, `trace.ts`,
    `objectives.ts`, `suggest.ts`, `numbers.ts` (rounding).
  - `src/server/routes/` — endpoint declarations only; each route declares its auth, role,
    key action, rate limit, body kind and resource lookup, and `http.ts` applies the
    published error order to all of them.
- `src/client/` — a vanilla TypeScript app: `main.ts` (shell, router), `state.ts` (API,
  live messages, `data-pending`), `dom.ts`, `widgets.ts` (dialogs, trees, empty bands),
  `animate.ts` (Web Animations with published ids), `pages/`.
- `assets/` — `index.html`, `styles.css`, bundled fonts. Copied to `dist/public` at build.

## Working rules learned here

- The server clock is the only clock. Under grading it starts at `2026-03-01T00:00:00Z`
  and moves only through `POST /api/grading/clock`, so anything that compares "now" must
  read `nowMs()`.
- Errors leave through `ApiError` and `sendError` only, and the order
  (413/415, 401, 429, 404/410, 403, 409, 422) is applied in `http.ts`. A route that works
  on a resource declares a `resource` lookup so an unknown resource answers 404 before any
  403.
- Archived generations are read back from MinIO on every search; nothing caches segments,
  because a storage outage must give partial results rather than stale ones.
- `new_events` for a snapshot compares against the frozen id list, not a timestamp, since
  the grading clock can stand still.
- Phrases keep their stopword slots (`slots` on the phrase node), so `"full on node"`
  matches `disk full on node-7` while `"full node"` does not.

## Checking the app

```
npm ci && npm run build && npm run start      # serves on APP_PUBLIC_PORT (4173)
curl -s localhost:4173/api/health             # {"status":"ok"}
```

Worked examples that must keep holding: the analyzer table (rule D), the BM25 example
(rule E), the 23-hour and 25-hour histogram days (rule G), the alert check table (rule K),
the lifecycle example (rule J), the trace example and the objective example (rule M).
