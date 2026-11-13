# Spurline — repository notes

Spurline is a browser code forge (Coldbrook Signal Works). TypeScript on Node 22,
Postgres as the system of record, MinIO for large objects. No git binary, no shell,
no container, no other service.

## Layout

- `run.json` — install, build and serve commands (schema `run-manifest-v1`).
- `build.mjs` — esbuild: `src/server/main.ts` → `dist/server.js`, `src/client/main.ts`
  → `dist/public/app.js`, plus `app.css`, `index.html` and the bundled woff2 fonts.
- `src/server/` — one module per domain area; routes live in `routes_*.ts` and
  register on the router in `http.ts`.
- `src/client/` — hand-rolled SPA: `main.ts` (shell + router), `views_*.ts` per screen.
- `smoke.mjs` — jsdom harness: `node smoke.mjs <username> <path>` prints the page's
  landmark/role list. Needs a running server and `SPUR_GRADING=1`.

## Server rules worth remembering

- Every domain rule lives in exactly one module: merge check order and approvals in
  `mr.ts`, push rules and protection in `pushrules.ts`, hashes and walks in `repo.ts`,
  diff and three-way merge in `diff.ts`, rollup and graph layout in `pipeline.ts`/
  `ciconfig.ts`, scheduler rounds in `runner.ts`, train cars in `train.ts`.
- All writes go through `tx()` in `live.ts`, which assigns the per-project `seq`,
  stores the live message and broadcasts after commit. `quietTx()` seeds without
  live messages or seq bumps.
- Errors are raised as `ApiError` from `errors.ts`; `http.ts` enforces the published
  precedence (413, 400, 401, 429, 404, 403, 409, 422, 503) and idempotency replay.
- The server clock lives in `clock.ts`. With `SPUR_GRADING=1` it only moves through
  `POST /api/grading/clock`, which also runs `runDeadlines()` in `tasks.ts`.
- `jobs.needs` is nullable on purpose: `null` means the job has no `needs` key,
  `[]` means `needs: []`.
- Never put a `\u0000` byte in jsonb values; Postgres rejects it.

## Routing gotcha

Both routers prefer the candidate with the most literal segments, so
`/api/groups/by_path` wins over `/api/groups/:id`.

## Verifying

- `npm run typecheck`, `npm run build`, then `node dist/server.js`.
- The demo instance seeds itself on an empty database (passwords `spurline-demo-1`).
- Scheduler worked example: create a pipeline, then
  `POST /api/grading/runner/step` and `POST /api/grading/clock`.
