# Seam — Maison Neuf puzzle house

Seam is a couture-styled sudoku house: one TypeScript Node server and one
browser client, Postgres for truth, Valkey for live rooms and fan-out, Mailpit
for email, one WebSocket on the app's own port.

## Layout

- `shared/` — the domain engine, used by BOTH the client board and the server
  replay so their answers cannot drift. Never duplicate a rule here.
  - `puzzles.ts` — the 19 published fixtures, exactly as published. No
    generator, no downloads (IF-06).
  - `board.ts` — cell naming (`r<row>c<column>`), peers, boxes.
  - `moves.ts` — move-log parsing (ops, `n`, `t`, `cell`, `digit`).
  - `engine.ts` — the one copy of the move rules, the hint rule and the
    replay checks (`LOG_SEQUENCE`, `LOG_TIME`, `GIVEN_CELL`, `LOCKED_CELL`,
    `HINT_MISMATCH`, `HINT_LIMIT`, `MISTAKE_LIMIT`, `BOARD_UNSOLVED`).
  - `score.ts` — the score formula and the `#timer` format.
  - `daily.ts` — date arithmetic, `daily-k` puzzle ids, month grids, streaks.
  - `ranking.ts` — the leaderboard order with shared ranks (1, 2, 2, 4).
  - `messages.ts` — every published sentence M01–M61, one spelling each.
- `server/` — the Node app. `main.ts` boots `createServerApp(cfg)`, serves
  the built client and `/ws` on `APP_PUBLIC_PORT` (default 4173).
  - `postgres.ts` — source of truth; schema applied idempotently at boot.
  - `valkey.ts` — a small RESP client (publish/subscribe, health).
  - `mail.ts` — SMTP delivery; a token is valid only after Mailpit accepts.
  - `rooms.ts` — the live duel runtime (countdown, moves, reload window, tie
    window, results). Duel timers use real milliseconds, never the grading
    clock.
  - `clock.ts` — the grading clock decides dates, on-day results,
    `finished_at` and token expiry only.
- `client/` — the browser pages: `app.ts` routes, `play.ts` the board, plus
  home, daily, leaderboard, duel, room, profile and the account pages.
- `build.mjs` — esbuild for both bundles; `npm run build` type-checks first.
- `run.json` — the run manifest (IF-01).

## Gotchas learned the hard way

- The dev Valkey URL carries a **username** (`app:...@`), so `AUTH` must send
  `AUTH <user> <pass>`, not `AUTH <pass>`.
- Redis subscribe confirmations carry their count as an **integer** element
  (`:1\r\n`) inside a `*3` array; a RESP parser that only reads bulk strings
  will stall forever on `SUBSCRIBE`.
- Store move logs in the **wire format** (cells as `r1c2` strings), or the
  idempotent-resend comparison sees numeric cells from Postgres JSON.
- Postgres `BIGINT` columns reject fractional milliseconds; round active
  times before storing.
- The health check must answer even while a dependency retries forever in
  the background: wrap the connect attempt in a timeout, never await the
  retry loop directly.
- A connect failure with no pending command must not become an unhandled
  rejection; settle it in `healthy()` and `.catch(() => undefined)` the
  boot-time subscribe.

## Conventions

- Each domain rule is decided in exactly one place (the shared engine).
- Every API error uses the one published shape and code list.
- Names match the brief's terms: game, move, move log, start board, given,
  entry, note, hint, mistake, second chance, daily, streak, duel, room,
  seat, stitch.
- Strictly typed TypeScript; no `any`.
