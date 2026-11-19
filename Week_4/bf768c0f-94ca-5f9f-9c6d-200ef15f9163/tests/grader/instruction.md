# Gambit Hall

Build and deploy a working web application from this brief. There is no starting codebase. When you are done, a stranger must be able to open the app in a browser, sign in as `tobin_reyes`, accept the challenge from `mira_kade`, and play a complete rated game a move at a time with no clock running: the same position visible as a flat board, as a board with depth rendered by the browser's hardware graphics, and as a grid of sixty-four named squares that a keyboard alone can play through. When that game ends in checkmate, both ratings must move by the formula in this brief, computed from the numbers both players held before the game started. A different stranger signed in as `wren_oyelaran` must be able to watch that game and must NOT be able to move a piece in it or post a single chat message. And two moves submitted for the same turn at the same moment must leave exactly one move played: the other is refused and the position is untouched.

## Problem and users

Gambit Hall is a turn-based chess club on the web, operated by `Gambit Hall Club`. Members challenge each other to rated games, or play the house opponent at one of three levels for no rating. A game has no clock and no time control: a player submits one move, and the opponent replies whenever they next open the game. Every game offers one position through a flat board, a board with depth, and an accessible sixty-four-square grid, with four flat piece sets, three deep piece sets and five board themes that persist with the member's account. Members chat inside their own games, belong to clubs with three roles, block people they would rather not hear from, collect notifications and appear on a leaderboard. Every finished game exports as a standard text record and a valid record imports back.

There is no self sign-up restriction and no payment of any kind: a visitor joins, picks a name and plays. Nothing is tracked, no advertising is served, and the app makes no call to any other origin at run time.

The genuinely hard part is exactness. The rules of chess admit no approximation: castling, capture en passant, promotion, the repetition and fifty-move claims, insufficient material and the draw offer each have exactly one correct outcome, and the position record must be exact to the field so that two readers of one game agree on what may happen next. Ratings must be symmetric, computed from both players' pre-game numbers, and voiding a game must reconstruct every later rated game of both players in order. Two moves racing for one turn must leave exactly one winner.

| Role | Can do |
|---|---|
| Anyone without a session | Open the welcome, sign-in and join pages. **Cannot** read a game, a chat, a challenge, a club, a member or a notification over the API, and **cannot** move |
| `member` | Join, play rated games and house games, chat in their own games, challenge, accept, resign, offer and claim draws, ask for and grant takebacks, set their own name, picture and preferences, join clubs, block and unblock, export and import records, watch public games. **Cannot** act in a game they are not a player in, **cannot** change another member's name, picture or preferences, **cannot** void a rated game |
| `administrator` | Everything a member can, plus: void a rated game, which recomputes every later rated game of both players and writes an audit entry |

Authorization is enforced **server-side on every endpoint**. Hiding a control in the interface is not authorization: a direct API call from a session that lacks the right is refused by the server and the stored state is unchanged. A game inside a private club answers to a non-member exactly as a game that does not exist, so the answer never confirms the game is real.

## Journeys

1. *Play a rated game.* Sign in as `tobin_reyes` with `gambit-demo-pw-2026`. Open `/challenges`, accept the challenge from `mira_kade`, and land on the game with the board set up. Play a move from the flat board: the piece slides to its square, the move is announced, and the move list grows. Switch to the deep board mid-game: the same position, looked at from your own side. Switch to the square list and play the next move with the arrow keys and the enter key alone.
2. *Finish and be rated.* Play the game to checkmate. The victory screen appears for the winner and the defeat screen for the loser, the losing king topples, and both ratings move by the published step factor from the numbers both players held before the game.
3. *Play the house.* Open `/play`, choose `Play the house` at level `sharp`, and play into a position where mate in one is available: the house plays it. Nothing in the ratings moves.
4. *Dress the board.* Open `/settings`, choose the `Pixel` set and the `Neon` theme, sign out, sign in again from another browser: the board is still `Pixel` on `Neon`.
5. *Talk at the side of the board.* Send a message in a game you are playing. It appears last, under your current name and picture. Open the same game signed in as `wren_oyelaran`, who is not a player: the board is there to watch, and the chat refuses both reading and posting.
6. *Collide.* Two players submit a move for the same turn at the same moment. Exactly one move is played; the other player is told the position has moved on and their board is unchanged.
7. *Void a game.* Sign in as `mira_kade`, open `/admin/games`, void a rated game that both players have since played past, and see every later rated game of both players recomputed in order with the audit entry recording both ratings before and after.
8. *Watch it arrive.* Two members sit at two browsers on the same game, neither touching the page. `mira_kade` plays a move and sends a message; within `5` seconds `tobin_reyes` sees the piece on its new square in whichever view is open and the message at the foot of the chat, without reloading, pressing anything or leaving the page.

**Leaving and returning.** A member who leaves a game for any other page and comes back through the hall's link to that game sees the same position, the same move list and the same whose-turn marker as when they left. Nothing is lost by navigating away: the game is read from the store on every visit rather than held in the page, so a reload, a trip to `/leaderboard` and back, or opening the game in a second tab all show the same position.

**Definition of done.** Two members play a complete rated game with no clock, a move at a time, seeing one position through a flat board, a board with depth and a sixty-four-square grid that plays from the keyboard alone, and switching between the first two mid-game changes nothing. The game ends in checkmate and both ratings move by the published step factor computed from their pre-game numbers. The house opponent answers the same position identically every time, finishes a mate in one at its sharpest, and moves no rating. All four flat sets and all three deep sets visibly change the pieces while every piece keeps its name, all five themes differ plainly and stay readable, and a member's choices survive signing in from another browser. Six distinct animations play on the page inside their duration band, the draw among them naming its own reason, and all six become instant under reduced motion with nothing lost. Castling, en passant, promotion, the repetition and fifty-move claims, insufficient material, the draw offer and the takeback each behave exactly as written. Two moves for one ply leave exactly one move played, and one challenge accepted twice under one key leaves one game. A voided game recomputes every later rated game of both players in order and writes its audit. The record exports with its seven tags in order and correct notation, imports to the exact position, and names the opening by longest match. Chat admits only the two players and refuses the empty, the over-long and the too-frequent. A private club's game is invisible outside it, a blocked member cannot challenge or chat, the unread count is exact, and every request logs one line carrying the identifier it returns.

## Mandatory requirements

- **DP-01 — Deployment and health.** The app answers at `APP_PUBLIC_URL` on `APP_PUBLIC_PORT`, binds `0.0.0.0`, and `GET /api/health` returns `200` once PostgreSQL is readable.
- **DP-02 — Request identifiers.** Every request writes one structured stdout line carrying a `request_id`, and every response returns that value in its own `X-Request-Id` header.
- **DP-03 — Refusals and collections.** A refusal answers in the client-error range with a reason a person can read, and any collection of records is a top-level JSON array.
- **DP-04 — Own origin and scope.** Pages load nothing from another origin, and the product carries no clock, trainer, lesson, payment or advertising.
- **DP-05 — Seed data.** The six seeded members, two clubs, the ban, the block and the four games exist exactly once with the ratings, roles and counts this brief lists.
- **DP-06 — Username shape.** A username outside `3` to `20` letters, digits and underscores is refused with `422`, and a case-variant of a taken name with `409`, creating nothing.
- **DP-07 — Sign in and sign out.** Members sign in by username or email through the `Username` field, member routes send a visitor without a session to `/login`, and signing out ends the token at once.
- **DP-08 — Sign-in lock.** After `LOGIN_MAX_FAILS` refused sign-ins the account answers `423`, even to the right password, until `LOCKOUT_SEC` seconds pass.
- **DP-09 — Profile picture.** A member picks one of `avatar_01` to `avatar_12` or uploads a PNG, JPEG or WebP of up to `2` MB served as a `256` by `256` PNG, with `415`, `413` and `403` refusals storing nothing.
- **DP-10 — Rename everywhere.** A rename shows at once in the game header, on every chat message the member sent and in the `White` and `Black` record tags.
- **DP-11 — Preferences persist.** View, flat set, deep set, theme and sound persist with the account across browsers, start on the flat view with `Classic`, `Marble`, `Forest` and sound on, refuse unknown names, and refuse another member with `403`.
- **DP-12 — Piece sets.** The four flat sets and the three deep sets each visibly change every piece, while every piece keeps one accessible name in every set and view.
- **DP-13 — Board themes.** Each of the five themes keeps its two squares at least `3:1` apart and its coordinate labels at least `4.5:1` against the square they sit on.
- **DP-14 — Deep piece shapes.** Each of the six deep piece types has its own silhouette: a horse-head knight, a rook with battlements, a king with a cross and a queen with a crown of points.
- **DP-15 — Accessibility contract.** Public routes and the game route pass WCAG 2.2 AA, targets are at least `24` by `24` CSS pixels, icon-only controls carry names, focus is visible, and the game route offers `Skip to board`.
- **DP-16 — Responsive layout.** Member routes never scroll sideways at `320`, `360`, `390` and `414` CSS pixels, the board stays square, and at `390` the side column sits under a full-width board.
- **DP-17 — Three views of one position.** The game offers `Flat board`, `Deep board` and `Square list`, draws depth with hardware graphics, carries `64` named squares in its first response, and keeps the position when the view switches.
- **DP-18 — Deep board fit and pointing.** The deep board fits `1440` by `900` and `390` wide without scrolling, plays a move by clicking a piece and then a marked destination, and marks the last move's two squares.
- **DP-19 — Deep board follows the game.** After every move the deep board shows the piece travelling to its new square, and dragging or zooming turns the view without moving any piece.
- **DP-20 — Move announcements.** Every move, the house's included, is announced in a live region in the pinned forms, ending in `, check` or `, checkmate` when the move gives check or mate.
- **DP-21 — Game animations.** The move, capture, promotion, victory, defeat and draw animations each play on the page for between `150` and `1200` milliseconds.
- **DP-22 — Reduced motion.** Under reduced motion no endless animation runs, and the victory, defeat and draw screens keep every word and control.
- **DP-23 — Legal moves.** The server generates every legal move including castling, en passant and each promotion, accepts the coordinate form, and refuses a move leaving the mover's king in check with `422`.
- **DP-24 — Exact position record.** The en passant field names a square only when that capture is available, the halfmove clock resets on a capture or pawn move, and the fullmove number rises after each Black move.
- **DP-25 — Stored moves.** Moves are unique on game and ply, the game's `fen` equals its highest-ply move, and the move list records the move played.
- **DP-26 — Game controls.** The game screen offers `Offer draw`, `Claim draw`, `Ask for takeback`, `Resign` and `Rematch`.
- **DP-27 — Repetition and claims.** Threefold and fifty-move claims draw only once their condition holds and otherwise answer `409`, and fivefold repetition and insufficient material draw automatically.
- **DP-28 — Draw offers.** A draw offer is allowed only on the offering player's turn, expires when the opponent moves, and a second offer while one is open answers `409`.
- **DP-29 — Draw screen.** A drawn game shows `Drawn` with exactly the reason that ended it, so a game drawn by an accepted offer reads `agreement`.
- **DP-30 — Takebacks.** An accepted takeback restores the position, the move count, the repetition history and the claim rights, and accepting with none open answers `409`.
- **DP-31 — Turn order.** A move out of turn and a move into a finished game each answer `409`.
- **DP-32 — Leaving and returning.** A game reopened after a reload or a trip to another page shows the same position and move list, read from the store.
- **DP-33 — Rating formula.** Both ratings move by the standard expectation at step `40`, `20` or `10` from the pre-game numbers, rounded half away from zero, never below `100`, with a trailing `?` under `10` rated games.
- **DP-34 — Voiding.** An administrator's void recomputes every later rated game of both players in order and writes audit rows naming the administrator and the ratings before and after, while a member's void answers `403`.
- **DP-35 — Single winner.** Two moves for one ply leave one `201`, one `409` and one stored move, and a repeated accept under one `Idempotency-Key` returns the same game.
- **DP-36 — House opponent.** The house plays only legal moves, answers one position identically every time, takes a mate in one and an undefended queen at `sharp`, and moves no rating.
- **DP-37 — Rematch.** A rematch swaps the colours and keeps the rated flag of the game before it.
- **DP-38 — Abort and deadline.** A game with no first move inside `FIRST_MOVE_ABORT_SEC` reads `aborted` with no result and no rating change, and a game idle past `MOVE_DEADLINE_SEC` is lost by the player who owed the move.
- **DP-39 — Chat rules.** Chat returns messages in send order with their text verbatim, refuses an empty message and one over `500` characters with `422`, and answers `429` above `CHAT_RATE_LIMIT` messages in `10` seconds.
- **DP-40 — Spectators.** Anyone who is not one of the two players is refused with `403` on reading the chat, posting to it and moving, and the position is untouched.
- **DP-41 — Chat beside the board.** A message shows in the game's chat panel under its sender's current name and picture.
- **DP-42 — Private clubs and bans.** A private club's game answers an outsider exactly as a missing game, and a banned member challenging through the club is refused with `403`.
- **DP-43 — Blocking.** While a block stands the blocked member's challenge and chat to the blocker answer `403`, and unblocking restores both.
- **DP-44 — Notifications.** A challenge, an opponent's move and a chat message each raise the exact unread count, marking one read lowers it by exactly one, and the list and the bell show it.
- **DP-45 — Challenges page.** A received challenge shows on `/challenges` with an `Accept` control that creates the game, and the colour the form sent is the colour the game carries.
- **DP-46 — Live updates.** An opponent's move, chat message, draw offer and takeback request, a new challenge and the unread count each reach an open page without a reload within `5` seconds.
- **DP-47 — Game record.** The record carries the seven tags in order with a `YYYY.MM.DD` date and correctly disambiguated notation, imports to the replayed position, refuses a bad record by line and names the opening by longest match.
- **DP-48 — Members and the leaderboard.** A member's profile splits results by colour and lists finished games with their record links, and the leaderboard orders by rating, games and name behind a `next_cursor`.
- **DP-49 — Not-found page.** A game the member may not see, a game that does not exist and an unknown address show `That game is not here.` inside the club's own chrome.

## Frontend

### Screens and layout

| Route | Purpose | Who |
|---|---|---|
| `/` | The welcome page, which opens on a board | anyone |
| `/login` | Sign in | anyone |
| `/join` | Join the hall | anyone |
| `/hall` | The member's landing page: their games in progress, their challenges | signed in |
| `/play` | Choose a play mode | signed in |
| `/game/<GAME_ID>` | One game, in all three views | signed in, may see the game |
| `/game/<GAME_ID>/record` | The text record, with export and import | signed in, may see the game |
| `/challenges` | Challenges sent and received | signed in |
| `/clubs` | The clubs the member may see | signed in |
| `/clubs/<CLUB_SLUG>` | One club, its members and their roles | signed in, may see the club |
| `/members` | The member directory and search | signed in |
| `/members/<USERNAME>` | One member, with their record by colour | signed in |
| `/leaderboard` | The ranking table | signed in |
| `/notifications` | The member's notifications | signed in |
| `/settings` | Name, picture, view, sets, theme, sound | signed in |
| `/admin/games` | Void a rated game | administrator |

**Information architecture.** Those routes are the whole surface: three public pages, twelve member pages and one administrator page, and no other address exists. Every route loads directly from its own address with its content already in the first response, so a game opens from a pasted link. The club carries no help desk and no support contact page, because there is nobody to staff one; a member with a problem has the club owner in `/clubs`.

**Entry and redirects.** Anyone without a session opening a member route is sent to `/login` and, after signing in, lands on the route they asked for, or `/hall` when they asked for none. Signing out returns to `/`. A game the member may not see, a game that does not exist and an unknown address all show the same not-found page, reading `That game is not here.`, inside the club's own chrome with a way back to `/hall`.

The north star: a warm, unhurried club room where the board is the only thing that matters. Someone opening a game should see the position before they see any chrome, and should always know whose turn it is.

The layout is responsive and holds at every viewport width between `320` CSS pixels and the widest desktop, reflowing at three breakpoints rather than scaling one fixed design: the board, the rail and the side column rearrange around each other as the viewport narrows, and no breakpoint leaves a control unreachable. Nothing scrolls sideways on the hall, the challenges page, the leaderboard, the notification list or the settings page at any of the four pinned narrow widths `320`, `360`, `390` and `414` CSS pixels. At `390` CSS pixels the game screen carries a full-width board with the side column laid under the board and the rail reached through a single menu control. At the widest desktop the board and the marker for the side to move both sit inside the first screenful of the game screen, above the move list and the chat.

Layout is a fixed left rail over the main pane. The rail carries the product mark, then Play, Challenges, Clubs, Members, Leaderboard and Notifications with its unread count, then a search control, then the account block with the member's picture, username and rating, and a menu holding Settings and Sign out. The rail item for the current page is marked in the accent green, and a rail link warms slightly under the pointer. Public pages replace the rail with a slim top bar holding the mark and name at the left and Sign in and a primary Join button at the right. A game screen is the board centred in the pane with the opponent's name, picture and rating above it and the member's own below, a right-hand column holding the move list, the chat and the game controls, and the view switch above the board. Below the mid-size width the right column moves under the board; on a phone the rail collapses behind a menu control and the column becomes tabs under a full-width board. A narrow viewport keeps every destination and every control reachable rather than hiding one behind a layout that assumes a wide screen. The board stays square at every width, and nothing scrolls sideways at the narrowest width: the move list and the record scroll inside their own frames.

### Public screens and controls

Fixed labels the interface carries exactly: the sign-in form has fields labelled `Username` and `Password` and a button reading `Sign in`; the join form adds `Email` and a button reading `Join the hall`; the play menu offers `Play a member` and `Play the house` with the levels `Easy`, `Steady` and `Sharp`; the challenge form has fields labelled `Opponent` and `Colour` and a button reading `Send challenge`; a received challenge offers `Accept` and `Decline`; the game offers `Offer draw`, `Claim draw`, `Ask for takeback`, `Resign` and `Rematch`; an open draw offer or takeback request offers `Accept` and `Decline`; the promotion chooser offers `Queen`, `Rook`, `Bishop` and `Knight`; the view switch reads `Flat board`, `Deep board` and `Square list`; settings groups `Piece set`, `Board theme` and `Sound`; the chat field is labelled `Message` with a button reading `Send`; the record screen offers `Download record` and `Import record`; the leaderboard headings read `Rank`, `Member`, `Rating` and `Games`; the skip links read `Skip to board` and `Skip to content`; a victory screen reads `You won` and a defeat screen `You lost`; a drawn game reads `Drawn`; the not-found page reads `That game is not here.`

**The board, in three views.**

1. A game presents one position through three views, and all three show the same position at every moment. The flat view draws eight ranks of eight squares in the current theme with file letters `a` to `h` and rank numbers `1` to `8` along its edges. The deep view draws the same position in perspective using the browser's hardware graphics, lit so pieces cast shadows onto the squares, with the camera facing the board from the side the viewing player is playing, so a member playing Black looks across the board from Black's end.
2. An accessible board of exactly `64` squares is present in both views, not offered instead of them. Each square is a control whose accessible name is its algebraic name, `a1` through `h8`, extended with its occupant when a piece stands there, for example `e2, White Pawn`. It is fully operable from the keyboard: the arrow keys move between squares, the confirm key selects the piece on the current square and then plays the move to a second selected square, and the escape key cancels a selection. A move made this way is an ordinary move, subject to every rule below.
3. Switching between the flat and the deep view in the middle of a game loses nothing: the position, the move list, whose turn it is and every claim right are identical before and after, and the act of switching sends no move.
4. The deep view fits the viewport it is given. At `1440` by `900` the whole deep board is visible at once, with no part of it outside the viewport and no scrolling needed to reach an edge or a corner square. At `390` wide the deep board fits the width, so nothing is cut off at the left or right and the page does not scroll sideways.
5. The deep view follows the game. After every move, whichever view it was made in, the deep view shows the moved piece standing on its destination square and no longer on the square it left, so the deep board and the accessible square list never disagree about where a piece is.
6. The deep pieces are distinct by shape, not only by colour. Each of the six piece types has its own recognisable silhouette in every one of the three deep sets: a knight reads as a horse head, and the pawn, bishop, rook, queen and king each differ from the knight and from one another. Two different piece types are never drawn as the same shape in different sizes.
7. The deep knight is a horse head with a visible muzzle and ears; the rook carries battlements; the king carries a cross; the queen carries a crown of points. No deep piece type is a plain round turned shape alone.

**Piece sets and themes.**

1. Four sets are offered for the flat view, named exactly `Classic`, `Staunton Flat`, `Neo` and `Pixel`. Three are offered for the deep view, named exactly `Marble`, `Wood` and `Glass`. Choosing a set changes every piece on the board at once and visibly: one position is distinguishable between any two sets. The three deep sets differ in colour and finish rather than shape: `Marble` is a pale polished stone, `Wood` a light soft orange timber over a mid soft orange grain, and `Glass` a translucent treatment that shows the square beneath it.
2. A piece keeps the same accessible name in every set and in every view, so a white knight is announced identically whether it is drawn flat, drawn in perspective, or named in the accessible grid.
3. Five themes are offered, named exactly `Walnut`, `Slate`, `Ocean`, `Forest` and `Neon`. In each theme the light and dark squares differ plainly, and every theme meets WCAG 2.2 AA contrast for the coordinate labels and for any text drawn over a square.

### Interactions

1. A move can be made in the deep view by pointing: clicking a piece of the side to move selects it and marks its legal destinations, and clicking one of those destinations plays that move. The move that results is an ordinary move, subject to every rule below, and it appears in the move list and in the other two views exactly as a move made anywhere else does.
2. A member can turn the deep view around the board by dragging, and zoom with the wheel or a pinch, without the position changing.
3. The deep view marks the last move's two squares and, when a piece is selected, its legal destinations.
4. Every move, including each move the computer plays, is announced in a live region in the exact form `<Piece> to <square>`, extended to `<Piece> to <square>, check` when the move gives check and `<Piece> to <square>, checkmate` when it gives mate. `Knight to f3` and `Queen to h5, check` are the shape.
5. A capture is announced in the exact form `<Piece> takes <square>` and a promotion in the exact form `<Piece> to <square>, promoted to <Piece>`, each taking the same `, check` or `, checkmate` ending when the move gives check or mate. `Bishop takes f7` and `Pawn to e8, promoted to Queen` are the shape. The piece words are `Pawn`, `Knight`, `Bishop`, `Rook`, `Queen` and `King`.
6. A member's view, flat set, deep set, theme and sound setting persist with their account and survive signing out and signing in from a different browser. A new member starts on the flat view, the `Classic` and `Marble` sets, the `Forest` theme, with sound on.
7. One sound plays for each of a move, a capture, a promotion, a victory, a defeat and a draw, six in all, governed by a single sound setting that persists with the member's other preferences. With sound off nothing plays and nothing else changes. No sound plays before the member has interacted with the page.
8. The challenge form offers exactly three colour choices, labelled `White`, `Black` and `Random`. Choosing `White` makes the challenger White in the created game, choosing `Black` makes the challenger Black, and `Random` assigns the colours either way. The choice the form sent is the colour the created game carries: a challenger who picked `Black` is the game's Black player and the opponent is White.
9. Everything another player does reaches an open page without a reload, within `5` seconds: the opponent's move on the game page (all three views), the opponent's chat message, a draw offer with its `Accept` and `Decline` controls, a takeback request, a new challenge on the challenges page, and the notification count. Any mechanism may deliver it.
10. A member's profile page lists that member's finished games, newest first. Each row names the opponent's username, the colour that member played as `White` or `Black`, the result as `1-0`, `0-1` or `1/2-1/2`, and the reason the game ended: `checkmate`, `resignation`, `agreement`, `threefold claim`, `fifty-move claim`, `fivefold repetition`, `insufficient material`, `stalemate`, `deadline` or `void`. Each row links to that game's record at `/game/{game_id}/record`. A game still in progress is not listed, and a member with no finished game shows `No finished games yet.`

### Visual design

The register is warm, dark and confident: a quiet room with one assured green in it, nothing hurried, nothing blinking.

Colour is warm, dark and confident. The page ground is a deep warm neutral, the colour of dark coffee; raised surfaces are a deeper warm neutral a shade below it; panel edges and opaque borders are a mid warm neutral. Primary text is a near-white neutral, secondary text that same near-white neutral at three quarters opacity, and quiet text at half. The accent is a confident mid grass green, used for the primary action, the member's own name and every win state, darkening through a deeper green to a deep forest green when pressed. A loss and a refusal are a vivid warm red, a caution a light vivid amber, a warning a mid vivid orange, a link a clear mid cyan-blue, and a light soft orange, read as a bronze tan, carries a secondary accent. The lightest interface step is a near-white neutral used for a tooltip field and an inverted chip.

The five board themes each pair a light and a dark square, described by family and tone so the exact shades are yours to choose within them. `Walnut` is a near-white muted orange light square, read as pale sand, against a deep muted orange, read as dark walnut. `Slate` is a near-white neutral light square against a mid neutral grey. `Ocean` is a near-white neutral light square against a deep desaturated blue. `Forest` is a near-white warm neutral light square, faintly green, against a deep forest green. `Neon` is a near-white neutral light square against a deep, soft violet. In every theme the two squares differ plainly, by a contrast ratio of at least `3:1` against each other, and the coordinate labels are drawn in a deep warm neutral on the light square and a near-white neutral on the dark one, each at a contrast ratio of at least `4.5:1` against the square it sits on, so both stay comfortably readable. Those three ratios hold in all five themes, `Walnut`, `Slate`, `Ocean`, `Forest` and `Neon` alike. On the board, a selected square glows half-transparent yellow, a legal destination carries a half-transparent teal mark, the last move is tinted, and a king under attack reddens.

Type pairs a solid bookish serif for headings with the system sans for interface and body text, and a monospace stack for square names and the game record. The scale is compact and dense: body text small on a roomy line, interface emphasis the same size at a heavier weight, a card title a step up, a panel heading clearly larger and bold, and one generous screen heading on the welcome page. Corner radius runs from nearly square on a small control, through a slightly rounded board frame and input, to a rounded card and a generously rounded button, a full pill on a chip and a circle on a picture.

Elevation is quiet and warm. A secondary control carries a faint light inset above a soft double drop shadow. A dialog floats on a deep soft shadow with a hairline light edge inside it. A banner over the board glows faintly at its edges. Cards over the board may read as frosted glass: a barely-there top-to-bottom light wash over a blurred backdrop. Interface text sits on a warm one-pixel shadow and a primary button's label on a soft dark one. The primary button is a top-to-bottom green gradient.

Iconography is original line drawings on a twenty-four unit grid in the current text colour, drawn in the page rather than fetched as files: the six piece figures, crossed swords for a challenge, a speech bubble for chat, a bell, a shield for a club, a person and a group, a ladder for the leaderboard, a cube for the deep view, a square grid for the flat view, a keyboard for the square list, a gear, a speaker with and without a wave, a flag for resignation, an equals sign for a draw offer, an arrow curling back for a takeback, and a download and an upload arrow. Every icon-only control carries an accessible name.

Accessibility is contract. Text and the board coordinates meet WCAG 2.2 AA contrast in every one of the five themes. Every control is reachable by keyboard with a visible focus ring. The accessible sixty-four-square board is present in both views and plays a whole game from the keyboard alone. Every move is announced in the live region in the exact form given above. A piece carries one accessible name across every set and view. Interactive targets are at least `24` by `24` CSS pixels. Form errors are announced and tied to their field. Dialogs keep focus inside and return it on close. Colour is never the only signal: check, a selected square and a legal-move hint each carry a non-colour marker too.

The exact shades, radii and motion curves are yours, so long as every rule above holds.

### Motion and effects

Motion is brisk, physical and short. Colour changes under the pointer settle in a seventh of a second, a border or an opacity change in a fifth, a panel opening its rows in three tenths. The six game animations are the heart of it: a piece travels from its old square to its new one; a taken piece fades out while growing past its size; a promoted piece grows past its size and settles back; a victory raises the winning king in a scatter of marks that fade as they fly; a defeat topples the losing king and rests it at an angle; and a draw settles both kings level with each other while the draw screen fades up naming its reason. A king in check pulses gently larger and back. A legal-move hint fades in and out. A dialog arrives by growing from small and settling.

1. Six animations play on the page itself, not only inside the deep view's scene, one distinct animation for each of: a piece moving, a capture, a promotion, a victory, a defeat and a draw. Each one lasts between `150` and `1200` milliseconds. Each of the six, and the check pulse, is a CSS animation, a CSS transition or a Web Animation on a page element, so it is listed by `document.getAnimations()` while it runs; an effect driven frame by frame from a script loop does not count as one of them.
2. A move in the deep view travels: the piece visibly moves through the squares between its start and end (a knight arcs) rather than jumping, and a capture removes the taken piece with a visible exit.
3. When the visitor has asked their computer for reduced motion, all six become instant and no content is lost: the piece appears on its destination square, the captured piece is simply gone, the promoted piece appears at its final size, and the victory, defeat and draw screens appear complete with every word and control they carry, the draw reason included. No endless animation runs under reduced motion: `document.getAnimations()` lists no animation with an infinite iteration count, the check pulse included.

**Victory and defeat, as the member sees them.** A win raises the winning king while a scatter of marks flies outward and fades. A defeat topples the losing king: it rotates over through a fall angle of your choosing and then rests at that angle, where it stays for as long as the finished game is open. Both screens carry their full text and controls, and under reduced motion both appear complete and at once.

### Feedback states

Every list has an empty state saying what to do next: `No challenges yet.` offers a member to challenge, `Nothing new.` stands in for an empty notification list, and an empty club list offers one to join. Every screen has a loading state. A move in flight shows on the board rather than blocking the page. A refusal, a validation error or a lost connection is shown beside the thing that failed and never replaces the page with an error screen.

The draw screen reads `Drawn` and names the reason the game ended in exactly one of these words: `agreement`, `threefold claim`, `fifty-move claim`, `fivefold repetition`, `insufficient material` or `stalemate`. Both players see the same screen and the same reason, and the reason matches the rule that actually ended the game, so a game drawn by an accepted offer reads `agreement` and one drawn by the automatic fifth repetition reads `fivefold repetition`.

## Backend

### API

The operations below are the whole HTTP surface the club offers. A move is always written in the coordinate form: four characters for an ordinary move and five for a promotion, so `e2e4` and `e7e8q`. The position record is always carried in a field named `fen`.

| Endpoint | Request body / query | Returns |
|---|---|---|
| `POST /api/auth/register` | `{username, email, password}` | the created member |
| `POST /api/auth/login` | `{email, password}`, where `email` carries either the member's email or their username | a bearer `token` and the `member` |
| `POST /api/auth/logout` | none | an empty success; the token is ended |
| `GET /api/profile` | none | the caller with `username`, `rating`, `rated_games`, `avatar_url`, `role`, `view`, `piece_set_2d`, `piece_set_3d`, `theme` and `sound` |
| `PATCH /api/profile` | any of `{username}`, `{view}`, `{piece_set_2d}`, `{piece_set_3d}`, `{theme}`, `{sound}`, with the exact values listed under **Preference values** below | the updated member |
| `PUT /api/profile/avatar` | `{avatar}` naming one of `avatar_01` to `avatar_12`, or a multipart form with `file` | the member with its new `avatar_url` |
| `GET /api/games/{game_id}` | none | the game, in the shape given under **The game object** below |
| `POST /api/games/{game_id}/moves` | `{move}` in coordinate form | `201` and the game at its new position; in a house game, or a study game given a level, the house's reply is already played in this same response |
| `GET /api/games/{game_id}/legal-moves` | none | a top-level array of the legal moves of the current position, in coordinate form |
| `POST /api/games/from-fen` | `{fen}`, optionally `{level}`, one of `easy`, `steady` or `sharp` | `201` and a solo study game starting from that position |
| `POST /api/games/{game_id}/draw-offer` | none | the game with its offer recorded |
| `POST /api/games/{game_id}/draw-response` | `{accept}` | the game, drawn or with the offer cleared |
| `POST /api/games/{game_id}/claim` | `{kind}`, one of `threefold` or `fifty-move` | the game, drawn on a valid claim |
| `POST /api/games/{game_id}/takeback` | none | the game with the request recorded |
| `POST /api/games/{game_id}/takeback-response` | `{accept}` | the game at the restored position |
| `POST /api/games/{game_id}/resign` | none | the finished game |
| `POST /api/games/{game_id}/rematch` | none | the new game, colours swapped |
| `GET /api/games/{game_id}/record` | none | the text record |
| `POST /api/games/import` | `{record}` | the imported game |
| `GET /api/games/{game_id}/chat` | none | a top-level array of messages in send order |
| `POST /api/games/{game_id}/chat` | `{text}` | the stored message |
| `GET /api/challenges` | none | a top-level array of the caller's challenges |
| `POST /api/challenges` | `{opponent, rated, colour, club}`: `opponent` is the opponent's username, `rated` a boolean, `colour` the challenger's colour as exactly `White`, `Black` or `Random`, and `club` an optional club slug such as `quiet-room` | `201` and the challenge |
| `POST /api/challenges/{challenge_id}/accept` | none, with an `Idempotency-Key` header | `201` and the game; a replay under the same key answers with that same game |
| `POST /api/computer-games` | `{level}`, one of `easy`, `steady` or `sharp`, optionally `{colour}`, one of `white` or `black` | `201` and the unrated game; the member plays White unless `colour` says `black`, in which case the house's first move is already played in this response |
| `GET /api/clubs` | none | a top-level array of the clubs the caller may see |
| `GET /api/clubs/{club_slug}` | none | one club with its members, their roles and its `private` flag |
| `GET /api/members` | `?q=<query>` | a top-level array of members |
| `GET /api/members/{username}` | none | the member with `rating`, `rated_games`, `rating_display`, and `wins`, `losses` and `draws`, each split by colour into `white` and `black` |
| `GET /api/members/{username}/games` | `?cursor=&limit=` | `{games, next_cursor}`, where each game carries `game_id`, `opponent`, `colour` (`White` or `Black`), `result` (`1-0`, `0-1` or `1/2-1/2`), `reason`, `rated` and `finished_at`, newest first, and only finished games appear |
| `PUT /api/members/{username}/avatar` | `{avatar}` | refused unless the caller is that member |
| `PATCH /api/members/{username}/profile` | any preference field | refused unless the caller is that member |
| `GET /api/leaderboard` | `?cursor=&limit=` | `{members, next_cursor}` |
| `GET /api/notifications` | none | `{notifications, unread}` |
| `POST /api/notifications/{notification_id}/read` | none | the new unread count |
| `POST /api/blocks` | `{username}` | the block |
| `DELETE /api/blocks/{username}` | none | an empty success |
| `POST /api/admin/games/{game_id}/void` | none | the audit entries |
| `GET /api/health` | none | `200` once the app is ready |

**The game object.** Every endpoint that returns a game returns this one JSON object:

- `id`: the game's identifier, a string; the same value is also returned as `game_id`, and it is the `{game_id}` in every game address.
- `fen`: the current position record.
- `turn`: the side to move, exactly `white` or `black`.
- `status`: exactly `in_progress` while the game is being played, `finished` once it has a result, and `aborted` when it was aborted.
- `result`: exactly `1-0`, `0-1` or `1/2-1/2` on a finished game, `*` while it is in progress, and the empty string `""` on an aborted one.
- `end_reason`: why a finished game ended, exactly one of `checkmate`, `resignation`, `agreement`, `threefold claim`, `fifty-move claim`, `fivefold repetition`, `insufficient material`, `stalemate`, `deadline` or `void`, and `null` while the game is in progress or when it was aborted.
- `rated`: a boolean.
- `opening`: the opening name from the table below, or `null` when no line matches.
- `white` and `black`: each an object carrying that player's `id`, `username`, `rating`, `rating_display`, `rated_games` and `avatar_url`; in a house game the computer's side carries the username `The house`.
- `moves`: an array in ply order, each element an object `{ply, uci, san, fen_after, announcement, created_at}`, where `ply` counts from `1`, `uci` is the coordinate form, `san` the algebraic notation, `fen_after` the position record after the move and `announcement` the live-region text for it.
- `draw_offer_by` and `takeback_by`: the username of the player with an open draw offer or takeback request, or `null`.
- `claims`: an object `{"threefold": <boolean>, "fifty-move": <boolean>}` saying whether each claim would succeed now; both are `false` once the game is not in progress.

**Preference values.** The profile's preference fields take and return exactly these values. `view` is one of `flat`, `deep` or `squares`, naming the `Flat board`, `Deep board` and `Square list` views, and a new member holds `flat`. `piece_set_2d` is the set name verbatim, one of `Classic`, `Staunton Flat`, `Neo` or `Pixel`. `piece_set_3d` is one of `Marble`, `Wood` or `Glass`. `theme` is one of `Walnut`, `Slate`, `Ocean`, `Forest` or `Neon`. `sound` is a JSON boolean, `true` for on and `false` for off. Names match exactly, with their capital letters and the space in `Staunton Flat`, and any other value is refused with `422` and changes nothing.

Bearer auth is required on every `/api/` endpoint except register, login and health. The specific refusal codes this brief pins: an illegal move is `422`; a move out of turn, a move in a finished game and an invalid draw claim are `409`; an action the caller is not entitled to take is `403`; an unsupported upload type is `415`; an upload above the size limit is `413`; a locked account is `423`; a chat message above the rate is `429`; a username of the wrong shape and an over-long or empty chat message are `422`; a username already taken ignoring case is `409`. A game that does not exist answers `404`, and a game the caller may not see answers exactly as a game that does not exist. Each chat message carries its sender's current `username` and picture.

### Business rules

**Joining and signing in.**

1. A username is `3` to `20` characters of letters, digits and the underscore only. A name outside that shape is refused as unprocessable with status `422` and nothing is created. Names are unique ignoring letter case, so claiming a name that differs from an existing one only in case is refused as a conflict with status `409`.
2. A member signs in with a password of at least `8` characters and an identifier that is either their email or their username: the sign-in endpoint takes that identifier in a field named `email` and accepts both, matching it case-insensitively, so `mira_kade` and `mira_kade@example.com` both reach the same account. The sign-in form labels that field `Username`, because a username is what a member of this club knows. Signing out ends the session at once: a request carrying the old token afterwards is denied.
3. After `LOGIN_MAX_FAILS` refused sign-ins, that account answers `423` to every sign-in attempt, including one carrying the correct password, until `LOCKOUT_SEC` seconds have passed since the last refusal. Both numbers are read from the environment and neither is written into the source.
4. A member renames themselves and the new name appears everywhere the old one did at once: the game header, every chat message they sent, and the `White` and `Black` tags of the game record.

**Profile picture.**

1. A picture is either one of the twelve supplied avatars, named `avatar_01` through `avatar_12`, or a file the member uploads.
2. An upload is accepted as PNG, JPEG or WebP only, recognised by the file's own leading bytes as well as its name, and only up to `2` MB. Any other type is refused with status `415`. A file above the size limit is refused with status `413`. A member changing another member's picture is refused with status `403`. Nothing is stored on a refusal.
3. Whatever arrives is stored and served as a `256` by `256` PNG, whatever its incoming size or type.
4. The picture is shown beside the username in the game view and beside every chat message.

**Preferences.** A member's view, flat set, deep set, theme and sound setting are returned by the profile endpoint. A member changing another member's preferences is refused with status `403`. A set or theme name outside the lists above is refused.

**Play modes.**

1. A rated game is between two signed-in members. A house game is between one member and the computer opponent at level `easy`, `steady` or `sharp`, and is never rated: no rating moves and no rated-game count changes. In a house game the member plays White unless they ask for Black, and the house replies to each member move inside that same move request, so the house's move is already in the response.
2. The computer opponent is deterministic: the same position at the same level always produces the same reply, so the same position offered twice is answered identically.
3. The computer opponent only ever plays a legal move. At level `sharp` it plays a mate in one whenever one is available in the position, and it captures an undefended queen whenever one is available.

**The rules of chess.**

1. Full legal move generation: every piece's moves, castling on both sides subject to its conditions, capture en passant, and promotion to a queen, rook, bishop or knight. A move leaving the mover's own king in check is not legal and is refused as unprocessable with status `422`.
2. The position record carries the piece placement, the side to move, the castling rights, the en passant target, the halfmove clock and the fullmove number. The en passant field names a square only when an en passant capture is actually available to the side to move, and is empty otherwise: after White answers a black pawn on `e4` by pushing `d2d4`, the field reads `d3`, and after a move that creates no such capture it reads `-`. The halfmove clock counts plies since the last capture or pawn move and resets to `0` on either. The fullmove number starts at `1` and increases by one after each Black move.

   Worked positions, so the exact behaviour is unambiguous. From `4k3/8/8/8/4p3/8/3P4/4K3 w - - 0 1`, White's `d2d4` sets the en passant field to `d3` and Black's `e4d3` then captures en passant, leaving no white pawn on the board. From `6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1`, White's `a1a8` is mate and ends the game `1-0`. From `4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1`, White's `d1d5` captures the undefended black queen. From `6k1/4P3/8/8/8/8/8/4K3 w - - 0 1`, White's `e7e8n` promotes to a knight. From `4k3/4n3/8/8/8/8/8/4R1K1 b - - 0 1` the black knight on `e7` is pinned by the rook on `e1`, so every one of its moves, `e7c6`, `e7g6`, `e7c8`, `e7g8`, `e7d5` and `e7f5`, is refused as illegal. From `4k3/8/8/8/8/8/8/1N2KN1r w - - 0 1`, the knight on `f1` is pinned along the first rank, so only the knight on `b1` can reach `d2` and the move is written `Nd2` with no file letter. From `4k3/8/8/8/8/8/6K1/R6R w - - 0 1`, both rooks can reach `d1`, so `a1d1` is written `Rad1`. From `4k3/8/8/3b4/4p3/3B4/8/4K3 w - - 0 1`, material is not yet insufficient; White's `d3e4` captures the last pawn and leaves a king and bishop against a king and bishop on same-coloured squares, which draws at once. From `r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1`, the line `e1f1`, `e8f8`, `f1e1`, `f8e8` returns the pieces to their starting squares but each king has given up its castling rights, so the position is not a repetition of the first and a claim is refused. The standard starting position has exactly `20` legal moves.
3. A position repeats another only when the piece placement, the side to move, the castling rights and the en passant rights all match. A position differing in any one of those four is a different position.
4. Threefold repetition and the fifty-move rule end a game only when a player claims them. A claim made before its condition holds is refused as a conflict with status `409`. Fivefold repetition ends the game as a draw automatically, with no claim. Insufficient material ends the game as a draw automatically, including a king and bishop against a king and bishop where both bishops stand on squares of the same colour.
5. A draw offer may be made only on the offering player's own turn. It expires the moment the opponent moves. A second offer made before the first is answered or expires is refused as a conflict with status `409`.
6. A takeback requires the opponent's consent. An accepted takeback restores the position, the move count, the repetition history and the eligibility to claim a draw to exactly their state before the move taken back. Accepting a takeback when none is pending is refused as a conflict with status `409`.
7. In a game between two members, a move submitted when it is not the caller's turn is refused as a conflict with status `409`. A move submitted into a finished game is refused with `409` in every game, whoever sends it.
8. A study game is the one exception to the turn rule, and it exists so a position can be worked through. `POST /api/games/from-fen` creates a study game owned by its creator alone: no opponent, never rated, invisible to everybody else, and its creator moves for **both** colours in turn, so a legal move for the side to move is accepted whichever colour that is. Every other rule still holds inside it exactly as written: legality, the position record, the repetition and fifty-move claims, insufficient material and the finished-game refusal. Given a level, the creator plays the side to move in the given position and the house plays the other side at that level: each legal move the creator submits is answered by the house's reply, played and stored before the move response returns, so the `201` response already shows the house's move. Given none, the creator plays both sides.

**Ratings.**

1. A rated result moves both ratings by the standard expectation from the difference between them. The step factor is `40` while a player has fewer than `30` rated games, `20` while their rating is below `2400`, and `10` at `2400` and above.
2. Both players' changes are computed from their pre-game ratings, so neither player's new rating feeds the other's calculation and the pair is symmetric.
3. A fractional change is rounded half away from zero, so `0.5` becomes `1` and `-0.5` becomes `-1`.
4. A rating never falls below `100`: a change that would take it lower leaves it at `100` exactly, and the winner's gain is unaffected by the loser's clamp. A member with fewer than `10` rated games is shown with a trailing `?` on their rating everywhere it appears, including the `rating_display` field.
5. An administrator voids a finished rated game between two members. The voided game keeps its `status` of `finished` and its `result`, becomes `rated` false and takes the `end_reason` `void`. Voiding recomputes every later rated game of both players, in the order they finished, starting from the ratings both players held before the voided game: each later game is rescored from the recomputed pre-game numbers of both its players, and the opponent in each of those later games has their rating carried through that recomputation too, but games that involve neither voided player are not replayed. Both players of the voided game lose that game from their count, so each one's `rated_games` drops by exactly one and the step factors of their later games are recomputed from those reduced counts; an opponent's `rated_games` does not change. The endpoint writes one audit row per player of the voided game, recording the administrator, the game and that player's rating before and after the void, and returns them. A member attempting to void is refused with status `403`, and voiding a game that is not a finished rated game between two members answers `409`.

**Challenges, concurrency and resolution.**

1. A member challenges another member, optionally through a club, choosing a colour or leaving it to be assigned, and marking the game rated or not. Accepting the challenge creates the game.
2. Accepting the same challenge twice carrying the same `Idempotency-Key` header returns the same game and creates no second game.
3. Two moves submitted for the same ply must not both be played: exactly one answers `201` and the other answers `409`, in either arrival order and however close together they arrive. The refused one leaves the position untouched.
4. A rematch creates a new game between the same two members with the colours swapped and the same rated flag as the game it follows.
5. A game with no first move within `FIRST_MOVE_ABORT_SEC` seconds is aborted and unrated: its status becomes exactly `aborted`, its result is empty because nobody won or drew, its rated flag is false, and neither player's rating nor rated-game count moves by even a point. An abort is not a result and is never scored. A correspondence game with no move within `MOVE_DEADLINE_SEC` seconds is lost by the player who owed the move. Both are settled when the game is next read, and both values are read from the environment.

**Chat.**

1. A game's chat is for its two players. Messages appear in the order they were sent.
2. Only the two players may read or post. Anybody else, including somebody who can see the game as a spectator, is refused with status `403`.
3. An empty message, and a message longer than `500` characters, are each refused as unprocessable with status `422` and nothing is stored.
4. Message text is shown as plain text and never interpreted: a message containing `<script>alert(1)</script>` shows those characters literally.
5. A player may send at most `CHAT_RATE_LIMIT` messages in any `10` seconds, read from the environment. A message above that rate is refused with status `429`.

**Clubs, spectators and blocking.**

1. A spectator may view a public game and may not act in it: a move or a chat message from anybody who is not one of the two players is refused with status `403`.
2. A club has a name, a slug, a visibility of public or private, and members in one of the roles `owner`, `moderator` or `member`. A game belonging to a private club is visible only to that club's members; to anybody else it answers exactly as a game that does not exist.
3. A member banned from a club is refused with status `403` when they challenge through it.
4. A member may block another member. While the block stands, the blocked member challenging or chatting the blocker is refused with status `403`. Unblocking restores both.

**Notifications.**

1. A notification is created when a member receives a challenge, when their opponent moves, and when a chat message arrives for them. A notification for a challenge names the challenger.
2. A member sees their exact unread count, in the API and on the bell, and marks a notification read, which lowers that count by exactly one and never below zero.

**The game record.**

1. A game exports as a text record carrying the seven standard tags in the standard order: `Event`, `Site`, `Date`, `Round`, `White`, `Black`, `Result`. The `White` and `Black` tags carry the players' current usernames. The `Date` tag is the game's start date in Universal Coordinated Time, formatted `YYYY.MM.DD`. The `Result` tag, and the game's own result field, carry exactly `1-0` when White wins, `0-1` when Black wins, `1/2-1/2` when the game is drawn and `*` while it is unfinished.
2. The move text uses standard algebraic notation, correctly disambiguated: where two identical pieces could reach one square the mover's file or rank is added, and a piece that could not legally move because it is pinned does not create that ambiguity. A move giving check carries a trailing `+` and a move giving mate a trailing `#`.
3. A valid record imports as a game whose final position record equals the position reached by replaying it. An invalid record is refused as unprocessable with status `422`, and the refusal names the line that failed.
4. A game's opening name comes from the application's own pinned table of openings, matched by the longest leading sequence of moves present in it. The table, written in the coordinate move form:

| Opening | Moves |
|---|---|
| `Italian Game` | `e2e4 e7e5 g1f3 b8c6 f1c4` |
| `Ruy Lopez` | `e2e4 e7e5 g1f3 b8c6 f1b5` |
| `Scotch Game` | `e2e4 e7e5 g1f3 b8c6 d2d4` |
| `Sicilian Defence` | `e2e4 c7c5` |
| `French Defence` | `e2e4 e7e6` |
| `Caro-Kann Defence` | `e2e4 c7c6` |
| `Queens Gambit` | `d2d4 d7d5 c2c4` |
| `Slav Defence` | `d2d4 d7d5 c2c4 c7c6` |
| `London System` | `d2d4 d7d5 g1f3 g8f6 c1f4` |
| `English Opening` | `c2c4` |

**Members and the leaderboard.**

1. A member's profile shows wins, losses and draws split by the colour they played.
2. The leaderboard orders members by rating descending, then by games played with the larger count first, then by username ascending. It pages by cursor and returns a `next_cursor`.

### Services

PostgreSQL is the only backing service, already running and reachable at `DATABASE_URL`. Do not download, install, compile or start a copy of it. Use no other provider, no edge functions, no object store and no email: nothing is sent anywhere.

PostgreSQL is the fact. An in-memory dictionary standing in for a table, a JSON file on the app container's filesystem, or a cached reply that answers its own call instead of reading the stored rows are each a contract violation however good the interface looks. Legal moves, claim availability, repetition counts, ratings, a member's record by colour and the leaderboard order are computed from the stored rows at the moment they are asked for. The interface can only reflect what lives in PostgreSQL, never substitute for it.

Eleven tables. All timestamps are UTC.

**`members`** `id`, `username` unique ignoring case, `email`, `password_hash`, `rating`, `rated_games`, `avatar_key`, `role` (`member` or `administrator`), `view`, `piece_set_2d`, `piece_set_3d`, `theme`, `sound`, `created_at`.

**`sessions`** `id`, `member_id`, `token_hash`, `created_at`.

**`games`** `id`, `white_id`, `black_id`, `club_id` nullable, `rated`, `level` nullable for a house game, `fen`, `status`, `result`, `opening`, `draw_offer_by` nullable, `takeback_by` nullable, `created_at`, `last_move_at`.

**`moves`** `id`, `game_id`, `ply`, `uci`, `san`, `fen_after`, `created_at`; unique on `game_id` and `ply`.

**`chat_messages`** `id`, `game_id`, `member_id`, `text`, `created_at`.

**`challenges`** `id`, `from_id`, `to_id`, `club_id` nullable, `rated`, `colour`, `status`, `idempotency_key` nullable unique, `created_at`.

**`clubs`** `id`, `name`, `slug` unique, `private`.

**`club_memberships`** `club_id`, `member_id`, `role` (`owner`, `moderator` or `member`), `banned`; unique together.

**`blocks`** `blocker_id`, `blocked_id`, unique together.

**`notifications`** `id`, `member_id`, `kind`, `game_id` nullable, `read`, `created_at`.

**`rating_audit`** `id`, `game_id`, `admin_id`, `member_id`, `rating_before`, `rating_after`, `created_at`.

**`login_attempts`** `id`, `username`, `succeeded`, `attempted_at`.

Moves are insert-only, numbered contiguously from `1` within a game, and unique on their game and ply. A game's `fen` always equals the `fen_after` of its highest-ply move, or the standard starting position when it has none. Two moves submitted for one ply must not both land: exactly one is stored and the other is refused, and neither leaves a partial change.

Derived rather than stored: the legal moves of a position, whether a claim is available, the repetition count of a position, a member's wins, losses and draws by colour, and the leaderboard order.

### Seed data

**Every seeded account uses the password `gambit-demo-pw-2026`.** It is benchmark fixture data, not a secret. Hash it as normal; the exact literal must work at sign-in, and it must be written into `/app/USER_README.md` beside each username.

Seeded members, each holding the email `<username>@example.com`, so `mira_kade` holds `mira_kade@example.com`: `mira_kade`, rating `1480`, `42` rated games, administrator; `tobin_reyes`, rating `1515`, `37` rated games; `wren_oyelaran`, rating `2412`, `64` rated games; `jules_amari`, rating `1190`, `6` rated games; `nadia_serrano`, rating `108`, `31` rated games; `ivo_lindqvist`, rating `112`, `33` rated games.

Two clubs: `Open Hall`, slug `open-hall`, public, with every member in it and `mira_kade` as its `owner`; and `Quiet Room`, slug `quiet-room`, private, with `mira_kade` as `owner`, `tobin_reyes` as `moderator` and `jules_amari` as `member`, and `nadia_serrano` banned from it. Four games: one finished rated game between `mira_kade` as White and `wren_oyelaran` as Black, won by White, with its moves stored and its opening named; one rated game in progress between `mira_kade` as White and `tobin_reyes` as Black, five moves played, White to move, in `Open Hall`; one rated game in progress inside `Quiet Room` between `tobin_reyes` and `jules_amari`; and one unrated house game of `jules_amari` at level `steady`. One pending challenge from `mira_kade` to `tobin_reyes`, rated. One block: `nadia_serrano` has blocked `jules_amari`. Chat messages in the two in-progress member games, two each, in a known order.

Seeding must be idempotent: restarting the app must not duplicate a row.

## Technical requirements

### Deployment

- The app must be reachable at `APP_PUBLIC_URL` and answer on the port `APP_PUBLIC_PORT` names; `4173` is the default internal port. Read both from the environment; never hardcode either.
- Ship a run manifest `run.json` at the app root holding the string fields `install`, `build` and `serve`: the commands that install dependencies, build the production bundle (empty when there is nothing to build) and start the server in the foreground.
- The HTTP API is served on that same origin under the `/api` prefix: the app is its own same-origin application host for pages, the API and media files.
- `GET /api/health` returns `200` once the app is ready and its store is readable.
- The app starts from the run manifest with no manual steps, serving a production build behind a static or preview server, never a dev server. A page the app serves never loads a development client such as `/@vite/client`.
- Bind `0.0.0.0`, never `127.0.0.1` or `localhost`. A loopback-only listener is unreachable from outside the container.
- Login credentials, or an explicit statement that there are none, are written to `/app/USER_README.md`.
- Reserved `.browser_screenshots/` and `.downloads/` directories exist at the app root, empty.

### Configuration and secrets

`DATABASE_URL` addresses PostgreSQL. The app's own address comes from `APP_PUBLIC_URL` and the port it answers on from `APP_PUBLIC_PORT`. `LOGIN_MAX_FAILS`, `LOCKOUT_SEC`, `CHAT_RATE_LIMIT`, `FIRST_MOVE_ABORT_SEC` and `MOVE_DEADLINE_SEC` come from the environment too. None of these is ever written into the source.

Sessions are the app's own: a username, a hashed password, a token and nothing bought in from a third party. No social or third-party sign-in and no two-factor sign-in.

### Server boundary

The app is server-rendered with interactive parts: the first response carries the position and the page's headings already in the document, and the board, the chat, the move list and the view switch become interactive after that.

**What the backend owns.** Every table and every write to it; the seed, run once and idempotently; sign-in, password hashing, the session token and the sign-in lock; the authorization decision on every endpoint, answering an unviewable game exactly as a missing one; legal move generation and the exact position record; the repetition history and every claim decision; the draw offer and the takeback; the single winner of two moves racing for one ply; the rating change and the void recomputation; the computer opponent's reply; chat with its order, its limits and its rate; notifications and their counts; the record export, import and the opening match; the leaderboard order and its cursor; `GET /api/health`; and one request line on standard output.

**What the front end owns.** The three views of the board, the piece sets, the themes, the six animations, the sounds, the accessible square grid and its keyboard handling, the live-region announcement, and the whole visual system above. It decides nothing about whether a move is legal, whose turn it is or whether a claim holds: the server refuses the call regardless of what the page drew.

Observability is part of the contract. Every request writes exactly one structured log line to stdout, and that line carries a `request_id` field. The same `request_id` value is returned to the caller in an `X-Request-Id` header, so one request can be followed from the response back to its structured logs, and no two requests share one. Structured logs go to stdout and nowhere else: no log file, no second sink and no logging vendor.

Concurrency is part of the contract too, stated as what a caller observes rather than how the store achieves it. When two moves for the same ply arrive at the same moment, exactly one succeeds: one caller receives `201` with the new position and the other receives `409 Conflict`, and the stored game holds a single move at that ply. The same single-winner outcome holds for two members accepting one challenge at once, and for a draw claim arriving twice. On an idempotent replay, a second accept carrying the `Idempotency-Key` of the first returns the same game and must not create a second game: there is no duplicate game, no second rating change and no second notification, however many times the call is replayed.

Data at scale is part of the contract, and the ladder is where it shows. The leaderboard takes its page size on the query string as `limit=`, defaults to `50` members when no size is given, and never returns more than `100` members however large a size is asked for. Every page returns an `opaque cursor` beside its members, carrying no readable offset a client could guess or increment, which the caller passes back to read the following page without repeating a member. The response metadata names that token `next_cursor`, and the final page returns it as null, so a caller walks the whole ladder to its end without ever reading it all at once. A cursor value that was never issued is refused rather than silently treated as the first page. That same `limit=` and `opaque cursor` pair governs the member directory, the move list and the chat transcript, so no read in the club can ever return an unbounded collection. The member directory, the move list and the chat transcript each answer from an indexed read rather than loading a whole table, and the club stays responsive with a few thousand members and tens of thousands of stored moves.

Refusals answer in the client-error range, carry a reason a person can read, and leave the store exactly as they found it. Anything returning a collection of records returns it as a JSON array at the top level.

### Browser support and performance

The app targets current Chromium at desktop and phone widths, with WebGL for the deep view. A game screen's first view arrives with its position already in the document, the deep view holds a smooth frame rate on a machine without a dedicated graphics card, the leaderboard pages at `50` members, and the member directory answers within `300` milliseconds over `5000` members.

The app loads no third-party script, font, tracker or advertisement, and makes no external network call at run time: every font, image and sound file is served from the app's own origin. Zero-asset substitution: the app ships no borrowed image, logo, illustration, font file or sound. The piece sets, the twelve avatars and the board artwork are original or public-domain work, vendored under the app's own origin and listed in a manifest carrying each file's licence and the hash of its bytes. The board is drawn in the page from its theme colours rather than served as a picture. Fonts are the serif and system stacks named above, which need no file at all.

## Working rules

- **IF-01.** Write the seeded credentials into `/app/USER_README.md` beside each username, and leave the reserved `.browser_screenshots/` and `.downloads/` directories at the app root.
- **IF-02.** Ship `run.json` at the app root with string `install`, `build` and `serve` fields and a non-empty `serve` command.

There are no clocks and no time controls anywhere in the product: no countdown, no increment, no flag fall. The only deadlines are the two environment-driven abort and move deadlines, settled when a game is next read.

One club, one deployment. No payments, no subscriptions, no advertising and no tracking of any kind, so no cookie banner. No puzzle trainer, no lesson path, no drill exercises, no live broadcast viewing and no streaming, none of which belongs in a club for playing games against people. No alternative board variants: this is chess on an eight by eight board with the standard army. No engine analysis, no evaluation bar, no move suggestion and no opening explorer beyond the pinned opening table. No tournaments, no arenas, no team matches and no vote games. No friend requests, no direct messages outside a game and no public forum. No native app. No file storage beyond the vendored media the app serves itself.

**Where a gap is allowed, and where it is not.** Two things in this brief are deliberately left to you, and nothing else is: the exact shades inside each named colour family, and the exact motion curves inside each named duration band. Every other value here is binding as written. Where this brief names no mechanism, choose one; where it names a literal, a status code, a label or a name, use that literal exactly. An evidence gap in your own build is not a licence to substitute a different rule: a requirement you cannot satisfy is a requirement to satisfy, not one to reinterpret.

## Engineering standards

- Keep the rules of chess, the rating arithmetic and the record format in one server-side module each, with no copy in the browser deciding legality.
- Every write that must be single-winner is enforced by the store (a unique constraint or a row lock), not by a check-then-write in application memory.
- Validate every request body at the boundary and answer a refusal before any write.
- No secret, connection string or environment value is written into the source or served to the browser.
- Structured logs go to stdout only, one line per request.
- Every page is usable from the keyboard alone, and every control carries an accessible name.
