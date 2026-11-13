# Sixbell Rest Log

Sixbell Rest Log records seafarers' hours of rest as they happen on owner-operated small vessels: workboats, survey boats, small coasters and charter yachts. It serves an owner-master running one to four boats, the crew who log their own hours on a phone at sea, and a port inspector who opens one vessel's sealed records through a time-limited link. It uses Postgres as the system of record and a MinIO object store as the archive for sealed PDFs. Out of scope: payroll, crew scheduling beyond the watch rota, email or push notifications, single sign-on, compensatory-rest planning, moving a crew member between vessels, any datastore other than the two named, and any integration with voyage or AIS systems. An owner-master who stands watches logs their own hours through a separate crew sign-in created for themselves.

## Problem and users

International rules require every seafarer to have a minimum of rest in any 24 hours and in any 7 days, with a daily record the seafarer also receives a copy of. The word "any" makes these rolling windows, yet crews often check them by calendar day. A six-on, six-off rota with handovers can reach the daily total while never giving the required long block of rest. Research on seafarers finds that many adjust their records once they exceed the limits. Large fleets buy compliance suites, but an owner who also serves as master usually reconstructs the week at the weekend. That person pays three ways: inspectors cross-check tidy records against voyage data, port state control findings bring costly delays, and crews stay tired. Ship's clock changes make it worse, because a 25-hour or 23-hour day breaks a 24-column paper form, and at sea the connection may drop for days. Sixbell records rest as it happens, works offline, judges every rolling window on elapsed time, and leaves breaches visible.

- **Owner-master** (daily): runs one to four boats, plans watches that pass the rules before sailing, logs clock changes, countersigns records and answers an inspection without a weekend of reconstruction.
- **Crew member** (daily): logs their own work and rest on a phone at sea, sees their rolling totals, signs their record and keeps a copy.
- **Port inspector** (occasional): opens one vessel's sealed records for a stated date range through a time-limited link, without an account, and compares them with voyage events.

## Journeys

1. **Set up a vessel.** A new owner-master starts at the sign-in page with no account. They sign up, add a vessel with its starting offset, add a crew member, and log a clock change with its position fix. The vessel page ends up listing the crew member and the clock change, with its label and any zone warning.
2. **Log a day.** A crew member signs in on a phone and lands on today's ship's day with an empty watch grid. They mark cells as rest and work by tap, drag or keyboard. Each cell shows its state, the page confirms the save, and the rolling totals change to the server's new values.
3. **Log at sea and reconnect.** A crew member has the log open when the connection drops. The offline banner appears, they mark more cells and reload the page, and the queue count rises and survives. When the connection returns the queue empties, the banner goes away and the totals update. An entry whose day closed while it waited shows as a Late entry.
4. **Sign and countersign.** A crew member opens a closed day and signs it in a dialog, and the day reads Signed. The owner-master opens the same day, adds a dated disagreement note if they want one, and countersigns. The day reads Countersigned, and the crew member's hours are unchanged throughout.
5. **Seal a month.** An owner-master opens a month whose logged days are all countersigned and asks to seal it. The month reads Awaiting archive, then Sealed once the archive has confirmed the record. The crew member then downloads their copy. If the archive is down, the banner shows, the month stays Awaiting archive, and it reaches Sealed by itself after the archive returns.
6. **Inspect a vessel.** An owner-master creates a link for one vessel, a date range and an expiry, and gives it to an inspector. The inspector opens it with no account and sees the sealed records, breaches, clock changes, fixes and drills in range. After the owner-master revokes it, or once it expires, the same address shows only the matching message.
7. **Review a voyage.** An owner-master opens a crew member's voyage review with the seed voyage. They drag a window along the 14-day strip, watch the rest figure and globe follow, see the strip open at a clock change, and stop on a breaching window. The record pane then names the rule that failed and the rule set that judged it.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Named sign-in.** Let owner-masters sign up and let owner-masters and crew sign in with an email and passcode, with every protected page and endpoint refused without a session as stated in API.
- **DP-02 — Fleet and crew.** Let an owner-master run up to the published vessel limit and add crew to each vessel, and keep every vessel and crew record invisible to any other owner-master.
- **DP-03 — Clock changes and fixes.** Let an owner-master log a clock change with its position fix, rejecting the illegal changes listed in Business rules and warning without blocking when the new offset is far from the nautical zone.
- **DP-04 — Set up a vessel.** An owner-master completes Journey 1 in the browser, from sign-up to a logged clock change shown on the vessel page.
- **DP-05 — Ship's day filing.** File every entry under the ship's day set by the vessel's logged offset, never by the phone's zone or the server's, with the day's length following any clock change.
- **DP-06 — Rolling totals.** Show a crew member their rolling rest totals for the last 24 and 168 elapsed hours, taken from the server and updated after every saved entry.
- **DP-07 — Keyboard watch grid.** Let a crew member fill the half-hour watch grid and sign the day with the keyboard alone, with a visible focus mark throughout.
- **DP-08 — Log a day.** A crew member completes Journey 2 in the browser, from sign-in to saved cells and updated rolling totals.
- **DP-09 — Offline logging.** While the connection is down, keep the log usable even after a reload, show the published offline banner with a live count of queued entries, and send the queue when the connection returns.
- **DP-10 — One entry per replay.** Apply a replayed entry once, so the crew member ends with one entry and unchanged rolling totals, and reject a reused key with different contents as stated in API.
- **DP-11 — Late entries.** Keep an entry that syncs after its day has closed and mark it Late entry, as qualified in Business rules for signed and sealed days.
- **DP-12 — Log at sea and reconnect.** A crew member completes Journey 3 in the browser, from a dropped connection to an emptied queue and updated totals.
- **DP-13 — Server closes the day.** Decide from the server's clock alone when a ship's day closes, show that decision on the page whatever the device clock says, and refuse direct edits once it has closed.
- **DP-14 — Signature order.** Allow a crew member's signature only on a closed day and an owner-master's countersignature only on a signed day, rejecting every other order with the status in API.
- **DP-15 — Sign and countersign.** A crew member and an owner-master complete Journey 4 in the browser, ending on a Countersigned day with unchanged hours.
- **DP-16 — Recurring watches.** Keep a recurring rota watch at its ship's-time hours across a clock change, with its elapsed hours and the day's planned rest recomputed for the longer or shorter day.
- **DP-17 — Plan verdict.** Show an owner-master whether a planned rota passes the rules before sailing, naming each planned window that would breach them.
- **DP-18 — Rest rules.** Judge every rolling window on elapsed time at half-hour steps under the rules in Business rules, never counting a break shorter than the published minimum as rest.
- **DP-19 — Flag exception rules.** Judge windows under a flag exception rule set by its own published limits, including the limit on how long it may run.
- **DP-20 — Effective-dated rule sets.** Apply a scheduled rule set only to windows ending at or after its start, so every earlier window keeps the verdict of the rule set then in force on every surface.
- **DP-21 — Window values.** Expose the Hour Fold window's start, end, rest hours, verdict, longitude and fold state in the page, each matching the server's computed values.
- **DP-22 — Gap and crease.** Open a labelled gap for a retard and a labelled crease for an advance when the window covers a logged clock change, keeping its elapsed span exact while its clock-face span changes.
- **DP-23 — Globe follows the window.** Turn the canvas globe to the great-circle position interpolated between position fixes at the window's end, with no idle spin.
- **DP-24 — Fold sequence.** Play the ordered sequence in Motion and effects when the window moves, ending in a hatched magenta frame with the word Breach for a breaching window.
- **DP-25 — Reduced motion.** With reduced motion on, draw folds and creases static at full size, change numerals at once and jump the globe to position, with the same values, labels, verdict and slider behaviour.
- **DP-26 — Touch dragging.** Let a crew member on a phone log hours and drag the rolling window by touch, with the window snapping to half-hour steps.
- **DP-27 — Keyboard window control.** Let a crew member move and resize the rolling window with the slider keys, the width radios and the published shortcuts, with a visible focus mark throughout.
- **DP-28 — Crew-only hours.** Let only the crew member write their own hours, and give the owner-master a dated disagreement note beside them that changes no hours.
- **DP-29 — Breaches stay on record.** Keep every recorded breach visible with the published wording and reject any attempt to remove it, even after a later edit on an open day changes the hours.
- **DP-30 — Record mismatch.** Show the published notice to both people when a master-logged drill or call-out overlaps hours logged as rest, until one of them adds a note to it.
- **DP-31 — Seal conditions.** Let an owner-master request sealing only when every condition in Business rules is met, and reject the request with the status in API otherwise.
- **DP-32 — Sealed after archive confirms.** Show a month as Sealed only after the object store holds the record PDF and its checksum is verified, and as Awaiting archive until then.
- **DP-33 — Archive outage recovery.** Start and keep logging with the archive unreachable, show the owner-master the published archive banner, and resume sealing when the archive returns with no restart.
- **DP-34 — Sealed month and copy.** Make a sealed month's hours immutable and give the crew member a downloadable copy of the sealed record.
- **DP-35 — Seal a month.** An owner-master and a crew member complete Journey 5 in the browser, ending on a Sealed month and a downloaded copy.
- **DP-36 — Scoped inspection links.** Let an owner-master create a link limited to one vessel and date range that shows sealed records only and opens nothing outside that scope.
- **DP-37 — Server-judged expiry.** Decide inspection link expiry by the server's clock with the published edge, so that an expired link shows the expired page and no record data whatever the browser's clock says.
- **DP-38 — Revoke, replace and read-only.** Let an owner-master revoke a link or replace it so the old one dies, and refuse any change made through a link.
- **DP-39 — Inspect a vessel.** An owner-master and a port inspector complete Journey 6 in the browser, from link creation to a revoked link showing no record data.
- **DP-40 — Published layouts.** Lay out the voyage review exactly as Screens and layout states at each published viewport, with no sideways page scroll.
- **DP-41 — Dialog keyboard handling.** Keep Tab and Shift+Tab inside every open dialog, close it on Escape and return focus to the control that opened it.
- **DP-42 — Published copy.** Render every backticked string in Feedback states character for character, in the named live region where one is given.
- **DP-43 — Paper-chart look.** Present the product as a paper-chart sheet with hairline-ruled panes, a faint graticule, and magenta used for breaches alone, as described in Visual design.
- **DP-44 — Server boundary.** Enforce the same-origin rule, the request limits and the refusal to serve source files or credentials, and answer the health check at all times, as stated in Server boundary.
- **DP-45 — Server-held secrets and verdicts.** Read every credential from the environment, and decide every verdict, ship's day, closure, expiry and seal state on the server only.

## Frontend

### Screens and layout (DP-01, DP-02, DP-05, DP-06, DP-40)

The pages are:

- `/` Sign-in and sign-up. A signed-in owner-master goes to `/fleet`, and a signed-in crew member goes to `/log`.
- `/fleet` Owner-master only. Lists the owner-master's vessels and adds one.
- `/vessels/<vessel id>` Owner-master only. The vessel page has crew, clock changes and fixes, rota and plan, rule sets, drills and call-outs, and inspection links.
- `/log` Crew only. The current ship's day with the watch grid, day status, rolling totals, notes, notices and a link to the crew member's voyage review. A `date` query value of the form `YYYY-MM-DD` opens that ship's date.
- `/voyage/<vessel id>/<crew id>` Voyage review, open to the owner-master and to that crew member. An optional `start` query value sets the strip's first instant, and an optional `date` query value of the form `YYYY-MM-DD` selects the ship's date the Record pane opens on.
- `/inspect/<token>` Public inspector page. It shows the sealed records in scope, or one of the link messages.

A signed-out visitor to a protected page goes to `/`. An unknown page shows the not-found message from Feedback states with status 404.

The voyage review has three named regions: `region "Voyage"` (globe, current position and list of fixes), `region "Watch strip"` (the 14-day strip with the Hour Fold) and `region "Record"` (verdict, rule wording, day status, notes, breaches and month status). Their order in the document is always Voyage, Watch strip, Record.

The voyage review opens with the window at step 0. The Record pane shows one ship's date and the month holding it, and prints both in the line from Feedback states. That ship's date is the one holding the last half-hour cell inside the window, so it follows the window whenever its step or width changes. A `date` query value keeps the pane on that ship's date until the window first moves, and a value that is not a real date is ignored. In the Record pane, the day status, notes, `button "Sign this day"`, `button "Countersign this day"` and `button "Add a note"` act on that ship's date, while `status "Month status"`, `button "Seal this month"` and `link "Download my copy"` act on that month. The window verdict, failed-rule sentences and rule set line always describe the window itself. On `/log`, the same day and month controls act on the ship's date shown there and the month holding it.

- **375x812 and every width below 768 pixels:** one column in document order, each pane the full width of the page.
- **768x1024 and every width from 768 to 1279 pixels:** two stacked regions. The upper region holds Voyage on the left and Watch strip on the right with their tops aligned. The lower region holds Record at full width, entirely below both.
- **1280x800 and every width from 1280 pixels:** three panes side by side with tops aligned, Voyage on the left, Watch strip in the centre and Record on the right.

The whole 14-day strip always fits its pane's width without any sideways scrolling. The page never scrolls sideways at 375, 768 or 1280 pixels, on this page or any other. A pane taller than the viewport may scroll within the page.

Every other page is one column below 768 pixels. From 768 pixels, content may sit in up to two columns. The watch grid shows 6 cells per row below 768 pixels and 12 cells per row from 768 pixels.

### Public screens and controls (DP-01 to DP-04, DP-07, DP-09, DP-13, DP-14, DP-17, DP-21, DP-23, DP-27, DP-28, DP-30, DP-31, DP-34, DP-36, DP-38, DP-41)

Only these are public. Visible copy equals the accessible name unless stated.

| Where | Role and accessible name | Notes |
|---|---|---|
| `/` | `heading "Sixbell Rest Log"` | Level 1 |
| `/` | `textbox "Email"`, `textbox "Passcode"`, `button "Sign in"` | Sign-in |
| `/` | `button "Create an owner account"` opens `dialog "Create an owner account"` with `textbox "Your name"`, `textbox "Email"`, `textbox "Passcode"`, `button "Create account"`, `button "Cancel"` | Sign-up |
| All signed-in pages | `button "Sign out"` | |
| `/fleet` | `heading "Your vessels"`, `link "<vessel name>"` per vessel | Each link opens the vessel page |
| `/fleet` | `button "Add a vessel"` opens `dialog "Add a vessel"` with `textbox "Vessel name"`, `combobox "Vessel type"`, `textbox "Starting offset in minutes"`, `button "Save vessel"`, `button "Cancel"` | |
| Vessel page | `heading "<vessel name>"`, `region "Crew"`, `region "Clock changes"`, `region "Rota"`, `region "Rule sets"`, `region "Drills and call-outs"`, `region "Inspection links"` | |
| Crew region | `button "Add crew"` opens `dialog "Add crew"` with `textbox "Name"`, `textbox "Rank"`, `textbox "Email"`, `textbox "Passcode"`, `button "Save crew member"`, `button "Cancel"`; `link "Review <crew name>"` opens the voyage review | |
| Clock changes region | `button "Log clock change"` opens `dialog "Log clock change"` with `textbox "Change time in UTC"`, `textbox "New offset in minutes"`, `textbox "Latitude"`, `textbox "Longitude"`, `button "Save clock change"`, `button "Cancel"`; `button "Add position fix"` opens `dialog "Add position fix"` with `textbox "Fix time in UTC"`, `textbox "Latitude"`, `textbox "Longitude"`, `button "Save fix"`, `button "Cancel"` | |
| Rota region | `button "Add watch"` opens `dialog "Add watch"` with `combobox "Crew member"`, `textbox "Watch name"`, `textbox "Start time"`, `textbox "End time"`, `textbox "First ship's date"`, `textbox "Last ship's date"`, `button "Save watch"`, `button "Cancel"` | |
| Rota region | `combobox "Plan for"`, `textbox "Plan from"`, `textbox "Plan to"`, `button "Check plan"`, `table "Planned watches"`, `status "Plan verdict"` | Table columns: ship's date, day length, watch, ship's time, elapsed hours, planned rest |
| Rule sets region | `button "Schedule rule set"` opens `dialog "Schedule rule set"` with `textbox "Starts in UTC"`, `textbox "Ends in UTC"`, `textbox "Flag authorisation"`, `button "Save rule set"`, `button "Cancel"` | Scheduling always creates a flag exception period |
| Drills and call-outs region | `button "Log drill or call-out"` opens `dialog "Log drill or call-out"` with `combobox "Crew member"`, `combobox "Type"`, `textbox "Start in UTC"`, `textbox "End in UTC"`, `textbox "What happened"`, `button "Save event"`, `button "Cancel"` | |
| Inspection links region | `button "Share with an inspector"` opens `dialog "Share with an inspector"` with `textbox "From ship's date"`, `textbox "To ship's date"`, `textbox "Expires in UTC"`, `button "Create link"`, `button "Cancel"` | |
| Inspection links region | Per link: `textbox "Link address"` (read-only), link state as text, `button "Revoke link"`, `button "Replace link"` | Buttons appear only on an active link |
| `/log` | `grid "Watch grid"`, one `gridcell` per half hour named `<HH:MM> <cell state>` | See below |
| `/log` | `status "Day status"`, `status "Sync status"`, `status "Connection"` | |
| `/log` | `region "Rolling totals"`, showing `<rest> hours in the last 24 hours` and `<rest> hours in the last 7 days` | `<rest>` format is in Feedback states |
| `/log` | `button "Previous ship's day"`, `button "Next ship's day"`, `link "My voyage"` | |
| `/log` and Record | `button "Sign this day"` opens `dialog "Sign this day"` with `button "Confirm signature"`, `button "Cancel"` | Crew only |
| Record | `button "Countersign this day"` | Owner-master only |
| `/log` and Record | `button "Add a note"` opens `dialog "Add a note"` with `textbox "Note"`, `button "Save note"`, `button "Cancel"` | The button inside a Record mismatch notice is named `Add a note to this mismatch` and opens the same dialog |
| `/log` and Record | `link "Download my copy"` | Only on a Sealed month |
| Voyage review | `radiogroup "Window width"` with `radio "24 hours"`, `radio "168 hours"` | 24 hours selected at start |
| Voyage review | `slider "Window start"` | Minimum 0, maximum 624 or 336 by width, value is the step, value text is `<start ship time> to <end ship time>` |
| Voyage review | `button "Show earlier 14 days"`, `button "Show later 14 days"` | |
| Voyage review | `group "Hour Fold"` | Carries the data values below |
| Voyage review | `img "Voyage globe"` | A canvas element, with `data-globe-longitude` as below |
| Voyage review | `status "Window verdict"` | |
| Record | `status "Day status"` | For the shown ship's date |
| Record | `status "Month status"`, `button "Seal this month"` | Button for the owner-master only |
| Owner-master pages | `status "Archive status"` | The archive banner |
| Owner-master pages | `status "Feedback"` | Results of owner-master actions |
| `/inspect/<token>` | `heading "Inspection record"`, `table "Sealed days"`, `region "Voyage events"`, `link "Download inspection document"` | Only for a usable link |
| `/inspect/<token>` | `heading` with the link message from Feedback states | Otherwise |

Cell states in gridcell names are `Not logged`, `Rest`, `Work` and `Rest under one hour`. A half hour that a retard makes occur twice adds the word `repeated` at the end of its second-pass name, for example `01:30 Rest repeated`.

`group "Hour Fold"` always carries these attributes, each equal to the matching value from `GET /api/crew/{crew_id}/window`:

| Attribute | Value |
|---|---|
| `data-step` | the step as a whole number |
| `data-window-start-utc`, `data-window-end-utc` | the UTC instants |
| `data-rest-hours` | rest hours to one decimal place |
| `data-verdict` | `pass`, `breach` or `incomplete` |
| `data-longitude` | decimal degrees to two decimal places, or empty when there is no fix |
| `data-fold-state` | `flat`, `gap`, `crease` or `gap_and_crease` |
| `data-clock-face-hours` | the clock-face span as a number |

They update as soon as the step changes. The `img "Voyage globe"` element carries `data-globe-longitude`, the longitude currently drawn at the globe's centre, updated on every drawn frame and to two decimal places.

The window's visible text includes the labels `<start ship time>` and `<end ship time>`, and `<rest> hours of rest`. Ship times use the API's ship-time format.

Every date, time and instant textbox is a text field that accepts the matching API string form. `textbox "Change time in UTC"`, `textbox "Fix time in UTC"`, `textbox "Starts in UTC"`, `textbox "Ends in UTC"`, `textbox "Start in UTC"`, `textbox "End in UTC"` and `textbox "Expires in UTC"` accept the API's UTC instant string. `textbox "Start time"` and `textbox "End time"` accept the string form of the API's `start_time` and `end_time`. `textbox "First ship's date"`, `textbox "Last ship's date"`, `textbox "Plan from"`, `textbox "Plan to"`, `textbox "From ship's date"` and `textbox "To ship's date"` accept the API's ship's date string. `textbox "Starting offset in minutes"` and `textbox "New offset in minutes"` accept a whole number of minutes in the API's offset form, and `textbox "Latitude"` and `textbox "Longitude"` accept decimal degrees.

### Interactions (DP-07, DP-09, DP-21, DP-26, DP-27, DP-28, DP-41)

**Watch grid.** The grid is one Tab stop. Arrow keys move focus one cell left or right, or one row up or down. Space or Enter sets a Not logged cell to Rest and flips Rest and Work. A `Rest under one hour` cell is a logged rest cell, so Space or Enter sets it to Work. R sets the focused cell to Rest and W sets it to Work. Pressing R on a Rest or `Rest under one hour` cell, or W on a Work cell, changes nothing and saves nothing. Each change saves a one-cell entry at once. Only the server decides `Rest under one hour`: a cell just set to rest is named `<HH:MM> Rest` until the server answers, and keeps that name while it is queued offline. After every successful save or sync, all the grid's cells take their names from the server's latest cells, so a lone rest cell becomes `<HH:MM> Rest under one hour`, and adding a neighbouring rest cell returns both to `Rest`. Tapping a cell acts like Space. Pressing and dragging across cells by mouse or touch paints all of them with the state the first cell took, and dragging in the grid does not scroll the page. On a closed day the cells report themselves as disabled and do not change.

**Day display.** `/log` opens on the `today_ship_date` the server returns, never a date from the phone. Day status, closure and whether the grid is editable come only from the server's response. They refresh on page load, after each save and at least once a minute.

**Hour Fold by pointer.** Pressing anywhere on the strip centres the window on the pointer, and dragging moves it with the pointer, snapping to the nearest 30-minute step within the slider's range. Touch behaves the same way, the strip's touch area is at least 44 pixels tall, and dragging on it does not scroll the page. Releasing leaves the window in place.

**Hour Fold by keyboard.** With the slider focused, Left and Down move one step back, Right and Up move one step on, PageDown and PageUp move 48 steps, and Home and End go to the first and last step. In `region "Watch strip"`, `[` moves one step back and `]` moves one step on whichever control in that region has focus. Choosing the other width keeps the step, or lowers it to the new maximum. The tab order in Watch strip is the width radios, the slider, then Show earlier and Show later.

**Strip data.** The strip's cells and window values come from the server on page open, on either Show button, after any save or note from this page, and at least once a minute. The browser holds them and never computes them. `start` must be half-hour aligned, and without it the server's default applies.

**Dialogs.** Opening a dialog moves focus into it. Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last. Escape closes it without saving. Closing, by whatever means, returns focus to the control that opened it. Enter in a text field submits the dialog.

**Offline.** The log stays usable offline for the current ship's day and the two days before it, including after a reload. A change made offline is held on the phone with its entry key and shows immediately in the grid. While offline, `button "Sign this day"`, `button "Countersign this day"`, `button "Add a note"`, `button "Add a note to this mismatch"` and `link "Download my copy"` keep their roles, names and places in the Tab order and report `aria-disabled="true"`; they are never natively disabled. Clicking, tapping or pressing Enter on one opens no dialog, sends no request and shows that action's offline message from Feedback states.

**Focus.** Every control shows a clearly visible focus ring in ink on paper. Tab order follows reading order.

### Visual design (DP-43)

The product is a paper-chart sheet. Warm cream paper is the page, and deep navy ink is the text, rules and controls. Pale sea-blue is rest. Sandy buff is land on the globe and small map marks. A dark magenta is reserved for breaches and appears nowhere else, so it is the only saturated colour on any screen. A faint graticule of hairline grid lines sits behind every pane, like the lines on a chart, and never competes with the text. Panes are divided by thin ruled lines rather than boxes or shadows.

Display type is Spectral, a bookish serif, with pane labels in its italic. Body type is IBM Plex Sans. Numbers in hours, times and coordinates use even-width figures, so columns line up and rolling figures do not jitter. Fonts are served by the app itself. Each heading step is about a quarter larger than the one below it. Density is compact, like a logbook page, yet every control is at least 44 pixels in both directions on touch layouts.

Labels are full sentences in crew vocabulary, never status codes. All text and control contrast meets WCAG 2.2 AA. Breach is never carried by colour alone: the frame is hatched and the word is printed. Work, rest, rest under one hour and not logged are told apart by pattern as well as colour.

### Motion and effects (DP-22, DP-23, DP-24, DP-25)

Motion only explains the window, and all of it starts quickly and settles softly. Dialogs and banners appear in about a fifth of a second or less. Press feedback on buttons is immediate.

**The Hour Fold** answers one question: does any rolling window breach the rules, exactly where, and how did a clock change alter it? As the window moves, these happen in order for each step:

1. The frame moves with the pointer, with no visible lag, and its ship's-time start and end labels update.
2. The numerals roll to the rest hours inside the window, over about a fifth of a second.
3. The globe turns to the longitude at the window's end, over about a third of a second, taking the short way round.
4. When the window covers a logged clock change, the strip opens at that point over about a third of a second: a gap labelled for a retard, a crease labelled for an advance, using the labels in Feedback states. Moving away closes it again step by step. Outside the window, a clock change shows as a thin tick. Below every state, the frame's elapsed span stays exact.
5. In a breaching window the frame turns hatched magenta and shows the word from Feedback states over about a fifth of a second. It reverts in the same time when the window stops breaching.

**The globe** is a small chart globe drawn procedurally on a canvas in the browser, with graticule, buff land shapes, a track through the position fixes and a mark at the current position. It needs no WebGL. It is still whenever the window is still: it never turns on its own, and it has no idle motion. Only moving the window moves it, whether by drag, keyboard or width change, with or without reduced motion. The current position is always also printed as text next to it, so nothing is lost if the canvas cannot draw.

No decorative or looping animation exists anywhere, and nothing moves without a cause from the user or from new data. The only exception is a plain text change in a status region.

**With reduced motion on:** folds and creases are drawn static at full size, numerals change instantly, the globe jumps to position in one drawn frame, and the breach frame appears at once. Values, labels, verdicts, data attributes and slider keys stay the same.

### Feedback states (DP-09, DP-11, DP-13, DP-14, DP-24, DP-29, DP-30, DP-32, DP-33, DP-37, DP-38, DP-42)

Every string in backticks renders character for character, with straight apostrophes and hyphens. `<...>` is a placeholder, and its source is stated here or in API.

**Banners**

| Region | When | Copy |
|---|---|---|
| `status "Connection"` | Any time the browser is offline, or a write has failed for lack of a connection, removed once the queue is sent | `Logging on board. Entries will sync when the ship reconnects.` followed by `<n> queued`, where `<n>` is the live count of queued entries |
| `status "Archive status"` | While `GET /api/archive-status` says unreachable, updated within 15 seconds of a change and empty otherwise | `Archive unreachable. Hours are still being logged; sealing resumes on its own.` |

**Hour Fold and verdicts**

| Item | Copy |
|---|---|
| Word on a breaching frame | `Breach` |
| Fold label, retard by `<n>` hours | `+<n> h` (for example `+1 h`, `+0.5 h`) |
| Fold label, advance by `<n>` hours | `-<n> h` (for example `-1 h`, `-0.5 h`) |
| `status "Window verdict"`, pass | `<start ship time> to <end ship time>: <rest> hours of rest. This window passes the rules.` |
| `status "Window verdict"`, breach | `<start ship time> to <end ship time>: <rest> hours of rest. Breach recorded. It stays on this record.` |
| `status "Window verdict"`, incomplete | `<start ship time> to <end ship time>: <rest> hours of rest. This window is not fully logged yet.` |
| Record pane, rule set line | `Judged under the standard rules.` or `Judged under the flag exception rules.` |

The window verdict region announces once the step has been still for about half a second. Everywhere on screen, including the Rolling totals region and the window's visible text, `<rest>` is a number of hours with one decimal place, for example `16.0` or `9.5`.

The record pane lists one sentence per failed rule in the window:

| Rule | Copy |
|---|---|
| `rest_24h` | `Less than 10 hours of rest in this 24-hour window.` |
| `rest_periods` | `Rest was split into more than <limit> periods in this 24-hour window.` where `<limit>` is 2 or 3 under the rule set in force |
| `six_hour_block` | `No rest period of at least 6 hours touches this 24-hour window.` |
| `fourteen_hour_gap` | `More than 14 hours passed between rest periods in this 24-hour window.` |
| `rest_168h` | `Less than <limit> hours of rest in this 168-hour window.` where `<limit>` is 77 or 70 under the rule set in force |
| `three_period_days` | `Three rest periods were used on more than two 24-hour periods in these 7 days.` |

The record pane's breach list shows one line per run of consecutive window starts for the same rule. A line whose breach no longer holds adds `Recorded breach. The hours were later changed.` With nothing to list it shows `No breaches recorded.`

**Notices and labels**

| Item | Copy |
|---|---|
| Record mismatch, to both people | `Record mismatch: a drill or call-out overlaps hours logged as rest. Add a note to explain it.` |
| Late entry badge | `Late entry` |
| Short break hint beside the grid, shown while the server's latest cells for the shown ship's day include a `Rest under one hour` cell and removed once they include none | `Breaks under one hour do not count as rest.` |
| Record pane line naming what it shows, where `<ship date>` is `YYYY-MM-DD` and `<month>` is `YYYY-MM` | `Ship's day <ship date>, in month <month>.` |
| Day status labels | `Open`, `Closed`, `Signed`, `Countersigned` |
| Open day line | `You can edit this ship's day until <closes at>.` where `<closes at>` is `closes_at_utc` shown in the vessel's ship's time |
| Closed day line | `This ship's day has closed.` |
| Month status labels | `Open`, `Awaiting archive`, `Sealed` |
| Zone warning after saving a clock change | `The new offset is more than 1 hour from the nautical zone for this longitude. Ships may keep port time, so the change is saved.` |
| Plan verdict | `This plan passes the rules.` or `This plan breaches the rules in <n> windows.` where `<n>` is the number of breaching planned windows |
| Sign dialog text | `By signing you confirm these are your hours for <ship date>.` |
| Globe without a fix | `No position logged yet.` |
| Inspector, nothing sealed | `Nothing is sealed in this date range.` |

Month status updates within 15 seconds of the server's state changing while the page is open.

**Async actions.** Pending, success and error copy appears in the named region. "Server text" means the message from the `errors` object beside the field, with the field's `textbox` marked invalid. Any network failure or 5xx on an owner-master action shows `Something went wrong. Try again.` in `status "Feedback"`.

| Action | Region | Pending | Success | Other results |
|---|---|---|---|---|
| Sign in or sign up | `status "Feedback"` | `Signing in.` | Moves to the role's page | `That email and passcode do not match.` for 401; `That email already has an account.` for email taken; server text for 422 |
| Save a cell | `status "Sync status"` | `Saving.` | `Saved.` | `Queued.` offline; `This ship's day has closed, so the server did not save that entry.` for a closed or sealed day, after which the page shows the server's status |
| Queue sent | `status "Sync status"` | `Syncing.` | `Synced <n> entries.`, then ` <m> marked Late entry.` when `<m>` is above zero | `<n>` and `<m>` are counts from the sync response |
| Sign | `status "Day status"` | `Signing.` | `Signed.` | `This ship's day is still open, so it cannot be signed yet.`; `Signing needs a connection.` offline |
| Countersign | `status "Day status"` | `Countersigning.` | `Countersigned.` | `The crew member has not signed this day yet.`; `Countersigning needs a connection.` offline |
| Add a note | `status "Feedback"` for the owner-master, `status "Day status"` for a crew member | `Saving note.` | `Note saved.` | `Write a note first.` for empty text; `Notes need a connection.` offline |
| Seal a month | `status "Month status"` | `Awaiting archive` | `Sealed` once confirmed | `Every logged day must be signed and countersigned first.` for 409 |
| Save a vessel | `status "Feedback"` | `Saving vessel.` | `Vessel saved.` | `You already run four vessels.` at the limit; server text for 422 |
| Save a crew member | `status "Feedback"` | `Saving crew member.` | `Crew member saved.` | `That email already has an account.`; server text for 422 |
| Save a clock change | `status "Feedback"` | `Saving clock change.` | `Clock change saved.` | `Pick a time that keeps the clock change inside one ship's day.` for a midnight crossing; server text for other 422s |
| Save a fix, watch or event | `status "Feedback"` | `Saving.` | `Saved.` | Server text for 422 |
| Check plan | `status "Plan verdict"` | `Checking plan.` | The plan verdict copy | Server text for 422 |
| Schedule rule set | `status "Feedback"` | `Scheduling rule set.` | `Rule set scheduled.` | `Pick a start time after now.`; `A flag exception cannot run longer than two weeks.`; `Another rule set is already in force for those dates.` |
| Create link | `status "Feedback"` | `Creating link.` | `Link created.` | Server text for 422 |
| Revoke link | `status "Feedback"` | `Revoking link.` | `Link revoked.` | `This link no longer opens.` if already ended |
| Replace link | `status "Feedback"` | `Replacing link.` | `Link replaced. The old link no longer opens.` | `This link no longer opens.` if already ended |
| Download a PDF while the archive is down | `status "Feedback"` for the owner-master and on the inspector page, `status "Day status"` for a crew member | | | `The archive is unreachable, so this document cannot be fetched right now.` |
| Download my copy while offline | `status "Feedback"` for the owner-master, `status "Day status"` for a crew member | | | `Downloading needs a connection.` |

**Whole-page messages** (each is a level 1 heading, and the page shows no record data):

| Case | Copy |
|---|---|
| Expired link | `This inspection link has expired.` |
| Revoked or replaced link | `This inspection link has been revoked.` |
| Unknown link | `We couldn't find that inspection link.` |
| Unknown page | `We couldn't find that page.` |

## Backend

### API (DP-01 to DP-03, DP-05, DP-06, DP-10, DP-11, DP-13, DP-14, DP-16, DP-17, DP-19 to DP-21, DP-28 to DP-31, DP-34, DP-36 to DP-38)

All bodies are JSON with content type `application/json`, and the limit is in Server boundary. Instants are UTC strings of the form `YYYY-MM-DDTHH:MM:SSZ`. Ship's dates are `YYYY-MM-DD`, months are `YYYY-MM`, offsets are minutes east of UTC, and hours are numbers in half-hour multiples. Ship-time strings are `YYYY-MM-DD HH:MM`. An instant called "aligned" has minutes 00 or 30 and seconds 00.

**Error shape.** Validation failures are `422 {"errors":{"<field>":"<message>"}}`. Every other failure is `<status> {"error":"<code>","message":"<sentence>"}`, and the tables below name only `<code>`.

**Error order, for the whole API.** Body too large or wrong content type (413 `payload_too_large`, 415 `unsupported_media_type`), then not signed in (401 `not_signed_in`), then unknown resource or one belonging to another owner-master (404 `not_found`), then forbidden for this role or person (403 `forbidden`, including a crew member calling any owner-master-only endpoint, except 403 `crew_only` on the watch-entry endpoints), then a stored replay's response when one exists, then state conflicts (409), then validation (422). A crew member reading another crew member's data gets 403. The inspection endpoints need no session and follow their own table.

**Sign-in and identity**

| Endpoint | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/owners` | `{"name","email","passcode"}`, passcode at least 8 characters | `201 {"id","name","email","role":"owner_master"}` and signed in | 409 `email_taken` |
| `POST /api/session` | `{"email","passcode"}` | `200 {"id","name","role","vessel_id"}`, `role` is `owner_master` or `crew`, `vessel_id` null for an owner-master, sets an HTTP-only session cookie | 401 `bad_credentials` |
| `DELETE /api/session` | | `204` | |
| `GET /api/me` | | `200 {"id","name","role","vessel_id","server_now_utc","today_ship_date"}`, `today_ship_date` null for an owner-master | |

**Vessels and crew** (owner-master only for writes)

| Endpoint | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/vessels` | | `200 {"vessels":[{"id","name","kind","current_offset_minutes"}]}` | |
| `POST /api/vessels` | `{"name","kind","initial_offset_minutes"}`, `kind` one of `workboat`, `survey_boat`, `coaster`, `charter_yacht` | `201` the vessel | 409 `vessel_limit` |
| `GET /api/vessels/{vessel_id}/crew` | | `200 {"crew":[{"id","name","rank","email"}]}` | |
| `POST /api/vessels/{vessel_id}/crew` | `{"name","rank","email","passcode"}` | `201` the crew member | 409 `email_taken` |

**Clock changes and fixes** (owner-master only for writes)

| Endpoint | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/vessels/{vessel_id}/clock-changes` | | `200 {"clock_changes":[...]}` | |
| `POST /api/vessels/{vessel_id}/clock-changes` | `{"changes_at_utc","new_offset_minutes","latitude","longitude"}` | `201 {"id","changes_at_utc","old_offset_minutes","new_offset_minutes","kind":"retard"\|"advance","label","ship_date","ship_date_cells","fix_id","nautical_zone","zone_warning"}` | 409 `month_sealed`; 422 per Business rules |
| `GET /api/vessels/{vessel_id}/fixes` | | `200 {"fixes":[{"id","at_utc","latitude","longitude"}]}` | |
| `POST /api/vessels/{vessel_id}/fixes` | `{"at_utc","latitude","longitude"}` | `201` the fix | 422 on a repeated instant |

**Rota and rule sets** (owner-master only)

| Endpoint | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/vessels/{vessel_id}/rota-watches` | `{"crew_id","label","start_time":"HH:MM","end_time":"HH:MM","from_date","to_date"}`, times on the half hour, dates inclusive | `201` the watch | 422 |
| `GET /api/vessels/{vessel_id}/rota?crew_id=&from=&to=` | range at most 28 ship's dates | `200 {"days":[{"ship_date","cell_count","day_hours","watches":[{"label","start_ship_time":"HH:MM","end_ship_time":"HH:MM","start_utc","end_utc","elapsed_hours"}],"planned_rest_hours"}],"plan":{"verdict":"pass"\|"breach","breaches":[{"rule","window_hours","window_start_utc","window_end_utc"}]}}` | 422 |
| `GET /api/vessels/{vessel_id}/rule-sets` | | `200 {"rule_sets":[{"id","rule_set","effective_from_utc","effective_until_utc","flag_reference"}]}`, flag exception periods only | |
| `POST /api/vessels/{vessel_id}/rule-sets` | `{"rule_set":"flag_exception","effective_from_utc","effective_until_utc","flag_reference"}` | `201` the period | 409 `rule_set_overlap`; 422 per Business rules |

**Watch entries** (crew only, otherwise 403 `crew_only`; the crew member is always the signed-in person, and any `crew_id` in the body is ignored)

| Endpoint | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/watch-entries` | `{"entry_key","start_utc","end_utc","kind":"rest"\|"work"}`, key 1 to 100 characters | `201 {"entry":{"id","entry_key","start_utc","end_utc","kind","ship_date","late":false,"applied":true,"received_at_utc"}}` | 409 `entry_key_conflict`, `day_closed`, `month_sealed`; 422 per Business rules |
| `POST /api/watch-entries/sync` | `{"entries":[...]}`, each as above, at most 500 | `200 {"results":[{"entry_key","outcome":"applied"\|"replayed"\|"late"\|"conflict"\|"rejected","entry","errors"}]}` in request order; `entry` is null for `conflict` and `rejected`, `errors` is null unless `rejected` | 422 when `entries` is missing or too long |

**Crew records.** Owner-master of the vessel or that crew member.

| Endpoint | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/crew/{crew_id}/days?from=&to=` | range at most 62 ship's dates | `200 {"server_now_utc","days":[{"ship_date","state","closes_at_utc","can_edit"}]}` | 422 |
| `GET /api/crew/{crew_id}/days/{ship_date}` | | `200 {"ship_date","state":"open"\|"closed"\|"signed"\|"countersigned","closes_at_utc","can_edit","server_now_utc","start_utc","end_utc","cell_count","cells":[{"start_utc","ship_time":"HH:MM","repeated","state":"not_logged"\|"rest"\|"work"\|"short_break","late"}],"rest_hours","entries":[...],"notes":[...],"events":[{"id","kind","start_utc","end_utc","description","mismatch"}],"signed_at_utc","countersigned_at_utc"}` | 422 |
| `GET /api/crew/{crew_id}/rolling?as_of=` | `as_of` aligned, default the server's time rounded down to the half hour | `200 {"as_of_utc","rest_hours_24","rest_hours_168","verdict_24","verdict_168"}` | 422 |
| `GET /api/crew/{crew_id}/strip?start=` | `start` aligned; without it, the end of the crew member's latest logged cell minus 336 elapsed hours, or with no cells the server's time rounded up to the half hour minus 336 elapsed hours | `200 {"start_utc","end_utc","cells":[...672, with "start_utc","ship_date","ship_time","state","late"],"clock_changes":[...],"fixes":[...],"windows":{"24":[...625],"168":[...337]}}`, each window as below plus `"step"` | 422 |
| `GET /api/crew/{crew_id}/window?start=&hours=` | `start` aligned, `hours` 24 or 168 | `200 {"start_utc","end_utc","hours","start_ship_time","end_ship_time","rest_hours","verdict":"pass"\|"breach"\|"incomplete","rules_failed":[...],"rule_set":"standard"\|"flag_exception","longitude","latitude","fold_state","clock_face_hours","clock_change_labels":[...]}`, `longitude` and `latitude` rounded to two decimals, null with no fix | 422 |
| `GET /api/crew/{crew_id}/breaches?from=&to=` | optional UTC instants matched against window start | `200 {"breaches":[{"id","rule","window_hours","window_start_utc","window_end_utc","rule_set","rest_hours","recorded_at_utc","still_breaching"}]}` | |
| Any other method on `/api/crew/{crew_id}/breaches` or `/api/crew/{crew_id}/breaches/{id}` | | | 405 `breach_permanent` |
| `POST /api/crew/{crew_id}/days/{ship_date}/notes` | `{"text","event_id"}`, text 1 to 2,000 characters inclusive, `event_id` optional | `201 {"id","ship_date","text","event_id","author_role","created_at_utc"}` | 409 `month_sealed`; 422 |
| `POST /api/crew/{crew_id}/days/sign` | `{"ship_dates":[...]}`, that crew member only, all or none | `200 {"days":[{"ship_date","state"}]}` | 409 `day_not_closed`, `already_signed`, with `"ship_date"` added to the body |
| `POST /api/crew/{crew_id}/days/countersign` | `{"ship_dates":[...]}`, owner-master only, all or none | `200 {"days":[{"ship_date","state"}]}` | 409 `day_not_signed`, `already_countersigned`, with `"ship_date"` added to the body |
| `POST /api/vessels/{vessel_id}/events` | `{"crew_id","kind":"drill"\|"call_out","start_utc","end_utc","description"}`, owner-master only, instants aligned | `201 {"id","crew_id","kind","start_utc","end_utc","description","mismatch"}` | 409 `month_sealed`; 422 |

**Months**

| Endpoint | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/crew/{crew_id}/months/{month}` | | `200 {"month","state":"open"\|"awaiting_archive"\|"sealed","label","blocking_dates":[...],"record_key","record_sha256","copy_key","sealed_at_utc"}`, the last four null until sealed | |
| `POST /api/crew/{crew_id}/months/{month}/seal` | owner-master only, empty body | `202` the month object while awaiting; `200` the month object when already sealed | 409 `month_not_ready`, with `"blocking_dates"` added |
| `GET /api/crew/{crew_id}/months/{month}/record.pdf` | | `200` PDF from the archive | 409 `month_not_sealed`; 503 `archive_unreachable` |
| `GET /api/crew/{crew_id}/months/{month}/copy.pdf` | | `200` PDF from the archive | 409 `month_not_sealed`; 503 `archive_unreachable` |
| `GET /api/archive-status` | owner-master only | `200 {"archive":"reachable"\|"unreachable","checked_at_utc"}` | |

**Inspection links** (owner-master only)

| Endpoint | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/vessels/{vessel_id}/inspection-links` | | `200 {"links":[{"id","url","from_date","to_date","expires_at_utc","state":"active"\|"expired"\|"revoked"}]}` | |
| `POST /api/vessels/{vessel_id}/inspection-links` | `{"from_date","to_date","expires_at_utc"}` | `201` the link with `"vessel_id"`, `url` being `/inspect/<token>` | 422 when `expires_at_utc` is not after the server's time, or `to_date` is before `from_date` |
| `POST /api/inspection-links/{id}/revoke` | | `200` the link | 409 `link_ended` |
| `POST /api/inspection-links/{id}/regenerate` | | `201` a new active link with the same scope and expiry | 409 `link_ended` |

**Inspector endpoints** (no session; token checked first, in the order unknown, revoked, expired)

| Endpoint | Success | Errors |
|---|---|---|
| `GET /api/inspect/{token}?from=&to=` | `200 {"vessel":{"id","name"},"from_date","to_date","expires_at_utc","server_now_utc","crew":[{"id","name","rank","days":[{"ship_date","cell_count","cells","rest_hours","signed_at_utc","countersigned_at_utc","late_entries","notes"}],"breaches":[...]}],"unsealed_dates":[...],"clock_changes":[...],"fixes":[...],"events":[...]}`, with `from` and `to` optional and defaulting to the link's range | 404 `not_found`; 410 `link_revoked`; 410 `link_expired`; 403 `outside_scope` when `from` or `to` is outside the link's range |
| `GET /api/inspect/{token}/document` | `200` PDF | The same, plus 503 `archive_unreachable` |
| Any non-GET under `/api/inspect/` | | 405 `read_only` |

All inspector responses are sent with no-store caching.

### Business rules (DP-02, DP-03, DP-05, DP-06, DP-10, DP-11, DP-13, DP-14, DP-16 to DP-23, DP-28 to DP-32, DP-34, DP-36 to DP-38)

**Limits.** An owner-master runs at most four vessels, and a fifth is refused. A crew member belongs to one vessel.

**Ship's time and ship's days.**
- A vessel keeps a timeline of offsets, starting from its initial offset and changing at each logged clock change. The ship's date of an instant is the date of that instant plus the offset in force at it.
- A ship's day runs from midnight to midnight at the logged offset.
- A ship's date's cell count is 48 half hours, plus or minus the change: a one-hour retard gives 50 cells, a one-hour advance 46, a half-hour retard 49, and a half-hour advance 47.
- A retard lowers the offset and lengthens the day. An advance raises the offset and shortens the day. The times repeated by a retard appear twice in the grid.

**Clock changes.** A clock change is accepted only when all of these hold, otherwise 422 with the error under `changes_at_utc`, or `new_offset_minutes` for the offset rules:
- `changes_at_utc` is aligned.
- The new offset is a multiple of 30 minutes, from -720 to 840 inclusive, and differs from the old one.
- It is later than the vessel's latest clock change.
- It is on a ship's date with no other clock change.
- The clock's reading just before and just after the change fall on the same ship's date.

A clock change in a sealed month for any crew member of the vessel is 409. Each one also stores a position fix at that instant.

`nautical_zone` is the fix's longitude divided by 15, rounded to the nearest whole number with halves going away from zero. `zone_warning` is true when the new offset differs from that zone by strictly more than 1 hour. The change is always saved.

**Watch entries.**
- An entry's instants are aligned and `end_utc` is after `start_utc`.
- It lies entirely inside one ship's day.
- It ends no more than 48 elapsed hours after the server's time, inclusive. Each failure is 422.
- A later entry replaces earlier ones cell by cell, in the order the server applied them. Replaced entries stay stored.
- Entries are never deleted.
- A cell with no entry is `not_logged`.

**Replay.** `entry_key` is unique per crew member.
- Sending a stored key with the same `start_utc`, `end_utc` and `kind` is a replay: it changes nothing and gets the replay answer below.
- A stored key with any different value is 409 `entry_key_conflict` on the direct endpoint and outcome `conflict` on the sync endpoint, decided before the day's state.
- A replay on `POST /api/watch-entries` answers `201 {"entry":<stored entry>}`, whichever endpoint first stored the key, with the stored `late` and `applied` values, even if the day has closed since.
- A replay on `POST /api/watch-entries/sync` gets outcome `replayed`, with `entry` as the stored entry and `errors` null, whichever endpoint first stored the key.
- A direct write refused with `day_closed`, `month_sealed` or 422, or a synced entry with outcome `rejected`, stores nothing and leaves its key unused.
- If several requests with one key arrive together, exactly one entry is stored and each request gets its endpoint's answer for that entry.

**Direct and synced writes.**
- `POST /api/watch-entries` on a closed, signed or countersigned day is 409 `day_closed`, and in a sealed month 409 `month_sealed`.
- `POST /api/watch-entries/sync` takes entries held on the phone and treats each one independently, in order.
- On an open day it applies the entry, with outcome `applied`.
- On a closed, unsigned day in an unsealed month it applies the entry with `late:true`, with outcome `late`.
- On a signed or countersigned day, or in a sealed month, it stores the entry with `late:true` and `applied:false`, with outcome `late`, and the hours do not change. The entry is listed on the day as a Late entry.
- A late cell reports `late:true`.
- Entries are never backdated: `received_at_utc` is always the server's receipt time.

**Ship's day state.** A day is `open` until the server's time reaches its end plus `DAY_CLOSE_SECONDS` (default 172,800 seconds, which is 48 elapsed hours). At exactly that instant and later it is `closed`. `closes_at_utc` is that instant, and `can_edit` is true only while open. Only the server's clock is used.

| From | To | By | Otherwise |
|---|---|---|---|
| open | closed | server time | |
| closed | signed | that crew member | Open: 409 `day_not_closed`; already signed or countersigned: 409 `already_signed`; anyone else: 403 |
| signed | countersigned | owner-master | Open or closed: 409 `day_not_signed`; already countersigned: 409 `already_countersigned`; a crew member: 403 |

If two countersign or sign requests race, exactly one succeeds and the other gets the matching 409.

**Rest cells and periods.** A rest period is a maximal unbroken run of rest cells on the crew member's whole elapsed timeline. A run shorter than one hour is `short_break`: it is not rest in any total or rule. A run of exactly one hour counts.

**Windows.** A window is `[start, start + 24 or 168 elapsed hours)`, always judged on UTC instants, regardless of clock changes.
- `rest_hours` is the rest inside the window, clipping any period at the window's edges.
- `verdict` is `incomplete` when any cell in the window is not logged, `breach` when it is fully logged and any rule fails, and `pass` otherwise.
- `rules_failed` lists the failed rules of a fully logged window and is empty for an incomplete one.
- Limits are inclusive: exactly the minimum passes.

**Rule sets.** The rule set judging a window is the one in force at the window's end instant. A flag exception period is in force from `effective_from_utc` inclusive to `effective_until_utc` exclusive, and the standard rules apply at all other times.

| Rule | Window | Standard | Flag exception |
|---|---|---|---|
| `rest_24h` | 24 h | At least 10 hours of rest | Same |
| `rest_periods` | 24 h | At most 2 rest periods begin inside the window | At most 3 |
| `six_hour_block` | 24 h | A rest period of at least 6 hours, measured whole even past the window's edge, overlaps the window | Same |
| `fourteen_hour_gap` | 24 h | No unbroken run of more than 14 hours of non-rest cells inside the window | Same |
| `rest_168h` | 168 h | At least 77 hours of rest | At least 70 hours |
| `three_period_days` | 24 h | Does not apply | See below |

`three_period_days`: when exactly 3 rest periods begin inside a 24-hour window, split the 168 hours ending at that window's end into seven consecutive 24-hour blocks counted back from the end. The rule fails when more than two blocks have exactly 3 rest periods beginning inside them.

Scheduling a flag exception needs aligned instants and all of the following:
- `effective_from_utc` is strictly after the server's time, otherwise 422.
- `effective_until_utc` is after it and no more than 336 elapsed hours later, inclusive, otherwise 422.
- `flag_reference` has 1 to 200 characters inclusive, otherwise 422.
- It does not overlap another period on the vessel, otherwise 409 `rule_set_overlap`.

There is no way to change or remove a period. A window ending before a period's start keeps its verdict on the strip, window, rolling, breach list, inspector page and PDFs.

**Breaches.** Whenever a write or the first computation makes a fully logged window fail a rule, the server records one breach per crew member, window width, window start and rule, storing the rule set and rest hours at that moment. A breach recorded once is never removed or changed. `still_breaching` reports whether that window currently fails that rule. Breach records never block saving, signing or sealing.

**Hours and notes.**
- Only the signed-in crew member writes their own hours. An owner-master posting an entry gets 403 `crew_only`.
- An owner-master's note on a day is dated by the server, shown beside the hours, and changes no hours.
- A crew member may also add notes to their own days.

**Record mismatch.** An event whose interval overlaps any cell the crew member logged as rest or short break has `mismatch:true`, unless a note with that `event_id` exists from either person. This is checked at read time, so a later entry can start a mismatch. A note without `event_id` does not clear it. An `event_id` unknown for that crew member or ship's date is 422. Events never change hours or verdicts.

**Position.** `longitude` and `latitude` at an instant come from great-circle interpolation between the fixes either side, by the share of elapsed time passed. An instant at a fix gives that fix, before the first fix gives the first, and after the last gives the last. Longitude runs from -180 to 180, with east positive.

**Clock-face span and fold.** A clock change is covered when `start < changes_at < end`, strictly.
- `start_ship_time` reads the clock at the start.
- `end_ship_time` reads the clock as it stood immediately before the end.
- `clock_face_hours` is the window's elapsed hours plus the end offset minus the start offset, in hours, both offsets read the same way. A window across a one-hour retard therefore covers 23 clock-face hours, and across a one-hour advance 25, while its elapsed span stays exactly 24.
- `fold_state` is `gap` when only retards are covered, `crease` when only advances, `gap_and_crease` for both and `flat` for none.
- `clock_change_labels` holds the fold labels from Feedback states, in time order.

**Steps.** The strip is 336 elapsed hours. Step `s` starts at the strip start plus `s` half hours: `s` from 0 to 624 for 24 hours and 0 to 336 for 168 hours.

**Rota.** Watches keep their ship's-time hours on every date from `from_date` to `to_date`. An `end_time` at or before `start_time` runs past midnight into the next ship's date.
- A start or end time that a retard makes occur twice takes the first occurrence for a start and the last occurrence for an end.
- A time an advance skips moves to the first instant after the jump.
- `elapsed_hours` is the true elapsed time.
- `planned_rest_hours` is the day's length minus the elapsed time watches take in that day, with overlapping watches counted once.
- The plan treats everything outside watches as rest, and judges every window lying wholly inside the requested range under the rule set in force at the window's end, using logged and future clock changes alike.

**Month state.**
- A month belongs to a crew member and holds their ship's dates in that `YYYY-MM`.
- Sealing is allowed only when the month has at least one logged cell, the last ship's date in it has closed, and every ship's date with a logged cell is countersigned. Otherwise 409 `month_not_ready`, with those not yet countersigned as `blocking_dates`.
- `open` goes to `awaiting_archive` on a seal request, and `awaiting_archive` goes to `sealed` only as stated in Services. There is no other edge.
- Repeating a seal returns the current state and starts nothing new. Concurrent requests give one sealing run.
- In a sealed month, cells, signatures and notes are immutable, and day writes get 409 `month_sealed`, except synced entries as stated above.

**Inspection links.**
- A link is `active` while the server's time is strictly before `expires_at_utc`. At that exact instant and after, it is `expired`. Browser clocks play no part.
- Revoking and regenerating are `active` to `revoked`, with the old token dead. Doing either to an expired or revoked link is 409 `link_ended`.
- A link shows only its own vessel. Days appear only if they are within the link's dates and in a sealed month for that crew member. Other dates in range appear only in `unsealed_dates`. Clock changes, fixes and events are limited to the range.
- A link's document holds the same content as its JSON.
- A link never authenticates anything else.

### Services (DP-32, DP-33, DP-34, DP-36)

**Postgres** stores vessels, crew, rotas, clock changes, position fixes, rule-set periods, watch entries, notes, breaches, signatures, month states and inspection links. Verdicts are derived from these rows. Apply the schema and seed data at every start, without error if they already exist and without overwriting changed rows.

**MinIO** holds private objects in the bucket `S3_BUCKET`:

| Object | Key |
|---|---|
| Record PDF | `records/<vessel id>/<crew id>/<YYYY-MM>/record.pdf` |
| Seafarer's copy | `records/<vessel id>/<crew id>/<YYYY-MM>/seafarer-copy.pdf` |
| Inspector's document | `inspections/<link id>/document.pdf` |

Each object is a valid PDF, and is never exposed to the browser except through the app's own endpoints. Record and copy PDFs name the crew member, vessel and month, and list each ship's date with its rest hours, every recorded breach, every note, every Late entry and both signature times.

**Sealing.** The server writes the record PDF and the seafarer's copy, then reads the record back from the store and compares its SHA-256 with the digest computed before upload. Only then does the month become `sealed` with `record_sha256` set to that hex digest. On any failure or mismatch the month stays `awaiting_archive` and the server tries again.

**When MinIO is down, whether at boot or later:**
- The app starts and answers health normally. Logging, signing and all reads from Postgres keep working.
- `GET /api/archive-status` reports unreachable. The server checks at least every 10 seconds, and the archive banner shows.
- A seal request returns 202 with `awaiting_archive`, and the month keeps reading Awaiting archive for as long as that instance's archive stays unreachable.
- PDF downloads return 503 with the document message from Feedback states shown.
- The inspector's JSON keeps working, and only the document fails.

**When MinIO returns,** meaning the address in `S3_ENDPOINT` answers again, with no restart, every month in `awaiting_archive` is retried at least every 10 seconds and reaches `sealed` within 30 seconds, and the banner clears within 15 seconds. Every check and retry opens a fresh connection to that address.

### Seed data (DP-05, DP-14, DP-18, DP-20 to DP-23, DP-30)

Every seeded person and business is invented. Present at start:

| ID | Role | Name | Email | Passcode | Details |
|---|---|---|---|---|---|
| `owner-ailsa` | owner-master | Ailsa Tregenna | `ailsa@tidewrack.example` | `fathom-ailsa-2741` | Runs `vessel-surveyor`, `vessel-kittiwake` |
| `owner-bram` | owner-master | Bram Okafor | `bram@skerry.example` | `fathom-bram-8830` | Runs `vessel-skerry-lass` |
| `crew-ines` | crew | Ines Duarte | `ines@tidewrack.example` | `watch-ines-1192` | Mate, `vessel-surveyor` |
| `crew-tomas` | crew | Tomas Berg | `tomas@tidewrack.example` | `watch-tomas-3365` | Engineer, `vessel-surveyor` |
| `crew-petra` | crew | Petra Vance | `petra@tidewrack.example` | `watch-petra-5507` | Deckhand, `vessel-surveyor` |
| `crew-jonah` | crew | Jonah Reyes | `jonah@tidewrack.example` | `watch-jonah-7741` | Deckhand, `vessel-kittiwake`, no entries |
| `crew-noor` | crew | Noor Haddad | `noor@skerry.example` | `watch-noor-9014` | Mate, `vessel-skerry-lass`, no entries |

Vessels: `vessel-surveyor` "Tidewrack Surveyor" (`survey_boat`, initial offset 0), `vessel-kittiwake` "Kittiwake" (`workboat`, initial offset 60), `vessel-skerry-lass` "Skerry Lass" (`coaster`, initial offset 0).

**Clock changes on `vessel-surveyor`:**
- A retard at `2026-09-10T02:00:00Z`, offset 0 to -60, so 2026-09-10 has 50 cells.
- An advance at `2026-09-16T03:00:00Z`, offset -60 to 0, so 2026-09-16 has 46 cells.

**Position fixes on `vessel-surveyor`:**

| At | Latitude | Longitude |
|---|---|---|
| `2026-09-07T00:00:00Z` | 50.10 | -5.00 |
| `2026-09-10T02:00:00Z` | 49.00 | -12.00 |
| `2026-09-13T12:00:00Z` | 47.00 | -16.00 |
| `2026-09-16T03:00:00Z` | 48.00 | -8.00 |
| `2026-09-21T00:00:00Z` | 50.10 | -5.00 |

**Rule set on `vessel-surveyor`:** a flag exception from `2026-09-16T00:00:00Z` until `2026-09-22T00:00:00Z`, flag reference `Flag dispensation 2026-117`.

**Rota on `vessel-surveyor`:** for `crew-ines`, `Morning watch`, `00:00` to `04:00`, from 2026-09-07 to 2026-09-20.

**Logged hours,** from `2026-09-07T00:00:00Z` to `2026-09-21T00:00:00Z`, all in UTC, each crew member's cells fully logged, with no late cells:

| Crew | Daily pattern in UTC | Exception |
|---|---|---|
| `crew-ines` | Work 00:00-04:00, rest 04:00-12:00, work 12:00-16:00, rest 16:00-24:00 | On 2026-09-12 UTC: work 00:00-20:00, rest 20:00-24:00 |
| `crew-tomas` | Work 00:00-06:30, rest 06:30-12:00, work 12:00-18:30, rest 18:30-24:00 | None |
| `crew-petra` | Work 00:00-14:00, rest 14:00-24:00 | None |

**Signatures.** All of ship's dates 2026-09-07 to 2026-09-20 are past closing.
- `crew-tomas`: every day countersigned, and month 2026-09 is `open` and ready to seal.
- `crew-ines`: 2026-09-07 to 2026-09-19 countersigned, and 2026-09-20 closed and unsigned.
- `crew-petra`: every day closed and unsigned.

**Event:** a `call_out` for `crew-ines`, `2026-09-08T05:00:00Z` to `2026-09-08T06:00:00Z`, description `Anchor watch call-out`, with no note on it, so it shows Record mismatch.

**Note:** from `owner-ailsa` on `crew-ines`, ship's date 2026-09-11, event-free, text `Deck log shows the survey line finished at 18:00.`

For example, with the seed data at start, for a strip with `start=2026-09-07T00:00:00Z`:

| Crew | Width, step | Start and end UTC | Rest | Verdict | Other values |
|---|---|---|---|---|---|
| `crew-ines` | 24, 0 | `2026-09-07T00:00:00Z` to `2026-09-08T00:00:00Z` | 16 | `pass` | `flat`, 24 clock-face hours |
| `crew-ines` | 24, 240 | `2026-09-12T00:00:00Z` to `2026-09-13T00:00:00Z` | 4 | `breach` | fails `rest_24h`, `six_hour_block`, `fourteen_hour_gap` |
| `crew-ines` | 24, 100 | `2026-09-09T02:00:00Z` to `2026-09-10T02:00:00Z` | 16 | `pass` | `flat`, longitude -12.00 |
| `crew-ines` | 24, 120 | `2026-09-09T12:00:00Z` to `2026-09-10T12:00:00Z` | 16 | `pass` | `gap`, 23 clock-face hours, ship times `2026-09-09 12:00` to `2026-09-10 11:00`, label `+1 h` |
| `crew-ines` | 24, 420 | `2026-09-15T18:00:00Z` to `2026-09-16T18:00:00Z` | 16 | `pass` | `crease`, 25 clock-face hours, ship times `2026-09-15 17:00` to `2026-09-16 18:00`, label `-1 h` |
| `crew-tomas` | 24, 0 | `2026-09-07T00:00:00Z` to `2026-09-08T00:00:00Z` | 11 | `breach` | fails only `six_hour_block` |
| `crew-tomas` | 168, 0 | `2026-09-07T00:00:00Z` to `2026-09-14T00:00:00Z` | 77 | `pass` | exact limit |
| `crew-petra` | 24, 0 | `2026-09-07T00:00:00Z` to `2026-09-08T00:00:00Z` | 10 | `pass` | exact limit |
| `crew-petra` | 168, 95 | `2026-09-08T23:30:00Z` to `2026-09-15T23:30:00Z` | 70 | `breach` | `standard`, fails `rest_168h` |
| `crew-petra` | 168, 96 | `2026-09-09T00:00:00Z` to `2026-09-16T00:00:00Z` | 70 | `pass` | `flag_exception` |

For the `crew-ines` rota in the same seed:

| Ship's date | Cells | Watch elapsed hours | Planned rest hours |
|---|---|---|---|
| 2026-09-09 | 48 | 4 | 20 |
| 2026-09-10 | 50 | 5 | 20 |
| 2026-09-16 | 46 | 3 | 20 |

## Technical requirements

### Deployment (DP-44)

TypeScript on Node.js, with npm available. Put a run manifest at `/app/run.json` with string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

Bind `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` returns HTTP 200 JSON `{"status":"ok"}`.

### Configuration and secrets (DP-45)

Read at start from the environment, never hard-coded or sent to the browser:

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Object store |
| `DAY_CLOSE_SECONDS` | Optional; default in Business rules |

Several instances can run side by side from one build, each on its own `APP_PUBLIC_PORT` with its own values for these variables, including its own database, archive address and bucket. The environment always provides the database named in `DATABASE_URL` and the bucket named in `S3_BUCKET`, both created before the app starts and possibly empty. The app never creates a database or a bucket; it applies its schema and seed data to the database it is given.

### Server boundary (DP-44)

- A state-changing request carrying an `Origin` header that does not match its `Host` gets `403 {"error":"cross_origin","message":"<sentence>"}`.
- No CORS headers are sent.
- A request body over 1,000,000 bytes gets 413, and exactly 1,000,000 bytes is allowed.
- A JSON endpoint given another content type gets 415.
- The server never serves source files, `.env` files, the run manifest, package manifests or any credential, and these paths return 404.
- Session cookies are HTTP-only and same-site.
- Passcodes are stored only as salted hashes and are never returned.
- Unknown `/api/` paths return `404 {"error":"not_found","message":"<sentence>"}`.
- An unreachable object store at boot never stops the server, and the behaviour in Services applies.

### Browser support and performance (DP-40)

Support current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, including touch input on the phone size. Every page is usable within three seconds on a local connection. The voyage review shows its strip within one second of its data arriving, and the frame keeps up with a dragging pointer because no network request happens during a drag.

## Working rules

- **IF-01** Keep `/app/run.json` in the format Deployment states, and start the product only through it.
- **IF-02** Write all application source in TypeScript.
- **IF-03** Add `THIRD_PARTY_NOTICES.md` at the repository root, listing every shipped package and bundled font with its licence; shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- **IF-04** Use only shipped packages and fonts under MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC or SIL OFL-1.1 licences.
- **IF-05** Use only Postgres and the object store for storage on the server: no SQLite, Redis, or files on disk as a datastore.
- **IF-06** Leave the provided service configuration untouched, and never commit a credential value to the source.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript, with no `any` except at a parsing boundary that immediately validates it.
- Names in code use this brief's domain terms: ship's day, watch entry, clock change, position fix, rule set, window, breach, seal, inspection link.
- Each domain rule, such as a rest rule, a ship's date derivation, a day closure, a state change or a link's state, is decided in exactly one place in the source, and all callers use it.
- There is no abstraction with a single implementation and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the code has already ruled out.
- Every API failure uses the one error shape in API.
- The browser code contains no rest-rule, closure or expiry calculation; it renders server values.
- There are no features beyond this brief.
