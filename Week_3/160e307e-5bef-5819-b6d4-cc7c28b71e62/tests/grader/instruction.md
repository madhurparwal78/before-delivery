# Tamarind Lane Games Due Coin

Due Coin is a free browser game of singles carrom, one player against one player, from Tamarind Lane Games. Two people can play on one device by passing it across the table, or play online through a private room code or the casual and ranked queues. The server rules every online shot with a published deterministic physics model and the laws of carrom. It explains each ruling in plain words, keeps every finished match's result, board scores and rating change in the player's history, and says so plainly when its database or mail service can't be reached. The app is one TypeScript server with its browser client. It uses PostgreSQL as its only datastore and a Mailpit SMTP sink for magic sign-in links. Out of scope: Google sign-in, error tracking, analytics, installable-app features, service workers, sound, cross-region matching, AI or LLM features, API keys, real money and payments, spectating, replays, friends lists, doubles, bots, free-text chat and country leaderboards. Chalk is earned by playing and is never bought.

## Problem and users

Millions of people grew up playing carrom on a real board and now play it on phones in apps full of ads. Those apps decide pockets, fouls and the queen without showing why. The complaints repeat: a "connection lost" screen that never reconnects, a loss recorded with no way to see what happened, cheating nobody can check, and adverts after every match. Players lose the ratings they built and the cosmetics they earned. Players who know the real rules find them simplified or applied silently. Those rules include the striker touching both baselines, the queen covered by the next pocket or returned to the centre, a pocketed striker costing a due coin, queen points stopping at 22, and a game to 25 points or eight boards. Due Coin rules every online shot on the server, explains the ruling the moment it is made, and never quietly loses a match.

- **Player** (daily): plays rated online singles, sees each shot's verdict and keeps an honest history with rating changes.
- **Room host** (weekly): creates a private room code, shares it with one friend and plays an unrated match before the code expires.
- **Pass-and-play pair** (weekly): plays a full game on one device, handing it across the table between turns.
- **Collector** (occasional): earns chalk from matches and spends it on striker skins, board themes and coin sets that stay unlocked on every device.

## Journeys

1. **First visit.** A new visitor opens `/` with no session. The server creates a guest and sends them to `/welcome`. They type a name, pick one of 24 avatars and press Continue, or press Skip to get a `Guest-` name. They land on the home page with their name in the profile link, and it is still there after a reload.
2. **Pass and play.** From home, a pair opens Pass and play, chooses Quick or Classic, types two names and starts. They take turns on one device: the board turns to face whoever is shooting and the field changes colour between tomato and cobalt. They play until a winner or a resignation. The result is saved to the device owner's history, or kept on the device with a published sentence when the server can't record it.
3. **Private room.** A host creates a room and gets a 6-character code and link. A friend opens the link and joins, then each of them presses Ready. The toss names the breaker, and both browsers then show the same match. Every shot is ruled by the server and appears on both screens. When it ends, both can rematch in the same room. A third person opening the link is told the room is full.
4. **Ranked play.** A guest presses Play ranked and is asked to link an email. A sign-in link arrives by mail, and opening it links the email. The player enters the ranked queue, watches the rating band widen until an opponent is found, and plays. The match-over dialog and the profile history both show the rating change.
5. **A shot, refereed.** On their turn a player places the striker, aims and sets power by keyboard, mouse or touch, then strikes. Both screens show "refereeing" until the server rules. Then the pieces move along the server's path, a single verdict word lands with its explanation, and either the same player shoots again or the field wipes to the opponent's colour.
6. **Board and match end.** A player pockets their last coin. The Board over sheet names the board winner and explains the points, and the next board starts from the opening layout. When a player reaches 25 points, or after eight boards, the Match over dialog states the final score, rating change and chalk earned.
7. **Dropped connection.** One player's connection drops in an online match. Their page says it is reconnecting and the opponent sees a countdown. If they return within the window, they get their seat back with the same board. If they don't, the opponent wins by forfeit.
8. **Collector.** A player opens the shop, buys a striker skin with chalk and equips it. The opponent sees that skin on their next match. The purchase is charged exactly once, even when the button is tapped twice.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Guest session and welcome** A first visit to `/` gets the `dc_session` cookie and lands on `/welcome`, and pressing `button "Continue"` with a typed name and `radio "Avatar 7"` selected lands on `/` with `link "<name> profile"`, keeping the same name and avatar 7 after reload and in `GET /api/me`.
- **DP-02 — Welcome by keyboard alone** Using only the keyboard, a player tabs to `textbox "Name"`, types a name, selects avatar 7 with arrow keys inside `radiogroup "Avatar"`, presses Enter, and lands on `/` with focus on the page's `h1`.
- **DP-03 — Taken name suggestions** A taken name shows `alert` `#name-error` with `That name is taken. Try one of these:` and three suggestion buttons, and choosing one by keyboard fills `textbox "Name"` so that Continue then succeeds.
- **DP-04 — Name error for screen readers** When a name is refused the alert is announced and `textbox "Name"` carries `aria-invalid="true"` and an `aria-describedby` that points at `#name-error`.
- **DP-05 — Welcome on a phone** At 375x812 with touch the avatars form a 4-column grid with every avatar radio at least 44 px square, the page never scrolls sideways, and `button "Skip"` gives a name of `Guest-` followed by 4 digits.
- **DP-06 — Name rules** `POST /api/me/name` accepts 3 to 16 letters, digits or underscores that are unique ignoring case and not blocked, and otherwise answers `422 NAME_INVALID`, `409 NAME_TAKEN` or `422 NAME_BLOCKED` with three free suggestions, as qualified in API.
- **DP-07 — Keyboard striker placement** With `#board` focused on the viewer's turn, ArrowRight ten times then Shift+ArrowLeft four times shows `Striker 8.0 mm`, `slider "Striker position"` with `aria-valuetext` `8.0 mm` and `piece-striker` with `data-x="8.0"`, and the offset never passes 200.0.
- **DP-08 — Keyboard aim and aim guide** D five times then Shift+A three times shows `Aim 4.7 degrees`, and on the opening layout `#aim-guide` reports `data-first-contact="w5"` at offset 0.0 with aim 0.0 and `cushion` at offset -200.0 with aim 0.0.
- **DP-09 — Keyboard power and reset** W ten times shows `Power 20%`, S back to 0 disables `button "Shoot"`, and Escape returns the readouts to `Aim 0.0 degrees` and `Power 0%`.
- **DP-10 — Opponent sees the live ghost striker** While one player aims, the opponent's page shows `#ghost-striker` at 40 percent opacity following the striker within 1 second, with the opponent's own aiming controls disabled and `#turn-text` reading `<name>'s turn`.
- **DP-11 — Shot ruled the same on both screens** Space shoots and `#match-root` shows `data-phase="refereeing"` until the ruling, after which both players' pages end with identical piece `data-x` and `data-y` values and both `#announcer` logs carry the same verdict line, never before the ruling arrives.
- **DP-12 — Shot submission rules** `POST /api/matches/<id>/shots` returns the stored result for a resent current `shotSeq`, refuses other shots with `NOT_YOUR_TURN`, `TURN_EXPIRED`, `STALE_SEQ`, `INVALID_INTENT` or `CLIENT_OUTDATED`, and answers `429 RATE_LIMITED` to more than 15 previews in a second, as qualified in API.
- **DP-13 — Match screen on a phone** At 375x812 with touch the whole square board with all four pockets is in view, the score rail is a strip above the board, `button "Shoot"` is at least 44 px in both directions and the page never scrolls sideways.
- **DP-14 — Touch drag moves the striker** A touch drag that starts on the striker moves it along the baseline by the dragged distance in board millimetres within 2 mm, with its `data-y` unchanged.
- **DP-15 — Fine striker slider on touch** The handle of `slider "Striker position"` is at least 48 px, and one ArrowRight on the slider moves the striker 0.5 mm.
- **DP-16 — Touch pull-back sets aim and power** A touch pull-back of half the maximum pull straight toward the shooter shows `Power 25%` within 1 point and `Aim 0.0 degrees` while held, with `#aim-guide` shown.
- **DP-17 — Pull-back cancel shoots nothing** Bringing the touch back within 8 px of the press point sets the power to 0, and releasing sends no shot: `data-shot-seq` stays the same and `button "Shoot"` is disabled.
- **DP-18 — Illegal placement shown** With `w1` at (40.0, 252.1), setting the striker slider to 10.0 sets `piece-striker` `data-legal="false"`, draws the striker in its danger ring, disables `button "Shoot"` and shows `#placement-message` `Striker overlaps a coin.`
- **DP-19 — Keyboard steps across the legal edge** From offset 0.0, Shift+ArrowRight steps keep the placement legal up to 3.5 and make it illegal at 4.0, and Shift+ArrowLeft back to 3.5 makes it legal and enables Shoot again.
- **DP-20 — Illegal placement shake** Entering an illegal spot shakes the striker's outline 4 px side to side twice within 120 ms.
- **DP-21 — Illegal placement with reduced motion and announcement** With reduced motion the outline does not move and its colour changes at once, and `Striker overlaps a coin.` is announced once in `#announcer` each time the striker enters an illegal spot.
- **DP-22 — Illegal placement on a phone** At 375x812 with touch the same message and danger ring show, and tapping the disabled `button "Shoot"` sends no shot.
- **DP-23 — Placement legality on the server** A shot whose striker centre is less than 36.15 mm from any coin or the queen answers `422 ILLEGAL_PLACEMENT`, and a distance of exactly 36.15 mm is legal.
- **DP-24 — Pass-and-play setup by keyboard** On `/play/local`, using only the keyboard, a pair selects `radio "Classic"` with arrow keys, types both names, toggles `switch "Turn the board each turn"` off and on with Space, presses Enter on `button "Start"`, and sees `<Player 1 name>'s turn` with `#board-rotator` `data-rotation="0"`.
- **DP-25 — Break misses in pass-and-play** Three low-power break shots that touch nothing (W once, then Space) show `Break missed. Attempt 2 of 3.`, then `Break missed. Attempt 3 of 3.`, then `Break missed 3 times. Turn passes.` with the second player's turn.
- **DP-26 — Board turns to the shooter** With the switch on, a turn change turns `#board-rotator` through in-between angles over about half a second until `data-rotation="180"`.
- **DP-27 — Board turn and skip with reduced motion** With reduced motion the board shows no in-between angle and crossfades in about 150 ms to the same `data-rotation`, and without reduced motion `button "Skip shot"` or K jumps moving pieces to their final positions.
- **DP-28 — Resign a pass-and-play match and save it** Menu, Resign and `dialog "Resign this match?"` work by keyboard with Tab kept inside and Escape keeping play, and confirming shows `dialog "Match over"` with `<name> wins` and `Saved to your history.`, after which the profile history shows a `Pass and play` row after reload.
- **DP-29 — Pass-and-play result replayed on the server** `POST /api/local-matches` replays the shot log with the shared model and answers `201` only when the claimed winner and scores match, `422 RESULT_MISMATCH` with nothing recorded otherwise, and the stored response for a repeated `idempotencyKey`.
- **DP-30 — Early queen returned** When the queen is pocketed and the shooter has no own coin pocketed, she returns to (0.0, 0.0) on both players' pages with `RETURNED` and `Queen returned. Pocket one of your own coins first.`, and the turn passes live on the other page.
- **DP-31 — Queen awaiting cover** With two own coins already pocketed, pocketing the queen alone shows `POCKETED`, `Queen pocketed. Cover her with your next pocket.` and `#queen-status` `Awaiting cover by <name>`, and the same player shoots again.
- **DP-32 — Queen not covered** If the next shot pockets nothing, the screen shows `RETURNED` and `Queen not covered. She returns to the centre.`, the queen goes back to the centre, the turn passes, and the opponent's `#announcer` carries that line.
- **DP-33 — Queen covered** An own coin pocketed on the cover shot, or together with the queen, shows `COVERED`, `Queen covered.` and `#queen-status` `Covered by <name>`.
- **DP-34 — Verdict word motion and reduced motion** `#verdict-word` scales in only after the ruling arrives, and with reduced motion it appears at full size at once with the same announcement.
- **DP-35 — Striker foul owes a due** A pocketed striker with no own coin pocketed and none to return shows `FOUL`, `Foul: striker pocketed. One due coin is owed.` and `Dues owed: 1`, and the turn passes.
- **DP-36 — Due paid with the next pocket** When that player later pockets an own coin, the screen shows `Due paid: one coin returns to the centre. Shoot again.`, puts the coin on its published return spot and shows `Dues owed: 0`.
- **DP-37 — Foul with own coins pocketed** When the striker and an own coin are pocketed while one own coin is already down, both coins return to the published return spots, the shooter keeps the turn, and the screen shows `Foul: striker pocketed. Your pocketed coins return with one due coin. Shoot again.`
- **DP-38 — Verdict banner timing** `#verdict` slides in when the ruling arrives and leaves after the verdict banner time, and a second verdict that arrives while the first is leaving stays visible for its full time.
- **DP-39 — Foul banner on a phone and announced** At 375x812 the verdict banner fits inside the viewport with `Dues owed: <n>` still readable, and the foul line is announced exactly in `#announcer`.
- **DP-40 — Return spots** Returned pieces go to the centre spot if it is free and otherwise to the first free point of the published spiral, the queen first and then coins in id order.
- **DP-41 — Board won with the covered queen** In a Classic match on board 3 at 10-4, when the shooter has covered the queen and pockets their last coin with 4 opponent coins left, `dialog "Board over"` opens with `<name> wins board 3` and `7 points: 4 coins left + 3 for the queen`, and the shooter's `#score-<seat>` shows 17.
- **DP-42 — Queen points stop at 22** The same last coin at a match score of 22-4 shows `4 points: 4 coins left`.
- **DP-43 — Next board by keyboard** Enter on `button "Next board"` closes the sheet and returns focus to `#board`, which then shows `Board 4 of 8`, the board loser's turn with white, the opening layout and `Break attempt 1 of 3`.
- **DP-44 — Match over at 25 points** The same board win at 24-4 scores `4 points: 4 coins left` and, with no Board over sheet, sets `#match-root` `data-phase="match-over"` and opens `dialog "Match over"` with `You won`, `Final score 28-4` and that points line in its `#board-points`, with focus inside the dialog and Tab kept inside.
- **DP-45 — Classic result in history and the wider layouts** After reload `/profile/<name>` shows a `WON` row with `Classic` and `28-4`, and the score rail sits below the board at 768x1024 and to its right at 1280x800.
- **DP-46 — Last-coin fouls and the extra board** Pocketing the opponent's last coin, or one's own last coin while the queen is not covered, gives the board to the opponent with the published points, and a tie after board 8 plays a ninth `Extra board`.
- **DP-47 — Create a private room** A host who creates a Quick room through `button "Create a room"` reaches `/room/<code>` with a 6-character code from the published alphabet, the full join link, `Waiting for opponent...`, and `#room-expiry` counting down from the server's remaining time whatever the device clock says.
- **DP-48 — Join by link, ready and toss** A second player who opens the link joins with `button "Join"`, both names appear on both pages, both press `button "Ready"` (one by keyboard), the toss line names the host when `TOSS_SEED` is 0, and both reach the same `/match/<id>` with the host to break.
- **DP-49 — Room full for a third player** A third player who opens the link sees `heading "Room full"` and `This room already has two players.`
- **DP-50 — Join with a code by keyboard** On `/join` the six `textbox "Character <n> of 6"` boxes turn a typed lower-case code into upper case with focus moving on, Backspace in an empty box moves back, a pasted code fills all six, and Enter joins.
- **DP-51 — Rematch in the same room** After a private match ends, the host's `button "Rematch"` shows `<name> wants a rematch.` live and announced on the other page, and accepting by keyboard starts a new match in the same room at 0-0 with the breaker swapped.
- **DP-52 — One joiner and room expiry** When two joins arrive at the same moment, exactly one answers `200` and the other `409 ROOM_FULL`, and a room left without a joiner past `ROOM_EXPIRY_SECONDS` by server time answers `410 ROOM_CLOSED`.
- **DP-53 — Link an email for ranked** A guest who presses `button "Play ranked"` gets `dialog "Link your email"`, `button "Send link"` shows `Link sent to <email>. Open it on any device.` only after the mail server accepts the message, and opening the emailed link shows `Email linked: <email>` and lets Play ranked enter the queue.
- **DP-54 — Queue screen readouts** A linked player rated 1500 in the ranked queue sees `Looking for players near 1500` and `Rating band: 1400-1600`.
- **DP-55 — Band widens and pairs live** On the short-timer instance, linked players rated 1500 and 1700 see their band widen live to `1350-1650` and then `1300-1700`, and both reach the same `/match/<id>` as a `Ranked` match with the earlier joiner in seat 0.
- **DP-56 — Cancel the queue by Escape** Escape on the queue screen cancels the same way `button "Cancel"` does, returns to `/`, and that player is no longer paired.
- **DP-57 — Queue radar motion and reduced motion** `#radar` sweeps once every 1.6 seconds while waiting and does not turn with reduced motion.
- **DP-58 — Pairing once and the ranked lock** Three players entering one queue at the same moment produce exactly one pair and one waiting player, and a guest without a linked email gets `403 LINK_REQUIRED`.
- **DP-59 — Server shot clock passes the turn** On the short-timer instance `#shot-timer` starts at `0:04`, and if no shot is made the server passes the turn with `TIME UP` and `Time's up. The turn passes.` on both pages and no due.
- **DP-60 — Three timeouts forfeit** A player's third consecutive timeout ends the match, and the opponent sees `You won` and `<name> forfeited: 3 timeouts in a row`.
- **DP-61 — Reconnecting overlay** When one player goes offline, the other sees `#reconnect-overlay` with `<name> is reconnecting... <m:ss>` announced once, and the offline page shows `Connection lost. Reconnecting...`.
- **DP-62 — Rejoin within the window** A player who comes back online and reloads within the reconnect window gets their seat back with identical pieces and scores, and the overlay goes away.
- **DP-63 — Ranked forfeit after the window** When a ranked player stays away past the window, the opponent sees `You won`, `<name> forfeited: left the match` and `Rating 1662 (+162)` for two new players, and both players' histories show the rating change after reload.
- **DP-64 — Buy and keep a striker skin** With 300 chalk, buying Cobalt Ring leaves `50 chalk` and shows `button "Equip Cobalt Ring"`, both are still there after reload, and the ledger sum equals the balance.
- **DP-65 — Shop by keyboard** Arrow keys move between the three tabs of `tablist "Item kinds"` with roving focus and `aria-selected`, and Enter buys an item and then equips it.
- **DP-66 — Short balance disables Buy** With 130 chalk `button "Buy Cobalt Ring"` is disabled and reads `Need 120 more`.
- **DP-67 — Double tap debits once** Two quick taps on `button "Buy Cobalt Ring"` debit 250 chalk only once, leaving one purchase movement in the ledger and a balance of 50.
- **DP-68 — Equipped skin seen by the opponent** After the buyer equips Cobalt Ring and Walnut Night, the opponent's page shows `piece-striker` with `data-skin="striker-cobalt"` on the buyer's turn, while `#board` with `data-theme="board-walnut"` shows only on the buyer's page.
- **DP-69 — Purchase rules and paired ledger** A short balance answers `402 INSUFFICIENT_CHALK` with `needed`, a repeated `idempotencyKey` debits only once, and every chalk movement is two ledger entries that sum to zero.
- **DP-70 — Run manifest and health** `/app/run.json` installs, builds and serves the app on port 4173, and `GET /api/health` always answers 200 with `{"status":"ok"}` or `{"status":"unavailable"}`.
- **DP-71 — Server boundary** The server refuses cross-origin writes and socket upgrades, oversized bodies and non-JSON bodies with the published errors, never serves source, configuration or credentials, and the browser never requests another origin.
- **DP-72 — Database outage** With PostgreSQL unreachable every page loads with the database outage banner, online buttons are disabled, and a resigned pass-and-play match ends with `Saved on this device. It will be added to your history when online.`
- **DP-73 — Mail outage** With mail unreachable, Send link answers `503 MAIL_UNAVAILABLE` and shows `We couldn't send the link. Try again in a minute.`, the player stays unlinked, and ranked stays locked while guest play works.
- **DP-74 — Magic link sign-in on another device** Opening a sign-in link for an email that already belongs to another player signs this browser in as that player with `Signed in as <name>`, and a used or expired link shows `heading "This link has expired"`.
- **DP-75 — Verdict swap field wipe** When the turn passes, `#field-wipe` crosses the viewport from the incoming player's baseline edge in about 520 ms, and `#match-root` `data-turn` and `data-field` change only at its end, or at once with reduced motion.
- **DP-76 — Published breakpoints** At 375x812, 768x1024 and 1280x800 the match screen arranges the board and score rail as published, the whole board stays in view while aiming, nothing scrolls sideways, and every control is at least 44 px.
- **DP-77 — Accessibility and visible focus** Home, match, shop and profile have no automated accessibility violations at the three published sizes, and every focused control shows a visible focus ring.
- **DP-78 — Shared deterministic model** `POST /api/grading/simulate` reproduces the published physics set-ups, and the same input always returns byte-identical events and final positions.
- **DP-79 — Glicko-2 ratings, tiers and leaderboard** Each ranked match is one Glicko-2 rating period with the published constants and worked examples, tiers follow the published bands, and the leaderboard lists only eligible players plus the viewer's own row.
- **DP-80 — Chalk awards** Completed online matches, first daily wins and pass-and-play matches award the published chalk exactly once per player, and forfeits and abandoned matches award none as qualified in Business rules.
- **DP-81 — Preset emotes** `button "Emotes"` offers six preset emotes, a sent emote appears and is announced on the opponent's page, and an unknown emote answers `422 INVALID_EMOTE`.
- **DP-82 — Grading routes** The grading routes create players, matches and ruled events exactly as published when `X-Grading-Key` matches `GRADING_KEY`, and answer 404 otherwise.
- **DP-83 — Duotone turn fields** Each match screen is one saturated field in the current shooter's colour, tomato with ink type for seat 0 and cobalt with white type for seat 1, with the square board centred and the opponent's name cropped huge behind it.
- **DP-84 — Procedural board and pieces** The board is a drawn object of lacquered ply with four net pockets, baselines and centre circle, and its coins, queen and striker skins are all drawn by the app without image files.
- **DP-85 — Working screens in the same language** History, profile, shop, room lobby, empty states and outage banners use the same Chivo type, square-cornered surfaces, giant cropped words and two-colour fields as the match screen.
- **DP-86 — One rules module in source** One shared, pure module holds the physics step and the laws of carrom, and both the browser and the server import it with no copy of either rule set elsewhere.
- **DP-87 — Configuration from the environment** Every service address, credential, timer and grading key is read from the environment at start, is never hard-coded, and never reaches the browser.

## Frontend

### Screens and layout (DP-01, DP-05, DP-13, DP-45, DP-47, DP-76)

The app has these screens. Every screen shows the database outage banner from Feedback states across its top when the server reports its database unavailable.

- **Loading.** While a screen fetches its first data, the board's four pockets fill one after another in the centre of the page and then the screen settles in.
- **`/welcome`.** Shown on a first visit and whenever the session's player has not yet chosen a name or skipped. It holds the name field, the avatar picker and the Continue and Skip buttons. Avatars are a 4-column grid at 375 px wide, 6 columns at 768 px and 8 columns at 1280 px. When the database is unreachable, pages never redirect here.
- **`/` home.** A top bar holds the profile link, the chalk balance, and links to the shop and the leaderboard. Below it the hero fills the viewport in cobalt. DUE COIN is set in huge black capitals and cropped by the right edge, with the small label `Carrom, refereed in the open.` and a tomato `Play now` link at the bottom left. The DUE COIN text is the page's only `h1`. Below the hero come three full-width fields, one per way to play, in alternating colours: PASS on tomato (Pass and play), ROOM on cobalt (Create a room, Join with a code) and RANKED on tomato (Play casual, Play ranked). Each field shows its giant cropped word with its controls. At 375 px the name sets over two lines with the label and action beneath it.
- **`/play/local`.** The pass-and-play setup form: format, two names, the board-turning switch and Start. After Start the same route shows the match screen.
- **`/room/<code>`.** The room lobby: room heading, code, join link, Copy link, the closing countdown, both seats with their names and Ready buttons, and the host's Cancel room button.
- **`/join/<code>` and `/join`.** Joining by link (a name field and Join) and by code (six character boxes and Join).
- **`/queue/<mode>`.** For `casual` or `ranked`: the queue heading, readouts, radar and Cancel.
- **`/match/<id>`.** The online match screen. A non-participant sees `heading "Match not found"` with `link "Home"`.
- **`/profile/<name>`.** Avatar, name, rating with tier, and match history.
- **`/shop`.** Three tabs of items with prices and Buy or Equip buttons.
- **`/leaderboard`.** `table "Leaderboard"` with columns Rank, Name, Rating and Tier, plus the viewer's own row under the table when they are not in the top 100.
- **`/auth/link/<token>`.** Opens a magic link and redirects to `/` with the result banner, or shows `heading "This link has expired"` with `link "Home"`.

The match screen (online and pass-and-play) is one full-viewport field in the current shooter's colour, with 12 px outer margins. The square board sits in the middle, and the opponent's name is set huge and cropped behind the board. A narrow score rail holds both seats' names, scores, coins left, dues and the queen status. The aiming controls sit under the board.

Published breakpoints. Below 768 px wide, the score rail is a horizontal strip above the board and the board fills the content width. From 768 to 1279 px, the score rail sits below the board. At 1280 px and wider, the score rail is a column to the right of the board. At 375x812, 768x1024 and 1280x800, the whole square board (all four pockets) stays inside the viewport while aiming, without scrolling. No page scrolls sideways at any of the three sizes. No other breakpoint between those sizes changes which layout a published size gets.

### Public screens and controls (DP-01 to DP-05, DP-07 to DP-11, DP-18, DP-24, DP-28, DP-47 to DP-51, DP-53 to DP-57, DP-61, DP-64 to DP-68, DP-81)

Only these regions and controls are public. Everything else is free. Dynamic messages are owned by Feedback states and verdict lines by Business rules.

| Screen | Role and accessible name / id | Visible copy and attributes |
|---|---|---|
| `/welcome` | `heading "Pick a name"` | `Pick a name` |
| `/welcome` | `textbox "Name"` `#name-input` | the name |
| `/welcome` | `radiogroup "Avatar"` with 24 `radio "Avatar <n>"` (`#avatar-<n>`, n = 1..24) | Avatar 1 selected at start; one tab stop for the group |
| `/welcome` | `alert` `#name-error` | name errors, with suggestion buttons `button "<suggestion>"` inside |
| `/welcome` | `button "Continue"`, `button "Skip"` | `Continue`, `Skip` |
| `/` | `heading` level 1 | `DUE COIN` |
| `/` | `link "Play now"` | moves to the PASS field |
| `/` | `link "Pass and play"` (to `/play/local`), `button "Create a room"`, `link "Join with a code"` (to `/join`), `button "Play casual"`, `button "Play ranked"` | same as names |
| `/` | `link "<name> profile"`, `link "Shop"`, `link "Leaderboard"` | same as names |
| `/` | `#chalk-balance` | `<n> chalk` |
| `/` | `dialog "Create a room"` with `radiogroup "Format"` (`radio "Quick"` selected, `radio "Classic"`), `button "Create"` | |
| `/` | `dialog "Link your email"` with `textbox "Email"`, `button "Send link"`, `button "Close"` | `Link your email to play ranked.` |
| `/play/local` | `radiogroup "Format"` (`radio "Quick"` selected, `radio "Classic"`) | |
| `/play/local` | `textbox "Player 1 name"`, `textbox "Player 2 name"` | default values `Player 1`, `Player 2` |
| `/play/local` | `switch "Turn the board each turn"` | on at start |
| `/play/local` | `button "Start"` | `Start` |
| `/room/<code>` | `heading "Room <code>"`, `#room-code`, `#room-link`, `button "Copy link"`, `#room-expiry`, `button "Ready"` (one per seat, enabled only for the viewer's own seat), `button "Cancel room"` (host only) | `#room-link` is `<APP_PUBLIC_URL>/join/<code>`; `#room-expiry` is `Closes in <m:ss>` while waiting for an opponent; `#toss-result` holds the toss line |
| `/join/<code>` | `textbox "Your name"` (prefilled with the viewer's name), `button "Join"` | |
| `/join` | `group "Room code"` of six `textbox "Character <n> of 6"`, `button "Join"` | |
| `/queue/<mode>` | `heading "Finding a match"`, `#queue-near`, `#queue-band`, `#queue-elapsed`, `#radar`, `button "Cancel"` | `Looking for players near <rating>`; `Rating band: <low>-<high>` or `Any rating` for casual; `<m:ss>` elapsed |
| match | `#match-root` | `data-turn` `0` or `1`; `data-field` `tomato` or `cobalt`; `data-phase` one of `waiting`, `aim`, `refereeing`, `moving`, `board-over`, `match-over`; `data-board` the board number; `data-shot-seq` the last ruled shot number |
| match | `#field-wipe` | present only during a field wipe, with `data-from` `top` or `bottom` |
| match | `group "Carrom board"` `#board` (focusable) | `data-theme` the viewer's equipped board theme id |
| match | `#board-rotator` | `data-rotation` `0` or `180` |
| match | pieces `#piece-striker`, `#piece-queen`, `#piece-w1`..`#piece-w9`, `#piece-b1`..`#piece-b9` | `data-x`, `data-y` (board millimetres, one decimal, empty when pocketed); `data-state` `board` or `pocketed`; `data-pocketed-by` `0`, `1` or empty; the striker also has `data-legal` `true` or `false` and `data-skin` (the shooter's equipped striker skin id) |
| match | `#aim-guide` | `data-first-contact`: a piece id or `cushion` |
| match | `#ghost-striker`, `#ghost-aim` | the opponent's live striker and aim line, 40 percent opaque, with `data-x` and `data-y` |
| match | `slider "Striker position"` `#striker-slider` | min -200, max 200, step 0.5, `aria-valuetext` `<offset, one decimal> mm` |
| match | `slider "Aim angle"` `#aim-slider` | -180 to 180, step 0.1, `aria-valuetext` `<angle, one decimal> degrees` |
| match | `slider "Power"` `#power-slider` | 0 to 100, step 1, `aria-valuetext` `<n>%` |
| match | `button "Shoot"` `#shoot`, `button "Skip shot"` `#skip-shot` (shown only while pieces move) | |
| match | `#striker-readout`, `#aim-readout`, `#power-readout` | `Striker <offset> mm`, `Aim <angle> degrees` (one decimal each), `Power <n>%` |
| match | `#placement-message`, `#shot-error` | placement and shot-rejection messages; empty when there is nothing to report |
| match | `#turn-text` | online `Your turn` or `<name>'s turn`; pass-and-play always `<name>'s turn` |
| match | `#board-label` | `Board <n> of 8` (Classic), `Board 1 of 1` (Quick), `Extra board` (board 9) |
| match | `#break-label` | `Break attempt <k> of 3` during a break, empty otherwise |
| match | `region "Score rail"` containing, for each seat s in 0 and 1, `#name-<s>`, `#score-<s>`, `#coins-left-<s>`, `#dues-<s>`, plus `#queen-status` | `#score-<s>` is the match points as a number; `<n> coins left` (`1 coin left` for one); `Dues owed: <n>`; queen status exactly one of `On the board`, `Awaiting cover by <name>`, `Covered by <name>` |
| match | `timer "Shot clock"` `#shot-timer` (online only) | `<m:ss>` |
| match | `status` `#verdict` containing `#verdict-word` and `#verdict-line` | the verdict word and line from Business rules |
| match | `log "Match announcements"` `#announcer` (polite) | announcements from Feedback states |
| match | `button "Menu"` `#menu` opening `dialog "Menu"` with `button "Rules"`, `button "Resign"`, `button "Close"` | `Rules` opens `dialog "Rules"` summarising the laws in Business rules, with `button "Close"` |
| match | `dialog "Resign this match?"` with `button "Resign"`, `button "Keep playing"` | |
| match | `button "Emotes"` `#emotes` opening a `menu` of six `menuitem`s `Nice shot`, `Well played`, `Oops`, `Thinking`, `Good game`, `Hello` (online only); the received emote shows in `#emote-bubble` | |
| match | `#reconnect-overlay` | opponent reconnecting countdown |
| match | `dialog "Board over"` with a heading, `#board-points` and `button "Next board"` | |
| match | `dialog "Match over"` with a heading, `#final-score`, `#board-points` (only when a board win ended the match), `#end-reason`, `#rating-change` (ranked only), `#chalk-earned`, `#save-status` (pass-and-play only), `button "Rematch"` (private rooms only), `button "Accept rematch"` (shown to the player offered a rematch), `link "Home"` | |
| `/profile/<name>` | `#rating`, `list "Match history"` with one `listitem` per match | `<rating> <tier>`; each row reads `WON` or `LOST`, the mode word (`Pass and play`, `Private`, `Casual`, `Ranked`), the format (`Quick`, `Classic`), `vs <opponent>`, `<your score>-<their score>` and the signed whole rating change (`+162`, `-162`, nothing when unrated) |
| `/profile/<name>` | empty state | `NO MATCHES YET` with `link "Play your first match"` (to `/`) |
| `/shop` | `tablist "Item kinds"` with `tab "Strikers"`, `tab "Boards"`, `tab "Coin sets"` and one `tabpanel` each | |
| `/shop` | one `article` per item, named by the item name | price `<n> chalk`; `button "Buy <item>"` (disabled and reading `Need <n> more` when the balance is short); owned items have `button "Equip <item>"`; the equipped item has `button "Equipped"` with `aria-pressed="true"` |
| every page | `status` `#outage-banner` | database outage banner |
| every page | `status` `#page-status` | page-level confirmations from Feedback states |

### Interactions (DP-02, DP-07 to DP-09, DP-14 to DP-17, DP-19, DP-24, DP-28, DP-43, DP-50, DP-56, DP-65)

**Everything works by keyboard.** Tab order follows reading order. Every dialog and sheet keeps Tab and Shift+Tab inside itself, wrapping from the last control to the first and back. Escape closes it, and focus returns to the control that opened it. Board over returns focus to `#board`. Match over has no Escape and keeps focus until the player leaves it with Home, Rematch or Accept rematch. Every focused control shows a clearly visible focus ring (a thick ink outline set off from the field by a white gap), including `#board`.

**Aiming keys.** These act on the viewer's turn while `data-phase` is `aim`, in any order. There is no separate placement step.

| Key | Action |
|---|---|
| ArrowLeft / ArrowRight | move the striker 1 mm left / right as the shooter sees it |
| Shift+ArrowLeft / Shift+ArrowRight | move it 0.5 mm |
| A / D | aim angle -1.0 / +1.0 degrees |
| Shift+A / Shift+D | aim angle -0.1 / +0.1 degrees |
| W / S | power +2 / -2 percentage points |
| Space | shoot (only with power above 0 and a legal placement) |
| Escape | reset the aim angle to 0.0 and the power to 0 |
| K | Skip shot while pieces move |

Arrow keys and Space act when `#board` has focus. The letter keys and Escape also act with focus on any match-screen button (Shoot, Skip shot, Menu, Emotes). The sliders keep their own arrow-key behaviour, and their step sizes come from the controls table. Values stop at their limits. Every change updates the slider, the readout, the striker's `data-x` and the aim guide straight away. When a dialog is open, Escape closes the dialog and changes nothing else.

**Pointer and touch.** Mouse, pen and touch behave the same way. The board takes over touch gestures, so dragging on it never scrolls or zooms the page.
- A drag that starts on the striker slides it along the baseline. The offset follows the pointer's sideways movement converted to board millimetres (the rendered board side equals 740 mm), snapped to 0.5 mm and kept within the legal range. The striker's y never changes.
- A drag that starts anywhere else on the board is a pull-back. The pull is the press point minus the current point. The aim points along the pull, which is opposite to the drag, so pulling straight toward the shooter aims at 0.0 degrees. The power is (pull length ÷ maximum pull)², capped at 1 and rounded to 0.001. The maximum pull is 40 percent of the board's rendered side. For example, a pull of half the maximum pull gives `Power 25%`. Readouts and the aim guide update live during the drag. Releasing shoots when the power is above 0 and the placement is legal. If the pointer comes back within 8 px of the press point, the power goes to 0 and releasing shoots nothing.
- Tapping a disabled Shoot does nothing.

**Welcome.** Arrow keys inside the Avatar group move and select (one tab stop for the group). Enter in the name field submits. A suggestion button, when activated, puts its name in the field and moves focus to the field. After a successful Continue or Skip, the page goes to `/` and focus moves to its `h1`.

**Join by code.** Typing a character fills the box in upper case and moves focus to the next box. Backspace in an empty box moves focus back and clears that box. Pasting a code into any box fills all six. Enter in any box, or `button "Join"`, joins.

**Shop tabs.** Left and Right arrows move focus and selection between the tabs (roving focus, `aria-selected="true"` on the current tab). Tab moves into the panel. Enter or Space on a Buy or Equip button activates it.

**Queue.** Escape anywhere on the queue screen cancels the same way Cancel does.

**Pass and play.** Player 1 is seat 0, plays white and breaks board 1. With the switch on, each turn change turns the board so the shooter's baseline is at the bottom. With it off, `data-rotation` stays `0`. Pass-and-play has no shot clock, no ghost and no emotes. Menu → Resign opens the resign dialog. Keep playing, or Escape, closes it and returns focus to Menu. Resign ends the match with the seat whose turn it is as the resigner.

**Online.** Each player's own baseline is at the bottom of their own screen: seat 1's `#board-rotator` is always `data-rotation="180"`. While one player aims, their page sends previews (striker offset, aim, power) to the server at most 15 times a second. The opponent's `#ghost-striker` and `#ghost-aim` show them within 1 second. On the waiting player's page, the aiming controls are disabled and `#aim-guide` is hidden. At the start of every turn the striker sits at the shooter's baseline centre.

### Visual design (DP-83, DP-84, DP-85)

The direction is a loud, two-colour field swap. Each player owns a full colour field: seat 0 owns a saturated tomato red with near-black ink type, and seat 1 owns a saturated cobalt blue with white type. The whole match screen is the current shooter's field, so two people across a table know whose flick it is from a metre away. A black field with off-white type appears only once, as the backdrop of the Match over statement.

- **Type.** Chivo throughout. Display words (DUE COIN, PASS, ROOM, RANKED, the verdict words, WON and LOST, empty-state words) are Chivo in its heaviest black weight, in capitals, with very tight leading, so lines nearly touch. Body text is regular-weight Chivo at a comfortable reading size, a little larger than the browser default. Numbers in scores and history use tabular figures so they line up. Each heading step is about one third larger than the step below it.
- **Palette roles.** The ground is a warm off-white and is used on working pages. The surface is plain white for rows and tiles. Ink is near-black for text and borders. Muted is a warm grey for secondary text. The accent is the saturated cobalt, with white on it. Tomato is the second field colour, with ink on it. All text meets WCAG 2.2 AA contrast on its field.
- **Density and shape.** Comfortable spacing. Fields run edge to edge with 12 px outer margins. Corners are square everywhere: buttons, tiles, dialogs and inputs have no rounding. Only pieces and pockets are round. Every control a finger touches is at least 44 px in both directions.
- **Composition.** Flat full-width fields stacked down the page, and neighbouring sections never share a colour. Big words are deliberately cropped by the viewport edge.
- **The board** is the only crafted object on screen. It is drawn by the app as lacquered ply with a darker wooden frame, four dark net pockets, the two baselines on each side with their end circles, the centre circle and diagonal arrows. Coins are drawn white and black, the queen red, and the striker larger with its equipped skin. The three board themes and two coin sets change only these drawn colours and grain. A striker in an illegal spot shows its danger ring: a thick near-black ring with a white inner edge, about three times as thick as its normal white ring, so it reads on both fields.
- **Working screens** (history, profile, shop, room lobby, leaderboard) sit on the off-white ground with white surface rows. Each history row leads with a huge `WON` or `LOST` in black Chivo, then mode, format, opponent, score and rating change in body text. Shop items are drawn swatches on white tiles. Forms use thick 2 px ink borders. Inline errors are ink text with an icon, never colour alone. Empty states are one giant cropped word with one action. Outage banners are a full-width tomato strip with ink text. Icons are Lucide line icons.

### Motion and effects (DP-11, DP-20, DP-26, DP-27, DP-34, DP-38, DP-57, DP-75)

Motion explains what the server ruled. Everything decorative stays still. Enters are quick and settle softly: they start fast and ease into place. Every motion runs on browser timers, CSS animations or animation frames, never on polling the wall clock. The verifier pauses the browser clock and advances it.

**Verdict swap (the signature).** One shot, from one ruling event:
1. On a strike, `data-phase` becomes `refereeing`. The striker shows ghosted at its start and nothing else moves.
2. When the server's ruling arrives, `data-phase` becomes `moving`. The pieces play back the server's trajectory frames (never a prediction) at up to twice real speed, with the playback capped at 2.4 seconds. Pocketed pieces drop into their pockets. Rulings without frames move each piece in a straight line to its final position in about a third of a second. Skip shot or K jumps to the end.
3. When the pieces reach their final positions, the verdict banner `#verdict` slides down from above the board while fading in, in about a fifth of a second. The verdict word scales up from small into place in about a quarter of a second, at twelve percent of the viewport width, in the field's text colour. The explanation line sits beneath it in body text, and the score numerals change.
4. If the turn passes, `#field-wipe` sweeps the incoming player's colour across the whole viewport in about half a second (520 ms). It starts from the screen edge nearest the incoming shooter's baseline as the board is drawn at that moment (`data-from` `bottom` or `top`). The cropped name behind the board changes. `data-turn`, `data-field` and `#turn-text` change only when the wipe finishes, and then `data-phase` returns to `aim`. In pass-and-play with the switch on, the board then turns 180 degrees over about half a second, through in-between angles. `data-rotation` gives the end state.
5. If the shooter keeps the turn, the field stays and a single short pulse (the field brightens and settles in about a quarter of a second) marks the extra shot. Then `data-phase` returns to `aim`.

Once `data-phase` is back at `aim`, `board-over` or `match-over`, every piece's `data-x`, `data-y` and `data-state` equal the server's final values rounded to one decimal, identical in both players' browsers.

**The verdict banner** leaves after the verdict banner time (`verdictBannerMs` from `GET /api/config`), sliding back up and fading out in about 150 ms. A newer verdict replaces the banner and restarts its full time, and a timer from an older verdict never hides a newer one.

**Other motion.**
- An illegal striker spot shakes the striker's outline 4 px side to side twice, within 120 ms.
- The shot clock fades in and out once a second when 5 seconds or less remain.
- The queue radar `#radar` sweeps one full turn every 1.6 seconds while waiting.
- Dialogs and sheets rise into place in under a third of a second.
- Buttons darken on hover and press in in under a tenth of a second.
- The loading pockets fill one after another and settle.

No other looping or decorative animation exists.

**Reduced motion.** When the system asks for reduced motion:
- Pieces appear at their final server positions at once.
- The verdict word and line appear at full size with no slide or scale.
- Field colour, `data-turn` and `data-field` change at once, with no wipe.
- The board turn has no in-between angles: a crossfade of about 150 ms to the new end state.
- The illegal-spot shake does not move, and the colour changes at once.
- The shot clock does not pulse and the radar does not turn.

Every announcement and every end state stays the same.

### Feedback states (DP-03, DP-04, DP-11, DP-21, DP-28, DP-39, DP-53, DP-61, DP-72, DP-73)

All published copy uses straight apostrophes (') and three full stops (...), never typographic quotes or an ellipsis character, and renders character for character. Placeholders in angle brackets are filled from live data. Pushed server changes (turns, rulings, band widening, room status, reconnects, rematch offers) show on open pages within 1 second.

**The match announcer** (`#announcer`, polite) announces only after the server has ruled, never before:
- each verdict line, as soon as the verdict banner shows;
- the turn line (`Your turn` or `<name>'s turn`) when the turn changes, at the end of the wipe;
- `<winner name> wins board <n>. <points line>` when a board ends, including the board that ends the match, where it comes just before the match line;
- `<Match over heading>. Final score <x>-<y>.` when the match ends;
- the toss line when a match starts;
- `Striker overlaps a coin.` once each time the striker enters an illegal spot;
- shot rejection messages;
- `<name>: <emote label>` for a received emote;
- the reconnect overlay text once when it appears;
- rematch offers.

| Action | Pending | Success | Field error | Outage |
|---|---|---|---|---|
| Continue on `/welcome` | button disabled | go to `/`, focus `h1` | in `#name-error`: `That name is taken. Try one of these:` / `That name isn't allowed. Try one of these:` (each followed by 3 suggestion buttons) / `Use 3 to 16 letters, numbers or underscores.` | database banner |
| Send link | button reads `Sending...` | `status` in the dialog: `Link sent to <email>. Open it on any device.` | `alert`: `Enter a valid email address.` | `alert`: `We couldn't send the link. Try again in a minute.` |
| Open magic link | | `#page-status` on `/`: `Email linked: <email>` or `Signed in as <name>` | `heading "This link has expired"` | database banner |
| Shoot | `data-phase="refereeing"` | verdict banner | `#shot-error` (also announced), then back to aiming: `NOT_YOUR_TURN` `It's not your turn.`; `TURN_EXPIRED` `Time ran out. The turn has passed.`; `ILLEGAL_PLACEMENT` `Striker overlaps a coin.`; `INVALID_INTENT` `That shot isn't valid. Aim again.`; `RATE_LIMITED` `Too many moves. Wait a moment.`; `CLIENT_OUTDATED` `A new version is available. Reload to keep playing.` | database banner |
| Placement | | `#placement-message` empty | `#placement-message` `Striker overlaps a coin.` | |
| Copy link | | `#page-status` `Link copied` | | |
| Join a room | button disabled | room lobby | `heading "Room full"` with `This room already has two players.` and `link "Home"`; `heading "This room has closed"`; `heading "Room not found"` | database banner |
| Ready | button reads `Waiting...` | toss line in `#toss-result`, then the match screen 2 seconds later | | database banner |
| Rematch | button reads `Rematch offered` | other page: `<name> wants a rematch.` and Accept rematch; both: new match | `Rematch offer expired.` | |
| Pass-and-play save | `#save-status` `Saving...` | `#save-status` `Saved to your history.` | | `#save-status` `Saved on this device. It will be added to your history when online.` |
| Buy | button disabled | balance and buttons update | | `alert` `Purchase failed. No chalk was taken.` |
| Connection | | | | own page `#page-status` `Connection lost. Reconnecting...`; opponent `#reconnect-overlay` `<name> is reconnecting... <m:ss>` |

**Database outage banner** (`#outage-banner`, every page, while `GET /api/health` reports `unavailable`, checked on load and every 10 seconds): `Online play is unavailable right now. Pass and play still works.` While it shows, Create a room, Join with a code, Play casual, Play ranked and Buy are disabled, and pass-and-play works fully.

**Match over** contents:
- **Heading.** Online: `You won` or `You lost`. Pass-and-play: `<name> wins`.
- **`#final-score`.** `Final score <your score>-<their score>`, from seat 0's side in pass-and-play.
- **`#end-reason`** (only when the match was not played out): `<name> forfeited: left the match`, `<name> forfeited: 3 timeouts in a row` or `<name> resigned`.
- **`#rating-change`** (ranked only): `Rating <new rating> (<signed delta>)`, both rounded to whole numbers, for example `Rating 1662 (+162)`.
- **`#board-points`** (only when the match ended by winning a board): that board's points line from Business rules.
- **`#chalk-earned`:** `+<n> chalk`.

The Board over heading is `<winner name> wins board <n>`. `#board-points` holds the points line from Business rules. On a board that ends the match, the Board over sheet never opens. `#match-root` goes straight from `moving` to `data-phase="match-over"`, `dialog "Match over"` opens and takes focus, and that board's points line shows inside Match over in its own `#board-points`. The toss line is `<name> won the toss and breaks with white.`

## Backend

### API (DP-06, DP-12, DP-23, DP-29, DP-52, DP-58, DP-69, DP-73, DP-74, DP-81, DP-82)

All bodies are JSON (`application/json; charset=utf-8`) and all keys are camelCase. Every error body is `{"error":"<CODE>"}` plus the extra fields named in its row. Numbers in board coordinates are millimetres.

**Error precedence**, the same for every route:
1. cross-origin `403 CROSS_ORIGIN`;
2. for grading routes, a wrong or missing key `404`;
3. body too large `413 PAYLOAD_TOO_LARGE`, wrong content type `415 UNSUPPORTED_MEDIA_TYPE`, or malformed JSON `400 INVALID_PAYLOAD`;
4. database unreachable `503 DATABASE_UNAVAILABLE`;
5. unknown resource `404 NOT_FOUND` (or the route's own not-found code);
6. not allowed `403` (`NOT_IN_MATCH`, `NOT_HOST`, `LINK_REQUIRED`, `NOT_OWNED`);
7. rate limit `429 RATE_LIMITED`;
8. an idempotent replay (same `shotSeq`, same `idempotencyKey`) returns its stored response unchanged;
9. `409 CLIENT_OUTDATED`;
10. state conflicts (`409`, `410`, `402`);
11. field validation (`422`).

A session is created on the first request without a valid `dc_session` cookie. That request creates a guest player and sets `dc_session` (HttpOnly, SameSite=Lax, path `/`, not Secure, because grading runs over plain HTTP). So there is no 401.

**Session and profile**
- `GET /api/me` → `200 {"id","name","avatar":1..24,"chosen":bool,"email":null|"<email>","linked":bool,"rating","rd","tier","rankedGames","chalk","equipped":{"striker","board","coins"}}`. `chosen` is false until Continue or Skip. `rating` and `rd` have two decimals.
- `POST /api/me/name {"name","avatar"?}` → `200` the `GET /api/me` body (sets `chosen`). Errors:
  - `422 {"error":"NAME_INVALID"}` when the name is not 3 to 16 characters of letters, digits or underscores;
  - `409 {"error":"NAME_TAKEN","suggestions":[3 names]}` when another player has it, ignoring case;
  - `422 {"error":"NAME_BLOCKED","suggestions":[3 names]}` when it contains a blocked word.
  
  Suggestions are the first three free names of `<base>_01` to `<base>_99` in increasing order. `<base>` is the requested name cut to 13 characters, or `Player` for a blocked name.
- `POST /api/me/skip` → `200` the `GET /api/me` body with the name `Guest-<4 digits>`: a random free 4-digit number, exempt from the name rule.
- `POST /api/me/avatar {"avatar"}` → `200`; `422 {"error":"AVATAR_INVALID"}` outside 1..24.
- `GET /api/players/by-name/<name>` → `200 {"id","name","avatar","rating","rd","tier","rankedGames"}`. Matching ignores case.
- `GET /api/players/<id>/history` → `200 {"matches":[{"matchId","mode":"local|private|casual|ranked","format":"quick|classic","opponent","result":"won|lost","yourScore","theirScore","ratingDelta":null|<number, two decimals>,"endReason":"played|left|timeouts|resigned","endedAt":"<ISO>"}]}`. Newest first, at most 50. Abandoned matches are not listed.
- `GET /api/leaderboard` → `200 {"rows":[{"rank","playerId","name","rating","tier","rankedGames"}],"you":null|{same row shape}}`.
- `GET /api/config` → `200 {"verdictBannerMs","shotTimerSeconds","reconnectSeconds","rematchSeconds","roomExpirySeconds","bandWidenSeconds","modelVersion":"dc-model-1"}`.

**Email link.** This route is where a provider's confirmation decides the state.
- `POST /api/auth/link {"email"}` → `202 {"status":"sent"}` only after the mail server has accepted the message for delivery. If it was not accepted, `503 {"error":"MAIL_UNAVAILABLE"}`, and nothing about the player changes. Other errors: `422 {"error":"EMAIL_INVALID"}`; `409 {"error":"ALREADY_LINKED"}` when the session's player already has a different linked email.
- `linked` and `email` in `GET /api/me` change only when the link is opened, never when it is sent.
- `GET /auth/link/<token>` (a page) links the email to the current player, or, when the email already belongs to another player, makes this browser that player's session. Then it redirects to `/` with the matching banner. A used, unknown or expired token shows the expired page. Tokens are single use and last `MAGIC_LINK_SECONDS`.

**Rooms**
- `POST /api/rooms {"format":"quick|classic"}` → `201 {"code","url":"/join/<code>","matchId"}`. The code is 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. The host is seat 0.
- `GET /api/rooms/<code>` → `200 {"code","format","status":"open|full|closed","host":{"id","name"},"guest":null|{"id","name"},"expiresInMs":null|<int>,"matchId"}`; `404 {"error":"ROOM_NOT_FOUND"}`.
- `POST /api/rooms/<code>/join` → `200 {"matchId"}`. Errors: `404 ROOM_NOT_FOUND`, `410 ROOM_CLOSED`, `409 ROOM_FULL`. Joining one's own room again returns `200`.
- `DELETE /api/rooms/<code>` → `204` (host only, else `403 NOT_HOST`); the room closes.

**Queue**
- `POST /api/queue {"mode":"casual|ranked"}` → `202 {"mode","near","band":null|{"low","high"}}`. Ranked without a linked email: `403 {"error":"LINK_REQUIRED"}`. Entering again replaces the earlier entry.
- `GET /api/queue` → `200 {"mode","near","band","waitedSeconds","matchId":null|<id>}` or `404` when not queued.
- `DELETE /api/queue` → `204`.

**Matches** (participants only, otherwise `403 {"error":"NOT_IN_MATCH"}`)
- `GET /api/matches/<id>` → `200` match JSON:
  `{"id","mode":"private|casual|ranked","format":"quick|classic","status":"waiting|active|completed|forfeit|abandoned","board","turn":0|1,"phase":"waiting|aim|match-over","shotSeq","breakAttempt":null|1..3,"seats":[{"seat","playerId","name","avatar","color":"white|black","score","coinsLeft","dues","timeouts","connected","ready","strikerSkin"}],"queen":{"state":"board|pending|covered","seat":null|0|1},"pieces":[{"id","x","y","state":"board|pocketed","pocketedBy":null|0|1}],"turnDeadline":"<ISO>"|null,"turnRemainingMs":<int>|null,"winnerSeat":null|0|1,"endReason":null|"played"|"left"|"timeouts"|"resigned","roomCode":null|"<code>"}`.
  `pieces` lists the striker, the queen and all 18 coins. Pocketed pieces have `x` and `y` null.
- `POST /api/matches/<id>/ready` → `200` match JSON. Ready twice is still `200`. `409 {"error":"MATCH_NOT_WAITING"}` once the match has started.
- `POST /api/matches/<id>/preview {"x","dx","dy","p"}` → `204`. It is passed on to the opponent. More than 15 in one second from one player answers `429 {"error":"RATE_LIMITED"}`.
- `POST /api/matches/<id>/shots {"shotSeq","x","dx","dy","p","modelVersion"}` → `200` shot result:
  `{"shotSeq","seat","events":{"firstContact":"<piece id>"|"cushion"|null,"pocketed":[{"id","pocket":"nw|ne|sw|se"}],"strikerPocketed":bool},"verdict":{"word","line"},"frames":[{"t","pieces":[{"id","x","y"}]}],"final":[{"id","x","y","state"}],"match":{match JSON}}`.
  - `shotSeq` must be the match's `shotSeq` + 1.
  - Resending the last ruled `shotSeq` returns that stored result unchanged.
  - `frames` samples the server's simulation every 1/60 second of simulated time.
  - `final` is the board after the ruling: returned pieces are on their spots and the striker is at the next shooter's baseline centre.
  - Positions are never accepted from a client.
  
  Errors:
  - `409 CLIENT_OUTDATED` for any `modelVersion` other than `dc-model-1`;
  - `409 MATCH_NOT_ACTIVE`;
  - `409 TURN_EXPIRED` when the sender's last turn ended by timeout and no shot has been ruled since;
  - `409 NOT_YOUR_TURN` otherwise when it is not the sender's turn;
  - `409 STALE_SEQ` for any other `shotSeq`;
  - `422 ILLEGAL_PLACEMENT`;
  - `422 INVALID_INTENT` when `x` is off the 0.5 mm grid or outside ±200.0, the direction length is off 1 by more than 0.001, or `p` is outside [0, 1] or off the 0.001 grid. The shot clock keeps running.
- `POST /api/matches/<id>/emotes {"emote":"nice-shot|well-played|oops|thinking|good-game|hello"}` → `204`. `422 {"error":"INVALID_EMOTE"}` for anything else; `429 RATE_LIMITED` for more than one emote in 3 seconds.
- `POST /api/matches/<id>/resign` → `200` match JSON; `409 MATCH_NOT_ACTIVE`.
- `POST /api/matches/<id>/rematch {"accept":true|false}` → `200 {"status":"offered|accepted|declined|expired","matchId":null|<new id>}`. `409 {"error":"REMATCH_UNAVAILABLE"}` when the match is not a finished private match.

**Socket.** `GET /ws` upgrades to a WebSocket on the same origin. `/ws?match=<id>` also joins that match.
- Client messages: `{"type":"ready"}`, `{"type":"place","x"}`, `{"type":"aim","dx","dy","p"}`, `{"type":"shoot",...shot body}`, `{"type":"emote","emote"}`, `{"type":"resign"}`, `{"type":"rematch","accept"}`, `{"type":"pong"}`. Each does exactly what its HTTP route does.
- Server messages: `state` (match JSON), `shotStarted {"shotSeq","seat"}`, `shotResult` (shot result), `preview {"seat","x","dx","dy","p"}`, `opponentStatus {"connected","reconnectDeadline","reconnectRemainingMs"}`, `queueStatus` (the `GET /api/queue` body), `matchFound {"matchId"}`, `roomStatus` (the `GET /api/rooms/<code>` body), `rematchStatus {"status","matchId"}`, `emote {"seat","emote"}`, `ping`, `error {"code"}`.
- The server sends `ping` every 2 seconds. A page that receives nothing for 5 seconds treats the connection as lost and reconnects.
- A reconnect token kept for the browser tab only (session storage) lets a reloaded tab rejoin its seat.

**Pass and play**
- `POST /api/local-matches {"format","players":[{"name"},{"name"}],"shots":[{"seat","x","dx","dy","p"}],"resignedSeat":null|0|1,"claimed":{"winnerSeat","scores":[a,b]},"modelVersion","idempotencyKey"}` (body up to 1,000,000 bytes) → `201 {"matchId","chalkEarned"}`.
  - The server replays every shot from the opening layout with the shared model and laws. It answers 201 only when every shot is legal and in turn, the log ends exactly at the match end (or at the resignation), and the replay gives the claimed winner and scores.
  - Otherwise it answers `422 {"error":"RESULT_MISMATCH"}` and records nothing.
  - Also `409 CLIENT_OUTDATED`, and `409 {"error":"IDEMPOTENCY_CONFLICT"}` when a key is reused with a different body.
  - The same `idempotencyKey` returns the stored response.
  - The match is recorded in the session player's history from seat 0's side, with the Player 2 name as opponent.

**Shop and ledger**
- `GET /api/shop` → `200 {"chalk","items":[{"id","kind":"striker|board|coins","name","price","owned","equipped"}]}`.
- `POST /api/shop/purchase {"itemId","idempotencyKey"}` → `200 {"chalk","owned":[ids]}`. Errors:
  - `404 {"error":"ITEM_NOT_FOUND"}`;
  - `409 {"error":"ALREADY_OWNED"}`;
  - `402 {"error":"INSUFFICIENT_CHALK","needed":<chalk still missing>}`;
  - `409 IDEMPOTENCY_CONFLICT` when a key is reused for another item.
  
  The same key returns the stored response and debits once.
- `POST /api/shop/equip {"itemId"}` → `200 {"equipped":{"striker","board","coins"}}`; `403 {"error":"NOT_OWNED"}`.
- `GET /api/me/ledger` → `200 {"entries":[{"movementId","account":"player|house","delta","reason":"match|win|daily|local|purchase|grant","itemId":null|"<id>","createdAt"}],"sum"}`. It lists both entries of each of the player's movements, oldest first. `sum` is the total of the `player` entries.

**Health.** `GET /api/health` → always `200`: `{"status":"ok"}` when the database answers, `{"status":"unavailable"}` when it does not.

**Grading routes** exist only when `GRADING_KEY` is set. Every call carries `X-Grading-Key: <GRADING_KEY>`, and a wrong or missing key answers `404`. They never return magic links.

```
POST /api/grading/players
X-Grading-Key: <GRADING_KEY>
Content-Type: application/json

{"name":"Mira_K","avatar":7,"email":"mira@example.test","rating":1500,"rd":350,"volatility":0.06,"rankedGames":0,"chalk":300}
→ 201 {"id":"<player id>","name":"Mira_K","sessionCookie":"<value for dc_session>"}
```
Only `name` and `avatar` are required. With `email` the player is linked at once. `chalk` is added as one `grant` movement. The player counts as having chosen a name.

```
POST /api/grading/matches
X-Grading-Key: <GRADING_KEY>
Content-Type: application/json

{"mode":"ranked","format":"classic","players":["<seat 0 id>","<seat 1 id>"],"white":0,"turn":0,"board":3,"scores":[10,4],"pieces":[{"id":"w1","x":40.0,"y":252.1,"state":"board","pocketedBy":null},{"id":"queen","x":0,"y":0,"state":"pocketed","pocketedBy":0}],"queen":{"state":"covered","seat":0},"dues":[0,0],"timeouts":[0,0],"breakAttempt":null}
→ 201 {"id":"<match id>","url":"/match/<match id>","code":null}
```
- When `pieces` is omitted, the board uses the opening layout. When it is given, it lists the queen and coins. Any coin or queen not listed is pocketed and credited to the owner of its colour.
- Defaults: `board` 1, `scores` [0,0], `queen` on the board, `dues` and `timeouts` [0,0], `breakAttempt` null (the break is done).
- `mode` `private` also creates a room and returns its `code`.
- The match is live at once, exactly as if both players were seated. The shot clock starts when a player of that match first connects.

```
POST /api/grading/matches/<id>/shots
X-Grading-Key: <GRADING_KEY>
Content-Type: application/json

{"seat":0,"events":{"firstContact":"w1","pocketed":[{"id":"w1","pocket":"se"}],"strikerPocketed":false},"final":[{"id":"b2","x":-60.0,"y":10.0}]}
→ 200 shot result (with "frames": [])
```
This applies the events through the laws exactly as if the server had simulated that seat's shot: the same ruling, broadcast, verdict, history, ratings and chalk. Pieces not listed in `final` keep their positions, and pocketed pieces leave the board. It answers `409 {"error":"NOT_YOUR_TURN"}` when `seat` is not the turn.

```
POST /api/grading/simulate
X-Grading-Key: <GRADING_KEY>
Content-Type: application/json

{"pieces":[{"id":"w1","x":330.0,"y":330.0,"vx":212.132,"vy":212.132}]}
→ 200 {"events":{"firstContact":null,"pocketed":[{"id":"w1","pocket":"se"}],"strikerPocketed":false},"frames":[...],"final":[{"id":"w1","x":null,"y":null,"state":"pocketed"}],"durationSeconds":<number>,"maxSpeedAtRest":<number>}
```
An optional `"intent":{"seat","x","dx","dy","p"}` places the striker on that seat's baseline and strikes it. `firstContact` is null when there is no striker.

### Business rules (DP-06, DP-12, DP-23, DP-25, DP-29 to DP-46, DP-52, DP-55, DP-58 to DP-63, DP-69, DP-75, DP-78 to DP-80)

**Board and pieces.** Board coordinates are millimetres with the origin at the centre. x points right and y points down as seen from seat 0 (south). The playing surface is 740 by 740, with cushions at x = ±370 and y = ±370.
- **Pockets.** Diameter 44.5 (radius 22.25), centres at (±347.75, ±347.75). Ids: `nw` (-,-), `ne` (+,-), `sw` (-,+), `se` (+,+).
- **Pieces.**
  - Coins: diameter 31.0 (radius 15.5), mass 5.5 g. The queen is the same.
  - Striker: diameter 41.3 (radius 20.65), mass 15 g.
  - Ids: `striker`, `queen`, `w1`..`w9` (white), `b1`..`b9` (black).
- **Baselines.** Seat 0 shoots with the striker centre on y = 252.1, seat 1 on y = -252.1. The striker touches both baseline lines, so its centre sits on the midline. The legal centre range is |x| ≤ 200.0 on a 0.5 mm grid.
- **Placement.** A placement is legal when the striker centre is in range and at least 36.15 mm from the centre of every coin and the queen on the board. Exactly 36.15 is legal, because touching is allowed.
- **Shooter-relative offset.** The striker position control's value is the offset in mm from the baseline centre, left to right as the shooter sees it. Board x equals the offset for seat 0 and minus the offset for seat 1.
- **Aim.** 0.0 degrees points straight at the opponent's side. Positive angles turn clockwise as the shooter sees it, and the range is -180.0 to 180.0, so back-shots are allowed. Seat 0: dx = sin(a), dy = -cos(a). Seat 1: dx = -sin(a), dy = cos(a). Components are rounded to 6 decimals.
- **Power.** p is in [0, 1] on a 0.001 grid. The striker launches at 4000 × p mm/s.
- **Aim guide.** The aim guide traces the striker's straight path until it first touches a coin or the queen (centre distance 36.15) or a cushion, and reports that piece id or `cushion`. It predicts no rebound.

**Opening layout** (19 pieces, smallest gap 0.18 mm): queen (0.0, 0.0); w1 (31.2, 0.0); b1 (15.6, 27.0); w2 (-15.6, 27.0); b2 (-31.2, 0.0); w3 (-15.6, -27.0); b3 (15.6, -27.0); w4 (62.4, 0.0); b4 (46.8, 27.0); b5 (31.2, 54.0); w5 (0.0, 54.0); w6 (-31.2, 54.0); b6 (-46.8, 27.0); b7 (-62.4, 0.0); w7 (-46.8, -27.0); w8 (-31.2, -54.0); b8 (0.0, -54.0); b9 (31.2, -54.0); w9 (46.8, -27.0). The striker starts at the shooter's baseline centre.

**The model `dc-model-1`** is one deterministic model shared by browser and server.
- Fixed step of 1/240 second, with 4 substeps.
- Collisions between two circles, and between a circle and a cushion, are found at their exact time of impact, so no piece ever passes through a cushion or another piece. Collisions are frictionless impulses along the line of centres.
- Restitution coefficients: 0.90 between two coins, 0.88 between the striker and a coin, and 0.75 for any piece against a cushion.
- Sliding friction is a constant deceleration of 441.45 mm/s² (μ 0.045, g 9810 mm/s²) against the motion. A piece that would reverse within a step stops.
- Each step uses only addition, subtraction, multiplication, division and square root, and handles bodies in a fixed order (striker, queen, w1..w9, b1..b9), so a replayed shot log gives byte-identical final positions and verdicts.
- **Pocket capture.** A piece is pocketed in a pocket when its centre comes within 22.25 − 0.2 × its own radius of that pocket's centre while its speed is below 1800 mm/s: 19.15 mm for a coin, 18.12 mm for the striker. A faster piece is not captured.
- A shot ends when every piece's speed is below 0.5 mm/s, or after 12 simulated seconds.
- **Published set-ups:**
  1. A coin at (330.0, 330.0) moving toward the `se` pocket centre at 300 mm/s, alone on the board, is pocketed in `se`.
  2. A striker alone at (0.0, 252.1), shot by seat 0 at aim 180.0 with power 1.0, never leaves the board: every frame keeps |x| and |y| at most 349.35, and it ends not pocketed.
  3. Every simulation reports `maxSpeedAtRest` below 0.5 and `durationSeconds` of at most 12.
  4. On the opening layout with seat 0's striker at offset 0.0 and aim 0.0, the aim guide reports `w5`. At offset -200.0 and aim 0.0 it reports `cushion`.

**Ownership.** The player with white owns the white coins and the other player owns the black coins. "Own coin" means a coin of the shooter's colour. A coin's `pocketedBy` is the seat that owns its colour. The queen's `pocketedBy` is the seat she is pending for or covered by. A seat's coins left are its colour's coins on the board.

**Returned pieces** go to the centre spot (0, 0) if it is free. Otherwise they go to the first free point of the spiral: radius 35, 40, 45, ... mm, and at each radius the angles 0, 30, 60, ..., 330 degrees in that order, where point = (r cos a, r sin a) with the angle measured from +x toward +y. A point is free when its centre is at least 31.1 mm from every piece on the board. When one shot returns several pieces, the queen goes first, then coins by id (w before b, then by number). A due coin returned from earlier pockets is the shooter's lowest-numbered coin pocketed before this shot.

**Laws of a shot.** Each shot produces events, and exactly one ruling applies: the first step below that matches. Its verdict word and line are the published copy.
1. **Striker pocketed (foul).** Opponent coins pocketed on the shot stay down for the opponent. A queen pocketed on the shot, or pending cover, returns to the centre.
   - **No own coin pocketed on the shot:** one of the shooter's earlier pocketed coins returns as a due. If there is none, the due is owed (dues +1). The turn ends. `FOUL` with `Foul: striker pocketed. One due coin returns to the centre.` (a coin returned) or `Foul: striker pocketed. One due coin is owed.` (owed).
   - **Own coins pocketed on the shot:** those coins return, plus one due as above, and the shooter shoots again. `FOUL` with `Foul: striker pocketed. Your pocketed coins return with one due coin. Shoot again.`
2. **Queen pocketed early** (after this shot the shooter has no own coin pocketed): the queen returns to the centre and the turn ends. `RETURNED` with `Queen returned. Pocket one of your own coins first.`
3. **Queen and an own coin on the same shot:** covered at once, and the shooter shoots again. `COVERED` with `Queen covered.`
4. **Queen pocketed without an own coin** (not early): she is pending cover by the shooter, who shoots again. `POCKETED` with `Queen pocketed. Cover her with your next pocket.`
5. **Shot after the queen was pocketed:**
   - An own coin pocketed covers her, and the shooter shoots again. `COVERED` with `Queen covered.`
   - Otherwise she returns to the centre and the turn ends. `RETURNED` with `Queen not covered. She returns to the centre.`
6. **Due owed and own coins pocketed:** one of those coins returns, dues −1, and the shooter shoots again. `POCKETED` with `Due paid: one coin returns to the centre. Shoot again.`
7. **Own coins pocketed** (opponent coins pocketed with them stay down for the opponent): the shooter shoots again. `POCKETED` with `1 coin pocketed. Shoot again.` or `<n> coins pocketed. Shoot again.`
8. **Only opponent coins pocketed:** they stay down for the opponent and the turn ends. `NO POCKET` with `Opponent's coin pocketed. Turn passes.`
9. **Nothing pocketed:** the turn ends. `NO POCKET` with `Nothing pocketed. Turn passes.`
10. **Break.** The player with white breaks every board and has up to 3 attempts to touch a coin or the queen. A break shot whose `firstContact` is null or `cushion` is a miss: it is retried without changing the turn, with `NO POCKET` and `Break missed. Attempt <k> of 3.` (k is the next attempt). After the third miss the turn passes, with `Break missed 3 times. Turn passes.`, and the break is over. A break that touches a piece is ruled by steps 1 to 9 and ends the break.
11. **Shot clock (online only).** If no shot arrives by the deadline, the turn passes with no due: `TIME UP` with `Time's up. The turn passes.` During a break this ends the break. Three consecutive turns of the same player that end by timeout forfeit the match for that player. Any shot resets that player's count.

**Board end** is checked after the ruling. Dues still owed when a board ends are cleared.
- **The shooter pockets their own last coin while the queen is covered** (by either player): the shooter wins the board and scores 1 per opponent coin on the board, plus 3 if the shooter covered the queen and their match score before this board is below 22. Points lines:
  - `<p> points: <n> coins left + 3 for the queen`
  - `<p> points: <n> coins left`
  
  Example: the queen covered by the shooter, 4 opponent coins left and a match score of 10 scores 7 (`7 points: 4 coins left + 3 for the queen`). The same at 22 scores 4 (`4 points: 4 coins left`).
- **The shooter pockets the opponent's last coin:** the shooter loses the board, and the opponent scores the shooter's coins on the board + 3: `<p> points: <n> coins left + 3 penalty`. Example: with 5 shooter coins left, the opponent scores 8 (`8 points: 5 coins left + 3 penalty`).
- **The shooter pockets their own last coin while the queen is not covered:** the shooter loses the board, and the opponent scores the shooter's coins on the board + 3, which is `3 points: 0 coins left + 3 penalty`. If both last-coin rules apply in one shot, the opponent's-last-coin rule wins.
- **Formats.**
  - Quick: one board, and the board winner wins the match.
  - Classic: ends when a player reaches 25 points, or after board 8 with the higher score. A tie after board 8 plays board 9 (`Extra board`).
- **Next board.** The server sets up the next board at once, from the opening layout: queen on the board, dues and timeouts cleared, `breakAttempt` 1. The loser of a board breaks the next one and plays white. On board 1 the toss winner breaks with white. In a rematch, the player who did not break board 1 last time breaks and plays white. In the queue, the toss decides.
- **Resignation and forfeit.** The other seat wins, and scores stay as they were at that moment.

**Match states.**
- `waiting` → `active`: when both seats are ready (rooms). Queue matches and grading matches start `active`.
- `active` → `completed` (`endReason` `played`), `forfeit` (`left`, `timeouts`, `resigned`) or `abandoned` (both players disconnected past the reconnect window, which means no winner, no rating change, no chalk and no history row).
- Finished matches accept no shots (`409 MATCH_NOT_ACTIVE`), no ready (`409 MATCH_NOT_WAITING`) and no resign (`409 MATCH_NOT_ACTIVE`).
- `phase` is `aim` throughout an active match (the server sets up the next board itself) and `match-over` when it is finished. The page's own `refereeing`, `moving` and `board-over` phases are display states.

**Time.** The server alone decides shot timeouts, forfeits, reconnect expiry, band widening, room expiry and rematch expiry, and pushes each change to open pages. Pages count down on browser timers from the remaining time the server sends (`turnRemainingMs`, `reconnectRemainingMs`, `expiresInMs`) and never compare a server time with their own clock, because the device clock may be wrong. Every `<m:ss>` countdown (shot clock, reconnect overlay, room closing) shows the remaining time in whole seconds rounded up, as minutes, a colon and two-digit seconds. So a turn's clock first shows the full configured time (for example `0:20` by default, `0:04` on the short-timer copy) and shows `0:00` only once the time is up. The queue's `#queue-elapsed` counts up from `waitedSeconds` in whole seconds rounded down.

| Env var | Default | Rule |
|---|---|---|
| `SHOT_TIMER_SECONDS` | 20 | the time to shoot. Each turn starts its clock when it begins. A disconnected player's clock keeps running. |
| `RECONNECT_SECONDS` | 60 | after a disconnect (socket closed, or no `pong` for 5 seconds), the player has this long to rejoin; otherwise they forfeit with `left` |
| `BAND_WIDEN_SECONDS` | 5 | the ranked band starts at ±100 around the player's rounded rating and widens by 50 each period, up to ±400 |
| `ROOM_EXPIRY_SECONDS` | 600 | a room with no joiner closes this long after creation |
| `REMATCH_SECONDS` | 60 | a rematch offer expires after this long |
| `VERDICT_BANNER_MS` | 2000 | how long the verdict banner stays |
| `MAGIC_LINK_SECONDS` | 900 | how long a sign-in link is valid |
| `TOSS_SEED` | unset | `0`: seat 0 (the host or earlier joiner) wins every toss; `1`: seat 1 wins; unset: random |

The verifier also runs a short-timer copy of the app with its own empty database: `SHOT_TIMER_SECONDS` 4, `RECONNECT_SECONDS` 6, `BAND_WIDEN_SECONDS` 2, `ROOM_EXPIRY_SECONDS` 6, `REMATCH_SECONDS` 6, `TOSS_SEED` 0.

**Single winners under concurrency.**
- A room admits exactly one joiner: when two joins arrive together, one gets `200` and the other `409 ROOM_FULL`.
- **Queue pairing** is one atomic claim: every waiting player is paired exactly once, and three simultaneous entrants make one pair with one left waiting.
  - Ranked: two players pair when their rating difference is within both players' current bands (inclusive).
  - Casual: any two players pair.
  - Among candidates, the longest-waiting is paired first, with ties broken by player id. The earlier joiner takes seat 0.
- Two simultaneous purchases never both succeed when only one is affordable or for the same item.
- Concurrent shots for one `shotSeq` are ruled once.

**Rematch.** After a private match finishes, either player may offer. The other sees the offer and can accept. When both accept within `REMATCH_SECONDS`, the room hosts a fresh match at 0-0 with the breaker swapped. An unanswered offer expires, and a decline ends it.

**Ratings (Glicko-2).**
- Start: rating 1500, RD 350, volatility 0.06.
- Constants: tau 0.5, convergence 0.000001, scale 173.7178.
- Each ranked match is one rating period for both players, applied once when the match finishes. A forfeit or resignation is a loss. An abandoned match changes nothing.
- Worked examples:
  - Two new players: the winner becomes 1662.31 (RD 290.32) and the loser 1337.69 (RD 290.32).
  - 1520/120 beats 1600/100: they become 1563.84 (RD 114.63) and 1569.20 (RD 97.20).
- The same change (two decimals) is stored once and shown both in the Match over dialog and in history.
- Tiers: Bronze below 1400, Silver below 1600, Gold below 1800, Platinum below 2000, Diamond 2000 and above.
- Leaderboard: players with at least 10 ranked matches and RD below 150, top 100 by rating, plus the viewer's own row.

**Chalk (a paired ledger).**
- Every movement is two entries with one `movementId`: one on the player's account and the opposite amount on the house account, so each pair sums to zero. A balance is the sum of the player's entries and is never stored separately. Corrections are new reversing movements, never edits.
- Awards when an online match (private, casual or ranked) finishes `completed` or `forfeit`:
  - each player 20 (`match`), except a player who forfeited, who gets nothing;
  - the winner a further 30 (`win`);
  - the winner's first win of the UTC day a further 50 (`daily`).
  
  Abandoned matches award nothing.
- A recorded pass-and-play match gives the session's player 10 (`local`), for at most 5 recorded per UTC day.
- A purchase is one movement of minus the price (`purchase`) and is refused when the balance is short. Its item is owned only when its debit exists, in the same transaction.
- Owned items and equipped choices belong to the player and follow them to every device they sign in on. The equipped striker skin shows to both players. Board theme and coin set show only on the viewer's own screen.

**Names.**
- 3 to 16 characters of letters, digits and underscores.
- Unique ignoring case.
- Refused when it contains, ignoring case, any word on the blocklist in Seed data.

### Services (DP-53, DP-72, DP-73, DP-74)

- **PostgreSQL** is the system of record for players and sessions, linked emails and link tokens, matches, boards, every ruled shot with its events and verdict, queue entries, rooms with their server-held expiry and single joiner, rating rows and the change each match made, the chalk ledger, owned items and equipped choices. The app applies its schema idempotently every time it serves. When the database is unreachable:
  - the app still boots and serves every page;
  - API routes that need the database answer `503 DATABASE_UNAVAILABLE`;
  - pass-and-play works fully on the device;
  - a finished pass-and-play match is kept on the device and sent again on every later page load and every 30 seconds while a page is open, until the server records it.
- **Mailpit** (SMTP) receives one message per Send link:
  - to the entered address;
  - From the value of `MAIL_FROM` (`Due Coin <signin@duecoin.test>` in grading);
  - subject `Your Due Coin sign-in link`;
  - plain-text body containing the line `Open this link to sign in: <APP_PUBLIC_URL>/auth/link/<token>`.
  
  A send counts only when the SMTP server accepts the message. When mail is unreachable, the route answers `503 MAIL_UNAVAILABLE`, the dialog shows the mail outage copy, the player stays unlinked and ranked stays locked. Guest play is unaffected.

### Seed data (DP-06, DP-64, DP-66)

No players, matches or rooms exist at start. Avatars are numbered 1 to 24 and drawn by the app. The name blocklist is `admin`, `referee`, `duecoin`, `tamarind`, `moderator`.

Shop catalogue (id, name, price in chalk):

| Kind | Items |
|---|---|
| Strikers | `striker-ply` Plain Ply 0; `striker-tomato` Tomato Lacquer 120; `striker-cobalt` Cobalt Ring 250; `striker-brass` Brass Inlay 420 |
| Boards | `board-ply` Light Ply 0; `board-chalk` Chalk Line 150; `board-walnut` Walnut Night 200 |
| Coin sets | `coins-ivory` Ivory and Ink 0; `coins-shell` Shell and Slate 180 |

Price-0 items are owned and equipped by every new player. Every name, email and person in this brief and in test data is invented.

## Technical requirements

### Deployment (DP-70)

TypeScript on Node.js 22 with npm, for both the server and the browser client. `/app/run.json` holds string commands:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` behaves as stated in API. The verifier runs extra copies of the app:
- one with the database unreachable;
- one with mail unreachable;
- the short-timer copy from Business rules.

`/app` must copy cleanly: no virtual environment and no absolute symlinks.

### Configuration and secrets (DP-87)

The app reads these at start and never hard-codes them or sends them to the browser:

| Group | Env vars |
|---|---|
| Database | `DATABASE_URL` |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| Public address | `APP_PUBLIC_URL`, `APP_PUBLIC_PORT` |
| Grading | `GRADING_KEY` |
| Timers and toss | `SHOT_TIMER_SECONDS`, `RECONNECT_SECONDS`, `BAND_WIDEN_SECONDS`, `ROOM_EXPIRY_SECONDS`, `REMATCH_SECONDS`, `VERDICT_BANNER_MS`, `MAGIC_LINK_SECONDS`, `TOSS_SEED` |

The browser learns timer values only from `GET /api/config`.

### Server boundary (DP-71, DP-72)

- Same origin only:
  - a state-changing request whose `Origin` header names another origin answers `403 {"error":"CROSS_ORIGIN"}`;
  - socket upgrades from another origin are refused.
- JSON bodies are limited to 65,536 bytes (that size allowed), except `POST /api/local-matches` at 1,000,000 bytes (allowed). Larger bodies answer `413 {"error":"PAYLOAD_TOO_LARGE"}`.
- A POST body that is not `application/json` answers `415 {"error":"UNSUPPORTED_MEDIA_TYPE"}`.
- The server never serves its source files, source maps of server code, `.env` files, the run manifest, the dependency folder or any credential. Those paths answer 404.
- The browser never requests another origin. Chivo and Lucide are served from the app's own origin out of open-licensed packages. There are no external images, fonts or scripts, and all art is drawn by the app.
- At boot the app starts and serves pages with the database or mail unreachable, and reconnects to the database once it answers.

### Browser support and performance (DP-76)

The current Chromium, Firefox and WebKit are supported, at 375x812 (touch), 768x1024 and 1280x800. The board is drawn with SVG or a 2D canvas, never WebGL, and every piece is mirrored in the DOM as published. The match screen can be used within three seconds of navigation, and aiming input updates the readouts within one animation frame.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence, plus the Chivo font and Lucide icons. Shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- IF-03: Every shipped package and asset is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or SIL OFL 1.1.
- IF-04: PostgreSQL is the only datastore. No other database, cache, queue, object store or realtime service is added, and the app writes no data files on the server.
- IF-05: All server and client source is TypeScript.
- IF-06: The provided service configuration (the development compose fragments for PostgreSQL and Mailpit) is left unchanged.
- IF-07: `/app` contains no virtual environment and no absolute symlinks.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes on domain data.
- Names match this brief's domain terms: striker, coin, queen, cover, due, board, shot, verdict, seat, break, room, queue, band, chalk, ledger movement.
- Each domain rule is decided in exactly one place in the source, and both browser and server call that place. This covers each law of a shot, board scoring, placement legality, match state transitions, rating updates and chalk awards.
- No abstraction has only one implementation, and there is no dead, commented-out or unreachable code.
- Code does not defend against states the rules make impossible.
- Every API error uses the one published `{"error":"<CODE>"}` shape.
- No feature, route or screen goes beyond this brief.
