# Tandem Hands Collective Relayline

Relayline is the dispatch and billing desk for Tandem Hands Collective, a regional American Sign Language interpreting agency. Four kinds of people use it:

- **Dispatch coordinators** turn requests from hospitals, school districts, courts and employers into fully covered assignments.
- **Staff interpreters** claim open work and collect their prep materials.
- **Client requesters** book interpreters and cancel bookings.
- **The billing manager** turns finished and late-cancelled work into invoices that match each client contract.

Build one web app with its own API. It keeps every record in Postgres, sends email through the Mailpit SMTP sink, posts invoice charges to Kill Bill and reads them back, and stores prep materials in a MinIO bucket.

Out of scope: self sign-up, password reset, phone or video remote interpreting, interpreter payroll, payment collection, holiday calendars, other datastores, and any feature this brief does not name. Every account is seeded.

## Problem and users

Small and mid-sized ASL agencies still dispatch from spreadsheets, group texts and phone calls. For each request, a coordinator has to:

- find a certified interpreter whose credential fits the setting;
- decide whether the job is long or complex enough to need a second interpreter rotating every 15 to 30 minutes;
- chase the client for agendas and witness lists;
- apply the contract terms from memory.

When that breaks, someone pays:

- A Deaf patient or student turns up with no interpreter, or with one interpreter working alone well past the point where accuracy drops.
- Two interpreters are each told they hold the same team seat, and one of them loses a paid day.
- A request sent twice over a flaky hospital network becomes two bookings, and two interpreters drive to the same appointment. A completion recorded twice becomes two charges.
- A requester whose session ended in another tab loses a long, carefully typed request.
- Late cancellations go unbilled, or invoices go out with amounts the client disputes, and nobody can show what the billing system really holds.
- Hospital schedulers end up seeing interpreters' phone numbers and pay rates.

Enterprise interpretation suites are priced for call centres and built around phone and video work. They leave on-site team coverage, prep-material access and per-contract billing to the coordinator.

- **Dispatch coordinator** (daily): turns every incoming request into a fully covered solo or team assignment with the right credentials, and repairs coverage within minutes when someone withdraws, often with the board refreshing under them, the browser's Back button in constant use, and courthouse or hospital Wi-Fi dropping responses.
- **Staff interpreter** (daily): sees and claims open assignments that match their credentials, often from a phone, gets prep materials ahead of time, and knows exactly which rotation turns are theirs. Their device clock may be wrong, and their downloads are often abandoned part way on poor networks.
- **Client requester** (weekly): books interpreters for their organisation's appointments, often with consumers' names and file names in many languages and on unreliable networks, sometimes with several tabs open, tracks whether each one is covered, and cancels knowing the charge in advance, sometimes by keyboard alone and sometimes from a phone or tablet.
- **Billing manager** (weekly): turns completed and late-cancelled assignments into correct invoices for each client contract, keeps contract rates current, and settles disputes using the amounts the billing system actually holds.

## Journeys

1. **A requester books a long appointment on a flaky network, across an ended session.**
   - Start: Lena Torres at Riverbend Regional Hospital has signed in and sees the organisation's bookings in two tabs of the same browser. Lena's laptop is set to a different time zone from the agency's.
   - Actions: in the first tab Lena opens New request and enters a medical consultation of three hours and forty-five minutes in agency time. The Deaf consumer's name is written in Vietnamese with its accents, and the notes for the agency contain an emoji. The character hints under Title and Notes for the agency count up while Lena types, and a title at exactly the limit is accepted. Meanwhile Lena signs out in the second tab. Lena presses Submit request: Sign in to continue opens over the kept draft. A wrong password is refused with the draft still intact; the right password signs Lena in and the request goes through by itself. On another booking, Lena's first press of Submit request loses its response on the hospital network: the dialog stays open with everything typed and says the server could not be reached. Lena presses Submit request again.
   - End: exactly one booking exists for each draft. Each appears in Lena's list with its reference, its start time in agency time and the label Uncovered, and its text reads back exactly as typed. The long one needs two seats because it is longer than the solo threshold.
2. **The coordinator triages and posts an open call while the board refreshes.**
   - Start: Dana Okafor opens the coverage board and moves to the next day. The new row is printed in signal yellow with a hatched Uncovered marker.
   - Actions: Dana selects the row. The rotation weave shows one hatched bar labelled uncovered. Dana posts the open call just as a board refresh is in flight, then reloads the tab and uses the browser's Back and Forward.
   - End: the row reads Open call and never flickers back to Submitted, and the success announcement stays. After the reload the board shows the same day with the same booking selected. Back goes to the previous day with nothing selected, and Forward brings back the day and the selection. The Seats panel states the fixed date and time the open call closes. When that moment passes, the booking leaves every interpreter's Open calls list within one refresh, and Dana's Seats panel says to assign directly.
3. **Two interpreters race for the last team seat while their lists keep refreshing.**
   - Start: Jordan Reyes claims the first seat from Open calls, although Jordan's laptop clock is hours wrong. The weave becomes a solid block for the first hour, then a hatched "relief needed" stretch.
   - Actions: Avery Chen and Casey Morgan both press Claim seat on the second seat at the same moment, while both their lists are refreshing.
   - End: the row moves to the winner's My assignments only once the server confirms, and never drifts back under Open calls. The loser sees the already-filled message, the row leaves their Open calls, focus lands on a neighbouring row or the Open calls region, and the message stays through every later refresh. The weave splits into alternating solid and striped turns and the coverage figure counts up to 100% covered. The booking reads Covered, and each confirmation email arrives once. Lena opens the booking and sees interpreter cards with name, initials and credentials only.
4. **The coordinator staffs a court date directly.**
   - Start: a legal booking for Harlan County Court has two vacant seats.
   - Actions: Dana opens Assign seat 1 and types "ri" into Find interpreter. Only Riley Brooks remains, even though the answer for "r" arrived late. Dana picks Riley. On seat 2, Quinn Halvorsen becomes busy elsewhere while the dialog is open, so pressing Assign is refused. The dialog stays open, Quinn's choice greys out with "Busy at this time", and Dana picks Sasha Lindqvist, the remaining court-certified interpreter. Each result is announced as it happens.
   - End: both seats are held, and the weave splits into alternating Riley and Sasha turns at the court contract's interval. Ruth Adeyemi, the court's requester, opens the booking and sees interpreter cards that show only name, initials and credentials.
5. **A withdrawal is repaired while the board keeps refreshing.**
   - Start: Jordan withdraws from a covered team booking on a phone. While Jordan reads the detail, nothing in the hidden list can be reached by Tab or by a screen reader.
   - Actions: Jordan taps Withdraw. The Withdraw from assignment sheet fills the phone screen with Keep seat focused. Jordan taps Confirm withdrawal. The list comes back with focus on its first row, Jordan's turns collapse right to left into hatched gaps, the coverage figure counts down, and Jordan's prep access ends at once. Within one board refresh, Dana sees the row turn Partly covered, opens Assign interpreter and arrows to a replacement. The board keeps refreshing: the dialog, the chosen interpreter and the focus stay put, and the weave stays still. If someone else fills that seat first, the dialog says so in place.
   - End: Dana assigns the replacement and the booking returns to Covered.
6. **Prep materials reach only the team, exactly as sent, on poor networks.**
   - Start: the court booking already holds nine prep files. Ruth attaches three witness-list versions with Vietnamese, accented and emoji file names at the same moment; another upload of a slide deck breaks off part way on the court's network.
   - Actions: exactly one of the three is accepted, and the other two are refused with the file-limit message. The broken-off upload leaves nothing behind. Each assigned interpreter downloads the files from the Prep materials panel; on a hospital network, interpreters start and abandon a large slide-deck download many times.
   - End: the booking lists exactly ten files, each backed by one stored file. Each downloaded file carries the same name Ruth's file had and the same bytes, and a full download after the abandoned ones is still fast and exact. An interpreter who has been released can no longer fetch any of them, even with a link fetched earlier.
7. **A requester cancels by keyboard, on any screen size, with the charge shown up front.**
   - Start: Sam Whitfield, whose browser runs in Tokyo time, tabs to Cancel booking on a school meeting. On a phone the dialog fills the screen. On a tablet it is a narrow centred sheet.
   - Actions: focus lands on Keep booking while the dialog checks the agency's two-business-day rule. Sam presses Escape, changes their mind and reopens Cancel booking straight away while an interpreter claims a seat; the reopened dialog stays open and shows only its own fresh quote. If an interpreter claims a seat between the quote and the confirmation, the new charge is read out and the button becomes Confirm new charge. Sam confirms it.
   - End: focus lands on the booking heading, the booking reads Cancelled or Cancelled (late), and the requester and each seat holder receive one notice.
8. **Work is completed, billed and reconciled against Kill Bill.**
   - Start: Morgan Ellis adds a Maple Valley contract rate that starts on a future date. Dana completes two Maple Valley sessions: one starting at 23:30 agency time the evening before the new rate begins, and one at 00:15 on its first day. On the courthouse Wi-Fi, the response to one Record completion is lost and Dana presses it again.
   - Actions: the retried completion replays the first one, so there is still one line and one charge. Each line carries the rate in force on its own agency-local date. The Billing panel shows Pending sync until Kill Bill confirms the charge, then Synced. At the end of the week, Morgan opens a client's weekly statement. One charge was adjusted inside Kill Bill, so its line shows Differs and Close week is refused with both exact totals. A later week closes with the totals matched.
   - End: the closed week records both matching totals, and the Contract rates panel lists the new rate with its start date.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Seeded sign-in and roles** Each seeded person signs in with their email and password, lands on their role's home screen, and every API call acts with exactly the permissions of that role as listed in API.
- **DP-02 — Booking request intake** A requester (for their own organisation) or the coordinator submits a request that is validated, receives a booking reference, starts as Submitted and gets one or two seats by the team seat rule in Business rules.
- **DP-03 — Who sees which booking** Requesters see only their own organisation's bookings, files and billing totals, interpreters see only bookings they hold or are offered, and any other booking answers as not found.
- **DP-04 — Requester books from the browser** A requester completes the New request dialog in agency time and sees the new booking listed as Uncovered with its reference, whatever their browser's time zone.
- **DP-05 — Coverage states by pattern and label** Every coverage state on the coverage board and in the rotation weave differs by pattern and text label as well as colour, and meets the contrast thresholds in Feedback states.
- **DP-06 — Team decision and open call** The coordinator can turn a solo booking into a team booking and publish an open call that offers vacant seats to qualified interpreters until the server-decided close time, as qualified in Business rules.
- **DP-07 — Coordinator triage in the browser** The coordinator selects a submitted booking on the coverage board, makes it a team booking if needed and posts the open call, and the row then reads Open call and the Seats panel shows when the open call closes.
- **DP-08 — Seat filling rules** An interpreter claim fills the lowest vacant seat and a coordinator assignment fills the seat it names, only when the interpreter is qualified, free at that time and not already on the booking, and the booking moves to Partly covered or Covered.
- **DP-09 — One winner for the last seat** When several attempts to fill the same vacant seat arrive at once, exactly one succeeds, the rest receive the already-filled rejection, and no booking ever shows more holders than seats.
- **DP-10 — Interpreter claims from the browser** A qualified interpreter sees the booking under Open calls, claims a seat and then sees it under My assignments, while a slower colleague sees the already-filled message.
- **DP-11 — Role-shaped interpreter cards** Booking responses and screens carry only the interpreter fields published for the caller's role, so requesters and fellow interpreters never receive an interpreter's phone, email, home city, pay rate or id.
- **DP-12 — Confirmation emails** Each interpreter receives one assignment confirmation when given a seat, and the requester receives one coverage confirmation each time the booking becomes fully covered, sent late rather than lost when mail is down.
- **DP-13 — Nothing private in emails** Interpreter emails never carry the requester's notes or any money amount, and requester emails never carry an interpreter's pay, phone, email or home city.
- **DP-14 — Coordinator assigns from the browser** The coordinator fills both seats of a court booking through the Assign interpreter dialog, each assignment naming its seat, and sees the rotation weave split into alternating turns.
- **DP-15 — Seat release** Before check-in, an interpreter can withdraw from a held seat and the coordinator can release one, each after confirming in an in-app dialog, which reopens the seat, recalculates the status and ends that interpreter's prep access at once.
- **DP-16 — Rotation plan** Every booking response carries a rotation plan of turns and gaps computed from the seats, the contract rotation interval and the solo threshold, with every boundary in elapsed minutes from the start, as defined in Business rules.
- **DP-17 — Rotation weave on screen** The selected booking's time bar draws the rotation plan as turns and gaps that carry their index, kind, holder and agency wall-clock times, with a coverage figure and an adjacent list that announces the plan, and redraws only when the plan changes.
- **DP-18 — Refill after a withdrawal** When an interpreter withdraws from a covered team booking, the coordinator sees the gap and the lower coverage within the refresh interval and refills the seat from the Assign interpreter dialog to return the booking to Covered.
- **DP-19 — Prep material upload checks** Uploads are accepted only within the published size and count limits and only for the accepted file kinds judged by content, and they are stored under keys the uploader cannot influence.
- **DP-20 — Prep access follows the seat** Only current seat holders can get a short-lived download link, and access ends when they stop holding the seat, when the booking is cancelled, or when the grace period after the assignment ends runs out.
- **DP-21 — Prep materials in the browser** A requester attaches a file to their booking and an assigned interpreter downloads it from the Prep materials panel under its display name with its exact bytes.
- **DP-22 — Late window in agency time** Whether a cancellation is late is decided by the two-business-day rule in the agency time zone with weekends skipped and the start's wall-clock time kept across a clock change, never by server UTC or the browser clock.
- **DP-23 — Quoted cancellation** Cancelling requires confirming the quoted charge, the booking ends as Cancelled or Cancelled (late) as qualified in Business rules, and a stale quote is rejected with the current one.
- **DP-24 — Cancellation notices** Cancelling sends one notice to the requester and one to each seat holder, and the requester's copy states the late charge when there is one.
- **DP-25 — Requester cancels from the browser** A requester whose browser runs in another time zone opens Cancel booking, sees the agency-time quote, confirms it and sees the booking marked Cancelled or Cancelled (late).
- **DP-26 — Check-in and completion** The coordinator checks in a covered booking and completes it with worked minutes and mileage, and every other attempted transition is rejected as described in Business rules.
- **DP-27 — Contract line arithmetic** Each completion or late cancellation creates one invoice line computed once in integer cents from the contract rate in force on the assignment date, applying the minimum, quarter-hour rounding, team surcharge, mileage and the single rounding step in Business rules.
- **DP-28 — One Kill Bill charge per line** Every invoice line appears exactly once as a charge of the same amount on its organisation's Kill Bill account, however often the action or the posting is retried, and counts as synced only once read back as described in Services.
- **DP-29 — Pending sync when billing is down** If Kill Bill is unreachable, completion and late cancellation still succeed, the line shows Pending sync, and it posts on its own after Kill Bill returns, without a restart, as qualified in Business rules.
- **DP-30 — Coordinator completes from the browser** The coordinator checks in a covered booking, records completion in the Complete assignment dialog and sees the invoice line and its amount in the Billing panel.
- **DP-31 — Weekly statement and close** The billing manager reads a client's weekly statement and can close the week only when every line is synced and the Relayline total equals Kill Bill's current total to the cent.
- **DP-32 — Dispute record** Each invoice line exposes its full calculation, and each booking keeps an audit trail with exactly one entry per successful state-changing action, as qualified in Business rules, that retries never duplicate.
- **DP-33 — Effective-dated contract rates** The billing manager adds a contract rate that applies from a stated future date, and the rate is rejected if it would reprice an assignment that has already been billed.
- **DP-34 — Billing manager closes a week in the browser** The billing manager picks a client and a week, reviews each line's amount, billing amount and sync label, and closes the week or sees why it was refused with both totals.
- **DP-35 — Retried actions are idempotent** A POST that accepts an Idempotency-Key, repeated with the same key, returns the stored response without new effects, a key still being processed answers idempotency_in_progress, an invalid or reused key is rejected as stated in API, and a repeated transition without a key is rejected with no new charge, email or audit entry.
- **DP-36 — Run manifest and health** The app installs, builds and serves from the run manifest on the published port and answers the health check.
- **DP-37 — Configuration from environment** Every service URL and credential is read from the environment at start and is never hard-coded or sent to the browser.
- **DP-38 — Server boundary** The server serves only the app and its API from one origin, enforces the request size limits, rejects cross-origin writes and never serves source files or credentials.
- **DP-39 — Error shape and precedence** Every API error uses the single error body shape and the single precedence order stated in API.
- **DP-40 — Responsive layout** Every screen works at 375x812, 768x1024 and 1280x800 with no horizontal scrolling and the arrangement of its layout range described in Screens and layout.
- **DP-41 — Keyboard and focus** Every control is reachable in the described Tab order with a visible focus outline, Tab wraps inside open dialogs, Escape closes them except where Interactions says otherwise, and focus returns to the opener or, when the opener is gone, to the place Interactions names.
- **DP-42 — Weave motion** Turns enter left to right with a short stagger, the coverage figure counts to its new value and withdrawals collapse right to left only when the rotation plan changes, with hover and press feedback as described in Motion and effects.
- **DP-43 — Reduced motion** When reduced motion is requested, the weave and the coverage figure reach their final state instantly with the same patterns, labels and list.
- **DP-44 — Ruled utility look** Screens follow the ruled twelve-column layout, warm off-white ground, signal yellow reserved for uncovered work and monospace numerals described in Visual design.
- **DP-45 — Rotation weave craft** The rotation weave shows at a glance who carries each stretch, with distinct solid and striped turns, hatched gaps and aligned monospace times.
- **DP-46 — Server-timed open call** The server alone decides when an open call closes, and the screen shows that moment as fixed text and stops offering the claim within one refresh after it passes, whatever the browser clock says.
- **DP-47 — Announced assignment results** Assignment pending, success and error results are announced in the page's status and alert regions that exist from first load, and a schedule conflict keeps the Assign interpreter dialog open with the now-busy interpreter disabled.
- **DP-48 — Refresh keeps what the user is doing** The ten-second refresh updates data in place without closing dialogs, resetting chosen or typed inputs, moving focus, changing selection, scrolling or writing to the page's status and alert regions, and tells the Assign interpreter dialog in place when its seat was filled by someone else.
- **DP-49 — Cancel by keyboard alone** A requester can cancel a booking with the keyboard alone, with focus starting on Keep booking, moving to a changed quote before it can be confirmed, and landing on the detail heading after cancelling.
- **DP-50 — Billing state comes from Kill Bill** Each line's sync state and billing amount, and the week's billing total, are read back from Kill Bill including adjustments made there, so a changed charge shows as Differs and closing is refused with both exact totals.
- **DP-51 — Text limits in characters** Every text limit is counted in Unicode code points and is inclusive at the limit, on the server and in the live character hints, and accepted text is stored and returned exactly as submitted.
- **DP-52 — Start time in agency time across clock changes** A start is read as agency wall-clock time, a time skipped by a clock change is refused, a repeated time means its first occurrence, and the end is the length in elapsed minutes after the start.
- **DP-53 — Board day and selection live in the URL** The coordinator board's agency-local day and selected booking are kept in the URL so that reload, Back and Forward restore them as qualified in Interactions, and the periodic refresh never changes the URL.
- **DP-54 — Interpreter search in the Assign dialog** Typing in Find interpreter narrows the Assign interpreter list, which always shows the results of the latest search text, and a chosen interpreter who is filtered out of view is unchosen and Assign is disabled.
- **DP-55 — The hidden pane is unavailable** In the compact layout, whichever of the list and detail panes is hidden is absent from the accessibility tree and unreachable by Tab, and after a withdrawal the list returns with focus on its first row as qualified in Interactions.
- **DP-56 — Upload stores object and record together** Each prep file's stored object and its record exist together or not at all, concurrent uploads never take a booking past its file limit, and a storage outage leaves the materials list unchanged while bookings keep working.
- **DP-57 — Layout ranges at exact edges** The compact, medium and wide layouts and their dialog sizes switch exactly at the published range edges in Screens and layout.
- **DP-58 — Rate by agency-local assignment date** Completions, late-cancellation lines and cancellation quotes use the contract rate in force on the booking's agency-local start date, and a rate added after a quote changes the charge that quote must confirm.
- **DP-59 — One booking per draft** The New request dialog sends one Idempotency-Key for an unchanged draft, so pressing Submit request again after a lost response replays the stored booking, and one key yields exactly one booking, reference and audit entry even when requests with it arrive concurrently.
- **DP-60 — Actions are never undone by a stale refresh** A refetch requested before the user's latest action on the same data finished is discarded, so the board, the interpreter lists and the weave never show a booking state older than one an action produced and the action's announced result stays.
- **DP-61 — In-app withdraw and release confirmation** Withdraw and Release confirm through in-app dialogs sized by the layout ranges, with the safe button focused first, Tab wrapping, tap support and no native prompt, and the departing turns collapse right to left or instantly under reduced motion.
- **DP-62 — Prep files stored as submitted** Each prep file is stored and served byte for byte with its recorded SHA-256, and its display name is kept exactly as submitted up to 120 code points and delivered in the download's RFC 5987 file name with the published ASCII fallback.
- **DP-63 — An ended session resumes the action** A user action answered as unauthenticated opens Sign in to continue over the kept screen and, after signing in again, is resent once with the same method, path, body and Idempotency-Key, while refreshes answered as unauthenticated change nothing on screen.
- **DP-64 — A claim moves only on the server's answer** A claimed row moves to My assignments only after the server accepts the claim, a refetch requested before the claim answered never puts it back under Open calls, and a refused claim's alert and focus survive every later refresh, as qualified in Interactions.
- **DP-65 — Abandoned transfers release storage at once** A prep download the client abandons releases its storage connection at once and an upload cut off mid-body stores nothing and uses no file slot, so later downloads and API calls stay exact and fast, as qualified in Business rules.
- **DP-66 — Cancel dialog survives reopening** Reopening Cancel booking during its closing fade keeps the new dialog open with focus on Keep booking, each opening shows only its own fresh quote, and refreshes never change the quote, the confirm label or focus while it is open.
- **DP-67 — One completion per draft** The Complete assignment dialog sends one Idempotency-Key per unchanged draft, so pressing Record completion again after a lost response replays the stored result with exactly one invoice line, one Kill Bill charge and one audit entry.

## Frontend

### Screens and layout (DP-04, DP-07, DP-10, DP-14, DP-17, DP-21, DP-25, DP-30, DP-34, DP-40, DP-46, DP-53, DP-55, DP-57, DP-61, DP-63)

All screens share one frame.

- **Header strip** across the top: the product name, "Signed in as `<name>` · `<role label>`", the agency time zone line ("Times in `<agency time zone>`", where `<agency time zone>` is the seeded agency zone name) and the Sign out button.
- **List pane:** a fixed column that lists the rows for the current context as dense ruled rows. Each row has a monospace start time, then the reference, the title and a coverage or status marker.
- **Detail pane:** shows the selected row in full.
- **Times:** every date and time in the app is shown in the agency time zone, as `YYYY-MM-DD` and 24-hour `HH:MM`, whatever the browser's zone.
- **The browser clock:** the browser never decides time-dependent state from its own clock. The default board date and default week come from the server's `today` in `GET /api/agency`. Open-call state, the late window and link expiry come only from API responses.

Screens:

- **Sign in** (`/`): one centred form on the ruled grid with Email, Password and Sign in. After sign-in each role lands on its home screen at `/`.
- **Coordinator home: coverage board** (`/`, with the board state in the URL as described in Interactions).
  - The list pane shows one agency-local day of bookings, sorted by start time and then reference, with day controls above it. A New request button sits above the list. A booking belongs to the day of its agency-local start date.
  - The detail pane shows the selected booking:
    1. its heading and facts (organisation, setting, location, on-site contact, Deaf consumer, start to end, status);
    2. a full-width time bar carrying the rotation weave, its coverage figure and the rotation plan list;
    3. the Seats panel, which also carries the open-call line once an open call is posted;
    4. the Prep materials panel;
    5. the Billing panel;
    6. the Audit trail panel.
- **Interpreter home.**
  - The list pane has two sections: Open calls (bookings with a vacant seat the interpreter can claim) and My assignments (bookings where they hold a seat, upcoming first).
  - The detail pane shows the facts, the weave, the plan list, the Seats panel with interpreter cards and the open-call line, and the Prep materials panel. It shows neither billing nor notes.
- **Requester home.**
  - The list pane lists the organisation's bookings from today through the next 13 days, with New request above it.
  - The detail pane shows the facts, notes, the weave, the Interpreters panel (one card per held seat: initials badge, name, credential codes), the Prep materials panel with the upload control, and the Charge line once the booking has one.
  - Cancel booking sits beside the heading.
- **Billing manager home** (`/billing` and `/`).
  - The list pane holds the Client picker, the Week starting field and the invoice lines of that week as ruled rows.
  - The detail pane shows the selected line's breakdown, the week's totals with Close week, and the Contract rates panel for the chosen client with its add-rate form.
- **Booking deep link** (`/bookings/<id>`). Any role can open this URL. It shows the same detail for that role. When the booking is not visible to the caller, it shows the not-available message from Feedback states and no booking data.
- **Sign in to continue** (a dialog over any signed-in screen, described in Interactions). The screen beneath it, and any dialog already open, stay exactly as they were.

Layout ranges. These apply to every screen and are decided by the viewport width alone. The edges are exact: 767 px is compact, 768 px is medium, 1199 px is medium and 1200 px is wide.

- **Compact** (0 to 767 px wide): one column. The list pane fills the screen. Choosing a row replaces the list pane with the detail pane, topped by a Back to list button. Whichever pane is not shown is unavailable: it is absent from the accessibility tree, and none of its controls can be reached by Tab, by Shift+Tab or by finding it through its role and name. Moving a pane off screen or making it transparent does not make it unavailable. The weave shrinks to the screen width. Turn initials may be hidden visually when a turn is narrower than its label, but they stay in the document and in the plan list.
- **Medium** (768 to 1199 px wide): the list pane spans the full width and shows at most eight rows before it scrolls on its own. The detail pane stacks below it at full width.
- **Wide** (1200 px wide and up): the list pane spans 4 of the 12 grid columns on the left and the detail pane spans the other 8. The weave runs the full width of the detail pane.
- **Dialogs** (New request, Assign interpreter, Complete assignment, Cancel booking, Withdraw from assignment, Release seat, Sign in to continue): in the compact range, a dialog covers the viewport exactly, edge to edge with no margin. In the medium and wide ranges, it is 480 px wide and centred horizontally.
- In every range, no screen scrolls sideways. Billing tables wrap their cells instead.

### Public screens and controls (DP-01, DP-04, DP-05, DP-07, DP-10, DP-14, DP-17, DP-21, DP-25, DP-30, DP-34, DP-46, DP-47, DP-48, DP-49, DP-51, DP-53, DP-54, DP-55, DP-59, DP-61, DP-63, DP-64, DP-66, DP-67)

Only these roles, names and attributes are public. Everything else is free. Placeholders:

- `<ref>` is a booking reference.
- `<n>` is a seat number (1 or 2).
- `<file name>` is a material's display name.
- `<time>` is an agency-local `HH:MM`.
- `<holder name>` is the seat holder's full name.
- `<email>` is the signed-in user's seeded email.
- In the rotation plan list, `<i>` is the turn's position among the plan's turn entries, counting from 1, and `<N>` is the plan's turn count, both as defined in the rotation plan rule in Business rules.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Sign in | `form "Sign in"`, textbox `"Email"`, password field labelled `"Password"`, `button "Sign in"` | Sign in |
| Header | `navigation "Main"`, `button "Sign out"` | Signed in as `<name>` · `<role label>`; Times in `<agency time zone>` |
| Every page, from first load | `status "Action status"` (polite live region) | pending and success copy from Feedback states |
| Every page, from first load | `alert "Action error"` | error and outage copy from Feedback states |
| Coordinator list | `region "Coverage board"`, `button "Previous day"`, `button "Next day"`, date field labelled `"Board date"`, `button "New request"` | the day's rows |
| Row (all roles) | `button` named `"<time> <ref> <title>, <marker label>"`, carrying `data-coverage` = `covered`, `partly_covered` or `uncovered`. The selected row has `aria-current="true"` and no other row does | mono start time, reference, title, marker |
| Interpreter list | `region "Open calls"` (focusable by script), `region "My assignments"`, `button "Claim seat on <ref>"` per open-call row (named by the Claim seat pending copy and disabled while its claim is pending) | Claim seat |
| Requester list | `region "Bookings"`, `button "New request"` | New request |
| Detail | `region "Assignment detail"`, `heading` level 2 with `<ref> · <title>` (focusable by script) | facts |
| Detail | `img "Rotation weave"` with `data-mode` equal to the rotation plan's `mode`. Inside it, one element per plan entry, turns and gaps alike, carrying `data-turn-index` (equal to the entry's `index` in the rotation plan), `data-kind` (`turn` or `gap`), `data-holder` (initials, empty for gaps), `data-start` and `data-end` (agency `HH:MM`) | initials in turns; the gap labels "relief needed" or "uncovered" in gaps |
| Detail | `status "Coverage"` | the coverage text of the rotation plan |
| Detail | `list "Rotation plan"` with one `listitem` per plan entry, in `index` order | `Turn <i> of <N>: <holder name>, <start>–<end>` for turns; `Gap: <gap label>, <start>–<end>` for gaps |
| Seats (coordinator) | `region "Seats"` with `heading "Seats"` level 3 (focusable by script); `button "Assign seat <n>"` per vacant seat; `button "Release seat <n>"` per held seat; `button "Make team booking"`; `button "Post open call"`; `button "Check in"`; `button "Mark complete"` | the same words, plus the open-call line from Feedback states |
| Seats (interpreter) | `region "Seats"`, `button "Withdraw"` on the seat they hold, `button "Claim seat"` only when a seat is vacant, they hold none, and the booking's `open_call_status` is `open` (named by the Claim seat pending copy and disabled while pending) | Withdraw; Claim seat; the open-call line |
| Interpreters (requester) | `region "Interpreters"`, one `article` per held seat, named by the interpreter's name | initials badge, name, credential codes |
| Detail | `button "Cancel booking"` (requester, coordinator) | Cancel booking |
| Prep materials | `region "Prep materials"`, file field labelled `"Attach prep material"`, `button "Upload"` (requester, coordinator), `button "Download <file name>"` (current holders only) | file name, size in bytes, upload time |
| Billing panel (coordinator) | `region "Billing"` | line reference, amount, sync label |
| Audit (coordinator, billing manager) | `region "Audit trail"`, `list` of entries | `<date> <time> · <actor> · <action>` |
| New request | `dialog "New request"`. Fields labelled `"Organisation"` (coordinator only), `"Setting"`, `"Title"`, `"Location"`, `"On-site contact name"`, `"On-site contact phone"`, `"Deaf consumer name"`, `"Start date"`, `"Start time"`, `"Length (minutes)"`, `"Notes for the agency"`. Title and Notes for the agency each carry a character hint as their accessible description. Buttons `"Submit request"` and `"Close"` | Submit request; the character hints from Feedback states |
| Assign | `dialog "Assign interpreter"` for one named seat. `searchbox "Find interpreter"` above the choices. One `radio` per qualified interpreter in the current results, named by their name (disabled when busy). `status "Assign status"` inside the dialog, present and empty from the moment it opens. `button "Assign"` (named by the Assign pending copy while pending; disabled while no radio is chosen), `button "Close"` | name, credential codes, "Busy at this time" on disabled radios; the no-match line from Feedback states |
| Withdraw (interpreter) | `dialog "Withdraw from assignment"`, `button "Keep seat"`, `button "Confirm withdrawal"` (named by the Release pending copy while pending) | You will stop holding seat `<n>` on `<ref>` and lose access to its prep materials. |
| Release (coordinator) | `dialog "Release seat <n>"`, `button "Keep holder"`, `button "Confirm release"` (named by the Release pending copy while pending) | `<holder name>` will stop holding seat `<n>` on `<ref>` and lose access to its prep materials. |
| Complete | `dialog "Complete assignment"`, fields `"Worked minutes"` and `"Mileage (miles)"`, `button "Record completion"`, `button "Close"` | Record completion |
| Cancel | `dialog "Cancel booking"`. `status "Cancellation quote"` (itself focusable). `button "Keep booking"`. A confirm button that is named by the quote pending copy and disabled until the quote arrives, then named `"Confirm cancellation"`, and named `"Confirm new charge"` after a changed quote | quote copy from Feedback states |
| Session ended | `dialog "Sign in to continue"`, the signed-in email as plain text (not a field), password field labelled `"Password"`, `button "Sign in and continue"`, `button "Sign out"` | the session-ended line from Feedback states; `<email>` |
| Billing manager | `combobox "Client"`, date field `"Week starting"`, `button "Show week"`, `table "Invoice lines"` (columns Line, Booking, Date, Billable time, Interpreters, Amount, Billing amount, Sync), `region "Line breakdown"`, `region "Week totals"`, `button "Close week"` | Sync cell: Synced or Pending sync, followed by Differs when the two amounts differ |
| Rates | `region "Contract rates"`, `form "Add rate"`, fields `"Effective from"`, `"Hourly rate (dollars)"`, `"Team surcharge (percent)"`, `"Mileage rate (cents per mile)"`, `button "Add rate"` | each rate as a ruled row: effective date and the three values |
| Compact layout | `button "Back to list"` | Back to list |

### Interactions (DP-07, DP-10, DP-14, DP-18, DP-21, DP-25, DP-30, DP-34, DP-41, DP-46, DP-47, DP-48, DP-49, DP-51, DP-53, DP-54, DP-55, DP-59, DP-60, DP-61, DP-62, DP-63, DP-64, DP-66, DP-67)

- **Sign in:** Enter in either field submits. On success the role's home loads, and focus moves to the first list row, or to New request when the list is empty. Sign out ends the session and returns to Sign in.
- **Session ended during an action (DP-63).** A user action is any request the user's own press, tap, Enter or submit sends; periodic refreshes and sign-in itself are not user actions.
  1. When a user action's request answers `unauthenticated`, a `dialog "Sign in to continue"` opens on top of the current screen and on top of any dialog already open. Nothing beneath it changes: every typed value, chosen radio, selection and open dialog stays as it was.
  2. Focus starts on Password. Tab and Shift+Tab wrap among Password, Sign in and continue, and Sign out, and never reach anything beneath. Escape does nothing.
  3. Sign in and continue (or Enter in Password) signs in again as the shown email. On `invalid_credentials` the dialog stays open, Action error shows that code's copy, Password is emptied and focused, and everything beneath keeps its values.
  4. On success the dialog closes and the action that got the `unauthenticated` answer is resent once, automatically, with the same method, the same path, a byte-identical body and the same `Idempotency-Key` header when it had one. Its answer is handled exactly as a first answer would be: success copy, dialog close, selection and focus, or field errors, as each action's own rules say.
  5. Sign out in this dialog discards the pending action and returns to Sign in.
  6. A periodic refresh that answers `unauthenticated` changes nothing on screen, opens nothing, writes nothing to the live regions, and the refresh keeps running at its interval.
- **Choose a row:** click, tap or Enter on a row selects it. The row gets `aria-current="true"`, the detail loads, and focus moves to the detail heading. In the compact layout the detail pane replaces the list pane, and Back to list returns to the list pane with focus on that row, which stays selected.
- **Board day and selection in the URL (coordinator board only).** The coverage board's address is `/?date=<YYYY-MM-DD>&booking=<id>`, where `date` is the agency-local board day and `booking` the selected booking's id. `booking` is absent when nothing is selected.
  - Previous day, Next day, and a date typed into Board date followed by Enter each add one history entry with the new `date` and no `booking`. The board shows that day with nothing selected.
  - Selecting a row rewrites the current history entry in place, adding or changing `booking`. It adds no history entry. Back after selecting therefore returns to the previous day, not to the previous selection.
  - After Submit request on the coordinator board, the new booking is selected. If it falls on the shown day, the current entry is rewritten. Otherwise one history entry is added with the booking's agency-local day and `booking`.
  - Loading or reloading the address restores the board day (shown in Board date), the selected row with `aria-current="true"`, and its detail. In the compact layout an address with `booking` opens on that booking's detail pane.
  - Back and Forward restore day and selection without a full page load. Focus then moves to the selected row (to the detail heading in the compact layout), or to Board date when nothing is selected.
  - A missing or malformed `date` is replaced by the server's `today`. A `booking` that is unknown, not visible, or not on that agency-local day is dropped. Both corrections rewrite the current entry in place, add no history entry and show no error copy.
  - The periodic refresh never changes the address.
- **New request:**
  - Opens the dialog with focus on the first field.
  - Start date and Start time are always read as agency time, and the field hint repeats the agency zone. The browser sends them as agency wall-clock time, as defined in API.
  - The Title and Notes for the agency character hints update on every input event. The fields never block or cut typing at the limit. Over the limit, the hint shows the true count, and Submit request receives the server's field error.
  - **One key per draft.** Each opening of the dialog creates one new `Idempotency-Key`. Every press of Submit request sends that key while the field values are unchanged since the previous press. Changing any field value after a failed or unanswered attempt creates a new key for the next press.
  - Submit request sends the request. On success, including a replayed success, the dialog closes, the new booking is selected in the list, and focus returns to New request.
  - On field errors the dialog stays open, each message sits under its field, and focus moves to the first field in error.
  - When no response arrives, or the answer is `idempotency_in_progress`, the dialog stays open with every typed value, Action error shows the matching copy from Feedback states, and focus stays on Submit request. Pressing it again resends the same key and the same body.
  - An `unauthenticated` answer follows the session-ended rule above.
- **Post open call:** sends at once. From then on, the Seats panel carries the open-call line from Feedback states. It shows the fixed close moment from `open_call_closes_at` until the API reports the open call closed, then the closed line. Nothing on screen counts down.
- **Assign seat `<n>`:**
  1. Opens Assign interpreter for that seat with an empty Find interpreter box and no radio chosen. It lists qualified interpreters only, and those who already have work at that time appear disabled, as does an interpreter who already holds the other seat on this booking (their `busy` stays false, since busy only counts other bookings). Focus goes to the first enabled radio, or to Close when none is enabled. Tab order inside the dialog is Find interpreter, the radios, Assign, Close, and it wraps.
  2. Typing in Find interpreter asks the server for matching interpreters, waiting no more than 300 milliseconds after the last keystroke. The radios always show the results for the latest search text. An answer for earlier text that arrives after a later one is thrown away and never shown. When no interpreter matches, the dialog shows the no-match line from Feedback states and no radios.
  3. A chosen radio stays chosen while that interpreter is among the shown results. When the results no longer include them, the choice is cleared and Assign is disabled until another radio is chosen.
  4. Arrow keys move between radios. Pressing Assign sends the assignment for seat `<n>`, with announcements as in Feedback states.
  5. On success the dialog closes, the weave and Seats update, and focus moves to the Seats heading.
  6. On `schedule_conflict` or `not_qualified`:
     - the dialog stays open;
     - it fetches the interpreter list for the booking again with the current search text, so the refused interpreter's radio becomes disabled with "Busy at this time" or disappears, and the choice clears;
     - focus moves to the first enabled radio.
  7. If a refresh shows that seat `<n>` now has a holder, the dialog stays open, keeps the chosen radio, and shows the seat-filled notice in Assign status. Pressing Assign still sends the request, and the answer is announced as usual.
- **Withdraw / Release seat `<n>` (in-app confirmation).** No screen ever opens a native confirm, alert or prompt.
  1. Withdraw (interpreter) opens Withdraw from assignment; Release seat `<n>` (coordinator) opens Release seat `<n>`. The dialog is sized by the dialog rule in Screens and layout.
  2. Focus starts on the safe button: Keep seat or Keep holder. Tab and Shift+Tab move between the safe button and the confirm button and wrap, never leaving the dialog.
  3. The safe button or Escape closes the dialog without acting and returns focus to the button that opened it.
  4. The confirm button sends the release. While it is pending, the button shows the Release pending copy and is disabled, and Escape does nothing.
  5. On success the dialog closes. For the interpreter, in every layout, the list pane shows and focus moves to the first row in the list (the first Open calls row, otherwise the first My assignments row), or to the Open calls region when both are empty. In the compact layout the detail pane becomes unavailable. In the medium and wide layouts the booking stays selected while it is still listed, and otherwise nothing is selected. For the coordinator, focus moves to the Seats heading.
  6. On an error the dialog stays open, the confirm button returns to its name, and Action error shows the copy.
  7. Every control in both dialogs works by tap alone.
- **Withdrawn booking in the interpreter's list:** it is listed under Open calls when it is still offered and claimable by that interpreter, and is otherwise gone from the list.
- **Claim seat on `<ref>` / Claim seat (DP-64).**
  1. Pressing it sends the claim at once. While the claim is pending, the row stays under Open calls, its button shows the Claim seat pending copy and is disabled, and nothing appears under My assignments.
  2. The row moves only when the server accepts the claim: it leaves Open calls, appears under My assignments as the selected row with `aria-current="true"`, and the detail and weave show the caller's card with `is_me` true. This holds whether the claim was sent from the row's `Claim seat on <ref>` button or from the Seats panel's `Claim seat` button. The pressed claim button no longer exists, so in every layout focus moves to the detail heading. In the compact layout the detail pane of the claimed booking is shown (replacing the list pane if the claim came from a row) and the list pane is unavailable.
  3. A refetch of Open calls, My assignments or the booking detail that was requested before the claim answered is discarded, under the stale-refetch rule below. After an accepted claim the row never reappears under Open calls, and Claim seat never reappears on that booking.
  4. On any refusal, Action error shows the code's copy and the interpreter's lists are fetched again at once. What follows depends on whether the booking is still in the refreshed Open calls:
     - **Still listed:** the row stays. A claim sent from the row returns focus to that row's `Claim seat on <ref>` button. A claim sent from the Seats panel returns focus to the Seats panel's `Claim seat` button, and the shown pane does not change (in the compact layout the detail pane stays shown).
     - **No longer listed:** the row leaves Open calls, and wherever the claim was sent from, the list pane is shown: in the compact layout it replaces the detail pane, which becomes unavailable; in the medium and wide layouts the booking is no longer selected and nothing is selected. Focus moves to the Open calls row that followed the departed row's position, else the row that preceded it, else the Open calls region.
  5. The refusal's copy stays in Action error, and the focus it set stays, through every later refresh until the user's next action.
  6. When no response arrives, the row stays under Open calls, Action error shows the network-failure copy, nothing moves to My assignments, the shown pane does not change, and focus stays on the claim button that was pressed, which returns to its name and is enabled again.
- **Cancel booking (keyboard-complete):**
  1. Opens the dialog and fetches the quote right away. Focus starts on Keep booking.
  2. Until the quote arrives, the confirm button is disabled and shows the quote pending copy. Once the quote arrives it reads Confirm cancellation.
  3. Tab moves through the quote status, Keep booking and the confirm button in that order, and wraps. Shift+Tab goes the other way and wraps too.
  4. Pressing Enter on the confirm button sends the quoted charge back.
  5. If the server answers `quote_changed`, the new quote replaces the old one in Cancellation quote, the confirm button is renamed Confirm new charge, and focus moves to the quote status so the new charge is read first. Enter on Confirm new charge sends the new charge.
  6. On success the dialog closes. Cancel booking no longer exists for a final booking, so focus moves to the detail heading. The row's marker reads the final status label.
  7. Keep booking or Escape closes the dialog without acting and returns focus to Cancel booking. Escape while the cancel request is pending does nothing and sends nothing, and the dialog stays until the response arrives.
  8. **Reopening (DP-66).** Pressing Cancel booking while the dialog is still fading out opens a fresh dialog that stays open. Nothing left over from an earlier opening ever hides it, moves its focus or empties its quote. Each opening fetches its own quote, and a quote response that belongs to an earlier opening is discarded and never shown; the confirm button sends the charge of the quote this opening shows.
  9. While the dialog is open, the periodic refresh never changes the quote text, the confirm button's name or focus.
  10. If confirming answers `invalid_transition` because the booking became final meanwhile, the dialog closes, Action error shows the shared `invalid_transition` copy, and focus moves to the detail heading.
- **Mark complete (DP-67):**
  - Opens Complete assignment with Worked minutes prefilled to the scheduled length and Mileage at 0.
  - Each opening creates one new `Idempotency-Key`. Every press of Record completion resends that key while Worked minutes and Mileage are unchanged since the previous press. Changing either value after a failed or unanswered attempt creates a new key.
  - On success, including a replayed success, the dialog closes and the Billing panel shows the line.
  - When no response arrives, the dialog stays open with its values, Action error shows the network-failure copy, and focus stays on Record completion. Pressing it again resends the same key and body, and the replayed success copy names the original line.
  - An `invalid_transition` answer (for example after the values were changed, so a new key reached a booking that is already completed) closes the dialog, Action error shows the shared `invalid_transition` copy, and the Billing panel shows the original line and amount.
- **Upload:** choose a file in Attach prep material, then press Upload. The file appears in the list on success.
- **Download `<file name>`:** asks the server for a fresh link and then downloads the file through it. The browser saves the file under its display name with exactly the stored bytes.
- **Billing:** choosing a Client and a Week starting date and pressing Show week loads that week's statement. Choosing a line row shows its breakdown. Close week closes the shown week.
- **Refresh keeps what the user is doing (DP-48).** The periodic refetch in Feedback states merges new data into what is on screen. It never:
  - closes or reopens a dialog;
  - unchecks or changes the chosen radio in Assign interpreter, or changes its search text or results;
  - clears or rewrites a value typed into New request, Complete assignment or Add rate;
  - moves focus;
  - changes the selected row;
  - changes the list's scroll position;
  - writes to or empties Action status or Action error;
  - replays weave motion or the coverage count for an unchanged rotation plan.

  The Assign interpreter dialog's interpreter list is fetched when the dialog opens, when the search text changes and after a refused assignment, never by the periodic refresh.
- **Actions win over older refetches (DP-60).** This applies on every screen: the coverage board, the interpreter's Open calls and My assignments, the requester's list and every open detail. A refetch response, periodic or requested after an action, is applied only when it was requested after the user's most recent action on the same data finished. A response to a request sent earlier is discarded, and the next refresh applies.
  - Once the screen has shown a booking state produced by an action, it never shows an older state of that booking. For example, the row never returns to Submitted after Post open call, `data-mode` never returns to `solo` after Make team booking, the open-call line never disappears after it was posted, and a claimed row never returns to Open calls.
  - Make team booking changes the drawn plan exactly once, and the weave plays its entry exactly once for it.
  - An action's success or error copy stays in its region until the next action starts.
- **Keyboard:**
  - Tab order is the header (Main navigation links, Sign out), then the list controls (day controls or filters, then New request), then the list rows from top to bottom, then the detail pane from top to bottom in reading order. In the compact layout, only the pane that is shown takes part.
  - Every focusable control shows a thick ink outline set slightly off its edge.
  - Tab and Shift+Tab wrap inside the topmost open dialog and never reach anything behind it.
  - Escape closes any open dialog without acting, except Sign in to continue and while a cancel or release request is pending, as above. Focus then returns to the control that opened the dialog, or to the detail heading when that control no longer exists.
  - Hover never reveals anything that is not also reachable by keyboard.
- **Touch:** every control is tappable. Nothing depends on hover or long-press.

### Visual design (DP-05, DP-44, DP-45)

- **Ground and ink:** a warm off-white page, like unbleached paper, with near-black ink for text, rules and section labels. Warm grey hairline rules draw the 12-column grid lines and separate every row and panel, so each surface visibly sits on the grid.
- **Signal yellow** is a saturated warning yellow. It appears only where work is uncovered: uncovered and partly covered markers, hatched gaps in the weave, and the yellow stripe on an uncovered row's left edge. Buttons, links and decoration never use it.
- **Covered** uses a deep forest green, for covered markers and interpreter turns.
- **Type:**
  - Headings and the heavy section labels are set in Archivo, a sturdy grotesque, at its boldest weight. Section labels sit flush left on a grid line in capitals.
  - Body text and form controls use IBM Plex Sans.
  - Every numeral that lines up in a column (times, durations, money, turn counts, coverage figures, character hints) is set in IBM Plex Mono, so digits align.
  - Each step up the heading scale is a quarter larger than the one below, starting from body text. The page heading is about twice the body size.
- **Density:** compact. Rows are tight and single-line where possible, separated by rules rather than padding. Every button, row and radio is still at least 44 px tall and wide for touch.
- **Composition:** the ruled list pane and the detail pane are arranged as described in Screens and layout. The time bar runs the full detail width directly under the heading, and panels stack below it with heavy black labels. Confirmation dialogs carry their sentence in body type and the two buttons side by side, the safe one first. Sign in to continue uses the same ruled dialog with the email set in body type above the Password field.
- **Working screens:** empty lists show one ruled row of plain body text saying there is nothing for that day or week; error copy sits in ink beside a solid ink rule on its left, never in yellow; tables are ruled with mono numerals aligned right.
- **Contrast:** text meets WCAG 2.2 AA (4.5:1 for body text, 3:1 for large text), and every state indicator meets the thresholds in Feedback states.
- **Fonts** ship with the app. Nothing loads from another origin.

### Motion and effects (DP-17, DP-42, DP-43, DP-48, DP-60, DP-61, DP-66)

Motion explains change. Nothing moves for decoration, and no element loops or spins.

- **Feel:** every motion starts slowly, moves briskly through the middle and settles gently. Weave and coverage-figure motion runs as CSS transitions or animations, or through the Web Animations API, never as hand-driven per-frame script. The browser therefore reports each one as a running animation while it plays, and as none once it has settled.
- **When the weave moves:** only when the rotation plan to draw differs from the one already drawn for the selected booking. That means a different `mode`, a different number of entries, or any entry with a different kind, holder, start or end. Selecting a different booking counts as a change. A refetch that returns the same plan starts no animation and no recount, and a discarded stale refetch draws nothing.
- **Entry:** when the plan changes for any reason other than a holder leaving, every entry of the new plan grows from its left edge to full width, one after another from left to right. Each entry starts about 40 milliseconds after the previous one and takes about a quarter of a second. Make team booking, whose plan stays one uncovered gap, therefore plays one entry. Refilling a seat plays the entry of the alternating turns.
- **Coverage count:** the monospace percentage counts from its previous value to its new one in about a third of a second, stepping through the whole-number percentages in between. The count's timing is driven by a CSS or Web Animations animation. The turn count and minutes switch at the end of the count. When the percentage does not change, nothing counts.
- **Withdrawal and release:** the departing holder's turns turn into yellow-hatched gaps one at a time from right to left, each taking about a quarter of a second. Each gap begins its collapse at least 30 milliseconds after the gap to its right begins, as the browser reports each animation's start time plus its delay; about 40 milliseconds apart is the intended rhythm. Meanwhile the percentage counts down. The bar then settles into the one-interpreter picture (a solid block and a hatched "relief needed" stretch) over about a third of a second.
- **Dialogs:** they fade and rise slightly into place in about a quarter of a second, and fade out faster on close. A dialog opened again while its previous opening is still fading out appears at once as a fresh, fully shown dialog; the old fade never hides it.
- **Hover and press:** on hover, a list row's bottom rule thickens to ink within a tenth of a second. Buttons darken on hover and shift down by a hair's width while pressed. Focus outlines appear instantly.
- **Pending:** a pressed action button shows its pending copy as its label and stays disabled until the response arrives. There is no spinner.
- **Reduced motion:** when the operating system asks for reduced motion:
  - turns, gaps and the one-interpreter picture appear in their final state at once, with no growth, stagger or collapse; on the first frame painted after a release response, no weave animation is running and the coverage figure already shows its final text;
  - the coverage figure changes as plain text with no count;
  - dialogs appear and disappear without movement;
  - row rules change without a transition.

  The same patterns, labels, plan list and live-region announcements stay, so nothing is lost.

### Feedback states (DP-01, DP-05, DP-10, DP-12, DP-18, DP-21, DP-25, DP-29, DP-30, DP-34, DP-46, DP-47, DP-48, DP-49, DP-50, DP-51, DP-52, DP-54, DP-56, DP-59, DP-60, DP-63, DP-64, DP-66, DP-67)

**Live regions.**

- `status "Action status"` and `alert "Action error"` are part of the page shell. They are present and empty at first load on every page, including Sign in, and are never removed or inserted later.
- Pending and success copy goes to Action status. Error, conflict and outage copy goes to Action error. Field messages also appear under their fields.
- Each announcement first empties its region and then sets the new text in a later frame, so the same message twice in a row is announced twice.
- Starting an action empties Action error. A success empties Action error. An error empties Action status, so no pending copy lingers.
- Only the user's own actions write to these two regions. Refreshes and refetches never write to or empty them.
- The screen shows the copy below for each error code. It never shows the API's top-level `message`.

Placeholders:

- `<ref>` is a booking reference and `<line ref>` an invoice line reference.
- `<n>` is a seat number and `<name>` a person's full name.
- `<file>` is a display file name and `<org>` an organisation name.
- `<date>` is an agency-local `YYYY-MM-DD` and `<time>` an agency-local `HH:MM`.
- `<cutoff>` is the late-window cutoff as `<weekday short name> <date> <time>`, where the weekday short name is the English three-letter abbreviation (`Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`, `Sun`).
- In the Cancellation quote row, `On time:`, `Late with a charge:` and `Late with no seat held:` are labels and are not shown; the copy after each label is shown verbatim, and the on-time copy reads `ended or ends` literally whether or not the cutoff has passed.
- `<amount>` is a dollar amount shown as `$` with thousands commas and two decimals (for example `$1,204.50`).
- `<count>` is a field's current length in Unicode code points, with thousands commas.
- `<q>` is the Find interpreter text with leading and trailing spaces removed.

| Action | Pending | Success | Errors |
|---|---|---|---|
| Sign in, and Sign in and continue | Signing in… | (home screen loads; or the dialog closes and the pending action is resent) | `invalid_credentials`: Email or password is wrong. |
| Submit request | Submitting request… | Request `<ref>` submitted. | validation: Check the highlighted fields. |
| Make team booking | Updating seats… | `<ref>` now needs a team of two. | |
| Post open call | Posting open call… | Open call posted for `<ref>`. | `open_call_closed`: The open call for this booking has closed. Assign an interpreter directly. |
| Assign (also the Assign button's label while pending) | Assigning… | `<name>` holds seat `<n>` on `<ref>`. | `schedule_conflict`: That interpreter already has an assignment at this time. `not_qualified`: That interpreter's credentials don't cover this setting. `seat_filled`: Already filled — another interpreter took this seat. `already_holding`: That interpreter already holds a seat on this booking. |
| Claim seat (also the claim button's label while pending) | Claiming seat… | You hold seat `<n>` on `<ref>`. | `seat_filled`: Already filled — another interpreter took this seat. `schedule_conflict`: You already have an assignment at that time. `open_call_closed`: This open call has closed. Contact dispatch. `already_holding`: You already hold a seat on this booking. |
| Release / Withdraw (also the confirm button's label while pending) | Releasing seat… | Seat `<n>` on `<ref>` is open again. | |
| Check in | Checking in… | `<ref>` is in progress. | |
| Record completion | Recording completion… | `<ref>` completed. Invoice line `<line ref>` recorded. | validation: Check the highlighted fields. |
| Cancellation quote (in `status "Cancellation quote"`; the pending copy is also the confirm button's label until the quote arrives) | Checking the cancellation window… | On time: Cancelling now is on time. No charge. Free cancellation ended or ends `<cutoff>`. Late with a charge: This is a late cancellation (inside two business days). Charge: `<amount>`. Late with no seat held: This is inside two business days, but no interpreter holds a seat yet. No charge. | |
| Confirm cancellation | Cancelling… | No charge: `<ref>` cancelled. With a charge: `<ref>` cancelled. Late charge `<amount>` recorded. | `quote_changed`: The cancellation window just changed. Review the new charge. |
| Upload | Uploading `<file>`… | `<file>` attached. | validation on `file`: the `file` field message. `payload_too_large`: Files must be 10,000,000 bytes or smaller. `unsupported_type`: Only PDF, PNG, JPEG, Word (.docx) and PowerPoint (.pptx) files are accepted. `storage_unavailable`: File storage is unavailable. Try the upload again shortly. |
| Download | Preparing download… | (file downloads) | `access_ended`: Your access to these materials has ended. `link_expired`: That download link has expired. Press Download again. `storage_unavailable`: Prep materials are unavailable right now. Try again shortly. |
| Close week | Closing week… | Week of `<date>` closed for `<org>`. Relayline `<amount>` matches billing `<amount>`. | `pending_sync`: Some lines are still waiting to sync with billing. Try again shortly. `billing_unavailable`: Billing is unreachable. Nothing was closed; try again shortly. `total_mismatch`: Relayline and billing totals differ. Nothing was closed. `week_closed`: This week is already closed. |
| Add rate | Saving rate… | New rate takes effect `<date>`. | `rate_would_reprice`: That date would reprice billed work. Choose a date on or after `<date>`. |

Success copy describes what Relayline recorded. It stays true when an email or a Kill Bill posting is only queued, because both go out later by the rules in Business rules.

**In-place copy.**

- **Character hints** in New request, in monospace numerals: under Title, `<count> of 120 characters`; under Notes for the agency, `<count> of 1,000 characters`. Over the limit, the hint shows the true count, for example `121 of 120 characters`.
- **Open-call line** in the Seats panel (coordinator and interpreter). While `open_call_status` is `open` it reads `Open call closes <date> <time>`, from `open_call_closes_at`. Once the API reports `closed`, the coordinator sees `Open call closed — assign directly` and the interpreter sees no claim control.
- **Assign status**, inside the Assign interpreter dialog, when a refresh shows its seat now held: `Seat <n> was just filled. Close this dialog to see the update.`
- **No-match line** in the Assign interpreter dialog: `No interpreter matches "<q>".` When the search text is over its limit, the dialog shows the `q` field message under Find interpreter instead, with no radios.
- **Session-ended line** in Sign in to continue: `Your session has ended. Sign in again to finish this action.`
- **Week totals** reads `Relayline <amount> · billing <amount>` when the statement's billing total is known, and `Relayline <amount> · billing not yet confirmed` when it is null. When Kill Bill cannot be read, it adds `Billing amounts are unavailable right now.`
- **Differs** appears as text beside the Sync label of any line whose Amount and Billing amount differ. A line with no billing amount yet shows `—` in Billing amount.

**Shared copy.**

- Any `invalid_transition`: This booking is now `<status label>`. The page has been refreshed.
- Any `forbidden`: Your role can't do that.
- Any `not_found`, and the deep-link screen: That booking isn't available to you.
- Any `idempotency_in_progress`: That request is still being processed. Wait a moment, then check.
- Network failure (no response arrived): Relayline could not reach the server. Your last action may not have saved; refresh to check.

**Field messages.** The API's `fields` values use exactly these strings.

- `org_id`: Choose a client organisation.
- `setting`: Choose medical, educational, legal or workplace.
- `title`: Enter a title of up to 120 characters.
- `location`: Enter where the interpreter should go.
- `onsite_contact_name`: Name the person who meets the interpreter.
- `onsite_contact_phone`: Enter a phone number for the on-site contact.
- `consumer_name`: Enter the Deaf consumer's name.
- `start`, checked in this order, first failure only:
  1. missing or not in the request format: Enter a start date and time.
  2. skipped by a clock change: That time doesn't exist in agency time on that date.
  3. too soon: Start must be at least 15 minutes from now.
- `duration_minutes`: Length must be 30 to 480 minutes in 15-minute steps.
- `requester_notes`: Notes can be up to 1,000 characters.
- `interpreter_id`: Choose an interpreter.
- `seat`: Choose a seat this booking has.
- `q`: Search text can be up to 80 characters.
- `worked_minutes`: Worked minutes must be a whole number from 1 to 720.
- `mileage_miles`: Mileage must be a whole number from 0 to 500.
- `quoted_charge_cents`: Confirm the quoted charge.
- `idempotency_key`: Idempotency-Key must be 1 to 100 visible ASCII characters.
- `file`: Choose a file to upload. A non-empty file is required. When the booking is full: A booking can hold up to 10 files.
- `effective_from`: Choose a date after today. When a rate already starts on that date: A rate already starts on that date.
- `hourly_rate_cents`: Enter an hourly rate from $0.01 to $1,000.00.
- `team_surcharge_bp`: Enter a surcharge from 0 to 100 percent.
- `mileage_cents_per_mile`: Enter a mileage rate from 0 to 1,000 cents.
- `week_start`: Choose a Monday that is not in the future.
- `from` and `to`: Choose a range of at most 31 days.

**Status labels:** `submitted` Submitted, `open` Open call, `partially_covered` Partly covered, `covered` Covered, `in_progress` In progress, `completed` Completed, `cancelled` Cancelled, `cancelled_late` Cancelled (late).

**Coverage states.** These hold on the coverage board and in the weave.

- A row's marker shows its coverage state while the booking is submitted, open, partly covered or covered, and its status label after that. Every row also shows the booking's status label as text beside the marker, so an open booking's row reads Open call next to its Uncovered marker.
- **Uncovered** (no seat held): a square marker filled with signal yellow and dense diagonal ink hatching, with a solid ink border, labelled "Uncovered". Uncovered rows also carry the yellow left-edge stripe.
- **Partly covered** (some but not all seats held): a marker split down the middle, left half solid forest green, right half yellow with diagonal ink hatching, with an ink border, labelled "Partly covered".
- **Covered** (all seats held): a solid forest green marker with an off-white check mark and a solid ink border, labelled "Covered".
- **In the weave:** turns use solid forest green (first seat) or fine vertical forest green stripes on off-white (second seat), each with a solid ink border. Gaps are yellow with diagonal ink hatching, ink-bordered, and carry their gap label in ink.
- **Contrast:** each state's text label sits on the page ground or on a plain off-white chip and meets at least 4.5:1 contrast. The border or pattern of every marker, turn and gap meets at least 3:1 against the page ground. No state is told apart by colour alone.

**Freshness.**

- The coverage board, the interpreter's Open calls and My assignments, the requester's list and the open detail refetch every 10 seconds, and right after the user's own actions, under the DP-60 rule in Interactions. Other people's changes, and an open call passing its close moment, therefore show within 10 seconds.
- The billing statement refetches every 10 seconds while it is open. A line changes from Pending sync to Synced, and a Kill Bill adjustment shows in Billing amount, within 10 seconds of the change in Kill Bill.
- The cancellation quote is fetched when the dialog opens and again when the server reports `quote_changed`.

## Backend

### API (DP-01, DP-02, DP-08, DP-11, DP-19, DP-20, DP-35, DP-39, DP-46, DP-50, DP-51, DP-52, DP-54, DP-59, DP-62, DP-63, DP-67)

**General**

- All endpoints live under `/api` and speak `application/json; charset=utf-8`. Uploads and prep downloads are the exceptions (below).
- Times in responses are ISO 8601 strings in the agency time zone with the offset in force at that instant, for example `2026-11-03T09:00:00-06:00`. Dates are agency-local `YYYY-MM-DD`. Money is integer cents in fields ending `_cents`.
- Authentication is a session cookie set by sign-in, HttpOnly and SameSite=Lax. Signing out anywhere ends that session for every tab that shares the cookie; the next request from any of them answers `unauthenticated`.
- Roles are `coordinator`, `interpreter`, `requester` and `billing_manager`.

**Error body**

- Every error is `{"error":"<code>","message":"<message>"}`.
- `<code>` is one of the codes in the error catalogue. It is the contract: clients and checks decide what happened from `error`, the extra keys and `fields` only.
- `<message>` is a non-empty, human-readable English sentence of your own wording. Its text is not fixed by this brief: any non-empty sentence is correct, and no check compares it to a particular string. It never contains a credential, a stack trace or another person's private data.
- Validation adds `"fields":{"<field>":"<field message>"}`, using the exact field messages in Feedback states.
- Some codes add the extra keys listed in the catalogue.

**Error precedence** (the single rule for the whole API):

1. `cross_origin` for a cross-origin write (Server boundary).
2. `payload_too_large` when the whole request body exceeds its limit in Server boundary.
3. `unauthenticated`.
4. Idempotency, in this order: an invalid `Idempotency-Key` header gets the invalid-key error from Idempotency below; a key still being processed gets `idempotency_in_progress`; an idempotent replay returns its stored response; `idempotency_key_reused`.
5. `not_found` for any unknown id, or an id the caller may not see: another organisation's booking, a booking an interpreter neither holds nor is offered, an interpreter id unknown to the agency, another person's link token.
6. `forbidden` when the caller can see the resource but their role may not take the action.
7. Validation: 422 `validation`, 415, and the per-file `payload_too_large` from Prep material uploads. Validation runs before any state check, so a missing or malformed field (for example an absent `quoted_charge_cents`, `interpreter_id` or `seat`) is always answered `validation` and is never compared against booking state.
8. State conflicts: every other 409, plus `access_ended` and `link_expired` from the prep access window, in the order each rule in Business rules gives.
9. Dependency outages (503).

Two rules in Business rules list their own check order, and for the codes they name that order overrides steps 7 to 9: closing a week, and adding a contract rate.

**Error catalogue**

| Status | `error` | Extra keys |
|---|---|---|
| 401 | `unauthenticated` | |
| 401 | `invalid_credentials` | |
| 403 | `forbidden` | |
| 403 | `cross_origin` | |
| 403 | `access_ended` | |
| 404 | `not_found` | |
| 409 | `idempotency_in_progress` | |
| 409 | `invalid_transition` | `status` (current status) |
| 409 | `seat_filled` | |
| 409 | `already_holding` | |
| 409 | `schedule_conflict` | |
| 409 | `not_qualified` | |
| 409 | `open_call_closed` | |
| 409 | `already_team` | |
| 409 | `quote_changed` | `quote` (a quote object) |
| 409 | `pending_sync` | `pending_line_refs` |
| 409 | `week_closed` | |
| 409 | `total_mismatch` | `relayline_total_cents`, `billing_total_cents` |
| 409 | `rate_would_reprice` | `earliest_allowed` (date) |
| 410 | `link_expired` | |
| 413 | `payload_too_large` | |
| 415 | `unsupported_type` | |
| 422 | `validation` | `fields` |
| 422 | `idempotency_key_reused` | |
| 503 | `billing_unavailable` | |
| 503 | `storage_unavailable` | |

**Objects and published fields per role.** A response contains exactly the keys listed for the caller's role, and never any extra key.

- **Holder card** (`seats[].holder` when the seat is held, otherwise `null`):
  - coordinator: `id`, `name`, `initials`, `credentials` (array of `{"code","expires_on"}`), `phone`, `email`, `home_city`, `pay_rate_cents`.
  - billing_manager: `id`, `name`, `initials`, `credentials` (array of code strings).
  - requester: `name`, `initials`, `credentials` (array of code strings).
  - interpreter: `name`, `initials`, `credentials` (array of code strings), `is_me` (boolean).
- **Booking:**
  - Every role gets `id`, `ref`, `org_name`, `setting`, `title`, `location`, `onsite_contact_name`, `onsite_contact_phone`, `consumer_name`, `start`, `end`, `duration_minutes`, `status`, `seat_count`, `open_call_status`, `open_call_closes_at`, `coverage` `{"state","covered_minutes","percent"}`, `seats` (array of `{"seat","holder"}` ordered by seat), `rotation` and `materials`.
  - `open_call_status` is `none` before an open call is posted. It is `open` while the server clock is before `open_call_closes_at`, and `closed` from that instant on. The server decides it at the moment it answers. `open_call_closes_at` is null until the open call is posted.
  - Coordinator and billing_manager also get `org_id`, `requester_name`, `requester_notes`, `charge` and `created_at`.
  - Requester also gets `requester_name`, `requester_notes` and `charge`.
  - Interpreter gets nothing more.
  - `materials` is an array of `{"id","name","size_bytes","content_type","sha256","uploaded_at"}`, oldest first. `sha256` is 64 lowercase hexadecimal characters: the SHA-256 of the file bytes exactly as uploaded. The array is empty for an interpreter who is offered the booking but holds no seat on it.
  - `charge` is `null` or `{"line_ref","kind","amount_cents","sync_status"}`.
- **Rotation:** `{"mode","interval_minutes","threshold_minutes","coverage_text","turns":[{"index","kind","seat","holder_name","holder_initials","start","end","label"}]}`.
  - `mode` is `team` for a 2-seat booking and `solo` for a 1-seat booking.
  - `turns` holds every plan entry, turns and gaps alike, in `index` order. `index` is defined in the rotation plan rule in Business rules.
  - Turns have `kind` `turn`, a seat number, holder fields and `label: null`.
  - Gaps have `kind` `gap`, `seat`, `holder_name` and `holder_initials` null, and `label` `relief needed` or `uncovered`.
- **Quote:** `{"late","cutoff","interpreter_count","billable_minutes","charge_cents"}`.
- **Line:** `{"line_ref","booking_id","booking_ref","org_id","kind","assignment_date","rate_effective_from","hourly_rate_cents","team_surcharge_bp","basis_minutes","billable_minutes","interpreter_count","time_amount_cents","mileage_miles","mileage_cents_per_mile","mileage_amount_cents","amount_cents","billing_amount_cents","billing_week","sync_status","created_at"}`.
  - `kind` is `completed` or `late_cancellation`.
  - `sync_status` is `synced` or `pending_sync`.
  - `assignment_date` is the booking start's agency-local date. `rate_effective_from` is the `effective_from` of the rate the line used.
  - `billing_amount_cents` is Kill Bill's current amount for the line's charge (Billing sync). It is null while the line is `pending_sync`, and null when Kill Bill cannot be read.
- **Week statement:** `{"org_id","org_name","week_start","status","lines","relayline_total_cents","billing_total_cents","billing_reachable","closed_at"}`.
  - `status` is `open` or `closed`.
  - While the week is open, `billing_total_cents` is the sum of the lines' `billing_amount_cents`. It is null if any line is pending or Kill Bill cannot be read. Once the week is closed, it is the total recorded at close.
  - `billing_reachable` says whether Kill Bill answered while this statement was built.
  - `closed_at` is null while the week is open.
- **Interpreter choice** (in `GET /api/interpreters`): the coordinator holder card plus `qualified` and `busy` booleans, both null when no booking is given.
- **Audit entry:** `{"at","actor_name","action","from_status","to_status","seat","interpreter_name"}`.

**Endpoints.** "Who" lists the roles that may act. Other roles that can see the resource get `forbidden`.

| Method and path | Who | Request | Success | Own extra errors |
|---|---|---|---|---|
| `POST /api/session` | anyone | `{"email","password"}` | 200 `{"user":{"id","name","email","role","org_id"}}` and sets the cookie. `org_id` is null except for requesters | `invalid_credentials` |
| `DELETE /api/session` | signed in | — | 204 | |
| `GET /api/me` | signed in | — | 200 the user object | |
| `GET /api/agency` | signed in | — | 200 `{"name","time_zone","now","today","solo_threshold_minutes","open_call_lead_minutes","prep_access_grace_minutes","prep_link_ttl_seconds","upload_limit_bytes","max_files_per_booking","accepted_types"}` | |
| `GET /api/bookings?from=&to=` | all | dates, both optional | 200 `{"bookings":[booking]}`: visible bookings whose agency-local start date falls in `from`..`to` inclusive, ordered by start then ref. Default `from` is today and default `to` is `from` + 13 days. Interpreters get only bookings they hold | `validation` (`from`/`to`) |
| `POST /api/bookings` | requester, coordinator | `{"org_id"` (coordinator only; ignored for requesters)`,"setting","title","location","onsite_contact_name","onsite_contact_phone","consumer_name","start","duration_minutes","requester_notes"}`. `start` is agency wall-clock time `YYYY-MM-DDTHH:MM` with no offset | 201 booking | `validation` |
| `GET /api/bookings/:id` | all who can see it | — | 200 booking | |
| `GET /api/open-calls` | interpreter | — | 200 `{"bookings":[booking]}`: offered bookings whose `open_call_status` is `open`, that still have a vacant seat and on which the caller holds no seat, ordered by start | |
| `POST /api/bookings/:id/team` | coordinator | — | 200 booking | `already_team`, `invalid_transition` |
| `POST /api/bookings/:id/open-call` | coordinator | — | 200 booking | `open_call_closed`, `invalid_transition` |
| `POST /api/bookings/:id/claim` | interpreter | — | 200 booking | `already_holding`, `seat_filled`, `open_call_closed`, `schedule_conflict`, `invalid_transition` |
| `POST /api/bookings/:id/assign` | coordinator | `{"interpreter_id","seat"}` | 200 booking | `already_holding`, `seat_filled`, `not_qualified`, `schedule_conflict`, `invalid_transition`, `validation` (`interpreter_id`, `seat`) |
| `POST /api/bookings/:id/seats/:seat/release` | coordinator; the interpreter holding that seat | — | 200 booking | `invalid_transition` (also when the seat is vacant) |
| `GET /api/bookings/:id/cancellation-quote` | requester, coordinator | — | 200 quote | `invalid_transition` |
| `POST /api/bookings/:id/cancel` | requester, coordinator | `{"quoted_charge_cents"}` | 200 booking | `quote_changed`, `invalid_transition`, `validation` |
| `POST /api/bookings/:id/check-in` | coordinator | — | 200 booking | `invalid_transition` |
| `POST /api/bookings/:id/complete` | coordinator | `{"worked_minutes","mileage_miles"}` | 200 booking (its `charge` holds the new line) | `invalid_transition`, `validation` |
| `GET /api/bookings/:id/audit` | coordinator, billing_manager | — | 200 `{"entries":[audit entry]}`, oldest first | |
| `POST /api/bookings/:id/materials` | requester, coordinator | multipart form with one part `file` | 201 material | `payload_too_large`, `unsupported_type`, `invalid_transition` (cancelled or completed booking), `validation` (`file`), `storage_unavailable` |
| `POST /api/bookings/:id/materials/:mid/link` | interpreter holding a seat | — | 201 `{"url":"/api/prep/<token>","expires_at"}` | `access_ended` |
| `GET /api/prep/:token` | the interpreter the link was issued to | — | 200 the file bytes (Prep downloads) | `access_ended`, `link_expired`, `storage_unavailable` |
| `GET /api/interpreters?booking_id=&q=` | coordinator | both optional | 200 `{"interpreters":[interpreter choice]}`, ordered by name. With `q`, only interpreters whose name contains `q` (with leading and trailing spaces removed), ignoring letter case. An empty `q` matches everyone | `validation` (`q`) |
| `GET /api/contracts` | coordinator, billing_manager | — | 200 `{"contracts":[{"id","org_id","org_name","minimum_minutes","increment_minutes","rotation_interval_minutes","rates":[{"effective_from","hourly_rate_cents","team_surcharge_bp","mileage_cents_per_mile"}]}]}` | |
| `POST /api/contracts/:id/rates` | billing_manager | `{"effective_from","hourly_rate_cents","team_surcharge_bp","mileage_cents_per_mile"}` | 201 the contract | `rate_would_reprice`, `validation` |
| `GET /api/billing/weeks/:org_id/:week_start` | billing_manager; requesters of that organisation | — | 200 week statement | `validation` (`week_start`) |
| `POST /api/billing/weeks/:org_id/:week_start/close` | billing_manager | — | 200 week statement with `status` `closed` | `week_closed`, `pending_sync`, `total_mismatch`, `validation`, `billing_unavailable` |
| `GET /api/health` | anyone | — | 200 `{"status":"ok"}` | |

**Agency settings.** `GET /api/agency` returns:

- `name`, `time_zone` and `solo_threshold_minutes` from Seed data;
- `now`, the server's current instant, and `today`, its agency-local date;
- `open_call_lead_minutes`, `prep_access_grace_minutes` and `prep_link_ttl_seconds` from the settings in Configuration and secrets;
- `upload_limit_bytes` and `max_files_per_booking`, the per-file byte limit and the file count from Prep material uploads, as integers;
- `accepted_types`, the JSON array of media type strings from Prep material uploads, in that order.

**Text lengths.** Every text length in this brief is counted in Unicode code points: an emoji outside the Basic Multilingual Plane, such as 🦻, counts as 1, and an accented letter sent as one precomposed character counts as 1. Every limit is inclusive: a value exactly at the limit is accepted, and one code point more is refused. Text is counted as submitted, with no trimming. A value that is empty or only whitespace fails a minimum of 1. Accepted text is stored and returned exactly as submitted, never truncated, trimmed or normalised.

**Validation ranges.**

- `setting` is one of `medical`, `educational`, `legal`, `workplace`.
- `title`: 1 to 120 characters. `location`: 1 to 200. `onsite_contact_name` and `consumer_name`: 1 to 80.
- `onsite_contact_phone`: 7 to 25 characters, drawn only from digits, spaces, `+`, `-`, `(` and `)`.
- `start` is agency wall-clock time `YYYY-MM-DDTHH:MM` (seconds `:00` may be added; nothing else may), resolved by the agency time rule in Business rules. It must be at least 15 minutes after the request arrives. Exactly 15 is allowed.
- `duration_minutes` is an integer from 30 to 480 inclusive and a multiple of 15. `requester_notes` is 0 to 1,000 characters.
- `interpreter_id` is required. `seat` is an integer from 1 to the booking's `seat_count`.
- `q` is 0 to 80 characters.
- `quoted_charge_cents` is a required integer of 0 or more.
- `worked_minutes` is an integer from 1 to 720 inclusive. `mileage_miles` is an integer from 0 to 500 inclusive.
- `hourly_rate_cents` is from 1 to 100,000 inclusive. `team_surcharge_bp` is from 0 to 10,000 inclusive (basis points, so 1,000 is 10 percent). `mileage_cents_per_mile` is from 0 to 1,000 inclusive.
- `week_start` must be a Monday on or before the current agency-local week's Monday.
- `from` to `to` spans at most 31 days.

**Prep material uploads.**

- **Size:** the file part may be at most 10,000,000 bytes. Exactly 10,000,000 bytes is accepted, and larger files get `payload_too_large`. An empty file is a `validation` error on `file`.
- **Count:** a booking holds at most 10 files. An upload that would make an eleventh is a `validation` error on `file`, under the concurrency rule in Business rules.
- **Kind:** decided from the bytes only. The file name, extension and declared content type play no part. Accepted kinds:
  - PDF: starts with `%PDF-`.
  - PNG: the PNG signature.
  - JPEG: starts with the JPEG start-of-image marker.
  - DOCX: a ZIP archive containing `word/document.xml`.
  - PPTX: a ZIP archive containing `ppt/presentation.xml`.
- Anything else gets `unsupported_type`. That includes SVG and HTML in any form, and any ZIP with an entry name that is absolute or contains a `..` segment.
- **Stored content type:** the detected kind's media type. `accepted_types` is exactly `["application/pdf","image/png","image/jpeg","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.presentationml.presentation"]` (PDF, PNG, JPEG, DOCX and PPTX respectively).
- **Stored bytes:** the stored object holds exactly the uploaded bytes. `size_bytes` is their length and `sha256` their SHA-256.
- **Display name:** taken from the file part's file name, read as UTF-8, then:
  1. any directory part is removed (everything up to and including the last `/` or `\`);
  2. control characters (U+0000 to U+001F and U+007F) are removed;
  3. the result is cut to its first 120 code points, never splitting a character;
  4. if nothing is left, the name is `file`.

  Otherwise the name is kept exactly as submitted, with no Unicode normalisation: a name sent in decomposed form stays decomposed.
- **Object key:** the stored object key never contains any part of the uploaded name (pattern in Services).

**Prep downloads.**

- A link URL works for `prep_link_ttl_seconds` after it is issued, and only for the interpreter it was issued to.
- Every fetch re-checks that the interpreter still holds a seat on the booking and that the access window is open.
- A successful fetch answers 200 with exactly the stored bytes and these headers:
  - `Content-Type`: the stored content type;
  - `Content-Length`: equal to `size_bytes`;
  - `X-Content-Type-Options: nosniff`;
  - `Content-Disposition: attachment; filename="<fallback>"; filename*=UTF-8''<encoded>`.
- `<fallback>` is the display name with every code point outside U+0020 to U+007E, and every `"` and `\`, replaced by one `_`.
- `<encoded>` is the display name's UTF-8 bytes percent-encoded: letters, digits and the characters ``! # $ & + - . ^ _ ` | ~`` stay as they are, and every other byte becomes `%` followed by two uppercase hexadecimal digits.
- For example, a display name `Danh sách 🦻.pdf` (precomposed) gives `filename="Danh s_ch _.pdf"` and `filename*=UTF-8''Danh%20s%C3%A1ch%20%F0%9F%A6%BB.pdf`.

**Idempotency.**

- Every `POST` except `/api/session` and uploads accepts an optional `Idempotency-Key` header. A valid key is 1 to 100 characters, each a visible ASCII character (codes 33 to 126). Other methods, `POST /api/session` and uploads ignore the header.
- A header that is present but empty, longer than 100 characters, or contains any other character (including spaces) is answered 422 `{"error":"validation","message":"<message>","fields":{"idempotency_key":"<field message>"}}`.
  - `<message>` is any non-empty sentence, as defined in Error body.
  - `<field message>` is exactly the `idempotency_key` field message from Feedback states, and `fields` has no other key.
  - Nothing changes and nothing is stored.
- Keys are scoped to the signed-in user, not to a session, and kept for 24 hours. A key therefore survives signing in again. A request answered `unauthenticated` claims no key and stores nothing, so the same key can be used once the user has signed in again.
- **In progress.** A key is claimed before its request's action runs, so that exactly one request can hold it. While that request is still being processed, every other request from the same user with that key answers `idempotency_in_progress`, whatever its path or body. That answer has no effect, stores nothing and uses up nothing.
- **Replay.** Once the first request has finished, its status and body are stored, except a 503 answer, which stores nothing so the key can be retried after the dependency returns. A later request with the stored key, the same method and path, and a byte-identical body returns the stored status and body and changes nothing.
- **Reuse.** The same key with a different path or body, once the first request has finished, gets `idempotency_key_reused`.

### Business rules (DP-02, DP-03, DP-05, DP-06, DP-08, DP-09, DP-12, DP-13, DP-15, DP-16, DP-20, DP-22, DP-23, DP-24, DP-26, DP-27, DP-28, DP-29, DP-31, DP-32, DP-33, DP-35, DP-46, DP-50, DP-52, DP-56, DP-58, DP-59, DP-62, DP-65, DP-67)

**Who sees what.**

- Coordinators and the billing manager see every booking.
- A requester sees only bookings, prep files, invoice lines and weekly statements of their own organisation.
- An interpreter sees a booking only while they hold a seat on it, or while it is offered to them. Offered means an open call has been posted (whether or not it has since closed), the booking is not in progress or ended, and they are qualified for it.
- Everything else answers `not_found`, exactly as if the id did not exist. The response carries no booking data, consumer name or file list. This covers nested ids too: a material id under the wrong booking, and a seat on an invisible booking.

**Booking intake and references.**

- One `Idempotency-Key` produces at most one booking, one `submitted` audit entry and one booking reference, however many requests carry it and however they overlap.
- Booking references are consecutive. A request that creates no booking (refused, unauthenticated, in progress, replayed or reused) never uses up a reference, so the next booking created takes the next number.

**Agency time.**

- A submitted `start` is a wall-clock time in the agency zone. A wall-clock time that the spring-forward change skips does not exist and is refused with the `start` field message for it. A wall-clock time that the fall-back change repeats means its first occurrence.
- `end` is `start` plus `duration_minutes` in elapsed minutes, shown at the offset in force at that instant.
- For example, with the seed data at start:
  - `2027-03-14T02:30` is refused;
  - `2027-11-07T01:30` is stored as `2027-11-07T01:30:00-05:00`;
  - a 180-minute booking at `2027-03-14T00:30` has `end` `2027-03-14T04:30:00-05:00`.
- A booking belongs to the board day, list range and `assignment_date` of its agency-local start date, never its UTC date. A booking at 23:30 agency time is on that date, not the next one.

**Team seat rule.**

- A new booking gets 2 seats when its length is greater than the agency solo threshold or its setting is `legal`, and 1 seat otherwise. A length equal to the threshold stays solo.
- The coordinator can raise a 1-seat booking to 2 seats while it is submitted, open, partially covered or covered. A booking that already has 2 seats answers `already_team`.
- Seat counts never go down.

**Booking states.**

- Before check-in, a booking's status follows from its seats:
  - no seat held: `submitted`, or `open` once an open call has been posted;
  - some seats held: `partially_covered`;
  - all seats held: `covered`.
- Legal moves:
  - Post open call: from `submitted` only.
  - Fill a seat: from `submitted`, `open` or `partially_covered`. Claiming also needs `open_call_status` `open`. A fill on a `covered` booking is not a transition error: it follows the check order in Filling seats (`already_holding`, otherwise `seat_filled`).
  - Release a seat: from `partially_covered` or `covered`.
  - Make team: as in the team seat rule.
  - Check in: from `covered` only, to `in_progress`. It has no clock guard; it records the interpreters' arrival.
  - Complete: from `in_progress` only, to `completed`.
  - Cancel: from `submitted`, `open`, `partially_covered` or `covered`, to `cancelled` or `cancelled_late`.
- `completed`, `cancelled` and `cancelled_late` are final. Every action on a final booking, and every move not listed above, is rejected with `invalid_transition` carrying the current status.
- A released seat on a booking whose open call is still open is offered again at once.

**Qualification.**

- An interpreter qualifies for a booking when, on the booking's agency-local start date, they hold an unexpired credential from the setting's list. A credential is unexpired when its expiry date is on or after that date.
- Lists by setting:
  - `medical`: NIC or BEI.
  - `educational`: EIPA or NIC.
  - `legal`: SC:L.
  - `workplace`: NIC or BEI.
- An interpreter is busy when they hold a seat on another booking that is not cancelled and whose start-to-end span overlaps this one. Spans that only touch, end to start, do not overlap.

**Open call (server-timed).**

- `OPEN_CALL_LEAD_MINUTES` is elapsed time. `open_call_closes_at` is the instant exactly that many real minutes before the start instant. Across a clock change, its wall-clock time therefore differs from the start's.
- For example, with the seed data at start and the default lead time, a booking starting `2027-03-14T12:00:00-05:00` has `open_call_closes_at` `2027-03-13T11:00:00-06:00`.
- Posting at or after that instant answers `open_call_closed`.
- Claims arriving at or after that instant answer `open_call_closed`, including claims sent from a screen that still showed the row. Coordinator assignment stays possible until check-in.
- Only the server's clock decides. From that instant, `open_call_status` is `closed` in every response and the booking leaves `GET /api/open-calls`.

**Filling seats.**

- A claim fills the lowest-numbered vacant seat. Its checks run in this order:
  1. The interpreter already holds a seat here: `already_holding`.
  2. No seat is vacant: `seat_filled`.
  3. The open call has closed: `open_call_closed`.
  4. Busy: `schedule_conflict`.

  An unqualified interpreter cannot see the booking, so their claim answers `not_found`.
- An assignment fills the seat it names. Its checks run in this order:
  1. The interpreter already holds a seat here: `already_holding`.
  2. The named seat has a holder: `seat_filled`.
  3. Not qualified: `not_qualified`.
  4. Busy: `schedule_conflict`.
- When several claims or assignments that would fill the same seat arrive together, exactly one succeeds and every other receives `seat_filled`. A seat never has two holders, and a booking never shows more holders than seats, in any response, list, weave or email.

**Releasing seats.**

- Releasing empties the seat and recalculates the status.
- From that instant, the released interpreter cannot get new prep links, and links they already hold stop working.

**Rotation plan and coverage.** Let `D` be the length in minutes, `T` the agency solo threshold, `I` the contract rotation interval and `S` the booking start instant. Every boundary is an instant counted in elapsed minutes from `S`, and its displayed time is the agency wall-clock time at that instant.

- **Entry numbering:** the plan is a list of entries, turns and gaps alike, in time order. Each entry's `index` is its 0-based position in that list, gaps included. The plan's turn count is the number of entries of kind `turn`: `N` in an alternating plan, 1 in a single-holder plan with a seat held, and 0 with no seat held.
- **Alternating plan** (2 seats, both held):
  - `N` = D ÷ I rounded up.
  - Turn `i` (0-based, equal to its `index`) runs from S + i×I to the earlier of S + (i+1)×I and the end.
  - Even turns belong to seat 1's holder and odd turns to seat 2's holder.
  - Coverage text: `Team · <N> turns · 100% covered`.
  - For example, with the seed data at start, a 210-minute Riverbend team booking has 11 turns: ten of 20 minutes and a last one of 10 minutes.
  - For example, with the seed data at start, a Harlan County Court team booking at `2027-03-14T01:00` for 120 minutes ends at `04:00` and has 8 turns. The turn with index 3 runs `01:45`–`03:00` and the turn with index 4 runs `03:00`–`03:15`. No entry shows a `02:` time.
- **Single-holder plan** (anything else):
  - If a seat is held, entry 0 is a turn for that holder starting at S. On a 2-seat booking it lasts the lesser of D and T minutes; on a 1-seat booking it lasts all of D. If the booking runs longer than that turn, entry 1 is a gap labelled `relief needed` from the turn's end to the booking end.
  - If no seat is held, entry 0 is a gap labelled `uncovered` spanning the whole booking.
  - Coverage text: `<Solo or Team> · <covered minutes> of <D> min · <percent>% covered`. `Solo` is for 1-seat bookings and `Team` for 2-seat bookings.
- Covered minutes are D in an alternating plan, the length of the held turn in a single-holder plan, and 0 with no holder.
- `percent` is covered minutes × 100 ÷ D, rounded down to a whole number.
- `coverage.state` is `covered`, `partly_covered` or `uncovered`, by seats held against seats.

**Prep material storage.**

- A material record exists if and only if its stored object exists. An upload either stores both or leaves neither: if storing the object fails, no record is written; if writing the record fails, the object is removed. A refused upload never leaves an object behind.
- The stored object's bytes, the record's `size_bytes` and its `sha256` always describe the same bytes, exactly as uploaded.
- The 10-file count holds under concurrent uploads to one booking. For example, with 9 files present and 3 uploads sent at the same moment, exactly one answers 201, the other two answer `validation` with the full-booking `file` message, and the booking afterwards lists exactly 10 materials backed by exactly 10 objects.
- When storage is unreachable, the upload answers `storage_unavailable` after the size, kind and count checks, and the materials list is unchanged.

**Abandoned prep transfers.**

- When the client closes the connection during a prep download, the server stops reading the stored object at once and releases its storage connection. No database session of the app stays active or idle in a transaction because of it.
- After any number of abandoned downloads in a row (at least 60), the next full download of a 10,000,000-byte file arrives byte-identical within 5 seconds, and every other API call answers within one second.
- An upload whose client disconnects before the request body is complete leaves no material record and no object, and takes no place in the 10-file count. The booking's `prep/<booking id>/` prefix still holds exactly one object per record.

**Prep access window.**

- The assignment ends at its completion time once completed, and otherwise at its scheduled end.
- A current seat holder may get links and fetch files until the agency grace period after that end has passed. Access ends with `access_ended` at that moment, when they stop holding the seat, or when the booking is cancelled.
- A link older than its lifetime answers `link_expired`. When the access check would also fail, `access_ended` comes first.
- Requesters and coordinators can upload files and see the list, but cannot fetch file bytes.

**Late-cancellation window.**

- The cutoff is the booking's start moved back two business days in the agency time zone, keeping the start's wall-clock time. Moving back one business day goes to the previous Monday-to-Friday date. A Monday 09:00 start therefore has a Thursday 09:00 cutoff, and a Saturday start has a Thursday cutoff.
- Because the wall-clock time is kept, the cutoff's UTC offset may differ from the start's across a clock change. For example, with the seed data at start:
  - a start of `2027-11-08T09:00:00-06:00` has cutoff `2027-11-04T09:00:00-05:00`;
  - a start of `2027-03-15T09:00:00-05:00` has cutoff `2027-03-11T09:00:00-06:00`.
- When that wall-clock time does not exist on the cutoff date because of a clock change, the next valid instant is used.
- A cancellation received after the cutoff is late. Exactly at the cutoff is on time.
- The server's clock decides the moment. The server's own zone, and the browser's clock and zone, never matter.

**Cancellation quote and charge.**

- The quote reports `late`, the `cutoff`, `interpreter_count` (seats held now), `billable_minutes` and `charge_cents`.
- A late cancellation with at least one seat held is charged as an invoice line of kind `late_cancellation`: the basis is the scheduled length, mileage is 0, and the line arithmetic below applies. The booking ends `cancelled_late`.
- An on-time cancellation, or a late one with no seat held, charges 0 and ends `cancelled`.
- Every quote, and the charge checked at the moment of cancelling, is computed afresh with the contract rate selection rule below. No quote is stored.
- The cancel request must carry the `quoted_charge_cents` the user saw. If it differs from the charge computed at the moment of cancelling, nothing changes and the answer is `quote_changed` with the current quote. A seat filled after the quote, or a contract rate added after the quote whose `effective_from` is on or before the booking's `assignment_date`, therefore makes the old quote fail.

**Contract rate selection.** The rate used for a line or a quote is the contract rate with the latest `effective_from` on or before the booking's `assignment_date` (its agency-local start date). For example, with the seed data at start, after a Maple Valley rate of 9,000 cents an hour is added from a date `D`:

- a 60-minute solo session starting at 23:30 on the day before `D`, completed with 135 worked minutes, bills 17,663 cents with `rate_effective_from` `2026-01-01`;
- the same session starting at 00:15 on `D` bills 20,250 cents with `rate_effective_from` `D`.

**Invoice line arithmetic.**

- A line is created exactly once and never recomputed. It is created either at completion (kind `completed`, basis = the greater of scheduled length and worked minutes) or at a charged late cancellation.
- The rate comes from the contract rate selection rule above.
- Billable minutes = the basis rounded up to the next multiple of the contract increment (15 minutes), or the contract minimum (120 minutes) if that is larger.
- Interpreter count = seats held (1 or 2). The team surcharge applies only when the count is 2.
- Time amount = hourly rate × billable minutes × interpreter count ÷ 60, then times (10,000 + surcharge basis points) ÷ 10,000 when the surcharge applies. This value is rounded once, to whole cents, with exact halves rounding up. No other step rounds.
- Mileage amount = mileage miles × the mileage rate in cents.
- Line amount = time amount + mileage amount.
- For example, with the seed data at start:
  - A Riverbend team completion scheduled for 210 minutes, with 230 worked minutes and 18 miles, bills 240 minutes: time amount 79,200 cents, mileage 1,206 cents, line 80,406 cents ($804.06).
  - A Maple Valley 60-minute solo booking completed with 135 worked minutes and no mileage gives 17,662.5 cents, which rounds to 17,663 cents ($176.63).
  - A late Riverbend cancellation of a 90-minute team booking with both seats held bills 120 minutes: 39,600 cents ($396.00).

**Completion retries.** A completion carrying an `Idempotency-Key` that is replayed returns the stored 200 and creates nothing. Whatever mix of replays, in-progress duplicates, new keys and repeats without a key reaches one booking, it ends with exactly one invoice line, one Kill Bill external charge whose description starts with that line's reference followed by a space, one `completed` audit entry and no email. A later completion with a new key on the completed booking answers `invalid_transition` and leaves the original line and its `basis_minutes` unchanged.

**Billing sync (provider-confirmed).**

- Every new line is queued for Kill Bill in the same step that records the completion or cancellation. The line starts `pending_sync`.
- A line becomes `synced` only after Relayline has read its charge back from Kill Bill, as an invoice item on the organisation's account, and stored that invoice item's id. A successful posting response alone never makes a line synced.
- If Kill Bill is unreachable, the completion or cancellation still succeeds with its normal response, and the line stays `pending_sync`.
- The server retries pending lines at least every 15 seconds, without a restart. Each line is synced within 60 seconds of Kill Bill becoming reachable again.
- After an unclear failure (no answer, or an answer that cannot be read), Relayline first searches the account's invoice items for a description starting with `<line ref> ` (the line reference followed by a space). If it finds one, it adopts that item and does not post again. Each line maps to exactly one Kill Bill charge.
- A synced line's `billing_amount_cents` is Kill Bill's current amount for that item: the charge's amount plus every item adjustment Kill Bill records against it, in cents. Relayline reads it from Kill Bill each time it builds a week statement, and each time it closes a week. Adjustments made directly in Kill Bill therefore show on the next read.

**Billing weeks and close.**

- A line's `billing_week` is the Monday of the agency-local week (Monday to Sunday) in which it was created. If that week is already closed for the organisation, it is the next week that is not closed.
- After `week_start` validation, closing a week runs these checks in order:
  1. The week is already closed: `week_closed`.
  2. A line is still pending: `pending_sync`, with its refs.
  3. Kill Bill cannot be read: `billing_unavailable`.
  4. The Relayline total (sum of the week's line `amount_cents`) differs from the billing total (sum of the lines' `billing_amount_cents`, read from Kill Bill at that moment): `total_mismatch`, carrying both totals exactly. The week stays `open`.
- Otherwise the week becomes `closed` and records both totals and `closed_at`. A week with no lines closes with both totals 0.

**Contract rates.** Adding a rate runs these checks in order:

1. Field validation, including: `effective_from` must be after today in agency time and must differ from every existing rate's date. Otherwise the answer is a `validation` error.
2. `effective_from` must be later than the `assignment_date` of every line already billed under that contract. Otherwise the answer is `rate_would_reprice`, with `earliest_allowed` set to the day after the latest such date, or tomorrow if that is later.

Existing lines never change.

**Emails.**

- Every email is queued in the same step as the state change that causes it, and sent exactly once per state change. Idempotent replays, in-progress duplicates and rejected repeats send nothing.
- If the mail server is unreachable, messages wait and go out within 30 seconds of it returning, without a restart.
- Triggers:
  - Each time an interpreter gains a seat, one assignment confirmation goes to that interpreter.
  - Each time a booking enters `covered`, one coverage confirmation goes to its requester. The requester is the person who submitted the booking, or the organisation's seeded requester when the coordinator submitted it.
  - Each cancellation sends one notice to the requester and one to each interpreter holding a seat at that moment.
- **Interpreter copies** may carry: reference, setting, title, location, on-site contact name and phone, Deaf consumer name, start and end, seat number, the co-interpreter's name, and the number of prep files.
  - A late cancellation notice says "This was a late cancellation."
  - An interpreter copy never carries the requester's notes, the requester's email, any rate or any money amount.
- **Requester copies** may carry: reference, title, start and end, and each holder's name and credential codes.
  - A late cancellation notice to the requester states "Late cancellation charge: `<amount>`". An on-time one states "No cancellation charge."
  - A requester copy never carries an interpreter's phone, email, home city, pay rate or other clients.

**Audit trail.**

- Every successful state-changing action writes exactly one audit entry, named by the action, and never a second entry for a status change it causes. The actions are `submitted`, `made_team`, `open_call_published`, `seat_filled`, `seat_released`, `checked_in`, `completed` and `cancelled` (also used for a late cancellation).
- Each entry's `from_status` and `to_status` are the booking status before and after the action, equal when the status did not change. `submitted` has `from_status` null.
- For example, filling the last vacant seat writes one `seat_filled` entry from `partially_covered` to `covered`. Releasing a seat on a covered team booking writes one `seat_released` entry from `covered` to `partially_covered`.
- `seat` and `interpreter_name` are set on `seat_filled` and `seat_released` entries and null on all others.
- Replays, in-progress duplicates, unauthenticated attempts and rejected requests write nothing.

**Repeats without a key.** Repeating a finished transition, such as completing a completed booking or cancelling a cancelled one, answers `invalid_transition` and creates no line, charge, email or audit entry.

### Services (DP-12, DP-20, DP-24, DP-28, DP-29, DP-31, DP-50, DP-56, DP-62, DP-65)

- **Postgres** is the system of record for everything: organisations, contracts and their effective-dated rates, users and interpreters with credentials, bookings, seats, sessions, idempotency records, materials metadata with their SHA-256, invoice lines with their sync state and confirmed Kill Bill invoice item id, weeks, the email queue and the audit trail.
  - The server applies its schema and seed idempotently every time it starts serving, because the database may be empty at boot.
  - Several server processes, each with different settings or a different broken dependency, can run against the same database at once and may start together. Schema and seed setup must tolerate a concurrent start, and a session signed in through one process works on the others; a session ended through one process is ended on all of them. Idempotency keys, seat claims and file counts hold across processes.
  - Each queued email and invoice line is sent or posted by exactly one process, whichever picks it up first.
- **Mailpit (SMTP).** Mail is sent with the From line read from `MAIL_FROM`, which is `Relayline <dispatch@tandemhands.example>`, to the recipient's seeded email. `<date>` and `<time>` are the booking start in agency time. Subjects:
  - Assignment confirmation: `Assignment confirmed: <ref> on <date> at <time>`
  - Coverage confirmation: `Booking covered: <ref> on <date> at <time>`
  - Cancellation notice: `Booking cancelled: <ref> on <date> at <time>`

  When mail is down, the email rule in Business rules applies. Every action still answers with its normal success, and no screen shows a mail error.
- **Kill Bill.**
  - Each client organisation has one Kill Bill account with `externalKey` equal to the organisation id, the organisation's name, and currency USD. The app creates the account the first time it needs it.
  - Each invoice line posts as one external charge on that account, committed straight away so it appears as an item on an account invoice. Its amount is the line amount in dollars (cents ÷ 100, exact). Its description starts with `<line ref> <booking ref>`, followed by `completed` or `late cancellation`.
  - Read-back and adjustments follow the billing sync rule in Business rules.
  - When Kill Bill is down:
    - completion and cancellation behave as in the billing sync rule;
    - week statements answer 200 with `billing_reachable` false, and null billing amounts and total;
    - closing a week answers `billing_unavailable`.

    The copy is in Feedback states.
- **MinIO (S3).**
  - Each prep file is one object in the configured bucket at `prep/<booking id>/<key>`, where `<key>` is 32 lowercase hexadecimal characters chosen by the server. The prefix of a booking holds exactly one object per material record, and each object's bytes are exactly the uploaded bytes.
  - Downloads and uploads release their storage connection as in the abandoned-transfer rule in Business rules.
  - When storage is unreachable:
    - uploads behave as in the prep material storage rule and answer `storage_unavailable`;
    - `GET /api/bookings/:id`, the booking lists and every other booking action answer as normal, with the materials list as recorded;
    - a current holder can still get a link, and fetching it answers `storage_unavailable`.

    The copy is in Feedback states.

### Seed data (DP-01, DP-08, DP-27)

Every seeded person, organisation and contact detail is invented. Every account's password is `relayline-demo-2026`. No bookings, materials, lines or closed weeks exist at start.

**Agency:** Tandem Hands Collective, time zone `America/Chicago`, solo threshold 60 minutes.

**Staff**

| Name | Email | Role |
|---|---|---|
| Dana Okafor | dana.okafor@tandemhands.example | coordinator |
| Morgan Ellis | morgan.ellis@tandemhands.example | billing_manager |

**Organisations, requesters and contracts.** All rates take effect from 2026-01-01. Every contract has a minimum of 120 minutes and an increment of 15 minutes.

| Org id | Name | Requester | Hourly rate | Team surcharge | Mileage | Rotation interval |
|---|---|---|---|---|---|---|
| `riverbend` | Riverbend Regional Hospital | Lena Torres, lena.torres@riverbend.example | 9,000 cents | 1,000 bp | 67 cents/mile | 20 min |
| `maple-valley` | Maple Valley School District | Sam Whitfield, sam.whitfield@maplevalley.example | 7,850 cents | 500 bp | 70 cents/mile | 30 min |
| `harlan-court` | Harlan County Court | Ruth Adeyemi, ruth.adeyemi@harlancourt.example | 10,500 cents | 1,500 bp | 0 cents/mile | 15 min |

**Interpreters** (role `interpreter`). Three interpreters hold an unexpired SC:L credential and so qualify for legal bookings: Riley Brooks, Quinn Halvorsen and Sasha Lindqvist.

| Id | Name | Initials | Email | Phone | Home city | Credentials (code, expires) | Pay rate |
|---|---|---|---|---|---|---|---|
| `jordan-reyes` | Jordan Reyes | JR | jordan.reyes@interpreters.example | +1 555 010 0141 | Fairbrook | NIC 2028-06-30 | 5,500 cents |
| `avery-chen` | Avery Chen | AC | avery.chen@interpreters.example | +1 555 010 0142 | Linden Park | NIC 2027-12-31; EIPA 2027-08-31 | 5,200 cents |
| `casey-morgan` | Casey Morgan | CM | casey.morgan@interpreters.example | +1 555 010 0143 | Oak Hollow | BEI 2028-03-31 | 5,000 cents |
| `riley-brooks` | Riley Brooks | RB | riley.brooks@interpreters.example | +1 555 010 0144 | Westmere | NIC 2028-12-31; SC:L 2028-12-31 | 6,500 cents |
| `taylor-nguyen` | Taylor Nguyen | TN | taylor.nguyen@interpreters.example | +1 555 010 0145 | Fairbrook | NIC 2026-01-31 (expired); EIPA 2027-05-31 | 4,800 cents |
| `quinn-halvorsen` | Quinn Halvorsen | QH | quinn.halvorsen@interpreters.example | +1 555 010 0146 | Cedar Bluff | NIC 2029-01-31; SC:L 2029-01-31 | 6,200 cents |
| `sasha-lindqvist` | Sasha Lindqvist | SL | sasha.lindqvist@interpreters.example | +1 555 010 0147 | Granite Falls | SC:L 2028-09-30 | 6,300 cents |

**References:**

- Booking references are `BK-` followed by a sequence that starts at 1001, numbered by the intake rule in Business rules.
- Invoice line references are `LN-` followed by a sequence that starts at 5001.
- Interpreter initials are the first letters of the first and last name.

## Technical requirements

### Deployment (DP-36)

- Node.js 22 LTS and npm are available. Write the app in TypeScript.
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- `serve` binds `0.0.0.0` on port 4173, or on the port in `APP_PUBLIC_PORT` when that is set.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` once the server is serving.

### Configuration and secrets (DP-37)

- The server reads these at start: `DATABASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`, `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `APP_PUBLIC_PORT`.
- Time rules use these whole-number settings, with the defaults in brackets. The verifier may set them low.
  - `OPEN_CALL_LEAD_MINUTES` (1440): the open-call lead time before start, in elapsed minutes.
  - `PREP_ACCESS_GRACE_MINUTES` (4320, which is 72 hours): the access grace after an assignment ends.
  - `PREP_LINK_TTL_SECONDS` (300): the download-link lifetime.
- No URL, password, key or bucket name is written into source. None ever reaches the browser, a page, an API response or an email.

### Server boundary (DP-38)

- The app and its API come from one origin. The server sends no cross-origin permission headers.
- A `POST`, `PUT`, `PATCH` or `DELETE` whose `Origin` header is present and differs from the app's own origin is rejected with `cross_origin` before anything else happens.
- JSON bodies may be up to 65,536 bytes. Exactly 65,536 is accepted, and larger bodies get `payload_too_large`.
- A whole multipart upload request may be up to 10,100,000 bytes, with the same rule at the limit. The per-file limit is in API.
- The server serves only the built front end, its bundled fonts and `/api`. Requests for source files, `package.json`, lockfiles, `run.json`, environment files, dotfiles or source maps answer 404.
- If Kill Bill, Mailpit or MinIO is unreachable at boot, the server still starts, answers health, and recovers each dependency on its own when it returns.
- If Postgres is unreachable at boot, the server keeps retrying every few seconds and starts serving once it connects.

### Browser support and performance (DP-40, DP-57, DP-65)

- Supported browsers are current Chromium, Firefox and WebKit, with any browser time zone and a browser clock that may be hours wrong, on mouse, keyboard and touch devices, with several tabs of one browser signed in at once.
- Viewports covered: 375x812, 768x1024 and 1280x800, plus the range edges at 767, 1199 and 1200 px wide.
- Each home screen is usable within three seconds of sign-in on a seeded day. Ordinary API calls answer within one second, including after abandoned prep transfers as stated in Business rules.
- A board with 40 bookings on one day stays responsive to scrolling and selection.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package and every bundled font with its licence. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (as defined in IF-02) and bundled font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1.
- IF-04: Postgres is the only datastore. There is no SQLite, Redis, embedded database or state file on disk, and prep files live only in the configured bucket.
- IF-05: A committed `package-lock.json` pins the dependency tree used by `install`.
- IF-06: The provided service configuration (compose files and their environment values) is left untouched.
- IF-07: The browser loads no script, style or font from any origin other than the app's own.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes. Names use this brief's domain terms: booking, seat, holder, open call, rotation plan, turn, gap, invoice line, billing week, contract rate, assignment date, idempotency key, prep material.
- Each domain rule is decided in exactly one place in the source: the status of a booking, the team seat rule, qualification, agency-time resolution of a start, the open-call close instant, the late-cancellation cutoff, contract rate selection, the line arithmetic, the rotation plan, text length counting, the display name and download file name, idempotency key claiming and a line's sync state. Screens and emails take their values from there.
- Money is handled only as integer cents, with the single rounding step from Business rules. It is never stored or added up as floating-point dollars.
- Every time-dependent state the screen shows comes from the server. Browser code never reads its own clock to decide open, closed, late or expired.
- Every API error is produced through one error shape matching the API error body, with no ad hoc response bodies.
- Periodic refreshes merge data into existing screen state rather than rebuilding dialogs, inputs or the weave; stale responses are discarded by one rule; a search and a dialog opening show only the answer to their own latest request; and an action answered unauthenticated is resumed by one rule in the browser.
- Streams to and from storage are closed when the client leaves, and no abstraction has only one implementation; the code has no defensive checks for states the rules make impossible.
- There is no dead, commented-out or unreachable code, and no feature, endpoint or screen beyond this brief.
