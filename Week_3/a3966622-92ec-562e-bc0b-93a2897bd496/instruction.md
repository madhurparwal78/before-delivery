# Ebbstone Marine Slackwater

Slackwater runs tidal-window planning, the pilot rota, boarding-ladder reports and tariff billing for a harbour pilot station of 10 to 40 licensed pilots. Its users are duty dispatchers, harbour pilots, port agents and a station accounts clerk at the invented Port Ansell. It uses Kill Bill for agency accounts, charges and invoices, MinIO for evidence files, and Mailpit as the mail destination. It keeps its own operating records in one embedded file store. Out of scope: self-registration and password reset (all accounts are seeded), any datastore server, payment collection, live tide-gauge or ship-tracking feeds, and an authority login (the harbour authority is reached by mail only).

## Problem and users

A deep-laden ship can cross a tidal port's shallow bars and sills only when enough water stands over every controlling depth at the moment the ship gets there. The ship's speed on each leg sets both when it arrives and how far it squats. Stations work this out across a tide spreadsheet, a whiteboard turn board and draught changes phoned in feet and inches against charts in metres. Tariffs are worked out afterwards from draft feet, tonnage bands, minimum charges, cancellation notice and detention time. A wrong window can ground a ship. A rest breach can put a fatigued pilot on the bridge. A missed detention line or minimum charge is money the pilots' association loses. A cancellation cutoff read off the wrong side of a clock change starts a tariff dispute. Pilots meet non-compliant boarding ladders in about one transfer in eight, and only about 15% of those reach an authority, because reporting is a separate chore after a night's work. Station links are flaky, so a dispatcher often cannot tell whether a pressed button reached the server.

- **Duty dispatcher:** turns agent orders into safe committed tidal windows and assigns the right rested pilot in turn, often alone at 03:00 at a dimmed console, and sometimes alongside the incoming dispatcher at a shift handover, where the board link is passed from one to the other.
- **Harbour pilot:** sees the next job and its clearances on a phone, confirms boarding, and files a ladder report with a photo from the deck or the pilot boat.
- **Port agent:** orders and amends pilot moves for their own agency's vessels, follows status, and reads their own invoices and exports.
- **Station accounts clerk:** publishes tariff revisions, reviews move charges, exports moves to a spreadsheet, and issues invoices that match the billing provider.

## Journeys

1. **Agent places an order.** The agent starts signed in on the orders screen with no draft. They pick a vessel and edit draught, speed and boarding time quickly, sometimes faster than the server answers. Clearances, window state and the tariff estimate change in place from the server's plan for what the form currently holds. While that plan is on its way the last shown values stay, and a late answer for an earlier edit never replaces them. Switching draught units changes only how the draught reads. The agent submits, and the order appears as `Ordered` in the agent's list and in the dispatcher's order queue.
2. **Dispatcher plans a night move by keyboard.** The dispatcher starts on the board with an order in the queue. Using only the keyboard, they load the order into the Keel Section and hold the arrow key on the time handle, reading the speed-limit labels on the slow legs. Only the final value's pinch and gate are announced. They commit a window, and the move row shows the committed time and pinch margin.
3. **Dispatcher assigns the rested pilot in turn.** The dispatcher starts from a move in `Window committed` and opens the assignment panel. They read each pilot's eligibility, pick the next eligible pilot, and type a note while the board refreshes behind the panel. They press Assign twice in quick succession. The move becomes `Pilot assigned` once, and the agent and the pilot each receive one notice whose delivery state shows on the move.
4. **Pilot works the job from a phone.** The assigned pilot starts signed in on a phone. They read the next job, open the waypoint sheet, drag the time handle by touch, and confirm pilot away and boarding. The move shows `On board`.
5. **Pilot files a ladder report.** The pilot starts from `Pilot away` facing a defective ladder. They photograph it and see the store confirm the photo and its checksum, or see a mislabelled file refused. They mark the defects, refuse boarding and file the report. The pilot who filed sees the refused heading on the move, the agent and the authority receive the notice, and the agent downloads the same bytes and later places a corrected re-order.
6. **Agent amends close to boarding.** The agent starts from a committed move near its boarding time, including one whose cutoff falls across a clock change. They read the server's notice cutoff with its zone and the server's verdict, then amend or cancel. The move keeps its window, returns to `Ordered`, or ends in the published late state with its charge.
7. **Clerk revises the tariff and issues an invoice.** The clerk starts on the accounts screen and publishes a revision with a future effective time. Moves on either side of it are priced by their own boarding time, small vessels topped up to the minimum charge, and the moves export opens in a spreadsheet with every label as inert text. The clerk reviews a completed move's lines and issues the invoice, even with a double click. The invoice shows as pending until the provider confirms it, then shows the provider's single number and balance, and the move shows `Invoiced`.
8. **Dispatcher works through an outage and a flaky link.** The dispatcher starts with one provider unreachable and sees that service marked down while they carry on working. They press Complete move, the reply is lost, and the screen says so while keeping the last confirmed state. They press it again before the next scheduled refresh and see the server's original completion. Affected steps show pending, and nothing on screen claims a result the server has not confirmed. When the service returns, each pending step runs once and the state clears with no restart. At handover they pass the board link, and the incoming dispatcher opens the same move and search.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Order a pilot move** A port agent places an order for their own vessel on the orders screen and it appears as `Ordered` in their list and in the dispatcher's order queue.
- **DP-02 — Draught in either unit** Draught is accepted in metres or feet and inches, stored once in whole millimetres, and switching the displayed unit never changes a clearance or a charge.
- **DP-03 — Live order form** Editing draught, speed, boarding time or vessel details on the order form updates clearances, window state and the tariff estimate in place with no submit, and announces the result, as qualified in Feedback states.
- **DP-04 — Agency isolation** A port agent reaches only their own agency's vessels, moves, reports, photos, invoices, search results, exports and per-revision move lists, and any other agency's record answers exactly as a record that does not exist.
- **DP-05 — Keyed requests replay** Repeating a keyed request with the same key and body, even while the first is still in progress, returns the first response, and reusing a key with a different body is refused, as qualified in Business rules.
- **DP-06 — Published clearance formula** The server computes each waypoint's leg speed, arrival, squat, clearance, required clearance, margin and pinch by the published formula and leg speed limits, and the screen shows those same values.
- **DP-07 — Tide height in real elapsed time** Tide height at any instant comes from cosine interpolation between published high and low waters over real elapsed time, with each waypoint's published time and height offset, on daylight-saving changeover dates as on any other.
- **DP-08 — Open windows from the server** The server returns the open boarding windows for a move and day in 5-minute port-time steps that skip any hour that does not exist, and the strip under the time handle marks exactly those windows.
- **DP-09 — Keel Section long section** The planning view shows a to-scale long section from boarding ground to berth with a seabed line, six waypoints, speed-limit labels on the limited legs, a hull at draught plus squat, and a water line drawn at each waypoint's height when the hull arrives there.
- **DP-10 — Time handle response** Moving the time handle updates, in order, the water line, each waypoint's bar and numerals, and the Pinch marker from the server's plan for the latest handle value only, and crossing the limit changes the gate ribbon, its text and the Commit control.
- **DP-11 — Section announcements** Each change of pinch waypoint or gate state and each commit result is announced in the named live region with the published copy, as qualified in Feedback states.
- **DP-12 — Keyboard night planning** A dispatcher completes the whole journey from order queue through the time handle and commit to pilot assignment by keyboard alone, with published shortcuts and focus held inside every open panel.
- **DP-13 — Server decides commit** On commit the server checks the move version, recomputes the plan, and its result alone decides whether the window is committed.
- **DP-14 — Stale commit refused** A commit made against an older move version, tide data or draught is refused, the section redraws from the fresh values, and nothing is committed.
- **DP-15 — Hull transit on commit** After an accepted commit the hull travels from boarding ground to berth once and the move row shows the committed time and pinch margin.
- **DP-16 — Tide table revisions** A dispatcher publishes a tide revision for a date, the tide version advances, and committed moves that no longer clear return to `Ordered`.
- **DP-17 — Commit from queue to board** A dispatcher takes a queued order to a committed window and sees it on the board, on the agent's view and in the move's history.
- **DP-18 — Licence cover and eligibility** The server reports each pilot's turn position, licence cover and rest verdict for a move, and refuses a pilot whose licence does not cover the vessel's length and draught.
- **DP-19 — Next eligible in turn** Only the next eligible pilot can be assigned without override, skipped pilots keep their turn position with the reason recorded, and the assigned pilot moves to the end of the turn list.
- **DP-20 — Rest rules** Assignment is refused when the published rest or consecutive-day rules, counted in real elapsed time, would be breached before or after the duty.
- **DP-21 — Simultaneous assignment** When two dispatchers assign the same pilot or the same move at once exactly one succeeds and the other receives the published conflict with fresh data.
- **DP-22 — Assign the rested pilot** A dispatcher opens the assignment panel for a committed move, assigns the next eligible pilot, and sees the move as `Pilot assigned` with its notice states.
- **DP-23 — Rest-rule override** A rest breach can be overridden only with a typed immediate-safety reason, which is attributed, immutable and shown only to dispatchers.
- **DP-24 — Private fields stay private** Pilot rest figures, rest-override reasons and dispatcher notes never appear in any mail or in anything a port agent can read.
- **DP-25 — Assignment panel survives refresh** An open assignment panel, its selection and a half-typed note stay intact and focused while the board refreshes on its timer.
- **DP-26 — Order and assignment notices** Each state change listed in Services sends its notice exactly once to the listed recipients, and its delivery state shows on the move.
- **DP-27 — Amendment re-check** An amendment re-checks the plan on the server and returns a committed or assigned move to `Ordered`, releasing any pilot, when the window no longer clears.
- **DP-28 — Server-decided notice cutoff** Whether an amendment or cancellation is under the notice cutoff comes only from the server's clock and the screen shows the server's verdict even when the device clock is wrong.
- **DP-29 — Cancellation branches** A cancellation before `On board` ends in `Cancelled` or `Cancelled late` by the server's notice verdict, and any later cancellation is refused.
- **DP-30 — Published late-notice wording** The late-cancellation and late-amendment notices and the ladder-refused heading render and announce character for character.
- **DP-31 — Amend and cancel near boarding** A port agent amends and cancels moves close to boarding and sees the resulting state, notice wording and charge on the move.
- **DP-32 — Move state machine** Every legal move transition succeeds once for the permitted role, simultaneous requests for the same transition yield exactly one success, and every illegal one is refused with the published rejection.
- **DP-33 — Pilot's next job on a phone** A pilot on a phone sees their next job and its clearances, and confirms pilot away, boarding and completion.
- **DP-34 — Touch handle and reduced motion** The time handle works by touch on a phone, and under reduced motion every change snaps to its end state with the same values and controls.
- **DP-35 — Closed drawer and sheet** A closed jobs drawer or waypoint sheet is hidden and inert, so none of its controls can be reached or read at any viewport.
- **DP-36 — Evidence checked and stored as submitted** Ladder photos and vessel pilot-card PDFs whose bytes match their declared type are stored and downloaded byte for byte with a matching SHA-256 checksum shown, and a mismatched file is refused before anything reaches the store.
- **DP-37 — Reports claim confirmed photos only** A ladder report can claim a photo only after the store has confirmed it, and the claim must be for the same move.
- **DP-38 — Ladder report and refusal rules** The pilot records compliance and defects on a ladder report, a refusal moves `Pilot away` to `Refused at ladder`, and a corrected re-order returns the move to `Ordered`.
- **DP-39 — Ladder defect notice** A non-compliant report sends one notice to the agent and harbour authority with its defects, checksum and attached photo bytes, and its delivery state shows on the move.
- **DP-40 — File a ladder report from the deck** A pilot on a phone photographs a ladder, files a non-compliant report, and the port agent opens the report and downloads the photo.
- **DP-41 — Effective-dated tariff revisions** A clerk publishes a revision with a future effective port-local time, and each move is priced by the revision in force at its port-local boarding time on every surface, the moves export and the agent's order rows included.
- **DP-42 — Exact tariff lines** Draft-foot, tonnage-band, minimum-charge, night, detention and cancellation lines follow the published rules, order and rounding and sum to exact cents.
- **DP-43 — Lines fixed at the billing event** A move's tariff lines are computed once at its billing event and stored, and later revisions never reprice them.
- **DP-44 — Publish a tariff revision** A clerk publishes a revision on the accounts screen and sees it listed with its effective time beside the earlier revisions and the moves each one priced.
- **DP-45 — Detention timing** Detention is a timed sub-state of `On board` that accrues by the server's clock from the ordered time and bills per started half hour after the allowance.
- **DP-46 — Charges on the agency account** Each billing event posts its lines once as external charges on one draft invoice of the agency's Kill Bill account, even under parallel completion or a retry after an ambiguous reply, as qualified in Services.
- **DP-47 — Provider-confirmed invoices** An invoice shows as issued, with a number and balance, only after Kill Bill confirms it, shows as pending until then, and simultaneous issue requests commit it exactly once with one number.
- **DP-48 — Review and issue an invoice** A clerk reviews a completed move's lines, issues the invoice, and sees it issued while the agent reads the same invoice and the move shows `Invoiced`.
- **DP-49 — Per-service state** The server and the screen report billing, storage and mail state separately and truthfully, and health stays OK while a provider is down.
- **DP-50 — Pending steps run once** Completion, charge posting and notice sending are recorded separately, so an outage leaves a truthful pending state and each pending step later runs exactly once with no restart.
- **DP-51 — Server-confirmed screen state** Move, photo, invoice and notice states change on screen only from a server reply, and a failure, no-reply or outage message stays until the user acts again or the state truly changes.
- **DP-52 — Work through an outage** A dispatcher continues planning and completing moves with a provider down and sees the pending and recovered states on the moves affected.
- **DP-53 — Board breakpoints** The board shows three panes at 1280 wide and above, two panes from 768 up to 1279, and one pane with a drawer and bottom sheet below 768, with no horizontal overflow.
- **DP-54 — Search moves in place** Typing in the board's or agent's move search filters the list in place, announces the result count, and is limited to what the user may read.
- **DP-55 — Handover at the board** Two dispatchers at a shift handover commit or assign the same move, and the one who loses sees the conflict message with the fresh move data and can carry on.
- **DP-56 — Sign-in and roles** Seeded users sign in, land on their role's screen, and are refused any action outside their role.
- **DP-57 — Run manifest and health** The app installs, builds and serves from the run manifest, starts with any provider down, and answers its health path.
- **DP-58 — Server boundary** The server is same-origin, applies the published request limits and one error shape, and never serves source files or credentials.
- **DP-59 — Nocturnal instrument look** Every screen uses the near-black ground, pale cool ink, mono numerals with units beside them, hairline rules and square corners, with the section pinned above the board.
- **DP-60 — Provider wiring in source** Provider credentials and URLs come only from the environment, and charge, object and mail state in the source comes from real provider calls and their confirmations.
- **DP-61 — Safe moves export** The moves export is standard CSV whose text cells can never run as spreadsheet formulas, with margins and totals as plain integers and revision labels shown as literal text everywhere.
- **DP-62 — Board survives reload** The board's loaded move and search text and the agent's search text live in the page address, so a reload or a shared link restores them and a board refresh never changes it.
- **DP-63 — Retry after a lost reply** When an action's reply is lost after the server applied it, acting again on the same control with unchanged inputs shows the server's original result and never a refusal for the action already done, as qualified in Feedback states.
- **DP-64 — Notice cutoff in real elapsed time** Each move carries and shows its notice cutoff exactly 2 hours of real time before boarding with its UTC offset and zone abbreviation, across clock changes, as published in Business rules.
- **DP-65 — Latest live plan wins** The order form's clearances, window state, estimate and announcement come only from the plan reply for the form's current inputs and keep the last painted values while that reply is outstanding, a late reply for earlier inputs never paints or announces, and switching draught units sends no plan request.
- **DP-66 — One assignment per key** A double-pressed, parallel or replayed assignment with one key yields one assignment, one version step, one history entry, one skip record per skipped pilot and one of each assignment mail.

## Frontend

### Screens and layout (DP-01, DP-03, DP-09, DP-33, DP-40, DP-44, DP-48, DP-53, DP-56, DP-59)

Every screen has a top strip showing the product name, the signed-in role, the port time supplied by the server, and the service state region. No screen scrolls sideways at 375x812, 768x1024 or 1280x800.

| Path | Who | What it shows |
|---|---|---|
| `/login` | Anyone | Sign-in form. |
| `/board` | Duty dispatcher | Keel Section pinned along the top at full width, with Order queue, Moves and Pilot turn list below it. Takes the query parameters in Interactions. |
| `/orders` | Port agent | Order form with live clearances, the agency's moves (each row with its `Priced by` text), and the agency's invoices. Takes the query parameter in Interactions. |
| `/moves/<ref>` | Any permitted role | Move detail: status, plan, `Notice cutoff`, `Notice verdict`, `Charges` text, notices, ladder reports, charge lines, invoice links and history. |
| `/pilot` | Harbour pilot | Next job with clearances and the Keel Section, status actions and ladder report entry. |
| `/reports/<id>` | Any permitted role | Ladder report with defects, photos, checksums and download links. |
| `/accounts` | Accounts clerk | Tariff revisions, publish form, moves with charges, a link to the moves export, and invoices. |
| `/invoices/<id>` | Clerk or owning agent | Invoice state, number, balance and lines. |

A signed-in user who lands on `/` goes to their role's screen. An anonymous user goes to `/login`. An unknown path, or a record the user may not read, shows the not-found page from Feedback states.

**Planning layouts**

At every width the pinned section is `region "Keel Section"`, and the height limits below measure that region alone. These sit outside the region and do not count toward its height: `button "Waypoint table"`, the collapsible waypoint strip, `table "Waypoints"`, and on phones `button "Waypoints"` and `dialog "Waypoints"`. Only the region is pinned. The toggle and the strip scroll with the panes.

- **1280 wide and above:** the section stays pinned above three side-by-side panes. Left to right they are `Order queue`, `Moves` and `Pilot turn list`. The section takes about a third of the window height. The toggle and the strip holding the waypoint table sit directly under the section, above the panes, and do not cover them.
- **768 up to 1279:** the pinned section takes about a third of the window height above two columns. The left column stacks `Order queue` over `Moves`, and `Pilot turn list` is on the right. The toggle and strip sit between the section and the columns.
- **Below 768:** the pinned section takes no more than a third of the window height, above a single pane showing `Moves`. `Order queue` and `Pilot turn list` live in the `Jobs` drawer, which opens from the left. The waypoint table lives in the `Waypoints` bottom sheet.

`/pilot` follows the same rules. Below 768 its single pane shows the next job, the `Jobs` drawer lists the pilot's current assignments, and the `Waypoints` sheet holds the table. `/orders` and `/accounts` have two columns at 768 and above, and one column below.

### Public screens and controls (DP-01, DP-08, DP-10, DP-12, DP-22, DP-33, DP-35, DP-38, DP-44, DP-48, DP-49, DP-51, DP-54, DP-56, DP-61, DP-64, DP-65)

Only the names below are public. `<ref>` is a move reference and `<vessel>` is a vessel name.

| Screen | Role and accessible name | Visible copy or behaviour |
|---|---|---|
| Sign-in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | Same words. |
| All | `button "Sign out"`, `region "Service state"` | Three items, each reading `up` or `down`: `Billing up` / `Billing down`, `Storage up` / `Storage down`, `Mail up` / `Mail down`. |
| All | `status "Service announcements"` | Outage copy from Feedback states. |
| Board | `region "Keel Section"` | Holds the section drawing, `slider "Boarding time"`, `textbox "Planning day"`, `group "Open windows"`, the text items labelled `Pinch`, `Gate` and `Formula`, and `button "Commit window"`. Nothing else in this table belongs to it. |
| Board | `slider "Boarding time"` | Value is minutes after port midnight, wall-clock, from 0 to 1435 in steps of 5. Value text is `<HH:MM> port time`. On a spring-forward date the values for the hour that does not exist are never offered (see Interactions). |
| Board | `textbox "Planning day"` | Port-local date as `YYYY-MM-DD`. Defaults to the loaded move's boarding date. |
| Board | `group "Open windows"` holding `button "Open window <from> to <to>"` | One button per server window, marked under the handle. Activating a button moves the handle to `<from>`. With no windows it shows `No open window on this day`. |
| Board | Text item labelled `Pinch` | `Pinch <waypoint> <margin> m`. |
| Board | Text item labelled `Gate` | `Gate open` or `Gate closed`. |
| Board | Text item labelled `Formula` | `Clearance = sounded depth + tide at arrival - draught - squat`. |
| Board | Speed-limit labels in the section | `<n> kn` over each leg that has a speed limit, where `<n>` is that waypoint's limit from Seed data. |
| Board | `button "Commit window"` | Dispatcher only. Disabled while the gate is closed, and absent for other roles. |
| Board | `status "Section announcements"` | Copy from Feedback states. |
| Board | `button "Waypoint table"` | Present at 768 and above. Expands and collapses the strip, and reports its state through `aria-expanded`. The strip starts expanded on every page load. |
| Board | `table "Waypoints"` | Columns `Waypoint`, `Arrives`, `Leg speed`, `Squat`, `Water`, `Clearance`, `Required`, `Margin`. Visible on load in the strip at 768 and above, and inside `dialog "Waypoints"` below 768. `Arrives` reads `<HH:MM> ADT` when the arrival's offset is `-03:00` and `<HH:MM> AST` when it is `-04:00`, with the arrival's seconds dropped. `Leg speed` reads `<n> kn`. `Water` shows the water depth at arrival by the Water depth rule in Business rules. |
| Board | `region "Order queue"` holding `button "Plan <ref> <vessel>"` | One button per queued order, in the queue order from Interactions. |
| Board | `region "Moves"` holding `button "Open <ref>"` and `button "Assign pilot to <ref>"` | One row per move with status, committed time and pinch margin. `Open <ref>` goes to the move's page. |
| Board | `region "Pilot turn list"` | Pilots in turn order with licence class and rest state. |
| Board | `searchbox "Search moves"` | Filters by reference, vessel or status text. Also on `/orders`. |
| Board | `status "Board announcements"` | Copy from Feedback states. Also on `/orders` for the search count. |
| Board | `dialog "Assign pilot"` | Holds `radiogroup "Pilot"` with one radio per pilot showing its name and verdict, `textbox "Dispatcher note"`, `textbox "Rest override reason"`, `button "Assign"` and `button "Close assignment"`. The rest override box appears only when the chosen pilot is breaching rest. |
| Phones | `button "Jobs"` opens `dialog "Jobs"` with `button "Close jobs"` | Hidden and inert when closed. |
| Phones | `button "Waypoints"` opens `dialog "Waypoints"` with `button "Close waypoints"` | Hidden and inert when closed. |
| Orders | `combobox "Vessel"`, `spinbutton "Speed in knots"`, `spinbutton "Block coefficient"`, `spinbutton "Length in metres"`, `spinbutton "Gross tonnage"`, `spinbutton "Duty minutes"` | The form opens with no vessel chosen. Choosing a vessel prefills the other fields from it where a default exists. |
| Orders | `radiogroup "Draught units"` with `radio "Metres"` and `radio "Feet and inches"` | Switching redraws the entered value from the stored millimetres. |
| Orders | `spinbutton "Draught in metres"`, or `spinbutton "Draught feet"` and `spinbutton "Draught inches"` | Shown by the chosen unit. |
| Orders | `textbox "Boarding date"`, `textbox "Boarding time"` | `YYYY-MM-DD` and `HH:MM`, port time. |
| Orders | `region "Order clearances"` | Waypoint clearances, `Window open` or `Window closed`, and `Estimate $<total> CAD`. Before any vessel is chosen it reads `Choose a vessel to see clearances`. |
| Orders | Each row of the agency's moves | Holds `Priced by <label>`, from the export rule in Business rules, with the label as literal text. |
| Orders | `button "Place order"`, `status "Order announcements"`, `alert "Form errors"` | The alert links each message to its field. The order, ladder and tariff forms share it. |
| Move | `button "Amend move"` opens `dialog "Amend move"` with `button "Save amendment"` and `button "Close amendment"` | Agent and dispatcher. Fields use the order form names. |
| Move | `button "Cancel move"` opens `dialog "Cancel move"` with `button "Confirm cancellation"` and `button "Keep move"` | Shows `Notice cutoff` and `Notice verdict`. |
| Move | `button "Corrected re-order"` opens `dialog "Corrected re-order"` with `textbox "Correction"`, the boarding fields and `button "Place re-order"` | Agent, on `Refused at ladder`. |
| Move | Text item labelled `Notice cutoff` | The move's cutoff in the display format of Notice cutoff in Business rules. Shown on the move page and inside `dialog "Cancel move"` and `dialog "Amend move"`, beside `Notice verdict`. |
| Move | Text item labelled `Notice verdict`; text item labelled `Charges`; `list "Notices"`; `status "Move announcements"` | `Charges` reads `No charges`, `Charges pending` or `Charges posted` for `billing.state` `none`, `pending` or `posted`. Each notice reads `<kind>: sent` or `<kind>: pending`. |
| Pilot and move | `button "Confirm pilot away"`, `button "Confirm boarding"`, `button "Complete move"`, `button "Start detention"`, `button "Stop detention"` | Present only when the status the screen last confirmed permits the action and the user may act on the move. |
| Pilot | `button "File ladder report"` opens `dialog "Ladder report"` | See the ladder report row below. |
| Pilot | `dialog "Ladder report"` | Holds `radiogroup "Ladder state"` with `radio "Compliant"` and `radio "Non-compliant"`; `radiogroup "Filed from"` with `radio "Deck"` (preselected) and `radio "Pilot boat"`; `group "Defects"` with the checkboxes named in Business rules; `checkbox "Refuse boarding"`; `textbox "Report note"`; a file input labelled `Ladder photo`; a list of chosen photos; `button "File report"`; `button "Close report"`; and `status "Report announcements"`. In the photo list, each stored photo reads `Photo stored` with `SHA-256 <sha256>`. A photo the store refused reads `Photo not stored` beside `button "Retry photo upload"`. The dialog holds at most one photo that was not stored, and choosing another file replaces it. |
| Report | `link "Download photo <n>"`, text `SHA-256 <hex>` | One of each per claimed photo, with `<n>` counting from 1 in claimed order. |
| Move | `link "Pilot card"` | The vessel's latest PDF. |
| Accounts and orders | `link "Export moves"` | Downloads the moves export. |
| Accounts | `button "Publish revision"` | Publishes the form below. The form opens prefilled from the revision with the latest effective time, so changing one value and setting a new label and effective time is enough to publish. |
| Accounts | `textbox "Revision label"`, `textbox "Effective date"`, `textbox "Effective time"` | Date as `YYYY-MM-DD` and time as `HH:MM`, port time. |
| Accounts | `spinbutton "Rate per draft foot"`, `spinbutton "Minimum charge"`, `spinbutton "Detention per half hour"`, `spinbutton "Cancellation charge"` | Dollars with up to two decimals, for example `42.50`. The form sends whole cents to the API. |
| Accounts | `spinbutton "Night surcharge percent"`, `spinbutton "Detention allowance half hours"` | Whole numbers. |
| Accounts | One row per tonnage band, numbered `<n>` from 1 in rising tonnage: `spinbutton "Tonnage band <n> from GT"`, `spinbutton "Tonnage band <n> to GT"`, `spinbutton "Tonnage band <n> amount"` and `button "Remove tonnage band <n>"`. Below the rows: `button "Add tonnage band"` | From and to are whole gross tons, both inclusive. An empty to field means no upper limit, sent as `null`. The amount is dollars with up to two decimals, sent as whole cents. Rows renumber after a removal. |
| Accounts | Revisions list | Each revision shows its label as literal text, its effective time and the refs it priced. |
| Accounts | `button "Issue invoice <id>"`, `status "Billing announcements"` | Each invoice row shows state, number and balance. |

These parts of the section carry stable test hooks with exact `data-testid` values:

- `water-line`: `data-heights-mm` holds six comma-separated whole-millimetre values in route order, each the waypoint's water depth at arrival by the Water depth rule in Business rules.
- `hull`: `data-progress` holds a whole-number percent from 0 to 100 along the section.
- `gate-ribbon`: `data-state` holds `open` or `closed`.
- Each waypoint bar: `bar-<waypoint id>`.

### Interactions (DP-08, DP-10, DP-12, DP-25, DP-34, DP-35, DP-53, DP-54, DP-62, DP-66)

- **Order queue:** the queue holds exactly the moves in status `Ordered`, sorted by boarding instant, earliest first, with ties broken by rising `ref`. A move leaves the queue when it leaves `Ordered`, and joins it when it returns to `Ordered`. For example, with the seed data at start, the queue is `MV-1001` then `MV-1002`.
- **Selecting a move:** activating `Plan <ref> <vessel>` loads that move into the section. The handle and planning day are set from the move's committed boarding time if it has one, otherwise from its boarding time. Without a `move` parameter, the board opens with the first order in the queue loaded, for example `MV-1001` with the seed data at start. If the queue is empty, the section shows `Select a move to plan`.
- **Board link:** the board's address is `/board?move=<ref>&q=<text>`, and the agent's orders screen is `/orders?q=<text>`, with values in standard URL query encoding.
  - Loading a move by `Plan <ref> <vessel>` or by `n` writes `move`. Typing in `Search moves` writes `q`, and clearing the box removes `q`.
  - Both writes replace the current history entry, so they add no history entries and Back leaves the screen.
  - Opening `/board?move=<ref>` for a move the dispatcher may read loads that move into the section by the selection rule above, whatever its status.
  - An unknown `ref` loads the default first queued order and removes `move` from the address, with no not-found page.
  - On load, `q` prefills the searchbox, filters the lists at once, and announces the search count once.
  - Moving the handle, the 10-second board refresh and every other refresh never change the address.
- **Handle by keyboard:** Left and Down move to the previous existing step and Right and Up to the next. Page Down moves 30 real minutes earlier and Page Up 30 real minutes later, each landing on the nearest existing step at or beyond that instant in its direction. Home goes to 00:00 and End to 23:55.
- **Spring-forward date:** for example, on 2027-03-14, Right from 01:55 lands on `03:00 port time`, and Left from 03:00 lands on `01:55 port time`.
- **Fall-back date:** the repeated hour appears once, as its first occurrence. For example, on 2026-11-01, Right from 01:55 lands on 02:00.
- **Handle by pointer and touch:** dragging moves the handle in existing steps, and tapping the track jumps to the nearest existing step. The touch target is at least 44 px, and vertical page scrolling does not take over a horizontal drag.
- **Board shortcuts:** `n` loads the first queued order that sorts after the loaded move in queue order, wrapping to the first queued order when none does. `k` moves focus to the handle, and `a` opens the assignment panel for the loaded move. They work whichever board control has focus, except while the user is typing in a text field.
- **Dialogs, drawer and sheet:** opening one moves focus inside it. Tab and Shift+Tab wrap within the open panel, Escape closes it, and focus returns to the control that opened it. Enter activates the focused control.
- **Assign button:** while an assignment request is waiting for its reply, activating `Assign` again sends nothing new or resends the same request with its key, by the key rule in Feedback states.
- **Waypoint strip:** activating `Waypoint table` by Enter, Space, click or tap collapses or expands the strip. While it is collapsed the table is hidden and inert and the panes move up into its space. Focus stays on the button. A board refresh leaves the strip as the user set it.
- **Board refresh:** every 10 seconds the board refreshes moves, queue and turn list. A refresh never moves focus, closes a panel, changes a selection, clears typed text, moves the handle or changes the address.
- **Other refresh:**
  - Agent and pilot move views re-read status every 30 seconds. They also re-read at once after any action of the user's own that received a server reply. An action that ended with no server reply triggers no immediate re-read.
  - The service state updates at least every 15 seconds.
  - The notice cutoff, notice verdict, committed values and status change only on these reads.
- **Order form:** any edit re-reads the plan from the server after a pause of no more than half a second, under the order form plan rules in Feedback states.
- **Search:** typing filters in place within one second, with no submit or reload.

### Visual design (DP-09, DP-59)

- **Colour:**
  - The ground is a near-black blue-green on every surface, with no white panel anywhere.
  - Text is a pale, cool grey-blue.
  - Water and bar fills are a deep sea teal.
  - Amber marks actions, the time handle and the Pinch marker.
  - A coral red is used only for closed gates, negative margins and outages, and always comes with words.
- **Type:**
  - Headings use Saira Condensed, tall and narrow like instrument labels, with each heading step about one and a quarter times the one below.
  - Body text uses IBM Plex Sans.
  - Every depth, speed, time and amount is set in monospaced numerals with its unit directly beside it.
  - All fonts are bundled with the app.
- **Density and shape:** rows are compact, with hairline rules between regions, square corners, and no shadows or gradients. Tappable controls measure at least 44 px on touch layouts. All text and control contrast meets WCAG 2.2 AA.
- **Composition:**
  - The section runs edge to edge across the planning view, drawn to scale, with small type laid directly over it for waypoint names, speed-limit labels and numerals.
  - Horizontal scale matches distance along the route, and vertical scale matches depth.
  - The hull stands visibly lower than the water line.
  - The seabed line steps up at each controlling depth.

### Motion and effects (DP-10, DP-15, DP-34)

Motion only ever reports a change of state. Every movement starts quickly and settles softly.

- **Handle movement:** when a step's plan paints, the water line changes shape at once. Each waypoint's bar and numerals follow within about an eighth of a second, and the Pinch marker settles last. Everything is done within a third of a second.
- **Gate:** when the handle crosses the limit in either direction, the gate ribbon slides open or closed in about a third of a second. Its text and the Commit control change at once. Moving back across the limit reverses it.
- **Commit:** after the server accepts, the hull travels once from boarding ground to berth, 0 to 100 percent of the section, in 0.7 to 1.1 seconds. It rests at the berth until the next handle move returns it to the boarding ground. On a refusal it does not travel and stays at 0.
- **Panels:** the drawer, sheet and dialogs enter and exit in about a quarter of a second. Reopening a panel during its exit keeps it open.
- **Press and hover:** controls respond within about a tenth of a second with an amber hairline.
- **Loops:** no decorative or unnamed loop runs anywhere.
- **Reduced motion:** the water line, bars and gate snap to their new state with no travel or ribbon slide, and the hull's progress goes straight to 100. The waypoint table, slider, window strip and Commit work exactly the same.

### Feedback states (DP-03, DP-10, DP-11, DP-14, DP-28, DP-29, DP-30, DP-36, DP-49, DP-51, DP-55, DP-63, DP-65)

Placeholders:

- `<ref>` is a move reference, `<vessel>` a vessel name and `<waypoint>` a waypoint name.
- `<HH:MM>` and `<HH:MM:SS>` are port time, and `<YYYY-MM-DD HH:MM>` is a port-local date and time.
- `<margin>` is signed metres with two decimals, by the Numerals rule in Business rules, for example `+0.02`.
- `<total>` is a money amount without its dollar sign: whole dollars with a comma between each group of three digits, a point, then exactly two decimals. For example, with the seed data at start, `Tern Arrow` boarding by day estimates `Estimate $2,912.50 CAD`. Every amount on screen uses this format with a leading `$`.
- `<number>` is the provider's invoice number, and `<name>` is the pilot's name.
- `<sha256>` is lowercase hexadecimal, and `<count>` is a whole number.
- `<id>` is a report id, `<label>` a revision label shown as literal text, `<status>` a move status string, and `<kind>` a kind from the Mailpit table in Services.

Every string below renders exactly, with straight apostrophes and plain hyphens.

**Handle plan rules:**

- Every value the section and waypoint table show for a handle step comes from the server's plan for that step and planning day.
- A plan reply paints only if its step and planning day are still the handle's current ones. A reply for an older value or an older planning day never paints and never triggers an announcement.
- Announcements are made only once the handle has rested on one value for half a second and that value's plan has painted. The region then compares the painted pinch and gate with the pinch and gate it last announced. Loading a move sets the baseline without announcing.
- So after the user holds an arrow key, the final screen and the single announcement match the final value.

**Order form plan rules:**

- Each plan request from the order form belongs to the full set of form inputs it was sent for: vessel, stored draught millimetres, speed, block coefficient, length, gross tonnage, boarding date and boarding time.
- A reply paints only if those inputs are still the form's current inputs. Otherwise it is dropped silently, even when it arrives after the reply for a later input.
- While the reply for the current inputs is outstanding, `Order clearances` keeps the last painted values, even though they belong to earlier inputs, and the live plan announcement does not change.
- Only the reply for the current inputs replaces those values. A reply for inputs the form no longer holds is never painted.
- The live plan announcement is made once per set of inputs, after the form has rested on them for half a second and their plan has painted.
- Switching `Draught units` does not change the inputs, because the stored millimetres are the same. It sends no plan request, changes no clearance numeral and makes no announcement.
- If the reply for the current inputs fails, the region keeps the last painted values and announces the live plan failure copy below. A late success for older inputs does not clear that message.

| Action | Live region | Pending | Success | Failure |
|---|---|---|---|---|
| Sign in | Inline text | `Signing in...` | Moves to the role's screen | `Email or password is incorrect` |
| Handle rested | `Section announcements` | None | Pinch change only: `Pinch <waypoint>, margin <margin> m`. Gate change only: `Gate open` or `Gate closed`. Both: one update with the pinch first, joined by a full stop and a space, `Pinch <waypoint>, margin <margin> m. Gate open` or `Pinch <waypoint>, margin <margin> m. Gate closed`. Neither: the region does not change | None |
| Commit | `Section announcements` | `Committing window...` | `Window committed at <HH:MM> port time, pinch <waypoint> <margin> m` | Another dispatcher changed the move: `Commit refused: another dispatcher changed this move. Section redrawn from fresh data.` Stale plan: `Commit refused: the tide table or draught changed. Section redrawn from new values.` Closed: `Commit refused: the window no longer clears at <waypoint>.` Time already past: `Commit refused: that boarding time has passed.` Time that does not exist: `Commit refused: that time does not exist in port time on this date.` |
| Place order | `Order announcements` | `Placing order...` | `Order <ref> placed` | Field messages in `Form errors`, announced as `<count> fields need attention` |
| Live plan | `Order announcements` | None | `Window open, pinch <waypoint> <margin> m, estimate $<total> CAD`, or the same with `Window closed` | `Plan unavailable - last values shown` |
| Assign | `Board announcements` | `Assigning pilot...` | `Pilot <name> assigned to <ref>` | Stale or lost: `Another dispatcher changed this move. Fresh data shown.` Licence: `Pilot <name> is not licensed for this vessel. Fresh turn list shown.` Turn: `Pilot <name> is not next eligible. Fresh turn list shown.` Rest: `Rest rules not met. Type an immediate-safety reason to override.` Invalid reason: `Override reason not accepted. Type 10 to 500 characters for a pilot breaching rest.` |
| Board refresh | Text item only, not announced | None | `Board refreshed <HH:MM:SS> port time` | `Board refresh failed - showing data from <HH:MM:SS>` |
| Search | `Board announcements` | None | `<count> moves shown` | None |
| Amend | `Move announcements` | `Saving amendment...` | `Amendment saved`. If the window no longer clears: `Amendment saved. Window no longer clears - move returned to Ordered.` If late, the late-amendment notice follows | Conflict: `This move changed. Fresh data shown.` Illegal: `This move can no longer be amended.` |
| Cancel | `Move announcements` | `Cancelling move...` | `Move cancelled`, or the late-cancellation notice | `This move can no longer be cancelled.` |
| Status action | `Move announcements` | `Saving...` | Completion: `Move completed. Charges post when the billing provider confirms.` Others: `Status now <status>` | `This action is not available for the move's current status.` |
| Photo upload or retry | `Report announcements` | `Uploading photo...` | `Photo stored. SHA-256 <sha256>` | Store down: `Evidence store unreachable - photo kept on this device, retry when it returns.` Too large: `Photo is over 5,000,000 bytes.` Either 415: `Photo is not a JPEG, PNG or WebP image.` |
| File report | `Report announcements` | `Filing report...` | `Report <id> filed` | Field messages in `Form errors` |
| Publish revision | `Billing announcements` | `Publishing revision...` | `Revision <label> published, effective <YYYY-MM-DD HH:MM> port time` | Field messages in `Form errors` |
| Issue invoice | `Billing announcements` | `Issuing invoice...` | `Invoice <number> issued` | `Invoice pending provider confirmation` |
| Any action with no server reply | That action's region | As above | None | `No reply from the server. Showing the last confirmed state.` |

"No server reply" means the request ended without any HTTP reply, because the connection failed or was cut, or no reply arrived within 20 seconds.

**Keys and retries.** The browser sends an `Idempotency-Key` header on every keyed route listed in Business rules. In the interface those are `Place order`, `Confirm cancellation`, `File report`, `Assign`, `Confirm pilot away`, `Confirm boarding`, `Complete move`, `Start detention`, `Stop detention` and `Issue invoice <id>`.

- A key is created when the user first activates a control with its current inputs.
- After the no-reply copy, activating the same control again with unchanged inputs resends the same key. The server's stored reply then paints with that action's success copy, or with its stored failure copy.
- A second activation while the first request is still waiting sends nothing new or resends the same key.
- Changed inputs, a different control, or any activation after a reply was received get a new key.
- After the no-reply copy, the screen keeps the last confirmed state, including the control that was activated, until the user acts again or the next scheduled read in Interactions. No immediate re-read follows a request that got no reply.
- If a scheduled read shows the action was applied, the screen shows the confirmed new status. Controls that status no longer permits are removed, and the no-reply message is cleared because the state it reported has changed.

**Server-confirmed state:**

- A move row's status, a photo's stored state, an invoice's issued state and number, a notice's `sent` state and the `Charges` text change only when a server reply shows the change.
- A refused, failed or unanswered request leaves every one of them at its previous value and shows that action's failure copy.
- Once shown, a failure or no-reply message stays until the user acts again in that control or the fact it reports changes. No board refresh, status refresh or repaint replaces it.
- After a refused commit of either stale kind, the section and table redraw from the fresh move and its fresh plan. The hull's progress stays at 0, and `Commit window` reflects the fresh gate.

**Published notices and page text:**

- **Late-cancellation notice:** `Cancelled late - under 2 hours' notice. The cancellation charge applies.`
- **Late-amendment notice:** `Late amendment - under 2 hours' notice. The cancellation charge applies.`
- **Notice verdict:** comes from the server and reads `Notice on time - no cancellation charge` or `Under 2 hours' notice - cancellation charge applies`. It updates on the reads described in Interactions and never from the device clock or zone.
- **Ladder-refused heading:** `Boarding refused at ladder`, a level 2 heading on the move and on the report.
- **Not-found page:** a level 1 heading `We can't find that record`, the same for missing records and for those of another agency.
- **Detained status:** `On board - detained`.
- **Invoice pending text:** `Invoice pending provider confirmation`, with the number shown as `-`. It stays through every later refresh until the provider confirms.
- **Issued invoice, provider unreachable when read:** the stored number and balance remain, with `Balance last confirmed <HH:MM> port time`.

**Service outage copy.** Each line is shown and announced in `Service announcements` while that service is down, and cleared when it returns:

- **Billing:** `Billing provider unreachable - charges and invoices are pending and will post automatically.`
- **Storage:** `Evidence store unreachable - photo uploads are paused until it returns.`
- **Mail:** `Mail service unreachable - notices are pending and will send automatically.`

## Backend

### API (DP-01 to DP-08, DP-13, DP-14, DP-16, DP-18 to DP-21, DP-23, DP-27 to DP-29, DP-32, DP-36 to DP-38, DP-41 to DP-49, DP-54, DP-56, DP-58, DP-61, DP-64, DP-66)

Bodies are JSON unless a row says otherwise. Port times are strings without an offset:

- `YYYY-MM-DDTHH:MM` for boarding and effective times;
- `YYYY-MM-DDTHH:MM:SS` for arrivals, cutoffs and server stamps.

Money is whole cents in Canadian dollars. Depths and margins are whole millimetres. Speeds are knots.

**Error shape.** Every error is `{"error":"<code>","message":"<text>"}`. A 422 adds an `errors` object, `{"errors":{"<field>":"<text>"}}`, and some errors add the objects named below.

**Error precedence, for the whole API:**

1. 401 `unauthenticated`.
2. 404 `not_found`, for an unknown record or one the user may not read, ids in the body included. The body is the same in both cases: `{"error":"not_found","message":"Not found"}`.
3. 403 `forbidden`, for a role that is not permitted.
4. An idempotent replay, or a wait on an in-progress request with the same key, returns its stored response before any later check. A key reused with a different body answers 409 `idempotency_conflict` at this step.
5. 428 and 412 version checks.
6. 409 state conflicts.
7. 422 validation.

The one exception: `stale_plan` and `window_closed` run after 422, because they need a valid body.

**Shapes**

- `Move`:

  ```
  {"ref","version","status","detained","agency_code",
   "vessel":{"id","name","imo","length_m","gross_tonnage","block_coefficient"},
   "draught_mm","draught":{"metres","feet"},"speed_kn","duty_minutes","boarding_at",
   "committed":{"boarding_at","pinch_waypoint","margin_mm","tide_version"}|null,
   "pilot":{"id","name"}|null,
   "notice":{"state":"on_time"|"late","cutoff_at","cutoff_utc_offset"},"server_now","late_amendments",
   "detention":{"open","seconds"},
   "notices":[{"kind","to","state":"pending"|"sent"}],
   "billing":{"state":"none"|"pending"|"posted","invoice_id","invoice_ids":[id]},
   "lines":[Line],"ladder_reports":[id],"history":[{"at","status","by"}]}
  ```

  - `draught.metres` and `draught.feet` are strings, by the Draught rule in Business rules.
  - `notice.cutoff_at` and `notice.cutoff_utc_offset` follow Notice cutoff in Business rules.
  - Dispatchers and the currently assigned pilot also get `dispatcher_notes`.
  - Dispatchers also get `rest_override`.
  - Every other reader, port agents included, gets neither key.
  - Every stored change to a move raises `version` by one.
- `Plan`:

  ```
  {"tide_version","boarding_at","draught_mm","required_mm",
   "waypoints":[{"id","name","distance_nm","sounded_depth_mm","confined","speed_limit_kn",
                 "leg_speed_kn","arrival_at","arrival_utc_offset","tide_mm","squat_mm",
                 "clearance_mm","margin_mm","pinch"}],
   "pinch":{"waypoint_id","margin_mm"},"window_state":"open"|"closed",
   "estimate":{"tariff_revision","lines":[Line],"total_cents"}}
  ```

  - `speed_limit_kn` is a number or `null`.
  - `arrival_utc_offset` is `"-03:00"` or `"-04:00"`.
  - `estimate` covers the draft-foot, tonnage-band, minimum-charge and night lines at that boarding time.
- `Line`: `{"label","quantity","unit_cents","amount_cents","tariff_revision"}`.
- `Invoice`: `{"id","move_ref","agency_code","state":"pending"|"issued","number"|null,"balance_cents"|null,"lines":[Line],"total_cents","charge_state":"pending"|"posted"}`.
- `Draught input`: exactly one of `draught_m` (up to three decimals), or `draught_ft` together with `draught_in`.

**Limits.** JSON bodies may be up to and including 65,536 bytes. A larger body answers 413 `payload_too_large`. A body with an unsupported content type answers 415 `{"error":"unsupported_media_type","message":"Unsupported content type"}`.

"Keyed" in a row means the route takes an optional `Idempotency-Key` header under the Idempotency rule in Business rules.

| Method and path | Who | Request | Success | Own errors |
|---|---|---|---|---|
| `GET /api/health` | Public | None | 200 `{"status":"ok"}` | None |
| `GET /api/port` | Public | None | 200 `{"port":"Port Ansell","zone":"America/Halifax","now","store_date","tide_version","step_minutes":5,"waypoints":[...]}`. Each waypoint carries its seed columns, `speed_limit_kn` included | None |
| `GET /api/services` | Signed in | None | 200 `{"billing":"up"\|"down","storage":"up"\|"down","mail":"up"\|"down"}` | None |
| `POST /api/session` | Public | `{"email","password"}` | 200 `{"user":{"id","name","role","agency_code"}}`, and sets an HttpOnly session cookie | 401 `invalid_credentials` |
| `GET /api/session` | Signed in | None | 200, same body | None |
| `DELETE /api/session` | Signed in | None | 204 | None |
| `GET /api/vessels` | Agent, dispatcher, pilot, by visibility | None | 200 `{"vessels":[...]}` | None |
| `POST /api/plan` | Agent, dispatcher | `{"vessel_id","boarding_at","speed_kn",draught input, optional "block_coefficient","gross_tonnage","length_m"}` | 200 `Plan` | None |
| `GET /api/moves` | All roles, by visibility | Query `q`, `status` | 200 `{"moves":[Move]}` | None |
| `GET /api/exports/moves.csv` | Agent (own), dispatcher, clerk | None | 200 `text/csv; charset=utf-8`, by the Export rule in Business rules | None |
| `POST /api/moves` | Agent | `{"vessel_id","boarding_at","speed_kn","duty_minutes",draught input, optional vessel details}`. Keyed | 201 `Move` | None |
| `GET /api/moves/{ref}` | By visibility | None | 200 `Move` with an `ETag` of its version | None |
| `PATCH /api/moves/{ref}` | Agent, dispatcher | Any of the order fields; `If-Match` required | 200 `Move`, with `"window_returned":true` when it returned to `Ordered` and `"late_notice":true` when late | 428 `version_required`; 412 `stale_version` with `current` (a `Move`); 409 `not_amendable` |
| `POST /api/moves/{ref}/cancel` | Agent, dispatcher | `{}`. Keyed | 200 `Move` | 409 `not_cancellable` |
| `POST /api/moves/{ref}/reorder` | Agent | `{"boarding_at","correction"}` | 200 `Move` | 409 `illegal_transition` |
| `GET /api/moves/{ref}/plan` | By visibility, not clerk | Optional query `boarding_at`, defaulting to the move's boarding time | 200 `Plan` | None |
| `GET /api/moves/{ref}/windows?date=` | By visibility, not clerk | Query `date` as `YYYY-MM-DD`, required | 200 `{"date","tide_version","windows":[{"from":"HH:MM","to":"HH:MM"}]}` | None |
| `POST /api/moves/{ref}/commit` | Dispatcher | `{"boarding_at","tide_version","draught_mm"}`; `If-Match` required | 200 `Move` | 428 `version_required`; 412 `stale_version` with `current`; 409 `illegal_transition`; 409 `stale_plan` with `plan`; 409 `window_closed` with `plan` |
| `GET /api/moves/{ref}/eligibility` | Dispatcher | None | 200 `{"boarding_at","next_eligible","turn":[{"pilot_id","name","position","licence_class","eligible","reasons":[],"rest_until"}]}`, where `next_eligible` is a pilot id or `null` | None |
| `POST /api/moves/{ref}/assignment` | Dispatcher | `{"pilot_id", optional "note","rest_override_reason"}`; `If-Match` required. Keyed | 200 `Move` | 428 and 412 as for PATCH; 409 and 422 by the assignment checks in Business rules, each 409 carrying `turn` |
| `POST /api/moves/{ref}/transitions` | Dispatcher, assigned pilot | `{"to":"Pilot away"\|"On board"\|"Completed"}`. Keyed | 200 `Move` | 409 `illegal_transition`; 409 `detention_open` |
| `POST /api/moves/{ref}/detention` | Dispatcher, assigned pilot | `{"action":"start"\|"stop"}`. Keyed | 200 `Move` | 409 `illegal_transition`, `detention_already_open`, `detention_not_open` |
| `POST /api/moves/{ref}/photos` | Assigned pilot, dispatcher | Raw bytes with content type `image/jpeg`, `image/png` or `image/webp`, up to and including 5,000,000 bytes | 201 `{"photo_id","sha256","size_bytes","key"}` | In this order: 413 `payload_too_large`; 415 for any other declared type; 422 for an empty body; 415 content mismatch, from Business rules; 503 `storage_unavailable` |
| `GET /api/photos/{id}/content` | The uploader; once claimed, anyone who may read the report | None | 200 the exact bytes, with the stored content type and header `X-Checksum-Sha256: <sha256>` | 503 `storage_unavailable` |
| `POST /api/moves/{ref}/ladder-reports` | Assigned pilot, dispatcher | `{"compliant","defects":[code], optional "refuse_boarding","location","note","photo_ids":[id]}`. Keyed. Defaults: `refuse_boarding` `false`, `location` `"deck"` (or `"pilot_boat"`), `note` an empty string, `photo_ids` an empty list | 201 `{"id","move_ref","compliant","defects","refused","location","note","photos":[{"photo_id","sha256","size_bytes"}],"filed_by","filed_at"}` | 409 `illegal_transition`; 422 |
| `GET /api/ladder-reports/{id}` | By visibility | None | 200, same body | None |
| `POST /api/vessels/{id}/pilot-cards` | Agent (own), dispatcher | Raw `application/pdf`, up to and including 10,000,000 bytes | 201 `{"card_id","sha256","size_bytes","key"}` | In this order: 413; 415 for any other declared type; 422 for an empty body; 415 content mismatch; 503 `storage_unavailable` |
| `GET /api/vessels/{id}/pilot-cards/{card_id}/content` | Owning agent, dispatcher, a pilot currently assigned to a move of that vessel | None | 200 the exact bytes with `X-Checksum-Sha256` | 503 `storage_unavailable` |
| `GET /api/tide?date=` | Signed in | None | 200 `{"date","version","events":[{"at":"HH:MM","type":"high"\|"low","height_mm"}]}` | None |
| `POST /api/tide-revisions` | Dispatcher | `{"date","events":[...]}` with 2 to 6 alternating events | 201 `{"version","returned_to_ordered":[ref]}` | 422 |
| `GET /api/pilots` | Dispatcher | None | 200 `{"pilots":[...]}` in turn order | None |
| `GET /api/me/next-job` | Pilot | None | 200 `{"move":Move\|null,"plan":Plan\|null}`. `move` is the pilot's current assignment in `Pilot assigned`, `Pilot away` or `On board` with the earliest boarding time | None |
| `GET /api/skips` | Dispatcher | None | 200 `{"skips":[{"pilot_id","reasons":[code],"move_ref","at"}]}` | None |
| `GET /api/overrides` | Dispatcher | None | 200 `{"overrides":[{"id","move_ref","pilot_id","reason","by","at"}]}` | `PUT`, `PATCH` or `DELETE` on `/api/overrides/{id}` answers 405 `method_not_allowed` |
| `GET /api/tariff-revisions` | Signed in | None | 200 `{"revisions":[...]}` in rising `effective_at` order. Each revision has the fields of the publish body plus `"moves":[ref]`, by the per-revision rule in Business rules | None |
| `POST /api/tariff-revisions` | Clerk | `{"label","effective_at","draft_foot_cents","minimum_cents","tonnage_bands":[{"from_gt","to_gt"\|null,"cents"}],"night_percent","detention_half_hour_cents","detention_allowance_half_hours","cancellation_cents"}` | 201, the revision | 409 `effective_time_taken`; 422 |
| `GET /api/invoices` | Clerk, agent (own) | None | 200 `{"invoices":[Invoice]}` | None |
| `GET /api/invoices/{id}` | Clerk, agent (own) | None | 200 `Invoice` | None |
| `POST /api/invoices/{id}/issue` | Clerk | `{}`. Keyed | 200 `Invoice` once the provider has confirmed. 202 `Invoice` with state `pending` while it has not | None |
| Provider-dependent reads | Any | None | Never answer 5xx for billing or mail state; they return the stored truth | None |

**Validation.** Failures answer 422 with an `errors` key per field.

- **`boarding_at`, on every route that carries it:**
  - It must name a time that exists in port time. A time inside the hour skipped on a spring-forward date answers `{"errors":{"boarding_at":"That time does not exist in port time on this date"}}`. This message wins over any other `boarding_at` message.
  - It must fall on a 5-minute step.
- **`boarding_at` later than the server's clock:** this applies on exactly these routes:
  - `POST /api/moves`;
  - `PATCH /api/moves/{ref}`, when the patch changes the boarding time;
  - `POST /api/moves/{ref}/commit`;
  - `POST /api/moves/{ref}/reorder`.
- **Past times allowed:** `POST /api/plan` and `GET /api/moves/{ref}/plan` accept a past `boarding_at` and answer 200, so a seeded `On board` move still shows its plan.
- **Windows:** `GET /api/moves/{ref}/windows` accepts any valid date and answers 200. For today's date it lists every open step from 00:00 through 23:55, steps already past included.
- **Tide events:** an event time in a skipped hour answers 422 on `events`.
- **Numeric ranges, all inclusive:**
  - draught from 2.000 to 16.000 m;
  - `speed_kn` from 3 to 16;
  - `block_coefficient` from 0.40 to 0.95;
  - `duty_minutes` from 30 to 1440.
- **Revisions:**
  - `effective_at` must be later than the server's clock.
  - `label` must be one line of 1 to 40 characters inclusive, holding no carriage return or line feed. Otherwise it answers `{"errors":{"label":"Label must be one line of 1 to 40 characters"}}`.
  - `tonnage_bands`: the first `from_gt` is 0, each later `from_gt` is one above the previous `to_gt`, both bounds are inclusive, and only the last band has a `null` `to_gt`.
  - `draft_foot_cents`, `minimum_cents`, each band's `cents`, `detention_half_hour_cents`, `cancellation_cents` and `detention_allowance_half_hours` are whole numbers, 0 or more.
  - `night_percent` is a whole number from 0 to 100 inclusive.

### Business rules (DP-02, DP-04 to DP-08, DP-13, DP-14, DP-16, DP-18 to DP-21, DP-23, DP-24, DP-27 to DP-29, DP-32, DP-36 to DP-38, DP-41 to DP-43, DP-45, DP-46, DP-47, DP-50, DP-55, DP-61, DP-64, DP-66)

**Visibility.** This rule decides every read of a record and every "by visibility" row in API. A record outside it answers 404.

- **Dispatcher:** every move, ladder report and vessel.
- **Clerk:** every move, ladder report and invoice. The clerk reads no vessel list, plan or windows, and those routes answer 403.
- **Port agent:** the moves, ladder reports, vessels, pilot cards and invoices of their own agency, and nothing else. The same applies to search results, the moves export and each revision's `moves` list.
- **Harbour pilot:** every vessel, plus each move they are or ever were assigned to, with that move's ladder reports. This access survives a release, a refusal, a re-order or completion, so the pilot who filed keeps seeing the refused heading on the move and the report.

"Assigned pilot" in API means the move's current `pilot`.

- A pilot who may read a move but is no longer its current pilot gets 403 on its action routes.
- A pilot who may read a vessel but is not currently assigned to a move of it gets 403 on its pilot cards.

**Port time.** All operating time is in America/Halifax, whatever the browser's or server's zone.

- Every duration is real elapsed time, never a difference of wall-clock readings. This covers tide interpolation, leg arrivals, rest, detention and the notice cutoff.
- On a spring-forward date (for example 2027-03-14, when 02:00 becomes 03:00), the skipped hour has no boarding steps and answers the 422 in API.
- On a fall-back date (for example 2026-11-01, when 02:00 becomes 01:00), a repeated local time means its first occurrence, and the second occurrence is never a step.
- Each plan arrival carries its UTC offset: `-03:00` in daylight time and `-04:00` in standard time.

**Leg speed and arrival.**

- The leg ending at a waypoint runs at the lesser of the ordered `speed_kn` and that waypoint's speed limit. With no limit, the ordered speed applies.
- A waypoint's arrival is boarding time plus the exact sum of leg distance divided by leg speed over every leg up to it, in real elapsed time.
- That cumulative value is rounded half up to the nearest second once per waypoint. Leg times are never rounded and then added.

**Clearance.** For each waypoint, in order:

1. Predicted tide comes from the tide rule below at the rounded arrival, rounded half up to a whole millimetre.
2. Squat in metres is block coefficient times the leg speed in knots squared, divided by 100, or by 50 at a waypoint flagged confined. It is rounded half up to a whole millimetre.
3. Clearance is sounded depth plus predicted tide minus draught minus squat.
4. Required clearance is the greater of 1,000 mm and 10% of draught, rounded half up to a whole millimetre.
5. Margin is clearance minus required clearance.

The pinch is the waypoint with the lowest margin, the first along the route on a tie. The gate is open only when every margin is 0 or more, so a margin of exactly 0 clears. Screen numerals come from these values.

**Water depth.** A waypoint's water depth at arrival is its plan `sounded_depth_mm` plus its plan `tide_mm`, in whole millimetres. Each value of the `water-line` hook's `data-heights-mm` is exactly this number for that waypoint. The `Water` cell of `table "Waypoints"` shows the same number in the clearance-cell format of Numerals.

**Numerals.**

- Metres show two decimals, except draught, which shows three.
- To display metres, round the size of the millimetre value half up, then apply the sign. So -75 mm shows as `-0.08`.
- A margin always shows a sign taken from its stored value, even when it rounds to zero: 0 mm or more is `+`, below 0 mm is `-`. So +4 mm shows as `+0.00`, -4 mm as `-0.00` and 0 mm as `+0.00`.
- Feet and inches take the size of the stored millimetres divided by 25.4, rounded half up to the nearest quarter inch. The format is `36 ft 9 in`, with quarters as `.25`, `.5` and `.75`, and a leading minus when negative.
- A clearance cell reads, for example, `1.14 m / 3 ft 9 in`.

**Tide.**

- The published day table gives events in port-local time. A local event time means its first occurrence on a fall-back date.
- The height at instant `t` between consecutive events `(t1, h1)` and `(t2, h2)` is `h1 + (h2 - h1) * (1 - cos(pi * (t - t1) / (t2 - t1))) / 2`, where every difference is real elapsed time.
- A waypoint's tide is the height at `t` minus the waypoint's time offset, plus its height offset.
- A date with no published revision uses the seeded standard day.
- Interpolation crosses midnight into the neighbouring date's first or last event.

**Worked example,** with the seed data at start, for `Tern Arrow` on a date with no tide revision and no clock change. Leg speeds are 10, 10, 8, 10, 7 and 7 kn. Squat is 800 mm at the open waypoints, 1,024 mm at `Narrows Sill` and 784 mm at `Kettle Bend` and `Inner Sill`. Required clearance is 1,120 mm.

- **Boarding 04:30:** `Narrows Sill` has clearance 1,134 mm and margin +14 mm. It is the pinch, and the gate is open.
- **Boarding 04:25:** the gate is closed, with `Narrows Sill` at -107 mm.
- **Boarding 06:50:** `Inner Sill` arrives at 09:24:11 and is the pinch at +53 mm, and the gate is open.
- **Boarding 06:55:** the gate is closed, with `Inner Sill` at -74 mm.
- **Windows for the day:** `04:30 to 06:50` and `17:00 to 18:55`.
- **Tide at `Outer Bar` for boarding 05:05:** 8,440 mm on such a date.
- **2026-11-01:** that tide is 8,730 mm, because low water 00:45 to high water 06:55 spans 7 h 10 min of real time. The windows are `04:15 to 06:50` and `17:00 to 18:55`. Boarding at 01:30 reaches `Outer Bar` at 01:48 with offset `-03:00` and `Gannet Shoal` at 01:15 with offset `-04:00`.
- **2027-03-14:** that tide is 7,984 mm, because the same events span 5 h 10 min. The windows are `04:45 to 06:50` and `17:00 to 18:55`.

**Windows.**

- A window is a run of open steps that are consecutive among the date's existing steps, so on a spring-forward date 01:55 followed by 03:00 is consecutive.
- `from` and `to` are the window's first and last open steps.

**Draught.**

- Metres convert exactly. Feet and inches convert at 25.4 mm to the inch, dropping any fraction of a millimetre.
- Clearance and billing read only the stored millimetres.
- The billed draft foot is the stored millimetres divided by 304.8, rounded up once to a whole foot.
- In a `Move`, `draught.metres` is a string of the stored millimetres in metres with three decimals, and `draught.feet` is a string of the stored millimetres in the feet-and-inches format of Numerals. Both are derived from `draught_mm` alone. For example, with the seed data at start, `MV-1001` (Tern Arrow) has `"draught_mm":11200,"draught":{"metres":"11.200","feet":"36 ft 9 in"}`, and `MV-1002` (Kestrel Bay) has `"draught_mm":7600,"draught":{"metres":"7.600","feet":"24 ft 11.25 in"}`.

**Night window.** The night window is port-local 22:00 through 05:59. Both the rest rule and the night surcharge use it.

**Move states.** Status strings are exactly `Ordered`, `Window committed`, `Pilot assigned`, `Pilot away`, `On board`, `Completed`, `Invoiced`, `Cancelled`, `Cancelled late` and `Refused at ladder`.

| From | To | How and who |
|---|---|---|
| `Ordered` | `Window committed` | Commit, by a dispatcher. Re-commit in `Window committed` is also allowed. |
| `Window committed` | `Pilot assigned` | Assignment, by a dispatcher. |
| `Pilot assigned` | `Pilot away` | Dispatcher or assigned pilot. |
| `Pilot away` | `On board` | Dispatcher or assigned pilot. |
| `On board` | `Completed` | Dispatcher or assigned pilot. Refused with 409 `detention_open` while detained. |
| `Completed` | `Invoiced` | Only when the provider confirms the invoice. |
| `Window committed`, `Pilot assigned` | `Ordered` | An amendment or tide revision after which the window no longer clears. |
| `Ordered`, `Window committed`, `Pilot assigned`, `Pilot away` | `Cancelled` or `Cancelled late` | Cancel, by the agent or a dispatcher. |
| `Pilot away` | `Refused at ladder` | A non-compliant report with refusal. |
| `Refused at ladder` | `Ordered` | Corrected re-order, by the agent. |

Every other transition answers 409 `illegal_transition`.

- Commit on `Pilot assigned` answers `illegal_transition`, and so does assignment on anything but `Window committed`.
- An amendment in any state other than `Ordered`, `Window committed` or `Pilot assigned` answers 409 `not_amendable`.
- A cancellation from `On board` or any later state answers 409 `not_cancellable`.

Each transition is decided atomically against the move's current status. Of simultaneous requests for the same transition with different keys or no key, for example the dispatcher and the assigned pilot both sending `Completed`, exactly one gets 200 and each other gets 409 `illegal_transition`. The move then holds one history entry and one billing event.

**Commit.**

- `If-Match` carries the move version the dispatcher planned against.
- Of simultaneous commits carrying the same version, exactly one gets 200 and each other gets 412 `stale_version` with `current`.
- After the version check, the server recomputes the plan at the request's boarding time.
  - If the current `tide_version` or the move's `draught_mm` differs from the request, the answer is `stale_plan`.
  - If any margin is negative, the answer is `window_closed`.
  - Neither answer changes the move.
- Committing sets `boarding_at` to the committed time, with no notice charge.

**Amendment.**

- A change of any plan input on `Window committed` or `Pilot assigned` re-runs the plan.
- If the plan still clears, the move keeps its status and its committed values update.
- If not, it returns to `Ordered`, the committed values clear and any pilot is released. A released pilot goes to the head of the turn list, and the duty is removed.

**Tide revision.** A revision replaces that date's events and raises the single station-wide tide version by one. Each `Window committed` or `Pilot assigned` move is then recomputed at its committed boarding time:

- A move that no longer clears returns to `Ordered` as for an amendment, and is named in the response.
- A move that still clears keeps its status and `committed.boarding_at`. Its `committed.pinch_waypoint` and `committed.margin_mm` take the recomputed values. Its `committed.tide_version` takes the new version, even when its own date was not revised.

**Notice cutoff.** This uses only the server's clock.

- `notice.cutoff_at` is the boarding instant minus exactly 2 hours of real time, written as the port-local wall-clock time at that instant. `notice.cutoff_utc_offset` is that instant's offset, `"-03:00"` or `"-04:00"`, which tells the two occurrences of a repeated local time apart.
- The move screen shows it as `<YYYY-MM-DD HH:MM> ADT` when the offset is `-03:00` and `<YYYY-MM-DD HH:MM> AST` when it is `-04:00`.
- Worked examples:

| Boarding | `cutoff_at` | `cutoff_utc_offset` | Shown |
|---|---|---|---|
| `2027-03-14T03:30` | `2027-03-14T00:30:00` | `-04:00` | `2027-03-14 00:30 AST` |
| `2027-11-07T03:30` | `2027-11-07T01:30:00` | `-04:00` | `2027-11-07 01:30 AST` |
| `2027-11-07T02:30` | `2027-11-07T01:30:00` | `-03:00` | `2027-11-07 01:30 ADT` |
| `2027-11-07T01:30` | `2027-11-06T23:30:00` | `-03:00` | `2027-11-06 23:30 ADT` |

- A cancellation, or a change of `boarding_at`, is late when the server's clock is past the cutoff instant. Exactly at the cutoff is on time.
- A late cancellation ends in `Cancelled late`, and an on-time one in `Cancelled`. Either releases any pilot, as for an amendment.
- A late boarding-time amendment adds one to `late_amendments`.

**Pilot eligibility.** Turn order is one list for the whole station. Licence classes, seeded duties and rest are in Seed data and below. A pilot's `reasons` may hold `licence`, `rest`, `night_rest` and `rota_days`; the last three are the rest-type reasons. All hours below are real elapsed time.

- **Licence:** the class must cover both vessel length and draught.
- **Duty:** a duty runs from boarding time for `duty_minutes`. A completed move's duty ends at its completion, and a refused move's duty ends at the refusal.
- **Rest:** at least 10 hours after a duty of 7 hours or more, and at least 6 hours after a shorter one. Rest must hold both from the pilot's previous duty to this one and from this one to any later duty. Exactly the minimum is allowed.
- **Night rest:** a night duty is one whose port-local boarding time falls in the night window, and a boarding from 00:00 to 05:59 belongs to the previous date's night. At least 12 hours of rest follow the third or later night duty on consecutive nights.
- **Rota days:** a run of consecutive port-local dates with a duty may not exceed 15.
- **Next eligible:** the first pilot in turn order with empty `reasons`.

**Assignment checks.** These run after the version checks, and the first row that matches decides the answer. A `rest_override_reason` counts as supplied when the key is present with a string value, empty strings included. The panel leaves the key out when its box is empty.

| Order | Case | Answer |
|---|---|---|
| 1 | Move is not in `Window committed` | 409 `illegal_transition` |
| 2 | Target fails `licence`, at any turn position, with or without other reasons or an override reason | 409 `licence_not_covering` |
| 3 | Target has a rest-type reason and no supplied override reason, whether ahead of or behind the next eligible pilot | 409 `rest_breach` |
| 4 | Target stands behind the next eligible pilot, whether rested, or breaching rest with a supplied override reason | 409 `not_next_in_turn` |
| 5 | Target has no rest-type reason and an override reason is supplied | 422 `{"errors":{"rest_override_reason":"<text>"}}` |
| 6 | Override reason is outside 10 to 500 characters after trimming, both limits allowed | 422 `{"errors":{"rest_override_reason":"<text>"}}` |
| 7 | Target is the next eligible pilot, or breaches rest with a valid override reason and stands ahead of the next eligible pilot, or there is no next eligible pilot | 200, assigned |

On success:

- Each pilot ahead of the assigned one is recorded as one skip whose `reasons` array holds all of that pilot's codes, for example `["rest","rota_days"]`. Skipped pilots keep their positions.
- The assigned pilot moves to the end of the list.

**Override.** An override gets past `rest`, `night_rest` and `rota_days`, never `licence`. The record is attributed, and no route can alter it.

**Assignment concurrency.**

- Assignment is atomic per move and per pilot.
- Of simultaneous requests carrying the same version with different keys or no key, exactly one gets 200 and each other gets 412 `stale_version` with `current`.
- Requests for the same pilot on different moves end with one 200, and each other gets a 409 with a fresh `turn`.
- A `PATCH` over an older version answers 412.

**Idempotency.** The keyed routes are `POST /api/moves`, `POST /api/moves/{ref}/cancel`, `POST /api/moves/{ref}/ladder-reports`, `POST /api/moves/{ref}/assignment`, `POST /api/moves/{ref}/transitions`, `POST /api/moves/{ref}/detention` and `POST /api/invoices/{id}/issue`.

- A key belongs to the user who sent it and is kept for at least 24 hours.
- A request is identical to an earlier one when it comes from the same user with the same key, the same method and path, and the same JSON body, with key order and whitespace ignored. Headers, `If-Match` included, are not compared.
- An identical request after the first has finished returns the stored status and body exactly, and changes nothing and sends no mail. This holds even when its `If-Match` is now old, so it never answers 412.
- An identical request that arrives while the first is still in progress waits for it, then returns the same status and body. It never answers 412, 409 `illegal_transition` or 409 `idempotency_conflict`.
- The same key with a different path or body, whether the first request is finished or still in progress, answers 409 `idempotency_conflict`.
- Every reply with a status below 500 is stored, except 202. A 202 or 5xx reply is not kept once its request finishes, so a later request with that key runs again; for issue, the Issuing rule keeps that safe.
- Requests without a key are deduplicated only by the state and version rules.
- So a double-pressed, parallel or replayed assignment with one key gives one version step, one `Pilot assigned` history entry, one skip record per skipped pilot, one `Order confirmation` and one `Assignment notice`.

**Evidence content.**

- A photo body must start with the signature of its declared type:
  - JPEG: the bytes `FF D8 FF`;
  - PNG: the bytes `89 50 4E 47 0D 0A 1A 0A`;
  - WebP: the ASCII text `RIFF`, any 4 bytes, then the ASCII text `WEBP`.
- A pilot-card body must start with the ASCII text `%PDF-`.
- A mismatch answers 415 `{"error":"unsupported_media_type","message":"File content does not match its type"}`, and nothing is written to the store.
- An accepted file is stored and served exactly as submitted, never re-encoded or stripped of metadata. Its SHA-256 is computed over the submitted bytes.

**Ladder reports.**

- A report is allowed in `Pilot away` and `On board`; otherwise it answers 409 `illegal_transition`.
- `compliant:false` needs at least one defect. `compliant:true` needs none, and no refusal.
- A refusal needs `compliant:false` and status `Pilot away`.
- A photo id exists only after the store has confirmed the upload, and a failed upload returns no id, so nothing unconfirmed can be claimed.
- A `photo_ids` entry that is unknown, or that belongs to another move or agency, answers 404.
- A photo may be claimed by more than one report on its own move.
- A report with no photo is allowed.
- A refusal releases the pilot and sets the status to `Refused at ladder`. The pilot's turn position and ended duty stay as they are.

Defect codes and their checkbox names:

| Code | Checkbox name |
|---|---|
| `side_ropes` | `Side ropes` |
| `steps` | `Steps` |
| `spreaders` | `Spreaders` |
| `securing` | `Securing points` |
| `climb_height` | `Climb over 9 metres` |
| `man_ropes` | `Man ropes` |
| `deck_access` | `Deck access` |
| `lighting` | `Lighting` |

**Corrected re-order.**

- `correction` is required, 3 to 500 characters.
- A re-order clears the commit and pilot and returns the move to `Ordered` at the new boarding time.
- A re-order is not an amendment: it makes no notice check, never adds to `late_amendments`, and sends no mail.
- Lines and invoices already raised remain.

**Tariff revisions.**

- The revision in force for a move is the one with the latest `effective_at` at or before the move's port-local boarding instant, whatever day the event or invoice is raised.
- Estimates, stored lines, invoices and move views all carry that revision's label, so old and new moves each show their own.
- Labels are shown as literal text on every screen and in every announcement, never interpreted as markup or a formula.
- **Per-revision move lists:** a revision's `moves` lists the moves whose stored lines it priced that the reader may see. A revision whose only priced moves belong to other agencies is still listed for an agent, with `"moves":[]`.

**Export and order rows.**

- The header is `ref,vessel,agency,status,boarding_at,pinch_waypoint,margin_mm,tariff_revision,total_cents`, followed by one row per move the reader may see, in rising boarding instant with ties by rising `ref`. An agent's export holds only their own agency's rows.
- `agency` is the agency code. `boarding_at` uses the port-time format from API. `pinch_waypoint` is the committed pinch waypoint's name, and `margin_mm` the committed margin. Both are empty when nothing is committed.
- `tariff_revision`, and `Priced by <label>` on the agent's order rows, name the revision of the move's newest stored lines. Before any billing event they name the revision in force at its boarding instant.
- `total_cents` is the newest billing event's total, or before any event the estimate total.
- **CSV format:**
  - Every row ends with a carriage return and line feed, the header and the last row included.
  - The text columns are `ref`, `vessel`, `agency`, `status`, `boarding_at`, `pinch_waypoint` and `tariff_revision`. A text value starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets one single quote `'` put in front of it.
  - After that, any field holding a comma, a double quote, a carriage return or a line feed is wrapped in double quotes, with each inner double quote doubled. No other field is quoted.
  - `margin_mm` and `total_cents` are plain base-10 integers with an optional leading `-`, never prefixed or quoted.
  - For example, a label `=HYPERLINK("x","y")` is written as `"'=HYPERLINK(""x"",""y"")"`, and a label `-T61` as `'-T61`.

**Billing events.**

- The billing events are `Completed`, `Cancelled late` and `Refused at ladder`.
- A move in `Cancelled` has no lines and posts nothing.
- At the event the server computes the lines below and stores them once. No revision published afterwards changes them.
- Lines appear in this order:

| Label | Rule | When present |
|---|---|---|
| `Draft foot` | Billed draft foot times the rate | Completed |
| `Tonnage band` | The flat amount for the band holding the gross tonnage | Completed |
| `Minimum charge` | Quantity 1: the revision's minimum less the sum of the two lines above | Completed, when that sum is below the minimum |
| `Night surcharge` | Night percent of the sum of the lines above | Completed, with port-local boarding time in the night window |
| `Detention` | Billed half hours times the rate | Completed, with billed half hours above zero |
| `Cancellation` | Quantity times the cancellation charge | Quantity 1 on `Cancelled late` and `Refused at ladder`, plus one for each counted `late_amendments` on any event; the counter then returns to 0 |

- An estimate holds the first four rows by the same rules.
- Each line is rounded half up to the cent once, when the line is calculated, and never again. The total is the exact sum of its lines.
- For example, with the seed data at start:
  - `Kestrel Bay` boarding by day estimates `Draft foot` $1,062.50, `Tonnage band` $860.00 and `Minimum charge` $77.50, total $2,000.00. By night it adds `Night surcharge` $500.00, total $2,500.00.
  - Seeded move `MV-1009` has `Draft foot` $1,572.50, `Tonnage band` $1,340.00 and `Night surcharge` $728.13, total $3,640.63.
  - A revision with `minimum_cents` 0 never produces a `Minimum charge` line.

**More than one billing event.** A move refused at the ladder and then re-ordered can reach a second billing event.

- Each billing event creates its own invoice, holding only that event's lines, priced by the boarding time in force at that event.
- The move's `lines` holds the lines of all its events, oldest event first.
- `billing.invoice_ids` lists all its invoices, oldest first.
- `billing.invoice_id` is the newest of them, or `null` before any event.
- `billing.state` describes the newest event.
- Only confirming the invoice of a `Completed` event moves the move to `Invoiced`.

**Detention.**

- A detention span runs from a start action to a stop action, by the server's clock, and counts only time at or after the ordered time (`boarding_at`). Spans add up.
- Billed half hours are the whole seconds accrued minus the allowance, divided by the half-hour length, rounded up, and never below zero.
- The half-hour length is 1,800 seconds unless `DETENTION_UNIT_SECONDS` sets it. The allowance is that length times `detention_allowance_half_hours`.

**Issuing.**

- An invoice is committed in the provider at most once.
- Simultaneous issue requests for one invoice wait for the single commit in progress and all return its outcome: every response has the same state and the same `number`, and the move's history holds one `Invoiced` entry.
- Issuing an invoice that is already `issued` answers 200 with the stored invoice and makes no provider call.

### Services (DP-26, DP-36, DP-39, DP-46, DP-47, DP-49, DP-50, DP-60)

**Steps and retries.**

- Completion, charge posting, invoice commit and each notice are separate recorded steps.
- A pending step is retried at least every 15 seconds and runs exactly once.
- If a provider is down, the local action still succeeds and the pending state shows.

**Service state.** `GET /api/services` reflects a live check no older than 15 seconds, and reports `down` when the service cannot be reached.

**Kill Bill.**

- **Accounts:** each agency has one account, with `externalKey` its agency code, name its agency name, and currency CAD. Several app instances can share one Kill Bill tenant, so when an account is first needed the app looks it up by `externalKey` and reuses it if it exists. It creates the account only if none exists.
- **Posting charges:**
  - At each billing event the app creates its invoice record with state `pending`.
  - The lines then post as one `DRAFT` invoice, with one `EXTERNAL_CHARGE` item per line in line order.
  - Each item's amount has two decimals, and its description is `<ref> <label>`.
  - `charge_state` then becomes `posted`, and the app keeps the Kill Bill invoice id.
- **Ambiguous replies:**
  - The posting step records each attempt before calling the provider.
  - After an ambiguous reply (a timeout or a reset connection), it reads the agency account's invoices back before trying again. If a `DRAFT` invoice from that attempt holds this event's items, the step adopts it.
  - A billing event therefore never leaves a second `DRAFT` invoice of its items on the account.
- **Issue:**
  - Issuing commits that invoice to `COMMITTED` in Kill Bill.
  - Only then is the state `issued`, with `number` and `balance_cents` from Kill Bill's reply. Only then does a `Completed` move become `Invoiced`.
  - `Cancelled late` and `Refused at ladder` moves keep their status when invoiced.
  - Issuing while Kill Bill is down, or while the charges are still pending, answers 202 with state `pending`. The commit runs once when the provider returns.
- **Reading:** reading an issued invoice re-reads the balance when the provider answers. Otherwise it returns the last confirmed value.

**MinIO.**

- **Bucket:** the app creates the bucket named by `S3_BUCKET`, private, if it is absent. It checks at start and again at each storage check until the bucket exists.
- **Keys:**
  - Photos go to `ladder-photos/<photo id>`, and pilot cards to `pilot-cards/<vessel id>/<card id>.pdf`.
  - Objects are stored unmodified, with their submitted content type, and only after the content check in Business rules passes.
- **Confirmation:** a photo or card exists for the app only after the store has confirmed the write and its checksum matches.
- **Store down:** uploads answer 503 `{"error":"storage_unavailable","message":"Evidence store unreachable"}`, and downloads answer the same. Filing a report without a photo still works.

**Mailpit.**

- Mail goes through `SMTP_HOST` and `SMTP_PORT`, from `MAIL_FROM`, which the environment sets to `dispatch@ebbstone.example`.
- Each row below sends once for its state change, and no other state change sends mail. A replayed or waiting keyed request is not a state change.
- `<boarding>` is `YYYY-MM-DD HH:MM port time`.

| Trigger | To | Subject | Kind on the move | Body names |
|---|---|---|---|---|
| `Pilot assigned` | Agent | `Pilot order confirmed: <vessel>` | `Order confirmation` | Vessel, boarding, pilot name |
| `Pilot assigned` | Assigned pilot | `Assignment: <vessel> <boarding>` | `Assignment notice` | Vessel, boarding, pinch waypoint and margin |
| Saved amendment, or return to `Ordered` by a tide revision | Agent | `Pilot order amended: <vessel>` | `Order amended` | Vessel, boarding, status |
| `Cancelled` or `Cancelled late` | Agent | `Pilot order cancelled: <vessel>` | `Order cancelled` | Vessel, boarding, status |
| Pilot released by amendment, tide revision or cancellation | That pilot | `Assignment withdrawn: <vessel>` | `Assignment withdrawn` | Vessel, boarding |
| Filed non-compliant report | One message to the agent and `harbourmaster@port-ansell.example` | `Non-compliant boarding ladder: <vessel>` | `Ladder notice` | Move reference, vessel, defects, report id, each photo's SHA-256, and each photo attached with its exact bytes |

No mail carries a pilot's rest figures, rest-override reasons or dispatcher notes. A ladder notice with an attached photo stays pending while either the store or the mail service is down.

### Seed data (DP-01, DP-06, DP-18, DP-20, DP-41, DP-42, DP-56)

Every seeded person, vessel, business and place is invented. The store seeds itself once, when it is first created.

- `D0` is the port-local date the store was created, published as `store_date`.
- `D0+2 06:00` means 06:00 port time two dates after `D0`.
- The Kill Bill accounts, and any charges for seeded moves, are created by the pending-step mechanism, not seeded in the provider.

**Sign-ins.** All passwords are `Slackwater-2026`.

| Email | Name | Role | Agency |
|---|---|---|---|
| `dispatch1@ebbstone.example` | Hana Lindqvist | dispatcher | None |
| `dispatch2@ebbstone.example` | Callum Adeyemi | dispatcher | None |
| `accounts@ebbstone.example` | Rosalind Pike | clerk | None |
| `agent@corvane.example` | Dario Veitch | agent | `CORV` Corvane Shipping Agency |
| `agent@tidewell.example` | Mina Sorrell | agent | `TIDE` Tidewell Agencies |
| `p01@ebbstone.example` through `p10@ebbstone.example` | The pilots below | pilot | None |

**Licence classes.**

| Class | Up to length | Up to draught |
|---|---|---|
| `A` | 300 m | 13.500 m |
| `B` | 230 m | 11.500 m |
| `C` | 160 m | 8.000 m |

**Pilots,** in turn order, with their seeded duties. A seeded duty has no move, and it counts for every rest rule.

| Id | Name | Class | Seeded duties |
|---|---|---|---|
| `P-01` | Maren Holt | A | None |
| `P-02` | Tobias Reyne | B | None |
| `P-03` | Anneke Dwyer | C | None |
| `P-04` | Ruairi Banks | A | None |
| `P-05` | Owen Castellane | B | 60 minutes at 09:00 on every date from `D0-14` through `D0` |
| `P-06` | Nadia Ferreira | B | 300 minutes at 23:00 on `D0+1`, `D0+2` and `D0+3` |
| `P-07` | Idris Mallory | B | 480 minutes at `D0+2 08:00` |
| `P-08` | Keziah Tran | C | None |
| `P-09` | Lucan Ward | A | None |
| `P-10` | Petra Solis | C | None |

**Vessels.**

| Id | Name | IMO | Agency | Length | GT | Block coefficient | Speed | Draught |
|---|---|---|---|---|---|---|---|---|
| `V-01` | Tern Arrow | 9700011 | `CORV` | 229 m | 43,500 | 0.80 | 10 kn | 11.200 m |
| `V-02` | Kestrel Bay | 9700023 | `CORV` | 148 m | 12,400 | 0.72 | 9 kn | 7.600 m |
| `V-03` | Halcyon Reef | 9700035 | `TIDE` | 190 m | 28,900 | 0.78 | 10 kn | 9.800 m |
| `V-04` | Marram Light | 9700047 | `TIDE` | 289 m | 71,200 | 0.82 | 9 kn | 12.900 m |
| `V-05` | Sable Quay | 9700059 | `TIDE` | 262 m | 64,800 | 0.76 | 8 kn | 11.400 m |

**Port Ansell route.** The boarding ground is at 0 nm and the berth at 23.0 nm. The time offset is in minutes after the standard table, and the height offset is in metres. The speed limit applies to the leg that ends at that waypoint.

| Id | Waypoint | Distance | Sounded depth | Confined | Time offset | Height offset | Speed limit |
|---|---|---|---|---|---|---|---|
| `W1` | Outer Bar | 3.0 nm | 6.20 m | No | 0 | 0.00 | None |
| `W2` | Gannet Shoal | 7.5 nm | 5.40 m | No | +10 | -0.10 | None |
| `W3` | Narrows Sill | 12.0 nm | 5.10 m | Yes | +25 | -0.20 | 8 kn |
| `W4` | Mid Reach | 16.0 nm | 6.80 m | No | +35 | -0.30 | None |
| `W5` | Kettle Bend | 19.5 nm | 5.70 m | Yes | +45 | -0.40 | 7 kn |
| `W6` | Inner Sill | 22.0 nm | 5.30 m | Yes | +55 | -0.50 | 7 kn |

**Standard day,** used for any date with no revision: low water 00:45 at 1.60 m, high 06:55 at 9.60 m, low 13:05 at 1.40 m, high 19:15 at 9.40 m. The tide version starts at 1.

**Tariff revision.** Label `T-2026-A`, effective `2026-01-01T00:00`:

- Draft foot $42.50.
- Minimum charge $2,000.00.
- Tonnage bands:
  - 0 to 9,999 GT: $480.00.
  - 10,000 to 29,999 GT: $860.00.
  - 30,000 to 59,999 GT: $1,340.00.
  - 60,000 GT and above: $1,925.00.
- Night surcharge 25 percent.
- Detention $165.00 per half hour, with an allowance of 1 half hour.
- Cancellation $380.00.

**Moves.**

- Each move uses its vessel's seed values. Committed values come from the formula at seeding, and the committed `MV-1003` and `MV-1004` clear at their seeded boarding times.
- `<store creation>` is the store's creation instant, rounded down to a 5-minute step.
- `MV-1009` and `MV-1010` have their lines stored at seeding, and the pending step posts their charges.

| Ref | Vessel | Status | Boarding | Pilot | Duty minutes |
|---|---|---|---|---|---|
| `MV-1001` | Tern Arrow | `Ordered` | `D0+2 06:00` | None | 360 |
| `MV-1002` | Kestrel Bay | `Ordered` | `D0+2 12:00` | None | 240 |
| `MV-1003` | Halcyon Reef | `Window committed` | `D0+2 05:30` | None | 300 |
| `MV-1004` | Sable Quay | `Pilot assigned` | `D0+2 05:00` | `P-04` | 300 |
| `MV-1005` | Kestrel Bay | `Pilot away` | `D0+1 08:00` | `P-10` | 240 |
| `MV-1006` | Halcyon Reef | `On board` | `<store creation>` minus 60 minutes | `P-02` | 300 |
| `MV-1007` | Tern Arrow | `On board` | `<store creation>` minus 60 minutes | `P-09` | 300 |
| `MV-1008` | Kestrel Bay | `On board` | `<store creation>` minus 60 minutes | `P-08` | 240 |
| `MV-1009` | Tern Arrow | `Completed` | `D0-1 05:30` | `P-09` | 300 |
| `MV-1010` | Halcyon Reef | `Completed` | `D0-1 14:00` | `P-02` | 300 |

`Marram Light` never clears on the standard day, so its windows list is empty.

## Technical requirements

### Deployment (DP-57)

The runtime is Node.js 22 with npm and TypeScript. Place a manifest at `/app/run.json` with string `install`, `build` and `serve`:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- It answers `GET /api/health` with HTTP 200 JSON `{"status":"ok"}` whatever the state of the providers.
- Each serving instance keeps its own embedded file store under `/app`, separated by its port, so several instances can run side by side, each with its own seed.
- The store's schema and seed apply idempotently on serve.

### Configuration and secrets (DP-60)

Read these at start:

- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- `DETENTION_UNIT_SECONDS`, which is optional.

Never hard-code these values or send them to the browser.

### Server boundary (DP-49, DP-57, DP-58)

- The app is same-origin. The browser calls only the app's own origin, loads fonts and scripts from it, and is never allowed to reach a provider directly.
- A state-changing request with an `Origin` header from another origin answers 403 `forbidden`.
- The server never serves source files, the store, environment contents or credentials.
- Session cookies are HttpOnly.
- The request size limits in API apply before the body is read in full.
- A provider unreachable at boot does not stop the app. The app serves at once, reports that service as down, and recovers with no restart when the service returns.

### Browser support and performance (DP-53)

- Support current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800.
- The board is usable within three seconds of load on the seed data.
- A handle step updates all its values within a third of a second, and never waits on a provider.
- The device clock and zone may be wrong, and nothing on screen depends on them.

## Working rules

- IF-01: `/app/run.json` holds string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` names every shipped package and bundled font with its licence; shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- IF-03: Shipped packages and fonts use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1 licences.
- IF-04: No datastore server or external datastore is added beyond the listed services and the one embedded file store.
- IF-05: The provided development service definitions and their images stay untouched.
- IF-06: The repository holds no provider credential values; every credential is read from the environment.

## Engineering standards

- The code is idiomatic strict-mode TypeScript, with no use of `any` on domain values.
- Names in the source use the domain terms of this brief: move, waypoint, leg speed, margin, pinch, draught, squat, duty, turn, notice cutoff, tariff revision, billing event.
- Each domain rule is decided in exactly one place in the source, for example a move transition, the clearance formula, a leg arrival, the rest verdict, a port-time conversion, the notice cutoff, a tariff line or the export cell encoding. The browser renders the server's result for commit, notice, photo and billing state.
- No abstraction has only a single implementation.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the code already rules out.
- Every API error is produced in the one published error shape.
- Money and depth arithmetic use whole cents and whole millimetres, and durations use real elapsed time. Rounding happens only at the published stage.
- The source contains no feature beyond this brief.
