# Larchline Geospatial Spanwise

Spanwise is a web workspace where small drone survey contractors deliver annual transmission-line vegetation clearance findings to the electric utilities they work for. Everything is shown on a 3D globe that streams terrain and a reality mesh. Survey processors upload each corridor's 3D Tiles reality mesh, its quantized-mesh terrain pyramid and the drone flight's CZML track. Vegetation analysts move along the corridor tower by tower, record every tree that grows too close to a conductor, and submit a frozen findings set. The utility forester gets an emailed review link and accepts or disputes each finding in a browser, with nothing to install. A field crew lead can open the same link on a tablet to find the span before sending climbers.

Spanwise uses three backend services:

- **PostgreSQL** for all records.
- **S3-compatible object storage (MinIO)** for every corridor file and evidence pack.
- **An SMTP mail sink (Mailpit)** for review and decision emails.

Out of scope:

- Self-service accounts or sign-up. Contractor staff use seeded access codes and foresters use review links.
- Billing and point-cloud processing.
- Any datastore other than PostgreSQL and object storage.
- Any map, terrain or imagery service on the public internet.

## Problem and users

Utilities that own high-voltage lines must inspect every right-of-way corridor each year and be able to prove that no tree has grown inside the clearance distance agreed for that line. Most of them hire small drone survey contractors to fly the corridors. The contractor flies each corridor, turns the point cloud into a reality mesh and terrain, and flags every tree that comes too close to a conductor. Delivery is where it goes wrong:

- Findings go out as spreadsheets of coordinates, screenshots and multi-gigabyte mesh files that the utility forester cannot open in a browser.
- Pins placed on coarse terrain float or sink once finer terrain loads.
- Nobody can replay the flight to check that a span was actually covered. Where the drone flew back over a stretch on a second pass, nobody can tell which pass covered it first.
- When an auditor asks for evidence months later, the contractor has to rebuild the original files from memory.

Contractors pay for this in unbilled analyst hours and re-flights. Utilities pay in compliance exposure and in emergency trimming crews sent to the wrong tower.

Users:

- **Survey processor** (contractor staff, weekly). Uploads a corridor's tileset, terrain pyramid and flight track. Each upload must be confirmed as stored before analysis starts.
- **Vegetation analyst** (contractor staff, daily). Moves from orbit down to a single span, records encroaching canopy on streamed terrain and mesh, drapes canopy footprints, and submits a findings set tied to tower-to-tower chainage. Chainage is the distance in metres along the corridor from the first tower. Analysts often triage a whole set from the keyboard, and sometimes from a phone.
- **Utility forester** (the utility's staff, weekly). Opens the emailed review link, scrubs along the corridor, and accepts or disputes each finding without installing anything.
- **Field crew lead** (staff of the utility or its trimming contractor, occasional). On a tablet at the roadside, uses the review link to find the span and nearest tower for an accepted finding and to see the canopy in 3D.

## Journeys

1. **Upload a corridor.**
   - Start: the survey processor is signed in and has opened the Ash Creek corridor.
   - They open the upload dialog, choose an asset kind, pick the files and start the upload.
   - Each asset row shows Pending while its files upload and verify. It turns Stored only when the server reports that object storage confirmed every file's size and checksum, even when the last files finish at the same moment.
   - End: a Stored asset with one download link per file.
2. **Scrub a corridor and check coverage.**
   - Start: the vegetation analyst opens Ash Creek from the corridor list, which shows it as Overdue.
   - They drag the span ribbon playhead quickly back and forth, or step it with the keyboard.
   - With every move, the chainage readout and span label change at once. The drone line briefly reads as locating, then the drone marker lands on the flown track for the latest position, never an earlier one. Where the drone flew a stretch twice, the earlier pass wins. The camera follows behind the marker. Findings close to the playhead are ringed on the globe and outlined in the rail.
   - The uncovered stretch between towers 5 and 7 is hatched and labelled as having no flight coverage.
   - End: after the analyst releases the playhead, the address bar holds the view.
3. **Triage and submit by keyboard.**
   - Start: the Ash Creek draft is open.
   - The analyst steps the ribbon, moves between findings with J and K, opens the editor with E, corrects a canopy height and saves, then presses N to add a finding at the playhead.
   - A finding that was resolved on coarse terrain is refined as finer tiles stream in. The refined height and clearance are announced.
   - The analyst opens the submit dialog and presses Confirm twice by accident.
   - End: one Submitted set with frozen counts, one success announcement, and exactly one review email in the forester's inbox.
4. **Review on a phone.**
   - Start: the utility forester opens the emailed link on a phone.
   - The page shows the corridor, the revision number and when the link expires. The findings sit in a collapsed bottom sheet above the ribbon.
   - The forester scrubs, accepts most findings and disputes one with a note. When one save fails on a weak signal, the button stays as it was and the page says so. The forester presses again and then sends the decisions.
   - End: the decisions-final message on the page and a decision summary email to the analyst.
5. **Revise after a dispute and prove the evidence.**
   - Start: the analyst sees the set as Disputed.
   - They start a revision. The old set closes and a new draft opens with the findings copied.
   - Months later the forester questions a span. The survey processor opens the corridor's assets and downloads the original flight track and tileset files.
   - End: the downloaded files are byte-for-byte identical to what was uploaded.
6. **Find the span at the roadside.**
   - Start: the forester has accepted, and the field crew lead opens the link on a tablet.
   - They pinch, twist and tilt the globe with their fingers, choose "Fly to" on an accepted finding, and see its span, nearest tower and chainage. They step span by span with the ribbon buttons.
   - End: with reduced motion turned on in the operating system, the camera jumps straight to each new pose instead of flying.
7. **Keep working through outages.**
   - Start: object storage is unreachable, possibly since the service started.
   - The analyst opens a corridor and sees the outage banner and the empty-viewport message instead of the globe. The banner is announced once.
   - They keep editing a finding through the rail and ribbon. The open editor, the typed values and focus survive every status check.
   - When storage comes back, the banner clears and tiles stream again without anyone restarting the service.
   - In a separate case, when mail is down at submit, the link line reads Email queued. It changes to Email sent in place once the email goes out.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Staff sign-in** Contractor staff sign in with their seeded access code and receive a session cookie, and an unknown code returns 401 with the published sign-in error.
- **DP-02 — Inspection due dates** Each corridor reports its inspection due date in its utility's time zone and is marked Overdue from the day after that date in that zone, decided on every read.
- **DP-03 — Staff tenant isolation** Staff see and change only their own tenant's corridors, assets, findings sets and findings, and anything belonging to another tenant answers 404.
- **DP-04 — Corridor overview journey** A signed-in analyst sees the corridor list with due dates, Overdue badges and current set states, and opens a corridor workspace showing its globe, findings rail and span ribbon.
- **DP-05 — Span ribbon mapping and keys** The span ribbon maps horizontal position linearly and monotonically to chainage from zero to corridor length, draws a tick per tower, and its Corridor chainage slider steps by the published keys with the published value text.
- **DP-06 — Scrub update sequence** Every scrub input updates the chainage readout, span label and nearby-finding marks at once, then places the drone marker at the position the flight endpoint returns for that input and eases the camera to the chase pose, as qualified in Interactions.
- **DP-07 — View state in the URL** Workspace and review URLs carry chainage, scrub time, selected finding and camera pose; releasing the playhead replaces the history entry, selecting a finding adds one, back and forward restore them, and opening a URL lands on that exact view.
- **DP-08 — Flight position by chainage** The flight endpoint returns the CZML position interpolated linearly against the track's epoch for a given chainage or time, using the earliest in-interval flight time that reaches the chainage even where a reverse pass overlaps, and ignoring samples outside every availability interval.
- **DP-09 — No flight coverage** A chainage or time without bracketing samples inside one availability interval reports the published no-coverage label instead of an extrapolated position, coverage is reported as merged, ascending, non-overlapping ranges, and the ribbon hatches and labels each uncovered range.
- **DP-10 — Asset declaration** The survey processor declares a tileset, terrain or flight track asset with a manifest of file paths, sizes and SHA-256 digests, and an invalid manifest is rejected with 422 field errors.
- **DP-11 — Storage-confirmed assets** A file is Stored only after object storage reports the declared size and SHA-256 for the written object, an asset is Stored exactly once with one stored time when all its files are, even when they arrive concurrently at several processes, and a mismatch rejects the asset and leaves no object behind.
- **DP-12 — Originals byte for byte** Every stored file reads back, whole or by byte range, with exactly the uploaded bytes and its SHA-256 as the ETag, never compressed or re-serialised.
- **DP-13 — Asset upload journey** The survey processor uploads files through the upload dialog and sees each asset move from Pending to Stored only when the server reports storage confirmation.
- **DP-14 — Finding geometry and clearance** The server stores each finding as a float64 WGS84 ECEF position, derives its chainage, span, canopy top height, clearance to the span's conductor line and Violation or Clear status by the published rules, and labels findings uniquely and without gaps in commit order even under concurrent creates.
- **DP-15 — Finding validation** Creating or editing a finding with out-of-range values is rejected with 422 and the published field messages, both in the API and in the editor.
- **DP-16 — Keyboard findings triage** The analyst steps the ribbon, moves between findings, opens the editor, saves and submits without a pointer, using the published shortcuts, with Tab wrapping inside every dialog, Escape closing it and focus returning to its opener.
- **DP-17 — Finding save feedback** Saving a finding announces pending, success and failure in the Save status region with the published copy, and the editor's error summary links to each invalid field.
- **DP-18 — Terrain re-resolution** When a finer terrain tile containing a draft finding arrives, the ground height is re-resolved once for that level, the clearance is recomputed and announced in the Terrain updates region, the server refuses an equal or coarser level with 409, and under concurrent requests the stored level only ever increases and ends at the highest submitted.
- **DP-19 — Clamped clearance polygons** Each finding's canopy footprint is draped on the finest loaded terrain and never sinks below it or floats above it, including while refinement is under way.
- **DP-20 — Findings triage journey** The analyst opens a draft, adds a finding at the playhead from the keyboard, edits another, and sees the rail summary and globe markers reflect the new violation count.
- **DP-21 — Submit and freeze** Submitting a draft freezes its finding and violation counts, writes the evidence pack and mints one review link with the configured lifetime, and later edits, refinements or deletions of that set are refused.
- **DP-22 — Submit and link idempotency** A submit, resend or new-link request replayed with the same Idempotency-Key returns the stored response, a reused key with a different body returns 409, and of simultaneous submits of one draft exactly one succeeds.
- **DP-23 — Review link email** A successful submit sends one Mailpit email to the utility's forester with the published subject and link, the link's email state reads sent only after the mail server accepted its latest email, and a failed submit sends nothing.
- **DP-24 — Link resend, revoke and regenerate** Resend emails the same live link and never mints a second, revoke stops the link at once, and regenerate mints a new link while the old one stops working.
- **DP-25 — Review link scope and read-only state** A review link reads only its own findings set, corridor and assets, answers 404 for anything else, and can no longer change anything once decisions are sent.
- **DP-26 — Review link expiry** The server clock decides link expiry, after which every request with the link answers 410 and the page shows the expired copy whatever the browser clock says, while before expiry the page states when the link expires.
- **DP-27 — Review page breakpoints** The review page shows its desktop, tablet and phone layouts at 1280x800, 768x1024 and 375x812 with the published order and no horizontal overflow.
- **DP-28 — Forester decisions** Through the link the forester accepts or disputes each finding, a dispute needs a note, sending decisions moves the set to accepted or disputed, and the submitting analyst receives the decision summary email.
- **DP-29 — Shared view links** A view link pasted into a finding comment renders on the review page as an Open this view link, and opening it lands the forester on that camera pose, scrub time and selected finding.
- **DP-30 — Forester review journey** The forester opens the emailed link, scrubs along the corridor, decides each finding, sends the decisions and sees the decisions-final state.
- **DP-31 — Findings set state machine** Findings sets move only along the published transitions, each illegal transition answers 409 with the published body, and a corridor has at most one set that is not closed.
- **DP-32 — Revision after dispute** Revising a disputed set closes it and creates a new draft revision linked to it with the findings copied, and of simultaneous revise requests exactly one succeeds.
- **DP-33 — Evidence pack** Each submit writes a JSON evidence pack to object storage under the published key, and the evidence endpoint returns exactly those stored bytes.
- **DP-34 — Dispute evidence journey** After a dispute the survey processor opens the corridor's assets and downloads the original flight track and tileset files, whose bytes match what was uploaded.
- **DP-35 — Working without tile storage** With object storage unreachable, even from boot, the app starts and serves, reports storage as unreachable, keeps answering flight positions and coverage, and lets the analyst read and edit draft findings.
- **DP-36 — Storage outage copy** While storage is unreachable, the workspace shows the published outage banner and empty-viewport copy character for character instead of a blank globe, and tile reads answer 503.
- **DP-37 — Queued review email** With mail unreachable, submit still succeeds and reports the email as queued with the queued copy, and the queued email is delivered exactly once, without a restart and within the published delay, by any app process sharing the outbox that can reach mail.
- **DP-38 — Touch globe gestures** On a touch screen, one-finger drag pans, pinch zooms, two-finger twist turns the heading and two-finger vertical drag tilts the globe, and the camera readout reflects each change.
- **DP-39 — Reduced motion** With the reduce-motion setting on, the camera cuts to each new pose, the playhead jumps, and sheets and dialogs appear without movement, while every readout, ring, URL and announcement still updates.
- **DP-40 — Crew span finder** On a tablet the field crew lead opens the link after acceptance, finds an accepted finding's span and nearest tower, flies to it and steps span by span with the ribbon buttons.
- **DP-41 — Workspace breakpoints** The staff workspace and corridor list show their desktop, tablet and phone layouts at the three published viewports with the published order and no horizontal overflow.
- **DP-42 — Motion timing** Playhead glides, camera chase eases, sheet and dialog entries and fly-to moves take the published durations, and nothing animates in a loop while nothing is changing.
- **DP-43 — Globe streaming and fallback** The seed corridor workspace becomes usable and stays responsive while streaming within the published limits, and without WebGL the globe area shows the published fallback copy while the ribbon and rail keep working.
- **DP-44 — API error contract** Every API error uses the one published error shape and follows the published precedence order.
- **DP-45 — Server boundary and health** The server answers the health check, serves only its built assets and API routes from one origin, enforces the published size and type limits, and never serves source files or credentials.
- **DP-46 — Cartographic visual identity** The interface reads as a survey document, with paper and ink colours, a serif display face over a plain sans body, tabular mono numbers with units, hairline chainage rules, and the warm accent used only for violations and always paired with a glyph and a text label.
- **DP-47 — Source integrity** Credentials and service URLs come from the environment, positions stay float64 and are rendered relative to the eye, mesh, texture and terrain decoding runs off the main thread, a service that answers again after an outage is used again without a restart, and no route fakes provider state.
- **DP-48 — Collapsed phone sheet** On a phone the collapsed findings sheet exposes only its summary line and toggle, keeps everything else out of the accessibility tree, the Tab order and pointer reach, moves focus to the toggle when collapsed from inside, and still lets J and K select and announce findings.
- **DP-49 — Latest scrub input wins** The drone marker, the readout's drone and flight time lines and the URL time always reflect the flight endpoint's answer to the latest scrub input, showing the published locating copy while it is outstanding and discarding late answers to earlier inputs.
- **DP-50 — One effect per press** Double-pressing Confirm submit, Resend link, New link, Withdraw link or Send decisions performs the action once, the button stays disabled while its request is pending, one submit dialog opening reuses one Idempotency-Key, and the announcement is the first request's outcome.
- **DP-51 — Honest decision state** A forester's Accept or Dispute shows as pressed only after the server stores it, a failed save keeps the stored decision and announces the published failure copy, a revoked or expired link replaces the page with its link-problem message, and a review closed elsewhere shows the decisions-final state.
- **DP-52 — Status checks preserve work** Status checks and the asset refreshes they trigger never close dialogs, clear typed values, move focus, collapse sheets, switch rail tabs or expanded rows, and never insert the storage alert more than once per outage.
- **DP-53 — Live email state** Each review link reports whether its latest email is queued or sent, and the workspace link line switches from Email queued to Email sent in place on a status check once any app process delivers it.

## Frontend

### Screens and layout (DP-04, DP-27, DP-41, DP-48)

Spanwise has four screens. Every screen works with no horizontal overflow at 375x812, 768x1024 and 1280x800.

There are two breakpoints, at 768 and 1024 CSS pixels wide. Each breakpoint includes its lower bound:

- **Phone:** narrower than 768.
- **Tablet:** 768 up to 1023.
- **Desktop:** 1024 and wider.

1. **Sign-in** (`/` without a session). The Spanwise wordmark heading sits centred on the paper background, above a single access-code field and a Sign in button. A signed-in visitor to `/` goes to `/corridors`.
2. **Corridor list** (`/corridors`). The heading is "Corridors". Each corridor shows:
   - its name, as a link;
   - its utility;
   - its voltage;
   - its inspection due line;
   - an Overdue badge, when it applies;
   - the state of its current findings set, or "No findings set".

   On tablet and desktop this is one table with the columns Corridor, Utility, Inspection due and Findings set, in that order. On a phone the same information appears as a vertical list of stacked cards, in the same order.
3. **Corridor workspace** (`/corridors/<corridor id>`). It has five parts:
   - A slim **header** with the corridor name as the page heading, the utility, the inspection due line, the set state and the role's actions.
   - A **globe** canvas.
   - A paper-coloured **findings rail** with two tabs:
     - **Findings** holds the summary line, the findings list and the finding actions.
     - **Assets** holds the asset list and, for the survey processor, the Upload assets button.
   - A **position readout** in mono figures.
   - A full-width **span ribbon** pinned to the bottom edge.

   Layout by viewport:
   - **Desktop:** the globe fills everything to the left of the rail and above the ribbon, edge to edge. The rail is fixed to the right edge, 320 to 400 CSS pixels wide, and runs from under the header to the top of the ribbon. The readout floats over the top-left corner of the globe.
   - **Tablet:** the same arrangement, with the rail 280 to 340 CSS pixels wide. The readout sits at the top of the rail, above the tabs.
   - **Phone:** nothing sits beside the globe. From top to bottom: header, the globe at full width, the rail as a bottom sheet, then the ribbon.
     - The sheet starts collapsed. When collapsed it shows only its summary line and the show/hide toggle, under the DP-48 rule in Feedback states.
     - When expanded it takes up to 60% of the viewport height and scrolls inside itself.
     - The readout is never inside the sheet. It floats over the top-left corner of the globe, as on desktop, and shows all its lines whether the sheet is collapsed or expanded.
   - **Every layout:** the ribbon spans the full viewport width and is 72 to 120 CSS pixels tall. The globe always keeps at least 40% of the viewport height.
4. **Review page** (`/review/<token>`).
   - It uses the same globe, rail, readout and ribbon arrangement as the workspace, at the same breakpoints, including the phone sheet.
   - The header shows the corridor name with the revision, the contractor's name, the utility and the link expiry line.
   - While decisions are open, the rail holds the findings for review with decision controls. Once decisions are final, it holds the decisions-final state.
   - A link that is unknown, expired or withdrawn shows only the header wordmark and the matching message from Feedback states. No globe, rail or ribbon appears.

### Public screens and controls (DP-05, DP-06, DP-09, DP-13, DP-16, DP-17, DP-29, DP-38, DP-40, DP-50, DP-53)

Only the roles, names and copy below are public. Everything else is free. Each placeholder is explained where it first appears.

| Where | Role and accessible name | Visible copy and behaviour |
|---|---|---|
| Sign-in | `heading "Spanwise"` (level 1) | Wordmark |
| Sign-in | `textbox "Access code"` | — |
| Sign-in | `button "Sign in"` | Reads `Signing in...` while pending |
| Sign-in | `status "Sign-in status"` | See Feedback states |
| List | `heading "Corridors"` (level 1) | — |
| List | `table "Corridors"` (tablet and desktop) and `list "Corridors"` (phone) | One row or card per corridor |
| List | `link "<corridor name>"` | Opens the workspace |
| List and header | Inspection due line | `Inspection due <YYYY-MM-DD> (<time zone>)`. The date is the due date and the zone is the utility's IANA time-zone name |
| List and header | Overdue badge | `Overdue`, shown only when the corridor is overdue |
| List and header | Set state | One of `Draft`, `Submitted`, `Under review`, `Accepted`, `Disputed`, `Closed`, `No findings set` |
| Workspace | `heading "<corridor name>"` (level 1) | — |
| Workspace | `link "Skip to span ribbon"` | First Tab stop. Visible when focused |
| Workspace | `link "Corridors"` | Goes back to the list |
| Workspace | `button "Copy view link"` | Copies the current URL |
| Workspace | `button "Sign out"` | Ends the session |
| Workspace and review | `application "Corridor globe"` | The 3D globe |
| Workspace and review | `region "Position readout"` | Lines below |
| Workspace and review | `complementary "Findings rail"` | Rail or bottom sheet |
| Workspace | `tablist "Rail sections"` with `tab "Findings"`, `tab "Assets"` | — |
| Workspace and review | Rail summary line | `<n> findings · <v> violations`. `<n>` is the number of findings in the set and `<v>` the number with status Violation, following the count rule below. The separator is a middle dot with a space on each side |
| Workspace | `listbox "Findings"` | One `option` per finding, in chainage order (ties by label). Each option's accessible name starts with its label, for example `F-1`. Each option shows the status glyph and word, the clearance, the span label and the chainage. The selected option has `aria-selected="true"` |
| Workspace and review | Near tag on a finding | `Near playhead`, with an outline, on findings within reach of the playhead |
| Workspace and review | Status word | `Violation` with a warning-triangle glyph, or `Clear` with a check glyph |
| Workspace | `button "New finding at playhead"` | Analyst, draft only |
| Workspace | `button "Edit finding"` | Analyst, draft only, needs a selected finding |
| Workspace | `button "Start findings set"` | Analyst. Shown when the corridor has no set that is not closed |
| Workspace | `button "Submit for review"` | Analyst, draft only |
| Workspace | `button "Resend link"`, `button "Withdraw link"`, `button "New link"` | Analyst. Resend and Withdraw appear while the link is live. New link appears when the set is submitted, under review, accepted or disputed. Each has `aria-disabled="true"` while its request is pending |
| Workspace | Link line | `Link expires <YYYY-MM-DD HH:mm> (<time zone>)`, the link's expiry in the utility's time zone, followed by the link-state suffix from Feedback states |
| Workspace | `button "Close set"` | Analyst, accepted sets only |
| Workspace | `button "Start revision"` | Analyst, disputed sets only |
| Workspace | `dialog "New finding"` and `dialog "Edit finding <label>"` | Finding editor |
| Editor | `textbox "Ground height (m)"`, `textbox "Offset from centreline (m)"`, `textbox "Canopy height above ground (m)"`, `textbox "Canopy radius (m)"`, `textbox "Comment"` | Fields. The editor also shows the chainage and span read-only, and the terrain level (`hand-entered` when empty) |
| Editor | `button "Save finding"`, `button "Cancel"`, `button "Delete finding"` (edit only) | — |
| Editor | Error summary | Heading `Fix these fields`, then one link per invalid field. The link's text is the field's message, and following it focuses the field |
| Workspace | `dialog "Submit findings set"` | Body: `<n> findings, <v> violations will be frozen and sent to <email>.` `<email>` is the utility forester's email |
| Submit dialog | `button "Confirm submit"`, `button "Cancel"` | While the submit is pending, Confirm submit reads `Submitting...` and has `aria-disabled="true"` |
| Workspace | `button "Upload assets"` | Survey processor only, in the Assets tab |
| Workspace | `region "Survey assets"` | One row per asset: `<kind label> · <file count> files · <state>`. The kind label is `Tileset`, `Terrain` or `Flight track`. The state is `Pending`, `Stored` or `Rejected` |
| Asset row | `button "Files"` | Expands the row's file list. `aria-expanded` matches |
| Asset row | `link "Download <path>"` | One per stored file. Downloads the original |
| Upload | `dialog "Upload survey assets"` | — |
| Upload | `radiogroup "Asset kind"` with `radio "Tileset"`, `radio "Terrain"`, `radio "Flight track"` | — |
| Upload | File chooser labelled `Files` (accepts many files and folders) | — |
| Upload | `button "Upload"`, `button "Close"` | — |
| Ribbon | `region "Span ribbon"` | Tower ticks labelled `T1`, `T2` and onwards. Hairline chainage rules every 100 m, with a label every 500 m. Hatched uncovered ranges. The playhead |
| Ribbon | `slider "Corridor chainage"` | `aria-valuemin` is 0, `aria-valuemax` the corridor length, `aria-valuenow` the chainage in metres, `aria-valuetext` as below |
| Ribbon | `button "Previous span"`, `button "Next span"` | Same as PageUp and PageDown |
| Ribbon | Hatch label | `No flight coverage`, inside each uncovered range |
| Phone sheet | `button "Show findings"` or `button "Hide findings"` | Toggles the sheet. `aria-expanded` matches its state |
| Review | `heading "<corridor name>, revision <n>"` (level 1) | `<n>` is the revision number |
| Review | Link expiry line | `Link expires <YYYY-MM-DD HH:mm> (<time zone>)` |
| Review | `list "Findings for review"` | One `listitem` per finding, in chainage order (ties by label), with label, status, clearance, span, chainage and comment. The selected finding's `listitem` has `aria-current="true"`, and no other item has `aria-current` |
| Review (decisions open) | `button "Accept <label>"`, `button "Dispute <label>"` | `aria-pressed="true"` only on the button matching the decision the server has stored for that finding |
| Review (decisions open) | `textbox "Dispute note for <label>"` | Shown after Dispute is pressed, and whenever a dispute is stored for that finding |
| Review (decisions open) | `button "Send decisions"` | `aria-disabled="true"` while pending |
| Review | `link "Open this view"` | Replaces each view link inside a comment |
| Review (decisions final) | Decision line | `Accepted`, or `Disputed: <note>` |
| Review (decisions final) | Span line | `<span label> · nearest tower T<k> · chainage <c> m` |
| Review (decisions final) | `button "Fly to <label>"` | — |
| All | `status "Save status"`, `status "Terrain updates"`, `status "Submit status"`, `status "Link status"`, `status "Upload status"`, `status "Review status"`, `status "View status"` | Polite live regions. Copy is in Feedback states |
| Workspace and review | `alert` storage banner and the empty-viewport message | Copy is in Feedback states |

Position readout lines, in this order, all in tabular mono:

1. `Chainage <c> m`. `<c>` is the playhead chainage with thousands commas and one decimal, for example `1,240.0`.
2. `<span label>`, which is `Span <a>–<b>` with an en dash. `<a>` and `<b>` are the tower numbers on either side.
3. The drone line:
   - Normally `Drone <lat>° <N|S>, <lon>° <E|W>, <h> m`: the marker's latitude and longitude as absolute values with six decimals, and its ellipsoidal height with one decimal.
   - `Drone No flight coverage` when the playhead has no coverage.
   - The locating copy from Feedback states while the answer is outstanding.
4. `Flight time <YYYY-MM-DD HH:mm:ss> UTC`: the scrub time, truncated to whole seconds. The line is absent when there is no coverage or while the drone is locating.
5. `Camera <h> m above ground, heading <hd>°, pitch <p>°`: the camera's height above the loaded terrain, its heading (0 to 360) and its pitch, each with one decimal. Pitch is negative when looking down.

Slider value text:

- The format is `Chainage <c> metres, span <a> to <b>, <k> findings nearby`, where `<c>` is rounded to whole metres with thousands commas and `<k>` is the near count.
- When the near count is 1, the end reads `1 finding nearby`. When it is 0, it reads `no findings nearby`.
- With the seed data at start, for example, chainage 1,240 on Ash Creek reads `Chainage 1,240 metres, span 4 to 5, no findings nearby`.

Number formats everywhere else:

- These formats apply to values filled into placeholders anywhere outside the readout and the slider value text: the rail, the editor, the review list and span line, the submit dialog, emails, API messages and every announcement.
- Chainage has one decimal. Heights, clearances, offsets and radii have two decimals. Each is followed by a space and `m`.
- Only the readout's `Chainage` line and the slider value text group thousands with commas. Everywhere else numbers are not grouped, for example `chainage 1180.0 m`.

Count rule: wherever a count is followed by a noun (on screen, in announcements and in emails), the noun is singular when the count is exactly 1 and plural otherwise, including 0. For example: `1 finding · 0 violations`, `Flight track · 1 file · Stored`, `Verifying 1 file with storage`, `Streaming 1 tile`. The only exception is the slider's `no findings nearby`.

### Interactions (DP-05, DP-06, DP-07, DP-16, DP-29, DP-38, DP-40, DP-49)

**Span scrub (the signature).** The analyst and the forester move along the corridor by chainage.

- The ribbon draws the corridor as a straight strip. Horizontal position maps linearly from chainage 0 at the ribbon's left edge to the corridor length at its right edge. The mapping always increases left to right.
- Pressing on the track moves the playhead there with a short glide. Dragging makes the playhead follow the pointer directly.
- With `slider "Corridor chainage"` focused:
  - Left and Down step 10 m back. Right and Up step 10 m forward.
  - Shift with any of those arrows steps 100 m.
  - PageUp goes to the nearest tower chainage strictly before the playhead. PageDown goes to the nearest strictly after.
  - Home goes to 0 and End goes to the corridor length.
  - Values clamp at both ends.
- `button "Previous span"` and `button "Next span"` act like PageUp and PageDown.
- A chainage belongs to the span from tower k to tower k+1 when it is at or after tower k's chainage and before tower k+1's chainage. The corridor length belongs to the last span.

On every scrub input (each pointer move while dragging, each key press, each button press):

1. **At once:**
   - The readout's chainage and span lines and the slider's value text update.
   - Every finding whose chainage is within 25 m of the playhead (exactly 25 m counts) gets a ring on the globe, plus an outline and the near tag in the rail. Findings that leave that reach lose them.
2. **Drone request.** The page asks the flight endpoint for that chainage.
   - Staff pages ask `GET /api/corridors/{id}/flight`. The review page asks `GET /api/review/{token}/flight`.
   - `chainage_m` is the playhead chainage with one decimal.
   - Until the answer for the latest input is applied, the drone and flight time lines and the marker follow the DP-49 rule in Feedback states.
   - While dragging, the page may skip requests for intermediate pointer positions, but it always requests the latest one.
   - The drone position is never computed in the browser.
3. **Drone placed.** When the answer to the latest input arrives, the drone marker appears at its position and the drone and flight time lines fill in. When the answer is not covered, the marker stays hidden and the drone line shows the no-coverage text.
4. **Camera.** The camera then eases to the chase pose.
   - Covered: a point on the centreline 150 m behind the marker (toward lower chainage) and 80 m above it, heading along the corridor and looking at the marker.
   - Not covered: the reference point is the ground on the centreline at the playhead. Ground is taken from the finest loaded terrain, or from the interpolated tower base height when no terrain is loaded. The camera sits 150 m behind that point and 60 m above it, looking at it.
   - The camera never goes lower than 10 m above the loaded terrain.
5. **URL.** On pointer release, or straight after each key or button press, `ch` is written. `t` is the `time` string from the answer to the latest input, copied unchanged. If that answer has not arrived yet, `t` is written when it arrives, replacing the same history entry.

**URL as view state.** The workspace and review URLs carry these query parameters:

- `ch`: chainage in metres, one decimal.
- `t`: scrub time. Left out where there is no coverage.
- `f`: the selected finding's id.
- `cam`: `<lon>,<lat>,<height>,<heading>,<pitch>`. Longitude and latitude have seven decimals, ellipsoidal height is in metres with one decimal, and the angles are in degrees with one decimal.

How the URL behaves:

- Releasing the playhead, or a key or button step, replaces the current history entry. Selecting a finding adds a new history entry.
- `cam` is rewritten once the camera has been still for at most one second. The rewrite always replaces the current history entry and never adds one.
- Back and forward restore the playhead, selection and camera of that entry.
- Opening a URL:
  - places the playhead at `ch`;
  - places the drone at `t`, asked of the flight endpoint by time, or at the time mapped from `ch` when `t` is missing;
  - selects `f`;
  - puts the camera exactly at `cam` (within 0.5 m and 0.1°) instead of the chase pose, when `cam` is present.
- A URL without `ch` opens at chainage 0.0, with no selection and the camera at the chase pose.
- `button "Copy view link"` copies the full current URL.

**Findings rail.**

- Clicking an option, or using Up and Down in the focused listbox, selects a finding. Selecting moves the playhead to the finding's chainage, runs the scrub sequence, and pans the camera to the chase pose there.
- Enter on a selected option opens its editor.
- A submitted set shows its frozen values.

**Keyboard shortcuts in the workspace.** Shortcuts work whenever no dialog is open and focus is not in a text field. They work from any button, the slider or the listbox, and in every layout, including while the phone sheet is collapsed.

- `J` selects the next finding in rail order and `K` the previous one. With no selection, J selects the first finding and K the last. Both stop at the ends.
- `E` opens the editor for the selected finding (analyst, draft).
- `N` opens `dialog "New finding"` at the playhead chainage (analyst, draft).
- Selection by J and K does everything a rail selection does. It also leaves the phone sheet in whatever state it was, and it never moves focus.
- On the review page, J and K work the same way and under the same conditions, stepping through `list "Findings for review"` in its order. E and N do nothing there.

**Tab order in the workspace.**

- Desktop and tablet: skip link, header controls, rail tabs and rail controls, findings listbox, then ribbon controls (Previous span, slider, Next span).
- Phone with the sheet collapsed: skip link, header controls, `button "Show findings"`, Previous span, slider, Next span.
- The globe is never a Tab stop. Everything the globe offers can also be reached through the ribbon and the rail.

**Dialogs and the expanded phone sheet.**

- On open, focus moves to the first field or control.
- Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last. Focus never leaves an open dialog or expanded sheet.
- Escape closes without saving.
- On close, focus returns to the control that opened it. For a shortcut, that is the element that had focus when the key was pressed. For the sheet, it is the toggle.
- Enter in a single-line field submits the dialog's main action.

**Finding editor.**

- `dialog "New finding"` opens with:
  - the chainage fixed at the playhead;
  - offset 0;
  - canopy radius 3.00;
  - canopy height empty;
  - ground height prefilled from the finest loaded terrain tile under the point, with that tile's level. When no terrain is loaded, the ground height is empty and the level reads `hand-entered`.
- Typing a ground height by hand sets the level to hand-entered.
- Delete removes the finding after a second press on the same button. After the first press the button's text changes to `Confirm delete`.

**Picking on the globe.** In a draft, double-clicking or double-tapping the terrain or mesh opens `dialog "New finding"` at the picked point. Chainage and offset are projected from the pick. Ground height and level come from the terrain tile that was hit.

**Terrain refinement.** For each saved draft finding, when a terrain tile finer than the finding's recorded level arrives and contains the finding's point, the page samples the new ground height and sends it once for that level, following the DP-18 rule.

- Only levels that actually load are sent. A finding can go from level 9 straight to level 15 with one request and one announcement.
- After each accepted level, the marker and footprint move and the change is announced.
- A coarser or equal tile never changes a finding.
- At the chase pose over a finding, for example after selecting it, the globe loads the terrain's finest level under that finding within ten seconds.

**Upload.**

- In `dialog "Upload survey assets"`, the processor picks a kind and files, then presses Upload.
- The page computes each file's SHA-256, declares the asset and uploads each file.
- The row's state and the announcements always come from the server's answers. A file is never shown as Stored because the browser finished sending it.
- A folder selection keeps each file's path relative to the chosen folder.

**Review page.**

- **Selecting a finding.** Clicking or tapping a finding's list item anywhere outside its buttons, note box and links selects that finding, as do J and K. A review selection does everything a workspace rail selection does: it moves the playhead to the finding's chainage, runs the scrub sequence, pans the camera to the chase pose there, adds a history entry with `f`, and makes the announcement from Feedback states. The selected item carries `aria-current="true"`. Opening a review URL with `f` gives that item `aria-current="true"`.
- **Accept.** Pressing `Accept <label>` sends an accept with an empty note at once, and hides that finding's note box.
- **Dispute.** Pressing `Dispute <label>` sends nothing yet. It shows the note box and moves focus into it.
  - When focus leaves the box holding text other than spaces, the dispute is sent with that note.
  - When the box is empty or holds only spaces, nothing is sent. The dispute-note field message from API shows under the box.
  - Editing the note of a stored dispute and leaving the box with different, non-blank text sends the dispute again.
- **Pressed state.** It follows the DP-51 rule in Feedback states.
  - Pressing an already pressed Accept sends nothing.
  - Pressing an already pressed Dispute only moves focus into its note box.
  - To change a decision, press the other button. A decision cannot be cleared.
- **Send decisions** completes the review.
- **View links in comments.** A comment URL whose origin is this app and whose path is `/corridors/<this corridor id>` or `/review/<any token>` renders as `link "Open this view"`. Following it opens `/review/<this token>` with the same query parameters. Any other URL stays plain text.
- **Decisions final.** Each finding shows its decision line, its span line and `button "Fly to <label>"`. Fly to moves the playhead to the finding and flies the camera to its chase pose.
- **Nearest tower.** The tower whose chainage is closest to the finding's chainage. A tie goes to the lower-numbered tower.

**Globe gestures.**

- Mouse: drag pans, the wheel zooms, and right-drag or Ctrl-drag tilts and turns.
- Touch: one-finger drag pans, pinch zooms toward the pinch centre, two-finger twist turns the heading, and two fingers dragged up or down together tilt the pitch.
- Every gesture updates the camera readout line while it moves. Gestures work the same with reduced motion on.

### Visual design (DP-46)

The look is a surveyor's field sheet.

- **Colour.** Warm off-white paper panels carry dark blue-black ink text.
  - A muted blue-grey is used for hairline rules, tower ticks and secondary text.
  - A deep forest green marks Clear findings and stored states.
  - One warm burnt orange is the only accent. It is used only for clearance violations: violation markers, rings, footprints, list glyphs and the Overdue badge.
- **Status is never colour alone.** Violation always pairs the orange with a warning-triangle glyph and the word Violation. Clear pairs the green with a check glyph and the word Clear.
- **Type.** Headings use a soft, high-contrast serif (Fraunces). Body text and controls use a plain humanist sans (IBM Plex Sans). Every coordinate, height, distance, chainage and time is set in tabular mono figures (IBM Plex Mono) with its unit. Each heading level is one quarter larger than the level below it, so the page heading is about twice the size of body text.
- **Density.** Rail rows are compact and are divided by thin rules, not boxes.
- **Composition.** The globe runs edge to edge. The rail sits on its right like a sheet of paper. The ribbon is a straight strip of tower ticks and fine chainage rules along the bottom.
- **Accessibility.**
  - Every interactive control is at least 44 by 44 CSS pixels on touch layouts.
  - All text and controls meet WCAG 2.2 AA contrast.
  - Focus is always visible as a two-pixel ink outline with a paper gap.
- **Icons and fonts.** Icons are Lucide. Fonts are self-hosted.

### Motion and effects (DP-19, DP-39, DP-42, DP-43)

Motion only ever means that something moved or changed. Every eased motion starts quickly and settles gently, with no overshoot or bounce.

- **Playhead glide** after a track press, key step or button step: between 0.15 and 0.25 seconds. While dragging, the playhead tracks the pointer with no glide.
- **Camera chase ease:** between 0.28 and 0.4 seconds. It restarts from the current pose on each newly applied position.
- **Dialog and phone sheet entry and exit:** between 0.15 and 0.25 seconds. Dialogs fade and rise a few pixels. The sheet slides up from behind the ribbon.
- **Fly to a finding**, or opening a selection that is far away: between 0.8 and 1.5 seconds.
- **Rings** fade in and out in under 0.2 seconds. They never pulse.
- **Gesture inertia** after a release lasts no more than 0.5 seconds.
- **No unnamed loops.**
  - Nothing animates while nothing is changing.
  - The globe never spins on its own.
  - There are no idle drifts, spinners or shimmer placeholders.
  - Tile streaming shows as the text `Streaming <k> tiles` in the readout area, which disappears when streaming is idle.
- **The 3D scene** shows:
  - the WGS84 globe with streamed terrain and the reality mesh;
  - the corridor centreline and the tower markers;
  - one conductor line per span;
  - finding markers with draped canopy footprints. Each footprint is a disc of the finding's canopy radius lying on the finest loaded terrain. Its edge meets the ground all the way round, with no visible gap beneath it and no part hidden under the ground, at any camera pose and while refinement is under way;
  - the drone marker, with its flown track drawn as a thin ink line.

  The scene moves only through input, scrubbing, selection and Fly to.
- **Reduced motion.** When the operating system's reduce-motion setting is on:
  - the camera reaches each new pose (chase pose, Fly to, URL camera) in the next frame;
  - the playhead jumps;
  - dialogs and the sheet appear and disappear at once, and rings appear without a fade;
  - there is no gesture inertia;
  - the readout, value text, rings, outlines, URL and every announcement still update exactly as they do with motion on.
- **No WebGL.** When the browser offers no WebGL, the globe area shows `3D view needs WebGL. The span ribbon and findings rail still work.` on the paper background. The ribbon, the readout, the rail, the editor and submit all keep working.

### Feedback states (DP-09, DP-17, DP-18, DP-23, DP-36, DP-37, DP-48, DP-49, DP-50, DP-51, DP-52, DP-53)

Every async action shows a visible state and announces it in its named polite live region, using exactly the copy below with the placeholders filled in. Copy is exact to the character: straight apostrophes, three ASCII dots, and the exact case and punctuation.

- **Sign in** (`status "Sign-in status"`): failure `That access code is not recognised.`
- **Finding save** (`status "Save status"`):
  - Pending: `Saving <label>...`
  - Success: `Saved <label>. Clearance <c> m, <Violation|Clear>.`
  - Field errors: `Could not save <label>. Check the highlighted fields.`
  - For a new finding, `<label>` is `new finding` while pending and the assigned label after success. Field messages are the API field messages, shown under each field and in the error summary.
- **Delete** (`status "Save status"`): `Deleted <label>.`
- **Terrain refinement** (`status "Terrain updates"`): `Ground height for <label> re-resolved to <h> m at terrain level <L>. Clearance now <c> m, <Violation|Clear>.`
- **Drone position (DP-49).** The page applies an answer from the flight endpoint only when it answers the latest scrub input. Answers to earlier inputs that arrive later are discarded and change nothing: not the marker, the readout, the camera or the URL. Until the answer to the latest input is applied:
  - the readout's drone line reads exactly `Drone locating...`;
  - the Flight time line is absent;
  - the drone marker is hidden.
- **Selection (DP-48)** (`status "View status"`): each time the user changes the selected finding, the page announces `Selected <label>, <span label>, chainage <c> m.`. For example, with the seed data at start, F-1 reads `Selected F-1, Span 2–3, chainage 470.0 m.`
- **View link** (`status "View status"`): `View link copied.`
- **Submit** (`status "Submit status"`):
  - Pending: `Submitting revision <r>...`, where `<r>` is the revision number.
  - Success, email sent: `Submitted revision <r>. Review link emailed to <email>.`
  - Success, email queued: `Submitted revision <r>. The email to <email> is queued and will send when mail is back.`
  - Already submitted (another person or tab): `This findings set was already submitted.`
  - Empty draft: the API field message for `findings`.
  - Storage unreachable: `Submit needs tile storage to write the evidence pack. Try again when storage is back.`
- **Link actions** (`status "Link status"`):
  - Resend, sent: `Review link resent to <email>.`
  - New link, sent: `New review link sent to <email>. The previous link no longer works.`
  - Either, queued: `The email to <email> is queued and will send when mail is back.`
  - Withdraw: `Review link withdrawn.`
- **Link-state suffix (DP-53).** The workspace link line ends with exactly one suffix:
  - ` · Withdrawn` when the link is revoked.
  - ` · Expired` when the link has expired.
  - Otherwise ` · Email queued` or ` · Email sent`, from the link's `email_state`.
  - For example, a link submitted at 15:30 UTC on 2026-11-02 for Ash Creek reads `Link expires 2026-11-16 09:30 (America/Chicago) · Email queued` until delivery, and `Link expires 2026-11-16 09:30 (America/Chicago) · Email sent` after it.
  - On every status check, the workspace re-reads the current findings set and updates this line in place, with no reload and no change of focus.
  - Delivery by any app process sharing the database counts, so the suffix flips even on a page served by a process that cannot reach mail.
- **Pending actions (DP-50).**
  - From the first press until the server answers, `button "Confirm submit"`, `button "Resend link"`, `button "New link"`, `button "Withdraw link"` and `button "Send decisions"` each have `aria-disabled="true"`. Further presses, Enter, or a press combined with Enter send nothing new.
  - The region announces only the outcome of the first request. The page's own duplicate never replaces a success with the already-submitted copy or any other copy.
- **Set actions** (`status "Submit status"`):
  - Close: `Findings set closed.`
  - Revision: `Revision <r> started as a draft.`
- **Upload** (`status "Upload status"`):
  - Progress: `Uploading <k> of <m> files for <kind label>`
  - Verifying: `Verifying <m> files with storage`
  - Success: `<kind label> stored: <m> files verified.`
  - Mismatch: `<kind label> rejected: <path> did not match its checksum.`
  - Invalid track: `Flight track rejected: no position samples with an epoch and availability.`
  - Storage unreachable: `Tile storage is unreachable. Upload paused; nothing was stored.`
- **Review** (`status "Review status"`):
  - Decision saved: `<label> marked accepted.` or `<label> marked disputed.`, announced after each 200 for a decision.
  - Sent: `Decisions sent: <a> accepted, <d> disputed.`
  - Validation: the API field messages.
  - Decision failed: `Could not save the decision for <label>. Try again.`
  - Send failed: `Could not send the decisions. Try again.`
- **Honest decision state (DP-51).**
  - `aria-pressed` changes only after the decision request answers 200, and then it shows the decision the server stored.
  - When a decision or send request fails at the network level or with a 5xx:
    - the pressed state stays at the last stored decision;
    - a typed dispute note stays in its box;
    - the matching failure copy is announced.
  - When any request answers `410 link_revoked` or `410 link_expired`, the whole page switches to the matching link-problem message, with no rail, globe or ribbon.
  - When any request answers `409 review_closed`, the page re-reads the review and shows the decisions-final state:
    - the rail shows `Decisions for this revision are final.`;
    - each finding shows its stored decision line;
    - no Accept, Dispute, note box or Send decisions control remains.
  - A review opened with `read_only:true` shows the same decisions-final state.
- **Review link problems** (the whole page, also announced):
  - Expired: `This review link has expired. Ask your survey contractor for a new one.`
  - Withdrawn: `This review link has been withdrawn. Ask your survey contractor for a new one.`
  - Unknown: `This review link does not exist.`
- **Empty corridor.**
  - A corridor with no stored terrain or tileset shows `No survey assets stored for this corridor yet.` over the globe.
  - A rail with no findings set shows `No findings set for this corridor yet.`
- **Storage outage** (workspace and review page). The page checks `GET /api/status` when it loads and then every 10 seconds. While storage is reported unreachable:
  - The `alert` banner reads `Tile storage is unreachable. Findings stay editable, and tiles will reload when storage is back.`
  - In place of the globe canvas, the page shows `No tiles can be shown right now. Use the span ribbon and the findings rail to keep working.`
  - The banner and message appear on the first check that reports unreachable. Within 20 seconds of storage answering again, they disappear and tiles are requested again. Neither needs a reload.
  - The alert element is inserted once, when the outage is first detected, and stays in the page until a check reports storage as ok. Checks that report the same state never remove, re-insert or re-announce it.
- **Status checks preserve work (DP-52).** A status check, and everything it triggers, never:
  - closes or resets an open dialog;
  - discards typed field values;
  - moves focus;
  - collapses an expanded sheet;
  - switches the rail tab;
  - collapses an expanded asset `Files` row;
  - scrolls the rail.

  When a check finds that storage has changed from unreachable to ok, the workspace re-reads its assets and updates the rows in place under the same rule. Assets that the server has since confirmed show `Stored` without a reload.
- **Collapsed phone sheet (DP-48).** While the sheet is collapsed:
  - Only its summary line and `button "Show findings"` are present for the user.
  - Everything else inside it is absent from the accessibility tree, is not a Tab stop and cannot be clicked or tapped. That includes `listbox "Findings"`, the finding action buttons, `tablist "Rail sections"` and the Assets content. Moving it out of view does not count as collapsing it.
  - Collapsing the sheet while focus is inside it moves focus to `button "Show findings"`. Focus never stays on a hidden element.
  - Expanding the sheet moves focus to its first control.

## Backend

### API (DP-01, DP-03, DP-08, DP-10, DP-12, DP-14, DP-15, DP-18, DP-21, DP-22, DP-24, DP-25, DP-28, DP-33, DP-44)

**Conventions.**

- All API routes are under `/api`.
- Requests with a body send `Content-Type: application/json`, except file uploads.
- JSON request bodies may be at most 65,536 bytes, and exactly 65,536 is accepted. `POST /api/corridors/{id}/assets` allows up to 2,000,000 bytes, and exactly 2,000,000 is accepted.
- An uploaded file body may be at most 50,000,000 bytes, and exactly 50,000,000 is accepted.
- Responses are JSON in UTF-8 unless stated otherwise.
- Times are ISO 8601 UTC with `Z`. Flight `time` values always have exactly three fractional digits, rounded to the nearest millisecond, for example `2026-06-14T14:04:00.000Z`.
- Distances and heights are metres. Heights are ellipsoidal (WGS84).

**Authentication.** Staff routes accept the `spanwise_session` cookie set by sign-in, or `Authorization: Bearer <access code>`. Review routes are authorised only by the token in the path.

**Error shape** (every error, no exceptions): `{"error":{"code":"<code>","message":"<human text>"}}`

- Every `422` has code `validation_failed` and adds `"fields":{"<field>":"<message>"}`, with two exceptions:
  - `checksum_mismatch` adds `fields` with exactly one key, either `size_bytes` or `sha256`.
  - `invalid_czml` has no `fields`.
- Array items use dotted paths such as `files.2.path`.
- `illegal_transition` adds `"from":"<state>","action":"<action>"`.

**Error precedence.** This is the only order, and it applies to every route:

1. `413 payload_too_large`, `415 unsupported_media_type`.
2. Authentication:
   - staff routes: `401 unauthenticated`;
   - review routes: `404 link_not_found` for an unknown token, then `410 link_revoked` or `410 link_expired`.
3. A reused `Idempotency-Key`, handled as in Idempotency below.
4. `404 not_found` for an unknown resource, another tenant's resource, or a resource outside the link's scope.
5. `403 forbidden` for the wrong role, or `403 cross_origin`.
6. `409` state conflicts.
7. `422` validation.
8. `503 storage_unavailable` when object storage is needed and does not answer.

Unknown routes answer `404 not_found`.

**Idempotency.** These routes honour an optional `Idempotency-Key` header of 1 to 128 visible ASCII characters:

- `POST /api/findings-sets/{id}/submit`
- `POST /api/findings-sets/{id}/review-link/resend`
- `POST /api/findings-sets/{id}/review-link/regenerate`
- `POST /api/review/{token}/complete`

How keys work:

- Keys are scoped to the tenant (or link) and the route, and are kept for 24 hours.
- The same key with the same body returns the first response's status and body unchanged, and has no new effects.
- The same key with a different body returns `409 idempotency_conflict`.
- Bodies are compared as parsed JSON values, ignoring whitespace and key order. An empty body counts as `{}`. Unused fields are ignored when processing but still count in the comparison.
- Only responses with a status below 500 are stored. After a 5xx, the same key runs the request again.
- Concurrent requests with the same key and body produce one effect, and every one of them returns that one response.

**Session and status**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/session` | `{"access_code":"<code>"}` | `200 {"staff":{"id","name","role":"survey_processor"\|"vegetation_analyst","email","tenant_id","tenant_name"}}`. Sets the HttpOnly, SameSite=Lax cookie `spanwise_session` | `401 invalid_access_code`, with the sign-in failure copy as its message. `422` `access_code`: `Enter your access code.` |
| `GET /api/session` | — | `200 {"staff":{…}}` | `401` |
| `DELETE /api/session` | — | `204` | — |
| `GET /api/health` | — | `200 {"status":"ok"}` | — |
| `GET /api/status` | — | `200 {"storage":"ok"\|"unreachable","mail":"ok"\|"unreachable","checked_at":"<time>"}`. No authentication | — |

**Corridors**

| Method and path | Success |
|---|---|
| `GET /api/corridors` | `200 {"corridors":[Corridor]}` for the caller's tenant, ordered by name |
| `GET /api/corridors/{id}` | `200 {"corridor":Corridor,"towers":[Tower],"active_assets":{"tileset":<id\|null>,"terrain":<id\|null>,"czml":<id\|null>},"coverage":[{"from_m","to_m"}]}` |
| `GET /api/corridors/{id}/flight?chainage_m=<n>` or `?time=<time>` | Covered: `200 {"chainage_m","time","covered":true,"position":{"lon_deg","lat_deg","height_m"}}`. Not covered: `200 {"chainage_m","time","covered":false,"label":"No flight coverage"}`. A value that cannot be determined is `null`. For a time query, `chainage_m` is the projected chainage of the interpolated position, rounded to one decimal |

Flight errors (`422`):

- `chainage_m`: `Chainage must be between 0 and <length> metres.`, where `<length>` is the corridor length with one decimal.
- `query`: `Give exactly one of chainage_m or time.`

`Corridor` is `{"id","name","voltage_kv","clearance_threshold_m","length_m","tower_count","utility":{"id","name","time_zone","forester_name","forester_email"},"inspection_due":"<YYYY-MM-DD>","overdue":<bool>,"current_set":{"id","revision","state"}|null}`.

- `current_set` is the corridor's set that is not closed.
- If every set is closed, it is the most recent closed set.
- If the corridor has no set, it is `null`.

`Tower` is `{"number","label":"T<number>","chainage_m","lon_deg","lat_deg","base_height_m","attachment_height_m"}`.

**Assets.** Staff of the owning tenant can read assets. Only the survey processor can declare and upload them.

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/corridors/{id}/assets` | `{"kind":"tileset"\|"terrain"\|"czml","files":[{"path","size_bytes","sha256"}]}` | `201 {"asset":Asset}` with state `pending` | `403`, `422` |
| `GET /api/corridors/{id}/assets` | — | `200 {"assets":[Asset]}`, newest first | — |
| `GET /api/assets/{id}` | — | `200 {"asset":Asset}` | — |
| `PUT /api/assets/{id}/files/{path}` | Raw file bytes, any content type | `200 {"asset":Asset,"file":File}` | `404` (path not in the manifest), `409 asset_rejected`, `409 file_already_stored` (bytes differ from the stored file; identical bytes answer `200`), `422 checksum_mismatch`, `422 invalid_czml`, `503` |
| `GET /api/assets/{id}/files/{path}` | Optional single `Range: bytes=<a>-<b>`, optional `?download=1` | `200` with the full bytes, or `206` with `Content-Range` | `404` (file not stored), `416 range_not_satisfiable`, `503` |

`checksum_mismatch` fields (size is checked first):

- `size_bytes`: `Bytes did not match the declared size.`
- `sha256`: `Bytes did not match the declared SHA-256.`

File read headers:

- `ETag: "<sha256>"`, `Accept-Ranges: bytes`, `Content-Length`.
- `Content-Type` is set by extension:
  - `.json` and `.czml`: `application/json`
  - `.glb`: `model/gltf-binary`
  - `.ktx2`: `image/ktx2`
  - `.terrain`: `application/vnd.quantized-mesh`
  - anything else: `application/octet-stream`
- `?download=1` adds `Content-Disposition: attachment; filename="<last path segment>"`.

`Asset` is `{"id","corridor_id","kind","state":"pending"|"stored"|"rejected","rejected_reason":null|"checksum_mismatch"|"invalid_czml","files":[File],"created_at","stored_at":<time|null>}`.

`File` is `{"path","size_bytes","sha256","state":"pending"|"stored"|"rejected"}`.

Manifest field messages (`422 validation_failed`):

- `kind`: `Choose tileset, terrain or czml.`
- `files`, one of:
  - `Declare between 1 and 2,000 files.`
  - `A tileset must include tileset.json.`
  - `A terrain pyramid must include layer.json.`
  - `A flight track is exactly one .czml file.`
  - `Each path may appear once.`
- `files.<i>.path`: `Use a relative path of letters, digits, dot, dash and underscore segments.` A valid path is 1 to 512 characters long, made of segments of `A-Z a-z 0-9 . _ -` joined by `/`. No segment may be `.` or `..`.
- `files.<i>.size_bytes`: `Each file must be between 1 and 50,000,000 bytes.`
- `files.<i>.sha256`: `Give the SHA-256 as 64 lowercase hex characters.`

The `invalid_czml` message is `The flight track has no position samples with an epoch and availability.`

**Findings sets and findings.** Only the vegetation analyst may change anything. Both staff roles can read.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/corridors/{id}/findings-sets` | `{}` | `201 {"set":Set}`, revision 1, `draft` | `409 open_set_exists` |
| `GET /api/findings-sets/{id}` | — | `200 {"set":Set,"findings":[Finding]}` | — |
| `POST /api/findings-sets/{id}/findings` | FindingInput | `201 {"finding":Finding}` | `409 set_not_draft`, `422` |
| `PATCH /api/findings/{id}` | Any of `canopy_height_m`, `canopy_radius_m`, `comment`. Optionally a new location: a position form, `ground_height_m` and `terrain_level`, all together | `200 {"finding":Finding}` | `409 set_not_draft`, `422` |
| `DELETE /api/findings/{id}` | — | `204` | `409 set_not_draft` |
| `POST /api/findings/{id}/terrain` | `{"ground_height_m","terrain_level"}` | `200 {"finding":Finding,"previous":{"ground_height_m","terrain_level","clearance_m"}}` | `409 set_not_draft`, `409 coarser_terrain`, `422` |
| `POST /api/findings-sets/{id}/submit` | `{}` | `200 {"set":Set,"review_link":ReviewLink,"email":"sent"\|"queued"}` | `409 illegal_transition`. `422` `findings`: `Add at least one finding before submitting.` `503` |
| `POST /api/findings-sets/{id}/close` | `{}` | `200 {"set":Set}` | `409 illegal_transition` |
| `POST /api/findings-sets/{id}/revisions` | `{}` | `201 {"set":Set}` (the new draft) | `409 illegal_transition` |
| `POST /api/findings-sets/{id}/review-link/resend` | `{}` | `200 {"review_link":ReviewLink,"email":"sent"\|"queued"}` | `409 link_not_live` |
| `POST /api/findings-sets/{id}/review-link/revoke` | `{}` | `200 {"review_link":ReviewLink}` | `409 link_not_live` |
| `POST /api/findings-sets/{id}/review-link/regenerate` | `{}` | `201 {"review_link":ReviewLink,"email":"sent"\|"queued"}` | `409 illegal_transition` |
| `GET /api/findings-sets/{id}/evidence` | — | `200` with the stored evidence pack bytes, `Content-Type: application/json` | `404` (before submit), `503` |

`FindingInput` has a position in exactly one of two forms, `{"chainage_m","offset_m"}` or `{"lon_deg","lat_deg"}`, plus these fields:

- `ground_height_m`
- `terrain_level`: an integer from 0 to 24, or `null` for hand-entered
- `canopy_height_m`
- `canopy_radius_m`: default 3.0
- `comment`: default `""`

`Finding` is `{"id","set_id","label":"F-<n>","chainage_m","offset_m","lon_deg","lat_deg","ecef_m":[x,y,z],"ground_height_m","terrain_level","canopy_height_m","canopy_top_height_m","canopy_radius_m","span":{"from_tower","to_tower","label":"Span <a>–<b>"},"clearance_m","status":"violation"|"clear","comment","updated_at"}`. `ecef_m` holds unrounded float64 metres.

`Set` is `{"id","corridor_id","revision","state","previous_set_id","submitted_at","submitted_by","frozen":{"finding_count","violation_count"}|null,"review_link":ReviewLink|null,"decisions":{"<finding id>":{"decision":"accept"|"dispute","note"}}}`.

`ReviewLink` is `{"url":"<APP_PUBLIC_URL>/review/<token>","expires_at","status":"live"|"revoked"|"expired","email_state":"queued"|"sent"}`.

- The token is at least 32 random URL-safe characters.
- `email_state` is the delivery state of the most recent review-link email recorded for that link.

Finding field messages (`422 validation_failed`). Every range includes its bounds.

- `position`: `Give either chainage and offset or longitude and latitude.`
- `chainage_m`: the flight chainage message. A longitude and latitude that projects outside the corridor gets either this message or the offset message.
- `offset_m`: `Offset must be between -60 and 60 metres.`
- `ground_height_m`: `Ground height must be between -500 and 9,000 metres.`
- `terrain_level`: `Terrain level must be a whole number from 0 to 24, or empty.`
- `canopy_height_m`: `Canopy height must be between 0.5 and 80 metres.`
- `canopy_radius_m`: `Canopy radius must be between 0.5 and 20 metres.`
- `comment`: `Comment must be 2,000 characters or fewer.`

**Review link routes** (authorised by the token)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/review/{token}` | — | `200 {"set":Set,"corridor":Corridor,"towers":[Tower],"active_assets":{…},"coverage":[…],"findings":[Finding],"contractor":{"name"},"expires_at","read_only":<bool>}`. Here `Set.review_link` is `null` | — |
| `PUT /api/review/{token}/findings/{finding_id}/decision` | `{"decision":"accept"\|"dispute","note":"<text>"}` | `200 {"decision":{"finding_id","decision","note"}}` | `409 review_closed`, `422` (fields below) |
| `POST /api/review/{token}/complete` | `{}` | `200 {"set":Set,"summary":{"accepted","disputed"}}` | `409 review_closed`. `422` `decisions`: `Decide every finding before sending.` |
| `GET /api/review/{token}/assets/{asset_id}/files/{path}` | As for staff file reads | As for staff file reads | `404` for any asset that does not belong to this set's corridor |
| `GET /api/review/{token}/flight?…` | As for the staff flight endpoint | As for the staff flight endpoint | — |

Decision field errors (`422`):

- `decision`: `Choose accept or dispute.`
- `note`: `Add a note explaining the dispute.` for a dispute with an empty note, or `Comment must be 2,000 characters or fewer.`

### Business rules (DP-02, DP-08, DP-09, DP-11, DP-12, DP-14, DP-18, DP-21, DP-22, DP-24, DP-25, DP-26, DP-28, DP-31, DP-32, DP-33)

**Geometry.**

- Every position is held as WGS84 earth-centred, earth-fixed (ECEF) coordinates in float64 metres. The ellipsoid has a semi-major axis of 6,378,137 m and a flattening of 1/298.257223563. Heights are ellipsoidal. ECEF is computed from longitude, latitude and height, and is never rounded in storage or in the API.
- The centreline is the geodesic that leaves tower 1 at the corridor's seeded azimuth. Each tower lies on it at its chainage.
- A point's chainage is the geodesic distance from tower 1 to the foot of the point's perpendicular on the centreline. Its offset is the signed perpendicular distance, positive to the right when facing increasing chainage.

**Clearance.**

- The canopy top is at `ground_height_m + canopy_height_m`.
- Each span's conductor is the straight ECEF segment between the two towers' attachment points. An attachment point is at the tower's position, at height `base_height_m + attachment_height_m`.
- `clearance_m` is the shortest 3D distance from the canopy top point to the conductor of the span that contains the finding's chainage.
- Status is `violation` when the clearance is strictly less than `clearance_threshold_m`, and `clear` otherwise.

**Labels.**

- Labels are `F-<n>`. They are unique within a set and assigned in commit order without gaps: each new finding gets one more than the highest number ever assigned in that set.
- A deleted finding's number is never reused. A rejected or rolled-back create never uses up a number.
- Concurrent creates never share a label.
- A revision keeps the copied labels and continues the numbering.

**Terrain re-resolution.**

- A finding records the terrain level its ground height was resolved at. `null` means hand-entered, and it ranks below every level.
- `POST /api/findings/{id}/terrain` is accepted only when `terrain_level` is strictly greater than the level stored at the moment it commits. Then the ground height, canopy top, ECEF position and clearance are recomputed. Otherwise it answers `409 coarser_terrain` and changes nothing.
- Under concurrent requests, from one process or several, the stored level only ever increases. The final level is the highest one submitted. `previous` in each 200 is exactly the row that request replaced.
- A location change through `PATCH` sets the level to the one given.

**Flight track.**

- The corridor's flight track is its most recently stored `czml` asset.
- Spanwise reads the first packet whose `position` has an `epoch` and `cartographicDegrees` samples in groups of four: seconds, longitude, latitude, height. A sample's time is the epoch plus its seconds.
- The packet's `availability` (one interval or an array of intervals) bounds the track.
  - A sample whose time lies outside every interval is ignored entirely.
  - A track without such a packet is `invalid_czml`.
- Positions between two consecutive samples in the same interval are interpolated linearly in longitude, latitude and height. Nothing is ever extrapolated.
- For a chainage, the flight time is the earliest time at which two consecutive in-interval samples bracket it by their projected chainages, interpolated linearly between them.
  - The drone may fly in either direction, so a pass that flies toward lower chainage brackets chainages too.
  - Where passes overlap, the earliest time always wins.
- For a time, the position is interpolated between the two in-interval samples that bracket that time.
- A chainage or time with no such bracket is not covered.
- `coverage` lists the covered chainage ranges merged into the fewest ranges. Each has `from_m < to_m`, and the list is ascending and non-overlapping. A corridor without a stored track has no coverage.
- The track is parsed once, when its asset becomes stored. The samples and coverage are kept in PostgreSQL, so flight answers and coverage keep working while object storage is unreachable.

**Storage confirmation.**

- When a file's bytes arrive, the server writes the object with its SHA-256 checksum, so that storage itself checks the bytes. It then reads back the object's size and checksum from storage.
- The file becomes `stored` only when both match the declared values.
- On any mismatch, the file and its asset become `rejected` with the reason, and every object already written for that asset is deleted. Once all in-flight requests for the asset have answered, no object remains under its prefix.
- The asset becomes `stored` only after every file in its manifest is stored. For `czml`, the track must also parse; otherwise the asset is rejected as `invalid_czml` and its object deleted.
- When the last files arrive concurrently, possibly at different processes, the asset becomes `stored` exactly once, with one `stored_at` that never changes afterwards. A `czml` track is parsed and its coverage written exactly once.
- Concurrent PUTs of the same file with identical bytes all answer `200` and leave one object.
- Nothing about storage state is ever decided from the browser's own upload events.

**Originals.**

- Stored objects hold exactly the uploaded bytes. Parsing, defaults and normalisation happen only on a working copy.
- File reads return the stored bytes unchanged, never compressed or transformed in transit. The `ETag` is the stored SHA-256.

**Findings set states.** `draft`, `submitted`, `under_review`, `accepted`, `disputed`, `closed`. The legal transitions are:

| From | Action | To | Who |
|---|---|---|---|
| (none) | create | `draft` (revision 1) | Analyst. Allowed only when the corridor has no set that is not closed; otherwise `409 open_set_exists` |
| `draft` | submit | `submitted` | Analyst |
| `submitted` | any successful review-link request | `under_review` | Forester |
| `under_review` | complete, all accepted | `accepted` | Forester |
| `under_review` | complete, any disputed | `disputed` | Forester |
| `accepted` | close | `closed` | Analyst |
| `disputed` | revise | The old set becomes `closed`, and a new `draft` revision n+1 is created with `previous_set_id` set to the old set and its findings copied | Analyst |

- Every other set action answers `409 illegal_transition`.
  - `from` is the current state's API value.
  - `action` is `submit`, `close`, `revise` or `regenerate`, matching the route.
  - The message is `Cannot <action> a <state> findings set.`, always with the article `a`.
  - For example: `{"error":{"code":"illegal_transition","message":"Cannot close a under_review findings set.","from":"under_review","action":"close"}}`.
- Creating, editing, deleting or re-resolving a finding in a set that is not `draft` answers `409 set_not_draft`.
- A `closed` set is read-only for everyone.

**Submit.** In one transaction, submit:

1. checks that the draft has at least one finding;
2. freezes `finding_count` and `violation_count` from the current findings;
3. sets `submitted_at` and `submitted_by`;
4. writes the evidence pack;
5. mints the review link;
6. records the review email in the outbox.

The email is attempted only after commit. If any step fails, nothing changes and nothing is sent. Frozen counts never change afterwards. Of simultaneous submits of one draft, exactly one returns `200`. The others return `409 illegal_transition`, unless they carry the winner's key and body, in which case they get the winner's response replayed.

**Evidence pack.** A JSON document written at submit, using the API's types and units. It has exactly these keys:

- `set_id`, `corridor_id`, `revision`, `submitted_at`, `frozen` (`{"finding_count","violation_count"}`);
- `findings`: an array of objects with `label`, `ecef_m`, `lon_deg`, `lat_deg`, `ground_height_m`, `terrain_level`, `canopy_top_height_m`, `canopy_radius_m`, `chainage_m`, `span_label`, `clearance_m`, `status`, `comment`;
- `assets`: the active assets, as objects with `id`, `kind` and `files` (`path`, `size_bytes`, `sha256`).

**Review links.**

- **Scope.** A link belongs to one tenant, one corridor and one submitted set. Through it, only that set, its corridor and that corridor's assets can be read. Anything else answers `404`.
- **Expiry.** A link expires `REVIEW_LINK_TTL_SECONDS` after it was minted, judged by the server clock. After that, every request with it answers `410 link_expired`. The page states the expiry and refuses decisions after it, whatever the browser clock says.
- **Revoke.** Every request with the link answers `410 link_revoked` from that moment. Revoking a link that is not live answers `409 link_not_live`.
- **Resend.** Returns the same live token with its unchanged expiry and records a new email carrying it. It never mints a second live link. Resending a link that is not live answers `409 link_not_live`.
- **Regenerate.** Revokes the current link, mints a new token that expires `REVIEW_LINK_TTL_SECONDS` from now, and emails it. It is allowed in `submitted`, `under_review`, `accepted` and `disputed`. One request mints exactly one token.
- **Email state.** A link's `email_state` is `queued` from the moment an email for it is recorded. It becomes `sent` only when the SMTP server has accepted the most recent email for that link, whichever process delivered it.
- **After decisions.** Once a set is `accepted`, `disputed` or `closed`, its live link still reads with `read_only:true`, and every decision or complete request answers `409 review_closed`.

**Decisions.**

- Before completion, a later decision for the same finding replaces the earlier one.
- Complete requires a decision for every finding.
- Of simultaneous completes, exactly one returns `200`. The others return `409 review_closed`.
- A decision that arrives concurrently with a completion that commits first answers `409 review_closed` and changes nothing.
- The decision summary email is recorded in the completing transaction and sent after commit.

**Time rules.**

- A corridor is `overdue` when today's date in its utility's time zone is later than `inspection_due`. This is decided on every read.
- Link expiry is checked on every request.

### Services (DP-11, DP-23, DP-33, DP-35, DP-37, DP-53)

- **Object storage (MinIO).** One private bucket, named by `S3_BUCKET`.
  - Asset files: `tenants/<tenant id>/corridors/<corridor id>/assets/<asset id>/<path>`.
  - Evidence packs: `tenants/<tenant id>/corridors/<corridor id>/findings-sets/<set id>/evidence.json`.
  - Tiles reach the browser only through the app's file routes, which pass byte ranges through.
  - When storage does not answer, file reads, uploads, submit and the evidence endpoint answer `503 storage_unavailable` with the message `Tile storage is unreachable.`. Everything else keeps working.
- **PostgreSQL.** Stores tenants, staff, utilities, corridors, towers, assets with their manifests and states, parsed flight samples and coverage, findings sets with frozen counts, findings, decisions, review links with their email state, idempotency records and the email outbox. The schema is applied idempotently on every start.
- **Mailpit (SMTP).** Every message has the From line `Spanwise <reviews@larchline.example>`, read from `MAIL_FROM`.
  - **Review link email**, sent on submit, resend and regenerate:
    - To: the utility forester.
    - Subject: `Spanwise review: <corridor name> revision <r>`.
    - The body has the link URL alone on one line, the line `Link expires <YYYY-MM-DD HH:mm> (<time zone>)`, and the frozen counts as `<n> findings, <v> violations`.
  - **Decision summary**, sent on complete:
    - To: the analyst who submitted.
    - Subject: `Spanwise decision: <corridor name> revision <r> <accepted|disputed>`.
    - The body has one line per finding: `<label> accepted` or `<label> disputed: <note>`.
  - **Delivery.**
    - An email counts as `sent` only after the SMTP server accepted it. The request that records it tries to send it within a 5-second limit. If that fails, the email stays queued in the shared outbox and the response reports `queued`.
    - Every app process that can reach mail retries queued emails at least every 30 seconds, whoever queued them. A queued email is delivered within 60 seconds of any process sharing the database reaching mail, with no restart.
    - While a request is still within its 5-second attempt, no other process takes that email.
    - Each recorded email is delivered exactly once across all processes.

### Seed data (DP-01, DP-02, DP-03, DP-08, DP-09, DP-14)

Every person, business, utility and corridor below is invented.

- On every start, the app inserts only the seed rows that are missing. It never resets or overwrites a changed seeded row.
- Seeded assets start `pending`. They become `stored` only after the server has written their procedurally generated fixture files to object storage and confirmed them under the storage rule. While storage is unreachable they stay `pending`.

**Tenants and staff**

| Tenant id | Tenant name | Staff name | Role | Access code | Email |
|---|---|---|---|---|---|
| `kestrel` | Kestrel Ridge Aerial | Tomas Adeyemi | survey_processor | `kestrel-processor-4417` | tomas.adeyemi@kestrelridge.example |
| `kestrel` | Kestrel Ridge Aerial | Rosa Lindqvist | vegetation_analyst | `kestrel-analyst-2093` | rosa.lindqvist@kestrelridge.example |
| `bluefen` | Blue Fen Survey | Jun Park | survey_processor | `bluefen-processor-6620` | jun.park@bluefen.example |
| `bluefen` | Blue Fen Survey | Mika Osei | vegetation_analyst | `bluefen-analyst-7731` | mika.osei@bluefen.example |

**Utility clients**

| Id | Name | Tenant | Time zone | Forester | Forester email |
|---|---|---|---|---|---|
| `northmere` | Northmere Power Cooperative | kestrel | America/Chicago | Dana Okafor | dana.okafor@northmere.example |
| `sallow` | Sallow Valley Electric | kestrel | America/Denver | Lee Marchetti | lee.marchetti@sallowvalley.example |
| `harrow` | Harrow Coast Utilities | bluefen | America/Los_Angeles | Sam Whitlock | sam.whitlock@harrowcoast.example |

**Corridors.** The Tower 1 column gives latitude, longitude and the centreline azimuth.

| Id | Name | Utility | kV | Threshold | Inspection due | Tower 1, azimuth | Towers: chainage m / base height m | Attachment above base |
|---|---|---|---|---|---|---|---|---|
| `nm-ash-creek` | Ash Creek 345 kV | northmere | 345 | 3.00 m | 2026-03-31 | 44.500000 N, 93.200000 W, 90° | T1 0/248.0, T2 312/251.5, T3 640/255.0, T4 955/253.0, T5 1268/249.5, T6 1590/246.0, T7 1904/247.5, T8 2231/252.0, T9 2550/256.5, T10 2870/254.0 | 24.0 m |
| `nm-birch-hollow` | Birch Hollow 138 kV | northmere | 138 | 1.60 m | 2030-06-30 | 44.620000 N, 93.050000 W, 45° | T1 0/300.0, T2 210/300.0, T3 430/300.0, T4 655/300.0, T5 870/300.0, T6 1085/300.0 | 18.0 m |
| `sv-cutbank` | Cutbank 230 kV | sallow | 230 | 2.20 m | 2030-09-30 | 40.100000 N, 105.300000 W, 0° | T1 0/1650.0, T2 380/1650.0, T3 760/1650.0, T4 1150/1650.0 | 30.0 m |
| `hc-dune-road` | Dune Road 115 kV | harrow | 115 | 1.40 m | 2030-05-31 | 36.800000 N, 121.700000 W, 120° | T1 0/20.0, T2 250/20.0, T3 500/20.0 | 20.0 m |

A corridor's length is its last tower's chainage. With the seed data at start, for example, Ash Creek is Overdue.

**Seeded assets**

| Asset id | Corridor | Kind | Content |
|---|---|---|---|
| `ast-ash-terrain` | nm-ash-creek | terrain | Quantized-mesh pyramid, levels 0 to 15, with `layer.json` |
| `ast-ash-tileset` | nm-ash-creek | tileset | `tileset.json` plus glb tiles with compressed geometry and KTX2 textures, showing canopy, including a tree at each seeded finding |
| `ast-ash-czml` | nm-ash-creek | czml | One file, `ash-creek-2026-06-14.czml` |
| `ast-birch-terrain` | nm-birch-hollow | terrain | Quantized-mesh pyramid, levels 0 to 15 |

**Fixture terrain.** Ground height is the linear interpolation, by chainage, of the two neighbouring towers' base heights. It is the same across the corridor's width, and beyond the ends it stays at the end towers' heights. Each level samples this on its own grid, so coarser levels can differ by a few metres, while level 15 is within 0.2 m.

**`ash-creek-2026-06-14.czml`.** The epoch is `2026-06-14T14:00:00Z`. Samples sit on the centreline at 320.0 m ellipsoidal height, every 10 seconds within each availability interval. Each interval is flown at constant speed:

1. `2026-06-14T14:00:00Z/2026-06-14T14:08:00Z`, from chainage 0 to 1268.
2. `2026-06-14T14:15:00Z/2026-06-14T14:22:00Z`, from chainage 1904 to 2870.
3. `2026-06-14T14:30:00Z/2026-06-14T14:37:00Z`, a reverse re-flight from chainage 2870 back to 1904.

There are also two stray samples outside every interval, which must be ignored: one at +540 s (14:09:00), on the centreline at chainage 1400, and one at +1560 s (14:26:00), at chainage 2500.

For example, with the seed data at start:

- chainage 634 maps to `2026-06-14T14:04:00.000Z`;
- chainage 2387 maps to `2026-06-14T14:18:30.000Z`, from the earlier pass and not the reverse pass;
- `?time=2026-06-14T14:33:30Z` is covered at chainage 2387.0;
- `?time=2026-06-14T14:09:00Z` and `?time=2026-06-14T14:26:00Z` are not covered;
- `coverage` is exactly `[{"from_m":0,"to_m":1268},{"from_m":1904,"to_m":2870}]`;
- everything strictly between 1268 and 1904 has no flight coverage.

**Seeded findings sets.** Ash Creek has a `draft`, revision 1, created by Rosa Lindqvist:

| Label | Chainage m | Offset m | Ground height m | Terrain level | Canopy height m | Radius m | Comment | Status at seed |
|---|---|---|---|---|---|---|---|---|
| F-1 | 470.0 | 1.50 | 253.00 | 15 | 24.00 | 3.0 | Silver maple leader under conductor, east of T2 | violation |
| F-2 | 1180.0 | -9.00 | 251.00 | 9 | 12.00 | 4.0 | Aspen clump on north edge | clear |
| F-3 | 1915.0 | 2.00 | 248.00 | 15 | 22.50 | 2.5 | Cottonwood just past T7 | violation |
| F-4 | 2700.0 | -4.00 | 255.00 | 15 | 15.00 | 3.0 | Boxelder regrowth | clear |

F-2 was resolved at level 9. Selecting it in the Ash Creek workspace refines it to level 15.

Dune Road has a `draft`, revision 1, created by Mika Osei, with one finding: F-1 at chainage 120.0, offset 3.00, ground 20.50 at level 12, canopy height 16.00, radius 3.0, comment `Monterey cypress`.

Birch Hollow and Cutbank have no findings sets.

## Technical requirements

### Deployment (DP-45)

- The runtime is Node.js 22 with npm, and the app is TypeScript.
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```
- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` returns HTTP 200 JSON `{"status":"ok"}` as soon as the server listens, whatever the state of storage or mail.
- Review link URLs start with `APP_PUBLIC_URL` when it is set, and with `http://localhost:<port>` otherwise.

### Configuration and secrets (DP-47)

Read every value from the environment at start. Never hard-code any of them or send them to the browser.

| Purpose | Variables |
|---|---|
| PostgreSQL | `DATABASE_URL` |
| Object storage | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| Review link lifetime | `REVIEW_LINK_TTL_SECONDS`: a positive whole number of seconds, default 1,209,600 (14 days) |
| Public address | `APP_PUBLIC_URL`, `APP_PUBLIC_PORT` |

The database and the bucket always exist before start, and either may be empty. The app never creates databases or buckets. On an empty database and bucket, it applies its schema and the full seed.

### Server boundary (DP-35, DP-45)

- **One origin** serves the built frontend and `/api`.
  - The server sends no permissive cross-origin headers.
  - A mutating request whose `Origin` header names a different origin answers `403 cross_origin`.
- **Never served.** Source files, `run.json`, `package.json`, lockfiles, dependency folders, environment files and credentials. Requests for them answer `404 not_found`. No response or shipped script contains a service credential.
- **Boot without dependencies.** When storage or mail does not answer at boot, the server still starts and serves everything that does not need that service.
  - It probes each service at boot and then at least every 10 seconds. `GET /api/status` reports the latest result.
  - Within 10 seconds of storage answering, the server resumes fixture seeding, file reads, uploads and submit, with no restart.
  - Mail recovery follows Services.
- **Several processes.** Several app processes may run at once against the same database and bucket.
  - Schema application, seeding, fixture writes, label assignment, terrain refinement, storage confirmation, idempotency records and outbox delivery are all safe under that concurrency.
  - Concurrency never creates duplicate rows or objects and never sends an email twice.

### Browser support and performance (DP-43)

- **Browsers:** current Chromium, Firefox and WebKit.
- **Viewports:** 375x812, 768x1024 and 1280x800.
- **Ready in five seconds.** The Ash Creek workspace is usable within five seconds of navigation on the local network. Usable means the ribbon responds to keys, the readout shows chainage and span, and the rail lists the findings.
- **Responsive while streaming.** After that, while the corridor streams, no single main-thread task lasts longer than 100 milliseconds. Compressed mesh decoding, KTX2 transcoding and quantized-mesh unpacking run in a pool of background workers.
- **Stable markers.** Finding markers stay within one CSS pixel of their true projected position at any camera altitude, from orbit down to 50 m above ground, and never jitter.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and the commands run from `/app` with no interactive prompts.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) with its licence, plus the bundled fonts and icons with theirs.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or Zlib, and fonts are SIL OFL 1.1. A licence given as an SPDX OR expression passes when at least one option is on that list, and an AND expression passes only when every part is.
- IF-04: The only datastores are the provided PostgreSQL database and object storage bucket; there is no SQLite, Redis, embedded database or local file holding application state.
- IF-05: The provided service configuration and its development credentials are used as given and not modified.
- IF-06: All terrain, meshes, textures and flight tracks are generated by code in the repository, nothing is fetched from the public internet at runtime, and fonts are self-hosted.
- IF-07: `/app/package-lock.json` is committed and `install` uses it.

## Engineering standards

- Code is idiomatic strict TypeScript, with no `any` and no non-null assertions on values that can actually be missing.
- Names use this brief's domain terms: corridor, tower, span, chainage, offset, finding, findings set, revision, clearance, review link, asset, terrain level, coverage.
- Each domain rule is decided in exactly one place in the source. This covers every findings-set transition, the clearance and status derivation, the frozen counts, label assignment, the terrain-level ordering, the storage-confirmation rule, link liveness and expiry, email state, the coverage and interpolation rule, which flight answer is current on the page, and the overdue rule.
- Every API error is produced through one error shape, and one place decides the precedence order.
- There is no abstraction with a single implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the data model already rules out.
- There are no features, routes, screens or settings beyond this brief.
