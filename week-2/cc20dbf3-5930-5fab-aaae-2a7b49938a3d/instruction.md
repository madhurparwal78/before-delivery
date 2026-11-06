# Common Shed Co. Shedline

Shedline is the lending desk for a small neighbourhood tool library: a library of things where members borrow power tools, ladders and garden kit, pay a refundable deposit on costly items, collect within a short pickup window and bring things back for a condition check. Build it for three kinds of people. The founder-librarian runs the library and keeps the money exact. Shift volunteers work the counter. Members borrow now and then. Shedline keeps its records in PostgreSQL. It records every deposit, release, charge beyond a deposit and late fee in Kill Bill. It keeps checkout and return condition photos in S3-compatible object storage (MinIO) and sends member email through an SMTP server (Mailpit in development and grading). The following are out of scope: self-service sign-up, membership dues and subscription plans, editing the catalogue, the calendar or fee policy (all three arrive as seed data, including the closure dates, the dated late-fee schedule and the borrowing limit), card payments, waitlists, multiple branches, and any datastore beyond those four services.

## Problem and users

Small tool libraries usually run out of a garage, church basement or shipping container. One founder and a few weekend volunteers keep them going. They lend a few hundred items, and many come in several identical units: three pressure washers, two tile saws. Members reserve online and collect within a short window. They pay a refundable deposit on high-value items and are expected to bring each tool back washed out, with its batteries charged. Staff then inspect the item and either release the deposit or keep some or all of it for damage. When the damage costs more than the deposit, the rest is billed separately, up to the item's replacement value. Late fees are charged per item per open day at the rate the library has posted, and they stop at the item's replacement value. When the posted rate changes, every late day is still priced at the rate that applied on that day. The library is closed on Mondays and on a few public holidays, and closed days never count. Members may renew a loan once for up to a week if nobody else has the unit booked, and may have only a few items held or out at once.

Hosted tools tend to put refundable deposits on paid tiers and leave inspection to paper checklists. As a result, founders:

- reconcile deposits by hand;
- argue over "it was already scratched" with no photo from checkout;
- lend the last tile saw to two people who reserved it within seconds of each other;
- see two volunteers hand over the same reserved pressure washer and take the deposit twice;
- charge late fees that disagree with the posted closing time, the holiday closures or the rate in force at the time.

Members who keep an item past its due time hold up everyone else's projects.

- **Founder-librarian** (daily): oversees the catalogue and lending, settles every returned loan, decides damage disputes from photos, and needs every deposit, release, damage charge, extra charge and late fee to match across the screen, the email and the billing system.
- **Shift volunteer** (weekly): works the counter. Prepares requested holds, lends items, records paper-sheet loans, renews loans, photographs condition at checkout and return, checks items in and records an inspection. Several volunteers may work at once from different counter devices and phones.
- **Member** (occasional): finds a free unit for a weekend project, reserves it, collects it within the pickup window, renews it once if needed, returns it and gets the deposit back. Regular members build up a long loan history. A member sees their own records and never sees other members' records. A member with an item overdue cannot borrow anything else until they bring it back. A member at the borrowing limit must free a slot first.

## Journeys

1. **Hold a tile saw.** Hal, a member with nothing overdue and fewer items than the limit, is signed in and looking at the catalogue. Hal opens the wet tile saw, sees its two unit lanes covering the next 28 days, and picks a pickup date and a return date. Closed days cannot be chosen. The availability numeral shows how many units are free for those dates. Hal presses Hold a unit. A claim bar drops down the lanes, pauses on any lane already busy for those dates, and settles in the lane of the unit the server gave Hal. The free count ticks down to the figure the server reported, and the result line names the unit. The hold then shows as Requested under My loans. When Mina and four neighbours press Hold a unit for the same pressure-washer weekend at once, the three who land each see a different count of units still free, ending at zero, and the catalogue agrees.
2. **Prepare and collect.** Dev, a volunteer, opens the Counter and sees Hal's hold under Holds to prepare. Dev marks it ready. Hal gets a pickup email with a deadline in library time, and My loans shows the hold as Ready with that deadline. If nobody collects it before the deadline, the hold lapses on its own and Hal gets a lapse email. The unit's lane frees for other members without anyone loading a page.
3. **Lend at the counter, from two devices.** Hal arrives. Dev and Ines both see the ready hold on their counter screens and both press Check out at the same moment. One of them sees "Lent to Hal Brennan" with the due time. The other is told the hold is already collected. Exactly one loan exists, and one deposit has been taken in billing. Dev opens the loan, photographs the saw from a phone, and the photos appear under Checkout photos. When Dev and Ines both photograph the same tool at once, the panel never holds more than four photos and nothing stray is left in storage.
4. **Paper-sheet loan and one renewal.** The counter laptop was down on Sunday, so Ines enters a loan from the paper sheet. Ines picks the member (Wren), the unit, the due date and the checkout time written on the sheet, then presses Lend now. The loan appears under Out on loan, and Wren gets a due reminder. Wren needs the ladder a few more days, opens the loan page and renews it to a later open day. The loan page shows the new due time, and Wren gets one reminder for the new time. A second renewal is refused because the loan has already been renewed once. Had another member's hold for those extra days landed first, the renewal would have been refused because the unit is busy.
5. **Paused and at the limit.** Sol has a drill that is overdue. Sol tries to hold the laser level. The claim bar drops past the last lane and fades, with the message that borrowing is paused. At the counter, Dev's walk-in loan to Sol is refused with the same message. Once Dev checks the drill in, Sol can place a hold straight away. Tobi already has four items held or out. Tobi's fifth hold is refused with the borrowing-limit message, and pressing several times never gets past four. As soon as Tobi cancels a hold, or a ready hold's pickup window closes, a new hold goes through.
6. **Check in, inspect and settle.** A member returns a pressure washer. Dev finds it in the drop bin with a time noted while Ines checks the same one in at the counter. One of them records the return and the other is told it is already returned. Dev opens the loan, sees whether it came back on time, adds return photos, chooses OK or Damaged with a note, and saves the inspection. Rosa, the founder, opens the inspected loan and compares checkout and return photos side by side. Rosa presses Settle, enters the damage charge and confirms. A floor sander whose drum is ruined costs more than its deposit, so the whole deposit is kept and the rest is billed once as a separate charge. A loan that ran late across the 1 September rate change is charged the old rate for its August late days and the new rate for its September ones. Closed days and the spring clock change are counted correctly. The receipt figures appear on screen, the member gets a receipt email with the same figures, billing holds the same amounts, and the Deposit ledger shows the loan's deposit entries netting to zero.
7. **Billing goes down mid-shift.** The Counter banner reports that billing is offline. Ready holds for items with a deposit show as blocked with the reason, and their Check out button is disabled. A checkout sent anyway is refused with the plain billing-offline message every time it is retried, and it never gets stuck as "still processing". The tile saw's lane, the free counts and the deposits-held figure stay exactly as they were. Items without a deposit still lend. Rosa's settlement attempt is refused the same way and the loan stays inspected. Once billing returns, the banner clears, and the same checkout and the same settlement each go through exactly once, with no restart.
8. **Look back over my borrowing.** Juno borrows most weekends. Juno opens My loans, sees the most recent twenty loans, and presses Show more loans until the whole history is listed. Every past loan appears exactly once, even though a volunteer lends Juno something new partway through. Juno opens a past loan, views its condition photos and reads the receipt. Changing the loan id in the address bar to another member's loan shows the same Not found page as an id that does not exist. Hal presses Cancel hold on a ready tile saw just after Dev handed it over. The row ends up showing Collected with the reason, and it never shows Cancelled.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** /app/run.json names the install, build and serve commands, and the server answers GET /api/health with HTTP 200 {"status":"ok"} on port 4173 or APP_PUBLIC_PORT, even while billing or photo storage is down.
- **DP-02 — Services wired from the environment** Every service URL and credential is read from the environment variables listed in Configuration and secrets, all state lives in the four named services, and no credential is hard-coded or sent to the browser.
- **DP-03 — Sign-in and roles** Seeded people sign in with email and password, receive an HttpOnly session cookie, and can use only the screens and actions of their role (member, volunteer or founder) as set out in API.
- **DP-04 — Error shape and precedence** Every API error uses the one error body and the one precedence order stated in API.
- **DP-05 — Server boundary** The server accepts only same-origin state changes within the stated body limits and never serves source files, configuration or credentials, as qualified in Server boundary.
- **DP-06 — Catalogue** Signed-in users see every seeded item with its deposit, replacement value, unit count and units free today.
- **DP-07 — Unit lanes** Each item shows one 28-day lane per unit, marking every busy span as held, out or overdue together with the open day the unit is back.
- **DP-08 — Lane fields by role** Members see only when each unit is busy and back plus whether a span is their own, staff also see the borrower's name, and nobody sees contact details in lanes.
- **DP-09 — Browse journey** A member opens an item from the catalogue, sees its unit lanes, and picks pickup and return dates to see how many units are free for that range.
- **DP-10 — First free lane** A hold that passes the borrowing checks in Business rules claims the lowest-numbered unit that is free on every day of the chosen range and returns that unit with the new free count.
- **DP-11 — One winner for the last unit** When several members claim the last free unit for overlapping dates at the same moment, exactly one hold is created and every other claim gets the no-unit-free conflict.
- **DP-12 — Hold dates** A hold's pickup and return dates must be open days, closure dates excluded, within the booking horizon and loan length set out in Business rules, or the hold is rejected with field errors.
- **DP-13 — Hold replay** Repeating a hold request with the same Idempotency-Key returns the original response without claiming a second unit, and reusing the key with a different body is rejected.
- **DP-14 — Lane drop** After a hold request, a claim bar steps down the lanes, pauses on busy ones and settles in the lane of the unit the server assigned while the units-free numeral counts down, or drops past the last lane on any refusal, as detailed in Motion and effects.
- **DP-15 — Reserve journey** A member picks dates, holds a unit, hears and sees the held unit and remaining free count, and finds the hold under My loans.
- **DP-16 — Hold states** Holds move only along the requested, ready, collected, expired and cancelled paths set out in Business rules, and every other move is rejected with the invalid-transition conflict.
- **DP-17 — Ready notice** Marking a hold ready emails the member once with the item, the unit and the pickup deadline in the library's time zone.
- **DP-18 — Pickup window expiry** A ready hold not collected by its pickup deadline expires on the server, frees its unit and emails a lapse notice without any page load, within the delay qualified in Business rules.
- **DP-19 — Pickup journey** A volunteer marks a requested hold ready from the Counter and the member then sees the hold as ready with its pickup deadline.
- **DP-20 — Counter checkout** Staff turn a ready hold into a loan due on the hold's return date for a member whose borrowing is not paused, and repeating the checkout with the same Idempotency-Key changes nothing.
- **DP-21 — Deposit hold in billing** Checking out an item with a deposit creates the loan, exactly one deposit purchase on the member's Kill Bill account and exactly one deposit-hold ledger entry together, or none of them.
- **DP-22 — Counter checkout journey** A volunteer checks out a ready hold, sees the borrower's name and due time, and the loan appears under Out on loan.
- **DP-23 — Walk-in and back-timed loans** Staff lend a free unit directly to a member who passes the borrowing checks, optionally back-timed to the moment written on the paper sheet, and a unit busy on any of those days is refused.
- **DP-24 — Due reminder** Each loan still out receives exactly one due reminder email for its due time once it comes within the reminder lead time of that due time.
- **DP-25 — Photo type and size** Condition photos are accepted only as JPEG, PNG or WebP judged by content and only up to the published byte limit, and anything else is rejected with nothing stored.
- **DP-26 — Server-named photo storage** Each accepted photo is stored in the bucket under a server-generated key tied to its loan and stage, never under the device's file name.
- **DP-27 — Photo storage outage** When photo storage is down, photo uploads and downloads answer the photo-storage outage error while every other loan action keeps working.
- **DP-28 — Photo capture journey** A volunteer adds checkout photos after lending and return photos after check-in, and each photo appears in the loan's matching photo panel.
- **DP-29 — Due at posted closing time** A loan is due at the library's closing time on its due date in the library's time zone, so a return at or before that instant is on time, including across clock changes.
- **DP-30 — Return and inspection** Staff check a loan in and then record an OK or damaged inspection, and each step is allowed only from the state set out in Business rules.
- **DP-31 — Check-in journey** A volunteer checks in a loan, sees whether it came back on time, adds return photos and saves the inspection.
- **DP-32 — Late days and late-fee cap** The late fee counts late days from the missed closing instants, is capped at the item's replacement value in whole cents, and is fixed once at settlement, as set out in Business rules.
- **DP-33 — Settlement amounts** Settling a loan splits its deposit into a released part and a part kept for damage that sum exactly to the deposit, and adds the late fee, as set out in Business rules.
- **DP-34 — Settlement in billing once** Each settlement records its deposit release, any charge beyond the deposit and any late fee in Kill Bill exactly once, a retry completes missing records without duplicates, and a replay with the same Idempotency-Key changes nothing.
- **DP-35 — Settlement receipt email** Each settlement emails the member exactly one receipt whose figures match the settlement response and the billing records.
- **DP-36 — Deposit ledger** The founder sees every deposit hold, release, damage charge, extra damage charge and late fee as a ledger entry, each settled loan's deposit entries net to zero, and the deposits-held figure equals the deposits of loans not yet settled.
- **DP-37 — Dispute and settle journey** The founder opens an inspected loan, compares checkout and return photos side by side, enters a damage charge, settles, and then sees the receipt figures.
- **DP-38 — Own records only** A member asking for another member's hold, loan, photo or receipt gets the same not-found answer as for an id that does not exist.
- **DP-39 — Member records journey** A member opens My loans, pages back with Show more loans, opens a loan's photos and its receipt, and sees only their own holds and loans, each listed once.
- **DP-40 — Lending while billing is down** While billing is unreachable, items without a deposit still lend, deposit items are refused and shown blocked with the reason, and lending resumes without a restart once billing returns.
- **DP-41 — Settling while billing is down** While billing is unreachable, a settlement that needs a billing record leaves the loan inspected with no ledger entry and no email, as qualified in Business rules, and the same request succeeds once billing returns.
- **DP-42 — Responsive layout** Every screen fits viewports 375, 768 and 1280 pixels wide with no horizontal scrolling and with tap targets at least 44 pixels in both directions.
- **DP-43 — Keyboard and focus** Every control can be reached with Tab in reading order and shows a visible focus ring, and the settlement dialog keeps focus inside, closes on Escape and returns focus to its opener.
- **DP-44 — Workshop look** Screens use the pegboard ground, ink-ruled boxes, uppercase mono labels, and status shown as both a word and a fill pattern, as described in Visual design.
- **DP-45 — Motion and reduced motion** Only the motions named in Motion and effects run, none loops for decoration, and under reduced motion each one is replaced by its stated substitute.
- **DP-46 — Racing checkouts** When two volunteers check out the same ready hold at once, exactly one loan, one deposit purchase and one deposit-hold entry exist, and every other attempt gets the invalid-transition conflict with nothing billed.
- **DP-47 — Late-fee rate history** Each late day is charged at the rate in force on that day's local date from the seeded schedule, the sum is capped at the replacement value, and the screen, email, ledger and billing show the same total.
- **DP-48 — Paged history** Holds and loans lists page by cursor with a page size from 1 to 50 (default 20), and every record present when the first page is read appears exactly once across the pages, only the caller's own for a member, even while records are added.
- **DP-49 — Retry through an outage** A checkout or settlement refused because billing is down can be retried with the same Idempotency-Key, gets the same outage answer each time, and completes exactly once with that key after billing returns.
- **DP-50 — Borrowing pause** A member with any loan overdue now cannot place a hold or receive a loan and gets the borrowing-paused conflict, which starts the instant a due time passes and lifts at check-in, as set out in Business rules.
- **DP-51 — Closure dates** The seeded closure dates are not open days anywhere: hold dates, walk-in and renewal due dates, the day a unit is back and late-day counting all skip them.
- **DP-52 — Borrowing limit** A member never has more than 4 holds and loans active at once, even under simultaneous requests, and a slot frees the instant a hold is cancelled, a loan is checked in or a pickup deadline passes, as set out in Business rules.
- **DP-53 — Free count at commit** Each successful hold reports the free count for its dates right after its own claim, so racing winners report distinct counts ending at zero and the catalogue and lanes agree afterwards.
- **DP-54 — Photo cap under simultaneous uploads** Simultaneous uploads never take a stage past 4 photos, the bucket holds exactly one object per photo record, and a refused upload leaves no object and no record.
- **DP-55 — One check-in and one inspection** Among simultaneous check-ins or inspections of the same loan exactly one succeeds, the stored values are the winner's, and every other attempt gets the invalid-transition conflict.
- **DP-56 — Late days across the spring clock change** Each late day's closing instant uses that date's own offset, so a return after the 18:00 daylight-time closing on the Tuesday after the March clock change counts that Tuesday as late.
- **DP-57 — Damage beyond the deposit** A damage charge up to the replacement value takes what it can from the deposit and bills the remainder once as a separate charge, with the released, kept and extra amounts adding up exactly.
- **DP-58 — Settlements one at a time** Simultaneous settlement attempts for one loan with different Idempotency-Keys are decided one after another, so billing, the ledger and the receipt email each record the settlement once.
- **DP-59 — Honest Cancel hold** A member's hold row changes only after the server answers Cancel hold, and a refused cancel shows the hold's real state with the reason, never Cancelled.
- **DP-60 — Opaque outage answers** Every outage answer carries only the published code and message with no provider address or error text, and a refused checkout or walk-in changes no free count, lane, span or deposits-held figure.
- **DP-61 — Renew once** The borrower or staff can renew a loan that is out once, to an open day at most 7 days after its due date, never billed, and a renewal racing another member's hold for the extension days has exactly one winner.
- **DP-62 — Reminder per due time** A renewed loan receives one due reminder naming its new due time when that time comes within the reminder lead time, and the old due time's reminder is never sent again.

## Frontend

### Screens and layout (DP-06, DP-07, DP-09, DP-15, DP-19, DP-22, DP-28, DP-31, DP-37, DP-39, DP-42, DP-61)

Every signed-in screen has a header band with the wordmark "COMMON SHED CO." and the main navigation. The screens and their addresses:

- **Sign in** (`/`): one boxed form. Anyone already signed in is sent on: members to `/catalogue`, staff to `/counter`.
- **Catalogue** (`/catalogue`): one hard-ruled card per item showing its name, category, deposit (or "No deposit"), replacement value and "<free today> of <unit count> free today", plus a small preview of its unit lanes for today.
- **Item** (`/items/<item id>`): the item card (name, category, deposit, replacement value), the pickup and return date fields with the Hold a unit button, the Availability numeral, and the unit lanes stacked below as horizontal 28-day strips, one per unit in lane order. Each lane begins with its unit label in mono ("UNIT TS-1"). Each strip has 28 day cells starting today in library time, with a date marker every seventh day. Closed days (Mondays and closure dates) are shown as narrow grey-ruled cells marked "closed" for assistive technology. Busy spans fill their cells with their status pattern. The lane's summary line spells out the status word and "back <date>" so that narrow spans stay readable.
- **My loans** (`/my-loans`, members only): a Holds list and a Loans list. Each list shows its first page and grows in place with its Show more button. Each row gives the item, unit, dates, status word with pattern chip, and the pickup deadline for ready holds. Each loan links to its loan page.
- **Loan** (`/loans/<loan id>`): heading "<item name>, unit <label>", the status word, borrower name, checkout time, due time (marked "renewed" once renewed), return time and deposit. Below these sit two photo panels, Checkout photos and Return photos, followed by the inspection and, once settled, the receipt. The owner and staff see the renewal controls while the loan is out and not yet renewed. Staff also see the photo upload, check-in and inspection controls. The founder sees Settle on inspected loans. An id the viewer may not see renders the Not found page.
- **Counter** (`/counter`, staff only): the Counter services banner on top, then four boxed sections: Holds to prepare, Ready for pickup, Walk-in loan and Out on loan. Rows name the borrower, item, unit and dates. Out on loan rows link to the loan page.
- **Deposit ledger** (`/ledger`, founder only): the line "Deposits held now: <money>" above a table of ledger entries, oldest first.
- **Not found**: the heading "Not found" and a link back to the viewer's home screen. It is identical for missing ids and for ids the viewer may not see.

Viewports (no screen may scroll sideways in any of them):

- **1280×800**:
  - The page uses a 12-column grid.
  - Catalogue cards sit three to a row.
  - On Item, the item card takes four columns and the lanes take eight.
  - Counter shows Holds to prepare, Ready for pickup and Out on loan as three columns, with Walk-in loan full width below.
  - My loans shows Holds and Loans side by side, at five and seven columns.
  - On Loan, the photo panels sit side by side, six columns each.
- **768×1024**:
  - Catalogue cards sit two to a row.
  - On Item, the card sits above full-width lanes.
  - Counter uses two columns.
  - My loans stacks Holds above Loans.
  - Loan photo panels stay side by side.
- **375×812**:
  - Everything is a single column.
  - The navigation collapses behind the Menu button.
  - Lanes run full width with 28 narrow day cells and a date marker every seventh day.
  - Loan photo panels stack, with Checkout photos above Return photos.
  - The settlement dialog fills the width with a margin.

### Public screens and controls (DP-03, DP-09, DP-14, DP-15, DP-19, DP-22, DP-23, DP-28, DP-31, DP-37, DP-39, DP-40, DP-43, DP-48, DP-59, DP-61)

Labels display in uppercase mono. The accessible names below are written as they must be exposed. Only these controls and regions are public; everything else is free.

| Screen | Role and accessible name | Visible content |
|---|---|---|
| All | link "Skip to content" | First focusable element, visible when focused |
| Signed in | navigation "Main" | links "Catalogue"; "My loans" (members); "Counter" (volunteer, founder); "Ledger" (founder) |
| Signed in | button "Sign out" | "Sign out" |
| 375 wide, signed in | button "Menu" | Shows and hides navigation "Main"; exposes expanded or collapsed |
| Sign in | heading "Sign in" (level 1); textbox "Email"; textbox "Password"; button "Sign in"; status "Form status" | |
| Catalogue | heading "Catalogue" (level 1); article "<item name>" per item, containing link "<item name>" | "<free today> of <unit count> free today", "Deposit <money>" or "No deposit", "Replacement <money>" |
| Item | heading "<item name>" (level 1) | |
| Item | date input labelled "Pickup date"; date input labelled "Return date" | |
| Item | button "Hold a unit" | |
| Item | region "Availability" | Large numeral `<free>` followed by "of <unit count> units free for these dates", or "of <unit count> units free today" before both dates are chosen |
| Item | region "Unit lanes" containing group "Unit <label>" per unit in lane order | Lane label, 28 day cells, and one summary line per busy span: "<status word> <start>–<end> · back <back on>". Staff add "· <borrower name>"; members see "· yours" on their own spans |
| Item | img "Claim bar" | Present while a claim plays and, after a successful claim, inside group "Unit <label>" of the assigned unit |
| Item | status "Claim result" | Lane drop announcement (Feedback states) |
| My loans | heading "My loans"; region "Holds"; region "Loans"; status "My loans status" | |
| My loans | listitem per hold inside region "Holds", whose accessible name begins "<item name>, unit <label>" and contains its status word; button "Cancel hold" on requested and ready holds | Ready holds show "Pick up by <local time>" |
| My loans | link "<item name>, unit <label>" per loan inside region "Loans" | Status word and due time |
| My loans | button "Show more holds" (last element of region "Holds"); button "Show more loans" (last element of region "Loans") | Present only while that list's `next_cursor` is not null |
| Loan | heading "<item name>, unit <label>"; region "Checkout photos"; region "Return photos" | Photos as img "Checkout photo <n>" and img "Return photo <n>", numbered by the photo-numbering rule in Business rules; "No photos yet" when empty |
| Loan, owner or staff | status "Renewal result" | |
| Loan, owner or staff, out and not yet renewed | date input labelled "New due date"; button "Renew" | |
| Loan, once settled | region "Receipt" | The receipt lines from Services, in the same wording |
| Loan, staff | file input labelled "Condition photo"; button "Add photo" | |
| Loan, staff, out or overdue | datetime input labelled "Returned at"; button "Check in" | "Returned at" defaults to now in library time |
| Loan, staff, returned | radiogroup "Condition" with radio "OK" and radio "Damaged"; textbox "Inspection note"; button "Save inspection" | |
| Loan and Counter, staff | status "Counter result" | |
| Loan, founder, inspected | button "Settle" | |
| Loan, founder | dialog "Settle loan" containing textbox "Damage charge", button "Confirm settlement", button "Cancel" | "Deposit held <money>" and "Replacement <money>"; the damage charge field takes dollars and cents |
| Loan, founder | status "Settlement result" | |
| Counter | heading "Counter"; status "Counter services" | |
| Counter | region "Holds to prepare" with button "Mark ready" per row | |
| Counter | region "Ready for pickup" with button "Check out" per row | Blocked rows show the blocked-row copy from Feedback states, and their button is disabled |
| Counter | region "Walk-in loan" containing combobox "Member", combobox "Unit", date input labelled "Due date", datetime input labelled "Checked out at", button "Lend now" | "Checked out at" is optional and empty by default |
| Counter | region "Out on loan" | One row per out or overdue loan with link "<item name>, unit <label>", borrower name, due time and status word |
| Ledger | heading "Deposit ledger"; table "Deposit ledger" with columns "Loan", "Item", "Kind", "Amount", "Recorded" | Kind words "Deposit hold", "Deposit release", "Damage charge", "Extra damage", "Late fee"; "Deposits held now: <money>" |
| Not found | heading "Not found" | |

The status words, each always paired with its fill pattern, are:
- **Lanes:** "Free", "Held", "Out", "Overdue".
- **Holds:** "Requested", "Ready", "Collected", "Expired", "Cancelled".
- **Loans:** "Out", "Overdue", "Returned", "Inspected", "Settled".

### Interactions (DP-09, DP-14, DP-15, DP-19, DP-22, DP-23, DP-28, DP-31, DP-37, DP-39, DP-43, DP-48, DP-59, DP-61)

- **Sign in**: Enter in either field submits. On success the browser goes to the role's home screen. On failure focus returns to Email and the error shows in Form status.
- **Choosing dates**: closed days cannot be picked. Changing Pickup date or Return date re-reads the lanes for that range. Lanes already busy for the range take the hatched fill in their busy cells. The Availability numeral jumps (no count animation) to the free count for the range. Hold a unit is enabled only when both dates are filled. Pressing Enter in either date field presses Hold a unit.
- **Hold a unit**: the button shows its pending copy and ignores further presses until the server answers. The browser sends one request with a fresh Idempotency-Key, and if the network drops it retries once with the same key. The lane drop then plays (Motion and effects), on success or on any refusal. Afterwards the lanes re-read so the new span shows as the member's own.
- **My loans, first load**: the page reads the first page of holds and the first page of loans at the default page size.
- **Show more holds / Show more loans**: pressing the button shows its pending copy and reads the next page using the cursor from the previous page. The new rows are appended below the existing ones in place. Focus then moves to the first newly added row (the hold's listitem, or the loan's link), and My loans status announces the count. The button disappears once the list's `next_cursor` is null.
- **My loans, refresh**: the page re-reads the first page of holds and loans every 15 seconds and merges rows by id:
  - a row already listed is updated in place;
  - a row new to the list is inserted in its sorted position;
  - rows loaded from later pages are kept.
  
  No row is ever shown twice or lost. Ready, Expired, Collected and Overdue therefore appear within 15 seconds of the change.
- **Cancel hold**: asks no confirmation. While the request is pending, the row keeps its current status word and pattern and the button shows its pending copy. Only a `200` answer turns the row to Cancelled. On a refusal, the row is re-read from the server and updated in place to the hold's real state (for example Collected), and My loans status shows the refusal copy. The row is never removed, and it never shows Cancelled unless the server answered `200`.
- **Counter**:
  - Mark ready and Check out act on their row and announce in Counter result. A row moves to its new section when the action succeeds.
  - When Check out is refused because another device already collected or cancelled the hold, the row moves to match the hold's new state on the next re-read.
  - The page re-reads its lists and the Counter services status on load and every 10 seconds.
  - Lend now sends the walk-in loan. After any successful lend, focus moves to the new row's link under Out on loan.
- **Retry keys**: if a Check out, Lend now, Renew or Confirm settlement press is refused with the billing outage, it keeps its Idempotency-Key. Pressing the same button again for the same row, or with the same form values, sends the same key. Any other press, or a changed value, uses a fresh key.
- **Renew (owner or staff)**: Renew sends the chosen New due date. On success:
  - the due time on the page updates and gains the "renewed" mark;
  - the renewal controls disappear;
  - Renewal result announces.
  
  On a refusal, the error shows in Renewal result and any field error sits under New due date.
- **Loan page (staff)**:
  - Choosing a file in Condition photo and pressing Add photo uploads it. The server decides the stage. On phones the file input offers the camera.
  - After any upload answer, the photo panels re-read so they show exactly the stored photos.
  - Check in sends the Returned at value.
  - Save inspection sends the chosen condition and note.
  - When another device already checked the loan in or inspected it, the refusal copy shows in Counter result and the page re-reads to show the stored values.
- **Settle (founder)**:
  - Settle opens dialog "Settle loan" with focus in Damage charge, prefilled "0.00".
  - Tab and Shift+Tab cycle inside the dialog. Escape or Cancel closes it and returns focus to Settle.
  - Confirm settlement sends one request with the key chosen by the retry-key rule above.
  - On success the dialog closes, focus moves to region "Receipt", and Settlement result announces.
  - On a refusal the dialog stays open and the error shows in Settlement result.
- **Menu (375 wide)**: Menu toggles the navigation. Escape closes it and returns focus to Menu.
- **Keyboard**: Tab order follows reading order: skip link, wordmark, navigation, then the main content from top to bottom and left to right. Every control shows a visible focus ring drawn in the accent colour, two pixels wide and offset from the control. No control is reachable only by hover or only by pointer.
- **Touch**: every button, link, radio and input is at least 44 by 44 pixels. Nothing depends on hover.

### Visual design (DP-42, DP-44)

- **Mood**: a workshop pegboard. A faint grid of small round dots in a warm grey sits behind every panel, like hardboard pegboard. Panels are opaque boxes over that grid.
- **Colour roles**:
  - **Page ground:** a warm off-white, like unbleached card.
  - **Ink:** near-black, for text and for the heavy rules.
  - **Accent:** a safety orange, for the claim bar, the focus ring, primary buttons and the Overdue pattern.
  - **Free and available:** a deep workshop green.
  - **Secondary:** a warm mid-grey, for secondary rules, the pegboard dots, empty lane cells and closed-day cells.
  - **Contrast:** all text and essential graphics meet WCAG 2.2 AA against their background. Body text is at least 4.5:1, and large text and lane fills are at least 3:1. Orange is never the only carrier of meaning.
- **Rules and boxes**: every section and card is boxed by a two-pixel near-black rule with square corners. Inside a box, rows are separated by one-pixel grey rules. Nothing has shadows, gradients, rounded pills or ornament.
- **Type**:
  - Headings use Archivo Black, a heavy, wide grotesque that reads like stencilled shop signage.
  - Body text uses IBM Plex Sans.
  - Numerals, dates, money, unit labels and every uppercase label use IBM Plex Mono.
  - Each heading level is about one third larger than the level below it, so the page title is a little over twice the body size.
  - The Availability numeral is the largest figure on the Item screen.
- **Status as word and pattern**: each status always comes with its word, so it still reads in greyscale.
  - Free: solid green fill.
  - Held: near-black diagonal hatching.
  - Out: solid ink.
  - Overdue: orange cross-hatching.
  - Closed days: plain grey with no pattern.
- **Density**: compact. Rows sit tight on a steady eight-step spacing rhythm, and the catalogue shows at least six item cards on a 1280×800 screen without scrolling past the header.
- **Composition**: a rigid 12-column grid. Each item sits in a hard-ruled card with its lanes stacked below as 28-day strips. Show more buttons are full-width ruled bars at the foot of their box.
- **Fonts** are bundled with the app (Working rules).

### Motion and effects (DP-14, DP-45)

All motion uses one easing: it leaves fast and settles softly into place.

- **Lane drop** (the signature, played after the hold response arrives):
  1. While the request is pending, the orange claim bar sits just above lane 1, fully visible.
  2. When the server answers with a hold, the bar steps down one lane at a time from lane 1. Each step takes about 140 milliseconds, and the bar rests briefly on every lane it passes. Every lane above the assigned one is busy for the chosen dates and shows the hatched fill while the bar passes it.
  3. On reaching the assigned lane, the bar settles into it over about 260 milliseconds. Once settled, the bar's box lies inside group "Unit <label>" of the unit named in the hold response, and it stays there.
  4. The Availability numeral then counts down one whole number at a time, from the value shown to the free count in the response, over about 420 milliseconds in total.
  5. If the claim is refused for any reason (no unit free, borrowing paused, borrowing limit reached, or another error), the bar steps past every lane at the same pace, drops below the last lane, and fades out within about a quarter of a second. The numeral does not change, and the refusal copy appears in Claim result.
  6. With three lanes the whole drop finishes within one and a half seconds. It is driven by time, not by scrolling, and scrolling never replays or reverses it.
- **Dialog**: "Settle loan" rises slightly and fades in within about a fifth of a second, and closes in about a tenth of a second.
- **Press feedback**: buttons sink by their rule's depth while pressed and spring back as soon as they are released, in under a tenth of a second.
- **Hover feedback** (pointer devices only): a card's or button's rule turns orange within about a tenth of a second. Nothing moves.
- **Row arrival**: when a Counter row moves to a new section, or rows are appended by Show more, the arrived row (or the first appended row) shows one orange underline sweep, once, lasting under half a second.
- **Pending**: pending buttons show their pending copy over a static hatched fill. There are no spinners.
- **Ban**: no other motion exists. Nothing loops, pulses, shimmers or animates for decoration, and there is no parallax.
- **Reduced motion** (when the system asks for reduced motion):
  - The claim bar appears in its assigned lane at once. On a refusal it is never shown.
  - The numeral jumps straight to its final value.
  - The dialog appears and disappears with no rise or fade.
  - Press, hover and row-arrival effects change colour instantly, with no movement or sweep.
  - Claim result announces exactly as it does with motion.

### Feedback states (DP-03, DP-04, DP-12, DP-14, DP-15, DP-17, DP-20, DP-23, DP-25, DP-27, DP-30, DP-33, DP-40, DP-41, DP-46, DP-48, DP-49, DP-50, DP-52, DP-54, DP-55, DP-57, DP-59, DP-61)

Each async action shows a pending state on its button, then announces the outcome in the named polite live region. API error responses carry the error copy below as their `message`, and the screen shows that message. Field errors appear under their field and are linked to it as its description, and the region announces "Check the highlighted fields."

| Action | Live region | Pending button copy | Success copy |
|---|---|---|---|
| Sign in | status "Form status" | "Signing in…" | (goes to home screen) |
| Hold a unit | status "Claim result" | "Finding a free unit…" | "Held unit <lane number> of <unit count>, <free> units still free for these dates" |
| Cancel hold | status "My loans status" | "Cancelling…" | "Hold cancelled." |
| Show more holds | status "My loans status" | "Loading more…" | "Showing <n> holds." |
| Show more loans | status "My loans status" | "Loading more…" | "Showing <n> loans." |
| Mark ready | status "Counter result" | "Marking ready…" | "Marked ready. Pickup notice queued for <member name>." |
| Check out / Lend now | status "Counter result" | "Lending…" | "Lent to <member name>. Due <local time>." |
| Renew | status "Renewal result" | "Renewing…" | "Renewed. Due <local time>." |
| Add photo | status "Counter result" | "Uploading photo…" | "Photo saved." |
| Check in | status "Counter result" | "Checking in…" | "Checked in on time." or "Checked in late: <late days> late days." |
| Save inspection | status "Counter result" | "Saving…" | "Inspection saved." |
| Confirm settlement | status "Settlement result" | "Settling…" | "Settled. Receipt queued for <member name>." |

Placeholders:
- `<lane number>` is the unit's lane index plus one.
- `<free>` is `units_free` from the hold response.
- `<n>` is the number of rows now listed in that region.

Error copy, by error code:

| Code | Copy |
|---|---|
| `unauthenticated` | "Sign in to continue." |
| `bad_credentials` | "Email or password is wrong." |
| `forbidden` | "Your role can't do that." |
| `not_found` | "Not found." |
| `cross_origin` | "Cross-site requests are refused." |
| `unsupported_media_type` | "Send JSON, or a multipart form for photos." |
| `body_too_large` | "Request body is too large." |
| `validation` | "Check the highlighted fields." |
| `no_unit_free` | "No unit is free for these dates." |
| `unit_busy` | "That unit is busy on some of those days." |
| `hold_expired` | "This hold's pickup window has closed." |
| `borrowing_paused` | "Borrowing is paused while an item is overdue." |
| `borrowing_limit` | "You can have at most 4 items held or out at once." |
| `renewal_used` | "This loan has already been renewed once." |
| `invalid_transition` | "This <hold or loan> is <status word in lower case> and can't do that." |
| `idempotency_conflict` | "That Idempotency-Key was used for a different request." |
| `request_in_progress` | "That request is still being processed." |
| `photo_limit` | "This stage already has 4 photos." |
| `unsupported_photo` | "Photos must be JPEG, PNG or WebP." |
| `photo_too_large` | "Photos can be at most 5,000,000 bytes." |
| `not_settled` | "This loan isn't settled yet." |
| `settlement_mismatch` | "An earlier attempt fixed this loan's damage charge at <money>. Settle again with that amount." (`<money>` is the fixed damage charge) |
| `billing_unavailable` on checkout, walk-in or renewal | "Billing is offline, so items with a deposit can't be lent right now. Items without a deposit still lend." |
| `billing_unavailable` on settlement | "Billing is offline, so this loan can't be settled yet. Try again with the same damage charge once billing is back." |
| `photo_storage_unavailable` | "Photo storage is offline. The loan is saved; add photos when it's back." |

A renewal never contacts billing (Business rules), so in practice it never receives `billing_unavailable`. The row is listed for completeness of the shared copy.

For example:
- A second volunteer whose Check out lost the race for a hold sees "This hold is collected and can't do that."
- A member who presses Cancel hold after collection sees the same copy in My loans status.
- A volunteer whose Check in lost the race sees "This loan is returned and can't do that."

Field error copy (in `fields`, keyed by field name):

| Field | Copy |
|---|---|
| `start_date` | "Choose an open day from today, within the next 28 days." |
| `end_date` | "Choose an open day on or after pickup, at most 7 days later." |
| `due_date` on a walk-in | "Choose an open day on or after checkout, at most 7 days later." |
| `due_date` on a renewal | "Choose an open day after the current due date, at most 7 days later." |
| `checked_out_at` | "Checkout time can't be in the future." |
| `returned_at` | "Return time must be after checkout and not in the future." |
| `outcome` | "Choose OK or Damaged." |
| `note` | "Describe the damage in up to 500 characters." when damaged without a note or with too long a note; "Notes can be up to 500 characters." when OK with too long a note |
| `damage_cents` | "An item inspected OK has no damage charge." when the outcome was OK and the amount is not 0; otherwise "Damage charge must be whole cents from $0.00 to the item's replacement value." |
| `item_id`, `member_id`, `unit_id`, `hold_id` | "No such <item, member, unit or hold>." |
| `idempotency_key` | "Send an Idempotency-Key header of 1 to 100 characters." |
| `limit` | "Choose a page size from 1 to 50." |
| `cursor` | "This page link is out of date. Start from the first page." |
| `email`, `password`, `photo` | "Required." |

Outage and blocked-state copy:

- **Counter services banner.** While billing is down, the status "Counter services" shows "Billing offline — deposit items are blocked. Items without a deposit still lend." While photo storage is down, it shows "Photo storage offline — add photos later." Each message takes one line. When both services are up the banner is empty and visually hidden.
- **Blocked ready holds.** While billing is down, a ready hold row for an item with a deposit shows "Blocked: billing offline" and its Check out button is disabled. The row keeps this copy for as long as billing is down, however many checkout attempts are refused, and the hold keeps its original pickup deadline.
- **Unavailable photos.** A photo that cannot be shown during a photo storage outage shows the text "Photo unavailable" in its place.

## Backend

### API (DP-01, DP-03, DP-04, DP-06, DP-07, DP-08, DP-10, DP-11, DP-12, DP-13, DP-16, DP-17, DP-20, DP-21, DP-23, DP-25, DP-27, DP-29, DP-30, DP-33, DP-34, DP-36, DP-38, DP-40, DP-41, DP-47, DP-48, DP-49, DP-50, DP-52, DP-53, DP-57, DP-61)

**Conventions.**
- All paths are under `/api`.
- Request and response bodies are `application/json; charset=utf-8`. The exceptions are photo upload (`multipart/form-data`) and photo download (image bytes).
- Money is an integer number of cents, in fields ending `_cents`.
- Instants are ISO 8601 UTC with a `Z` suffix. Dates are `YYYY-MM-DD` in library time.
- Ids are opaque strings. Seeded ids are listed in Seed data, and server-made ids are random UUIDs.

**Sessions.** Every endpoint except `GET /api/health` and `POST /api/session` requires the session cookie `shedline_session` (HttpOnly, SameSite=Lax, Path=/). A session issued by any running copy of the server is valid on every copy that shares the database (Configuration and secrets).

**Error body.** Every error has the shape `{"error":{"code":"<code>","message":"<copy>"}}` and carries no other key. A validation error adds `"fields"` inside the `error` object, never beside it, so it reads `{"error":{"code":"validation","message":"<copy>","fields":{"<field>":"<copy>"}}}`. The codes and copy are listed in Feedback states.

**Precedence.** When several errors apply, the first in this order wins:
1. `403 cross_origin` (Server boundary).
2. `401 unauthenticated`.
3. Idempotency-Key handling:
   - a stored response for the key and the same request is returned as stored;
   - a key stored with a different request answers `409 idempotency_conflict`;
   - a key whose first request is still running answers `409 request_in_progress`.
4. `404 not_found` for an unknown id in the path, or an id the caller may not see.
5. `403 forbidden` for the caller's role.
6. `415 unsupported_media_type`, then `413 body_too_large`.
7. `422 validation`, then the photo content checks in this order: `415 unsupported_photo`, then `413 photo_too_large`.
8. `409` state conflicts, in the per-action order given in Business rules.
9. `503` dependency outages.

Endpoint rows below list only their own extra errors.

**Idempotency.** `POST /api/holds`, `POST /api/loans`, `POST /api/loans/{id}/renewal` and `POST /api/loans/{id}/settlement` require the `Idempotency-Key` header, 1 to 100 characters. A missing or out-of-range key answers `422` on field `idempotency_key`. Keys are scoped to the caller.
- **Successful requests.** A 2xx response is stored with the key and a hash of the method, path and body, and is kept for good. A repeat with the same key and the same request returns the stored status and body and has no further effect.
- **In progress.** `request_in_progress` is answered only while the first request with that key is actually still running.
- **Failed requests.** A request that ends with any 4xx or 5xx, including `503 billing_unavailable`, stores no response and leaves no in-progress marker. The key is unused again as soon as that answer is sent, so a retry with the same key is handled as a brand-new request:
  - during a billing outage it gets the same `503` with the same copy. It never gets `409 request_in_progress`, a replayed stored `503`, or `409 idempotency_conflict`;
  - once billing is back, it performs the action exactly once.
  
  For example, a key first sent with an invalid body (answered `422`) can then be sent with a valid body and succeeds.

**Paging.** `GET /api/holds` and `GET /api/loans` take two parameters:
- `limit`: an integer from 1 to 50 inclusive, default 20. Any other value answers `422` on field `limit`.
- `cursor`: the opaque string from the previous page's `next_cursor`. A cursor no copy of the server issued, or one that was altered, answers `422` on field `cursor`. A cursor issued by any copy sharing the database is accepted by every copy.

`next_cursor` is `null` on the last page. Paging behaviour is set out in Business rules › Lists.

**Fields by role.** Responses carry exactly the fields listed here. They never carry a member's email, phone number, password hash, Kill Bill id or any other internal id.
- `User`: `{"id","name","role"}`. `role` is `member`, `volunteer` or `founder`. Staff means volunteer or founder.
- `Item`: `{"id","name","category","deposit_cents","replacement_cents","unit_count","units_free_today"}`
- `Unit`: `{"id","label","lane_index"}`
- `Span`, as seen by a member: exactly `{"start_date","end_date","status","back_on","mine"}`.
  - `status` is `held`, `out` or `overdue`.
  - `back_on` is the first open day after `end_date`, or `null` when overdue.
  - `mine` is true only on the caller's own holds and loans.
- `Span`, as seen by staff: the member fields plus `"borrower":{"name"}` and `"record":{"type":"hold"|"loan","id"}`.
- `Hold`: `{"id","item":{"id","name"},"unit":Unit,"member":{"id","name"},"status","start_date","end_date","ready_at","pickup_deadline","created_at"}`. `ready_at` and `pickup_deadline` are `null` until the hold is ready.
- `Photo`: `{"id","stage","content_type","size_bytes","url"}`. `stage` is `checkout` or `return`. `url` is `/api/loans/<loan id>/photos/<photo id>`.
- `Loan`: `{"id","item":{"id","name"},"unit":Unit,"member":{"id","name"},"hold_id","status","checked_out_at","due_date","due_at","renewed_at","returned_at","on_time","late_days","deposit_cents","replacement_cents","inspection","settlement","photos":[Photo]}`.
  - `status` is `out`, `overdue`, `returned`, `inspected` or `settled`.
  - `renewed_at` is `null` until the loan is renewed.
  - `on_time` and `late_days` are `null` until the loan is returned.
  - `inspection` is `null` or `{"outcome":"ok"|"damaged","note","inspected_at"}`.
  - `settlement` is `null` or a `Settlement`.
  - `photos` is in photo-number order.
- `Settlement`: `{"loan_id","deposit_cents","released_cents","damage_cents","damage_from_deposit_cents","extra_damage_cents","late_days","late_fee_cents","total_charged_cents","settled_at"}`
- `LedgerEntry`: `{"id","loan_id","item":{"id","name"},"kind","amount_cents","created_at"}`. `kind` is `deposit_hold`, `deposit_release`, `damage_charge`, `extra_damage` or `late_fee`.

Members see only the holds and loans that are their own. Staff see all of them.

**Endpoints.**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | — | `200 {"status":"ok"}` | — |
| `POST /api/session` | anyone | `{"email","password"}` | `200 {"user":User}`, sets cookie | `401 bad_credentials`; `422` |
| `GET /api/session` | signed in | — | `200 {"user":User}` | — |
| `DELETE /api/session` | signed in | — | `204`, clears cookie | — |
| `GET /api/library` | signed in | — | `200 {"name","time_zone","open_days","closed_dates","opening_time","closing_time","late_fee_schedule":[{"effective_from","cents_per_day"}],"late_fee_cents_per_day","max_active_per_member","pickup_window_seconds"}` | — |
| `GET /api/items` | signed in | — | `200 {"items":[Item]}` in seed order | — |
| `GET /api/items/{item_id}` | signed in | — | `200 {"item":Item}` | — |
| `GET /api/items/{item_id}/lanes?from=&start=&end=` | signed in | query: `from` defaults to today; `start` and `end` optional, but given together | `200 {"item_id","from","to","unit_count","units_free","lanes":[{"lane_index","unit_id","label","busy_for_range","spans":[Span]}]}` | `422` on `from`, `start_date` or `end_date` when malformed or when only one of `start`/`end` is given |
| `POST /api/holds` | member | `{"item_id","start_date","end_date"}` + Idempotency-Key | `201 {"hold":Hold,"units_free","unit_count"}` | `409 borrowing_paused`; `409 borrowing_limit`; `409 no_unit_free`; `422` |
| `GET /api/holds?status=&limit=&cursor=` | signed in | optional status filter and paging | `200 {"holds":[Hold],"next_cursor"}` by `created_at` descending, then `id` descending | `422` on `limit` or `cursor` |
| `GET /api/holds/{hold_id}` | owner, staff | — | `200 {"hold":Hold}` | — |
| `POST /api/holds/{hold_id}/ready` | staff | `{}` | `200 {"hold":Hold}` | `409 invalid_transition` |
| `POST /api/holds/{hold_id}/cancel` | owner, staff | `{}` | `200 {"hold":Hold}` | `409 invalid_transition` |
| `GET /api/members` | staff | — | `200 {"members":[{"id","name"}]}` by name | — |
| `POST /api/loans` | staff | `{"hold_id"}` or `{"member_id","unit_id","due_date","checked_out_at"?}` + Idempotency-Key | `201 {"loan":Loan}` | `409 invalid_transition`; `409 hold_expired`; `409 borrowing_paused`; `409 borrowing_limit`; `409 unit_busy`; `422`; `503 billing_unavailable` |
| `GET /api/loans?status=&limit=&cursor=` | signed in | optional status filter and paging | `200 {"loans":[Loan],"next_cursor"}` by `checked_out_at` descending, then `id` descending | `422` on `limit` or `cursor` |
| `GET /api/loans/{loan_id}` | owner, staff | — | `200 {"loan":Loan}` | — |
| `POST /api/loans/{loan_id}/renewal` | owner, staff | `{"due_date"}` + Idempotency-Key | `200 {"loan":Loan}` | `409 invalid_transition`; `409 renewal_used`; `409 borrowing_paused`; `409 unit_busy`; `422` |
| `POST /api/loans/{loan_id}/photos` | staff | multipart: file field `photo` | `201 {"photo":Photo}` | `409 invalid_transition`; `409 photo_limit`; `413 photo_too_large`; `415 unsupported_photo`; `422` on `photo` when the field is missing; `503 photo_storage_unavailable` |
| `GET /api/loans/{loan_id}/photos/{photo_id}` | owner, staff | — | `200` image bytes | `503 photo_storage_unavailable` |
| `POST /api/loans/{loan_id}/return` | staff | `{"returned_at"?}` | `200 {"loan":Loan}` | `409 invalid_transition`; `422` |
| `POST /api/loans/{loan_id}/inspection` | staff | `{"outcome","note"}` | `200 {"loan":Loan}` | `409 invalid_transition`; `422` |
| `POST /api/loans/{loan_id}/settlement` | founder | `{"damage_cents"}` + Idempotency-Key | `201 {"settlement":Settlement,"loan":Loan}` | `409 invalid_transition`; `409 settlement_mismatch`; `422`; `503 billing_unavailable` |
| `GET /api/loans/{loan_id}/receipt` | owner, staff | — | `200 {"receipt":Settlement plus "item":{"id","name"},"unit":Unit,"member":{"id","name"}}` | `409 not_settled` |
| `GET /api/ledger?loan_id=` | founder | optional loan filter | `200 {"entries":[LedgerEntry],"deposits_held_cents"}` oldest first | — |
| `GET /api/counter/status` | staff | — | `200 {"billing":"up"|"down","photo_storage":"up"|"down","checked_at"}` | — |

Notes on specific endpoints:
- **Library settings.** `closed_dates` is listed in ascending order. `late_fee_schedule` lists the seeded entries in ascending `effective_from` order. `late_fee_cents_per_day` is the rate of the entry in force on today's local date.
- **Photo upload stage.** The server assigns the stage and checks the per-stage limit as set out in Business rules › Photos.
- **Photo download headers.** Photo downloads carry the detected image `Content-Type`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`.
- **Unknown ids in a body.** An unknown `item_id`, `member_id`, `unit_id` or `hold_id` in a request body answers `422` on that field, not `404`.
- **Lanes window.** `to` is `from` plus 27 days, giving the 28-day window. Spans are returned when they intersect the window. `units_free` and `busy_for_range` are `null` unless both `start` and `end` are given.
- **Photo sizes.** Photos up to and including 5,000,000 bytes are accepted. Larger photos answer `413 photo_too_large`.

### Business rules (DP-07, DP-10, DP-11, DP-12, DP-13, DP-16, DP-18, DP-20, DP-21, DP-23, DP-24, DP-29, DP-30, DP-32, DP-33, DP-34, DP-36, DP-41, DP-46, DP-47, DP-48, DP-49, DP-50, DP-51, DP-52, DP-53, DP-54, DP-55, DP-56, DP-57, DP-58, DP-60, DP-61, DP-62)

**Library calendar.**
- **Library time.** All local dates and times are in the library's IANA time zone from Seed data. "Today" means today's date in that zone.
- **Open days.** An open day is a date whose weekday is in `open_days` and which is not listed in `closed_dates`. This one definition applies everywhere: hold `start_date` and `end_date`, walk-in `due_date`, renewal `due_date`, `back_on`, the late-day count and the closed cells in the lanes. For example, with the seed data, a span ending Wed 25 Nov 2026 has `back_on` `2026-11-27`, because Thu 26 Nov is a closure date.
- **Closing instant.** The closing instant of a date is that date's closing time in the library zone, converted with the UTC offset in force on that date itself. A date on or after the spring clock change uses daylight time, and a date on or after the autumn clock change uses standard time.
- **Formats.**
  - `<local time>` is written as weekday, day, month, year, 24-hour time and zone abbreviation, for example `Sun 1 Nov 2026, 18:00 EST`.
  - `<money>` is a dollar sign, whole dollars with comma thousands separators, a point and two-digit cents, for example `$1,234.50`.

**Occupancy.**
- **Busy and free.** A unit is busy on a date when an active span covers that date, and date ranges include both ends. A unit is free for a range when it is busy on none of the range's dates.
- **Hold spans.** A hold is active while it is requested or ready, and while now is before its pickup deadline. Its span runs from `start_date` to `end_date`.
- **Loan spans.** A loan is active while it is out or overdue. Its span runs from the local date of `checked_out_at` to `due_date` (the renewed date, once renewed). While overdue, its span runs to today instead.
- **Inactive records.** Returned, inspected and settled loans occupy nothing. So do collected, expired and cancelled holds.
- **Counts.** `units_free_today` counts the units not busy today. `units_free` counts the units free for the requested range.
- **No double booking.** A unit is never held, lent or renewed to two members for overlapping dates.

**Claims are decided one after another.** Requests that change which days an item's units are taken are decided one at a time per item, and each sees the committed result of the one before:
- new holds;
- walk-in loans;
- the span re-check at checkout;
- renewals.

All requests that add to one member's active count are also decided one at a time per member: that member's new holds and walk-ins.

- **Free count at commit.** The `units_free` in a `201` hold response is the free count for that hold's range immediately after that claim commits. It counts every claim that committed before it and none after it.
- **Racing claims.** When N claims race for K free units of one item over the same range:
  - exactly K succeed, each on a different unit with a distinct `lane_index`;
  - the winners' `units_free` values are exactly K−1 down to 0, each once;
  - the rest answer `no_unit_free`.
  
  Afterwards, the lanes `units_free` for that range is 0, and `units_free_today` agrees whenever the range includes today.

**Borrowing checks.** A member must pass two checks before taking a new hold or a new loan.

- **Borrowing pause.**
  - **When it applies.** A member's borrowing is paused whenever at least one of their loans is overdue now, that is, not yet returned while now is strictly after its `due_at`.
  - **When it is judged.** The pause is judged at the moment of each request, from `due_at` against the current time. It starts at the exact instant a due time passes, without waiting for any background work. It lifts the moment the overdue loan is checked in, before inspection or settlement.
  - **What it refuses.** While paused, the following answer `409 borrowing_paused`, carry no other member's data, and create, change or bill nothing:
    - `POST /api/holds` by that member;
    - `POST /api/loans` for that member, whether a hold checkout or a walk-in;
    - `POST /api/loans/{id}/renewal` for that member's other loans.
  - **Back-timed walk-ins.** A back-timed walk-in that is already overdue when it is created is allowed, and it pauses the member at once.
  - **Existing holds.** A paused member's requested and ready holds keep their state. Staff can still mark them ready, either side can cancel them, and their pickup deadlines still run.
- **Borrowing limit.**
  - **What counts.** A member's active count is their requested holds, plus their ready holds whose pickup deadline has not passed, plus their out and overdue loans. It is judged at request time.
  - **The limit.** A new hold or walk-in that would take the count past `max_active_per_member` answers `409 borrowing_limit`.
  - **When a slot frees.** A slot frees the instant one of these happens, whether or not the server has yet swept the expired hold:
    - a hold is cancelled;
    - a loan is checked in;
    - a ready hold's pickup deadline passes.
  - **Unchecked actions.** Checking out a hold (a ready hold becomes a loan) and renewing a loan never change the count and are not checked against the limit.
  - **Racing requests.** N simultaneous holds or walk-ins for a member who has k active items give exactly max(0, limit − k) successes, provided units are free and the member is not paused.

**Holds.**
- **Dates.** `start_date` must be an open day from today to today plus 27 days inclusive. `end_date` must be an open day from `start_date` to `start_date` plus 7 days inclusive. Anything else is a `422` on that field.
- **Claim.** A new hold takes the free unit with the lowest `lane_index` for the whole range, and its status is `requested`. Conflicts are checked in this order: `borrowing_paused`, `borrowing_limit`, `no_unit_free`.
- **Legal moves:**
  - requested → ready (staff): sets `ready_at` to now and `pickup_deadline` to `ready_at` plus the pickup window. The pickup window is `SHEDLINE_PICKUP_WINDOW_SECONDS`, which defaults to 172,800 seconds (48 hours). In grading it is set to 180 seconds (three minutes).
  - requested or ready → cancelled (owner or staff).
  - ready → collected, by checkout.
  - ready → expired (server only).
- **Illegal moves.** Every other move answers `invalid_transition`. That includes marking a ready hold ready again, cancelling a collected, expired or cancelled hold, and checking out a requested, collected or cancelled hold.
- **Pickup deadline.**
  - A ready hold can be collected while now is strictly before `pickup_deadline`.
  - At or after the deadline, the hold counts as expired in every response and in every rule.
  - Checking out a hold whose pickup deadline has passed answers `hold_expired`, whether or not the server has yet marked it expired.
  - The server marks the hold expired, frees its unit and queues the lapse email within 10 seconds of the deadline, whether or not anyone makes a request.

**Loans.**
- **Checkout conflicts.** For `POST /api/loans`, conflicts are checked in this order:
  - hold checkout: `invalid_transition`, `hold_expired`, `borrowing_paused`, `unit_busy`;
  - walk-in: `borrowing_paused`, `borrowing_limit`, `unit_busy`.
- **Checkout of a hold.** Creates a loan for the hold's member and unit, with `checked_out_at` now and `due_date` the hold's `end_date`. The hold becomes collected. The span is re-checked, and if another active hold or loan on that unit overlaps it, the answer is `unit_busy`.
- **All or nothing.** Checking out a hold makes four changes together, or none of them:
  - the hold becomes collected;
  - the loan is created;
  - one `deposit_hold` ledger entry is written (items with a deposit);
  - one Kill Bill deposit purchase is recorded (items with a deposit, see Services).
  
  The hold is claimed for this one checkout before billing is contacted. If billing then fails, the claim is undone: the hold stays ready with its original pickup deadline, and no loan or ledger entry exists.
- **Racing checkouts and cancels.**
  - When several checkouts of the same ready hold arrive at once with different Idempotency-Keys (for example from two counter devices), exactly one answers `201`. Every other one answers `409 invalid_transition` with the copy for a collected hold.
  - A cancel racing a checkout also has one winner:
    - if the checkout wins, the cancel answers `409 invalid_transition` for a collected hold;
    - if the cancel wins, the checkout answers `409 invalid_transition` for a cancelled hold, and no loan exists for that hold.
  - A losing request makes no Kill Bill call at all: it creates no Kill Bill account, payment or transaction.
- **Walk-in loan.**
  - `checked_out_at` is optional and defaults to now. If given, it must not be later than now (field `checked_out_at`).
  - `due_date` must be an open day from the local date of `checked_out_at` to that date plus 7 days (field `due_date`).
  - The unit must be free for that span, otherwise the answer is `unit_busy`.
  - A walk-in of an item with a deposit follows the same all-or-nothing rule as a checkout of a hold.
- **Due time.**
  - `deposit_cents` and `replacement_cents` are copied from the item at checkout.
  - `due_at` is the closing instant of `due_date`. For example, with the seed data, a loan due on Sun 1 Nov 2026 has `due_at` `2026-11-01T23:00:00Z`.
- **Overdue.** A loan is `overdue` whenever now is strictly after `due_at` and it has not been returned. Every response reflects this immediately.
- **Renewal.**
  - A loan can be renewed once, by its owner or by staff, while its status is `out`.
  - The new `due_date` must be an open day after the current `due_date` and at most 7 days after it. Otherwise the answer is `422` on `due_date`.
  - Conflicts are checked in this order:
    1. `invalid_transition` unless the status is `out` (an overdue loan answers "This loan is overdue and can't do that.");
    2. `renewal_used`;
    3. `borrowing_paused` (the member has another overdue loan);
    4. `unit_busy`, when any other active hold or loan on that unit covers a day from the day after the current `due_date` to the new `due_date`.
  - A renewal racing a hold claim on the same unit for those days has exactly one winner (the claims rule above). When the renewal wins, the hold goes to another free unit or answers `no_unit_free`. When the hold wins, the renewal answers `unit_busy`.
  - A renewal sets `renewed_at` to now and moves `due_date`, and with it `due_at`, the loan's span and its late days.
  - A renewal makes no Kill Bill call and writes no ledger entry.
- **Return and inspection: legal moves.**
  - out or overdue → returned (staff). `returned_at` defaults to now. If given, it must be no earlier than `checked_out_at` and not in the future (field `returned_at`).
  - returned → inspected (staff). `outcome` is `ok` or `damaged`. `note` may be up to 500 characters and is required when the outcome is damaged.
  - inspected → settled (founder).
- **Illegal moves.** Every other move answers `invalid_transition`. That includes returning twice, inspecting before return, inspecting twice, settling before inspection and settling twice with a new key.
- **One check-in and one inspection.**
  - Check-ins of the same loan are decided one after another. Among simultaneous `return` requests, exactly one answers `200`, and the others answer `409 invalid_transition` for a returned loan.
  - The stored `returned_at`, `on_time` and `late_days` are the winner's, and the borrowing pause and the limit slot are released once.
  - Simultaneous `inspection` requests work the same way: exactly one answers `200`, the others answer `invalid_transition` for an inspected loan, and the stored outcome and note are the winner's.
- **On time.** `on_time` is true when `returned_at` is at or before `due_at`. For example, with the seed data, a return at `2026-11-01T22:59:00Z` (17:59 EST) or exactly at `2026-11-01T23:00:00Z` is on time for a loan due Sun 1 Nov 2026.

**Photos.**
- **Stage.** The server assigns the stage from the loan's state at the moment the photo record is created: `checkout` while the loan is out or overdue, `return` while it is returned. Any other loan state answers `409 invalid_transition`.
- **Upload during a check-in.** A photo uploaded while a check-in of the same loan commits is stored with exactly one stage, and its record's stage always matches its key prefix (Services).
- **Limit.** Each stage of a loan holds at most 4 photos. Conflicts are checked in this order: `invalid_transition`, then `photo_limit`.
- **Simultaneous uploads.** When M uploads race for a stage that already has p photos, exactly max(0, 4 − p) answer `201` and the rest answer `409 photo_limit`.
- **Refused uploads.** A refused upload leaves no object and no photo record, whether it was refused for `photo_limit`, type, size or a storage failure. The bucket holds exactly one object per photo record.
- **Numbering.** The photos of a stage are numbered 1 to n in the order their records were created, with no gaps.

**Late days and late fee.**
- **Counting late days.** `late_days` counts the open days, from the due date onward, whose closing instant is strictly before `returned_at`. The due date's own closing is the first one counted.
- **Pricing each day.** Each late day is priced at the `cents_per_day` of the late-fee schedule entry with the latest `effective_from` on or before that late day's local date. A late day dated before the first entry uses the first entry's rate. The checkout date and the due date do not choose the rate; the date of each missed closing does.
- **Cap.** `late_fee_cents` is the smaller of the sum of the per-day prices and `replacement_cents`. The cap applies to the sum, never to single days, and the result is a whole number of cents.
- **Computed once.** The late fee is computed once, when the loan is settled, from the stored `returned_at` and `due_date`, and is never recomputed.
- **Examples**, with the seed data:
  - **Autumn clock change.** For a loan due Sun 1 Nov 2026:
    - a return at 18:00:01 EST that day has 1 late day;
    - a return on Tue 3 Nov 2026 at 17:59 EST still has 1 late day, because Monday is closed;
    - a return on Tue 3 Nov 2026 at 18:01 EST has 2 late days.
    
    These late days are all priced at 100 cents.
  - **Spring clock change.** A walk-in checked out Thu 5 Mar 2026 at 10:00 EST and due Sat 7 Mar 2026:
    - Returned Tue 10 Mar 2026 at 18:30 EDT (`2026-03-10T22:30:00Z`), it has 3 late days. These are Sat 7 Mar (closing `2026-03-07T23:00:00Z`), Sun 8 Mar, the clock-change day (closing 18:00 EDT, `2026-03-08T22:00:00Z`), and Tue 10 Mar (closing `2026-03-10T22:00:00Z`). Mon 9 Mar is closed. The late fee is 150 cents.
    - Returned instead at Tue 10 Mar 2026, 17:59 EDT (`2026-03-10T21:59:00Z`), it has 2 late days and a late fee of 100 cents.
  - **Closure dates.** A walk-in checked out Wed 1 Jul 2026 at 10:00 EDT, due Fri 3 Jul 2026 and returned Tue 7 Jul 2026 at 12:00 EDT has 2 late days: Fri 3 Jul and Sun 5 Jul. Sat 4 Jul is a closure date, Mon 6 Jul is closed, and Tue 7 Jul's closing had not passed. Its late fee is 100 cents, and its receipt line reads "Late fee: $1.00 (2 late days)".
  - **Rate change.** A walk-in checked out Thu 27 Aug 2026 at 10:00 EDT, due Sat 29 Aug 2026 and returned Wed 2 Sep 2026 at 12:00 EDT has 3 late days. Sat 29 Aug and Sun 30 Aug are priced at 50 cents each and Tue 1 Sep at 100 cents. Mon 31 Aug is closed, and Wed 2 Sep's closing had not passed. Its late fee is 200 cents, and its receipt line reads "Late fee: $2.00 (3 late days)".
  - **Cap.** A stud finder (replacement $24.99) due on or after 1 Sep 2026 with 25 late days pays 2,499 cents, not 2,500.

**Settlement.**
- **Damage charge.** `damage_cents` must be a whole number from 0 to `replacement_cents` inclusive. It must be 0 when the inspection outcome was ok.
- **Split.**
  - `damage_from_deposit_cents` = the smaller of `damage_cents` and `deposit_cents`.
  - `extra_damage_cents` = `damage_cents` − `damage_from_deposit_cents`.
  - `released_cents` = `deposit_cents` − `damage_from_deposit_cents`.
  - `total_charged_cents` = `damage_cents` + `late_fee_cents`.
  
  So `released_cents` + `damage_from_deposit_cents` always equals `deposit_cents`. For example, with the seed data, a floor sander (deposit $75.00) settled with a damage charge of 12,000 cents has `released_cents` 0, `damage_from_deposit_cents` 7,500 and `extra_damage_cents` 4,500.
- **Conflict order.** `invalid_transition`, then `settlement_mismatch`.
- **Order of effects.** Settlement writes its billing records first (Services). Its ledger entries, its one receipt email and the settled status then take effect together, and only once every billing record it needs exists. Until then the loan stays inspected, with no new ledger entries and no email.
- **When billing is needed.** A settlement needs billing only when it has a billing record to write: a released amount above 0, an extra damage charge above 0 or a late fee above 0. A settlement with none of these completes even while billing is down.
- **Fixed damage charge.**
  - Only an attempt that passes validation and finds the loan inspected (so it is not refused with `invalid_transition`) fixes the loan's damage charge at its `damage_cents`. This holds even when that attempt is then refused with `503 billing_unavailable` before any billing record was written.
  - An attempt refused with `422` or with `409 invalid_transition` fixes nothing. For example, a settle attempt on a loan that is returned but not yet inspected leaves no fixed amount, so after a later OK inspection the loan settles with a damage charge of 0.
  - The fixed amount is kept until the loan is settled. Every later attempt for that loan, with any key, must send the same `damage_cents`. An attempt with a different amount answers `409 settlement_mismatch` and changes nothing.
- **Billing failure.** If billing fails, the answer is `503 billing_unavailable`. Billing records written before the failure may remain in Kill Bill. The next settle attempt with the fixed amount completes the missing billing records without repeating any, so a settled loan has each billing record exactly once.
- **One attempt at a time.** Settlement attempts for the same loan are decided one after another. An attempt with a different key that arrives while another is running waits for it to finish and is then judged against the result:
  - if the earlier attempt settled the loan, the later one answers `409 invalid_transition` for a settled loan;
  - if the earlier attempt ended `503`, the later one runs as a new attempt.
  
  Kill Bill therefore ends with each settlement record exactly once, and there is one receipt email and one set of ledger entries.

**Ledger.**
- **Checkout.** Checkout of an item with a deposit writes one `deposit_hold` entry for `+deposit_cents`.
- **Settlement.** Settlement writes these entries, each only when its amount is above 0:
  - `deposit_release` for `−released_cents`;
  - `damage_charge` for `−damage_from_deposit_cents`;
  - `extra_damage` for `+extra_damage_cents`;
  - `late_fee` for `+late_fee_cents`.
- **Netting.** For every settled loan with a deposit, its `deposit_hold`, `deposit_release` and `damage_charge` entries sum to 0.
- **Deposits held.** `deposits_held_cents` is the sum of all `deposit_hold`, `deposit_release` and `damage_charge` entries. It always equals the sum of `deposit_cents` over loans with a deposit that are not yet settled.
- **Permanence.** Entries are never edited or deleted.

**Refused requests change nothing.** A request answered with any 4xx or 5xx changes no stored record, queues no email and writes no storage object. It changes no `units_free_today`, lanes `units_free`, span or `deposits_held_cents`. The only exceptions are:
- the fixed damage charge set by a settlement attempt that reached the fixing point (Settlement above);
- billing records that an interrupted settlement had already written.

A refused walk-in leaves its unit free, so the next claim for those dates takes that unit by lowest lane.

**Lists.**
- **Order.** Holds and loans lists come back in the orders stated in API. Ties on the timestamp are broken by `id`, so records that share the same `created_at` or `checked_out_at` keep a fixed order.
- **Cursors.** A cursor marks a position in that order and nothing else. Each next page returns the records strictly after that position, at most `limit` of them.
- **Stability.** Every record that existed when the first page was read appears exactly once across the first page and the pages that follow. This holds even when holds or loans are created between page reads, including back-timed loans that sort among older ones. A record created while paging appears at most once.
- **Own records.** The caller's own-records rule is applied on every page. A member who sends a cursor obtained by anyone else, staff included, still receives only their own records.

**Due reminder.**
- **When it is queued.** For each loan, and for each `due_at` the loan has had, one due reminder email is queued within 10 seconds of the moment now is at or after `due_at` minus `SHEDLINE_REMINDER_LEAD_SECONDS` (default 86,400 seconds) and still before `due_at`. The loan must still be out with that same `due_at` at that moment. In grading, `SHEDLINE_REMINDER_LEAD_SECONDS` is set to 691,200 seconds (eight days).
- **Immediate reminders.** A loan that is not overdue when created reaches its reminder moment at once if its `due_at` is less than eight days after the moment it is created. Every walk-in that is not overdue when created qualifies, because its due date is at most 7 days after its checkout date. A loan checked out from a hold whose return date is further away reaches its reminder moment later, when its `due_at` is eight days away.
- **After a renewal.** A renewal gives the loan a new `due_at` with its own single reminder, which names the new due time. A reminder for a `due_at` the loan no longer has is never sent, and a reminder already sent is never sent again.
- **No reminder.** A loan that is already overdue when created, or that is returned before its reminder moment, receives no reminder for that `due_at`.

**Background work.**
- The server runs its expiry, reminder and email-retry work at least every 5 seconds, independently of requests.
- No rule above that is judged at request time (overdue, borrowing pause, borrowing limit, pickup deadline) waits for this work.
- Several copies of the server may run against the same database at the same time. For example, the verifier starts a copy with billing unreachable and a copy with photo storage unreachable next to the main one. Every copy may run the background work, and every expiry, lapse email, reminder and email send still happens exactly once.

### Services (DP-02, DP-17, DP-18, DP-21, DP-24, DP-26, DP-27, DP-34, DP-35, DP-40, DP-41, DP-46, DP-47, DP-49, DP-54, DP-57, DP-58, DP-62)

**PostgreSQL** (`DATABASE_URL`) is the system of record for:
- the library settings, the calendar, the late-fee schedule and the borrowing limit;
- people, items and units;
- sessions and the secret that signs sessions and cursors;
- holds, loans, renewals, inspections and photo records;
- idempotency keys and fixed settlement damage charges;
- the ledger and the outgoing email queue.

The server creates its schema and seed rows idempotently on every start, because the database may be empty when the server starts. Unit claims, per-member active counts, photo slots, check-ins, inspections and settlements are decided here.

**Kill Bill** (`KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`):
- **Accounts.** Each member who has any money recorded gets one account. It has external key `shedline-<member id>`, currency USD, and the member's name and email. It is created the first time Shedline records money for that member, and its default payment method is Kill Bill's built-in external payment method.
- **Deposit hold.** At checkout of an item with a deposit, Shedline records one payment with payment external key `shedline-<loan id>-deposit`. It holds one PURCHASE transaction for the deposit in dollars, with transaction external key `shedline-<loan id>-deposit-hold`.
- **Deposit release.** At settlement, when `released_cents` is above 0, Shedline records one REFUND transaction on that deposit payment for the released amount, with transaction external key `shedline-<loan id>-deposit-release`. When `released_cents` is 0, no REFUND is written.
- **Damage kept from the deposit.** On the deposit payment, the purchased amount minus the refunded amount equals `damage_from_deposit_cents`. No other transaction records it.
- **Extra damage.** At settlement, when `extra_damage_cents` is above 0 (items with or without a deposit), Shedline records one payment with payment external key `shedline-<loan id>-extra-damage`. It holds one PURCHASE transaction for that amount, with transaction external key `shedline-<loan id>-extra-damage`.
- **Late fee.** At settlement, when the late fee is above 0, Shedline records one payment with payment external key `shedline-<loan id>-late-fee`. It holds one PURCHASE transaction for the summed, capped late fee from Business rules, with transaction external key `shedline-<loan id>-late-fee`.
- **No duplicates.** No transaction external key ever appears twice. Before writing, the server checks for an existing transaction with that key and reuses it. A checkout that loses a race never reaches Kill Bill, and renewals never reach it (Business rules).
- **Outage.** When Kill Bill is unreachable or answers 5xx, each call gives up within 5 seconds.
  - Checkout or walk-in of an item with a deposit answers `503 billing_unavailable`. It creates no loan, no ledger entry and no deposit payment, and a ready hold stays ready.
  - Items without a deposit lend normally.
  - Settlement behaves as stated in Business rules.
  - Shedline never caches a billing failure for more than 10 seconds. Every new request tries billing again, so lending and settling resume as soon as Kill Bill answers, with no restart.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`):
- **Storage.** Each accepted photo is one object in the bucket with key `loans/<loan id>/<stage>/<photo id>.<jpg|png|webp>`. The photo id is a server-made UUID, the extension follows the detected type, and the object's content type is the detected type.
- **File names.** The uploaded file name is ignored. It never appears in a key, a response or the database.
- **Rejected uploads.** A rejected upload writes no object, or removes any object it wrote before its answer is sent (Business rules › Photos).
- **Outage.** When MinIO is unreachable, upload and download answer `503 photo_storage_unavailable` within 5 seconds. Loan reads still list existing photo records, and every non-photo action works.

**Counter status.** `GET /api/counter/status` reports `up` or `down` for billing and for photo storage, from a probe no more than 10 seconds old.

**Email** (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`):
- **Addressing.** Every message is plain text, sent from `MAIL_FROM` to the member's seeded email address. In development and grading, `MAIL_FROM` is `Common Shed Co. <desk@commonshed.example>`.
- **Delivery.** Messages go through a queue in PostgreSQL, and each message is sent exactly once (Business rules › Background work). If SMTP is briefly unreachable, the server retries until it succeeds. Refused requests queue no message.
- **The four messages:**

| Trigger | Subject | Body lines |
|---|---|---|
| Hold marked ready | `Ready for pickup: <item name>, unit <unit label>` | `Pick up by <local time of pickup_deadline>.` |
| Ready hold expires | `Hold lapsed: <item name>, unit <unit label>` | `Your pickup window closed at <local time of pickup_deadline>. The unit is back on the shelf for other members.` |
| Due reminder | `Due back <local time of due_at>: <item name>, unit <unit label>` | `Please return it by <local time of due_at>, washed out and with batteries charged.` |
| Loan settled | `Settlement receipt: <item name>, unit <unit label>` | `Deposit held: <money>`<br>`Deposit released: <money>`<br>`Damage charge: <money>`<br>`Charged beyond deposit: <money>`<br>`Late fee: <money> (<late days> late days)`<br>`Total charged: <money>` |

The receipt figures are the settlement's `deposit_cents`, `released_cents`, `damage_cents`, `extra_damage_cents`, `late_fee_cents` and `total_charged_cents`, in that order. The Receipt region on the loan page shows the same six lines.

### Seed data (DP-03, DP-06, DP-12, DP-29, DP-32, DP-47, DP-51, DP-52)

Every seeded person, business, email address and phone number below is invented.

**Library.**
- Name: "Common Shed — Eastgate".
- Time zone: `America/New_York`.
- Open days: Tuesday through Sunday (closed Monday); `open_days` is `["tue","wed","thu","fri","sat","sun"]`.
- Closure dates: `closed_dates` is `["2026-07-04","2026-11-26","2026-12-25","2026-12-26"]`.
- Hours: opening 10:00, closing 18:00.
- Late-fee schedule: `[{"effective_from":"2026-01-06","cents_per_day":50},{"effective_from":"2026-09-01","cents_per_day":100}]`. The founder raised the late fee from 50 cents to $1.00 a day from 1 September 2026.
- Borrowing limit: `max_active_per_member` is 4.

**People.** Every seeded password is `pegboard-2026`.

| id | Name | Role | Email | Phone |
|---|---|---|---|---|
| `usr-rosa` | Rosa Lindqvist | founder | `rosa@commonshed.example` | 555-0100 |
| `usr-dev` | Dev Okafor | volunteer | `dev@commonshed.example` | 555-0101 |
| `usr-ines` | Ines Marchetti | volunteer | `ines@commonshed.example` | 555-0102 |
| `mem-hal` | Hal Brennan | member | `hal@members.example` | 555-0141 |
| `mem-mina` | Mina Castellanos | member | `mina@members.example` | 555-0142 |
| `mem-tobi` | Tobi Adeyemi | member | `tobi@members.example` | 555-0143 |
| `mem-wren` | Wren Kowalski | member | `wren@members.example` | 555-0144 |
| `mem-sol` | Sol Navarro | member | `sol@members.example` | 555-0145 |
| `mem-juno` | Juno Achterberg | member | `juno@members.example` | 555-0146 |

**Items**, in this order. Unit ids are `<item id>-<n>`, with `lane_index` `n − 1`.

| id | Name | Category | Units (labels) | Deposit | Replacement |
|---|---|---|---|---|---|
| `tile-saw` | 7-inch wet tile saw | Masonry | TS-1, TS-2 | $50.00 | $189.00 |
| `pressure-washer` | Electric pressure washer | Cleaning | PW-1, PW-2, PW-3 | $40.00 | $249.00 |
| `carpet-cleaner` | Carpet cleaner | Cleaning | CC-1, CC-2 | $60.00 | $329.00 |
| `floor-sander` | Orbital floor sander | Power tools | FS-1, FS-2 | $75.00 | $899.00 |
| `laser-level` | Self-levelling laser | Measuring | LL-1 | $25.00 | $139.00 |
| `ext-ladder` | 24-foot extension ladder | Ladders | LD-1 | No deposit | $219.00 |
| `drill-driver` | Cordless drill driver | Power tools | DR-1, DR-2, DR-3, DR-4 | No deposit | $129.00 |
| `hedge-trimmer` | Hedge trimmer | Garden | HT-1, HT-2 | No deposit | $99.00 |
| `post-hole-digger` | Post hole digger | Garden | PH-1 | No deposit | $45.00 |
| `stud-finder` | Stud finder | Hand tools | SF-1, SF-2 | No deposit | $24.99 |

At start there are no holds, loans, renewals, photos, ledger entries, idempotency keys, fixed damage charges or queued emails.

## Technical requirements

### Deployment (DP-01)

- **Runtime.** Node.js 22 with npm is available. Build in TypeScript.
- **Run manifest.** The app root `/app` holds `run.json` with the string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- **Serving.** `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set, and serves both the browser app and the API from that one origin.
- **Health.** `GET /api/health` answers HTTP 200 `{"status":"ok"}` as soon as the server accepts requests.

### Configuration and secrets (DP-02)

- **Read at start.** The server reads these variables at start:
  - `DATABASE_URL`
  - `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
  - `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
  - `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
  - `APP_PUBLIC_PORT`
  - `SHEDLINE_PICKUP_WINDOW_SECONDS`
  - `SHEDLINE_REMINDER_LEAD_SECONDS`
- **Secrets.** No value is hard-coded, logged in full or sent to the browser. The browser only ever talks to the app's own origin.
- **Session signing and cursors, shared by every copy.** Several copies of the server may run against the same database on the same host (Business rules › Background work), and the browser sends the same session cookie to all of them. A session or cursor issued by any copy is therefore valid on every copy that shares the database. Any session-signing secret, and any secret that makes cursors tamper-evident, is created once and stored in PostgreSQL, where every copy reads it. It is never kept only in one process's memory, and it is never committed.

### Server boundary (DP-05, DP-27, DP-40, DP-60)

- **Same origin.** No CORS headers are sent. A POST or DELETE whose `Origin` header differs from the app's own origin answers `403 cross_origin` before any other check.
- **Request format.** JSON endpoints require `Content-Type: application/json`, and photo upload requires `multipart/form-data`. Anything else answers `415 unsupported_media_type`.
- **Body limits.** JSON bodies may be up to and including 16,384 bytes. Photo upload bodies may be up to and including 5,500,000 bytes in total. Larger bodies answer `413 body_too_large` without being read in full.
- **Photo checks.**
  - Photo type is judged only by the file's first bytes: JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`), or WebP (`RIFF`, four size bytes, then `WEBP`).
  - The declared type and the file name are ignored.
  - SVG, HTML, PDF and anything else answer `415 unsupported_photo`.
- **Opaque errors.**
  - **One shape.** Every error body is exactly the published error object: `code` and `message`, plus `fields` for validation. It has no `detail`, `cause`, `stack` or other key.
  - **What no error body contains.** No error body ever contains a stack trace, SQL, a file path or a library name.
  - **Extra rule for 503 answers.** Every `503` answer, and the Counter services banner, contains none of these:
    - the configured provider URL, host, or host and port;
    - `ECONNREFUSED` or `ETIMEDOUT`;
    - the words `Kill Bill`, `killbill`, `MinIO`, `minio` or `S3`.
  - **Headers.** No response header carries any of those values or words.
- **What is never served.**
  - Source files, `run.json`, `package.json`, lockfiles, environment files, source maps of server code and anything outside the built browser assets all answer `404 not_found`. That includes `/.env`, `/run.json`, `/package.json` and `/src/`.
  - Paths with `..` segments or an encoded `%2e%2e` never leave the asset folder.
  - Unknown `/api` paths answer `404 not_found` in the error shape.
  - Any other path serves the browser app.
- **Dependencies at boot.**
  - If Kill Bill, MinIO or SMTP is unreachable at boot, the server still starts, answers health and serves everything that does not need that dependency. It picks the dependency up on the next request after it returns, with no restart.
  - If PostgreSQL is unreachable at boot, the server retries every 2 seconds and starts serving once it connects.

### Browser support and performance (DP-42)

- **Browsers and viewports.** The app works in current Chromium, Firefox and WebKit at 375×812, 768×1024 and 1280×800.
- **Responsiveness.**
  - With the seed data on a local network, the catalogue is usable within three seconds of navigation.
  - A hold request answers within one second when there is no contention.
  - The lanes show a new hold as soon as the lane drop finishes.
  - Each page of holds or loans answers within one second at any page size up to 50.

## Working rules

- **IF-01** `/app/run.json` is a JSON object with exactly the string fields `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- **IF-02** `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package and every bundled font with its name, version and licence, where shipped packages are the production dependency tree reported by `npm ls --omit=dev --all --json`.
- **IF-03** Every shipped package (as defined in IF-02) and every bundled font is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or OFL-1.1.
- **IF-04** No datastore is used beyond PostgreSQL, Kill Bill, MinIO and the SMTP server: no SQLite, Redis, embedded database, or files written by the app to hold records.
- **IF-05** The provided service configuration files and their environment values are left unchanged.
- **IF-06** The browser loads nothing from third-party hosts; fonts, scripts and styles are served by the app itself.
- **IF-07** `package-lock.json` is committed and the `install` command installs from it.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes. Names use this brief's domain terms: hold, loan, unit, lane, span, open day, closure date, deposit, release, damage charge, extra damage, late fee, late-fee schedule, renewal, settlement, ledger entry, pickup deadline, borrowing pause, borrowing limit, cursor.
- Each domain rule is decided in exactly one place in the source:
  - each hold or loan state transition;
  - the open-day calendar;
  - the occupancy and free-unit check;
  - the active count and borrowing limit;
  - the borrowing pause;
  - the due instant;
  - the late-day count;
  - the per-day rate lookup and capped late fee;
  - the settlement split;
  - the photo stage and limit;
  - the per-role response fields;
  - the cursor position.
- Every API error is produced through one error shape and one precedence order. No handler builds its own ad hoc error body.
- Money is integer cents end to end and becomes dollars only when formatted for display, email or Kill Bill. No floating-point arithmetic touches an amount.
- Library-time calculations go through the configured IANA time zone. No fixed offsets or browser-local time appear in server logic.
- Idempotency-Key handling is applied the same way to every keyed endpoint, from one place, and a failed request never leaves a stored response or an in-progress marker behind.
- There is no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive check for a state the types or the database already rule out.
- There are no features, endpoints, screens or settings beyond this brief.
