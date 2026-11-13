# Marrowgate Supply Cupfold

Cupfold is a bracket desk for the one volunteer who runs a local competition: a monthly board-game cup in a back room, a club ladder, an office league, a school or community cup. It works for any game or sport. It covers four formats: single elimination, double elimination, round robin and Swiss. Players report their own scores and the opponent confirms them. A roster comes in as a file in Cupfold's own format and is kept exactly as it was uploaded. Standings print the tiebreak that decided each place. Before an organizer edits an earlier result, Cupfold shows every later match the edit would undo. Build it as one TypeScript web app: a Node server and a browser client. The server keeps everything in Postgres, stores roster files and tournament logos in MinIO (S3 API), and sends live changes to every open screen over its own WebSocket. Accounts are local, with a username and password. Out of scope: email, outside sign-in, password reset, payments and entry fees, chat or push notifications, game integrations, embeds, AI features, sound, external assets and CDNs, and any datastore, queue, cache or search service besides Postgres and MinIO. Every person, club and tournament named here is invented. Cupfold names no real game, sport brand, league or player.

## Problem and users

Most brackets are run by one volunteer who books the room, keeps the clipboard and plays as well, usually from a phone. Esports platforms assume a game integration and a production crew. Free bracket makers draw one elimination tree and stop there. Score confirmation and disputes, when they exist, sit on a separate admin page. When an organizer fixes a result entered by mistake two rounds ago, they are told to "reset the match" and then have to work out by hand which later matches are now wrong. Swiss and round-robin standings rarely say which tiebreak decided a place, so the argument at the prize table goes to whoever is loudest. Spectators refresh a share link that runs minutes behind. Players lose their results once an event is archived. The field arrives as a sign-up sheet that someone retypes, and when a player says their name was entered wrong, nobody can show what was submitted.

- **Organizer** (weekly): creates a tournament in any of the four formats, loads and seeds the field, runs check-in, starts it, resolves disputes and corrects results without breaking the bracket. Often works from a laptop wired to the venue projector, using only the keyboard.
- **Co-organizer** (weekly): helps run a live event from a second device, usually a tablet. Calls matches, resolves disputes and marks no-shows while seeing the same bracket the organizer sees.
- **Player** (weekly): checks in, reports their own match score or confirms or disputes the opponent's report, and keeps a history of final placings across tournaments.
- **Spectator** (occasional): follows a tournament live from a read-only share link, usually on a phone, without an account.

## Journeys

1. **Set up a cup from a roster file.** Starts with no account. The organizer creates an account and creates a single-elimination tournament, which lands them on its setup page. They upload a roster file that has three mistakes. The errors appear as a list with line numbers and nothing is added. They upload the corrected file. The field appears in seed order and the stored file can be downloaded byte for byte. They add a logo, which shows on the setup page at once. Once check-in opens, the public page shows it beside the tournament name.
2. **Seed, check in and start.** Starts from a draft tournament with a full field. The organizer reorders seeds with the keyboard and watches the round 1 preview follow each move. They open check-in. Players check in from their phones and the checked-in count rises on every screen. Check-in closes on the server's clock and a late player is refused. The organizer starts the tournament. The no-shows are removed and named, and the bracket appears with byes in the standard places.
3. **Report, confirm, dispute, resolve.** Starts from a running bracket. A player reports 2-1 on their match card. The opponent's card changes live to show it is waiting on them. The opponent disputes with 1-2. The organizers see the dispute live and one of them resolves it. Every screen shows the resolved card and announces who advances.
4. **Two people on one match.** Starts from a running bracket with two co-organizers on two devices. Both open the same match. One saves first. The other's save is refused with a sentence naming who updated the match and the current score, and both screens show the same result.
5. **Fix an old result with Shutter trace.** Starts from a bracket with results through round 3. The organizer edits a round 1 result so that a different player wins. Before anything changes, a tangerine path runs from that card to every later match the edit would undo, and a counter says how many will reset and how many of those were confirmed. Escape backs out with nothing changed. Confirming resets exactly those matches on every screen, in the same order.
6. **Double elimination to a grand final reset.** Starts from an 8-entrant double elimination near the end. Losers drop into the published losers rounds. The losers-side finalist wins grand final 1, so a grand final reset appears live for organizers and spectators. It is played and the champion is announced.
7. **Round robin and Swiss standings.** Starts from a round robin one result from the end with three entrants level on points, or a Swiss event after round 1. Saving the last result reorders the standings live and names the deciding tiebreak on every row. Starting Swiss round 2 pairs everyone with no rematch and gives the bye to the published entrant.
8. **Follow on a phone, keep the history.** A spectator on a phone swipes between rounds on the share link and watches cards change live. When the tournament finishes, each linked player's profile shows their place, and it stays there after reload and after later edits to other tournaments.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** The app installs, builds and serves from /app/run.json on port 4173 (honouring APP_PUBLIC_PORT), and GET /api/health answers as specified in Server boundary.
- **DP-02 — Accounts and sessions** Sign-up, sign-in and sign-out use a local username and password with the published validation, rate limit and session cookie, as qualified in API.
- **DP-03 — Errors and rate limits** Every API error uses the one published body shape and code list, follows the one published error precedence, and applies the published per-minute limits on sign-in attempts and match writes.
- **DP-04 — Grading routes** When CUPFOLD_GRADING=1, POST /api/grading/seed, POST /api/grading/session and POST /api/grading/clock behave exactly as published, and without it they answer 404.
- **DP-05 — Server clock and timers** Every deadline is decided on server time and every timer and limit reads its published environment variable, with the client reading its values from GET /api/config.
- **DP-06 — Create a tournament** A signed-in user creates a tournament in any of the four formats and lands on /t/<tournament id>/setup, which survives reload.
- **DP-07 — Tournament lifecycle** A tournament moves only along the published states, and every illegal move is refused with 409 and its published message.
- **DP-08 — Co-organizers** The organizer adds and removes co-organizers by username, and co-organizers hold every organizer power except deleting the tournament and managing co-organizers.
- **DP-09 — Keyboard seed reorder** In list "Seeding", Alt+ArrowUp and Alt+ArrowDown move the focused entrant one seed, save the order, renumber the list, keep focus on the moved entrant and announce the move.
- **DP-10 — Typed and dragged seeds** A seed typed into spinbutton "Seed for <name>" or a drag in the list moves the entrant, the round 1 preview follows each move, and a stale reorder is refused with the published message.
- **DP-11 — Standard seeding and byes** Elimination brackets use the next power of two with the published seed placement, byes go to the top seeds, no round 1 match has two byes, and bye matches are won automatically.
- **DP-12 — Start lands on the bracket** Starting a tournament lands the organizer on /t/<tournament id>/bracket with every round 1 card named as published, and reload shows the same bracket.
- **DP-13 — Match card names** Every match card is a button whose accessible name, visible status text and data- hooks follow the published grammar in every state, and status is never shown by colour alone.
- **DP-14 — Bracket regions and focus** Each bracket region is a named region that takes one Tab stop, with exactly one of its cards in the Tab order.
- **DP-15 — Bracket arrow keys** Arrow keys, Home and End move focus between match cards as published, and Enter or Space opens the card's dialog.
- **DP-16 — Score dialog** dialog "Report score" takes each side's games by keyboard, keeps Tab inside, closes on Escape with nothing changed, returns focus to the card after every save, and refuses draws in elimination matches.
- **DP-17 — Who may report** Only the two entrants of a match or an organizer may report it, and a player can never confirm their own report.
- **DP-18 — Confirm or dispute** The opponent of the reporter confirms or disputes in dialog "Confirm score", and every open screen shows the new card state live.
- **DP-19 — Resolve a dispute** Only organizers resolve a disputed match in dialog "Resolve dispute", and resolving lands them on /t/<tournament id>/bracket?match=<match id> with that card focused.
- **DP-20 — Auto-confirm on server time** A reported score becomes confirmed when the confirm window passes on server time unless answered first, and the card's countdown is display only and survives reload.
- **DP-21 — Overdue flag** A called match not reported within the match time limit, or a Swiss match unreported when the round time ends, is flagged Overdue to organizers only.
- **DP-22 — Stale match writes** A match write carrying a version that is no longer current is refused with 409 and the current match, and the dialog stays open showing who updated it and the current score.
- **DP-23 — Simultaneous conflicting reports** When both players report one match, the second report is treated as the opponent's answer, so conflicting scores become exactly one dispute and never two results.
- **DP-24 — One resolution per dispute** When two organizers resolve the same dispute, exactly one resolution stands and the other is told whose resolution stands and its result.
- **DP-25 — Shutter trace preview** The edit preview returns the exact dependent set of a proposed result change in reset order, with the reset count and the confirmed count, without changing anything.
- **DP-26 — Edit commits the previewed set** Confirming an edit resets exactly the previewed dependent set, no fewer and no more, and Escape or Cancel leaves the server unchanged and returns focus to button "Edit result".
- **DP-27 — Stale preview refused** An edit whose dependent set or versions changed after its preview is refused with 409 and the published stale-preview message.
- **DP-28 — Shutter trace motion** Shutter trace draws the path card by card in reset order, half-closes each card's slats, counts up in the dialog, and reverses step by step on cancel, at the published timings.
- **DP-29 — Shutter trace under reduced motion** With reduced motion, every dependent card is outlined and labelled Will reset at once, the full reset list and count appear without animation, and confirm and cancel land focus in the same places.
- **DP-30 — Resets reach every screen** A committed edit updates every open screen in reset order within 2 seconds and announces the reset count there.
- **DP-31 — Losers bracket mapping** Losers of winners rounds drop into the published losers rounds and matches, in the published order.
- **DP-32 — Grand final and reset** The grand final pairs the two bracket winners, and a grand final reset is played only when the losers-side finalist wins grand final 1; otherwise it shows as not needed.
- **DP-33 — Round robin schedule** Round robin pairs every entrant with every other exactly once, using the published rotation, round numbering and bye rule.
- **DP-34 — Round robin tiebreaks** Round robin standings rank by match points, head-to-head among the tied, game difference, games won, then seed, computed once on the server.
- **DP-35 — Standings table** table "Standings" shows the published columns and values in order, names the deciding tiebreak on every row, matches on every screen and updates live.
- **DP-36 — Swiss pairing** Swiss rounds pair by the published rule with no rematch while a legal pairing exists, and starting a round shows each player their new card live.
- **DP-37 — Swiss bye** With an odd field, the lowest-ranked entrant without a previous bye gets the bye, which counts as a 2-0 win.
- **DP-38 — Swiss tiebreaks** Swiss standings rank by match points, Buchholz cut 1, Buchholz, Sonneborn-Berger, then seed, computed once on the server.
- **DP-39 — Check-in window** The organizer opens check-in with a close time, linked players check in during it, and the checked-in count and an announcement update on every screen live.
- **DP-40 — Check-in closed** At the close time on server time, check-in closes for everyone, and later check-ins are refused with 409 and the published copy whatever the device clock says.
- **DP-41 — No-shows removed at start** Starting after check-in removes unchecked entrants, names them in the published sentence and seeds the remaining field in its kept order.
- **DP-42 — Next match after check-in** A player who checks in lands on /t/<tournament id>/me, which shows their next match and follows it live.
- **DP-43 — Published breakpoints** Phone (under 768 pixels wide), tablet (768 to 1199) and desk (1200 and wider) each show their published layout and order at 375x812, 768x1024 and 1280x800, with no horizontal page overflow.
- **DP-44 — Phone rounds and swipe** On a phone, the bracket shows one round at a time under tablist "Rounds", and a horizontal swipe or a tab moves between rounds and updates the selected tab.
- **DP-45 — Spectator share link** The share link shows the tournament read-only without an account, exposes display names and scores only, and refuses every write.
- **DP-46 — Replace share link** Replacing the share link kills the old link at once, including its open live connection, and the new link works.
- **DP-47 — Live channel and catch-up** Every state change is sent over the tournament's live channel with a per-tournament sequence number, shows on every open screen within 2 seconds without reload, and a reconnecting screen receives what it missed.
- **DP-48 — Advance motion** When a result is confirmed or resolved, the winner's name travels from its card to its next card at the published timing.
- **DP-49 — Reduced-motion advance** With reduced motion, no card, name or slat animates, while the result, the announcements and focus are the same.
- **DP-50 — Bracket announcements** status "Bracket announcements" reads the published sentences identically on every screen, and status "Your action" reads the actor's own outcome, without moving focus.
- **DP-51 — Roster format** Roster files follow the published Cupfold roster format, and every invalid file is refused with the published line-numbered messages in the published order.
- **DP-52 — Roster stored before entrants** A roster upload replaces the field all or nothing, and only after MinIO confirms the file is stored byte for byte under the published key.
- **DP-53 — Roster download** button "Download roster file" returns the latest accepted roster file exactly as it was uploaded, byte for byte.
- **DP-54 — Tournament logo** A PNG or JPEG logo is stored in MinIO under the published key and appears on the setup page, and on the public page once the tournament has left draft, only after MinIO confirms it.
- **DP-55 — Storage outage and recovery** While MinIO is unreachable, health reports it, uploads answer 503 with the published copy and add nothing, bracket play keeps working, and uploads work again when storage returns without a restart.
- **DP-56 — Final placements** A finished tournament ranks its field by the published placement rules and announces the winner.
- **DP-57 — Tournament history** Each linked player's /u/<username> page gains one row per finished tournament in the published format, written once and unchanged after reload and later edits elsewhere.
- **DP-58 — Format chooser hero** The landing page shows the published hero: a very large wordmark, the four format names stepping down in size, one procedural object per format in a coloured tile, its fact and one tangerine call to action.
- **DP-59 — Working-screen look** Bracket, setup, standings and share screens use the published palette, Geist type, flat match-state fills with text status, square tangerine buttons and the hero-scale crop.
- **DP-60 — Services wired from configuration** Every service address and credential is read from the environment, and every tournament, match, standing and file comes from Postgres and MinIO rather than browser state or fixed data.

## Frontend

### Screens and layout (DP-06, DP-12, DP-42, DP-43, DP-44, DP-58, DP-59)

Page routes. Any other non-API path is a not-found page.

| Route | Who | Shows |
|---|---|---|
| `/` | anyone | The format chooser hero, plus `link "Sign in"` and `link "Create account"` (or `link "Your tournaments"` when signed in). |
| `/signup`, `/signin` | anyone | One form, one field per row. Both accept `?next=<path>` and land there afterwards. Without it they land on `/t`. |
| `/t` | signed in | `list "Your tournaments"`: each tournament you organize, co-organize or play in, as a link named with the tournament name, plus `link "New tournament"`. |
| `/t/new` | signed in | The create form. Creating lands on `/t/<tournament id>/setup`. |
| `/t/<tournament id>/setup` | organizers | Field, seeding, round 1 preview, roster and logo, co-organizers, check-in and start controls. |
| `/t/<tournament id>/bracket` | organizers, any signed-in viewer of a non-draft tournament | Before start: the field and the round 1 preview, with `button "Check in"` for linked players. After start: the live bracket, plus standings for round robin and Swiss. With `?match=<match id>`, that card has focus on load. |
| `/t/<tournament id>/disputes` | organizers | `list "Open disputes"`. |
| `/t/<tournament id>/me` | the linked player | `region "Next match"`. |
| `/t/<tournament id>` | signed in | Redirects: organizers go to `/setup` before start and `/bracket` after. Everyone else goes to `/bracket`. |
| `/s/<share code>` | anyone | The public page: a hero, then the read-only bracket and standings. |
| `/u/<username>` | signed in | Heading with the username, then `list "Tournament history"`. |

Signed-out visitors to a signed-in route are sent to `/signin?next=<that path>`.

Layout by viewport. A layout is chosen by width alone: phone under 768 pixels, tablet from 768 to 1199 pixels, desk at 1200 pixels and wider. No other breakpoint changes which layout 375x812, 768x1024 or 1280x800 gets. No page scrolls horizontally at any of the three sizes. Bracket panning happens inside the bracket area, never on the page.

- **Landing**
  - Desk: the wordmark sits top-left and the one-line description top-right. In the centre is a tall rounded tile holding the current format's object. The four format names stand to the left of the tile, right-aligned. The format fact and `link "Start a tournament"` sit under the tile.
  - Tablet: the same arrangement, with tighter margins.
  - Phone, top to bottom: wordmark, description, the format names as one horizontal snapping row, the tile at full width with its object cropped by the right edge of the screen, the fact, the call to action.
- **Tournament bracket page**
  - Desk: a left rail about a quarter of the width holds the tournament name, its state, `status "Check-in count"` before start, and the organizer actions. The bracket area fills the rest. The current round (defined in Business rules; in double elimination each region scrolls to its own region current round) is scrolled to the left edge of the bracket area. Its cards are set so large that the column runs past the right edge of the screen and is cropped. Earlier rounds sit off to the left, one pan away. Standings (round robin and Swiss) sit under the bracket.
  - Tablet: the rail becomes a top bar. The bracket area spans the full width with the current round and the next round in view.
  - Phone, in one column top to bottom: top bar with name and state, the actions, `tablist "Rounds"`, the selected round's cards at full width, then standings.
  - On every size, `button "Whole bracket"` and the Z key switch to the whole tree scaled to fit the bracket area. It is never the default view.
  - For double elimination, desk and tablet stack the winners bracket, losers bracket and grand final regions top to bottom.
- **Setup page**
  - Desk: two columns. The seeding list is on the left. The round 1 preview, roster, logo, co-organizers and check-in controls are on the right.
  - Tablet and phone: one column in that same order.
- **Public page `/s/<share code>`**
  - Desk and tablet: a second hero. The field list is on the left. The trophy for the tournament's format, in the tournament's fill colour, is on the right and cropped by the right edge, with the tournament name and `<n> entrants` under its corner. The logo appears beside the name when one is stored. The read-only bracket follows, laid out like the bracket page.
  - Phone: the hero is stacked (name, trophy cropped by the right edge, field), then the phone bracket.
- **Player page `/t/<tournament id>/me`**: one column on every size. `region "Next match"` holds the player's next match card at full width.
- **Empty states** show the format's object small in a corner and one sentence. The sentences are in Feedback states.

### Public screens and controls (DP-09, DP-10, DP-13, DP-14, DP-16, DP-18, DP-19, DP-26, DP-35, DP-44, DP-45, DP-46, DP-50, DP-51, DP-53, DP-57, DP-58)

Only these roles, names and hooks are public. Names are exact, including case. A file input is reached by its label.

| Where | Role and accessible name | Visible copy / notes |
|---|---|---|
| Landing | `heading "Cupfold"` (level 1) | The wordmark. |
| Landing | `tablist "Formats"` with `tab "Single elimination"`, `tab "Double elimination"`, `tab "Round robin"`, `tab "Swiss"` | The format names. The chosen tab has `aria-selected="true"`. |
| Landing | `img "Single elimination cup"`, `img "Double elimination loving cup"`, `img "Round robin medal"`, `img "Swiss counters"` | One object at a time, in the tab panel. |
| Landing | `link "Start a tournament"` | Goes to `/t/new`. |
| Sign up | `textbox "Username"`, password field labelled `Password`, `button "Create account"` | |
| Sign in | `textbox "Username"`, password field labelled `Password`, `button "Sign in"` | |
| Any signed-in page | `button "Sign out"` | |
| Create | `textbox "Tournament name"`, `radiogroup "Format"` (radios named as the four format names), `combobox "Time zone"` (IANA names, default `UTC`), `radiogroup "Trophy fill"` (radios `Lilac`, `Lemon`, `Mint`), `button "Create tournament"` | |
| Setup | `heading` (level 1) with the tournament name | |
| Setup | `list "Seeding"`, each entrant a focusable `listitem` named `<seed>. <name>`, holding `spinbutton "Seed for <name>"`, `textbox "Account for <name>"` and `button "Remove <name>"` | |
| Setup | `textbox "Entrant name"`, `button "Add entrant"` | |
| Setup | `region "Bracket preview"` containing `list "Round 1 preview"`, items `Match <m>: <upper> vs <lower>` (or `Match <m>: <name> vs bye`) | |
| Setup | `button "Upload roster"` opens `dialog "Upload roster"` with the file input labelled `Roster file` and `button "Add roster"` | |
| Setup | `list "Roster errors"`, headed by a focusable level-2 heading | Messages in Feedback states. |
| Setup | `button "Download roster file"` | Present once a roster has been accepted. |
| Setup | `button "Upload logo"` opens `dialog "Upload logo"` with the file input labelled `Logo image` and `button "Add logo"` | |
| Setup | `img "<tournament name> logo"` | Present once a logo is stored. |
| Setup | `textbox "Co-organizer username"`, `button "Add co-organizer"`, `list "Co-organizers"` with `button "Remove <username>"` per item | Organizer only. |
| Setup | `button "Open check-in"` opens `dialog "Open check-in"` with `textbox "Check-in closes"` and `button "Start check-in"` | The textbox opens empty. Its text format is in Interactions. |
| Setup | `button "Close check-in"`, `button "Back to draft"`, `button "Start tournament"`, `button "Delete tournament"` (organizer only) | Each shown only where its move is legal. |
| Setup and bracket | `status "Check-in count"`, `checkbox "Checked in: <name>"` per entrant for organizers | |
| Setup and bracket | `button "Share"` opens `dialog "Share tournament"` with a read-only `textbox "Share link"`, `button "Copy link"`, `button "Replace link"` | Organizers only. |
| Bracket (players) | `button "Check in"` | Shown to a linked, not yet checked-in player only while the server says check-in is open. |
| Bracket | `region "Bracket"` (single elimination); `region "Winners bracket"`, `region "Losers bracket"`, `region "Grand final"` (double elimination); `region "Rounds"` (round robin and Swiss) | Desk and tablet. |
| Bracket | match cards: `button` named by the card grammar below | |
| Bracket | `button "Whole bracket"` with `aria-pressed` | Shortcut Z. |
| Bracket (phone) | `tablist "Rounds"`, one `tab` per round, and a `tabpanel` named after its tab that holds that round's cards | Tab names below. |
| Bracket (Swiss organizers) | `button "Start next round"` | |
| Bracket and share | `table "Standings"` | Round robin and Swiss. |
| Bracket, share, me | `status "Bracket announcements"` (polite) | Identical text on every screen. |
| Bracket, setup, me, disputes | `status "Your action"` (polite) | The actor's own outcome only. |
| Every page | `status "Page notice"` (visible band) and `alert` (visible band) | Notices and errors. |
| Card dialog | `dialog "Report score"`: `spinbutton "<upper name> games"`, `spinbutton "<lower name> games"`, `button "Submit score"` (entrants) or `button "Save result"` (organizers), `button "Call match"` (organizers, pending only), `button "Cancel"` | |
| Card dialog | `dialog "Confirm score"`: the text `<reporter> reported <u>-<l>`, the countdown, the same two spinbuttons (pre-filled with the report), `button "Confirm score"`, `button "Dispute score"`, `button "Cancel"` | The opponent only. |
| Card dialog | `dialog "Resolve dispute"`: the texts `<name> says <u>-<l>` for each claim, the two spinbuttons, `button "Resolve"`, `button "Cancel"` | Organizers only. |
| Card dialog | `dialog "Match details"`: the card's label, entrants, status and score as text, `button "Close"`, and for organizers on a confirmed or resolved card, `button "Edit result"` | Everyone else, read-only. |
| Edit | `dialog "Edit result"`: the two spinbuttons, `button "Review edit"`, `status "Reset count"`, `list "Matches that will reset"`, `button "Confirm edit"` (shown after a review), `button "Cancel"` | |
| Every dialog | `status "Dialog status"` | Pending text and errors inside the dialog. |
| Disputes | `list "Open disputes"`, items with `button "Resolve <card label>"` | |
| Me | `region "Next match"` | Holds a match card, or a sentence. |
| Share | `heading` (level 1) with the tournament name, `list "Field"`, `img "<tournament name> trophy"`, `img "<tournament name> logo"` (once stored) | |
| History | `heading` (level 1) with the username, `list "Tournament history"` | Row format below. |

**Card label.** `Round <r>, match <m>` for single elimination, round robin and Swiss. `Winners round <r>, match <m>` and `Losers round <r>, match <m>` for double elimination. `Grand final` and `Grand final reset`.

**Card grammar.** In every form, `<upper>` is the entrant in the upper slot, and scores are always written upper side first as `<u>-<l>`. A slot nobody has reached yet reads `to be decided`.

| Card state | Accessible name |
|---|---|
| Both entrants known, pending | `<label>: <upper> vs <lower>, not played` |
| Called | `<label>: <upper> vs <lower>, called` |
| A slot not yet decided | `<label>: <upper> vs to be decided`, `<label>: to be decided vs <lower>` or `<label>: to be decided vs to be decided` |
| Bye | `<label>: <name> vs bye` (the real entrant is always named first) |
| Losers match fed by two byes, or grand final reset not needed | `<label>: not needed` |
| Grand final reset before grand final 1 has a result | `Grand final reset: waiting for grand final` |
| Reported | `<label>: <upper> vs <lower>, <u>-<l> reported by <reporter>, awaiting <opponent>` |
| Disputed | `<label>: <upper> vs <lower>, disputed` |
| Confirmed or resolved | `<label>: <upper> vs <lower>, <u>-<l>, <winner> wins` |
| Draw (round robin or Swiss) | `<label>: <upper> vs <lower>, <u>-<l>, draw` |

For organizers, while a match is overdue, `, overdue` is appended to its pending or called name, for example `Round 2, match 1: Ana vs Ben, not played, overdue` or `Round 2, match 1: Ana vs Ben, called, overdue`. Other viewers never see it.

For example, with the seed data of W01: `Round 1, match 1: Ana vs bye`, `Winners round 2, match 3: Ana vs Ben, 2-1, Ana wins`, `Round 2, match 1: Ana vs Ben, 2-1 reported by Ana, awaiting Ben`, `Grand final reset: not needed`.

**Card hooks and visible status.** Every card carries `data-match-id`, `data-round`, `data-match`, `data-bracket` (`winners`, `losers`, `final` or `main`) and `data-state`, which is the match's API `state` value (listed in API). A card with a slot still to be decided is `pending` and shows `Pending`. Each card also shows a visible status word:

| State | Visible word |
|---|---|
| pending | `Pending` |
| called | `Called` |
| reported | `Awaiting confirmation` |
| confirmed | `Confirmed` |
| disputed | `Disputed` |
| resolved | `Resolved` |
| bye | `Bye` |
| not_needed | `Not needed` |
| waiting | `Waiting` |

Organizers also see `Overdue` on an overdue card. During Shutter trace, a dependent card carries `data-shutter` set to `open`, `half` or `closed`, and the path carries `data-trace-path`. The moving name in the advance motion carries `data-motion="advance"`.

**Phone round tabs.**

- Single elimination and round robin: one tab per round, named `Round <r>`, from `Round 1` up to the last round, all present from the start.
- Swiss: one tab per paired round, named `Round <r>`, from `Round 1` up to the latest paired round. The next round's tab appears when that round is paired. Desk and tablet likewise show only paired rounds in `region "Rounds"`.
- Double elimination: `Winners 1` up to the last winners round, then `Losers 1` up to the last losers round, then `Grand final` (holding grand final and grand final reset).

The selected tab on load is the one holding the current round (for double elimination, the overall current round), as defined in Business rules.

**Standings columns**, in this order:

- Round robin: `Place`, `Entrant`, `Played`, `Match points`, `Head-to-head`, `Game difference`, `Games won`, `Seed`, `Decided by`.
- Swiss: `Place`, `Entrant`, `Played`, `Match points`, `Buchholz cut 1`, `Buchholz`, `Sonneborn-Berger`, `Seed`, `Decided by`.

Values are formatted as follows:

- Game difference carries a sign (`+3`, `-2`, `0`).
- Buchholz figures and Sonneborn-Berger are whole numbers, or end in `.5`.
- `Decided by` holds a column name in full.

**History row**: `<tournament name> · <place> of <field size> · <finish date>`. The separator is a middle dot with one space on each side. `<place>` is an English ordinal (`1st`, `2nd`, `3rd`, `5th`, `11th`, `21st`). `<finish date>` is `YYYY-MM-DD` in the tournament's time zone. Rows are listed newest first.

### Interactions (DP-09, DP-10, DP-14, DP-15, DP-16, DP-18, DP-19, DP-26, DP-42, DP-44, DP-46)

- **Dialogs.** Every dialog is modal. Tab and Shift+Tab wrap inside it: Tab on the last control goes to the first, and Shift+Tab on the first goes to the last. Escape or `Cancel` closes it with nothing sent. Focus returns to the control that opened it. After a successful submit, confirm, dispute, save, resolve or edit, every dialog closes and focus returns to the same match card. The one exception is a resolve from `/t/<tournament id>/disputes`, which lands as DP-19 says. A refused write keeps the dialog open, with focus on its first spinbutton.
- **Bracket keyboard.**
  - Tab enters each bracket region once. Within a region, exactly one card is in the Tab order. That is the last focused card, or at first the first match of the region's current round.
  - A drop-in round is a losers round with an even number, 2 or more. Its lower slots take losers from the winners bracket, and it has as many matches as the losers round before it.
  - ArrowRight moves from round r, match m to the match its winner feeds within the same region:
    - Single elimination, the winners bracket, and a losers round whose next round is not a drop-in round: match ceil(m/2) of round r+1.
    - A losers round whose next round is a drop-in round: match m of round r+1.
    - Round robin and Swiss: match m of round r+1, clamped to that round's last match. Swiss counts only paired rounds.
    - The last round of a region has nowhere to go.
  - ArrowLeft moves from round r, match m to the match feeding its upper slot within the region:
    - A drop-in round: match m of round r-1.
    - Any other elimination round: match 2m-1 of round r-1.
    - Round robin and Swiss: match m of round r-1, clamped to that round's last match.
    - Round 1 has nowhere to go.
  - ArrowUp and ArrowDown move to the previous and next match in the same round, with no wrap.
  - Home moves to the first match of the region's first round. End moves to the first match of the region's last round (in Swiss, the latest paired round).
  - Grand final region: `Grand final` counts as round 1 and `Grand final reset` as round 2, one match each (their `data-round` and API `round`). ArrowRight moves from `Grand final` to `Grand final reset` and ArrowLeft moves back. Home goes to `Grand final` and End to `Grand final reset`. ArrowUp and ArrowDown do nothing.
  - Keys that have nowhere to go do nothing.
  - Enter or Space opens the card's dialog. Which dialog depends on the viewer and the card's state:
    - entrants on pending or called cards, and organizers on pending, called or reported cards: `Report score`
    - the opponent of the reporter: `Confirm score`
    - organizers on disputed cards: `Resolve dispute`
    - everyone else: `Match details`
  - Clicking or tapping a card does the same.
- **Shortcut.** Z toggles the whole bracket view whichever control on the bracket or share page has focus, except while typing in a text field or spinbutton or while a dialog is open. It does the same as `button "Whole bracket"`.
- **Panning.**
  - Desk and tablet: the bracket area pans by dragging with a pointer, a horizontal wheel or trackpad movement, or touch drag. Focus moving to a card off the screen scrolls it into view.
  - Phone: a horizontal swipe on the round panel of at least 50 pixels, more horizontal than vertical, moves to the next round (finger moving left) or the previous round (finger moving right). The swipe stops at the ends and updates the selected tab. Vertical scrolling inside a round works as normal. ArrowLeft and ArrowRight on the tablist move between tabs.
- **Seeding.**
  - Each `listitem` in `list "Seeding"` is focusable. Alt+ArrowUp moves the focused entrant up one seed, and Alt+ArrowDown moves it down one, with no wrap. Typing a number in `spinbutton "Seed for <name>"` and pressing Enter or leaving the field moves that entrant to that seed and shifts the others by one. Dragging a list item by pointer or touch drops it at the new seed.
  - Each move is saved at once, renumbers every item, keeps focus on the moved entrant (its list item, or the spinbutton after typing), announces in `status "Your action"`, and updates `list "Round 1 preview"` in place.
- **Opening check-in.** `textbox "Check-in closes"` opens empty. It takes a date and time in the tournament's time zone on the 24-hour clock, as `YYYY-MM-DD HH:MM` or `YYYY-MM-DD HH:MM:SS` (for example `2026-11-04 19:30` or `2026-11-04 19:30:45`). Seconds are optional and count as `00` when left out. `button "Start check-in"` sends the time converted to UTC as `closes_at`. Leaving the box empty sends no `closes_at`, so the server closes check-in `CUPFOLD_CHECKIN_DEFAULT_MS` after opening, on server time. Text in any other form shows the check-in close format error from Feedback states under the field and sends nothing.
- **Check-in.** A player activates `button "Check in"`. When the server accepts, they land on `/t/<tournament id>/me`. Organizers tick or untick `checkbox "Checked in: <name>"` to mark an entrant present or absent while check-in is open.
- **Edit flow.**
  1. On a confirmed or resolved card, an organizer opens `dialog "Match details"` and activates `button "Edit result"`, which opens `dialog "Edit result"` on top. The spinbuttons are pre-filled with the current score.
  2. `button "Review edit"` asks the server for the preview and runs Shutter trace (see Motion). `button "Confirm edit"` then appears. Changing a spinbutton afterwards hides `Confirm edit` and reverses the trace until the edit is reviewed again.
  3. Escape or `Cancel` reverses the trace and closes `Edit result`, with focus back on `button "Edit result"`. A second Escape closes `Match details` and returns focus to the card.
  4. `Confirm edit` commits. Both dialogs close and focus returns to the edited card.
- **Share.**
  - `button "Copy link"` copies the link and posts `Link copied` in `status "Page notice"`.
  - `button "Replace link"` replaces the link at once. The textbox shows the new link.
  - Spectators tapping a card get `dialog "Match details"`.
- **Toasts.** Notices in `status "Page notice"` disappear after the toast lifetime. Errors in `alert` stay until the next action.

### Visual design (DP-58, DP-59)

Direction: hero object. There is one procedural object on screen at a time, scaled until a viewport edge crops it, on a flat field.

- **Palette.**
  - The ground is a warm cream. Surfaces (form cards, dialogs) are plain white.
  - Ink is a near-black warm brown. Muted text is a warm grey-brown.
  - The single accent is a saturated tangerine, used only for buttons and the Shutter trace path. Text on tangerine is the same dark ink.
  - Match states carry club-colour fills: soft lilac for Pending and Called, pale lemon for Awaiting confirmation, fresh mint for Confirmed and Resolved. Disputed is a charcoal outline with a small flag icon and no fill. Bye, Not needed and Waiting cards are plain white with muted text.
  - Every state also shows its status word, so colour is never the only signal.
- **Type.** Geist for everything, display and body, in bundled font files. Each heading step is about a third larger than the one below. Scores and names on cards are very large and set tight. Facts and labels are small and exact, a little above body size. There are no middle sizes. Every score, count, standing and time uses tabular (fixed-width) figures. Density is comfortable.
- **Landing hero.**
  - The wordmark "Cupfold" is very large and semi-bold, top-left on wide margins. Top-right is the description.
  - The centre tile is tall and rounded. It holds one procedural drawing per format: a tall single-handled cup for Single elimination, a two-handled loving cup for Double elimination, a ring medal for Round robin, and a stacked trio of counters for Swiss. The object is drawn larger than the tile and breaks out of its top edge.
  - The tile fill follows the format: lilac, lemon, mint, lilac.
  - The format names to the left step down in size and fade further with each step away from the chosen one.
  - Under the tile is the format's one fact and one tangerine rectangle reading "Start a tournament".
- **Working screens keep the one-object rule.** The live bracket is the object, set at hero scale and cropped (see Screens and layout).
  - Match cards are flat fills with generous rounded corners and no shadow.
  - Buttons are square-cornered solid tangerine rectangles with ink text. They are the only tangerine on screen apart from the trace path.
  - Seeding, roster and standings are plain left-aligned lists of large text with no ruling lines.
  - Forms have one field per row at comfortable reading size on white cards. Field errors are written under the field in ink, never red.
  - Error and outage states are a full-width lemon band with the published copy and no icons.
  - Empty states show the format's object small in a corner with one sentence.
- **Accessibility.** Every control and card is at least 44 by 44 pixels. All text meets WCAG 2.2 AA contrast against its fill. Focus is shown by a thick ink outline that is visible on every fill.

### Motion and effects (DP-28, DP-29, DP-48, DP-49)

All motion starts quickly and settles softly. Every animation runs on page timers and animation frames, so a paused page clock holds it and advancing the clock completes it.

- **Format swap (landing).** Choosing a format closes horizontal shutter slats over the tile and reopens them on the new object and fill, in about a third of a second.
- **Advance.** When a match becomes confirmed or resolved, a copy of the winner's name (`data-motion="advance"`) travels from its card to its slot in the next card in 320 milliseconds. The card's fill changes colour in about a quarter of a second. Losers dropping to the losers bracket travel the same way.
- **Shutter trace** (the signature), after `Review edit`:
  1. A thick tangerine path draws from the edited card along the bracket's connector lines to each dependent card in reset order. Each connector segment takes 320 milliseconds. Cards are reached one after another at least 90 milliseconds apart.
  2. As the path reaches a card, horizontal slats close over its score area to half height in 240 milliseconds (`data-shutter="half"`). The item for that card appears in `list "Matches that will reset"`, and `status "Reset count"` counts up by one, ending on the reset sentence. When the next dependent is off screen, the bracket area pans to bring it into view.
  3. On `Confirm edit`, the slats close fully (`closed`). The cards then change to lilac Pending with the cleared entrants reading "to be decided".
  4. On Escape or Cancel, the slats reopen card by card in reverse order, 90 milliseconds apart, and the path retracts back to the edited card.
  - The longest trace (128-entrant double elimination) has dependency depth 13.
  - Other screens receive the reset in the same order and play the slat close on their own cards.
- **Hover and press.** Buttons darken slightly on hover. Cards lift their status word on hover. Both take under a tenth of a second.
- **No decoration.** There are no looping or decorative animations anywhere.
- **Reduced motion.** When `prefers-reduced-motion: reduce` is set, none of the motion above runs:
  - Cards, slats, the path and the moving name have zero-length animation and transition, and no `data-motion="advance"` element is created.
  - Results appear in their end state at once.
  - Shutter trace becomes this: every dependent card gets a thick charcoal outline and the visible label `Will reset` at once. `list "Matches that will reset"` is complete at once. `status "Reset count"` shows the final sentence without counting.
  - Confirm, cancel, announcements and focus behave exactly as without reduced motion.

### Feedback states (DP-03, DP-16, DP-18, DP-19, DP-22, DP-24, DP-27, DP-39, DP-40, DP-41, DP-50, DP-51, DP-55)

This section owns every exact copy string. Placeholders are defined here:

- `<name>`: an entrant's display name.
- `<username>`: an account username.
- `<n>`, `<m>`, `<c>`: whole numbers.
- `<u>-<l>`: games, upper side first.
- `<score>`: either `<u>-<l>` or `not played`.
- `<HH:MM>`: 24-hour time in the tournament's zone.
- `<zone>`: the IANA zone name.
- `<limit>`: the configured byte limit in plain digits.

Apostrophes are straight and `...` is three full stops.

**Pending.** While any write is in flight, its button is disabled and `status "Dialog status"` (or `status "Page notice"` outside dialogs) reads `Saving...`.

**`status "Your action"` (the actor's outcome):**

- `Score reported, awaiting <name>` (`<name>` is the opponent)
- `Score confirmed`
- `Score disputed`
- `Dispute resolved`
- `Result saved`
- `Result edited`
- `Match called`
- `<name> moved to seed <n>`

**`status "Bracket announcements"` (the same text on every screen).** When one change produces several sentences, they are joined by a full stop and a space, with no final full stop.

- `<name> advances to round <n>` (single elimination)
- `<name> advances to winners round <n>`
- `<name> drops to losers round <n>`
- `<name> advances to losers round <n>`
- `<name> advances to the grand final`
- `Grand final reset needed`
- `<name> wins the tournament`
- `<n> matches reset`, or `1 match reset`
- `<name> checked in`
- `Check-in is closed.`
- `The tournament has started`
- `Round <n> is paired`

Single elimination losers get no sentence. Round robin and Swiss results announce nothing until `<name> wins the tournament`. For example, with the seed data of W06, a winners round 1 result reads `Ana advances to winners round 2. Hal drops to losers round 1`.

**Reset count (`status "Reset count"`):**

- `<n> matches will reset, <c> of them confirmed` (for n of 2 or more)
- `1 match will reset, it is confirmed`
- `1 match will reset, it is not confirmed`
- `No later matches will reset.`

**`status "Page notice"`:**

- `Removed <n> no-shows: <names>.` or `Removed 1 no-show: <name>.` (names in seed order, joined by `, `)
- `Added <n> entrants from <file name>.`
- `Logo updated.`
- `Link copied`
- `Link replaced. The old link no longer works.`

**Check-in.**

- `status "Check-in count"` reads `<n> of <m> checked in`.
- The rail or top bar shows `Check-in closes at <HH:MM> (<zone>)` while open and `Check-in closed at <HH:MM> (<zone>)` after.
- `region "Next match"` before start reads `You're checked in. Your first match appears here when the tournament starts.`
- After the player's last match it reads `No more matches for you in this tournament.`

**Countdown.** A reported card and `dialog "Confirm score"` show `Auto-confirms in <m>:<ss>`. At zero they show `Confirming...` until the server's confirmation arrives.

**Empty states.**

- Setup with no entrants: `No entrants yet. Upload a roster or add names one by one.`
- Disputes: `No open disputes.`
- History: `No finished tournaments yet.`
- Your tournaments: `No tournaments yet.`

**Field errors** are written under the field. They are also the 422 `fields` values, keyed by the JSON key shown. The browser shows each message under the field whose key it carries.

| Field | `fields` key | Endpoints | Message |
|---|---|---|---|
| Username | `username` | `POST /api/auth/signup` | `Use 3 to 24 characters: a-z, 0-9 or _.` |
| Password | `password` | `POST /api/auth/signup` | `Use at least 8 characters.` |
| Tournament name | `name` | `POST /api/tournaments`, `PATCH /api/tournaments/<id>` | `Enter a name of 1 to 60 characters.` |
| Format | `format` | `POST /api/tournaments` | `Choose a format.` |
| Trophy fill | `fill` | `POST /api/tournaments`, `PATCH /api/tournaments/<id>` | `Choose a trophy fill.` |
| Time zone | `time_zone` | `POST /api/tournaments`, `PATCH /api/tournaments/<id>` | `Choose a time zone from the list.` |
| Entrant name | `name` | `POST /api/tournaments/<id>/entrants` | `Enter a name of 1 to 40 characters.` |
| Duplicate entrant | `name` | `POST /api/tournaments/<id>/entrants` | `That name is already in the field.` |
| Games, each side | `upper_games`, `lower_games` | report, dispute, result, resolve, edit-preview, edit | `Enter a whole number from 0 to 99.` |
| Seed | none: checked in the browser only, no request is sent | `spinbutton "Seed for <name>"` | `Enter a seed from 1 to <n>.` (`<n>` is the field size) |
| Account link or co-organizer | `username` | `POST /api/tournaments/<id>/entrants`, `PATCH /api/entrants/<id>`, `POST /api/tournaments/<id>/co-organizers` | `No account named @<username>.` |
| Repeat co-organizer | `username` | `POST /api/tournaments/<id>/co-organizers` | `@<username> is already a co-organizer.` |
| Organizer as co-organizer | `username` | `POST /api/tournaments/<id>/co-organizers` | `You already organize this tournament.` |
| Check-in close | `closes_at` | `POST /api/tournaments/<id>/checkin/open` | `Choose a time after now.` |
| Check-in close format | `closes_at` | the browser, before sending; the server for a `closes_at` that is not an ISO 8601 time | `Enter the time as YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS.` |

**Error messages.** These are the `message` of each error, shown in the open dialog's `status "Dialog status"`, or in the `alert` band outside dialogs.

| Code | Message(s) |
|---|---|
| `too_large` | `The request body is larger than <limit> bytes.` or, for files, `This file is larger than <limit> bytes.` |
| `unauthenticated` | `Sign in to continue.` |
| `bad_credentials` | `Username or password is wrong.` |
| `username_taken` | `That username is taken.` |
| `rate_limited` | `Too many sign-in attempts. Wait a minute and try again.` or `Too many score reports. Wait a minute and try again.` |
| `not_found` | `We couldn't find that tournament.` (tournaments, matches, entrants) or `This link no longer works.` (unknown or replaced share links) or `This tournament is not public yet.` (share links of a draft tournament) or `No roster file has been added.` |
| `read_only` | `Share links are read-only.` |
| `forbidden` | `You cannot change this tournament.`, `Only the two players in this match or an organizer can report it.`, `You cannot confirm your own report.`, `Only organizers can resolve disputes.`, `Only the organizer can do this.`, `Cross-site requests are refused.` |
| `stale_match` | `This match was updated by <username>. Current score: <score>.` |
| `already_resolved` | `This dispute was already resolved by <username>. Result: <u>-<l>.` |
| `stale_preview` | `The bracket changed since this preview. Review the edit again.` |
| `stale_seeding` | `The seeding was changed by <username>. The list now shows their order.` |
| `checkin_closed` | `Check-in is closed.` |
| `wrong_state` | `This match already has a result.`, `This match is disputed. An organizer will resolve it.`, `You already reported this match.`, `There is no report to answer.`, `There is no open dispute.`, `This match is not ready to play.`, `Only confirmed or resolved results can be edited.`, `The tournament is not running.`, `This tournament is finished. Its results can no longer change.`, `The tournament has already started.`, `Check-in is not open.`, `Close check-in before starting.`, `At least 2 entrants are needed to start.`, `At least 2 checked-in entrants are needed to start.`, `Finish every match in round <n> first.`, `No pairing without a rematch exists.`, `Check-in is already open.`, `Check-in has already closed. Go back to draft to open it again.`, `The tournament is already a draft.`, `Only Swiss tournaments have a next round.`, `Standings exist only for round robin and Swiss.` |
| `validation` | `Check the highlighted fields.` (with `fields`), `Elimination matches need a winner.`, `A score needs at least one game.`, `Change the score to dispute it.`, `Logos must be PNG or JPEG images.` |
| `roster_invalid` | `The roster was not added. Fix these lines and upload again.` |
| `storage_unavailable` | `File storage is unavailable. Nothing was added. Try again in a moment.` |

**Roster errors.** `list "Roster errors"` is headed by the `roster_invalid` message, and focus moves to that heading. Each item is one line message:

- `The roster file is not UTF-8 text.`
- `The roster file is empty.`
- `Roster files end in .cupfold.txt.`
- `The roster has <n> entrants. A roster needs 2 to 128.`
- `Line <n>: seed must be a whole number from 1 to 128`
- `Line <n>: seed <s> is larger than the number of entrants (<m>)`
- `Line <n>: seed <s> is already used on line <m>`
- `Line <n>: name is empty`
- `Line <n>: name is longer than 40 characters`
- `Line <n>: duplicate name "<first spelling>" (first on line <m>)`
- `Line <n>: no account named @<username>`
- `Line <n>: @<username> is already on line <m>`

**Outage.** During a storage outage, the upload dialog shows the `storage_unavailable` message in `status "Dialog status"` and in the lemon band. Focus stays in the dialog.

**Live connection.** While the live connection is down, the lemon band reads `Live updates paused. Reconnecting...`. It disappears once caught up.

**Not-found pages.**

- A page route that does not exist reads `We couldn't find that page.`
- A dead share link reads `This link no longer works.`
- A share link for a draft tournament reads `This tournament is not public yet.`

## Backend

### API (DP-02, DP-03, DP-04, DP-05, DP-06, DP-08, DP-10, DP-16, DP-17, DP-18, DP-19, DP-22, DP-25, DP-26, DP-27, DP-36, DP-39, DP-45, DP-46, DP-47, DP-52, DP-53, DP-54)

**Conventions.**

- Bodies and responses are `application/json; charset=utf-8`, except file uploads (`multipart/form-data`, one part named `file`) and file downloads.
- Ids are opaque strings. Times are ISO 8601 UTC with milliseconds.
- Writes need the session cookie, except sign-up, sign-in and the grading routes.

**Errors.** Every error body is `{"error":"<code>","message":"<sentence>"}`. The published codes and messages are in Feedback states. Some codes add exactly one extra key:

- `validation` adds `fields` (field name to message).
- `stale_match` and `already_resolved` add `match` (the current match).
- `stale_seeding` adds `entrants` (the current order).
- `roster_invalid` adds `errors` (the line messages, in order).

**Error precedence**, the one order for the whole API:

1. 405 `read_only`: any method other than GET under `/api/share/`.
2. 413 `too_large`.
3. 401 `unauthenticated`.
4. 429 `rate_limited`.
5. 404 `not_found`: an unknown record, or a record the caller may not see. A draft tournament is visible only to its organizers, and everyone else gets 404, never 403.
6. 403 `forbidden`: a visible record the caller may not change.
7. 409 conflicts: `stale_match`, `already_resolved`, `stale_preview`, `stale_seeding`, `checkin_closed`, `wrong_state`, `username_taken`.
8. 422 `validation`, `roster_invalid`.
9. 503 `storage_unavailable`.

Sign-in failure is 401 `bad_credentials`. Endpoint rows below list only their own errors.

**Match object** (`"match"`). Fields:

| Field | Meaning |
|---|---|
| `label` | The card label. |
| `bracket` | `winners`, `losers`, `final` or `main`. |
| `upper`, `lower` | `{"entrant_id":"<id>","name":"<name>"}`, `{"bye":true}`, or `null` for to be decided. |
| `state` | `pending`, `called`, `reported`, `confirmed`, `disputed`, `resolved`, `bye`, `not_needed` (a losers match fed by two byes, or a grand final reset after the upper side wins grand final 1) or `waiting` (a grand final reset before grand final 1 has a result). A match with a slot still to be decided is `pending`. |
| `winner` | `upper`, `lower`, `draw` or `null`. |
| `report` | The first report, `{"by":"<reporter's entrant name>","upper_games","lower_games","reported_at","auto_confirm_at"}`, or `null`. `auto_confirm_at` is the server time the report auto-confirms, and it matters only while the state is `reported`. |
| `dispute` | The opponent's answer when they disputed, `{"by":"<disputer's entrant name>","upper_games","lower_games","disputed_at"}`, or `null`. `report` and `dispute` stay after a confirm or resolve and are cleared only by a reset. |
| `version` | Increases by one on every change. |
| `overdue`, `updated_by` | Organizers only. Other viewers never receive these keys. |

An example in full:

```json
{"id":"<id>","tournament_id":"<id>","label":"Winners round 2, match 1","bracket":"winners","round":2,"number":1,
 "upper":{"entrant_id":"<id>","name":"Ana"},"lower":{"entrant_id":"<id>","name":"Dov"},
 "state":"reported","upper_games":null,"lower_games":null,"winner":null,
 "report":{"by":"Ana","upper_games":2,"lower_games":1,"reported_at":"<time>","auto_confirm_at":"<time>"},
 "dispute":null,"called_at":null,"overdue":false,"version":3,"updated_by":"ana"}
```

**Tournament object** (`"tournament"`). Fields:

| Field | Meaning |
|---|---|
| `format` | `single_elimination`, `double_elimination`, `round_robin` or `swiss`. |
| `state` | `draft`, `checkin_open`, `checkin_closed`, `running` or `finished`. |
| `fill` | `lilac`, `lemon` or `mint`. |
| `checkin_closes_at` | The check-in close time. |
| `server_time` | The server time when the response was made. |
| `field_size` | Entrants at start. |
| `entrant_count` | Current entrants. |
| `checked_in_count` | Entrants checked in. |
| `current_round` | `{"bracket":"<winners, losers, final or main>","round":<n>}`: the overall current round, as defined in Business rules. |
| `swiss_rounds` | Swiss only. |
| `logo_url` | `null` until a logo is stored. |
| `seeding_version` | Increases with each saved reorder. |
| `my_role` | `organizer`, `co_organizer`, `player` or `viewer`. |
| `share_url` | Organizers only. |
| `co_organizers` | Organizers only. |

**Endpoints.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/health` | none | 200, see Server boundary | none |
| `GET /api/config` | none | 200 `{"server_time","confirm_window_ms","match_limit_ms","swiss_round_ms","toast_ms","roster_max_bytes","logo_max_bytes"}` | none |
| `POST /api/auth/signup` | `{"username","password"}` | 201 `{"user":{"username"}}` + session cookie | 409 `username_taken`, 422 |
| `POST /api/auth/signin` | `{"username","password"}` | 200 `{"user":{"username"}}` + session cookie | 401 `bad_credentials`, 429 |
| `POST /api/auth/signout` | none | 204, cookie cleared | none |
| `GET /api/me` | none | 200 `{"user":{"username"}}` | 401 |
| `GET /api/tournaments` | none | 200 `{"tournaments":[tournament]}` (the caller's) | none |
| `POST /api/tournaments` | `{"name","format","time_zone","fill"}` | 201 `{"tournament"}` | 422 |
| `GET /api/tournaments/<id>` | none | 200 `{"tournament"}` | none |
| `PATCH /api/tournaments/<id>` | any of `{"name","time_zone","fill"}` | 200 `{"tournament"}` | 422 |
| `DELETE /api/tournaments/<id>` | none | 204 | 403 for co-organizers, 409 |
| `POST /api/tournaments/<id>/co-organizers` | `{"username"}` | 201 `{"co_organizers":[username]}` | 403, 422 |
| `DELETE /api/tournaments/<id>/co-organizers/<username>` | none | 204 | 403 |
| `GET /api/tournaments/<id>/entrants` | none | 200 `{"entrants":[{"id","name","seed","username","checked_in"}]}` in seed order (`username` for organizers only) | none |
| `POST /api/tournaments/<id>/entrants` | `{"name","username"?}` | 201 `{"entrant"}`, seeded last | 409 started, 422 |
| `PATCH /api/entrants/<id>` | `{"username"}` (or `null` to unlink) | 200 `{"entrant"}` | 409 started, 422 |
| `DELETE /api/entrants/<id>` | none | 204, seeds renumbered | 409 started |
| `PUT /api/tournaments/<id>/seeding` | `{"order":[entrant id, ...],"seeding_version"}` (every entrant once) | 200 `{"entrants","seeding_version"}` | 409 `stale_seeding`, 409 started, 422 |
| `GET /api/tournaments/<id>/preview` | none | 200 `{"matches":[{"number","upper","lower"}]}` (round 1, or winners round 1, for the current seeding) | none |
| `POST /api/tournaments/<id>/roster` | multipart `file` | 201 `{"entrants","sha256","file_name"}` | 409 started, 422 `validation` (name or empty), 422 `roster_invalid`, 503 |
| `GET /api/tournaments/<id>/roster` | none | 200, the stored bytes, `Content-Type: text/plain; charset=utf-8`, `Content-Disposition: attachment; filename="<file name as uploaded>"` | 404 none yet, 503 |
| `POST /api/tournaments/<id>/logo` | multipart `file` | 201 `{"logo_url","sha256"}` | 422, 503 |
| `GET /api/tournaments/<id>/logo` | none | 200, the image bytes with their content type | 404, 503 |
| `POST /api/tournaments/<id>/checkin/open` | `{"closes_at"}` (optional; default now plus the check-in default) | 200 `{"tournament"}` | 409, 422 |
| `POST /api/tournaments/<id>/checkin/close` | none | 200 `{"tournament"}` | 409 |
| `POST /api/tournaments/<id>/draft` | none | 200 `{"tournament"}`, check-ins cleared | 409 |
| `POST /api/tournaments/<id>/checkin` | none (the linked player) | 200 `{"entrant","checked_in_count"}`, repeat is 200 | 403 not linked, 409 `checkin_closed`, 409 not open |
| `PUT /api/entrants/<id>/checkin` | `{"checked_in": true or false}` (organizers) | 200 `{"entrant","checked_in_count"}` | 409 |
| `POST /api/tournaments/<id>/start` | none | 200 `{"tournament","removed":[name]}` | 409 |
| `POST /api/tournaments/<id>/rounds` | none (Swiss next round) | 201 `{"round","matches"}` | 409 |
| `GET /api/tournaments/<id>/matches` | none | 200 `{"matches"}` ordered winners, losers, final, main, then round, then match number | none |
| `POST /api/matches/<id>/call` | `{"version"}` | 200 `{"match"}` | 403, 409 |
| `POST /api/matches/<id>/report` | `{"upper_games","lower_games","version"}` | 200 `{"match","outcome":"reported"\|"confirmed"\|"disputed"}` | 403, 409, 422 |
| `POST /api/matches/<id>/confirm` | `{"version"}` | 200 `{"match"}` | 403, 409 |
| `POST /api/matches/<id>/dispute` | `{"upper_games","lower_games","version"}` | 200 `{"match"}` | 403, 409, 422 |
| `POST /api/matches/<id>/result` | `{"upper_games","lower_games","version"}` (organizer save) | 200 `{"match"}` | 403, 409, 422 |
| `POST /api/matches/<id>/resolve` | `{"upper_games","lower_games","version"}` | 200 `{"match"}` | 403, 409 `already_resolved`, 409, 422 |
| `POST /api/matches/<id>/edit-preview` | `{"upper_games","lower_games","version"}` | 200 `{"dependents":[{"match_id","label","state"}],"count","confirmed_count","preview_token"}` | 403, 409, 422 |
| `POST /api/matches/<id>/edit` | `{"upper_games","lower_games","preview_token"}` | 200 `{"match","reset":[match id, ...]}` | 403, 409 `stale_preview`, 409, 422 |
| `GET /api/tournaments/<id>/standings` | none | 200 `{"columns":[column names],"rows":[...]}` | 409 elimination format |
| `GET /api/tournaments/<id>/me` | none | 200 `{"entrant","checked_in","next_match"}` | 404 not linked |
| `GET /api/tournaments/<id>/disputes` | none | 200 `{"matches"}` | 403 |
| `POST /api/tournaments/<id>/share/rotate` | none | 200 `{"share_url"}` | 403 |
| `GET /api/share/<share code>` | none | 200 `{"tournament","entrants":[{"name","seed"}],"matches","standings"}` (public shape) | 404 for an unknown or replaced code, or for a draft tournament |
| `GET /api/share/<share code>/logo` | none | 200 image | 404, 503 |
| `GET /api/users/<username>/history` | none | 200 `{"rows":[{"tournament_id","tournament_name","place","field_size","finished_on","text"}]}` | 404 |
| `GET /api/tournaments/<id>/live` | WebSocket upgrade; session cookie, or `?share=<share code>`; optional `&after=<seq>` | see below | 404 before upgrade |

Standings row keys:

- Round robin: `place`, `entrant_id`, `name`, `played`, `match_points`, `head_to_head`, `game_difference`, `games_won`, `seed`, `decided_by`.
- Swiss: `buchholz_cut_1`, `buchholz` and `sonneborn_berger` replace the head-to-head and game keys.
- `text` in history rows is the published history row.

**Public shape.** Share responses and share-socket messages carry display names, seeds, scores, states and labels only. They never contain usernames, account ids, `overdue`, `updated_by`, `share_url` or co-organizers.

**Live channel.**

- Every message is `{"seq":<n>,"type":"<type>","at":"<server time>","data":{...}}`. `seq` starts at 1 per tournament and rises by exactly 1 per message.
- Types:
  - `match.updated` (`{"match"}`)
  - `matches.reset` (`{"matches":[match, ...]}` in reset order)
  - `standings.updated` (`{"rows"}`)
  - `checkin.updated` (`{"checked_in_count","entrant":{"name","checked_in"}}`)
  - `entrants.updated` (`{"entrants"}`)
  - `tournament.updated` (`{"tournament"}`)
  - `announcement` (`{"text"}`, the Bracket announcements text)
- Each socket receives every message, shaped for its viewer. Spectators get the public shape. Organizer-only changes (overdue flags) go to organizers only, but still use the shared `seq`.
- Connecting with `after=<seq>` first replays every message with a higher `seq` in order, then continues live.
- When a share link is replaced, sockets on the old code are closed with close code 4404 and reason `link_replaced`.

**Grading routes.** These exist only when `CUPFOLD_GRADING=1`. Otherwise they answer 404 `not_found`. They need no session.

- `POST /api/grading/seed`:

```json
{"users":[{"username":"dana","password":"dana-pass-1"}],
 "tournaments":[{"key":"cup","name":"Back Room Cup","format":"single_elimination","organizer":"dana",
   "co_organizers":["eve"],"time_zone":"Europe/Lisbon","fill":"lemon","state":"running",
   "checkin_closes_at":"<time>",
   "entrants":[{"name":"Ana","seed":1,"username":"ana","checked_in":true}],
   "steps":[
     {"match":"Round 1, match 2","action":"confirmed","upper_games":2,"lower_games":1},
     {"match":"Round 2, match 1","action":"reported","upper_games":2,"lower_games":0,"by":"Ana"},
     {"match":"Round 2, match 2","action":"disputed","upper_games":2,"lower_games":0,"by":"Ben","counter":{"upper_games":0,"lower_games":2}},
     {"match":"Round 2, match 3","action":"called"},
     {"action":"next_round"}]}]}
```

  - Users are created first, under the account rules.
  - For `running` and `finished`, the bracket is generated from the listed entrants (all of them form the field, at their listed seeds). Then `steps` apply in order through the same rules as live play, at the current server time.
  - In every step, `match` is the card label and `by` is always an entrant's display name, never a username. Scores are upper side first. Each action takes exactly these fields:
    - `called`: no other fields. The organizer calls the match.
    - `reported`: `upper_games`, `lower_games`, `by`. Entrant `by`, one of the match's two entrants, reports that score, and the match becomes reported.
    - `disputed`: `upper_games`, `lower_games`, `by`, `counter` (`{"upper_games","lower_games"}`). Entrant `by` reports `upper_games`-`lower_games`. Then the other entrant disputes with `counter`, which must differ. The match's `report` holds `by`'s claim and its `dispute` holds the opponent's.
    - `confirmed`: `upper_games`, `lower_games`, optional `by`. With `by`, that entrant reports and the opponent confirms. Without it, the organizer saves the result.
    - `resolved`: `upper_games`, `lower_games`, optional `resolver` (the username of an organizer or co-organizer; default the tournament's `organizer`). The match must already be disputed by an earlier step. The resolver resolves it with that score.
    - `next_round`: no other fields, Swiss only. The organizer pairs the next round.
  - `updated_by` after a step is the linked username of the entrant who acted (the organizer's username when that entrant has no account), or the username of the acting organizer or co-organizer.
  - The whole request applies in one transaction. A step the live rules would refuse makes it answer 422 `validation` with that rule's message as the message, and nothing is created.
  - `checkin_open` and `checkin_closed` keep each entrant's `checked_in`.
  - `finished` needs steps that finish the tournament.
  - Response: 201 `{"users":{"<username>":{"id"}},"tournaments":{"<key>":{"id","share_code","entrants":{"<name>":"<id>"},"matches":{"<card label>":"<id>"}}}}`.
  - Errors: 409 `username_taken`, and 422 `validation` with the reason as the message (for example `Seed steps do not finish the tournament.`).
- `POST /api/grading/session` `{"username"}` signs that user in for the calling browser context. 200 `{"user":{"username"}}` + session cookie. 404 for an unknown user.
- `POST /api/grading/clock` `{"advance_ms":<whole number 0 to 604800000>}` moves server time forward. 200 `{"server_time"}`. Deadlines passed by the move are applied at once, in time order, and broadcast before the response returns. Out of range: 422.

### Business rules (DP-03, DP-05, DP-07, DP-08, DP-10, DP-11, DP-17, DP-18, DP-19, DP-20, DP-21, DP-22, DP-23, DP-24, DP-25, DP-26, DP-27, DP-31, DP-32, DP-33, DP-34, DP-36, DP-37, DP-38, DP-39, DP-40, DP-41, DP-47, DP-51, DP-52, DP-56, DP-57)

**Accounts.**

- Usernames are lowercased, then must be 3 to 24 characters of `a-z`, `0-9` and `_`. Passwords are at least 8 characters.
- The session cookie is `cupfold_session` with `HttpOnly; SameSite=Lax; Path=/`.
- Each username allows 10 sign-in attempts per rolling 60 seconds of server time (`CUPFOLD_LOGIN_RATE`). The next attempt answers 429.
- Each user allows 20 match writes (call, report, confirm, dispute, result, resolve, edit) per rolling 60 seconds of server time (`CUPFOLD_REPORT_RATE`). The next write answers 429. The limit itself is allowed.

**Roles.**

- The organizer is the creator. Co-organizers are added by username and hold every organizer power except `DELETE` of the tournament and co-organizer changes. Those answer 403 `Only the organizer can do this.`
- A player is an account linked to an entrant, through `@username` in the roster or by an organizer. One account links to at most one entrant per tournament.
- Any signed-in account may view a non-draft tournament. Writes by accounts without a role answer 403 `You cannot change this tournament.`
- Spectators view through the share link only.

**Tournament states.**

- draft → checkin_open (`checkin/open`, close time after now) → checkin_closed (at the close time on server time, or `checkin/close`) → running (`start`) → finished (automatic).
- `draft` from checkin_open or checkin_closed clears every check-in.
- `start` from draft removes nobody. From checkin_closed it removes no-shows as described under Check-in.
- Each action is legal only in the cells marked legal below. Every other cell is refused with 409 `wrong_state` (or the code shown) and exactly that message. When a row gives a format refusal, it is checked before the state.

| Action | draft | checkin_open | checkin_closed | running | finished |
|---|---|---|---|---|---|
| Open check-in (`checkin/open`) | legal | `Check-in is already open.` | `Check-in has already closed. Go back to draft to open it again.` | `The tournament has already started.` | `The tournament has already started.` |
| Close check-in (`checkin/close`) | `Check-in is not open.` | legal | `Check-in is not open.` | `The tournament has already started.` | `The tournament has already started.` |
| Back to draft (`draft`) | `The tournament is already a draft.` | legal | legal | `The tournament has already started.` | `The tournament has already started.` |
| Start (`start`) | legal; with fewer than 2 entrants, `At least 2 entrants are needed to start.` | `Close check-in before starting.` | legal; with fewer than 2 checked in, `At least 2 checked-in entrants are needed to start.` | `The tournament has already started.` | `The tournament has already started.` |
| Check in (player or organizer) | `Check-in is not open.` | legal until the close time | 409 `checkin_closed` | 409 `checkin_closed` | 409 `checkin_closed` |
| Entrants, account links, seeding, roster | legal | legal | legal | `The tournament has already started.` | `The tournament has already started.` |
| Logo | legal | legal | legal | legal | legal |
| Next Swiss round (`rounds`); other formats `Only Swiss tournaments have a next round.` | `The tournament is not running.` | `The tournament is not running.` | `The tournament is not running.` | legal | `This tournament is finished. Its results can no longer change.` |
| Match writes and edits | `The tournament is not running.` | `The tournament is not running.` | `The tournament is not running.` | legal | `This tournament is finished. Its results can no longer change.` |
| Standings (`GET .../standings`); elimination formats `Standings exist only for round robin and Swiss.` | legal | legal | legal | legal | legal |
| Delete tournament | legal | legal | legal | `The tournament has already started.` | `The tournament has already started.` |

- Before start, standings list every entrant with zeros in seed order.

**Check-in.**

- Only the linked player (or an organizer for any entrant) checks in, and only in checkin_open before the close time on server time.
- Outside that window, the answer follows the tournament state table above.
- The browser shows `button "Check in"` only while the server's tournament state is checkin_open. It never compares the device clock with the close time, because the device clock may be wrong.
- Each change broadcasts the count and `<name> checked in`. Closing broadcasts `Check-in is closed.`
- Starting from checkin_closed removes every unchecked entrant. The remaining entrants keep their relative seed order and are renumbered from 1. At least 2 must remain. Removed names are returned and shown in seed order.

**Seeding.**

- Seeds are 1 to the field size with no gaps. Every saved reorder carries `seeding_version`. A stale version answers 409 `stale_seeding` with the current order. A save raises the version by one.
- Elimination bracket size is the next power of two at or above the field size. Slot order is built recursively: start from `1, 2`, and to double the size replace each seed s by the pair `s, size+1-s`. Round 1 match m pairs slot positions 2m-1 (upper) and 2m (lower). Seeds above the field size are byes. This gives:
  - 4: `1 v 4, 2 v 3`
  - 8: `1 v 8, 4 v 5, 2 v 7, 3 v 6`
  - 16: `1 v 16, 8 v 9, 4 v 13, 5 v 12, 2 v 15, 7 v 10, 3 v 14, 6 v 11`
- Byes therefore go to the top seeds and never meet each other in round 1. A bye match is won by its entrant at start (state `bye`, no score) and that entrant is already placed in round 2.
- For example, with 6 entrants seeded Ana 1, Ben 2, Cai 3, Dov 4, Eli 5, Fen 6, the cards are:
  - `Round 1, match 1: Ana vs bye`
  - `Round 1, match 2: Dov vs Eli, not played`
  - `Round 1, match 3: Ben vs bye`
  - `Round 1, match 4: Cai vs Fen, not played`
  - `Round 2, match 1: Ana vs to be decided`
  - `Round 2, match 2: Ben vs to be decided`
  - `Round 3, match 1: to be decided vs to be decided`
- In elimination, round r match m's winner fills round r+1 match ceil(m/2): the upper slot when m is odd, the lower slot when m is even.

**Double elimination.**

- The winners bracket is seeded as above.
- Losers of winners round 1 pair in losers round 1 in match order: losers round 1 match j takes the losers of winners round 1 matches 2j-1 (upper) and 2j (lower).
- For k of 2 or more, losers of winners round k enter losers round 2k-2 in reversed match order. Losers round 2k-2 match j takes the winner of losers round 2k-3 match j (upper) against the loser of winners round k match M+1-j (lower), where M is the number of matches in winners round k.
- Losers round 2k-1 pairs the winners of losers round 2k-2 matches 2j-1 and 2j.
- The grand final takes the winners-bracket winner (upper) against the losers-bracket winner (lower).
- A losers slot fed by a bye passes the bye on. A match with one bye side is won by the other side at once. A match fed by two byes is `not needed` and passes a bye forward.
- The 8-entrant mapping in full:

| Match | Upper | Lower |
|---|---|---|
| Winners round 1, match 1 / 2 / 3 / 4 | seed 1 / 4 / 2 / 3 | seed 8 / 5 / 7 / 6 |
| Winners round 2, match 1 | winner W1 m1 | winner W1 m2 |
| Winners round 2, match 2 | winner W1 m3 | winner W1 m4 |
| Winners round 3, match 1 | winner W2 m1 | winner W2 m2 |
| Losers round 1, match 1 | loser W1 m1 | loser W1 m2 |
| Losers round 1, match 2 | loser W1 m3 | loser W1 m4 |
| Losers round 2, match 1 | winner L1 m1 | loser W2 m2 |
| Losers round 2, match 2 | winner L1 m2 | loser W2 m1 |
| Losers round 3, match 1 | winner L2 m1 | winner L2 m2 |
| Losers round 4, match 1 | winner L3 m1 | loser W3 m1 |
| Grand final | winner W3 m1 | winner L4 m1 |
| Grand final reset | same two, same sides | |

- When grand final 1 has a result: if the lower (losers-side) entrant wins, `Grand final reset` gets both entrants and is played, and `Grand final reset needed` is announced. Otherwise it becomes `not needed`, is never played, and the upper entrant wins the tournament.
- Results in elimination formats need a winner. Equal games answer 422 `Elimination matches need a winner.`

**Scores.**

- Each side is a whole number from 0 to 99. `0-0` answers 422 `A score needs at least one game.` More games wins. Equal games is a draw, which is allowed only in round robin and Swiss.

**Match states and who may act.**

| State | Entrant (reporter) | Opponent of reporter | Organizer |
|---|---|---|---|
| pending (both entrants known) | report → reported | report → reported | call → called; save result → confirmed |
| called | report → reported | report → reported | save result → confirmed |
| reported | nothing (409 `You already reported this match.`; confirm is 403 `You cannot confirm your own report.`) | confirm → confirmed; dispute → disputed; report: same score → confirmed, different → disputed | save result → confirmed (overwrites) |
| disputed | 409 `This match is disputed. An organizer will resolve it.` | same | resolve → resolved |
| confirmed, resolved | 409 `This match already has a result.` | same | edit (Shutter trace) |
| bye, not needed, a grand final reset waiting for grand final, or a match with a slot to be decided | 409 `This match is not ready to play.` | same | same |

Further rules:

- Accounts that are neither entrant nor organizer get 403 `Only the two players in this match or an organizer can report it.` Non-organizers resolving get 403 `Only organizers can resolve disputes.`
- Confirming or disputing with no report answers `There is no report to answer.` Resolving a non-disputed match answers `There is no open dispute.`
- A dispute must differ from the report (422 `Change the score to dispute it.`).
- Writes when the tournament is not running answer `The tournament is not running.` Once finished they answer `This tournament is finished. Its results can no longer change.`
- A resolve takes the organizer's chosen score. It may equal either claim or neither.

**Version and arrival order.**

- Every match write carries the `version` the writer saw. The server applies writes to one match one at a time, in arrival order.
- Two cases come before the version check:
  - A report from the opponent of the current reporter on a reported match is their answer (same score confirms, different score disputes), whatever version it carries. So two simultaneous conflicting reports always end as one dispute.
  - A resolve that arrives after the dispute was already resolved answers 409 `already_resolved`, naming the resolving username and result.
- Any other write whose version is not current answers 409 `stale_match`, naming `updated_by` (the username whose write made the current version; `system` for automatic changes) and the current score.

**Server time.**

- Every deadline is decided on the server's clock: real time plus the grading offset. The server applies due deadlines at least once a second and immediately after a clock move, and broadcasts each one.
- The browser shows server-published state and never decides from its own clock whether something is open, due or late. The device clock may be wrong.
- The card countdown is computed from `auto_confirm_at` and the last `server_time` the page received, advanced by time passed on the page. It is display only and is recomputed the same way after reload.

**Time rules.**

- A reported match becomes confirmed (`updated_by` `system`) when `CUPFOLD_CONFIRM_WINDOW_MS` has passed since the report on server time, unless the opponent answered first.
- A called match not reported within `CUPFOLD_MATCH_LIMIT_MS` of its call is overdue.
- In Swiss, every pending or called match of the current round is overdue once `CUPFOLD_SWISS_ROUND_MS` has passed since the round was paired.
- Overdue is visible to organizers only and clears when the match is reported or saved. Turning overdue on or off never changes the match's `version` or `updated_by`. It reaches organizers as `match.updated`.
- Check-in closes at `checkin_closes_at`.

**Advancing and finishing.**

- A confirmed or resolved result places the winner (and, in double elimination, the loser) into the next slots. It also updates standings and broadcasts the published announcements.
- A tournament finishes on its own at these points:
  - Single elimination: when the final has a result.
  - Double elimination: when grand final 1 is won by the upper side, or when the reset has a result.
  - Round robin: when every match has a result.
  - Swiss: when every match of the last round has a result.

**Current round.**

- An open match is one in state pending, called, reported or disputed whose two entrants are both known (no slot to be decided).
- Single elimination, round robin and Swiss: the current round is the lowest-numbered round with an open match. When no round has one, it is the last round. In Swiss, only paired rounds count, so between rounds it is the latest paired round until the next round is paired.
- Double elimination: each region has its own region current round by the same rule (grand final region: round 1 is `Grand final` and round 2 is `Grand final reset`). The overall current round is the region current round of the first region, in the order winners, losers, grand final, that has an open match. When none has one, it is the grand final region's current round.

**Shutter trace: the dependent set.**

- An edit is legal only on a confirmed or resolved match of a running tournament (otherwise `Only confirmed or resolved results can be edited.`). The proposed score follows the score rules.
- If the edit keeps the same winner (or, in round robin and Swiss, any edit), the dependent set is empty. Committing changes only that match's score and recomputes standings. Later Swiss pairings already made stay as they are.
- If the winner changes in an elimination format, the set is built by walking feed edges (winner edge and loser edge) from the edited match. A match joins the set when the slot fed from the edited match or from a match already in the set currently holds an entrant or a bye. The walk continues from it. This includes the grand final and the grand final reset. When the grand final joins, a reset that is `not needed` or has entrants also joins.
- Reset order: by longest feed-edge distance from the edited match (nearest first), then winners before losers before the final, then round, then match number.
- `count` is the size of the set. `confirmed_count` counts set members that are confirmed or resolved.
- The preview changes nothing. Its `preview_token` binds the proposed score, the set and the version of every match in it.
- The commit recomputes the set. If the set or any version differs, it answers 409 `stale_preview` and changes nothing.
- Otherwise, in one transaction:
  1. Every match in the set loses each entrant that came through a slot fed from the edited match or the set (the slot becomes to be decided). It loses its report, dispute and result, goes to pending (a grand final reset returns to waiting) and raises its version.
  2. The edited match takes the new score and its new winner and loser advance.
  3. One `matches.reset` message carries the set in reset order, followed by `match.updated` for the edited match and `<n> matches reset` (when the set is not empty).
- A bye in the set is re-applied when its entrant arrives again.

**Round robin.**

- Seat the entrants by seed in m positions, where m is the field size, rounded up to even with a bye seat last.
- Round 1 pairs position i with position m+1-i, as match i (upper is position i), for i from 1 to m/2.
- After each round, position 1 stays and the others rotate one step: the last moves to position 2.
- There are m-1 rounds, all made at start. A pairing with the bye seat is a bye card (`<name> vs bye`) worth nothing.
- For example, with 5 entrants seeded 1 to 5:

| Round | Matches |
|---|---|
| 1 | 1 v bye, 2 v 5, 3 v 4 |
| 2 | 1 v 5, bye v 4, 2 v 3 |
| 3 | 1 v 4, 5 v 3, bye v 2 |
| 4 | 1 v 3, 4 v 2, 5 v bye |
| 5 | 1 v 2, 3 v bye, 4 v 5 |

**Round robin standings.**

- Only confirmed or resolved results count. Match points are win 3, draw 1, loss 0.
- Order: match points, then head-to-head, then game difference (games won minus games lost), then games won, then seed (lower first).
- Head-to-head is the match points each entrant earned in matches among the group of entrants level on match points. It is computed once for that group, and an entrant alone in its group has 0.
- `Decided by`: for each neighbouring row, take the first column in tiebreak order where the two rows differ. The row's deciding column is the later of these columns for its neighbours above and below.
- Worked example (5 entrants, all played):
  - Results: Ana–Ben 2-1, Ana–Cai 0-2, Ana–Dov 2-0, Ana–Eli 2-0, Ben–Cai 2-0, Ben–Dov 2-1, Ben–Eli 2-0, Cai–Dov 2-1, Cai–Eli 2-1, Dov–Eli 2-1.
  - Table:

| Place | Entrant | Played | Match points | Head-to-head | Game difference | Games won | Seed | Decided by |
|---|---|---|---|---|---|---|---|---|
| 1 | Ben | 4 | 9 | 3 | +4 | 7 | 2 | Game difference |
| 2 | Ana | 4 | 9 | 3 | +3 | 6 | 1 | Game difference |
| 3 | Cai | 4 | 9 | 3 | +2 | 6 | 3 | Game difference |
| 4 | Dov | 4 | 3 | 0 | -3 | 4 | 4 | Match points |
| 5 | Eli | 4 | 0 | 0 | -6 | 2 | 5 | Match points |

**Swiss.**

- The number of rounds is ceil(log2(field size)), fixed at start.
- Pairing rank is match points, then seed.
- With an odd field, the bye is assigned first: the lowest-ranked entrant without a previous bye (or the lowest-ranked entrant if all have had one). The bye is a 2-0 win worth 3 match points, shown as the last card of the round.
- Round 1: the remaining 2h entrants pair seed rank i against i+h as match i.
- Later rounds:
  1. Repeatedly take the highest-ranked unpaired entrant and pair them (as upper) with the highest-ranked unpaired entrant they have not played.
  2. When an entrant is left without a legal partner, go back to the most recent choice that still has an untried, lower-ranked alternative.
  3. If no complete pairing exists, `rounds` answers 409 `No pairing without a rematch exists.`
  4. Matches are numbered in the order they were paired.
- The next round is paired only on the organizer's `rounds` call, after every match of the current round has a result (else `Finish every match in round <n> first.`). It broadcasts the new cards and `Round <n> is paired`.
- Worked round 2 (6 entrants: Ana 1, Ben 2, Cai 3, Dov 4, Eli 5, Fen 6):
  - Round 1: Ana–Dov 2-0, Ben–Eli 1-2, Cai–Fen 1-1.
  - Rank: Ana 3, Eli 3, Cai 1, Fen 1, Ben 0, Dov 0.
  - Round 2: match 1 Ana vs Eli; match 2 Cai vs Ben (Fen skipped as a rematch); match 3 Fen vs Dov.

**Swiss standings.**

- Order: match points, then Buchholz cut 1, then Buchholz, then Sonneborn-Berger, then seed.
- Each played round gives an entrant one opponent score: the opponent's current match points, or 0 for a bye.
- Buchholz is the sum of opponent scores. Buchholz cut 1 is that sum minus the single lowest opponent score.
- Sonneborn-Berger is the opponent score of every opponent beaten, plus half that of every opponent drawn.
- A bye counts as played. `Decided by` works as in round robin.
- Worked example, after round 2 above with Ana–Eli 2-1, Cai–Ben 2-0, Fen–Dov 1-1:

| Place | Entrant | Match points | Buchholz cut 1 | Buchholz | Sonneborn-Berger |
|---|---|---|---|---|---|
| 1 | Ana | 6 | 3 | 4 | 4 |
| 2 | Cai | 4 | 2 | 2 | 1 |
| 3 | Eli | 3 | 6 | 6 | 0 |
| 4 | Fen | 2 | 4 | 5 | 2.5 |
| 5 | Dov | 1 | 6 | 8 | 1 |
| 6 | Ben | 0 | 4 | 7 | 0 |

  Every row has played 2 and is decided by `Match points`.

**Final placements.**

- Elimination formats: the champion is 1st. Entrants knocked out in the same match round share a place, equal to 1 plus the number of entrants knocked out later or never. Byes knock nobody out.
  - Single elimination of 8 gives 1st, 2nd, 3rd, 3rd, 5th, 5th, 5th, 5th.
  - Double elimination of 8 gives 1st, 2nd (grand final loser), 3rd (losers round 4), 4th (losers round 3), 5th, 5th (losers round 2), 7th, 7th (losers round 1).
- Round robin and Swiss: the standings place.
- At finish, the server writes one history row per linked player, exactly once. The row records name, place, field size and finish date at that moment and never changes afterwards. Edits to other tournaments cannot touch it, and a finished tournament refuses edits.
- Finishing broadcasts `<name> wins the tournament`.

**Cupfold roster format.**

- The file is UTF-8 text, and its file name ends in `.cupfold.txt`. A leading byte-order mark is ignored. Lines end in LF or CRLF.
- Every physical line counts for numbering, starting at 1. Lines that are blank, or whose first non-space character is `#`, are ignored.
- Each other line, trimmed, is `[<seed> | ]<name>[ @<username>]`:
  - If the line contains `|`, the text before the first `|` (trimmed) is the seed.
  - If the remaining text ends in a space followed by `@` and a word, that word (lowercased) is the username.
  - The rest, trimmed, is the name.
- Example:

```
# Thursday back room cup
1 | Ana @ana
2 | Ben
Cai @cai
Dov
```

- Checks, in this order:
  1. The file name, then empty content. These are checked before storing and answer 422 `validation` with their message.
  2. The file is stored.
  3. UTF-8 decoding.
  4. Entrant count from 2 to 128. If it fails, it is the only error shown.
  5. Per line, top to bottom, the first failing check only: seed is a whole number from 1 to 128; seed not larger than the entrant count; seed not used on an earlier line; name not empty; name at most 40 code points; name not a case-insensitive duplicate of an earlier name (quoting the earlier spelling); the username exists; the username not used on an earlier line.
- At most 20 line errors are returned, and any error means 422 `roster_invalid` with nothing changed.
- When the file is valid, it replaces every entrant of the draft or check-in tournament in one transaction. Seeded lines take their seed. Unseeded lines take the remaining seed numbers in file order. Usernames link accounts.

### Services (DP-52, DP-53, DP-54, DP-55, DP-60)

- **Postgres** (`DATABASE_URL`) is the system of record. It holds accounts and sessions, tournaments, co-organizers, entrants and seeds, matches with their feed edges and versions, score reports and disputes, accepted roster and logo records with their `sha256`, the per-tournament live message log with `seq`, rate-limit counts and history rows. The schema is applied idempotently every time the server starts.
- **MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`), private bucket:
  - Every roster file that passes the name and empty checks is stored byte for byte as received at `rosters/<tournament id>/<sha256>.cupfold.txt`, where `<sha256>` is the lowercase hex SHA-256 of those bytes. This happens before parsing, and rejected files are stored too. No entrant is created or changed until MinIO has confirmed the write.
  - The download returns the latest accepted file's object bytes unchanged.
  - Logos are PNG or JPEG, recognised by their leading bytes, and at most `CUPFOLD_LOGO_MAX_BYTES` (the limit is allowed). They are stored at `logos/<tournament id>/<sha256>.png` or `.jpg`. `logo_url` is set only after MinIO confirms. The setup page shows the logo from then on. The public page exists only once the tournament has left draft (a draft's share link shows the draft copy from Feedback states), so the logo appears there from check-in open onwards, and never before MinIO confirms.
  - The browser never talks to MinIO. Images and files stream through the app.
- **Storage outage.** When MinIO is unreachable:
  - Roster and logo uploads answer 503 `storage_unavailable` and add or change nothing.
  - Roster download and logo reads answer 503 `storage_unavailable`.
  - Everything else (seeding, check-in, reports, results, edits, live updates) works normally.
  - The server keeps no long-lived "down" state: each upload tries MinIO afresh, so uploads succeed again as soon as it returns, without a restart.

### Seed data (DP-04)

The app ships with an empty database and no accounts. Tournaments in grading start from `POST /api/grading/seed`. Examples in this brief use these invented names:

- Entrants: Ana, Ben, Cai, Dov, Eli, Fen, Gus and Hal, seeded 1 to 8 in that order, linked to accounts `ana`, `ben`, `cai`, `dov`, `eli`, `fen`, `gus` and `hal`.
- Organizer account: `dana`. Co-organizer account: `eve`.
- Tournament: `Back Room Cup`.

Every person, club and tournament is invented.

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same build.

`/app/run.json` holds string commands and the schema tag, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. It serves pages, assets, the API and the WebSocket from that one origin.

### Configuration and secrets (DP-05, DP-60)

Read at start, never hard-coded and never sent to the browser:

- `DATABASE_URL`
- the six `S3_*` variables listed in Services
- `APP_PUBLIC_PORT`
- `APP_PUBLIC_URL` (the origin share links are built on: `<APP_PUBLIC_URL>/s/<share code>`)
- `CUPFOLD_GRADING` (`1` enables the grading routes)

Timers and limits, with their defaults:

| Variable | Default |
|---|---|
| `CUPFOLD_CONFIRM_WINDOW_MS` | 600000 |
| `CUPFOLD_MATCH_LIMIT_MS` | 1800000 |
| `CUPFOLD_SWISS_ROUND_MS` | 3000000 |
| `CUPFOLD_CHECKIN_DEFAULT_MS` | 3600000 |
| `CUPFOLD_REPORT_RATE` | 20 |
| `CUPFOLD_LOGIN_RATE` | 10 |
| `CUPFOLD_ROSTER_MAX_BYTES` | 65536 |
| `CUPFOLD_LOGO_MAX_BYTES` | 524288 |
| `CUPFOLD_TOAST_MS` | 4000 |

The client reads the values it needs from `GET /api/config` when it loads.

Share codes are 22 random URL-safe characters (128 random bits).

### Server boundary (DP-01, DP-03, DP-45, DP-55)

- **Health.** `GET /api/health` answers HTTP 200 `{"status":"ok"}` when Postgres and MinIO are reachable. When MinIO is unreachable it answers HTTP 200 `{"status":"unavailable"}`, never 503. Storage reachability is measured at most 5 seconds before the answer.
- **Boot.** If Postgres is unreachable at boot, the server keeps retrying and health answers 503 `{"status":"starting"}` until it connects. MinIO being down at boot never stops the server.
- **Origin.** Same origin only. A state-changing request, or a WebSocket upgrade, whose `Origin` header names another origin answers 403 `forbidden` with `Cross-site requests are refused.`
- **Size limits.** JSON bodies are at most 65,536 bytes (exactly 65,536 is allowed). Uploaded files are at most their configured byte limit (the limit itself is allowed). Anything larger answers 413 before it is read further.
- **What is served.** Only the published page routes, the built client assets, the bundled font files and the API. Source files, the run manifest, package files, environment files and source maps are never served (404). Unknown `/api/` paths answer 404 `not_found` JSON.
- **No service worker.** The app registers no service worker. Every client timer (countdowns, toasts, animations, reconnect back-off) runs on page timers and animation frames.

### Browser support and performance (DP-43, DP-47)

- Current Chromium, Firefox and WebKit.
- Viewports 375x812 with touch, 768x1024 and 1280x800.
- A 128-entrant bracket is usable within three seconds of opening.
- Live changes appear on every open screen within 2 seconds.
- A dropped live connection retries within 2 seconds and catches up using `after`.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and the app serves by running them in that order.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and the bundled Geist font, each with its licence.
- IF-03: Every shipped package and font uses one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The app uses only Postgres and MinIO for storage: no SQLite, Redis or other datastore, and no files written outside the system temp directory as storage.
- IF-05: The page loads nothing from another origin: no CDNs, remote fonts or remote icons.
- IF-06: `package-lock.json` is committed and `install` uses `npm ci`.
- IF-07: The provided dev service definitions and their credentials are left unchanged.
- IF-08: The app registers no service worker.

## Engineering standards

- The TypeScript is idiomatic and strict-mode clean, with types for every API request, response and live message.
- Names in code use this brief's domain terms (entrant, seed, match, report, dispute, Shutter trace, dependent set, Buchholz cut 1, check-in).
- Each domain rule is decided in exactly one place in the source: each state transition, the dependent set, each tiebreak order, the pairing rule, the seeding placement and the roster parse. The browser and the live channel reuse the server's result instead of recomputing it.
- There is no abstraction with a single implementation, and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the rules make impossible.
- Every error leaves the server through the one published error shape and code list.
- The code has no features beyond this brief.
