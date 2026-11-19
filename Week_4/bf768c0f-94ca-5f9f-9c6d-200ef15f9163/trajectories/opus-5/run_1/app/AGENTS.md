# Gambit Hall Club — working notes

A turn-based chess club: Node 22 + Express serving server-rendered pages, its
own `/api`, and its own media, all on one origin, with PostgreSQL as the only
store. No build step, no bundler, no third-party browser script.

## Layout

| Path | What lives there |
|---|---|
| `src/chess.js` | The rules of chess: FEN, legal moves, SAN, repetition, claims, terminal states. The only authority on legality. |
| `src/ratings.js` | The rating arithmetic: step factors, expectation, rounding half away from zero, the 100 floor, the `?` display. |
| `src/record.js` | The text record: seven tags in order, SAN movetext, import by line, the pinned opening table. |
| `src/house.js` | The house opponent. A pure function of `(fen, level)`, so one position always answers the same. |
| `src/db.js` | The pool, the schema and the transaction helper. Eleven tables. |
| `src/seed.js` | The idempotent seed; every row carries an id derived from a stable key. |
| `src/games.js` | Game reads and writes: the game object, move submission, finishing, deadlines. |
| `src/api/*.js` | The HTTP surface under `/api`. |
| `src/pages.js`, `src/views/*` | The sixteen rendered routes and the chrome. |
| `public/js/*` | The browser: the board, the three views, the WebGL deep board, the six animations, the six synthesised sounds. |
| `test/*` | `node --test "test/*.test.js"` for the pure modules; `verify-api*.mjs` and `verify-browser*.mjs` against a running app. |

## Things learned the hard way

- **This image has no `pkill`, `ps` or `killall`.** `scripts/restart.sh` finds
  the server by walking `/proc/*/cmdline`. A stale server silently serving old
  code wasted a long debugging session once.
- **`timestamptz` loses precision through JavaScript.** `pg` hands back a
  `Date` (milliseconds) while Postgres stores microseconds, so a keyset
  comparison built from a `Date` re-includes its own boundary row. Read the
  boundary back inside SQL (the void replay) or carry it as `to_char(...US)`
  text (the chat and member-game cursors).
- **`[hidden]` loses to any rule that sets `display`.** The promotion dialog
  kept swallowing clicks until `[hidden] { display: none !important; }` was
  added.
- **Playwright's `waitForFunction` needs `unsafe-eval`,** which the app's own
  content security policy refuses. The checks poll `page.evaluate` instead.
- **`half` is a reserved word in GLSL ES**, and a lathe's winding cannot be
  trusted for normals; the deep shader lights two-sided instead.
- The browser's default framebuffer is not preserved, so `readPixels` after a
  frame returns zeros. Screenshot the canvas and read the pixels with `sharp`.

## Decisions worth remembering

- A game id is a string. A game created by accepting a challenge derives its id
  from the challenge id, so a replayed accept lands on the same row by primary
  key, whatever the `Idempotency-Key` does.
- A move is single-winner three ways over: a row lock on the game, a unique
  constraint on `(game_id, ply)`, and the caller's own `fen` compared with the
  stored one before anything is written.
- A game with one side `null` is a house game; a game with both sides equal is
  a study game whose creator moves for both colours. Neither is visible to
  anybody else, and neither is rated.
- `games` carries four extra columns (`white_rating_before`,
  `black_rating_before`, and the two counts) because voiding has to rescore
  later games from the numbers the players actually held.
- The seeded challenge from `mira_kade` is `colour: 'Black'`, so accepting it
  makes `tobin_reyes` White and journey one can play a move at once.
- Live updates are polling (3s on a game, 4s on the bell): it needs no second
  mechanism and keeps the published HTTP surface intact.

## Checking it

```sh
./scripts/restart.sh                 # rebuild nothing, restart the server
node --test "test/*.test.js"         # the pure modules
node scripts/reset.mjs               # empty every table and re-seed
node test/verify-api.mjs             # parts one to three need a running app
node test/verify-api2.mjs
node test/verify-api3.mjs            # run straight after a reset
node test/verify-browser.mjs         # needs Playwright in /opt/verify
node test/verify-browser2.mjs
python3 scripts/contrast.py          # the theme and text contrast ratios
```

`scripts/reset.mjs` leaves the club exactly as the brief describes it; run it
after any local checking so the seed is pristine.
