# Northbar Camera Hire Tallyslate

Tallyslate is the booking counter for Northbar Camera Hire, an invented one-owner rental house that hires serialised cinema camera, lens and lighting kits by the day to freelance film crews. Renters use it from a phone on set: they see which kits are free for their shoot dates, get the exact hire price under the house pricing rules, upload a certificate of insurance and book. The prep tech uses it at the counter to prep, check out and check in kits unit by unit with condition photos. The owner uses it to review certificates, publish rate cards, track every serial unit and see what is earning. Build it as one web application backed by four services: Postgres is the system of record, Kill Bill takes and refunds payments and records damage invoices, MinIO stores certificate PDFs and condition photos, and Mailpit receives every outgoing mail. Out of scope: renter accounts and passwords (a renter reaches their booking through a private link), staff user management beyond the two seeded passcodes, multi-kit bookings, delivery, sales of consumables, taxes, any datastore other than Postgres and MinIO, and any third-party service other than the four above.

## Problem and users

One-owner rental houses lend cinema bodies, lens sets and lighting packages worth tens of thousands of dollars each to freelance camera assistants, gaffers and directors of photography. Today they run a general rental tool, a spreadsheet of serial numbers and an inbox of insurance certificates. General tools count "items in stock" but miss three things this trade lives by. First, a kit is made of specific serial units, and one missing unit breaks the whole booking. Second, the trade prices a 7-day hire as 3 days, and a Friday pickup with a Monday return as 1 day. Third, gear may not leave unless the renter's certificate of insurance names the shop as loss payee, covers the full replacement value and is valid on every day of the hire. When a body is double-booked, a crew loses a shoot day. When gear leaves on a certificate that lapses mid-hire, the shop carries the loss uninsured. When a deposit is marked taken but the charge never cleared, a damage claim can't be recovered.

- **Owner** (daily): keeps every serial unit earning, prices everything from the house rate card, and never lets gear leave uninsured or unpaid.
- **Prep tech** (daily): builds, checks out and checks in kits unit by unit at the counter with condition photos. Works fast, from the keyboard and a barcode scanner, without a mouse.
- **Renter** (weekly): finds which kits are free for the shoot dates, sees the exact hire price, uploads a certificate and books, usually from a phone on set.

## Journeys

1. **Find and price a kit.** A renter opens the catalogue with no dates set and sees the no-dates prompt. They pick a pickup date and drag the return handle along the day strip. Free days fold into a hatched band, a Friday weekend collapses into one cell, and each kit's rental sheet shows how many complete kits are free and the server-quoted hire price. The journey ends with the renter looking at a priced, available kit.
2. **Hold a kit.** On a kit's rental sheet the renter can pick a specific serial for each unit class (booked serials are greyed out), then enters their name and email and holds the kit. They land on their private booking page, which shows the held state, the hold countdown and the deposit as not taken. If another renter took the same unit a moment earlier, they see the unit-taken notice and can either take the next free serial or choose new dates.
3. **Insure the hire.** On the booking page the renter uploads their certificate of insurance PDF and sees it marked under review. The owner opens the certificate queue on the desk, reads the PDF and either approves it, recording cover dates, limit and the loss-payee check, or rejects it with a reason. The renter sees the decision on the booking page, and a rejected renter gets a mail.
4. **Confirm and pay.** With an approved certificate and the hold still running, the renter presses Confirm and pay. The deposit shows Pending while Kill Bill takes payment, then Paid. The confirmation heading appears and the confirmation mail with the itemised serial list arrives. If prices changed since the hold, the renter sees the new total and confirms again.
5. **Prep and check out at the counter.** The prep tech signs in, opens the booking from the counter list, preps the kit and starts checkout once the server allows it. For each unit they scan the serial, tick the checklist, write condition notes and attach a photo, and focus returns to the scan field each time. After the confirm dialog the booking is out and every unit is located on it.
6. **Check in and close.** When the kit comes back, the prep tech scans each unit in, marks it OK or Damaged with a damage charge, adds notes and photos, and closes the check-in once every photo is stored. Kill Bill records any damage invoice and the deposit refund. The renter gets the return receipt. Damaged units go to repair and the rest go back on the shelf.
7. **Run the house.** The owner publishes a new rate card with an effective date and watches new quotes reprice while confirmed bookings keep their prices. They send a unit to repair, bring it back, and read its movement history and the utilisation totals. Utilisation, the ready-to-go counts and the catalogue's free counts all move together.
8. **Lose the hold.** A renter who doesn't confirm in time sees the hold-ended state. Their units become free for other renters again, and confirming is refused.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Catalogue availability** The renter catalogue lists every kit on its rental sheet under its category and, once dates are set, shows on each sheet how many complete kits are free for those dates and their server-quoted hire price, as qualified in Business rules.
- **DP-02 — House pricing rules** The price endpoint returns the hire days, each day's kind, the billable days and the hire price computed from the 3-day week and Friday-weekend rules on the active rate card.
- **DP-03 — Week fold day strip** Moving the return handle one day at a time folds free days into one hatched band, collapses a Friday weekend into one cell, and shows the server-quoted total and billable-day count with a live announcement.
- **DP-04 — Date prompts and empty results** The catalogue shows the published no-dates prompt before dates are set, and the published nothing-free state when no kit is free for the chosen dates.
- **DP-05 — Renter layouts at phone and tablet widths** The catalogue and kit sheet show their published element order and columns at 375x812, 768x1024 and 1280x800, with no horizontal scrolling.
- **DP-06 — Hold a kit from the sheet** A renter sets dates, optionally picks serials, enters a name and email and holds the kit, then lands on their private booking page in the published held state.
- **DP-07 — No double-booked serials** The server never assigns one serial unit to two active bookings whose hire ranges overlap, whether at hold or at swap.
- **DP-08 — Last-unit race** When several holds claim the last free unit for overlapping dates at once, exactly one succeeds and every other gets the unit-taken conflict naming the next free serial or none.
- **DP-09 — Unit taken notice** A renter whose hold loses a unit sees the published unit-taken notice, with a button to book the next free serial when there is one, or to choose new dates.
- **DP-10 — Idempotent holds** Repeating a hold with the same idempotency key returns the original response without creating a second booking, and reusing the key for a different request is rejected.
- **DP-11 — Certificate upload stored as sent** A renter's certificate PDF is stored byte for byte in object storage and recorded as under review only after storage confirms the write.
- **DP-12 — Owner certificate review** The owner approves a certificate with its cover dates, limit and loss-payee check, or rejects it with a reason that is mailed to the renter once.
- **DP-13 — Confirm and pay** A renter with an approved certificate confirms a running hold on the booking page and sees the deposit go from Pending to Paid, followed by the published confirmation heading.
- **DP-14 — Payment status from Kill Bill** A booking shows its deposit as Paid only after Kill Bill records a successful purchase of the stored total, Pending while it waits, and Failed when Kill Bill declines.
- **DP-15 — All-or-nothing confirmation** A booking becomes confirmed only when its certificate is present in storage, the Kill Bill purchase has succeeded and the confirmation mail has been accepted; if any step fails, the booking stays a quote and no charge stands.
- **DP-16 — Confirmation mail** Each confirmed booking sends exactly one confirmation mail to the renter, listing every serial, the dates, the billable days, the prices and the rate-card version.
- **DP-17 — Idempotent confirmation** A confirm replayed with the same key returns the stored response, and two different confirms racing on one quote produce one confirmation and one Kill Bill payment.
- **DP-18 — Server-timed hold countdown** The renter's hold countdown and the Confirm and pay button follow the server's remaining hold time and confirmability, even when the device clock is wrong.
- **DP-19 — Quote expiry releases units** A quote not confirmed within the hold period becomes expired, its units become free for other renters, and confirming it is refused.
- **DP-20 — Publish a rate card** The owner publishes a new numbered rate card that gives a day rate and a deposit for every kit and has an effective date of today or later.
- **DP-21 — Effective-dated prices** Confirmed bookings keep the price and rate-card version they were confirmed under, quotes confirmed after a newer card takes effect are repriced first, and every booking surface shows its version.
- **DP-22 — Prep a kit** A prep tech can mark a confirmed booking prepped only when every assigned serial is on the shelf, and otherwise sees which serials are missing.
- **DP-23 — Swap a serial** Staff can swap a booking's unit for another free serial of the same class before the kit is prepped, under the same no-overlap rule.
- **DP-24 — Server-decided checkout gate** The Start checkout button is enabled only when the server's checkout status for that booking allows it, which requires a prepped booking and an approved certificate covering every hire day and the full replacement value.
- **DP-25 — Keyboard counter checkout** A prep tech completes a whole checkout by keyboard alone; focus returns to the scan field after each unit and stays inside the confirm dialog while it is open.
- **DP-26 — Counter two-pane layout** At 1280x800 the counter shows the bookings list and the booking detail side by side; at 768x1024 and 375x812 it shows one pane at a time.
- **DP-27 — Counter checkout** A prep tech scans, checks, notes and photographs each unit of a prepped booking and checks the kit out; the booking is then out and every unit is located on it.
- **DP-28 — Unit check-in** Checking in a unit records its condition and any damage charge and moves it to the shelf or to repair; the booking becomes returned after its last unit.
- **DP-29 — Photos stored before they count** Each condition photo shows Pending, Stored or Failed according to object storage's answer, and only Stored photos satisfy checkout and check-in close.
- **DP-30 — Close and settle** Closing a returned booking records any damage invoice and the deposit refund in Kill Bill, then sends at most one return receipt, as qualified in Business rules; closing is refused until every unit's check-in photos are stored.
- **DP-31 — Check-in and close** A prep tech checks in each unit with condition photos, flags damage and closes the check-in; the booking is then closed and each unit is on the shelf or in repair.
- **DP-32 — Paired movement ledger** Every unit move is one movement with two balancing entries, and each unit's history balances to exactly one current location.
- **DP-33 — Repair moves** Staff can send a shelf unit to repair and bring a repaired unit back; every other manual move between locations is refused.
- **DP-34 — Counts agree with the ledger** Free-for-dates counts, each kit's ready-to-go count and the owner's utilisation totals are derived from the ledger, and all of them agree after every checkout, check-in and repair move.
- **DP-35 — Cancel a confirmed booking** The renter or the owner can cancel a confirmed booking, which refunds the full charge in Kill Bill and releases its units.
- **DP-36 — Booking states and rights** Each booking transition is allowed only from its published states and for its published roles, and every other attempt gets the published rejection.
- **DP-37 — Payments outage** When Kill Bill is unreachable, confirm, cancel and close answer the published outage error without changing anything, and screens show the payments-offline banner.
- **DP-38 — Photo storage outage** When object storage is unreachable, certificate uploads, photo uploads and confirmation answer the published outage error, nothing is recorded as stored, and screens show the storage-offline banner.
- **DP-39 — Run manifest and health** The app installs, builds and serves from its run manifest on the published port, and its health endpoint answers as published.
- **DP-40 — Staff sign-in** The owner and the prep tech sign in with their passcodes to get a role session, and staff screens and endpoints refuse requests without one.
- **DP-41 — One error shape and order** Every API error uses the published body shape and follows the published precedence.
- **DP-42 — Server boundary** The server accepts same-origin requests only, enforces the published size and type limits, never serves source files or credentials, and serves pages even when Kill Bill or storage is unreachable at boot.
- **DP-43 — Reduced motion** With reduced motion requested, the strip folds and the totals change without animation, while every label and announcement stays the same.
- **DP-44 — Touch targets and contrast** Every interactive control is at least 44 by 44 pixels, and all text and controls meet WCAG 2.2 AA contrast on the warm paper ground.
- **DP-45 — Rental sheet look** Each kit reads as a printed rental sheet, with a tall condensed name, huge price numerals, thin oxblood rules, a ruled day strip and a unit table on warm off-white paper.
- **DP-46 — Provider wiring in source** The source reads every credential from the environment and derives payment, storage and mail state only from the real providers' answers, never from faked or self-reported results.

## Frontend

### Screens and layout (DP-01, DP-04, DP-05, DP-06, DP-13, DP-26, DP-45)

Every screen has a warm off-white paper ground with thin oxblood rules dividing its sections, like a printed rental form. No screen scrolls horizontally at 375x812, 768x1024 or 1280x800. There are three layouts: the phone layout applies below 768 pixels wide, the tablet layout from 768 up to just under 1280, and the desktop layout at 1280 and wider. No other width changes which layout a published viewport gets.

**Catalogue (`/`, optional query `?pickup=YYYY-MM-DD&return=YYYY-MM-DD`).** At the top: the service notice region (only when a provider is down), the pickup date field, then the day strip with its return handle. Below that, the rental sheets, one per kit, grouped by category in seed order. Each sheet has a top band with the tall kit name and huge price numerals. Before dates are set the band shows the day rate; after, it shows the hire price for the dates with the billable-day count beside it, plus the free count. A thin oxblood rule closes the band. Below the band, the kit's component list.
- Desktop: a sticky left rail lists the kit categories and stays in view while the sheets scroll in the column to its right. The day strip shows all 14 positions in one row.
- Tablet: the rail becomes a row of category links above the date controls. Sheets are one column, and inside each top band the kit name sits on the left and the numerals on the right. The day strip is one row.
- Phone: the category links wrap in a row above the date controls. Sheets are one column, and each top band stacks name, then numerals, then free count. The day strip wraps into two rows of seven positions (week one above week two).

**Kit sheet (`/kits/<kitId>`, same optional query).** One poster-like sheet. In order: top band (kit name as the page heading, price numerals, billable-day count, free count), day strip with return handle, the unit tables (one per component class, one row per serial with its status), and the hold form (name, email, Hold this kit). Desktop keeps the sticky category rail on the left. Tablet and phone follow the catalogue's band arrangements and drop the rail. The unit-taken notice appears directly above the hold form.

**Booking page (`/bookings/<ref>?key=<renterKey>`).** The renter's private page. In order: heading with ref and kit name; booking status line; hold countdown (quotes only); deposit status; rate-card version; dates, billable days, hire price, deposit and total in display numerals; the assigned serial list; the certificate block (status and upload); Confirm and pay; and Cancel booking (confirmed bookings only). Single column at every viewport. At desktop the column is centred and no wider than a printed sheet.

**Desk sign-in (`/desk`).** A passcode field and a Sign in button on a single sheet. After sign-in, the prep tech goes to the counter and the owner goes to the owner desk. Both desk screens carry a Sign out button.

**Counter (`/desk/counter`, owner and prep tech).** Two panes. The bookings list shows every booking that is not closed, expired or cancelled, ordered by pickup date then ref; each entry shows ref, kit, renter, dates and state. The booking detail shows the state, rate-card version, serial table with locations and photo statuses, checkout blockers, close blockers, and the Prep kit, Swap, Start checkout, Start check-in and Close check-in controls. The checkout or check-in panel opens inside the detail pane.
- Desktop: list on the left (about a third of the width) and detail on the right, both visible at once. The first booking is selected on load.
- Tablet and phone: only the list shows. Choosing a booking replaces the list with its detail, which has a Back to bookings button.

**Owner desk (`/desk/owner`, owner only).** A sticky left rail with section links at desktop, which becomes a top row of links on tablet and phone. Sections, in order:
- Utilisation: out, on the shelf and in repair counts, and the utilisation percentage in display numerals.
- Kits: each kit with its ready-to-go count.
- Certificates to review.
- Rate cards: a table of versions with effective dates, plus the Publish control.
- Units: one row per serial with location, history and repair controls.

A prep tech who opens this page sees the owner-only notice instead.

**Any unknown page route** shows the not-found heading on the paper ground, with a link back to the catalogue.

### Public screens and controls (DP-01, DP-03, DP-06, DP-09, DP-12, DP-13, DP-18, DP-22, DP-23, DP-24, DP-25, DP-27, DP-28, DP-31, DP-33, DP-35, DP-40)

Only these roles and names are public. Everything else is free. `<kit name>`, `<class name>`, `<serial>` and `<ref>` are the record's values exactly as in Seed data or the API.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Catalogue, kit sheet | `navigation "Kit categories"` with `link "Camera"`, `link "Lighting"` | Moves to that category's sheets (on the kit sheet, back to the catalogue section) |
| Catalogue, kit sheet | `textbox "Pickup date"` | Date field. Changing it keeps the current return day number |
| Catalogue, kit sheet | `slider "Return day"` | Minimum 1, maximum 14, value N = the return day number. Value text `Day <N>, return <YYYY-MM-DD>` |
| Catalogue, kit sheet | `list "Hire days"` | One `listitem` per rendered cell. A billable cell shows its day number and three-letter weekday (for example `1 Fri`). A folded free band shows `free`. A Friday weekend shows `weekend · 1 day` (middle dot) |
| Catalogue, kit sheet | `status "Hire total"` | Announcement copy in Feedback states |
| Catalogue, kit sheet, booking, desk | `region "Service notice"` | Outage banners from Feedback states |
| Catalogue | `article "<kit name>"` per sheet | Contains the kit name as a level-2 heading, the numerals, `<free> free for these dates` once dates are set, and `link "Open <kit name>"` |
| Kit sheet | `heading` level 1 `<kit name>` | |
| Kit sheet | `table "<class name> units"` per class | Columns Serial, Status, Pick. Status cell is `Free`, `Booked` or `In repair`. Booked and in-repair rows are greyed |
| Kit sheet | `radio "Any free <class name>"` and `radio "<serial>"` per row | One group per class. Defaults to any free unit. A booked or in-repair serial's radio is disabled |
| Kit sheet | `textbox "Your name"`, `textbox "Email"`, `button "Hold this kit"` | Hold is disabled until dates are set |
| Kit sheet | `alert` containing the unit-taken notice | Heading and text in Feedback states, plus `button "Book <serial> instead"` when the server offers a next free serial, otherwise `button "Choose new dates"` (focuses the slider) |
| Booking page | `heading` level 1 `<ref> · <kit name>` | |
| Booking page | `status "Booking status"` | Every booking-page outcome is announced here |
| Booking page | `region "Hold"` | Countdown text from Feedback states (quotes only) |
| Booking page | text `Deposit: <label>` | Label from Feedback states |
| Booking page, counter detail | text `Rate card v<n>` | `<n>` is the booking's stored rate-card version |
| Booking page | file input labelled `Certificate of insurance (PDF)`, `button "Send certificate"` | |
| Booking page | `button "Confirm and pay"` | Enabled exactly when the booking's `confirmable` is true |
| Booking page | `button "Cancel booking"` → `dialog "Cancel booking"` with `button "Cancel booking and refund"` and `button "Keep booking"` | Confirmed bookings only |
| Desk sign-in | `textbox "Passcode"`, `button "Sign in"` | |
| Desk | `button "Sign out"` | |
| Counter | `list "Bookings"` with `button "<ref> · <kit name>"` per booking | |
| Counter | `region "Booking detail"` | Below 1280 it also has `button "Back to bookings"` |
| Counter | `status "Counter status"` | Every counter outcome is announced here |
| Counter | `button "Prep kit"` | Confirmed bookings |
| Counter | `button "Swap <serial>"` → `dialog "Swap unit"` with `combobox "Replacement serial"` and `button "Swap"` | Quote and confirmed bookings |
| Counter | `button "Start checkout"` and `list "Checkout blockers"` | Button enabled exactly when the booking's `checkout.allowed` is true. The list shows each blocker's message |
| Counter | `region "Checkout"` with `textbox "Scan serial"` | |
| Counter | `group "<serial>"` per scanned unit with `checkbox "Powers on"`, `checkbox "Accessories present"`, `checkbox "Cosmetic condition as listed"`, `textbox "Condition notes"`, file input labelled `Condition photo`, photo status text, `button "Done with unit"` | |
| Counter | `button "Review checkout"` → `dialog "Confirm checkout"` with `button "Check out kit"` and `button "Back"` | Review is enabled once every unit is done |
| Counter | `button "Start check-in"` → `region "Check-in"` with `textbox "Scan serial"` | Out bookings |
| Counter | `group "<serial>"` per scanned unit with `radio "OK"`, `radio "Damaged"`, `textbox "Damage charge"` (dollars), `textbox "Condition notes"`, file input labelled `Condition photo`, photo status text, `button "Check in unit"` | |
| Counter | `button "Close check-in"` and `list "Close blockers"` | Button enabled exactly when the booking's `close.allowed` is true |
| Owner desk | `navigation "Desk sections"` with links `Utilisation`, `Certificates`, `Rate cards`, `Units` | |
| Owner desk | `region "Utilisation"` | `<out> of <total> units out`, `<onShelf> on the shelf`, `<repair> in repair`, `<percent>% utilisation` |
| Owner desk | `region "Kits"` | One row per kit: `<kit name>` and `<ready> ready to go` |
| Owner desk | `region "Certificates to review"` with `button "Review <ref>"` → `dialog "Review certificate"` | The dialog has `link "Open certificate PDF"`, `textbox "Cover starts"`, `textbox "Cover ends"`, `textbox "Limit"` (dollars), `checkbox "Names Northbar Camera Hire as loss payee"`, `button "Approve"`, `textbox "Reason"`, `button "Reject"` |
| Owner desk | `region "Rate cards"` with `button "Publish rate card"` → `dialog "Publish rate card"` | The dialog has `textbox "Effective date"`, `textbox "<kit name> day rate"` and `textbox "<kit name> deposit"` per kit (dollars), and `button "Publish"` |
| Owner desk | `region "Units"` with per row `button "History <serial>"` → `dialog "Unit history <serial>"`, `button "Send <serial> to repair"` (shelf units), `button "Return <serial> from repair"` (repair units) | |
| Owner desk | `status "Desk status"` | Every owner-desk outcome is announced here |

### Interactions (DP-03, DP-06, DP-09, DP-18, DP-25, DP-27, DP-31)

- **Return handle.** Dragging the handle with a mouse or finger snaps one day per cell crossed. With the slider focused, Right or Up adds one day, Left or Down removes one, Page Up and Page Down move seven, Home goes to day 1 and End to day 14. Every step updates the cells straight away. After each step the screen asks the server for the price of the new range, and the numerals, billable-day count and announcement show only the server's figure. The previous figure stays until the new one arrives, which happens within one second of the handle coming to rest. Changing the range also refetches the unit tables, so serials booked inside the range grey out within one second. The current range is written into the page address (`pickup`, `return`), so a reload restores it.
- **Holding.** Pressing Hold this kit (or Enter in the email field) sends the hold. On success the browser moves to the booking page. On a unit-taken conflict the notice appears and focus moves to its button. Book `<serial>` instead selects that serial's radio and holds again with the same name and email.
- **Booking page.** The page loads the booking from the server. The countdown starts from the server's remaining seconds and ticks down by elapsed time. It never compares the server's expiry instant with the device clock. The page refetches the booking every 30 seconds and as soon as the countdown reaches zero, and it shows expired only when the server says so. Confirm and pay is disabled while a confirm is in flight. Cancel booking opens its dialog.
- **Dialogs (all).** Opening a dialog moves focus to its first control. Tab and Shift+Tab wrap inside it. Escape closes it, and closing returns focus to the control that opened it.
- **Counter checkout by keyboard.** Start checkout opens the Checkout region and focuses Scan serial. Typing or scanning a serial and pressing Enter opens that unit's group, or shows the unknown-serial field error and keeps focus in the field. Tab moves through the three checkboxes (Space ticks), Condition notes, Condition photo (Enter or Space opens the file chooser) and Done with unit. Done with unit, which needs all three ticks and a Stored photo, collapses the group into a done row and returns focus to Scan serial. Once every unit is done, Tab from Scan serial reaches Review checkout. Enter opens Confirm checkout, and Check out kit sends the checkout. On success the dialog closes and focus moves to the booking detail heading.
- **Counter check-in by keyboard.** It follows the same pattern. Scan opens the unit's group. Arrow keys pick OK or Damaged, and Damage charge is enabled only for Damaged. Check in unit sends that unit's check-in and returns focus to Scan serial. Close check-in is reached by Tab once its blockers clear.
- **Lists and selection.** In the counter list, Enter or Space on a booking opens its detail. Below 1280, Back to bookings returns to the list and focuses the booking that was open.
- **Touch.** Every control in the tables above can be tapped directly. The return handle accepts a horizontal drag on its track. On the phone layout's two-row strip, dragging past the end of week one carries on into week two.

### Visual design (DP-44, DP-45)

- **Colour roles.** The page is a warm off-white like rental-form paper, never pure white. Text and numerals are a near-black ink. A deep oxblood red draws every dividing rule, fills billable day cells and marks primary buttons. A brighter signal red is kept for blockers, field errors, Failed statuses and outage banners. A pale warm grey hatch, drawn as diagonal stripes, fills folded free bands and greyed unit rows.
- **Type.** Kit names and every price and count use a tall, condensed display face (Big Shoulders Display, OFL, self-hosted). Price and count numerals are about six times the body size, so they read across a counter. Body text and tables use IBM Plex Sans (OFL, self-hosted). Each step up the heading scale is one and a half times the step below it.
- **Density and grid.** Comfortable spacing on an 18-pixel base grid. Major sections are separated by four or eight grid steps of space plus a thin oxblood rule.
- **Composition.** Each kit sits on a poster-like rental sheet. The tall name and huge numerals fill the top band, then a ruled day strip, then the serial unit table, with the category rail held at the left on desktop.
- **Icons.** Lucide icons only. Every image is procedural SVG drawn by the app. There are no photographs or stock art beyond the user's own condition photos.
- **Targets and contrast.** Every interactive control, including each unit radio and each slider step on touch, is at least 44 by 44 pixels. Text, rules used as boundaries, focus rings and control borders meet WCAG 2.2 AA contrast against the paper ground. Keyboard focus is a clearly visible two-pixel oxblood ring offset from the control.

### Motion and effects (DP-03, DP-43)

- **Week fold (signature).** The handle moves one day per drag step or arrow key across days 1 to 14 from pickup. Days are numbered from 1 (the pickup date). Each day's kind comes from the Business rules pricing.
  - Billable days render as solid oxblood cells of equal width.
  - When the handle passes into a run of free days, those cells fold together into one hatched band labelled `free`, and the band's width shrinks to one billable cell's width (within one pixel). The fold takes about a fifth of a second (between 0.18 and 0.26 seconds), starts fast and settles gently.
  - When the next billable day begins, a new solid run starts after the band.
  - A Friday weekend range draws one cell labelled `weekend · 1 day` in place of its days.
  - Days beyond the handle show as an outlined, empty track.
  - Moving the handle back reverses each step: a band unfolds into its cells, then the cells disappear, one day per step.
  - The price numerals roll digit by digit from the old total to the server's new total over about a third of a second (between 0.30 and 0.42 seconds), with the same easing. The billable-day count changes at the end of the roll.
  - Once the total settles, the `Hire total` live region announces the new figure, once per settled total.
- **Other motion.**
  - Dialogs fade in and rise slightly in under a quarter of a second, and leave in the same time.
  - The service notice slides down from the top edge in under 0.3 seconds.
  - Buttons darken on hover and press in under a tenth of a second.
  - Status labels (Pending, Stored, Paid, Failed) switch colour instantly, with no animation.
- **No decorative loops.** Nothing on any screen animates in a loop. Pending states are shown with their copy, not spinners.
- **Reduced motion.** When the user asks for reduced motion, cells switch straight to their folded or unfolded state and the new total appears without the digit roll. Dialogs and the banner appear without movement. The `free` and `weekend · 1 day` labels, the billable-day count and the announced total are exactly the same as with motion, so the pricing stays readable.

### Feedback states (DP-04, DP-09, DP-13, DP-14, DP-18, DP-19, DP-21, DP-29, DP-37, DP-38, DP-40)

The copy below is exact: straight apostrophes, the characters shown, case and spacing as printed. Placeholders:
- `<ref>`: the booking ref.
- `<serial>`: a unit serial.
- `<email>`: the renter's email as stored.
- `$<amount>`: dollars with comma thousands separators and two decimals, for example `$1,950.00`.
- `<n>`: an integer.
- `<date>`: `YYYY-MM-DD`.
- `<hh>:<mm>:<ss>`: the hold's remaining seconds as zero-padded hours (which may exceed 24), minutes and seconds.

Error messages shown on screen are the API error's `message` (or the `fields` message for field errors), shown beside the control it concerns and announced in that screen's live region.

| Situation | Where | Exact copy |
|---|---|---|
| No dates set | Catalogue | Heading `Pick your shoot dates`, text `Set a pickup day and drag the return handle to see what's free and what it costs.` |
| No kit free for the dates | Catalogue | Heading `Nothing free for these dates`, text `Every kit is out or held on at least one of these days. Move the return handle or try another pickup day.` |
| Hire total settled | `status "Hire total"` | `Hire total $<hire> for <n> billable days`, or `Hire total $<hire> for 1 billable day` when the count is 1 |
| Billable-day count beside numerals | Kit sheet, catalogue | `<n> billable days` or `1 billable day` |
| Hold pending | Kit sheet | Button text `Holding your units` |
| Hold succeeded | Booking page heading area | Heading `Held for you`, text `Booking <ref> is on hold. Upload your certificate and confirm before the hold ends.` |
| Unit taken | Kit sheet alert | Heading `This unit was just booked`, text `<serial> was taken by another booking a moment ago.` (when the server gives no serial: `The last free unit was taken by another booking a moment ago.`) |
| Hold countdown | `region "Hold"` | `Hold ends in <hh>:<mm>:<ss>` |
| Hold ended | Booking page | Heading `This hold has ended`, text `The units have been released. Pick dates again to make a new hold.` |
| Certificate uploading | Booking page | `Uploading certificate` |
| Certificate received | Booking page | `Certificate received. The owner will review it before you can confirm.` |
| Certificate status | Booking page | `Certificate under review`, `Certificate approved`, `Certificate not accepted: <reason>`, or `No certificate yet` |
| Deposit label | Booking page, counter detail | `Deposit: Not taken`, `Deposit: Pending`, `Deposit: Paid`, `Deposit: Failed`, `Deposit: Refunded` |
| Confirm pending | Booking page | Button text `Taking payment`, deposit label shows Pending |
| Confirmed | Booking page | Heading `You're booked`, text `Booking <ref> is confirmed. We've emailed your serial list to <email>.` |
| Repriced at confirm | Booking page | `Prices changed on <date>. Check the new total and confirm again.` (`<date>` is the effective date of the version now on the booking) |
| Cancelled | Booking page | Heading `Booking cancelled`, text `We've refunded $<total> to your card.` |
| Photo status | Counter unit group and serial table | `Pending`, `Stored`, `Failed` |
| Photo uploading | Counter | `Uploading photo` |
| Unknown serial at scan | Counter field error | `<serial> is not on this booking` |
| Unit not ready to finish | Counter field error | `Tick every check and attach a stored photo first` |
| Prepped | `status "Counter status"` | `Kit prepped · <ref>` |
| Swapped | `status "Counter status"` | `Swapped <serial> for <serial>` (old, then new) |
| Checked out | `status "Counter status"` | `Kit out · <ref>` |
| Unit checked in | `status "Counter status"` | `<serial> checked in` |
| Check-in closed | `status "Counter status"` | `Check-in closed · <ref>` |
| Repair moves | `status "Desk status"` | `<serial> sent to repair`, `<serial> back on the shelf` |
| Rate card published | `status "Desk status"` | `Rate card v<n> published, effective <date>` |
| Certificate approved or rejected | `status "Desk status"` | `Certificate for <ref> approved`, `Certificate for <ref> rejected` |
| Payments down | `region "Service notice"` | Heading `Payments are offline`, text `We can't take or refund payments right now, so bookings can't be confirmed, cancelled or closed. Holds keep running on their own timers.` |
| Storage down | `region "Service notice"` | Heading `Photo storage is offline`, text `Certificates and condition photos can't be saved right now. Anything already stored is safe.` |
| Owner-only page for a prep tech | Owner desk | Heading `This page is for the owner` |
| Unknown page | Any route | Heading `We couldn't find that page` |

Each banner appears when the page loads and the status endpoint reports that provider down, which is rechecked every 30 seconds. It also appears straight after any request fails with that provider's outage error. It disappears at the next status check that reports the provider up. Copy for each provider's down state appears only in the service notice; the control that failed shows the API message.

## Backend

### API (DP-02, DP-08, DP-10, DP-11, DP-12, DP-17, DP-20, DP-23, DP-24, DP-28, DP-30, DP-32, DP-33, DP-35, DP-40, DP-41)

All endpoints are under `/api` and exchange `application/json` (UTF-8). The exceptions are the two upload endpoints, which take `multipart/form-data`, and the certificate file endpoint, which returns `application/pdf`. Body limits are owned by Server boundary. Money is integer US cents in every request and response. Dates are `YYYY-MM-DD` calendar dates in UTC. Instants are ISO 8601 UTC strings.

**Authentication.**
- Staff send the session cookie `tallyslate_session` (HttpOnly, SameSite=Lax), which is set by `POST /api/session`.
- A renter acts on their own booking by sending header `X-Renter-Key: <renterKey>`. A renter key never authenticates a staff-only endpoint, and a key for a different booking is treated as no access to that booking (404).
- Roles are `owner` and `prep_tech`. A renter key counts as the role `renter` for its booking.

**Error body.** Every error has the body `{"error":{"code":"<code>","message":"<text>"}}`. Validation errors add `"fields":{"<field>":"<message>"}`. Some codes add members inside `error`, as listed below.

**Error precedence** (the first that applies wins, for every endpoint):
1. `413` `too_large`, then `415` `unsupported_media_type`.
2. `401` `unauthenticated`.
3. `404` `not_found` (unknown or not-yours resource).
4. `403` `forbidden` (the role lacks the right).
5. Idempotency: a replay returns its stored response here, or a reused key gets `422` `idempotency_key_reused`.
6. `409` state conflicts.
7. `422` `validation`.
8. `503` provider errors.

Unknown `/api` paths answer `404` `not_found`.

**Idempotency.** `POST /api/bookings`, `POST /api/bookings/<ref>/confirm` and `POST /api/bookings/<ref>/close` require header `Idempotency-Key` (1 to 100 characters).
- A missing key is `422` with `fields.idempotencyKey` `Send an Idempotency-Key header`.
- A key is scoped to its endpoint. The server stores the first response whose status is below 500.
- Repeating the same key with the same path and body returns that stored status and body byte for byte, and has no other effect.
- The same key with a different path or body is `422` `idempotency_key_reused` (`Idempotency-Key was used for a different request`).
- A 5xx response is not stored, so the same key may be retried.

**Booking resource** (the body of every endpoint that returns `<booking>`):
```json
{"ref":"NB-10001","state":"quote","kit":{"id":"kestrel-lf","name":"Kestrel LF Camera Package"},
 "pickupDate":"2026-11-13","returnDate":"2026-11-16","hireDays":3,
 "renter":{"name":"Ines Marlow","email":"ines@example.test"},
 "units":[{"serial":"KLF-001","classId":"kestrel-lf-body","className":"Kestrel LF body",
           "replacementValueCents":4800000,"location":"shelf","checkedOut":false,"checkedIn":false,
           "condition":null,"damageChargeCents":0}],
 "replacementValueCents":8350000,"billableDays":1,"dayRateCents":65000,"hirePriceCents":65000,
 "depositCents":250000,"totalCents":315000,"rateCardVersion":1,
 "holdExpiresAt":"2026-11-08T10:00:00Z","holdSecondsRemaining":172800,"confirmable":false,
 "paymentStatus":"none","damageCents":0,"refundCents":0,
 "certificate":null,
 "photos":[{"id":"…","phase":"checkout","serial":"KLF-001","status":"stored"}],
 "checkout":{"allowed":false,"blockers":[{"code":"not_prepped","message":"Kit is not prepped"}]},
 "close":{"allowed":false,"blockers":[{"code":"not_returned","message":"Not every unit is checked in"}]}}
```
The values above are only an example of the shape.
- `state` is one of `quote`, `expired`, `confirmed`, `cancelled`, `prepped`, `out`, `returned`, `closed`.
- `holdExpiresAt` and `holdSecondsRemaining` are null outside `quote`. `holdSecondsRemaining` is a whole number of seconds, never negative.
- `paymentStatus` is one of `none`, `pending`, `paid`, `failed`, `refunded`.
- `certificate` is null or `{"id","status":"pending_review"|"approved"|"rejected","uploadedAt","sizeBytes","coverageStart","coverageEnd","limitCents","reason"}`, where the cover fields are null unless approved and `reason` is null unless rejected. It is the booking's latest stored certificate.
- `location` is `shelf`, `repair` or `booking:<ref>`.
- Holding a booking's renter key, the renter receives the same resource.

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | | `200 {"status":"ok"}` | |
| `GET /api/status` | anyone | | `200 {"payments":"up"\|"down","storage":"up"\|"down"}`. Each provider is probed with a timeout of at most 2 seconds, and a result may be cached for at most 10 seconds | |
| `POST /api/session` | anyone | `{"passcode":"…"}` | `200 {"role":"owner"\|"prep_tech"}` and sets the cookie | `401` `invalid_passcode` `That passcode isn't recognised` |
| `GET /api/session` | staff | | `200 {"role":…}` | |
| `DELETE /api/session` | staff | | `204`, cookie cleared | |
| `GET /api/kits?pickupDate&returnDate` | anyone | Dates optional, but both or neither | `200 {"kits":[{"id","name","category","replacementValueCents","dayRateCents","depositCents","rateCardVersion","readyToGo","freeForDates","price","components":[{"classId","name","replacementValueCents"}]}]}` in seed order. `freeForDates` and `price` (`{"billableDays","hirePriceCents"}`) are null without dates | `422` date fields |
| `GET /api/kits/<kitId>?pickupDate&returnDate` | anyone | Same | `200` one kit as above plus `"units":[{"serial","classId","location","status"}]`, where `status` is `free`, `booked` or `repair` with dates and null without | `422` date fields |
| `GET /api/price?kitId&pickupDate&returnDate` | anyone | All three required | `200 {"kitId","pickupDate","returnDate","hireDays","billableDays","dayRateCents","hirePriceCents","depositCents","totalCents","rateCardVersion","days":[{"day":1,"date":"…","kind":"billable"\|"free"\|"weekend"}]}` | `404` unknown kit, `422` date fields |
| `POST /api/bookings` | anyone | `{"kitId","pickupDate","returnDate","renter":{"name","email"},"units":{"<classId>":"<serial>"}}`, where `units` is optional and may name any subset of the kit's classes | `201 {"booking":<booking>,"renterKey":"<opaque>"}`, state `quote` | `404` unknown kit; `409` `unit_taken` with `error.serial` (the requested serial, or null when the server was choosing) and `error.nextFreeSerial` (another serial of that class free for the dates, lowest first, or null), message `This unit was just booked`; `422` fields `pickupDate`, `returnDate`, `renter.name`, `renter.email`, `units` |
| `GET /api/bookings/<ref>` | renter key, staff | | `200 <booking>` | |
| `GET /api/bookings?state=<state>` | staff | `state` optional | `200 {"bookings":[<booking>…]}` ordered by pickup date then ref | `422` unknown state |
| `POST /api/bookings/<ref>/certificate` | renter key, owner | multipart, one part `file` | `201 <booking>` with the new certificate `pending_review` | `409` `invalid_transition`; `422` `fields.file` `Upload the certificate as a PDF`; `503` `storage_unavailable` |
| `GET /api/certificates?status=pending_review` | owner | `status` optional | `200 {"certificates":[{"id","bookingRef","status","uploadedAt","sizeBytes"}]}` oldest first | |
| `GET /api/certificates/<id>/file` | owner | | `200 application/pdf`, the stored bytes | `503` `storage_unavailable` |
| `POST /api/certificates/<id>/review` | owner | `{"decision":"approve","coverageStart","coverageEnd","limitCents","lossPayeeNamed":true}` or `{"decision":"reject","reason"}` | `200 <booking>` | `409` `invalid_transition` (not `pending_review`); `422` fields `decision`, `coverageStart`, `coverageEnd` (`Cover must end on or after it starts`), `limitCents`, `lossPayeeNamed` (`The certificate must name Northbar Camera Hire as loss payee`), `reason` (1 to 300 characters) |
| `POST /api/bookings/<ref>/confirm` | renter key, owner | `{}` | `200 <booking>`, state `confirmed`, `paymentStatus` `paid` | `409` `invalid_transition`, `quote_expired` (`This hold has ended`), `certificate_not_approved` (`Your certificate must be approved first`), `quote_repriced` (`Prices changed`, with `error.booking` = the repriced booking), `certificate_not_stored` (`Your certificate could not be found. Upload it again.`); `402` `payment_declined` (`Payment was declined`); `503` `payments_unavailable` (`Payment service unreachable`), `storage_unavailable` (`Storage service unreachable`), `mail_unavailable` (`Mail service unreachable`) |
| `POST /api/bookings/<ref>/cancel` | renter key, owner | `{}` | `200 <booking>`, state `cancelled`, `paymentStatus` `refunded` | `409` `invalid_transition`; `503` `payments_unavailable` |
| `POST /api/bookings/<ref>/swap` | staff | `{"from":"<serial>","to":"<serial>"}` | `200 <booking>` | `409` `invalid_transition`, `unit_taken` (same extra members as above); `422` fields `from` (`<serial> is not on this booking`), `to` (`Pick a unit of the same class`) |
| `POST /api/bookings/<ref>/prep` | staff | `{}` | `200 <booking>`, state `prepped` | `409` `invalid_transition`, `unit_not_on_shelf` with `error.serials`, message `<serials> not on the shelf` (comma-separated) |
| `POST /api/bookings/<ref>/photos` | staff | multipart parts `phase` (`checkout`\|`checkin`), `serial`, `file` | `201 {"id","phase","serial","status":"stored","key"}` | `409` `invalid_transition` (wrong state for the phase); `422` fields `phase`, `serial` (`<serial> is not on this booking`), `file` (`Attach a JPEG or PNG photo`); `503` `storage_unavailable` |
| `POST /api/bookings/<ref>/checkout` | staff | `{"units":[{"serial","checklist":{"powersOn":true,"accessoriesPresent":true,"cosmeticOk":true},"notes":"…"}]}` | `200 <booking>`, state `out` | `409` `invalid_transition`, `checkout_blocked` with `error.blockers`, `photos_not_stored` with `error.serials`; `422` `fields.units` (`List every unit on this booking once`), `fields.checklist` (`Every check must be ticked`), `fields.notes` (at most 500 characters) |
| `POST /api/bookings/<ref>/checkin` | staff | `{"serial","condition":"ok"\|"damaged","damageChargeCents":0,"notes":"…"}` | `200 <booking>`, state `returned` after the last unit | `409` `invalid_transition`, `unit_already_returned` (`<serial> is already checked in`); `422` fields `serial`, `condition`, `damageChargeCents` (`Damage charges cannot exceed the $<deposit> deposit`, or `Only damaged units carry a charge`), `notes` |
| `POST /api/bookings/<ref>/close` | staff | `{}` | `200 <booking>`, state `closed` | `409` `invalid_transition`, `close_blocked` with `error.blockers`; `503` `payments_unavailable` |
| `POST /api/units/<serial>/moves` | staff | `{"to":"repair"\|"shelf"}` | `201 {"serial","location","movement":<movement>}` | `409` `illegal_move` (`<serial> can't move from <location> to <to>`); `422` `fields.to` |
| `GET /api/units/<serial>/history` | staff | | `200 {"serial","classId","location","movements":[<movement>…],"balances":{"<location>":<sum>}}`, movements oldest first, `balances` listing every location with a non-zero sum | |
| `GET /api/utilisation` | owner | | `200 {"totalUnits","onShelf","out","repair","utilisationPercent","kits":[{"kitId","readyToGo"}]}` | |
| `GET /api/rate-cards` | staff | | `200 {"activeVersion","rateCards":[{"version","effectiveDate","publishedAt","rates":[{"kitId","dayRateCents","depositCents"}]}]}`, by version ascending | |
| `POST /api/rate-cards` | owner | `{"effectiveDate","rates":[{"kitId","dayRateCents","depositCents"}]}` | `201` the new rate card | `422` fields `effectiveDate` (`Effective date must be today or later`), `rates` (`Give a day rate and deposit for every kit`) |

A `<movement>` is `{"id","at","reason":"opening"|"checkout"|"checkin"|"to_repair"|"from_repair","from","to","bookingRef","entries":[{"location":"<from>","delta":-1},{"location":"<to>","delta":1}]}`, where `bookingRef` is null for opening and repair moves.

Validation messages for shared fields:
- `pickupDate`: `Pick a pickup date from today on`.
- `returnDate`: `Return between 1 and 14 days after pickup`.
- `renter.name`: `Enter your name` (1 to 80 characters after trimming).
- `renter.email`: `Enter a valid email` (at most 254 characters, one `@`, a dot in the domain).
- `units`: `Pick a unit that belongs to this kit`.
- Money fields: `Enter a whole number of cents above zero` (at most 100,000,000).

### Business rules (DP-02, DP-07, DP-08, DP-14, DP-15, DP-17, DP-19, DP-21, DP-22, DP-23, DP-24, DP-28, DP-29, DP-30, DP-32, DP-33, DP-34, DP-35, DP-36)

**Today and dates.**
- "Today" is the server's current UTC calendar date.
- A hire runs from `pickupDate` to `returnDate`. Pickup must be today or later, and return must be 1 to 14 days after pickup, both ends allowed.
- Hire days N = return − pickup in days. Day d (1 to N) is the date pickup + (d − 1).
- Two hire ranges overlap when each one's pickup date is on or before the other's return date. A return day and a pickup day that fall on the same date therefore count as overlapping, because the shop needs that day to turn the kit round.

**House pricing.**
- **Friday weekend:** if pickup is a Friday and N is 2 or 3 (return on Sunday or Monday), billable days = 1 and every day's kind is `weekend`.
- **Otherwise:** day d is `free` when (d − 1) mod 7 is 3 or more, and `billable` otherwise, so billable days = 3 × floor(N / 7) + min(N mod 7, 3). Any 7-day block bills as 3 days: days 1–3 bill, days 4–7 are free, days 8–10 bill, days 11–14 are free.
- Hire price = billable days × the kit's day rate. Total = hire price + the kit's deposit.
- The server computes these once and stores them on the booking with the rate-card version they came from. The booking page, counter, mails and Kill Bill amounts all use the stored figures.
- For example, with the seed data at start, the Kestrel LF package costs:
  - Friday to Monday: 1 billable day, $650.00.
  - 7 days: 3 billable days, $1,950.00.
  - 10 days: 6 billable days, $3,900.00.

**Rate cards.**
- Versions are numbered upward from 1 in publish order.
- The active version is the one with the latest effective date on or before today, with the highest version number winning a tie.
- A published card must give exactly one day rate and one deposit for every kit, with an effective date of today or later. Cards are never edited.
- Holds and the price endpoint use the active version.
- At confirm, if the active version differs from the quote's stored version, the server reprices the quote under the active version (same dates and units), stores the new figures and version, and answers `quote_repriced`. The renter confirms again.
- Bookings that are already confirmed or later never change price.

**Assignment and availability.**
- A unit is held by a booking in state `quote` (hold not ended), `confirmed`, `prepped`, `out` or `returned`.
- At hold time the server assigns one serial per component class: the requested serial, or else the lowest serial (in string order) of that class that is free for the dates.
- A unit is free for a range when its current ledger location is not `repair` and no other holding booking with an overlapping range has it assigned.
- If any class has no free unit, or a requested serial isn't free, the hold fails with `unit_taken`.
- Claims are decided one at a time per unit. Of any number of simultaneous holds or swaps claiming the same unit for overlapping ranges, exactly one succeeds and the others get `unit_taken`.
- A kit's `freeForDates` is the minimum, over its component classes, of that class's units free for the range. A unit's `status` for a range is `repair` if it is in repair, `booked` if another holding booking with an overlapping range has it, and `free` otherwise.
- Swap is allowed in `quote` and `confirmed`, to a free serial of the same class, under the same claim rule.

**Hold and expiry.**
- A quote holds its units for `HOLD_SECONDS` seconds from creation (default 172800, which is 48 hours).
- The moment the hold ends, every request treats the quote as `expired`: it holds nothing and confirming it gives `quote_expired`. The server writes the `expired` state within 5 seconds of the hold ending.
- `confirmable` is true only while the booking is a quote whose hold is running and whose latest certificate is approved.

**Confirmation** (all or nothing, in this order):
1. Check the state, the hold and the certificate.
2. Reprice if needed.
3. Confirm the certificate object is present in storage.
4. Set `paymentStatus` to `pending`.
5. Record the Kill Bill purchase of the stored total.
6. Send the confirmation mail.
7. Commit `confirmed` with `paymentStatus` `paid`.

If storage is reachable but the certificate object is absent, the server makes no Kill Bill call, leaves the booking a quote with its previous `paymentStatus`, and answers `409` `certificate_not_stored`. If Kill Bill declines, the booking stays a quote with `paymentStatus` `failed` (`402`). If Kill Bill or storage is unreachable, the booking stays a quote with its previous `paymentStatus` (`503`). If the mail is refused after the payment succeeded, the server refunds the full payment in Kill Bill, leaves the booking a quote with `paymentStatus` `none`, and answers `mail_unavailable`. A booking shows `paid` only after Kill Bill has returned a successful purchase transaction. While one confirm is in flight, every other confirm of the same booking gets `invalid_transition`, so only one Kill Bill payment can exist per booking.

**State machine and rights.** Any other transition, or a transition from any other state, is `409` `invalid_transition` with message `Booking <ref> is <state>`. A role not listed for a transition gets `403` `forbidden`. The state check comes first: `checkout_blocked`, `photos_not_stored`, `close_blocked` and `unit_already_returned` are evaluated only when the booking is in that transition's From state. So a checkout request on a `confirmed` booking, a close request on an `out` booking, and a check-in request for any unit once the booking is `returned` (including a repeat of the last unit) all answer `invalid_transition`. `unit_already_returned` applies only to an `out` booking whose named unit is already checked in. The `checkout` and `close` objects on the booking resource still list their blockers in every state, for display.

| Transition | From | Who |
|---|---|---|
| hold | (new) → `quote` | anyone |
| upload certificate | `quote`, `confirmed`, `prepped` | renter key, owner |
| review certificate | certificate `pending_review` → `approved` or `rejected` | owner |
| expire | `quote` → `expired` | server only |
| confirm | `quote` → `confirmed` | renter key, owner |
| cancel | `confirmed` → `cancelled` | renter key, owner |
| swap | `quote`, `confirmed` | owner, prep tech |
| prep | `confirmed` → `prepped`, only when every assigned unit's location is `shelf` (otherwise `unit_not_on_shelf`) | owner, prep tech |
| checkout photo | `prepped` | owner, prep tech |
| checkout | `prepped` → `out` | owner, prep tech |
| check-in photo | `out`, `returned` | owner, prep tech |
| check-in unit | `out` (the last unit turns it `returned`) | owner, prep tech |
| close | `returned` → `closed` | owner, prep tech |

**Certificates.**
- A new upload becomes the booking's certificate and replaces any earlier one for confirmability and checkout.
- Approval needs cover start on or before cover end, a limit, and the loss-payee check set to true.

**Checkout gate.** `checkout.allowed` is true only when the booking has no blockers. Blockers, in this order:
- `not_prepped`: `Kit is not prepped`.
- `certificate_missing`: `No approved certificate of insurance`, when the latest certificate isn't approved.
- `certificate_dates`: `Certificate does not cover every hire day`, unless cover start is on or before pickup and cover end is on or after return.
- `certificate_limit`: `Certificate limit is below the kit replacement value`, unless the limit is at least the booking's `replacementValueCents` (the sum of its units' replacement values).

The server recomputes the gate on every read. A checkout request additionally needs every unit listed once with every check ticked, and at least one `stored` checkout photo per unit.

**Photos.**
- The server records a photo as `pending` before writing it to storage.
- It marks the photo `stored` only after storage acknowledges the write, and `failed` if storage refuses or can't be reached.
- Only `stored` photos count toward any rule.

**Check-in.**
- Each unit is checked in once. `ok` sends it to `shelf` and `damaged` sends it to `repair`.
- An `ok` unit carries a damage charge of 0. A damaged unit carries 0 or more.
- The booking's damage total may not exceed its deposit, and reaching the deposit exactly is allowed.

**Close gate.** `close.allowed` is true only when the booking has no blockers:
- `not_returned`: `Not every unit is checked in`.
- `photos_not_stored`: `Condition photos are not stored for <serials>`, comma-separated, for every unit without at least one `stored` check-in photo.

On close, the server:
1. Records the damage invoice in Kill Bill if the damage total is above zero.
2. Refunds deposit − damage in Kill Bill if that is above zero.
3. Stores `damageCents` (the damage total) and `refundCents` (deposit − damage, which is 0 when damage equals the deposit), and sets `paymentStatus` to `refunded` when `refundCents` is above zero, or leaves it `paid` when `refundCents` is 0.
4. Sends the return receipt.
5. Commits `closed`.

If Kill Bill fails, nothing changes and the close answers `503` `payments_unavailable`. If the receipt mail is refused after Kill Bill succeeded, the booking still closes and the close answers `200`; that receipt is never resent, by a replay or by any other request.

**Cancellation.** The server refunds the whole stored total in Kill Bill, then commits `cancelled` with `paymentStatus` `refunded` and `refundCents` equal to the stored total (`damageCents` stays 0), which releases the units. If Kill Bill fails, nothing changes.

**Movement ledger.**
- Locations are `acquired` (the opening counterparty), `shelf`, `repair` and `booking:<ref>`.
- Every move of a unit is one movement with exactly two entries: −1 at its `from` location and +1 at its `to` location.
- Movements are never edited or deleted, and a correction is a further movement.
- Moves:
  - Checkout moves each unit `shelf` → `booking:<ref>` (reason `checkout`).
  - Check-in moves it `booking:<ref>` → `shelf` or `repair` (reason `checkin`).
  - Repair moves are `shelf` → `repair` (`to_repair`) and `repair` → `shelf` (`from_repair`). Any other manual move, or a move to the unit's current location, is `illegal_move`.
- A unit's `location` is the one location other than `acquired` whose entries sum to 1. Its balances are always `acquired` −1 and that location +1.

**Derived counts.** These are computed from the ledger's current locations (and, for `freeForDates`, the holding bookings' assignments), never from separately kept counters:
- `readyToGo` for a kit is the minimum, over its component classes, of that class's units located on `shelf`.
- Utilisation: `onShelf`, `out` (units at any `booking:<ref>`) and `repair` sum to `totalUnits`. `utilisationPercent` = out × 100 / total, rounded half up to a whole number.
- After every checkout, check-in or repair move, the next read of all three reflects it.

**Concurrency for writes.** Every transition is decided on the stored state at the moment it applies. Two simultaneous transitions on one booking produce one success, and every other attempt gets the conflict its now-current state calls for.

### Services (DP-11, DP-12, DP-14, DP-15, DP-16, DP-29, DP-30, DP-35, DP-37, DP-38, DP-46)

**Postgres** holds the catalogue, unit classes and serial units, kit compositions, bookings and their stored prices, rate-card versions, certificates and their review data, photo records, idempotency records, staff sessions and the movement ledger. Several app instances may serve the same database at once. The schema and the seed are applied on every serve, are safe to run concurrently, and never duplicate seed rows.

**Kill Bill** (tenant from `KILLBILL_API_KEY` and `KILLBILL_API_SECRET`):
- **Account.** One account per renter, external key = the renter's email in lower case, name = renter name, currency `USD`. Its default payment method uses Kill Bill's built-in `__EXTERNAL_PAYMENT__` plugin. The account is created at the renter's first confirm and reused after that.
- **Confirm.** A `PURCHASE` payment on that account with payment external key `<ref>` and transaction external key `<ref>-confirm`. The amount is the stored total in dollars with two decimals.
- **Cancel.** A refund of the full purchase amount on that payment, with transaction external key `<ref>-cancel`.
- **Close.** If damage is above zero, an external charge invoice on the account for the damage total, description `Damage · <ref>`. Then, if above zero, a refund of deposit − damage on the purchase payment, with transaction external key `<ref>-refund`.
- **Unreachable.** Any Kill Bill call that can't connect, or gets no answer within 5 seconds, fails the action with `503` `payments_unavailable`. Holds, pricing, certificates, prep, checkout and check-in keep working.

**MinIO** (bucket `S3_BUCKET`, which the app creates at serve if it is missing):
- Certificates are stored at key `certificates/<ref>/<certificateId>.pdf` with content type `application/pdf`, holding the uploaded bytes exactly.
- Condition photos are stored at key `photos/<ref>/<phase>/<serial>/<photoId>.jpg` or `.png`, with matching content type `image/jpeg` or `image/png`.
- Uploads and the certificate file fetch go through the app. The browser never talks to storage directly.
- Unreachable (no connection or no answer within 5 seconds): uploads, the certificate file fetch and confirmation fail with `503` `storage_unavailable`. A failed certificate upload leaves no certificate record. A failed photo upload leaves a `failed` photo record.

**Mailpit** (SMTP at `SMTP_HOST`:`SMTP_PORT`, plain text bodies, From `Northbar Camera Hire <desk@northbar.example>` read from `MAIL_FROM`). Each mail goes to the renter's email, is sent at most once per booking and event, and is never re-sent on an idempotent replay. Money in mail bodies uses the `$<amount>` format.
- **Confirmation.** Subject `Booking confirmed · <ref> · <kit name>`. Body lines:
  - One line per unit: `<serial> · <class name>`.
  - `Pickup <date> · Return <date>`
  - `Billable days: <n>`
  - `Day rate: $<amount>`
  - `Hire: $<amount>`
  - `Deposit: $<amount>`
  - `Charged: $<amount>`
  - `Rate card: v<n>`
- **Certificate rejected.** Subject `Certificate not accepted · <ref>`. The body includes the line `Reason: <reason>`.
- **Return receipt.** Subject `Return receipt · <ref>`. Body lines:
  - One line per unit: `<serial> · OK`, or `<serial> · Damaged · $<charge>`.
  - `Damage charge: $<amount>`
  - `Deposit refunded: $<amount>`

### Seed data (DP-01, DP-02, DP-20, DP-32, DP-34, DP-40)

Every person, business, product name and serial here is invented. At start there are no bookings, no certificates, no photos and no sessions. Booking refs are issued in sequence from `NB-10001` in each database.

Staff passcodes: owner `northbar-owner-4417`, prep tech `northbar-prep-2093`.

| Kit id | Kit name | Category | Component classes (class id: name, replacement value each, serials) |
|---|---|---|---|
| `kestrel-lf` | Kestrel LF Camera Package | Camera | `kestrel-lf-body`: Kestrel LF body, $48,000.00, `KLF-001`, `KLF-002`; `halden-primes`: Halden Prime Set, $32,000.00, `HPS-01`, `HPS-02`, `HPS-03`; `field-monitor`: Field monitor and power kit, $3,500.00, `FMP-01`, `FMP-02`, `FMP-03` |
| `wren-s35` | Wren S35 Documentary Kit | Camera | `wren-s35-body`: Wren S35 body, $14,000.00, `WS35-01`; `tor-zoom`: Tor 18-80 zoom, $9,000.00, `TZ-01`, `TZ-02` |
| `lantern-led` | Lantern 4-Light LED Package | Lighting | `lantern-panels`: Lantern panel set, $7,200.00, `LP-01`, `LP-02`; `stand-grip-case`: Stand and grip case, $1,300.00, `SG-01`, `SG-02`, `SG-03` |

Kit replacement values (the sum of one unit per class): Kestrel LF $83,500.00, Wren S35 $23,000.00, Lantern $8,500.00.

Rate card v1, effective `2026-01-01`, contains:

| Kit | Day rate | Deposit |
|---|---|---|
| Kestrel LF | $650.00 | $2,500.00 |
| Wren S35 | $280.00 | $1,000.00 |
| Lantern | $180.00 | $500.00 |

Ledger at start:
- Every unit has one `opening` movement `acquired` → `shelf`.
- `SG-03` also has a `to_repair` movement `shelf` → `repair`.

For example, with the seed data at start:
- Utilisation: 16 total, 15 on the shelf, 0 out, 1 in repair, 0%.
- Ready to go: Kestrel LF 2, Wren S35 1, Lantern 2.

## Technical requirements

### Deployment (DP-39)

- The runtime is Node.js 22 LTS with npm, and the app is written in TypeScript.
- `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, for example:
  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```
- The served process binds `0.0.0.0` on the port in `APP_PUBLIC_PORT` (default 4173).
- `GET /api/health` answers `200 {"status":"ok"}` as soon as the app can reach Postgres, whatever the state of Kill Bill or storage.
- `serve` applies the schema and seed itself. Nothing depends on `build` having touched the database.

### Configuration and secrets (DP-42, DP-46)

The app reads every value below from the environment at start, and never hard-codes any of them or sends them to the browser:
- `DATABASE_URL`.
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- `HOLD_SECONDS` (a positive whole number of seconds; default 172800 when unset).
- `APP_PUBLIC_PORT`.

The staff passcodes live in the seed, not in the browser bundle.

### Server boundary (DP-42)

- **Origin.** The app serves its pages, assets and API from one origin. A state-changing request whose `Origin` header is present and differs from the app's own origin is `403` `cross_origin`. No CORS headers are sent.
- **Content type.** JSON endpoints accept `application/json` only, and the upload endpoints accept `multipart/form-data` only. Anything else is `415`.
- **Size limits.** A JSON body is at most 100,000 bytes. An uploaded file is at most 5,000,000 bytes, and exactly 5,000,000 is allowed. Anything larger is `413` `too_large`.
- **File types.** A certificate must begin with the bytes `%PDF-`. A photo must be a JPEG or PNG judged by its first bytes, not its name.
- **What is never served.** Source files, source maps of server code, `run.json`, package manifests, lockfiles, environment files and any credential. For example, `/.env`, `/package.json` and `/run.json` answer `404`.
- **Unknown routes.** An unknown page route answers `404` with the not-found page.
- **Boot.** If Postgres is unreachable at boot, the server retries for up to 60 seconds before exiting. If Kill Bill or storage is unreachable at boot, the server still starts, serves every page and answers health, and those providers' actions fail as Services describes.

### Browser support and performance (DP-05, DP-26, DP-44)

- **Browsers.** Current Chromium, Firefox and WebKit.
- **Viewports.** 375x812, 768x1024 and 1280x800.
- **Loading.** With the seed data, the catalogue and the counter are usable within three seconds of navigation.
- **Responsiveness.** A server price arrives on screen within one second of the return handle coming to rest. Each counter scan opens its unit within half a second.
- **Error answers.** Every API call that fails on a provider answers within 6 seconds.

## Working rules

- IF-01: `/app/run.json` exists with string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build and serve.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) with its version and licence, plus the two fonts and the icon set.
- IF-03: Every shipped package is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0. Fonts are under OFL-1.1 and icons are Lucide (ISC).
- IF-04: The app uses no datastore other than the provided Postgres and MinIO: no SQLite, no file-based database, no in-memory store as a system of record, no extra containers.
- IF-05: Fonts, icons and scripts are served from the app itself, and no page loads anything from a third-party origin at run time.
- IF-06: The provided service configuration (compose files, development environment values and seed credentials of the services) is left unmodified.

## Engineering standards

- The TypeScript compiles under `strict` with no `any`, no `@ts-ignore`, and no non-null assertions used to silence real nullability.
- Names in the source match the domain terms in this brief: booking, quote, hold, kit, unit class, serial unit, rate card version, certificate, movement, entry, billable days, ready to go.
- Each domain rule is decided in exactly one place in the source: the billable-day calculation, unit availability, the state transitions and their rights, the checkout and close gates, and the derived counts. The browser renders the server's results and never re-derives them.
- Every API error is produced through one error shape with the precedence stated in API. There are no ad hoc error bodies.
- Provider effects (Kill Bill payments, refunds and invoices, storage writes, mail sends) are recorded only from the provider's actual answer, and no code path marks one as done without it.
- No abstraction has a single implementation, and there are no defensive checks for states the rules make impossible.
- There is no dead, commented-out or unreachable code, and no feature, endpoint or screen beyond this brief.
- Database writes that must happen together (a movement's two entries, a transition with its stored price) commit in one transaction.
