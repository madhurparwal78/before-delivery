# Tallybell Nightroll

Nightroll is a front desk and property management system for owner-operated independent inns and small hotels of 10 to 20 rooms: one account where the room timeline, the folios, the housekeeper's phone and the day's close agree to the cent. It uses Postgres for all hotel data, Gotenberg to render invoice PDFs, MinIO to store invoice PDFs and ID photos in a private bucket, and Mailpit to receive check-in links and invoice emails. Each account belongs to one hotel, with the roles owner, front desk and housekeeper; the arriving guest has no account. Sign-in is email and password only. Payments are recorded by hand as cash or a card terminal reference, with no payment provider. Out of scope: channel managers and online travel agencies, a public booking engine, restaurant point of sale, door locks and kiosks, AI pricing, guest messaging, an app marketplace, outside sign-in, paid plans and any other datastore or message broker.

## Problem and users

The owner of a small independent inn often works the desk, does the books and covers the late shift, running the house from booking-platform calendars, a spreadsheet and a paper log. A close done by hand misses or repeats room charges. A company that pays only part of a bill means retyped invoices. A guest can be walked to a room the housekeeper finished but nobody was told about, or to one that was never cleaned. Low-cost systems handle the calendar but are weak on folio splits, tax edge cases and a close the owner can trust.

- **Owner:** runs the timeline, settles folios, runs the end-of-day close, sets rates and reads occupancy, average daily rate and revenue per available room. Daily.
- **Front desk:** creates and changes stays, checks guests in and out, moves rooms, cancels stays and works folios. Daily.
- **Housekeeper:** works the room board on a phone and changes each room's status, seeing only room, dates and status. Daily.
- **Arriving guest:** completes online check-in from an emailed link and uploads an ID photo before arrival. Occasional.

## Journeys

1. **Booking at the desk.** A front desk clerk starts on the timeline with a free room. Using only the keyboard, they press `N`, fill in `New stay`, read the nightly breakdown and press `Create stay`. The new block sits on the timeline, the free-room count drops, the guest receives a check-in email, and focus is back where the clerk started.
2. **Moving a guest.** A clerk starts with a booked stay on the timeline. They press `M`, use the arrows to place it and press Enter, or drop it onto an occupied room and see it return with the refusal. Later, for an in-house guest, they move the stay from a chosen night. Earlier nights stay on the old room, posted charges stay on the folio, and a colleague's screen follows along live.
3. **A dirty room meets an early arrival.** A clerk tries to check a guest into a dirty room and is refused. A housekeeper on a phone taps the room clean. The desk sees and hears the change without reloading, and the clerk presses `I` to check the guest in.
4. **The guest checks in from a phone.** A booked guest opens the emailed link, sees only their dates, room type and the form, uploads an ID photo, sees `Received` and completes the form. The desk sees the stay gain `Checked in online`, and the link is dead from then on.
5. **Cancelling near the deadline.** A clerk opens a booked stay and reads the free or late state the server publishes from the hotel's clock, even when the device clock is hours off. They cancel. Any fee is posted to the folio, the room is free and the guest's link is dead.
6. **Settling a split bill.** A clerk splits a room charge between the guest and a company by keyboard, reverses a mistaken charge and records payments. Closing each folio at a zero balance issues a numbered invoice as a PDF. Emailing it marks the folio `Sent`. If the PDF service is down, nothing is saved and the same action succeeds later.
7. **The end-of-day close.** The owner presses `Run close` once the business day has ended. After the server commits, Night Close Sweep plays, the tally rail shows the day's figures and the desk stands on the next date. If a blocker exists, nothing posts and focus lands on the blocked row. Pressing it again posts nothing.
8. **Reading the numbers and tidying guest records.** The owner reads the reports under reduced motion while a clerk changes a stay in another browser, and the figures update live. The clerk merges two profiles of the same guest, choosing between conflicting fields, and the merged profile no longer opens.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Create a stay by keyboard.** With `N` pressed from any control in `Reservation timeline`, the clerk tabs through `New stay` with focus wrapping inside it, presses Enter on `Create stay`, hears the result in `Desk notices`, sees the new block on the timeline and gets focus back on the opener.
- **DP-02 — Exact nightly pricing.** Every night of a stay is priced in whole cents by the published steps and one half-up rounding, matching each worked example in Business rules in the quote, the `Nightly breakdown` table, `Stay total` and every posted line.
- **DP-03 — Tax rates from a stated date.** The owner enters a new percentage with a start date after the business date, after which each night shows the rate in force on that night and earlier nights keep the old rate on the folio, invoice and reports.
- **DP-04 — One stay per create.** A double press of `Create stay` and a replay of the same `Idempotency-Key` yield one stay, one folio and one check-in email, and the same key with a different body is refused as published in Business rules.
- **DP-05 — Stay nights and overlaps.** A stay holds arrival up to but not including departure, so a same-day turnover fits one room, and the server refuses any overlap on create and on extend.
- **DP-06 — New stay field errors.** Invalid `New stay` input is refused with the published field messages and shows `Form errors` whose links move focus to each field, with nothing saved.
- **DP-07 — Keyboard room move.** With `M` pressed from any control in `Reservation timeline` the clerk picks up the current stay, places it with the arrow keys, hears each placement, drops it with Enter and hears the published move notice in `Desk notices`, and a drop that shifts a booked stay's dates keeps its length and reprices as published in Business rules.
- **DP-08 — Cancel a pick-up.** Escape during a pick-up returns the block to its old place with nothing sent to the server and announces the published cancelled notice in `Desk notices`.
- **DP-09 — Refused drop on an occupied room.** A move onto an occupied night is refused by the server with the published text in `Desk notices`, the block returns to its old place, and the message survives every repaint and live update that follows.
- **DP-10 — Stay panel keeps the newest state.** Reopening `Stay` during its closing motion leaves it open after the clock advances, and acting again during a pending stay or folio request keeps the newest state and the last message shown.
- **DP-11 — Published timeline attributes.** `Reservation timeline` carries the published row, column, cell and block attributes and the `Free rooms` region, and these reflect server state after every change and reload.
- **DP-12 — Last room goes to one clerk.** Of two simultaneous requests for one room's last free nights exactly one creates a stay and the other is refused with the published text, leaving one stay, one folio and one check-in email.
- **DP-13 — Two clerks, one notice.** Two front desk browsers take the last room or move one stay at once, the winner sees success, and the loser sees the published conflict notice in `Desk notices` with the screen showing the latest state.
- **DP-14 — Free room count stays live.** `Free rooms` shows the business date's free rooms and changes on every signed-in staff screen within the published live delay after a stay or room change.
- **DP-15 — Check-in guarded by room status.** Check-in succeeds only for a booked stay arriving on the business date in a clean or inspected room, and any other attempt gets its published refusal with the stay unchanged.
- **DP-16 — Housekeeper changes reach the desk live.** A housekeeper's tap on a phone changes the room chip on a desk browser without reload, and the desk hears the published notice in `Desk notices` within the published live delay.
- **DP-17 — Check-in and check-out by shortcut.** `I` and `O` check the current stay in and out from any control in `Reservation timeline`, a check-in before 04:00 belongs to the previous night, and checking out makes the room dirty.
- **DP-18 — Room board by touch on a phone.** At 375x812 a signed-in housekeeper lands on `Room board` with `Today's stays`, changes a room by tap with targets at least 44 px and hears the result in `Board status`.
- **DP-19 — Room status moves.** Every status move and role in the published table is allowed or refused exactly as listed, with the published refusal text for every other move.
- **DP-20 — Housekeeper sees room, dates and status only.** No page, API response or push message open to a housekeeper carries any guest's name, email, phone, ID or balance, and every stay, folio and guest route answers them as not found.
- **DP-21 — Check-in link by email.** Creating a stay delivers a message to the guest in Mailpit with the published subject and a working link, and resending issues a new link that kills the old one.
- **DP-22 — Check-in link scope and end.** The link opens only that stay's published fields and form and answers not found with the published page text at the exact end of its lifetime, on completion, on cancellation and whenever the stay stops being booked.
- **DP-23 — ID photo limits by content.** The photo upload accepts only JPEG or PNG judged by file content, allows exactly the published byte limit, and refuses anything larger or of another type with the published statuses and text.
- **DP-24 — Stored photo without EXIF, then Received.** The guest sees `Received` only after MinIO confirms the object at the published key, and the stored image decodes with its EXIF data gone.
- **DP-25 — Desk sees online check-in live.** When a guest completes the form on a phone, a signed-in desk browser shows `Checked in online` on that stay and hears the published notice in `Desk notices` without reload.
- **DP-26 — When the close opens.** The close is refused until 04:00:00 hotel time on the date after the business date and opens at that instant, at each worked edge in Business rules including both daylight-saving dates, whatever the browser's zone.
- **DP-27 — Close posts all or nothing.** A successful close posts no-show fees, then each in-house stay's room charge, tax and city tax in room-number order, fixes the day's figures and advances the date once, and any failure leaves nothing changed.
- **DP-28 — Close blockers stop everything.** A blocked close posts nothing, returns every blocker, and the screen stops on the first blocked row with focus moved there and the published reason in `Close status`.
- **DP-29 — Close twice posts once.** A double press of `Run close` sends one request, and a replay naming an already-closed date is refused with the published text and leaves every folio unchanged.
- **DP-30 — No-shows at the close.** A booked stay arriving on the closing date and not checked in becomes `no_show`, pays the published fee as one charge entry, loses its link and frees its nights.
- **DP-31 — Night Close Sweep.** After the server commits and never before, the desk passes through the published phases, with row stamps in room-number order, tally figures counting to the committed values and the grid moving one night, all finished within the published time, and a reload at any moment shows the same committed amounts.
- **DP-32 — Second staff screen follows the close.** A front desk browser open during the owner's close moves to the new business date with the same posted amounts and hears the published result in `Close status` within the published live delay.
- **DP-33 — Cancellation fee edges.** The fee is zero at one second before the published deadline and the first night's total at the deadline and after, posted as one charge entry, at each worked edge in Business rules.
- **DP-34 — Free or late comes from the server.** With the browser clock set hours away from the hotel's clock, `Cancellation terms` shows exactly the state the API returns.
- **DP-35 — Cancel a stay from the panel.** The clerk opens `Cancel stay` from `Stay` by keyboard, reads the fee, confirms and hears the published notice, after which the block shows `cancelled`, the room is free and the guest's link is dead.
- **DP-36 — Exact folio splits.** Splitting one charge by percent gives each folio its share rounded down with remainder cents placed by the published rule, the shares add up exactly to the charge, and each worked example in Business rules holds.
- **DP-37 — Split a folio by keyboard.** Using only the keyboard the clerk opens `Split charge`, enters percentages, reads `Split preview`, applies it with focus held inside the dialog and returned to the opener, and hears the result in `Folio status`.
- **DP-38 — Payments, reversals and balances.** Balance is charges less payments, a correction is a reversal entry referencing the original, and no entry is ever edited or deleted.
- **DP-39 — Move entries between folios.** Moving an entry changes only the folio it sits on and keeps the stay's total across folios exact.
- **DP-40 — Folio closes only at zero.** Closing a folio with a balance or without entries is refused with the published text and leaves it open.
- **DP-41 — Gapless invoices with published PDF lines.** Closing a folio issues the hotel's next number in one per-hotel series, and the stored PDF carries each published text line with amounts equal to the folio's.
- **DP-42 — Email invoice marks Sent after acceptance.** `Email invoice` delivers a message to the payer in Mailpit with the published subject and the PDF attached, and `Sent` appears only after the mail provider accepts it.
- **DP-43 — PDF service outage and recovery.** With Gotenberg unreachable, closing a folio shows the published text and status, consumes no number and leaves the folio open, and the same action succeeds with the next number once the service is reachable, with no restart.
- **DP-44 — File store outage and recovery.** With MinIO unreachable, invoice storage and photo upload show their published text and status with nothing half-saved, and the same action succeeds once the store is reachable, with no restart.
- **DP-45 — Mail outage and recovery.** With the mail service unreachable, a stay is still created but its link reads as not sent, an invoice stays `Not sent`, each shows the published text, and retrying succeeds once the service is reachable.
- **DP-46 — Move from a chosen night.** A move from a chosen night keeps earlier nights on the old room as a separate block and moves that night and later, with nightly prices unchanged.
- **DP-47 — In-house moves keep posted charges.** Moving an in-house guest, from the business date when no night is chosen, requires a clean or inspected target, makes the room left dirty, and leaves every posted entry with the room number it was posted for.
- **DP-48 — Room moves reach other staff live.** A second signed-in staff browser shows a move's new blocks, room chips and later-posted charges and hears the published notice within the published live delay.
- **DP-49 — Guest merge field rules.** An empty survivor field takes the other value, a differing field takes the choice made, defaulting to the survivor's, and `Merge conflicts` shows both values with one radio group per differing field.
- **DP-50 — Merge guests by keyboard.** Using only the keyboard the user completes `Merge guests`, hears the published notice, finds stays and folios on the survivor and issued invoices unchanged, and the merged profile answers not found.
- **DP-51 — Published report figures.** Occupancy, average daily rate and revenue per available room follow the published formulas and rounding with out-of-order rooms, cancelled stays, no-shows and fees treated as published, including the worked example and the zero case.
- **DP-52 — Reports update live.** An owner's open `Reports` screen changes its figures without reload within the published live delay after a stay changes in another browser.
- **DP-53 — Close under reduced motion.** When the device asks for reduced motion, the close shows the final grid, final figures, new date and `Close results` in one step with the same announcement, no ground change and no count or slide.
- **DP-54 — Sign-in, roles and hotel isolation.** Signed-out callers, other hotels' records and routes barred to the caller's role follow the one published error order and page-route rules, and no response ever crosses from one hotel to another.
- **DP-55 — Grading setup and clock.** The two grading routes behave as published, including the not-found answer to a wrong key, independent clocks per hotel and every server time rule reading the hotel's clock.
- **DP-56 — Health and boot without services.** The health route answers as published, the app starts with any provider unreachable, and each provider is read per call.
- **DP-57 — Published layouts at each viewport.** At 375x812, 768x1024 and 1280x800 each role gets its published layout, order and panel state with no horizontal page overflow, and closed panels are hidden and inert.
- **DP-58 — Server boundary.** The server applies the published origin rule and size limits, serves no source files or credentials, and keeps the bucket's objects reachable only through the app.
- **DP-59 — Ledgered nocturnal desk look.** The desk shows hairline rules between room rows, a fixed key-rack column, tabular amounts aligned on the decimal, a full-width tally rail, the built-in serif and sans-serif, and the published colour roles at AA contrast.
- **DP-60 — Real wiring in the source.** Credentials and service addresses come from the environment, and invoice, photo and mail states come from real provider calls with no hard-coded or simulated results.

## Frontend

### Screens and layout (DP-11, DP-18, DP-54, DP-57)

Routes:

| Route | Who may open it | Notes |
|---|---|---|
| `/` | anyone | Sign-in; sends a signed-in user to their home |
| `/desk` | owner, front desk | Home for owner and front desk |
| `/board` | owner, front desk, housekeeper | Home for a housekeeper at every viewport |
| `/guests` | owner, front desk | |
| `/rates`, `/reports` | owner | |
| `/checkin/<token>` | anyone with the link | The guest's page; needs no account |

A signed-in user on a route barred to their role sees `Page not found.` A signed-out visitor to `/desk`, `/board`, `/guests`, `/rates` or `/reports` is sent to `/`, which shows the sign-in form, and signing in goes to the role's home.

**Desk, 1280x800.** Top to bottom: a slim top bar with `navigation "Main"`, `Business date`, `Free rooms`, `New stay` and, for the owner, `Run close`; the two live regions `Desk notices` and `Close status` in one line under it; `Reservation timeline` on the left, taking about three quarters of the width, with `complementary "Today"` on the right listing today's arrivals and departures; and `Tally rail` across the full width at the foot, inside the viewport. An open `Stay` docks over the right column.

**Desk, 768x1024.** The same order, with the timeline at full width and `Today` closed by default. The `Today` button opens it as a right-hand overlay. `Stay` docks over the right half.

**Desk, 375x812 (owner and front desk).** The top bar stacks; the timeline is not shown and `list "Today's rooms"` takes its place, one room per item with number, condition chip, then guest and dates (or `Vacant` when no stay holds the room tonight), in room-number order; `Tally rail` follows as stacked lines. `Stay` and every dialog fill the screen.

**Timeline.** A fixed key-rack column of room numbers with condition chips sits left of 14 ruled night columns running from the day before the business date to 12 days after it. The business date column stays pinned in view while the grid scrolls inside its own frame. `Previous nights` and `Next nights` shift the window by 7 nights. Moving focus past an edge shifts the window as well. A stay moved from a chosen night appears as one block per room. Cancelled and no-show stays show as thin, dim, struck-through blocks and never occupy a night.

**Published timeline attributes.** The attribute values are the only timeline facts checks read; behaviour is never judged by pixels or colours.

| Element | Attributes |
|---|---|
| Room `row` | `data-room-id`, `data-room-type` |
| Date `columnheader` | `data-date` (YYYY-MM-DD); the business date also has `data-business-date="true"` |
| `gridcell` | `data-date`, `data-room-id`; after a close, see `data-stamp` in Motion and effects |
| Stay block | `data-stay-id`, `data-room-id`, `data-first-night`, `data-nights`, `data-status` (`booked`, `in_house`, `checked_out`, `cancelled`, `no_show`); `data-picked-up="true"` during a pick-up; `data-checked-in-online="true"` once completed |
| Blocked room `row` | `data-blocked="true"` while a blocked close is shown |
| Element with role `main` | `data-ground` (`day`, `night`) and `data-close-phase` (`idle`, `night`, `stamping`, `slide`) |

**Stay.** Guest and dates, status, `Cancellation terms`, `Nightly breakdown` with `Stay total`, stay actions, then one region per folio with its entries and balance. Once checked in, it shows `Checked in for the night of <YYYY-MM-DD>`, with the date being the stay's check-in night from Business rules.

**Board.** Top to bottom: `Board status`, `Room board` with one group per room in room-number order, then `Today's stays`. At 768x1024 and 1280x800 the room groups flow in two and three columns; at 375x812 in one column. Each room shows number, status and the dates of the stay holding the business date, and nothing else.

**Guests.** Search, table of guests and `Merge guests`. **Rates.** Rate plan prices, then the tax rate form and `Tax rates`. **Reports.** Date range, the figures and `Nightly figures`. Guests, Rates and Reports use one column at 375x812 and at 768x1024, and at 1280x800 keep the form on the left and figures or table on the right.

**Guest check-in page.** One column at every viewport: the hotel's name, that stay's dates and room type, then the form. Nothing else about the stay or guest appears.

Nowhere does the page itself scroll sideways at the three viewports; the timeline and wide tables scroll inside their own frames. No breakpoint between these sizes changes which layout a published size gets.

### Public screens and controls (DP-01, DP-07, DP-11, DP-14, DP-18, DP-35, DP-37, DP-49, DP-50, DP-51, DP-57)

Only these are public; everything else is free. `<...>` is a value from the record. Date fields are plain text fields typed as YYYY-MM-DD, with no native picker. Amount fields take dollars, for example `123.45`.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| Sign-in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `status "Sign-in status"` | Labels as named |
| Shell | `navigation "Main"`; `link "Desk"`, `link "Guests"`, `link "Rates"`, `link "Reports"`, `link "Board"`, each shown only to the roles that may open its route; `button "Sign out"` | Labels as named |
| Desk | `status "Business date"` | `<YYYY-MM-DD>` |
| Desk | `status "Free rooms"` | Text from Feedback states |
| Desk | `status "Desk notices"`, `status "Close status"` | Text from Feedback states and Business rules |
| Desk | `button "New stay"`, `button "Run close"` (owner only), `button "Today"` (768x1024 only) | Labels as named |
| Desk | `complementary "Today"` | Arrivals and departures on the business date |
| Timeline | `grid "Reservation timeline"`, `rowheader "Room <number>"`, `columnheader "<YYYY-MM-DD>"`, `gridcell` | Dates and numbers |
| Timeline | `button "Previous nights"`, `button "Next nights"` in the grid's header row | Labels as named |
| Timeline | `button "Room <number> status: <status>"` in each rowheader | Condition chip |
| Timeline | `button "Stay <guest>, room <number>, <arrival> to <departure>"` | Guest's name on the block |
| Foot | `region "Tally rail"`; `status "Tally date"`, `status "Tally rooms sold"`, `status "Tally room revenue"`, `status "Tally occupancy"`, `status "Tally average daily rate"`, `status "Tally revenue per available room"` | `Tally date` reads `Last closed night <YYYY-MM-DD>`; figures formatted as in Business rules; before any close the date reads `No night closed yet` and every figure `—` |
| After close | `table "Close results"` (see Motion and effects) | One row per `rows` entry of `CloseResult`; columns `Room` (`<number>`) and `Posted` (`$<amount>`, from that row's `postedCents`) |
| Phone desk | `list "Today's rooms"`; `button "Open stay <guest>"`, `button "Check in <guest>"`, `button "Check out <guest>"` | Labels as named |
| Room status | `dialog "Room status"`; `button "Dirty"`, `button "Clean"`, `button "Inspected"`, `button "Out of order"` | Labels as named |
| New stay | `dialog "New stay"`; `textbox "Guest name"`, `textbox "Guest email"`, `textbox "Guest phone"`, `textbox "Arrival"`, `textbox "Departure"`, `spinbutton "Guests"`, `combobox "Room"`, `combobox "Rate plan"`, `button "Create stay"`, `button "Close"` | Labels as named |
| New stay and Stay | `table "Nightly breakdown"`, `status "Stay total"` | Columns `Date`, `Room`, `Tax`, `City tax`, `Night total`; total as `$<amount>` |
| Any form | `alert "Form errors"` | One link per error reading `<field label>: <message>` |
| Stay | `dialog "Stay"`; `status "Cancellation terms"`, `button "Check in"`, `button "Check out"`, `button "Cancel stay"`, `textbox "Departure"`, `button "Save dates"`, `combobox "Move to room"`, `textbox "Move from night"`, `button "Move room"`, `button "Resend check-in link"`, `link "View ID photo"`, `button "Add folio"`, `status "Folio status"`, `button "Close"` | `Checked in online` once completed; an empty `Move from night` sends no `fromNight`, with the result given under Room moves in Business rules |
| Cancel | `alertdialog "Cancel stay"`; `button "Confirm cancellation"`, `button "Keep stay"` | Same text as `Cancellation terms` |
| Each folio | `region "Folio <letter>"`; `table "Folio <letter> entries"`, `status "Folio <letter> balance"`, `status "Invoice state"`, `status "Mail state"`, `textbox "Payer name"`, `textbox "Payer email"`, `button "Save payer"`, `button "Add charge"`, `button "Record payment"`, `button "Close folio"`, `button "Email invoice"`, `link "Download invoice"` | Entry columns `Date`, `Description`, `Amount`; each row has `data-entry-id`; `Invoice state` reads `Draft` or `Issued`; `Mail state` reads `Not sent` or `Sent` |
| Each entry row | `button "Split <description>"` (charges), `button "Reverse <description>"`, `button "Move <description>"` | Labels as named |
| Split | `dialog "Split charge"`; `spinbutton "Folio <letter> percent"` per share, `button "Add payer"`, `table "Split preview"`, `button "Apply split"`, `button "Close"` | Opening state and preview columns are given below this table |
| Payment | `dialog "Record payment"`; `combobox "Payment method"` (`Cash`, `Card`), `textbox "Amount"`, `textbox "Terminal reference"`, `button "Save payment"`, `button "Close"` | Labels as named |
| Charge | `dialog "Add charge"`; `textbox "Description"`, `textbox "Amount"`, `button "Save charge"`, `button "Close"` | Labels as named |
| Move entry | `dialog "Move entry"`; `combobox "To folio"`, `button "Save move"`, `button "Close"` | Labels as named |
| Board | `region "Room board"`, `group "Room <number>"` with `data-status`, `button "Room <number> clean"`, `button "Room <number> dirty"`, `status "Board status"`, `list "Today's stays"` | One list item per stay holding the business date, in room-number order, reading `Room <number>: <arrival> to <departure>` |
| Guests | `searchbox "Search guests"`, `table "Guests"`, `button "Merge guests"` | Columns `Name`, `Email`, `Phone`, `Company`, `Address` |
| Merge | `dialog "Merge guests"`; `combobox "Surviving guest"`, `combobox "Merged guest"`, `button "Review merge"`, `table "Merge conflicts"`, `radiogroup "<field>"` for `Name`, `Email`, `Phone`, `Company`, `Address` when they differ, `radio "Keep <value>"`, `button "Confirm merge"`, `button "Close"` | Labels as named |
| Rates | For each plan: `textbox "<plan> weeknight price"`, `textbox "<plan> weekend price"`, `button "Save <plan>"`. Tax: `textbox "Tax rate percent"`, `textbox "Starts on"`, `button "Save tax rate"`, `table "Tax rates"`, `status "Rates status"` | Labels as named |
| Reports | `textbox "From"`, `textbox "To"`, `button "Show figures"`, `status "Rooms available"`, `status "Rooms sold"`, `status "Room revenue"`, `status "Occupancy"`, `status "Average daily rate"`, `status "Revenue per available room"`, `table "Nightly figures"` | The range starts on the business date for both fields |
| Guest page | `heading "Check in"`, `textbox "Full name"`, `textbox "Phone"`, file input labelled `ID photo`, `button "Upload photo"`, `button "Complete check-in"`, `status "Check-in status"` | `Received` appears in `Check-in status` per Feedback states |

**Drop-down options.** Every `combobox` is a native drop-down list, chosen by its visible option text. `Room` and `Move to room` list `<number>`, one option per room in room-number order. `Rate plan` lists each plan's name. `To folio` lists `Folio <letter>` for the stay's other open folios. `Surviving guest` and `Merged guest` list `<name> <email>` with one space, or `<name>` alone when the profile has no email, one option per guest in name order; for example, with the seed data at start, `Sam Whitlock sam@guests.example`. Each of these lists opens on an empty first option `Choose`, unless `N` filled in the room.

**Split charge.** The dialog opens with exactly two empty fields, `Folio A percent` and `Folio B percent`. Each press of `Add payer` adds the next letter's field, up to the four shares the API allows, and a press at that limit adds nothing.

**Table formats.**

- `Split preview` has columns `Folio`, `Percent` and `Share`, with one row per percent field in letter order and cells such as `Folio A`, `50%` and `$16.67`. It refreshes after each change to a field, within half a second of the clock. An empty field's `Percent` cell reads `—`, and every `Share` cell reads `—` until the percentages add up to 100. For example, a 3333 charge at 50 and 50 shows `$16.67` and `$16.66`.
- `Tax rates` has columns `Rate` and `Starts on`, with one row per rate, earliest first, and cells such as `9.25%` and `2027-03-09`. The rate always shows two decimals. The hotel's default rate comes first with `Starts on` reading `—`, and its `startDate` in the API is null.
- `Nightly figures` has columns `Date`, `Rooms available`, `Rooms sold`, `Room revenue`, `Occupancy`, `Average daily rate` and `Revenue per available room`, with one row per night in date order. `Date` reads YYYY-MM-DD, the two room counts are whole numbers, `Room revenue` is money as in Business rules, and the last three columns are the strings published under Reports. For example, the worked night under Reports reads `13`, `9`, `$1,234.50`, `69.2%`, `$137.17` and `$94.96` after its date. The `status` regions of the same names on `Reports`, and the matching `Tally rail` figures, use the same formats.

### Interactions (DP-01, DP-07, DP-08, DP-10, DP-17, DP-18, DP-35, DP-37, DP-50)

**Inside `Reservation timeline`.** The grid keeps one current cell. These keys work whichever control in the grid has focus, including the header buttons, the condition chips and the stay blocks, and are ignored with Ctrl, Alt or Cmd held:

- Arrow keys move the current cell by date and room, and focus follows.
- `N` opens `New stay` with the current cell's room and date filled in.
- `M` picks up the stay in the current cell. Up and Down place it on another room. Left and Right shift its dates, for a booked stay only; they do nothing for an in-house stay. Enter drops and sends the request given under Room moves in Business rules. Escape cancels and returns it.
- `I` checks in, and `O` checks out, the stay in the current cell.
- Enter, when nothing is picked up, opens `Stay` for the stay in the current cell, or `New stay` on an empty cell.

Tab enters the grid at the current cell and Shift+Tab leaves it. With no stay in the current cell, `M`, `I` and `O` put the no-stay text from Feedback states in `Desk notices`. A dragged block with the mouse follows the same rules and the same requests as `M`.

**Dialogs.** In every dialog and alertdialog, Tab and Shift+Tab stay inside and wrap from last to first and first to last, Escape closes only the topmost, and focus returns to the control that opened it. A control whose action is finished stays focusable so focus can return to it. A closed dialog or panel is hidden and inert.

**New stay and Stay.** `Nightly breakdown` and `Stay total` refresh after a change to dates, guests, room or plan, within half a second of the clock. `Stay` loads fresh from the server each time it opens, and `Cancellation terms` updates on opening `Stay`, on opening `Cancel stay`, and from each cancel answer.

**Pending and repeat.** While a request is pending, its button carries `aria-busy="true"` and a further press sends nothing, so a double press yields one request. Opening another stay while a load is pending shows only the newest stay. Reopening `Stay` during its closing motion cancels the hide. A late answer from an earlier request never overwrites newer state.

**Messages.** A message in a live region stays until the next message for that region; no timer dismisses it and no repaint or live update clears it.

**Board.** Each room's buttons are always shown, with the current one marked pressed. A tap sends the move, and a refusal appears in `Board status`. No swipe or long press is needed.

**Close.** `Run close` sends the current business date from the screen. A blocked close moves focus to the first blocked row's `rowheader`.

**Live updates.** A page applies a pushed change when it arrives, with no browser timer in the path, and keeps the current cell, focus and open dialogs.

### Visual design (DP-59)

The desk reads like a hotel's ledger. Colour roles: a warm paper-cream day ground, a near-black green-tinted ink for text and rules, a deep burnt-orange accent for primary actions and refusals, a very dark green night ground for the close, and a warm brass for the blocker seam and the business date column's marker. All text and control states meet WCAG 2.2 AA contrast on both day and night grounds.

Type: the platform's built-in serif for headings, the business date numeral and room numbers; the platform's built-in sans-serif for everything else; no font files. Each heading step is a fifth larger than the one below. Every money column uses tabular numerals aligned on the decimal point.

Density is compact: a hairline rule sits between every room row and a fainter one between night columns, with little padding. Composition: the key-rack of room numbers with condition chips stands fixed at the left of the ruled grid, the business date column is pinned, a full-width tally rail runs along the foot, and folios open as a right-hand pane. Graphics are procedural SVG only, with no outside images or fonts. Every control on the board and every touch control on phone layouts is at least 44 px in both directions.

### Motion and effects (DP-10, DP-31, DP-53)

**Panels and dialogs.** They slide in from the right or fade up in about a quarter of a second and leave the same way. **Press and hover.** Buttons darken at once on hover and press in by a hair for under a tenth of a second. **State change.** A chip that changes status flashes its new tone for under half a second. **Banned.** Unnamed decorative loops, including spinners that run after their request ended.

**Night Close Sweep** plays on the screen of the owner who pressed `Run close`, only after the server's success answer, in about two seconds and never more than two and a half. While the request is pending, `data-close-phase` stays `idle` and no cell stamps.

1. **`night`:** `data-ground` becomes `night` and the desk darkens from day to night in about a third of a second.
2. **`stamping`:** going down the rows in room-number order, each in-house stay's business date cell stamps the exact amount posted to its folio, about a tenth of a second apart and no more than one and a half seconds altogether. Vacant, no-show and out-of-order rows get only a dim tick. In the last half second or so of this phase, the tally rail counts from zero up to the committed figures, and it is marked `aria-busy="true"` while counting.
3. **`slide`:** the grid slides left by exactly one night column in about a third of a second, the business date numeral flips to the next date, and the ground returns to day.
4. **`idle`:** `data-ground` is `day` and the sweep is over.

**End state.** On any posted night, the room's `gridcell` has `data-stamp` holding the posted night total as `$<amount>`. On the closed date, vacant, no-show and out-of-order rooms have `data-stamp="tick"`. The server provides these, so a reload at any moment shows the same committed amounts, final figures and new date, with `data-close-phase` at `idle`. A front desk screen, and a phone layout, skips the sweep and shows the end state at once.

**Blocker.** Nothing posts. A brass seam runs down the key-rack and stops on the first blocked row, focus moves to it, and the reason shows at once with no timer needed.

**Reduced motion.** When the device asks for reduced motion, every loop stops and each sequence shows its end state at once with the same function and same announcements. For the close: `data-close-phase` stays `idle`, `data-ground` stays `day`, there is no sweep, count or slide, and the final grid, final totals and new date appear in one step with `table "Close results"` listing each charged room and its posted amount. Panels appear and disappear at once. The phone layout's close also shows `Close results`.

### Feedback states (DP-01, DP-06, DP-09, DP-13, DP-16, DP-25, DP-35, DP-37, DP-42, DP-44, DP-45, DP-50)

`<guest>` is the guest's name; `<number>` the room number; `<amount>` is formatted as in Business rules. These are the exact strings. A refusal's text comes from Business rules, or Services for an outage, and shows in the same region as the row it belongs to. Notices that describe a change, as listed for `Desk notices`, reach every other signed-in staff screen as the same text.

| Action | Region | Pending | Success |
|---|---|---|---|
| Sign in | `Sign-in status` | `Signing in…` | Goes to the role's home |
| Create stay | `Desk notices` | `Creating stay…` | `Stay created for <guest> in room <number>.` |
| Stay changed dates or guests | `Desk notices` | `Saving stay…` | `Stay updated for <guest>.` |
| Pick up | `Desk notices` | none | `Picked up <guest>.` |
| Placement during pick-up | `Desk notices` | none | `Over room <number>, <YYYY-MM-DD>.` |
| Drop or `Move room`, including a drop that only shifts dates, naming the room the stay then holds | `Desk notices` | `Moving stay…` | `Moved <guest> to room <number>.` |
| Escape during pick-up, or a drop on the starting place | `Desk notices` | none | `Move cancelled.` |
| Check in | `Desk notices` | `Checking in…` | `Checked in <guest> to room <number>.` |
| Check out | `Desk notices` | `Checking out…` | `Checked out <guest> from room <number>.` |
| Cancel stay | `Desk notices` | `Cancelling stay…` | `Cancelled <guest>'s stay. No fee.` or `Cancelled <guest>'s stay. Fee: $<amount>.` |
| Resend link | `Desk notices` | `Sending check-in link…` | `Check-in link sent to <guest>.` |
| Room status | `Desk notices`, and `Board status` on the board | `Saving status…` | `Room <number> is now <status>.` |
| Online check-in completed | `Desk notices` | none | `Room <number> guest completed online check-in.` |
| Merge | `Desk notices` | `Merging guests…` | `Guests merged. <n> stays moved.` |
| No stay in current cell | `Desk notices` | none | `No stay here.` |
| Run close | `Close status` | `Running close…` | `Business date <YYYY-MM-DD> closed. <n> rooms charged. <m> no-shows.` |
| Add charge | `Folio status` | `Saving charge…` | `Charge of $<amount> added.` |
| Record payment | `Folio status` | `Saving payment…` | `Payment of $<amount> recorded.` |
| Reverse | `Folio status` | `Posting reversal…` | `Reversal posted.` |
| Split | `Folio status` | `Splitting charge…` | `Split $<amount> across <n> folios.` |
| Move entry | `Folio status` | `Moving entry…` | `Entry moved to Folio <letter>.` |
| Save payer | `Folio status` | `Saving payer…` | `Payer saved.` |
| Close folio | `Folio status` | `Creating invoice…` | `Invoice <number> issued.` |
| Email invoice | `Folio status` | `Sending invoice…` | `Invoice <number> sent to <email>.` |
| Save rate plan or tax rate | `Rates status` | `Saving rates…` | `Rates saved.` |
| Upload photo | `Check-in status` | `Uploading photo…` | `Received` |
| Complete check-in | `Check-in status` | `Completing check-in…` | `Check-in complete. See you on <arrival>.` |

`Free rooms` reads `<n> rooms free tonight`, using that word form for every `<n>`, including 1. `<n> rooms charged` and `<m> no-shows` also keep their word forms for every count.

When a stay is created but its link could not go out, `Desk notices` shows the create text above, one space, then the mail outage text for check-in links from Services. For example, with the guest in the setup example: `Stay created for Ana Vale in room 101. The check-in link could not be sent. The mail service is unavailable.`

Field errors appear beside their field and as links in `Form errors`; following a link moves focus to that field. Pending text is replaced by the outcome and is never left behind. `Close status` announces the close when the server's answer arrives, without waiting for the sweep.

## Backend

### API (DP-02, DP-04, DP-05, DP-06, DP-20, DP-21, DP-22, DP-23, DP-26, DP-29, DP-33, DP-36, DP-41, DP-42, DP-49, DP-51, DP-54, DP-55, DP-56)

All bodies are `application/json` unless stated; a JSON route given another content type answers `415 {"error":"Send JSON."}`. JSON bodies are limited to 1,000,000 bytes, the limit itself allowed; larger answers `413 {"error":"That request is too large."}`. Amount fields ending `Cents` are integers, and the report figure fields have the JSON types stated under Reports in Business rules. Dates are YYYY-MM-DD.

**Error shape.** Every error is `{"error":"<text>"}`, except validation: `422 {"errors":{"<field>":"<message>"}}`.

**Error order, for the whole API:** `401 {"error":"Please sign in."}` when not signed in; then `404 {"error":"Not found."}` for anything the caller cannot open, whether unknown, another hotel's or barred to the caller's role, and never 403; then a stored replay's response; then 409 state conflicts; then 422 validation. A state check that cannot run because a value is malformed is skipped and that value answers 422. Guest-link routes use their own 404 text from Business rules. Outages answer 503 at the point the provider is called. Rows below name only their own extra errors.

**Roles.** O = owner, F = front desk, H = housekeeper.

**Shapes.**

- `Entry`: `{"id","kind":"charge|payment","date","description","amountCents","roomNumber","reversesEntryId","splitOfEntryId"}`. `roomNumber` and both reference fields may be null.
- `Invoice`: `{"id","number","state":"issued","mailState":"not_sent|sent","billToName","payerEmail","pdfUrl"}`.
- `Folio`: `{"id","name","payerName","payerEmail","state":"open|closed","balanceCents","entries":[Entry],"invoice":Invoice|null}`.
- `Night`: `{"date","roomNumber","roomCents","taxCents","cityTaxCents","totalCents","posted":bool}`.
- `Cancellation`: `{"state":"free","feeCents":0,"text":"..."}` or `{"state":"late","feeCents":n,"text":"..."}`; `null` once the stay is not booked. `text` uses the wording in Business rules.
- `Stay`: `{"id","version","status","guest":{"id","name","email","phone"},"ratePlanId","guests","arrival","departure","segments":[{"roomId","roomNumber","firstNight","nights"}],"checkedInOnline":bool,"onlineCheckIn":{"fullName","phone"}|null,"checkinLinkState":"not_sent|sent|ended","checkInNight":date|null,"idPhoto":"none|received","nightly":[Night],"totalCents","cancellation":Cancellation,"folios":[Folio]}`.

| Method and path | Roles | Request | Success | Own errors |
|---|---|---|---|---|
| `POST /api/session` | any | `{"email","password"}` | `200 {"user":{"id","email","name","role","hotelId"}}`, sets a cookie | `401 {"error":"That email or password is not right."}` |
| `GET /api/session` | signed in | none | `200` same body | |
| `DELETE /api/session` | signed in | none | `204` | |
| `GET /api/desk` | O F | none | `200 {"hotel":{"id","name","timeZone","businessDate"},"freeRoomsText","lastClose":CloseResult|null}` | |
| `GET /api/timeline?from&to` | O F | dates, at most 62 nights | `200 {"businessDate","dates":[date],"rooms":[{"id","number","type","status"}],"blocks":[{"stayId","roomId","firstNight","nights","status","guestName","checkedInOnline","version"}],"stamps":[{"date","roomId","stamp"}]}` | 422 on `from` or `to` |
| `GET /api/housekeeping/board` | O F H | none | `200 {"businessDate","rooms":[{"roomId","number","status","arrival","departure"}]}`, with exactly these keys; dates null when vacant | |
| `POST /api/rooms/:id/status` | O F H | `{"status":"dirty|clean|inspected|out_of_order"}` | `200` one board room object | Business rules 409; 422 on `status` |
| `POST /api/stays/quote` | O F | `{"arrival","departure","guests","ratePlanId","roomId"}` | `200 {"nightly":[Night],"totalCents"}` | 422 as for create |
| `POST /api/stays` | O F | Header `Idempotency-Key` (1 to 200 characters). `{"guestId"}` or `{"guest":{"name","email","phone"}}`, plus `arrival`, `departure`, `guests`, `roomId`, `ratePlanId` | `201 Stay` | Business rules 409; 422 as below |
| `GET /api/stays/:id` | O F | none | `200 Stay` | |
| `PATCH /api/stays/:id` | O F | `{"version"}` plus any of `arrival`, `departure`, `guests`, `ratePlanId` | `200 Stay` | Business rules 409; 422 as for create |
| `POST /api/stays/:id/move` | O F | `{"version","roomId"}` plus `arrival` (booked only) or `fromNight`, never both | `200 Stay` | Business rules 409; 422 on `fromNight`, `arrival` |
| `POST /api/stays/:id/check-in` | O F | none | `200 Stay` | Business rules 409 |
| `POST /api/stays/:id/check-out` | O F | none | `200 Stay` | Business rules 409 |
| `POST /api/stays/:id/cancel` | O F | none | `200 Stay` | Business rules 409 |
| `POST /api/stays/:id/checkin-link` | O F | none | `200 Stay` | `409` the link-closed text from Business rules; 503 |
| `GET /api/stays/:id/id-photo` | O F | none | `200` image bytes | `404`; 503 |
| `POST /api/stays/:id/folios` | O F | `{"payerName","payerEmail"}` | `201 Folio` | 422 |
| `PATCH /api/folios/:id` | O F | `{"payerName","payerEmail"}` | `200 Folio` | closed-folio 409; 422 |
| `POST /api/folios/:id/charges` | O F | `{"description","amountCents"}` (above 0) | `201 Entry` | closed-folio 409; 422 |
| `POST /api/folios/:id/payments` | O F | `{"method":"cash|card","amountCents","reference"}` (`reference` required for card) | `201 Entry` | closed-folio 409; 422 |
| `POST /api/entries/:id/reverse` | O F | none | `201 Entry` | Business rules 409 |
| `POST /api/entries/:id/split` | O F | `{"percents":[50,25,25]}` | `201 {"folios":[Folio]}` | Business rules 409; 422 |
| `POST /api/entries/:id/move` | O F | `{"toFolioId"}` | `200 {"folios":[Folio]}` | Business rules 409 |
| `POST /api/folios/:id/close` | O F | none | `200 Folio` | Business rules 409; 503 |
| `POST /api/invoices/:id/email` | O F | none | `200 Invoice` | 422 on `payerEmail`; 503 |
| `GET /api/invoices/:id/pdf` | O F | none | `200` `application/pdf` | 503 |
| `POST /api/close` | O | `{"businessDate"}` | `200 CloseResult` | Business rules 409, adding `"blockers":[{"roomId","roomNumber","text"}]` for blockers; 422 on a malformed date |
| `GET /api/reports?from&to` | O | dates, inclusive, at most 366 nights | `200 {"from","to","roomsAvailable","roomsSold","roomRevenueCents","occupancy","averageDailyRate","revenuePerAvailableRoom","nights":[{"date","roomsAvailable","roomsSold","roomRevenueCents","occupancy","averageDailyRate","revenuePerAvailableRoom"}]}` | 422 on `from` or `to` |
| `GET /api/rate-plans` | O F | none | `200 {"ratePlans":[{"id","name","weeknightCents","weekendCents"}]}` | |
| `PATCH /api/rate-plans/:id` | O | `{"weeknightCents","weekendCents"}` | `200` plan | 422 |
| `GET /api/tax-rates` | O F | none | `200 {"taxRates":[{"id","percent","startDate"}]}` | |
| `POST /api/tax-rates` | O | `{"percent":"9.25","startDate"}` | `201` rate | 422 |
| `GET /api/guests?search=` | O F | none | `200 {"guests":[{"id","name","email","phone","company","address"}]}` | |
| `GET /api/guests/:id` | O F | none | `200` guest plus `"stayIds"` and `"folioIds"` | |
| `POST /api/guests/merge` | O F | `{"survivorId","mergedId","choices":{"phone":"merged"}}`; an omitted field takes the survivor's | `200 {"guest","staysMoved"}` | 422 on `mergedId` when both ids match |
| `GET /api/live` | O F H | none | `200` `text/event-stream` | |
| `GET /api/checkin/:token` | link | none | `200 {"hotelName","arrival","departure","roomType","photo":"none|received"}`, with exactly these keys | link 404 |
| `POST /api/checkin/:token/photo` | link | `multipart/form-data`, field `photo` | `200 {"photo":"received"}` | link 404; 413; 415; 503 |
| `POST /api/checkin/:token/complete` | link | `{"fullName","phone"}` | `200 {"completed":true}` | link 404; `409 {"error":"Please upload your ID photo first."}`; `422 {"errors":{"fullName":"Enter your full name."}}` |
| `GET /api/health` | any | none | `200 {"status":"ok"}`, or `200 {"status":"unavailable"}` per Services | |

`CloseResult` is `{"businessDate","newBusinessDate","roomsCharged","noShows","figures":{"roomsAvailable","roomsSold","roomRevenueCents","occupancy","averageDailyRate","revenuePerAvailableRoom"},"rows":[{"roomId","roomNumber","stayId","postedCents"}]}`, and `rows` are in room-number order. `rows` hold exactly the stays that received a room charge in this close, one row each, so `roomsCharged` equals their count and no-show rooms are not in `rows`. `postedCents` is that night's room plus tax plus city tax, and no-show fees are excluded.

**Create and change validation messages.** `guest.name`: `Enter the guest's name.`; `guest.email`: `Enter a valid email address.`; `arrival`: `Arrival cannot be before the business date.`; `departure`: `Departure must be after arrival.`, `Stays are limited to 90 nights.` or, for an in-house stay whose departure is after arrival but before the business date, `Departure cannot be before the business date.`; `guests`: `Guests must be between 1 and 6.`; `roomId`: `Choose a room.`; `ratePlanId`: `Choose a rate plan.`; `idempotencyKey`: `Send an Idempotency-Key header.`.

**Other validation messages.** `percents`: `Enter 2 to 4 whole percentages that add up to 100.`; `amountCents`: `Enter an amount above zero.`; `reference`: `Enter the terminal reference.`; `payerEmail`: `Enter the payer's email address.`; `percent`: `Enter a rate from 0 to 30 with at most two decimals.`; `startDate`: `The start date must be after the business date.`; `fromNight`: `Choose a night of this stay that is not before the business date.`; `arrival` on a move of a non-booked stay: `Only a booked stay can change its dates this way.`; `arrival` on a move before the business date: the create message for `arrival`; `arrival` on a move that also sends `fromNight`, judged first and answered as the only error: `Send arrival or fromNight, not both.`; `mergedId`: `Choose two different guests.`; `from` and `to`: `Enter a valid date range.`.

**Live stream.** `GET /api/live` sends `event: change` with JSON `data`. For owner and front desk: `{"type":"stay|room|close|checkin|merge|report","notice":"<text or null>"}`, plus `stayId`, `roomId` or `businessDate` when they apply. For a housekeeper, only `{"type":"room","roomId","number","status","arrival","departure","notice"}`, with exactly these keys. Every committed change to a stay, folio, room, guest or close sends one event to that hotel's connected staff, across every app instance sharing the database, and reaches the screen within `LIVE_MAX_DELAY_MS` milliseconds.

**Grading routes.** Both require header `X-Grading-Key` equal to env `GRADING_KEY`. A wrong or missing key, or an unset `GRADING_KEY`, answers `404 {"error":"Not found."}`. They need no session.

`POST /api/grading/setup` creates one hotel with everything in its body, and answers `201` with every created id by its `key`. Each hotel's clock and data are independent, so a test creates its own hotel. All keys but `hotel.name` are optional.

Defaults: `timeZone` is `HOTEL_TIME_ZONE_DEFAULT`; `now` absent or null means real time; `businessDate` is the hotel's current night by the moment rule; earlier dates count as closed. `ratePlans` absent creates `Flexible` and `Corporate` with the published prices. `taxRates` lists rates beyond the default. Room `status` is `dirty`, `clean`, `inspected` or `out_of_order`, default `clean`. Stay `status` is `booked`, `in_house`, `checked_out`, `cancelled` or `no_show`, default `booked`. A stay with no listed folio gets an empty `Folio A`, payer the guest. `"checkinLink": true` emails the link; otherwise no mail goes out. Setup entries are stored as given; setup posts nothing else and no closed-day figures exist until a close runs. An overlap, an unknown `key` reference or a bad value answers `422 {"errors":{"setup":"<message>"}}`.

```json
{
  "hotel": {"name": "Test Inn", "timeZone": "America/Chicago", "businessDate": "2027-03-05", "now": "2027-03-05T12:00:00-06:00"},
  "users": [
    {"key": "owner", "email": "o@test.example", "password": "pass-owner-1", "name": "Olu Bright", "role": "owner"},
    {"key": "desk", "email": "d@test.example", "password": "pass-desk-1", "name": "Dee Marsh", "role": "front_desk"},
    {"key": "hk", "email": "h@test.example", "password": "pass-hk-1", "name": "Hal Ferro", "role": "housekeeper"}
  ],
  "rooms": [{"key": "r101", "number": "101", "type": "Queen", "status": "clean"}],
  "ratePlans": [{"key": "flex", "name": "Flexible", "weeknightCents": 12000, "weekendCents": 15000}],
  "taxRates": [{"percent": "9.25", "startDate": "2027-03-09"}],
  "guests": [{"key": "g1", "name": "Ana Vale", "email": "ana@test.example", "phone": "+1 555 0100", "company": "", "address": ""}],
  "stays": [{"key": "s1", "room": "r101", "guest": "g1", "ratePlan": "flex", "arrival": "2027-03-05", "departure": "2027-03-08", "guests": 1, "status": "in_house", "checkinLink": false}],
  "folios": [{"key": "f1", "stay": "s1", "name": "Folio A", "payerName": "Ana Vale", "payerEmail": "ana@test.example",
    "entries": [{"key": "e1", "kind": "charge", "date": "2027-03-05", "description": "Minibar", "amountCents": 3333, "roomNumber": "101"}]}],
  "secondHotel": {"hotel": {"name": "Other Inn"}, "users": [{"key": "owner", "email": "o2@test.example", "password": "pass-owner-2", "name": "Rue Dain", "role": "owner"}], "rooms": [{"key": "r1", "number": "1", "type": "Queen"}]}
}
```

```json
{
  "hotelId": "h1",
  "users": {"owner": "u1", "desk": "u2", "hk": "u3"},
  "rooms": {"r101": "r1"},
  "ratePlans": {"flex": "p1"},
  "guests": {"g1": "g1"},
  "stays": {"s1": "s1"},
  "folios": {"f1": "f1"},
  "entries": {"e1": "e1"},
  "secondHotel": {"hotelId": "h2", "users": {"owner": "u9"}, "rooms": {"r1": "r9"}, "ratePlans": {}, "guests": {}, "stays": {}, "folios": {}, "entries": {}}
}
```

The ids above illustrate shape only; each is a string.

`POST /api/grading/clock` with body `{"hotelId":"...","now":"2027-03-05T17:59:59-06:00"}` sets that hotel's clock to that instant and holds it until set again; `{"hotelId":"...","now":null}` returns it to real time. It answers `200 {"hotelId","now"}`, and `404` for an unknown hotel.

### Business rules (DP-02, DP-03, DP-04, DP-05, DP-12, DP-13, DP-15, DP-17, DP-19, DP-20, DP-22, DP-23, DP-26, DP-27, DP-28, DP-29, DP-30, DP-33, DP-34, DP-36, DP-38, DP-39, DP-40, DP-41, DP-46, DP-47, DP-49, DP-51, DP-55)

**Hotel clock.** Every server time rule reads the hotel's clock. The browser's clock, zone and locale never decide anything; the device clock may be wrong.

**Stay nights.** A stay covers arrival up to but not including departure, so one guest can leave and another arrive in the same room on the same date. A room holds at most one stay per night, and the server enforces this on create, extend and move. Cancelled and no-show stays hold no nights. Worked example: arrival 2027-03-05, departure 2027-03-08 holds nights 03-05, 03-06 and 03-07, and a stay arriving 03-08 fits the same room.

**Stay states.**

| From | To | By | Otherwise |
|---|---|---|---|
| `booked` | `in_house` | check-in | `409 {"error":"This stay cannot be checked in."}` from any other state |
| `in_house` | `checked_out` | check-out | `409 {"error":"This stay cannot be checked out."}` from any other state |
| `booked` | `cancelled` | cancel | `409 {"error":"This stay can no longer be cancelled."}` from any other state |
| `booked` | `no_show` | close | never by request |

- `checked_out`, `cancelled` and `no_show` are final. Changing or moving one answers `409 {"error":"That stay cannot be moved."}`.
- Check-in also needs arrival equal to the business date, otherwise `409 {"error":"This stay arrives on <arrival>, not on business date <YYYY-MM-DD>."}`. Its room must be clean or inspected, otherwise `409 {"error":"Room <number> is <status> and cannot be checked in."}`, with `<status>` as `dirty` or `out of order`. Online completion does not check the stay in.
- Check-out needs departure on or before the business date, otherwise `409 {"error":"This stay departs on <departure>. Change its dates before checking out early."}`. It does not depend on folio balances. Checking out makes the room dirty.
- A `PATCH` on an in-house stay may change only `departure` and `guests`; changing arrival answers `409 {"error":"An in-house stay cannot change its arrival."}`. An in-house departure may equal the business date but may not fall before it, which answers 422 on `departure` with the in-house message from API.

**Business date.** Each hotel has an IANA time zone, default `America/Chicago`, and a business-day hour of 04:00 local. A moment at local time T belongs to the night of T's local date if T is at or after 04:00, otherwise to the night of the previous date. Worked example: a check-in at 02:30 on 2027-03-06 belongs to the night of 2027-03-05, and is returned as `checkInNight`. The business date is stored and advances only through the close.

**When the close opens.** The close opens at 04:00:00 local on the date after the business date; before that it answers `409 {"error":"The business day has not ended. The close opens at 04:00."}`, as does a close naming a future date. Daylight-saving dates, using America/Chicago: on 2027-03-14 local 02:00 to 02:59 does not exist and that business day has 23 hours; on 2027-11-07 local 01:00 to 01:59 occurs twice and that business day has 25 hours. 04:00 occurs exactly once on both, so the close opens at one instant, each night is posted exactly once, and the nightly price does not change with day length.

Worked examples: for business date 2027-03-13 the close is refused at 2027-03-14T03:59:59-05:00 and opens at 2027-03-14T04:00:00-05:00. For business date 2027-11-06 it is refused at 2027-11-07T03:59:59-06:00 and opens at 2027-11-07T04:00:00-06:00.

**End-of-day close.** Checks run in this order: an already-closed date, then the opening time, then blockers. A close naming an already-closed date posts nothing and answers `409 {"error":"This business date is already closed."}`. The one blocker is a stay departing on or before the business date still in house: `Room <room number> has not checked out.`. A blocked close answers 409 with the first blocker's text in `error`, every blocker in room-number order in `blockers`, and posts nothing.

When not blocked, in one transaction, all or nothing:

1. Every stay with arrival on the business date not yet checked in becomes `no_show` and its fee is posted.
2. Each in-house stay gets the night's room charge, percentage tax and city tax, in that order, in room-number order of the room holding that night.
3. The day's report figures are fixed.
4. The business date advances by one.

Each stay therefore receives one room charge and its taxes per business date, however often the close is pressed or the page reloaded.

**Posted entries.** Entries post to the stay's first open folio, or to a new folio with the next letter if none is open. `date` is the business date posted. Descriptions: `Room charge, room <number>`, `Tax, room <number>`, `City tax, room <number>`, `No-show fee`, `Late cancellation fee`. `<number>` is the room holding that night, and `roomNumber` holds it too.

**Rates.** All amounts are integer minor units (cents of US dollars) shown as `$1,234.56`, and negative amounts as `-$1,234.56`. Calculate with exact integers. For each night, with one rounding mode, half up, at one stage, per night:

1. base = the rate plan's price for that night's weekday; an extra-guest charge of 2500 per guest above 2 is added.
2. room = base less the length-of-stay discount by the stay's total nights (1 to 2 nights 0%, 3 to 6 nights 5%, 7 or more 10%), rounded half up to a cent.
3. tax = room times the percentage rate in force on that night, rounded half up to a cent. The default rate is 8.75%.
4. city tax = 200 per guest per night, not discounted and not taxed.

Rate plans: `Flexible` is 12000 Sunday to Thursday, 15000 Friday and Saturday. `Corporate` is 12040 every night. A night's weekday is taken from its own date.

Worked examples:

| Stay | Nights | Stay total |
|---|---|---|
| `Flexible`, 3 guests, arrival Thursday 2027-03-11, departure Sunday 2027-03-14, 3 nights | Thursday room 13775, tax 1205, city 600, night total 15580; Friday room 16625, tax 1455, city 600, night total 18680; Saturday the same 18680 | 52940 |
| `Flexible`, 1 guest, arrival Monday 2027-03-08, 1 night | room 12000, tax 1050, city 200 | 13250 |
| `Corporate`, 1 guest, arrival Monday 2027-03-08, 1 night, an exact half cent | room 12040, tax 1053.5 rounds to 1054, city 200 | 13294 |

**Price changes.** A stay's room amounts are fixed when it is created. A plan price change affects only stays created afterwards. Changing a stay's dates, guests or plan reprices its unposted nights from the current plan and new total nights; posted nights never change. A move without `arrival`, whether of the whole stay or from a chosen night, reprices nothing; a move with `arrival` changes the stay's dates, so it reprices its unposted nights.

**Tax rate changes.** The owner enters a new percentage and a start date, which must be after the business date; a second rate with the same start date replaces the first. Each night is taxed at the rate in force on that night, including on stays already booked, until it is posted. Nights before the start keep the old rate on the folio, invoice and reports. Worked example: rate 9.25% starts 2027-03-09; `Flexible`, 1 guest, arrival Monday 2027-03-08, 2 nights: Monday room 12000, tax 1050, city 200; Tuesday room 12000, tax 1110, city 200; stay total 26560.

**Creating a stay.** `Idempotency-Key` makes create safe to repeat. A replay with the same key and body returns the first response with status 201 and creates and sends nothing. The same key with a different body answers `409 {"error":"This request was already used for a different stay."}`. A create that uses an email already on a profile in this hotel, compared case-insensitively, reuses that profile. Creating sets `status` to `booked`, makes `Folio A` with the guest as payer and sends the link.

**Availability and conflicts.** Two staff booking the last room, or moving one stay at once, are resolved by server order: exactly one wins. Every change and move sends the `version` it read, and each successful change raises it.

- A create onto a held night answers `409 {"error":"Room <number> was just taken. Choose another room."}`.
- A `PATCH` or move with an older `version` answers `409 {"error":"This stay was changed by someone else. It now shows the latest."}`, and the screen then shows the latest.
- An extend or move onto a held night answers `409 {"error":"Room <number> is occupied on <YYYY-MM-DD>."}`, naming the first held night, and the block returns to its old place.

These checks run in the order stay state, then `version`, then held night. On screen, conflicts appear in `Desk notices`.

**Room moves.** A whole-stay move, sent with no `fromNight`, changes the room for every night of a booked stay. For an in-house stay, a move with no `fromNight` means a move from the business date, so posted nights stay on the old room. A move from a chosen night keeps earlier nights on the old room and moves that night and later; the chosen night must be a night of the stay and not before the business date. An in-house stay with no night left from the business date on answers 422 on `fromNight`.

An `M` drop always sends `roomId`. For a booked stay it adds `arrival` only when Left or Right changed the dates, and it never sends `fromNight`. For an in-house stay it sends `fromNight` set to the business date. Worked example: an in-house stay in room 101, arrival 2027-03-05, departure 2027-03-08, business date 2027-03-06, moved to room 102 by `M`, has two `segments`: room 101 with `firstNight` 2027-03-05 and `nights` 1, and room 102 with `firstNight` 2027-03-06 and `nights` 2. The timeline shows one block for each, with those `data-first-night` and `data-nights` values. If the arrival is the business date, the stay has one segment, on the new room.

A move with `arrival` keeps the stay's length: the new departure is the new arrival plus the stay's nights, and the whole stay lands on `roomId`. Worked example: `Flexible`, 1 guest, arrival Monday 2027-03-08, 2 nights, at the default tax rate, moved to arrival Friday 2027-03-12, has departure 2027-03-14 and reprices each night to room 15000, tax 1313, city 200, stay total 33026. Only a move with `arrival` changes nightly prices, as stated under Price changes. No move changes already-posted charges, and posted entries keep the room number they were posted for. When a move takes an in-house guest out of the room holding the business date, the target must be clean or inspected, otherwise `409 {"error":"Room <number> is <status> and cannot take an in-house guest."}`, and the room being left becomes dirty. A move starting on a later night, or of a booked stay, changes no room status.

**Room status.** Statuses are dirty, clean, inspected and out of order.

| Move | Allowed for |
|---|---|
| dirty to clean | housekeeper, front desk, owner |
| clean to inspected | front desk, owner |
| clean or inspected to dirty | housekeeper, front desk, owner |
| dirty, clean or inspected to out of order | owner |
| out of order to dirty | owner |

Any other move, including to the same status and any move by a role not listed, answers `409 {"error":"That room status change is not allowed."}`.

**Free rooms.** The count is rooms that are not out of order and have no stay holding the business date.

**Cancellation.** Free cancellation ends at 18:00:00 hotel local time on the date before arrival, exclusive: at 17:59:59 the fee is 0; at exactly 18:00:00 and later the fee is the first night's total (room, tax and city tax). A no-show pays the same fee. The stay shows `Free cancellation until <YYYY-MM-DD> 18:00` or `Late cancellation fee: $<amount>`. Worked example: the 3-night `Flexible` stay above, arrival 2027-03-11: at 2027-03-10T17:59:59-06:00 the fee is $0.00; at 2027-03-10T18:00:00-06:00 the fee is $155.80. A fee posts as one charge entry; a zero fee posts nothing. The fee on a tax-rate-affected first night follows that night's rate.

**Folios.** Each stay has one or more folios named by letter in order, `Folio A`, then `Folio B`, then `Folio C`, up to `Folio Z`. Entries are charges and payments. Balance is charges less payments. Payment descriptions are `Cash payment` and `Card payment <reference>`.

- *Reversal.* Corrections are reversal entries that reference the original, with the same kind, the negated amount and the description `Reversal of <description>`, on the original's folio. An entry is never edited or deleted.
- *Moving an entry.* This changes only the folio it sits on; its id, date, description and amount stay, and the stay's total across folios stays exact.
- *Splitting.* Splitting one charge by percent gives each folio its share in cents, rounded down, then the remainder cents are given one at a time to the folios in letter order, starting with `Folio A`. Worked examples: 3333 split 50/50 gives 1667 and 1666; 1003 split 50/25/25 gives 502, 251 and 250. Each sum is exact. A split posts one reversal of the charge on its folio, then one share entry per payer described `<description> (<percent>%)` with `splitOfEntryId` set. Shares go to the stay's folios in order, and missing folios are created with the guest as payer.
- *Refusals.* An entry that is a reversal, already reversed or already split answers `409 {"error":"This entry cannot be changed again."}`. A payment sent to split answers the same. Any write to a closed folio answers `409 {"error":"This folio is closed."}`.
- *Closing.* A folio closes only with balance 0, otherwise `409 {"error":"This folio still has a balance of $<amount>."}`. A folio with no entries answers `409 {"error":"This folio has no entries."}`. Closing issues the invoice.

**Invoices.** Numbers are `INV-000001` upward per hotel, with no gaps: the number is taken in the same transaction that confirms the render and the store, so a failed render consumes none. An open folio shows `Draft`; a closed one shows `Issued`. Mail state is `Not sent` or `Sent`. The folio shows `Issued` only after the PDF is stored, and `Sent` only after the mail provider accepts the message. Emailing again resends and stays `Sent`.

The PDF carries these exact text lines:

- `Invoice <number>`
- the hotel's name
- `Bill to: <name>`
- `Stay: <arrival> to <departure>`
- `Room <number>`, being the room of the stay's last night
- one line per entry, `<date> <description> $<amount>`, in posting order
- `Total: $<amount>`, the folio's charges
- `Paid: $<amount>`, the folio's payments
- `Balance: $0.00`

**Guest online check-in.** Creating a stay emails a link. The link's lifetime is `CHECKIN_LINK_TTL_SECONDS` from sending, by the hotel's clock: valid before, dead at exactly that second. Completion ends it, as does cancellation or any other change that leaves the stay no longer booked. Sending a new link kills the old one, and a new link's lifetime starts from its own sending; the new link replaces the old only once the provider accepts it. Asking for a new link once the stay is not booked answers `409 {"error":"This stay is no longer waiting for check-in."}`. Completed stays likewise.

A dead or unknown link answers 404 on the page and on the API, with the text `This check-in link is no longer valid.`. Tokens are unguessable and open only their own stay.

**ID photo.** JPEG or PNG judged by file content, not extension; at most `ID_PHOTO_MAX_BYTES` bytes, the limit itself allowed. Larger answers `413 {"error":"That photo is too large."}` and any other type answers `415 {"error":"Please upload a JPEG or PNG photo."}`, with size judged first. The stored image has EXIF removed and still decodes with the same pixel dimensions. A new upload replaces the earlier photo.

**Guest merge.** The owner or front desk picks a surviving profile and a merged one. The fields are name, email, phone, company and address. An empty survivor field takes the other value. When both differ, `Merge conflicts` shows both values with a radio group per field, defaulting to the survivor's. Stays and folios move to the survivor; folio payer names stay as set. Issued invoices keep the bill-to name as issued. The merged profile answers 404, and a later merge naming it does too.

**Field visibility.** Housekeepers see room, dates and status only: never a guest's name, email, phone, ID or balance, on any page, API response or push message.

**Reports.** For a chosen date range, inclusive, and over its nights:

- Rooms available = rooms less rooms out of order that night. A closed night uses the count fixed at its close; an open night uses rooms out of order now.
- Rooms sold = stays holding that night, excluding cancelled and no-show.
- Room revenue = room amounts for those nights, before tax and city tax; no-show and cancellation fees are excluded. Nights with a posted line use the posted amount; other nights use the booked nightly amount, so a stay change updates the figures live.
- Occupancy = sold / available, as a percent to one decimal, half up.
- Average daily rate = revenue / sold, half up to a cent.
- Revenue per available room = revenue / available, half up to a cent.

Range figures divide summed revenue, sold and available. In `GET /api/reports`, each entry of its `nights` and `CloseResult.figures`, `occupancy`, `averageDailyRate` and `revenuePerAvailableRoom` are JSON strings holding the text shown on screen, never numbers or null; `roomsAvailable` and `roomsSold` are integers and `roomRevenueCents` is integer cents. A value whose divisor is 0 shows, and returns, the string `—`. With 0 sold and some rooms available, occupancy is `0.0%`, average daily rate is `—` and revenue per available room is `$0.00`. With 0 available, occupancy and revenue per available room are `—`, and average daily rate still follows sold. Worked example, one night: 14 rooms, 1 out of order, 9 sold, revenue 123450: available 13, occupancy `69.2%`, average daily rate `$137.17`, revenue per available room `$94.96`, returned as the strings `"69.2%"`, `"$137.17"` and `"$94.96"`.

### Services (DP-21, DP-24, DP-41, DP-42, DP-43, DP-44, DP-45, DP-56)

**Postgres.** Holds rooms, rates, stays, nightly lines, folios and entries, invoice numbers, room statuses, guest profiles, closed-day figures and sessions, all intact after reload and restart.

**Gotenberg.** `POST $GOTENBERG_URL/forms/chromium/convert/html` with an `index.html` file renders each invoice. The reply body is the PDF.

**MinIO.** Private bucket `S3_BUCKET`. Invoice PDFs at `invoices/<hotel id>/<invoice number>.pdf`, for example `invoices/h1/INV-000001.pdf`. ID photos at `id-photos/<hotel id>/<stay id>`.

**Mailpit.** SMTP at `SMTP_HOST` and `SMTP_PORT`, From taken from env `MAIL_FROM`.

- Check-in message: to the guest's email, exact subject `Check in for your stay at <hotel name>`, plain text body containing the line `Check in here: <url>`, where `<url>` is `APP_PUBLIC_URL` when set, otherwise the request's origin, followed by `/checkin/<token>`.
- Invoice message: to the folio's payer email, exact subject `Invoice <number> from <hotel name>`, body line `Your invoice <number> is attached.`, with the PDF attached as `application/pdf`, file name `<number>.pdf`.

**Outages.** Services are read per call and a provider down at boot does not stop the app. A provider call that cannot connect fails within 5 seconds. Each row below applies to the action named, with nothing half-saved, and the next attempt succeeds once the service returns, with no restart. All copies of the app sharing a database share data and sessions; a test may break one dependency on one copy and repeat the same action on another copy.

| Service down | Action | Status | Body and visible text | Afterwards |
|---|---|---|---|---|
| Gotenberg | Close folio | 503 | `The invoice could not be created. The PDF service is unavailable. Nothing was saved.` in `Folio status` | No number consumed, folio open, `Draft` |
| MinIO | Close folio | 503 | `The invoice could not be created. The file store is unavailable. Nothing was saved.` in `Folio status` | No number consumed, folio open, `Draft` |
| MinIO | Photo upload | 503 | `Your photo could not be saved. Please try again.` in `Check-in status` | Not `Received`, check-in incomplete, link alive |
| MinIO | Download invoice, view ID photo | 503 | `The file store is unavailable.` | Nothing changes |
| Mailpit | Email invoice | 503 | `The invoice could not be emailed. The mail service is unavailable.` in `Folio status` | `Issued`, `Not sent` |
| Mailpit | Resend link | 503 | `The check-in link could not be sent. The mail service is unavailable.` in `Desk notices` | Earlier link, if any, unchanged |
| Mailpit | Create stay | 201 | Stay created with `checkinLinkState` `not_sent`; combined text from Feedback states | `Resend check-in link` sends it |

The body of each 503 is `{"error":"<the text above>"}`.

**Health.** `GET /api/health` answers `{"status":"ok"}` when Postgres, Gotenberg, MinIO and SMTP all answer a short probe, and `{"status":"unavailable"}` when any does not, always with status 200 and never 503.

### Seed data (DP-11, DP-14, DP-59)

Every seeded person and business is invented. Apply this once at first start, leaving existing records alone at later starts, for a first look and manual use. Tests create their own hotels through the grading route. `D` is the business date at first start. Seeding sends no email.

**Hotel.** `The Larkspur Inn`, time zone from `HOTEL_TIME_ZONE_DEFAULT`, default tax rate, `Flexible` and `Corporate`.

**Users** (password in brackets).

- `owner@larkspur.example` Wren Abara, owner (`night-owner-2027`)
- `desk@larkspur.example` Theo Marsh, front desk (`night-desk-2027`)
- `desk2@larkspur.example` Lena Fisk, front desk (`night-desk2-2027`)
- `rooms@larkspur.example` Ivo Pell, housekeeper (`night-rooms-2027`)

**Rooms** (14).

- 101 Queen, 102 Queen, 103 King
- 104 King (dirty)
- 105 Twin, 201 Queen, 202 Queen, 203 King, 204 Twin
- 205 Suite (out of order)
- 301 Queen (inspected)
- 302 King, 303 King, 304 Suite

All not marked are clean.

**Stays.**

| Guest | Email | Room | Arrival | Departure | Plan | Guests | Status |
|---|---|---|---|---|---|---|---|
| Mara Okafor | mara@guests.example | 101 | D−1 | D+2 | Flexible | 2 | in_house |
| Tomas Lindqvist | tomas@guests.example | 103 | D−1 | D+1 | Corporate | 1 | in_house |
| Ines Duarte | ines@guests.example | 202 | D | D+2 | Flexible | 1 | booked |
| Priya Raman | priya@guests.example | 302 | D | D+1 | Flexible | 2 | booked |
| Callum Reyes | callum@guests.example | 105 | D+1 | D+4 | Flexible | 3 | booked |
| Hana Sato | hana@guests.example | 304 | D+2 | D+9 | Corporate | 2 | booked |
| Sam Whitlock | sam@guests.example | 201 | D+3 | D+5 | Flexible | 1 | booked |
| Samuel Whitlock | samuel@guests.example | 204 | D−3 | D−1 | Flexible | 1 | checked_out |

The two in-house stays have night D−1 posted to `Folio A` by the published rates, and D−1 is a closed night whose figures feed `Tally rail`. Tomas Lindqvist also has an empty `Folio B` with payer `Brightwell Surveying Ltd`, `accounts@brightwell.example`.

**Second hotel.** `Quarry Lane Rooms`, with owner `owner@quarrylane.example` (`quarry-owner-2027`) and rooms 1 and 2.

## Technical requirements

### Deployment (DP-56, IF-01)

The runtime is Node.js with npm, and the language is TypeScript. `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

Bind `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT` when set. `/api/health` behaves as published in Services. Apply the schema idempotently on serve, not only at build, and safely when several copies of the app start against one database at the same moment.

### Configuration and secrets (DP-55, DP-60)

Read at start, never hard-code and never send to the browser: `DATABASE_URL`; `GOTENBERG_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`; `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`.

Settings with the values used in every environment unless a copy overrides them:

| Name | Default | Meaning |
|---|---|---|
| `GRADING_KEY` | `nightroll-grading-5c1e7a` | Header value for the grading routes |
| `HOTEL_TIME_ZONE_DEFAULT` | `America/Chicago` | Zone for a hotel created without one |
| `CHECKIN_LINK_TTL_SECONDS` | `259200` | Link lifetime in seconds |
| `ID_PHOTO_MAX_BYTES` | `5000000` | Largest allowed photo in bytes |
| `LIVE_MAX_DELAY_MS` | `2000` | Longest time in milliseconds for a pushed change to reach a screen |
| `MAIL_FROM` | `Nightroll Desk <desk@nightroll.example>` | From line on every message |

### Server boundary (DP-54, DP-58)

The app is same-origin only and sends no cross-origin permission headers. A state-changing request whose `Origin` header names another origin answers `404 {"error":"Not found."}`. Session cookies are HTTP-only, SameSite=Lax. Passwords are stored as salted hashes.

The server never serves source files, environment files, dependency manifests, credentials or the repository, and any such path answers 404. The photo route does not hold more than `ID_PHOTO_MAX_BYTES` plus form overhead before answering. Bucket objects are never linked or redirected to the browser; they pass through the app's own routes after the role check. A dependency unreachable at boot is treated as in Services.

### Browser support and performance (DP-31, DP-34, DP-55, DP-57)

Support current Chromium, Firefox and Safari at 375x812, 768x1024 and 1280x800. With the seed data the desk is usable within three seconds of navigation.

Published test conditions: pages under test run with a paused browser clock that the test advances, and with service workers blocked. App behaviour needing a browser timer, such as a debounce, a delayed refresh or a motion's end, completes when that clock advances. Server decisions never read the browser clock, and the device clock may be wrong. Server answers, announcements and pushed changes appear with no browser timer in the path.

## Working rules

- **IF-01** `/app/run.json` exists with the string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- **IF-02** `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence, where shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- **IF-03** Shipped packages use only the licences MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, MPL-2.0, BlueOak-1.0.0, CC0-1.0, Unlicense or LGPL-3.0-or-later, judged on the production dependency tree (`npm ls --omit=dev --all --json`).
- **IF-04** The app uses only Postgres, MinIO, Mailpit and Gotenberg, with no other datastore, broker or hosted service.
- **IF-05** The app loads no font, image, script or stylesheet from another origin, and ships no font files.
- **IF-06** The provided service configuration and environment values stay as supplied, and no credential appears in the source.

## Engineering standards

- TypeScript is idiomatic and type-checked: domain values use named types, and `any` appears only where a third-party type leaves no alternative.
- Names in the source match this brief's terms: stay, folio, entry, reversal, night, business date, close, room status, payer.
- Each domain rule, such as a stay transition, a night's price, a folio split, a business-date decision or a report figure, is decided in exactly one place in the source and reused everywhere it is shown.
- Amounts are integer cents in every calculation, and no floating-point value decides a charge, tax, share or figure.
- No abstraction has a single implementation, and no features exist beyond this brief.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the rules already make impossible.
- Every API error comes from one error shape, built in one way.
- Role field lists for responses and push messages are explicit allow-lists, so a new field stays private until added.
