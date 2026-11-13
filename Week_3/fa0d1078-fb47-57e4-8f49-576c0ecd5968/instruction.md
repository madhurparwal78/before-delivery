# Maison Neuf Seam

Seam is a puzzle house by Maison Neuf for people who solve every day. It has no ads. Players solve 9x9 puzzles at four levels (Easy, Medium, Hard, Expert) by keyboard, mouse or touch. They can pencil in notes, undo and redo, erase, and ask for hints, and each game has a mistake limit. Players also solve a daily challenge on a calendar with streaks, appear on a live daily leaderboard, and duel a friend live from a six-character room code. Build it as one TypeScript Node server and one browser client. The server stores everything in Postgres. Valkey runs the live duel rooms, the live leaderboard ranking and fan-out, and the join limits. Mailpit delivers the email confirmation and password-reset messages. Live updates use one WebSocket that the app server serves on its own port. Sign-in is email and password only, built into the app. Out of scope: AI hints, ads, sound, outside sign-in providers or sign-in links, paid plans, puzzle generation, printing, friends lists, chat, push reminders, offline play, service workers, and any datastore or service besides these three.

## Problem and users

People who solve number puzzles daily keep a streak and a table of best times, but the big apps treat both as disposable. Players complain about ads between and during games, about hints bought by watching ads that later disappear, and about streaks lost after a puzzle they did finish, or lost around midnight. To duel a friend they often need a second app. The opponent's digits are often visible, and a dropped connection ends the match with no explanation. A player also cannot check that a "unique" puzzle really has only one solution. In Seam every puzzle is a published fixture with exactly one solution. The server owns the daily calendar, streaks, results and the leaderboard. Before a finished game counts, the server replays its move log against the stored solution. When a service fails, Seam says so plainly and solo play keeps working.

- **Solver**, daily: plays timed games at four levels with notes, undo, erase, hints and a mistake limit, by keyboard, mouse or touch. After a reload they still have their finished games, best times and per-level statistics.
- **Daily regular**, daily: solves the date's daily challenge before the day ends, keeps the streak, and watches their result appear on the daily leaderboard as other players finish.
- **Duelist**, weekly: opens a room, gives a friend the room code, and plays the same puzzle at the same moment while watching the friend's progress live. They get a fair result even after a page reload.

## Journeys

1. **Keyboard solve.** Start: a signed-in solver on `/play/<id>` with a game in progress. They move with the arrow keys, type digits, toggle notes mode with N, erase, undo and redo, and pause with P. When the last cell is correct, the board shows the checking message. Then the solved sequence plays and the `Puzzle solved` dialog opens with focus on `New game`.
2. **Mistakes and the second chance.** Start: a game with two mistakes. A third wrong digit opens `Game over`. `Second chance` removes that digit, and play continues at one below the limit. Another wrong digit ends the game for good, and after a reload the profile lists it as `Lost`.
3. **Hints.** Start: a fresh Medium game. Each H fills the cell the hint rule picks and moves the selection there. After the last hint, the `Hint` button is disabled.
4. **Phone play.** Start: a phone 390 px wide. The solver taps cells and the number pad under the board, switches to notes by tap, and finishes by touch.
5. **Daily and streak.** Start: a daily regular with the two previous dates solved. They open today from `/daily` by keyboard and solve it two minutes before midnight in the day zone. The streak reads three days. A second regular who finishes the same daily one minute after midnight gets a late result and a streak of zero.
6. **Live leaderboard.** Start: two verified regulars, each with today's leaderboard open in a browser. When one finishes the daily, the other page updates within two seconds and announces the new rank. An unverified regular appears only after opening the confirmation message.
7. **Duel.** Start: two verified duelists. One creates a room at a level, and the other joins with the code. Both press `Ready`, the server counts down, and both boards appear at once. Each player watches the other's progress bar and mistakes, never their digits. One reloads mid-duel and gets their board back. The server announces the winner.
8. **Verified results.** Start: a solver who finishes a game. A finish whose log was changed in transit is refused with its code and counts nothing. The honest finish counts once. After a reload, the profile tabs show numbers equal to a recount.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Board grid** The board is one grid of 81 cells carrying the published cell attributes, with exactly one cell in the Tab order.
- **DP-02 — Keyboard movement** Arrow keys, Home and End move the selection with the published wrapping, and focus follows the selection.
- **DP-03 — Cell labels** Every cell's accessible name follows the published label pattern and changes with its contents.
- **DP-04 — Keyboard finish journey** A solver completes a game by keyboard alone, sees the checking message, and lands in the Puzzle solved dialog with focus on New game.
- **DP-05 — Entries and notes** Entering a digit or toggling a note follows the Moves rules, including clearing an entered digit from its 20 peers' notes.
- **DP-06 — Undo and redo** Undo and redo restore and re-apply each enter, note and erase exactly, including the peer notes an entry removed.
- **DP-07 — Erase and locked cells** Erase removes only wrong entries and notes, and given, hinted and correct cells refuse changes with their messages.
- **DP-08 — Notes and undo journey** A solver uses notes mode, enters a digit, undoes and redoes by keyboard, and sees the board and labels return exactly.
- **DP-09 — Mistake limit** Each wrong entry raises the mistake count, and reaching the limit ends the game with the Game over dialog.
- **DP-10 — Second chance** The one second chance per game removes the entry that reached the limit, restores its notes and lowers the count by one.
- **DP-11 — Mistakes journey** A solver goes from a wrong digit through Game over and the second chance to a final loss shown as Lost in the profile after reload.
- **DP-12 — Hint choice** Each hint fills the cell with the fewest candidates, ties broken by row then column, with its solution digit.
- **DP-13 — Hint limit and locks** A game allows HINT_LIMIT hints, hinted cells lock, and the Hint control is disabled when none are left.
- **DP-14 — Hints journey** A solver asks for every hint by key and sees each filled cell, the selection, the announcement and the final no-hints state.
- **DP-15 — Highlights** Every cell's highlight tokens follow the selected cell's row, column, box and value in the published order, whether the selection came from the keyboard, a click or a tap.
- **DP-16 — Highlight journey** A solver moves the selection by keys, click and tap, watches the highlights follow entries, erases and undos, and sees them clear while paused.
- **DP-17 — Game clock** The timer counts active time only, in the published format, starting from the game's saved time.
- **DP-18 — Pause and auto-pause** Pausing by key, button, window blur or a hidden page covers the board, and only P or Resume restarts play.
- **DP-19 — Score** A won game's score follows the published formula and its floor.
- **DP-20 — Solved animation** A verified win staggers one animation across all cells before the Puzzle solved dialog opens, and reduced motion skips it.
- **DP-21 — Timed finish journey** A solver pauses, is paused automatically, resumes and finishes, and sees the published time, score and solved sequence.
- **DP-22 — Number pad** The on-screen pad enters digits or notes and shows each digit's remaining count, disabling digits with none left.
- **DP-23 — Phone layout and targets** Below 768 px wide the pad and controls sit under the board at the published width, with 44 px targets and no sideways scroll.
- **DP-24 — Touch play journey** A solver on a 390 px phone plays and finishes a game by touch alone, with the pad under the board.
- **DP-25 — Daily puzzle and calendar** Each date has one published daily puzzle, and the calendar shows every date's state as the server reports it.
- **DP-26 — Streaks by server date** On-day results, late results and streaks are decided by the server clock in DAILY_TZ, never by the device.
- **DP-27 — Calendar keyboard** The calendar is one Tab stop, arrow keys move by day and week, and Enter or Space opens an open date's game.
- **DP-28 — Daily streak journey** Daily regulars finishing before and after midnight in the day zone see the published streaks and the late state.
- **DP-29 — Leaderboard ranking** The daily leaderboard lists verified on-day results in the published order, with shared ranks.
- **DP-30 — Leaderboard privacy** Leaderboard rows and their API carry only the published fields and never an email.
- **DP-31 — Live leaderboard** An open leaderboard page shows a newly verified result within 2 seconds without a reload and announces it, as qualified in Leaderboard.
- **DP-32 — Leaderboard journey** Daily regulars watch the board update live across two browsers, an unverified player appears only after confirming their email, and the outage instance shows stored results.
- **DP-33 — Duel rooms** Verified players create rooms at a level with a six-character code that expires if the duel never starts.
- **DP-34 — Second seat** A room has two seats, and when several players join at once exactly one takes the second seat.
- **DP-35 — Join limit** Failed joins are limited per player, with the published code, message and wait.
- **DP-36 — Server countdown** When both players are ready, the server runs the countdown and starts both boards at the same moment.
- **DP-37 — Opponent progress** Each duelist sees the opponent's name, progress and mistakes, and never their digits, notes or selection.
- **DP-38 — Duel results** The server decides win, loss, tie, out and forfeit, and each player sees the published result for their side.
- **DP-39 — Duel journey** Two duelists create, join, get ready, play the same puzzle while watching each other's progress, and see the result.
- **DP-40 — Reload window** A duelist who reloads or drops within the reload window gets their board back, and after it the opponent wins by forfeit.
- **DP-41 — Duel outage** When Valkey is unreachable, duels are refused with the published notice while solo and daily play continue.
- **DP-42 — Rejoin journey** Duelists on the short-timer instance see the reconnecting and back notices, a forfeit and a tie, and the outage instance shows the duel notice.
- **DP-43 — Move log replay** Every finish is replayed from the start board and refused with the first failing code in the published check order.
- **DP-44 — Finish counts once** A game's finish counts once, a resend of the same log returns the same result, and a different log is refused.
- **DP-45 — Progress saving** Every move and pause is saved, and a reloaded game opens at the saved board and time.
- **DP-46 — Statistics from finished games** Per-level statistics, best times and the finished-games list equal a recount of the stored finished games after reload.
- **DP-47 — Private games** Another player's game gets the same not-found page and code as a game that does not exist.
- **DP-48 — Verified results journey** A tampered finish is refused and not counted, an honest one counts once, and the profile tabs show the recount after reload.
- **DP-49 — Sign-up and verification** A new account counts as verified only after its confirmation message, accepted by Mailpit, is opened.
- **DP-50 — Password reset** A reset message from Mailpit sets a new password once, before it expires, and signs out every other session.
- **DP-51 — Mail outage** When Mailpit is unreachable, the forms show the published notices and nothing counts as sent.
- **DP-52 — Hem thread** The hem thread's stitch count equals the player's correct non-given cells and animates as published, with the reduced-motion path.
- **DP-53 — Announcements** One polite live region on every page announces each published sentence, repeated sentences included.
- **DP-54 — Pages and landmarks** Every page has one top-level heading, a main landmark and the Main navigation, keeps focus inside open dialogs, and never scrolls sideways from 320 to 1440 px.
- **DP-55 — Platform and health** The app runs from the run manifest on the published port and answers the health check on every instance.
- **DP-56 — Grading routes** The grading routes create players, games and results and set the server clock exactly as published.
- **DP-57 — Server boundary** The server accepts only same-origin requests within the body limits, serves only the app's built assets, and the page loads nothing from other hosts.
- **DP-58 — Couture look** Every screen sets the board and lists on charcoal tiles on a full red field in Gloock and Rethink Sans, as Visual design describes.
- **DP-59 — Home specimen** The home page presents the four levels as a garment-style name list, with a real puzzle specimen of the chosen level and its clue count.
- **DP-60 — Real services and secrets** Every service credential and URL is read from the environment, and each stored or delivered effect lives in its named service.

## Frontend

### Screens and layout (DP-23, DP-54, DP-58, DP-59)

Every page has one top-level heading, a `main` landmark and a `nav` named `Main`. No page scrolls sideways at any width from 320 to 1440 px. The three reference viewports are 375x812, 768x1024 and 1280x800.

- **Home `/`**: the wordmark `Seam` large at the top left. Below it is the name list of the four levels. Beside it (below it under 768 px) is the specimen tile, and the fact line sits under the tile. The Main navigation links sit at the bottom left. At 1280 the list and tile share one row. At 768 and 375 they stack: wordmark, list, tile, fact line, links.
- **Play `/play/<id>`**: the board on its charcoal plinth with the hem thread running around its edge. From 768 px wide, the timer, mistakes, hints left, the six controls and the number pad sit in a column to the right of the board. Below 768 px they sit under the board in this order: timer, mistakes and hints on one line, then the controls, then the number pad (a 3 by 3 block). Below 768 px the board is as wide as the viewport minus 32 px, and never wider than 480 px.
- **Daily `/daily`**: the calendar tile with the month name and the previous and next month buttons above it, and the two streak lines beside it (below it under 768 px).
- **Leaderboard `/leaderboard/<date>`**: one table of flat rows. Under 768 px the `Mistakes` and `Hints` columns stay in the table and the table scrolls inside its own tile, never the page.
- **Duel `/duel`**: the level choice, `Create room`, then the code field and `Join room`, stacked on one tile.
- **Room `/duel/<CODE>`**: before the start, the seat list and the `Ready` button. During play, the board with the same layout as Play, plus the opponent's progress bar, mistakes and thread beside your own (under the board below 768 px). The Hint and Pause buttons are not shown in a duel.
- **Profile `/profile`**: the level tabs above their statistics panel, and the finished-games table below.
- **Account pages** `/signin`, `/signup`, `/verify/<token>`, `/reset`, `/reset/<token>`: one tile holding the form or the result sentence.
- **Not-found page**: a sentence in large serif type on the red field (see Messages).

### Public screens and controls (DP-01, DP-13, DP-15, DP-17, DP-22, DP-25, DP-29, DP-33, DP-37, DP-46, DP-52, DP-54)

Only the roles, names and ids below are public. Names never change with state: state lives in `aria-pressed`, `aria-disabled` or `disabled`, `aria-selected`, or a `data-` attribute. Placeholders: `<Level>` is `Easy`, `Medium`, `Hard` or `Expert`; `<Month> <d>, <yyyy>` is an English date such as `November 3, 2026`; `<Name>` is a player's display name.

| Where | Role and accessible name | Visible copy and attributes |
|---|---|---|
| Every page | `nav` named `Main` | links `Seam` (home), `Daily`, `Duel`, `Leaderboard`, `Profile`; signed in also a button `Sign out`; signed out links `Sign in` and `Create account` instead |
| Every page | `#announcer`, `role="status"`, `aria-live="polite"` | announcements (see Messages) |
| Every page, unverified player | `region` named `Email confirmation` | message M44 and a button `Send again` |
| Home | buttons `New Easy game`, `New Medium game`, `New Hard game`, `New Expert game` | visible text is the level name in large serif type, with a small `New game` caption beside the level being previewed |
| Home | `img` named `Specimen: <Level> puzzle`, id `#specimen`, `data-level="easy|medium|hard|expert"` | a mini-grid drawn from that level's fixture number 1 |
| Home | `#specimen-clues` | `<givens> clues`, the givens count of that fixture |
| Play | `h1` | `<Level> game` for solo, `Daily, <Month> <d>, <yyyy>` for a daily, `Room <CODE>` in a duel |
| Play | `grid` named `Puzzle board`, id `#board` | see The board |
| Play | `timer` named `Time`, id `#timer` | `MM:SS`, or `H:MM:SS` from one hour (`09:41`, `1:02:05`) |
| Play | `#mistakes` | `Mistakes: <n>/<limit>`, where `<limit>` is `MISTAKE_LIMIT` |
| Play, solo and daily | `#hints-left` | `Hints left: <n>` |
| Play | buttons `Undo`, `Redo`, `Erase`, `Notes` (`aria-pressed`), `Hint`, `Pause` | same text; `Hint` and `Pause` are absent in duels |
| Play | `group` named `Number pad`, buttons `Digit 1` to `Digit 9` | visible digit; `data-remaining="<0-9>"` (defined in Interactions); `disabled` when it is `0` |
| Play | `img` named `Your thread: <n> stitches` (`1 stitch` when n is 1), id `#hem`, `data-stitches="<n>"` | the thread; `#hem-count` shows `<n>` as text |
| Play | `dialog` named `Paused` | message M14, button `Resume` |
| Play | `alertdialog` named `Game over` | message M11 or M12; buttons `Second chance` (only while it is unused) and `New game` |
| Play | `dialog` named `Puzzle solved` | message M18; buttons `New game` and `View profile` |
| Play | `alertdialog` named `Not counted` | message M20; button `Close` |
| Daily | `h1` | `Daily challenge` |
| Daily | `grid` named `<Month> <yyyy>`, id `#calendar` | header row `Mon` to `Sun`; date cells `role="gridcell"` with `data-date`, `data-state` and `aria-label` (see Daily challenge) |
| Daily | buttons `Previous month`, `Next month` | `Next month` has `aria-disabled="true"` on today's month; `Previous month` has `aria-disabled="true"` on the `DAILY_START` month (see Daily challenge) |
| Daily | `#streak`, `#best-streak` | `Current streak: <n> days` and `Best streak: <n> days`, `day` when n is 1 |
| Leaderboard | `h1` | `Daily leaderboard` |
| Leaderboard | `table` named `Daily leaderboard, <Month> <d>, <yyyy>` | columns `Rank`, `Player`, `Time`, `Score`, `Mistakes`, `Hints`; each body row has `data-player="<Name>"`, and the viewer's own row has `aria-current="true"` |
| Leaderboard | `#leaderboard-notice` | messages M45, M47 or M48 when they apply |
| Duel | `h1` | `Duel` |
| Duel | `radiogroup` named `Level`, radios `Easy`, `Medium`, `Hard`, `Expert` (Easy checked at start) | same |
| Duel | button `Create room`, `textbox` named `Room code`, button `Join room` | same; field errors show under the textbox |
| Duel | `#duel-notice` | message M40 when Valkey is down |
| Room | `list` named `Seats` | one item per seat: the display name, or message M32 for an empty seat |
| Room | button `Ready` (`aria-pressed`) | `Ready` |
| Room | `#countdown` | message M33 |
| Room | `progressbar` named `Your progress` and `progressbar` named `<Name>'s progress` | `aria-valuemin="0"`, `aria-valuemax` = empty cells at the start, `aria-valuenow` = correct entries; text `<Name>: <correct> of <empty>` (`You: <correct> of <empty>` on your own) |
| Room | `#opponent-mistakes` | the `#mistakes` format, for the opponent |
| Room | `img` named `<Name>'s thread: <n> stitches`, id `#hem-opponent`, `data-stitches` | the opponent's thread |
| Room | `dialog` named `Duel over` holding `#duel-result` (`role="status"`) | messages M34 to M39; button `Back to duels` |
| Profile | `h1` | `Profile` |
| Profile | `tablist` named `Levels`, tabs `Easy`, `Medium`, `Hard`, `Expert`, each with a `tabpanel` | each panel is a description list of the terms `Games started`, `Games won`, `Win rate`, `Best time`, `Average time`, `Best score` and their values |
| Profile | `table` named `Finished games`, id `#finished-games` | columns `Date`, `Level`, `Result`, `Time`, `Score` |
| Sign up | fields `Email`, `Display name`, `Password`; button `Create account` | `h1` `Create your account` |
| Sign in | fields `Email`, `Password`; button `Sign in` | `h1` `Sign in` |
| Reset request | field `Email`; button `Send reset link` | `h1` `Reset your password` |
| Reset link | field `New password`; button `Save password` | `h1` `Choose a new password` |
| Confirm link | result sentence | `h1` `Confirm your email` |
| Every form | `alert` with the heading `Check these details` | one link per invalid field; activating a link moves focus to that field |

### The board (DP-01, DP-03)

- A board string is 81 characters, row by row from row 1 column 1 to row 9 column 9, with `0` for an empty cell. Cell names are `r<row>c<column>`, with rows and columns numbered 1 to 9 from the top left (`r4c3` is row 4, column 3). Boxes are numbered 1 to 9 left to right, top to bottom (`r4c3` is in box 4). A cell's peers are the 20 other cells in its row, column and box.
- `#board` holds 9 children with `role="row"`, each holding 9 cells with `role="gridcell"`. Exactly one cell, the selected one, has `tabindex="0"`; every other cell has `tabindex="-1"`, so the board is a single Tab stop.
- Each cell carries `data-cell="r<row>c<column>"`, `data-given="true|false"`, `data-value="<digit>"` (or `""` when empty), `data-notes` (the cell's notes ascending, separated by single spaces as in `"1 4 9"`, or `""`), `data-wrong="true|false"`, `data-hinted="true|false"`, `aria-selected="true|false"` (exactly one `true`) and `data-highlight` (see Highlights).
- Each cell's `aria-label` is `Row <r>, column <c>, ` followed by: `given <d>` for a given; `empty` for an empty cell without notes; `empty, notes <d> <d>` with every note ascending and separated by single spaces for an empty cell with notes; `<d>` for a correct entry; `<d>, wrong` for a wrong entry; `<d>, hint` for a hinted cell. Example: `Row 3, column 7, empty, notes 1 4 9`.
- When a game opens, also after a reload, the selected cell is the first empty cell in reading order.
- `#board` has `data-state` set to `playing`, `paused`, `lost` or `won`. While paused, every cell's `data-value` and `data-notes` are `""`, its label is `Row <r>, column <c>, hidden`, and the board has `aria-hidden="true"`.

### Keyboard (DP-02, DP-04, DP-27, DP-43)

Shortcuts work while focus is anywhere on the play page, buttons included, except in a text input and while a dialog is open. Keys match on the key's character, so `n` and `N` both toggle notes, and `h`/`H` and `p`/`P` behave alike.

| Key | Effect |
|---|---|
| ArrowUp, ArrowDown, ArrowLeft, ArrowRight | Move the selection one cell. Movement wraps within the same row or column: ArrowRight on column 9 goes to column 1 of the same row, ArrowDown on row 9 goes to row 1 of the same column, and the reverse. Focus follows the selection |
| Home, End | Column 1 or column 9 of the same row |
| 1 to 9 (top row or numeric keypad) | Enter that digit (normal mode), or toggle that note (notes mode), in the selected cell |
| N | Toggle notes mode (the `Notes` button's `aria-pressed`) |
| Delete, Backspace | Erase the selected cell |
| Ctrl+Z (Cmd+Z on macOS) | Undo |
| Ctrl+Shift+Z or Ctrl+Y (Cmd+Shift+Z on macOS) | Redo |
| H | Hint |
| P | Pause; when paused, resume |

While the game is paused, only P resumes; Tab moves within the `Paused` dialog. In a duel, H and P change nothing and announce M30 and M31.

### Highlights (DP-15, DP-16)

- `data-highlight` on each cell is a space-separated list of tokens in this order: `row`, `column`, `box`, `same-digit`. The selected cell has `data-highlight="selected"`.
- For the selected cell S, a cell in S's row gets `row`, a cell in S's column gets `column`, and a cell in S's box gets `box` (a cell in both S's row and box gets `row box`). If S holds a value (a given, an entry, a hint, or a wrong entry), every other cell holding the same value also gets `same-digit`, after any other tokens. A cell with no token has `data-highlight=""`.
- The tokens follow every selection change by keyboard, click or tap, and update when S's value changes by an enter, erase, undo, redo or hint.
- While the board is paused, lost or won, every cell has `data-highlight=""`.

### Interactions (DP-04, DP-15, DP-18, DP-22, DP-24, DP-27, DP-46, DP-54, DP-59)

- **Board**: clicking or tapping a cell selects it and moves focus to it. Tapping a `Digit` button acts like typing that digit; tapping `Notes` toggles notes mode. Nothing needs a long press or a swipe. Each `Digit` button's `data-remaining` is 9 minus the number of cells holding that digit as a given, a hinted cell or a correct entry, with grading-seeded entries included. Wrong entries and notes do not count. The value updates after every enter, erase, undo, redo, hint and second chance, and it keeps its last value while the game is paused. In a duel it counts your own board as the server's `you` message reports it. Example, with `easy-1` at its start: `Digit 5` has `data-remaining="3"` because the board has six given 5s. A wrong 5 in `r1c1` leaves it at 3, and a correct 5 in `r5c9` makes it 2. A pad button with `data-remaining="0"` is disabled, but its key still enters that digit.
- **Dialogs**: while any dialog is open, Tab and Shift+Tab wrap within it and never reach the page behind. `Puzzle solved`, `Not counted` and `Duel over` close on Escape. `Paused` and `Game over` ignore Escape. When a dialog closes, focus returns to the board's selected cell (or, for `Duel over`, to the opener) unless the button chosen leaves the page.
- **Dialog buttons**: `New game` starts a new solo game at the same level (a daily counts as Medium) and opens it. `View profile` opens `/profile`. `Close` closes `Not counted` and leaves the game as the server holds it. `Back to duels` opens `/duel`.
- **Home**: every time Home opens, Easy is previewed. For example, `#specimen` has `data-level="easy"` and `#specimen-clues` shows `40 clues`. Hovering or focusing a level button previews that level: the specimen tile changes to that level's colour, it redraws that level's mini-grid, and the fact line updates. The preview stays on the last hovered or focused level after the pointer or focus leaves, until another level button is hovered or focused. Activating the button creates the game and opens `/play/<id>`. Starting a new solo game at a level abandons the player's `playing` solo game at that level. A lost game at that level that is still open becomes closed instead (see Mistakes).
- **Profile tabs**: Left and Right move between tabs and select them at once. Home and End go to the first and last tabs. Only the selected tab is in the Tab order.
- **Calendar**: see Daily challenge.
- **Room code field**: accepts lower case letters, ignores spaces and hyphens, and shows the code in upper case. Enter in the field joins.
- **Signed-out visitors**: every page except `/`, `/signin`, `/signup`, `/verify/<token>`, `/reset` and `/reset/<token>` sends a signed-out visitor to `/signin`. After signing in they return to the page they asked for. On Home, a level button sends a signed-out visitor to `/signin`.

### Visual design (DP-58, DP-59)

- **Direction**: a borrowed category. Seam presents itself the way a couture house presents a collection. A full, saturated carmine red fills the page from floor to ceiling on every screen. One object sits on a near-black charcoal plinth tile in the centre. Names are listed the way a collection lists its garments. Home has five sections: the wordmark, the name list, the specimen tile, the fact line, and the links.
- **Palette in words**: the ground is a deep, saturated carmine red, and secondary surfaces are a slightly darker carmine. Ink is white. Muted text is a pale pink. The accent is a very pale blush pink, and type set on the accent is carmine. The board and list tiles are near-black charcoal.
- **Type**: Gloock, a high-contrast serif, for the wordmark, headings, board numerals and the maison-voice sentences. Rethink Sans for body text, labels, notes and the clock, with figures of equal width so the clock does not jitter. Each heading step is a quarter larger than the step below it. The wordmark is the largest thing on the page.
- **Mood and density**: couture-calm with few words, stitch-sized details and comfortable spacing. There is generous red space around each tile, and nothing is crowded.
- **Home hero**: a single specimen with a name list. The level names are stacked in large Gloock like garments in a programme. The previewed level's tile takes its own shade (Easy blush, Medium pale pink, Hard charcoal, Expert the darker carmine), and the white or carmine mini-grid inside it shows a real puzzle of that level. The one action caption reads `New game`. The links sit bottom left.
- **Working screens**: the board is a charcoal plinth with white Gloock numerals; given digits are heavier than entered ones. Notes are small Rethink Sans numerals in pale pink. Lists (finished games, statistics, leaderboard) are flat rows with no ruled lines. Rows alternate between charcoal and the darker carmine in blocks. Tiles have clearly rounded corners. Buttons have square corners: blush blocks with carmine type. Empty, loading and error states are single Gloock sentences on the red field.
- **Highlights without colour alone**: the row, column and box get a faint blush tint. The selected cell also has a stitched outline (short dashes like a tacking stitch). Matching digits carry a stitched underline. Wrong entries carry a small diagonal stitch mark as well as a pale pink tint. Hinted digits carry a small knot dot under the numeral.
- **Hem thread look**: a thread runs along the board's outer edge. Your stitches are blush; the opponent's thread runs just outside yours in white.
- **Targets and contrast**: number pad and control buttons are at least 44 by 44 px at every width. All text and focus outlines meet WCAG 2.2 AA contrast against their ground. Focus is a visible white stitched outline.
- **Not used**: no paper or cream grounds, hairline rules, monospace labels, index numbering or glass effects.

### Motion and effects (DP-20, DP-52)

- **Hem thread (the signature)**: each correct entry adds one stitch. A mistake adds none. The new stitch draws onto the thread over 240 milliseconds, starting quickly and settling gently. Each draw is one browser animation on an element inside `#hem` (or `#hem-opponent`), listed by the document's running-animation list, not drawn frame by frame from script. At the same time, `#hem-count` rolls to the new number in one browser animation of 320 milliseconds with the same feel. Opponent stitches arrive from live events. When several arrive together, they start 24 milliseconds apart. An undone correct entry takes its stitch back with the same timings run in reverse. `data-stitches` always equals the player's correct non-given cells, hinted and grading-seeded cells included and givens excluded.
- **Solved sequence**: after a 200 finish, every cell plays one browser animation lasting 300 milliseconds. The cell grows about 8 percent and returns, with a delay of (row + column - 2) x 40 milliseconds, so the last cell ends 940 milliseconds after the first starts. During the same time the thread closes into a loop and the plinth lifts slightly. `#board` has `data-celebrating="true"` while it runs. The `Puzzle solved` dialog opens when the last cell's animation finishes.
- **Press feedback**: buttons darken at once on press, with no animation.
- **No unnamed loops**: nothing moves unless the player or a live event caused it. There are no idle loops, spinners or looping decoration.
- **Reduced motion** (the player's "reduce motion" setting): no animation runs anywhere on the page, so the document's running-animation list stays empty. Stitches and counters change at once, and `#hem-count` always shows the count as text. `data-celebrating` is never `true`, and the `Puzzle solved` dialog opens as soon as the finish answer arrives. The final state is the same as with motion.

### Feedback states (DP-04, DP-09, DP-14, DP-31, DP-35, DP-41, DP-49, DP-51, DP-53)

- **Live region**: `#announcer` exists on every page. Each announcement replaces its text with the exact sentence from the Messages table. To repeat the same sentence, the page clears the text first and sets it again on the next animation frame.
- **Pending**: while a request is in flight, the button that sent it has `aria-disabled="true"`, and a second press sends nothing. The pending sentence from Messages is announced.
- **Field errors** (422 `VALIDATION`): each field shows its message under itself, linked as its description. The `Check these details` alert lists the same messages as links to the fields.
- **Unexpected failure** (any 5xx not listed in Messages, or no answer): M56, announced. For a move save: M21, and the next move or resume sends the whole log again.
- **Outage**: the Valkey and Mailpit messages below. Solo play, daily play and the profile keep working in every outage except Postgres.

#### Messages

Every published sentence, one spelling each. Placeholders: `<r>` and `<c>` are a row and column number; `<d>` is a digit; `<limit>` is `MISTAKE_LIMIT`; `<left>` is the hints left; `<time>` is a time in the `#timer` format; `<score>` is an integer; `<CODE>` is an API error code; `<Name>` is a display name; `<rank>` is an integer. Unless "shown in" says otherwise, a message is announced through `#announcer`.

| ID | Text | When | Shown in |
|---|---|---|---|
| M01 | `Given cells can't be changed.` | enter, note or erase on a given | announcer |
| M02 | `Hinted cells can't be changed.` | enter, note or erase on a hinted cell | announcer |
| M03 | `Correct entries can't be changed.` | enter, note or erase on a correct entry | announcer |
| M04 | `Nothing to undo.` | undo with nothing to undo | announcer |
| M05 | `Nothing to redo.` | redo with nothing to redo | announcer |
| M06 | `Row <r>, column <c>, <d>.` | a correct entry | announcer |
| M07 | `Row <r>, column <c>, <d>, wrong. Mistakes <n> of <limit>.` | a mistake (example: `Row 4, column 3, 6, wrong. Mistakes 1 of 3.`) | announcer |
| M08 | `Note <d> added to row <r>, column <c>.` / `Note <d> removed from row <r>, column <c>.` | a note toggled | announcer |
| M09 | `Row <r>, column <c> erased.` | an erase | announcer |
| M10 | `Undone.` / `Redone.` | undo / redo | announcer |
| M11 | `You made <limit> mistakes.` | Game over with the second chance unused | `Game over` body |
| M12 | `You made <limit> mistakes. Your second chance is used.` | Game over after the second chance | `Game over` body |
| M13 | `Game over. <limit> mistakes.` | the Game over dialog opens | announcer |
| M14 | `Your game is paused.` | the pause overlay | `Paused` body |
| M15 | `Paused.` / `Resumed.` | pause / resume | announcer |
| M16 | `Hint: row <r>, column <c> is <d>. Hints left <left>.` | a hint | announcer |
| M17 | `No hints left.` | H with no hints left | announcer |
| M18 | `Solved in <time> with <m> mistakes and <h> hints. Score <score>.` (`1 mistake`, `1 hint` when the count is 1) | a 200 finish | `Puzzle solved` body |
| M19 | `Solved in <time>. Score <score>.` | the `Puzzle solved` dialog opens | announcer |
| M20 | `This game could not be verified (<CODE>). It was not counted.` | a 4xx finish | `Not counted` body and announcer |
| M21 | `Your game wasn't saved. It will be saved with your next move.` | a move save fails | under the board and announcer |
| M22 | `Checking your game.` | a finish is sent | over the board and announcer |
| M23 | `Notes on.` / `Notes off.` | notes mode toggled | announcer |
| M24 | `Second chance. Mistakes <n> of <limit>.` | the second chance is used | announcer |
| M25 | `This game isn't in the collection.` | `/play/<id>` for an unknown or another player's game | not-found page `h1` |
| M26 | `This page isn't in the collection.` | any other unknown page, or a room you are not seated in | not-found page `h1` |
| M27 | `Confirm your email to join duels.` | `NOT_VERIFIED` on create or join | under `Room code` and announcer |
| M28 | `Too many tries. Wait a minute and try again.` | `RATE_LIMITED` on join | under `Room code` and announcer |
| M29 | `No room has that code.` | `ROOM_NOT_FOUND` | under `Room code` and announcer |
| M30 | `Hints are off in duels.` | H in a duel | announcer |
| M31 | `Duels can't be paused.` | P in a duel | announcer |
| M32 | `Waiting for a second player.` | a seat is empty | seat list item |
| M33 | `Starting in <n>` | each server countdown message | `#countdown` and announcer |
| M34 | `You win! You finished first in <time>.` | duel won by finishing first | `#duel-result` and announcer |
| M35 | `<Name> wins. They finished first in <time>.` | duel lost to a finisher | `#duel-result` and announcer |
| M36 | `It's a tie.` | duel tie | `#duel-result` and announcer |
| M37 | `You're out: <limit> mistakes. <Name> wins.` / `<Name> is out. You win.` | a player reaches the limit (to them / to the other player) | `#duel-result` and announcer |
| M38 | `<Name> left the duel. You win.` | forfeit after the reload window | `#duel-result` and announcer |
| M39 | `<Name> is reconnecting.` / `<Name> is back.` | the opponent drops / returns | announcer and under the opponent's bar |
| M40 | `Live duels are unavailable right now. Solo games and the daily challenge still work.` | Valkey unreachable on `/duel` or in a room | `#duel-notice` and announcer |
| M41 | `This room already has two players.` | `ROOM_FULL` | under `Room code` and announcer |
| M42 | `The duel has started.` | the server's start message | announcer |
| M43 | `<Name> finished at rank <rank>.` | a live leaderboard update | announcer |
| M44 | `Confirm your email to join duels and the leaderboard.` | an unverified player | `Email confirmation` region |
| M45 | `Confirm your email to appear on the leaderboard.` | an unverified viewer on a leaderboard | `#leaderboard-notice` |
| M46 | `A new confirmation email is on its way.` | `Send again` accepted | announcer |
| M47 | `Live updates are paused. Reload to see new results.` | leaderboard with Valkey unreachable | `#leaderboard-notice` and announcer |
| M48 | `No one has finished this daily yet.` | a leaderboard with no rows | `#leaderboard-notice` |
| M49 | `Your account is ready, but we couldn't send the confirmation email. Use Send again in a minute.` | sign-up while Mailpit is unreachable | under the form and announcer |
| M50 | `We couldn't send email right now. Try again in a minute.` | `MAIL_UNAVAILABLE` on reset or `Send again` | under the form and announcer |
| M51 | `If that email has an account, a reset link is on its way.` | reset request accepted | under the form and announcer |
| M52 | `Email or password is incorrect.` | `BAD_CREDENTIALS` | under the form and announcer |
| M53 | `Your email is confirmed.` / `Your password is saved.` | verify / reset success | page body and announcer |
| M54 | `This confirmation link was already used.` / `This confirmation link has expired.` / `This confirmation link isn't valid.` | verify `TOKEN_USED` / `TOKEN_EXPIRED` / `TOKEN_NOT_FOUND` | page body and announcer |
| M55 | `This reset link was already used.` / `This reset link has expired.` / `This reset link isn't valid.` | reset `TOKEN_USED` / `TOKEN_EXPIRED` / `TOKEN_NOT_FOUND` | page body and announcer |
| M56 | `Something went wrong at the atelier. Try again.` | an unexpected failure | under the action and announcer |
| M57 | `The atelier is preparing your page.` | a page waiting for its first data | page body |
| M58 | `No finished games yet. The first one is waiting.` | an empty finished-games table | in place of the table |
| M59 | `Creating your account.` / `Signing you in.` / `Sending the reset link.` / `Opening the room.` | pending sign-up / sign-in / reset / create or join | announcer |
| M60 | `Enter a valid email address.` / `That email already has an account.` / `Use 3 to 20 characters.` / `That display name is taken.` / `Use at least 10 characters.` | field errors for email format, email taken, display name length, display name taken, password length | under the field and in the alert |
| M61 | `The atelier's records are out of reach. Try again in a minute.` | `STORAGE_UNAVAILABLE` | under the action and announcer |

## Backend

### API (DP-43, DP-44, DP-45, DP-47, DP-55, DP-57)

- All request and response bodies are JSON (`application/json`). A request body must be at most 1,000,000 bytes (exactly 1,000,000 is allowed). The session is the cookie `seam_session` (HttpOnly, SameSite=Lax, Path=/).
- **Error shape** (the only one): `{"error": {"code": "<CODE>", "message": "<sentence>"}}`. Validation errors add `"fields": {"<field>": "<message>"}`, using the M60 texts. Move-log errors add `"move": <n or null>`.
- **Error precedence**, for every endpoint: first `403 CROSS_ORIGIN`, `413 PAYLOAD_TOO_LARGE` and `415 UNSUPPORTED_MEDIA_TYPE` (body and origin); then `401 UNAUTHENTICATED`; then `403 NOT_VERIFIED`; then `503` service codes; then `429 RATE_LIMITED`; then `404` for an unknown resource or another player's (the same body either way); then `409` state conflicts; then `400` malformed bodies; then an idempotent replay returns its stored answer; then `422` validation and move-log checks. Endpoint rows list only their own codes. `503 STORAGE_UNAVAILABLE` applies to any endpoint while Postgres is unreachable.
- Shapes: `Player` = `{"player_id", "email", "display_name", "verified"}`, returned only to that player. `Result` = `{"id", "level", "seconds", "mistakes", "hints", "score", "finished_at", "daily_state"}`, where `daily_state` is `"solved"`, `"late"` or `null` (solo). `Game` = `{"id", "mode": "solo"|"daily", "level", "puzzle_id", "date": "<yyyy-mm-dd>"|null, "status": "playing"|"lost"|"won"|"abandoned", "puzzle", "solution", "start": {"entries", "notes", "mistakes", "hints", "elapsed_ms", "second_chance_used"}, "moves", "elapsed_ms", "result": Result|null}`. `Room` = `{"code", "level", "state": "open"|"seated"|"countdown"|"playing"|"finished"|"tie"|"forfeited", "seats": [{"display_name", "ready", "connected"}]}`. Levels are `easy`, `medium`, `hard` and `expert` in every body.

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/health` | none | 200 `{"status": "ok"}`, or `{"status": "degraded", "down": [...]}` listing any of `"postgres"`, `"valkey"`, `"mailpit"` in that order; never 503 | none |
| `POST /api/auth/signup` | `{"email", "display_name", "password"}` | 201 `{"player": Player, "verification_sent": true|false}`; sets the cookie | 422 `VALIDATION` |
| `POST /api/auth/signin` | `{"email", "password"}` | 200 `{"player": Player}`; sets the cookie | 401 `BAD_CREDENTIALS` |
| `POST /api/auth/signout` | none | 204; ends this session | none |
| `GET /api/me` | none | 200 `{"player": Player}` | 401 |
| `POST /api/auth/verify/resend` | none | 202 `{"sent": true}` | 503 `MAIL_UNAVAILABLE`, 409 `ALREADY_VERIFIED` |
| `POST /api/auth/verify` | `{"token"}` | 200 `{"player": {"display_name", "verified": true}}`; no session needed | 404 `TOKEN_NOT_FOUND`, 409 `TOKEN_USED`, 410 `TOKEN_EXPIRED` |
| `POST /api/auth/reset` | `{"email"}` | 202 `{"sent": true}` whether or not the account exists | 503 `MAIL_UNAVAILABLE`, 422 `VALIDATION` |
| `POST /api/auth/reset/confirm` | `{"token", "password"}` | 200 `{"player": Player}`; sets a new cookie | 404 `TOKEN_NOT_FOUND`, 409 `TOKEN_USED`, 410 `TOKEN_EXPIRED`, 422 `VALIDATION` |
| `POST /api/games` | `{"level"}` | 201 `{"game": Game}` | 422 `VALIDATION` |
| `GET /api/games/<id>` | none | 200 `{"game": Game}` | 404 `UNKNOWN_GAME` |
| `PUT /api/games/<id>/moves` | `{"moves": [...], "elapsed_ms"}` | 200 `{"game": Game}` | 404 `UNKNOWN_GAME`, 409 `CLOSED_GAME`, 409 `ALREADY_FINISHED`, 400 `LOG_MALFORMED`, 422 move-log codes except `BOARD_UNSOLVED` |
| `POST /api/games/<id>/finish` | `{"moves": [...]}` | 200 `{"result": Result}` | the check order in Finishing a game |
| `GET /api/daily?month=<yyyy-mm>` | none (month defaults to today's) | 200 `{"today", "month", "days": [{"date", "state", "id"}], "current_streak", "best_streak"}` | 422 `VALIDATION` |
| `POST /api/daily/<yyyy-mm-dd>/game` | none | 201 new, or 200 existing, `{"game": Game}` | 404 `DAILY_NOT_FOUND` (before `DAILY_START` or not a date), 409 `DAILY_NOT_OPEN` (future) |
| `GET /api/leaderboard/<yyyy-mm-dd>` | none | 200 `{"date", "live": true|false, "rows": [{"rank", "display_name", "seconds", "score", "mistakes", "hints"}]}` | 422 `VALIDATION` |
| `GET /api/profile` | none | 200 `{"levels": {"easy": {"started", "won", "win_rate", "best_seconds", "average_seconds", "best_score"}, "medium": ..., "hard": ..., "expert": ...}, "finished_games": [{"id", "date", "level", "result": "won"|"lost", "seconds", "score"}]}`; a missing value is `null` | none |
| `POST /api/duels` | `{"level"}` | 201 `{"room": Room}` | 403 `NOT_VERIFIED`, 503 `LIVE_UNAVAILABLE`, 422 `VALIDATION` |
| `POST /api/duels/join` | `{"code"}` | 200 `{"room": Room}` (also when you already hold a seat) | 403 `NOT_VERIFIED`, 503 `LIVE_UNAVAILABLE`, 429 `RATE_LIMITED` with a `Retry-After` header in whole seconds, 404 `ROOM_NOT_FOUND`, 409 `ROOM_FULL` |
| `GET /api/duels/<CODE>` | none | 200 `{"room": Room}` for a seated player | 503 `LIVE_UNAVAILABLE`, 404 `ROOM_NOT_FOUND` |

- Unknown API paths answer 404 `NOT_FOUND`. A document request for `/play/<id>` from a signed-in player answers status 404 with the M25 page when the id is unknown or belongs to someone else. The two cases are byte-identical.
- **WebSocket `/ws`**: same port and same origin. It needs a valid session; without one the server closes the socket with code 4401. Every message is one JSON object, with exactly the fields shown.
  - Client to server: `{"type": "room", "code"}` (attach to a room you are seated in), `{"type": "ready", "ready": true|false}`, `{"type": "move", "op": "enter"|"note"|"erase"|"undo"|"redo", "cell", "digit"}` (`cell` and `digit` only where the op needs them), `{"type": "leaderboard", "date"}`.
  - Server to client: `{"type": "room", "room": Room}` on attach and on every seat, ready or presence change; `{"type": "countdown", "seconds_left"}`; `{"type": "start", "puzzle": "<board string>", "started_at"}`; `{"type": "you", "values": "<board string>", "wrong": ["<cell>"], "hinted": [], "notes": {"<cell>": [<digits>]}, "correct", "mistakes"}` after the start, after each of your moves and on rejoin; `{"type": "progress", "display_name", "correct", "mistakes"}` for the opponent; `{"type": "presence", "display_name", "state": "reconnecting"|"back"}`; `{"type": "result", "outcome": "win"|"loss"|"tie"|"out"|"opponent_out"|"forfeit_win", "winner": "<display name>"|null, "seconds"}`, where `seconds` is the finisher's time from the start, or `null`; `{"type": "leaderboard", "date", "rows": [...], "latest": {"display_name", "rank"}}`; `{"type": "error", "code", "message"}`.
  - No message to a player ever contains the other player's digits, notes, selection, email or ids. In a duel, no message contains the solution.

### Grading routes (DP-56)

These routes exist only when `GRADING_ROUTES=on`; otherwise they answer 404 `NOT_FOUND`. They need no session.

- `POST /api/grading/players` with `{"players": [{"key": "ada", "email": "ada@example.test", "display_name": "Ada", "password": "correct-horse-1", "verified": true}]}` answers 201 `{"players": [{"key": "ada", "player_id": "<id>", "session": "<seam_session value>"}]}`. The `session` value works as the `seam_session` cookie.
- `POST /api/grading/games` with `{"player_id", "puzzle_id", "mode": "solo"|"daily", "date": "<yyyy-mm-dd>" (daily only), "entries": [{"cell", "digit"}], "notes": [{"cell", "digits": [<digits>]}], "mistakes", "hints", "elapsed_ms", "second_chance_used"}` answers 201 `{"id", "url": "/play/<id>"}`. These values form the game's start board. Seeded entries count as correct entries and lock. 422 `SEED_INVALID` when an entry is not the solution digit or sits on a given, when a note sits on a non-empty cell, when a daily's `puzzle_id` is not that date's puzzle or the player already has that date's daily, or when `mistakes` reaches `MISTAKE_LIMIT`. A solo seed counts as a started game at its level.
- `POST /api/grading/finished-games` with `{"player_id", "level", "result": "won"|"lost", "elapsed_ms", "mistakes", "hints", "finished_at"}` answers 201 `{"id"}`. It is a finished solo game, counted in the statistics as if played, with the score from the Score rule for a win.
- `POST /api/grading/daily-results` with `{"player_id", "date", "finished_at", "elapsed_ms", "mistakes", "hints"}` answers 201 `{"id"}`. It is a won daily: `solved` when `finished_at` falls on `date` in `DAILY_TZ`, else `late`. It appears on the leaderboard under the leaderboard rules.
- `POST /api/grading/clock` with `{"now": "2026-11-03T23:58:00+13:00"}` answers 200 `{"now"}` and sets the server clock to that instant, running on from there. `{"now": null}` returns to real time. The server clock decides dates, on-day results, `finished_at` and token expiry. It does not move duel timers, the join-limit window or room expiry, which use real milliseconds.

### Business rules (DP-05 to DP-21, DP-25, DP-26, DP-29 to DP-31, DP-33 to DP-38, DP-40, DP-41, DP-43 to DP-46, DP-49 to DP-51)

#### Moves (DP-05, DP-06, DP-07)

- A move is one of: enter, note, erase, hint, undo, redo, second chance, pause, resume. A key or button press that changes nothing is not a move and is not logged. Each guard below that "announces" uses the matching sentence from M01, M02 or M03.
- **Enter digit d** (normal mode) in the selected cell: a given, a hinted cell or a correct entry changes nothing and announces its guard (correct entries lock). A cell already holding d changes nothing. Otherwise the cell gets d. It is correct when d equals the solution digit; otherwise it is wrong (`data-wrong="true"`) and is a mistake. Either way, the cell's own notes are cleared and d is removed from the notes of all 20 peers.
- **Note digit d** (notes mode): toggles d in the notes of an empty cell. On a given, a hinted cell or a correct entry it changes nothing and announces the guard. On a wrong entry it changes nothing.
- **Erase**: a wrong entry is removed (the cell is empty and `data-wrong="false"`). An empty cell with notes loses all its notes. An empty cell without notes changes nothing. A given, a hinted cell or a correct entry changes nothing and announces the guard.
- **Undo** reverts the latest enter, note or erase not yet undone, exactly: the cell's value and notes come back, and so does every peer note that the entry removed. **Redo** re-applies the latest undone move exactly, removing the same notes again. Any new enter, note or erase clears the redo history. A hint or a second chance clears both histories. Undo and redo never change the mistake count or the hint count. With nothing to undo or redo, M04 or M05 is announced.
- **Worked example** (`medium-1`, from the start): in notes mode, put notes `3 7` in `r4c2`, `3 5` in `r5c3` and `3` in `r1c1`. Leave notes mode and enter `3` in `r4c3` (correct). Now `r4c2` has notes `7` (same row), `r5c3` has `5` (same column and box), and `r1c1` keeps `3` (not a peer). After undo, `r4c3` is empty and the notes are `3 7` and `3 5` again. After redo, `r4c3` holds 3 and the notes are `7` and `5` again.

#### Mistakes (DP-09, DP-10)

- A mistake is an enter of a digit that differs from the cell's solution digit. Nothing else is a mistake: notes, hints, erases, undos and redos never are. Entering another wrong digit into a cell that already holds a wrong digit is another mistake.
- When the count reaches `MISTAKE_LIMIT`, the game becomes `lost`. The clock stops (this is not a pause move), `#board` has `data-state="lost"`, and `Game over` opens with M11 and focus on `Second chance`, with M13 announced.
- **Second chance** (once per game): it removes the digit of the entry that reached the limit and restores the notes that entry removed. It sets the count to the limit minus one, closes the dialog, returns focus to that cell, restarts the clock and announces M24. It clears the undo and redo histories, and the game is `playing` again.
- When the limit is reached again after the second chance, `Game over` shows M12 with only `New game`, which is focused. The game is now lost for good.
- A lost game is **open** while its second chance is unused and no newer game at its level has been started. Otherwise it is **closed**. A daily counts as Medium for this rule.
- An open lost game counts in `Games started` but is not a finished game: it is not listed in `Finished games`. When it is reopened, also after a reload, the board shows `data-state="lost"`, the clock stays stopped at the saved time, and `Game over` opens with M11 and focus on `Second chance`.
- Once a lost game closes, it is a finished game with the result `Lost`. Reopening a closed lost game shows the board with `data-state="lost"` and `Game over` with only `New game`, which is focused. The body is M12 if the second chance was used, else M11.
- In duels the limit is the same and there is no second chance (see Duels).

#### Hints (DP-12, DP-13)

- Each game allows `HINT_LIMIT` hints. Hints are off in duels.
- A hint fills one cell with its solution digit. To pick the cell, consider every cell that is empty or holds a wrong entry. A cell's candidates are the digits 1 to 9 not present among the givens, hinted cells and correct entries in its row, column and box; wrong entries and notes are ignored. The hint picks the cell with the fewest candidates. Ties go to the lowest row, then the lowest column. The choice is recomputed before every hint.
- The hinted cell gets the digit, `data-hinted="true"` and `data-wrong="false"`, and loses its notes. The digit is removed from its peers' notes, and the selection moves to the cell. A hint on a wrong cell does not change the mistake count. Hinted cells lock like givens. M16 is announced.
- **Worked example** (`medium-1`, from the start, no entries): hint 1 fills `r4c3` with 3 (one candidate, and the first such cell in reading order). Hint 2 fills `r6c2` with 4. Hint 3 fills `r5c3` with 5: after the first two hints `r5c3` has one candidate and comes before `r6c7` in reading order. If the player had first entered a wrong 6 in `r4c3`, hint 1 would still fill `r4c3`, replacing the 6 with 3.
- With no hints left, the `Hint` button is disabled and H announces M17.

#### Clock and score (DP-17, DP-18, DP-19)

- `#timer` shows the game's active time, which counts only while the game is playing and not paused. The clock starts when the board is first shown, from the game's saved active time (`00:00` for a new game). The display updates at least once per second of page time.
- **Pause**: P, the `Pause` button, the window's `blur` event, or the page becoming hidden pauses the game. The pause overlay opens with focus on `Resume`, the board is hidden (see The board), and M15 is announced. Every pause, automatic ones included, ends only by P or `Resume`, and focus returns to the selected cell. A pause and its resume are logged as moves. The stop at game over is not.
- **Device clock**: the player's device clock may be wrong by hours. Only the active-time count uses the page's time. Dates, results, countdowns and starts come from the server.
- **Score of a won game**: `max(base / 10, base - S - 150 x M - 300 x H)`, where base is Easy 1500, Medium 3000, Hard 4500 or Expert 6000. S is the whole seconds of active time (rounded down), M is the mistakes at the finish, and H is the hints used, seeded hints included. Worked examples: Hard, 09:41 (581 s), 1 mistake, 2 hints: 4500 - 581 - 150 - 600 = 3169. Medium, 04:20 (260 s), 0 mistakes, 1 hint: 2440. Expert, 1:40:00 (6000 s), 2 mistakes, 3 hints: 6000 - 6000 - 300 - 900 is below 600, so the score is 600.

#### Saving and the move log (DP-45)

- The client sends the whole log since the start board, with the active time, to `PUT /api/games/<id>/moves` after every move. The server replays it with the checks from Finishing a game (steps 1 to 6), stores it, and sets the game's status from the replay. A replay that reaches the limit makes the game `lost`; a log that applies the second chance makes it `playing`. A reloaded `playing` game opens playing, at the stored board and at the larger of the stored `elapsed_ms` and the last move's `t`. A reloaded `lost` game opens as Mistakes describes. The pause state is not restored.
- **Log format**: `{"moves": [<move>, ...]}`. Each move is `{"n": <1-based index>, "t": <active ms at the move>, "op": <op>, ...}`. The ops and their fields are `enter` (`cell`, `digit`), `note` (`cell`, `digit`), `erase` (`cell`), `hint` (`cell`, `digit`), `undo`, `redo`, `second_chance`, `pause` and `resume`. `cell` is `r<row>c<column>` and `digit` is an integer from 1 to 9. Other fields are ignored. A log holds at most `MOVE_LIMIT` moves (exactly `MOVE_LIMIT` is allowed). The log starts from the game's start board, and `t` continues from the start board's active time.

#### Finishing a game (DP-04, DP-43, DP-44)

- When the last cell is filled correctly, the client sends `POST /api/games/<id>/finish` with the full log and shows M22 until the answer arrives.
- The server checks in this exact order and answers with the first failure:
  1. 401 `UNAUTHENTICATED`: no valid session.
  2. 404 `UNKNOWN_GAME`: no such game, or another player's game.
  3. 409 `CLOSED_GAME`: the game is abandoned, or lost and closed.
  4. 400 `LOG_MALFORMED` (`move: null`): the body is not an object with a `moves` array, a move lacks a field its op needs, an op is unknown, a cell or digit is invalid, or there are more than `MOVE_LIMIT` moves.
  5. If the game is already won, a log identical on the published fields answers 200 with the stored result, and nothing is counted again. Any other log answers 409 `ALREADY_FINISHED`.
  6. Replay, move by move. For each move, these checks run in this order, and a failure answers 422 with that move's `n`: `LOG_SEQUENCE` (n is not the previous n + 1, starting at 1); `LOG_TIME` (t is negative, below the previous t, or below the start board's active time); `GIVEN_CELL` (an enter, note or erase on a given); `LOCKED_CELL` (an enter or erase on a hinted cell or a correct entry, or a note on any cell that holds a value); `HINT_MISMATCH` (a hint whose cell or digit is not the one the hint rule picks); `HINT_LIMIT` (a hint beyond `HINT_LIMIT`); `MISTAKE_LIMIT` (any move other than the first second chance after the count reached the limit, or a second chance while the count is below the limit).
  7. 422 `BOARD_UNSOLVED` (`move: null`): the replayed board is not the solution.
- **Success**: 200 with the Result, which the server computes from the replay; the server's numbers win. `seconds` is the last move's `t` in whole seconds, rounded down. The game becomes `won` and counts exactly once in the statistics, the daily calendar and the leaderboard, even when two identical finishes arrive at the same moment. When two different logs arrive at the same moment, one wins and the other gets 409 `ALREADY_FINISHED`.
- **Refusal**: on any 4xx, `Not counted` opens with M20. The game stays as the server holds it, and nothing is counted.
- **Win display**: on a 200, the solved sequence plays, then `Puzzle solved` opens with M18 and focus on `New game`, and M19 is announced.

#### Daily challenge (DP-25, DP-26)

- **Today** is the server clock's date in `DAILY_TZ`. The calendar starts at `DAILY_START`.
- The daily puzzle for date D is `daily-k`, with k = (days from 2026-01-01 to D) mod 7 + 1. Examples: 2026-11-02 is `daily-5`, 2026-11-03 is `daily-6`, 2026-11-04 is `daily-7` and 2026-11-05 is `daily-1`. Daily games are level Medium. Each player has one daily game per date, created the first time they open that date. Everyone gets the same puzzle for the same date.
- `#calendar` shows the month of today on open. Weeks are rows starting on Monday. Each date cell has `data-date="yyyy-mm-dd"`, `data-state`, and `aria-label="<Month> <d>, <yyyy>, <state words>"`:

  | data-state | state words | meaning |
  |---|---|---|
  | `solved` | `solved` | won, and the server received the finish on that date |
  | `late` | `solved late` | won after its date |
  | `missed` | `missed` | a past date, not won |
  | `today` | `today` | today, not won yet |
  | `future` | `not open yet` | after today (`aria-disabled="true"`) |
  | `closed` | `not available` | before `DAILY_START` (`aria-disabled="true"`) |

- **Calendar keyboard and focus**: the calendar is one Tab stop.
  - Exactly one date cell has `tabindex="0"`, and every other date cell has `tabindex="-1"`. Days of the neighbouring months are blank cells without `data-date` and never take focus.
  - When the page opens, the tab stop is today and today's cell receives focus. After `Previous month` or `Next month`, the shown month changes and focus stays on that button. The tab stop moves to day 1 of the shown month, or to today when the shown month is today's.
  - `Next month` has `aria-disabled="true"` while today's month is shown, and `Previous month` has `aria-disabled="true"` while the `DAILY_START` month is shown; otherwise each has `aria-disabled="false"`. Neither ever uses the `disabled` attribute, so both stay focusable and in the Tab order. Pressing a button that has `aria-disabled="true"` changes nothing and keeps focus on it. When a press lands on the month where that same button becomes `aria-disabled="true"`, focus stays on that button.
  - ArrowLeft and ArrowRight move one day, and ArrowUp and ArrowDown move seven days, within the shown month only. A move that would leave the month keeps focus where it is and never changes the month.
  - `future` and `closed` dates take focus like any other date.
  - Enter or Space on a `solved`, `late`, `missed` or `today` date opens that date's daily game at `/play/<id>`, creating it the first time it is opened. On a `future` or `closed` date, Enter and Space do nothing.
  - Clicking or tapping a date does the same as Enter.
- A daily counts on its date only when the server receives the finish on that date in `DAILY_TZ`. The current streak counts consecutive `solved` dates, ending today if today is `solved`, else ending yesterday. A `late` date never counts, and a `missed` or `late` date ends a run. The best streak is the longest such run ever.
- **Worked example** (`DAILY_TZ=Pacific/Auckland`): 2026-11-01 and 2026-11-02 are `solved`. The server receives the 2026-11-03 finish at 23:58 on 3 November, Auckland time: the streak is 3. If the finish arrives at 00:01 on 4 November instead, 2026-11-03 is `late` and the streak is 0 until 2026-11-04 is solved, then 1.
- The calendar and streak lines are read from the server when the page opens and again after each daily finish. They do not change on their own while a page stays open across midnight.
- Daily games count in the calendar, the streaks and the leaderboard, not in the per-level statistics.

#### Leaderboard (DP-29, DP-30, DP-31)

- `/leaderboard` shows today; `/leaderboard/<yyyy-mm-dd>` shows that date. Only `solved` (on-day) results of verified players are listed, one per player, up to `LEADERBOARD_SIZE` rows.
- **Order**: score from high to low, then time from low to high, then the earlier finish. Players with the same score and time share a rank, and the next rank skips (1, 2, 2, 4).
- **Live**: when a player's daily result for that date is verified, every open leaderboard page for that date shows the new ranking within 2 seconds, without a reload, and announces M43. A player who confirms their email later appears the next time the page loads.
- Unverified viewers see M45. With no rows the page shows M48.
- **Valkey down**: the API answers `"live": false` with the rows read from Postgres in the same order, the page shows M47, and no live rows arrive.
- Rows contain only the fields in the API row shape. No email or other private field ever appears.

#### Duels (DP-33 to DP-38, DP-40, DP-41)

- Only signed-in, verified players create or join rooms. A room is at the level chosen in `Level`. Both players get that level's fixture number 3 (`medium-3` for a Medium duel).
- **Room code**: 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I, O, 0 or 1), unique among live rooms. A room that has not started expires `DUEL_ROOM_TTL_MS` after creation. After that, joining answers `ROOM_NOT_FOUND`.
- **Joining**: a room has exactly two seats. When several players join the same room at once, exactly one takes the second seat and every other joiner gets `ROOM_FULL`. A join that answers `ROOM_NOT_FOUND` or `ROOM_FULL` is a failed join. After `DUEL_JOIN_LIMIT` failed joins by one player within 60 seconds, every further join by that player answers `RATE_LIMITED`, even with a valid code, until the oldest of those failures is 60 seconds old. `Retry-After` gives the wait in whole seconds. Join errors show M27, M28, M29 or M41.
- **Room states**: `open` (one seat) → `seated` (two) → `countdown` (both pressed `Ready`) → `playing` → `finished`, `tie` or `forfeited`. Turning `Ready` off before the countdown goes back to `seated`. During the countdown, `Ready` is disabled.
- **Countdown**: when both players are ready, the server sends the first `countdown` message at once, then one more every 1000 milliseconds while time is left. `seconds_left` is the time left before the start in whole seconds, rounded up, and it is never 0. The server sends `start` to both players at the same moment, exactly `DUEL_COUNTDOWN_MS` after the first `countdown` message. With 3000, the messages carry `seconds_left` 3, 2 and 1 at 0, 1000 and 2000 milliseconds, and `start` follows at 3000 milliseconds. With 1000, there is one message carrying `seconds_left` 1, and `start` follows 1000 milliseconds later. `#countdown` shows M33 for each message, and `start` shows both boards and announces M42. The page never counts down on its own. The duel timer counts from the arrival of `start`.
- **Play**: every move goes to the server over `/ws`. The server applies the Moves and Mistakes rules against the solution and answers with `you`, and the board shows only what `you` says. The opponent receives `progress` within one second. The opponent's progress bar's `aria-valuemax` is the number of empty cells at the start (48 for `medium-3`).
- **Results**, decided by the server: the first player whose board the server sees solved finishes first. The result goes out `DUEL_TIE_MS` after that moment. If the other player's board is also solved within that window, the duel is a tie. A player who reaches the mistake limit is out, and the other wins at once (if the other player has already solved, they win when the window ends). `Duel over` opens with the viewer's message from M34 to M38. `<time>` there is the server's time from the start to the finisher's solved board.
- **Reload window**: a player whose page reloads, or whose socket drops, during play gets their seat, board, notes and progress back from the server if they return within `DUEL_REJOIN_MS`. While they are away, the opponent sees and hears M39 (reconnecting), and M39 (back) when they return. Once the window passes, the opponent wins by forfeit (M38). If both players stay away past the window, the room ends `forfeited` with no winner. Before the start, a reload keeps the seat and resets that player's `Ready`.
- **Valkey down**: `/duel` shows M40 and disables `Create room` and `Join room`, based on the health check when the page opens. If Valkey becomes unreachable in a room, the room page shows M40 and the duel ends without a result.
- Duel outcomes are stored in Postgres. Duels do not count in the per-level statistics.

#### Profile and statistics (DP-46)

- Statistics cover solo games only, per level. `Games started` counts the solo games created at that level (abandoned ones included). `Games won` counts the won ones. `Win rate` is won divided by started, as a whole percent rounded half up (`67%`), or `-` when none were started. `Best time` is the fastest won time in the `#timer` format, or `-`. `Average time` is the mean won time in whole seconds, rounded down, in the `#timer` format, or `-`. `Best score` is the highest won score, or `-`.
- The `Finished games` table lists won solo games and closed lost solo games (see Mistakes), newest first, at most 20. Open lost games are not listed.
  - `Date` is the finish date in `DAILY_TZ` as `yyyy-mm-dd`; for a lost game, it is the date the game closed.
  - `Level` is the level name, and `Result` is `Won` or `Lost`.
  - `Time` is in the `#timer` format, and `Score` is the score, or `-` for a loss.
- Every value is derived from the stored finished games when it is read, so it always equals a recount and is the same after a reload.

#### Accounts (DP-49, DP-50, DP-51)

- **Sign-up**: the email must be a valid address and unique, ignoring case. The display name must be 3 to 20 characters and unique, ignoring case. The password must be at least 10 characters. On success the player is signed in but unverified, and the server sends the confirmation message (see Services). The account counts as verified only when a confirmation link from a message Mailpit accepted is opened. A link expires `VERIFY_TTL_MINUTES` after sending and works once. If Mailpit cannot be reached, the account is still created, `verification_sent` is `false`, the page shows M49, and no link exists.
- **Send again** sends a new confirmation message, and older unused links stay valid until they expire. A success announces M46.
- **Sign-in**: wrong details answer `BAD_CREDENTIALS` and show M52.
- **Reset**: the request always shows M51 when Mailpit is reachable. If Mailpit cannot be reached, the server answers `MAIL_UNAVAILABLE` before looking up the email, and the page shows M50. A reset link expires `RESET_TTL_MINUTES` after sending and works once. Saving a new password ends every existing session of that player and signs in the browser that saved it. Link outcomes show M53 or M55.

### Services (DP-31, DP-33, DP-35, DP-41, DP-49, DP-50, DP-51, DP-60)

- **Postgres** (`DATABASE_URL`) is the source of truth for players, sessions, tokens, games with their start boards and move logs, finished games, daily results and duel outcomes. The app applies its schema idempotently every time it starts.
- **Valkey** (`VALKEY_URL`) holds:
  - `seam:room:<CODE>`: a hash with the fields `level`, `state`, `seat1` and `seat2` (player ids). Before the start its expiry is at most `DUEL_ROOM_TTL_MS`.
  - `seam:presence:<CODE>:<player_id>`: present while that player is connected or inside the reload window.
  - `seam:leaderboard:<yyyy-mm-dd>`: a sorted set whose members are the player ids of that date's listed results. It is rebuilt from Postgres when missing.
  - `seam:joins:<player_id>`: the failed-join record, with an expiry of at most 60 seconds.
  - Live fan-out between server processes runs through Valkey publish and subscribe.
  - When Valkey is unreachable, duel endpoints answer `503 LIVE_UNAVAILABLE`, the leaderboard falls back to Postgres, and the health check lists `"valkey"`. Solo and daily play are unaffected.
- **Mailpit** (`SMTP_HOST`, `SMTP_PORT`): every message comes from `MAIL_FROM` (`Seam <atelier@seam.example>`) and goes to the player's email.
  - The confirmation message has the subject `Confirm your email for Seam` and a text body holding the full link `<origin>/verify/<token>`.
  - The reset message has the subject `Reset your Seam password` and holds `<origin>/reset/<token>`.
  - `<origin>` is the origin the request came from (its `Origin` header, else its scheme and `Host`).
  - A token is valid only after Mailpit has accepted its message. When Mailpit cannot be reached, nothing counts as sent and the health check lists `"mailpit"`.

### Puzzles (DP-25, DP-60)

The puzzles are the 19 fixtures below, generated for this task, each with exactly one solution. The app never generates, downloads or copies puzzles from anywhere else.

| id | level | givens | puzzle | solution |
|---|---|---|---|---|
| `easy-1` | easy | 40 | `000325070250900640000046523410500060002107400090003017739210000045008092020759000` | `684325971253971648971846523417582369362197485598463217739214856145638792826759134` |
| `easy-2` | easy | 39 | `004010590009007408076054001201000875000261000943000602400630750507100200032070100` | `324816597159327468876954321261493875785261943943785612418632759597148236632579184` |
| `easy-3` | easy | 40 | `432075109800010045005003726000057000050804070000320000719500800320090007508730961` | `432675189867219345195483726283957614951864273674321598719546832326198457548732961` |
| `medium-1` | medium | 32 | `010800000007000090859200604600082405080000030102570009908004156030000900000009080` | `416895723327461598859237614693182475785946231142573869978324156231658947564719382` |
| `medium-2` | medium | 33 | `670100000409000000500004160090600084806947501140008090057400006000000805000005072` | `678153249419826753523794168795612384836947521142538697257481936364279815981365472` |
| `medium-3` | medium | 33 | `000000905579200060300090004050007018103080402780100050800050006030002541405000000` | `241763985579248163368591724654927318193685472782134659817459236936872541425316897` |
| `hard-1` | hard | 28 | `090006000004095603005080090100000200680000041002000006040020500507860100000900070` | `298436715714295683365187492159648237683572941472319856941723568537864129826951374` |
| `hard-2` | hard | 27 | `910406000000000009005007001003600007201080604400002300600300500300000000000809032` | `912456873736218459845937261583694127271583694469172385697321548328745916154869732` |
| `hard-3` | hard | 27 | `000065800000000001050240070005400010098030720070002400030097060600000000009520000` | `927165834346789251851243679265478913498631725173952486534897162682314597719526348` |
| `expert-1` | expert | 25 | `000000006006071000004800290030007450000080000047200080023009600000320800100000000` | `381592746296471538754863291938617452512984367647235189823159674479326815165748923` |
| `expert-2` | expert | 25 | `004000010005109640000306008000000030000462000010000000300508000068901200050000700` | `684257319235189647197346528429715836873462195516893472342578961768931254951624783` |
| `expert-3` | expert | 25 | `035020006001050009940008000000009000400080001000700000000200037500040900700090210` | `835921746671354829942678153357419682496582371218736594189265437523147968764893215` |
| `daily-1` | medium | 31 | `031070005042506080000834000076000000100040009000000570000457000050601720900080150` | `831279645742516983695834217576928431123745869489163572218457396354691728967382154` |
| `daily-2` | medium | 31 | `049800000000009810120000009600930074030060090890027001200000087017300000000002960` | `549871326376249815128653749651938274732164598894527631263495187917386452485712963` |
| `daily-3` | medium | 32 | `800070000000006095009502308000230850031000270058097000607403500310900000000060003` | `865379124123846795749512368976234851431658279258197436697483512314925687582761943` |
| `daily-4` | medium | 31 | `063008200100600350000310000002000030581030642040000800000071000018003004007900510` | `763458291124697358895312467672845139581739642349126875456271983918563724237984516` |
| `daily-5` | medium | 32 | `700350210610007900005901000200500009050000040900008002000403800008600075069085004` | `794356218612847953385921467271534689853269741946178532527413896438692175169785324` |
| `daily-6` | medium | 32 | `409000706058007040010045000006000270900102004073000500000930020090700460504000907` | `429318756358697142617245398146583279985172634273469581761934825892751463534826917` |
| `daily-7` | medium | 32 | `070040009860105004040020071005006090000701000010300800150060030600204015900010040` | `271643589869175324543829671725486193398751462416392857154967238687234915932518746` |

A new solo game at a level uses the level's fixture that the player has started the fewest times, with ties going to the lowest number. A new player's first Easy game is `easy-1` and their second is `easy-2`. Daily and duel games follow their own rules above.

### Seed data (DP-56)

At start there are no players, games or results. The puzzle table above is the only content. Every person a test creates is invented, and its addresses use `example.test`.

## Technical requirements

### Deployment (DP-55)

- Node 22 with npm is available. Server and client are TypeScript.
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema": "run-manifest-v1"`, for example `{"_schema": "run-manifest-v1", "install": "npm ci", "build": "npm run build", "serve": "npm run start"}`.
- The server binds `0.0.0.0` on `APP_PUBLIC_PORT` when it is set, else on 4173. HTTP, the built client and `/ws` share that one port.
- `GET /api/health` answers HTTP 200 with the JSON described in API on every instance.

### Configuration and secrets (DP-26, DP-60)

Each setting is read from the environment at start and can be set per instance. The value shown is the default.

| Variable | Default | Meaning |
|---|---|---|
| `MISTAKE_LIMIT` | 3 | mistakes that end a game |
| `HINT_LIMIT` | 3 | hints per solo or daily game |
| `MOVE_LIMIT` | 5000 | moves per log |
| `DAILY_TZ` | `Pacific/Auckland` | IANA zone of the day boundary |
| `DAILY_START` | `2026-01-01` | first calendar date |
| `LEADERBOARD_SIZE` | 20 | rows per leaderboard |
| `DUEL_COUNTDOWN_MS` | 3000 | countdown length in milliseconds |
| `DUEL_REJOIN_MS` | 30000 | reload window in milliseconds |
| `DUEL_TIE_MS` | 500 | tie window in milliseconds |
| `DUEL_ROOM_TTL_MS` | 600000 | life of an unstarted room in milliseconds |
| `DUEL_JOIN_LIMIT` | 5 | failed joins allowed per 60 seconds |
| `VERIFY_TTL_MINUTES` | 60 | confirmation link life |
| `RESET_TTL_MINUTES` | 30 | reset link life |
| `GRADING_ROUTES` | `on` | `on` enables the grading routes; set it to `off` for a real deployment |

Service settings, provided by the environment: `DATABASE_URL`, `VALKEY_URL`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`. Credentials are never hard-coded, logged, or sent to the browser. The grading instances are `valkey-down` (`VALKEY_URL` points at a closed port), `mailpit-down` (`SMTP_HOST` and `SMTP_PORT` point at a closed port), and `duel-short` (`DUEL_COUNTDOWN_MS` 1000, `DUEL_REJOIN_MS` 3000, `DUEL_TIE_MS` 4000, its own empty database).

### Server boundary (DP-47, DP-57)

- **Same origin only**: a state-changing request or a `/ws` upgrade whose `Origin` is not the app's own origin answers 403 `CROSS_ORIGIN`. No cross-origin headers are sent.
- **Body limits**: bodies over the API's byte limit answer 413 `PAYLOAD_TOO_LARGE`. A body that is not JSON answers 415 `UNSUPPORTED_MEDIA_TYPE`.
- **What is served**: only the built client, the two font files and the API. Never source files, source maps, lockfiles, environment files or credentials. Every asset comes from the app's own origin: no CDNs, fonts from other hosts, analytics or trackers. Icons are inline SVG. The page registers no service worker.
- **Unreachable dependencies at boot**: the server starts and listens anyway, and retries each dependency every few seconds. While Postgres is unreachable, the API answers 503 `STORAGE_UNAVAILABLE` (shown as M61). While Valkey or Mailpit is unreachable, the server behaves as described in Services. The health check lists what is down.

### Browser support and performance (DP-23, DP-54)

- The app supports current Chromium, Firefox and WebKit, at 320 to 1440 px wide, with the reference viewports 375x812, 768x1024 and 1280x800. The breakpoint is 768 px: 767 px wide uses the phone layout and 768 px the side-by-side one.
- The board is usable within three seconds of opening a play page. A move shows on the board within a tenth of a second, and its save does not block the next move.

### How Seam is checked (DP-01 to DP-57)

- Tests read DOM attributes, accessible names, the published text, computed layout sizes, the document's running-animation list, and API, WebSocket and provider data. They never read colours, pixels or screenshots.
- The grading routes create players, games in progress, finished games and daily results, and they set the server clock. Most checks start from a game in progress created this way, and they add the `seam_session` cookie to a browser instead of signing in through the form.
- Tests control the page's clock: the page opens with its clock paused, and tests advance it. Every client timer, countdown display, animation wait and debounce must use the page's own timing functions (`Date`, `performance.now`, `setTimeout`, `setInterval`, `requestAnimationFrame`), never a Web Worker timer, so that an advanced clock moves them. The server never trusts the page's clock.
- Tests block service workers, and some open a browser with reduced motion or touch emulation.

## Working rules

- IF-01: `/app/run.json` is valid JSON with string `install`, `build` and `serve` commands and `"_schema": "run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` names every shipped package, plus Gloock and Rethink Sans, with each one's licence. "Shipped packages" means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (as defined in IF-02) is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, and the fonts are under the SIL Open Font License 1.1.
- IF-04: The app uses no datastore besides Postgres and Valkey. No SQLite, no embedded databases, and no files used as storage.
- IF-05: All application source is TypeScript. The lockfile `package-lock.json` is committed.
- IF-06: The 19 puzzle fixtures appear in the source exactly as published, and the source contains no puzzle generator or puzzle download.
- IF-07: The dev service compose files you were given are left unchanged.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` used to silence the type checker.
- Names match this brief's domain terms: game, move, move log, start board, given, entry, note, hint, mistake, second chance, daily, streak, duel, room, seat, stitch.
- Each domain rule is decided in exactly one place: the move rules, hint choice, check order, score, on-day decision, streak, ranking and duel result. The client's board and the server's replay apply the same rule code rather than two copies of it.
- No abstraction has only one implementation, and there is no dead, commented-out or unreachable code.
- There are no defensive checks for states the rules make impossible.
- Every API error uses the one published error shape and code list.
- There are no features beyond this brief.
