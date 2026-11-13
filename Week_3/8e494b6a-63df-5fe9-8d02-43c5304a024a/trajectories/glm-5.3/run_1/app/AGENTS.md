# Spoorline

Spoorline is a log search and observability console: a TypeScript web app (Node server +
browser client) using Postgres (events, the app's own term index, all product state) and
MinIO (uploaded files byte for byte, archived generation segments). Everything the product
uses is published with a worked example; the brief's rules A-N are in the source.

## Repository layout

- `run.json` — install/build/serve manifest (`npm ci`, `npm run build`, `npm start`).
- `src/shared/` — environment-neutral domain code: `analyze.ts` (the three analyzers, rule D),
  `query.ts` (Spoor Query parser, rule F), `pipe.ts` (Spoor Pipe parser, rule I),
  `histogram.ts` (interval choice, bucket edges and labels, rule G), `tz.ts` (zones),
  `util.ts` (rounding half away from zero, flatten, type inference).
- `src/server/` — the API: `main.ts` (boot, static boundary, the SPA shell),
  `router-patch.ts` (Express 4 promise safety), `errors.ts` (the one error shape and order),
  `search.ts` (matching and scoring, rule E), `lifecycle.ts` (rule J), `alerts.ts` (rules K/L),
  `traces.ts` / `objectives.ts` (rule M), `context.ts` (session/key auth, roles, rate windows),
  `grading.ts` (grading routes, only with SPOOR_GRADING=1).
- `src/front/` — the browser client, no framework: `core.ts` is a small signal/effect core
  with fine-grained DOM updates (focus and caret survive re-renders), `explore.ts` is the
  Explore page (query bar suggestions, Bucket Brush, virtual grid, document panel).
- `assets/fonts/` — Inter and JetBrains Mono woff2 files; licences in `licences/`.
- `THIRD_PARTY_NOTICES.md` — every shipped package with its licence (IF-02, IF-03).

## Working on this code

- Both tsconfigs are strict; `npx tsc -p tsconfig.server.json --noEmit` and
  `npx tsc -p tsconfig.front.json` must pass. The full build is `npm run build`.
- Postgres reads BIGINT columns as strings; convert with `Number(...)` after any read
  (`lifecycle.ts` policyOf, `objectives.ts` rows) or arithmetic silently concatenates.
- Express 4 does not catch rejected promises from handlers; every route goes through
  `router-patch.ts`, which routes failures into the one error ordering point.
- The seeded grading `rates` section replaces rate settings for the whole running server
  until the next seed with `rates`, so browser tests after a journey run hit 429s; restart
  the server (or re-seed rates) between suites.
- Tests used during development live outside the repo (`/tmp/journeys.js` for the API and
  grading journeys, `/tmp/browser-tests.js` for browser interactions); they need a running
  server and Playwright chromium.

## Key published invariants (checked)

- Analyzer worked example: "The servers failed, retrying 2 connections" gives
  server 1 4-11 / fail 2 12-18 / retry 3 20-28 / 2 4 29-30 / connection 5 31-42.
- Scoring worked example: e2 `gateway` 1.2199 + `timeout` 1.7428 = 2.9627, e1 2.7726.
- DST: 2026-03-08 in America/New_York is 46 buckets at 30m with 01:30 -05:00 then
  03:00 -04:00; 2026-11-01 is 50 buckets with 01:30 -04:00 then 01:00 -05:00.
- Trace worked example: checkout 0-240 with auth 20-60, pay 50-150, render 150-220 has
  self time 40 and the critical path checkout, render, pay.
- Objective worked example: target 99.5, 2000 bad of 1000000 → budget remaining 60.00%,
  long burn 4.00, short burn 6.00, status OK.
