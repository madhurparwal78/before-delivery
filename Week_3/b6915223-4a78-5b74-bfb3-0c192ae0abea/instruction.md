# Sideline Works Elevens

Elevens is an independent fantasy football game for one small national top-flight league: ten clubs that play a 36-round season through the calendar year. A solo founder runs it, not the league. Managers build a 15-player squad inside a 100.0m budget, pick a starting eleven, a captain and a chip before each deadline, and watch live points arrive while the matches are played. Supporters' groups and podcast hosts run private mini leagues inside it. One game operator publishes fixtures, records match events, runs the daily price change and closes each gameweek. The server enforces every rule: the squad rules, the deadline, the money and the scoring. Every open screen shows the same numbers. The app uses three backend services. Postgres is the source of truth for players, prices, fixtures, squads, picks, chips, the bank ledger, transfer hits, match events, scores and standings. MinIO stores one locked-team snapshot per manager for each gameweek. PocketBase holds manager accounts and the in-app notice inbox. These are out of scope: email of any kind, payments, public leagues, head-to-head leagues, cup competitions, player news feeds, social sign-in, and any datastore beyond those three services.

## Problem and users

When a small national league has a fantasy game at all, it comes and goes with sponsors. It is slow to score and has no chips, no live points and no private leagues. So supporters' groups run their own leagues in spreadsheets. One person types in every goal by hand each weekend, works out sell prices and auto-subs on paper, and settles arguments about whether a transfer went in before the deadline. Each gameweek costs hours, and every disputed deadline costs the group some trust. Elevens replaces the spreadsheet with a server that decides every rule and keeps a stored record of every locked team.

- **Manager** (weekly): builds a legal 15-player squad within 100.0m. Before each deadline they set the starting eleven, captain, vice-captain and any chip and make transfers. During matches they watch live points arrive.
- **Mini-league admin** (weekly): a manager who creates a private league for a supporters' group and shares its join code. They follow the standings and each member's gameweek history, and settle disputes from the stored locked-team snapshots.
- **Game operator** (daily): publishes each gameweek's fixtures, which sets the deadline. They record live match events, run the daily price change and close each gameweek, which applies auto-subs and final totals.

## Journeys

1. **First squad.** A visitor with no account opens the app and creates an account with a team name. On Transfers they filter the player list by position, club and maximum price and fill all 15 slots using only the keyboard. They then confirm the squad. They land on Pick Team, which shows the default eleven, the bench, the captain armband and a bank of the money left over.
2. **Setting the team.** A manager whose gameweek is open moves between shirts with the arrow keys. They swap a bench player into the eleven, make a new captain and vice-captain, and try a swap that would leave only two defenders, which is refused with the rule it breaks. Each result is announced once. A reload shows the saved lineup.
3. **Transfers with a hit.** A manager with one free transfer marks two players to sell and picks two replacements. They see a 4-point hit and the bank after the transfers before confirming. They close the tab, open Transfers in a second tab, find the same draft, and confirm. The bank, free transfers and transfer history change, and the History ledger still reconciles.
4. **The deadline.** The operator publishes the open gameweek's fixtures, and the deadline is set 90 minutes before the first kickoff. A manager has Transfers open when the deadline passes. The page turns read only without a reload, a late confirmation is refused with the deadline copy, and a notice arrives in the inbox. Shortly after, the history row reads "Team locked, receipt stored", and the snapshot downloads with the captain that was set at the deadline.
5. **Matchday.** The operator starts the gameweek and records a goal for a manager's captain. The connection drops, so the console re-sends the event. On the manager's open Pick Team, the captain's shirt pulses and a "+10" chip with a "x2" tag flies to the gameweek total. The digits roll, and the manager's mini-league row moves up. The goal counts once everywhere.
6. **Closing the gameweek.** The operator closes a live gameweek. A starter who played no minutes is replaced by the first eligible bench player. If the captain did not play, the vice-captain takes the armband. Hits are subtracted and season totals are fixed. A Free Hit squad returns to its earlier state, and the next gameweek opens for picks and transfers.
7. **Supporters' league.** An admin creates a private league and shares its six-character code, and members join with it. After a gameweek closes, the admin opens one member's history and downloads that member's locked-team snapshot to settle who was captain. They then replace the join code because the old one leaked.
8. **Daily price change.** The operator runs the price change on two league dates in a row, and a player a manager owns rises 0.1m each time. After the first rise the manager gets a price notice and the selling price stays the same. After the second rise the selling price gains 0.1m, which is half of the 0.2m rise. Selling the player credits exactly that selling price to the bank.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Manager accounts** Visitors create an account with email, password and team name, then sign in and out. PocketBase holds the accounts, the server keeps the sessions, and the seeded operator account has the only operator role, as qualified in API.
- **DP-02 — PocketBase outage** While PocketBase is unreachable, sign-up and sign-in answer 503 with the outage copy, existing sessions keep working, and the Notices dialog shows the delayed-notices copy, as qualified in Services.
- **DP-03 — Notice inbox** Every deadline lock, deadline refusal, auto-sub, captain fallback and price change on an owned player writes one notice record to PocketBase for each affected manager, with the kind and message given in Services.
- **DP-04 — Notices in every open tab** A new notice and the new unread count appear in every open tab of that manager, without a reload, within 2 seconds of PocketBase storing the notice.
- **DP-05 — Player catalogue** The players endpoint lists every seeded player with club, position and current price. It filters by position, club and maximum price and sorts by the four published sort orders.
- **DP-06 — Squad rules checked together** Creating a squad or confirming transfers checks every squad rule at once. A refusal answers 422 and lists each broken rule with its published message.
- **DP-07 — Default lineup for a new squad** A newly confirmed squad gets the published default eleven, bench order, captain and vice-captain, a bank of the 100.0m budget minus the squad's cost, and one free transfer.
- **DP-08 — Filters in the address** The page address holds the Transfers position, club, maximum price and sort order and the Pitch or List view, and Back, Forward and reload restore them.
- **DP-09 — Keyboard player list** On Transfers a manager can mark squad players to sell and bring in players from the Players list using only the arrow keys, Enter and Escape, as described in Interactions.
- **DP-10 — Build-a-squad journey** A new manager signs up, filters the player list, fills all 15 slots within budget, confirms the squad and lands on Pick Team, which shows the default eleven.
- **DP-11 — Starting eleven shape** A saved lineup always has a valid shape and a bench of four, and a swap that breaks the shape answers 422 naming each rule it breaks, as published in Business rules.
- **DP-12 — Captain and vice-captain** The captain and vice-captain are two different starters. Each change saves at once, and a refused change answers 422 with the captain rule.
- **DP-13 — Keyboard Pick Team** A manager moves between shirts with the arrow keys, picks a shirt with Enter, swaps with Enter on a second shirt and cancels with Escape. C and V set the captain and vice-captain from any shirt or action-bar button in the pitch region.
- **DP-14 — Pick Team announcements** Each saved swap, captain change, vice-captain change or refusal on Pick Team is announced exactly once in the Team updates live region with the published copy.
- **DP-15 — Pick Team journey** A manager swaps a bench player into the eleven, sets a new captain and vice-captain, has a shape-breaking swap refused, and reloads to find the saved lineup.
- **DP-16 — Transfer preview** Before anything is confirmed, the preview answers with the number of transfers, the free transfers used, the hit, the bank afterwards and every broken rule.
- **DP-17 — Free transfers and hits** Free transfers are added at each deadline up to the published store limit. Each transfer beyond the free ones costs the published hit, except under Wildcard or Free Hit.
- **DP-18 — Confirm against the shown hit** A transfer confirmation carries the hit the manager saw. If the current hit differs, it answers 409 with the current hit, so a manager is never charged a hit they were not shown.
- **DP-19 — One confirmation per key** A repeated transfer confirmation with the same idempotency key returns the first response and makes no second transfer. The same key with a different body answers 422.
- **DP-20 — Draft that survives** The server keeps the unconfirmed transfer draft, so Back, reload and a second tab show the same draft until it is confirmed, cleared or discarded at the deadline.
- **DP-21 — Confirm dialog focus** The Confirm transfers dialog keeps Tab and Shift+Tab inside it, closes on Escape and returns focus to the Review transfers button.
- **DP-22 — Transfers journey** A manager marks two players out, picks replacements, sees the hit before confirming, confirms, and sees the bank, free transfers and transfer history change.
- **DP-23 — Selling price** A player's selling price is the purchase price plus half of any rise rounded down to 0.1m, or the current price if the price has fallen, worked in whole tenths.
- **DP-24 — Paired bank ledger** Every confirmed transfer writes one sale credit and one purchase debit that share a transfer id. Entries are never edited, and the bank always equals the sum of the ledger entries.
- **DP-25 — Daily price run** The operator's price run for a league date moves each listed player by one tenth, at most once per league date and at most three times per gameweek, and is refused while a gameweek is locked or live, as qualified in Business rules.
- **DP-26 — Money journey** After an owned player rises 0.2m over two daily price runs, the manager sees the selling price gain 0.1m and sells the player. The history page's ledger then reconciles the bank and squad selling value to the transfer history.
- **DP-27 — Chip rules** A manager plays at most one chip per gameweek and each chip once in each half of the season, never plays Free Hit in back-to-back gameweeks, and can cancel only Bench Boost or Triple Captain before the deadline.
- **DP-28 — Free Hit revert** When a Free Hit gameweek closes, the squad, lineup, captaincy and bank return to their state before the Free Hit, through reversal entries in the ledger.
- **DP-29 — Chips journey** A manager plays Wildcard, makes transfers under it without a hit, sees the chips bar mark Wildcard as active, and has a second chip in the same gameweek refused with the published copy.
- **DP-30 — Fixtures and deadline** The operator publishes the open gameweek's five fixtures. The server sets the deadline from the first kickoff and shows it in league time, as published in Business rules.
- **DP-31 — Atomic deadline lock** Within 1 second after the deadline the server locks every team in one step. A change made at the same moment is either wholly in a locked team or wholly refused.
- **DP-32 — Late changes refused** Any squad, transfer, pick or chip change that arrives at or after the deadline answers 409, writes a refusal notice, shows the deadline copy and changes nothing.
- **DP-33 — Server-decided read-only pages** In every open tab, Pick Team and Transfers turn read only within 2 seconds of the server's lock, without a reload. Every screen shows the server's gameweek status whatever the device clock says.
- **DP-34 — Deadline journey** With Transfers open, a manager watches the deadline pass, sees the page turn read only with the locked banner, and finds the deadline notice in the inbox.
- **DP-35 — Locked-team snapshot** At each lock the server stores one snapshot object for each manager with a squad, at the published key and with the published contents. Each snapshot is written once and never overwritten.
- **DP-36 — Receipt only after storage confirms** A history row shows the stored-receipt copy only after MinIO confirms the snapshot. While MinIO is unreachable the row shows the pending copy and the server keeps retrying until the snapshot is stored.
- **DP-37 — Snapshot download as stored** Downloading a past gameweek's snapshot returns exactly the bytes stored in MinIO at the lock. Later transfers, picks and price changes do not alter it.
- **DP-38 — Receipt journey** After a deadline a manager opens History, sees the stored receipt for that gameweek, downloads the snapshot and finds the captain they had at the deadline.
- **DP-39 — Match events and scoring** The operator records minutes, goals, assists, clean sheets, cards, own goals and bonus for a live gameweek, and each event scores by the published table.
- **DP-40 — Each event counted once** An event re-sent with the same event id is applied once and returns the first response. The same event id with a different body answers 409.
- **DP-41 — Voiding an event** While the gameweek is live, voiding a recorded event removes its points everywhere, and voiding it again changes nothing.
- **DP-42 — Live totals in place** Within 2 seconds of a recorded or voided event, each affected manager's open pitch, gameweek total and mini-league table hold the new server values, without a reload, as qualified in Motion and effects.
- **DP-43 — Live match journey** The operator records a goal from the console while a manager watches Pick Team. The console's event log shows the event's points, and the scorer's shirt shows that player's team points with the captain multiplier applied.
- **DP-44 — Points relay** When an event changes an owned player's points, the shirt pulses, a signed chip flies to the gameweek total, the digits roll and the league row moves, in that order, and everything ends on the server's values, as qualified in Motion and effects.
- **DP-45 — Reduced-motion relay** When reduced motion is requested, the relay shows a static delta badge and changes the total and rank at once. Nothing moves, scales or fades, and the final values and the announcement are the same as with motion.
- **DP-46 — Live points announcements** Each event that changes an owned player's points, or lands on a non-scoring bench player, is announced exactly once in the Live points live region with the published copy.
- **DP-47 — Gameweek states** Each gameweek moves through upcoming, open, locked, live and closed in that order only, and each illegal step answers 409 with its published error.
- **DP-48 — Auto-subs and captain fallback** At close, each starter with no minutes is replaced by the first bench player in order who played and keeps the shape valid. The vice-captain takes the armband only if the captain played no minutes.
- **DP-49 — Gameweek scores and season totals** At close each manager's gameweek points minus that gameweek's hit becomes fixed. Every season total is the sum of the closed gameweek net scores and matches the history rows row for row.
- **DP-50 — Close journey** The operator closes a live gameweek. The manager's history shows the final score with auto-subs and the hit applied, and the next gameweek opens for picks and transfers.
- **DP-51 — Mini-league create and join** A manager creates a private league and becomes its admin with a six-character join code. Other managers join with that code, and the admin can replace the code so the old one stops working.
- **DP-52 — League standings** Standings rank members by season total, including the live gameweek while one is live. Ties follow the published order, and each row shows the member's rank at the last close.
- **DP-53 — Member history and snapshots** Any member of a league can open another member's gameweek history and download that member's stored snapshots. Non-members get 404.
- **DP-54 — Mini-league journey** An admin creates a league and a second manager joins with the code. After a gameweek closes, both see the same standings and the same history rows.
- **DP-55 — Run manifest and health** The app installs, builds and serves from the run manifest on the published port and answers the health check. It starts from an empty database, an empty bucket and a PocketBase with no app collections.
- **DP-56 — Configuration from the environment** Every service URL and credential is read from the published environment variables at start. None is hard-coded or sent to the browser.
- **DP-57 — Server boundary** The server refuses writes that send a different origin, enforces the request size and content type limits, and uses one error shape. It never serves source files or credentials.
- **DP-58 — Phone layout and touch** At 375 by 812 no screen scrolls sideways, every pitch row fits, the ledger rail becomes a sticky bottom strip, and every shirt and control is at least 44 by 44 pixels.
- **DP-59 — Floodlit chalk board** The screens follow the floodlit chalk-pitch look described in Visual design: a near-black ground, thin off-white chalk lines, deep turf green, one amber accent, a coral alert colour, condensed display type and monospaced numerals.
- **DP-60 — Money in whole tenths** Throughout the source, prices, selling prices, the bank and ledger amounts are stored and computed as whole tenths of a million, never as floating-point money.

## Frontend

### Screens and layout (DP-10, DP-15, DP-22, DP-26, DP-29, DP-34, DP-38, DP-43, DP-50, DP-54, DP-58)

All screens share a sticky header. It holds the wordmark "Elevens", navigation links, the Notices button and the gameweek status line. Visitors without a session who open any screen except Sign in are sent to Sign in. The operator lands on the Operator console. A manager with no squad who opens Pick Team is sent to Transfers.

- **Sign in** (`/signin`): one centred card with two modes, "Sign in" and "Create account". It has email, password and, when creating an account, a team name field.
- **Pick Team** (`/team`): during an open gameweek the heading is "Pick Team". While the gameweek is locked or live the heading is "Gameweek <n> points", and the screen becomes the live points board. It has two views, chosen in the address with `view=pitch` (the default) or `view=list`:
  - The Pitch view is a top-down pitch drawn in chalk lines. The goal is at the bottom, so the goalkeeper row is lowest, then defenders, midfielders and forwards. Each row holds that position's starters in eleven order, and a bench tray of four sits below the touchline.
  - The List view shows the same fifteen players as rows grouped into Starters and Bench.
  - The ledger rail holds bank, squad value, free transfers, hit cost, the gameweek total, the chips bar and the league table. The league table is for the league named by `league=<id>` in the address, or else the manager's earliest joined league. If the manager has no league, it shows "Join or create a mini league to see it move."
- **Transfers** (`/transfers`): the same pitch or list of the manager's squad, plus the player filters and the Players list. Shirt cards marked out carry a coral "Out" tag and show their selling price. A draft bar shows the preview figures and the "Review transfers" and "Reset draft" buttons. With no squad yet, the heading reads "Build your squad". The pitch then shows fifteen empty shirt outlines (2 goalkeepers, 5 defenders, 5 midfielders, 3 forwards), the rail shows money remaining from the 100.0m budget, and the draft bar has a "Confirm squad" button instead.
- **Leagues** (`/leagues`): a list of the manager's leagues with rank and member count, a "Create league" form and a "Join league" form.
- **League** (`/leagues/<id>`): the standings table. The admin also sees the join code with "Copy join code" and "New join code". Each member's team name links to that member's history.
- **Member history** (`/leagues/<id>/members/<manager id>`): that member's gameweek history table, with snapshot download links.
- **History** (`/history`): the manager's gameweek history table with the receipt column and snapshot download links, the Transfers table, and the Bank ledger table with a balance row. A reconciliation line sits under them.
- **Operator console** (`/operator`, operator only): sections for Fixtures, Match events, Gameweek and Prices, each with its form and the event log.
- **Notices**: a dialog opened from the header. It lists notices newest first and has a "Mark all read" button.

The three viewports:
- **1280 by 800**: a two-column board. The pitch sits on the left at about two thirds of the width. The sticky ledger rail sits on the right and stays in view while the page scrolls. Leagues, History and the console use one wide column with tables at full width.
- **768 by 1024**: one column. The pitch is at full width, and the ledger rail sits below it as a two-column band of figures that is not sticky. The league table follows.
- **375 by 812**: one column. The pitch scales down so its widest row of five shirts fits without clipping. The ledger rail collapses into a sticky bottom strip that shows Bank, Free transfers and the gameweek total; while the rail is collapsed, the strip's gameweek total value element carries `data-gameweek-total` and `data-points`. Tapping the strip's "Ledger" button opens the full rail as the "Ledger" sheet, which includes the chips bar. The league table sits below the bench tray. Tables on History and League keep their first column fixed and scroll sideways inside their own frame. The page never scrolls sideways.

### Public screens and controls (DP-01, DP-04, DP-08, DP-09, DP-13, DP-14, DP-21, DP-33, DP-36, DP-42, DP-44, DP-46, DP-51, DP-53)

These are the only public hooks. Everything else is free. `<name>` is a player's display name from Seed data. `<position>` is one of goalkeeper, defender, midfielder or forward. A shirt's `<points>` and its `data-points` both carry that player's `team_points` from the squad view for the current gameweek. So a captain's midfield goal reads 10, and a bench player outside Bench Boost reads 0. While the gameweek is open both are 0, and the shirt's visible figure shows the price instead.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Header | `link "Pick Team"`, `link "Transfers"`, `link "Leagues"`, `link "History"`; for the operator only, `link "Operator"` | same text |
| Header | `button` whose name starts with "Notices" and ends with ", <unread> unread" when unread is above 0 | bell icon with an amber count |
| Header | `status "Gameweek status"` | the gameweek status line from Feedback states |
| Sign in | `textbox "Email"`, `textbox "Password"`, `textbox "Team name"` (Create account mode only), `button "Sign in"`, `button "Create account"`, `link "Create an account"`, `link "I have an account"` | same text |
| Sign in | `status "Account"` | sign-in and sign-up results |
| Pick Team, Transfers | `region "Pitch"` holding the shirt rows and the bench | chalk pitch |
| Pick Team, Transfers | `group "Bench"` inside the pitch region | bench tray of four |
| Pick Team, Transfers | each shirt: `button` named "<name>, <position>, <points> points", with ", captain" or ", vice-captain" appended when it applies; has `aria-pressed` when selectable; carries attributes `data-player-id` and `data-points` | short name, club code, price or points in mono numerals, and a "C" or "V" armband |
| Pick Team | `toolbar "Player actions"`, shown while a shirt is selected: `button "Make captain"`, `button "Make vice-captain"`, `button "Cancel selection"` | same text |
| Pick Team, Transfers | `radiogroup "View"` with `radio "Pitch"`, `radio "List"` | same text |
| Pick Team, Transfers | `complementary "Ledger"` holding labelled figures "Bank", "Squad value", "Free transfers", "Hit cost" and "Gameweek total"; the gameweek total value element carries `data-gameweek-total` and `data-points` | mono figures such as "11.0m", "2", "-4 pts", "54" |
| Pick Team, Transfers | `group "Chips"` with `button "Wildcard"`, `button "Free Hit"`, `button "Bench Boost"`, `button "Triple Captain"`; `aria-pressed` is true for the active chip; a chip used in the current half of the season is disabled | chip name, plus "Active" or "Used" |
| Pick Team | `table "League table"` with columns Rank, Team, GW, Total; each row carries `data-manager-id`, `data-rank` and `data-points` (season total). A row whose `rank` differs from its `last_rank` shows a rank arrow named "Up <k>" or "Down <k>", where `<k>` is the number of places between the two. The arrow stays as long as they differ. No arrow shows when they are equal or when `last_rank` is null | mono numerals |
| Pick Team, Transfers | `status "Team updates"` | team, transfer, squad and chip results |
| Pick Team | `status "Live points"` | live point announcements |
| Pick Team, Transfers | `status "Locked banner"`, present only while the gameweek is not open | the read-only copy from Feedback states |
| Mobile | `button "Ledger"` in the bottom strip; `dialog "Ledger"` | rail contents |
| Transfers | `combobox "Position"` (All, Goalkeepers, Defenders, Midfielders, Forwards), `combobox "Club"` (All clubs, then each club name), `combobox "Max price"` (Any, then 4.0m to 11.0m in steps of 0.5m), `combobox "Sort"` (Highest price, Lowest price, Most points, Name) | same text |
| Transfers | `listbox "Players"`, each `option` named "<name>, <club code>, <position>, <price>m" | rows with mono price |
| Transfers | `button "Review transfers"`, `button "Reset draft"`, `button "Confirm squad"` (builder only) | same text |
| Transfers | `status "Draft preview"` | "Transfers <count> · Free used <free> · Hit -<hit> pts · Bank <bank>m" |
| Transfers | `dialog "Confirm transfers"` with `button "Confirm transfers"`, `button "Keep editing"` | each pair as "<out> → <in>", then the hit and the bank afterwards |
| Pick Team, Transfers | `dialog "Play <chip name>"` with `button "Play <chip name>"`, `button "Not now"` | what the chip does |
| Notices | `dialog "Notices"`, `list "Notices"`, `button "Mark all read"`, `status "Notices"` | notice messages with league-time stamps |
| Leagues | `textbox "League name"`, `button "Create league"`, `textbox "Join code"`, `button "Join league"`, `status "League updates"` | same text |
| League | `table "Standings"`, columns Rank, Team, GW, Total, with the same row attributes and rank arrows as the League table; admin only: `button "Copy join code"`, `button "New join code"` | join code in mono capitals |
| History, Member history | `table "Gameweek history"` with columns Gameweek, Points, Hit, Net, Total, Chip, Captain, Receipt; `link "Download gameweek <n> snapshot"` in rows whose receipt is stored | receipt copy from Feedback states |
| History | `table "Transfers"`, `table "Bank ledger"` (last row "Balance"), `status "History updates"` | mono amounts |
| Operator | `combobox "Home team 1"` to `combobox "Home team 5"`, `combobox "Away team 1"` to `combobox "Away team 5"`, `textbox "Kickoff 1"` to `textbox "Kickoff 5"` (league time, written as year-month-day hour:minute), `button "Publish fixtures"` | same text |
| Operator | `combobox "Fixture"`, `combobox "Player"`, `combobox "Event"`, `spinbutton "Value"`, `button "Record event"`, `list "Event log"` with a `button "Void"` on each live event | same text |
| Operator | `button "Start gameweek"`, `button "Close gameweek"`, `dialog "Close gameweek"` with `button "Close gameweek"` and `button "Cancel"` | same text |
| Operator | `textbox "Run date"`, `combobox "Move player"`, `radio "Rise"`, `radio "Fall"`, `button "Add move"`, `list "Moves"`, `button "Run price change"` | same text |
| Operator | `status "Operator updates"` | operator results |

During the Points relay the flying chip carries the attribute `data-relay-chip`. Its text is the signed delta, followed by a "x2" or "x3" tag for a captain.

### Interactions (DP-08, DP-09, DP-13, DP-20, DP-21, DP-33, DP-58)

**Pick Team pitch and list (keyboard and touch).**
1. The pitch region is one Tab stop. Tab lands on the last focused shirt, or the goalkeeper the first time.
2. Left and Right move along a row. Up and Down move to the nearest shirt in the row above or below. The bench is the row below the goalkeeper row. Home and End jump to the first and last shirt of a row. In the List view, Up and Down move through rows in list order.
3. Enter or Space on a shirt when nothing is selected selects it. The shirt shows an amber outline, `aria-pressed` becomes true, and the "Player actions" toolbar appears.
4. Enter or Space on a second shirt acts on the pair. A starter and a bench player swap, and the swap saves. Two bench players swap bench order, and the change saves. Two starters move the selection to the second shirt.
5. Escape clears the selection without saving. Focus stays on the shirt.
6. C makes the selected shirt captain, or the focused shirt if none is selected. V does the same for vice-captain. Both keys work while focus is on any shirt, bench shirt or toolbar button inside the pitch region, and the change saves at once.
7. Tapping or clicking a shirt does what Enter does. There is no drag.
8. Every save goes to the server. The result is announced in "Team updates", and the screen shows the server's lineup.

**Transfers.**
1. The squad pitch uses the same keys as Pick Team: it is one Tab stop, Tab lands on the last focused shirt or the goalkeeper the first time, and the arrow keys move as there. Enter on a squad player toggles it as out. Escape unmarks the most recently marked player who has no replacement yet.
2. The Players list is one Tab stop. Up and Down move the active option, and Home and End jump to the ends. Enter brings the active player in for the earliest marked-out player of the same position who has no replacement yet. If no such slot exists, "Team updates" announces "Mark a <position> to sell first." Escape in the list moves focus back to the pitch.
3. In the squad builder, Enter in the list fills the first empty slot of that player's position. Enter on a filled shirt empties it.
4. Every change to the draft is saved as the server draft and updates "Draft preview" from the server's preview. There is no submit button for the preview.
5. Changing a filter, sort or view writes it into the address as `position` and `club` (the codes from API), `max_price` (millions with one decimal), `sort` (the sort values from API) and `view`. Each change adds a history entry. Back and Forward restore the controls and the list, and reload restores both the address state and the server draft. A second tab opened on Transfers shows the same draft.
6. "Review transfers" opens "Confirm transfers". Focus starts on "Keep editing". Tab and Shift+Tab cycle only through the dialog's controls, wrapping at both ends. Escape or "Keep editing" closes it and returns focus to "Review transfers". "Confirm transfers" sends the confirmation with the hit shown in the dialog.

**Chips.**
- Pressing an available chip's button opens its "Play <chip name>" dialog, and the dialog's "Play <chip name>" button plays the chip.
- Pressing the active chip's button cancels it at once, with no dialog, and shows the Cancel chip result. For Wildcard and Free Hit, the cancel is refused with the Cancel chip error copy.
- While a chip is active, the other available chip buttons stay enabled. Playing one of them is refused with the chip copy from Feedback states.
- Only chips used in the current half of the season are disabled.

**Dialogs and sheets.** Notices, Ledger, Play chip, Confirm transfers and Close gameweek all trap Tab and Shift+Tab, close on Escape and return focus to the control that opened them.

**Read-only switch.** When the server reports that the gameweek has left the open state, every open Pick Team and Transfers page shows the locked banner within 2 seconds. Shirts remain focusable for reading points, but Enter, C, V, the chips and the draft controls no longer change anything, and their buttons are disabled. When the next gameweek opens, the pages become editable again within 2 seconds. The browser never decides this from its own clock.

**Leagues.** "Copy join code" puts the code on the clipboard and announces it. Selecting a team name in Standings opens that member's history.

### Visual design (DP-58, DP-59)

The mood is a floodlit night ground. The page is a near-black green, like a pitch at night. Thin off-white chalk lines draw the pitch, split the zones and rule the tables. A deep turf green fills the pitch's mown bands and the shirt bodies. One warm amber is the only accent. It marks focus rings, the selected shirt, the captain armband, active chips, the gameweek total and the Points relay. A coral red marks refusals, field errors, negative hits and "Out" tags. Body text is chalk on the dark ground, and every text and control pairing meets WCAG 2.2 AA contrast.

Headings use a tall, condensed display face (Big Shoulders Display), set in capitals for screen titles. Body text uses a plain humanist sans (IBM Plex Sans). Every price, point, rank, bank and count uses monospaced numerals (IBM Plex Mono), so columns of figures line up. Each heading step is about a quarter larger than the step below it. The layout is compact: spacing comes in small steps that double, tables use tight rows, and the pitch fits the first screen at 1280 by 800.

Shirts, the pitch, club badges and the bench tray are drawn by the app from simple shapes. A shirt is a turf-green body with chalk trim and the club's three-letter code, plus the player's short name and a mono figure below it. Club badges are chalk outlines with the club code. Icons are simple line icons. Every shirt, button, chip and row control is at least 44 by 44 pixels.

### Motion and effects (DP-44, DP-45)

Motion carries meaning only. Dialogs and sheets fade in and rise a short distance in about a fifth of a second, and leave a little faster. The locked banner slides down from under the header in about a fifth of a second. Hovering a shirt brightens its chalk outline without moving it, and pressing a shirt darkens it briefly. Pending states use words, not spinners. Nothing loops or moves on its own: there is no animated grass, no pulsing badges and no idle drift.

**Signature: the Points relay.** When an update from the server changes the points of a player in the viewer's squad, the relay plays in four stages, strictly one after another with no overlap. Each stage starts quickly and settles gently:
1. **Pulse, about 0.18 seconds.** The player's shirt flashes an amber outline that swells and settles. A chip with the signed team delta appears on the shirt, for example "+10" with a "x2" tag for a captain's midfield goal. The shirt's `data-points` takes the new server value as this stage starts.
2. **Flight, about 0.38 seconds.** The chip travels along a gentle arc from the shirt's centre to the gameweek total in the rail, or to the bottom strip on a phone, and disappears there.
3. **Digit roll, about 0.6 seconds.** The total counts from the old value to the new one, with each digit rolling separately like a scoreboard drum. The total's `data-points` takes the new value as this stage starts.
4. **Row move, about a third of a second.** The viewer's row in the league table slides from its old rank to its new rank, and the other rows shift to make room. Its rank arrow updates by the rule in Public screens and controls: amber for up, coral for down. The row's `data-points` and `data-rank` take the new values as this stage starts. If the rank does not change, the row's figures update with no slide, and the arrow follows the same rule.

The whole relay takes about 1.5 seconds. It runs once per event and never reverses. It starts within half a second of the server recording the event, so the shirt, the total and the league row all hold the new values within the DP-42 bound. A voided event runs the same relay with a negative chip. Sometimes another update arrives while a relay is playing. Then the running relay jumps straight to its end state, and the new update applies at once without motion. The shirt shows the static delta badge from the reduced-motion path, and the shirt, the total and the league row take the newest server values together. When a relay ends, the shirt's `data-points`, the rail total and the league row hold the same values that the server's endpoints return. Bench players add points only under Bench Boost. When a non-scoring bench player's points change, a dimmed chip appears on that bench shirt for about 1.5 seconds and never flies to the total. Shirts of other managers' players never relay.

**Reduced motion.** When the device asks for reduced motion, the relay does not animate. Nothing moves, scales or fades. The shirt shows a static amber delta badge, for example "+10 x2", for 4 seconds. The total, the league row's figures and its rank change at once, and the rank arrow follows the same rule as with motion. The announcement and the final values are the same as with motion. Dialogs, sheets and the locked banner appear and disappear at once.

### Feedback states (DP-02, DP-14, DP-32, DP-33, DP-36, DP-46)

Every async action shows a pending state on its button. The button's text changes to the pending copy and it is disabled until the reply arrives. The result is announced once in the named polite live region. Field errors appear under their field and are linked to it as its description. The "Account" region also lists them as links that move focus to the field. Placeholders are formatted as follows:

- `<n>`: the gameweek number.
- `<bank>` and `<price>`: millions with one decimal, such as 11.0.
- `<hit>`: whole points.
- `<count>`: the number of transfers.
- `<messages>`: the refused rules' messages from Business rules, joined by "; ".
- `<chip name>`: Wildcard, Free Hit, Bench Boost or Triple Captain.
- `<deadline>`: the deadline in league time, written as weekday, day, month and 24-hour time, such as "Sat 8 Nov 13:30".

| Action | Pending | Success | Errors | Region |
|---|---|---|---|---|
| Sign in | "Signing in…" | navigates to Pick Team, or to Transfers if there is no squad | 401: "Email or password is wrong."; 503: "Sign-in is unavailable right now. Try again in a minute." | Account |
| Create account | "Creating account…" | navigates to Transfers | 409: "An account with this email already exists."; 422: per-field messages; 503: the sign-in outage copy | Account |
| Confirm squad | "Confirming…" | "Squad confirmed. Bank <bank>m." | 422: "Squad refused: <messages>."; 409 locked: the deadline copy | Team updates |
| Swap | "Saving…" | "<name in> moves into the eleven for <name out>." (two bench players: "Bench order saved.") | 422: "Swap refused: <messages>."; 409 locked: the deadline copy | Team updates |
| Captain or vice-captain | "Saving…" | "<name> is now captain." / "<name> is now vice-captain." | 422: "Captain refused: <messages>."; 409 locked: the deadline copy | Team updates |
| Confirm transfers | "Confirming…" | "Transfers confirmed: <count> made, hit <hit> points, bank <bank>m." | 422: "Transfers refused: <messages>."; 409 hit changed: "The hit is now <hit> points. Check it and confirm again."; 409 locked: the deadline copy | Team updates |
| Play chip | "Playing…" | "<chip name> played for gameweek <n>." | 409 chip errors: see below; 409 locked: the deadline copy | Team updates |
| Cancel chip | "Cancelling…" | "<chip name> cancelled." | 409 `chip_locked_in`: "<chip name> cannot be cancelled once played."; 409 locked: the deadline copy | Team updates |
| Create league | "Creating…" | "League created. Share code <code>." | 422: per-field messages | League updates |
| Join league | "Joining…" | "Joined <league name>." | 404: "No league uses that code."; 409: "You are already in this league." | League updates |
| New join code | "Replacing…" | "New join code <code>. The old code no longer works." | — | League updates |
| Download snapshot | "Preparing…" | the file downloads | 409: "The receipt is still pending. Try again when it shows as stored."; 503: "Storage is unreachable. Try the download again in a minute." | History updates |
| Publish fixtures | "Publishing…" | "Fixtures published. Deadline <deadline>." | 422: per-field messages; 409: "Gameweek <n> is not open." | Operator updates |
| Record event | "Recording…" | "Event recorded." (on a replay: "Already recorded, not counted again.") | 409: "That event id was already used for a different event."; 409: "Gameweek <n> is not live."; 422: per-field messages | Operator updates |
| Void event | "Voiding…" | "Event voided." | 409: "Gameweek <n> is not live." | Operator updates |
| Start or close gameweek | "Starting…" / "Closing…" | "Gameweek <n> is live." / "Gameweek <n> closed. Final scores are in." | 409: "Gameweek <n> cannot do that now." | Operator updates |
| Price change | "Running…" | "Price change applied: <applied> moved, <skipped> held at the cap." | 409 date used: "A price change already ran for <run date>."; 409 frozen: "Prices are frozen until the gameweek closes." | Operator updates |

The **deadline copy** is "Deadline passed. Gameweek <n> is locked, so this change was not saved."

The chip refusal copy for each 409 code:
- `chip_already_this_gameweek`: "Only one chip can be played in a gameweek."
- `chip_used`: "<chip name> has already been used in this half of the season."
- `free_hit_back_to_back`: "Free Hit cannot be played in two gameweeks in a row."
- `chip_after_transfers`: "<chip name> must be played before making transfers this gameweek."

**Gameweek status line.** The header's "Gameweek status" region shows one of the following:
- "Gameweek <n> · Open · Deadline <deadline>"
- "Gameweek <n> · Open · Deadline not set"
- "Gameweek <n> · Locked"
- "Gameweek <n> · Live"
- "Gameweek <n> · Closed", only after the final gameweek

It updates within 2 seconds of each server change. **Locked banner:** "Gameweek <n> is locked. Pick Team and Transfers reopen when the next gameweek opens."

**Live points announcements** go to the "Live points" region, once per event, at the moment the update arrives. `<event label>` is one of minutes played, goal, assist, clean sheet, yellow card, red card, own goal or bonus. `<delta>` is the team delta with a "+" or "-" sign.
- Scoring change: "<name>: <event label>, <delta> for your team. Gameweek total <total>."
- Non-scoring bench player: "<name>: <event label> on your bench, not counted."
- Voided event: "<name>: <event label> removed, <delta> for your team. Gameweek total <total>."
- An event that changes no team points (for example, a minutes update that crosses no threshold) is not announced.

**Receipts** in the History receipt column:
- Stored: "Team locked, receipt stored"
- Pending: "Receipt pending. Your locked team is safe; the file will be stored when storage is back."

A row changes from pending to stored within 2 seconds of the storage confirming.

**Notices.**
- New notice: each new notice's message is announced in the "Notices" region.
- Inbox outage: the dialog shows "Notices are delayed. They will appear here when the inbox is back."
- Empty inbox: "No notices yet."

## Backend

### API (DP-01, DP-05, DP-06, DP-07, DP-11, DP-12, DP-16, DP-18, DP-19, DP-20, DP-25, DP-27, DP-30, DP-37, DP-39, DP-40, DP-41, DP-47, DP-51, DP-53, DP-57)

All endpoints live under `/api` and answer JSON with `Content-Type: application/json`, except snapshot downloads. Request bodies must be JSON. A charset parameter is allowed. A body of up to 65,536 bytes is accepted, and 65,536 bytes itself is allowed. Prices and money are whole tenths of a million (`*_tenths`, so 65 means 6.5m). Times are ISO 8601 in UTC with a trailing `Z`. A `position` value in queries, responses and snapshots is one of `GK`, `DEF`, `MID` or `FWD`. A `club` value is the club's three-letter code from Seed data. This also applies to `home` and `away` in fixtures. Sessions use the HTTP-only cookie `elevens_session` (SameSite Lax, path `/`). Sessions are stored server-side, are valid on every copy of the server that shares the database, and last until sign-out.

**Error shape.** Every error has the shape `{"error":"<code>","message":"<sentence>"}`. Some errors add fields: `fields` is an object of field name to message, `rules` is a list of `{"code","message"}`, and `hit_points` is a number. The message wording is free unless Feedback states prints it.

**Error precedence** applies across the whole API. The first failing check answers:
1. 413 `payload_too_large`
2. 415 `unsupported_media_type`
3. 403 `cross_origin`, for a write that sends an Origin header other than this app's origin. A write with no Origin header is accepted.
4. 401 `unauthenticated`
5. 403 `forbidden`, for the wrong role: an operator on a manager endpoint or a manager on an operator endpoint, checked before any resource is looked up
6. 404 `not_found` (or a named 404 code such as `no_squad`), for an unknown resource or one the caller may not see
7. Idempotent replay: the stored response, or the key or id conflict
8. 409 state conflicts
9. 422 `validation` or `rules_broken`
10. 409 `hit_changed`

A 503 answers at the point where an unreachable dependency is needed.

**Accounts and catalogue**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/auth/signup` | `{"email","password","team_name"}`: password 10 to 72 characters, team name 3 to 30 characters after trimming | 201 `{"id","email","team_name","role":"manager"}` and sets the cookie | 409 `email_taken`; 422 `validation`; 503 `accounts_unavailable` |
| POST `/api/auth/signin` | `{"email","password"}` | 200 the same shape, with `role` `manager` or `operator`, and sets the cookie | 401 `bad_credentials`; 503 `accounts_unavailable` |
| POST `/api/auth/signout` | none | 204 and clears the cookie | — |
| GET `/api/me` | — | 200 `{"id","email","team_name","role"}` | — |
| GET `/api/clubs` | — | 200 `{"clubs":[{"code","name"}]}` | — |
| GET `/api/players?position=&club=&max_price=&sort=` | all parameters optional; `max_price` in millions with one decimal, inclusive; `sort` is `price_desc` (default), `price_asc`, `points_desc` (by `total_points`) or `name_asc`; ties go by name, then id; names compare by Unicode code point, so case and spaces count ("Rob Kenneally" sorts before "Robbie Tansey") | 200 `{"players":[{"id","name","club","position","price_tenths","total_points","gameweek_points"}]}` | 422 `validation` |
| GET `/api/gameweeks` | — | 200 `{"gameweeks":[{"number","status","deadline"}]}` | — |
| GET `/api/gameweeks/current` | — | 200 `{"number","status","deadline","deadline_local","first_kickoff","fixtures":[{"id","home","away","kickoff"}],"server_time"}` | — |

Signing in to an account that has no manager record on this database creates the manager record. In player rows, `total_points` is the player's raw points summed over closed gameweeks, plus the live gameweek while one is live. `gameweek_points` is the player's raw points in the current gameweek, which is 0 while that gameweek is open. Catalogue endpoints need a session. The current gameweek is the one that is open, locked or live. After the final gameweek closes, it is gameweek 36. `deadline` and `deadline_local` are null until fixtures are published. `deadline_local` uses the `<deadline>` format from Feedback states.

**Squad, picks, chips and transfers** (manager role; the operator gets 403 `forbidden`)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/squad` | `{"players":[15 player ids]}` | 201 squad view | 409 `squad_exists`; 422 `rules_broken` |
| GET `/api/squad` | — | 200 squad view | 404 `no_squad` |
| PUT `/api/picks` | `{"gameweek","starting":[11 ids],"bench":[4 ids in order],"captain","vice_captain"}` | 200 squad view | 404 `no_squad`; 422 `validation` (the ids are not exactly the squad); 422 `rules_broken` |
| POST `/api/chips` | `{"gameweek","chip"}` with `chip` one of `wildcard`, `free_hit`, `bench_boost`, `triple_captain` | 201 squad view | 409 chip codes (see Business rules); 422 `validation` |
| DELETE `/api/chips/{gameweek}` | — | 200 squad view | 404 `not_found` (no chip played); 409 `chip_locked_in` |
| POST `/api/transfers/preview` | `{"gameweek","out":[ids],"in":[ids]}` | 200 `{"count","free_transfers_used","hit_points","bank_after_tenths","rules":[{"code","message"}]}`: broken rules are listed here, not refused | 422 `validation` |
| POST `/api/transfers` | header `Idempotency-Key` (1 to 64 letters, digits, `-` or `_`); body `{"gameweek","out":[ids],"in":[ids],"hit_points"}` | 201 `{"transfers":[{"id","out","in","sell_price_tenths","price_tenths"}],"hit_points","gameweek_hit_points","bank_tenths","free_transfers"}` | 422 `idempotency_key_reused`; 422 `validation`; 422 `rules_broken`; 409 `hit_changed` with `hit_points` |
| GET `/api/transfers/draft` | — | 200 draft view | — |
| PUT `/api/transfers/draft` | `{"gameweek","out":[ids],"in":[ids]}`, where `in` may be shorter than `out` | 200 draft view | 422 `validation` |
| DELETE `/api/transfers/draft` | — | 200 draft view with state `clean` | — |

Every write above that names a gameweek also answers 409 `gameweek_locked` when that gameweek is locked, live or closed, and 409 `gameweek_not_open` when it is upcoming. POST `/api/squad` uses the current gameweek.

The **squad view** is:
`{"gameweek","gameweek_status","editable","players":[{"id","name","club","position","purchase_price_tenths","price_tenths","selling_price_tenths","slot":"starting"|"bench","bench_order","captain","vice_captain","raw_points","team_points"}],"bank_tenths","squad_value_tenths","free_transfers","transfers_made","hit_points","chip","chips":{"wildcard","free_hit","bench_boost","triple_captain"},"gameweek_total"}`

- `bench_order` is 1 to 4 for bench players and null for starters.
- `squad_value_tenths` is the sum of selling prices.
- Each `chips` value is `available`, `active` or `used` for the current half of the season.
- `editable` is true only while the gameweek is open.
- `team_points` is the player's contribution to the team total, with the multiplier applied.
- `gameweek_total` is the team points minus the hit.

The **draft view** is `{"gameweek","state":"clean"|"drafting"|"confirmed"|"refused","out","in","preview","refusal"}`.
- `preview` has the transfer preview shape.
- `refusal` is null or the error body of the last refused confirmation.

**History and snapshots**

| Method and path | Success | Extra errors |
|---|---|---|
| GET `/api/history` | 200 history view | — |
| GET `/api/history/transfers` | 200 `{"transfers":[{"id","gameweek","made_at","out":{"player_id","name","sell_price_tenths"},"in":{"player_id","name","price_tenths"},"free_hit"}]}`, oldest first | — |
| GET `/api/history/ledger` | 200 `{"bank_tenths","squad_selling_value_tenths","entries":[{"id","kind","amount_tenths","player_id","transfer_id","reverses","gameweek","created_at"}]}`, oldest first; `kind` is `opening_budget`, `purchase`, `sale` or `reversal` | — |
| GET `/api/history/{gameweek}/snapshot` | 200 with the stored bytes, `Content-Type: application/json` and `Content-Disposition: attachment; filename="elevens-gw<nn>-<manager id>.json"` | 404 `not_found`; 409 `receipt_pending`; 503 `storage_unavailable` |

The **history view** is:
`{"manager_id","team_name","season_total","rows":[{"gameweek","status","points","hit_points","net_points","running_total","chip","captain","vice_captain","transfers_made","receipt":"stored"|"pending"}]}`

- There is one row for each locked, live or closed gameweek in which the manager had a squad at the lock, in gameweek order.
- `running_total` is null on a row that is not yet closed.

**Mini leagues** (manager role)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/leagues` | `{"name"}`, 3 to 40 characters after trimming | 201 `{"id","name","code","admin_manager_id","is_admin":true}` | 422 `validation` |
| POST `/api/leagues/join` | `{"code"}`, case-insensitive | 200 `{"id","name","code":null,"admin_manager_id","is_admin":false}` | 404 `league_not_found`; 409 `already_member` |
| GET `/api/leagues` | — | 200 `{"leagues":[{"id","name","is_admin","rank","members"}]}`, ordered by join time | — |
| GET `/api/leagues/{id}` | — | 200 `{"id","name","code","gameweek","standings":[{"rank","last_rank","manager_id","team_name","gameweek_points","season_total"}]}`; `code` is null for anyone but the admin | 404 for non-members |
| POST `/api/leagues/{id}/code` | none | 200 `{"code"}` | 404 for non-members; 403 `forbidden` for non-admins |
| GET `/api/leagues/{id}/members/{manager_id}/history` | — | 200 history view | 404 when either the caller or the member is not in the league |
| GET `/api/leagues/{id}/members/{manager_id}/snapshots/{gameweek}` | — | the same as the snapshot download | the same as the snapshot download, plus that 404 |

**Notices** (any signed-in role)

| Method and path | Success | Extra errors |
|---|---|---|
| GET `/api/notices` | 200 `{"unread","notices":[{"id","kind","gameweek","message","read","created"}]}`, newest first | 503 `inbox_unavailable` |
| POST `/api/notices/read-all` | 204 | 503 `inbox_unavailable` |

**Operator** (operator role; others get 403 `forbidden`)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| PUT `/api/operator/gameweeks/{n}/fixtures` | `{"fixtures":[{"home","away","kickoff"}]}`: exactly 5 fixtures, every club exactly once, `kickoff` ISO 8601 with an offset | 200 the current-gameweek shape; fixture ids are `gw<nn>-<HOME>-<AWAY>` | 409 `gameweek_not_open`; 422 `validation` (including a `fixtures` message when the deadline would not be in the future) |
| POST `/api/operator/gameweeks/{n}/start` | none | 200 `{"number","status":"live"}` | 409 `gameweek_not_locked` |
| POST `/api/operator/events` | `{"event_id","fixture_id","player_id","type","value"}`: `event_id` is 1 to 64 letters, digits, `-` or `_`; `value` is required for `minutes` (1 to 120) and `bonus` (1 to 3) and must be absent otherwise | 201 `{"event_id","gameweek","fixture_id","player_id","type","value","points_delta","voided":false,"recorded_at"}` | 409 `event_id_conflict`; 409 `gameweek_not_live`; 422 `validation` (unknown type or fixture, or a player whose club is not in the fixture) |
| POST `/api/operator/events/{event_id}/void` | none | 200 the event with `"voided":true` | 404 `not_found`; 409 `gameweek_not_live` |
| GET `/api/operator/gameweeks/{n}/events` | — | 200 `{"events":[event]}`, oldest first | — |
| POST `/api/operator/gameweeks/{n}/close` | none | 200 `{"number","status":"closed","next_gameweek"}`; `next_gameweek` is null after gameweek 36 | 409 `gameweek_not_live` |
| POST `/api/operator/price-runs` | `{"run_date":"YYYY-MM-DD","moves":[{"player_id","delta_tenths":1 or -1}]}` with 1 to 200 moves and no player twice | 201 `{"run_date","applied":[{"player_id","delta_tenths","price_tenths"}],"skipped":[{"player_id","reason":"gameweek_cap"}]}` | 409 `run_date_used`; 409 `prices_frozen`; 422 `validation` |

An unknown gameweek number (outside 1 to 36) answers 404 `not_found`.

**Idempotent replay.**
- Transfers: a replay of POST `/api/transfers` from the same manager with a used `Idempotency-Key` and the same JSON body returns the stored status and body with the header `Idempotent-Replayed: true`. The same key with a different body answers 422 `idempotency_key_reused`. Only a 201 confirmation is stored against its key: a refused one (409 `hit_changed`, 409 `gameweek_locked`, 422 `rules_broken` or `validation`) stores nothing, so the same key may be sent again.
- Events: a replay of POST `/api/operator/events` with a used `event_id` and the same JSON body returns the stored status and body with the same header. The same `event_id` with a different body answers 409 `event_id_conflict`.
- Keys and event ids are kept for the whole season.

### Business rules (DP-06, DP-07, DP-11, DP-12, DP-17, DP-18, DP-20, DP-23, DP-24, DP-25, DP-27, DP-28, DP-30, DP-31, DP-32, DP-39, DP-40, DP-41, DP-47, DP-48, DP-49, DP-52)

**Squad rules.** Creating a squad and confirming transfers check all of these rules together on the resulting squad. A refusal is 422 `rules_broken`, and `rules` lists every broken rule in this order:

| Code | Message |
|---|---|
| `squad_size` | the squad needs exactly 15 players |
| `duplicate_player` | a player can only be picked once |
| `goalkeepers` | the squad needs exactly 2 goalkeepers |
| `defenders` | the squad needs exactly 5 defenders |
| `midfielders` | the squad needs exactly 5 midfielders |
| `forwards` | the squad needs exactly 3 forwards |
| `club_limit` | no more than 3 players may come from <club name> |
| `budget` | the squad costs more than the money available |
| `position_match` | each player in must play the same position as the player out |

- `club_limit` appears once for each club that has too many players.
- For a new squad, the money available is the 100.0m budget, measured at current prices; exactly 100.0m is allowed. For transfers, it is the bank plus the selling prices of the players going out, and a bank of exactly 0.0m afterwards is allowed.
- `position_match` applies to transfers only. Each player in `out` pairs with the player at the same index in `in`.
- These are 422 `validation`: unknown player ids, an `out` player who is not owned, an `in` player who is already owned, and an `in` list longer than `out`. On a confirmation, `out` and `in` lists of different lengths are also 422 `validation`, and so is an `out` or `in` list that repeats an id. A new squad of any length is checked against the rules: every rule counts every id sent: `squad_size`, the position counts, `club_limit` and the cost all count a repeated id each time it appears, so 14 ids break `squad_size` and 15 ids with one repeated do not, and `duplicate_player` appears once for each id sent more than once, however many times it repeats.
- The preview and the draft accept an `in` list shorter than `out`. Only the pairs count as transfers, meaning the first outs matched one for one with the ins.
  - `count` is the number of pairs.
  - `free_transfers_used` is the smaller of the count and the free transfers still unused this gameweek, or 0 under Wildcard or Free Hit.
  - `hit_points` follows from that count by the hit rule below.
  - `rules` are checked on the squad after just those pairs, exactly as a confirmation of those pairs would be. So unmatched outs never break `squad_size` or a position rule.
  - `bank_after_tenths` is the bank, plus the selling price of every player in `out`, minus the current price of every player in `in`.
  - For example, marking two players out with no replacements previews a count of 0, no free transfers used, a hit of 0 and no rules, with the bank raised by both selling prices.

**Shape and captain rules** apply to every saved lineup:

| Code | Message |
|---|---|
| `eleven_size` | the eleven needs exactly 11 players and the bench 4 |
| `shape_goalkeeper` | the eleven needs exactly 1 goalkeeper |
| `shape_defenders` | the eleven needs at least 3 defenders |
| `shape_midfielders` | the eleven needs at least 2 midfielders |
| `shape_forwards` | the eleven needs at least 1 forward |
| `captain` | the captain and vice-captain must be two different starters |

**Default lineup.** When a squad is confirmed:
- The eleven is the higher-priced goalkeeper, the four highest-priced defenders, the four highest-priced midfielders and the two highest-priced forwards.
- The bench, in order, is the other goalkeeper, then the remaining defender, midfielder and forward.
- The captain is the highest-priced starter and the vice-captain is the next highest.
- Ties go to the lower player id.
- The squad starts with 1 free transfer. The ledger records one opening-budget entry of +1000 and one purchase entry per player.

**Eleven order.** The `starting` list is always kept in eleven order: the goalkeeper first, then defenders, midfielders and forwards. Within each position the order is fixed as follows:
- The default eleven is ordered by price, highest first, with ties to the lower id.
- PUT `/api/picks` keeps the submitted order within each position.
- In a swap or a transfer, the incoming player takes the outgoing player's index. The list is then regrouped by position, and every other relative order is kept.
- In a swap, the outgoing starter takes the incoming bench player's bench order.

Starters in the squad view, the snapshot's `starting` list and the auto-sub order all use eleven order.

**Armbands.**
- If the captain or vice-captain leaves the eleven, by a transfer or by a swap to the bench, the incoming player takes that armband.
- Making the vice-captain captain, or the captain vice-captain, swaps the two armbands.
- Giving a player an armband they already hold saves with no change.

**Money.** All money is whole tenths of a million.
- A selling price is the purchase price plus half of the rise, rounded down to a whole tenth, when the current price is higher than the purchase price. Otherwise it is the current price.
- For example: bought at 6.5m and now 7.0m sells for 6.7m; bought at 6.5m and now 6.8m sells for 6.6m; bought at 6.5m and now 6.6m sells for 6.5m; bought at 6.5m and now 6.3m sells for 6.3m.
- So a single 0.1m rise leaves the selling price unchanged, and a 0.2m rise adds 0.1m to it.
- A player bought back takes the current price as the new purchase price.

The ledger:
- Each confirmed transfer writes one `sale` entry of plus the selling price and one `purchase` entry of minus the current price. The two entries share the transfer's id.
- Entries are never changed or deleted. A correction is a `reversal` entry of the opposite amount, and its `reverses` holds the original entry's id.
- The bank always equals the sum of all of the manager's ledger entries.
- Each transfer in the transfer history has exactly one sale and one purchase entry, matching its `sell_price_tenths` and `price_tenths`.
- The History ledger table ends with a "Balance" row equal to `bank_tenths`. Under the tables, the reconciliation line reads "Bank <bank>m · Squad selling value <value>m · Ledger balance <bank>m".

**Free transfers and hits.**
- At each deadline, every squad's free transfers become the smaller of 5 and (the free transfers left unused that gameweek plus 1).
- Within a gameweek, each transfer beyond the free transfers held at the start of that gameweek costs 4 points. Hits are counted per transfer pair.
- The hit counts against the open gameweek's score.
- Under Wildcard or Free Hit, transfers cost nothing and use no free transfers.
- The preview and the confirmation compute the same hit. A confirmation whose `hit_points` differs from the server's hit for that batch answers 409 `hit_changed` with the server's hit.

**Draft states.**
- `clean` becomes `drafting` on a PUT with any players. `drafting` becomes `clean` on a DELETE or a PUT with empty lists.
- A successful confirmation clears the lists and sets `confirmed`.
- A refused confirmation (409 or 422) while the gameweek is open keeps the lists and sets `refused`, with the error body in `refusal`.
- A PUT from `confirmed` or `refused` returns the draft to `drafting`.
- Drafts are discarded, and set to `clean`, at the deadline lock. A confirmation that arrives after the lock is refused with 409 `gameweek_locked` and leaves the draft `clean`, with `refusal` null.

**Chips.** The season has two halves, gameweeks 1 to 18 and 19 to 36. Each chip can be played once in each half, and only one chip can be played per gameweek.
- Bench Boost: all 15 players score.
- Triple Captain: the multiplier is 3 instead of 2.
- Wildcard: that gameweek's transfers are free and permanent.
- Free Hit: that gameweek's transfers are free and are reverted at close.

Refusals are 409, and the first that applies is used:
1. `chip_already_this_gameweek`
2. `chip_used`
3. `free_hit_back_to_back` (Free Hit was played in the previous gameweek)
4. `chip_after_transfers` (Wildcard or Free Hit after a transfer has been made in that gameweek)

Bench Boost and Triple Captain can be cancelled while the gameweek is open. Cancelling Wildcard or Free Hit answers 409 `chip_locked_in`.

**Free Hit revert.** When a Free Hit gameweek closes, the squad, purchase prices, eleven, bench order, captain, vice-captain and bank return to their state just before Free Hit was played. The ledger gets one `reversal` for each sale and purchase made under the Free Hit.

**Gameweek states.** The season has gameweeks 1 to 36. Legal transitions:

| From | To | Trigger |
|---|---|---|
| upcoming | open | the previous gameweek closes |
| open | locked | the deadline passes |
| locked | live | the first kickoff time, or the operator's start, whichever comes first |
| live | closed | the operator's close |

Any other step is refused:
- Publishing fixtures when the gameweek is not open: 409 `gameweek_not_open`.
- Starting when it is not locked: 409 `gameweek_not_locked`.
- Recording or voiding events, or closing, when it is not live: 409 `gameweek_not_live`.
- Manager writes: 409 `gameweek_locked` or `gameweek_not_open`, as listed in API.

Two simultaneous starts or closes of the same gameweek: exactly one succeeds and the others answer 409.

**Deadline and lock.**
- League time is Europe/Dublin. The deadline is 90 minutes before the gameweek's earliest kickoff, and the server decides it.
- Fixtures can be republished while the gameweek is open, and the deadline then moves with them.
- No deadline is set until fixtures are published.
- The lock runs within 1 second after the deadline, even if no request arrives. In one step it:
  - marks the gameweek locked,
  - freezes every squad's eleven, bench order, captain, vice-captain, chip and bank as the locked team,
  - adds free transfers,
  - discards drafts,
  - queues one `deadline_locked` notice for each manager with a squad.
- A manager write that arrives at or after the deadline is refused with 409 `gameweek_locked` and a `transfer_refused` notice, even if the lock step has not finished yet. A write that is accepted is in the locked team. No team is ever partly locked.
- The browser never decides the gameweek status from its own clock. The device clock may be wrong.

**Scoring.** `value` is the event's value.

| Event type | Goalkeeper | Defender | Midfielder | Forward |
|---|---|---|---|---|
| `minutes` | 1 for 1 to 59 minutes, 2 for 60 or more | same | same | same |
| `goal` | 6 | 6 | 5 | 4 |
| `assist` | 3 | 3 | 3 | 3 |
| `clean_sheet` | 4 | 4 | 1 | 0 |
| `yellow_card` | -1 | -1 | -1 | -1 |
| `red_card` | -3 | -3 | -3 | -3 |
| `own_goal` | -2 | -2 | -2 | -2 |
| `bonus` | `value` | `value` | `value` | `value` |

- A `minutes` event carries the player's minutes so far in that fixture. The player's appearance points use the largest non-voided value for that fixture, and the event's `points_delta` is the change in appearance points.
- A player's raw points are the sum over their non-voided events.
- Team points:
  - Each starter counts once.
  - The captain counts twice, or three times under Triple Captain.
  - Bench players count only under Bench Boost.
- While a gameweek is live, the live total is the team points minus the hit. Auto-subs and the captain fallback wait until close.
- For example, a captain's midfield goal adds +10 to the team, shown with a "x2" tag.

**Events once.** An event id is applied at most once, even if it is sent several times at the same moment. Voiding removes the event's points from every derived value. Voiding an already-voided event returns 200 and changes nothing.

**Close.** In one step, closing:
1. Applies auto-subs. A player played if they have a non-voided `minutes` event with a value of 1 or more in that gameweek. Starters who did not play are handled in eleven order: goalkeeper first, then defenders, midfielders and forwards. Each is replaced by the first bench player in bench order who played, is not yet used, and keeps the shape valid. There are no auto-subs under Bench Boost.
2. Applies the captain fallback. If the captain did not play, the vice-captain gets the multiplier. If neither played, no one does. Auto-subs and the fallback change only the closed gameweek's score: the saved eleven, bench order, captain and vice-captain carry into the next gameweek unchanged.
3. Fixes the gameweek points and net score (points minus hit), and the season totals.
4. Reverts any Free Hit.
5. Opens the next gameweek.

It then queues `auto_sub` notices.

**Standings and totals.**
- A manager's season total is the sum of `net_points` over closed gameweeks. While a gameweek is live, it also includes the live net. This one value appears in history, standings and the rail.
- Standings order is season total (highest first), then team name (case-insensitive, A to Z), then manager id.
- `last_rank` is the member's rank when the most recent gameweek closed, or null before any close.
- `gameweek_points` is the live gameweek's net while one is live, otherwise the most recently closed gameweek's net, or 0.
- Members without a squad appear with 0.
- Every value on screen that depends on events, prices or the gameweek status updates within 2 seconds of the change, without a reload.

**Price runs.**
- The operator runs one price change per league date, normally at 02:30 league time. The server stamps each run with the date given and refuses a date that has already been used with 409 `run_date_used`. When two runs for the same date arrive at the same moment, exactly one succeeds.
- Each move changes a price by one tenth.
- A player who has already moved three times since the current gameweek opened is skipped with reason `gameweek_cap`.
- While any gameweek is locked or live, runs are refused with 409 `prices_frozen`.
- A price change never alters purchase prices. It changes selling prices as given under Money, and it queues a `price_change` notice for each manager who owns the player.

**Join codes.** A join code is 6 characters drawn from capital letters and digits, without O, 0, I or 1. Codes are unique across leagues. The league's creator is its admin. A new code replaces the old one at once, and the old code then answers 404 `league_not_found`.

### Services (DP-01, DP-02, DP-03, DP-04, DP-35, DP-36, DP-37)

**Postgres** holds every rule-bearing record: clubs, players, prices and price history, gameweeks, fixtures, squads, picks, locked teams, chips, the ledger, transfers and hits, drafts, events, scores, standings, leagues, sessions, idempotency records, the snapshot receipt status, and notices waiting to be delivered. The app applies its schema and seed data idempotently every time it starts.

**MinIO** holds one snapshot object per manager per locked gameweek, in the bucket `S3_BUCKET`, with the key `snapshots/gw-<nn>/<manager id>.json`, where `<nn>` is the two-digit gameweek number. The object is UTF-8 JSON with `Content-Type: application/json`, and it holds:
- `gameweek`, `manager_id`, `team_name` and `locked_at`
- `starting` (11 ids in eleven order) and `bench` (4 ids in bench order)
- `captain`, `vice_captain`, `chip` (null or a chip code) and `bank_tenths`
- `squad`: 15 objects `{"player_id","position","club","purchase_price_tenths","selling_price_tenths"}`

Snapshot rules:
- Each object is written once, after the lock commits, and is never overwritten.
- A snapshot's receipt is `stored` only after MinIO has confirmed the write. Until then it is `pending`.
- While MinIO is unreachable, the server retries every 5 seconds until the write succeeds. The lock itself never waits for storage.
- Downloads stream the stored bytes unchanged.
- If MinIO is unreachable during a download, the download answers 503 `storage_unavailable` with the copy from Feedback states.

**PocketBase** holds manager accounts in its `users` collection, and the app signs in through it. The app creates its `notices` collection idempotently whenever PocketBase is reachable. The collection has these fields:
- `manager`: the PocketBase user id
- `kind`: `deadline_locked`, `transfer_refused`, `auto_sub` or `price_change`
- `gameweek`: a number
- `message`: text
- `read`: true or false

Messages by kind:
- `deadline_locked`: "Gameweek <n> is locked. Your team is set."
- `transfer_refused`: "Your change for gameweek <n> arrived after the deadline and was not saved."
- `auto_sub`: "<name in> came on for <name out> in gameweek <n>." For a captain fallback, also `auto_sub`: "<vice name> took the armband in gameweek <n>."
- `price_change`: "<name> rose to <price>m." or "<name> fell to <price>m."

The inbox reads notices back from PocketBase, so a notice is shown only after PocketBase has stored it. Each notice reaches every open tab of its manager within 2 seconds of being stored. No email is ever sent.

When PocketBase is unreachable:
- Sign-up and sign-in answer 503 `accounts_unavailable`.
- Existing sessions keep working, and every game action still succeeds.
- Notices wait in Postgres and are written to PocketBase, each exactly once, within 10 seconds after it is reachable again.
- `/api/notices` answers 503 `inbox_unavailable`, and the Notices dialog shows the delayed-notices copy.

More than one copy of the server may run against the same database and bucket at once. The deadline lock, each snapshot write, each price run, each event and each notice still happen exactly once.

### Seed data (DP-05, DP-07, DP-30)

Every club, player and person below is invented. At start:
- Gameweek 1 is `open` with no fixtures, so its deadline is not set. Gameweeks 2 to 36 are `upcoming`.
- There are no managers, leagues, events or price runs.
- The operator account is email `operator@sideline.test`, password `chalk-and-floodlights-26`, team name "Operations", role `operator`. The app creates it in PocketBase whenever it is missing.

Clubs, by price tier:

| Code | Name | Tier |
|---|---|---|
| HAR | Harbour Rovers | A |
| KIL | Kilbarrow Celtic | A |
| DRU | Drumlin United | A |
| LOU | Lough Athletic | B |
| SAL | Saltmarsh Town | B |
| FER | Ferrybank FC | B |
| GLE | Glencarra Wanderers | B |
| RAT | Rathmoyle Albion | C |
| BRA | Brackenford City | C |
| COR | Corrib Vale | C |

Every club has nine players with ids `<CODE>-GK1`, `<CODE>-DEF1` to `-DEF3`, `<CODE>-MID1` to `-MID3` and `<CODE>-FWD1` to `-FWD2`. That makes 90 players: 10 goalkeepers, 30 defenders, 30 midfielders and 20 forwards. Starting prices, in millions, by tier and slot:

| Tier | GK1 | DEF1 | DEF2 | DEF3 | MID1 | MID2 | MID3 | FWD1 | FWD2 |
|---|---|---|---|---|---|---|---|---|---|
| A | 5.0 | 6.0 | 5.0 | 4.5 | 10.0 | 7.0 | 5.5 | 10.5 | 7.0 |
| B | 4.5 | 5.0 | 4.5 | 4.0 | 8.0 | 6.0 | 5.0 | 8.0 | 6.0 |
| C | 4.0 | 4.5 | 4.0 | 4.0 | 6.5 | 5.0 | 4.5 | 6.5 | 5.0 |

Player names by slot:

| Club | GK1 | DEF1 | DEF2 | DEF3 | MID1 | MID2 | MID3 | FWD1 | FWD2 |
|---|---|---|---|---|---|---|---|---|---|
| HAR | Ronan Tierney | Cathal Brophy | Eoin Madigan | Shane Folan | Ciaran Doyle | Darragh Whelan | Fiachra Nolan | Oisin Rafferty | Tadhg Lenihan |
| KIL | Padraig Hession | Kevin Mulvey | Liam Garvan | Aaron Coyle | Senan Gilroy | Jamie Corcoran | Niall Prendergast | Conall Breen | Mark Duignan |
| DRU | Alan Furlong | Dylan Keaveney | Robbie Tansey | Cian Hegarty | Evan Moriarty | Luke Fahy | Rory Geraghty | Sean Kinsella | Adam Mullery |
| LOU | Brian Cosgrave | Paul Devane | Owen Lally | Ross Mannion | Jack Treacy | Killian Dolan | Fionn Hughes | Daniel Costigan | Cormac Feeney |
| SAL | Gavin Harte | Ethan Loughran | Ben Mahony | Colm Ruane | Dara Kerins | Eamon Sheridan | Patrick Quill | Josh Merrigan | Tom Gaughan |
| FER | Declan Ormsby | Conor Byrne | Ryan Cuddihy | Kyle Diskin | Odhran Phelan | Sam Fogarty | Ultan Healy | Noel Tuohy | Jordan Kilkelly |
| GLE | Martin Scully | Ian Rowley | Fergal Daly | Neil Corkery | Diarmuid Quigley | Alex Morrin | Cillian Galvin | Barry Hanrahan | Matthew Joyce |
| RAT | Stephen Kearns | Philip Nestor | Gary Mulhern | Lorcan Daws | Hugh Barrett | Nathan Clancy | Peter Moran | Chris Larkin | Leon Coughlan |
| BRA | Eddie Walshe | Kieran Brennock | Joe Stapleton | David Ferris | Jake Holohan | Tiernan Keogh | Michael Rabbitte | Aidan Cullinane | Shay Delahunt |
| COR | Frank Gildea | Tony Mulcahy | Rob Kenneally | Danny Spillane | Gearoid Ward | Lee Hennelly | Mikey Grehan | Callum Dineen | Emmet Furey |

For example, with the seed data at start, Ciaran Doyle (HAR-MID1) costs 10.0m, and the cheapest legal squad costs well under 100.0m.

## Technical requirements

### Deployment (DP-55)

The runtime has Node.js 22 with npm. Write the app in TypeScript. Put the run manifest at `/app/run.json`. It contains string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or 4173 when that is unset. `GET /api/health` answers HTTP 200 with `{"status":"ok"}` as soon as the server is serving, including while MinIO or PocketBase is unreachable. The app must start against an empty database, an empty bucket and a PocketBase with no app collections, and create its own schema, seed data, collections and operator account.

### Configuration and secrets (DP-56)

The app reads these at start:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD`
- `APP_PUBLIC_PORT`

No service URL or credential is hard-coded, logged or sent to the browser. The browser talks only to this app, never directly to Postgres, MinIO or PocketBase.

### Server boundary (DP-57)

Only same-origin requests are allowed. The server sends no cross-origin headers, and it refuses writes that send an Origin header other than its own, with the 403 from API. Writes with no Origin header are accepted. Request size and content type limits are as published in API, and every error uses the one error shape. The server serves only the built client assets and the API. It never serves server source, source maps of server code, environment files, the lockfile, dependency folders or anything containing credentials. Unknown paths outside the client routes answer 404 `not_found`.

At boot:
- If Postgres is unreachable, the server retries for up to 60 seconds, then exits with a non-zero status.
- If MinIO or PocketBase is unreachable, the server starts anyway. It sets up the collections and catches up on pending snapshots and notices once the service is reachable.

### Browser support and performance (DP-33, DP-42, DP-58)

Support current Chromium, Firefox and WebKit at 375 by 812, 768 by 1024 and 1280 by 800. Each screen is usable within three seconds of navigation. Server changes reach open pages within 2 seconds over one same-origin WebSocket per open page; its path and message format are yours to choose and it is not part of the public API. No page keeps a server-sent event stream (`text/event-stream`) or a long-poll request open. Fonts and icons are served by the app itself.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and the serve command starts the app without further manual steps.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package and every bundled font with its licence. Shipped packages are the production dependency tree, as reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package and font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or SIL OFL 1.1.
- IF-04: The app stores state only in the provided Postgres, MinIO and PocketBase. Add no other database, cache, queue or on-disk state store.
- IF-05: At runtime the app contacts no host except the three services. Fonts, icons and scripts are bundled.
- IF-06: A `package-lock.json` is committed, and the install command uses it (`npm ci`).
- IF-07: Leave the provided service configuration files in the workspace unedited.
- IF-08: The app ships no email-sending code or package.
- IF-09: All first-party server and client source is TypeScript. Plain JavaScript files are allowed only for tool configuration.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escape hatches for domain data.
- Names match this brief's domain terms: squad, eleven, bench order, captain, vice-captain, chip, free transfer, hit, selling price, ledger entry, deadline, lock, snapshot, receipt, event, standings.
- Each domain rule is decided in exactly one place in the source, including the squad rules, the shape rules, the selling price, the hit, the gameweek state transitions, scoring, auto-subs and the standings order. The UI renders the server's results rather than recomputing them.
- No abstraction has only one implementation, and there are no layers, wrappers or factories that exist only for possible future variation.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Every API error is built through one consistent error shape, with the codes in this brief.
- Money is handled as whole tenths everywhere and formatted only at display.
- There are no features, screens, endpoints or settings beyond this brief.
