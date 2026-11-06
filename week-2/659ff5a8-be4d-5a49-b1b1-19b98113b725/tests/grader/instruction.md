# Pylonworks Conecount Paddock

Conecount Paddock is a club workspace for grassroots autocross: timed, one-car-at-a-time runs through a cone course in a parking lot, run by volunteer car clubs. It takes one event from driver registration through check-in with a signed waiver, work-station rota, keyboard timing entry, live raw, class and indexed standings, a server-timed protest window and corrections log, to signed final results that are published as a PDF and emailed to drivers. Each region's club gets its own workspace (tenant), and the founder operator onboards new clubs. The app uses four backend services: Postgres is the system of record, Gotenberg renders waiver and results PDFs, MinIO stores those PDFs as objects that are never changed, and the Mailpit SMTP sink receives every email. Out of scope: payments, outside sign-in providers, team or multi-day events, timing hardware integration, and any datastore besides Postgres and MinIO.

## Problem and users

A regional club runs 8 to 14 autocross events a season, and each event has 60 to 150 drivers. Every driver must also work a course station (start, finish or a numbered corner) during a heat they are not driving in. Today the event chair takes registrations in one hosted system and exports a spreadsheet into old desktop timing software. Work assignments are written on a paper clipboard at the grid. The timing chief types raw times and cone counts on a laptop in a trailer. Indexed (handicap) results go up as static pages that drivers keep refreshing on their phones. A wrong index factor or a missed cone changes the trophies. A time corrected after provisional results has no record of who changed it or why, so protests fail because there is nothing to check. The club also pays twice: once in registration fees and again in volunteer hours spent re-typing data.

Users:

- **Event chair** (weekly): opens an event, sets heats and the season index table, decides protests and publishes final results that hold up when a driver protests.
- **Timing chief** (weekly): enters each run's raw time, cones, DNF or rerun from the keyboard as fast as cars finish, and corrects mistakes on the record.
- **Worker chief** (weekly): fills every course station in each heat with drivers who are not running in that heat.
- **Driver** (weekly): registers a car and class, checks in and signs the waiver, claims a work station, files a protest if needed, and follows live raw, class and indexed standings on a phone in the paddock.
- **Founder operator** (daily): onboards new club workspaces and watches that waivers, result PDFs and emails keep flowing for every club.

## Journeys

1. **Onboard a club.** Start: the operator is signed in on the operator screen, and the club does not exist. The operator fills in the onboarding form with club slug, name, time zone and the first chair's details. End: the club appears in the club workspaces table with zero events, and the new chair signs in to an empty Events screen.
2. **Set up an event.** Start: the chair is signed in, and the club has an index table in force. The chair creates an event with date, venue, registration cutoff, runs per driver, the heat for each class and the list of stations, then opens registration. End: the event shows "Registration open" with its cutoff, and the left rail lists each heat with its classes and open-station count.
3. **Register, check in and claim a station.** Start: a new driver has the club's join link on a phone. The driver creates an account, registers a car in a class and gets a confirmation email with car number and run heat. The driver claims a station in a heat they do not drive in and gets an assignment email. On event morning, after registration closes, they type their name to sign the waiver and check in. End: the event screen shows the driver checked in, with their car number, run heat and work station.
4. **Time a heat.** Start: the event is running, and the timing chief is on the timing screen with heat 1 running. The chief moves through the run grid with the arrow keys, types each time and cone count, and presses Enter after each car. Each result is announced, and focus moves to the next car. The chief then switches the running heat to 2. End: every run in heat 1 is recorded, and live standings show every entry with its best times.
5. **Follow live results in the paddock.** Start: a driver opens live results on a phone. They pick the Indexed view and filter to their class. When their run is committed, their card plays the cone-to-rank settle in place. End: the card sits at its new position with a rank-change badge, and the scroll position and filter are unchanged.
6. **Correct, protest and finalise.** Start: provisional results are posted, and the protest window is open. The timing chief corrects a missed cone and gives a reason. A driver files a protest about that car. The chair opens the protest, reads the correction entries beside it, and denies or upholds it with a note. End: once the server reports the window closed, the chair sets results final.
7. **Publish final results.** Start: the event is final. The chair opens the publish screen and publishes. End: the screen shows the publish time, checksum and a download link. Each checked-in driver has a final-results email with the PDF link, and the event appears in season standings.
8. **Mid-season index update and newsletter export.** Start: the season has a published event. The chair loads a new index table with a later effective date, then opens season standings and exports the CSV. End: the earlier event still shows its original factors, later events show the new ones, and the CSV downloads with every formula-like cell neutralised.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Health check** GET /api/health answers 200 with {"status":"ok"} whenever Postgres is reachable, even while the PDF renderer, object storage or mail server is down.
- **DP-02 — Sign-in sessions** Seeded and newly created users sign in with email and password, receive an HttpOnly session cookie, and sign out, as specified in API.
- **DP-03 — Role permissions** Each action is limited to the roles listed for its endpoint, and any other signed-in user receives 403.
- **DP-04 — Club onboarding** The founder operator onboards a new club workspace from the operator screen, and the new chair can sign in and sees an empty Events screen for that club.
- **DP-05 — Tenant isolation** A club's events, registrations, runs, results, corrections, PDFs and exports never appear to or respond for a user of another club, which gets 404.
- **DP-06 — Operator delivery overview** The operator sees per-club counts and the most recent renderer, storage or mail failure for each club, and never sees driver names or results.
- **DP-07 — Driver signup** A driver creates their own account in a club through the club's join link and is signed in at once.
- **DP-08 — Event setup rules** The chair creates and edits draft events with heats, class-to-heat assignments, stations and a registration cutoff, with validation and stale-version rejection as specified in API.
- **DP-09 — Event lifecycle** Events move only along the published state machine, and every other move is rejected with 409.
- **DP-10 — Event setup journey** The chair creates an event in the browser, assigns every class to a heat, lists the stations, opens registration and sees it listed as open.
- **DP-11 — Registration cutoff** The server rejects registrations at and after the event's cutoff in the club's time zone and reports the event as registration closed from that moment.
- **DP-12 — Registration rules** A driver registers once per event in a class the event runs, with a car number unique within that class, and of simultaneous registrations for the same number exactly one wins.
- **DP-13 — Registration confirmation email** Each registration sends the driver a confirmation email with car number, class and run heat, retried until the mail server accepts it as qualified in Services.
- **DP-14 — Server-reported registration status** The event screen shows registration as open or closed from the server's status, even when the device clock is wrong.
- **DP-15 — Driver registration journey** A new driver joins the club, registers a car for an open event on a phone and sees the registration confirmation with car number and run heat.
- **DP-16 — Waiver check-in** Checking in renders the signed waiver PDF, stores it in object storage under its published key and only then marks the driver checked in.
- **DP-17 — Check-in outages** When the PDF renderer or object storage is down, check-in answers 503 with the published copy and the driver stays not checked in.
- **DP-18 — Phone check-in journey** A registered driver on a phone opens the check-in dialog, types their name to sign and sees themselves checked in.
- **DP-19 — Station claim rules** A driver may hold one station per event, never in the heat they drive in, and each station holds at most one worker.
- **DP-20 — Last-station race** Of simultaneous claims for the same open station exactly one succeeds and every other claimant gets 409 with the station-taken copy.
- **DP-21 — Unfilled station counters** Each heat's open-station counter always equals the number of stations without a worker after claims, assignments, releases and withdrawals.
- **DP-22 — Work-assignment email** Every claim or assignment sends the worker an assignment email naming the station and heat, retried until accepted as qualified in Services.
- **DP-23 — Withdrawal** A driver withdraws before the event starts, which frees their car number and their station.
- **DP-24 — Rota journey** The worker chief fills open stations from the rota screen and sees each heat's counter and station list change in place without a reload.
- **DP-25 — Run commit** The timing chief commits each run as a time with cones, a DNF or a granted rerun, guarded by event state, running heat, check-in and run status.
- **DP-26 — Indexed time** The server computes each run's adjusted and indexed times once, at commit, by the published formula and returns them as three-decimal text.
- **DP-27 — Commit replay** A repeated commit with the same idempotency key returns the original response without recording a second run, and the key reused with a different body is rejected.
- **DP-28 — Keyboard run grid** The run grid is fully operable by keyboard: arrow keys move between cells, typing enters values, Enter commits and Alt+G jumps into the grid from any control on the timing screen.
- **DP-29 — Timing announcements** After each commit or correction the timing screen announces the published result sentence in its polite live region.
- **DP-30 — Running heat and live strip** The chair or timing chief sets which heat is running, and a thin orange strip reading the running heat shows on event screens only while the event is running.
- **DP-31 — Heat timing journey** The timing chief starts a heat, enters a full set of runs from the keyboard and the live results reflect every run.
- **DP-32 — Standings** The standings API ranks entries by indexed, class and raw view with the published tie and no-time rules and carries each entry's latest rank-change text.
- **DP-33 — Live in-place standings** The live results page applies each committed run within two seconds without a reload, keeping the scroll position, view and class filter.
- **DP-34 — Cone-to-rank settle** On a committed run the entry's row plays the published settle sequence and ends in the server's order with the server's rank-change text.
- **DP-35 — Reduced-motion settle** With reduced motion requested the settle shows its end state at once, with the rank-change badge, a static cone count and the same announcement.
- **DP-36 — Responsive layouts** Live results show one card column at 375 by 812, two card columns at 768 by 1024 and the full timing table at 1280 by 800, and no screen scrolls sideways at those sizes.
- **DP-37 — Touch-reachable rows** Every standings row has a runs button at least 44 by 44 pixels that a tap expands and collapses.
- **DP-38 — Paddock results journey** A driver on a phone opens live results, filters to their class, and watches their row update when their run is committed.
- **DP-39 — Run corrections** Changing a committed run requires a written reason, recomputes its times with the event's stored factor and is refused once results are final.
- **DP-40 — Immutable correction log** Every correction is recorded with who made it, when, the old and new values and the reason, and any attempt to change or delete an entry is rejected with 405.
- **DP-41 — Correction dialog keyboard** The Correct run dialog opens with Enter on a recorded cell, keeps Tab and Shift+Tab inside it, closes with Escape and returns focus to that cell.
- **DP-42 — Server-timed protest window** Posting provisional results opens a protest window that the server closes after the configured length, and setting results final is refused until then.
- **DP-43 — Protests** Registered drivers file protests while the window is open, and the chair decides each one once, and results cannot go final while any protest is undecided.
- **DP-44 — Server-decided window on screen** The event and protest screens show the protest window as open or closed from the server's status and keep Set results final disabled while the server says it is open, whatever the device clock says.
- **DP-45 — Protest decision journey** A driver files a protest about a corrected run, and the chair reads the run's correction entries beside it, decides it and sets results final after the window closes.
- **DP-46 — Publish pipeline** Publishing renders the final results PDF, stores it, records its checksum, has every checked-in driver's results email accepted and only then marks the event published.
- **DP-47 — Publish outages** If rendering, storage or mail fails, publishing answers 503, the event stays final, no results link works and a retry completes without duplicate emails.
- **DP-48 — Renderer outage banner** While the PDF renderer is down the publish screen shows the published outage banner word for word and keeps the publish button disabled.
- **DP-49 — Final results PDF** The stored results PDF has one Raw, one Class and one Indexed section, each starting on its own page, listing every entry with its published values.
- **DP-50 — Publish journey** The chair publishes final results from the publish screen and sees the published time, checksum and a working download link, and each driver receives the results email.
- **DP-51 — Index table loading** The chair loads a dated index table, which the server validates and refuses when it would change factors already used by timed runs or drop classes later events use.
- **DP-52 — Dated factors** Every event uses the index table in force on its date on every surface, so events before a new table's effective date keep their original factors.
- **DP-53 — Index table journey** The chair loads a mid-season index table from the index tables screen and sees an earlier event keep its factors while a later event shows the new ones.
- **DP-54 — Season points** Season standings sum each driver's published-event points, computed from stored indexed times by the published formula.
- **DP-55 — Standings CSV** The season standings CSV export has the published columns and neutralises every cell that begins with a formula character.
- **DP-56 — Season standings journey** The chair opens season standings after publishing an event, sees the points table and downloads the CSV for the club newsletter.
- **DP-57 — API contract** Every API error uses the published error shape and precedence, and request content type and body size are enforced as published.
- **DP-58 — Server boundary** The server is same-origin only, never serves source files, the run manifest or credentials, and starts even when the renderer, storage or mail server is unreachable.
- **DP-59 — Credentials from environment** Every service URL and credential is read from the published environment variables at start and never hard-coded or sent to the browser.
- **DP-60 — Night timing look** Screens use the published nocturnal look: near-black ground, orange only for live and penalty state, and right-aligned monospaced times to three decimals.

## Frontend

### Screens and layout (DP-04, DP-10, DP-15, DP-18, DP-24, DP-31, DP-36, DP-38, DP-50, DP-53, DP-56)

Browser routes:

| Route | Who | Shows |
|---|---|---|
| `/signin` | anyone | Sign-in form. After sign-in, the operator goes to `/operator` and everyone else to `/events`. Any other route opened without a session redirects here. |
| `/join/<clubSlug>` | anyone | Driver signup form headed `Join <club name>`. |
| `/events` | club members | The club's events in date order, each with name, date, venue and status label. The chair also sees a `New event` button. |
| `/events/<id>` | club members | Event overview: name, date, venue, status label, registration status line, protest window line, the signed-in driver's registration panel (register, withdraw, check in), and the chair's lifecycle buttons. |
| `/events/<id>/timing` | timing chief, chair | Running heat selector, run grid and the timing announcements region. |
| `/events/<id>/rota` | club members | Stations per heat with workers, each heat's open-station counter, and claim, release and assign controls. |
| `/events/<id>/live` | club members | Live standings with view tabs and a class filter. |
| `/events/<id>/protests` | club members | Protest list. Drivers file protests here, and the chair decides them next to each subject car's correction entries. |
| `/events/<id>/corrections` | club members | The read-only correction log. |
| `/events/<id>/publish` | chair | Publish status, the renderer outage banner, the publish button and the published result. |
| `/index-tables` | club members (loading is chair only) | Every index table by effective date, and the load form. |
| `/season` | club members | Season standings for the current year in the club's time zone, and the CSV export. |
| `/operator` | operator | Club workspaces table and the onboarding form. |

Every event route shows a navigation `nav "Event sections"` with links `Overview`, `Timing`, `Rota`, `Live results`, `Protests`, `Corrections`, `Publish`. Each user sees only the links their roles can open.

Layout rules for the three published viewports:

- **1280 by 800 (any width of 1024 pixels or more):** event screens have a fixed left rail, `navigation "Heats"`, with one item per heat in the format given in Public screens and controls. Each heat links to the rota. The central area holds the screen's content. On the live results page, the central area is the full timing table `table "Live standings"` with columns Pos, Car, Class, Driver, Car description, Best adjusted, Best indexed, Change, Runs.
- **768 by 1024 (widths from 600 to 1023 pixels):** the left rail becomes `combobox "Heat"` at the top of the content, in the format given in Public screens and controls. Live standings become `list "Live standings"`, a grid of cards in exactly two equal columns, read left to right and then down in standings order.
- **375 by 812 (widths under 600 pixels):** the same select at the top, and live standings as `list "Live standings"` in one stacked column of cards in standings order. Each card shows position, car number and class, driver name, best indexed time (or best adjusted time in the Raw and Class views), the rank-change badge and the runs button.
- No breakpoint between these thresholds changes which layout a published viewport gets. Exactly one of `table "Live standings"` or `list "Live standings"` is rendered at a time.
- No screen scrolls sideways at any of the three viewports. The run grid scrolls inside its own box when its columns are wider than the screen.

### Public screens and controls (DP-02, DP-04, DP-07, DP-10, DP-14, DP-18, DP-24, DP-28, DP-30, DP-37, DP-41, DP-44, DP-48, DP-50, DP-53, DP-55)

Only the controls and regions in this table are public; everything else is the builder's choice. `<n>`, `<class>`, `<k>`, `<h>` and `<station>` stand for a car number, class code, run number, heat number and station name.

| Screen | Role and accessible name | Visible copy or behaviour |
|---|---|---|
| Sign in | `heading "Sign in to Conecount Paddock"`, `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| Join | `heading "Join <club name>"`, `textbox "Full name"`, `textbox "Email"`, `textbox "Password"`, `button "Create driver account"` | |
| All forms | `alert` headed `Fix these fields` | Lists one link per invalid field. The link text is the field's error message, and activating it focuses that field. |
| Any signed-in screen | `button "Sign out"` | |
| Event screens | `status "Live heat"` | The thin strip along the top edge, reading `Heat <h> running`. Present only while the event is running. |
| Event screens, 1024 pixels and wider | `navigation "Heats"`, one `link "Heat <h>"` per heat | Each item shows three lines: the link `Heat <h>`, the heat's class codes in the event's order joined by `, ` (for example `SS, STR`), and the heat's counter `<count> stations open` (`1 station open` when singular). For example, with the seed data at start, Points 9 at Airpark shows `Heat 1`, `SS, AS, BS, STR`, `6 stations open`. |
| Event screens, under 1024 pixels | `combobox "Heat"` | One option per heat, labelled `Heat <h>`, with heat 1 selected at first. Below it, the selected heat's class line and counter line appear in the same format as a rail item. Choosing an option shows that heat's lines; on the rota screen it also scrolls to that heat. |
| Events | `button "New event"`, `dialog "New event"` with `textbox "Event name"`, `textbox "Date"`, `textbox "Venue"`, `textbox "Registration cutoff"`, `spinbutton "Runs per driver"`, `spinbutton "Heats"`, one `combobox "Heat for <class>"` per class in the index table in force on the chosen date, `textbox "Stations"` (one station per line), `button "Save event"`, `button "Cancel"` | Each `Heat for <class>` combobox has the options `Not run`, then `Heat 1` up to `Heat <heats>`, where `<heats>` is the `Heats` value. It starts at `Not run`, and a class left at `Not run` is not in the event. |
| Event overview | `heading "<event name>"`, status label text, registration line, protest window line | The registration line and protest window line formats are in Feedback states. |
| Event overview (chair) | `button "Open registration"`, `button "Close registration"`, `button "Start event"`, `button "Post provisional results"`, `button "Set results final"` | Each button shows only when its move is legal from the current status. `Set results final` shows in Provisional and is disabled while the server reports the window open or any protest undecided. |
| Event overview (driver) | `form "Register car"` with `combobox "Class"`, `textbox "Car number"`, `textbox "Car description"`, `button "Register"`; `button "Withdraw"`; `button "Check in"` | |
| Check-in | `dialog "Check in and sign waiver"` with the waiver text, `textbox "Type your full name to sign"`, `button "Sign and check in"`, `button "Cancel"` | |
| Timing | `combobox "Running heat"`, `grid "Run grid"`, `status "Timing announcements"` | `Running heat` has one option per heat, labelled `Heat <h>`, with the server's running heat selected. |
| Timing grid | one `row` per registration whose run heat is the heat selected, with `gridcell "Car <n> <class> run <k> time"` and `gridcell "Car <n> <class> run <k> cones"` for each run | A time cell shows the raw time with three decimals, `DNF`, `RRN` (rerun granted) or nothing (pending). A row whose driver is not checked in shows `Not checked in`. |
| Timing | `dialog "Correct run"` headed `Correct car <n> <class> run <k>`, with `radio "Time"`, `radio "DNF"`, `textbox "Raw time"`, `spinbutton "Cones"`, `textbox "Reason"`, `button "Save correction"`, `button "Cancel"` | |
| Rota | one `heading "Heat <h>: <count> stations open"` per heat (`1 station open` when singular), `status "Rota updates"` | |
| Rota rows | `button "Claim <station>, heat <h>"`, `button "Release <station>, heat <h>"`, `button "Assign <station>, heat <h>"` | A row shows the worker's name and car, or `Open`. |
| Rota | `dialog "Assign worker"` with `combobox "Driver"`, `button "Assign"`, `button "Cancel"` | The combobox lists only drivers who are allowed to take that station, sorted by name. Each option is labelled `<driver name>, car <n> <class>`, for example `Avery Lindqvist, car 12 SS`. |
| Live results | `tablist "Standings view"` with `tab "Indexed"`, `tab "Class"`, `tab "Raw"`; `combobox "Class filter"` (first option `All classes`); `table "Live standings"` or `list "Live standings"`; `status "Standings updates"` | |
| Live rows | `button "Runs for car <n> <class>"` with expanded state; the badge text; position `P<pos>` or `No time` | Expanding shows each run's raw time, cones, adjusted and indexed time, or `DNF` or `RRN`. |
| Protests | `button "File a protest"`, `dialog "File a protest"` with `combobox "Car protested"`, `textbox "Protest details"`, `button "File protest"`, `button "Cancel"`; `status "Protest updates"` | `Car protested` lists every registration in the event, ordered by class code then car number. Each option is labelled `Car <n> <class>, <driver name>`, for example `Car 12 SS, Avery Lindqvist`. |
| Protests (chair) | `region "Protest against car <n> <class>"` containing `list "Corrections for car <n> <class>"`, `textbox "Decision note"`, `button "Uphold"`, `button "Deny"` | Each list item reads `Run <k>: <before> to <after> by <name> at <HH:MM>, reason: <reason>`. `<before>` and `<after>` are `<raw time> +<cones>`, with the raw time to three decimals and the cone count always shown (for example `51.907 +0`), or `DNF`. `<HH:MM>` is the correction's time in the club's time zone on a 24-hour clock. |
| Corrections | `table "Correction log"` with columns Time, Car, Run, Before, After, By, Reason | No edit or delete controls. Time is `<YYYY-MM-DD HH:MM>` in the club's time zone on a 24-hour clock. Car is `<n> <class>`, and Run is `<k>`. Before and After use the same `<raw time> +<cones>` or `DNF` format as the protest correction list. By is the actor's name, and Reason is the reason text. |
| Publish | `heading "Publish final results"`, `alert` (renderer outage banner), `button "Publish final results"`, `status "Publish progress"`, `link "Download results PDF"` | After publishing, also shows `Published at <YYYY-MM-DD HH:MM>` in the club's time zone and `Checksum <sha256 hex>`. |
| Index tables | one `table "Index table effective <YYYY-MM-DD>"` per table (Class, Factor); `textbox "Effective date"`, `textbox "Factors"`, `button "Load table"`; `status "Index table updates"` | The event overview also shows `Index table effective <YYYY-MM-DD>` with the event's factor for each of its classes. |
| Season | `heading "Season standings <year>"`, `table "Season standings"` (Position, Driver, Car, Class, Events, Points), `button "Export standings CSV"`, `status "Season updates"` | |
| Operator | `table "Club workspaces"` (Club, Time zone, Events, Drivers, Published, Last delivery failure); `form "Onboard club"` with `textbox "Club slug"`, `textbox "Club name"`, `textbox "Time zone"`, `textbox "Chair name"`, `textbox "Chair email"`, `textbox "Chair password"`, `button "Onboard club"`; `status "Operator updates"` | Last delivery failure reads `None` or `<Renderer|Storage|Mail> at <YYYY-MM-DD HH:MM> UTC`. |

### Interactions (DP-24, DP-28, DP-33, DP-37, DP-41, DP-44)

**Run grid (keyboard first).** The grid uses one tab stop: Tab enters the grid at the last focused cell, and Tab again leaves it. Inside the grid:

- Arrow Left and Right move one cell along the row: Car, Class and Driver, then run 1 time, run 1 cones, run 2 time, run 2 cones, through the last run's cones. Arrow Up and Down move to the same column in the row above or below. Home and End go to the first and last cell of the row.
- In a pending or rerun-granted time cell, typing a digit or `.` starts a draft value, and Backspace deletes the last character. `D` (either case) sets the draft to DNF, and `R` (either case) sets it to a rerun. In a cones cell, digits set the draft cone count (up to two digits), and Backspace deletes. An empty cones draft means zero cones.
- The time and cones drafts for one run of one row belong together. Moving between cells keeps them, and Escape in either cell clears that run's draft.
- Enter on either cell of a pending or rerun-granted run commits that run with its drafts. On success, focus moves to the same run's time cell in the next row, or stays on the last row. Enter with no time draft commits nothing and shows the empty-entry error from Feedback states.
- Enter on a committed or corrected cell opens `dialog "Correct run"`, prefilled with the current values. Tab and Shift+Tab cycle only through the dialog's controls, wrapping from last to first and back. Escape or `Cancel` closes it without changes. Closing returns focus to the cell that opened it.
- `Alt+G` moves focus into the grid at the first pending time cell of the running heat. It works whichever control on the timing screen has focus, including the `Running heat` combobox and any button.
- Changing `Running heat` applies at once (no save button) and reloads the grid rows for that heat.

**Dialogs everywhere** (`New event`, `Check in and sign waiver`, `Assign worker`, `File a protest`, `Correct run`): open with focus on the first field. Tab and Shift+Tab wrap inside the dialog, and Escape closes it. Focus returns to the control that opened it.

**Live results.** Selecting a tab or a class filter value re-orders and filters the list in place, with no navigation. New standings arrive without a reload, as DP-33 states; the page keeps its scroll position, selected tab and filter. Tapping or clicking `Runs for car <n> <class>` toggles the run details open or closed. Each row's controls work by touch, mouse and keyboard.

**Rota.** Claim, release and assign update the station row and the heat counter in place as soon as the server replies. Other people's changes appear within two seconds without a reload. If a claim loses a race, the row shows the winner's name at once.

**Event and publish screens.** The event overview, protest and publish screens re-read the event from the server every 10 seconds, when the tab regains focus, and after every action. The publish screen also re-reads the renderer status on load and every 10 seconds. These screens never derive whether registration or the protest window is open, or whether the renderer is up, from the device clock or a local timer. The device clock may be wrong.

### Visual design (DP-60)

- **Ground and surfaces:** a near-black page like asphalt at night. Panels, cards and the left rail sit on a slightly lighter charcoal surface. Rows and sections are divided by hairline mid-grey rules, not boxes or shadows.
- **Ink:** text is a pale cool grey-white. Secondary text is the same tone, dimmed, and still meets WCAG 2.2 AA contrast. Primary buttons are pale-ink filled with dark text, and secondary buttons are outlined in ink.
- **Accent:** one cone orange, used only for live and penalty state: the live heat strip, cone chips, the penalty readout, the DNF strike and the settle highlight. Buttons, links, headings and focus rings never use orange. Focus rings are a clear pale-ink outline around the focused control.
- **Type:** headings use Chakra Petch, a squared technical display face. Body text uses IBM Plex Sans. Every time, cone count, position and car number uses JetBrains Mono with tabular figures, right-aligned in its column to three decimals, so the decimal points line up down the column. Each heading level is about a third larger than the level below it.
- **Density and composition:** compact rows, about one and a half lines of body text tall. The composition is a fixed left rail of heats and stations, with the central timing table as the hero.
- **Touch and contrast:** every control is large enough to tap comfortably, at least 44 pixels in each direction (the DP-37 rule applies to every button). All text and controls meet WCAG 2.2 AA contrast on their background.

### Motion and effects (DP-30, DP-34, DP-35)

- **Press and hover feedback:** buttons and rows brighten slightly within about a tenth of a second.
- **Dialogs:** fade in while rising a short distance in under a quarter of a second, and fade out faster.
- **Live heat strip:** appears when a heat starts and disappears when the event leaves running. It is a still line and never pulses, sweeps or loops.
- **No unnamed decorative loops:** nothing on any screen animates continuously.
- **Cone-to-rank settle (signature):** shows the timing chief and every driver how a run became a result. It plays on the live results page for the entry whose run was just committed or corrected, in every view and layout:
  1. The row's raw time digits roll from the previous value to the new one, over about a fifth of a second.
  2. One orange cone chip drops into the row per cone, about an eighth of a second apart. With each chip, the orange penalty readout steps up by 2.000 seconds (`+2.000` after the first chip, `+4.000` after the second, reaching 2.000 times the cone count). With zero cones, no chip or readout appears.
  3. The indexed time (or the adjusted time in the Raw and Class views) appears, as returned by the server.
  4. The row slides from its old position to its new one over about half a second. It starts quickly and settles softly. The rows it passes each shift by one row height in the same time, and the badge appears with the server's rank-change text.

  A DNF committed on a pending or rerun-granted run shows the raw time struck through in orange, with `DNF`. Its best times cannot change, so the row does not move. A correction that turns a timed run into a DNF shows the same struck-through `DNF`, then runs step 4. The row slides to the position the server's standings give it, which is among the `No time` entries when no valid time is left, and the badge shows the server's rank-change text. The whole sequence ends within about one and a half seconds plus an eighth of a second per cone. At the end, the order of the rows matches the server's standings for the current view and filter. The settle is time-based, not scroll-linked. If another update arrives mid-settle, the running settle jumps to its end state, and the next one begins.
- **Reduced motion:** when the device asks for reduced motion, every value appears at once in its final state, and rows re-order instantly. The cone chips become a static text count (`1 cone`, `<count> cones`). The rank-change badge and the live-region announcement stay. Dialogs appear without the rise.

### Feedback states (DP-13, DP-14, DP-17, DP-20, DP-22, DP-29, DP-33, DP-35, DP-44, DP-47, DP-48)

Every async action shows a visible pending state on its control: the control is disabled, and its label or cell is dimmed. Its result is announced in the named polite live region for that screen. Field errors appear under the field and in the `Fix these fields` alert. All copy below renders character for character, with straight apostrophes and straight quotes. Placeholders: `<n>` is the car number, `<class>` the class code, `<h>` the heat number, `<k>` the run number, `<station>` the station name, `<event name>` the event's name, and `<indexed>` the indexed time with three decimals. `<class pos>` and `<overall pos>` are the entry's class and indexed positions after the change, as returned by the server.

| Action | Region | Pending | Success | Errors and outages |
|---|---|---|---|---|
| Sign in | `alert` on form | `Signing in` | redirect | 401: `Email or password is incorrect.` |
| Join | `alert` on form | `Creating account` | redirect to `/events` | 409 email taken: `That email already has an account.` |
| Save event | `Event updates` | `Saving event` | `Event saved as draft.` | 412: `Someone else changed this event. Reload to see the latest.` |
| Lifecycle buttons | `Event updates` | `Updating event` | `Event is now <status label>.` | Illegal move: `That step is not available from <status label>.`; window open: `The protest window is still open.`; protests pending: `Decide every protest before setting results final.` |
| Register | `Event updates` | `Registering` | `Registered: car <n> <class>, run heat <h>.` If the confirmation email is still pending, this line is added: `Your confirmation email is delayed. We'll keep trying.` | Closed: `Registration for this event is closed.`; already registered: `You are already registered for this event.`; number taken: `Car <n> is already taken in <class>.` |
| Withdraw | `Event updates` | `Withdrawing` | `You have withdrawn from <event name>.` | After start: `Withdrawal closed once the event starts.` |
| Check in | `Event updates` | `Signing your waiver` | `Checked in. Your signed waiver is saved.` | Name mismatch (field): `Type your name exactly as registered.`; renderer down: `Waiver signing is unavailable right now. Check in at the registration table.`; storage down: `We could not save your signed waiver. You are not checked in yet; try again shortly.` |
| Claim | `Rota updates` | `Claiming` | `You are working <station> in heat <h>.` If the assignment email is pending, this line is added: `Your assignment email is delayed. We'll keep trying.` | Taken: `That station was just taken. Pick another.`; own heat: `You drive in heat <h>. Pick a station in another heat.`; already holding one: `You already have a work station for this event.` |
| Assign | `Rota updates` | `Assigning` | `<driver name> is working <station> in heat <h>.` | Same conflict copy as Claim |
| Release | `Rota updates` | `Releasing` | `<station> in heat <h> is open again.` | |
| Commit run | `Timing announcements` | The cell value dims until the reply arrives. This is not announced, so the announcement queue stays free for results. | Time: `Car <n> <class>: indexed <indexed>, P<class pos> in <class>, P<overall pos> overall`; DNF with a ranked entry: `Car <n> <class>: DNF, P<class pos> in <class>, P<overall pos> overall`; DNF with no time yet: `Car <n> <class>: DNF, no time yet`; rerun: `Car <n> <class>: rerun granted for run <k>` | Empty: `Type a time, D for DNF or R for rerun.`; format: `Run time must look like 45.123.`; heat not running: `Car <n> runs in heat <h>, which is not running.`; not checked in: `Car <n> is not checked in.`; already recorded: `Run <k> for car <n> is already recorded. Press Enter to correct it.` |
| Save correction | `Timing announcements` | `Saving correction` | `Car <n> <class> run <k> corrected: indexed <indexed>, P<class pos> in <class>, P<overall pos> overall`. For a DNF, `indexed <indexed>` becomes `DNF`. | Reason (field): `Give a reason of at least 5 characters.`; no change (field): `The correction must change the time, cones or outcome.`; locked: `Results are final. Times can no longer change.` |
| Live update | `Standings updates` | none | `Car <n> <class>: <badge>`, using the badge for the selected view | |
| File protest | `Protest updates` | `Filing protest` | `Protest filed against car <n> <class>.` | `The protest window has closed.` |
| Decide protest | `Protest updates` | `Saving decision` | `Protest upheld.` or `Protest denied.` | |
| Publish | `Publish progress` | `Publishing final results` | `Final results published.` | Renderer: `Results PDF renderer is offline. Publishing is paused and drivers have not been emailed.`; storage: `Results storage is offline. Nothing was published and drivers have not been emailed.`; mail: `The mail server did not accept the results emails. Results are not published yet.` |
| Load index table | `Index table updates` | `Loading table` | `Index table effective <YYYY-MM-DD> loaded.` | Runs exist: `An event on or after <YYYY-MM-DD> already has timed runs.`; classes missing: `Missing classes used by later events: <codes joined by ", ">.`; date taken: `A table already starts on <YYYY-MM-DD>.` |
| Export CSV | `Season updates` | `Preparing CSV` | `Standings CSV downloaded.` | |
| Onboard club | `Operator updates` | `Creating workspace` | `Club <club name> is ready. <chair name> can sign in now.` | `That club slug is taken.` or `That email already has an account.` |

**Status lines.**

- **Registration line:** `Registration closes <YYYY-MM-DD> at <HH:MM>`, showing the cutoff in the club's time zone, while the server reports `registrationOpen: true`. Otherwise `Registration closed`. The register button is disabled while closed.
- **Protest window line:** `Protest window open until <HH:MM>`, showing the server's close time in the club's time zone, while the server reports `protestWindowOpen: true`. `Protest window closed` once the event is provisional and the server reports it closed.
- **Status labels:** `Draft`, `Registration open`, `Registration closed`, `Running`, `Provisional`, `Final`, `Published`.

**Renderer outage banner.** While `GET /api/events/<id>/publication` reports the renderer unavailable, the publish screen shows an `alert` with exactly the renderer copy from the Publish row above, and `Publish final results` is disabled. The banner disappears, and the button enables (if the event is final), on the first re-read that reports the renderer ok.

## Backend

### API (DP-02 to DP-09, DP-11, DP-12, DP-16, DP-19, DP-20, DP-23, DP-25, DP-27, DP-32, DP-39, DP-40, DP-42, DP-43, DP-46, DP-51, DP-54, DP-55, DP-57)

**General.**

- All endpoints live under `/api` and speak JSON (`application/json`), except the PDF, CSV and health routes noted.
- The session is a cookie named `paddock_session` (HttpOnly, SameSite=Lax, Path=/). Every endpoint except health, `POST /api/session` and signup requires it.
- Times in responses are ISO 8601 UTC strings ending in `Z`. Dates are `YYYY-MM-DD`. Every time-of-run value (raw, adjusted, indexed) is a string with exactly three decimals. Factors are strings with four decimals.

**Error shape.** Every error body is `{"error":"<code>","message":"<sentence>"}`. A 422 also carries `"fields":{"<field>":"<message>"}`. The `message` is free text; the UI shows the copy from Feedback states.

**Error precedence**, for the whole API:

1. 403 `cross_origin` (Server boundary). This is checked before the session, so a cross-origin request without a session also gets 403.
2. 415 `unsupported_media_type`, then 413 `payload_too_large` (Server boundary). When both apply, 415 wins.
3. 401 `unauthenticated`
4. 404 `not_found`: unknown id, or an id belonging to another club
5. 403 `forbidden`
6. Idempotent replay or key conflict
7. 409 or 412 state conflicts, in the order listed on the endpoint
8. 422 `validation`
9. 503 dependency unavailable

**Idempotency.** `POST` registrations, run commits and publish accept an optional `Idempotency-Key` header of 1 to 100 characters, scoped to the signed-in user and kept for 24 hours.

- The same key with an identical body returns the stored status and body, with header `Idempotent-Replayed: true`, and changes nothing.
- The same key with a different body returns 409 `idempotency_key_reused`.
- Only responses below 500 are stored, so a retry after an outage runs again.

**Roles.** `operator` (no club); within a club, `chair`, `timing` and `workers`. Every club member may act as a driver. The chair may do everything the timing chief and worker chief may.

**Event object:**

```
{"id","name","date","venue","timeZone","registrationCutoff":"YYYY-MM-DDTHH:MM" (club local),
 "registrationCutoffUtc","runsPerDriver","heats":[{"number":1,"classes":["SS"]}],
 "stations":["Start"],"status","registrationOpen":bool,"runningHeat":int|null,
 "provisionalAt":str|null,"protestWindowClosesAt":str|null,"protestWindowOpen":bool,
 "indexTable":{"id","effectiveDate"},"factors":{"SS":"0.8270"},"version":int,
 "publishedAt":str|null,"resultsChecksum":str|null,"serverTime"}
```

Status values: `draft`, `registration_open`, `registration_closed`, `running`, `provisional`, `final`, `published`.

**Run object:** `{"id","runNumber","status":"pending"|"committed"|"corrected"|"rerun_granted","outcome":"time"|"dnf"|"rerun"|null,"rawTime","cones","adjustedTime","indexedTime","factor","committedAt","committedBy":{"id","name"}|null}`. Values that do not apply are null.

**Registration object:** `{"id","eventId","driver":{"id","name"},"classCode","carNumber","carDescription","runHeat","checkedIn","checkedInAt","waiver":{"key","checksum"}|null,"station":{"id","name","heat"}|null,"confirmationEmail":"sent"|"pending"}`

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | | 200 `{"status":"ok"}` | |
| `POST /api/session` | anyone | `{"email","password"}` | 200 `{"user":{"id","name","email","roles":[],"club":{"slug","name","timeZone"}\|null}}` + cookie | 401 `invalid_credentials` |
| `GET /api/session` | signed in | | 200 `{"user"}` | |
| `DELETE /api/session` | signed in | | 204, cookie cleared | |
| `POST /api/clubs/<clubSlug>/signup` | anyone | `{"name"` 1–80 chars, `"email"`, `"password"` at least 10 chars`}` | 201 `{"user"}` + cookie, no staff roles | 404 club; 409 `email_taken`; 422 |
| `POST /api/operator/clubs` | operator | `{"slug"` matching `^[a-z][a-z0-9-]{2,30}$`, `"name"` 1–80, `"timeZone"` IANA name, `"chair":{"name","email","password"}}` | 201 `{"club":{"slug","name","timeZone"},"chair":{"user"}}` | 409 `slug_taken`, `email_taken`; 422 |
| `GET /api/operator/clubs` | operator | | 200 `{"clubs":[{"slug","name","timeZone","eventCount","driverCount","publishedCount","lastDeliveryFailure":{"service":"renderer"\|"storage"\|"mail","eventId","at"}\|null}]}` | |
| `GET /api/index-tables` | member | | 200 `{"tables":[{"id","effectiveDate","factors":{},"createdAt","createdBy":{"id","name"}\|null}]}`, oldest first | |
| `POST /api/index-tables` | chair | `{"effectiveDate","factors":{"<CLASS>":"0.8270"}}` | 201 `{"table"}` | 409 `effective_date_taken`, then `effective_date_conflict`, then `classes_in_use`; 422 |
| `GET /api/events` | member | | 200 `{"events":[event]}` by date | |
| `POST /api/events` | chair | `{"name"` 1–80, `"date"`, `"venue"` 1–80, `"registrationCutoff"`, `"runsPerDriver"` 1–6, `"heats"`, `"stations"` 1–20 unique names of 1–40 chars`}` | 201 `{"event"}` (draft) | 422 |
| `GET /api/events/<id>` | member | | 200 `{"event"}` | |
| `PATCH /api/events/<id>` | chair | any create field plus required `"version"` | 200 `{"event"}`, version +1 | 409 `event_locked` (not draft); 412 `stale_version`; 422 |
| `POST /api/events/<id>/transition` | chair | `{"to":"<status>"}` | 200 `{"event"}` | 409 `illegal_transition`, then `protest_window_open`, then `protests_pending` |
| `POST /api/events/<id>/running-heat` | timing | `{"heat"}` | 200 `{"event"}` | 409 `event_not_running`; 422 |
| `GET /api/events/<id>/registrations` | member | | 200 `{"registrations":[registration]}` | |
| `POST /api/events/<id>/registrations` | member | `{"classCode","carNumber"` integer 1–999, `"carDescription"` 1–80`}` | 201 `{"registration"}` | 409 `registration_closed`, then `already_registered`, then `car_number_taken`; 422 |
| `DELETE /api/registrations/<id>` | the driver or chair | | 204 | 409 `withdrawal_closed` |
| `POST /api/registrations/<id>/check-in` | the driver or chair | `{"signature"}` | 201 `{"registration"}` | 409 `check_in_closed`, then `already_checked_in`; 422 `fields.signature`; 503 `renderer_unavailable`, `storage_unavailable` |
| `GET /api/registrations/<id>/waiver.pdf` | the driver or chair | | 200 `application/pdf` | 404 when not checked in |
| `GET /api/events/<id>/rota` | member | | 200 `{"heats":[{"number","unfilled","stations":[{"id","name","worker":{"registrationId","driverName","carNumber","classCode"}\|null}]}]}` | |
| `POST /api/stations/<id>/claim` | member | `{}` | 201 `{"station","registration"}` | 409 `rota_locked`, `not_registered`, `already_assigned`, `own_heat`, `station_taken`, in that order |
| `POST /api/stations/<id>/assign` | workers | `{"registrationId"}` | 201 `{"station","registration"}` | the same 409s as claim, for that registration; 422 |
| `DELETE /api/stations/<id>/claim` | the worker on it, workers | | 204 | 409 `rota_locked`, then `station_open` |
| `GET /api/events/<id>/runs?heat=<h>` | timing | | 200 `{"entries":[{"registrationId","carNumber","classCode","driverName","runHeat","checkedIn","runs":[run]}]}`, every run slot present, by class then car number | 422 heat |
| `POST /api/registrations/<id>/runs/<runNumber>` | timing | `{"outcome":"time","rawTime","cones"}` or `{"outcome":"dnf","cones"?}` or `{"outcome":"rerun"}` | 201 `{"run","entry":{"registrationId","carNumber","classCode","position","classPosition","rawPosition","bestAdjusted","bestIndexed"},"rankChange":{"indexed","class","raw"}}` | 404 run number outside 1..runsPerDriver; 409 `event_not_running`, `heat_not_running`, `not_checked_in`, `run_already_committed`, in that order; 422 |
| `POST /api/runs/<id>/corrections` | timing | `{"outcome":"time"\|"dnf","rawTime"?,"cones","reason"` 5–500 chars`}` | 201 `{"run","correction","entry","rankChange"}` | 409 `results_locked`, then `run_not_committed`; 422 |
| `GET /api/events/<id>/corrections[?registrationId=]` | member | | 200 `{"corrections":[{"id","runId","registrationId","carNumber","classCode","runNumber","actor":{"id","name"},"at","reason","before":{"outcome","rawTime","cones","adjustedTime","indexedTime"},"after":{…}}]}`, newest first | |
| `PUT`, `PATCH`, `DELETE /api/corrections/<id>` | anyone signed in | | never succeeds | 405 `audit_immutable` (after 401 and 404) |
| `GET /api/events/<id>/standings?view=indexed\|class\|raw[&class=<code>]` | member | | 200 `{"eventId","status","runningHeat","view","updatedAt","rows":[{"registrationId","carNumber","classCode","driverName","carDescription","position","classPosition","rawPosition","bestAdjusted","bestIndexed","lastChange":{"runNumber","at","rankChange":{"indexed","class","raw"}}\|null,"runs":[run]}]}` | 422 view or class |
| `POST /api/events/<id>/protests` | registered driver in the event | `{"registrationId","text"` 10–1000 chars`}` | 201 `{"protest"}` | 409 `not_registered`, then `protest_window_closed`; 422 |
| `GET /api/events/<id>/protests` | member | | 200 `{"protests":[{"id","filedBy":{"id","name"},"subject":{"registrationId","carNumber","classCode","driverName"},"text","filedAt","status":"pending"\|"upheld"\|"denied","decisionNote","decidedBy","decidedAt"}]}` | |
| `POST /api/protests/<id>/decision` | chair | `{"decision":"upheld"\|"denied","note"` 5–1000`}` | 200 `{"protest"}` | 409 `results_locked`, then `protest_decided`; 422 |
| `GET /api/events/<id>/publication` | chair | | 200 `{"status","renderer":"ok"\|"unavailable","publishedAt","pdfKey","checksum","emailsAccepted","emailsTotal"}` | |
| `POST /api/events/<id>/publish` | chair | `{}` | 200 `{"event","publication"}` | 409 `already_published`, then `not_final`; 503 `renderer_unavailable`, `storage_unavailable`, `mail_unavailable` |
| `GET /api/events/<id>/results.pdf` | member | | 200 `application/pdf` | 404 `not_published` |
| `GET /api/season?year=<yyyy>` | member | | 200 `{"year","events":[{"id","name","date"}],"rows":[{"position","driverId","driverName","carDescription","classCode","events","points"}]}` | 422 year |
| `GET /api/season.csv?year=<yyyy>` | member | | 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="season-standings-<yyyy>.csv"` | 422 year |

Any other `/api` path answers 404 `not_found`. An operator calling club endpoints gets 403. When `year` is omitted, it is the current year in the club's time zone.

### Business rules (DP-03, DP-05, DP-09, DP-11, DP-12, DP-19 to DP-21, DP-23, DP-25, DP-26, DP-32, DP-39, DP-40, DP-42, DP-43, DP-46, DP-47, DP-51, DP-52, DP-54, DP-55)

**Event state machine.** The legal moves through `transition` are:

- `draft` → `registration_open`
- `registration_open` → `registration_closed`
- `registration_closed` → `running`, which sets `runningHeat` to 1
- `running` → `provisional`, which clears `runningHeat` and opens the protest window
- `provisional` → `final`

`final` → `published` happens only through publish. Every other move, including any move to the current status, to `draft` or to `published`, answers 409 `illegal_transition`. Transitions are judged on the reported status.

**Registration cutoff.** `registrationCutoff` is a local date and time in the club's time zone, and it must be earlier than 00:00 on the event date (422 otherwise). Registration is accepted only while the stored status is `registration_open` and server time is before the cutoff. At or after the cutoff, registration answers 409 `registration_closed`. From that moment the event reports `status: "registration_closed"` and `registrationOpen: false` without anyone acting.

**Event setup.** Each event has 2 to 4 heats, numbered 1 to n. Every class listed in a heat must exist in the index table in force on the event's date (see Index tables), and no class may appear in two heats; both rules answer 422. Stations are the same named list for every heat, so the event has (stations × heats) stations, each with its own id. Edits are allowed only in `draft`. A `PATCH` whose `version` is not the current version answers 412 `stale_version` and changes nothing.

**Registration.**

- One registration per driver per event (409 `already_registered`).
- `classCode` must be in one of the event's heats (422). The registration's `runHeat` is the heat that holds its class.
- Car number is unique per class within an event (409 `car_number_taken`). When several requests race for the same class and number, exactly one gets 201, and the others get 409.
- A driver may re-register after withdrawing.

**Withdrawal.** Allowed only in `registration_open` and `registration_closed` (409 `withdrawal_closed` otherwise). It deletes the registration, frees the car number and releases the driver's station.

**Check-in.**

- Allowed only in `registration_closed` and `running` (409 `check_in_closed`), and once per registration (409 `already_checked_in`).
- The signature must equal the driver's name after trimming, ignoring case (422).
- The waiver is rendered and stored first. The registration is marked checked in only after the object is stored and its SHA-256 checksum is recorded. Any failure leaves it not checked in.

**Work rota.**

- Claims and assignments are allowed in `registration_open`, `registration_closed` and `running`; otherwise 409 `rota_locked`.
- The worker must be registered for the event (409 `not_registered`) and hold no other station in it (409 `already_assigned`).
- A driver may not work a station in the heat they drive in (409 `own_heat`).
- A station holds at most one worker. Of simultaneous claims or assignments for one open station, exactly one gets 201, and all others get 409 `station_taken`. The rota then shows only the winner.
- Release empties the station (409 `station_open` if it was already empty).
- A heat's `unfilled` count always equals the number of its stations with no worker, after any claim, assignment, release or withdrawal.

**Runs.**

- A run commit needs the event in `running` (409 `event_not_running`), the entry's run heat equal to `runningHeat` (409 `heat_not_running`), the driver checked in (409 `not_checked_in`), and the run slot `pending` or `rerun_granted` (409 `run_already_committed`).
- Validation (422): `rawTime` matches two or three digits, a point and three digits, between `10.000` and `999.999` inclusive. `cones` is an integer from 0 to 30 inclusive.
- `time` sets status `committed`. `dnf` sets status `committed` with null times. `rerun` sets status `rerun_granted` with null values, and that slot may be committed again.
- Run states: `pending` → `committed` → `corrected` (each further correction keeps it `corrected`), and `pending` → `rerun_granted` → `committed`.

**Indexed time.**

- adjusted = raw + 2.000 × cones.
- indexed = round half up of (adjusted × factor) to three decimals, computed in exact decimal arithmetic.
- `factor` is the event's factor for the entry's class from the index table in force on the event's date. It is stored on the run at commit. The server computes both values once per commit or correction, and the browser only displays them.
- Example with seed data: SS factor 0.8270 and raw 51.907 with 0 cones give indexed `42.927`. Example of the half-up rule: adjusted 40.006 with a factor of 0.7500 gives 30.0045, which becomes `30.005`.

**Standings.**

- An entry's best adjusted and best indexed times come from its runs with outcome `time` and status `committed` or `corrected`.
- `position` ranks entries by best indexed time across the event. `classPosition` ranks entries within the class by best adjusted time. `rawPosition` ranks entries across the event by best adjusted time.
- Ties go to the lower car number, then the class code in alphabetical order.
- Entries with no valid time have null positions. They come after all ranked entries, ordered by class code then car number, and show `No time`.
- Row order: the `indexed` view sorts by position; the `class` view sorts by class code, then class position; the `raw` view sorts by raw position. `class=<code>` keeps only that class.

**Rank change.** At each commit or correction, the server compares the entry's position in each view just before and just after, and stores the badge text in `lastChange.rankChange`:

- `Up <steps> to P<new>` when the entry moved up.
- `Down <steps> to P<new>` when it moved down.
- `Holds P<new>` when the position is unchanged.
- `New P<new>` when it was unranked and is now ranked.
- `No time` when it is still unranked.

The class view uses `classPosition`, and the raw view uses `rawPosition`. Other entries' `lastChange` does not change.

**Corrections.**

- Allowed on `committed` or `corrected` runs (409 `run_not_committed`), while the event is `running` or `provisional` (409 `results_locked` in `final` or `published`).
- `outcome` is `time` or `dnf`. The values must differ from the current ones (422). `reason` must be 5 to 500 characters (422).
- A correction recomputes adjusted and indexed times with the run's stored factor and writes exactly one correction entry: actor, server time, reason, and the before and after values.
- Correction entries are never changed or deleted. Every `PUT`, `PATCH` or `DELETE` on one answers 405 `audit_immutable`.

**Protest window.**

- Moving to `provisional` records `provisionalAt` from server time and sets `protestWindowClosesAt` to `provisionalAt` plus `PROTEST_WINDOW_SECONDS` (default 1800 seconds, which is 30 minutes).
- `protestWindowOpen` is true while server time is before `protestWindowClosesAt`.
- Moving to `final` answers 409 `protest_window_open` while the window is open, then 409 `protests_pending` while any protest is `pending`.

**Protests.**

- Filed only by a driver registered in the event (409 `not_registered`) while the window is open (409 `protest_window_closed`). The subject must be a registration in the event (422).
- The chair decides each protest once (409 `protest_decided`), only while the event is `provisional` (409 `results_locked`).
- A decision does not change times by itself; the timing chief corrects runs when needed.

**Publishing.** Allowed only from `final` (409 `already_published` when published, `not_final` otherwise). Steps, in order:

1. Render the results PDF (DP-49).
2. Store it, read back the stored object, and record its SHA-256 checksum.
3. Send the final-results email to every checked-in driver, skipping drivers whose email was accepted on an earlier attempt.
4. Only when every email is accepted, set `published`, `publishedAt` and `resultsChecksum`.

Any failure answers 503 with the failing step's code, leaves the status `final`, and keeps `results.pdf` at 404. A retry reuses an already stored and checksummed object instead of rendering again. Each failure is recorded for the operator overview with its service and time.

**Index tables.**

- Each club has dated tables. `factors` maps class codes (1 to 6 uppercase letters or digits) to factors with four decimals, from `0.4000` to `1.2000` inclusive, with at least one class (422 otherwise).
- An event uses the table with the latest `effectiveDate` on or before the event's date, on every surface: event object, runs, standings, PDFs, season. An event dated before every table answers 422 at creation.
- Loading a table answers:
  - 409 `effective_date_taken` if a table with that date exists.
  - 409 `effective_date_conflict` if any event dated on or after the effective date already has a committed or corrected run.
  - 409 `classes_in_use` if any event dated on or after the effective date has a heat class missing from the new table.
- Existing tables are never edited.

**Season points.** Only published events whose date is in the year count. For each published event:

- A driver's points = round half up of (100 × the event's fastest best indexed time ÷ the driver's best indexed time) to three decimals.
- A driver with no valid time scores 0.000, and the event still counts toward their `events`.

Season `points` is the sum. `position` ranks by points, highest first; ties go to the driver name alphabetically. `carDescription` and `classCode` come from the driver's latest-dated counted registration.

**Season CSV.**

- Header row exactly `Position,Driver,Car,Class,Events,Points`, then one row per season row. Points have three decimals.
- Fields are quoted per standard CSV when they contain a comma, quote or line break.
- Any cell whose first character is `=`, `+`, `-` or `@` is prefixed with a single apostrophe `'` before quoting.

**Tenant isolation.** Every query is scoped to the signed-in user's club. An id from another club behaves exactly like an unknown id (404). The operator overview shows only counts and failures, never driver names or results.

**Operator counts.**

- `eventCount` is the number of the club's events in any status.
- `driverCount` is the number of the club's users who hold no staff role (chair, timing or workers), whether or not they have registered.
- `publishedCount` is the number of the club's events in `published`.

The operator table's Events, Drivers and Published columns show these three values.

### Services (DP-13, DP-16, DP-17, DP-22, DP-46 to DP-49)

**Postgres** (`DATABASE_URL`): system of record for clubs, users, sessions, index tables, events, registrations, stations, runs, correction entries, protests, idempotency records, email deliveries and delivery failures. Apply schema and seed idempotently on every serve start.

**Gotenberg** (`GOTENBERG_URL`): renders server-built HTML to PDF.

- **Waiver PDF:** headed `Event waiver`, with the club name, event name and date, the driver's name, car number and class, and the line `Signed by <signature> at <UTC time>`.
- **Results PDF:** every page carries the header `<event name> final results`. Three sections headed `Raw`, `Class` and `Indexed`, in that order, each starting on a new page. Each section lists every registration in that view's order, with position (or `No time`), car number, class, driver name and the view's best time with three decimals. The Indexed section also shows the factor.
- **Renderer status:** `renderer` in the publication response is `ok` when Gotenberg's health check answers within 2 seconds, otherwise `unavailable`.
- **While down:** check-in answers 503 `renderer_unavailable`, publishing answers 503 `renderer_unavailable`, and the copy is in Feedback states.

**MinIO** (`S3_*`): objects are written once and never overwritten.

- Waiver key: `clubs/<clubSlug>/events/<eventId>/waivers/<registrationId>.pdf`.
- Results key: `clubs/<clubSlug>/events/<eventId>/results/final.pdf`.
- The recorded checksum is the lowercase SHA-256 hex of the object bytes.
- The browser never reaches MinIO. The app serves PDFs through its own routes.
- **While down:** check-in answers 503 `storage_unavailable`, and publishing answers 503 `storage_unavailable`.

**Mailpit** (`SMTP_HOST`, `SMTP_PORT`): From is the `MAIL_FROM` value, `Conecount Paddock <paddock@pylonworks.test>` when unset.

| Email | To | Subject | Body includes |
|---|---|---|---|
| Registration confirmation | the driver | `Registered for <event name>: car <n> <class>` | `Car <n> <class>`, `Run heat <h>` |
| Work assignment | the worker | `Work assignment for <event name>: <station>, heat <h>` | the station, heat and event date |
| Final results | each checked-in driver | `Final results: <event name>` | the link `<base>/api/events/<id>/results.pdf`, and `Your indexed finish: P<pos>` or `Your indexed finish: no time` |

`<base>` is `APP_PUBLIC_URL`, or `http://localhost:<port>` when unset.

Registration and work-assignment emails are sent after the record is saved. When the mail server does not accept one, the registration or claim still succeeds, the delivery stays pending (`confirmationEmail: "pending"` on the registration), and the app retries at least every 30 seconds until accepted. Final-results emails are part of publishing and are never retried in the background. When mail is down, publishing answers 503 `mail_unavailable`.

### Seed data (DP-02, DP-05, DP-32, DP-46, DP-52, DP-54)

Every seeded person, club, venue and car is invented. The seeded password for every account is `conecount-2026`.

**Operator:** Rowan Pell, `ops@pylonworks.test`.

**Club `ridgeline`:** Ridgeline Region, time zone `America/Denver`.

- Staff: Dana Whitcombe `chair@ridgeline.test` (chair), Ike Moreau `timing@ridgeline.test` (timing), Priya Halvorsen `workers@ridgeline.test` (workers).
- Drivers: Avery Lindqvist `avery@ridgeline.test`, Bo Tanaka-Reyes `bo@ridgeline.test`, Cass Ferreira `cass@ridgeline.test`, Del Mbeki `del@ridgeline.test`, Emery Novak `emery@ridgeline.test`, Finn Castellanos `finn@ridgeline.test`, Gale Ostrowski `gale@ridgeline.test`, Harper Quill `harper@ridgeline.test`.
- Index table effective `2026-01-01`: SS 0.8270, AS 0.8180, BS 0.8120, DS 0.8000, GS 0.7930, HS 0.7840, STR 0.8290, SM 0.8550.

Event **Points 7 at Fairgrounds**:

- Venue County Fairgrounds Lot B, date `2026-08-16`, cutoff `2026-08-14T20:00`, 2 runs per driver.
- Heat 1: SS, STR. Heat 2: GS, HS. Stations: Start, Finish, Corner 1, Corner 2.
- Status `final`, with the protest window long closed and no protests. It has no stored waiver objects, because its check-ins predate the system, and no results PDF yet.
- Rota: Avery on Corner 1 in heat 2, Bo on Corner 2 in heat 2, Cass on Corner 1 in heat 1, Del on Corner 2 in heat 1.

| Driver | Class / car | Car description | Run 1 | Run 2 | Best adjusted | Best indexed |
|---|---|---|---|---|---|---|
| Avery Lindqvist | SS 12 | 2019 Chevrolet Corvette | 52.418 +1 → 45.004 | 51.907 +0 → 42.927 | 51.907 | 42.927 |
| Bo Tanaka-Reyes | STR 7 | 2020 Mazda MX-5 RF | 53.211 +0 → 44.112 | DNF | 53.211 | 44.112 |
| Cass Ferreira | GS 31 | 2017 Volkswagen GTI | 56.034 +2 → 47.607 | 55.120 +0 → 43.710 | 55.120 | 43.710 |
| Del Mbeki | HS 4 | 2016 Honda Fit | 58.402 +0 → 45.787 | 57.880 +1 → 46.946 | 58.402 | 45.787 |

All four are checked in. For example, with the seed data at start:

- Indexed order is Avery P1, Cass P2, Bo P3, Del P4. Raw order is Avery, Bo, Cass, Del. Each entry is P1 in its class.
- After this event is published, 2026 season points are Avery 100.000, Cass 98.209, Bo 97.314, Del 93.754.

Event **Points 9 at Airpark**:

- Venue Mesa Airpark Overflow Lot, date `2026-11-21`, cutoff `2026-11-20T18:00`, 3 runs per driver.
- Heat 1: SS, AS, BS, STR. Heat 2: DS, GS, HS, SM. Stations: Start, Finish, Corner 1, Corner 2, Corner 3, Corner 4.
- Status `registration_open`. Registrations: Avery SS 12 "2019 Chevrolet Corvette" (run heat 1) and Cass GS 31 "2017 Volkswagen GTI" (run heat 2), both with confirmation sent and not checked in.
- No stations are claimed: heat 1 has 6 open and heat 2 has 6 open.

**Club `tidewater`:** Tidewater Region, time zone `America/New_York`.

- Chair Morgan Ashby `chair@tidewater.test`. Driver Nico Brandt `nico@tidewater.test`.
- Index table effective `2026-01-01`: SS 0.8250, AS 0.8170, BS 0.8110, DS 0.7990, GS 0.7920, HS 0.7830, STR 0.8280, SM 0.8540.
- Event **Tidewater Points 6**: date `2026-11-14`, cutoff `2026-11-13T20:00`, 3 runs per driver. Heat 1: SS, AS, BS, STR. Heat 2: DS, GS, HS, SM. Stations: Start, Finish, Corner 1, Corner 2. Status `registration_open`, with Nico registered as SS 55 "2015 Porsche Cayman".

For example, with the seed data at start, the club workspaces table shows:

- Ridgeline Region: 2 events, 8 drivers, 0 published.
- Tidewater Region: 1 event, 1 driver, 0 published.

Both clubs show `None` for last delivery failure.

## Technical requirements

### Deployment (DP-01)

- The runtime is Node.js 22 with npm, and the app is written in TypeScript.
- Ship `/app/run.json` with string fields `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` returns HTTP 200 JSON `{"status":"ok"}`.

### Configuration and secrets (DP-59)

Read at start from the environment:

- `DATABASE_URL`
- `GOTENBERG_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `PROTEST_WINDOW_SECONDS` (default 1800)
- `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`

None of these values is hard-coded in source, written into browser assets, or returned by any route.

### Server boundary (DP-57, DP-58)

- **Request limits:** JSON request bodies of up to 65,536 bytes are accepted; larger bodies answer 413 `{"error":"payload_too_large",...}`. A request with a body that is not `application/json` answers 415 `unsupported_media_type`. Error precedence in API decides which answer wins when both apply.
- **Same origin only:** responses carry no cross-origin allowance headers. The app's own origin is `http://` followed by the request's `Host` header exactly as received (host and port), so it holds whatever hostname the app is reached by. `APP_PUBLIC_URL` plays no part in this check. A state-changing request (`POST`, `PUT`, `PATCH` or `DELETE`) whose `Origin` header is present and differs from that origin, including `null`, answers 403 `cross_origin`. A request without an `Origin` header is allowed.
- **What the server never serves:** source files, `run.json`, `.env` files, `package.json`, lockfiles or anything under the dependency folder. Such paths answer 404.
- **Boot:** if Postgres is unreachable at boot, the server keeps retrying for up to 60 seconds before exiting with an error. An unreachable Gotenberg, MinIO or mail server never blocks boot or health. Only the actions that need that service fail, as in Services.

### Browser support and performance (DP-33, DP-36)

- **Browsers and devices:** current Chromium, Firefox and WebKit, with touch input on phone and tablet sizes, at 375 by 812, 768 by 1024 and 1280 by 800.
- **Responsiveness:** every screen is usable within three seconds of navigation on the seeded data. A run commit replies within one second while services are up.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build and serve.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its licence.
- IF-03: Shipped packages (the production dependency tree from `npm ls --omit=dev --all --json`) use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0 licences. Fonts use OFL-1.1.
- IF-04: The app stores state only in Postgres and MinIO: no SQLite, Redis, local JSON or other files as a datastore.
- IF-05: Fonts and scripts are self-hosted, and the browser makes no requests to third-party origins.
- IF-06: The provided development service configuration is left unchanged.
- IF-07: All app source is TypeScript, compiled with `strict` enabled.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes and no ignored compiler errors.
- Names in code match the domain terms in this brief: event, heat, station, registration, run, cones, adjusted time, indexed time, factor, index table, correction, protest window, publish.
- Each domain rule is decided in exactly one place in the source, including every event and run state transition, the indexed-time formula, the rank-change text, the window check, the CSV neutralisation and the season points formula. Everything else calls that one decision.
- No abstraction has only a single implementation, and there is no dead, commented-out or unreachable code.
- There are no defensive checks for states the data model makes impossible.
- Every API error is produced through one error shape with the published precedence.
- There are no features, endpoints or screens beyond this brief.
