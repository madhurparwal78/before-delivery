# Crosshand Relay

Crosshand Relay is a dispatch board for regional ASL interpreting agencies. Client organisations (hospitals, universities, courts) request interpreters for appointments. Agency coordinators turn each request into confirmed seats: one interpreter, or a team of two who swap the active role on a fixed rotation. Interpreters claim open seats that match their credentials and calendar and keep their certificates current. Billing admins close completed jobs into exact charges under each client's contract terms. Relay keeps its records in Postgres and posts every charge to Kill Bill as an invoice item on the client organisation's account. It sends every notification by email through the SMTP sink (Mailpit) and stores interpreter certificate files privately in MinIO. Out of scope:
- self sign-up and password reset (every person is seeded)
- collecting payments
- interpreter payroll
- video remote interpreting
- SMS and push notifications
- any datastore beyond the services named here

## Problem and users

Regional interpreting agencies staff thousands of appointments a year, and their coordinators still work from spreadsheets, group texts and general scheduling tools. Most jobs longer than an hour need a team of two interpreters who swap the active role every 20 to 30 minutes, so jobs often come back "half filled": one seat confirmed and the other still open on the morning of the appointment. Two interpreters answer the same text blast and both believe they have the job. Certificates expire without anyone noticing. Billing is checked by hand against contract rules: a two-hour minimum, quarter-hour increments, and the full charge when a client cancels late. The cost of these mistakes falls in three places. Agencies lose revenue to billing errors and disputes, clients pay for no-shows, and Deaf patients, students and defendants lose access when a job goes out with one interpreter or none.

- **Agency coordinator** (daily): turns each incoming request into fully staffed seats with the right credentials, and sees at a glance which jobs this week still have an open seat.
- **Interpreter** (daily): claims open seats that match their credentials and calendar, keeps their certificates current, and knows who they are teaming with.
- **Client scheduler** (weekly): requests interpreters for their organisation's appointments, follows staffing status, and cancels bookings knowing exactly what that will cost.
- **Billing admin** (weekly): closes completed assignments into exact charges under each client's contract terms and reconciles them with the billing system.

## Journeys

1. **Request an interpreter.** Start: the Harbor Point scheduler is signed out. They sign in, land on Requests, open New request and enter a medical appointment that runs longer than an hour. They save it as a draft, then submit it. End: the request detail shows the reference, the "Open seat" label, two open seats A and B, the rotation braid with both lanes hatched and reading "open", and the time until which they can cancel for free.
2. **Staff a team job.** Start: the coordinator is on the week board with a submitted request. They open the job's row and the detail pane slides in beside the board. They set the rotation interval and press Broadcast open seats. End: the Job status region reports how many eligible interpreters were emailed, and each of those interpreters has an open-seat email with no consumer details in it.
3. **Claim the last seat.** Start: an interpreter with a verified, unexpired credential receives an open-seat email for a half-staffed job. They sign in, open the job from Open seats and press Claim seat B. End: the server confirms, seat B's braid segments fill one after another, the consumer name, address and notes appear, and the winner and their teammate each get a confirmation email. A second interpreter who pressed at the same moment keeps the hatched lane, sees seat B marked "taken" and hears that the seat was taken. The client scheduler receives a "Fully staffed" email.
4. **Keep certificates current.** Start: an interpreter's profile lists a certificate that has expired. They upload a new certificate PDF. The coordinator opens Credentials, views the file through a short-lived link, enters the expiry date and verifies it. End: the interpreter's My credentials table shows the new credential as Verified with its expiry date, and seats requiring that credential appear in their Open seats.
5. **Cancel with the cost known.** Start: a client scheduler opens a staffed request that starts in under two days. They press Cancel booking, and the dialog states the late-cancellation fee and how it was worked out. They confirm. End: the request reads "Cancelled (late fee)". A receipt email states the fee, the confirmed interpreters get a cancellation email, and the fee appears as one invoice item in Kill Bill.
6. **Close the week's work.** Start: the coordinator has marked a team job completed with its actual minutes. The billing admin opens Billing, finds the job in Ready to close and closes it. End: the Billing status region shows the exact amount, Invoices lists it as Posted with its Kill Bill invoice id, the CSV export includes it, and the client scheduler gets a charges email with the same amount.
7. **Bill through an outage.** Start: Kill Bill is unreachable. The billing admin closes a completed job. End: the job shows "Invoice pending". Once Kill Bill responds again, the same row turns to Posted on the next refresh and Kill Bill holds exactly one invoice item for it. Nobody restarts anything.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** `/app/run.json` declares the install, build and serve commands and the served app answers the health check, both as stated in Deployment.
- **DP-02 — Seeded sign-in and roles** Every seeded person signs in with their email and the seed password, lands on their role's home screen and can call only the endpoints API grants that role.
- **DP-03 — One error shape and order** Every API error uses the one error body and the one precedence order stated in API.
- **DP-04 — Server boundary** The server enforces the origin, body-size and never-served rules in Server boundary and keeps serving when Kill Bill, MinIO or Mailpit is unreachable at boot.
- **DP-05 — Configuration from environment** Every service URL and credential is read at start from the environment variables in Configuration and secrets and is never hard-coded or sent to the browser.
- **DP-06 — Three viewports without overflow** At 375x812, 768x1024 and 1280x800 every screen follows Screens and layout with no horizontal page scroll, and every job row shows its status label and seat counter within the leftmost area stated there.
- **DP-07 — Ruled dispatch look** Every screen reads as a light, ruled dispatch board with the colour roles, type pairing, compact density and grid described in Visual design.
- **DP-08 — Motion timing and reduced motion** Panels, fills and feedback move only as timed in Motion and effects, nothing loops for decoration, and a reduced-motion preference swaps every movement for its stated substitute.
- **DP-09 — Keyboard and focus** Every public control is reachable by Tab in reading order with a visible focus ring, and Escape closes the job detail pane or the cancel dialog and returns focus to the control that opened it.
- **DP-10 — Draft requests** A client scheduler creates and edits draft requests for their own organisation with the fields and validation in API.
- **DP-11 — Start times in agency time** Start times are entered and shown in the agency's time zone whatever the browser's zone, with skipped and repeated clock-change hours handled as stated in Business rules.
- **DP-12 — Submit opens seats** Submitting a draft moves it to submitted and opens seats by the team-size rule in Business rules.
- **DP-13 — Client request journey** A client scheduler signs in, fills in New request, saves a draft, submits it and sees the request detail with its open seats and the Open seat label.
- **DP-14 — Team size and rotation settings** A coordinator overrides a request's team size with a recorded reason and sets its rotation interval, within the limits in Business rules.
- **DP-15 — Open-seat broadcast** Broadcasting a request emails each eligible, free interpreter once with only the facts listed in Services, never the private consumer details named in Business rules.
- **DP-16 — Coordinator staffing journey** A coordinator opens a job from the week board, sets its rotation interval, broadcasts its open seats and sees the sent count in the Job status region.
- **DP-17 — Exactly one claim wins** When interpreters claim the same open seat at once, exactly one gets the confirmation, every other gets seat_taken with no email, and every attempt is written to the request history.
- **DP-18 — Staffing emails** Winning a seat emails the winner and any confirmed teammate, and a request becoming staffed emails its client scheduler, as listed in Services.
- **DP-19 — Interpreter claim journey** An interpreter signs in, opens a job from Open seats, claims a seat, sees the braid fill and then sees the consumer name and notes in the job detail.
- **DP-20 — Credential valid on the job date** Only an interpreter whose required credential is verified and unexpired on the job's date sees the seat in Open seats or can claim it; others get credential_invalid.
- **DP-21 — No overlapping seats** An interpreter never holds two confirmed seats whose time windows overlap; the later claim gets schedule_conflict.
- **DP-22 — Staffing status from seats** A request's status follows its confirmed seats after every claim and team-size change, as defined in Business rules.
- **DP-23 — Fields by role** Each API response carries only the fields API publishes for the caller's role, so a client scheduler sees an interpreter's display name and credential badges and never their phone, home area or pay rate.
- **DP-24 — Organisation isolation** A client scheduler sees only their own organisation's requests, seats and invoices in every list, search and export, and another organisation's id answers the same 404 as an id that does not exist.
- **DP-25 — Week board rows** The coordinator's week board lists the week's jobs by day with time, reference, organisation, status label and seat counter, an open-seat filter and week navigation, refreshing as stated in Interactions.
- **DP-26 — Status beyond colour** Open, half-staffed and staffed jobs differ by hatch pattern and text label as well as colour, at the contrast stated in Feedback states.
- **DP-27 — Braid lanes and segments** Job detail draws the rotation braid as one lane per seat, split into rotation segments with alternating active role, crossover diagonals and hatched open segments named as in Public screens and controls.
- **DP-28 — Playhead and readout** The braid's playhead moves from 0 to the job length by drag or keyboard, and the Rotation readout names the clock time and the active and support seats.
- **DP-29 — Fill only after confirmation** A seat's segments fill one by one in start-time order only after the server confirms the claim, and a lost claim keeps the hatching and announces the seat-taken copy.
- **DP-30 — Braid without motion** With reduced motion requested the braid fills instantly and draws crossovers without animation, while the playhead, keyboard steps, readout and Rotation table work unchanged.
- **DP-31 — Braid craft** The braid reads as two interlocking lanes whose active band visibly crosses over at each boundary, with open stretches distinct from staffed ones at first look.
- **DP-32 — Certificate upload limits** An interpreter uploads a certificate within the type and size limits in Server boundary, with type judged by the file's content.
- **DP-33 — Private certificate files** Certificate files live privately in MinIO under the key pattern in Services and reach only coordinators through the short-lived link in API.
- **DP-34 — Verification and expiry** A coordinator verifies an uploaded certificate with its expiry date, and the credential reads as expired once that date has passed in agency time.
- **DP-35 — Storage outage** When MinIO is unreachable, uploads and file links fail with storage_unavailable and the storage copy while every other feature keeps working.
- **DP-36 — Free-cancellation cutoff** Each request states when free cancellation ends, computed by the agency-time cutoff rule in Business rules so it holds across clock changes.
- **DP-37 — Fee shown before confirming** Cancelling shows the server's exact fee before the user confirms, and confirming against a fee that has since changed gets fee_changed with the new quote.
- **DP-38 — Cancellation effects** A confirmed cancellation sets cancelled_early or cancelled_late, frees the seats, records any late fee as one billing charge and sends the cancellation emails in Services.
- **DP-39 — Completion with actual minutes** A coordinator marks a half-staffed or staffed request completed with its actual minutes.
- **DP-40 — Exact charge at close** Closing a completed request computes the charge once by the charge rule in Business rules, and the same amount appears in Postgres, the Kill Bill invoice item and the invoice email.
- **DP-41 — One billing item per charge** Each close or late-cancellation fee becomes exactly one Kill Bill invoice item on the client organisation's account, and the Kill Bill invoice id is stored on the charge.
- **DP-42 — Invoice pending and recovery** When Kill Bill is unreachable the charge is saved as invoice pending and posts exactly once after Kill Bill returns, without a restart, as qualified in Server boundary.
- **DP-43 — Idempotent close and cancel** Close and cancel take an Idempotency-Key, replay the stored response for a repeated key and reject a key reused for a different action, as stated in Business rules.
- **DP-44 — Invoice list, search and export** The billing admin and client schedulers list invoices, search them by reference and export them as CSV with the columns in API.
- **DP-45 — Billing admin journey** The billing admin signs in, closes a completed request from Ready to close, sees its amount and billing status, and finds it in Invoices and the CSV export.

## Frontend

### Screens and layout (DP-02, DP-06, DP-13, DP-16, DP-19, DP-25, DP-45)

Every page sits on one 12-column grid with thin 1-pixel rules between regions. The page never scrolls sideways at 375x812, 768x1024 or 1280x800. Horizontal movement happens only inside the board's own day scroller and the day strip.

After sign-in each role lands on its home screen: coordinator on Week board (`/board`), interpreter on Open seats (`/open-seats`), client scheduler on Requests (`/requests`), billing admin on Billing (`/billing`). Visiting `/` while signed in goes to that home. Visiting any app page while signed out goes to Sign in (`/signin`).

- **Sign in** (`/signin`): the Crosshand Relay wordmark above a narrow form, centred, one column at every viewport.
- **App frame**: a top bar with the wordmark, the role's navigation links, the signed-in display name and Sign out. At 375 wide the links fold behind a Menu button that opens them as a full-width list under the bar.
- **Week board** (coordinator, `/board`, optional `?week=YYYY-MM-DD` and `?job=<request id>`):
  - **1280x800:** a fixed left rail of 2 columns holds the week heading, Previous week and Next week, and the seven days as a vertical list, each with its count of open seats. The other 10 columns are a horizontal scroller of day columns, three days visible at once, snapping so a day column always lines up with the rail's edge. Inside a day column each job is a full-width row, ordered by start time and then reference.
  - **768x1024:** the rail becomes a strip of seven day links above the board and two day columns are visible.
  - **375x812:** the day strip itself scrolls sideways with snapping and one day column fills the width.
  - **Row content:** each row shows, left to right: the start time in heavy display type, the status label with the monospaced seat counter, the reference, the organisation, setting and required credential, and the city. The status label and seat counter always lie within the row's leftmost 200 pixels at every viewport.
- **Job detail pane** (opened from a board row, or for an interpreter from Open seats or My assignments at `/jobs/<request id>`):
  - **1280x800:** a right-hand pane 5 columns wide. The board or list stays visible and usable in the remaining columns.
  - **768x1024:** the pane covers the right 8 columns and the board stays visible on the left.
  - **375x812:** the pane fills the screen and has its close button at the top.
  - **Contents, top to bottom:** reference heading, facts (date, time window with zone abbreviation, setting, required credential, city, plus consumer name, street address and notes when the viewer may see them), the Seats list, the rotation braid with its playhead and readout, the Rotation table, then the viewer's role controls (coordinator staffing controls and History, or interpreter claim buttons).
- **Credentials** (coordinator, `/credentials`): a full-width table of certificates awaiting review. At 375 wide each table row stacks into a ruled card with the same labelled fields.
- **Open seats** (interpreter, `/open-seats`): a list of claimable seats ordered by start time. At 1280 the list takes 7 columns and the job detail opens beside it; at 768 and 375 the detail covers it as described for the pane.
- **My assignments** (interpreter, `/assignments`): the interpreter's confirmed seats ordered by start time, laid out like Open seats.
- **Profile** (interpreter, `/profile`): the Upload certificate form above the My credentials table. Two columns at 1280, one column at 768 and 375.
- **Requests** (client scheduler, `/requests`): a search box above the organisation's requests table, newest start first. At 375 the rows stack into ruled cards.
- **New request** (client scheduler, `/requests/new`, also used to edit a draft at `/requests/<id>/edit`): a single-column form 6 columns wide at 1280, full width at 768 and 375.
- **Request detail** (client scheduler, `/requests/<id>`): reference heading and status label, facts, the free-cancellation line, Seats, the rotation braid and Rotation table at full width, and the request's actions.
- **Billing** (billing admin, `/billing`): the Ready to close table.
- **Invoices** (billing admin and client scheduler, `/invoices`): a search box, an Export CSV link and the Invoices table. At 375 the rows stack into cards.
- **Not found**: any `/requests/<id>`, `/jobs/<id>` or `/board?job=<id>` the viewer may not see, or that does not exist, shows the same Not found page with identical content when loaded fresh.

### Public screens and controls (DP-02, DP-09, DP-13, DP-16, DP-19, DP-25, DP-27, DP-28, DP-44, DP-45)

Only the controls and regions below are public. Everything else is free. `<reference>` is a request reference such as `CR-1001`. `<label>` is a seat label `A` or `B`. `<name>` is an interpreter display name. `<Mon D>` is a short month and day such as `Nov 3`. `<Weekday>` is a short weekday such as `Tue`. Clock times read like `9:00 AM`, always in the agency time zone.

| Where | Role and accessible name | Visible copy |
|---|---|---|
| Sign in | `form "Sign in"` | heading "Sign in to Crosshand Relay" |
| Sign in | `textbox "Email"`, password field labelled `"Password"` | "Email", "Password" |
| Sign in | `button "Sign in"` | "Sign in" |
| Sign in | `alert "Sign-in error"` | see Feedback states |
| Frame | `navigation "Main"` | role links below |
| Frame | links `"Week board"`, `"Credentials"` (coordinator); `"Open seats"`, `"My assignments"`, `"Profile"` (interpreter); `"Requests"`, `"New request"`, `"Invoices"` (client scheduler); `"Billing"`, `"Invoices"` (billing admin) | same as names |
| Frame | `button "Sign out"`; `button "Menu"` (375 wide only) | "Sign out", "Menu" |
| Week board | `region "Week board"` with `heading` level 1 | "Week of <Mon D>" (the Monday) |
| Week board | `button "Previous week"`, `button "Next week"` | "Previous week", "Next week" |
| Week board | `navigation "Days"` with links `"<Weekday> <Mon D>"` | "<Weekday> <Mon D>" and "<n> open" |
| Week board | `checkbox "Only jobs with an open seat"` | same |
| Week board | `region "<Weekday> <Mon D>"` per day column | day heading |
| Week board | `button` per job row named `"<reference>, <start time>, <organisation>, <status label>, <confirmed> of <team size> seats"` | row content; seat counter reads "<confirmed>/<team size>" |
| Job detail | `region "Job detail"` with `heading` level 2 | "<reference>" |
| Job detail | `button "Close job detail"` | "Close" |
| Job detail | `list "Seats"`, one `listitem` per seat named `"Seat <label>: <name, open or taken>"` | same |
| Job detail | `group "Rotation braid"` holding `list "Seat A lane"` and `list "Seat B lane"` (one lane per existing seat) | lane titles "Seat A", "Seat B" |
| Job detail | one `listitem` per segment named `"<start> to <end>, <active or support>, <name, open or taken>"` | the name, "open" or "taken" written in the segment when it fits |
| Job detail | `slider "Playhead"`: value in minutes, minimum 0, maximum the job length, value text equal to the readout | — |
| Job detail | `status "Rotation readout"` | "<clock> · Active: Seat <label>, <name, open or taken> · Support: Seat <label>, <name, open or taken>"; for a one-seat job the support part reads "Support: none" |
| Job detail | `table "Rotation table"`, columns "Start", "End", "Active", "Support", one row per segment; seat cells read "Seat <label>, <name, open or taken>" | same |
| Job detail (coordinator) | `spinbutton "Rotation interval (minutes)"` | same |
| Job detail (coordinator) | `radiogroup "Team size"` with `radio "Team of two"` and `radio "Solo"` | same |
| Job detail (coordinator) | `textbox "Reason for team change"`, `button "Save staffing"` | same |
| Job detail (coordinator) | `button "Broadcast open seats"` | same |
| Job detail (coordinator) | `spinbutton "Actual minutes"`, `button "Mark completed"` | same |
| Job detail (coordinator) | `list "History"`, one `listitem` per history entry | "<clock> <Mon D> · <actor> · <action> · <detail>" |
| Job detail (coordinator) | `status "Job status"` | see Feedback states |
| Job detail (interpreter) | `button "Claim seat A"`, `button "Claim seat B"` (only for open seats while the request is submitted or half-staffed) | same |
| Job detail (interpreter) | `status "Claim status"` | see Feedback states |
| Open seats | `list "Open seats"`; each `listitem` holds `link "View job <reference>"` | "<Setting> · <credential> · <Weekday>, <Mon D> · <start> to <end> · <city> · Seat <label>" |
| My assignments | `list "My assignments"`; each `listitem` holds `link "View job <reference>"` | same line format |
| Profile | `form "Upload certificate"` with `combobox "Credential type"` (options "NIC", "CDI", "SC:L", "EIPA"), file field labelled `"Certificate file"`, `button "Upload certificate"` | same |
| Profile | `status "Upload status"` | see Feedback states |
| Profile | `table "My credentials"`, columns "Type", "Status", "Expires", "Uploaded" | status words "Uploaded", "Verified", "Expired" |
| Credentials | `table "Credentials awaiting review"`, columns "Interpreter", "Type", "Uploaded", "File", "Expiry date", "Action" | same |
| Credentials | per row `button "View file for <name> <type>"`, `textbox "Expiry date for <name> <type>"`, `button "Verify <name> <type>"` | "View file", "Verify" |
| Credentials | `status "Review status"` | see Feedback states |
| Requests | `searchbox "Search requests"` | placeholder "Reference or consumer name" |
| Requests | `table "Requests"`, columns "Reference", "Date", "Time", "Setting", "Status", "Seats"; reference cells are links named `"<reference>"` | status labels from Feedback states |
| New request | `form "New request"` with `combobox "Setting"` (options "Medical", "Education", "Legal"), `textbox "Date"`, `textbox "Start time"`, `spinbutton "Duration (minutes)"`, `combobox "Required credential"`, `textbox "Deaf consumer name"`, `textbox "Street address"`, `textbox "City"`, `textbox "Notes for interpreters"` | same labels; Date shows the hint "YYYY-MM-DD" and Start time the hint "h:mm AM/PM" |
| New request | `button "Save draft"`, `button "Submit request"` | same |
| Request detail | `heading` level 1 | "<reference>" |
| Request detail | free-cancellation line | "Free cancellation until <cutoff>" or, once passed, "Free cancellation ended <cutoff>" |
| Request detail | `button "Edit draft"` and `button "Submit request"` (drafts), `button "Cancel booking"` (draft, submitted, half-staffed, staffed) | same |
| Request detail | `dialog "Cancel booking"` with `button "Confirm cancellation"` and `button "Keep booking"` | quote copy from Feedback states |
| Request detail | `status "Request status"` | see Feedback states |
| Billing | `table "Ready to close"`, columns "Reference", "Organisation", "Date", "Seats", "Actual minutes", "Action"; per row `button "Close <reference>"` | "Close" |
| Billing, Invoices | `status "Billing status"` | see Feedback states |
| Invoices | `searchbox "Search invoices"`, `link "Export CSV"` | same |
| Invoices | `table "Invoices"`, columns "Reference", "Organisation", "Kind", "Billable minutes", "Seats", "Rate", "Amount", "Billing status", "Kill Bill invoice" | kind words "Interpreting", "Late cancellation"; status words "Invoice pending", "Posted" |
| Not found | `heading` level 1 | "Request not found", then "This request doesn't exist or isn't available to you." |

`<cutoff>` reads like `Sun, Nov 1, 9:00 AM EST`: weekday, month and day, clock time, and the agency zone abbreviation in force at that instant.

### Interactions (DP-09, DP-11, DP-16, DP-19, DP-25, DP-28, DP-29, DP-37)

- **Tab order** follows reading order: top bar, the page's own controls left to right and top to bottom, then the open pane. Every focusable control shows a visible focus ring. Enter activates links and buttons; Space toggles checkboxes and activates buttons.
- **Sign in:** Enter in either field submits. A wrong email or password leaves both fields filled and shows the sign-in error.
- **New request entry formats:** Date and Start time are plain text boxes, not date or time pickers.
  - Date accepts `YYYY-MM-DD`, for example `2026-11-03`.
  - Start time accepts `h:mm AM` or `h:mm PM` with one space before AM or PM, hour 1 to 12 with or without a leading zero, AM and PM in either case, for example `9:00 AM` or `01:30 pm`.
  - Both are read as agency wall-clock time and sent together as `starts_at`. An entry in any other format shows its field error from Feedback states and sends nothing.
  - Editing a draft fills both boxes in these formats, for example `2026-11-03` and `9:00 AM`.
- **Week board:**
  - Previous week and Next week move one agency week (Monday to Sunday) and update `?week=`.
  - A day link scrolls the day scroller so that day column lines up at its leading edge.
  - On touch, a sideways swipe moves between day columns and settles on a column edge.
  - The open-seat checkbox hides every row whose request is not submitted or half-staffed.
  - Clicking a row, or pressing Enter on it, opens the job detail, sets `?job=` and moves focus to the pane heading. The board behind it keeps responding to clicks and scrolling.
  - Escape or Close job detail closes the pane and returns focus to the row that opened it.
- **Refresh:** the week board, job detail, request detail, Open seats and Billing re-read from the server every 10 seconds and immediately after the viewer's own action. A row, seat or segment changes on screen only when its data changed. Rows never reorder unless a start time changed. If a job detail that is already open re-reads a request the viewer can no longer read, it keeps its last data on screen unchanged until the viewer leaves it.
- **Playhead:**
  - Pressing anywhere on the braid lanes moves the playhead there, and dragging moves it continuously.
  - With the slider focused, Right or Up arrow adds 1 minute and Left or Down arrow subtracts 1 minute.
  - Shift with an arrow moves one rotation interval.
  - Home goes to 0 and End goes to the job length. Every step is clamped to that range.
  - The readout updates on every change. Moving backwards walks back through the same segments and readouts in reverse.
- **Claim (interpreter):**
  - Pressing Claim seat `<label>` disables both claim buttons and shows the pending copy.
  - Nothing in the braid changes until the server answers.
  - On success the seat's segments fill and the consumer details appear.
  - On any refusal the hatching stays and the refusal copy is announced.
  - On `seat_taken`, that seat's segments and Seats entry change from "open" to "taken" and its claim button disappears, and the job detail stays open showing this. If the seat that went was the request's last open seat, the request is now staffed and the losing interpreter may no longer read it: the open pane keeps that last view, the seat stays marked "taken", the request leaves their Open seats on its next refresh, and loading `/jobs/<id>` fresh shows the Not found page. If another seat is still open, refreshed views keep showing the job with the won seat as "taken".
- **Staffing (coordinator):** choosing a team size that differs from the request's default shows Reason for team change, and that reason is required. Save staffing sends team size, reason and rotation interval together. Broadcast open seats sends the broadcast. Mark completed sends the actual minutes.
- **Cancel booking:**
  - Pressing Cancel booking fetches the quote, then opens the dialog with focus on Keep booking.
  - Confirm cancellation sends the quoted fee. If the server reports the fee changed, the dialog stays open, shows the new quote and the fee-changed copy, and Confirm cancellation then sends the new fee.
  - Keep booking or Escape closes the dialog and returns focus to Cancel booking.
- **Search boxes** filter after typing pauses for a third of a second, or immediately on Enter, using the search rule in API. Clearing the box restores the full list.
- **Billing:** Close `<reference>` disables that button until the server answers. The closed request then leaves Ready to close and appears in Invoices.
- **Credentials:** View file opens the returned link in a new tab. Verify sends the entered expiry date, typed as `YYYY-MM-DD`. A verified row leaves the table.
- **Hover feedback:** on pointer devices rows and buttons darken their rule and background slightly on hover. Touch gets the same change while pressed.

### Visual design (DP-07, DP-26)

- **Colour.** The page ground is a warm parchment off-white and text is a near-black with a cool cast. One strong cobalt blue marks everything you can act on: primary buttons, links, the focus ring, the playhead and the active band in the braid. Support bands use a pale wash of the same blue, framed by a darker edge. A brick red is kept for alerts only: expired credentials, late-cancellation fees, field errors and outage notices. A mid slate grey draws the 1-pixel rules, column dividers and hatch lines. No other hues appear.
- **Type.** Headings and the heavy time labels on rows use Archivo, a sturdy grotesque set bold. Body text and controls use IBM Plex Sans. Numerals that line up in columns (seat counters, minutes, amounts, table times) use IBM Plex Mono. Each heading level is about one fifth larger than the level below it, so a page title is roughly twice the body size. The fonts ship with the app and are licensed under the Open Font License.
- **Density.** The layout is compact and every row is a dispatcher's line: small gaps, ruled separators instead of shadows or cards with rounded corners. Every interactive target still measures at least 44 pixels in both directions.
- **Composition.** A rigid 12-column grid sits under 1-pixel rules. A fixed left rail holds the week, days run as snapping columns, and each job is a full-width row led by a heavy time label and a monospaced seat counter. The job detail opens in a right-hand pane while the board stays visible behind it.
- **Contrast.** All text and all controls meet WCAG 2.2 AA (see the contrast figures in Feedback states).

### Motion and effects (DP-08, DP-29, DP-30)

Motion explains a change in staffing or in what you are looking at. Nothing else moves. Every eased movement starts quickly and settles softly at the end, with no overshoot or bounce.

- **Hover and press feedback:** the colour change takes about an eighth of a second.
- **Detail pane enter and exit:** the pane slides in from the right edge and fades in within about a third of a second. It leaves the same way in the same time.
- **Dialog:** Cancel booking fades in within about an eighth of a second.
- **Board status change:** when a row's staffing status changes, its label and hatch cross-fade to the new state within about a third of a second. No other part of the row moves.
- **Pending:** a pending action shows its pending copy and a disabled button. There are no spinners.
- **Rotation braid, signature:**
  1. When the braid first appears, each crossover diagonal draws from the lane it leaves to the lane it enters within about an eighth of a second.
  2. When the server confirms a seat for the viewer (a claim success, or a refresh that finds the seat newly confirmed), that seat's segments change from hatched "open" to filled with the interpreter's name one at a time, earliest start first.
  3. Each segment's fill sweeps across it from left to right within about a third of a second. The next segment begins 40 milliseconds after the one before it.
  4. Each segment's accessible name changes the moment its fill begins.
  5. A lost claim triggers no fill.
  6. The playhead and readout follow input instantly, with no easing, so the readout always matches the playhead position.
- **Banned:** decorative or looping animation of any kind (pulsing badges, shimmering placeholders, idle drifting). The product uses no 3D scene and no animation library.
- **Reduced motion** (when the system requests it):
  - the pane and dialog appear and disappear instantly
  - board status changes swap instantly
  - braid segments switch from hatched to filled instantly with no stagger
  - crossover diagonals are drawn without animation

  The playhead, keyboard stepping, readout and the Rotation table, which is always shown below the braid, work exactly as normal.

### Feedback states (DP-11, DP-26, DP-29, DP-35, DP-37, DP-42)

Every async action shows a pending state, then success or error copy, in its named live region. All regions are polite except the sign-in alert. A field error appears under its field, marks the field invalid, is linked to the field as its description, and uses the message the API returned for that field, except the two entry-format errors below, which the page shows before sending. If the server cannot be reached at all, the action's region reads "Couldn't reach Crosshand Relay. Check your connection and try again."

Placeholders: `<fee>` and `<amount>` are dollars with two decimals and no thousands separator. `<rate>` is the organisation's contract hourly rate in the same format. `<billable>` is billable minutes. `<seats>` is the number of seats charged. `<n>` is a count. `<date>` reads like `Dec 31, 2030`.

| Region | State | Copy |
|---|---|---|
| alert "Sign-in error" | wrong email or password | "Email or password is incorrect." |
| field error under Date | entry not in the accepted format | "Enter the date as YYYY-MM-DD." |
| field error under Start time | entry not in the accepted format | "Enter the time like 9:00 AM." |
| status "Job status" | broadcast pending | "Sending open-seat emails…" |
| status "Job status" | broadcast sent | "Open-seat email sent to <n> eligible interpreters." |
| status "Job status" | broadcast with no eligible interpreter | "No eligible interpreter is free for this job." |
| status "Job status" | staffing saved | "Staffing saved." |
| status "Job status" | completed | "<reference> marked completed at <n> minutes." |
| status "Job status" | refused state change | "This job can no longer be changed that way. The detail has been refreshed." |
| status "Claim status" | pending | "Claiming seat <label>…" |
| status "Claim status" | won | "Seat <label> confirmed. Consumer details are now shown below." |
| status "Claim status" | seat_taken | "Seat taken: another interpreter confirmed seat <label> first." |
| status "Claim status" | credential_invalid | "Your <credential> credential isn't verified through this job's date." |
| status "Claim status" | schedule_conflict | "You already hold a seat that overlaps this job." |
| status "Claim status" | invalid_transition or not_found | "This job is no longer taking claims." |
| status "Request status" | draft saved | "Draft saved." |
| status "Request status" | submitted | "Request submitted. Seats are open for interpreters." |
| dialog "Cancel booking" | free quote | "Free cancellation until <cutoff>. Cancelling now costs $0.00." |
| dialog "Cancel booking" | late quote | "Late cancellation: $<fee> (<billable> minutes × <seats> confirmed seats at $<rate> per hour)." |
| dialog "Cancel booking" | fee_changed | "The fee is now $<fee> because the free-cancellation window has closed. Review it and confirm again." |
| status "Request status" | cancelled | "<reference> cancelled. Fee: $<fee>. A receipt is on its way by email." |
| status "Billing status" | close pending | "Closing <reference>…" |
| status "Billing status" | closed and posted | "<reference> invoiced at $<amount>." |
| status "Billing status" | closed, Kill Bill unreachable | "<reference> closed at $<amount>. Invoice pending: it posts to billing automatically once the billing system responds." |
| status "Upload status" | pending | "Uploading certificate…" |
| status "Upload status" | success | "Certificate uploaded. A coordinator will verify it." |
| status "Upload status" | payload_too_large | "That file is over 5,000,000 bytes. Choose a smaller file." |
| status "Upload status" | unsupported_type | "Upload a PDF, PNG or JPEG file." |
| status "Upload status", status "Review status" | storage_unavailable | "Certificate storage is unreachable. Nothing was saved or opened; try again in a few minutes." |
| status "Review status" | verified | "Verified <credential> for <name>, valid through <date>." |

**Staffing status on screen.** These labels appear on board rows, in the Requests table and on request detail:

| Status | Label |
|---|---|
| draft | "Draft" |
| submitted | "Open seat" |
| half-staffed | "Half-staffed" |
| staffed | "Staffed" |
| completed | "Completed" |
| invoiced | "Invoiced" |
| cancelled_early | "Cancelled" |
| cancelled_late | "Cancelled (late fee)" |

Status is never shown by colour alone:
- The seat counter is drawn as one small cell per seat beside the label. A confirmed seat's cell is solid and an open seat's cell carries diagonal hatching, so "Open seat" rows are fully hatched, "Half-staffed" rows are half hatched and "Staffed" rows are solid.
- Cancelled rows strike through the reference.
- Braid segments for open or taken seats are hatched and carry their word.

Text meets a contrast of at least 4.5 to 1 against its background (3 to 1 for text at least 24 pixels, or 19 pixels bold). Hatch lines, cell edges, rules that separate states and focus rings meet at least 3 to 1 against the adjacent colour.

In Invoices, a charge whose Kill Bill posting has not happened reads "Invoice pending", and one that has posted reads "Posted" and shows its Kill Bill invoice id. That cell updates on the refresh after posting.

## Backend

### API (DP-02, DP-03, DP-10, DP-14, DP-15, DP-17, DP-23, DP-33, DP-37, DP-39, DP-43, DP-44)

All endpoints live under `/api`, take and return `application/json; charset=utf-8` unless stated, and use a session cookie set by sign-in. Times in JSON are ISO 8601 with the agency's UTC offset, for example `2026-11-03T09:00:00-05:00`. Money is a string in dollars with two decimals. Ids are opaque strings.

**Error body.** Every error has the shape `{"error":{"code":"<code>","message":"<human-readable text>"}}`. A `validation` error adds `"fields":{"<field>":"<message>"}`, and `fee_changed` adds `"quote":<quote>`.

| code | HTTP status |
|---|---|
| `payload_too_large` | 413 |
| `unauthenticated` | 401 |
| `invalid_credentials` | 401 |
| `not_found` | 404 |
| `forbidden` | 403 |
| `idempotency_key_reused` | 409 |
| `invalid_transition` | 409 |
| `seat_taken` | 409 |
| `credential_invalid` | 409 |
| `schedule_conflict` | 409 |
| `fee_changed` | 409 |
| `unsupported_type` | 415 |
| `validation` | 422 |
| `storage_unavailable` | 503 |

The `not_found` body is always exactly `{"error":{"code":"not_found","message":"Not found."}}`.

**Error precedence** (one order for the whole API):
1. Body over its size limit.
2. Unauthenticated.
3. Claim on a taken seat: when an interpreter calls `POST /api/seats/{id}/claim` for a seat that exists and is already confirmed (to anyone, the caller included), the answer is `seat_taken`. This step comes before steps 4 to 7, so it holds even when the request is now staffed, completed or invoiced and the caller can no longer read it.
4. Unknown id, or an id the caller may not see, at any nesting level.
5. Wrong role or cross-origin.
6. Idempotent replay, which returns the stored response, or idempotency key reuse.
7. State conflicts, in the order `invalid_transition`, `seat_taken`, `credential_invalid`, `schedule_conflict`, `fee_changed`.
8. Unsupported type.
9. Validation.
10. Dependency unavailable.

Endpoint rows below name only their own extra errors.

**Search rule.** Every `q` parameter is a case-insensitive substring match: a record matches when the searched text contains `q` anywhere, ignoring letter case. For example, `1006` and `cr-10` both match `CR-1006`. An empty or missing `q` matches everything.

**Request projection by role.** Every role that may read a request gets the base fields:
- `id`
- `reference`
- `setting` (`medical`, `education` or `legal`)
- `required_credential` (`NIC`, `CDI`, `SC:L` or `EIPA`)
- `starts_at`, `ends_at`, `duration_minutes`
- `city`, `status`, `team_size`, `rotation_minutes`
- `seats`

Each role adds fields to the base set:

| Caller | Extra fields |
|---|---|
| client scheduler | base, plus `organisation` (`{"id","name","code"}`), `free_cancel_until`, `consumer_name`, `location_address`, `notes`, `hourly_rate`, `actual_minutes` |
| coordinator, billing admin | everything a client scheduler gets, plus `team_reason` and `history` (entries `{"at","actor","action","detail"}`) |
| interpreter holding a confirmed seat on the request | base, plus `consumer_name`, `location_address`, `notes` |
| any other interpreter | base only |

**Seat projection.** A seat is `{"id","label","status","interpreter"}`. `status` is `open` or `confirmed`, and `interpreter` is `null` while the seat is open. For a confirmed seat, `interpreter` depends on the caller:

| Caller | `interpreter` for a confirmed seat |
|---|---|
| coordinator, billing admin | `{"id","display_name","full_name","email","phone","home_area","pay_rate","credentials"}` |
| client scheduler | `{"display_name","credentials"}` |
| interpreter holding a confirmed seat on the request | `{"display_name","credentials","phone"}` |
| any other interpreter | `null` (the viewer sees the seat as "taken") |

`credentials` is the alphabetical list of the interpreter's credential codes that are verified and unexpired today in agency time. No response ever carries a field outside these lists.

**Endpoints.**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | — | 200 `{"status":"ok"}` | — |
| `POST /api/session` | anyone | `{"email","password"}` | 200 `{"user":<user>}` plus an HttpOnly, SameSite=Lax session cookie | `invalid_credentials` |
| `GET /api/me` | signed in | — | 200 `{"user":<user>}` | — |
| `DELETE /api/session` | signed in | — | 204 | — |
| `GET /api/requests` | coordinator, billing admin (all organisations), client scheduler (own organisation) | query: `week=YYYY-MM-DD` (the agency week containing that date), `status=<status>`, `q=<text>` (searched in reference, and in consumer name for roles that see it) | 200 `{"requests":[<request>]}` ordered by `starts_at`, then `reference`; the coordinator board omits drafts by passing statuses | — |
| `POST /api/requests` | client scheduler | `{"setting","starts_at":"YYYY-MM-DDTHH:MM","duration_minutes","consumer_name","location_address","city","notes","required_credential"}` (`notes` and `required_credential` optional) | 201 `<request>` in `draft` | `validation` |
| `GET /api/requests/{id}` | coordinator, billing admin, client scheduler (own organisation), interpreter (a request they hold a confirmed seat on, or one that is submitted or half-staffed) | — | 200 `<request>` | — |
| `PATCH /api/requests/{id}` | client scheduler | any subset of the create fields | 200 `<request>` | `invalid_transition` unless draft; `validation` |
| `POST /api/requests/{id}/submit` | client scheduler | `{}` | 200 `<request>` | `invalid_transition`; `validation` (`starts_at` now in the past) |
| `PATCH /api/requests/{id}/staffing` | coordinator | `{"team_size":1 or 2,"team_reason","rotation_minutes"}` (any subset) | 200 `<request>` | `invalid_transition`; `validation` |
| `POST /api/requests/{id}/broadcast` | coordinator | `{}` | 200 `{"emailed":<n>}` | `invalid_transition` |
| `GET /api/open-seats` | interpreter | — | 200 `{"open_seats":[{"seat_id","seat_label","request":<request>}]}` ordered by start | — |
| `POST /api/seats/{id}/claim` | interpreter | `{}` | 200 `{"seat":<seat>,"request":<request>}` | `invalid_transition`, `seat_taken`, `credential_invalid`, `schedule_conflict` |
| `GET /api/assignments` | interpreter | — | 200 `{"assignments":[{"seat_id","seat_label","request":<request>}]}` ordered by start | — |
| `POST /api/requests/{id}/complete` | coordinator | `{"actual_minutes":<integer 1 to 720>}` | 200 `<request>` | `invalid_transition`; `validation` |
| `GET /api/requests/{id}/cancellation-quote` | client scheduler (own organisation), coordinator | — | 200 `<quote>` | `invalid_transition` |
| `POST /api/requests/{id}/cancel` | client scheduler (own organisation), coordinator | header `Idempotency-Key`; body `{"expected_fee":"<fee>"}` | 200 `{"request":<request>,"invoice":<invoice> or null}` | `idempotency_key_reused`, `invalid_transition`, `fee_changed`; `validation` |
| `POST /api/requests/{id}/close` | billing admin | header `Idempotency-Key`; body `{}` | 200 `{"request":<request>,"invoice":<invoice>}` | `idempotency_key_reused`, `invalid_transition`; `validation` |
| `GET /api/invoices` | billing admin (all), client scheduler (own organisation) | query `q=<text>` (searched in the request reference) | 200 `{"invoices":[<invoice>]}` newest first | — |
| `GET /api/invoices.csv` | same as above | query `q`, same rule | 200 `text/csv; charset=utf-8` | — |
| `GET /api/me/credentials` | interpreter | — | 200 `{"credentials":[<credential>]}` | — |
| `POST /api/me/credentials` | interpreter | `multipart/form-data` with fields `credential_type` and `file` | 201 `<credential>` in `uploaded` | `unsupported_type`; `validation`; `storage_unavailable` |
| `GET /api/credentials` | coordinator | query `status=uploaded` (default), `verified`, `expired` or `all` | 200 `{"credentials":[<credential> with "interpreter":{"id","display_name","full_name"}]}` | — |
| `POST /api/credentials/{id}/verify` | coordinator | `{"expires_on":"YYYY-MM-DD"}` | 200 `<credential>` | `invalid_transition` unless uploaded; `validation` |
| `GET /api/credentials/{id}/file` | coordinator | — | 200 `{"url":"<signed MinIO URL>","expires_in_seconds":60}` | `not_found` for credentials without a file; `storage_unavailable` |

The other shapes used in the table:
- `<user>` is `{"id","role","display_name","email","organisation"}`. `role` is one of `coordinator`, `interpreter`, `client_scheduler`, `billing_admin`. `organisation` is `{"id","name","code"}` for client schedulers and `null` otherwise.
- `<quote>` is `{"kind":"early" or "late","fee","free_cancel_until","billable_minutes","seats_charged","hourly_rate"}`.
- `<invoice>` is `{"id","request_reference","organisation":{"id","name","code"},"kind":"interpreting" or "late_cancellation","billable_minutes","seats","hourly_rate","amount","billing_status":"pending" or "posted","killbill_invoice_id" or null,"created_at"}`.
- `<credential>` is `{"id","credential_type","status":"uploaded","verified" or "expired","expires_on" or null,"uploaded_at","file_name" or null}`.

**Validation.**
- **Request fields:**
  - `setting` must be one of the three values.
  - `starts_at` must be a valid local agency date-time later than now and must exist in the agency time zone.
  - `duration_minutes` must be an integer from 30 to 480, both inclusive.
  - `consumer_name` must be 1 to 120 characters, `location_address` 1 to 200 characters, `city` 1 to 80 characters, and `notes` at most 2,000 characters.
  - `required_credential` must be one of the four codes. When omitted it defaults to `NIC` for medical, `EIPA` for education and `SC:L` for legal.
- **Staffing fields:** `rotation_minutes` must be an integer from 20 to 30, both inclusive. `team_reason` must be 10 to 500 characters whenever the resulting team size differs from the default.
- **Verify:** `expires_on` must be a real date that is today or later in agency time.
- **Upload:** `credential_type` must be one of the four codes and the file must be present and non-empty.
- **Close and cancel:** `Idempotency-Key` must be present and 1 to 64 visible ASCII characters, reported as field `Idempotency-Key`. `expected_fee` must be a dollar string with two decimals.

**CSV export.** The file is UTF-8 with lines ending in CRLF. A field containing a comma, a double quote or a line break is wrapped in double quotes, with any double quote inside it doubled; other fields are written bare. The header row is exactly `reference,organisation,kind,billable_minutes,seats,hourly_rate,amount,billing_status,killbill_invoice_id,created_at`. It is followed by one row per invoice the caller may see, in the same order as `GET /api/invoices`. Each cell holds:
- `reference`: the invoice's `request_reference`, for example `CR-1006`
- `organisation`: the organisation's name, for example `Lakemont State University`
- `kind`, `billing_status`: the API value (`interpreting` or `late_cancellation`; `pending` or `posted`)
- `billable_minutes`, `seats`: the integer
- `hourly_rate`, `amount`: the API dollar string with two decimals, for example `388.13`
- `killbill_invoice_id`: the id, or an empty cell while it is null
- `created_at`: the API timestamp, for example `2026-11-03T09:00:00-05:00`

### Business rules (DP-11, DP-12, DP-14, DP-17, DP-20, DP-21, DP-22, DP-24, DP-34, DP-36, DP-38, DP-39, DP-40, DP-43)

**Organisation isolation.**
- A client scheduler belongs to one organisation. In every list, search and CSV export they see only that organisation's requests, seats and invoices.
- Any request, seat or invoice id that belongs to another organisation answers exactly as an id that does not exist (`not_found`), in the API and on the Not found page. This holds for nested ids as well.
- An interpreter asking for a request they may not read, or a seat on such a request, gets `not_found` too, apart from the taken-seat claim answer in API's precedence step 3.
- A role calling an endpoint not granted to it gets `forbidden`.

**Request lifecycle.** Statuses are `draft`, `submitted`, `half-staffed`, `staffed`, `completed`, `invoiced`, `cancelled_early` and `cancelled_late`. The only legal moves are:

| Action | From | To |
|---|---|---|
| submit (client scheduler) | draft | submitted, opening seats |
| edit (client scheduler) | draft | draft |
| claim a seat, or change team size | submitted, half-staffed, staffed | status derived from seats (below) |
| change rotation interval, broadcast | submitted, half-staffed (broadcast); submitted, half-staffed, staffed (rotation) | unchanged |
| complete (coordinator) | half-staffed, staffed | completed |
| close (billing admin) | completed | invoiced (even while its Kill Bill posting is pending) |
| cancel (client scheduler or coordinator) | draft | cancelled_early |
| cancel | submitted, half-staffed, staffed | cancelled_early or cancelled_late by the cutoff rule |

Every other action on a request answers `invalid_transition`, including:
- staffing changes on drafts or finished requests
- broadcasting a staffed request
- completing a submitted request
- closing anything but a completed request
- cancelling a completed, invoiced or cancelled request

Completion does not check the clock: the coordinator records it once the job has happened.

**Derived staffing status.** After every claim and every team-size change, a request that is not draft, completed, invoiced or cancelled takes the status that matches its seats:
- `submitted` when no seat is confirmed
- `half-staffed` when some but not all seats are confirmed
- `staffed` when every seat is confirmed

**Seats, team size and rotation.**
- Submitting opens seat A, plus seat B when `duration_minutes` is more than 60. A job of exactly 60 minutes gets one seat. That seat count is the request's default team size.
- The coordinator may set `team_size` to 1 or 2. A size other than the default needs `team_reason`, which is recorded on the request and in history.
- Raising to 2 opens seat B, or seat A if A was the removed one.
- Lowering to 1 removes an open seat and keeps the remaining seat's label. When both seats are open, seat B is removed and seat A remains. When one seat is confirmed, the open one is removed. Lowering to 1 while both seats are confirmed answers `invalid_transition`.
- `rotation_minutes` defaults to 20.
- **Rotation segments.** A job of length L with interval R has ⌈L ÷ R⌉ segments. Segment k (counting from 0) runs from minute k×R to the smaller of (k+1)×R and L. Seat A holds the active role in even segments and seat B in odd ones, and the other seat supports. For a one-seat job, every segment is active on that seat and there is no support. The playhead at minute m falls in segment k = the smaller of ⌊m ÷ R⌋ and the last segment index.

**Claims and concurrency.**
- When several claims for one open seat arrive together, exactly one is confirmed: the first to be committed. Every other claim for that seat answers `seat_taken`, sends no email and leaves the winner untouched. This holds when the winning claim made the request staffed, because a claim on a confirmed seat answers `seat_taken` ahead of visibility and lifecycle checks (API precedence step 3).
- A later claim for a seat that is already confirmed, the caller's own included, also answers `seat_taken`.
- A claim for an open seat on a request that is not submitted or half-staffed answers `invalid_transition`.
- **Eligibility.** The interpreter must hold a credential of the request's `required_credential` that is verified with `expires_on` on or after the job's date in agency time. The claim date does not matter. Otherwise the claim answers `credential_invalid`.
- **No double booking.** An interpreter may not hold two confirmed seats whose windows overlap on requests that are not cancelled. A window runs from the start up to, but not including, the end, so back-to-back jobs are allowed. Two seats on the same request always overlap. Otherwise the claim answers `schedule_conflict`. This holds under simultaneous claims too.
- Open seats lists only seats the caller could claim right now: the request is submitted or half-staffed, the seat is open, the caller is eligible and the window does not overlap.

**Private consumer details.** The consumer name, street address and appointment notes are private. They appear only:
- in API responses and screens for the client scheduler of the owning organisation, coordinators and billing admins
- for an interpreter, only while signed in and holding a confirmed seat on that request

They never appear in any email, CSV, history `detail`, Kill Bill description or the open-seat list.

**Agency time.**
- The agency's time zone is `America/New_York`. Every date, week, cutoff and expiry is decided in it, and every screen shows clock times in it whatever the browser's zone.
- `starts_at` is entered as local agency wall-clock time. A local time skipped when clocks spring forward is rejected with a `validation` error on `starts_at`. A local time that occurs twice when clocks fall back means its first occurrence.
- A week runs from Monday 00:00 to the end of Sunday.
- A verified credential is expired from the day after its `expires_on`, in agency time. Its `status` reads `expired` from then on, in every response and on every screen, with no action needed.

**Cancellation cutoff and fee.**
- `free_cancel_until` is the request's local start time on the calendar day two days before the start date, in agency time. If that local time does not exist that day, it is the first instant after the skipped hour; if it occurs twice, the first occurrence.
- Across a clock change this differs from 48 elapsed hours by one hour. For example, a job starting at 9:00 AM on 2027-03-15 is free to cancel until `2027-03-13T09:00:00-05:00`, which is 47 elapsed hours before start. A job starting at 9:00 AM on 2027-11-08 is free to cancel until `2027-11-06T09:00:00-04:00`, which is 49 elapsed hours before start.
- A cancellation received before `free_cancel_until` is `cancelled_early` with fee 0.00. One received at or after it is `cancelled_late`.
- The late fee uses the charge rule, with the scheduled `duration_minutes` as the time and the seats confirmed at that moment as the seat count. A late cancellation with no confirmed seat costs 0.00 and creates no invoice.
- The quote endpoint and the cancel endpoint compute the fee the same way. If `expected_fee` differs from the fee at the moment of cancelling, the cancel answers `fee_changed` with the current quote and changes nothing.
- Cancelling frees every seat of the request.

**Charge rule (exact money).**
- Billable minutes are the larger of 120 and the time rounded up to the next multiple of 15. Time is the actual minutes at close, or the scheduled minutes for a late cancellation.
- Amount = billable minutes × contract hourly rate × seats ÷ 60. It is computed in exact decimal arithmetic and rounded once, half up, to the cent, on the final amount only. Seats are the confirmed seats.
- The amount is computed once, when the close or cancellation is accepted, and stored. That stored amount is what appears in the API, Invoices, CSV, Kill Bill and email.
- For example, with the seed data at start, closing `CR-1006` (127 actual minutes, two seats, rate 86.25) gives 135 billable minutes and 388.13. Closing `CR-1007` (40 actual minutes, one seat, rate 110.00) gives 120 billable minutes and 220.00.

**Idempotency (close and cancel).**
- A repeated `Idempotency-Key` from the same user, on the same endpoint and request id, with the same body, returns the stored status and body of the first response. It has no new effect: no second invoice, email or history entry.
- The same key with a different endpoint, request id or body answers `idempotency_key_reused`.
- Keys are kept for at least 24 hours.
- Without a replay, a second close or cancel of a request already moved on answers `invalid_transition`.

**History.** Every state change and every claim attempt by an interpreter that is not refused at API precedence steps 1, 2, 4 or 5 writes one history entry on the seat's request, including a `seat_taken` answer given at step 3 to an interpreter who can no longer read the request. The actions are:
- `created`, `submitted`
- `claim_won`, `claim_lost` (with the refusal code as detail)
- `team_changed` (with the reason), `rotation_changed`
- `broadcast` (with the count)
- `completed`, `closed`, `cancelled` (with kind and fee)

### Services (DP-15, DP-18, DP-33, DP-35, DP-38, DP-41, DP-42)

**Postgres** is the system of record for the agency, organisations, people, requests, seats, credentials, contract rates, charges, history, idempotency keys, and the queue of outgoing emails and Kill Bill postings. The schema is applied idempotently every time the app starts serving. Several app instances may share one database.

**Kill Bill.**
- Each client organisation has one account, with external key `crosshand-<organisation code>` (for example `crosshand-HPMC`), the organisation's name and currency USD. The account is created the first time that organisation is charged.
- Each charge (a close or a late-cancellation fee above 0.00) becomes exactly one external-charge invoice item on that account, with amount equal to the stored amount and currency USD. The description is `<reference> interpreting` for a close or `<reference> late cancellation` for a fee.
- The Kill Bill invoice id is stored on the charge as `killbill_invoice_id`, and its `billing_status` becomes `posted`.
- The retry and exactly-once rules when Kill Bill is unreachable are in Server boundary.

**Mailpit (email).** Every email comes from `MAIL_FROM`, which is `Crosshand Relay <relay@crosshand.example>`. No email ever contains the private consumer details. The app sends these six emails:

| Trigger | To | Subject | Body states |
|---|---|---|---|
| Broadcast | each eligible interpreter who is free for the window, once per broadcast | `Open seat: <Setting>, <credential>, <Mon D>, <start> to <end>, <city>` | setting, required credential, date, time window, city, number of open seats, and a link to `<APP_PUBLIC_URL>/open-seats`; nothing else about the job |
| Seat won | the winner, and the interpreter confirmed on the other seat if any (one email each) | `Seat <label> confirmed: <reference>, <Mon D>` | time window, city, the teammate's display name or "Seat <other label> is still open" |
| Request becomes staffed | the request's client scheduler | `Fully staffed: <reference>, <Mon D>` | each seat's interpreter display name and credential badges |
| Cancellation | the request's client scheduler | `Cancelled: <reference>, fee $<fee>` | early or late, the fee, billable minutes and seats charged |
| Cancellation | each interpreter confirmed at that moment | `Assignment cancelled: <reference>, <Mon D>` | date and time window |
| Close | the request's client scheduler | `Charges for <reference>: $<amount>` | amount, billable minutes, seats and hourly rate |

**MinIO.**
- Certificate files go into the bucket named by `S3_BUCKET` under the key `credentials/<interpreter id>/<credential id>.<pdf, png or jpg>`, with the content type of the detected file type. The uploaded file name is never part of the key.
- The bucket stays private: the app never sets a public policy or a public-read object.
- Coordinators reach files only through `GET /api/credentials/{id}/file`, which returns a signed link valid for 60 seconds.
- When MinIO is unreachable, upload and file-link requests answer `storage_unavailable` and nothing is stored. Every other feature works normally, and the copy is in Feedback states.

### Seed data (DP-02, DP-25, DP-34, DP-40)

The app seeds the following once, when it starts on a database with no agency. Every person, organisation, address and phone number here is invented. Every seeded person's password is `relay-demo-2026`. D is the agency date on the day of seeding.

**Agency:** Crosshand Interpreting Collective, time zone `America/New_York`.

**Client organisations:**

| Code | Name | Hourly rate | Client scheduler (display name, email) |
|---|---|---|---|
| HPMC | Harbor Point Medical Center | 97.50 | Jordan Baptiste, `sched@harborpoint.example` |
| LKSU | Lakemont State University | 86.25 | Avery Lindqvist, `sched@lakemont.example` |
| ECCC | Ellery County Circuit Court | 110.00 | Sam Whitfield, `sched@ellerycourt.example` |

**Staff:** coordinator Priya Velasco, `coord@crosshand.example`; billing admin Morgan Reyes-Hall, `billing@crosshand.example`.

**Interpreters.** No seeded credential has a stored file. Each credential in the Credentials column is verified with `expires_on` 2030-12-31. Malik O. additionally holds an EIPA credential that was verified with `expires_on` D−1, so at start it reads `expired`, does not count as a badge and does not make him eligible for EIPA seats.

| Display name | Full name | Email | Phone | Home area | Pay rate | Credentials |
|---|---|---|---|---|---|---|
| Rosa D. | Rosa Delgado-Finch | `rosa@interpreters.example` | (555) 010-0141 | North Halden | 58.00 | NIC |
| Theo M. | Theo Marchetti | `theo@interpreters.example` | (555) 010-0142 | Marrow Bay | 55.00 | NIC |
| Kemi A. | Kemi Adeyemi | `kemi@interpreters.example` | (555) 010-0143 | Ellery | 64.00 | NIC, SC:L |
| Wren C. | Wren Castellanos | `wren@interpreters.example` | (555) 010-0144 | Marrow Bay | 50.00 | EIPA |
| Malik O. | Malik Osei | `malik@interpreters.example` | (555) 010-0145 | Halden | 60.00 | CDI (plus the expired EIPA above) |
| Ines P. | Ines Park | `ines@interpreters.example` | (555) 010-0146 | South Halden | 56.00 | NIC |

**Requests.** Times are local agency times. New references continue upward from the highest existing one.

| Ref | Org | Setting, credential | Start | Minutes | Team, rotation | City, address | Consumer, notes | Status and seats |
|---|---|---|---|---|---|---|---|---|
| CR-1001 | HPMC | medical, NIC | D+3 9:00 AM | 120 | 2, 20 | Halden, 400 Harbor Point Way | Elena Brandt, "Cardiology follow-up; patient prefers interpreters to the left of the screen." | half-staffed: A Rosa D., B open |
| CR-1002 | LKSU | education, EIPA | D+2 1:00 PM | 50 | 1, 20 | Marrow Bay, 12 Quarry Hall | Devon Achterberg, "BIOL 210 lab; vocabulary list sent to the coordinator." | submitted: A open |
| CR-1003 | ECCC | legal, SC:L | D+4 8:30 AM | 210 | 2, 30 | Ellery, 1 Courthouse Square, Courtroom 4B | Marisol Varga, "Arraignment; proceedings team only." | submitted: A open, B open |
| CR-1004 | HPMC | medical, NIC | D+1 2:00 PM | 90 | 2, 20 | Halden, 400 Harbor Point Way | Graham Oduya, "Pre-surgical consult." | staffed: A Theo M., B Rosa D. |
| CR-1005 | HPMC | medical, NIC | D+10 10:00 AM | 60 | — | Halden, 400 Harbor Point Way | Lena Petrakis, "" | draft |
| CR-1006 | LKSU | education, NIC | D−2 10:00 AM | 120 | 2, 20 | Marrow Bay, 3 Founders Hall | Priyanka Moss, "Thesis defence." | completed, actual 127 minutes: A Rosa D., B Theo M. |
| CR-1007 | ECCC | legal, SC:L | D−1 1:00 PM | 45 | 1, 20 | Ellery, 1 Courthouse Square, Courtroom 2A | Victor Halloran, "Status hearing." | completed, actual 40 minutes: A Kemi A. |

At start there are no charges, no Kill Bill accounts, no stored certificate files and no emails.

## Technical requirements

### Deployment (DP-01)

The runtime is Node.js 22 with npm. The app is TypeScript, compiled during build. `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The serve command binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or 4173 when that is unset, and serves both the API and the built frontend from that one origin. `GET /api/health` answers HTTP 200 with `{"status":"ok"}` as soon as the server accepts connections, whether or not Kill Bill, MinIO or Mailpit is reachable.

### Configuration and secrets (DP-05)

The app reads these variables at start:
- **Database:** `DATABASE_URL`
- **Kill Bill:** `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- **Email:** `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- **MinIO:** `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- **Server:** `APP_PUBLIC_PORT`, and `APP_PUBLIC_URL` (the base for links in emails; when unset, `http://localhost:<port>`)

No credential or service URL is written in source, and none reaches the browser in any page, script, API response or header. The only exception is the signed certificate link a coordinator asks for.

### Server boundary (DP-04, DP-32, DP-35, DP-42)

- **Origin.** The app is same-origin only. A state-changing request (POST, PATCH, DELETE) whose `Origin` header names another origin answers `forbidden`. No cross-origin access headers are sent.
- **Body limits.**
  - A JSON body over 65,536 bytes answers `payload_too_large`. Exactly 65,536 bytes is allowed.
  - A JSON endpoint called with another content type answers `unsupported_type`.
  - An upload request body over 5,250,000 bytes is refused with `payload_too_large` before it is read in full.
- **Certificate uploads.**
  - The file may be at most 5,000,000 bytes, and exactly 5,000,000 is allowed. A larger file answers `payload_too_large`.
  - The type is judged by the file's leading bytes: a PDF, PNG or JPEG signature. The name, extension and declared content type are ignored, so SVG, HTML, scripts and archives answer `unsupported_type` whatever they are called.
  - The original file name is kept only for display, cut to its last path part with control characters removed. It is never used to build a storage path.
- **Never served.** The server never serves source files, `run.json`, package manifests or lockfiles, environment files, dotfiles, or anything outside the built frontend assets and the API. Such paths answer 404.
- **Boot with a dependency down.** The app starts and serves when Kill Bill, MinIO or Mailpit is unreachable, and recovers on its own when the dependency returns, with no restart.
- **Email queue.** Emails are queued in Postgres and retried every 10 seconds until Mailpit accepts them. An action never fails because email is slow or down.
- **Kill Bill outage.**
  - A close or late fee made while Kill Bill is unreachable is accepted with its amount stored and `billing_status` `pending`.
  - Pending charges are retried every 10 seconds and post within 30 seconds after Kill Bill is reachable from any running instance.
  - Each charge posts exactly once in total, across retries, timeouts and several instances sharing the database.

### Browser support and performance (DP-06)

The app supports current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800. The week board is usable within three seconds of navigation on the seed data. Your own action's result shows on screen within one second of the server's answer. Other people's changes appear within the 10-second refresh.

## Working rules

- IF-01: `/app/run.json` is valid JSON containing exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its version and licence.
- IF-03: Every shipped package (the production tree from `npm ls --omit=dev --all --json`) is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD. Bundled fonts are OFL-1.1.
- IF-04: No datastore is used beyond Postgres, Kill Bill and MinIO: no SQLite, Redis, embedded database or certificate files kept on local disk.
- IF-05: The provided service configuration and its seeded development credentials are left unchanged.
- IF-06: Fonts and every other frontend asset are served from the app itself; no page loads anything from a third-party origin at runtime.
- IF-07: `/app/package-lock.json` is committed and matches `package.json`.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` in code that handles requests, seats, credentials or charges.
- Names in the code use this brief's domain terms: request, seat, claim, team size, rotation interval, segment, credential, cutoff, charge and invoice.
- Each domain rule is decided in exactly one place in the source: derived staffing status, claim eligibility, overlap, the free-cancellation cutoff, the charge rule and the field lists by role.
- Money is handled as exact decimals or integer cents. Floating-point arithmetic never touches an amount.
- There is no abstraction with a single implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the rules above make impossible, and every error leaves the server in the one error shape from API.
- The source contains no feature, endpoint, screen or setting beyond this brief.
