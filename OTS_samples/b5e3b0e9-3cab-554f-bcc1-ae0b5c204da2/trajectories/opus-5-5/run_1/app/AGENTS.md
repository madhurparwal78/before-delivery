# Runup Bay – repository notes

Aerodrome control training exercise. TypeScript on Node 22: one server (`server/`), one
Preact client (`client/`), shared types (`shared/`). Built with esbuild (`build.mjs`) after
`tsc --noEmit`; `npm run start` serves `dist/server.js` on `APP_PUBLIC_PORT` (4173).

## Layout
- `server/sim/` is the only place sim rules live: `grammar.ts` (command parser, refusal
  checks 4-6), `engine.ts` (tick order, commands, moves, events, versioning via strip
  signatures), `rules.ts` (R1-R4/R8 alerts, wake remaining), `routes.ts` (taxi routing with
  VIA fit and crossings), `view.ts` (strip copies, timers, pre-filled clearances sent to the
  browser), `score.ts` (debrief). The browser holds no rule or timer tables.
- `server/live.ts`: in-memory `LiveSession` per session, every operation serialised through
  `run()`, then persisted (state JSON + per-second snapshot in `session_seconds`) and pushed
  over the WebSocket. Holds seats, grace timers, hold-updates queues, wall-clock ticker.
- `server/routes/grading.ts`: grading setup/clock/hold routes (`X-Grading-Key`).
- Own small clients: SMTP (`mail.ts`), S3 SigV4 (`storage.ts`), PDF writer (`pdf.ts`),
  JSON-with-line-numbers parser for layout import (`layouts.ts`).
- Client session UI: `client/pages/session.tsx` + `client/session/*` (board, command line,
  Centreline Run hook, console controls). Motion markers (`data-motion`, `data-outline`) are
  set/cleared with `setTimeout`; Preact effects are forced off requestAnimationFrame in
  `client/main.tsx` so pushed updates render with a paused browser clock.

## Testing
- `npm test` runs engine tests (worked examples from the brief) via esbuild + node:test.
- Services in dev: Postgres `postgres`, MinIO `minio:9000`, Mailpit `mailpit:8025` (env vars
  already set). `ps`/`pkill` are missing; find server pids via `/proc/*/cmdline`.
- Browser checks: Playwright + axe installed under `/tmp/pw` (not part of the app).
