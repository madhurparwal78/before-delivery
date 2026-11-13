# TRUTH — Overlap golden

The ground truth of the built app. Every value says where it came from: `brief: <section>` (copied
from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys

1. **Solve by keyboard** (brief: Journeys 1; Interactions). Start: a host with a display name opens `/games/<id>` of Morning Kettle on a laptop; the grid takes focus and the starting clue is 1 Across with its first empty square. Keys: letters write and advance by the auto-advance rule, Space/Enter and cross arrows switch direction, Tab and Shift+Tab step clues, Backspace and Delete clear. End: every touched square shows its letter and name (`<number> <Across|Down>, letter <i> of <length>, <content>`), the cell ops are in Postgres (`ops`, `squares`), and a reload restores the letters with the starting-clue rule (never the old selection). Provider: Postgres only.
2. **Invite a friend** (brief: Journeys 2; Share dialog; Joining). Host opens Share, copies `<origin>/g/<code>`; the friend opens it on a phone, chooses a display name (`POST /api/players`, cookie `overlap_player`), joins with the next free colour (`POST /api/links/<code>/join`) and lands in the room. Both type into one word; each sees the other's letters and coloured cursor block within two seconds; the host hears `<name> joined` in `status "Grid announcements"`.
3. **Check, reveal, pencil, rebus** (brief: Journeys 3). Check menu by Alt+C; wrong squares get a slash on both screens; Reveal writes and locks; `.` toggles pencil (muted grey); Insert opens `textbox "Rebus entry"` (up to 8 of A-Z 0-9), Enter commits one entry. All stored and broadcast, kept after reload.
4. **Leave and come back** (brief: Journeys 4; Presence and timer). Last live connection closes; after `OVERLAP_PRESENCE_GRACE_MS` the server pauses the game and the open timer segment ends at the moment the last connection closed (grace not counted). A new live connection starts a new segment; every screen shows the server's `elapsed_ms` plus page-timer time since it arrived.
5. **Finish** (brief: Journeys 5; Solve). The write that makes every square match its answer sets the game `solved` once, closes the timer segment, stores per-player stats, adds one history entry per player and queues the solve record. Every room shows `dialog "Puzzle solved"` (heading `Solved in <time>`, focused), the timer freezes, later writes are 409 `game_solved`. Provider: MinIO `records/<game id>.json` written once.
6. **Upload** (brief: Journeys 6; Uploads). Size check (413), validation (422 with `lines`), the exact bytes to `uploads/<puzzle id>/original.overlap.txt` (`text/plain; charset=utf-8`), read back, parse the stored bytes, insert. Dialog shows the line-numbered errors (heading focused), then `Puzzle ready: <title>` with a preview and `Start a room with this puzzle`.
7. **Turn off a link** (brief: Journeys 7; Link states). `POST /api/games/<id>/link/off|replace` (host only): the active code becomes `off` or `replaced`, every other player loses access and gets `link_off` then close 4410; their room shows the ink band `This game link was turned off.` or `This game link was replaced. Ask the host for the new one.`; the old code answers 410 for ever.
8. **Storage goes down** (brief: Journeys 8; Services). Health `{"status":"unavailable"}`, uploads and downloads 503 `storage_unavailable`, no puzzle created; the dialog keeps the text and focus on Upload, band `Puzzle storage is unreachable right now. Your text is still here; try again in a moment.`. A game solved during the outage is solved in Postgres at once, history shows `record_ready:false` / `Solve record pending`, the record write retries every 5 seconds and on every storage request until one succeeds, exactly once.
9. **Race** (brief: Journeys 9; Race games). Race game from the board's Race button; every player starts on no team; Team radios until the host starts; each team has its own grid; a right check of one square claims it in both grids and scores one point; the last claim finishes the race (`dialog "Race over"`).
10. **Build a puzzle** (brief: Journeys 10; Builder rules). `/build`: 5x5 start, symmetry toggles with partners, live numbering by the shared numbering rule, one clue field per word, ordered problem list, Download text and Save to my puzzles send the same text.

## Palette (decided: hexes; brief: Visual design for the roles)

ground #ece9e3, surface #dcd8d0 (7 lightness points under the ground), paper #f7f5f0, ink #1b1a17, muted #5c564b,
brass #b09b2a (exactly one element per screen), focus ring 3px ink. Players: Teal #1a7070, Coral #b8452f, Violet #7a4fb0,
Moss #4f7022, Cobalt #2f5db3, Rose #b53a70, Rust #a5532b, Slate #566b80 (brief: palette in join order; hexes decided so ink or paper letters keep 4.5:1).

## Type (brief: Visual design)

Albert Sans 400, 500, 600, 700 from `/fonts/*.woff2`; steps 16, 21, 28, 37 (each about a third larger); home name weight 500 with letter-spacing -0.06em;
`font-variant-numeric: tabular-nums` for times and counts.

## Space and layout per viewport (brief: Screens and layout)

12-column board, 8px gaps and margins, rows about 90px, corners square, no borders or shadows. Phone below 768, tablet 768-1199, desk from 1200.
Room desk: room bar; then a row with the clue bar (6 wide) above the grid tile (6x8) on the left, the Across tile (3x8) in the middle and the Down tile (3x8) on the right, tops aligned; then a foot row with the player tiles and the tools tile (brief: Screens and layout).
Decided: the tools tile is 6 wide on the right of the foot and starts one row early, under the Across and Down tiles beside the grid tile's last row, so the board has no empty cell (brief: Visual design, "No board ever has an empty cell"); the player tiles (3x2 each, two per row) sit on the left of the foot below the grid tile.
Tablet: bar, clue bar, grid full width, Across and Down side by side, race tile, players, tools. Phone: bar, clue bar with Previous clue and Next clue, grid, Letter keyboard, tools, race tile, players; the clue lists stay in the page but are hidden.
A race room adds a race tile (6x2 on desk and tablet, full width on a phone) directly above the player tiles (brief: Screens and layout); on desk it sits on the left of the foot beside the tools tile.

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Pivot band | direction switch | shrink 90ms then grow 140ms (`data-pivot` shrink, grow, idle) | cubic-bezier(0.2,0,0,1) | attributes in one frame, `data-pivot` stays idle |
| Clue scroll | active clue changes | 200ms until the clue's top is a third down the list | ease-out cubic | one-frame jump |
| Solved/Race over dialog | solved or race end | 200ms rise and settle | cubic-bezier(0.2,0,0,1) | none |

## States per async action (brief: Feedback states)

Upload: pending `Checking your puzzle`, success `Puzzle ready: <title>`, 422 heading `This puzzle has n problem(s).` + `list "Upload errors"`, 413 heading `This file is larger than <limit> bytes.`, 503 ink band alert. Share: `Link copied`, `Link turned off`, `New link ready`. Join: dead link ink band, `Game is full.`, `This puzzle is already solved.`, unknown game tile. Board: loading tiles, `No puzzles match these filters.`. History: `No finished games yet.`, `Solve record pending`, outage band. Builder: `Ready to save`, `<n> problem(s)`, `Saved: <title>`, outage band. Live: `Connection lost. Reconnecting.`.

## Breakpoints (brief: Screens and layout)

767/768 (phone to tablet) and 1199/1200 (tablet to desk).

## Media and licences

Albert Sans woff2 (OFL-1.1, Fontsource 5.3.0, in `app/assets.json`); home dither pictures drawn at load on canvas (original, no file); icons inline SVG drawn for the product. No other media.
