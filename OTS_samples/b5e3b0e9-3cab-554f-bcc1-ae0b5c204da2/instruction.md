# Niner Hall Runup Bay

Runup Bay is a browser-based aerodrome control exercise for small flight-training and air traffic control schools. An instructor sets up a school and classes, imports fictional airfields, builds timed traffic and runs a live exercise from a console. Two students work the Ground and Tower positions on electronic flight-strip boards with typed clearances, and every run ends in a scored debrief and a lasting training record. The backend uses Postgres for all state, MinIO for imported layout files and exported reports, and Mailpit for verification, invitation and report notice mail. It is a training simulation, never for real air traffic control. Out of scope: voice input, an approach radar, 3D views, payments, AI feedback, multi-runway operations, outside sign-in, real charts, real traffic, external assets or fonts, and any datastore, queue, cache or PDF service beyond those named here.

## Problem and users

A founder-instructor running a small school has no affordable middle ground for aerodrome control practice. Institutional tower simulators are quote-priced installations with dedicated controller, pseudo-pilot and instructor stations. Browser practice tools are solo products with no instructor, no school, no flight strips and no lasting record. So these schools use paper strips on a table, an instructor reading out traffic, and scores in a spreadsheet. The instructor spends hours replaying from memory who was cleared where and when. The student gets a few supervised runs and a debrief that cannot show the second a wake interval was broken. The school has only loose notes when it must produce detailed training records for an authority or hand a transferring student their record.

Runup Bay gives the school one server-timed exercise that several browsers share.

- **Instructor** (daily): sets up the school and classes, invites students, imports fictional airfields, builds timed traffic, runs an exercise from the console, injects events at the moment that teaches most, and reads the scored debrief.
- **Student** (daily): works a Ground or Tower position by moving strips, typing clearances and handing aircraft over, then reads their score and debrief in their record.

## Journeys

1. **Opening a class.** A verified instructor with an empty class invites a student by email. The student opens the mail, joins and lands on the class page. The instructor imports a layout, fixes the faults the import lists, sees the map, builds a scenario and assigns it. The class page ends showing the student and the assignment.
2. **Working Ground.** A Ground student opens a fresh exercise with strips in Pending. By keyboard alone they push an aircraft, taxi it and offer it to Tower. They watch it move along its route, while the Tower student and the instructor see the same strip and aircraft change live. The end state is a strip in Hand-off with an open offer.
3. **Seeing the taxi before sending it.** A Ground student types a taxi clearance. The route lights segment by segment on the map as they type, a stop bar drops at the holding point, and a conflicting segment turns hatched with its rule shown. They correct it or send it. The route stays lit and goes dark behind the aircraft.
4. **Working Tower.** A Tower student accepts an offered strip, lines the aircraft up and clears it for takeoff, watching the wake timer and any arrival's Due timer. A clearance given too early is accepted, alerted and penalised. The end state is a strip in Departed and a row in the alert list on all three screens.
5. **Running events.** An instructor on a phone pauses the exercise, resumes it, changes speed, closes and reopens the runway, changes the wind, orders a go-around and declares an emergency, all by touch. Both students' boards change at once, and each student's half-typed line stays as it was.
6. **Catching a wrong readback.** A student sends a clearance and the readback comes back wrong. They correct it with `NEGATIVE` inside the time allowed, or the clock raises an alert. The end state is a corrected or alerted exercise log.
7. **Reading the debrief.** When an exercise ends, every client offers the debrief. The instructor opens it at its published address, reads the score, the breakdown and the timeline, and scrubs the replay second by second to the moment a rule was broken.
8. **Keeping the record.** A student opens their own record and sees attempts, best score and status for each assignment. They export the debrief as CSV and PDF, and receive a notice once the file is stored. A classmate's record address answers not found.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Accounts, schools and classes.** A person signs up and must open the emailed verification link before signing in, and a verified instructor creates a school and classes and lands on the class page.
- **DP-02 — Class invitations.** An instructor sends invitations from the class page, and an address counts as invited only after Mailpit accepts its mail.
- **DP-03 — Joining a class.** A student opening a live invitation joins and lands on the class page at its published address, which survives a reload, and an expired or used invitation shows its published text instead.
- **DP-04 — Layout import refusals.** A layout file is judged only by its content, and an oversized or faulty file is refused with its published lines and nothing is kept.
- **DP-05 — Stored layouts.** A valid layout is stored byte for byte, opens a map carrying every published object id, and `Download original` returns exactly the submitted bytes.
- **DP-06 — Scenario editor.** An instructor builds timed traffic in the scenario editor, and a repeated callsign or a stand that is not on the aerodrome is refused with the published text.
- **DP-07 — School boundaries.** All data stays inside one school, and another school's class, scenario, aerodrome or session answers not found.
- **DP-08 — Flight strips.** Each strip sits in its published bay list with the published attributes, the exact accessible label and DEP or ARR in written text.
- **DP-09 — Pre-filled clearances.** Dropping or pushing a strip toward a bay that takes a clearance changes nothing until the pre-filled command is accepted, and focus then returns to that strip in its new bay.
- **DP-10 — Pending and refused moves.** A strip waiting for the server is marked pending in its old bay, and a refused move leaves it there with the reason shown and no second copy.
- **DP-11 — Taxi movement.** Aircraft move along their routes by the published metres per tick and match the worked example on every client.
- **DP-12 — Live shared boards.** Boards, map and console on every client change in place as the server pushes each update, with no reload and no scroll jump.
- **DP-13 — Drag and shortcut moves.** A mouse or one-finger drag has the same effect as the keyboard move, and the `/` key focuses the command line from anywhere on the board.
- **DP-14 — Command grammar.** Every published command, in any letter case and spacing, has its published position, allowed states, exact readback and effect.
- **DP-15 — Ordered refusals.** A command failing a check is refused with the exact text of the first failing check, the field is marked invalid, the text stays, and nothing is logged or changed.
- **DP-16 — Callsign completion and history.** Tab completes and cycles callsigns on the seat's frequency, and Up and Down walk the last 50 sent lines, also after a reload.
- **DP-17 — Drafts survive updates.** A half-typed command, a half-filled event form, a shown refusal and focus all survive ticks and pushed updates.
- **DP-18 — Handoff offers.** `CONTACT TOWER` opens an offer shown on both boards with its timer, while the aircraft stays on Ground frequency and keeps moving.
- **DP-19 — Handoff acceptance and recall.** Tower accepts an offered strip or Ground recalls it while the offer is open, and each leaves exactly the published copies, labels and log rows.
- **DP-20 — Handoff timing alerts.** An offer that runs out and a departure stopping at its holding point on Ground frequency each raise their published R6 alert, as qualified in Business rules.
- **DP-21 — Strip version conflicts.** When two seats act on the same strip version the server's order decides, exactly one wins, and the loser sees the published notice and the strip as the server has it.
- **DP-22 — Server-counted strip timers.** Wake, offer, due and slot timers show only the server's values, so pausing, reloading or a wrong device clock cannot move them.
- **DP-23 — Wake spacing rule.** A takeoff clearance inside the published wake minimum is accepted, raises the exact R2 alert and combines with R1 and R3 in the published order.
- **DP-24 — Alert list and announcements.** Every alert appears in the alert list for both seats and the instructor, and its text is announced only in the live region published for its rule.
- **DP-25 — Arrival spacing rule.** A line-up or takeoff clearance inside the arrival protection window is accepted and raises the exact R3 alert, with the limit itself alerting and one second above it not.
- **DP-26 — Landing sequence.** A cleared arrival stays in Arrivals showing its clearance, lands when `Due` reaches zero and moves to Landed by itself on `vacated`.
- **DP-27 — Go-arounds.** An injected event, a typed command or an uncleared arrival reaching the threshold each send the arrival around with the published strip state, live on the Tower board with focus kept.
- **DP-28 — Centreline Run preview.** As the student types, the strip and aircraft symbol are marked and the route preview list names the same segments in the same order as the parsed route.
- **DP-29 — Lit run timing.** Route segments light one at a time at the published interval, the stop bar follows the last segment, the run retracts when the route shrinks, and reduced motion reaches each end state in one frame.
- **DP-30 — Taxi conflict preview.** A segment that would raise R4 shows hatched with its rule ID in the preview list, and sending the clearance raises the exact R4 alert on all clients.
- **DP-31 — Latest text wins.** Only the reply for the latest command line text is ever shown, and a slower reply for earlier text never repaints the lit route.
- **DP-32 — Accepted route goes dark.** An accepted taxi route stays lit for that seat and each segment goes dark for good as the aircraft leaves it, while a refused one retracts.
- **DP-33 — Runway incursion.** An `overrunsHold` departure reaching its holding point raises R5 on that tick, occupies the runway, and a later clearance raises R1 against it.
- **DP-34 — Incursion effects.** An incursion flashes the board for the published time, and reduced motion swaps every flash and pulse for the static outline with the same announcements.
- **DP-35 — Seeded readback errors.** The published formula decides which eligible readbacks carry an error and what the error says, while the aircraft still follows the real clearance.
- **DP-36 — Readback correction.** A correct `NEGATIVE` inside the published window closes a readback error, and an error left open raises R7 on the published tick.
- **DP-37 — Repeatable exercises.** The same scenario, seed and commands at the same sim times give an identical log, breakdown and score.
- **DP-38 — Instructor console.** The instructor's console shows both boards, the map, alerts and every control, and on a phone it follows the published tabs with touch-sized controls.
- **DP-39 — Pause and speed.** Pause stops the sim clock and refuses commands and moves on every client at once, and Resume and the speed radios take effect the same way.
- **DP-40 — Runway closure.** A closure shows the published notice on every client and later clearances are accepted with R8, until a reopen clears it.
- **DP-41 — Wind change.** A wind change that favours the other threshold counts down the published notice on each tick, then moves the runway in use, arrival strips and pre-filled clearances.
- **DP-42 — Emergency.** An emergency stops every other taxiing aircraft, marks the strip and symbol, and refuses the published commands until it ends and aircraft are told to continue.
- **DP-43 — Instructor-only actions.** A student calling an instructor route or a seat they do not hold is answered not found and the exercise does not change.
- **DP-44 — Seats and reconnection.** Students take free seats, a taken seat is refused, and a disconnected seat holder returns to the same seat within the grace period, as qualified in Business rules.
- **DP-45 — Debrief address.** Finishing an exercise offers `Open debrief` on every client, which lands on the published address, and a reload shows the same screen.
- **DP-46 — Score, breakdown and timeline.** The debrief shows the score, result, breakdown and every timeline row, all derived once from the log with the published penalties.
- **DP-47 — Replay.** The replay slider moves by the published keys and shows the map, mirror and current timeline row of that exact sim second, snapping with no animation.
- **DP-48 — Student record.** A student's record shows attempts, best score, status and timing for each assignment, with late attempts listed but never setting the best score or status.
- **DP-49 — Record privacy.** A student opens only their own record and the debriefs and reports of exercises they sat in, while the class's instructor sees all of them.
- **DP-50 — CSV and PDF reports.** A finished exercise exports to the published CSV and PDF formats.
- **DP-51 — Report storage and notices.** A report is answered only after MinIO confirms the object, a repeat export returns the stored bytes, and one notice per file kind reaches Mailpit.
- **DP-52 — Storage outage.** With MinIO unreachable an export gives the published alert with no file and no notice, while the rest of the app and the health route keep working.
- **DP-53 — Layout modes.** Student and console pages use the published layout at each published width and never scroll sideways.
- **DP-54 — Focus, dialogs and accessibility.** Focus is always visible, a board is one tab stop with the published arrow keys, dialogs keep Tab inside and return focus, and the board, console and debrief pass an automated accessibility scan.
- **DP-55 — Motion.** Strip, aircraft, alert and offer motion runs for the published times with the published markers, and reduced motion shows each end state at once with the same function.
- **DP-56 — Training-only notice.** Every page shows the published notice in its footer landmark.
- **DP-57 — Health and public config.** The health route answers ok in every instance, and the config route reports today, the time zone, the clock mode and every timer as read from the environment.
- **DP-58 — Grading routes.** The published grading routes build people, scenarios and sessions, advance the clock and hold updates, and answer not found without the right key.
- **DP-59 — Landing page.** The signed-out landing page follows the published grid hero, second screen and closing sheet in one pink and one burgundy.
- **DP-60 — Working screens.** Boards, map, tables, forms, empty states and error states keep the guide grid and tell every state apart by shape, hatch, inversion and written words, never by a second hue.
- **DP-61 — Source integrity.** Only the server keeps the sim clock and every piece of state, one rule engine and one grammar drive preview, execution, alerts and scores, and credentials come only from the environment.

## Frontend

### Screens and layout (DP-38, DP-53, DP-59, DP-60)

Pages, each with no sideways scroll at 375x812, 768x1024 and 1280x800:

| Route | Who | What it shows |
|---|---|---|
| `/` | signed out | The landing page from Visual design, with the sign-in form on its closing sheet |
| `/` | signed in | Heading `Your classes`, `list "Classes"` of links; for an instructor also `link "Aerodromes"`, `link "New scenario"`, and the school and class forms |
| `/signup`, `/signin`, `/verify`, `/invite/<token>` | anyone | Single-cell forms |
| `/classes/<id>` | class members | Class heading, students, invitations, assignments |
| `/aerodromes`, `/aerodromes/<id>` | instructor | Import form and list; map of one aerodrome with `Download original` for imported layouts |
| `/scenarios/new`, `/scenarios/<id>` | instructor | Scenario editor |
| `/sessions/<id>` | seated student | Position page |
| `/sessions/<id>` | instructor | Console |
| `/sessions/<id>` | class student with no seat | The seat buttons |
| `/sessions/<id>/debrief` | instructor, seated students | Debrief |
| `/records/<student id>` | that student, class instructor | Record |
| `/settings` | signed in | Profile, password, reduce-motion setting |

The root of the session page carries `data-layout`: `desktop` at 1024 px and above, `tablet` from 600 to 1023 px, and `phone` below 600 px, so 1280, 768 and 375 give those three.

- **Position page.** `desktop`: board, map and alerts side by side. `tablet`: `tablist "Position"` with `tab "Board"` and `tab "Map"`, with the alerts under them. `phone`: the same tablist plus `tab "Alerts"`, showing one tab at a time. The command line stays visible in all three, as do the status items.
- **Console.** `desktop`: both boards side by side, `Ground board` on the left and `Tower board` on the right, with the map and controls. `tablet` and `phone`: `tablist "Console"` with `tab "Clock"`, `tab "Events"`, `tab "Alerts"` and `tab "Boards"`, with `Clock` first. `Clock` holds the status items, `Pause` or `Resume`, the speed radios and `End exercise`. `Events` holds the event form and the note field. `Boards` holds `Ground board`, then `Tower board` below it, then the map.
- **Touch sizes.** The touch widths are the `tablet` and `phone` layouts, so 768 and 375 of the published widths and not 1280. At those widths every strip, button, tab, radio, checkbox, text field and drop-down is at least 44 px high, `Pause`, `Resume`, the speed radios and `Inject` included. A radio or checkbox is measured with its label. Links inside running text and the aircraft symbols on the map are exempt.
- **Phone rules.** The debrief's tables reflow so each row reads as labelled lines, and they keep their table role.

### Public screens and controls (DP-01, DP-02, DP-03, DP-05, DP-06, DP-08, DP-16, DP-24, DP-28, DP-38, DP-39, DP-44, DP-45, DP-46, DP-47, DP-48, DP-50, DP-56)

Only what is listed here is public; everything else is free. All copy uses straight apostrophes and quotes, the ASCII hyphen-minus and three full stops, never an ellipsis character, and a penalty's minus sign is the hyphen-minus (`-15`). Every backticked string renders character for character, and announcements built from it carry the same characters. A password field is listed as `textbox` by its label, though its input type is password.

Placeholders: `<CS>` is a callsign, `<rwy>` a threshold id such as `27`, `<point>` a holding point id, and `<n>` a whole number.

**Every page.** A `contentinfo` landmark holds `Training only. Fictional aerodromes. Not for real air traffic control.` A page that cannot be opened shows heading `Not found.`

**Account and class controls.**

| Page | Controls |
|---|---|
| `/signup` | `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `button "Create account"` |
| `/signin` and the landing sheet | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` |
| `/` (instructor) | `textbox "School name"`, `button "Create school"`, `textbox "Class name"`, `button "Create class"` |
| `/classes/<id>` | `heading "<class name>"`, `list "Students"`, `textbox "Student emails"`, `button "Send invitations"`, `table "Assignments"`, `button "Assign exercise"`; each assignment row has `button "Start exercise"` for the instructor, which creates the session and lands on its console at `/sessions/<id>`, and `link "Open exercise"` for students while a session is open; a student also has `link "My record"`, and the instructor's student rows link to `/records/<id>`. The invitation and assignment controls are the instructor's only |
| Assign dialog | `dialog "Assign exercise"`, `combobox "Scenario"`, `textbox "Due on"` (a date typed as `YYYY-MM-DD`), `button "Save assignment"` |
| `/invite/<token>` | `textbox "Name"`, `textbox "Password"`, `button "Join class"` |
| `/settings` | `textbox "Name"`, `textbox "Current password"`, `textbox "New password"`, `checkbox "Reduce motion"`, `button "Save settings"`. The checkbox applies the reduced-motion behaviour whatever the system setting says |

The empty `list "Students"` shows `No students yet. Invite them by email.`

**Aerodromes.** `/aerodromes` has `button "Import layout"`, a file input labelled `Layout file`, `list "Import errors"`, and `list "Aerodromes"` of links to `/aerodromes/<id>`. `/aerodromes/<id>` has the map and, for an imported layout, `button "Download original"`.

**Scenario editor.** `textbox "Scenario name"`, `combobox "Aerodrome"`, `combobox "Runway in use"`, `textbox "Wind direction"`, `textbox "Wind speed"`, `textbox "Start time"`, `textbox "Duration seconds"`, `textbox "Seed"`, `textbox "Readback error interval"`, `table "Traffic"`, `button "Add aircraft"`, `button "Save scenario"`, `alert "Scenario error"`. `Add aircraft` adds a row whose fields are numbered by row: `textbox "Callsign <row>"`, `textbox "Type <row>"`, `combobox "Wake <row>"`, `combobox "Rules <row>"`, `combobox "Kind <row>"`, `textbox "Stand <row>"`, `textbox "Holding point <row>"`, `textbox "Runway <row>"`, `textbox "Appear at <row>"`, `textbox "Due seconds <row>"`, `textbox "Slot seconds <row>"`, `checkbox "Overruns hold <row>"`.

**Combobox options.** Every combobox in this brief is a native drop-down list, so an option is picked by its exact text, and each starts on its first option. The options of `combobox "Event"` are printed with the event form. The others are:

| Combobox | Option text, in order |
|---|---|
| `combobox "Aerodrome"` | each aerodrome's name: `Wrenfield`, `Kestrel Down`, then imported layouts in import order |
| `combobox "Runway in use"` | the threshold ids of the chosen aerodrome in layout order, `09` then `27` for both built-in aerodromes |
| `combobox "Wake <row>"` | `L`, `M`, `H`, `J` |
| `combobox "Rules <row>"` | `VFR`, `IFR` |
| `combobox "Kind <row>"` | `dep`, `arr` |
| `combobox "Scenario"` | each scenario's name in this school, in creation order |
| `combobox "Aircraft"` | the callsign of each aircraft in the session whose strip has appeared, in alphabetical order |

**All session clients.**

| Region | Content |
|---|---|
| `status "Exercise state"` | `Running`, `Paused` or `Ended` |
| `status "Sim clock"` | `HH:MM:SS`, with `data-speed="1|2|4"` |
| `status "Runway in use"` | for example `27` |
| `status "Wind"` | direction in three digits, for example `270 at 8 kt` |
| `status "Runway notice"` | the newest notice from Business rules, empty when there is none |
| `list "Alerts"` | newest first; each `listitem` has `data-rule="<id>"`, `data-severity`, and text exactly `<HH:MM:SS> <id> <alert text>`, for example `12:07:40 R4 Taxi conflict on A4: GQRST and GABCD.`; when empty, the cell reads `No alerts yet.` |
| `alert "Urgent alerts"` | assertive; see Feedback states |
| `status "Alert announcements"` | polite; see Feedback states |
| `alert "Strip notice"` | the version conflict message |
| `link "Open debrief"` | appears on every client when the exercise ends |

`Sim clock` and strip timers change on every tick and are not announced on each change.

**Position page.** `region "Ground board"` or `region "Tower board"`, `textbox "Command"`, `button "Send"`, `alert "Command error"`, `status "Readback"` (the sending seat and the instructor), `list "Route preview"`, and the map. A student with no seat sees `button "Take GND seat"` and `button "Take TWR seat"`.

**Boards.** Ground board: `list "Pending"`, `list "Pushback"`, `list "Taxi"`, `list "Hand-off"`. Tower board: `list "Incoming"`, `list "Holding"`, `list "Line up"`, `list "Departed"`, `list "Arrivals"`, `list "Landed"`. An empty bay shows `No strips here.` in its cell.

**Strip.** A `listitem` inside `list "<bay name>"`, carrying:

- `data-strip="<callsign>"`, `data-bay="<bay>"`, `data-frequency="GND|TWR"`, `data-state="active|offered|transferred"`, `data-version="<n>"`.
- `data-pending="true"` while waiting for the server, `data-preview="true"` while named in the command line, and `data-emergency="true"` during an emergency.
- `aria-label` exactly `<callsign>, <DEP|ARR>, <type>, wake <wake>, <rules>, <stand S1 or runway 27>, <holding point A1 or no holding point>, cleared <cleared text or none>`. For example `GABCD, DEP, C172, wake L, VFR, stand S1, holding point A1, cleared none`, and after taxi the same label ending `cleared TAXI HP A1 VIA A`. An arrival example: `GDOWN, ARR, B738, wake M, IFR, runway 27, no holding point, cleared none`.
- `DEP` or `ARR` always shown as text, the word `GO AROUND` after a go-around, and the band `EMERGENCY` during an emergency.
- Timers, each a `<span data-timer="wake|offer|due|slot">` as defined in Business rules, with `data-near="true"` at the limits defined there.
- `button "Accept <CS>"` on an Incoming copy and `button "Recall <CS>"` on an offered Hand-off strip.

The `cleared` text is the last accepted command without the callsign. `NEGATIVE` never sets it, and a `GO AROUND` leaves it `none`. A transferred copy has `aria-disabled="true"` and its label ends `, transferred to Tower`.

**Strip dialog.** `dialog "Edit <CS>"`, `textbox "Holding point"`, `textbox "Remarks"`, `button "Save strip"`, `alert "Strip error"`.

**Console controls.** `region "Ground board"`, `region "Tower board"`, the map, `list "Alerts"`, `button "Pause"` or `button "Resume"`, `radiogroup "Speed"` (`radio "1x"`, `radio "2x"`, `radio "4x"`), `button "End exercise"`, `form "Inject event"`, `textbox "Note"`, `button "Pin note"`, and `button "Reassign <GND|TWR> seat"` when a seat's grace has ended. An instructor who takes a free seat also gets that seat's command line.

`form "Inject event"` holds `combobox "Event"` with options `Close runway`, `Reopen runway`, `Go-around`, `Emergency`, `End emergency`, `Wind change`; `combobox "Aircraft"` (for `Go-around` and `Emergency`); `textbox "Wind direction"` and `textbox "Wind speed"` (for `Wind change`); `button "Inject"`; `alert "Event error"`.

**Map.** `region "Airfield map"` holds an inline SVG and a text mirror, on session pages and on `/aerodromes/<id>`.

- Every object has its id in both the SVG and the mirror: `[data-runway="09/27"]`, `[data-segment-id="A2"]`, `[data-holding="A1"]`, `[data-stand="S1"]`, and its label as text. The label is the id.
- The mirror is `list "Airfield objects"`, with one `listitem` for each runway, segment, holding point and stand.
- The mirror also has `list "Aircraft positions"`, with one `listitem` for each aircraft whose strip has appeared, finished ones included: `data-aircraft="<CS>"`, `data-status`, `data-segment`, `data-node`, `data-progress`, text exactly `<CS> <status> <segment or node>`.
- Every aircraft whose strip has appeared has a symbol in the SVG, `button "Aircraft <CS>"`, carrying `data-selected`, `data-emergency` and `data-glide-ms`, in each of these statuses: `parked`, `pushing`, `ready`, `taxiing`, `stopped`, `holding`, `crossing`, `lining-up`, `lined-up`, `rolling`, `final` and `landing`. A stationary aircraft's symbol is drawn at the node in its `data-node`. Only `airborne` and `vacated` aircraft have no symbol.
- The attributes `data-lit`, `data-conflict` and `data-stop-bar` belong to the SVG objects.

**Debrief.** Heading `Debrief: <scenario name>`, `status "Score"`, `status "Result"`, `table "Score breakdown"`, `table "Timeline"`, `slider "Replay"`, `region "Replay map"` (the map and the same mirror lists for that second), `button "Export CSV"`, `button "Export PDF"`, `status "Export status"`, `alert "Export error"`. Before the end the page shows only `Debrief is ready when the exercise ends.`

- `status "Score"` reads `Score <n> of 100`. `status "Result"` reads `Passed` or `Not passed`. Both hold their final text from first paint.
- `table "Score breakdown"` has columns `Sim time`, `Rule`, `Detail`, `Points`. One row per violation in time order reads `<HH:MM:SS> | <rule id> | <alert text> | -<penalty>`. One row per slot delay that costs at least 1, in takeoff order, reads `<takeoff time> | Slot | Slot delay <CS>: <n> min | -<n>`; in the API `breakdown` it is an entry with `rule` `Slot`, that text and `penalty` `<n>`. Slot rows come after every violation row, and a departure that never took off uses the session's end time as its takeoff time, in the table and as the API `simTime`. The last row has `Total` in its first cell and the score in its last, with the two between empty.
- `table "Timeline"` has columns `Sim time`, `Position`, `Kind`, `Text`, and lists every log row in order.
- `slider "Replay"` has `aria-valuemin="0"`, `aria-valuemax` the session's length in sim seconds, `aria-valuenow`, and `aria-valuetext` the sim time `HH:MM:SS`. The timeline's latest row at or before that second has `aria-current="true"`.

**Record.** Heading `Record: <name>`; `list "Assignment results"` with, for each assignment, its scenario name and the lines `Attempts: <n>`, `Best score: <n>` (or `Best score: none`), and `Status: Passed`, `Status: Not passed` or `Status: Not attempted`; and `table "Attempts"` with columns `Scenario`, `Finished`, `Position`, `Score`, `Result`, `Timing` and a link `Open debrief` in each row. `Finished` is `YYYY-MM-DD`.

### Interactions (DP-09, DP-10, DP-13, DP-16, DP-27, DP-44, DP-47, DP-54)

**Board keyboard.**

- A board is one tab stop. The roving stop starts on the first strip of the first bay holding strips, then stays on the strip last focused. A board with no strips is skipped. The `Accept <CS>` and `Recall <CS>` buttons are not extra tab stops: by keyboard those actions are `Ctrl+Right` and `Ctrl+Left`.
- A tablist is one tab stop, on its selected tab, and `ArrowLeft` and `ArrowRight` change the tab.
- On a session page nothing comes before the stops below, so the first Tab on a freshly loaded page lands on the first of them, and any page links come after them.
  - Position page, `desktop`: the board, then `textbox "Command"`, then `button "Send"`.
  - Position page, `tablet` and `phone`: `tablist "Position"`, then the shown panel (the board when `Board` is selected), then `textbox "Command"`, then `button "Send"`.
  - Console, `desktop`: `region "Ground board"`, then `region "Tower board"`.
  - Console, `tablet` and `phone`: `tablist "Console"`, then the shown panel.
- `ArrowUp` and `ArrowDown` move within a bay.
- `ArrowLeft` and `ArrowRight` move to the same place in the next bay holding strips, or to its last strip, skipping empty bays. At an edge focus stays.
- `Ctrl+Right` and `Ctrl+Left` move a strip as in the moves table in Business rules. A move with nowhere to go is sent to the server, which refuses it, and the refusal shows.
- `Enter` opens `dialog "Edit <CS>"` with the first field focused.
- `/` pressed with focus on anything on the board, a button included, focuses the command line.
- On a transferred copy, `Enter`, `Ctrl+Right` and `Ctrl+Left` open nothing and show `<CS> is not on your frequency.` in `alert "Command error"`.

**Dialogs.** Tab and Shift+Tab wrap inside every open dialog. `Escape` closes it, and focus returns to the opener.

**Command line.**

- Enter or `button "Send"` sends, and an empty line sends nothing.
- On acceptance the line clears and any refusal clears with it. After a line that was pre-filled, focus returns to that strip in its new bay. After a line typed by hand, focus stays in the line.
- `Tab` with a partly typed first word completes it from the callsigns on the seat's frequency. One match completes it and adds a space. Several matches complete the first in alphabetical order, followed by a space, and each further Tab moves to the next the same way, wrapping at the end, for as long as nothing else is typed. With no match, or with the first word already complete and no cycle running, Tab moves focus as usual.
- `Up` recalls the previous sent line, refused ones too. `Down` goes forward, and going past the newest restores what was being typed. History holds the last 50 lines of this seat and survives a reload.
- `Escape` on a pre-filled line clears it, gives focus back to the strip and changes nothing. On a hand-typed line it does nothing.

**Pointer and touch.**

- A mouse or one-finger drag from one bay to another is the same as the keyboard move: a drop on a bay needing a clearance pre-fills the line and focuses it; a drop on a bay that does not is sent as a move; a dragged strip that is refused goes back to its place.
- `Accept <CS>` and `Recall <CS>` buttons do the same as `Ctrl+Right` on the Incoming copy and `Ctrl+Left` on the Hand-off strip.
- Touch targets follow the touch sizes in Screens and layout.

**Map.** Click or Enter on an aircraft symbol focuses its strip when that seat has it. Focusing a strip sets `data-selected="true"` on its symbol.

**Replay.** `ArrowRight` and `ArrowLeft` move one sim second, `PageUp` and `PageDown` 60, and `Home` and `End` go to the ends, stopping at both ends.

**Export.** `Export CSV` and `Export PDF` work by Enter or Space, and the browser saves the file as `report.csv` or `report.pdf`.

### Visual design (DP-59, DP-60)

The direction is acid-crisp: exact, nocturnal and loud only when it matters. Every strip, bay and taxiway edge sits on one guide grid. The room is burgundy with no white anywhere, like a tower cab with the lights down. Only the active strip, the lit route and a live alert are solid pink.

**Colour.** The ground is a very deep burgundy. Surfaces are one step lighter burgundy. Ink and accent are the same bubblegum pink. Muted text is a dusty rose. Text on the accent is the deep burgundy of the ground. There is no red, amber or green. Every alert, strip type and runway state uses the one pink and the one burgundy, told apart only by hatch, inversion, chamfer and written words, so a colour-blind student loses nothing. All text meets WCAG 2.2 AA contrast.

**Type.** Stack Sans Headline for display, Stack Sans Text for body, and Spline Sans Mono only in the clearance line, grammar help and literal clearances in logs. All three are bundled with the app. Each heading step is a quarter larger than the one below it. Density is compact. Timers and scores use tabular figures.

**Composition.** A container about 1280 px wide is bounded by dashed guide lines that run down every page and become the real bay dividers, map frame and console edges. Text is pinned to cell edges. Burgundy full-viewport screens each hold one idea.

**Landing page, in order.**

1. Dashed guides split the hero into a grid of four columns and two rows. The headline `Type the taxi. See the line.` spans the top three cells in light Stack Sans Headline, about a fourteenth of the viewport wide in letter height. The top-right cell holds one literal clearance, `GABCD TAXI HP A1 VIA A`, in Spline Sans Mono, the only mono on the page. A working schematic of Wrenfield fills the lower cells and replays Centreline Run from that clearance once. One bottom cell is solid pink with burgundy text and holds `link "Open your school"`, which goes to `/signup`. On a phone that cell follows the headline directly.
2. A burgundy full-viewport screen reads `Every clearance has a second it was given.` with the word `second` on a pink bar, the training-only notice bottom-left and `link "Create an account"` bottom-right.
3. A solid pink sheet rises over the page, with burgundy text, heading `Sign in` and the sign-in form.

**Working screens.**

- Bays are grid columns, and the dashed guides are their dividers rather than ornament.
- Strips are surface bars with square corners, except one small chamfer that shows direction by shape: top-right for departures, top-left for arrivals.
- The selected strip inverts to solid pink with burgundy text.
- A near timer inverts to solid pink, as a colour swap with no motion.
- A transferred copy is muted with a hatch.
- A closed runway is hatched with the word `CLOSED` on the map.
- The map draws grass and aprons as an ordered-dither pixel field dissolving into the ground colour, with pavement as flat surface.
- Tables, forms and the record use the same cells, with large light numerals for scores.
- Empty bays show one plain sentence inside the cell.
- Loading shows the guides drawing in once.
- Errors and outages are full-width cells with a diagonal hatch, a written state and the action.
- Controls are large enough to tap comfortably, at the touch sizes in Screens and layout.

### Motion and effects (DP-28, DP-29, DP-30, DP-32, DP-34, DP-55)

All motion is quick and exact, settling softly with no bounce. No motion runs for decoration, and there are no unnamed loops. Every `data-*` marker below is set and cleared by a browser timer or animation frame, never by the end of a stylesheet animation, so advancing the browser clock by the stated time clears it. The verifier pauses the browser clock and advances it, and blocks service workers, so the app must not depend on a service worker, and pushed updates must render without any browser timer.

**Motion list.**

- A strip changing bay slides from the old place to the new one in about a quarter of a second, with `data-motion="move"` on the strip while it runs.
- A new strip fades up from just below its place in about a quarter of a second.
- An aircraft symbol glides in a straight line between sim positions, at an even pace, in exactly one sim second divided by the speed (1 second at 1x, 0.25 seconds at 4x). `data-glide-ms` on the symbol holds that time in milliseconds.
- A handoff offer pulses the Incoming strip's edge for three cycles, about 1.2 seconds in all, with `data-motion="pulse"`.
- A new alert row slides in from the right in about a quarter of a second, with `data-motion="alert"`.
- An incursion flashes the board edge twice in 0.6 seconds, with `data-motion="flash"` on each board region that client shows.
- The replay snaps with no animation and never sets `data-motion`.
- The large score numeral ticks to its value once in under half a second. It is a decorative copy hidden from assistive technology, and `status "Score"` and the record lines never animate.
- Loading guides draw in once in under half a second.

**Signature: Centreline Run.** The student sees what a clearance means on the ground as they type it, the way lit taxiway guidance shows a pilot the cleared route.

1. When the first word of `textbox "Command"` is a callsign on this seat's frequency, its strip gets `data-preview="true"` and its symbol `data-selected="true"`.
2. When the preview reply has a route, `list "Route preview"` lists it in order with one `listitem` per segment, its text `<segment>`, or `<segment> R4` when that segment would raise R4.
3. In the SVG each of those segments gets `data-lit="preview"`, one at a time from the aircraft outward: the first at once and each next 90 ms later.
4. A segment that would raise R4 also gets `data-conflict="R4"` and is drawn hatched rather than solid. An R4 at the holding point itself puts `data-conflict="R4"` on that holding point.
5. The route's holding point gets `data-stop-bar="true"` once the last segment is lit, about 0.2 seconds after it.
6. When the text changes so that the route shrinks or empties, the extra segments lose `data-lit` from the end back to the start, in about a quarter of a second in all, and the stop bar goes first.
7. On an accepted `TAXI` the same segments change to `data-lit="accepted"` for that seat, and a reload shows the remaining ones the same way. A segment goes dark for good as the aircraft leaves it, one way only. The stop bar stays until the aircraft is `lining-up`.
8. On a refusal the run retracts as in step 6 and the refusal shows as usual.
9. The number of lit preview segments always ends equal to the length of the reply's `route`.

**Reduced motion.** This applies under the system setting or `Reduce motion`.

- Every strip and every aircraft symbol is drawn at its new place in a single frame, `data-glide-ms` is `0`, and no `data-motion` ever appears.
- Pulses and flashes become a static outline for 2 seconds, with `data-outline="static"` on the same element.
- Alert rows appear without sliding.
- All Centreline Run segments, the stop bar and the retraction reach their end state in one frame. The list, rule IDs and going-dark steps are unchanged.
- The landing replay shows its end state at once.
- Live regions and every function are unchanged.

### Feedback states (DP-10, DP-12, DP-17, DP-24, DP-31, DP-50, DP-52)

**Alerts in live regions.** R5 is announced in `alert "Urgent alerts"` and every other rule in `status "Alert announcements"`, as the exact alert text without the time. The two regions never carry each other's alerts, and each holds its newest text until the next one. Every client announces every alert.

**Commands and moves.**

- While a command or move waits for the server's answer, its strip has `data-pending="true"` and stays in the bay it was in. A strip never shows in a new bay until the server has accepted the move.
- A refused move leaves the strip where it was, with the reason shown and no second copy.
- A refused command shows its text in `alert "Command error"` under the line, the sent text stays in the line, and the field gets `aria-invalid="true"`. The refusal stays until the next send or the next strip move the server accepts; pre-filling the line and `Escape` leave it shown.
- An accepted command shows its readback in `status "Readback"`.

**Pushed updates.** The browser applies each pushed update as soon as it arrives, in the server's order, in place: no reload, no scroll jump, no timer or debounce in between. A pushed update never moves focus, never closes a dialog and never clears typed text, a shown refusal or a half-filled event form. A later repaint never overwrites a message an action just showed.

**Route preview.** Each change of the command text sends its preview at once, with no debounce, so the last keystroke is never lost. Only the reply for the latest text is ever shown. A slower reply for earlier text is dropped.

**Forms.** Every form has `status "Form status"` and, on field errors, `alert "Form errors"`: a summary with one link per faulty field that moves focus to it, each message also shown by its field. `Scenario error`, `Command error`, `Event error`, `Strip error` and `Export error` are the only alerts that replace this summary.

| Action | Pending | Success | Failure |
|---|---|---|---|
| Sign up | `Saving...` | `Check your email to verify your account.` | Form errors |
| Sign in | `Signing in...` | goes to the page asked for, or `/` | `alert` with the API `message` |
| Send invitations | `Sending...` | `Invitations sent: <n>` | Form errors, or the mail outage text |
| Join class | `Joining...` | lands on `/classes/<id>` | `alert` with the API `message` |
| Import layout | `Checking layout...` | lands on `/aerodromes/<id>` | `list "Import errors"` with one item per line; size and outage messages in `alert "Import error"` |
| Save scenario | `Saving...` | `Scenario saved.` | `alert "Scenario error"` |
| Save assignment | `Saving...` | `Assignment saved.` | Form errors |
| Save strip | `Saving...` | dialog closes, focus returns to the strip | `alert "Strip error"`, or the notice in `alert "Strip notice"`; the dialog stays open |
| Inject | `Injecting...` | `Event injected.` | `alert "Event error"` |
| Pin note | `Pinning...` | `Note pinned.` | Form errors |
| Save settings | `Saving...` | `Settings saved.` | Form errors |

`Inject` and `Pin note` show their pending and success text in `status "Form status"`.

**Exports.** `status "Export status"` shows `Preparing report...`, then `Report saved. Notice sent.`, or `Report saved. Notice not sent.` when Mailpit did not accept the mail, or `Report saved.` for a repeat export. A failure shows the API `message` in `alert "Export error"`, with no file.

**Connection.** When the WebSocket is lost, a full-width hatched cell shows `Connection lost. Reconnecting...` in `status "Connection"`. On return the board re-reads the state and the cell goes.

**Outages.** A 503 shows its `message` in the alert named for that action, in a full-width hatched cell, and the action stays available to retry. Copy for each is in Services.

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-05, DP-06, DP-07, DP-10, DP-14, DP-15, DP-21, DP-28, DP-31, DP-39, DP-43, DP-44, DP-46, DP-47, DP-49, DP-50, DP-57, DP-58)

JSON in and out, `application/json`, unless stated. Ids are opaque strings, and sim times are `HH:MM:SS`.

**Error order for every request.** Each later check runs only if the earlier one passed.

1. Authentication: `401 {"error": "unauthenticated"}`.
2. Existence and access: `404 {"error": "not_found"}` for anything missing or that this user may not open, including another school's data, a nested id or an id in a request body, a position the caller does not hold, and instructor-only actions by a student. Never 403, and never a 422 for such an id.
3. Rate limit, on commands and moves only: `429 {"error": "rate_limited", "message": "Too many commands. Wait a moment."}` over `COMMANDS_PER_MINUTE` for that seat, wall clock. The message shows in `alert "Command error"`.
4. Exercise state: `409 {"error": "paused", "message": "The exercise is paused."}` or `409 {"error": "ended", "message": "The exercise has ended."}`. Commands, strip moves and strip edits get either answer. Events, notes, seats, `pause`, `resume` and `speed` get only the `ended` one. `preview` never gets it, and a second `end` answers `200 {"status": "ended"}` again.
5. Parse and validation, `422`. Commands: `{"error": "parse", "message": "<exact refusal text>"}`. Forms: `{"errors": {"<field>": "<message>"}}`.
6. Version conflict, `409`. On strip moves and edits this runs straight after the request body's shape is checked, and the strip's own move rules are judged only on a current version.

`/api/health`, `/api/config`, `POST /api/signup`, `POST /api/session` and the invitation routes need no sign-in.

**Accounts and classes.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/signup` | `{"name", "email", "password"}` | `201 {"id"}` | `422` with `errors` for `name`, `email`, `password` |
| `POST /api/session` | `{"email", "password"}` | `200 {"id", "name", "email"}`, sets the session cookie | `401 {"error": "invalid_credentials", "message": "Email or password is incorrect."}`, `401 {"error": "unverified", "message": "Verify your email first."}` |
| `DELETE /api/session` | none | `204` | |
| `GET /api/me` | none | `200 {"id", "name", "email", "reduceMotion", "school", "classes"}` | |
| `PATCH /api/me` | `{"name", "currentPassword", "newPassword", "reduceMotion"}`, all optional | `200` as `GET /api/me` | `422` |
| `POST /api/schools` | `{"name"}` | `201 {"id", "name"}` | `409 {"error": "school_exists", "message": "You already have a school."}` |
| `POST /api/classes` | `{"name"}` | `201 {"id", "name"}` | `422` |
| `GET /api/classes/<id>` | none | `200 {"id", "name", "students", "assignments"}` | |
| `POST /api/classes/<id>/invitations` | `{"emails": ["..."]}` | `201 {"sent": ["..."]}` | `422 {"errors": {"emails": "..."}}`, mail 503 |
| `POST /api/classes/<id>/assignments` | `{"scenario", "dueOn"}`, `dueOn` as `YYYY-MM-DD` | `201 {"id"}` | `422` |
| `GET /api/invitations/<token>` | none | `200 {"class", "email"}` | the two `410`s |
| `POST /api/invitations/<token>/accept` | `{"name", "password"}` | `200 {"classId"}`, sets the session cookie | the two `410`s, `401 invalid_credentials`, `422` |

The two `410`s are `{"error": "invite_expired", "message": "This invitation is out of date. Please request a fresh one from your instructor."}` and `{"error": "invite_used", "message": "This invitation has already been used."}`.

**Aerodromes and scenarios (instructor only).**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/aerodromes` | none | `200 [{"id", "name", "code", "imported"}]` | |
| `GET /api/aerodromes/<id>` | none | `200 {"id", "layout"}` | |
| `POST /api/aerodromes/import` | the raw file as the body, any content type | `201 {"id", "name", "code"}` | `413`, `422` and `503` from Business rules and Services |
| `GET /api/aerodromes/<id>/original` | none | `200` with the stored bytes, `application/octet-stream` | `404` for a built-in layout, `503` from Services |
| `GET /api/scenarios` | none | `200 [{"id", "name"}]` | |
| `POST /api/scenarios` | a scenario, as in the grading setup, without `key` and `school` | `201 {"id"}` | `422 {"error": "scenario_invalid", "message": "<text>"}` |
| `GET` and `PUT /api/scenarios/<id>` | the same | `200` the scenario | the same |

**Sessions.**

| Method and path | Who | Request | Success |
|---|---|---|---|
| `POST /api/sessions` | instructor | `{"scenario", "assignment"}`, `assignment` optional | `201 {"id"}`; with or without an assignment, the session's class members are the students of every class in the instructor's school |
| `POST /api/sessions/<id>/seats` | class member | `{"position"}` | `200 {"position"}`, or `409 {"error": "seat_taken", "message": "This seat is taken."}` |
| `DELETE /api/sessions/<id>/seats/<position>` | instructor | none | `204`; only after the seat's grace has ended, with its other answers in the seat notes below this table |
| `POST /api/sessions/<id>/commands` | seat holder | `{"text"}` | `200 {"readback", "alerts": [{"rule", "text"}]}` |
| `POST /api/sessions/<id>/preview` | seat holder | `{"text"}` | `200 {"callsign": "<CS>"|null, "route": ["<segment id>"], "stop": "<holding point>"|null, "conflicts": [{"segment", "rule"}]}` |
| `POST /api/sessions/<id>/strips/<callsign>/move` | seat holder | `{"to", "version"}` | `200 {"strip"}` |
| `PATCH /api/sessions/<id>/strips/<callsign>` | seat holder on that frequency | `{"holdingPoint", "remarks", "version"}` | `200 {"strip"}`; an unknown point gives `422 {"error": "parse", "message": "Unknown holding point <point>."}`, and a strip on the other frequency `422 {"error": "parse", "message": "<CS> is not on your frequency."}`. On edits and moves a callsign not in the session answers `404` |
| `POST /api/sessions/<id>/events` | instructor | `{"kind": "closure|reopen|go-around|emergency|end-emergency|wind", "runway", "callsign", "windDir", "windKt"}` | `200 {"ok": true}`; accepted while paused |
| `POST /api/sessions/<id>/pause`, `/resume` | instructor | none | `200 {"status", "speed"}`; repeating one changes nothing |
| `POST /api/sessions/<id>/speed` | instructor | `{"speed": 1|2|4}` | `200 {"status", "speed"}` |
| `POST /api/sessions/<id>/end` | instructor | none | `200 {"status": "ended"}`; a second call changes nothing |
| `POST /api/sessions/<id>/notes` | instructor | `{"text"}` | `201 {"ok": true}` |
| `GET /api/sessions/<id>/state` | class members | none | `200 {"status", "speed", "simTime", "runwayInUse", "wind", "strips": [...], "aircraft": [...], "alerts": [...], "seats": {...}, "layout": {...}}` |
| `GET /api/sessions/<id>/debrief` | instructor, seated students | none | `200 {"score", "passed", "breakdown": [{"simTime", "rule", "text", "penalty"}], "log": [{"simTime", "position", "kind", "text"}]}` |
| `GET /api/sessions/<id>/replay?t=<seconds>` | the same | none | `200 {"simTime", "aircraft": [{"callsign", "status", "segment", "node", "progress"}], "strips": [{"callsign", "bay"}]}` |
| `GET /api/sessions/<id>/report.<kind>`, where `<kind>` is `csv` or `pdf` | the same | none | `200` the file, `text/csv; charset=utf-8` or `application/pdf`, as an attachment named `report.csv` or `report.pdf`, with header `X-Report-Notice: sent|not-sent|repeat` |
| `GET /api/records/<student id>` | that student, class instructor | none | `200 {"name", "assignments": [...], "attempts": [...]}` |

- `status` is `running`, `paused` or `ended`.
- `strips` in the state lists one row per copy shown: `{"callsign", "board", "bay", "frequency", "state", "version", "cleared", "timers"}`.
- `aircraft` rows are the replay's fields plus `route`, the remaining segment ids.
- `alerts` rows are `{"simTime", "rule", "text", "severity"}`.
- In JSON a missing `segment` or `node` is `null`; in the DOM it is `""`.
- `penalty` in the API is a positive number.
- Seat notes for `POST /api/sessions/<id>/seats`: a `position` other than `GND` or `TWR` answers `422 {"errors": {"position": "Position must be GND or TWR."}}`. A person already holding the other seat of this session gets `409 {"error": "seat_held", "message": "You already hold a seat in this exercise."}` and keeps that seat, and this check comes before `seat_taken`. The holder of the same seat gets `200 {"position"}` and nothing changes.
- Seat notes for `DELETE /api/sessions/<id>/seats/<position>`: a `<position>` other than `GND` or `TWR` answers `404 {"error": "not_found"}`. While the holder is connected or inside the seat's grace it answers `409 {"error": "seat_in_use", "message": "This seat is still in use."}` and the seat stays. A seat with no holder answers `204` and nothing changes.
- `GET` debrief, replay and reports before the end answer `409 {"error": "running", "message": "Debrief is ready when the exercise ends."}`.
- `preview` changes nothing and always answers 200 for a seated student. `route` is empty unless the text reads as a complete `TAXI` command that would be accepted now for an aircraft on this seat's frequency; a trailing `VIA` with no list counts as no `VIA`. `callsign` is null unless the first word is a callsign on this seat's frequency. `stop` is the command's holding point when `route` is not empty. A holding point conflict puts that point's id in `segment`.
- The `move` route takes only the moves that need no clearance. Anything else answers `422 {"error": "parse", "message": "<CS> cannot move there."}`. A strip on the other frequency answers `422` with the frequency refusal, which is judged against the aircraft's frequency. There are two exceptions while the offer is open: TWR's accept of an Incoming copy (`to` is `Holding`) and GND's recall of a Hand-off copy (`to` is `Taxi`) are judged on the open offer, so neither is refused for frequency.
- Event errors: `422 {"error": "not_final", "message": "<CS> is not on final."}`, and `422 {"error": "parse", "message": "Unknown callsign <word>."}` for a callsign that is not in the session.

**Public.**

- `GET /api/health` answers `200 {"status": "ok"}` in every instance, including the storage outage instance, never 503.
- `GET /api/config` answers `200 {"today", "timeZone", "simClock", "timers"}`. `timers` holds every timer and limit from Configuration and secrets, as read from the environment, by env name in camelCase: `pushSeconds`, `lineupSeconds`, `takeoffRollSeconds`, `landingRollSeconds`, `crossSeconds`, `handoffOfferSeconds`, `arrivalProtectSeconds`, `goAroundSeconds`, `readbackCorrectSeconds`, `readbackErrorEvery`, `simSeedOffset`, `slotToleranceSeconds`, `windChangeDelaySeconds`, `seatGraceSeconds`, `inviteTtlHours`, `verifyTtlHours`, `commandsPerMinute`, `layoutMaxBytes`.

**WebSocket.** `GET /api/sessions/<id>/live` upgrades to a WebSocket on the same origin, signed in by the session cookie, and pushes every update in the server's order. The message shape is the app's own. No third-party realtime service is used, and the browser never needs a timer to keep the socket alive.

**Grading routes.** Every grading route needs header `X-Grading-Key: <GRADING_KEY>`. A wrong or missing key, or an unset `GRADING_KEY`, gives 404. Apart from the invitation `url` values below they never return tokens.

`POST /api/grading/setup` takes:

```json
{"users": [{"email", "name", "password", "verified"}],
 "schools": [{"key", "name", "instructor": "<email>",
   "classes": [{"key", "name", "students": ["<email>"]}]}],
 "aerodromes": [{"key", "layout": {}}],
 "scenarios": [{"key", "school", "aerodrome": "wrenfield|kestrel-down|<key>", "name",
   "runwayInUse", "windDir", "windKt", "startSimTime", "durationSeconds", "seed",
   "readbackErrorEvery", "traffic": [], "events": []}],
 "assignments": [{"key", "class", "scenario", "dueOn"}],
 "invites": [{"class", "email", "sentHoursAgo", "status"}],
 "sessions": [{"key", "scenario", "assignment", "seats": {"GND": "<email>", "TWR": "<email>"},
   "simTime", "strips": [{"callsign", "bay", "frequency", "segment", "progress", "node",
     "dueSeconds", "takeoffStart", "cleared"}], "script": [], "endAt"}]}
```

It answers `201 {"users": [{"email", "id"}], "schools": {...}, "scenarios": {...}, "aerodromes": {...}, "assignments": {...}, "sessions": {"<key>": "<id>"}, "invites": [{"email", "url"}]}` with the ids by key. Each `schools` entry maps its key to `{"id", "classes": {"<key>": "<id>"}}`. Keys elsewhere in the body refer to entries of the same call or of an earlier one. Only `users` is required. It may be called many times, and every call adds. `status` of an invite is `pending` or `used`.

A session's `simTime` starts it there, with the listed strips placed. `strips` names a scenario callsign, the bay it is in, and only the fields that bay needs:

| Bay | Fields | Aircraft |
|---|---|---|
| `Pending` | none | `parked` |
| `Pushback` | none | `ready` |
| `Taxi`, `Hand-off`, `Incoming` | `segment` and `progress`, or `node` | heading for the traffic item's holding point; `Hand-off` and `Incoming` hold an open offer with a full timer |
| `Holding` | `node`, or `segment` and `progress` | `holding`, or still taxiing to its holding point |
| `Line up` | none | `lined-up` |
| `Departed` | `takeoffStart` | the leader for R2; `rolling` if `TAKEOFF_ROLL_SECONDS` has not passed, else `airborne` |
| `Arrivals` | `dueSeconds` | `final` |

- `frequency` overrides the bay's usual frequency. The usual frequency of `Hand-off` and `Incoming` is GND, because an open offer stays on GND, and either bay creates both copies of that offer.
- `cleared` sets the strip's cleared text.
- Unlisted traffic that should have appeared by `simTime` is in its first bay, an arrival with its full `dueSeconds`.
- `simTime` defaults to the scenario's `startSimTime`.

A session's `script` runs its items through the real command and move paths at their sim times (seconds after the session's first sim time), in list order, ticking between them: `{"at", "position", "command"}` or `{"at", "position", "move": {"callsign", "to"}}`. With `endAt` (seconds after that same time) ticks carry on after the last item until the normal end condition or `endAt`, whichever comes first, so a finished session with a real log, score and debrief exists at once. Without `endAt` the session stays running at the last item's sim time.

`POST /api/grading/sessions/<id>/clock` takes `{"advance": <seconds>, "speed": 1|2|4}`, either optional. It sets the speed, then runs that many ticks, each pushed to clients, and answers `200 {"simTime", "state"}` after the last one, where `state` is the session's `status`. A paused or ended session runs no ticks and answers the same way.

`POST /api/grading/sessions/<id>/hold-updates` takes `{"position": "GND|TWR", "hold": true|false}`. While held, pushes to that seat queue up, and releasing sends them in order. Commands and moves are unaffected.

### Business rules (DP-01 to DP-06, DP-08 to DP-11, DP-14, DP-15, DP-18 to DP-27, DP-30, DP-32 to DP-37, DP-39 to DP-42, DP-44, DP-46, DP-48 to DP-51)

**Times.** Sim time is printed `HH:MM:SS`. A duration or timer is printed `m:ss` (`1:12`, `0:58`, `5:00`, `12:03`). The sim clock never wraps past 23:59:59 in any scenario.

**Clock.** Only the server keeps the sim clock and every piece of state. Browsers send commands and moves and draw what the server pushes. Sim time is separate from the wall clock. A session's clock starts at the scenario's `startSimTime` and moves one sim second per tick.

- Under `SIM_CLOCK=wall` the server ticks at the session's speed: 1, 2 or 4 sim seconds per wall second.
- Under `SIM_CLOCK=stepped` every session starts with its clock held, and no tick ever happens from the wall clock: the sim moves only through the grading clock route. The exercise is still `running`, commands are accepted, and the speed value is recorded and used for animation durations.
- Paused is only the instructor's pause.
- The device clock may be wrong: every sim time and timer on screen comes from the server's pushed values, and the browser never counts one down by itself. Pausing, reloading or changing the device clock moves nothing.
- Every session second is persisted.

**Today.** `APP_TODAY` (`YYYY-MM-DD`) is today for every date rule. When unset, today is the current date in `APP_TIME_ZONE`.

**Tick order.** Each tick does these in order, then pushes one update:

1. The sim clock moves one second.
2. Scheduled events due at that sim time apply.
3. Strips due at that sim time appear.
4. Every aircraft moves and every countdown drops by one.
5. Expired handoff offers and readback deadlines fire.
6. Tick rules R5 and R6 are checked, R5 first.
7. The session ends if its end condition holds.

A clearance is checked at the moment it is accepted, at the current sim time, between ticks. A session processes its commands, moves and ticks one at a time in the server's order. Traffic with `appearAt` 0 is present when the session starts.

**Traffic item.** `{"callsign", "type", "wake", "rules", "kind", "stand", "holdingPoint", "runway", "appearAt", "dueSeconds", "slotSeconds", "overrunsHold"}`:

- `callsign`: 5 capital letters.
- `wake`: `L`, `M`, `H` or `J`.
- `rules`: `VFR` or `IFR`.
- `kind`: `dep` or `arr`.
- `stand` and `holdingPoint`: for departures.
- `runway`: for arrivals, a threshold id.
- `appearAt`: seconds after the start.
- `dueSeconds`: for arrivals, seconds from appearing to the threshold.
- `slotSeconds`: for departures, the slot as seconds after the start, or null.
- `overrunsHold`: true marks a scripted pilot error (this departure does not stop at its holding point).

Scheduled scenario events are `{"at", "kind", ...}` with the event fields, `at` in seconds after the start.

**Bays.** GND: `Pending`, `Pushback`, `Taxi`, `Hand-off`. TWR: `Incoming`, `Holding`, `Line up`, `Departed`, `Arrivals` and `Landed`. A departure appears in Pending at its `appearAt`. An arrival appears in Arrivals at its `appearAt`, already on TWR frequency. Strips in a bay are ordered by entry time, earliest first. Every aircraft is on one frequency, and only that position can clear it.

**Moves.** `Ctrl+Right` or a drag moves a strip forward. Moving into a bay that needs a clearance changes nothing yet: it fills the command line and focuses it, and the strip moves only when the command is accepted. Typing the same command by hand has the same effect.

| From | To | Kind | Pre-filled text |
|---|---|---|---|
| Pending | Pushback | clearance | `<CS> PUSH APPROVED` |
| Pushback | Taxi | clearance | `<CS> TAXI HP <holding point> VIA <taxiway of the last segment>` |
| Taxi | Hand-off | clearance | `<CS> CONTACT TOWER` |
| Incoming | Holding | accept, no clearance | none |
| Holding | Line up | clearance | `<CS> LINEUP <runway in use>` |
| Line up | Departed | clearance | `<CS> CLEARED TAKEOFF <runway in use>` |
| Arrivals | Landed | clearance | `<CS> CLEARED LAND <strip's runway>`; the strip stays in Arrivals, shows the clearance, and moves to Landed by itself on `vacated` |
| Hand-off | Taxi | recall, `Ctrl+Left` only, while the offer is open | none |

Any other move is refused with `<CS> cannot move there.` in `alert "Command error"`, and nothing changes.

**Commands.** Text is `<CALLSIGN> <VERB> <ARGS>`. Input is trimmed, runs of spaces collapse, and lower case is taken as upper case. The log shows the normalised form. One grammar drives both the preview and execution. `both` means whichever seat has the aircraft's frequency.

| Command | Position | Allowed when | Readback (exact) | Effect |
|---|---|---|---|---|
| `<CS> PUSH APPROVED` | GND | `parked` | `Push approved, <CS>.` | Strip to Pushback, `pushing` for `PUSH_SECONDS`, then `ready` |
| `<CS> TAXI HP <point> VIA <taxiways>` | GND | `ready`, `taxiing`, `stopped`, with no open offer | `Taxi holding point <point> via <taxiways>, <CS>.` | Strip to Taxi, moves along the route. `VIA` and its list may be left out: `Taxi holding point <point>, <CS>.` Several taxiways are separated by spaces and printed the same way (`via B D`) |
| `<CS> HOLD POSITION` | both | `taxiing` | `Holding position, <CS>.` | `stopped` where it is |
| `<CS> CONTINUE TAXI` | both | `stopped` | `Continuing taxi, <CS>.` | `taxiing` on the same route |
| `<CS> CONTACT TOWER` | GND | `taxiing`, `stopped`, `holding`, with no open offer | `Contact Tower, <CS>.` | Strip to Hand-off with an open offer |
| `<CS> LINEUP <rwy>` | TWR | `holding` at a holding point serving `<rwy>` | `Line up runway <rwy>, <CS>.` | Strip to Line up, `lining-up` for `LINEUP_SECONDS`, then `lined-up` |
| `<CS> CLEARED TAKEOFF <rwy>` | TWR | `lined-up` | `Cleared for takeoff runway <rwy>, <CS>.` | Strip to Departed, `rolling` for `TAKEOFF_ROLL_SECONDS`, then `airborne`. Takeoff start is the sim time of this clearance |
| `<CS> CLEARED LAND <rwy>` | TWR | `final`, with `<rwy>` the strip's runway | `Cleared to land runway <rwy>, <CS>.` | Lands when `Due` reaches 0: `landing` for `LANDING_ROLL_SECONDS`, then `vacated`, strip to Landed |
| `<CS> CROSS <rwy> AT <point>` | TWR | `holding` at crossing point `<point>` | `Cross runway <rwy> at <point>, <CS>.` | `crossing` for `CROSS_SECONDS`, then continues its route |
| `<CS> GO AROUND` | TWR | `final` | `Going around, <CS>.` | As the go-around event, with no event row |
| `<CS> NEGATIVE RUNWAY <rwy>` or `<CS> NEGATIVE HP <point>` | both | a readback error is open | `Correct, runway <rwy>, <CS>.` or `Correct, holding point <point>, <CS>.` | Closes the error |

The strip's `cleared` text follows each accepted command except `NEGATIVE` and `GO AROUND`; a typed `GO AROUND` leaves `cleared none`, as the event does.

**Refusals.** A refusal changes nothing: no log row, no readback, no strip or aircraft change. Checks run in this order and the first failure wins:

1. Session paused: `The exercise is paused.` Session ended: `The exercise has ended.`
2. First word not a callsign of this session: `Unknown callsign <word>.` Blank text sent to the API: `Usage: <CALLSIGN> <VERB> <ARGS>.`
3. Aircraft on the other frequency: `<CS> is not on your frequency.`
4. Verb unknown: `Unknown command <word>.` A callsign with nothing after it: `Usage: <CALLSIGN> <VERB> <ARGS>.`
5. Verb belongs to the other position: `<VERB> is a Ground instruction.` or `<VERB> is a Tower instruction.` `<VERB>` is the first word after the callsign: `PUSH`, `TAXI`, `CONTACT`, `LINEUP`, `CLEARED`, `CROSS` or `GO`.
6. Wrong arguments: `Usage: <the command's form as printed in the table with its placeholders>.` For example `Usage: <CS> LINEUP <rwy>.` `CLEARED` with neither `TAKEOFF` nor `LAND` gives `Usage: <CS> CLEARED TAKEOFF <rwy> or <CS> CLEARED LAND <rwy>.`, and `NEGATIVE` gives `Usage: <CS> NEGATIVE RUNWAY <rwy> or <CS> NEGATIVE HP <point>.`
7. Unknown point or runway: `Unknown holding point <point>.`, `Unknown runway <rwy>.` A holding point is a node of kind `holding`. `NEGATIVE` skips this check, because its value is only compared in check 12.
8. No route: `No route to <point> via <taxiways>.`
9. Runway not in use: `Runway <rwy> is not in use.` (`LINEUP` and `CLEARED TAKEOFF` only)
10. Holding for an emergency: `All traffic is holding for <emergency CS>.` (`TAXI`, `CONTINUE TAXI`, `LINEUP`, `CLEARED TAKEOFF`, `CROSS`, for every aircraft but the emergency one)
11. State: `<CS> cannot do that now.` For example `CLEARED TAKEOFF` while `lining-up`, a wrong point on `CROSS`, or a `LINEUP` at a holding point serving the other threshold.
12. `NEGATIVE` with nothing open: `<CS> has nothing to correct.` With the wrong value: `That is not the clearance you gave.`

Worked examples:

- `GABCX TAXI HP A1` gives `Unknown callsign GABCX.`
- A TWR student sending `GABCD LINEUP 27` for an aircraft on GND frequency gets `GABCD is not on your frequency.`
- With the exercise paused, `GABCX TAXI HP A1` gives `The exercise is paused.`
- A valid `GABCD TAXI HP A1 VIA A` reads back `Taxi holding point A1 via A, GABCD.`
- At Ground, `GABCD LINEUP 27` gives `LINEUP is a Tower instruction.`
- At Wrenfield, `GABCD TAXI HP A1 VIA C` gives `No route to A1 via C.`

**Routes.**

- On each side of a runway the segments form a tree, so a route between two nodes on one side is unique.
- A `VIA` list fits a route when its taxiways appear among the route's segment taxiways in the same order. `VIA A` fits `S1T W1 A4 A3 A2`.
- A route may pass through a crossing pair. Among routes that fit, the server takes the one with the fewest crossings, then the one through the alphabetically first crossing point.
- A taxi route that passes a crossing holding point stops there, `holding`, until `CROSS` is given, then continues on its route. Only TWR can give `CROSS`, so the aircraft must be handed off first.
- For a `taxiing` or `stopped` aircraft, a new route begins with the rest of its current segment and runs on from that segment's far end.

**Seeded readback errors.** Eligible readbacks are those of `TAXI`, `LINEUP`, `CLEARED TAKEOFF`, `CLEARED LAND` and `CROSS`. Count them in the session from 1. Number `n` carries an error when `every` is above 0 and `(seed + SIM_SEED_OFFSET + n) % every == 0`, where `seed` and `every` are the scenario's `seed` and `readbackErrorEvery` (when null, `READBACK_ERROR_EVERY`).

- A readback with a runway carries the reciprocal threshold (`27` becomes `09`).
- A `TAXI` readback carries the next `holding` node of the layout's node list that serves a threshold, wrapping round (Wrenfield: `A1` becomes `A6`, `A6` becomes `A1`; Kestrel Down: `D1` becomes `D6`).
- The aircraft still does what the clearance said.
- An aircraft holds one open error at a time: while one is open, its next eligible readback counts in the numbering but carries no error.

Worked examples: seed 2, every 3: the 1st and 4th eligible readbacks are wrong. Seed 1, every 3: the 2nd and 5th. Seed 2, every 3, first clearance `GABCD TAXI HP A1 VIA A` reads back `Taxi holding point A6 via A, GABCD.`

If a readback error is given at sim time T, a correct `NEGATIVE` is accepted while the clock reads less than T plus `READBACK_CORRECT_SECONDS`. On the tick reaching that time an open error raises R7, and R7 closes the error: a later `NEGATIVE` for it gets `<CS> has nothing to correct.`, and that aircraft's next eligible readback may carry an error again under the formula. The correct value is the one the clearance gave: `NEGATIVE HP <point>` for a `TAXI`, `NEGATIVE RUNWAY <rwy>` for the others.

**Movement.** Aircraft statuses: `parked`, `pushing`, `ready`, `taxiing`, `stopped`, `holding`, `lining-up`, `lined-up`, `rolling`, `airborne`, `crossing`, `final`, `landing`, `vacated`. A go-around returns an arrival to `final`. The full path of a departure is parked, pushing, ready, taxiing (and stopped and back), holding, lining-up, lined-up, rolling, airborne. For an arrival it is final, landing, vacated.

A taxiing aircraft moves `speedMps` metres along its segment on every tick. `data-progress` is whole metres from the start of the segment in the direction of travel, and reaches the segment's length on the tick it gets there. The next tick puts it on the next segment at that segment's speed, with no metres carried over. On the last segment, the tick that reaches the end puts it at the node: `data-segment=""`, `data-node="<id>"`, `data-progress="0"`, status `holding`.

Worked example at Wrenfield: `GQRST` at `S3`, status `ready`, cleared `TAXI HP A1 VIA A` at 12:00:00.

| Sim time | Segment or node | Progress |
|---|---|---|
| 12:00:05 | `S3T` | 25 |
| 12:00:20 | `S3T` | 100 |
| 12:00:21 | `E1` | 10 |
| 12:00:40 | `E1` | 200 |
| 12:00:41 | `A2` | 10 |
| 12:01:10 | node `A1`, `holding` | 0 |

Route times: `S1` to `A1` 130 seconds, `S3` to `A1` 70 seconds, `S3` to `A6` 130 seconds.

Off a segment:

- `parked`, `pushing` and `ready` aircraft show their stand in `data-node`.
- `lining-up`, `lined-up`, `rolling`, `airborne` and `crossing` aircraft keep their holding point there.
- When `crossing` ends the aircraft is `taxiing` at the far crossing point, and the next tick puts it on its next segment.
- `final`, `landing` and `vacated` aircraft show the threshold node of their runway.

The runway is occupied from the moment a clearance puts an aircraft on it until it leaves: `lining-up`, `lined-up`, `rolling`, `crossing`, `landing`, and an aircraft that has overrun its holding point.

An `overrunsHold` departure reaching its holding point without a line-up clearance does not stop. On that tick R5 fires and it is on the runway with status `lining-up`, then `lined-up` after `LINEUP_SECONDS`. Its strip moves to `Line up` on TWR frequency, and any open offer ends with it. R5 is the only alert for that tick: R6 is never raised for an overrunning departure, neither `Late handoff` nor `Handoff not accepted`, whichever frequency it was on.

An arrival is `final` with `Due` dropping by one each tick. If `Due` reaches 0 with no landing clearance it goes around by itself, as the go-around event, with an `event` log row and no alert. A strip that is `airborne` or `vacated` is finished.

**Strip timers.** Each timer's text is exact and updates on each tick.

| Timer | Text | Shown | `data-near` at and below |
|---|---|---|---|
| wake | `Wake m:ss` | in Holding and Line up, while the wake minimum behind the last takeoff is still running for this strip's category | 0:15 |
| offer | `Offer m:ss` | on an open offer, on both copies | 0:15 |
| due | `Due m:ss` | an arrival's time to the threshold, only while it is `final` | 2:00 |
| slot | `Slot m:ss`, then `Slot late m:ss` | a departure's time left to the end of its slot tolerance (slot plus `SLOT_TOLERANCE_SECONDS`), from when the strip appears until takeoff; after that end, the time past it | 1:00 |

**Rule table.**

| ID | Name | Checked | Trigger | Exact alert text | Severity | Penalty |
|---|---|---|---|---|---|---|
| R1 | Runway occupied | clearance | `LINEUP`, `CLEARED TAKEOFF`, `CLEARED LAND` or `CROSS` while another aircraft occupies the runway | `Runway <rwy> occupied by <CS>.` | critical | 20 |
| R2 | Wake departure spacing | clearance | `CLEARED TAKEOFF` before the wake minimum behind the last takeoff, from that takeoff's start | `Wake: <required> required behind <CS> (<wake>), <elapsed> elapsed.` | warning | 15 |
| R3 | Arrival spacing | clearance | `LINEUP` or `CLEARED TAKEOFF` while any `final` arrival has `Due` of `ARRIVAL_PROTECT_SECONDS` or less | `Arrival <CS> due in <m:ss>; departure not allowed.` | warning | 15 |
| R4 | Taxi conflict | clearance | a `TAXI` route shares a segment with the remaining route of another `taxiing` or `stopped` aircraft in the opposite direction, or ends at a holding point another aircraft is taxiing to or `holding` at | `Taxi conflict on <segment or holding point>: <earlier CS> and <new CS>.` | warning | 10 |
| R5 | Runway incursion | tick | an aircraft goes beyond a holding point and onto the runway without a line-up, takeoff or crossing clearance | `Runway incursion at <point> by <CS>.` | critical | 30 |
| R6 | Handoff timing | tick | a departure stops at its final holding point (the one serving a threshold that its route ends at) on GND frequency, which an overrunning departure never does: `Late handoff: <CS> reached <point> on Ground.`; or an offer runs out: `Handoff not accepted: <CS>.` | as stated | advisory | 5 |
| R7 | Readback not corrected | tick | see Seeded readback errors | `Readback error not corrected: <CS>.` | advisory | 10 |
| R8 | Closed runway | clearance | `LINEUP`, `CLEARED TAKEOFF`, `CLEARED LAND` or `CROSS` for a closed runway | `Runway <rwy> is closed.` | critical | 20 |

- Refused outright, with no alert or penalty: everything in the Refusals list. Accepted, alerted and penalised, with the aircraft still doing it: R1 to R4 and R8. R5 to R7 are raised by the clock.
- One clearance can raise several rules, each its own alert and penalty, at the same sim time in this order: R8 alone if the runway is closed; otherwise R1, then R2, then R3.
- R4 raises one alert per other aircraft, in callsign order, naming the first shared segment in the new route's order, or the holding point.
- R1 is checked only when a clearance is given, and names the aircraft that went onto the runway first. R3 picks the arrival with the smallest `Due`. A departure counts as a leader for R2 from its takeoff start, and only the most recent takeoff counts.

Wake minimum, leader by follower, as `m:ss`. Exactly the minimum is allowed.

| Leader | L | M | H | J |
|---|---|---|---|---|
| J | 3:00 | 3:00 | 2:00 | 2:00 |
| H | 2:00 | 2:00 | 1:30 | 1:30 |
| M | 1:30 | 1:00 | 1:00 | 1:00 |
| L | 1:00 | 1:00 | 1:00 | 1:00 |

Worked examples:

- `GBULK` (H) started its takeoff at 12:03:48. `GLITE` (L), lined up, is cleared for takeoff at 12:05:00 with the runway free: `Wake: 2:00 required behind GBULK (H), 1:12 elapsed.`, penalty 15. `GLITE`'s strip showed `Wake 0:48` at 12:05:00.
- Same, but cleared at 12:04:10 with `GBULK` still `rolling`: first `Runway 27 occupied by GBULK.`, then `Wake: 2:00 required behind GBULK (H), 0:22 elapsed.`, penalty 35.
- Same, cleared at 12:05:48: no alert.
- `GDOWN` has `Due 0:47`: `GQRST LINEUP 27` gives `Arrival GDOWN due in 0:47; departure not allowed.` With `Due 2:01`, no alert. With `Due 2:00`, the alert with `2:00`.
- At Wrenfield, `GQRST` is taxiing from `S3` to `A6` and `GABCD` at `S1` is cleared `TAXI HP A1 VIA A`: `Taxi conflict on A4: GQRST and GABCD.` `A4` is the first segment they share in `GABCD`'s route, and the preview shows both `A4 R4` and `A3 R4`.

**Handoff.** `CONTACT TOWER` at time T opens an offer: the strip goes to GND Hand-off (`data-state="offered"`), a copy appears in TWR Incoming with `Offer 1:00`, and the offer ends on the tick reaching T plus `HANDOFF_OFFER_SECONDS`. The frequency stays GND until acceptance, so an offered strip stays with the sender. Until then the Incoming copy carries `data-frequency="GND"`, `data-state="offered"` and the same `data-version` as the Hand-off strip, and TWR commands for that aircraft get refusal 3. Aircraft keep moving during an offer.

- TWR accepts with `Ctrl+Right` on the strip, a drag to Holding or `button "Accept <CS>"`: the strip moves to Holding with `data-frequency="TWR"` and `data-state="active"`. The GND copy stays in Hand-off, muted, `data-state="transferred"`, and takes no more moves.
- GND recalls with `Ctrl+Left` or `button "Recall <CS>"` while the offer is open: the strip returns to Taxi, the TWR copy disappears, and no alert is raised.
- An offer that runs out raises R6 `Handoff not accepted: <CS>.`, removes the TWR copy and returns the strip to GND Taxi with `data-state="active"`.

**Concurrency.** Every strip has a `version`, starting at 1, that rises by one on every change to its bay, state, frequency, cleared text, holding point, remarks or emergency mark. Countdowns do not change it. The server's order wins, and exactly one of two moves on one version succeeds. A move or edit sent with an older version answers `409 {"error": "version_conflict", "message": "<CS> was changed by another seat first. Your action was not applied."}`. The loser's board shows that text in `alert "Strip notice"`, and shows the strip as the server has it straight away, even while its pushes are held. Worked example: TWR accepts `GABCD` and GND's recall arrives after it: GND sees the notice and the transferred copy.

**Events.** Each event writes an `event` log row at position `INS`, and scheduled events do the same at their sim time. Injected events are accepted while paused. `status "Runway notice"` always shows the newest notice.

| Kind | Effect | Notice | Log text |
|---|---|---|---|
| `closure` | The runway (both thresholds) is closed; later clearances raise R8 | `Runway <runway in use> closed` | `Runway <runway in use> closed.` |
| `reopen` | Clears the closure | `Runway <runway in use> reopened` | `Runway <runway in use> reopened.` |
| `go-around` | For an arrival that is `final`: the strip is in Arrivals, shows `GO AROUND`, `cleared none`, `Due 5:00` (from `GO_AROUND_SECONDS`). Any other aircraft gets `not_final` | none | `Go-around: <CS>.` |
| `emergency` | Band and `data-emergency="true"` on the strip and its symbol; every other `taxiing` aircraft becomes `stopped` at once, and refusal 10 applies | `Emergency <CS>: all traffic hold.` | `Emergency: <CS>.` |
| `end-emergency` | Clears it; stopped aircraft stay `stopped` until `CONTINUE TAXI`; the notice empties | none | `Emergency ended: <CS>.` |
| `wind` | The wind changes at once. The target runway is the threshold whose heading is within 90 degrees of the wind direction; with neither or both, nothing else changes | `Runway change to <rwy> in <m:ss>` when the target differs from the runway in use, counting down on each tick from `WIND_CHANGE_DELAY_SECONDS` | `Wind <ddd> at <n> kt.` |

When a runway change's countdown ends, the runway in use changes, every arrival's strip takes the new runway, the notice reads `Runway in use <rwy>`, and the log gains `Runway in use <rwy>.` Pre-filled clearances follow the runway in use. An automatic go-around writes `Go-around: <CS>.` at position `TWR`.

**Pause.** `Paused` shows on every client at once, ticks stop, and every command, strip move and strip edit answers the `paused` 409, whose message is refusal 1. For commands and moves it shows in `alert "Command error"`; for `Save strip` it shows in `alert "Strip error"` and the dialog stays open.

**Session end.** A session is `running` or `paused`, moving both ways, and then `ended`, with no way back. It ends when every traffic item is finished, when sim time reaches the scenario's start plus `durationSeconds`, or on `End exercise`. All clients then show `Open debrief`, and it writes the `event` row `Exercise ended.` at position `INS`. A second `End exercise` changes nothing.

**Seats.** A class member with no seat takes a free one, and a taken seat gets `seat_taken`. The instructor can take a free seat the same way. A person holds at most one seat in a session. A seat holder who disconnects keeps the seat for `SEAT_GRACE_SECONDS` of wall time and gets the same seat and board on return. After that the console shows the `Reassign` button, which frees the seat. Until then the holder can still return to it.

**Log.** Log rows have a sim time, a position (`GND`, `TWR` or `INS`), a kind (`command`, `readback`, `alert`, `event` or `note`) and text.

- For one accepted clearance the rows are command, then readback, then alerts in rule order, all at the same sim time.
- Handoffs write `event` rows at their position: `Handoff accepted: <CS>.` (TWR) and `Handoff recalled: <CS>.` (GND).
- Tick alerts take the position of the aircraft's frequency at that moment; for R5 that is the frequency before the overrun puts the strip on TWR.
- `Pin note` writes a `note` row at `INS`.
- Refused commands, pauses, speed changes and seats are not logged.

The same scenario, seed and commands at the same sim times give an identical log, breakdown and score.

**Score.** The score is derived once from the log: 100, less each violation's penalty, less slot delay. Slot delay: for each departure with a slot, wait = takeoff start (or the session end if it never took off) minus (slot time plus `SLOT_TOLERANCE_SECONDS`), and each full sim minute of wait costs 1. The floor is 0. The pass mark is 75: 75 or more is `Passed`, below is `Not passed`.

Worked examples: one R2 and one R6 give exactly `80`. A departure with slot 12:10:00, tolerance 5 minutes, taking off at 12:18:30, waits 3:30 and costs 3. R5 plus R1 plus R2 plus R3 gives `20`. Five R5 give `0`.

**Worked exercise.** Scenario `Wake check`, Wrenfield, runway 27, wind 270 at 8 kt, start 12:00:00, `readbackErrorEvery` 0. Departures `GBULK` B744 H IFR stand S3 and `GLITE` PA28 L VFR stand S4, both holding point A1, both appearing at 0, no slots.

| Second | Seat | Action |
|---|---|---|
| 0 | GND | `GBULK PUSH APPROVED` |
| 30 | GND | `GBULK TAXI HP A1 VIA A` |
| 40 | GND | `GBULK CONTACT TOWER` |
| 41 | TWR | moves GBULK to Holding |
| 60 | GND | `GLITE PUSH APPROVED` |
| 100 | TWR | `GBULK LINEUP 27` |
| 120 | TWR | `GBULK CLEARED TAKEOFF 27` |
| 120 | GND | `GLITE TAXI HP A1 VIA A` |
| 191 | GND | `GLITE CONTACT TOWER` |
| 192 | TWR | moves GLITE to Holding |
| 192 | TWR | `GLITE LINEUP 27` |
| 212 | TWR | `GLITE CLEARED TAKEOFF 27` |

Result: at 12:03:10 `Late handoff: GLITE reached A1 on Ground.`; at 12:03:32 `Wake: 2:00 required behind GBULK (H), 1:32 elapsed.`; the session ends by itself at 12:04:02 (242 sim seconds) when GLITE is airborne; score 80, `Passed`, 25 timeline rows. Replay at second 50: `GBULK` on `S3T` 100. At second 70: `GBULK` on `E1` 200. At second 101: `GBULK` `lining-up`.

**Replay.** The replay map shows the exact persisted state of each second, where 0 is the session's first sim time.

**Reports.**

- The server builds the file, stores it in MinIO, and answers with the bytes only after MinIO confirms the object.
- Repeat exports return the stored bytes and send no second notice: there is one notice per session and file kind, to the first person who exported it.
- The notice is sent after the object is stored, and the app reports it as sent only once Mailpit accepts it.
- CSV: RFC 4180, CRLF, header `sim_time,position,kind,callsign,rule,penalty,text`, one row per timeline row, and then one row with kind `score` and text `Score <n> of 100`. Fields with commas are quoted (a readback is). `rule` and `penalty` are filled only on alert rows, and `penalty` is a plain positive number. `callsign` is the command's first word on `command` and `readback` rows. On alert rows it is the aircraft that was cleared for R1, R2, R3, R4 and R8 (the follower of R2, the departure of R3 and the `<new CS>` of R4, never the occupying aircraft or the arrival named in the text), and the aircraft named in the alert for R5, R6 and R7. On `event` rows it is the aircraft named in the text (`Handoff accepted`, `Handoff recalled`, `Go-around`, `Emergency` and `Emergency ended`), and empty for runway, wind and `Exercise ended.` rows. It is empty on `note` and `score` rows.
- CSV examples with the worked exercise: `12:00:30,GND,readback,GBULK,,,"Taxi holding point A1 via A, GBULK."`, then `12:03:32,TWR,alert,GLITE,R2,15,"Wake: 2:00 required behind GBULK (H), 1:32 elapsed."`, and last `12:04:02,INS,score,,,,Score 80 of 100`.
- PDF: real extractable text, each line on one line and never wrapped. Page 1 has these lines: `Runup Bay debrief`, `Scenario: <name>`, `Aerodrome: <name>`, `Students: <name> (GND), <name> (TWR)` (`none` for an empty seat), `Score: <n> of 100`, `Result: <Passed|Not passed>`, then one line per breakdown row as `<HH:MM:SS> <rule id> <text> -<penalty>`, then `Total <n>`.
- Timeline pages follow, 30 rows per page, each row `<HH:MM:SS> <position> <kind> <text>`. Every page ends `Training only - page <n> of <m>`. The worked exercise gives 2 pages.

**Records.** Each finished exercise appears in the record of each seated student.

- `Timing` is `On time`, or `Late` when today is after the assignment's `dueOn` at the session's end; the due day itself is on time. A session with no assignment is `On time`.
- A late attempt is listed and counts in `Attempts`, but never sets `Best score` or `Status`. An assignment with only late attempts keeps `Best score: none` and `Status: Not attempted`.
- `Status` follows the best on-time score against the pass mark.
- A student sees only their own record, and the class's instructor sees all of them.

**Accounts.**

- A password has at least 10 characters.
- Signing up sends the verification mail. Opening its link marks the address verified and shows heading `Email verified.` with a link to `/signin`.
- A link older than `VERIFY_TTL_HOURS` shows `This verification link has expired.`, and signing up again with that unverified address sends a new link.
- A registered address gets `422 {"errors": {"email": "This email is already registered."}}`.
- A signed-out visit to a page that needs sign-in goes to `/signin?next=<path>`, with the path URL-encoded and without a query string, and signing in there lands on that path.
- A verified account with no class membership may create one school and becomes its instructor, and creating a class lands on `/classes/<id>`.

**Invitations.** `Student emails` takes addresses separated by commas or new lines. An address counts as sent only after Mailpit accepts its mail. An invitation lasts `INVITE_TTL_HOURS` and works once. Joining lands on `/classes/<id>`. An address already registered, at this or another school, signs in with its password and joins the class too; its `Name` is ignored. Accepting an invitation marks the address verified, for a new account and for an existing unverified account that gave its correct password, with no verification mail and no link to open, so a later sign-in with that address and password succeeds.

**Layout import.** A layout is one JSON document: `{"name", "code", "runways": [{"id", "lengthM", "thresholds": [{"id", "node", "heading"}]}], "nodes": [{"id", "kind", "x", "y", "serves"}], "segments": [{"id", "from", "to", "lengthM", "speedMps", "taxiway"}]}`. Node `kind` is `threshold`, `holding`, `junction` or `stand`. `serves` is only on a `holding` node and names the runway threshold it serves, or `cross` for a holding point at a runway crossing. `x` and `y` are map units, 0 to 1000 and 0 to 500.

The file's name and declared type are ignored: only its content decides, so a `.json` file of plain text is refused, as is any non-JSON file such as an SVG. The size check comes first: over `LAYOUT_MAX_BYTES` answers `413 {"error": "layout_too_large", "message": "Layout file is over the limit of <LAYOUT_MAX_BYTES> bytes."}`, and the limit itself is allowed. Then checks run over the file in order of lines and every problem is listed, each with the 1-based line of the file holding the offending key:

- `Line <n>: this is not valid JSON.` This is the only line shown; `n` is the line of the first syntax error. A document that parses but is not an object with the five top-level keys gives it with `n` 1.
- `Line <n>: node <id> is listed more than once.` (line of the second `"id"`)
- `Line <n>: segment <id> starts at unknown node <node>.` (line of `"from"`)
- `Line <n>: segment <id> ends at unknown node <node>.` (line of `"to"`)
- `Line <n>: segment <id> must be longer than 0 m.` (line of `"lengthM"`)
- `Line <n>: holding point <id> serves unknown runway <threshold>.` (line of `"serves"`)

A faulty file is refused with `422 {"error": "layout_invalid", "lines": [...]}`, and nothing is kept. A valid file is stored byte for byte as submitted, line endings and spacing included. Only the parsed working copy that scenarios use is normalised.

Worked file. As printed it gives exactly `Line 42: segment P1T ends at unknown node Q7.` With `Q7` changed to `J1` it is valid.

```json
{
  "name": "Marram Flats",
  "code": "MRF",
  "runways": [
    {
      "id": "09/27",
      "lengthM": 1200,
      "thresholds": [
        {"id": "09", "node": "M09", "heading": 90},
        {"id": "27", "node": "M27", "heading": 270}
      ]
    }
  ],
  "nodes": [
    {"id": "M09", "kind": "threshold", "x": 100, "y": 100},
    {"id": "M27", "kind": "threshold", "x": 900, "y": 100},
    {"id": "H1", "kind": "holding", "x": 800, "y": 200, "serves": "27"},
    {"id": "H2", "kind": "holding", "x": 200, "y": 200, "serves": "09"},
    {"id": "J1", "kind": "junction", "x": 500, "y": 200},
    {"id": "P1", "kind": "stand", "x": 500, "y": 400}
  ],
  "segments": [
    {
      "id": "B1",
      "from": "J1",
      "to": "H1",
      "lengthM": 300,
      "speedMps": 10,
      "taxiway": "B"
    },
    {
      "id": "B2",
      "from": "H2",
      "to": "J1",
      "lengthM": 300,
      "speedMps": 10,
      "taxiway": "B"
    },
    {
      "id": "P1T",
      "from": "P1",
      "to": "Q7",
      "lengthM": 200,
      "speedMps": 5,
      "taxiway": "apron"
    }
  ]
}
```

**Scenario refusals.** `Save scenario` is refused in `alert "Scenario error"` with `Callsign <CS> is used more than once.`, `Stand <stand> is not on <aerodrome name>.`, or `Callsign <text> must be 5 capital letters.`, and nothing is saved.

### Services (DP-02, DP-05, DP-51, DP-52)

**Postgres** holds schools, members, aerodromes, scenarios, sessions, the sim clock, strips, the log, violations, scores and records. The schema is applied idempotently on every serve.

**MinIO**, bucket `S3_BUCKET`:

- `layouts/<aerodrome id>/original.json`: the imported file, byte for byte.
- `reports/<session id>/report.csv` and `reports/<session id>/report.pdf`: the exported reports.

Outage behaviour, with nothing kept and no mail sent in each case:

- Export: `503 {"error": "storage_unavailable", "message": "Reports cannot be saved right now. Try again shortly."}`, shown in `alert "Export error"`.
- Import: `503 {"error": "storage_unavailable", "message": "Layouts cannot be saved right now. Try again shortly."}`, shown in `alert "Import error"`.
- Download original: `503 {"error": "storage_unavailable", "message": "Layout files cannot be read right now. Try again shortly."}`, shown in the same alert.

Everything else, exercises included, keeps working.

**Mailpit**, sender `MAIL_FROM`:

| Mail | To | Subject | Body |
|---|---|---|---|
| Verification | the new account | `Verify your Runup Bay email` | one link to `/verify?token=<token>` |
| Invitation | each invited address | `Join <class name> on Runup Bay` | one link to `/invite/<token>` |
| Report notice | the person exporting | `Report ready: <scenario name>` | names the file kind, `CSV` or `PDF` |

Links are absolute, built on `APP_PUBLIC_URL`. When Mailpit refuses or is unreachable, signup and invitations answer `503 {"error": "mail_unavailable", "message": "Mail cannot be sent right now. Try again shortly."}` and show nothing as sent.

### Seed data (DP-05, DP-11)

At start the app holds only the two built-in fictional aerodromes, with ids `wrenfield` and `kestrel-down`, available to every school, with no original file. There are no seeded people or schools: all people, schools and scenarios named in this brief are invented, and tests create them through the grading setup route.

Wrenfield:

```json
{"name": "Wrenfield", "code": "WRN",
 "runways": [{"id": "09/27", "lengthM": 1600, "thresholds": [
   {"id": "09", "node": "R09", "heading": 90},
   {"id": "27", "node": "R27", "heading": 270}]}],
 "nodes": [
   {"id": "R09", "kind": "threshold", "x": 100, "y": 100},
   {"id": "R27", "kind": "threshold", "x": 900, "y": 100},
   {"id": "A1", "kind": "holding", "x": 850, "y": 200, "serves": "27"},
   {"id": "A6", "kind": "holding", "x": 150, "y": 200, "serves": "09"},
   {"id": "J2", "kind": "junction", "x": 650, "y": 200},
   {"id": "J3", "kind": "junction", "x": 500, "y": 200},
   {"id": "J4", "kind": "junction", "x": 350, "y": 200},
   {"id": "W", "kind": "junction", "x": 350, "y": 320},
   {"id": "E", "kind": "junction", "x": 650, "y": 320},
   {"id": "S1", "kind": "stand", "x": 300, "y": 420},
   {"id": "S2", "kind": "stand", "x": 400, "y": 420},
   {"id": "S3", "kind": "stand", "x": 600, "y": 420},
   {"id": "S4", "kind": "stand", "x": 700, "y": 420}],
 "segments": [
   {"id": "A2", "from": "J2", "to": "A1", "lengthM": 300, "speedMps": 10, "taxiway": "A"},
   {"id": "A3", "from": "J3", "to": "J2", "lengthM": 300, "speedMps": 10, "taxiway": "A"},
   {"id": "A4", "from": "J4", "to": "J3", "lengthM": 300, "speedMps": 10, "taxiway": "A"},
   {"id": "A5", "from": "A6", "to": "J4", "lengthM": 300, "speedMps": 10, "taxiway": "A"},
   {"id": "W1", "from": "W", "to": "J4", "lengthM": 200, "speedMps": 10, "taxiway": "W"},
   {"id": "E1", "from": "E", "to": "J2", "lengthM": 200, "speedMps": 10, "taxiway": "E"},
   {"id": "S1T", "from": "S1", "to": "W", "lengthM": 100, "speedMps": 5, "taxiway": "apron"},
   {"id": "S2T", "from": "S2", "to": "W", "lengthM": 100, "speedMps": 5, "taxiway": "apron"},
   {"id": "S3T", "from": "S3", "to": "E", "lengthM": 100, "speedMps": 5, "taxiway": "apron"},
   {"id": "S4T", "from": "S4", "to": "E", "lengthM": 100, "speedMps": 5, "taxiway": "apron"}]}
```

Kestrel Down. The pairs `B2`-`B3` and `C2`-`C3` are joined only by a runway crossing, which takes `CROSS_SECONDS` and is not a segment.

```json
{"name": "Kestrel Down", "code": "KDN",
 "runways": [{"id": "09/27", "lengthM": 1400, "thresholds": [
   {"id": "09", "node": "K09", "heading": 90},
   {"id": "27", "node": "K27", "heading": 270}]}],
 "nodes": [
   {"id": "K09", "kind": "threshold", "x": 100, "y": 250},
   {"id": "K27", "kind": "threshold", "x": 900, "y": 250},
   {"id": "N1", "kind": "stand", "x": 300, "y": 50},
   {"id": "N2", "kind": "stand", "x": 700, "y": 50},
   {"id": "NB", "kind": "junction", "x": 300, "y": 120},
   {"id": "NC", "kind": "junction", "x": 700, "y": 120},
   {"id": "B2", "kind": "holding", "x": 300, "y": 200, "serves": "cross"},
   {"id": "C2", "kind": "holding", "x": 700, "y": 200, "serves": "cross"},
   {"id": "B3", "kind": "holding", "x": 300, "y": 300, "serves": "cross"},
   {"id": "C3", "kind": "holding", "x": 700, "y": 300, "serves": "cross"},
   {"id": "SB", "kind": "junction", "x": 300, "y": 380},
   {"id": "SC", "kind": "junction", "x": 700, "y": 380},
   {"id": "D1", "kind": "holding", "x": 850, "y": 380, "serves": "27"},
   {"id": "D6", "kind": "holding", "x": 150, "y": 380, "serves": "09"}],
 "segments": [
   {"id": "N1T", "from": "N1", "to": "NB", "lengthM": 100, "speedMps": 5, "taxiway": "apron"},
   {"id": "N2T", "from": "N2", "to": "NC", "lengthM": 100, "speedMps": 5, "taxiway": "apron"},
   {"id": "N3", "from": "NB", "to": "NC", "lengthM": 400, "speedMps": 10, "taxiway": "N"},
   {"id": "B1", "from": "NB", "to": "B2", "lengthM": 100, "speedMps": 10, "taxiway": "B"},
   {"id": "C1", "from": "NC", "to": "C2", "lengthM": 100, "speedMps": 10, "taxiway": "C"},
   {"id": "B4", "from": "B3", "to": "SB", "lengthM": 100, "speedMps": 10, "taxiway": "B"},
   {"id": "C4", "from": "C3", "to": "SC", "lengthM": 100, "speedMps": 10, "taxiway": "C"},
   {"id": "D2", "from": "SC", "to": "D1", "lengthM": 300, "speedMps": 10, "taxiway": "D"},
   {"id": "D3", "from": "SB", "to": "SC", "lengthM": 400, "speedMps": 10, "taxiway": "D"},
   {"id": "D4", "from": "D6", "to": "SB", "lengthM": 300, "speedMps": 10, "taxiway": "D"}]}
```

## Technical requirements

### Deployment (DP-57)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22.

The server and the client are both TypeScript, and the app server also serves the WebSocket. `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`:

```json
{"_schema": "run-manifest-v1", "install": "npm ci", "build": "npm run build", "serve": "npm run start"}
```

The server binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT`, and `/api/health` answers as stated in API. The schema is applied on serve, not only at build.

### Configuration and secrets (DP-57, DP-61)

Every value is read at start from the environment, never hard-coded and never sent to the browser, except the public values in `/api/config`.

Services: `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`.

App: `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`, `GRADING_KEY`, `SIM_CLOCK` (`wall` or `stepped`, default `wall`), `APP_TODAY`, `APP_TIME_ZONE` (IANA name, default `UTC`).

Timers and limits are all whole numbers, sim timers count sim seconds, and each grading instance may set any of them:

| Env | Default | Meaning |
|---|---|---|
| `PUSH_SECONDS` | 30 | pushback from clearance to `ready` |
| `LINEUP_SECONDS` | 20 | holding point to `lined-up` |
| `TAKEOFF_ROLL_SECONDS` | 30 | takeoff clearance to `airborne` |
| `LANDING_ROLL_SECONDS` | 40 | touchdown to `vacated` |
| `CROSS_SECONDS` | 30 | crossing a runway from holding point to holding point |
| `HANDOFF_OFFER_SECONDS` | 60 | life of a handoff offer |
| `ARRIVAL_PROTECT_SECONDS` | 120 | R3 window before an arrival's threshold time |
| `GO_AROUND_SECONDS` | 300 | new `Due` after a go-around |
| `READBACK_CORRECT_SECONDS` | 15 | time allowed for a `NEGATIVE` |
| `READBACK_ERROR_EVERY` | 5 | default readback error interval, 0 = never |
| `SIM_SEED_OFFSET` | 0 | added to every scenario seed |
| `SLOT_TOLERANCE_SECONDS` | 300 | slot tolerance before slot delay counts |
| `WIND_CHANGE_DELAY_SECONDS` | 120 | delay before a wind change moves the runway in use |
| `SEAT_GRACE_SECONDS` | 120 | wall seconds a disconnected seat is held |
| `INVITE_TTL_HOURS` | 168 | invitation life |
| `VERIFY_TTL_HOURS` | 24 | verification link life |
| `COMMANDS_PER_MINUTE` | 120 | per seat, wall clock |
| `LAYOUT_MAX_BYTES` | 200000 | layout upload limit in bytes, the limit itself allowed |

Grading instances:

- **Main:** a `GRADING_KEY`, `SIM_CLOCK=stepped`, `APP_TODAY=2027-04-12`, `APP_TIME_ZONE=Europe/London`, every timer at its default except `READBACK_ERROR_EVERY=0`, `LAYOUT_MAX_BYTES=20000`, `SEAT_GRACE_SECONDS=5` and `COMMANDS_PER_MINUTE=600`, and `MAIL_FROM=Runup Bay <training@runupbay.test>`.
- **Storage down:** everything as main, except `S3_ENDPOINT` pointing at `http://127.0.0.1:9` and its own empty database. Health still answers 200.

### Server boundary (DP-07, DP-43, DP-61)

- Same origin only: no cross-origin headers, the WebSocket refuses another origin, and the session cookie is HTTP-only and same-site.
- Request limits: JSON bodies up to 1,000,000 bytes, the limit itself allowed, and the grading setup route up to 5,000,000 bytes; above that `413 {"error": "too_large"}`. The layout import has its own limit from Business rules.
- The server never serves source files, the manifest, environment files or credentials, and any path outside the published pages and built assets answers 404.
- Every action is decided on the server: a role hidden in the interface is also refused by the route, in the order given in API.
- A service unreachable at boot never stops the server starting. It keeps retrying Postgres, keeps answering health, and treats MinIO and Mailpit as Services states.
- If Postgres is unreachable while serving, API routes other than health answer `503 {"error": "database_unavailable", "message": "Runup Bay cannot reach its database. Try again shortly."}`.
- The browser makes no external requests: fonts, icons and all code are served by the app.

### Browser support and performance (DP-53, DP-55)

Current Chromium at 375x812, 768x1024 and 1280x800, with mouse, keyboard and touch. The board is usable within three seconds of opening a session. A pushed update shows within a quarter of a second of arriving. The app works without a service worker and with the browser clock paused, apart from the timed motion in Motion and effects.

## Working rules

- IF-01: `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` names every shipped package with its licence, where shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- IF-03: Every shipped package and bundled font uses an MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or OFL-1.1 licence.
- IF-04: Postgres, MinIO and Mailpit are the only external services, with no other datastore, queue, cache or PDF service.
- IF-05: The PDF is built inside the app with open-licensed libraries, with no headless browser among the shipped packages.
- IF-06: No source file or built asset loads a font, script, style or image from another host.
- IF-07: The app registers no service worker.

## Engineering standards

- The code is idiomatic strict TypeScript, and names match the domain terms in this brief: strip, bay, seat, clearance, readback, offer, holding point.
- Each domain rule, such as a state transition, a rule check, a wake minimum or a score line, is decided in exactly one place in the source.
- One parser serves both the route preview and command execution.
- Every API error uses the one shape published in API.
- No abstraction has a single implementation.
- There is no dead, commented-out or unreachable code, and no defensive check for an impossible state.
- The browser code holds no copy of the rule table, wake table or timers: it renders what the server pushes.
- There are no features beyond this brief.
