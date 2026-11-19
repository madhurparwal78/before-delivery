# Ochre Kerb Kerbline

Kerbline is a browser racing game for people who race in short sessions on a break or in the evening and expect their car, upgrades and coins to still be there next time. Players use the keyboard to race on two maps in three kinds of event: three-lap circuits against AI, drift stages and time trials. They earn coins and spend them in a garage. They climb a two-league championship, race other players' verified ghosts on per-map leaderboards, and race one friend in a private online lobby. Every ranked time and every coin comes from the server replaying the run's inputs through the same small deterministic race model the browser uses. The server uses three services:
- **Postgres** holds accounts, garages, the coin ledger, runs, boards, the championship and lobbies.
- **MinIO** holds the stored input replay of every run. Ghosts and replay downloads read from it.
- **Mailpit** receives the sign-in link email that turns a guest garage into an account.

Out of scope: weather, day and night, paint, decals, body parts, damage, gamepads, key rebinding, telemetry, moderation, data export or deletion, rate limits, password or third-party sign-in, real-money payments, and any datastore other than these three services.

## Problem and users

People put hours into a car and a coin balance in browser racing games, then lose it. Some games roll progress back without a word after a dropped connection. Others keep the save in the browser, so it is gone when the cache clears. Leaderboards fill up with times no car could set, because the browser checks the score, and an honest time-trial player can never place. Upgrade economies are tuned for grinding, so a lost upgrade costs another hour of driving. Small studios lose players once those players stop trusting the board or the garage.

Kerbline fixes this:
- A lap counts only after the server replays it.
- Coins come only from replayed pickups and results.
- A purchase is either fully applied or not applied at all, and the screen never claims a purchase it has not confirmed.
- When replay storage is down, the game shows an honest held state and never rolls anything back without saying so.

The users:
- **Racer** (daily): races circuits, drift stages and time trials on both maps by keyboard, climbs the championship, earns coins, and keeps upgrades and balance across reloads and devices.
- **Ghost hunter** (weekly): climbs a map's time-trial board by racing other players' verified ghosts and downloading the exact input replay behind a time.
- **Lobby racer** (weekly): invites one friend to a private online lobby, fills the grid with AI, and watches the lobby, countdown and race positions update live without reloading.

## Journeys

1. **First race as a guest.** A new visitor with no session opens Kerbline in a desktop browser. They confirm their age, pick a starter car with the arrow keys and press Enter. The address bar shows the guided first race address and focus is in the HUD. They drive the one-lap race by keyboard while the HUD text shows lap, speed and coins. When they cross the line, the address becomes the run's results address. The Wi-Fi blips just then, so the browser quietly resends the same finish. The results screen says the run is being verified, then shows the verified time and the coins paid, once. After a reload, the garage balance is the opening balance plus that payout.
2. **A Stage 2 brake upgrade by keyboard.** A racer whose car has Stage 1 brakes opens the garage. Using only the keyboard, they move to the Brakes slot, open the upgrade, read the price and stat preview in the confirm dialog and press Enter. The connection drops before the answer arrives. The dialog says the purchase is not confirmed and changes nothing on screen. They press Check again, the server returns the one purchase it already made, and the Reference lap sweep plays once. Focus returns to the Brakes slot and the new balance is announced. After a reload, the pips, predicted lap and balance are unchanged.
3. **Managing the garage on a phone.** On a phone 375 pixels wide, a racer taps through the garage in one column, with the page links behind the Menu button. They buy a tire upgrade by touch, refit the engine to stock and get half its cost back. They open the Menu, go to the coin history, and see that the balance equals the sum of the paired movements.
4. **Spending from two tabs.** A racer has the garage open in two tabs. Each tab has an upgrade dialog open, each upgrade affordable alone but not both together. They buy in one tab. The other tab's open dialog switches to the not-enough-coins state with the exact shortfall. Both tabs show the new balance without a reload. They refit in the first tab, and the second tab's dialog offers the purchase again, which they then complete.
5. **Hunting a ghost.** A ghost hunter opens a shared link to the Saltflat Ring time-trial board, with its filters in the address. They flick the class filter through D, C and B, and see only the class B table. They download the replay behind the top time, choose that time as a ghost and race it, reading a live signed delta. They pause with Escape and leave the pause open while they take a call; nothing moves until they come back. They restart from the line, and nothing from the abandoned attempt ever shows up. When their own faster lap verifies, their single row moves up the open board and every rank and gap updates without a reload.
6. **Climbing the championship.** A racer enters Rookie league events from the championship ladder by keyboard. Two of their events verify at almost the same moment. Without a reload, the open championship page flips the Club league from locked to its points, and the garage's reference map gains Quarry Switchbacks. They have no class C car, so they accept the loaner for a Club event.
7. **Racing a friend.** A lobby racer creates a private lobby with one AI driver and sends the invite link. Their friend has no session yet. The friend opens the link, starts as a guest and lands back on the lobby. Both player lists update as each presses Ready. The friend un-readies during the countdown, which stops, and a fresh countdown starts when they ready again. The position tower changes as cars overtake. The friend drops and comes back inside the rejoin window.
8. **Saving the garage, and finishing during an outage.** A guest requests a sign-in link on their phone, opens the email and finds their garage moved into the new account. On another day replay storage is down. A run they finish shows the outage banner and a held result instead of a payout.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Guest start** A first-time visitor confirms they are 13 or older, picks one of the three starter cars from a keyboard-operable radio group and starts as a guest with the opening balance and that car.
- **DP-02 — Keyboard race with a readable HUD** On a screen at least 1,024 pixels wide the racer drives with the published keys, the race advances 60 steps per second of page time, and lap, position, speed, coins and lap results appear as text in the published regions, while narrower screens get the desktop notice instead of the race.
- **DP-03 — Guided first race paid after verification** A new guest who drives the one-lap guided first race to the line sees the verifying state and then the server's verified time and payout in the run result region, and after a reload the balance equals the opening balance plus that payout.
- **DP-04 — Upgrade purchase rules** Upgrades are bought one stage at a time at the published class prices, and the coin debit, the stage change and the reference lap result commit together or not at all, with any client-sent price, PI, stage outcome or balance ignored.
- **DP-05 — Keyboard upgrade dialog** A racer opens an upgrade from its slot, confirms it in a dialog that keeps Tab and Shift+Tab inside it, can cancel with Escape at no charge, buys with Enter, and after a confirmed purchase gets focus back on the same slot while the purchase is announced in the garage updates region.
- **DP-06 — Upgrades survive reload** After a purchase the slot's stage pips, the car's stats and PI and the coin balance show the committed values, and a reload or another device shows exactly the same values.
- **DP-07 — Reference lap result** Each upgrade purchase runs the published reference driver on the chosen map with the old and the new setup and stores the old and new predicted lap and the per-sector deltas with the purchase.
- **DP-08 — Reference lap sweep** After a confirmed purchase the setup sheet plays the Reference lap sweep in its published order and timing, no balance push moves the purchasing tab's visible balance before the sweep's balance step, and after a reload the sheet shows the committed result with no animation.
- **DP-09 — Reduced-motion readout** With reduced motion requested the sweep's end state appears at once, the old lap time stays struck through beside the new one, and the published summary is shown and announced.
- **DP-10 — Stage preview** Focusing or hovering an upgrade button previews the next stage on the setup sheet's stat bars, which extend to the preview values and retract back through the same values when the preview ends.
- **DP-11 — Garage breakpoints** The garage is one stacked column below 768 pixels wide, car and slots side by side from 768, and car, slots and setup sheet side by side from 1,280, with no sideways scrolling.
- **DP-12 — Touch garage on a phone** At 375 by 812 a racer chooses a car, buys and refits upgrades and reads the setup sheet by touch, with every control at least 44 pixels in both directions.
- **DP-13 — 3D car view** The garage shows the selected car as a live 3D view that turns slowly on its own, orbits when dragged, stops its idle turn under reduced motion, and falls back to a drawing with the published notice when WebGL 2 is missing.
- **DP-14 — Purchases never overdraw** Simultaneous purchases by one player apply one at a time, each succeeding only while the remaining balance covers it and the rest answering the insufficient-coins error, so two that each fit alone but not together give exactly one success and the balance never goes below zero.
- **DP-15 — Not enough coins across tabs** A racer who buys in two garage tabs at once, each purchase affordable alone but not together, sees one purchase succeed and the other tab switch to the published not-enough-coins state with the shortfall, both tabs show the new balance without a reload, and any open purchase dialog follows the live balance into and out of that state.
- **DP-16 — Purchases are idempotent** A purchase, car purchase or refit retried with the same idempotency key and body returns the stored response and changes nothing, a reused key with a different body is refused, and a double click buys once.
- **DP-17 — Refit to stock** A refit returns a system to stage 0 and refunds half of what that car paid for that system's stages, rounded down, ignoring any refund amount the client sends.
- **DP-18 — Paired coin ledger** Every coin movement is two entries that sum to zero, one on the player's wallet and one on the published counter account, and the balance always equals the sum of the wallet entries.
- **DP-19 — Coin history** The coin history screen lists every movement with its wallet and counter entries and shows the balance beside the ledger total, which always match, at every published viewport.
- **DP-20 — Replay stored before verification** A finished run's request body is stored as an object under its run id, and the run moves to verifying only after object storage confirms the object, as qualified in Business rules.
- **DP-21 — Server replay decides the result** Lap times, lap validity, drift score, coin pickups and race position come only from the server replaying the stored inputs through the published race model, and runs that cannot be replayed to an end are rejected with the published reason.
- **DP-22 — Payouts from verified runs** Coins for pickups, placings, the guided first race, drift scores, time-trial bests and online finishes are credited only when a run or race is verified, at the published amounts.
- **DP-23 — Finish retried once** Repeating a finish request with the same body records and pays the run once, the browser resends a finish that got no response with byte-identical bytes at least every 2 seconds until it is answered, and a different body for an already finished run is refused.
- **DP-24 — Results screen** The results screen shows the verifying state and then, without a reload, either the server's verdict with a lap table and a counted-up payout or the rejection reason with no payout.
- **DP-25 — Replay storage outage** While replay storage is unreachable a finished run is held, pays nothing and never reaches a board, the outage banner and held copy show, and the run resumes verification by itself once storage returns, as qualified in Business rules.
- **DP-26 — Ghost time trial** A ghost hunter picks a board time to race, and the time trial shows the ghost's label and a live signed delta as text, or races without the ghost and says so when its replay cannot be loaded.
- **DP-27 — Pause dialog** Escape opens a pause dialog that keeps focus inside it, Escape again resumes, and Restart puts the car back on the line at lap 1 within 2 seconds.
- **DP-28 — Replay download** Downloading the replay behind a board time returns the exact bytes the racer submitted together with their stored SHA-256 checksum.
- **DP-29 — Leaderboard rules** Each board for a map, mode and class lists only verified valid results, one best row per player in the published order, and never a rejected or held run.
- **DP-30 — Board filters in the URL** The board's map, mode, class and units live in the address, so reload, back and forward and a shared link show the same board, and units never change a time.
- **DP-31 — Live board** An open board gains a newly verified or improved result within 5 seconds without a reload, keeps one row per player with every rank and gap recomputed, shows the empty-board copy when it has no rows, and keeps the viewer's own row pinned in view at every published viewport.
- **DP-32 — Private lobby** A host creates a private lobby with an invite link, a second player joins through it, and a third player is refused with the full-lobby copy.
- **DP-33 — Live lobby race** Both players' lists, ready marks, the server's countdown and the position tower update in place without a reload, an un-ready or a drop during the countdown returns the lobby to waiting, and each page shows the server's state even when its device clock is wrong.
- **DP-34 — Rejoin window and finish grace** A dropped player shows as reconnecting until the server's rejoin window ends and can rejoin inside it, and after the first car finishes the others get the server's finish grace before the race closes.
- **DP-35 — League points and unlocks** Each championship event keeps the player's best points, and 50 league points complete a league, which unlocks the Club league and Quarry Switchbacks after Rookie and pays the finals reward once after Club.
- **DP-36 — Championship ladder** The championship screen shows both leagues, each event's best points and the league totals, works fully by keyboard, and after a reload shows any unlocked league and map.
- **DP-37 — Loaner car** Entering a class-limited event with no eligible owned car offers that class's loaner car, which races at half result coins.
- **DP-38 — Sign-in link email** Requesting a sign-in link sends one email with the published subject and sender to that address, and its link signs in once and expires after the configured time.
- **DP-39 — Guest garage into an account** Opening the link moves the guest garage into the account, or asks which garage to keep when both have progress, and an expired or used link shows its copy.
- **DP-40 — Sign-in mail outage** When the mail service is unreachable the sign-in request fails with the published copy and no link is issued.
- **DP-41 — Roadbook look** Every screen uses the cream roadbook page, the numbered left gutter, the ruled 12-column grid, one orange accent and right-aligned mono figures with signed deltas, as described in Visual design.
- **DP-42 — Accessible at three viewports** Garage, dealer, coin history, boards, championship and sign-in pass WCAG 2.2 AA automated checks with visible focus and no horizontal overflow at 375 by 812, 768 by 1024 and 1280 by 800.
- **DP-43 — Run manifest, health and grading routes** The app installs, builds and serves from the run manifest on the published port, answers the health check on every instance, and exposes grading routes only when they are enabled.
- **DP-44 — Credentials from the environment** Every service URL and credential is read from the environment at start, and none of them reaches the browser.
- **DP-45 — One shared race model** The browser race, ghosts and the server's verification use one deterministic race model in the source, with the published constants defined once.
- **DP-46 — Published landing routes** Starting as a guest, finishing a run, quitting a race and leaving a results screen each land on the published address with focus on the published element, and a guest start follows a next address only when it is a same-origin lobby path.
- **DP-47 — Collapsed navigation below 768** Below 768 pixels wide the four page links sit behind a Menu button and are unavailable to pointer, keyboard and assistive technology while collapsed.
- **DP-48 — Bounded replay files** The server verifies only replay files inside the published bounds, rejects every other file with the invalid-inputs reason while keeping its bytes stored as submitted, and answers every finish request within the published time.
- **DP-49 — Paused and restarted races keep their state** While the Paused dialog is open nothing in the race, the ghost or the HUD advances, and after a restart no timer or request from the abandoned run changes the page or submits a finish.
- **DP-50 — League totals stay true under concurrency** A league total always equals the sum of its event bests, and completion, unlocks and the finals reward happen exactly once and reach open pages without a reload, even when the runs that cross 50 points verify at the same moment.
- **DP-51 — Unconfirmed purchase** A purchase whose response never arrives leaves pips, stats, PI and balance unchanged with the published unconfirmed copy, Check again resends the same idempotency key and bytes so the purchase charges at most once and plays at most one sweep, and any answer other than success or insufficient coins closes the dialog and shows the committed garage, as qualified in Interactions.
- **DP-52 — Interrupted sweep** A purchase confirmed, a car or reference map change, or leaving the garage while a sweep plays makes that sweep jump to its end state at once, and nothing from the ended sweep changes the page afterwards.
- **DP-53 — Latest board filter wins** Only the board for the newest filters may render, any response for earlier filters is discarded, and a live push changes only the board on screen when it matches that board.
- **DP-54 — Runs and pushes stay with their player** Runs from different players that verify at the same moment each use only their own run's car, stages, layout, seed and inputs, and balance, run and championship pushes reach only the connections of the player they concern.

## Frontend

### Screens and layout (DP-02, DP-11, DP-12, DP-19, DP-31, DP-41, DP-42, DP-47)

Every screen sits on the roadbook page described in Visual design. A numbered left gutter of stage rules runs down the page. At 375 pixels wide the gutter becomes a numbered strip above the content. No screen scrolls sideways at 375 by 812, 768 by 1024 or 1280 by 800.

- **Page header** (every page shown to a session):
  - It holds the brand and the four page links: Garage, Leaderboards, Championship and Online lobby.
  - From 768 pixels wide the links sit inline.
  - Below 768 pixels the Menu button replaces the links. Expanding Menu opens a panel directly below the header, above the page content, with the four links stacked in that order.
  - The guest start page, and the sign-in pages opened without a session, show the brand only.
- **Guest start** (`/` with no session): the age confirmation, the starter car choice and the start button, stacked in one column at every width.
- **Garage** (`/garage`, the home screen once a session exists):
  - A header holds the coin balance, the car picker, the reference map picker and the speed units choice.
  - Below the header are three regions:
    - **Car**: the 3D view or its drawing, plus the car name, class and PI.
    - **Upgrade slots**: the four systems, each with its stage pips and its upgrade and refit buttons.
    - **Setup sheet**: the stat bars, the Reference lap figure with the track outline, the sector chips, the predicted lap and the cost of the last upgrade.
  - Layout:
    - below 768 pixels wide, including 375: one column, in the order Car, Upgrade slots, Setup sheet;
    - from 768 to 1,279 pixels wide, including 768: Car and Upgrade slots side by side in the first row, with the Setup sheet across the full width below;
    - from 1,280 pixels wide: Car, Upgrade slots and Setup sheet side by side in one row, in that order from left to right.
- **Dealer** (`/garage/dealer`): the six cars as ruled cells, each showing class, PI, stats, and either its price with its buy button, `Owned`, or, for a starter car the player does not own, `Starter only` with no buy button. One column below 768 pixels, two columns from 768, three from 1,280.
- **Coin history** (`/garage/coins`): the coin totals and the coin history table, newest movement first. All four columns stay visible at 375 pixels and wrap inside their cells.
- **Race** (the race address from Interactions): the WebGL race view across the top, with the HUD to its right. Below 1,024 pixels wide, the desktop notice and a link back to the garage replace the race view and HUD.
- **Results** (`/runs/<runId>`): the `Run result` heading, the run result region, the laps table, the payout figure, the link back to the garage and, for event runs, the link back to the championship.
- **Leaderboards** (`/boards`): the filters in one row (stacked below 768 pixels), the leaderboard table and the pinned "Your time" region. Below 768 pixels the table hides its Car and Top speed columns.
- **Championship** (`/championship`): the two leagues as ruled cells containing their events, stacked below 768 pixels and side by side from 768. Each event is a **map card**: a ruled cell with the event name, its map's name, its points and its map's track outline.
- **Online lobby** (`/lobby/new` and `/lobby/<lobbyId>`): the lobby status, invite link, player list and Ready button. Once racing starts, the race view, the HUD and the position tower appear. Below 1,024 pixels wide, the lobby page shows the desktop notice instead of the race.
- **Sign-in** (`/sign-in` and `/sign-in/<token>`): the email form, the sign-in status and the keep-which-garage dialog, in one column at every width.

### Public screens and controls (DP-01, DP-02, DP-05, DP-13, DP-15, DP-19, DP-24, DP-26, DP-27, DP-30, DP-31, DP-32, DP-33, DP-36, DP-37, DP-38, DP-39, DP-46, DP-47, DP-50, DP-51)

Only the controls and regions below are public. Placeholders in visible copy and accessible names are defined in the placeholder list in Feedback states. Address placeholders (`<runId>`, `<lobbyId>`, `<token>`, `<layoutId>`, `<eventId>`, `<mode>`) are the ids named in Interactions and the API.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| Every page | `alert` (outage banner) | the replay storage outage banner, only while storage is unavailable |
| Every page shown to a session | `link "Garage"`, `link "Leaderboards"`, `link "Championship"`, `link "Online lobby"` | same text; below 768 pixels only inside the expanded Menu panel |
| Every page shown to a session, below 768 pixels | `button "Menu"`, reporting expanded or collapsed and naming the panel it controls | `Menu` |
| Guest start | `checkbox "I am 13 or older"` | same text |
| Guest start | `radiogroup "Starter car"` with `radio "Kestrel Hatch"`, `radio "Wren Coupe"`, `radio "Moth Roadster"` | car name, class, PI |
| Guest start | `button "Start racing"` | same text |
| Guest start | `alert` (field error) | the age error copy |
| Race | `img "Race view"` | the WebGL canvas |
| Race | `region "Race HUD"` (focusable) | `Lap <lap>/<laps>`, `Position <p>/<cars>` (circuit and online), `<speed> km/h` or `<speed> mph`, `Coins <coins>` (practice and circuit), `Drift <score>` and `Stage time <seconds>` (drift), `Ghost: <name>` and `Delta <delta>` (with a ghost), and `Press Enter to start` before the start |
| Race | `status "Race updates"` | lap-complete copy |
| Race | `button "Pause"` | same text |
| Race | `dialog "Paused"` with `button "Resume"`, `button "Restart"`, `button "Quit to garage"` | same text |
| Race | desktop notice | the desktop notice copy |
| Results | `heading "Run result"` (receives focus on arrival) | `Run result` |
| Results | `status "Run result"` | verifying, verified, held or rejected copy |
| Results | `table "Laps"` | columns `Lap`, `Time`, `Status` (`Valid` or `Invalid`); drift runs add a `Score` row |
| Results | `figure "Payout"` | `+<coins> coins`, counted up |
| Results | `link "Back to garage"`, and for event runs `link "Back to championship"` | same text |
| Garage | `status "Coin balance"` | `<balance> coins` |
| Garage | `combobox "Car"` | owned car names |
| Garage | `combobox "Reference map"` | `Saltflat Ring`, plus `Quarry Switchbacks` once unlocked |
| Garage | `radiogroup "Speed units"` with `radio "km/h"`, `radio "mph"` | same text |
| Garage | `region "Car"` containing `img "<Car name>, 3D view"` or `img "<Car name>, drawing"` | car name, class, PI; the WebGL notice when falling back |
| Garage | `region "Upgrade slots"` containing `group "<System>"` | per slot: `img "Stage <n> of 3"` (the pips), `button "Upgrade <System> to stage <n>"` while below stage 3, `button "Refit <System> to stock"` while above stage 0 |
| Garage | `region "Setup sheet"` containing `meter "Acceleration"`, `meter "Braking"`, `meter "Top speed"`, `meter "Grip"`, `meter "Lane change"` | each meter's visible value and `aria-valuetext` use its format: Acceleration and Braking with one decimal and ` m/s²` (for example `4.0 m/s²`); Top speed as `<speed> km/h` or `<speed> mph` per the speed units setting; Grip as a whole number and `%` (for example `100%`); Lane change as a whole number and ` steps` (for example `30 steps`). Each meter's `aria-valuenow` is the number in its stored unit |
| Garage | `figure "Reference lap"` containing `img "Reference marker"` | the track outline, chips `S1`, `S2`, `S3` (after the sweep they read `S1 <delta>`, `S2 <delta>` and `S3 <delta>`), `Predicted lap <time>` with the old time as struck-through text, `Cost −<price> coins`, the summary |
| Garage and Dealer | `status "Garage updates"` | purchase, refit, car purchase and garage refresh announcements |
| Garage | `dialog "Confirm upgrade"` with `button "Buy for <price> coins"` (or `button "Check again"` while unconfirmed), `button "Cancel"` | system, stage, price, stat changes, the PI warning when it applies, the not-enough-coins state, the unconfirmed copy |
| Garage | `dialog "Confirm refit"` with `button "Refit and refund <refund> coins"`, `button "Cancel"` | system and refund |
| Garage | `link "Coin history"`, `link "Dealer"`, `link "Save my garage"` (guests only) | same text |
| Dealer | `button "Buy <Car name> for <price> coins"` (cars with a price that the player does not own) | same text |
| Dealer | `dialog "Confirm car purchase"` with `button "Buy for <price> coins"` (or `button "Check again"` while unconfirmed), `button "Cancel"` | car, price, the not-enough-coins state, the unconfirmed copy |
| Coin history | `region "Coin totals"` | `Balance <balance> coins` and `Ledger total <total> coins` |
| Coin history | `table "Coin history"` | columns `When`, `Movement`, `Wallet`, `Counter account`; the Wallet cell is a signed amount, the Counter account cell is the account name and its signed amount |
| Leaderboards | `combobox "Map"`, `combobox "Mode"`, `combobox "Class"` | `Saltflat Ring` / `Quarry Switchbacks`; `Time trial` / `Circuit` / `Drift`; `D` / `C` / `B` |
| Leaderboards | `radiogroup "Units"` with `radio "km/h"`, `radio "mph"` | same text |
| Leaderboards | `table "Leaderboard"` | columns `Rank`, `Driver`, `Car`, `Time` (`Score` for drift), `Gap`, `Top speed`, `Replay`; `Rank` is the row's `rank`; `Gap` is `<delta>` from the row's `gapMs`, empty for the first row and for drift; the viewer's row marks the driver `You` |
| Leaderboards | per row `button "Race this ghost"` (time trial, 1,024 pixels wide and up) and `link "Download replay"` | same text |
| Leaderboards | `region "Your time"` | the viewer's rank and time, or nothing when the viewer has no row |
| Leaderboards | empty board | the empty-board copy |
| Championship | `region "Rookie league"`, `region "Club league"` | `<points> / 50 points`, `Complete`, the locked copy, the trophy copy |
| Championship | `button "Enter <Event name>"` | same text, plus `<points> pts` beside each event |
| Championship | `status "Championship updates"` | the league completion announcements |
| Championship | `dialog "Loaner car"` with `button "Race the loaner"`, `button "Cancel"` | the loaner copy |
| Lobby | `combobox "AI drivers"`, `button "Create private lobby"` | `0`, `1`, `2` |
| Lobby | `textbox "Invite link"` (read only), `button "Copy invite link"` | the full invite address |
| Lobby | `button "Join lobby"`, `button "Ready"` | same text; Ready reads `Not ready` while the player is ready, and pressing it then un-readies |
| Lobby | `status "Lobby status"` | the lobby status copy |
| Lobby | `list "Players"` | one item per player: name and `Ready`, `Not ready` or the reconnecting copy |
| Lobby | `list "Positions"` | items `<position>. <name>`, in position order, with `DNF` for players who did not finish |
| Lobby | full-lobby message | the full-lobby copy |
| Sign-in | `textbox "Email"`, `button "Send sign-in link"` | same text |
| Sign-in | `status "Sign-in status"` | sent, signed-in, expired and mail-outage copy |
| Sign-in | `alert` error summary with `link "Enter a valid email address."` pointing at the Email field | the email field error |
| Sign-in | `dialog "Keep which garage?"` with `button "Keep this device's garage"`, `button "Keep my account's garage"` | the coin balance and car count of each garage |

### Interactions (DP-01, DP-02, DP-05, DP-10, DP-12, DP-13, DP-15, DP-16, DP-23, DP-26, DP-27, DP-30, DP-31, DP-33, DP-36, DP-39, DP-46, DP-47, DP-49, DP-51, DP-53)

#### Keyboard everywhere

- Tab follows reading order on every screen, and every action has a keyboard path.
- Every open dialog keeps Tab and Shift+Tab inside it: Tab from the last control goes to the first, and Shift+Tab from the first goes to the last.
- Escape closes every dialog, and focus returns to the control that opened it, except where a step below says otherwise.

#### Addresses and landing

Every action below lands on its address with focus on the named element.

- **Race address.** A race address is exactly `/race?layout=<layoutId>&mode=<mode>`, then `&event=<eventId>`, `&laps=<n>` and `&ghost=<runId>` when they apply, in that order and with no other keys.
  - `<mode>` is `practice`, `circuit`, `drift` or `time-trial`.
  - `event` is present for championship events and the guided first race.
  - `ghost` is present when racing a ghost.
  - `laps` is present only when a run without an event uses a lap count other than its mode's default. No on-screen control produces it, but an address carrying it is honoured.
  - Opening or reloading a race address starts a new run for exactly what it names, in the garage's selected car. For an event that offers a loaner (see Business rules), the run uses the loaner.
- **Start racing.** Without a valid `next`, Start racing lands on `/race?layout=saltflat-ring&mode=practice&event=guided-first-race` with focus on `region "Race HUD"`.
- **Next address.** The guest start page opened as `/?next=<path>` follows `<path>` only when the value, after URL decoding, is `/lobby/` followed by one or more letters, digits, `-` or `_` and nothing else.
  - In that case Start racing lands on that path with focus on `button "Join lobby"`.
  - Every other value is ignored and Start racing lands on the guided first race. This includes absolute addresses, addresses starting with `//`, encoded slashes that decode to `//`, `/garage` and any other path.
- **Session redirects.**
  - Opening `/lobby/<lobbyId>` with no session redirects to `/?next=/lobby/<lobbyId>`.
  - Opening `/` with a session lands on the `next` path when the next-address rule accepts it, and otherwise on `/garage`.
  - Opening any other page with no session lands on exactly `/`. The sign-in pages are the exception: they open without a session.
- **Finish.** On the step a run reaches its end, the browser sends the finish request and replaces the race address in history with `/runs/<runId>`, so Back does not return to the race. Focus goes to `heading "Run result"`.
  - If the finish request gets no HTTP response (the connection fails or times out), the browser resends the byte-identical body to the same address at least every 2 seconds until any HTTP response arrives.
  - It never re-serialises the inputs.
  - The results page shows the verifying copy meanwhile.
- **Quit to garage** lands on `/garage` with focus on `link "Garage"` and sends no finish request.
- **Results links.** `Back to garage` goes to `/garage`. `Back to championship` goes to exactly `/championship` and puts focus on that event's `Enter <Event name>` button.
- **Board and championship entries.**
  - Race this ghost opens `/race?layout=<layoutId>&mode=time-trial&ghost=<runId>`.
  - An event's Enter button opens `/race?layout=<layoutId>&mode=<mode>&event=<eventId>`.
  - On arrival, focus is on `region "Race HUD"`.

#### Guest start

- Arrow keys move the selection within the starter car radio group, and Space checks the age box.
- Enter on Start racing, or Enter anywhere in the form, submits.
- If the age box is not checked, the field error appears and focus moves to the checkbox.

#### Driving

- These keys work whichever control on the race screen has focus, and they never activate the focused button:
  - Up arrow or W is throttle.
  - Down arrow or S is brake.
  - Space is drift.
  - Escape pauses.
  - Left arrow or A requests the lane one to the left of the lane currently requested. Right arrow or D requests the lane one to the right. At the outer lane, that key does nothing. The input the browser records is always the absolute lane.
- A held key holds its input, and releasing it ends that input.
- Before the start the HUD shows its start prompt, and Enter starts the race.
- The race model advances 60 steps per second of page time, driven by the page's own clock and timers. So a paused page clock pauses the race, and advancing it drives the race.

#### Pause

- Escape or the Pause button opens the Paused dialog with focus on Resume.
- When the page becomes hidden (switching tabs or minimising the window), the Paused dialog opens by itself.
- **While Paused is open**, however long it stays open:
  - The player car, the ghost car, the HUD text, `Race updates` and the race view's picture stay exactly as they were.
  - The dialog stays open with focus inside it.
  - A ghost replay that is still loading keeps loading. If it finishes while paused, the HUD's ghost label switches to the ghost's name. That is the only HUD change allowed, and the ghost does not move.
- **Resume** (or Escape) closes the dialog and continues from the exact paused step. The delta keeps the value it showed before the pause until the next step.
- **Restart** starts a new run for the same race address within 2 seconds.
  - The HUD shows its start state: lap 1, speed zero, a zero delta when a ghost is set, and the start prompt.
  - Every timer, live listener and in-flight request of the abandoned run is discarded. No lap announcement, delta update or finish request from the abandoned run ever appears afterwards.
  - Exactly one new run is created.
- **Quit to garage** leaves as stated under Addresses and landing.

#### Ghost

- The browser loads the ghost's replay and run summary, and drives the ghost car through the same race model alongside the player, without colliding.
- While racing, the HUD delta updates at least 4 times per second.
- The delta is the player's elapsed time at their current distance, minus the ghost's elapsed time when it reached that same distance in the same lap.

#### Menu below 768 pixels

- The panel is collapsed by default on every page load.
- While collapsed, the four page links are not in the accessibility tree, not reachable by Tab and not hit by taps or clicks. Moving the links out of view or making them transparent does not count as collapsed.
- Activating Menu expands the panel, reports it as expanded and moves focus to `Garage`.
- Escape, or Menu again, collapses the panel and returns focus to Menu.
- Choosing a link navigates there, and the new page starts collapsed.
- Opening any dialog collapses the panel first.
- Widening the window to 768 pixels or more shows the links inline and removes the Menu button. From 768 pixels up there is no Menu button.

#### Upgrading and buying a car

Confirm upgrade and Confirm car purchase behave the same way. Only Confirm upgrade plays the sweep.

- **Opening.** Activating `Upgrade <System> to stage <n>` opens Confirm upgrade, and activating `Buy <Car name> for <price> coins` opens Confirm car purchase.
  - Focus goes to the Buy button, or to Cancel when the not-enough-coins state shows.
  - Escape or Cancel closes the dialog with no charge and returns focus to the opener.
- **Purchase attempts.** A purchase attempt starts when Buy is pressed in the buy state. It covers that request and every Check again after it. It ends at the first HTTP response of any status, or when the dialog closes. A request that gets no HTTP response at all does not end it.
  - Every request of one attempt uses one idempotency key and one byte-identical body, so a double click, or a retry, buys once.
  - Each new attempt generates a new idempotency key. A key whose attempt has ended is never sent again.
- **Buying.**
  - Enter buys.
  - The Buy button disables on the first press, and the dialog is pending until an HTTP response arrives.
- **Confirmed** (a `201` response):
  - The dialog closes.
  - For an upgrade, focus goes to the same slot's upgrade button, which now offers the next stage, or to its refit button when the slot reached stage 3.
  - For a car, focus goes to the bought car's cell.
- **Insufficient coins** (a `402` response): the attempt ends, and the dialog stays open and switches to the not-enough-coins state. The tab re-reads `GET /v1/garage` and shows the shortfall from that balance. When the dialog later returns to the buy state, the next press of Buy starts a new attempt with a new idempotency key.
- **Unconfirmed** (no HTTP response at all):
  - The dialog stays open, its text becomes the unconfirmed copy from Feedback states, and the Buy button is replaced by `button "Check again"` with focus on it.
  - Pips, meters, PI, the setup sheet, the slots and the Coin balance region do not change.
  - Check again resends the byte-identical body with the same `Idempotency-Key`. Its answer is handled exactly like the first request's: confirmed, insufficient coins, any other answer, or unconfirmed again.
  - A replayed `201` plays the sweep once and steps the balance down once.
- **Any other answer** (any HTTP response other than `201` or `402`, to the first request or to a Check again; for example `409 STAGE_OUT_OF_ORDER` after the same slot was bought in another tab, `409 ALREADY_OWNED`, `403 LAYOUT_LOCKED`, `422` or any `5xx`):
  - The attempt ends and its key is never sent again.
  - The dialog closes. The garage re-reads `GET /v1/garage` and shows the committed values at once, with no sweep.
  - Garage updates makes the refresh announcement.
  - Focus goes as stated under Closing while unconfirmed.
- **Closing while unconfirmed.** Cancel or Escape on an unconfirmed dialog closes it.
  - The garage re-reads `GET /v1/garage` and shows the committed values at once, with no sweep, even when the purchase had committed.
  - Focus goes to that slot's upgrade button (its refit button at stage 3, as the re-read shows). For a car purchase it goes to the car's cell when the re-read shows the car owned, and otherwise back to its dealer button.
  - Garage updates makes the refresh announcement.
- **Pages only change from confirmed answers.** Pips, meters, PI, the setup sheet and the visible balance change only from a confirmed purchase response, a garage read or an applied balance push. They never change from the press itself.
- **Held balance pushes.** While this tab has a purchase pending or unconfirmed, a balance push it receives changes nothing on screen.
  - Held pushes are applied when the purchase resolves.
  - If it resolves with a sweep, they reach the Coin balance region at sweep step 4 (see Motion and effects).
  - If it resolves with no sweep (insufficient coins, any other answer, closing, or a car purchase), they apply at once.
- **The dialog follows the live balance.** While Confirm upgrade or Confirm car purchase is open and neither pending nor unconfirmed, every balance the tab learns of re-evaluates the dialog within 2 seconds. Here, "a balance the tab learns of" means one from a purchase response, a garage read or a push, including pushes that arrive while a sweep holds the Coin balance region.
  - When the balance drops below the price, the dialog switches to the not-enough-coins state with the shortfall from that latest balance, and focus moves to Cancel.
  - When a later balance covers the price again, the dialog switches back to the buy state. The not-enough-coins heading and the shortfall line disappear, the Buy button returns enabled, and focus stays on Cancel. Pressing Buy then starts a new attempt with a new idempotency key.
  - The shortfall always uses the latest balance.

#### Stage preview

- While an upgrade button has focus or the pointer, the setup sheet's stat bars extend to the next stage's values.
- Each affected meter's `aria-valuetext` reads `<current> → <preview>`, both in that meter's format from Public screens and controls (for example `8.0 m/s² → 9.5 m/s²`).
- When focus or the pointer leaves, the bars retract to the current values.

#### Refit

`Refit <System> to stock` opens Confirm refit. Enter refits, focus returns to the slot's upgrade button, and the refit is announced.

#### Touch

- At 375 pixels wide, every garage, dealer, coin history, boards, championship, sign-in and Menu control works by tap, with no hover needed.
- Dialogs fill the screen width.
- Dragging on the 3D car view orbits the car around its vertical axis, also with reduced motion.
- Dragging never scrolls the page sideways.

#### Live updates

Every open tab of a player applies the live pushes from the API:
- **Balance.** A balance change from any tab or any verified run reaches the Coin balance region, the slots and any open dialog within 2 seconds, without a reload. The exceptions are the held pushes above and the sweep's balance step in Motion and effects.
- **Championship.** Changes update the league regions and announce completions within 2 seconds. A Club unlock adds `Quarry Switchbacks` to `Reference map` in every open garage tab.

#### Boards

- Changing Map, Mode, Class or Units updates the table in place and pushes a new address. Back and forward restore the earlier filters and table. Opening or reloading an address shows the board it names.
- **Newest filters win.** Each filter change, Back or Forward makes the board for the newest filters the only board that may render.
  - The table shows the loading copy until the response for those filters arrives.
  - A response for any earlier filter set is discarded when it arrives and never draws a row, even if it arrives last.
  - Units alone never refetch a board. They only change how top speeds read.
- **Pushes.** A `board` push applies only when its `layoutId`, `mode` and `class` equal the filters on screen.
  - A matching push that arrives while that board is loading is applied as soon as it renders.
  - A push for a board the viewer has left never inserts, moves or changes a row.
  - A push carrying the row of a player already on the board replaces that row and moves it to its new place, so a player never has two rows.
  - In the same paint, every `Rank` cell is renumbered from 1 in table order, every `Gap` is recomputed against the new first row, and `Your time` updates when the row is the viewer's.
  - A row that falls outside the top 50 leaves the table.

#### Lobby

- Create private lobby makes the lobby and shows its invite address.
- Opening the invite address with a session shows Join lobby. Without a session, the visitor goes through guest start as stated under Addresses and landing.
- Ready toggles by Enter or Space, both while the lobby is waiting and during the countdown.
- The lobby status, player list, ready marks, countdown and position tower change only from the server's messages. The device clock may be wrong, so the page never computes a countdown, cancellation, rejoin window or grace period from it.
- During the race, the driving keys send the player's key state to the server on every change.
- Reloading the lobby page reconnects the same player.

#### Championship

Each event's Enter button opens the race for that event. When the player owns no eligible car for the event's class, it opens the Loaner car dialog instead, and Race the loaner opens the event's race address.

#### Sign-in

- Send sign-in link submits the email.
- Opening the emailed link finishes sign-in on that page.
- When a choice is needed, the Keep which garage? dialog opens with focus on its first button and cannot be dismissed with Escape. Choosing a garage closes it, signs in and shows the signed-in copy.

### Visual design (DP-41, DP-42)

- **Colour roles.**
  - The page is a warm cream paper colour, with near-black ink for text and rules.
  - One safety-orange accent is kept for the live action only (the primary button on each screen, the player's car, the reference marker) and for the coin balance.
  - A deep forest green marks time or coins gained, and a brick red marks time or coins lost. Green and red always come with a signed figure, so nothing relies on colour alone.
  - All text and control boundaries meet WCAG 2.2 AA contrast on the cream page.
- **Type.**
  - Headings use a tall, narrow, condensed sans with the engineered feel of motorsport signage.
  - Body text uses a plain, sturdy humanist sans.
  - Every time, delta, speed, PI and coin figure uses a monospaced face with equal-width digits, so columns of numbers line up.
  - Each heading level is about one third larger than the level below it, and the page title is about two and a third times body size.
- **Density.** Compact: tight rows in tables, short gaps between ruled cells, and small labels above values. Even so, every tappable control is at least 44 pixels tall and wide.
- **Composition.** Pages follow a rally roadbook.
  - A numbered left gutter of stage rules (`01`, `02`, `03` with short labels such as `Car`, `Slots`, `Setup`) runs down every page beside the sections it numbers.
  - Maps and cars sit in a rigid 12-column grid of thin ruled cells.
  - Map cards are the championship event cells described in Screens and layout. Every map card carries small tulip-diagram corner glyphs, drawn from the map's corners. These are line drawings of a junction with an arrow, as in a rally route book.
  - Times always align right, in the mono face, with a signed delta beside them.
- **Formats.**
  - Race times show as minutes, seconds and milliseconds (`m:ss.mmm`).
  - Deltas use a true minus sign or a plus, three decimals and ` s`.
  - Coins use thousands separators.
- **Focus.** Every focusable control shows a clearly visible focus ring in ink, at least two pixels thick and set slightly apart from the control, at all three viewports.
- **Car and track art.**
  - Cars in the 3D view and race view are built in code from simple solid shapes (body, cabin, four wheels) in the cream, ink and accent palette.
  - Tracks are flat ribbons with ruled kerbs.
  - Track outlines on map cards and in the Reference lap figure are line drawings made from each layout's published segments.
  - No downloaded models, photos or textures appear anywhere.

### Motion and effects (DP-08, DP-09, DP-10, DP-13, DP-24, DP-31, DP-52)

All motion follows one feel: it starts quickly and settles gently into place.

- **Dialogs** fade in and rise slightly over about a fifth of a second, and close faster than they open.
- **Menu panel** opens and closes at once, with no animation.
- **Payout count-up.** Once the verdict arrives on the results screen, the Payout figure counts up from zero to the payout over about 0.8 seconds.
- **Board arrival.** A newly arrived or moved board row slides into its place, and its row background fades from a pale accent tint to the page colour over about one second.
- **Stage preview.** The bars extend to the preview values over about a quarter second. When the preview ends, they retract over about a quarter second, passing back through the same intermediate lengths in reverse.
- **3D car view.** While idle, the selected car turns about its vertical axis on a ruled floor, once every 20 to 40 seconds. Dragging orbits it, and it resumes turning about 2 seconds after the drag ends. Its frame rate never blocks the page.

#### Reference lap sweep (signature)

The sweep starts when a confirmed upgrade response arrives (a first `201`, or a replayed `201` from Check again) and plays in this order:
1. The reference marker runs along the track outline in the Reference lap figure, from the start line to the finish line, over 1.2 seconds. It starts fast and eases into the finish.
2. Behind the marker, the ribbon re-colours sector by sector: green where the new setup gains time, red where it loses time, and ink where nothing changed.
3. As the marker passes one third, two thirds and the full length of the outline, chip S1, then S2, then S3 flips from its plain label to its signed delta. Each flip takes about a quarter second.
4. About a quarter second after the marker arrives, the predicted lap numerals count down from the old time to the new one, and the visible coin balance counts down to the purchase response's balance. Each takes about a quarter second, and both reach their new values no later than 1.7 seconds after the sweep starts. The old time then stays beside the new one, struck through.
5. The slot's stage pips fill, finishing within 2 seconds of the sweep's start.
6. Garage updates makes its purchase announcement.

**Balance during the sweep.**
- In the purchasing tab, no balance push changes the visible balance before step 4. That includes the push for this purchase (matched by its purchase id), pushes held while the purchase was pending or unconfirmed, and pushes arriving during the sweep. Until step 4, the Coin balance region keeps showing the balance from before the purchase.
- Pushes for other movements are applied right after step 4.
- Other tabs apply every push at once.
- Across a purchase, the visible balance only ever shows the balance before the purchase and then the newer values. It never shows an intermediate value twice, and it never rises during the countdown.

**Interrupted sweep.** While a sweep is playing, any of the following ends it at once:
- another confirmed purchase response arrives in this tab, on any slot;
- the `Car` or `Reference map` choice changes;
- the garage is left.

When a sweep ends early, everything it would still do applies immediately: ribbon colours, chip deltas, predicted lap with the old time struck through, the balance step, the pips and its Garage updates announcement. Only after that does the next purchase's sweep, if any, start, counting from the ended sweep's end state. Rules for the ended sweep:
- No timer, frame callback or count-up from it ever changes the page afterwards.
- A purchase announcement from it comes before the next purchase's announcement and is never repeated.
- After a car change, the setup sheet shows the newly selected car's committed reference result at once and never any part of another car's sweep.

**After a reload,** or when the garage opens later, the figure shows the committed ribbon colours, chip deltas, predicted lap with the old time struck through, cost, pips and balance at once, with no animation.

#### Other motion

- **Race view.** The race canvas draws the track, the player's car, any AI cars and the ghost (a translucent outline car). It changes every step while the race runs and stays still while paused. A camera follows behind the player's car.
- **No other loops.** Nothing else moves on its own: no spinners, pulsing badges, shimmer or looping backgrounds. Pending states are text.
- **Reduced motion.** When the device asks for reduced motion:
  - The sweep shows its end state at once: no marker travel, no chip flips and no counting. The ribbon, chips, predicted time, balance and pips go straight to their final values, and held pushes apply in the same paint. The old lap time stays struck through next to the new one, the summary appears as text in the Reference lap figure, and Garage updates announces the purchase with the same summary.
  - The payout appears at once.
  - The 3D car does not turn on its own, but dragging still orbits it.
  - Board rows appear and move without sliding or fading.
  - Dialogs appear and close at once.
  - Stage preview bars jump straight to their preview and current values.

  Racing itself keeps its motion, because the race is the content.
- **Without WebGL 2.**
  - The 3D car view becomes a still line drawing of the car's side profile, with the WebGL notice beneath it.
  - The race view becomes a top-down outline of the track with dots for the cars, still driven by the same race model and HUD.

### Feedback states (DP-03, DP-05, DP-09, DP-15, DP-24, DP-25, DP-26, DP-31, DP-32, DP-33, DP-34, DP-36, DP-37, DP-38, DP-39, DP-40, DP-50, DP-51)

All copy below renders character for character: straight apostrophes, the true ellipsis `…` and the true minus sign `−`. Every announcement built from it carries the same characters.

**Placeholders**, each defined once here. Every whole number below is written in plain digits with no sign, and with thousands separators only where stated.

*Times and deltas*
- `<time>` and `<lapTime>`: race times as `m:ss.mmm` (for example `0:43.217`).
- `<delta>`: a signed duration as `−` or `+`, three decimals and ` s` (for example `−0.412 s`). Zero prints as `0.000 s` with no sign.
- `<seconds>`: the whole seconds left on the drift stage timer, ceil((5,400 − steps completed) / 60). It reads `90` before the start and counts down to `0`.
- `<speed>`: m/s × 3.6 for km/h, or m/s × 2.23694 for mph, rounded to a whole number.

*Coins, points and scores*
- `<coins>`, `<balance>`, `<price>`, `<refund>`, `<shortfall>` and `<total>`: whole coin amounts with thousands separators.
  - `<shortfall>` is the price minus the latest balance the tab knows.
  - In the HUD, `<coins>` is the value of the coins collected so far in this run.
- `<points>`: whole championship points, a league's total or an event's best, with no separators.
- `<score>`: a drift score as a whole number with thousands separators (for example `12,480`). In the HUD it is the score so far in this run.
- `<result>`: `<time>` for practice, circuit and time trial (the best valid lap for time trial, the race time otherwise), or `<score> pts` for drift.

*Laps and positions*
- `<lap>`: the lap the player is on, counted from 1. It stays at `<laps>` once the last lap ends.
- `<laps>`: the run's lap count.
- `<p>`: the player's current race position.
  - While racing, cars rank by laps completed and then distance into the current lap, with ties going to the player.
  - A car that has finished ranks by finish time, ahead of every car still racing.
- `<cars>`: the number of cars in the race. In a circuit run that is the player plus the AI drivers (3). In a lobby it is the humans plus the AI drivers.
- `<position>`: a whole race position from 1, as in `<p>`.

*Names and labels*
- `<name>`: a player's or AI driver's name, as in the API.
- `<Car name>`: a car name from the cars table (for example `Halcyon RS`).
- `<Event name>`: an event name from the championship list (for example `Rookie Circuit`).
- `<class>`: a car class letter, `D`, `C` or `B`.
- `<pi>`: the car's PI after the upgrade.
- `<limit>`: the top PI of the car's class (299, 499 or 699).
- `<System>`: the capitalised system name, one of `Engine`, `Tires`, `Brakes` or `Suspension`.
- `<sector>`: `S1`, `S2` or `S3`.
- `<n>`: a whole number, as given by its row.
- `<email>`: the address as typed.

*Reference lap*
- `<summary>`: `<delta>, mostly <sector>`.
  - `<delta>` is the new predicted lap minus the old one.
  - `<sector>` is the sector with the largest change, with ties going to the earlier sector.
  - When the lap change is zero, the summary is `No change on the reference lap`.

| Action | Region | Pending | Success | Error | Outage |
|---|---|---|---|---|---|
| Guest start | `alert` | button disabled, text `Starting…` | lands as stated in Interactions | `Confirm you are 13 or older to play.` | none |
| Lap completed | `status "Race updates"` | none | `Lap <n>: <lapTime>`, where `<n>` is the completed lap; for an invalid lap `Lap <n>: <lapTime>, invalid` | none | none |
| Finish and verification | `status "Run result"` | `Verifying run…` while the finish is being sent or resent and while the run is `submitted` or `verifying` | `Verified: <result>, +<coins> coins`, where `<coins>` is everything the run paid | rejected copy by reason: `did_not_finish` → `Rejected: the replay did not reach the finish.`; `seed_mismatch` → `Rejected: the run's seed did not match.`; `invalid_inputs` → `Rejected: the inputs could not be read.` | `Held for verification` while the run is `held`, plus the outage banner |
| Replay storage status | `alert` on every page | none | none | none | `Replay storage is unavailable. Runs are held and will verify when it returns.` |
| Ghost load | `region "Race HUD"` | `Ghost: loading` | `Ghost: <name>` | `Ghost unavailable. Racing without it.` | the same copy |
| Upgrade purchase | `status "Garage updates"` | Buy button disabled, text `Buying…` | `<System> stage <n> fitted. Balance: <balance> coins. <summary>` | in the dialog: heading `Not enough coins` and text `You need <shortfall> more coins.` | none |
| Unconfirmed purchase (upgrade or car) | dialog text | none | none | `We couldn't confirm the purchase. Nothing changes here until it is confirmed.` | none |
| Garage refreshed (an unconfirmed dialog closed, or a purchase answered with anything other than `201` or `402`) | `status "Garage updates"` | none | `Garage refreshed from the server.` | none | none |
| Refit | `status "Garage updates"` | button disabled, text `Refitting…` | `<System> refitted to stock. Refund: <refund> coins. Balance: <balance> coins.` | none | none |
| Car purchase | `status "Garage updates"` | Buy button disabled, text `Buying…` | `<Car name> added to your garage. Balance: <balance> coins.` | the same not-enough-coins heading and text in its dialog | none |
| Balance push | `status "Coin balance"` | none | `<balance> coins` | none | none |
| PI warning (shown before buying, in Confirm upgrade) | dialog text | none | `This upgrade takes PI to <pi>, over the class <class> limit of <limit>. The car can no longer enter class <class> events.` | none | none |
| Board load | table | `Loading times…` | rows | none | none |
| Empty board | table area | none | `No verified times on this board yet.` | none | none |
| Lobby status | `status "Lobby status"` | none | `Waiting for players` (open), `Starting in <n>` (countdown, the server's 3, 2, 1), `Racing`, `Finish grace: <n> s` (the server's whole seconds left), `Finished` | none | none |
| Dropped player | `list "Players"` row | none | `Reconnecting` | none | none |
| Join a full lobby | page message | none | none | `This lobby is full.` | none |
| Join a lobby that already started | page message | none | none | `This lobby has already started.` | none |
| Championship | league regions | none | `<points> / 50 points`; `Complete`; Club before unlock: `Locked until the Rookie league is complete`; after the finals reward: `Club champion trophy` | none | none |
| League completed while the page is open | `status "Championship updates"` | none | `Rookie league complete. Club league and Quarry Switchbacks unlocked.`; `Club league complete. Trophy and 1,000 coins added.` | none | none |
| Loaner offer | `dialog "Loaner car"` | none | `You have no eligible class <class> car. Race the loaner <Car name> for half result coins?` | none | none |
| Sign-in link request | `status "Sign-in status"` | button disabled, text `Sending…` | `Check <email> for your sign-in link.` | error summary and field: `Enter a valid email address.` | `We couldn't send the email right now. Try again in a minute.` |
| Sign-in link opened | `status "Sign-in status"` | `Signing you in…` | `Signed in as <email>. Your garage is saved.` | `This sign-in link has expired or was already used. Send a new one.` with `link "Send a new one"` to `/sign-in` | none |
| 3D view fallback | `region "Car"` | none | none | none | `3D view needs WebGL 2. Showing a drawing instead.` |
| Narrow race screen | race page | none | none | none | `Racing needs a desktop browser with a keyboard.` |

When the results and outage screens update:
- The results screen changes from the pending copy to the verdict without a reload, within 2 seconds of the server's state change.
- The outage banner shows on page load whenever `GET /v1/status` reports replay storage unavailable. While a page is open, the banner appears or disappears within 10 seconds of that status changing.

## Backend

### API (DP-04, DP-14, DP-16, DP-17, DP-20, DP-23, DP-28, DP-29, DP-32, DP-33, DP-38, DP-40, DP-43, DP-48, DP-54)

#### Common rules

- All endpoints are under `/v1` except `GET /health`.
- Request and response bodies are `application/json` unless stated otherwise.
- The session is the HttpOnly cookie `kerb_session`.
- Every error body is `{"error":{"code":"<CODE>","message":"<text>"}}`. Validation errors add `"fields":{"<field>":"<text>"}`.
- Origin, size and media-type limits are in Server boundary.

#### Error precedence

Every endpoint checks errors in this order:
1. request origin, size or media type;
2. unauthenticated, `401 UNAUTHENTICATED`;
3. an unknown resource or another player's resource, `404 NOT_FOUND`;
4. idempotency: a missing key, a replay of a stored response, or a reused key with a different body;
5. state conflicts (`403` locks, `409` conflicts, `410` expired);
6. validation, `422 VALIDATION_FAILED`;
7. insufficient coins, `402 INSUFFICIENT_COINS`.

The rows below name only each endpoint's own extra errors.

#### Idempotency

- Purchases, car purchases and refits require an `Idempotency-Key` header, scoped to the player. Without it they answer `400 IDEMPOTENCY_KEY_REQUIRED`.
- The same key with a byte-identical body returns the stored status and body and writes nothing.
- The same key with a different body answers `409 IDEMPOTENCY_KEY_REUSED`.
- A `402` answer is stored like any other, so a retry with its key replays the `402`. A fresh purchase after a `402` therefore needs a new key, which the browser generates for each new purchase attempt (see Interactions).

#### Ignored fields

Request fields not listed in a row are ignored. They never set prices, stages, PI, balances, lap times, coins, positions or owners.

#### Endpoints

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /health` | none | `200 {"status":"ok"}` | none |
| `GET /v1/status` | none | `200 {"replayStorage":"ok"\|"unavailable"}` | none |
| `POST /v1/guests` | `{"ageConfirmed":true,"starterCarId":"kestrel-hatch"\|"wren-coupe"\|"moth-roadster"}` | `201 {"playerId","name","balance"}` and sets `kerb_session` | `422` (`ageConfirmed` not true, or not a starter car) |
| `GET /v1/me` | none | `200 {"playerId","name","guest":bool,"email":string\|null,"units":"kmh"\|"mph","balance"}` | none |
| `PATCH /v1/me` | `{"units":"kmh"\|"mph"}` | `200` same body as `GET /v1/me` | `422` |
| `GET /v1/cars` | none (no session needed) | `200 {"cars":[{"carId","name","class","pi","price":int\|null,"starter":bool,"stats":{"accelMps2","brakeMps2","topMps","gripPct","laneChangeSteps"}}]}` | none |
| `GET /v1/garage` | none | `200 {"balance","selectedCarId","cars":[{"carId","name","class","pi","overClassLimit":bool,"stages":{"engine","tires","brakes","suspension"},"paid":{"engine","tires","brakes","suspension"},"stats":{...},"latestReference":<reference>\|null}]}` | none |
| `PATCH /v1/garage` | `{"selectedCarId"}` | `200` same body as `GET /v1/garage` | `404` (car not owned) |
| `POST /v1/garage/cars` (key) | `{"carId"}` | `201 {"carId","balance"}` | `404 NOT_FOUND` (a string `carId` that names no car in the catalogue), `409 ALREADY_OWNED` (a car the player owns, starter cars included), `409 NOT_FOR_SALE` (a starter car the player does not own), `422` (`carId` missing or not a string), `402` |
| `POST /v1/garage/cars/<carId>/upgrades/<system>` (key) | `{"stage":int,"layoutId":"saltflat-ring"\|"quarry-switchbacks"}` | `201 {"purchaseId","carId","system","stage","price","balance","pi","overClassLimit","reference":<reference>}` | `404` (car not owned or unknown system), `409 STAGE_OUT_OF_ORDER` (any integer stage other than the current stage plus one, and any integer stage above 3, so a slot already at stage 3 answers this for stage 4), `403 LAYOUT_LOCKED`, `422` (stage not an integer), `402` |
| `POST /v1/garage/cars/<carId>/refits/<system>` (key) | `{}` | `201 {"carId","system","refund","balance","pi"}` | `404`, `409 ALREADY_STOCK` |
| `GET /v1/ledger` | none | `200 {"balance","total","movements":[{"movementId","kind","createdAt","runId":string\|null,"entries":[{"account","amount"},{"account","amount"}]}]}`, newest first | none |
| `POST /v1/runs` | `{"layoutId","mode","carId"?,"eventId"?,"laps"?,"loaner"?:bool}`; `carId` is required unless `loaner` is true | `201 {"runId","seed","layoutId","mode","carId","laps","stepLimit","loaner":bool,"car":{"stats":{...},"stages":{...}},"ai":[{"name","carId","paceFactor"}]}` | `404` (car not owned when `loaner` is not true, or unknown event), `403 LAYOUT_LOCKED`, `403 LEAGUE_LOCKED`, `409 CAR_NOT_ELIGIBLE`, `409 LOANER_NOT_OFFERED`, `422` |
| `POST /v1/runs/<runId>/finish` | the replay file, normally `{"seed":"<seed>","inputs":[<input event>...]}`; any bytes are accepted, stored and judged by the replay file rules | `202 {"runId","status":"verifying"\|"held"\|"verified"\|"rejected"}`; a byte-identical repeat answers `202` with the run's current status | `409 ALREADY_SUBMITTED` |
| `GET /v1/runs/<runId>` | none | `200 {"runId","playerId","name","status","reason":string\|null,"layoutId","mode","carId","eventId","loaner","car":{...},"lapResults":[{"lapMs","valid","offTrackSteps","sectorsMs":[s1,s2,s3]}],"raceMs","bestLapMs","driftScore","coinsCollected","position","clean","payout","topSpeedMps","replaySha256"}`; values the replay has not decided yet are `null` | `404` (another player's run that is not verified) |
| `GET /v1/runs/<runId>/replay` | none | `200`, body exactly the stored bytes, `Content-Type: application/json`, header `X-Replay-SHA256: <hex>`, `Content-Disposition: attachment; filename="kerbline-<runId>.json"` | `404` (not stored, or another player's run that is not verified), `503 REPLAY_STORAGE_UNAVAILABLE` |
| `GET /v1/boards?layoutId=&mode=&class=` | query `mode` is `time-trial`, `circuit` or `drift` | `200 {"layoutId","mode","class","rows":[{"rank","playerId","name","runId","carId","value","unit":"ms"\|"points","gapMs":int\|null,"topSpeedMps","replaySha256","mine":bool}],"mine":<row>\|null}`, top 50 rows, with `mine` set even when the viewer is outside them | `422` |
| `GET /v1/championship` | none | `200 {"leagues":[{"leagueId":"rookie"\|"club","status":"locked"\|"open"\|"complete","points","events":[{"eventId","name","mode","layoutId","class","points","eligible":bool,"loanerCarId":string\|null}]}],"trophy":bool}` | none |
| `POST /v1/lobbies` | `{"aiCount":0\|1\|2}` | `201 {"lobbyId","inviteUrl":"/lobby/<lobbyId>","state":"open"}` | `422` |
| `GET /v1/lobbies/<lobbyId>` | none (any signed-in player) | `200 {"lobbyId","hostId","state","countdown":int\|null,"graceSecondsLeft":int\|null,"players":[{"playerId","name","ready","connection":"connected"\|"reconnecting","rejoinSecondsLeft":int\|null,"position","lap","finishMs":int\|null,"dnf":bool}],"ai":[{"name","position","lap","finishMs"}]}` | none |
| `POST /v1/lobbies/<lobbyId>/join` | `{}` | `200` lobby body | `409 LOBBY_FULL`, `409 LOBBY_CLOSED` |
| `POST /v1/lobbies/<lobbyId>/ready` | `{"ready":bool}` | `200` lobby body | `404` (not a member), `409 LOBBY_CLOSED` (lobby `racing` or `finished`), `422` |
| `GET /v1/ws` (WebSocket upgrade) | session cookie | the live pushes below | `401` before upgrade |
| `POST /v1/auth/links` | `{"email"}` (session optional) | `202 {"status":"sent"}` | `422` (`fields.email`), `503 MAIL_UNAVAILABLE` |
| `POST /v1/auth/redeem` | `{"token","keep"?:"device"\|"account"}` (session optional) | `200 {"playerId","email","outcome":"new_account"\|"signed_in"\|"kept_device"\|"kept_account"}` and sets `kerb_session` | `410 LINK_EXPIRED` (unknown, used or expired), `409 GARAGE_CHOICE_REQUIRED` (the token is not consumed), `422` |
| `POST /v1/grading/players` | `{"coins"?:int,"cars"?:[carId],"name"?:string}` | `201 {"playerId"}` and sets `kerb_session` | `422` |
| `POST /v1/grading/races` (session) | `{"layoutId","mode","carId"?,"eventId"?,"laps"?,"loaner"?:bool,"driver":"reference"\|"coast"\|"inputs","inputs"?}` | `202 {"runId"}` | the same errors as `POST /v1/runs`, plus `422` |

Body details:
- `<reference>` is `{"layoutId","oldLapMs","newLapMs","deltaMs","oldSectorsMs":[3 ints],"newSectorsMs":[3 ints],"sectorDeltasMs":[3 ints],"price"}`.
- `paid.<system>` in the garage body is the coins this car paid for that system's currently fitted stages. A refit resets it to 0.
- `stepLimit` in the run body is the run's step limit from Business rules.
- Input events follow the replay file rules in Business rules.
- In a board body, `rank` is the row's place from 1 in board order, with no shared ranks.
- `mine` is true only on the viewer's own row.

#### Live pushes

Over `GET /v1/ws` the server sends JSON messages. Who receives each one is stated with it.
- `{"type":"balance","balance","movementId","purchaseId":string|null}` goes after every movement, only to the connections of the player whose wallet moved. `purchaseId` equals the upgrade response's `purchaseId` for an upgrade movement, and is `null` otherwise.
- `{"type":"run","runId","status"}` goes on every run state change, only to the connections of the run's player.
- `{"type":"championship"}` plus the `GET /v1/championship` body fields goes after any change to points, completion, unlocks or the trophy, only to the connections of that player.
- `{"type":"board","layoutId","mode","class","row":<row>}` goes to every connection when a verified run creates or improves a row. The row's `rank` and `gapMs` are its values on the updated board, and its `mine` is true only on the connections of that row's player.
- `{"type":"lobby"}` plus the lobby body fields goes to the lobby's members on every lobby change, and at least 10 times per second while racing.

The messages the browser sends (lobby subscription and key state) are the builder's choice.

#### Grading routes

Grading routes exist only when `GRADING_ROUTES` is `on`. With any other value, or unset, both answer `404 NOT_FOUND` before any other check.
- `POST /v1/grading/players` creates a signed-in, non-guest player with exactly that balance, written as one `opening` movement, and those cars at stage 0. The defaults are 1,000 coins and `["kestrel-hatch"]`.
- `POST /v1/grading/races` creates a run exactly as `POST /v1/runs` does. It generates the run's replay file with the chosen driver and submits it through the same finish pipeline: stored object, verification, payouts, boards and championship.
  - When `eventId` is given, the event decides the layout and mode, and `layoutId` and `mode` may be left out.
  - The drivers:
    - `reference` is the reference driver's input list from Business rules, driven in the run's car until the run ends;
    - `coast` is the single event `{"step":0,"throttle":1,"brake":0,"drift":0,"lane":"middle"}`;
    - `inputs` submits the given input list as is.
  - The generated file is compact JSON `{"seed":"<seed>","inputs":[...]}`.

### Business rules (DP-01, DP-02, DP-04, DP-07, DP-14, DP-16, DP-17, DP-18, DP-20, DP-21, DP-22, DP-23, DP-25, DP-29, DP-31, DP-33, DP-34, DP-35, DP-37, DP-38, DP-39, DP-48, DP-50, DP-51, DP-54)

#### Race model

The browser and the server use the same race model.

- **Time.** One step is 1/60 of a second. Race time in milliseconds is round(n × 1000 / 60), where n is the number of steps completed when the run ends, including the step that ends it. Lap and sector times are defined below. Speeds are stored in metres per second. Times are integer milliseconds and never depend on the display unit.
- **Position and lanes.** Track position is the distance in metres from the start line along the lap. Each car is in one of three lanes: `left`, `middle` or `right`. Cars start at 0 m, at speed 0, in `middle`. Cars never collide.
- **Inputs.** A run's inputs are the events of its replay file (see Replay file rules). Each event's values hold until the next event.
- **Segments and sectors.** A segment or sector listed as `a–b` covers lap positions from a (included) up to b (excluded). For the model's checks, a car is inside a corner on a step when its new position, after that step's advance, is inside the corner.
- **Steps.** Steps are numbered from 0. The input in force on step k is the last event whose step is at most k. Each step runs in this order:
  1. Throttle adds accel/60 to speed. Brake subtracts brake/60. With neither held, speed falls by 0.5/60. Holding throttle and brake on the same step is legal, and both apply, in that order.
  2. Drift held subtracts a further 1.0/60.
  3. Speed is clamped to the range 0 to top.
  4. Position advances by this speed/60.
  5. Lap end: when the new position is at or beyond the layout length, the lap ends on this step. The next lap starts at the new position minus the length, so the surplus carries over.
  6. Off-track check: the step is an off-track step when the new position is inside a corner and either the speed is above that corner's effective limit plus 0.5 m/s, or the car is already off track in that corner. On an off-track step the car is off track in that corner and its speed is set to at most 8 m/s. The car stops being off track on the first step whose new position is outside that corner.
  7. Lane change, coins and drift scoring, as below, using the speed after step 6 and the new position.
- **Corners.** A corner's effective limit is its limit × grip / 100. An off-track step counts toward the lap it happens in.
  - A lap with 60 or more off-track steps is invalid. An invalid lap counts toward a race's laps, but never toward a best lap, a personal best or a board.
  - A run with no off-track step is clean.
- **Lap and sector times.** A sector ends on the step whose new position reaches or passes its end. S3 ends with the lap. A lap's or sector's time in milliseconds is round(e × 1000 / 60) − round(s × 1000 / 60), where s is the number of steps completed when it starts and e is the number completed when it ends, the ending step included. A run's lap times therefore add up to its race time.
- **Lane changes.** The lanes run `left`, `middle`, `right`.
  - A change of one lane toward the input's lane starts on a step where no change is in progress and the input's lane differs from the car's lane.
  - A change takes the car's lane-change steps, counting the step it starts on. On each of those steps the car is between lanes and collects nothing. On the step after the last, the car is fully in the new lane.
  - A request two lanes away (`left` to `right`) is two one-lane changes back to back.
  - A change in progress is never interrupted. When it completes, the next step compares the input's lane again.
- **Coins.** Coins exist only in `practice` and `circuit` runs, and they repeat every lap.
  - A coin at distance d is passed on the step where previous position < d ≤ new position within that lap. On a lap-end step this covers the old lap's coins up to the layout length and the new lap's coins up to the carried-over position.
  - A passed coin is collected when the car is not between lanes on that step and its lane is the coin's lane.
  - The n-th coin of an unbroken streak is worth 5 + min(n − 1, 5).
  - Passing a coin without collecting it ends the streak.
- **Drift score.** A step scores while drift is held on that step, the speed after the off-track check is at least 10 m/s, and the new position is inside a corner.
  - The step's score is floor(speed × zone weight) × multiplier, using that same speed.
  - The n-th step of an unbroken run of scoring steps uses multiplier min(1 + floor((n − 1) / 60), 5).
  - Any step that does not score ends the run, so the next scoring step uses multiplier 1. That includes an off-track step and a step with drift released.
- **Reference driver.** The reference driver stays in `middle` and never drifts. It chooses each step's pedals from the car's position and speed at the start of that step, before that step's advance. So step 0 decides from 0 m and speed 0.
  - **Where it is.** The driver is inside a corner when that start position is inside the corner. Otherwise its next corner is the first corner whose start lies beyond the start position in the current lap. When no corner starts later in the lap, the next corner is the first corner of the following lap, at a distance of the layout length minus the start position plus that corner's start.
  - **Outside corners**, it holds throttle, except on any step where both of these hold: its speed is above the next corner's effective limit, and the distance from its start position to that corner's start is at most (speed² − effective limit²) / (2 × brake) + speed / 30, using the car's brake value. On such a step it brakes, with throttle off.
  - **Inside a corner**, it holds throttle while its speed is below that corner's effective limit, and releases both pedals while its speed is at or above it.
  - **As an input list**, it is one event at step 0 plus one event at every later step whose pedals differ from the step before. Every event has `lane` `middle` and `drift` 0. The list runs until the run ends.
- **AI drivers.** An AI car is driven by the reference driver, slowed by a pace factor: Rookie 1.15, Pro 1.04. Its position at race step t is the reference driver's position at step floor(t / factor).
  - Every circuit run races two AI drivers, Pip Marlowe (Rookie) and Isa Corrow (Pro).
  - In a championship event they drive that event's AI cars. In a circuit run without an `eventId`, both drive the same car model as the player's run car, at stage 0.
  - Practice, drift and time-trial runs have no AI drivers, so their `ai` list is empty and their `position` is `null`.
- **Positions.** Final race position is by finish time. A tie puts the player ahead.
- **Run ends and step limits.**
  - Lap counts:
    - circuit runs are 3 laps;
    - the guided first race and drift runs are 1 lap;
    - practice runs are 1 to 5 laps (default 1);
    - time trials are 1 to 5 laps (default 3).
  - The step limit is laps × 7,200 for practice, circuit and time-trial runs, and 5,400 for drift runs.
  - A practice, circuit or time-trial run that has not finished its laps within its step limit is `did_not_finish`.
  - A drift run ends at the finish line or after 5,400 steps, whichever comes first. The 5,400 steps are the 90-second stage timer, which the replay ticks, not the wall clock. Both end states can verify.

#### Layouts

Lengths are in metres, limits in m/s, and drift-zone weights are in brackets. Every corner is a drift zone.

| Layout id | Map name | Length | Segments | Sectors | Coins (metres, lane) |
|---|---|---|---|---|---|
| `saltflat-ring` | Saltflat Ring | 1,200 | straight 0–300; corner 300–380 limit 22 [1.0]; straight 380–600; hairpin 600–660 limit 14 [1.5]; straight 660–1,000; corner 1,000–1,200 limit 28 [1.2] | S1 0–380, S2 380–660, S3 660–1,200 | 120 middle, 200 middle, 340 left, 450 right, 520 right, 640 left, 800 middle, 1,100 middle |
| `quarry-switchbacks` | Quarry Switchbacks | 1,000 | straight 0–200; corner 200–260 limit 12 [1.5]; straight 260–480; corner 480–560 limit 16 [1.3]; straight 560–800; corner 800–1,000 limit 20 [1.0] | S1 0–260, S2 260–560, S3 560–1,000 | 100 middle, 230 left, 400 middle, 520 right, 700 middle, 900 left |

#### Cars

Class is set by PI: D is 100–299, C is 300–499 and B is 500–699. A car keeps its catalogue class. A car whose PI is above its class's top is ineligible for class-limited events.

| Car id | Name | Class | Accel (m/s²) | Brake (m/s²) | Top (m/s) | Grip (%) | Lane-change steps | PI | Price |
|---|---|---|---|---|---|---|---|---|---|
| `kestrel-hatch` | Kestrel Hatch | D | 4.0 | 8.0 | 45 | 100 | 30 | 220 | starter |
| `wren-coupe` | Wren Coupe | D | 3.6 | 8.5 | 47 | 102 | 30 | 230 | starter |
| `moth-roadster` | Moth Roadster | D | 4.2 | 7.5 | 43 | 98 | 24 | 215 | starter |
| `halcyon-rs` | Halcyon RS | C | 5.0 | 9.0 | 52 | 106 | 24 | 360 | 4,000 |
| `ferrule-sport` | Ferrule Sport | C | 5.4 | 8.8 | 54 | 104 | 24 | 380 | 5,500 |
| `vantor-8` | Vantor 8 | B | 6.2 | 10.0 | 60 | 110 | 18 | 560 | 12,000 |

Starter cars cannot be bought; the car purchase row in the API gives the answer. A starter car not chosen at the start stays unowned.

#### Upgrades

- The systems are `engine`, `tires`, `brakes` and `suspension`. Each runs from stage 0 (stock) to stage 3, and stages are bought one at a time, in order. A slot at stage 3 takes no further purchase. The API row gives the answer for a stage that is out of order or above 3.
- Each stage adds:
  - engine: +1.0 accel, +2 top and PI +20;
  - tires: +4 grip and PI +15;
  - brakes: +1.5 brake and PI +10;
  - suspension: −6 lane-change steps (never below 6 steps) and PI +5.
- Prices for stages 1, 2 and 3, by car class: D 300, 700, 1,500; C 600, 1,400, 3,000; B 1,000, 2,400, 5,000.
- An upgrade that takes PI above the class top is allowed. The warning shows before purchase.
- A purchase checks the stage, debits the price, sets the stage and stores the reference lap result in one commit, or none of them happens.
- The reference lap result is the reference driver's time for one lap from a standing start on the request's layout. It is run through the race model twice: once with the car's setup before the purchase and once with the setup after it.
  - `deltaMs` is new minus old, and each sector delta is new minus old for that sector.
  - The garage shows each car's latest stored result.

#### Refit

A refit sets a system with a stage above 0 back to stage 0. It refunds floor(50% of the coins this car paid for that system's currently fitted stages). The refund, the stage change and the PI change commit together.

#### Coin ledger

- A new player's balance starts at 1,000 coins, written as an `opening` movement.
- Every movement is exactly two entries that sum to zero: one on the wallet account `wallet:<playerId>` and one on a counter account.
- Movement kinds and their counter accounts:
  - `opening` and `finals` → `house:grants`;
  - `pickups` → `house:pickups`;
  - `result` → `house:results`;
  - `upgrade` and `car` → `house:shop`;
  - `refit` → `house:refits`.
- The balance is the sum of the wallet entries, and the ledger total shown in coin history is that same sum. The balance never goes below 0.
- Movements are never edited or deleted. A correction is a new movement.
- Each verified run writes at most one `pickups` movement and at most one `result` movement, and never a movement with amount 0.

#### Payouts

Payouts are credited only when a run becomes `verified`.
- **Pickups**: the value of the coins collected in a practice or circuit run.
- **Circuit result**: 1st 600, 2nd 400, 3rd 300. A clean run adds a bonus of floor(15% of the placing coins).
- **Guided first race**: 300, once per player, on that player's first verified run of the event.
- **Drift**: floor(score / 1,000) coins, at most 500.
- **Time trial**: laps are taken in lap order.
  - A valid lap pays 250 when the player has no earlier valid time-trial lap on that layout, in any car, counting earlier laps of the same run. So a player's first valid time-trial lap on a layout always pays 250.
  - After that, a valid lap pays 250 only when it is strictly faster than the player's best valid time-trial lap on that layout so far.
- **Online**: paid to humans who finish, by final position: 1st 200, 2nd 100, any later place 50.
- **Loaner**: halves the result payout, rounded down. Pickups are not halved.

#### One player at a time

Everything that changes one player's balance, stages or championship standing is serialised against that player. That covers purchases, car purchases, refits, run payouts, championship points, league completion, unlocks and the finals reward. These changes apply one at a time, in the order the server takes them, and none of them reads a value that another one is about to change.

- **Purchases.**
  - A purchase succeeds when the balance left by the purchases before it covers its price.
  - A purchase that balance does not cover answers `402 INSUFFICIENT_COINS` and leaves the balance, stages and ledger unchanged.
  - So when two simultaneous purchases each fit the balance alone but not together, exactly one succeeds and the other answers `402`.
  - The balance never goes below 0. Prices, PI, stages and balances in a request body are ignored.
- **Championship.** Whatever order or overlap a player's verifications finish in:
  - every league's `points` equals the sum of its event bests;
  - a league whose bests sum to 50 or more is `complete`;
  - the Rookie completion and the Club and Quarry Switchbacks unlock are written in one commit;
  - the Club completion, the trophy and the single `finals` movement are written in one commit.

  So when two runs verify at the same moment and together reach 50 points, the league completes exactly once. Club completion never writes a second `finals` movement.

#### Isolation between players

Runs from different players are verified independently, even when they verify at the same moment.
- Each verification uses only its own run's car and stages (captured when the run was created), layout, seed and inputs.
- Lap times, coins, positions and payouts never depend on any other run verifying alongside it.
- A run's payout and championship points go only to that run's player.
- Pushes reach the connections stated in the API and no others. A connection never receives another player's `balance`, `run` or `championship` message, and it never sees another player's row marked `mine`.

#### Runs

- **States.** A run is `started` when created. A finish request moves it to `submitted`. From there it goes to `held` when replay storage is unreachable, or to `verifying` once the object is stored. It ends `verified` or `rejected`.
- **Legal transitions:** `started` → `submitted`; `submitted` → `held` or `verifying`; `held` → `verifying`; `verifying` → `verified` or `rejected`.
- **Illegal transitions.** A finish request on a run that is not `started` is answered like a retry (below). No other transition exists.
- **Seed.** Each run gets a single-use random seed at creation. The seed binds the replay to that run and does not change the race model.
- **Storing the replay.** On a finish request, the server stores the request body bytes exactly as received, whatever they contain, as the object `replays/<runId>.json`, and records their SHA-256 hex.
  - The run moves to `verifying` only after object storage confirms the object.
  - While the run is `held`, its bytes are kept in Postgres. The server retries storage at least every 5 seconds without a restart, so a held run moves on by itself within 5 seconds of storage returning.
- **Finish response time.** The finish request answers `202` within 2 seconds for any body up to the finish size limit in Server boundary. That includes bodies that are mostly whitespace, deeply nested or unparseable, and requests made while storage is unreachable. Verification happens after the response.
- **Replay file rules.** A replay file is inside the bounds only when all of these hold:
  1. It parses as JSON with no key repeated within any one object.
  2. Its nesting depth is at most 4. The top-level value is depth 1, and each array or object inside another adds one, so a normal file is depth 3.
  3. The top level is an object with a `seed` and an `inputs` array. Any other top-level keys are ignored.
  4. `inputs` holds 1 to 2,000 events. 2,000 is allowed; 0 is not.
  5. Each event is an object with exactly the keys `step`, `throttle`, `brake`, `drift` and `lane`, no more and no fewer.
  6. `step` is written as plain digits (no sign, decimal point or exponent) and is from 0 to the run's step limit minus 1.
  7. The first event's step is 0, and steps strictly increase.
  8. `throttle`, `brake` and `drift` are each written as `0` or `1`. `true`, `false`, `1.0` and strings break this rule.
  9. `lane` is one of the strings `left`, `middle` or `right`.
- **Verification.** A run stays in `verifying` for at least `VERIFY_DELAY_MS` milliseconds, and verification finishes within `VERIFY_DELAY_MS` plus 2 seconds of the object being stored. It replays the stored bytes, and the first failing check decides the reason:
  1. replay file rules 1 to 3 → `invalid_inputs`;
  2. the `seed` differs from the run's seed → `seed_mismatch`;
  3. replay file rules 4 to 9 → `invalid_inputs`;
  4. the run does not reach its end → `did_not_finish`.

  Otherwise the run is `verified`. Lap results, race time, best valid lap, drift score, coins collected, position, clean flag and top speed come only from this replay. A rejected run keeps its stored object and its `replaySha256` exactly as submitted.
- **Retries.** A byte-identical repeat of a finish request answers `202` with the current status and writes nothing, so the run is recorded and paid once. That holds however many times it arrives and in whatever state the run is. A different body for a run that is no longer `started` answers `409 ALREADY_SUBMITTED`.
- **Payouts and side effects.** A `verified` run pays, updates boards and updates championship points once. A `held` or `rejected` run does none of these.

#### Leaderboards

- There is one board per layout, mode (`time-trial`, `circuit`, `drift`) and class. A run counts under its car's catalogue class.
- A board lists only `verified` runs:
  - time trial: the best valid lap;
  - circuit: the race time of a run whose every lap is valid;
  - drift: the score of a run with no invalid lap.
- Each player has one row per board, holding their best value. A newly verified value that is not better leaves the row and the board unchanged and sends no push.
- Times rank ascending and drift scores descending. Ties go to the earlier verification.
- `gapMs` is the row's time minus the first row's time. It is `null` for drift and for the first row.
- A newly created or improved row reaches every open board page within 5 seconds.

#### Championship

- **Rookie league** (class D, all on `saltflat-ring`) is open from the start:
  - `rookie-circuit` (Rookie Circuit): 3 laps against the AI drivers Pip Marlowe (Rookie) and Isa Corrow (Pro), both in Kestrel Hatches. Points: 1st 25, 2nd 18, 3rd 15.
  - `rookie-drift` (Rookie Drift): floor(score / 1,000) points, at most 25.
  - `rookie-time-trial` (Rookie Time Trial): 25 points when any valid lap is at or under 60,000 ms, otherwise 10.
- **Club league** (class C, on `quarry-switchbacks`) is locked until Rookie is complete:
  - `club-circuit` (Club Circuit): the same AI drivers in Halcyon RS cars, with the same points as Rookie Circuit.
  - `club-time-trial` (Club Time Trial): the same points as Rookie Time Trial.
- `guided-first-race` (Guided first race) is a 1-lap `practice` event on `saltflat-ring`, in any owned car, outside the leagues.
- **Points.** Only verified runs started with an `eventId` score. Each event keeps the player's best points, and league points are the sum of those bests.
- **Completion and unlocks.** At 50 league points (50 itself included) a league is complete, and it stays complete.
  - Completing Rookie unlocks the Club league and `quarry-switchbacks` for every mode. Until then, Club events answer `403 LEAGUE_LOCKED` and Quarry Switchbacks answers `403 LAYOUT_LOCKED`.
  - Completing Club pays the finals reward once: the trophy and a 1,000-coin `finals` movement.
  - Every change is pushed live, as stated in the API.
- **Eligibility.** A car is eligible for an event when its class equals the event's class and its PI is within that class.
  - A run asks for the loaner with `"loaner": true`. Otherwise it races the owned car named by `carId`.
  - Without `loaner`:
    - an owned eligible car is accepted;
    - an owned ineligible car answers `409 CAR_NOT_ELIGIBLE`;
    - a car the player does not own answers `404 NOT_FOUND`, even when it is the event's loaner model.
  - When the player owns no eligible car, the event offers its loaner at stage 0: Kestrel Hatch for class D, Halcyon RS for class C. With `"loaner": true` the run uses that loaner and ignores `carId`.
  - Asking for the loaner while owning an eligible car, or without an `eventId`, answers `409 LOANER_NOT_OFFERED`.
- When `eventId` is given, the event's layout, mode and laps replace the request's.

#### Online lobby

- **Setup.** A lobby is private, on `saltflat-ring`, 1 lap, with 0 to 2 Rookie AI drivers named `Rookie AI 1` and `Rookie AI 2` in Kestrel Hatches. The host is the first player.
- **Joining.** At most 2 humans may be in a lobby, so a third join answers `409 LOBBY_FULL`. Joining a lobby that is not `open` answers `409 LOBBY_CLOSED`.
- **States and transitions:**
  - `open` → `countdown` when both humans are ready.
  - `countdown` → `racing` when the countdown ends.
  - `countdown` → `open` when a human un-readies, or when a human's socket drops. The lobby body then shows `countdown: null`, and a dropped human's `ready` resets to false.
  - `racing` → `finished`.

  A fresh countdown from 3 starts whenever both humans are ready again.
- **Ready changes** are allowed while `open` or `countdown`. They answer `409 LOBBY_CLOSED` while `racing` or `finished`.
- **Countdown.** The countdown lasts 3 seconds, published by the server as 3, 2, 1. Only the server's timer decides when it ends. A cancelled countdown never starts the race.
- **Racing.** The server runs the race model at 60 steps per second of server time, using each human's latest key state received over the WebSocket. Each human races their selected car with its stages. Live positions follow the `<p>` ranking in Feedback states.
- **Disconnects.**
  - A human whose WebSocket closes is marked `reconnecting` within 2 seconds. While `open`, their `ready` resets to false. While racing, their car coasts with all inputs off.
  - They are `connected` again if they reconnect within `REJOIN_SECONDS`.
  - If they do not, they are removed from the player list while `open`, or marked `dnf` while racing.
- **Finish grace.** When the first car finishes, the remaining humans have `FINISH_GRACE_SECONDS` to finish. Unfinished humans are then `dnf` and the lobby is `finished`. The lobby also finishes as soon as every connected human has finished.
- **Payouts.** Online races are decided on the server. When the lobby finishes, each human is paid the online result once, as a verified `result` movement. Online races never post to boards or store replays.

#### Sign-in

- **Links.** A link request sends one email per request, with a new single-use token. Earlier unused links stay valid until they expire. A link is valid for `SIGNIN_LINK_TTL_SECONDS` seconds after it is sent (that exact second included) and works once.
- **Redeeming.**
  - With a guest session and an email that has no account, the guest player becomes the account and keeps the same player id, garage, ledger and board rows (`new_account`).
  - Without a guest session, a new email gets a new player with the opening balance and a Kestrel Hatch (`new_account`), and an existing email signs in (`signed_in`).
  - With a guest session and an existing account, the outcome depends on progress. A garage has progress when it has any movement besides `opening`.
    - When both garages have progress, a choice is needed. Without `keep`, the request answers `409 GARAGE_CHOICE_REQUIRED`.
    - `keep: "device"` attaches the email to the guest's player and retires the account's former player (`kept_device`).
    - `keep: "account"` signs in to the account and retires the guest player (`kept_account`).
    - When only one side has progress, that side is kept without asking, with the matching outcome. When neither has progress, the account is kept (`signed_in`).
  - Board rows of retired players stay listed.
- **Names.** Guests are named `Guest <4 letters or digits>`. Accounts take the part of the email before `@`.

#### Time rules

The device clock may be wrong, so the browser never decides anything from its own clock. These all come from the server: lobby countdown and its cancellation, rejoin window, finish grace, link expiry, held-run resumption and verification. The race and the drift stage timer advance only with replay or page steps, never while the Paused dialog is open.

### Services (DP-20, DP-25, DP-28, DP-38, DP-40)

- **Postgres** holds players, accounts and sessions, owned cars and stages, purchases with their reference results and idempotency records, the ledger, runs (including held bytes), boards, championship points, lobbies and sign-in tokens. The server applies its schema idempotently every time it starts, so an empty database works. A reload, or another device, shows exactly what was committed.
- **MinIO** stores each run's replay as a private object in `S3_BUCKET` with the key `replays/<runId>.json`.
  - The object's bytes are exactly the finish request body.
  - The object carries metadata `sha256`, holding the same hex that the server records and returns in `X-Replay-SHA256`.
  - Objects are never overwritten.
  - When MinIO is unreachable:
    - finish requests still answer `202` with status `held`;
    - `GET /v1/status` reports `unavailable`, and its probe takes at most 2 seconds;
    - replay downloads answer `503 REPLAY_STORAGE_UNAVAILABLE`, and ghost loads show the ghost unavailable copy;
    - the UI shows the outage banner and the held copy;
    - health stays `200`.
- **Mailpit (SMTP)** receives each sign-in email, addressed to the requested address.
  - The subject is `Your Kerbline sign-in link`, and the sender is the value of `MAIL_FROM` (`Kerbline <laps@ochrekerb.example>` in grading).
  - The plain-text body contains the link `<APP_PUBLIC_URL>/sign-in/<token>`. When `APP_PUBLIC_URL` is unset, the link falls back to `http://localhost:<port>`.
  - When SMTP is unreachable or refuses the message within 5 seconds:
    - the request answers `503 MAIL_UNAVAILABLE`;
    - the token is discarded, so no usable link exists;
    - the UI shows the mail outage copy.

### Seed data (DP-01, DP-35)

Every person and business named here is invented. At start the database holds only:
- the cars, layouts, upgrade prices and events published in Business rules;
- the AI drivers Pip Marlowe (Rookie) and Isa Corrow (Pro);
- the counter accounts `house:grants`, `house:pickups`, `house:results`, `house:shop` and `house:refits`.

There are no players, runs, boards, lobbies or replay objects at start, so every board is empty. For example, with the seed data at start, a new guest who picks the Kestrel Hatch has a balance of 1,000 coins and one car with all four systems at stage 0.

## Technical requirements

### Deployment (DP-43)

- **Runtime.** Node.js 22 with npm is available. Both the server and the client are TypeScript.
- **Run manifest.** `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- **Serving.** One server process serves the built client, the API and the WebSocket. It binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or on 4173 when that is unset.
- **Health.** `GET /health` answers `200 {"status":"ok"}` on every instance, including instances whose MinIO or Mailpit is unreachable. It never checks MinIO or Mailpit and never answers `503`.

### Configuration and secrets (DP-44)

The server reads these at start. It never hard-codes them or sends them to the browser.
- Postgres: `DATABASE_URL`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL` and `MAIL_FROM`.
- Public address and port: `APP_PUBLIC_URL` and `APP_PUBLIC_PORT`.
- Grading routes: `GRADING_ROUTES`, set to `on` to enable them.
- Timings, with their defaults (the verifier sets these low):
  - `VERIFY_DELAY_MS` (default 0);
  - `SIGNIN_LINK_TTL_SECONDS` (default 900);
  - `REJOIN_SECONDS` (default 30);
  - `FINISH_GRACE_SECONDS` (default 60).

### Server boundary (DP-20, DP-43, DP-44, DP-48)

- **Origin.** Everything is same-origin, and the server sends no CORS allow headers. A state-changing request whose `Origin` header names another origin answers `403 FORBIDDEN_ORIGIN`.
- **Media type.** POST and PATCH bodies must be `application/json`, otherwise the request answers `415 UNSUPPORTED_MEDIA_TYPE`. The finish request's body is never refused for its content.
- **Body size.**
  - A body may be at most 65,536 bytes (that size allowed).
  - The finish request may be at most 1,000,000 bytes (that size allowed), counted on the raw bytes as received.
  - Larger bodies answer `413 PAYLOAD_TOO_LARGE`, and nothing is stored. For a finish request, no object is written and the run stays `started`.
- **Files served.** The server serves only the built client files and the routes above. Source files, `.env` files, `package.json`, lockfiles and server code answer `404`. No credential or service URL appears in any client file or response.
- **Request state.** Nothing about one request (the player, the session, a run being verified, a race model in progress) is held where a concurrent request of another player can read or change it.
- **Boot.**
  - If Postgres is unreachable at boot, the server retries every second and starts listening once its schema is applied.
  - If MinIO or Mailpit is unreachable at boot, the server starts normally and serves their outage behaviour.

### Browser support and performance (DP-02, DP-13, DP-42)

- **Browsers.** Current Chromium, Firefox and Safari on desktop, and current mobile Safari and Chrome for the non-race screens. Headless Chromium with software WebGL 2 must render the race and the 3D car. There is no WebGPU path, and service workers are not used for anything a player needs.
- **Viewports.** The published viewports are 375 by 812, 768 by 1024 and 1280 by 800. Racing needs at least 1,024 pixels of width.
- **Responsiveness.**
  - The garage and the boards are usable within 3 seconds of navigation on the grading machine.
  - The race holds 60 model steps per second of page time even when drawing is slower, because model steps are independent of drawn frames.
  - Each scene draws at most one track ribbon and four cars.

## Working rules

- IF-01: `/app/run.json` contains exactly the string keys `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package and every bundled font, each with its name, version and licence. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Shipped packages and fonts use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1 licences.
- IF-04: The only datastores are the provided Postgres database and MinIO bucket. There is no SQLite, Redis or on-disk game state, and the browser stores no game state beyond the session cookie.
- IF-05: No downloaded 3D models, images, textures or audio ship with the app. Cars and tracks are built in code, and icons come from the Lucide icon package.
- IF-06: The browser loads nothing from another origin at runtime. Fonts and icons are bundled from npm packages.
- IF-07: All server and client source is TypeScript.
- IF-08: The provided dev service definitions for postgres, minio and mailpit are left unchanged.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript with no `any` escape hatches. Names match the domain terms in this brief: run, replay, replay file rules, ledger movement, counter account, stage, refit, reference lap, reference driver, sweep, purchase attempt, held push, loaner, lobby, held, step limit.
- Each domain rule is decided in exactly one place in the source:
  - the race model step and the reference driver's pedal choice;
  - the replay file rules and lap validity;
  - each payout amount;
  - each run or lobby state transition, including countdown cancellation;
  - the balance as the ledger sum;
  - league completion and eligibility;
  - the next-address rule;
  - the refit refund;
  - when a purchase attempt starts and ends, and so which idempotency key a request carries;
  - which board response or push may render.
- The per-player serialisation of balance and championship changes happens in one place, and every change it covers goes through it.
- Race model and verification state is created per run and never shared at module or process level.
- No abstraction has only one implementation, and no interface, factory or wrapper exists only for a single caller.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Every API error is produced through one error shape and one precedence order.
- Money-like and time-like values are integers in their stored unit (coins, milliseconds, steps). Display conversions happen only at the edge.
- No feature, endpoint or screen goes beyond this brief.
