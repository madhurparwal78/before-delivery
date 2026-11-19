# Gambit Hall — repository notes

A turn-based chess club. Node 22 + PostgreSQL (`pg`), zero framework: the server
renders pages in `ssr/`, serves a bundled client built by esbuild, and keeps
every rule of chess server-side.

## Layout
- `lib/chess.mjs` — the rules of chess: legality, exact position records (the en
  passant field names a square only when the capture is available), repetition,
  insufficient material. Single source of truth; the browser never decides legality.
- `lib/san.mjs` — SAN with pin-aware disambiguation, live-region announcements,
  the pinned openings table.
- `lib/rating.mjs` — Elo arithmetic (step factor 40/20/10, half away from zero,
  floor 100) and each member's pre-first-stored-game baseline.
- `lib/house.mjs` — the deterministic house opponent (mate in one and hanging
  queen at `sharp`).
- `lib/record.mjs` — the seven-tag record, export and replayed import.
- `lib/db.mjs` — the eleven pinned tables plus an `avatars` media table, and two
  columns the exact contracts need: `games.fen_start`, `challenges.game_id`.
- `lib/games.mjs` — game shape, visibility, claims, ratings replay, abort/deadline.
- `server/` — router with `X-Request-Id` and one structured stdout line per request.
- `ssr/` — server-rendered pages; the game page carries its 64 squares in the
  first response.
- `public/src/` — the client: flat board + keyboard board (`app.js`), the WebGL2
  deep board (`deep.mjs`), four flat piece sets (`pieces-2d.mjs`).

## Things that bit us (keep in mind)
- pg returns `count(*)` as text: compare with `Number(...)`, never `=== 0`.
- An in-page `fetch('/api/auth/login')` for another member replaces the browser
  cookie mid-test; fetch other members' tokens outside the page.
- The game API's `turn` is `white`/`black`, never `w`/`b`.
- Playwright cannot be started through `%1` job control across shell invocations;
  kill servers by PID from `/proc`.

## Commands
- `node scripts/build.mjs` — build the production bundle and the vendored media.
- `node scripts/reset.mjs` — drop, migrate, seed once (idempotent, run at start-up too).
- Tests: `node tests/chess.test.mjs`, `tests/api.test.mjs`, `tests/rules.test.mjs`,
  `tests/browser.test.mjs`, `tests/collision.mjs`, `tests/final-checks.mjs`.
- All seeded members use the password in `USER_README.md`.
