# Haldvik Subsea Pensight

Pensight is the inspection console for a one-person ROV inspection business. The business flies a tethered underwater drone around salmon and sea-bream net pens and reports holes, seam tears, chafe and fouling to the farm. A live 3D twin of each pen sits at the centre of the console. Pen Unwrap cuts the net wall open at the pen's reference bearing and lays it flat into a chart measured in metres, so the farm's net crew can find each defect by its panel cell. The server computes every position, area, fouling cover and pen grade. Dive clearance comes from a third-party marine forecast provider. A findings copilot behind a third-party chat-completion provider points the camera at defects and proposes repairs. The farm manager gets a read-only report link that can be revoked and that expires. Pensight uses Postgres for records, MinIO for files and Valkey for presence, edit locks and the live broadcast between the inspector's two devices. WireMock stands in for the two third-party HTTP providers. Out of scope: user accounts and sign-in (the console belongs to one inspector, whose devices are named, not authenticated), invoicing and payments, live ROV video, email, and any datastore beyond these three.

## Problem and users

Farms pay small independent ROV operators to inspect their nets. Every escape costs the farm stock, fines and standing with its licence. The net-pen technical standard that certification bodies follow expects an inspection before, during and after every net operation. Today a one-person inspection business works from hours of HD video, a spreadsheet of hand-typed bearings and depths, and screenshots pasted into a word-processor report. Its older inspection tool writes CSV logs whose pen names never match the farm's. Defects get recorded twice or not at all. The farm manager cannot tell where on a 160 m net wall a 30 cm hole actually is. Dives start on the strength of a phone weather app that is hours old, and the topside laptop and the tablet at the winch disagree about what was just marked. The inspector pays for Pensight because a report the farm trusts is the product they sell.

- **Founder-inspector (daily, topside laptop).** Plans and clears dives, inspects the 3D pen twin, marks and edits defects, asks the copilot, imports old logs, publishes report revisions and manages report links.
- **Deck-tablet inspector (weekly, 768x1024 touch tablet beside the winch).** The same person during a dive. They orbit, tap pins, and mark and edit defects while the laptop mirrors every change.
- **Farm manager (occasional, usually a phone).** Opens the read-only report link, orbits the pen, and reads the condition grade and the defect list. They change nothing. Their phone's clock may be wrong.

## Journeys

1. **First open.** Start: a fresh install.
   - The inspector opens the console on the laptop. The Pens page shows the seeded farms' four pen condition cards, with Skarvholmen 01 as the open pen. Each card's grade line, the farm day rates and the Devices page read exactly as printed under First-open copy in Seed data.
   - They open Skarvholmen 01. The stage loads the twin and the Scene status shows its first-open lines. The list shows D-0001 to D-0006, with D-0006 marked as repaired.
   - They press U. The net wall unwraps, the Scene status reads the flat-chart view, D-0001 sits in panel F3, and the address now ends `?view=flat`.
   - They select D-0003 and the address adds it. They reload the page.
   - End: the flat chart is back at once with D-0003 selected, with no unwrap played, and the pen grade reads D, "Repair before stocking".
2. **Dive day.** Start: Skarvholmen 01 with no dive running.
   - The inspector plans a dive for the next whole hour and presses Check forecast. The server asks the forecast provider and shows GO.
   - They start the dive, and the dive clock runs in the Scene status.
   - On the deck tablet they mark a new hole by tapping the net wall. Within seconds the laptop shows the new pin and list row and announces it.
   - They attach a sonar capture and finish the dive with its track.
   - End: the dive is listed as recorded with its track and capture.
3. **Edit from the deck.** Start: both devices are open on Skarvholmen 01.
   - The tablet opens the editor on D-0002, and the laptop's row reads "Being edited on Deck tablet".
   - The tablet widens the tear and saves. The laptop's pin and row change in place, and the defect history names the Deck tablet with the old and new length.
   - Later, with no editor open, both devices save D-0003 at the same moment. Exactly one save is applied. The other device shows the conflict copy, and its pin and row show the winner's values.
   - End: the lock is released, the indicator is gone, and D-0003 has one new history entry.
4. **Copilot.** Start: Skarvholmen 01 with its seeded defects.
   - The inspector asks which defects need repair before restocking. The provider receives only the published findings context and the question exactly as typed. The answer appears, the camera flies to D-0001, and a patch proposal is listed.
   - They apply it.
   - End: D-0001 shows as repaired, the grade drops to C, and applying the same proposal again changes nothing.
5. **Legacy import.** Start: the Imports page with Skarvholmen Laks selected.
   - The inspector chooses the older tool's CSV and double-clicks Import, while the deck tablet uploads the same log at the same moment.
   - The summary lists created defects, rows merged into existing defects, and orphans and invalid rows with their row numbers. Exactly one import exists, and every row's defect was created once.
   - They import the same file again.
   - End: the import reports that nothing new was created, and the original file downloads byte for byte.
6. **Publish and share.** Start: Skarvholmen 01 after the dive.
   - The inspector publishes revision 2 and creates a report link that expires in 7 days.
   - The farm manager opens it on a phone, switches between the Defects and Condition tabs, orbits, unwraps and reads the grade, the defects and how long the link stays open, as the server counts it.
   - A page on another site tries to revoke the link in the inspector's browser. It is refused and the link stays active.
   - The inspector on the laptop and the deck tablet both press Regenerate link on the same row at the same moment. One device's regenerate wins. The other device shows the "link changed on another device" message and its list refreshes in place. The old URL stops working and only the winner's new URL works.
   - They revoke the link.
   - End: the link page shows the inactive message, and the Reports page on the tablet shows the link as revoked.
7. **Restore.** Start: Skarvholmen 01 with edits made after revision 1.
   - The inspector restores revision 1.
   - End: the pen again has exactly revision 1's defect ids, sizes, notes, statuses, repairs and still attachments.
8. **Client erasure.** Start: Kalamos Marine asks to be forgotten, and the farm manager still has the Kalamos 04 report link open on a phone.
   - The inspector downloads "Export all defects (CSV)" for the farm's spreadsheet. Imported notes that begin with a formula character arrive neutralised.
   - They open Search. A stray `%%` finds nothing. They type "kal" to find the farm. Then they open Farm details, choose Erase farm and type the farm name.
   - End: Kalamos Marine, its pen and its defect are gone from the Pens page, search, the CSV export and every report link, and no file of it remains in MinIO. The farm manager's open page shows the does-not-exist message at its next re-check.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Exact starting seed** A fresh install shows exactly the farms, sites, pens, defects, repair, dive, report revision and devices listed in Seed data, with the derived values printed there, and nothing else.
- **DP-02 — Pen condition cards** The Pens page shows one full-width card for the open pen, then one square card per pen, each with a procedural still of its own twin, its name and its server grade line, and the hover and keyboard-focus reveal described in Motion and effects. Cards change in place when the other device changes a pen, the card or button with keyboard focus keeps it, and an erased farm's row and cards leave the page in place.
- **DP-03 — Live pen twin** The workspace stage renders a live 3D twin of the selected pen (net wall, collar, moorings, light shafts, particles, at most 60 fish and the ROV) with one pin button per defect, and falls back to the flat chart without WebGL, as described in Motion and effects.
- **DP-04 — Pen Unwrap and Wrap** Unwrap lays the net wall flat into the metre-true chart over elapsed time, ending with every pin at its server chart position and the Scene status reading the flat-chart view, and Wrap reverses the same path back to the cylinder. Pressing the opposite control mid-run plays the progress made so far back at the pace it was made, so a run reversed 0.5 seconds after it started is back in its starting view 0.3 to 0.8 seconds later.
- **DP-05 — Keyboard pen twin** The published shortcuts orbit, zoom, unwrap, wrap, step through defects with a camera fly-to and open the editor from any focused control in the workspace, and are ignored while typing, while a dialog is open and, for the arrow, Home and End keys, while focus is on a tab. Tab follows the published workspace order at the laptop and tablet sizes, and Escape, Close editor or a successful delete closes the editor and returns focus to the pin or row that opened it, or to the placeholder row after a delete.
- **DP-06 — Touch orbit, pinch and tap** On a touch screen one finger orbits the cylinder or pans the flat chart, two fingers pinch-zoom and a tap on a pin selects its defect, and the Scene status shows the result.
- **DP-07 — Reduced motion end states** Under the reduced-motion preference every ambient loop stops and Unwrap, Wrap and camera fly-to show their end state in a single frame, while orbit, pinch, drag and the dive clock keep working.
- **DP-08 — Server-computed defect position** The server turns each typed bearing or tapped net-wall point, together with the depth, into the stored bearing, depth, chart x, chart y and panel cell by the rules in Business rules, and the browser shows only those values.
- **DP-09 — Defect sizes and fouling cover** The server computes hole, tear and chafe areas and each panel's fouling cover, splitting fouling patches at panel boundaries and across the reference seam, with the published formulas and rounding.
- **DP-10 — Pen condition grade** The server grades each pen from its open defects and fouling cover by the published grade rule, and every surface shows that grade.
- **DP-11 — Note length as people count it** Notes, private notes, repair notes and copilot questions are limited in user-perceived characters, with an emoji or a flag counting as one; the API refuses one character over the limit, and the editor's counter shows the same count.
- **DP-12 — Stills and sonar captures kept byte for byte** Stills and sonar captures within their size limits are stored in MinIO and download with exactly the uploaded bytes and the published SHA-256, and uploads over the limits are refused as described in API.
- **DP-13 — Mark a defect from the twin** The inspector enters marking mode, taps the net wall, fills in the editor and saves, and the new defect's pin, list row and cell and the pen's grade appear from the server's reply. Marking mode and a half-filled New defect editor, with its typed values, focus and caret, survive a change the other device makes to the same pen.
- **DP-14 — Edits reach every surface** Editing or deleting a defect updates its 3D pin, its flat-chart position, its list row, the farm manager's report link and the next report pack.
- **DP-15 — Defect history and removal placeholder** Every change to a defect writes a history entry naming the device and the before and after values, and a deleted defect remains everywhere as a 'Defect removed' placeholder carrying its id.
- **DP-16 — Live updates on the other device** A change saved on one device moves the pin and updates the list row on the other open device in place, with no reload, within the published delay, and the 'Console updates' live region announces it. The camera, selection and keyboard focus stay where they were, and a repair made on the other device is announced with the published copy.
- **DP-17 — Defect edit locks** Opening the editor takes a short-lived edit lock in Valkey that is refreshed while the editor stays open, and saves, deletions, repairs and still uploads from any other device are refused until the lock is released or expires. When a refresh is refused because the lock was lost, the editor shows the lock-lost copy and keeps the inspector's unsaved input.
- **DP-18 — Device presence and lock indicator** Each open console sends heartbeats, the Devices page shows each device Online or Offline as the server decides, and the other device shows 'Being edited on <device name>' while a lock is held.
- **DP-19 — Editor survives earlier timers** Reopening the defect editor while it is closing, or after a toast or lock-refresh timer from an earlier session has started, never hides the reopened editor, never refreshes a released lock and never overwrites the newer status message.
- **DP-20 — Dive planning and forecast request** The inspector plans a dive for a pen, and a forecast check calls the marine forecast provider with the site's position and the planned hours exactly as published in Services.
- **DP-21 — Clearance rules** The server decides GO, NO-GO with the first failing hour and value, or 'Forecast stale' from the provider's hourly values and issue time against its own clock, by the limits in Business rules.
- **DP-22 — Start dive needs a fresh GO** Starting a dive succeeds only when the dive's latest clearance is a GO that is still not stale on the server clock at the moment of starting, and it is refused otherwise.
- **DP-23 — Clearance shown as the server decided** The Dives page and the report link list show the clearance and link status the server returns and never recompute either from the device clock, which may be wrong. The dive clock counts up from the server's elapsed seconds, and an open planned or cleared dive whose GO has become more than 6 hours old reads stale after the page's next 30-second refresh.
- **DP-24 — Forecast outage and newest check** When the forecast provider errors, sends unusable data or does not answer in time, the check is recorded as 'Forecast unavailable' with the published status, and a reply to an earlier check never replaces a newer check's result.
- **DP-25 — Dive day from plan to recorded** The inspector plans a dive, checks the forecast to GO, starts the dive with the dive clock running, finishes it with track samples and sees it recorded with its track.
- **DP-26 — Copilot answers and camera focus** Asking the copilot sends the question and the pen's findings to the chat-completion provider, shows the answer and flies the camera to the defects its focus tool call names, and a reply to an older question never replaces a newer answer. An answer that arrives after another pen was opened is dropped, and a repair applied from a proposal reaches the other open device like any other repair.
- **DP-27 — Validated repair proposals** Repair proposals exist only from valid propose_repair tool calls, unknown or removed defect ids are dropped and listed, every other bad call is rejected with one published reason, and applying the same proposal twice records one repair.
- **DP-28 — Copilot unavailable, manual repair works** When the chat-completion provider errors, sends a malformed reply or is too slow, the copilot shows 'Copilot unavailable' and manual repairs keep working.
- **DP-29 — Legacy log matching** Importing a CSV log from the older inspection tool matches pens by site code and pen number under the published rules, merges nearby same-type marks into existing defects, creates the rest and reports orphan and invalid rows with their row numbers.
- **DP-30 — Re-import creates nothing** Importing the same file again, or a file whose rows were already imported, creates no defect, and the raw file is kept in MinIO byte for byte and downloads with its SHA-256. A file the other device imports shows its new defects in place on an open workspace of that pen and joins the Imports page list in place.
- **DP-31 — Numbered report revisions** Publishing a report creates the pen's next numbered, immutable revision, whose pack is stored in MinIO and downloads byte for byte with its published SHA-256.
- **DP-32 — Exact revision restore** Restoring a pen to a past revision brings back exactly that revision's defect ids, positions, sizes, notes, statuses, repairs and still attachments. While another device holds the lock on one of the pen's defects, Publish revision and Restore revision print the lock copy and change nothing, and a newly published revision appears in place on the other device's Reports page.
- **DP-33 — Reports page bands and counters** The Reports page shows the latest report row, the grade and open-defect counter panels and one band per revision with its flat chart, each revealed once on scroll as described in Motion and effects.
- **DP-34 — Report link lifecycle** The inspector creates a read-only report link with a chosen expiry, regenerates it so the old token stops working at once, and revokes it so it stops working at once; the link counts as expired from the server moment it reaches its expiry, its remaining time prints in whole hours and minutes rounded down, and every write through a link is refused.
- **DP-35 — Share a report with the farm** The inspector publishes a revision and creates a report link, the farm manager opens it and sees the pen, grade and defects, and after revocation the link shows the inactive message while every inspector device shows it as revoked. Links created, regenerated or revoked on one device update the other device's rows in place within the live-update delay, with the published announcement copy and without moving its keyboard focus. The list's 30-second refresh updates each row's remaining time in place and keeps keyboard focus and the caret where they were.
- **DP-36 — Report link privacy** The report link's HTML, JSON and scene data never contain the day rate, private notes, the diver certificate number, device names, lock data or history.
- **DP-37 — Farm manager report view** The report link page lets the farm manager orbit, unwrap and select pins and read the grade and defect list in its phone, tablet and laptop layouts, with no editing control. Each 15-second re-check updates only what changed and keeps the selected tab, the selected pin unless its defect was removed, the camera and keyboard focus.
- **DP-38 — Search and defect export** The console searches farms, pens and defects and exports every current defect as CSV with the published columns.
- **DP-39 — Farm erasure** Erasing a farm after typing its name removes it and everything under it from the console, search, exports, report links and MinIO, and an open report link page of that farm shows the does-not-exist message at its next re-check. The Erase farm dialog opens with focus on Cancel, Escape closes only that dialog and returns focus to Erase farm in Farm details, and the other device's Pens page drops the farm's row and cards in place.
- **DP-40 — Published layouts** Each screen shows its published arrangement at 375x812, 768x1024 and 1280x800, with nothing overlapping, cut off or scrolling sideways.
- **DP-41 — Dialogs and focus** Every dialog keeps Tab and Shift+Tab inside it, closes on Escape and returns focus to the control that opened it, and every action works by keyboard with a visible focus ring. A dialog opened from inside another dialog closes alone on Escape, and every download link saves a file with exactly the stored bytes without leaving the page. The Keyboard shortcuts dialog that ? opens on the report link page follows the same rules.
- **DP-42 — One error shape** Every refusal uses the one published error JSON shape, the exact status code for its cause and the published precedence. A call that never reaches the server prints the unreachable copy, and the inspector's typed input stays.
- **DP-43 — Health and boot** The server answers its health check, applies its schema and seed idempotently on every start, and keeps serving the console when the third-party providers are unreachable.
- **DP-44 — Abyssal, clinical console look** The console is near-black, with white type, white pins and white tabular figures with their units; colour appears only in the water and in the stone, paper and olive report fields, and the layout follows the composition in Visual design.
- **DP-45 — Real services behind every state** Every record, file, heartbeat, lock and broadcast lives in Postgres, MinIO or Valkey as published, the providers are called over HTTP at the configured base URL, and no credential reaches the browser or appears in the source.
- **DP-46 — First-open copy verbatim** A fresh install shows the grade lines, day rates, Devices header and rows and Scene status lines listed under First-open copy in Seed data character for character, including the dash, the middle dot and the singular and plural defect counts.
- **DP-47 — Imports applied one at a time** Imports of one farm are applied one at a time in arrival order, so two simultaneous byte-identical uploads give one created import and one replay with the same import id, and a row shared by two simultaneous files creates its defect exactly once.
- **DP-48 — Regenerate has one winner** Regenerating a report link requires the token the device shows, a stale token is refused with the published 409 copy while the list refreshes in place, exactly one of two simultaneous regenerates wins, and a regenerate racing a revoke always ends revoked with every token refused.
- **DP-49 — Tabs and collapsed panels** The phone 'Pen panels' and 'Report panels' tab lists follow the published arrow-key, Home and End behaviour without orbiting the camera, and every unselected tab panel, collapsed footer column and closed menu is hidden, unfocusable and absent from the accessibility tree.
- **DP-50 — Formula-safe defect export** The defect CSV export writes a leading apostrophe before any text cell that starts with =, +, -, @, a tab or a carriage return, while stored notes, the API, the report link, report packs and raw imports keep the original text.
- **DP-51 — Search shows the newest input** The Search dialog's results and 'Search status' always describe the text now in the box, a late reply to an earlier query is discarded, and under 2 characters the status asks for more. Choosing a defect result opens that pen's workspace at its canonical address with the defect selected and the camera facing it.
- **DP-52 — Workspace address holds view and selection** The workspace address records the settled view and the selected defect without adding history entries, and loading such an address shows that end state in a single frame with the published Scene status lines, dropping unknown or removed defect ids and reading any other view value as the cylinder.
- **DP-53 — Bounded literal search** Search text is trimmed and holds at most 100 user-perceived characters, 101 gets the published 422, and every character, including %, _ and the backslash, matches literally.
- **DP-54 — Copilot request carries only the findings context** The chat-completion request holds exactly two messages, the published findings context with exactly eight keys per non-removed defect and the question exactly as asked, and never a private note, day rate, certificate number, device, lock, version, still, history or Authorization header.
- **DP-55 — Simultaneous defect writes have one winner** Writes to one defect are applied one at a time, so of simultaneous saves, repairs or deletions exactly one is applied, the others get the published 409, and no write lands after a removal.
- **DP-56 — Report link countdown from the server** The report link page prints its expiry line from the server's expires_in_s at load and at each 15-second re-check, and shows the inactive message within 20 seconds after expiry, whatever the phone's clock reads.
- **DP-57 — Cross-site writes refused** Any POST, PATCH or DELETE under /api whose Origin is present and foreign, including null, gets the published 403 and changes nothing, and no response carries cross-origin allow headers.

## Frontend

### Screens and layout (DP-02, DP-03, DP-33, DP-37, DP-40, DP-49, DP-52, DP-56)

**Routes and devices.** The console's routes are `/` (Pens), `/pens/<pen id>` (pen workspace, with the optional `view` and `defect` parameters described under Workspace address in Interactions), `/dives`, `/imports`, `/reports` and `/devices`. The farm manager's page is `/r/<token>`. Any console route accepts `?device=<device id>`. It makes this browser that device and remembers the choice. A browser that has never chosen is the Topside laptop.

**Layout widths.** Layouts switch at fixed widths:
- Below 600 px wide: the phone layout. 375x812 always gets it.
- From 600 px to 1099 px: the tablet layout. 768x1024 always gets it.
- From 1100 px: the laptop layout. 1280x800 always gets it.

No screen scrolls sideways at any of the three sizes. No control or text overlaps another or is cut off.

**Pensight top navigation bar.** A fixed black bar across the top of every console page.
- The small Pensight wordmark sits at the left gutter. Pens, Dives, Imports, Reports and Devices are centred. A Search button sits on the right.
- At 768 and 1280 every link is visible.
- On phones, a Menu button with a two-bar icon replaces the links and opens the menu dialog.
- The report link page uses the same bar with only the wordmark and the words "Read-only report".

**Pens page.** This page is the **pen condition card grid**.
- Under the bar, inside the page gutters, sits one full-width **pen condition card** for the open pen. The open pen is the pen most recently opened in this browser, or Skarvholmen 01 on a fresh browser. If that pen has since been erased, the open pen is the most recently opened pen in this browser that still exists, or Skarvholmen 01 when none does; when the erasure arrives from the other device, the card switches in place.
- Rows of square pen condition cards follow, one per pen in the published pen order. There are three per row at 1280, two per row at 768 and one per row on phones.
- Every card shows a procedural canvas still of its own twin (net rings and that pen's white pins on black water), a dark scrim along its bottom, the pen name in large white type at the lower left, the grade line, and an arrow at the lower right that appears on hover or focus.
- The card is a link to the pen's workspace.
- Below the grid, a black Farms band lists each farm's name and sites, each with a Farm details button.
- Cards update in place when a change arrives from the other device. When the other device erases a farm, its row in the Farms band and its pens' cards leave the page in place.

**Pen workspace.**
- At 1280x800, four columns sit side by side under the bar on a 12-column grid and fill the rest of the viewport height: the pen list (2 columns), the **3D pen stage** (5 columns), the Copilot panel (2 columns) and the defect panel (3 columns). A column that is taller than the viewport scrolls inside itself.
- At 768x1024, a horizontal strip of pen buttons sits under the bar. The 3D pen stage spans the full content width at a little over half the viewport height. Below it, the defect panel (about three fifths of the width, on the left) and the Copilot panel (on the right) sit side by side.
- At 375x812, a Pen picker sits under the bar. The stage spans the full width inside the narrow phone gutters at a little under half the viewport height. Below the stage sits the tab list "Pen panels" with the tabs Defects, Copilot and Pens, and only the selected tab's panel is shown.

The stage shows the pen name very large at its lower left and the Scene status region at its lower right. The Unwrap or Wrap button and the Mark defect button sit along its top edge. The defect panel holds the defect list. The editor, when open, slides over the defect panel within that column.

**Dives page.**
- At 1280 the list of dives (newest first) sits beside a dive detail panel. At 768 and on phones the list sits above the detail.
- The detail shows the pen, the planned start and length, the clearance with its hourly table (time, current, wave height, within limits), the dive clock, the track table, and the sonar captures with download links.

**Imports page.**
- At the top: a farm picker, the CSV file chooser and the Import button.
- Below them, the latest import's summary in five tables: Created, Merged, Already imported, Orphans and Invalid.
- Then the farm's past imports, each with a link to download the original file. When the other device imports a file for the farm shown, its import joins the top of this list in place within 3 seconds.

**Reports page.** A pen picker and the Publish revision button sit at the top, on black. Then, in order:
- **Latest report row.** A full-width paper band with the latest revision's publish date, a headline naming the pen and its grade, and an excerpt giving the open-defect count. The latest flat chart sits on the right in a media frame. On phones the chart comes first, then the text.
- **Grade and defect counter panels.** Two half-width panels side by side. The first is olive with white type and is headed "Condition grade". The second is stone with black type and is headed "Open defects". Each holds a small flat-chart frame and a very large light numeral whose baseline overlaps the lower edge of the frame: the grade letter in the first panel and the open-defect count in the second. On phones the panels stack.
- **Report revision bands.** One band per revision, newest first. Each is a stone band with a thin dark rule along its top. "Revision <n>" is set very large on the left. Under it sit the publish date, the grade, the open count, and the Download pack and Restore buttons. The flat net chart of that revision is drawn on the right. On phones the chart comes first.
- **Report links.** The Report links region for the selected pen, with a Create report link button and one row per link.

**Devices page.** One row per device, with its name, Online or Offline, and a "Use this browser as <device name>" button. A line at the top states which device this browser is.

**Console footer columns.** A black footer with a large wordmark on the left and three columns:
- Console: the five page links.
- Data: the "Export all defects (CSV)" link.
- Help: the Keyboard shortcuts button.

On phones each column becomes an accordion row with a plus sign that turns into a cross when opened. Every column starts collapsed.

**Report link page (`/r/<token>`).**
- At 1280x800, the stage takes the left 8 of 12 columns. A right column holds the Condition region (grade, open-defect count, latest revision number and date, and the link expiry line) above the Defects region.
- At 768x1024, the stage spans the full content width, with Condition and Defects side by side below it.
- At 375x812, the stage sits above the tab list "Report panels" with the tabs Defects and Condition, and only the selected tab's panel is shown.

The page has no editor, Mark defect, copilot, history or link controls.

**Empty and loading states.** A pen with no defects shows the empty-state statement in place of the list. A loading pen keeps the stage black and shows the loading line in the Scene status. Both texts are in Feedback states.

### Public screens and controls (DP-02, DP-05, DP-06, DP-13, DP-17, DP-18, DP-26, DP-34, DP-37, DP-38, DP-39, DP-41, DP-48, DP-49, DP-51, DP-52, DP-53, DP-56)

Only the controls and regions below are public. Everything else is free. `<…>` marks values that come from the server.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Every console page | `navigation "Main"` with `link "Pens"`, `link "Dives"`, `link "Imports"`, `link "Reports"`, `link "Devices"` | Phones: `button "Menu"` opens `dialog "Menu"` holding the same links |
| Every console page | `link "Pensight home"` | The wordmark |
| Every console page | `button "Search"` opens `dialog "Search"` | Holds `searchbox "Search farms, pens and defects"`, `list "Search results"` (one link per result) and `status "Search status"` |
| Every console page | `status "Console updates"` | Announces changes from the other device, and toasts |
| Footer | `link "Export all defects (CSV)"`; `button "Keyboard shortcuts"` opens `dialog "Keyboard shortcuts"` | Phones: accordion headers `button "Console"`, `button "Data"`, `button "Help"`, each with its expanded state |
| Pens page | `link "<pen name>"` per square pen condition card; the open-pen card is `link "Open pen <pen name>"` | Grade line from Feedback states |
| Pens page | `img "<pen name> twin still"` | The card's canvas still |
| Pens page | `button "Farm details: <farm name>"` opens `dialog "Farm details"` | Shows the farm name, its sites with codes and positions, the day rate as `<amount> <currency> per day` (`<amount>` is the whole amount with no thousands separator), and `button "Erase farm"` |
| Farm details | `button "Erase farm"` opens `dialog "Erase farm"` | Holds `textbox "Type the farm name to confirm"` and `button "Erase"` |
| Workspace | `list "Pens"` of `link "<pen name>"`; phones: `combobox "Pen"` | |
| Workspace | `region "Pen stage"` holding `img "3D twin of <pen name>"` (the canvas) | |
| Workspace | `button "Unwrap"` (cylinder view) or `button "Wrap"` (flat-chart view) | Exactly one of the two is present. It is one control whose name changes: it keeps keyboard focus when its name changes |
| Workspace | `button "Mark defect"` | Pressed state while marking mode is on |
| Workspace | `button "Pin <defect id>"`, one per non-removed defect, laid over the stage at the pin's position | Hit area at least 44 px square; the selected pin has pressed state |
| Workspace | `status "Scene status"` | Lines from Feedback states |
| Workspace | `region "Defects"` holding `list "Defect list"`; each row is `button "<defect id>, <type>"`, or `button "<defect id>, Defect removed"` for a placeholder | Cylinder view row text: "<defect id> <type> <bearing>° <depth> m", plus "Repaired" when repaired. Flat-chart row text: "<defect id> <type> panel <cell>". Placeholder text: "<defect id> Defect removed". Lock line from Feedback states |
| Defect panel | `region "Defect editor"` | Heading "Edit <defect id>" or "New defect" |
| Defect editor | `combobox "Type"` (new defects only), `textbox "Bearing (°)"`, `textbox "Depth (m)"` | |
| Defect editor | Hole: `textbox "Width (cm)"`, `textbox "Height (cm)"`. Tear: `textbox "Length (cm)"`, `textbox "Gap (cm)"`. Chafe: `textbox "Length (cm)"`, `textbox "Width (cm)"`. Fouling: `textbox "Width (m)"`, `textbox "Height (m)"` | |
| Defect editor | `textbox "Note"` and `textbox "Private note"`, each with its counter | Counter copy from Feedback states |
| Defect editor | Read-only server values: chart x, chart y, cell, and area or patch area | Each number with its unit |
| Defect editor | `button "Save"`, `button "Close editor"`, and `button "Delete defect"`, which opens `dialog "Delete defect"` with `button "Delete"` | |
| Defect editor | `button "Attach still"` (file chooser for JPEG or PNG); `list "Stills"` with `link "Download still <still id>"` | |
| Defect editor | `combobox "Repair method"` (Patch, Lace, Replace panel, Clean), `textbox "Repair note"`, `button "Record repair"` | |
| Defect editor | `list "History"` | One item per entry: time, device name, action, and "<field>: <before> → <after>" lines |
| Defect editor | `status "Editor status"` | |
| Workspace | `region "Copilot"` holding `textbox "Ask the copilot"`, `button "Ask"`, the answer text, `button "Show <defect id>"` per focused defect, `button "Apply repair to <defect id>"` per proposal, and `status "Copilot status"` | |
| Phone workspace | `tablist "Pen panels"` with `tab "Defects"`, `tab "Copilot"`, `tab "Pens"`, each controlling `tabpanel "Defects"`, `tabpanel "Copilot"`, `tabpanel "Pens"` | Defects is selected on load |
| Dives | `button "Plan dive"` opens `dialog "Plan dive"` holding `combobox "Pen"`, `textbox "Planned start (UTC)"`, `textbox "Planned minutes"`, `textbox "Diver certificate number"`, `button "Plan"` | Planned start is written `YYYY-MM-DD HH:MM` in UTC; the console sends it as `YYYY-MM-DDTHH:MM:00Z`. It defaults to the next whole hour on the server clock. Planned minutes defaults to 90 |
| Dives | `list "Dives"`, each row `button "<dive id>, <pen name>"` | Each row ends with its status word |
| Dive detail | `button "Check forecast"`, `button "Start dive"`, `button "Finish dive"`, `button "Attach sonar capture"` | |
| Dive detail | `textbox "Track samples"` | One sample per line as `t_s,bearing_deg,depth_m` (for example `0,0.0,1.0`); blank lines are ignored; `button "Finish dive"` sends them |
| Dive detail | `status "Dive status"` | `Dive status: planned`, `Dive status: cleared`, `Dive status: started` or `Dive status: recorded` |
| Dive detail | `status "Clearance status"`, `table "Forecast hours"`, `timer "Dive clock"`, `table "Track"`, `link "Download sonar <capture id>"` | Dive clock text is "hh:mm:ss" |
| Imports | `combobox "Farm"`, `button "Choose legacy CSV"` (file chooser), `button "Import"`, `status "Import status"` | |
| Imports | `table "Created"`, `table "Merged"`, `table "Already imported"`, `table "Orphans"`, `table "Invalid"` | Each table has a "Row" column holding the file's row number |
| Imports | `link "Download original <file name>"` per past import | |
| Reports | `combobox "Pen"`, `button "Publish revision"`, `status "Report status"` | |
| Reports | `region "Latest report"`, `region "Condition grade"`, `region "Open defects"` | |
| Reports | `region "Revision <n>"` holding `heading "Revision <n>"`, `link "Download pack"`, and `button "Restore revision <n>"`, which opens `dialog "Restore revision"` with `button "Restore"` | |
| Reports | `region "Report links"` with `button "Create report link"`, which opens `dialog "Create report link"` holding `radiogroup "Expires in"` (`radio "24 hours"`, `radio "7 days"`, `radio "30 days"`) and `button "Create link"` | |
| Report link row | `textbox "Report link URL"` (read-only, showing the link's current URL), `button "Copy link"`, `button "Regenerate link"`, and `button "Revoke link"`, which opens `dialog "Revoke link"` with `button "Revoke"` | Status line from Feedback states |
| Devices | `button "Use this browser as <device name>"` | Header and row copy from Feedback states |
| Report link page | `region "Pen stage"`, `button "Unwrap"` or `button "Wrap"`, `button "Pin <defect id>"`, `status "Scene status"`, `region "Condition"` (holding the link expiry line from Feedback states), `region "Defects"` with `list "Defect list"` | Phones: `tablist "Report panels"` with `tab "Defects"` and `tab "Condition"`, controlling `tabpanel "Defects"` and `tabpanel "Condition"`; Defects is selected on load |

### Interactions (DP-04, DP-05, DP-06, DP-13, DP-16, DP-17, DP-19, DP-26, DP-41, DP-48, DP-49, DP-51, DP-52, DP-53)

**Keyboard shortcuts in the workspace and on the report link page.** The shortcuts work wherever focus is on the page, including on a button, a pin or a list row. They are ignored in three cases:
- Focus is in a text field, text area, search box or combobox.
- Any dialog is open.
- For Left Arrow, Right Arrow, Home and End only: focus is on a tab in either tab list. Those keys then act on the tab list and never move the camera, so the Scene status camera line stays the same.

| Key | Effect |
|---|---|
| Left Arrow / Right Arrow | Cylinder: orbit the camera 15°. Left lowers the camera azimuth and Right raises it, wrapping within 0 to 359. Flat chart: pan one panel left / right |
| Up Arrow / Down Arrow | Cylinder: tilt the camera 10° up / down, limited to 40° above and 40° below level. Flat chart: pan one panel row up / down |
| + or = / - | Zoom in / out by 0.25×, between 0.50× and 3.00× |
| U | Unwrap (does nothing in the flat-chart view) |
| W | Wrap (does nothing in the cylinder view) |
| N / P | Select the next / previous non-removed defect in id order, wrapping round, and fly the camera to it |
| E, or Enter on a selected pin | Open the editor for the selected defect (console only) |
| M | Toggle marking mode (console only) |
| ? | Open the Keyboard shortcuts dialog |

**Workspace address.** The workspace address always has the form `/pens/<pen id>?view=cylinder` or `/pens/<pen id>?view=flat`, followed by `&defect=<defect id>` while a defect is selected.
- The console rewrites the address by replacing the current history entry, never by adding one. The number of history entries never grows from these changes.
- The `view` value changes when an Unwrap or Wrap run settles, never mid-run.
- The `defect` parameter changes whenever the selection changes (pin, list row, N, P, copilot focus or "Show <defect id>"), and is removed when the selection becomes none.
- Loading an address shows its end state in a single frame. No Unwrap, Wrap or fly-to plays, and the view line never reads the unwrapping or wrapping state during the load.
  - `view=flat` shows the flat chart with the camera line in its flat-chart form.
  - In the cylinder view, a `defect` points the camera straight at that defect's bearing, so the camera line reads its bearing rounded to a whole degree. For example, with the seed data at start, `/pens/skv-01?defect=D-0002` reads `Camera: 237°`.
  - The selected line names the defect, and the ROV hangs near it.
- On load the console puts the address into its canonical form at once:
  - A missing `view`, or any value other than `cylinder` or `flat`, becomes `view=cylinder`.
  - A `defect` that is unknown, removed or belongs to another pen is dropped, and the selected line reads none.
  - For example, `/pens/skv-01?defect=D-9999&view=sideways` becomes `/pens/skv-01?view=cylinder`.
- Without WebGL the view is always `flat`.

**Tab lists ("Pen panels" and "Report panels").**
- Only the selected tab is in the Tab order. Tab from it moves into the selected panel.
- Left Arrow and Right Arrow move focus to the previous or next tab and select it, wrapping round. Home selects the first tab and End the last.
- A tap or click selects a tab.
- Every unselected tab panel is hidden: it is not shown, none of its controls can be focused, and it is absent from the accessibility tree.

**Collapsed and closed containers.**
- On phones, a collapsed footer column's links are hidden, cannot be focused and are absent from the accessibility tree. With every column collapsed, Tab through the footer visits only the three accordion headers.
- Once `dialog "Menu"` closes, none of its links can be focused or reached by assistive technology.
- Moving a container off-screen never counts as closing it.

**Tab order in the workspace.** The order is: top bar, pen list (or the phone tab list), stage controls (Unwrap or Wrap, Mark defect, then pins in id order), Copilot, defect list, the editor when open, then the footer. At the laptop and tablet sizes this order holds whatever the panels' visual placement; on phones, the tab list rules above decide where Tab goes from the tab list. Every control shows a thin white focus ring set slightly outside its edge.

**Pointer and touch on the stage.**
- In the cylinder view, dragging with the mouse or one finger orbits. Dragging left raises the camera azimuth and dragging right lowers it. A drag left across the full stage width raises it by 180°, give or take 20°.
- In the flat chart, the same drag pans.
- The mouse wheel or a two-finger pinch zooms within the published range.
- A click or tap on a pin selects that defect (shown on the Scene status "Selected" line), pulses its pin and highlights its list row. Clicking a list row does the same and flies the camera to the pin.
- The browser's own page zoom never starts inside the stage.

**Marking a defect.**
1. Mark defect (or M) turns on marking mode, and the Scene status adds the marking line.
2. The next click or tap on the net wall opens the editor as "New defect", with the position marked "From the net wall". When the inspector saves, the console sends the tapped point in the pen's own frame, described in Business rules. The inspector may instead type a bearing and depth.
3. Save sends the defect. The pin, list row, cell, area and grade then appear from the server's reply, never from browser arithmetic.

Escape, or a second press of Mark defect, leaves marking mode.

**Editor.**
- Opening the editor (a row double-click, E, or the "Edit" action on a selected row) takes the edit lock and refreshes it while the editor stays open.
- Close editor, Escape or a successful delete releases the lock, closes the editor and returns focus to the row or pin that opened it. After a delete, focus goes to that defect's placeholder row.
- Enter in a single-line field saves.
- If another device holds the lock, the editor opens read-only and shows the lock line. Save, Delete defect, Attach still and Record repair are disabled.
- The note counters update on every keystroke and count as described in Business rules.
- How the editor behaves when it is reopened during earlier timers is set out in Feedback states.

**Live updates.**
- While a pen is open, every change from the other device changes the pin, row, grade and indicators in place, with no reload. The current camera, selection and scroll are kept. Changes include create, edit, delete, repair, restore, a lock taken or released, and a link created, regenerated or revoked. Keyboard focus is kept as well: on every console page, a change from the other device updates only the parts it changes, so the control that has keyboard focus keeps it while it still exists. The same holds for the console's own saves and for every timed refresh and re-check (Dives page, Report links list, Devices page and the report link page): the focused control keeps focus, and the caret and any typed-but-unsent text in a field stay as they were. When the focused item goes away, focus moves to a fixed fallback: in the console, from a removed defect's pin or row to that defect's placeholder row; on the report link page, from a removed defect's pin to the pin of the next remaining defect in id order, or of the previous one when none follows; and from an erased farm's pen card or `Farm details` button to the card or `Farm details` button before it on the page. An erase made on this device closes both of its dialogs and follows the same fallback.
- A change from the other device is announced in `status "Console updates"` with its copy from the "Change from the other device" row of the action table. A change with no copy in that row (a lock taken or released, an import or a published revision) shows in place without an announcement.
- If the defect being edited locally is changed remotely, the editor keeps the inspector's unsaved input and shows the conflict copy on save.
- A device whose write lost a simultaneous race prints its refusal copy, and its pin and row show the server's values from the winning write.
- The Report links list on the other device updates its rows in place, including `textbox "Report link URL"`.

**Copilot.**
- Ask (or Enter in the question field) sends the question exactly as typed, including surrounding spaces.
- When an answer arrives, the camera flies to the first focused defect and selects it, and the Scene status focus line lists every focused id.
- "Show <defect id>" flies to that defect. "Apply repair to <defect id>" applies the proposal. A proposal whose defect the other device repairs or removes loses its Apply button within 3 seconds and shows `<defect id> is already repaired` or `<defect id> was removed` in its place.

**Dialogs.**
- Every dialog keeps Tab and Shift+Tab inside it: Tab on the last control goes to the first, and Shift+Tab on the first goes to the last.
- Escape closes the dialog, and focus returns to the control that opened it. When a dialog was opened from inside another dialog, Escape closes only the top dialog, and focus returns to its opener in the dialog below, which stays open.
- Confirm dialogs (`dialog "Delete defect"`, `dialog "Restore revision"`, `dialog "Revoke link"` and `dialog "Erase farm"`) place initial focus on their cancel control, labelled "Cancel".

**Pen condition cards.** Hover or keyboard focus plays the reveal in Motion and effects. Enter opens the pen.

**Search.**
- Typing in the search box updates the results in place about a quarter of a second after the last keystroke, with no submit button.
- Each result is a link: a farm to its section of the Pens page, a pen to `/pens/<pen id>`, and a defect to `/pens/<pen id>?defect=<defect id>`.
- When the server refuses the text as too long, the console empties the list and prints the refusal in the search status.
- Which reply is shown is set by Feedback states.

**Report links.**
- Copy link copies the absolute URL and shows the copy confirmation.
- Regenerate link sends the token its row currently shows. The row updates in place with the new URL.
- When regenerate is refused because the token changed, the console reloads the Report links list in place and prints the refusal copy.
- Revoke link asks for confirmation first, then updates the row in place.

**Device clock.** The laptop's, tablet's and phone's own clocks may be wrong by hours or days. No screen decides GO, NO-GO, stale, expired, remaining link time, Online or Offline from the device clock. It shows what the server returns, refreshed on the schedule in Business rules. The dive clock counts up from the server's elapsed seconds using the browser's elapsed time, never its wall-clock time.

### Visual design (DP-02, DP-33, DP-44)

The look comes from the dealt design direction. It has three qualities:
- **Abyssal.** The page ground is near-black, and the stage's deep-water fog fades into exactly that black, so the edge of the stage cannot be seen.
- **Clinical.** Every bearing, depth, area, percentage, count and clock is a white figure from the tabular set (all digits the same width), always followed by its unit. No number relies on a coloured badge.
- **Cinematic.** On the Pens page, the open-pen card spans the full width between the gutters. On the report link page, the stage does the same at 768 and 375, and takes its 8 columns at 1280.

**Typefaces.**
- Inter Tight is the display face, used for pen names, revision headings, empty-state statements and the counter numerals. It is set in light to medium weight, with slightly tight letter spacing and lines set close together.
- Inter is used for everything else, in regular and medium weights, with tabular figures for every number.
- Display headings are about four times the body size, and card titles about one and a half times. Each step between sizes is about a quarter larger than the one below.
- Labels are small, in sentence case and in the muted grey. They are never set in all capitals or letter-spaced. Capitals appear only where the copy itself has them.

**Colour roles.**
- Near-black ground for the page, bar, panels and footer.
- Pure white ink on dark, and near-black ink on light fields.
- A mid grey for muted labels on dark.
- A cool stone grey for report revision bands and the second counter panel.
- A warm paper off-white for the latest report row.
- A dark olive for the first counter panel.
- A thin dark rule at about one third strength. It is used only on light fields, to separate revisions.
- There is no accent colour and there are no status colours. The only hue is the cold blue-green of water near the surface, inside the 3D scene and the card stills.
- Type on stone and paper is near-black, and type on olive is white. Every text and background pair meets WCAG 2.2 AA contrast.

**Density and composition.**
- Density is comfortable, with roomy rows.
- The 12-column grid has even gaps. Gutters are wide on laptop and tablet and narrow on phones.
- Media frames (the stage, card stills and chart frames) have barely rounded corners. Everything else is square.
- Every tappable control is at least 44 px in both directions.

**Working screens in the same language.**
- The defect list and editor are black panels with large white rows.
- Fields are underlined inputs with no box.
- Errors print the published message in white beside an alert-triangle line icon, never as colour alone.
- Empty states are a single large statement heading on black.
- Loading keeps the stage black with the loading text.
- Icons are simple line icons with no fill.

**Hero.** The 3D pen stage is the hero.
- The net wall is a procedural diamond mesh, barely lit, so defects read as small white pins in deep water.
- The floating collar ring sits at the surface, and mooring lines run out of frame.
- Pale light shafts fall from the surface, faint particles drift, and a school of small dark fish circles inside the net.
- A small ROV hangs on its tether near the selected defect, with a soft lamp cone.
- The pen name sits very large at the stage's lower left, and the Scene status sits in white tabular figures at its lower right.

### Motion and effects (DP-02, DP-03, DP-04, DP-06, DP-07, DP-33)

**Live twin idle motion.** These are the only loops:
- The fish school circles the pen once every 30 to 60 seconds.
- Particles drift slowly upwards and cross the stage height in 20 to 40 seconds.
- The light shafts sway once every 8 to 12 seconds.
- The selected pin pulses once every 1.5 to 2.5 seconds.

The camera never moves by itself, and no other decorative loop runs anywhere in the console. Rendering pauses while the page is hidden.

**Input motion.** Dragging orbits immediately. When the finger lifts, the orbit glides briefly and settles in under half a second. Zoom steps settle in about a quarter of a second.

**Camera fly-to.** N, P, a list row, "Show <defect id>" or a copilot answer can focus a defect. The camera then glides to face it over 700 to 1400 milliseconds, starting quickly and settling softly. The ROV moves over the same time to hang near that defect.

**Pen Unwrap (signature).** The run takes 1.2 to 1.8 seconds in total, about 1.4 seconds nominal, with a fast start and a long soft settle. Progress follows elapsed time: a slow software renderer skips frames but ends in the same place inside the same time. Pressing Unwrap or U plays these steps in order, partly overlapping:
1. The Scene status view line changes to the unwrapping state, and the camera turns to face the pen's 0° reference bearing.
2. The net wall splits along the 0° line and its vertices travel from the cylinder to a plane. The two cut edges swing outwards to the left and right, and the far side (180°) comes forward to the centre.
3. The collar ring straightens into the chart's top edge.
4. The mooring lines and fish school fade out.
5. Every pin rides its own vertex and ends at its server chart x and chart y inside its panel cell. 0° is at the chart's left edge and the circumference at its right edge. Depth increases downwards at the same metres-per-pixel scale as x.
6. The panel grid lines, column letters and row numbers fade in last.
7. When the run settles, the view line reads the flat-chart state, the button becomes Wrap, list rows show their cells, and the workspace address records the new view.

Wrap (button or W) plays the same path backwards: the labels fade out, the pins ride back, the moorings and fish fade in, the collar curves, the wall closes, and the view line reads the cylinder state. Pressing the opposite control mid-run reverses from the current progress. A reversed run plays the progress made so far back at the pace it was made, so a run reversed 0.5 seconds after it started is back in its starting view 0.3 to 0.8 seconds after the reversal.

**Pen condition card reveal.** On hover or keyboard focus:
- The still grows by about 3% inside its frame over about one second, settling softly.
- The scrim darkens slightly over about a third of a second.
- The grade line rises a short distance and fades in over about a fifth of a second.
- The arrow fades in.

Leaving reverses each step with the same timings. Keyboard focus also shows the white focus ring. On touch screens the grade line and arrow are always shown.

**Report revision bands.** The first time each band or the latest report row scrolls into view, it rises a little and fades in over about one second. Bands that come into view together are staggered by about 80 milliseconds. Bands never animate a second time.

**Panels.** The editor slides in from the right of its column over about a quarter of a second, and slides out the same way. Dialogs fade in in under a fifth of a second. Toasts fade.

**Reduced motion.** Under the reduced-motion preference:
- The fish, particles, light shafts and pin pulse stop and hold still.
- Unwrap and Wrap jump to their end state in a single frame. The pins are at their end positions, the grid labels are shown, and the Scene status, button and address update at once.
- Camera fly-to jumps to its end pose, and the ROV jumps with it.
- Card reveals show the grade line and arrow permanently with no growth, and hover only darkens the scrim.
- Revision bands appear in place with no rise.
- The editor and dialogs appear with no slide.
- Orbit, pinch, drag, pin taps and the dive clock keep working exactly as without the preference.

**Without WebGL.** The stage shows a still, two-dimensional flat chart of the pen, with the same pin buttons at their chart positions and the panel grid. The view line reads the flat-chart state and the no-WebGL line is shown. Unwrap and Wrap are absent.

### Feedback states (DP-11, DP-12, DP-16, DP-18, DP-19, DP-21, DP-22, DP-23, DP-24, DP-26, DP-27, DP-28, DP-29, DP-30, DP-31, DP-32, DP-34, DP-38, DP-39, DP-46, DP-48, DP-51, DP-52, DP-53, DP-55, DP-56)

This section owns all status copy.
- Placeholders such as `<defect id>`, `<device name>` and `<n>` come from the server's reply.
- Times print in UTC as `HH:MM UTC`, and dates as `YYYY-MM-DD`.
- When an API refusal has copy here, the API's `message` is that exact copy and the UI prints it. While an action's request is in flight, its Pending copy below shows in the Region of its row and its button is disabled, and pressing it again, or Enter in one of its fields, sends nothing. Check forecast, Ask, search and Import follow Newest action wins instead.
- Copy renders character for character. Every dash in the copy is the em dash (U+2014) with one space on each side. The grade-line separator is the middle dot (U+00B7) with one space on each side. Apostrophes are straight.
- Counts use the singular only when the count is exactly 1 (`1 open defect`, `1 result`, `1 orphan`) and the plural otherwise, including 0 (`0 open defects`, `0 results`, `0 orphans`). In the Import copy only `orphans` follows this rule; `created`, `merged`, `already imported` and `invalid` never change.

**Pen grade line** (cards, latest report row, Condition region): `Grade <letter> — <label> · <n> open defects`.

**Scene status** (`status "Scene status"`). Each line is its own line of text. The lines appear in this order: view, camera, zoom, selected, focus, dive clock. Then come the marking, loading and no-WebGL lines, when they apply.
- `View: Cylinder`, `View: Unwrapping`, `View: Flat chart` or `View: Wrapping`.
- In the cylinder view, `Camera: <azimuth>°`: the net-wall bearing the camera faces, rounded to a whole number with halves rounding up and wrapped to 0 to 359. It is 0 when a pen first opens with no defect in its address. In the flat-chart view, `Camera: flat chart`.
- `Zoom: <z>×` with two decimals.
- `Selected: <defect id>` or `Selected: none`.
- `Focus: <defect id>, <defect id>` or `Focus: none`. Only a copilot answer sets this line. It lists the answer's `focus` ids in order, or reads `Focus: none` when the answer's `focus` is empty.
  - It resets to `Focus: none` when a new question is sent, when the copilot outage copy shows, when another pen is opened, and when the page loads or reloads.
  - N, P, a list-row click, a pin click or tap, and "Show <defect id>" change only the selected line and the camera, never the focus line.
  - On the report link page the line always reads `Focus: none`.
- `Dive clock: <hh:mm:ss>` while a dive on this pen is started, otherwise `Dive clock: no dive running`.
- While marking: `Marking: tap the net wall`.
- While the pen loads: `Loading pen`. The line goes away once the defect list has filled.
- Without WebGL: `3D view unavailable — showing the flat chart`.

**Empty state:** `No defects marked on this pen`.

| Action | Pending | Success | Refusal or outage | Region |
|---|---|---|---|---|
| Save defect | `Saving…` | `Saved <defect id>` | A field error under its field with the alert icon. 409 version conflict: `<defect id> changed on another device — reopen to see the latest`. 409 removed: `<defect id> was removed`. 423: `Being edited on <device name>` | `status "Editor status"` |
| Note fields | — | Counter `<n> / 500` | Over the limit: `Note is longer than 500 characters` under the field. Save stays enabled so the server refusal shows | `status "Editor status"` |
| Delete defect | `Removing…` | `Removed <defect id>` | The removed and 423 copy above | `status "Editor status"` |
| Attach still | `Uploading still…` | `Attached still <still id>` | `Still is larger than 8,000,000 bytes`; `Stills must be JPEG or PNG` | `status "Editor status"` |
| Record repair | `Recording repair…` | `Repair recorded for <defect id>` | `<defect id> is already repaired`; the removed copy above | `status "Editor status"` |
| Edit lock lost (expired, or refused on refresh) | — | — | `Your edit lock expired — reopen the editor to continue` | `status "Editor status"` |
| Change from the other device | — | `<device name> marked <defect id>`, `<device name> updated <defect id>`, `<device name> removed <defect id>`, `<device name> recorded a repair on <defect id>`, `<device name> restored revision <n> of <pen name>`, `Report link created`, `Report link revoked`, `Report link regenerated` | — | `status "Console updates"` |
| Check forecast | `Checking forecast…` | GO: `GO — every planned hour is within limits`. NO-GO: `NO-GO — current <value> m/s at <HH:MM> UTC` or `NO-GO — wave height <value> m at <HH:MM> UTC`, with the value to two decimals. Stale: `Forecast stale — issued <HH:MM> UTC <YYYY-MM-DD>, more than 6 hours ago` | `Forecast unavailable — try again shortly` | `status "Clearance status"` |
| Start dive | `Starting dive…` | `Dive started` | `Dive needs a fresh GO before it can start`; `Dive has already started`; `Dive is already recorded` | `status "Clearance status"` |
| Finish dive | `Finishing dive…` | `Dive recorded` | `Track row <i> is invalid: <reason>` under `textbox "Track samples"` with the alert icon, where `<i>` is the 1-based line number; 409 `Dive is not running` | `status "Clearance status"` |
| Attach sonar capture | `Uploading sonar capture…` | `Attached sonar capture <capture id>` | `Sonar capture is larger than 20,000,000 bytes` | `status "Clearance status"` |
| Ask copilot | `Asking copilot…` | `Copilot answered`. When ids were dropped, also `Ignored unknown defects: <id>, <id>` | `Copilot unavailable` | `status "Copilot status"` |
| Apply proposal | `Applying repair…` | `Repair recorded for <defect id>` (a replay shows the same) | The already-repaired and removed copy above | `status "Copilot status"` |
| Import | `Importing…` | `Imported <file name>: <c> created, <m> merged, <a> already imported, <o> orphans, <i> invalid` | Replay of an identical file: `Already imported — nothing new created`; `Import file is larger than 2,000,000 bytes` | `status "Import status"` |
| Publish revision | `Publishing…` | `Published revision <n>` | The 423 copy above | `status "Report status"` |
| Restore revision | `Restoring…` | `Restored revision <n>` | The 423 copy above | `status "Report status"` |
| Create, regenerate, revoke or copy a link | `Working…` | `Link created`, `Link regenerated — the old link no longer works`, `Link revoked`, `Link copied` | Revoked or expired: `This link is no longer active`. Token changed on another device: `Link changed on another device — the list has been refreshed` | `status "Report status"` |
| Erase farm | `Erasing…` | `Erased <farm name>` | `Type the farm name exactly to confirm` | `status "Console updates"` |
| Search | — | `<n> results` | Trimmed box text under 2 characters: `Type at least 2 characters`, with an empty results list. Text over the length limit: `Search text is longer than 100 characters`, with an empty results list | `status "Search status"` |
| Any call while the Pensight server is unreachable | — | — | `Pensight server unreachable — changes are not saved` | `status "Console updates"` |

**Newest action wins.** Each async region always shows the outcome of the user's newest action: The same holds for every choice that loads data: when the inspector chooses another pen (pen list, `combobox "Pen"` on the Reports page), farm (Imports page) or dive while an earlier choice is still loading, only the newest choice is shown and a reply for an earlier choice is discarded.
- **Defect editor.** If the editor is reopened while its closing slide is still running, it stays open. A toast timer or lock-refresh timer started by an earlier editor session never closes the reopened editor, never refreshes a lock that session already released, and never replaces the newer session's `Editor status` text.
- **Forecast check.** Check forecast can be pressed again while a check is pending. The newest check's pending and result text always win. A reply to an earlier check never replaces it.
- **Copilot.** Asking again while an answer is pending discards the earlier answer when it arrives. It never replaces the newer answer, the focus or the `Copilot status` text. Opening another pen while an answer is pending discards that answer as well: when it arrives it changes no answer text, focus line, selection, camera or address.
- **Search.** `list "Search results"` and `status "Search status"` always describe the trimmed text currently in the box.
  - A reply for an earlier query that arrives after a newer query was sent is discarded.
  - When the trimmed text is under 2 user-perceived characters, the console sends no request, empties the list and shows the short-query copy.
  - The dialog opens with an empty box and that copy.
- **Import.** After a double click on Import, `Import status` shows the reply to the most recent press.

**Report link status lines** (console rows).
- Active: `Active — expires <YYYY-MM-DD> <HH:MM> UTC (in <h> h <m> min)`, with `<h>` and `<m>` derived from `expires_in_s` as in Business rules.
- Revoked: `Revoked`.
- Expired: `Expired`.

**Report link page.**
- The Condition region's expiry line reads `Link expires <YYYY-MM-DD> <HH:MM> UTC (in <h> h <m> min)`. The date and time are the link's `expires_at` in UTC, and `<h>` and `<m>` come from the public JSON's `expires_in_s` as in Business rules. The line changes only at load and at each re-check, never from the phone's clock.
- A revoked, regenerated-away or expired token: `This report link is no longer active`.
- An unknown token, or one whose farm was erased: `This report link does not exist`.
- When either message shows, the stage, Condition and Defects are cleared.

**Devices and locks.**
- Device row: `<device name> — Online` or `<device name> — Offline`.
- Lock line on the other device's row and editor: `Being edited on <device name>`.
- Devices page header: `This browser is <device name>`.

## Backend

### API (DP-08, DP-12, DP-15, DP-17, DP-20, DP-22, DP-26, DP-27, DP-29, DP-30, DP-31, DP-32, DP-34, DP-36, DP-38, DP-39, DP-42, DP-43, DP-48, DP-50, DP-51, DP-53, DP-56)

All endpoints sit under the app origin.

**Requests and limits.**
- JSON requests and responses use `application/json; charset=utf-8`.
- A JSON body over 64,000 bytes gets 413. Exactly 64,000 bytes is allowed.
- Raw upload bodies have their own limits, and each limit itself is allowed:
  - Still: at most 8,000,000 bytes, with `Content-Type` `image/jpeg` or `image/png`.
  - Sonar capture: at most 20,000,000 bytes, any content type.
  - Legacy import file: at most 2,000,000 bytes.
- An upload may name its file in an `X-Filename` header. The default name is `upload`.
- An empty upload body gets 422.

**List order.**
- Pens (in every pen list, picker, card grid and `GET /api/pens`): skv-01, skv-02, skv-03, klm-04.
- Farms: skarvholmen, kalamos.
- Devices: DEV-1, DEV-2.
- Dives, imports, links and revisions: newest first, with the higher id first when times are equal.
- Defects: id order.

**Device header.** Every write under `/api`, except `/api/share/...`, carries the header `X-Pensight-Device: <device id>`. A missing or unknown device gets `422 {"error":{"code":"validation","message":"Unknown device","fields":{"device":"Unknown device"}}}`.

**Error shape.** Every refusal uses one shape:
`{"error":{"code":"<code>","message":"<sentence>","fields":{"<field>":"<message>"},"details":{}}}`
`fields` appears only on 422. `details` appears only where a row below says so. **Field errors.** Each key in `fields` names the request field it concerns, as the rows below name it (a key inside `size` is `size.<key>`). A missing required key, a `null` where a value is required, a value of the wrong JSON type and a value outside its range are all errors on that field: `60.5`, `"86400"` and `true` for `expires_in_seconds` (a whole number) each get `fields.expires_in_seconds`, and `"12"` for `bearing_deg` gets `fields.bearing_deg`. Only a body that is not a JSON object gets `fields.body`.

| Status | Code | Used for |
|---|---|---|
| 403 | `cross_origin` | A write carrying a foreign Origin, as set out in Server boundary |
| 404 | `not_found` | Unknown route; a method the path does not support (except report-link paths); unknown or erased resource; unknown report-link token or one whose farm was erased |
| 405 | `read_only` | Any method other than GET on `/api/share/<token>` or `/r/<token>`. Message: `Report links are read-only` |
| 409 | `version_conflict`, `dive_not_cleared`, `dive_state`, `already_repaired`, `defect_removed`, `link_state` | State conflicts |
| 410 | `link_inactive` | A revoked, expired or regenerated-away token |
| 413 | `too_large` | A body over its limit |
| 422 | `validation` | Field errors |
| 423 | `locked` | Another device holds the defect's edit lock. `details` is `{"device_id":"<id>","device_name":"<name>","expires_in_s":<n>}` |
| 502 | `forecast_unavailable`, `copilot_unavailable` | The provider was unreachable, answered with an error, or sent unusable data |
| 504 | `forecast_unavailable`, `copilot_unavailable` | The provider did not answer in time |

**Precedence (the one rule for the whole API).**
1. 405 is decided by method and path alone.
2. Then 403 for a foreign Origin.
3. After that the order is: 413, then 404, then the unknown-device 422, then 410, then 423, then 409, then every other 422 field error.
4. Provider failures (502 and 504) come only after all of these checks pass.
5. Two replays return their stored response before any lock, state or validation check (but after steps 1 to 3's 405, 403, 413 and 404): replaying an already-applied copilot proposal, and importing byte-identical bytes again.

**Shared objects.**

*Inspector defect:*
```json
{"id":"D-0001","pen_id":"skv-01","type":"hole","bearing_deg":112.5,"depth_m":12.4,
 "chart_x_m":50.0,"chart_y_m":12.4,"cell":"F3",
 "size":{"width_cm":30,"height_cm":24},"area_cm2":565,"patch_area_m2":null,
 "note":"Hole beside seam, edges frayed","private_note":"…","status":"open","removed":false,
 "version":1,"repairs":[],"stills":[],"lock":null,"updated_at":"2026-11-02T08:30:00Z"}
```
- `size` keys by type: hole `width_cm`, `height_cm`; tear `length_cm`, `gap_cm`; chafe `length_cm`, `width_cm`; fouling `width_m`, `height_m`.
- `area_cm2` is null for fouling, and `patch_area_m2` is null for the other types.
- A repair is `{"id":"R-0001","method":"lace","note":"…","source":"manual"|"copilot","proposal_id":null|"RP-0001","recorded_at":"…"}`.
- A still is `{"id":"S-0001","content_type":"image/png","size_bytes":<n>,"sha256":"<64 lowercase hex>","file_name":"…"}`.
- `lock` is null or `{"device_id":"DEV-2","device_name":"Deck tablet","expires_in_s":<n>}`.

*Placeholder:* `{"id":"D-0004","pen_id":"skv-01","removed":true,"label":"Defect removed"}`.

*Public defect* (report link and report pack): the inspector defect without `private_note`, `version`, `lock`, `stills` and `updated_at`, with each repair reduced to `{"method","note","recorded_at"}`. Placeholders are unchanged.

*Pen:*
```json
{"id":"skv-01","farm_id":"skarvholmen","farm_name":"Skarvholmen Laks","site_code":"SKV","site_name":"Skarvholmen North",
 "pen_no":1,"name":"Skarvholmen 01","circumference_m":160,"net_depth_m":20,
 "grid":{"columns":16,"rows":4,"panel_width_m":10.0,"panel_height_m":5.0},
 "grade":{"letter":"D","label":"Repair before stocking"},"open_defects":5,"max_fouling_cover_pct":20.4,
 "panels":[{"cell":"A1","fouling_cover_pct":20.4}],"defects":[],"latest_revision":{"number":1,"published_at":"2026-11-02T10:15:00Z"}}
```
- `panels` lists every panel row by row (A1, B1, … then A2, …).
- `defects` lists every defect and placeholder of the pen in id order.

**Endpoints.**

| Method and path | Request | Success | Endpoint-specific errors |
|---|---|---|---|
| GET `/api/health` | — | 200 `{"status":"ok"}` | 503 `{"status":"starting"}` until Postgres, MinIO and Valkey are reachable and the seed is applied |
| GET `/api/devices` | — | 200 `{"devices":[{"id","name","online"}]}` | — |
| POST `/api/devices/<device id>/heartbeat` | — | 200 `{"device":{"id","name","online":true}}` | 404 |
| GET `/api/farms` | — | 200 `{"farms":[{"id","name","day_rate":{"amount","currency"},"sites":[{"code","name","latitude","longitude"}],"pen_ids":[…]}]}` | — |
| DELETE `/api/farms/<farm id>` | `{"confirm_name":"<farm name>"}` | 200 `{"erased":"<farm id>"}` | 422 `fields.confirm_name` when the name does not match exactly |
| GET `/api/pens` | — | 200 `{"pens":[<pen without panels and defects>]}` | — |
| GET `/api/pens/<pen id>` | — | 200 `{"pen":<pen>}` | 404 |
| POST `/api/pens/<pen id>/defects` | `{"type", "bearing_deg"` or `"wall_point":{"x_m","y_m","z_m"}`, `"depth_m"` (omitted with `wall_point`), `"size","note","private_note"}` | 201 `{"defect":<inspector defect>,"pen":<pen>}` | 422 on fields `type`, `bearing_deg`, `wall_point`, `depth_m`, `size.<key>`, `note`, `private_note` |
| GET `/api/defects/<defect id>` | — | 200 `{"defect":<inspector defect or placeholder>}` | 404 |
| PATCH `/api/defects/<defect id>` | `{"version":<n>}` plus any of `bearing_deg` or `wall_point`, `depth_m`, `size`, `note`, `private_note` | 200 `{"defect","pen"}` | 423; 409 `defect_removed`, `version_conflict`; 422, including `type` with `Type cannot change` |
| DELETE `/api/defects/<defect id>` | — | 200 `{"defect":<placeholder>,"pen"}` | 423; 409 `defect_removed` |
| GET `/api/defects/<defect id>/history` | — | 200 `{"history":[{"at","device_id","device_name","action","changes":{"<field>":{"before","after"}},"detail"}]}`, oldest first | 404 |
| POST `/api/defects/<defect id>/lock` | — | 200 `{"lock":{"device_id","device_name","expires_in_s":30}}`. The holder calling again refreshes it | 423; 409 `defect_removed` |
| DELETE `/api/defects/<defect id>/lock` | — | 204, including when nobody holds the lock | 423 when another device holds it |
| POST `/api/defects/<defect id>/stills` | Raw JPEG or PNG bytes | 201 `{"still":<still>}` | 413; 423; 409 `defect_removed`; 422 `fields.content_type` |
| GET `/api/stills/<still id>/raw` | — | 200 with the exact stored bytes, the uploaded `Content-Type` and the header `X-Content-SHA256: <hex>` | 404 |
| POST `/api/defects/<defect id>/repairs` | `{"method":"patch"\|"lace"\|"replace_panel"\|"clean","note"}` | 201 `{"repair","defect","pen"}` | 423; 409 `defect_removed`, `already_repaired`; 422 |
| POST `/api/pens/<pen id>/copilot` | `{"question"}` | 200 `{"answer":{"id":"CA-0001","question","text","focus":["D-0001"],"dropped_ids":["D-9999"],"rejected_calls":[{"tool_call_id","reason"}],"proposals":[{"id":"RP-0001","defect_id","method","note","status":"proposed"}]}}`. `reason` values are from Business rules | 422 `fields.question`; 502; 504 |
| POST `/api/proposals/<proposal id>/apply` | — | 200 `{"proposal":{…,"status":"applied","repair_id"},"repair","defect","pen"}`, with the same body on every replay | 423; 409 `defect_removed`, `already_repaired` |
| GET `/api/dives` | — | 200 `{"server_now","dives":[<dive>]}`, newest first | — |
| POST `/api/dives` | `{"pen_id","planned_start":"<ISO UTC>","planned_minutes","diver_certificate_no"}` | 201 `{"dive"}` | 422 on `fields.pen_id` (unknown pen), `fields.planned_start` (not `YYYY-MM-DDTHH:MM:SSZ`, or outside the window in Business rules), `fields.planned_minutes`, `fields.diver_certificate_no` (required, 1 to 40 characters after trimming) |
| GET `/api/dives/<dive id>` | — | 200 `{"server_now","dive"}` | 404 |
| POST `/api/dives/<dive id>/clearance` | — | 200 `{"dive"}` for GO, NO-GO or Forecast stale | 409 `dive_state`; 502; 504 |
| POST `/api/dives/<dive id>/start` | — | 200 `{"dive"}` | 409 `dive_not_cleared`, `dive_state` |
| POST `/api/dives/<dive id>/finish` | `{"track":[{"t_s","bearing_deg","depth_m"}]}`, 1 to 1,000 samples | 200 `{"dive"}` | 409 `dive_state`; 422 `fields["track[<i>]"]` with `<i>` counted from 0, or `fields.track` when the list is empty or holds more than 1,000 samples |
| POST `/api/dives/<dive id>/sonar` | Raw bytes | 201 `{"capture":{"id":"SC-0001","content_type","size_bytes","sha256","file_name"}}` | 413; 409 `dive_state` (planned dives) |
| GET `/api/sonar/<capture id>/raw` | — | 200 with the exact bytes and `X-Content-SHA256` | 404 |
| POST `/api/farms/<farm id>/imports` | Raw CSV bytes | 201 `{"import":<import>,"replayed":false}`. Bytes identical to an earlier import of this farm get 200 `{"import":<that earlier import>,"replayed":true}` | 413; 422 `fields.file` (no recognisable header) |
| GET `/api/farms/<farm id>/imports` | — | 200 `{"imports":[<import>]}` | 404 |
| GET `/api/imports/<import id>/raw` | — | 200 with the exact bytes and `X-Content-SHA256` | 404 |
| GET `/api/pens/<pen id>/reports` | — | 200 `{"revisions":[{"number","published_at","sha256","size_bytes","grade","open_defects"}]}`, newest first | 404 |
| POST `/api/pens/<pen id>/reports` | — | 201 `{"revision"}` | 423 when another device has locked any defect of the pen |
| GET `/api/pens/<pen id>/reports/<n>/pack` | — | 200 with the exact stored pack bytes, `application/json` and `X-Content-SHA256` | 404 |
| POST `/api/pens/<pen id>/restore` | `{"revision":<n>}` | 200 `{"pen"}` | 404 for an unknown revision; 423; 422 `fields.revision` when `revision` is not a whole number, checked before the revision is looked up |
| GET `/api/pens/<pen id>/links` | — | 200 `{"server_now","links":[<link>]}` | 404 |
| POST `/api/pens/<pen id>/links` | `{"expires_in_seconds":<n>}` | 201 `{"link"}` | 422 `fields.expires_in_seconds` |
| POST `/api/links/<link id>/regenerate` | `{"token":"<the token this device shows>"}` | 200 `{"link"}` with a new token and the same expiry | 409 `link_state` when the link is revoked or expired (the inactive-link copy) or the token is not the link's current token (the changed-on-another-device copy); 422 `fields.token` when `token` is missing or not a string |
| POST `/api/links/<link id>/revoke` | No body | 200 `{"link"}`. Revoking a revoked link returns it unchanged | — |
| GET `/api/share/<token>` | — | 200 with the public report JSON | 404; 410 |
| GET `/r/<token>` | — | 200 with the HTML report page; 410 page with the inactive message; 404 page with the does-not-exist message | — |
| GET `/api/search?q=<text>` | — | 200 `{"results":[{"kind":"farm"\|"pen"\|"defect","id","label"}]}` | 422 `fields.q` with the search-length copy from Feedback states as both `message` and field message |
| GET `/api/exports/defects.csv` | — | 200 `text/csv; charset=utf-8` | — |

**Remaining object shapes.**
- *Dive:* `{"id":"DIVE-0001","pen_id","status":"planned"|"cleared"|"started"|"recorded","planned_start","planned_minutes","diver_certificate_no","clearance":null|{"result":"GO"|"NO-GO"|"Forecast stale"|"Forecast unavailable","message","checked_at","issued_at","hours":[{"time","current_m_s","wave_m","within_limits"}]},"started_at","finished_at","elapsed_s","track":[…],"sonar":[…]}`. `elapsed_s` is the server's whole seconds since `started_at`, and is null unless the dive is started.
- *Import:* `{"id":"IM-0001","farm_id","file_name","sha256","size_bytes","imported_at","rows":<data rows>,"created":[{"row","defect_id"}],"merged":[{"row","defect_id"}],"already_imported":[{"row","defect_id"}],"orphans":[{"row","site_code","pen_no"}],"invalid":[{"row","reason"}]}`. `site_code` and `pen_no` are reported as written in the file.
- *Link:* `{"id":"L-0001","pen_id","token","path":"/r/<token>","url","status":"active"|"revoked"|"expired","created_at","expires_at","expires_in_s"}`.
  - `url` is `APP_PUBLIC_URL` plus `path` when that variable is set, otherwise the request origin plus `path`.
  - `expires_in_s` is defined in Business rules.

**Public report JSON** (`/api/share/<token>`):
`{"pen":{"name","site_name","farm_name","circumference_m","net_depth_m","grid"},"grade","open_defects","max_fouling_cover_pct","panels","defects":[<public defect or placeholder>],"latest_revision":null|{"number","published_at"},"link":{"status":"active","expires_at","expires_in_s"}}`.

**Report pack** (stored and downloaded as JSON):
`{"format":"pensight-report-pack-1","revision","published_at","farm":{"name"},"site":{"code","name"},"pen":{"id","name","circumference_m","net_depth_m","grid"},"grade","open_defects","max_fouling_cover_pct","panels","defects":[<public defect or placeholder, plus "stills":[{"id","sha256","size_bytes"}]>]}`.

**Export CSV.**
- The header is exactly `farm,site_code,pen,defect_id,type,bearing_deg,depth_m,chart_x_m,chart_y_m,cell,area_cm2,patch_area_m2,status,note`.
- There is one row per non-removed defect, in id order. `farm` and `pen` hold the farm's name and the pen's name.
- Numeric columns use fixed decimals: `bearing_deg`, `depth_m` and `patch_area_m2` one decimal; `chart_x_m` and `chart_y_m` two decimals; `area_cm2` a whole number. A null is an empty cell.
- Text columns are `farm`, `site_code`, `pen`, `defect_id`, `type`, `cell`, `status` and `note`. A text cell whose first character is `=`, `+`, `-`, `@`, a tab (U+0009) or a carriage return (U+000D) is written with a leading apostrophe `'` before that character. Numeric columns are never prefixed.
- Quoting is applied after the prefix. A field is wrapped in double quotes when it contains a comma, a double quote, a carriage return or a line feed, and each inner double quote is doubled.
- Lines end with LF.
- For example, a note `=HYPERLINK("http://x","y")` is written `"'=HYPERLINK(""http://x"",""y"")"`, and a note `-frayed edge` is written `'-frayed edge`.

**Search.**
- The query is trimmed of surrounding whitespace. The trimmed query holds at most 100 user-perceived characters (extended grapheme clusters, so a flag counts as one). 100 is allowed, and 101 or more gets the 422 in the endpoint table.
- A trimmed query under 2 user-perceived characters returns no results.
- Otherwise the search is a case-insensitive substring match in which every character matches itself literally, including `%`, `_` and the backslash. A query is never treated as a pattern.
- Each kind of result matches on its own fields only:
  - A farm matches on its farm name, or on the name or code of any of its sites. A site match always yields its farm. There is no site result, and a site match never yields the site's pens.
  - A pen matches on its pen name only.
  - A defect matches on its defect id or its note. Private notes are not searched, and removed defects are excluded.
- Each farm, pen and defect appears at most once, however many of its fields match.
- Results come in this order: farms in farm order, then pens in pen order, then defects in id order.
- Result labels are the farm name, the pen name, or `<defect id> — <pen name>`. The `id` is the farm id, pen id or defect id.
- The search status count is the number of results returned.
- For example, with the seed data at start:
  - `kal` returns exactly two results: `{"kind":"farm","id":"kalamos","label":"Kalamos Marine"}`, then `{"kind":"pen","id":"klm-04","label":"Kalamos 04"}`. Kalamos Marine matches on both its name and its site name Kalamos Bay but appears once, and the status reads `2 results`.
  - `%%` and `D-000_` each return no results, and the status reads `0 results`. A single `%` is under 2 user-perceived characters, so it sends no request and the status reads `Type at least 2 characters`.

### Business rules (DP-04, DP-08, DP-09, DP-10, DP-11, DP-14, DP-15, DP-16, DP-17, DP-18, DP-21, DP-22, DP-23, DP-24, DP-26, DP-27, DP-29, DP-30, DP-31, DP-32, DP-34, DP-39, DP-47, DP-48, DP-50, DP-55, DP-56)

**Rounding.** Every derived value is computed once, on the server, and is stored or returned with the rounding given here. Rounding is half away from zero.

**Pen frame and position.**
- A pen's reference bearing is 0°. Bearings increase clockwise when looking down on the pen.
- A tapped net-wall point arrives as `wall_point`, in metres from the pen centre:
  - `z_m` points towards 0° and `x_m` towards 90°.
  - `y_m` is the height above the collar, negative below it.
- The bearing of a wall point is the angle of (`x_m`, `z_m`) clockwise from the `z_m` axis. For example, (1, 0) is 90° and (0, −1) is 180°. The depth of a wall point is −`y_m`.
- A typed `bearing_deg` may be any finite number and is brought into the range from 0 up to, but not including, 360. For example, −10 becomes 350.0 and 365 becomes 5.0.
- Bearings are rounded to 0.1°, and 360.0 becomes 0.0. Depths are rounded to 0.1 m.
- Depth must lie from 0 to the pen's net depth, both ends allowed, or the request gets 422.

**Chart position and cell.**
- Chart x is the stored bearing × circumference ÷ 360, rounded to 0.01 m. Chart y equals depth.
- Panel width is circumference ÷ columns. Panel height is net depth ÷ rows.
- A cell is a column letter followed by a row number. Columns run A (the panel starting at 0°), then B, C, D, continuing alphabetically to the grid's last column. Row 1 is the panel at the collar.
  - The column index is the whole part of chart x ÷ panel width.
  - The row index is the whole part of depth ÷ panel height.
- A position exactly on a boundary belongs to the next panel. A depth equal to the net depth belongs to the bottom row.

**Sizes and areas.** Sizes are whole centimetres, except fouling sizes, which are metres with one decimal. Every range includes both ends.

| Type | Size fields and ranges | Area |
|---|---|---|
| Hole | Width and height, 1 to 2,000 cm | π × width × height ÷ 4, rounded to a whole cm² |
| Tear | Length 1 to 2,000 cm, gap 0 to 200 cm | Length × gap ÷ 2, rounded to a whole cm² |
| Chafe | Length 1 to 2,000 cm, width 1 to 200 cm | Length × width, in cm² |
| Fouling | Patch width and height, 0.1 to 100.0 m | See Fouling cover |

A defect's type never changes after it is created.

**Fouling cover.**
- A fouling patch is a rectangle on the chart, centred on its chart x and depth.
- Horizontally the patch wraps across the 0° seam: the part past the right edge continues from 0, and the part before 0 continues from the right edge. Vertically the patch is clipped to the range from 0 to the net depth.
- `patch_area_m2` is the clipped area, rounded to 0.1 m².
- A panel's fouling cover is 100 × the clipped patch area of the open, non-removed fouling defects inside that panel ÷ the panel's area.
  - Patches are split exactly at panel boundaries, and overlapping patches add up.
  - The result is rounded to 0.1 and capped at 100.0.
- `max_fouling_cover_pct` is the largest panel cover.

**Pen grade.** The grade is computed from open, non-removed defects. The first row that applies wins:

| Grade | Label | Applies when |
|---|---|---|
| D | Repair before stocking | Any hole of 300 cm² or more, or any tear 50 cm or longer |
| C | Repair within 7 days | Otherwise: any hole or tear, or a maximum fouling cover of 40.0% or more |
| B | Monitor | Otherwise: any chafe, or a maximum fouling cover of 20.0% or more |
| A | Sound | Otherwise |

`open_defects` counts open, non-removed defects.

**Text limits.**
- `note`, `private_note`, the repair `note`, a proposal note and the copilot `question` each hold at most 500 user-perceived characters (extended grapheme clusters). 500 itself is allowed.
- Each of these counts as one character: an emoji with a skin tone, a flag, a family emoji, and a letter with a combining accent.
- One character over the limit gets 422. For notes, the field message is the note copy from Feedback states.
- Notes and questions are stored exactly as sent, with no trimming or other change.
- A copilot question must not be blank (empty or only whitespace).
- The editor's counter uses the same count.

**Defect lifecycle and versions.**
- A defect is `open` or `repaired`.
- A repair, either manual or an applied proposal, moves a defect from open to repaired. A repair on a repaired defect gets 409 `already_repaired`. Only a restore returns a defect to open.
- Deleting turns the defect into its placeholder. The placeholder keeps the id. It is excluded from pins, grade, cover, search and export, and appears as a "Defect removed" row in the console list, on the report link and in later packs.
- Any write to a placeholder gets 409 `defect_removed`.
- `version` starts at 1 and goes up by one on every applied PATCH and every repair, manual or an applied proposal. A restore sets it as the restore rule below says. A still attachment, an import merge and a lock taken or released leave it unchanged, and so does any refused write. A PATCH whose `version` is not the current one gets 409 `version_conflict`.

**Simultaneous writes to one defect.** Writes to one defect (PATCH, DELETE, repair, proposal apply, still upload) are applied one at a time, each checking version, status and removal against the state the previous write left. This holds whether or not anyone holds the edit lock.
- Several PATCHes carrying the same current `version` that arrive together give exactly one 200 and 409 `version_conflict` for every other. The version goes up by exactly one, one `updated` history entry is written, and the stored values are the winner's.
- Several repairs, or repairs and proposal applies, on one open defect that arrive together give exactly one success (201 for a repair, 200 for an apply) and 409 `already_repaired` for every other, with one repair record.
- A DELETE racing a PATCH always ends as the placeholder. The PATCH either gets 200 and was applied before the removal, or gets 409 `defect_removed`. No write ever lands after a removal, and in the history every `updated` entry of that race comes before the `removed` entry.
- Two DELETEs racing give one 200 and one 409 `defect_removed`.

**Defect history.**
- Every create, edit, delete, repair, still attachment, import, merge and restore writes one history entry.
- The entry names the acting device's id and name and the action: `created`, `updated`, `removed`, `repaired`, `still_attached`, `imported`, `merged` or `restored`.
- `changes` is an object keyed by the literal field names `bearing_deg`, `depth_m`, `chart_x_m`, `chart_y_m`, `cell`, `size.<key>` (for example `size.length_cm`), `note`, `private_note` and `status`. Each value is `{"before","after"}`, and only fields that changed are included.
  - A `created` entry lists every stored field with `before` null.
  - A `repaired` entry changes `status` from open to repaired.
  - `removed` and `still_attached` entries have empty `changes`.
- The editor's history list prints the same key as `<field>`.
- `detail` is a string:
  - created: `new defect`.
  - updated and removed: empty.
  - Manual repair: `<method>`. Applied proposal: `<method> (copilot proposal <proposal id>)`.
  - still_attached: `<still id>`.
  - imported and merged: `<import id> row <n>`.
  - restored: `revision <n>`.

**Edit locks and presence.**
- Opening the editor takes the defect's lock for 30 seconds. While the editor is open, the console refreshes the lock every 10 seconds. Closing the editor releases it.
- While one device holds a defect's lock, another device's PATCH, DELETE, still upload, repair, proposal apply, restore or publish touching that defect gets 423. This lasts until the lock is released, or until 30 seconds pass without a refresh.
- When nobody holds the lock, writes are allowed, subject to the simultaneous-write rule above.
- When two devices try to take the same free lock at the same moment, exactly one gets 200 and the other gets 423.
- Each open console sends a heartbeat as soon as it opens and every 5 seconds after that.
- A device is Online while its last heartbeat is under 15 seconds old, and Offline after that. The Devices page refreshes every 5 seconds.

**Live updates.**
- These changes are broadcast to the other open device: every change listed under Defect history, every lock taken or released, every link created, regenerated or revoked, every revision published, every import, and every farm erased.
- The change appears there within 3 seconds.
- A lock indicator clears within 3 seconds of release, and within 10 seconds after a lock expires without release.

**Dive states.**
- A dive starts as `planned`. A forecast check on a planned or cleared dive records a new clearance and sets the status to `cleared`.
- Start is legal only from `cleared`, and only when the latest clearance is a GO that is not stale on the server clock at the moment of starting. It sets `started` and `started_at`.
- Refused starts:
  - On a planned dive, or on a cleared dive whose latest clearance is not a fresh GO: 409 `dive_not_cleared` with the fresh-GO copy from Feedback states.
  - On a started dive: 409 `dive_state` with the already-started copy.
  - On a recorded dive: 409 `dive_state` with the already-recorded copy.
- Finish is legal only from `started`. It sets `recorded` and `finished_at`.
- Every other refused transition gets 409 `dive_state`: a check on a started or recorded dive, finish on a planned, cleared or recorded dive, and sonar on a planned dive.
- When a dive is planned:
  - `planned_start` must lie between 30 minutes before and 48 hours after the server's now.
  - `planned_minutes` is a whole number from 15 to 240.
  - Both ranges include their ends.
- Track samples need nondecreasing whole-second `t_s` starting from 0. Their bearings and depths follow the position rules.

**Clearance.**
- The planned hours are every UTC clock hour from the hour of the planned start through the hour that holds the dive's last minute. For example, a 90-minute dive starting at 09:30 covers 09:00 and 10:00.
- A forecast is stale when its issue time is more than 6 hours before the server's now. Exactly 6 hours is not stale.
- The decision is made in this order:
  1. A provider error, an unusable body, or a missing or null value for any planned hour gives `Forecast unavailable`, answered 502. If the provider gave no reply within 10 seconds, it is answered 504.
  2. Otherwise, a stale issue time gives `Forecast stale`.
  3. Otherwise, the hours are scanned in time order, checking the current before the wave within each hour. The first hour with a current speed over 0.50 m/s or a wave height over 1.5 m gives `NO-GO`, naming that hour and value. The limits themselves are allowed.
  4. Otherwise, the result is `GO`.
- Every outcome, including Forecast unavailable, is recorded as the dive's clearance.
- The latest clearance is the one whose check started last, so a slow earlier check that finishes later never replaces a newer one.
- Reading a planned or cleared dive re-derives the result on the server clock: a GO whose issue time has since become more than 6 hours old reads `Forecast stale`. A started or recorded dive keeps the clearance it was started with, so the seeded recorded dive still reads `GO`.
- The Dives page refreshes the open dive every 30 seconds and after every action.

**Copilot.**
- A question goes to the chat-completion provider, in the request shape set out in Services. If no usable reply arrives within 20 seconds, the request gets 504.
- Tool calls are handled in reply order. Each call is checked against these steps, and the first that applies decides it:
  1. A name other than `focus_defects` or `propose_repair`: rejected with `unknown_tool`.
  2. Arguments that are not JSON, not a JSON object, or missing or mistyping a published key: rejected with `invalid_arguments`. The published keys are `defect_ids`, an array of strings, and `defect_id`, `method` and `note`, which are strings.
  3. `focus_defects`: each id that is a non-removed defect of this pen joins `focus`, in order and without duplicates. Every other id goes to `dropped_ids`.
  4. `propose_repair` whose `defect_id` is not a non-removed defect of this pen: the id goes to `dropped_ids`, and the call is not listed in `rejected_calls`.
  5. A method outside the repair list: `unknown_method`.
  6. A note over the text limit: `note_too_long`.
  7. A defect that is already repaired when the answer is built: `already_repaired`.
  8. A defect that already got a proposal from an earlier call in the same reply: `duplicate_proposal`. The first proposal is kept.
  9. Otherwise the call becomes a proposal.
- `dropped_ids` holds each id once, in order of first appearance. Every `rejected_calls[].reason` is exactly one of the six reasons above.
- No proposal exists any other way.
- Applying a proposal records a copilot repair. Applying it again returns the same body and changes nothing: no new repair, history entry or version.
- Manual repairs never depend on the provider.

**Legacy import: file format.**
- The older tool's CSV starts with the header `site_code,pen_no,observed_at,kind,bearing,depth_m,size_a_cm,size_b_cm,note`. Header names are matched after trimming and case-insensitively.
- The separator is a comma, or a semicolon when the header uses semicolons. With semicolons, numbers may use a decimal comma.
- Fields may be wrapped in double quotes, with a doubled double quote standing for one. A quoted field may hold the separator and line breaks.
- A leading byte-order mark and CRLF line endings are accepted.
- The header is row 1, and the first data row is row 2.
- Every cell is trimmed of surrounding spaces, except `note`, which keeps its text exactly as unquoted.
- Normalisation happens only on a working copy. The stored file is exactly the uploaded bytes.

**Legacy import: matching rows.**
- A row matches a pen of the importing farm when two things hold: the trimmed, case-insensitive `site_code` equals a site code of that farm, and `pen_no`, with leading zeros ignored, equals the pen number at that site. For example, ` skv ` with `001` matches Skarvholmen 01.
- A row with no match is an orphan.
- `kind` is HOLE, TEAR, CHAFE or FOULING, in any case.
- `size_a_cm` and `size_b_cm` map to hole width and height, tear length and gap, chafe length and width, or fouling width and height. Fouling values are converted from centimetres to metres with one decimal.
- A row that breaks any defect rule is invalid and gets a reason.
- A valid row merges into the nearest existing defect of the same pen and type, open or repaired but not removed, when both of these hold:
  - The wrap-aware chart-x distance is at most 1.00 m.
  - The depths differ by at most 1.0 m.
  - Both limits are allowed. Nearest means the smallest wrap-aware chart-x distance, then the smallest depth difference, and a tie on both goes to the lower id. Distances use stored values (chart x to 0.01 m, depth to 0.1 m), with the row's bearing and depth rounded and its chart x computed the same way first.
- A merge changes nothing on the target except adding a `merged` history entry.
- Any other valid row creates a defect with an `imported` history entry. Earlier rows of the same file count as merge targets.

**Legacy import: re-imports and concurrency.**
- Every created or merged row's fingerprint goes into the farm's import ledger. The fingerprint is: farm, normalised site code and pen number, kind, normalised bearing, depth, both sizes, and note.
- A later row whose fingerprint is already in the ledger is listed under "already imported", with the defect it created or merged into, and creates nothing. This includes a fingerprint written by an earlier row of the same file.
- A file byte-identical to an earlier import of the same farm returns that earlier import as a replay. It creates no import record, no MinIO object and no ledger entry.
- Imports of the same farm are applied one at a time, in arrival order. Each import finishes its replay check, matching, ledger writes and defect creation before the next import for that farm begins. Imports of different farms do not wait for each other.
- Two byte-identical uploads that arrive at the same moment give exactly one 201 with `"replayed":false` and one 200 with `"replayed":true`, both carrying the same import id. The result is one import record, one MinIO object under the farm's imports prefix, and one ledger row per fingerprint.
- When two different files that share rows arrive at the same moment:
  - Each shared fingerprint is created or merged in whichever import is applied first, and listed as "already imported" in the other.
  - No defect is created twice.
  - Each shared row's defect gets exactly one `imported` history entry.
- The server is the guarantee: a double click in the console is safe without any client-side guard.

**Report revisions and restore.**
- Publishing gives the pen its next revision number, numbered from 1 and increasing by one for each new revision of that pen.
- It snapshots every defect, placeholder, private note, repair and still attachment of the pen, and stores the report pack in MinIO with its SHA-256.
- Revisions and packs never change. Any method other than GET on a revision path gets 404.
- Restoring revision n makes the pen's defects exactly the snapshot: the same ids, positions, sizes, notes, private notes, statuses, placeholders, repairs and still links. The links point to the same still objects, re-linked, not copied.
- Defects created after revision n leave the pen and then get 404. Repairs and stills added after revision n are unlinked.
- Each restored defect's version becomes one more than the greater of its current version and its snapshot version, and the defect gets a `restored` history entry.
- Restore publishes nothing, and the next publish continues the numbering.
- Still, sonar and import objects are never deleted, except by farm erasure.

**Report links: status and expiry.**
- `expires_at` is the creation time plus `expires_in_seconds`, a whole number from 10 to 2,592,000 with both ends allowed. The console offers 24 hours, 7 days and 30 days.
- A link is `active` until it is revoked or expires.
  - It is `expired` once the server's now is at or after `expires_at`. Exactly `expires_at` counts as expired.
  - An expired token gets 410, with no action needed.
- `expires_in_s` is the whole number of seconds from the server's now until `expires_at`, rounded down. It is 0 unless the link is active.
- Every expiry line's `<h>` is `expires_in_s` ÷ 3600 rounded down. `<m>` is the remainder after whole hours ÷ 60, rounded down. For example, 5,399 seconds prints as `in 1 h 29 min`.
- The report link list refreshes every 30 seconds and after every action.

**Report links: regenerate and revoke.**
- Regenerating needs the token the device shows. When that token is the link's current token and the link is active, the link gets a new token and keeps its expiry. The old token gets 410 from that moment.
- A token that is not the current one gets 409 `link_state` with the changed-on-another-device copy, and no token is issued.
- When two devices regenerate the same link at the same moment with the same token, exactly one gets 200. The other gets that 409, and only the winner's new token works.
- Revoking makes every token the link ever had get 410 at once. Revoke needs no token and is idempotent.
- When a regenerate and a revoke race, the link always ends revoked and every token it ever had gets 410.
- Regenerate, revoke and status reads are applied one at a time per link.

**Report links: the open page and privacy.**
- An open report link page loads the public JSON once and re-checks it every 15 seconds. The farm manager's phone clock may be wrong, so the page never compares `expires_at` with the device clock.
  - On 200 it prints the expiry line from that reply's `expires_in_s`.
  - On 410 it shows the inactive message. For a link that expires while open, this comes within 20 seconds after `expires_at`.
  - On 404 it shows the does-not-exist message. For an erased farm this comes within 15 to 20 seconds after the erasure.
- The report link page and its JSON never contain a day rate, private note, diver certificate number, device id or name, lock, history or still.
- Every edit, deletion, repair and restore of the pen shows on its active link at the next load or check. A check that finds changes updates only the changed rows, pins and lines in place. The selected tab, the camera and keyboard focus stay as they were, and so does the selected pin unless its defect was removed.

**Export neutralisation.** The apostrophe prefix exists only in the CSV export. The stored note, the API, the console, the report link, the report pack and the raw import file all keep the original text.

**Farm erasure.**
- Erasing a farm deletes the farm and everything under it: sites, pens, defects, placeholders, history, repairs, proposals, dives, imports and ledger, revisions and links.
- It releases every lock on the farm's defects and deletes every MinIO object under the farm's prefix.
- Afterwards the farm's ids get 404, its link tokens get 404 (not 410), and it is absent from search and from the export.

### Services (DP-12, DP-17, DP-18, DP-20, DP-24, DP-26, DP-28, DP-30, DP-31, DP-39, DP-45, DP-47, DP-54)

**Postgres** (`DATABASE_URL`).
- Postgres holds farms, sites, pens and grids; defects and placeholders; history; repairs, proposals and copilot answers; dives with clearances and track samples; imports and the import ledger; report revisions with their snapshots; and report links.
- These tables are published for observation:
  - `defects`: one row per defect id, including placeholders.
  - `imports`: one row per created import.
  - `import_ledger`: one row per imported row fingerprint.
  - `report_revisions`: one row per revision.
  - `report_links`: one row per link, holding its current token.
- Other table names are free.
- The schema and seed are applied idempotently on every start.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
- Object keys:
  - `farms/<farm id>/stills/<still id>`
  - `farms/<farm id>/sonar/<capture id>`
  - `farms/<farm id>/imports/<import id>.csv`
  - `farms/<farm id>/reports/<pen id>/revision-<n>.json`
- Each object holds exactly the uploaded or published bytes. Nothing else is stored under `farms/`.
- The seeded revision's pack is written on first start and never rewritten.

**Valkey** (`VALKEY_URL`).
- Heartbeats live at `pensight:heartbeat:<device id>`. The key expires 15 seconds after the last heartbeat.
- Edit locks live at `pensight:lock:defect:<defect id>`. The value is the holding device's id, and the key expires 30 seconds after the last take or refresh.
- Every broadcast change is published as JSON on the channel `pensight:events`. The server relays it to open consoles over a same-origin stream.
- The report link page never receives these events.

**Third-party providers (WireMock, `WIREMOCK_URL`).** Both providers live at the base URL in `WIREMOCK_URL`. All provider data is invented. The app calls the providers exactly as described below and sends no credentials and no `Authorization` header.

*Marine forecast.* `GET <WIREMOCK_URL>/v1/marine` with these query parameters:
- `latitude` and `longitude`: the pen's site position, with four decimals.
- `hourly=ocean_current_velocity,wave_height`.
- `start_hour` and `end_hour`: the first and last planned hours, as `YYYY-MM-DDTHH:00` in UTC.

The response looks like this, for example:
```json
{"latitude":63.4512,"longitude":8.7321,"issued_at":"2026-11-06T06:58:12Z",
 "hourly_units":{"time":"iso8601","ocean_current_velocity":"m/s","wave_height":"m"},
 "hourly":{"time":["2026-11-06T07:00Z","2026-11-06T08:00Z"],"ocean_current_velocity":[0.22,0.25],"wave_height":[0.6,0.6]}}
```
- Each `hourly.time` entry is the UTC hour it covers, and the three arrays are parallel.
- Hours outside the planned hours are ignored. The app does not rely on the echoed latitude and longitude.
- The baseline data is issued one hour before the current time and covers twelve hours, starting from the previous hour. Every current is between 0.22 and 0.31 m/s and every wave height between 0.6 and 0.9 m, so a dive planned for the next few hours clears GO.
- These give 502: a non-2xx reply, a body that does not match this shape, a missing planned hour, a null value, or a refused connection. No reply within 10 seconds gives 504.

*Chat completion.* `POST <WIREMOCK_URL>/v1/chat/completions` with a JSON body holding exactly these keys:
- `"model":"pensight-findings-1"`.
- `"messages"`, exactly two entries in this order, and never an earlier question or answer:
  1. `{"role":"system","content":"<findings context>"}`. The content is the line `Pensight findings context`, a line feed, then one JSON object `{"pen":"<pen name>","defects":[…]}`. `defects` lists every non-removed defect of the pen in id order, each with exactly these eight keys: `id`, `type`, `status`, `cell`, `size` (the object with the published size keys for its type), `area_cm2`, `patch_area_m2` and `note`. The values are the stored server values, with null where the defect object has null.
  2. `{"role":"user","content":"<question exactly as asked>"}`, byte for byte what the inspector typed, with no trimming.
- `"tools"`: two functions:
  - `focus_defects`, with arguments `{"defect_ids":[string]}`.
  - `propose_repair`, with arguments `{"defect_id":string,"method":"patch"|"lace"|"replace_panel"|"clean","note":string}`.
- `"tool_choice":"auto"`.

Nothing else from Pensight appears anywhere in the request: no private note, day rate, diver certificate number, device id or name, lock, version, still, history or placeholder.

The reply is read from `choices[0].message`:
- `content` is a string or null, and is shown as the answer text.
- `tool_calls[]` holds entries of the form `{"id","type":"function","function":{"name","arguments":"<JSON string>"}}`.

The baseline reply has:
- The content `D-0001 and D-0002 need repair before restocking: D-0001 is a 565 cm² hole in panel F3 and D-0002 is a seam tear in K1.`
- A `focus_defects` call `call_focus_1` for D-0001 and D-0002.
- A `propose_repair` call `call_repair_1` patching D-0001, with the note `Sew a net patch over the hole and re-check the seam`.

A non-2xx reply, a body without `choices[0].message`, or a refused connection gives 502. No reply within 20 seconds gives 504. Either way, the UI shows the copilot outage copy.

When the providers are down, everything else keeps working: marking, editing, manual repair, import, publishing and links.

### Seed data (DP-01, DP-46)

Every farm, site, person, device and business below is invented.

**Next ids.** Ids continue from the next free number: D-0009, R-0002, DIVE-0002, S-0001, SC-0001, IM-0001, RP-0001, CA-0001 and L-0001. The next revision is 2 for Skarvholmen 01 and 1 for every other pen.

**Devices:** `DEV-1` "Topside laptop" and `DEV-2` "Deck tablet". Both are Offline until a console sends a heartbeat.

**Farms and sites:**

| Farm id | Name | Day rate (private) | Site code | Site name | Latitude | Longitude |
|---|---|---|---|---|---|---|
| skarvholmen | Skarvholmen Laks | 14500 NOK | SKV | Skarvholmen North | 63.4512 | 8.7321 |
| kalamos | Kalamos Marine | 950 EUR | KLM | Kalamos Bay | 38.6215 | 20.9013 |

**Pens:**

| Pen id | Site | Pen no | Name | Circumference | Net depth | Grid (columns × rows) | Panel | Grade | Open | Max cover |
|---|---|---|---|---|---|---|---|---|---|---|
| skv-01 | SKV | 1 | Skarvholmen 01 | 160 m | 20 m | 16 × 4 | 10.00 × 5.00 m | D Repair before stocking | 5 | 20.4% |
| skv-02 | SKV | 2 | Skarvholmen 02 | 160 m | 20 m | 16 × 4 | 10.00 × 5.00 m | B Monitor | 1 | 0.0% |
| skv-03 | SKV | 3 | Skarvholmen 03 | 120 m | 15 m | 12 × 3 | 10.00 × 5.00 m | A Sound | 0 | 0.0% |
| klm-04 | KLM | 4 | Kalamos 04 | 90 m | 12 m | 9 × 3 | 10.00 × 4.00 m | B Monitor | 1 | 25.0% |

**Defects.** All were created by the Topside laptop at 2026-11-02T08:30:00Z, and each has a `created` history entry. All are version 1 except D-0006, which is version 2.

| Id | Pen | Type | Bearing | Depth | Size | Chart x | Cell | Area | Status | Note | Private note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| D-0001 | skv-01 | hole | 112.5° | 12.4 m | 30 × 24 cm | 50.00 m | F3 | 565 cm² | open | Hole beside seam, edges frayed | Farm saw a seal near this pen on 28 October |
| D-0002 | skv-01 | tear | 236.7° | 4.8 m | length 45 cm, gap 6 cm | 105.20 m | K1 | 135 cm² | open | Seam tear along vertical rope | — |
| D-0003 | skv-01 | chafe | 300.0° | 18.2 m | length 120 cm, width 15 cm | 133.33 m | N4 | 1800 cm² | open | Chafe where the sinker tube rubs | Bill this re-check at half rate |
| D-0004 | skv-01 | fouling | 0.9° | 2.0 m | 6.0 × 3.0 m | 0.40 m | A1 | patch 18.0 m² | open | Mussel and kelp growth near surface | — |
| D-0005 | skv-01 | fouling | 202.5° | 5.0 m | 4.0 × 4.0 m | 90.00 m | J2 | patch 16.0 m² | open | Hydroid fouling on panel join | — |
| D-0006 | skv-01 | hole | 45.0° | 8.0 m | 10 × 10 cm | 20.00 m | C2 | 79 cm² | repaired | Small hole, laced on last visit | — |
| D-0007 | skv-02 | chafe | 90.0° | 10.0 m | length 40 cm, width 5 cm | 40.00 m | E3 | 200 cm² | open | Light chafe at mooring bridle | — |
| D-0008 | klm-04 | fouling | 180.0° | 6.0 m | 5.0 × 2.0 m | 45.00 m | E2 | patch 10.0 m² | open | Algal film on lower panels | — |

Chart y equals depth for every defect. Private notes shown as "—" are empty strings.

**Fouling cover at start.** Every panel not listed is 0.0%.
- Skarvholmen 01: A1 20.4%; P1 15.6% (the part of D-0004 that wraps across the seam); I1, I2, J1 and J2 at 8.0% each.
- Kalamos 04: E2 25.0%.

**Repair.** R-0001 on D-0006: method lace, note "Laced with 3 mm twine", source manual, recorded 2026-11-02T09:05:00Z by the Topside laptop, with a `repaired` history entry.

**Dive.** DIVE-0001 on skv-01, status recorded:
- Planned start 2026-11-02T08:00:00Z, for 90 minutes. Diver certificate number (private): NO-ROV-48213.
- Clearance GO, checked 2026-11-02T07:40:00Z, forecast issued 2026-11-02T06:00:00Z.
- Started 2026-11-02T08:04:00Z and finished 2026-11-02T09:21:00Z.
- Track samples (t_s, bearing, depth): (0, 0.0°, 1.0 m), (600, 45.0°, 8.0 m), (1500, 112.5°, 12.0 m), (2700, 202.5°, 5.0 m), (3600, 300.0°, 17.5 m), (4620, 355.0°, 2.0 m).
- No sonar captures.

**Report revision.** Skarvholmen 01 revision 1, published 2026-11-02T10:15:00Z, grade D with 5 open defects. It is a snapshot of D-0001 to D-0006 and R-0001 exactly as above. Its pack is stored at `farms/skarvholmen/reports/skv-01/revision-1.json`.

**Not seeded:** stills, sonar captures, imports, ledger rows, copilot answers, proposals and report links.

**First-open copy.** For example, with the seed data at start, on a fresh browser:

| Where | Exact text |
|---|---|
| Pens page: the open-pen card and the square card of Skarvholmen 01 | `Grade D — Repair before stocking · 5 open defects` |
| Pens page: the square cards of Skarvholmen 02 and Kalamos 04 | `Grade B — Monitor · 1 open defect` |
| Pens page: the square card of Skarvholmen 03 | `Grade A — Sound · 0 open defects` |
| Farm details for Skarvholmen Laks | `14500 NOK per day` |
| Farm details for Kalamos Marine | `950 EUR per day` |
| Devices page header | `This browser is Topside laptop` |
| Devices page rows | `Topside laptop — Online` within 5 seconds of opening, and `Deck tablet — Offline` |
| Scene status of Skarvholmen 01 once the list has filled, exactly these six lines in this order | `View: Cylinder`, `Camera: 0°`, `Zoom: 1.00×`, `Selected: none`, `Focus: none`, `Dive clock: no dive running` |
| Scene status of Skarvholmen 01 while it loads | The same six lines, followed by `Loading pen` |
| Address of Skarvholmen 01 opened from its card | `/pens/skv-01?view=cylinder` |

## Technical requirements

### Deployment (DP-43, DP-45)

Backend: Rust 1.99 with cargo. Frontend: TypeScript/JavaScript built with Node 22 into static files that the Rust server serves.

- The images ship Rust 1.99 with cargo, and Node 22.
- The frontend, including the three.js scene, is built with Node 22 inside the same `build` step. Never use browser-side WASM: the images cannot build it.
- Commit `Cargo.lock` and the npm lockfile.
- Install no system library beyond build-essential. There are no OpenSSL headers, so talk plain HTTP to every service.

`/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:
```json
{"_schema":"run-manifest-v1","install":"cargo fetch --locked && npm ci --prefix web","build":"npm run build --prefix web && cargo build --release --locked","serve":"./target/release/pensight"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set. `GET /api/health` returns HTTP 200 JSON `{"status":"ok"}` once the server is ready, as described in API.

### Configuration and secrets (DP-45)

These variables are read at start: `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `VALKEY_URL`, `WIREMOCK_URL`, `APP_PUBLIC_PORT`, and `APP_PUBLIC_URL` (optional, used for absolute report-link URLs and for the app's origin). No credential or service URL is hard-coded, written into the frontend bundle, sent to the browser or logged.

### Server boundary (DP-36, DP-42, DP-43, DP-57)

- **Same origin only.** The browser talks only to the app's own origin. It never calls Postgres, MinIO, Valkey or the providers.
- **Cross-site writes.** Device ids are names, not secrets, so the device header alone does not protect a farm's report links or defects from a hostile page. Therefore:
  - Any POST, PATCH or DELETE under `/api` whose `Origin` header is present and differs from the app's origin gets `403 {"error":{"code":"cross_origin","message":"Cross-site request refused"}}` and changes nothing. The literal origin `null` counts as different.
  - The app's origin is the origin of `APP_PUBLIC_URL` when that is set, otherwise the request's own scheme and `Host`.
  - A write with no `Origin` header, or with the app's origin, is allowed.
  - No response, including the answer to an `OPTIONS` request, ever carries an `Access-Control-Allow-*` header.
- **Downloads.** Files download only through the app's own raw endpoints. Every download link (still, sonar capture, original import file, report pack and defect export) saves a file whose bytes are exactly the bytes its raw endpoint returns, and the page stays where it is.
- **Size limits.** Request size limits are those in API.
- **What the server serves.** Only the built frontend assets, the API and the report link pages. It never serves source files, the manifest, lockfiles, environment values, or MinIO objects by key.
- **Boot.** At boot the server retries Postgres, MinIO and Valkey for up to 60 seconds. While it waits, health answers with the starting status and every other route answers 503 `{"error":{"code":"starting","message":"Pensight is starting"}}`.
- **Providers.** The providers are never contacted at boot. An outage there affects only clearance and the copilot.

### Browser support and performance (DP-03, DP-40)

- **Browsers.** Current Chromium, Firefox and Safari, and Chromium with the SwiftShader software renderer.
- **Viewports.** 375x812 (touch), 768x1024 (touch) and 1280x800.
- **Load time.** On the seeded data, a pen workspace is usable, with the stage drawn and the list filled, within three seconds of navigation.
- **Responsiveness.** Orbit responds on the next frame.
- **Scene limits.** The fish school never exceeds 60 fish.
- **Software rendering.** Unwrap and fly-to keep their stated durations on a software renderer by skipping frames, never by slowing down.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and those commands alone install, build and serve the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence. Shipped packages means the crates of the normal, non-dev Rust dependency graph, plus the production npm tree (`npm ls --omit=dev --all --json`), plus the bundled fonts and icons.
- IF-03: Shipped packages and assets use only the MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, Unicode-3.0, MPL-2.0 and CC0-1.0 licences, plus OFL-1.1 for fonts.
- IF-04: The app uses no datastore beyond Postgres, MinIO and Valkey: no SQLite, no embedded database and no state files on local disk.
- IF-05: `Cargo.lock` and the npm lockfile are committed, and the build installs no system library beyond build-essential.
- IF-06: The app itself serves the fonts (Inter and Inter Tight), three.js and the icons, and the browser loads nothing from another origin.
- IF-07: The provided service configuration files are left unchanged.

## Engineering standards

- The Rust code is idiomatic and builds without warnings. Fallible paths use `Result` with `?`, and no `unwrap` or `expect` is called on values that depend on input, the network or storage.
- Names in both the Rust and the TypeScript code match this brief's domain terms: pen, net wall, panel cell, defect, placeholder, clearance, report revision, report link, edit lock, import ledger and findings context.
- Each domain rule is decided in exactly one place in the source, and the browser only displays its result. The rules include: position and cell; areas and fouling cover; pen grade; the clearance decision; dive transitions; the lock check; one-at-a-time defect writes; import matching and serialisation; link status and regeneration; tool-call validation; the findings context; the origin check; search matching; export neutralisation.
- One error type maps every refusal to the single published error shape and status code.
- No abstraction has a single implementation, and there is no dead, commented-out or unreachable code.
- There are no defensive checks for states the rules make impossible.
- There are no features, endpoints, screens or settings beyond this brief.
