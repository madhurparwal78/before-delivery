# Fathomwright Survey Works Swathdeck

Swathdeck is one browser console for small coastal survey contractors who run two to four small uncrewed survey boats at the same time.

- **Principal surveyor.** Plans a drawn survey area into mainscheme lines and crosslines for its survey order. Assigns them across the fleet, watches every boat's live telemetry, and closes coverage gaps ("holidays") while the boats are still on the water.
- **Launch technician.** Uses a phone at the slipway to launch and recover boats, upload raw sonar line files from each boat's logger, and log thruster service.
- **Client.** The harbour authority or dredging firm that ordered the survey. It reads coverage and crossline agreement and downloads the raw line files, the coverage CSV and the coverage report, for its own surveys only.

Swathdeck uses three services:
- Postgres holds its records.
- S3-compatible object storage (MinIO) holds raw line files and coverage reports.
- SMTP (Mailpit) carries alert and report emails.

These are out of scope:
- self-registration;
- screens for managing users, client organisations or vessels (all of them come from the seed data);
- piloting a boat remotely or sending it commands;
- sonar processing beyond the coverage and crossline-agreement rules in this brief;
- map tiles from outside services;
- any datastore other than Postgres and object storage.

## Problem and users

A small survey contractor now sends several small uncrewed boats out at the same time. Each boat's maker supplies its own piloting app, so the surveyor ends up watching several laptops on a wet bridge.

- **Line spacing and crosslines.** Line spacing is worked out by hand in a spreadsheet to reach the roughly 20% swath overlap that full-coverage orders need. The crosslines the specification demands are added by eye. They must total at least five percent of the mainscheme distance and run across it. Whether crossline depths agree with mainscheme depths within the survey order's allowed vertical uncertainty is checked only back at the office.
- **Holidays.** Holidays are the strips of seabed that no valid sonar swath reached. Today they are found only after recovery, when the files are processed at the office, so the crew has to come back for a second day of infill. That costs the contractor a boat day and a launch slot, and it often makes the harbour authority's dredge-acceptance soundings late. Data logged in a turn or at too high a speed does not count, so a track can look complete and still leave gaps.
- **Alerts.** Lost links and geofence excursions are noticed only by whoever happens to be looking at the right screen. An alarm someone has acknowledged is easily mistaken for one whose cause has cleared, and nobody can say afterwards who acknowledged what.
- **Service.** Thruster hours live in a notebook. A boat that is overdue for service still gets sent out, or runs past its limit in the middle of a survey.
- **Shared devices.** The bridge laptop is shared by the contractor's two principal surveyors. The slipway phone passes between the launch technician and visiting client engineers.

**Users.**
- **Principal surveyor** (daily). Plans a survey area into lines and crosslines for its survey order. Assigns them across the fleet and sets each boat's service interval. Launches and supervises the whole mission from one board, acknowledges alerts, and queues and orders infill lines over holidays before recovery.
- **Launch technician** (daily, on a phone at the slipway, often one-handed). Marks boats afloat and recovered. Uploads each surveyed line's raw file from the boat's logger, with the checksum the logger printed. Logs thruster service while a boat is ashore, and marks the mission complete after recovery.
- **Client reviewer** (weekly). An engineer at a harbour authority or dredging firm. Once the report-ready email arrives, they read coverage and crossline agreement and download the coverage CSV, the raw line files and the coverage report. They see their own organisation's surveys only.

The clock on a bridge laptop or a slipway phone may be wrong. Every status that depends on time comes from the server.

## Journeys

1. **Plan a survey.**
   - The principal surveyor starts signed out. They sign in and land on the fleet board.
   - They open New mission. Using only the keyboard, they type the survey-area vertices and geofence corners, opening the vertex format help when they need it. They set the planned depth, swath ratio, overlap, line azimuth, planned speed and survey order.
   - As they type, the plan preview shows the line count, crossline count and estimated duration for exactly what is in the form now, even when an earlier answer arrives late. The settings stay in the address, so reloading keeps them.
   - They create the mission and land on its line plan, which lists the mainscheme lines `L01`… and the crosslines `X01`….
2. **Ready the fleet.**
   - On the line plan the surveyor assigns every line and crossline to a vessel with each row's vessel picker, on a phone-width table too, and saves.
   - The save puts lines on Shearwater, so the whole save is refused and the plan status region shows the overdue block message.
   - The launch technician logs a thruster service for Shearwater, which is ashore, from the launch list. The slipway signal drops the first response, but pressing Save again still logs exactly one service.
   - The surveyor saves the same assignments again, and the plan status region confirms the save.
   - On the fleet board the surveyor raises Gannet's service interval. If someone else changed Gannet in the meantime, the save is refused, the typed value stays, and the current value is shown beside it.
3. **Slipway launch.**
   - The launch technician signs in on a phone and lands on the launch list.
   - They mark each assigned vessel afloat. Each row turns to Afloat only once the server has confirmed it. If the request is refused or the connection drops, the row keeps reading Ashore and shows why.
   - The principal surveyor launches the mission, and both screens show it as Launched.
4. **Supervise the fleet.**
   - The principal surveyor has a vessel's detail open on the fleet board while the loggers send fixes, some as buffered batches after a radio dropout. Position, speed, battery, coverage and the recent-fixes list change in place without a reload.
   - Link-state changes are announced once each.
   - A boat that strays outside the geofence raises one breach card, which is announced once and emailed, even when its logger sends the same fix several times at once. Its return inside is announced once.
   - A boat that stops reporting turns Stale and then Lost, which raises a link-lost alert.
   - Petrel runs past its service limit in the middle of a line. That raises a service-overdue alert. Petrel may finish that line but may not start another.
   - The surveyor tabs through the open alerts and acknowledges them by keyboard. Focus stays on the alert they are on while new alerts arrive.
   - An acknowledged card stays on the board reading `Acknowledged by <name> at <time> UTC` until its cause clears. A card whose cause clears first reads Rectified until someone acknowledges it. When two surveyors press Acknowledge at once, the history records exactly one acknowledgement.
   - An alert nobody acknowledges or rectifies escalates once by email.
5. **Close a holiday before recovery.**
   - On the mission console the surveyor sweeps the holiday lens over the chart with the arrow keys.
   - Under the lens, swaths turn into overlap bands. Holidays show hatched with their area, and specks too small to matter stay plain.
   - They press Enter. Once the server confirms the queue, a dashed infill line draws across the holiday, assigned to the nearest eligible boat, and the header counters change in place. A dropped or refused queue draws nothing.
   - They reorder that boat's infill queue with Alt and the arrow keys.
   - If the boat loses its link before starting, the infill moves to the next nearest eligible boat, and the move is announced.
   - When the infill pass covers the gap, or shrinks it below a three-cell run, the hatch clears and the counters change again. Crossline agreement updates as the crosslines are run.
6. **Upload line files.**
   - After the boats finish their lines, the launch technician uploads each surveyed line's file on a phone from the launch list, with the SHA-256 from the logger. The row reads `Uploading <n>%` and then Stored.
   - If the technician's session has ended, the upload dialog keeps the file, asks them to sign in again in place, and finishes the upload.
   - If the slipway connection drops mid-file, nothing is stored and the next attempt succeeds at once.
   - If object storage is down, the banner shows and is announced once, the line stays Awaiting upload, and the upload is held. It sends itself once storage returns, unless it was cancelled.
7. **Recover and complete.**
   - The technician marks every boat recovered and then marks the mission complete. A dropped request leaves the mission reading Recovering, and repeated taps change nothing further.
   - On success, focus moves to the next open mission on the list.
   - Swathdeck writes the coverage report to object storage once, in fixed bytes. The report includes crossline agreement, the completion time in the client's own time zone, and per-vessel totals.
   - Once that write is confirmed, each client reviewer of the mission's organisation receives exactly one report-ready email, addressed to them alone, that carries the report's SHA-256.
8. **Client review.**
   - The client reviewer follows the email link through sign-in and lands on that survey.
   - Their surveys list shows 20 surveys at a time, and Load more surveys brings the rest.
   - On the survey they read coverage and crossline agreement, filter the line files to one vessel, and download the coverage CSV, a raw line file whose checksum matches the one shown, and the coverage report.
   - They never see where the boats are now, or anything from another client's survey.
   - A guessed address for another organisation's survey or file shows the not-found page. An off-site sign-in return address lands them on their surveys list.
   - When they sign out of the shared phone and the technician signs in, nothing of theirs is painted for the technician.

9. **Field operations.**
   - At the slipway the signal drops. The technician marks two vessels afloat and logs a service anyway; the phone keeps them, survives a reload, and sends them in order when the signal returns.
   - The surveyor selects several lines by keyboard, assigns them to one vessel, and undoes it within ten seconds. Leaving the line plan with unsaved picker changes asks first.
   - Mid-survey the surveyor widens the geofence so a breached vessel is inside again, holds the survey for weather, resumes it, re-runs a line whose data was poor, reads the whole story on the mission history, and hands the mission to the second surveyor, who is told at once.
   - The client reviewer flags a delivered line with a comment, and the surveyor replies from the flags list.
   - With the chart shown as a keyboard grid, the surveyor walks the cells and queues infill from a holiday cell.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Role landing after sign-in** Signing in lands the principal surveyor on `/fleet`, the launch technician on `/launch` and the client reviewer on `/surveys`, or on the user's restored last screen as qualified in Business rules, and reloading that address shows the same screen.
- **DP-02 — Sessions and role permissions** Sign-in, session refresh, sign-out and the current-user endpoints behave as listed in API, and every endpoint enforces the permission table in Business rules.
- **DP-03 — Deep links and safe return** Opening a screen address while signed out shows sign-in and then lands on that address only when the safe-return rule in Business rules accepts it, and every off-site, protocol-relative, backslash, encoded, API or forbidden address lands on the role's home.
- **DP-04 — Sign-in attempt limit** Five failed sign-ins for one email within the attempt window lock that email with 429 `too_many_attempts` until one window after the fifth failure, even with the right password, counted atomically and identically for unknown emails, as qualified in Business rules.
- **DP-05 — Switching accounts on a shared device** Sign-out revokes the session server-side, the browser drops every record, announcement and held dialog of the previous account, and the next account never sees a survey, count or name of the previous one, even from a late response or the Back button.
- **DP-06 — Idle sign-out with a warning** After 28 minutes without input a signed-in screen warns with a two-minute countdown dialog that `Stay signed in` or Escape dismisses, and at zero signs out and returns to sign-in with the published copy, as qualified in Feedback states.
- **DP-07 — Plan a survey by keyboard** The principal surveyor types survey-area vertices, geofence corners, plan settings and survey order without a mouse, with a vertex format help that stays inside the viewport, creates the mission and lands on `/missions/<mission id>/plan`.
- **DP-08 — Line plan and crossline derivation** The server derives swath width, line spacing, every mainscheme line and crossline with its end points, the line and crossline counts and the estimated duration exactly by the line-plan rule in Business rules, and stores them with the survey order.
- **DP-09 — Preview follows the latest input** The plan preview shows the line count, crossline count and duration for the form's current values within one second of the last edit, discards responses to earlier input, equals the stored plan, and its settings live in the address, as qualified in Feedback states. Committed planner edits undo and redo by keyboard, as qualified in Field operations.
- **DP-10 — Planner validation summary** Invalid planner input is refused with 422 and per-field messages, and the form shows an error summary whose links move focus to each named field.
- **DP-11 — Idempotent mission creation** Replaying mission creation with the same idempotency key and body returns the original mission without creating another, and the same key with a different body returns 409 `idempotency_conflict`.
- **DP-12 — Assign lines across the fleet** On the line plan, the principal surveyor assigns every line and crossline to a vessel by keyboard or tap, saves, and sees the saved confirmation or the published refusal in the plan status region. Unsaved picker changes survive a reload and leaving the line plan asks first, as qualified in Field operations.
- **DP-13 — Vessel pickers stay reachable** At 375x812 and 768x1024 each line-plan row's vessel picker opens fully inside the viewport above every other layer and is operable by tap and keyboard, including on the last row.
- **DP-14 — Overdue-service block** The server refuses to assign lines to, mark afloat, launch with or start a line on a vessel whose hours since service exceed its own service interval, never makes it eligible for infill, and the screen shows the overdue block message.
- **DP-15 — Thruster hours from running time** Thruster hours grow only from fix intervals of at most 60 seconds while the vessel runs a line faster than 0.3 m/s, over-speed and off-heading pairs included, as qualified in Business rules.
- **DP-16 — Log a thruster service exactly once** The launch technician logs a service for a vessel that is ashore, which resets its hours since service at once; a vessel afloat is refused with 409 `vessel_afloat`, and a repeated idempotency key from the dialog's retry creates exactly one entry, as qualified in API.
- **DP-17 — One vessel, one open mission, under races** A vessel holds lines on at most one open mission, and of simultaneous assignment saves putting one vessel on two open missions exactly one succeeds and every other answers 409 `vessel_committed` naming the winning mission.
- **DP-18 — Per-vessel service interval** The principal surveyor edits a vessel's service interval against the vessel version they read, a stale version answers 409 `stale_version` with the current vessel while the typed value stays, and the overdue rule uses the new interval at once.
- **DP-19 — Slipway launch** The launch technician marks each assigned vessel afloat from the launch list on a phone, the principal surveyor launches the mission, and both screens show it as Launched.
- **DP-20 — Mission state machine** Mission status changes only along the edges in Business rules, with their role checks and preconditions, exactly one of simultaneous identical moves succeeds, and every other request is refused with 409.
- **DP-21 — Line state machine** Mainscheme lines, crosslines and infill lines move from Pending to Assigned, Running, Surveyed and Delivered only on the triggers in Business rules, and the mission becomes Surveying and Recovering on its own.
- **DP-22 — Afloat only when the server says so** A launch-list row reads Afloat or Ashore only after the server confirms the mark afloat or recovered, and a refused or dropped request leaves the previous word with the published copy.
- **DP-23 — Fleet board follows the boats** With a vessel's detail open at `/fleet/<vessel id>`, each accepted fix updates that vessel's card, detail and recent-fixes list in place within two seconds, keeping the detail open, focus and the list's scroll position. The detail's track replay scrubs the last ten minutes by keyboard, as qualified in Field operations.
- **DP-24 — Fix ingest, single and batched** Loggers post single fixes or batches of 1 to 100 with their ingest key, and the server stores each new fix once, answers replays without effect, applies batches in time order or refuses them whole, as listed in API.
- **DP-25 — Server-decided link state** Each vessel's link state is decided by the server from the age of its last received fix, every screen shows the server's state within five seconds even when the device clock is wrong, and each observed change is announced once.
- **DP-26 — Closed sheets are inert** At 768x1024 and 375x812 a closed vessel detail or mission detail sheet is absent from the accessibility tree and holds no focusable element while fixes stream in.
- **DP-27 — Link-lost alert on the board** When an afloat vessel on an active mission goes Lost, the principal surveyor's board shows an alert card headed with the link-lost heading and announces it in the fleet announcements region.
- **DP-28 — Alert email and escalation** Each alert emails its staff recipients within 30 seconds, and an alert still Active at the escalation delay sends exactly one escalation email to each principal surveyor and launch technician.
- **DP-29 — Acknowledged is not rectified** Alerts move between Active, Acknowledged, Rectified and Closed as defined in Business rules, and acknowledged or rectified cards stay on the board with their attribution until Closed.
- **DP-30 — Acknowledge an alert by keyboard** Staff acknowledge an alert by keyboard or tap, a repeat returns the same alert unchanged, and focus then moves as stated in Feedback states.
- **DP-31 — Alerts board keeps focus and input across refreshes** Board refreshes and new alerts never move focus, close a dialog, replay a card's entrance or clear typed text, so Enter acknowledges the alert the user was on.
- **DP-32 — Delayed alert email** While email is unreachable, including at boot, alerts still appear and are announced, each shows its email as queued, the mail outage banner shows within 15 seconds, and queued email is sent once mail returns.
- **DP-33 — Geofence breach alert** A fix outside the mission geofence raises a breach card that the board shows within two seconds and announces once per excursion, its clearing is announced once, and the card is fully usable at 375x812. A geofence changed mid-survey re-evaluates every vessel's open breach at once, as qualified in Field operations.
- **DP-34 — One alert per excursion, under retries** Each excursion raises exactly one breach alert and one email per recipient, even when the logger sends identical fixes at the same time, and re-entry followed by a new exit raises a new one.
- **DP-35 — Alert history is attributed and append-only** Every alert carries an append-only history of its real state changes with server times and who made them, simultaneous acknowledgements record exactly one, and no request can edit or delete an alert.
- **DP-36 — Coverage while surveying** As running lines report fixes, the mission console draws the swaths and updates coverage, open holidays, lines remaining and crossline agreement in place.
- **DP-37 — Coverage grid and swath exclusions** The server derives each cell's overlap count and the coverage percentage from accepted fixes exactly by the coverage rule in Business rules, so over-speed and off-heading pairs sweep nothing while staying in the track.
- **DP-38 — Holidays need a three-cell run** Holidays are the connected groups of holiday cells with a straight run of at least three cells, with stable labels and areas, while smaller specks lower coverage but are never labelled, counted, listed, hatched or queued.
- **DP-39 — Counters derived once** Coverage percentage, open-holiday count and lines remaining are decided once on the server and agree across the mission header, mission API, line table, holidays list, coverage CSV and client view after every fix and infill.
- **DP-40 — Crossline agreement by survey order** Crossline agreement compares crossline and mainscheme depths per cell against the survey order's allowed vertical uncertainty, exactly by the rule in Business rules, and is the same in the API, both headers, the report and the email.
- **DP-41 — Console state survives repaints** On the mission console refreshes never move the lens off its ground position, a Mission detail sheet reopened during its close stays open, and an announcement is replaced only by a newer event.
- **DP-42 — Coverage CSV export** Staff, and client reviewers of the mission's own organisation, download a per-line coverage CSV with the published header, quoting, line ends, file name and one-decimal SI numbers.
- **DP-43 — Close a holiday before recovery** The principal surveyor sweeps the holiday lens with the arrow keys, presses Enter on a holiday, sees the dashed infill line and changed counters once the server confirms, and sees the hatch clear when the infill pass fills the gap.
- **DP-44 — Holiday lens** The lens follows the pointer or moves by ground distance per arrow press, shows overlap bands and hatched holidays with their area inside it while specks stay unhatched, and Enter or a click on a holiday queues infill.
- **DP-45 — Queue an infill line once** Queueing infill creates one infill line across the holiday for the nearest eligible vessel, a repeated or simultaneous queue returns the existing line, and a closed holiday, a mission not surveying or no eligible vessel is refused with 409.
- **DP-46 — Infill appears only when the server confirms it** The infill overlay, Queued-to text and changed counters appear only after the server confirms the queue, repeated input while pending sends nothing, and a refused or dropped queue draws nothing and shows the published copy.
- **DP-47 — Announced infill results** Every infill result, replay, refusal, move, reorder and holiday closing is announced with its published copy in the fleet announcements region.
- **DP-48 — Lens motion and reduced-motion list** The lens trails, opens and closes and infill lines draw within the published times, and under reduced motion the lens snaps, lines appear drawn and a Holidays list offers the same queue action, with focus landing on the new line.
- **DP-49 — Infill moves off a lost vessel** When a vessel becomes Lost, its Assigned infill lines move to the nearest eligible vessel and the move is announced, while mainscheme lines and crosslines never move.
- **DP-50 — Reorder a vessel's infill queue** The principal surveyor reorders a vessel's queued infill lines with Alt and the arrow keys, the server stores the order or refuses a stale one with 409 `stale_order`, and focus stays on the moved line.
- **DP-51 — Upload line files at the slipway** On a phone the launch technician uploads a surveyed line's file with its logger checksum from a dialog that fits the screen, sees progress in words and sees Stored only after the server confirms, as qualified in Feedback states. Files over 8,000,000 bytes upload in resumable parts, as qualified in Field operations.
- **DP-52 — Stored as recorded, only after a confirmed write** A line becomes Delivered with its file Stored only after object storage confirms a write of exactly the uploaded bytes whose stored SHA-256 checksum equals the declared one, and any refusal leaves it Awaiting upload.
- **DP-53 — Upload replay and conflict** Re-uploading identical bytes returns the original result, different bytes for a delivered line are refused with 409 `already_delivered`, and of simultaneous uploads to one line exactly one stores.
- **DP-54 — Upload survives an expired session** When an upload finds the session ended, the upload dialog keeps the chosen file and checksum, asks for sign-in in place, and finishes the upload once the same account signs in, as qualified in Feedback states.
- **DP-55 — An abandoned upload leaves nothing behind** An upload or download the client abandons mid-body writes no object or incomplete multipart upload, records nothing and releases every lock and connection, so health stays fast and the next upload of that line succeeds at once.
- **DP-56 — Launch list through a storage outage** With object storage unreachable, including at boot, the launch technician still sees the launch list with the storage outage banner announced once, and its end is announced once when storage returns.
- **DP-57 — Storage outage responses** While storage is unreachable, health still answers 200, the status endpoint reports storage down within 15 seconds, and uploads, line-file downloads and report reads answer the published 503 with its retry header, as qualified in Services.
- **DP-58 — Outage errors reveal nothing** Every error response carries only the published code, message and published extra keys, with no host, port, bucket name, SDK error name, stack frame or framework header.
- **DP-59 — Held upload resumes once** An upload refused because storage is down is held with its file and checksum and sends itself once when storage is reported up, updating its row in place, while a cancelled or replaced held upload never sends.
- **DP-60 — Downloads during a storage outage** While storage is reported down, every line-file and report download control is a disabled button reading Storage unavailable, until storage is reported up again.
- **DP-61 — Recover and complete a mission** Once every line is delivered and every vessel recovered, the launch technician marks the mission complete and both staff screens show Complete.
- **DP-62 — Complete only when the server says so** A launch-list mission section reads Complete only after the server confirms Mark mission complete, a refused or dropped request leaves it reading Recovering with the published copy, and success moves focus to the next open mission.
- **DP-63 — Completion side effects happen once and in order** Marking a mission complete commits Complete and report Pending together, writes the report once, and queues each reviewer's single report-ready email only after the report is Ready, even under repeated or simultaneous requests.
- **DP-64 — Coverage report in canonical bytes** The coverage report is written to object storage in the published canonical bytes, listing only delivered lines and superseded lines whose file is stored, with their stored checksums, and its bytes and SHA-256 never change once Ready.
- **DP-65 — Report time zone and vessel totals** The report gives the completion time in UTC and in the client organisation's own time zone with that moment's offset, and per-vessel totals summed from unrounded line values and rounded once.
- **DP-66 — Report-ready email to each reviewer alone** Each client reviewer of the mission's organisation receives exactly one plain-text report-ready email addressed to them alone, whose body is exactly the six published lines, and no email or report carries data outside that survey.
- **DP-67 — Survey line files by vessel** On a survey the client reviewer filters the line files to one vessel, the choice lives in the address, and an unknown vessel shows every line with the published copy.
- **DP-68 — Client reviews their surveys** The client reviewer follows the report link through sign-in to the survey, reads its coverage, crossline agreement and vessels, and downloads a line file, the coverage CSV and the coverage report.
- **DP-69 — Client organisation isolation** Every survey, line, holiday, coverage, track, CSV, file and report address answers 404 to a client reviewer of another organisation and shows the not-found page, and unknown ids inside request bodies answer 404 too.
- **DP-70 — Client views carry only their own mission's data** A client reviewer's tracks, coverage, holidays, vessel markers and line records come only from fixes on that mission's lines, and no client response names another organisation's mission or its positions.
- **DP-71 — Client responses are projected** Responses to a client reviewer carry no holiday nearest vessel, no vessel link state once the mission is no longer active, and no thruster, service, ingest or acknowledgement field.
- **DP-72 — Download the recorded bytes** A line-file download returns exactly the stored bytes with the stored SHA-256 in a response header, and the survey screen shows that checksum in full.
- **DP-73 — Surveys list in pages** The surveys list shows the reviewer's surveys in the published order 20 at a time, and Load more surveys appends the next ones, moves focus to the first new row and announces the count.
- **DP-74 — Units preference** Switching between metric and imperial changes every displayed length, speed and area at the published precision, while the API, the CSV, the report and stored values stay in SI units.
- **DP-75 — Published breakpoints** At 1280x800 the console shows three panes, at 768x1024 two panes with a slide-over detail, and at 375x812 the chart stacked over the list, with no horizontal overflow.
- **DP-76 — Keyboard-complete dialogs** Every modal dialog and sheet keeps Tab and Shift+Tab inside it, closes on Escape and returns focus to the control that opened it, and every published shortcut works from any control in its region.
- **DP-77 — Touch chart** On touch screens a one-finger drag pans the chart and a tap places the lens, without scrolling the page sideways.
- **DP-78 — No decorative loops** Nothing on any screen animates on its own except the named motions, and pending states use words rather than spinners.
- **DP-79 — Chart-room look** Screens read as a ruled paper chart with near-black ink, a deep sea blue for depth and actions, one signal orange reserved for alerts and holidays, a serif display face, and every number set in mono with its unit.
- **DP-80 — Procedural survey chart** The chart draws the survey area, geofence, mainscheme lines, crosslines, infill lines, depth-tinted swaths, holiday outlines and vessel markers from mission data, never from a picture.
- **DP-81 — Run manifest and health** The app installs, builds and serves from `/app/run.json` and answers the health check on the published port.
- **DP-82 — Schema and seed on every serve** Each serve applies the schema and seed data idempotently, so an empty database comes up with exactly the seed records and an existing one is left as it is.
- **DP-83 — Server boundary** The server enforces the body-size limits, serves only the built app and API, never exposes source or credentials, and no response carries cross-origin access headers.
- **DP-84 — Credentials from configuration** Every service credential and address is read from the environment at start and never written into source or sent to the browser.
- **DP-85 — Slipway actions queue while offline** On the launch list, mark afloat, mark recovered and log service taken while the phone is offline are queued with their idempotency keys, survive a reload, are sent in order when the phone is online again, and a refused action drops the vessel's later queued actions, as qualified in Field operations.
- **DP-86 — Hand a mission to another surveyor** Each mission has an owner who alone may launch, abort, hand over, hold, resume, re-run its lines or change its geofence; a handover to another principal surveyor checks the mission version, exactly one of simultaneous handovers succeeds, and the new owner is emailed and told on their open fleet board, as qualified in Field operations.
- **DP-87 — Re-run a bad line** The owner re-runs a Surveyed or Delivered line as a new Pending line, and once the re-run is Delivered the original is Superseded and coverage, holidays, counters and crossline agreement count only the re-run while the original keeps its file, CSV row and report entry, as qualified in Field operations.
- **DP-88 — Coverage as a keyboard grid** The console's coverage chart can be shown as an ARIA grid of its cells with full row and column counts and indexes, operated entirely by keyboard, whose focused cell drives the lens readout and queues infill on Enter, as qualified in Field operations.
- **DP-89 — Mission history** Staff read every event of a mission newest first with server times, actors and the published summaries, filter the kinds from the address and page back through older events, as qualified in Field operations.
- **DP-90 — Hold the survey for weather** The owner holds a Surveying mission with no running line, which refuses line starts and suppresses link-lost alerts until the survey resumes, when vessels already Lost raise their alerts, as qualified in Field operations.
- **DP-91 — Client flags a delivered line** A client reviewer flags a Delivered line of their own survey with a counted comment, staff reply once from the flags list, and each side receives exactly one email, as qualified in Field operations.
- **DP-92 — Reassign many lines and undo** On the line plan the surveyor selects several lines by keyboard, assigns them to one vessel in a single all-or-nothing save, and can undo that save for ten seconds, as qualified in Field operations.

## Frontend

### Screens and layout (DP-01, DP-05, DP-07, DP-12, DP-13, DP-19, DP-23, DP-26, DP-36, DP-43, DP-48, DP-50, DP-51, DP-56, DP-61, DP-62, DP-67, DP-68, DP-69, DP-70, DP-73, DP-75)

**Addresses and access.** Every screen address below is a real address. Reloading it, or opening it directly while signed in as a role that may see it, shows the same screen in the same state. That includes which vessel's detail is open, the planner settings carried in the address, and the survey's vessel filter.

- Staff (principal surveyor and launch technician) may open `/fleet`, `/fleet/<vessel id>`, `/missions`, `/missions/<mission id>`, `/missions/<mission id>/plan`, `/launch`, `/missions/<mission id>/history` and `/flags`.
  - `/missions/<mission id>/history` shows level-1 `heading "History of <mission>"` and `list "Mission events"`, as described under Mission history in Field operations.
  - `/flags` shows level-1 `heading "Client flags"` and `list "Open flags"`, as described under Client flags in Field operations.
- Only the principal surveyor may open `/missions/new`.
- Client reviewers may open only `/surveys` and `/surveys/<mission id>`, and only for missions of their own organisation.
- Any other address, or an address the role may not open, shows the not-found page (copy in Feedback states). That includes another organisation's survey.

No screen scrolls sideways at any viewport. Every signed-in screen keeps the same top bar: the product name, the `Main` navigation, the `Units` choice and `Sign out`.

**Screens.**

- **Sign-in** (`/sign-in`). One centred card holding the email and password fields, the error summary above them when there is an error, and the sign-in button. A signed-in user who opens it goes to the landing address that the safe-return rule gives for its `next` value.
- **Fleet board** (`/fleet`, or `/fleet/<vessel id>` with that vessel's detail open). The three-pane console.
  - **Fleet rail.**
    - The `Alerts` region sits at the top of the rail.
    - Below it is one card per vessel, in seed order. Each card shows the vessel name, link state, position, speed, battery, the coverage percentage of the vessel's open mission (a dash when it has none) and hours since service, plus `Service overdue` when that applies.
  - **Chart.** In the centre, showing every open mission's survey area.
  - **Detail.** Shows the selected vessel: link state, position, speed, battery, depth, current line, mission, coverage, hours since service against its interval, and whether it is afloat or ashore.
    - For the principal surveyor it holds the service-interval field and its save button. A launch technician sees the interval as text.
    - Below these is the `Recent fixes` list.
    - With no vessel selected the detail reads `Select a vessel`.
- **Missions** (`/missions`). A table of every mission, in the mission order from Business rules, showing name, client, survey date, status and coverage.
- **New mission** (`/missions/new`). The planner form sits on the left. At 1280 px and wider, a chart preview on the right draws the survey area, geofence, mainscheme lines and crosslines from the latest plan preview. At 768 px and 375 px the preview sits below the form.
- **Line plan** (`/missions/<mission id>/plan`). In this order:
  1. the mission name as the heading;
  2. the plan summary: survey order, line count, crossline count, estimated duration, swath width and line spacing;
  3. the line plan table, with one row per line (mainscheme lines first, then crosslines) giving the label, the kind, the length and a vessel picker;
  4. the save-assignments and launch-mission buttons, and a link to the console.

  The table scrolls inside its own area when it is taller than the screen.
- **Mission console** (`/missions/<mission id>`). The same three-pane console, for one mission.
  - **Mission header**, above the chart: the mission name and status, the four groups Coverage, Open holidays, Lines remaining and Crossline agreement, the coverage CSV link, and the launch and abort buttons when the role and status allow them.
  - **Fleet rail**: the `Alerts` region and the cards of the vessels on this mission.
  - **Chart**: carries the holiday lens and the lens readout.
  - **Detail pane**: holds the `Lines` table (Line, Kind, Vessel, Status, File), the plan summary, and one infill queue list for each vessel that has queued infill lines.
  - **`Holidays` list**: shown whenever reduced motion is on, at any width, between the chart and the detail pane. At 375 px it always shows, directly below the chart.
- **Launch list** (`/launch`).
  - The heading is `Launch list`. Below it is one section per open mission (Planned, Launched, Surveying or Recovering), ordered by survey date and then by name.
  - Each section is headed by the mission name and shows the client and status word. It then has one row per assigned vessel, showing `Ashore` or `Afloat`, the link state, the hours since service and the row's buttons.
  - Each section then lists every Surveyed or Delivered line with its file state and, while the file is Awaiting upload, an upload button. While the mission is Recovering, the section also shows the mark-complete button.
  - Below the missions, the `Fleet service` region lists every vessel with its total thruster hours, hours since service against its interval, `Service overdue` when that applies, and a log-service button.
  - The launch list is a single column at every width. At 1280 px and 768 px it is capped at a comfortable reading width and centred.
- **Surveys** (`/surveys`).
  - The heading is `Your surveys`.
  - The visible count line from Feedback states sits above a table of the reviewer's own organisation's missions, showing name, survey date, status and coverage.
  - Rows follow the mission order, 20 at a time, with a load-more button while more remain.
- **Survey** (`/surveys/<mission id>`). In this order:
  1. the mission header with the four groups and the coverage CSV link;
  2. the chart, without the lens or infill actions;
  3. the vessels on the mission, each with its link state, or `Off survey` when the server sends none;
  4. the vessel filter;
  5. the line files table, with one row per Surveyed, Delivered or Superseded line: label, vessel, status (a Superseded row reads `Superseded`), file state, size in bytes, the full SHA-256 and, for each line whose file is Stored, a download control;
  6. the coverage report control, once the report is Ready.

  The chart's tracks, swaths and holidays come only from this mission. Each vessel's marker sits at the last point of that vessel's track on this mission. At 1280 px the chart sits on the left with the lists on the right. At 768 px and 375 px the chart is stacked over the lists.

**Layouts at the three published viewports** (fleet board and mission console).

- **1280x800 and wider.** Three panes side by side, all visible at once: the fleet rail on the left, about 280 px wide; the chart in the centre at full height; and the detail pane on the right, about 360 px wide.
- **768x1024.** Two panes: the fleet rail on the left and the chart filling the rest. The detail takes no column. It opens as a sheet that slides over the chart from the right:
  - on the fleet board, when a vessel is selected or `/fleet/<vessel id>` is opened;
  - on the console, when `Mission detail` is pressed.
- **375x812.** One column: top bar, mission header (on the console), chart, then the list beneath.
  - The chart's height is fixed at about 45% of the viewport and is never below 300 px.
  - On the fleet board, the list holds the `Alerts` region and then the vessel cards, and the vessel detail opens as a full-screen `<vessel> detail` sheet.
  - On the console, the list holds, in order: the `Holidays` list, the `Lines` table, the infill queue lists, the plan summary, the `Alerts` region and the vessel cards. There is no `Mission detail` button or sheet at 375 px.

A closed sheet is gone entirely: it is not shown, it is not in the accessibility tree, and nothing inside it can take focus. Each published viewport gets its own layout, and no breakpoint between them changes which layout a published viewport gets.

### Public screens and controls (DP-01, DP-06, DP-07, DP-10, DP-12, DP-13, DP-16, DP-18, DP-19, DP-22, DP-23, DP-27, DP-29, DP-30, DP-33, DP-36, DP-40, DP-43, DP-44, DP-46, DP-47, DP-48, DP-50, DP-51, DP-54, DP-59, DP-60, DP-62, DP-67, DP-68, DP-72, DP-73, DP-74)

Only these roles, names and copy are public.

Placeholders:
- `<vessel>` is a vessel name.
- `<line>` is a line label such as `L03`, `X01` or `I01`.
- `<holiday>` is a holiday label such as `H2`.
- `<mission>` is a mission name.

Pickers published as `combobox` may be a native select or an ARIA combobox with a `listbox`, and both must work by keyboard. The exception is the line-plan vessel pickers, which must be an ARIA combobox that opens a `listbox` of `option` items. Numbers in on-screen text may use thousands grouping (a comma, a no-break space or a narrow no-break space), except where an exact literal is published.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| All signed-in screens | `navigation "Main"` | links `Fleet`, `Missions`, `New mission` (principal surveyor); `Fleet`, `Missions`, `Launch list` (launch technician); `Surveys` (client reviewer) |
| All signed-in screens | `radiogroup "Units"` with `radio "Metric"` and `radio "Imperial"` | the user's current preference is checked |
| All signed-in screens | `button "Sign out"` | Sign out |
| All signed-in screens | `status "Service status"` (polite) | empty, or the outage and recovery copy from Feedback states |
| All signed-in screens | `status "Session status"` (polite) | the idle-warning announcements from Feedback states |
| All signed-in screens | `dialog "Session ending"` (modal) with `button "Stay signed in"`, present only while open | `You will be signed out in <m:ss> to protect this console.` |
| Fleet board, mission console | `status "Fleet announcements"` (polite) | alert, link-state, infill, holiday, interval and mission-action announcements |
| Sign-in | `heading "Sign in to Swathdeck"`, `textbox "Email"`, password field labelled `Password`, `button "Sign in"` | — |
| Sign-in | `status "Sign-in status"` (polite); the error summary is an `alert` that can take focus | copy in Feedback states |
| Fleet board, console | `region "Fleet"` holding `list "Vessels"`, with one `listitem` per vessel; each card has `button "<vessel>"`, which opens its detail | name, link state word, `E <easting> N <northing>`, speed, battery %, coverage %, hours since service, `Service overdue` when it applies |
| Fleet board, console | `region "Alerts"`, headed by level-2 `heading "Alerts"`, focusable from script but not a Tab stop, with one `article` per alert that is not Closed; each article is headed by a level-3 `heading` | heading; a state line, focusable from script, reading `Active`, `Acknowledged` or `Rectified`; for Acknowledged, `Acknowledged by <name> at <HH:MM:SS> UTC`; for Rectified, `Rectified at <HH:MM:SS> UTC`; time raised; position; `Email queued` or `Emailed` |
| Fleet board, console | `button "Acknowledge <alert heading>"` inside each Active or Rectified alert article, and none inside an Acknowledged one | Acknowledge |
| Fleet board, console, survey | `region "Survey chart"` holding `application "Coverage chart"` (focusable), `button "Zoom in"`, `button "Zoom out"` and `button "Fit survey area"` | the procedural chart |
| Console | `img "Holiday lens"` inside the chart, and `group "Lens readout"` | `E <easting> N <northing>` under the lens centre, then one line per holiday inside the lens as `<holiday> · <area>`, or the empty-holiday copy |
| Console | `img "Infill <line>"` overlay per open infill line | a dashed line across its holiday |
| Fleet board, 1280 px | `region "Detail"` | the selected vessel's fields, or `Select a vessel` |
| Fleet board, 768 and 375 px | `dialog "<vessel> detail"` with `button "Close"`, present only while open | the same fields |
| Fleet board detail | `list "Recent fixes"`, one `listitem` per fix, each able to take focus | `<HH:MM:SS> UTC · E <easting> N <northing> · <speed>` |
| Fleet board detail (principal surveyor) | `spinbutton "Service interval"` with `button "Save interval"` | unit `h`; after a stale save, `Current: <interval> h` beside the field |
| Console | `region "Mission header"` with `heading "<mission>"`, the status word, `group "Coverage"`, `group "Open holidays"`, `group "Lines remaining"` and `group "Crossline agreement"` | `<coverage>%`, `<open holidays>`, `<lines remaining>`, and `<pct>% of <compared>` or `—` |
| Console, survey | `link "Download coverage CSV"` | Download coverage CSV |
| Console | `button "Launch mission"` and `button "Abort mission"` (principal surveyor); `dialog "Abort mission"` with `button "Abort mission"` and `button "Keep surveying"` | — |
| Console, 768 px only (absent at 1280 and 375 px) | `button "Mission detail"`, opening `dialog "Mission detail"` with `button "Close"`, present only while open | lines table, infill queues and plan summary |
| Console | `table "Lines"` with columns Line, Kind, Vessel, Status, File; each row can take focus from script | Kind is `Planned`, `Crossline` or `Infill`; File is `Awaiting upload`, `Stored` or empty |
| Console | `list "Infill queue for <vessel>"`, one `listitem` per queued infill line, each able to take focus | `<position>. <line> · <holiday>` |
| Console | `list "Holidays"`, one `listitem` per Open or Queued holiday, each holding `button "Queue infill <holiday>"` | `<holiday> · <area> · nearest <vessel>` (or `· no eligible vessel`), plus `Queued to <vessel>` when queued; the button reads `Queue infill`, or `Queueing…` while pending |
| New mission | `form "New mission"` with `textbox "Mission name"`, `combobox "Client"`, `textbox "Survey date"`, multi-line `textbox "Survey area vertices"`, multi-line `textbox "Geofence corners"`, `spinbutton "Planned depth"`, `spinbutton "Swath ratio"`, `spinbutton "Overlap"`, `spinbutton "Line azimuth"`, `spinbutton "Planned speed"`, `combobox "Survey order"` (options `Special Order` and `Order 1a`) and `button "Create mission"` | each field's unit sits next to it: `m` or `ft`, `× depth`, `%`, `°`, `m/s` or `kn` |
| New mission | `button "Vertex format help"` after each multi-line field (the first for the survey area, the second for the geofence), each opening the non-modal `dialog "Vertex format"` | `One vertex per line as easting, northing in <unit>, for example 5000, 8000. Enter starts a new line; Ctrl+Enter creates the mission.`, where `<unit>` is `metres` or `feet` |
| New mission | `status "Plan preview"` (polite) and `status "Form status"` (polite) | copy in Feedback states |
| New mission | `alert` error summary headed `Fix these before creating the mission`, with one `link` per field error, named by the field message | — |
| Line plan | `group "Plan summary"`; `table "Line plan"` with `combobox "Vessel for <line>"` per row, each opening a `listbox` of `option` items; `button "Save assignments"`; `button "Launch mission"`; `link "Open console"`; `status "Plan status"` (polite) | options are `Unassigned` followed by the vessel names in seed order |
| Launch list | level-1 `heading "Launch list"`, focusable from script; one `region "<mission>"` per open mission, headed by level-2 `heading "<mission>"`, focusable from script, holding `button "Mark <vessel> afloat"`, `button "Mark <vessel> recovered"`, `button "Upload file for <line>"` and `button "Mark mission complete"` | each vessel row reads `Ashore` or `Afloat`; each line row reads `Awaiting upload`, `Uploading <n>%`, `Waiting for storage` or `Stored`; the section shows its status word |
| Launch list | `region "Fleet service"` with `button "Log service for <vessel>"` per vessel | — |
| Launch list | `status "Launch status"` (polite) | copy in Feedback states |
| Launch list | `dialog "Upload line file"` with a file field labelled `Line file`, `textbox "SHA-256"`, `button "Upload"` and `button "Cancel"`; after a dropped request, `button "Retry upload"`; while held, `button "Hide"`; after a session ends, `textbox "Email"`, a password field labelled `Password` and `button "Sign in and upload"` | the line label as the dialog's subtitle; the waiting, retry and session copy from Feedback states |
| Launch list | `dialog "Log thruster service"` with `textbox "Service note"`, `button "Save service"` and `button "Cancel"` | the vessel name and its current hours since service |
| Surveys | `heading "Your surveys"`; `status "Survey list"` (polite); `table "Surveys"` with `link "<mission>"` per row; `button "Load more surveys"` while more remain | the count line from Feedback states, visible above the table |
| Survey | `region "Mission header"` with the same four groups; `list "Vessels"`, giving each vessel's link state or `Off survey`; `combobox "Vessel"` with `All vessels` and then the mission's vessels by name; `table "Line files"` with `link "Download <line>"` per line whose file is Stored; `link "Download coverage report"` | the full lowercase SHA-256 per line as `SHA-256 <sha256>`, and the size in bytes; the unknown-vessel copy from Feedback states beside the picker |
| Survey, while storage is reported down | each download control becomes a disabled `button "Download <line>"` or `button "Download coverage report"` | the visible text `Storage unavailable` |
| Not-found page | `heading "Page not found"` | copy in Feedback states |

### Interactions (DP-03, DP-06, DP-07, DP-09, DP-12, DP-13, DP-23, DP-30, DP-31, DP-41, DP-44, DP-48, DP-50, DP-51, DP-59, DP-62, DP-67, DP-73, DP-76, DP-77)

**Landing.**
- After sign-in, the address bar shows the `home` address that the sign-in response returned.
- If the user opened a screen address while signed out, they go to `/sign-in?next=<that address>`. The sign-in form sends `next` with the credentials and then goes to the returned `home`. It never navigates to `next` directly.
- Every navigation to a screen address other than `/sign-in` and the not-found page records it as the user's last screen through the API.
- Creating a mission lands on `/missions/<mission id>/plan`.
- Selecting a vessel card changes the address to `/fleet/<vessel id>`, and closing the detail returns it to `/fleet`.
- The link in a report-ready email opens `/surveys/<mission id>`, going through sign-in when needed.

**Keyboard everywhere.**
- Every action works from the keyboard. Tab order follows the visual order: top bar, rail, chart, detail.
- On the planner, each multi-line field takes one vertex per line, typed as `easting, northing` in the user's length unit (for example `5000, 8000`). Enter inside these fields starts a new line, and Ctrl+Enter submits the form.

**Planner settings in the address.**
- The six plan settings are mirrored in the `/missions/new` address as `depth`, `ratio`, `overlap`, `azimuth`, `speed` and `order` (`special` or `1a`), each holding the field's value exactly as typed.
- The mirror is updated when a change is committed: on leaving the field, or 600 milliseconds after the last key. It replaces the current address without adding a Back step.
- Opening or reloading such an address fills those fields and shows that preview.
- An invalid value in the address fills the field as written, shows that field's message under it at once, and puts the invalid copy in the preview.

**Vertex format help.**
- `Vertex format help` opens its popover beside the button. Enter, Space or a click opens it.
- At every published viewport the popover lies wholly inside the viewport, above every other layer.
- It is not modal, so focus is not trapped. Escape or a click outside closes it, and focus returns to its button.

**Vessel pickers.**
- On the line plan, a `combobox "Vessel for <line>"` opens with a tap, a click, Alt+Down or Space. Up and Down move through the options, Enter chooses one, and Escape closes the list without choosing.
- The open list sits above every other layer and is never cut off by the table's scroll area or the page edge.
- At every published viewport it lies wholly inside the viewport, opening upwards when there is no room below, for example on the last row.
- Every option can be tapped where it is drawn.

**Dialogs and sheets.** This covers the upload, service, abort and session-ending dialogs and the detail sheets at 768 px and 375 px.
- On opening, focus moves to the first field or button. For `Session ending`, it moves to `Stay signed in`.
- Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last, so focus never leaves an open modal dialog.
- Escape, `Cancel`, `Close` and `Keep surveying` close the dialog, and focus returns to the control that opened it. The upload dialog's held state and `Session ending` each have their own Escape behaviour, described in Feedback states.
- Pressing `Mission detail` again while its sheet is still sliding closed leaves the sheet open. The unfinished close never hides it afterwards.

**Service interval.**
- The principal surveyor types a new value in `Service interval` and presses `Save interval` or Enter.
- The save sends the vessel version the detail showed when they first typed into the field since the last save or refusal.
- After a refusal, the next save sends the version that came back with the refusal.

**Recent fixes.**
- Tab reaches the list at its first row. Up and Down move focus between rows.
- New fixes are added at the top. When the list is scrolled away from its top, adding rows never changes what is in view.
- A focused row keeps focus across refreshes. If its fix drops off the end of the 20, focus moves to the new last row.

**Holiday lens, pointer.** While the pointer is over the chart, the lens opens and trails the pointer. Clicking a hatched holiday inside the lens queues infill for it.

**Holiday lens, keyboard.**
- When `application "Coverage chart"` takes focus, the lens opens where it last was, or at the chart's centre the first time.
- Each arrow press moves the lens 10 m of ground distance, and Shift with an arrow moves it 50 m. The chart scrolls itself to keep the lens in view.
- Enter queues infill for the holiday under the lens centre. Failing that, it queues the holiday with the most cells inside the lens. Failing that, it announces the no-holiday copy. Specks are never targets.
- These keys work while focus is anywhere inside the chart region, including on the zoom buttons. The lens closes when focus leaves the chart.
- The lens is tied to a ground position. Refreshes, new fixes, redraws and the chart's own scrolling never change the ground position shown in `Lens readout`. Only pointer, tap and arrow input moves it.
- The readout may update one frame after a tap.
- On the survey screen there is no lens, and the arrow keys pan the chart.

**Queue from the Holidays list.**
- On success, focus moves to the new infill line's row in `table "Lines"`, scrolled into view. That is the 375 px stacked lines table, or the detail pane at 1280 px.
- At 768 px, where the lines table sits in the closed sheet, focus stays on the pressed button.

**Infill queue order.**
- With focus on a row of `Infill queue for <vessel>`, Alt+ArrowUp moves that line one place earlier and Alt+ArrowDown one place later.
- The row moves only once the server has stored the order, and focus stays on the moved row.

**Touch.**
- A one-finger drag pans the chart under the finger, and a two-finger pinch zooms it. Neither scrolls the page sideways.
- A tap on the chart places the lens centre at the tap point without trailing.
- At 375 px, infill is queued from the `Holidays` list buttons.
- Every button, option and list row is at least 44 px tall.

**Surveys list and survey filter.**
- `Load more surveys` adds the next 20 rows below the existing ones and moves focus to the link in the first new row. The button is removed once every survey is shown.
- Choosing a vessel in `combobox "Vessel"` shows only that vessel's rows in `Line files` and sets `?vessel=<vessel id>` in the address without adding a Back step. Choosing `All vessels` removes `vessel` from the address.
- Opening a survey address with `?vessel=` applies that filter.

**Live screens.**
- Vessel cards, the open detail, recent fixes, the header groups, the chart, the lines table, the holidays list, the infill queues, the alerts and the launch list update in place as the server reports changes, within the limits in Business rules.
- A card or row that changes stays the same element in the same place.
- They keep focus, scroll position and typed input as stated in Feedback states.

**Error summaries.**
- When mission creation fails validation, focus moves to the error summary, and each summary link moves focus to its field. Each field also shows its own message beneath it.
- When sign-in fails, focus moves to the sign-in error summary.

### Visual design (DP-79, DP-80)

**Colour.**
- The ground is a warm paper white, faintly ruled like a nautical chart.
- Text and line work are a near-black ink.
- A deep sea blue is used for depth tints, primary buttons and links.
- A warm grey draws the hairline rules between rows and the chart grid.
- One signal orange appears only on alerts (a left rule and an icon on each alert card) and on holidays (outline and hatch). It is never used on buttons, decoration or headings.
- Text and essential graphics meet WCAG 2.2 AA on the paper ground: body text at least 4.5 to 1, and large text, focus rings and chart line work at least 3 to 1.

**Type.**
- Headings and mission names are set in Newsreader, a bookish serif.
- Body text and controls are set in IBM Plex Sans.
- Every number (positions, speeds, depths, areas, percentages, hours, checksums) is set in IBM Plex Mono with its unit beside it.
- Each heading level is a quarter larger than the level below it, starting from body size.
- All three faces ship with the app.

**Density and composition.** The layout is compact. Rows are tight and separated by hairline rules, not boxes or shadows. The chart is the centre of every console screen, with no wasted space around it.

**Chart.** The chart is drawn in code from mission data.
- A faint grid is ruled every 50 m, with mono easting and northing labels along its edges.
- The survey area is outlined in ink, and the geofence is a dashed ink line.
- Mainscheme lines are thin blue rules. Crosslines are thin blue rules with small perpendicular ticks. Infill lines are dashed.
- Swaths are filled with a blue tint, lighter where the fix depth was shallow and darker where it was deep.
- Outside the lens, holidays show as thin orange outlines and specks get no mark.
- Vessels are small ink chevrons pointing along their heading, each with a mono name label.

**Inside the lens.**
- The swath tint gives way to three labelled overlap bands, `1×`, `2×` and `3×+`, in increasingly dense grey-blue.
- Every holiday cell is covered with orange diagonal strokes, so that at least a third of the cell's pixels are orange. Each holiday carries a mono area label.
- Speck cells show no orange at all.

**Focus.** Every focusable control shows a clear blue focus ring at least 2 px thick, and the chart region shows the same ring when it has focus.

### Motion and effects (DP-41, DP-44, DP-48, DP-78)

All motion starts quickly and settles gently. Nothing lasts longer than about a third of a second.

- **Lens follow.** The lens is a circle about 168 px across. With normal motion its centre trails the pointer by about an eighth of a second. It is never instant, and it is back on the pointer within a quarter of a second after the pointer stops.
- **Lens open and close.** On opening, the lens grows from about 60% of its size to full size in a little under a fifth of a second. On closing, it shrinks back the same way.
- **Infill line.** A newly confirmed infill line draws itself as a dashed line from its start to its end over about a third of a second. The draw starts only after the server confirms the queue.
- **Vessel markers.** When a fix arrives, a vessel marker glides to its new position over about a third of a second.
- **Sheets and alert cards.**
  - Detail sheets slide in from the right in under a fifth of a second, and slide back out on close.
  - A new alert card slides into the top of the alerts list in under a fifth of a second.
  - Cards already on the board never replay that motion. A card that changes state just changes its words.
- **Counters.** A changed counter value swaps in place, with a brief tint behind it that fades in under a fifth of a second.
- **Nothing else moves.** Nothing animates on its own: no pulsing markers, no breathing glows and no animated backgrounds. Pending states use words, not spinners, and there are no scroll-driven effects.
- **Reduced motion.** When the user asks for reduced motion:
  - the lens sits exactly on the pointer, tap or keyboard position, with no trailing and no growing or shrinking;
  - infill lines appear fully drawn;
  - markers jump to their new positions;
  - sheets and alert cards appear in place;
  - the `Holidays` list appears next to the chart with each holiday's area, its nearest eligible vessel and the same queue button, so every lens action stays available.

### Feedback states (DP-06, DP-09, DP-10, DP-12, DP-14, DP-16, DP-18, DP-22, DP-25, DP-27, DP-29, DP-30, DP-31, DP-32, DP-33, DP-46, DP-47, DP-49, DP-50, DP-51, DP-54, DP-56, DP-59, DP-60, DP-62, DP-67, DP-73)

Every asynchronous action shows a pending state and then a result. Each announcement is written into the named live region, character for character. That means straight apostrophes, an em dash with a space on each side, the ellipsis as one character, and the same case and digits.

The browser renders every status exactly as the server reports it and never recomputes one from its own clock. This covers link, alert, email, line, file, holiday, report, overdue and outage states. Screens refresh from the server within the delays in Business rules, and they check `GET /api/status` at least every five seconds.

| Action or event | Region | Pending | Success | Errors and outage |
|---|---|---|---|---|
| Sign in | `Sign-in status`; errors in the `alert` summary | `Signing in` | goes to the returned `home` | `Email or password is incorrect.`; the 429 message from API |
| Plan preview | `Plan preview` | `Updating plan` | `<line count> lines · <crossline count> cross · <minutes> min` | `Fix the highlighted fields to see the plan` |
| Create mission | `Form status`; summary in `alert` | `Creating mission` | goes to the line plan | summary heading `Fix these before creating the mission`, with one link per field message from API |
| Save assignments | `Plan status` | `Saving assignments` | `Assignments saved` | `<vessel> is already on <mission>`; `Only pending or assigned lines can be reassigned`; `This mission no longer takes assignments`; the not-afloat copy; the overdue block message |
| Launch mission | `Plan status` on the line plan, `Fleet announcements` on the console | `Launching mission` | `Mission launched` | `Assign every line and crossline before launching`; the not-afloat copy; the overdue block message; the illegal-move copy |
| Abort mission | `Fleet announcements` | `Aborting mission` | `Mission aborted` | the illegal-move copy |
| Mark afloat | `Launch status` | `Marking <vessel> afloat` | `<vessel> is afloat` | the overdue block message; with no response, `Could not reach Swathdeck — <vessel> is still ashore` |
| Mark recovered | `Launch status` | `Marking <vessel> recovered` | `<vessel> is recovered` | `<vessel> is still running <line>`; with no response, `Could not reach Swathdeck — <vessel> is still afloat` |
| Log service | `Launch status`; refusals under the note field | `Logging service` | `Service logged for <vessel>` | the service-note field message from API; the afloat-service copy; with no response, `Could not reach Swathdeck — service for <vessel> is not logged yet` |
| Save service interval | `Fleet announcements` | `Saving interval` | `Service interval saved for <vessel>` | the interval field message from API, under the field; the stale-version copy |
| Upload line file | `Launch status`; field messages under their fields | `Uploading <line>` | `<line> stored` | checksum or file-name field messages from API; `<line> already holds a different file`; `<line> file is over 50,000,000 bytes`; storage outage, `Storage is unreachable — <line> is still awaiting upload`; with no response, `Could not reach Swathdeck — <line> is not uploaded yet`; session ended: see below |
| Mark mission complete | `Launch status` | `Completing mission` | `<mission> complete — <n> missions open` | `Upload every line file before completing`; `Recover every vessel before completing: <vessels>`; the illegal-move copy; with no response, `Could not reach Swathdeck — <mission> is still recovering` |
| Acknowledge alert | `Fleet announcements` | `Acknowledging` | `Alert acknowledged` | — |
| Breach alert raised | `Fleet announcements`, plus the card heading | — | `Geofence breach — <vessel>` | — |
| Breach condition clears | `Fleet announcements` | — | `<vessel> back inside the geofence` | — |
| Link-lost alert raised | `Fleet announcements`, plus the card heading | — | `Link lost — <vessel>` | — |
| Service-overdue alert raised | `Fleet announcements`, plus the card heading | — | `Service overdue — <vessel>` | — |
| Link-lost or service-overdue condition clears | `Fleet announcements` | — | `<alert heading> — rectified` | — |
| Link state changes | `Fleet announcements` | — | `<vessel> link live`, `<vessel> link stale` or `<vessel> link lost` | — |
| Queue infill (lens, click or list) | `Fleet announcements` | `Queueing infill for <holiday>` | `Infill <line> queued to <vessel>`; on replay, `Infill <line> is already queued to <vessel>` | `No eligible vessel for <holiday>`; `<holiday> has already closed`; `Infill can be queued only while the mission is surveying`; `No holiday under the lens`; with no response, `Could not reach Swathdeck — <holiday> is not queued yet` |
| Infill moved off a lost vessel | `Fleet announcements` | — | `Infill <line> moved to <vessel>` | — |
| Reorder infill queue | `Fleet announcements` | — | `<line> moved to position <n> of <total>` | `The infill queue for <vessel> has changed — showing the latest order`; with no response, `Could not reach Swathdeck — the infill order is unchanged` |
| Holiday closes | `Fleet announcements` | — | `<holiday> closed` | — |
| Load more surveys | `Survey list` | — | `Showing <shown> of <total> surveys` | — |

**One announcement per event.**
- Each raised alert, cleared condition, link-state change, infill result and holiday closing is written to `Fleet announcements` once.
- Refreshes, repeated fixes and repaints never write it again.
- A link-state announcement is made only for a change the screen observes after its first load.
- An announcement stays until a newer event writes its own. Repaints never rewrite or clear it.

**Latest plan preview.**
- The `Plan preview` region shows only the result for the form's current values. A response to earlier input is discarded, even when it arrives after the response to the latest input.
- If the current input is invalid, the region shows the invalid copy, even when a slower response to an earlier valid input arrives afterwards.
- While the latest result is pending, the region reads `Updating plan`, and the chart preview keeps the last plan it received for valid input.

**Honest launch rows and sections.**
- A vessel row reads `Afloat` only after `POST /api/vessels/<vessel id>/afloat` answers 200. It reads `Ashore` again only after the recovered request answers 200.
- A mission section reads `Complete` only after the complete transition answers 200. It keeps reading `Complete` for at least two seconds and leaves the list on the first refresh after that.
- On that 200, focus moves to the heading of the next open mission's section below, or to the first section's heading when none follows. With no open mission left, focus moves to `heading "Launch list"`. `<n>` in the success copy is the number of open missions after the completion.
- While a mark or complete request is pending, the row or section keeps its previous word, the pressed button reads `Marking…` or `Completing…` and is disabled, and `Launch status` shows the pending copy.
- On a 409, the previous word stays, the button gets its label back and keeps focus, and the error copy shows.
- With no response while `navigator.onLine` is true, the previous word stays and the no-response copy shows, and pressing the button again resends. Actions taken while `navigator.onLine` is false are queued instead, as described under Offline slipway queue in Field operations.

**Honest infill.**
- The `Infill <line>` overlay, the `Queued to <vessel>` text, the lens hatch change and the header counter change appear only after the infill request answers 201 or 200.
- While the request is pending:
  - the holiday keeps its hatch and its list text;
  - its button reads `Queueing…` and is disabled;
  - further Enter presses or clicks for that holiday send nothing.
- On a 409, nothing is drawn, the refusal copy shows, and the button gets its label back and keeps focus.
- With no response, nothing is drawn and the no-response copy shows.

**Alert cards and focus.**
- The fleet board and the mission console refresh from the server at least every two seconds.
- A refresh, a new alert or a new fix never moves keyboard focus, replays a card's slide-in, closes or reopens a dialog or sheet, clears text being typed (for example in `Service note` or `Service interval`), moves the lens, or changes the scroll position of a list.
- When a new alert arrives while focus is on another alert's acknowledge button, focus stays on that same button, so Enter acknowledges the alert the user was on.
- After an acknowledgement, focus moves, in this order of preference:
  1. to the acknowledge button of the next alert below that still has one;
  2. failing that, to the previous one;
  3. failing that, to the acknowledged card's state line, if the card is still on the board (it then reads `Acknowledged`);
  4. failing that, to `region "Alerts"`.
- At 375x812 each alert card shows its heading, state line, attribution, position and acknowledge button entirely within the viewport width. The acknowledge button is at least 44 px tall.

**Service dialog on a flaky connection.**
- Each opening of `Log thruster service` makes one idempotency key, and every `Save service` press in that opening sends it.
- If the response is lost while `navigator.onLine` is true, the dialog stays open with the note and shows the no-response copy, and pressing `Save service` again resends with the same key. A save pressed while `navigator.onLine` is false is queued instead, as described under Offline slipway queue in Field operations.
- The dialog closes only on a 201.

**Stale service interval.** On `409 stale_version`, the detail keeps the typed value and shows `Current: <interval> h` beside the field, taken from the vessel returned with the refusal. `Fleet announcements` shows the stale-version copy.

**Upload progress.**
- While a file is being sent, its line row reads `Uploading <n>%`. `<n>` is the whole percentage of the body sent so far, and it never shows above 99 before the server answers.
- The row reads `Stored` only after the server's 2xx.
- With no response, the row returns to `Awaiting upload`, and the dialog stays open with the chosen file and SHA-256 and offers `Retry upload`, which sends them again.
- At 375x812 the upload dialog fits the viewport width and scrolls inside itself when taller than the screen. Its `Upload` button is at least 44 px tall and reachable by Tab within the dialog.

**Session ended during upload.**
- When an upload answers 401, `Upload line file` stays open, keeps the chosen file and typed SHA-256, and shows `Your session ended — sign in again to finish uploading <line>` with `Email`, `Password` and `Sign in and upload`.
- After a successful sign-in as the same account, the upload is sent again once with no further action, and `<line> stored` follows.
- Wrong credentials or the 429 from API show their message inside the dialog, which stays open.
- Signing in as a different account sends nothing, closes the dialog and goes to that account's `home`.

**Upload held through a storage outage.**
- When an upload answers the storage 503, `Launch status` shows the storage-outage upload copy, and the line row reads `Waiting for storage`.
- The dialog stays open with the file and SHA-256 kept, and shows `Waiting for storage — <line> will upload when it returns` with `Hide` and `Cancel`.
- `Hide`, or Escape while the dialog is waiting, closes the dialog and keeps the upload held. Focus returns to the row's upload button. Pressing that button while the line is held reopens the dialog in its waiting state.
- `Cancel` ends the held upload for good. Its watcher never sends, never reopens the dialog and never writes `Launch status`, and the row returns to `Awaiting upload`.
- Only one upload is held at a time. Holding a second line's upload cancels the earlier held one in the same way.
- A dialog opened for any line that is not held starts with an empty file field and an empty SHA-256 field.
- Within 15 seconds of `GET /api/status` next reporting `storage` as `up`, the held upload sends itself once. The row changes in place, as the same element, without moving focus or scroll: first to `Uploading <n>%`, then to `Stored`, and the line's status becomes `Delivered`. `<line> stored` follows.

**Storage and mail banners.**
- **Storage outage banner.** In `Service status` on every signed-in screen: `Line-file storage is unreachable — uploads are paused and will resume on their own.` It is written once when storage is reported down.
- **Storage return.** When storage is reported up again, the outage text is replaced once by `Line-file storage is back`, which stays for 10 seconds or until the next status change, whichever comes first, and then clears.
- **Mail outage banner.** In `Service status` on staff screens: `Alert email is delayed — alerts still show on this board.` It clears when mail is reported up.
- **No repeats.** Polling never rewrites an unchanged banner.

**Downloads while storage is down.**
- While `GET /api/status` reports `storage` as `down`, every download control for a line file or the coverage report is a disabled button, as listed in Public screens and controls, with the visible text `Storage unavailable`.
- It becomes a link again within five seconds of storage being reported up.

**Idle sign-out.**
- After 28 minutes with no pointer, key or touch input on a signed-in screen, `Session ending` opens with focus on `Stay signed in`.
- Its text counts down once per second from `2:00` to `0:00`, keeping exact time through re-renders and live updates.
- `Session status` reads `You will be signed out in 2:00 to protect this console.` on opening, the same sentence with `1:00` at one minute, and with `0:10` at ten seconds. It is never announced at any other second.
- `Stay signed in`, or Escape, calls the session refresh, closes the dialog, returns focus to the element that had it, and restarts the 28 minutes. Other input does not close the dialog.
- At `0:00` the browser signs out (as for `Sign out`) and goes to `/sign-in?next=<the current screen address>`. The sign-in error summary reads `You were signed out after 30 minutes without activity.`

**Sign-in errors.** Every sign-in error shows its message in the summary, moves focus there, keeps the typed email and clears the password field.

**Shared copy.**
- **Overdue block message.** Shown in the refused action's region and returned as the API `message`: `<vessel> is overdue for thruster service (<hours> h since service, limit <interval> h). Log a service before assigning or launching.` `<hours>` is hours since service with one decimal. `<interval>` is the service interval without trailing zeros (for example `250` or `120.5`), the same format as `Current: <interval> h`.
- **Afloat-service copy.** `Recover <vessel> before logging a service`.
- **Stale-version copy.** `<vessel> was changed by someone else. Review the latest values and save again.`
- **Not-afloat copy.** `Not afloat yet: <vessels>`. `<vessels>` is vessel names in alphabetical order, separated by a comma and a space. The recover-every-vessel copy uses the same format.
- **Illegal-move copy.** `This mission cannot move from <from> to <to>`, with mission status words.
- **Empty-holiday state.** In the `Holidays` list and the lens readout when the mission has no Open or Queued holiday: `No holidays — coverage is continuous`.
- **Alert card email state.** `Email queued` until the mail server accepts every message, then `Emailed`.
- **Survey report state.** `Coverage report is being prepared` while the report is Pending. The download control replaces it once the report is Ready.
- **Survey count line.** `Showing <shown> of <total> surveys`, always visible above the table. `<shown>` is the number of rows on screen, and `<total>` is the number of the reviewer's surveys.
- **Unknown vessel filter.** When `?vessel=` names no vessel on this survey, every line shows and `No such vessel on this survey` appears beside the picker, which reads `All vessels`.
- **Not-found page.** Heading `Page not found`, text `That page does not exist or is not shared with you.`

## Backend

### API (DP-02, DP-04, DP-08, DP-10, DP-11, DP-16, DP-18, DP-24, DP-35, DP-42, DP-45, DP-50, DP-52, DP-53, DP-57, DP-58, DP-69, DP-72)

**Conventions.**
- All endpoints live under `/api`.
- Request and response bodies are `application/json` (UTF-8), except line-file upload and download, the report read and the coverage CSV.
- A JSON body may be up to 64,000 bytes; 64,000 itself is allowed. A JSON endpoint called with any other content type answers `415 unsupported_media_type`.
- Units: lengths in metres, speeds in metres per second, areas in square metres, hours in hours.
- Times are ISO 8601 UTC ending in `Z`. Any such string, with or without fractional seconds, is correct unless a field is published as whole seconds, and two times are equal when they name the same instant.
- Positions are `{"easting":<number>,"northing":<number>}` in metres on the site grid.

**Error shape.** Every error body is `{"error":"<code>","message":"<sentence>"}` and nothing else, apart from these published extra keys:
- **`validation`** (status 422) adds `"errors":{"<field>":"<message>"}`.
- **`illegal_transition`** adds `"from"` and `"to"`, both status words.
  - For mission moves, `from` is the current status and `to` the requested status, with the illegal-move copy.
  - For line moves, `from` is the refused line's current status, and `to` is the status the request would set: `Assigned` for an assignment setting a vessel, `Pending` for one setting `null`, `Running` for ingest start, `Surveyed` for ingest end. When several entries of one assignment save are refused, the error names the first refused entry in request order.
  - A refused assignment's message is `Only pending or assigned lines can be reassigned`. A refused ingest start or end's message is `Line <line> cannot move from <from> to <to>`.
- **`stale_version`** adds `"current":<vessel>`.
- **`stale_fix`** adds `"index"`.
- **`too_many_attempts`** adds `"retry_at"`.

**Fixed bodies.**
- Storage unreachable: exactly `503 {"error":"storage_unavailable","message":"Storage is unavailable. Try again in a moment."}`, always with header `Retry-After: 30` and never with a partial body.
- Any unexpected server failure: exactly `500 {"error":"internal","message":"Something went wrong on the server."}`.

Other 409 `message` values are the copy from Feedback states, and `service_overdue` carries the overdue block message. Every other message is one short plain sentence. Unknown `/api` paths, and methods an `/api` path does not list, answer `404 not_found`.

**Error precedence.** One order applies to every endpoint:
1. `413 payload_too_large` for an oversize body, and 415 for a wrong content type.
2. `401 unauthenticated` for a missing, revoked or expired session, or `401 invalid_ingest_key` for a missing or invalid ingest key.
3. `404 not_found` for an unknown id, or an id belonging to another client organisation, another vessel or another mission. This applies to path ids and ids inside bodies. A resource the caller may not see is never confirmed to exist.
4. `403 forbidden` for a role that is not allowed.
5. An idempotent replay returns its stored response here, before any state check.
6. State conflicts answer 409, in the order each endpoint lists them.
7. Validation answers 422.
8. An unreachable dependency answers the storage 503.

Three exceptions:
- `GET /api/lines/<line id>/file` and `GET /api/missions/<mission id>/report` check storage right after step 4, and answer the 503 before any 409.
- For fix bodies, validation comes before `409 out_of_order` and `409 stale_fix`.
- For `PATCH /api/vessels/<vessel id>`, a missing or non-integer `version` is a 422 checked before the version comparison.

**Session, user and status.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/session` | `{"email","password","next"?}` | `200 {"user":<user>,"home":<landing address>}`, plus an HTTP-only, same-site session cookie lasting 12 hours; `home` is decided by the landing rule in Business rules | `401 invalid_credentials`; `429 too_many_attempts`, checked before the password, with `"retry_at"` and header `Retry-After` |
| `POST /api/session/refresh` | `{}` | `204`; the session's 12 hours start again | — |
| `DELETE /api/session` | — | `204`; the session is revoked | — |
| `GET /api/me` | — | `200 <user>`, where `<user>` is `{"id","name","email","role":"principal_surveyor"\|"launch_technician"\|"client_reviewer","client_org_id":<id or null>,"units":"metric"\|"imperial"}` | — |
| `PATCH /api/me` | `{"units":"metric"\|"imperial"}` | `200 <user>` | `422` units: `Choose metric or imperial` |
| `PUT /api/me/last-screen` | `{"path"}` | `204` | `422` path: `Send a screen address this role may open` when the path fails the safe-return rule |
| `GET /api/status` | — | `200 {"storage":"up"\|"down","mail":"up"\|"down"}`, no other keys; any signed-in role | — |
| `GET /api/health` | — | `200 {"status":"ok"}`, without a session, even when storage or mail is down | — |
| `GET /api/client-orgs` | — | `200 [{"id","name","time_zone"}]`, where `time_zone` is an IANA zone name | — |

**Sign-in limit body.**
- The body is `{"error":"too_many_attempts","message":"Too many sign-in attempts. Try again after <HH:MM> UTC.","retry_at":"<time>"}`.
- `retry_at` is the unlock time as ISO 8601 UTC with whole seconds, ending in `Z`, for example `2026-11-02T14:37:05Z`. `<HH:MM>` is `retry_at` in 24-hour UTC.
- `Retry-After` is the whole number of seconds until `retry_at`, rounded up, and at least 1.
- A body missing `email` or `password`, or with either empty, answers `401 invalid_credentials` and is not counted.

**Vessels and service.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/vessels` | — | `200 [<vessel>]` in seed order | — |
| `GET /api/vessels/<vessel id>` | — | `200 <vessel>` | — |
| `GET /api/vessels/<vessel id>/fixes` | optional query `window_s=600` | `200 [{"t","received_at","position","heading_deg","speed_mps","battery_pct","depth_m"}]`, greatest `t` first: without `window_s`, the vessel's 20 stored fixes with the greatest `t`; with `window_s=600`, every stored fix whose `t` is at most 600 seconds before the vessel's greatest stored `t`, with no count limit | `422` window_s: `Send window_s as 600` for any other value |
| `PATCH /api/vessels/<vessel id>` | `{"service_interval_h","version"}` | `200 <vessel>` | `409 stale_version`; `422` service_interval_h: `Service interval must be between 50 and 1000 h` (50 to 1000 inclusive, at most one decimal place); `422` version: `Send the vessel version you last read` |
| `POST /api/vessels/<vessel id>/afloat` | `{}` | `200 <vessel>`; a vessel already afloat returns 200 unchanged | `409 service_overdue` |
| `POST /api/vessels/<vessel id>/recovered` | `{}` | `200 <vessel>`; a vessel already ashore returns 200 unchanged | `409 line_running` |
| `POST /api/vessels/<vessel id>/services` | `{"note"}`, with optional header `Idempotency-Key` | `201 {"id","vessel_id","logged_at","logged_by","hours_at_service","note"}` | `409 idempotency_conflict`, then `409 vessel_afloat`; `422` note: `Enter a service note of up to 500 characters` (1 to 500 characters) |
| `GET /api/vessels/<vessel id>/services` | — | `200 [<service entry>]`, newest first | — |

`<vessel>` is `{"id","name","version","link_state":"Live"|"Stale"|"Lost","last_fix_received_at":<time or null>,"last_fix":{"t","position","heading_deg","speed_mps","battery_pct","depth_m"}|null,"afloat":<bool>,"mission_id":<open mission id or null>,"running_line_id":<id or null>,"thruster_hours_total","hours_since_service","service_interval_h","service_overdue":<bool>}`. Hours are rounded to 0.001.

**Ingest.** Ingest endpoints take no session. The logger sends its key in header `X-Ingest-Key`.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/ingest/fixes` (single) | `<fix>` = `{"t","easting","northing","heading_deg","speed_mps","battery_pct","depth_m"}` | `201 {"vessel_id","received_at","link_state":"Live","duplicate":false}`; a fix whose `t` equals a stored fix's `t` is a replay, `200 {...,"duplicate":true}`, with no effect | `422` per the fix fields below; `409 out_of_order` (`This fix is older than the vessel's latest fix`) when `t` is earlier than the latest stored `t` |
| `POST /api/ingest/fixes` (batch) | `{"fixes":[<fix>, ...]}`, 1 to 100 fixes in any order | `201 {"vessel_id","accepted","replayed","link_state","last_t"}` when `accepted` is at least 1; `200` with the same shape when it is 0 | `422` keyed `fixes` (`Send 1 to 100 fixes`) or `fixes.<index>.<field>`; `409 stale_fix` (`A fix in this batch is older than the vessel's latest fix`) |
| `POST /api/ingest/lines/<line id>/start` | `{}` | `200 {"line":<line>}` | `404` for a line not assigned to this key's vessel; then `409 mission_not_active`, `409 mission_on_hold`, `409 service_overdue`, `409 vessel_busy`, `409 illegal_transition`, in that order |
| `POST /api/ingest/lines/<line id>/end` | `{}` | `200 {"line":<line>}` | `404` as above; `409 illegal_transition` |

**Fix field messages.** These apply to the single body, and to each fix of a batch under `fixes.<index>.<field>`, where `<index>` is the zero-based position in the request.

| Field | Rule | Message |
|---|---|---|
| `t` | ISO 8601 UTC time ending in `Z` | `Send t as an ISO 8601 UTC time` |
| `t` (batch only) | no other fix in the batch has the same `t`; the later index is reported | `Each fix in a batch needs its own time` |
| `easting`, `northing` | a number | `Send easting in metres` / `Send northing in metres` |
| `heading_deg` | at least 0 and below 360 | `Heading must be at least 0 and below 360` |
| `speed_mps` | 0 to 20 inclusive | `Speed must be between 0 and 20 m/s` |
| `battery_pct` | 0 to 100 inclusive | `Battery must be between 0 and 100 %` |
| `depth_m` | above 0 and at most 500 | `Depth must be above 0 and at most 500 m` |

**Batch rules.**
- A batch is validated as a whole. Any invalid fix rejects the whole batch with 422, and nothing is stored.
- A fix whose `t` equals a stored fix of the vessel is a replay: it has no effect and counts in `replayed`.
- If any other fix is earlier than the vessel's latest stored `t` from before the batch, the whole batch answers `409 stale_fix`, with `index` set to the first such fix in request order, and nothing is stored.
- Otherwise the new fixes are applied in ascending `t`, as if they had arrived one after another, and count in `accepted`.
- `last_t` is the latest stored `t` after the batch, and `link_state` is the vessel's link state after it.

**Missions, lines and coverage.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/missions` | — | `200 [{"id","name","client_org_id","client_name","survey_date","status","counters"}]` in the mission order; client reviewers see only their organisation's missions | — |
| `POST /api/plan-preview` | the plan settings, `survey_order` and `survey_area`, as in mission creation | `200 {"swath_width_m","line_spacing_m","line_count","crossline_count","estimated_duration_s"}` | `422` as for mission creation |
| `POST /api/missions` | `{"name","client_org_id","survey_date","survey_area":[<position>],"geofence":[<position>],"planned_depth_m","swath_ratio","overlap_pct","line_azimuth_deg","planned_speed_mps","survey_order":"special"\|"1a"}`, with optional header `Idempotency-Key` | `201 <mission>`, with its mainscheme lines and crosslines created Pending | `404` for an unknown `client_org_id`; `409 idempotency_conflict`; `422` per the field table |
| `GET /api/missions/<mission id>` | — | `200 <mission>` | — |
| `GET /api/missions/<mission id>/lines` | — | `200 [<line>]`: mainscheme lines, then crosslines, then infill lines, each group by label number | — |
| `POST /api/missions/<mission id>/assignments` | `{"assignments":[{"line_id","vessel_id":<id or null>}]}`, 1 to 500 entries, applied all or nothing | `200 [<line>]` | `404` for a line not in this mission or an unknown vessel; then `409 mission_not_assignable`, `409 illegal_transition`, `409 vessel_committed`, `409 service_overdue`, `409 vessels_not_afloat`, in that order |
| `POST /api/missions/<mission id>/transitions` | `{"to":"Launched"\|"Aborted"\|"Complete"\|"Surveying"\|"Recovering"\|"Planned"}` | `200 <mission>` | `409 illegal_transition` and the preconditions in Business rules; `422` when `to` is not a status word |
| `GET /api/missions/<mission id>/coverage` | — | `200 {"cell_size_m":5,"origin":<position>,"cols","rows","overlap":[[<int>]],"counters"}` | — |
| `GET /api/missions/<mission id>/coverage.csv` | — | `200`, described below | — |
| `GET /api/missions/<mission id>/tracks` | — | `200 {"tracks":[{"line_id","label","vessel_id","points":[{"t","easting","northing","depth_m","swath_m"}]}]}`, points in `t` order | — |
| `GET /api/missions/<mission id>/holidays` | — | `200 [<holiday>]` by label number, Closed included | — |
| `POST /api/missions/<mission id>/holidays/<holiday id>/infill` | `{}` | `201 {"line":<line>,"holiday":<holiday>,"counters"}`; while the holiday is Queued, `200` with the same shape naming the existing line | `409 holiday_closed`, `409 mission_not_surveying`, `409 no_eligible_vessel`, in that order |
| `GET /api/missions/<mission id>/vessels/<vessel id>/infill-order` | — | `200 {"line_ids":[...]}` in run order | `404` when the vessel has no lines on this mission |
| `PUT /api/missions/<mission id>/vessels/<vessel id>/infill-order` | `{"line_ids":[...]}` | `200 {"line_ids":[...]}`, the stored order | `404` as above, or for an id that is not an infill line of this mission; `409 stale_order` when the ids are not exactly the vessel's current queue; `422` line_ids: `Send each infill line id once` |
| `GET /api/missions/<mission id>/report` | — | `200` with the stored report bytes as `application/json`, and header `X-Content-SHA256: <lowercase hex of those bytes>` | storage 503; `409 report_not_ready` |

**Coverage CSV.**
- **Headers.** `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="<slug>-coverage.csv"`.
- **File name.** `<slug>` is the mission name with accents removed (compatibility decomposition, keeping only ASCII), lower-cased, with each run of characters other than `a`–`z` and `0`–`9` replaced by one `-`, and leading and trailing `-` trimmed. If nothing is left, `<slug>` is the mission id.
- **Format.**
  - Every row, the last included, ends with CR LF.
  - A field containing a comma, a double quote, CR or LF is wrapped in double quotes, with inner quotes doubled. No other field is quoted.
- **Header row.** `mission,line,kind,vessel,status,length_m,covered_m,coverage_pct`.
- **Rows.** One row per line, in lines-endpoint order:
  - `mission` is the mission name exactly;
  - `line` is the label;
  - `kind` and `status` are the API values;
  - `vessel` is the vessel name, or empty;
  - `length_m`, `covered_m` and the line's coverage percentage are SI numbers, rounded half up to exactly one decimal place with `.` as the decimal mark, whatever the user's units.

**Alerts.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/alerts?status=open\|all` | `open` (the default) returns every alert not Closed; `all` returns every alert | `200 [<alert>]`, newest first | — |
| `POST /api/alerts/<alert id>/ack` | `{}` | `200 <alert>`; acknowledging an Acknowledged or Closed alert returns 200 unchanged | — |

Every other method on `/api/alerts` or `/api/alerts/<alert id>`, and anything other than `POST` on `/api/alerts/<alert id>/ack`, answers `404 not_found`.

**Line files.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `PUT /api/lines/<line id>/file` | the raw file body, up to 50,000,000 bytes (50,000,000 itself is allowed), with `Content-Type: application/octet-stream` and headers `X-Line-File-Name` and `X-Content-SHA256` | `201 <line>`, Delivered with file Stored; the same bytes again to a Delivered line return `200` with the same body | `409 line_not_surveyed`, `409 already_delivered`; `422` per the field table; storage 503 |
| `GET /api/lines/<line id>/file` | — | `200` with the stored bytes, `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="<file name>"` and `X-Content-SHA256: <lowercase hex>` | storage 503; `409 file_not_stored` |

**Record shapes.**
- **`<mission>`** is `{"id","name","client_org_id","client_name","survey_date","status","survey_order":"special"|"1a","survey_area","geofence","planned_depth_m","swath_ratio","overlap_pct","line_azimuth_deg","planned_speed_mps","swath_width_m","line_spacing_m","line_count","crossline_count","estimated_duration_s","counters":{"coverage_pct","open_holidays","lines_remaining"},"crossline_agreement":{"compared","within","pct","meets_order"},"vessels":[{"id","name","link_state"}],"report":{"state":"None"|"Pending"|"Ready"},"owner_id","owner_name","version","hold":null|{"reason","since","by"},"created_at","launched_at","completed_at"}`.
  - `line_count` counts mainscheme lines only.
  - Each `vessels` entry carries exactly `id`, `name` and `link_state`.
- **`<line>`** is `{"id","mission_id","label","kind":"planned"|"crossline"|"infill","status":"Pending"|"Assigned"|"Running"|"Surveyed"|"Delivered"|"Superseded","rerun_of":<line id or null>,"vessel_id","vessel_name","start":<position>,"end":<position>,"length_m","covered_m","holiday_id":<id or null>,"file":null|{"state":"Awaiting upload"|"Stored","name","size_bytes","sha256","stored_at"}}`.
  - `length_m` and `covered_m` are unrounded.
  - `file` is null until the line is Surveyed. It then reads Awaiting upload, with null details, until Stored.
- **`<holiday>`** is `{"id","label","status":"Open"|"Queued"|"Closed","area_m2","cell_count","centroid":<position>,"cells":[[<col>,<row>]],"nearest_vessel":{"id","name"}|null,"infill_line_id":<id or null>}`.
- **`<alert>`** is exactly `{"id","kind":"geofence_breach"|"link_lost"|"service_overdue","state":"Active"|"Acknowledged"|"Rectified"|"Closed","heading","vessel_id","vessel_name","mission_id","raised_at","rectified_at","position","acknowledged_at","acknowledged_by","email":"Queued"|"Emailed","escalation":"None"|"Queued"|"Emailed","history":[{"state","at","by"}]}`.
  - `heading` is the card heading from Feedback states.
  - `history` is described in Business rules.
- **Coverage grid.** `overlap` rows run from south (row 0) to north, and columns from west (col 0) to east, so `overlap[r][c]` is cell (c, r). Cells outside the survey area hold -1.

**Field messages for 422 (planner, preview and upload).**

| Field | Rule | Message |
|---|---|---|
| `name` | 1 to 80 characters | `Enter a mission name of up to 80 characters` |
| `survey_date` | a real date written YYYY-MM-DD | `Enter the survey date as YYYY-MM-DD` |
| `survey_area` | 3 to 40 vertices | `Enter 3 to 40 survey-area vertices as easting, northing` |
| `survey_area` | convex, with non-zero area and no repeated vertex | `The survey area must be a convex shape` |
| `survey_area` | area at most 4,000,000 m² (the limit itself is allowed) | `The survey area must be at most 4,000,000 m²` |
| `geofence` | 3 to 40 corners | `Enter 3 to 40 geofence corners as easting, northing` |
| `geofence` | convex | `The geofence must be a convex shape` |
| `geofence` | every survey-area vertex inside it or on its edge | `The geofence must enclose the survey area` |
| `planned_depth_m` | 1 to 200 inclusive | `Planned depth must be between 1 and 200 m` |
| `swath_ratio` | 1 to 8 inclusive | `Swath ratio must be between 1 and 8` |
| `overlap_pct` | 0 to 50 inclusive | `Overlap must be between 0 and 50 %` |
| `line_azimuth_deg` | at least 0 and below 180 | `Line azimuth must be at least 0° and below 180°` |
| `planned_speed_mps` | 0.5 to 4 inclusive | `Planned speed must be between 0.5 and 4 m/s` |
| `survey_order` | `special` or `1a` when present | `Choose Special Order or Order 1a` |
| `file` (upload body) | at least 1 byte | `The file is empty` |
| `file_name` (`X-Line-File-Name`) | 1 to 120 letters, digits, dots, underscores or hyphens, not starting with a dot | `Use a file name of 1 to 120 letters, digits, dots, underscores or hyphens` |
| `sha256` (`X-Content-SHA256`) | 64 hexadecimal characters, in either case | `Enter the 64-character SHA-256 from the logger` |
| `sha256` | equal to the SHA-256 of the received body | `Checksum does not match this file. Nothing was stored.` |

**Idempotency keys** (mission creation and service logging).
- `Idempotency-Key` is 1 to 100 characters and is kept for 24 hours, per user and per endpoint.
- The same key with the same body returns the original status and body and creates nothing. For a service this includes the original `hours_at_service`, even after the hours have grown.
- The same key with a different body (for a service, a different note) answers `409 idempotency_conflict`.
- When several requests with one key arrive at the same time, exactly one record is created and every request gets its response.

### Business rules (DP-01, DP-02, DP-03, DP-04, DP-05, DP-08, DP-09, DP-14, DP-15, DP-17, DP-18, DP-20, DP-21, DP-25, DP-28, DP-29, DP-33, DP-34, DP-35, DP-37, DP-38, DP-39, DP-40, DP-45, DP-49, DP-50, DP-65, DP-70, DP-71, DP-74)

**Permissions.** These sit on top of organisation scope: a client reviewer reaches only missions of their own organisation, and anything else answers 404.

| Action | Principal surveyor | Launch technician | Client reviewer |
|---|---|---|---|
| Read missions, lines, coverage, coverage CSV, tracks, holidays, report, line files | yes | yes | own organisation only |
| Read vessels, recent fixes, alerts, service log, client organisations, infill order | yes | yes | 403 |
| Create mission, preview plan, assign lines, launch (owner only), abort (owner only), queue infill, reorder infill, change a service interval | yes | 403 | 403 |
| Mark afloat or recovered, mark complete | 403 | yes | 403 |
| Upload line file, log service, acknowledge alert | yes | yes | 403 |
| Read status, change own units, record own last screen, refresh session | yes | yes | yes |
| Change a geofence, hand over, re-run a line, hold, resume | owner only | 403 | 403 |
| Read mission history | yes | yes | 403 |
| Start or continue a resumable upload | yes | yes | 403 |
| Flag a line | 403 | 403 | own organisation only |
| Read flags, reply to a flag | yes | yes | 403 |

An action marked owner only answers `403 not_mission_owner` to a principal surveyor who is not the mission's owner, with the message published under Mission handover in Field operations.

**Sessions and shared devices.**
- **Server side.**
  - Each session is a revocable record in Postgres. `DELETE /api/session` revokes it, after which that cookie answers `401 unauthenticated` on every request, from any tab.
  - Every response is built only from its own request's session. Concurrent requests from different sessions never answer with another session's user, organisation, units or data.
- **Browser side.** On sign-out, whether from `Sign out`, the idle countdown or a different account signing in inside the upload dialog, the browser drops:
  - every record it holds for the previous user (missions, surveys, vessels, alerts, coverage and the units preference);
  - every live-region text;
  - every open or held dialog. A held upload never sends afterwards.
- **No leaks to the next account.**
  - A response that resolves after sign-out is discarded.
  - The next account's screens never paint a record, name or count of the previous account: not on first paint, not from a late response, and not on Back or Forward. A previous user's address shows the sign-in page while signed out, or the not-found page when the new role may not open it.

**Sign-in attempt limit.**
- **Counting.** Failed sign-ins are counted per email address, compared after trimming spaces and lower-casing. A failure is a wrong password or an email with no account.
- **Window.** The attempt window is `SIGN_IN_WINDOW_SECONDS` seconds (default 900, that is 15 minutes).
- **Lock.**
  - Five failures for one address within one window lock it for one window, from the fifth failure.
  - While locked, every sign-in for that address answers the 429 from API, even with the correct password. Attempts during a lock are not counted and do not extend it.
  - When the lock ends, the count starts again from zero.
  - A successful sign-in resets that address's count to zero.
- **Unknown addresses.** An address with no account fails, counts and locks exactly like a real one: the same `401 invalid_credentials` body before the lock, the same 429 after it, and the same password check. Neither the response nor its timing reveals whether the account exists.
- **Storage and races.** Counts live in Postgres and are applied one attempt at a time. For example, of ten simultaneous wrong attempts on a fresh address, exactly five answer 401 and five answer 429.

**Safe-return and landing.**
- **Role homes.** `/fleet` for a principal surveyor, `/launch` for a launch technician, `/surveys` for a client reviewer.
- **Safe path.** A path is safe for a role only when every one of these holds:
  - it starts with exactly one `/`, and its second character is neither `/` nor `\`;
  - after percent-decoding it once, it still starts with exactly one `/` not followed by `/` or `\`, and it contains no control character;
  - its path part, ignoring any query, is a screen address from Screens and layout other than `/sign-in`, that this role may open. For a client reviewer, a survey address must name a mission of their own organisation.
- **Landing address.**
  - When `next` is present and safe, the landing address is `next` as given.
  - When `next` is present and unsafe, it is the role's home.
  - When `next` is absent, it is the user's last screen if that is still safe and its record still qualifies, and otherwise the role's home. A mission address qualifies while the mission is open. A vessel address qualifies while the vessel exists. A survey address qualifies while it is the reviewer's own organisation's mission.
- **Examples.** `//evil.test/x`, `/\evil.test`, `https://evil.test/fleet`, `javascript:alert(1)`, `/%2F%2Fevil.test`, `/api/me` and an address the role may not open all land on the role's home.
- **Signed-in users.** The same rule applies when a signed-in user opens `/sign-in?next=<value>`.
- **No last screen yet.** A user with no stored last screen lands on the role's home.

**Mission order.** Wherever missions are listed (`GET /api/missions`, the Missions table, the Surveys table):
1. newest survey date first;
2. then the name compared after lower-casing;
3. then the id.

The surveys screen shows the first 20, and each `Load more surveys` adds the next 20.

**Line plan.** The plan is derived once, on the server. The same derivation answers the preview and is stored on the mission at creation, with the survey order.
- **Swath and spacing.** Swath width `W` = planned depth × swath ratio. Line spacing `S` = `W` × (1 − overlap ÷ 100).
- **Defaults** for omitted settings: overlap 20, swath ratio 4, azimuth 0, planned speed 2.0 m/s, survey order `1a`.
- **Directions.** For azimuth `a` (degrees clockwise from grid north), the along-line direction is (sin a, cos a) and the across-line direction is (cos a, −sin a), as (easting, northing).
- **Mainscheme lines.**
  - Project the survey-area vertices onto the across-line direction. `D` is the spread of those projections, and offsets are measured from the smallest.
  - If `D` ≤ `W`, there is one line at offset `D` ÷ 2. Otherwise there are `n` = 1 + ceiling((`D` − `W`) ÷ `S`) lines. Line `i` (from 0) sits at offset `W` ÷ 2 + `i` × `S`, except the last line, which sits at `D` − `W` ÷ 2.
  - Each line is the chord of the survey area at its offset. It starts at the end with the smaller along-line projection.
  - Lines are labelled `L01`, `L02` and onward, in offset order.
- **Crosslines.**
  - `L` is the sum of the mainscheme chord lengths.
  - Project the survey-area vertices onto the along-line direction. `E` is the spread of those projections, measured from the smallest.
  - `k` is the smallest whole number of at least 1 such that the `k` chords along the across-line direction, at along-line offsets `E` × (j + 1) ÷ (k + 1) for j = 0 to k − 1, together measure at least 0.05 × `L`.
  - Each crossline is the chord at its offset. It starts at the end with the smaller across-line projection.
  - Crosslines are labelled `X01`, `X02` and onward, in offset order, and have kind `crossline`.
- **Estimated duration** in seconds = (sum of mainscheme and crossline chord lengths ÷ planned speed) + 60 × (`n` + `k` − 1), rounded half up to a whole second. The planner shows it in whole minutes, rounded half up.
- **Example.** With the seed data at start, Calderhaven North Basin has:
  - `W` 40 m and `S` 32 m;
  - 13 lines of 300 m;
  - one crossline `X01`, from (5000, 8150) to (5400, 8150);
  - an estimated duration of 2,930 seconds (49 min).

**Mission status.**
- **Planned → Launched.** Principal surveyor only. Refusals, in this order:
  1. `409 lines_unassigned` (`Assign every line and crossline before launching`) when any mainscheme line or crossline is not Assigned;
  2. `409 service_overdue` when any assigned vessel is overdue, naming the alphabetically first;
  3. `409 vessels_not_afloat` when any assigned vessel is ashore.
- **Launched → Surveying.** Automatic, when the first line starts.
- **Surveying → Recovering.** Automatic, as soon as every line of every kind is Surveyed, Delivered or Superseded.
- **Recovering → Complete.** Launch technician only. Refusals, in this order:
  1. `409 lines_awaiting_upload` when any line is neither Delivered nor Superseded;
  2. `409 vessels_afloat` when any vessel on the mission is still afloat.
  Crossline agreement never blocks completion.
- **Launched, Surveying or Recovering → Aborted.** Principal surveyor only.
- **Final states.** Complete and Aborted are final.
- **Everything else** answers `409 illegal_transition`, including any request for Surveying, Recovering or Planned.
- **Simultaneous requests.** Of several simultaneous requests for the same move, exactly one succeeds and the rest get `409 illegal_transition`.
- **Open and active.** A mission is open while it is Planned, Launched, Surveying or Recovering. It is active while it is Launched, Surveying or Recovering.

**Line status** (the same for mainscheme lines, crosslines and infill lines).
- **Assignment.**
  - Assignment applies to Pending or Assigned lines while the mission is Planned, Launched or Surveying.
  - Setting a vessel makes a line Assigned, or reassigns it. Setting `null` returns it to Pending.
  - Refusals:
    - `409 illegal_transition` for a Running, Surveyed or Delivered line;
    - `409 mission_not_assignable` for a mission in any other status;
    - `409 vessel_committed` for a vessel holding lines on another open mission;
    - `409 service_overdue` for an overdue vessel;
    - in a Launched or Surveying mission, `409 vessels_not_afloat` for a vessel that is ashore.
- **Assigned → Running.** On the logger's start. Refused with `409 mission_not_active` unless the mission is Launched or Surveying, then with `409 mission_on_hold` while the mission is held, then with `409 service_overdue`, then with `409 vessel_busy` when the vessel already has a Running line.
- **Running → Surveyed.** On the logger's end. This is accepted even if the vessel became overdue during the line.
- **Surveyed → Delivered.** Only on a confirmed upload (Services).
- **Surveyed or Delivered → Superseded.** Only when the line's re-run becomes Delivered (Line re-run in Field operations). A Superseded line takes no further trigger, and an upload to it answers `409 line_not_surveyed`.
- **Every other trigger** answers `409 illegal_transition`.
- **Aborted missions.** Aborting leaves lines as they are, and Surveyed lines can still take uploads.

**One open mission per vessel, under races.**
- Assignment saves, launches, completions and aborts involving the same vessel take effect one at a time, so the outcome always equals some serial order of the requests.
- When saves putting one vessel on two different open missions arrive at the same time, exactly one answers 200. Every other answers `409 vessel_committed`, with message `<vessel> is already on <mission>` naming the winning mission. Afterwards the vessel holds lines on exactly one open mission.

**Fleet readiness.**
- **Service interval.** Each vessel has its own interval, changed by the principal surveyor through `PATCH /api/vessels/<vessel id>`.
- **Version.** `version` starts at 1 and goes up by exactly one on each of these: becoming afloat, becoming ashore, a logged service, a changed interval. Nothing else changes it. A repeated afloat or recovered call that changes nothing leaves it as it is.
- **Stale version.** A PATCH whose `version` is not the current one answers `409 stale_version`.
- **Overdue.**
  - A vessel is overdue when its hours since service are strictly greater than its own interval. Exactly the interval is allowed.
  - A changed interval applies at once, in both directions.
  - The server enforces the overdue block on assignment, launch, mark-afloat and line start.
  - An overdue vessel is never eligible for infill.
- **Logging a service.**
  - Only while the vessel is ashore. While it is afloat, the request answers `409 vessel_afloat` with the afloat-service copy.
  - A logged service records the current hours since service as `hours_at_service` and resets hours since service to 0 at once. Total thruster hours keep counting.
- **Thruster hours.** They grow between two consecutive accepted fixes A and B of one vessel, in `t` order, only when all of these hold:
  - the vessel had a Running line when B was received;
  - B's speed is above 0.3 m/s;
  - B's `t` is later than A's by more than 0 and at most 60 seconds.

  The difference between the two `t` values is then added to the total and to hours since service. Over-speed and off-heading pairs count too.
- **Mark recovered** is refused with `409 line_running` while the vessel has a Running line.

**Fix ingest under retries.**
- Fixes and batches from one vessel are applied one request at a time, in arrival order, under the replay, out-of-order and batch rules in API. No fix is ever applied twice.
- When identical fixes (same vessel, same `t`) arrive at the same time, exactly one answers 201 and is stored, and every other answers the 200 duplicate. The fix counts once toward thruster hours, coverage, link state and alerts.
- A vessel's position, speed, battery and depth are those of its stored fix with the greatest `t`.

**Link state.**
- The server decides link state from the time since it last received an accepted fix from the vessel, by its own clock:
  - **Live:** under 10 seconds;
  - **Stale:** 10 to 60 seconds;
  - **Lost:** over 60 seconds, or when no fix has ever been received.
- A fix's own `t` never affects link state.

**Alerts.**
- **Breach.**
  - An accepted fix that places an afloat vessel on an active mission strictly outside that mission's geofence starts an excursion and raises one `geofence_breach` alert. A point on the fence counts as inside.
  - Further fixes outside raise nothing.
  - A fix back inside ends the excursion, and the next fix outside raises a new alert.
- **Link lost.** A vessel raises one `link_lost` alert each time it becomes Lost while afloat on an active mission, provided it has sent a fix since that mission launched. A new accepted fix ends that lost spell.
- **Service overdue.** A vessel that becomes overdue while afloat on an open mission raises one `service_overdue` alert for that mission. This can happen through hour growth or a lowered interval. It raises no other until it has stopped being overdue and then becomes overdue again.
- **States.** Every alert is raised Active.
  - Acknowledging moves Active to Acknowledged and Rectified to Closed.
  - When the condition clears, Active moves to Rectified and Acknowledged moves to Closed.
  - Acknowledging an Acknowledged or Closed alert changes nothing.
- **What clears each condition.**
  - **Breach:** a fix inside the fence or on it.
  - **Link lost:** a new accepted fix from that vessel.
  - **Service overdue:** the vessel no longer being overdue.
  - **Mission end:** aborting or completing a mission clears its breach and link-lost alerts, with no clearing announcement beyond the mission action's own.
- **History.**
  - `history` holds one entry per real state change, in time order, starting with `Active`. `state` is the state entered, `at` is the server's commit time, and `by` is the acknowledging user's name, or `Swathdeck` for raising, clearing and mission end.
  - An entry is appended only when the state actually changes. A repeated or concurrent acknowledge adds nothing.
  - Of simultaneous acknowledges of one alert by any users, exactly one is recorded, and every request answers 200 with the same alert.
  - `acknowledged_by` and `acknowledged_at` equal the entry made by acknowledgement (`Acknowledged`, or `Closed` when acknowledging a Rectified alert).
  - `rectified_at` equals the `at` of the entry made when the condition cleared.
  - No request edits or deletes an alert or its history.
  - Cards show these times as `HH:MM:SS` in UTC.
- **Escalation.** Only an alert still Active when the escalation delay has passed escalates.

**Coverage.**
- **Grid.** Each mission's coverage is a grid of 5 m cells with corners at multiples of 5 m on the site grid.
  - `origin` is the south-west corner of cell (0, 0). Its easting is the largest multiple of 5 not above the area's smallest easting, and its northing is the same for northing.
  - The east and north edges are the smallest multiples of 5 not below the area's largest easting and largest northing.
  - Cell (c, r) spans easting origin + 5c to origin + 5c + 5 and northing origin + 5r to origin + 5r + 5. Its centre is at origin + 5c + 2.5 east and origin + 5r + 2.5 north.
  - A cell belongs to the area when its centre is inside the area or on its edge.
- **Line direction.** The direction of a mainscheme or infill line is the azimuth. The direction of a crossline is the azimuth + 90°.
- **Swaths.** Consecutive accepted fixes A and B of one vessel, in `t` order, sweep a swath only when all of these hold:
  - both were received while the same line was Running on that vessel;
  - B's `t` is later than A's by more than 0 and at most 60 seconds;
  - B's `speed_mps` is not above 1.5 × the mission's planned speed;
  - B's heading deviates from its line's direction by 20° or less. With δ = ((heading − direction) mod 180 + 180) mod 180, the deviation is min(δ, 180 − δ), so reciprocal headings are equal and exactly 20° still sweeps.
- **Swath shape.** A swath is the rectangle along A→B with half-width B's `depth_m` × swath ratio ÷ 2. A cell is in it when its centre's projection falls on the segment and the centre lies within the half-width. The first fix of a run sweeps nothing.
- **Covered length.** A line's `covered_m` is the total length of its sweeping segments, and its coverage percentage is the smaller of 100 and `covered_m` ÷ `length_m` × 100.
- **Overlap.** A cell's overlap count is the number of distinct lines, of any kind, with at least one swath containing it. A cell is covered when that count is 1 or more. Lines that count in nothing under Line re-run in Field operations are left out here, from strips and from crossline agreement.
- **Coverage percentage.** `coverage_pct` = covered area cells ÷ all area cells × 100, rounded half up to one decimal.
- **Tracks.** A line's track is every accepted fix received while that line was Running on its vessel, in `t` order, over-speed and off-heading fixes included.

**Crossline agreement.**
- **Survey order coefficients.** `special` (Special Order): a = 0.25 m, b = 0.0075. `1a` (Order 1a): a = 0.5 m, b = 0.013.
- **Line depth.** A line's depth at a cell is the unrounded mean of B's `depth_m` over every sweeping pair A→B of that line whose swath contains the cell centre. Each pair counts once.
- **Comparisons.**
  - There is one comparison per area cell for each pair of a crossline X and a mainscheme line L that both have a depth there. Infill lines are not compared.
  - With dX and dL those depths, the comparison is within when |dX − dL| ≤ sqrt(a² + (b × (dX + dL) ÷ 2)²), computed unrounded.
- **The record.** `crossline_agreement` is `{"compared","within","pct","meets_order"}`.
  - `pct` is within ÷ compared × 100, rounded half up to one decimal.
  - `meets_order` is `pct` ≥ 95.0.
  - Both are `null` when `compared` is 0.
- **Agreement everywhere.** It is decided in one place. The mission API, the console and survey headers, the report and the email show the same values.

**Holidays.**
- **Strips.** Each mainscheme line owns a strip of cells, chosen by the across-line offset of each cell's centre.
  - The boundary between neighbouring lines is halfway between their offsets. A cell exactly on a boundary belongs to the higher-offset line.
  - The first strip runs to the area's low edge and the last strip to its high edge.
  - Crosslines and infill lines own no strip.
- **Holiday cells.** An uncovered area cell is a holiday cell when the line that owns its strip is Surveyed or Delivered.
- **Groups.** A group is a set of holiday cells connected through shared edges.
  - A group is a holiday only when it holds at least 3 cells in a straight run: in one grid row with consecutive cols, or in one grid column with consecutive rows.
  - Every other group is a speck. Specks count as uncovered in `coverage_pct`, but are never labelled, counted in `open_holidays`, hatched, listed or queued.
  - A holiday's area is its cell count × 25 m².
- **Labels.** Holidays are recomputed after every accepted fix and every line end. Only qualifying groups are matched.
  - A group may take the label of an existing Open or Queued holiday only if they share at least one (col, row).
  - A group's best match is the holiday it shares the most cells with. Ties go to the lowest label number.
  - When several groups share a best match, the winner is the one that shares more cells with it, then the one with more cells, then the one containing the lowest cell (row first, then col).
  - The winner takes the label and keeps its status and infill line. Losing groups are unmatched.
  - Unmatched groups get the next label `H<number>`. Labels are never reused.
  - An existing holiday left unmatched becomes Closed. That includes one that has shrunk to specks or to nothing.
- **Status.** A holiday is Queued while its infill line is Assigned or Running, and Open otherwise. When its infill becomes Surveyed and the group still qualifies, it returns to Open.

**Mission counters.**
- `coverage_pct`, as above.
- `open_holidays` is the number of Open holidays.
- `lines_remaining` is the number of lines of every kind that are Pending, Assigned or Running.

Each counter is decided in one place and is the same on every response, CSV and screen. For example, with the seed data at start, `lines_remaining` is 14 for Calderhaven North Basin.

**Infill.**
- **Refusals.** Queueing is refused with `409 holiday_closed` for a Closed holiday, then `409 mission_not_surveying` unless the mission is Surveying, then `409 no_eligible_vessel`.
- **Eligibility.** A vessel is eligible when it has lines on this mission, is afloat, is Live and is not overdue.
- **Nearest vessel.** The nearest eligible vessel is the one whose last fix is closest to the infill line's midpoint. Ties go to the alphabetically first name. The same choice fills each holiday's `nearest_vessel` for staff, and is null when no vessel is eligible.
- **Geometry.** The infill line runs along the azimuth, through the across-line offset of the centroid of the holiday's cell centres. It runs from 10 m before the holiday's lowest along-line cell centre to 10 m past its highest, clipped to the survey area.
- **Creation.** It is created Assigned, labelled `I01`, `I02` and onward, linked to the holiday, and appended to the end of that vessel's infill queue. The holiday becomes Queued.
- **Repeats.** While a holiday is Queued, any further queue returns the existing line with 200. Of simultaneous queues for one holiday, exactly one gets 201 and the rest get 200 naming the same line.
- **Lost vessel.**
  - When a vessel becomes Lost, each of its Assigned infill lines on that mission moves to the nearest eligible vessel, using the same eligibility decision, and joins the end of that vessel's queue. The holiday stays Queued.
  - With no eligible vessel, the line stays where it is.
  - Mainscheme lines and crosslines never move.
- **Infill queue.**
  - A vessel's infill queue on a mission is its Assigned infill lines, in the stored run order.
  - A line leaves the queue when it starts running or moves away.
  - A reorder is stored only when its ids are exactly the current queue.

**Client scope and projection.**
- **Data from the mission only.** For a client reviewer, a mission's tracks, coverage, holidays, counters, crossline agreement, line records and vessel markers come only from fixes received while that mission's lines were Running. Each vessel's survey-chart marker sits at the last point of its track on the mission.
- **No other organisations.** No client response or page names another organisation's mission, its id, or any position recorded on it, even when the same vessel later works for that organisation.
- **Projected fields.** In every client response:
  - each holiday's `nearest_vessel` is `null`;
  - each `vessels[].link_state` is the server's state while the mission is active and `null` otherwise;
  - no key contains `thruster`, `service`, `ingest` or `acknowledged`.

  Staff responses are not projected.

**Time rules.**
- **Fixes.** A screen showing an affected value reflects an accepted fix, and every counter, agreement value, holiday or alert it changes, within two seconds of receipt.
- **Link state.** Link states are re-evaluated at least every two seconds. A link-state change, the link-lost alert and any infill move it causes reach the screen within five seconds of the fix age crossing a threshold.
- **Alert email.** An alert email reaches the mail server within 30 seconds of the event.
- **Escalation.** The escalation delay is `ESCALATION_SECONDS` seconds (default 300). An alert still Active once the delay has passed sends exactly one escalation per recipient within 30 seconds after it.
- **Plan preview.** It reflects the form within one second of the last edit.
- **Idle warning.** The 28-minute idle time and the two-minute countdown run on the browser clock and only decide when the browser signs out.

**Coverage report contents.**
- **Byte form.** The report is UTF-8 JSON with no insignificant whitespace. Each number is written in its shortest form that reads back as the same value, with no exponent and no trailing `.0`.
- **Keys, in this order:**
  - `mission_id`, `mission_name`, `client_name`;
  - `completed_at`: exactly as the API returns it;
  - `generated_at`: that instant truncated to whole seconds, in UTC, ending in `Z`;
  - `generated_at_local`: the same instant in the client organisation's time zone, as ISO 8601 with its UTC offset, for example `2026-11-20T15:04:05+01:00`, using `+00:00` for a zero offset;
  - `coverage_pct`, `open_holidays`, `crossline_count`;
  - `crossline_agreement`: with keys `compared`, `within`, `pct`, `meets_order`, in that order;
  - `delivered_lines`: one entry per Delivered line and per Superseded line whose file is Stored, in lines-endpoint order, with keys `label`, `kind`, `file_name`, `size_bytes`, `sha256` and `key`, in that order. `file_name`, `size_bytes` and `sha256` come from the line's `file`. `key` is `lines/<mission id>/<line id>/<file name>`;
  - `vessel_totals`: one entry per vessel with at least one Surveyed or Delivered line (Superseded lines never count), by vessel name, with keys `vessel`, `lines`, `length_m` and `covered_m`. `lines` counts those lines. `length_m` and `covered_m` are sums of the unrounded line values, each rounded half up to 0.1 once, after summing;
  - `holidays`: the Open and Queued holidays by label number, with keys `label`, `area_m2` and `cell_count`.
- **Values.** Every other value is exactly as the API returns it.

**Units.**
- The preference changes display only. The API, the CSV and the report always use SI, and the browser converts planner entries to SI before sending them. The planner address keeps values as typed.
- Lengths (positions, depths, swath width, line spacing, line length) show in `m` or `ft` (1 ft = 0.3048 m) with one decimal.
- Speeds show in `m/s` or `kn` (1 kn = 1,852 m per hour) with one decimal.
- Areas show as whole `m²` or `ft²` (1 ft² = 0.09290304 m²).
- Display rounding is half away from zero.
- Percentages, battery and hours are unchanged by units. Hours show one decimal with `h`.

### Services (DP-28, DP-32, DP-52, DP-55, DP-57, DP-63, DP-64, DP-66)

**Postgres** (`DATABASE_URL`) is the system of record for:
- users, sessions and sign-in attempt counts;
- each user's last screen;
- client organisations with their time zones;
- vessels with their versions and ingest keys;
- missions with their survey orders, areas and geofences;
- lines of every kind, and infill queue order;
- fixes, coverage, holidays and excursions;
- alerts with their states and history;
- service logs, idempotency keys and queued emails.

Nothing is kept in local files or in memory as the record.

**Object storage** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) holds line files and coverage reports in the provisioned bucket. The app creates no other bucket.

- **Line files.** Each is stored at `lines/<mission id>/<line id>/<file name>` with exactly the uploaded bytes. Nothing is converted, trimmed, decompressed or re-encoded.
  1. The server computes the SHA-256 of the received body. If it differs from `X-Content-SHA256`, nothing is written and the checksum 422 answers.
  2. Otherwise the server writes the object with object storage's own SHA-256 checksum, so storage checks the bytes itself and the stored object reports a SHA-256 checksum equal to the declared value.
  3. Only after storage confirms the write does the server record the file name, size, lowercase SHA-256 and stored time, mark the file Stored and move the line to Delivered.
  4. If storage refuses the write or cannot be reached, the upload answers the storage 503, nothing is recorded, and the line stays Surveyed with its file Awaiting upload.
- **Simultaneous uploads.** Of simultaneous uploads for one line, exactly one is recorded. An identical competitor gets the 200 replay, and a different one gets `409 already_delivered`.
- **Abandoned transfers.**
  - If the client disconnects before the declared upload body has fully arrived, the server stops reading. It writes no object under `lines/<mission id>/<line id>/` and leaves no incomplete multipart upload in the bucket. It records nothing, and the line stays Surveyed with its file Awaiting upload.
  - Every lock, transaction and database connection the upload held is released when the client leaves.
  - A download abandoned mid-stream likewise releases everything at once.
  - After 20 abandoned uploads in a row, `GET /api/health` still answers within one second, and a complete upload of the same line answers 201 within 10 seconds.
- **Downloads.** Downloads stream the stored object unchanged.
- **Completion and the coverage report.**
  - The move to Complete and the report entering Pending commit in one database transaction.
  - The server then writes `reports/<mission id>/coverage-report.json` with the contents from Business rules. A retried write produces identical bytes.
  - The report becomes Ready only after storage confirms the write. While storage is down, the write is retried at least every 10 seconds.
  - Once Ready, the report is never written again, and every read returns the same bytes and the same `X-Content-SHA256`.
- **Storage down.**
  - The server checks storage at least every 10 seconds.
  - Within 15 seconds of storage becoming unreachable, including at boot, `GET /api/status` reports `storage` as `down`.
  - While storage is down, uploads, line-file downloads and report reads answer the storage 503 within five seconds.
  - Within 15 seconds of storage returning, `GET /api/status` reports `up` and those requests succeed, with no restart.

**Mail** (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`) sends plain-text emails, one separate message per recipient, with only that recipient in To, and no Cc or Bcc. From and Reply-To are both the value of `MAIL_FROM`, which is set to `Swathdeck <alerts@fathomwright.test>`.

| Email | To | Subject |
|---|---|---|
| Breach alert | every principal surveyor | `Geofence breach — <vessel> — <mission>` |
| Link-lost alert | every principal surveyor | `Link lost — <vessel> — <mission>` |
| Service-overdue alert | every principal surveyor and every launch technician | `Service overdue — <vessel> — <mission>` |
| Escalation (once per alert still Active at the delay) | every principal surveyor and every launch technician | `Escalation: <original alert subject>` |
| Report ready (once per completed mission) | every client reviewer of the mission's organisation | `Coverage report ready — <mission>` |

- **Alert and escalation bodies.** They name the vessel and mission, give the position in metres and the server time, and link to the mission console using `APP_PUBLIC_URL`. They never go to a client reviewer.
- **Report-ready body.** It is exactly these six lines, each ending with CR LF:

  ```
  Coverage report ready for <mission>.
  Completed <YYYY-MM-DD HH:MM> (<offset>)
  Completed UTC <YYYY-MM-DD HH:MM>
  Report SHA-256 <hex>
  Coverage <coverage_pct>% · Open holidays <open_holidays> · Crossline agreement <pct>% of <compared>
  Open the survey: <APP_PUBLIC_URL>/surveys/<mission id>
  ```

  - Line 2 gives the date and time of `generated_at_local` and its offset, written `+HH:MM` or `-HH:MM`.
  - Line 3 gives the date and time of `generated_at`.
  - `<hex>` is the lowercase SHA-256 of the stored report bytes.
  - The numbers are written exactly as in the report bytes.
  - When `compared` is 0, the fifth line ends `Crossline agreement —` instead.
- **Nothing private.** No email or report carries a staff email address in its body, another reviewer's address, vessel thruster, service or ingest data, nearest-vessel data, or any other organisation's name or mission.
- **Emailed state.** An alert's `email` or `escalation` becomes `Emailed` once the mail server has accepted every one of its messages.
- **Report-ready ordering.** These emails are queued only after the report is Ready, so each reaches the mail server no earlier than the report object's stored time. Each reviewer receives exactly one, even under simultaneous completion requests or a retried report write.
- **Mail unreachable.**
  - The alert is still raised, shown and announced. Its email waits in Postgres, is retried at least every 10 seconds, and is sent within 30 seconds of mail returning.
  - The server checks mail at least every 10 seconds. Within 15 seconds of mail becoming unreachable, including at boot, `GET /api/status` reports `mail` as `down`. Both the status and the banner clear within 15 seconds of mail returning.
- **Exactly once.** Each message reaches its recipient exactly once, across retries.

### Seed data (DP-01, DP-04, DP-07, DP-14, DP-16, DP-18, DP-40, DP-82)

Every seeded person, business, vessel and place below is invented. Every serve applies the schema and then inserts any seed record that is missing, by id. Existing records are never changed. Every account's password is `chartroom-2026`, every account's units preference is metric, and no account has a stored last screen.

**Client organisations.**

| id | name | time zone |
|---|---|---|
| `org-calderhaven` | Port of Calderhaven Authority | `Europe/London` |
| `org-saltmere` | Saltmere Dredging Ltd | `Europe/Amsterdam` |

**Users.**

| id | Name | Email | Role | Organisation |
|---|---|---|---|---|
| `u-ira` | Ira Penhallow | `ira@fathomwright.test` | principal_surveyor | — |
| `u-wren` | Wren Calloway | `wren@fathomwright.test` | principal_surveyor | — |
| `u-tamsin` | Tamsin Rook | `tamsin@fathomwright.test` | launch_technician | — |
| `u-odile` | Odile Varga | `odile@calderhaven-port.test` | client_reviewer | `org-calderhaven` |
| `u-bram` | Bram Echols | `bram@saltmere-dredging.test` | client_reviewer | `org-saltmere` |

**Vessels**, in seed order. All start ashore, at version 1, with no fixes and no lines.

| id | Name | Ingest key | Total thruster hours | Hours since service | Service interval |
|---|---|---|---|---|---|
| `v-kittiwake` | Kittiwake | `ik-kittiwake-4c19` | 1840.2 | 112.4 | 250 |
| `v-petrel` | Petrel | `ik-petrel-8a03` | 960.0 | 249.9 | 250 |
| `v-shearwater` | Shearwater | `ik-shearwater-2e77` | 2210.5 | 263.5 | 250 |
| `v-gannet` | Gannet | `ik-gannet-61b5` | 310.0 | 40.0 | 300 |

**Missions.** Both start Planned, owned by Ira Penhallow (`owner_id` `u-ira`), at `version` 1, with `hold` null. Every mainscheme line and crossline is Pending with no vessel, and there are no fixes, holidays, alerts, flags, events or files.

| id | Name | Client | Survey date | Survey order | Survey area (easting, northing) | Geofence | Depth | Swath ratio | Overlap | Azimuth | Speed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `m-calderhaven-north` | Calderhaven North Basin | `org-calderhaven` | 2026-11-02 | `special` | (5000, 8000), (5400, 8000), (5400, 8300), (5000, 8300) | (4950, 7950), (5450, 7950), (5450, 8350), (4950, 8350) | 10 m | 4 | 20 % | 0° | 2.0 m/s |
| `m-saltmere-approach` | Saltmere Approach Channel | `org-saltmere` | 2026-11-03 | `1a` | (1000, 2000), (1120, 2000), (1120, 2600), (1000, 2600) | (950, 1950), (1170, 1950), (1170, 2650), (950, 2650) | 6 m | 4 | 25 % | 0° | 1.5 m/s |

For example, with the seed data at start, Saltmere Approach Channel has:
- `W` 24 m and `S` 18 m;
- 7 lines of 600 m;
- crosslines `X01` at northing 2200 and `X02` at northing 2400, each from easting 1000 to 1120 (120 m);
- an estimated duration of 3,440 seconds (57 min).

## Field operations (DP-09, DP-12, DP-23, DP-33, DP-51, DP-85, DP-86, DP-87, DP-88, DP-89, DP-90, DP-91, DP-92)

Everything in this section follows the API conventions, error precedence, feedback rules and screen rules above. Each copy string is published verbatim. Each time here is measured by the page clock in the browser, or by the server's clock where it says server.

### Planner undo and redo (DP-09)

- On `/missions/new`, each committed field edit is one history step. A field edit is committed when the field loses focus, or 600 ms after the last key in it. That is the same moment the address updates.
- With focus anywhere in `form "New mission"`, `Control+Z` undoes the last step and `Control+Shift+Z` redoes it. On macOS, `Meta` takes the place of `Control`. The history keeps the last 20 steps, and a new edit after an undo discards every redo step.
- An undo or a redo does the following:
  - sets the field back to its value before or after that step;
  - moves focus to that field;
  - updates the address and the plan preview exactly as typing would;
  - announces `Undid <field label>: <value>` or `Redid <field label>: <value>` in `status "Form status"`.
  
  `<value>` is the field's text after the change, or `empty`. With nothing to undo or redo, the announcement is `Nothing to undo` or `Nothing to redo`.
- In the two multi-line vertex fields, `Control+Z` is the planner's undo too, applied to whole committed field values.

### Unsaved assignments (DP-12)

- On the line plan, picker changes that have not been saved are kept in the browser's session storage, per mission.
- Reloading the line plan does the following:
  - restores those changes;
  - shows the text `Unsaved` on each changed row;
  - announces `Unsaved changes restored (<n>)` in `status "Plan status"`, where `<n>` is the number of changed rows.
- Following any in-app link away from the line plan while changes are unsaved opens `dialog "Unsaved assignments"`.
  - The dialog reads `You have <n> unsaved assignment changes.`
  - Focus starts on `button "Stay"`. `Escape` does the same as Stay, and Stay closes the dialog and returns focus to the link.
  - `button "Leave without saving"` discards the stored changes and follows the link.
- Saving, or leaving without saving, clears the stored changes.

### Track replay (DP-23)

- The vessel detail has `slider "Track replay"`.
  - Its value runs from `-600` to `0` seconds in steps of 10, and it starts at `0`.
  - Its visible value and `aria-valuetext` are `Now` at 0, and `<n> s ago` otherwise.
  - Keys: `ArrowLeft` and `ArrowDown` move 10 s back, `ArrowRight` and `ArrowUp` move 10 s forward, `PageDown` moves 60 s back, `PageUp` moves 60 s forward, `Home` goes to the oldest and `End` goes to Now.
- Replay reads its fixes from `GET /api/vessels/<vessel id>/fixes?window_s=600`, refreshed with every board refresh. "The replay set" below means that response, and "the oldest fix" means its fix with the smallest `t`.
- The replay time is the vessel's latest accepted fix `t` plus the slider value. While the slider is not at Now:
  - the detail's position line reads `Replay E <easting> N <northing> · <HH:MM:SS> UTC`, for the fix in the replay set with the greatest `t` at or before the replay time, or the oldest fix when none is;
  - that vessel's chart marker sits at that position, labelled `Replay`;
  - new fixes do not move the slider.
- At Now the detail is live, as before.

### Geofence changes mid-survey (DP-33)

- While a mission is Launched or Surveying, its owner may replace the geofence with `PUT /api/missions/<mission id>/geofence {"geofence":[<position>],"version"}`.
  - The geofence must have 3 to 40 corners, be convex and enclose the survey area. Each failure gets the same `422` messages as mission creation.
  - A `version` that is not the mission's current version answers `409 stale_version` with `"current": <mission>`.
  - Any other mission status answers `409 mission_not_active`. A principal surveyor who is not the owner gets `403 not_mission_owner`.
  - Success answers `200 <mission>`.
- On success, the server checks every vessel on the mission against the new geofence, using its latest fix:
  - An Active breach whose vessel is now inside moves to Rectified, and an Acknowledged breach whose vessel is now inside moves to Closed. The history entry's `by` is the owner's name. Fleet announcements says `<vessel> back inside the geofence` once.
  - A vessel now outside with no open breach raises one at once, exactly as a fix would.
- On the console, `button "Edit geofence"` opens `dialog "Edit geofence"`. It holds `textbox "Geofence corners"`, with the planner's typing rules, and `button "Save geofence"`. Success closes the dialog, redraws the dashed line and announces `Geofence updated` in Fleet announcements.

### Resumable line-file upload (DP-51)

Files larger than 8,000,000 bytes upload in parts. The single `PUT /api/lines/<line id>/file` stays valid for any size up to its published limit.

- `POST /api/lines/<line id>/uploads {"size_bytes","sha256"}` answers `201 {"upload_id","part_bytes":4000000,"received_bytes":0}`.
  - While an upload with the same size and checksum is open for that line, it answers `200` with that upload and its current `received_bytes`.
  - For a Delivered line whose stored file has the same size and SHA-256, it answers `200 <line>` unchanged, exactly as the single PUT's replay does.
  - Otherwise it is refused like the single PUT: `409 line_not_surveyed` when the line is not Surveyed, `409 already_delivered` when it is Delivered with a different file.
  - `size_bytes` must be a whole number from 1 to 50,000,000 inclusive. Otherwise it answers `422` with `size_bytes`: `The file must be 1 to 50,000,000 bytes`. `sha256` follows the single PUT's 64-character rule and message.
- `PUT /api/lines/<line id>/uploads/<upload id>` takes the raw part with the header `Content-Range: bytes <first>-<last>/<size>`.
  - A part is at most 4,000,000 bytes and must start exactly at `received_bytes`. A part that starts anywhere else answers `409 range_mismatch` with `"received_bytes"`.
  - A valid part answers `200 {"received_bytes"}`.
- When `received_bytes` reaches `size_bytes`, the server checks the whole file's SHA-256. On a match it stores the file as one object, exactly as the single PUT does, and the line becomes Delivered. The part that completes the file answers `201 <line>`, Delivered with file Stored, instead of `200 {"received_bytes"}`. If storage is unreachable when that part arrives, it answers the storage 503, `received_bytes` stays at its value before that part, and the part may be sent again. On a mismatch it answers `422` with `sha256`: the published checksum message, discards the parts and leaves the line Awaiting upload.
- The upload dialog resumes on its own. After a part fails without an HTTP response, it repeats the POST, continues from the `received_bytes` that comes back and shows `Uploading <n>%` from the received bytes. The row reads `Stored` only after the final part's `201 <line>`.

### Offline slipway queue (DP-85)

- On `/launch`, `Mark <vessel> afloat`, `Mark <vessel> recovered` and the service dialog's save are queued instead of sent while the phone is offline. The phone counts as offline only while `navigator.onLine` is false; an action taken then is queued without being sent.
- A request that fails without any HTTP response while `navigator.onLine` is true is never queued. It gets the no-response copy and manual retry from Feedback states: the row keeps its previous word, and the service dialog stays open and resends with the same key when `Save service` is pressed again.
- A queued action:
  - takes its idempotency key when it is queued and keeps it until it is sent;
  - lives in the browser's local storage, so it survives a reload or a closed tab;
  - is announced in `status "Launch status"` as `Saved on this phone — <n> waiting to send`, where `<n>` is the queue length;
  - makes its vessel's row read `Queued — will send when online`.
- While the queue is not empty, the launch list header shows `button "Waiting to send (<n>)"`. It opens `dialog "Waiting to send"`, which lists the queued actions in order as `<vessel> · <action> · <HH:MM> UTC` with `button "Discard <vessel> <action>"` on each. `<action>` is `afloat`, `recovered` or `service`.
- When `navigator.onLine` becomes true again (the `online` event, or a page load with a non-empty queue while online), the queued actions are sent one at a time in the order they were taken. Each result is announced as for the live action.
- A refused action leaves the queue, and its row reads `Not sent — <API message>`. Every later queued action for the same vessel then leaves the queue with `Not sent — an earlier action for <vessel> was refused`. Actions for other vessels are still sent.
- The header button disappears when the queue is empty.

### Mission handover (DP-86)

- `<mission>` gains three fields:
  - `"owner_id"` and `"owner_name"`, which name the principal surveyor who created the mission until it is handed over;
  - `"version"`, an integer that starts at 1 and goes up by one on every change to the mission's status, assignments, owner, hold or geofence.
- Only the owner may launch, abort, hand over, hold or resume the mission, change its geofence or re-run one of its lines. Another principal surveyor gets `403 not_mission_owner`, with the message `Only <owner name> can do this for <mission>.`
- `POST /api/missions/<mission id>/handover {"to_user_id","version"}` (owner only) answers `200 <mission>`, with the new owner and the version one higher.
  - A Complete or Aborted mission answers `409 mission_not_open`, checked before the version.
  - `to_user_id` must be another principal surveyor. Otherwise it answers `422` with `to_user_id`: `Choose another principal surveyor`.
  - A stale `version` answers `409 stale_version` with `"current"`. Of simultaneous handovers sent with the same version, exactly one succeeds.
- The new owner receives exactly one email.
  - Subject: `<mission> handed to you`.
  - Body line: `<previous owner> handed <mission> to you at <YYYY-MM-DD HH:MM> UTC.`
  - Within five seconds, their open fleet board announces `<previous owner> handed <mission> to you` in Fleet announcements.
- On the console, the owner's `button "Hand over"` opens `dialog "Hand over mission"`, with `combobox "Surveyor"` listing the other principal surveyors and `button "Hand over"`.
  - Success announces `Handed <mission> to <name>` in Fleet announcements.
  - For a principal surveyor who is not the owner, `Launch mission`, `Abort mission`, `Hand over` and `Edit geofence` are disabled, with the visible note `Owned by <owner name>`.

### Line re-run (DP-87)

- The owner may re-run a Surveyed or Delivered planned line or crossline with `POST /api/missions/<mission id>/lines/<line id>/rerun {"reason"}`. It answers `201 {"line":<new line>}`.
  - The reason must be 3 to 200 characters after trimming. Otherwise it answers `422` with `reason`: `Give a reason of 3 to 200 characters`.
  - Any mission status other than Launched or Surveying answers `409 mission_not_active`.
  - A line that already has a re-run that is not Delivered answers `409 rerun_open`.
- The new line:
  - is labelled `<label>R<n>`, where n counts from 1 for that line, and copies the kind, end points and length;
  - starts Pending with no vessel, and carries `"rerun_of":<original line id>` (other lines have `null`);
  - adds one to `lines_remaining`.
- When the re-run becomes Delivered, the original's status becomes `Superseded`, a new line status word.
- Only one of the pair counts at a time:
  - Until the re-run is Delivered, the original owns the strip (for a mainscheme line) and counts in overlap, coverage, `covered_m`-based figures and crossline agreement. The re-run owns no strip and its swaths count in nothing, though its track still shows.
  - Once the re-run is Delivered, the Superseded original owns no strip and its swaths count in nothing. The re-run takes over the strip at the same offset and counts in overlap, coverage, holidays and crossline agreement exactly as the original did.
- A Superseded line counts as finished for the Recovering and Complete preconditions, is not counted in `lines_remaining` or `vessel_totals`, and takes no upload.
- The Superseded original keeps its row in the coverage CSV, with status `Superseded` and its own length and covered values. It keeps its row in the survey's `Line files` table, reading `Superseded`. If its file is Stored, it stays downloadable and is listed in the report's `delivered_lines` alongside the re-run.
- `GET /api/missions/<mission id>/lines` lists each re-run right after its original.
- In `table "Lines"`, each Surveyed or Delivered row has `button "Re-run <label>"`. It opens `dialog "Re-run line"`, with `textbox "Reason"` and `button "Create re-run"`. Success announces `<new label> added — assign a vessel to run it` in Fleet announcements and moves focus to the new row.

### Coverage as a keyboard grid (DP-88)

- On the console, `button "View as table"` has `aria-pressed`. It swaps the chart and lens for `grid "Coverage table"`, and pressing it again brings the chart back. The choice is kept in the address as `?view=table`.
- The grid has one `row` per row of cells, from north at the top to south, and one `gridcell` per cell, from west to east.
  - A cell's text is its overlap count: `0`, `1`, `2` or `3+`.
  - A cell inside an Open or Queued holiday reads `<holiday> <count>`, for example `H1 0`.
  - A cell outside the survey area (overlap -1) reads `outside`.
  - The grid's `aria-rowcount` and `aria-colcount` equal the full grid size. Every rendered cell carries its 1-based `aria-rowindex` and `aria-colindex`, even when only the visible rows are rendered.
- Exactly one cell is in the tab order. The keys are:
  - arrow keys move focus one cell and stop at the edges;
  - `Home` and `End` go to the row's first and last cell;
  - `Control+Home` and `Control+End` go to the grid's first and last cell;
  - `PageUp` and `PageDown` move 10 rows.
- `group "Lens readout"` shows the focused cell's centre exactly as the lens does, including the holiday line when the cell is in a holiday.
- `Enter` on a holiday cell queues infill for that holiday exactly as the lens does. `Enter` on any other cell, including an outside cell or a speck, sends nothing and announces `No holiday under the lens` in Fleet announcements.

### Mission history (DP-89)

- `/missions/<mission id>/history` is for staff only. It shows `heading "History of <mission>"` and `list "Mission events"`, with the mission's events newest first.
- Each `listitem` reads `<YYYY-MM-DD HH:MM:SS> UTC · <actor> · <summary>`. The actor is a user's name, or `Swathdeck` for server events.
- Every mission event is recorded, by kind, with these summaries:

  | Kind | Summary |
  |---|---|
  | `created` | `Mission created` |
  | `assignments` | `Assignments saved (<n> lines)` |
  | `status` | `Status <from> → <to>` |
  | `line` | `<label> <from> → <to>` |
  | `file` | `<label> file stored` |
  | `alert` | `<alert heading> <state>` |
  | `infill` | `<label> queued to <vessel>` or `<label> moved to <vessel>` |
  | `owner` | `Handed to <name>` |
  | `hold` | `Held: <reason>` or `Resumed` |
  | `geofence` | `Geofence changed` |
  | `rerun` | `<new label> added: <reason>` |

- `GET /api/missions/<mission id>/history?kinds=<comma-separated kinds>&before=<cursor>` answers `200 {"events":[{"seq","at","kind","actor","summary"}],"next":<cursor or null>}`.
  - A page holds at most 50 events, newest first by `at` and then by `seq`.
  - A kind outside the table answers `422` with `kinds`: `Choose kinds from the published list`.
- `group "Event kinds"` has one checkbox per kind, labelled `Created`, `Assignments`, `Status`, `Line`, `File`, `Alert`, `Infill`, `Owner`, `Hold`, `Geofence` and `Rerun`. The checked kinds live in the address as `?kinds=`, and with every kind checked the parameter is absent.
- `button "Load older events"` appends the next page and moves focus to the first newly added item. It disappears when `next` is null.
- `status "History status"` reads `Showing <shown> events`.

### Weather hold (DP-90)

- The owner may hold a Surveying mission with `POST /api/missions/<mission id>/hold {"reason"}`. It answers `200 <mission>` with `"hold":{"reason","since","by"}`. Missions not on hold carry `"hold": null`.
  - The reason must be 3 to 120 characters. Otherwise it answers `422` with `reason`: `Give a reason of 3 to 120 characters`.
  - Refusals, in this order: `409 mission_not_surveying` for any status other than Surveying, `409 mission_on_hold` when the mission is already held, `409 line_running` while a line is Running.
- While a mission is held:
  - a line start for it answers `409 mission_on_hold`, in the order given in API;
  - no link-lost alert is raised for its vessels;
  - geofence breaches are still raised.
- `POST /api/missions/<mission id>/resume` (owner only) clears the hold and answers `200 <mission>`. Any vessel that is Lost at that moment raises its link-lost alert within five seconds. A mission with no hold answers `409 mission_not_on_hold`.
- Aborting a held mission clears its hold.
- On the console, `button "Hold for weather"` opens `dialog "Hold for weather"`, with `textbox "Reason"` and `button "Hold survey"`.
  - While held, `region "Mission header"` shows `On hold: <reason>` and `button "Resume survey"`.
  - Fleet announcements says `Survey held` and `Survey resumed`.

### Client flags (DP-91)

- A client reviewer may flag a Delivered line of their own organisation's survey with `POST /api/missions/<mission id>/lines/<line id>/flags {"comment"}`. It answers `201 {"id","line_label","comment","by","at","state":"Open","reply":null}`.
  - The comment must be 1 to 500 characters after trimming. Otherwise it answers `422` with `comment`: `Write a comment of 1 to 500 characters`.
  - Another organisation's line answers `404 not_found`. A line that is not Delivered answers `409 line_not_delivered`.
- Staff read `GET /api/flags?state=open|all`, newest first. They reply once with `POST /api/flags/<flag id>/reply {"text"}` (1 to 500 characters), which answers `200` with `"state":"Answered"` and the reply. A second reply answers `409 flag_answered`.
- `<client>` is the name of the flagging reviewer's client organisation, for example `Port of Calderhaven Authority`.
- Each principal surveyor receives exactly one email for each flag, with the subject `<client> flagged <label> on <mission>`. Its body contains the comment unchanged on a line of its own and the link `<APP_PUBLIC_URL>/flags`.
- The reviewer who flagged receives exactly one email for the reply, with the subject `Reply on <label> for <mission>`. Its body contains the reply unchanged on a line of its own and the link `<APP_PUBLIC_URL>/surveys/<mission id>`, and carries no staff email address.
- On `/surveys/<mission id>`, each Delivered row of `table "Line files"` has `button "Flag <label>"`. It opens `dialog "Flag line"`, which holds:
  - `textbox "Comment"`;
  - `status "Comment length"`, which shows `<n>/500` and announces only at 450, 490 and 500 characters;
  - `button "Send flag"`.
  
  Success announces `Flag sent for <label>`, and the row shows `Flagged`.
- On the fleet board, staff see `link "Client flags (<open count>)"`, which goes to `/flags`. That page shows level-1 `heading "Client flags"` and `list "Open flags"`, one `listitem` per Open flag, newest first, reading `<client> · <mission> · <label> · <comment>`, each with `button "Reply to <label>"`. That button opens `dialog "Reply to flag"` with `textbox "Reply"` and `button "Send reply"`; success announces `Reply sent for <label>` in `status "Flags status"` and removes the item.

### Reassign many lines and undo (DP-92)

- On the line plan, the rows of `table "Line plan"` can be selected:
  - `Space` on a focused row toggles it;
  - `Shift+ArrowDown` and `Shift+ArrowUp` extend the selection from the focused row;
  - `Control+A` selects every Pending and Assigned row.
  
  Each row's `checkbox "Select <label>"`, in the row's first cell before the label, follows the selection. After each change, `status "Plan status"` announces `<n> lines selected`.
- `button "Assign selected"` sits above `table "Line plan"`, beside `button "Save assignments"`, and opens `dialog "Assign selected lines"`, with `combobox "Vessel"`.
  - Confirming saves every selected line to that vessel in one `POST /api/missions/<mission id>/assignments`, all or nothing as published.
  - It announces `Assigned <n> lines to <vessel> — Undo available for 10 seconds` and shows `button "Undo"`.
- Undo within 10 seconds sends one assignments POST that restores every line's previous vessel, and announces `Undid assignment of <n> lines`.
  - After 10 seconds, the Undo button disappears.
  - An undo the server refuses announces `Could not undo: <API message>` and leaves the server state as it is.

## Technical requirements

### Deployment (DP-81, DP-82)

- **Runtime.** Node.js 22 with npm. The app is written in TypeScript.
- **Manifest.** `/app/run.json` holds the string commands `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- **Port.** `serve` listens on `0.0.0.0`, on the port in `APP_PUBLIC_PORT`, or 4173 when it is unset.
- **Health.** `GET /api/health` answers HTTP 200 `{"status":"ok"}`.
- **Schema and seed.** Both are applied idempotently on every serve, because the grader may hand the app a fresh, empty database.
- **Several instances.** More than one instance may run at once. Each instance is given its own database and its own bucket, which may start empty, and never shares either with another instance. Each instance runs its own timers (link-state checks, escalations, mail and storage retries) only for its own database.

### Configuration and secrets (DP-84)

- **Read at start.** The server reads these from the environment at start:
  - `DATABASE_URL`;
  - `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
  - `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`;
  - `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`;
  - `ESCALATION_SECONDS`, `SIGN_IN_WINDOW_SECONDS`.
- **Never exposed.** No credential or service address is hard-coded in source, written into the built browser files, or sent in any response.
- **Ingest keys.** They exist only as seed records and are never shown on a screen.

### Server boundary (DP-55, DP-56, DP-57, DP-58, DP-83)

- **What is served.** Only the built browser app, its fonts and assets, and the API. Source files, the manifest, environment files, lockfiles and anything else outside the build output answer 404.
- **Same origin.** No response carries headers allowing cross-origin access. The browser app talks only to its own origin, and no page loads scripts, fonts or images from another host.
- **Size limits.** The JSON and upload limits from API are enforced before a body is read in full. Reading stops as soon as a client disconnects.
- **Opaque errors.** Every error response uses the error shape from API and nothing else. No response body or header carries any of:
  - a stack frame or file path;
  - the storage or mail host or port;
  - the bucket name;
  - a database message;
  - an SDK or system error name or code, for example `ECONNREFUSED`, `S3ServiceException` or `NetworkingError`.
- **Headers.** Responses carry no `X-Powered-By` header.
- **Status and alerts.** `GET /api/status` carries only `up` or `down`, and alert records never carry a mail error.
- **Boot with a dependency down.**
  - If object storage or mail is unreachable at boot, the server still starts, answers health, serves every screen and shows the matching banner. It recovers by itself when the dependency returns.
  - If Postgres is unreachable at boot, the server retries at least every two seconds and starts serving once it connects.

### Browser support and performance (DP-23, DP-75)

- **Browsers.** Current Chromium, Firefox and WebKit, at 1280x800, 768x1024 and 375x812, with mouse, keyboard and touch.
- **Load time.** With the seed data, each screen is usable within three seconds of navigation: controls respond and the chart is drawn.
- **Input response.** The chart and lens respond to pointer, key and touch input within a tenth of a second.
- **Live updates.** These meet the delays in Business rules.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and those commands alone install, build and start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` names every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its licence.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0, and every bundled font is under the SIL Open Font License 1.1.
- IF-04: The app uses no datastore beyond the provided Postgres database and object-storage bucket: no SQLite, no Redis and no files on local disk as a record.
- IF-05: The provided service configuration (the compose files and their dev credentials) is left exactly as given.
- IF-06: The app makes no runtime request to any outside host; fonts, scripts and chart drawing are all served or done locally.

## Engineering standards

- **TypeScript.** The code is idiomatic TypeScript with the compiler's strict checks on, and domain code uses no untyped escape hatches.
- **Domain names.** Names in the code use this brief's domain terms: mission, survey order, mainscheme line, crossline, infill line, infill queue, swath, swath ratio, line spacing, fix, batch, link state, excursion, alert state, alert history, holiday, speck, crossline agreement, line file, service interval and vessel version.
- **One decision per rule.** Each domain rule is decided in exactly one place in the source, and screens and other endpoints call that decision instead of recomputing it. This covers:
  - the line-plan and crossline derivation;
  - link state;
  - the swath rule with its over-speed and off-heading exclusions;
  - holiday detection;
  - crossline agreement;
  - each mission counter;
  - mission, line and alert transitions together with the alert history entry;
  - infill eligibility, shared by queueing and reassignment;
  - the overdue check;
  - the sign-in attempt limit;
  - the safe-return and landing rule;
  - the client projection.
- **One error shape.** Every API error is produced in the one error shape from API. There are no ad-hoc error bodies, and raw error text is never passed through.
- **Request-scoped state.** Nothing that belongs to a request or a signed-in user is held in module or process scope on the server, or kept in the browser past sign-out.
- **No needless layers.** No abstraction has a single implementation, and no wrapper only forwards to another call.
- **No dead code.** There is no dead, commented-out or unreachable code, and no defensive check for a state this brief makes impossible.
- **Scope.** No feature, screen, endpoint or setting goes beyond this brief.
