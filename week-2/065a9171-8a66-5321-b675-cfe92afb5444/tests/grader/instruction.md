# Tallow Cover

Tallow Cover is the attendance and leave service for a group of UK residential care homes that run around the clock. Care workers clock in and out of rostered shifts, ask for leave and report sickness. Bank carers claim open cover shifts and watch their holiday build up from the hours they work. Unit managers decide leave with a live view of each shift's safe-staffing floor. Group HR admins set floors and leave policy with effective dates, correct attendance and export payroll timesheets. The server is written in Python and uses three backing services. Postgres is the system of record. Mailpit receives every email the product sends. A private MinIO bucket holds fit notes and timesheet exports. These are out of scope: self-registration, password reset, payroll calculation in money, agency booking, rota auto-generation, leave-year rollover tooling, and any datastore other than Postgres and MinIO.

## Problem and users

A regional care group runs every home 24 hours a day. Each unit must keep a minimum number of staff on every Early, Late and Night shift, and at least one of them must be a senior. Today a manager approves leave from a paper diary or an HR app that cannot see the rota. They approve it hoping a bank carer will fill the gap. When nobody does, the home either books agency staff at about twice the hourly cost or runs a night short and risks a safe-staffing finding at inspection. Zero-hours bank carers build up holiday at 12.07% of the hours they actually work. Payroll rebuilds that figure every month from spreadsheets and a punch clock. The clock records the wrong length for night shifts that cross a clock change, it keeps a forgotten clock-out running for days, and it records two clock-ins when a tablet and a phone both send one. Sickness reasons and fit notes sit in shared inboxes that any manager can open. When a worker falls ill on a booked holiday, nobody gives the holiday back.

- **Care worker** (daily): clocks in and out of rostered shifts on a shared unit tablet or their phone, requests leave, reports sickness, uploads a fit note, checks their remaining holiday hours and keeps their display name up to date.
- **Bank carer** (weekly): sees open cover shifts at the homes they are credentialed for, claims one (often on a weak phone signal), and watches holiday accrue from the hours they worked.
- **Unit manager** (daily): works one home's approval queue. For each request they see what approving it does to every shift's floor, and they post cover before approving. They also run the home's day, keep its rota and correct attendance.
- **Group HR admin** (weekly): sets floors and leave policy per home with effective dates, finds and corrects missed or wrong attendance with an attributed reason, closes pay periods and exports timesheets for payroll.

## Journeys

1. **Priya asks for three days off.** Priya Raman (care worker, Larchfield House, Rowan unit) signs in and opens Request leave. She picks Annual leave and three dates about six weeks ahead, adds a note, saves a draft and submits it. Only what she filled in is saved: the status, the hours and the short-notice mark are always the server's to decide. My requests then shows the request as Submitted, with the hours it costs, and My shifts shows her remaining balance.
2. **Fenella works the queue with Floor drop.** Fenella Marsh (unit manager, Larchfield House) opens Queue, filtered to her home and to open requests, and selects Priya's request. The right-hand strip shows 21 bars, one for each shift in the week. She turns on Preview approval. Priya's Early bars drop one by one, and each lands below the floor line, hatched and labelled "-1 below floor" and "no senior on shift". A dashed ghost slot appears on each one. Fenella drops the Cover chip on each ghost slot. Each slot turns gold and reads "cover posted", and the request becomes Cover pending. When a bank carer claims a shift, that bar rises back and its hatching clears. Once every gap is filled, Approve is enabled. She approves, and Priya receives an approval email.
3. **Femi claims a shift on a weak signal and builds holiday.** Femi Adebayo (bank carer, senior) gets a cover email that names the home, unit, shift and skill. Femi opens Open cover and presses Claim. The phone loses the answer and the app retries. Femi sees "Shift claimed" once and holds exactly one shift, which appears in My shifts. Femi clocks in and out of it, and Holiday accrual shows the pending hours growing. After the HR admin closes the month, the ledger shows a new entry.
4. **Aoife clocks in on a laggy tablet while her phone does too.** Aoife Brennan (care worker, Rowan nights) signs in on the unit tablet and double-taps Clock in. At the same moment her phone, left open on My shifts, sends its own clock-in. Exactly one attendance and one punch are recorded. The tablet shows the clock-in time, and the phone shows that she is already clocked in. Next morning Aoife clocks out and sees the real hours worked. On the night the clocks go back this is 11 hours, not 10.
5. **Kwame falls ill during booked leave and is off past a week.** Kwame Mensah has annual leave approved for two days starting today. Kwame reports sickness starting today with a short reason. My shifts shows the hours of those sick leave days back in Kwame's balance. On Fenella's Today, every count for Rowan still matches the staffing strip for the same shifts. On the eighth calendar day the record asks for a fit note. Kwame uploads a photo of it, the record shows Evidenced, and Open fit note downloads the photo under its original name. On returning, Kwame records the last day off sick and the record closes. Kwame's managers see Kwame as away on the rota, but never the reason or the fit note.
6. **Rosalind raises a night floor, fixes a missed clock-out and runs payroll.** Rosalind Okafor (group HR admin) adds a new floor version for Rowan nights, raising the floor from 3 to 4 from a future date, and sees it listed beside the old version. On Today, Rosalind finds a bank carer's missed clock-out from earlier in the week. Rosalind follows its link to Attendance and adds the clock-out with a reason. The entry leaves the list and appears in the audit log. Fenella had opened the same correction a moment earlier. When she saves, she is told someone changed the record, and she sees Rosalind's version. Rosalind closes last month's pay period, exports the timesheet CSV for both homes and downloads it.
7. **Grace checks the team rota after a swap and a rename.** Fenella removes Tom Achebe from next Tuesday's Early and adds him to next Tuesday's Late. Tom renames himself on Profile to "Tomasz Achebe-Kerr". Grace Lindqvist opens Team rota and pages to next week. Tom appears under his new name, and only on Tuesday Late. Colleagues on leave or off sick show only as "away". Nothing on the screen or in the response says whether it is leave or sickness, and nothing shows anyone's balance. The audit log still shows each entry under the name its author had when they wrote it.
8. **Priya's request waits while mail is down.** Priya has set her display name to one with accented letters and submits a request that nobody answers. The mail service is down when the escalation delay runs out. The request still shows Escalated. When mail comes back, Fenella receives one escalation email whose subject shows Priya's name correctly, and every email queued behind it arrives as well.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** `/app/run.json` installs, builds and serves the app on port 4173 or `APP_PUBLIC_PORT`, and `GET /api/health` answers as defined in API.
- **DP-02 — Sign-in and sessions** Seeded staff sign in with email and password and receive an HTTP-only session cookie, and API calls without a valid session are refused, as qualified in API.
- **DP-03 — One error shape and order** Every API error uses the single error body and the single precedence order defined in API.
- **DP-04 — Server boundary** The server refuses cross-origin writes and oversized bodies and never serves source files, the run manifest or credentials, as defined in Server boundary.
- **DP-05 — Credentials from the environment** Every service URL and credential is read from the environment variables named in Configuration and secrets, never hard-coded in source and never sent to the browser.
- **DP-06 — Clock in and out on a rostered shift** A care worker signs in on a phone or unit tablet, clocks in to the current rostered shift and later clocks out, and sees the confirmation and worked hours on My shifts.
- **DP-07 — Clock-in window** Clock-in attaches to the caller's rostered shift whose window contains the current time, and clocking in with no such shift or while clocked in, or clocking out when not clocked in or after the clock-out window has closed, is refused, as qualified in Business rules.
- **DP-08 — One punch per tap** Repeated or concurrent punches with the same Idempotency-Key, or a double tap on the Clock in button, record exactly one punch, as qualified in Business rules.
- **DP-09 — Late after ten minutes** A clock-in more than ten minutes after the rostered start in Europe/London time is flagged late and waits for a manager's acknowledgement.
- **DP-10 — Real elapsed hours across clock changes** Rostered and worked hours are real elapsed time, so a 22:00 to 08:00 night is 11 hours across the October clock change and 9 hours across the March one.
- **DP-11 — Request leave** A care worker saves a leave request as a draft, submits it, and sees it in My requests with its status, hours and any short-notice mark.
- **DP-12 — Leave request lifecycle** A leave request moves only along the transitions listed in Business rules, and every other transition is refused without changing the request.
- **DP-13 — Notice period and short notice** A request whose first day is closer than the notice period in force, counted from today in Europe/London, is still accepted and is marked short notice.
- **DP-14 — Annual leave hours and balance** Annual leave costs the requester's real rostered hours inside its dates, fixed when it is submitted, and a request that would take the leave-year balance below zero is refused, using the balance defined in Business rules.
- **DP-15 — Withdraw before the first shift** A requester can withdraw their own request, an approved one only before its first affected shift starts, after which only a group HR admin can cancel it with a reason.
- **DP-16 — Own leave and sickness records only** A care worker who opens another person's leave request, sickness record or fit note by its id is answered as if it does not exist.
- **DP-17 — See the team rota** A care worker opens Team rota for a week and sees each colleague's shifts, with colleagues on leave or off sick shown only as away.
- **DP-18 — Rota fields per role** Rota responses carry only the fields published for the caller's role, so a care worker never receives an absence kind, leave type, sickness reason or balance, and managers see sickness ahead of leave in the absence kind.
- **DP-19 — Report sickness and upload a fit note** A care worker reports sickness, is asked for a fit note once the absence passes seven calendar days, uploads a photo or PDF, and later records their return.
- **DP-20 — Fit note required after seven days** A sickness record moves to fit_note_required once it spans more than seven calendar days, non-working days included, and cannot close with a span of more than seven days until a fit note is uploaded, as qualified in Business rules.
- **DP-21 — Fit-note upload checks** A fit note is accepted only as a PDF, JPEG or PNG judged by its content, up to and including 5,000,000 bytes, and its file name never becomes a storage path.
- **DP-22 — Private fit-note storage** Fit notes are kept in the private bucket under an opaque key and opened only through a 60-second signed link, issued afresh to the owner or a group HR admin, that serves the detected file type as an attachment carrying the original file name, as qualified in Services.
- **DP-23 — Work the approval queue** A unit manager opens Queue for their home, filters it, selects a request, and approves or declines it with the outcome shown in the queue.
- **DP-24 — Queue counts and filters per home** Queue items and status counts, filtered by home, status and week, include only requests from the homes the caller may see.
- **DP-25 — Who may decide a request** Only a unit manager of the request's home or a group HR admin may approve or decline it, and nobody may decide their own request.
- **DP-26 — Approval holds the floor** Approval re-checks every affected shift against current counts inside its transaction, so of two concurrent approvals that together breach a floor exactly one succeeds and the other is refused with the current counts.
- **DP-27 — Queue view in the URL** The queue's home, status and week filters and the selected request live in the address, so reload, a shared link, back and forward restore the same view.
- **DP-28 — Keyboard-complete queue** A unit manager can move between requests, inspect each strip cell, post cover, approve, approve with override and decline with a reason using only the keyboard.
- **DP-29 — Floor drop from preview to approval** A unit manager previews a request, sees which shifts would fall below floor, posts cover to each gap, sees the strip refill as bank carers claim, and approves.
- **DP-30 — Staffing preview** The preview endpoint returns 21 shifts with on-duty counts now and if approved, the floor in force, shortfalls and gaps, plus whether the request can be approved, as qualified in Business rules.
- **DP-31 — Strip matches the server** Each strip bar's height, its labels and the Approve button's state match the preview response for the selected request.
- **DP-32 — Breaches shown without colour alone** A shift below floor shows a hatched bar and its breach labels as qualified in Business rules, and all text and controls meet WCAG 2.2 AA contrast.
- **DP-33 — Preview motion** Turning on Preview approval lowers only the requester's affected bars by one unit each, left to right 40 milliseconds apart, and turning it off reverses the change step by step.
- **DP-34 — Reduced-motion preview** With reduced motion requested, bars snap to their final heights with no stagger and every changed cell shows a before-to-after numeral pair.
- **DP-35 — Post cover to a gap** Dropping the Cover chip on a ghost slot, by drag or keyboard, posts one open cover shift for that gap, moves the request to cover_pending and shows the slot as cover posted.
- **DP-36 — Approve past a breach with a reason** Approve stays disabled while any affected shift would be below floor, and Approve with override approves only with a reason that is written to the audit log.
- **DP-37 — Claim an open cover shift** A bank carer opens Open cover, claims a shift at a home they are credentialed for, and then sees it among their shifts.
- **DP-38 — Open cover a bank carer can see** A bank carer sees and can claim only open cover shifts at homes they are credentialed for and for a skill they hold.
- **DP-39 — One winner per cover shift** Of simultaneous claims by different bank carers on one cover shift exactly one succeeds, and every other claimant is told it is already taken with nothing written.
- **DP-40 — Cover email without absence details** Posting cover emails each eligible bank carer once with the home, unit, date, shift times and skill, and never who is absent or why.
- **DP-41 — Run the home's day** A unit manager opens Today, sees on-duty against floor for each unit and shift together with the late clock-ins and missed clock-outs, acknowledges a late clock-in, and adds or removes a colleague on the rota.
- **DP-42 — Today in Europe/London** Every "today" the product uses, including the dashboard date, the default rota week, the notice count and the missed clock-out window, is the Europe/London date whatever the server or browser time zone.
- **DP-43 — Home-only picker and rota edits** The colleague picker, rota edits, Today totals and Today's late and missed lists for a unit manager include only their own home's staff and the bank carers credentialed there.
- **DP-44 — Set floors and leave policy** A group HR admin adds a future-dated floor version or leave-policy version for a home and sees it listed beside the earlier versions.
- **DP-45 — Effective-dated floors and policy** Each shift is judged by the floor version in force on its date, and each request by the leave policy in force on the day it is submitted.
- **DP-46 — Only HR edits floors and policy** A unit manager or care worker who tries to add a floor or leave-policy version is refused, as qualified in API.
- **DP-47 — Correct attendance** A group HR admin or unit manager corrects or adds a shift's clock times with a reason, and the change appears in Attendance and the audit log.
- **DP-48 — Corrections check the version** Every change to an attendance, the worker's clock-out and an acknowledgement included, raises its version by one, and of corrections based on the same version exactly one succeeds with one audit entry while every other is refused with the current record, as qualified in Business rules.
- **DP-49 — Append-only audit log** Each audited action writes one entry with actor, target, before, after and reason, and no entry can be changed or deleted through the API.
- **DP-50 — Watch holiday accrue** A bank carer works a claimed shift, sees their pending holiday accrual grow after clocking out, with a missed clock-out adding nothing until it is corrected, and sees a ledger entry once the pay period is closed.
- **DP-51 — Pay period close** Closing a pay period appends exactly one period entry per bank carer plus any adjustments, once, and a second close of the same period is refused.
- **DP-52 — Accrual arithmetic** Accrued holiday is 12.07% of real worked time in hours, with a missed clock-out counting as zero, rounded up at the fourth decimal place and never rounded down.
- **DP-53 — Export payroll timesheets** A group HR admin chooses a pay period and homes, creates a timesheet export, and downloads the CSV.
- **DP-54 — Timesheet CSV content** The timesheet CSV has the published columns and rows for the chosen homes only, leaves clock-out and worked hours empty for open and missed clock-outs, and neutralises any cell starting with =, +, - or @.
- **DP-55 — Stored exports and signed downloads** Each export is kept in the private bucket and downloaded through a 60-second signed link, issued afresh only to a group HR admin, that serves the CSV as an attachment named for its pay period, as qualified in Services.
- **DP-56 — Decision emails** Approving, declining or cancelling a request emails the requester exactly once, after the change commits.
- **DP-57 — Escalation after waiting** A request still submitted after the escalation delay moves to escalated and the home manager is emailed once.
- **DP-58 — Mail and storage outages** With mail or object storage unreachable, even at boot, every action still works, emails wait and uploads are held, and both complete once the service returns without a restart.
- **DP-59 — Visual identity** The screens read as steady, clinical and warm through the candle-wax page, deep teal floor line, hairline rules, equal-width numerals and type pairing described in Visual design.
- **DP-60 — Responsive layouts** Every screen works at 375x812, 768x1024 and 1280x800 without horizontal scrolling, arranged as described in Screens and layout.
- **DP-61 — Missed clock-out** An attendance left without a clock-out becomes a missed clock-out 4 hours after its rostered end, which counts zero worked hours, refuses a late clock-out, never blocks a later clock-in and is listed on the home's Today until corrected, as qualified in Business rules.
- **DP-62 — Removed shifts are gone everywhere** Removing a rota assignment takes it off the rota, My shifts, Today counts, previews, clock-in matching and the hours of later leave requests, cancels any claimed cover behind it, and lets the same person be added again, as qualified in Business rules.
- **DP-63 — One claim per retry key** A cover claim carries an Idempotency-Key, so retries and concurrent duplicates with that key return the one stored success and the same key on a different request is refused, as qualified in Business rules.
- **DP-64 — Sick days return holiday** Rostered hours of annual leave that fall on days the requester is off sick go back into their balance, and the same balance shows on /api/me, My shifts and the submit check, as qualified in Business rules.
- **DP-65 — One open attendance per person** Of clock-ins or clock-outs sent at the same moment by one person with different Idempotency-Keys exactly one succeeds and the rest are refused with nothing written, so a person has at most one open attendance and a shift at most one attendance, as qualified in Business rules.
- **DP-66 — Only published fields are writable** Every JSON write endpoint accepts only the body keys published in API, and a body carrying any other key is refused with validation naming each such key while nothing is saved.
- **DP-67 — Renames reach every surface, history keeps its names** After a person changes their display name every live surface shows the new name on the next read and the picker matches only the new name, while audit entries, stored exports and already queued emails keep the name as it was written, as qualified in Business rules.
- **DP-68 — Today counts stay true** Today's per-shift on-duty and senior counts always equal the staffing preview's counts for the same shifts, and its totals and summary line equal their sums, after every change to sickness, leave, cover or the rota, as qualified in Business rules.
- **DP-69 — Safe email headers** Display names with line breaks or non-ASCII letters still produce emails with one clean, correctly encoded Subject, the stored address alone in To, and no stall for the messages behind them, as qualified in Services.

## Frontend

### Screens and layout (DP-06, DP-11, DP-17, DP-19, DP-23, DP-29, DP-37, DP-41, DP-44, DP-47, DP-50, DP-53, DP-60, DP-61, DP-64, DP-68)

Every signed-in screen shares one frame. A fixed rail on the left holds the brand, the role's main navigation and, for managers and HR admins, the homes and their units. The working area sits to its right. Opening a different screen never moves the rail or the column edges. The screens are:

| Path | Who | What it shows |
|---|---|---|
| `/sign-in` | everyone | Email and password form. |
| `/shifts` | care worker, bank carer | "My shifts": the Clock in or Clock out button, the clock-in currently open, the next 14 days of rostered shifts with their hours, and (for contracted staff) the holiday balance line. |
| `/leave/new` | care worker, unit manager | "Request leave" form. |
| `/leave` | care worker, unit manager | "My requests" list. Each item opens `/leave/<id>`, which shows the request's detail, its sick-day hours when there are any, and its Withdraw button. |
| `/sickness` | care worker | "Report sickness" form and a list of the worker's own sickness records. Each opens `/sickness/<id>` with the fit-note upload, the fit-note link and the return form. |
| `/rota` | care worker, unit manager, HR admin | "Team rota": one unit's week as a seven-day by three-shift table of names. Managers and HR admins also get add and remove controls. A Previous week / Next week pair pages through the weeks. |
| `/cover` | bank carer | "Open cover": the open cover shifts the bank carer can claim. |
| `/accrual` | bank carer | "Holiday accrual": the pending hours for the open period and the ledger table. |
| `/queue` | unit manager, HR admin | The approval queue in three columns: the rail, the request list with filters and counts, and the selected request's detail with the staffing strip. |
| `/today` | unit manager, HR admin | "Today": the summary line, on duty against floor for every unit and shift today, the late clock-ins waiting for acknowledgement, and the missed clock-outs of the last 7 days. |
| `/floors` | HR admin (managers read only) | "Floors and policy": the floor versions and leave-policy versions for each home, with the forms to add them. |
| `/attendance` | unit manager, HR admin | "Attendance": one day's attendance for a home, with Correct and Add attendance actions. `/attendance?home=<home id>&date=<YYYY-MM-DD>` opens that home and day directly. |
| `/pay-periods` | HR admin | Months with their closed or open state, and a Close button for each ended, unclosed month. |
| `/exports` | HR admin | The export form and earlier exports with Download buttons. |
| `/audit` | unit manager, HR admin | "Audit log" table, newest first. |
| `/profile` | everyone | Display name editor. |

**The queue (`/queue`).** At 1280x800 the rail takes about a sixth of the width. The request list takes about a third, with filters at the top and status counts under them. The detail fills the rest: requester, dates, type, hours and short-notice mark, then the staffing strip at full width, then the cover chip, then the action row (Previous 7 days, Next 7 days, Approve, Approve with override, Decline). The strip is one row of 21 cells, grouped by day with Early, Late and Night in that order. The floor is drawn as one unbroken line across all 21 cells. It steps up or down where the floor differs between shifts, so it reads as a single continuous rule.

At 768x1024 the rail becomes a top bar. It holds the main navigation and a wrapped row of home and unit links. The request list sits above the detail at full width, and the strip keeps its single row of 21 cells.

At 375x812 the rail collapses behind a "Homes and units" button that opens a drawer. The request list fills the screen. Selecting a request shows its detail in place of the list, with a Back to queue link. The strip becomes seven rows, one per day, each with three horizontal bars. Bar length stands in for height, and the floor line runs down through the rows as one stepped vertical line. Every accessible name stays the same in all three layouts.

**Today (`/today`).** The summary line sits directly above the Staffing today table. At 1280 the table fills the working area's width, with the Late clock-ins and Missed clock-outs lists side by side beneath it. At 768 and 375 the two lists stack under the table.

**Other screens.** At 1280 and 768, other screens use the working area as a single column of panels up to the full width. At 375 every table becomes a stacked list of cards with the same accessible names. No screen scrolls sideways at any of the three viewports.

### Public screens and controls (DP-02, DP-06, DP-11, DP-17, DP-19, DP-23, DP-28, DP-29, DP-35, DP-36, DP-37, DP-41, DP-44, DP-47, DP-50, DP-53, DP-61, DP-62, DP-63, DP-64, DP-65, DP-67, DP-68)

Only the roles and names below are public. Angle-bracket placeholders use the formats defined in Business rules. Every `<display name>` in an accessible name or visible copy is the person's current display name.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| all | `navigation "Main"` | Links for the role: My shifts, Request leave, My requests, Sickness, Team rota, Open cover, Holiday accrual, Queue, Today, Floors and policy, Attendance, Pay periods, Exports, Audit log, Profile (each role sees its own subset from the screens table). |
| all | `button "Sign out"` | "Sign out" |
| all (manager, HR) | `navigation "Homes and units"` | Each home name, then its unit names as links. |
| 375 only | `button "Homes and units"` | Opens the drawer that holds `navigation "Homes and units"`. |
| `/sign-in` | `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `status "Sign-in status"` | "Sign in to Tallow Cover" |
| `/shifts` | `button "Clock in"` or `button "Clock out"` | "Clock in" / "Clock out". Clock out shows while the API reports an open attendance, Clock in otherwise. |
| `/shifts` | `status "Clock status"` | Clock feedback copy |
| `/shifts` | `list "Upcoming shifts"` | Each item: "<shift label> · <HH:MM>–<HH:MM> · <hours> h" |
| `/shifts` | `region "Holiday"` | "<remaining> of <entitlement> hours left this leave year" (contracted staff only), where `<remaining>` is `remaining_hours` from `/api/me` |
| `/leave/new` | `form "Request leave"`; `combobox "Leave type"` (Annual leave, Unpaid leave, Compassionate leave); `textbox "First day"`; `textbox "Last day"`; `textbox "Note"`; `button "Save draft"`; `button "Submit request"`; `status "Leave status"` | |
| `/leave` | `list "My requests"` with links named "<type label>, <date> to <date>, <status label>" | A "Short notice" tag where it applies |
| `/leave/<id>` | `button "Withdraw request"`; for HR admins `button "Cancel leave"` opening `dialog "Cancel approved leave"` with `textbox "Reason"`, `button "Confirm cancellation"`, `button "Close"` | "<hours> hours booked" and, when `sickness_hours` is above zero, "<sickness hours> hours returned for sick days" |
| `/sickness` | `form "Report sickness"`; `textbox "First day off sick"`; `textbox "Reason"`; `button "Report sickness"`; `status "Sickness status"` | |
| `/sickness/<id>` | file input labelled "Fit note file"; `button "Upload fit note"`; `link "Open fit note"`; `textbox "Last day off sick"`; `button "I'm back at work"` | Status label: Reported, Fit note required, Evidenced, Closed |
| `/rota` | `table "Team rota"`; `button "Previous week"`; `button "Next week"`; for managers and HR `button "Add to <shift label>"` and `button "Remove <display name> from <shift label>"`; `dialog "Add to shift"` with `combobox "Colleague"`, `button "Add to shift"`, `button "Close"`; `status "Rota status"` | An absent colleague shows the word "away" after their name |
| `/cover` | `list "Open cover shifts"`; `button "Claim <shift label> at <home name>"` for each; `status "Cover status"` | Each item: home, unit, "<HH:MM>–<HH:MM>", skill "Senior" or "Carer" |
| `/accrual` | `region "Holiday accrual"`; `table "Accrual ledger"` (columns Period, Kind, Worked hours, Accrued hours) | "Pending this period: <accrual> hours from <hours> worked"; "Total accrued: <accrual> hours" |
| `/queue` | `group "Queue filters"` with `combobox "Home"`, `combobox "Status"` (Open, Submitted, Escalated, Cover pending, Approved, Declined, Withdrawn, Cancelled), `combobox "Week"` (All weeks, then ISO weeks) | |
| `/queue` | `region "Queue counts"` | "Submitted <n>", "Escalated <n>", "Cover pending <n>", "Approved <n>", "Declined <n>" |
| `/queue` | `listbox "Requests"` with one `option` per request, named "<display name>, <type label>, <date> to <date>, <status label>" | The empty-queue copy from Feedback states |
| `/queue` | `region "Request detail"` | Requester, dates, hours, "Short notice" tag, note |
| `/queue` | `button "Preview approval"` (pressed or not pressed) | "Preview approval" |
| `/queue` | `group "Staffing strip"`, containing 21 `group` cells (none for a request without a unit, as in Feedback states), each named by the strip cell name rule in Business rules | The cell's breach labels, by the Breach labels rule in Business rules |
| `/queue` | `button "Cover"` (the cover chip) | "Cover" |
| `/queue` | `button "Post cover for <shift label> (<skill>)"` (each ghost slot) | Empty dashed slot; after posting it reads "cover posted" |
| `/queue` | `button "Previous 7 days"`, `button "Next 7 days"` | |
| `/queue` | `button "Approve"`, `button "Approve with override"`, `button "Decline"` | |
| `/queue` | `dialog "Approve with override"` with `textbox "Override reason"`, `button "Confirm approval"`, `button "Close"` | Lists the breached shifts by short label |
| `/queue` | `dialog "Decline request"` with `textbox "Reason"`, `button "Confirm decline"`, `button "Close"` | |
| `/queue` | `status "Strip announcements"`, `status "Queue status"` | |
| `/today` | `heading "Today, <date>"`; the summary line directly above the table; `table "Staffing today"` (columns Unit, Shift, On duty, Floor, Seniors, Status); `list "Late clock-ins"` with `button "Acknowledge <display name>"`; `list "Missed clock-outs"` whose items read "<display name>, <shift label>", each with `link "Correct <display name> <shift label>"`; `status "Today status"` | Summary line: "<on duty> on duty · <below floor> shifts below floor", where the numbers are `totals.on_duty` and `totals.below_floor` (the word "shifts" is used for every number, including 1). Status cell: the Today status text from Breach labels in Business rules |
| `/floors` | `table "Floor versions"`; `form "New floor version"` with `combobox "Unit"`, `combobox "Shift"`, `spinbutton "Minimum staff"`, `spinbutton "Minimum seniors"`, `textbox "Effective from"`, `button "Save floor version"`; `table "Leave policy versions"`; `form "New leave policy"` with `spinbutton "Notice multiplier"`, `textbox "Effective from"`, `button "Save leave policy"`; `status "Admin status"` | |
| `/attendance` | `table "Attendance"`; `button "Correct <display name> <shift label>"` opening `dialog "Correct attendance"` with `textbox "Clock in"`, `textbox "Clock out"`, `textbox "Reason"`, `button "Save correction"`, `button "Close"`; `button "Add attendance for <display name> <shift label>"` opening the same dialog titled `dialog "Add attendance"`; `status "Admin status"` | A missed clock-out row shows "Missed clock-out" in its clock-out cell |
| `/pay-periods` | `button "Close <Month YYYY>"`; `status "Admin status"` | |
| `/exports` | `form "Export timesheets"` with `textbox "Pay period"`, `group "Homes"` of checkboxes named by home, `button "Export timesheets"`; `list "Exports"` with `button "Download <period> export"`; `status "Admin status"` | |
| `/audit` | `table "Audit log"` (columns When, Who, Action, Target, Before, After, Reason) | Who shows the actor's name as it was when the entry was written |
| `/profile` | `textbox "Display name"`, `button "Save name"`, `status "Profile status"` | |

### Interactions (DP-08, DP-28, DP-29, DP-33, DP-35, DP-41, DP-47, DP-48, DP-61, DP-62, DP-63, DP-65, DP-67, DP-68)

- **Clock in and out.** Pressing Clock in or Clock out disables the button straight away and sends one punch with a fresh Idempotency-Key. If the network fails, retries reuse that key. The button comes back only when the response arrives, reading Clock out after a clock-in and Clock in after a clock-out. A second tap while the first is pending does nothing. My shifts fetches again on opening, after each punch and every 60 seconds. A shift that becomes a missed clock-out therefore switches the button back to Clock in within 60 seconds. A second device whose own clock-in is refused because the person is already clocked in shows the API message in `status "Clock status"` and then switches its button to Clock out after it fetches again.
- **Claim cover.** Pressing a Claim button disables it straight away and sends one claim with a fresh Idempotency-Key. Network retries reuse that key, and a second press while the claim is pending does nothing. On success the item leaves the list. On an `already_taken` or `cover_closed` answer the item also leaves `list "Open cover shifts"`, and `status "Cover status"` shows the API message.
- **Queue list.** The `listbox "Requests"` is one Tab stop. Arrow Up and Arrow Down move the selection, Home and End jump to the first and last request, and each move loads that request's detail and updates the address. Clicking or tapping an option selects it.
- **Tab order on the queue.** The order is: rail, filters, counts, request list, Preview approval, staffing strip, Cover chip, each ghost slot from left to right, Previous 7 days, Next 7 days, Approve, Approve with override, Decline.
- **Inspecting the strip.** The `group "Staffing strip"` is one Tab stop. Arrow Left and Arrow Right move focus between the 21 cells, and each cell's accessible name reads its counts.
- **Preview approval.** Space or Enter on Preview approval toggles it. The strip changes as described in Motion and effects.
- **Posting cover.** With the pointer, drag the Cover chip onto a ghost slot. Releasing it there posts cover for that gap, and releasing it anywhere else sends the chip back to its place. With the keyboard or by touch, press Enter or Space on a ghost slot button, or tap it. The ghost slot itself is the keyboard drop target, and pressing it posts the same cover as a drop.
- **Approve and decline.** Approve with override and Decline open their dialogs. Focus moves to the dialog's text box and stays trapped inside the dialog while it is open. Escape or Close shuts the dialog and returns focus to the button that opened it. Enter on the confirm button submits.
- **Queue refresh.** While a request is selected, the detail fetches the preview again every 5 seconds and after each action. A claim by a bank carer, or the removal of a claimed cover's shift, therefore shows in the strip within 5 seconds.
- **Today refresh.** Today fetches again on opening, after each acknowledgement and every 30 seconds. A change made elsewhere (sickness, leave, cover, rota, a rename) therefore shows in its counts, summary line and lists within 30 seconds. An attendance that has just become a missed clock-out appears in its list within 30 seconds. Following a missed clock-out's Correct link opens Attendance for that home and the shift's date.
- **Rota.** Add to shift opens its dialog. Typing in the Colleague combobox searches the people picker, and Arrow Down / Arrow Up then Enter chooses a colleague. The dialog follows the same focus and Escape rules as the queue dialogs. Pressing a Remove button removes that assignment at once, and the table redraws without it. The rota fetches again on opening, on paging and after each add or remove, so a colleague's new name shows on the next fetch.
- **Attendance.** Correct and Add attendance dialogs follow the same focus rules. Clock in and Clock out are entered as local date and time. The browser sends them with the Europe/London offset that applies at that moment. Clock out may be left empty. The Correct dialog sends the version of the record the table last fetched. When the save is refused because the record has changed, the dialog stays open, its fields refill from the record returned with the refusal, and `status "Admin status"` shows the API message.
- **Hover and press.** Buttons and links take a slightly deeper tone on hover and a deeper one on press. Every focusable control shows a visible two-tone focus ring.

### Visual design (DP-32, DP-59)

- **Ground and ink.** The page is a warm, candle-wax off-white, never pure white. Text is a near-black blue-grey ink.
- **Colour roles.** A deep sea-teal draws the floor line, primary buttons and focus rings. A rust red is kept for breached shifts and always comes with hatching and a text label. A muted old-gold marks posted cover and filled ghost slots. Bars are ink at reduced strength, and changed bars take full ink.
- **Rules and numbers.** Panels and table rows are divided by hairline one-pixel rules, not shadows or cards. Every count, time and hour value uses equal-width figures so columns line up.
- **Type.** Fraunces, a soft high-contrast serif, is used for screen titles and the requester name in the queue detail. IBM Plex Sans is used for everything else. Each step up the heading scale is about one fifth larger than the step below. Body text sits at a comfortable reading size, and nothing on screen is smaller than three quarters of the body size. Both typefaces are served by the app itself.
- **Density.** The layout is compact. Queue rows are single lines with tight vertical spacing, and the strip's 21 cells sit edge to edge, separated by hairline rules.
- **Composition.** The fixed rail, the dense middle queue and the wide strip are laid out as above. The floor line is the strongest line on the screen.
- **Targets and contrast.** Every interactive control is at least 44 by 44 pixels, and so are ghost slots and strip cells at 375. Where the strip keeps its single row of 21 cells (768 and wider), its cells and their ghost slots are at least 24 by 24 pixels, the WCAG 2.2 AA minimum. Text and control contrast meets WCAG 2.2 AA. Breach labels are set in ink on the light ground, never in red text.

### Motion and effects (DP-33, DP-34)

Motion explains staffing changes. It never decorates. Every movement starts quickly and settles softly.

- **Selecting a request.** Bars move from their previous heights to the new request's heights in about a third of a second, all together.
- **Preview on (the Floor drop).** Only the cells where the requester is rostered and not already away move. Each lowers by exactly one unit over about a third of a second (320 milliseconds). They start from left to right, each 40 milliseconds after the one before. Once a bar that ends below the floor line has landed, its hatching, its breach labels and its dashed ghost slots fade in over about a fifth of a second (220 milliseconds).
- **Preview off.** The change reverses step by step. Labels, hatching and ghost slots fade out over about a fifth of a second. Then the moved bars rise one unit each from right to left, with the same 40-millisecond stagger and the same duration.
- **Cover posted.** The ghost slot fills with old-gold and its text changes to "cover posted" over about a fifth of a second.
- **Cover claimed.** On the next refresh the bar rises by one unit over about a third of a second, and the hatching and label fade out if the shift is no longer below floor. When a claimed cover is cancelled, the bar falls back by one unit in the same way and its dashed ghost slot fades back in.
- **Feedback.** Buttons change tone on hover and press within about a fifth of a second. Dialogs fade and rise slightly into place in about a fifth of a second, and fade out in the same time.
- **No loops.** Nothing animates continuously. There are no spinners, shimmer or pulsing, and pending states are shown with text.
- **Reduced motion.** When the operating system asks for reduced motion, every bar snaps to its final height with no stagger and no duration. Each changed cell shows a before-to-after numeral pair such as "4 → 3", and the preview-off reversal removes the pair. Fades become instant changes. The Strip announcements live region speaks in every motion setting.

### Feedback states (DP-06, DP-11, DP-19, DP-23, DP-27, DP-28, DP-32, DP-35, DP-37, DP-41, DP-44, DP-47, DP-53, DP-58, DP-61, DP-63, DP-65)

Every async action shows a pending message while in flight, then a success or error message, in the named live region. Field errors appear beside the field, showing the API's field message, and the region also announces them. When a request cannot reach the server at all, the region shows "Couldn't reach Tallow. Check your connection and try again." Every success message below stays true when an email is only queued or a file is only held for storage.

| Action | Live region | Pending | Success | Errors |
|---|---|---|---|---|
| Sign in | Sign-in status | "Signing in…" | navigates to the role's first screen | API message |
| Clock in | Clock status | "Clocking in…" | "Clocked in at <HH:MM> for <shift label>." or, when late, "Clocked in at <HH:MM>, <m> minutes late. Your manager will be asked to acknowledge it." | API message |
| Clock out | Clock status | "Clocking out…" | "Clocked out at <HH:MM>. You worked <hours> hours." | API message |
| Save draft | Leave status | "Saving draft…" | "Draft saved." | field messages |
| Submit request | Leave status | "Submitting…" | "Request sent to <home name>." or, when short notice, "Request sent to <home name>. It's inside the notice period, so it's marked short notice." | field messages or API message |
| Withdraw request | Leave status | "Withdrawing…" | "Request withdrawn." | API message |
| Report sickness | Sickness status | "Reporting…" | "Sickness reported. Get well soon." or, when a fit note is already required, "Sickness reported. Please upload a fit note — you've been off more than 7 days." | field messages |
| Upload fit note | Sickness status | "Uploading fit note…" | "Fit note received. It is being stored securely." | for a file that is too large: "Fit notes can be up to 5,000,000 bytes."; otherwise API message |
| Open fit note or download export | Sickness status / Admin status | "Opening…" | the browser downloads the file under its published file name | API message |
| I'm back at work | Sickness status | "Saving…" | "Welcome back. Sickness record closed." | API message |
| Approve or override | Queue status | "Approving…" | "Approved. <display name> will be emailed the decision." | "Can't approve: <API message>" (the strip refreshes) |
| Decline | Queue status | "Declining…" | "Declined. <display name> will be emailed the decision." | field message |
| Cancel approved leave | Leave status | "Cancelling…" | "Leave cancelled. <display name> will be emailed." | field message |
| Post cover | Queue status | "Posting cover…" | "Cover posted for <shift label>. Eligible bank carers will be emailed." | API message |
| Claim cover | Cover status | "Claiming…" | "Shift claimed: <shift label> at <home name>." (shown once per claim, including after retries) | API message |
| Add to shift / remove | Rota status | "Saving…" | "<display name> added to <shift label>." / "<display name> removed from <shift label>." | API message |
| Acknowledge late | Today status | "Saving…" | "Acknowledged." | API message |
| Save floor version / leave policy | Admin status | "Saving…" | "Floor version saved. It applies from <date>." / "Leave policy saved. It applies from <date>." | field messages |
| Correct or add attendance | Admin status | "Saving correction…" | "Attendance corrected." / "Attendance added." | field messages or API message |
| Close pay period | Admin status | "Closing <Month YYYY>…" | "<Month YYYY> closed. <n> ledger entries added." | API message |
| Export timesheets | Admin status | "Preparing export…" | "Timesheet export created: <rows> rows." | field messages |
| Save name | Profile status | "Saving…" | "Name updated." | field message |

**Strip announcements.** Each time Preview approval is turned on, and on each refresh that changes the result while it is on, the `status "Strip announcements"` region announces one message:

- for one shift: "Approving would leave <n> shift below floor: <short labels>";
- for more than one: "Approving would leave <n> shifts below floor: <short labels>", with the short labels joined by ", " in strip order, for example "Approving would leave 2 shifts below floor: Tue Night, Thu Late";
- when nothing breaches: "Approving keeps every shift at or above its floor."

**Requests without a unit.** When the selected request has no unit, the `group "Staffing strip"` holds no cells and shows "<display name> isn't on a unit rota, so approving changes no shift." Preview approval is disabled, and the Strip announcements region stays silent.

**Breach and button states.** Status is never shown by colour alone. A breached cell, in the strip or in Staffing today, always shows hatching and its breach labels as defined in Business rules. Approve is disabled, with an accessible description of "Cover every gap or approve with override", whenever the preview says the request cannot be approved. Approve with override is enabled only while at least one breach exists.

**Keyboard completeness.** Every queue action named in DP-28 can be done with the keyboard alone, using the interactions above, and none of them needs a pointer.

**View state in the address.** The queue's home, status and week filters and the selected request are carried in the address as `/queue?home=<home id>&status=<status filter>&week=<ISO week or empty>&request=<request id>`. Changing a filter or the selection adds a history entry. Back and Forward restore the earlier filters and selection, and opening a copied address shows the same view.

**Empty states.**

- An empty queue shows "No requests match these filters."
- An empty open-cover list shows "No open cover shifts right now."
- An empty ledger shows "No closed pay periods yet."
- An empty late list shows "No late clock-ins waiting."
- An empty missed list shows "No missed clock-outs in the last 7 days."

## Backend

### API (DP-01, DP-02, DP-03, DP-07, DP-08, DP-12, DP-16, DP-18, DP-21, DP-22, DP-24, DP-25, DP-26, DP-30, DP-35, DP-38, DP-39, DP-43, DP-46, DP-48, DP-49, DP-51, DP-55, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-68)

All endpoints sit under `/api` and exchange JSON in UTF-8. Requests with a body send `Content-Type: application/json`, except the fit-note upload, which is `multipart/form-data`. Dates are `YYYY-MM-DD`. Instants are ISO 8601 with a UTC offset and are returned at the Europe/London offset in force. Hour values are decimal strings. Ids are strings.

**Error body.** Every error is `{"error":"<code>","message":"<text>"}`. A validation error adds `"errors":{"<field>":"<message>"}`, and a few codes add the extra fields listed below.

**Published body keys.** Every JSON write endpoint accepts exactly the body keys shown in its Request cell in the Endpoints table, and an endpoint shown with `{}` accepts none. A body that carries any other key is refused with `validation`. Its `errors` object holds one entry per unknown key, named by that key and reading "This field can't be set.", together with any other field errors in the same body. Nothing is created or changed. For example, a care worker's `POST /api/leave-requests` that also carries `status`, `hours`, `short_notice`, `requester`, `unit_id` or `sickness_hours` creates no request, and `PATCH /api/me {"display_name":"P","role":"hr_admin"}` changes neither the name nor the role. Because validation is judged last, a `PATCH` on a submitted request answers `invalid_transition` even when its body also carries an unknown key.

**Error precedence.** The server checks errors in this order and returns the first that applies:

1. transport checks (`cross_origin`, `too_large`, `unsupported_media_type`);
2. `not_signed_in`;
3. idempotency on keyed endpoints: a replay returns its stored response, and a key already bound to a different request answers `idempotency_key_reused` (Business rules);
4. `not_found` for an unknown id, an id in a home the caller cannot see, or a record that belongs to someone else and is not visible to the caller's role;
5. `forbidden` and the other 403 codes;
6. precondition codes (`version_required`, `stale_version`);
7. state conflicts (409);
8. validation (`validation`, `unsupported_file`).

| Code | Status | Message |
|---|---|---|
| `not_signed_in` | 401 | "Sign in to continue." |
| `invalid_credentials` | 401 | "That email and password don't match." |
| `forbidden` | 403 | "You don't have permission to do that." |
| `own_request` | 403 | "You can't decide your own leave request." |
| `skill_required` | 403 | "This cover shift needs a senior." |
| `cross_origin` | 403 | "Cross-origin requests are refused." |
| `not_found` | 404 | "Not found." |
| `method_not_allowed` | 405 | "This record can't be changed." |
| `invalid_transition` | 409 | "This request is <status label> and can't be <action>." Adds `"status":"<current status>"`. `<action>` is one of: submitted, edited, approved, declined, withdrawn, cancelled, given cover. |
| `floor_breach` | 409 | "Approving would leave <n> shift(s) below floor." Adds `"breaches":[{"date","shift","label","on_duty","on_duty_if_approved","min_staff","seniors_on_duty","seniors_if_approved","min_seniors"}]`, with counts computed when the request was refused. |
| `already_taken` | 409 | "This shift has already been taken." |
| `cover_closed` | 409 | "This cover shift is no longer open." |
| `no_open_gap` | 409 | "That shift has no uncovered gap for this skill." |
| `no_rostered_shift` | 409 | "You have no rostered shift to clock in to right now." |
| `already_clocked_in` | 409 | "You're already clocked in." |
| `no_open_clock_in` | 409 | "You're not clocked in." |
| `clock_out_window_closed` | 409 | "Your shift ended more than 4 hours ago. Ask your manager to add your clock-out." |
| `not_late` | 409 | "This clock-in wasn't late." |
| `overlapping_shift` | 409 | "That overlaps another shift for this person." |
| `overlaps_existing_leave` | 409 | "You already have leave or a request covering these dates." |
| `already_started` | 409 | "This leave has already started. Ask HR to cancel it." |
| `fit_note_missing` | 409 | "Upload a fit note before closing this sickness record." |
| `attendance_exists` | 409 | "This shift already has attendance." |
| `has_attendance` | 409 | "This shift has attendance and can't be removed." |
| `version_exists` | 409 | "A version already starts on that date." |
| `period_closed` | 409 | "This pay period is already closed." |
| `period_not_ended` | 409 | "This pay period hasn't ended yet." |
| `idempotency_key_reused` | 409 | "This Idempotency-Key was used for a different request." |
| `storage_pending` | 409 | "Still storing this file. Try again in a minute." |
| `stale_version` | 412 | "Someone changed this record. Reload and try again." Adds `"current":<attendance>`, the record as it stands when the request is refused. |
| `too_large` | 413 | "That's too large to send." |
| `unsupported_media_type` | 415 | "Send JSON." |
| `unsupported_file` | 415 | "Upload a PDF, JPEG or PNG of your fit note." Uses `"errors":{"file":...}` with this same message. |
| `version_required` | 428 | "Send the record's version in If-Match." |
| `validation` | 422 | "Check the highlighted fields." |

Validation messages, by field:

- any key not published for the endpoint: "This field can't be set."
- `type`: "Choose annual, unpaid or compassionate leave."
- `start_date` (leave): "Leave can't start in the past."
- `end_date`: one of "The last day can't be before the first day.", "Leave can be at most 28 days.", "Leave can't cross 31 March. Split it into two requests.", "This needs <hours> hours but you have <hours> hours left."
- `note`: "Keep the note to 500 characters or fewer."
- `reason`: "Give a reason of 1 to 500 characters."
- `override_reason`: same message as `reason`.
- `start_date` (sickness): "Sickness can start up to 28 days ago and not in the future."
- `last_sick_date`: "The last day off sick must be between the first day and today."
- `display_name`: "Use 1 to 60 characters."
- `min_staff`: "Use a whole number from 0 to 30."
- `min_seniors`: "Use a whole number no larger than the minimum staff."
- `effective_from`: "Choose a date after today."
- `notice_multiplier`: "Use a whole number from 0 to 6."
- `clock_in_at` / `clock_out_at`: one of "Use a full date and time with a UTC offset.", "Clock out must be after clock in.", "Clock in must be within 4 hours of the rostered start."
- `period`: "Use a month like 2026-09."
- `status` (queue): "Choose a queue status."
- `person_id`: "Only care workers and bank carers can be rostered."
- `home_ids`: "Choose at least one home." or "Unknown home."
- `Idempotency-Key`: "Send an Idempotency-Key of 1 to 100 characters."
- `from`: "Choose a date inside this request."

**Projections.** Each role receives exactly the fields listed below and no others. No response ever carries a password hash, a session id, another person's email, or any field not listed.

- `person` (embedded): `{"id","display_name"}`, where `display_name` is the current name, except inside audit entries (Business rules).
- `me`: `{"id","email","display_name","role","home_id","unit_id","skill","credentialed_home_ids","holiday"}`.
  - `role` is `care_worker`, `bank_carer`, `unit_manager` or `hr_admin`. `skill` is `senior` or `carer`.
  - `home_id` and `unit_id` are null where they do not apply. `credentialed_home_ids` is empty except for bank carers.
  - `holiday` is `{"leave_year_start","entitlement_hours","booked_hours","remaining_hours"}` for contracted staff and null for bank carers and HR admins.
- `rota entry` for a care worker or bank carer: `{"assignment_id","person","date","shift","starts_at","ends_at","hours","status","is_you"}`, where `status` is `on` or `away`. A unit manager or HR admin also receives `"absence_kind"`: `annual`, `unpaid`, `compassionate`, `sickness` or null. No role receives a sickness reason, leave note or balance in a rota entry.
- `leave request`: `{"id","requester","home_id","unit_id","type","start_date","end_date","length_days","hours","sickness_hours","note","status","short_notice","submitted_at","decided_at","decided_by","decision_reason"}`.
- `sickness` for the owner or an HR admin: `{"id","person","start_date","last_sick_date","status","reason","days","fit_note"}`. `fit_note` is null or `{"uploaded_at","file_name","storage"}`, where `storage` is `stored` or `pending`. A unit manager of the home receives the same without `reason` and `fit_note`.
- `cover` for a bank carer: `{"id","home":{"id","name"},"unit":{"id","name"},"date","shift","starts_at","ends_at","hours","skill","status"}`. A unit manager or HR admin also receives `"leave_request_id"` and `"claimed_by"` (a person, or null). `status` is `open`, `claimed` or `cancelled`.
- `attendance`: `{"id","person","home_id","unit_id","assignment_id","date","shift","rostered_start","rostered_end","clock_in_at","clock_out_at","worked_hours","missed_clock_out","late","late_acknowledged","correction_note","version"}`. `worked_hours` is null while `clock_out_at` is null. `version` is a whole number.
- `export`: `{"id","period","home_ids","row_count","storage","created_at"}`, where `storage` is `stored` or `pending`.
- `audit entry`: `{"id","at","actor":{"id","display_name","role"},"action","home_id","target":{"type","id"},"before","after","reason"}`.
  - `action` is one of the six audited actions in Business rules.
  - `target.type` is `attendance`, `leave_request`, `floor_version` or `policy_version`, and `target.id` is that record's id.
  - `before` and `after` are JSON objects holding the changed record as it was and as it became, in that record's own projection (the `floor_override` entry holds the request before and after approval, and its `after` also carries the `breach_labels` that were overridden). `before` is null for additions.
  - `reason` is the given reason text, or null for version additions.

**Endpoints.** Roles are written CW (care worker), BC (bank carer), UM (unit manager) and HR (group HR admin). An unlisted role gets `forbidden`.

| Method and path | Roles | Request | Success | Endpoint-specific errors |
|---|---|---|---|---|
| `GET /api/health` | none | | `200 {"status":"ok","mail":"up"\|"down","storage":"up"\|"down"}` | |
| `POST /api/session` | none | `{"email","password"}` | `200 {"user":<me>}` and sets the session cookie | `invalid_credentials` |
| `DELETE /api/session` | any | | `204` | |
| `GET /api/me` | any | | `200 <me>` | |
| `PATCH /api/me` | any | `{"display_name"}` (1 to 60 characters, any characters allowed) | `200 <me>` | `validation` |
| `GET /api/me/shifts` | CW, BC, UM | | `200 {"assignments":[<rota entry>],"open_attendance":<attendance>\|null,"holiday":<me holiday>\|null}`. Assignments run from any shift still in progress through the next 14 days. `open_attendance` is the caller's open attendance as defined in Business rules. | |
| `POST /api/punches` | CW, BC | header `Idempotency-Key`; body `{"kind":"in"\|"out"}` | `201 {"punch":{"id","kind","at"},"attendance":<attendance>}` | `no_rostered_shift`, `already_clocked_in`, `no_open_clock_in`, `clock_out_window_closed`, `validation` |
| `GET /api/me/leave-requests` | CW, UM | | `200 {"items":[<leave request>]}` | |
| `POST /api/leave-requests` | CW, UM | `{"type","start_date","end_date","note"?,"submit"?:bool}` | `201 <leave request>` as `draft`, or as `submitted` when `submit` is true | `overlaps_existing_leave`, `validation` |
| `PATCH /api/leave-requests/{id}` | owner | any of `type`, `start_date`, `end_date`, `note` | `200 <leave request>` | `invalid_transition`, `validation` |
| `GET /api/leave-requests/{id}` | owner, UM of home, HR | | `200 <leave request>` | |
| `POST /api/leave-requests/{id}/submit` | owner | `{}` | `200 <leave request>` | `invalid_transition`, `overlaps_existing_leave`, `validation` |
| `POST /api/leave-requests/{id}/withdraw` | owner | `{}` | `200 <leave request>` | `invalid_transition`, `already_started` |
| `POST /api/leave-requests/{id}/approve` | UM of home, HR | `{"override_reason"?}` | `200 <leave request>` | `own_request`, `invalid_transition`, `floor_breach`, `validation` |
| `POST /api/leave-requests/{id}/decline` | UM of home, HR | `{"reason"}` | `200 <leave request>` | `own_request`, `invalid_transition`, `validation` |
| `POST /api/leave-requests/{id}/cancel` | HR | `{"reason"}` | `200 <leave request>` | `invalid_transition`, `validation` |
| `GET /api/leave-requests/{id}/preview?from=<date>` | UM of home, HR | `from` defaults to the request's start date | `200` preview body (Business rules) | `validation` |
| `POST /api/leave-requests/{id}/covers` | UM of home, HR | `{"date","shift","skill"}` | `201 <cover>` | `own_request`, `invalid_transition`, `no_open_gap` |
| `GET /api/queue?home=<id>&status=<filter>&week=<YYYY-Www>` | UM, HR | `status` is a queue status filter as defined in Business rules; `week` is optional | `200 {"home_id","counts":{"submitted","escalated","cover_pending","approved","declined"},"items":[<leave request>]}` | `validation` |
| `GET /api/units/{unit_id}/rota?from=<date>` | CW and UM in that home, HR | `from` defaults to the Monday of the current week | `200 {"unit_id","from","to","entries":[<rota entry>]}` covering 7 days | |
| `POST /api/rota/assignments` | UM of home, HR | `{"person_id","unit_id","date","shift"}` | `201 <rota entry>` with a new `assignment_id` | `overlapping_shift`, `validation` |
| `DELETE /api/rota/assignments/{id}` | UM of home, HR | | `204` | `has_attendance` |
| `GET /api/homes/{home_id}/people?q=<text>` | UM of home, HR | | `200 {"items":[{"id","display_name","role","skill"}]}`, at most 20, ordered by current display name | |
| `GET /api/homes/{home_id}/today` | UM of home, HR | | `200 {"date","units":[{"unit_id","name","shifts":[{"shift","on_duty","seniors_on_duty","floor":{"min_staff","min_seniors"},"shortfall","senior_shortfall"}]}],"totals":{"on_duty","seniors_on_duty","below_floor"},"late_clock_ins":[<attendance>],"missed_clock_outs":[<attendance>]}` | |
| `GET /api/homes/{home_id}/attendance?date=<date>` | UM of home, HR | | `200 {"items":[<attendance>]}` | |
| `GET /api/me/attendance` | CW, BC | | `200 {"items":[<attendance>]}`, own records only | |
| `POST /api/attendance` | UM of home, HR | `{"assignment_id","clock_in_at","clock_out_at"\|null,"reason"}` | `201 <attendance>` | `attendance_exists`, `validation` |
| `PATCH /api/attendance/{id}` | UM of home, HR | header `If-Match: "<version>"`; body `{"clock_in_at","clock_out_at"\|null,"reason"}` | `200 <attendance>` with `version` one higher | `version_required`, `stale_version`, `validation` |
| `POST /api/attendance/{id}/acknowledge` | UM of home, HR | `{}` | `200 <attendance>` with `version` one higher | `not_late` |
| `GET /api/homes/{home_id}/floors` | UM of home, HR | | `200 {"versions":[{"id","unit_id","shift","min_staff","min_seniors","effective_from","created_by","created_at"}]}` | |
| `POST /api/homes/{home_id}/floors` | HR | `{"unit_id","shift","min_staff","min_seniors","effective_from"}` | `201` version | `version_exists`, `validation` |
| `GET /api/homes/{home_id}/leave-policy` | UM of home, HR | | `200 {"versions":[{"id","notice_multiplier","effective_from","created_by","created_at"}]}` | |
| `POST /api/homes/{home_id}/leave-policy` | HR | `{"notice_multiplier","effective_from"}` | `201` version | `version_exists`, `validation` |
| `GET /api/cover-shifts` | BC | | `200 {"items":[<cover>]}`: open covers the caller may claim | |
| `POST /api/cover-shifts/{id}/claim` | BC | header `Idempotency-Key`; body `{}` | `200 {"cover":<cover>,"assignment":<rota entry>}` | `skill_required`, `already_taken`, `cover_closed`, `overlapping_shift`, `validation` |
| `GET /api/me/sickness` | CW | | `200 {"items":[<sickness>]}` | |
| `POST /api/sickness` | CW | `{"start_date","reason"}` (reason 1 to 500 characters) | `201 <sickness>` | `validation` |
| `GET /api/sickness/{id}` | owner, UM of home, HR | | `200 <sickness>` | |
| `POST /api/sickness/{id}/fit-note` | owner | multipart, field `file` | `201 <sickness>` | `invalid_transition`, `too_large`, `unsupported_file` |
| `GET /api/sickness/{id}/fit-note` | owner, HR | | `200 {"url","expires_in_seconds":60}` | `storage_pending` |
| `POST /api/sickness/{id}/return` | owner | `{"last_sick_date"}` | `200 <sickness>` | `invalid_transition`, `fit_note_missing`, `validation` |
| `GET /api/me/accrual` | BC | | `200 {"entries":[{"id","period","kind","worked_hours","accrued_hours","created_at"}],"ledger_total_hours","open_period":{"period","worked_hours","pending_accrual_hours"}}` | |
| `POST /api/pay-periods/{YYYY-MM}/close` | HR | `{}` | `201 {"period","closed_at","entries":[...]}` | `period_closed`, `period_not_ended`, `validation` |
| `GET /api/pay-periods` | HR | | `200 {"items":[{"period","closed_at"\|null}]}` | |
| `POST /api/exports/timesheets` | HR | `{"period","home_ids":[...]}` | `201 <export>` | `validation` |
| `GET /api/exports` | HR | | `200 {"items":[<export>]}` | |
| `GET /api/exports/{id}/download` | HR | | `200 {"url","expires_in_seconds":60}` | `storage_pending` |
| `GET /api/audit?home=<id>` | UM (own home), HR | | `200 {"items":[<audit entry>]}`, newest first | |
| `PUT`, `PATCH`, `DELETE` on `/api/audit` or `/api/audit/{id}` | any | | always `method_not_allowed` | |

Any API call other than `GET /api/health` and `POST /api/session` without a valid session answers `not_signed_in`. Sessions last `SESSION_TTL_SECONDS`, which defaults to 43,200 seconds. The session cookie is named `tallow_session` and is `HttpOnly`, `SameSite=Lax` and `Path=/`.

### Business rules (DP-07, DP-08, DP-09, DP-10, DP-12, DP-13, DP-14, DP-15, DP-16, DP-18, DP-20, DP-24, DP-25, DP-26, DP-30, DP-31, DP-32, DP-35, DP-36, DP-38, DP-39, DP-40, DP-42, DP-43, DP-45, DP-48, DP-49, DP-51, DP-52, DP-54, DP-56, DP-57, DP-61, DP-62, DP-63, DP-64, DP-65, DP-67, DP-68)

**Formats.**

- `<date>` is written like "Tue 3 Nov 2026".
- `<shift label>` is "Tue 3 Nov Night", and `<short label>` is "Tue Night".
- `<HH:MM>` is the 24-hour Europe/London time.
- `<Month YYYY>` is "September 2026".
- `<hours>` and `<sickness hours>` are decimals with two places, and `<accrual>` is a decimal with four places.
- `<N>` in "-<N> below floor" is the shift's `shortfall` as a whole number, as qualified in Breach labels.
- `<display name>` is the person's current display name, as qualified in Display names and history.
- `<type label>` is Annual leave, Unpaid leave or Compassionate leave.
- `<status label>` is Draft, Submitted, Escalated, Cover pending, Approved, Declined, Withdrawn or Cancelled.

**Display names and history.** Anyone can change their own display name with `PATCH /api/me`. From the next read after the change, every live surface shows the new name:

- rota entries' `person.display_name` and the Remove buttons named from it;
- the people picker's results, matching and order: a query matches the new name and no longer matches the old one;
- queue option names and every leave request's `requester` and `decided_by`;
- covers' `claimed_by`, attendance `person`, and Today's lists;
- emails queued after the change;
- the CSV of any export created after the change.

History keeps the name as it was when it was written, and never changes afterwards:

- an audit entry's `actor.display_name` and every name inside its `before` and `after`;
- exports already created, whether stored or still pending;
- emails already queued or sent, including ones still waiting in the outbox during a mail outage.

**Business time.** The business time zone is Europe/London for every home. "Today" always means the current Europe/London date, whatever the server's or browser's time zone. This covers the Today dashboard, the default rota week, the notice count, leave start checks, sickness day counts, the missed clock-out window on Today, "after today" floor and policy dates, and the closing of pay periods.

**Shifts and hours.** Every unit runs three shifts in Europe/London wall-clock time:

- Early: 07:00 to 15:00.
- Late: 15:00 to 22:00.
- Night: 22:00 to 08:00 the next day.

In JSON request bodies, query values and responses a shift is written `early`, `late` or `night`. In the timesheet CSV's `shift` column it is written `Early`, `Late` or `Night`. A shift's date is the date it starts. Its hours are the real elapsed time between start and end, so wall-clock times keep their place and the duration follows the clock change.

- A Night that starts on the Saturday before the last Sunday in October lasts 11 hours, for example 22:00 on Sat 24 Oct 2026 to 08:00 on Sun 25 Oct 2026.
- A Night that starts on the Saturday before the last Sunday in March lasts 9 hours, for example 22:00 on Sat 27 Mar 2027 to 08:00 on Sun 28 Mar 2027.
- Shift boundaries never fall inside the skipped or repeated hour. Corrected times must carry a UTC offset, so a repeated 01:30 is never ambiguous.
- Worked hours are the real elapsed time from clock-in to clock-out.

**Rota assignments.** Only care workers and bank carers can hold rota assignments. Assigning anyone else is refused with `validation` on `person_id`. A person cannot hold two assignments with overlapping times; a second one is refused with `overlapping_shift`. A claimed cover shift is a rota assignment. Every add creates an assignment with a new `assignment_id`.

Removing an assignment (`DELETE`, 204) deletes it for good. From that moment it is:

- in no rota response for any role, not even as away;
- missing from the person's `/api/me/shifts`;
- not counted in Today's `on_duty` or `seniors_on_duty`, or in any preview's counts;
- not matched by clock-in, so the person gets `no_rostered_shift` for its window unless another assignment matches;
- not counted in the `hours` of any leave request saved or submitted afterwards.

A second `DELETE` of the same id answers `not_found`. Adding the same person to the same unit, date and shift again succeeds with 201 and a new `assignment_id`. Removing an assignment that has attendance is refused with `has_attendance`.

When the removed assignment came from a cover claim, that cover becomes `cancelled` in the same transaction. `claimed_by` keeps the bank carer who claimed it, and bank carers no longer see it in `GET /api/cover-shifts`. A new claim on it answers `cover_closed`. The preview gap it filled shows `cover: null` again and counts in `uncovered_breaches` again, so the manager can post a fresh cover for that gap.

**On duty.** For a unit, date and shift, `on_duty` counts the people with a rota assignment there, minus anyone away. `seniors_on_duty` counts the same people who have skill `senior`. An open cover that nobody has claimed is not a person and never counts. A person is away on a shift when either of these covers the shift's date:

- an approved leave request whose dates include it (withdrawn, cancelled, declined and still-undecided requests never make anyone away);
- a sickness record whose dates include it. A sickness record covers its start date to its `last_sick_date`, and an open record runs from its start date with no end.

This one count is used by Today, the preview, the approval check and the floor-breach details.

**Today.** Today lists every unit of the home with its three shifts dated today. Each shift's `on_duty` and `seniors_on_duty` are the On duty counts, and its `floor` is the floor version in force today. Its `shortfall` and `senior_shortfall` are computed from those current counts (Today has no if-approved view). The totals are:

- `on_duty`: the sum of `on_duty` over every unit and shift listed;
- `seniors_on_duty`: the sum of `seniors_on_duty` over the same shifts;
- `below_floor`: the number of listed shifts whose `shortfall` or `senior_shortfall` is above zero, so a shift short only of a senior counts.

Every listed shift's `on_duty` and `seniors_on_duty` always equal the preview's `on_duty` and `seniors_on_duty` for the same unit, date and shift on the same read. That holds after every sickness report, return, approval, withdrawal, HR cancel, cover claim, rota add and rota removal, because nothing is counted ahead of time: each read computes from the records as they stand.

**Absence kind.** For managers and HR admins, a rota entry's `absence_kind` is `sickness` when a sickness record covers the date, even if approved leave also covers it. Otherwise it is the approved leave's type, or null when the person is on. Care workers and bank carers see only `status` `away` and never receive the `absence_kind` key.

**Floors.** A floor version sets `min_staff` and `min_seniors` for one unit and shift from its `effective_from` date. Each shift is judged by the version with the latest `effective_from` on or before the shift's date, so raising a floor from a future date leaves earlier shifts on the old floor. A new version's `effective_from` must be after today. Two versions for the same unit, shift and date are refused with `version_exists`.

- `shortfall` is max(0, `min_staff` − `on_duty`).
- `senior_shortfall` is max(0, `min_seniors` − `seniors_on_duty`).
- A shift is below floor when either is above zero.

**Breach labels.** A shift's breach labels come from its `shortfall` and `senior_shortfall` alone:

- "-<N> below floor", where `<N>` is `shortfall`, appears only when `shortfall` is above zero;
- "no senior on shift" appears only when `senior_shortfall` is above zero;
- when both are above zero both labels appear, "-<N> below floor" first;
- a shift short only of a senior (`shortfall` 0, `senior_shortfall` above zero) shows only "no senior on shift" and never "-0 below floor";
- a shift with both at zero shows no breach label and no hatching.

The Today status cell reads "At floor" when both are zero, "-<N> below floor" when only `shortfall` is above zero, "no senior on shift" when only `senior_shortfall` is above zero, and "-<N> below floor, no senior on shift" when both are. For example, a Rowan Early with 3 on duty and no senior against a floor of 4/1 reads "-1 below floor, no senior on shift"; one with 4 on duty and no senior reads "no senior on shift".

**Leave policy.** A leave-policy version sets `notice_multiplier` for a home from its `effective_from`, which must be after today. The version that judges a request is the one in force on the day the request is submitted.

**Leave requests.** Leave types are `annual`, `unpaid` and `compassionate`. Bank carers and HR admins cannot create leave requests. A request's `unit_id` is the requester's unit. It is null for a unit manager's request, because unit managers are never on a unit rota. `length_days` counts the calendar days from start to end inclusive, and must be between 1 and 28. The start date must not be before today. A request must lie within one leave year, which runs from 1 April to 31 March. The requester, home, unit, status, hours, sick-day hours and short-notice mark are always set by the server, never by the request body.

- **Hours.** A request's `hours` is the sum of the requester's rostered shift hours whose dates fall inside the request. It is taken from the rota whenever a draft is created or edited, and again at submission. From submission on, `hours` is fixed and never recomputed. A day with no rostered shift costs nothing, so a unit manager's request always costs 0.00 hours.
- **Sick-covered hours.** A rostered shift is sick-covered when a sickness record of the requester covers its date, by the date rule in On duty. Every request's `sickness_hours` is the hours of the requester's current rostered shifts inside the request's dates that are sick-covered, capped at `hours`. It is recomputed on every read, so it rises when sickness is reported and falls when a return sets `last_sick_date`.
- **Cost and balance.** A request's cost is `hours` − `sickness_hours`. Contracted staff are entitled to 168.00 hours per leave year. `booked_hours` is the sum of the costs of that leave year's annual requests that are submitted, escalated, cover pending or approved. `remaining_hours` is entitlement minus booked. This one balance is what `/api/me` and `/api/me/shifts` return as `holiday`, what the `region "Holiday"` line shows, and what the submit check uses. Submitting an annual request whose cost exceeds `remaining_hours` is refused with the `end_date` balance message, where the first `<hours>` is the cost and the second is `remaining_hours`. A cost exactly equal to `remaining_hours` is accepted.
- **Worked example.** For example, with the seed data at start: Tom Achebe (Rowan Early, 8.00 hours a day) has an annual request from today to the day after tomorrow approved with an override, costing 24.00 hours, so `remaining_hours` is 144.00. Tom then reports sickness starting today. The request shows `sickness_hours` 24.00, `remaining_hours` is 168.00, and managers see `absence_kind` `sickness` on those three days. Tom then records a return with `last_sick_date` today. `sickness_hours` becomes 8.00 and `remaining_hours` becomes 160.00.
- **Overlaps.** Submitting a request whose dates overlap another of the requester's submitted, escalated, cover-pending or approved requests is refused with `overlaps_existing_leave`.
- **Notice.** At submission, `lead_days` is the start date minus today, in days. The request is marked `short_notice` when `lead_days` is less than `notice_multiplier` × `length_days`. A short-notice request is still accepted. The mark is set once at submission and never recomputed. For example, under the seeded multiplier of 2, a 3-day request starting 6 days from today is not short notice, and one starting 5 days from today is.
- **Validation timing.** Every validation runs again when a draft is submitted.

**Leave request transitions.** These are the only legal transitions. Any other attempt is refused with `invalid_transition`, and nothing changes.

| From | To | By | Condition |
|---|---|---|---|
| (new) | draft or submitted | owner | |
| draft | draft (edit) | owner | |
| draft | submitted | owner | |
| draft, submitted, escalated, cover_pending | withdrawn | owner | |
| submitted | escalated | the server | still submitted after the escalation delay |
| submitted, escalated | cover_pending | UM of home or HR | posting the first cover for the request |
| cover_pending | cover_pending | UM of home or HR | posting a further cover |
| submitted, escalated, cover_pending | approved | UM of home or HR, never the requester | floor check passes, or an override reason is given |
| submitted, escalated, cover_pending | declined | UM of home or HR, never the requester | reason given |
| approved | withdrawn | owner | before the first affected shift starts; if no rostered shift is affected, before 00:00 on the start date. Later attempts are refused with `already_started`. |
| approved | cancelled | HR only | reason given |

- **Deciding.** A unit manager who tries to approve, decline or post cover on their own request gets `own_request`. A care worker who tries to decide their own request gets `forbidden`, because the care worker role cannot decide any request. A care worker or bank carer who tries to decide anyone else's request gets `not_found`, because that request is not visible to them. HR admins never have requests of their own.
- **Ending a request.** Declining, withdrawing or cancelling a request also sets that request's open covers to `cancelled`. Claimed covers stay as rota assignments.

**Approval and the floor.** Approval locks the requester's unit and recomputes every shift the request affects from current counts, all inside one transaction. If any affected shift would end below floor and no `override_reason` is given, the approval is refused with `floor_breach`, which lists every breached shift with its current counts. When two approvals race, the one that commits first is judged first, and the second is judged against counts that include the first. So when two approvals would together breach a floor, exactly one succeeds. The status change, the floor counts and the decision email's outbox entry commit together or not at all. An approval with an `override_reason` succeeds even with breaches and writes a `floor_override` audit entry.

**Preview.** The preview covers the requester's unit for the 7 days starting at `from`, which must be a date inside the request. Its body is:

- `{"request_id","unit_id","from","to","scale_max","uncovered_breaches","breach_labels","approvable","shifts":[...]}`.
- For a request with a unit, `shifts` holds exactly 21 entries in date order, Early then Late then Night: `{"date","shift","label","floor":{"min_staff","min_seniors","effective_from"},"on_duty","seniors_on_duty","affected","on_duty_if_approved","seniors_if_approved","shortfall","senior_shortfall","gaps":[{"skill","cover"}]}`.

The fields work like this:

- `on_duty` and `seniors_on_duty` are the On duty counts.
- `affected` is true when the requester is rostered on that shift and not already away.
- `on_duty_if_approved` is `on_duty` − 1 on affected shifts and `on_duty` elsewhere. `seniors_if_approved` works the same way for a senior requester.
- `shortfall` and `senior_shortfall` are computed from the if-approved counts.
- `gaps` has max(`shortfall`, `senior_shortfall`) entries. The first `senior_shortfall` entries need skill `senior` and the rest need `carer`. Each gap's `cover` is an open cover posted for that shift and skill, or null. Cancelled covers never fill a gap.
- `uncovered_breaches` counts the below-floor shifts across the whole request, not just this page. A posted but unclaimed cover does not count as on duty. `breach_labels` lists those shifts' short labels in date order.
- `approvable` is true only when the request awaits a decision and `uncovered_breaches` is 0. For any other request, `affected` is false everywhere and `approvable` is false.
- `scale_max` is the largest value over the 21 shifts of max(`on_duty`, `min_staff` + 2).
- For a request whose `unit_id` is null:
  - `unit_id` is null and `to` is the sixth day after `from`.
  - `shifts` is empty, `scale_max` is 0, `uncovered_breaches` is 0 and `breach_labels` is empty.
  - `approvable` follows the rule above.
  - Approving such a request checks no floor.
  - Posting cover on it is refused with `no_open_gap`.

**Strip cells on screen.** Each cell has a shown count, a shown senior count and shown shortfalls, all taken from the preview response:

- while Preview approval is off: the shown counts are `on_duty` and `seniors_on_duty`, and the shown shortfalls are computed from them with the floor in force by the rule in Floors;
- while Preview approval is on: the shown counts are `on_duty_if_approved` and `seniors_if_approved`, and the shown shortfalls are the preview's `shortfall` and `senior_shortfall`.

Each bar's height is the shown count divided by `scale_max`. A cell's hatching and breach labels follow the Breach labels rule applied to its shown shortfalls. Its accessible name is "<shift label>: <n> on duty, floor <min staff>", where `<n>` is the shown count, followed by ", <N> below floor" when the shown `shortfall` is above zero and then ", no senior on shift" when the shown `senior_shortfall` is above zero. Dashed ghost slots appear only while Preview approval is on, one per entry in the cell's `gaps`.

**Cover shifts.** A cover is `open` when posted, `claimed` once won, and `cancelled` when its request ends while it is open or when its claimed assignment is removed. Posting cover needs a gap in the preview with the same date, shift and skill and no open cover; otherwise it is refused with `no_open_gap`. It creates one open cover on the requester's unit.

- **Who can claim.** A bank carer is eligible for a cover when they are credentialed for its home and either the cover needs `carer` or they hold `senior`. Covers at uncredentialed homes answer `not_found`. Covers needing a senior answer `skill_required` to a carer-skill bank carer.
- **Winning a claim.** Of claims by different bank carers, the first to commit wins. The cover becomes `claimed` and a rota assignment is created in the same transaction. Every other claim on that cover gets `already_taken` and writes nothing, including a claim with a new key from the bank carer who already holds it. A claim on a cancelled cover gets `cover_closed`.

**Clocking.** A clock-in attaches to the caller's assignment whose window contains the current time and that has no attendance yet. The window runs from 30 minutes before the assignment's start up to its end. If several match, the earliest start wins.

- With no such assignment the clock-in is refused with `no_rostered_shift`. An assignment that already has an attendance, open, missed or closed, is never matched again.
- While the caller has an open attendance, a clock-in is refused with `already_clocked_in`. A missed clock-out is not open and never blocks a clock-in.
- A clock-out closes the caller's open attendance. If the caller has none open but has a missed clock-out, it is refused with `clock_out_window_closed`. If the caller has no attendance without a clock-out at all, it is refused with `no_open_clock_in`.
- A clock-in is on time up to and including 10 minutes after the rostered start, and later ones are flagged `late`. Late clock-ins stay on the home's Today list until a unit manager or HR admin acknowledges them. Acknowledging a clock-in that was not late is refused with `not_late`.

**One open attendance per person.** At most one attendance per person is open at any instant, and at most one attendance exists per assignment. Both hold under concurrent requests, not only one at a time:

- Of clock-ins from one caller that carry different Idempotency-Keys and arrive at the same moment (for example from a unit tablet and a phone), exactly one answers 201 and creates one attendance and one `in` punch. Every other one answers `already_clocked_in` and writes nothing.
- Of concurrent clock-outs from one caller with different keys, exactly one answers 201 and closes the attendance, setting `worked_hours` once. Every other one answers `no_open_clock_in`, because the caller then has no attendance without a clock-out, and writes nothing.
- Of concurrent `POST /api/attendance` requests for one assignment, exactly one answers 201 and writes one `attendance_added` audit entry. Every other one answers `attendance_exists` and writes nothing.

**Attendance states and the missed clock-out.** An attendance with a clock-out is closed. An attendance without one is open only while the server's current instant is before its `rostered_end` plus 4 hours. From that instant on, the instant itself included, it is a missed clock-out and `missed_clock_out` is true. This is judged from the server clock on every read and write, so nothing has to run for it to happen, nothing stored changes, and `version` stays as it was. For example, a Night from 22:00 to 08:00 becomes a missed clock-out at 12:00 the next day if nobody clocked out. A missed clock-out:

- is never the caller's `open_attendance`;
- counts zero worked seconds in pending accrual, pay-period close and the timesheet CSV, and its `worked_hours` is null;
- is listed in the home's Today `missed_clock_outs` while its shift date falls within the 7 Europe/London days ending today (today and the six days before), oldest rostered start first, until it is corrected;
- is closed only by a correction. A correction that sets `clock_out_at` makes `missed_clock_out` false, raises `version` by one, takes worked hours from the corrected times and removes the attendance from `missed_clock_outs`. A correction that leaves `clock_out_at` null keeps it missed. When the shift's month is already closed, the next close appends an adjustment as described in Holiday accrual.

An attendance added through `POST /api/attendance` with `clock_out_at` null follows the same rule, so one added for a shift that ended more than 4 hours ago is a missed clock-out at once.

**Idempotency keys.** `POST /api/punches` and `POST /api/cover-shifts/{id}/claim` both require an `Idempotency-Key` header, and one rule governs both:

- **Format.** The key must be 1 to 100 characters long. A missing key, or a longer one, is refused with `validation` on `Idempotency-Key`.
- **Scope and lifetime.** Keys belong to the signed-in caller, so two people may use the same key independently. A key is kept for `IDEMPOTENCY_TTL_SECONDS` after the success it records, which defaults to 86,400 seconds.
- **What is recorded.** A keyed request is its method, path and JSON body. A key records the first 2xx response to its request. Refusals are never recorded, so a retry after a refusal is judged afresh.
- **Replay.** The same caller sending the same key with the same request gets the recorded status and body, byte for byte, with the header `Idempotent-Replayed: true`. Nothing new is written. This holds even if the record has since changed, for example when the claimed cover has been cancelled. A response that is not a replay carries no `Idempotent-Replayed` header.
- **Reuse.** The same key with a different method, path or body than the request it recorded is refused with `idempotency_key_reused`.
- **Concurrent duplicates.** Requests with the same caller and key that arrive while an earlier one is still running wait for it. If it succeeds, each of them answers as a replay of its response. If it is refused, they are judged afresh one at a time. The action therefore runs at most once, and a duplicate never answers `already_taken` or `already_clocked_in` because of its own twin. Requests with different keys are not duplicates and follow One open attendance per person and Winning a claim.

**Attendance versions and corrections.** Every attendance starts at `version` 1 when it is created by a clock-in or an add. Every stored change raises `version` by exactly one: the worker's clock-out, a correction and an acknowledgement.

- A correction sends the version it read in `If-Match`. Without it the correction gets `version_required`. When the record's version is no longer the one sent, it gets `stale_version`, whose `current` is the record as it now stands, and nothing is written. So a manager who read an open attendance and then saw the worker clock out gets `stale_version` with the clocked-out record.
- Of concurrent corrections sent with the same `If-Match`, exactly one answers 200 with `version` one higher and writes exactly one `attendance_corrected` audit entry. Every other one answers `stale_version` with `current` equal to the winner's record, and writes no audit entry.
- Clock-in must lie within 4 hours of the rostered start, and clock-out must be after clock-in.
- The late flag is recomputed from the corrected clock-in. The reason becomes `correction_note`.
- Adding attendance to an assignment that already has some is refused with `attendance_exists`.

**Sickness.** A sickness record starts `reported`, with a start date from 28 days ago up to today. Its `days` is from the start date to the last sick day (or today, while open), inclusive. Non-working days count.

- **Fit note required.** When `days` exceeds 7 the record becomes `fit_note_required`. This happens on any read, and within 60 seconds through a background sweep.
- **Evidenced.** A fit-note upload is accepted in `reported` and `fit_note_required` and moves the record to `evidenced`. In any other state it is refused with `invalid_transition`.
- **Return.** Recording the return sets `last_sick_date` and moves the record to `closed`. The closed span is the days from the start date to `last_sick_date`, inclusive.
  - From `evidenced`, the return always closes the record.
  - From `reported` or `fit_note_required`, the return closes the record when the closed span is 7 days or fewer. When the span is more than 7 days it is refused with `fit_note_missing` and the record is unchanged.
  - A return on a `closed` record is refused with `invalid_transition`.

**Fit-note files.** The file's type is judged by its bytes, never by its name or declared type.

- A PDF starts with `%PDF-` and contains `%%EOF`; its detected type is `application/pdf`.
- A JPEG starts with the bytes FF D8 FF and ends with FF D9; its detected type is `image/jpeg`.
- A PNG starts with the eight-byte PNG signature and contains an IEND chunk; its detected type is `image/png`.
- Anything else, including SVG, HTML or a file whose content does not match these rules, is refused with `unsupported_file`.
- A file larger than 5,000,000 bytes is refused with `too_large`. Exactly 5,000,000 bytes is allowed.
- The original name is kept only as `file_name`. That is its last path segment after any `/` or `\`, with control characters removed, cut to 100 characters, and it never forms part of a storage key. For example, `..\..\Kwame "fit" note – Siân.pdf` is kept as `Kwame "fit" note – Siân.pdf`.

**Visibility and homes.** Each home is a separate tenant in one shared database.

- A care worker sees their own home's rota and only their own leave, sickness, attendance and fit notes.
- A bank carer sees only covers they are eligible for, and their own shifts, attendance and accrual.
- A unit manager sees only their own home on every list, count, total, picker, attendance view, Today list, audit view and preview.
- An HR admin sees every home.
- Any id outside what the caller may see answers `not_found`.
- The people picker returns the home's care workers and the bank carers credentialed there. It matches the query case-insensitively against current display name or staff id.
- The queue `status` filter is one of `open` (the default), `submitted`, `escalated`, `cover_pending`, `approved`, `declined`, `withdrawn` or `cancelled`. Any other value is refused with `validation`. `open` means exactly `submitted`, `escalated` and `cover_pending`. Drafts never appear in queue items or counts under any filter.
- Queue counts are per status for the chosen home and week, whatever the status filter. A request belongs to a week when its dates overlap the Monday to Sunday of that ISO week.

**Audit.** The audited actions are exactly these six:

- `attendance_corrected`
- `attendance_added`
- `floor_override`
- `floor_version_added`
- `policy_version_added`
- `leave_cancelled`

Each writes one entry in the same transaction as the change, with the actor, the target, the before state (null for additions), the after state and the reason (null for version additions), in the `audit entry` shape from API. The actor's display name and every name in the before and after states are copied into the entry when it is written. Entries are append-only. The database refuses any update or delete of an entry, and the API offers no way to change one.

**Holiday accrual.** Only bank carers accrue holiday in the ledger. Accrued hours are worked seconds × 0.1207 ÷ 3,600, rounded up to four decimal places and never down. For example, 11 hours accrues 1.3277 hours, 10 hours accrues 1.2070 hours, and 9 hours accrues 1.0863 hours.

- **Pay periods.** A pay period is a calendar month. An attendance belongs to the month of its shift date. Only attendances with a clock-out count; open attendances and missed clock-outs count zero.
- **Pending accrual.** `open_period` shows the current month's worked hours and pending accrual. They are recomputed on each read, so they change straight after a clock-out or correction.
- **Closing a period.** An HR admin can close a month only after it has ended in Europe/London; earlier attempts get `period_not_ended`. Closing appends one `period` entry for every bank carer, even at zero.
  - The entry's `worked_hours` is the month's worked seconds ÷ 3,600, written with four decimal places and rounded half up at the fourth place.
  - Its `accrued_hours` follows the accrual rule above.
- **Adjustments.** Closing a period also appends one `adjustment` entry for each bank carer and each earlier closed month whose worked seconds have changed since that month's entries were written, for example after an attendance correction or after a missed clock-out is given its clock-out.
  - The adjustment's `period` is the earlier month it corrects.
  - Its `worked_hours` is that month's current worked hours, rounded as for a period entry, minus the sum of `worked_hours` already in the ledger for that bank carer and month.
  - Its `accrued_hours` is the accrual of that month's current worked seconds, by the rule above, minus the sum of `accrued_hours` already in the ledger for that bank carer and month. It may be negative and needs no further rounding.
  - For example, September 2026 closes with one 10-hour shift, giving a period entry of worked 10.0000 and accrued 1.2070. The clock-out is then corrected so the shift lasts 11 hours. Closing October 2026 appends an adjustment for 2026-09 of worked 1.0000 and accrued 0.1207 (1.3277 − 1.2070). Had it been corrected to 9 hours instead, the adjustment would be worked −1.0000 and accrued −0.1207 (1.0863 − 1.2070).
- Ledger entries are never edited or recomputed in place.
- **Closing twice.** A second close of the same month gets `period_closed` and adds nothing, including when two closes race.

**Timesheet CSV.** The export is comma-separated UTF-8 with CRLF line endings, quoted per RFC 4180. The header row is exactly `home,unit,staff_number,display_name,role,shift_date,shift,rostered_start,rostered_end,clock_in,clock_out,worked_hours,late,correction_note`. The file is written once, when the export is created, using each person's display name at that moment.

- **Rows.** There is one row per attendance whose shift date is in the period and whose home is among `home_ids`. Rows are sorted by home name, unit name, shift date, shift (Early, Late, Night) and staff number.
- **Values.** Each column holds:
  - `home`: the home's name, for example `Larchfield House` (never its id);
  - `unit`: the unit's name, for example `Rowan` (never its id);
  - `staff_number`: the person's staff number, for example `HV-0901`;
  - `display_name`: the person's display name when the export was created;
  - `role`: the person's API role value, `care_worker` or `bank_carer`;
  - `shift_date`: the shift's date as `YYYY-MM-DD`;
  - `shift`: the CSV spelling from Shifts and hours;
  - `rostered_start`, `rostered_end`, `clock_in`, `clock_out`: ISO 8601 instants with the Europe/London offset;
  - `clock_out` and `worked_hours`: empty for an open attendance or a missed clock-out; otherwise `worked_hours` has two decimal places;
  - `late`: `yes` or `no`;
  - `correction_note`: the attendance's `correction_note`, or empty.
- **Neutralising formulas.** Any cell whose first character is `=`, `+`, `-` or `@` is written with a single apostrophe in front, so a spreadsheet shows it as text. This covers display names and correction notes.

**Emails.** Every email is written to an outbox in the same transaction as the change that causes it, fully composed with the names as they are at that moment, and sent only after that transaction commits. Each outbox entry is delivered exactly once.

- Decision emails go to the requester on approve, decline and HR cancel.
- Posting a cover, including a fresh cover after an earlier one was cancelled, sends one email to each bank carer eligible for it at that moment.
- The cover email names only the home, unit, date, shift times and skill. It never contains the absent person, the leave type, a sickness reason, the request id or the request's note.
- No email ever contains a sickness reason or a fit note.

**Escalation.** A request still `submitted` `ESCALATION_AFTER_SECONDS` after its submission becomes `escalated`. The default is 172,800 seconds; homes run every hour, so every elapsed hour counts. A background sweep runs at least every 10 seconds, and the change queues one escalation email to the home manager. Requests in other states do not escalate.

### Services (DP-22, DP-40, DP-55, DP-56, DP-57, DP-58, DP-69)

**Postgres** (`DATABASE_URL`) holds every record: homes, units, people, credentials, rota assignments, floor and policy versions, punches and attendance, leave requests, sickness records, covers, the accrual ledger, idempotency records for punches and claims, the email outbox, uploads still waiting for storage, exports and the audit log. The app applies its schema and seed data on every serve, without harm if they already exist. It seeds only when the database has no homes.

**Mailpit** (SMTP via `SMTP_HOST` and `SMTP_PORT`). Every message is sent from `MAIL_FROM`, which is `Tallow Cover <cover@tallow.example>`.

| Email | To | Subject | Body includes |
|---|---|---|---|
| Approved | requester | `Leave approved: <date> to <date>` | type label, dates, hours, approver's display name |
| Declined | requester | `Leave declined: <date> to <date>` | type label, dates, decline reason |
| Cancelled | requester | `Approved leave cancelled: <date> to <date>` | type label, dates, cancellation reason |
| Cover open | each eligible bank carer | `Cover shift at <home name>: <shift label>` | home name, unit name, `<date>`, `<HH:MM>–<HH:MM>`, skill "Senior" or "Carer", and the path `/cover` |
| Escalation | the home manager | `Leave request awaiting decision: <display name>, <date> to <date>` | requester display name, unit name (or "No unit" when the request has none), type label, dates, submitted time |

**Headers built from stored text.** The escalation and cover-open subjects are the headers that carry stored text (a display name or a home name). In every such header:

- each run of carriage returns, line feeds or any other control characters becomes one space;
- text that is not plain ASCII is encoded per RFC 2047, so it decodes back exactly;
- the header stays a single Subject line, and no stored text can add a header or a recipient.

`To` is always the recipient's stored email address alone, with no display name. For example, a care worker whose display name is `Priya` followed by a carriage return, a line feed and `Bcc: spy@evil.example` produces one escalation message to the home manager only, whose Subject decodes to `Leave request awaiting decision: Priya Bcc: spy@evil.example, <date> to <date>`, and no message reaches `spy@evil.example`. A display name such as "Siân Ó'Brien" decodes exactly. Such a message is delivered once, like any other, and never holds back the outbox entries behind it, including when the outbox drains after a mail outage.

**MinIO** (`S3_ENDPOINT`, `S3_BUCKET`). The bucket stays private, and nothing is ever readable without a signature.

- Fit notes are stored at `fit-notes/<home id>/<sickness id>/<upload id>.<pdf|jpg|png>` with their detected content type. No part of the key comes from a person's name or the original file name.
- Exports are stored at `exports/timesheets/<YYYY-MM>/<export id>.csv` with content type `text/csv`.
- **Signed downloads.** Download endpoints check who is asking first. Only then do they issue a presigned GET that:
  - is valid for 60 seconds from issue, and every call issues a new one;
  - is signed for that one object key;
  - is signed together with a response content type and a response content disposition, so fetching it returns exactly the stored bytes with those `Content-Type` and `Content-Disposition` headers.
- **Response type.** For a fit note it is the detected type; for an export it is `text/csv`.
- **Response disposition.** It is exactly `attachment; filename="<fallback>"; filename*=UTF-8''<encoded>`, where:
  - the file name is the fit note's `file_name`, or `timesheets-<YYYY-MM>.csv` for an export of that pay period;
  - `<fallback>` is the file name with every non-ASCII character, every `"` and every `\` replaced by `_`;
  - `<encoded>` is the file name's UTF-8 bytes percent-encoded with uppercase hex digits, leaving only ASCII letters, digits, `-`, `.`, `_` and `~` unencoded.
  - For example, `Kwame "fit" note – Siân.pdf` gives `attachment; filename="Kwame _fit_ note _ Si_n.pdf"; filename*=UTF-8''Kwame%20%22fit%22%20note%20%E2%80%93%20Si%C3%A2n.pdf`.
- **Refusals by storage.** Storage refuses with 403 a link whose object key or any signed response parameter has been changed, and any link used more than 60 seconds after issue.

**When mail is down**, every action still succeeds with its normal status and copy. Emails stay in the outbox until delivery works. **When storage is down**, fit-note uploads and exports still succeed, with `storage` set to `pending` and the bytes held in Postgres. Download requests for them get `storage_pending` until they are stored. In both cases `GET /api/health` reports `"down"` for that service.

### Seed data (DP-02, DP-17, DP-23, DP-29, DP-37, DP-41, DP-44)

Every person, home and email address below is invented. The group is Hollins Vale Care. Every account's password is `cover-demo-2026`. Emails are `<first>.<last>@hollinsvale.example` in lower case, for example `priya.raman@hollinsvale.example`. People's ids are their staff numbers.

**Homes and units.**

- Larchfield House (`larchfield`), with units Rowan (`larchfield-rowan`) and Willow (`larchfield-willow`).
- Brackenmoor Lodge (`brackenmoor`), with unit Heather (`brackenmoor-heather`).

**Floors** (all effective from 2026-01-01):

| Unit | Early (staff/seniors) | Late (staff/seniors) | Night (staff/seniors) |
|---|---|---|---|
| Rowan | 4/1 | 4/1 | 3/1 |
| Willow | 3/1 | 3/1 | 2/1 |
| Heather | 3/1 | 3/1 | 2/1 |

**Leave policy.** Each home has notice multiplier 2, effective from 2026-01-01.

**Group HR admin.** Rosalind Okafor (HV-0050).

**Unit managers** (skill senior; not on the rota; each has 168.00 hours of entitlement):

- Larchfield House: Fenella Marsh (HV-0011, home manager) and Idris Penhale (HV-0012).
- Brackenmoor Lodge: Oluwaseun Fisher (HV-0021, home manager) and Petra Lowe (HV-0022).

**Contracted care workers** (role care_worker; 168.00 hours of entitlement and 0 booked in every leave year; "(senior)" marks skill senior):

| Unit | Early | Late | Night |
|---|---|---|---|
| Rowan | Priya Raman HV-0101 (senior), Tom Achebe HV-0102, Grace Lindqvist HV-0103, Kwame Mensah HV-0104 | Joanna Price HV-0105 (senior), Ellis Hart HV-0106, Marta Novak HV-0107, Sean Doyle HV-0108 | Devika Shah HV-0109 (senior), Aoife Brennan HV-0110, Bilal Qureshi HV-0111 |
| Willow | Hannah Cole HV-0121 (senior), Luis Ortega HV-0122, Nia Evans HV-0123 | Ruth Abbott HV-0124 (senior), Callum Reid HV-0125, Zofia Wright HV-0126 | Yusuf Adeyemi HV-0127 (senior), Leah Morgan HV-0128 |
| Heather | Imogen Taylor HV-0211 (senior), Rhys Jenkins HV-0212, Amara Osei HV-0213 | Owen Pritchard HV-0214 (senior), Sophie Barker HV-0215, Kemi Adeleke HV-0216 | Tariq Hussain HV-0217 (senior), Bethan Lloyd HV-0218 |

**Rota.** Each person above is rostered on their column's shift in their unit every day. The rota runs from 35 days before the London date of first seeding to 182 days after it. Every seeded shift therefore sits exactly at its floor, with exactly one senior. Because Early, Late and Night together cover every minute of the day, at any moment some seeded care workers in every unit have a shift whose clock-in window contains the current time.

**Bank carers** (role bank_carer, no rota, empty ledger):

- Femi Adebayo (HV-0901), senior, credentialed at Larchfield House and Brackenmoor Lodge.
- Carys Pugh (HV-0902), carer, Larchfield House.
- Mateusz Zielinski (HV-0903), carer, Larchfield House.
- Holly Strand (HV-0904), carer, Brackenmoor Lodge.

**Empty at start.** There are no leave requests, sickness records, covers, punches, attendance, closed pay periods, exports, idempotency records, outbox entries or audit entries.

## Technical requirements

### Deployment (DP-01)

Python 3.12 with pip is installed. The server is written in Python. Node.js 22 with npm is also installed, if you choose to use it to build the browser assets.

The app is installed and run as an unprivileged user. Python dependencies go into a `.venv` inside the app folder, and the manifest calls its tools by relative path (`.venv/bin/<tool>`) or as `.venv/bin/python -m <tool>`. `install` creates that `.venv` on the grading machine, so `/app` itself holds no virtual environment when you finish: delete any you made while working, because its interpreter links point outside `/app` and the folder cannot be copied with them.

Provide `/app/run.json` with string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. An example of the format:

```json
{"_schema":"run-manifest-v1","install":"python -m venv .venv && .venv/bin/pip install --no-cache-dir -r requirements.txt","build":".venv/bin/python -m compileall -q .","serve":".venv/bin/python -m tallow_cover"}
```

`serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. It serves the browser app and the API from that one origin. `GET /api/health` returns HTTP 200 JSON with `"status":"ok"`, in the shape given in API, as soon as the server accepts connections and while Postgres is reachable.

### Configuration and secrets (DP-05)

The server reads these at start: `DATABASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `APP_PUBLIC_PORT`, `ESCALATION_AFTER_SECONDS`, `SESSION_TTL_SECONDS` and `IDEMPOTENCY_TTL_SECONDS`. No credential, URL or secret is written into source. None reaches the browser in HTML, scripts, responses or headers. The server ignores any variable containing `OBSERVER`.

### Server boundary (DP-04, DP-58)

- **Same origin only.** The server sends no CORS allow headers. A `POST`, `PATCH`, `PUT` or `DELETE` whose `Origin` header is present and differs from the server's own origin is refused with `cross_origin`.
- **Body size.** JSON bodies may be up to and including 65,536 bytes, and fit-note multipart bodies up to and including 5,100,000 bytes. Anything larger is refused with `too_large` before it is parsed. A JSON endpoint called without a JSON content type is refused with `unsupported_media_type`.
- **What is served.** The server serves only the built browser assets and `/api`. Requests for source files, `/run.json`, dotfiles such as `/.env` or `/.git/config`, dependency manifests or any path outside the built assets answer 404. The SPA's own routes listed in Screens and layout return the app shell.
- **Outages.** If mail or storage is unreachable at boot or later, the server still starts and serves every endpoint. It retries the email outbox and held uploads at least every 5 seconds. It completes them within 30 seconds of the service becoming reachable, without a restart. Health reflects each service's state within 10 seconds.

### Browser support and performance (DP-60)

The app supports current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800. With the seed data, each screen is usable within 3 seconds of navigation, and the preview response arrives within 1 second. The page loads nothing from any other origin.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package and both typefaces, each with its licence. Shipped packages are the production dependency tree: the Python packages that `install` installs for runtime, plus `npm ls --omit=dev --all --json` (or the lockfile's non-dev group) if npm is used.
- IF-03: Every shipped package and font uses one of these licences: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, PSF-2.0 or OFL-1.1.
- IF-04: The app stores state only in the provided Postgres database and MinIO bucket. There is no SQLite, Redis, other datastore, or state file on local disk.
- IF-05: The provided service configuration files and their seeded credentials are left unchanged.
- IF-06: Fonts and every other browser asset are served by the app itself, and no source file references an external CDN.

## Engineering standards

- The code is idiomatic Python, and the browser code is idiomatic for its language.
- Names in the code use this brief's domain terms: floor, shortfall, gap, cover, punch, attendance, missed clock-out, accrual, ledger, pay period, sick-covered and fit note.
- Each domain rule is decided in exactly one place in the source: each leave-request transition, the on-duty count shared by Today and the preview, the effective floor lookup, the breach labels, whether an attendance is open or a missed clock-out, the attendance version check, a request's cost and the booked hours, the idempotency-key rule shared by punches and claims, each endpoint's published body keys, the accrual formula, the late flag, CSV cell neutralising, email header neutralising and the signed-download disposition.
- Live views read a person's current display name, while audit entries, exports and outbox messages store the name they were written with; the source does not mix the two.
- Every API error is produced through the one error shape in API, with no endpoint inventing its own.
- No abstraction has only one implementation, and there is no dead, commented-out or unreachable code.
- There are no defensive checks for states the rules make impossible.
- The code adds no features, endpoints or screens beyond this brief.
