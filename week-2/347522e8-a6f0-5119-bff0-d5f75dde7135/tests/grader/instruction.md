# Brigade & Bench Railside

Railside is a booking and billing tool for one shared commercial kitchen. Four groups use it: the owner-operator, their shift leads, the people who rent hours there (caterers, food-truck crews, bakers and packaged-food startups), and inspectors or landlords who need to see compliance documents.

- **Renters** buy prepaid hour packs. They claim oven, mixer and prep-table time by sweeping along a station's rail, and they keep their insurance and food-handler documents current.
- **Shift leads** check renters in and out and block broken stations.
- **The operator** approves renters and prices stations, including cheaper overnight off-peak time. They get paid for every hour used, and they share current compliance documents with inspectors and landlords through an expiring link.

Build it in TypeScript on four services:
- Postgres is the system of record.
- Kill Bill handles renter billing.
- Mailpit receives all outgoing email.
- MinIO holds private files.

Out of scope:
- card capture (Kill Bill records payments against an external payment method)
- staff self-sign-up
- SMS
- native apps
- multiple kitchens
- any datastore beyond the four services

## Problem and users

Most shared kitchens are run by one owner-operator with a few part-time shift leads. They juggle a shared calendar, a spreadsheet of prepaid hours, emailed insurance PDFs and a separate invoicing tool. Things go wrong:
- a convection oven gets double-booked
- the sanitation turnover between two renters is skipped
- an overnight session is charged at the daytime rate
- an hour balance disagrees with what was charged

When a renter loses a booked production slot, a wholesale order can go with it. When an uninsured renter gets hurt on the premises, the operator carries the liability. The operator pays for all of this in refunds, unbilled overage, lost renters and insurance risk.

- **Kitchen operator** (daily): approves renters, keeps compliance current, prices stations (including off-peak) and gets paid for every hour actually used.
- **Renter chef** (weekly): buys hour packs, claims the station time a production day needs, and stops overpaying for unused or cancelled time.
- **Shift lead** (daily): checks renters in and out, records actual usage and overage, and blocks a broken station for maintenance.
- **Inspector or landlord** (occasional): views the kitchen's current renter compliance documents through a link the operator shares, without an account.

The device a person uses may have a wrong clock or be set to another time zone. Every time-dependent thing on screen follows the kitchen's clock as the server reports it.

## Journeys

1. **Apply and get approved.**
   - A visitor with no account opens Apply and enters their business details. They are signed in as a renter in `applied` status and land on My kitchen.
   - They upload a certificate of insurance, a food-handler card and a business licence, each with an expiry date. Their status becomes `documents_review`.
   - The operator signs in, lands on Operator, reviews the renter, approves each document and activates the renter.
   - The renter's next sign-in lands on the Board, and their docket compliance line reads current.
2. **Buy hours.**
   - An active renter with a low balance opens My kitchen and presses Buy 20-hour pack.
   - Without a reload, the purchase status confirms payment, a new pack line appears at the bottom of the hour ledger, the balance rises by 20.00 h, and a receipt arrives in their inbox.
   - If billing is down, the pack buttons are disabled with the outage notice, and booking with hours already owned still works. When billing comes back, the buttons re-enable on their own while the page stays open.
3. **Claim a production day.**
   - An active renter opens the Board for a future day and presses on an empty point of Convection oven 1's rail.
   - They drag right. The ticket prints downward, the buffer tail trails it, and the hours count up. Overnight slots are priced lower than daytime slots, exactly as the server will charge.
   - If they reach a neighbour's buffer, the ticket stops with a notch.
   - They release. The ticket stays paper while the claim is sent, then becomes an orange hold with a countdown.
   - They press Confirm booking in the docket. The ticket turns back to paper, and a confirmation email names the station, local time and buffer.
   - A keyboard user does the same with arrow keys and Enter. A renter who wants the same slot every week sets Repeat weekly, and the draft reprices at once.
4. **Cancel or be displaced.**
   - A renter opens one of their confirmed tickets, sees whether cancelling returns or forfeits hours, and cancels. The ticket leaves the rail and the balance updates.
   - The board refreshes underneath an open dialog without disturbing it.
   - Separately, when a shift lead blocks a station for maintenance, every renter with an overlapping booking gets the hours back and an email. A renter who has the board open sees and hears it happen.
5. **Run the shift.**
   - A shift lead signs in and lands on Shift, which shows today's usage sheet in kitchen time. The day is in the address, so a reload or the Back button keeps the day they were looking at.
   - They record a renter's actual start at check-in and actual end at check-out. The row shows completed with any overage, and the overage appears as a charge on the renter's billing account.
   - When a convection oven breaks, they block it, and the affected tickets are displaced.
   - On a phone they reach the other screens from the Menu button.
6. **Keep compliance current.**
   - Fourteen days before a renter's insurance expires, they get a reminder email.
   - If it lapses, from the next kitchen midnight their new bookings are refused, and the compliance scan suspends them and emails them.
   - They upload a new certificate and the operator approves it. They are active again and can book.
7. **Share compliance with an inspector.**
   - The operator creates a compliance link labelled for the health inspector with a one-day expiry, and copies it.
   - The inspector opens it without signing in, sees each renter's current documents and opens a scan.
   - The operator later revokes it, and the link at once shows that it is no longer active.
8. **Close the month.**
   - A renter creates last month's statement PDF from My kitchen and downloads it.
   - The operator starts a walk-in shelf subscription for a renter. If someone later cancels that subscription directly in billing, the operator's next look at the renter shows that it has ended, and they can start a new one.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Renter application** A visitor applies with business name, contact name, email, phone and password, which creates a renter in `applied` status and signs them in, as qualified in API.
- **DP-02 — Sign-in and roles** Seeded and applied users sign in with email and password, and each endpoint enforces the operator, shift lead and renter permissions and the single error-precedence rule stated in API.
- **DP-03 — Compliance document upload** A renter uploads a COI, food-handler card or business licence scan that is size-capped, type-checked by its content, stored privately under a generated name, and recorded as waiting for review.
- **DP-04 — Renter and document review states** Renter and document statuses move only along the legal transitions in Business rules, and every illegal transition is rejected with the stated 409.
- **DP-05 — Records visible only to their owner** A renter who requests another renter's renter record, booking, ledger, document, statement or file by identifier gets the same 404 as for an identifier that does not exist.
- **DP-06 — Buying an hour pack** A renter buys a 10-, 20- or 40-hour pack from My kitchen and, without a reload, sees the new ledger line, the raised balance and a re-enabled Buy button, and receives a receipt in their inbox.
- **DP-07 — One charge per purchase key** Repeating a purchase with the same key returns the original response with one Kill Bill payment, one ledger credit and one receipt, and the same key with a different pack answers 409.
- **DP-08 — Purchase is all-or-nothing** A purchase either records the Kill Bill payment, the ledger credit and the queued receipt together, or, when billing fails, records none of them.
- **DP-09 — Paired hour ledger** Every hour movement, including operator adjustments, is two equal and opposite entries, and every balance the API reports equals the sum of its entries.
- **DP-10 — Booking while billing is down** With Kill Bill unreachable, a renter still places and confirms holds against hours they own, and pack purchases answer 503 with the outage copy.
- **DP-11 — Billing recovers without restart** Every Kill Bill call, including the purchases-available check, is attempted fresh with a timeout of at most five seconds and no cached failure or availability flag, so billing that returns is used on the next request without a restart, and a failed purchase stores nothing that could later charge.
- **DP-12 — Station board** A signed-in user sees every station as a rail across the selected kitchen day with bookings, holds, buffers and maintenance blocks hanging below it, and a docket with balance and compliance, refreshed every 15 seconds.
- **DP-13 — Ticket rail sweep** Pressing and dragging on an empty point of a rail grows a snapped ticket with its buffer tail, its off-peak-aware price and the projected balance, stops at the last legal step with a notch, and on release places a hold as qualified in Interactions.
- **DP-14 — Keyboard sweep and hold** A keyboard user can focus a rail cell, extend or shrink a draft in 15-minute steps, place and confirm the hold, hear each step and conflict in the sweep announcer, and Tab and Shift+Tab wrap inside every open dialog.
- **DP-15 — Booking holds** Creating a booking places a hold that debits the booking's hour price from the balance, as validated and rejected in API and Business rules.
- **DP-16 — Hold expiry on the server** A hold that is not confirmed expires at its stated instant, after which confirming answers 409 and its hours return to the balance with a hold-expired email, whether or not any page is open.
- **DP-17 — Confirming a hold** Confirming a live hold makes the booking confirmed and queues one confirmation email that names the station, kitchen local time and buffer.
- **DP-18 — No overlap including buffers** No two holds, bookings or maintenance blocks on a station overlap once each booking's sanitation buffer is added, and a rejected claim reports the latest legal end.
- **DP-19 — One winner per slot** When several renters claim overlapping time on one station at the same moment, exactly one claim succeeds and every other answers the conflict 409.
- **DP-20 — Pending and losing tickets** A released ticket stays a paper draft with no hold signs until the server accepts it, and when someone else's claim won it shrinks to the legal end or disappears with the reason announced and the balance restored.
- **DP-21 — Cancellation cutoff** Cancelling a confirmed booking before the cutoff, which is the same kitchen wall-clock time two days before its start, returns its hours; at or after the cutoff the hours are forfeited.
- **DP-22 — Cancelling from the docket** A renter opens their booking from the board, sees whether cancelling returns or forfeits hours, cancels, and sees the ticket leave the rail and the balance update.
- **DP-23 — Weekly recurring bookings** A renter can hold the same station and wall-clock time for up to 12 consecutive weeks in one request, and the series is held, confirmed or rejected as one.
- **DP-24 — Wall-clock times across DST** Bookings keep their kitchen wall-clock times across daylight-saving changes, are priced by their real elapsed slots, reject times that do not exist, and treat repeated times as their first occurrence.
- **DP-25 — Shift check-in and check-out** A shift lead finds a booking on the usage sheet, records the actual start and end, and sees the row move to completed with any overage shown.
- **DP-26 — Overage at check-out** Check-out computes overage once from the recorded end in whole 15-minute units at the booking's own rate and records it as a Kill Bill charge on the renter's account.
- **DP-27 — Daily usage sheet** The usage sheet lists the bookings of one kitchen-local day, and defaults to today in the kitchen's time zone regardless of the browser or server zone.
- **DP-28 — Effective-dated station settings** A change to a station's hour weight, off-peak percent, overage rate or buffer applies only to bookings created on or after its effective date, and existing bookings keep their own values.
- **DP-29 — Maintenance blocks** A shift lead blocks a station for a time range, which displaces every overlapping hold and confirmed booking with a full hour credit and a displacement email to each affected renter.
- **DP-30 — Notification outbox** Every email the app sends is written with the action that causes it and delivered exactly once, retried while mail is unreachable, and the operator sees each one as queued or sent.
- **DP-31 — Lapsed documents block bookings** A COI or food-handler card is valid through the end of its expiry date in kitchen time, and from the next kitchen midnight new bookings for that renter answer 409.
- **DP-32 — Expiry notices and suspension** The compliance scan emails a renter once when a COI or food-handler card is 14 days or fewer from expiry and once when it lapses, and suspends an active renter whose COI or card lapsed.
- **DP-33 — Reinstatement after re-upload** A suspended renter uploads a current replacement, the operator approves it, and the renter becomes active and can book again.
- **DP-34 — Compliance link lifecycle** The operator creates a read-only compliance link with an expiry, and it stops working at once when revoked, when regenerated (the old token), or at its expiry instant.
- **DP-35 — Compliance link contents** A live compliance link shows only each renter's current approved documents and never balances, ledger, contact names, emails or phone numbers.
- **DP-36 — Inspector view** An inspector opens a shared link without an account and sees the kitchen's renters with their current documents, or the published empty copy when none qualify, and can open each scan.
- **DP-37 — Monthly statements** A renter or operator creates a monthly statement PDF of the renter's ledger, stored privately and listed for that renter.
- **DP-38 — Cold-storage shelf subscription** The operator starts and ends a monthly walk-in shelf subscription for a renter, and the app reports it active or ended only as Kill Bill confirms, including a cancellation made directly in Kill Bill.
- **DP-39 — Private files through signed links** Documents and statements are served only through short-lived signed storage links after an ownership or valid compliance-link check, and the bucket itself is never public.
- **DP-40 — Run manifest and health** The app installs, builds and serves from `/app/run.json` on port 4173 and answers the health check while any external service is down.
- **DP-41 — Server boundary** The server enforces same-origin writes, the stated body limits and never serves source files, configuration or credentials.
- **DP-42 — Responsive layout bands** Every screen shows the phone layout below 768 pixels wide, the tablet layout from 768 to 1199 and the desktop layout from 1200, without page-level horizontal overflow and with tap targets as qualified in Visual design.
- **DP-43 — Reduced motion** With reduced motion requested, tickets jump to their final size, numerals change instantly and the hold countdown updates once a minute as text, while keyboard and announcer behaviour stay the same.
- **DP-44 — Visual direction** Screens follow the steel-ruled paper look in Visual design, with heat orange reserved for live holds and the now-line and text never set on orange.
- **DP-45 — Ticket craft** Bookings read as thermal paper slips with perforated tops, hatched green buffer tails and a mono hour readout, and the board reads as rails on an hour grid.
- **DP-46 — Credentials from environment** Every service URL and credential is read from the environment named in Configuration and secrets, never hard-coded and never sent to the browser.
- **DP-47 — Off-peak hour pricing** A booking's price is the sum of its real 15-minute slots at the station's weight, with off-peak slots discounted by the station's off-peak percent and the total rounded up once, and the board's draft shows exactly the price the server debits.
- **DP-48 — Landing screen per role** After applying, signing in, signing out or opening a screen their role cannot use, each user lands on the published route for their role and status.
- **DP-49 — Kitchen day in the address** The board's and the usage sheet's day live in the address, so reloading, deep links, Back and Forward show the same kitchen day.
- **DP-50 — Refresh keeps work in progress** The board's 15-second refresh keeps an open dialog, the docket selection, a draft, focus and the countdown, and changes them only when the server shows the booking changed.
- **DP-51 — Displacement told in place** A renter with the board open whose booking is displaced by maintenance sees the ticket leave and hears the hours returned within 15 seconds, without reloading.
- **DP-52 — Pack availability re-checked in place** My kitchen re-checks whether pack purchases are available every 15 seconds and on window focus, and disables or re-enables the Buy buttons in place with the published copy.
- **DP-53 — Live hold restored on load** Every board load shows the renter's live hold in the docket with a countdown taken from the server, whichever day is shown, until it is confirmed, released or runs out.
- **DP-54 — Server kitchen clock on screen** The compliance line, today's date, the now-line and the cancellation outcome come from the server's data, so a wrong device clock or zone never changes them.
- **DP-55 — Collapsed phone navigation** Below 768 pixels the main navigation sits behind a Menu button, and while it is closed its links are hidden, unfocusable and absent from the accessibility tree.
- **DP-56 — Published empty states** Empty ledgers, statement lists, compliance-link lists, boards and usage sheets show the published empty-state copy word for word.
- **DP-57 — Repeat weekly reprices the draft** Changing Repeat weekly for while a draft exists reprices its series hours and projected balance in place, and shrinks or removes the draft when the balance no longer covers it.

## Frontend

### Screens and layout (DP-01, DP-06, DP-12, DP-25, DP-36, DP-37, DP-42, DP-48, DP-49, DP-55)

**Routes:**
- `/`: Sign in.
- `/apply`: Apply.
- `/board?date=<date>`: Board.
- `/kitchen`: My kitchen, renters only.
- `/operator`: Operator, operator only.
- `/shift?date=<date>`: Shift, for shift lead and operator.
- `/share/<token>`: Share, public.

**Landing routes.** "Landing" means the address bar shows that route and focus is on the named element.
- After Submit application succeeds, the new renter lands on `/kitchen`. Focus is on `heading "My kitchen"`, and `status "Application status"` on that screen shows the application success copy.
- After sign-in:
  - a renter in `applied` or `documents_review` status lands on `/kitchen`
  - any other renter lands on `/board`
  - the operator lands on `/operator`
  - the shift lead lands on `/shift`
- Opening `/` while signed in goes to that same role landing.
- Sign out lands on `/` with focus on `textbox "Email"`.
- A signed-in user who opens a screen their role cannot use is sent to their role landing. For example, a shift lead opening `/operator` lands on `/shift`, and the operator opening `/kitchen` lands on `/operator`.
- A visitor who is not signed in and opens any route other than `/`, `/apply` or `/share/<token>` is sent to `/`.

**The day in the address.**
- On `/board` and `/shift`, the `date` query parameter is the only source of the shown day.
- Pressing Previous day, Today or Next day on the board, or changing Sheet date on Shift, adds a history entry with the new `?date=<date>`. Back and Forward return to the previous day, and a reload shows the same day.
- A missing or malformed `date` shows today and replaces the address with `?date=<today>` without adding a history entry. "Today" is the server's kitchen date (DP-54).
- So a sign-in landing on `/board` or `/shift` ends with today's date in the address.

**Layout bands.** All screens use the same three bands:
- **Phone:** below 768 pixels wide.
- **Tablet:** 768 to 1199 pixels wide.
- **Desktop:** 1200 pixels and wider.

The arrangement described for each band applies across the whole band, including at its edges. The published check sizes are 375x812 (phone), 768x1024 (tablet) and 1280x800 (desktop). No screen ever scrolls sideways at page level at any width from 360 pixels up.

**Header (all signed-in screens):**
- The product name, `navigation "Main"` and `button "Sign out"`. Sign out is visible in every band.
- Tablet and desktop: the navigation links sit inline in the header, and there is no Menu button.
- Phone: the links sit in a drawer behind `button "Menu"`, which carries the expanded state.
  - While the drawer is closed, its links are not visible, not reachable by Tab and not in the accessibility tree.
  - Opening it shows the links below the header and moves focus to the first link.

**Sign in** and **Apply:** a single narrow form column on the paper ground, with the product name set large above it.

**Board:**
- A header row holds the date controls and the day line.
- Below it is an hour ruler from 00:00 to 24:00 that stays pinned at the top while the rails scroll.
- Each station is a horizontal steel rail with its name at the left. Bookings, holds and maintenance blocks hang below their rail as tickets, placed by start and end time.
- A vertical now-line marks the current kitchen time on today's board.
- When no station has any block on the shown day, the Rails region shows the board empty copy once, under the ruler.
- **Docket (renter):** the hour balance, the live-hold line (DP-53), the selected ticket, Repeat weekly for, the hold actions and the compliance line.
- **Docket (staff):** no balance, repeat or hold controls, and the selected ticket shows its renter's business name.
- Desktop: a 12-column grid. Rails take nine columns and the docket takes the right-hand three. The whole day fits the rail width.
- Tablet: rails take the full width and the whole day fits. The docket sits below the rails as a two-column panel.
- Phone: the rails sit in their own horizontally scrolling region with the ruler. Each 15-minute cell is 44 pixels wide, so about two hours show at a time, and the region opens scrolled to 06:00. The docket stacks below in one column.

**My kitchen (renters):**
- the hour packs with their Buy buttons, the current balance and the outage notice when it applies
- the hour ledger table
- documents with an upload form
- statements

Desktop: three columns (packs and balance; ledger; documents and statements). Tablet: two columns. Phone: one column in that order.

**Operator:** in this order:
1. renters table, with review, transitions, adjustments and the shelf subscription in a review dialog
2. stations table with settings
3. compliance links
4. notifications table

The sections sit in two columns on desktop and stack in that order on tablet and phone. Below 768 pixels, every wide table becomes one card per row.

**Shift:** the usage sheet for one day, with check-in and check-out actions per row, and the Block station action above it. On phone, each row becomes a card.

**Share** (`/share/<token>`, no sign-in):
- the kitchen name and address, then each renter's business name with their current documents (label and expiry date) and a link to open each scan
- a single column at every width
- a live link with no qualifying renters shows the share empty copy under the heading
- a dead link shows only the no-longer-active page from Feedback states

### Public screens and controls (DP-01, DP-02, DP-06, DP-12, DP-13, DP-14, DP-22, DP-25, DP-28, DP-29, DP-34, DP-36, DP-37, DP-38, DP-53, DP-55)

Only these roles, names and copy are public. Everything else is up to you.

These placeholder formats hold for every on-screen placeholder in this brief:
- `<station>` is a station name.
- `<HH:MM>` is a kitchen-local time.
- `<business>` is a renter business name.
- `<label>` is a document label (`certificate of insurance`, `food-handler card`, `business licence`) or a compliance link label.
- `<date>` is `YYYY-MM-DD` in kitchen time (for example `2026-11-07`).
- `<weekday>` is the English weekday name (for example `Saturday`).
- `<d>` is the day of the month without a leading zero (for example `7`).
- `<Month>` is the full English month name (for example `November`).
- `<yyyy>` is the four-digit year (for example `2026`). So the usage sheet heading reads, for example, `Usage sheet for Saturday 7 November 2026`.
- `<date time>` is `YYYY-MM-DD HH:MM <zone>` in kitchen time (for example `2026-11-07 14:30 CST`).
- `<zone>` is `CDT` or `CST`, whichever is in force at that instant. The board's day line uses the abbreviation in force at 12:00 that day, so a spring-forward Sunday shows `CDT` and an autumn-change Sunday shows `CST`.
- `<hours>` is defined under Derived display values in Business rules.

| Screen | Role and accessible name | Visible copy |
|---|---|---|
| Sign in | `form "Sign in"`, `textbox "Email"`, field labelled `Password`, `button "Sign in"`, `link "Apply for kitchen time"` | as named |
| Apply | `form "Apply"`, `textbox "Business name"`, `textbox "Your name"`, `textbox "Email"`, `textbox "Phone"`, field labelled `Password`, `button "Submit application"` | as named |
| All signed-in | `navigation "Main"` with `link "Board"`, `link "My kitchen"` (renter), `link "Operator"` (operator), `link "Shift"` (staff); `button "Sign out"`; below 768 pixels only, `button "Menu"` with an expanded state | as named |
| Board | `heading "Board"` (level 1), `button "Previous day"`, `button "Today"`, `button "Next day"` | day line `<weekday> <date> · <zone>` |
| Board | `region "Rails"` (scrolling region holding ruler and rails) | board empty copy from Feedback states when no station has a block |
| Board | one `grid "<station> schedule"` per station, each with 96 `gridcell "<station> <HH:MM>"` cells (00:00 to 23:45) | — |
| Board | draft ticket `img "Draft ticket <HH:MM> to <HH:MM>"` | `<HH:MM>–<HH:MM>`, `<hours> h`, and for a repeat `× <n> weeks` |
| Board | own held ticket `button "Hold <station> <HH:MM> to <HH:MM>"` | `HOLD`, times, `<hours> h` |
| Board | own confirmed ticket `button "Booking <station> <HH:MM> to <HH:MM>"` | times, `<hours> h` |
| Board | another renter's ticket `img "Booked <HH:MM> to <HH:MM>"` (staff see `button "<business> <station> <HH:MM> to <HH:MM>"`) | `Booked` (staff: business name) |
| Board | maintenance block `img "Maintenance <HH:MM> to <HH:MM>"` | `Maintenance` |
| Board | buffer tail `img "Buffer until <HH:MM>"` | — |
| Board | collision mark `img "Conflict notch"` | — |
| Board | now-line `img "Now"`; skipped hour on a spring-forward day `img "Skipped hour"` | — |
| Board | `status "Sweep announcer"` | step, stop and conflict copy from Feedback states |
| Docket | `complementary "Docket"` | — |
| Docket | `status "Hour balance"` | `<hours> h` |
| Docket | live-hold line | `Hold <station> <date> <HH:MM>–<HH:MM>`, where the date and times are those of the hold's first week |
| Docket | pending debit text | `Pending −<hours> h` |
| Docket | `timer "Hold countdown"` | `MM:SS` (reduced motion: `<n> min left`) |
| Docket | `spinbutton "Repeat weekly for"` (1 to 12, default 1) | `week(s)` |
| Docket | `button "Confirm booking"`, `button "Release hold"`, `button "Cancel booking"` | as named |
| Docket | compliance line (renters) | `Compliance: current`, `Compliance: expires <date>`, `Compliance: lapsed`, `Compliance: incomplete` |
| Docket | `status "Booking status"` | confirm, release, cancel, expiry and refresh copy |
| Cancel | `alertdialog "Cancel booking"`, `button "Yes, cancel"`, `button "Keep booking"` | outcome line from Feedback states |
| My kitchen | `heading "My kitchen"`; `region "Hour packs"` with `status "Hour balance"`, `button "Buy 10-hour pack"`, `button "Buy 20-hour pack"`, `button "Buy 40-hour pack"`; `status "Purchase status"` | pack name, `<hours> hours`, `$<amount>`; outage notice above the buttons |
| My kitchen | `table "Hour ledger"` (columns When, Movement, Hours, Balance) | ledger empty copy when there are no rows |
| My kitchen | `region "Documents"`, `combobox "Document type"`, `textbox "Expiry date"`, file field labelled `Scan file`, `button "Upload document"`, `status "Upload status"`, `link "View <label>"` per document row | one document row per kind with a document status word: `Waiting for review`, `Approved`, `Rejected` or `Expired` |
| My kitchen | `region "Statements"`, `textbox "Statement month"`, `button "Create statement"`, `link "Download <YYYY-MM> statement"`, `status "Statement status"` | statements empty copy when there are none |
| Operator | `heading "Operator"`, `table "Renters"`, `button "Review <business>"` per row | status words `Applied`, `In review`, `Active`, `Suspended`, `Offboarded` |
| Operator | `dialog "Review <business>"` with `button "Approve <label>"`, `button "Reject <label>"`, `button "Activate renter"`, `button "Offboard renter"`, `textbox "Adjustment minutes"`, `textbox "Adjustment reason"`, `button "Record adjustment"`, `textbox "Shelf label"`, `button "Start shelf subscription"`, `button "End shelf subscription"`, `button "Close"` | one document row per kind with the same document status words as My kitchen; shelf line `Shelf: <shelf label> · billing <billing>` or `Shelf: none` |
| Operator | `table "Stations"`, `button "Change settings for <station>"`, `dialog "Station settings"` with `textbox "Effective from"`, `textbox "Hour weight"`, `textbox "Off-peak percent"`, `textbox "Overage rate per hour"`, `textbox "Buffer minutes"`, `button "Save settings"` | — |
| Operator | `region "Compliance links"`, `textbox "Link label"`, `combobox "Expires after"` (options `1 hour`, `1 day`, `7 days`, `30 days`), `button "Create link"`, per link `button "Copy link <label>"`, `button "Regenerate <label>"`, `button "Revoke <label>"` | link states `Live until <date time>`, `Revoked`, `Expired`; links empty copy when there are none |
| Operator | `table "Notifications"` | status words `Queued`, `Sent` |
| Operator | `status "Operator status"` | — |
| Shift | `heading "Shift"`, `textbox "Sheet date"`, `heading "Usage sheet for <weekday> <d> <Month> <yyyy>"`, `table "Usage sheet"`, per row `button "Check in <business>"`, `button "Check out <business>"` | row status `Confirmed`, `Checked in`, `Completed`; sheet empty copy when there are no rows |
| Shift | `dialog "Check in"` with `textbox "Actual start"`, `button "Record check-in"`; `dialog "Check out"` with `textbox "Actual end"`, `button "Record check-out"` | — |
| Shift | `button "Block station"`, `dialog "Block station"` with `combobox "Station"`, `textbox "Date"`, `textbox "From"`, `textbox "Until"`, `textbox "Reason"`, `button "Save block"`; `status "Shift status"` | — |
| Share | `heading "Current compliance documents"`, one `heading "<business>"` per renter, `link "Open <label> for <business>"` | kitchen name and address, `Expires <date>` per document |

**The less obvious lines above:**
- **Shelf line.** `<shelf label>` is the subscription's shelf label. `<billing>` is the subscription's `billing_state` in lower case (`active`, `cancelled` or `unknown`).
- **Compliance line.** It follows `compliance.state`: `current`, `expiring`, `lapsed` or `incomplete`. For `expiring`, `<date>` is the earlier of `coi_expires_on` and `card_expires_on`.
- **Document rows.** My kitchen's Documents region and the review dialog each show at most one row per document kind: the most recently uploaded document of that kind, with its label, its expiry date and its document status word. Earlier documents of the same kind are not listed on either screen. So each `link "View <label>"`, `button "Approve <label>"` and `button "Reject <label>"` name is unique on its screen.
- **Document status words.** Both screens decide the word the same way, from the document's API `status` and its `expires_on` compared with today (the server's kitchen date, DP-54):
  - `Waiting for review`: `status` is `pending_review`, whatever its `expires_on`.
  - `Rejected`: `status` is `rejected`, whatever its `expires_on`.
  - `Expired`: `status` is `approved` and `expires_on` is before today in kitchen time. This is a display word only; the API `status` stays `approved`.
  - `Approved`: `status` is `approved` and the document is current (`expires_on` today or later, or a business licence with no date).
- **Review buttons.** In the review dialog, Approve and Reject appear on a row exactly while its document's `status` is `pending_review`, including a pending document whose `expires_on` has already passed (approving that one answers the `document_expired` rejection). Rows showing `Approved`, `Expired` or `Rejected` show the word and no review buttons.
- For example, with the seed data at start, Fennel Street Catering's certificate of insurance row reads `Expired` on both screens, and Smoke Signal BBQ's certificate of insurance row reads `Approved`.

**Hour ledger rows:**
- The table shows one row per movement that touches the renter's available account, oldest first.
- When is `<date time>`.
- Movement is one of:
  - `Opening balance`
  - `Pack purchase`
  - `Booking hold`
  - `Hold released`
  - `Cancellation credit`
  - `Displacement credit`
  - `Adjustment`
- Hours is `+<hours>` or `−<hours>` (the same minus sign as `Pending −`).
- Balance is the available balance after that movement, as `<hours>`.

### Interactions (DP-12, DP-13, DP-14, DP-20, DP-22, DP-25, DP-49, DP-50, DP-51, DP-52, DP-53, DP-55, DP-57)

**Board refresh.** The board reloads its blocks, the renter's balance and the renter's own live holds at these times:
- when the day changes
- right after each of the user's own actions
- every 15 seconds while it is open

Another renter's new hold, or a released hold, therefore shows within 15 seconds.

A refresh never does any of the following unless the server's data changed it:
- close an open dialog or alertdialog
- clear the docket selection
- discard, move or resize a draft that is being swept or extended by keyboard
- move focus
- restart or jump the countdown
- change the Cancel booking outcome line

**When a refresh finds the renter's own ticket gone.** This applies when a refresh shows that the renter's own ticket on the shown day, or the docket's selected booking or live hold, is no longer `hold` or `confirmed` (for example because a shift lead displaced it). Then:
1. Its ticket leaves the rail.
2. Any dialog about it closes.
3. The docket selection clears.
4. The balance shows the new value.
5. Focus moves to the rail cell at the ticket's start, if focus was in the docket or the dialog.
6. `status "Booking status"` speaks the displacement copy when the booking is `displaced`, and otherwise the no-longer-active copy, unless the renter's own action just caused the change.

**Server time on screen.** The now-line, the countdown, "today" and the Cancel booking outcome line follow `server_now` from the latest response, not the device clock. Between responses the countdown and now-line advance with elapsed time, and every response re-synchronises them.

**Pointer sweep (renters).**
1. **Drop a stub.** Pressing on an empty point of a rail drops a 15-minute stub whose start snaps to the nearest 15-minute mark. Pressing on a ticket, a buffer tail, a maintenance block, the skipped hour or a time before `server_now` drops nothing and announces the taken-time copy.
2. **Drag.** Dragging right moves the end edge to the nearest 15-minute mark under the pointer:
   - at least 15 minutes after the start
   - at most six hours after it
   - never past 24:00

   Dragging back left shrinks the ticket step by step down to 15 minutes. The start never moves.
3. **At each step:**
   - The ticket's width matches its time span on the rail.
   - Its height grows 12 pixels for every 15 minutes, from 12 pixels at 15 minutes to 288 pixels at six hours.
   - A hatched green buffer tail as long as the station's buffer trails the end edge.
   - The ticket's hours figure shows the draft's price under DP-47, times the repeat count as defined there.
   - The docket balance shows the projected balance.
   - The announcer speaks the step copy.
4. **Stops.**
   - If the end edge plus its buffer would touch another ticket, buffer or maintenance block, the edge stays at the last legal step. A notch about 4 pixels deep appears in the rail where the collision starts, and the announcer speaks the conflict copy once.
   - The edge also stops at six hours, at 24:00 and at the last step the balance can still cover. These stops show no notch, and the announcer speaks the matching stop reason once.
5. **Release.** Releasing sends the hold request. While it is pending:
   - The ticket stays a paper `img "Draft ticket <HH:MM> to <HH:MM>"` with no orange fill, no `HOLD` text, no `timer "Hold countdown"`, no `Pending −` line and no enabled `Confirm booking`.
   - The docket keeps the projected balance, and the announcer speaks the pending copy.
6. **Hold accepted.** Only a successful answer turns it into a hold. The ticket clips up onto the rail and turns into an orange hold under a paper label strip. The docket shows the pending debit, the countdown (from `hold_expires_at` minus `server_now` of that answer), Confirm booking and Release hold.
7. **Claim lost.** If the server answers that the slot is taken (DP-20):
   - The ticket shrinks to the server's `legal_end`, or is removed when it is `null`.
   - The announcer speaks the lost-claim copy.
   - The docket balance returns to `balance_minutes` ÷ 60 as it was before the draft.
   - A shrunk ticket stays on the rail as a paper draft of the legal span. It holds that span on Enter (keyboard) or on a press on the draft (pointer). It goes away on Escape or when a new sweep starts. While it waits, the docket shows `balance_minutes` ÷ 60, not a projected balance.
8. **Touch.** A quick swipe scrolls the rails. Pressing and holding an empty point for half a second starts a sweep, and steps 2 to 7 follow.

**Keyboard sweep (renters).**
- **Moving.** Tab reaches each station grid once. The grid's active cell defaults to 06:00 and moves with:
  - Left and Right: 15 minutes
  - Home and End: 00:00 and 23:45
  - Up and Down: the same time on the previous or next station
- **Drafting.** On a focused empty cell, Shift+Right drops a 15-minute draft starting there. Each further Shift+Right extends it by 15 minutes. Shift+Left shrinks it by 15 minutes and removes it at 15 minutes. Limits and conflicts stop the edge exactly as in the pointer sweep, with the same notch and copy.
- **Holding.** Enter sends the hold request with the same pending, accepted and lost-claim behaviour as the pointer sweep. When the hold is accepted, focus moves to Confirm booking. Escape discards a draft and keeps focus on the cell.

**Repeat weekly.**
- Setting Repeat weekly for to 2–12 makes the hold cover that many weeks at the same station and wall-clock time.
- Changing it while a draft exists updates that draft at once, with no new sweep:
  - the `× <n> weeks` label
  - the series hours figure (the series total under DP-47, with daylight-saving weeks priced by their real slots)
  - the projected balance
  - a fresh step announcement
- If the series no longer fits `balance_minutes`, the end edge shrinks to the last step whose series total fits, and the announcer speaks the balance stop copy with that new end. If not even 15 minutes fits, the draft is removed with the same copy.
- The board's day and the draft's date never change when the repeat count changes.

**Tab order on the board:**
1. header (Menu on phones, navigation links, Sign out)
2. date controls
3. rails in station order
4. docket: Repeat weekly for, Confirm booking, Release hold, Cancel booking

**Confirming and releasing.**
- **Confirm booking** confirms the hold (the whole series for a repeat). The ticket turns from orange to paper. Focus moves to that ticket's `button "Booking <station> <HH:MM> to <HH:MM>"` when its day is shown, and otherwise to `heading "Board"`.
- **Release hold** releases the hold. The ticket is removed, and focus returns to the rail cell where it started (or to `heading "Board"` when that day is not shown).
- **Countdown at zero.** When the countdown reaches zero, the ticket and the live-hold line are removed, the expired copy shows, and the balance shows the returned hours by the next refresh.

**Live hold on load.** Every board load, on any shown day, asks the server for the renter's own holds. The docket shows the live hold with the latest `hold_expires_at`: its live-hold line, the countdown, Confirm booking and Release hold. Its ticket is drawn when its day is shown. A reload or a visit to another day therefore keeps the hold and its countdown.

**Cancelling.**
1. Activating your own confirmed ticket selects it in the docket.
2. Cancel booking opens the Cancel booking alertdialog, which shows the outcome line. The line is decided by the booking's `cancellation_cutoff_at` against the latest `server_now`.
3. Yes, cancel cancels the booking, and the ticket and the dialog go away. Keep booking or Escape closes the dialog.
4. Focus returns to Cancel booking or, after a cancellation, to the rail cell at the ticket's start.

**My kitchen packs.**
- While My kitchen is open, it re-asks the server whether purchases are available every 15 seconds, and whenever the window regains focus. It never relies on an earlier answer beyond the next check.
- **Available turns false:** the three Buy buttons disable, and the outage copy shows above them and in `status "Purchase status"`.
- **Available turns true:** the outage copy above the buttons disappears, the buttons enable, and the status region speaks the availability copy.
- **After a successful purchase, without a reload:**
  - a `Pack purchase` row appears at the bottom of the hour ledger, with Balance equal to the new `balance_minutes` ÷ 60
  - `status "Hour balance"` shows the same value
  - the Buy button enables again

**My kitchen documents.** After a successful upload, the row for that kind shows the new document with `Waiting for review`, replacing the row for any earlier document of that kind, without a reload.

**Shift.**
- Check in opens a dialog with Actual start filled with the current kitchen time from the server, rounded down to 15 minutes. Check out works the same way with Actual end.
- The row updates after each save.
- Block station opens its dialog with the sheet's date.
- Changing Sheet date updates the address as described under Screens and layout.

**Operator.**
- Review opens the review dialog, which reads the renter fresh, including the document rows and the shelf line.
- Approve and Reject act on the row's document. Activate renter and Offboard renter call transitions.
- Copy link copies the full share URL and shows `Copied` next to the button for two seconds.

**Phone menu.**
- Menu opens the drawer and moves focus to its first link.
- While the drawer is open, Tab and Shift+Tab cycle only through Menu and the drawer's links.
- Escape or Menu closes it and returns focus to Menu.
- Following a link closes it.

**Dialogs.** Every dialog and alertdialog:
- starts on its first field or primary button
- wraps focus: Tab from the last focusable control goes to the first, and Shift+Tab from the first goes to the last. A native dialog element alone does not do this, so focus must be kept inside explicitly.
- closes on Escape
- returns focus to the control that opened it, unless a rule above names another target

### Visual design (DP-42, DP-44, DP-45)

**Colour roles:**
- **Ground:** a warm pale paper grey under every screen.
- **Ink:** near-black, for all text and ticket outlines.
- **Heat orange:** the one fill reserved for live holds and the now-line. Nothing else uses it, including a draft whose hold request is still pending.
- **Buffer:** a deep bottle green, drawn only as diagonal hatching on buffer tails.
- **Rules:** a mid steel grey, for the one-pixel rules of the grid, rails and table lines.
- **Tickets:** off-white thermal paper, slightly lighter than the ground. A held ticket's orange body carries its text on a paper label strip, so text never sits on orange.
- **Maintenance blocks:** ink cross-hatching on paper.
- **Errors:** ink text with a bold rule and an icon, never a new colour.

**Type:**
- **Display:** a heavy, wide grotesque (Archivo Black) for the product name, screen headings and station names.
- **Body:** a plain, highly legible public-service sans (Public Sans) for body text and controls.
- **Numbers:** every hour figure, time, countdown, amount and balance is set in a monospaced face under an open font licence, so digits line up and don't jitter while counting.
- **Scale:** each heading level is a third larger than the one below it, and the screen heading is roughly two and a third times body size.

**Density and tap targets:** compact. Rows and rails sit tightly on the grid.
- Every button, link and form control is at least 44 by 44 pixels, with the two exceptions below.
- **Rail cells** are at least 44 pixels tall at every width, and 44 pixels wide in the phone band. On tablet and desktop the whole day fits the rail, so a cell is as wide as its share of the rail.
- **Ticket buttons** (a renter's own held and confirmed tickets, and the staff ticket buttons) are exempt from the 44-pixel minimum. Their size and hit area are their drawn size from the ticket height rule below and their time span's width on the rail. Every action a ticket button offers is also reachable from the docket, whose controls meet the 44-pixel minimum.

**Composition:** a rigid 12-column grid with visible one-pixel steel rules. Stations run down the page as horizontal rails, with tickets hanging below like order slips on a kitchen ticket rail. The docket reads like a printed tab: balance in large mono numerals, then the live hold or selected ticket, then compliance.

**Tickets:** each ticket has:
- a perforated top edge (a row of small half-circle cut-outs)
- a faint paper shadow
- start–end times and the hours figure in mono

Every ticket on the board (draft, hold, confirmed or checked-in booking, another renter's ticket, and a maintenance block) is drawn by the same height rule as a sweeping draft (Interactions, pointer sweep step 3), capped at the six-hour height. A hold keeps the height it had at release when it settles onto the rail, and keeps it when it is confirmed. A ticket's times and hours figure may be clipped on short tickets; its accessible name always carries the full times.

Icons come from Lucide. Tickets and rails are drawn as procedural vector shapes, not images.

**Contrast:** all text and controls meet WCAG 2.2 AA. Every interactive element shows a two-pixel ink focus ring offset from it.

### Motion and effects (DP-13, DP-20, DP-43)

**Feel.** Every movement starts quickly and comes to a soft stop without bouncing past its end. Three timings are used, and nothing takes longer than half a second:
- a sweep step in about an eighth of a second
- a settle or state change in about a quarter of a second
- a retract or removal in under half a second

**Sweep step.**
- At each 15-minute step the ticket's end edge and buffer tail slide to the new position.
- The ticket prints downward to its new height, like paper feeding from a thermal printer.
- The hours figure and the docket balance roll to their new values.
- All three finish within the step time. The same roll happens when Repeat weekly changes a draft's price.
- Sweeping back reverses each step: the ticket narrows and rises, and the numbers count down, step by step.

**Conflict stop.** The notch cuts into the rail in about an eighth of a second, and the end edge stays still.

**Pending.** While a hold request is pending, the released draft stays still on paper. Nothing pulses or spins on the ticket.

**Hold settle.** When the server accepts the hold, the ticket lifts onto the rail and settles in about a quarter of a second while its body fills orange. Its width and height do not change.

**Confirm.** The orange fades back to paper in about a quarter of a second.

**Retract.** When a claim loses, or a refresh finds an own ticket gone, the ticket shrinks back to the legal end, or slides up into the rail and disappears, in under half a second.

**Hover and press.** An empty rail point under the pointer shows a thin ink tick at the snapped time. Buttons darken their rule on hover and sink slightly on press, both in about an eighth of a second.

**Live elements.** The hold countdown ticks once a second, and the now-line moves once a minute. There are no other loops, no decorative animation, no auto-playing media and no parallax.

**Reduced motion** (when the operating system asks for it):
- No print-down, slide, settle, fade or numeral rolling.
- The ticket appears at its final width and height at each step, and numerals change instantly.
- The countdown shows `<n> min left` (minutes rounded up), updating once a minute.
- Keyboard steps, limits, the notch and the announcer copy stay the same.

### Feedback states (DP-01, DP-06, DP-10, DP-13, DP-14, DP-16, DP-17, DP-20, DP-22, DP-25, DP-29, DP-33, DP-34, DP-36, DP-37, DP-38, DP-50, DP-51, DP-52, DP-56, DP-57)

**Keyboard-complete flows.** Every action in every journey works by keyboard alone: sweep, hold, confirm, release, cancel, purchase, upload, review, check-in, check-out, blocking a station, managing links and opening the phone menu. During a sweep, `status "Sweep announcer"` speaks the start, end, hours and buffer at every step, and says what the conflict is whenever an edge stops. A pointer user and a keyboard user hear the same copy.

**General rules.**
- Every async action disables its trigger while pending.
- A failure never leaves an action looking done.
- Any unexpected server error shows `Something went wrong. Try again.` in that action's live region.
- Copy is shown exactly as printed here, with straight apostrophes, the en dash in time ranges, `…` as a single ellipsis character, and `−` as the minus sign.

| Action | Live region | Pending | Success | Errors and outage |
|---|---|---|---|---|
| Sign in | `status "Sign-in status"` | button reads `Signing in…` | goes to the role landing | `That email and password don't match.` |
| Apply | `status "Application status"` | `Sending application…` | `Application received. Upload your three documents to move to review.` (shown on My kitchen after landing) | field messages beside each field (`errors` keys from API) |
| Buy pack | `status "Purchase status"` | `Processing purchase…` | `Paid. <hours> hours added to your balance. Your receipt is on its way.` | billing down: `Pack purchases are unavailable right now. You can still book with the hours you already own.` (this is also the outage notice above the disabled pack buttons whenever `purchases_available` is false); declined: `The payment didn't go through. No hours were added.`; not active: the not-active copy from Place hold |
| Pack availability returns | `status "Purchase status"` | — | `Pack purchases are available again.` | — |
| Upload | `status "Upload status"` | `Uploading…` | `<label> uploaded. It's waiting for review.` | too large: `That file is larger than 5,000,000 bytes.`; wrong type: `Upload a PDF, PNG or JPEG scan.`; storage down: `File storage is unreachable. Try the upload again in a minute.` |
| Sweep step or repeat change | `status "Sweep announcer"` | — | `<station>, <start> to <end>, <hours> hours, buffer until <buffer end>.` | taken: `That time is taken.`; stop: `Can't extend past <end>: <reason>.`, where `<end>` is the edge's final end and `<reason>` is `another booking starts at <HH:MM>`, `another booking's buffer runs until <HH:MM>`, `maintenance starts at <HH:MM>`, `six hours is the longest booking`, `the kitchen day ends at 24:00`, or `your balance covers <hours> hours` |
| Place hold | `status "Sweep announcer"` | `Placing hold…` | `Hold placed on <station> <start> to <end>. Confirm before the countdown ends.` | lost claim: `Another renter claimed this time first. Your ticket now ends at <legal end>.` or `Another renter claimed this time first. Your ticket was removed.`; short of hours: `You need <needed> hours and have <balance>. Buy a pack to continue.`; lapsed (`compliance_lapsed`): `Bookings are paused until your certificate of insurance and food-handler card are current.`; not active (`renter_not_active`): `Your account isn't active yet.` |
| Confirm | `status "Booking status"` | `Confirming…` | `Booking confirmed. A confirmation email is on its way.` | `This hold ran out and the time was released.` (also shown when the countdown reaches zero, or when a refresh or action finds the hold expired) |
| Release | `status "Booking status"` | `Releasing…` | `Hold released. <hours> hours returned to your balance.` | — |
| Cancel | `status "Booking status"` | `Cancelling…` | `Booking cancelled. <hours> hours returned to your balance.` or `Booking cancelled. <hours> hours were forfeited because it was within 48 hours of the start.` | — |
| Cancel dialog outcome line | inside `alertdialog "Cancel booking"` | — | `Cancelling now returns <hours> hours.` before the cutoff, `Cancelling now forfeits <hours> hours.` at or after it | — |
| Refresh finds own ticket gone | `status "Booking status"` | — | displaced: `Your booking on <station> <HH:MM>–<HH:MM> was displaced by maintenance. <hours> hours returned to your balance.`; any other reason: `This booking is no longer active.` | — |
| Check in | `status "Shift status"` | `Saving…` | `Checked in at <HH:MM>.` | field message |
| Check out | `status "Shift status"` | `Saving…` | `Checked out. Overage: <units> × 15 minutes, $<usd>.` or `Checked out. No overage.` | billing down: `Billing is unreachable, so this check-out wasn't recorded. Try again in a minute.` |
| Block station | `status "Shift status"` | `Saving…` | `Station blocked. <n> bookings displaced. Affected renters are being emailed.` | in use: `Someone is checked in on that station during that time.` |
| Review, transition, adjustment, settings | `status "Operator status"` | `Saving…` | `<label> approved.`, `<label> rejected.`, `Renter activated.`, `Renter offboarded.`, `Adjustment recorded.`, `Settings saved. They apply to bookings created from <date>.` | incomplete: `Every document must be approved and current first.`; expired: `That document has already expired.` |
| Shelf subscription | `status "Operator status"` | `Saving…` | `Shelf subscription started for <business>.` / `Shelf subscription ended for <business>.` | billing down: `Billing is unreachable. Try again in a minute.`; not active: `That renter must be active to start a shelf subscription.` |
| Links | `status "Operator status"` | `Saving…` | `Link created. It works until <date time>.`, `Link revoked.`, `New link created. The old link no longer works.` | — |
| Statement | `status "Statement status"` | `Creating statement…` | `Statement for <YYYY-MM> is ready.` | storage down: the upload storage copy above |
| Share page (dead link) | page heading | — | — | `This link is no longer active` with body `Ask the kitchen operator for a new link.` |

In the table above:
- `<n>` in the block copy is the number of holds and confirmed bookings displaced, across all renters.
- `<HH:MM>–<HH:MM>` in the displacement copy is the booking's start and end.

**Empty states** (exact copy):

| Where | Copy |
|---|---|
| Board, in `region "Rails"`, when no station has a block on the shown day | `No bookings on this day.` |
| My kitchen, `table "Hour ledger"` with no rows | `No hour movements yet.` |
| My kitchen, `region "Statements"` with no statements | `No statements yet.` |
| Operator, `region "Compliance links"` with no links | `No compliance links yet.` |
| Shift, `table "Usage sheet"` with no rows | `No bookings on this day.` |
| Share page, live link with no qualifying renters | `No current documents to show.` |

## Backend

### API (DP-01, DP-02, DP-05, DP-07, DP-15, DP-16, DP-17, DP-18, DP-21, DP-25, DP-26, DP-27, DP-28, DP-29, DP-30, DP-34, DP-35, DP-37, DP-38, DP-39, DP-47, DP-53)

**Conventions.**
- All endpoints are under `/api`.
- Request and response bodies are `application/json; charset=utf-8`, except multipart uploads and redirects. Body limits are in Server boundary.
- Every error body has the shape `{"error":"<code>"}`, sometimes with extra fields.
- Validation errors are `422 {"error":"validation","errors":{"<field>":"<message>"}}`. Messages are free text and never empty, except where an exact message is given below.

**Formats:**
- `date` is `YYYY-MM-DD` and `month` is `YYYY-MM`, both in kitchen time.
- `start`, `end`, `actual_start` and `actual_end` are kitchen-local `HH:MM` on a 15-minute mark from `00:00` to `24:00` (`24:00` only as an end).
- Instants (`*_at`, `server_now`) are ISO 8601 UTC with milliseconds.
- Hour quantities are integer minutes (`*_minutes`).
- Money is a string with two decimals (`"540.00"`).

**Authentication.** A session cookie `rs_session` (HttpOnly, SameSite=Lax, Path=/) is set by sign-in or application. Roles are `operator`, `shift_lead` and `renter`. "Staff" means operator or shift lead.

**Identifiers in paths and bodies.**
- An identifier in the path (`{renter_id}`, `{booking_id}`, `{station_id}`, `{document_id}`, `{statement_id}`, `{block_id}`, `{link_id}`) that is unknown answers `404 not_found` at step 6 below. For example, `POST /api/stations/oven-9/settings` and `POST /api/stations/oven-9/maintenance` answer `404 not_found`.
- An identifier in a request body names a shared kitchen record, never a renter-owned one: `station_id` in a booking and `pack_id` in a purchase. An unknown one answers `422` under its own key (`errors.station_id`, `errors.pack_id`) at the validation step.

**Error precedence, for every endpoint:**
1. `413 {"error":"payload_too_large"}` for a body over its limit from Server boundary.
2. `403 cross_origin`, the same-origin rejection from Server boundary.
3. `405 read_only`, for any method other than GET on an `/api/share/...` path.
4. `415 {"error":"unsupported_media_type"}` (a JSON endpoint given another content type).
5. `401 {"error":"unauthenticated"}`.
6. `404 {"error":"not_found"}` for an unknown path identifier, or for any identifier owned by another renter when the caller is a renter. A renter never learns whether another renter's booking, renter record, ledger, document, statement or file exists. Nested identifiers are checked the same way.
7. `403 {"error":"forbidden"}` when the caller's role may not use the endpoint.
8. An idempotent replay or key conflict.
9. `409` conflicts with the stored state of the target. They are checked in this order, and the first that applies is the answer: `hold_expired`, `invalid_transition`, `renter_not_active`, `renter_offboarded`, `compliance_lapsed`, `already_revoked`, `already_subscribed`, `not_subscribed`. In particular, `renter_not_active` is always checked before `compliance_lapsed`.
10. `422` validation, including an unknown body identifier and a missing or empty upload file.
11. Upload file checks, in this order: `413 file_too_large`, then `415 unsupported_type` (the content check from Server boundary).
12. `401 invalid_credentials` (sign-in only).
13. `409` conflicts that depend on the request's content, in this order: `station_in_use`, `slot_conflict`, `insufficient_hours`, `documents_incomplete`, `document_expired`, `has_future_bookings`. The first that applies is the answer.
14. Provider outcomes: `503` when the provider is unreachable, or `402 payment_failed` when Kill Bill is reachable but declines.

Endpoint rows list only their own codes. `invalid_transition` bodies are `{"error":"invalid_transition","from":"<status>","to":"<status>"}`.

**Session and accounts**
- `POST /api/applications` (no session):
  - Body `{"business_name","contact_name","email","phone","password"}`.
  - Lengths: business and contact names 1–120 characters, phone 7–30, password 10–200.
  - Answers `201 {"user":{…},"renter":{"id","status":"applied"}}`, creates the user and renter, and sets the session.
  - `422` for each bad field. An email already in use answers `422` with `errors.email` `That email already has an account.`
- `POST /api/session` with `{"email","password"}` answers `200 {"user":{"id","name","email","role","renter_id","renter_status"}}` and sets the cookie. `renter_status` is `null` for staff. Wrong credentials answer `401 {"error":"invalid_credentials"}`.
- `DELETE /api/session` answers `204`.
- `GET /api/me` answers `200 {"user":{…}}` with the same fields.

**Renters**
- `GET /api/renters` (staff) answers `200 {"renters":[…]}`. Each item is the renter object below without `shelf_subscription`. This list never contacts Kill Bill.
- `GET /api/renters/{renter_id}` (owner or staff) answers `200 {"renter":{"id","business_name","contact_name","email","phone","status","balance_minutes","held_minutes","compliance":{"state":"current"|"expiring"|"lapsed"|"incomplete","coi_expires_on","card_expires_on"},"shelf_subscription":null|subscription}}`.
  - The subscription object is `{"shelf_label","plan":"walk-in-shelf-monthly","external_key","killbill_subscription_id","state":"active"|"cancelled","billing_state":"ACTIVE"|"CANCELLED"|"unknown"}`.
  - This read checks the current subscription with Kill Bill as described in Services. It answers within three seconds even when Kill Bill is unreachable.
- `POST /api/renters/{renter_id}/transitions` (operator) with `{"to":"active"|"offboarded"}` answers `200 {"renter"}`. Errors: `409 invalid_transition`, `409 {"error":"documents_incomplete"}`, `409 {"error":"has_future_bookings"}`.

**Documents**
- `POST /api/renters/{renter_id}/documents` (owner):
  - Multipart fields:
    - `kind`: `coi`, `food_handler_card` or `business_licence`
    - `expires_on`: a `date`, required for `coi` and `food_handler_card`, optional for `business_licence`
    - `file`
  - Answers `201 {"document":{"id","renter_id","kind","expires_on","status":"pending_review","original_name","size_bytes","content_type","created_at"}}`.
  - Errors:
    - `413 {"error":"file_too_large"}`
    - `415 {"error":"unsupported_type"}`
    - `422` with `errors.kind`, `errors.expires_on` (malformed or before today) or `errors.file` (missing or empty)
    - `409 {"error":"renter_offboarded"}`
    - `503 {"error":"storage_unavailable"}`
- `GET /api/renters/{renter_id}/documents` (owner or staff) answers `200 {"documents":[document]}` with every document the renter has uploaded, newest first.
- `GET /api/documents/{document_id}` (owner or staff) answers `200 {"document"}`.
- `GET /api/documents/{document_id}/file` (owner or staff) answers `302`, with `Location` set to a signed storage URL.
- `POST /api/documents/{document_id}/review` (operator) with `{"decision":"approve"|"reject","note"?}` answers `200 {"document","renter"}`. Errors: `409 invalid_transition` (the document is not `pending_review`), `409 {"error":"document_expired"}`.

**Packs and purchases**
- `GET /api/packs` (signed in) answers `200 {"packs":[{"id","name","hours","amount_usd"}],"purchases_available":true|false}`.
  - `purchases_available` comes from a live billing check with a two-second timeout, made on each call.
  - The endpoint answers within three seconds whether or not Kill Bill is reachable.
- `POST /api/purchases` (renter):
  - Header `Idempotency-Key`: 1–64 characters from letters, digits, `-` and `_`.
  - Body `{"pack_id"}`.
  - Answers `201 {"purchase":{"id","pack_id","pack_name","hours","amount_usd","killbill_payment_id","created_at"},"balance_minutes"}`.
  - A missing or malformed key answers `422` with `errors.idempotency_key`. An unknown pack answers `422` with `errors.pack_id`.
  - Also:
    - `409 {"error":"idempotency_conflict"}` (the key was used with a different body)
    - `409 renter_not_active`
    - `402 {"error":"payment_failed"}` (Kill Bill declined)
    - `503 {"error":"billing_unavailable"}`

**Ledger**
- `GET /api/renters/{renter_id}/ledger` (owner or staff) answers `200 {"balance_minutes","held_minutes","entries":[{"id","movement_id","kind","account","direction":"debit"|"credit","minutes","booking_id","purchase_id","note","created_at"}]}`. Entries are oldest first and include both entries of every movement that touches the renter's accounts.
- `POST /api/renters/{renter_id}/adjustments` (operator) with `{"minutes","reason"}` answers `201 {"movement_id","balance_minutes"}`.
  - `minutes` is a non-zero multiple of 15 from −24000 to 24000 inclusive. `reason` is 1–200 characters. Either failing answers `422`.
  - Also `409 {"error":"insufficient_hours","balance_minutes","needed_minutes"}`.

**Stations and maintenance**

A settings object is `{"station_id","effective_from","hour_weight","off_peak_percent","overage_usd_per_hour","buffer_minutes"}`.

- `GET /api/stations?date=<date>` (signed in):
  - `date` defaults to today in kitchen time. Without a `date`, the answer's `date` is the server's kitchen date, which every screen uses as "today".
  - Answers `200 {"date","time_zone","server_now","stations":[{"id","name","hour_weight","off_peak_percent","overage_usd_per_hour","buffer_minutes","upcoming_settings":[settings],"blocks":[{"kind":"booking"|"hold"|"maintenance","start","end","starts_at","ends_at","buffer_ends_at","mine","booking_id","renter_business_name"}]}]}`.
  - The station's `hour_weight`, `off_peak_percent`, `overage_usd_per_hour` and `buffer_minutes` are the settings a booking created now would get.
  - `blocks` holds that kitchen day's holds, confirmed, checked-in and completed bookings, and maintenance blocks. A block is listed on every day its occupied time touches.
  - For a renter, another renter's block has `booking_id` and `renter_business_name` set to `null`.
  - A malformed `date` answers `422`.
- `POST /api/stations/{station_id}/settings` (operator) with `{"effective_from","hour_weight","off_peak_percent","overage_usd_per_hour","buffer_minutes"}` answers `201 {"settings"}`. Field rules:
  - `effective_from` is today or later.
  - `hour_weight` is 1, 2 or 3.
  - `off_peak_percent` is 50, 60, 70, 80, 90 or 100.
  - `overage_usd_per_hour` is a money string from 0.00 to 500.00.
  - `buffer_minutes` is 0–120 in multiples of 15.
  - A field that breaks its rule answers `422` under its own key.
- `POST /api/stations/{station_id}/maintenance` (staff) with `{"date","start","end","reason"}` answers `201 {"block":{"id","station_id","date","start","end","reason"},"displaced_booking_ids":[…]}`.
  - `422` for each bad field (`end` must be after `start`; `reason` is 1–200 characters).
  - Also `409 {"error":"station_in_use"}`, and `409 slot_conflict` when it overlaps another maintenance block.
- `DELETE /api/maintenance/{block_id}` (staff) answers `204`.

**Bookings.** A booking object is `{"id","series_id","station_id","station_name","renter_id","status","date","start","end","starts_at","ends_at","buffer_minutes","buffer_ends_at","hour_weight","off_peak_percent","overage_usd_per_hour","minutes_debited","hold_expires_at","cancellation_cutoff_at","actual_start","actual_end","overage_units","overage_usd","created_at"}`.

- `POST /api/bookings` (renter) with `{"station_id","date","start","end","repeat_weeks"?}` answers `201 {"server_now","bookings":[booking]}`, one entry per week, all with status `hold`.
  - `422` keys: `station_id` (missing or unknown), `date`, `start`, `end`, `repeat_weeks`. `repeat_weeks` is 1–12 and defaults to 1.
  - A time that does not exist answers `422` with the message `That time does not exist on <date> in the kitchen's time zone.` under `start` or `end`.
  - Also:
    - `409 renter_not_active`
    - `409 {"error":"compliance_lapsed"}`
    - `409 {"error":"slot_conflict","date","legal_end":"HH:MM"|null,"blocked_by":"booking"|"buffer"|"maintenance","blocked_at":"HH:MM"}`
    - `409 insufficient_hours` (same body as adjustments)
- `GET /api/bookings?date=<date>&status=<status>` answers `200 {"server_now","bookings":[booking]}`: the renter's own bookings, or all bookings for staff. Both filters are optional. A hold past its `hold_expires_at` reports `expired` and never matches `status=hold`.
- `GET /api/bookings/{booking_id}` (owner or staff) answers `200 {"server_now","booking"}`.
- `POST /api/bookings/{booking_id}/confirm` (owner) answers `200 {"server_now","bookings":[…the series…]}`. Errors: `409 {"error":"hold_expired"}`, `409 invalid_transition`.
- `POST /api/bookings/{booking_id}/release` (owner) answers `200 {"server_now","bookings":[…]}`. Errors: `409 hold_expired`, `409 invalid_transition`.
- `POST /api/bookings/{booking_id}/cancel` (owner) answers `200 {"booking","outcome":"credited"|"forfeited","minutes"}`. Errors: `409 invalid_transition`.
- `POST /api/bookings/{booking_id}/check-in` (staff) with `{"actual_start"}` answers `200 {"booking"}`. Errors: `409 invalid_transition`, `422`.
- `POST /api/bookings/{booking_id}/check-out` (staff) with `{"actual_end"}` answers `200 {"booking"}`. Errors: `409 invalid_transition`, `422` (`actual_end` not after `actual_start`), `503 billing_unavailable`.
- `GET /api/usage-sheet?date=<date>` (staff; `date` defaults to today in kitchen time) answers `200 {"date","time_zone","server_now","rows":[{"booking_id","station_name","renter_business_name","start","end","actual_start","actual_end","status","overage_units","overage_usd"}]}`, ordered by start then station name. A malformed `date` answers `422`.

**Statements and shelf**
- `POST /api/renters/{renter_id}/statements` (owner or operator) with `{"month"}` answers `201 {"statement":{"id","renter_id","month","created_at"}}`. A malformed month, or one after the current kitchen month, answers `422`. Also `503 storage_unavailable`.
- `GET /api/renters/{renter_id}/statements` (owner or staff) answers `200 {"statements":[statement]}`.
- `GET /api/statements/{statement_id}/file` (owner or staff) answers `302` to a signed storage URL.
- `POST /api/renters/{renter_id}/shelf-subscription` (operator) with `{"shelf_label"}` (1–40 characters) answers `201 {"subscription"}` with `state` `active` and `billing_state` `ACTIVE`. Errors: `409 {"error":"already_subscribed"}`, `409 renter_not_active`, `422`, `503 billing_unavailable`.
- `DELETE /api/renters/{renter_id}/shelf-subscription` (operator) answers `200 {"subscription"}` with `state` `cancelled` and `billing_state` `CANCELLED`. Errors: `409 {"error":"not_subscribed"}`, `503 billing_unavailable`.

**Compliance links and notifications**
- `POST /api/compliance-links` (operator) with `{"label","expires_in_seconds"}` answers `201 {"link":{"id","label","token","url":"/share/<token>","expires_in_seconds","expires_at","revoked_at":null,"created_at"}}`. `label` is 1–80 characters, and `expires_in_seconds` is 30–2592000 inclusive; either failing answers `422`.
- `GET /api/compliance-links` (operator) answers `200 {"links":[link]}`.
- `POST /api/compliance-links/{link_id}/revoke` (operator) answers `200 {"link"}`. Errors: `409 {"error":"already_revoked"}`.
- `POST /api/compliance-links/{link_id}/regenerate` (operator) answers `200 {"link"}` with a new `token`, `url` and `expires_at`. Errors: `409 already_revoked`.
- `GET /api/share/{token}` (no session) answers `200 {"kitchen":{"name","address"},"renters":[{"business_name","documents":[{"id","kind","label","expires_on","file_url":"/api/share/<token>/documents/<document_id>"}]}]}`. `renters` may be empty. A dead or unknown token answers `404 not_found`.
- `GET /api/share/{token}/documents/{document_id}` answers `302` to a signed storage URL. A dead token, or a document not listed under that token, answers `404 not_found`.
- Every other method on any `/api/share/...` path answers `405 {"error":"read_only"}` whatever the token, and changes nothing.
- `GET /api/notifications` (operator) answers `200 {"notifications":[{"id","kind","to","subject","status":"queued"|"sent","attempts","created_at","sent_at"}]}`, newest first.

**Health.** `GET /api/health` (no session) answers `200 {"status":"ok"}`.

### Business rules (DP-04, DP-08, DP-09, DP-15, DP-16, DP-18, DP-19, DP-21, DP-23, DP-24, DP-26, DP-27, DP-28, DP-29, DP-31, DP-32, DP-33, DP-34, DP-35, DP-38, DP-47, DP-54)

**Kitchen time.**
- The kitchen's time zone is `America/Chicago`.
- Every date, `HH:MM`, off-peak slot, cancellation cutoff, compliance validity, statement month, "today" default and usage sheet day is computed in kitchen time on the server's clock.
- The browser's clock and zone and the server process's zone never affect any result.
- Screens show times in kitchen time with the zone abbreviation.

**Hour price.** This is the price every booking debits.
- A booking is priced over its real elapsed 15-minute slots.
- A slot is off-peak when its kitchen-local wall-clock start is at or after 22:00 or before 06:00. Both occurrences of the repeated autumn 01:00 hour are off-peak slots, and the skipped spring hour has no slots.
- A peak slot costs 15 × `hour_weight` minutes. An off-peak slot costs 15 × `hour_weight` × `off_peak_percent` ÷ 100 minutes.
- `minutes_debited` is the sum over the booking's slots, rounded up once to a whole minute.
- A series costs the sum of its weeks' rounded `minutes_debited`, with each week priced by its own real slots.
- Placing a hold debits the price at once, so `held_minutes` rises and `balance_minutes` falls.
- A request whose total price (all weeks of a series) exceeds `balance_minutes` answers `insufficient_hours`.
- The board's draft price is computed by the same definition the server uses, so the browser never shows a figure the server would not charge.

For example, with the seed data at start:

| Booking | Price |
|---|---|
| Convection oven 1, 21:00–23:00 | 90 minutes (`1.50 h`) |
| Convection oven 1, 21:45–22:15 | 22.5, rounded up to 23 minutes (`0.38 h`) |
| Deck oven, 05:00–07:00 | 60 + 120 = 180 minutes (`3.00 h`) |
| Convection oven 1, 00:00–04:00 on the autumn-change day | 20 slots × 7.5 = 150 minutes, for 300 elapsed minutes |
| 60-quart mixer, same range | 300 minutes |
| Deck oven, 10:00–12:00, swept by Hearth & Hustle Bakery | ticket `4.00 h`, docket balance `16.00 h` |

**Derived display values.**
- `<hours>` is minutes ÷ 60, rounded half up to two decimals and shown with two decimals. For example, 150 minutes shows as `2.50`.
- The renter balance is `balance_minutes`, and the pending debit is `held_minutes`.
- Every hours figure that describes a booking is its price under Hour price, never elapsed time:
  - The ticket's `<hours> h` and the sweep announcer's `<hours> hours` show the price. For a draft, that is the price the hold would debit. For a repeat, it is the series total.
  - The hold, release, cancel, cancel-dialog and displacement copy show the same price.
- **Docket balance:**
  - With no draft, it shows `balance_minutes` ÷ 60.
  - While a draft is being swept, extended or repriced, or its hold request is pending, it shows the projected balance, (`balance_minutes` − the draft's price) ÷ 60.
  - Once the hold is accepted, the server has already debited the price, so the docket shows `balance_minutes` ÷ 60 again.
- Only the `your balance covers <hours> hours` stop reason uses `balance_minutes` ÷ 60 as it stands before the draft.
- `Pending −<hours> h` shows `held_minutes` ÷ 60.
- `You need <needed> hours and have <balance>` shows `needed_minutes` ÷ 60 and `balance_minutes` ÷ 60.

**Station occupancy.**
- A hold or a confirmed, checked-in or completed booking occupies its station from its start to its end plus its own `buffer_minutes`.
- A maintenance block occupies its start to its end, with no buffer.
- Occupied ranges on one station never overlap. Ranges that only touch end-to-start are allowed.
- Expired, cancelled and displaced bookings occupy nothing.
- A booking:
  - is 15 minutes to six hours long, with six hours allowed
  - starts after the current instant
  - lies within one kitchen day (end at most `24:00`)
  - has a date no more than 366 days after today
- A booking's buffer may run into the next day.
- The sanitation buffer is never charged.

**Conflict answer.** When a requested range collides, the app answers `slot_conflict`:
- `blocked_at` is the kitchen-local start of the first colliding range.
- `blocked_by` is:
  - `booking` when the requested range meets another booking's own time
  - `buffer` when it meets only another booking's buffer
  - `maintenance` for a maintenance block
- `legal_end` is the latest 15-minute end after the requested start whose occupied range collides with nothing, or `null` when no such end exists.
- For a series, these describe the first colliding week, and `date` names it.

**One winner.** When any number of renters claim overlapping ranges on one station at the same moment, exactly one claim succeeds and every other one answers `slot_conflict` computed against the winner. The database guarantees this rule, not a check in application code.

**Booking states:**

| From | To | How |
|---|---|---|
| (new) | `hold` | creating a booking |
| `hold` | `confirmed` | confirm, before expiry |
| `hold` | `expired` | expiry or release |
| `hold` or `confirmed` | `displaced` | a maintenance block |
| `confirmed` | `cancelled` | cancel |
| `confirmed` | `checked_in` | check-in |
| `checked_in` | `completed` | check-out |

- Confirming or releasing a hold whose `hold_expires_at` has passed answers `hold_expired`, whether or not the expiry has been recorded yet.
- Any other request answers `invalid_transition`. For example: cancelling a hold, confirming a confirmed booking, checking in a hold, checking out twice, or acting on a released, cancelled, displaced or completed booking.

**Who may book, buy hours and rent a shelf.**
- **Booking** is checked in two steps, status first:
  1. A renter whose status is `applied`, `documents_review` or `offboarded` gets `renter_not_active`, whatever their documents.
  2. Otherwise, a renter whose status is `suspended`, or whose COI or food-handler card is not current, gets `compliance_lapsed`. A COI or card that has never been approved counts as not current.
- **Pack purchases:** `active` and `suspended` renters may buy. `applied`, `documents_review` and `offboarded` renters get `renter_not_active`. Document compliance does not affect purchases.
- **Shelf subscriptions:** only an `active` renter can start one, and any other status gets `renter_not_active`. Ending an existing subscription works in any status.

**Holds and expiry.**
- `hold_expires_at` is the creation instant plus `HOLD_TTL_SECONDS` (default 600, which is 10 minutes).
- A hold is live while the server's clock is strictly before `hold_expires_at`.
- At that instant and after:
  - confirm and release answer `hold_expired`
  - every read reports the booking as `expired`
  - its time is free
- Within 5 seconds after the instant, the server records the expiry, returns the hours and queues one hold-expired email. A page does not need to be open.
- A series shares one hold instant and expires, confirms or releases as a whole.

**Cancellation.**
- `cancellation_cutoff_at` is the booking's start wall-clock time two calendar days before its date, in kitchen time. For example, a Saturday 06:00 booking's cutoff is Thursday 06:00 kitchen time, even when a daylight-saving change falls between them.
- Cancelling strictly before the cutoff credits all `minutes_debited` back (`outcome` `credited`).
- Cancelling at or after the cutoff forfeits them (`outcome` `forfeited`).
- Each week of a series is cancelled on its own.

**Recurring and daylight saving.**
- `repeat_weeks` 2–12 creates that many bookings on the same weekday, same station and same kitchen wall-clock start and end, all held together. If any week collides, lacks hours or is invalid, nothing is created.
- Wall-clock times stay fixed across daylight-saving changes. A weekly 05:00 Tuesday booking starts at 05:00 local in both summer and winter time.
- A start or end inside the skipped spring-forward hour (02:00 up to but not including 03:00 on that Sunday) does not exist and is rejected.
- A time inside the repeated autumn hour (01:00 up to but not including 02:00) means its first occurrence, in daylight time.
- Duration and price always use real elapsed slots. For example, 00:00–04:00 on the autumn change day is 300 elapsed minutes.

**Check-in, check-out and overage.**
- Check-in records `actual_start` on the booking's date.
- Check-out records `actual_end`, moves all held minutes of the booking to consumed, and computes overage once, from elapsed time:
  - `overage_units` is the minutes by which `actual_end` passes the booked end, rounded up to whole 15-minute units. It is 0 when the renter ends on time or early.
  - `overage_usd` is `overage_units` × the booking's own `overage_usd_per_hour` ÷ 4, rounded half up to cents.
- Ending early returns no hours.
- When `overage_units` is above zero, the Kill Bill charge in Services must be accepted before check-out is recorded. If it is not, nothing changes and `billing_unavailable` is returned. A zero-overage check-out never contacts billing.
- The usage sheet lists bookings with status `confirmed`, `checked_in` or `completed` whose kitchen-local date is the requested day.

**Effective-dated station settings.**
- Each booking stores the `hour_weight`, `off_peak_percent`, `overage_usd_per_hour` and `buffer_minutes` in force when it was created. Those come from the station's settings row with the latest `effective_from` on or before the kitchen date at creation.
- A later settings row never changes existing bookings, their price, their buffers or their overage.
- Saving a second row with the same `effective_from` replaces that row.

**Maintenance.**
- A block that overlaps a `checked_in` booking's occupied range answers `station_in_use`, and nothing changes.
- Otherwise every `hold` and `confirmed` booking whose occupied range overlaps the block, for any renter, becomes `displaced`. Each gets its full `minutes_debited` credited back and one displacement email.
- Deleting a block frees the time but does not restore displaced bookings.

**Hour ledger.**
- Every change to a renter's hours is one movement made of exactly two entries: a debit and a credit of the same positive `minutes` on two different accounts.
- Accounts are `renter:<renter id>:available`, `renter:<renter id>:held`, `kitchen:opening`, `kitchen:sold`, `kitchen:consumed`, `kitchen:forfeited` and `kitchen:adjustments`.
- Movements (debit → credit):

  | Movement | Debit | Credit |
  |---|---|---|
  | `opening_balance` | `kitchen:opening` | available |
  | `pack_purchase` | `kitchen:sold` | available |
  | `booking_hold` | available | held |
  | `hold_release` (expiry or release) | held | available |
  | `cancellation_credit` | held | available |
  | `displacement_credit` | held | available |
  | `checkout` | held | `kitchen:consumed` |
  | `cancellation_forfeit` | held | `kitchen:forfeited` |
  | `adjustment` (positive) | `kitchen:adjustments` | available |
  | `adjustment` (negative) | available | `kitchen:adjustments` |

- `balance_minutes` is always the credits minus the debits on the renter's available account, and `held_minutes` is the same on the held account. No balance is stored separately.
- Entries are never edited or deleted. A correction is a new adjustment movement.
- No movement may take an available balance below zero; one that would answers `insufficient_hours`.

**Purchases.**
- **Idempotency.** An `Idempotency-Key` belongs to the renter who sent it.
  - Repeating a completed purchase with the same key and the same body returns the stored status and body exactly, including the original `balance_minutes`. No new payment, ledger entry or email is made.
  - The same key with a different body answers `idempotency_conflict`.
  - A request that arrives while the first with its key is still in progress waits for it and then returns its stored response.
  - A purchase that ended in `payment_failed` or `billing_unavailable` stores nothing, so the same key can be retried later.
- **All or nothing.**
  1. The Kill Bill payment is recorded first, using a payment key derived from the renter and the idempotency key, so a retry finds the existing payment instead of charging again.
  2. Then the purchase, the paired `pack_purchase` movement and the queued receipt are saved together.
  - If billing refuses or is unreachable, no hours, purchase record or receipt exist.
  - If the save fails after billing accepted, the app refunds that Kill Bill payment before answering.

**Renter states.**
- `applied` → `documents_review` happens automatically when the renter has at least one uploaded document of each of the three kinds.
- `documents_review` → `active` is done by the operator. It requires an approved business licence plus an approved COI and food-handler card that are both current; otherwise it answers `documents_incomplete`.
- `active` → `suspended` happens automatically, by the compliance scan.
- `suspended` → `active` happens automatically when an approval leaves the COI and food-handler card current. The operator can also do it by transition, under the same requirement.
- Any non-offboarded status → `offboarded` is done by the operator. It answers `has_future_bookings` while the renter has a hold or confirmed booking starting in the future.
- Every other requested transition answers `invalid_transition`, including any transition to `applied`, `documents_review` or `suspended`, and any transition from `offboarded`.

**Document states.**
- A document's stored `status` is one of `pending_review`, `approved` or `rejected`; there is no stored expired status. The on-screen word `Expired` is derived as stated under Document status words in Public screens and controls.
- `pending_review` → `approved` or `rejected`, by the operator.
- Approving a document whose `expires_on` is before today answers `document_expired`.
- An approved document is current while today is on or before its `expires_on`. A licence without a date is always current.
- "Latest" means most recently uploaded. The latest approved document of a kind is the one that counts for compliance. A kind with no approved document has nothing current.

**Compliance validity and the scan.**
- A COI or food-handler card is valid through the end of its `expires_on` date in kitchen time. From the next kitchen midnight, new bookings are refused with `compliance_lapsed`. Existing bookings are kept.
- The compliance scan runs at start-up and every `COMPLIANCE_SCAN_SECONDS` (default 60). It:
  - queues one expiring notice per document when the latest approved COI or food-handler card has `expires_on` within 14 days from today, today and day 14 included
  - queues one expired notice per document when that document is no longer current
  - moves an `active` renter whose COI or card is not current to `suspended`
- `compliance.state` is decided in this order, and the first that applies wins:
  1. `incomplete` when the COI or card has never been approved
  2. `lapsed` when the latest approved COI or card is not current
  3. `expiring` when either expires within the 14 days
  4. `current` otherwise
- The docket compliance line renders only this state and these dates, as described in Public screens and controls.

**Compliance links.**
- A link is live while it is not revoked and the server's clock is strictly before `expires_at`, which is creation plus `expires_in_seconds`.
- Revoking kills it at once.
- Regenerating issues a new token with `expires_at` equal to now plus the link's original `expires_in_seconds`, and the old token dies at once.
- Tokens are at least 32 random URL-safe characters.
- A live link shows every `active` or `suspended` renter that has at least one current approved document. For each renter it shows only the latest current approved document of each kind.
- A link never shows rejected, pending, superseded or expired documents, renter status, contact names, emails, phone numbers, balances, ledger, bookings or purchases.
- A link can only read.

**Shelf subscription state.**
- **Starting.** The app reports a subscription as `active` only after Kill Bill returns the created subscription.
- **Ending.** It reports `cancelled` only after Kill Bill returns the cancelled subscription.
- **Reading.** Each `GET /api/renters/{renter_id}` reads the renter's current subscription from Kill Bill with a two-second timeout and sets `billing_state` from Kill Bill's answer.
  - If Kill Bill reports it `CANCELLED`, including a cancellation made directly in Kill Bill, the app records the subscription as ended. That read and every later one returns `shelf_subscription: null`, and a new start is allowed.
  - If Kill Bill is unreachable, the stored subscription is returned with `billing_state` `unknown` and nothing changes.
- `already_subscribed` is judged on the renter's subscription after this reconciliation, or on the stored one when Kill Bill is unreachable.

**Statements.**
- A statement covers one kitchen month.
- It contains the business name, the month, the kitchen time zone, every movement on the renter's available account that month (kitchen date and time, kind, signed hours), and the opening and closing balance.
- A new statement for the same month is a new file; earlier ones stay.

### Services (DP-06, DP-08, DP-17, DP-26, DP-29, DP-30, DP-32, DP-37, DP-38, DP-39)

**Kill Bill.**
- **Account.** Each renter has one account with:
  - external key `renter-<renter id>`
  - the business name
  - the renter's email
  - currency `USD`
  - a default external payment method (`__EXTERNAL_PAYMENT__`)

  The app creates it the first time billing is needed for that renter.
- **Pack purchase.** A payment transaction of type `PURCHASE` on that account, for the pack's amount in `USD`, with payment external key `purchase-<renter id>-<idempotency key>`.
- **Overage.** An external charge on that account for `overage_usd` in `USD`, with description `Overage: <station name> <date>, <units> × 15 min`.
- **Shelf subscription.**
  - A subscription on that account to plan `walk-in-shelf-monthly`, with external key `shelf-<renter id>-<n>`. `<n>` counts that renter's shelf subscriptions from 1, so the second one ever started is `shelf-<renter id>-2`.
  - Ending it cancels the subscription with immediate effect.
  - When the tenant has no catalog with that plan, the app uploads one: product `WalkInShelf`, one monthly evergreen phase at `45.00` USD billed in advance, no trial.

**Mailpit.**
- All mail goes by SMTP from the `MAIL_FROM` address (`Railside by Brigade & Bench <bookings@railside.example>`) to the renter's email.
- Every email is a notification written in the same database transaction as the action that causes it.
- A sender delivers it and marks it `sent` once SMTP accepts it. While mail is unreachable, it retries every `OUTBOX_RETRY_SECONDS` (default 30), counting `attempts`.
- Each notification is delivered once.
- Subjects and bodies, with `<date>` as `YYYY-MM-DD`:
  - `receipt`: `Receipt for your <pack name>`. The body has the amount, hours, Kill Bill payment id and new balance.
  - `booking_confirmed`: `Booking confirmed: <station name> on <date>`. One email per confirmation, listing every week of a series. The body gives each date with `<start>–<end> <zone abbreviation>` and `Sanitation buffer: <buffer minutes> minutes, until <HH:MM>`.
  - `hold_expired`: `Your hold on <station name> has expired`.
  - `booking_displaced`: `Booking displaced: <station name> on <date>`. One per displaced booking. The body has the block reason and `<hours> hours returned to your balance`.
  - `document_expiring`: `Your <label> expires on <date>`.
  - `document_expired`: `Your <label> has expired`.
- `<label>` is `certificate of insurance` or `food-handler card`.

**MinIO.**
- All objects go in the private bucket `S3_BUCKET`.
- Object keys:
  - documents: `renters/<renter id>/documents/<document id>.<pdf|png|jpg>`
  - statements: `renters/<renter id>/statements/<YYYY-MM>-<statement id>.pdf`
- Each object's content type matches its detected type.
- Files are reached only through a `302` to a signed GET URL that expires 60 seconds after it is issued. The app issues one only after the ownership check or a live compliance-link check.
- The bucket never gets a public policy, and no file is ever streamed from a guessable public path.

**Down behaviour.**
- **Kill Bill unreachable:**
  - purchases, starting or ending a shelf subscription, and overage check-outs answer `billing_unavailable`
  - `purchases_available` is false
  - renter reads report `billing_state` `unknown`
  - bookings, holds, confirms, cancellations, zero-overage check-outs and everything else work normally
- **Mailpit unreachable:** every action succeeds, and its notifications stay `queued` until delivered.
- **MinIO unreachable:** uploads, statements and file links answer `storage_unavailable`.
- Copy for each case is in Feedback states.

### Seed data (DP-02, DP-06, DP-12, DP-28, DP-31, DP-32, DP-47)

Every person, business, email address and street address below is invented.

- Load the seed once, when the app finds an empty database at serve time.
- `D` means the kitchen-local date on the day the seed is loaded.
- Every seeded user's password is `Railside-demo-26`.

Kitchen: `Brigade & Bench Commissary`, `1187 West Larkin Avenue, Chicago, IL 60622`, time zone `America/Chicago`.

| Role | Name | Email | Business | Status | Opening balance | COI expires | Card expires | Licence expires |
|---|---|---|---|---|---|---|---|---|
| operator | Marisol Teague | marisol@brigadebench.example | — | — | — | — | — | — |
| shift_lead | Dev Okafor | dev@brigadebench.example | — | — | — | — | — | — |
| renter | Wren Abernathy | wren@hearthhustle.example | Hearth & Hustle Bakery | active | 1200 minutes | D+200 | D+300 | D+365 |
| renter | Paz Ochoa | paz@lomaverde.example | Loma Verde Tamales | active | 480 minutes | D+10 | D+300 | D+365 |
| renter | Jory Kessler | jory@smokesignal.example | Smoke Signal BBQ | active | 360 minutes | D | D+300 | D+365 |
| renter | Ines Marchetti | ines@fennelstreet.example | Fennel Street Catering | active | 240 minutes | D−1 | D+300 | D+365 |
| renter | Theo Banerjee | theo@littlecrumb.example | Little Crumb Granola | documents_review | 0 minutes | D+180 | D+180 | D+365 |

- Each seeded renter has exactly one document of each kind.
- The four active renters' documents are `approved`. Little Crumb Granola's three documents are `pending_review`.
- Each seeded document has a small one-page PDF that the app writes to its document key when seeding.
- Non-zero opening balances are `opening_balance` movements. Little Crumb Granola has no movement at all.
- No bookings, purchases, statements, compliance links, maintenance blocks or shelf subscriptions exist at start.
- For example, with the seed data at start:
  - the first compliance scan suspends Fennel Street Catering and emails Ines an expired notice, and emails Paz and Jory expiring notices
  - Paz's compliance line reads `Compliance: expires <D+10>`, and Jory's reads `Compliance: expires <D>`

Stations (settings effective from 2026-01-01):

| id | name | hour_weight | off_peak_percent | overage_usd_per_hour | buffer_minutes |
|---|---|---|---|---|---|
| `convection-1` | Convection oven 1 | 1 | 50 | 48.00 | 30 |
| `convection-2` | Convection oven 2 | 1 | 50 | 48.00 | 30 |
| `deck-oven` | Deck oven | 2 | 50 | 72.00 | 45 |
| `mixer-60` | 60-quart mixer | 1 | 100 | 30.00 | 15 |
| `prep-3` | Prep table 3 | 1 | 100 | 24.00 | 15 |

Packs:

| id | name | hours | amount_usd |
|---|---|---|---|
| `pack-10` | 10-hour pack | 10 | 290.00 |
| `pack-20` | 20-hour pack | 20 | 540.00 |
| `pack-40` | 40-hour pack | 40 | 1000.00 |

Walk-in shelf plan: `walk-in-shelf-monthly`, 45.00 USD per month.

## Technical requirements

### Deployment (DP-40)

Node.js 22 with npm is available. The app is TypeScript. `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- `serve` binds `0.0.0.0` on the port in `APP_PUBLIC_PORT` (default 4173).
- `serve` applies the database schema and the seed idempotently every time it starts, and nothing it depends on is created at build time.
- The grader may start several copies at once on neighbouring ports, each with its own environment. Some copies have their own empty database and bucket, so each copy must start cleanly from its own environment.
- `GET /api/health` answers HTTP 200 `{"status":"ok"}` once the server accepts requests.

### Configuration and secrets (DP-46)

Read at start, from the environment only:
- `DATABASE_URL`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`; also `MAILPIT_URL`, the Mailpit web and API address, for your own inspection only (the app sends mail over SMTP and must not use it)
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `APP_PUBLIC_PORT`
- `HOLD_TTL_SECONDS` (default 600), `COMPLIANCE_SCAN_SECONDS` (default 60), `OUTBOX_RETRY_SECONDS` (default 30)

No credential, service URL or service hostname appears in source, in the built browser assets, or in any response. Sessions are stored in Postgres.

### Server boundary (DP-03, DP-10, DP-11, DP-39, DP-40, DP-41)

**Same origin.**
- The app serves its pages and API from one origin and sends no CORS headers.
- A state-changing request (`POST`, `PUT`, `PATCH` or `DELETE`) whose `Origin` header is present and differs from the app's own origin answers `403 {"error":"cross_origin"}`, at its step in the API error precedence.

**Body limits.**
- JSON bodies are limited to 65,536 bytes (65,536 allowed).
- Multipart uploads are limited to 5,100,000 bytes in total.
- The `file` part is limited to 5,000,000 bytes: 5,000,000 is allowed, and 5,000,001 is rejected with `file_too_large`.
- Other oversized bodies answer `payload_too_large`.

**Uploads.**
- The file's type is judged by its first bytes, never by its name or the declared content type.
- Only PDF (`%PDF-`), PNG and JPEG are accepted. Everything else answers `unsupported_type`, including SVG with or without script, HTML, archives, and files whose name claims `.pdf` but whose content is not.
- An empty file is rejected.
- The stored object key is always generated as in Services. The uploaded name never forms part of it.
- `original_name` is kept only as display text. Directory parts (anything up to the last `/` or `\`), `..` sequences and control characters are stripped, and it is cut to 120 characters.

**Never served.** These paths answer `404`:
- source files
- the TypeScript config
- `package.json`
- the lockfile
- `run.json`
- any `.env` file
- source maps of server code
- anything outside the built browser assets

**Dependencies at boot and recovery.**
- Kill Bill, Mailpit or MinIO being unreachable at boot never stops the app or its health check.
- Every call to them is attempted fresh with a timeout of at most five seconds, or the shorter timeout an endpoint states. A service that comes back is used on the next request with no restart.
- No connection failure and no availability answer is cached.
- Postgres is required. Until it answers, serve retries every two seconds.

### Browser support and performance (DP-12, DP-13, DP-42)

The app must work in current Chromium, Firefox and Safari at any width from 360 pixels up, using the seed data. The published check sizes are 375x812, 768x1024 and 1280x800, plus the band edges 767, 768, 1199 and 1200 pixels wide.

- The board is usable within three seconds of navigation on the local network.
- Each sweep step, and each repeat-count change on a draft, shows on screen within a tenth of a second of the event.
- API calls answer within one second, except purchases, shelf changes and overage check-outs (bound by Kill Bill's timeout) and the reads that state a three-second limit.

The browser loads every script, stylesheet, font and icon from the app's own origin.

## Working rules

- IF-01: `/app/run.json` exists and contains exactly the keys `_schema`, `install`, `build` and `serve`, all strings, with `_schema` equal to `run-manifest-v1`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its version and licence, plus each bundled font and icon set. Shipped packages are the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (as defined in IF-02), font and icon set is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: App state lives only in the provided Postgres database, Kill Bill tenant and MinIO bucket. The app uses no other database, cache server, embedded datastore or state files on disk.
- IF-05: The provided service configuration (compose files and dev environment values) is left unchanged.
- IF-06: Source is TypeScript with `"strict": true` in the TypeScript config.
- IF-07: `package-lock.json` is committed and the `install` command installs from it.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript with no `any` escapes on domain data and no suppressed type errors.
- Names in code match this brief's domain terms: renter, station, hold, booking, buffer, off-peak, hour pack, ledger movement, compliance link, shelf subscription, overage, usage sheet.
- Each domain rule is decided in exactly one place in the source. This covers each state transition, the occupancy and conflict computation, the cancellation cutoff, the overage calculation, document validity, compliance state and the ledger balance.
- The hour price is defined once, and that same definition prices both the board's draft in the browser and the booking on the server.
- Time-dependent state on screen (today, compliance, document status words, countdown, now-line, cancel outcome) is rendered from server values, and no browser code derives it from the device clock or zone.
- No abstraction has only one implementation, and there are no features, endpoints or settings beyond this brief.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules above make impossible.
- Every API error is produced through one shared error shape and the single precedence order in API, and SQL is parameterised with every multi-step change that must happen together in one database transaction.
