# Pilot Light Co. Hearthshift

Hearthshift is a booking, billing and compliance tool for shared commercial kitchens. These are commissary, incubator and community kitchens that rent stations by the hour to caterers, food-truck operators, cottage bakers and meal-prep start-ups. Renters claim exact station time by sweeping an arc around a 24-hour station dial. They pay from a prepaid hour pack or by card, and they keep their liability certificate and food-handler card on file. Front-desk leads check renters in and out and bill overruns and cleaning fees at the counter. Kitchen managers run schedules, cancellation policy, reports and a read-only compliance binder for health inspectors. The app uses four services:

- Postgres is the system of record.
- Kill Bill handles renter billing accounts, pack purchases, card payments, deposits, fees and refunds.
- MinIO stores renter documents and generated binder PDFs.
- Mailpit receives every outgoing email.

Out of scope:

- self-service renter sign-up
- real card capture (Kill Bill's built-in external payment method stands in for the card)
- SMS or push notifications
- multi-currency
- pack expiry
- any datastore beyond Postgres and MinIO

## Problem and users

Thousands of small food businesses can't legally cook for sale at home, so they rent hourly time in licensed shared kitchens. Most of these kitchens run on three disconnected tools: a wall calendar, a shared spreadsheet and a card reader. Bookings live in one place and billing in another. Insurance certificates and food-handler cards sit in an email inbox. This causes real losses:

- Two bakers turn up for the same deck oven at 4 a.m.
- Prepaid hour packs get overspent because nobody deducted Tuesday's overrun.
- A late cancellation gets refunded under last quarter's policy.
- An inspector walks in and the manager can't show that every renter on the schedule had a current liability certificate that day.

Kitchens lose $30 to $60 for every double-booked or no-show hour, plus damage deposits and cleaning fees they never collect. Renters lose whole production days when a slot they thought they held is gone. Existing tools treat a station as a block on a calendar. They don't show station time as something you can see and claim, and they don't tell you honestly when billing or mail is down.

Users:

- **Kitchen manager** (daily): runs station schedules, hour packs, deposits, cancellation policy and renter compliance for every site of their operator, without double-booking or unbilled hours.
- **Renter** (weekly): claims exact time on an oven, range line, prep table or walk-in shelf, pays from a prepaid pack or by card, and keeps insurance and food-handler documents current.
- **Front-desk lead** (daily): works one site from a counter tablet. Checks renters in and out, logs overruns and cleaning fees, settles deposits and takes walk-up bookings for renters.
- **Health inspector** (occasional): has no account. Opens a read-only compliance binder link for one site and date range and confirms that every renter on the schedule held current documents.

## Journeys

1. **Claim time on the dial.**
   - Start: renter Tamsin Okoro of Juniper Crumb Bakery is signed in on the station board for the Halsted site, tomorrow.
   - Actions: she presses a free tick on the Deck oven 1 ring and sweeps clockwise. The centre counts hours and price, and the arc stops with a "Your booking" label where it meets her own seeded booking. She releases.
   - End: her arc turns solid, a countdown ring traces the dial's outer edge, and the Checkout dialog shows her hold.
2. **Check out and pay.**
   - Start: a renter has a live hold.
   - Actions: she buys a 20-hour pack, ticks "Use pack hours", chooses "Pay now" for any card remainder and confirms.
   - End: a printed ticket slides onto the rail marked Paid, her pack balance drops by the reserved hours, Kill Bill shows the card payment and deposit on her account, and one confirmation email arrives.
3. **Book a recurring overnight shift.**
   - Start: a renter on the board.
   - Actions: she holds Deck oven 2 from 01:00 to 05:00 on a Sunday, repeating for four weeks, including the Sunday the clocks fall back.
   - End: four tickets appear. The change-day ticket, its invoice and the dial (showing 25 hour ticks) show five real hours. The other tickets show four.
4. **Run the counter.**
   - Start: front-desk lead Priya Lindqvist is on the counter screen at Halsted.
   - Actions:
     - She books a walk-up slot for a renter.
     - She checks the renter in.
     - She taps "Charge overrun" twice on a flaky connection for 40 minutes.
     - She checks the renter out, adds a cleaning fee and settles.
   - End: the ticket reads Settled. Kill Bill shows exactly one overrun charge, one cleaning fee and the deposit refunded.
5. **Cancel under the terms you agreed to.**
   - Start: a renter holds two confirmed bookings, one made before and one after the manager scheduled a stricter cancellation policy.
   - Actions: she cancels both at the same distance from start.
   - End: the older booking is refunded in full, the newer one is forfeited, and each ticket, invoice and dialog quotes its own terms.
6. **Manager's morning report.**
   - Start: manager Odile Marchetti is on the manage screen.
   - Actions: she reads today's site totals, searches renters, opens the station utilisation report for a site and day, downloads the CSV, schedules a policy change, and cancels one booking with a full refund and a written reason.
   - End: only Ember Row data appears. The utilisation figures follow the site's own day. The booking's audit shows her name and reason.
7. **Keep documents current.**
   - Start: renter June Abernathy has no liability certificate, and her confirm attempt is refused.
   - Actions: she uploads a PDF certificate.
   - End: the documents table shows it as current and her next confirmation succeeds. A certificate expiring in 14 days triggers one reminder email.
8. **Inspector visit.**
   - Start: a manager creates a binder link for Halsted covering one week.
   - Actions: the inspector opens it, reads the binder and downloads its PDF. The manager then regenerates the link and later revokes it.
   - End:
     - The binder lists every renter on the schedule with their document status for each day, and no phone numbers or money.
     - After regeneration, the old address shows "This binder link is no longer valid".
     - After revocation, the new address shows the same message.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Station day dial** Show each site's local day as a dial of station rings whose booked, held and your-own segments come from the day endpoint for that site and date.
- **DP-02 — Placing a hold** Let a renter, or staff on a renter's behalf, place a hold on 15-minute boundaries for 15 minutes to 12 hours, validated as stated in API and Business rules.
- **DP-03 — One winner per contested slot** When several claims overlap the same station time at once, exactly one hold is created and every other claim is refused with the winning hold as its blocker.
- **DP-04 — Server-timed hold expiry** Holds expire on the server's clock with a published exclusive edge, free their time at that instant, and send one hold-expired email, as qualified in Business rules.
- **DP-05 — Letting a hold go** A renter can release their own live hold early, which frees the time immediately and sends no email.
- **DP-06 — Lost claim snaps back** When the server refuses a dragged claim, the arc retracts along its path, the competing time appears with its label, and the dial status explains why.
- **DP-07 — Distinguishable time states** Free, held, booked and your-own time differ on the dial by pattern and visible text label as well as colour, at the contrast stated in Visual design.
- **DP-08 — Claiming time on the dial** A renter sweeps an arc on a free ring, sees hours and price count live, and on release gets a held arc with a countdown and an open Checkout dialog.
- **DP-09 — Confirming with pack hours and card** Confirming a hold applies available pack hours first and records the card remainder and deposit in Kill Bill, as qualified in Business rules.
- **DP-10 — Pay now or pay later** A card balance can be paid at confirmation or later until the booking's unpaid cutoff, and a booking shows Paid only once Kill Bill records the time payment.
- **DP-11 — All-or-nothing confirmation** Confirmation either records the booking, its pack reservation, its Kill Bill payments and one queued email together, or changes nothing and undoes any partial charge.
- **DP-12 — Liability certificate gate** A booking cannot be confirmed unless the renter has a stored liability certificate valid on every local date the booking touches.
- **DP-13 — Booking confirmation email** Each successful confirmation sends exactly one email to the renter listing station, local start and end, hours and amounts for every booked date.
- **DP-14 — Checkout journey** A renter with a live hold buys a pack if needed, confirms in the Checkout dialog, and sees a Paid ticket on the rail and an updated pack balance.
- **DP-15 — Weekly repeating holds** A hold can repeat weekly for up to 12 weeks at the same local wall-clock times and is created for all weeks or none.
- **DP-16 — Wall-clock times across clock changes** Local times that do not exist or happen twice on clock-change days resolve by the single published rule in Business rules.
- **DP-17 — Billing actual elapsed hours** Bookings, quotes, tickets, invoices and emails count and bill the real elapsed minutes between start and end, including on clock-change days.
- **DP-18 — Clock-change days on the dial** The dial shows 23 hour ticks on the spring change day and 25 on the autumn change day, with the repeated hour labelled by zone.
- **DP-19 — Booking a recurring overnight shift** A renter holds and confirms a four-week Sunday 01:00–05:00 shift across the autumn change and sees the true hours on every ticket.
- **DP-20 — Buying an hour pack** A renter buys a 20-hour pack through Kill Bill exactly once per idempotency key, and the hours become available immediately.
- **DP-21 — Paired hour ledger** Every pack movement is two entries that sum to zero, and available, reserved and used hours always equal the sums of their entries.
- **DP-22 — Pack balance from the ledger** Every screen shows the server's available pack hours and refreshes them after each action that moves hours.
- **DP-23 — Check-in and check-out** Front desk checks a confirmed booking in within its window and checks it out later, which moves its reserved pack hours to used.
- **DP-24 — Overrun charged once** Front desk bills an overrun in minutes once per booking, and replaying the same request never charges again.
- **DP-25 — Cleaning fee and settlement** Front desk can add one cleaning fee after check-out and then settles the booking, which refunds its deposit in Kill Bill.
- **DP-26 — Booking state guard** Every booking action outside its legal state is refused with the transition error, and every state change writes one attributed audit event.
- **DP-27 — Running the counter** A front-desk lead books a walk-up renter, checks them in, charges an overrun, checks out, adds a cleaning fee and settles from the counter screen.
- **DP-28 — Scheduling a cancellation policy** A manager schedules a new cancellation notice period for a site from today or a later local date.
- **DP-29 — Refund terms fixed at booking** A cancellation is refunded or forfeited by the policy version in force when the booking was confirmed, never by a later one.
- **DP-30 — Booking's own terms on every surface** The booking detail, ticket, cancel dialog, invoice and confirmation email all quote the booking's own policy terms.
- **DP-31 — Cancellation replay safety** Replaying a cancellation with the same key returns the original result and refunds nothing twice.
- **DP-32 — Cancelling a booking** A renter opens a ticket, reads the refund outcome in the cancel dialog, confirms, and sees the cancelled ticket with its refund summary.
- **DP-33 — Unpaid balance cutoff** A booking whose card balance is still unpaid at its local cutoff is cancelled automatically, as qualified in Business rules.
- **DP-34 — Unpaid cancellation notice** Each automatic unpaid cancellation sends exactly one notice email to that booking's renter.
- **DP-35 — Daily station utilisation** The utilisation report and its CSV cover the site's local day of 23, 24 or 25 hours and count only booked station minutes.
- **DP-36 — Manager's morning report** A manager reads site totals, searches renters, opens and downloads utilisation, and schedules a policy change from the manage screen.
- **DP-37 — Document uploads checked by content** Renter documents are accepted only as PDF, PNG or JPEG judged by their bytes and within the published size limit.
- **DP-38 — Private document storage** Documents are stored in MinIO under server-chosen keys and served only to their renter and to staff of the renter's operator.
- **DP-39 — Expiry reminder once** Each document triggers exactly one reminder email starting 14 local days before it expires.
- **DP-40 — Keeping documents current** A renter refused for a missing certificate uploads one, sees it listed as current, and then confirms.
- **DP-41 — Inspector binder links** A manager creates a binder link for one site and date range that expires, can be revoked, and can be regenerated so that the old address stops working.
- **DP-42 — Binder contents** A binder lists each scheduled renter's bookings and daily document status for its site and range only, with no contact or payment data, and refuses every change.
- **DP-43 — Binder PDF** Each binder link has a generated PDF stored in MinIO and downloadable through the link.
- **DP-44 — Inspector visit** An inspector opens a binder link, reads the schedule and document status, and downloads the PDF without signing in.
- **DP-45 — Own records only** A renter can open only their own holds, bookings, invoices, ledger and documents, and any other identifier answers not found.
- **DP-46 — Operator isolation on derived surfaces** Search, totals, reports, exports, dial labels and binders never include another operator's sites, renters or bookings.
- **DP-47 — Manager override with reason** A manager can cancel a confirmed booking with a full refund or release a hold, giving a reason recorded with their name.
- **DP-48 — Booting with billing or mail down** The app starts and serves with Kill Bill or Mailpit unreachable at boot, answers the health check, and reports which service is delayed in its status and banner.
- **DP-49 — Billing outage leaves no trace** While Kill Bill is unreachable, every card action is refused with the billing error and changes nothing, while pack-only bookings still confirm.
- **DP-50 — Mail outage queues email** While Mailpit is unreachable, actions still succeed and each of their emails is counted once as queued instead of being lost.
- **DP-51 — Run manifest and health** The app installs, builds and serves from the run manifest on the stated port and answers the health check.
- **DP-52 — Sign-in and roles** Seeded users sign in with email and password, receive a session, and are limited to their role's actions and their scope.
- **DP-53 — One error shape and precedence** Every API error uses one JSON shape and follows one precedence order.
- **DP-54 — Responsive layout** The board, counter, manage, documents, pack and binder screens fit 375x812, 768x1024 and 1280x800 with no page-level horizontal scroll.
- **DP-55 — Keyboard dial and reduced motion** The dial is fully operable by keyboard with announced states, and with reduced motion every animation becomes an instant change.
- **DP-56 — Motion timing** Dial snaps, spring-back, fill, retract, numeral tweens and ticket slides happen within the durations stated in Motion and effects.
- **DP-57 — Kitchen ticket-rail look** The screens read as an orderly order-ticket rail on warm paper, with a single tomato accent kept for live and claimed time.
- **DP-58 — Secrets stay on the server** Every service URL and credential is read from the environment on the server and never hard-coded or sent to the browser.
- **DP-59 — Server boundary** The server enforces body limits and same-origin writes, and never serves source, configuration or credentials.

## Frontend

### Screens and layout (DP-01, DP-08, DP-14, DP-27, DP-36, DP-40, DP-44, DP-54)

Every screen except the binder has a top bar with the brand, a `navigation "Main"` region (links depend on role), the signed-in user's name, a `button "Sign out"`, and the `status "Service status"` banner. The banner is visible only while a service is delayed.

- **Sign in** (`/`): an email field, a password field and a sign-in button, centred on paper. After sign-in, renters land on Board, front-desk leads on Counter and managers on Manage.
- **Board** (`/board`, for renters, front desk and managers):
  - **Desktop (1280x800):** a fixed left column lists the site's stations by name. The large circular day dial sits centred in the remaining space. The site picker and day controls sit above the dial. The ticket rail runs horizontally beneath the dial and scrolls sideways inside itself. The Checkout dialog opens as a panel at the right of the dial without hiding it.
  - **Tablet (768x1024):** station names become a wrapping row of buttons above the dial. The dial fills the width. The rail sits below and Checkout opens as a panel below the dial.
  - **Phone (375x812):** controls stack, station buttons wrap, and the dial fills the width inside the page margins. The rail becomes a vertical stack of tickets, and Checkout opens as a bottom sheet.
  - **Rings and centre:** each station is one concentric ring, outermost first in station-list order. Midnight is at the top and time runs clockwise. The centre of the dial shows the selection summary, and the dial legend sits beside or below the dial.
  - **Staff extras:** staff also see a renter picker above the dial for walk-up bookings.
- **Tickets** (renters, inside Board's rail and at `/tickets` as a full list): each booking is a printed ticket. It shows station, local date, start and end with zone abbreviation, hours, status label, payment label and amount, with every time and amount in monospaced numerals. Opening a ticket shows the booking details dialog with its invoice lines, its policy terms and its actions.
- **Pack** (`/pack`, renters): the hour-pack region with available, reserved and used hours, the buy button, and the pack ledger table.
- **Documents** (`/documents`, renters): an upload form and the documents table.
- **Counter** (`/counter`, front desk and managers): today's bookings for the site in a table, one row per booking, with row actions. On phone the table becomes stacked cards with the same controls.
- **Manage** (`/manage`, managers) has five stacked sections, in two columns on desktop and one column below that:
  - site totals
  - renter search
  - station utilisation with a site and day picker
  - cancellation policy
  - binder links
- **Binder** (`/binder/<token>`, no sign-in): the site name, date range and generated time, the compliance binder table and a PDF download link. A dead link shows only the dead-link copy from Feedback states.

At all three viewports no page scrolls horizontally. The rail and wide tables may scroll inside their own frame.

### Public screens and controls (DP-01, DP-05, DP-06, DP-08, DP-14, DP-22, DP-23, DP-25, DP-27, DP-28, DP-32, DP-35, DP-36, DP-40, DP-41, DP-44, DP-47, DP-48, DP-52, DP-55)

These roles and accessible names are public; tests and judges use them. Everything else is free.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| Sign in | `textbox "Email"` | label "Email" |
| Sign in | password field labelled "Password" | label "Password" |
| Sign in | `button "Sign in"` | "Sign in" |
| Sign in | `status "Sign-in status"` | Feedback states copy |
| All | `navigation "Main"` | links "Board", "Tickets", "Pack", "Documents" (renter); "Board", "Counter" (front desk); "Board", "Counter", "Manage" (manager) |
| All | `button "Sign out"` | "Sign out" |
| All | `status "Service status"` | outage banner copy |
| Board | `combobox "Site"` | site names the user may see |
| Board | `button "Previous day"`, `button "Next day"` | arrow icons with these names |
| Board | `textbox "Day"` | the local date as YYYY-MM-DD |
| Board (staff) | `combobox "Renter"` | renter business names |
| Board | `button "<station name>"` per station in the left column | station name and hourly rate; pressed state marks the focused ring |
| Board | `group "Station dial"` | the dial |
| Board | `slider "<station name>"` per ring | value text: "No selection" or "Selection <HH:MM>–<HH:MM>, <hours> h" |
| Board | `region "Selection summary"` | "<hours> h", "$<amount>", "Pack <hours> h", "Card <hours> h", "Pack balance <hours> h" |
| Board | `timer "Hold time left"` | "<MM:SS>"; with reduced motion, the static held-until copy |
| Board | `list "Dial legend"` | items "Free", "Held", "Booked", "Yours", each with its pattern swatch |
| Board | `status "Dial status"` | Feedback states copy |
| Board | `list "Booking tickets"` with one `listitem` per ticket | ticket content as described above |
| Board | `button "Checkout"` | shown while the user has a live hold; reopens the dialog |
| Checkout | `dialog "Checkout"` | occurrences, quote, policy terms, held-until copy |
| Checkout | `checkbox "Use pack hours"` | "Use pack hours (<hours> h available)" |
| Checkout | `radiogroup "Card payment"` with `radio "Pay now"` and `radio "Pay later"` | "Pay now", "Pay later (due by <local date> <HH:MM>)" |
| Checkout | `button "Confirm booking"` | "Confirm booking" |
| Checkout | `button "Let hold go"` | "Let hold go" |
| Checkout | `status "Checkout status"` | Feedback states copy |
| Ticket | `dialog "Booking details"` | booking fields, invoice lines, terms |
| Ticket | `button "Pay balance"` | shown when a card balance is due |
| Ticket | `button "Cancel booking"` | shown while cancellable |
| Ticket (manager) | `textbox "Override reason"`, `button "Cancel with full refund"` | override controls |
| Cancel | `alertdialog "Cancel booking"` | refund outcome copy, terms |
| Cancel | `button "Yes, cancel"`, `button "Keep booking"` | as named |
| Pack | `region "Hour pack"` | "<hours> h available", "<hours> h reserved", "<hours> h used" |
| Pack | `button "Buy 20-hour pack"` | "Buy 20-hour pack · $<amount>" |
| Pack | `table "Pack ledger"` | columns When, Movement, Account, Hours, Booking |
| Pack | `status "Pack status"` | Feedback states copy |
| Documents | `combobox "Document type"` | "Liability certificate", "Food handler card" |
| Documents | `textbox "Valid from"`, `textbox "Expires on"` | YYYY-MM-DD |
| Documents | file input labelled "Document file" | "Document file (PDF, PNG or JPEG)" |
| Documents | `button "Upload document"` | "Upload document" |
| Documents | `table "My documents"` | columns Type, Valid from, Expires on, Status, File |
| Documents | `status "Documents status"` | Feedback states copy |
| Counter | `table "Today's bookings"` | columns Renter, Station, Time, Status, Actions |
| Counter | per row `button "Check in"`, `button "Charge overrun"`, `button "Check out"`, `button "Add cleaning fee"`, `button "Settle"` | each shown only in its legal state |
| Counter | `dialog "Charge overrun"` with `spinbutton "Overrun minutes"` and `button "Charge"` | quote "$<amount>" updates as minutes change |
| Counter | `status "Counter status"` | Feedback states copy |
| Manage | `region "Site totals"` | per site and total: "Bookings today", "Booked hours today", "Unpaid balances", "Documents expiring in 14 days" |
| Manage | `searchbox "Search renters"` and `list "Renter results"` | business, name, email, home site |
| Manage | `combobox "Report site"`, `textbox "Report day"`, `table "Station utilisation"` | columns Station, Booked hours, Day hours, Utilisation |
| Manage | `link "Download CSV"` | "Download CSV" |
| Manage | `combobox "Policy site"`, `spinbutton "Notice hours"`, `textbox "Effective from"`, `button "Schedule policy"` | policy form |
| Manage | `table "Policy versions"` | columns Notice, Effective from, Scheduled by |
| Manage | `combobox "Binder site"`, `textbox "Binder from"`, `textbox "Binder to"`, `button "Create binder link"` | binder form |
| Manage | `table "Binder links"` with per row `button "Regenerate"` and `button "Revoke"` | link address, range, expiry, state |
| Manage | `status "Manager status"` | Feedback states copy |
| Binder | `table "Compliance binder"` | columns Date, Renter, Business, Station and time, Liability certificate, Food handler card |
| Binder | `link "Download PDF"` | "Download PDF" |

### Interactions (DP-05, DP-06, DP-08, DP-14, DP-27, DP-32, DP-55)

**Dial sweep (pointer and touch).**
1. Pressing on a free tick of a ring starts an accent arc at that tick, snapped to the nearest quarter hour. Pressing on held or booked time does nothing except announce that segment's label in the dial status.
2. Dragging clockwise moves the end. Dragging anticlockwise moves the start earlier. The arc grows and shrinks in 15-minute snaps, up to 12 hours.
3. While dragging, the selection summary counts hours and the card price. Pack-covered hours count in ink, and hours beyond the pack balance count in accent at the card rate.
4. If the arc meets held or booked time, including the renter's own, it stops at the boundary with a short spring-back. A text label on the dial names the blocker as "Booked <HH:MM>", "Held <HH:MM>", "Your booking <HH:MM>" or "Your hold <HH:MM>", using the boundary time touched. The dial status shows the drag-blocked copy from Feedback states.
5. Releasing after at least one snap sends the hold request. Releasing without moving a snap clears the selection.
6. On success, the arc fills solid accent, the countdown ring starts, and the Checkout dialog opens. On refusal, the arc retracts and the competing time appears (DP-06).

Touch drags on the dial never scroll the page. Staff choose a renter first; the dial refuses to start an arc until a renter is chosen and the dial status explains why.

**Keyboard dial.**
- Tab order on Board is: navigation, site picker, day controls, renter picker (staff), station buttons, each ring slider in station order, the Checkout button when present, then the ticket rail.
- A focused ring slider takes these keys:
  - Arrow Right or Up moves a 15-minute selection's start one quarter hour later. Arrow Left or Down moves it earlier.
  - Shift with an arrow extends or shrinks the end by one quarter hour.
  - Enter places the hold.
  - Escape clears the selection.
- Pressing a station button moves focus to its ring.
- Every change is announced through the dial status.

**Dialogs.**
- Opening Checkout, Booking details, Charge overrun or the cancel alertdialog moves focus to its first control. Escape closes it, except the cancel alertdialog, which closes only by its buttons or Escape (Escape means keep the booking).
- Focus returns to the control that opened it.
- Closing Checkout keeps the hold. "Let hold go" releases it.

**Ticket rail.** Clicking, tapping or pressing Enter on a ticket opens Booking details. The rail scrolls sideways with wheel, trackpad or swipe. A new ticket scrolls into view.

**Counter.** Row buttons act immediately except "Charge overrun", which opens its dialog. "Charge" sends one request with a key generated when the dialog opened. Pressing it again, or the tablet retrying, reuses that key until the dialog closes.

**Search and reports.** The renter search updates results within half a second of typing pauses. Changing the report site or day reloads the table. "Download CSV" downloads the same site and day.

**Hover and press.** Buttons and tickets darken their edge on hover and press in visibly on press. Every focusable control shows a thick ink focus outline.

### Visual design (DP-07, DP-57)

- **Colour roles:**
  - a warm off-white paper ground
  - near-black ink for text and rules
  - one tomato-orange accent used only for live or claimed time: your arc, your holds, your bookings on the dial, the countdown ring and card-overflow numerals
  - a cool steel grey for other renters' booked time and secondary text at sizes that keep contrast
  - a muted sand for held time
- **Type:**
  - Headings use Archivo, a compact grotesk set heavy and tight.
  - Body text uses Public Sans.
  - Every time, amount and hour count uses JetBrains Mono.
  - Each heading step is about one third larger than the step below it.
- **Grid and density:** every element sits on a visible ticket-rail grid in eight-pixel steps. Thin ink rules separate rows like a pass rail, and density is compact.
- **Composition:**
  - The left column of station names reads like an order rail.
  - The large dial is the focal point.
  - Tickets are paper slips with a perforated top edge and a printed look: mono numerals and a status stamp in a box.
- **Segment patterns on the dial:**
  - booked: solid steel with a diagonal hatch
  - held: sand with a dark dotted edge
  - yours: solid accent
  - free: bare paper with tick marks only
- **Tap targets:** controls are at least 44 by 44 pixels. Each ring is thick enough to press reliably on a tablet.
- **Contrast:** meets WCAG 2.2 AA. Body text is at least 4.5:1 against its background and large text at least 3:1. Segment fills and edges and the focus outline are at least 3:1 against the paper. Accent is never used for body-size text on paper.
- **Icons:** Lucide line icons, always paired with a text label or an accessible name.

### Motion and effects (DP-06, DP-08, DP-55, DP-56)

All motion starts fast and settles gently. Durations come from three steps:

- about a tenth of a second for press feedback and each snap
- about a quarter of a second for numeral changes and ticket slides
- a little under half a second for the largest moves

Specific effects:

- **Snap:** the arc's moving end jumps to each quarter-hour tick, reaching it within about a tenth of a second.
- **Spring-back at a blocker:** the arc may overshoot the blocker's boundary by no more than six degrees of the dial, then settle exactly on the boundary in a little under half a second.
- **Numerals:** the summary numbers roll to their new value in about a quarter of a second.
- **Hold placed:** the outline arc fills to solid accent in a little under half a second. The countdown ring then traces the dial's outer edge from the arc's position around the full circle, shrinking evenly over the hold's lifetime (Business rules), and updates every second.
- **Lost claim:** the arc retracts to zero length back along the path it was drawn, in a little under half a second. The competing held segment then appears.
- **Ticket:** a new ticket slides onto the rail from the right in about a quarter of a second. A cancelled ticket stays in place and gains its status stamp.
- **Dialogs:** they fade and rise slightly into place in about a quarter of a second and leave in about a tenth of a second.
- **Never:** no decorative motion, no idle loops and no pulsing. The countdown ring is the only continuously changing element.

When the device asks for reduced motion:

- There is no spring, sweep, fill, retract or slide. The arc jumps to each snapped position and every state change is instant.
- The countdown ring is replaced by the static held-until copy (Feedback states).
- Numerals update instantly.
- Keyboard operation and live-region announcements are unchanged.

### Feedback states (DP-06, DP-07, DP-10, DP-12, DP-14, DP-22, DP-25, DP-27, DP-30, DP-32, DP-36, DP-40, DP-44, DP-48, DP-49, DP-50, DP-52)

**Time-state labels.** Status is never shown by colour alone:

- Every dial segment carries a visible text label. This is also the exact `label` string the API returns for a segment and for a `slot_taken` blocker:
  - "Booked <HH:MM>–<HH:MM>" for state `booked`
  - "Held <HH:MM>–<HH:MM>" for `held`
  - "Your booking <HH:MM>–<HH:MM>" for `yours_booked`
  - "Your hold <HH:MM>–<HH:MM>" for `yours_held`
- The two times are the segment's own local start and end, even when it runs past the viewed day.
- Labels never include a business name, for renters or staff. Staff read the business from the segment's `renter_business` field, which is shown beside the label in the callout.
- The "Your" states appear only when the signed-in renter owns the time. Staff always see `booked` and `held`.
- The label is placed on the ring when it fits, or else in a callout beside the dial.
- `<blocker label>` in Dial status copy is always the blocker's full label as defined above, including the "Your" forms when the renter's own time is the blocker.
- The legend pairs each pattern with its word.
- Ticket status stamps are text: "Held", "Confirmed", "Checked in", "Overrun billed", "Checked out", "Settled", "Expired", "Cancelled — refunded", "Cancelled — forfeited", "Cancelled — unpaid".
- Payment labels are "Paid", "Pack", or "Balance due by <local date> <HH:MM>".

**Placeholders, used throughout:**

- `<HH:MM>`: a 24-hour local time in the site's zone.
- `<local date>`: YYYY-MM-DD in the site's zone.
- `<hours>`: minutes ÷ 60 with two decimals.
- `$<amount>`: US dollars with two decimals.
- `<zone>`: the site zone's abbreviation at that instant, for example CDT.
- `<MM:SS>`: whole minutes and seconds left.

Tickets, invoices and emails always print `<zone>` after each time.

**Policy terms line**, shown wherever a booking's terms appear: "Free cancellation until <notice> hours before start. Later cancellations keep the time charge and the deposit." Here `<notice>` is the booking's own policy notice hours.

**Copy by screen.** Each region below is a polite live region. Pending copy appears as soon as the request starts, and success or error copy replaces it when the response arrives. Errors also appear as text next to the related field.

| Action | Region | Pending | Success | Errors |
|---|---|---|---|---|
| Sign in | Sign-in status | "Signing in…" | (navigates to the user's landing screen) | 401: "Email or password is wrong." |
| Place hold | Dial status | "Placing hold…" | "Held until <HH:MM>. Finish checkout to keep it." | 409 slot_taken: "Another renter just took this time. <blocker label>" · 422: "That time can't be held: <first field message>" |
| Drag blocked | Dial status | — | — | "Stopped at <blocker label>" |
| Hold expired (server) | Dial status | — | "Your hold ran out and the time was released." | — |
| Let hold go | Checkout status | "Releasing…" | "Hold released." | — |
| Confirm booking | Checkout status | "Confirming…" | "Booking confirmed. Confirmation email queued." | 410: "Your hold ran out before payment. Nothing was charged." · 422 certificate_required: "Upload a liability certificate that covers <local dates, comma-separated> before confirming." · 422 pay_now_required: "This booking starts too soon to pay later. Choose Pay now." · 422 pack_insufficient: "Your pack no longer covers these hours. Untick Use pack hours or buy a pack." · 503: "Card payments are delayed while billing is unreachable. Nothing was charged." |
| Pay balance | Dial status | "Paying…" | "Balance paid: $<amount>." | 503: the confirm 503 copy |
| Buy pack | Pack status | "Buying pack…" | "20 hours added. <hours> h available." | 503: the confirm 503 copy |
| Cancel booking | Dial status | "Cancelling…" | full refund: "Cancelled. Refunded $<amount> to card, <hours> h to your pack and the $<amount> deposit." · forfeit: "Cancelled under your booking's <notice>-hour terms. Nothing was refunded." | 503: "Refunds are delayed while billing is unreachable. Your booking is unchanged." |
| Cancel dialog body | — | — | ahead of the notice: "You'll get a full refund." · inside it: "You're inside the <notice>-hour notice. Nothing will be refunded." | — |
| Check in / Check out | Counter status | "Saving…" | "Checked in: <business>." / "Checked out: <business>." | 409 outside_check_in_window: "Check-in opens 30 minutes before start." |
| Charge overrun | Counter status | "Charging…" | "Overrun of <minutes> min charged: $<amount>." | 503: "Overrun can't be charged while billing is unreachable. Nothing was charged." |
| Add cleaning fee | Counter status | "Charging…" | "Cleaning fee charged: $<amount>." | 503: the overrun 503 copy with "Cleaning fee" in place of "Overrun" |
| Settle | Counter status | "Settling…" | "Settled. Deposit refunded: $<amount>." (with no deposit: "Settled.") | 503: "Settlement is delayed while billing is unreachable. The booking is unchanged." |
| Upload document | Documents status | "Uploading…" | "Document saved." | 415: "Files must be PDF, PNG or JPEG." · 413: "Files must be 5,000,000 bytes or smaller." · 422: the field message |
| Schedule policy | Manager status | "Scheduling…" | "<notice>-hour policy scheduled from <local date>." | 422: field message · 409: "A policy already starts on that date." |
| Create / regenerate / revoke binder link | Manager status | "Saving…" | "Binder link ready." / "New link ready. The old link no longer works." / "Link revoked." | 422: field message |
| Override cancel | Manager status | "Cancelling…" | "Cancelled with full refund. Reason recorded." | 422: "Give a reason of at least 5 characters." · 503: the cancel 503 copy |

The documents table Status column reads "Current", "Expires in <n> days" (when 14 or fewer days remain), "Expired" or "Not yet valid".

**Binder.** A dead binder link shows the heading "This binder link is no longer valid" and nothing else. Liability and food-handler cells read "Current until <local date>", "Expired <local date>" or "Missing".

**Outage banner** (Service status). It appears within 15 seconds of a service becoming delayed and disappears within 15 seconds of recovery:

- billing delayed: "Card payments are delayed: billing is unreachable. Pack bookings still work."
- mail delayed: "Emails are delayed and will send automatically when mail is back."
- both delayed: both lines.

While billing is delayed, the "Pay now" radio, "Buy 20-hour pack", "Pay balance", "Charge overrun", "Add cleaning fee" and "Settle" buttons carry the visible suffix "(delayed)" and stay operable. If pressed, they show their 503 copy. The suffix is visible text only: each control's accessible name stays exactly as listed in Public screens and controls.

## Backend

### API (DP-01, DP-02, DP-05, DP-09, DP-10, DP-15, DP-20, DP-21, DP-23, DP-24, DP-25, DP-26, DP-28, DP-31, DP-35, DP-37, DP-38, DP-41, DP-42, DP-43, DP-45, DP-46, DP-47, DP-51, DP-52, DP-53)

**General.**

- All endpoints are under the app origin and take and return `application/json; charset=utf-8`, except the uploads, files, CSV, PDF and binder HTML noted below.
- Times in bodies are UTC ISO 8601 with a `Z` suffix. Local dates are `YYYY-MM-DD` and local times are `HH:MM`. Money is integer cents in fields ending `_cents`, and durations are integer minutes in fields ending `_minutes`.
- Sessions use an HttpOnly, SameSite=Lax cookie named `hs_session`.

**Error shape.** Every error body is `{"error":"<code>","message":"<sentence>"}`, plus the extra fields listed for that code. Validation errors are `422 {"error":"validation","message":"<sentence>","fields":{"<field>":"<message>"}}`.

**Shared errors** (every endpoint below can return these where they apply):

- `400 {"error":"invalid_json"}`
- `401 {"error":"unauthenticated"}`
- `404 {"error":"not_found"}`: unknown id, another renter's record, or anything outside the caller's operator or site scope
- `403 {"error":"forbidden"}`: right scope, wrong role
- `400 {"error":"idempotency_key_required"}`
- `409 {"error":"idempotency_key_reused"}`
- `409 {"error":"request_in_progress"}`
- `409 {"error":"invalid_transition","from":"<status>","action":"<action>"}`
- `503 {"error":"billing_unavailable"}`

**Error precedence**, the single order for the whole API:

1. cross-origin writes, body limits and content type (Server boundary)
2. 400 invalid_json for a JSON body that does not parse
3. 401
4. 404
5. 403
6. 400 for a missing or malformed idempotency key
7. idempotency replay, reuse or in-progress, where a stored response is returned before any later check
8. state conflicts (409, 410)
9. validation (422, and the upload 413 and 415)
10. 503 billing_unavailable

Endpoints marked **Key** require an `Idempotency-Key` header with the semantics in Business rules.

**Session and status**

| Method and path | Who | Request | Success | Endpoint errors |
|---|---|---|---|---|
| GET /api/health | anyone | — | 200 `{"status":"ok"}` | — |
| GET /api/status | anyone | — | 200 `{"billing":"ok"\|"delayed","mail":"ok"\|"delayed","queued_emails":<int>}` | — |
| POST /api/session | anyone | `{"email","password"}` | 200 `{"user":{"id","name","email","role":"renter"\|"front_desk"\|"manager","operator_id","site_ids":[...],"renter_id":<id\|null>}}` and sets the cookie | 401 `{"error":"invalid_credentials"}` |
| DELETE /api/session | signed in | — | 204 | — |
| GET /api/me | signed in | — | 200 `{"user":{...as above}}` | — |

**Sites and dial**

| Method and path | Who | Request | Success | Endpoint errors |
|---|---|---|---|---|
| GET /api/sites | signed in | — | 200 `{"sites":[{"id","name","time_zone","deposit_cents","cleaning_fee_cents","stations":[{"id","name","rate_cents"}]}]}`: renters and managers get their operator's sites, front desk gets its own site | — |
| GET /api/sites/{site_id}/day?date=YYYY-MM-DD | signed in | — | 200 `{"site_id","date","time_zone","hours":23\|24\|25,"ticks":[{"at","label":"HH:MM","zone"}],"pack_minutes_available":<int\|null>,"stations":[{"id","name","rate_cents","segments":[{"start_at","end_at","state":"booked"\|"held"\|"yours_booked"\|"yours_held","label","booking_id":<id\|null>,"hold_id":<id\|null>,"renter_business":<string\|null>}]}]}` | 422 for a malformed date |

Free time is any time not covered by a segment. The `ticks` list has one entry per local hour that exists that day. Each segment's `label`, and each `slot_taken` blocker's `label`, is the time-state label defined in Feedback states.

**Holds**

| Method and path | Who | Request | Success | Endpoint errors |
|---|---|---|---|---|
| POST /api/holds | renter; front desk and manager with `renter_id` | either `{"station_id","date","start","end","repeat_weeks"?}` or `{"station_id","start_at","end_at"}`, plus `"renter_id"` for staff | 201 `{"hold":<hold>}` | 409 `{"error":"slot_taken","blocker":{"state":"booked"\|"held"\|"yours_booked"\|"yours_held","start_at","end_at","label","date"}}` · 422 validation on `start`, `end`, `start_at`, `end_at`, `date`, `repeat_weeks`, `renter_id` |
| GET /api/holds/{id} | owner renter, staff in scope | — | 200 `{"hold":<hold>}` | — |
| DELETE /api/holds/{id} | owner renter, staff in scope | — | 204 | 409 invalid_transition |
| POST /api/holds/{id}/confirm | owner renter, staff in scope · **Key** | `{"use_pack":bool,"pay_now":bool}` | 201 `{"bookings":[<booking>...],"email":"queued"}` | 410 `{"error":"hold_expired"}` · 409 invalid_transition · 422 `{"error":"certificate_required","dates":[<local date>...]}` · 422 `{"error":"pay_now_required"}` · 422 `{"error":"pack_insufficient"}` · 503 |

`<hold>` is:

```
{"id","status":"held"|"expired"|"confirmed","station_id","site_id","renter_id","created_at","expires_at",
 "occurrences":[{"date","start","end","start_at","end_at","minutes"}],
 "quote":{"pack_minutes_available","pack_minutes","card_minutes","card_cents","deposit_cents"}}
```

**Bookings**

| Method and path | Who | Request | Success | Endpoint errors |
|---|---|---|---|---|
| GET /api/bookings?site_id&date&status | renter (own), staff in scope | — | 200 `{"bookings":[<booking>...]}` | 422 for a malformed filter |
| GET /api/bookings/{id} | owner renter, staff in scope | — | 200 `{"booking":<booking>}` | — |
| GET /api/bookings/{id}/invoice | owner renter, staff in scope | — | 200 `{"booking_id","renter_business","site_name","lines":[{"description","minutes":<int\|null>,"amount_cents"}],"total_cents","paid_cents","refunded_cents","balance_due_cents","terms"}` | — |
| GET /api/bookings/{id}/audit | owner renter, staff in scope | — | 200 `{"events":[{"at","actor_name","actor_role":"renter"\|"front_desk"\|"manager"\|"system","action","from","to","reason":<string\|null>}]}` | — |
| POST /api/bookings/{id}/pay | owner renter · **Key** | `{}` | 200 `{"booking":<booking>}` | 409 invalid_transition (not confirmed, or already paid) · 503 |
| POST /api/bookings/{id}/cancel | owner renter · **Key** | `{}` | 200 `{"booking":<booking>,"refund":{"tier":"full"\|"none","pack_minutes_returned","card_refund_cents","deposit_refund_cents"}}` | 409 invalid_transition · 503 |
| POST /api/bookings/{id}/check-in | front desk, manager | `{}` | 200 `{"booking":<booking>}` | 409 invalid_transition · 409 `{"error":"outside_check_in_window"}` |
| POST /api/bookings/{id}/overrun | front desk, manager · **Key** | `{"minutes":1..240}` | 201 `{"booking":<booking>}` | 409 invalid_transition · 422 minutes · 503 |
| POST /api/bookings/{id}/check-out | front desk, manager | `{}` | 200 `{"booking":<booking>}` | 409 invalid_transition |
| POST /api/bookings/{id}/cleaning-fee | front desk, manager · **Key** | `{}` | 201 `{"booking":<booking>}` | 409 invalid_transition · 409 `{"error":"cleaning_fee_already_charged"}` · 503 |
| POST /api/bookings/{id}/settle | front desk, manager | `{}` | 200 `{"booking":<booking>}` | 409 invalid_transition · 503 |
| POST /api/bookings/{id}/override | manager | `{"action":"cancel_refunded","reason"}` | 200 `{"booking":<booking>,"refund":{...as cancel}}` | 409 invalid_transition · 422 reason · 503 |
| POST /api/holds/{id}/override | manager | `{"action":"release","reason"}` | 200 `{"hold":<hold>}` | 409 invalid_transition · 422 reason |

`<booking>` is:

```
{"id","hold_id","site_id","station_id","station_name","renter_id","renter_business","status",
 "start_at","end_at","local_start":"YYYY-MM-DD HH:MM <zone>","local_end":"YYYY-MM-DD HH:MM <zone>",
 "minutes","pack_minutes","card_minutes","card_cents","deposit_cents","paid":bool,"balance_due_cents","balance_due_by":<utc|null>,
 "policy":{"version_id","notice_hours","effective_from"},"confirmed_at","checked_in_at","checked_out_at",
 "overrun_minutes","overrun_cents","cleaning_fee_cents","terms"}
```

**Packs**

| Method and path | Who | Request | Success | Endpoint errors |
|---|---|---|---|---|
| GET /api/me/pack | renter | — | 200 `{"available_minutes","reserved_minutes","used_minutes","entries":[{"id","movement_id","account":"purchased"\|"available"\|"reserved"\|"used","minutes","reason":"purchase"\|"reserve"\|"release"\|"use"\|"forfeit","booking_id","pack_id","created_at"}]}`, entries newest first | — |
| GET /api/renters/{id}/pack | staff in scope | — | 200, same body | — |
| POST /api/packs | renter · **Key** | `{"product":"20h"}` | 201 `{"pack":{"id","minutes","price_cents"},"available_minutes"}` | 422 product · 503 |

**Renters, documents and reports**

| Method and path | Who | Request | Success | Endpoint errors |
|---|---|---|---|---|
| GET /api/renters?q= | front desk, manager | — | 200 `{"renters":[{"id","name","business","email","home_site_id"}]}`: case-insensitive substring of name, business or email; an empty `q` lists all | — |
| POST /api/renters | manager | `{"name","business","email","phone","password","home_site_id"}` | 201 `{"renter":{...as search, plus "phone"}}` | 409 `{"error":"email_taken"}` · 422 fields (password at least 10 characters) |
| POST /api/documents | renter | `multipart/form-data` with fields `kind` (`liability`\|`food_handler`), `valid_from`, `expires_on`, `file` | 201 `{"document":{"id","kind","valid_from","expires_on","content_type","size_bytes","uploaded_at"}}` | 413 `{"error":"file_too_large","limit_bytes":5000000}` · 415 `{"error":"unsupported_file_type"}` · 422 fields (`expires_on` before `valid_from`, malformed dates, missing file) |
| GET /api/documents?renter_id= | renter (own, parameter ignored); staff in scope (parameter required) | — | 200 `{"documents":[...]}` | — |
| GET /api/documents/{id}/file | owner renter, staff in scope | — | 200 with the stored bytes, the stored content type, `Content-Disposition: inline; filename="<document id>.<pdf\|png\|jpg>"`, `X-Content-Type-Options: nosniff` | — |
| GET /api/dashboard | manager | — | 200 `{"sites":[{"site_id","name","local_date","bookings_today","booked_minutes_today","unpaid_balance_cents","expiring_documents"}],"totals":{"bookings_today","booked_minutes_today","unpaid_balance_cents","expiring_documents"}}` | — |
| GET /api/sites/{id}/utilisation?date= | manager | — | 200 `{"site_id","date","time_zone","day_minutes","stations":[{"station_id","name","booked_minutes","utilisation_percent"}]}` | 422 date |
| GET /api/sites/{id}/utilisation.csv?date= | manager | — | 200 `text/csv; charset=utf-8`: header `station,booked_minutes,day_minutes,utilisation_percent`, then one row per station in station order | 422 date |

**Policies and binder**

| Method and path | Who | Request | Success | Endpoint errors |
|---|---|---|---|---|
| GET /api/sites/{id}/policies | manager | — | 200 `{"versions":[{"id","notice_hours","effective_from","effective_at","created_by_name","created_at"}]}` | — |
| POST /api/sites/{id}/policies | manager | `{"notice_hours":1..168,"effective_from":"YYYY-MM-DD"}` | 201 `{"version":{...}}` | 409 `{"error":"policy_date_taken"}` · 422 fields |
| GET /api/sites/{id}/binder-links | manager | — | 200 `{"links":[<link>...]}` | — |
| POST /api/sites/{id}/binder-links | manager | `{"from","to"}` | 201 `{"link":<link>}` | 422 fields |
| POST /api/binder-links/{id}/regenerate | manager | `{}` | 200 `{"link":<link>}` | 409 invalid_transition (revoked) |
| DELETE /api/binder-links/{id} | manager | — | 204 | — |
| GET /api/binder/{token} | anyone with the token | — | 200 `{"site_name","from","to","generated_at","rows":[{"date","renter_name","business","station","local_start","local_end","liability":{"status":"current"\|"expired"\|"missing","expires_on"},"food_handler":{"status","expires_on"}}]}` | 404 `{"error":"link_not_found"}` |
| GET /binder/{token} | anyone with the token | — | 200 HTML binder page | 404 HTML dead-link page |
| GET /binder/{token}/binder.pdf | anyone with the token | — | 200 `application/pdf` | 404 `{"error":"link_not_found"}` |
| any other method on `/binder/...` or `/api/binder/...` | anyone | — | — | 405 `{"error":"read_only"}` |

`<link>` is `{"id","site_id","from","to","url":"/binder/<token>","expires_at","revoked":bool,"created_at"}`. Binder 404s are checked before the other errors in the precedence order.

### Business rules (DP-02, DP-03, DP-04, DP-05, DP-09, DP-10, DP-11, DP-12, DP-15, DP-16, DP-17, DP-20, DP-21, DP-23, DP-24, DP-25, DP-26, DP-28, DP-29, DP-31, DP-33, DP-35, DP-37, DP-39, DP-41, DP-42, DP-45, DP-46, DP-47)

**Scope.**

- A renter belongs to one operator and one home site, and may book any station of their operator.
- A front-desk lead acts on one site. They see and act on holds and bookings only at stations of that site, and their day dial, counter and booking lists show only that site.
- A front-desk lead searches, picks and books for every renter of their operator, whatever the renter's home site. They may also open those renters' documents and pack.
- A manager acts on every site and every renter of their operator.
- A renter sees and acts on only their own holds, bookings, invoices, audit, ledger and documents.
- Another renter's identifier, or any identifier outside the caller's operator or site scope, answers `not_found`. This applies to nested identifiers in bodies too, such as `station_id` and `renter_id`.
- Staff may open a renter's documents only when the renter is in their operator.
- Search, dashboard totals, utilisation reports and CSVs, dial segment labels and binders include only records inside the caller's scope.
- Dial segments for other renters' time never carry a business name or booking id when a renter is looking. They do carry them for staff.

**Times on 15-minute boundaries.**

- Hold start and end are on quarter hours of local time, or of UTC for the `start_at`/`end_at` form.
- An occurrence lasts 15 minutes to 12 hours, both inclusive.
- An `end` at or before `start` means the next local day.
- Each occurrence must start after the current server time and no more than 365 days ahead.
- `repeat_weeks` is 1 to 12 inclusive and defaults to 1.

**Clock-change rule** (one rule, used everywhere a local time is turned into an instant):

- A local time that does not exist (inside the spring gap) moves forward by the length of the gap. For example, 02:30 becomes 03:30.
- A local time that happens twice (the autumn repeat) means its first, earlier occurrence.
- A booking's `minutes` is always the real elapsed time from `start_at` to `end_at`, and every price, pack movement, ticket, invoice, report and email uses that figure.
- For example, at the Halsted site, Sunday 2026-11-01 01:00–05:00 is 300 minutes (5.00 h), while Sunday 2026-11-08 01:00–05:00 is 240 minutes.
- A local day lasts 1,380, 1,440 or 1,500 minutes.

**Weekly repeats.**

- Occurrence k is the same local start and end on the date k weeks after `date`, each resolved by the clock-change rule.
- One hold covers all occurrences and has one expiry.
- If any occurrence overlaps held or booked time, no hold is created and `slot_taken` names the first conflicting occurrence's blocker and `date`.

**Contested time.**

- At any instant, a station has at most one live hold or booking in a status of confirmed, checked_in, overrun_billed, checked_out or settled covering it. Holds and bookings are half-open intervals, so back-to-back times touching at a boundary do not overlap.
- When several hold requests overlap the same free time at once, exactly one gets 201. Every other request gets `slot_taken`, whose blocker is the winning hold.
- When two confirm requests with different keys race on one hold, exactly one gets 201. The other gets `invalid_transition` and records no payment.

**Hold lifetime.**

- A hold expires `HOLD_TTL_SECONDS` after `created_at`. The default is 600 seconds (ten minutes).
- A hold is live while server time is strictly before `expires_at`. At `expires_at` exactly, it has expired.
- From that instant its time counts as free for new holds. Confirm answers `hold_expired` and charges nothing, both before and after its status reads `expired`. Only the server clock decides.
- Within 15 seconds of expiry the hold's status reads `expired` and one hold-expired email is queued.
- Letting a hold go (owner `DELETE`, or a manager's `release` override) sets it to `expired` immediately and sends no email. Confirm on a hold that was let go or released also answers `hold_expired`.
- Confirm on a hold that is already `confirmed` answers `invalid_transition`.

**Pricing.**

- A station's `rate_cents` is per hour, and every rate is divisible by four cents, so each quarter hour costs a whole number of cents.
- `card_cents` is card_minutes × rate_cents ÷ 60.
- The deposit is the site's `deposit_cents` per booking, charged only when the booking has card minutes.
- Overrun is minutes × rate_cents ÷ 60, rounded half-up to the cent. For example, 40 minutes on a $38.00 station is $25.33.
- The cleaning fee is the site's `cleaning_fee_cents`.
- A hold's `quote` covers all of its occurrences together:
  - `pack_minutes`, `card_minutes` and `card_cents` are totals.
  - `deposit_cents` is the site deposit times the number of occurrences that have card minutes.
  - It is computed as if `use_pack` were true. It uses the renter's available pack balance at the moment the response is built, and covers occurrences in time order as in Confirmation step 3.
  - `pack_minutes_available` is that balance.

**Confirmation.** In this order:

1. The hold must be live when the request arrives.
2. The renter's liability certificate must cover every local date that any occurrence touches.
3. Pack hours apply only when `use_pack` is true. Pack minutes are taken from the server's current available balance, covering occurrences in time order in whole quarter hours. Everything uncovered is card minutes.
   - If `use_pack` is true and the balance covers less than the quote showed, the request still proceeds with the smaller pack share. If the balance is now zero but the quote showed pack minutes, the answer is `pack_insufficient`.
4. For each booking with card minutes, Kill Bill records the deposit. If `pay_now` is true, it also records the time payment.
   - `pay_now` false is allowed only when every such booking's unpaid cutoff is still in the future. Otherwise the answer is `pay_now_required`.
5. In one commit:
   - the hold becomes `confirmed`
   - one booking per occurrence becomes `confirmed`, recording the policy version in force at that moment
   - a `reserve` movement is written for each booking's pack minutes
   - one confirmation email is queued
6. If any Kill Bill call fails, every Kill Bill payment made by this attempt is refused back in full (a REFUND), the hold stays live and unchanged, nothing else is written, and the answer is `billing_unavailable`.

A booking is `paid` when it has no card minutes or Kill Bill holds its time payment. Nothing else sets `paid`.

**Unpaid cutoff.**

- A booking's cutoff is its local start wall-clock time on the local date two days earlier, in the site's zone, resolved by the clock-change rule. For example, a Halsted booking at Sunday 2026-11-01 06:00 CST has its cutoff at Friday 2026-10-30 06:00 CDT, which is 49 elapsed hours earlier.
- `balance_due_by` is that instant.
- At or after the cutoff, a confirmed booking that is still unpaid becomes `unpaid_cancelled` within 60 seconds:
  - its reserved pack minutes return (`release`)
  - its deposit is kept
  - one unpaid notice email is queued

**Booking states.**

| From | Action | To | Who |
|---|---|---|---|
| held (hold) | confirm | confirmed | renter, or staff on the renter's behalf |
| held (hold) | let go / release / expiry | expired | owner, manager, system |
| confirmed | pay | confirmed (paid) | renter |
| confirmed | cancel | cancelled_refunded or cancelled_forfeit | renter |
| confirmed | override cancel_refunded | cancelled_refunded | manager |
| confirmed | cutoff | unpaid_cancelled | system |
| confirmed | check-in | checked_in | front desk, manager |
| checked_in | overrun | overrun_billed | front desk, manager |
| checked_in or overrun_billed | check-out | checked_out | front desk, manager |
| checked_out | cleaning fee | checked_out | front desk, manager |
| checked_out | settle | settled | front desk, manager |

- Any other action from any status answers `invalid_transition` with the current status and the attempted action. The one exception is confirm on an expired hold, which answers `hold_expired` as stated under Hold lifetime.
- Every status change, payment, fee and refund writes one audit event naming the acting user, or `system` for expiry and cutoff.
- Check-in is allowed from 30 minutes before `start_at` (inclusive) until `end_at` (exclusive). Otherwise the answer is `outside_check_in_window`.
- Overrun is allowed once per booking.
- Cleaning fee is allowed once per booking. A second one answers `cleaning_fee_already_charged`.
- Settle refunds the deposit in full through Kill Bill when one was charged.

**Cancellation terms.**

- Each site has policy versions. Each version has `notice_hours` and an `effective_from` local date.
- Its `effective_at` is the later of that date's local midnight and the moment the version was created.
- `effective_from` must be today or later in the site's zone. Two versions on one site may not share a date (`policy_date_taken`).
- A booking keeps the version whose `effective_at` is latest and not after the booking's `confirmed_at`.
- A cancel is **full** when the server time is at or before `start_at` minus that version's notice hours:
  - pack minutes return (`release`)
  - any card time payment is refunded in full
  - the deposit is refunded in full
  - status becomes `cancelled_refunded`
- Otherwise the cancel is **none**:
  - pack minutes move to `used` (`forfeit`)
  - card time paid is kept
  - an unpaid balance is not charged
  - the deposit is kept
  - status becomes `cancelled_forfeit`
- A manager override cancel is always full.
- The booking's terms line (Feedback states) comes from its own version on its detail, ticket, cancel dialog, invoice and confirmation email.

**Hour ledger.**

- Every movement is exactly two entries with opposite signed minutes that sum to zero:
  - purchase: `purchased` → `available`
  - reserve: `available` → `reserved`
  - release: `reserved` → `available`
  - use (at check-out): `reserved` → `used`
  - forfeit: `reserved` → `used`
- `available_minutes`, `reserved_minutes` and `used_minutes` are the sums of each account's entries, computed by the server.
- Entries are never edited or deleted. A correction is a new movement.
- A 20-hour pack purchase records its Kill Bill payment and its purchase movement in one action. If Kill Bill fails, no movement is written.

**Idempotency** (applies to every endpoint marked **Key**):

- The key is 8 to 128 letters, digits, hyphens or underscores, scoped to the signed-in user and the endpoint path, and kept for 24 hours.
- A missing or malformed key answers `idempotency_key_required`.
- Only a 2xx response is stored against its key. Repeating a request that got a 2xx, with the same key and an identical JSON body, returns the stored status and body and performs nothing again.
- Error responses are not stored, including 422 and 503 `billing_unavailable`. Repeating the same key after an error runs the request afresh, so a charge refused during a billing outage goes through when retried after billing returns.
- The same key with a different body, while a 2xx is stored for that key or a request with it is running, answers `idempotency_key_reused`.
- A repeat that arrives while the first request with that key is still running answers `request_in_progress`, and the first request completes once.

**Documents.**

- Accepted files are PDF, PNG or JPEG, judged by the file's leading bytes and never by its name or the declared type. Anything else is `unsupported_file_type`, including SVG, HTML, and a PDF-named file with other contents.
- A file larger than 5,000,000 bytes is `file_too_large`. Exactly 5,000,000 bytes is allowed.
- The original filename is never stored as a path and never forms the storage key.
- A document is valid on every local date from `valid_from` to `expires_on`, both inclusive.
- The certificate gate counts only liability documents whose stored object can be read.

**Expiry reminder.**

- For each document, one reminder email is queued once the local date in the renter's home-site zone is on or after `expires_on` minus 14 days and still on or before `expires_on`.
- It is checked within 60 seconds of upload and at least every 15 seconds after, and never sent twice for the same document.
- A document uploaded with more than 14 days left gets no reminder until the window opens.

**Utilisation.**

- For a site and local date, `day_minutes` is that day's length.
- `booked_minutes` per station is the overlap with that local day of bookings in confirmed, checked_in, overrun_billed, checked_out or settled. Holds and cancelled bookings are excluded.
- `utilisation_percent` is booked ÷ day × 100, rounded half-up to one decimal.
- The dashboard's "today" is each site's own local date.
  - `bookings_today` counts that site's bookings in confirmed, checked_in, overrun_billed, checked_out or settled that overlap today.
  - `booked_minutes_today` sums those bookings' minutes clipped to today, using the same overlap rule as utilisation.
  - `unpaid_balance_cents` sums `balance_due_cents` over that site's confirmed, unpaid bookings whose local start date falls from today through today plus 30 days, inclusive.
  - `expiring_documents` counts documents of renters whose home site is that site and whose `expires_on` falls from today through today plus 14 days, inclusive. Documents that have already expired are not counted.
  - `totals` are the sums over the listed sites.

**Binder links.**

- `from` and `to` are local dates, with `from` on or before `to`, covering at most 31 days inclusive.
- A link works while server time is strictly before `expires_at`, which is `BINDER_LINK_TTL_SECONDS` after creation (default 604,800 seconds, seven days), and while it is not revoked.
- Regenerating issues a new token and a new `expires_at`, and the old token stops working at once.
- Revoking stops the current token at once.
- The binder lists every booking in confirmed, checked_in, overrun_billed, checked_out or settled at that site within the range, one row per booking and date touched, with each document's status on that date.
- A renter's status for a document kind on a date is decided as follows:
  - `current` when at least one document of that kind with a readable stored object covers the date. Its `expires_on` is the latest `expires_on` among those documents.
  - Otherwise `expired` when a document of that kind has `expires_on` before the date. Its `expires_on` is the latest such date.
  - Otherwise `missing`, including when the only documents start after the date. Its `expires_on` is null.
- It never includes phone numbers, email addresses, amounts, payment state, or any other site's data.

**Override reasons.** A reason is 5 to 500 characters and is recorded in the audit event with the manager's name.

### Services (DP-09, DP-11, DP-13, DP-20, DP-24, DP-25, DP-31, DP-34, DP-38, DP-39, DP-43, DP-49, DP-50)

**Kill Bill** (tenant from `KILLBILL_API_KEY` and `KILLBILL_API_SECRET`, currency USD):

- **Accounts:** each renter has one account with external key `hs-renter-<renter id>`, the renter's name and email, and a default payment method on Kill Bill's built-in `__EXTERNAL_PAYMENT__` plugin. The account is created no later than that renter's first charge.
- **Payments:** every charge is a PURCHASE on the renter's account, with amounts in dollars:

  | Charge | Payment external key |
  |---|---|
  | pack | `hs-pack-<pack id>` |
  | booking time | `hs-booking-<booking id>` |
  | deposit | `hs-deposit-<booking id>` |
  | overrun | `hs-overrun-<booking id>` |
  | cleaning fee | `hs-cleaning-<booking id>` |

- **Refunds:** every refund is a REFUND transaction on the payment it returns, for its full amount. This covers time and deposit refunds on cancel, deposit refunds on settle, and the undo of a failed confirmation.
- **Truth:** a repeated request never produces a second PURCHASE or REFUND for the same external key. The app shows a booking as paid only when Kill Bill holds its `hs-booking-` PURCHASE.

**Mailpit** (SMTP at `SMTP_HOST`:`SMTP_PORT`). Every message is plain text with the From line taken from `MAIL_FROM`, which the environment sets to `Hearthshift <bookings@hearthshift.test>`, and is sent to exactly one renter's email. No message names any other renter. These are the only messages the app sends:

| Email | Subject | Body | Sent |
|---|---|---|---|
| Confirmation | "Booking confirmed: <station name> on <local date>" for one date, or "Booking confirmed: <station name>, <n> dates from <local date>" for a series | site name; per booking: local date, start and end with `<zone>`, `<hours>`, pack hours, card amount charged now, deposit, any balance and its due time; the terms line | once per successful confirmation |
| Hold expired | "Hold expired: <station name> on <local date>" | — | once per hold that expires by time |
| Unpaid cancellation | "Booking cancelled: balance unpaid for <station name> on <local date>" | the cutoff time and that the deposit was kept | once per cutoff cancellation |
| Expiry reminder | "Your liability certificate expires on <local date>" or "Your food handler card expires on <local date>" | — | once per document |

**MinIO** (bucket `S3_BUCKET`):

- Each document is stored at `renters/<renter id>/documents/<document id>`, with the detected content type, before the upload answers 201.
- Each binder PDF is stored at `sites/<site id>/binders/<link id>.pdf`, generated when the link is created and regenerated when the link is regenerated.
- The bucket stays private. Files reach browsers only through the app's authorised routes.

**When a service is down.** Startup and recovery are covered under Server boundary. While Kill Bill is unreachable:

- /api/status reports `"billing":"delayed"`.
- Every action that needs Kill Bill answers `billing_unavailable` and changes nothing. This covers card confirmation, pay balance, pack purchase, overrun, cleaning fee, card cancellation refunds, settle with a deposit, and override refunds.
- Pack-only confirmations and cancellations, check-in and check-out still work.

While Mailpit is unreachable:

- /api/status reports `"mail":"delayed"` and the number of queued emails.
- Every action still succeeds and its email is queued. Each queued email adds exactly one to `queued_emails` and stays queued, never dropped or marked sent, until mail is reachable.

### Seed data (DP-01, DP-09, DP-12, DP-20, DP-45, DP-46, DP-52)

Every person, business, phone number and address below is invented. On every start, the app creates any of these records that are missing in Postgres and MinIO, so they are present after a fresh database or bucket.

**Operators and sites**

| Operator | Site id | Site name | Time zone | Deposit | Cleaning fee | Policy at start |
|---|---|---|---|---|---|---|
| Ember Row Kitchens (`op-ember`) | `site-halsted` | Ember Row — Halsted | America/Chicago | $75.00 | $35.00 | 24 hours from 2026-01-01 |
| Ember Row Kitchens | `site-corktown` | Ember Row — Corktown | America/Detroit | $75.00 | $35.00 | 24 hours from 2026-01-01 |
| Cedar Commons (`op-cedar`) | `site-fremont` | Cedar Commons — Fremont | America/Los_Angeles | $60.00 | $30.00 | 48 hours from 2026-01-01 |

**Stations** (id, name, hourly card rate):

- Halsted: `st-deck-1` Deck oven 1 $38.00; `st-deck-2` Deck oven 2 $38.00; `st-range-a` Range line A $32.00; `st-prep-3` Prep table 3 $20.00; `st-walkin-4` Walk-in shelf 4 $6.00.
- Corktown: `st-ct-deck` Deck oven $36.00; `st-ct-range` Range line $30.00; `st-ct-prep` Prep table $18.00.
- Fremont: `st-fr-deck` Deck oven $40.00; `st-fr-range` Range line $34.00; `st-fr-prep` Prep table $22.00.

**Hour pack product.** `20h`: 1,200 minutes for $560.00, usable on any station of the renter's operator.

**Users.** Every seeded password is `hearth-demo-2026`.

| Email | Name | Role | Scope |
|---|---|---|---|
| odile@emberrow.test | Odile Marchetti | manager | Ember Row Kitchens |
| desk.halsted@emberrow.test | Priya Lindqvist | front_desk | Ember Row — Halsted |
| desk.corktown@emberrow.test | Marcus Feld | front_desk | Ember Row — Corktown |
| wen@cedarcommons.test | Wen Hollis | manager | Cedar Commons |
| desk@cedarcommons.test | Ada Moreno | front_desk | Cedar Commons — Fremont |

**Renters**

| Renter id | Email | Name | Business | Phone | Home site | Liability certificate | Food handler card | Pack at start |
|---|---|---|---|---|---|---|---|---|
| `rn-juniper` | tamsin@junipercrumb.test | Tamsin Okoro | Juniper Crumb Bakery | +1-312-555-0141 | Halsted | 2026-01-01 to 2030-12-31 (PDF) | 2026-01-01 to 2030-06-30 (PNG) | purchased 1,200; used 360; reserved 240; available 600 |
| `rn-saltbox` | rafa@saltboxtacos.test | Rafa Quintero | Saltbox Tacos | +1-312-555-0172 | Halsted | 2026-01-01 to 2030-12-31 (PDF) | 2026-01-01 to 2030-12-31 (PDF) | none |
| `rn-ledger` | june@littleledger.test | June Abernathy | Little Ledger Meal Prep | +1-313-555-0118 | Corktown | none | 2026-01-01 to 2030-12-31 (PDF) | none |
| `rn-nightjar` | ike@nightjarpies.test | Ike Brennan | Nightjar Pies | +1-312-555-0190 | Halsted | 2025-02-01 to 2026-01-31 (PDF, expired) | 2026-01-01 to 2030-12-31 (PDF) | none |
| `rn-fennel` | noor@fennelfig.test | Noor Haddad | Fennel & Fig Catering | +1-510-555-0133 | Fremont | 2026-01-01 to 2030-12-31 (PDF) | 2026-01-01 to 2030-12-31 (PDF) | purchased 1,200; reserved 240; available 960 |

The Ember Row renters belong to Ember Row Kitchens, and Fennel & Fig belongs to Cedar Commons. Seeded pack figures are minutes, recorded as ledger movements:

- Juniper Crumb has one purchase of 1,200, one reserve and use of 360 for a past settled booking `bk-seed-juniper-0`, and one reserve of 240 for `bk-seed-juniper-1`.
- Fennel & Fig has one purchase of 1,200 and one reserve of 240 for `bk-seed-fennel-1`.

Seeded documents are small generated files stored in MinIO.

**Bookings.** Each booking is created on the site's local date following the day the database was seeded:

- `bk-seed-juniper-1`: Juniper Crumb Bakery, Deck oven 1, Halsted, 04:00–08:00, confirmed, fully pack-paid.
- `bk-seed-fennel-1`: Fennel & Fig Catering, Deck oven, Fremont, 05:00–09:00, confirmed, fully pack-paid.

`bk-seed-juniper-0` is settled and dated 2026-10-01, Deck oven 1, 04:00–10:00. No seeded booking has a Kill Bill payment, and Kill Bill accounts for seeded renters are created at their first charge. No binder links, holds or queued emails exist at start.

## Technical requirements

### Deployment (DP-51)

- **Runtime:** Node.js 22 with npm is available. The server and browser code are TypeScript.
- **Run manifest:** the app ships `/app/run.json` with string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- **Port:** `serve` listens on `0.0.0.0` at port 4173, or at `APP_PUBLIC_PORT` when it is set.
- **Health:** `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` as soon as the server accepts requests, including while Kill Bill or Mailpit is down.
- **Schema:** the database schema and seed data are applied idempotently on every serve, not only at build.

### Configuration and secrets (DP-58)

Read at start from the environment and never hard-coded, logged, or sent to the browser:

| Service | Variables |
|---|---|
| Postgres | `DATABASE_URL` |
| Kill Bill | `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` (the From line, set by the environment) |
| App | `APP_PUBLIC_PORT`; `HOLD_TTL_SECONDS` (default 600); `BINDER_LINK_TTL_SECONDS` (default 604800) |

The session signing secret is generated at start when not supplied. `MAILPIT_URL` may be present and is not needed by the app.

### Server boundary (DP-48, DP-59)

- **Body limits:**
  - JSON bodies may be up to 64,000 bytes. Larger answers `413 {"error":"body_too_large"}`.
  - A non-JSON content type on a JSON endpoint answers `415 {"error":"unsupported_media_type"}`.
  - Multipart upload requests may be up to 5,100,000 bytes in total. Larger answers `413 {"error":"body_too_large"}`. The file's own limit is in Business rules.
- **Same origin only:**
  - The server sends no CORS allowance headers.
  - Any POST, PUT, PATCH or DELETE carrying an `Origin` header that differs from the app's own origin answers `403 {"error":"cross_origin"}` before any other check.
  - Every response carries `X-Content-Type-Options: nosniff`.
- **Never served:** source files, source maps of server code, `package.json`, lockfiles, `run.json`, `.env` files or any credential. A request for any of these answers 404.
- **A dependency down at boot:**
  - The app starts and serves even when Kill Bill or Mailpit is unreachable at boot.
  - It re-checks each service at least every 15 seconds.
  - Within 30 seconds of the service becoming reachable again, without a restart, /api/status reports `"ok"`, card actions work, and every queued email is delivered exactly once.
- **Background work:** queued emails, hold expiry, unpaid cutoffs and reminders run inside the serving process and survive a restart, because their state lives in Postgres.

### Browser support and performance (DP-54)

- **Browsers:** current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800.
- **Load:** Board is usable, with the dial drawn and the rings focusable, within three seconds of navigation on the seed data.
- **Dragging:** during a drag the arc follows the pointer without visible lag, and each snap shows within a tenth of a second.
- **Live data:**
  - The dial refreshes segments on load, after each of the user's own hold, confirm, cancel or release responses, and at least every 10 seconds, so other renters' holds and bookings appear within 10 seconds.
  - Pack balances refresh after every response that moves hours.
  - The service banner polls status at least every 10 seconds.

## Working rules

- IF-01: `/app/run.json` is a JSON object with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its name, version and licence, and each bundled font and icon set. Shipped packages are the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Shipped packages, fonts and icons use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1 licences.
- IF-04: No datastore beyond the provided Postgres and MinIO is used: no SQLite, Redis, embedded database, or application state kept in local files.
- IF-05: The provided service definitions and their seeded credentials are left unchanged.
- IF-06: All application source is TypeScript compiled with `"strict": true` in `tsconfig.json`.
- IF-07: The browser loads every script, style, font and icon from the app's own origin, with no third-party CDN.

## Engineering standards

- The TypeScript is idiomatic and strictly typed, with no `any` escape hatches. Names use this brief's domain terms (hold, booking, station, pack movement, policy version, cutoff, binder link).
- Each domain rule is decided in exactly one place in the source:
  - the booking state transitions
  - the clock-change resolution
  - the unpaid cutoff
  - the refund tier
  - the pack balance
  - the overlap check
- There is no abstraction with only one implementation, and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Every API error is produced in the one error shape from the API section.
- The browser never recomputes server-derived values such as pack balances, payment state or refund tiers. It renders what the server returns.
- There are no features, screens, endpoints or settings beyond this brief.
