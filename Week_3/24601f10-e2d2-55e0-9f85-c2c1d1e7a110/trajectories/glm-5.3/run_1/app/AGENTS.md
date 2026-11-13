# Cupfold

A bracket desk for local competitions: single elimination, double elimination,
round robin and Swiss. One TypeScript app: a Node server (Postgres + MinIO)
and a browser client, with live updates over its own WebSocket.

## Commands

- `npm ci` — install
- `npm run build` — typecheck + compile server, bundle the client
- `npm run start` — serve on 0.0.0.0:4173 (honours `APP_PUBLIC_PORT`)

`/app/run.json` is the deployment manifest (`run-manifest-v1`).

## Layout

- `src/server/` — the API, live channel, timers and domain rules. Each rule
  lives in exactly one module: bracket shapes in `brackets.ts`, match state
  transitions in `matches.ts`, the dependent set in `shutter.ts`, standings and
  tiebreaks in `standings.ts`, pairing in `formats.ts`, roster parsing in
  `src/shared/roster.ts`, seeding placement in `src/shared/bracket.ts`.
- `src/client/` — the browser app (no framework; a tiny DOM helper in
  `app.ts`). Pages under `src/client/pages/`, dialogs in `dialogs.ts`,
  match-card naming in `matchcard.ts`, Shutter trace motion in `shutter.ts`.
- `src/shared/` — types and rules shared by both sides.
- `test/` — API suites (`api_test*.py`) and browser suites (`browser_test*.mjs`).
  The browser suites import playwright-core from `/tmp/node_modules` in this
  sandbox; they are development aids, not part of the shipped app.

## Notes

- `CUPFOLD_GRADING=1` enables the grading routes in this environment.
- `CUPFOLD_*` timers are read at start; the client reads its values from
  `GET /api/config`.
- The app registers no service worker and loads nothing from other origins.
