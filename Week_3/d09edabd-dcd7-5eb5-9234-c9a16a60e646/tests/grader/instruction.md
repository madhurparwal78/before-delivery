# Tumbler & Pin Co. Keyway Bench

Keyway Bench is a browser 3D bench for owner-operators of independent escape-room venues. It lets them design a new room and test it before they pay for a physical build. They lay out the room to true scale in millimetres, wire its puzzle chain as trigger nodes, walk into it at player height and run remote timed playtests with live testers. When the design is ready they freeze a build pack for the carpenter. The app runs on four backend services:

- **Postgres** keeps accounts, workspaces, rooms, placements, trigger graphs, numbered versions, playtest sessions with their server clock, the solve log and every capability link.
- **MinIO** stores uploaded glTF props, room thumbnails and frozen build-pack snapshots byte for byte.
- **Valkey** carries live presence, locks and event fan-out between two app instances.
- **Mailpit** receives playtest invitations and debriefs.

Out of scope: billing, adding or removing workspace members (the seed data and sign-up provide them), password reset, real control of maglocks or sensors, audio, VR, and any datastore beyond these four services.

## Problem and users

An independent escape-room owner who runs two to four rooms has to open a new room every 12 to 24 months to keep local players coming back. A physical build-out costs roughly $10,000 to $40,000 in carpentry, props, maglocks and electronics. The design is usually checked for the first time only after that money is spent.

Today the owner works across several tools:

- The floor is sketched in a home-design tool.
- The puzzle chain is a dependency flowchart on a whiteboard or on paper.
- Trigger logic ("drawer sensor closes → maglock 3 releases → blacklight cue") lives in a document.
- Playtesting means friends walking through half-built plywood.

Bottlenecks only show up after construction: one long linear chain that leaves most of a team idle, two puzzles fighting over the same prop, a reveal hidden behind a pillar. Room editors inside video games are built for digital players, not for a real room in metres that a carpenter has to build. Many carpenters in imperial shops cut to the sixteenth-inch marks on a tape measure, so a plan in decimal inches is no use to them. The owner pays for all of this with rebuilds, late openings and weak first-month reviews.

Users:

- **Venue owner-designer** (daily). Lays out a new room to true scale, wires its puzzle chain as trigger nodes, runs remote playtests as game master and freezes a build pack for the carpenter. Holds the workspace role `owner`.
- **Co-designer** (weekly). Usually a part-time game master or prop builder. Edits the same room live with the owner without overwriting the owner's work, and follows the versions the owner freezes. Holds the workspace role `co_designer`.
- **Remote playtester** (occasional). Has no account. Joins a timed playtest from an emailed invite link, walks the room, handles props and solves the chain while the owner watches and sends hints.
- **Fabricator** (occasional). Has no account. Opens a frozen build-pack link, often on a phone at the saw, and reads the exact prop list, dimensions and trigger wiring of one version in metres, or in feet, inches and sixteenths.

## Journeys

1. **Walk into a starter room.**
   - The owner signs in and lands on the editor. The Open a room dialog sits over the dimmed grid stage, with the first card, Apothecary, highlighted.
   - They press Enter. The dialog fades away and the camera dollies through the Apothecary's entry door to player height.
   - The Play button turns into a stop square, the transport shows the full playtest clock counting down, and the chain figures read 0 of 6 solved.
   - They press P. The camera returns to the overview, and the Debrief dialog opens with the playtest-ended copy as its heading.
2. **Lay out a room together.**
   - The owner and the co-designer open Clockmaker's Study at the same time, each on a different app instance. Each sees the other in the presence count.
   - The owner drags the Workbench and holds its lock. When the co-designer tries to move the Workbench, they see the owner's name on it, and their move is refused rather than lost.
   - The owner's moves reach the co-designer's stage within a second.
   - When the owner stops touching the Workbench, the lock lapses and the co-designer can move it.
3. **Wire the chain and read the bottleneck.**
   - In the Vault, the owner opens the Trigger graph sheet and steps through the nodes with N. The longest run is 6, because the chain is fully linear.
   - They free Safe dial by removing its only prerequisite, Blacklight cue. The longest run drops at once on the stage and on the Vault's room card.
4. **Upload a prop.**
   - The co-designer uploads a sea chest named `Coffre à secrets` as a .glb file with its real dimensions.
   - The library shows a pending card, then the stored prop.
   - They place it in Ship's Hold, and the prop count rises by one.
   - An upload made while storage is down shows the storage banner and adds nothing.
5. **Run a remote playtest.**
   - The owner schedules a playtest of the Apothecary from the Playtests sheet and invites three testers by email. Each roster row shows whether its email was sent.
   - The owner opens the lobby and starts the session. Every viewer sees the same server clock.
   - The owner sends a hint. A second hint is refused until the cooldown has passed.
6. **Play from a phone.**
   - A tester opens the emailed link on a phone, sees the lobby copy, taps the raised Join button and waits.
   - When the session starts they walk the room and enter 4172 for Herb cabinet code. The cabinet maglock and the blacklight cue fire on their own.
   - They solve the rest of the chain and escape. Their screen shows the playtest-ended heading.
   - Every tester and the owner get a debrief email with the per-puzzle times and the choke point. Reopening the link shows the expired-invite copy.
7. **Freeze and hand off.**
   - The co-designer has the Versions sheet for Ship's Hold open on the other app instance.
   - The owner freezes Ship's Hold as "Carpenter pass 1". The version, its stored snapshot, the copied prop files and a build-pack link appear together.
   - Within a second the co-designer's sheet shows the new card on top and the previous card turning to Superseded. Their page does not reload and their focus stays where it was.
   - The owner sends the link with feet selected. On a phone, the fabricator sees `16' 4 7/8"` as the room width at once. They switch to metres to check a supplier sheet and reload the page, and it stays in metres.
   - They download the sea chest file, byte-identical to the upload and saved under its own name. Each table scrolls sideways inside its own box, while the page itself never does.
   - The owner then deletes the sea chest from the room and the library. The pack still downloads it.
   - Later the owner regenerates the link. The old link stops working at once, and the co-designer's card updates in place.
8. **Services drop mid-session.**
   - While the owner is editing, Valkey becomes unreachable. The session pill shows the live outage copy, locks and playtests are refused, moves still save, and freezing still works.
   - When Valkey returns, the banner clears and presence comes back within ten seconds, with no restart.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** The app installs, builds and serves from the run manifest on port 4173, and its health endpoint answers 200 with status ok and each service's state, as specified in Deployment.
- **DP-02 — Accounts and sign-in** A visitor can create a venue workspace (an owner account plus the five starter rooms) or sign in with email and password, and every workspace endpoint refuses signed-out requests with 401.
- **DP-03 — Workspace isolation and roles** Members see only their own workspace (another workspace's records answer 404), and owner-only actions answer 403 to a co-designer.
- **DP-04 — Error shape and precedence** Every API error uses the one published error body and follows the one published precedence order.
- **DP-05 — Request limits and served files** The server enforces the published body-size limits with 413, refuses cross-origin writes, and never serves source files or credentials.
- **DP-06 — Configuration from the environment** Every service URL and credential is read from the published environment variables at start, and none is hard-coded or sent to the browser.
- **DP-07 — Boot without dependencies** The app starts and answers health while Valkey, MinIO or the mail server is unreachable, and picks each one up within 10 seconds of its return without a restart.
- **DP-08 — Public walkthrough page** Signed-out visitors at / scroll a camera through the Vault starter room while its chain lights cue by cue, reversing on scroll back, and the page ends at the sign-up form.
- **DP-09 — Workshop-dark stage and thumbnails** The editor looks like a darkened set (a near-black grid stage, quiet floating clusters and one orange Play button), and its room cards carry thumbnails rendered from each room's own primitives.
- **DP-10 — Reduced motion** When the user asks for reduced motion, the picker, the walk-in and the public tour replace every scale, dolly and scrubbed camera move with the published instant substitutes and keep the same states and announcements.
- **DP-11 — Floor plan without WebGL** Without WebGL the stage shows a flat floor plan of the open room with the published notice, and every panel still works.
- **DP-12 — Room picker dialog** The editor opens on the Open a room dialog, which lists the workspace's rooms alphabetically as cards carrying each room's chain figures, with a centred New room link and the footer row.
- **DP-13 — Keyboard room picking** In the room picker the arrow keys move the highlighted card, Enter opens it, Tab and Shift+Tab wrap inside the dialog, and Escape closes it and returns focus.
- **DP-14 — Published viewport layouts** At 375x812 the editor uses the phone tab bar with a raised Play button and a full-width picker sheet, at 768x1024 and 1280x800 it uses the corner-cluster layout, and no size overflows horizontally.
- **DP-15 — Doorway walk-in** Picking a room walks the user in through its entry door to player height in a new server-timed playtest that shows the full clock and 0 of N solved, and Stop ends that playtest, restores the saved editing view and, once the Debrief dialog it opens is closed, puts focus on the Play button, in the desktop and the phone layouts.
- **DP-16 — Editor keyboard control** The published keys switch between Move, Rotate and Scale, select and nudge placements, step through trigger nodes, start and stop a playtest and close every dialog, from whichever editor control has focus, as qualified in Interactions.
- **DP-17 — Placements in millimetres** Rooms, placements and props are stored in whole millimetres within the room bounds, and a save that carries an outdated version answers 412 with the current record.
- **DP-18 — One lock holder** When several members grab the same placement or trigger node at once, exactly one holds the lock, the others get 409 naming the holder, and an idle lock lapses after the lock TTL.
- **DP-19 — Live presence across instances** Presence, locks and every saved room change reach members connected to either app instance within one second.
- **DP-20 — Solo editing during a live outage** While Valkey is unreachable the editor shows the live outage banner, locks and playtest actions answer 503, and placement and node edits still save.
- **DP-21 — Trigger graph rules** Every trigger node has one of four kinds, prerequisites never form a loop, a room has at most one exit, and no room edit is accepted while one of the room's playtests is running.
- **DP-22 — Derived chain figures** Each room's solved-of-total, longest linear run and prop count follow the published rules and match exactly in the API, on the stage, on the room card and in the debrief after every edit and every solve.
- **DP-23 — Trigger graph sheet** The Trigger graph sheet shows the room's nodes as cards in chain order with their wires, edits the selected node, and shows the holder's name when someone else holds that node.
- **DP-24 — Prop upload checks** Prop uploads accept only glTF 2.0 files of up to 5,000,000 bytes that come with a name and dimensions, and anything else is rejected with 413 or 422.
- **DP-25 — Placeable only once stored** An uploaded prop appears in the library and can be placed only after object storage confirms its file, and a failed upload leaves no prop behind.
- **DP-26 — Prop library sheet** The Prop library sheet lists stored props as thumbnail cards, places a prop into the open room, shows the published empty copy when the library is empty, and on a phone is a full-width sheet that never sits under the tab bar.
- **DP-27 — Storage outage** While MinIO is unreachable, uploads, thumbnail saves and freezing answer 503 and the storage banner shows, while room editing continues.
- **DP-28 — Playtest lifecycle** A playtest moves only from scheduled to lobby to running to ended, or from scheduled or lobby to cancelled, with at most one lobby or running session per room, and any other move answers 409.
- **DP-29 — Server-owned clock** Only the server decides a playtest's remaining time, hint cooldown and end, and every viewer shows the server's figures, including late joiners, reloaded pages and devices with a wrong clock.
- **DP-30 — Email invitations** Each tester invite emails the start time and a personal join link, and the roster shows whether that email is sent, queued or failed, with a way to resend it.
- **DP-31 — Scheduling a playtest** From the Playtests sheet the owner schedules a playtest, invites testers by email, opens the lobby, starts the session and watches the clock and the roster.
- **DP-32 — Invite links** A tester's join link reaches only its own session, stops working at once when it is revoked or its session ends or is cancelled, shows the published copy when it no longer works, and never reveals puzzle answers or other workspace data.
- **DP-33 — Solving the chain** Testers solve available puzzles (giving the answer when one is set), locks and cues fire on their own once their prerequisites are solved, and solving the exit ends the session as escaped.
- **DP-34 — Hints with cooldown** The game master sends text hints that reach every tester at once, and a second hint inside the cooldown answers 429 with the seconds left.
- **DP-35 — Remote playtest on a phone** A tester opens an invite on a phone, joins from the lobby, walks the room at player height, solves the chain, receives hints and sees the session end.
- **DP-36 — Debrief figures** An ended playtest has a debrief with each puzzle's solve time, the hints used, the choke point and the room's chain figures, computed by the published rules.
- **DP-37 — Debrief email** Within 10 seconds of a playtest ending, every invited tester, the host and the owner receive the debrief by email, and the Debrief dialog shows whether it was sent, is queued or failed.
- **DP-38 — Playtest ended screen** When a playtest ends, including when it runs out of time, the host sees the Debrief dialog and testers see the ended screen, both headed with the published copy, and a reopened invite shows the expired copy without the Join controls.
- **DP-39 — Freeze all or nothing** Freezing a version writes its records, its stored snapshot, a copy of each placed prop file and its build-pack link together, or writes none of them and answers 503 with the published retry copy.
- **DP-40 — Freeze retries** A freeze repeated with the same idempotency key returns the first result and creates no second version, and the same key with a different body answers 409.
- **DP-41 — Version numbering and states** Freezes of one room, including simultaneous ones on either instance and freezes made while Valkey is unreachable, get gap-free numbers from 1, exactly one version (the highest) stays frozen, each superseded version names the next number as its successor, and frozen contents never change.
- **DP-42 — Build pack links** A build-pack link reads only its own version and refuses every write with 405, and the owner can regenerate it (which kills the old link) or revoke it, with immediate effect.
- **DP-43 — Prop files byte for byte** Every prop file is stored and served byte for byte as uploaded with the published validator, 304 and file-name headers, and a build pack serves its own copies even after the live room or the library changes.
- **DP-44 — Metres and sixteenths without drift** Every length shows in metres or in feet, inches and reduced sixteenths, converted straight from the stored millimetres by the published integer rule, and the editor Inspector and the build pack show identical strings.
- **DP-45 — Build pack page** The fabricator opens a build-pack link and reads the room size, placements, trigger wiring and file downloads of that one version under a pinned top bar, with each table scrolling sideways inside its own region on a phone, as qualified in Screens and layout.
- **DP-46 — Live Versions sheet** An open Versions sheet on either instance shows every freeze, supersede, link regenerate and link revoke within one second, in place, without a reload and without moving focus.
- **DP-47 — Units in the build-pack address** The build-pack page takes its units from the address, normalises a missing or unknown value to metres, and rewrites the address in place when Units is pressed, so a reload or a forwarded link keeps the same units.
- **DP-48 — Offline save queue** Editor changes that cannot reach the server wait in a save queue kept in the browser, stay drawn after a reload, show the published Connection copy, and replay in order with their original change ids once the server answers again.
- **DP-49 — Room revisions and change log** Every accepted change to a room adds exactly one to the room's revision and one entry to its change log, a change id that was already applied returns the stored result, and a change to a deleted placement is refused with the published 410 naming who deleted it.
- **DP-50 — Lock takeover** A member who commits a change to a placement another member holds gets the Prop locked dialog, can cancel back to the saved value or take the lock over, and both members are told who now holds the placement, as qualified in Interactions.
- **DP-51 — Per-author undo** Ctrl+Z undoes only the signed-in member's own latest placement edit in the room, and the server refuses an undo with nothing to undo or whose placement someone deleted, with the published copy.
- **DP-52 — Scene tree and camera** The Scene panel lists the open room's placements as a tree whose items carry their drawn position and move with Alt+Arrow keys, and the Room stage turns the camera by the published steps from keys and one-finger drags.
- **DP-53 — Drop to the floor** D drops the selected raised placement to the floor with the published fixed-step fall, shown live on its Scene item and saved once when it lands.
- **DP-54 — Command palette restore** Ctrl+K opens the Command palette, which filters the published commands as you type, keeps live-only commands unavailable while the live service is down, and restores a frozen version as one new change that open editors on both instances show at once.
- **DP-55 — Version restore rules** A restore puts back the room's frozen placements, nodes and size as one change, is owner only, clears undo history and follows the published refusals.
- **DP-56 — Freezing from a phone** On a phone the Versions sheet is a full-width sheet that ends above the tab bar, and a freeze from it puts focus on the new card's Copy build pack link button.

## Frontend

### Screens and layout (DP-08, DP-09, DP-11, DP-12, DP-14, DP-23, DP-26, DP-35, DP-38, DP-45, DP-46, DP-48, DP-52, DP-54, DP-56)

**Routes.**

| Path | Shows |
|---|---|
| `/` | The public page for signed-out visitors. Signed-in visitors go to `/app`. |
| `/signin` | The sign-in form. |
| `/app` and `/app/rooms/<roomId>` | The editor. Signed-out visitors go to `/signin`. |
| `/play/<token>` | The tester's playtest page. |
| `/pack/<token>` | The fabricator's build-pack page. Takes the optional `units` query value. |
| Any other path, or a token that does not exist | The not-found copy from Feedback states. |

**Room stage.** The editor and the tester page fill the whole window with one 3D stage that never scrolls.

- It shows an endless floor grid seen from a raised three-quarter camera.
- The open room is built from its stored dimensions: a floor, four walls at the room height and an open ceiling.
- Each placement is drawn as its primitive (door, box or cylinder) or as its uploaded prop model.
- Joined testers appear as small labelled markers at their last reported position.
- A room with no placements shows the bare room with the empty-room line from Feedback states.

All chrome floats over the stage in fixed clusters, a small even distance (about 12 to 16 px) in from the window edges:

- **Top-left:** the logo button.
- **Top-centre:** the live session pill, about 520 px wide on desktop. From left to right it holds:
  - a status dot and the status word;
  - the room code (the first six characters of the room id, upper case, in the mono face) with a copy button;
  - the invite email field and the Invite button;
  - the Playtests button;
  - the Session menu button.

  While a service banner from Feedback states is active, it replaces the middle section of the pill.
- **Top-right:** the corner tool clusters. They hold the Chain figures group (three short figures), the Presence button (`<n> here`) and a round 44 px account avatar with the user's initials.
- **Under the top-right cluster:** the Inspector panel, shown only while a placement is selected. It lists the placement's label, X, Y and Z position, width, depth and height, and rotation. Each length is the same string the build pack shows for that value in the current units.
- **Bottom-centre:** the playtest transport bar, about 310 px wide. From left to right it holds Move, Rotate and Scale, the round Play button, then Trigger graph, Prop library and Next node. While a playtest of the open room is running, the playtest clock sits at the right end of the bar.
- **Above the transport bar:** the Cue timeline strip, a 120 px tall band toggled from the bottom-right cluster.
  - When the room's latest session is running or has ended, it lists that session's solve log in elapsed order as `mm:ss <node title>`.
  - Otherwise it lists the room's lock and cue nodes in chain order.
- **Bottom-left:** two stacked square buttons, Add primitive and Upload prop.
- **Bottom-right:** two stacked square buttons, Cue timeline and Units.

**Room picker dialog** (the Open a room dialog). It is centred on the stage, about 600 px wide, with its top a little below the session pill. A dark scrim behind it dims the stage. From top to bottom it holds:

- **Header row:** the Tumbler & Pin mark (a small square key-pin glyph), the wordmark "Keyway" in bold followed by "bench" in regular muted ink, and under it a build line in the mono face with the app version (for example `bench 1.0.0`).
- **Close button:** at the top right.
- **Section row:** a back chevron and the heading `Pick a room`, then a muted one-line subtitle, `Choose a draft or a starter room. Enter walks you in.`
- **Card grid:** four equal columns on desktop with small gaps. Each room draft card has the room's thumbnail on top (about 16:9) and a label strip below it with the room name in bold, cut with an ellipsis when it is too long. A muted line under the name carries the room's three chain figures in the format from Feedback states.
- **New room link:** centred under the grid.
- **Picker footer links:** a thin divider, then two parts:
  - On the left, the checkbox `Walk in when I pick a room`. It is checked by default and remembered per browser.
  - On the right, three text links: Prop library, Versions (for the highlighted room) and Keyboard shortcuts.

**Sheets.** Every other panel is a floating sheet in the same language.

| Sheet | Placement | Contents |
|---|---|---|
| Trigger graph | A side sheet on the right, about 360 px wide, filling the height between the top and bottom clusters | The nodes as cards in chain order, with wires from each prerequisite to its dependant, and a node form at the bottom |
| Prop library | Centred | The upload form, then a card grid like the picker's |
| Versions | Centred | The freeze form (owner only), then a list of version cards, newest first |
| Playtests | Centred | The schedule form, then one card per session showing its state, start time (in UTC, as `YYYY-MM-DD HH:MM UTC`, the same as the tester's scheduled copy), clock and hint controls, plus roster rows with each tester's email, display name, joined mark, email status, and Revoke and Resend buttons |
| Debrief | Centred | The playtest-ended heading, the outcome line, the chain figures, a per-puzzle table, hints used, the choke point and the debrief email status |
| Keyboard shortcuts | Centred | The keys from Interactions |
| New room | A small centred sheet | The room form |

Each version card shows:

- `Version <number>` and the label;
- the state word;
- the frozen time and the chain figures from the freeze;
- the build-pack link controls. Copy build pack link is shown to every member. Regenerate link and Revoke link are shown only to the owner.

**Tester page** (`/play/<token>`). It uses the same stage, with the camera at player height (1.6 m) inside the room.

- The top-centre pill shows the room name, the status word and the playtest clock.
- The transport bar holds Puzzles, Hints, the raised Join button, Units and Help.
- The Puzzles sheet lists every node with its state (solved, available or waiting). Available puzzle and exit nodes get an answer field when they need one, and a Solve button.
- The Hints sheet lists the hints received.
- The tester page never shows member tools.

**Build pack page** (`/pack/<token>`). It is a scrolling document page on the dark ground, with no editing controls.

- **Pinned top bar.** A top bar stays pinned to the top of the window at every size and while the page scrolls. It holds the version state word (`Frozen` or `Superseded`) and the Units button.
- **Content column.** Below the bar, the column holds:
  - the heading `Build pack — <room name> v<number>`;
  - the version label and frozen time, plus the superseded notice when it applies;
  - four tables.
- **Tables:**

  | Table | Columns |
  |---|---|
  | Room | Width, Depth, Height |
  | Placements | Label, Kind, X, Y, Z, Width, Depth, Height, Rotation |
  | Trigger wiring | Title, Kind, Needs, Linked placement, Answer |
  | Files | Prop name, Bytes, SHA-256, Download |

- **Length cells.** Every length cell holds exactly the length string for the current units and nothing else (for example `5.000` or `16' 4 7/8"`). The column header names the unit: `(m)` or `(ft)`.
- **Table regions.** Each table sits in its own region that Tab can reach, named `Room table`, `Placements table`, `Trigger wiring table` and `Files table`. The tables keep their table role and column headers.
- **At 375x812:**
  - Cells stay on one line.
  - A table wider than the screen, such as Placements, scrolls sideways inside its own region. The page itself never scrolls sideways.
  - Every Download link has a hit area of at least 44 by 44 px.
- **At 768x1024 and 1280x800:**
  - The content column is at most 960 px wide and centred.
  - Cells may wrap at spaces, and the SHA-256 wraps inside its cell, so no table region needs to scroll sideways.

**Public page** (`/`). It uses the same grid stage behind a page that scrolls.

- A slim header holds the logo and a `Sign in` link.
- Five short text panels pass over the stage as the visitor scrolls. The first has the heading `Walk the room before you build it.`
- A chain list on the right lists the Vault's six nodes.
- The page ends at the sign-up sheet, a form in the sheet style.

**No WebGL.** When the browser cannot create a WebGL context, the stage area shows a flat top-down floor plan of the open room instead:

- the room outline to scale;
- each placement as a labelled rectangle or circle;
- the entry door marked.

The notice from Feedback states sits above the plan. Room cards use the same flat plan as their thumbnail.

**Viewports.** The layout changes at exactly one width, 768 px. Below 768 px the phone layout applies, and at 768 px and wider the corner-cluster layout applies. No other breakpoint changes which layout a published size gets, and no published size scrolls sideways.

- **375x812 (phone):**
  - **Top:** the logo, a compact pill, the Presence button and the first chain figure. The compact pill holds the status dot, the room code and a chevron that opens the Session menu. The invite field, Playtests and the other chain figures live in the Session menu.
  - **Bottom tab bar:** the transport becomes a labelled five-slot tab bar, sized and placed as in Phone tab bar geometry below. Its slots are Tools (a menu holding Move, Rotate, Scale and Scene), Graph (opens the Trigger graph sheet), the round Play button raised above the bar in the centre, Props (opens the Prop library sheet) and Rooms (opens the room picker). On the tester page the slots are Puzzles, Hints, the raised Join button, Units and Help.
  - **Room picker:** a near-full-screen sheet with 12 px side margins. It ends above the tab bar and scrolls inside itself. Its grid has two columns, and its footer stacks the checkbox on one row and the three links on the row below.
  - **Other sheets:** each becomes a full-width sheet with 12 px margins that scrolls inside itself.
  - **Bottom corner clusters:** they move into the Tools menu and the Session menu.
- **768x1024:** the corner-cluster layout. The picker is 600 px wide with four columns, the transport bar is centred at the bottom, and the side sheets sit on the right.
- **1280x800:** the same corner-cluster layout as at 768x1024.

**Phone tab bar geometry (375x812).** These rules hold on the editor and on the tester page:

- The tab bar keeps the role and name `toolbar "Transport"`. It is 60 px tall and spans the full width of the window along its bottom edge, so its top edge is 60 px above the bottom of the window (752 px down at 375x812).
- The raised Play button (Start playtest or Stop playtest), and the tester page's raised Join button, is a 56 px circle whose centre sits on the tab bar's top edge, within 1 px. Its upper half rises above the bar.
- The room picker, every sheet, the Debrief dialog and the Command palette end at or above the tab bar's top edge. No part of them, and none of their fields or buttons, is ever under the tab bar, and no field or button of theirs is ever under the raised button's circle. Content that does not fit scrolls inside the sheet.

**Scene panel.** At 768 px and wider, a room open for editing shows the Scene panel on the left, below the logo button and above the bottom-left buttons, about 240 px wide. It holds the Scene tree: one top item for the room, expanded, and one item under it for each placement, in scene order (see Business rules). On a phone the panel is hidden, and the Tools menu item `Scene` opens it as a full-width sheet.

**Command palette.** A centred dialog about 560 px wide near the top of the window, over the scrim, with the command field on top and the matching options below it. On a phone it is a full-width sheet with 12 px margins.

**Connection status.** A short line in the session pill, right after the status word. On a phone it sits at the top of the Session menu.

### Public screens and controls (DP-02, DP-08, DP-12, DP-13, DP-15, DP-16, DP-20, DP-23, DP-26, DP-30, DP-31, DP-32, DP-34, DP-35, DP-38, DP-42, DP-45, DP-46, DP-47, DP-48, DP-50, DP-52, DP-53, DP-54)

Only the controls and regions in this table are public. Names are accessible names, and `<…>` marks a value from the record.

| Where | Role and accessible name | Visible copy / notes |
|---|---|---|
| Public page | `heading "Walk the room before you build it."` (level 1) | first tour panel |
| Public page | `list "Vault chain"` | six items, the Vault node titles in chain order |
| Public page | `status "Tour progress"` | `<k> of 6 cues lit` |
| Public page | `form "Create your venue"` with textboxes `Email`, `Password`, `Your name`, `Venue name` and `button "Create venue"` | heading `Open your bench` |
| Public page | `link "Sign in"` | `Sign in` |
| `/signin` | `form "Sign in"` with textboxes `Email`, `Password` and `button "Sign in"` | |
| Stage | `region "Room stage"` | holds the 3D canvas or the floor plan |
| Stage | `status "Camera"` (visually hidden) | `Overview`, `Walking in` or `Player height` |
| Top-left | `button "Rooms"` | logo; opens the room picker |
| Top-centre | `toolbar "Live session"` | status word `Live` or `Paused`, and the room code |
| Top-centre | `button "Copy room code"` | |
| Top-centre | `textbox "Invite tester email"`, `button "Invite"` | Invite sends to the room's target session. That is its `lobby` or `running` session when one exists (a room has at most one), else its `scheduled` session with the earliest start time. Invite is disabled until the field has a value and the room has a target session. |
| Top-centre | `button "Playtests"` | opens the Playtests sheet |
| Top-centre | `button "Session menu"` → `menu` with `menuitem`s `Freeze version`, `Versions`, `Prop library`, `Keyboard shortcuts`, `Sign out` | |
| Top-centre | `status "Service status"` | the outage banners |
| Top-right | `group "Chain figures"` | `<solved> of <total> solved`, `Longest run <run>`, `<props> props` |
| Top-right | `button "Presence"` | `<n> here` |
| Top-right | `button "Account"` | initials |
| Right | `region "Inspector"` | the selected placement's label, lengths and rotation |
| Bottom-centre | `toolbar "Transport"` | |
| Transport | `button "Move"`, `button "Rotate"`, `button "Scale"` | the pressed state shows the current mode |
| Transport | `button "Start playtest"` / `button "Stop playtest"` | the round Play button: a triangle glyph, then a stop square |
| Transport | `timer "Playtest clock"` | `mm:ss` |
| Transport | `button "Trigger graph"`, `button "Prop library"`, `button "Next node"` | |
| Phone tab bar | `button "Tools"`, `button "Graph"`, `button "Props"`, `button "Rooms"` | labels as named |
| Bottom-left | `button "Add primitive"` → `menu` with `Door`, `Box`, `Cylinder` | |
| Bottom-left | `button "Upload prop"` | opens the Prop library sheet with the file field focused |
| Bottom-right | `button "Cue timeline"`, `region "Cue timeline"` | |
| Bottom-right | `button "Units"` | `m` or `ft`; pressed (`aria-pressed="true"`) while feet are shown |
| Picker | `dialog "Open a room"` | |
| Picker | `button "Close"` | ✕ |
| Picker | `heading "Pick a room"` (level 2) | |
| Picker | `listbox "Rooms"` with one `option "<room name>"` per room | the highlighted option has `aria-selected="true"` |
| Picker | `link "New room"` | |
| Picker | `checkbox "Walk in when I pick a room"` | |
| Picker | `link "Prop library"`, `link "Versions"`, `link "Keyboard shortcuts"` | |
| Sheet | `dialog "New room"` with textboxes `Room name`, `Width (m)`, `Depth (m)`, `Height (m)` and `button "Create room"` | |
| Sheet | `dialog "Trigger graph"` | |
| Graph | `list "Trigger nodes"` with one `button "<node title>"` per node | the selected node has `aria-pressed="true"` |
| Graph | textbox `Node title`, combobox `Node kind`, `group "Prerequisites"` of checkboxes named by node title, combobox `Linked placement`, textbox `Answer` | Node kind's options are labelled exactly `puzzle`, `lock`, `cue` and `exit` |
| Graph | `button "Add node"`, `button "Save node"`, `button "Delete node"` | |
| Sheet | `dialog "Prop library"` | |
| Library | file input `glTF file`, textboxes `Prop name`, `Width (m)`, `Depth (m)`, `Height (m)`, and `button "Upload"` | |
| Library | `list "Props"` with `button "Place <prop name>"` and `button "Delete <prop name>"` per prop | |
| Sheet | `dialog "Versions"` | |
| Versions | textbox `Version label`, `button "Freeze version"` | owner only |
| Versions | `list "Version cards"`, one `listitem` per version, newest first | each card's text begins `Version <number>` and contains its state word |
| Versions | per card: `button "Copy build pack link"`, `button "Regenerate link"`, `button "Revoke link"` | Copy is disabled while the version has no link. Regenerate and Revoke are owner only, and Revoke is disabled while there is no link. |
| Sheet | `dialog "Playtests"` | |
| Playtests | textbox `Start time`, `button "Schedule playtest"` | A native date-and-time field. Its value is `YYYY-MM-DDTHH:MM` (for example `2026-11-12T19:30`), read in the browser's time zone. The page converts it to a UTC ISO 8601 `startsAt` before sending. Schedule playtest is disabled while the field is empty. A refused time shows the API's `startsAt` message beside the field. |
| Playtests | per session: `button "Open lobby"`, `button "Start"`, `button "End"`, `button "Cancel playtest"` | shown only for legal moves |
| Playtests | on each session card in `scheduled`, `lobby` or `running`: `textbox "Tester email"`, `button "Send invite"` | invites to that card's session |
| Playtests | `table "Roster"` with `button "Revoke <email>"` and `button "Resend <email>"` per row | email status `Sent`, `Queued` or `Failed` |
| Playtests | `textbox "Hint"`, `button "Send hint"` | cooldown text |
| Sheet | `dialog "Debrief"` | |
| Debrief | `heading` with the playtest-ended copy | |
| Debrief | `table "Puzzle times"` | |
| Sheet | `dialog "Keyboard shortcuts"` | |
| Everywhere | `status "Editor status"` | polite announcements |
| Tester page | `status "Playtest status"` | polite announcements |
| Tester page | `button "Join"` (raised centre) | `Join`, then disabled with `Joined` |
| Tester page | `textbox "Display name"` | shown, with Join, in `scheduled`, `lobby` and `running` until the tester has joined |
| Tester page | `button "Puzzles"`, `button "Hints"`, `button "Help"`, `button "Units"` | |
| Tester page | `dialog "Puzzles"` with, per node, a `textbox "Answer for <title>"` (when needed) and a `button "Solve <title>"` | |
| Tester page | `dialog "Hints"` | |
| Build pack | `heading "Build pack — <room name> v<number>"` (level 1) | |
| Build pack | top bar with the state word and `button "Units"` | `m` or `ft`; pressed (`aria-pressed="true"`) while feet are shown |
| Build pack | `region "Room table"`, `region "Placements table"`, `region "Trigger wiring table"`, `region "Files table"` | each holds `table "Room"`, `table "Placements"`, `table "Trigger wiring"` or `table "Files"` |
| Build pack | `link "Download <prop name>"` per prop file | |
| Top-centre | `status "Connection"` | the Connection copy from Feedback states |
| Left | `region "Scene"` holding `tree "Scene"` | one `treeitem` for the room (`aria-level="1"`, expanded, named by the room name) holding one `treeitem` per placement |
| Scene | per placement, `treeitem "<label>"` | The accessible name is exactly the label. It carries `aria-level="2"`, `aria-posinset` (its 1-based place in scene order), `aria-setsize` (the room's placement count) and the attributes `data-x-mm`, `data-y-mm`, `data-z-mm` and `data-rotation-deg`: whole numbers giving what the stage draws now, including waiting and unsaved changes. While another member holds the placement, its accessible description is `Locked by <display name>`. From its first drop on, it also carries `data-sim-steps`. |
| Stage | attributes of `region "Room stage"` | `data-cam-yaw` and `data-cam-pitch`: whole degrees of the editing camera |
| Inspector | `spinbutton "Rotation"` | the selected placement's `rotationDeg`, editable |
| Phone Tools menu | `menuitem "Scene"` | opens the Scene panel as a sheet |
| Editor | `dialog "Prop locked"` with `button "Cancel"`, then `button "Take over"` | the Prop locked copy from Feedback states |
| Editor | `dialog "Command palette"` with `combobox "Command"` and `listbox "Commands"` of `option`s | Each option's text is exactly its command or version name. The active option has `aria-selected="true"`. An unavailable option has `aria-disabled="true"` and the unavailable copy from Feedback states as its accessible description. |

### Interactions (DP-08, DP-12, DP-13, DP-15, DP-16, DP-19, DP-23, DP-26, DP-31, DP-35, DP-46, DP-47, DP-48, DP-50, DP-51, DP-52, DP-53, DP-54, DP-56)

**Dialogs and sheets (all of them).**

- Opening a dialog moves focus to its first control. In the room picker, focus goes to the highlighted card.
- Tab past the last control wraps to the first, and Shift+Tab before the first wraps to the last. Focus never reaches the page behind. When the focused control disappears because of a state change (for example Start once its session runs), focus moves to the sheet's first control, so it never leaves the sheet.
- Escape, or the sheet's close button, closes the topmost dialog and returns focus to the control that opened it.
- When the picker was open at page load, closing it returns focus to the Room stage region.

**Room picker.**

- The picker opens on every editor load and from the Rooms button. The first card is highlighted when it opens.
- Arrow Left and Arrow Right move the highlight by one card. Arrow Up and Arrow Down move it by one row (four cards on desktop, two on a phone). Home and End jump to the first and the last card. Hovering a card highlights it too.
- Enter, a click or a tap opens the highlighted room:
  - With `Walk in when I pick a room` checked, the user walks in (see Motion and effects).
  - With it unchecked, the room opens for editing at the overview camera.
- If the walk-in is refused, the room opens for editing and the refusal copy appears in Editor status.
- New room opens the New room sheet. A newly created room opens for editing.

**Editor keys.** Which keys work depends on where focus is:

| Focus | Keys that work |
|---|---|
| No sheet or dialog is open, and focus is on any editor control outside a text field (a transport button such as Play, a cluster button, or the Room stage region) | every key in the table below |
| Inside the Trigger graph sheet, outside a text field (for example on a node card or a prerequisite checkbox) | N, Shift+N, T and Escape. T and Escape close the sheet and return focus to the control that opened it. |
| Inside the room picker | the room picker keys above, and Escape |
| On an item of the Scene tree | the Scene tree keys from Scene tree below, and Escape |
| Inside any other sheet or dialog, or in any text field | Escape only |

| Key | Effect |
|---|---|
| G / R / S | Move / Rotate / Scale mode |
| ] / [ | select the next / previous placement in creation order |
| Arrow keys, Move mode | move the selected placement 10 mm (100 mm with Shift). Right adds to `xMm` and Left subtracts from it. Up adds to `zMm` (away from the front wall) and Down subtracts from it. |
| Arrow Left / Right, Rotate mode | Right adds 15 to `rotationDeg` and Left subtracts 15, wrapping within 0..359 (345 plus 15 gives 0; 0 minus 15 gives 345). Up and Down do nothing. |
| Arrow keys, Scale mode | Right adds 10 mm to `widthMm` and Left subtracts 10 mm. Up adds 10 mm to `heightMm` and Down subtracts 10 mm. |
| Delete | delete the selected placement |
| N / Shift+N | select the next / previous trigger node in chain order, opening the Trigger graph sheet if it is closed |
| P | start or stop a playtest (the same as the Play button) |
| T | open the Trigger graph sheet; with focus inside it, close it |
| L | open the Prop library sheet |
| ? | open the Keyboard shortcuts sheet |
| Escape | close the topmost dialog, or clear the selection |
| Arrow keys, nothing selected, focus on the Room stage | turn the camera (see Camera below) |
| D | drop the selected placement to the floor (see Drop below) |
| Ctrl+Z (Cmd+Z on a Mac) | undo your own latest change (see Undo below) |
| Ctrl+K (Cmd+K on a Mac) | open the Command palette (see Command palette below) |

Nudges stay inside the placement bounds from the API, all inclusive:

- `xMm` stays within 0 to the room width.
- `zMm` stays within 0 to the room depth.
- Each size stays within 10 mm to the room's matching dimension.

A press that would cross a bound sets the value to that bound. A press when the value is already at the bound changes nothing and saves nothing.

**Pointer.**

- Clicking a placement selects it and takes its lock.
- Dragging a selected placement depends on the mode:
  - Move: it slides over the floor.
  - Rotate: it turns.
  - Scale: dragging its corner handles resizes it.
- Dragging empty floor orbits the camera, and the wheel or a pinch zooms. Orbit and zoom also work with reduced motion.
- Each finished drag or nudge saves within one second.
- While a placement stays selected, its lock is refreshed every 10 seconds. Clearing the selection, or selecting another placement, releases the lock.

**Play button.**

- When the open room has a lobby session that the user controls, Play starts it and the camera stays at the overview, which is the game-master view.
- Otherwise Play walks the user in, as in the room picker.
- While a session of the room is running and the user controls it, the button reads Stop playtest. Stopping ends the session, returns the camera and opens the Debrief dialog.
- When a playtest the user hosts ends while their editor is open (by Stop, P, the exit, `/end` or the deadline), the Debrief dialog opens. When that Debrief dialog closes, focus goes to the round Play button, which reads Start playtest again.

**Trigger graph sheet.**

- Clicking a node card, or reaching it with N, selects it. Selecting a node takes its lock and fills the node form.
- If another member holds the node, the form turns read-only and the holder copy appears.
- Save node and Delete node apply the change. Add node creates a puzzle node titled `New puzzle`.
- Wires update as prerequisites change.

**Prop library sheet.**

- Choosing a file and pressing Upload adds a pending card with a placeholder. The card then turns into the stored prop card, or disappears and the failure copy appears.
- When the pending card turns into the stored prop card, focus moves to that card's Place <prop name> button.
- Place <prop name> adds the prop at the centre of the room floor and closes the sheet.

**Versions sheet.**

- Freeze version (in the sheet, or from the Session menu) freezes the open room with the typed label.
- After a freeze from the sheet succeeds, the member who froze sees the new card at once from the freeze answer itself, whether or not live events arrive, and focus moves to that card's Copy build pack link button.
- While the sheet is open, every `version` event for the room updates it in place within one second:
  - a new version's card is inserted at the top;
  - a superseded card's state word changes from `Frozen` to `Superseded`;
  - a card whose link was revoked gets a disabled Copy build pack link, and Copy is enabled again after Regenerate link.
- The sheet never reloads or re-renders as a whole. The focused control keeps focus, and the sheet's scroll position does not move.
- The member who did not freeze gets no Editor status announcement for these updates.
- Copy build pack link copies the version's link and announces the link-copied copy.

**Build pack page.**

- **Units on open.** The page reads `units` from its address. With `units=ft` it shows feet from its first render. With `units=m` it shows metres. When the value is missing or anything else (for example `units=yards`), it shows metres and rewrites the address to `?units=m` in place.
- **Units button.** Pressing it switches every shown length. It also replaces the current address with the new `units` value without adding a history entry, so Back leaves the pack page in one step.
- **Reloads and forwarded links.** A reload, or a copied or forwarded address, opens in the same units.
- **What units do not change.** Download links and the pack API ignore units. The editor's own Units choice is remembered per browser, separately from the pack page.
- **Phone.** On a phone, a table region scrolls sideways under a swipe, or with the arrow keys once it has focus.

**Tester page.**

- While the session is `scheduled`, in the `lobby` or `running`, a tester who has not joined yet types a display name and presses Join. Join then turns into the disabled `Joined`.
  - Joining while scheduled or in the lobby shows the matching waiting copy until the session starts.
  - Joining while running is a late join. The tester is placed at the player-height start pose at once, and the clock shows the server's remaining time.
- An ended or cancelled session shows the expired-invite copy instead of the Join controls.
- While the session runs:
  - W, A, S, D or the arrow keys walk the tester, and dragging looks around. On a phone, dragging on the left half of the stage walks and dragging on the right half looks.
  - Walking within 1.5 m of a placement linked to an available node opens that node's entry in the Puzzles sheet.
  - Walking into a box or cylinder placement pushes it. The push is local to that tester and never changes the room.
  - The tester's position is sent to the server every 2 seconds while they move.

**Public page.** Only scrolling moves the camera, and scrolling back reverses each step.

**Save queue.**

- Every placement change the editor makes is one change: each nudge, finished drag, rotation, resize, Inspector edit, drop landing, scene move and delete. Each gets a fresh change id when it is made and joins its room's save queue, and the stage and the Scene tree draw it at once.
- The queue sends one change at a time, oldest first, as the matching API request with the change id in the `Op-Id` header. It sends the next change only after the previous one has an answer. A change to a placement that an earlier queued change touched is sent with the `version` the server returned in that earlier answer, so the editor's own changes never count as someone else's newer save.
- A send that gets an HTTP response, whatever its status, takes the change out of the queue. A send that gets no response at all (the network is down, or the request fails before any answer) leaves the change at the front, and the editor is offline. It then retries the front change every 5 seconds of page time, with the same change id and body, and at once when the browser reports it is back online.
- The queue is kept in the browser's local storage for each room, so it survives a reload or a closed tab. When the room opens again, the editor draws the stored room with every waiting change applied on top, in order, and starts sending.
- A replayed change answered 200 is applied. One answered 412 is dropped with the newer-change copy, one answered 410 with the deleted-placement copy, and one answered 409 locked with the holder copy, all from Feedback states. Any other answer drops the change and redraws the room as stored, with the copy that answer has elsewhere in Feedback states, or none.
- `status "Connection"` shows the queue's state with the Connection copy from Feedback states.

**Lock takeover.**

- Selecting a placement that another member holds still shows it in the Inspector, with the holder copy in Editor status. Nudge, rotate, scale and drop keys on it save nothing and show the holder copy again.
- The Inspector's Rotation field stays editable. Committing a changed value (Enter in the field, or leaving it) saves nothing and opens the `Prop locked` dialog with focus on Cancel.
- Cancel or Escape closes the dialog, puts the saved value back in the field and returns focus to the field.
- Take over takes the lock from the holder (see Business rules), saves the committed value, closes the dialog and shows the taker copy. The former holder's editor shows the taken-over copy within one second, draws the new value and does not take the lock back.

**Undo.** Ctrl+Z (Cmd+Z on a Mac), with focus on an editor control outside a text field and no dialog open, asks the server to undo your own latest undoable change in the open room (see Business rules) and shows the result in Editor status with the undo copy from Feedback states. Other members' changes are never undone.

**Scene tree.**

- The tree is one Tab stop. Tab lands on the item that last had focus, or on the room item the first time. Arrow Down and Arrow Up move focus to the next or previous item, and Home and End to the first and the last.
- Enter, or a click, on a placement item selects that placement, as clicking it on the stage does, and keeps focus on the item.
- Alt+Arrow Up and Alt+Arrow Down on a placement item move that placement one place up or down in scene order. Focus stays on the same item, and Editor status announces the scene-move copy. Each press is one change in the save queue, and a press counts from the order as drawn, including moves not yet answered: three quick presses move the item three places and send three changes. Alt+Arrow Up on the first placement item, and Alt+Arrow Down on the last, do nothing and send nothing.

**Camera.**

- The Room stage region is one Tab stop. Its `data-cam-yaw` (0 to 359) and `data-cam-pitch` (5 to 80) give the editing camera in whole degrees. They change at once on each key press or drag movement, with no easing. A room opened for editing at the overview starts at yaw 30 and pitch 35.
- With no placement selected and focus on the Room stage, Arrow Right adds 15 to yaw and Arrow Left subtracts 15, wrapping within 0..359 (345 plus 15 gives 0; 0 minus 15 gives 345). Arrow Up adds 15 to pitch and Arrow Down subtracts 15, and a press that would pass 80 or 5 stops there. For example, from the start pose two Left presses give yaw 0 and a third gives 345; three Up presses give pitch 50, 65 and 80, and a fourth leaves 80.
- A one-finger touch drag, or a mouse drag, that does not start on a placement turns the camera. Each CSS pixel of horizontal travel changes yaw by 0.5 degree (dragging right adds), and each CSS pixel of vertical travel changes pitch by 0.5 degree (dragging up adds), with the same wrapping and stops, shown rounded to whole degrees with halves rounded up. For example, a 120 px drag to the right from yaw 30 ends at yaw 90. A touch drag on the stage never scrolls or zooms the page.

**Drop.**

- D drops the selected box, cylinder or prop placement whose `yMm` is above 0 straight down to the floor. A door, or a placement already at `yMm` 0, does not move.
- The fall is a fixed-step simulation at 120 steps per second of page time, with gravity g = 9,810 mm/s², semi-implicit Euler and no bounce. It starts at speed 0 at the placement's height y0. Each step first adds g × 1/120 s to the downward speed, then lowers the height by the new speed × 1/120 s. After k steps the height is exactly y0 − 109 × k × (k + 1) ÷ 320 mm. A step that would take the height to 0 or below ends the fall at exactly 0.
- After t ms of page time since D was pressed, the simulation has run floor(t × 120 ÷ 1000) steps, however often the screen redraws.
- During the fall, the placement's Scene item shows the height rounded to the nearest whole millimetre in `data-y-mm`, and the steps run so far in `data-sim-steps`. After landing, `data-sim-steps` keeps the final count until the next drop.
- Nothing is saved during the fall. On landing the editor saves `yMm` 0 as one change.
- Worked example, for a box at `yMm` 1200: after 12 steps (100 ms) the height is 1146.8625 mm, shown `1147`; after 30 steps (250 ms) it is 883.21875 mm, shown `883`; after 58 steps it is 34.38125 mm, shown `34`. Step 59 would take it to −5.8125 mm, so the box lands at step 59, about 492 ms after D, with `data-y-mm="0"` and `data-sim-steps="59"`, and one save of `yMm` 0.

**Command palette.**

- Ctrl+K (Cmd+K on a Mac), with focus on an editor control outside a text field, opens the Command palette with focus in the Command field and every command listed, the first one active.
- The commands, in this order: `Start playtest`, `Freeze version...`, `Restore version...`, `Open Versions`, `Open Prop library`, `Open Trigger graph`, `Keyboard shortcuts`.
- Typing keeps only the options whose name contains the typed text, ignoring case, and makes the first of them active. Arrow Down and Arrow Up move the active option, wrapping. Enter runs the active option. Escape closes the palette.
- When the palette closes, by Escape or after running a command that opens no other dialog, focus returns to the control that opened it.
- While the live banner shows, `Start playtest` stays listed but is unavailable: Enter on it does nothing and the palette stays open.
- `Restore version...` keeps the palette open, empties the field and lists the room's versions newest first, each named `Version <number> — <label>`. Typing filters them the same way, and the first is active. Enter on a version restores it (see Business rules) and shows the restore copy in Editor status.
- `Start playtest` acts like the Play button, `Freeze version...` opens the Versions sheet with focus in Version label, and the Open commands and `Keyboard shortcuts` open their sheets.
- When a restore succeeds, every editor that has the room open, on either instance, redraws the restored room in place within one second: no reload, focus kept, and its Scene item attributes follow.

### Visual design (DP-09)

The look is workshop-dark. The editor looks like a real escape room lit as a dark set before the lights cue, because owners judge sightlines and reveal cues in low light.

**Colour roles.**

| Role | Used for |
|---|---|
| Ground: a near-black blue-grey | the stage and page background |
| Surface: one step lighter, a dark slate | panels, clusters, cards and sheets |
| Surface-raised: a further step lighter | card label strips and loading placeholders |
| Hairline: a barely visible slate line | panel, card and table-row edges |
| Ink: near-white with a cool cast | main text |
| Muted ink: a cool mid grey | subtitles, figures, the build line and wires |
| Accent: a clear mid blue | the selection ring, primary buttons and the selected node ring |
| Link-on-dark: a lighter sky blue | text links, underlined |
| Play-accent: a hot orange-red | the round Play button, the only saturated colour on screen |
| On-accent: white | glyphs and text on the blue and orange fills |
| Scrim: a dark navy at about nine-tenths strength | behind open dialogs |

**Type.**

- Inter is used for everything readable.
- JetBrains Mono is used for the build line, room codes, ids, the playtest clock and file hashes.
- Lengths, solve times, counts and the clock use tabular figures, so digits do not shift.
- Body text is small (about 13 to 14 px), and each heading step is only about 8% larger than the one below it.
- The largest text anywhere is the wordmark, about a third larger than body text. Nothing on screen is larger than 18 px.

**Density.** Compact, with tight, even spacing on small steps. Related items sit closer together than separate groups.

**Composition.**

- The full-window stage never scrolls. The grid fades into the distance toward the screen centre, and the window edges are slightly vignetted.
- The chrome is small floating rounded clusters at the corners and at the top and bottom centre.
- The round Play button sits in the middle of the transport bar inside a soft orange halo.

**First screen.** The room picker over the dimmed stage is the hero. Its header carries the Tumbler & Pin mark and the Keyway bench wordmark.

**Room thumbnails.**

- Each card thumbnail is a small, low-poly, toon-lit render of that room's own primitives (floor, walls, doors, boxes, cylinders), made by the app's own 3D renderer.
- Saturated wood, brass and deep-sea colours stand out against the dark interface.
- A grey raised placeholder shows until each thumbnail is ready.

**Working screens.**

- Every sheet and cluster has the surface fill, a hairline edge and rounded corners. Sheets are slightly rounder than clusters, and cards and node cards are less round.
- The selected node and the highlighted card get the blue ring, set a little outside their edge. Wires are drawn in muted ink.
- Tables are plain rows separated by hairlines.
- Empty states show the bare grid stage with one short muted line, and loading uses raised grey placeholders.
- Errors and outages appear as the slim banner in the session pill. Nothing turns red.
- The build-pack page uses the same ground, ink and hairline tables. Its pinned top bar uses the surface fill.

**Accessibility.**

- Every control has a hit area of at least 44 by 44 px, even where the visible square is smaller.
- Text and controls meet WCAG 2.2 AA contrast on their backgrounds.
- Icons are Lucide stroke icons, and every icon-only button has its accessible name.

### Motion and effects (DP-08, DP-10, DP-11, DP-15)

All motion uses plain, even easing with no bounce or spring.

| What changes | How it moves |
|---|---|
| Hover and highlight | Fill, text and edge colour on buttons, cards and links change over about an eighth of a second. |
| Press | A pressed card or cluster button shrinks slightly (to about 98% for cards and 95% for cluster buttons) over about a tenth of a second. |
| Play button | Grows slightly on hover over about 0.15 s and dips on press over about a tenth of a second. |
| Dialog open | The scrim fades in, and the dialog fades in while growing from 98% to full size, all within a fifth of a second. |
| Dialog close | The reverse, over about 0.15 s. |
| Sheet view swap (for example the picker's back chevron) | A short fade and a slide of a few pixels, over about 0.15 s. |
| Version cards updating live | Change in place with only the colour change, with no slide or reflow animation. |
| Idle | Nothing. There is no idle motion and no looping animation anywhere, and the grid stays still until a camera move or a playtest. |

**Doorway walk-in (the signature).** Observable steps:

1. On load the stage renders. Within a fifth of a second the scrim fades in and the picker grows into place.
2. The first card carries the blue ring. The arrow keys move the ring, with colour changes over about an eighth of a second.
3. Pointer-down or Enter shrinks the card slightly over about a tenth of a second.
4. On release, the dialog and scrim fade out over about 0.15 s.
5. The camera dollies from the three-quarter overview through the room's entry door to the player-height start pose over 0.5 to 0.7 seconds. The start pose is 1.6 m above the floor and 0.8 m inside the door, facing into the room. When the room has no entry door, the camera passes through the middle of the front wall. Camera reads `Walking in` during the dolly and `Player height` after it.
6. The Play glyph becomes a stop square, and the Playtest clock shows the server's remaining time counting down (60:00 at the default duration).
7. The chain figures read `0 of <total> solved`.

Stop returns the camera to the exact editing pose saved before the walk-in, over 0.5 to 0.7 seconds, and Camera reads `Overview`.

**Public tour.**

- The camera's path through the Vault is tied to scroll position. It runs from the overview at the top of the page, through the door, to player height at the sign-up sheet.
- Progress is the scrolled fraction of the page. The camera moves forward only as progress grows, and steps back exactly as progress shrinks.
- Node k of the Vault's six lights up (its list item and its 3D marker turn from muted to blue) once progress reaches k/7. It goes dark again when progress falls below that point.
- Tour progress tracks the lit count.

**Reduced motion.** When the operating system asks for reduced motion:

- No dialog or card scales and no dolly runs. The dialog and scrim disappear within 80 ms.
- The camera cuts straight to the player-height pose, and Stop cuts straight back.
- The stop glyph, the clock and the `0 of <total> solved` figure appear at once, with the same Camera and Editor status announcements.
- On the public page the camera stays at the overview, and the cues light instantly at the same scroll thresholds.
- Colour changes still happen, instantly.

**Without WebGL.** The flat floor plan replaces every camera move. The walk-in only switches the clock, the glyph and the figures.

### Feedback states (DP-07, DP-11, DP-17, DP-18, DP-20, DP-22, DP-25, DP-26, DP-27, DP-30, DP-32, DP-33, DP-34, DP-37, DP-38, DP-39, DP-46, DP-48, DP-50, DP-51, DP-52, DP-54)

All copy below renders character for character. Apostrophes and quotes are straight, the em dash appears where shown, an ellipsis is three plain dots, and case and digits are as printed. Announcements in the named live regions carry the same characters.

**Figures** (one format for every surface):

- `<solved> of <total> solved`
- `Longest run <run>`
- `<props> props`, or `1 prop` when there is exactly one

On the room card the three figures are joined with ` · `.

**Editor status** (a polite live region; each new message replaces the previous one):

| Situation | Copy |
|---|---|
| Upload pending | `Uploading <file name>...` |
| Upload success | `<prop name> is in the library.` |
| Upload failure (any error) | `Upload failed. Nothing was added.` |
| Freeze pending | `Freezing version...` |
| Freeze success (announced to the member who froze) | `Version <number> frozen.` |
| Freeze failure | `Freeze failed. Nothing was saved. Try again.` |
| A placement is held by someone else | `<display name> is holding this prop.` |
| A node is held by someone else | `<display name> is holding this node.` |
| A save hit a newer version (the view reloads the record) | `Someone saved a newer change. Your view has been refreshed.` |
| Walk-in or start refused because the room is busy | `Another playtest is running in this room.` |
| Edit refused during a running playtest | `This room is in a playtest. Edits resume when it ends.` |
| Field errors | the API's message beside the field, with the first one announced |
| Playtest started | `Playtest running.` |
| Playtest ended | the playtest-ended heading text |
| Link copied | `Link copied.` |
| Link regenerated | `New link made. The old link no longer works.` |
| Link revoked | `Link revoked.` |
| Invite sent | `Invite sent to <email>.` |
| Invite queued | `Invite to <email> is queued.` |
| Invite failed | `Invite to <email> failed.` |
| A replayed change hit a deleted placement | `<label> was deleted by <display name>. Your change was not saved.` |
| You took over a lock | `You now hold <label>.` |
| Someone took over your lock | `<display name> took over <label>.` |
| Undo done | `Undid your <field> change on <label>.` |
| Undo refused because the placement was deleted | `Can't undo: <label> was deleted by <display name>.` |
| Undo refused because there is nothing to undo | `Nothing to undo.` |
| Scene move | `Moved <label> above <label>.` or `Moved <label> below <label>.`, naming the moved placement, then the one it passed |
| Restore done | `Restored v<number> as change <revision>.`, with the version number and the room's new revision |

**Connection** (`status "Connection"`, a polite live region):

| Queue state | Copy |
|---|---|
| Empty | `All changes saved.` |
| Sending, with no send failed since the last answer | `Saving...` |
| From the first send that got no response until the queue is empty | `Offline. <n> changes waiting to save.`, or `Offline. 1 change waiting to save.` when `<n>` is 1, where `<n>` counts the waiting changes |

**Dialog and option copy:**

| Situation | Copy |
|---|---|
| Prop locked dialog text | `<holder display name> is editing <label>.` |
| A Command palette option that needs the live service while it is down (its accessible description) | `Needs the live service.` |

**Service status banners** (in the session pill). Each banner clears within 10 seconds after health reports the service up again.

| Situation | Copy |
|---|---|
| Valkey unreachable | `Live editing is paused. Solo editing still works.` |
| MinIO unreachable | `Prop storage is unavailable. Uploads and freezing resume when it's back.` |

The freeze-success copy stays true while Valkey is down, because a freeze does not need Valkey.

**Version state words** (on version cards and in the build-pack top bar): `Frozen` and `Superseded`. Each card's text begins `Version <number>`.

**Email status words:** `Sent`, `Queued`, `Failed`. The Debrief dialog shows `Debrief email: <status>`. The status is Failed if any recipient's debrief failed, else Queued if any is queued, else Sent.

**Hint cooldown:** `Next hint in <m:ss>` while it runs, and `Hint ready` when it reaches zero. A refused hint announces `Next hint in <m:ss>`.

**Playtest states:**

| State | Copy |
|---|---|
| Ended heading (Debrief dialog and the tester's ended screen) | `Playtest ended` |
| Outcome: escaped | `Escaped in <mm:ss>` |
| Outcome: timed out | `Out of time` |
| Outcome: stopped | `Stopped at <mm:ss>` |
| Lobby | `Waiting for the game master to start.` |
| Scheduled | `This playtest starts <YYYY-MM-DD HH:MM> UTC.` |
| Hint received (tester's Playtest status) | `Hint: <text>` |
| Solve success | `<title> solved.` |
| Wrong answer | `That's not it.` |
| Prerequisites not met | `Something else has to happen first.` |

**Empty, expired and not-found states:**

| Situation | Copy |
|---|---|
| Expired invite (the session ended or was cancelled) | `This playtest invite has expired.` |
| Revoked, regenerated-away or unknown link, and unknown routes | `This link isn't valid.` |
| Superseded build pack | `This version has been superseded by version <number>.` |
| Empty prop library | `No props yet. Upload a glTF file to start the library.` |
| Empty room | `This room is empty. Add a primitive or place a prop.` |
| No WebGL | `3D view unavailable on this device. Showing the floor plan.` |
| Sign-in failure | `That email and password don't match.` |
| Sign-up with a taken email | `That email already has a bench.` |

**Time placeholders.** `<mm:ss>` and `<m:ss>` are whole seconds. Minutes are padded to two digits in `mm` and unpadded in `m`.

## Backend

### API (DP-02, DP-03, DP-04, DP-05, DP-17, DP-18, DP-19, DP-21, DP-24, DP-26, DP-28, DP-30, DP-32, DP-33, DP-34, DP-36, DP-39, DP-40, DP-42, DP-43, DP-46, DP-49, DP-50, DP-51, DP-52, DP-55)

**Conventions.**

- All endpoints live under `/api`.
- Requests and responses are `application/json`, except the multipart upload, the thumbnail PNG, file downloads and event streams.
- Times are ISO 8601 UTC strings. Lengths are integers in millimetres, except where the build pack gives length objects.
- Signed-in requests carry the HttpOnly, SameSite=Lax session cookie `kb_session`.

**Errors.** Every error body is `{"error":"<code>"}`, with extra fields only where noted. Validation failures are `422 {"error":"validation","errors":{"<field>":"<message>"}}`.

**Precedence.** Across the whole API, the first failing check decides the response:

1. Body too large: `413`.
2. Not signed in: `401 {"error":"unauthenticated"}`. On capability-token paths, an unknown, revoked or regenerated-away token answers `404 {"error":"not_found"}` instead.
3. An unknown resource, or another workspace's resource: `404 {"error":"not_found"}`.
4. A role that may not do this: `403 {"error":"forbidden"}`.
5. An idempotent replay: its stored response.
6. A state conflict: `409`, `410`, `412` or `429`, as defined in Business rules.
7. Validation: `422`.
8. A needed dependency is unreachable: `503`.

A conditional download answers `304` only once every one of these checks has passed.

A body field that names something by a type the endpoint does not have, such as a lock `targetType` of `chair`, fails validation with 422 on that field. It is never an unknown resource. A placement that was deleted is not unknown either; see Deleted placements in Business rules.

**Accounts.**

- `POST /api/auth/signup` `{"email","password","displayName","venueName"}` → `201 {"user":{"id","email","displayName","role":"owner"},"workspace":{"id","name"}}`, and sets the cookie.
  - The password is 10 to 200 characters, and `displayName` and `venueName` are 1 to 60 characters each.
  - Emails compare case-insensitively. A taken email answers `409 {"error":"email_taken"}`.
- `POST /api/auth/login` `{"email","password"}` → `200 {"user":{…}}`, and sets the cookie. Bad credentials answer `401 {"error":"invalid_credentials"}`.
- `POST /api/auth/logout` → `204`.
- `GET /api/me` → `200 {"user":{"id","email","displayName","role"},"workspace":{"id","name"}}`.

**Rooms.** A room is `{"id","name","starter","widthMm","depthMm","heightMm","version","revision","stats":{"solved","total","longestRun","props"},"thumbnailUrl"}`. `thumbnailUrl` is null when the room has no stored thumbnail. `revision` is the room's change counter from Business rules.

- `GET /api/rooms` → `200 {"rooms":[room…]}`, sorted by name case-insensitively.
- `POST /api/rooms` `{"name","widthMm","depthMm","heightMm"}` → `201 {"room"}`.
  - The name is 1 to 60 characters and unique in the workspace, compared case-insensitively. A duplicate answers `409 {"error":"name_taken"}`.
  - Width and depth are 1,000 to 30,000 mm inclusive, and height is 2,000 to 6,000 mm inclusive.
- `GET /api/rooms/:roomId` → `200 {"room","placements":[…],"nodes":[…],"sceneOrder":[placementId…],"activeSession":session|null,"latestSessionId":id|null}`.
- `PATCH /api/rooms/:roomId` `{"version"}` plus any of `"name"`, `"widthMm"`, `"depthMm"`, `"heightMm"` → `200 {"room"}`. Shrinking a room so that a placement would fall outside it answers 422 on the changed dimension.
- `PUT /api/rooms/:roomId/thumbnail` with a PNG body of up to 500,000 bytes → `204`. A body that is not a PNG answers 422 on `file`.
- `GET /api/rooms/:roomId/thumbnail` → `200 image/png`, or `404` when the room has no thumbnail.

**Placements.** A placement is `{"id","kind":"door|box|cylinder|prop","label","propId","entry","xMm","yMm","zMm","rotationDeg","widthMm","depthMm","heightMm","version"}`. Coordinates are measured from the room's front-left floor corner: x along the width, z along the depth and y up.

- `POST /api/rooms/:roomId/placements` → `201 {"placement"}` with `version` 1.
  - `label` is 1 to 60 characters.
  - `xMm` is 0 to the width, `zMm` 0 to the depth and `yMm` 0 to the height, all inclusive.
  - Each size is at least 10 mm and no larger than the room's matching dimension.
  - `rotationDeg` is an integer from 0 to 359, and every length is an integer.
  - `propId` is required for `prop` and must be a stored prop of the workspace, or the request answers 422 `{"propId":"unknown prop"}`. When `propId` is set, sizes default to the prop's dimensions.
  - `entry` is allowed only on doors. Setting it clears it on the room's other doors.
- `PATCH /api/rooms/:roomId/placements/:placementId` `{"version", fields…}` → `200 {"placement"}`, with `version` incremented.
- `DELETE /api/rooms/:roomId/placements/:placementId` → `204`. Nodes linked to the placement are unlinked.

**Trigger nodes.** A node is `{"id","title","kind":"puzzle|lock|cue|exit","placementId","answer","prerequisites":[nodeId…],"version"}`. Lists of nodes are always in chain order.

- `POST /api/rooms/:roomId/nodes` → `201 {"node"}`.
  - The title is 1 to 60 characters.
  - `answer` is 1 to 40 characters, or null, and is allowed only on `puzzle` and `exit` nodes.
  - `placementId` is a placement of the same room, or null.
- `PATCH /api/rooms/:roomId/nodes/:nodeId` `{"version", fields…}` → `200 {"node"}`.
- `DELETE /api/rooms/:roomId/nodes/:nodeId` → `204`. The node is also removed from every other node's prerequisites.

**Locks.**

- `POST /api/rooms/:roomId/locks` `{"targetType":"placement|node","targetId"}`, with an optional `"takeOver":true` → `200 {"lock":{"targetType","targetId","holder":{"userId","displayName"},"expiresInSeconds"}}`. When the holder calls again, the lock is refreshed. Take-overs are described in Business rules.
- `DELETE /api/rooms/:roomId/locks/:targetType/:targetId` → `204`. Only the holder may release a lock. Anyone else gets the lock conflict from Business rules.

**Live events** (`text/event-stream`).

`GET /api/rooms/:roomId/events` streams these events, each with JSON data:

| Event | Data |
|---|---|
| `presence` | `{"members":[{"userId","displayName"}]}` |
| `placement` | `{"placement"}` or `{"deletedId"}` |
| `node` | `{"node"}` or `{"deletedId"}` |
| `room` | `{"room"}` |
| `lock` | `{"lock"}`, plus `"takenFrom":{"userId","displayName"}` after a take-over, or `{"released":{"targetType","targetId"}}` |
| `version` | `{"version":<version>}`, the full version object. Sent once for each version whose `state`, `supersededBy` or `packUrl` changed: a freeze sends one for the new version and one for the version it superseded; a link regenerate or revoke sends one for that version. |
| `session` | `{"session":<session>}`, the full session object, after every state change, solve and hint of one of the room's sessions |
| `solve` | `{"sessionId","nodeId","title","elapsedSeconds","solvedBy","stats"}`, one per logged solve, including each lock or cue that fires on its own. `solvedBy` is the solver's display name, or null for a node that fired on its own (the same value as in the session's `solves`). `stats` is the room's chain figures after that solve. |
| `hint` | `{"sessionId","text","sentAt","hintsUsed","hintCooldownSeconds"}` |
| `tester` | `{"sessionId","displayName","xMm","zMm","headingDeg"}` |
| `live` | `{"available":true|false}` |
| `restore` | `{"room","placements","nodes","sceneOrder","revision"}`, the room as restored, once per restore |

`GET /api/play/:token/events` streams events for that session only: `solve`, `hint`, `tester` and `live` with the same data, and `session` as `{"session":<session>}`, where `<session>` is the `session` object of `GET /api/play/:token`.

**Props.** A prop is `{"id","name","widthMm","depthMm","heightMm","contentType","bytes","sha256","fileUrl"}`.

- `POST /api/props` (multipart/form-data with the fields `file`, `name`, `widthMm`, `depthMm`, `heightMm`) → `201 {"prop"}`.
  - The file must be either a binary glTF 2.0 (`.glb`, starting with the bytes `glTF` and version 2), stored as `model/gltf-binary`, or a self-contained JSON glTF (`.gltf`, with `asset.version` `"2.0"`), stored as `model/gltf+json`. Anything else answers 422 `{"file":"not a glTF 2.0 file"}`.
  - A file larger than 5,000,000 bytes answers `413 {"error":"too_large"}`. A file of exactly 5,000,000 bytes is allowed.
  - The name is 1 to 60 characters, and each size is 10 to 30,000 mm.
- `GET /api/props` → `200 {"props":[…]}`, newest first.
- `GET /api/props/:propId/file` → `200`, the stored bytes, with the download headers below.
- `DELETE /api/props/:propId` → `204`. A prop still placed in any room answers `409 {"error":"prop_in_use"}`.

**Download headers.** These apply to `GET /api/props/:propId/file` and `GET /api/pack/:token/props/:propId`:

- `ETag: "<sha256>"`: the lower-case hex SHA-256 of the served bytes, in double quotes.
- `Content-Type`: the stored content type. `Content-Length`: the stored `bytes`.
- `Content-Disposition: attachment; filename="<ascii name>.<ext>"; filename*=UTF-8''<encoded name>.<ext>`, where:
  - `<ext>` is `glb` for `model/gltf-binary` and `gltf` for `model/gltf+json`;
  - `<ascii name>` is the prop name with every code point outside printable ASCII (space through tilde), and every `"` and `\`, replaced by `_`;
  - `<encoded name>` is the prop name in UTF-8 with every byte percent-encoded as upper-case `%XX`, except letters, digits and ``!#$&+-.^_`|~``, which stay as they are.

  For example, the prop `Coffre à secrets` stored as .glb gives `attachment; filename="Coffre _ secrets.glb"; filename*=UTF-8''Coffre%20%C3%A0%20secrets.glb`.
- A request with `If-None-Match` equal to the current ETag answers `304` with the same ETag and an empty body.

**Versions.** Only the owner may freeze and change links. Every member may list. A version is `{"id","roomId","number","label","state":"frozen|superseded","supersededBy","frozenAt","stats","packUrl"}`:

- `supersededBy` is the number of the version that superseded it, or null.
- `stats` is the room's chain figures at the moment of the freeze.
- `packUrl` is the absolute build-pack page URL `<public origin>/pack/<token>` (public origin as defined for mail in Services), or null after a revoke.

Endpoints:

- `POST /api/rooms/:roomId/versions` `{"label"}`, with an optional `Idempotency-Key` header of 1 to 64 characters → `201 {"version"}`. The label is 1 to 80 characters.
- `GET /api/rooms/:roomId/versions` → `200 {"versions":[…]}`, newest first.
- `POST /api/versions/:versionId/link` → `201 {"packUrl"}`. Makes a new link and kills any previous one.
- `DELETE /api/versions/:versionId/link` → `204`.

**Build pack** (capability token, no account).

`GET /api/pack/:token` → `200`:

```json
{"version":{"number","label","state","frozenAt","supersededBy"},
 "room":{"name","width","depth","height"},
 "placements":[{"id","kind","label","propId","entry","x","y","z","width","depth","height","rotationDeg"}],
 "nodes":[{"title","kind","needs":[title…],"linkedPlacement","answer"}],
 "props":[{"id","name","bytes","sha256","downloadPath"}],
 "stats":{"solved","total","longestRun","props"}}
```

- Every length (`room.width`, `room.depth`, `room.height`, and each placement's `x`, `y`, `z`, `width`, `depth` and `height`) is an object `{"mm","m","ft"}`, as defined in Business rules. `rotationDeg` is an integer.
- Placements are in creation order and nodes in chain order, both as frozen.
- `needs` lists the prerequisite titles. `linkedPlacement` is the linked placement's label, or null. `answer` is the node's answer, or null.
- `downloadPath` is `/api/pack/<token>/props/<propId>`.
- `stats` is the version's `stats`.

Other build-pack endpoints:

- `GET /api/pack/:token/props/:propId` → `200`, the version's own copy of the file, with the download headers.
- `GET /api/pack/:token/snapshot` → `200 application/json`, the stored snapshot bytes.
- Any other method under `/api/pack/` answers `405 {"error":"read_only"}`.

**Playtests.** A session is:

```json
{"id","roomId","roomName","kind":"remote|walk_in","state","hostUserId",
 "startsAt","startedAt","endedAt","outcome":null|"escaped"|"timed_out"|"stopped",
 "durationSeconds","remainingSeconds","hintCooldownSeconds","hintsUsed","serverTime",
 "solves":[{"nodeId","title","elapsedSeconds","solvedBy"}],
 "stats",
 "testers":[{"inviteId","email","displayName","joined","emailStatus":"sent|queued|failed"}]}
```

| Endpoint | Request | Success |
|---|---|---|
| `POST /api/playtests` (owner only) | `{"roomId","startsAt"}`. `startsAt` is an ISO 8601 date-time with `Z` or an offset. It must fall between 5 minutes before the server's current time and 30 days after it, both ends allowed. An unparseable value answers 422 `{"startsAt":"not a valid time"}`. A time outside that window answers 422 `{"startsAt":"must be between 5 minutes ago and 30 days ahead"}`. | `201 {"session"}` in `scheduled` |
| `POST /api/rooms/:roomId/walk-in` (any member, who becomes the host) | none | `201 {"session"}`, already `running` |
| `POST /api/playtests/:id/open`, `/start`, `/end`, `/cancel` | none | `200 {"session"}` |
| `GET /api/playtests/:id` | | `200 {"session"}` |
| `GET /api/rooms/:roomId/playtests` | | `200 {"sessions":[…]}`, newest first |
| `POST /api/playtests/:id/invites` | `{"email"}` | `201 {"invite":{"id","email","emailStatus","joinUrl"}}` |
| `DELETE /api/playtests/:id/invites/:inviteId` | | `204` |
| `POST /api/playtests/:id/invites/:inviteId/resend` | | `202 {"invite"}` |
| `POST /api/playtests/:id/hints` | `{"text"}`, 1 to 280 characters | `201 {"hint":{"text","sentAt"},"hintCooldownSeconds"}` |
| `POST /api/playtests/:id/solves` (session control as defined in Business rules, used during a walk-in) | `{"nodeId","answer"}` | `200 {"session","alreadySolved"}` |
| `GET /api/playtests/:id/debrief` | | `200 {"outcome","elapsedSeconds","stats","puzzles":[{"title","solvedAtSeconds","waitSeconds"}],"hintsUsed","chokePoint":{"title","waitSeconds"}|null,"emailStatus"}` |

**Tester** (capability token, no account).

- `GET /api/play/:token` → `200 {"session":{"state","startsAt","remainingSeconds","hintCooldownSeconds","durationSeconds","serverTime","outcome"},"room":{"name","widthMm","depthMm","heightMm","placements":[…]},"nodes":[{"id","title","kind","prerequisites","placementId","needsAnswer","solved","available"}],"testers":[{"displayName","joined"}],"me":{"displayName","joined"},"hints":[…]}`. It never includes answers or emails.
- `POST /api/play/:token/join` `{"displayName"}` (1 to 40 characters, trimmed; otherwise 422 on `displayName`) → `200`, with the same body as the GET. The states in which joining is accepted are in Business rules, under Joining.
- `POST /api/play/:token/solves` `{"nodeId","answer"}` → `200 {"nodes","session","alreadySolved"}`.
- `POST /api/play/:token/position` `{"xMm","zMm","headingDeg"}` → `204`.

**Health.** `GET /api/health` → `200 {"status":"ok","instance":"<INSTANCE_NAME>","services":{"postgres":"up|down","valkey":"up|down","minio":"up|down","mail":"up|down"}}`.

**Changes, scene order, undo and restore.**

- Placement `PATCH`, placement `DELETE` and scene moves accept an optional `Op-Id` request header: 8 to 64 characters, each a letter, a digit, `-` or `_`. Any other value answers 422 on `opId`. Replays are described in Business rules.
- `GET /api/rooms/:roomId/changes?since=<revision>` → `200 {"revision":<current revision>,"changes":[{"revision","opId","kind","placementId","userId"}…]}`, every change with a revision above `since` (0 when it is missing), oldest first. `opId` is null for a change sent without an `Op-Id`. `kind` is `create`, `update`, `delete`, `move`, `undo` or `restore`. `placementId` is null for a node, room or restore change.
- `POST /api/rooms/:roomId/placements/:placementId/scene-move` `{"direction":"up|down"}` → `200 {"sceneOrder":[placementId…],"revision"}`. `up` on the first placement answers 422 `{"direction":"already first"}`, and `down` on the last answers 422 `{"direction":"already last"}`.
- `POST /api/rooms/:roomId/undo` (no body) → `200 {"undone":{"placementId","label","field"},"placement","revision"}`.
- `POST /api/rooms/:roomId/restore` `{"versionId"}` (owner only) → `200 {"room","placements","nodes","sceneOrder","revision"}`. A `versionId` that is not a version of this room answers 422 `{"versionId":"unknown version"}`.

### Business rules (DP-03, DP-15, DP-17, DP-18, DP-19, DP-20, DP-21, DP-22, DP-25, DP-28, DP-29, DP-32, DP-33, DP-34, DP-36, DP-39, DP-40, DP-41, DP-42, DP-43, DP-44, DP-46, DP-47, DP-49, DP-50, DP-51, DP-52, DP-55)

**Roles.**

- The workspace `owner` may do everything.
- A `co_designer` may create and edit rooms, placements, nodes and props, take locks, walk in, and list versions and playtests.
- Scheduling playtests, freezing versions and changing build-pack links are owner only.
- Controlling a session (open, start, end, cancel, invites, hints and host solves) is allowed to the workspace owner and to that session's host.

**Lengths and units.**

- Every length is stored as a whole number of millimetres and is never stored converted.
- **Metres** are mm ÷ 1000 with exactly three decimals, for example `2.400`.
- **Feet and inches** are worked out in whole sixteenths of an inch, with integer arithmetic only:
  1. Sixteenths `s` = floor((mm × 160 + 127) ÷ 254). This is mm × 80 ÷ 127, rounded to the nearest sixteenth, with halves rounded up.
  2. Feet = floor(s ÷ 192). The rest is `r` = s mod 192.
  3. Whole inches = floor(r ÷ 16). The fraction is (r mod 16)/16, reduced to lowest terms (for example 8/16 shows as 1/2, 2/16 as 1/8 and 14/16 as 7/8).
  4. The format is `<feet>' <inches>"`, with a straight apostrophe and a straight double quote. `<inches>` is the whole number alone when the fraction is zero, else the whole number, one space and the fraction. The whole number of inches is always printed, even when it is 0.

  Because the rule works in sixteenths, a figure of 16/16 or of 12 inches never appears.
- Published examples:

  | mm | feet and inches |
  |---|---|
  | 10 | `0' 0 3/8"` |
  | 304 | `0' 11 15/16"` |
  | 305 | `1' 0"` |
  | 2,400 | `7' 10 1/2"` |
  | 3,000 | `9' 10 1/8"` |
  | 3,658 | `12' 0"` |
  | 4,000 | `13' 1 1/2"` |
  | 5,000 | `16' 4 7/8"` |

- The pack JSON carries each length as, for example, `{"mm":2400,"m":"2.400","ft":"7' 10 1/2\""}`.
- The editor Inspector and the build-pack page show exactly these strings, so a placement reads identically on both in either unit.
- The editor accepts metre input with up to three decimals and sends whole millimetres.
- The editor's Units button switches every length the editor shows.
- **Build-pack units.** The build-pack page's units live in its `units` query value: `m` or `ft`. A missing or unknown value means metres, and the page rewrites the address to `?units=m`. Pressing Units replaces the address in place rather than adding a history entry.

**Versions and lost moves.** Every room, placement and node carries a `version`. A PATCH whose `version` is not the current one answers `412 {"error":"stale_version","current":<record>}` and changes nothing.

**Locks: one holder.**

- When several members try to take the lock on a placement or node at once, across both app instances, exactly one succeeds.
- Every other member gets `409 {"error":"locked","holder":{"userId","displayName"},"expiresInSeconds"}`.
- A PATCH or DELETE of a placement or node that another member holds answers that same 409. A record nobody holds may be edited by any member.
- A lock lapses `LOCK_TTL_SECONDS` after the holder's last take or refresh.
- Locks and presence need Valkey. While it is unreachable, lock requests answer `503 {"error":"live_unavailable"}`, and edits are checked only by version, so solo editing continues.

**Edits during playtests.** While any session of a room is `running`, every change to that room, its placements or its nodes answers `409 {"error":"playtest_running"}`.

**Trigger graph.**

- **Kinds:**
  - `puzzle` is solved by a player.
  - `lock` (a maglock or latch release) fires on its own.
  - `cue` (a light, sound or reveal) fires on its own.
  - `exit` is solved by a player and ends the session.
- **Prerequisites** must be nodes of the same room and never the node itself; otherwise the request answers 422 on `prerequisites`. A change that would make a loop answers 422 `{"prerequisites":"would create a loop"}`.
- **Exits.** A second exit answers 422 `{"kind":"room already has an exit"}`.
- **Chain order.** Repeatedly take the earliest-created node whose prerequisites have all been taken already, until every node is taken. This one order drives the node cards, N and Shift+N stepping, the Cue timeline and choke-point ties.

  For example, if the seed Vault is edited so that Safe dial has no prerequisites, its chain order stays Ledger cipher, Drawer sensor, Maglock 3, Blacklight cue, Safe dial, Vault door. Safe dial is ready from the first step, but at every step until Blacklight cue is taken, an earlier-created node is ready too. Grouping nodes by depth would wrongly put Safe dial second. After that edit the Vault's longest run is 4 (Ledger cipher through Blacklight cue).

**Chain figures.** These are computed in one place on the server, and every surface shows them as served:

- `total` is the room's node count.
- `props` is the number of the room's placements that are not doors.
- `longestRun` is the number of nodes in the longest path that uses only links where the earlier node has exactly one dependant and the later node has exactly one prerequisite. It is 1 for a lone node and 0 for an empty graph.
- `solved` is the number of the room's current nodes solved in its latest session that reached `running`, or 0 when there is none.

The stage, the room cards and the Debrief dialog refresh within one second of any edit or solve.

**Playtest lifecycle.**

- **Legal moves:**
  - `scheduled` → `lobby` (open);
  - `lobby` → `running` (start);
  - `running` → `ended` (end, the deadline, or solving the exit);
  - `scheduled` or `lobby` → `cancelled`.

  A walk-in is created already `running`.
- **Illegal moves.** Every other move answers `409 {"error":"invalid_transition","state":"<current state>"}`.
- **One active session per room.** A room has at most one session in `lobby` or `running`. Opening, starting or walking in while another exists answers `409 {"error":"room_busy"}`. Of simultaneous attempts, exactly one succeeds.
- **Valkey.** Opening, starting, walking in, solving and hinting need Valkey and answer `503 {"error":"live_unavailable"}` without it. Scheduling, ending, cancelling and invites do not need it.

**Server-owned time.** The device clock may be wrong, so the browser never works out time from its own date.

- `durationSeconds` is `PLAYTEST_DURATION_SECONDS`.
- `remainingSeconds` is the duration minus the whole seconds elapsed since `startedAt`, never below 0. Before the start it is the full duration. After the end it stays at its value at the end.
- At the deadline the server ends the session with outcome `timed_out`. Any read at or after the deadline already shows `ended`.
- `hintCooldownSeconds` is `HINT_COOLDOWN_SECONDS` minus the seconds since the last hint, never below 0.
- Pages count down from the served figures using the time elapsed since the response. They resync on every event and at least every 15 seconds. Every viewer's clock stays within 2 seconds of the served value, including a late joiner or a reloaded page.

**Solving.**

- **Who and when.** Solving needs `running`; otherwise `409 {"error":"session_not_running"}`. A tester must have joined; otherwise `409 {"error":"not_joined"}`.
- **Rejected solves:**
  - unsolved prerequisites: `409 {"error":"prerequisites_unsolved"}`;
  - a `lock` or `cue` node: 422 `{"nodeId":"fires on its own"}`;
  - a wrong answer (compared trimmed and case-insensitively): 422 `{"answer":"incorrect"}`.
- **Repeats.** An already-solved node answers 200 with `alreadySolved: true` and logs nothing. Of simultaneous solves of one node, exactly one is logged.
- **Firing on their own.** After any solve, and at the session start, every `lock` and `cue` node whose prerequisites are all solved is solved at the same moment with `solvedBy` null. This repeats until no more nodes qualify.
- **Ending.** Solving the `exit` ends the session with outcome `escaped`. Ending by the host, Stop or `/end` gives outcome `stopped`.
- **Broadcast.** Every solve reaches all viewers within one second.

**Hints.**

- Hints need `running`; otherwise the 409 for a session that is not running applies.
- A hint inside the cooldown answers `429 {"error":"hint_cooldown","retryAfterSeconds":<seconds left>}`.
- A sent hint increments `hintsUsed` and reaches every tester within one second.

**Invites.**

- Inviting needs `scheduled`, `lobby` or `running`; otherwise `409 {"error":"session_closed"}`.
- A session has at most 6 unrevoked invites. The seventh answers `409 {"error":"roster_full"}`.
- An email that is already invited and unrevoked answers 422 `{"email":"already invited"}`.
- Each invite has its own random token of at least 32 URL-safe characters.

**Joining.**

- `POST /api/play/:token/join` answers 200 while the session is `scheduled`, `lobby` or `running`. Joining while `running` is a late join, and the tester may solve at once.
- In `ended` or `cancelled` it answers `410 {"error":"invite_expired"}`. A revoked token answers 404, as for every capability link.
- Joining again with the same token answers 200, keeps `joined` true, and replaces the tester's display name with the new one. Solves already logged keep the name they were logged with.
- Joining does not need Valkey.

**Capability links.**

- An invite token reaches only its own session's tester endpoints, and a build-pack token reaches only its own version.
- Neither token works on any other endpoint (those answer 401), and neither reveals other rooms, versions, members or emails.
- A revoked invite, or a regenerated or revoked build-pack link, answers 404 on its next request, including a conditional download.
- An invite whose session is `ended` or `cancelled` answers `410 {"error":"invite_expired"}`.
- A build-pack link accepts no write.

**Debrief.**

- The debrief is ready once the session is `ended`. Before that it answers `409 {"error":"session_not_ended"}`.
- `elapsedSeconds` runs from the start to the end.
- Each puzzle or exit node is listed with two figures:
  - `solvedAtSeconds`: seconds from the start, or null if unsolved;
  - `waitSeconds`: the time from the moment the node became available (the start, or its last prerequisite's solve) to its own solve, or null if unsolved.
- The choke point is the solved puzzle or exit node with the largest wait. Ties go to the earlier node in chain order. It is null when nothing was solved.

**Props stored as uploaded.**

- A prop exists, appears in `GET /api/props` and can be placed only after the object store has confirmed its file.
- If the store refuses the file or is unreachable, the upload answers `503 {"error":"storage_unavailable"}`, and no prop record or object is left behind.
- The stored object and every download are exactly the uploaded bytes, and `bytes` and `sha256` describe exactly those bytes.

**Freeze, all or nothing.** A freeze writes all of these together:

- the version record and its placement and node copies;
- the snapshot object (the build-pack JSON);
- a byte-for-byte copy of every prop file placed in the room;
- the build-pack link.

The same freeze moves the room's previous `frozen` version to `superseded`. If any write fails, everything already written is removed and the request answers `503 {"error":"storage_unavailable"}`. Nothing from that attempt appears in any list, link or object, and the version stays as it was.

A freeze needs Postgres and MinIO only. While Valkey is unreachable a freeze still succeeds with 201. Its `version` events are then not delivered, and an open Versions sheet shows the change the next time it is opened.

**Version numbering and states.**

- Versions of a room are numbered 1, 2, 3 in turn, each number used exactly once, with no gaps or repeats. This holds when several freezes without an `Idempotency-Key` arrive at once on either app instance, and when a freeze fails (the next successful freeze takes the number the failed one would have had).
- Simultaneous freezes of one room all answer 201, each with its own number. None answers 409 or 503 because of the others.
- After any set of freezes, exactly one version of the room is `frozen`, the one with the highest number. Every other version is `superseded`.
- Each superseded version's `supersededBy` is the next number up (n + 1), not the latest number.
- A frozen version's content never changes. Superseded versions stay readable through their link, with `supersededBy`.
- Deleting placements or props later never changes a version's files.

**Freeze idempotency.**

- A freeze with an `Idempotency-Key` already used in the workspace, with the same room and body, returns the stored first response (the same status and body), and no new version is made. This holds for simultaneous repeats too.
- The same key with a different room or body answers `409 {"error":"idempotency_key_reused"}`.
- A failed freeze stores no key, so a retry with the same key performs the freeze.

**Live Versions sheet.** Every freeze, supersede, link regenerate and link revoke sends its `version` events. While Valkey is up, they reach every open stream of the room on either instance within one second.

**Room revisions and the change log.**

- Every room has a `revision`, 0 when it is created or seeded. Every accepted change to the room, its placements or its nodes (create, update, delete, scene move, undo or restore) adds exactly 1 to it and appends one change log entry carrying the new revision. A refused request, a lock, a thumbnail upload and a freeze change neither.
- **Replays.** A request whose `Op-Id` is already in the room's change log answers the stored response of the change that used it (the same status and body) and changes nothing. This is the idempotent replay step of the precedence order. Change ids are unique across the workspace: the server looks an `Op-Id` up in all of the workspace's change logs, right after the 404 and 403 checks, and the same `Op-Id` sent to a different room, placement or endpoint answers `409 {"error":"op_id_reused"}`, whatever the body. A refused request stores nothing, so a retry with its `Op-Id` is checked afresh.
- **Deleted placements.** A placement that existed in the room and was deleted is not an unknown resource. A `PATCH`, `DELETE` or scene move on it answers `410 {"error":"placement_deleted","label":"<its label>","deletedBy":{"userId","displayName"}}`, a state conflict. An id the room never had answers 404. Anything else that names a deleted placement, such as a lock request or a node's `placementId`, treats it as an id the room never had.

**Scene order.** Each room keeps its placements in a scene order. A new placement goes last, a deleted one leaves the order, and a scene move swaps the placement with its neighbour above (`up`) or below (`down`). A freeze records the scene order with the version. Scene order is separate from creation order, which `]`, `[` and the build pack keep using.

**Lock takeover.** A member who may edit a placement or node may take its lock with `"takeOver":true`, whoever holds it. The lock then belongs to the taker with a fresh lock TTL, and the `lock` event carries `takenFrom`, the former holder. The former holder's next refresh, `PATCH` or `DELETE` gets the 409 locked naming the taker. A take-over of a lock nobody holds is an ordinary take. Take-overs need Valkey, like every lock.

**Per-author undo.**

- The server keeps, for each member and room, the placement updates (`PATCH`es) that member made, oldest first. Creates, deletes, scene moves, undos and restores are not undoable.
- `POST /api/rooms/:roomId/undo` takes the member's newest entry, sets the fields that update changed back to the values they had just before it, as one new change of kind `undo`, and removes the entry. Changes by other members, even to the same placement, are never undone, and fields the entry did not change keep their current values.
- `<field>` in the undo copy names what the entry changed: `position` for `xMm`, `yMm` or `zMm`, `rotation` for `rotationDeg`, `size` for `widthMm`, `depthMm` or `heightMm`, and `label` for `label`. An entry that changed several takes the first of these words in that order.
- With no entry the request answers `409 {"error":"nothing_to_undo"}`. When the entry's placement has been deleted, it answers `409 {"error":"undo_conflict","label":"<its label>","deletedBy":{"userId","displayName"}}` and removes that entry, so the next undo looks at the one before. When another member holds the placement, it answers the 409 locked and keeps the entry.
- A restore clears every member's undo entries for the room.

**Restore.**

- Only the owner may restore. A restore replaces the room's width, depth and height, its placements, its nodes and its scene order with those of the version as frozen, as one change of kind `restore`. The room keeps its name.
- Placements and nodes keep the ids they had when frozen. One that exists now is overwritten, one deleted since is put back, and one added since is deleted. Each overwritten or put-back record's `version` is 1 more than its last value, and the room's `version` goes up by 1.
- A version whose placements use a prop that is no longer in the library answers `409 {"error":"prop_missing"}` and changes nothing.
- A restore needs Postgres only. While Valkey is unreachable it still answers 200, and its `restore` event is not delivered.
- While Valkey is up, every open stream of the room on either instance receives the one `restore` event within one second.
- A restore makes no new version, and no version changes.

### Services (DP-07, DP-19, DP-20, DP-25, DP-27, DP-30, DP-37, DP-39, DP-41, DP-43, DP-46)

**Postgres** (`DATABASE_URL`).

- It holds every account, workspace, membership, room, placement, node, prop record, version, playtest session, solve, hint, invite, link token, idempotency record, change log entry and undo entry.
- Schema and seed data are applied idempotently every time the app serves. Applying them is safe when several instances start at once on the same database.
- Postgres down: every API except health answers `503 {"error":"database_unavailable"}`.

**MinIO** (the `S3_*` variables; the bucket is `S3_BUCKET`, created if missing). Object keys:

| Key | Contents |
|---|---|
| `props/<propId>.glb` or `props/<propId>.gltf` | the uploaded prop bytes, with the prop's content type |
| `thumbnails/<roomId>.png` | the room thumbnail |
| `versions/<versionId>/snapshot.json` | the frozen snapshot |
| `versions/<versionId>/props/<propId>.<glb or gltf>` | the version's own copy of each placed prop file |

- The editor renders a room's thumbnail in the browser. It uploads the thumbnail when the room has none stored, and again 2 seconds after edits stop.
- Deleting a prop deletes its `props/` object only.

MinIO down:

- uploads, thumbnail saves and freezes answer `503 {"error":"storage_unavailable"}`, and prop file reads answer the same 503;
- the storage banner shows, and cards fall back to rendering thumbnails live;
- placement and node editing continues.

**Valkey** (`VALKEY_URL`).

| Key or channel | Holds | Lifetime |
|---|---|---|
| `lock:<roomId>:<placement|node>:<targetId>` | the holder's user id | expires after `LOCK_TTL_SECONDS` |
| `presence:<roomId>:<userId>` | the display name | refreshed every 10 seconds while the editor is open; expires after 30 seconds |
| channel `room:<roomId>` | room events, including `version` | |
| channel `playtest:<sessionId>` | session events | |

Publishing on these channels lets streams on both app instances deliver every event.

Valkey down:

- live actions answer the 503;
- the live banner shows;
- presence shows only yourself;
- the pill status word is `Paused`.

Freezing continues, as stated in Business rules.

**Mail** (`SMTP_HOST`, `SMTP_PORT`, and `MAIL_FROM`, the From line of every message: `Keyway Bench <playtests@keyway.test>`).

- **Invite.** One message per invite, sent to the tester, with the subject `Playtest invite: <room name>`. The body holds the line `Starts <YYYY-MM-DD HH:MM> UTC` and the join link `<public origin>/play/<token>`. The public origin is `APP_PUBLIC_URL` when it is set, else `http://localhost:<port>`.
- **Debrief.** Within 10 seconds of a session ending, one message per recipient, with the subject `Playtest debrief: <room name>`. The recipients are every unrevoked invite's email, the host and the workspace owner, without duplicates. The body holds:
  - the outcome line;
  - the three figure strings;
  - one line per puzzle, as `<title> — <mm:ss>` or `<title> — not solved`;
  - `Hints used: <n>`;
  - `Choke point: <title> (<m:ss> waiting)` or `Choke point: none`.
- **Delivery states.**
  - A message is `sent` only after the mail server accepts it.
  - On a failure the message is `queued` and retried every 10 seconds. After 3 failed attempts in total it is `failed`. Resend starts a fresh cycle.
  - Invites are still created (201) while mail is down, with `emailStatus` `queued`.

### Seed data (DP-02, DP-03, DP-12, DP-22, DP-33, DP-44)

Every person, venue and business below is invented.

**Workspace "Lantern Lane Escapes".**

| Person | Email | Password | Role |
|---|---|---|---|
| Mara Quint | `mara@lanternlane.test` | `keyway-owner-1` | `owner` |
| Tobi Ferreira | `tobi@lanternlane.test` | `keyway-codesign-1` | `co_designer` |

**Workspace "Brass Key Rooms".**

| Person | Email | Password | Role |
|---|---|---|---|
| Ines Albright | `ines@brasskey.test` | `keyway-other-1` | `owner` |

Its only room is "Clocktower Draft": 3,000 × 3,000 × 2,400 mm, with one entry door labelled `Entry door` and one puzzle node, `Pendulum`.

No props, versions or playtests exist at start, and the prop library is empty.

**Lantern Lane rooms.**

- Starter rooms are marked `starter: true`. Every new workspace made by sign-up gets the same five starter rooms.
- Dimensions are width × depth × height in mm.
- Placement positions and sizes are the builder's choice, inside the room.
- The first door listed in each room is its entry door.

| Room | Size | Placements | Nodes in creation order (needs) | Figures |
|---|---|---|---|---|
| Apothecary (starter) | 4,000 × 3,500 × 2,700 | door `Entry door`; box `Herb cabinet`; box `Mortar table`; cylinder `Scale plinth`; box `Poison shelf` | `Herb cabinet code` puzzle, answer `4172`, linked to Herb cabinet; `Scale balance` puzzle, linked to Scale plinth; `Cabinet maglock` lock (Herb cabinet code); `Blacklight label` cue (Cabinet maglock); `Antidote recipe` puzzle (Blacklight label, Scale balance); `Exit door` exit (Antidote recipe) | 0 of 6 solved · Longest run 3 · 4 props |
| Clockmaker's Study (draft) | 3,000 × 4,000 × 2,600 | door `Entry door`; box `Workbench` | `Gear train` puzzle | 0 of 1 solved · Longest run 1 · 1 prop |
| Observatory (starter) | 4,500 × 4,500 × 3,200 | door `Entry door`; cylinder `Telescope`; box `Star chart table` | `Star chart` puzzle; `Telescope focus` puzzle; `Dome maglock` lock (Star chart, Telescope focus); `Exit door` exit (Dome maglock) | 0 of 4 solved · Longest run 2 · 2 props |
| Ship's Hold (starter) | 5,000 × 4,000 × 2,500 | door `Entry hatch`; box `Cargo crate`; box `Sea chest`; cylinder `Mast`; box `Rope locker` | `Knot board` puzzle; `Crate manifest` puzzle, answer `BOSUN` (Knot board); `Chest padlock` lock (Crate manifest); `Lantern cue` cue (Chest padlock); `Hatch` exit (Lantern cue) | 0 of 5 solved · Longest run 5 · 4 props |
| Signal Cabin (starter) | 3,500 × 2,500 × 2,400 | door `Entry door`; box `Telegraph desk`; box `Lever frame` | `Morse key` puzzle; `Lever order` puzzle; `Lamp cue` cue (Morse key, Lever order); `Cabin door` exit (Lamp cue) | 0 of 4 solved · Longest run 2 · 2 props |
| Vault (starter) | 3,000 × 3,000 × 2,400 | door `Entry door`; box `Safe`; box `Desk`; cylinder `Keypad pillar` | `Ledger cipher` puzzle; `Drawer sensor` puzzle (Ledger cipher); `Maglock 3` lock (Drawer sensor); `Blacklight cue` cue (Maglock 3); `Safe dial` puzzle, answer `0815` (Blacklight cue); `Vault door` exit (Safe dial) | 0 of 6 solved · Longest run 6 · 3 props |

For example, with the seed data at start:

- the picker's first card in alphabetical order is Apothecary;
- the build pack of a Ship's Hold version shows the room width as `5.000` in metres and `16' 4 7/8"` in feet.

The public tour uses a built-in copy of the Vault that belongs to no workspace.

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22.

- `/app/run.json` holds the string commands `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` returns HTTP 200 JSON with `"status":"ok"`, as specified in API.
- Two or more instances may run at once against the same Postgres, MinIO and Valkey, and every behaviour above holds across them. That includes lock winners, freeze numbering and live Versions updates.

### Configuration and secrets (DP-06)

The app reads these environment variables at start. It never hard-codes their values and never sends them to the browser.

| Purpose | Variables |
|---|---|
| Postgres | `DATABASE_URL` |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Valkey | `VALKEY_URL` |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` (`MAILPIT_URL` may be present; the app does not need it) |
| Public address | `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` |
| Timings | `PLAYTEST_DURATION_SECONDS` (default 3600), `HINT_COOLDOWN_SECONDS` (default 120), `LOCK_TTL_SECONDS` (default 30) |
| Instance label | `INSTANCE_NAME` (default `a`) |

The secret that signs session cookies is generated on first start and kept in Postgres.

### Server boundary (DP-05, DP-07)

**Origin.**

- The app is same-origin only and sends no CORS allowance.
- A state-changing request whose `Origin` header names another origin answers `403 {"error":"cross_origin"}`.
- The browser loads nothing from third-party origins.

**Size limits** (the limit itself is allowed):

| Body | Limit |
|---|---|
| JSON | 100,000 bytes |
| Multipart upload request | 5,100,000 bytes |
| Prop file | 5,000,000 bytes |
| Thumbnail | 500,000 bytes |

A larger body answers `413 {"error":"too_large"}`.

**What the server serves.** Only the built frontend assets and the API. It never serves source files, the run manifest, environment files, lockfiles or any credential.

**Boot and recovery.**

- A dependency that is unreachable at boot, or drops later, never stops the app. It starts, answers health, and serves everything that does not need the missing service.
- It retries each missing service at least every 5 seconds. Within 10 seconds of the service returning, health reports it `up`, its banner clears, presence and locks resume and queued mail is sent. No restart is needed.

### Browser support and performance (DP-14, DP-15, DP-45)

- **Browsers and sizes:** current Chromium, Firefox and Safari, at 375x812, 768x1024 and 1280x800.
- **Load:** the stage and the room picker are usable within three seconds of load on a typical laptop. The build-pack page shows its tables within two seconds.
- **Live updates:** they reach other viewers within one second.
- **Frame rate:** the stage keeps a steady frame rate with the largest starter room open.

## Working rules

- IF-01: `/app/run.json` exists with the string commands `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font and icon set, each with its licence.
- IF-03: Shipped packages, fonts and icons use only the MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1 licences.
- IF-04: App data lives only in Postgres, MinIO and Valkey. There is no SQLite, no other database and no app data on the local filesystem.
- IF-05: Fonts (Inter, JetBrains Mono) and icons (Lucide) are self-hosted, and no CDN or third-party request is made at runtime.
- IF-06: The provided service configuration and its seeded credentials are left unchanged.
- IF-07: `package-lock.json` is committed, and `install` uses it.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` in domain code. It uses this brief's domain terms: room, placement, prop, trigger node, prerequisite, lock, playtest, invite, version, build pack and chain figures.
- Each domain rule is decided in exactly one place in the source, and the editor and the build-pack page use the same conversion code. The rules are:
  - the playtest state transitions;
  - the remaining-time and cooldown figures;
  - the chain figures;
  - the conversion from millimetres to metres and to feet, inches and sixteenths;
  - the lock winner;
  - version numbering and superseding;
  - the freeze's all-or-nothing write.
- No abstraction has only one implementation, and there are no wrappers that only pass calls through.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Every API error is built through one error shape, and the precedence order is applied in one place.
- No feature, endpoint, setting or screen goes beyond this brief.
- Service clients are created once from the environment. Each reports its availability from that one source to the health figures and the banners.
