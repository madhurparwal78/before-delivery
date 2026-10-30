# Night Shift Commons Pilotlight

Pilotlight is a booking and billing tool for independent shared commercial kitchens: commissary and incubator kitchens that rent licensed stations by the hour to caterers, food trucks, bakers and packaged-food startups. It serves three people: the kitchen operator, the member food businesses who book stations, and an outside bookkeeper who reconciles the month. Members paint a production run across stations and times on a station loom and see the real tier-aware price before the server holds the time. Pilotlight confirms bookings only for dates their compliance papers cover. It posts confirmed bookings and prepaid hour packs to the billing system, stores certificates and cards in private file storage, and sends booking, cancellation and expiry emails. It uses four backend services: PostgreSQL as the only system of record, Kill Bill for billing accounts and invoices, MinIO-compatible object storage for document files, and an SMTP mail sink with an inspection API. Out of scope: self-service sign-up, password reset, online card payment, payroll, inventory, menus, multi-building operators, any datastore other than PostgreSQL, and any network service not named here. Seeded users sign in with email and password, and nobody can create accounts.

## Problem and users

Independent shared-kitchen operators run one building with six to fifteen bookable stations: deck ovens, a 60-quart mixer, a blast chiller, prep tables, a steam kettle, a walk-in cooler. Most still sell that time through text messages, a shared calendar and a spreadsheet of tiered hourly rates. This has real costs. Two members turn up for the one blast chiller at 05:00. Bookings are taken from members whose certificate of insurance or food-handler card lapsed last week, which puts the operator's county permit at risk. A weekly early-morning bake slot moves by an hour after a daylight-saving change. Hand-built invoices undercharge on volume tiers or charge twice for prepaid hours. The operator loses revenue, gives away comped hours after disputes and carries compliance exposure. Members lose production days.

- **Kitchen operator** (daily): keeps every station sold without conflicts, bills exactly, and never lets a non-compliant member cook. Reviews uploaded papers, sets rates and the cancellation window, runs the day sheet (check-ins, completions, no-shows), and books for members.
- **Member food business** (weekly): books the stations a production run needs, sees the real price before committing, pays with prepaid hours when it has them, cancels when plans change, and keeps its insurance certificate and food-handler card current.
- **Outside bookkeeper** (occasional): is invited to exactly one kitchen and pulls a month's usage, pack balances and invoices to reconcile against the billing system.

## Journeys

1. **Brush and confirm a production run.** Start: Priya from Ember & Rye Bakery is signed in on the loom. The bakery has no bookings this month and its papers are current. Priya picks a date next week and drags across Deck oven 1 down to the Blast chiller, from 04:00 to 06:15. The cells fill amber. The four stations light up in the floor plan, and the rail counts up to the tier-aware total, noting the step into tier 2. On release the block is held and a countdown bar starts. Priya presses Confirm booking, checks the summary in the dialog and confirms. End: the cells show as booked, the loom status shows the booking reference, one confirmation email reaches the bakery, and the booking and its invoice appear on the Bookings and Billing screens.
2. **Two members race for the blast chiller.** Start: Saltline Catering and Wren Street Dumplings both have the same date open on the loom. Both brush the Blast chiller from 05:00 to 07:00 within the same second. End: one of them holds the block. The other sees those cells flip to "taken", the floor-plan contour dims, the total counts back down, and the loom status says nothing was held.
3. **Pay with pack hours, then cancel in window.** Start: Ember & Rye has a 20-hour pack on file. Priya buys a second pack on the Billing screen, books a block with Use pack hours ticked and sees the balance fall. A week before the date, Priya cancels the booking from its detail panel. End: the cancel dialog showed the refund before Priya committed. The booking shows as cancelled in window, the pack hours come back as a refund movement, a cancellation receipt email arrives, and the cells are free again.
4. **Raise the rates from a date.** Start: Dana, the operator of Night Shift Commons, is on the Rates screen with the seeded rate card in force. Dana adds a rate card with higher hourly rates and a shorter cancellation window, effective from a chosen date. End: the Rates screen lists both cards. Bookings confirmed earlier still show the old lines, total and window on their detail, invoice and cancel dialog. Bookings confirmed once the new card is in force use the new terms.
5. **Set up a weekly Tuesday 04:30 bake slot.** Start: Priya is on the loom on a Tuesday in early March, the week before the spring clock change. Priya brushes Deck oven 1 and Deck oven 2 from 04:30 to 06:30, opens Repeat weekly, chooses 4 weeks and books the series. End: four bookings appear on the Bookings screen, every one at 04:30 kitchen time, including those after the clock change. There is one invoice for the whole series and one confirmation email that lists all four weeks.
6. **Keep papers current.** Start: Tidewater Granola's insurance certificate expired yesterday. Aoife from Tidewater opens the loom. Every cell shows the dotted "papers" fill, and brushing explains why no hold is possible. Aoife uploads a new certificate on the Papers screen. Dana sees it under Documents to review and verifies it. End: the loom for covered dates shows free cells, and Tidewater can hold them. Separately, Wren Street Dumplings' certificate expires in under 14 days. The member and the operator each get one reminder email, and the document shows as expiring.
7. **Run the day with billing down.** Start: Dana opens Pilotlight on a morning when billing is unreachable. The service banner names exactly the paused actions. Brushing and holds still work, and Confirm answers with the billing-down message and releases the hold. Dana opens Bookings for today, checks Saltline in, later marks the booking completed, and marks another booking as a no-show. End: the day sheet shows each booking's new state. When billing comes back, the banner says so and confirming works again without anyone restarting the app.
8. **Reconcile a month.** Start: Ines, the bookkeeper invited to Night Shift Commons, signs in and lands on Reports. Ines picks the month and reads usage by member, station occupancy and invoices, then downloads the CSV. End: every invoice row carries the billing invoice id and an amount equal to the billing system's invoice total. No Larkspur Commissary member, booking or amount appears anywhere, and requesting Larkspur's report is answered as not found.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** The app installs, builds and serves from the run manifest and answers the health check, as specified in Deployment.
- **DP-02 — Credentials from the environment** Every service URL and credential is read from the environment at start and is never hard-coded in source or sent to the browser.
- **DP-03 — Server boundary** The server accepts only same-origin requests within the published size and type limits and never serves source, configuration or credentials, as qualified in Server boundary.
- **DP-04 — One error shape** Every API error uses the single error body and the single precedence order defined in API.
- **DP-05 — Sign-in and roles** Seeded operators, members and the bookkeeper sign in with email and password, and each role reaches only the actions Business rules grants it.
- **DP-06 — Three viewports, no sideways scroll** Every screen fits 375x812, 768x1024 and 1280x800 with no sideways page scrolling, arranged as described in Screens and layout.
- **DP-07 — After-hours look** Screens use the near-black ground, warm ink, steel rules, a single pilot-light amber reserved for lit, held or owed things, serif display figures and mono numerals described in Visual design.
- **DP-08 — Procedural floor plan** The top band draws the kitchen's floor plan from its station list as thin steel contours, one shape per station kind, with no imported imagery.
- **DP-09 — Reduced-motion substitutes** When the device asks for reduced motion, every motion is replaced by the instant or static substitute listed in Motion and effects.
- **DP-10 — Contrast and tap targets** Text, icons and cell patterns meet the contrast ratios in Visual design, and every button, link, checkbox, menu item and touch-mode loom cell is at least 44 by 44 pixels.
- **DP-11 — Station loom** The loom shows one row per station and 80 quarter-hour columns from 04:00 to 24:00 kitchen time, with station labels pinned at the left, exposed as the grid in Public screens and controls.
- **DP-12 — Cell states by pattern and label** Selected, held, booked, taken, conflicting and papers cells each have their own pattern, icon and text label as well as colour, as specified in Visual design.
- **DP-13 — Brush a production run** A member paints a block across stations and times, sees free, taken and papers cells and the tier-aware price while painting, and releases it into a hold.
- **DP-14 — Floor-plan lighting** Each brushed station's contour lights amber in row order with a short stagger, and dims when the station leaves the brush or loses its cells.
- **DP-15 — Counting quote total** The rail total counts from the previous amount to the new server price in about a third of a second and lists hours per station and each tier step crossed.
- **DP-16 — Keyboard-complete booking** Brushing, extending, holding, clearing and confirming all work by keyboard alone, and every dialog traps focus, closes on Escape and returns focus to its opener.
- **DP-17 — Brush in the address** The page address carries the date, the chosen stations and the pending brush, so a reload restores the same brush.
- **DP-18 — Quotes** `POST /api/quotes` prices any set of cells for a member in exact cents without holding anything.
- **DP-19 — Holds** `POST /api/holds` holds every free requested cell for the published hold time and reports the cells it could not take.
- **DP-20 — One winner per cell** When several requests claim the same cell at the same moment, exactly one gets it, and every other request is told the cell is taken.
- **DP-21 — Server-judged hold expiry** The server alone decides whether a hold is still live, using the duration and edge stated in Business rules, whatever the browser clock says.
- **DP-22 — Held cells and lost cells** Held cells show a thin amber frame and a bar that empties toward the server's expiry, and cells the server refused flip to taken while the total counts down.
- **DP-23 — Same-day cutoff in kitchen time** Holds for today close at the kitchen's same-day cutoff, and every date and time is a kitchen date and time whatever zone the device is set to.
- **DP-24 — Confirm a held block** A member confirms a held block from the rail, sees the booking reference, and finds the booking and its invoice on their own screens.
- **DP-25 — Tiered price in exact cents** Every quote, booking and invoice uses the marginal monthly tiers, station surcharges and the single rounding rule in Business rules.
- **DP-26 — Confirm at the quoted price** A confirm whose quoted total no longer matches the server's price is refused with the fresh quote and books nothing.
- **DP-27 — Confirm retries** Repeating a confirm with the same idempotency key returns the original booking without a second charge or email, and reusing a key for a different request is refused.
- **DP-28 — All-or-nothing confirm** A confirm creates the booking, its billing charges and its confirmation email together, or none of them and releases the hold.
- **DP-29 — Billing charges per booking** Each confirm posts its cash lines to the member's billing account as one billing invoice whose total equals the Pilotlight invoice total to the cent.
- **DP-30 — Confirmation email** Each confirm sends exactly one confirmation email and each weekly series sends exactly one listing every week, addressed only to that member and containing only that member's details.
- **DP-31 — Buy a 20-hour pack** A member, or the operator on their behalf, buys a 20-hour pack, which charges the pack price to billing and adds 80 quarter-hours to the member's pack.
- **DP-32 — Drawing pack hours** A confirm that pays with pack hours draws them in cell order and prices drawn cells at zero, as qualified in Business rules.
- **DP-33 — Paired pack ledger** Every pack purchase, draw and refund is one movement of two opposite entries, and the pack balance always equals the sum of the member's entries.
- **DP-34 — Pay with pack hours** A member buys a pack, books with pack hours and sees the balance and movements change on the Billing screen.
- **DP-35 — Cancellation window** A cancellation made at or before the booking's stored window is in window and any later one is late, judged by the server clock.
- **DP-36 — Cancellation refunds and receipt** An in-window cancel refunds drawn pack hours and the cash total, a late cancel refunds nothing, and both free the cells and send one receipt email.
- **DP-37 — Cancel a booking** A member cancels a booking from its detail panel, sees the refund outcome before and after committing, and sees the booking's new state.
- **DP-38 — Effective-dated rate cards** The operator adds a rate card that takes effect from a chosen kitchen date, and existing rate cards are never edited.
- **DP-39 — Quoted terms kept** A booking keeps the rates and cancellation window in force when it was confirmed, on every screen, invoice and cancellation.
- **DP-40 — Change the rates** The operator adds a rate card on the Rates screen and sees which card each booking was priced on.
- **DP-41 — Weekly recurring slots** A member books the same stations and times weekly for 2 to 12 weeks in one all-or-nothing request with one idempotency key.
- **DP-42 — Wall-clock across DST** Every occurrence of a recurring slot starts and ends at the same kitchen wall-clock times across daylight-saving changes.
- **DP-43 — Set up a weekly bake slot** A member turns a brushed block into a weekly series from the loom and sees each week's booking listed.
- **DP-44 — Document upload limits** Compliance uploads accept only PDF, PNG or JPEG files, judged by their bytes, up to the published size and with safe file names.
- **DP-45 — Private document files** Each document file is stored under a server-made key and served only to its member and to their kitchen's operator.
- **DP-46 — Document review states** The operator moves documents from uploaded to verified or rejected, and documents become expiring and expired by kitchen date.
- **DP-47 — Expiry reminder** When a verified document is 14 days or less from expiry, its member and the kitchen operator each receive one reminder email, as qualified in Business rules.
- **DP-48 — Upload and verify papers** A member uploads a certificate, the operator verifies it, and both see its state on the Papers screen.
- **DP-49 — Compliance gate** Quotes mark, and holds, confirms and recurring slots refuse, every date not covered by a verified insurance certificate and a verified food-handler card.
- **DP-50 — Blocked by papers** A member whose papers do not cover a date sees papers cells and the reason on the loom and cannot hold them.
- **DP-51 — Booking lifecycle** Bookings move only along the legal transitions in Business rules, and every illegal move is refused with the current and requested states.
- **DP-52 — Run the day sheet** The operator opens a day's bookings and checks members in, marks bookings completed and marks no-shows.
- **DP-53 — Own records only** A member can read only their own bookings, holds, invoices, documents and pack, and any other id is answered as not found.
- **DP-54 — Anonymous occupancy** Members see other members' cells only as taken, with no name, reference, id or price anywhere in the page or the API response.
- **DP-55 — Invoices match billing** Each invoice shows its priced lines, the matching billing invoice id and the billing system's amount for it.
- **DP-56 — Review my bookings and invoices** A member opens a booking, then its invoice, and finds the booking's lines on it, with the same total when the invoice covers one booking.
- **DP-57 — One-kitchen usage report** The monthly usage report and its CSV cover only the requested kitchen's month in kitchen time and are open only to its operator and its invited bookkeeper.
- **DP-58 — Reconcile a month** The bookkeeper opens a month's report, downloads the CSV and matches each invoice to its billing invoice.
- **DP-59 — Boot with a service down** With billing or file storage unreachable the app still starts, names the paused actions in a banner and refuses only those actions.
- **DP-60 — Recover without restart** Paused actions resume on their own once the service returns, within the recovery time stated in Services, without restarting the app.

## Frontend

### Screens and layout (DP-06, DP-07, DP-08, DP-11)

Every screen sits on the same near-black ground. The top bar carries the brand "Pilotlight", the kitchen name, the main navigation and a Sign out button. The service status banner sits directly under the top bar and stays empty and takes no space while every service is up.

- **Sign in** (`/signin`): a centred narrow column with the serif wordmark, the Email and Password fields and the Sign in button. Anyone signed out who opens any other screen comes here. After sign-in, operators and members land on the Loom, and the bookkeeper lands on Reports.
- **Loom** (`/loom`, operator and member): three stacked parts.
  1. A fixed top band holds the floor plan: one thin steel contour per station, drawn by the app from the kitchen's station list. Ovens are rectangles with a door line, mixers and kettles are circles, the blast chiller and walk-in are squares with a door swing, the range is a rectangle with four burner rings, and prep tables are long thin rectangles. Stations follow loom order around a U-shaped line, each with its name in small caps.
  2. Below the band, the station loom runs edge to edge. Each station is a row and each quarter hour from 04:00 to 23:45 is a column, with hour labels every four columns. Station labels stay pinned at the left while the cells scroll sideways inside the loom. The loom header shows the kitchen date and the words "Kitchen time" with the kitchen's zone name. The date controls, the Stations button and, for operators, the Book for member picker sit above the loom.
  3. A narrow right rail shows the live quote: the total in large serif numerals, the hours per station and tier as mono line items, the tier step crossed, the Use pack hours checkbox and the hold controls.
- **Bookings** (operator, member, bookkeeper): members see their own bookings, upcoming first. Operators see the day sheet for the chosen date, and the bookkeeper sees the kitchen's bookings read-only. Selecting a booking opens its detail panel: reference, date, stations and times, lines, total, pack hours used, the rate card it was priced on, its cancellation window and its state.
- **Papers** (operator, member): members see their documents and the upload form. Operators see Documents to review (uploaded documents first) and every member's documents with their states.
- **Billing** (member): the pack balance in large serif numerals, the Buy 20-hour pack button, pack movements and invoices. Selecting an invoice opens its detail.
- **Members** (operator): one row per member showing business, contact, the date papers are covered until, month-to-date hours and pack balance. Each row has a Buy 20-hour pack action for that member.
- **Rates** (operator): the same-day cutoff setting, the rate card list (newest effective date first) and the New rate card form.
- **Reports** (operator, bookkeeper): a month picker, then Usage by member, Station occupancy and Invoices tables and the Download CSV link.

Secondary screens (everything except Loom) use wide editorial rows separated by single steel hairline rules, with generous line spacing and mono numerals right-aligned in their columns.

Viewports, with no sideways page scrolling at any of them:
- **1280x800**: the floor-plan band takes about a fifth of the screen height. The loom fills the width left of a rail about a quarter of the screen wide, and the loom scrolls sideways inside its own frame. Secondary screens use one wide column with a centred reading measure.
- **768x1024**: the floor-plan band shrinks to about a sixth of the height. The rail moves below the loom as a full-width panel. Tables keep all columns.
- **375x812**: the floor-plan band becomes a thin strip of station contours about one eighth of the height. The loom scrolls sideways inside its frame with the station labels pinned. The rail collapses to a bar fixed at the bottom showing the total and a Show quote button that expands the full rail as a sheet. Navigation collapses into a Menu button. Tables turn each row into a stacked card with label and value pairs.

### Public screens and controls (DP-05, DP-11, DP-12, DP-14, DP-15, DP-16, DP-17, DP-22, DP-24, DP-34, DP-37, DP-40, DP-43, DP-48, DP-50, DP-52, DP-56, DP-58, DP-59)

Only the roles and names below are public; every other element is free.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| All | `navigation "Main"` | links "Loom", "Bookings", "Papers", "Billing", "Members", "Rates", "Reports", each shown only to roles that can use it |
| All | `button "Menu"` (375 wide only) | "Menu" |
| All | `button "Sign out"` | "Sign out" |
| All | `status "Service status"` | the outage and recovery copy from Feedback states |
| Sign in | `textbox "Email"`, field labelled "Password", `button "Sign in"` | "Email", "Password", "Sign in" |
| Sign in | `alert` | the sign-in error copy |
| Loom | `group "Kitchen floor plan"` | station contours |
| Loom | `img "<station name>"` per station, named `"<station name>, lit"` while lit | station name in small caps |
| Loom | field labelled "Kitchen date" (a date input) | the kitchen date |
| Loom | `button "Previous day"`, `button "Next day"`, `button "Today"` | arrows and "Today" |
| Loom | `button "Stations"` opening `dialog "Choose stations"` with one `checkbox "<station name>"` per station and `button "Apply"` | "Stations", "Apply" |
| Loom (operator) | `combobox "Book for member"` | member business names |
| Loom | `grid "Station loom"`, one `row` per station with a `rowheader` naming the station, `columnheader` per quarter hour named `"HH:MM"` | hour labels |
| Loom | `gridcell` per station and quarter hour, named `"<station name>, <HH:MM>, <label>"`, where `<label>` is one of free, selected, held, booked, taken, taken conflicts with your brush, papers; for operators, booked and held cells of members use `"booked by <business>"` or `"held by <business>"` | the visible run label from Visual design |
| Loom | `list "Loom legend"` with items "Selected", "Held", "Booked", "Taken", "Conflict", "Papers" | a pattern swatch and the state's icon beside each |
| Loom | `status "Loom status"` | hold, conflict, papers and confirm copy |
| Loom | `complementary "Quote"` | the rail |
| Loom | `group "Quote total"` | the total as `$<amount>` |
| Loom | `list "Quote lines"` | one item per line: station, tier, hours, amount; pack lines read "pack" in place of the amount |
| Loom | `status "Quote announcement"` | the final total announcement |
| Loom | `checkbox "Use pack hours"` | "Use pack hours (<hours> h left)" |
| Loom | `button "Place hold"`, `button "Clear brush"` | "Place hold", "Clear brush" |
| Loom | `progressbar "Hold time left"` | a thin amber bar; value is seconds left |
| Loom | text "held until <HH:MM>" | shown under reduced motion and in the rail beside the bar |
| Loom | `button "Confirm booking"`, `button "Release hold"`, `button "Repeat weekly"` | same as names |
| Loom (375 wide) | `button "Show quote"` | "Show quote" |
| Loom | `dialog "Confirm booking"` with `checkbox "Use pack hours"`, `button "Confirm"`, `button "Back"` | summary of date, stations, times, lines, total and cancellation window |
| Loom | `dialog "Repeat weekly"` with `spinbutton "Weeks"` (2 to 12), `button "Book series"`, `button "Back"` | each week's date and total, then the series total |
| Bookings | field labelled "Date" (operator and bookkeeper) | the kitchen date |
| Bookings | `table "Bookings"` | columns Reference, Date, Stations, Time, Member (operator and bookkeeper only), Hours, Total, State |
| Bookings | `region "Booking <ref>"` | the detail panel |
| Bookings | `button "Cancel booking"` | "Cancel booking" |
| Bookings | `dialog "Cancel booking"` with `button "Yes, cancel"` and `button "Keep booking"` | the cancel preview copy |
| Bookings (operator) | `button "Check in"`, `button "Mark completed"`, `button "Mark no-show"` | same as names |
| Bookings | `link "Invoice <invoice ref>"` | the invoice reference |
| All forms | `status "Form status"` | pending, success and error copy for that screen |
| Papers | `table "My documents"` (member), `table "Documents to review"` and `table "All documents"` (operator) | columns Type, Member (operator only), Expires, State, File |
| Papers | `form "Upload document"` with `combobox "Document type"`, field labelled "Expiry date", field labelled "File", `combobox "Member"` (operator only), `button "Upload"` | "Upload" |
| Papers | `link "Open <document label>"` | opens the file |
| Papers (operator) | `button "Verify"`, `button "Reject"`, `dialog "Reject document"` with `textbox "Reason"` and `button "Reject document"` | same as names |
| Billing | `heading "Pack balance"` and the balance text `<hours> hours` | |
| Billing, Members | `button "Buy 20-hour pack"` | "Buy 20-hour pack" |
| Billing | `table "Pack movements"` | columns Date, Kind, Hours, Booking, Balance after |
| Billing, Reports | `table "Invoices"` | columns Invoice, Kind, Issued, Total, Billing invoice, Billing amount |
| Billing | `region "Invoice <invoice ref>"` | lines and totals |
| Members | `table "Members"` | columns Business, Contact, Papers covered until, Hours this month, Pack balance |
| Rates | field labelled "Same-day cutoff", `button "Save cutoff"` | "Save cutoff" |
| Rates | `table "Rate cards"` | columns Effective from, Tier 1, Tier 2, Tier 3, Tier 4, Cancellation window, Pack price, In force |
| Rates | `form "New rate card"` with fields labelled "Effective from", "Tier 1 hourly rate", "Tier 2 hourly rate", "Tier 3 hourly rate", "Tier 4 hourly rate", "<station name> surcharge" per station, "Cancellation window (hours)", "Pack price", and `button "Add rate card"` | same as labels |
| Reports | field labelled "Month" | "Month" |
| Reports | `table "Usage by member"`, `table "Station occupancy"` | Business, Booked hours, Cancelled in window hours, Billed, Refunded, Pack balance; Station, Booked hours |
| Reports | `link "Download CSV"` | "Download CSV" |

### Interactions (DP-13, DP-14, DP-16, DP-17, DP-22, DP-24, DP-37, DP-43, DP-52)

Brushing with a pointer:
1. Pressing on a loom cell sets the brush anchor. While the pointer moves, a rectangle from the anchor to the cell under the pointer is selected, snapped to whole quarter-hour columns and whole station rows. A pointer outside the grid clamps the rectangle to the grid edge.
2. While painting, free cells inside the rectangle show the selected state, taken cells inside it show the conflict state, and papers cells keep the papers state. Each station row that has selected cells lights its floor-plan contour. The rail asks the server for a quote of the selected free cells (DP-18) and counts to it (DP-15).
3. Releasing the pointer sends the selected cells, minus conflicting and papers cells, as one hold (DP-19). If no cells are left, nothing is sent and the loom status shows the nothing-free copy.
4. When the hold is placed, its cells change to the held state with a countdown bar. A brush placed while an earlier hold made on this screen is still live first releases the earlier hold.
5. If the server leaves some cells out, only those cells flip to taken, their stations' contours dim if they have no held cells left, and the total counts down to the held cells' price.

Touch: dragging scrolls the loom as normal. A tap on a cell sets a one-cell brush. A second tap on another cell stretches the brush to that cell. Place hold sends it.

Hover with a fine pointer: the hovered cell gets a faint steel frame, and its column header and station label brighten to ink.

Keyboard (DP-16):
- Tab order on the Loom: Main navigation, the date controls, Stations, Book for member (operator), the loom grid, then the rail controls in visual order. The grid is a single Tab stop. The cell that last had focus is the one that receives it, starting at the first station at 04:00, or the first cell of the restored brush.
- In the grid, the arrow keys move the focus cell one column or row. Home and End move to 04:00 and 23:45 in the row.
- Shift with the arrow keys extends the brush from the anchor, which is the cell where Shift was first held, and the brush behaves as in pointer step 2. Enter places the hold as in pointer step 3. Escape clears an unheld brush. Focus stays in the grid after Enter, and the loom status announces the result.
- Confirm booking opens `dialog "Confirm booking"` with focus on Confirm. Tab and Shift+Tab cycle within the dialog. Escape or Back closes it and returns focus to Confirm booking. After a successful confirm the dialog closes and focus returns to the grid.
- Every dialog (Choose stations, Repeat weekly, Cancel booking, Reject document) traps focus the same way, closes on Escape and returns focus to the control that opened it.
- A visible ink-coloured focus ring, at least two pixels thick, surrounds whatever has focus.

Address (DP-17): the Loom address is `/loom?date=<YYYY-MM-DD>&stations=<comma-separated station ids>&sel=<top station id>..<bottom station id>@<HH:MM>-<HH:MM>`. Here `stations` lists the chosen stations and is left out when all are shown. `sel` is the pending unheld brush, with top and bottom in loom order, a start time and an end time that is not included (up to `24:00`). The address updates as the brush changes, without adding history entries. Reloading restores the date, the chosen stations and the brush, and fetches its quote. Once a hold is placed, `sel` is replaced by `hold=<hold id>`. A reload while that hold is live shows it with its countdown, and a reload after it has gone simply drops it. An unknown or malformed `sel` is ignored.

Other flows:
- Repeat weekly (DP-43) opens with the brushed or held block. If the block is held, the hold is released once the series is booked. The block must be one rectangle with no conflicts; otherwise Repeat weekly is disabled with the tooltip "Repeat weekly needs one unbroken block."
- Cancel booking (DP-37) opens the cancel dialog, which shows the preview copy from Feedback states for this booking. "Yes, cancel" commits and "Keep booking" closes.
- The day sheet (DP-52) shows Check in and Mark no-show on confirmed bookings from their booking day, and Mark completed on checked-in bookings.
- Upload: choosing Insurance certificate or Food-handler card makes Expiry date required. Signed kitchen-use agreement hides it and is offered only to operators.

Refresh rules: the loom reloads its cells every 15 seconds, and right after any hold, release, confirm or cancel you make. The countdown and the "held until" label update every second. The service banner checks the service status every 10 seconds.

### Visual design (DP-07, DP-08, DP-10, DP-12)

- **Colour roles.** The ground is a near-black with a faint warm cast, like a dark kitchen at 04:00. Ink is a warm off-white used for text and booked fills. Steel is a cool grey-green used for hairline rules, station contours, secondary text and taken hatching. The accent is a single pilot-light amber used only where something is lit, held or owed: selected cells, held frames and countdown bars, lit station contours, the quote total, outstanding amounts and the primary button. A coral red is used only for conflicts and errors. No other hues appear.
- **Type.** The display typeface is a high-contrast, narrow editorial serif (Instrument Serif), used for screen titles, the quote total and the pack balance. The body typeface is a neutral grotesque (Inter). Every price, time, hour count and reference is set in a monospaced typeface (JetBrains Mono) with lining, equal-width figures, so columns of numbers align on the decimal point. Each heading level is a quarter larger than the level below. The quote total is the largest text on screen.
- **Density.** Compact: loom rows are just tall enough for a 44-pixel tap target on touch screens, and slimmer on fine pointers but never under 28 pixels. Secondary screens are airier, with generous line spacing between rows.
- **Cell states** (DP-12). Each state other than free has its own pattern, its own icon and its own text label, and every cell in that state shows its icon:
  - free: plain ground with a steel hairline grid, no icon and no label.
  - selected: solid amber fill with a paintbrush icon, label "SELECTED".
  - held: a thin amber frame with no fill and a clock icon, with a countdown bar along the bottom of the held block, label "HELD".
  - booked (your own): solid ink fill with a check icon, label "BOOKED".
  - taken: steel diagonal hatching with a lock icon, label "TAKEN".
  - conflict (taken cells inside your brush): coral cross-hatching with a cross icon, label "CONFLICT".
  - papers: a dotted steel fill with a warning-file icon, label "PAPERS".
  Every run of two or more cells with the same state in a row prints its label at the run's start in small mono caps; a single-cell run shows only its icon, and every cell carries its label in its accessible name. For operators, booked and held runs print the member's business name in place of the label.
- **Contrast.** Body text and labels reach at least 4.5:1 against the ground. Large serif figures, icons, hatch and dot patterns, focus rings and control boundaries reach at least 3:1 against what touches them. Amber text on the ground and ground-coloured text on amber both reach 4.5:1.
- **Touch targets.** Every button, link, checkbox, menu item and touch-mode loom cell is at least 44 by 44 pixels.
- **Floor plan** (DP-08): drawn from the stations at runtime, with contours one or two pixels thick, no fills, no photographs and no imported illustrations. It redraws from the station list when the kitchen changes.
- **Icons.** Simple line icons from one openly licensed set: paintbrush, clock, check, lock, cross, warning-file and alert.

### Motion and effects (DP-09, DP-14, DP-15, DP-22)

All motion eases slowly at both ends, evenly. No motion loops for decoration; the only repeating change is the hold countdown, which shows real time running out.

- **Painting the brush:** cells take the selected or conflict state in the same frame the pointer covers them, with no fade.
- **Floor-plan lighting (signature, DP-14):** as rows join the brush, each station's contour changes from steel to amber over about a fifth of a second (no more than a quarter of a second). Stations start in loom row order, each about 40 milliseconds after the previous one (between 30 and 60 milliseconds). When the brush shrinks, stations leaving it dim back to steel in reverse row order with the same timing. A station whose cells the server refused dims the same way.
- **Counting total (DP-15):** whenever the quote changes, the rail total counts through intermediate amounts from the previous total to the new one in about a third of a second (no less than a quarter and no more than four tenths of a second). It always lands exactly on the server's figure. The line items swap in when the count starts. The `status "Quote announcement"` region gets the final announcement once the count lands.
- **Hold placed (DP-22):** the held frame fades in over about a fifth of a second. The countdown bar then empties at an even pace until the hold's expiry, which the browser works out from the server's `server_now` and `expires_at` rather than from the device clock alone. When the server reports the hold expired, the bar is gone and the cells return to free.
- **Lost cells (DP-22):** refused cells change to the taken hatching over about a fifth of a second, while the total counts down as above.
- **Confirm settle:** held cells settle into the booked ink fill over a little over half a second.
- **Dialogs and the quote sheet:** they fade in and rise slightly over about a fifth of a second, and leave in about half that.
- **Service banner:** slides down from the top bar over about a fifth of a second when it appears, and back up when it clears.
- **Press feedback:** buttons darken a step while pressed, instantly.

Reduced motion (DP-09), when the device asks for it:
- Fills, contour lighting, hatch changes and the confirm settle apply instantly, with no stagger.
- The total jumps straight to its final value.
- The countdown bar is replaced by the static text "held until <HH:MM>" (the hold's expiry in kitchen time).
- Dialogs, the sheet and the banner appear and disappear instantly.
- Brushing still snaps and paints, keyboard brushing works the same way, and `status "Quote announcement"` still announces each final total.

### Feedback states (DP-13, DP-22, DP-23, DP-24, DP-26, DP-28, DP-34, DP-37, DP-43, DP-48, DP-50, DP-52, DP-59, DP-60)

Placeholders used in copy:
- `<ref>`: a booking reference.
- `<invoice ref>`: an invoice reference.
- `<HH:MM>`: a 24-hour kitchen time.
- `<date>`: a kitchen date as `YYYY-MM-DD`.
- `<n>` and `<m>`: whole cell counts.
- `<hours>`: hours with two decimals.
- `<total>` and `<amount>`: dollars with thousands commas and two decimals, with no dollar sign inside the placeholder.
- `<email>`: the member's contact email.
- `<business>`: the member's business name.
- `<label>`: a document type label.
- `<window>`: whole hours.
- `<tier>`: 2, 3 or 4.
- `<cutoff>`: the kitchen's same-day cutoff.
- `<from>` and `<to>`: booking state names with underscores replaced by spaces.

During every pending action, the button that started it is disabled and keeps its name.

| Action | Region | Pending | Success | Errors and outages |
|---|---|---|---|---|
| Sign in | `alert` for errors | "Signing in…" on the button | goes to the landing screen | invalid credentials: "Email or password is incorrect." |
| Quote while brushing | `group "Quote total"` and `status "Quote announcement"` | "Pricing…" under the total | announcement "Total $<total> for <hours> hours." followed by " Crosses into tier <tier>." once for each step crossed | none; a failed quote leaves the last total and shows "Pricing unavailable. Try again." under it |
| Brush covering papers cells | `status "Loom status"` | | | member: "Your papers do not cover <date>. Upload a current insurance certificate and food-handler card to book this day." operator: "<business>'s papers do not cover <date>." |
| Place hold | `status "Loom status"` | "Placing hold…" | "Held <n> cells until <HH:MM> kitchen time." When some cells were refused: "Held <n> cells until <HH:MM> kitchen time. <m> cells were just taken by another booking." | all taken: "Those cells were just taken. Nothing was held." nothing free (checked in the browser): "Nothing free to hold in that brush." same-day closed: "Same-day booking closed at <cutoff> kitchen time." cell in past: "Some of those cells have already started. Brush a later block." compliance: the papers copy above |
| Release hold | `status "Loom status"` | "Releasing…" | "Hold released." | hold gone: "This hold is no longer active." |
| Confirm booking | `status "Loom status"` | "Confirming…" | "Booking <ref> confirmed. Confirmation sent to <email>." | expired: "Your hold expired at <HH:MM> kitchen time. Brush the block again." quote changed: "The price is now $<total> because your month-to-date hours changed. Check the quote and confirm again." no pack hours: "No pack hours left." billing down: "Billing is unreachable, so nothing was booked and your hold was released. Try again once billing is back." mail down: "Email is unreachable, so nothing was booked and your hold was released. Try again shortly." |
| Book series | `status "Loom status"` | "Booking series…" | "Booked <n> weekly slots, <date> to <date>." | conflict: "These weeks are already taken: <date list joined by comma and space>. Nothing was booked." The other errors use the confirm copy. |
| Cancel preview | inside `dialog "Cancel booking"` | | in window: "Cancelling now refunds <hours> pack hours and $<amount>." late: "This is inside the <window>-hour cancellation window. Cancelling now refunds nothing." | |
| Cancel booking | `status "Form status"` | "Cancelling…" | in window: "Booking <ref> cancelled. <hours> pack hours and $<amount> refunded." late: "Booking <ref> cancelled inside the <window>-hour window, so it is still charged." | illegal: "<ref> cannot move from <from> to <to>." billing and mail down use the billing-down and mail-down banner copy |
| Check in, complete, no-show | `status "Form status"` | "Saving…" | "Checked in <business>." / "Marked <ref> completed." / "Marked <ref> as a no-show." | illegal: the illegal copy above. Before the booking day: "<ref> can only be checked in or marked no-show from its booking day." |
| Buy 20-hour pack | `status "Form status"` | "Adding pack…" | "20-hour pack added. Balance <hours> hours." | billing down: "Billing is unreachable. Pack purchases are paused; try again shortly." |
| Upload document | `status "Form status"` | "Uploading…" | "Uploaded <label>. It counts once the kitchen verifies it." | type: "Upload a PDF, PNG or JPEG file." size: "Files can be at most 5,000,000 bytes." name: "That file name is not allowed. Rename the file and try again." expiry: "Choose an expiry date from today onward." files down: "File storage is unreachable. Uploading is paused; try again shortly." |
| Open document | `status "Form status"` | | the file opens | files down: "File storage is unreachable. Opening documents is paused." |
| Verify, reject | `status "Form status"` | "Saving…" | "Verified <label> for <business>." / "Rejected <label> for <business>." | illegal: "This document is already <state>." where `<state>` is the document's state name |
| Save cutoff | `status "Form status"` | "Saving…" | "Same-day cutoff set to <HH:MM>." | invalid: "Enter a time on a quarter hour." |
| Add rate card | `status "Form status"` | "Saving rate card…" | "Rate card added. It applies from <date>." | duplicate: "A rate card already starts on <date>." amounts: "Enter an amount in dollars and cents." date: "Choose today or a later date." |
| Load report | `status "Form status"` | "Loading report…" | the tables appear; with no rows: "No bookings in <Month name> <YYYY>." | |

Field errors appear in coral under the field, linked to it as its description, and the same text appears in the form's status region.

Service banner, in `status "Service status"`:
- billing down: "Billing is unreachable. Confirming, cancelling, recurring slots and pack purchases are paused. Brushing and holds still work."
- file storage down: "File storage is unreachable. Uploading and opening documents are paused. Bookings still use the papers on file."
- email down: "Email is unreachable. Confirming, cancelling and recurring slots are paused."
- recovery: "<Service> is back. Paused actions are available again.", where `<Service>` is "Billing", "File storage" or "Email". It shows for 10 seconds.

Several outage lines can show at once. Controls for paused actions stay visible, are disabled while their service is reported down, and are enabled again when the banner reports recovery.

## Backend

### API (DP-03, DP-04, DP-05, DP-18, DP-19, DP-21, DP-26, DP-27, DP-31, DP-41, DP-44, DP-45, DP-53, DP-55, DP-57, DP-59)

All endpoints live under `/api`. They take and return `application/json; charset=utf-8`, except the document upload (`multipart/form-data`), the document file and the CSV. A session cookie named `pl_session` (HttpOnly, SameSite=Lax, Path=/) identifies the signed-in user. All instants are UTC ISO 8601 strings ending in `Z`. Dates are kitchen dates as `YYYY-MM-DD`, and times are kitchen wall-clock `HH:MM`. Money is always an integer in cents, alongside a display string such as `"$1,234.50"`. Hours are strings with two decimals. A **cell** is `{"station_id": "<id>", "start": "HH:MM"}` with the start on a quarter hour from `04:00` to `23:45`.

**Error body** (the only shape): `{"error": "<code>", "message": "<sentence>"}`, plus extra fields only where a row below names them. Validation errors use code `validation` and add `"errors": {"<field>": "<sentence>"}`.

**Error precedence** (the only ordering; a request is answered by the first check that fails).

Every endpoint starts with these transport checks:
1. Cross-origin: a POST, PATCH or DELETE whose `Origin` header names another origin answers 403 `cross_origin`, as in Server boundary.
2. Body size and content type: 413 and 415, as in Server boundary.
3. Malformed body: a JSON body that does not parse answers 400 `invalid_json`.

Endpoints that need a signed-in user (every endpoint except `GET /api/health`, `GET /api/status` and `POST /api/session`) then check, in order:
4. 401 `unauthenticated`: no valid session.
5. 404 `not_found`: an unknown id, or a record in another kitchen, or a record belonging to another member.
6. 403 `forbidden`: the role may not do this.
7. On endpoints that take an `Idempotency-Key` header: a missing key, or one that is not 1 to 100 printable ASCII characters, is answered 422 `validation` with `errors["Idempotency-Key"]`. A replay returns the stored response. A reused key is answered 409 `idempotency_key_reused`.
8. Resource state: 409 `hold_not_active`, 410 `hold_expired`, 409 `invalid_transition`, 409 `booking_day_not_reached`.
9. Request validation: 422 `validation`, `compliance_blocked`, `same_day_closed`, `cell_in_past`.
10. Availability and price: 409 `cells_taken`, `series_conflict`, `quote_changed`, `rate_card_exists`.
11. Dependency: 503 `billing_unavailable`, `files_unavailable`, `mail_unavailable`.

Public endpoints never check a session. After step 3, `POST /api/session` checks its request fields (422 `validation` when `email` or `password` is missing, empty or not a string) and then the credentials (401 `invalid_credentials`). `GET /api/health` and `GET /api/status` have no checks beyond steps 1 to 3.

**Objects.**
- User: `{"id","name","email","role":"operator"|"member"|"bookkeeper","kitchen_id","member_id":string|null}`.
- Station: `{"id","name","kind":"oven"|"mixer"|"chiller"|"prep"|"range"|"kettle"|"cooler","order":int}`.
- Quote: `{"month":"YYYY-MM","month_hours_before":"<hours>","rate_card_id","lines":[Line],"tier_steps_crossed":[int],"pack_quarters":int,"quarters":int,"hours":"<hours>","total_cents":int,"total":"$…"}`.
- Line: `{"station_id","station","tier":1..4,"paid_by":"cash"|"pack","quarters":int,"hours":"<hours>","hourly_rate_cents":int,"amount_cents":int}`.
- Hold: `{"id","member_id","date","state":"held"|"expired"|"released"|"confirmed","cells":[cell],"expires_at","expires_local":"HH:MM","server_now","quote":Quote}`.
- Booking: `{"id","ref","member_id","kitchen_id","date","state","cells":[cell],"blocks":[{"station_id","station","start","end","hours"}],"starts_at","ends_at","quarters","hours","lines":[Line],"pack_quarters","total_cents","total","rate_card_id","cancellation_window_hours","confirmed_at","invoice_id","series_id":string|null}`.
- Invoice: `{"id","ref","member_id","kind":"booking"|"series"|"pack","booking_ids":[…],"lines":[Line or {"description","amount_cents"}],"total_cents","total","killbill_invoice_id":string|null,"billing_amount_cents":int|null,"issued_at"}`. `billing_amount_cents` is read live from billing and is null while billing is down.
- Document: `{"id","member_id","type":"insurance"|"food_handler"|"kitchen_agreement","label","state":"uploaded"|"verified"|"rejected"|"expiring"|"expired","expires_on":date|null,"original_name","size_bytes","content_type","uploaded_at","reject_reason":string|null}`.
- Movement: `{"id","kind":"purchase"|"draw"|"refund","quarters":int,"booking_id":string|null,"reverses":string|null,"created_at","entries":[{"account":"member_pack"|"pack_sales"|"hours_used","quarters":int}]}`.

Document labels are "Insurance certificate", "Food-handler card" and "Signed kitchen-use agreement".

Endpoints. Each row names only its own success and extra errors.

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | | 200 `{"status":"ok"}` | |
| `GET /api/status` | anyone | | 200 `{"services":{"billing":"up"|"down","files":"up"|"down","mail":"up"|"down"},"paused":[…]}`; `paused` lists the action names from Services whose service is down | |
| `POST /api/session` | anyone | `{"email","password"}` | 200 `{"user":User}` and sets the cookie | 422 `validation` on `email` or `password`; 401 `invalid_credentials` |
| `DELETE /api/session` | signed in | | 204 and clears the cookie | |
| `GET /api/me` | signed in | | 200 `{"user":User}` | |
| `GET /api/kitchens/:kitchen_id` | that kitchen's users | | 200 `{"kitchen":{"id","name","timezone","today","server_now","same_day_cutoff","hold_seconds","stations":[Station]}}` | |
| `PATCH /api/kitchens/:kitchen_id/settings` | operator | `{"same_day_cutoff":"HH:MM"}` (quarter hour, `00:00`–`23:45`) | 200 same body as GET | 422 `validation` |
| `GET /api/kitchens/:kitchen_id/loom?date=<date>[&member_id=<id>]` | operator, member | `member_id` is for operators only; members always see their own view | 200 `{"date","today","server_now","timezone","same_day_cutoff","hold_seconds","covered_until":date|null,"papers":bool,"stations":[Station],"cells":[…]}`. Each entry in `cells` is a non-free cell `{"station_id","start","state":"held"|"booked"|"taken"}`; own cells add `hold_id` or `booking_id` and, for holds, `expires_at`; operators see every member's cells as held or booked with `business`, `hold_id` or `booking_id` | 422 `validation` (bad date) |
| `GET /api/kitchens/:kitchen_id/members` | operator | | 200 `{"members":[{"id","business","contact_email","covered_until","month_hours","pack_balance_quarters"}]}` | |
| `GET /api/members/:member_id` | that member, operator | | 200 `{"member":{…same fields…}}` | |
| `POST /api/quotes` | operator, member | `{"date","cells":[cell],"use_pack":bool,"member_id"?}` (`member_id` required for operators) | 200 `{"quote":Quote,"taken":[cell],"papers":[cell]}`; the quote prices only cells that are neither taken nor papers | 422 `validation` |
| `POST /api/holds` | operator, member | same as quotes without `use_pack` | 201 `{"hold":Hold,"taken":[cell]}` | 422 `validation`, `compliance_blocked`, `same_day_closed`, `cell_in_past`; 409 `cells_taken` with `"taken":[cell]` |
| `GET /api/holds/:hold_id` | its member, operator | | 200 `{"hold":Hold}` with a fresh quote | |
| `DELETE /api/holds/:hold_id` | its member, operator | | 200 `{"hold":Hold}` with state `released` | 409 `hold_not_active` with `"state"`; 410 `hold_expired` |
| `POST /api/holds/:hold_id/confirm` | its member, operator | header `Idempotency-Key`; `{"use_pack":bool,"quoted_total_cents":int}` | 201 `{"booking":Booking,"invoice":Invoice}` | 409 `hold_not_active`; 410 `hold_expired`; 422 `validation` (`use_pack` with no pack hours), `compliance_blocked`; 409 `quote_changed` with `"quote":Quote`; 503 `billing_unavailable`, `mail_unavailable` |
| `POST /api/series/quote` | operator, member | `{"station_ids":[…],"start":"HH:MM","end":"HH:MM","first_date","weeks":2..12,"use_pack":bool,"member_id"?}` (`end` not included, quarter hour up to `24:00`, after `start`) | 200 `{"occurrences":[{"date","starts_at","ends_at","quote":Quote}],"total_cents","total"}` | 422 `validation`, `compliance_blocked`, `same_day_closed`, `cell_in_past`; 409 `series_conflict` with `"dates":[date],"taken":[{"date","station_id","start"}]` |
| `POST /api/series` | operator, member | header `Idempotency-Key`; series quote body plus `"quoted_total_cents"` | 201 `{"series":{"id","weekday","start","end","station_ids","weeks","booking_ids"},"bookings":[Booking],"invoice":Invoice}` | as series quote, plus 409 `quote_changed`; 503 `billing_unavailable`, `mail_unavailable` |
| `GET /api/bookings[?date=<date>]` | member (own), operator and bookkeeper (kitchen) | | 200 `{"bookings":[Booking]}` | |
| `GET /api/bookings/:booking_id` | its member, operator, bookkeeper | | 200 `{"booking":Booking}` | |
| `POST /api/bookings/:booking_id/cancel` | its member, operator | `{}` | 200 `{"booking":Booking,"refund":{"pack_quarters":int,"amount_cents":int,"amount":"$…"}}` | 409 `invalid_transition` with `"from","to"`; 503 `billing_unavailable`, `mail_unavailable` |
| `POST /api/bookings/:booking_id/check-in`, `/complete`, `/no-show` | operator | `{}` | 200 `{"booking":Booking}` | 409 `invalid_transition` with `"from","to"`; 409 `booking_day_not_reached` |
| `GET /api/members/:member_id/pack` | that member, operator, bookkeeper | | 200 `{"balance_quarters":int,"balance_hours":"<hours>","movements":[Movement]}` (oldest first) | |
| `POST /api/members/:member_id/packs` | that member, operator | header `Idempotency-Key`; `{}` | 201 `{"movement":Movement,"invoice":Invoice,"balance_quarters":int}` | 503 `billing_unavailable` |
| `GET /api/invoices` | member (own), operator and bookkeeper (kitchen) | | 200 `{"invoices":[Invoice]}` | |
| `GET /api/invoices/:invoice_id` | its member, operator, bookkeeper | | 200 `{"invoice":Invoice}` | |
| `GET /api/documents` | member (own), operator (kitchen) | | 200 `{"documents":[Document]}` | |
| `POST /api/documents` | member for own `insurance` and `food_handler`; operator for any type for a member of the kitchen | multipart fields `type`, `expires_on` (required for insurance and food-handler, not allowed for the agreement), `member_id` (operators only), `file` | 201 `{"document":Document}` | 403 `forbidden` (member uploading an agreement); 422 `validation` (`type`, `expires_on`, `file` name or empty file); 413 `file_too_large` when the file part is over 5,000,000 bytes (exactly 5,000,000 is accepted); 415 `unsupported_type`; 503 `files_unavailable` |
| `GET /api/documents/:document_id` | its member, operator | | 200 `{"document":Document}` | |
| `GET /api/documents/:document_id/file` | its member, operator | | 200 file bytes; `Content-Type` is the detected type, `Content-Disposition: attachment; filename="<original_name>"`, `X-Content-Type-Options: nosniff` | 503 `files_unavailable` |
| `POST /api/documents/:document_id/verify` | operator | `{}` | 200 `{"document":Document}` | 409 `invalid_transition` with `"from","to"` |
| `POST /api/documents/:document_id/reject` | operator | `{"reason":string 1..300}` | 200 `{"document":Document}` | 409 `invalid_transition`; 422 `validation` |
| `GET /api/kitchens/:kitchen_id/rate-cards` | operator, bookkeeper | | 200 `{"rate_cards":[{"id","effective_from","tier_rates_cents":[4 ints],"station_surcharges_cents":{"<station id>":int},"cancellation_window_hours","pack_price_cents","in_force":bool,"created_at"}]}` | |
| `POST /api/kitchens/:kitchen_id/rate-cards` | operator | `{"effective_from","tier_rates_cents":[4 positive ints],"station_surcharges_cents":{every station id: int ≥ 0},"cancellation_window_hours":0..336,"pack_price_cents":positive int}` | 201 `{"rate_card":{…}}` | 422 `validation` (an effective date before today, missing stations, bad amounts); 409 `rate_card_exists` |
| `GET /api/kitchens/:kitchen_id/reports/usage?month=YYYY-MM` | operator, invited bookkeeper | | 200 `{"kitchen":{"id","name","timezone"},"month","members":[{"member_id","business","booked_hours","cancelled_in_window_hours","billed_cents","refunded_cents","pack_balance_hours"}],"stations":[{"station_id","name","booked_hours"}],"invoices":[{"invoice_id","ref","kind","member_id","business","killbill_invoice_id","total_cents","issued_on"}],"totals":{"booked_hours","billed_cents","refunded_cents"}}` | 422 `validation` |
| `GET /api/kitchens/:kitchen_id/reports/usage.csv?month=YYYY-MM` | operator, invited bookkeeper | | 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="pilotlight-usage-<kitchen_id>-<YYYY-MM>.csv"`; header row exactly `invoice_ref,kind,member,booking_ref,date,station,tier,paid_by,hours,amount`; one row per invoice line; `amount` is dollars with two decimals and no symbol or commas; pack rows leave `booking_ref`, `station` and `tier` empty | 422 `validation` |

### Business rules (DP-05, DP-19, DP-20, DP-21, DP-23, DP-25, DP-26, DP-27, DP-28, DP-32, DP-33, DP-35, DP-36, DP-38, DP-39, DP-41, DP-42, DP-46, DP-47, DP-49, DP-51, DP-53, DP-54, DP-57)

**Roles.**
- Every user belongs to exactly one kitchen.
- Operators act on everything in their kitchen.
- Members act only on their own records: holds, bookings, invoices, documents and pack. They never pass `member_id`.
- The bookkeeper reads bookings, invoices, packs, rate cards and reports for the one kitchen they were invited to. They are refused (`forbidden`) on every write and on documents and the loom.
- Anything belonging to another kitchen, or a member's record requested by another member, is answered `not_found`, including ids nested in a request body such as `member_id` or `station_id`.

**Kitchen time.**
- Each kitchen has an IANA time zone (seed data).
- "Today" is the kitchen-local date of the server clock.
- Every date, cell time, cutoff, monthly tier bucket, report month and document expiry is judged in the kitchen's zone. The device's zone never affects them.
- Cells run from 04:00 to 24:00 kitchen time, so no cell crosses midnight.
- A cell's instant is its kitchen date and wall-clock start converted through the kitchen zone. A wall-clock time that does not exist because of a spring-forward change moves forward by the length of the skipped hour. A time that occurs twice in an autumn change uses the first occurrence.

**Booking horizon and cell checks** (holds, quotes and series):
- Dates from today through 365 days after today, inclusive, are open. Others are answered `validation` on `date`.
- A cell on today whose start is at or before the current kitchen time is `cell_in_past`.
- When today's kitchen time is at or after the kitchen's same-day cutoff, every cell on today is `same_day_closed`.
- A request may hold 1 to 320 distinct cells on one date. Duplicate or off-grid cells, or stations of another kitchen, are answered `validation` on `cells`.

**Compliance cover** (DP-49):
- A member's cover runs to `covered_until`, the earlier of two dates: the latest expiry among their insurance certificates in state verified or expiring, and the latest expiry among their food-handler cards in state verified or expiring. It is null when either is missing.
- A date is covered when it is on or before `covered_until`. A document covers bookings through the end of its expiry date in kitchen time.
- Quotes list every cell on an uncovered date under `papers` and price none of them.
- Holds, confirms, series quotes and series bookings for an uncovered date are refused with `compliance_blocked`. The confirm check uses cover at the moment of confirming.

**Holds** (DP-19, DP-20, DP-21):
- The hold time is `PILOTLIGHT_HOLD_SECONDS` seconds, default 600 (10 minutes), allowed range 1 to 3600. `expires_at` is the creation instant plus the hold time.
- A hold is live while the server clock is strictly before `expires_at`. At or after `expires_at` it is expired: its cells are free to anyone, a confirm or release answers `hold_expired`, and reads show state `expired`. Only the server clock decides this.
- A cell is taken when a live hold or a booking in state confirmed, checked_in, completed or no_show already covers it, including the requester's own.
- Placing a hold takes every requested cell that is not taken. Taking all of them is one serialised step in PostgreSQL, so when several requests race for a cell exactly one of them gets it.
- Cells that could not be taken are returned in `taken`. If none could be taken the answer is `cells_taken` and nothing is held.
- A hold moves held → confirmed (confirm), held → released (release) or held → expired (time). Any request on a hold that is released or confirmed answers `hold_not_active` with its state, unless it is a confirm replay.

**Monthly tiers and prices** (DP-25):
- The rate card in force is the one with the latest `effective_from` on or before today. It applies from the start of that kitchen day.
- A rate card has four hourly tier rates. Tier 1 covers a member's first 8 booked hours in a kitchen month, tier 2 hours 8 to 20, tier 3 hours 20 to 30, and tier 4 everything after 30. Each station also has an hourly surcharge.
- Month-to-date quarters are the quarter-hours of the member's bookings in state confirmed, checked_in, completed, cancelled_late or no_show whose date falls in the same kitchen month. Holds and in-window cancellations do not count.
- Pricing a cell set: order the cells by start time, then by station loom order. Walk them with a running count `c` that starts at the month-to-date quarters. Each cell's tier is 1 when `c` < 32, 2 when 32 ≤ `c` < 80, 3 when 80 ≤ `c` < 120, and 4 otherwise. Then add one to `c`.
- When paying with pack hours, the first cells in the same order, up to the pack balance, are paid by pack. The rest are cash.
- Cells are grouped into lines by station, tier and `paid_by`. Lines are sorted by station loom order, then tier, then cash before pack.
- A line's `hourly_rate_cents` is the tier rate plus the station surcharge.
- A cash line's `amount_cents` is quarters × `hourly_rate_cents` ÷ 4, rounded half up to a whole cent. This is the only rounding stage. A pack line's amount is 0.
- `total_cents` is the sum of the line amounts. `tier_steps_crossed` lists each tier above the starting tier that the walk enters.
- For example, with the seed data at start: Ember & Rye has no hours this month and brushes Deck oven 1, Deck oven 2, 60-quart mixer and Blast chiller from 04:00 to 06:15 on one date, paying cash. The lines are:
  - Deck oven 1: tier 1, 8 quarters, $76.00; tier 2, 1 quarter, $8.88.
  - Deck oven 2: the same two lines.
  - 60-quart mixer: tier 1, 8 quarters, $71.50; tier 2, 1 quarter, $8.31.
  - Blast chiller: tier 1, 8 quarters, $75.00; tier 2, 1 quarter, $8.75.
  The total is $333.32 and `tier_steps_crossed` is `[2]`.
- A recurring series is priced occurrence by occurrence in date order. Earlier occurrences count toward later ones' month-to-date quarters, and pack hours are drawn across occurrences in the same order.

**Confirm** (DP-26, DP-27, DP-28, DP-29, DP-30, DP-32):
- Confirming prices the hold's cells at that moment. If the result differs from `quoted_total_cents`, the answer is `quote_changed` with the fresh quote, nothing changes and the hold stays live.
- Otherwise, as one unit:
  1. The booking is created in state confirmed with its lines, the rate card id and the cancellation window in force.
  2. Pack draws are recorded.
  3. The billing charges are posted.
  4. The confirmation email is handed to SMTP.
  5. The hold becomes confirmed.
- Steps 1, 2 and 5 are one database transaction that commits only after SMTP accepts the single email of step 4. Each confirm or series request hands exactly one message to SMTP, so delivery is never partial: either SMTP accepts that one message and the unit commits, or it refuses or cannot be reached and the unit fails.
- If any step fails, nothing remains: no booking, no pack movement, no email, the hold is released and its cells are free. Any billing charge already posted is fully reversed, as in Services. The answer is the matching dependency error.
- Bookings get references `PL-` plus six digits, increasing. Invoices get `INV-` plus six digits.

**Idempotency** (DP-27, applies to confirm, series and pack purchase):
- A key is scoped to the signed-in user. A key first used with a method, path and body is stored with its 201 response for at least 24 hours.
- Repeating the same key with the same method, path and body returns exactly the stored status and body and changes nothing more: no second booking, charge, movement or email. This happens even after the hold has been confirmed.
- The same key with a different path or body answers `idempotency_key_reused`.
- Two requests with the same key that arrive at once produce one result. Both answer with it.
- Failed attempts are not stored, so retrying a failed request with its key can succeed.

**Booking states** (DP-51):
- Legal transitions:
  - confirmed → checked_in (operator, when today is on or after the booking date)
  - checked_in → completed (operator)
  - confirmed → no_show (operator, when today is on or after the booking date)
  - confirmed → cancelled_in_window or cancelled_late (member owner or operator, by cancel)
- Every other move answers `invalid_transition` with `from` and `to`. `to` is `cancelled` for cancel requests and `checked_in`, `completed` or `no_show` for the others.
- A check-in or no-show before the booking date answers `booking_day_not_reached`.

**Cancellation** (DP-35, DP-36, DP-39):
- A cancel is in window when the server clock is at or before the booking's `starts_at` minus its stored `cancellation_window_hours`. Otherwise it is late.
- In window, as one unit:
  1. The booking becomes cancelled_in_window.
  2. Each pack draw of the booking is reversed by a refund movement.
  3. A billing credit of the booking's `total_cents` is posted when that is above zero.
  4. The receipt email is sent.
  The refund reports the quarters and cents returned.
- Late: the booking becomes cancelled_late, nothing is refunded and it keeps counting toward tiers. The receipt email is still sent.
- Both free the booking's cells. Either cancel fails as one unit like a confirm, leaving the booking confirmed.

**Prepaid pack ledger** (DP-31, DP-33):
- A pack is 20 hours, which is 80 quarters, sold at the in-force card's `pack_price_cents`.
- Every movement has exactly two entries whose quarters sum to zero:
  - purchase: `member_pack` +80 and `pack_sales` −80
  - draw: `member_pack` −n and `hours_used` +n
  - refund: `member_pack` +n and `hours_used` −n, with `reverses` set to the draw's id
- Movements are never edited or deleted. A draw is refunded at most once.
- The balance is always the sum of the member's `member_pack` entries and never goes below zero.
- `use_pack` with a balance of zero is answered `validation` on `use_pack`.

**Rate cards and kept terms** (DP-38, DP-39):
- Rate cards are added, never changed or removed. `effective_from` is today or later. A second card for the same kitchen and date is `rate_card_exists`.
- Each booking stores the rate card id and cancellation window in force when it was confirmed. Its lines, total, invoice, cancel preview, cancellation outcome and report rows always use those stored terms, even after a newer card comes into force.

**Recurring series** (DP-41, DP-42):
- A series books the same stations from `start` to `end` on `first_date` and the same weekday each following week, for `weeks` occurrences.
- Every occurrence starts at `start` and ends at `end` kitchen wall-clock time. Its UTC instants shift across daylight-saving changes and its quarters do not.
- Every occurrence must pass the horizon, cell, cover and availability checks. If any occurrence fails, the whole request fails: conflicts are listed in `series_conflict`, and nothing is booked.
- Success creates one booking per occurrence and one invoice for the series, posted as one billing invoice. Every booking of the series has that invoice as its `invoice_id`, and the invoice lists every occurrence's lines. It sends one confirmation email for the whole series, listing every occurrence. The whole request succeeds or fails as one unit like a confirm.

**Documents** (DP-44, DP-46, DP-47):
- The type is judged from the file's first bytes:
  - `%PDF-` is `application/pdf`
  - the PNG signature is `image/png`
  - `FF D8 FF` is `image/jpeg`
  Anything else, including SVG and HTML whatever its extension, is `unsupported_type`.
- File names containing `/`, `\`, `..`, a control character, or longer than 200 characters are refused on `file`. An empty file is refused on `file`.
- `expires_on` must be today or later.
- Lifecycle:
  - uploaded → verified, or uploaded → rejected, both by the operator.
  - A verified document reads as expiring from 14 days before its expiry date, inclusive, through the expiry date.
  - It reads as expired from the day after its expiry date, in kitchen time.
  - Agreements never expire.
- Verify or reject on any state other than uploaded answers `invalid_transition`. An uploaded document whose expiry date has passed reads as expired and can no longer be verified.
- Rejected and uploaded documents never count toward cover.
- **Reminder:** within 60 seconds of a document reading as expiring, whether because it was just verified or because the kitchen date moved on, Pilotlight sends the reminder email once to the member and once to the kitchen operator. Each document is reminded at most once.

**Occupancy privacy** (DP-54): the loom, quote and hold responses that members receive name other members' cells only as `taken`, never with a hold or booking id, member id, business name or amount. The Loom page shows the same.

**Reports** (DP-57):
- A report covers one kitchen and one kitchen-local month.
- Member and station hours come from bookings whose date falls in that month.
- Invoices are those issued in that month by kitchen time.
- Only members, stations and invoices of that kitchen appear.
- The CSV holds exactly the lines of the invoices listed.

### Services (DP-02, DP-28, DP-29, DP-30, DP-31, DP-36, DP-45, DP-47, DP-55, DP-59, DP-60)

- **PostgreSQL** (`DATABASE_URL`) is the system of record and the only datastore. It holds kitchens, users, sessions, stations, rate cards, holds, bookings, series, invoices, the pack ledger, document metadata, idempotency records and an audit trail of every state change. Holds and confirms are serialised in it. Schema and seed data are applied on every serve when missing, without duplicating anything.
- **Kill Bill** (`KILLBILL_URL` with the username, password, API key and API secret variables):
  - Each member has one billing account. Its external key is the member id, its name is the business name, its email is the contact email and its currency is USD. It is created the first time the member is charged.
  - Each confirm or series posts one billing invoice: one external charge per cash line with an amount above zero. Each description is `<booking ref> · <station name> · tier <n> · <hours> h`. The billing invoice's amount equals the Pilotlight invoice `total_cents` to the cent, and its id is stored as `killbill_invoice_id`.
  - A booking with a $0.00 total posts no billing invoice, and its `killbill_invoice_id` is null.
  - A pack purchase posts one external charge of the pack price described as `<invoice ref> · 20-hour pack`.
  - An in-window cancellation with a cash total posts one account credit of that total described as `<booking ref> cancelled in window`.
  - Reversing after a failed email adjusts every item of the just-posted billing invoice to zero, so its balance reads $0.00.
  - When billing is down, `confirm_booking`, `create_series`, `cancel_booking` and `buy_pack` are paused. `billing_amount_cents` reads null, and holds, quotes and every read still work.
- **Object storage** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`):
  - Each document file is stored privately at `documents/<kitchen id>/<member id>/<document id>` with its detected content type. The uploaded file name never forms part of the key.
  - Files are fetched by the server and streamed to the allowed reader, never through public or presigned links.
  - When storage is down, `upload_document` and `view_document` are paused. Bookings keep using the document records already stored.
  - Seeded documents get a small generated one-page PDF the first time storage is reachable.
- **Mail** (`SMTP_HOST`, `SMTP_PORT`, plain SMTP without authentication): sender `Pilotlight <no-reply@pilotlight.test>`. Each message is addressed to exactly one recipient.
  - Confirmation, exactly one per confirm, to the member's contact email. Subject `Booking <ref> confirmed — <kitchen name>`. The body gives the reference, date, each station's times, hours, lines, total, pack hours used and the cancellation window, and nothing about any other member.
  - Series confirmation, exactly one per weekly series, to the member's contact email. Subject `Weekly series <first ref> to <last ref> confirmed — <kitchen name>`, where the references are those of the first and last occurrences. The body gives the same details for every occurrence, then the series total, and nothing about any other member.
  - Cancellation receipt, to the member. Subject `Booking <ref> cancelled — <hours> pack hours refunded`. The body states in window or late, and the refunded amount.
  - Expiry reminder, one to the member and one to the kitchen operator. Subject `<label> for <business> expires <date>`.
  - When mail is down, `confirm_booking`, `create_series` and `cancel_booking` are paused.
- **Detection and recovery** (DP-59, DP-60): the server checks billing, storage and SMTP at boot without waiting on them, then every 10 seconds, and marks a service down as soon as a real call to it fails. `GET /api/status` and the banner reflect a change within 15 seconds. Once a service answers again, its paused actions work within 30 seconds, with no restart.

### Seed data (DP-05, DP-25, DP-33, DP-46, DP-53, DP-57)

Every person, business and kitchen below is invented. Dates written `today+N` are counted from the kitchen-local date on which the empty database is first seeded. Every user's password is `nightshift-demo-26`.

Kitchens:
- `kit-nsc` "Night Shift Commons", time zone `America/Chicago`, same-day cutoff `14:00`.
- `kit-lark` "Larkspur Commissary", time zone `America/New_York`, same-day cutoff `12:00`.

Night Shift Commons stations, in loom order (id, name, kind, seed surcharge per hour):

| Station id | Name | Kind | Surcharge |
|---|---|---|---|
| `st-deck-1` | Deck oven 1 | oven | $6.00 |
| `st-deck-2` | Deck oven 2 | oven | $6.00 |
| `st-convection` | Convection oven | oven | $4.50 |
| `st-mixer` | 60-quart mixer | mixer | $3.75 |
| `st-chiller` | Blast chiller | chiller | $5.50 |
| `st-prep-a` | Prep table A | prep | $0.00 |
| `st-prep-b` | Prep table B | prep | $0.00 |
| `st-range` | Six-burner range | range | $2.25 |
| `st-kettle` | Steam kettle | kettle | $4.00 |
| `st-walkin` | Walk-in cooler | cooler | $1.25 |

Larkspur stations, in loom order:

| Station id | Name | Kind | Surcharge |
|---|---|---|---|
| `st-l-oven` | Rack oven | oven | $5.00 |
| `st-l-mixer` | 40-quart mixer | mixer | $3.00 |
| `st-l-kettle` | Jam kettle | kettle | $4.00 |
| `st-l-prep` | Prep table | prep | $0.00 |
| `st-l-chiller` | Blast chiller | chiller | $5.00 |
| `st-l-cooler` | Walk-in cooler | cooler | $1.00 |

Rate cards, each effective from the seed date:
- `rc-nsc-seed`: tiers $32.00, $29.50, $27.25, $25.00 per hour; cancellation window 72 hours; pack price $560.00.
- `rc-lark-seed`: tiers $30.00, $28.00, $26.00, $24.00; window 48 hours; pack price $520.00.

Users:

| User id | Name | Email | Role | Kitchen | Member |
|---|---|---|---|---|---|
| `usr-dana` | Dana Okafor | operator@nightshift.test | operator | `kit-nsc` | |
| `usr-ember` | Priya Anand | ember@pilotlight.test | member | `kit-nsc` | `mem-ember` |
| `usr-saltline` | Marcus Bell | saltline@pilotlight.test | member | `kit-nsc` | `mem-saltline` |
| `usr-wren` | Lin Zhao | wren@pilotlight.test | member | `kit-nsc` | `mem-wren` |
| `usr-tidewater` | Aoife Ryan | tidewater@pilotlight.test | member | `kit-nsc` | `mem-tidewater` |
| `usr-ines` | Ines Calloway | books@ledgerline.test | bookkeeper | `kit-nsc` | |
| `usr-teo` | Teo Marsh | operator@larkspur.test | operator | `kit-lark` | |
| `usr-copper` | Sam Ortiz | copperpot@pilotlight.test | member | `kit-lark` | `mem-copper` |

Members, with the contact email equal to the user's email:
- `mem-ember` "Ember & Rye Bakery"
- `mem-saltline` "Saltline Catering"
- `mem-wren` "Wren Street Dumplings"
- `mem-tidewater` "Tidewater Granola"
- `mem-copper` "Copper Pot Jams"

Documents (id, member, type, state, expiry):
- `doc-ember-coi`, `mem-ember`, insurance, verified, today+300
- `doc-ember-fh`, `mem-ember`, food_handler, verified, today+300
- `doc-ember-agreement`, `mem-ember`, kitchen_agreement, verified, no expiry
- `doc-saltline-coi`, `mem-saltline`, insurance, verified, today+200
- `doc-saltline-fh`, `mem-saltline`, food_handler, verified, today+200
- `doc-wren-coi`, `mem-wren`, insurance, verified, today+10. It reads as expiring, and its reminders go out after first boot like any other.
- `doc-wren-fh`, `mem-wren`, food_handler, verified, today+200
- `doc-tide-coi`, `mem-tidewater`, insurance, verified, today−1. It reads as expired, so Tidewater has no cover.
- `doc-tide-fh`, `mem-tidewater`, food_handler, verified, today+200
- `doc-copper-coi`, `mem-copper`, insurance, verified, today+300
- `doc-copper-fh`, `mem-copper`, food_handler, verified, today+300

Each seeded document's original name is `<document id>.pdf`.

Pack ledger: `mem-ember` has one purchase movement of 80 quarters (balance 20.00 hours), with no invoice and nothing posted to billing.

Bookings, priced on the seed cards, with no invoice and nothing posted to billing:
- `PL-000001`, `mem-saltline`, confirmed, date today+2. Deck oven 1 and Blast chiller from 05:00 to 07:00, tier 1. Lines: Deck oven 1, 8 quarters, $76.00; Blast chiller, 8 quarters, $75.00. Total $151.00.
- `PL-000002`, `mem-copper`, confirmed, date today+3. Jam kettle from 06:00 to 10:00, tier 1, 16 quarters, $136.00.

New bookings continue from `PL-000003`, and invoices start at `INV-000001`.

## Technical requirements

### Deployment (DP-01)

- Node.js 22 LTS with npm is the runtime, and all application source is TypeScript.
- `/app/run.json` holds string commands for `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, for example:
  `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}`
- `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set, and serves both the API and the built browser app from the same origin.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` once the server is listening, whether or not billing, storage or mail are reachable.
- The serve step applies the schema and seed data on every start without duplicating anything, so a freshly emptied database is ready without a separate build step.

### Configuration and secrets (DP-02)

- The server reads these at start: `DATABASE_URL`; `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `SMTP_HOST`, `SMTP_PORT`; `APP_PUBLIC_PORT`; `PILOTLIGHT_HOLD_SECONDS`.
- None of these values is written in source, bundled into browser assets, logged, or returned by any endpoint.
- The browser learns only what the API returns.
- Sessions live in PostgreSQL. Passwords are stored only as slow salted hashes.

### Server boundary (DP-03, DP-59)

- Only same-origin use is supported, and no cross-origin headers are sent. A state-changing request whose `Origin` header names another origin is answered 403 `{"error":"cross_origin","message":…}` at the first step of the error precedence in API.
- JSON request bodies may be up to 64,000 bytes, and exactly 64,000 is accepted. Larger bodies answer 413 `{"error":"payload_too_large","message":…}`.
- Upload requests may be up to 5,200,000 bytes in total, with the file part limited as stated in API.
- A body sent with the wrong content type answers 415 `{"error":"unsupported_media_type","message":…}`.
- The server serves only the built browser assets and the API. Requests for source files, `run.json`, package manifests, lockfiles, dependency folders, environment files or version-control folders answer 404 `not_found`.
- Error bodies never contain stack traces, SQL or service credentials.
- Session cookies are HttpOnly. Every response carries `X-Content-Type-Options: nosniff`.
- If billing, storage or mail is unreachable at boot, the server still starts, serves health, status and every unaffected action, and reports the outage as described in Services.

### Browser support and performance (DP-06, DP-11)

- The current stable Chromium, Firefox and WebKit are supported at 375x812, 768x1024 and 1280x800, with mouse, touch and keyboard.
- Fonts and icons are served by the app itself.
- With the seed data, the Loom is usable (grid, floor plan and rail drawn and accepting input) within three seconds of navigation.
- Brush painting keeps up with the pointer with no visible lag across all 80 columns and up to 15 rows.
- The rail settles on the server's price within one second after the brush stops changing.

## Working rules

- IF-01: `/app/run.json` exists at the app root with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and those commands alone install, build and serve the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at the app root lists every shipped package by name, version and licence, plus the bundled typefaces and icon set. Shipped packages means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package, typeface and icon is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0 or OFL-1.1.
- IF-04: PostgreSQL is the only datastore. No SQLite, Redis, embedded database, or JSON or CSV files are used as storage, and no network service other than the four named in this brief is contacted.
- IF-05: The provided service configuration and seed definitions for PostgreSQL, Kill Bill, MinIO and Mailpit are left unmodified.
- IF-06: All application source, server and browser alike, is TypeScript compiled with strict type checking enabled.

## Engineering standards

- Code is idiomatic TypeScript with strict typing. It uses no `any` and no type assertions that silence the compiler, and money is integer cents throughout, never floating-point dollars.
- Names in code match the domain terms in this brief: station, cell, brush, hold, booking, rate card, tier, surcharge, pack, movement, entry, cover, series, invoice.
- Each domain rule is decided in exactly one place in the source: the tier walk and rounding, the hold liveness edge, the cancellation window, compliance cover, each state machine's transitions and the error precedence. Every caller uses that one decision.
- There are no interfaces, wrappers or factories with only one implementation, and no indirection that exists only for hypothetical future providers.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the types or the database constraints already rule out.
- Every API error is produced through the single error shape in API, and no handler builds its own ad hoc error body.
- The source contains no features, endpoints, screens or settings beyond this brief.
