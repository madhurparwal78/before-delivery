# Brigade Hall Software Stationkeeper

Stationkeeper is the booking, compliance and billing desk for one shared-use commercial kitchen. The seeded kitchen is Larder Row Kitchen, a commissary that rents hot lines, a bake deck and cold-prep benches by the hour, and walk-in storage shelves by the month. Caterers, food trucks, bakers and packaged-food startups rent this space. One kitchen operator runs the building. Tenant owners claim station time, keep their insurance and permits on file and pay their bills. Tenant staff cooks see their shifts and check in and out. A health inspector opens a single tenant's current documents from a link, with no account. The centre of the product is the Service Dial: a 24-hour ring wrapped around an SVG floor plan of the kitchen. Turning the ring shows what every station is doing at any minute of the kitchen day. Build it as a TypeScript web app backed by four services. PostgreSQL is the system of record. Kill Bill records every charge, credit and payment on one account per tenant business. MinIO stores uploaded documents and invoice PDFs. An SMTP server, which Mailpit captures, receives every email. Out of scope: self-service sign-up, password reset, more than one kitchen, card payments to a real processor, SMS, calendar sync, and any datastore beyond the four services named here.

## Problem and users

Many shared kitchens still keep one calendar per station. They take requests by text and email, chase paperwork by hand and spend days each month on unpaid hours, hold-over time and storage fees. Two tenants end up booked onto one range. A tenant whose liability certificate lapsed last week still cooks, which breaks the kitchen's insurance terms and its health-department permit. A late cancellation goes unbilled because nobody remembers which cancellation terms applied when the booking was made. The solo operator pays with unpaid evenings of admin and lost revenue. Tenants pay with missed production days.

- **Kitchen operator** (daily): keeps every station booked, every tenant compliant and every hour billed without rebuilding the schedule by hand. Reviews documents, issues inspection links, assigns shelves, sets the cancellation policy and issues monthly invoices.
- **Tenant owner** (weekly): claims production time on the right station, keeps the certificate of insurance, health permit and food handler cards current, buys hour packs, and pays a clear bill.
- **Tenant staff cook** (daily): sees the business's shifts, places and confirms holds, checks in and out, and reports hold-over minutes honestly.
- **Health inspector** (occasional): opens one tenant's current permit, insurance and food handler documents from a link, without an account.

## Journeys

1. **Operator's morning read of the day.** Start: the operator is signed out and the seed data is loaded. The operator signs in and lands on the dial at the current kitchen minute. They turn the ring through the morning, select the hot line that Lantern Street Tacos booked, and read the business name, contact and notes in the right rail. They see the striped cleaning buffer after that booking. End state: the centre readout shows the chosen time and the open count, and the rail lists every station's state at that instant.
2. **Owner claims an evening block.** Start: the Juniper & Rye owner is signed in on the dial. They pick tomorrow, turn to the evening, select a free hot line, and draw an arc on the ring, or use "Hold this station". The hold appears with a countdown. They choose to pay from the account and confirm. A competing owner who tried the same block at the same moment gets an honest conflict. End state: the station tile shows the booking, the booking appears in Bookings, Kill Bill holds a station-time charge on Juniper & Rye's account, and the owner's inbox holds the confirmation email.
3. **Baker's weekly bake-deck slot.** Start: an owner is signed in with hour-pack hours available. They hold the Bake Deck every Tuesday at 05:00 for several weeks across a clock change, confirm with the hour pack, and open Billing. End state: every occurrence starts at 05:00 kitchen wall time, and the hour ledger shows one pair of entries for each booking.
4. **Cook's shift by keyboard.** Start: a cook is signed in. Using only the keyboard, they turn the dial to the current step, select a free station, place a hold, and confirm it. They check in from Bookings, then check out and report the minutes they stayed past the booked end. End state: the booking shows as completed with its stored hold-over, and the owner receives a hold-over notice when hold-over was billed.
5. **Suspension and reinstatement.** Start: the Saltgrass Pies owner signs in and sees the business suspended because its certificate of insurance has expired. They upload a renewed certificate. The operator approves it from Documents. End state: Saltgrass Pies shows as active, the owner has an approval email, and the owner can place a hold again.
6. **Inspector visit.** Start: the operator is on Tenants. They issue a 24-hour inspection link for Lantern Street Tacos and copy it. The inspector opens it in a private window and sees only that business's current documents. The operator then revokes it. End state: the link shows the no-longer-valid page.
7. **Month-end billing.** Start: the operator is on Tenants and Billing. They assign a walk-in shelf to a tenant and issue that tenant's invoice for the current month. The owner opens Billing, downloads the PDF and pays. End state: the invoice shows as paid, Kill Bill holds the payment, and the owner has the invoice notice and receipt emails.
8. **Cancellation terms change.** Start: an owner has a confirmed booking under the current policy. The operator saves a stricter policy. The owner then cancels the older booking inside its late window and also cancels a booking confirmed after the change. End state: each cancellation is charged under the terms its own booking was confirmed with, and each booking shows its policy version.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** The run manifest installs, builds and serves the app, and the health path answers, as specified in Deployment.
- **DP-02 — Sign-in and roles** Seeded people sign in with email and password, and each role reaches exactly the actions the API role column allows, with everything else refused as stated there.
- **DP-03 — One error shape** Every API error uses the single error body and the single precedence order defined at the top of API.
- **DP-04 — Server boundary** The server enforces the same-origin, body-size and never-served rules in Server boundary.
- **DP-05 — Start and recover without billing or storage** With Kill Bill or MinIO unreachable, the app still starts, serves the dial and every action that does not need the missing service, refuses affected actions with the outage responses in Services, and resumes them without a restart once the service returns.
- **DP-06 — Credentials from the environment** Every service URL and credential is read from the environment variables in Configuration and secrets, never hard-coded and never sent to the browser.
- **DP-07 — Real provider records** Charges, credits, payments, files and emails come from real calls to Kill Bill, MinIO and the SMTP server, never simulated or reported only by the app.
- **DP-08 — Dial day API** `GET /api/dial` returns every station's blocks for one kitchen day in wall-clock minutes, as specified in API.
- **DP-09 — Anonymous blocks for other tenants** Tenant users see other tenants' holds and bookings only as anonymous booked blocks with the published fields, while the operator sees full detail.
- **DP-10 — Kitchen time zone** The dial, today, the current minute, cutoffs, check-in windows, document validity and invoice periods all follow the kitchen's time zone, whatever zone the browser is in.
- **DP-11 — Service dial control** The dial is a slider that dragging, the wheel and the arrow keys move in fixed steps across the kitchen day, with the angle, keys and accessible value text defined in Interactions.
- **DP-12 — Station states by pattern and label** Each floor-plan station shows free, booked, held or cleaning with its own pattern and a visible text label as well as colour, at the contrast stated in Visual design.
- **DP-13 — Place and release a hold** Tenant users and the operator place a hold on a free station within the length, step and booking-window rules in Business rules, and can release it.
- **DP-14 — Cleaning buffer** A hold that would start or end inside the cleaning buffer of another tenant's block on the same station is refused, while one tenant may book back to back.
- **DP-15 — One winner per slot** When several overlapping holds on one station arrive at the same moment, exactly one is placed and every other gets the slot conflict.
- **DP-16 — Hold expiry edge** The server judges hold expiry at the exact instant stated in Business rules: from that instant it refuses confirmation and the slot is free again.
- **DP-17 — Draw a hold on the dial** With a free station selected, dragging along the ring draws an arc that becomes a server-confirmed hold, or that snaps back with the conflict copy when the server refuses it.
- **DP-18 — Confirm a hold** Confirming a live hold turns each of its bookings into a confirmed booking under the cancellation policy in force at that moment, paid from the account or the hour pack.
- **DP-19 — Repeat-safe confirm** A confirm repeated with the same `Idempotency-Key` returns the original response and changes nothing, and the same key with a different body is refused.
- **DP-20 — All-or-nothing confirmation** The bookings, their Kill Bill charges and the confirmation email all happen or none of them does, and a refused confirm leaves the hold as it was, within the failure model in Business rules.
- **DP-21 — Booking confirmation email** Each successful confirm sends one email to the tenant owner, with the subject and contents in Services and nothing about any other tenant.
- **DP-22 — Book a station end to end** A tenant owner signs in, finds a free gap on the dial, holds it, confirms it, and sees the booking on the dial and in Bookings.
- **DP-23 — Weekly repeats** A hold may repeat weekly for a set number of weeks, and it is placed only if every occurrence is free.
- **DP-24 — Wall-clock time across DST changes** Each weekly occurrence keeps the same local start and end across clock changes, and skipped or repeated local hours follow the rule in Business rules.
- **DP-25 — Check-in and no-show** Staff check in only inside the check-in window and only while their business is active, and the operator marks a confirmed booking as a no-show only once it has started.
- **DP-26 — Hold-over at check-out** Check-out records the cook's reported minutes past the booked end and stores the billed hold-over once, using the grace period and rounding in Business rules.
- **DP-27 — Hold-over charge and notice** Billed hold-over is recorded as one Kill Bill charge and one notice email to the tenant owner, together with the check-out, or the check-out is refused, within the failure model in Business rules.
- **DP-28 — Cook shift journey** A tenant staff cook signs in, sees the business's shifts, checks in, checks out with hold-over, and sees the stored hold-over on the booking.
- **DP-29 — Cancellation policy versions** The operator saves a new cancellation policy version that applies only to bookings confirmed afterwards, and every booking keeps and shows the version it was confirmed under.
- **DP-30 — Cancellation charges and fee refunds** Cancelling uses the booking's own policy version to decide between a free and a late cancellation and records the matching credit, fee or hour return, and the operator can refund an uninvoiced late fee once.
- **DP-31 — Buy an hour pack** A tenant owner buys an hour pack, and it is recorded once as a Kill Bill payment before the hours appear in the balance.
- **DP-32 — Hour ledger balance** Every hour-pack movement is two opposite ledger entries, the balance always equals the sum of the tenant's entries, and it never goes below zero.
- **DP-33 — Pay with an hour pack** Confirming with the hour pack debits the elapsed minutes of every booking in the hold at once, or is refused when the balance is too small.
- **DP-34 — Upload a compliance document** A tenant owner uploads a certificate of insurance, food handler card or health permit with its expiry date, and the file is stored in MinIO before its record exists.
- **DP-35 — Accepted file content** Uploads are accepted only when their bytes are a PDF, JPEG or PNG within the size cap in Business rules, whatever the file name or declared type.
- **DP-36 — Documents stay with their tenant** A tenant user who asks for another tenant's document record or file by ID gets the not-found response.
- **DP-37 — Upload journey** A tenant owner uploads a document from Documents and sees it listed as awaiting review with its expiry date.
- **DP-38 — Review documents** The operator approves a pending document only after reading its stored file back, or rejects it with a reason, and the tenant owner is emailed either way.
- **DP-39 — Document validity edge** A document stops counting at the start of the kitchen day after its expiry date, which blocks bookings past that point and suspends the business, as qualified in Business rules.
- **DP-40 — Expiry reminders** Each approved document triggers one reminder email to the tenant owner once it falls within the reminder lead time in Business rules.
- **DP-41 — Tenant lifecycle** A tenant moves through applied, documents review, active, suspended and offboarded only along the legal edges in Business rules.
- **DP-42 — Reinstatement journey** A suspended tenant's owner uploads a renewed certificate, the operator approves it, and the business shows as active and can place a hold again.
- **DP-43 — Issue an inspection link** The operator issues an expiring read-only link for one tenant, which replaces any earlier link for that tenant.
- **DP-44 — Inspector view** Without an account, the link shows only that tenant's name, its current approved and valid documents, and their files.
- **DP-45 — Link revoke, expiry and read-only** A revoked, replaced or expired link stops working at once, and no request through any link can change anything.
- **DP-46 — Storage shelves** The operator assigns walk-in storage shelves to tenants, and each assigned shelf is billed once per monthly period.
- **DP-47 — Monthly invoice lines and tax** Issuing an invoice gathers the tenant's uninvoiced items for a kitchen-time month and totals them with sales tax in exact cents, by the rule in Business rules.
- **DP-48 — Invoice PDF and notice** An issued invoice has its PDF stored in MinIO, its shelf and tax charges recorded in Kill Bill, and a notice email queued, all together or not at all.
- **DP-49 — Pay an invoice** A tenant owner pays an issued invoice once, it is recorded as one Kill Bill payment, and a receipt email follows.
- **DP-50 — Month-end billing journey** The operator assigns a shelf and issues a tenant's invoice, and the tenant owner opens it, downloads its PDF and pays it.
- **DP-51 — Booking search** Booking search returns only the caller's own business's bookings for tenant users, and all bookings for the operator.
- **DP-52 — Booking export** The CSV export contains every booking matching the same filters as search, without the search row cap, and only the columns the caller's role permits.
- **DP-53 — Bookings and invoices by ID** A tenant user who asks for, or acts on, another tenant's booking, hold or invoice by ID gets the not-found response.
- **DP-54 — Keyboard-only booking** A tenant staff cook can turn the dial, pick a station, place a hold and confirm it with the keyboard alone.
- **DP-55 — Dialog focus** Every dialog takes focus when it opens, keeps Tab inside, closes on Escape, and returns focus to the control that opened it.
- **DP-56 — Responsive layout** Every screen fits the 375x812, 768x1024 and 1280x800 viewports without horizontal scrolling, in the arrangement in Screens and layout.
- **DP-57 — Visual direction** The app reads as a stainless spec sheet: a pale grey ground, hairline rules, one signal-orange accent, a grotesque display face and mono numerals, as described in Visual design.
- **DP-58 — Dial motion** Each dial step moves the handle and the orange spoke, then cross-fades the station tiles, then rolls the readout, in that order and within the timings in Motion and effects.
- **DP-59 — Reduced motion** When reduced motion is requested, tiles and readout switch at once, and a time listbox with start and end selects replaces the arc drag.
- **DP-60 — Feedback states** Every async action shows its pending, success, error and outage copy in the named live regions, as qualified in Feedback states.

## Frontend

### Screens and layout (DP-22, DP-28, DP-37, DP-42, DP-50, DP-56)

Every signed-in screen shares a top bar with the product name, the kitchen clock ("Kitchen time HH:MM", in kitchen time), the main navigation and a sign-out button. Navigation by role:

- Operator: Dial, Bookings, Documents, Billing, Tenants, Settings.
- Tenant owner: Dial, Bookings, Documents, Billing.
- Tenant staff cook: Dial, Bookings.

Navigating straight to a screen the role cannot use shows the Dial instead.

Screens:

- **Sign in** (`/signin`): the product name, the kitchen name, and an email and password form. Signed-out visits to any other screen except the inspector page go here.
- **Dial** (`/`, the landing screen after sign-in): the composition is a spec-sheet grid. The left two-thirds holds the Service Dial: a circular 24-hour ring around an SVG floor plan of the kitchen with five station tiles (Hot Line 1, Hot Line 2, Bake Deck, Cold-Prep Bench A, Cold-Prep Bench B) and a walk-in drawn as context, which is not bookable on the dial. The ring has hour ticks, a draggable handle, an orange spoke from the centre to the handle, and a centre readout with the selected time and "N of M open". Above the dial is a day bar: previous day, a date field, next day and "Now". The narrow right rail is the "Selected instant" panel. It has one mono-numbered row per station (row number, station name, state label, tenant name when visible to the viewer, and "until HH:MM" when the state ends that day), separated by hairline rules. Below the rows sit the open actions: "Hold this station" and, when the viewer has a live hold, that hold's panel with its countdown, payment choice and confirm and release buttons.
- **Bookings** (`/bookings`): a search field, an export button, and a table of bookings with ref, station, date, local times, status, payment, amount and row actions. Operators also see a tenant column.
- **Documents** (`/documents`): an upload form for owners (operators get a tenant picker) and a table of documents with type, name on card, expiry date, status and file link. Operators get approve and reject on rows awaiting review. Above the table, the business's status appears as a mono badge with its word.
- **Billing** (`/billing`): an hour-pack panel with the balance, buy buttons and the hour ledger table; an invoices table with PDF links and pay buttons; and, for the operator, a tenant picker, a month field and "Issue invoice".
- **Tenants** (`/tenants`, operator): the tenants table with each tenant's status and required-document validity, lifecycle actions, inspection-link actions, and the storage shelves table.
- **Settings** (`/settings`, operator): the cancellation policy form and the policy history table.
- **Inspector page** (`/inspect/<token>`, public, no top bar navigation): the business name, the kitchen name, the list of current documents with open links, and the link's expiry. A dead link shows only the no-longer-valid heading.

Viewports:

- **1280x800:** the spec-sheet grid as described. The dial is in the left two-thirds and the rail in the right third, both visible without scrolling. Tables span the content width.
- **768x1024:** the dial spans the whole width at the top, with the day bar above it, and the rail stacks below it as a list spanning the whole width. The navigation stays in the top bar.
- **375x812:** the dial is as wide as the screen (the ring fits inside the viewport width with its handle reachable), the rail stacks below it, and navigation collapses behind a "Menu" button. Tables become one stacked card per row with label–value pairs and the row actions.

No screen scrolls horizontally at any of the three viewports.

### Public screens and controls (DP-11, DP-12, DP-17, DP-54, DP-60)

Only the controls and regions below are public; tests and judges rely on these roles, names and copy. Placeholders in angle brackets are defined in Feedback states.

| Screen | Role and accessible name | Visible copy and notes |
|---|---|---|
| Sign in | `textbox "Email"` | Label "Email" |
| Sign in | password field labelled "Password" | Label "Password" |
| Sign in | `button "Sign in"` | "Sign in" |
| All signed-in | `navigation "Main"` | Links "Dial", "Bookings", "Documents", "Billing", "Tenants", "Settings" by role |
| All signed-in | `button "Menu"` | Shown only at 375 wide; opens the navigation |
| All signed-in | `button "Sign out"` | "Sign out" |
| All signed-in | text "Kitchen time HH:MM" | Updates on each kitchen minute boundary |
| All screens | `status "Activity"` | Polite live region for pending and success copy |
| All screens | `alert "Problem"` | Assertive live region for error and outage copy |
| Dial | `button "Previous day"`, `button "Next day"`, `button "Now"` | "Now" jumps to kitchen today and the current step |
| Dial | date field labelled "Day" | Kitchen date being shown |
| Dial | `slider "Service dial"` | `aria-valuemin` 0, `aria-valuemax` 1440, `aria-valuenow` the minute of day, `aria-valuetext` "HH:MM, N of M open" |
| Dial | centre readout | "HH:MM" above "N of M open" in mono numerals |
| Dial | `group "Floor plan"` | Contains the station buttons |
| Dial | `button "<station>, <state>"` per station, with `aria-pressed` | `<state>` is "free", "booked", "held" or "cleaning". The operator and the owning tenant get "booked by <business>" and "held by <business>". The tile shows the label "Free", "Booked", "Held m:ss" (own holds; others see "Booked") or "Cleaning" |
| Dial | `region "Selected instant"` | Mono-numbered station rows |
| Dial | `button "Hold this station"` | Enabled only when the selected station is free at the dial instant |
| Dial | `listbox "Time"` | Only under reduced motion; options "00:00" to "24:00" in 15-minute steps |
| Dial | `dialog "Place hold"` | Holds `combobox "Start"`, `combobox "End"`, `combobox "Repeat weekly"` (options "Just this day", "2 weeks" … "12 weeks"), `textbox "Notes"`, operator-only `combobox "Tenant"`, `button "Place hold"`, `button "Cancel"` |
| Dial | `region "Hold <ref>"` | `timer "Hold time left"` showing "Expires in m:ss"; `radiogroup "Pay with"` with `radio "Account"` and `radio "Hour pack"`; the policy line "Cancellation: free until <free hours> hours before start, then <late percent>% charge (policy v<n>)"; `button "Confirm booking"`; `button "Release hold"` |
| Bookings | `searchbox "Search bookings"` | Placeholder "Ref or notes" (the operator's reads "Ref, notes or business") |
| Bookings | `button "Export CSV"` | "Export CSV" |
| Bookings | `table "Bookings"` | Status words "Held", "Confirmed", "Checked in", "Completed", "Cancelled", "No-show" |
| Bookings | `button "Check in <ref>"`, `button "Check out <ref>"`, `button "Cancel <ref>"` | Shown only when the edge is legal for the viewer |
| Bookings | operator `button "Mark no-show <ref>"`, `button "Refund fee <ref>"` | Operator only |
| Bookings | `dialog "Cancel booking <ref>"` | States the fee or hours that will be kept under the booking's policy version; `button "Cancel booking"`, `button "Keep booking"` |
| Bookings | `dialog "Check out <ref>"` | `spinbutton "Minutes past booked end"` (default 0); `button "Check out"` |
| Documents | `form "Upload document"` | `combobox "Document type"` with options "Certificate of insurance", "Food handler card", "Health permit"; date field labelled "Expiry date"; `textbox "Name on card"`; file field labelled "Document file" with helper text "PDF, JPEG or PNG, up to <cap>" (`<cap>` is the size cap from Business rules, written as it is there); `button "Upload document"` |
| Documents | `table "Documents"` | Status words "Awaiting review", "Approved", "Rejected", "Expired"; link "Open <kind>" per row |
| Documents | operator `button "Approve <kind> for <business>, expires <YYYY-MM-DD>"` and `button "Reject <kind> for <business>, expires <YYYY-MM-DD>"` | On rows awaiting review |
| Documents | `dialog "Reject document"` | `textbox "Reason"`, `button "Send rejection"` |
| Billing | `region "Hour pack"` | Text "Balance <h:mm>"; `button "Buy <pack name>"` per pack |
| Billing | `table "Hour ledger"` | Columns When, Movement, Booking, Minutes |
| Billing | `table "Invoices"` | Status words "Issued", "Paid"; `link "Download PDF <number>"`; owner `button "Pay invoice <number>"` |
| Billing | operator `combobox "Tenant"`, month field labelled "Invoice month", `button "Issue invoice"` | Operator only |
| Tenants | `table "Tenants"` | Status words "Applied", "Documents review", "Active", "Suspended", "Offboarded" |
| Tenants | `button "Activate <business>"`, `button "Offboard <business>"`, `button "Inspection link for <business>"` | Lifecycle buttons shown only when the edge is legal |
| Tenants | `dialog "Offboard <business>"` | `button "Offboard"`, `button "Keep tenant"` |
| Tenants | `dialog "Inspection link for <business>"` | `combobox "Link lasts"` with options "1 hour", "24 hours", "7 days"; `button "Issue link"`; read-only `textbox "Link"`; `button "Copy link"`; `button "Revoke link"` |
| Tenants | `table "Storage shelves"` | `combobox "Tenant for <shelf name>"` per shelf, with option "Unassigned" plus active tenants |
| Settings | `form "Cancellation policy"` | `spinbutton "Free cancellation window (hours)"`, `spinbutton "Late cancellation charge (%)"`, `button "Save policy"` |
| Settings | `table "Policy history"` | Columns Version, Free window, Late charge, Effective |
| Inspector | `heading "<business>"` level 1 | Text "Current documents at <kitchen name>" |
| Inspector | `list "Current documents"` | `link "Open <kind>"`; food handler cards read "Open Food handler card, <holder>"; text "This link expires <YYYY-MM-DD HH:MM> kitchen time." |
| Inspector | `heading "This inspection link is no longer valid"` level 1 | Shown alone for expired, revoked, replaced and unknown links |

### Interactions (DP-11, DP-17, DP-54, DP-55)

**Dial geometry.** The ring maps the kitchen day clockwise from the top. 00:00 sits at twelve o'clock and every minute is a quarter of a degree, so 06:00 points right, 12:00 points down and 18:00 points left. The dial's value is always a whole 15-minute step from 0 to 1440. At 1440 the readout shows "24:00" and the tiles show each station's state in the last minute of the day.

**Opening the dial.** The dial opens on kitchen today at the current kitchen minute rounded down to its 15-minute step. The kitchen clock, the step and the date always come from the kitchen's time zone; a browser in another zone sees the same values.

**Turning the dial.**
- Mouse or touch: press and drag the handle. It follows the pointer around the ring and lands on the nearest step.
- Wheel: with the pointer over the dial, each wheel event moves one step (scrolling down or away moves later). The page does not scroll while the pointer is over the dial.
- Keyboard, with the slider focused: Right and Up move one step later; Left and Down move one step earlier; Page Up and Page Down move one hour; Home goes to 00:00 and End to 24:00. The value stops at both ends and does not wrap.
- Every step runs the three-part update described in Motion and effects, and updates `aria-valuenow` and `aria-valuetext`. The readout's "N of M open" counts the stations that are free at that minute; M is the number of bookable stations.

**Selecting a station.** Click, tap, or Enter or Space on a station button selects it (`aria-pressed` true; one at a time) and highlights its row in the rail. A selected booked or held station shows the detail the viewer may see in the rail: the operator sees the business, contact email and notes; the owning tenant sees ref, times and notes; other tenants see only "Booked" and the end time.

**Drawing a hold.** With a free station selected and reduced motion not requested, pressing on the ring track (anywhere except the handle) and dragging draws an arc from the press point in the drag direction. The arc snaps to 15-minute steps and is limited to the length range in Business rules; it will not grow past the maximum and shows as too short below the minimum. Releasing sends the hold request. While the request is pending, the arc shows a dashed edge. When the server places the hold, the arc becomes the held pattern and the hold panel opens in the rail. When the server refuses it, the arc retracts to nothing and the refusal copy appears.

**Placing a hold by form.** "Hold this station" opens the "Place hold" dialog. Start defaults to the dial time and End to one hour later. Submitting with "Place hold" sends the same request as the arc.

**Confirming.** In the hold panel the user picks "Account" or "Hour pack" (Account is the default) and presses "Confirm booking". The button is disabled while the request is pending. The browser makes one `Idempotency-Key` for each confirm attempt on a hold and reuses it if the same attempt is retried, so a double tap or a flaky network sends the same key. "Release hold" deletes the hold.

**Countdown and freshness.** The hold timer counts down every second from the server's `expires_at`, corrected by the difference between the server's response time and the browser clock. At zero the panel closes and the dial refetches. The dial refetches its day after every hold, confirm, release, cancel, check-in or check-out, when the day changes, and every 30 seconds while the screen is open.

**Keyboard order on the Dial.** Tab moves through: main navigation, then the day bar (Previous day, Day, Next day, Now), then the Service dial slider, then the station buttons in the order Hot Line 1, Hot Line 2, Bake Deck, Cold-Prep Bench A, Cold-Prep Bench B, then "Hold this station", then (under reduced motion) the Time listbox, then the hold panel's radios, "Confirm booking" and "Release hold". A cook can turn the dial, select a free station, open "Place hold", submit, and confirm without a pointer. Every focusable control shows a visible focus ring.

**Dialogs.** Every dialog moves focus to its first field (or its first button when it has no field) when it opens, keeps Tab and Shift+Tab inside, closes on Escape or on its Cancel or Keep button, and returns focus to the control that opened it.

**Reduced motion.** When the operating system asks for reduced motion, pressing the ring track does not draw an arc; it only moves the dial. The rail shows the Time listbox: Up and Down move the selection, and choosing an option sets the dial. The "Place hold" dialog's Start and End selects are the way to place a hold.

**Tables and tables-as-cards.** Row action buttons are reachable in reading order. Search filters as the user types, with the request sent a quarter of a second after the last keystroke. "Export CSV" requests the export with the current search text as `q` and the default date range, so the file holds every booking that search text matches, including any beyond the rows the table shows.

### Visual design (DP-12, DP-57)

- **Mood:** clinical and legible, like a stainless equipment spec sheet. Surfaces are flat with no shadows or gradients. Panels and rows are divided by hairline rules one device pixel thick.
- **Colour roles:**
  - Ground: a pale, cool, stainless grey that fills the page.
  - Ink: a near-black with a faint blue-green cast, used for text, booked fills and primary buttons.
  - Rule: a mid grey used for hairlines and the ring's hour ticks.
  - Accent: one signal orange, kept for "now" (the spoke and the handle) and for conflicts (the conflict marker beside alert copy and the edge of a refused arc). It is never used for body-size text.
  - Held: a deep teal, used for held patterns and the hold countdown.
- **Station states never rely on colour alone.** Free is an open tile with sparse fine hatching and the label "Free". Booked is a solid ink fill with a light label "Booked". Held is a teal dotted fill with "Held" and the countdown. Cleaning is diagonal stripes with "Cleaning". The four patterns stay distinct in greyscale.
- **Contrast:** text meets WCAG 2.2 AA (at least 4.5 to 1, or 3 to 1 for large text). Patterns, the ring, the handle, the focus ring and control edges reach at least 3 to 1 against what is next to them.
- **Type:** Bricolage Grotesque for display (screen titles, the centre readout's labels and section headings), set tight and confident. Public Sans for body and controls. Every number (times, amounts, counts, refs, row numbers) is set in a monospaced face with tabular figures, so columns of digits line up. Each heading level is a quarter larger than the one below, so the screen title is about twice the body size.
- **Density:** compact. Table rows and rail rows are short and tightly packed, but every interactive target is at least 44 by 44 CSS pixels, including the dial handle and station tiles.
- **Icons:** Lucide line icons only. All imagery, including the floor plan, is drawn procedurally as SVG.

### Motion and effects (DP-58, DP-59)

Motion has one character throughout: a fast start and a long, soft settle, with nothing bouncing or overshooting.

- **Dial step.** On each 15-minute step, three things start in a fixed order: the handle at once, the tile cross-fade about a twentieth of a second later, and the readout roll about a tenth of a second after the input. The whole step has settled within about half a second; Browser support and performance states which parts of it must be in place by when.
  1. The handle and the orange spoke rotate from the old angle to the new one, by the shorter way round the ring, over about a fifth of a second.
  2. Each station tile whose state changes cross-fades from its old pattern and label to the new one over about a third of a second. Unchanged tiles do not move.
  3. The readout's mono numerals roll, with the old digits sliding up and out and the new ones sliding in, for the time and the "N of M open" count, over about a fifth of a second.
  
  Scrubbing back plays the same steps in reverse direction, one per step. A new step that arrives mid-motion picks up from the current position and does not queue behind it.
- **Arc.** While dragging, the arc grows step by step with the pointer and no lag. A refused arc retracts back to its press point over about a fifth of a second. An arc that becomes a confirmed booking changes from the dotted held pattern to a solid fill over about a third of a second.
- **Dialogs** fade in and rise slightly over about a fifth of a second, and leave faster.
- **Press feedback:** buttons darken immediately, within a tenth of a second, on press.
- **Pending indicator:** a thin hairline sweeps along the top of the rail while any request is pending, and stops the moment it finishes. This is the only repeating motion. There are no other loops, idle animations or decorative movement.
- **Reduced motion.** When reduced motion is requested:
  - The handle and spoke jump to the new angle.
  - Tiles switch state at once.
  - Readout numerals change in place.
  - Dialogs appear and disappear at once.
  - The arc drag is replaced by the Time listbox and the Start and End selects (see Interactions).
  - The pending sweep becomes the static text "Working…".
  - The slider keeps its role, value and value text, and the floor plan keeps its patterns and labels.

### Feedback states (DP-60)

These rules cover every request the browser makes. Each action and read in the table below shows its pending copy in `status "Activity"` when it starts, then either its success copy in `status "Activity"` or its error copy in `alert "Problem"`. Background refreshes (the dial's 30-second refetch and the refetch that follows another action) show no pending or success copy; they show only error copy. A field error is also shown under its field and linked to it as the field's description. Outage copy stays in `alert "Problem"` until the next successful action that needs the same service. A row's own error copy wins; any error a row does not name uses the fallback table that follows it.

Placeholders:
- `<ref>` is the hold or booking ref.
- `<station>` is the station name.
- `<HH:MM:SS>` and `<HH:MM>` are kitchen local times; `<YYYY-MM-DD>` is a kitchen date.
- `<owner email>` is the tenant owner's email.
- `<amount>` is dollars with two decimals and a leading "$".
- `<h:mm>` is minutes written as hours:minutes.
- `<billed minutes>` is the stored billed hold-over in whole minutes.
- `<kind>` is the document kind label.
- `<business>` is the tenant's business name.
- `<holder>` is a food handler card's name on card.
- `<kitchen name>` is the kitchen's name.
- `<file name>` is the name of the file being uploaded.
- `<number>` is the invoice number.
- `<period>` is "YYYY-MM".
- `<n>` is the policy version; `<free hours>` and `<late percent>` are that version's free window in hours and late charge in percent.
- `<pack name>` is the pack's name.
- `<shelf>` is the shelf name.

| Action | Pending | Success | Errors (alert "Problem") |
|---|---|---|---|
| Sign in | "Signing in…" | navigates to Dial | 401: "That email and password don't match an account."; offboarded: "This business has been offboarded. Contact the kitchen." |
| Load the day (first load and each day change) | "Loading the day…" | none | "Couldn't load the day. Retrying in 30 seconds." (also used when a background refresh of the day fails) |
| Load a list screen (Bookings, Documents, Billing, Tenants, Settings) | "Loading…" | none | fallback only |
| Search bookings | "Searching…" | none | fallback only |
| Place hold | "Placing hold…" | "Hold <ref> placed. It expires at <HH:MM:SS>." | slot conflict: "<station> isn't free for that whole time, including cleaning. Pick another gap."; tenant not active: "Your business can't book right now. Check Documents."; document expiry: "A required document expires before this booking. Upload a renewal first."; validation: "Check the start and end times." |
| Confirm booking | "Confirming…" | "Booked. Confirmation for <ref> was emailed to <owner email>." | hold expired: "This hold expired. Place it again if the time is still free."; already confirmed: "This hold is already confirmed."; tenant not active and document expiry: the copy from Place hold; too few hours: "Your hour pack has <h:mm> left; this booking needs <h:mm>."; billing outage: "Billing is unreachable. Nothing was booked or charged, and your hold is kept until it expires."; email outage: "Email is unreachable. Nothing was booked or charged, and your hold is kept until it expires." |
| Release hold | "Releasing hold…" | "Hold <ref> released." | not found: "That hold is no longer live." |
| Cancel booking | "Cancelling…" | "Booking <ref> cancelled. " followed by one of "No charge.", "Late cancellation charge: <amount>." or "<h:mm> kept from your hour pack." | already started: "This booking has started and can't be cancelled."; billing outage: "Billing is unreachable. Nothing was charged; try again in a moment." |
| Check in | "Checking in…" | "Checked in to <station> at <HH:MM>." | outside window: "Check-in isn't open for this booking yet, or it has ended."; tenant not active: "Check-in is blocked: a required document has expired." |
| Check out | "Checking out…" | "Checked out. Hold-over billed: <billed minutes> min (<amount>)." or "Checked out. No hold-over billed." | minutes out of range: "Enter whole minutes from 0 to 240." under the field; billing outage: the billing copy from Cancel booking; email outage: "Email is unreachable. Nothing was recorded; try again in a moment." |
| Mark no-show | "Saving…" | "Booking <ref> marked as a no-show." | not started: "This booking hasn't started yet." |
| Refund fee | "Refunding fee…" | "Late fee on <ref> refunded." | already refunded, not refundable or invoiced: "That fee is already refunded or invoiced."; billing outage: "Billing is unreachable. Nothing was refunded; try again in a moment." |
| Upload document | "Uploading <file name>…" | "<kind> uploaded. The kitchen will review it." | too large: "That file is larger than the upload limit."; wrong type: "Only PDF, JPEG or PNG files are accepted. This file is not one of them."; storage outage: "Document storage is unreachable. Nothing was uploaded; try again in a moment." |
| Open document file (owner, operator or inspector) | "Opening file…" | none (the file opens or downloads) | storage outage: "Document storage is unreachable. Try again in a moment." |
| Approve document | "Approving…" | "<kind> for <business> approved. The owner's email is queued." | storage outage: "Document storage is unreachable, so the file can't be checked. Nothing was approved."; file missing: "The stored file can't be read. Ask the tenant to upload it again." |
| Reject document | "Sending rejection…" | "<kind> for <business> rejected. The owner's email is queued." | reason missing or too long: "Give a reason for the tenant." |
| Buy hour pack | "Buying <pack name>…" | "<pack name> added. Balance: <h:mm>." | billing outage: "Billing is unreachable. Nothing was charged and your balance is unchanged." |
| Save policy | "Saving policy…" | "Policy version <n> applies to bookings confirmed from now on. Existing bookings keep their terms." | stale: "The policy changed since you opened it. Reload to see version <n>." |
| Issue inspection link | "Issuing link…" | "Link issued. It expires <YYYY-MM-DD HH:MM> kitchen time. Any earlier link for this tenant no longer works." | fallback only |
| Revoke inspection link | "Revoking…" | "Link revoked." | no live link: "There is no live link to revoke." |
| Open inspector page | "Loading documents…" | none | dead link: shows the no-longer-valid heading instead of any alert; otherwise fallback only |
| Activate tenant | "Activating…" | "<business> is active." | documents incomplete: "<business> is missing an approved, valid " followed by the missing kinds joined with " and ", then "." |
| Offboard tenant | "Offboarding…" | "<business> is offboarded." | open bookings: "<business> still has open bookings. Cancel or complete them first." |
| Assign shelf | "Saving shelf…" | "<shelf> assigned to <business>." or "<shelf> is unassigned." | tenant not active: "Only active tenants can rent a shelf." |
| Issue invoice | "Issuing invoice…" | "Invoice <number> issued. Its email notice is queued for <business>." | nothing to invoice: "Nothing to invoice for <period>."; billing outage: the billing copy from Cancel booking; storage outage: "Document storage is unreachable. No invoice was issued; try again in a moment." |
| Download invoice PDF | "Preparing PDF…" | none (the PDF downloads) | storage outage: the storage copy from Open document file |
| Pay invoice | "Paying…" | "Invoice <number> paid. A receipt is queued for <owner email>." | already paid: "This invoice is already paid."; billing outage: the billing copy from Cancel booking |
| Export CSV | "Preparing export…" | "Export downloaded." | fallback only |

Fallback copy, by response, for any error the row above does not name:

| Response | Copy (alert "Problem") |
|---|---|
| 401 on any action except Sign in | Navigates to Sign in and shows "Your session ended. Sign in again." |
| 403 (any code) | "You can't do that with this account." |
| 404 (any code) | "That record isn't available." |
| 409 `idempotency_conflict` | "This request was already sent with different details. Reload and try again." |
| Any other 409, 410 or 412 | "That can't be done in this record's current state. Reload to see the latest." |
| 413 (any code) | "That request is too large." |
| 415 (any code) | "That kind of content isn't accepted." |
| 422 `validation_failed` | "Check the highlighted fields.", with each `details` sentence shown under its field |
| 503 `billing_unavailable` | "Billing is unreachable. Nothing was changed; try again in a moment." |
| 503 `storage_unavailable` | "Document storage is unreachable. Nothing was changed; try again in a moment." |
| 503 `mail_unavailable` | "Email is unreachable. Nothing was changed; try again in a moment." |
| No response, or any other status | "Something went wrong. Try again in a moment." |

## Backend

### API (DP-02, DP-03, DP-08, DP-09, DP-13, DP-18, DP-19, DP-25, DP-26, DP-29, DP-30, DP-31, DP-32, DP-34, DP-36, DP-38, DP-41, DP-43, DP-44, DP-45, DP-46, DP-47, DP-49, DP-51, DP-52, DP-53)

**Conventions.**
- Request and response bodies are `application/json; charset=utf-8` unless a row says otherwise.
- Money is integer cents in fields ending `_cents`. Durations are integer minutes.
- Instants are ISO 8601 with seconds and the kitchen's offset at that instant, for example `2026-11-03T05:00:00-06:00`.
- Kitchen dates are `YYYY-MM-DD`, local times are `HH:MM`, and minutes of the day count from kitchen midnight on the wall clock.
- IDs are UUIDs unless the seed data gives a readable ID.
- Signed-in requests carry the session cookie set by `POST /api/session`.

**Error body.** Every error is `{"error":{"code":"<code>","message":"<sentence>","details":{}}}`. `details` is always an object. For `422 validation_failed` it maps each failing field to a sentence, for example `{"error":{"code":"validation_failed","message":"Check the highlighted fields.","details":{"end_local":"End must be after start."}}}`.

**Precedence.** The server checks in this order and answers with the first failure:
1. The cross-origin check in Server boundary.
2. `401 unauthenticated` for any non-public route without a live session.
3. A request carrying an `Idempotency-Key` that this user already used on this method and path gets its stored response, or `409 idempotency_conflict` when the body differs.
4. `404 not_found` for an unknown ID, or for an ID (nested IDs included) that belongs to another tenant when the caller is a tenant user. The body is identical in both cases.
5. `403 forbidden` when the caller's role may not use the route.
6. `400 idempotency_key_required`, `413` and `415` from Server boundary.
7. `422 validation_failed`.
8. State conflicts: `409`, `410` and `412` with the codes in Business rules.
9. `503` provider outages from Services.

Endpoint rows below list only success responses, the roles allowed and any extra notes. Rule rejections are listed once, in Business rules.

**Roles.** O = operator, W = tenant owner, C = tenant staff cook, P = public (no session). Tenant users act only on their own tenant; any other tenant's ID is the step 4 not-found response.

**Published fields.** A response contains exactly these keys for the caller's role, no more.
- User: `id`, `name`, `email`, `role` (`operator` | `owner` | `cook`), `tenant_id` (null for the operator).
- Tenant: `id`, `business_name`, `status` (`applied` | `documents_review` | `active` | `suspended` | `offboarded`), `owner_name`, `owner_email`, `required_documents` (an object with keys `certificate_of_insurance`, `health_permit` and `food_handler_card`, each `{"valid":bool,"expires_on":date|null}`), `shelves` (array of shelf IDs), `hour_balance_minutes`.
- Station: `id`, `name`, `kind` (`hot_line` | `bake_deck` | `cold_prep`), `hourly_rate_cents`.
- Dial block, operator: `kind` (`booking` | `hold`), `booking_id`, `ref`, `hold_ref`, `status`, `start_minute`, `end_minute`, `tenant_id`, `tenant_name`, `notes`, `contact_email`, `expires_at` (holds only, otherwise null).
- Dial block, the tenant's own: the operator's keys except `contact_email`.
- Dial block, another tenant's hold or booking seen by a tenant user: exactly `kind` (`booked`), `start_minute`, `end_minute`.
- Cleaning block, for everyone: `kind` (`cleaning`), `start_minute`, `end_minute`.
- Booking: `id`, `ref`, `hold_ref`, `tenant_id`, `station_id`, `date`, `start_local`, `end_local`, `start`, `end`, `elapsed_minutes`, `status` (`held` | `confirmed` | `checked_in` | `completed` | `cancelled` | `no_show`), `pay_with` (`account` | `hour_pack` | null while held), `amount_cents` (null unless `pay_with` is `account`), `policy` (`{"version","free_window_hours","late_fee_percent"}`, null while held), `notes`, `checked_in_at`, `checked_out_at`, `holdover` (`{"reported_minutes","billed_minutes","amount_cents"}` or null), `cancellation` (`{"cancelled_at","late","fee_cents","fee_minutes","fee_refunded"}` or null), `created_at`. The operator also gets `tenant_name`.
- Document: `id`, `tenant_id`, `kind` (`certificate_of_insurance` | `food_handler_card` | `health_permit`), `holder_name`, `expires_on`, `status` (`pending_review` | `approved` | `rejected`), `valid`, `file_name`, `content_type`, `size_bytes`, `uploaded_at`, `reviewed_at`, `rejection_reason`.
- Invoice: `id`, `number`, `tenant_id`, `period`, `status` (`issued` | `paid`), `lines` (each `{"kind","description","booking_ref","amount_cents"}`), `subtotal_cents`, `tax_rate_percent` (string, for example `"8.25"`), `tax_cents`, `total_cents`, `issued_at`, `paid_at`.

**Session**
- `POST /api/session` (P) `{"email","password"}` → `200 {"user":User}` and sets an HttpOnly, SameSite=Lax session cookie. A wrong email or password → `401 invalid_credentials`. An offboarded tenant's user → `403 tenant_offboarded`.
- `GET /api/session` (O, W, C) → `200 {"user":User}`.
- `DELETE /api/session` (O, W, C) → `204`.

**Health**
- `GET /api/health` (P) → `200 {"status":"ok"}`, whatever state the providers are in.

**Dial**
- `GET /api/dial?date=YYYY-MM-DD` (O, W, C). `date` defaults to kitchen today and must lie between today minus 30 days and today plus 365 days, inclusive. → `200 {"date","today","now_minute","time_zone":"America/Chicago","skipped":[start,end]|null,"repeated":[start,end]|null,"stations":[Station plus "blocks":[Block…]]}`.
  - `now_minute` is the current kitchen minute of the day when `date` is today, otherwise null.
  - `skipped` and `repeated` give the wall-clock minute range of a DST change on that date.
  - Blocks are sorted by `start_minute`, with `start_minute` inclusive and `end_minute` exclusive, both within 0..1440.
  - Live holds, plus bookings that are confirmed, checked in or completed, appear as blocks. Cancelled and no-show bookings do not.

**Holds**
- `POST /api/holds` (O, W, C) `{"station_id","date","start_local","end_local","weeks":1,"notes":"","tenant_id"}` → `201 {"ref","tenant_id","station_id","weeks","expires_at","bookings":[Booking…]}`, with one booking per occurrence in status `held`. `tenant_id` is required for the operator and must be omitted by tenant users. `weeks` defaults to 1. `notes` is at most 500 characters.
- `GET /api/holds/{ref}` (O, W, C) → `200` with the same body while the hold is live.
- `DELETE /api/holds/{ref}` (O, W, C) → `204`. The held bookings are removed.
- `POST /api/holds/{ref}/confirm` (O, W, C). Requires the `Idempotency-Key` header. Body `{"pay_with":"account"|"hour_pack"}` → `200 {"ref","bookings":[Booking…]}` with every booking `confirmed`.

**Bookings**
- `GET /api/bookings?q=&from=&to=&status=&station_id=` (O, W, C) → `200 {"bookings":[Booking…]}`, sorted by start, at most 200 (the first 200 in that order).
  - `from` and `to` are inclusive kitchen dates and default to today minus 30 days and today plus 365 days.
  - `q` is matched case-insensitively against ref and notes, and for the operator also against business name.
  - `status` is one booking status other than `held`; `station_id` is one station ID. Each is optional and narrows the rows when present.
  - Held bookings are excluded.
- `GET /api/bookings/export?q=&from=&to=&status=&station_id=` (O, W, C) → `200 text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="bookings-<from>-to-<to>.csv"`, where `<from>` and `<to>` are the dates actually applied after defaults.
  - It takes exactly the parameters of search, with the same defaults, validation, matching and tenant scope, and holds one row per matching booking, sorted by start. It has no row cap: every matching booking is included, even beyond 200.
  - Tenant user header row: `ref,station,date,start,end,status,payment,amount,notes`.
  - Operator header row: `tenant,ref,station,date,start,end,status,payment,amount,notes,contact_email`.
  - `amount` is dollars with two decimals, or empty for hour-pack bookings.
- `GET /api/bookings/{id}` (O, W, C) → `200 Booking`.
- `POST /api/bookings/{id}/check-in` (O, W, C) `{}` → `200 Booking`.
- `POST /api/bookings/{id}/check-out` (O, W, C) `{"holdover_minutes":integer 0..240}` → `200 Booking`.
- `POST /api/bookings/{id}/cancel` (O, W) `{}` → `200 Booking`.
- `POST /api/bookings/{id}/no-show` (O) `{}` → `200 Booking`.
- `POST /api/bookings/{id}/refund-fee` (O) `{}` → `200 Booking`.

**Cancellation policy**
- `GET /api/cancellation-policy` (O, W, C) → `200 {"current":Policy,"history":[Policy…]}`, newest first. A Policy is `{"version","free_window_hours","late_fee_percent","effective_at"}`.
- `PUT /api/cancellation-policy` (O) `{"free_window_hours":integer 0..168,"late_fee_percent":integer 0..100,"based_on_version":integer}` → `201 Policy`.

**Hour packs**
- `GET /api/hour-packs` (O, W) → `200 {"packs":[{"id","name","minutes","price_cents"}]}`.
- `POST /api/hour-packs/purchase` (W). Requires the `Idempotency-Key` header. Body `{"pack_id"}` → `201 {"purchase_id","pack_id","minutes","price_cents","balance_minutes"}`.
- `GET /api/hour-ledger?tenant_id=` (O with `tenant_id` required; W) → `200 {"tenant_id","balance_minutes","entries":[{"id","movement_id","account":"tenant_pack"|"kitchen_hours","minutes","reason","booking_id","created_at"}]}`, oldest first.

**Documents**
- `POST /api/documents` (W; O with a `tenant_id` field) as `multipart/form-data` with fields `kind`, `expires_on`, `holder_name` (required and at most 120 characters for `food_handler_card`, otherwise ignored) and `file` → `201 Document` with status `pending_review`.
- `GET /api/documents?tenant_id=` (O, optional filter; W) → `200 {"documents":[Document…]}`, newest first.
- `GET /api/documents/{id}` (O, W) → `200 Document`.
- `GET /api/documents/{id}/file` (O, W) → `200` with the stored bytes, the detected content type and `Content-Disposition: attachment; filename="<file_name>"`.
- `POST /api/documents/{id}/approve` (O) `{}` → `200 Document`.
- `POST /api/documents/{id}/reject` (O) `{"reason":"1..500 characters"}` → `200 Document`.

**Tenants and inspection links**
- `GET /api/tenants` (O for all; W and C get a list holding only their own tenant) → `200 {"tenants":[Tenant…]}`.
- `GET /api/tenants/{id}` (O, W, C) → `200 Tenant`.
- `POST /api/tenants/{id}/activate` (O) `{}` → `200 Tenant`.
- `POST /api/tenants/{id}/offboard` (O) `{}` → `200 Tenant`.
- `POST /api/tenants/{id}/inspection-link` (O) `{"expires_in_seconds":integer}` → `201 {"url":"/inspect/<token>","expires_at"}`. The token is at least 32 random URL-safe characters.
- `GET /api/tenants/{id}/inspection-link` (O) → `200 {"url","expires_at"}`, or `404 not_found` when no link is live.
- `DELETE /api/tenants/{id}/inspection-link` (O) → `204`, or `404 not_found` when no link is live.
- `GET /api/inspect/{token}` (P) → `200 {"kitchen_name","business_name","expires_at","documents":[{"id","kind","holder_name","expires_on","file_url"}]}`.
- `GET /api/inspect/{token}/documents/{id}/file` (P) → `200` with the bytes shown inline. Only documents listed by that link are reachable; any other ID → `404 not_found`.

**Shelves**
- `GET /api/shelves` (O for all; W for its own) → `200 {"shelves":[{"id","name","monthly_rate_cents","tenant_id","tenant_name"}]}`.
- `PUT /api/shelves/{id}` (O) `{"tenant_id":string|null}` → `200` Shelf.

**Invoices**
- `POST /api/invoices` (O) `{"tenant_id","period":"YYYY-MM"}` → `201 Invoice`.
- `GET /api/invoices?tenant_id=` (O, optional filter; W) → `200 {"invoices":[Invoice…]}`, newest first.
- `GET /api/invoices/{id}` (O, W) → `200 Invoice`.
- `GET /api/invoices/{id}/pdf` (O, W) → `200 application/pdf`.
- `POST /api/invoices/{id}/pay` (W). Requires the `Idempotency-Key` header. Body `{}` → `200 Invoice` with status `paid`.

Unknown `/api/` paths → `404 not_found`. A known path with a method not listed → `405 method_not_allowed`, except on inspection links, where Business rules governs.

### Business rules (DP-10, DP-13, DP-14, DP-15, DP-16, DP-18, DP-19, DP-20, DP-23, DP-24, DP-25, DP-26, DP-27, DP-29, DP-30, DP-32, DP-33, DP-35, DP-36, DP-38, DP-39, DP-40, DP-41, DP-43, DP-44, DP-45, DP-46, DP-47, DP-48, DP-49, DP-51, DP-52, DP-53)

**Kitchen time.**
- The kitchen's time zone is America/Chicago. It governs: kitchen today, the dial's minutes, the current 15-minute step, check-in windows, cancellation cutoffs, document validity, reminder dates and invoice periods. The browser's zone and the server's own zone never change any of these.
- A kitchen month runs from 00:00 on its first local day to 00:00 on the first local day of the next month.

**Hold placement.**
- `start_local` and `end_local` fall on :00, :15, :30 or :45. `end_local` may be `24:00`, and it must be after the start on the same date.
- The wall-clock length is from 60 to 480 minutes, both ends allowed.
- `date` is at most 365 days after kitchen today.
- The first occurrence may not start before the start of the current 15-minute step of kitchen today. For example, at 14:07 the earliest start is 14:00.
- `weeks` is from 1 to 12, both ends allowed.
- Breaking any of these → `422 validation_failed`.
- Then, in this order:
  - The tenant's status must be `active` → otherwise `409 tenant_not_active`.
  - Every occurrence must end no later than the document validity edge (below) → otherwise `409 document_expires_before_booking` with `details {"kinds":[…],"dates":[…]}`.
  - Every occurrence must be free → otherwise `409 slot_taken` with `details {"dates":[…]}`, listing each conflicting occurrence date.
- An occurrence is free when it overlaps no live hold and no confirmed, checked-in or completed booking on the same station, and when there are at least 30 minutes between it and every block of a different tenant on that station, on both sides.
- Blocks of the same tenant may touch (back to back) with no gap.
- On the dial, a cleaning block covers the 30 minutes after the end of each run of one tenant's touching blocks, cut off at 24:00.
- Hold refs are `SK-<n>`, with `n` counting up from the last seeded ref. Each occurrence's booking ref is `<hold ref>-<occurrence number from 1>`.

**Simultaneous claims.** Hold placement on a station is decided one claim at a time. When several requests for overlapping times on one station arrive together, exactly one gets `201` and every other gets `409 slot_taken`. Confirms that draw on one tenant's hour pack are decided one at a time too, so together they never spend more than the balance.

**Hold life.**
- A hold is live from creation until `expires_at`, which is creation plus `HOLD_TTL_SECONDS` (Configuration and secrets; ten minutes by default). The server's clock decides.
- A confirm received before `expires_at` may succeed. One received at or after `expires_at` → `410 hold_expired`.
- From `expires_at` on, the hold's bookings stop counting as taken, `GET /api/holds/{ref}` answers `404 not_found`, and the slot can be held again.
- Releasing a hold removes its bookings at once.
- Any user of the hold's tenant, or the operator, may confirm that tenant's live hold.
- A confirm with a new key on a hold that has already been confirmed → `409 invalid_transition`.

**Confirmation.**
- Checks run in this order:
  - `410 hold_expired`.
  - `409 tenant_not_active`.
  - `409 document_expires_before_booking` (checked again).
  - For `hour_pack`, `409 insufficient_hours` with `details {"needed_minutes","balance_minutes"}` when the total elapsed minutes of all occurrences exceed the balance.
- On success, every booking in the hold becomes `confirmed`. It records the cancellation policy version current at the moment of confirmation, the payment choice, and:
  - For `account`, an `amount_cents` of elapsed minutes × station hourly rate ÷ 60.
  - For `hour_pack`, one ledger movement per booking.
- The bookings, their Kill Bill charges (account payment only) and the confirmation email are one unit of work under Units of work below.

**Units of work.** Confirmation, check-out with billed hold-over, cancellation, fee refund and invoice issue each change records in more than one system. They follow these rules.
- **Supported failure model.** PostgreSQL stays reachable for the whole action. Kill Bill, MinIO or the SMTP server may be unreachable, refuse a call, or not answer. Failures outside this model (PostgreSQL lost mid-action, the server process stopping mid-action) are not covered by any promise below.
- **Order.** The server checks every rule first, then writes its records in one PostgreSQL transaction that is not yet committed, then makes the Kill Bill records, then stores any MinIO object, then hands any synchronous email (the booking confirmation and the hold-over notice) to SMTP as the last step, then commits. Queued emails (approval, rejection, reminder, invoice notice, receipt) are written into the email queue inside the same transaction, so they exist exactly when the action commits.
- **A provider fails.** The transaction rolls back, any MinIO object this action stored is deleted, and every Kill Bill record this action made is reversed: a charge by a credit of the same amount, and a credit by an external charge of the same amount, each described `Reversal: <original description>`. The response is the 503 for that provider from Services, and the records are as they were before the request (a hold stays live until its own expiry). A reversal Kill Bill does not accept at once is kept in PostgreSQL and retried every `REMINDER_SWEEP_SECONDS` until Kill Bill records it.
- **When an email counts as sent.** A synchronous email counts as sent only when the SMTP server accepts the message, that is, replies with a success code after the message data. If SMTP is unreachable, refuses, or gives no reply within 10 seconds at any stage, the email counts as not sent and the action fails as above with `503 mail_unavailable`. Once SMTP has accepted, the action commits.
- **Ambiguous delivery.** If the SMTP server received the whole message but its acceptance never reached the app, the action has still failed: the 503 response and the unchanged records are the truth, and the owner's inbox may hold one message for an action that did not happen. A retry that succeeds sends its own email, so the owner then has one email for the failed attempt and one for the success. This is the only case in which an email exists without its action.

**Repeat-safe requests.**
- Confirm, hour-pack purchase and invoice payment require an `Idempotency-Key` header of 1 to 100 visible ASCII characters. A missing or malformed key → `400 idempotency_key_required`.
- The key belongs to the signing-in user, the method and the path.
- The first response with status 200, 201, 409, 410 or 422 is stored for the life of the database.
- A later request with the same key and an equal JSON body returns that stored status and body, and changes nothing: no booking, charge, ledger entry or email.
- The same key with a different body → `409 idempotency_conflict`.
- 5xx responses are not stored, so a retry after an outage runs again.
- A second request with the same key that arrives while the first is still running waits for it and returns the same response.

**Weekly repeats and clock changes.**
- Occurrence k (from 0) falls on `date` + 7k days, at the same `start_local` and `end_local`. Its instants use that day's offset. For example, a Tuesday 05:00–09:00 series from 2026-10-27 starts at `2026-10-27T05:00:00-05:00` and then at `2026-11-03T05:00:00-06:00`.
- On the spring-forward day, local times from 02:00 up to but not including 03:00 do not exist. A hold whose start or end falls in that range → `422 validation_failed`, with the field named and the date given. A hold that spans the range is allowed.
- On the fall-back day, local times from 01:00 up to but not including 02:00 occur twice. A start or end in that range means its first (daylight-time) occurrence.
- Length limits and dial minutes use the wall clock. `elapsed_minutes`, money and hour-pack debits use real elapsed time. For example, 00:00–04:00 on 2026-11-01 has 300 elapsed minutes, and 01:00–04:00 on 2027-03-14 has 120.

**Booking states.** The legal edges are:
- held → confirmed (confirm).
- confirmed → checked_in (check-in).
- checked_in → completed (check-out).
- confirmed → cancelled (cancel).
- confirmed → no_show (operator).

Any other edge → `409 invalid_transition`. Further rules:
- Check-in is allowed from 15 minutes before start (inclusive) until the booking's end (exclusive). Outside that window → `409 outside_check_in_window`.
- Check-in also requires the tenant to be `active`, otherwise `409 tenant_not_active`.
- No-show requires the start to have passed, otherwise `409 not_started`.
- Cancel is allowed only before start. At or after start → `409 already_started`.
- A cook calling cancel gets the step 5 `403 forbidden`.

**Hold-over.**
- At check-out, the cook reports `holdover_minutes`, the minutes worked past the booked end (0 if they left on time or early).
- If the report is 10 minutes or less, billed hold-over is 0.
- Above 10 minutes, the billed minutes are the report rounded up to the next multiple of 15. For example: 10 → 0, 11 → 15, 15 → 15, 16 → 30, 22 → 30.
- Its amount is billed minutes × station hourly rate ÷ 60, charged to the account whatever the booking's payment choice.
- Hold-over is computed once at check-out, stored on the booking, and never recomputed.
- When billed minutes are above 0, the check-out, its Kill Bill charge and the hold-over notice email are one unit of work under Units of work. With 0 billed minutes, check-out makes no Kill Bill record and sends no email.

**Cancellation policy versions.**
- Saving the policy creates the next version, effective from the moment it is saved, for bookings confirmed from then on. Existing bookings keep the version they recorded, on every surface: API, Bookings, the cancel dialog, emails and invoices.
- A save whose `based_on_version` is not the current version → `412 stale_version` with `details {"current_version"}`.

**Cancellation charges.**
- A cancellation is free when it happens at or before start minus the booking's `free_window_hours` (that instant itself is free). Otherwise it is late.
- Account bookings:
  - Every cancellation credits the full `amount_cents`.
  - A late cancellation also charges a fee equal to `amount_cents` × the booking's `late_fee_percent` ÷ 100, rounded half up to a whole cent.
- Hour-pack bookings:
  - A free cancellation returns all debited minutes.
  - A late cancellation keeps fee minutes equal to the debited minutes × `late_fee_percent` ÷ 100, rounded half up to a whole minute, and returns the rest.
- Fee refund (operator): allowed once, on a late-cancelled booking whose fee is greater than 0 and not yet on an invoice. It credits the fee (account bookings) or returns the fee minutes (hour-pack bookings) and sets `fee_refunded` to true. Otherwise → `409 invalid_transition`, or `409 fee_invoiced` when the fee is already on an invoice.

**Hour ledger.**
- Every movement writes exactly two entries with the same `movement_id` and opposite `minutes`: one on `tenant_pack` for the tenant, one on `kitchen_hours`.
- Reasons, with the sign on `tenant_pack`:
  - `opening_balance` (+)
  - `pack_purchase` (+)
  - `booking` (− elapsed minutes)
  - `cancellation_return` (+)
  - `fee_refund` (+)
- Entries are never edited or deleted.
- `balance_minutes` always equals the sum of the tenant's `tenant_pack` entries, and it never goes below 0.
- A pack purchase writes its movement only after Kill Bill has recorded the payment.

**Compliance documents.**
- Upload rules:
  - `expires_on` must be kitchen today or later → otherwise `422`.
  - A file is accepted only when its first bytes are a PDF (`%PDF-`), a JPEG (`FF D8 FF`) or a PNG (the 8-byte PNG signature). The file name's extension and the declared part type are ignored. Anything else, including SVG, HTML and archives → `415 unsupported_file_type`.
  - The size cap is 5,000,000 bytes per file; exactly 5,000,000 is allowed. A larger file → `413 file_too_large`.
  - A missing or empty file → `422`.
- The stored `content_type` is the detected one.
- `file_name` is the client name's last segment after any `/` or `\`, with control characters removed, cut to 120 characters, or `document` if nothing is left. It is for display only and never forms a storage key.
- The record is written only after its file is stored.
- The tenant's first successful upload moves it from `applied` to `documents_review`.
- Approve and reject apply only to `pending_review` documents, otherwise `409 invalid_transition`.
- Approval first reads the stored file back in full and compares its size. If the file is unreadable or the sizes differ → `409 file_missing`.

**Validity edge.**
- An approved document is valid through the end of its `expires_on` day in kitchen time. It is invalid from 00:00 kitchen time on the next day.
- The required kinds are `certificate_of_insurance`, `health_permit` and `food_handler_card` (at least one valid card).
- For booking checks, each required kind's edge is 00:00 on the day after the latest `expires_on` among that tenant's approved documents of that kind. An occurrence that ends after any edge is blocked, so one ending at 24:00 on the expiry date is allowed.
- Validity, `valid` flags and tenant status are worked out at each request, so they change at the edge with no other action.

**Reminders.**
- An approved document gets one reminder when kitchen today is on or after `expires_on` minus 14 days and on or before `expires_on`, and no later-expiring approved document of the same kind exists (for food handler cards, the same kind and holder name).
- For example, a document approved with `expires_on` 14 days after today gets its reminder, and one 15 days out does not yet.
- The server checks at start and then every `REMINDER_SWEEP_SECONDS`. It sends each reminder exactly once.

**Tenant lifecycle.** The legal edges are:
- applied → documents_review (first upload).
- documents_review → active (operator activate). This requires every required kind to be valid, otherwise `409 documents_incomplete` with `details {"missing":[kinds]}`.
- active → suspended, automatically, whenever any required kind has no valid document.
- suspended → active, automatically, once approvals make every kind valid again.
- active or suspended → offboarded (operator). This is refused with `409 open_bookings` while any booking is held, confirmed or checked in.

Any other activate or offboard → `409 invalid_transition`. An offboarded tenant's users cannot sign in, and their existing sessions answer `401`.

**Inspection links.**
- `expires_in_seconds` is from 10 to 604,800, both ends allowed. `expires_at` is issue time plus that.
- A tenant has at most one live link. Issuing a new one ends the old one at once.
- A link works while the server's clock is before `expires_at`. From `expires_at` on, after revocation or after replacement, `GET /api/inspect/{token}` and its file route → `410 link_expired`, and the inspector page shows the no-longer-valid heading.
- An unknown token → `404 not_found`.
- Any method other than GET on an inspection route → `405 read_only` with `Allow: GET`, and nothing changes.
- The link lists only the tenant's approved, valid documents: the latest-expiring certificate of insurance, the latest-expiring health permit, and the latest-expiring valid card for each holder. It never includes contacts, bookings, invoices, pending, rejected or expired documents, or any other tenant.

**Shelves.**
- Only an `active` tenant may be assigned a shelf, otherwise `409 tenant_not_active`.
- Setting `tenant_id` to null frees the shelf.
- Each shelf assigned to a tenant when its invoice is issued is billed at its full monthly rate, once per tenant and period, on the first invoice issued for that period. There is no proration.

**Invoices.**
- `period` may not be later than the current kitchen month → `422`.
- An invoice collects the tenant's items not yet on any invoice:
  - Station time for account bookings in status completed or no_show whose date is in the period.
  - Hold-over amounts on bookings dated in the period.
  - Unrefunded late fees on account bookings cancelled in the period (by kitchen date of cancellation).
  - Storage shelves as above.
- Lines appear in that order. Line kinds are `station_time`, `holdover`, `late_fee` and `storage`.
- With no items → `409 nothing_to_invoice`. A tenant may have several invoices for one period.
- Line amounts are exact cents and are never rounded individually.
- `subtotal_cents` is the sum of the lines. `tax_cents` is `subtotal_cents` × the kitchen sales tax rate (Seed data), rounded half up to a whole cent, once, on the subtotal. `total_cents` is subtotal plus tax.
- For example: a 4-hour Hot Line 1 booking (12,800), 22 reported hold-over minutes on it (1,600) and one shelf (4,500) give a subtotal of 18,900, tax of 1,559 (from 1,559.25) and a total of 20,459.
- Numbers are `INV-<YYYYMM of period>-<4-digit sequence from 0001, per period across the kitchen>`.
- Issuing records the Kill Bill shelf and tax charges, stores the PDF, writes the invoice and queues its notice as one unit of work under Units of work. If any part fails, nothing remains: no stored PDF, no standing charge, no invoice and no queued notice.
- Paying an `issued` invoice records one Kill Bill payment for the total, then marks it `paid` and queues the receipt. An invoice that is already paid → `409 invoice_paid`.

### Services (DP-05, DP-07, DP-20, DP-21, DP-27, DP-31, DP-34, DP-38, DP-40, DP-48, DP-49)

**PostgreSQL** holds every record: users, sessions, tenants, stations, shelves, holds, bookings, policy versions, the hour ledger, document metadata, invoices, stored responses for repeated requests, the email queue, pending Kill Bill reversals and an audit trail of every state change. The server creates or updates its schema without error on every start, against an empty or an existing database.

**Kill Bill** has one account per tenant business. The account is created the first time that tenant needs billing, with external key equal to the tenant ID, name equal to the business name, currency USD and automatic payment off. Every record below is made exactly once, even when requests repeat. The only other records are the reversals described under Units of work in Business rules.

| Event | Kill Bill record on the tenant's account |
|---|---|
| Confirm, account payment | One external charge per booking, description `Station time <booking ref>`, amount `amount_cents` |
| Confirm, hour-pack payment | Nothing |
| Check-out with billed hold-over | External charge `Hold-over <booking ref>` |
| Cancel, account booking | Credit `Cancellation credit <booking ref>` for `amount_cents`; plus external charge `Late cancellation fee <booking ref>` when late and the fee is above 0 |
| Fee refund, account booking | Credit `Fee refund <booking ref>` |
| Hour-pack purchase | PURCHASE payment for the pack price, transaction external key `pack-<purchase_id>` |
| Invoice issued | External charge `Storage shelf <shelf id> <period>` per billed shelf; external charge `Sales tax <invoice number>` when tax is above 0 |
| Invoice paid | PURCHASE payment for `total_cents`, transaction external key `invoice-<invoice number>` |

When Kill Bill is unreachable or fails, every action that needs it answers `503 billing_unavailable` and changes nothing. That covers: confirm with account payment, check-out with billed hold-over, cancel of account bookings, fee refund of account bookings, hour-pack purchase, invoice issue and invoice payment. Confirm with the hour pack and every other action still work.

**MinIO** stores:
- Documents at `tenants/<tenant id>/documents/<document id>.<pdf|jpg|png>`.
- Invoice PDFs at `invoices/<tenant id>/<invoice number>.pdf`.
- The bucket stays private. Files reach users only through the server's routes.
- Seeded documents get small generated PDF files, written as soon as storage is reachable.

When MinIO is unreachable, upload, approval, every document file route (owner, operator and inspector), invoice issue and invoice PDF download answer `503 storage_unavailable` and change nothing. Document lists, the inspector page's list, the dial and bookings still work.

**Email.** All mail goes through SMTP from `Stationkeeper at Larder Row Kitchen <bookings@larderrow.test>`. Every message goes to exactly one tenant owner's email and mentions only that tenant's records.
- Booking confirmation: subject `Stationkeeper: booking <hold ref> confirmed`. The body lists each booking ref, the station, date, local start and end, payment, and the policy version with its free window and late charge. It is handed to SMTP during the confirm itself, as the last step of its unit of work; when SMTP does not accept it, the confirm answers `503 mail_unavailable`.
- Hold-over notice: subject `Stationkeeper: hold-over recorded on <booking ref>`, with reported and billed minutes and amount. It is handed to SMTP during the check-out itself, in the same way; when SMTP does not accept it, the check-out answers `503 mail_unavailable`.
- Expiry reminder: subject `Stationkeeper: <kind label> expires on <YYYY-MM-DD>`.
- Approval: subject `Stationkeeper: <kind label> approved`.
- Rejection: subject `Stationkeeper: <kind label> needs attention`, with the reason.
- Invoice notice: subject `Stationkeeper: invoice <number> is ready`, with lines and total.
- Receipt: subject `Stationkeeper: receipt for invoice <number>`.
- Kind labels are "Certificate of insurance", "Food handler card" and "Health permit".
- The reminder, approval, rejection, invoice-notice and receipt emails go through the email queue in PostgreSQL. The queue is retried every `REMINDER_SWEEP_SECONDS` until delivered, so each one arrives within one sweep interval of being queued, or of SMTP becoming reachable again. A queued email is marked delivered only when SMTP accepts it.

### Seed data (DP-02, DP-46, DP-47)

Every person, business and address below is invented. "Seed day" is kitchen today on the day the server first fills an empty database. Seeded dates are relative to it and are written when the seed runs.

- **Kitchen:** Larder Row Kitchen, time zone America/Chicago, sales tax rate 8.25%.
- **Stations:**

| id | name | kind | hourly rate |
|---|---|---|---|
| `hot-line-1` | Hot Line 1 | hot_line | $32.00 |
| `hot-line-2` | Hot Line 2 | hot_line | $32.00 |
| `bake-deck` | Bake Deck | bake_deck | $28.00 |
| `cold-prep-a` | Cold-Prep Bench A | cold_prep | $18.00 |
| `cold-prep-b` | Cold-Prep Bench B | cold_prep | $18.00 |

- **Shelves:** `W-1` "Walk-in shelf W-1" through `W-4` "Walk-in shelf W-4", each $45.00 a month. W-1 is assigned to Juniper & Rye and W-2 to Lantern Street Tacos. W-3 and W-4 are unassigned.
- **Hour packs:** `10h` "10-hour pack", 600 minutes, $290.00. `25h` "25-hour pack", 1,500 minutes, $687.50.
- **Cancellation policy:** version 1, free window 48 hours, late charge 50%, effective at seed time.
- **Users:** every seeded user's password is `kitchen-demo-2026`.

| email | name | role | tenant |
|---|---|---|---|
| operator@larderrow.test | Dana Whitcomb | operator | none |
| owner@juniperrye.test | Imani Brooks | owner | `juniper-rye` |
| cook@juniperrye.test | Priya Castellanos | cook | `juniper-rye` |
| owner@lanterntacos.test | Rafael Quintero | owner | `lantern-street` |
| cook@lanterntacos.test | Teo Abernathy | cook | `lantern-street` |
| owner@saltgrasspies.test | Hollis Grant | owner | `saltgrass-pies` |
| owner@fennelferment.test | June Okafor | owner | `fennel-ferment` |

- **Tenants and approved documents:**
  - `juniper-rye` "Juniper & Rye Catering", active. Certificate of insurance expires seed day + 200. Health permit expires seed day + 300. Food handler card for Priya Castellanos expires seed day + 400.
  - `lantern-street` "Lantern Street Tacos", active. Certificate of insurance expires seed day + 250. Health permit expires seed day + 180. Food handler card for Teo Abernathy expires seed day + 20.
  - `saltgrass-pies` "Saltgrass Pies", suspended. Certificate of insurance expired on seed day − 2. Health permit expires seed day + 150. Food handler card for Hollis Grant expires seed day + 90.
  - `fennel-ferment` "Fennel Ferment Co.", applied, with no documents.
- **Hour ledger:** Juniper & Rye has an `opening_balance` movement of +600 minutes and a `booking` movement of −240 minutes for SK-1002-1, so its balance is 360 minutes. Every other tenant's balance is 0.
- **Bookings,** all confirmed, made before Stationkeeper existed, with no Kill Bill records:
  - `SK-1001-1` (hold SK-1001): Lantern Street Tacos, Hot Line 1, seed day + 1, 07:00–11:00. Account payment, $128.00, policy version 1, notes "Brisket prep for Saturday market".
  - `SK-1002-1` (hold SK-1002): Juniper & Rye Catering, Cold-Prep Bench A, seed day + 1, 09:00–13:00. Hour-pack payment, policy version 1, notes "Canapés for 180 covers".
- There are no seeded invoices, holds or inspection links.

## Technical requirements

### Deployment (DP-01)

- The runtime is Node.js 22 LTS with npm. All application source is TypeScript.
- `/app/run.json` holds string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- `serve` binds `0.0.0.0` on the port in `APP_PUBLIC_PORT` when it is set, otherwise on 4173. One process serves both the browser app and the API from the same origin.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` as soon as the server accepts connections.

### Configuration and secrets (DP-06, DP-16, DP-40)

These are read from the environment at start:
- `DATABASE_URL`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`
- `APP_PUBLIC_PORT`
- `HOLD_TTL_SECONDS`: hold life in seconds; default 600 when unset.
- `REMINDER_SWEEP_SECONDS`: the interval in seconds for reminders, the email queue and pending Kill Bill reversals; default 60 when unset.

None of these values is hard-coded or written into source, the built browser bundle, a page or an API response. Any other variables present, such as observer credentials, are ignored.

### Server boundary (DP-04, DP-05)

- **Same-origin only.** A state-changing request (POST, PUT, DELETE) whose `Origin` header is present and differs from the server's own origin → `403 cross_origin`, checked before everything else. No cross-origin sharing headers are sent.
- **Body types.** JSON routes require `application/json`, otherwise `415 unsupported_media_type`. The upload route requires `multipart/form-data`.
- **Size limits.** JSON bodies may be at most 65,536 bytes (exactly 65,536 is allowed); larger → `413 body_too_large`. Upload requests may be at most 5,100,000 bytes in total; larger → `413 file_too_large`, before any storage call.
- **Never served:** source files, source maps of server code, `run.json`, lockfiles, environment files, dotfiles, the database's contents outside the API, and provider credentials. Requests for them → `404`.
- **Third parties.** Pages load no third-party scripts, fonts or images. Fonts are served by the app itself.
- **Boot and recovery.** With Kill Bill or MinIO unreachable at boot, the server still starts, applies its schema, answers health and serves every action that does not need the missing service. Each request that needs a provider tries it again from scratch, so the first request after the provider returns succeeds, with no restart. Seeded files, queued emails and pending reversals catch up within one `REMINDER_SWEEP_SECONDS` interval.

### Browser support and performance (DP-56, DP-58)

- Supported browsers are the current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800.
- With the seed data, the Dial is usable within three seconds of navigation.
- On each dial step, within a tenth of a second of the input, the slider's `aria-valuenow` and `aria-valuetext` hold the new value and the handle has started to move. Within half a second of the input, the centre readout shows the new time and open count in its settled digits and every changed tile shows its new state. Under reduced motion, all of these hold within a tenth of a second.
- API reads with the seed data answer within half a second.

## Working rules

- IF-01: `/app/run.json` exists, is valid JSON with string `install`, `build` and `serve`, and has `"_schema":"run-manifest-v1"`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package by name, version and licence, plus every bundled font. Shipped packages are the production dependency tree, as reported by `npm ls --omit=dev --all --json` or the lockfile's non-dev packages.
- IF-03: Every shipped package and bundled font uses one of these licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The only datastores are the provided PostgreSQL, MinIO bucket and Kill Bill. Nothing else is used: no SQLite, Redis, in-memory store standing in for records, or local files used as records.
- IF-05: The provided service definitions and their development credentials are left unchanged.
- IF-06: All hand-written application source is TypeScript. Plain JavaScript appears only as build output or tool configuration.

## Engineering standards

These standards are assessed only by the source-quality review. They never change whether a mandatory requirement or working rule passes, and any code organisation that meets them is acceptable.

- The code is idiomatic, strictly typed TypeScript: no `any` in domain code, and no suppressed type errors.
- Names in code match the domain terms in this brief: tenant, station, hold, booking, hold-over, hour pack, ledger movement, policy version, document, inspection link, shelf, invoice.
- Each domain rule has one definition that every surface applying it uses: each state transition, the free-slot and cleaning-buffer check, hold expiry, hold-over billing, cancellation charges, document validity, tenant status, invoice totals and tax.
- There is no abstraction with only one implementation, and no wrapper that adds nothing.
- There is no dead, commented-out or unreachable code, and no defensive check for states the rules above make impossible.
- Every API error is produced in the one error shape and precedence order from API.
- No feature, screen, endpoint or setting exists beyond this brief.
