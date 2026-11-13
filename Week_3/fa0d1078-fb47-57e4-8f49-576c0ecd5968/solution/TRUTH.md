# TRUTH — Maison Neuf Seam (golden)

Ground truth of the golden app. Every value says where it came from: `brief: <section>` (copied from
`instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys

### 1. Keyboard solve (brief: Journeys 1, Keyboard, Finishing a game)
- Start: signed-in solver on `/play/<id>`, game playing, selection on the first empty cell in reading order.
- Actions: arrow keys move with wrap (ArrowRight on column 9 goes to column 1 of the row, ArrowDown on row 9 to row 1), Home and End go to column 1 or 9; digits enter; `N` toggles notes (`Notes on.`/`Notes off.`); Delete and Backspace erase; Ctrl+Z / Cmd+Z undo; Ctrl+Shift+Z, Ctrl+Y redo; `P` pauses.
- The last correct cell: `Checking your game.` is shown over the board and announced, `POST /api/games/<id>/finish` carries the whole log, the solved sequence plays, `Puzzle solved` opens with focus on `New game`, `Solved in <time>. Score <score>.` is announced.
- End state: game `won`, one result, profile Games won +1 (Postgres `games` row `status = 'won'`).

### 2. Mistakes and the second chance (brief: Mistakes)
- Start: two mistakes. The third wrong digit: `lost`, clock stops, `Game over` (alertdialog) with `You made 3 mistakes.`, focus on `Second chance`, announcer `Game over. 3 mistakes.`; Escape does nothing.
- `Second chance` removes that digit, restores the notes it struck, sets mistakes to 2, closes the dialog, focus on that cell, announces `Second chance. Mistakes 2 of 3.`; undo and redo histories are cleared.
- The next wrong digit: `Game over` with `You made 3 mistakes. Your second chance is used.` and only `New game`, focused. After a reload the profile lists the game as `Lost` (closed because its second chance is used).

### 3. Hints (brief: Hints)
- `H` or `Hint`: the empty or wrong cell with the fewest candidates (givens, hinted cells and correct entries of its row, column and box are excluded), ties to the lowest row then column; the cell gets its solution digit, locks, loses notes, the digit leaves its peers' notes, the selection moves there; `Hint: row r, column c is d. Hints left n.` is announced. `medium-1` gives r4c3=3, r6c2=4, r5c3=5. With none left `Hint` is disabled and `H` announces `No hints left.`

### 4. Phone play (brief: Screens and layout, Interactions)
- 390 px wide: board = viewport minus 32 px, then timer, mistakes and hints on one line, the six controls (3x2), the number pad (3x3), all targets at least 44 px; no sideways scroll from 320 to 1440.

### 5. Daily and streak (brief: Daily challenge)
- Today is the server clock's date in `DAILY_TZ` (Pacific/Auckland). The calendar is one Tab stop, today focused on open. A finish received on the date is `solved`; after midnight it is `late` and streak 0. Worked example: 2026-11-01 and 2026-11-02 solved, finish at 23:58 on 3 November gives `Current streak: 3 days`; at 00:01 on 4 November the date is `late` and the streak 0 until 4 November is solved.

### 6. Live leaderboard (brief: Leaderboard)
- Two verified regulars with `/leaderboard` open (one WebSocket each, subscribed to the date). A verified on-day finish updates `seam:leaderboard:<date>` (a sorted set of player ids) and publishes on Valkey; every open page for that date replaces its rows and announces `<Name> finished at rank <rank>.` within 2 seconds. An unverified player appears only after opening the confirmation message (their board key is dropped and rebuilt from Postgres on the next read).

### 7. Duel (brief: Duels)
- Create room at a level (`Level` radio, Easy default) -> `/duel/<CODE>`; the other player joins by code (any case, spaces and hyphens ignored). Both press `Ready`; the server sends `countdown` (3, 2, 1 at 0, 1000, 2000 ms) and `start` at `DUEL_COUNTDOWN_MS`; both boards show at once with fixture 3 of the level. Each side sees the other's name, progress bar, mistakes and thread, never digits. A reload returns the board from the server's move log; leaving past `DUEL_REJOIN_MS` forfeits. The server decides win, loss, tie, out and forfeit once, in `server/duel-result.ts`.

### 8. Verified results (brief: Finishing a game, Profile)
- A finish whose log was changed in transit is refused (422 with the first failing code in the published order), `Not counted` opens with `This game could not be verified (<CODE>). It was not counted.`, nothing is counted. The honest finish counts once; a resend returns the stored result; a different log gets 409 `ALREADY_FINISHED`. The profile numbers are derived from the stored games at read time.

## Palette (roles with hex; brief: Visual design; hex decided inside the judged ranges)

| Role | Hex | Source |
|---|---|---|
| ground (carmine) | #B3122D (hsl 350 82% 39%) | brief: deep saturated carmine; decided: hex |
| ground-deep (darker carmine) | #8C0E24 | brief: secondary surfaces slightly darker carmine |
| ink | #FFFFFF | brief: ink is white |
| muted (pale pink) | #FFD6DC | brief: muted text pale pink |
| accent (blush) | #FFE1E5, type on it carmine #B3122D | brief: accent very pale blush pink |
| Medium specimen tile | #F4B6C2 | brief: Medium pale pink; decided: hex |
| charcoal | #1C1618 (lightness 9.8%) | brief: near-black charcoal |
| charcoal-raised (cells) | #2A2124 | decided: one step lighter so cells read as panels |
| wrong tint | #FFC2CB at 34% | brief: pale pink tint plus a diagonal stitch mark |

## Type (brief: Type)
Gloock (400, high-contrast serif) for the wordmark, headings, level names, board numerals (given digits declared 700, entered 400) and the maison-voice sentences; Rethink Sans (variable 400-800) for body, labels, notes and the clock (`font-variant-numeric: tabular-nums`). Scale 1.25: 1rem, 1.25, 1.5625, 1.953, 2.441, 3.052; the wordmark is 5.96rem (4.2rem under 768). Both fonts are self-hosted woff2 (latin subset) under SIL OFL 1.1.

## Space and layout per viewport
- Gutter 24 px, 16 px under 768; plinth padding 20 px (12 px under 768); tiles radius 20; buttons square; 8 px spacing unit (decided: couture-calm).
- 375 / 390: Home stacks wordmark, name list, specimen tile, fact line, links; Play board = viewport minus 32 (the plinth, with 12px padding, is the viewport minus 8 px and the thread rings sit inside that padding); controls and pad under the board in the published order.
- 512-767: board 480 px, plinth centred. 768: Play side by side (board left, 260 px column right); Home still stacked. 1024+: Home list and tile share a row (list left, tile right, fact line under the tile) (brief: at 1280 they share a row; at 768 they stack).
- 1280: Daily calendar tile with the streak lines in a column to its right (stacked under 768).

## Motion (brief: Motion and effects; all `element.animate`, none in CSS)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| new stitch inside `#hem` / `#hem-opponent` | correct entry, hint, redo; opponent `progress` (24 ms apart when several arrive) | 240 ms | cubic-bezier(0.2, 0.9, 0.3, 1) | none: stitch appears at once |
| undone stitch | undo | 240 ms reversed | same | none |
| `#hem-count` | stitch count changes | 320 ms | same | text changes at once |
| every cell of `#board` | a 200 finish | 300 ms, delay (row + column - 2) x 40 ms, scale 1 -> 1.08 -> 1 | ease-in-out | skipped; `data-celebrating` never true |
| plinth and loop `.hem-loop` | same | 940 ms | ease-out / linear | skipped |
| buttons | press | 0 (instant `filter`) | n/a | n/a |

There are no CSS transitions or keyframe animations; nothing moves unless the player or a live event caused it.

## States per async action
- Sign-up / sign-in / reset / create or join: button `aria-disabled="true"`, a second press sends nothing, pending sentence announced (`Creating your account.`, `Signing you in.`, `Sending the reset link.`, `Opening the room.`); 422 shows each message under its field and in the `Check these details` alert; other failures show M56 or M61 under the form and announce them.
- Move save: after every move the whole log is sent; a failure shows and announces M21 and the next move or resume sends the whole log again.
- Finish: `Checking your game.`; 200 solved sequence then `Puzzle solved`; 4xx `Not counted` (M20); other failures M56 under the board.
- New game (from a dialog): `aria-disabled` while the request is in flight; a failure announces M56 and re-enables the button.
- Page waiting for its first data: `The atelier is preparing your page.`; records out of reach: M61.

## Breakpoints (brief: Browser support)
767 uses the phone layout, 768 the side-by-side Play layout. 320 to 1440 never scrolls sideways (tables scroll inside their tile).

## Decided where the brief is silent
- A leaver who returns after a forfeit sees `<Name> wins.` in the Duel over dialog (no published sentence covers it).
- `Game` JSON carries one extra boolean `closed` (a lost game is closed once its second chance is used or a newer game at its level was started), so a reopened closed lost game shows only `New game`.
- The `result.seconds` for win/loss is the finisher's whole seconds from the start; tie, out and forfeit carry null.
- Duel timers (countdown, tie window, reload window) are process-local timers; all room state, presence, move logs, ranking and join records live in Valkey.
- An abandoned game opens as the not-found page (M25).
- Pausing and resuming are logged moves; the stop at game over is not.

## Media and licences
No images, audio, video or models. The specimen, thread, month arrows and wordmark are inline SVG/HTML drawn in code (`original`). Fonts: Gloock and Rethink Sans, SIL OFL 1.1, Fontsource files listed in `app/assets.json` with their sha256. Production packages: MIT, ISC, Apache-2.0 (see `app/THIRD_PARTY_NOTICES.md`).
