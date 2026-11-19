# Fishplate Layout Works Gandyboard

Gandyboard is a browser-based 3D layout design and operating-session product for model railway clubs and serious hobbyists, run by a one-person design-and-build practice. The practice founder gets one client workspace per club. There, members co-design a layout checked against the club's standards, and operators rehearse a timetable with several trains on a server-owned clock, with real block occupancy, conflict and deadlock handling, crew packets and sessions that resume exactly where they stopped. It uses Postgres as the system of record, Valkey for live delivery between app instances and the tick lease, and Gotenberg for crew packet PDFs. Out of scope: public self-registration, email, payment, connection to physical layouts or DCC hardware, import from desktop track planners, sound, and any datastore beyond those three services.

## Problem and users

Clubs plan layouts in single-user desktop track planners and pass files around by email. They learn at set-up that a member's module breaks the agreed standard: a curve too tight, a grade too steep, track off-centre at an endplate. Operating plans live elsewhere, in paper train orders, switch lists and crew paperwork, or in control software tied to the physical layout, so a club cannot rehearse a timetable before the hall is booked. Single-line meets go wrong and two trains end up nose to nose. When an evening session stops halfway, operators rebuild train positions from memory. The one-person practice absorbs the cost in unpaid hours reconciling versions, re-checking geometry and redoing crew packets by hand.

- **Practice founder** (daily): runs every club as a client workspace, designs and validates layouts, publishes versions and steps into any live session to rescue it.
- **Club layout manager** (weekly): keeps the club's layout, standards profile, timetable and version history correct while members edit at once.
- **Hobbyist member** (weekly): designs and edits modules in 3D with other members and sees the validation result before anything reaches the shared layout.
- **Session operator** (weekly): schedules and dispatches several trains, reads track occupancy, resolves routing conflicts and deadlocks, and resumes interrupted sessions.

## Journeys

1. **New client.** The practice founder starts signed in with two clubs. They create a third workspace from the reference template, add a club layout manager, a hobbyist member and a session operator, then open two clubs in two tabs. Each tab shows only its own club, with ticks streaming in both.
2. **Building a module together.** A hobbyist member opens the working copy in Build mode, adds a module, selects its open end and presses track tiles. Pieces slide in on the server's answer. A curve that is too tight is refused with the measured value and limit, and nothing reaches the shared layout. A second member on another app instance sees each accepted piece appear live. If both extend the same open end, one wins and the other sees who took it.
3. **Publishing and correcting a layout.** A club layout manager checks the working copy, saves a version, validates it and publishes it. They rename a block and see the new name in an open session, the timetable and the next packet preview, while the earlier version and the issued PDF keep the old one. They restore version 12 and get a new Draft with the same canonical hash. They also trash a module, undo it, trash it again and purge it.
4. **Rehearsing a meet.** A session operator opens a session pinned to a Published version and starts it. They select Train 101, choose a destination, read the preview and press Highball. The blue ribbon extends block by block, the train runs on committed ticks, and blocks come back from the tail. Train 202 takes the loop at Fernhill and the two trains pass.
5. **Rescuing a deadlock.** Two operators each ask for the road over the other's train on the single line. Both are refused with a Conflict sheet naming the other train, and on the next committed tick the server raises a deadlock naming both. The practice founder steps in and presses Back to loop on one train. The deadlock clears, and the other train gets the road.
6. **Resuming an interrupted evening.** A Running session stops because every app instance has gone away. When the app returns the session reads Interrupted at its last committed tick. An operator presses Resume, and the session continues at the next tick with positions, authorities, timetable progress and fast clock unchanged.
7. **Crew paperwork.** An operator issues a crew packet, watches it go from Queued through Rendering to Ready, and downloads a PDF that prints the session version and content hash on each page. An extra train is added. The session version rises, and the packet reads Superseded with its PDF unchanged.
8. **Service outage.** The practice founder starts the app with Valkey or Gotenberg unreachable. The app opens, Running sessions read Held, or packets read Failed, with published copy. When the service returns, both recover with no app restart.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-in and roles.** Seeded and added people sign in with email and password, and each of the four roles can do exactly what the role table in Business rules allows.
- **DP-02 — Client workspaces and members.** The practice founder creates a client workspace from a template, and the founder or a club layout manager adds members, so each club's layouts, sessions and packets live in one workspace.
- **DP-03 — Answers scoped to the request.** Interleaved requests, event streams and packet downloads from two workspaces and two users always answer for that request's own workspace and user.
- **DP-04 — Two clubs in two tabs.** The practice founder works two clubs in two browser tabs while ticks stream for both, and each tab shows only its own club's session, counters and packets.
- **DP-05 — Track tile rail.** In Build mode a hobbyist member presses a tile on the track piece tile rail and the new piece appears at the selected open end, on the server's answer, with undo.
- **DP-06 — One open end, one winner.** When two hobbyist members extend the same open track end, exactly one piece is added and the other member gets a named conflict with nothing overwritten.
- **DP-07 — One piece or version per gesture.** A double tap on a track tile or Save version gives one piece or one version, even when the two requests reach different app instances.
- **DP-08 — Piece inspector survives.** An open piece inspector keeps its values, its focus and its unsaved text through live edits from others, a re-read and a refresh.
- **DP-09 — Live co-editing.** A piece added, changed or removed by one member appears on another member's stage and counters without a reload, when the two browsers sit on different app instances.
- **DP-10 — Sign-in expiry keeps the work.** When sign-in expires during an edit or a command, the person signs back in on the same screen and the pending action completes once with its original key and draft.
- **DP-11 — Standards profile.** A club layout manager edits the workspace standards profile and every later check uses it, with lengths stored in integer millimetres and shown in inches or millimetres.
- **DP-12 — Geometry rules.** The server refuses a piece that breaks a piece rule before it reaches the shared layout and reports every piece and module rule finding with its measured value and limit.
- **DP-13 — Validate and publish.** A saved version moves from Draft to Validated only with no findings and to Published only from Validated, and a club layout manager sees the result in the Versions sheet.
- **DP-14 — Live renames.** When a club layout manager renames a station or block, the working copy, every open session, the timetable and the unissued packet preview show the new name live.
- **DP-15 — Records keep their names.** Issued packet PDFs and earlier versions keep the old name, and the layout history records who changed which name from what to what.
- **DP-16 — Exact restore.** Restoring a version creates a new Draft whose canonical hash equals the source exactly, including block assignments, elevations and timetable.
- **DP-17 — Trash and undo.** A club layout manager trashes a module and undoes it, and the working hash, pieces, block assignments and counts return exactly.
- **DP-18 — Purge.** Purging a trashed module removes it from every list, search and counter as qualified in Business rules, and history shows a placeholder.
- **DP-19 — Pinned sessions.** A session is created from one Published version, stays pinned to that layout version and timetable version, and shared layout edits never change it.
- **DP-20 — Timetable.** A club layout manager edits the timetable in its sheet, publishes it with a version and sees it as the running plan of a new session.
- **DP-21 — Extra train.** An operator adds an extra train to a session, which raises the session version, adds the train to the counters and supersedes the session's packets.
- **DP-22 — Session states.** Session commands follow the published state machine, and each illegal move gets the published refusal with nothing changed.
- **DP-23 — Highball authority.** A session operator selects a train and destination, presses Highball and, once the server commits, sees the authority on the stage, the schematic, the reserved counter and the status region together.
- **DP-24 — One winner per block.** When two operators request routes over the same block in one tick, exactly one authority is granted and the other is refused with a named conflict.
- **DP-25 — Route preview.** Overlapping route previews and block searches can only show the answer to the newest input, on screen and in the 3D ribbon preview.
- **DP-26 — Route locking and cancelling.** A granted route locks its turnouts, and an authority cannot be cancelled while its train stands in an approach block.
- **DP-27 — Authority expiry.** An authority expires on the committed tick its fast-clock limit is reached, never on a browser timer.
- **DP-28 — Gapless ticks.** A running session commits gapless ticks at the published rate, each with positions, occupancy, counters and an outbox row in one transaction.
- **DP-29 — Scale speed.** Scale speed converts to whole millimetres per tick by the published formula with the remainder carried, so distance run never drifts.
- **DP-30 — Committed occupancy.** Block occupancy is derived only from each train's committed head position, length and trail, and an out-of-service block reads as occupied.
- **DP-31 — Counters equal a recount.** The occupied, reserved, free, train and open-conflict counters equal a recount of committed state after every tick, retry, resume and restore.
- **DP-32 — Live stage.** A session operator watches train positions, block states, counters and the fast clock change in place on each committed tick from another app instance, with no reload.
- **DP-33 — Device clock ignored.** Fast-clock time, session status and authority expiry on screen come only from the server, so a wrong, slow or sleeping device clock changes nothing.
- **DP-34 — Conflict sheet.** A refused Highball opens the Conflict sheet naming the other train, and the operator saves a note, withdraws the request or moves a train.
- **DP-35 — Deadlock.** The server raises a deadlock on the tick a cycle forms in the committed wait-for graph, names every member, and refuses every other way of clearing it.
- **DP-36 — Back to loop and Recall.** Back to loop and Recall move a train at once as published, revoke its authority, close its conflicts and clear any deadlock it belongs to.
- **DP-37 — Working state survives ticks.** An open conflict sheet, selected train and half-typed note survive each tick, a re-read and a refresh without closing, resetting or losing focus.
- **DP-38 — Tick lease takeover.** Exactly one instance advances each running session under the Valkey tick lease, and a survivor takes over after the holder dies without repeating or skipping a tick.
- **DP-39 — Resume.** An operator resumes a Held or Interrupted session from the last committed tick with positions, authorities, timetable progress and fast clock intact, and of two simultaneous presses exactly one acts.
- **DP-40 — Retried commands.** A retried Highball, Resume or Issue packet returns the first result and never a second authority, resume or render, and a key reused with a different body is refused.
- **DP-41 — Issue crew packet.** An operator presses Issue packet, watches it move through its states in the Crew packets sheet and downloads the PDF once it is Ready.
- **DP-42 — Packet contents.** Every crew packet PDF is rendered by Gotenberg from one session version with timetable, train orders, block table and track diagram, and prints the session version and content hash on each page.
- **DP-43 — Superseded packets.** A later rename or extra train leaves the stored PDF unchanged and marks the packet Superseded.
- **DP-44 — Packet all or nothing.** The packet record, PDF bytes and event land together or the packet ends Failed with no bytes and no Ready event.
- **DP-45 — Stream delivery and replay.** Every committed tick and layout edit reaches each instance through its Valkey Stream in commit order, and a reconnecting browser replays what it missed or gets a resync once replay has aged out.
- **DP-46 — Browser event order.** The browser applies events strictly by sequence, ignores any sequence already applied, and fetches a snapshot on a gap, so a late older event never rewinds the scene.
- **DP-47 — Valkey outage.** With Valkey unreachable the app still starts, running sessions hold at their last committed tick with the published copy, and they recover without an app restart when Valkey returns.
- **DP-48 — Gotenberg outage.** With Gotenberg unreachable the app still starts, packets end Failed with the published copy, and issuing works again without an app restart when Gotenberg returns.
- **DP-49 — Error order.** Every API error follows the one published order and shape with its exact copy.
- **DP-50 — Platform and server boundary.** The app installs, builds and serves from the run manifest as at least two instances behind one origin, answers health, and keeps to the server boundary.
- **DP-51 — Loading screen.** The white loading screen shows the Gandyboard puffy wordmark and the layout load pill reporting real scene and snapshot progress, then fades into the club-hall layout stage.
- **DP-52 — First-layout walkthrough.** A person on first run gets the first-layout walkthrough card over the dimmed stage, with five steps, walkthrough step dots, Skip, artwork matching the input device and a stored finish.
- **DP-53 — Stage controls and keyboard.** Every flow is keyboard-complete, including the stage, with the published keys, the roving item list, the heading dial, the Build and Operate switch and visible focus.
- **DP-54 — Touch and phone layout.** At phone size a session operator controls the stage by touch with one-finger pan, pinch zoom and two-finger rotate, every control meets the tap size in Visual design and no viewport overflows sideways.
- **DP-55 — Highball Ribbon motion.** The Highball Ribbon plays exactly as published for grant, tail release and refusal, and a newer revision interrupts a running step without rewinding or queueing.
- **DP-56 — Reduced motion.** Under reduced motion all state changes land in one frame with the same occupancy and train state, camera moves become cuts and the pigeon pass is gone.
- **DP-57 — WebGL loss and schematic fallback.** WebGL context loss pauses only the view and rebuilds from the newest server state, and with no WebGL the same URL gives a keyboard-operable SVG schematic with every command.
- **DP-58 — View state in the URL.** Workspace, layout, version, session, mode, selected train or block, camera heading and open sheet live in the URL and are restored on refresh.
- **DP-59 — Visual language.** Every screen carries the bright tactile language of Visual design, with lipped controls, the three corner sizes, the two typefaces and block states never shown by colour alone.
- **DP-60 — Real services and real scene.** Stage, ticks, occupancy and packets come from the real server and services, with a real three.js scene of original procedural models and no fixed or simulated browser state.

## Frontend

### Screens and layout (DP-04, DP-05, DP-13, DP-20, DP-41, DP-51, DP-52, DP-54, DP-59)

The whole product is one app shell filling the browser window. A single full-bleed 3D canvas, the club-hall layout stage, sits behind everything. Fixed overlays pin to the screen edges and the centre stays clear for the layout. Breakpoints are phone (up to 767 pixels wide), tablet (768 to 1199 pixels) and desktop (1200 pixels and up). The page itself never scrolls and never overflows sideways at 375x812, 768x1024 or 1280x800; only sheets and the tile rail scroll inside themselves.

- **Loading screen.** A white screen with the Gandyboard puffy wordmark centred and the layout load pill below it, then a fade into the stage.
- **Sign-in.** A white sheet over the bare stage ground with email, password and one lipped command button.
- **Club-hall layout stage.** A procedural club hall: a saturated field-green floor, trestle legs, HO scale modules, track, signals at block ends, station name boards, invented low-poly freight stock and a pale gradient hall roof. No trees, clouds, countryside or toy sets.
- **Sticker-outline session bar.** Floats directly on the scene at the top, with no bar background. In order: Sheets (gear glyph), Reset view (camera glyph), then the text actions Sessions and Crew packets. White glyphs and bold labels carry a dark sticker-like outline so they read against any scene colour. In Operate mode a readout group sits beside it with fast clock, session status, session version and the five counters. Phones place the readout on a second line under the bar.
- **Bottom edge.** The track piece tile rail shows in Build mode, centred along the bottom on desktop and tablet; on phones it scrolls horizontally from a small left margin with the last tile clipped. Below or beside it sit the Highball and Recall buttons (bottom left), the heading dial next to them, and the Build and Operate switch at bottom right. Highball and Recall appear in Operate mode only.
- **Block schematic.** In Operate mode a table on the right edge lists every block with number, name, state word and train. On phones it opens from a Schematic button as a bottom sheet. The route panel with destination and block search sits above the schematic on desktop and tablet, and inside the same sheet on phones.
- **Sheets.** Layouts, Versions, Timetable, Crew packets, Members, Standards, History, Trash and Sessions slide over the live stage so trains stay visible around them: from the right on desktop and tablet, and from the bottom filling most of the screen on phones. Tables become stacked rows below 768 pixels.
- **First-layout walkthrough card.** Centred over the dimmed stage, keeping about 20 pixels of side margin on phones, and about 350 pixels wide by 495 tall elsewhere.
- **Conflict and Deadlock sheets, and the Piece inspector.** These are non-modal, so the stage and status keep updating behind them.

### Public screens and controls (DP-05, DP-08, DP-13, DP-23, DP-34, DP-41, DP-53, DP-58)

Only these are public. Everything else is free. Names are exact. `<n>` is a block number, `<v>` a version number and `<number>` a train number.

| Role and accessible name | Test id | Visible copy or notes |
|---|---|---|
| `img "Gandyboard"` | `splash-wordmark` | Puffy wordmark |
| `progressbar "Loading layout"` | `layout-load-pill` | Value 0 to 100 from real progress |
| `textbox "Email"`, `Password` labelled field, `button "Sign in"` | `sign-in-form` | Sign-in sheet |
| `dialog "Sign in again"` with `Password` and `button "Sign in"` | `sign-in-again` | Email shown read-only |
| `application "Club-hall layout stage"` | `stage` | Contains the canvas, and carries the stage attributes below |
| `navigation "Session bar"` | `session-bar` | Sticker-outline session bar |
| `button "Sheets"`, `menu "Sheets"` | | Menu items: `Layouts`, `Versions`, `Timetable`, `Members`, `Standards`, `History`, `Trash` |
| `button "Reset view"` | | Returns camera to heading 0 and the fit-all zoom |
| `button "Sessions"`, `button "Crew packets"` | | Open those sheets |
| `combobox "Workspace"` | `workspace-switcher` | In the session bar. One option per workspace the person belongs to, labelled with the workspace name, value the workspace id. Choosing one sets `workspace` in the URL and opens that workspace's first layout |
| `button "New workspace"` | `new-workspace` | Practice founder only, beside the switcher; opens the dialog below |
| `dialog "New workspace"` | `new-workspace-dialog` | `textbox "Workspace name"`, `combobox "Template"` (options `Reference layout` with value `reference`, `Empty` with value `empty`), `button "Create workspace"`. On success the new workspace opens and the dialog closes |
| `button "Sign out"` | `sign-out` | In the session bar. Ends the sign-in and shows the sign-in sheet |
| Layouts sheet rows | `layout-row-<layout id>` | Layout name and counts; `button "Open"` sets `layout` in the URL and loads that layout. The sheet also has `textbox "Layout name"` and `button "Create layout"` |
| `button "Trash module"` | `trash-module` | Build mode, beside Add module. Trashes the module that holds the selected piece or open end; disabled while neither is selected |
| `dialog "<sheet name>"` with `button "Close"` | `sheet-<lowercase name, hyphenated>` | One per sheet |
| `status "Gandyboard status"` | `status-region` | The only named live region; polite |
| `alert` | `error-sheet` with `button "Dismiss"` | White sheet with orange lip, for errors |
| `alert` | `outage-banner` | Outage copy from Feedback states |
| Fast clock text | `fast-clock` | `HH:MM:SS` |
| Session status text | `session-status` | `Scheduled`, `Running`, `Held`, `Interrupted`, `Ended` |
| Session version text | `session-version` | `Session version <n>` |
| `group "Counters"` | `counter-occupied`, `counter-reserved`, `counter-free`, `counter-trains`, `counter-conflicts` | Labels `Occupied`, `Reserved`, `Free`, `Trains`, `Conflicts`, each with a figure |
| `group "Session controls"` | | `button "Start"`, `button "Hold"`, `button "Resume"`, `button "End session"`, `button "Add extra train"`, in the Sessions sheet and, for the open session, under the readout |
| `dialog "Add extra train"` | | `textbox "Train number"`, `textbox "Train name"`, `spinbutton "Length"`, `spinbutton "Speed"`, `combobox "Direction"`, `combobox "Start block"`, `button "Add train"` |
| `dialog "New session"` | | `textbox "Session name"`, `combobox "Published version"`, `spinbutton "Clock ratio"`, `button "Create session"`; opened by `button "New session"` |
| `toolbar "Track pieces"` | `tile-rail` | Track piece tile rail with buttons `Straight 12 in`, `Straight 6 in`, `Curve left`, `Curve right`, `Turnout left`, `Turnout right`, `Rise`, `Fall`, `Undo last piece` |
| `button "Add module"`, `button "Check layout"`, `button "Save version"` | | Build mode, above the tile rail; Save version also in the Versions sheet |
| `dialog "Add module"` | | `textbox "Module name"`, `combobox "Endplate"` (`Single`, `Double`), `button "Create module"` |
| `dialog "Piece inspector"` | `piece-inspector` | `spinbutton "Rise"`, `combobox "Block"`, `textbox "Piece note"`, `button "Apply"`, `button "Remove piece"` |
| `listbox "Stage items"` | `stage-items` | Roving list; options named `Piece <id>`, `Block <n> <name>`, `Train <number>`, `Open end <label>` |
| `listbox "Trains"`, `option "Train <number>"` | | Operate mode |
| `button "Highball"` | `highball` | Round orange button, play glyph |
| `button "Recall"` | `recall` | Round orange button, return glyph |
| `button "Rotate heading"` | `heading-dial` | Heading dial; needle shows heading |
| `switch "Operate mode"` | `mode-switch` | Build and Operate switch; on means Operate |
| `region "Route"` | `route-panel` | `combobox "Destination block"`, `combobox "Via block"`, `spinbutton "Time limit"`, `button "Cancel authority"` |
| `searchbox "Block search"`, `listbox "Block results"` | | Results named `Block <n> <name>` |
| Preview line | `route-preview` | `Route: <block numbers joined by a comma and a space>` or `Blocked at Block <n> by Train <number>` |
| `button "Schematic"` | | Phones only |
| `table "Block schematic"` | `block-row-<n>`, `block-state-<n>` | State words `Free`, `Reserved`, `Occupied`, `Out of service`; each row has `button "Rename"` and `button "Out of service"`, labelled `Return to service` while out |
| `dialog "Rename"` | | `textbox "New name"`, `button "Save name"`; stations are renamed from the Timetable sheet's station rows with the same dialog |
| `dialog "Conflict"` | `conflict-sheet` | `textbox "Dispatcher note"`, `button "Save note"`, `button "Withdraw request"`, `button "Back to loop"`, `button "Recall train"` |
| `dialog "Deadlock"` | `deadlock-sheet` | Lists members, and each member has `button "Back to loop"` and `button "Recall train"` with the train named by `aria-describedby` |
| Versions sheet rows | `version-row-<v>` | State, label, hash; `button "Validate"`, `button "Publish"`, `button "Restore"` |
| Crew packets sheet | `packet-row-<id>` | `button "Issue packet"`, state word, `link "Download PDF"` when bytes exist; `next-packet-preview` shows the unissued content |
| Timetable sheet | `timetable-row-<entry id>` | `spinbutton "Depart"` per row, `button "Save timetable"` |
| Members sheet | `member-row-<user id>` | `button "Add member"`, then `textbox "Display name"`, `textbox "Email"`, `Password` labelled field, `combobox "Role"`, `button "Save member"` |
| Standards sheet | | One `spinbutton` per profile field named as in Business rules, `radio "Inches"`, `radio "Millimetres"`, `button "Save standards"` |
| Trash sheet | `trash-row-<module id>` | `button "Undo"`, `button "Purge"` |
| `dialog "First layout walkthrough"` | `walkthrough-card` | `button "Skip"`, `button "Next"`, last step `button "Start building"`; `group "Step <n> of 5"` holds the walkthrough step dots |
| `heading` | `walkthrough-title` | The step title from Interactions |
| `img` named `Touch gestures illustration` or `Mouse and keyboard illustration` | `walkthrough-art` | Carries `data-input="touch"` or `data-input="pointer"` |

**Units and options of the form controls.** Length controls follow the workspace display units. In Inches mode they show and accept decimal inches (up to three decimals, for example `0.75`, with no fractions typed), and in Millimetres mode whole millimetres. The server stores the value converted to integer millimetres, rounded to the nearest. This applies to the extra-train `Length` only in millimetres always, and to `Rise` in the Piece inspector, which follows the display units. Other units:

- `Speed` is whole miles per hour.
- `Clock ratio` is a whole number from 1 to 12.
- `Time limit` is in fast-clock minutes, a whole number from 1 to 720, default 60. It is sent as that number times 60 in `time_limit_fast_seconds`.
- `Depart` is in fast-clock seconds, a whole number from 0 to 86399.

Combobox options are labelled and valued as follows:

| Combobox | Option label | Carried value |
|---|---|---|
| `Direction` | `East`, `West` | `east`, `west` |
| `Start block`, `Destination block`, `Via block`, `Block` (Piece inspector) | `Block <n> <name>` | the block id |
| `Via block`, `Block` | first option `No block` | empty |
| `Published version` | `Version <v> <label>`, Published versions only | the version id |
| `Endplate` | `Single`, `Double` | `single`, `double` |
| `Role` | `Manager`, `Member`, `Operator` | `manager`, `member`, `operator` |
| `Template` | `Reference layout`, `Empty` | `reference`, `empty` |

Stage attributes on `stage`, always current:

- `data-scene-revision`: newest applied session or layout revision.
- `data-scene-tick`: committed tick shown.
- `data-scene-mode`: `build`, `operate` or `paused`.
- `data-scene-heading`: degrees.
- `data-scene-zoom`: a positive number.
- `data-scene-pan`: `x,y`.
- `data-scene-animating`: `true` or `false`.
- `data-ribbon-blocks`: block numbers currently drawn, comma separated.
- `data-preview-blocks`: block numbers in the current preview ribbon.
- `data-limit-flag-block`: the block carrying the limit flag, or empty.
- `data-block-points`: a JSON object from block number to `[x, y]` in CSS pixels, the on-screen point of that block's track centre for the current camera.

View URL: everything lives on `/` as query parameters `workspace`, `layout`, `version`, `session`, `mode` (`build` or `operate`), `train`, `block`, `piece` (the selected piece id), `end` (the selected open end id), `heading`, `sheet`. `sheet` uses the test id suffix after `sheet-` for the nine sheets (`layouts`, `versions`, `timetable`, `crew-packets`, `members`, `standards`, `history`, `trash`, `sessions`). For the three non-modal dialogs its values are `conflict` (Conflict), `deadlock` (Deadlock) and `piece-inspector` (Piece inspector, which also needs `piece`). Every change writes the URL, and a refresh restores the same view (DP-58).

### Interactions (DP-05, DP-08, DP-10, DP-23, DP-25, DP-34, DP-37, DP-53, DP-54, DP-58)

- **Selecting an open end.** Clicking, tapping or pressing Enter on an open end marker selects it, and the tile rail acts on it. If nothing is selected, the newest open end of the selected module is used.
- **Pressing a tile.** The tile compresses and one append command goes out with one key. Further presses of any tile while it is pending reuse that command and send nothing new. The piece appears only after the server answers.
- **Undo last piece.** Removes the newest piece the signed-in person added in this module.
- **Piece inspector.** Selecting a piece opens the inspector. Apply sends the changed fields. Live events update everything else on screen, but the inspector's typed values, focus and caret stay as they are until Apply or Close. A refresh restores the selected piece from the URL and the unsaved note from browser storage.
- **Choosing a route.** Selecting a train, then a destination, or typing in Block search, sends a preview or search after no more than a quarter of a second of quiet. Only the answer to the newest input may change `route-preview`, `data-preview-blocks`, the ribbon preview or `Block results`; earlier answers are discarded whenever they arrive. The final keystroke is always searched.
- **Highball.** Pressing Highball sends one command for the selected train. Nothing on the stage changes until the server answers. A train can also be selected by clicking it, by the roving list or by the `Trains` list.
- **Conflict sheet.** A refusal opens the sheet naming the other train. Ticks and re-reads update its facts but never close it, reset its note or move focus. A refresh restores it from the URL, and the half-typed note and selected train come back from browser storage. Save note, Withdraw request, Back to loop and Recall train send their commands.
- **Sign-in expiry.** Any 401 on a write or read opens `Sign in again` on the same screen, keeps the screen and draft, and holds the pending commands. Several commands hitting 401 at once share one dialog and one sign-in request. After sign-in each pending command is sent once more with its original key and body. A wrong password keeps the dialog and every draft.
- **Stage keyboard.** With `stage` focused: arrow keys pan, Q and E rotate 45 degrees, plus and minus zoom. Tab moves from the stage into `Stage items`; arrow keys move within that list; Enter selects the item and opens its inspector or schematic row. Further Tab goes to the tile rail or Highball, heading dial, mode switch, then the session bar.
- **Sheets and dialogs.** Escape closes the top sheet, dialog or menu and returns focus to the control that opened it. The walkthrough, sign-in and `Sign in again` keep focus inside themselves. Conflict, Deadlock and Piece inspector do not trap focus.
- **Heading dial.** Each press or tap rotates the camera 45 degrees clockwise, and the needle shows the heading.
- **Walkthrough.** The card opens over the dimmed stage when `walkthrough_done` is false. Its artwork follows the primary input: when the primary pointer is coarse (touch) it is `Touch gestures illustration` with `data-input="touch"`, drawn as a hand and phone outline; otherwise it is `Mouse and keyboard illustration` with `data-input="pointer"`, drawn as a mouse and keyboard outline. The five steps, each a title and one instruction line, are: 1 `Pick an open end` / `Select the end of a module where track should continue.`; 2 `Add track` / `Press a tile to add a piece to that end.`; 3 `Check the standard` / `Check layout shows every rule your layout breaks.`; 4 `Switch to Operate` / `Use the switch to open a session and watch the blocks.`; 5 `Give the road` / `Select a train, choose a destination and press Highball.` Next advances one step. Skip, at any step, and Start building, on step 5, each send `POST /api/me/walkthrough` once, close the card and never show it again; Next sends nothing.
- **Build and Operate switch.** Build shows the tile rail and hides Highball, Recall, the route panel and the schematic. Operate does the reverse. Operate needs an open session; with none, the Sessions sheet opens.
- **Touch.** One finger pans, pinch zooms and two fingers rotate. Tap selects. Mouse: drag pans, wheel zooms, right-drag rotates. These work with reduced motion as well.
- **Hover and press.** Hover brightens a control slightly. Press pushes it down 4 pixels into its lip. A visible 3-pixel ring in the deep accent blue shows keyboard focus on every control.

### Visual design (DP-59, DP-51, DP-52, DP-54)

The direction is candy-bright and rule-exact: serious railway dispatching dressed in puffy, chunky controls with no grey control-room styling. There is no dark theme. Mood is tactile (each control has a thick solid lip of about 5 pixels and compresses by 4 pixels on press), bright (saturated field green, orange and blue on white) and exact (each block shows a numbered state and each count is a tabular figure).

**Type.** Fredoka is the display face and Karla the body face; both are bundled with the app. Each heading step is a quarter larger than the one below it. Sheet and card titles are Fredoka semi-bold at 24 pixels. Forms and body text are Karla at 16 pixels. Numerals use Fredoka medium tabular figures. Density is comfortable.

**Colour roles.**
- Ground: pure white.
- Surface: a pale periwinkle grey, used for tile faces and the low end of sheet gradients.
- Ink: a soft blue-black for text.
- Accent: a bright sky blue, for line art, active dots and the top of primary buttons.
- Accent deep: a strong cobalt, for lips and for any text on blue.
- Action: a warm saturated orange, for round buttons, the toggle track and the loader fill.
- Field: a saturated green, for the 3D floor and free blocks.

Text on blue sits on the cobalt or on the deeper end of the button gradient, never on the bright sky blue. Glyphs on orange are ink. All text meets WCAG 2.2 AA contrast, and every interactive target is at least 44 pixels in both directions.

**Corners.** Exactly three sizes exist: sheets and cards at 20 pixels, controls at 10 pixels, toggles and loaders as full pills.

**Hero.** The loading screen is the hero. The newly drawn Gandyboard SVG wordmark is about 484 pixels wide on desktop (scaled to fit on phones), with each letter its own colour and a darker extruded lower edge about 5 pixels deep in the same hue, on an uneven playful baseline. Sixty pixels below it sits the layout load pill: a glossy pale-blue pill about 420 by 54 pixels with an inset track and an orange fill.

**Named components.**
- **Gandyboard puffy wordmark:** `img "Gandyboard"`, centred on the white ground.
- **Layout load pill:** `progressbar "Loading layout"`, determinate; its fill grows only with real progress.
- **Club-hall layout stage:** `application "Club-hall layout stage"`, full window behind all overlays, matte low-poly materials, and a dark scrim of just under half strength while the walkthrough is open.
- **Sticker-outline session bar:** `navigation "Session bar"`, top of the screen, white outlined glyphs and bold labels, no background. Hover grows controls very slightly.
- **First-layout walkthrough card:** `dialog "First layout walkthrough"`, a 20-pixel-corner card graded from white to the pale surface. Top to bottom: Skip at top right (14-pixel bold sentence case in cobalt), line art, title, one line of instruction, lipped command button, step dots.
- **Lipped command button:** a blue vertical gradient with a cobalt lip and a white bold label; it compresses on press and is faded with no lip when disabled.
- **Walkthrough step dots:** five small dots near the bottom of the card, the active one bright blue and the others pale blue, not clickable.
- **Track piece tile rail:** `toolbar "Track pieces"`, tiles about 50 by 56 pixels (grown to the tap size where needed) on pale surface faces with a blue-grey lip, saturated glyphs and a small ring under each tile that fills when that tile's piece is the last added.
- **Highball and Recall buttons:** two round orange buttons about 50 pixels across (grown to the tap size where needed) with a darker orange lip and ink glyphs, bottom left.
- **Heading dial:** a round white dial about 50 pixels across beside the round buttons, with a ticked inner ring, a blue star-shaped needle and a small green arc on the rim.
- **Build and Operate switch:** `switch "Operate mode"`, a card about 116 by 57 pixels at bottom right with a build glyph, a pill toggle with orange track and white knob, and an operate glyph; the active side's glyph is orange and the other blue-grey.

**Working screens.** Lists are 20-pixel-corner sheets graded from white to the pale surface with a thick lip, not a soft shadow. Forms use Karla with Fredoka titles. Empty states use 3-pixel-stroke line art in accent blue with one lipped button. Loading uses the pill. Errors are white sheets with an orange lip and the exact copy from Feedback states.

**Block states** are never colour alone. Free is plain field green. Reserved is a blue ribbon with chevrons. Occupied is action orange with a train glyph. Out of service is ink with 45-degree hatching. Each state is repeated as a word in the schematic.

### Motion and effects (DP-51, DP-52, DP-55, DP-56, DP-57)

All motion uses one easing: a symmetrical gentle S-curve that starts and ends slowly. Each step has one duration:

| Step | Meaning | Duration |
|---|---|---|
| Press compress | Press feedback on any control | 100 milliseconds |
| Ribbon extend or give back | One block of authority gained or returned | 180 milliseconds per block, 1 to 8 blocks, 1,440 milliseconds at most |
| Switch knob slide | Mode change | 200 milliseconds |
| Limit flag rise | End of authority | 240 milliseconds |
| Sheet slide, walkthrough step cross-fade, dot change, tile piece slide | Enter, exit, step change | 300 milliseconds |
| Heading dial and camera turn | 45-degree rotation | 400 milliseconds |
| Walkthrough card and scrim close | Exit | 500 milliseconds |
| Train glide | Move to the newest committed position | 640 milliseconds inside each one-second tick |
| Loading screen fade | Into the stage | 700 milliseconds |

**Piece append.** A new piece slides for 300 milliseconds along the open end's tangent and latches at the rail joiner. Nothing falls into place. The camera eases toward it over 400 milliseconds.

**Highball Ribbon (signature).**
1. Pressing the round Highball button compresses it 4 pixels and the status region announces the request. No ribbon appears yet.
2. When the server commits the authority at a new revision, a blue chevron ribbon extends from the train's nose along each granted block in route order, 180 milliseconds per block. Each block's schematic row and the reserved counter change in the same step as that block's ribbon.
3. A limit flag rises at the last block over 240 milliseconds.
4. On each committed tick the train glides to the server's position in 640 milliseconds, its blocks turn occupied, and the ribbon gives blocks back from the tail at 180 milliseconds per block as the tail clears.
5. On refusal the ribbon extends only to the block before the conflict, that block turns hatched orange, and the ribbon retracts at 180 milliseconds per block as the Conflict sheet opens naming the other train.

`data-scene-revision` always equals the newest server revision applied, canvas pixels at each point in `data-block-points` show that block's state, and an older event arriving late never rewinds the scene.

**Interruption rule, all modes.** A newer revision ends the running step at its current rendered value and starts toward the newest state with that step's published duration. Steps never queue or replay.

**Idle scene.** The scene has no looping decoration. Signals show block state and only change when state changes. One pigeon crosses under the hall roof once per stage load, taking about 3 seconds, and does not return.

**Reduced motion.** All granted blocks change state in one frame, the flag appears without rising, the train moves directly to each committed position, camera moves become cuts, sheets and cards appear at once, the loader still reports progress and the screens swap instantly. The pigeon pass is removed. The status region, counters and schematic carry the same information. Dragging, pinching and the keyboard still move the camera.

**WebGL.** On context loss the stage shows `The 3D view is paused. Your session is still running.`, `data-scene-mode` reads `paused`, and all overlays, counters and commands keep working. On restore the scene rebuilds from the newest server state, not its last frame. With no WebGL at all the same URL renders an SVG schematic in place of the canvas, with `stage` still present, and keyboard focus can reach each block, train and piece. Every command is available, and the `data-` attributes stay current.

### Feedback states (DP-10, DP-23, DP-34, DP-41, DP-47, DP-48, DP-49)

Every async result is announced in `status "Gandyboard status"` with this copy. No success appears before the server answers. A later repaint never overwrites a status or error the action just showed. Placeholders: `<number>` train number, `<block>` block name, `<other>` other train number, `<n>` count, `<v>` version number, `<tick>` committed tick.

| Action | Pending | Success | Failure |
|---|---|---|---|
| Sign in | `Signing in.` | `Signed in.` | `That email and password do not match.` |
| Add piece | `Adding piece.` | `Piece added.` | The rule copy from Business rules, or the 409 copy from the API |
| Remove piece | `Removing piece.` | `Piece removed.` | API copy |
| Apply piece | `Saving piece.` | `Piece saved.` | Rule copy |
| Check layout | `Checking layout.` | `Layout passes every rule.` | `Layout has <n> findings.` |
| Save version | `Saving version.` | `Version <v> saved.` | API copy |
| Validate | `Validating version <v>.` | `Version <v> validated.` | `Version <v> has <n> findings.` |
| Publish | `Publishing version <v>.` | `Version <v> published.` | API copy |
| Restore | `Restoring version <v>.` | `Restored as version <v>.` | API copy |
| Rename | `Saving name.` | `Renamed to <new name>.` | API copy |
| Trash, undo, purge | `Moving to trash.`, `Undoing.`, `Purging.` | `Moved to trash.`, `Module restored.`, `Purged.` | API copy |
| Save timetable | `Saving timetable.` | `Timetable saved.` | API copy |
| Save standards | `Saving standards.` | `Standards saved.` | API copy |
| Add member | `Adding member.` | `Member added.` | API copy |
| Create session | `Creating session.` | `Session created.` | API copy |
| Start, Hold, Resume, End | `Starting session.`, `Holding session.`, `Resuming session.`, `Ending session.` | `Session running.`, `Session held at tick <tick>.`, `Session resumed at tick <tick>.`, `Session ended.` | API copy |
| Highball | `Requesting the road for Train <number>.` | `Train <number> has the road to <block>, <n> blocks.` | `Train <number> refused at <block>: held by Train <other>.`, or `Train <number> refused at <block>: out of service.` |
| Cancel authority | `Cancelling authority.` | `Authority released.` | API copy |
| Back to loop | `Sending Train <number> back to loop.` | `Train <number> is in <block>.` | API copy |
| Recall | `Recalling Train <number>.` | `Train <number> recalled to <block>.` | API copy |
| Save note, Withdraw | `Saving note.`, `Withdrawing request.` | `Note saved.`, `Request withdrawn.` | API copy |
| Out of service | `Changing block.` | `Block <block> out of service.`, `Block <block> back in service.` | API copy |
| Add extra train | `Adding train.` | `Train <number> added. Session version <n>.` | API copy |
| Issue packet | `Issuing crew packet.` | On `Ready`: `Crew packet ready.` | On `Failed`: the failure copy below |

Server-raised announcements:

- Deadlock: `Deadlock: Trains <numbers joined by a comma and a space> are waiting on each other.`
- Authority expiry: `Authority for Train <number> expired.`

A refused write shows the API's message in the status region, and the form keeps the values the person typed.

Outage copy, shown in `outage-banner` and the status region:

| Situation | Copy |
|---|---|
| Valkey unreachable | `Live updates are paused. Sessions are held at their last committed tick.` |
| Valkey returned | `Live updates are back.` |
| Layout edit saved while Valkey is unreachable | `Saved. Other members will see this when live updates return.` |
| Packet failed, Gotenberg | `Crew packet failed: the PDF service did not answer. Nothing was issued.` |
| Packet failed, Valkey | `Crew packet failed: live updates are paused. Nothing was issued.` |
| Gotenberg known down, Crew packets sheet | `The PDF service is not answering. New packets will fail until it returns.` |

While the event stream is unavailable the browser re-reads the session snapshot every 3 seconds. Empty lists show `Nothing here yet.` with the sheet's one lipped button where it has one.

## Backend

### API (DP-01 to DP-49)

**Conventions.** JSON in and out with `Content-Type: application/json` unless stated. `W` is `/api/workspaces/<workspace_id>`, `L` is `W/layouts/<layout_id>`, `S` is `W/sessions/<session_id>`. The session cookie is `gandyboard_session`, HttpOnly and SameSite=Lax.

**Every write** (`POST`, `PUT`, `PATCH`) carries an `Idempotency-Key` header of 1 to 128 characters and a body field `revision`, except where the table marks it `no key` or `no revision`. `revision` means the current revision of the object the write changes; the table names which one.

**Error shape** is always `{"error":{"code":"<code>","message":"<copy>"}}`, with extra keys where stated. A `422 fields` cell in the tables below means that write answers 422 with code `invalid_fields` when a body field is missing, malformed or out of range.

**Error order** is fixed for the whole API. A request is checked in this order and the first failure answers:

| Order | Status | Code | Copy |
|---|---|---|---|
| 1 | 401 | `session_required` | `Your sign-in has ended. Sign in to carry on.` |
| 2 | 403 | `forbidden` | `You do not have access to this.` |
| 3 | 404 | `not_found` | `That item is not in this workspace.` |
| 4 | 422 | `idempotency_key_required` | `This request needs a key.` |
| 4 | 422 | `idempotency_key_reused` | `This key was already used with different details.` |
| 5 | 409 | `stale_revision` | `Someone changed this first. Review the latest and try again.` |
| 6 | 503 | `valkey_unavailable` | `Live updates are paused. Sessions are held at their last committed tick.` |
| 7 | 422 | `invalid_fields` | `Check the details and try again.` |
| 8 | 422 | Railway and validation rules | Published in Business rules |

A person who is not a member of a workspace, or a workspace that does not exist, answers 403. An unknown object inside a workspace answers 404. A key seen before with the same body returns the stored status and body at step 4, ahead of every later check, including a stored 422 refusal. The server boundary's 400, 413 and 415 come before this order.

**Auth and identity**

| Request | Body | Success | Own errors |
|---|---|---|---|
| `POST /api/auth/sign-in` (no key, no revision) | `{"email","password"}` | 200 `{"user":{"id","email","display_name"},"idle_seconds":<n>}`, sets cookie | 401 `invalid_credentials` `That email and password do not match.` |
| `POST /api/auth/sign-out` (no key, no revision) | none | 204 | |
| `GET /api/me` | | 200 `{"user":{...,"walkthrough_done":bool},"memberships":[{"workspace_id","workspace_name","role"}]}` | |
| `POST /api/me/walkthrough` (no key, no revision) | `{"done":true}` | 200 `{"walkthrough_done":true}` | |

**Workspaces and members**

| Request | Body | Success | Own errors |
|---|---|---|---|
| `GET /api/workspaces` | | 200 `{"workspaces":[{"id","name","role"}]}` | |
| `POST /api/workspaces` (no revision) | `{"name","template":"reference"\|"empty"}` | 201 `{"workspace":{"id","name"},"layout":{"id"},"version":{"id"}}`; `version` is `null` for `empty` | 422 fields |
| `GET W` | | 200 `{"id","name","role","standards":<profile>,"counts":{"members","layouts","sessions"}}` | |
| `GET W/members` | | 200 `{"members":[{"user_id","display_name","email","role","revision"}]}` | |
| `POST W/members` (no revision) | `{"display_name","email","password","role"}` | 201 `{"member":{...}}` | 422 fields; 422 `member_exists` `That person is already a member.` |
| `PATCH W/members/<user_id>` (member `revision`) | `{"revision","role"}` | 200 `{"member":{...}}` | |
| `GET W/standards` | | 200 profile with `revision` | |
| `PUT W/standards` (profile `revision`) | profile fields | 200 profile | 422 fields |

**Layouts and working copy**

| Request | Body | Success | Own errors |
|---|---|---|---|
| `GET W/layouts` | | 200 `{"layouts":[{"id","name","revision","counts"}]}` | |
| `POST W/layouts` (no revision) | `{"name"}` | 201 `{"layout":{...}}` | 422 fields |
| `GET L` | | 200 `{"id","name","revision","working_hash","content","module_revisions":{"<module_id>":n},"counts":{"modules","pieces","blocks","trash"}}` | |
| `GET L/blocks?q=<text>` | | 200 `{"blocks":[{"id","number","name","kind"}]}`, case-insensitive match on name or number | |
| `POST L/check` (no key, no revision) | `{}` | 200 `{"passed":bool,"findings":[...]}`, changes nothing | |
| `POST L/modules` (layout `revision`) | `{"revision","name","endplates":[{"end":"A","width_mm","track_offsets_mm":[...]},{"end":"B",...}]}` | 201 `{"module":{...},"layout_revision"}` | 422 fields |
| `POST L/modules/<module_id>/trash` (layout `revision`) | `{"revision"}` | 200 `{"layout_revision","working_hash"}` | |
| `POST L/trash/<module_id>/undo` (layout `revision`) | `{"revision"}` | 200 `{"module":{...},"layout_revision","working_hash"}` | |
| `POST L/trash/<module_id>/purge` (layout `revision`) | `{"revision"}` | 200 `{"layout_revision"}` | |
| `GET L/trash` | | 200 `{"modules":[{"id","name","trashed_by","trashed_at"}]}` | |
| `POST L/modules/<module_id>/pieces` (module `revision`) | `{"revision","open_end_id","piece":{...}}` | 201 `{"piece":{...},"open_ends":[...],"module_revision","layout_revision","working_hash"}` | 409 `open_end_taken`, 422 rule findings |
| `PATCH L/modules/<module_id>/pieces/<piece_id>` (module `revision`) | `{"revision","rise_mm"?,"block_id"?,"note"?}` | 200 as above without `open_ends` | 422 rule findings |
| `POST L/modules/<module_id>/pieces/<piece_id>/remove` (module `revision`) | `{"revision"}` | 200 `{"open_ends":[...],"module_revision","layout_revision","working_hash"}` | 422 `piece_has_followers` `Remove the pieces after this one first.` |
| `POST L/blocks` (layout `revision`) | `{"revision","name","kind"}` | 201 `{"block":{...},"layout_revision"}` | 422 fields |
| `PATCH L/blocks/<block_id>` (layout `revision`) | `{"revision","name"}` | 200 `{"block":{...},"layout_revision"}` | 422 fields |
| `PATCH L/stations/<station_id>` (layout `revision`) | `{"revision","name"}` | 200 `{"station":{...},"layout_revision"}` | 422 fields |
| `PUT L/timetable` (layout `revision`) | `{"revision","entries":[{"id","train_id","station_id","depart_fast_seconds"}]}` | 200 `{"timetable":{"version","entries"},"layout_revision"}` | 422 fields |
| `GET L/history?object_id=<id>` | | 200 `{"history":[{"id","actor","at","action","object_id","from","to"}]}`, newest first | |
| `GET L/events` | Server-sent events | See Services | |

**Piece bodies.** All carry `rise_mm` (signed integer, default 0) and `mainline` (boolean, default true).
- `{"kind":"straight","length_mm"}`
- `{"kind":"curve","radius_mm","angle_deg","hand":"left"|"right"}`
- `{"kind":"turnout","frog_number","hand","length_mm"}`

A curve's length is its radius times its angle in radians, rounded to the nearest millimetre. A stored piece adds `id`, `length_mm`, `block_id` (inherited from the piece it joins), `note`, and `start` and `end` objects with `x_mm`, `y_mm`, `elevation_mm` and `heading_deg`, computed by the server.

**Tile rail values:**

| Tile | Piece |
|---|---|
| `Straight 12 in` | Straight, 305 mm |
| `Straight 6 in` | Straight, 152 mm |
| `Curve left`, `Curve right` | Radius 1067 mm, 15 degrees |
| `Turnout left`, `Turnout right` | Frog number 6, 305 mm |
| `Rise`, `Fall` | Straight, 1219 mm, rise of +19 or −19 mm |

**Content.** `content` holds `modules`, `blocks`, `stations`, `turnouts`, `trains` and `timetable` (`{"version","entries"}`). Each module holds `id`, `name`, `endplates`, `pieces` in chain order and `open_ends` (`{"id","label","x_mm","y_mm","elevation_mm","heading_deg"}`). Every array but `pieces` is sorted by `id`. A consumed open end disappears and its replacement has a new id; a turnout leaves two.

**The canonical hash** is the lowercase SHA-256 hex of `content` serialised as JSON with object keys sorted, no whitespace and non-ASCII characters left unescaped. `working_hash` is the same for the working copy.

**Versions**

| Request | Body | Success | Own errors |
|---|---|---|---|
| `GET L/versions` | | 200 `{"versions":[{"id","number","state","label","canonical_hash","saved_by","saved_at","restored_from","revision"}]}` | |
| `GET L/versions/<version_id>` | | 200 the same plus `content` | |
| `POST L/versions` (layout `revision`) | `{"revision","label"}` | 201 `{"version":{...},"layout_revision"}` | |
| `POST L/versions/<version_id>/validate` (version `revision`) | `{"revision"}` | 200 `{"version":{...},"report":{"passed":true,"findings":[]}}` | 422 `validation_failed` `This version breaks the club standard.` plus `findings`, state unchanged; 422 `version_transition` |
| `POST L/versions/<version_id>/publish` (version `revision`) | `{"revision"}` | 200 `{"version":{...}}` | 422 `version_transition` |
| `POST L/versions/<version_id>/restore` (layout `revision`) | `{"revision"}` | 201 `{"version":{...},"layout_revision","working_hash"}` | |

**Sessions**

| Request | Body | Success | Own errors |
|---|---|---|---|
| `GET W/sessions` | | 200 `{"sessions":[{"id","name","status","tick","layout_version_number"}]}` | |
| `POST W/sessions` (no revision) | `{"name","layout_version_id","ratio"?}` | 201 session snapshot | 422 `version_not_published` `Only a Published version can run a session.`; 422 fields |
| `GET S` | | 200 session snapshot | |
| `POST S/start`, `S/hold`, `S/resume`, `S/end` (`control_revision`) | `{"revision"}` | 200 session snapshot | 422 `session_transition` |
| `POST S/trains` (`session_version` as revision) | `{"revision","number","name","length_mm","speed_mph","direction","start_block_id"}` | 201 session snapshot | 422 fields; 422 `block_in_use` |
| `POST S/trains/<train_id>/route-preview` (no key, no revision) | `{"destination_block_id","via_block_id"?}` | 200 `{"route_block_ids":[...],"limit_block_id","clear":bool,"conflict_block_id","other_train_number"}`, changes nothing | 422 `no_route`, `route_too_long` |
| `GET S/blocks?q=<text>` | | 200 as `L/blocks`, current names | |
| `POST S/trains/<train_id>/authorities` (train `revision`) | `{"revision","destination_block_id","via_block_id"?,"time_limit_fast_seconds"?}` | 201 `{"authority":{...},"session":<snapshot>}` | 422 `route_conflict`, `no_route`, `route_too_long`, `authority_active`, `deadlock_open`, `session_not_active` |
| `POST S/authorities/<authority_id>/cancel` (authority `revision`) | `{"revision"}` | 200 `{"authority":{...},"session":<snapshot>}` | 422 `approach_locked`, `authority_ended`, `session_not_active` |
| `POST S/trains/<train_id>/back-to-loop` (train `revision`) | `{"revision"}` | 200 session snapshot | 422 `no_free_loop`, `session_not_active` |
| `POST S/trains/<train_id>/recall` (train `revision`) | `{"revision"}` | 200 session snapshot | 422 `recall_blocked`, `session_not_active` |
| `PATCH S/conflicts/<conflict_id>` (conflict `revision`) | `{"revision","note"}` | 200 `{"conflict":{...}}` | 422 fields |
| `POST S/conflicts/<conflict_id>/withdraw` (conflict `revision`) | `{"revision"}` | 200 session snapshot | 422 `deadlock_open` |
| `POST S/blocks/<block_id>/service` (`control_revision`) | `{"revision","out_of_service":bool}` | 200 session snapshot | 422 `block_in_use`, `session_not_active` |
| `POST S/turnouts/<turnout_id>/throw` (`control_revision`) | `{"revision","position":"normal"\|"reverse"}` | 200 session snapshot | 422 `turnout_locked`, `session_not_active` |
| `GET S/events` | Server-sent events | See Services | 503 `valkey_unavailable` |

**Session snapshot:**

```json
{"id":"","name":"","status":"Running","hold_reason":null,"ratio":6,
 "revision":0,"control_revision":0,"session_version":1,"tick":0,
 "fast_clock_seconds":0,"fast_clock_label":"00:00:00",
 "layout_version_id":"","layout_version_number":0,"timetable_version":0,
 "trains":[{"id":"","number":"","name":"","direction":"east","speed_mph":0,"length_mm":0,
   "head_block_id":"","head_offset_mm":0,"trail_block_ids":[],"occupied_block_ids":[],
   "distance_run_mm":0,"carry":0,"authority_id":null,"revision":0}],
 "blocks":[{"id":"","number":0,"name":"","kind":"plain","length_mm":0,"state":"free",
   "train_number":null,"authority_id":null}],
 "turnouts":[{"id":"","position":"normal","locked_by_authority_id":null}],
 "authorities":[{"id":"","train_id":"","state":"Granted","block_ids":[],"remaining_block_ids":[],
   "limit_block_id":"","expires_fast_seconds":0,"ended_reason":null,"revision":0}],
 "conflicts":[{"id":"","state":"Open","train_id":"","other_train_id":null,"block_id":"",
   "note":"","revision":0}],
 "deadlocks":[{"id":"","state":"Open","raised_at_tick":0,"train_numbers":[]}],
 "timetable_progress":[{"entry_id":"","arrived_fast_seconds":null}],
 "counters":{"occupied_blocks":0,"reserved_blocks":0,"free_blocks":0,"trains":0,"open_conflicts":0}}
```

A block's `state` is one of `free`, `reserved`, `occupied` or `out_of_service`.

**Route conflict refusal** answers 422 with code `route_conflict`, message `Train <other> holds <block>.` (or `<block> is out of service.`), and adds `authority` (state `Refused`), `conflict` and `reachable_block_ids`, the requested blocks before the conflict.

**Crew packets**

| Request | Body | Success | Own errors |
|---|---|---|---|
| `GET S/packets` | | 200 `{"packets":[<packet>]}` | |
| `GET S/packets/preview` | | 200 `{"session_version","content","content_hash"}`, with current names | |
| `POST S/packets` (`session_version` as revision) | `{"revision"}` | 202 `{"packet":<packet>}` | |
| `GET S/packets/<packet_id>` | | 200 `<packet>` | |
| `GET S/packets/<packet_id>/pdf` | | 200 `application/pdf` with the stored bytes | 422 `packet_no_pdf` `This packet has no PDF.` |

`<packet>` is `{"id","state","session_version","content_hash","failure","issued_by","issued_at","ready_at","byte_length"}`. `state` is `Queued`, `Rendering`, `Ready`, `Failed` or `Superseded`. `failure` is `null`, `gotenberg_unreachable` or `valkey_unreachable`.

**Operations and health**

| Request | Body | Success | Own errors |
|---|---|---|---|
| `GET /api/health` (open) | | 200 `{"status":"ok"}` | |
| `GET /api/status` (any signed-in person) | | 200 `{"valkey":"up"\|"down","gotenberg":"up"\|"down","instance":"<id>"}` | |
| `GET /api/ops/instances` (founder) | | 200 `{"instances":[{"id","up","leases":["<session_id>"]}]}` | |
| `POST /api/ops/instances/<id>/stop` (founder, no key, no revision) | `{"restart_after_ms":<0 to 60000>}` | 202 `{"instance":"<id>"}` | 422 fields |

Stop ends that instance's process at once, without releasing anything it holds, and it comes back after `restart_after_ms`. This is the founder's rescue control for a wedged instance.

While no instance is up the origin answers 503 `instances_restarting` `Gandyboard is restarting. Try again in a moment.`

### Business rules (DP-01, DP-06, DP-07, DP-11 to DP-49)

**Roles.** Stored role values are `founder`, `manager`, `member` and `operator`. The founder belongs to every workspace.

| Action | founder | manager | member | operator |
|---|---|---|---|---|
| Create workspace, operations endpoints | yes | no | no | no |
| Manage members, standards, timetable, renames, publish, restore, undo trash, purge | yes | yes | no | no |
| Add and edit modules, pieces and blocks, trash a module, save and validate versions, check layout | yes | yes | yes | no |
| Create sessions and run every session command, packets | yes | yes | no | yes |
| Read everything in the workspace | yes | yes | yes | yes |

**Replays and retries.** A key belongs to one person in one workspace. The first request's status and body are stored for the life of the workspace and returned for any later request with the same key and the same JSON body, across all instances. A second arrival while the first is still running waits for and returns the first result, so a double tap reaching two instances makes one piece, one version, one authority, one resume or one render. The same key with a different body is refused at step 4 of the error order.

**Revisions.**
- `layout.revision` rises on every working-copy change.
- A module's revision rises on every change to that module.
- A train's revision rises on each authority, refusal or move command for it, never on a tick.
- `control_revision` rises on Start, Hold, Resume, End, block service and turnout changes, including automatic holds.
- `session_version` starts at 1 and rises only when an extra train is added.
- Session `revision` rises by 1 on every committed session change, ticks included.

Commands never carry session `revision`, so a tick can never make a command stale.

**Standards profile.** A workspace profile holds these fields, in integer millimetres unless named otherwise. Defaults are the club standard, and each display label is the Standards sheet control's accessible name.

| Field | Label | Default | Meaning |
|---|---|---|---|
| `endplate_single_mm` | `Single endplate` | 610 | 24 in |
| `endplate_double_mm` | `Double endplate` | 660 | 26 in |
| `double_track_offset_mm` | `Double track offset` | 25 | Each track 1 in from centre, 2 in apart |
| `end_straight_mm` | `End straight` | 152 | 6 in |
| `min_radius_mm` | `Minimum radius` | 1067 | 42 in |
| `max_grade_tenths_percent` | `Maximum grade` | 20 | 2.0% |
| `min_frog_number` | `Minimum turnout` | 6 | #6 |
| `reverse_curve_straight_mm` | `Reverse curve straight` | 305 | 12 in |
| `elevation_step_hundredths_mm` | `Elevation step` | 1905 | 3/4 in |
| `display_units` | `Inches` or `Millimetres` radio | `in` | `in` or `mm` |

Inch display rounds to the nearest eighth of an inch and reduces the fraction, for example `42 in` and `3/4 in`. Millimetre display is the integer followed by ` mm`.

Standards spinbuttons: every length field (`Single endplate`, `Double endplate`, `Double track offset`, `End straight`, `Minimum radius`, `Reverse curve straight`, `Elevation step`) shows and accepts decimal inches in Inches mode (for example `42`, `0.75`) and whole millimetres in Millimetres mode, except `Elevation step`, which accepts up to two decimals of a millimetre in Millimetres mode (for example `19.05`). `Maximum grade` always shows and accepts percent with one decimal (`2.0`), stored as tenths of a percent (20). `Minimum turnout` is a whole frog number. Saved values are converted and rounded to the nearest stored unit: millimetres, hundredths of a millimetre for the elevation step (so `0.75` in or `19.05` mm saves 1905), tenths of a percent for grade.

**Piece rules** are checked on append and on piece edit. A failure answers 422 with code `validation_failed`, message `This piece breaks the club standard.` and `findings`, and nothing is stored. The limit value itself is allowed.

| Rule | Fails when | Finding message |
|---|---|---|
| `min_radius` | A `mainline` curve has radius under the minimum | `Curve radius <measured> is under the <limit> minimum.` |
| `max_grade` | `abs(rise_mm) × 1000` is greater than `max_grade_tenths_percent × length_mm` | `Grade <measured>% is over the <limit>% maximum.` |
| `min_turnout` | Frog number under the minimum | `Turnout #<measured> is under the #<limit> minimum.` |
| `reverse_curve` | A curve follows a curve of the other hand with less straight between them than the minimum | `Only <measured> of straight between reverse curves; <limit> needed.` |

**Module rules** are checked by Check layout and by Validate.

| Rule | Fails when | Finding message |
|---|---|---|
| `endplate_width` | An endplate is not exactly the profile width for its type | `Endplate <end> is <measured>; the standard is <limit>.` |
| `track_centred` | A single endplate's offset is not 0, or a double endplate's offsets are not the negative and positive profile offset | `Track at endplate <end> is off-centre by <measured>.` |
| `end_straight` | The first or last run of a module is not straight and level for the profile distance | `Only <measured> straight and level at end <end>; <limit> needed.` |
| `elevation_step` | The difference between a module's first and last elevation is more than 1 mm from every whole multiple of the elevation step (1 mm itself is allowed) | `Elevation change <measured> is not a multiple of <limit>.` |
| `unassigned_block` | A piece has no block | `Piece <piece id> has no block.` |
| `empty_module` | A module has no pieces | `Module <module name> has no track.` |

Each finding is `{"rule","module_id","piece_id","measured_mm","limit_mm","message"}`, with `measured_mm` and `limit_mm` in the rule's own integer unit: tenths of a percent for grade, the frog number for turnouts, and hundredths of a millimetre for `elevation_step` (so the default `limit_mm` is 1905 and a 40 mm change measures 4000). Measured grade in tenths is `abs(rise_mm) × 1000 ÷ length_mm` rounded to the nearest integer, halves up; for example 40 mm over 305 mm is 131. In `message`, `<measured>%` and `<limit>%` for grade print the tenths divided by 10 with exactly one decimal (`13.1%`, `2.0%`). Other lengths in `message` follow the profile's display units.

**Open ends.** When an append names an open end that another piece has consumed, the loser gets 409 with code `open_end_taken`, message `Open end <label> was just extended by <display name>. Nothing was changed.` and `piece_id`. This takes the place of `stale_revision` at step 5. A stale revision with the end still open answers `stale_revision`.

**Layout version states.** The working copy is the shared editable layout.
- Save version snapshots it as the next number in state `Draft`.
- Draft moves to Validated by Validate with no findings; a failed Validate stays Draft.
- Validated moves to Published by Publish.
- Any other move answers 422 `version_transition` `A <state> version cannot do that.`
- Saved versions never change.
- Restore creates a new version numbered next, in state `Draft`, with `restored_from` set, the same `canonical_hash` as its source, and the working copy replaced by the same content. Open sessions and their names do not change.

**Trash and purge.** Trash removes a module and its blocks from the working copy, and undo returns them so `working_hash` equals its value before the trash. Purge removes the module from the Trash sheet, the working copy, block search and every count in `L`, and turns each history row about it into `{"action":"purged","object_id":null}`, shown as `Purged module`. Saved versions are the club's fixed record and still contain it, so its name stays in those versions only.

**Rename.** Block and station ids are permanent.
- A rename updates the working copy and every non-Ended session of that layout in one commit, with a `name.changed` event on each stream.
- Saved versions keep their names, and Ended sessions keep the names they ended with.
- Packets in Queued or Rendering render with the new name, and `S/packets/preview` shows it.
- Ready packets of those sessions become Superseded with their PDF unchanged.
- History records `{"actor","at","action":"block.renamed" or "station.renamed","object_id","from","to"}`.

Every working-copy change writes one history row.

**Session states.** A session is pinned at creation to one Published version and its timetable version. Later edits, versions and restores never touch its track, blocks, trains or timetable; only renames reach it. `ratio` is an integer from 1 to 12, default 6.

| From | Command or cause | To |
|---|---|---|
| Scheduled | Start | Running |
| Running | Hold | Held, `hold_reason` `operator` |
| Running | Valkey unreachable | Held, `hold_reason` `valkey` |
| Held (`operator`) | Resume | Running |
| Held (`valkey`) | Valkey returns | Running, automatically |
| Running | No lease holder for 5,000 ms | Interrupted |
| Interrupted | Resume | Running |
| Running, Held, Interrupted | End | Ended |

Every other command answers 422 `session_transition` `A <status> session cannot do that.` with nothing changed. This includes Resume on a Held session whose reason is `valkey`. Resume restores positions, authorities, timetable progress, speed remainders and the fast clock from the last committed tick, and the next tick has the next number. Of two simultaneous Resume presses, one acts and the other gets `stale_revision`.

Train, authority, block and turnout commands are legal in Running and Held and otherwise answer 422 `session_not_active` `This session is not running.`

**Clock.** One tick commits per 1,000 ms of Running time. `fast_clock_seconds` equals `tick × ratio`, and `fast_clock_label` is that value as `HH:MM:SS`. Held and Interrupted time adds no ticks. Browsers display these values and never compute, advance or expire anything from their own clock, which may be wrong by any amount.

**Ticks.** Ticks are numbered from 1 with no gap. Each commits train positions, occupancy, counters and one outbox row in one Postgres transaction. A tick reaches a browser only after that commit. In each tick, in order: trains advance, occupancy and blocks given back are derived, timetable arrivals are recorded, authorities that reached their limit end, authorities that expired are revoked, and the wait-for graph is checked.

**Scale speed.** HO is 1:87.1. Per train per tick, `total = speed_mph × 16093440 + carry`, `advance = floor(total / 3135600)`, `carry = total mod 3135600`. `carry` starts at 0 and survives holds, takeovers and resumes. For example, 40 mph advances 205, 205, 205, then 206 mm. `distance_run_mm` is the sum of advances actually run. A train stops at the end of its last granted block and its advance is cut to that point. Trains move only while holding a Granted authority.

**Occupancy.** A train's `head_offset_mm` is measured from the entry end of its head block in its direction of travel. `trail_block_ids` lists the blocks the train has passed through, newest first, beginning with the head block. A train occupies a block when any positive length of the train lies in it, walking back `length_mm` from the head along the trail.

Block `state` is decided in this order: `out_of_service`, `occupied`, `reserved` (in a Granted authority's `remaining_block_ids`), then `free`.

**Counters** are recounted in the same commit: `occupied_blocks` counts occupied and out-of-service blocks, `reserved_blocks` the reserved ones, `free_blocks` the free ones, and the three always sum to the block total. `trains` counts session trains. `open_conflicts` counts conflicts in state `Open`.

**Authority states.** `Requested` moves in the same commit to `Granted` or `Refused`, then a Granted authority ends as `Released` or `Revoked`.
- A Highball finds the shortest route ahead of the train in its direction, in millimetres. It passes through `via_block_id` when given; ties take the lower block numbers. Trains never reverse under an authority.
- An authority covers 1 to 8 blocks, starting with the block ahead of the head block, ending at the destination.
- Default `time_limit_fast_seconds` is 3600, allowed range 6 to 43200, and `expires_fast_seconds` is the grant's fast-clock time plus the limit.
- A train with a Granted authority answers 422 `authority_active` `Train <number> already has the road.`
- No path answers 422 `no_route` `There is no road from here to <block>.`
- More than 8 blocks answers 422 `route_too_long` `That road is more than 8 blocks. Choose a nearer destination.`
- A route with any block not free, or a turnout locked the other way, is wholly refused. The first such block in route order is the conflict block and no block is held.
- A refusal commits an authority in state `Refused` and an open conflict naming the other train, or no train for an out-of-service block.
- Requests are decided one at a time against committed state, so of simultaneous requests over a block exactly one is granted and every other gets `route_conflict`.

**Ending an authority.**
- It is `Released` when its train's head reaches the end of the limit block (`ended_reason` `completed`), or on Cancel (`cancelled`).
- It is `Revoked` when its fast-clock limit is reached (`expired`), or by Back to loop or Recall (`moved`).
- Expiry happens on the committed tick where `fast_clock_seconds` is at or past `expires_fast_seconds`. The train stops where it stands and blocks ahead of it are freed.
- Expiry ignores the approach rule.
- Cancel while the train's head stands in a block of kind `approach` answers 422 `approach_locked` `Train <number> is on the approach. The authority cannot be cancelled.`
- Cancel on an ended authority answers 422 `authority_ended` `That authority has already ended.`
- Granted blocks are given back as the tail clears them.

**Turnouts.** A granted route sets and locks each turnout on it. A turnout unlocks on the tick the tail has cleared every granted block touching it, or when the authority ends. Throwing a locked turnout answers 422 `turnout_locked` `Turnout <id> is locked by Train <number>.`

**Out of service.** Only a free block can be taken out of service; otherwise 422 `block_in_use` `<block> is in use.`

**Conflicts.**
- A conflict is `Open` until the requester's next Highball is granted, it is withdrawn, or Back to loop or Recall moves either of its trains; it is then `Closed`.
- A note can be saved while it is open.
- A train with an open conflict in an open deadlock cannot Highball or Withdraw: 422 `deadlock_open` `Trains <numbers> are deadlocked. Use Back to loop or Recall.`

**Deadlock.** The wait-for graph has one edge from each open conflict's train to its other train. On the tick a cycle first appears, the server commits one deadlock in state `Open`, naming every member, with `raised_at_tick`. It is raised only by a committed tick, so a Held session raises it on the first tick after it resumes. Only Back to loop or Recall on a member clears it (state `Cleared`).

**Back to loop** moves the train in that command's commit to the free block of kind `loop` with the fewest blocks between it and the train's head block, ties to the lower number, head at the block's far end in the train's direction, trail reset to that block. With none free it answers 422 `no_free_loop` `No loop is free for Train <number>.`

**Recall** moves the train the same way to its session start block and offset; if that block is not free it answers 422 `recall_blocked` `<block> is not free.`

Both revoke the train's authority, close every open conflict involving the train, and clear any open deadlock containing it. A train never needs a route to get there: these are dispatcher moves and appear on commit.

**Extra train.** Legal in Scheduled, Running and Held; otherwise `session_transition`. `length_mm` runs from 300 to 2400 inclusive, `speed_mph` from 5 to 60 inclusive, `direction` is `east` or `west`, and `number` is unique in the session. The start block must be free, or 422 `block_in_use`. The head starts at the block's far end. Session version rises, and Ready packets become Superseded and Failed packets stay Failed.

**Timetable.** Saving takes the next unused timetable version number on the layout. Every entry names a train and station in the content, and `depart_fast_seconds` is a whole number from 0 to 86399, or 422 `invalid_fields`. `arrived_fast_seconds` is set on the tick a train's head first enters a block of that station.

**Crew packets.**
- Issue answers 202 with a `Queued` packet, then the server moves it to `Rendering`, and to `Ready` or `Failed` within 25 seconds.
- Content is built at render time from the session version and current names.
- `Ready` is committed only after Gotenberg has returned bytes and Valkey answers a check, in one Postgres transaction with the bytes, `content_hash` and the outbox row.
- If Gotenberg fails or takes over 20 seconds, the packet is `Failed` with `failure` `gotenberg_unreachable`. If Valkey does not answer, it is `Failed` with `valkey_unreachable`. Either way it has no bytes and no `Ready` event.
- A new Issue with a new key makes a new packet; a Failed packet is never retried by itself.
- `Ready` becomes `Superseded` on a rename reaching the session or an extra train, with the stored bytes unchanged and still downloadable. A packet that never had bytes answers `packet_no_pdf`.
- `content_hash` is the SHA-256 hex of the canonical JSON of `{"session_version","content"}`, using the canonical form above.

**Sign-in expiry.** A browser session ends after `SESSION_IDLE_SECONDS` of no requests (default 1800, which is 30 minutes). Expired requests answer 401. Each signed-in request renews the period.

### Services (DP-28, DP-38, DP-42, DP-44, DP-45, DP-47, DP-48)

**Postgres** is the system of record for all data in this brief, including idempotency records and packet bytes. These tables and columns exist exactly; anything else is free.
- `session_ticks(session_id text, tick bigint, revision bigint, positions jsonb, counters jsonb, committed_at timestamptz)`, unique on session and tick. Each tick row's `revision` equals the `seq` of its one `event_outbox` row on that session's stream, and that row's `payload.detail.tick` equals the tick.
- `event_outbox(stream text, seq bigint, type text, payload jsonb, published_at timestamptz)`, unique on stream and seq.
- `crew_packets(id text, session_id text, state text, content_hash text, pdf_bytes bytea)`.
- `layout_versions(id text, layout_id text, number integer, state text, canonical_hash text, content jsonb)`.

Everything survives an instance restart. Schema and seed apply idempotently on every serve, safely with instances starting together, and an empty database receives the seed.

**Valkey Streams.** Every committed session change and layout change is written first to the outbox, then to its stream in commit order, with the explicit entry ID `<seq>-0` and the fields `type` and `payload`.
- Session streams are `gandyboard:session:<session_id>:events`, where `seq` equals session `revision`.
- Layout streams are `gandyboard:layout:<layout_id>:events`, where `seq` equals `layout.revision`.
- Each stream keeps the latest 2,000 events: once that many exist, its length stays between 2,000 and 2,100.
- Each instance reads with its own XREAD cursor and forwards to its browsers. No browser event comes from any other path, including when both ends are on one instance.

**Event streams to browsers** are `GET S/events` and `GET L/events`, as `text/event-stream`, each message carrying `id: <seq>`, `event: <type>` and `data: <JSON>`, with a comment line at least every 15 seconds. Reconnection sends `Last-Event-ID`, or `?last_event_id=<seq>`, and missed events replay in order from the stream. If the requested sequence is older than the stream holds, the server sends one `event: resync` with `{"reason":"replay_aged_out"}` and carries on live, and the browser fetches a snapshot.

- Session event data is `{"seq","type","session":<snapshot>,"detail":{...}}`.
- Layout event data is `{"seq","type","actor","layout":{"revision","working_hash","counts"},"detail":{...}}`.
- Every committed change writes exactly one event.
- Each commit carries one revision and therefore one event, whose type follows its cause. A tick is always `tick.committed`, and everything it did rides in `detail` as `arrivals`, `authorities_released`, `authorities_revoked` (each with its `ended_reason`) and `deadlocks_raised`; the browser's expiry and deadlock announcements come from those lists. Commands use: Highball granted `authority.granted`; Highball refused `authority.refused` (its `detail` holds the opened conflict); Cancel `authority.released`; Back to loop and Recall `train.moved` (its `detail` lists the revoked authority, closed conflicts and cleared deadlocks); Withdraw `conflict.closed`; Start, Hold, Resume, End and automatic holds `session.status`; extra train `session.version`; block service `block.changed`; turnout throw `turnout.changed`; packet state change `packet.changed`; rename `name.changed`. A note save writes `conflict.changed`. No other session types exist.
- Layout types follow the same dotted form, with `piece.added`, `piece.changed`, `piece.removed`, `module.changed`, `version.changed`, `timetable.changed` and `name.changed`.

**Browser order.** The browser applies events strictly by `seq`, ignores any `seq` it has applied, and on a gap fetches `GET S` or `GET L` and carries on from that snapshot's revision.

**Tick lease.** For each Running session, the key `gandyboard:session:<session_id>:tick-lease` holds the holder's instance id with an expiry of 3,000 ms, renewed each tick. Only the holder commits ticks. When the holder dies, a surviving instance takes over within 5,000 ms of its death and continues from the last committed tick, never repeating or skipping one. If there is no holder for 5,000 ms because no instance could take it, the first instance able to act records Interrupted at the last committed tick.

**Valkey down.**
- Instances notice within 3 seconds, and Running sessions move to Held with `hold_reason` `valkey`.
- Session commands answer the 503 from the error order. Issue packet is the exception: it is accepted and ends Failed as published.
- Layout writes still commit, and their events wait in the outbox.
- `GET S/events` and `GET L/events` answer 503.
- Reads work, and `/api/status` reads `"valkey":"down"`.
- The app reconnects with at most 2 seconds between tries. Within 5 seconds of Valkey answering, outbox events are delivered in order and sessions held for that reason return to Running at the next tick.

**Gotenberg.** Each packet is rendered by `POST $GOTENBERG_URL/forms/chromium/convert/html` from one HTML document with the headings `Timetable`, `Train orders`, `Block table` and `Track diagram`.
- `Timetable`: a row per entry with time, train and station name.
- `Train orders`: one line per train reading `Train <number> <name>: run <direction> from <first station> to <last station>, departing <HH:MM:SS>.`
- `Block table`: number, name, kind and length per block.
- `Track diagram`: a drawn diagram of the blocks.
- Every page prints `Session version <n> | Content hash <hash>`.

Down at boot or at render, the packet ends Failed as published, `/api/status` reads `"gotenberg":"down"` and the Crew packets sheet shows the published notice. The next render after Gotenberg returns succeeds with no restart. Status is probed at most every 5 seconds.

### Seed data (DP-01, DP-02, DP-16, DP-19, DP-23)

Every seeded person, club and business is invented. All seeded passwords are `gandyboard-demo-1`.

**People**

| Display name | Email | Role | Workspaces | Walkthrough done |
|---|---|---|---|---|
| Founder Fishplate | `founder@fishplate.example` | `founder` | All | yes |
| Morgan Tarn | `manager@tarnvalley.example` | `manager` | `tarn-valley` | yes |
| Robin Tarn | `member@tarnvalley.example` | `member` | `tarn-valley` | yes |
| Sam Tarn | `member2@tarnvalley.example` | `member` | `tarn-valley` | yes |
| Alex Tarn | `operator@tarnvalley.example` | `operator` | `tarn-valley` | yes |
| Jo Tarn | `operator2@tarnvalley.example` | `operator` | `tarn-valley` | yes |
| Riley Tarn | `newmember@tarnvalley.example` | `member` | `tarn-valley` | no |
| Casey Marsh | `manager@saltmarsh.example` | `manager` | `saltmarsh` | yes |
| Dale Marsh | `operator@saltmarsh.example` | `operator` | `saltmarsh` | yes |

**Workspaces.** `tarn-valley` (Tarn Valley Model Railway Club) has layout `tarn-main` (Tarn Valley Main Line). `saltmarsh` (Saltmarsh Modular Group) has layout `saltmarsh-branch` (Saltmarsh Branch). Both layouts use the reference layout below, as does the `reference` workspace template, which creates one layout whose version 1 is Published with no sessions and only the founder as member. The `empty` template creates one empty layout and no versions.

**Reference layout.** Five modules: `mod-wren` (Wren Quay), `mod-west` (Single Line West), `mod-fernhill` (Fernhill), `mod-east` (Single Line East), `mod-tarn` (Tarn Head). All have single endplates. The pieces are yours to shape, with some curves so the stage is not a straight line, provided each block's piece lengths add up to its length below and the content passes every rule in the default profile. Block ids are `blk-01` to `blk-12`.

| Number | Name | Kind | Length (mm) | Module | Neighbours |
|---|---|---|---|---|---|
| 1 | Wren Quay Road | plain | 3000 | `mod-wren` | 3 |
| 2 | Wren Quay Loop | loop | 3000 | `mod-wren` | 3 |
| 3 | Wren Approach | approach | 1500 | `mod-wren` | 1, 2, 4 |
| 4 | Single Line West | plain | 4000 | `mod-west` | 3, 5 |
| 5 | Fernhill West Approach | approach | 1500 | `mod-fernhill` | 4, 6, 7 |
| 6 | Fernhill Main | plain | 3000 | `mod-fernhill` | 5, 8 |
| 7 | Fernhill Loop | loop | 3000 | `mod-fernhill` | 5, 8 |
| 8 | Fernhill East Approach | approach | 1500 | `mod-fernhill` | 6, 7, 9 |
| 9 | Single Line East | plain | 4000 | `mod-east` | 8, 10 |
| 10 | Tarn Approach | approach | 1500 | `mod-tarn` | 9, 11, 12 |
| 11 | Tarn Head Road | plain | 3000 | `mod-tarn` | 10 |
| 12 | Tarn Head Loop | loop | 3000 | `mod-tarn` | 10 |

East means increasing through 3, 4, 5, the Fernhill blocks, 8, 9, 10, to 11 or 12.

**Turnouts** (stem, normal, reverse): `T1` (3, 1, 2), `T2` (5, 6, 7), `T3` (8, 6, 7), `T4` (10, 11, 12).

**Stations:** `st-wren` Wren Quay (blocks 1, 2), `st-fernhill` Fernhill (6, 7), `st-tarn` Tarn Head (11, 12).

**Trains**

| Id | Number | Name | Direction | Speed (mph) | Length (mm) | Start block | Head offset (mm) |
|---|---|---|---|---|---|---|---|
| `t101` | 101 | Wren Quay Pickup | east | 40 | 1200 | 1 | 2800 |
| `t202` | 202 | Tarn Head Mixed | west | 40 | 1200 | 11 | 2800 |
| `t303` | 303 | Fernhill Shuttle | east | 25 | 900 | 2 | 2800 |

**Timetable** (`depart_fast_seconds`):

| Entry | Train | Station | Depart |
|---|---|---|---|
| `tt-1` | `t101` | `st-wren` | 720 |
| `tt-2` | `t101` | `st-fernhill` | 1500 |
| `tt-3` | `t101` | `st-tarn` | 2400 |
| `tt-4` | `t202` | `st-tarn` | 720 |
| `tt-5` | `t202` | `st-fernhill` | 1500 |
| `tt-6` | `t202` | `st-wren` | 2400 |
| `tt-7` | `t303` | `st-wren` | 900 |
| `tt-8` | `t303` | `st-fernhill` | 1800 |

**Versions.** `tarn-main` has versions 1 to 12, all Published, labelled `Issue <n>`, each with timetable version equal to its number. Version 12 is exactly the reference layout. Each version `n` from 1 to 11 differs only in `tt-1`'s depart value, which is `n × 60`. `saltmarsh-branch` has version 1, Published. The working copy of each equals its newest version.

**Sessions.**
- `thursday-running`, in `tarn-valley`: on version 12, Scheduled, ratio 6.
- `tarn-shakedown`, in `tarn-valley`: on version 12, Running from tick 0, ratio 6.
- `saltmarsh-rehearsal`, in `saltmarsh`: on version 1, Running from tick 0, ratio 6.

There are no authorities, conflicts or packets at start.

## Technical requirements

### Deployment (DP-50)

Backend: TypeScript on Node 22. Frontend: TypeScript built with Node 22 using React, Vite and three.js.

Node 22 with npm is the runtime. `/app/run.json` holds string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

`serve` binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT` when set, and returns `{"status":"ok"}` with HTTP 200 from `/api/health`.

The product always runs as at least two app instances behind one origin. `serve` starts a front router on the public port and instances `a` and `b` on internal ports that cannot collide when several copies run on one host. Every response carries `X-Gandyboard-Instance: <id>`. Requests with no routing header alternate between live instances. A request carrying `X-Gandyboard-Route: <id>` goes to that instance, or answers the 503 `instances_restarting` when it is down. The router holds no product state. If an instance process exits it restarts.

### Configuration and secrets (DP-50, DP-60)

Read at start, never hard-coded and never sent to the browser: `DATABASE_URL`, `VALKEY_URL`, `GOTENBERG_URL`. Also read `APP_PUBLIC_PORT`, and `SESSION_IDLE_SECONDS` (default 1800).

### Server boundary (DP-03, DP-47, DP-48, DP-50)

The browser talks only to its own origin. It never contacts Postgres, Valkey or Gotenberg, and no fonts or scripts load from elsewhere.

- Request bodies may be up to 1,000,000 bytes, with that size allowed. A larger body answers 413 `body_too_large` `That request is too large.`
- Malformed JSON answers 400 `bad_json` `That request could not be read.`
- A write with another content type answers 415 `bad_content_type` `Send JSON.`
- These three come before the error order.
- The server serves only the built frontend and the API, never source files, manifests, environment files or credentials.

Nothing about a request lives in process or module scope: identity, workspace and event subscriptions belong to each request.

The app starts and answers health with Valkey or Gotenberg unreachable at boot. Postgres is required, and boot waits for it.

### Browser support and performance (DP-51, DP-54)

Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, with touch on phones and tablets. The loading screen appears within one second, and the stage is usable within five seconds on a laptop. A committed tick reaches the screen within one second of its commit.

## Working rules

- **IF-01** `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`.
- **IF-02** `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package and both typefaces with its licence; shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- **IF-03** Shipped packages use only MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC or, for fonts, OFL-1.1 licences.
- **IF-04** The only datastores are Postgres and Valkey: no SQLite, file-based store or in-memory product state shared between instances.
- **IF-05** Every font, script and model ships from the app's own origin, with no CDN at runtime.
- **IF-06** No credential or service URL appears in committed files, in the built frontend or in any browser response.
- **IF-07** All 3D models, glyphs, line art and the wordmark are made for this product by code or as new SVG, with no third-party artwork.

## Engineering standards

- The code is idiomatic strict TypeScript, with no `any` on domain data.
- Names match the domain terms in this brief: block, authority, tick, open end, session version, crew packet.
- Each domain rule, such as a state transition, a geometry check, the occupancy derivation, a counter or the scale-speed formula, is decided in exactly one place in the source.
- No abstraction exists with a single implementation.
- No dead, commented-out or unreachable code remains, and there are no defensive checks for impossible states.
- Every API error comes from one consistent error shape and one ordering of checks.
- Browser state derives from server events and snapshots, and no client code computes occupancy, expiry or the fast clock.
- No features exist beyond this brief.
