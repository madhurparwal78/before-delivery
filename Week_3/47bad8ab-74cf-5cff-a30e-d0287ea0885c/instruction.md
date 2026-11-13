# Bellwhistle Puzzle Co. Overlap

Overlap is a web app for friends who solve a crossword together from different places. One person opens a puzzle from the Overlap library, or uploads one written in the Overlap text format, and shares a single link. Everyone who opens the link solves the same grid at the same time. Each player has their own colour, sees every letter and cursor live, and keeps a shared solve time that the server owns. The app is one TypeScript web app: a Node server and a browser client. It uses Postgres as the system of record. It uses MinIO object storage for two things: the exact bytes of every uploaded puzzle file, and one solve record file for every finished game. Friends can also race as two teams on one puzzle, and constructors can build a grid in the browser. Out of scope: accounts, email, passwords and outside sign-in (players are guests with a display name), any other datastore, queue, cache or search engine, any outside realtime service, other puzzle formats (.puz, .ipuz, .jpz, JSON), clue help, sound, paid plans, ads, offline downloads, public contests and rankings, chat, service workers, and anything loaded from another host.

## Problem and users

Friends who used to pass one newspaper crossword around a kitchen table now live in different cities, and the tools they use to solve together keep letting them down. The big word-game apps match you with strangers, allow one play per puzzle per account, charge for hints, and keep check marks private. Free shared-grid sites take an upload and a link, but their grids fight the keyboard: a rebus square holds one letter, the timer keeps running after everyone has gone to bed, and a finished solve is gone once the tab closes. People fall back on a video call where one person types and reads the clues aloud. Hobby constructors email spreadsheet grids that their friends cannot play. The solvers pay for all of this: evenings lost to setup, solve times nobody trusts, no record of the puzzles they finished together, and puzzles that never get solved.

- **Host solver** (daily): opens a puzzle from the board or an upload, solves it entirely by keyboard, shares one link, and keeps an honest solve time and history.
- **Invited friend** (weekly): joins from the link on a phone or laptop, sees everyone's cursor colour and letters live, and later downloads and replays the finished game's solve record from their own history.
- **Hobby constructor** (occasional): uploads a puzzle written in the Overlap text format, rebus squares included, sees exactly which line is wrong when it fails, and sends friends a playable link.

## Journeys

1. **Solve by keyboard.** Start: a host solver with a display name opens a game of Morning Kettle on a laptop. They type across words, flip direction with Space and the arrow keys, step from clue to clue with Tab, and delete with Backspace, all without touching the mouse. End: every square they touched shows its letter and spoken name, and the letters are still there after a reload.
2. **Invite a friend and solve together.** Start: the host has a game open. They open Share, copy the link and send it. The friend opens it on a phone, chooses a display name, and joins with the next free colour. Both type into the same word. End: each sees the other's letters and coloured cursor block appear in place within two seconds, and the host, who was already in the room, hears "<name> joined" in their status region.
3. **Check, reveal, pencil and rebus.** Start: two players are in a game of Night Shift. The host opens the Check menu by keyboard and checks a word. Wrong squares get a slash on both screens. They reveal one square, pencil in a guess, and enter STAR as a rebus. End: the marks, the pencil grey and the rebus survive a reload for both players.
4. **Leave and come back.** Start: two players are solving with the timer running. Both close their tabs. After the grace period the server pauses the timer at the moment the last one left. One returns the next day. End: the timer resumes from the paused value and shows the same time on every device.
5. **Finish the puzzle.** Start: a game is one square from solved. A friend types the last letter. End: every player sees the Puzzle solved dialog with "Solved in <time>", the timer stops for good, the grid becomes read-only, and each participant gets one history entry whose solve record downloads and replays.
6. **Upload a puzzle.** Start: a hobby constructor on the board opens Upload a puzzle and pastes a file with three mistakes. They read the line-numbered errors, fix the text and upload again. End: a preview shows the computed numbering, the exact bytes they submitted are kept and can be downloaded again, and a room on the puzzle opens with one click.
7. **Turn off a link.** Start: a game link has been shared around too widely. The host turns it off. End: anyone holding the old link, including a friend who has the game open, sees the published sentence and can do nothing more. Replacing the link gives a new one that works.
8. **Storage goes down.** Start: object storage is unreachable. The hobby constructor uploads. End: the dialog shows the outage sentence and keeps their text, and no puzzle is created. When storage is back, the next try succeeds and the sentence clears.
9. **Race as two teams.** Start: friends open one race game of Morning Kettle. One joins Team 1, one joins Team 2, and the host starts the race. Each team fills its own copy of the grid and claims squares by checking them. End: every claimed square shows in both teams' grids in the claimer's colour, the live scores agree on every screen, and when the last square is claimed everyone sees who won.
10. **Build a puzzle in the browser.** Start: a hobby constructor opens the puzzle builder. They pick a size, place black squares with symmetry, type the answers and write the clues while the builder lists every problem. End: the downloaded text is a valid Overlap text file, and Save to my puzzles stores exactly that text as their own upload.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Puzzle grid semantics** The room shows grid "Puzzle grid" whose squares are gridcells with the exact accessible names and data hooks defined in Public screens and controls.
- **DP-02 — Letter entry and auto-advance** A letter key writes the upper-case letter and moves the cursor by the auto-advance rule in Interactions.
- **DP-03 — Movement and deletion keys** Arrow keys, Space, Enter, Backspace and Delete behave exactly as the grid keyboard rules in Interactions state, skipping black squares.
- **DP-04 — Keyboard solving journey** A host solver fills words in a seeded 5x5 game using only the keyboard, and every touched square's name and state are exact, before and after a reload.
- **DP-05 — Tab between clues** Tab and Shift+Tab move between clues in the published clue order with wrap-around and never take focus out of the grid.
- **DP-06 — Clue lists and clue bar** The Across and Down clue lists mark the active and crossing clues, and the clue bar shows the active clue in the published format.
- **DP-07 — Desk and tablet room boards** At 1280x800 and 768x1024 the room arranges the grid, clue tiles and player tiles in the published order and columns, with no horizontal overflow.
- **DP-08 — Clue navigation journey** A host solver steps through clues by Tab, picks a Down clue by click and leaves the grid with Escape, and the clue marks and clue bar text are exact at each step.
- **DP-09 — Phone room board** Below 768 px wide the room shows the clue bar, grid, letter keyboard and player tiles in the published order, with the clue lists inert and no horizontal overflow at 375x812.
- **DP-10 — Letter keyboard and touch selection** On a phone the on-screen letter keyboard enters letters and the touch rules select squares and switch direction, without opening the device keyboard.
- **DP-11 — Phone solving journey** An invited friend at 375x812 solves by tapping squares, the clue bar buttons and the letter keyboard, with reduced motion on.
- **DP-12 — Guest players** A visitor becomes a guest player by choosing a display name of 1 to 24 characters and receives the published player cookie.
- **DP-13 — Share dialog** Share opens dialog "Share game" with the game link and a Copy link control that announces its result.
- **DP-14 — Joining by link** Anyone with a player cookie who opens an active game link joins that game with the first free colour, as limited by the player cap.
- **DP-15 — Link turn-off and replacement** The host can turn the game link off or replace it, after which the old link grants nothing, including to live connections already open on it.
- **DP-16 — Live shared play** Other players' letters, pencil marks, check marks and cursor blocks appear in place within two seconds, with no reload and no movement of the viewer's own cursor.
- **DP-17 — Shared play journey** Two players join by link, type into one word and see each other live, and then the host turns the link off and the friend's view shows the published sentence.
- **DP-18 — Server-sequenced writes** Every write to the game gets the next sequence number, and every screen settles on the value with the highest sequence number for each square.
- **DP-19 — Locked squares** Squares that are checked right or revealed refuse every later write with the published conflict and notice, and keep their value.
- **DP-20 — Operation replay keys** A write sent again with the same client operation id returns the stored result without a new sequence number, and reusing that id for a different write answers 409.
- **DP-21 — Live message rate limit** Writes beyond the per-player rate are refused with the published error and notice, as qualified in Business rules.
- **DP-22 — Same-square journey** Two players write different letters to one square at the same moment, both screens and the stored game agree on the last accepted value, and a write to a revealed square changes nothing.
- **DP-23 — Check and Reveal menus** Check and Reveal each open a menu of Square, Word and Puzzle that works fully by keyboard and returns focus as published.
- **DP-24 — Check and reveal rules** Check marks filled unlocked squares wrong or right, reveal writes and locks answers, and both are stored, broadcast and counted as published in Business rules.
- **DP-25 — Check and reveal journey** A host solver checks a word, reveals a square and checks the puzzle by keyboard, while a friend sees every mark live and both keep them after a reload.
- **DP-26 — Pencil mode** The period key and the Pencil button toggle pencil mode, whose letters are stored and shown as pencil marks until a pen letter replaces them.
- **DP-27 — Rebus entry** The Insert key and the Rebus button open an inline rebus editor that commits up to eight letters or digits as one entry.
- **DP-28 — Open editors survive live updates** Timer ticks and incoming live messages never close an open rebus editor, menu or dialog, clear its draft or move focus.
- **DP-29 — Pencil and rebus journey** A host solver pencils in letters, overwrites one in pen, commits a STAR rebus, cancels another, and checks, and the stored game keeps the full rebus string.
- **DP-30 — Server-owned solve timer** The server runs, pauses, resumes and freezes the shared solve time by the presence rules in Business rules, and every screen shows the server's value.
- **DP-31 — Timer display and personal pause** The room shows the solve time in the published format, and Pause my timer freezes only that viewer's display.
- **DP-32 — Timer journey** Two players leave, the server pauses the timer at the moment the last one left, and when one returns the timer resumes from that value.
- **DP-33 — Solve detection** A game becomes solved exactly once, at the write that makes every square match its answer, and then refuses further writes.
- **DP-34 — Puzzle solved dialog** Every player in the room sees dialog "Puzzle solved" with the published heading and line, focus on its heading, and no motion under reduced motion.
- **DP-35 — Solved journey** A friend types the last letter, both players see the solved dialog with the same time, the timer freezes, and typing afterwards is refused.
- **DP-36 — Grid announcements** The polite status "Grid announcements" region announces clue changes, check and reveal results, joins, leaves and the solve with the published copy.
- **DP-37 — Presence and player tiles** list "Players" shows each player's name, colour and presence, and it updates live as players join and leave.
- **DP-38 — Announcements journey** A host solver moves, checks and hears a friend join and leave, and every announcement and square name along the way is exact.
- **DP-39 — Overlap text format** The app parses the Overlap text format deterministically, computes numbering by the published rule, and accepts no other format.
- **DP-40 — Upload limits and line-numbered errors** Uploads that break a published limit or format rule are refused with the published size answer or line-numbered errors, in the published order.
- **DP-41 — Upload stored as submitted** A valid upload is stored in object storage byte for byte under the published key, its sha256 is recorded, and Download original returns exactly those bytes.
- **DP-42 — Private uploads** An uploaded puzzle is visible only to its uploader and to players of games on it, and any other caller gets 404.
- **DP-43 — Upload journey** A hobby constructor picks a name by keyboard, uploads text with three errors, reads the exact messages, fixes them, and opens a room on the parsed puzzle.
- **DP-44 — History entries** Each participant of a solved game gets one history entry in list "History", in the published row format, which survives reloads and new browser contexts.
- **DP-45 — Solve record object** Each solved game has exactly one solve record object at the published key, whose operation log and timer segments equal the game's.
- **DP-46 — Replay from the solve record** Replay steps through a finished game from its solve record, from step 0 showing the starting grid to the last step showing the final grid, with the published step controls and square hooks.
- **DP-47 — History journey** Two players solve a game, both see the history row after a reload, the downloaded solve record matches the game, and a player who never joined has no row.
- **DP-48 — Storage outage behaviour** While object storage is unreachable, the health route, uploads, downloads and solve records behave exactly as published, with the outage copy.
- **DP-49 — Recovery without restart** When object storage returns, uploads and downloads work again without a restart, and deferred solve records are written exactly once.
- **DP-50 — Upload outage journey** On the storage-outage instance an upload shows the outage copy, keeps the text and focus in the dialog and creates no puzzle, and the same upload succeeds on the normal instance.
- **DP-51 — Run manifest, health and config** The app runs from /app/run.json on port 4173, answers the health route, and serves the published config route.
- **DP-52 — Grading routes** With OVERLAP_GRADING=1 the seed and session routes create players, puzzles and games exactly as published, and without it they do not exist.
- **DP-53 — Error shape and precedence** Every API error uses the one published body shape and codes, and is chosen by the one published precedence.
- **DP-54 — Server boundary** The server accepts same-origin requests and live connections only, enforces the published body sizes, and never serves source files or credentials.
- **DP-55 — Board and filters** The board lists library and own puzzles as tiles with live in-progress counts, and filter chips that live in the URL and update the board in place.
- **DP-56 — Dialogs, menus and room shortcuts** Every dialog keeps Tab inside itself, closes on Escape and returns focus to its opener, and the room shortcuts work from any room control.
- **DP-57 — Pivot band motion and reduced motion** Switching direction runs the Pivot band shrink-then-grow and the clue scroll in the published phases, and under reduced motion they jump to the same end state at once.
- **DP-58 — Dense-tiles visual language** Every screen is one fitted tile board in Albert Sans and the paper-grey and brass palette, with no rules, square corners, and brass on exactly one element.
- **DP-59 — Home hero board** The home page shows the published two-by-two hero board with its dithered grid image and its phone arrangement.
- **DP-60 — Credentials and bundled assets** Service credentials come only from the environment and never reach the browser, and fonts and icons are served by the app itself.
- **DP-61 — Solving settings** Settings opens dialog "Solving settings" with three checkboxes that save to the player at once through the settings route and stay after reloads and in new browser contexts.
- **DP-62 — Settings and the cursor** With Skip filled squares off or Jump to the next clue on, a letter moves the cursor by the published variant of the auto-advance rule, and a refused write moves it the same way.
- **DP-63 — Autocheck** With Autocheck my letters on, the server checks each of that player's pen entries in the same write and marks it wrong or right as published, while other players' writes stay unchecked.
- **DP-64 — Autocheck with pencil and rebus** Pencil writes and clears are never autochecked, a committed rebus is autochecked as one whole entry, and autochecked writes leave checked_count unchanged.
- **DP-65 — Clue references in uploads** Uploaded clue text that refers to a clue the grid does not have, or to starred clues when none is starred, is refused with the published line message in the published checking order.
- **DP-66 — Linked clues** The room marks the clues and squares linked to the active clue, in both directions of reference, with the published data hooks, and the puzzle JSON lists each clue's links.
- **DP-67 — Linked clue announcements and Alt+L** A clue change announces the active clue's linked clues in the published sentence, and Alt+L moves to the next linked clue.
- **DP-68 — Clear word and clear puzzle** Clear word keeps letters that sit in a full crossing word unless nothing else is left to clear, Clear puzzle clears every unlocked square, and both are sequenced, stored and broadcast as published.
- **DP-69 — Clear menu and confirmation** Clear opens menu "Clear" by button, touch or Alt+X, and Clear puzzle asks in dialog "Clear the puzzle?" before it clears anything.
- **DP-70 — Race games and teams** A race game is created from the board or the API, every player starts watching, and players choose Team 1, Team 2 or Watch until the host starts the race.
- **DP-71 — Team grids** In a race each team writes into its own grid, and letters, pencil marks, clears and cursors reach only that team's players.
- **DP-72 — Claims by check** A racer's check of one square claims it for their team when it is right, writing it into both teams' grids and scoring one point, and marks it wrong only in their own team's grid when it is not.
- **DP-73 — Race end and result** The race ends at the claim of the last square, and every player sees dialog "Race over" with the published heading and scores.
- **DP-74 — Race journey** Two players on opposite teams race on one game, each sees only their own team's letters, claims and scores appear live on both screens, and the last claim ends the race for both.
- **DP-75 — Live clears and autocheck marks** Other players' clears and autochecked marks appear in place within two seconds, with no reload and no movement of the viewer's own cursor.
- **DP-76 — Replay timeline** The replay dialog has slider "Replay position" whose keys step, jump to the ends, page by ten and skip to the next or previous check, reveal or clear.
- **DP-77 — Replay op descriptions** status "Replay op" describes the op that produced the current step in the published sentence.
- **DP-78 — Replay autoplay** Play advances the replay one step per OVERLAP_REPLAY_STEP_MS divided by the chosen speed, on page timers, and stops at the last step.
- **DP-79 — Builder grid and symmetry** The puzzle builder at /build toggles black squares together with their partners under the chosen symmetry, with the published default and the diagonal limit.
- **DP-80 — Builder numbering and clues** The builder numbers its grid live by the Overlap rule and shows one clue field per word, keeping a clue's text while its word's start square and direction are unchanged.
- **DP-81 — Builder problems** list "Grid problems" lists the builder's problems in the published order and copy, and status "Builder status" counts them.
- **DP-82 — Builder text** Download text gives the exact published Overlap text and file name for the builder's grid and clues.
- **DP-83 — Builder save** Save to my puzzles sends the builder's text as an upload, and the stored original is byte for byte the downloaded text.
- **DP-84 — Builder journey** A hobby constructor builds a 5x5 puzzle by keyboard, sees the problems clear one by one, downloads the text and saves it as their own puzzle.
- **DP-85 — Solve stats** The solved dialog lists each player's letters and reveals in list "Solve stats" by the published counting rule.
- **DP-86 — Stats in history and records** History entries, history tiles and solve records carry the same per-player stats as the solved dialog.
- **DP-87 — Builder save during an outage** On the storage-outage instance Save to my puzzles shows the builder outage copy, keeps the whole draft and creates no puzzle.

## Frontend

### Screens and layout (DP-07, DP-09, DP-55, DP-59, DP-69, DP-70, DP-79)

Every screen is one board: a 12-column grid of tiles with 8-pixel gaps between tiles and 8-pixel outer margins. Tiles come in four sizes (6 columns by 4 rows, 6 by 2, 3 by 2, 3 by 4, at rows of about 90 pixels), plus 12-wide bands. Corners are square everywhere. Three layouts exist, chosen by window width only: **phone** below 768 px, **tablet** from 768 to 1199 px, **desk** from 1200 px up. The published viewports are 375x812 (phone), 768x1024 (tablet) and 1280x800 (desk). None of them scrolls sideways at any point.

**Top bar** (every screen, a 60-pixel row). Desk and tablet: an ink logo tile (`link "Overlap home"`) with a 2-by-2 square mark, one square brass; a ground tile with `link "Board"`, `link "Upload"` and `link "History"` starting at the board's centre line; and an ink action tile `link "Start a room"`, which goes to the board. Phone: the logo tile and `button "Menu"`. Menu opens `dialog "Menu"` holding the same four links.

**Home** (`/`). Desk and tablet show a two-by-two board below the top bar:
- Top left: a paper tile with "Overlap" set very large, bottom-left.
- Top right and bottom left: greyscale one-bit dithered renders of the Long Table grid, filled with letters and cropped at an angle, so they read as one photograph of a newspaper grid continuing across the board.
- Bottom right: split into an ink tile and a brass tile carrying the two hero lines from Feedback states.

On a phone: the logo and menu tiles; the name tile at about a third of the screen height with "Overlap" at about a fifth of the screen width; one dither tile at 4:3; then the ink and brass tiles side by side as squares.

**Board** (`/puzzles`):
- A 6x2 filter tile holds the filter chips and `button "Upload puzzle"`.
- Puzzle tiles follow, sized by the larger grid side: up to 7 gets a 3x2 tile, 8 to 12 gets 3x4, 13 and up gets 6x4.
- Each tile shows the title, `<cols>x<rows>`, "By <author>", the in-progress count from Feedback states when it is at least 1, `button "Start <title>"` and `button "Race <title>"`.
- Order: library puzzles in seed order, then the caller's own uploads, newest first.
- Phone: tiles stack one per row, full width.

**Upload page** (`/upload`). A 6x4 drop tile with one line of explanation and `button "Upload puzzle"`, and beside it a 6x4 preview tile showing the caller's most recent upload, or the empty sentence. Both stack on a phone.

**Upload dialog** (`dialog "Upload a puzzle"`). A board sheet over the page with three tiles:
- A drop tile holding the file input, the text area and `button "Upload"`.
- A preview tile shown after a success: the parsed grid with numbers and answers, the title, the size, and `button "Start a room with this puzzle"`.
- An ink errors tile shown after a refusal: its heading, then `list "Upload errors"`.

On desk the drop and preview tiles sit side by side with errors below. On tablet and phone they stack in the order drop, errors, preview.

**Room** (`/games/<game id>`). Its regions:
- A 12x1 room bar: puzzle title, `timer "Solve time"`.
- `region "Current clue"`: the clue bar.
- The grid tile: an ink tile holding paper squares with 2-pixel gaps, where black squares are simply missing squares.
- `list "Across clues"` and `list "Down clues"` tiles.
- `list "Players"`: 3x2 tiles, one per player, filled with that player's colour.
- A tools tile: Pause my timer, Pencil, Rebus, Check, Reveal, Share, and Download original for uploaded puzzles only.

Layout by viewport:
- **Desk:** room bar; then a row with the clue bar (6 wide) above the grid tile (6x8) on the left, the Across tile (3x8) in the middle and the Down tile (3x8) on the right, tops aligned; then a foot row with the player tiles and the tools tile.
- **Tablet:** room bar, clue bar, grid tile full width, the Across and Down tiles side by side (6 each), then players and tools.
- **Phone:** room bar, clue bar with Previous clue and Next clue, grid tile full width, `group "Letter keyboard"` full width, the tools tile (without Pencil and Rebus, which live on the keyboard), then players. The clue lists stay in the page but are hidden and inert.

The tools tile also holds `button "Clear"` and `button "Settings"` on every layout. A race room adds a race tile (6x2 on desk and tablet, full width on a phone) directly above the player tiles, holding `radiogroup "Team"`, `button "Start race"` for the host and `status "Team scores"`.

Each published accessible name matches exactly one visible control in any one layout. Grid squares fill the grid tile's width. On a phone a 15x15 grid gives squares of about 22 pixels, the one exception to the 44-pixel tap size.

**History** (`/history`). A board of finished-game tiles in `list "History"`, newest first. Each tile shows a miniature grid with every square filled in its owner's colour, the row text, and `button "Download solve record"` and `button "Replay"`. Tiles are 3x2 on desk, 6x2 on tablet and full width on a phone.

**Builder** (`/build`). On desk and tablet a 6x8 grid tile sits on the left. On the right are a 6x2 settings tile (Title, Author, Columns, Rows, Symmetry), a 6x4 clue tile and a 6x2 problems tile holding the status and the two save actions. On a phone the tiles stack in the order settings, grid, clues, problems. The upload page's drop tile links to it with `link "Build a puzzle"`.

**Join page** (`/g/<game code>`). It joins and opens the room. For a dead link it shows the matching sentence in an ink 12x1 band.

**Empty, loading, error.** Each is a tile with one sentence in the top-left corner at about 28 pixels. Loading shows grey surface tiles in the final layout, with the main region busy, and never a spinner. Storage-outage, revoked-link and connection notices fill an ink 12x1 band under the top bar.

### Public screens and controls (DP-01, DP-06, DP-10, DP-13, DP-37, DP-55, DP-61, DP-66, DP-69, DP-70, DP-73, DP-76, DP-79, DP-80, DP-81, DP-85)

Only these roles, names and data hooks are public. Names are exact, case included.

| Role and accessible name | Where | Visible copy or content |
|---|---|---|
| `link "Overlap home"`, `link "Board"`, `link "Upload"`, `link "History"`, `link "Start a room"` | top bar (phone: inside `dialog "Menu"`) | Board, Upload, History, Start a room |
| `button "Menu"`, `dialog "Menu"` | phone top bar | Menu |
| `dialog "Choose a display name"`, `textbox "Display name"`, `button "Continue"` | any page except home, when the browser has no player | Continue |
| `button "Small"`, `button "Medium"`, `button "Large"`, `button "Library"`, `button "Mine"` (each with pressed state) | board filter tile | same as name |
| `button "Start <title>"` | each board tile | Start |
| `button "Upload puzzle"` | board filter tile, upload page | Upload puzzle |
| `dialog "Upload a puzzle"` | upload sheet | heading "Upload a puzzle" |
| file input labelled `Puzzle file` (accepts `.overlap.txt`) | upload dialog | Choose file |
| `textbox "Puzzle text"` (multi-line) | upload dialog | — |
| `button "Upload"` | upload dialog | Upload |
| `status "Upload status"` | upload dialog | pending and success copy |
| `heading` above the errors list (focusable by script) | errors tile | refusal heading copy |
| `list "Upload errors"` with one `listitem` per message | errors tile | line messages |
| `button "Start a room with this puzzle"` | preview tile | same |
| `timer "Solve time"` with `data-timer-state="running\|paused\|solved"` | room bar | `<time>` |
| `region "Current clue"` | clue bar | `<number><A\|D> <clue text>`, for example `1A Crumbly bake served with jam` |
| `button "Previous clue"`, `button "Next clue"` | phone clue bar only | arrow icons |
| `grid "Puzzle grid"` with `data-direction="across\|down"`, `data-pivot="idle\|shrink\|grow"` and `aria-activedescendant` naming the selected square | grid tile | squares |
| `row` | each grid row | — |
| `gridcell` (white square) | grid | letter, small number, marks |
| `gridcell "Black square"` | grid | nothing (ink shows through) |
| `list "Across clues"`, `list "Down clues"` with `listitem` named `<number> <clue text>` | clue tiles | number and clue |
| `group "Letter keyboard"` with `button "A"` to `button "Z"`, `button "Backspace"`, `button "Rebus"`, `button "Pencil"`, `button "Switch direction"` | phone keyboard tile | letters and labels |
| `button "Pause my timer"` (pressed state) | tools tile | Pause my timer |
| `button "Pencil"` (pressed state), `button "Rebus"` | tools tile (desk and tablet) | Pencil, Rebus |
| `button "Check"`, `menu "Check"`; `button "Reveal"`, `menu "Reveal"`; each menu has `menuitem "Square"`, `menuitem "Word"`, `menuitem "Puzzle"` | tools tile | Check, Reveal |
| `textbox "Rebus entry"` | over the selected square while the rebus editor is open | typed letters |
| `button "Share"`, `dialog "Share game"` | tools tile | Share |
| `textbox "Game link"` (read-only), `button "Copy link"`, `button "Turn off link"`, `button "Replace link"` (host only), `status "Share status"`, `button "Close"` | share dialog | link text and labels |
| `button "Download original"` | tools tile, uploaded puzzles only | Download original |
| `list "Players"`, one `listitem` per player | player tiles | name, then `<colour> · Here` or `<colour> · Away`, plus ` · Host` for the host |
| `status "Grid announcements"` (polite, may be visually hidden) | room | announcement copy |
| `status "Game notices"` (polite) | room, above the tools | notice copy |
| `alert` | ink band | outage, dead-link and connection copy |
| `dialog "Puzzle solved"` with a `heading` and `button "Close"` | room | solved heading and line |
| `list "History"`, `listitem` per entry, each with `button "Download solve record"` and `button "Replay"` | history | row text |
| `dialog "Replay"` with `button "Previous step"`, `button "Next step"`, `status "Replay step"`, `group "Replay grid"` | history | `Step <k> of <n>` |
| inside `dialog "Replay"`, present from step 0 and after Next step in document order: `slider "Replay position"` (value 0 to `<n>`), `button "Play"` (named `Pause` while playing), `radiogroup "Replay speed"` with `radio "1x"`, `radio "2x"`, `radio "4x"`, and `status "Replay op"` | replay dialog | op sentence |
| `button "Race <title>"` | each board tile | Race |
| `button "Clear"`, `menu "Clear"` with `menuitem "Word"` and `menuitem "Puzzle"` | tools tile | Clear |
| `dialog "Clear the puzzle?"` with a `heading`, `button "Cancel"` and `button "Clear puzzle"` | room | heading copy |
| `button "Settings"`, `dialog "Solving settings"` with `checkbox "Skip filled squares"`, `checkbox "Jump to the next clue"`, `checkbox "Autocheck my letters"` and `button "Close"` | tools tile | Settings |
| `radiogroup "Team"` with `radio "Team 1"`, `radio "Team 2"`, `radio "Watch"`; `button "Start race"` (host only); `status "Team scores"` | race tile | team names and scores |
| `dialog "Race over"` with a `heading`, `list "Race scores"` (one `listitem` per racer) and `button "Close"` | race room | result heading and score rows |
| `list "Solve stats"` with one `listitem` per player | solved dialog | stats rows |
| `link "Build a puzzle"` | upload page drop tile | Build a puzzle |
| `textbox "Title"`, `textbox "Author"`, `spinbutton "Columns"`, `spinbutton "Rows"`, `radiogroup "Symmetry"` with `radio "None"`, `radio "Rotational"`, `radio "Left-right"`, `radio "Top-bottom"`, `radio "Diagonal"` | builder settings tile | labels |
| `grid "Builder grid"` with a `row` per grid row and a `gridcell` per square | builder grid tile | letters and small numbers |
| `textbox "<number> <Across\|Down> clue"`, one per word, Across words by number then Down words by number | builder clue tile | clue text |
| `list "Grid problems"` with one `listitem` per problem, `status "Builder status"`, `button "Download text"`, `button "Save to my puzzles"` | builder problems tile | problem and status copy |
| inside `group "Replay grid"`: one element per white square, with `data-row`, `data-col` (0-based), `data-value` (the upper-case entry, or empty), `data-state` (same values and precedence as grid squares) and `data-owner="<colour>"` (absent when empty) | replay dialog | the square's entry |

**Gridcell names and hooks.** A white square's accessible name is `<number> <Across|Down>, letter <i> of <length>, <content>` followed by any of `, pencil` and then one of `, checked wrong`, `, checked right`, `, revealed`:
- `<number>`, `<i>` and `<length>` describe the square's word in the grid's active direction. If the square has no word in that direction, they describe its word in the other direction.
- `<content>` is `empty` or the full entry in upper case, for example `1 Across, letter 1 of 5, STAR` for a rebus.
- For example: `4 Across, letter 3 of 5, empty`, `4 Across, letter 3 of 5, E`, `4 Across, letter 3 of 5, E, pencil`, `4 Across, letter 3 of 5, E, checked wrong`, `4 Across, letter 3 of 5, E, revealed`.

Each white square also carries:
- `data-row` and `data-col`, 0-based.
- `data-number` when numbered.
- `data-state`, one of `empty`, `filled`, `pencil`, `wrong`, `right`, `revealed`. When marks combine, the first in this order wins: revealed, right, wrong, pencil, filled, empty.
- `data-owner="<colour>"`: the player who last wrote the value. Absent on empty squares.
- `data-in-word="true"` on every square of the viewer's active word.
- `data-cursor="<colour> <colour>"`: other players whose cursor is on the square, in join order. Absent when there are none.

Exactly one square has `aria-selected="true"` in each player's view.

**Race square hooks.** In a race room every claimed square also carries `data-claimed="true"`.

**Linked clue hooks.** While the active clue has linked clues (Business rules), each linked clue's `listitem` and every square of each linked clue's word carry `data-linked="true"`. No other element carries it.

**Builder squares.** Each builder `gridcell` is named `Row <r>, column <c>, <content>`, with r and c 1-based and content the upper-case letter, `empty` or `black`. It carries `data-row` and `data-col` (0-based), `data-number` when numbered, `data-black="true"` on black squares, and `aria-selected="true"` on the one selected square.

**Clue hooks.** The active clue's listitem has `aria-current="true"`. The clue in the other direction that contains the selected square has `data-crossing="true"`.

### Interactions (DP-02, DP-03, DP-05, DP-10, DP-23, DP-26, DP-27, DP-28, DP-31, DP-56, DP-61, DP-62, DP-67, DP-69, DP-70, DP-76, DP-78, DP-79)

**Grid keyboard rules.** These apply while the grid has focus. The grid is a single Tab stop. Clicking a square selects it and focuses the grid. "The word" means the selected square's word in the active direction. Revealed and checked-right squares count as filled.

**Starting selection.** Whenever a player's room view opens (first open, joining by link, or a reload), the grid takes focus and the view picks a starting clue:
- The starting clue is the first clue in clue order (as defined under Tab below) whose word has an empty square. When every square is full, it is the first clue in clue order.
- The first clue in clue order is 1 Across. When the puzzle has no 1 Across (square 1 starts only a Down word), it is the lowest-numbered Across clue. When the puzzle has no Across clues at all, it is the lowest-numbered Down clue.
- The selected square is the first empty square of the starting clue's word, or that word's first square when the word is full.
- The direction is the starting clue's direction: Across when it is an Across clue (as for 1 Across), Down when it is a Down clue. The active clue, the clue bar, the starting announcement and every square's name follow that direction.

For example, in Morning Kettle with 1, 4 and 5 Across full and the squares that belong only to Down words still empty, a reload selects row 1 column 0, the direction is Down, and the clue bar shows 1 Down. A reload never restores the selection or direction the player had before; it always starts from this rule.

- **Letter (A to Z, either case):** writes the upper-case letter into the selected square, in pencil when pencil mode is on. The cursor then moves to the next empty square later in the word. If there is none, it moves to the first empty square earlier in the word. If the word is now full, it moves to the next square in the word, or stays when already on the word's last square.
- **Arrow along the active direction:** moves one square that way, jumping over black squares to the next white square in that row or column. At the grid edge it does nothing.
- **Arrow across the active direction:** switches direction without moving. The next press moves.
- **Space or Enter:** switches direction without moving.
- **Any direction switch** (Space, Enter, cross arrow, tapping the selected square, Switch direction) is ignored when the selected square has no word in the other direction. A cross arrow then moves instead.
- **Tab:** goes to the next clue in clue order (every Across clue by number, then every Down clue by number, wrapping from the last Down clue to the first Across clue). It lands on the first empty square of that clue's word, or on the word's first square when the word is full. Direction becomes that clue's direction. Shift+Tab goes to the previous clue the same way. Tab never moves focus out of the grid.
- **Escape:** moves focus from the grid to `button "Pause my timer"`.
- **Backspace:** clears the selected square and stays when it holds an entry. On an empty square it moves back one square in the word and clears that square. Locked squares are never cleared: on a locked square Backspace and Delete do nothing, send no write and show no notice, and when Backspace moves back onto a locked square it leaves that square as it is. Nothing moves past the word's first square.
- **Delete:** clears the selected square without moving.
- **Period (.):** toggles pencil mode, mirrored by the pressed state of `button "Pencil"`. A pen letter typed over a pencil mark replaces it. A pencil letter typed over a pen letter replaces it as a pencil mark.
- **Insert (or the Rebus button):** opens `textbox "Rebus entry"` over the selected square, prefilled with the square's current entry, with focus in it. It accepts only A to Z and 0 to 9, shown in upper case, up to eight characters; further characters are ignored. Enter commits the whole string as one entry, then the cursor moves as for a letter. Committing an empty editor clears the square. Escape cancels and keeps the old entry. In both cases focus returns to the grid. On a phone, letter keys append to the open editor, Backspace removes its last character, and the Rebus key commits.
- **Typing into a locked square** (a letter, or committing the rebus editor) sends the write. The server refuses it, and the locked-square notice appears. After any refused write (locked square, solved game or rate limit) the cursor moves exactly as the letter rule would have moved it had the write been accepted, and the square shows the server's value.

**Clues.** Clicking or tapping a clue selects the first empty square of its word (or the first square when the word is full) and sets the direction. Previous clue and Next clue on the phone clue bar act like Shift+Tab and Tab. The active clue's list scrolls as described in Motion and effects.

**Phone and touch.** Tapping a square selects it. Tapping the selected square switches direction. Letter keyboard keys act like the matching physical keys, and Switch direction acts like Space. No text field that would open the device keyboard exists in the room, except the rebus editor.

**Menus.** `button "Check"` and `button "Reveal"` open their menus with focus on Square. Arrow Down and Arrow Up move with wrap-around, Home and End jump to the ends, and Enter or Space activates. The action applies to the selected square, the word in the active direction, or the whole puzzle, and focus returns to the grid. Escape or Tab closes the menu with focus back on its button.

**Solving settings.** `button "Settings"` opens `dialog "Solving settings"`. Each checkbox saves at once (Business rules) and applies from the next keystroke.
- **Skip filled squares** on (the default): the Letter rule above.
- **Skip filled squares** off: after a letter the cursor moves to the next square in the word, filled or not, or stays when already on the word's last square.
- **Jump to the next clue** on (default off): when the word is full after the letter, the cursor instead goes to the next clue after the active clue in clue order (wrapping) whose word has an empty square, onto that word's first empty square, and the direction becomes that clue's. When no word has an empty square, the cursor moves as it would with this setting off.
- Both settings apply to letter keys, letter keyboard keys and committed rebus entries, and to refused writes exactly as the refused-write rule above says.
- **Autocheck my letters** (default off) is owned by Business rules.

**Clear.** `button "Clear"` and Alt+X (the physical X key, from anywhere Alt+C works) open `menu "Clear"` with focus on Word. Its keys are those of the Check menu. Word sends a word clear for the selected square's word in the active direction, and focus returns to the grid. Puzzle closes the menu and opens `dialog "Clear the puzzle?"` with focus on Cancel. Clear puzzle sends a puzzle clear. Cancel and Escape send nothing. Either way the dialog closes and focus returns to the grid.

**Linked clues.** Alt+L (the physical L key, while the grid has focus) goes to the next linked clue after the active clue in clue order, wrapping, and lands as Tab does: the first empty square of that clue's word, or its first square when the word is full, with that clue's direction. With no linked clues it does nothing.

**Race rooms.** Choosing a radio in Team sends the team change at once, and arrow keys move between the radios and select as usual. Once the race has started the radios are disabled. A watcher's letter keys, rebus, pencil and Backspace do nothing and send nothing. In a race the Word and Puzzle items of the Check menu, the Puzzle item of the Clear menu and `button "Reveal"` are disabled (`aria-disabled="true"`), and Check Square is the only way to claim. Start race is enabled only in the lobby while each team has at least one player.

**Replay timeline.** `slider "Replay position"` always shows the current step (`aria-valuenow`, from 0 to `<n>`). While it has focus:
- Arrow Right and Arrow Up go one step forward, Arrow Left and Arrow Down one step back.
- Home goes to step 0 and End to step `<n>`. Page Up goes 10 steps forward and Page Down 10 back, stopping at the ends.
- Shift+Arrow Right goes to the next step after the current one whose op is a check, reveal or clear, or to step `<n>` when there is none. Shift+Arrow Left goes to the nearest earlier such step, or to step 0.
- `button "Play"` starts playing from the current step, or from step 0 when the current step is `<n>`, and is then named `Pause`. While playing, every `OVERLAP_REPLAY_STEP_MS` divided by the chosen speed (1, 2 or 4; default 1x) of page time adds one step. Reaching step `<n>` stops playing. Pause, a step button and any slider key stop playing too. Choosing another speed while playing restarts the wait for the next step at the new interval.

**Builder keyboard.** The builder grid is a single Tab stop and starts with row 1, column 1 selected. Clicking a square selects it.
- Arrow keys move the selection one square, onto black squares too, and do nothing at the grid edge.
- A letter (A to Z, either case) on a white square writes it in upper case and moves the selection to the next white square to the right in that row, staying on the row's last white square. On a black square a letter does nothing.
- Period toggles the selected square between white and black, together with its symmetry partners (Business rules). A square that turns black loses its letter.
- Backspace clears the selected square's letter and moves to the previous white square to the left in that row, never past the row's first white square. Delete clears without moving.
- Columns and Rows accept 3 to `OVERLAP_MAX_GRID`. Every change of either value resets the grid to all white squares with no letters and no clue text, and resets Symmetry to the default for the new size.
- The Diagonal radio is disabled while Columns and Rows differ.
- Download text and Save to my puzzles are disabled while the builder has any problem.

**Room shortcuts.** Alt+C opens the Check menu and Alt+R opens the Reveal menu, matched by the physical C and R keys. They work while focus is anywhere in the room (grid, tools, player tiles, clue bar), but not inside an open dialog or the rebus editor.

**Dialogs.**
- Every dialog moves focus to its first control, or to its heading for Puzzle solved and for the upload errors.
- Tab and Shift+Tab wrap inside the dialog. Focus never reaches the page behind it.
- Escape and `button "Close"` close the dialog and return focus to the control that opened it. For Puzzle solved and Race over, focus returns to the grid.
- The name dialog's Continue creates the player and then performs the action that needed one.

**Share.** Copy link puts the link on the clipboard and shows its status copy. Turn off link and Replace link act at once (no confirmation) and update the link field and status.

**Upload.**
- Choosing a file fills Puzzle text with the file's text and marks the file as the thing to send. Editing the text afterwards drops the file, and the edited text is sent instead.
- Upload sends the chosen file's exact bytes, or the text encoded as UTF-8.
- While a request is pending, Upload is disabled and a second press does nothing.
- On refusal, focus moves to the errors heading. On an outage, focus stays on Upload and the text stays.

**Timer.** `button "Pause my timer"` freezes this tab's display at its current value while pressed. Pressing it again shows the server-derived value at once. It never changes the shared timer.

**Live updates never disturb the viewer** (DP-28). When a letter, mark, cursor, presence change, timer message or one-second tick arrives:
- Only the changed squares, clue marks, tiles and timer text are updated in place.
- Open menus, dialogs and the rebus editor stay open, with their drafts and focus.
- The viewer's own selection and direction never move.
- A notice or status message that has just been shown is never overwritten by a later repaint. Only a newer message replaces it, and an older message's clearing timer never clears a newer one.

### Visual design (DP-58, DP-59)

- **Direction.** Dense tiles: the page and the puzzle are one fitted system. The crossword grid is itself the largest tile on the board: square paper cells on an ink tile.
- **Type.** Albert Sans for both headings and body, served by the app. Each heading step is about a third larger than the one below it. The home name is weight 500 with tightly closed letter spacing. Times and counts use figures of equal width.
- **Palette, in words:**
  - Ground: a pale, slightly warm paper grey.
  - Surface: a grey one step darker, used for tiles and loading tiles.
  - Ink: a warm near-black, used for text and for the ink tiles, bands and grid backing.
  - Muted: a mid warm grey for secondary text and crossing clues.
  - Accent: a brass olive-yellow, with ink text on it.
- **Brass** appears on exactly one element per screen: the primary action (Start a room with this puzzle in the upload preview; Upload in the upload dialog; the hero's brass tile on home; the logo square elsewhere) or the solved tile when a game is solved, which then takes the room's single brass element.
- **Density** is compact. Every tile and every grid square meets its neighbours at the same gap: 8 pixels between tiles, 2 pixels between grid squares. No board ever has an empty cell.
- **No rules anywhere**, not even in the crossword grid. Squares are filled paper squares with the ink tile showing through the gaps, and black squares are simply missing squares. There are no borders, hairlines, drop shadows, rounded corners, glass, monospace labels or index numbering.
- **Players.** Each player's colour is a filled tile in the player row. Their cursor is a filled 8-pixel block in the square's top-right corner. Their active word is a band of squares in a light tint of their colour, with the cursor square in the full colour. The colour palette, in join order: Teal, Coral, Violet, Moss, Cobalt, Rose, Rust, Slate. Each is dark enough that its corner block shows on paper, and light enough that ink letters on its tint keep at least 4.5:1 contrast.
- **Marks.** A checked-wrong square carries a muted diagonal slash. A checked-right square has a small ink tick in its lower corner. A revealed square has a small filled ink triangle in its lower corner. Pencil letters are muted grey.
- **Active clue tile.** It turns ink with paper text. The other direction's tile is surface, with its crossing clue in muted bold.
- **Working screens** use the same tiles: the filter chips are filled chips (pressed chips are ink), and form fields are surface tiles with ink text and an ink focus outline. Empty, loading and error states are tiles with one top-left sentence.
- **Accessibility.** Every control is at least 44 pixels in both directions, apart from the exceptions in Screens and layout and phone letter keys, which are 44 pixels tall and at least 32 wide. All text and focus outlines meet WCAG 2.2 AA contrast. Every focusable control shows a thick ink outline when focused.
- **Imagery** is the procedural one-bit ordered-dither drawing of the Long Table grid on a canvas, a still image. Icons are inline line drawings made for the product.

### Motion and effects (DP-34, DP-57)

The product has exactly three motions: the Pivot band, the clue scroll and the solved dialog's entrance. Hover and press feedback change colour instantly, with no transition. Notices and bands appear and disappear without motion. Other players' cursor blocks jump from square to square without easing. There is no decorative or looping motion anywhere.

**Pivot band** (signature). The solver always knows which word they are filling, which clue it answers and which crossing clue it touches. When the direction switches (Space, Enter, a cross arrow, a second tap or Switch direction):
1. In the same frame: `data-in-word`, `aria-selected`, the clue marks, the clue bar, the active clue tile turning ink, and the announcement all take their new values.
2. The tinted band then shrinks along its old axis into the cursor square in about 90 milliseconds, while the grid carries `data-pivot="shrink"`.
3. It grows along the new axis from the cursor square to cover the new word in about 140 milliseconds, while the grid carries `data-pivot="grow"`. Both phases start fast and land softly.
4. The grid returns to `data-pivot="idle"`.

The phases are timed with page timers. A new switch during a phase restarts from step 2 with the newest direction.

**Clue scroll.** After any change of active clue, the active clue's list scrolls in about 200 milliseconds until the active clue's top sits one third of the way down the list's visible height, or as close as the list's ends allow.

**Solved dialog.** It rises slightly from the grid and settles in about 200 milliseconds, never more than half a second.

**Reduced motion.** When the system asks for reduced motion:
- The band, clue tiles and clue list jump to their end state in one frame, and the grid stays at `data-pivot="idle"`.
- The solved dialog appears with no movement or fade.
- No animation runs on the grid or the dialog.
- The attributes, announcements and focus are exactly the same as with motion.

### Feedback states (DP-12, DP-13, DP-15, DP-19, DP-21, DP-34, DP-36, DP-40, DP-44, DP-46, DP-48, DP-55, DP-65, DP-67, DP-68, DP-71, DP-73, DP-77, DP-81, DP-83, DP-85, DP-87)

Placeholders: `<name>` is a player's display name. `<time>` and `<date>` follow Business rules. `<n>`, `<k>` and `<limit>` are plain digits. `<revealed phrase>` is `Revealed 1 square` when the count is 1 and `Revealed <n> squares` otherwise.

| Situation | Where | Exact copy |
|---|---|---|
| Hero lines | home ink tile, home brass tile | `Solve one grid with friends in other rooms, each with your own colour.` / `Upload a puzzle in plain text and send the link.` |
| Display name invalid | below `textbox "Display name"`, announced with it | `Enter a name between 1 and 24 characters.` |
| Board in-progress count | puzzle tile | `In progress with <n>` |
| Board filters match nothing | empty tile | `No puzzles match these filters.` |
| Upload page with no upload yet | preview tile | `Nothing uploaded yet.` |
| Upload pending | `status "Upload status"` | `Checking your puzzle` |
| Upload success | `status "Upload status"` | `Puzzle ready: <title>` |
| Upload refused (422) | errors heading | `This puzzle has 1 problem.` or `This puzzle has <n> problems.` (n = all problems found) |
| Upload too large (413) | errors heading, no list | `This file is larger than <limit> bytes.` |
| Storage outage during upload | ink band `alert` inside the dialog | `Puzzle storage is unreachable right now. Your text is still here; try again in a moment.` |
| Storage outage on download, record or replay | ink band `alert` on the page | `Puzzle storage is unreachable right now. Try again in a moment.` |
| Copy link | `status "Share status"` | `Link copied` |
| Link turned off | `status "Share status"` | `Link turned off` |
| Link replaced | `status "Share status"` | `New link ready` |
| Old link that was turned off | ink band `alert` (join page and an open room) | `This game link was turned off.` |
| Old link that was replaced | ink band `alert` (join page and an open room) | `This game link was replaced. Ask the host for the new one.` |
| Unknown game link or game | error tile | `This game does not exist or is not shared with you.` |
| Game full | error tile on the join page | `Game is full.` |
| Joining a solved game you never played | error tile on the join page | `This puzzle is already solved.` |
| Write to a locked square | `status "Game notices"` | `That square is locked.` |
| Write after the solve | `status "Game notices"` | `This puzzle is already solved.` |
| Rate limited | `status "Game notices"` | `Slow down a little.` |
| Live connection lost, retrying | ink band `alert` | `Connection lost. Reconnecting.` |
| Clue changed (move, Tab, click, switch) | `status "Grid announcements"` | `<number> <Across\|Down>: <clue text>. <length> letters.` |
| Check result, n ≥ 1 | `status "Grid announcements"` (checker only) | `<n> wrong in this <square\|word\|puzzle>` |
| Check result, no wrong squares | `status "Grid announcements"` (checker only) | `No errors in this <square\|word\|puzzle>` |
| Reveal result | `status "Grid announcements"` (revealer only) | `<revealed phrase>` |
| Player joined or left | `status "Grid announcements"` (every other player) | `<name> joined` / `<name> left` |
| Puzzle solved | `status "Grid announcements"` (every player) | `Puzzle solved in <time>` |
| Solved dialog heading | `dialog "Puzzle solved"` | `Solved in <time>` |
| Solved dialog line | `dialog "Puzzle solved"` | `<revealed phrase>` when at least one square was revealed, otherwise `No squares revealed` |
| History row | each `listitem` | `<puzzle title> · <time> · <date>` (middle dots with a space each side), then a second line `<revealed phrase>` only when at least one square was revealed |
| History record not yet written | history row | `Solve record pending` (Download solve record and Replay disabled) |
| History empty | empty tile | `No finished games yet.` |
| Replay position | `status "Replay step"` | `Step <k> of <n>` |
| Unknown page | error tile | `Page not found.` |
| Clear result | `status "Grid announcements"` (clearer only) | `Cleared 1 square`, `Cleared <n> squares`, or `Nothing to clear` when n is 0 |
| Clear puzzle question | heading of `dialog "Clear the puzzle?"` | `Clear every unlocked square?` |
| Clue change with linked clues | `status "Grid announcements"` | the clue change sentence, a space, then `Linked to <list>.`, where list is the linked clues as `<number> <Across\|Down>` in clue order, joined by `, ` with ` and ` before the last (for example `Linked to 1 Down and 3 Down.`) |
| Team scores | `status "Team scores"` | `Team 1 <a> · Team 2 <b>` |
| Race write before the start | `status "Game notices"` | `The race has not started.` |
| Race over heading | heading of `dialog "Race over"` | `Team 1 wins <a> to <b>`, `Team 2 wins <b> to <a>`, or `Tie at <a>` when the scores are equal |
| Race score row | each `listitem` of `list "Race scores"` | `<name> · Team <t> · <k>`, racers from the highest score to the lowest, ties in join order; watchers are not listed |
| Solve stats row | each `listitem` of `list "Solve stats"`, and one text line per player on each history tile after the row text | `<name> · <k> letters · <v> revealed`, players in join order |
| Replay op at step 0 | `status "Replay op"` | `Start` |
| Replay op for a cell op | `status "Replay op"` | `<name> wrote <value> in row <r>, column <c>`; for a pencil write `<name> pencilled <value> in row <r>, column <c>`; for an empty value `<name> cleared row <r>, column <c>` (r and c 1-based) |
| Replay op for a check, reveal or clear | `status "Replay op"` | `<name> checked the <square\|word\|puzzle>: <n> wrong`, `<name> revealed the <square\|word\|puzzle>: <count>`, `<name> cleared the <word\|puzzle>: <count>`, where count is `1 square` or `<n> squares` |
| Builder status | `status "Builder status"` | `Ready to save` with no problems, otherwise `1 problem` or `<n> problems` |
| Builder saved | `status "Builder status"` | `Saved: <title>` |
| Storage outage on builder save | ink band `alert` on the builder | `Puzzle storage is unreachable right now. Your grid is still here; try again in a moment.` |

**Builder problems.** `list "Grid problems"` holds one item per problem, in this order:
1. `Title must be 1 to 80 characters` and then `Author must be 1 to 60 characters`, when that value (trimmed, counted like display names) breaks the limit.
2. `Square at row <r>, column <c> is not part of any word` for each white square in no word, reading rows top to bottom and squares left to right.
3. `The white squares are not all connected`, once, when the white squares (joined side to side) form more than one group.
4. `Row <r> has 1 empty square` or `Row <r> has <k> empty squares` for each row, top to bottom, holding white squares with no letter.
5. For each word, Across words by number then Down words by number, its first clue problem of: `<number> <Across\|Down> has no clue` (blank after trimming), `<number> <Across\|Down> clue is longer than 300 characters`, `<number> <Across\|Down> refers to <m> <Across\|Down>, which is not in the grid`, and `<number> <Across\|Down> refers to starred clues, but no clue is starred` (Clue references).

r and c are 1-based. The builder shows the list again after every change.

**Notice timing.**
- A game notice stays for `OVERLAP_TOAST_MS`, then clears. A newer notice replaces it and restarts the lifetime.
- Moving inside the same word leaves the announcement region unchanged.
- The connection band clears when the live connection reopens.
- The outage band clears on the next successful upload, download or record request.
- A dead-link band stays and the grid turns read-only.

**Upload line messages.** Each refusal reason is shown exactly once, in the form `Line <n>: <message>`, where `<n>` is the 1-based line number. Every message below starts with that prefix:

| Rule broken (see Overlap text format) | Message after `Line <n>: ` |
|---|---|
| bytes are not UTF-8 (n = line of the first bad byte) | `file is not valid UTF-8` |
| first line | `first line must be Overlap 1` |
| a header, Grid, Across or Down line missing where expected (n = last line + 1 at end of file) | `expected the <Title\|Author\|Size\|Grid\|Across\|Down>: line` |
| title length | `Title must be 1 to 80 characters` |
| author length | `Author must be 1 to 60 characters` |
| size syntax | `Size must look like 15x15` |
| size range | `grid size must be from 3x3 to <max>x<max>` (max = `OVERLAP_MAX_GRID`) |
| bad grid character | `unexpected character <c> in grid row` (c = the character) |
| rebus content | `rebus {<text>} must be 1 to 8 letters or digits` |
| rebus not closed | `rebus brace is not closed` |
| row length | `grid row has <k> squares, expected <cols>` |
| row count (n = the Grid: line) | `grid has <k> rows, expected <rows>` |
| orphan square (n = its grid row; r and c 1-based) | `square at row <r>, column <c> is not part of any word` |
| clue syntax | `clue must look like 12. Clue text` |
| clue without word | `clue <k> <Across\|Down> has no matching word in the grid` |
| duplicate clue | `clue <k> <Across\|Down> appears twice` |
| clue length | `clue <k> <Across\|Down> is longer than 300 characters` |
| missing clues (n = that block's heading line) | `missing clue for <list>`, where list is `<k> <Across\|Down>` items in ascending number joined by `, ` |
| reference to a clue the grid does not have | `clue <k> <Across\|Down> refers to <m> <Across\|Down>, which is not in the grid` |
| reference to starred clues when no clue is starred | `clue <k> <Across\|Down> refers to starred clues, but no clue is starred` |

## Backend

### API (DP-12, DP-13, DP-14, DP-15, DP-18, DP-20, DP-21, DP-23, DP-24, DP-30, DP-39, DP-40, DP-41, DP-42, DP-44, DP-45, DP-51, DP-52, DP-53, DP-61, DP-63, DP-66, DP-68, DP-70, DP-72, DP-75)

- **JSON.** Every route is under `/api`. Every JSON request and response is `application/json; charset=utf-8`. JSON request bodies are limited to 16,384 bytes; the limit itself is allowed. Timestamps are ISO 8601 UTC with milliseconds.
- **Identity.** The player is identified by the cookie `overlap_player` (`HttpOnly; SameSite=Lax; Path=/`).

**Error body.** Every error is `{"error":"<code>","message":"<text>"}`. A 422 also carries either `"fields":{"<field>":"<text>"}` or `"lines":["Line <n>: …"]`. Codes:

| Status | Codes |
|---|---|
| 413 | `too_large` |
| 401 | `no_player` |
| 429 | `rate_limited` |
| 404 | `not_found` |
| 410 | `link_off`, `link_replaced` |
| 403 | `not_host`, `watching` |
| 409 | `game_full`, `game_solved`, `square_locked`, `link_already_off`, `op_id_reused`, `race_started`, `race_not_started` |
| 422 | `invalid`, `invalid_puzzle` |
| 503 | `storage_unavailable` |

Where Feedback states pins copy for the same situation, `message` uses it.

**Error precedence** (the whole API, applied in this order; the first match answers):
1. 413 for a body over its limit.
2. 401 when a route needs a player and there is no valid cookie.
3. 429 when the player is over the rate limit.
4. 404 for a missing game, puzzle, history entry or route, or one the caller may not see (another player's private puzzle is 404, never 403). 410 for a turned-off or replaced link code sits at this same step.
5. 403 for a visible record the caller may not change, including `watching` for a race write by a player on no team.
6. A replayed client operation id returns its stored response here, before any state check.
7. 409 state conflicts, checked in this order: `op_id_reused`, `game_solved`, `game_full`, `race_started`, `race_not_started`, `square_locked`, `link_already_off`. A write to a locked square in a solved game is therefore `game_solved`.
8. 422 validation.
9. 503 when object storage is unreachable.

Endpoint rows list only their own extra errors.

**Shapes.**
- **Puzzle JSON:** `{"id","title","author","cols","rows","source":"library"|"upload","fixture":"<slug>"|null,"sha256":"<64 lowercase hex>"|null,"created_at","blocks":["<row string of # and .>",…],"numbers":[{"row","col","number"}],"clues":{"across":[{"number","row","col","length","text","links":[{"number","direction"}]}],"down":[…]}}`, where `links` lists the clue's linked clues in clue order and `direction` is `across` or `down`. Answers are never included.
- **Solution:** an array of rows, each an array of strings (`"#"` for a black square, else the upper-case answer, rebus included).
- **Square:** `{"row","col","value":"<upper-case entry or empty string>","pencil":bool,"state":"empty|filled|pencil|wrong|right|revealed","owner":"<colour>"|null}`.
- **Game JSON:** `{"id","puzzle_id","puzzle_title","host_player_id","code":"<code>"|null,"link_state":"active"|"off","status":"open"|"live"|"paused"|"solved","timer_state":"running"|"paused"|"solved","elapsed_ms","timer_segments":[{"started_at","ended_at"|null}],"seq","revealed_count","checked_count","solved_at"|null,"mode":"shared"|"race","race_state":"lobby"|"racing"|"finished"|null,"scores":{"1","2"}|null,"players":[{"id","display_name","colour","host":bool,"present":bool,"team":1|2|null,"score"}],"squares":[<square>,… every white square, row-major]}`. In a shared game `race_state` and `scores` are null, every `team` is null and every `score` is 0. In a race `squares` is the caller's team's grid, and for a watcher the claimed squares with every other square empty.
- **Op:** `{"seq","type":"cell"|"check"|"reveal","by":"<player id>","at","client_op_id"|null,…}`. `type` is also `clear` or `claim`. Cell ops add `row, col, value, pencil, state` (the square's state after the write) and `autocheck` (bool). Check, reveal and clear ops add `scope, row, col, direction` (null where unused) and `squares` (the squares they changed, as `{"row","col","state"}`, plus `value` for reveals and claims). Claim ops add `row, col, team`. In a race every op also carries `team` (1 or 2).

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | — | 200 `{"status":"ok"}`, or 200 `{"status":"unavailable"}` while object storage is unreachable | — |
| `GET /api/config` | — | 200 `{"heartbeat_ms","presence_grace_ms","upload_max_bytes","max_grid","max_players","live_rate","toast_ms","replay_step_ms"}` (numbers) | — |
| `POST /api/players` | `{"display_name"}` | 201 `{"id","display_name"}` (trimmed) and sets the cookie, replacing any earlier one | 422 `invalid`, `fields.display_name` |
| `GET /api/players/me` | — | 200 `{"id","display_name"}` | — |
| `GET /api/players/me/settings` | — | 200 `{"skip_filled":bool,"jump_next_clue":bool,"autocheck":bool}` | — |
| `PUT /api/players/me/settings` | `{"skip_filled","jump_next_clue","autocheck"}`, all three booleans | 200 the stored settings | 422 `invalid`, with `fields` naming the first bad or missing key in that order |
| `GET /api/puzzles?size=small\|medium\|large&source=library\|mine` (both optional) | — | 200 `{"puzzles":[{"id","title","author","cols","rows","source","fixture","in_progress"}]}`: library puzzles plus the caller's uploads, in board order, filtered | 422 `invalid`, `fields.size` or `fields.source` |
| `GET /api/puzzles/<puzzle id>` | — | 200 puzzle JSON | — |
| `POST /api/puzzles` | raw body: the file's bytes (any content type) | 201 `{"puzzle":<puzzle JSON>,"solution":<solution>}` | 413 `too_large` over `OVERLAP_UPLOAD_MAX_BYTES`; 422 `invalid_puzzle` with `lines`; 503 |
| `GET /api/puzzles/<puzzle id>/original` | — | 200 the stored bytes, `text/plain; charset=utf-8`, `Content-Disposition: attachment; filename="<puzzle id>.overlap.txt"` | 404 for library puzzles; 503 |
| `POST /api/games` | `{"puzzle_id","mode"}` (`mode` optional: `shared`, the default, or `race`) | 201 game JSON; the caller is host and first player | 422 `invalid` when `puzzle_id` is missing (`fields.puzzle_id`) or `mode` is another value (`fields.mode`) |
| `GET /api/games/<game id>` | — | 200 game JSON | — |
| `GET /api/games/<game id>/ops` | — | 200 `{"ops":[<op>,… in seq order]}` | — |
| `POST /api/games/<game id>/ops` | a client write message (below) | 200 the broadcast message it produced | 409 `game_solved`, `square_locked`, `op_id_reused`; 422 `invalid` |
| `GET /api/games/<game id>/live` | WebSocket upgrade | 101; messages below | — |
| `POST /api/games/<game id>/link/off` | `{}` | 200 game JSON | 403; 409 `link_already_off` |
| `POST /api/games/<game id>/link/replace` | `{}` | 200 game JSON with the new code | 403 |
| `POST /api/games/<game id>/team` | `{"team":1\|2\|null}` | 200 game JSON | 409 `race_started` after the lobby; 422 `invalid` (`fields.team`) for another value or a shared game |
| `POST /api/games/<game id>/race/start` | `{}` | 200 game JSON | 403 `not_host`; 409 `race_started` after the lobby; 422 `invalid` with `fields.teams` set to `Each team needs at least one player.` when a team is empty, or (`fields.mode`) for a shared game |
| `GET /api/links/<code>` | — | 200 `{"game_id","puzzle_title","status","player_count"}` | 410 `link_off` or `link_replaced` |
| `POST /api/links/<code>/join` | `{}` | 200 game JSON (also for a player already in the game) | 410; 409 `game_full`, `game_solved` |
| `GET /api/history` | — | 200 `{"entries":[{"game_id","puzzle_id","puzzle_title","cols","rows","elapsed_ms","solved_at","revealed_count","checked_count","record_ready":bool,"players":[{"display_name","colour"}],"squares":[{"row","col","owner"}],"stats":[{"display_name","colour","letters","revealed"}]}]}`, newest first | — |
| `GET /api/history/<game id>/record` | — | 200 the stored solve record bytes, `application/json` | 404 when the caller has no entry for that game; 503 |
| `POST /api/grading/seed` | below | 201 below | 422 `invalid` |
| `POST /api/grading/session` | `{"player_id"}` | 204 and sets the cookie | 404 unknown player |

Every route except health, config, `POST /api/players` and the grading routes needs a player.

**Client write messages** (live connection or `POST …/ops`). `client_op_id` is optional, 1 to 64 characters.
- `{"type":"cell","row","col","value","pencil":bool,"client_op_id"}`. `value` is the empty string (clear) or 1 to 8 characters from A to Z and 0 to 9, either case, stored in upper case.
- `{"type":"check","scope":"square"|"word"|"puzzle","row","col","direction":"across"|"down","client_op_id"}`. Row and col are needed for square and word; direction is needed for word.
- `{"type":"reveal",…}`, the same fields as check.
- `{"type":"clear","scope":"word"|"puzzle","row","col","direction","client_op_id"}`. Row, col and direction are needed for word.
- `{"type":"cursor","row","col","direction"}`, live connection only and never sequenced.

422 `invalid` covers a black or out-of-grid square, a bad value, scope or direction, and an unknown type.

**Live messages from the server** (JSON text frames):
- `{"type":"hello","you":"<player id>","game":<game JSON>}` on connect.
- `{"type":"cell","seq","row","col","value","pencil","state","owner","by","client_op_id","autocheck"}`.
- `{"type":"check","seq","scope","by","wrong":<n>,"squares":[{"row","col","state"}]}`.
- `{"type":"reveal","seq","scope","by","revealed":<n>,"squares":[{"row","col","value","state":"revealed","owner"}]}`.
- `{"type":"cursor","player_id","colour","row","col","direction"}`.
- `{"type":"presence","player_id","display_name","colour","present":bool}`.
- `{"type":"timer","state":"running"|"paused"|"solved","elapsed_ms"}`, sent on every timer state change.
- `{"type":"solved","seq","elapsed_ms","revealed_count","stats":[…as in history entries]}`.
- `{"type":"clear","seq","scope","by","cleared":<n>,"squares":[{"row","col"}]}`.
- `{"type":"claim","seq","row","col","value","owner","team","by","scores":{"1","2"}}`, to every player of a race.
- `{"type":"team","player_id","team"}` and `{"type":"race","state":"racing"|"finished","scores":{"1","2"}}`, to every player of a race.
- `{"type":"error","code","message","client_op_id"}`: refusals, with the same codes as the HTTP errors. They go only to the sender.
- `{"type":"link_off","reason":"off"|"replaced","message":"<sentence from Feedback states>"}`, followed by closing the connection with code 4410.

A connection by a caller who may not see the game is refused with HTTP 404 at the upgrade.

**Grading seed request:**
```
{"players":[{"key":"a","display_name":"Ada","settings":{"skip_filled":true,"jump_next_clue":false,"autocheck":false}}],
 "puzzles":[{"key":"p1","fixture":"morning-kettle"},{"key":"p2","text":"<Overlap text>","owner":"a"}],
 "games":[{"key":"g1","puzzle":"p1","host":"a","players":["a","b"],
           "squares":[{"row":0,"col":0,"value":"S","pencil":false,"state":"filled","owner":"a"}],
           "elapsed_ms":0,"timer_state":"paused"}]}
```
- Each list is optional.
- A text puzzle is processed exactly as `POST /api/puzzles` by its owner, so its bytes are stored too.
- Game players take colours in list order, and the host must be among them.
- A square `state` is one of `filled`, `pencil`, `wrong`, `right`, `revealed`.
- `timer_state` is `paused` or `running`. A running game whose players never connect pauses after the presence grace, like any game left at seed time.
- A player's `settings` is optional and, when given, holds all three settings.
- A game may add `"mode":"race"`, `"race_state":"lobby"|"racing"` and `"teams":{"<player key>":1|2}` (players left out are watching). In a race each seeded square adds `"team":1|2` for a square in that team's grid only, or leaves `team` out for a claimed square, whose state must be `right`. Each claimed square counts one point for its owner and the owner's team.

Response `201 {"players":{"a":{"id","display_name"}},"puzzles":{"p1":{"id"}},"games":{"g1":{"id","code","url":"/g/<code>"}}}`.

### Business rules (DP-14, DP-15, DP-18, DP-19, DP-20, DP-21, DP-24, DP-26, DP-27, DP-30, DP-33, DP-39, DP-40, DP-42, DP-44, DP-49, DP-52, DP-61, DP-63, DP-64, DP-65, DP-66, DP-68, DP-70, DP-71, DP-72, DP-73, DP-79, DP-80, DP-82, DP-83, DP-85, DP-86)

**Display names.** Trimmed, then 1 to 24 characters, both limits allowed. Characters are counted as user-perceived characters, so one emoji, even a joined family emoji, counts as 1. Control characters are refused. A refusal is 422 with `fields.display_name`.

**Colours.** A game's players take the first colour not yet used in the game, from the palette order in Visual design. A seat and its colour stay with the player for the life of the game, even while they are away.

**Who sees what.**
- A library puzzle is visible to everyone. An uploaded puzzle is visible to its uploader and to any player of a game on it.
- The host always has access to their game.
- Any other player has access while they have joined through the game's current active code. Opening the current link again restores a seat they already held.
- History entries and solve records belong to the player and stay reachable whatever happens to the game or its link.

**Game codes.** 12 characters from lowercase letters and digits, made by a secure random generator. The game link is `<APP_PUBLIC_URL>/g/<code>`, or the request origin when `APP_PUBLIC_URL` is unset.

**Link states.** `active → off` (Turn off link) and `active | off → active` with a fresh code (Replace link; the old code becomes replaced).
- Turning off a link that is already off is 409 `link_already_off`.
- Only the host may change the link; anyone else gets 403.
- When the link turns off or is replaced, every non-host player's open live connections get the `link_off` message and are closed, and those players lose access.
- The old code answers 410 `link_off` or `link_replaced` for ever.
- Link changes are allowed in every room state.

**Joining.**
- A player not yet in the game is refused with 409 `game_full` when the game already has `OVERLAP_MAX_PLAYERS` players (the host included), and with 409 `game_solved` when the game is solved.
- A player already in the game always rejoins.

**Room states.**
- `open`: created, nobody has connected yet. Timer paused at 0.
- `open → live` on the first live connection.
- `live → paused` when the presence grace lapses after the last connection closed.
- `paused → live` on any player's new live connection.
- `open | live | paused → solved` at the solving write. Writes through `POST …/ops` are accepted without a live connection and do not change presence.
- `solved` is final: it is read-only, every write is 409 `game_solved`, and the timer is frozen.

**Presence and timer** (`OVERLAP_HEARTBEAT_MS`, `OVERLAP_PRESENCE_GRACE_MS`).
- A player is present while at least one of their live connections is open. The server pings each connection every `OVERLAP_HEARTBEAT_MS` and treats a connection that has not answered by the next ping as closed. A tab whose live connection closes has left.
- Presence messages go out when a player goes from no connections to one (`present:true`) and from one to none (`present:false`).
- The timer runs exactly while the game is `live`.
- When the last connection closes, the server waits `OVERLAP_PRESENCE_GRACE_MS`. If nobody reconnects, the game becomes `paused`, and the open timer segment ends at the moment the last connection closed. The grace period is not counted. A reconnection within the grace keeps the segment running without a gap.
- A new segment starts when the game goes live again. The solving write ends the last segment.
- `elapsed_ms` is the sum of closed segments plus, while running, the time since the open segment started.
- Clients show the server's value. The display adds page-timer time since the last `elapsed_ms` received, only while `timer_state` is running, and never works out timer state from the device clock, which may be wrong.

**Derived values.**
- `<time>` is `elapsed_ms` rounded down to whole seconds. Under 3,600 seconds it is minutes without a leading zero, a colon and two-digit seconds (`0:07`, `12:04`). From 3,600 seconds it is hours, two-digit minutes and two-digit seconds (`1:02:09`).
- `<date>` is the UTC calendar date of `solved_at` as `YYYY-MM-DD`.
- `in_progress` is the number of distinct players with an open live connection to any unsolved game of that puzzle. The board refreshes it on load and every 10 seconds.

**Sequencing.**
- The server applies the writes of one game one at a time in arrival order. Each accepted cell, check or reveal write takes the next sequence number, starting at 1, and is broadcast in sequence order.
- For two writes to the same square, the one with the higher sequence number is the stored and shown value. A cell write always carries its whole entry, so a rebus is never mixed from two writes.
- A client may show its own letter at once, but it always adopts the broadcast value for that square.
- Refused writes take no sequence number.

**Replay keys.**
- A write with a `client_op_id` the same player has already used, and an identical body, returns the stored broadcast message with 200 and takes no new sequence number. Over the live connection the stored message is resent to the sender only.
- The same id with a different body is 409 `op_id_reused`.

**Rate limit.**
- More than `OVERLAP_LIVE_RATE` write and cursor messages from one player in any one-second window (all their connections and `POST …/ops` combined) are refused: 429 `rate_limited` over HTTP, or a live `error` with code `rate_limited`, sent at most once per second.
- Server pings and their answers do not count.

**Squares.**
- A cell write sets `value`, `pencil` and `owner` (the writer's colour), with `owner` null when the square is cleared.
- Any change to a `wrong` square clears the slash, and the state follows the new content.
- `right` and `revealed` squares are locked: every write to them is 409 `square_locked` and changes nothing.

**Check.**
- It applies to the filled squares in its scope that are not already `right` or `revealed`, pencil marks included. Squares already `right` or `revealed` keep their state and are not counted in the result.
- A square whose entry differs from the answer becomes `wrong`. A matching square becomes `right`, is locked, and loses its pencil flag. Empty squares are untouched.
- `wrong` in the result is the number of squares marked wrong.
- `checked_count` counts check writes.

**Reveal.**
- It writes the answer into each square in scope that is not already `right` or `revealed`, marks it `revealed` with the revealer as owner, and locks it.
- `revealed` in the result is the number of squares it changed.
- `revealed_count` is the number of squares whose state is `revealed`.

Check and reveal results are stored, broadcast to every player and kept after a reload. A solve after a reveal is still a solve.

**Player settings.** Each player has `skip_filled` (default true), `jump_next_clue` (default false) and `autocheck` (default false), stored in Postgres and shared by every tab and game of that player. The settings dialog shows the stored values and saves each change through the settings route.

**Autocheck.**
- When the server applies a cell write that is not pencil and has a non-empty value, and the writer's stored `autocheck` is true at that moment, it checks the square in the same step: an entry equal to the answer (ignoring case, a rebus matching its full string) becomes `right` and is locked; any other entry becomes `wrong`.
- Such a cell op, its broadcast and its replayed response carry `"autocheck":true` and the resulting state. Every other cell op carries `"autocheck":false`. Pencil writes and clears are never autochecked.
- Autochecked writes do not change `checked_count`, take no extra sequence number and announce nothing.
- Autocheck is ignored in race games.

**Clear.**
- A clear write is sequenced like a check. It takes a sequence number even when it clears nothing, and it is refused with `game_solved` in a solved game.
- A square's crossing word is its word in the other direction. A word is full when every one of its squares holds an entry; locked squares count.
- **Word:** the candidates are the word's squares that hold an entry and are not locked. A candidate whose crossing word is full is protected; a candidate with no crossing word is unprotected. When at least one candidate is unprotected, exactly the unprotected candidates are cleared. When every candidate is protected, every candidate is cleared.
- **Puzzle:** every square that holds an entry and is not locked is cleared.
- A cleared square gets `value` "", `pencil` false, state `empty` and owner null. `cleared` is the number of squares cleared, and the op's `squares` lists them in row-major order.
- In a race a clear changes only the clearer's team grid and reaches only that team, and only word clears are allowed: a puzzle clear is 422 `invalid` with `fields.scope`.

**Clue references.**
- A reference group is one or more clue numbers joined by `, `, ` and ` or `, and `, where the last number is followed directly by `-Across` or `-Down`, for example `17-Across`, `5 and 9-Down`, `3, 4 and 5-Down`. Each number in the group refers to the clue with that number in that direction. A number must not follow a letter or digit directly.
- A clue whose text starts with `*` is starred. A clue whose text contains `starred clues` refers to every starred clue other than itself.
- A reference from a clue to itself is ignored.
- A clue's linked clues are the clues it refers to together with the clues that refer to it, without repeats and without itself, in clue order.
- When word matching runs, each clue line is checked for references after the no-matching-word check and before the duplicate check, and reports its first bad reference, reading left to right.

**Race games.**
- A game's `mode` is `shared` or `race`, fixed at creation. A race has `race_state` `lobby` at creation, `racing` from the host's start and `finished` at the last claim.
- Every player of a race, the host included, starts on no team (watching). Team changes are allowed only in the lobby. A player who joins after the lobby watches.
- Each team has its own grid. A racer's cell and clear writes change only their team's grid, and their cell, clear and cursor messages reach only their team's players. Watchers receive no cell, clear or cursor messages.
- Race writes in the lobby are refused with `race_not_started`, and the room shows the race notice. A watcher's writes are refused with 403 `watching`.
- Check in a race takes scope `square` only and needs a filled square; Reveal and the other scopes are 422 `invalid`. A right check claims the square: in both teams' grids it takes the answer, state `right`, the claimer's colour as owner and pencil false, and it is locked; the claimer's `score` and their team's score each go up by 1, and the claim reaches every player. A wrong check marks the square `wrong` in the checker's team grid only.
- A right check is stored and broadcast as a `claim` op and message; a wrong check is an ordinary `check` op with `wrong` 1, reaching only the checker's team. `POST …/ops` answers with that message.
- Because a claimed square is locked in both grids, the later of two checks of the same square is refused with `square_locked`.
- When every white square is claimed, `race_state` becomes `finished`, the game becomes `solved` with the timer frozen, and every player sees `dialog "Race over"` with focus on its heading.
- The solve test of Solve does not apply to race games: a team grid full of right letters finishes nothing, and only the claim of the last white square finishes the race.
- Race games create no history entries and no solve record.

**Solve stats.** For each player of a solved game, in join order: `letters` is the number of squares in the final grid whose owner is that player's colour and whose state is not `revealed`, and `revealed` is the number of squares in the final grid whose state is `revealed` and whose owner is that player's colour. The solved dialog, the `solved` message, every history entry and tile, and the solve record (`"stats":[{"player_id","letters","revealed"}]`) show the same numbers.

**Builder rules.**
- The builder starts at 5x5, all white, with empty Title and Author, and symmetry None. The default symmetry for a size is None when columns times rows is below 49 and Rotational otherwise.
- A square's symmetry partners are: Rotational, the square at (rows-1-r, cols-1-c); Left-right, (r, cols-1-c); Top-bottom, (rows-1-r, c); Diagonal, (c, r); None, no partner. Toggling sets the selected square and its partner to the selected square's new state. Changing Symmetry changes no square.
- Numbering and words follow the Overlap text format rules, and they update after every change.
- Each word has one clue field. When numbering changes, a clue field keeps its text while a word in the same direction still starts at the same square; any other clue text is dropped.
- The builder keeps its draft in the page only. A reload starts a fresh 5x5 grid.
- The builder text is, with LF line endings and a final LF: `Overlap 1`, `Title: <title>`, `Author: <author>`, `Size: <cols>x<rows>`, a blank line, `Grid:`, one line per row of upper-case letters and `#`, a blank line, `Across:`, one `<number>. <clue>` line per Across word by number, a blank line, `Down:`, then one line per Down word by number. Title, author and clues are trimmed.
- Download text saves that text as `<name>.overlap.txt`, where name is the title in lower case with every run of characters other than a to z and 0 to 9 replaced by one hyphen, and leading and trailing hyphens removed, or `puzzle` when that leaves nothing.
- Save to my puzzles sends exactly that text as `POST /api/puzzles`. On success the status shows the saved copy and the puzzle is the caller's own upload. On a storage outage the band shows the builder outage copy and the draft stays exactly as it was.

**Solve.**
- After every accepted cell or reveal write, the game is solved when every white square's entry equals its answer. Comparison ignores case, a rebus must match its full string, and pencil entries count.
- The game is recorded as solved exactly once, in that write's step, even when two final writes race. Its `seq` is that write's sequence number.
- Every player of the game at that moment gets exactly one history entry.

**Overlap text format** (file extension `.overlap.txt`, UTF-8):

*Lines and blank lines*
- A leading byte-order mark is ignored. LF and CRLF line endings are both accepted.
- Trailing spaces on a line are ignored.
- Blank lines (empty or only spaces) are ignored everywhere, except that a blank line ends the grid block.

*Header*
- Line 1 is exactly `Overlap 1`.
- The next three non-blank lines are `Title: <text>`, `Author: <text>` and `Size: <cols>x<rows>`, in that order. Keys are case-sensitive, and each value is the trimmed text after the colon.
- Title is 1 to 80 characters and Author 1 to 60, counted like display names.
- Size uses digits and a lowercase `x`. Each side is from 3 to `OVERLAP_MAX_GRID`, both limits allowed, and grids need not be square.

*Grid block*
- The next non-blank line is `Grid:`. Exactly `<rows>` lines follow, up to a blank line or the `Across:` line.
- Each grid line holds `<cols>` squares. Each square is a letter A to Z (either case; the answer is stored in upper case), `#` for a black square, or `{<text>}` for a rebus square whose answer is 1 to 8 letters or digits.

*Clue blocks*
- Then comes an `Across:` line followed by Across clue lines, then a `Down:` line followed by Down clue lines up to the end of the file.
- A clue line is a number, a full stop, at least one space and the clue text, for example `12. Opposite of dusk`.
- Clue text is at most 300 characters, counted like display names; 300 is allowed.
- Clues may appear in any order within their block.

*Numbering and words*
- A word is a run of two or more white squares across or down. Every white square must belong to at least one word.
- Reading rows from top to bottom and squares from left to right, a white square gets the next number, starting at 1, when it starts an Across word (no white square to its left and a white square to its right) or a Down word (no white square above and a white square below).
- Every word has exactly one clue, and every clue has a word.

*Checking order*
- Validation runs on the submitted bytes and finds at most one problem per line: the first, reading left to right. Problems are listed by line number ascending, at most 20, and the heading counts all of them.
- Bytes that are not UTF-8, a wrong first line, or a missing or misplaced expected line stop checking at that line: no later line is checked.
- Title and Author length problems suppress nothing.
- Grid lines are checked in this order: bad character, then rebus content, then rebus not closed, then row length. A grid line's row-length problem is reported only when the line has no character or rebus problem.
- A bad Size (syntax or range) skips the row-length, row-count and orphan-square checks and the word-matching checks.
- The orphan-square check runs only when Size is good and no grid line has any problem and the row count is right. A grid line with an orphan reports its first orphan square, left to right.
- The word-matching checks are "clue without word" and "missing clues". They run only when Size is good and there is no grid problem at all (character, rebus, row length, row count or orphan square).
- Clue syntax, clue length and duplicate-clue checks always run on clue lines, whatever the grid's state. Each clue line is checked in this order: syntax, then length, then (when word matching runs) no matching word, then duplicate.
- A duplicate clue is the same number appearing twice in one block. The first occurrence is checked normally, and the duplicate problem is reported on the later line. A duplicated number still counts as having a clue for the missing-clue check.
- Parsing is deterministic: the same bytes always give the same puzzle JSON apart from `id` and `created_at`.

**Uploads.**
1. The size check (413) comes first.
2. Validation follows (422). An invalid file stores nothing.
3. A valid file is written to storage. If storage fails, the answer is 503 and no puzzle exists.
4. The object is read back, and the saved grid, numbering and clues are parsed from those stored bytes.

### Services (DP-41, DP-45, DP-48, DP-49, DP-86)

**Postgres** (`DATABASE_URL`) is the system of record for puzzles and their parsed grids and clues, players, games with their link codes and link state, seats and colours, the sequenced operation log, square state, presence, timer segments, finished games and history entries. The app applies its schema idempotently every time it starts serving, and creates the five library puzzles if they are missing.

**MinIO** (the `S3_*` variables; path-style addressing when `S3_FORCE_PATH_STYLE` is `true`) holds two kinds of object in `S3_BUCKET`, which the app creates if it is missing:
- **Uploaded originals** at `uploads/<puzzle id>/original.overlap.txt`: exactly the submitted bytes, stored with content type `text/plain; charset=utf-8`. The puzzle's `sha256` is the lowercase hex SHA-256 of those bytes. Library puzzles have no original.
- **Solve records** at `records/<game id>.json`: one object per solved game, written once and never rewritten. Its JSON is:
  ```
  {"format":"overlap-solve-record-1","game_id","puzzle_id","puzzle_title","cols","rows","solved_at",
   "elapsed_ms","revealed_count","checked_count",
   "players":[{"id","display_name","colour"}],
   "initial":[<square>,…],
   "final":[<square>,…],
   "ops":[<op>,…],
   "timer_segments":[{"started_at","ended_at"}],
   "stats":[{"player_id","letters","revealed"}]}
  ```
  `initial` is the squares as the game began, seeded squares included. `final` is every white square at the solve. `ops` and `timer_segments` equal `GET /api/games/<game id>/ops` and the game's `timer_segments` at the solve, and the segments sum to `elapsed_ms`.

  Replay steps through `ops`. `<n>` is the number of ops in the record. The dialog opens at step 0, which shows `initial`. Step `<k>` shows the grid after applying the first k ops in seq order (cell ops set value, pencil and state; check, reveal and clear ops apply their `squares`), and step `<n>` equals `final`. Next step adds one op and Previous step removes one. Previous step is disabled at step 0 and Next step is disabled at step `<n>`.

**When storage is unreachable:**
- Health answers 200 `{"status":"unavailable"}`. Storage is probed on each health request with a timeout of at most one second.
- Uploads answer 503 and create no puzzle.
- Download original and solve record downloads answer 503.
- A game that is solved during the outage is recorded as solved in Postgres immediately. Its history entries show `record_ready:false`, and the server retries the record write every 5 seconds and on every storage request, until one write succeeds.
- When storage returns, everything works again without a restart, and each deferred record is written exactly once.
- While any entry is pending, the history page refetches every 5 seconds on page timers.

### Seed data (DP-52, DP-55)

Every puzzle, clue, answer, constructor and player in the product is invented. At start there are no players, games or uploads. The library holds five puzzles, in this board order:

| Fixture slug | Title | Author | Size |
|---|---|---|---|
| `morning-kettle` | Morning Kettle | Wren Halloway | 5x5 |
| `night-shift` | Night Shift | Jun Okafor | 5x5 |
| `harbour-lights` | Harbour Lights | Odile Marsh | 7x7 |
| `quiet-orchard` | Quiet Orchard | Tobias Fenn | 9x9 |
| `long-table` | Long Table | Priya Castellane | 15x15 |

Morning Kettle, as an Overlap text file (line numbers are shown for reference and are not part of the file):
```
 1 Overlap 1
 2 Title: Morning Kettle
 3 Author: Wren Halloway
 4 Size: 5x5
 5
 6 Grid:
 7 SCONE
 8 T#V#N
 9 EJECT
10 A#N#E
11 MISER
12
13 Across:
14 1. Crumbly bake served with jam
15 4. Push the tape out of the deck
16 5. One who hoards every coin
17
18 Down:
19 1. What rises from a kettle spout
20 2. Hot boxes that bake the bread
21 3. Step inside, or key in data
```
Its words: 1 Across SCONE, 4 Across EJECT, 5 Across MISER, 1 Down STEAM, 2 Down OVENS, 3 Down ENTER. Numbers sit at row 0 column 0 (1), row 0 column 2 (2), row 0 column 4 (3), row 2 column 0 (4) and row 4 column 0 (5). Black squares are at (1,1), (1,3), (3,1) and (3,3).

Night Shift has the same shape with a rebus in its first square:
```
Overlap 1
Title: Night Shift
Author: Jun Okafor
Size: 5x5

Grid:
{STAR}LING
S#O#U
HOTEL
I#A#L
POSTS

Across:
1. Speckled songbird that gathers in murmurations
4. Place to stay with a front desk
5. Fence uprights

Down:
1. Vessel bound for other planets
2. Tiny amounts, or Greek letters
3. Seaside birds that steal chips
```
Its words: 1 Across STARLING (STAR + L, I, N, G), 4 Across HOTEL, 5 Across POSTS, 1 Down STARSHIP, 2 Down IOTAS, 3 Down GULLS.

You write Harbour Lights, Quiet Orchard and Long Table yourself. Each must be an original, valid puzzle in the Overlap text format: black squares placed with rotational symmetry, every answer an ordinary English word or phrase, and every clue newly written. Long Table contains at least one rebus square.

## Technical requirements

### Deployment (DP-51)

- Node.js 22 with npm is available, and the app is written in TypeScript.
- `/app/run.json` holds string commands and the schema tag, for example:
  ```
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```
- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. The page, the API and the live connection share that one port.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` when storage is reachable. The unavailable answer is owned by Services.

### Configuration and secrets (DP-52, DP-60, DP-78)

Every value below is read from the environment at start. None is hard-coded, and none is ever sent to the browser except through the config route's public numbers.

**Services:** `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`.

**Tunables** (whole numbers; an unset or unreadable value uses the default):

| Variable | Meaning | Default |
|---|---|---|
| `OVERLAP_PRESENCE_GRACE_MS` | grace before the timer pauses, milliseconds | 15000 |
| `OVERLAP_HEARTBEAT_MS` | live ping interval, milliseconds | 5000 |
| `OVERLAP_UPLOAD_MAX_BYTES` | largest upload, bytes; the limit itself is allowed | 65536 |
| `OVERLAP_MAX_GRID` | largest grid side, squares | 25 |
| `OVERLAP_MAX_PLAYERS` | players per game, host included | 8 |
| `OVERLAP_LIVE_RATE` | write and cursor messages per player per second | 30 |
| `OVERLAP_TOAST_MS` | game notice lifetime, milliseconds | 4000 |
| `OVERLAP_REPLAY_STEP_MS` | replay autoplay interval at 1x, milliseconds | 500 |
| `OVERLAP_GRADING` | `1` enables `/api/grading/*`; any other value makes those routes 404 | unset |

The client reads its tunables from `GET /api/config` at load. Every grading instance runs with `OVERLAP_GRADING=1`.

### Server boundary (DP-54)

- **Same origin.** The app serves the page and the API from one origin and sends no cross-origin permission headers. A live connection whose `Origin` header does not match the app's own host is refused with 403 at the upgrade.
- **Sizes.** JSON bodies are limited to 16,384 bytes and uploads to `OVERLAP_UPLOAD_MAX_BYTES`; each answers 413 `too_large` when exceeded. A live message over 4,096 bytes closes that connection with code 1009.
- **Never served:** source files, source maps, `run.json`, package manifests and lockfiles, environment files, and anything outside the built client. Such paths answer 404, and so does any path containing `..`.
- **Downloads** stream through the app. The browser never talks to storage directly and never receives a storage URL or key.
- **Boot.** The server starts and serves even when object storage is unreachable at boot, and recovers when storage returns, as owned by Services. If Postgres is not yet reachable, the server retries every second and applies its schema once it connects.

### Browser support and performance (DP-07, DP-09, DP-16)

- **Browsers:** current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800.
- **Clocks.** Every client timer (timer display, notices, the Pivot band phases, reconnect delays, board and history refreshes) uses page timers, so a paused or shifted page clock controls them. The app registers no service worker.
- **Speed.** The room is usable within three seconds of opening. Live changes from other players appear within two seconds without a reload.
- **Polling.** Any polling the client does runs on page timers, at most once a second.

## Working rules

- IF-01: `/app/run.json` is valid JSON with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) with its licence, plus the bundled Albert Sans font files and their licence.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, and the bundled fonts are OFL-1.1.
- IF-04: The only datastores are the provided Postgres and MinIO: no SQLite, no data files on disk, and no other database, cache, queue or search service.
- IF-05: Served pages load nothing from another host: fonts, scripts, styles, images and icons all come from the app's own origin.
- IF-06: The app is TypeScript for both server and client, with a committed `package-lock.json`.
- IF-07: The provided development service definitions and their credentials are left unchanged, and the app reads every value from the environment.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript. Domain names in the code match this brief's terms: puzzle, game, square, word, clue, op, seq, presence, timer segment, solve record, link code.
- Each domain rule is decided in exactly one place in the source: numbering, the auto-advance rule, the solve test, the timer arithmetic, the link access check, the error precedence, time formatting, the autocheck, the race claim, the Clear word protection rule, the builder text and the replay step.
- Every API error is produced through one error shape with the published codes. No route invents its own error body.
- There is no dead, commented-out or unreachable code, and no abstraction with a single implementation.
- There are no defensive checks for states the rules make impossible. Inputs are validated once, at the boundary.
- Writes for one game are serialized by the server in one obvious way, and every broadcast comes from the stored result rather than the request.
- The code implements no features beyond this brief.
