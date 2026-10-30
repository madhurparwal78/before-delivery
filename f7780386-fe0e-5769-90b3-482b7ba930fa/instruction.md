# Pilotlight Works Passboard

Passboard is a booking, compliance and billing desk for one shared-use commercial kitchen. The kitchen rents prep stations, ovens, kettles and cold-storage shelves by the hour to small food businesses. In Passboard the kitchen operator, member food businesses and their crew cooks share one live "line board" of stations and hours. Members paint production runs onto it, pay from prepaid hour packs or by the hour, and keep their insurance and food handler cards on file. A health inspector opens a read-only compliance packet through a link the operator issues. Each service has one job:

- PostgreSQL is the only system of record.
- Kill Bill holds every member's billing account, charges, payments and credits.
- MinIO stores uploaded certificates and generated packet PDFs.
- Mailpit receives every email the product sends.

Out of scope: self-registration, password reset, more than one kitchen, monthly membership subscriptions, card payment forms, editing stations or prices in the product, and any datastore beyond the provided PostgreSQL database and MinIO bucket.

## Problem and users

An independent shared kitchen rents its equipment to 20 to 60 caterers, food trucks, bakers and meal-prep brands. Today the operator stitches the day together from four places:

- a shared calendar
- a group text thread
- a folder of insurance certificates and food handler cards that nobody checks for expiry
- invoices kept by hand

The failures cost real money:

- Two members arrive for the same convection oven at 6 a.m.
- The cleaning turnover between bookings shrinks to nothing.
- A member's liability insurance lapses weeks before a health inspection.
- Prepaid hour packs drift away from the hours actually used.
- Late-cancellation fees turn into arguments over whose "48 hours" counts.

Every lost or double-booked shift is also a catering order a member cannot fill.

- **Kitchen operator** (daily): keep every station booked, turned over and cleaned between uses, paid for and inspection-ready. Review and approve each member's documents, correct hour balances, waive fees when fair, export usage and hand inspectors a packet.
- **Member food business** (weekly): claim the stations and hours a production run needs, spend prepaid hours before paying overage, and keep liability insurance and crew food handler cards approved so bookings are never blocked.
- **Crew cook** (weekly): see the shifts their member business booked and check in under their own food handler card.
- **Health inspector** (occasional): open a read-only compliance packet that shows who used the kitchen on which days and whether their certificates were valid on those days.

## Journeys

1. **An early oven run.**
   - Start: Rosa Delgado of Rosa's Tamal Cart is signed out. Her business has prepaid hours and approved insurance.
   - She signs in and lands on the line board for the kitchen's today.
   - She moves to a future date and drags across the Convection Oven 1 row from 06:00 to 09:00. A ticket-yellow band follows her pointer with a hatched cleaning tail on its right end. The tag at the band's end rolls to the duration and the cost in prepaid hours.
   - She releases. The band flies up into the ticket rail as a paper ticket with a hold countdown.
   - She opens the ticket in the right-hand drawer and confirms.
   - End: the ticket reads confirmed, her prepaid balance has dropped by the booked hours, and a confirmation email is in her inbox.
2. **Two members, one 5 a.m. slot.**
   - Start: Rosa and Owen Mbeki of Northside Crumb Co. both have the same date open on the board.
   - Both paint Deck Oven from 05:00 at the same moment.
   - End: one of them holds a ticket. The other's band shakes once and clears, and the page names the station and time they lost. Neither can see who won.
3. **Changing plans.**
   - Start: Rosa has two confirmed bookings, one four days away and one tomorrow.
   - She opens the first in the drawer. The drawer says cancellation is free until a stated kitchen time. She cancels, and her prepaid hours come back.
   - She opens the second. The drawer warns of a late-cancellation fee. She cancels anyway and the fee is billed.
   - The operator, Ines Albrecht, waives that fee from the members screen.
   - End: Rosa's ledger, her invoices and two cancellation receipts all agree.
4. **Keeping papers current.**
   - Start: Lakefront Meal Prep's insurance has expired, so Priya Natarajan's attempt to hold a slot is refused with a pointer to Documents.
   - She uploads a new certificate PDF with its expiry date. It shows as waiting for review.
   - Ines approves it from the review queue.
   - End: Priya can hold and confirm again. Fourteen and three days before the new expiry date, Priya receives one warning email each.
5. **Shift day.**
   - Start: Tomás Reyes, a crew cook for Rosa's Tamal Cart, signs in on the morning of a booked shift.
   - His shift list shows the booking with a check-in control. Within the check-in window he checks in under his approved food handler card.
   - End: the booking reads checked in for him, Rosa and Ines.
   - His colleague Lena Park tries the same and is told her card is not current.
6. **Inspection visit.**
   - Start: Ines creates a compliance packet link covering last week, with an expiry time, and copies the link.
   - The inspector opens it without signing in. They see each day's visits: the business, station, times, crew, and whether insurance and food handler cards were valid that day. They download the same content as a PDF.
   - Ines revokes the link after the visit.
   - End: the old link shows that it is not valid.
7. **Billing goes quiet.**
   - Start: Kill Bill becomes unreachable.
   - Owen confirms a booking that needs an overage charge. The booking is confirmed and marked payment pending for both him and Ines, and a banner explains it.
   - End: when billing returns, the charge and its payment are recorded and the booking turns paid, without anyone restarting the app.
8. **Month end.**
   - Start: Rosa buys a 10-hour pack and her balance rises.
   - Ines opens Rosa's ledger, where every line is a pair of entries that sums to zero. She adds a one-hour goodwill adjustment with a reason, then reverses a mistaken one.
   - She checks the daily usage totals and exports the monthly usage CSV for billing review and the health department.
   - End: business names that start with formula characters arrive in the spreadsheet as plain text.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Role sign-in** Seeded operators, members and crew cooks sign in with email and password, land on their role's home screen, and can sign out again.
- **DP-02 — One server clock in kitchen time** The server keeps a single clock, real or started from `PASSBOARD_NOW`, and reports now, the kitchen's today and its published settings in the kitchen's time zone.
- **DP-03 — Shared board shows occupancy only** A member's or crew cook's board shows other members' holds, bookings and cleaning tails only as anonymous occupied spans.
- **DP-04 — Member records stay private** Holds, bookings, invoices, documents, files and ledgers belonging to another member answer 404 to a member or crew cook.
- **DP-05 — Paint the line** A member drags across a station row to see the band, cleaning tail, conflicts and cost, and releasing places a server hold that appears as a ticket in the rail.
- **DP-06 — One hold wins each cell** Of several simultaneous hold requests that share any 15-minute cell, cleaning tails included, exactly one succeeds and the rest answer the slot-taken conflict.
- **DP-07 — Hold placement rules** A hold sits on the 15-minute grid inside board hours with its cleaning tail, starts no earlier than now and at most 28 days ahead, and needs the member's insurance to cover its date.
- **DP-08 — Hold expiry edge** A hold is live strictly before its server expiry instant, set by `PASSBOARD_HOLD_SECONDS`, and from that instant it cannot be confirmed, resized or released and its cells are free.
- **DP-09 — Resize and release holds** A member can move a live hold's end time, re-checked for collisions without changing its expiry, or release it and free its cells at once.
- **DP-10 — Keyboard line board** Arrow keys, Shift+Arrow, Enter and Escape paint, extend, place, open, confirm and release holds on the line board with the same server results as pointer painting.
- **DP-11 — Lost-slot notice** When the server reports another member won the slot, the band shakes once (or shows a static red edge under reduced motion), clears, and the Updates region names the lost station and time.
- **DP-12 — Confirm a booking** From the ticket drawer a member confirms a live hold, the ticket becomes a confirmed booking, the prepaid balance updates and a confirmation email arrives.
- **DP-13 — All-or-none confirmation** Confirmation succeeds only when the hold is live, the member's liability insurance is approved and covers the booking date, and the cost is covered as qualified in Business rules, otherwise nothing changes.
- **DP-14 — Prepaid hours first, then overage** A booking spends prepaid hours first and bills the remainder at the station's hourly rate as a paid Kill Bill charge on the member's account.
- **DP-15 — Retry-safe requests** A repeated POST with the same `Idempotency-Key` returns the stored response without repeating any effect, and the same key with a different request answers 422.
- **DP-16 — One email per change** Booking confirmations, cancellation receipts, invoice notices and expiry warnings are each sent exactly once per state change, even under retries and replays.
- **DP-17 — Cancel from the drawer** A member cancels a confirmed booking from its drawer after seeing the fee terms, and the board, balance and a cancellation receipt reflect the result.
- **DP-18 — Cancellation cutoff in kitchen time** Cancellation is free up to and including the same kitchen clock time two calendar days before the start, computed in the kitchen's time zone whatever the browser's zone.
- **DP-19 — Late-cancellation fee** A cancellation after the cutoff becomes cancelled_with_fee, still returns prepaid hours once, and bills a fee of half the booking's list price to the member in Kill Bill.
- **DP-20 — Fee waiver** The operator can waive a late-cancellation fee once, which records a matching Kill Bill credit or drops the still-pending charge.
- **DP-21 — Buy an hour pack** A member buys a published hour pack, Kill Bill records the charge and its payment, and the hours appear in the balance and the ledger.
- **DP-22 — Paired hours ledger** Every movement of prepaid hours is one transaction of two entries that sum to zero, and each member's balance always equals the sum of that member's entries.
- **DP-23 — Corrections by adjustment and reversal** The operator adjusts a member's hours with a reason and corrects mistakes only by reversing a transaction, never by editing or deleting one.
- **DP-24 — Operator-only actions** Document review, fee waivers, hour adjustments and reversals, usage reports, exports and packet links answer 403 to members and crew cooks.
- **DP-25 — File a certificate** A member uploads liability insurance or a crew cook's food handler card with its expiry date, sees it waiting for review, and the operator approves or rejects it from the review queue.
- **DP-26 — Accepted file types and sizes** Uploads are judged by their content as PDF, PNG or JPEG of at most 5,000,000 bytes, and anything else, oversized, empty or with a path-like name is refused with nothing stored.
- **DP-27 — Stored files served inertly** Uploaded files are served only to permitted users, as downloads the browser never renders as active content.
- **DP-28 — Document review states** A document moves from uploaded to approved or rejected once, an approved document reads expired after its validity ends, and any other move answers 409.
- **DP-29 — Valid through the expiry date** A document covers every booking dated on or before its expiry date, through the end of that day in kitchen time, and no booking dated later.
- **DP-30 — Expiry warning emails** The member receives one warning email 14 days and one 3 days before each approved document expires, as qualified in Business rules.
- **DP-31 — Payment pending while billing is down** With Kill Bill unreachable, a booking that needs a charge is confirmed as payment_pending and shown so to member and operator, while pack purchases and invoices answer 503.
- **DP-32 — Pending billing settles itself** Once Kill Bill is reachable again, queued charges, payments and credits are recorded within 30 seconds without a restart and every booking still payment_pending turns paid, while one cancelled during the outage reads voided, as qualified in Business rules.
- **DP-33 — Crew shift list** A crew cook sees the upcoming shifts their member business booked, each with its own check-in control.
- **DP-34 — Crew cook limits** A crew cook reads only their own member's bookings and cannot hold, confirm, cancel or buy hours.
- **DP-35 — Crew check-in** A crew cook checks in to their member's booking inside its check-in window under their own approved, current food handler card, moving it to checked_in, and is refused otherwise with an exact reason.
- **DP-36 — Issue an inspector packet** The operator creates a compliance packet link for a date range and copies it, and the inspector opens it without signing in to see the visits and download the PDF.
- **DP-37 — Packet contents** A packet lists each checked-in visit in its date range with business, station, times, crew and whether insurance and food handler cards were valid that day, and its stored PDF carries the same content.
- **DP-38 — Packet link lifecycle** Packet links are unguessable and read-only, stop working at their expiry time, die when revoked, and die when regenerated in favour of a new link.
- **DP-39 — Usage totals and export** The operator's daily usage totals and monthly usage CSV group bookings by kitchen date, and CSV cells starting with = + - @ come out neutralised.
- **DP-40 — Run manifest and health** The app installs, builds and serves from `/app/run.json` on port 4173 or `APP_PUBLIC_PORT` and answers its health check even while a dependency is down.
- **DP-41 — Server boundary** The server accepts only same-origin requests within the published size limits, never serves source or credentials, and recovers from dependencies that were unreachable at boot without a restart.
- **DP-42 — Responsive line board** Every screen fits 375, 768 and 1280 pixel wide viewports without sideways page scrolling, with the board scrolling sideways only inside its own frame.
- **DP-43 — Paint motion and reduced motion** Snap, digit roll, band-to-rail flight, loss shake and drawer slide run at their published timings, and under reduced motion each is replaced by its static substitute.
- **DP-44 — Kitchen-rail look** The board reads as a stainless kitchen rail: steel hairlines on an off-white ground, ticket yellow only on live holds and painting, red only on conflicts and errors, and tabular figures on every time and price.
- **DP-45 — Real services and secrets from the environment** The source reads every credential and URL from the environment and performs every booking, ledger, billing, storage and mail effect against the real service, with no stand-in state.

## Frontend

### Screens and layout (DP-01, DP-05, DP-33, DP-36, DP-42)

Every signed-in screen has the same frame:

- A thin top bar with the kitchen name, the role's main navigation and a sign-out button.
- The two page-level live regions from Feedback states.
- The main content below.

Screens by role:

- **Sign in** (signed out): one centred form with email and password.
- **Board** (member home; operator and crew cook can read it):
  - A heading with the shown date, plus previous-day, next-day and today buttons.
  - The ticket rail, fixed across the top. It holds the member's live holds and their confirmed bookings for the shown date, each as a clipped paper slip, plus the prepaid balance as "Prepaid `<balance>` h".
  - The line board below the rail. Stations are horizontal rows, each with its name pinned at the left. Hours run left to right in 15-minute columns from 05:00 to 24:00, with hour labels across the top.
  - On the kitchen's today, a thin vertical "Now `<HH:MM>`" line marks the current kitchen time.
  - Detail opens in a right-hand drawer, never in a modal over the board.
  - The operator's board shows business names on every span and has no painting.
  - A crew cook's board shows their own member's bookings and anonymous occupied spans, and has no painting.
- **Hours** (member): the balance, buttons for each published pack, and the hours ledger table.
- **Documents** (member and crew cook): the upload form and the table of documents on file. A crew cook sees and uploads only their own food handler card.
- **Invoices** (member): the member's Kill Bill invoices with their line items.
- **Shifts** (crew cook home): the upcoming shifts list with a check-in control on each.
- **Review** (operator home): the queue of uploaded documents waiting for review.
- **Members** (operator):
  - Each member with business name, contact email, balance and insurance status.
  - An "Adjust hours" form per member.
  - The member's ledger with a reverse control on each reversible line.
  - The late-cancellations table with waive controls.
- **Usage** (operator): a date picker with the daily usage table, and a month picker with the CSV export link.
- **Packets** (operator): the new-packet form and the table of packet links.
- **Packet** (public, at `/packet/<token>`): the kitchen name, the covered date range, the visits table and the PDF download link. It has no navigation and no sign-in.

How the screens arrange at each viewport:

- **1280x800:**
  - The rail spans the full width under the top bar.
  - The board fills the rest. Each 15-minute cell is at least 20 px wide and the board scrolls sideways inside its own frame.
  - When open, the drawer docks on the right at about a third of the width and the board narrows beside it.
  - Tables show as tables.
- **768x1024:**
  - The same arrangement, but the drawer takes about half the width.
  - The rail scrolls sideways inside itself when tickets do not fit.
- **375x812:**
  - The navigation collapses behind a "Menu" button.
  - The rail is a single sideways-scrolling strip.
  - The drawer opens as a full-width panel directly below the rail, pushing the board down rather than covering it.
  - The board scrolls sideways inside its frame with a narrow pinned station column.
  - Tables become stacked cards with label and value pairs.
- **All viewports:** the page itself never scrolls sideways. Only the board frame and the rail strip may.

When the board first opens on the kitchen's today, it scrolls to the hour containing now. On any other date it opens at 05:00.

### Public screens and controls (DP-01, DP-05, DP-10, DP-12, DP-17, DP-21, DP-25, DP-33, DP-36, DP-39)

These roles and names are the only public interface. Anything not listed here is free.

| Where | Role and accessible name | Visible copy |
|---|---|---|
| Sign in | `form "Sign in"`, `textbox "Email"`, password field labelled "Password", `button "Sign in"` | "Sign in to Passboard" |
| Every signed-in screen | `navigation "Main"` with links by role: member "Board", "Hours", "Documents", "Invoices"; crew cook "Shifts", "Board", "Documents"; operator "Review", "Board", "Members", "Usage", "Packets" | link text as named |
| Every signed-in screen | `button "Sign out"`; at narrow widths `button "Menu"` (expanded state announced) | "Sign out", "Menu" |
| Every signed-in screen | `status "Updates"` (polite), `alert "Problems"` (assertive) | copy from Feedback states |
| Board | `heading "Line board"` (level 1); `button "Previous day"`, `button "Next day"`, `button "Today"` | the shown date as `<weekday> <day> <month> <year>`, for example "Wed 10 Feb 2027" |
| Board | `status "Billing status"` | the billing banner copy from Feedback states, present only while billing is down |
| Board | `grid "Line board"`; each station row starts with a `rowheader` holding the station name; each cell is a `gridcell` named `<station name>, <HH:MM>, <state>` | hour labels "05:00" to "23:00" |
| Board cell states | `<state>` is one of: `free`, `past`, `occupied`, `your hold`, `your booking`, `painting`, `cleaning tail`, `conflict` | conflict cells show the text "Taken" when they meet a span and "Cleaning clash" when they meet a cleaning tail |
| Board | `status "Paint cost"` on the tag at the band's end, present only while painting or extending | `<h>:<mm> · <prepaid> h prepaid + $<overage>` |
| Board | "Now `<HH:MM>`" line on the kitchen's today | "Now 06:42" style text |
| Rail | `region "My tickets"` containing a `list`; each ticket is a `button` named `Ticket <station name>, <date> <start>–<end>, <ticket state>`, where `<ticket state>` is `hold`, `confirmed` or `payment pending` | slip text: station, `<day> <month>`, `<start>–<end>`, "Payment pending" when it applies |
| Rail | each hold ticket contains `timer "Hold time left"` | `mm:ss` |
| Rail | the prepaid balance | "Prepaid `<balance>` h" |
| Drawer | `complementary "Ticket details"`; `button "Close details"` | station, date, times, "Cleaning until `<tail_end>`", cost lines, status |
| Drawer (hold) | `button "Confirm booking"`, `button "Release hold"` | "Confirm booking", "Release hold" |
| Drawer (confirmed booking) | `button "Cancel booking"`; after it is pressed, `button "Yes, cancel booking"` and `button "Keep booking"` | before the cutoff "Free cancellation until `<date> <HH:MM>`"; after it "Late-cancellation fee: $`<fee>`" |
| Hours | `heading "Hours"`; one `button "Buy <pack name>"` per pack; `table "Hours ledger"` with columns Date, Kind, Hours, Booking | "Balance `<balance>` h", each pack's price beside its button |
| Documents | `form "Upload document"`: `combobox "Document type"` (options "Liability insurance", "Food handler card"), `combobox "Crew cook"`, `textbox "Expires on"`, file field labelled "File", `button "Upload document"` | "PDF, PNG or JPEG, up to 5,000,000 bytes" |
| Documents | `table "Documents on file"` with columns Type, Person, Expires on, Status, File; each row has `link "Download"` | status words "Waiting for review", "Approved", "Rejected", "Expired" |
| Invoices | `table "Invoices"` with columns Date, Items, Amount, Balance | amounts as `$<amount>` |
| Shifts | `heading "Shifts"`; `list "Upcoming shifts"`; per shift `button "Check in: <station name>, <date> <start>"` | after check-in the row reads "Checked in `<HH:MM>`" |
| Review | `table "Documents to review"`; per row `link "Download"`, `textbox "Rejection reason"`, `button "Approve"`, `button "Reject"` | business, type, person, expiry date |
| Members | `table "Members"`; per member `form "Adjust hours"` with `textbox "Hours change"`, `textbox "Reason"`, `button "Adjust hours"`; `table "Member ledger"` with `button "Reverse"` on reversible rows | balances as `<h> h` |
| Members | `table "Late cancellations"`; per row `button "Waive fee"` | business, station, date, fee, fee status |
| Usage | `textbox "Usage date"`, `table "Daily usage"`, `textbox "Export month"`, `link "Export month CSV"` | totals as `<h> h` |
| Packets | `form "New packet"`: `textbox "From"`, `textbox "To"`, `textbox "Link expires at"`, `button "Create packet link"` | "Times are kitchen time (`<time zone>`)" |
| Packets | `table "Packet links"`; per row `button "Copy link"`, `button "Revoke link"`, `button "Regenerate link"` | status words "Active", "Revoked", "Expired" |
| Packet page | `heading "Compliance packet"`; `table "Kitchen visits"` with columns Date, Business, Station, Time, Insurance, Crew and card; `link "Download PDF"` | validity words "Valid" and "Not valid"; for an unusable link, the text "This packet link is not valid." |

Formats used in visible copy:

- `<balance>`, `<prepaid>` and every other hours figure: decimal hours with two decimals, for example "3.75".
- `<h>:<mm>`: a duration, for example "1:30".
- `<overage>`, `<fee>` and every other price: US dollars with two decimals, without thousands separators.
- `<HH:MM>`, `<start>`, `<end>` and `<tail_end>`: 24-hour kitchen-local times. "24:00" appears only as an end.
- `<date>`: a kitchen date as `YYYY-MM-DD`.
- `<day> <month>`: for example "10 Feb".

### Interactions (DP-05, DP-09, DP-10, DP-12, DP-17, DP-33, DP-36)

Painting with a pointer:

1. Pointer down on a `free` cell starts a band in that cell. Pointer down on `occupied` or `past` cells does nothing. Pointer down on your own hold or booking opens it in the drawer.
2. Dragging right or left grows or shrinks the band one 15-minute cell at a time. The band always spans from the anchor cell to the cell under the pointer.
3. The cleaning tail of the station's published length stays attached to the band's right end. A station with a zero-minute tail shows no tail.
4. When the band or tail would meet an occupied span, a past cell or 24:00:
   - The band stops at the last cell that fits.
   - The cells it would hit read `conflict` in red with the label "Taken" or "Cleaning clash".
   - Those cells stay red while the pointer is beyond them.
5. On every snap, the cost tag at the band's end updates to the new duration and cost:
   - Prepaid hours are counted first, from the member's balance as last fetched.
   - Overage is counted at the station's hourly rate.
   - The tag uses the same rule the server applies.
6. Releasing places a hold for the band's span, without any red cells. While the request is pending, the band stays framed. If no cell fits, releasing places nothing.
7. After the server answers:
   - **Success:** the band becomes a ticket in the rail, and the board cells read `your hold` until the hold is confirmed, released or expired.
   - **Lost slot:** the band clears as described in Motion and effects.
   - **Any other refusal:** the band clears and the matching copy appears.
8. On touch screens, a press-and-hold of about half a second starts painting, so a plain swipe still scrolls the board frame. After that, dragging works as with a pointer.

Keyboard:

1. Tab order: skip link to the board, then the top bar, the date buttons, the rail tickets in time order, the grid, and the drawer when it is open.
2. The grid takes one Tab stop. Focus lands on the first `free` cell at or after now on the first station row, or on 05:00 of the first row on other dates.
3. Inside the grid:
   - Arrow keys move the cell cursor. Up and Down change station, Left and Right change cell.
   - The cursor is a visible two-tone frame, never colour alone.
4. Shift+Right or Shift+Left grows or shrinks a selection anchored at the cursor's cell. The selection behaves exactly like a painted band, with tail, conflicts and cost tag.
5. Enter on a selection places the hold. Escape on a selection clears it.
6. When the cursor is on your own live hold:
   - Shift+Right and Shift+Left move the hold's end one cell. Each move goes to the server as a resize.
   - Enter opens the drawer with focus on "Confirm booking".
   - Escape releases the hold.
7. When the cursor is on your own booking, Enter opens the drawer with focus on "Cancel booking".
8. Rail tickets are buttons. Enter or Space opens the drawer for that ticket.
9. The drawer does not trap focus, because it is not a modal. Tab moves through its controls and then back into the page. Escape or "Close details" closes it and returns focus to the cell or ticket that opened it.
10. Every action in the product works from the keyboard alone, with the same results as the pointer.

Drawer and other screens:

- Opening a hold shows its times, cleaning tail, cost split and countdown, with the buttons from the controls table.
- "Cancel booking" reveals an inline question with the fee line and "Yes, cancel booking" or "Keep booking". Nothing is cancelled until "Yes, cancel booking" is pressed.
- On Shifts, "Check in" sends the check-in and updates the row in place.
- On Packets:
  - "Copy link" copies the full packet URL.
  - "Revoke link" and "Regenerate link" act at once and update the row.
  - "Link expires at" is entered as a kitchen-local date and time.
- Board data is fetched on open, after every action, and again every 5 seconds while the board is visible.

### Visual design (DP-44, DP-42)

- **Mood:** a stainless prep line. Utilitarian, urgent where it matters, and readable at arm's length.
- **Colour roles:**
  - The ground is a pale stainless off-white with a faint cool cast.
  - Text and own-booking spans are a near-black ink.
  - A mid steel grey draws the hairline rules between rows and hour columns, the hatching on cleaning tails and anonymous occupied spans, and secondary labels.
  - One ticket yellow appears only on live holds: the painting band, hold tickets and hold frames on the board. It never appears on buttons, links or decoration.
  - One brick red appears only on conflicts, errors and the loss state.
  - Text on yellow is ink. Text on ink is the off-white ground.
- **Type:**
  - Headings, the board date and ticket station names use Big Shoulders Display, a tall condensed signage face.
  - Everything else uses Public Sans.
  - Each heading step is about a quarter larger than the step below it, starting from body text.
  - Every time, duration, countdown, hour figure and price uses tabular (fixed-width) figures, so columns of numbers line up and digits do not jitter as they change.
- **Density:** compact. Spacing follows a small fixed step and its double. Rows are tight but each station row is at least 44 px tall, and every button, link and tap target is at least 44 by 44 px.
- **Composition:**
  - The board is a rigid rail grid with steel hairlines.
  - Tickets in the rail are paper slips with one clipped corner and a fine perforated top edge.
  - Hatched steel marks cleaning, solid ink marks your bookings, framed yellow marks holds, and red marks conflicts. Every state also carries its text label, so colour is never the only signal.
- **Contrast:** all text and meaningful graphics meet WCAG 2.2 AA contrast against their background. Steel grey is used for hairlines, hatching and large labels, never for body text.

### Motion and effects (DP-43, DP-11, DP-05)

All motion starts quickly and settles softly.

- **Colour changes on hover, press and focus:** about a sixth of a second (between 0.12 and 0.2 seconds).
- **Band snap:** as the pointer crosses a cell edge, the band's right end and its tail jump to the next cell in about a sixth of a second, so the band visibly clicks from cell to cell.
- **Digit roll:** on each snap, every digit that changes in the cost tag rolls upward to its new value in about a quarter of a second (between 0.2 and 0.3 seconds). Dragging back rolls the digits back the same way, one snap at a time, and the band shrinks cell by cell.
- **Band-to-rail flight:** when the server confirms the hold, the band lifts and travels up into its slot in the rail over about a third of a second (between 0.28 and 0.4 seconds), arriving as a paper ticket. The board cells keep a ticket-yellow frame until the hold is confirmed, released or expired.
- **Loss shake:** if the server reports the slot was lost, the band shakes sideways once over about a third of a second, then fades out. The Updates region announces the loss copy.
- **Drawer:** slides in from the right over about a quarter of a second and slides back out the same way.
- **Hold expiry:** when a hold's server expiry passes, its ticket and frame fade out in about a quarter of a second, within 2 seconds of the expiry instant, without a reload.
- **Countdown:** the rail timer counts down once per second, from the hold's server expiry minus the server's now. This is a value change, not an animation.
- **Now line:** moves once per minute.
- **No decorative loops.** Nothing moves or pulses while the user is idle except the countdown digits and the minute step of the now line. Nothing is scroll-linked.

With reduced motion requested by the operating system:

- The band still snaps and shows the tail, red conflicts and cost.
- Digits change in place without rolling.
- The band does not fly. The ticket appears in the rail instantly and the board cells show a static yellow frame.
- The loss shake becomes a static red edge around the band's cells for 2 seconds, with the same announced copy.
- The drawer appears and disappears without sliding.
- Expired holds disappear without fading.
- No animation runs on the board, rail or drawer.
- Keyboard painting behaves the same with or without reduced motion.

### Feedback states (DP-11, DP-12, DP-17, DP-21, DP-25, DP-31, DP-35, DP-10)

Every async action follows the same pattern:

- **Pending:** the triggering control is disabled and marked busy, and `status "Updates"` shows the pending copy within a tenth of a second.
- **Success:** replaces the pending copy in `status "Updates"`.
- **Refusal and outage:** shown in `alert "Problems"`, with the control re-enabled.

| Action | Pending | Success | Refusal or outage |
|---|---|---|---|
| Sign in | "Signing in…" | the role's home screen opens | invalid credentials: "Email or password is wrong." |
| Place hold | "Placing hold…" | "Hold placed: `<station>`, `<start>`–`<end>`. Confirm it before the timer runs out." | slot taken (status, not alert): "Another member took `<station>` at `<start>`. Your hold was not placed."; documents not current: "Your liability insurance is not approved and current for `<date>`. Renew it on Documents before booking."; validation: "That slot can't be held. `<reason>`" |
| Resize hold | "Updating hold…" | "Hold now ends at `<end>`." | slot taken: "That change collides with another booking. The hold is unchanged."; hold expired: "This hold has expired." |
| Hold expires (no action) | — | status: "Your hold on `<station>`, `<start>`–`<end>` expired." | — |
| Release hold | "Releasing hold…" | "Hold released." | hold expired: "This hold has expired." |
| Confirm booking | "Confirming booking…" | "Booking confirmed: `<station>`, `<date>` `<start>`–`<end>`." When payment is pending, the same sentence followed by " Payment pending until billing records it." | hold expired: "This hold expired before it was confirmed. Paint the slot again."; documents not current: the place-hold copy |
| Cancel booking | "Cancelling booking…" | free: "Booking cancelled. `<refund>` h returned to your prepaid balance."; late: "Booking cancelled. `<refund>` h returned; late-cancellation fee $`<fee>`." | started: "This booking has already started and can no longer be cancelled." |
| Buy pack | "Buying `<pack name>`…" | "`<pack name>` added. Balance: `<balance>` h." | billing down: "Billing is unreachable right now. No charge was made; try again shortly." |
| Upload document | "Uploading…" | "Document uploaded and waiting for review." | wrong type: "Only PDF, PNG or JPEG files are accepted."; too large: "Files must be 5,000,000 bytes or smaller."; empty: "That file is empty."; bad name: "Rename the file: its name can't contain slashes or two dots in a row."; storage down: "File storage is unreachable. Nothing was saved; try again shortly." |
| Approve or reject | "Saving review…" | "Document approved." or "Document rejected." | already reviewed: "This document was already reviewed." |
| Adjust hours | "Adjusting hours…" | "Hours adjusted. Balance: `<balance>` h." | insufficient: "That would take the balance below zero." |
| Reverse transaction | "Reversing…" | "Transaction reversed. Balance: `<balance>` h." | already reversed: "That transaction was already reversed."; not reversible: "Only adjustments and opening balances can be reversed." |
| Waive fee | "Waiving fee…" | "Late-cancellation fee waived." | nothing to waive: "There is no fee left to waive on this booking." |
| Check in | "Checking in…" | "Checked in for `<station>`, `<start>`–`<end>`." | card: "Your food handler card is not approved and current for this shift."; window: "Check-in opens 15 minutes before the shift starts and closes when it ends." |
| Create packet link | "Creating packet…" | "Packet link created. It expires `<date>` `<HH:MM>`." | storage down: the upload storage-down copy |
| Revoke link | "Revoking link…" | "Packet link revoked." | already revoked: "This link was already revoked." |
| Regenerate link | "Regenerating link…" | "New packet link created. The old link no longer works." | revoked: "A revoked link can't be regenerated." |
| Copy link | — | "Link copied." | — |
| Save business name | "Saving…" | "Business name saved." | length: "Business names are 1 to 80 characters." |
| Invoices screen | "Loading invoices…" | the table | billing down: "Invoices are unavailable while billing is unreachable." |
| Any request with no response | — | — | "Passboard could not reach the server. Nothing changed; try again." |
| Any request answered 401 | — | — | returns to sign in with "Your session ended. Sign in again." |

Placeholders in the table:

- `<reason>` is "It starts in the past." for a past start, "Bookings open 28 days ahead." beyond the window, "The cleaning turnover must finish by 24:00." past closing, or "Pick whole 15-minute cells." off the grid.
- `<refund>` is the prepaid hours returned, with two decimals.

Banners:

- The billing banner in `status "Billing status"` reads "Billing is unreachable. Bookings that need a charge are confirmed with payment pending and settle automatically."
  - It appears on the next board fetch after the server reports billing down.
  - It disappears on the first board fetch after billing is back up.
- Payment-pending bookings show "Payment pending" on their rail ticket, in the drawer, in the crew shift list and on the operator's board. The label clears on the first board fetch after the booking's payment turns `paid` or `voided`.

## Backend

### API (DP-01 to DP-40)

General rules:

- JSON in and out with `Content-Type: application/json`, except uploads (`multipart/form-data`), file downloads, the PDF and the CSV.
- Every `/api` route except `/api/health`, `/api/session` (POST) and `/api/packet/...` needs the session cookie.
- **Error shape.** Every error is `{"error":"<code>"}`. Validation failures are `422 {"error":"validation_failed","errors":{"<field>":"<code>"}}`.
- An unsupported method on a known path answers `405 {"error":"method_not_allowed"}`.
- **Formats:**
  - Instants are ISO 8601 to the second with the kitchen's UTC offset at that instant, for example `2027-02-10T06:00:00-06:00`.
  - Dates are kitchen dates as `YYYY-MM-DD`.
  - Clock times are kitchen-local `HH:MM`. `24:00` is allowed only as an end.
  - Minutes are integers.
  - Money is a string with two decimals in US dollars, for example `"28.00"`.

**Error precedence**, the same for every endpoint, first match wins:

1. Server-boundary rejections from Server boundary.
2. `401 {"error":"unauthenticated"}`.
3. `404 {"error":"not_found"}` for an unknown id or a record outside the caller's scope.
4. `403 {"error":"forbidden"}` for a role that may not perform the action.
5. An idempotent replay returns its stored response.
6. Validation: 422, plus the upload-specific 413 and 415.
7. State conflicts: 409.
8. Dependency outages: 503.

Endpoint lists below name only their own success and extra errors.

Objects:

- **User:** `{"id","name","email","role":"operator"|"member"|"crew_cook","member_id":string|null,"business_name":string|null}`.
- **Hold:**
  - Fields: `{"id","member_id","station_id","date","start","end","tail_end","status":"live"|"confirmed"|"expired"|"released","created_at","expires_at","preview":{"booked_minutes","prepaid_minutes","overage_minutes","overage_amount"}}`.
  - `end` excludes the cleaning tail and `tail_end` is `end` plus the station's cleaning minutes.
  - `preview` uses the member's balance at the moment of the response.
- **Booking:**
  - Fields: `{"id","hold_id","member_id","business_name","station_id","station_name","date","start","end","tail_end","status","payment":"paid"|"payment_pending"|"voided","booked_minutes","prepaid_minutes","overage_minutes","overage_amount","list_amount","free_cancel_until","fee":null|{"amount","status":"pending"|"charged"|"waived"},"check_ins":[{"id","crew_cook_id","crew_cook_name","at","card_document_id"}],"confirmed_at","cancelled_at":string|null}`.
  - `status` is one of `confirmed`, `checked_in`, `completed`, `cancelled_free`, `cancelled_with_fee`.
- **Document:** `{"id","member_id","kind":"liability_insurance"|"food_handler_card","crew_cook_id":string|null,"crew_cook_name":string|null,"expires_on","status":"uploaded"|"approved"|"rejected"|"expired","filename","content_type","size_bytes","uploaded_at","reviewed_at":string|null,"rejection_reason":string|null}`.
- **Transaction:**
  - Fields: `{"id","kind":"opening"|"pack_purchase"|"booking_debit"|"cancellation_refund"|"adjustment"|"reversal","created_at","member_minutes","booking_id":string|null,"reason":string|null,"reverses":string|null,"reversed_by":string|null,"entries":[{"account","minutes"},{"account","minutes"}]}`.
  - `member_minutes` is the signed effect on the member.
- **Packet:**
  - Fields: `{"id","from","to","expires_at","status":"active"|"revoked"|"expired","url":string|null,"token":string|null,"created_at"}`.
  - `url` (`/packet/<token>`) and `token` are present only while active.

Session and people:

- `POST /api/session` with `{"email","password"}`:
  - Success: `200 {"user":User}`, setting the session cookie from Server boundary.
  - Wrong credentials: `401 {"error":"invalid_credentials"}`.
  - Missing fields: `422`.
- `DELETE /api/session`: `204`.
- `GET /api/me`: `200 {"user":User,"balance_minutes":integer|null}`. The balance is set for members only.
- `PATCH /api/members/me` (member) with `{"business_name"}`:
  - Success: `200 {"member":{"id","business_name"}}`.
  - Error: `422` with `business_name: "length"`. The trimmed name must be 1 to 80 characters, inclusive. Any leading character is accepted as typed.
- `GET /api/members` (operator): `200 {"members":[{"id","business_name","contact_email","balance_minutes","liability_insurance":{"status","expires_on"}|null}]}`.

Kitchen, clock and board:

- `GET /api/health`: `200 {"status":"ok"}`, with no authentication.
- `GET /api/kitchen`: `200 {"name","time_zone","now","today","hold_seconds","free_cancel_days":2,"check_in_opens_minutes":15,"booking_days_ahead":28,"board":{"opens":"05:00","closes":"24:00","cell_minutes":15},"stations":[{"id","name","hourly_rate","cleaning_minutes"}],"packs":[{"id","name","minutes","price"}],"billing":"up"|"down"}`.
- `GET /api/board?date=<date>`:
  - The date defaults to the kitchen's today.
  - Success: `200 {"date","today","now","time_zone","billing","stations":[{"id","name","segments":[Segment]}]}`.
  - Error: `422` with `date: "invalid"`.
  - Segment shapes are in Business rules (DP-03).

Holds (member only, otherwise 403):

- `POST /api/holds` with `{"station_id","date","start","end"}`:
  - Success: `201 {"hold":Hold}`.
  - Validation errors: `422` with `station_id: "unknown"`, `date: "invalid"`, `start`/`end: "not_on_grid"`, `end: "end_before_start"`, `end: "outside_board_hours"`, `start: "in_the_past"` or `date: "too_far_ahead"`.
  - Conflicts: `409 {"error":"slot_taken"}` and `409 {"error":"documents_not_current","missing":["liability_insurance"]}`.
- `PATCH /api/holds/:id` with `{"end"}`:
  - Success: `200 {"hold":Hold}`.
  - Validation errors: `422` with the same `end` codes.
  - Conflicts: `409 {"error":"slot_taken"}`, `409 {"error":"hold_expired"}` and `409 {"error":"invalid_transition"}`.
- `DELETE /api/holds/:id`:
  - Success: `204`.
  - Conflicts: `409 {"error":"hold_expired"}` and `409 {"error":"invalid_transition"}`.
- `POST /api/holds/:id/confirm` with `{}`:
  - Success: `201 {"booking":Booking}`.
  - Conflicts: `409 {"error":"hold_expired"}`, `409 {"error":"invalid_transition"}` and `409 {"error":"documents_not_current","missing":["liability_insurance"]}`.

Bookings:

- `GET /api/bookings?from=<date>&to=<date>[&member_id=<id>]`:
  - The range defaults to the kitchen's today through 28 days later, and covers at most 62 days, inclusive.
  - Success: `200 {"bookings":[Booking]}`, scoped by role as Business rules states.
  - Error: `422` with `from`/`to: "invalid"` or `to: "range_too_long"`.
- `GET /api/bookings/:id`: `200 {"booking":Booking}`.
- `POST /api/bookings/:id/cancel` (the owning member or the operator) with `{}`:
  - Success: `200 {"booking":Booking}`.
  - Conflicts: `409 {"error":"invalid_transition"}` and `409 {"error":"booking_started"}`.
- `POST /api/bookings/:id/waive-fee` (operator) with `{}`:
  - Success: `200 {"booking":Booking}`.
  - Conflict: `409 {"error":"invalid_transition"}`.
- `POST /api/bookings/:id/check-ins` (crew cook) with `{}`:
  - First check-in by this cook: `201 {"check_in":{...},"booking":Booking}`.
  - The same cook again: `200` with the same `check_in` and no new record.
  - Conflicts: `409 {"error":"invalid_transition"}`, `409 {"error":"outside_check_in_window"}` and `409 {"error":"food_handler_card_not_current"}`, checked in that order.

Hours and billing:

- `GET /api/ledger[?member_id=<id>]`:
  - Success: `200 {"member_id","balance_minutes","transactions":[Transaction]}`, oldest first.
  - Members read their own ledger, with `member_id` omitted or set to their own id. The operator must pass `member_id`, or gets `422` with `member_id: "required"`.
- `POST /api/packs/:pack_id/purchase` (member) with `{}`:
  - Success: `201 {"transaction":Transaction,"balance_minutes","invoice_id"}`.
  - Billing down: `503 {"error":"billing_unavailable"}`.
- `POST /api/ledger/adjustments` (operator) with `{"member_id","minutes","reason"}`:
  - Success: `201 {"transaction":Transaction,"balance_minutes"}`.
  - Validation errors: `422` with `minutes: "invalid"` or `reason: "length"`. Minutes must be a non-zero multiple of 15 between −6000 and 6000 inclusive. The reason must be 1 to 200 characters.
  - Conflict: `409 {"error":"insufficient_hours"}`.
- `POST /api/ledger/transactions/:id/reverse` (operator) with `{"reason"}`:
  - Success: `201 {"transaction":Transaction,"balance_minutes"}`.
  - Validation error: `422` with `reason: "length"`.
  - Conflicts: `409 {"error":"already_reversed"}`, `409 {"error":"not_reversible"}` and `409 {"error":"insufficient_hours"}`.
- `PUT`, `PATCH` and `DELETE` on any ledger path answer 405.
- `GET /api/invoices[?member_id=<id>]`:
  - Success: `200 {"invoices":[{"id","date","amount","balance","items":[{"description","amount"}]}]}`, read from the member's Kill Bill account.
  - Billing down: `503 {"error":"billing_unavailable"}`.
- `GET /api/invoices/:id`:
  - Success: `200 {"invoice":{...}}`.
  - An invoice on another member's account answers 404.

Documents:

- `POST /api/documents` as `multipart/form-data` with fields `kind`, `expires_on`, `crew_cook_id` (food handler cards only) and `file`:
  - Success: `201 {"document":Document}`.
  - Validation errors: `422` with `kind: "invalid"`, `expires_on: "invalid"`, `expires_on: "already_expired"` (before the kitchen's today), `crew_cook_id: "required"`, `crew_cook_id: "unknown"`, `crew_cook_id: "not_allowed"`, `file: "required"`, `file: "empty"` or `file: "invalid_filename"`.
  - File errors: `413 {"error":"file_too_large"}` and `415 {"error":"unsupported_file_type"}`.
  - Storage down: `503 {"error":"storage_unavailable"}`.
- `GET /api/documents[?status=<status>]`: `200 {"documents":[Document]}`, scoped by role.
- `GET /api/documents/:id`: `200 {"document":Document}`.
- `GET /api/documents/:id/file`:
  - Success: `200` with the stored bytes and the headers from Server boundary.
  - Storage down: `503 {"error":"storage_unavailable"}`.
- `POST /api/documents/:id/approve` (operator) with `{}`:
  - Success: `200 {"document":Document}`.
  - Conflict: `409 {"error":"invalid_transition"}`.
- `POST /api/documents/:id/reject` (operator) with `{"reason"}`:
  - Success: `200 {"document":Document}`.
  - Validation error: `422` with `reason: "length"` (1 to 200 characters).
  - Conflict: `409 {"error":"invalid_transition"}`.

Usage and export (operator):

- `GET /api/usage?date=<date>`:
  - The date defaults to the kitchen's today.
  - Success: `200 {"date","time_zone","stations":[{"station_id","station_name","booked_minutes","cleaning_minutes","bookings"}],"total_booked_minutes"}`.
- `GET /api/exports/usage.csv?month=<YYYY-MM>`:
  - Success: `200` with `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="passboard-usage-<YYYY-MM>.csv"`.
  - Error: `422` with `month: "invalid"`.

Packets:

- `POST /api/packets` (operator) with `{"from","to","expires_at"}`:
  - Success: `201 {"packet":Packet}`.
  - Validation errors: `422` with `to: "before_from"`, `to: "range_too_long"` (more than 31 days, inclusive of both ends), `expires_at: "not_in_future"` or `expires_at: "too_far"` (more than 30 days after now).
  - Storage down: `503 {"error":"storage_unavailable"}`.
- `GET /api/packets` (operator): `200 {"packets":[Packet]}`.
- `POST /api/packets/:id/revoke` (operator):
  - Success: `200 {"packet":Packet}`.
  - Conflict: `409 {"error":"invalid_transition"}`.
- `POST /api/packets/:id/regenerate` (operator) with optional `{"expires_at"}`:
  - Success: `200 {"packet":Packet}` with a new token.
  - Validation errors: `422` with the same `expires_at` codes.
  - Conflict: `409 {"error":"invalid_transition"}`.
  - Storage down: `503 {"error":"storage_unavailable"}`.
- `GET /api/packet/:token` (no session):
  - Success: `200 {"kitchen","time_zone","from","to","generated_at","days":[{"date","visits":[{"business_name","station","start","end","liability_insurance":{"valid":boolean,"expires_on":string|null},"crew":[{"name","checked_in_at","food_handler_card":{"valid":boolean,"expires_on":string|null}}]}]}]}`.
  - Unknown, expired and revoked tokens all answer `404 {"error":"not_found"}`.
  - Any other method answers 405.
- `GET /api/packet/:token/pdf`: `200 application/pdf` as an attachment named `compliance-packet-<from>-to-<to>.pdf`, with the same 404 rule.
- `GET /packet/:token`: the public packet page. An unusable token shows "This packet link is not valid." with HTTP 404.

### Business rules (DP-02 to DP-39)

**Clock and kitchen time (DP-02, DP-18, DP-39).**

- The kitchen's time zone is `America/Chicago`.
- Every server-side notion of now reads one server clock:
  - the kitchen's today and the board's past cells and now line
  - hold expiry and sweeps
  - the booking window
  - the cancellation cutoff
  - the check-in window
  - document and card validity
  - expiry warnings
  - packet link expiry
  - completion
  - the `now` and `today` fields of `/api/kitchen` and `/api/board`
- The database's own clock never decides a business rule.
- The browser shows times and the today line from the server's `now`, kept as an offset measured at each board fetch. It never uses the browser clock or the browser's time zone for a business decision.
- The kitchen's today is the date in the kitchen's zone at the server's now.
- Daily usage totals and the monthly export assign each booking to its kitchen-local date.

**Visibility (DP-03, DP-04, DP-34).**

- A member sees only their own holds, bookings, invoices, documents, files and ledger.
- A crew cook sees only their own member's bookings and their own documents.
- The operator sees everything.
- Any id outside the caller's scope, nested ids included, answers 404 exactly as an unknown id would. This covers a crew cook checking in to another member's booking and a member opening another member's invoice.
- On the board, each station's `segments` depend on who is looking:
  - **Member:** their own live holds as `{"kind":"hold","id","start","end","tail_end","status","expires_at"}`. Their own non-cancelled bookings as `{"kind":"booking","id","start","end","tail_end","status","payment"}`. Everything else as `{"kind":"occupied","start","end"}`, where `end` includes the cleaning tail and nothing else is revealed: no id, member, name or status.
  - **Crew cook:** their member's bookings as above and everything else as occupied.
  - **Operator:** every live hold and non-cancelled booking with `id`, `member_id` and `business_name` added.
- Expired and released holds and cancelled bookings never appear on the board.

**Roles (DP-24, DP-34).**

- Only the operator may:
  - approve or reject documents
  - waive fees
  - adjust hours or reverse transactions
  - read usage, export usage
  - list members
  - create, revoke or regenerate packet links
- Only members may hold, resize, release, confirm or buy packs.
- Members and the operator may cancel.
- Only crew cooks may check in.
- A crew cook may upload only a food handler card for themselves. Any other upload by a crew cook answers 403.
- Every refusal is made by the server, whatever the UI shows.

**Holds (DP-05 to DP-09).**

- A hold covers `start` to `end` plus the station's cleaning tail up to `tail_end`.
- Placement rules:
  - Start and end lie on 15-minute boundaries. End is after start.
  - The span, with its tail, lies within 05:00 to 24:00 of one kitchen date.
  - The start instant is at or after now.
  - The date is no more than 28 days after the kitchen's today.
  - The member's liability insurance covers the date (DP-29), or the request answers `documents_not_current`.
- **One winner per cell.** At most one live hold or non-cancelled booking may cover any station's 15-minute cell, counting each one's cleaning tail. Among concurrent requests that would share a cell, exactly one succeeds and every other one answers `slot_taken`. The same applies to a resize. A member's own holds and bookings count as collisions too.
- **Expiry.** A hold's `expires_at` is its creation instant plus `PASSBOARD_HOLD_SECONDS`.
  - The hold is live while now is strictly before `expires_at`.
  - At `expires_at` exactly and afterwards it is expired: confirm, resize and release answer `hold_expired`, and its cells count as free for new holds.
  - The server marks expired holds within 15 seconds of expiry. Correctness never waits for that sweep.
- **Resize** changes only `end` and keeps `expires_at`.
- **Release** marks the hold `released`.
- Any action on a `confirmed` or `released` hold answers `invalid_transition`.

**Cost (DP-05, DP-14).**

- `booked_minutes` = end − start. The cleaning tail is never charged.
- `prepaid_minutes` = the smaller of `booked_minutes` and the member's balance.
- `overage_minutes` = `booked_minutes` − `prepaid_minutes`.
- `overage_amount` = `overage_minutes` ÷ 60 × the station's hourly rate, rounded half up to the cent.
- `list_amount` = `booked_minutes` ÷ 60 × the hourly rate, rounded the same way.
- The board's live cost tag and the hold preview use the balance as last fetched. Confirmation recomputes from the balance at that moment.
- For example, with the seed data at start:
  - Rosa painting Convection Oven 1 from 06:00 to 09:00 sees "3:00 · 3.00 h prepaid + $0.00".
  - Rosa painting 07:00 to 14:00 sees "7:00 · 6.00 h prepaid + $28.00".

**Booking states (DP-12, DP-13, DP-17, DP-19, DP-35).**

- Confirming a hold creates a booking in `confirmed`, with payment `paid` or `payment_pending`. The hold becomes `confirmed`.
- **All-or-none confirmation.** Confirmation commits as one step or not at all. It requires:
  1. The hold is live.
  2. The member's liability insurance covers the booking date.
  3. The cost is covered: prepaid minutes are debited, and any overage is charged and paid in Kill Bill.
- When Kill Bill is unreachable, the overage is queued as described in Services, and the booking is confirmed with payment `payment_pending`. It does not count as paid until Kill Bill records the payment, then turns `paid`, unless it is cancelled first, as described under Cancellation cutoff and fee.
- A booking with no overage is `paid` at once.
- A failed confirmation leaves the hold, the ledger and Kill Bill unchanged.
- A second confirm of the same hold answers `invalid_transition`, unless it is an idempotent replay.
- Transitions:
  - `confirmed` → `checked_in` on the first successful check-in.
  - `checked_in` → `completed` once now is at or after the booking's end, judged when the booking is read and by a sweep at least every 15 seconds.
  - `confirmed` → `cancelled_free` or `cancelled_with_fee` by cancellation while now is before the start.
- A confirmed booking with no check-in stays `confirmed` after its end.
- Cancelling at or after the start of a still-`confirmed` booking answers `booking_started`.
- Cancelling a booking in any other status answers `invalid_transition`.
- Payment has exactly two moves, both out of `payment_pending`:
  - to `paid` when Kill Bill records the overage payment
  - to `voided` when the booking is cancelled before that payment is recorded
- `paid` and `voided` are final. No other payment move exists.
- Concurrent cancellations of one booking: exactly one succeeds and the rest answer `invalid_transition`.

**Cancellation cutoff and fee (DP-18, DP-19, DP-20).**

- `free_cancel_until` is the same kitchen wall-clock time two calendar days before the booking's start, in the kitchen's zone. Across a daylight-saving change this is 47 or 49 real hours, not 48.
- Cancelling while now is at or before `free_cancel_until` gives `cancelled_free`. Cancelling later gives `cancelled_with_fee`.
- Both outcomes return the booking's `prepaid_minutes` once, as one `cancellation_refund` transaction, and credit back any recorded overage payment in Kill Bill.
- Cancelling a booking whose payment is still `payment_pending` drops its queued overage charge and payment, so neither ever reaches Kill Bill and no refund credit is recorded, and sets its payment to `voided`. `voided` means nothing is owed for the booked time. Any late-cancellation fee is billed separately as below.
- A late cancellation also sets `fee.amount` to half of `list_amount`, rounded half up to the cent, and bills it to the member in Kill Bill. The fee status is `charged` once recorded and `pending` while billing is unreachable.
- Waiving is allowed once, on a `cancelled_with_fee` booking whose fee is `pending` or `charged`:
  - It sets the fee status to `waived`.
  - A `charged` fee gets a matching Kill Bill credit.
  - A `pending` charge is dropped, so it never reaches Kill Bill.
  - Any other waive answers `invalid_transition`.
- For example, a late cancellation of a 3-hour Convection Oven 1 booking carries a $42.00 fee.

**Prepaid hours ledger (DP-14, DP-21, DP-22, DP-23).**

- Every movement of prepaid hours is one transaction holding exactly two entries whose minutes sum to zero:
  - one entry on the member's account `member:<member id>`
  - one on a kitchen account: `kitchen:issued` for opening balances, pack purchases and adjustments, or `kitchen:used` for booking debits and cancellation refunds
- A member's `balance_minutes` always equals the sum of their entries. The balance never goes below zero: an adjustment or reversal that would do so answers `insufficient_hours`.
- Transaction kinds:
  - `booking_debit` is written at confirmation, only when `prepaid_minutes` > 0.
  - `cancellation_refund` is written exactly once per cancelled booking, only when its `prepaid_minutes` > 0.
  - `pack_purchase` is written only after Kill Bill has recorded the pack's payment.
  - `adjustment` is the operator's signed change, with a reason.
- Transactions are never edited or deleted. A mistake is corrected only by a `reversal`: a new transaction mirroring the original, with `reverses` set and the original's `reversed_by` set.
  - Only `adjustment` and `opening` transactions can be reversed. Others answer `not_reversible`.
  - A second reversal of the same transaction answers `already_reversed`.

**Documents (DP-25, DP-28, DP-29, DP-30).**

- A member's required document for booking is an approved `liability_insurance` document.
- A crew cook's required document for check-in is their own approved `food_handler_card`.
- A document counts as on file only once its object is stored and its record is written. A failed store leaves no record.
- Transitions:
  - `uploaded` → `approved` or `rejected` by the operator, once. A rejection keeps its reason.
  - `approved` reads `expired` once its validity has ended.
  - Approving or rejecting any document that is not `uploaded` answers `invalid_transition`. A new certificate is a new upload.
- **Coverage.** A document is valid through 23:59:59 kitchen time on its `expires_on` date. It covers any instant before 00:00 kitchen time on the following date.
  - It covers a booking whose kitchen date is on or before `expires_on`, because every booking ends by 24:00 of its date.
  - It never covers a booking dated later. So a certificate expiring on a date blocks bookings that start after the end of that date, and no earlier.
  - Any one approved document of the right kind covering the date is enough.
- **Expiry warnings.** The member's contact receives one 14-day warning per approved document and one 3-day warning, judged on the kitchen's today:
  - The 14-day warning goes out on the first check when today is on or after `expires_on` minus 14 days and before `expires_on` minus 3 days.
  - The 3-day warning goes out on the first check when today is on or after `expires_on` minus 3 days and on or before `expires_on`.
  - Checks run at least every 15 seconds and immediately after an approval.
  - A document approved inside the 3-day range gets only the 3-day warning. Neither warning is ever sent twice for one document.

**Check-in (DP-35).**

- The check-in window of a booking runs from 15 minutes before its start (included) to its end (excluded), measured by the server clock.
- Checking in requires all of the following, in this order:
  1. The booking is `confirmed` or `checked_in`. Otherwise the answer is `invalid_transition`.
  2. Now is inside the window. Otherwise the answer is `outside_check_in_window`.
  3. The calling crew cook has their own approved food handler card covering the booking's date under the coverage rule. Otherwise the answer is `food_handler_card_not_current`. An expired card, an unapproved card or a card whose `expires_on` is before the booking date all fail.
- Payment-pending bookings may be checked in.
- Each crew cook is recorded at most once per booking, with the instant and the card document used.

**Compliance packets (DP-36, DP-37, DP-38).**

- Creating or regenerating a packet takes a snapshot of every booking that has at least one check-in and whose kitchen date lies within `from` to `to`, inclusive. Visits are grouped by date and ordered by start time.
- For each visit the snapshot records exactly these fields:
  - the business name, station name, start and end
  - whether the member had an approved liability insurance document covering that date, with that document's expiry date
  - each checked-in crew cook's name and check-in instant
  - whether that cook had an approved food handler card covering that date, with its expiry date
- No other field appears: no emails, member ids, prices, files or notes.
- Days without visits are omitted.
- The JSON, the public page and the PDF all show the same snapshot. The page and PDF use "Valid" and "Not valid".
- The PDF is stored in MinIO when the snapshot is taken. It is a non-empty PDF whose text can be extracted, not an image, and contains:
  - the kitchen name and the date range
  - every visit's date, business name, station and times
  - every crew name with the validity words
- A check-in made after the snapshot appears only after "Regenerate link".
- **Links:**
  - Each link carries a token of at least 32 random bytes, encoded URL-safe, so it is at least 43 characters.
  - A link is usable while its packet is `active` and now is strictly before `expires_at`. At `expires_at` exactly and afterwards it reads `expired` and answers 404.
  - Revoking is final.
  - Regenerating an `active` or `expired` packet issues a new token, rebuilds the snapshot and makes the packet active again. The old token answers 404 from then on.
  - Every link is read-only: no request through a packet token changes anything.

**Idempotency (DP-15, DP-16).**

- Every authenticated `POST` under `/api` accepts an optional `Idempotency-Key` header of 1 to 100 printable characters, scoped to the signed-in user and kept at least 24 hours.
- Replaying the same key with the same method, path and body returns the stored status and body with header `Idempotent-Replay: true`, and repeats no effect: no ledger entry, Kill Bill record, email, object or state change.
- Replaying the key with a different method, path or body answers `422 {"error":"idempotency_key_reused"}`.
- A request arriving while the same key's first request is still running answers `409 {"error":"request_in_progress"}`.
- **Emails.** Each email goes out once per state change it reports, after that change commits:
  - one confirmation per booking
  - one cancellation receipt per booking
  - one invoice notice per Kill Bill charge
  - one warning per document per threshold
- Retries, replays, sweeps running twice and delayed sends never produce a second copy.

**Usage and export (DP-39).**

- Daily usage counts bookings in `confirmed`, `checked_in` and `completed` on that kitchen date, per station:
  - `booked_minutes` sums the bookings' spans
  - `cleaning_minutes` sums their tails
  - `bookings` is the count
- The monthly CSV has one row per booking of any status whose kitchen date is in the month, ordered by date, start and station name.
- Its header row is exactly `date,station,business,start,end,cleaning_until,booked_hours,prepaid_hours,overage_hours,overage_amount,status,payment`. Hours have two decimals and amounts have two decimals without a currency sign.
- Fields containing a comma, double quote or line break are quoted, with inner quotes doubled.
- **Neutralising.** Any cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return is written with a single apostrophe in front. Business names starting with those characters therefore open in a spreadsheet as plain text.

### Services (DP-12, DP-14, DP-16, DP-19 to DP-21, DP-26, DP-30 to DP-32, DP-37)

**PostgreSQL (`DATABASE_URL`).**

- The system of record for the kitchen, stations, people, holds, bookings, check-ins, the hours ledger, document records, packet links, idempotency records and the outbound email and billing queues.
- It enforces one winner per station cell.
- The app applies its schema and seed data idempotently on every serve, into an empty database as well as an existing one.

**Kill Bill (`KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`).**

- Each member is one Kill Bill account in US dollars:
  - external key: the member id, for example `mbr-rosa`
  - name: the business name
  - email: the member's contact email
- Before its first billing action, the app reuses an existing account with that external key or creates one.
- What the app records:
  - **Pack purchase:** an external charge with description `<pack name>` for the pack price, then a successful external payment (PURCHASE) of that invoice.
  - **Overage at confirmation:** an external charge `Overage <booking id>: <station name> <date> <start>–<end>` for `overage_amount`, then a successful PURCHASE payment of that invoice.
  - **Late-cancellation fee:** an external charge `Late cancellation <booking id>` for the fee, with no payment.
  - **Waiver of a charged fee:** a credit `Waived late cancellation <booking id>` for the fee.
  - **Refund of a paid overage on cancellation:** a credit `Refund overage <booking id>` for `overage_amount`. An overage still pending is dropped instead, and the booking's payment reads `voided` as Business rules state.
- Each record is made once per business event, even across retries.
- A booking's payment turns `paid` only once Kill Bill has recorded its payment.
- **When Kill Bill is unreachable:**
  - Pack purchases answer `503 billing_unavailable` and change nothing.
  - Invoice reads answer `503 billing_unavailable`.
  - Confirmations that need overage succeed with payment `payment_pending`.
  - Fees, credits and account creation are queued.
  - `/api/kitchen` and `/api/board` report `"billing":"down"`.
- The server retries queued billing work and probes Kill Bill at least every 15 seconds. Within 30 seconds of Kill Bill becoming reachable, everything still queued is recorded, every booking still `payment_pending` turns `paid`, charged fees read `charged`, and billing reports `"up"`. Bookings cancelled during the outage already read `voided` and stay that way. None of this needs a restart.

**MinIO (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).**

- The bucket is private.
- Uploaded documents are stored at `documents/<member id>/<document id>` with the detected content type.
- Packet PDFs are stored at `packets/<packet id>.pdf`, replaced on regeneration.
- Seeded documents each get a one-page PDF object, written on serve if missing.
- **When MinIO is unreachable:** uploads, downloads, packet creation and regeneration answer `503 storage_unavailable` and leave no record. Seed objects are written once storage returns.

**Mailpit (`SMTP_HOST`, `SMTP_PORT`).**

- Every email comes from `Passboard <passboard@halsted-kitchen.test>` and goes to the member's contact email.
- **Booking confirmation:**
  - Subject: `Booking confirmed: <station name> on <date>`.
  - Body: the station, `<date>`, `<start>–<end>`, "Cleaning turnover until `<tail_end>`", "Prepaid hours used: `<hours>`", "Overage: $`<overage_amount>`", and "Payment pending" when it applies.
- **Cancellation receipt:**
  - Subject: `Booking cancelled: <station name> on <date>`.
  - Body: "Hours returned: `<hours>`" and either "Late-cancellation fee: $`<fee>`" or "No cancellation fee".
- **Expiry warning:**
  - Subject: `Certificate expires in 14 days: <label>` or `Certificate expires in 3 days: <label>`.
  - `<label>` is "Liability insurance" or "Food handler card – `<crew cook name>`".
  - Body: the expiry date.
- **Invoice notice:**
  - Subject: `Invoice notice: $<amount> for <description>`.
  - Sent after Kill Bill records each charge.
- **When the mail sink is unreachable:** the action that triggered an email still succeeds with its normal status. The email is queued, retried at least every 15 seconds, and sent exactly once when it is reachable.

### Seed data (DP-01, DP-21, DP-25, DP-29, DP-35)

Every seeded person and business below is invented. Every seeded login uses the password `prep-shift-2026`.

Kitchen: "Halsted Street Kitchen", time zone `America/Chicago`.

| Station id | Name | Hourly rate | Cleaning tail |
|---|---|---|---|
| `oven-1` | Convection Oven 1 | $28.00 | 30 minutes |
| `oven-2` | Deck Oven | $26.00 | 30 minutes |
| `kettle-1` | Steam Kettle | $32.00 | 45 minutes |
| `prep-a` | Prep Station A | $18.00 | 15 minutes |
| `prep-b` | Prep Station B | $18.00 | 15 minutes |
| `cold-1` | Walk-in Shelf 1 | $6.00 | 0 minutes |

| Pack id | Name | Minutes | Price |
|---|---|---|---|
| `pack-10` | 10-hour pack | 600 | $230.00 |
| `pack-25` | 25-hour pack | 1500 | $525.00 |

| User id | Role | Name | Email | Member |
|---|---|---|---|---|
| `usr-ines` | operator | Ines Albrecht | ines@halsted-kitchen.test | — |
| `usr-rosa` | member | Rosa Delgado | rosa@tamalcart.test | `mbr-rosa` |
| `usr-owen` | member | Owen Mbeki | owen@crumbco.test | `mbr-crumb` |
| `usr-priya` | member | Priya Natarajan | priya@lakefrontprep.test | `mbr-lake` |
| `usr-tomas` | crew_cook | Tomás Reyes | tomas@tamalcart.test | `mbr-rosa` |
| `usr-lena` | crew_cook | Lena Park | lena@tamalcart.test | `mbr-rosa` |
| `usr-abe` | crew_cook | Abe Lindqvist | abe@crumbco.test | `mbr-crumb` |

| Member id | Business name | Contact email | Opening balance |
|---|---|---|---|
| `mbr-rosa` | Rosa's Tamal Cart | rosa@tamalcart.test | 360 minutes, as transaction `txn-open-rosa` |
| `mbr-crumb` | Northside Crumb Co. | owen@crumbco.test | 0 minutes, no transaction |
| `mbr-lake` | Lakefront Meal Prep | priya@lakefrontprep.test | 600 minutes, as transaction `txn-open-lake` |

| Document id | Member | Kind | Crew cook | Expires on | Status |
|---|---|---|---|---|---|
| `doc-rosa-coi` | `mbr-rosa` | liability_insurance | — | 2030-12-31 | approved |
| `doc-crumb-coi` | `mbr-crumb` | liability_insurance | — | 2030-12-31 | approved |
| `doc-lake-coi` | `mbr-lake` | liability_insurance | — | 2026-09-30 | approved (reads expired) |
| `doc-tomas-card` | `mbr-rosa` | food_handler_card | `usr-tomas` | 2030-06-30 | approved |
| `doc-lena-card` | `mbr-rosa` | food_handler_card | `usr-lena` | 2026-08-31 | approved (reads expired) |
| `doc-abe-card` | `mbr-crumb` | food_handler_card | `usr-abe` | 2030-06-30 | approved |

There are no seeded holds, bookings, check-ins or packet links.

## Technical requirements

### Deployment (DP-40, DP-02)

- Node.js 22 LTS with npm is available. The app is written in TypeScript.
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm start"}
  ```

- The serve command passes the environment through unchanged, including `PASSBOARD_NOW` and `PASSBOARD_HOLD_SECONDS`, and sets neither of them itself.
- The server listens on `0.0.0.0` at the port in `APP_PUBLIC_PORT`, or 4173 when that is unset.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` within 10 seconds of serve starting, whether or not any dependency is reachable.
- **Test clock.**
  - When `PASSBOARD_NOW` is set, its value is an ISO 8601 instant with an offset, for example `2027-02-10T07:40:00-06:00`. The server clock starts at that instant when serve starts, then advances in real time, so holds, countdowns, sweeps and expiries still move.
  - When it is unset, the server uses the real clock.
  - An unparseable value stops the server at boot with an error message.
  - The verifier boots the app with this variable set.
- The verifier may boot several copies of the app at once, for example one per time-dependent test. Each copy has its own `DATABASE_URL`, `APP_PUBLIC_PORT` and `PASSBOARD_NOW`, while sharing Kill Bill, MinIO and Mailpit. Each copy must:
  - apply its schema and seed to its own empty database on serve
  - reuse Kill Bill accounts that already carry its members' external keys
  - use globally unique ids for every record it creates

### Configuration and secrets (DP-45, DP-08)

These are read once at start from the environment:

- `DATABASE_URL`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`
- `APP_PUBLIC_PORT`
- `PASSBOARD_NOW`: the test clock, unset by default.
- `PASSBOARD_HOLD_SECONDS`: hold lifetime in whole seconds. The default is 600. The verifier sets it lower.

None of these values is hard-coded, logged, written to the browser bundle or returned in any response.

### Server boundary (DP-41, DP-26, DP-27, DP-38)

**Same origin only.**

- The server sends no cross-origin sharing headers.
- Any `POST`, `PUT`, `PATCH` or `DELETE` whose `Origin` header is present and differs from the app's own origin answers `403 {"error":"cross_origin"}`.
- The session cookie is `passboard_session`: a random server-side token, `HttpOnly`, `SameSite=Lax`, `Path=/`.

**Request limits.**

- JSON bodies may be at most 65,536 bytes, inclusive. Larger bodies answer `413 {"error":"payload_too_large"}`.
- An upload request may be at most 5,250,000 bytes in total, inclusive, with the same 413.
- A JSON endpoint given another content type answers `415 {"error":"unsupported_media_type"}`.

**Uploads.**

- The file's type is judged by its first bytes, never by its name or the declared type:
  - `%PDF-` is PDF
  - the PNG signature is PNG
  - the JPEG start-of-image marker is JPEG
- Everything else, including SVG, HTML, scripts and archives, answers `unsupported_file_type`, whatever its extension.
- A file part larger than 5,000,000 bytes answers `file_too_large`. Exactly 5,000,000 bytes is allowed.
- An empty file answers `file: "empty"`.
- A file name containing `/`, `\`, `..`, a control character, or longer than 120 characters answers `file: "invalid_filename"`.
- The stored object key never uses the file name.
- Every refused upload stores no object and no record.

**Serving files.**

- Document files and packet PDFs are always served with:
  - `Content-Disposition: attachment`
  - the detected content type
  - `X-Content-Type-Options: nosniff`
  - `Content-Security-Policy: sandbox`
- Nothing uploaded is ever rendered inline.

**Packet routes.**

- They answer with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- Tokens never appear in server logs.

**Never served.**

- The server never serves source files, `/app/run.json`, package manifests, lockfiles, dependency folders, environment files, version-control data or any credential.
- Any such path answers 404.
- Only built browser assets and the routes in this brief are served.

**Dependencies.**

- A dependency unreachable at boot never stops the server.
- PostgreSQL unreachable: every route except `/api/health` answers `503 {"error":"database_unavailable"}`. Schema and seed are applied as soon as the database answers.
- Other dependencies behave as described in Services.
- Every dependency is retried in the background and picked up again within 30 seconds of returning, without a restart.

### Browser support and performance (DP-42, DP-05)

- Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800.
- The board is usable within 3 seconds of navigation on a local network.
- Each paint snap updates the band and cost tag within a tenth of a second.
- A hold response appears within 1 second.

## Working rules

- IF-01: `/app/run.json` exists and is JSON with string fields `_schema` (exactly `run-manifest-v1`), `install`, `build` and `serve`, and no other fields.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package and every bundled font, each with name, version and licence. Shipped packages means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package, as defined in IF-02, is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0. Fonts are OFL-1.1.
- IF-04: The only datastores are the provided PostgreSQL database and MinIO bucket. There are no embedded databases, no key-value stores and no files on local disk used as storage.
- IF-05: The provided service definitions and their environment values stay untouched, and the app adds no services.
- IF-06: Server and browser code are TypeScript. Big Shoulders Display and Public Sans are self-hosted, and the browser makes no requests to third-party hosts.

## Engineering standards

- The code is idiomatic, strict-mode TypeScript, and domain code has no untyped escape hatches.
- Names in the source use this brief's domain terms: hold, booking, cleaning tail, prepaid minutes, ledger transaction and entry, document coverage, check-in window, packet link, crew cook.
- Each domain rule is decided in exactly one place in the source and reused by every caller, including the browser's live cost tag. This covers the station-cell collision, the cost split, the cancellation cutoff, document coverage, the check-in window, each state transition and CSV neutralising.
- Every time-dependent rule reads the single server clock. No other code reads the system time or the database's clock for a business decision.
- There is no abstraction with only one implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the rules make impossible.
- Every error leaves the server in the one error shape from the API section.
- There are no features, endpoints or screens beyond this brief.
