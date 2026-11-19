# Saltmarsh Aero Software Tailboard

Tailboard is a compliance board for the continuing-airworthiness office of a regional airline. It turns every airworthiness directive and manufacturer service bulletin into one tracked thread per affected aircraft. Each thread shows when the work is due, who holds the work card, who inspected it, who countersigned it, and which revision of the directive it was signed under. When a directive is revised, the board shows how the new revision changes the fleet, step by step and in one place. Build it for the five roles described below, using three backend services: Postgres as the system of record, MinIO for directive documents, inspection evidence and regulator compliance packs, and Mailpit as the outgoing mail sink for regulator packs and staff notices. The following are out of scope: self-service accounts and password reset, work orders and parts or stock control, flight scheduling, any datastore other than the Postgres and MinIO you are given, and any call to a third-party origin at runtime. People sign in only as the seeded users.

## Problem and users

At a regional airline flying 40 to 60 turboprops and regional jets, a small continuing-airworthiness office of planners and records clerks has to turn every regulator directive and manufacturer bulletin into finished, signed work on every affected tail number. Applicability depends on aircraft model and manufacturer serial number (MSN) ranges. Each directive is due at whichever comes first: a calendar date or a flight-hours threshold. Directives get revised. A new revision supersedes the old one and sometimes credits work already done, sometimes not. Today the truth lives in one spreadsheet tab per directive, kept next to a large maintenance suite that handles work orders well and handles change badly. When a revision lands, someone re-scopes tails by hand, re-keys limits, chases signatures and rebuilds the compliance pack for the authority, and the spreadsheet and the maintenance record drift apart. The airline pays three ways. A missed supersession or an overrun hours limit grounds an aircraft at the gate. An audit finding against the maintenance approval threatens the operating certificate. And at every revision and every audit, people spend days reconciling records instead of planning work.

The users:

- **Compliance planner** (daily). Ingests directives and revisions, confirms which tails are affected, records deferrals within the published grace, logs flight hours, and keeps the fleet board showing what is due next.
- **Licensed inspector** (daily, staff or contractor). Claims the open work card for one tail and one directive, attaches evidence, and signs the inspection first.
- **Certifying engineer** (daily). Countersigns completed work, only for aircraft models inside their current certification scope. The countersignature binds to the exact directive revision.
- **Records clerk** (weekly). Migrates spreadsheet-era compliance history, reopens wrongly closed records, records changes to certification scopes as the quality department issues them, processes contractor erasure requests, and sends the signed compliance pack to the authority.
- **Regulator auditor** (occasional). Reads the fleet's compliance state and history as it stood under each revision, and can change nothing.

## Journeys

1. **A new directive reaches the board.** Start: compliance planner Avery Lund is signed in and the board shows the four seeded directives. Avery opens "New directive", picks the authority, types the number and title, sets the effective date, the calendar limit in days, the flight-hours limit and the method of compliance, adds one or more model and serial ranges, attaches the directive PDF and ingests it. End: a new column appears under its authority in the left rail. Every affected tail has an Open cell with two limit rails and a "CAL governs" or "FH governs" tag, and the fleet counts above the matrix rise by the number of new cells. Avery then defers one open cell on the UK CAA directive with a reason. The cell shows Deferred and its new due date, and the Deferred count goes up by one.
2. **A revision lands mid-week.** Start: Avery has the board open. Noor Haddad, the second planner, ingests R2 of EASA 2026-0142 from another browser. R2 widens the serial range, drops one tail and credits prior work. End: on both boards the column header splits, the old tag slides into a ribbon behind the header, and the cells re-thread top to bottom. Open cells redraw their rails to the new limits. The two certified cells keep their old gauge with a "signed under R1" tab, newly affected tails drop in as Open cells, and the dropped tail collapses to a hatched stub. Then the counts roll to the recounted totals. Avery opens a retargeted cell, reviews the new limits and confirms effectivity with a reason.
3. **Night shift on one card.** Start: inspectors Dara Okafor and Sol Brennan are both signed in on tablets, looking at the open cell for G-FNAF on EASA 2026-0142. Both press "Claim work card" at the same moment. End: one of them holds the card. The other sees who holds it. The holder attaches a photo, enters the method reference and findings, and signs the inspection. When the hangar Wi-Fi drops and the tablet retries, the drawer still shows exactly one inspection signature, and the certifier gets exactly one countersignature request.
4. **Countersignature and succession.** Start: G-FNAC on EASA 2026-0142 is inspected and awaiting certifying engineer Ines Varga. Records clerk Robin Achterberg removes the ATR 72 from Ines's scope while Ines presses "Countersign". End: Ines's countersignature is refused with the out-of-scope message. Sol's inspection signature still stands. The sign-off chain now shows the thread awaiting Tomasz Wilk, and Tomasz has a "Countersignature passed to you" email. Tomasz countersigns and the cell turns Complied.
5. **Spreadsheet history comes in.** Start: Robin has the old compliance spreadsheet exported as CSV. Robin opens "Import history" and chooses the file. End: the result panel shows how many rows merged into existing threads, how many were duplicates, and a table of orphan rows with the reason each one failed to match. Matching cells gain legacy records in their history. Importing the same file again reports that nothing changed, and the counts do not move.
6. **Correction, erasure and the pack.** Start: Robin learns that G-FNAB was closed against the wrong work. Robin reopens the thread with a reason, and the drawer shows the same work card and evidence with the old signatures marked void. Robin then processes contractor Mika Hollis's erasure request, sends the compliance pack for EASA 2026-0142 while mail is down, and watches the Packs table. End: the pack sits in "Queued" and moves to "Transmitted" by itself once mail is back. The authority mailbox holds exactly one pack email. No surface shows Mika's name or licence number any longer. Where Mika signed, an anonymised signer token appears instead.
7. **The auditor's view.** Start: regulator auditor Casey Moreau signs in after R2 has superseded R1. Casey opens the ribbon behind the EASA 2026-0142 header and chooses "View under R1". End: the column shows each tail as it stood when R1 was superseded, read-only. Casey reads the audit trail and downloads the transmitted pack. No claim, sign, defer, import, reopen or erase control appears for this role, and the server refuses each of those actions anyway.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** The app installs, builds and serves from the run manifest and answers the health check, as specified in Deployment.
- **DP-02 — Service credentials from the environment** Every service URL and credential is read from the environment variables listed in Configuration and secrets, and none is hard-coded or sent to the browser.
- **DP-03 — Schema and seed applied on every start** Each start applies the schema and the seed data idempotently, so a freshly emptied database and bucket come up with exactly the records in Seed data.
- **DP-04 — Starts and serves with a dependency down** With object storage or mail unreachable at boot, the app still starts, answers the health check and serves the board, and recovers as qualified in Server boundary.
- **DP-05 — Server boundary and request limits** The server enforces the body-size, content-type, same-origin and never-served rules in Server boundary.
- **DP-06 — One error shape and precedence** Every API error uses the single error body and the single precedence order defined in API.
- **DP-07 — Seeded sign-in and sessions** Seeded users sign in with their passcodes and get a session cookie, and an ended session answers as unauthenticated on its next request.
- **DP-08 — Role permissions enforced by the server** Every write action is accepted only from the roles that the Business rules permission table names, and every other role is refused by the server.
- **DP-09 — Regulator auditor is read-only** The regulator auditor can read every board, thread, pack, export, notice and audit entry, and every write action from that role is refused by the server.
- **DP-10 — Ingest a new directive** A planner ingests a directive with its PDF stored in object storage, and one thread is created for each tail inside its model and serial effectivity.
- **DP-11 — Due instant and due-soon window** Each thread's due instant and due-soon start follow the time rules in Business rules, judged by the server clock.
- **DP-12 — Governing limit and limit rails** Each thread reports which limit governs and how much of each limit is used, as defined in Business rules.
- **DP-13 — Planner adds a directive from the board** In the browser, a planner fills the "New directive" dialog and the new column appears with Open cells and raised counts.
- **DP-14 — Supersession retargets one thread per lineage** Ingesting a superseding revision moves each existing thread to the new revision in place, never creates a second thread for the same tail and directive, and appends the old revision to the thread's history.
- **DP-15 — Closed records stay pinned to their revision** A thread closed before the new revision's effective date, under a revision that credits prior work, keeps the limits, method and wording it was signed under on every surface.
- **DP-16 — Effectivity changes on a new revision** Tails that enter effectivity get new open threads, and tails that leave become not-applicable stubs that keep their full history.
- **DP-17 — Supersession reaches every surface in one step** After a revision ingest commits, the board, threads, search, counts, regulator export and queued notices all reflect the new revision on the very next read.
- **DP-18 — Revision splice animation** On every open board, a superseding revision plays the revision splice described in Motion and effects and ends with every cell matching the server.
- **DP-19 — Reduced-motion splice summary** With reduced motion requested, the column swaps to its final state without movement, and the Revision changes banner gives the splice counts as filter links.
- **DP-20 — A colleague's revision splices live** When one planner ingests a revision, a second planner's open board plays the splice and shows the recounted totals without a reload.
- **DP-21 — Effectivity confirmation** A planner confirms or rejects each retargeted thread's effectivity before any further work is allowed on it.
- **DP-22 — Withdrawn directive placeholder** Withdrawing a directive leaves a placeholder column with full history, no open work and no counted cells.
- **DP-23 — Single holder per work card** Of any number of simultaneous claims on one work card, exactly one wins, and every other claim gets the published conflict naming the holder.
- **DP-24 — Evidence attached to the thread** The card holder attaches photos or scans that are stored in object storage by content and listed on the thread.
- **DP-25 — Inspection signature bound to a revision** The card holder's inspection signature records the exact revision the inspector signed under and is refused if the thread has since moved to another revision.
- **DP-26 — Replayed requests return the original result** A claim, sign, defer, import or pack request replayed with the same idempotency key returns the original response and records nothing new.
- **DP-27 — Inspector works a card in the drawer** In the browser, an inspector claims a card, attaches evidence and signs the inspection, and the drawer shows the signature and the assigned certifier.
- **DP-28 — Server decides on time or overdue** Every inspection signature is judged on time or overdue by the server clock under the inclusive-edge rule, whatever the client sends.
- **DP-29 — Flight-hours log** A planner logs sector hours against a tail, and every thread on that tail recomputes its hours rail, due-soon state and overdue state from the new total.
- **DP-30 — Deferral within the published grace** A planner can defer an open thread once per revision, before its due instant, which extends its limits by the published grace.
- **DP-31 — Countersignature checked against scope at commit** A countersignature is accepted only from a certifying engineer whose current scope covers the tail's model at the moment it commits, and a scope change applies on the next request.
- **DP-32 — Scope changes and certifier succession** When a scope change removes a model, each thread awaiting that engineer passes to the next covering engineer on the model's standby list, or shows that it is awaiting a certifier.
- **DP-33 — Certifier closes a thread from the drawer** In the browser, a certifying engineer countersigns an inspected thread and the cell turns Complied.
- **DP-34 — Fleet board counts equal a recount** The board's per-directive and fleet counts always equal a fresh recount of the thread states, as defined in Business rules.
- **DP-35 — Live board feed** Every signed-in board receives thread and revision changes from the server's event stream within the delay stated in Business rules.
- **DP-36 — Fleet search** Search finds directives, threads and people by the fields in Business rules and always shows each directive's current revision.
- **DP-37 — Status shown by glyph, text and contrast** Each thread status on the board has its own glyph and text label as well as colour, at the contrast stated in Feedback states.
- **DP-38 — Legacy import matching** Imported spreadsheet rows match threads by normalised tail, directive and revision, as published in Business rules, and matched rows merge into thread history.
- **DP-39 — Orphans and rejected rows reported** Every unmatched row is reported as an orphan with its reason, and every malformed row is reported as rejected with its field.
- **DP-40 — Re-import creates nothing** Importing the same file again returns the earlier result and changes no record and no count.
- **DP-41 — Clerk imports history in the browser** In the browser, a records clerk imports a CSV file and sees the merged, duplicate, orphan and rejected results.
- **DP-42 — Exact restore of a wrongly closed thread** A records clerk's reopen returns a certified thread to work with the same work card, holder and evidence objects, and keeps its prior signatures as void with history.
- **DP-43 — Contractor erasure** A records clerk's erasure replaces a contractor's name and licence number with a stable anonymised signer token, while signatures, evidence objects and audit entries survive.
- **DP-44 — Erasure reaches every copy** After an erasure, the person's name and licence number appear nowhere in search, exports, stored packs, queued notices or pack emails sent after the erasure, and mail already delivered is not altered.
- **DP-45 — Queued notices** Staff notices wait in a visible queue for the hold period, and a supersession or erasure that lands meanwhile rewrites or withdraws them before they are sent.
- **DP-46 — Compliance pack stored and emailed** A records clerk's pack request stores the pack PDF and CSV manifest under content-addressed keys and emails the authority once, with the link and checksums.
- **DP-47 — Pack is all or nothing** A pack is stored, emailed and marked transmitted together, or none of the three happens.
- **DP-48 — Pack queued through an outage** A pack requested while object storage or mail is down waits as queued and goes out by itself, exactly once, after the service returns.
- **DP-49 — Regulator CSV export** The regulator CSV export and the pack manifest neutralise every cell that a spreadsheet could read as a formula, under the published rule.
- **DP-50 — Clerk sends a pack from the browser** In the browser, a records clerk sends a compliance pack and sees it listed as queued or transmitted, with the status changing without a reload.
- **DP-51 — Board as it stood under a revision** Any role can read a directive's column exactly as it stood when a prior revision was superseded.
- **DP-52 — Append-only audit trail** Every state change writes one attributed audit entry, and entries can never be edited or deleted through the API.
- **DP-53 — Auditor reviews a prior revision** In the browser, the regulator auditor views a column under its prior revision and reads the audit trail, and sees no write controls.
- **DP-54 — Three panes across viewports** The board uses the three-pane layout at 1280 by 800 and the adapted layouts at 768 by 1024 and 375 by 812, with no horizontal page overflow.
- **DP-55 — Thread drawer contents** The thread drawer shows the work card, the sign-off chain and the revision history ribbon, with the controls for the signed-in role.
- **DP-56 — Keyboard and focus** Every control works from the keyboard in the published tab order, and dialogs and the full-screen drawer trap focus, close on Escape and return focus.
- **DP-57 — Feedback states** Every async action shows its pending, success, error and outage copy and announces it through the named live regions.
- **DP-58 — Visual direction** The board follows the visual design: a near-black instrument panel, one amber caution accent, hairline rules, condensed headings and tabular right-aligned figures.
- **DP-59 — Revision splice craft** The revision splice reads as one connected change to a single column, ending in a still, legible state.
- **DP-60 — Open work survives a board refresh** A board refetch from the live feed or the 60-second timer updates the matrix, counts and rail in place without closing or resetting an open "New directive" dialog, its typed values, the focused element and its caret or the matrix scroll, and each board plays a given splice at most once.
- **DP-61 — A colleague's decision reaches open drawers** When a planner confirms effectivity, marks a thread not applicable or withdraws a directive, every other signed-in board updates the affected cells, counts, rail and any open drawer for those threads in place within the live-feed delay, and removes the controls the new stage no longer allows.
- **DP-62 — The losing claimant sees the holder** When one inspector wins a work card, every other signed-in board showing that thread's drawer replaces the claim control with the holder in place within the live-feed delay, and a stale claim that still reaches the server gets the published conflict.

## Frontend

### Screens and layout (DP-54, DP-55)

**Sign-in screen.** A single centred form on the dark ground with the product name above it.

**Board screen.** Signed-in users land here. It has a top bar, a left rail, a centre matrix and a right drawer.

- The **top bar** shows the product name, the fleet search box, the section links (Board, Packs, People, Audit), the signed-in person's display name and role label, and "Sign out". Planners see "New directive". Records clerks see "Import history".
- The **left rail** lists directives grouped under headings by issuing authority, in this order: EASA, UK CAA, ATR, De Havilland, Embraer. Each entry shows the directive number and its current revision tag. A withdrawn directive stays in the rail with the word "withdrawn" after its tag.
- The **centre matrix** has one row per tail, ordered by registration, and one column per directive, in rail order. Above the matrix sit the five fleet counts. Each column header shows the directive number, the revision tag, the title in one truncated line, and that column's five counts in small figures. Behind each header that has prior revisions sits a thin ribbon holding the earlier tags. Each cell holds a two-rail limit gauge (calendar on top, flight hours below), the status glyph and label, the revision tag as visible text, and the governing text. A tail that was never in a directive's effectivity has an empty cell with no content. Clicking a tail's row header opens the tail panel, which shows total hours and, for planners, the hours log form.
- The **right drawer** opens the thread for one tail and one directive. Top to bottom it shows:
  - the thread heading;
  - the state and governing limit;
  - the limits in force: effective date, deadline date, hours threshold, and whether a deferral applies;
  - the method of compliance and the title as worded in the governing revision;
  - the **work card**: card id, holder, claimed time, and the attached evidence as a list with one row per evidence object. An evidence upload is a raw body that carries no file name, so no row shows one: each row gives the object's content type, its size in bytes and its sha256;
  - the **sign-off chain**: each signature in commit order with kind, signer, licence, revision, time, on-time or overdue, and its status (valid, superseded or void, with the reason). The chain ends with the assigned certifier and either "awaiting countersignature" or "awaiting certifier";
  - the **revision history ribbon**: one entry per revision the thread has lived under, oldest first, each with its limits, wording, outcome and any legacy records;
  - the action controls for the signed-in role.

**Packs screen.** A table of compliance packs, newest first. Records clerks see a directive picker and "Send compliance pack" above it. Its Status column refreshes on the interval published under Packs in Business rules, with no reload.

**People screen.** A table of every user with role, staff or contractor, licence and scope. Records clerks see "Erase" on contractor rows and "Edit scope" on certifying engineer rows.

**Audit screen.** A table of audit entries, newest first, filterable by directive.

**Viewports.** At no viewport does the page itself scroll sideways. The matrix scrolls inside its own region, both ways, with the tail column and header row staying in view.

- **1280 by 800.** All three panes show side by side. The rail is a narrow fixed band on the left. The drawer, when open, takes about a third of the width on the right and the matrix narrows to make room.
- **768 by 1024.** The rail folds behind a "Directives" button and opens as an overlay panel from the left. The matrix uses the full width. The drawer opens as an overlay from the right, covering about two thirds of the width.
- **375 by 812.** The rail folds behind the "Directives" button. The matrix shows one directive at a time, chosen with the "Directive" picker, as a single column of cells beside the registrations. The drawer and all dialogs open full screen. The section links move into a "Menu" button.

### Public screens and controls (DP-13, DP-27, DP-33, DP-41, DP-50, DP-53, DP-55)

Only these roles, names and copies are public. Everything else about the markup is up to you. `<directive>` is the authority name and the published number joined by a space (for example "EASA 2026-0142"). `<tag>` is "R" followed by the revision number (for example "R2"). `<registration>` is the tail's display registration (for example "G-FNAA"). `<display name>` is the person's display name, or their signer token after erasure.

| Role and accessible name | Visible copy / notes |
|---|---|
| `form "Sign in"` | Contains `textbox "Username"`, `textbox "Passcode"` (masked) and `button "Sign in"` |
| `banner` | "Tailboard", `<display name>`, the role label, `button "Sign out"` |
| `navigation "Sections"` | `link "Board"`, `link "Packs"`, `link "People"`, `link "Audit"`; inside `button "Menu"` at 375 wide |
| `searchbox "Search fleet"` | Placeholder "Tail, directive, person or licence" |
| `list "Search results"` | One `link` per result, named by its label |
| `navigation "Directives"` | One `heading` (level 2) per authority; one `link "<directive> <tag>"` per directive; `button "Directives"` opens it at 768 and 375 wide |
| `button "New directive"` | Planners only |
| `button "Import history"` | Records clerks only |
| `combobox "Directive"` | 375 wide only; picks the column shown. Each option is named "<directive> <tag>", carrying the lineage's current tag |
| `group "Fleet counts"` | Five texts: "Open <n>", "Due soon <n>", "Overdue <n>", "Deferred <n>", "Complied <n>" |
| `region "Fleet board"` | Contains the counts and the matrix |
| `grid "Compliance matrix"` | `aria-busy` is "true" while a splice plays and "false" otherwise |
| `columnheader "<directive> <tag>"` | Contains that column's counts and `button "Directive actions <directive>"` |
| `menu` from Directive actions | `menuitem "Ingest revision"` (planner), `menuitem "Send compliance pack"` (records clerk), `menuitem "Export CSV"` (all), `menuitem "Withdraw directive"` (planner) |
| `dialog "Withdraw <directive>"` | Opened by Withdraw directive. `textbox "Withdrawal reason"`, `button "Withdraw"`, `button "Cancel"` |
| `button "View under <tag>"` | One per prior revision, in the ribbon behind the header |
| `status "Viewing prior revision"` | "Viewing <directive> as it stood under <tag>. Read-only." with `button "Back to current"` |
| `rowheader "<registration>"` | Opens `dialog "Tail <registration>"` |
| `gridcell` | Named "<registration> <directive> <tag>: <label>", followed by ", <governing text>" when a limit governs and ", signed under <pinned tag>" when pinned. `<label>` and the governing text come from Feedback states. Each thread cell contains its status glyph as `img "<label>"`, and each cell with live limits contains `meter "Calendar limit used"` and `meter "Flight-hours limit used"`, each with a value from 0 to 100. A pinned cell shows the visible tab "signed under <pinned tag>". A not-applicable or withdrawn stub contains `link "Thread history"` |
| `status "Revision changes"` | The splice summary banner with its count links (copy in Feedback states) and `button "Dismiss"` |
| `status "Board filter"` | "Showing <n> <category> cells from <tag>" with `button "Clear filter"` |
| `dialog "New directive"` | `combobox "Authority"`, `textbox "Directive number"`, `textbox "Title"`, `textbox "Effective date"`, `spinbutton "Calendar limit in days"`, `spinbutton "Flight-hours limit"`, `textbox "Method of compliance"`, `group "Applicability"`, the file input labelled "Directive document", `button "Ingest"`, `button "Cancel"` |
| `dialog "Ingest revision <directive>"` | Same fields without Authority and Directive number, plus `checkbox "Credit work done under the prior revision"` |
| `group "Applicability"` | Per range: `combobox "Model"`, `spinbutton "First serial"`, `spinbutton "Last serial"`, `button "Remove range"`; then `button "Add range"` |
| `dialog "Thread <registration> <directive>"` | The drawer. Its first element is the drawer heading: a `heading` at level 2 whose name is "Thread <registration> <directive>", the same text that names the dialog, and it accepts focus when the code moves focus to it. Then `region "Work card"`, `list "Sign-off chain"`, `list "Revision history"`, `button "Close thread panel"`. The dialog is modal at 375 wide, where it opens full screen, and non-modal at 1280 and 768 wide, as Interactions sets out |
| Drawer controls, by role and state | `button "Claim work card"`, `button "Release work card"`, file input labelled "Attach evidence", `textbox "Method reference"`, `textbox "Findings"`, `button "Sign inspection"`, `button "Countersign"`, `textbox "Deferral reason"`, `button "Defer"`, `textbox "Effectivity reason"` (sent with both effectivity buttons), `button "Confirm effectivity"`, `button "Mark not applicable"`, `textbox "Reopen reason"`, `button "Reopen thread"` |
| `dialog "Tail <registration>"` | Total hours; for planners `spinbutton "Sector hours"` and `button "Log hours"` |
| `dialog "Import history"` | File input labelled "History file", `button "Import"`, `region "Import result"` holding `table "Orphan rows"` and `table "Rejected rows"` |
| `table "Compliance packs"` | Columns Directive, Revision, Status, Requested, Transmitted, PDF checksum. Status text is "Queued" or "Transmitted" |
| `button "Send compliance pack"` | Records clerks, Packs screen, with `combobox "Pack directive"`, whose options are named "<directive> <tag>" as the Directive picker's are |
| `table "People"` | `button "Erase <display name>"` on contractor rows; `button "Edit scope <display name>"` on engineer rows (records clerks only) |
| `dialog "Erase contractor"` | `textbox "Erasure reason"`, `button "Erase"`, `button "Cancel"` |
| `dialog "Certification scope <display name>"` | `checkbox "ATR 72"`, `checkbox "Dash 8-400"`, `checkbox "E175"`, `button "Save scope"` |
| `table "Audit trail"` | Columns Time, Actor, Action, Thread, Detail; `combobox "Audit directive"` filter, whose options are named "<directive> <tag>" as the Directive picker's are |
| `status "Action status"` | Polite; pending and success copy |
| `alert "Action error"` | Assertive; error and outage copy |
| `status "Live updates"` | Polite; live feed copy |

Write controls appear only for the roles that may use them. Hiding a control never replaces the server's refusal.

### Interactions (DP-13, DP-20, DP-27, DP-33, DP-41, DP-50, DP-53, DP-56, DP-60, DP-61, DP-62)

- **Cells.** Clicking or tapping a cell opens its drawer. If a drawer is already open, it swaps to the new thread in place. The selected cell gets a lavender outline.
- **Grid keyboard.** The grid is a single Tab stop. Arrow keys move between cells and row headers, Home and End jump to the ends of a row, and Enter or Space opens the focused cell's drawer.
- **Tab order.** On the board, Tab goes in this order: top bar (search, section links, role buttons, "Sign out"), then the directive rail, then the fleet counts, then the grid, then the open drawer.
- **Escape and focus return.** Escape closes the topmost open dialog, menu or drawer and returns focus to the control or cell that opened it. Dialogs and the full-screen drawer are modal: they trap focus while open, so Tab and Shift+Tab wrap inside them and reach nothing behind them. The drawer is modal only where it opens full screen, which is 375 wide. At 1280 and 768 wide the drawer is a **non-modal** dialog: it carries the `dialog` role and closes on Escape, but it does not trap focus, so Tab leaves it for the rest of the page and comes back to it in the published tab order, which puts it last. A focus-trap check on the drawer therefore belongs at 375 wide. At 768 wide the drawer covers about two thirds of the matrix, and the page behind it stays reachable by Tab even so: Tab still walks the top bar, the rail, the fleet counts and the grid, including the covered cells, and reaches the open drawer last, exactly as the published tab order says. Nothing behind the drawer is removed from the tab order at 1280 or 768 wide.
- **Directive actions.** The Directive actions button opens its menu. Arrow keys move through it, Enter chooses, and Escape closes it back to the button. "Withdraw directive" opens the Withdraw dialog, and "Withdraw" submits its reason.
- **Ingest dialogs.** "Ingest" submits the dialog and keeps it open until the server answers. A success closes it and the splice plays. Field errors appear under their fields, and focus moves to the first field in error.
- **Signing.** "Sign inspection" sends the revision tag the drawer is showing. If the thread has moved, the drawer reloads with the new limits and the revision-changed copy from Feedback states.
- **Retries.** Every claim, sign, defer, import and pack request carries a fresh idempotency key, made once per press. If the network drops, the UI retries up to three times within about ten seconds with the same key.
- **Board refresh.** The board refetches whenever the live feed reports a change, and at least once every 60 seconds. So a due-soon or overdue label changes within 60 seconds of crossing its limit.
- **Search.** Search runs as the user types two or more characters, after a pause of about a quarter of a second. Choosing a result opens the matching drawer, column or People row.
- **Splice summary links.** Each count link in the Revision changes banner filters the matrix to that category's cells. "Clear filter" restores the full matrix.
- **Prior revisions.** "View under <tag>" turns the column into its prior-revision snapshot and hides every write control in it. "Back to current" returns to the live column.
- **Touch.** At 768 and 375 wide, a swipe toward the edge closes the drawer, and every tap target is at least 44 px in both directions.
- **Open work survives a refresh (DP-60).** A board refetch, from the live feed or the 60-second timer, updates the matrix, the counts and the rail in place. It never closes or re-creates an open dialog or drawer. These survive it unchanged: every value typed into "New directive", including each added Applicability range and the chosen file; the focused element and its caret position; and the matrix scroll offsets in both directions. While "Ingest" is pending the dialog stays open showing its pending copy, even when the live feed reports that same ingest before the server answers. Each board plays a given splice at most once, for one directive and one new tag, whether it learns of it from its own response or from the live feed, so the grid reports itself busy at most once for it and the Revision changes banner holds exactly one summary.
- **A colleague's decision reaches open drawers (DP-61).** When a planner confirms effectivity, marks a thread not applicable or withdraws a directive, every other signed-in board updates within the live-feed delay, with no reload: the affected cells, the column and fleet counts, the rail entry, and any open drawer for those threads. The drawer stays open on the same thread and shows the new state and label. It loses the controls the new stage no longer allows: "Effectivity reason", "Confirm effectivity" and "Mark not applicable" after a colleague's decision, and every write control after a withdrawal. If the control that had focus is gone, focus moves to the drawer heading and never to the page body. A press that still reaches the server afterwards gets the published refusal for that action, its copy from Feedback states appears in `alert "Action error"`, and the drawer refetches in place. After a withdrawal that refusal is `directive_withdrawn`, except for release, attach evidence and sign inspection, where the withdrawal has already cancelled the hold, so the refusal is `not_holder` with its own copy.
- **The losing claimant sees the holder (DP-62).** When one inspector wins a work card, every other signed-in board showing that thread's drawer updates within the live-feed delay, with no reload: the drawer stays open on the same thread, `button "Claim work card"` is gone from it, and the work card line names the holder. If "Claim work card" had focus, focus moves to the drawer heading and never to the page body. A stale "Claim work card" press from another inspector that still reaches the server gets the published `card_held` conflict with its holder, its copy from Feedback states appears in `alert "Action error"`, and the drawer refetches in place.

### Visual design (DP-58)

- **Colour.** The ground is a near-black with a faint cool blue cast. Text is a cool off-white ink. Hairline rules in a dark slate separate the rail, the matrix, the drawer, every row and every column. There are no cards, shadows or rounded panels. One warm amber is the only caution accent, and it marks the most urgent thing in view: overdue status. Any one cell has at most one amber element. A soft lavender is the secondary colour, used for links, keyboard focus rings, the selected cell outline, due-soon status and the splice ribbon.
- **Contrast.** Body text meets WCAG 2.2 AA contrast of at least 4.5 to 1 against the ground. Glyphs, rails, notches and focus rings meet at least 3 to 1.
- **Type.** Headings, column headers and revision tags use IBM Plex Sans Condensed. Body text uses IBM Plex Sans. Every number (hours, dates, counts, serials, checksums) is in IBM Plex Mono with tabular figures and right-aligned in its column. Each heading step is about one fifth larger than the step below it, from body text up to the screen title. All fonts are served from the app itself.
- **Density.** The board is compact: rows are tight enough that 20 or more tails fit in the 1280 by 800 view.
- **Gauge.** Each cell's gauge is two thin horizontal rails. The filled length shows how much of the limit is used. A small filled notch at the right end of the governing rail sits next to the governing text.
- **Stubs and tabs.** Not-applicable and withdrawn stubs are hatched with diagonal lines in the rule colour. Pinned "signed under" tabs are small lavender-edged labels attached to the cell's top edge.
- **Icons.** Icons are simple outline shapes drawn in the ink colour. Gauges, stubs and hatches are drawn as vector graphics.

### Motion and effects (DP-18, DP-19, DP-59)

Every movement on screen means something, starts quickly and settles softly, and never loops. There are no unnamed decorative loops or ambient animation anywhere, including spinners. Pending states use text.

- **Hover and press.** A row, cell or button tints slightly lighter in about a tenth of a second and returns at the same pace.
- **Drawer and dialogs.** The drawer slides in from the right in about a quarter of a second and leaves in about a tenth of a second. Dialogs fade and rise slightly over about a quarter of a second.
- **Ordinary updates.** When a live update changes a single cell outside a splice, its status glyph and rails cross-fade in about a tenth of a second.
- **Revision splice** (the signature interaction). It runs on every open board when a superseding revision arrives, from the ingesting planner's own action or from the live feed, and in this order:
  1. The column header splits along its middle. The old tag slides down into the thin ribbon behind the header while the new tag slides into its place, over about a quarter of a second.
  2. The column's cells re-thread top to bottom in registration order, each row starting about three hundredths of a second after the row above. Only the first 24 rows animate. Any rows below them snap to their final state as the 24th row starts.
  3. As each row re-threads:
     - open-work cells redraw both rails from their old lengths to the new ones, and the governing notch and text move to whichever rail now governs;
     - pinned cells keep their old gauge and gain the "signed under" tab, which drops in from the top edge;
     - newly affected tails drop in from slightly above as new Open cells;
     - tails leaving effectivity collapse sideways into their hatched stub.
  4. When the last animated cell settles, the column counts and fleet counts roll digit by digit to the recounted totals over about four tenths of a second.

  From the moment the board receives the revision to the moment the counts finish, the whole splice takes no more than 1.4 seconds. The grid reports itself busy for that span. At the end, every cell's tag, label, rails and notch equal the server's thread state for that tail and directive. The splice is time-driven, not scroll-linked, and it plays forwards once. Viewing a prior revision and returning swaps the column in one frame and does not replay it.
- **Reduced motion.** When the operating system asks for reduced motion, nothing moves. The column swaps to its final state in one frame, the grid is never reported busy, and counts change in one frame. Pinned tabs and hatched stubs appear exactly as they do in the animated version. The Revision changes banner carries the summary in both modes; with reduced motion it is the only cue.

### Feedback states (DP-37, DP-57)

**Status display.** Each cell's status is shown by a glyph and a text label as well as colour, so no status relies on colour alone. The glyph is the `img` named in Public screens and controls. The label is chosen by this precedence: Withdrawn, Not applicable, Complied, Overdue, Superseded, Deferred, Due soon, Open.

| Label | Glyph | Colour | When |
|---|---|---|---|
| Open | Hollow circle | Ink | Open-work stage, not due soon, not overdue |
| Due soon | Clock face | Lavender | Open-work stage inside the due-soon window |
| Overdue | Warning triangle | Amber | Reported state is overdue |
| Deferred | Two vertical pause bars | Muted ink | Stage deferred and not overdue |
| Complied | Check mark | Dimmed ink | Stage certified |
| Superseded | Two arrows crossing | Lavender, dashed cell outline | Stage superseded_retargeted and not overdue |
| Not applicable | Hatched stub | Rule colour | Stage not_applicable |
| Withdrawn | Struck-through line | Rule colour | Stage withdrawn |

The governing text is "CAL governs" or "FH governs". All label and glyph colours meet the contrast thresholds in Visual design.

**Live regions.** Pending and success copy goes to `status "Action status"`. Errors and outages go to `alert "Action error"`. The splice summary goes to `status "Revision changes"`. The live feed state goes to `status "Live updates"`.

**Placeholders.**
- `<card>` is the work card id.
- `<holder>` is the holder's display name.
- `<current>` is the thread's or directive's current tag.
- `<due>` is the new due date as YYYY-MM-DD.
- `<model label>` is "ATR 72", "Dash 8-400" or "E175".
- `<total>` is the tail's total hours with one decimal.
- `<service>` is "object storage" or "mail".
- `<token>` is the signer token.
- `<n>` is a count, and `<category>` is retargeted, added, removed or kept.

**Copy by action.**

| Action | Pending | Success | Errors and outage |
|---|---|---|---|
| Sign in | "Signing in…" | (lands on board) | bad_credentials: "Username or passcode is wrong." |
| Any request after the session ended | — | — | Returns to sign-in showing "Your session has ended. Sign in again." |
| Any refused role action | — | — | forbidden: "Your role cannot do this." |
| Any drawer action on a thread of a withdrawn directive that the permission table does not gate on holding the card — claim, countersign, defer, confirm effectivity, mark not applicable or reopen | (the action's own pending copy) | — | directive_withdrawn: "<directive> is withdrawn." |
| Release, attach evidence or sign inspection pressed by an inspector who does not hold the card, including a former holder after a withdrawal cancelled every hold | (the action's own pending copy) | — | not_holder: "You no longer hold this work card." |
| Ingest directive or revision | "Ingesting <tag>…" | "<directive> <tag> ingested." plus the Revision changes banner | directive_exists: "<directive> is already on the board."; revision_out_of_order: "This directive is now at <current>. Reload and try again."; directive_withdrawn: "<directive> is withdrawn."; storage_unavailable, raised by the document upload the dialog sends before the ingest and never by the ingest itself: "Document storage is unavailable. Nothing was ingested."; validation: each field's message under its field, including `document_id` when the named document was never stored |
| Revision banner (superseding) | — | "<new tag> supersedes <old tag>: <n> retargeted, <n> added, <n> removed, <n> kept under <old tag>". Each "<n> <category>" phrase is a link | — |
| Revision banner (new directive) | — | "<directive> <tag> added: <n> added" with the link | — |
| Claim | "Claiming <card>…" | "Work card <card> is yours." | card_held: "Already held by <holder>."; effectivity_unconfirmed: "Waiting for the planner to confirm effectivity." |
| Release | "Releasing <card>…" | "Work card <card> released." | invalid_transition: "This card can no longer be released." |
| Attach evidence | "Uploading evidence…" | "Evidence attached." | storage_unavailable: "Evidence storage is unavailable. Nothing was attached."; payload_too_large: "That file is larger than 5,000,000 bytes." |
| Sign inspection | "Signing inspection…" | "Inspection signed under <tag>, on time." or "Inspection signed under <tag>, overdue." | revision_changed: "This thread moved to <current>. Review the new limits before signing." |
| Countersign | "Countersigning…" | "Countersigned under <tag>. Thread closed." | out_of_scope: "Your certification scope does not cover <model label>."; revision_changed (as above) |
| Defer | "Deferring…" | "Deferred. New due <due>." | past_due: "Too late to defer: the due instant has passed."; already_deferred: "Already deferred under <current>." |
| Confirm effectivity | "Saving…" | "Effectivity confirmed." or "Marked not applicable." | invalid_transition: "This thread no longer needs confirmation."; validation: the message under Effectivity reason |
| Log hours | "Logging hours…" | "<registration> now at <total> FH." | validation under the field |
| Import | "Importing…" | "Import finished: <n> merged, <n> duplicates, <n> orphans, <n> rejected." | Same file again: "This file was already imported. Nothing changed." |
| Reopen | "Reopening…" | "Thread reopened. Prior signatures kept as void." | invalid_transition: "Only a closed thread can be reopened." |
| Save scope | "Saving scope…" | "Scope saved. <n> threads passed on." | — |
| Erase | "Erasing…" | "<token> now replaces this contractor everywhere." | not_contractor: "Only contractor records can be erased."; already_erased: "This person was already erased." |
| Send pack | "Preparing pack…" | Transmitted: "Pack transmitted to the authority." Queued: "Pack queued: <service> is unavailable. It will go out automatically." | pack_already_queued: "A pack for <directive> is already queued." |
| Withdraw directive | "Withdrawing…" | "<directive> withdrawn. History kept." | directive_withdrawn (as above); validation: the message under Withdrawal reason |
| Keyed request with network lost | "Connection lost. Retrying with the same request." | (the action's success copy) | After the last retry: "Still offline. Nothing was confirmed. Press again to retry with the same request." |
| Live feed | — | Reconnected: "Live updates resumed." | Dropped: "Live updates paused. Reconnecting…" |

A press that is still being retried keeps the same idempotency key until it succeeds or the user presses again.

## Backend

### API (DP-06, DP-07, DP-08, DP-10, DP-23, DP-24, DP-25, DP-26, DP-29, DP-30, DP-31, DP-32, DP-34, DP-35, DP-36, DP-38, DP-42, DP-43, DP-46, DP-49, DP-51, DP-52)

**Conventions.**
- Every request and response body is JSON (`application/json; charset=utf-8`) unless a row says otherwise.
- Sign-in sets the session cookie `tb_session` (HttpOnly, SameSite=Strict, Path=/), and every endpoint except `POST /api/session` and `GET /api/health` requires it.
- Timestamps are ISO 8601 UTC with milliseconds and `Z`, for example "2026-11-02T14:03:22.418Z". Dates are `YYYY-MM-DD` in the operator's base time zone.
- Hours are JSON numbers with at most one decimal place. Ids are opaque strings. Revision tags are "R" plus the revision number.
- Model codes are `ATR72-212A`, `DHC-8-402` and `ERJ-170-200`.
- Role codes are `compliance_planner`, `licensed_inspector`, `certifying_engineer`, `records_clerk` and `regulator_auditor`.

**Error body.** Every error is `{"error":{"code":"<code>","message":"<sentence>"}}`. Extra keys go inside `error` where a row says so.

| Status | Code | Extra keys |
|---|---|---|
| 400 | `idempotency_key_required`, `idempotency_key_invalid` | — |
| 401 | `unauthenticated` | — |
| 403 | `forbidden` | — |
| 404 | `not_found` | — |
| 405 | `method_not_allowed` | — |
| 409 | `idempotency_mismatch` | — |
| 409 | `invalid_transition` | `stage`, `action` |
| 413 | `payload_too_large` | — |
| 415 | `unsupported_media_type` | — |
| 422 | `validation` | `fields`, an object of field name to message |
| 503 | `storage_unavailable` | — |

**Precedence.** One order covers the whole API, and the first failing check answers:
1. 413, then 415, then 405 `method_not_allowed` for a known path under a method it does not accept, then 404 `not_found` for an unknown `/api` path (Server boundary). All four are decided from the request line, its headers and the body size, before any session cookie is read;
2. 401; then, for a write request, 403 `forbidden` when the `Origin` header names an origin other than the app's (Server boundary), refused before any idempotency key is read and before any stored response is replayed;
3. 400 for a missing or malformed idempotency key on keyed endpoints;
4. an idempotent replay returns its stored response, or 409 `idempotency_mismatch`;
5. 404 for an unknown resource;
6. 403, in the order `forbidden`, `not_holder`, `out_of_scope`;
7. 409 state conflicts, in this order: `directive_withdrawn`, `effectivity_unconfirmed`, `revision_changed`, `card_held`, `past_due`, `already_deferred`, `directive_exists`, `revision_out_of_order`, `not_contractor`, `already_erased`, `pack_already_queued`, `pack_not_transmitted`, then `invalid_transition`;
8. 422 validation;
9. 503 for an unreachable dependency. Only an endpoint that reads or writes an object itself can answer 503: `POST /api/documents`, `POST /api/threads/{id}/evidence` and the pack PDF and CSV downloads. No other endpoint answers 503.

**Idempotency.**
- Keyed endpoints are claim, inspection, countersign, deferral, import and pack. They require the header `Idempotency-Key`: 1 to 100 printable ASCII characters.
- A key is scoped to the user, method and path, and is kept for 24 hours.
- A repeat with the same key and the same body returns the stored status and body, plus the header `Idempotent-Replayed: true`. A repeat with a different body answers 409 `idempotency_mismatch`.

**Shapes.**
- **Person** is `{"id","display_name","licence","erased"}`. After erasure, `display_name` is the token and `licence` is null.
- **User** is Person plus `{"username","role","contractor","email","scope"}`. `scope` is a list of model codes for certifying engineers and null otherwise. After erasure, `email` is null.
- **Counts** is `{"open","due_soon","overdue","deferred","complied"}`.
- **Limits** is `{"effective_date","calendar_days","deadline_date","calendar_due_at","fh_interval","fh_baseline","fh_threshold","deferred","due_at","due_soon_from"}`. `due_at` is never null. It is always the earlier known due instant: it equals `calendar_due_at` until the hours limit is passed, and from then on it is the earlier of `calendar_due_at` and the hours due instant.

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | — | 200 `{"status":"ok"}` | — |
| `POST /api/session` | anyone | `{"username","passcode"}` | 200 `{"user":User}` and sets the cookie | 401 `bad_credentials` (also for an erased person) |
| `GET /api/session` | signed in | — | 200 `{"user":User}` | — |
| `DELETE /api/session` | signed in | — | 204 | — |
| `GET /api/events` | signed in | — | 200 `text/event-stream` with events `revision` (data `{"directive_id","splice":Splice}`) and `threads` (data `{"thread_ids":[...]}`), and a comment line at least every 15 seconds | — |
| `POST /api/documents` | planner | Raw PDF body, `Content-Type: application/pdf` | 201 `{"document_id","key","sha256","bytes"}`; the same bytes again give 200 with the same `document_id` | 422 `fields.document` "must be a PDF" when the body does not start with `%PDF-`; 503 `storage_unavailable` |
| `GET /api/directives` | all roles | — | 200 `{"directives":[Directive]}` | — |
| `GET /api/directives/{id}` | all roles | — | 200 `{"directive":Directive}` | — |
| `POST /api/directives` | planner | `{"authority","number","title","document_id","effective_date","calendar_days","fh_interval","applicability":[{"model","msn_from","msn_to"}],"method"}` | 201 `{"directive":Directive,"splice":Splice}` | 409 `directive_exists`; 422 |
| `POST /api/directives/{id}/revisions` | planner | Same as above without `authority` and `number`, plus `"revision"` (integer) and `"prior_credit"` (boolean) | 201 `{"directive":Directive,"splice":Splice}` | 409 `revision_out_of_order` with `current`; 409 `directive_withdrawn`; 422 |
| `POST /api/directives/{id}/withdrawal` | planner | `{"reason"}` (1 to 500 characters) | 200 `{"directive":Directive}` | 409 `directive_withdrawn`; 422 |
| `GET /api/directives/{id}/export.csv` | all roles | — | 200 `text/csv; charset=utf-8` with `Content-Disposition: attachment` | — |
| `GET /api/board` | all roles | Query `directive_id` (optional) and `as_of` (a prior tag, only with `directive_id`) | 200 Board | 404 for an unknown `as_of` tag |
| `GET /api/tails` | all roles | — | 200 `{"tails":[{"registration","model","msn","total_hours","daily_utilisation"}]}` | — |
| `POST /api/tails/{registration}/flight-hours` | planner | `{"hours"}` | 201 `{"registration","total_hours","logged_at"}` | 422 |
| `GET /api/threads` | all roles | Query `directive_id`, `registration`, `state` (each optional) | 200 `{"threads":[Thread]}` | — |
| `GET /api/threads/{id}` | all roles | — | 200 `{"thread":Thread}` | — |
| `POST /api/threads/{id}/claim` | inspector, keyed | `{}` | 200 `{"thread":Thread}` | 409 `card_held` with `holder` (Person); 409 `effectivity_unconfirmed`; 409 `directive_withdrawn`; 409 `invalid_transition` |
| `POST /api/threads/{id}/release` | card holder | `{}` | 200 `{"thread":Thread}` | 403 `not_holder`; 409 `invalid_transition` |
| `POST /api/threads/{id}/evidence` | card holder | Raw body, `Content-Type` of `image/jpeg`, `image/png` or `application/pdf` | 201 `{"evidence":Evidence}` | 403 `not_holder`; 503 `storage_unavailable` |
| `POST /api/threads/{id}/inspection` | card holder, keyed | `{"revision","method_ref","findings","evidence_ids":[...]}` | 201 `{"thread":Thread,"signature":Signature}` | 403 `not_holder`; 409 `revision_changed` with `current`; 409 `effectivity_unconfirmed`; 409 `invalid_transition`; 422 |
| `POST /api/threads/{id}/countersign` | certifying engineer, keyed | `{"revision"}` | 201 `{"thread":Thread,"signature":Signature}` | 403 `out_of_scope` with `model`; 409 `revision_changed`; 409 `invalid_transition` |
| `POST /api/threads/{id}/deferral` | planner, keyed | `{"reason"}` (1 to 500 characters) | 201 `{"thread":Thread}` | 409 `past_due`; 409 `already_deferred`; 409 `invalid_transition`; 422 |
| `POST /api/threads/{id}/effectivity` | planner | `{"decision":"confirmed"\|"not_applicable","reason"}` (reason 1 to 500 characters) | 200 `{"thread":Thread}` | 409 `invalid_transition`; 422 |
| `POST /api/threads/{id}/reopen` | records clerk | `{"reason"}` (1 to 500 characters) | 200 `{"thread":Thread}` | 409 `invalid_transition`; 422 |
| `GET /api/people` | all roles | — | 200 `{"people":[User]}` | — |
| `PUT /api/engineers/{user_id}/scope` | records clerk | `{"models":[...]}` | 200 `{"engineer":User,"succession":[{"thread_id","from":Person,"to":Person\|null}]}` | 404 when the user is not a certifying engineer; 422 for an unknown model code |
| `POST /api/people/{user_id}/erasure` | records clerk | `{"reason"}` (1 to 500 characters) | 200 `{"person":Person}` | 409 `not_contractor`; 409 `already_erased` |
| `POST /api/imports` | records clerk, keyed | Raw CSV body, `Content-Type: text/csv` | 201 ImportResult; a file whose bytes equal an earlier import gives 200 with that import's stored ImportResult and `"replayed_file":true` | 422 `fields.file` for a missing header column or more than 2,000 data rows |
| `GET /api/imports` | all roles | — | 200 `{"imports":[ImportResult]}` | — |
| `POST /api/packs` | records clerk, keyed | `{"directive_id"}` | 201 `{"pack":Pack}` when transmitted, 202 `{"pack":Pack}` when queued | 409 `pack_already_queued` with `pack_id` |
| `GET /api/packs` | all roles | — | 200 `{"packs":[Pack]}` | — |
| `GET /api/packs/{id}` | all roles | — | 200 `{"pack":Pack}` | — |
| `GET /api/packs/{id}/pdf`, `GET /api/packs/{id}/csv` | all roles | — | 200 with the stored object bytes (`application/pdf` or `text/csv`) | 409 `pack_not_transmitted`; 503 `storage_unavailable` |
| `GET /api/notices` | all roles | Query `status` (optional) | 200 `{"notices":[Notice]}` | — |
| `GET /api/search` | all roles | Query `q` (2 to 100 characters) | 200 `{"results":[{"type":"directive"\|"thread"\|"person","id","label","revision"}]}`, at most 50 | 422 `fields.q` |
| `GET /api/audit` | all roles | Query `directive_id`, `thread_id` (each optional) | 200 `{"entries":[AuditEntry]}`, newest first | — |
| `PUT`, `PATCH` or `DELETE` on `/api/audit` and any path under it | — | — | — | 405 `method_not_allowed` |

**Body shapes.**
- **Directive**: `{"id","authority","number","title","revision","status":"active"|"withdrawn","revisions":[{"revision","title","method","effective_date","calendar_days","fh_interval","applicability","prior_credit","document_key","ingested_at","ingested_by":Person}]}`. `title` is the current revision's title. `document_key` is null for seeded revisions.
- **Splice**: `{"from":tag|null,"to":tag,"retargeted":[thread_id],"added":[...],"removed":[...],"kept":[...]}`.
- **Board**: `{"generated_at","as_of","directives":[{"id","authority","number","title","revision","status","prior_revisions":[tag],"counts":Counts}],"tails":[...],"cells":[Cell],"totals":Counts}`.
- **Cell**: `{"thread_id","registration","directive_id","state","stage","label","revision","pinned_revision","governing":"CAL"|"FH"|null,"calendar_used","hours_used","due_at"}`. The two `_used` values are fractions from 0 to 1 with two decimals. The `meter` values in the grid are these fractions times 100, rounded.
- **Thread**:
  - Identity and status: `{"id","registration","model","msn","directive_id","directive","state","stage","label","revision","pinned_revision","governing_revision","governing"}`.
  - Rule in force: `"wording":{"title","method"}`, `"limits":Limits`.
  - Work: `"timeliness":null|"on_time"|"overdue"`, `"work_card":{"id","holder":Person|null,"claimed_at"}`, `"evidence":[Evidence]`, `"signatures":[Signature]`, `"certifier":{"assigned":Person|null,"status":"awaiting_countersignature"|"awaiting_certifier"|null}`, `"deferral":null|{"granted_by":Person,"granted_at","reason"}`.
  - Past: `"history":[{"revision","entered_at","left_at","limits":Limits,"wording","outcome":"added"|"retargeted"|"kept"|"removed"|"current","legacy_records":[...]}]`, plus the top-level `"legacy_records":[...]`.
  - Each history entry's `outcome` says what happened to the thread when that entry's revision was superseded: `retargeted`, `kept` or `removed`, or `added` when the thread was not applicable under that revision and re-entered effectivity under the next one. The live entry for the current revision reads `current`.
  - `revision` is the lineage's current tag. `governing_revision` is the tag whose rule applies, which is the pinned tag when pinned.
- **Evidence**: `{"id","key","sha256","content_type","bytes","attached_by":Person,"attached_at"}`. The upload carries no file name and the shape holds none, so every surface identifies an evidence object by its `content_type`, `bytes` and `sha256`.
- **Signature**: `{"id","kind":"inspection"|"countersignature"|"legacy","signer":Person|null,"signer_text","revision","committed_at","timeliness","method_ref","findings","status":"valid"|"superseded"|"void","void_reason"}`. Legacy signatures have `signer` null and carry the spreadsheet name in `signer_text`.
- **ImportResult**: `{"import_id","file_sha256","rows","merged","duplicates","closed","orphans":[{"row","tail","directive","revision","reason"}],"rejected":[{"row","field","message"}],"replayed_file"}`. Rows are numbered from 1 for the first data row.
- **Pack**: `{"id","directive_id","revision","status":"queued"|"transmitted","waiting_for":null|"object_storage"|"mail","requested_by":Person,"requested_at","transmitted_at","attempts","pdf_key","csv_key","pdf_sha256","csv_sha256"}`. The keys and checksums are null while the pack is queued.
- **Notice**: `{"id","kind":"card_revision"|"countersignature_request"|"succession","to","subject","body","status":"queued"|"sent"|"withdrawn","queued_at","send_after","sent_at"}`.
- **AuditEntry**: `{"id","at","actor":Person,"action","directive_id","thread_id","detail"}`.

**Validation (422).**
- `authority` is one of "EASA", "UK CAA", "ATR", "De Havilland", "Embraer".
- `number` follows its authority's published format. EASA: `YYYY-NNNN`. UK CAA: `G-YYYY-NNNN`. ATR: `ATR72-CC-NNNN`. De Havilland: `84-CC-NNNN`. Embraer: `E170-CC-NNNN`. Here Y, N and C are digits.
- `title` is 1 to 200 characters. `method` is 1 to 4,000 characters.
- `effective_date` is a real date no later than today in the base time zone.
- `calendar_days` is an integer from 1 to 3,650.
- `fh_interval` is from 0.1 to 100,000.0 with at most one decimal.
- `applicability` has 1 to 20 ranges, each with a known model code and integers with `msn_from` no greater than `msn_to`.
- `document_id` names a stored document. This check is part of step 8 of the precedence, so it is made before any check of whether object storage can be reached, and it never depends on reaching it: a directive or revision ingest naming a document that was never stored answers 422 with `fields.document_id` whether object storage is up or down. An ingest naming a document that was stored earlier commits normally while object storage is down, because the ingest itself writes no object. Neither ingest endpoint ever answers 503.
- `revision` must be the current revision number plus one; any other value answers 409 `revision_out_of_order`.
- `hours` is from 0.1 to 24.0 inclusive with at most one decimal.
- `method_ref` is 1 to 200 characters and `findings` is 1 to 4,000 characters.
- `evidence_ids` is a non-empty list of evidence ids attached to this thread.
- A `signed_at` or any other client time field on any request is ignored, not rejected.

### Business rules (DP-08, DP-09, DP-11, DP-12, DP-14, DP-15, DP-16, DP-17, DP-21, DP-22, DP-23, DP-25, DP-26, DP-28, DP-29, DP-30, DP-31, DP-32, DP-34, DP-35, DP-36, DP-38, DP-39, DP-40, DP-42, DP-43, DP-44, DP-45, DP-47, DP-48, DP-49, DP-51, DP-52)

**Permissions.** The server decides every permission on every request. Hiding a button is never the guard. Reading is open to all five roles. Each write action is accepted only from the roles listed here, and every other role gets `forbidden`:

| Action | Allowed role |
|---|---|
| Ingest a directive or revision, upload a document, withdraw, defer, confirm effectivity, log flight hours | compliance planner |
| Claim | licensed inspector |
| Release, attach evidence, sign inspection | licensed inspector who holds the card (any other inspector gets `not_holder`) |
| Countersign | certifying engineer |
| Import, reopen, change a scope, erase, request a pack | records clerk |

The regulator auditor has no write action at all.

**Server clock.** The server clock is the only clock for every rule and every recorded time. When the environment variable `TAILBOARD_CLOCK_START` holds an ISO 8601 UTC instant, the server clock reads that instant when the process starts and advances in real time from there. When it is unset, the server uses the system clock. The operator's base time zone is Europe/London.

**Effectivity.** A tail is in a revision's effectivity when its model code equals a range's model and its MSN lies between that range's first and last serial, both inclusive. There is one compliance thread per tail per directive lineage, created the first time the tail is in effectivity and never duplicated.

**Limits.**
- The deadline date is the revision's effective date plus its calendar limit in days.
- The calendar due instant is 23:59:59.000 in the base time zone on the deadline date.
- The flight-hours baseline is the tail's total logged hours when the thread entered that revision. The threshold is the baseline plus the revision's flight-hours limit.
- The flight-hours limit is passed when the tail's logged hours go above the threshold. Hours exactly at the threshold are still within it. The hours due instant is the moment the log entry that first took the total above the threshold was recorded.
- A thread's due instant is the earlier of the calendar due instant and the hours due instant.

**On time or overdue.**
- An inspection signature is on time when the server commits it at or before the calendar due instant and while logged hours are at or below the threshold. One millisecond after the due instant, or with hours above the threshold, it is overdue.
- The timeliness is recorded on the signature and on the thread. A late inspection is still accepted.
- A thread's reported `state` is `overdue` whenever its stage is open-work or deferred and the server clock is past its due instant or its hours are above its threshold. This is computed on every read and every write. The thread keeps its holder and signatures.

**Due soon.** An open-work thread is due soon from 00:00:00 in the base time zone on the date 30 calendar days before its deadline date, or from the moment its logged hours reach 50.0 below its threshold, whichever comes first.

**Governing limit and rails.**
- The projected hours date is today plus the remaining hours divided by the tail's daily utilisation, rounded up to whole days. The remaining hours are the threshold minus the logged hours.
- CAL governs when the deadline date is on or before the projected hours date. Otherwise FH governs. When both limits are passed, the one passed first governs.
- The calendar rail's used fraction is the time elapsed since 00:00:00 base time on the effective date divided by the span to the calendar due instant.
- The hours rail's used fraction is the logged hours minus the baseline, divided by the threshold minus the baseline.
- Both fractions are clamped to 0 to 1 and rounded to two decimals.
- Certified threads freeze their rails, governing limit and limits at the final countersignature.

**Stages and transitions.**
- The stored stages are `not_applicable`, `open`, `claimed`, `inspected`, `certified`, `deferred`, `superseded_retargeted`, `withdrawn` and `reopened`. The reported `state` equals the stage, except that it reads `overdue` as defined above.
- The open-work stages are `open`, `claimed`, `inspected`, `superseded_retargeted` and `reopened`.
- Any action from a stage not listed for it answers `invalid_transition`, with the current stage and the action. A thread of a withdrawn directive answers `directive_withdrawn` to every action, except that release, attach evidence and sign inspection answer `not_holder` first, because the withdrawal cancelled the hold those three require and step 6 of the precedence runs before step 7.

| Action | From | To | Notes |
|---|---|---|---|
| Ingest (tail newly in effectivity) | no thread, or `not_applicable` | `open` | Counted as added |
| Claim | `open`, `deferred` | `claimed` | Holder set. A deferral's grace stays in the limits |
| Claim | `reopened` with no holder | `reopened` | Holder set |
| Claim of a card you already hold | — | — | 200, unchanged |
| Release | `claimed` | `open` | Holder cleared |
| Release | `reopened` | `open` | Holder cleared |
| Sign inspection | `claimed`, `reopened` with holder | `inspected` | Certifier assigned |
| Countersign | `inspected` | `certified` | Closes the thread |
| Defer | `open` | `deferred` | Only before the due instant |
| Confirm effectivity | `superseded_retargeted` | `claimed` if a holder is kept, otherwise `open` | — |
| Mark not applicable | `superseded_retargeted` | `not_applicable` | Card holder cleared |
| Reopen | `certified` | `reopened` | — |
| Supersession | any open-work stage, `deferred`, or `certified` that is not kept | `superseded_retargeted` | Counted as retargeted |
| Supersession (tail leaves effectivity) | any stage except `withdrawn` | `not_applicable` | Counted as removed |
| Withdrawal | any stage | `withdrawn` | — |

From `superseded_retargeted`, claim, inspection, countersign and deferral answer `effectivity_unconfirmed`.

**Supersession.** Ingesting revision n+1 commits in one transaction: the revision, every thread change, the history entries, the per-revision snapshot, the notice rewrites and the audit entries.
- Each existing thread of the lineage stays the same thread. Its previous revision is appended to its history with that revision's limits, wording and outcome, and the history is never edited.
- **Frozen and live entries.** A thread holds exactly one entry per revision of the lineage it has been part of, oldest first. Every entry but the last is **frozen**: the moment its revision is superseded it takes its `left_at` and its `outcome`, and after that its `revision`, `entered_at`, `left_at`, `limits`, `wording` and `outcome` never change again. This is what "the history is never edited" means. The last entry is the **live** entry: it is the one for the lineage's current revision, its `left_at` is null, its `outcome` reads `current`, and its `limits` and `wording` are always the thread's own limits and wording in force, so they follow every later change to them. Every thread of a lineage holds a live entry, so a supersession appends one new live entry to each thread of the lineage and freezes the entry that was live before it.
- Retargeted threads take the new revision's limits, with a new hours baseline taken at ingest and the new wording.
- A deferral is cleared, and remains visible in history.
- An inspection signature under the old revision gets status `superseded`. The inspector stays as card holder.
- A queued countersignature request for that thread is withdrawn.

**Credit and effective date.** A certified thread is **kept** when the new revision's `prior_credit` is true and its final countersignature committed before 00:00:00 base time on the new revision's effective date.
- A kept thread stays `certified` and counts as complied.
- Its `pinned_revision` and `governing_revision` stay at the revision it was signed under, and its wording, limits, rails and signatures show that revision on every surface: board, thread, export and pack. Search is the one exception: a result carries the lineage's current tag, never a pinned tag, as published under Search.
- Every other certified thread in effectivity is retargeted. Its signatures become `superseded` and stay in history.
- A kept thread stays pinned through later revisions as long as each one credits prior work and it was signed before each one's effective date.
- **A kept thread's history.** It follows the same frozen-and-live rule as every other thread, with no special case. After R2 keeps a thread that was certified under R1 it holds exactly two entries: the frozen R1 entry, which took the outcome `kept` when R2 superseded R1 and keeps R1's limits, wording and signatures for good, and the live R2 entry, whose `outcome` reads `current`. Because the thread is pinned to R1, the live R2 entry's `limits` and `wording` are the thread's limits and wording in force, which are R1's, so the ribbon shows R1's rule in both entries. A kept thread's frozen entry never has its `kept` outcome rewritten, by a later supersession or by a reopen. After a third revision that keeps it again it holds three entries: R1 `kept`, R2 `kept`, and the live R3 reading `current`.

**Withdrawal.** Withdrawal cancels every hold, withdraws every queued notice for the lineage's threads, and leaves the column as a placeholder whose stubs keep the full history. Because the holds are gone, release, attach evidence and sign inspection — the three actions the permission table gates on holding the card — answer 403 `not_holder` to the former holder, which step 6 of the precedence decides before step 7 could answer `directive_withdrawn`. Every other action on a withdrawn lineage's thread answers 409 `directive_withdrawn`. Withdrawn threads are not counted, and the directive accepts no further revision.

**Work cards and claims.** Each thread has exactly one work card for its whole life, with an id of the form `WC-` plus five digits. Claims are decided by the database. Of any number of simultaneous claims on one card, exactly one gets 200, and every other gets `card_held` naming the winner.

**Signatures bind to a revision.** Inspection and countersignature requests carry the revision tag the signer was shown. If the thread's current revision differs, the request gets `revision_changed` and records nothing.

**Certifier assignment and scope.**
- Each model has a published standby list (Seed data). When an inspection is signed, the thread's assigned certifier becomes the first engineer on the model's list whose scope covers the model, and a countersignature request notice is queued to them.
- Any certifying engineer whose scope covers the model may countersign, not only the assigned one.
- The scope check reads the engineer's scope inside the same transaction that commits the countersignature. A scope change is visible to the very next request, with no cache window. An out-of-scope refusal records nothing, and the inspection signature stays valid.
- **Succession.** When a scope change removes a model from an engineer, every inspected thread of that model assigned to that engineer passes to the next engineer on the model's list, counting from the top and skipping the narrowed engineer and anyone whose scope lacks the model. A succession notice is queued to the new certifier. If no engineer qualifies, `certifier.assigned` becomes null and `certifier.status` becomes `awaiting_certifier`.
- When a scope change adds a model, every thread of that model awaiting a certifier is assigned by the same order, with a succession notice.

**Deferral grace.**
- A planner may defer an `open` thread once per revision, and only before its due instant. Afterwards the request gets `past_due`. A second deferral under the same revision gets `already_deferred`.
- Deferral moves the deadline date 7 calendar days later and raises the hours threshold by 25.0. The due instant is then the earlier of the two extended limits, under the same inclusive edge.

**Flight hours.** Each log entry adds its hours to the tail's total and records the server time. Every thread on that tail recomputes on its next read.

**Board counts.** Counts are computed from thread states on every read, never stored as running totals. Each thread counts at most once, and not-applicable and withdrawn threads are not counted at all.

| Count | Threads included |
|---|---|
| complied | Stage `certified` |
| overdue | Reported state `overdue` |
| deferred | Stage `deferred`, not overdue |
| due_soon | Open-work stages inside the due-soon window, not overdue |
| open | The remaining open-work threads |

Fleet totals are the sum of the column counts.

**Live feed.** Every committed change to a thread or directive is published on the event stream. A revision ingest sends one `revision` event carrying its splice. Every signed-in board shows the change within 3 seconds.

**Board as it stood.** Each supersession stores a read-only snapshot of every thread of the lineage exactly as it stood at the moment before the new revision: state, label, revision, limits, wording, holder and signatures. `GET /api/board` with `as_of` returns that snapshot for the column.

**Search.** Search matches case-insensitive substrings of:
- directive numbers, both as published and in normalised form;
- titles;
- tail registrations, both as displayed and in normalised form;
- display names, licence numbers and legacy notes.

Results reflect every committed change on the next request. Each result's `label` is the name of its `link` in `list "Search results"`, and both `label` and `revision` are published by result type:

- a **directive** result's `revision` is always the lineage's current tag, and its label is "<directive> <tag> <title>" with the title as worded in that current revision;
- a **thread** result's `revision` is always the lineage's current tag, never the thread's pinned tag, and its label is "<registration> <directive> <tag>";
- a **person** result's `revision` is null, and its label is the person's display name, followed by a space and their licence number when they have one. After erasure the display name is the signer token and there is no licence, so the label is the token alone.

**Legacy import.** The file is UTF-8 CSV with a header row. Header names are matched case-insensitively and in any order, and other columns are ignored. The required columns are `tail`, `directive`, `revision`, `status`, `inspector`, `inspector_licence`, `inspected_on`, `certifier`, `certifier_licence`, `certified_on` and `notes`.

Before matching, each row is normalised:
- **Tail**: upper-cased, with every hyphen and space removed, compared with each tail's registration normalised the same way.
- **Directive**: upper-cased; any leading words "EASA", "CAA", "AD" or "SB" removed, each followed by a space or hyphen; every run of spaces, slashes, dots and underscores turned into one hyphen. It then matches a published number when both have the same number of hyphen-separated segments and each pair of segments is either equal as text or, when both are all digits, equal as integers.
- **Revision**: upper-cased, spaces removed, a leading "REV" or "R" removed; "ORIG" or "ORIGINAL" means 1. Otherwise the value must be a whole number of 1 or more.

Each row is handled in one of these ways:
- **Rejected**, with its field and message, when status is not "complied" or "open" (any case), field `status`; when the normalised revision is neither "ORIG" nor "ORIGINAL" nor a whole number of 1 or more, field `revision`; when a non-empty date value is not `YYYY-MM-DD` or `DD/MM/YYYY`, field `inspected_on` or `certified_on`; when a complied row lacks `inspected_on` or `certified_on`, that field; or when notes exceed 1,000 characters, field `notes`. An empty date value on a row that is not complied is absent, not malformed. Rejection is decided before matching, so a rejected row is never also an orphan. When more than one of these fails in one row, the field reported is the first in this order: `status`, `revision`, `inspected_on`, `certified_on`, `notes`.
- **Orphan**, with reason `unknown_tail`, `unknown_directive`, `unknown_revision` or `not_in_effectivity`, when a valid row does not identify a thread that lived under that revision. A well-formed revision that the lineage has never reached is `unknown_revision`. When more than one reason applies, the reason reported is the first in this order: `unknown_tail`, `unknown_directive`, `unknown_revision`, `not_in_effectivity`.
- **Merged** when a matched row adds one legacy record to that revision's history entry. The record is keyed by thread, revision, status, inspected date and certified date.
- **Duplicate** when a row's key already exists, from an earlier import or an earlier row in the same file. Nothing new is created.

A merged complied row for the thread's current revision closes the thread as `certified` with two `legacy` signatures, but only when the stage is `open`, no one holds the card and there are no signatures. Such rows are counted in `closed`. In every other case the row is history only.

A file whose SHA-256 equals an earlier import's is answered with that import's result and creates nothing.

**Reopen.** Reopening a certified thread sets every one of its signatures to `void` with the reopen reason. Their original fields and times are unchanged and they stay listed. The thread moves to the lineage's current revision with that revision's limits, and any pin is cleared. Reopening is an entry into that revision, so the thread takes a fresh flight-hours baseline at the reopen instant, the tail's total logged hours then, and its threshold is that baseline plus the current revision's flight-hours limit. This holds whatever revision the thread was pinned to before. Its calendar limit is the current revision's effective date and deadline date, and its hours rail restarts from zero used. A reopen appends no history entry and rewrites no frozen entry, whatever revision the thread was pinned to. Every thread already holds a live entry for the lineage's current revision, so there is nothing to append: the reopen only clears the pin, which makes that live entry the governing one, and the live entry then shows the limits now in force, including the fresh baseline. The revision history ribbon therefore holds exactly the entries it held before the reopen, in the same order, with the same `revision` and `outcome` on each. Its work card keeps the same id and returns to the holder who signed the last voided inspection, unless that person was erased, in which case the thread stays `reopened` with no holder. Every evidence record and object stays attached, with the same ids, keys and checksums.

**Erasure.** Only a contractor can be erased. Erasure assigns a token of the form `SIGNER-` plus 8 uppercase hexadecimal characters. The token is assigned once, never reused, and shown everywhere the person was named. Erasure then:
- replaces the person's display name, licence number and email on signatures, work cards, evidence, audit actors, search, exports, notices and packs. Each of those names the person by reference, so the replacement changes no signature, work card or evidence row: every id, key, checksum and recorded time stays as it was, and only the name and licence they resolve to change;
- replaces any legacy signer text equal to their name or licence (case-insensitive), now and in later imports;
- ends their sessions, so their next request gets `unauthenticated`;
- clears every card they hold: a `claimed` thread returns to `open`, a `reopened` thread stays `reopened` with no holder, and an `inspected` or `superseded_retargeted` thread keeps its stage with no holder;
- withdraws every queued notice addressed to them, and rewrites every queued notice that names them;
- re-renders every stored pack object that carried them under new content-addressed keys with new checksums, updates the pack records, and deletes each old object that no pack record references any longer;
- leaves mail already sent unaltered: pack emails and notices delivered before the erasure stay as delivered, and every pack email sent afterwards carries only the token;
- keeps every signature, evidence object and audit entry, with their meaning intact.

**Notices.**
- Notices are queued, held for `NOTICE_HOLD_SECONDS` seconds (default 30, any whole number from 0 to 600), then sent. While mail is down they stay queued and are retried at most every 10 seconds. Sent notices are never altered.
- A `card_revision` notice is queued to the card holder when a supersession retargets or removes a held thread. A later supersession rewrites a still-queued `card_revision` notice for the same card to the newest revision instead of queuing a second one.
- A `countersignature_request` notice is queued at each inspection signature. A `succession` notice is queued at each certifier hand-over.
- Supersession and erasure rewrite or withdraw queued notices in the same transaction as the change.
- A replayed request never queues another notice.

**Regulator CSV.** Columns, in this order: `registration`, `model`, `msn`, `directive`, `revision`, `title`, `state`, `governing_revision`, `deadline_date`, `fh_threshold`, `governing`, `inspector`, `inspector_licence`, `inspected_at`, `certifier`, `certifier_licence`, `certified_at`, `timeliness`, `legacy_notes`.
- There is one row per thread of the directive, including not-applicable, kept and withdrawn threads, ordered by registration.
- The file is UTF-8 with CRLF line ends, and fields are quoted as RFC 4180 requires.
- **Neutralisation.** Every cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return is written with a single apostrophe in front of it. This applies to cells from typed titles, imported spreadsheets and every other source. Typed titles and imported fields are stored exactly as they arrive, with no leading or trailing whitespace removed, so a value given with a leading tab or carriage return still begins with it when it is exported.
- The pack's CSV manifest uses exactly the same rules.

**Packs.**
- Only one queued pack per directive may exist at a time. Another request gets `pack_already_queued`.
- Each attempt renders the PDF and CSV from the state at that moment, stores both objects, sends the email, and only then marks the pack transmitted.
- If storing fails, nothing is kept and the pack stays queued with `waiting_for` set to `object_storage`. If sending fails, both objects are deleted, the pack stays queued, and `waiting_for` is set to `mail`.
- Identical bytes give identical keys, so two packs can share an object. Deleting a pack object never removes an object whose key another pack record still references.
- So a pack is never transmitted without its objects and its email, and every pack object in storage is referenced by a transmitted pack.
- A queued pack is retried in the background at most every 10 seconds until it goes out, without a restart. It produces exactly one pair of objects and one email. Pack status is not carried on the event stream, which publishes only `revision` and `threads` events. Instead the Packs screen reads `GET /api/packs` again every 5 seconds while it is shown, so a queued pack's row turns Transmitted within 5 seconds of the transmission, with no reload.

**Audit.** Every state change writes one audit entry in the same transaction. Each entry carries the server time, the actor, a dotted action name such as `thread.claimed`, and the directive, thread and detail. Entries are never edited or deleted. A correction is a new entry. The actor is stored as a reference, so after an erasure it displays as the token.

- **How many entries.** A thread earns an entry when the commit creates it or alters what is true of its work: its stage, its governing revision, its limits, its wording, its holder, its signatures, or its assigned certifier. Three things are not alterations. Gaining a history entry is not one. Taking the lineage's new tag in `revision`, and the matching `pinned_revision`, without a change of governing revision is not one either — that is exactly what happens to a kept thread, which keeps the rule it was signed under. And having a Person it names renamed is not one: every surface resolves a Person through a reference, so a rename, which is all an erasure does to a name, alters no thread field. So:
  - A change to one thread writes exactly one entry, naming that thread. A change that alters no thread at all, such as a flight-hours log, writes exactly one entry with `thread_id` null, because every thread on that tail recomputes from the new total on its next read rather than being altered now.
  - A change that reaches many threads at once — a new-directive ingest, a revision ingest, a withdrawal, an erasure or a scope change — writes exactly one entry for the change itself, carrying its `directive_id` or its person in the detail with `thread_id` null, plus exactly one entry per thread it creates or alters.
  - On a **new-directive ingest**: one entry for the directive, plus one per thread created. An ingest that creates 12 threads writes 13 entries.
  - On a **revision ingest**: one entry for the revision, plus one per **retargeted** thread, one per thread that **leaves** effectivity, and one per **added** thread — a tail newly in effectivity, whether its thread is created now or returns from `not_applicable`. A **kept** thread earns no entry: its stage, governing revision, limits, wording, holder and signatures are all unchanged, and all it takes from the ingest is the lineage's new tag, the matching pin and one history entry. So an R2 ingest over a lineage with 3 retargeted, 1 removed, 2 added and 1 kept thread writes 1 + 3 + 1 + 2 = 7 entries.
  - On a **withdrawal**: one entry for the directive, plus one per thread that moves to `withdrawn`.
  - On a **scope change**: one entry for the scope change, plus one per thread whose assigned certifier it changes — each succession to the next engineer, and each thread that drops to `awaiting_certifier`, and each thread that gains a certifier when a model is added. A thread of that model whose certifier does not change earns none. So Journey 4's scope change, which removes the ATR 72 from Ines Varga's scope and hands the one inspected ATR 72 thread awaiting her to Tomasz Wilk, writes 1 + 1 = **2 entries**.
  - On an **erasure**: one entry for the erasure, plus one per thread the erasure actually alters, which is only a thread whose card the erased person held, because clearing that card changes the holder and sometimes the stage. A thread whose only link to the erased person is a signature, a legacy signer text or an evidence attribution earns no entry: the signature and evidence rows keep their ids and times and only the name they resolve to changes. So Mika Hollis's erasure, with Mika holding one card (G-FNAE on EASA 2026-0142) and having signed inspections on two certified threads (G-FNAB and G-FNCA), writes 1 + 1 = **2 entries**.
- **The actor for background work.** Background work has no signed-in person, so its entries carry the system actor: a Person whose `display_name` is "Tailboard", whose `licence` is null and whose `erased` is false. The system actor is never a user: it has no passcode, never appears in `GET /api/people` and never appears in a search result. A background pack transmission writes one entry with the system actor; the pack's own `requested_by` stays the records clerk who asked for it. Sending, retrying, rewriting or withdrawing a queued notice writes no audit entry, because `GET /api/notices` is the record of the notice queue; the change that caused a rewrite or withdrawal is audited instead.

### Services (DP-10, DP-24, DP-45, DP-46, DP-47, DP-48)

- **Postgres** is the system of record for directives and revisions, effectivity, tails and flight-hour logs, threads, work cards, signatures, scopes and standby lists, deferrals, the import ledger, notices, packs, idempotency records, snapshots and the audit trail. Supersession, claims and sign-offs commit here in single transactions.
- **MinIO** holds private objects only, streamed to the browser through the app. The app creates the bucket named by `S3_BUCKET` when it is absent, at start or on the first attempt after object storage returns, so a queued pack can go out without a restart. Keys are the lowercase hexadecimal SHA-256 of the object bytes:
  - directive documents: `directives/<sha256>.pdf`;
  - evidence: `evidence/<sha256>.jpg`, `.png` or `.pdf`;
  - packs: `packs/<sha256>.pdf` and `packs/<sha256>.csv`.

  The pack PDF begins with `%PDF-` and keeps its text uncompressed in a standard font, so every line can be found with a plain byte search. It lists the directive, revision, operator, generation time and the same rows as the CSV manifest.
- **Mailpit** receives every message from "Tailboard at Fenwick Regional <tailboard@fenwick-regional.test>", which is the value of `MAIL_FROM`. `<APP_PUBLIC_URL>` is the value of that variable. The messages are:
  - **Pack.** To the authority mailbox (Seed data). Subject "Compliance pack <directive> <tag> from Fenwick Regional Airways". The text body has the pack id, the link `<APP_PUBLIC_URL>/api/packs/<pack id>/pdf`, and the lines "PDF SHA-256: <pdf sha256>" and "CSV SHA-256: <csv sha256>". One attachment named `<pack id>-manifest.csv` has bytes identical to the stored CSV. Exactly one per pack.
  - **Card revision.** To the holder's email. Subject "New revision <directive> <tag> affects your work card <card>". The body gives the registration, the old and new tags, the new deadline date and threshold, or the removal.
  - **Countersignature request.** To the assigned certifier. Subject "Countersignature requested: <registration> <directive> <tag>". The body names the inspector's display name and licence.
  - **Succession.** To the new certifier. Subject "Countersignature passed to you: <registration> <directive> <tag>". The body names the previous certifier and the inspector.
- **When MinIO is down:** document upload and evidence upload answer `storage_unavailable`, pack downloads answer `storage_unavailable`, and packs queue. The two ingest endpoints answer no `storage_unavailable`: an ingest naming an unstored document answers 422 `fields.document_id`, and an ingest naming a document stored before the outage commits. The board, threads, claims, signatures and every other action keep working.
- **When mail is down:** notices and packs stay queued, and every other action keeps working.

### Seed data (DP-03, DP-07, DP-11, DP-34)

Every seeded person, airline, aircraft registration, licence number, directive and bulletin below is invented.

**Operator.** Fenwick Regional Airways. Base time zone Europe/London. Authority mailbox continuing-airworthiness@caa-oversight.test.

**Seed day.** `<seed day>` is the date in the base time zone when the database is first seeded. Every seeded date below is relative to it. Seeded clock times are in base time.

**Users.**

| Username | Passcode | Display name | Role | Staff or contractor | Licence | Email | Scope |
|---|---|---|---|---|---|---|---|
| avery.lund | saltmarsh-planner-1 | Avery Lund | compliance_planner | staff | — | avery.lund@fenwick-regional.test | — |
| noor.haddad | saltmarsh-planner-2 | Noor Haddad | compliance_planner | staff | — | noor.haddad@fenwick-regional.test | — |
| dara.okafor | saltmarsh-insp-1 | Dara Okafor | licensed_inspector | staff | LIC-66-48213 | dara.okafor@fenwick-regional.test | — |
| sol.brennan | saltmarsh-insp-2 | Sol Brennan | licensed_inspector | staff | LIC-66-51077 | sol.brennan@fenwick-regional.test | — |
| mika.hollis | saltmarsh-insp-3 | Mika Hollis | licensed_inspector | contractor | LIC-66-90412 | mika.hollis@hangarcrew.test | — |
| jun.teller | saltmarsh-insp-4 | Jun Teller | licensed_inspector | contractor | LIC-66-90655 | jun.teller@hangarcrew.test | — |
| ines.varga | saltmarsh-cert-1 | Ines Varga | certifying_engineer | staff | LIC-66-30218 | ines.varga@fenwick-regional.test | ATR72-212A, DHC-8-402 |
| tomasz.wilk | saltmarsh-cert-2 | Tomasz Wilk | certifying_engineer | staff | LIC-66-30544 | tomasz.wilk@fenwick-regional.test | ATR72-212A, ERJ-170-200 |
| priya.raman | saltmarsh-cert-3 | Priya Raman | certifying_engineer | staff | LIC-66-30981 | priya.raman@fenwick-regional.test | ERJ-170-200, DHC-8-402 |
| robin.achterberg | saltmarsh-records-1 | Robin Achterberg | records_clerk | staff | — | robin.achterberg@fenwick-regional.test | — |
| casey.moreau | saltmarsh-audit-1 | Casey Moreau | regulator_auditor | — | — | casey.moreau@caa-oversight.test | — |

**Standby lists, first to last.**
- ATR72-212A: Ines Varga, Tomasz Wilk, Priya Raman.
- DHC-8-402: Priya Raman, Ines Varga, Tomasz Wilk.
- ERJ-170-200: Tomasz Wilk, Priya Raman, Ines Varga.

**Tails** (registration, MSN, total hours at seed, daily utilisation in hours):

- ATR72-212A (label ATR 72):
  - G-FNAA 1102, 18420.3; G-FNAB 1118, 17985.0; G-FNAC 1135, 17210.6; G-FNAD 1149, 16844.2;
  - G-FNAE 1163, 16102.9; G-FNAF 1180, 15577.4; G-FNAG 1196, 14930.1; G-FNAH 1211, 14288.8;
  - G-FNAI 1227, 13650.5; G-FNAJ 1244, 12904.0; G-FNAK 1260, 12411.7; G-FNAL 1278, 11876.3.
  - All at 6.0 per day.
- DHC-8-402 (label Dash 8-400):
  - G-FNBA 4388, 24510.2; G-FNBB 4402, 23877.9; G-FNBC 4417, 23105.4; G-FNBD 4431, 22690.0;
  - G-FNBE 4446, 21948.6; G-FNBF 4460, 21302.3; G-FNBG 4475, 20755.8; G-FNBH 4489, 20114.1.
  - All at 7.0 per day.
- ERJ-170-200 (label E175):
  - G-FNCA 17000512, 21033.5; G-FNCB 17000527, 20488.2; G-FNCC 17000541, 19870.9; G-FNCD 17000558, 19244.6;
  - G-FNCE 17000573, 18602.3; G-FNCF 17000586, 17955.0; G-FNCG 17000602, 17310.7; G-FNCH 17000619, 16688.4.
  - All at 8.0 per day.

**Directives.** All four are at R1 with no document object and `prior_credit` false. Each thread's hours baseline is the tail's seeded total minus the figure given.

1. **EASA 2026-0142 R1**, "Main landing gear side brace lower link — detailed visual inspection".
   - ATR72-212A, MSN 1100 to 1250. Effective `<seed day>` minus 20 days. Calendar limit 180 days. Flight-hours limit 600.0. Baseline minus 120.0. Method "Inspect the lower link lugs for cracks using a 10x glass; replace the link if any crack is found."
   - G-FNAA: certified. Dara Okafor inspected at 10:00 and Ines Varga countersigned at 14:00, both on `<seed day>` minus 10 days.
   - G-FNAB: certified. Mika Hollis inspected at 10:00 and Tomasz Wilk countersigned at 15:00, both on `<seed day>` minus 5 days.
   - G-FNAC: inspected by Sol Brennan at 09:00 on `<seed day>` minus 2 days, assigned to Ines Varga.
   - G-FNAD: claimed by Dara Okafor. G-FNAE: claimed by Mika Hollis.
   - G-FNAF to G-FNAJ: open.
2. **UK CAA G-2026-0007 R1**, "Propeller de-icer boot bonding — detailed check".
   - DHC-8-402, MSN 4380 to 4499. Effective `<seed day>` minus 160 days. Calendar limit 180 days. Flight-hours limit 900.0. Baseline minus 300.0. Method "Check boot bond edges per the maintenance manual; repair any lift greater than 3 mm."
   - G-FNBA: certified. Sol Brennan inspected at 09:00 and Priya Raman countersigned at 13:00, both on `<seed day>` minus 12 days.
   - G-FNBB: deferred by Avery Lund at 16:00 on `<seed day>` minus 1 day, reason "Awaiting de-icer boot kit".
   - G-FNBC: claimed by Jun Teller.
   - G-FNBD to G-FNBH: open.
3. **Embraer E170-28-0042 R1**, "Fuel quantity probe harness connector — replacement".
   - ERJ-170-200, MSN 17000500 to 17000590. Effective `<seed day>` minus 200 days. Calendar limit 199 days. Flight-hours limit 1200.0. Baseline minus 100.0. Method "Replace the connector with the improved part and perform a fuel quantity indication test."
   - G-FNCA: certified. Mika Hollis inspected at 08:00 and Priya Raman countersigned at 12:00, both on `<seed day>` minus 30 days.
   - G-FNCB: inspected by Dara Okafor at 11:00 on `<seed day>` minus 3 days, on time, assigned to Tomasz Wilk.
   - G-FNCC to G-FNCF: open.
4. **ATR ATR72-27-1088 R1**, "Aileron trim tab actuator rod end — inspection".
   - ATR72-212A, MSN 1000 to 1999. Effective `<seed day>` minus 5 days. Calendar limit 365 days. Flight-hours limit 2000.0. Baseline minus 30.0. Method "Measure rod end play; replace the rod end if play exceeds the manual limit."
   - All twelve ATR tails: open.

Seeded inspection signatures use method reference "AMM task" and findings "No defects found". They have no evidence objects, and all are on time. No notices, packs or imports exist at start.

For example, with the seed data at start, the fleet counts read Open 20, Due soon 6, Overdue 5, Deferred 1, Complied 4.

## Technical requirements

### Deployment (DP-01, DP-03)

The runtime has Python 3. The app is installed and run as an unprivileged user. Dependencies go into a `.venv` inside `/app`, and the manifest calls tools by path (`.venv/bin/<tool>`) or as `python -m <tool>`. The whole `/app` tree is archived and moved between machines whose Python build differs, so two rules hold. No file inside `/app` may be a symbolic link whose target is an absolute path. And `install` must create the virtual environment from scratch, trusting nothing the tree arrived with, rather than reusing one already present. Both are satisfied by `python3 -m venv --clear --copies .venv`. `/app/run.json` holds string commands `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"python3 -m venv --clear --copies .venv && .venv/bin/pip install -r requirements.txt","build":".venv/bin/python -m tailboard.build","serve":".venv/bin/python -m tailboard.serve"}
```

`install` and `build` run with no service credentials: the only variables they receive are `APP_PUBLIC_PORT` and `APP_PUBLIC_URL`, so neither step may reach the database, object storage or the mail sink, and neither may apply the schema or the seed. A build that contacts a service fails. `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set, and it is the only step given the service variables. It applies the schema and seed idempotently on every start, so the app is correct even when `build` did nothing but compile. The start owns creating what it needs: when the database holds no schema it creates the schema before seeding, and when the bucket named by `S3_BUCKET` does not exist it creates that bucket. A start against a schema and bucket that already exist creates nothing and changes no seeded record. When object storage is unreachable at start the app still starts, answers the health check and serves the board, and creates the bucket on its first attempt after the service returns, with no restart. `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}`.

### Configuration and secrets (DP-02)

The app reads these at start: `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`, `NOTICE_HOLD_SECONDS` and `TAILBOARD_CLOCK_START`. The meaning of the last two is in Business rules. The app ignores every variable whose name contains `_OBSERVER_`. No credential or service URL is hard-coded, logged, or sent to the browser in any response, page or script.

### Server boundary (DP-04, DP-05)

- **Origin.** The app serves its pages, scripts, fonts and icons from its own origin only. Write requests carrying an `Origin` header for another origin answer 403 `forbidden`.
- **Body sizes.** Request bodies are limited, with the limit itself allowed: JSON 65,536 bytes, documents and evidence 5,000,000 bytes, import files 1,000,000 bytes. Anything larger answers 413 `payload_too_large`.
- **Content types.** A body with the wrong content type answers 415 `unsupported_media_type`.
- **Unknown routes.** An unknown `/api` path answers 404 `not_found`, and a known path with a wrong method answers 405 `method_not_allowed`. Every other path serves the app shell.
- **Never served.** The server never serves source files, the run manifest, `.venv`, environment files or credentials.
- **Dependency outages.** If MinIO or mail is unreachable at boot or later, the app still starts, answers the health check and serves every read. Affected actions behave as described in Services. Queued notices and packs resume within 10 seconds of the service returning, with no restart.

### Browser support and performance (DP-54)

Current Chromium, Firefox and WebKit, at 375 by 812, 768 by 1024 and 1280 by 800. With the seed data, the board is usable within three seconds of sign-in. Each API action answers within two seconds while all services are up. A splice finishes within the time stated in Motion and effects.

## Working rules

- IF-01: `/app/run.json` exists with `"_schema":"run-manifest-v1"` and string `install`, `build` and `serve` fields, and it calls Python tools through `.venv/bin/` or `python -m`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package and bundled font or icon set with its licence. "Shipped packages" means the production dependency tree: the non-development dependency group of the Python lockfile or requirements file installed into `.venv`, plus any front-end packages listed by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package, font and icon set uses MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, PSF-2.0, MPL-2.0 or OFL-1.1.
- IF-04: The app stores data only in the provided Postgres and MinIO: no SQLite, no other database or cache server, and no files used as a datastore.
- IF-05: The provided service configuration and dev compose files are left unchanged.
- IF-06: The app makes no runtime request to any third-party origin, and fonts and icons are served from the app.
- IF-07: Python dependencies are installed into `/app/.venv` and nowhere else.

## Engineering standards

- The code is idempotent, idiomatic Python, and its names use this brief's domain terms: directive, revision, lineage, thread, work card, effectivity, countersignature, deferral, pack, signer token.
- Each domain rule is decided in exactly one place in the source: each stage transition, the due instant, the governing limit, each count bucket, the import normalisation, the CSV neutralisation, and the scope check.
- Every API error is built through one error shape and one precedence order.
- There is no abstraction with only one implementation, no dead, commented-out or unreachable code, and no defensive check for a state the transitions make impossible.
- Multi-step changes that must be atomic run in one database transaction, with provider side effects ordered and undone as the pack rules state.
- Board values, counts and states always come from the server. The browser never computes compliance state on its own.
- The code builds no feature, endpoint or screen beyond this brief.
