# TRUTH: Gambit Hall (golden ground truth)

The golden is a FastAPI + Jinja server-rendered app (`app/main.py`, `app/pages.py`, `app/api_core.py`,
`app/api_games.py`) on PostgreSQL through psycopg, with the app's own rules of chess (`app/rules.py`, wrapped by `app/chesscore.py`;
decided: the common Python chess library is GPL-3.0, which the licence policy rejects),
vanilla ES modules in `app/static/js/` and a vendored three.js for the deep board (`static/js/deep.js`).
It starts from `run.json` (install into `.venv` from a fully pinned `requirements.txt`, then
`exec .venv/bin/python run.py`: uvicorn on `0.0.0.0:$APP_PUBLIC_PORT`). Every value
below is marked `brief: <section>` (fixed by `instruction.md`) or `decided: <why>` (the golden's choice
inside the room the brief leaves).

## Ideal flow of every journey

1. **Play a rated game** (brief: Journeys 1). Sign in at `/login` as `tobin_reyes` / `gambit-demo-pw-2026`
   through `Username`, `Password`, `Sign in` → `/hall`. Open `/challenges`; the seeded rated challenge from
   `mira_kade` is the top row (newest first, decided: `ORDER BY created_at DESC`) with `Accept` and
   `Decline`. `Accept` posts `/api/challenges/{id}/accept` with an `Idempotency-Key` and lands on
   `/game/<id>`, board in the first response. Clicking two squares (flat board, deep board or the
   `Square list`) posts `{move}` in coordinate form; the piece travels for 300 ms (decided), the live region
   reads `Pawn to e4`, the move list grows. `Deep board` switches the pane without a request to the move
   endpoint; the camera sits on the viewer's side (brief: Frontend, The board item 1). `Square list`:
   arrow keys move a roving tabindex, Enter selects then plays, Escape cancels (brief: item 2).
2. **Finish and be rated** (brief: Journeys 2; Business rules, Ratings). On mate the end screen opens
   (`You won` with the king rising 900 ms and sparks, or `You lost` with the king toppling 900 ms to 72 degrees
   and resting there, decided). Both ratings move by `K * (score - expectation)` from the pre-game ratings,
   K 40 / 20 / 10 by band, rounded half away from zero, floored at 100 (brief).
3. **Play the house** (brief: Journeys 3). `/play` → `Play the house` → `Sharp` creates an unrated house game;
   the house's reply is computed in the same request, deterministically from position and level (decided:
   ordered search with fixed tie-breaks, mate-in-one and undefended-queen checks first at `sharp`).
4. **Dress the board** (brief: Journeys 4). `/settings` groups `Piece set`, `Board theme`, `Sound`; each
   change is a `PATCH /api/profile`; the next render, in any browser, reads the account row.
5. **Talk at the side of the board** (brief: Journeys 5). `Message` + `Send` posts the chat; it appears last
   with the sender's 28 px avatar and current username. `wren_oyelaran` sees the board and the line
   "You are watching this game." instead of the chat; the chat endpoints answer 403.
6. **Collide** (brief: Journeys 6). Two posts for one ply: the unique `(game_id, ply)` constraint lets one
   insert land (201) and the other fails (409, "The position has moved on."); the loser's page refreshes to
   the stored position.
7. **Void a game** (brief: Journeys 7). `/admin/games` lists finished rated games; `Void` posts
   `/api/admin/games/{id}/void`, which replays every later rated game of both players in order and writes
   `rating_audit` rows (admin, game, member, before, after).
8. **Watch it arrive** (brief: Journeys 8). The game page polls every 2.5 s and the rail's unread count every
   4 s (decided: polling, inside the 5 s window); the challenges page polls its list.

**Square list placement** (decided: the brief wants the 64 squares present in both views, not
instead of them). In `Flat board` the 64 named buttons lie transparently over the flat squares, so
clicking the board is pressing them; in `Deep board` they sit as a compact grid under the canvas; in
`Square list` they are the board itself, square cells with the piece drawn in the current set.

**Authentication** (brief: API, "Bearer auth is required on every `/api/` endpoint"). The API reads
only `Authorization: Bearer`; the page server reads the `gh_session` cookie to render; the browser
sends the bearer from `localStorage gh_token` on every API call.

**Leaving and returning** (brief: Journeys). Every page is rendered from the store on each request; the
browser holds nothing but the bearer token (`localStorage gh_token`) and the session cookie.

## Palette (decided, inside the brief's families: Frontend, Visual design)

| Role | Value | Brief family |
|---|---|---|
| ground | `#1c1613` | deep warm neutral, dark coffee |
| raised surface | `#151010`, `#241d18`, `#2c241e` | deeper warm neutral |
| border | `#4a3f36` | mid warm neutral |
| text / secondary / quiet | `#f5f1ea` at 1, 0.75, 0.5 | near-white neutral, three quarters, half |
| accent / deeper / pressed | `#4fa14f` / `#3a7e3a` / `#255a2a` | mid grass green to deep forest green |
| loss and refusal | `#ec5e43` (decided: 5.3:1 on the ground; `#e04a33` was 4.4:1) | vivid warm red |
| caution | `#f7d154` | light vivid amber |
| warning | `#e8822f` | mid vivid orange |
| link | `#4fb0e0` | clear mid cyan-blue |
| bronze accent | `#d9a066` | light soft orange |
| lightest step | `#faf7f2` | near-white neutral |

Board themes (decided; brief: each pair at least 3:1 apart, labels at least 4.5:1):

| Theme | Light | Dark |
|---|---|---|
| `Walnut` | `#f0e0cb` | `#5a3a22` |
| `Slate` | `#eceef0` | `#5f646b` |
| `Ocean` | `#e8eef3` | `#1f4a6b` |
| `Forest` | `#ecf0e5` | `#26442a` |
| `Neon` | `#eeeaf6` | `#3a1f63` |

Coordinate labels: deep warm neutral on the light square, near-white on the dark (brief). Overlays:
selected square half-transparent yellow, legal destination half-transparent teal ring, last move tint,
check red inset with a 900 ms pulse (brief: Visual design; durations decided).

## Type (decided; brief: Visual design)

- Headings: `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif`, bold.
- Interface: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`, 14 px body.
- Square names, FEN, record: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Radii: 3 / 6 / 10 / 16 px and a 999 px pill; avatars are circles.
- No font files are shipped (brief: Browser support and performance).

## Layout per viewport

| Viewport | Layout |
|---|---|
| desktop (1440x900, 1280x800) | fixed 232 px left rail; board column centred with the view switch above, player strips above and below, the 64-button square list under the board; right column with status, moves, chat and controls. Board and turn marker sit inside the first screenful (brief: Frontend, Screens and layout). |
| below 1180 px (decided) | the right column moves under the board. |
| below 860 px (decided) | the rail collapses behind `Open the menu`; the side column becomes the `Moves` / `Chat` / `Game` tabs under a full-width board. |
| below 560 px (decided) | tighter paddings; nothing scrolls sideways at 320, 360, 390 and 414 (brief). |

The board is square at every width (aspect-ratio 1). The move list and the record scroll in their own frames.

## Motion table

| Motion | Golden | Basis |
|---|---|---|
| piece travel (flat, WAAPI) | 300 ms | brief band 150 to 1200 ms; value decided |
| capture fade-and-grow | 320 ms | brief band; decided |
| promotion grow-and-settle | 420 ms | brief band; decided |
| victory king rise + sparks | 900 ms, sparks up to 1200 ms | brief band; decided |
| defeat king topple to rest | 900 ms, rests at 72 degrees | brief band; decided |
| draw kings level + screen fade | 700 ms | brief band; decided |
| deep move travel (three.js, knight arcs) | 320 ms on `performance.now()` + rAF | brief: Motion and effects item 2; decided |
| dialog grow-in | 280 ms | decided |
| hint fade-in | 260 ms | decided |
| check pulse | 900 ms, endless | decided; removed under reduced motion |
| colour / border / panel transitions | 140 / 200 / 300 ms | brief: a seventh, a fifth, three tenths of a second |

Reduced motion (brief): every duration becomes 1 ms or none, the check pulse stops, and the end screens
render complete at once.

## States

- Empty: `No challenges yet.` (with "Challenge a member below."), `Nothing new.`, `No moves yet.`,
  `No messages yet. Say hello.`, `No finished games yet.` (brief: Feedback states; extra wording decided).
- In flight: `Sending your move…` as a banner over the board's top edge, out of the layout flow; the
  move request is sent at once and the piece travels while the server answers (brief).
- Errors: each form has a `role="alert"` field error beside the control (brief: Accessibility).
- Not found: `That game is not here.` inside the rail chrome with a link back to `/hall`, status 404 (brief).
- Finished game: the end screen (`You won` / `You lost` / `Drawn` + reason) and `Rematch`.

## Breakpoints

`max-width: 1180px`, `max-width: 860px`, `max-width: 560px` (decided: three breakpoints, brief: Screens and
layout), plus `prefers-reduced-motion: reduce`.

## Server truths (brief: Backend)

- Seed (idempotent, keyed on usernames and slugs): six members with the pinned ratings and counts, `open-hall`
  public and `quiet-room` private with `nadia_serrano` banned, the four games, the pending challenge from
  `mira_kade` to `tobin_reyes`, the block of `jules_amari` by `nadia_serrano`, two chat lines per in-progress
  member game.
- Env: `LOGIN_MAX_FAILS=5`, `LOCKOUT_SEC=900`, `CHAT_RATE_LIMIT=5`, `FIRST_MOVE_ABORT_SEC=3600`,
  `MOVE_DEADLINE_SEC=259200` (source task.toml; the app refuses to start without them).
- Aborts and deadlines are settled when the game is read (no worker).
- Chat rate (decided: "a player" is a role inside one game): at most `CHAT_RATE_LIMIT` messages per
  player per game chat in any 10 s, counted under the game's row lock.
- Banned club members are not club members for visibility: a banned member reading a private club's
  game gets the missing-game 404 (brief: Clubs 2–3).
- `Decline` (brief: a received challenge offers `Accept` and `Decline`; the API table is the whole HTTP
  surface and lists no decline operation) is the member's own dismissal: the challenge is hidden on that
  browser and stays open on the server; no request is sent.
- Request bodies are type-checked at the boundary (`text_field`, `bool_field`): a wrong JSON type or a
  NUL character is `422`/`400` before any lookup; an unexpected fault still answers one JSON `500`
  and one stdout line carrying `error`.
- `request_id` is minted by the server for every request; a caller's own header is ignored.
- Square accessible names: `e2, White Pawn` (decided wording inside the brief's "algebraic name extended
  with its occupant").

## Rejected routes

- En passant target written after every double step: two positions read alike and repetition counts lie.
- Repetition keyed on placement alone: a castling-rights change counts as a repeat.
- Loser's change computed from the winner's new rating: the pair stops being symmetric.
- Check-then-insert for a move: two racing moves both land.
- Void that only subtracts its own change: later games keep stale ratings.
- Private club game answered with 403: the refusal confirms the game exists.

## Judged-criteria mapping

| Criterion | Requirement | Golden evidence |
|---|---|---|
| B1 knight muzzle and ears | DP-14 | `app/static/js/deep.js:31-42` horse-head profile (snout forward, two ear points) extruded at `deep.js:67-78` |
| B2 click piece then destination | DP-18 | `deep.js:301-331` raycast pick → legal-move markers → `game.js` move post |
| B3 rook battlements, king cross, queen crown | DP-14 | `deep.js:58-66` six battlements, `deep.js:85-93` eight crown points, `deep.js:94-97` cross |
| B4 drag turns the board | DP-19 | deep.js orbit on pointer drag around the board centre |
| B5 last move tinted | DP-18 | deep.js last-move square overlays |
| B6 phone layout, column under the board | DP-16 | `app.css` `max-width: 860px` rules, rail toggle |
| B7 first screenful at 1440x900 | DP-16 | `app.css` board column sizing, turn dot in player strips |
| B8 chat line with picture and name | DP-41 | `templates/game.html` chat rows, `game.js` chat refresh |
| B9 six silhouettes from one screenshot | DP-14 | deep.js one geometry per piece type |
| B10 Marble / Wood / Glass finishes | DP-12 | deep.js material presets per deep set |
| B11 wheel zoom brings the board nearer | DP-19 | deep.js wheel and pinch dolly with clamps |
| B12 knight destinations marked | DP-18 | deep.js destination discs on selection |
