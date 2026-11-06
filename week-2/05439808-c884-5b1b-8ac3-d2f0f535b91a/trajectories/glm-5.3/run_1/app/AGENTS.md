# Saltreach — repo notes for agents

Saltreach is a browser village-builder on tidal salt-flat islands. The server is the sole source
of truth; the browser sends intents only. Two backing services: PostgreSQL (`DATABASE_URL`) and
Mailpit (`SMTP_HOST:SMTP_PORT`). See the brief for the full requirement list.

## Layout

- `src/domain/` — shared domain: `catalog.ts` (buildings, units, costs, leagues, caps),
  `clock.ts` (`SALTREACH_CLOCK_START` virtual clock), `localtime.ts` (local-day/week boundaries
  with missing- and repeated-midnight handling), `types.ts`.
- `src/sim/battle.ts` — the battle rules, shared by the server's raid resolution and the
  browser's replay (imported by both; DP-82). Pure integers: positions in thousandths of a cell.
- `src/server/` — Node HTTP server (no framework): `http.ts` (router + request boundary +
  error precedence), `runtime.ts` (env, pool, db-up flag), `island.ts` (island core: completed
  jobs, caps, saltmark, builders, housing, producer accrual, starter island), `api_*.ts`
  (route modules registered through `route()`), `schema.ts` (DDL + seed), `mail.ts` (SMTP
  queue sender), `errors.ts` (the one error shape).
- `src/client/` — TypeScript browser app bundled by esbuild: `main.ts` (router),
  `shell.ts` (top rule, nav, Queues rail, panels), `screens/` (auth, village, raid, replay,
  panels, ops), `island/` (scene + WebGL renderer + flat fallback), `dial.ts` (Wake dial
  physics), `ui.ts` (live regions, field errors, copy), `api.ts`, `state.ts` (poller, session
  state, clock skew).
- `tools/` — dev scripts: `smoke.mjs` (API checks), `short-timers.mjs` (short-timer copy),
  `clock-copies.mjs` (the five clock copies), `browser.mjs` / `responsive.mjs` /
  `extra-browser.mjs` (Playwright journeys), `reset-db.mjs` (wipe the dev database),
  `checks.mjs` (sim + zone unit checks), `fonts.mjs` (font bundling, run once).
- `assets/fonts/` — OFL woff2 files, bundled by `build.mjs` into `dist/public`.

## Commands

- `npm ci` — install from the lock file. `npm run build` — typecheck (strict) + esbuild server
  and client into `dist/`. `npm run start` — serve on `APP_PUBLIC_PORT` (default 4173).
- Dev loop: `node tools/reset-db.mjs` wipes the dev database (the server re-seeds within 5s via
  its boot loop; restarting is cleaner). `node tools/smoke.mjs` runs the API suite against
  127.0.0.1:4173.

## Conventions that matter

- Every error response is built by `errors.ts`; never compose an error body in a handler.
- The precedence order in `http.ts` follows the brief's numbered list (body limits → database
  503 → 401 → CSRF → ops forbidden → not_in_clan → 404 → forbidden/verified → idempotency →
  422 → conflicts). The snapshot endpoint's tick validation is the one documented exception.
- Village-serialised operations run inside one transaction that takes the islands' row locks
  in id order (`lockVillages`); completed jobs and finished batches are applied before any
  read or change of an island (`applyCompleted`), and expired raids are abandoned first
  (`abandonExpiredRaids`).
- Balances and army counts are the sum of ledger rows; every movement is a pair of two rows
  with opposite amounts (`ledger.ts`).
- Never serve or send environment values, stack traces or SQL to the browser.
