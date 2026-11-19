# Cinderlatch Games Holdfast Nights

Holdfast Nights is a browser game and night scheduler for Cinderlatch Games, a one-person studio that runs a weekly live game night for a few dozen regulars. It has two modes. In co-op siege, up to four players hold a yard against waves of enemies. In convoy racing, up to four drivers run server-timed laps. It also has a weekly night calendar with sign-ups and reminder emails. The server simulates and referees every rule. Rooms expose exact numbers (remaining milliseconds, ammo, credits, positions) that the browser shows and a test can read. Build it on three backend services: Postgres for everything durable, Valkey for the live room registry, seat leases and report dedupe, and Mailpit for confirmation and reminder emails. Out of scope: passwords, email-verified accounts, payments in real money, chat, matchmaking across rooms, spectator video, and any datastore beyond those three services. Players identify themselves with a callsign only. The founder unlocks founder tools with the seeded studio key.

## Problem and users

Today the founder posts the start time in a chat-platform event. The time shows in the creator's zone and drifts when daylight saving changes. Sign-ups live in a spreadsheet. Match rules are trusted to the game client, so a shot report replayed after a reconnect gets counted twice and a speed-hacked lap tops the board. Ammo-station prices are edited by hand minutes before a night. The founder pays for this in disputed results, in regulars who miss a night because the start time moved, and in hours spent refereeing in chat. Holdfast Nights replaces all of it. The server decides every timer, hit, credit, lap and deadline, and the calendar is kept in the studio's own time zone.

- **Studio founder-host** (weekly): schedules weekly siege and convoy nights in the studio's time zone, schedules ammo-station price changes ahead of time, and runs a room as host on a night. If the founder drops, hosting passes to a teammate.
- **Squad player** (weekly): joins a room by code, readies up, survives waves, spends credits between waves, revives teammates, and recovers from a dropped connection mid-wave without being counted twice.
- **Convoy racer** (weekly): drives the checkpoints in order for server-timed laps, and can read the wreck and reset rules.
- **Phone spectator-sign-up** (occasional): signs up for a night on a phone before the server-decided deadline and gets a confirmation and a reminder email that print the time in both their zone and the studio's.

## Journeys

1. **Founder schedules the month.** Start state: the founder is on the title screen with no session. They save a callsign with the studio key and open Nights. They schedule a new weekly siege series on Fridays at 20:00 studio time for eight weeks, which sits alongside the seeded series as its own nights. Then they schedule an ammo-pack price change for 19:30 on a coming Friday. End state: the Nights list shows each Friday at 20:00 studio time, including the weeks after a daylight-saving change. The price schedule shows the pending change with a countdown to its effective moment.
2. **Phone sign-up.** Start state: a spectator opens the Nights link on a phone in a different time zone from the studio. They pick the next Friday night, enter a name and email, and submit. End state: the screen confirms the sign-up, and a confirmation email arrives that prints the studio time and their own time. One hour before the start, a reminder email arrives in the same form. A second submit with the same email does not create a second sign-up. After the deadline the form shows that sign-ups are closed.
3. **A siege night.** Start state: a player with a callsign is on the title screen. They start a room, share the code, and teammates join and ready up. The host starts the match. The squad fights wave 1, buys from the ammo station during the intermission, and fights on. End state: the HUD shows the server's ammo, health, credits and wave timer throughout, and the intermission shows the ammo station with current prices.
4. **Dropped connection.** Start state: a player is mid-wave with shots buffered. Their connection drops and comes back within the grace period. The client replays its buffered reports. End state: the seat is still theirs, and each report counted once toward ammo, damage, credits and score. When the host is the one who drops, the earliest remaining teammate becomes host and the HUD announces it.
5. **Down, revive, boss, debrief.** Start state: a squad is in a wave. A teammate goes down, and the player reaches them and revives them before the revive window runs out. The squad clears the boss wave. End state: a Debrief panel shows the result and each player's score, kills and credits earned, and History lists the match.
6. **Convoy laps.** Start state: a racer has joined a convoy room. They drive the checkpoints in order, crash into the island once, wait for the reset, and finish three laps. End state: each lap time shown is the server's, the crash put the car back at the last checkpoint after the reset timer, and the best lap appears on the Lap board. A pose that jumps farther than the car could travel is refused.
7. **Tuning controls on any device.** Start state: a player on a laptop opens Settings. They remap Fire, turn on Reduce effects, and set the volume. On a phone they play with the touch sticks and the Fire and Reload buttons. End state: the bindings and comfort choices persist after a reload. With reduced effects the stage stops shaking and the numerals stop rolling, but every readout still shows.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Pre-match notice panel** On first load a modal notice panel offers Calm effects or Enter before anything else is interactive, and the choice persists so the panel does not return.
- **DP-02 — Title screen** The title screen shows the Holdfast pixel wordmark, the start-a-room bar, two title menu link rows and the build and tick stamp, and each control opens its screen.
- **DP-03 — Callsign sessions** A player starts a session with a callsign, and the seeded studio key grants the founder role, as specified in API.
- **DP-04 — Service status banner** The server reports each dependency as up or down, and every screen shows a truthful banner while one is down and clears it after recovery, within the delays in Server boundary.
- **DP-05 — Room creation** A signed-in player creates a siege or convoy room with a unique short code and becomes its host, and a founder's room is linked to a live night of the same mode.
- **DP-06 — Joining by code** A player joins a lobby by code into the lowest free seat, a repeated join returns the same seat, and full, mid-match and unknown rooms are refused with their published errors.
- **DP-07 — Invite expiry edge** A room's invite accepts new joins strictly before its expiry instant and refuses them from that instant on.
- **DP-08 — Ready-up and start** Seated players toggle ready in the lobby, and only the host can start, only when every seated player is ready, which begins the server countdown.
- **DP-09 — Lobby to first wave** In the browser a player starts a room, a second player joins by code, both ready up, the host starts, and both screens move from lobby through countdown to wave 1.
- **DP-10 — Server-moved players** Players send movement intents with sequence numbers, the server moves them at the published speed and never into solid blocks, and stale sequence numbers are ignored.
- **DP-11 — Fire interval and reload** A shot faster than the fire interval, during a reload, or with an empty magazine is rejected with its published reason and changes no ammo, and a reload refills from reserve after the reload duration.
- **DP-12 — Shot resolution** The server resolves each accepted shot along the aim angle, so it hits the first enemy or barrel in range unless a solid block is in the way, and applies the published damage.
- **DP-13 — Room state and stream** The room state reports phase, every remaining-milliseconds timer, players, enemies, barrels, grenades, shop prices and recent events, both on request and as a stream at the server tick rate.
- **DP-14 — Combat HUD** In the browser the HUD shows the server's health, ammo, grenades, credits, wave and timers, and they change when the player fires, reloads and kills an enemy.
- **DP-15 — Report ids apply once** Each shot, reload, grenade or revive report id changes the game at most once, and a replay returns the stored outcome.
- **DP-16 — Report conflicts and races** A reused report id with a different body is refused as a conflict, and identical reports sent at the same moment are applied exactly once with identical responses.
- **DP-17 — Reconnect replay** In the browser a player who loses the connection mid-wave sees the reconnecting notice, regains the seat, and after replaying buffered reports sees ammo, credits and score counted once.
- **DP-18 — Wave progression** A siege runs three waves, each followed by a timed intermission, then a boss wave, with the spawns, bonuses and timings in Business rules and Seed data.
- **DP-19 — Enemy behaviour** Enemies move through patrol, detect, pursue, attack and dead under the published ranges, speeds and damage.
- **DP-20 — Grenade splash** A grenade detonates when its server fuse ends and damages enemies and barrels with the published falloff by distance, except where a solid block is in the way.
- **DP-21 — Barrel chain reactions** A barrel brought to zero health explodes once, and chained explosions resolve in the published order within the same tick, each one logged.
- **DP-22 — Match history** A finished match is stored with its result and each player's score, kills and credits earned, and History lists matches newest first across restarts.
- **DP-23 — Siege run to debrief** In the browser a squad that clears the boss wave sees the Debrief panel with the server's results and finds the match in History.
- **DP-24 — Downed and revive window** A player at zero health is downed with a revive window, and a nearby teammate's revive succeeds only while the window has time left.
- **DP-25 — Out, respawn and defeat** A downed player whose window runs out is out until the next intermission, and the match ends in defeat when no player is up.
- **DP-26 — Reviving a teammate** In the browser a player sees a downed teammate's revive window, moves close and revives them, and both screens show the teammate up again.
- **DP-27 — Paired credit ledger** Every credit movement writes two opposite entries, each balance equals the sum of its entries, and a match's entries sum to zero.
- **DP-28 — Shop hours and purchases** Purchases succeed only during an intermission, at the price in effect at the server moment of purchase, and are idempotent by purchase id.
- **DP-29 — Ammo station drawer** In the browser the ammo station drawer opens during an intermission, buys by keyboard or pointer, updates credits and ammo, and closes when the next wave starts.
- **DP-30 — Seat leases and reconnect grace** A seat with no traffic for the lease time becomes disconnected and is held for the reconnect grace, which a returning player meets strictly before it runs out.
- **DP-31 — Host migration** When the host disconnects or leaves, hosting passes at once to the connected player in the lowest seat, and the change is logged.
- **DP-32 — Dropped host takeover** In the browser, when the host drops, the next player sees that they are now host and can use the host-only controls.
- **DP-33 — Convoy laps and checkpoints** Convoy racers pass checkpoints only in order, and the server times each lap on its own clock for three laps.
- **DP-34 — Pose speed check** A pose that moves farther than top speed allows for the server time elapsed is rejected and leaves the vehicle unchanged.
- **DP-35 — Wreck and reset** A pose inside a solid block or outside the map wrecks the vehicle, and after the reset delay it is placed at its last passed checkpoint facing the next one.
- **DP-36 — Lap board** Completed laps are stored, and the Lap board lists each racer's best lap, fastest first, across restarts.
- **DP-37 — Driving a convoy lap** In the browser a racer drives one full lap and sees the checkpoint counter, the server lap time, any wreck reset and the new entry on the Lap board.
- **DP-38 — Weekly nights in the studio zone** The founder schedules a weekly series as a weekday and local wall time in the studio zone, and each night's date is its studio-local date.
- **DP-39 — Skipped and repeated hours** A night whose local time falls in a skipped or repeated hour follows the published rule, and every other week keeps its wall-clock time across daylight-saving changes.
- **DP-40 — Night status from the server clock** Each night's status and the time until it changes come from the server clock, and the browser shows them even when the device clock is wrong.
- **DP-41 — Nights screen in two zones** In the browser the Nights list groups nights by studio date and shows each start in studio time and the viewer's time, and the founder schedules a series from it.
- **DP-42 — Effective-dated prices** The founder schedules ammo-station price changes at a studio-local instant, a purchase from that instant on pays the new price, and past purchases keep the price they paid.
- **DP-43 — Scheduling a price change** In the browser the founder schedules a price change, sees it pending with a countdown, removes a pending one, and cannot remove one in effect.
- **DP-44 — Sign-up window edges** Sign-ups are accepted from the opening instant and strictly before the closing instant, up to the night's capacity, with exactly the free seats won under contention.
- **DP-45 — One sign-up per email** A repeated sign-up for the same night with the same email returns the existing sign-up and sends no second email.
- **DP-46 — Confirmation and reminder emails** Each sign-up gets one confirmation and one reminder email that print the night in studio time and the viewer's time.
- **DP-47 — Mail outage queue** While mail is down, sign-ups still succeed with the email queued, and each queued email is sent exactly once after mail returns, without a restart.
- **DP-48 — Phone sign-up** On a phone viewport a spectator opens Nights, signs up for a night, and sees the confirmation copy and the deadline timer from the server.
- **DP-49 — Pause menu sections** The pause menu and Settings show Game, Controls, Audio and Comfort sections, and a collapsed section is hidden, unfocusable and absent from the accessibility tree.
- **DP-50 — Key remapping** Players remap every action to a key, conflicts are refused with the published message, and bindings persist in their settings.
- **DP-51 — Keyboard-complete dialogs** Every dialog and drawer traps Tab and Shift+Tab, closes on Escape, returns focus to its opener, and game keys work whichever HUD control has focus.
- **DP-52 — Tuning comfort and controls** In the browser a player opens the pause menu by keyboard, remaps Fire, turns on Reduce effects, resumes, and finds both choices kept after a reload.
- **DP-53 — Fuse Clock** Every server-decided timer shows as a Fuse Clock numeral that follows the server's remaining milliseconds, re-flows to each snapshot, resolves to its outcome at zero, and appears in the Timers list.
- **DP-54 — Reduced effects** Under reduced motion or Reduce effects, the stage drift, shake, camera bob, numeral rolls and splits stop, and every value, outcome and announcement stays.
- **DP-55 — Touch controls** On touch devices the HUD shows move and aim sticks and Fire, Reload, Grenade and Pause buttons that drive the same server actions as the keyboard.
- **DP-56 — Responsive layers** Every screen fits 375x812, 768x1024 and 1280x800 as fixed layers over the stage, with no document scroll or horizontal overflow and with tap targets of at least 44 px.
- **DP-57 — Siege field stage** A live 3D block-field stage sits behind every screen, with the published idle motion, input response, reduced-motion stillness and a still fallback without WebGL.
- **DP-58 — Server boundary** The server serves same-origin only, enforces the body-size and content-type limits, never serves source or credentials, and boots and recovers with dependencies down.
- **DP-59 — Credentials from the environment** Every service URL and credential is read from the environment at start and never hard-coded or sent to the browser.
- **DP-60 — Visual design** Screens carry the dark teal tactical-terminal look with the pixel display face, the condensed body face, smoked-glass panels and mint kept for primary actions.

## Frontend

### Screens and layout (DP-01, DP-02, DP-09, DP-14, DP-23, DP-29, DP-37, DP-41, DP-48, DP-49, DP-56)

The whole app is one fixed full-viewport stage with no document scroll. The three.js siege field stage fills the window. Everything else floats over it as fixed layers: the title screen, panels, the HUD, drawers and dialogs. No layer causes horizontal overflow at 375x812, 768x1024 or 1280x800. Spacing between and inside panels follows one compact step scale, from tight gaps inside rows to wider padding inside panels.

Routes: `/` opens the title screen. `/nights` opens the title screen with the Nights panel open. `/room/<code>` opens the title screen with the Join by code panel filled with `<code>`. All three show the pre-match notice panel first if no choice is stored.

- **Pre-match notice panel.** A modal panel centred over the panel blur scrim, which dims and blurs the stage and title screen so they stay recognisable but cannot be clicked. It holds an uppercase title, two short original paragraphs about flashes, shake and moving numbers, and a right-aligned button row with the ghost choice button first and the mint action button second. It is about a third of the width on desktop, about two thirds on tablet, and the full width minus a small margin on phones.
- **Title screen.** One centred column. The Holdfast pixel wordmark sits in the upper third: about 40% of the viewport width on desktop and tablet, and the full width minus margins on phones, never cropped. The start-a-room bar sits beneath it, wide and tall, the loudest element on screen. The title menu link rows follow below: two centred rows of small uppercase link-buttons, each with a small leading line glyph. On phones each row may wrap to two lines while staying centred. The build and tick stamp is pinned to the bottom-right corner on every viewport.
- **Panels (Callsign, Join by code, Nights, History, Settings, Lobby, Debrief).** Smoked-glass panels centred over the stage. On desktop they are about 440 px wide (Nights and History about 640 px), on tablet about 70% of the width, and on phones the full width minus a small margin. A panel taller than the viewport scrolls inside itself, never the document.
- **Lobby.** A panel showing the room code as a heading, the Invite expires timer, the seat list, and a button row: Ready, Start match (host only), Copy invite, Leave room.
- **Siege HUD.** Four corners over the stage. Top-left: wave label and phase timer. Top-right: credits and score. Bottom-left: health meter and status. Bottom-right: ammo, grenades and the reload timer. The match feed sits under the top-left group, and the Shop, Timers and Pause buttons sit in a row at the top centre. On phones the readouts compress into one top row, and the bottom corners hold the touch sticks with the action buttons clustered above the right stick.
- **Convoy HUD.** Lap counter, lap timer, next-checkpoint counter and best lap at the top. Reset timer in the centre while wrecked. The same Timers and Pause buttons.
- **Ammo station drawer.** A drawer anchored to the right edge on desktop and tablet (about 360 px wide) and a bottom sheet about 70% of the height on phones. It lists each item with its current price, any pending price countdown, and a buy button.
- **Pause menu and Settings.** The same centred panel: an accordion of sections (Game in the pause menu only, then Controls, Audio, Comfort), one open at a time.
- **Nights.** A list of upcoming nights grouped under studio-date headings. Each row shows the title, mode, studio time, viewer time, status, seats left, the Sign-ups close timer and a sign-up button. Founders also see a New weekly night button and the Ammo station prices region with its schedule table.
- **History.** Two tabs, Matches and Lap board, each a compact table. On phones the Started and Room columns of Match history are hidden, and the rest stay readable without sideways scrolling.
- **Debrief.** A panel with the result heading, the squad results table and two buttons.

Empty states are one short line inside the panel, for example "No matches yet." in History and "No nights scheduled." in Nights. Error states are a short line inside the panel, in the same voice, followed by a ghost choice button that retries.

### Public screens and controls (DP-01, DP-02, DP-03, DP-09, DP-14, DP-17, DP-23, DP-26, DP-29, DP-32, DP-37, DP-41, DP-43, DP-48, DP-49, DP-50, DP-53, DP-55)

Only the roles and names below are public. Everything else is free. `<…>` placeholders come from the server.

| Region or control | Role and accessible name | Visible copy |
|---|---|---|
| Pre-match notice panel | `dialog "Before you play"` | title "BEFORE YOU PLAY" |
| ghost choice button | `button "Calm effects"` | "Calm effects" |
| mint action button | `button "Enter"` | "Enter" |
| panel blur scrim | not exposed; it blocks pointer input to everything beneath | none |
| Holdfast pixel wordmark | `img "Holdfast Nights"` | the pixel mark |
| start-a-room bar | `button "Start a room"` | "START A ROOM" |
| title menu link rows | `button "Join by code"`, `button "Convoy race"`, `button "Nights"` (row 1); `button "History"`, `button "Settings"`, `button "Callsign"` (row 2) | uppercase labels |
| build and tick stamp | `status "Build"` | `build <build> · <tick_hz> Hz` |
| service banner | `status "Service status"` | copy from Feedback states, empty when all services are up |
| global notices | `status "Notices"` | copy from Feedback states |
| callsign panel | `dialog "Callsign"` with `textbox "Callsign"`, `textbox "Studio key"`, `button "Save callsign"` | |
| join panel | `dialog "Join by code"` with `textbox "Room code"`, `button "Join room"` | |
| lobby | `region "Lobby"`, `heading "Room <code>"`, `list "Seats"` | each item: `Seat <n> · <callsign> · Ready` or `Not ready`, with ` · Host` and ` · Disconnected` appended when true |
| lobby buttons | `button "Ready"` (`aria-pressed` true when ready), `button "Start match"` (host only, disabled until everyone is ready), `button "Copy invite"`, `button "Leave room"` | |
| HUD | `region "HUD"` | |
| HUD readouts | `group "Wave"` | `Wave <n> of 3`, `Intermission`, `Boss wave` or `Countdown` |
| | `meter "Health"` (value 0–100) | `<hp>` |
| | `group "Ammo"` | `<mag> / <reserve>` |
| | `group "Grenades"` | `<grenades>` |
| | `group "Credits"` | `<credits> cr` |
| | `group "Score"` | `<score>` |
| | `group "Status"` | `Up`, `Downed` or `Out` |
| HUD buttons | `button "Shop"` (enabled only in an intermission), `button "Timers"` (`aria-expanded`), `button "Pause"` | |
| match feed | `status "Match feed"` | outcome copy from Feedback states |
| Timers list | `list "Timers"` | one `listitem` per active timer: `<timer name> <value>` |
| Fuse Clock numerals | `timer "<timer name>"`, attribute `data-server-ms` = the latest server value | the formatted value from Motion and effects |
| Fuse Clock timer names | Countdown, Intermission, Reload, Grenade fuse, Revive window <callsign>, Reconnect grace, Invite expires, Sign-ups close, Price change <item>, Reset, Lap | |
| ammo station drawer | `dialog "Ammo station"` with `button "Buy <item name> — <price> cr"` per item, `button "Close"` | |
| debrief | `dialog "Debrief"`, `heading "Victory"`, `"Defeat"` or `"Ended"`, `table "Squad results"` (Callsign, Score, Kills, Credits earned), `button "Back to title"`, `button "View history"` | |
| convoy HUD | `group "Lap"` | `Lap <n> of 3` |
| | `group "Checkpoint"` | `Next checkpoint <n> of 4`, or `Finish` when the start/finish line is next |
| | `group "Best lap"` | `<m:ss.mmm>` or `—` |
| | `timer "Lap"`, `timer "Reset"` | |
| pause menu | `dialog "Paused"` | |
| settings | `dialog "Settings"` | |
| accordion headers | `button "Game"` (pause menu only), `button "Controls"`, `button "Audio"`, `button "Comfort"`, each with `aria-expanded` | |
| Game section | `button "Resume"`, `button "Leave room"` | |
| Controls section | `button "Remap <Action>"` per action, with the current key label as visible text beside it; `button "Reset to defaults"` | Action names and the key label rule in Interactions |
| Audio section | `slider "Master volume"`, `slider "Effects volume"` (0–100) | |
| Comfort section | `switch "Reduce effects"`, `switch "Screen shake"`, `switch "Camera bob"` | |
| touch controls | `group "Move stick"`, `group "Aim stick"`, `button "Fire"`, `button "Reload"`, `button "Grenade"`, `button "Pause"` | |
| stage | `img "Block field"` (title), `img "Siege field"` (siege), `img "Saltpan Loop"` (convoy) | |
| nights panel | `dialog "Nights"`, `list "Upcoming nights"`, a `heading` per studio date `<Ddd D Mon YYYY>` | |
| night row | `heading "<title>"`, text `<HH:MM> <abbr> studio · Your time <Ddd D Mon> <HH:MM> <abbr>`, status text, `Seats left <n>`, `timer "Sign-ups close"`, `button "Sign up for <title> on <Ddd D Mon>"` (disabled unless sign-ups are open) | status text: `Opens soon`, `Sign-ups open`, `Sign-ups closed`, `Live now`, `Done` |
| sign-up panel | `dialog "Sign up"`, `textbox "Name"`, `textbox "Email"`, `combobox "Your time zone"`, `button "Sign me up"` | |
| founder: series | `button "New weekly night"` opens `dialog "New weekly night"` with `textbox "Title"`, `combobox "Mode"`, `combobox "Weekday"`, `textbox "Start time"`, `textbox "First date"`, `spinbutton "Weeks"`, `spinbutton "Capacity"`, `button "Schedule nights"` | Mode options `Siege`, `Convoy`; Weekday options `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`, `Saturday`, `Sunday`; Start time typed as `HH:MM`, 24-hour, e.g. `20:00`; First date typed as `YYYY-MM-DD` |
| founder: prices | `region "Ammo station prices"`, `table "Price schedule"` (Item, Price, Effective (studio), Status), `button "Schedule price change"` opens `dialog "Schedule price change"` with `combobox "Item"`, `spinbutton "New price"`, `textbox "Effective (studio time)"`, `button "Save price change"`; each pending row has `button "Remove <item name> change at <YYYY-MM-DD HH:MM>"` and `timer "Price change <item name>"` | Status: `In effect`, `Pending`, `Superseded`; Item options `Ammo pack`, `Grenade`, `Med kit`; Effective typed as `YYYY-MM-DD HH:MM` studio time, e.g. `2026-11-20 19:30`, with a `T` in place of the space also accepted |
| history | `dialog "History"`, `tablist "History"` with `tab "Matches"` and `tab "Lap board"`, `table "Match history"` (Started, Ended, Room, Mode, Result, Waves cleared, Squad), `table "Lap board"` (Rank, Callsign, Best lap, Set on) | Started and Ended `<Ddd D Mon> <HH:MM> <abbr>` in studio time; Room is the room code; Mode `Siege` or `Convoy`; Result `Victory`, `Defeat`, `Ended` or `Finished`; Waves cleared is the number, or `—` for convoy; Squad lists the players in seat order joined by ` · `, each as `<callsign> <score>` for siege or `<callsign> <best lap>` for convoy, where best lap is `m:ss.mmm` or `—`; Lap board Best lap `m:ss.mmm` and Set on `<Ddd D Mon YYYY>` as the studio date |

Field errors sit directly under their field and are linked to it as its description.

### Interactions (DP-01, DP-09, DP-10, DP-14, DP-17, DP-26, DP-29, DP-32, DP-37, DP-41, DP-43, DP-48, DP-49, DP-50, DP-51, DP-52, DP-55)

- **Pre-match notice panel.** It opens on load whenever no choice is stored in the browser. Initial focus goes to Enter, or to Calm effects when the system asks for reduced motion. Enter stores the choice "standard" and closes the panel. Calm effects stores "calm", turns Reduce effects on (also in the player's settings once signed in), and closes. Escape acts as Enter. After closing, focus moves to the start-a-room bar.
- **Session-gated actions.** Start a room, Convoy race and Join room open the Callsign panel first when there is no session, then continue the original action after Save callsign succeeds.
- **Start a room / Convoy race.** Creates a siege or convoy room. The control is disabled while the request is pending, so a double click makes one request. On success the Lobby opens.
- **Lobby.** Ready toggles readiness. Start match is enabled only for the host and only when every seat is ready. Copy invite puts `<origin>/room/<code>` on the clipboard. Leave room returns to the title screen. The lobby re-renders from each server snapshot.
- **In-match keys (defaults, all remappable except Pause).** The actions and default keys are: Move up W, Move down S, Move left A, Move right D, Aim left Q, Aim right E, Fire Space, Reload R, Grenade G, Revive F, Shop B, Timers T. Pause is always Escape. Holding Fire repeats shots no faster than the fire interval. Aim left and Aim right turn the aim at a steady half turn per second. Grenade throws at the point 8 m ahead along the aim. Revive targets the nearest downed teammate. With a mouse, the aim follows the pointer, a click fires, and a right click throws a grenade at the pointer (clamped to grenade range). Game keys work whichever HUD control has focus. They are ignored only while a text field, slider or remap capture has focus or a dialog other than the HUD is open.
- **Touch.** Dragging the Move stick sends a move intent equal to the thumb's offset divided by the stick radius. Dragging the Aim stick sets the aim to the drag direction. Holding Fire repeats shots like the keyboard. Reload, Grenade and Pause send the same actions as their keys. Releasing a stick sends a zero intent.
- **Convoy driving.** In a convoy race the movement bindings drive the car. Move up is throttle, Move down is brake and reverse, Move left steers left (heading increases) and Move right steers right (heading decreases). Aim, Fire, Reload, Grenade, Revive and Shop do nothing in a convoy room. The browser moves the car locally between poses:
  - Throttle accelerates at 10 m/s² up to 25 m/s.
  - Brake slows the car at 20 m/s². Once stopped, holding it reverses up to 8 m/s.
  - With neither held, the car coasts down at 5 m/s² to a stop.
  - Steering turns the heading at 90 degrees per second while the car moves, and not at all when stopped.
  - The position advances along the heading at the current speed.
- **Convoy poses.** While its vehicle is running in a race, the browser sends the car's position and heading as a pose every 100 ms, with `seq` increasing by one each time.
  - The browser never stops the car at the island, a block or the map edge: the car drives on through it, and the pose there reaches the server, which judges the wreck.
  - While the vehicle is wrecked or finished, the browser sends no poses and holds the car at the server's vehicle position.
  - At race start and after each reset, the car takes the server's vehicle position and heading with zero speed.
  - When a pose is refused, the car snaps to the server's vehicle position and heading.
- **Convoy touch.** In a convoy room the Move stick drives. Its upward offset is throttle and its downward offset is brake, in proportion, and its sideways offset steers in proportion. The Aim stick and the Fire, Reload and Grenade buttons are hidden there.
- **Shop.** During an intermission, B or the Shop button opens the Ammo station drawer with focus on its first buy button. Buy buttons are disabled while their purchase is pending. When the intermission ends the drawer closes on its own and focus returns to the HUD region.
- **Pause menu.** Escape or the Pause button opens Paused with the Game section expanded. Pausing does not stop the match: the server keeps running and the HUD behind keeps updating. Resume, or Escape again, closes it.
- **Accordion.** Activating a header expands its section and collapses the one that was open. A collapsed section's contents are hidden, cannot take focus, and are absent from the accessibility tree at every viewport. Moving them off-screen does not count as collapsing. The same holds for the closed Ammo station drawer, the closed Timers list and every closed dialog.
- **Remapping.** Activating `Remap <Action>` enters capture: the button text becomes "Press a key…" and the next key press becomes the binding. Escape cancels capture and keeps the old key. A key already bound to another action is refused with the remap-conflict copy, and the old binding stays. Each successful change saves the settings. Reset to defaults restores the default keys. Escape and Tab cannot be bound: Escape cancels capture, and Tab leaves it unchanged and moves focus.
- **Key labels.** A key's visible label, also used as `<Key label>` in the remap-conflict copy, comes from its keyboard `code` as follows:
  - `KeyA` to `KeyZ` show the upper-case letter, e.g. `W`.
  - `Digit0` to `Digit9` show the digit, e.g. `1`.
  - Every other code shows the code with a space inserted wherever a lower-case letter is followed by an upper-case letter or a digit, e.g. `Space`, `Arrow Up`, `Shift Left`, `Numpad 1`, `Bracket Left`, `F5`.
- **Dialogs and drawers.** Every open dialog or drawer keeps Tab and Shift+Tab inside it, wrapping from its last control to its first and back. Escape closes it (except the pre-match notice panel, which treats Escape as Enter). On close, focus returns to the control that opened it. Every focusable control shows a visible focus ring in the accent colour. Dialogs opened from another dialog stack, and closing the top one returns focus inside the one below.
- **Reconnect.** When the snapshot stream drops, the client keeps buffering the reports the player makes, shows the reconnecting notice and the Reconnect grace timer, and retries about every second. When it reconnects it sends the buffered reports in one batch, in the order made, then shows the reconnected notice. Re-sent reports that the server already applied are expected and harmless.
- **Nights.** Rows refresh every 10 seconds, and again as soon as any timer on the screen reaches zero. The time-zone combobox defaults to the browser's zone and lists IANA zone names. Sign me up is disabled while pending. Founders' scheduling dialogs follow the same dialog rules. They send the Mode, Weekday and Item choices as the API's lower-case values, and the Effective value with its space replaced by `T`. A Start time, First date or Effective value in any other shape shows that field's error from Feedback states without sending a request.
- **Timers list.** T or the Timers button toggles the read-only list. It shows the same values as the Fuse Clock numerals and updates with each snapshot.
- **History.** Tabs switch with the arrow keys and with Enter or Space. Only the selected tab panel is visible and focusable.

### Visual design (DP-02, DP-56, DP-60)

The direction is the seed's dark teal tactical-terminal stage. It is terse like a tactical terminal, dark teal like a night-vision stage, and compact like a HUD.

- **Type.** Pixelify Sans is the display face, used for the wordmark fallback text, panel headings and the Fuse Clock numerals. Chakra Petch is the body face for everything else, used small and compact, with labels and panel titles in uppercase with wide letter spacing. Each heading level is about 15% larger than the level below. The wordmark is several times larger than any heading. Every numeral uses tabular (fixed-width) figures so timers never jitter sideways.
- **Colour roles.**
  - Ground: a near-black with a teal cast behind everything.
  - Surface: a slightly lifted dark teal used, half see-through, for the smoked-glass panels.
  - Ink: a cool near-white for headings and body text.
  - Accent: a pale mint for the primary action border and label, the panel edge glow and focus rings.
  - Muted ink: a soft sage green for menu links and secondary labels.
  - Dim ink: a deep grey-green for the build stamp, lightened if needed to meet contrast.
  - Hairline: a deep teal-green for the thin panel borders.
  - Primary fill: a dark forest green inside primary buttons.
  - Primary bar: a saturated emerald that fills the start-a-room bar.
- **Accent discipline.** Mint marks primary actions, focus and the panel edge, never body text or decoration. The emerald appears only on the start-a-room bar and the health meter at full.
- **Components.**
  - Smoked-glass panels have rounded corners, a one-pixel hairline border that brightens towards mint, a soft deep shadow beneath, and a light blur of the stage behind them.
  - The mint action button has a dark green fill, a mint border and a bold near-white label. On hover the border goes full mint and the fill lifts a step. On press it sinks slightly.
  - The ghost choice button has a faint grey border and a grey label. On hover the border turns teal-green and the label turns mint.
  - Buttons have small rounded corners. The start-a-room bar is a solid emerald slab with barely rounded corners.
  - The title menu link rows are borderless uppercase labels in muted ink that turn mint on hover and show a thin mint underline on keyboard focus.
- **Wordmark.** The Holdfast pixel wordmark is an original grid of square pixels spelling "Holdfast" in a light grey, with a few loose pixels breaking off its left edge like debris. "NIGHTS" sits beneath it in small uppercase tracked body type.
- **Hero.** The title screen is the hero. The wordmark sits centred in the upper third, the emerald start-a-room bar sits beneath it, the two link rows sit below that, and the build stamp sits in the bottom-right corner. Behind it all, the procedural low-poly teal block field sits under a strong dark vignette and faint vertical streaks.
- **Working screens.** Lists, tables, forms, the HUD, empty states and error states all use the same smoked-glass panels, small Chakra Petch type, hairline row separators inside tables, and mint only on the primary action. Empty and error states are a single short line in the same voice.
- **Density and size.** The layout is compact. Every interactive control has a hit area of at least 44 by 44 px, even where the visible button is slimmer.
- **Contrast.** All text and essential icons meet WCAG 2.2 AA contrast against what is actually behind them.
- **Risk.** The look is a small-type, pixel-wordmark UI where the game is a dense terminal HUD. Everything stays quiet so the timers carry the load.

### Motion and effects (DP-01, DP-53, DP-54, DP-57)

- **Panel entrance.** Panels and dialogs fade in while growing very slightly from just under full size, in about a fifth of a second, starting fast and settling softly. They exit with a quick fade in about a tenth of a second.
- **Blur scrim.** The scrim fades its dimming and blur in and out over about a fifth of a second.
- **Hover and press.** Colour and border changes ease over about a fifth of a second. A press sinks the control by a hair over about a tenth of a second.
- **Fuse Clock (signature).** Every server-decided timer is one family of numerals in the display face: reload, grenade fuse, revive window, countdown, intermission, reconnect grace, invite expiry, reset, lap, price-change countdown and sign-up deadline.
  1. Each numeral's text is its remaining milliseconds formatted as follows. Under one minute: seconds with one decimal, rounded down to the tenth, e.g. `12.3`. Under one hour: `m:ss`. Under one day: `h:mm:ss`. Otherwise: `<d>d hh:mm`. The counting-up Lap timer shows `m:ss.d`.
  2. Between snapshots the numeral counts down from the latest server value. Each digit that changes rolls upward into place within about a tenth of a second.
  3. When a snapshot's value disagrees with the local estimate, the digits re-flow to the server value within about a fifth of a second, and `data-server-ms` takes the snapshot value at once. The displayed value never differs from the latest server value by more than 150 ms of countdown.
  4. At zero the numeral splits apart over about a third of a second and is replaced by its outcome word: Reload "reloaded", Grenade fuse "detonated", Revive window "revived" or "out", Countdown and Intermission "go", Reset "reset", Invite expires "expired", Reconnect grace "released", Sign-ups close "closed", Price change "new price". The outcome word stays for one to two seconds and is announced in the match feed or notices.
  5. The values shown are always the server's. The Timers list shows the same values without motion.
- **Siege field stage.** A three.js scene of simple low-poly teal blocks on a dark grid under a radial vignette with faint vertical streaks.
  - On the title screen, the camera drifts slowly around the field, completing one full loop every 40 to 80 seconds.
  - In a match, the camera looks down from behind and above the player and follows them, and enemies, barrels and grenades move to each snapshot's positions.
  - Pointer and touch input move the aim reticle and turn the player model, also with reduced motion.
  - An explosion within 5 m of the player shakes the camera for no more than a third of a second.
  - Walking bobs the camera gently, about two steps per second.
  - When the tab is hidden, the scene stops drawing.
  - Without WebGL, the stage shows a still 2D top-down drawing of the same blocks and entities, with the same accessible names, redrawn on each snapshot. Matches stay fully playable.
- **Banned.** No decorative loops beyond the title camera drift. No looping CSS animations. No motion that is not tied to a server change, an input or the title drift.
- **Reduced motion.** Mobile, touch and reduced-motion variants are hard requirements. When the system asks for reduced motion, or the player turns on Reduce effects:
  - every loop stops, and the title camera holds still, so frames are identical over two seconds of idle;
  - shake and bob are off, and the Screen shake and Camera bob switches show off and are disabled;
  - numerals swap to their new value instantly, with no roll, re-flow or split, and the outcome word appears at once;
  - panels and the scrim appear and disappear instantly.

  Every value, outcome word and live-region announcement is unchanged, with the same function.

### Feedback states (DP-04, DP-14, DP-17, DP-26, DP-29, DP-32, DP-41, DP-43, DP-47, DP-48, DP-50)

All copy below is exact. `<…>` placeholders are filled from the server response. Pending copy appears in `status "Notices"` as soon as the request starts and is replaced by the result. Server error codes come from API.

| Action | Pending | Success | Errors |
|---|---|---|---|
| Save callsign | `Saving callsign…` | `Callsign saved — you're <callsign>.`; with a valid studio key: `Studio key accepted — founder tools unlocked.` | field `callsign`: `Use 3 to 16 letters, digits, spaces, hyphens or underscores.`; `studio_key_invalid` under Studio key: `That studio key isn't right.` |
| Start a room / Convoy race | `Starting room…` | `Room <code> is open.` | `rooms_unavailable`: `Rooms are offline right now. Try again in a minute.`; `already_in_room`: `You're already in room <code>.` |
| Join room | `Joining <code>…` | `Joined room <code> — seat <seat>.` | `room_not_found`: `No room with code <code>.`; `room_full`: `Room <code> is full.`; `match_in_progress`: `Room <code> is mid-match. Ask the host for the next one.`; `invite_expired`: `This invite expired. Ask the host for a new room.`; `seat_released`: `Your seat in <code> was released.`; `rooms_unavailable` as above |
| Ready | none | `You're ready.` / `You're not ready.` | `wrong_phase`: `The match has already started.` |
| Start match | `Starting match…` | `Match starting.` | `not_all_ready`: `Everyone must be ready first.`; `not_host`: `Only the host can start.` |
| Purchase | `Buying <item name>…` | `Bought <item name> for <price> cr.` | `shop_closed`: `The ammo station is closed until the next intermission.`; `insufficient_credits`: `Not enough credits — <item name> costs <price> cr.`; `at_capacity`: `You're carrying as many as you can.` |
| Schedule price change | `Saving price change…` | `Price change saved: <item name> becomes <price> cr at <YYYY-MM-DD HH:MM> <abbr>.` | `price_change_exists`: `A change for <item name> at that time already exists.`; field `effective_local`: `Pick a time after now, in studio time.`; field `price`: `Use a whole number from 1 to 5000.` |
| Remove price change | `Removing…` | `Price change removed.` | `price_change_in_effect`: `That price is already in effect and can't be removed.` |
| Schedule nights | `Scheduling…` | `Scheduled <count> nights of <title>.` | fields: `title` `Use 1 to 60 characters.`; `local_time` `Use HH:MM, 24-hour.`; `first_date` `Must be a <Weekday> after today, studio time.`; `weeks` `Use 1 to 26.`; `capacity` `Use 1 to 64.` |
| Sign me up | `Signing you up…` | `You're signed up for <title> on <Ddd D Mon>. Confirmation email: sent.`; or, when the email is queued: `You're signed up for <title> on <Ddd D Mon>. Confirmation email: queued — it sends when mail is back.`; on a repeat: `You're already signed up for this night.` | `signups_closed`: `Sign-ups for this night closed at <HH:MM> <abbr> studio time.`; `signups_not_open`: `Sign-ups open <Ddd D Mon> <HH:MM> <abbr> studio time.`; `night_full`: `This night is full.`; fields: `name` `Use 1 to 40 characters.`; `email` `Enter a valid email address.`; `viewer_zone` `Pick a time zone from the list.` |
| Save settings / remap | none | `Settings saved.` | remap conflict: `<Key label> is already bound to <Action>.`; capture start announces `Press a key for <Action>. Escape cancels.` |
| Any request answered 5xx other than the named outages | — | — | `Something went wrong on the server. Try again.` |

Connection and match copy:

- **Reconnect** (in `status "Notices"`): while disconnected, `Connection lost — reconnecting. Your seat is held.`; after reconnecting, `Reconnected — <n> buffered reports sent.`; if the grace ran out, `Your seat in <code> was released.`
- **Match feed** (`status "Match feed"`, polite), one line per server event:
  - `Reloaded`
  - `Grenade detonated`
  - `<callsign> is down`
  - `<callsign> revived`
  - `<callsign> is out`
  - `<callsign> is back`, on respawn
  - `Wave <n> cleared`, after waves 1 to 3
  - `Boss wave cleared`, after the boss wave
  - after waves 1 and 2, `Intermission — <s> s to wave <n+1>`, and after wave 3, `Intermission — <s> s to boss wave`, where `<s>` is the whole seconds left at the time of the event
  - `Boss wave`
  - `Victory`
  - `Defeat`
  - `<callsign> is now host`
  - `Lap <n>: <m:ss.mmm>`
  - `Wrecked — resetting at checkpoint <n>`
  - `Reset`
  - for a rejected shot: `Too fast` (fire_interval), `Reloading` (reloading) or `Empty — reload` (empty)
- **Service banner** (`status "Service status"`), one line per down service, in this order:
  - Valkey down: `Rooms offline — the room registry is reconnecting. Nights and sign-ups still work.`
  - Mail down: `Mail delayed — emails are queued and send when mail is back.`
  - Postgres down: `Storage offline — sign-ups, prices, settings and history are unavailable.`
- **In-room pause** (the room state's `degraded` is set): a banner over the HUD reads `Room paused — the room registry dropped. Timers are frozen and resume when it's back.`

## Backend

### API (DP-03, DP-04, DP-05, DP-06, DP-07, DP-08, DP-10, DP-11, DP-12, DP-13, DP-15, DP-16, DP-22, DP-27, DP-28, DP-30, DP-31, DP-33, DP-34, DP-36, DP-38, DP-40, DP-42, DP-44, DP-45, DP-58)

**General.**

- **Bodies.** Every endpoint speaks JSON (`application/json; charset=utf-8`). A request with a body must send `Content-Type: application/json`, otherwise `415 {"error":{"code":"unsupported_media_type","message":"…"}}`. Bodies may be up to 16,384 bytes, inclusive; a larger body gets `413 {"error":{"code":"body_too_large","message":"…"}}`. Malformed JSON gets `400 {"error":{"code":"bad_json","message":"…"}}`.
- **Error shape.** Every error uses `{"error":{"code":"<code>","message":"<sentence>"}}`. Validation adds `"fields":{"<field>":"<message>"}` under status 422 with code `validation`, using the field messages from Feedback states.
- **Formats.** Instants are RFC 3339 UTC with a `Z` suffix, to the second, e.g. `2026-11-14T02:00:00Z`. Local wall times are `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS` with no offset, always in the studio zone. Ids are opaque strings. Room codes are matched case-insensitively and always returned in upper case.
- **Sessions.** Authenticated endpoints accept the session cookie `hf_session` (HttpOnly, SameSite Lax) or `Authorization: Bearer <token>`.
- **Error precedence**, for the whole API: transport errors (400, 413, 415) → `401 unauthenticated` → `404` unknown resource → `403` forbidden (role or seat) → an idempotent replay returns its stored response → `503` dependency unavailable → `409`/`410` state conflicts → `422` validation. Rows below list only their own extra errors.
- Unknown `/api/` paths get `404 not_found`. A dependency an endpoint needs that is unreachable gets `503` with code `storage_unavailable` (Postgres) or `rooms_unavailable` (Valkey); mail never fails a request.

**Platform**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | — | `200 {"status":"ok"}` whenever the process is serving | — |
| `GET /api/status` | — | `200 {"build":"<string>","tick_hz":20,"services":{"postgres":"up"\|"down","valkey":"up"\|"down","mail":"up"\|"down"},"mail_queued":<int>,"server_time":"<instant>","studio_zone":"<IANA>"}` | — |
| `GET /api/studio` | — | `200 {"name":"Cinderlatch Games","zone":"America/Chicago"}` | — |
| `GET /api/clock` | — | `200 {"now":"<instant>","studio_local":"<YYYY-MM-DDTHH:MM:SS>","studio_zone":"<IANA>","overridden":<bool>}` | — |
| `PUT /api/clock` | `{"now":"<RFC 3339 with offset>"}` | `200`, same body as GET | `404 not_found` unless clock control is on (Configuration); `422` field `now` |
| `DELETE /api/clock` | — | `200`, same body, `overridden:false` | `404 not_found` unless clock control is on |

**Sessions and settings**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/sessions` | `{"callsign":"<string>","studio_key":"<string, optional>"}` | `201 {"token":"<string>","player":{"id":"<id>","callsign":"<string>","role":"player"\|"founder"}}` and sets `hf_session` | `403 studio_key_invalid`; `422` field `callsign` |
| `GET /api/me` | — | `200 {"player":{…}}` | `401` |
| `DELETE /api/sessions` | — | `204` | `401` |
| `GET /api/me/settings` | — | `200 {"bindings":{"<action>":"<code>",…},"master_volume":<0–100>,"effects_volume":<0–100>,"reduce_effects":<bool>,"screen_shake":<bool>,"camera_bob":<bool>}` | `401` |
| `PUT /api/me/settings` | the full settings object | `200`, the stored object | `401`; `422` fields `bindings`, `master_volume`, `effects_volume` |

Binding actions are `move_up`, `move_down`, `move_left`, `move_right`, `aim_left`, `aim_right`, `fire`, `reload`, `grenade`, `revive`, `shop`, `timers`. Keys are keyboard `code` values. The defaults are `KeyW`, `KeyS`, `KeyA`, `KeyD`, `KeyQ`, `KeyE`, `Space`, `KeyR`, `KeyG`, `KeyF`, `KeyB`, `KeyT`, in that order. Every action needs exactly one key. A key used by two actions, or `Escape`, is a 422 on `bindings`.

**Rooms.** Every room endpoint needs a session. All except `GET` state, `stream` and `join` also need a seat in the room, otherwise `403 not_seated`.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/rooms` | `{"mode":"siege"\|"convoy"}` | `201`, room state | `409 already_in_room` with `"code"` in the error object; `422` field `mode` |
| `GET /api/rooms/{code}` | — | `200`, room state | `404 room_not_found` |
| `GET /api/rooms/{code}/stream` | — | `200 text/event-stream`, one `snapshot` event per server tick whose data is the room state | `404 room_not_found` |
| `POST /api/rooms/{code}/join` | — | `200 {"seat":<1–4>,"state":{…}}` | `404 room_not_found`; `409 room_full`, `409 match_in_progress`, `409 seat_released`, `410 invite_expired` |
| `POST /api/rooms/{code}/ready` | `{"ready":<bool>}` | `200`, room state | `409 wrong_phase` |
| `POST /api/rooms/{code}/start` | — | `200`, room state | `403 not_host`; `409 wrong_phase`, `409 not_all_ready` |
| `POST /api/rooms/{code}/end` | — | `200`, room state with `phase:"over"`, `result:"ended"` | `403 not_host`; `409 wrong_phase` |
| `POST /api/rooms/{code}/heartbeat` | — | `204` | — |
| `POST /api/rooms/{code}/leave` | — | `200`, room state | — |
| `POST /api/rooms/{code}/input` | `{"seq":<int ≥1>,"move":{"x":<-1..1>,"z":<-1..1>},"aim":<0–360>}` | `202 {"seq":<int>,"applied":<bool>}` | `422` fields |
| `POST /api/rooms/{code}/reports` | one report | `200`, report result | `409 report_conflict`; `503 room_paused`; `422` fields |
| `POST /api/rooms/{code}/reports/batch` | `{"reports":[<report>,…]}` (1 to 64) | `200 {"results":[<report result>,…]}` in request order; an entry that conflicts carries `"error":{"code":"report_conflict",…}` in place of a result | `503 room_paused`; `422` field `reports` |
| `POST /api/rooms/{code}/pose` | `{"seq":<int ≥1>,"x":<number>,"z":<number>,"heading":<0–360>}` | `200 {"seq":<int>,"accepted":<bool>,"reason":<string\|null>,"vehicle":{…}}` | `503 room_paused`; `422` fields |
| `POST /api/rooms/{code}/purchases` | `{"purchase_id":"<1–64 of A–Z a–z 0–9 _ ->","item":"ammo_pack"\|"grenade"\|"med_kit"}` | `201 {"purchase_id","item","unit_price","price_effective_at","balance","player":{…}}` | `409 shop_closed`, `409 insufficient_credits`, `409 at_capacity`, `409 purchase_conflict`; `503 room_paused`; `422` field `item` |
| `GET /api/rooms/{code}/ledger` | — | `200 {"balances":{"<account>":<int>,…},"entries":[{"id","account","amount","kind","ref","item","unit_price","at"}],"total":0}` | — |

Room creation and joining both answer `503 rooms_unavailable` while Valkey is unreachable.

**Report bodies.** `report_id` is 1 to 64 characters from `A–Z a–z 0–9 _ -`.

- `{"report_id","type":"shot","aim":<0–360>}`
- `{"report_id","type":"reload"}`
- `{"report_id","type":"grenade","target":{"x","z"}}`
- `{"report_id","type":"revive","target_player":"<player id>"}`

A **report result** is `{"report_id","type","accepted":<bool>,"reason":<string|null>,"tick":<int>,"outcome":<object|null>}`.

- `shot` outcome: `{"hit":{"id","kind","damage","hp_after","killed"}|null,"mag":<int>}`
- `reload` outcome: `{"reload_ms":1800}`
- `grenade` outcome: `{"grenade_id","detonates_in_ms":3000}`
- `revive` outcome: `{"revived":"<player id>"}`

A rejected report has `accepted:false`, `outcome:null`, and `reason` set to one of: `fire_interval`, `reloading`, `empty`, `not_up`, `not_in_wave`, `nothing_to_reload`, `no_grenades`, `out_of_range`, `not_downed`, `too_far`, `window_closed`, `self_revive`.

**Room state.** The state is always this shape:

```json
{"code":"K7P2QX","mode":"siege","phase":"lobby","wave":0,"phase_remaining_ms":null,
 "tick":0,"server_time":"…","host":"<player id>","night_id":null,
 "invite_expires_at":"…","invite_remaining_ms":900000,"degraded":null,"result":null,
 "players":[{"id","callsign","seat","ready","connection":"connected|disconnected|left",
   "grace_remaining_ms":null,"status":"up|downed|out","hp","x","z","aim","last_input_seq",
   "mag","reserve","grenades","reload_remaining_ms":null,"revive_remaining_ms":null,
   "credits","score","kills"}],
 "enemies":[{"id","kind":"grunt|brute|boss","state":"patrol|detect|pursue|attack|dead","hp","x","z"}],
 "barrels":[{"id","hp","x","z","destroyed"}],
 "grenades":[{"id","owner","x","z","fuse_remaining_ms"}],
 "shop":{"open":false,"items":[{"item","name","price","next_price":null,"next_change_in_ms":null}]},
 "vehicles":[],
 "events":[{"seq","type","tick", "…type fields"}]}
```

- `phase_remaining_ms` is set during countdown and intermission and is null otherwise.
- `invite_remaining_ms` is null once the invite has expired or the match has started.
- In convoy rooms `enemies`, `barrels` and `grenades` are empty, and `vehicles` holds `{"player","state":"running|wrecked|finished","x","z","heading","last_seq","next_checkpoint","laps_done","lap_elapsed_ms","best_lap_ms","reset_remaining_ms"}`.
- `events` holds the room's latest 100 events, with `seq` increasing by one per event. The types are `phase`, `kill`, `explosion`, `player_down`, `player_revived`, `player_out`, `player_respawned`, `wave_cleared`, `purchase`, `host_changed`, `disconnected`, `reconnected`, `released`, `lap`, `wrecked`, `reset`, `finished`. An `explosion` carries `{"source":"grenade:<id>"|"barrel:<id>","owner","x","z","hits":[{"id","damage","distance"}],"blocked":[<id>…]}`, with `distance` rounded to two decimals.

**History and laps**

| Method and path | Request | Success |
|---|---|---|
| `GET /api/history?limit=<1–50, default 20>` | — | `200 {"matches":[{"id","code","mode","result","waves_cleared","night_id","started_at","ended_at","players":[{"callsign","score","kills","credits_earned","best_lap_ms"}]}]}`, newest `ended_at` first |
| `GET /api/laps?limit=<1–50, default 10>` | — | `200 {"laps":[{"rank","callsign","lap_ms","set_at","match_id"}]}` |
| `GET /api/maps/{id}` | — | `200`, the map from Seed data as `{"id","width","depth","blocks":[{"x","z","w","d"}],"spawns":[…],"barrels":[…],"waves":[…],"checkpoints":[…]}`; `404 not_found` |

**Prices.** Reading is public. Writing needs the founder role, otherwise `403 founder_only`.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/prices` | — | `200 {"zone","items":[{"item","name","current_price","next_change":{"id","price","effective_local","effective_at","in_ms"}\|null}],"schedule":[{"id","item","price","effective_local","effective_at","status":"in_effect"\|"pending"\|"superseded"}]}` | — |
| `POST /api/prices` | `{"item","price":<int>,"effective_local":"YYYY-MM-DDTHH:MM"}` | `201`, the schedule row | `409 price_change_exists`; `422` fields `item`, `price`, `effective_local` |
| `DELETE /api/prices/{id}` | — | `204` | `404 not_found`; `409 price_change_in_effect` |

**Nights.** Reading and signing up are public. Series creation and sign-up lists need the founder role.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/nights?from=YYYY-MM-DD&days=<1–90, default 28>` | `from` defaults to today's studio date | `200 {"zone","nights":[<night>]}`, by start instant | `422` fields |
| `GET /api/nights/{id}` | — | `200 <night>` | `404 not_found` |
| `POST /api/nights/series` | `{"title","mode":"siege"\|"convoy","weekday":"monday".."sunday","local_time":"HH:MM","first_date":"YYYY-MM-DD","weeks":<1–26>,"capacity":<1–64>}` | `201 {"series":{"id",…},"nights":[<night>…]}` | `403 founder_only`; `422` fields |
| `POST /api/nights/{id}/signups` | `{"name","email","viewer_zone":"<IANA>"}` | `201 {"signup":{"id","night_id","name","email","viewer_zone","created_at"},"email_status":"sent"\|"queued"}`; a repeat gets `200` with the stored signup and `"email_status":"already_signed_up"` | `404 not_found`; `409 signups_not_open`, `409 signups_closed`, `409 night_full`; `422` fields |
| `GET /api/nights/{id}/signups` | — | `200 {"signups":[…]}` | `403 founder_only` |

A **night** is:

```json
{"id","series_id","title","mode","date":"YYYY-MM-DD","scheduled_local_time":"HH:MM",
 "local_start":"HH:MM","utc_offset":"-06:00","zone_abbr":"CST","starts_at","signups_open_at",
 "signups_close_at","ends_at","status":"scheduled|signups_open|closed|live|done",
 "status_changes_in_ms":<int|null>,"capacity","signed_up","seats_left",
 "dst_note":null|"shifted_forward"|"first_occurrence"}
```

### Business rules (DP-05 to DP-08, DP-10 to DP-13, DP-15, DP-16, DP-18 to DP-22, DP-24, DP-25, DP-27, DP-28, DP-30, DP-31, DP-33 to DP-36, DP-38 to DP-40, DP-42, DP-44 to DP-46)

**Time authority.**

- Whether something is open, due, expired, running or finished comes only from the server. The browser renders the server's status and remaining milliseconds and never recomputes them from its own clock, because the device clock may be hours wrong. Formatting a server instant into the viewer's zone is display only.
- Match timers run on the server's monotonic clock at a 20 Hz tick (one tick every 50 ms). These are the countdown, intermission, reload, fuse, revive window, lease, grace, reset and lap timers.
- Calendar rules use the server's wall clock. These are price effective instants, night statuses, sign-up windows, invite expiry and reminders.
- With clock control on, `PUT /api/clock` moves only the wall clock to the given instant. It keeps running from there until changed or cleared, and the match timers are unaffected.

**Room state machine (siege).** `lobby → countdown → wave (1, 2, 3, each followed by intermission) → boss_wave → over`.

- `start` is legal only in `lobby` (else `wrong_phase`), only for the host (else `not_host`), and only with at least one seat, every seated player ready (else `not_all_ready`).
- Countdown lasts 5,000 ms.
- A wave ends the tick its last enemy dies. Waves 1 to 3 lead to an intermission of 20,000 ms, then the next wave. Wave 3's intermission leads to `boss_wave`.
- The room state's `wave` is 0 in `lobby` and `countdown`, 1 to 3 during those waves, and 4 in `boss_wave`. It keeps its last value through each intermission and in `over`.
- Killing the boss wave's last enemy clears wave 4. The wave bonus is paid and `wave_cleared` is logged as for any wave, and the match ends in that same tick with `result:"victory"`. The match ends with `result:"defeat"` the tick no player is `up`.
- The host's `end` is legal in any phase except `lobby` and `over` and ends the match with `result:"ended"`. A room whose seats are all released ends with `result:"ended"`.
- `ready` is legal only in `lobby`.
- A room in `over` keeps answering for 60 seconds, then its code returns `room_not_found`.

**Convoy state machine.** `lobby → countdown → race → over`.

- The same start rules apply. `race` ends with `result:"finished"` when every seated, connected racer has finished three laps, or by the host's `end`.

**Room codes and seats.**

- A room code is six characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, unique among live rooms.
- A room has four seats, filled lowest first. The creator takes seat 1 and becomes host.
- A player whose seat is in a room that is not `over` cannot create another room (`already_in_room`).
- Joining a room you already hold a seat in returns that seat, never a second one.
- New joins are allowed only in `lobby` (else `match_in_progress`) and while a seat is free (else `room_full`). When several players race for the last seats, exactly as many succeed as there were free seats, in the order the server receives them.
- A room's invite expires 15 minutes after creation on the wall clock. A new join is accepted while the wall clock is strictly before `invite_expires_at`, and refused with `invite_expired` from that instant on. Rejoining your own seat ignores invite expiry.
- When a founder creates a room while a night of the same mode is `live`, the room's `night_id` is that night. Otherwise it is null.

**Seat leases, reconnect grace and host migration.**

- Any authenticated request from a seated player, or an open stream, renews that seat's lease for 5 seconds.
- When the lease lapses, the player's `connection` becomes `disconnected` and a reconnect grace of 30,000 ms starts. `leave` starts the grace at once during a match. In `lobby`, `leave` frees the seat immediately.
- A request from the player while `grace_remaining_ms` is above zero reconnects them. They keep their seat, position, health, ammo and credits, and the room logs `reconnected`.
- When the grace reaches zero the seat is released. In the lobby the seat is freed. In a match the player's `connection` becomes `left`, they count as not up, and a later join gets `seat_released`.
- While disconnected, a player's character stays where it was and can still be attacked.
- When the host disconnects or leaves, hosting passes in the same tick to the connected player with the lowest seat, logged as `host_changed`. If nobody is connected, the first player to reconnect becomes host. A former host who returns does not take hosting back.

**Movement.**

- Siege maps use metres on an x (east) and z (north) plane. Aim and heading are degrees: 0 is east, 90 is north, increasing counter-clockwise.
- Each tick the server moves each `up` player by its latest intent. A move vector longer than 1 is scaled to length 1, and a shorter one keeps its length. The player moves at 4.0 m/s times that length and never into a solid block cell or past the map edge.
- Inputs whose `seq` is not above the player's `last_input_seq` are ignored (`applied:false`). The `aim` of an applied input sets the player's aim.
- Downed and out players do not move.

**Weapon rules (one rifle per player).**

- The magazine holds 30 rounds. Each player starts a match with 30 in the magazine, 90 in reserve, 2 grenades and 100 health. Reserve can hold up to 270 and grenades up to 3.
- **Shots.**
  - A shot is accepted only when the phase is `wave` or `boss_wave` (else `not_in_wave`), the shooter is `up` (else `not_up`), no reload is running (else `reloading`), and the magazine is not empty (else `empty`).
  - It must also arrive at least 100 ms of server time after the shooter's previous accepted shot. Exactly 100 ms is accepted. Sooner is `fire_interval`.
  - A rejected shot changes nothing.
  - An accepted shot uses one round and casts a ray from the shooter's position along the given aim, up to 40 m. The ray hits the first enemy or intact barrel whose circle it crosses before it enters a solid block cell. Circle radii: grunt 0.5 m, brute 0.7 m, boss 1.0 m, barrel 0.4 m.
  - A hit deals 20 damage. Shots in one tick resolve in the order received.
- **Applied damage.** Damage applied to an enemy or barrel is capped at its remaining health, and health never goes below 0. The `damage` in a shot outcome and in an explosion's `hits` is that applied amount, and `hp_after` is the health after it. For example, a 100-damage grenade on a 60-health grunt applies 60 and leaves 0.
- **Reloads.** A reload is rejected when one is already running (`reloading`), the magazine is full or the reserve is empty (`nothing_to_reload`), or the player is not up (`not_up`). It takes 1,800 ms, then moves the lesser of the missing rounds and the reserve from reserve to magazine.
- **Grenades.**
  - A grenade needs a grenade in hand (else `no_grenades`) and a target within 15.0 m of the thrower (else `out_of_range`), in a wave phase while the thrower is up.
  - It lands at the target at once and detonates 3,000 ms of server time later.
- **Explosion falloff.** At distance d (metres, blast point to entity centre):
  - Grenade: radius 5.0 m and maximum 100 damage. Damage is 100 when d ≤ 1.0, round(100 × (5.0 − d) / 4.0) when 1.0 < d < 5.0, and nothing when d ≥ 5.0.
  - Barrel: radius 4.0 m and maximum 80. Damage is 80 when d ≤ 1.0, round(80 × (4.0 − d) / 3.0) when 1.0 < d < 4.0, and nothing when d ≥ 4.0.
  - Rounding is half up.
  - An entity is in `blocked` and takes nothing when the straight segment from blast point to its centre passes through a solid block cell.
  - Explosions damage enemies and barrels, never players. Damage within one explosion applies to every entity at once.
- **Chain order.**
  - Barrels have 30 health. Explosions resolve first in, first out within the tick that caused them.
  - When an explosion brings barrels to zero, those barrels join the queue in order of increasing distance from that explosion, ties by barrel id ascending.
  - Each barrel explodes exactly once, at its own position, and each explosion logs its own `explosion` event in resolution order.
  - A destroyed barrel stays destroyed for the rest of the match.
  - The owner of a barrel explosion is the owner of the explosion or shot that destroyed it.

**Enemies.**

- Each enemy patrols back and forth along x between its spawn x − 2 and spawn x + 2 at 1.0 m/s.
- It enters `detect` when an `up` player is within 14.0 m with no solid block cell on the line between them. After 500 ms it enters `pursue` towards the nearest up player.
- Pursuit speeds: grunt 2.5 m/s, brute 2.0 m/s, boss 1.5 m/s. An enemy never enters a solid block cell, and its route around blocks is yours to choose.
- Within 1.5 m of its target it enters `attack` and deals damage every 1,000 ms while the target stays in reach: grunt 10, brute 20, boss 25. It returns to `pursue` when the target leaves reach, and to `patrol` when no up player is within 14.0 m.
- Health: grunt 60, brute 240, boss 1,000. At zero it enters `dead` and stays in the state until its wave ends.

**Credits, score and the ledger.**

- A kill rewards the killer (the owner of the shot or explosion that dealt the killing damage): grunt 50, brute 150, boss 1,000.
- When any wave is cleared, including the boss wave, every player who is up in that tick receives 100.
- A player's score is the total applied damage (capped as in Applied damage) that their shots and explosions dealt to enemies. Damage to barrels adds nothing to score. `kills` counts their kills.
- Every credit movement writes two ledger entries with equal and opposite amounts and the same `ref`, one on the player's account (the player id) and one on the counterparty account: `studio:rewards` for `kill_reward` and `wave_bonus`, and `studio:ammo_station` for `purchase`.
- A balance always equals the sum of its account's entries, a match's entries always sum to zero, and the player's `credits` is their balance. Entries are never edited or deleted.

**Purchases.**

- Purchases are accepted only while the room is in `intermission` (else `shop_closed`) and the buyer can afford the price (else `insufficient_credits`).
- Items: `ammo_pack` "Ammo pack" adds 90 reserve rounds up to the reserve limit. `grenade` "Grenade" adds one grenade, refused with `at_capacity` when already at the limit. `med_kit` "Med kit" heals 50, up to 100.
- The unit price is the price in effect at the server's wall-clock instant when the purchase is processed. The ledger entry stores that `unit_price`.
- `purchase_id` is idempotent per room. A replay with the same body returns the stored `201`. The same id with a different item gets `purchase_conflict`. Of simultaneous purchases the buyer can afford only one of, exactly one succeeds and the rest get `insufficient_credits`.

**Downed, revive and out.**

- A player at zero health is `downed`, with a revive window of 10,000 ms.
- A revive report is accepted only when the reviver is up (else `not_up`), is not the target (else `self_revive`), and is within 2.0 m of the target (else `too_far`). The target must be downed (else `not_downed`) with `revive_remaining_ms` above zero (else `window_closed`). The window's end is exclusive.
- A revived player is up with 50 health. When two revives of one player arrive in the same tick, the first received wins and the other gets `not_downed`.
- When the window reaches zero the player is `out`.
- At the start of the next intermission every out player (not `left`) respawns at their seat's spawn point with 100 health and a full magazine, keeping their reserve and grenades.

**Report idempotency.**

- Each report id applies at most once per room. The first time the server sees it, it judges and stores the full result, whether accepted or rejected.
- Any later report with the same id and the same body returns that stored result unchanged, whether sent alone, in a batch or after a reconnect. It changes no ammo, damage, credits, score or position.
- The same id with a different type or fields is `report_conflict`.
- When identical reports arrive at the same moment, exactly one is applied and every response carries the identical stored result.
- Report ids from different rooms never collide.

**Convoy.**

- The vehicle's top speed is 30.0 m/s.
- At race start each vehicle sits at its seat's start position facing the published heading, the lap clock starts, and its next checkpoint is C1.
- **Pose checks**, in this order:
  1. A pose whose `seq` is not above the vehicle's `last_seq` is `stale_seq`.
  2. Outside `race` it is `not_racing`. A finished vehicle gets `finished`, and a wrecked one gets `wrecked`.
  3. A pose whose distance from the last accepted position exceeds 30.0 × (server seconds since the last accepted pose, race start or reset) + 0.5 m is `too_fast`. A pose exactly at the limit is accepted.

  Every refused pose leaves the vehicle unchanged.
- **Wrecks.** An accepted pose whose position lies inside a solid block cell or outside the map wrecks the vehicle. The vehicle stays at its previous position with `state:"wrecked"` and the pose's `accepted:true`, logged as `wrecked`. After 3,000 ms it resets to its last passed checkpoint (C0 if none passed this lap), facing the next checkpoint, and runs again, logged as `reset`. The lap clock keeps running through a wreck.
- **Checkpoints.** An accepted pose within 6.0 m (inclusive) of the next checkpoint passes it. Checkpoints out of order are ignored. After C4 the next checkpoint is C0, the start/finish.
- **Laps.** Passing C0 completes a lap, timed on the server's monotonic clock from the lap's start to the server receipt of that pose. It is stored and logged as `lap`, and the next lap starts at that instant. After three laps the vehicle is `finished`.
- Each completed lap is stored. The Lap board lists each callsign's best lap, fastest first, ties by the earlier `set_at`.

**Match history.** When a room reaches `over`, the server stores one match with the following:
- its result;
- `waves_cleared`, the number of waves cleared including the boss wave, so a victory stores 4 (convoy matches store 0);
- its night;
- its start (the instant the host started the match) and its end;
- each seated player, in seat order, with their score, kills, credits earned (the sum of their positive ledger entries) and best lap (convoy).

**Studio zone and nights.**

- The studio's business zone, from Seed data, decides every calendar question. The viewer's zone and the server's zone never do.
- A night's `date` is its studio-local date, even when its UTC instant falls on another date.
- `GET /api/nights?from=` selects by studio date.
- **Series.**
  - A series stores the weekday and the local wall time. Each week's night is expanded from that wall time in the studio zone, so 20:00 stays 20:00 on both sides of a daylight-saving change.
  - `first_date` must fall on the given weekday, and its first night must start after the current wall clock (field `first_date`).
  - A series makes `weeks` nights, one per week starting on `first_date`.
  - Series are independent. A new series whose nights fall on the same date and time as existing nights creates its own separate nights. Nothing merges, and nothing is refused for overlapping.
- **Skipped and repeated hours.**
  - A wall time that does not exist on its date (the spring-forward gap) moves forward by the length of the gap: `local_start` is one hour later and `dst_note` is `shifted_forward`.
  - A wall time that occurs twice (the fall-back overlap) uses the first occurrence, the earlier instant, with `dst_note` `first_occurrence`.
  - For example, a Sunday 02:30 series in America/Chicago gives 2027-03-14 a `local_start` of 03:30 at 08:30 UTC, and a Sunday 01:30 series gives 2027-11-07 01:30 CDT at 06:30 UTC.
- **Night windows.**
  - Sign-ups open 168 hours before `starts_at` and close 2 hours before it. The night ends 3 hours after it starts.
  - Status is `scheduled` before the opening instant, `signups_open` from it, `closed` from the closing instant, `live` from `starts_at` and `done` from `ends_at`. Each instant belongs to the later status.
  - `status_changes_in_ms` counts down to the next of those instants (null when done).
- **Sign-ups.**
  - Sign-ups are accepted while the night is `signups_open`, so one second before the closing instant succeeds and the closing instant itself is `signups_closed`. Before opening it is `signups_not_open`.
  - At most `capacity` sign-ups. Under contention for the last seats exactly the free seats succeed and the rest get `night_full`.
  - Email is compared case-insensitively per night. A repeat returns the stored sign-up (a replay, so it is answered even after closing) and sends nothing new.
  - `viewer_zone` must be an IANA zone name.
- **Reminders.** Each sign-up's reminder becomes due at `starts_at` minus 60 minutes on the wall clock. It is handed to mail within 5 seconds of falling due. Each confirmation and each reminder is sent exactly once, however the clock moves.

**Prices.**

- The price of an item at instant t comes from the schedule row for that item with the latest effective instant at or before t. The new price applies from its effective instant exactly: with a change at 19:30 studio time, a purchase at 19:29:59 pays the old price and one at 19:30:00 pays the new price.
- `effective_local` is studio wall time, converted with the same skipped and repeated hour rule. It must be strictly after the current wall clock.
- Prices are whole credits from 1 to 5,000.
- A row with the same item and instant as an existing one is `price_change_exists`.
- A pending row (effective instant after now) can be deleted. One whose instant has passed is `price_change_in_effect`.
- A row's status is `in_effect` for the row currently deciding its item's price, `pending` for future rows and `superseded` for older rows.
- Earlier purchases keep the price they paid, in the ledger, purchase events and history.

### Services (DP-04, DP-15, DP-30, DP-46, DP-47, DP-59)

- **Postgres** (`DATABASE_URL`) stores players and sessions, settings, the credit ledger, the price schedule, series, nights, sign-ups, the email outbox, match history and laps. All of it survives a restart. The app applies its schema idempotently every time it serves, and seeds the records in Seed data only when they are absent.
- **Valkey** (`VALKEY_URL`) holds:
  - `hf:room:<CODE>`: a hash with `mode`, `host`, `phase`, `created_at` and `invite_expires_at`, kept while the room lives and removed 60 seconds after it ends;
  - `hf:seat:<CODE>:<player id>`: the seat lease, expiring with the lease time from Business rules;
  - `hf:grace:<CODE>:<player id>`: present only during a reconnect grace, expiring when it ends;
  - `hf:reports:<CODE>`: a hash of report id to stored result.

  Live simulation runs in the game server's memory. Rooms are not restored after a server restart, and stale registry keys are cleared at boot.
- **Valkey down.**
  - `/api/status` shows `valkey:"down"`, and room creation and joining get `503 rooms_unavailable`.
  - A live room that loses Valkey mid-match sets `degraded:"room_registry"`, freezes every match timer and enemy, and answers reports, poses and purchases with `503 room_paused`. Snapshots keep streaming with the frozen values.
  - Within 5 seconds of Valkey returning, the room rewrites its registry keys, clears `degraded` and resumes from the same remaining milliseconds, without a restart.
  - Nights, sign-ups, prices and history keep working.
- **Mail** (`SMTP_HOST`, `SMTP_PORT`, plain SMTP without authentication or TLS). Every email is sent From `MAIL_FROM`, which defaults to `Holdfast Nights <nights@cinderlatch.example>`, to the sign-up's email. Times print as `Ddd D Mon YYYY, HH:MM <abbr> (<IANA zone>)`, where `<abbr>` is the zone abbreviation from the IANA database (for example CST, CET or +03).
  - **Confirmation** (sent at sign-up). Subject `Signed up: <title> · <Ddd D Mon YYYY>` (the studio date). The plain-text body contains these lines:
    - `Hi <name>,`
    - `You're on the list for <title>.`
    - `Studio time: <starts_at in the studio zone>`
    - `Your time: <starts_at in viewer_zone>`
    - `Sign-ups close: <signups_close_at in the studio zone>`
  - **Reminder.** Subject `Starts in 1 hour: <title>`, with the same `Studio time:` and `Your time:` lines.
- **Mail down.** Sign-up still answers 201 with `email_status:"queued"`, and `/api/status` shows `mail:"down"` and the queued count. Due reminders queue the same way. The app retries every 5 seconds. Within 10 seconds of mail returning, each queued email is sent exactly once and the count returns to zero, without a restart.

### Seed data (DP-03, DP-12, DP-18, DP-20, DP-21, DP-33, DP-35, DP-38, DP-42)

Every studio, person and place below is invented.

- **Studio:** name `Cinderlatch Games`, zone `America/Chicago`, studio key `latch-founder-2026`. A session started with this key has role `founder`. There are no seeded players, sessions, sign-ups, matches or laps.
- **Prices**, each effective from `2026-01-01T00:00` studio time:

  | Item | Name | Price |
  |---|---|---|
  | `ammo_pack` | Ammo pack | 120 cr |
  | `grenade` | Grenade | 200 cr |
  | `med_kit` | Med kit | 150 cr |

- **Series:**
  - `Friday Siege`: siege, Friday at 20:00, first date 2026-11-13, 8 weeks, capacity 24.
  - `Sunday Convoy`: convoy, Sunday at 19:00, first date 2026-11-15, 4 weeks, capacity 12.

  For example, with the seed data, Friday Siege on 2026-11-13 starts at 2026-11-14T02:00:00Z, and its date is 2026-11-13.

  At first boot, when the seeded series are absent, the server stores both series and expands them into their 12 nights by the series rules: 8 Fridays from 2026-11-13 and 4 Sundays from 2026-11-15. The first-date check does not apply to them. Seeded nights never move or regenerate. When the wall clock is already past some of them, those nights show whatever status the clock gives, `done` for past ones. A fresh `GET /api/nights` therefore returns the seeded nights that fall in its window.
- **Map `breakwater-yard`** (siege), 32 × 32 m with x and z from 0 to 32.
  - Solid block cells: each is 1 × 1 m, named by its south-west corner, and covers x to x+1 and z to z+1.
    - West seawall: (8,14), (9,14), (10,14), (11,14)
    - East seawall: (20,14), (21,14), (22,14), (23,14)
    - Crate stack: (15,22), (16,22), (15,23), (16,23)
    - Pillars: (4,8), (27,8)
  - Player spawns by seat: 1 (16.0, 4.0), 2 (14.0, 4.0), 3 (18.0, 4.0), 4 (16.0, 6.0), each with aim 90.
  - Barrels: B1 (6.5, 20.5), B2 (8.0, 20.5), B3 (25.5, 20.5), B4 (16.0, 25.0).
  - Enemies, by id and spawn:
    - Wave 1: grunts w1-1 (10,28), w1-2 (16,28), w1-3 (22,28).
    - Wave 2: grunts w2-1 (4,28), w2-2 (10,28), w2-3 (16,30), w2-4 (22,28), w2-5 (28,28).
    - Wave 3: grunts w3-1 (4,28), w3-2 (10,28), w3-3 (22,28), w3-4 (28,28) and brute w3-5 (16,30).
    - Boss wave: boss w4-1 (16,30) and grunts w4-2 (6,28), w4-3 (26,28).
- **Map `saltpan-loop`** (convoy), 200 × 120 m.
  - Solid island: the block rectangle covering x 60 to 140 and z 40 to 80.
  - Start positions by seat: 1 (20, 8), 2 (20, 14), 3 (14, 8), 4 (14, 14), each with heading 0.
  - Checkpoints, in order: C1 (100, 12), C2 (180, 60), C3 (100, 108), C4 (20, 60), then C0 start/finish (24, 11).

## Technical requirements

### Deployment (DP-58)

Backend: Go 1.27 with Go modules, the toolchain the images ship. Frontend: TypeScript built with Node 22 in the same `build` step, with three.js for the stage, served as static files by the Go server.

- Commit `go.sum` and the frontend lockfile. No system library beyond build-essential is installed: no OpenSSL headers, and the server talks plain TCP and HTTP to the services. The server carries its own IANA zone data, because the runtime image may lack system zone files.
- `/app/run.json` holds the string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"go mod download && npm ci","build":"npm run build && go build -o bin/holdfast .","serve":"./bin/holdfast"}
```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` answers `200 {"status":"ok"}`.

### Configuration and secrets (DP-59)

- **Read at start:** `DATABASE_URL`, `VALKEY_URL`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` (default in Services), `APP_PUBLIC_PORT`, and `HOLDFAST_CLOCK_CONTROL`. When `HOLDFAST_CLOCK_CONTROL` is `on`, `PUT` and `DELETE /api/clock` exist; in every other case they answer 404.
- **Never hard-coded or sent to the browser:** no credential, service URL or connection string appears in the source or in any response or static file.
- The studio key is seed data stored only as a hash.

### Server boundary (DP-04, DP-58)

- **Same origin.** The server serves the app and API from one origin and sends no cross-origin permission headers. A state-changing request whose `Origin` header names another origin gets `403 {"error":{"code":"cross_origin",…}}`.
- **Size and content limits** are in API.
- **Never served:** source files, the run manifest, lockfiles, dotfiles and environment files. Any path outside the built frontend and `/api/` answers 404, except the three routes in Screens and layout, which serve the app.
- **Booting without dependencies.** A dependency that is down at boot does not stop the app. It serves `/api/health`, the frontend and every endpoint that does not need the missing service. It probes each dependency at least every 2 seconds, `/api/status` reflects a change within 5 seconds, and it recovers when the service returns, without a restart. The banner follows `/api/status` within 5 seconds.

### Browser support and performance (DP-56, DP-57)

- **Browsers and viewports:** current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, with mouse, keyboard and touch.
- **Load:** the title screen is usable within three seconds on a desktop.
- **Live play:** the room screen applies each snapshot within one animation frame. The stage keeps at least 30 frames per second on a desktop during a wave. The HUD shows a report's result within half a second of the response.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and the app runs only through it.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence. Shipped packages are the Go modules the program imports plus the frontend production dependency tree (`npm ls --omit=dev --all --json`), and the fonts.
- IF-03: Every shipped package and font uses MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, MPL-2.0, Zlib, CC0-1.0, Unlicense or OFL-1.1. Nothing GPL, LGPL, AGPL or SSPL ships.
- IF-04: The only datastores are the provided Postgres, Valkey and Mailpit. There is no SQLite, embedded database, or file used as a database.
- IF-05: The seed records (studio, studio key, prices, series and maps) match Seed data exactly and are not altered by migrations or code.
- IF-06: `go.sum` and the frontend lockfile are committed, and the build works offline from them after `install`.
- IF-07: Fonts are Pixelify Sans and Chakra Petch, loaded from Google Fonts or vendored OFL files. No art, audio, models or text comes from another game or website.

## Engineering standards

- Code is idiomatic Go and idiomatic TypeScript: errors are returned and handled explicitly, and no panics are used for control flow.
- Names in code match the domain terms in this brief: room, seat, lease, grace, report, wave, intermission, ledger entry, price change, night, series, sign-up.
- Each domain rule is decided in exactly one place in the source. Examples: a phase transition, the fire interval, the falloff formula, the price in effect at an instant, a night's status, the skipped-hour rule.
- The browser never decides a server rule. It renders server values and sends intents and reports.
- There is no abstraction with a single implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the rules make impossible.
- Every API error goes through one error shape and one place that maps errors to status codes.
- There are no features, endpoints or settings beyond this brief.
