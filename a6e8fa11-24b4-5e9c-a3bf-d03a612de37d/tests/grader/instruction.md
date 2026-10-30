# Tilth & Tally Furrowbook

Furrowbook is an offline-first spreadsheet workbook for crop field-trial networks. It serves university extension farms and seed-company research stations. Their field technicians record plot measurements on tablets in fields with no signal. Trial leads build formula-driven analysis sheets. Data managers keep the season's results safe and send them to sponsors. Each station gets a shared workbook list. Technicians type into a familiar grid while offline. Every edit is queued on the device, and when signal returns it syncs to a single ordered record of edits on the server. Any clash appears as a named conflict and is never dropped silently. The server works out every computed value. The product uses three backend services: PostgreSQL is the system of record, MinIO-compatible object storage holds import originals, export files and version snapshots, and an SMTP mail sink handles invites, export notices and season-close notices. Out of scope: self sign-up, single sign-on, payments, per-workbook access lists, real-time cursors or chat, macros, pivot tables, conditional formatting, images, comments, and any datastore beyond the three services named here. People get accounts only through a data manager's invite or through the seed data.

## Problem and users

Plant-breeding and extension stations run replicated variety and fertiliser trials, typically as randomised complete blocks. A small number of entries (varieties or rates, including a standard "check" variety) is repeated across several replicates, and each plot has its own number. At harvest a technician records each plot's grain yield and harvest moisture. The trial lead then adjusts yield to the crop's standard moisture (13% for soybean), averages each entry across replicates, and reports each entry's difference from the check. Most stations still carry Excel files on tablets. Purpose-built trial apps are expensive, lock data into fixed forms, and cannot hold the cross-sheet formulas agronomists depend on. When crews come back into range, co-authoring fails with an "upload failed" message or forces a choice between "my version" and "the server version". Days of plot readings get lost or overwritten. Two technicians silently overwrite the same cell. Re-sent uploads double rows. Formulas give different answers on the tablet copy and the office copy. Stations pay for this with repeat field visits and with data managers hand-merging "(conflict)" copies before sponsor reports. Sometimes they lose readings for good, because the crop has already been harvested.

Users:

- **Field technician** (daily): types plot readings and simple formulas, such as days after planting, into the season workbook on a tablet with no signal. Every edit must sync back exactly once, and any conflict must be shown, not dropped.
- **Trial lead** (weekly): builds the analysis sheets (cross-sheet entry means, deltas against the check, adjusted yields, charts from ranges), imports last season's xlsx, and closes the season on schedule.
- **Station data manager** (weekly): manages station members and roles, restores a workbook version after a bad edit, and exports clean xlsx and csv files for sponsors.
- **Sponsor reviewer** (occasional): opens a read-only link that expires and sees computed values and charts without an account.

## Journeys

1. **Start the season's workbook.** Start state: Tomás Herrera (trial lead, Ridgeback Research Station) is signed out. Tomás signs in, types "Soy" in the workbook search, and sees only Ridgeback's soybean workbook. Tomás clears the search, chooses Create workbook, names it, and taps Create twice on a slow connection. End state: Tomás is in the new draft workbook's grid. Back on the list, the new workbook appears exactly once.
2. **Bring last season forward.** Start state: Tomás is on the workbook list and opens Import workbook, which shows the published file limits, then picks last season's .xlsx. End state: Tomás is in a new draft workbook whose sheet tabs, values, formulas and bold headers match the file. A renamed photo, an archive bomb or an oversized sheet would instead have been refused with the matching limit message, and no workbook would have been created.
3. **Record readings at the field edge.** Start state: Dana Okafor (technician) has the in-season soybean workbook open, and then the tablet loses signal. The sync strip shows offline. Dana types three plot yields and a days-after-planting formula. Each cell shows its value at once with a pending marker. Dana reloads the tab, and the pending edits are still there. Signal returns and flickers, so the tablet sends the same batch several times. End state: the strip reads all synced, the pending markers are gone, and each edit appears once in the server's edit record.
4. **Two technicians, one plot cell.** Start state: Dana and Lee Vance both have the soybean workbook open, both go offline, and both type a different yield into the same plot cell. Dana reconnects first. End state: when Lee reconnects, Dana's value stays in the cell. Lee sees a notice and a numbered Conflicts button, and opens the conflict tray using only the keyboard. The tray names the cell and shows Lee's value and Dana's. Lee presses Re-apply mine, Lee's value becomes current, and the tray is empty.
5. **Fix a typo and watch it travel.** Start state: Tomás is on the Plots sheet with the Analysis sheet closed, and corrects a mistyped yield for a check plot. End state: the plot's adjusted yield lights up first. Then all three entry means on the Analysis sheet, then the three deltas against the check. Each number counts to its new value. The Analysis tab badge rises to its final count, the bar chart's bars move, and a summary is announced and listed under Changed cells.
6. **Close the season on schedule.** Start state: the soybean workbook is in season. Tomás sets a cutoff a short time ahead in the station's time zone. Dana, offline, keeps recording past the cutoff. End state: the workbook shows Locked, and every trial lead gets the season-close email. When Dana reconnects, the late edit is visibly rolled back with the season-closed reason and kept in Dana's tray. Tomás reopens the season with a later cutoff. Dana re-applies the value from the tray.
7. **Undo a bad bulk paste.** Start state: Priya Raman (data manager) finds that a bulk paste overwrote a column of plot yields, opens Versions, and restores the version saved before the paste. End state: every cell, formula, format and chart matches the saved version. The restore is listed as a new version, and the notice offers Undo restore, which returns the workbook to how it was just before the restore.
8. **Hand results to the sponsor.** Start state: Priya has the soybean workbook open, exports the Plots sheet to csv and the whole workbook to xlsx, gets an email for each when it is ready, and downloads both. One technician's note that began with "=" stays plain text in the csv. Priya creates a 7-day read-only share link for the sponsor reviewer. End state: the sponsor opens the link without an account and sees the computed values and the bar chart, but no editing controls. After Priya revokes the link, opening it shows the expired-or-turned-off page.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign in with station accounts** Members sign in with email and password and get a session for their one station, and every other API call without a session answers 401, as defined in API.
- **DP-02 — Station-scoped workbook list and search** The workbook list and its name search show only the signed-in member's station's workbooks, with the search text bounded as stated in API.
- **DP-03 — Other stations' workbooks stay not found** Every workbook-scoped request, page, export, version, conflict and share-link id that belongs to another station answers exactly like an id that does not exist.
- **DP-04 — One workbook per create request** Creating or importing a workbook carries a request key, so a repeated or doubled request returns the first response and the list gains exactly one workbook.
- **DP-05 — Workbook list journey** A trial lead signs in, searches the list, creates a workbook with one tap or a double tap and lands in its grid, and the list then shows it once.
- **DP-06 — Import xlsx and csv** A trial lead imports an .xlsx or .csv file and gets a draft workbook whose sheets, values, formulas, dates and bold match the file as mapped in Business rules.
- **DP-07 — Reject unsafe import files before parsing** Files that are too large, not really xlsx or csv, archive bombs, unsafe archive paths, too many sheets or too many cells are rejected with the published limit before any workbook exists.
- **DP-08 — Import is all or nothing** An import stores the original file in object storage and creates the workbook together, or leaves neither the file nor any workbook record behind.
- **DP-09 — Import journey** A trial lead opens Import workbook, sees the published limits, imports last season's file, and lands in the new draft workbook with its sheets as tabs.
- **DP-10 — Op batch sync** Devices send edits as ordered op batches against a base sequence and get a per-op result of applied, conflict or rejected, with the dependency closure of each applied cell edit.
- **DP-11 — Each batch applies exactly once** Resending a batch with the same key returns the identical acknowledgement without new sequence numbers, and reusing a key with a different batch answers 409.
- **DP-12 — Offline edits show at once as pending** Edits made with no connection appear in the grid at once with a pending marker, survive a reload, and sync on their own when the connection returns.
- **DP-13 — Rejected edits roll back with a reason** When the server rejects an edit, the grid shows the server state again and the reason is announced, and rejected cell edits are kept in the author's conflict tray as qualified in Business rules.
- **DP-14 — Keyboard grid editing** Members move through the grid, edit, commit, cancel and clear cells, and switch sheets using only the keyboard, with a visible focus ring.
- **DP-15 — Field entry journey** A field technician loses signal, records plot readings and a days-after-planting formula, reloads the tab, regains signal, and sees every edit synced once.
- **DP-16 — Server sequence decides cell conflicts** When two members edit the same cell from the same base, the edit the server sequences first stays and the other becomes a named conflict for its author, never silently dropped.
- **DP-17 — Conflict tray** Each member's conflict tray lists their own open conflicts and rejected edits by cell name and lets them re-apply their value or keep the current one.
- **DP-18 — Conflict journey** Two technicians edit the same plot cell offline and reconnect, and the losing technician re-applies their value from the conflict tray using only the keyboard.
- **DP-19 — Formula language** Formulas support the operators, functions, references, value types and error values listed in Business rules, evaluated the same way on the server and in the browser.
- **DP-20 — Cross-sheet dependency closure** Every cell edit reports exactly the transitive dependents of the edited cell across all sheets, each with its dependency depth.
- **DP-21 — Cycle and size budgets** Circular references show #CYCLE and formulas over the published node, cell or depth budget show #LIMIT, while sync, reads and the browser tab stay within the published time limits.
- **DP-22 — TODAY and NOW in station time** TODAY() and NOW() use the station's configured time zone on the server and in the browser, whatever the tablet's or the server's own zone.
- **DP-23 — Server-derived values** The server derives every value from its stored edit sequence, ignores values sent by clients, and a reopened workbook shows the same values the editing client showed.
- **DP-24 — Recalc furrow waves** After a committed edit, each dependent cell gets an accent outline and counts to its new value in waves by dependency depth, and bound chart bars move in the same wave, as timed in Motion and effects.
- **DP-25 — Sheet-tab change badges** Sheet tabs other than the current one show a count of their recalculated cells that rises as waves land and ends equal to the server-reported closure on that sheet.
- **DP-26 — Reduced-motion recalc** With reduced motion requested, dependents get a static outline, values swap at once, badges show final counts, and the Changed cells list opens in the rail.
- **DP-27 — Recalc journey** A trial lead corrects a mistyped plot yield and watches the plot's adjusted yield, the entry means, the deltas against the check and the chart update across both sheets.
- **DP-28 — Charts from ranges** Leads and data managers build bar and line charts from a sheet range, and chart series always show the server-derived values of that range.
- **DP-29 — Sheets and cell formats** Leads and data managers add and rename sheets, members who may edit cells set number formats and bold on ranges, and formulas keep pointing at renamed sheets.
- **DP-30 — Chart building journey** A trial lead adds a sheet, enters entry-mean formulas, formats them to two decimals and builds a bar chart from them.
- **DP-31 — Season state machine** A workbook moves from draft to in-season to locked to archived, with reopen from locked to in-season, and every other move answers 409.
- **DP-32 — Season cutoff in station time** A cutoff is a local date and time in the station's zone, edits received at or after it are rejected, and the workbook locks on its own within the delay stated in Business rules.
- **DP-33 — Role gates per season state** Viewer, technician, lead and data manager roles allow exactly the actions in the Business rules role table, checked on every request.
- **DP-34 — Season-close notice** Every trial lead in the station gets one season-close email each time a workbook locks, by cutoff or by hand, as qualified in Services.
- **DP-35 — Season close journey** A trial lead sets a cutoff, a technician's late edit is rolled back with the season-closed reason, the lead reopens with a later cutoff, and the technician re-applies from the tray.
- **DP-36 — Station time zone** The data manager sets the station's time zone from the IANA zone list, and TODAY(), NOW(), cutoffs and displayed times follow it from the next read.
- **DP-37 — Member invites** The data manager adds a member with a role, the member gets one invite email as qualified in Services, and the invite link lets them set a password once and sign in.
- **DP-38 — Role changes and removal** A role change applies from the member's next sync or request, and a removed member's sessions end at once.
- **DP-39 — Member management journey** A data manager invites a technician, the technician accepts and edits, the manager changes them to viewer, and their next offline edit is rolled back.
- **DP-40 — Save versions** Leads and data managers save labelled, numbered versions whose snapshot is stored in object storage.
- **DP-41 — Exact restore as a new version** Restoring a version reproduces its sheets, cell inputs, values, formats and charts exactly and records the restore as a new version.
- **DP-42 — Undo a restore** Every restore first saves the current state as a version, and restoring that version undoes the restore exactly.
- **DP-43 — Restore journey** A data manager finds a bad bulk paste, restores an earlier saved version, checks the Analysis sheet, then undoes the restore from the notice.
- **DP-44 — Export xlsx and csv** Leads and data managers export the whole workbook as xlsx or one sheet as csv, built in the background and stored in object storage before it is offered.
- **DP-45 — CSV text never becomes a formula** Text values that start with =, +, - or @ are written to csv with a leading apostrophe, while numbers, dates and error values are written as shown.
- **DP-46 — Export-ready email and download** When an export file is stored, its requester gets one email with a download link that works only for permitted members of that station, as qualified in Services.
- **DP-47 — Export journey** A data manager exports the Plots sheet to csv and the whole workbook to xlsx, waits for both to show Ready, and downloads them.
- **DP-48 — Read-only share links** The data manager creates an unguessable, expiring link that shows one workbook's values, formats and charts without an account and accepts no changes.
- **DP-49 — Revoke, regenerate and expire links** A revoked, replaced or expired link answers not found at once, and only the newest regenerated link works.
- **DP-50 — Sponsor review journey** A data manager shares the results workbook, a sponsor reviewer opens the link with no account and sees computed values and the chart, then the link is revoked and stops working.
- **DP-51 — Editing through outages with an honest banner** With object storage or mail down, even from boot, sign-in, editing and sync keep working, storage-backed actions answer 503 without side effects, and a banner says what is affected.
- **DP-52 — Queued work resumes without restart** Exports waiting for storage and emails queued while mail is down complete on their own, exactly once, after the service returns, as qualified in Services.
- **DP-53 — Run manifest and health** The app installs, builds and serves from the run manifest on the stated port and answers the health check.
- **DP-54 — Server boundary** The server is same-origin only, enforces the request size limits, rejects cross-origin writes and never serves source files or credentials.
- **DP-55 — Responsive layout at three widths** The list, workbook, station and share screens fit 375, 768 and 1280 pixel-wide viewports with no horizontal page scroll, as laid out in Screens and layout.
- **DP-56 — Keyboard reach and focus** Every control is reachable by keyboard, F6 cycles the workbook regions, dialogs trap focus and return it on close, and Escape closes them.
- **DP-57 — Field-ledger look** The screens use the warm paper ground, graph-paper rule, ink, rust accent and field green, the stated typefaces, and monospaced right-aligned numerals.
- **DP-58 — Recalc furrow craft** A mid-wave screenshot shows outlined dependents, counting numerals and tab badges that clearly read as a chain of recalculation.
- **DP-59 — Credentials from the environment** Every service URL and credential is read from the named environment variables at start and is never written into source or sent to the browser.
- **DP-60 — Values derived from the op log** The source derives workbook state and values from the stored edit sequence and version snapshots, with no client-supplied values or stand-in in-memory store.

## Frontend

### Screens and layout (DP-05, DP-09, DP-15, DP-55)

Routes:

- `/signin`: sign-in screen.
- `/`: workbook list.
- `/w/<workbookId>`: workbook screen.
- `/station`: station settings (data manager only; other roles see the not-found screen).
- `/invite/<token>`: invite acceptance.
- `/s/<token>`: sponsor share view.

Any unknown route, or a workbook id that does not exist or belongs to another station, shows the same not-found screen, headed "Workbook not found". A signed-out visitor to any route except `/signin`, `/invite/<token>` and `/s/<token>` is sent to `/signin`.

**Top bar (every signed-in screen):** the product mark "Furrowbook", the station name, links "Workbooks" and "Station" (Station only for data managers), the signed-in member's name and role, and a "Sign out" button. Directly under it sits the service banner region, which is empty unless a service is down.

**Sign-in screen:** a centred card on the paper ground with Email and Password fields and a Sign in button.

**Workbook list:**
- Heading "Workbooks", a search box, and buttons "Create workbook" and "Import workbook" (both only for leads and data managers).
- Below that, a list of the station's workbooks, most recently updated first. Each row shows the workbook name as a link, a season chip (Draft, In season, Locked, Archived), the cutoff line and the updated line worded in the Public screens table.
- An empty search shows "No workbooks match "<query>"."

**Workbook screen:**
- **Header:** the workbook name as the page heading, the season chip, and buttons "Season" (leads and data managers), "Export" (leads and data managers), "Share" (data managers) and "Workbook rail".
- **Under the header:** a slim formula bar holding, from left to right, the Number format picker, the Bold button, the active cell's reference (such as `Plots!F4`) and the Formula field. Below it, the sync-state strip (sync status text and the "Conflicts (<n>)" button).
- **Grid:** a full-height grid on graph-paper ground, with column letters A–Z across the top and row numbers 1–500 down the side.
- **Sheet tabs:** file-folder tabs along the bottom edge, followed by "Add sheet" for leads and data managers.
- **Right rail:** a collapsible panel with tabs "Conflicts", "Charts", "Changed cells" and "Versions" (Versions only for leads and data managers). Charts of the current sheet show as cards in the Charts tab under the chart builder.

**Station settings:** heading "Station settings", a time-zone picker with a Save button, and a members table (name, email, role picker, remove button) with an "Add member" button above it.

**Invite acceptance:** a card that greets the invited person by name and station, with one "New password" field and an "Accept invite" button.

**Share view:** no top bar. A strip reads "Read-only results from <station name>. This link expires <local time>." Below it are the workbook name, a read-only grid with sheet tabs, and the current sheet's charts beneath the grid. An expired, revoked or unknown token shows the heading "This link has expired or was turned off." and nothing else.

Layout by viewport:

- **375×812 (phone):**
  - The top bar collapses to the mark, the station name and a "Menu" button that reveals the links.
  - On the workbook screen, the formula bar and sync strip span the full width; the Number format picker and Bold button sit on their own line above the reference and Formula field. The grid fills the rest, with row numbers and column A frozen while the grid scrolls sideways.
  - Sheet tabs scroll sideways inside their own strip.
  - The rail becomes a bottom sheet that covers up to seven-tenths of the screen height, opened with "Workbook rail".
  - List rows stack name, chip and dates.
- **768×1024 (tablet):** the rail starts closed and opens as a panel over the right four-tenths of the screen. Everything else is laid out as on the desktop.
- **1280×800 (desktop):** the rail is open by default beside the grid, taking about a quarter of the width.

At every width:
- the page itself never scrolls sideways; only the grid and the sheet-tab strip scroll inside their own areas;
- dialogs fit the viewport;
- every tap target is at least 44 px in both directions, except grid cells, row numbers and column letters. Those stay one compact text line tall so a sheet of plots fits on a tablet screen, and every grid action they offer is also reachable by keyboard and through the formula bar.

### Public screens and controls (DP-01, DP-02, DP-05, DP-09, DP-12, DP-13, DP-14, DP-17, DP-24, DP-25, DP-26, DP-28, DP-29, DP-31, DP-36, DP-37, DP-38, DP-40, DP-41, DP-42, DP-44, DP-48, DP-49, DP-51, DP-56)

Only the controls and regions below are public. Everything else is free. `<ref>` is a sheet-qualified cell reference such as `Plots!F4`. `<n>` is a count written in digits. `<local time>` is defined in Feedback states.

| Screen | Role and accessible name | Visible copy / notes |
|---|---|---|
| Sign in | `textbox "Email"` | label "Email" |
| Sign in | `textbox "Password"` (password input labelled "Password") | label "Password" |
| Sign in | `button "Sign in"` | "Sign in" |
| Top bar | `link "Workbooks"`, `link "Station"`, `button "Sign out"` | Station only for data managers |
| Top bar | `status` named "Service status" | banner copy from Feedback states; empty when all services are up |
| Every signed-in screen | `status` named "Notices" | toast copy from Feedback states |
| List | `heading "Workbooks"` (level 1) | |
| List | `searchbox "Search workbooks"` | placeholder "Search by name" |
| List | `button "Create workbook"`, `button "Import workbook"` | leads and data managers only |
| List | `list "Workbooks"` with one `link` per workbook named by the workbook name | each row also shows "Cutoff <local time>" or "No cutoff", and "Updated <local time>" |
| Create | `dialog "Create workbook"` with `textbox "Workbook name"` and `button "Create"` | |
| Import | `dialog "Import workbook"` with file input labelled "Workbook file", `textbox "Workbook name"`, `button "Import"`, and `list "Import limits"` | list items are the import limit lines from Feedback states |
| Workbook | `heading` (level 1) with the workbook name | |
| Workbook | `status` named "Season state" | "Draft", "In season", "Locked" or "Archived" |
| Workbook | `button "Season"` opens `menu "Season"` with `menuitem`s "Start season", "Set cutoff…", "Close season now", "Reopen season…", "Archive workbook" | only legal items for the current state and role are enabled |
| Workbook | `dialog "Season cutoff"` with `textbox "Cutoff (station time)"` and `button "Save cutoff"` | also used by "Reopen season…", with button "Reopen". Input format in Interactions. |
| Workbook | `combobox "Number format"` with options "General", "0", "0.0", "0.00", "0.000", "0.0%", "Date" | in the formula bar; shows the active cell's format; disabled when the member can't edit cells now |
| Workbook | `button "Bold"` with `aria-pressed` | in the formula bar; pressed when the active cell is bold; disabled when the member can't edit cells now |
| Workbook | `textbox "Formula"` | shows the active cell's input |
| Workbook | `status` named "Sync status" | sync copy from Feedback states |
| Workbook | `button "Conflicts (<n>)"` | opens the rail on Conflicts and focuses the first conflict |
| Workbook | `grid` named "Sheet <sheet name>" | rows carry `aria-rowindex` equal to the row number. Cells are `gridcell`s with `aria-colindex` equal to the column number (A is 1) and text equal to the displayed value. The active cell has `aria-selected="true"`. |
| Workbook | `textbox "Edit <ref>"` | the in-cell editor |
| Workbook | gridcell accessible description "Pending sync" | while the cell holds an unacknowledged edit |
| Workbook | gridcell accessible description "Recalculated" | while the recalc outline shows |
| Workbook | `tablist "Sheets"` with one `tab` per sheet named by the sheet name | the change badge is the tab's accessible description "<n> changed cells" |
| Workbook | `button "Add sheet"` | leads and data managers only |
| Workbook | `dialog "Sheet name"` with `textbox "Sheet name"` and `button "Save sheet name"` | for add and rename. Double-click or F2 on a tab opens rename for leads and data managers. |
| Workbook | `button "Workbook rail"` with `aria-expanded` | opens and closes the rail or bottom sheet |
| Rail | `complementary "Workbook rail"` containing `tablist "Rail"` with `tab`s "Conflicts", "Charts", "Changed cells", "Versions" | |
| Rail · Conflicts | `list "Open conflicts"`. Each item shows `<ref>` as its heading and has `button "Re-apply mine for <ref>"` and `button "Keep current for <ref>"` | item copy from Feedback states |
| Rail · Charts | `textbox "Chart range"`, `radiogroup "Chart type"` with `radio "Bar"` and `radio "Line"`, `textbox "Chart title"`, `button "Add chart"` | leads and data managers only; range format in Business rules |
| Rail · Charts | each chart is a `figure` named by its title, with `button "Remove chart <title>"` for leads and data managers | |
| Rail · Changed cells | `list "Changed cells"`. Items read "<ref> <old display> → <new display>" | lists the last committed edit's closure |
| Workbook | `status` named "Recalc" | recalc announcement from Feedback states |
| Rail · Versions | `textbox "Version label"`, `button "Save version"`, `list "Versions"`. Each item reads "Version <number> · <label> · <local time> · <author>" and has `button "Restore version <number>"` for data managers | |
| Restore | `alertdialog "Restore version <number>?"` with `button "Restore"` and `button "Cancel"` | |
| Restore notice | `button "Undo restore"` inside the Notices toast | |
| Export | `dialog "Export workbook"` with `radio "Excel workbook (.xlsx)"`, `radio "CSV of current sheet (.csv)"`, `button "Start export"`, and `list "Recent exports"`. Each item shows the file name and status "Pending", "Waiting for file storage" or "Ready", and when ready a `link "Download <file name>"`. | |
| Share | `dialog "Share read-only link"` with `combobox "Expires in"` (options "1 day", "7 days", "30 days"), `button "Create link"`, read-only `textbox "Share link"`, `button "Copy link"`, `list "Share links"` with `button "Revoke link"` and `button "Regenerate link"` on each active link | |
| Station | `heading "Station settings"`, `combobox "Station time zone"`, `button "Save time zone"` | |
| Station | `table "Members"` with a `combobox "Role for <name>"` and `button "Remove <name>"` per row | |
| Station | `button "Add member"` opens `dialog "Add member"` with `textbox "Name"`, `textbox "Email"`, `combobox "Role"` (Viewer, Technician, Trial lead, Data manager), `button "Send invite"` | |
| Invite | `textbox "New password"`, `button "Accept invite"` | |
| Share view | `grid` named "Sheet <sheet name>", `tablist "Sheets"`, `figure`s named by chart title | no edit controls of any kind |

### Interactions (DP-12, DP-13, DP-14, DP-17, DP-24, DP-26, DP-29, DP-56)

**Grid by keyboard:**
- The grid is a single Tab stop, and focus lands on the active cell.
- Arrow keys move one cell. Home and End go to columns A and Z. Ctrl+Home goes to A1. Page Up and Page Down move one screen.
- Typing a printable character starts editing and replaces the cell input. Enter or F2 starts editing with the current input, caret at the end.
- While editing:
  - Enter commits and moves down one row.
  - Tab commits and moves right. Shift+Tab commits and moves left.
  - Escape cancels and restores the previous input.
- Delete or Backspace on a cell that is not being edited clears its input.
- Ctrl+Page Down and Ctrl+Page Up switch to the next and previous sheet and keep the same cell address.
- Ctrl+B on the grid toggles bold on the selected range: if any selected cell is not bold, all become bold; otherwise all become not bold.
- The formula bar mirrors the active cell. Editing there and pressing Enter commits the same way, and Escape returns focus to the grid.
- Viewers, and anyone on a locked or archived workbook, can move and select but cannot open the editor or change formats. Typing shows the read-only notice from Feedback states.

**Formats:**
- Choosing an option in "Number format" applies that format to the selected range. Pressing "Bold" behaves like Ctrl+B. Both send one format op for the range and follow the same pending, sync and rollback path as cell edits.
- Option labels map to the formats in Business rules in order: "General" is general, "0" to "0.000" are the fixed-decimal formats, "0.0%" is the percent format and "Date" is date.

**Season cutoff dialog:**
- "Cutoff (station time)" is a plain text field. Type the cutoff as `YYYY-MM-DD HH:MM` in 24-hour station time, for example `2026-10-30 17:00`; seconds are not accepted. The field opens prefilled with the current cutoff in that format, or empty.
- Saving an empty field clears the cutoff. In "Reopen season…", an empty field reopens with no cutoff.
- Text not in that format shows the cutoff format error from Feedback states and sends nothing.

**Regions and Tab order:**
- The workbook screen's Tab order is: top bar, header buttons, Number format, Bold, Formula, sync strip, grid, sheet tabs (one Tab stop; Left and Right move between tabs; Enter or Space opens the focused sheet; F2 opens rename for leads and data managers), Add sheet, rail.
- F6 cycles focus forward through formula bar (landing on Formula), grid, sheet tabs and rail (opening the rail if it is closed), and Shift+F6 cycles backward.
- In the rail, the rail tab list works like the sheet tabs, without rename.

**Conflict tray:**
- "Conflicts (<n>)" opens the rail on the Conflicts tab and puts focus on the first conflict's "Re-apply mine" button.
- After a conflict is resolved, focus moves to the next conflict's "Re-apply mine" button. When none are left, focus moves to the "Conflicts" rail tab.

**Dialogs and menus:**
- Opening a dialog moves focus to its first field. Tab and Shift+Tab cycle inside it.
- Escape or Cancel closes it and returns focus to the control that opened it.
- The Season menu opens with Enter, Space or Arrow Down. Arrow keys move through the items, Enter chooses one, and Escape closes the menu and returns focus to "Season".

**Pointer and touch:**
- A click or tap selects a cell. A double-click or double-tap opens the editor.
- Dragging from a selected cell selects a range. Shift+arrows extend the selection by keyboard. The selected range is what formats apply to and what fills the Chart range field, sheet-qualified, when the builder is opened.
- Hovering a cell tints it with a faint wash of field green. Hovering a button deepens its colour, and pressing it nudges it down slightly.
- On the phone layout, the bottom-sheet rail has a grab handle. Dragging it down past halfway closes it, and Escape also closes it.

**Offline edits and sync:**
- A committed edit shows its effect at once, evaluated in the browser with the rules in Business rules. A small accent-coloured corner mark and the "Pending sync" description stay on each affected cell until the server acknowledges the edit.
- Pending edits are kept in the browser per member and per workbook, so they survive a reload or closed tab. Another member who signs in on the same browser never sees them.
- When online, the app sends pending edits in order, up to the batch limit, as one batch with a key fixed when the batch is formed. A failed send is retried with the identical key and body every 5 seconds, and immediately when the browser reports it is back online.
- **On acknowledgement:**
  - Applied edits lose their marker.
  - Conflicted edits are rolled back to the server state, announced, and added to the tray.
  - Rejected edits are rolled back the same way with their reason; rejected cell edits are added to the tray as stated in Business rules.
  - Rollbacks briefly underline the affected cells in accent, then show the server state.
- While online, the app re-reads the workbook after every sync and every 10 seconds. Other members' edits, season changes and role changes therefore appear within 10 seconds.

**Recalc furrow:**
- The furrow plays when an edit is committed in the browser, for the closure computed in the browser with the dependency rules from Business rules. That set equals the closure the server reports for the edit.
- The "Changed cells" list fills with the closure, and the Recalc announcement is made.
- Sheet-tab badges clear when that sheet is opened or the next edit is committed.

**Season, versions, exports, share:**
- Choosing "Restore version <number>" opens the restore confirmation. "Restore" runs it. The resulting notice carries "Undo restore" for 10 seconds, and that button restores the version saved just before the restore.
- "Copy link" copies the full share URL and announces "Link copied."

**Double tap safety:** "Create", "Import", "Start export", "Create link", "Send invite", "Save version" and "Restore" are disabled from the first press until the response arrives. Create and Import reuse one request key for that dialog session, so a second request that does get sent still makes only one workbook.

### Visual design (DP-57)

**Colour:**
- The ground is a warm, unbleached paper colour, like an old field notebook. No surface is pure white.
- Text and grid ink are a very dark green-black.
- Rules and cell borders are a muted khaki.
- A rust orange is the single accent, used for the recalc outline, pending marks, focus rings, the primary button and badge pills.
- A mid forest green marks the field state: the In season chip, synced status, chart bars and hover tint.
- Locked and archived chips use ink on khaki. Error text uses the rust accent with an icon and words, never colour alone.

**Graph paper:** under the grid, and faintly across empty areas, runs a graph-paper rule of thin khaki lines 8 px apart. Every fifth line is a touch darker, like surveyor's paper.

**Type:**
- Headings and the product mark use Space Grotesk, a geometric grotesque with slightly quirky letterforms.
- Body text and controls use IBM Plex Sans.
- Every number in a cell, badge, counter, date or time uses IBM Plex Mono with figures of equal width, right-aligned in cells so decimal places line up.
- Each heading step is about one-fifth larger than the one below, from body text up to the page heading.
- All three typefaces are bundled with the app, not loaded from outside.

**Density and composition:**
- Density is compact. Grid rows are just tall enough for one line of body text plus a little air, and toolbars are slim.
- Sheet tabs look like card-file tabs: rounded at the top, standing up from the bottom edge, with the current tab joined to the grid.
- The rail has a khaki rule on its left edge, as if a page had been clipped to the side.

**Accessibility:**
- All text and essential icons meet WCAG 2.2 AA contrast against the paper ground and against the green and rust fills. Text on the rust accent is paper-coloured and large or bold enough to pass.
- Focus is a rust ring at least 2 px thick, offset outside the control, visible on both paper and green.
- Tap target sizes follow the rule in Screens and layout.

### Motion and effects (DP-24, DP-25, DP-26, DP-58)

General motion: one easing everywhere, a quick start that settles gently with no bounce.

- **Rail and bottom sheet:** slide in and out in about a fifth of a second.
- **Dialogs and the Season menu:** fade and grow slightly from their opener in under a fifth of a second, and reverse on close.
- **Notices toasts:** rise from the bottom in about a fifth of a second and fade after 6 seconds. A restore notice stays 10 seconds.
- **Hover and press:** colour changes in about a tenth of a second.
- **Rollback underline:** shows for about half a second.
- **Syncing bar:** a thin bar sweeps along the sync strip only while a sync request is in flight. This is the only repeating motion in the product. No other decorative or looping animation is allowed.

**Signature — Recalc furrow.** When a cell edit is committed, the user sees which cells it moved and in what order:

1. Every cell in the edit's dependency closure, on any sheet, gets a rust outline 2 px thick. Each outline appears when its wave lands.
2. Waves follow dependency depth (defined in Business rules). Depth 1 lands at 0 ms after commit, and each further depth lands 60 ms after the one before it (depth 2 at 60 ms, depth 3 at 120 ms), up to depth 8 at 420 ms. Cells deeper than 8 join the depth-8 wave.
3. When its wave lands, each visible numeric cell counts from its old value to its new value over 180 ms, in the cell's number format with fixed-width figures. Non-numeric values, errors and cells changing between number and non-number swap at once when their wave lands.
4. Each tab of a sheet other than the current one, if that sheet holds closure cells, shows a rust badge. The badge starts at 0 at commit and rises as each wave lands on that sheet. Its final number equals that sheet's closure count.
5. Chart bars and line points bound to a range that holds closure cells move to their new height over 180 ms, starting in the same wave as their source cell.
6. All outlines fade together over 600 ms, starting 600 ms after the last wave lands. The "Recalculated" description is removed when the fade ends.
7. If another edit is committed before the fade ends, the current furrow ends at once and the new one begins.

For example, with the seed data at start, editing `Plots!F4` outlines `Plots!G4` at 0 ms, `Analysis!B2:B4` at 60 ms and `Analysis!C2:C4` at 120 ms. The Analysis tab badge reaches 6, and all three bars of "Mean adjusted yield by entry" move at 60 ms.

**Reduced motion** (when the system asks for reduced motion):
- **Furrow:** no waves, counting or tweens. All closure cells show a static rust outline for 1.5 seconds, then it disappears. Values swap at once. Tab badges show their final counts at once. The rail opens to "Changed cells", and the list stays until the next edit. The Recalc announcement is the same.
- **Rail, dialogs, toasts:** appear and disappear without sliding or scaling, using an opacity change of under a tenth of a second.
- **Syncing bar:** replaced by the static text from Feedback states.
- **Rollback underline:** shown without animation for the same half second.

### Feedback states (DP-01, DP-04, DP-07, DP-09, DP-12, DP-13, DP-17, DP-26, DP-28, DP-29, DP-31, DP-36, DP-37, DP-38, DP-40, DP-41, DP-42, DP-44, DP-48, DP-49, DP-51)

Placeholders:
- `<ref>` is a sheet-qualified cell reference.
- `<target>` is what a rolled-back edit touched: the `<ref>` for a cell edit, the sheet-qualified range for a format edit, the sheet name for a sheet edit, and the chart title for a chart edit.
- `<name>` is a member's display name.
- `<email>` is an email address.
- `<n>`, `<number>`, `<k>` and `<m>` are whole numbers written in digits.
- `<local time>` is a station-zone date and time written `YYYY-MM-DD HH:MM` (24-hour) followed by the zone abbreviation, for example `2026-10-30 17:00 CDT`. Every date and time the browser shows outside grid cells uses this format: list cutoff and updated lines, version items, link expiry, the share-view strip and notices.
- `<state>` is one of draft, in season, locked, archived.
- `<zone>` is an IANA zone name.
- `<limit>` is the response's `limit` value written in digits with comma thousands separators.

Plural forms use "1 edit", "1 cell", "1 sheet" in the singular.

Import limits, shown as the items of `list "Import limits"` in the Import dialog, in this order. Each `<field>` placeholder is that field of `GET /api/limits`, written in digits with comma thousands separators:

1. "Files up to <maxImportBytes> bytes"
2. "Up to <maxImportExpandedBytes> bytes once unzipped"
3. "Compressed no more than <maxCompressionRatio> to 1"
4. "Up to <maxSheets> sheets"
5. "Up to <maxImportCells> filled cells"
6. "Columns A–Z and rows 1–<maxRows>"

Sync status, in the `status` "Sync status":

| Situation | Copy |
|---|---|
| Nothing pending, online | "All edits synced" |
| Offline with pending edits | "Offline · <n> edits waiting" |
| Offline, nothing pending | "Offline · edits will sync when you're back in range" |
| Request in flight | "Syncing <n> edits…" |
| Last attempt failed, online | "Sync failed · retrying" |

Other notices are announced through the `status` "Notices" unless another region is named. Every async action disables its button while pending and shows the pending copy on it.

| Action | Pending | Success | Field error / rejection | Outage |
|---|---|---|---|---|
| Sign in | "Signing in…" | goes to the workbook list | "Email or password is wrong." under the form | — |
| Create workbook | "Creating…" | opens the workbook. Notice "Workbook created." | under the name field: "Give the workbook a name of 1 to 80 characters." | — |
| Import workbook | "Importing…" | opens the workbook. Notice "Imported <name> with <n> sheets." | 413: "That file is larger than <limit> bytes." 415: "That file isn't a real .xlsx or .csv workbook." archive_too_large: "That file expands past <limit> bytes, so it wasn't opened." archive_too_compressed: "That file is compressed more than <limit> to 1, so it wasn't opened." unsafe_archive: "That file contains unsafe paths and was rejected." too_many_sheets: "That file has more than <limit> sheets." too_many_cells: "That file has more than <limit> filled cells or goes past column Z or row 500." | 503: "File storage is unavailable, so nothing was imported. Try again when the banner clears." |
| Cell edit, conflict | — | — | "<ref> conflicted with <name>'s edit. Your value is in the conflict tray." | — |
| Any edit, rejected | — | — | "Edit to <target> was rolled back: <reason text>." | — |
| Typing on a read-only grid | — | — | "This workbook is read-only for you right now." | — |
| Add or rename sheet | — | — | under the field: "Use 1 to 31 characters, none of ' ! [ ] : * ? / \, and a name no other sheet has." | — |
| Add chart | — | — | under Chart range: "Enter a range on this sheet of at least 2 rows and 2 columns, like A1:B4." Under Chart title: "Give the chart a title of 1 to 60 characters." | — |
| Re-apply mine | "Re-applying…" | "Your value is back in <ref>." | 409 or 403: "Can't re-apply: <reason text>.", where `<reason text>` is the text for the response's error code. The conflict stays in the tray. | — |
| Keep current | — | "Kept the current value in <ref>." | — | — |
| Start / close / reopen / archive / cutoff | "Saving…" | "Season started." / "Season closed." / "Season reopened." / "Workbook archived." / "Cutoff set to <local time>." / "Cutoff cleared." | 409: "That isn't allowed while the workbook is <state>." Malformed cutoff text: "Enter a date and time as YYYY-MM-DD HH:MM." 422 cutoff errors as worded in API | — |
| Add member | "Sending…" | "Member added. The invite email will be sent to <email>." | 409: "<email> is already a member of this station." 422 field errors as worded in API | — |
| Change role | — | "Role updated. It applies from <name>'s next sync." | — | — |
| Remove member | — | "<name> was removed from the station." | — | — |
| Station time zone | "Saving…" | "Time zone saved. TODAY() and cutoffs now use <zone>." | "Pick a time zone from the list." | — |
| Save version | "Saving…" | "Version <number> saved." | "Give the version a label of 1 to 60 characters." | 503: "File storage is unavailable, so versions can't be saved or restored right now." |
| Restore version | "Restoring…" | "Restored version <number> as version <m>." with "Undo restore" | 409: "That isn't allowed while the workbook is <state>." | the 503 copy above |
| Undo restore | "Undoing…" | "Restore undone as version <k>." | as Restore | as Restore |
| Start export | "Starting…" | "Export queued. We'll email you when it's ready." | — | none needed; the queued copy is true while storage is down |
| Create / regenerate / revoke link | "Saving…" | "Link created. It expires <local time>." / "New link created. The old link no longer works." / "Link revoked." | "Pick how long the link should last." | — |
| Accept invite | "Saving…" | goes to the workbook list | "Use at least 10 characters." / "This invite has already been used or does not exist." | — |

Rejection `<reason text>` by code:

| Code | Text |
|---|---|
| `season_locked` | "the season is closed" |
| `season_archived` | "the workbook is archived" |
| `role_cannot_edit` | "your role can't make this edit right now" |
| `sheet_missing` | "that sheet no longer exists" |
| `invalid_op` | "the edit was not valid" |
| `conflict_resolved` | "that conflict was already resolved" |

Conflict tray items:
- A conflict shows "Yours: <your input>" and "Current: <current input> by <name>".
- A rejected edit shows "Yours: <your input>" and "Not saved: <reason text>".
- An empty tray shows "No conflicts. Every edit you made is saved."

Recalc announcement, in the polite `status` "Recalc", in both motion modes:
- "Edit to <ref> updated <n> cells on <k> sheets."
- With an empty closure: "Edit to <ref> changed no other cells."

Service banner, in the `status` "Service status":
- Storage down: "File storage is unavailable. Editing and sync still work; imports, exports and versions will resume when it returns."
- Mail down: "Email is delayed. Invites, export notices and season-close notices are queued and will send when mail returns."

Both lines show when both services are down. The banner is read from the service status endpoint on load and every 10 seconds, so it appears within 20 seconds of an outage starting and clears within 20 seconds of recovery.

Not-found screen: heading "Workbook not found" and the line "It may have been removed, or it belongs to another station."

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-06, DP-07, DP-08, DP-10, DP-11, DP-17, DP-20, DP-21, DP-23, DP-28, DP-29, DP-31, DP-36, DP-37, DP-38, DP-40, DP-41, DP-42, DP-44, DP-46, DP-48, DP-49, DP-51)

**Conventions:**
- All API paths start with `/api`. Request and response bodies are `application/json; charset=utf-8`, except import (`multipart/form-data`) and downloads.
- Ids are UUIDs. Times in responses are UTC ISO 8601 with a trailing `Z`, unless a field says "local".
- Sessions use an HttpOnly, SameSite=Lax cookie set at sign-in.

**Error shape:** every error uses one shape: `{"error":{"code":"<code>","message":"<text>"}}`, optionally with `"fields":{"<field>":"<text>"}` for validation or `"limit":<number>` for a limit. Field-error message texts are given in this section or in Feedback states.

**Error precedence** applies to the whole API:
1. `413 payload_too_large` at the boundary.
2. `403 cross_origin`.
3. `401 unauthenticated`.
4. `404 not_found` for an unknown id or another station's id.
5. `403 forbidden` for a role that may not use the endpoint at all, per the role table.
6. Idempotent replay: a stored response is returned as is, or `409 idempotency_key_reused` is returned.
7. `409` state conflicts.
8. `415` / `422` validation.
9. `503 storage_unavailable`.

Checks on an individual edit (sync ops and re-apply) are not endpoint gates; they follow the edit check order in Business rules. Rows below list only their own extra errors.

**Request keys:**
- Create workbook, import, and sync require an `Idempotency-Key` header of 8 to 128 printable ASCII characters. A missing or malformed key answers `422` with `fields: {"Idempotency-Key":"Send a key of 8 to 128 printable characters."}`.
- A key is scoped to the member and the endpoint, and for sync also to the workbook.
- A repeat with an identical body returns the stored status and body byte for byte. For import, "identical" means the same file bytes and name.
- A repeat with a different body answers `409 idempotency_key_reused`.
- Requests that arrive at the same time with the same key are applied once, and all receive the same response.
- Keys are kept for the life of the workbook.

**Health, status, limits:**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/health` | — | `200 {"status":"ok"}`, no session needed | — |
| `GET /api/status` | — | `200 {"storage":"up"\|"down","mail":"up"\|"down","checkedAt":"<utc>"}`, no session needed. Each value is at most 10 seconds old. | — |
| `GET /api/limits` | — | `200 {"maxJsonBytes":1000000,"maxImportBytes":5000000,"maxImportExpandedBytes":50000000,"maxCompressionRatio":100,"maxImportCells":100000,"maxSheets":20,"maxColumns":26,"maxRows":500,"maxInputChars":2000,"maxFormulaNodes":500,"maxFormulaCells":10000,"maxDependencyDepth":256,"maxOpsPerBatch":200,"maxSearchChars":100}`, no session needed | — |

Every limit is inclusive: a value equal to the limit is allowed. `maxDependencyDepth` is the formula chain length limit defined in Business rules.

**Session:**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/session` | `{"email","password"}` | `200 {"user":{"id","name","email","role","stationId","stationName","timeZone"}}` and sets the session cookie | `401 invalid_credentials` with message "Email or password is wrong." |
| `GET /api/session` | — | `200` same body as above | `401 unauthenticated` |
| `DELETE /api/session` | — | `204` | — |

`role` is one of `viewer`, `technician`, `lead`, `data_manager`.

**Workbooks:**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/workbooks?q=<text>` | `q` optional, case-insensitive substring of the name, at most 100 characters | `200 {"workbooks":[<summary>]}`, own station only, most recently updated first | `422` with `fields.q` "Search text can be at most 100 characters." |
| `POST /api/workbooks` | `{"name"}` with `Idempotency-Key` | `201 {"workbook":<summary>}`. The new workbook is draft with one empty sheet named "Plots". | `422` with `fields.name` "Give the workbook a name of 1 to 80 characters." |
| `POST /api/workbooks/import` | multipart fields `file` and `name` (1 to 80 characters; defaults to the file name without extension), with `Idempotency-Key` | `201 {"workbook":<summary>,"sheets":[{"id","name"}],"originalKey":"<object key>"}` | `413 payload_too_large`; `415 unsupported_file`; `422 archive_too_large`, `archive_too_compressed`, `unsafe_archive`, `too_many_sheets` or `too_many_cells`; `503 storage_unavailable`. Which errors carry `limit`, and its value, is stated in Business rules. |
| `GET /api/workbooks/<id>` | — | `200 {"workbook":<snapshot>}` | — |
| `PATCH /api/workbooks/<id>` | `{"name"?, "closesAt"?}`. `closesAt` is local `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS`, or `null` to clear. | `200 {"workbook":<summary>}` | `409 season_locked` / `season_archived`; `422` with `fields.closesAt` "Enter a local date and time.", "Pick a time after now in <zone>." or "That time is skipped by a clock change in <zone>." |
| `POST /api/workbooks/<id>/season` | `{"action":"start"\|"close"\|"reopen"\|"archive","closesAt"?}` (`closesAt` only with `reopen`) | `200 {"workbook":<summary>}` | `409 illegal_transition` with message "Cannot <action> a workbook that is <state>."; `422` with `fields.closesAt` as for PATCH |

`<summary>` is `{"id","name","state":"draft"|"in_season"|"locked"|"archived","closesAt":"<local>"|null,"closesAtUtc":"<utc>"|null,"updatedAt","sheetCount"}`.

`<snapshot>` is the summary plus:
- `"timeZone"`
- `"headSeq"` (the last applied sequence number, starting at 0)
- `"myRole"`
- `"sheets":[{"id","name","position","cells":{"<A1>":{"input","value","display","format","error"?}}}]` with only non-empty cells
- `"charts":[{"id","sheetId","type":"bar"|"line","title","range","categories":[...],"series":[{"name","values":[number|null]}]}]`, with `range` in the sheet-qualified form defined in Business rules

In a cell:
- `value` is a number, string or boolean, or `null` for an error.
- `error` is the error value text when the cell holds an error.
- `display` is the formatted text shown in the grid.
- `format` is `{"numberFormat","bold"}`.

**Sync:**

`POST /api/workbooks/<id>/sync`, with `Idempotency-Key`. Request body:

```json
{"deviceId":"<1-64 chars>","baseSeq":<int>,"ops":[<op>, ...]}
```

Each op is an object with `opId` (1 to 64 characters, unique in the batch), `type`, and exactly the fields its type lists:

| `type` | Fields |
|---|---|
| `setCell` | `sheetId`, `cell` (`A1` to `Z500`), `input` (at most 2,000 characters; `""` clears) |
| `setFormat` | `sheetId`, `range` (`B2:C4` or a single cell, without a sheet name), `format` (`{"numberFormat"?: "general"\|"0"\|"0.0"\|"0.00"\|"0.000"\|"0.0%"\|"date","bold"?: boolean}`, at least one key) |
| `addSheet` | `sheetId` (client-made UUID), `name` |
| `renameSheet` | `sheetId`, `name` |
| `addChart` | `chartId` (client-made UUID), `sheetId`, `type` given as `chartType` (`"bar"` or `"line"`), `title` (1 to 60 characters), `range` (sheet-qualified) |
| `removeChart` | `chartId` |

Validation:
- The whole request answers `422` with `fields` only when the batch itself is malformed: the body is not an object or has a field other than `deviceId`, `baseSeq` and `ops`; `deviceId` is not 1 to 64 characters; `baseSeq` is not a whole number from 0 to the current `headSeq`; `ops` is not an array of 1 to 200 objects; an op lacks an `opId` of 1 to 64 characters; or two ops share an `opId`.
- Any other problem inside an op rejects that op alone with `invalid_op`, and the rest of the batch is still processed. This covers an unknown `type`, a missing field, any extra field (including a `value` field), a wrong field type, an `input` over 2,000 characters, and the content rules in Business rules.

Success: `200`, with ops processed in order. Body:

```json
{"batch":{"key":"<key>","deviceId":"<id>","headSeq":<int>},
 "results":[
   {"opId":"<id>","status":"applied","seq":<int>,
    "cell":{"sheetId","cell","value","display","error"?},
    "dependents":[{"sheetId","sheetName","cell","depth":<int>,"value","display","error"?}]},
   {"opId":"<id>","status":"conflict","conflictId":"<id>","current":{"input","author":{"id","name"}}},
   {"opId":"<id>","status":"rejected","reason":"season_locked"|"season_archived"|"role_cannot_edit"|"sheet_missing"|"invalid_op","conflictId":"<id>"|null}]}
```

- Only applied `setCell` results carry `cell` and `dependents`.
- A rejected result carries a `conflictId` only when Business rules keep that rejection in the tray; otherwise `conflictId` is `null`.
- Values sent by clients are never accepted.
- Role and season never fail the whole request. They appear as per-op rejections.

**Conflicts:**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/workbooks/<id>/conflicts` | — | `200 {"conflicts":[{"id","kind":"conflict"\|"rejected","ref","sheetId","cell","myInput","currentInput","currentAuthor":{"id","name"}\|null,"reason"\|null,"createdAt"}]}` | — |
| `POST /api/workbooks/<id>/conflicts/<conflictId>/resolve` | `{"choice":"reapply"\|"keep_current"}` | `200 {"resolved":{"id","choice"},"result":{"status":"applied","seq"}\|null}` | `409 conflict_resolved`. For `reapply` only, after that: `409 season_locked` / `season_archived` when the workbook is locked, archived or past its cutoff, whatever the member's role; then `403 role_cannot_edit` when the workbook is draft or in season but the member's role can't make that cell edit now; then `409 sheet_missing` when the entry's sheet no longer exists (for example, a restore removed it). Checked in that order. |

- The list returns the caller's open conflicts only, oldest first. `reason` is set only for `kind` `rejected`, and is then one of `season_locked`, `season_archived` or `role_cannot_edit`.
- Another member's conflict id answers `404 not_found`.
- `keep_current` works in every season state, including when the entry's sheet no longer exists.

**Versions:**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/workbooks/<id>/versions` | — | `200 {"versions":[<version>]}`, newest first | — |
| `POST /api/workbooks/<id>/versions` | `{"label"}`, 1 to 60 characters | `201 {"version":<version>}`, in every season state | `422` with `fields.label`; `503 storage_unavailable` |
| `POST /api/workbooks/<id>/versions/<versionId>/restore` | — | `201 {"restored":<version>,"undo":<version>,"headSeq"}` | `409 season_locked` / `season_archived`; `503 storage_unavailable` |

`<version>` is `{"id","number","label","kind":"saved"|"restore"|"before_restore","seq","createdAt","createdBy":{"id","name"}}`.

**Exports:**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/workbooks/<id>/exports` | `{"format":"xlsx"}` or `{"format":"csv","sheetId"}` | `202 {"export":<export>}` | `422` with `fields.sheetId` |
| `GET /api/workbooks/<id>/exports` | — | `200 {"exports":[<export>]}`, newest 20 | — |
| `GET /api/exports/<exportId>/download` | — | `200` file with `Content-Disposition: attachment; filename="<fileName>"` and the xlsx or `text/csv; charset=utf-8` type | `409 export_not_ready`; `503 storage_unavailable` |

`<export>` is `{"id","format","sheetId"|null,"fileName","status":"pending"|"waiting_for_storage"|"ready","createdAt","readyAt"|null}`. The file name is the workbook name with characters outside letters, digits and hyphens turned into hyphens, plus `-<sheet name, same rule>` for csv, then `.xlsx` or `.csv`.

**Share links:**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/workbooks/<id>/share-links` | — | `200 {"links":[<link>]}` | — |
| `POST /api/workbooks/<id>/share-links` | `{"expiresInSeconds"}`, a whole number from 10 to 2,592,000 | `201 {"link":<link>}` | `422` with `fields.expiresInSeconds` "Pick how long the link should last." |
| `POST /api/workbooks/<id>/share-links/<linkId>/regenerate` | — | `201 {"link":<new link>}` with the same lifetime length starting now. The old link becomes `revoked`. | `409 link_inactive` |
| `DELETE /api/workbooks/<id>/share-links/<linkId>` | — | `204` | — |
| `GET /api/share/<token>` | — | `200 {"workbook":{"name","stationName","state","expiresAt","sheets":[{"name","position","cells":{"<A1>":{"value","display","format","error"?}}}],"charts":[{"sheetName","type","title","categories","series"}]}}` | `404 not_found` |
| any other method on `/api/share/<token>` | — | — | `405 read_only` |

- `<link>` is `{"id","url":"/s/<token>","expiresAt","status":"active"|"expired"|"revoked"}`.
- The share response contains no formulas, inputs, ids, member names or sequence numbers. It carries `Cache-Control: no-store`.
- The token is 43 URL-safe characters made from 32 random bytes.

**Station and members:**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/station` | — | `200 {"station":{"id","name","timeZone"}}` | — |
| `PATCH /api/station` | `{"timeZone":"<IANA zone>"}` | `200` same shape | `422` with `fields.timeZone` "Pick a time zone from the list." |
| `GET /api/station/members` | — | `200 {"members":[{"id","name","email","role","status":"invited"\|"active"}]}` | — |
| `POST /api/station/members` | `{"name","email","role"}` | `201 {"member":<member>,"invite":"sent"\|"queued"}` | `409 member_exists`; `422` with `fields.name` "Enter a name of 1 to 80 characters.", `fields.email` "Enter a valid email address.", or `fields.role` "Pick a role." |
| `PATCH /api/station/members/<memberId>` | `{"role"}` | `200 {"member":<member>}` | `409 last_data_manager` when it would leave the station with no data manager; `422` with `fields.role` |
| `DELETE /api/station/members/<memberId>` | — | `204` | `409 last_data_manager` |
| `POST /api/invites/<token>/accept` | `{"password"}`, at least 10 characters | `200 {"user":...}` as in session, and sets the session cookie | `404 not_found` for a used or unknown token; `422` with `fields.password` "Use at least 10 characters." |

Unknown `/api` paths answer `404 not_found` in the error shape.

### Business rules (DP-04, DP-06, DP-07, DP-08, DP-10, DP-11, DP-13, DP-16, DP-19, DP-20, DP-21, DP-22, DP-23, DP-28, DP-29, DP-31, DP-32, DP-33, DP-36, DP-38, DP-41, DP-42, DP-45, DP-48, DP-49)

**Stations and isolation:**
- Every member belongs to exactly one station.
- Every workbook, sheet, chart, conflict, version, export and share link belongs to one station's workbook.
- Any id that belongs to another station is handled as if it did not exist, everywhere: API, pages, search, downloads and share-link management.

**Role table.** "yes" means the role may use the action; the season state machine and the API rows decide any state limits. An entry naming states allows the action only in those states. Saving versions, listing and downloading exports, share links and keep-current work in every season state.

| Action | viewer | technician | lead | data manager |
|---|---|---|---|---|
| Read the workbook list and workbooks | yes | yes | yes | yes |
| Read the station (`GET /api/station`) | yes | yes | yes | yes |
| List own conflicts, keep current | yes | yes | yes | yes |
| Re-apply own conflict | as `setCell` | as `setCell` | as `setCell` | as `setCell` |
| `setCell`, `setFormat` | no | In season | Draft, In season | Draft, In season |
| `addSheet`, `renameSheet`, `addChart`, `removeChart` | no | no | Draft, In season | Draft, In season |
| Create and import workbooks | no | no | yes | yes |
| Rename, set or clear cutoff, start, close, reopen | no | no | yes | yes |
| Archive | no | no | no | yes |
| List versions, save version | no | no | yes | yes |
| Restore version | no | no | no | yes |
| Start, list and download exports | no | no | yes | yes |
| Share links | no | no | no | yes |
| Station time zone; list, add, change and remove members | no | no | no | yes |

- An endpoint the role may not use at all answers `403 forbidden`.
- Role is read from the database on every request, so a role change applies from the member's next sync or request.
- Removing a member deletes their sessions at once, so their next request answers `401`. Their open conflicts are deleted with them.

**Edit check order.** Every sync op is checked in this order, and the first failing check decides its result:
1. Op shape (API Validation) → `invalid_op`.
2. Season: a locked workbook, or any op received at or after the cutoff instant → `season_locked`; an archived workbook → `season_archived`.
3. Role, per the role table for the current state → `role_cannot_edit`.
4. Sheet: a `sheetId` that does not exist (other than `addSheet`) → `sheet_missing`.
5. Content rules for sheets and charts below → `invalid_op`.
6. Conflict detection (`setCell` only).

Re-apply runs checks 2, 3 and 4, in that order, answering with the statuses listed in its API row. Checks 1 and 5 are not repeated: a tray entry only ever holds a `setCell` that already passed check 1, and check 5 does not apply to `setCell`. Check 6 is skipped, so a re-apply never becomes a new conflict.

**Season state machine:**

| From | Action | To | Who |
|---|---|---|---|
| draft | start | in_season | lead, data manager |
| in_season | close, or the cutoff passing | locked | lead, data manager, or the server |
| locked | reopen | in_season | lead, data manager |
| locked | archive | archived | data manager |

- Every other pair answers `409 illegal_transition`: start from in_season, locked or archived; close from draft, locked or archived; reopen from draft, in_season or archived; archive from draft, in_season or archived.
- Archived is final.
- Rename and cutoff changes are allowed only in draft and in_season. Otherwise they answer `409 season_locked` or `season_archived`.
- Reopen clears the cutoff unless the request gives a new `closesAt`, which must be in the future.

**Cutoff and station time:**
- `closesAt` is a wall-clock time in the station's zone. Its UTC instant is recomputed whenever the station's zone changes.
- A local time skipped by a daylight-saving change is refused with the skipped-time message. A repeated local time means the earlier instant.
- An op the server receives at or after the cutoff instant is rejected with `season_locked`, even before the state changes.
- The server moves an in-season workbook past its cutoff to `locked` within 5 seconds of the cutoff, whether or not anyone is using it.
- A cutoff can only be set in the future; a past or present value answers `422`.

**Sequencing and sync:**
- Each workbook has one total order of applied ops, `seq` 1, 2, 3…, with no gaps.
- Batches for one workbook are applied one at a time.
- A batch is all-or-nothing in storage: either all of its results are recorded or none are.
- Within a batch, ops are applied in their listed order.
- A `setCell` whose cell was changed after the batch's `baseSeq` by a different member (or by a restore) is not applied. It becomes a `conflict` owned by its author, holding their input and the current input and author.
- Edits by the same member never conflict with each other.
- `setFormat`, sheet ops and chart ops never conflict; later ops win.
- When several members send from the same base at the same time, exactly one of them is applied for a given cell: the one sequenced first. The rest become conflicts.
- A `setCell` rejected with `season_locked`, `season_archived` or `role_cannot_edit` is recorded as a `rejected` entry in its author's tray, and its result carries that `conflictId`. Every other rejected op, including every `invalid_op` and `sheet_missing` rejection and every rejected op that is not a `setCell`, carries `conflictId: null` and is not kept in the tray.
- `reapply` appends the author's input as a new `setCell`, provided the re-apply checks in the edit check order pass now.
- `keep_current` closes the conflict without changing the cell.
- A resolved conflict cannot be resolved again (`409 conflict_resolved`).

**Exactly-once batches:**
- A batch key that has been applied is never applied again. A replay returns the first acknowledgement byte for byte, even if the workbook's state has changed since, and adds no ops, conflicts or sequence numbers.
- The same rule makes create workbook and import produce one workbook per key.

**Cell inputs and values:**
- An input starting with `=` is a formula.
- An input matching an optional sign, digits and an optional decimal part (for example `-3.25`, `+12`, `58.4`) is a number.
- An input `YYYY-MM-DD` that is a real calendar date is a date. Its value is the day count from 1899-12-30, displayed as `YYYY-MM-DD` and given the `date` format.
- `TRUE` and `FALSE`, case-insensitive, are booleans.
- An input starting with an apostrophe is text without the apostrophe, so `'=N+20` stores the text `=N+20`.
- Anything else is text.

**Formulas:**
- Operators: `+ - * / ^ &`, comparisons `= <> < <= > >=`, unary minus, parentheses, and numeric, string (`"…"`) and boolean literals.
- References: `F4`, `$B$4`, ranges `D2:D13`, whole columns `D:D` (rows 1 to 500), and sheet-qualified forms such as `Plots!F4` and `'Plot data'!D2:D13`. Sheet and function names are case-insensitive.
- Functions: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, STDEV (sample), ROUND(x, digits), ABS, IF, AND, OR, SUMIF, COUNTIF, AVERAGEIF (the criterion is an exact match; text compared case-insensitively), DATE(year, month, day), TODAY(), NOW().
- Empty cells count as 0 in arithmetic. AVERAGE, COUNT, MIN, MAX and STDEV ignore empty cells and text.
- Arithmetic on text gives `#VALUE!`. Division by zero gives `#DIV/0!`. A reference to a missing sheet gives `#REF!`. An unknown function or name gives `#NAME?`. A syntax error gives `#ERROR!`.
- Errors propagate to every formula that uses them.
- Rounding is half away from zero.

**Display formats:**
- `general` shows up to 10 significant digits with trailing zeros trimmed.
- `0`, `0.0`, `0.00` and `0.000` fix the decimals.
- `0.0%` shows the value times 100 with one decimal and a percent sign.
- `date` shows `YYYY-MM-DD`.

**Station time:**
- TODAY() is the current date in the station's time zone, as a date value.
- NOW() is the current station wall-clock date and time as a day count with a fraction.
- Neither depends on the server's zone or the browser's zone. The browser evaluates them with the zone in the workbook snapshot.
- They are re-evaluated on every workbook read and every applied edit.
- `=TODAY()-D2` therefore gives whole days after planting, unaffected by daylight-saving changes.

**Dependencies and closure:**
- A formula depends on every cell its references name, statically, whatever an IF or criterion selects.
- The closure of an edit to a cell is every cell that depends on it, directly or through other cells, on any sheet. It does not include the edited cell itself.
- A closure cell's depth is the length of the longest dependency chain from the edited cell to it, so a direct dependent has depth 1.
- The server reports the closure in `dependents`. The browser computes the same set and depths with the same rules.

**Budgets:**
- **Parse nodes.** Each number, string or boolean literal, each reference (a cell, a range and a whole column each count as one node), each operator (binary or unary) and each function call counts as one node. Parentheses and argument commas count nothing. For example, `=SUM(A1:A3)+2*B1` has 6 nodes. A formula with more than 500 nodes evaluates to `#LIMIT`.
- **Cells covered.** Add up every reference in the formula: a cell counts 1, a range counts rows times columns, a whole column counts 500, and a reference repeated in the formula counts each time. For example, `=SUM(A:Z)` covers 13,000 cells. A formula covering more than 10,000 cells evaluates to `#LIMIT`.
- **Chain length.** An empty cell, a constant, or a formula with no references has chain length 0. A formula cell's chain length is 1 more than the largest chain length among the cells it references. For example, with A1 `1`, A2 `=A1+1` and A3 `=A2+1`, A2 has chain length 1 and A3 has 2. A cell with chain length over 256 evaluates to `#LIMIT`.
- Every cell on a reference cycle, and every cell depending on one, evaluates to `#CYCLE`; `#CYCLE` takes precedence over `#LIMIT`.
- With these budgets in force:
  - a sync request of up to 200 ops answers within 2 seconds;
  - a workbook read answers within 2 seconds;
  - after any single commit, the browser accepts the next keystroke within 1 second.

**Derived values:**
- The server derives sheets, inputs, formats, charts and every value from the ordered op record and version snapshots.
- A reopened workbook, another member's view, the share view, the exports and the browser that made the edit all show the same values.

**Sheets and charts:**
- Sheet names are 1 to 31 characters, unique within the workbook regardless of case, and may not contain `' ! [ ] : * ? / \`. A name breaking these rules is `invalid_op`.
- A workbook has at most 20 sheets; an `addSheet` past that is `invalid_op`.
- Formulas refer to sheets by identity, so after a rename they show the new name and keep their values.
- A chart `range` is always sheet-qualified, in ops and snapshots alike: the sheet name, `!`, then a range such as `Analysis!A1:B4`. The sheet name is wrapped in apostrophes when it contains anything other than letters, digits and underscores, for example `'Plot data'!A1:C5`. Snapshots show the sheet's current name.
- The range's sheet must be the chart's `sheetId`, it must have at least 2 rows and 2 columns, and it may cover at most 10,000 cells; otherwise the op is `invalid_op`.
- In the "Chart range" field, a range typed without a sheet name means the current sheet; the browser sends the qualified form.
- The first column gives the categories, the first row gives the series names, and each other column is a series. Non-numeric values plot as gaps.

**Import mapping and checks:**
- Checks run in this order: request size, then content type, then archive checks, then content limits. All checks except the content limits run before any sheet content is read.
- **Request size:** a file part over 5,000,000 bytes, or a request over 5,100,000 bytes, answers `413` with `limit` 5000000.
- **Content type** is decided by content, not by extension:
  - an xlsx must start with the zip local-header signature and contain `xl/workbook.xml`;
  - a csv must be valid UTF-8 (a byte-order mark is allowed) with no NUL bytes;
  - anything else answers `415 unsupported_file`, with no `limit`.
- **Archive checks** read only the zip's central directory, in this order:
  1. a total uncompressed size over 50,000,000 bytes answers `422 archive_too_large` with `limit` 50000000;
  2. any entry whose uncompressed size is more than 100 times its compressed size answers `422 archive_too_compressed` with `limit` 100;
  3. an entry name containing `..`, starting with `/` or `\`, or carrying a drive letter answers `422 unsafe_archive`, with no `limit`.
- **Content limits:** more than 20 sheets answers `422 too_many_sheets` with `limit` 20. More than 100,000 filled cells, or any cell beyond column Z or row 500, answers `422 too_many_cells` with `limit` 100000. Reading stops at the first cell over the limit.
- **xlsx mapping:**
  - sheets keep their order and names; characters not allowed in sheet names become hyphens;
  - numbers, text, booleans and formulas become inputs, with formulas prefixed by `=`;
  - cells with a date number format become dates;
  - a bold font becomes bold;
  - number formats map to the nearest Furrowbook format, otherwise `general`;
  - xlsx charts are not imported.
- **csv mapping:** one sheet named after the file name without its extension, cut to 31 characters. Each field follows the cell input rules above, except that a field starting with `=` is always text, never a formula.
- **Import result:** a new draft workbook. The original file is stored as described in Services, and the workbook exists only if the original was stored.

**Versions and restore:**
- A version records the workbook's complete sheet list (ids, names, order), every cell input and format, and every chart, as of a `seq`.
- Version numbers start at 1 per workbook and increase by one.
- A saved version exists only if its snapshot was stored.
- **Restoring version V, as one action:**
  1. Saves the current state as a new version of kind `before_restore`, labelled "Before restoring version <V number>".
  2. Appends one restore op that makes sheets, inputs, formats and charts equal to V. Sheets added after V are removed, and V's sheets come back with their original ids.
  3. Records a new version of kind `restore`, labelled "Restored version <V number>".
- Values are then derived again, so every cell value matches what V showed (TODAY() and NOW() follow the current station time).
- Undo is a restore of the `before_restore` version.
- The restore counts as an edit by the restoring data manager to every cell it changed, for conflict detection.
- Open tray entries are left in place by a restore. An entry whose sheet the restore removed answers re-apply with `409 sheet_missing` until that sheet comes back, and can always be closed with keep current.

**Exports:**
- An export reads the workbook at its `headSeq` when the request arrives.
- **csv** contains the chosen sheet from row 1 to the last filled row and column A to the last filled column:
  - each field is the cell's display text;
  - it uses UTF-8 with no byte-order mark and CRLF line endings;
  - fields containing a comma, double quote, CR or LF are quoted, with quotes doubled.
- **csv neutralisation:** a text value (a text input, or a formula whose result is text) whose display starts with `=`, `+`, `-` or `@` is written with a leading apostrophe. Numbers, dates, booleans and error values are written exactly as displayed, so a negative number keeps its minus sign.
- **xlsx** contains every sheet in order: formulas as formulas with their computed values cached, text as string cells (never formulas), numbers, dates with a date format, bold, and the number formats. Charts are not included.

**Share links:**
- A link shows one workbook read-only.
- It stops working at its `expiresAt` (checked on every request) or at once when revoked or regenerated. After that, both the page and `GET /api/share/<token>` answer as not found.
- Links are reported as `expired` at or after `expiresAt`.
- A link never exposes a session, an edit endpoint, or any other workbook.

**Displayed times:** every date and time shown in the browser is in the station's zone. The browser re-reads the zone with each workbook or station read.

### Services (DP-08, DP-34, DP-37, DP-40, DP-44, DP-46, DP-51, DP-52)

**PostgreSQL** (`DATABASE_URL`) is the system of record. It holds stations, members, sessions, invites, workbooks and their season state and cutoff, the per-workbook op record with sequence numbers, request keys and their stored responses, conflicts, version metadata, export records, share links, and the outgoing mail queue. Apply the schema and the seed data on every serve, idempotently, because the database may be empty at start.

**Object storage** (`S3_*`, bucket `S3_BUCKET`, which already exists; create no other bucket). Object keys:

| Object | Key |
|---|---|
| Import original | `stations/<stationId>/imports/<workbookId>/original.xlsx` or `original.csv` |
| Version snapshot | `stations/<stationId>/workbooks/<workbookId>/versions/<number>.json` |
| Export file | `stations/<stationId>/exports/<exportId>/<fileName>` |

When storage is down:

- **Import:** answers `503 storage_unavailable` and leaves no workbook, sheet or op behind. If the database write fails after the original was stored, delete the stored original before answering.
- **Save version and restore:** answer `503 storage_unavailable` and change nothing.
- **Exports:** go to `waiting_for_storage`. They are retried at least every 10 seconds and finish within 30 seconds of storage returning. An export becomes `ready`, and its email is queued, only after its file exists in storage.
- **Downloads:** answer `503 storage_unavailable`.
- **Unaffected:** sign-in, sync, conflicts, season actions, members and share links keep working.

**Mail** (SMTP at `SMTP_HOST`:`SMTP_PORT`, sender `MAIL_FROM`, whose value is `Furrowbook by Tilth & Tally <furrowbook@tilth-tally.example>`):
- Every message is written to the mail queue in the same database transaction as the action that causes it.
- It is sent from there, exactly once, by a sender that retries at least every 10 seconds.
- A message queued while mail is down is delivered within 30 seconds of mail returning.
- `<origin>` is the scheme, host and port of the request that caused the message.

| Message | To | Subject | Body includes |
|---|---|---|---|
| Invite | the new member | `You're invited to <station name> on Furrowbook` | the member's name, their role, and the link `<origin>/invite/<token>` |
| Export ready | the member who started the export | `Your export of <workbook name> is ready` | the file name and the link `<origin>/api/exports/<exportId>/download` |
| Season closed | each member whose role is lead in that station when the workbook locks | `Season closed: <workbook name>` | "<workbook name> closed at <local time>. Edits are no longer accepted. A trial lead can reopen it before it is archived." |

- A season-closed message is queued once per lock event, whether the lock came from the cutoff or from "Close season now".
- When mail is down, member creation still answers `201` with `"invite":"queued"`.

**Service status:**
- The server checks storage and mail at most every 10 seconds, and reports the result through `GET /api/status`.
- Neither service needs to be up at boot.

### Seed data (DP-01, DP-02, DP-03, DP-20, DP-24, DP-27, DP-31)

Every seeded person, station, variety and trial is invented. Every seeded member's password is `tally-field-2026`, and every seeded member is `active`.

Stations:

| Station | Time zone |
|---|---|
| Ridgeback Research Station | America/Chicago |
| Coldwater Extension Farm | America/Denver |

Members:

| Name | Email | Station | Role |
|---|---|---|---|
| Priya Raman | priya@ridgeback.example | Ridgeback | data_manager |
| Tomás Herrera | tomas@ridgeback.example | Ridgeback | lead |
| Dana Okafor | dana@ridgeback.example | Ridgeback | technician |
| Lee Vance | lee@ridgeback.example | Ridgeback | technician |
| Sam Ito | sam@ridgeback.example | Ridgeback | viewer |
| Wren Castillo | wren@coldwater.example | Coldwater | data_manager |
| Noor Haddad | noor@coldwater.example | Coldwater | lead |
| Jo Mbeki | jo@coldwater.example | Coldwater | technician |

**Workbook "2026 Soybean Variety Trial RB-SOY-26"** (Ridgeback, `in_season`, no cutoff). It has three entries in four replicates, a randomised complete block layout. Sheets in order: "Plots", "Analysis".

"Plots" sheet:
- Row 1 is bold text: A1 "Plot", B1 "Rep", C1 "Entry", D1 "Planted", E1 "Moisture %", F1 "Yield bu/ac", G1 "Adj. yield 13%", H1 "DAP".
- Rows 2 to 13 hold the values below. D is the date `2026-05-12` on every row.
- For each row r: G is the formula `=F<r>*(100-E<r>)/87`, and H is `=TODAY()-D<r>`.
- Formats: E, F and G use `0.0`, and H uses `0`.

| Row | A Plot | B Rep | C Entry | E Moisture % | F Yield bu/ac |
|---|---|---|---|---|---|
| 2 | 101 | 1 | RB-21 | 14.2 | 58.4 |
| 3 | 102 | 1 | RB-34 | 13.8 | 61.0 |
| 4 | 103 | 1 | Check AG-30 | 14.6 | 55.2 |
| 5 | 201 | 2 | RB-34 | 13.5 | 60.2 |
| 6 | 202 | 2 | Check AG-30 | 14.9 | 54.1 |
| 7 | 203 | 2 | RB-21 | 14.0 | 57.6 |
| 8 | 301 | 3 | Check AG-30 | 14.4 | 56.0 |
| 9 | 302 | 3 | RB-21 | 13.9 | 59.1 |
| 10 | 303 | 3 | RB-34 | 13.6 | 62.3 |
| 11 | 401 | 4 | RB-21 | 14.3 | 58.0 |
| 12 | 402 | 4 | RB-34 | 13.7 | 60.8 |
| 13 | 403 | 4 | Check AG-30 | 14.8 | 54.7 |

"Analysis" sheet:
- Row 1 is bold text: A1 "Entry", B1 "Mean adj. yield", C1 "Delta vs check".
- A2 "RB-21", A3 "RB-34", A4 "Check AG-30".
- B2 to B4: `=AVERAGEIF(Plots!$C$2:$C$13,A<r>,Plots!$G$2:$G$13)` for r = 2 to 4.
- C2 to C4: `=B<r>-$B$4`.
- B2:C4 use format `0.00`.
- One bar chart titled "Mean adjusted yield by entry", range `Analysis!A1:B4`, on the Analysis sheet.

**Workbook "2025 Nitrogen Rate Trial RB-N-25"** (Ridgeback, `locked`, cutoff `2025-10-20T17:00`). Sheet "Plots": A1 "Plot", B1 "N rate lb/ac", C1 "Yield bu/ac", then rows 101 / 0 / 142.3, 102 / 60 / 171.8, 103 / 120 / 186.4.

**Workbook "2026 Spring Wheat Trial CW-WHT-26"** (Coldwater, `in_season`, no cutoff). Sheet "Plots": A1 "Plot", B1 "Entry", C1 "Heading date", then row 2: 11, "CW-Glen", `2026-07-02`.

No versions, exports, share links, conflicts or invites exist at start. Each seeded workbook's `headSeq` is its seed op count, and the seed ops are authored by the station's data manager.

## Technical requirements

### Deployment (DP-53)

- Node.js 22 LTS with npm is available. Write the app in TypeScript.
- Provide `/app/run.json` with string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- `serve` starts one process that binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. That process serves both the browser app and the API.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` once the server accepts requests, whether or not storage or mail is up.
- Several instances may run at once on different ports against the same services, each with its own environment.

### Configuration and secrets (DP-59)

- Read these environment variables at start: `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`; `APP_PUBLIC_PORT`.
- No credential, URL or bucket name appears in source. None is ever sent to the browser, logged in a response, or embedded in built assets.

### Server boundary (DP-51, DP-54)

- **Same origin only:**
  - The app sends no cross-origin resource-sharing headers.
  - A state-changing request whose `Origin` header is present and differs from the app's own origin answers `403 cross_origin`.
  - The browser loads every script, style and font from the app's own origin.
- **Size limits:**
  - JSON request bodies over 1,000,000 bytes answer `413 payload_too_large` with `limit` 1000000.
  - Import limits are as stated in Business rules.
- **Never served:** source files, source maps of server code, `run.json`, package manifests, lockfiles, dependency folders, environment files or anything else outside the built browser assets. Requests for them answer 404.
- **Headers:**
  - Pages under `/s/` send `Referrer-Policy: no-referrer`.
  - All pages send `X-Content-Type-Options: nosniff`.
  - Share and download responses send `Cache-Control: no-store`.
- **Boot:**
  - If PostgreSQL is unreachable at boot, the server keeps retrying every 2 seconds and then serves.
  - If object storage or mail is unreachable at boot or later, the server starts and serves normally, with the behaviour from Services and the banner from Feedback states. It recovers on its own when they return, without a restart.

### Browser support and performance (DP-21, DP-55)

- Support the current Chromium, Firefox and WebKit at 375×812, 768×1024 and 1280×800.
- The workbook list is usable within 3 seconds of navigation.
- The seeded soybean workbook's grid accepts keyboard input within 3 seconds of navigation.
- A typed character appears in the cell within a tenth of a second.
- The budgets in Business rules apply.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, and the app is started only through it.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its version and licence.
- IF-03: Every shipped package and bundled font uses one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The app stores data only in the provided PostgreSQL database, object storage bucket and mail sink. There are no other databases, caches, embedded stores, or data files written to disk.
- IF-05: The provided service configuration and environment variable names are used unchanged, and no seeded service settings are edited.
- IF-06: A `package-lock.json` is committed, and the app makes no network calls at runtime other than to the configured services.

## Engineering standards

- The code is idiomatic TypeScript compiled in strict mode, with no `any` in domain code and no suppressed type errors.
- Names in the code match the domain terms in this brief: station, member, workbook, sheet, cell, op, batch, sequence, conflict, closure, depth, season, cutoff, version, restore, export, share link.
- Each domain rule is decided in exactly one place in the source: each season transition, each role gate, the edit check order, conflict detection, closure and depth, formula evaluation and its budgets (shared by server and browser), csv neutralisation, and the import limits.
- There is no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Every API error is produced through one error shape and one precedence order.
- Multi-step writes that span the database and object storage either fully complete or are fully undone, and the code shows where each undo happens.
- No feature, endpoint, setting or screen exists beyond this brief.
