# Pass Window Software Lineboard

Lineboard is a booking and billing board for independent shared commercial kitchens. These are commissaries and incubator kitchens that rent prep stations and ovens by the hour, and slots on walk-in shelves by the day, to caterers, food trucks and packaged-food startups. Four kinds of people use it:
- The **kitchen operator** runs the business.
- The **shift lead** runs the floor.
- **Member producers** rent time and space.
- A **health inspector** gets a read-only view of the kitchen's records for a limited time.

One Lineboard install serves several kitchens. Each kitchen sees only its own data.

Lineboard uses four backend services:
- **PostgreSQL** is the system of record.
- **Kill Bill** holds each member's account, charges, credits and month-end invoices.
- **Mailpit** is an SMTP mail sink that receives all outgoing email.
- **MinIO** is S3-compatible object storage. It holds certificate files and monthly sanitation-log PDFs.

Out of scope:
- self-registration of members, kitchens or staff;
- password reset;
- changing anyone's role;
- online card payment;
- sales tax;
- multiple currencies;
- any datastore beyond the services named here.

Every person, kitchen and business comes from the seed data.

## Problem and users

Most shared-kitchen operators still run bookings through form builders, shared calendars and spreadsheets. This costs them money and exposes them to liability:
- Two members book the last evening oven block and both turn up.
- Three caterers each believe they have the last slot on the walk-in shelf for the weekend.
- A caterer lets go of a hold, but the oven stays blocked for minutes until some cleanup runs, the next caterer is turned away, and the dropped hold still shows in booking lists as if it were a real cancellation.
- A member confirms several blocks at once from two phones and books more hours than their plan allows. The operator only notices at month end.
- On a slow connection, a late screen refresh brings back a ticket that had already landed, puts back an older hour balance, and wipes the message that said why a claim failed.
- A late-night bake that runs to midnight cannot be entered at all, so it goes on a sticky note and never reaches the bill.
- A member cooks after their insurance certificate or food-handler card has expired. That voids the operator's own cover. Sometimes the card expired between booking and arrival, and nobody checked at the door.
- Late cancellations on peak blocks go unbilled, or a cancellation retried on a weak signal gets billed twice. When staff move a block into another week or month, the fee and the credit often land in the wrong month.
- Month-end statements are rebuilt by hand from sign-in sheets, so hours get lost or charged twice. Statements sometimes go to the wrong caterer, or arrive with a garbled business name in the subject.
- Someone corrects a charge directly in the billing system, and the month closes on a figure that no longer matches the bookings.
- After the books are closed, a fair waiver or a caterer's rename quietly changes last month's figures. The bookkeeper's numbers then stop matching the statements already sent. Some tools even keep a hidden "reopen" button that anyone can press.
- The bookkeeper's usage export leaves out credits filed after a close, so its totals never match the invoices. A negative amount in it gets turned into text and no longer adds up.
- On a slow office connection, a report for last month arrives after the operator has already moved to this month, and the screen quietly shows the wrong month's figures under this month's name. The member picker does the same: it shows the matches for what the operator typed two keystrokes ago.
- An invoice left open on screen keeps saying charges are waiting for billing long after they were recorded, or it refreshes and throws away the dialog the operator was in the middle of.
- A rate change scheduled for later shows as current on one screen and as still scheduled on another long after it took effect, depending on whose clock is looking, and the settings page throws away half-typed rates whenever it refreshes.
- Someone guesses passwords on the shared sign-in tablet by the door, and a session left open there keeps working after sign-out.
- A web page left open in another tab on that tablet quietly sends sign-ins and sign-outs to the booking system, locking the shift lead out or signing them out mid-shift.
- The shared tablet by the door shows the previous person's tickets, hour bank or alerts to whoever signs in next, and pressing Back after sign-out brings the previous person's board straight back.
- The tablet's clock drifts or is set to the wrong zone, so the board opens on the wrong day and offers Check in on blocks that cannot be checked in yet.
- On a phone, the booking details box opens off to the side of a board scrolled to the evening, half its buttons out of reach, and closing it throws the board back to midnight.
- When billing or document storage is down, some tools show raw connection errors with server addresses and storage names, which mean nothing to a caterer and tell an attacker where to look.
- An operator opens an invoice link the bookkeeper sent, has to sign in again, and lands somewhere else entirely.
- On a phone, the documents list is a table squeezed sideways, and turning the phone or resizing the window throws away the approval in progress and the half-filled upload form.
- When the health inspector asks for sanitation and member records, the operator loses an afternoon searching email attachments. Afterwards the operator cannot say what the inspector actually opened, and the link list only shows the inspector's visits after a reload. An inspector's tablet with the wrong clock shows a link as still open after it ended, or as closed while it still works.

Existing tools handle self-service booking and usage billing. Operators still have to keep track of these themselves:
- certificate expiry dates;
- rate changes that start on a set date;
- no-show rules;
- shelf capacity;
- peak-hour rules.

Those tools also give no honest signal when the payment processor or document store is down, and they are built for a desk, not for a phone held in a floury hand at the oven.

The four roles:
- **Kitchen operator** (daily):
  - sets up stations, rates, peak windows and document requirements;
  - approves member documents;
  - waives fees when that is fair;
  - reviews reports by month;
  - closes the month with exact invoices and one statement per member.
- **Shift lead** (daily):
  - runs today's line board, often from the shared tablet by the door;
  - checks members in and out;
  - logs sanitation;
  - takes stations out of service;
  - moves or releases the blocks that clash with an out-of-service period.
- **Member producer** (weekly):
  - books station and oven hours and walk-in shelf days, often from a phone in the kitchen;
  - keeps certificates current;
  - keeps their business name up to date;
  - sees an exact bill before the month closes.
- **Health inspector** (occasional): reviews one kitchen's sanitation log and current member certificates through a read-only link that expires. The inspector's device clock and time zone may be wrong.

## Journeys

1. **Book an evening oven block.**
   - Start: Ada Bello (Bello Bakes) is signed in, and today's line board is open.
   - Ada clicks a free evening slot in the Oven 2 lane, fills in the New booking dialog and holds the block. A ticket appears on the rail with its quote and the time the hold runs out.
   - Ada presses Confirm. The kitchen Wi-Fi drops, so the browser quietly sends the same request again; its JSON may come out with the keys in a different order. The ticket travels into the Oven 2 lane and becomes a block. At the same time:
     - the hour-bank figures in the header count down to the new balance;
     - any part of the block inside a peak window gets an orange hatched band marked "peak".
   - Ada also books Oven 2 from 20:00 to midnight on a Sunday for an overnight proof. The block runs to the right end of the hour ruler, and a 00:00 block on the same oven the next morning stays free.
   - The following week Ada books from her phone at the bench, with reduced motion turned on. She taps a free evening cell in the Oven 2 lane, and New booking opens already filled in. She holds the block, the rail strip shows the new ticket, and she taps Confirm. The block appears in its lane at once inside a brief ring, the header figures change in one step to the new balance, and the page never shifts sideways.
   - End:
     - each block is on the board once;
     - Ada's inbox holds one confirmation email per block;
     - Bello Bakes' Kill Bill draft invoice for that month holds one charge per block;
     - if billing is down, the block shows "Pending billing", the status banner explains why, and its waiting count goes up within a second of Ada's confirm. Nothing Ada sees names a server, a port or an error from the billing system.
2. **Race for the last oven block, the last shelf slot, and the hour bank.**
   - Start: Ada and Kofi Mensah (Smokestack Truck) press Hold block on the same evening Oven 2 block at the same moment. One of them gets the ticket and confirms it into the Oven 2 lane. The other gets no ticket. Their New booking dialog stays open with what they typed, and an alert names the block that went. The board refreshes behind the dialog; the dialog, the typed notes and the alert stay exactly as they were.
   - Walk-in Shelf B has two slots, and one is already taken for Saturday. Kofi and Rina Sato both hold Saturday at once. Kofi wins. Rina is told Shelf B is taken for that date, the Saturday cell reads "0 of 2 free", and she leaves her New booking dialog open.
   - A minute later Kofi changes his mind and discards his Saturday ticket. The slot is free at that instant, without waiting for any cleanup. Rina presses Hold block again and wins, and Saturday reads "0 of 2 free" once more. Kofi's discarded ticket never comes back on his rail, even from a board read sent before his Discard answered, and his Bookings list never shows it.
   - Later, Kofi holds six four-hour blocks on one day next month across the prep stations and ovens. His plan gives 20 hours a month. Holds do not use hours, so each hold is accepted. Kofi then confirms all six from the rail in quick succession on the tablet's slow connection. A board read the tablet sent just before his first Confirm arrives only after all six confirms have answered, and the confirm answers arrive in the reverse of the order he pressed them.
   - End:
     - five tickets land in their lanes, and the header reads 0 h left for that month;
     - the sixth ticket travels back to the rail, still held, and the alert says it needs 4 hours with 0 left for that month;
     - the late board read changes nothing: no landed block returns to the rail, the header never shows an older balance, and the alert keeps its words while the board keeps refreshing;
     - the board, the invoice and the export all show 20 hours used.
3. **Weekly prep across the clock change.**
   - Start: Kofi needs Prep Station 1 every Tuesday from 05:00 to 09:00 for six weeks. Those weeks span the autumn clock change and a month boundary.
   - Kofi holds a weekly series and confirms it. Each month's hour bank is checked separately.
   - Later Kofi cancels one Tuesday.
   - End:
     - every other Tuesday still shows a 05:00–09:00 block on the board, each charged for four hours;
     - only the cancelled week has a credit and a cancellation email.
4. **Cancel after a move into another month, then get the fee waived.**
   - Start: Marisol Vega, the operator, has scheduled a new oven rate from 00:00 on the first of the month after next. Ada has a confirmed Oven 2 block early in that month, priced at the new rate.
   - Theo Lindqvist, the shift lead, moves the block to a free Oven 1 slot that starts within the next 48 hours. The moved block now falls in the current month or the next one. It is priced at the rate in force for it, which is the old rate.
   - Ada cancels on the kitchen Wi-Fi, and her browser retries the request. At the same moment Marisol, who took Ada's call, cancels it from her desk. The moved block starts within 48 hours, so the fee is half the moved block's charge.
   - Marisol opens Bello Bakes' invoice for the moved block's month from a link. She has been signed out, so Lineboard asks her to sign in. She mistypes her password once, signs in, and lands on that same invoice. She waives the fee. Her browser retries the waiver too.
   - Rina has asked about her own bill, so on the slow office connection Marisol quickly types "sat" into the member picker. The suggestion list opens as she types. The list for "s", which arrives last, is ignored: the list shows only "Sato Pickle Co. · Rina Sato". One press of ArrowDown makes that option active, and Enter picks it, which leaves the address alone. She then presses Show invoice.
   - End:
     - there is exactly one cancellation, one fee, one credit, one waiver credit, one cancellation email and one waiver email;
     - the invoice for the month after next nets to $0.00, and Ada's hour bank for that month is back to the full allowance;
     - the moved block's month shows the new booking charge, the fee, the cancellation credit and the waiver credit, and totals $0.00;
     - the address now names Rina and the same month.
5. **Run the line and resolve a conflict.**
   - Start: Ada has just used the shared tablet by the door to check her held ticket, and signed out while the board was still loading. The tablet's clock is two days fast and set to a far-off time zone.
   - While nobody was watching, a page from another website left open in a tablet tab sent a stream of sign-ins for Theo's email and a sign-out. Lineboard refused every one of them as coming from another site and counted none of them.
   - Theo comes to sign in on the tablet.
     - In the last few minutes, someone at the door has tried his email with five wrong passwords. Lineboard refuses even his correct password and tells him how many minutes to wait. He tries on his own phone and is refused the same way.
     - Once the wait is over he signs in on the tablet. Nothing of Ada's appears: no ticket, no hour bank, no alert, not even the board response that was still on its way when she signed out. Pressing Back shows the sign-in screen or his own board, never hers. A copy of Ada's session cookie no longer opens anything.
     - The board opens on the kitchen's today, scrolled to the kitchen's current hour, whatever the tablet's clock says. Block details on a block starting in half an hour offers Check in and Pick up to move; on a block three hours away it offers only Pick up to move.
   - Theo also uses his phone during the shift.
     - On the phone, the navigation and Sign out stay out of the way behind Menu. Theo opens Menu, and it stays open while the board refreshes behind it until he chooses Sanitation, taps outside it or presses Escape. Following a Reports link someone sent him lands him on the board, with an alert saying that screen is not available for his role.
     - Theo scrolls the board sideways to the 22:00 hour and taps the 23:00–24:00 block. Block details opens across the width of the screen above the board, with every button inside the screen and tappable; a tap where another block shows behind it does nothing. After Close, the board is still scrolled to 22:00 with focus on that block.
   - Theo checks members in and out.
     - Earlier, while the kitchen required only food-handler cards, Nadia Okoro booked today's block with the food-handler card Marisol approved for her. Marisol has since made insurance certificates required again, and Nadia's only insurance certificate ran out the day before Lineboard first started. Nadia's check-in is refused with a message naming the certificate and its expiry date, and her block stays Confirmed.
     - A block that nobody checks in turns to No-show by itself once its grace period runs out. Check in is no longer offered on it.
   - Theo opens Block details on a started block to mark a no-show. Marisol has just checked that member in from her own screen. When Theo presses Mark no-show, the block never shows "No-show". It redraws straight away as Checked in, and an alert says why.
   - Oven 1 breaks down, so Theo marks it out of service for the evening.
     - A member's held block on Oven 1 that evening is released.
     - Three booked blocks appear on the rail as conflicts. Their lane blocks show the word "Conflict" with a dashed outline.
   - Back at the tablet, Theo picks the first conflict up using only the keyboard. Focus lands on the ghost of the block, and he steps it along the lanes with the arrow keys.
     - He hears each position read out.
     - Where the time is not free, the ghost shows "Occupied" or "Out of service".
     - Meanwhile Marisol moves the same block from her desk to free time on Oven 2, clear of the out-of-service window. When Theo confirms his move, it is refused. The block redraws at once where Marisol put it, and its conflict ticket leaves the rail.
   - Theo picks up the second conflict and moves it to free time on Oven 2. He releases the third conflict free of charge.
   - End: the board shows no conflicts, and every affected member has emails about their bookings.
6. **Change rates.**
   - Start: Marisol opens Settings and schedules higher oven rates from 00:00 on the first of next month. Ada has already held an oven block for next month at the old quote.
   - Marisol also has Settings open in a second tab from earlier. She changes the peak windows in the first tab, then tries to save different windows in the second. The second tab is told the rules changed and shows the windows she saved first.
   - Marisol schedules Walk-in Shelf A at $7.00 a day from a few minutes ahead, and the Rate versions table shows the new version as Scheduled. She opens Station rates for Oven 1 and starts typing a further change. When the shelf version's moment arrives, its row turns Current and the old shelf row turns Past in place, the stations table shows the new shelf rate, and the dialog keeps her typing, her unsaved peak-window row and her focus.
   - Ada confirms the held block after the change is saved.
   - End:
     - a quote for an oven block this month uses the old rate;
     - Ada's confirmed block next month is charged at the new rate and the peak windows now in force, and that amount appears on the ticket after the drop, in Block details and in her confirmation email;
     - when the effective minute arrives, the station's current rate switches without anyone restarting anything.
7. **Keep certificates current.**
   - Start: on the first start of Lineboard, Marisol's Documents screen lists exactly the seeded certificates and cards, each approved at version 2 with its seed file, and Nadia Okoro's insurance certificate already shows as Expired. No expiry email went out when Lineboard started.
   - Rina Sato (Sato Pickle Co.) holds a food-handler card that expires in 40 days. Lineboard refuses a booking that ends after that expiry. A first upload attempt with the wrong kind of file is refused, and nothing is kept. A second attempt while document storage is down is refused with Lineboard's plain storage message, and again nothing is kept.
   - Rina uploads a renewed card from her laptop. Marisol opens the Documents screen and sees it waiting as Submitted.
   - Rina then notices a typo in its expiry date and uploads the card again from her phone. Her laptop upload now shows as Superseded, and the phone upload waits for approval. On the phone her documents appear as a list of labelled cards; on the laptop, as a table.
   - Marisol's Documents screen, loaded before the phone upload, still shows the laptop upload as Submitted. Approving it is refused with a message pointing to the newer card, and that row redraws as Superseded. She reloads, narrows the window to check the phone view while approving the newer card, and the approval carries on busy in the card list without losing her place.
   - End:
     - Rina can hold the block that was refused before;
     - expiry notices arrive by email 14 days and 3 days before a member's current card or certificate runs out, and only for that current document.
   - For example: Nadia joins with no food-handler card. When Marisol approves Nadia's first food-handler card, which expires in 10 days, it becomes current and the 14-day notice arrives at once.
8. **Month end, a renamed business and the inspector.**
   - Start: it is month end at Northside Commissary.
   - Marisol opens Reports for the month on the office's slow connection and quickly steps to the next month and back with the browser. A month's figures that arrive after she has left that month are ignored: the heading, the table, the totals and the export link always name the month in the address. She downloads the usage CSV for the bookkeeper.
   - She checks a member's invoice in two tabs. Some lines still read "Pending billing". She opens the Close month dialog and leaves it open while she reads; behind it the invoice refreshes, and those lines turn "Billed" in place without closing the dialog or moving her focus. She closes the month in the first tab.
     - Her first attempt is refused before anything is committed: the bookkeeper added a charge to one member's draft directly in Kill Bill, so that draft no longer matches Lineboard. The alert names the business, the month stays open and no statement goes out. The bookkeeper reverses the charge in Kill Bill, and Marisol closes again.
     - While it closes, the polite announcement says so. The Close month button stays where it was, with the same name, and is marked busy.
     - In the second tab, Close month is refused because the month is already closed. That tab redraws the invoice as closed, and a refresh that was already on its way never turns it back to open.
     - Every member with lines that month gets one statement email in the same plain layout, listing only their own lines and total. A member whose lines net to $0.00 still gets one.
   - Nothing in Lineboard reopens a closed month or edits its invoices; a request that tries answers that no such thing exists, and the books stay as they were.
   - A week later Marisol waives a late fee from the closed month. The closed month's invoice, report and CSV do not change. The credit appears as an adjustment on the member's open invoice, and that open month's usage CSV gains an adjustment row with a negative charge, so the file still adds up to the invoices.
   - Ada then renames her business to a name with accented letters and a bread emoji.
     - Lineboard counts each emoji as one character.
     - The board, the member picker, next month's export and new emails show the new name exactly.
     - Her Kill Bill account shows it too, with the emoji replaced by U+FFFD, because Kill Bill cannot store emoji.
     - A name with a hidden line separator pasted from a document is refused.
     - The closed month's export and the statement already sent keep the name in force at close.
   - Marisol saves the month's sanitation PDF and sends the inspector a link that expires. She stays on Sanitation, starts typing a second inspector's email, and keeps typing.
   - The inspector opens the link on a tablet whose clock is two days ahead and set to another time zone. The view still shows the records and the time the link is available until, in kitchen time. The inspector reads the log and downloads a certificate. Within seconds, without a reload and without losing her typing, Marisol sees the views, the download and the last-opened time counted against the link.
   - Marisol revokes the link while the inspector still has the page open. When the inspector then presses a certificate download, nothing downloads; the view changes in place to say the link is no longer active.
   - End: the link shows as revoked, and its access history remains.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Role sessions** Each seeded person signs in with email and password and gets a fresh server-side session whose role (operator, shift lead or member) decides which screens and endpoints they reach, and signing out ends that session on the server for every copy of its cookie, as set out in API.
- **DP-02 — Kitchen-scoped records** Every record, list and lookup is limited to the signed-in person's kitchen, and an id from another kitchen answers 404 exactly as an unknown id does.
- **DP-03 — Kitchen-time line board** The line board opens on the date in its address, or on today in the kitchen's time zone when none is given, and places every block against an hour ruler in kitchen local time, whatever the server's or browser's zone.
- **DP-04 — Private blocks on a shared board** A member sees other members' blocks on the board only as "Booked" with no business name, member id or notes, while staff see who booked each block.
- **DP-05 — Open today's board** A shift lead signs in, lands on today's line board for their kitchen with every station lane, and moves to the next day and back with the date controls.
- **DP-06 — Holding a block** A member holds a free block on a station as a ticket on the rail, and the hold lapses on the server after the hold time in Business rules unless confirmed.
- **DP-07 — Confirming a hold** Confirming a held ticket makes it a confirmed booking priced again at confirm, debits the hour bank and records the charge in Kill Bill, reporting pending billing instead when billing is not yet recorded.
- **DP-08 — Retry-safe booking requests** Repeating a hold or confirm with the same Idempotency-Key, including concurrent repeats still in flight and repeats whose JSON differs only in key order, whitespace or an empty body for {}, returns the original response without a second hold, charge or email, and reusing a key with a different request answers 409.
- **DP-09 — Exact block pricing** Each block's charge splits its quarter hours into peak and off-peak at the station's applicable rates and rounds once to the cent by the published rule.
- **DP-10 — Hour bank** A member's hour bank for each kitchen-local month equals the plan allowance minus that month's hour ledger, computed on the server, checked month by month for a series, and shown identically on the board, the invoice and the export.
- **DP-11 — Booking confirmation email** Each confirmed booking sends exactly one confirmation email to that member only, carrying their business name, the block, its charge and the remaining hours.
- **DP-12 — Book a block from the rail** A member opens the board, holds an evening oven block, confirms it from the rail and sees it committed in the oven lane with the hour bank lowered and the peak part marked.
- **DP-13 — One winner per block** When holds, confirms of lapsed holds and moves claim overlapping time on one hourly station at once, exactly one succeeds, a series wins whole or not at all, and every loser answers 409 naming the block that went with no hold, ledger entry, charge or email left behind.
- **DP-14 — Own bookings only** A member reaches only their own bookings, tickets, invoices and hour bank by id, and any other member's id answers 404.
- **DP-15 — Race for the last oven block** Two members try to hold the same last evening Oven 2 block at the same moment; one gets the ticket and books it, and the other gets no ticket and an alert naming the block that went.
- **DP-16 — Weekly series** A member can hold the same block for 2 to 12 consecutive weeks in one request, which succeeds for every week or for none; confirming any week confirms them all, and cancelling one week cancels only that week.
- **DP-17 — DST-safe wall-clock times** Weekly blocks keep their local start time across clock changes, billed hours equal wall-clock hours, an hourly block may end at 24:00 of its date but never start there, and local times that do not exist or repeat follow the rule in Business rules.
- **DP-18 — Book a weekly prep series** A member books Tuesday 05:00–09:00 prep for several weeks spanning a clock change and sees every week at 05:00 on the board and charged for four hours.
- **DP-19 — 48-hour cutoff in kitchen time** A confirmed booking cancelled 48 hours or more before the start of its current (post-move) block in kitchen time is free, and later cancellations are late.
- **DP-20 — Late-cancellation penalty** A late cancellation charges half the booking's current charge, rounded as published, recorded in Kill Bill in the block's current month and stated in the cancellation email and on the invoice.
- **DP-21 — Operator-only waiver** Only the kitchen operator can waive a late-cancellation penalty, which credits it back in Kill Bill in the fee's month or, when that month is closed, as an adjustment in the earliest open month, and a shift lead or member attempting it gets 403.
- **DP-22 — Cancel and waive a fee** A member late-cancels a block that staff moved into a different kitchen-local month, sees the fee priced from the moved block, and after the operator waives it both months' invoices net to the published totals.
- **DP-23 — Block state machine** Bookings move only along the transitions in Business rules, including a check-in window that closes at the no-show grace instant, and every other action answers 409 with the current state and the current booking.
- **DP-24 — Run today's line** A shift lead checks a member in on today's board, checks them out and marks a different block as a no-show, each change showing on the board once the server confirms it.
- **DP-25 — Out-of-service conflicts** A shift lead marks a station out of service for a period, settled one at a time against concurrent claims on that station, and every confirmed booking overlapping it is flagged as a conflict on the rail and in its lane until moved or released free of charge, while overlapping holds are released.
- **DP-26 — Moving a block** A shift lead or operator moves a confirmed block to free time on a station of the same kind, re-pricing it and re-checking the target month's hours, with exactly one winner among concurrent moves, 409 for an occupied target or a closed month and 412 when the block changed since it was picked up, each refusal carrying the current booking.
- **DP-27 — Keyboard-complete board** Every board action works from the keyboard alone, dialogs keep focus inside, Escape closes them and focus returns to the control that opened them.
- **DP-28 — Resolve a conflict by keyboard** Using only the keyboard, a shift lead picks up a conflicting block from the rail, moves it to a free lane slot, confirms the move and sees the conflict cleared.
- **DP-29 — Effective-dated rates** The operator schedules new station rates from a future kitchen-local moment, and blocks starting before that moment keep the old rate even when confirmed later.
- **DP-30 — Kitchen rule settings** Only the operator changes station rates, peak windows and required documents, a shift lead or member attempting any of them gets 403, and a peak-window or requirement save carrying a stale rules version answers 412 with the current kitchen.
- **DP-31 — Change a station rate** The operator raises the oven rates from the first of next month, and a member then sees an oven block this month quoted at the old rate and one next month at the new rate.
- **DP-32 — Document upload checks** Members upload insurance certificates and food-handler cards only as PDF, PNG or JPEG judged by file content, up to the published size, with storage object and record created together or not at all.
- **DP-33 — Safe document delivery** Stored documents are only ever served as downloads with their detected type, never rendered as active content, and only to their member, their kitchen's staff and valid inspector links.
- **DP-34 — Document approval and expiry states** The operator approves the version of a submitted document they have on screen, a newer upload of the same type supersedes an older submitted one even when both arrive at the same moment, and approved documents show as approved, expiring or expired from their expiry date in kitchen time, as qualified in Business rules.
- **DP-35 — Bookings limited by document expiry** A member cannot hold a block that ends after the end of the expiry date of any required document, or without an approved one of each required type, as qualified in Business rules.
- **DP-36 — Expiry warning emails** Each member's current document of each type triggers at most one 14-day and one 3-day expiry notice email to that member, as qualified in Business rules.
- **DP-37 — Keep certificates current** A member uploads a new food-handler card, the operator approves it, and the member can then book a block they were refused before.
- **DP-38 — Member invoice** A member or the operator sees the member's invoice for a month, with every charge, penalty, credit and adjustment line, its billing state and an exact total.
- **DP-39 — Month close in Kill Bill** Closing a month commits each member's Kill Bill invoice for that month exactly once at the same total Lineboard shows and freezes bookings in that month, while a refused, repeated or concurrent close changes nothing more and a confirm racing the close either lands on the committed invoice or answers 409 with nothing written.
- **DP-40 — Close the month** The operator reviews a member's invoice and closes the month with its progress and result announced in the polite live region, sees the invoice marked closed even when another tab closed it first, and each member with lines that month finds their statement in their inbox.
- **DP-41 — Utilisation totals** The operator's monthly utilisation report totals hours, peak hours, shelf-days and revenue per station, plus the month's adjustment credits, for their own kitchen only.
- **DP-42 — Member picker** The staff member picker matches name or business name as a literal, case-insensitive substring, never email, within the signed-in kitchen only.
- **DP-43 — Usage export** The operator downloads a monthly usage CSV of their own kitchen's bookings in which any text cell that could run as a spreadsheet formula is neutralised, numeric cells are written as plain numbers, and adjustment rows make the file reconcile to the invoices.
- **DP-44 — Export usage for the bookkeeper** The operator opens Reports for a month, steps to the next month and back with the browser, and downloads the usage CSV for the month shown, whose totals match the members' invoices.
- **DP-45 — Sanitation log** Shift leads and the operator log timestamped sanitation entries that cannot be edited afterwards and appear on the kitchen's log in kitchen time.
- **DP-46 — Monthly sanitation PDF** The operator saves a month's sanitation log as a PDF in document storage, queued while storage is unavailable and rendered when it is stored, as qualified in Business rules.
- **DP-47 — Inspector links** The operator sends an inspector a read-only link with an expiry, which stops working at that time, on revocation, or when regenerated, with exactly one live token after concurrent regenerations, while the link keeps its access history.
- **DP-48 — Inspector read-only view** A valid inspector link shows only that kitchen's sanitation log, monthly PDFs and the member certificates current at the moment of each request, refuses every change, and every inspector response is marked never to be cached or sent on as a referrer.
- **DP-49 — Share records with an inspector** The operator logs an entry, saves a monthly PDF and sends a link with each step announced in the polite live region; the inspector opens it and downloads a certificate, the operator sees those visits counted on the link, and after revocation the inspector sees the link is no longer active.
- **DP-50 — Billing outage** While Kill Bill is unreachable, confirmations still succeed as pending billing with queued charges and month close is refused, as qualified in Services.
- **DP-51 — Storage outage** While document storage is unreachable, uploads and downloads are refused with nothing half-saved, and sanitation PDFs are queued, as qualified in Services.
- **DP-52 — Recovery without restart** The app starts and serves with Kill Bill or document storage unreachable and finishes queued work on its own once the service returns, as qualified in Services.
- **DP-53 — Ride out a billing outage** A member confirms a booking while billing is down, sees the block marked pending billing and the status banner's waiting count updated within one second of the response without the banner being redrawn, and still receives the confirmation email.
- **DP-54 — Run manifest and health** The app installs, builds and serves from its run manifest on the published port and answers the health check while dependencies are still unreachable.
- **DP-55 — Server boundary** The server enforces the published body limits and caching headers and never serves source files, the run manifest, package files, configuration or credentials.
- **DP-56 — Rail-to-line drop** Confirming a ticket carries it from the rail into its lane slot while the hour-bank figures roll to the server balance, landing exactly on the stored times and balance, or returning to the rail marked taken when a lapsed hold's time was booked by someone else.
- **DP-57 — Reduced-motion drop** With reduced motion requested, the drop and every other motion are replaced by the instant substitutes in Motion and effects, with the same live-region announcement.
- **DP-58 — Responsive layouts** Every screen works at 375x812, 768x1024 and 1280x800 without the page scrolling sideways, with block labels and controls kept at their published minimum sizes.
- **DP-59 — Visual identity** The board reads as a ruled, square-cornered kitchen ticket board on a pale stainless ground, with ticket orange reserved for live and claimed state and heavy display type for headings and figures.
- **DP-60 — Credentials from environment** Every service URL and credential is read from the environment at start, never written into source or sent to the browser.
- **DP-61 — Paired hour and money ledger** Every hour-ledger entry is written together with its matching Kill Bill charge or credit in the kitchen-local month of the block it concerns, so each member's invoice total and used hours per month equal the sums published in Business rules.
- **DP-62 — Automatic no-show** A confirmed booking that is not checked in by its grace instant becomes a no-show on the server at that instant, whether or not a sweep has run, and check-in is refused from then on, as qualified in Business rules.
- **DP-63 — Member statement emails** Closing a month sends exactly one statement email to each member with invoice lines that month, carrying only their own lines and total in the published body layout under a subject that decodes to exactly the published text, and a refused, repeated or concurrent close sends nothing more.
- **DP-64 — Shareable report and invoice URLs** The Reports month, the Invoices member and month, the Bookings month and the board date live in the address, so reload, Back, Forward and a shared link reopen the same kitchen view, defaulting to the kitchen-local month or today.
- **DP-65 — Inspector access record** Every successful inspector request leaves exactly one unchangeable access record on its link, the link's views, downloads and last-opened time always equal what those records add up to under concurrent requests, and the records are visible only to that kitchen's operator and kept through regeneration and revocation.
- **DP-66 — Role-shaped member records** Member records carry exactly the published keys for the caller's role, with no email for shift leads, and no response anywhere carries passwords, plan allowances outside the hour bank, Kill Bill ids, storage keys or session ids.
- **DP-67 — Server-true line board** Check-in, check-out, no-show, cancel, release and move never show a result on the board before the server returns it, and a refused action redraws the block at once from the current booking in the 409 or 412 body, or from its unchanged state on a 422, with the published alert.
- **DP-68 — Announced keyboard move** While a block is in hand, picking it up, each step, each edge, occupied or out-of-service time, putting it back and placing it are announced in the polite live region with the ghost's exact block label, and Enter on time that is not free places nothing.
- **DP-69 — Rates take effect on the instant** A rate version's kitchen-local effective time resolves to one instant, with a clock-change gap refused and a repeated time meaning its first occurrence; the current rate switches at that instant without a restart, versions are append-only with exactly one winner per instant, and a hold confirmed after a change is charged at the version in force for its block. Every rate version also carries a past, current or scheduled status decided by the server clock at each request, and Settings redraws its Rate versions table and current rates in place at least every 15 seconds without closing an open Station rates dialog, losing typed rates or unsaved edits, moving focus or trusting the browser's clock.
- **DP-70 — Record and object as one** Every upload check runs before storage is touched, so the member's documents prefix in storage holds exactly one object per document record, at the published key with identical bytes, and refused uploads and outages leave no orphans.
- **DP-71 — Business name changes** A saved business name shows at once on the board, the picker, open-month exports and new emails and reaches the Kill Bill account name, while closed-month exports and sent statements keep the name in force at close.
- **DP-72 — Sign-in throttling** After 5 failed sign-ins for one email within the published window, whether or not the email exists, further sign-ins for it answer 429 with a Retry-After header without checking the password, counted in PostgreSQL so that concurrent failures never yield more than five 401s.
- **DP-73 — Hour bank under concurrent claims** Confirms and moves for one member and month are settled one at a time on the hour bank, taking several months in ascending order, so concurrent confirms succeed in arrival order until the balance runs out, later ones answer 422 on hours with nothing written and stay held, no balance is ever below zero and no request answers 5xx.
- **DP-74 — Retry-safe cancellation and waiver** Cancel and waive-penalty require an Idempotency-Key, replays compared as parsed JSON return the stored response, and concurrent cancels or waivers of one booking with different keys yield exactly one 200 and exactly one fee, credit, ledger entry and email.
- **DP-75 — Exact write bodies** Every write body accepts only its published keys for that endpoint and station kind, and any other key answers 422 "This field cannot be set." with nothing changed.
- **DP-76 — Conflict markers not by colour alone** Conflict blocks, full shelf days and the keyboard ghost on occupied or out-of-service time carry visible words and a non-colour pattern, with marker text at 4.5:1 and outlines and hatching at 3:1 contrast.
- **DP-77 — Text measured in code points** Business names, notes, out-of-service reasons and sanitation tasks are counted in Unicode code points after NFC normalisation and stored in NFC, and business names refuse control characters and line or paragraph separators.
- **DP-78 — Shared shelf capacity** A walk-in shelf rents by the day in slots, so no kitchen-local day ever has more occupying bookings than the shelf's published capacity, concurrent losers answer 409 listing every full day, and each board cell shows how many slots are free.
- **DP-79 — Closed months stay frozen** A closed month's invoices, utilisation report and usage CSV stay byte-identical to their state at close, and a waiver of a fee in a closed month answers 200 and files one adjustment credit in the earliest open month, as qualified in Business rules.
- **DP-80 — Documents at check-in** Check-in also requires, at that instant, a current unexpired document of every type the kitchen then requires, otherwise it answers 422 on documents after any 409, and the block stays Confirmed on the board.
- **DP-81 — Book from a phone** On a 375x812 touch phone with reduced motion, a member taps a free Oven 2 cell, holds and confirms from the rail strip with controls at least 44 by 44 pixels, and sees the block land at once with the exact announcement and the server's balance while the page never scrolls sideways.
- **DP-82 — Seeded documents** On first start each kitchen's documents are exactly the published seed certificates and cards with their statuses, versions, file names and stored objects, dated once from a first-start date stored in PostgreSQL, and later starts never re-date, duplicate or rewrite them or send a notice twice.
- **DP-83 — Only the published API** Every method and path under /api that the endpoint table does not list answers 404 not_found in the JSON error shape and changes nothing, so no request can reopen a closed month, edit its invoices or change its committed Kill Bill invoices.
- **DP-84 — Folded menu on a phone** In the phone layout the navigation and Sign out sit behind Menu and are absent from the accessibility tree, the Tab order and touch while it is folded, and an open menu stays open through refreshes until Escape, an outside tap or a chosen link folds it, as set out in Feedback states.
- **DP-85 — Return to the requested view** A signed-out visit to a screen returns to that view after sign-in through a next address honoured only for the published signed-in screens, anything else lands on the board, and a signed-in person opening a screen outside their role's navigation lands on the board by a replaced history entry with the published refusal copy.
- **DP-86 — Close compares Kill Bill's drafts first** Before its first commit, a close reads every member's Kill Bill draft for the month and, when any amount differs from Lineboard's total, answers 409 billing_mismatch listing the members, commits nothing, sends no statement and leaves the month open, as qualified in Business rules.
- **DP-87 — Latest view wins** Reports, Invoices and Bookings draw only the response for the month and member in the address, discarding an earlier response that arrives after a newer commit, Back or Forward, so the heading, table, totals and export link always describe the address's view.
- **DP-88 — Invoice refresh keeps the operator's place** While it shows an open invoice, Invoices re-reads it at least every 15 seconds so lines turn from Pending billing to Billed in place, without closing a dialog, moving focus, changing uncommitted Month or member text, re-showing a pending or completed waive, or turning a closed invoice back to open.
- **DP-89 — Server-decided inspector link state** The inspector view and the operator's Inspector links table take each link's active, expired or revoked state and its times only from the server and the kitchen's zone, whatever the browser's clock or zone, and a download pressed after expiry or revocation replaces the view in place with the published state copy.
- **DP-90 — Shared tablet hands over cleanly** After sign-out or a 401 the browser draws nothing from that session, including responses still in flight, Back never reopens the earlier person's view, every /api response and screen is marked no-store, and concurrent requests from different kitchens each answer from their own session.
- **DP-91 — Board time and offered actions come from the server** The board response carries the server's now and every full booking carries its actions list for the caller at that instant, and the board's default date, Today, scroll-to-current-hour and the buttons Block details offers come only from these, whatever the device clock or zone.
- **DP-92 — Documents switch at 768 pixels** Below 768 CSS pixels the Documents screen is a list of labelled cards and from 768 up a table with the published headers, both showing the same rows in the same order, switching live on resize while keeping focus, a pending approval, the alert, field errors and the upload form's values.
- **DP-93 — Inspector link activity updates live** While Sanitation is open for the operator, the Inspector links table re-reads the links at least every 10 seconds and redraws Status, Last opened, Views and Downloads in place without moving focus, clearing typed fields, dropping a pending action's busy state or showing a revoked link as Active again.
- **DP-94 — Cross-site requests refused** Every state-changing request under /api judged cross-site by its Origin, Sec-Fetch-Site or Referer headers, as set out in Server boundary, answers 403 cross_origin before any other check, so it is never counted as a sign-in failure, never ends a session and never stores or uses an Idempotency-Key, a sign-in sent as plain text or a form answers 415 uncounted, and no response carries an Access-Control-Allow header.
- **DP-95 — Claim outcomes survive repaints** The line board draws only board responses for requests sent after the person's latest own board action answered, and a refused claim's alert, the drop announcement and the hour-bank figures keep their published values through late responses, earlier drops' results and timed refreshes, as set out in Interactions.
- **DP-96 — Opaque errors** Every error body's message is exactly the published copy for its code, an unexpected failure answers 500 internal with the published copy, and no error body, error-response header value other than Set-Cookie and Content-Disposition, or service-status value contains any of the provider, credential, object-key, SQL, stack-frame or driver literals listed in Server boundary, under the length rule stated there.
- **DP-97 — Member picker follows the latest typing** On Invoices the operator's Member field is an editable type-ahead list that shows only the options for the text currently typed, discarding any earlier text's late response, is chosen by keyboard without changing the address until Show invoice, and keeps every option inside the viewport, as set out in Interactions.
- **DP-98 — Board overlays stay reachable** Block details, Move block, Release block, Out of service, Cancel booking and New booking open wholly inside the viewport above the board at every viewport and board scroll position, with every control hit-testable, the content behind inert, and the board's scroll position kept and focus returned to the opener when they close.
- **DP-99 — Released holds are gone** A hold that ends unconfirmed by discard, lapse or an out-of-service window frees its time or shelf slot at that instant without waiting for a sweep, is left out of booking lists, other members' boards, invoices and exports, and replaying its hold or discard key returns the stored response without occupying time again.

## Frontend

### Screens and layout (DP-03, DP-04, DP-05, DP-12, DP-16, DP-24, DP-38, DP-41, DP-45, DP-48, DP-58, DP-64, DP-65, DP-69, DP-78, DP-81, DP-82, DP-84, DP-87, DP-88, DP-89, DP-91, DP-92, DP-93, DP-97, DP-98)

**Shared frame.** Every signed-in screen uses the same frame:
- A header row holds:
  - the kitchen name in display type;
  - the main navigation;
  - the signed-in person's name, with a sign-out control;
  - for members only, the hour bank for the month on screen. On the board that is the month of the board date. On Bookings and Invoices it is the chosen month. On every other screen it is the kitchen-local current month.
- The service status banner sits under the header. It appears only while a service is down.
- All content sits on a 12-column grid, with visible thin rules between panels.
- The screen's content sits in the `main` landmark.

**Screens:**
- **Sign in** (`/`, optionally `/?next=<address>`): a single centred panel with email, password and the sign-in button. If someone is already signed in, this route sends them on as set out in Business rules › Return addresses.
- **Line board** (`/board?date=YYYY-MM-DD`): anyone signed in can open it, and it is the default landing screen after sign-in. From top to bottom it shows:
  - a date bar with the board date as a level-1 heading, the line "Kitchen time: <IANA zone>", and the previous-day, today and next-day controls;
  - the ticket rail, a narrow strip along the top edge. For members it holds their own held and expired tickets for the board date, so a ticket shows only on its own date: a weekly series has one ticket per week, each on that week's date, and a shelf booking's ticket shows on each of its days. For staff it holds the conflict tickets and the block in hand;
  - the board itself, which fills the rest of the page. Each station is a horizontal lane band, labelled with the station name on the left.

  A fixed hour ruler in kitchen local time runs along the top of the board. It spans the whole day from 00:00 to 24:00, with a mark every hour and a fainter mark every quarter hour.
  - The ruler is a `list "Hour ruler"` with one `listitem` per hour, named "00:00" through "23:00".
  - Each item is exactly one hour wide, and its left edge marks that hour.
  - A time HH:MM sits at the left edge of the HH:00 item, plus MM/60 of that item's width. 24:00 sits at the right edge of the 23:00 item, so a block ending at 24:00 ends exactly there.
  - The ruler and the lanes share one horizontal scale and scroll together. A block's left and right edges therefore sit at the ruler positions of its start and end.

  What the lanes show:
  - Every block in the board response sits in its lane, from its start to its end on the ruler. The only exception is a member's own expired tickets, which appear only on the rail. API › Board contents sets out which bookings the board response carries.
  - Cancelled bookings never appear on the board.
  - Each block's visible label and accessible name follow the block row of Public screens and controls.
  - Out-of-service periods appear as cold-blue cross-ruled bands that carry the reason.
  - Shelf lanes use one cell per day instead of hours.
    - A shelf cell stacks one block for each occupying booking that covers the board date, in order of first day and then booking time. Each stacked block is at least 44 pixels tall, and the lane grows tall enough for the shelf's full capacity.
    - Every shelf cell shows the visible text "<n> of <capacity> free". `<n>` is the capacity minus the occupying bookings covering that date, counting other members' bookings for members too.
    - A full cell also carries cross-ruling.

  How the board scrolls:
  - When the board date equals the response's `today`, the board scrolls so the kitchen-local hour of the response's `now` is in view. On any other day it scrolls to 05:00. The browser's clock and zone are never read for this.
  - The board scrolls sideways inside its own frame. The page itself never scrolls sideways.
  - Board dialogs open above the board in the top layer, as set out in Interactions › Board dialogs.
- **Bookings** (`/bookings?month=YYYY-MM`, members and the operator):
  - a Month field;
  - the booking list region holding a table of the bookings `GET /api/bookings` lists for that month, with a cancel action on each row whose booking's `actions` include `cancel`;
  - for members, a "Business details" panel for editing their business name.
- **Documents** (`/documents`):
  - Members see an upload form and their own documents.
  - The operator and the shift lead see every member's documents in the kitchen. On first start this is exactly the seeded set from Seed data.
  - The operator also gets an approve action on submitted rows.
  - **Two layouts, switched at exactly 768 CSS pixels of viewport width:**
    - Below 768 (767 and narrower), the documents are a `list "Documents"`. Each `listitem` shows six label-value pairs in this order, each label as visible text beside its value: "Business", "Type", "Status", "Version", "File", "Expires". After them come that row's download link and, where it applies, its Approve button.
    - From 768 up, the documents are a `table "Documents"` whose column headers are, in this order: "Business", "Type", "Status", "Version", "File", "Expires", "Actions". The Actions cell holds the download link and, where it applies, the Approve button.
    - Both layouts show the same rows, in the same order (newest upload first, as the API lists them), with the same control names. Neither makes the page scroll sideways.
    - Crossing 768 in either direction, by resizing or rotating, switches the layout live, without a page reload and without fetching the documents again. What carries across is set out in Interactions › Documents.
- **Invoices** (`/invoices?month=YYYY-MM&member=<memberId>`, members and the operator):
  - a Month field and, for the operator, the member picker with its suggestion list;
  - below them, the invoice region: the invoice table, in which every line shows its description, amount and the visible words "Pending billing" or "Billed" from its billing state; the total; the invoice state (open or closed); and the member's hour bank for that month;
  - for the operator, the fee-waive action on penalty lines and the close-month control.

  For an operator whose address has no `member`, the screen shows the picker and no invoice table. Invoices offers no cancellation; bookings are cancelled from Bookings or the board. The picker's suggestion list opens above the invoice region and is never cut off by it.
- **Reports** (`/reports?month=YYYY-MM`, operator): a Month field, then the report region holding a level-2 heading "Utilisation for <Month YYYY>", the utilisation table with its totals row, and the usage export link. The totals row ends with the visible text "Adjustments $<amount>".
- **Sanitation** (`/sanitation`, shift lead and operator):
  - the log-entry form;
  - the log table, newest first. Each row shows the entry's kitchen-local date and time, area, task, sanitizer strength, initials, notes and the name of the person who logged it.

  The operator also gets two more panels:
  - the monthly PDF panel;
  - the inspector links panel: the send-link form, then the links table with the columns Email, Expires, Status, Last opened, Views and Downloads, plus the actions. The table shows the server's figures and statuses: on load, after each of the operator's own link actions, and on the live re-read set out in Interactions › Refresh. "Expires" and "Last opened" are the server's instants shown in kitchen time.
- **Settings** (`/settings`, operator):
  - a stations table showing each station's current rate, as the server reports it;
  - a rate versions table listing every version of every station with its effective moment, its rates and its server-decided status;
  - the peak-window editor;
  - the document-requirements checkboxes.

  The stations and rate versions tables show the server's current rate and statuses as of the latest read, and are re-read live as set out in Interactions › Refresh. The editor and checkboxes show the kitchen rules as loaded, or as returned by the last save or the last stale-save refusal.
- **Inspector view** (`/inspect/<token>`, no sign-in). From top to bottom it shows:
  - the kitchen name;
  - the line "Read-only records for <kitchen name>, available until <date> <HH:MM>", where the date and time are the server's `expiresAt` shown in the kitchen's time zone;
  - the sanitation log table;
  - the monthly PDF links;
  - the member certificates table.

  This view has no navigation and no other surface. In place of the records it can show one of the inspector view states from Feedback states.

**Navigation per role:**

| Role | Navigation |
|---|---|
| Member | Line board, Bookings, Documents, Invoices |
| Shift lead | Line board, Documents, Sanitation |
| Operator | All seven: Line board, Bookings, Documents, Invoices, Reports, Sanitation, Settings |

**Viewports.** At none of the three sizes does the page itself scroll sideways, before or after any dialog, ticket, suggestion list or banner appears. The phone layout applies to every viewport narrower than 768 pixels; from 768 pixels up the navigation and Sign out sit in the header and there is no Menu button.
- **1280x800:**
  - The header is one row.
  - The rail is a single row of tickets across the full width.
  - The board shows about twelve hours across without scrolling.
  - Hourly lane bands are at least 56 pixels tall.
  - Tables use the full grid width.
- **768x1024:**
  - The header wraps to two rows.
  - The rail wraps to two rows of tickets when it needs to.
  - The board shows about eight hours across.
  - Forms stack in one column.
  - Documents is the table layout.
- **375x812 (phone layout):**
  - The navigation and Sign out fold behind a Menu button. The hour bank stays visible in the header, outside the folded panel.
  - The rail becomes a strip of tickets that scrolls sideways inside itself.
  - The board shows about four hours across.
  - Dialogs fill the width of the screen.
  - Documents is the list layout. Every other table row becomes a stacked card that keeps its column labels.

### Public screens and controls (DP-01, DP-05, DP-12, DP-15, DP-22, DP-24, DP-28, DP-31, DP-37, DP-40, DP-44, DP-49, DP-53, DP-64, DP-65, DP-67, DP-68, DP-69, DP-71, DP-72, DP-76, DP-78, DP-81, DP-84, DP-85, DP-86, DP-87, DP-88, DP-89, DP-91, DP-92, DP-93, DP-95, DP-97, DP-98)

Only the controls and regions below are public; everything else is free. Placeholders follow the formats in API › Formats. Status words, marker words and the picker's empty copy follow Feedback states.

| Role and accessible name | Visible copy | Where and who |
|---|---|---|
| field labelled "Email", field labelled "Password" | Email, Password | Sign in |
| `button "Sign in"` | Sign in | Sign in |
| `button "Sign out"` | Sign out | Header; inside the folded panel in the phone layout |
| `navigation "Main"` with links "Line board", "Bookings", "Documents", "Invoices", "Reports", "Sanitation", "Settings" | same | Header, per role; inside the folded panel in the phone layout |
| `button "Menu"` carrying `aria-expanded` and `aria-controls` (naming the panel) | Menu | Header, phone layout only |
| `main` landmark | | Every signed-in screen |
| `group "Hour bank"` | "<hours> h left" and "<Month YYYY>" | Header, members only, at every viewport |
| `region "Service status"` | banner copy from Feedback states | Under the header, only while a service is down |
| `status "Announcements"` (polite live region) | success, pending and keyboard-move copy | Every screen |
| `alert` | error copy | Every screen, including Sign in and the inspector view |
| `heading` level 1 | the board date as "<Weekday> <D> <Month> <YYYY>", for example "Tuesday 27 October 2026" | Board |
| `button "Previous day"`, `button "Today"`, `button "Next day"` | same | Board |
| `button "New booking"` | New booking | Board, members |
| `button "Mark out of service"` | Mark out of service | Board, shift lead and operator |
| `region "Ticket rail"` | | Board |
| `group "Ticket <block label>"` containing `button "Confirm"` and `button "Discard"` | "Held until <HH:MM>", "$<amount> · <hours> h · <hours> h peak", plus "taken" or "expired" when it applies | Rail, members, on the ticket's own date |
| `group "Conflict <block label>"` containing `button "Move"` and `button "Release"` | "Conflict: <out-of-service reason>" | Rail, staff |
| `group "Moving <block label>"`, naming the block's label before the move | "Moving" | Rail, staff, while a block is in hand |
| `group "Moving to <block label>"`, naming the ghost's current position. It is focusable and is a Tab stop while it exists | dashed ghost carrying the ghost marker words from Feedback states | Board lane, staff, while a block is in hand or its move is saving |
| `list "Hour ruler"` with `listitem` "00:00" to "23:00" | hour labels | Board, above the lanes |
| `region "Line board"` containing one `group "<station>"` per lane | | Board |
| `group "<station> <date>"`, one per shelf cell | "<n> of <capacity> free" | Shelf lanes |
| `button "<block label>, <who>, <status words>"`, one per block in a lane. `<who>` is the business name for staff and for the owner. A member viewing another member's block sees `button "<block label>, Booked"` with no status words | the same text | Board lanes |
| `dialog "Block details"` with, in this order, `button "Check in"`, `button "Check out"`, `button "Mark no-show"`, `button "Pick up to move"`, `button "Cancel booking"`, then always `button "Close"`. Each action button appears exactly when its action is in the booking's `actions` as set out in Interactions › Block details | "<block label>", "Charge $<amount>" (the current charge) | Board, staff and the owning member |
| `dialog "New booking"` with `combobox "Station"`, `textbox "Date"`, `textbox "Start"`, `textbox "End"`, `spinbutton "Days"` (shelf stations only), `spinbutton "Repeat weekly"`, `textbox "Notes"`, `button "Hold block"`, `button "Close"` | same | Board, members |
| `dialog "Move block"` with `button "Confirm move"`, `button "Put back"` | "From <block label> to <block label>", "New charge $<amount>" | Board, staff |
| `dialog "Release block"` with `button "Release"`, `button "Keep"` | "Release <block label> free of charge?" | Board, staff |
| `dialog "Out of service"` with `combobox "Station"`, `textbox "Date"`, `textbox "Start"`, `textbox "End"`, `textbox "Reason"`, `button "Save window"`, `button "Close"` | same | Board, staff |
| `dialog "Cancel booking"` with `button "Confirm cancellation"`, `button "Keep booking"` | the fee line from Feedback states | Bookings and Board |
| `textbox "Month"`, `region "Booking list"` (marked `aria-busy="true"` while loading) containing `table "My bookings"` (members) or `table "Bookings"` (operator), with rows carrying `button "Cancel <block label>"` | | Bookings |
| `region "Business details"` with `textbox "Business name"`, `button "Save business name"` | | Bookings, members |
| `combobox "Document type"` (options "Insurance certificate", "Food-handler card"), `textbox "Expiry date"`, field labelled "File", `button "Upload"` | same | Documents, members |
| Below 768 pixels: `list "Documents"` of `listitem`s with the labels "Business", "Type", "Status", "Version", "File", "Expires". From 768 up: `table "Documents"` with column headers "Business", "Type", "Status", "Version", "File", "Expires", "Actions". Each item or row carries `link "Download <document type>"` and, for the operator on submitted rows, `button "Approve <business> <document type>"` | status words from Feedback states, the version and the file name | Documents |
| `combobox "Member"` (operator only): an editable combobox carrying `aria-autocomplete="list"`, `aria-expanded` and `aria-controls` naming `listbox "Members"`. The listbox holds one `option "<business> · <name>"` per suggestion (a middle dot U+00B7 with one space each side) | option text as named; the empty copy from Feedback states when nothing matches | Invoices, operator |
| `textbox "Month"`, `button "Show invoice"` | same | Invoices |
| `region "Invoice"` (marked `aria-busy="true"` while loading) containing `table "Invoice lines"`, text "Total $<amount>", text "Invoice open" or "Invoice closed". Each row shows "Pending billing" or "Billed". Rows carry `button "Waive fee for <block label> (<booking id>)"` (operator only, on penalty lines whose booking's fee is not waived) | | Invoices |
| `button "Close month"` opening `dialog "Close month"` with `button "Close <Month YYYY>"` and `button "Keep open"` | "Close <Month YYYY>? Bookings in this month can no longer change." | Invoices, operator, open months only |
| `textbox "Month"`, `region "Utilisation report"` (marked `aria-busy="true"` while loading) containing `heading` level 2 "Utilisation for <Month YYYY>", `table "Utilisation"` and `link "Export usage CSV"` | same; the totals row carries "Adjustments $<amount>" | Reports |
| `combobox "Area"`, `textbox "Task"`, `spinbutton "Sanitizer ppm"`, `textbox "Initials"`, `textbox "Notes"`, `button "Log entry"`, `table "Sanitation log"` | same | Sanitation |
| `textbox "Report month"`, `button "Generate monthly PDF"`, `table "Monthly PDFs"` | rows show "Saved" or "Queued" | Sanitation, operator |
| `textbox "Inspector email"`, `textbox "Link expires"`, `button "Send link"` | same | Sanitation, operator |
| `table "Inspector links"` with column headers "Email", "Expires", "Status", "Last opened", "Views", "Downloads". Each row carries `button "Revoke link for <email>"` and `button "Regenerate link for <email>"` | "Expires" shows "<date> <HH:MM>" in kitchen time; "Status" shows the server's status word; "Last opened" shows "<date> <HH:MM>" in kitchen time, or "Never" | Sanitation, operator |
| `table "Stations"` with `button "Edit rates for <station>"` opening `dialog "Station rates"`. The dialog holds `textbox "Standard hourly rate"` and `textbox "Peak hourly rate"` (hourly stations) or `textbox "Shelf-day rate"` (shelves), plus `textbox "Effective from"`, `button "Save rates"` and `button "Close"` | current rates in dollars; rates entered in dollars; the standard rate is the one charged outside peak windows | Settings |
| `table "Rate versions"` with column headers "Station", "Effective from", "Standard hourly", "Peak hourly", "Shelf-day", "Status" | one row per rate version, stations in lane order and each station's versions oldest first; "Effective from" as "<date> <HH:MM>" in kitchen time; rates as "$<amount>", empty where the station's kind has no such rate; Status as the rate status word | Settings |
| `group "Peak windows"` with `button "Add peak window"`, `button "Remove window <n>"`, `button "Save peak windows"` | same | Settings |
| `checkbox "Insurance certificate required"`, `checkbox "Food-handler card required"`, `button "Save requirements"` | same | Settings |
| Inspector view: `heading` level 1 "<kitchen name>", the "available until" line, `table "Sanitation log"`, `table "Member certificates"` with `link "Download <business> <document type>"`, and `list "Monthly PDFs"` with `link "Sanitation PDF <Month YYYY>"` | | Inspector view |

### Interactions (DP-05, DP-06, DP-07, DP-12, DP-16, DP-24, DP-26, DP-27, DP-28, DP-30, DP-34, DP-40, DP-44, DP-49, DP-53, DP-64, DP-67, DP-68, DP-69, DP-71, DP-72, DP-73, DP-74, DP-78, DP-79, DP-80, DP-81, DP-84, DP-85, DP-86, DP-87, DP-88, DP-89, DP-90, DP-91, DP-92, DP-93, DP-95, DP-97, DP-98, DP-99)

**Signing in and out.**
- Sign in sends the email and password. On a refusal:
  - the `alert` shows the invalid_credentials or rate_limited copy;
  - the password field is cleared;
  - focus returns to the Email field;
  - any `next` stays in the address.
- On success the person lands where Business rules › Return addresses says.
- Sign out ends the session and returns to plain `/`, with no `next`.
- A signed-out load of a screen address, and a 401 on any signed-in screen, go to the sign-in address as set out in Return addresses.

**Handing over a shared device.** Sign out, and any 401 on a signed-in screen, end everything the browser holds for that session:
- Nothing from that session is drawn again: board blocks, rail tickets (including tickets the browser remembers as "taken", and expired tickets it discarded), the hour bank, the `alert` and `status "Announcements"` text, Month and member-picker text and suggestions, typed form values, invoice lines, rate rows and inspector-link rows.
- Any request sent under that session that has not answered yet is abandoned, or its response is ignored when it arrives. A response to a request sent under an earlier session is never drawn, even if it arrives after the next person has signed in in the same tab.
- The next person to sign in starts from a fresh state that holds only what their own responses return.
- Back or Forward after sign-out shows the sign-in screen or the signed-in person's own view, never the earlier person's. A page the browser restores from its back-forward cache reloads from the server instead of showing what it held.

**Holding.**
- Clicking or tapping an empty quarter-hour cell in an hourly lane opens New booking. Station and date are filled in, the start is set to that cell, and the end is one hour later, or 24:00 when one hour later would pass the end of the day.
- A touch tap works the same as a click: dragging code never swallows a tap that did not move.
- Clicking or tapping the free space of a shelf cell opens the same dialog with Days set to 1.
- The New booking button opens the dialog with nothing filled in.
- Hold block sends the hold. Then:
  - On success, the dialog closes and, if the hold's date is not the board date, the board first moves to that date. The ticket then appears at the right end of the rail, the rail scrolls inside itself so the whole ticket is in view, and focus moves to that ticket's Confirm button. For a weekly series, that ticket is the week on the requested date; each later week's ticket appears on the rail when the board shows that week's date.
  - On a field error, the dialog stays open and focus moves to the first invalid field.
  - If another claim won the block (409 `block_taken`), the dialog stays open, no ticket appears, and the `alert` shows the block_taken copy. Through every later board refresh the dialog stays open, keeps every typed value and its station, and keeps that alert, as set out under Claim outcomes. Pressing Hold block again sends a new hold with a fresh Idempotency-Key, which succeeds once the time is free again, for example after the winner discards their hold.

**Confirming.**
- Confirm starts the rail-to-line drop described in Motion and effects.
- Confirm on a series ticket confirms every week still held, as set out in Business rules › Weekly series, but only that ticket's block drops. The other weeks have no drop of their own: when the board next shows their dates, their tickets are gone and their blocks are in their lanes.
- Discard on a series ticket releases only that week.
- A shelf ticket's drop leaves the hour-bank figures unchanged, because shelf days use no hours.
- Each ticket's Confirm works on its own, so several drops may be in flight at once. The hour-bank figures always aim at one target, worked out from two values:
  - **The drawn balance.** This starts as the `hourBank.balanceHours` of the latest board response drawn. A drop's returned balance becomes the drawn balance only when no drop pressed after it has already set the drawn balance with its own returned balance; otherwise that returned balance is ignored. A board response drawn under the rules in Refresh also sets it.
  - **The hours in flight.** This is the sum of the hours of the person's drops that have been pressed and not yet answered. A drop stops counting the moment its response arrives, whether it succeeded or was refused.
  - **The target** is the drawn balance minus the hours in flight, and never less than 0. Whenever either value changes (a press, a response, a drawn board read), the figures roll to the new target as set out in Motion and effects. The figures therefore never show a number below 0, and never show a figure above the drawn balance while drops are in flight.
  - For example, with the seed data: Kofi's drawn balance for the month is 20 and he presses Confirm on six 4-hour tickets in quick succession. The target falls with each press, to 16, 12, 8, 4, 0 and 0. When the sixth drop is refused with 422, its 4 hours leave the hours in flight and the figures stay at the target, which is 0.
  - A drop's success copy replaces the announcement only when no drop pressed after it has already announced its success; otherwise it is not announced.
  - Once every drop has answered, the board is read again and the figures equal that read's `hourBank.balanceHours`.
- A confirm refused with 422 sends its ticket back to the rail, still held. The `alert` shows the message of the first field error, for example the `hours` message.
- Discard on a held ticket releases the hold through the cancel request and removes the ticket. Once its Discard has been pressed, that ticket is never drawn again, whatever board response arrives later.
- Discard on an expired ticket sends no request, because nothing is held. It removes that ticket from the rail until the board next loads.

**Claim outcomes.** These rules keep a refused claim's outcome on screen exactly as published:
- A refused claim's alert (block_taken in New booking, a 422 on Confirm, hold_expired) keeps its exact copy until the person presses a control after it appeared, or until a later refusal replaces it.
- Success results of drops started earlier, board refreshes and banner polls never clear or change that alert.
- When several claims are refused, the alert shows the copy of the refusal whose response arrived last.
- A ticket marked "taken" keeps that label through every later board refresh until it is discarded, the board date changes or the page reloads.

**On a phone** (375x812, touch). A member's whole booking runs by taps:
1. A tap on an empty quarter-hour cell in the Oven 2 lane opens New booking filled in as described under Holding.
2. Hold block places the new ticket in the rail strip, scrolled into view inside the strip, with focus on its Confirm button. Confirm and Discard are each at least 44 by 44 pixels.
3. A tap on Confirm runs the drop. With reduced motion requested, the drop uses the instant substitute from Motion and effects, the header figures equal the `hourBank.balanceHours` the server returned, and the drop's success copy is announced.
4. Throughout, the hour bank stays visible in the header and the page never scrolls sideways.

**Phone menu.** Menu opens and folds the panel holding the navigation and Sign out, under the rules in Feedback states › Phone menu.

**Retries.**
- Hold, confirm, cancel (including Discard) and waive each carry a fresh Idempotency-Key per user action.
- If the network fails, the browser resends the same request with the same key, up to three times over about ten seconds. Only after that does it show the network error.
- When the server answers a retried request from its stored response, the screen shows that response's success copy.

**Block details and status actions.**
- Clicking a block, or pressing Enter or Space on it, opens Block details.
- The dialog's action buttons come only from that booking's `actions` in the latest board or booking response the screen holds for it, fixed at the moment the dialog opens: `check_in` gives Check in, `check_out` gives Check out, `no_show` gives Mark no-show, `move` gives Pick up to move, and `cancel` gives Cancel booking. Close is always there. The browser never works out which actions are legal from its own clock, zone or status rules.
- Check in, Check out, Mark no-show, Cancel booking (through its confirm dialog) and Release each send their request.
  - While the request is waiting, the block keeps its previous status word and gains the pending marker from Feedback states. It never shows the target status before the server answers.
- On success, the block redraws from the booking in the response. A cancelled booking leaves its lane.
- On a 409 `invalid_transition`:
  - The block redraws at once from the `current` booking in the response body, without waiting for the next refresh. If `current` has a status the board does not show, the block leaves its lane.
  - The `alert` shows the invalid_transition copy for the current status.
  - The dialog closes, and focus returns to the block, or to the board's lane group if the block has left.
- On a 422, such as a check-in refused on `documents`:
  - The block stays exactly as it was, keeping its previous status word, and drops the pending marker.
  - The `alert` shows the message of the first field error.
  - The dialog closes, and focus returns to the block.
- Each of these redraws touches only that one block. No other block is reloaded or moved.

**Board dialogs.** Block details, Move block, Release block, Out of service, Cancel booking and New booking all follow these rules, at every viewport and at every horizontal and vertical scroll position of `region "Line board"`:
- Each opens in the top layer, above the header, the rail, the banner and the board. The whole dialog box lies inside the viewport; on the phone layout it fills the screen's width.
- The element at the centre of each of the dialog's buttons and fields is that control, so every control can be tapped or clicked. Every control is also reachable by Tab inside the dialog.
- Opening a dialog never scrolls the page or the board; the page never scrolls sideways.
- While a dialog is open, everything behind it is inert to pointer, touch and keyboard: a tap or click at the on-screen position of a block or empty cell behind the dialog opens nothing and changes nothing.
- When the dialog closes, the board's horizontal and vertical scroll positions are exactly what they were before it opened, and focus returns to the control that opened it, which was in view when it was pressed. The only exceptions are the cases where this section moves focus to a moved, put-back or created item, which is then scrolled into view inside the board frame.

**Moving with the mouse or touch.**
- Staff can drag a confirmed block to another lane or time. It snaps to quarter hours on hourly lanes and to whole days on shelf lanes. Dropping it opens Move block, with the block in hand and its ghost at the drop position.
- On touch screens, Pick up to move followed by a tap on a free cell does the same.

**Moving with the keyboard.**
- **Picking up.** In Block details, Pick up to move closes the dialog and puts the block in hand. On the rail, a Conflict ticket's Move button puts that block in hand in the same way. Either way:
  - a dashed ghost of the block (`group "Moving to <block label>"`) appears in its lane at its current position, and a Moving ticket appears on the rail;
  - focus moves to the ghost;
  - the pick-up announcement is made.
- **Where the keys work.** While a block is in hand and no dialog is open, the arrow keys (with or without Shift), Enter and Escape act on the ghost whenever focus is on the ghost or on any other control inside `region "Ticket rail"` or `region "Line board"`. In that case they never also activate, scroll or move the focused control. With focus anywhere else (the header, the navigation, the date bar or New booking and Mark out of service), these keys keep their normal meaning and the block stays in hand.
- **Tab while in hand.** Tab and Shift with Tab move focus along the board's normal Tab order and never put the block back or move the ghost. The ghost is a Tab stop in the lanes, in place of the original block. Moving focus to another control does not drop the block; pressing Enter or Space on a control inside the rail or the lanes acts on the ghost as above, not on that control.
- **Steps:**
  - Left and Right shift the ghost by 15 minutes. Shift with Left or Right shifts it by one hour.
  - On shelf lanes, Left and Right shift the ghost's first day by one day.
  - Up and Down move the ghost to the previous or next lane of the same kind, keeping its times.
  - Focus stays on, or returns to, the ghost after every step.
- **Edges.** In these cases the key leaves the ghost where it is and makes the edge announcement:
  - any part of an hourly ghost would fall before 00:00 or after 24:00 (a ghost may end exactly at 24:00);
  - a shelf ghost's first day would fall before the board response's `today`;
  - there is no lane of the same kind above or below.
- **What each step reports.** After every key that moves the ghost, the step announcement for its new position is made, with the occupied or out-of-service marker when one applies. The ghost's marker words change at the same moment.
  - On hourly lanes, occupied means the ghost overlaps another block in a lane on the board.
  - On shelf lanes, occupied means some day of the ghost is full without counting the moving booking.
  - Out of service means the ghost overlaps an out-of-service band.
- **Placing.** Enter on a free position opens Move block, with focus on Confirm move. Enter on an occupied or out-of-service position opens nothing, keeps the block in hand with focus on the ghost, and makes the not-free announcement.
- **Putting back.** Escape while a block is in hand and no dialog is open puts it back: the ghost and the Moving ticket go, the put-back announcement is made, and focus returns to the block at its original position.
- **Inside Move block.** The block stays in hand while the dialog is open. Escape and Put back do the same thing: they close the dialog and put the block back exactly as above, with the put-back announcement and focus on the block at its original position. Tab and Shift with Tab cycle between Confirm move and Put back only.
- Each announcement replaces the previous one in `status "Announcements"`, one message per key press. The exact copy is in Feedback states.

**Confirming a move** (keyboard, mouse or touch).
- Confirm move closes the dialog and sends the move with the version the block had when it was picked up.
- While the request is waiting, the lane block stays at its origin with the pending marker. The dashed ghost sits at the target, marked with the saving word from Feedback states, and holds focus. The in-hand keys do nothing while the move is saving.
- On 200:
  - the block is drawn at its new place from the response;
  - the ghost and the Moving ticket go;
  - the moved announcement is made;
  - focus lands on the block.
- On a 409 or 412:
  - The ghost travels back to the rail and disappears, and the Moving ticket goes.
  - The block redraws at once from the `current` booking in the body. That may be its origin, or a third position if someone else moved it. If the board does not show `current`'s status, the block leaves its lane.
  - The Conflict ticket stays on the rail only if `current.conflict` is true.
  - The `alert` shows the copy for the refusal's code.
  - Focus lands on the block at its current position, or on the board's lane group if the block has left.
  - No other block is reloaded or moved.
- On a 422, the ghost returns and the block stays at its origin in the same way. The `alert` shows the message of the first field error, for example the `hours` message, and focus lands on the block.

**Tab order on the board.**
1. Header and navigation (in the phone layout, Menu, and the panel's controls only while it is open).
2. The date bar.
3. New booking or Mark out of service.
4. Rail tickets, left to right, with each ticket's buttons in order (including the Moving ticket while a block is in hand).
5. Lanes, top to bottom, with blocks left to right within each lane. While a block is in hand, the ghost takes the original block's place in this order.

Empty cells are not tab stops; keyboard users create bookings with New booking.

**Dialogs.**
- Every dialog is modal.
- When a dialog opens, focus moves to its first field or button, unless this section says otherwise. Tab and Shift with Tab cycle inside it.
- Escape or Close dismisses it. Move block is the one exception: there Escape acts as Put back, as set out under Moving with the keyboard.
- When a dialog closes, focus returns to the control that opened it, or to the moved, put-back or created item where this section says so.

**Date bar.** Previous day and Next day move the board by one kitchen-local day. Today goes to the `today` of the latest board response. None of the three reads the browser's clock or zone.

**Business name.**
- Save business name sends the new name.
- Once it is saved, the header, the member's own board blocks and the Bookings table show it at the next refresh.
- Staff screens show it on their next refresh or load.

**Member picker (operator, Invoices).**
- **Querying.** Each change of the field's text sends `GET /api/members?q=<text>`, after a pause in typing of at most 250 milliseconds. An empty text asks for every member of the kitchen.
- **Opening.** Any change of the field's text by typing or deleting opens the listbox at once (`aria-expanded="true"`). Focusing or clicking the field without changing its text does not open it.
- **Drawing.** `listbox "Members"` draws only the response for the text currently in the field. A response for any earlier text is discarded when it arrives, however late.
  - While the current text's request is waiting, the open listbox is marked `aria-busy="true"` and shows no option that came from any other text.
  - When the current text's response is drawn, its options appear in the order the API returns them, named "<business> · <name>", and no option is active (the field has no `aria-activedescendant`). The operator's response carries email, but options never show it.
  - When the current text's response has no members, the listbox shows the picker's empty copy from Feedback states and no `option`.
- **Keys**, with focus kept in the field throughout:
  - ArrowDown with the listbox open: when no option is active, the first option becomes active (`aria-activedescendant` names it); otherwise the next option becomes active. On the last option, ArrowDown keeps it active.
  - ArrowDown with the listbox closed: opens the listbox for the current text, sending its query only when that text's response is not already held, and makes the first option active as soon as that text's options are drawn, at once when they are already held. So, for example, after Escape a single ArrowDown reopens the list with its first option active, and a single ArrowDown followed by Enter always selects the first option.
  - ArrowUp moves the active option to the previous one. On the first option, ArrowUp keeps it active. With no active option, ArrowUp does nothing.
  - Enter on an active option selects it: the field text becomes that option's name, the listbox closes, and no query is sent for that text. Clicking or tapping an option does the same. Enter with no active option does nothing.
  - Escape with the listbox open closes only the listbox, keeping the typed text and focus in the field. No dialog or other panel closes.
  - Tab closes the listbox and moves focus on as normal.
- **Selection and the address.** Selecting a member never changes the address. Show invoice puts the Month field's month and the selected member into the address, adding one history entry. Typing in the field after a selection clears the selection; while no member is selected, Show invoice puts only the month into the address.
- On load, when the address names a member of the kitchen, the field shows that member's option name, that member is selected, and the listbox is closed.
- At 375x812, 768x1024 and 1280x800, the open listbox lies above the invoice region in the top layer: every option's box lies inside the viewport, and the element at the centre of each option is that option, never cut off by `region "Invoice"` or covered by the header or banner.

**Documents.**
- The Documents rows keep each row's `version` from when they loaded. Approve sends that version.
- On a 412, the row redraws from the `current` document in the body, and the `alert` shows the Documents stale_version copy.
- On a 409 `document_superseded`, the row redraws as Superseded from `current`, and the `alert` shows the document_superseded copy.
- The rows reload after each of the person's own uploads and approvals.
- **Switching layout.** When the viewport crosses 768 pixels, the list and the table swap in place, built from the rows already held, with no request sent. Across the switch:
  - focus moves to the control with the same accessible name in the new layout (when it was on a row's link or button), or stays on the same upload-form control;
  - an Approve that is still pending stays disabled and busy, with the same name, in the new layout, and when its answer arrives the row redraws in whichever layout is then shown;
  - the `alert` text and every field error stay;
  - the upload form keeps its chosen document type, typed expiry date and chosen file.

**Settings.**
- Settings keeps the kitchen's `rulesVersion` from when it loaded or last saved. Save peak windows and Save requirements send it.
- On a 412:
  - both the peak-window editor and the requirement checkboxes redraw from the `current` kitchen in the body;
  - the `alert` shows the Settings stale_version copy;
  - the next save sends the new `rulesVersion`.
- Save rates sends the dialog's values. On 201 the dialog closes, focus returns to its Edit rates button, and the stations and rate versions tables redraw from the response's station.
- The rate versions table shows each version's Status only from the server's `status`; the browser never decides it from its own clock or zone.

**Async operator actions.** These are Close month, Generate monthly PDF, Send link, Revoke and Regenerate. Each one follows the pending rule in Feedback states.

Close month:
1. Pressing "Close <Month YYYY>" in the Close month dialog closes the dialog. `button "Close month"` then shows the pending state.
2. On 200:
   - the invoice redraws as "Invoice closed" from the response and a fresh read of the invoice, with no page reload;
   - the Close month button is removed;
   - focus moves to the invoice table.
3. On 409 `month_closed`, for example because another tab closed the month first:
   - the `alert` shows the month_closed copy;
   - the invoice is read again and redraws as "Invoice closed";
   - the Close month button is removed;
   - focus moves to the invoice table.
4. On 409 `billing_pending`, 409 `billing_mismatch` or 503 `billing_unavailable`:
   - the `alert` shows that copy;
   - the invoice stays "Invoice open";
   - focus returns to the Close month button.

The other actions:
- **Generate monthly PDF:** the Monthly PDFs row for that month shows "Saved" or "Queued", exactly as the response's `status`.
- **Revoke:** an inspector link row shows "Revoked" only after the 200.
- **Send link and Regenerate:** the Inspector links table redraws from the server after the 200.

**Waiving a fee.**
- `button "Waive fee for <block label> (<booking id>)"` appears on a penalty line while that booking's `actions` include `waive_penalty`. The screen reads this from the Bookings list for that member and the invoice's month, so it also appears on closed invoices. The booking id in the name keeps two late-cancelled bookings of the same block apart.
- Once pressed, that button stays in place, disabled and busy, while its waiver is pending, and is removed after its 200. It is never shown again for that booking, whatever a later refresh of the Bookings list returns while the waiver is pending.
- After a waiver, the open invoice redraws. A closed invoice stays exactly as it was, apart from the button disappearing.

**Addresses and history.**
- These screens read their view from the address:
  - the board reads `date`;
  - Bookings and Reports read `month`;
  - Invoices reads `month` and `member`. For members, `member` is ignored and their own invoice is shown.
- **Missing parameters.** A missing parameter means the kitchen-local today or current month, as reported by the server, never the browser's. The address bar is filled in with that value, replacing the current history entry rather than adding one.
- **History entries.** Each of these actions adds exactly one history entry when it changes the address, and loads the data for the new address:
  - Previous day, Today and Next day;
  - committing a new value in the Month field on Bookings or Reports, by pressing Enter or leaving the field;
  - pressing Show invoice on Invoices;
  - a successful hold whose date is not the board date, which moves the board to that date.
- **Reload, Back and Forward.** Reload reopens the same view. Back and Forward restore the field values and reload the tables for that address.
- **Latest view wins.** On Reports, Invoices and Bookings, only the response for the address currently shown is ever drawn.
  - When the month or member changes, by a commit, Show invoice, Back, Forward or reload, any earlier request for that screen is abandoned or its response is ignored when it arrives. A response for an earlier month or member is never drawn, however late it arrives.
  - Until the response for the new address arrives, the screen's region (`region "Utilisation report"`, `region "Invoice"` or `region "Booking list"`) is marked `aria-busy="true"` and shows no rows, totals or heading from any other month or member.
  - Once it arrives, on Reports the level-2 heading, the Month field, the table, the totals row and the `Export usage CSV` link all name the address's month; on Invoices the Month field, the member picker, the lines, the total and the invoice state describe the address's month and member; on Bookings the Month field and the table describe the address's month.
- **Malformed parameters:**
  - A malformed `month` leaves the raw text in the Month field, shows the month field error under it, and shows no table and no report heading.
  - A malformed `date` on the board shows the date field error copy in the `alert` and no lanes. The date bar's buttons still work.
  - On Invoices, a `member` that is unknown or belongs to another kitchen shows the not_found copy in the `alert`, leaves the member picker with no selection, and shows no invoice table. This also applies after landing through a `next` address.
- **Export link.** The `Export usage CSV` link's address is always `/api/exports/usage.csv?month=<month shown>`.

**Refresh.**
- The board refreshes after each of the person's own actions, and otherwise at least every 15 seconds. The hour bank refreshes with the board.
- **Which board responses are drawn.** The board's own actions are hold, confirm, discard, cancel, check-in, check-out, no-show, move, release and window save.
  - The board draws only board responses for requests sent after the latest of the person's own board actions has answered. A board response for a request sent before that answer is discarded when it arrives, however late.
  - A timed refresh sent while any of the person's drops or moves is in flight is discarded when it arrives.
  - As a result, a landed block never leaves its lane, a dropped or discarded ticket never reappears on the rail, and the hour-bank figures never return to an older balance.
- The service banner polls at least every 10 seconds, and also re-reads at once after the person's own actions as set out in Feedback states › Service banner.
- By the next board refresh:
  - a hold that has lapsed shows "expired" on its ticket;
  - a block that has automatically become a no-show shows "No-show";
  - a block cancelled from another screen, and another member's released hold, leave their lanes;
  - shelf cells show the current free count.
- **Invoice refresh.** While the invoice shown is "Invoice open", the Invoices screen re-reads that invoice, and the Bookings list behind its waive buttons, at least every 15 seconds. The lines, their "Pending billing" or "Billed" words, the total and the hour bank redraw in place. The re-reading stops once the invoice shown is closed.
- **Inspector links refresh.** While Sanitation is open for the operator, the Inspector links table re-reads `GET /api/inspector-links` at least every 10 seconds, and redraws each row's Status, Last opened, Views and Downloads in place from the response. The Status shown is always the server's `status`; a link turns "Expired" at the first re-read after the server's expiry instant, whatever the browser's clock says.
- **Settings refresh.** While Settings is open, it re-reads `GET /api/stations` at least every 15 seconds and redraws the `table "Stations"` current-rate cells and the `table "Rate versions"` rows and Status cells in place. A version shows "Current", and its predecessor "Past", only from the first re-read after the server's `effectiveAt` for it, whatever the browser's clock or zone. A re-read sent before a Save rates result arrived is discarded, so a version just created never disappears from the table.
- A refresh of any screen, and a banner poll, never:
  - adds a history entry;
  - drops or moves a block in hand or its ghost, or moves focus off the ghost;
  - closes an open dialog, including New booking, Close month, Cancel booking and Station rates;
  - changes typed values in an open dialog, unsaved peak-window edits or unsaved requirement checkboxes;
  - moves focus;
  - changes the uncommitted text of a Month field, the member picker's text, its active option or whether its listbox is open, or the "Inspector email" or "Link expires" text;
  - clears or changes the `alert` of a refused claim;
  - removes the busy state from a pending Close month, Waive fee, Revoke, Regenerate, Save rates, Save peak windows or Save requirements button;
  - re-shows a `button "Waive fee for …"` whose waiver is pending or has answered 200.
- A refresh response for a request sent before a close result (200 or 409 `month_closed`) arrived is discarded, so once "Invoice closed" is shown the invoice never shows "Invoice open" again and the Close month button never reappears.
- An Inspector links re-read sent before a Revoke or Regenerate result arrived is discarded, so a link shown as "Revoked" never shows "Active" again.

**Inspector view.**
- The view loads its records once per page load and never polls. It runs no timer that hides records or changes its state.
- Every time and state label on the view comes from the server's response and is shown in the kitchen's time zone; the browser's clock and zone are never consulted.
- Pressing `link "Download <business> <document type>"` or `link "Sanitation PDF <Month YYYY>"` stays on the page: the browser fetches the file and saves it only when the answer is 200. Any other answer is handled as set out in Feedback states › Inspector view states, and never shown as a page of its own.

**Hover and press.**
- On pointer devices, hovering an empty cell draws a ruled box around that quarter hour or day, at once.
- Hovering a block darkens its edge rule.
- Buttons darken while pressed.
- Focus is always shown as a thick cold-blue ring, including on the ghost.

### Visual design (DP-58, DP-59, DP-76, DP-78, DP-81)

**Colour roles.**
- The page ground is a pale, warm stainless grey.
- Text and heavy rules are near-black ink.
- A single hot ticket orange is the accent. It is used only for live or claimed state: held tickets, the block in hand and its ghost, checked-in blocks and the peak hatching.
  - Text on orange is always ink.
  - Orange is never used as text on the pale ground.
- A cold, saturated blue marks focus rings, links, out-of-service bands, conflict outlines, the active picker option's edge and the "Billed" mark.
- A mid warm grey draws the thin rules that separate grid cells, lanes and panels.
- Confirmed blocks have an ink outline on the ground and ink text.
- No-show and completed blocks, expired tickets and past rate versions use a grey outline or grey text that still meets contrast.
- No state is ever told apart by colour alone. Each state carries the words and patterns listed under Markers in Feedback states.
- All text and controls meet WCAG 2.2 AA contrast.

**Type.**
- Display type is Archivo Black, a heavy, blunt grotesque. It sets the kitchen name, the board date, station names and the hour-bank figures.
- Body type is IBM Plex Sans for everything else.
- Each heading level is a quarter larger than the level below it, so hierarchy comes from weight and size rather than colour.
- Block labels on the board are never smaller than 16 pixels, and neither is body text, at every viewport.

**Density and composition.**
- The layout is compact: tight rows, 1-pixel rules and no card shadows.
- Panels are flat and square-cornered, separated only by hard rules and the jump in type weight. Dialogs and the picker's suggestion list are flat ruled panels too, set apart from the page behind by a heavy ink border and a plain dimming of what lies behind.
- The full-width board is the page. Station lanes run as horizontal bands against the fixed hour ruler, shelf lanes stack each day's slot bookings over their free count, and the ticket rail is a narrow strip along the top.
- The Documents cards on a phone are flat ruled panels like the rest, with each label in small ink caps beside its value.

**Touch size.**
- Every button, every picker option and every booked block is at least 44 by 44 pixels at every viewport.
- Empty quarter-hour cells and shelf day cells take their width from the hour ruler, so they are exempt from the width rule. They are still at least 44 pixels tall at every viewport.

**Fonts** are served by the app itself.

### Motion and effects (DP-56, DP-57, DP-81, DP-84, DP-92, DP-98)

Motion uses two speeds: 180 milliseconds for small changes and 360 milliseconds for travel. The one exception is the one-second landing ring in the reduced-motion drop. Each movement leaves quickly and settles gently, with no bounce or overshoot.

**Rail-to-line drop (signature).**
1. The member presses Confirm on a ticket. The ticket shows "Confirming…" and starts moving at once.
2. Over 360 milliseconds, the ticket's box travels on a gentle curve from its rail slot down to its lane slot. On the way it reshapes into the block's width, height and position.
3. While it travels, the hour-bank figures in the header roll from the figure shown towards the target defined in Interactions › Confirming (the drawn balance minus the hours in flight, never below 0). The press itself adds the ticket's hours to the hours in flight, so the roll starts before the server answers.
   - There is one roll per quarter hour, and each roll takes 180 milliseconds.
   - If the change is more than eight quarter hours, the first seven rolls each step one quarter hour and the eighth jumps straight to the final value, so there are never more than eight rolls.
   - Every later change of the target, from another press or any response, starts a new roll from the figure shown towards the new target under the same steps.
4. If the server has not answered when the box arrives, the block waits in its slot as a dashed ghost marked "Confirming…".
5. On success:
   - the block settles solid;
   - any part of it inside a peak window gets an orange diagonal hatched band carrying the word "peak";
   - the ticket's quote is replaced by the confirmed charge from the server, which Block details also shows;
   - once no other drop is in flight, the final figures equal the drawn balance, which is the balance the server returned unless a later-pressed drop has already drawn its own;
   - the block's left and right edges sit within one pixel of the hour-ruler positions for its stored start and end, including an end of 24:00.
6. If the server answers that the block was taken, the box travels back along the same path to its rail slot in 360 milliseconds. This happens when the hold lapsed and another claim booked that time, as set out in Business rules. The ticket gains the label "taken", and the figures roll to the new target from Interactions › Confirming, now that the refused drop's hours have left the hours in flight.
7. A lapsed hold returns to the rail in the same way, labelled "expired".
8. Any other refusal, such as a 422 on hours, returns the box to its rail slot in the same way with no label. The ticket stays held, and the figures roll to the new target in the same way.

**Staff moves.**
- On Confirm move, the Moving ticket travels from the rail to the target slot in the same way as a drop, without hour-bank figures, and becomes the dashed saving ghost.
- On a refusal, the ghost travels back to the rail over 360 milliseconds and disappears. The block itself jumps straight to its current position from the server.

**Other motion.**
- The keyboard ghost jumps straight to each new position with no travel, so that each announcement matches what is on screen.
- Dialogs fade in and rise slightly over 180 milliseconds, and close in the same time. Their position is fixed in the viewport from the first frame, so they never slide in from off screen.
- The service banner slides down from under the header over 180 milliseconds when it first appears, and slides back up when it clears. Updating its counts never replays the slide.
- The phone menu panel and the member picker's suggestion list appear and fold at once, with no travel.
- In-place redraws (invoice refresh, inspector-link refresh, rate status refresh, report month change, inspector state swap, the Documents layout switch, banner count updates) change at once, with no fade.
- Hover and press feedback is immediate, with no animation.
- Nothing pulses, spins or repeats on its own. A pending state shows words, not a looping spinner.

**Reduced motion.** When the system asks for reduced motion:
- The drop becomes instant. The ticket disappears from the rail, the block appears in its lane within one board render with a thick ring around it for one second, and every change of the hour-bank target from Interactions › Confirming is shown in one step.
- On a taken, expired or otherwise refused claim, the ticket simply stays on the rail with its label.
- A staff move's ghost appears at the target and disappears without travel. A refused move's ghost simply disappears.
- Dialogs and the banner appear and disappear without movement.
- The ring appears and disappears without fading, and the rail strip and the board jump rather than glide when they bring a ticket or block into view.
- At no moment is anything on the page animating or transitioning, at any viewport.
- The drop's announcement is made in both modes.

### Feedback states (DP-07, DP-13, DP-16, DP-20, DP-26, DP-32, DP-34, DP-40, DP-46, DP-49, DP-50, DP-51, DP-53, DP-56, DP-57, DP-62, DP-64, DP-65, DP-67, DP-68, DP-69, DP-72, DP-73, DP-75, DP-76, DP-77, DP-78, DP-79, DP-80, DP-81, DP-84, DP-85, DP-86, DP-88, DP-89, DP-93, DP-94, DP-95, DP-96, DP-97)

**How feedback appears.**
- Every async action shows its pending state within a tenth of a second.
  - Its button is disabled and marked busy (`aria-busy="true"`), and its accessible name and visible label stay the same.
  - The pending copy is the text of `status "Announcements"`.
- On success, the success copy replaces the pending copy in that same region, and nothing is written to the `alert`.
- Errors go only to the `alert`. The `alert` shows only the published copy below, never a server's raw text.
- A field error appears as text under its field. It is linked to the field as its description, and the field is marked invalid.
- Placeholders follow API › Formats.

**Status words.**

| Booking status | Status word |
|---|---|
| held | Held |
| confirmed | Confirmed |
| checked_in | Checked in |
| completed | Completed |
| no_show | No-show |
| cancelled_free | Cancelled |
| cancelled_late | Late cancel |
| expired | Expired |

A block's `<status words>` are built in this order:
1. its status word;
2. ", Conflict" when it is in conflict;
3. ", Pending billing" or ", Billed" when its `billingStatus` is `pending_billing` or `billed`;
4. ", Saving…" while one of the block's own status actions or its move is waiting for the server.

For example: "Confirmed, Conflict, Billed, Saving…".

Other status words:
- Invoice lines: "Pending billing" (`pending_billing`) and "Billed" (`billed`).
- Document rows: "Submitted", "Approved", "Expiring", "Expired", "Superseded".
- Inspector links: "Active", "Expired", "Revoked", from the server's `status`.
- Sanitation PDFs: "Saved" (status `stored`) and "Queued" (status `queued`).
- Rate versions: "Past" (`past`), "Current" (`current`) and "Scheduled" (`scheduled`), from the server's `status`.

**Member picker.** When the current text's response lists no members, `listbox "Members"` shows the visible text "No members match." and no option.

**Markers.** These states never rely on colour alone. Each carries a visible word and a pattern:
- **A block in conflict** shows the word "Conflict" in its visible label. Its outline is dashed cold blue instead of solid.
- **A full shelf cell** shows "0 of <capacity> free" over cross-ruling.
- **The keyboard ghost:**
  - on occupied time it shows the visible word "Occupied", with a cross-hatch across the ghost;
  - on out-of-service time with no occupied time it shows "Out of service", with the same cross-hatch;
  - on free time it shows neither;
  - these words change at the same moment as the step announcement.
- **A ghost whose move is waiting for the server** shows "Moving…".
- **Other markers:**
  - the peak part of a block carries the word "peak" on its hatched band;
  - out-of-service bands carry their reason over cross-ruling;
  - taken and expired tickets carry the words "taken" and "expired".
- **Contrast:**
  - Every marker word reaches at least 4.5:1 contrast against the colours actually behind it, including over the orange ghost and its hatching.
  - Every dashed outline, hatch stroke and cross-ruling line reaches at least 3:1 against the page ground.
  - This holds at all three viewports.

**Phone menu.** In the phone layout, `button "Menu"` discloses a panel holding `navigation "Main"` and `button "Sign out"`. The hour bank stays outside the panel.
- **Folded:** `aria-expanded` is `"false"`. The navigation and Sign out are hidden and inert: they are absent from the accessibility tree, skipped by Tab, and cannot be reached by pointer or touch. Moving the panel off screen is not folding it.
- **Opening:** pressing Menu sets `aria-expanded` to `"true"`, shows exactly the links of the person's role plus Sign out, and moves focus to the first link.
- **Folding:**
  - Escape, or a tap or click outside the panel, folds it and returns focus to Menu.
  - Choosing a link folds it, loads that screen and moves focus to the `main` landmark.
- **Staying put.** A board refresh, a banner poll or a new alert never folds or reopens the panel, and never moves focus while it is open.
- **Fresh loads.** Reload, Back and Forward always show it folded.
- **Widening and narrowing.** Widening to 768 pixels or more removes Menu and shows the navigation and Sign out in the header. Narrowing again shows Menu folded with `aria-expanded` `"false"`.

**Pending and success copy.**

| Action | Pending | Success |
|---|---|---|
| Sign in | Signing in… | (opens the screen set out in Business rules › Return addresses) |
| Hold block | Holding <block label>… | Held <block label> until <HH:MM>. |
| Confirm (drop) | Confirming <block label>… | Hourly: "<station>, <start> to <end> booked, <hours> hours left, <hours> hours at peak" ("hours" becomes "hour" when the number is exactly 1; the peak clause is left out when there are no peak hours). Shelf: "<block label> booked". A series adds " and <n> more weeks". Billing pending adds ". Billing is pending." |
| Discard | Releasing hold… | Hold released. |
| Cancel booking | Cancelling… | "Cancelled. No cancellation fee." or "Cancelled. Late cancellation fee: $<amount>." |
| Check in / Check out / No-show | Saving… | "Checked in <business>." / "Checked out <business>." / "Marked <business> as no-show." |
| Confirm move | Moving… | Moved to <block label>. |
| Release | Releasing… | Released <block label>. No cancellation fee. |
| Save window | Saving… | <station> out of service <date> <start>–<end>. <n> blocks need moving. |
| Save rates | Saving… | New rates for <station> start <date> <HH:MM>. |
| Save peak windows | Saving… | Peak windows saved. They apply to bookings confirmed from now on. |
| Save requirements | Saving… | Document requirements saved. |
| Save business name | Saving… | Business name saved. |
| Upload | Uploading <file name>… | Uploaded. Waiting for approval. |
| Approve | Approving… | Approved <business> <document type>. |
| Waive fee | Waiving… | "Fee waived for <block label>." or, for a fee in a closed month, "Fee waived for <block label>. The credit appears on the <Month YYYY> invoice." |
| Close month | Closing <Month YYYY>… | <Month YYYY> closed. <n> invoices committed. |
| Log entry | Logging… | Logged. |
| Generate monthly PDF | Saving PDF… | "Sanitation PDF for <Month YYYY> saved." or "Storage is unavailable. The sanitation PDF for <Month YYYY> is queued and will be saved when storage returns." |
| Send link | Sending… | Link sent to <email>, active until <date> <HH:MM>. |
| Revoke | Revoking… | Link revoked. |
| Regenerate | Sending… | New link sent to <email>. The old link no longer works. |

Notes on the table:
- In the Confirm row, `<start>` and `<end>` are the block's local times, with an end of 24:00 written "24:00", and the hours-left figure is the `hourBank.balanceHours` of the response. For example, with the seed data at start, Ada's weekday Oven 2 block from 18:00 to 21:00 announces "Oven 2, 18:00 to 21:00 booked, 37 hours left, 1 hour at peak".
- When drops overlap, which drop's success copy is announced follows Interactions › Confirming.
- In the Save rates row, `<date> <HH:MM>` is the version's effective moment in kitchen time.
- In the Send link row, `<date> <HH:MM>` is the link's `expiresAt` in kitchen time.
- In the Close month row, `<n>` is the number of member invoices committed by that close.
- In the Waive fee row, `<Month YYYY>` is the adjustment month.
- In the Confirm row, `<n>` is the number of the series' other weeks confirmed by that action, and "weeks" becomes "week" when `<n>` is 1.
- The Discard row applies only to held tickets. Discarding an expired ticket announces nothing.
- The cancel dialog's fee line reads "No cancellation fee" or "Late cancellation fee: $<amount>". The fee is worked out from the booking's current block and charge.

**Keyboard move announcements.** These go in `status "Announcements"`. `<block label>` is the ghost's label at its position after the key, unless the row says otherwise.

| Event | Announcement |
|---|---|
| Pick up | Picked up <block label>. Arrow keys move it, Enter places it, Escape puts it back. (the block's own label) |
| A key moves the ghost to free time | <block label>. |
| A key moves the ghost onto occupied time | <block label>. Occupied. |
| A key moves the ghost onto out-of-service time and no occupied time | <block label>. Out of service. |
| A key cannot move the ghost | <block label>. Edge of the board. (the unchanged ghost label) |
| Enter on occupied or out-of-service time | <block label> is not free. Choose free time. |
| Escape or Put back, outside or inside Move block | Put back <block label>. (the block's original label) |
| Confirmed move | the Confirm move success copy above |

When the ghost overlaps both occupied and out-of-service time, the occupied announcement is used.

**Errors.** This table is the published copy for every error code. The API's error `message` is exactly this copy, with its placeholders filled in, and the screens show it in the `alert`. Each error code's status is defined in API.

| Error code | Copy |
|---|---|
| bad_request | The request body is not valid JSON. |
| idempotency_key_required | Send an Idempotency-Key header of 8 to 128 letters, digits, hyphens or underscores. |
| unauthenticated | Sign in to continue. |
| invalid_credentials | Email or password is incorrect. |
| forbidden | Your role cannot do that. (Screens never show controls a role cannot use. This copy appears if the server refuses anyway.) |
| cross_origin | Requests from other sites are refused. |
| not_found | That was not found. |
| not_found (member on Invoices, screen only) | That member was not found. |
| read_only | Inspector links are read-only. |
| block_taken | <station> <start> block was taken. (for shelves: "<station> <date> was taken.", with the first full date) |
| invalid_transition | That action is not available for a <status word> block. (`<status word>` is the status word of the `current` booking in the 409 body; on documents: "That action is not available for a <status word> document.", using the document status word) |
| document_superseded | A newer <document type> from <business> is waiting. Approve that one instead. |
| hold_expired | Your hold on <block label> expired. |
| idempotency_key_reused | This request was already used for something else. Reload and try again. |
| month_closed | <Month YYYY> is closed. |
| billing_pending | Some charges are still waiting for billing. Try again once they are recorded. |
| billing_mismatch | Kill Bill's draft for <business> does not match Lineboard. The month stays open. (`<business>` is the first member in the response's `members` list) |
| rate_version_exists | A rate change for <station> already starts <date> <HH:MM>. |
| link_expired | This link has expired. |
| link_revoked | This link is no longer active. |
| stale_version (on a move) | This block changed since you picked it up. The board now shows the latest version. |
| stale_version (on a peak-window or requirement save) | Kitchen rules changed since you opened Settings. The latest rules are shown. |
| stale_version (on a document approval) | This document changed since you opened Documents. The latest version is shown. |
| payload_too_large | This file is too large. (also on any JSON body over its limit) |
| unsupported_media_type | Send JSON with Content-Type application/json. |
| unsupported_file_type | Upload a PDF, PNG or JPEG file. |
| validation_failed | Check the highlighted fields. |
| rate_limited | Too many sign-in attempts. Try again in <n> minutes. (`<n>` is the Retry-After seconds divided by 60, rounded up; "minutes" becomes "minute" when `<n>` is 1) |
| billing_unavailable | Billing is unavailable. The month stays open; try again when billing is back. |
| storage_unavailable (on an upload) | Document storage is unavailable. Your file was not saved; try again shortly. |
| storage_unavailable (on any file download, inspector downloads included) | Document storage is unavailable. Try again shortly. |
| internal | Lineboard hit an unexpected problem. Try again. |
| network failure (screen only, no API code) | Lineboard could not reach the server. Check the connection and try again. |
| a screen outside the person's role (screen only, no API code) | That screen is not available for your role. |

On a 422, the screens show the field errors below under their fields; the `alert` shows the message of the first field error where Interactions says so, and otherwise the validation_failed copy.

**Field errors.** These are the messages in a 422 `errors` object.

| Field and condition | Message |
|---|---|
| any key not published for that endpoint and station kind | This field cannot be set. |
| a required key missing | This field is required. |
| in a hold, move or out-of-service window: start or end not on a quarter hour, a start of 24:00, or any time with hour 24 other than an end of exactly 24:00 (on that field) | Times must fall on the quarter hour. |
| in a hold, move or out-of-service window: end not after start, or not on the same date (field `end`) | End must be after start on the same day. |
| hourly block shorter than 1 hour (field `end`) | A block must be at least 1 hour. |
| hourly block longer than 12 hours (field `end`) | A block can be at most 12 hours. |
| block already ended (field `end`; field `date` for shelves) | This block has already ended. |
| block more than 180 days ahead (field `date`) | Bookings open 180 days ahead. |
| move to a station of a different kind from the booking (field `stationId`) | Move a block to a station of the same kind. |
| local time does not exist (fields `start`, `end`, `effectiveFrom`) | <HH:MM> does not exist on <date> in <IANA zone> (clocks go forward). |
| overlaps an out-of-service period (field `stationId`) | <station> is out of service then. |
| not enough hours (field `hours`) | That needs <hours> hours; you have <hours> left for <Month YYYY>. |
| hold or confirm with a required document missing (field `documents`) | Upload an approved <document type> before booking. |
| hold or confirm with a document expiring before the block (field `documents`) | Your <document type> expires on <date>, before this block. |
| check-in with no current document of a required type (field `documents`) | No approved <document type> on file; check-in is refused. |
| check-in after the current document's expiry (field `documents`) | The <document type> expired on <date>; check-in is refused. |
| repeatWeeks out of range | Repeat for 1 to 12 weeks. |
| days out of range | Shelf bookings run 1 to 31 days. |
| notes too long | Notes can be at most 500 characters. |
| businessName empty, longer than 80 characters, or containing a refused character | Business name must be 1 to 80 characters with no line breaks. |
| any rate out of range (standard, peak or shelf-day) | Enter a rate from $0.01 to $1,000.00. |
| effectiveFrom not in the future | Rate changes must start in the future. |
| any peak window invalid: no days, a time off the quarter hour, a start of 24:00, any other time with hour 24 than an end of exactly 24:00, or a start not before its end (field `windows`) | Peak windows need days and a start before the end, on the quarter hour. |
| rulesVersion or version not a whole number | Reload and try again. |
| document type | Choose insurance certificate or food-handler card. |
| expiryDate missing or past | Enter an expiry date of today or later. |
| file missing | Choose a file to upload. |
| area | Choose an area. |
| task | Describe the task in 1 to 120 characters. |
| reason (out of service) | Give a reason in 1 to 120 characters. |
| sanitizerPpm | Sanitizer strength is 0 to 400 ppm. |
| initials | Initials are 1 to 4 letters. |
| email | Enter a valid email address. |
| password missing or not text | Enter your password. |
| expiresAt | Choose an expiry in the future, at most 30 days away. |
| month | Use a month in the form YYYY-MM. |
| date | Use a date in the form YYYY-MM-DD. |

Notes on the field errors:
- In the `hours` message, the first `<hours>` is the hours the request adds in that month. The second `<hours>` is that month's balance at the request's turn, as set out in Business rules › Hour ledger. `<Month YYYY>` is the month that runs short.
- In the "does not exist" message, `<HH:MM>` and `<date>` are the refused local time and its date.
- In the check-in expiry message, `<date>` is the expiry date of the member's current document.
- The rows that judge a whole block (end after start, length, already ended and 180 days ahead) apply to holds and moves alike. They run only once `date`, `start` and `end`, or `date` and `days`, have each passed their own format rows. When one key fails several of them, it carries the message of the row listed first.
- In a weekly series, every week is judged under the same keys, and the earliest failing week gives the message.
- Peak-window errors are always reported once, under the single key `windows`, whichever window or time is at fault.
- Character counts in these messages follow Business rules › Text fields.

**Service banner** (`region "Service status"`):
- Billing down: "Billing is unavailable. Confirmed bookings are saved and marked Pending billing; charges are recorded automatically when billing returns."
- Storage down: "Document storage is unavailable. Uploads and downloads are paused; monthly sanitation PDFs are queued."
- Under either message: "<n> billing items waiting · <n> storage items waiting". Each `<n>` is the matching queued count defined in Services.
- **Updating at once.** After any of the person's own actions answers while a service is down (a confirm answering 202, a cancel, a move, a release, a waive, a sanitation PDF answering 202), the banner re-reads `GET /api/service-status` at once, so its waiting line shows the new counts within one second of that action's response.
- **Updating in place.** Every poll and re-read changes only the text of the counts and messages inside the same region. The region is never removed and re-inserted while a service stays down, its slide-in never replays, and focus never moves.
- The banner disappears within 10 seconds of the service returning.
- Blocks change from "Pending billing" to "Billed" at the next board refresh after their charges are recorded, and invoice lines at the next invoice refresh.

**Inspector view states.**
- On page load, an expired link shows "This link has expired.", a revoked or regenerated link shows "This link is no longer active.", and an unknown token shows "This link is not valid.", each in place of the records.
- A download answered 410 `link_expired` replaces the whole view in place, without navigating, with "This link has expired.". A download answered 410 `link_revoked` replaces it with "This link is no longer active.". No record stays visible, and no file is saved.
- A download answered 503 shows the storage_unavailable download copy in the `alert`, and the view stays as it was.
- A download answered 404 shows the not_found copy in the `alert`, and the view stays as it was.
- No JSON error body is ever shown as a page.

## Backend

### API (DP-01, DP-02, DP-04, DP-06, DP-07, DP-08, DP-13, DP-14, DP-17, DP-23, DP-26, DP-30, DP-32, DP-33, DP-34, DP-38, DP-41, DP-42, DP-43, DP-45, DP-46, DP-47, DP-48, DP-54, DP-65, DP-66, DP-67, DP-69, DP-72, DP-74, DP-75, DP-78, DP-79, DP-80, DP-82, DP-83, DP-86, DP-89, DP-91, DP-93, DP-94, DP-96, DP-99)

**Basics.**
- All endpoints live under `/api`.
- Requests and responses are `application/json; charset=utf-8` unless stated otherwise.
- Every response carries the caching headers set out in Server boundary.
- A JSON request body larger than 100,000 bytes answers 413 `payload_too_large`. Exactly 100,000 bytes is accepted.
- **Content type.** A request with a body to a JSON endpoint must carry `Content-Type: application/json`, with or without a charset parameter. Any other content type answers 415 `unsupported_media_type`, even when the body would parse as JSON. For example, `POST /api/session` sent as `text/plain`, `application/x-www-form-urlencoded` or `multipart/form-data` answers 415, and is never counted as a sign-in failure.
- An endpoint whose request is `{}` also accepts an empty body, with or without a content type, and treats it as `{}`.
- Money fields are integer cents, and their names end in `Cents`.
- Hours are numbers in quarter-hour steps.
- Every object in a response carries exactly the keys listed for it in this section.

**Only the published surface.**
- The endpoint table below is the whole API. A method and path under `/api` that the table does not list answers `404 {"error":"not_found","message":"That was not found."}` with exactly the keys `error` and `message`, and changes nothing. This includes a listed path called with an unlisted method; for example, PUT, PATCH or DELETE on `/api/months/{month}/close` answers 404.
- Such a request is checked only against the cross-origin, body-size and session steps of the precedence rule (an unauthenticated request answers 401, a cross-site state-changing one 403), and then answers 404.
- The one exception is the inspector paths, where any method other than GET answers 405 `read_only` as stated below.
- Lineboard has no reopen, reset, seed, test-clock, debug or admin endpoint. No request can reopen a closed month, add, edit or remove its invoice lines, or change a committed Kill Bill invoice.

**Sessions.**
- The session is an HttpOnly, SameSite=Lax cookie named `lineboard_session`. It holds a random id that is at least 32 characters long.
- Sessions are stored in PostgreSQL, and the person and kitchen are read from there on every request.
- Every successful sign-in creates a new session with a new id. Any session whose cookie came with the sign-in request is ended, and its cookie never authenticates again.
- `DELETE /api/session` deletes the session. Any later request carrying that cookie, from any browser, answers 401 `unauthenticated`. Other sessions of the same person are untouched.

**Exact write bodies.**
- Every request body, JSON or multipart, accepts only the keys listed for it in the endpoint table.
  - Holds and moves accept only the keys for the target station's kind. A move to a station of another kind is the exception, and is refused as set out in Business rules › Moves.
  - Rates accept only the keys for that station's kind.
- Any other key answers 422 with `errors["<key>"]` set to "This field cannot be set.", and nothing changes. If there are several such keys, each one is listed.
- A listed key that is missing answers 422 with "This field is required." on that key. The exceptions are these optional keys, which take their defaults when left out:
  - on holds, `repeatWeeks` (default 1) and `notes` (default "");
  - on sanitation entries, `sanitizerPpm` (default null) and `notes` (default "").
- For example, each of these is refused:
  - a rate body carrying `effectiveAt`, `status`, `stationId`, `kind`, `rates`, `capacity` or `currentRate`, which writes no version;
  - a shelf rate body carrying `offPeakHourlyCents`;
  - `PATCH /api/members/me` with `email` or `allowanceHours` beside `businessName`, which changes neither the name nor anything else;
  - a hold carrying `memberId`, `chargeCents`, `status` or `actions`, which holds nothing.

**Formats.** These are used everywhere in this brief:

| Placeholder | Format |
|---|---|
| `<date>` | a kitchen-local date, YYYY-MM-DD |
| `<HH:MM>`, `<start>`, `<end>` | kitchen-local 24-hour times; an end at the end of its date is written `24:00` |
| `<station>` | the station name |
| `<block label>` | "<station> <date> <start>–<end>" (with an en dash) for hourly blocks, for example "Oven 2 2026-11-01 20:00–24:00"; "<station> <date> for <n> days" for shelves, with "1 day" when n is 1. Unless stated otherwise, it describes the booking's current block |
| `<booking id>` | the booking's `id` |
| `<Month YYYY>` | the English month name and year, for example "November 2026" |
| `$<amount>` | dollars with comma thousands separators and two decimals. A negative amount is written `-$<amount>`, for example `-$63.63` |
| `<hours>` | a decimal with up to two places and no trailing zeros, for example 7, 6.5 or 6.25 |
| `<business>` | the member's business name in force at the moment the text is produced |
| `<name>` | the person's full name, for example "Rina Sato" |
| `<document type>` | "insurance certificate" or "food-handler card" |
| `<IANA zone>` | the kitchen's time zone name |
| `<kitchen name>` | the kitchen's name |
| `<file name>` | the file name the browser reports at upload |

Form fields use these formats:

| Field | Format |
|---|---|
| "Date", "Expiry date" | YYYY-MM-DD |
| "Start", "End" | HH:MM; "End" also accepts 24:00 |
| "Month", "Report month" | YYYY-MM |
| "Link expires", "Effective from" | `YYYY-MM-DD HH:MM` in kitchen time, for example `2026-11-01 00:00` |
| "Standard hourly rate", "Peak hourly rate", "Shelf-day rate" | dollars with up to two decimals; sent as `offPeakHourlyCents`, `peakHourlyCents` and `shelfDayCents` |

- The browser sends "Effective from" as the API's `effectiveFrom`, in the form `YYYY-MM-DDTHH:MM` in kitchen wall time.
- It sends "Link expires" as an `expiresAt` instant carrying the kitchen's UTC offset.
- Instants in responses are ISO 8601 (`YYYY-MM-DDTHH:MM:SS±HH:MM`) with the kitchen's UTC offset in force at that instant.
- An instant is never written with hour 24. The end of a kitchen-local day (24:00) is written as 00:00 on the next day, with the offset in force at that instant. For example, at Northside the end of 2026-10-31 is written `2026-11-01T00:00:00-04:00`, and the end of 2026-11-01 is written `2026-11-02T00:00:00-05:00`.
- Local time fields (`localEnd`, `end` in requests, peak-window and out-of-service `end`) use `"24:00"` for the end of the date.

**Error shape.**
- Every error body is `{"error":"<code>","message":"<sentence>"}`, plus only the extra keys this section lists for that code.
- `message` is exactly the copy published for that code in Feedback states › Errors, with its placeholders filled in. Where the copy has variants, the variant named for that endpoint applies: `stale_version` by the action, `storage_unavailable` with the upload copy on `POST /api/documents` and the download copy on every file download, inspector downloads included, and `invalid_transition` by booking or document.
- A 422 adds `"errors":{"<field>":"<message from Feedback states>"}`, keyed by the request field name, or by the key that the Field errors table names for that row.
- An unexpected server failure answers `500 {"error":"internal","message":"Lineboard hit an unexpected problem. Try again."}`. Contention never produces a 500, as set out in Business rules › Hour ledger.

| Status | Codes |
|---|---|
| 400 | `bad_request` (malformed JSON); `idempotency_key_required` (the header is missing, or is not 8–128 letters, digits, `-` or `_`) |
| 401 | `unauthenticated`, `invalid_credentials` |
| 403 | `forbidden`, `cross_origin` |
| 404 | `not_found` |
| 405 | `read_only` |
| 409 | `block_taken` (adds `"taken":[{"stationId","stationName","date","start","end"}]`) |
| 409 | `invalid_transition` (adds `"from":"<status>","action":"<action>","current":<the booking, or the document on document approval, in the caller's shape>`) |
| 409 | `document_superseded` (adds `"current":<the requested document>,"supersededBy":"<id of that member's newest document of that type>"`) |
| 409 | `hold_expired`, `idempotency_key_reused`, `month_closed`, `billing_pending` |
| 409 | `billing_mismatch` (adds `"members":["<member id>",...]`, every member whose amount differs, in ascending member-id order) |
| 409 | `rate_version_exists` |
| 410 | `link_expired`, `link_revoked` |
| 412 | `stale_version` (adds `"current"`: the booking on a move, the kitchen object on a kitchen-rule save, the document on an approval) |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type`, `unsupported_file_type` |
| 422 | `validation_failed` |
| 429 | `rate_limited` (the response carries a `Retry-After` header in whole seconds) |
| 500 | `internal` |
| 503 | `billing_unavailable`, `storage_unavailable` |

The `taken` list of a `block_taken` holds:
- for hourly claims, one entry for each requested week that is taken, giving the requested block's date, start and end;
- for shelf claims, one entry for each full day in date order, with `start` and `end` null.

The message names the first entry.

On `POST /api/bookings/{id}/move`, every 409 and 412 body carries `"current":<booking>`. In any body, `current` equals what a `GET` of that booking, document or kitchen returns to the same caller at that moment, `actions` included.

**Error precedence.** This is the one rule for the whole API: the first failing check decides the response.
1. A cross-origin state-changing request (403 `cross_origin`, as set out in Server boundary).
2. A body over its size limit.
3. A wrong content type.
4. Malformed JSON.
5. No valid session, on an endpoint that needs one. Every path not in the endpoint table needs one.
6. A missing or invalid Idempotency-Key.
7. An unknown resource. This includes any id in the path or body that belongs to another kitchen or, for members, to another member.
8. A role that may not perform the action.
9. An idempotent replay, which returns its stored response, or a key reused with a different request (409).
10. Validation of the request on its own. This covers:
    - keys that may not be set and missing keys;
    - every rule that reads only the request and the clock: formats, quarter hours and the 24:00 rule, block length, already ended, 180 days ahead, a local time that does not exist, a move to a station of another kind, value ranges, peak-window validity, text limits and refused characters, `effectiveFrom` and `expiresAt` timing, and `month` and `date` parameters.

    For uploads, the file-type check (415 `unsupported_file_type`) comes before the field checks (422). Elsewhere this step answers 422.
11. On sign-in only: a throttled email (429), then wrong credentials (401 `invalid_credentials`).
12. State checks against stored records, in this fixed order:
    1. 409 `document_superseded`: a document approval on a superseded document.
    2. 412 `stale_version`: a move whose `version` is not the booking's current version, a kitchen-rule save whose `rulesVersion` is not current, or an approval whose `version` is not the document's current version.
    3. 409 `month_closed`: the month of the booking's current block, a move's target month, a hold's month, or the month being closed is already closed. A waiver never answers `month_closed`; see Business rules › Closed months.
    4. 409 `invalid_transition`: the action is not legal from the booking's or document's current status, after any lapse that is due has been applied. A confirm whose booking is `expired` because its hold lapsed skips this check and is answered at the next step.
    5. 409 `block_taken` or `hold_expired`:
       - a hold or move whose time is no longer free on its station (Business rules › Occupancy) answers `block_taken`;
       - a confirm of a lapsed hold (a booking now `expired`) answers `block_taken` when its time is no longer free, and `hold_expired` otherwise.
    6. The remaining state conflicts: 409 `rate_version_exists`, then 409 `billing_pending`, then 410 `link_revoked` before 410 `link_expired`.
    7. 422 checks that read other stored records: `stationId` (overlaps an out-of-service window), `documents`, and `hours` (the balance at the request's turn). When more than one of these fails, they are all reported together in one 422 `errors` object.
13. An unreachable dependency (503).
14. A month close whose Kill Bill drafts differ from Lineboard's totals (409 `billing_mismatch`).

Steps 3, 4 and 6 to 14 apply only to listed endpoints; unlisted paths follow Only the published surface.

For example:
- a move carrying a stale `version` onto occupied time answers 412;
- a move carrying a stale `version` of a booking that has since been cancelled answers 412;
- a move with the current `version` of a cancelled booking into a closed month answers 409 `month_closed`;
- a move onto occupied time in a month whose hours run short answers 409 `block_taken`;
- a confirm of a hold that lapsed while nobody claimed its time answers 409 `hold_expired`, never `invalid_transition`;
- a check-in after the grace instant by a member whose certificate has expired answers 409 `invalid_transition` with `"from":"no_show"`;
- a cross-site sign-in with a wrong password answers 403 and is not counted, and a cross-site POST to an unlisted path answers 403, not 404.

On inspector-link paths, a cross-site state-changing request answers 403 first; then any method other than GET answers 405 before any other check. On those paths an unknown token, then 410 for an ended link, then an unknown or no-longer-current document or month (404), then an unreachable storage (503) decide the answer, in that order.

Before any of the state checks, every request that reads or acts on a booking first applies any automatic hold lapse or no-show that is already due, as set out in Business rules.

**Roles in the tables:** O = operator, L = shift lead, M = member (own records only), All = any signed-in person.

**Member records.** A member record has one shape per caller:
- for the operator, and for a member reading their own record, exactly `{"id","name","businessName","email"}`;
- for a shift lead, exactly `{"id","name","businessName"}`.

This applies to `GET /api/members`, `GET /api/members/{memberId}`, `PATCH /api/members/me` and every other response that carries a member record.

**Never in any response.**
- No response, error bodies included, contains a key whose name contains any of these (ignoring case): `password`, `hash`, `killbill`, `accountId`, `storageKey`, `objectKey`, `bucket`, `sessionId`.
- No response contains `allowanceHours`, or any other plan-allowance key, outside an hour-bank object.
- Server boundary › Opaque errors sets out what no error body, header or service-status field may contain.

**Kitchen object:** `{"id","name","slug","timeZone","today":"YYYY-MM-DD","currentMonth":"YYYY-MM","peakWindows":[<peak window>...],"requiredDocuments":[...],"rulesVersion":<integer>}`.
- A peak window is `{"days":["mon"|"tue"|"wed"|"thu"|"fri"|"sat"|"sun",...],"start":"HH:MM","end":"HH:MM"}`; `end` may be `"24:00"`, `start` never.
- `requiredDocuments` holds any of `"insurance_certificate"` and `"food_handler_card"`.
- `rulesVersion` goes up by one with each successful peak-window or requirement save.

**Booking object** (shown as the operator sees it three days before the block):
```json
{"id":"...","memberId":"mem_ada","businessName":"Bello Bakes","stationId":"stn_oven2","stationName":"Oven 2",
 "kind":"hourly","localDate":"2026-11-03","localStart":"18:00","localEnd":"21:00","days":null,
 "start":"2026-11-03T18:00:00-05:00","end":"2026-11-03T21:00:00-05:00",
 "status":"confirmed","billingStatus":"billed","hours":3,"peakHours":1,
 "chargeCents":12725,"penaltyCents":0,"penaltyWaived":false,"conflict":false,
 "seriesId":null,"notes":"","holdExpiresAt":null,"confirmedAt":"2026-10-27T09:12:00-04:00",
 "actions":["cancel","move"],"version":2}
```
- `status` is one of `held`, `confirmed`, `checked_in`, `completed`, `cancelled_free`, `cancelled_late`, `no_show` or `expired`.
- The block fields (`stationId` through `end`), `hours`, `peakHours` and `chargeCents` always describe the booking's current block and current charge.
- For an hourly block ending at the end of its date, `localEnd` is `"24:00"` and `end` is 00:00 on the next date under Formats.
- `businessName` is the member's current business name.
- `confirmedAt` is null until the booking is confirmed, and stays null for a hold that ended unconfirmed.
- `actions` lists the actions the caller may take on this booking at the response instant, as set out in Business rules › Offered actions.
- `billingStatus` is:
  - `not_billed` for bookings that never reached `confirmed`;
  - otherwise `billed` when every Kill Bill item for the booking is recorded, and `pending_billing` when any is not.
- For shelves:
  - `kind` is `shelf`;
  - `localStart` and `localEnd` are null;
  - `days` is set;
  - `start` is 00:00 kitchen time on the first day;
  - `end` is 00:00 kitchen time on the day after the last day, written with that instant's own offset under Formats. For example, a 2-day booking at Northside from 2026-10-31 has `start` `2026-10-31T00:00:00-04:00` and `end` `2026-11-02T00:00:00-05:00`;
  - `hours` and `peakHours` are 0.
- Staff, and a member reading their own bookings, receive exactly these keys.
- When a member reads the board, another member's block carries only `id`, `stationId`, `localDate`, `localStart`, `localEnd`, `days`, `start`, `end` and `"status":"booked"`, and no `actions`.

**Board contents.** The `blocks` of `GET /api/board` are chosen like this:
- A booking is on the board date when its current block is an hourly block starting on that kitchen-local date, or a shelf booking whose days include that date.
- `blocks` holds every booking on the board date whose status is `held`, `confirmed`, `checked_in`, `completed` or `no_show`. A held booking is included until its hold lapses.
- A member also receives their own `expired` bookings on the board date. The board draws these only as rail tickets, never in a lane.
- Bookings in `cancelled_free` or `cancelled_late` are never in `blocks`, and neither are other members' `expired` bookings.
- Staff receive every block in the full booking shape. A member receives their own blocks in the full shape and every other member's in the `booked` shape.
- `blocks` is ordered by station in lane order, then by start, then by confirmation or hold time.
- `outOfService` holds every out-of-service window that overlaps the board date, ordered by station and then start.
- `now` is the server's instant at which the response was produced, with the kitchen's offset; `today` is the kitchen-local date of that instant; every booking's `actions` is judged at that same instant.

**Out-of-service window object:** `{"id","stationId","start":"<instant>","end":"<instant>","localDate":"YYYY-MM-DD","localStart":"HH:MM","localEnd":"HH:MM","reason"}`; `localEnd` may be `"24:00"`.

**Hour bank object:** `{"month":"YYYY-MM","allowanceHours":40,"usedHours":3,"balanceHours":37}`.

**Rate object:**
- hourly: `{"effectiveFrom":"YYYY-MM-DDTHH:MM","effectiveAt":"<instant>","status":"past"|"current"|"scheduled","offPeakHourlyCents","peakHourlyCents"}`;
- shelf: `{"effectiveFrom","effectiveAt","status","shelfDayCents"}`.

`effectiveFrom` is the kitchen wall time as it was entered. `effectiveAt` is the instant it resolves to under Business rules › Rates. `status` is decided by the server clock at the moment of the request, as set out in Business rules › Rates. `offPeakHourlyCents` is the standard hourly rate.

**Station object:** `{"id","name","kind":"hourly"|"shelf","capacity":<integer>|null,"currentRate":<rate>,"rates":[<rate>...]}`.
- `capacity` is the number of shelf slots for shelves, and null for hourly stations.
- `currentRate` is the version in force at the moment of the request, the one whose `status` is `current`.
- `rates` lists every version, oldest first.

**Document object:** `{"id","memberId","businessName","type":"insurance_certificate"|"food_handler_card","expiryDate","status":"submitted"|"approved"|"expiring"|"expired"|"superseded","current":true|false,"fileName","contentType","sizeBytes","uploadedAt","approvedAt","version":<integer>}`.
- `approvedAt` is null until approval.
- `version` starts at 1 and goes up by one on approval and on being superseded. The `approved`, `expiring` and `expired` statuses are worked out from the date and never change `version`.
- `sizeBytes` equals the byte length of the stored object.

**Sanitation entry object:** `{"id","area","task","sanitizerPpm","initials","notes","loggedAt","localDate","localTime","loggedBy"}`.
- `sanitizerPpm` is an integer from 0 to 400, or null.
- `notes` is a string, empty when none was given.
- `loggedAt` is the server-stamped instant. `localDate` (YYYY-MM-DD) and `localTime` (HH:MM) give that instant in kitchen time.
- `loggedBy` is the full name of the signed-in person who logged the entry, for example "Theo Lindqvist".

**Sanitation report object:** `{"month":"YYYY-MM","status":"stored"|"queued","storedAt":<instant>|null}`. `storedAt` is the instant the PDF was last stored. It is null while the month's first PDF is still queued.

**Inspector link object:**
```json
{"id":"...","email":"inspector@example.org","expiresAt":"...","status":"active",
 "lastAccessAt":null,"views":0,"downloads":0,"access":[]}
```
- `status` is `active`, `expired` or `revoked`, decided by the server clock at the moment of the request.
- `views` counts every `view` record on the link. `downloads` counts every `document` and `report` record. Both cover the link's whole history.
- `lastAccessAt` is the newest record's `at`, or null when there are no records.
- `access` lists the newest 50 records, newest first. Ties are broken by the order in which the records were written. Each record is `{"at":"<instant>","action":"view"|"document"|"report","target":null|"<documentId>"|"YYYY-MM"}`.
- `url` is present only in create and regenerate responses.

**Endpoints.**

| Method and path | Who | Request | Success |
|---|---|---|---|
| POST /api/session | anyone | `{"email","password"}` | 200 `{"user":{"id","name","email","role":"operator"\|"shift_lead"\|"member","memberId"},"kitchen":{"id","name","slug","timeZone"}}` with exactly those keys; sets a new cookie. `memberId` is null for staff |
| GET /api/session | All | | 200, same body |
| DELETE /api/session | All | | 204 |
| GET /api/kitchen | All | | 200 kitchen object |
| GET /api/board?date=YYYY-MM-DD | All | `date` optional, default kitchen-local today | 200 `{"date","today","now","timeZone","stations":[{"id","name","kind","capacity"}],"peakWindows":[<peak window>...],"blocks":[booking...],"outOfService":[<out-of-service window>...],"hourBank":<hour bank for the date's month, members only, otherwise null>}`, with `blocks`, `outOfService` and `now` as set out in Board contents |
| GET /api/stations | All | | 200 `{"stations":[<station>...]}` in lane order |
| POST /api/stations/{stationId}/rates | O | hourly: `{"offPeakHourlyCents","peakHourlyCents","effectiveFrom":"YYYY-MM-DDTHH:MM"}`; shelf: `{"shelfDayCents","effectiveFrom"}` | 201 `{"station":<station>}` |
| PUT /api/kitchen/peak-windows | O | `{"windows":[<peak window>...],"rulesVersion":<integer>}` (0–10 windows) | 200 kitchen object |
| PUT /api/kitchen/document-requirements | O | `{"required":["insurance_certificate","food_handler_card"],"rulesVersion":<integer>}` (any subset) | 200 kitchen object |
| POST /api/bookings | M, header `Idempotency-Key` | hourly: `{"stationId","date","start":"HH:MM","end":"HH:MM" or "24:00","repeatWeeks":1,"notes":""}`; shelf: `{"stationId","date","days":1,"notes":""}` | 201 `{"bookings":[booking...],"seriesId":null\|"..."}` |
| POST /api/bookings/{id}/confirm | M (owner), header `Idempotency-Key` | `{}` | 200 when every charge is recorded in Kill Bill, 202 when any is pending; body `{"bookings":[booking...],"hourBank":<hour bank of the confirmed booking's month>}` |
| GET /api/bookings?month=YYYY-MM&memberId= | M (own), O, L | `month` optional, default kitchen-local current month; `memberId` ignored for members | 200 `{"month","bookings":[booking...]}`: the bookings whose current block starts in the month and that ever reached `confirmed`, in whatever status they now have, plus `held` bookings until their hold lapses, ordered by start. A hold that ended unconfirmed is never listed |
| GET /api/bookings/{id} | M (owner), O, L | | 200 `{"booking":<booking>}`, for every booking including a hold that ended unconfirmed |
| POST /api/bookings/{id}/cancel | M (owner), O, header `Idempotency-Key` | `{}` | 200 `{"booking","hourBank"}`, with the hour bank of the block's current month |
| POST /api/bookings/{id}/check-in, /check-out, /no-show | L, O | `{}` | 200 `{"booking"}` |
| POST /api/bookings/{id}/move | L, O | hourly: `{"stationId","date","start","end","version"}` (`end` may be `"24:00"`); shelf: `{"stationId","date","days","version"}` | 200 `{"booking","hourBank"}`, with the hour bank of the new block's month |
| POST /api/bookings/{id}/release | L, O | `{}` | 200 `{"booking","hourBank"}` |
| POST /api/bookings/{id}/waive-penalty | O, header `Idempotency-Key` | `{}` | 200 `{"booking","creditMonth":"YYYY-MM"}`, where `creditMonth` is the month whose invoice carries the credit |
| POST /api/out-of-service | L, O | `{"stationId","date","start","end","reason"}` (`end` may be `"24:00"`) | 201 `{"window":<out-of-service window>,"conflicts":["<booking id>",...]}`, listing the bookings it flagged |
| DELETE /api/out-of-service/{id} | L, O | | 200 `{"conflicts":["<booking id>",...]}`, listing the bookings on that station still in conflict with another window |
| GET /api/members?q= | O, L | `q` optional | 200 `{"members":[<member record>...]}`, at most 20, ordered by business name; matching as in Business rules |
| GET /api/members/{memberId} | M (self), O, L | | 200 `{"member":<member record>}` |
| PATCH /api/members/me | M | `{"businessName"}` | 200 `{"member":<member record>}` |
| GET /api/members/{memberId}/hour-bank?month= | M (self), O, L | `month` optional, default kitchen-local current month | 200 hour bank |
| GET /api/members/{memberId}/invoices/{month} | M (self), O | | 200 `{"memberId","month","status":"open"\|"closed","lines":[{"kind":"booking"\|"penalty"\|"credit","bookingId","description","amountCents","billingStatus":"billed"\|"pending_billing"}],"totalCents","hourBank"}`; credit `amountCents` are negative |
| POST /api/months/{month}/close | O | `{}` | 200 `{"month","invoices":[{"memberId","totalCents"}]}`, one entry per member with lines that month |
| GET /api/reports/utilisation?month= | O | `month` optional, default kitchen-local current month | 200 `{"month","stations":[{"stationId","name","bookedHours","peakHours","shelfDays","revenueCents"}],"totals":{"bookedHours","peakHours","shelfDays","revenueCents","adjustmentCents"}}`, listing every station, including those with zeros |
| GET /api/exports/usage.csv?month= | O | | 200 `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="lineboard-usage-<kitchen slug>-<YYYY-MM>.csv"` |
| POST /api/documents | M | `multipart/form-data` with parts `type`, `expiryDate` (YYYY-MM-DD), `file` | 201 `{"document":<document>}`, as the document stood when it was written |
| GET /api/documents?memberId= | M (own), O, L | `memberId` optional; ignored for members | 200 `{"documents":[<document>...]}`, newest upload first; ties follow the seed order in Seed data |
| GET /api/documents/{id} | M (owner), O, L | | 200 `{"document":<document>}` |
| GET /api/documents/{id}/file | M (owner), O, L | | 200 file stream |
| POST /api/documents/{id}/approve | O | `{"version":<integer>}` | 200 `{"document":<document>}` |
| POST /api/sanitation-entries | L, O | `{"area","task","sanitizerPpm":null\|0-400,"initials","notes"}` | 201 `{"entry":<sanitation entry>}` |
| GET /api/sanitation-entries?month= | L, O | `month` optional, default kitchen-local current month | 200 `{"entries":[<sanitation entry>...]}`, the entries logged in that kitchen-local month, newest first |
| POST /api/sanitation-reports | O | `{"month"}` | 201 `{"report":<sanitation report>}` with status `stored`, or 202 `{"report":<sanitation report>}` with status `queued` while storage is down |
| GET /api/sanitation-reports | L, O | | 200 `{"reports":[<sanitation report>...]}`, newest month first |
| GET /api/sanitation-reports/{month}/file | L, O | | 200 `application/pdf` attachment |
| POST /api/inspector-links | O | `{"email","expiresAt":"<ISO instant with offset>"}` | 201 `{"link":<inspector link with url>}`, where `url` is `"<origin>/inspect/<token>"` |
| GET /api/inspector-links | O | | 200 `{"links":[<inspector link>...]}`, newest link first, without `url` |
| POST /api/inspector-links/{id}/regenerate | O | `{}` | 200 `{"link":<inspector link with url>}`: the same id, expiry and access history, with a new token |
| DELETE /api/inspector-links/{id} | O | | 200 `{"link":<inspector link with status "revoked">}` |
| GET /api/inspect/{token} | link holder | | 200 `{"kitchen":{"name","timeZone"},"expiresAt","sanitationEntries":[<sanitation entry>...],"sanitationReports":[{"month"}],"certificates":[{"documentId","businessName","type","expiryDate","status"}]}`. `sanitationEntries` covers the last 90 kitchen-local days, newest first, in the same shape staff see. `sanitationReports` lists only stored months, newest first. `certificates` is judged at the moment of the request as set out in Business rules › Inspector links |
| GET /api/inspect/{token}/documents/{documentId}/file | link holder | | 200 file stream |
| GET /api/inspect/{token}/sanitation-reports/{month}/file | link holder | | 200 PDF attachment |
| GET /api/service-status | All | | 200 with exactly `{"billing":"up"\|"down","storage":"up"\|"down","queued":{"billing":<n>,"storage":<n>}}` and no other key, with the queued counts defined in Services |
| GET /api/health | anyone | | 200 `{"status":"ok"}` |

**Extra errors per endpoint.** The 401, 403, 404, 415 and 422 (keys that may not be set) responses follow from the role column, the content-type rule and the precedence rule. That rule also decides between several of the errors below on one request.
- Sign in: 401 `invalid_credentials`, 429 `rate_limited`, 422.
- Holds: 409 `block_taken`, 409 `month_closed`, 422.
- Confirm: 409 `block_taken`, 409 `hold_expired`, 409 `invalid_transition`, 409 `month_closed`, 422 (`stationId`, `documents`, `hours`).
- Check-in: 409 `invalid_transition`, 409 `month_closed`, 422 (`documents`).
- Cancel, check-out, no-show, release: 409 `invalid_transition`, 409 `month_closed`.
- Waive: 409 `invalid_transition`.
- Move: 409 `block_taken`, 409 `invalid_transition`, 409 `month_closed`, 412 `stale_version`, 422 (including `stationId` and `hours`).
- Station rates: 409 `rate_version_exists`, 422.
- Peak windows and document requirements: 412 `stale_version`, 422 (peak windows under `windows`).
- Business name: 422.
- Uploads:
  - 413 when the file part exceeds 5,000,000 bytes (exactly 5,000,000 is accepted) or the whole request exceeds 5,200,000 bytes;
  - 415 `unsupported_file_type`;
  - 422;
  - 503 `storage_unavailable`.
- Document approval: 409 `document_superseded`, 412 `stale_version`, 409 `invalid_transition`.
- File downloads: 503 `storage_unavailable`.
- Close: 409 `month_closed` (already closed), 409 `billing_pending`, 503 `billing_unavailable`, 409 `billing_mismatch`.
- Inspector paths: 404 for an unknown token or for a document or month the link does not currently open, 410 `link_expired`, 410 `link_revoked`, 405 `read_only`, 503 `storage_unavailable` on downloads.
- Every endpoint with `month` or `date` query parameters: 422 when they are malformed.

### Business rules (DP-02, DP-03, DP-04, DP-06, DP-07, DP-08, DP-09, DP-10, DP-13, DP-14, DP-16, DP-17, DP-19, DP-20, DP-21, DP-23, DP-25, DP-26, DP-29, DP-30, DP-34, DP-35, DP-36, DP-38, DP-39, DP-41, DP-42, DP-43, DP-45, DP-46, DP-47, DP-48, DP-61, DP-62, DP-63, DP-65, DP-69, DP-71, DP-72, DP-73, DP-74, DP-77, DP-78, DP-79, DP-80, DP-82, DP-85, DP-86, DP-89, DP-91, DP-99)

**Kitchens and roles.**
- Every person belongs to exactly one kitchen. They see only that kitchen's stations, members, bookings, documents, invoices, reports, exports, sanitation records, inspector links and inspector access records.
- A member reaches only their own bookings, documents, invoices and hour bank. Other members' records answer 404 under the precedence rule. On the board, other members' blocks are reduced to the `booked` shape.
- Only the operator can do the following. A shift lead or member who tries any of them gets 403 `forbidden`:
  - change rates, peak windows and document requirements;
  - approve documents;
  - waive fees;
  - close months;
  - read reports, exports and other members' invoices;
  - save sanitation PDFs;
  - manage inspector links and read their access records.

**Return addresses.**
- A signed-out load of any published signed-in screen (`/board`, `/bookings`, `/documents`, `/invoices`, `/reports`, `/sanitation`, `/settings`), and a 401 on any such screen, replaces the current history entry with `/?next=<percent-encoded path and query>` of that screen.
- After a successful sign-in, or when a person who is already signed in opens the sign-in address, they land on `next` if it is valid, and otherwise on `/board` with nothing in the `alert`. Plain `/` with no `next` also lands on `/board`.
- `next` is percent-decoded exactly once. It is valid only when the decoded value's path is exactly one of the published signed-in screens above, optionally followed by a query, with nothing else. A value is invalid when it has a backslash, a control character, a scheme, a host, userinfo, a fragment or a leading double slash, anywhere after that single decode.
- For example, each of these lands on `/board` with no alert: `//evil.example`, `/\evil.example`, `https://evil.example/board`, `/%2F/evil.example`, `/%252F%252Fevil.example`, `/api/exports/usage.csv?month=2026-10`, `/inspect/abc` and `/board%0A`.
- A signed-in person who opens a screen outside their role's navigation, directly or through `next`, lands on `/board` through a replaced history entry, so Back never returns to the refused address. The `alert` shows the role-refusal copy from Feedback states until the person's next action.
- An invalid `next` is not an error in itself, so it adds no alert.

**Member picker.**
- `q` matches, case-insensitively, as a literal substring of the name or the business name. It never matches email.
- The characters `%`, `_` and `\` in `q` match only themselves.
- An empty or missing `q` lists the kitchen's members.
- For example, with the seed data:
  - a shift lead searching `satopickle` gets `{"members":[]}`;
  - `sato` gets exactly Rina Sato's record, without email;
  - `sat` gets exactly Rina Sato's record;
  - `_` gets `{"members":[]}`, because no seeded name contains an underscore.

**Sign-in throttling.**
- Lineboard counts failed sign-ins per normalised email (trimmed and lower-cased). It counts them whether or not any account has that email, across every client, and stores the counts in PostgreSQL.
- A failure is a sign-in answered 401 `invalid_credentials`. Sign-ins refused with 403, 415, 422 or 429 are not counted.
- The window is the last `LINEBOARD_SIGNIN_WINDOW_SECONDS` seconds (900 by default).
- A sign-in that arrives while its email has 5 counted failures inside the window answers 429 `rate_limited`:
  - it does so without checking the password, even when the password is correct;
  - it is not counted;
  - its `Retry-After` header is the whole number of seconds, rounded up, until the oldest counted failure leaves the window.
- A successful sign-in clears that email's counted failures.
- A known email and an unknown one throttle identically: the same status, the same body keys and the same header.
- Attempts for one email are counted one at a time, in arrival order. Of any number of simultaneous wrong attempts for one email, at most 5 answer 401 and the rest answer 429.
- Sign-ins for other emails never affect an email's count.

**Kitchen time.**
- Every date, "today", month boundary, cutoff and label is computed in the kitchen's IANA time zone, never the server's or the browser's.
- A month is a kitchen-local calendar month.
- A booking belongs to the month in which its current block starts.

**Current block and charge.**
- A booking's current block, hours and charge are those set by its latest move, or by its confirmation if it was never moved.
- The cutoff, the late fee, cancellation credits, the board, the invoice month and the export all use the current block and charge.
- The original confirm-time values play no further part.

**End of the day (24:00).**
- Every hourly end time in a request (holds, moves, out-of-service windows and peak windows) may be `24:00`, meaning the end of that kitchen-local date. No other time with hour 24 is accepted, and 24:00 is never a valid start.
  - In a hold, move or out-of-service window, such a time answers 422 on that field (`start` or `end`) with the quarter-hour message.
  - In a peak-window save, such a time (including a window starting at 24:00) answers 422 under `errors.windows` with the peak-window message from Feedback states, and no window is saved.
- A start lies from 00:00 to 23:45; an end from 00:15 to 24:00.
- A block ending at 24:00 is stored with `localEnd` `"24:00"` and an `end` instant of 00:00 on the next date with that instant's offset.
- Blocks cover their start instant up to, but not including, their end instant. A block ending at 24:00 on one date therefore never overlaps a block starting at 00:00 on the next date.
- It bills wall-clock hours under Wall-clock time. For example, with the seed data at start, an Oven 2 block on Sunday 2026-11-01 from 20:00 to 24:00 has `end` `2026-11-02T00:00:00-05:00`, 4 off-peak hours and a charge of $150.00, its label is "Oven 2 2026-11-01 20:00–24:00", and a hold on Oven 2 from 00:00 to 01:00 on 2026-11-02 succeeds.

**Occupancy.**
- The occupying states are `held` (until the hold lapses), `confirmed`, `checked_in`, `completed` and `no_show`.
- On an hourly station, two occupying bookings never overlap in real time.
- A shelf station has a capacity: a whole number of slots. A kitchen-local day is full when the occupying bookings covering it equal the capacity. No day ever has more occupying bookings than the capacity.
- A shelf claim's time is free when every one of its days has a free slot. A move does not count the moving booking's own days. For example, a 3-day booking can shift by one day on its own shelf when only its own days were full.
- A hold or move whose time is not free answers 409 `block_taken`, with the `taken` list from API.

**Booking states.**
- The grace instant of a confirmed booking is `LINEBOARD_NO_SHOW_GRACE_SECONDS` seconds (1800 by default) after the later of two moments: its block's start instant and its confirmation instant.
- Actions on one booking are settled one at a time. Each action sees the result of the one before it, whoever sent it, and is judged against the state checks in the order the precedence rule sets.

| From | Action | To | Who and when |
|---|---|---|---|
| (none) | hold | held | member, on free time |
| held | confirm | confirmed | the holding member, before the hold lapses |
| held | lapse | expired | automatic, when the hold time is up |
| held | cancel | cancelled_free | the holding member (Discard) |
| held | out-of-service overlap | cancelled_free | automatic, when a window is saved over it |
| expired | confirm | expired (refused) | the holding member: always refused, with 409 `block_taken` when its time is no longer free and 409 `hold_expired` otherwise, never `invalid_transition` |
| confirmed | cancel | cancelled_free or cancelled_late | member (own) or operator, by the 48-hour cutoff |
| confirmed | release | cancelled_free | shift lead or operator, only while `conflict` is true |
| confirmed | move | confirmed | shift lead or operator |
| confirmed | check-in | checked_in | shift lead or operator, from 60 minutes before the block's start (that moment allowed) until the grace instant (that moment refused), and only while the member passes the check-in document rule |
| confirmed | no-show | no_show | shift lead or operator, from the block's start (that moment allowed) until the grace instant |
| confirmed | grace lapse | no_show | automatic, at the grace instant, except for blocks starting in a closed month |
| checked_in | check-out | completed | shift lead or operator, at any time |
| cancelled_late | waive | cancelled_late with `penaltyWaived` true | operator, once |

- Every other action on a booking answers 409 `invalid_transition`, with `from` set to its current status and `current` set to the booking. The only exception is the confirm of an expired hold in the table above. These count as illegal actions too:
  - check-in outside its window;
  - release of a booking that is not in conflict;
  - a second waive.

  For example, check-in on a block that starts 3 hours from now answers 409 with `"from":"confirmed"`. Check-in after an automatic no-show answers 409 with `"from":"no_show"`.
- **Check-in document rule.** At the check-in instant, the member must have a current document of every type the kitchen requires at that instant, and that document's expiry must not have ended in kitchen time.
  - If not, check-in answers 422 `validation_failed` with `errors.documents`. This is judged after `invalid_transition` under the precedence rule.
  - A check-in refused this way leaves the booking `confirmed` at its unchanged `version`.
  - The automatic no-show still applies at the booking's grace instant.
  - For example, with the seed data: the operator saves requirements with only the food-handler card, approves a food-handler card for Nadia Okoro, and Nadia books a block starting within the next hour. The operator then saves requirements with both types again. A shift lead's check-in answers 422 with "The insurance certificate expired on <date>; check-in is refused.", where `<date>` is the expiry date of Nadia's seeded certificate.
- Confirming a lapsed hold answers 409 `block_taken` if its time is no longer free, and 409 `hold_expired` otherwise. The booking stays `expired`.
- Every change increments the booking's `version` by one.

**Offered actions.** Every full booking in a response carries `actions`: the actions its caller may take on it at the response instant, after any lapse that is due has been applied, in this fixed order: `confirm`, `cancel`, `check_in`, `check_out`, `no_show`, `move`, `release`, `waive_penalty`.
- An action is listed exactly when the transition table above allows it for that caller's role and ownership, from that status, at that instant:
  - `confirm`: a `held` booking, for its own member;
  - `cancel`: a `held` or `confirmed` booking for its own member, and a `confirmed` booking for the operator;
  - `check_in`: a `confirmed` booking, for staff, from 60 minutes before its start until its grace instant (that instant excluded);
  - `check_out`: a `checked_in` booking, for staff;
  - `no_show`: a `confirmed` booking, for staff, from its start until its grace instant (that instant excluded);
  - `move`: a `confirmed` booking, for staff;
  - `release`: a `confirmed` booking with `conflict` true, for staff;
  - `waive_penalty`: a `cancelled_late` booking with `penaltyWaived` false, for the operator.
- When the booking's current block starts in a closed month, `actions` holds at most `waive_penalty`.
- `actions` ignores the checks that read other stored records and are judged only when the action is sent: free time, out-of-service overlap, hours and the document rules. So a check-in listed in `actions` may still answer 422 on `documents`.
- `expired`, `completed`, `no_show`, `cancelled_free`, and waived `cancelled_late` bookings carry `[]` for everyone.
- For example, for a shift lead: a confirmed block starting in 30 minutes carries `["check_in","move"]`; one that started 10 minutes ago carries `["check_in","no_show","move"]`; one starting in 3 hours carries `["move"]`; and after its grace instant it is `no_show` with `[]`.

**Automatic changes.** A hold lapse and a grace lapse take effect at their instant, whether or not a background sweep has run.
- Every request that reads or acts on a booking first applies any lapse that is due. It stores the new status and increments `version` once, so every read from that instant shows the new status.
- A background sweep every `LINEBOARD_SWEEP_SECONDS` seconds (300 by default) does the same for bookings that no request has touched.
- An automatic no-show sends no email, keeps the booking's charge and hours, and writes no ledger entry and no Kill Bill item.
- A confirmed booking whose block starts in a closed month never becomes a no-show automatically. It stays `confirmed`.

**Holds.**
- A hold occupies its time for `LINEBOARD_HOLD_TTL_SECONDS` seconds, 600 by default.
- A hold is valid when all of these are true:
  - its times fall on quarter hours on one kitchen-local date, under End of the day;
  - it lasts at least 1 hour and at most 12 hours (shelves: 1 to 31 days);
  - it has not already ended. A block that has started but not ended may be booked;
  - it starts no more than 180 days ahead;
  - its time is free;
  - it does not overlap an out-of-service window;
  - for hourly stations, the member has enough hours in each month, judged against the ledger alone;
  - the member meets the document rule.
- Holds do not touch the hour ledger, Kill Bill or email. Because holds use no hours, a member may hold several blocks that each fit the balance but together exceed it.
- The `chargeCents` in a hold response is a quote. Confirm prices the block again under Pricing. The confirmed charge is what the booking, Kill Bill, the board and the confirmation email carry.

**Released holds.** A hold ends unconfirmed in three ways: Discard (cancel on a held booking, giving `cancelled_free`), lapse (`expired`), or an out-of-service window saved over it (`cancelled_free`). In each case:
- Its time, or its shelf slot on each of its days, is free from that instant, for every claim that arrives afterwards. No sweep needs to run first. For example, with the seed data: Ada holds Oven 2 from 18:00 to 21:00 and discards it; a hold by Kofi on the same time a moment later answers 201. On Walk-in Shelf B, a slot freed by a discarded hold counts as free in the "<n> of <capacity> free" figure on the next board read.
- It is omitted from `GET /api/bookings` lists and the Bookings tables, from every other member's board and every staff board, from invoices, utilisation reports and the usage CSV. It wrote no ledger entry, Kill Bill item or email, and its release writes none.
- Only its owner still receives it: as an `expired` ticket on their own board for the rail, and from `GET /api/bookings/{id}`, which also answers staff, with `confirmedAt` null.
- Replaying the Idempotency-Key of the hold that created it returns the stored 201 body byte for byte. That replay never occupies the time again and never disturbs a newer claim on it. Replaying the Discard's key returns its stored 200 body.

**One winner.** Holds, confirms of lapsed holds and moves all compete under one rule. Among any mix of them that would break Occupancy on one station, the claims are settled one at a time, and each one wins only if its time is still free at its turn:
- On an hourly station, exactly one of a group of mutually overlapping claims succeeds.
- On a shelf station, claims succeed until a day is full. Every later claim covering that day answers 409 `block_taken`, whose `taken` list holds every day that is full at its turn.
- When two moves of the same booking carry the same `version`, exactly one gets 200. The other gets 412 `stale_version` with the current booking.
- When two moves of different bookings, or a move and a hold, target time that only one of them can have, exactly one succeeds. The other gets 409 `block_taken`.
- A weekly series racing single holds wins whole or not at all. Either every week of the series is held and the single holds it overlaps lose, or the series gets 409 `block_taken` and holds nothing.
- A losing request leaves no booking, ledger entry, Kill Bill item or email.

**Out-of-service windows.**
- Saving a window does three things:
  - it sets `conflict` true on every confirmed or checked-in booking that overlaps it;
  - it cancels overlapping holds as `cancelled_free`;
  - it stops new holds and moves from overlapping it.
- On shelves, a booking overlaps a window when the window's time falls on one of its days.
- Window saves and every hold, confirm of a hold and move on the same station are settled one at a time. Once all of them have answered:
  - no `held` booking overlaps any window;
  - every `confirmed` or `checked_in` booking that overlaps a window has `conflict` true;
  - a window's 201 `conflicts` lists exactly the confirmed and checked-in bookings that overlapped it at its turn;
  - a hold that answered 201 and overlaps the window was cancelled by it;
  - a move that answered 200 and overlaps the window appears in its `conflicts`;
  - a hold or move settled after the window answers 422 on `stationId`;
  - a confirm of a hold the window cancelled answers 409 `invalid_transition` with `"from":"cancelled_free"`.
- Deleting a window, or moving a booking clear of every window, sets `conflict` false.

**Weekly series.**
- A `repeatWeeks` value from 2 to 12 holds the same station, local start and local end on the same weekday for that many consecutive weeks.
- The series is all or nothing, judged in the order the precedence rule sets:
  1. If any week fails a rule that reads only the request and the clock, the answer is 422 and nothing is held.
  2. Otherwise, if any week is taken, the answer is 409 `block_taken` listing every taken week, and nothing is held.
  3. Otherwise, if any week overlaps an out-of-service window or fails the document or hour checks, the answer is 422 and nothing is held.
- The hour check runs separately for each kitchen-local month the weeks fall in. Each month's weeks are checked against that month's balance. If several months run short, the 422 on `hours` names the earliest one, with that month's need and balance. Confirm repeats the same check.
- For example, with the seed data: Rina, on 8 hours a month, holds a weekly 3-hour series of four weeks, with three weeks in one month and one in the next. The request is refused with "That needs 9 hours; you have 8 left for <Month YYYY>", naming the first month. A series split two and two succeeds, and confirming it lowers each month's balance by 6.
- Confirming any week of a series confirms every week still held, as one action. Each week then gets its own charge, ledger entry and email, filed in its own month.
- After confirmation, each week is its own booking. Cancelling, moving or releasing one week changes only that week, with its own credit, fee, ledger entry and email. Every other week keeps its status and `version`.

**Retries.**
- POST /api/bookings, and the confirm, cancel and waive-penalty actions, require an `Idempotency-Key` header.
- Keys are scoped to the signed-in person and kept for 24 hours. The same key used by a different person is an unrelated request.
- Two requests are the same when they have the same path and equal parsed JSON bodies. Key order and insignificant whitespace are ignored, and an empty body equals `{}`.
- A repeat of the same request with the same key returns the stored status and body byte for byte.
  - It makes no new hold, ledger entry, charge, credit, fee or email, even if the booking has changed or been cancelled since, and never occupies time again.
  - For example, replaying a late cancellation's key after the booking is `cancelled_late` returns the original 200 body unchanged.
- The same key with a different path, or a body that differs in any value, answers 409 `idempotency_key_reused`.
- A repeat that arrives while the first request is still running waits for it and returns its result. For example, five identical confirms sent at once with one key give five identical bodies, one ledger entry, one Kill Bill item and one email.
- A request refused before the key step (cross-origin, size, content type, malformed JSON or no session) never stores or consumes its key; the same key sent later runs as a fresh request.
- Cancels or waivers of one booking that carry different keys are separate actions, settled one at a time. An example is the member and the operator cancelling at the same moment.
  - Exactly one answers 200. Every other answers 409 `invalid_transition`, with `from` set to the winner's resulting status and `current` set to the booking.
  - The booking ends with:
    - exactly one `Late cancellation` charge, if the cancellation was late;
    - one `Cancelled` credit;
    - one ledger entry;
    - one cancellation email;
    - at most one waiver credit and one waiver email.

**Wall-clock time and clock changes.**
- Weekly series keep the same local start and end each week, whatever the UTC offset.
- Billed hours always equal local end minus local start, with 24:00 counting as hour 24, so a 05:00–09:00 block is 4 billed hours on every date.
- A requested start or end that does not exist locally, inside a spring-forward gap, is refused with 422 on that field. For example, a Northside hold starting at 02:30 on 2027-03-14 is refused on `start`.
- A repeated local time, inside a fall-back hour, means its first (earlier) occurrence.
- Overlap checks use real instants, but billing uses wall-clock hours. For example, with the seed data:
  - an Oven 1 block from 00:00 to 03:00 on Sunday 2026-11-01 bills 3 off-peak hours, $112.50;
  - a second hold from 01:00 to 02:00 on Oven 1 that night overlaps it in real time and answers 409 `block_taken`.

**Pricing.**
- A block uses the station's latest rate version whose effective instant is at or before the block's start instant. A shelf block starts at 00:00 kitchen time on its first day.
- A block that straddles an effective instant bills wholly at the version in force at its start.
- A block's quarter hours count as peak when they fall inside a peak window for that weekday, and as off-peak otherwise. Off-peak quarters are charged at the standard hourly rate (`offPeakHourlyCents`).
- The hourly charge is (peak quarters × peak hourly cents + off-peak quarters × standard hourly cents) ÷ 4, rounded once to whole cents, half away from zero.
- The shelf charge is days × the shelf-day cents of the version in force on the first day.
- The price is set at confirmation and changes only when the booking is moved. A move prices the new block at the rate version and peak windows that apply to it.
- For example, with the seed data at start:
  - a weekday Oven 2 block from 18:00 to 21:00 has 1 peak hour and costs $127.25;
  - a weekday Oven 2 block from 18:30 to 20:00 has 0.5 peak hours and costs $63.63, because 6,362.5 cents rounds half away from zero to 6,363;
  - a Monday Prep Station 1 block from 15:45 to 16:45 has 0.75 peak hours and costs $24.26;
  - a Saturday Oven 1 block from 12:00 to 14:00 has 1 peak hour and costs $89.75;
  - three days on Walk-in Shelf A cost $19.20.

**Rates and peak windows.**
- `effectiveFrom` is a kitchen-local wall time that resolves to one instant, `effectiveAt`:
  - A time inside a spring-forward gap is refused with 422 on `effectiveFrom`, using the "does not exist" message.
  - A repeated fall-back time means its first (earlier) occurrence. For example, `2026-11-01T01:30` at Northside resolves to an `effectiveAt` with offset `-04:00`.
- `effectiveAt` must be after the present moment. Otherwise the request gets 422 on `effectiveFrom`.
- Rates are 1 to 100,000 cents, both ends allowed.
- Rate versions are append-only. No version is ever edited or deleted.
  - A second version for the same station with the same `effectiveAt` answers 409 `rate_version_exists`.
  - When several such versions arrive at once, exactly one answers 201 and the rest answer 409, so the station gains exactly one version.
- **Rate version status.** At each request, the server decides every version's `status` from its own clock:
  - `current` for the station's latest version whose `effectiveAt` is at or before that moment;
  - `past` for every earlier version;
  - `scheduled` for every version whose `effectiveAt` is after that moment.

  Each station has exactly one `current` version, and its `currentRate` is that version. For example, with the seed data at start, every station's single version, effective from 2026-01-01 00:00, is `current`.
- `currentRate` and `status` are worked out at each request from the stored versions. They switch exactly at `effectiveAt`, with no restart and no cache that outlives a request.
- A block that starts before a version's effective instant always bills at the earlier version, even when it is held or confirmed after the change is saved.
- A hold quoted before a change is saved and confirmed afterwards is charged at the version in force for its block at confirm. When the change takes effect at or before the block's start, that is the new version.
- Peak-window and document-requirement saves carry the kitchen's `rulesVersion`.
  - A save whose `rulesVersion` is not the current one answers 412 `stale_version` with the current kitchen, and changes nothing.
  - Of several saves carrying the same current `rulesVersion`, exactly one succeeds and the rest answer 412.
  - Rate versions do not change `rulesVersion`.
- A peak window needs at least one day and a start before its end on the quarter hour, under End of the day; any invalid window answers 422 under `windows`.
- Saved peak windows apply to every booking confirmed or moved from then on. Confirmed prices do not change. A held booking keeps showing its quote until it is confirmed.
- For example, with the seed data at start: Ada holds a Monday Oven 2 block from 15:00 to 17:00, quoted with 1 peak hour at $89.75. The operator then saves peak windows of Monday to Friday 15:00 to 19:00. When Ada confirms, the response, the Kill Bill `Booking` item, the confirmation email and Block details all carry 2 peak hours and $104.50.
- Required-document changes apply to holds, confirms and check-ins from then on.

**Hour ledger and its Kill Bill pairs.** Each member has a plan allowance of hours per month, for hourly stations only. The hour ledger and Kill Bill move together.
- Every ledger entry has exactly one matching Kill Bill item. Both are written in the same database transaction (the Kill Bill item through the outbox) and filed in the same kitchen-local month:
  - **Confirm:** plus the booking's hours, and a `Booking` charge for its charge, both in the block's month.
  - **Move:** first, minus the old hours and a `Moved` credit for the old charge, both in the old block's month. Then plus the new hours and a `Booking` charge for the new charge, both in the new block's month.
  - **Cancel (free or late) of a confirmed booking, or release:** minus the current hours and a `Cancelled` credit for the current charge, both in the month where the current block starts.
- Shelf bookings write the same entries with 0 hours.
- Some items carry no hours and write no ledger entry:
  - a late fee, which is a `Late cancellation` charge in the current block's month, written just before that booking's `Cancelled` credit;
  - a waiver credit, filed as set out under Closed months;
  - check-in, check-out and no-shows, manual or automatic, which write nothing at all.
- Holds that end unconfirmed write nothing, as set out under Released holds.
- Entries are never edited or deleted. Every correction is a new, opposite entry.
- A month's balance is the allowance minus the sum of that month's ledger. It is computed on the server. The board, the invoice, the hour-bank endpoint and the export all use this one figure.
- **One at a time per member and month.** Confirms and moves that change one member's hours in one kitchen-local month are settled one at a time, in arrival order, whatever station they are on.
  - Each one checks the balance as it stands at its turn.
  - The hour check is the last state check, so a request refused earlier never reaches it. Earlier refusals include a stale version, a closed month, an illegal action and time that is not free.
- **Several months in one request.** A request that changes one member's hours in several months takes its turn on those months in ascending month order. Such requests include a move between months, a series confirm across a month boundary, and a cancel of a moved block.
  - Database deadlocks and serialisation failures are retried inside the request, so no request answers 5xx because of contention.
  - Under 20 concurrent contending requests, every request answers within 10 seconds with its published status.
- **Never below zero.** A confirm or move that would take any month's balance below zero answers 422 on `hours`, with that month's balance at its turn.
  - It writes no ledger entry, Kill Bill item or email, and a refused confirm leaves its booking `held`.
  - A move checks the target month as if the old block's hours had already been returned.
  - No month's balance is ever below zero on any surface.
  - For example, with the seed data: Kofi, on 20 hours, holds six 4-hour blocks next month on different stations and confirms all six at once with six keys. Exactly five succeed. The sixth answers 422 with "That needs 4 hours; you have 0 left for <Month YYYY>" and stays held. The month then shows 20 used and 0 left on the board, the invoice and the export, with five `Booking` charges and five confirmation emails.
- **Invoice totals.** For each member and month:
  - the invoice `totalCents` equals the sum of:
    - the current charges of that member's bookings in `confirmed`, `checked_in`, `completed` or `no_show` whose current block starts that month;
    - plus the unwaived late fees of their late-cancelled bookings whose current block starts that month (for a closed month, as at close);
    - minus the adjustment credits filed in that month;
  - `usedHours` equals the hours of those hourly bookings.
- **Worked example.** A block is confirmed in one month, moved into a different month (earlier or later), then cancelled late:
  - the original month holds `Booking` and `Moved` lines, nets to $0.00 and has its hours returned;
  - the new month holds `Booking` (at the moved block's rate), `Late cancellation` (half that charge) and `Cancelled` (that charge). It totals exactly the fee and shows 0 used hours;
  - after a waiver while that month is open, the new month totals $0.00.

**Cancellations and fees.**
- The cutoff is 48 hours before the current block's start instant. For a shelf booking, it is 48 hours before 00:00 kitchen time on its current first day.
- A cancellation at or before the cutoff is `cancelled_free`. A cancellation after the cutoff is `cancelled_late`.
- The late fee is half the current charge, rounded to whole cents, half away from zero. For example, with the seed data, the $127.25 block above carries a $63.63 fee.
- A waiver credits the fee once.

**Closed months.**
- **Waiving a fee in an open month.** The waiver files a `Waived late cancellation` credit in that month.
- **Waiving a fee in a closed month** (the fee's month is the month of its current block):
  - The waiver answers 200 and sets `penaltyWaived` true.
  - It files one `Adjustment: waived late cancellation` credit for the fee in the adjustment month: the earliest open kitchen-local month at or after the kitchen-local current month. The credit appears as an invoice line of kind `credit` carrying the booking's id. Its filing date is the kitchen-local date on which the waiver answered 200.
  - It writes no ledger entry and no hours.
  - `creditMonth` in the response, the waiver email and the statement all follow the month where the credit is filed.
- **Utilisation totals.** `totals.adjustmentCents` is the sum (zero or negative) of the adjustment credits filed in the month. The sum of the kitchen's member invoice totals for a month equals `totals.revenueCents + totals.adjustmentCents`.
- **Frozen figures.** Once a month is closed, these stay byte-identical to the responses at the moment of close, whatever happens later (renames, post-close waivers, rate versions, peak-window or requirement saves, and any request to an unlisted path):
  - its invoice responses;
  - its utilisation report;
  - its usage CSV.

  The CSV's penalty column keeps the fee as it stood at close. An adjustment filed after the close appears only in its own adjustment month.
- **No reopening.** A closed month is never reopened, and its committed Kill Bill invoices are never changed, by any request.
- **Close and waiver ordering.** A post-close waiver whose adjustment month is being closed waits for that close and then files in the earliest month still open.

**Moves.**
- A move must carry the booking's current `version`. Otherwise it gets 412 `stale_version` with the current booking.
- A move must target a station of the same kind as the booking. Otherwise it answers 422 with `stationId` as the only key in `errors`, using the wrong-kind message from Feedback states, whatever else the body holds.
- A move applies every hold validation except the document rule, re-prices the booking and sends the moved email.
- A move whose old or new block starts in a closed month answers 409 `month_closed`.
- When a move fails several checks at once, the precedence rule's state-check order decides which answer it gets.

**Documents.**
- **Uploads, approval and superseding.**
  - A new upload is `submitted`, at version 1.
  - When a member uploads a document, every older `submitted` document of the same type they have becomes `superseded`, at version 2. Approved documents are never superseded.
  - Uploads and approvals of one member's documents of one type are settled one at a time. Two uploads of one type by one member at the same moment both answer 201 with distinct ids and objects; afterwards the one written second is `submitted` and the other is `superseded` at version 2. At no moment does a member have two `submitted` documents of one type.
  - Approval requires the document's current `version`:
    - a superseded document answers 409 `document_superseded`;
    - a stale version answers 412 `stale_version` with the current document;
    - any other document that is not `submitted` answers 409 `invalid_transition`;
    - of concurrent approvals of one document carrying its current version, exactly one answers 200.
- **Expiry status.** "Days remaining" is the expiry date minus the kitchen-local today. An approved document's status is:
  - `approved` while more than 14 days remain;
  - `expiring` from 14 days remaining down to 0;
  - `expired` below 0, that is after the end of its expiry date. For example, with the seed data, Nadia Okoro's seeded insurance certificate is `expired` from first start.
- **Current document.**
  - For each type, a member's current document is the approved one (in `approved`, `expiring` or `expired` status) with the latest expiry date. Its `current` is true, and every other document of that type has `current` false.
  - A newer `submitted` upload never removes an approved current document.
  - A superseded document never counts.
- **Booking against expiry.** A document expires at 24:00 kitchen time at the end of its expiry date. A hold or confirm is refused with 422 on `documents` when a required type has no current document, or when the block ends after that document's expiry:
  - an hourly block ending at or before 24:00 on the expiry date is allowed;
  - a shelf booking whose last day is the expiry date is allowed, and one a day longer is refused;
  - a weekly series is refused whole, with nothing held, when any of its weeks ends after the expiry.
- **Expiry notices.** Notices go only for current documents.
  - The 14-day notice goes when a current document has 4 to 14 days remaining. The 3-day notice goes when it has 0 to 3 days remaining.
  - Each notice is sent at most once per document, across every start of the app. A document that becomes current with 3 or fewer days remaining gets only the 3-day notice. A document whose expiry has already ended gets no notice.
  - An approved document that is not current never triggers a notice. A document that stops being current gets no further notices.
  - Lineboard checks at approval, at start and on every sweep.
  - For example, with the seed data:
    - Nadia Okoro starts with no food-handler card. If the operator approves food-handler cards for her expiring, in this order, 3, 4, 14, 15 and 0 days after the kitchen-local today, each of the first four becomes current as it is approved; they bring one 3-day notice, one 14-day notice, one 14-day notice and no notice respectively, and the 15-day card shows `approved`. The 0-day card is never current and brings no notice.
    - If Nadia uploads an insurance certificate expiring 2 days after today and it is approved, its expiry is later than her seeded certificate's, so it becomes current and gets only the 3-day notice.
    - If the operator approves one card of Rina's expiring in 60 days and then another expiring in 2 days, the 60-day card stays current. No notice is sent for either card, and Rina's booking limit follows the 60-day card.

**Text fields.**
- Text is normalised to Unicode NFC when it is saved. Limits count the Unicode code points of the normalised text.
- The NFC text is stored, and every surface carries it byte for byte: API, board, picker, export, PDF and email. Nothing is trimmed.
- Limits, both ends allowed:
  - business name: 1 to 80;
  - booking notes and sanitation notes: 0 to 500;
  - out-of-service reason: 1 to 120;
  - sanitation task: 1 to 120.
- A business name refuses:
  - every control character, U+0000 to U+001F and U+007F to U+009F. This includes carriage return, line feed, tab and U+0085;
  - the line separator U+2028;
  - the paragraph separator U+2029.
- Notes, reasons and tasks have no character restriction beyond their limits.
- For example:
  - a business name of 80 bread emoji "🍞" is accepted, and 81 is refused;
  - "Cafe" followed by a combining acute accent is stored and shown as "Café";
  - a name of 80 decomposed "é" (160 code points before normalisation) is accepted and stored as 80 code points;
  - "Bello\u2028Bcc: x@evil.example" is refused.

**Business name.**
- A business name is stored and shown exactly as saved under Text fields, including a leading `=`, `+`, `-` or `@`. Only the CSV neutralises it.
- A saved name takes effect at once everywhere the member's business name appears live:
  - the board labels;
  - member records in the picker and lookups;
  - booking and document objects;
  - export rows of open months;
  - every email sent from then on.
- The member's Kill Bill account name follows it, as set out in Services.
- Closing a month stores each kitchen member's business name in force at that close. The usage CSV of a closed month uses the stored names. Statements already sent are not changed.

**Invoices and month close.**
- **Invoice lines.** A member's invoice for a month has one line per Kill Bill item for that member and month:
  - a `booking` line for each charge;
  - a `penalty` line for each late fee;
  - a `credit` line (negative) for each `Cancelled`, `Moved`, `Waived late cancellation` and `Adjustment` credit.

  Lines use the descriptions from Services and are ordered by when they were made. Each line's `billingStatus` is `billed` once Kill Bill has recorded its item, and `pending_billing` until then. `totalCents` is the lines' exact sum. The invoice includes the member's hour bank for that month.
- **Refused closes.** Closing a month is refused in these cases, checked in this order:
  1. 409 `month_closed` when the month is already closed;
  2. 409 `billing_pending` while any Kill Bill item for the month is unrecorded, including one written by a confirm that finished just before the close;
  3. 503 `billing_unavailable` while Kill Bill is unreachable;
  4. 409 `billing_mismatch` when any member's Kill Bill amount for the month, read back as below, differs from Lineboard's `totalCents`.
- **Reading Kill Bill back.** Before its first commit, a close reads Kill Bill's invoice for the month for every member of the kitchen and compares its Kill Bill amount (defined in Services) with that member's `totalCents`.
  - A draft is read at its current amount. An invoice already committed by an earlier partial close is read at its committed amount.
  - A member with no lines counts as a total of $0.00, and a member with no invoice for the month counts as a Kill Bill amount of $0.00.
  - A difference in either direction, of any size, for any member, is a mismatch. `members` lists every member who differs, in ascending member-id order.
  - On a mismatch, the close commits nothing for any member, queues no statement, stores no frozen figures and leaves the month open. No comparison happens between commits, so a refused close never leaves some members committed by that close.
  - A later close passes once the amounts agree, for example after a reversing credit is added in Kill Bill.
- **A successful close:**
  1. reads every member's Kill Bill invoice back as above;
  2. commits every member's draft invoice for that month, each exactly once. An invoice committed by an earlier partial close is never committed again;
  3. then, in one database transaction:
     - marks the month closed;
     - stores the business names and the frozen invoice, report and CSV figures;
     - queues one statement email for each member of the kitchen who has at least one invoice line that month, including members whose total is $0.00. Members with no lines get nothing.
- **Partial failure.** If Kill Bill fails partway through the commits, the month stays open, the response is 503 `billing_unavailable`, and no statement is queued. A later close reads back again and commits the rest.
- **Concurrent closes.** Closes of one month are settled one at a time. A close that arrives while another is running waits for it. It then answers 409 `month_closed` if the first succeeded, or runs itself if the first failed. Exactly one close of a month ever answers 200.
- **Closes and other actions.** A close never interleaves with any action touching that month: a hold, confirm, cancellation, move (out of or into the month), release, check-in, check-out, no-show or waiver, including a waiver whose adjustment would land in that month. Each such action either:
  - completes before the close begins, so its lines are on the committed invoices and the statements; or
  - runs after it and answers 409 `month_closed` with nothing written. A waiver instead files its adjustment as set out under Closed months.
- A refused or repeated close queues no email and changes nothing.
- Closing is meant for after month end, but Lineboard does not forbid closing early.

**Utilisation and export.**
- **Counted bookings** are those in `confirmed`, `checked_in`, `completed` or `no_show` whose current block starts in the month.
- **Per station:**
  - `bookedHours`, `peakHours` and `shelfDays` sum the counted bookings;
  - `revenueCents` sums their charges, plus the unwaived late fees of late-cancelled bookings whose current block is on that station in that month.
- `totals` sums the stations and adds `adjustmentCents`.
- **The usage CSV:**
  - UTF-8 with CRLF line endings and standard double-quote escaping.
  - Header row: `booking_id,member_id,business_name,station,date,start,end,hours,peak_hours,shelf_days,status,charge,penalty,billing_status,hour_bank_balance,notes`.
  - **Booking rows:** one row per booking whose current block starts in the month and that ever reached `confirmed`, ordered by start.
    - `date` is the current block's kitchen-local date (its first day for shelves).
    - `start` and `end` are the local times, with an end of the day written `24:00`; both are empty for shelf bookings.
    - `status` is the booking's status.
    - `charge` is the current charge for counted bookings, and 0.00 for cancelled ones.
    - `penalty` is the unwaived late fee, or 0.00.
    - `billing_status` is the booking's `billingStatus`.
    - `notes` is the booking's notes.
  - **Adjustment rows:** after the booking rows, one row per adjustment credit filed in the month, in filing order:
    - `booking_id` is the waived booking, and `member_id` its member;
    - `station` is the booking's station;
    - `date` is the kitchen-local filing date of the credit;
    - `start`, `end` and `notes` are empty;
    - `hours`, `peak_hours` and `shelf_days` are `0`;
    - `status` is `adjustment`;
    - `charge` is the credit as a negative dollar amount, for example `-63.63`, and `penalty` is `0.00`;
    - `billing_status` is `billed` once Kill Bill has recorded the credit, and `pending_billing` until then.
  - In every row, `business_name` is the current name for an open month and the stored close-time name for a closed month, and `hour_bank_balance` is the member's balance for that month.
  - Money cells are dollars with two decimals and no symbol or thousands separator.
  - `charge` plus `penalty` over all rows equals `totals.revenueCents + totals.adjustmentCents`, which equals the sum of the kitchen's member invoice totals for that month.
  - **Numeric cells.** `hours`, `peak_hours`, `shelf_days`, `charge`, `penalty` and `hour_bank_balance` are written as plain numbers matching `^-?\d+(\.\d+)?$`, never quoted or prefixed.
  - **Text cells.** Every other cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return is written with a single apostrophe in front, so a spreadsheet shows it as text. For example, a business name `-Bello` is written `'-Bello` in the same row as a charge of `-63.63`.

**Sanitation.**
- Sanitation entries are stamped with the server time and shown in kitchen time. They cannot be edited or deleted.
- The areas are "Prep stations", "Ovens and ranges", "Walk-in cooler", "Dish area" and "Floors and drains".
- Initials are 1 to 4 letters.
- A monthly PDF is rendered at the moment it is stored, and lists every entry of its kitchen-local month logged up to that moment, with its date, time, area, task, sanitizer strength, initials, notes and logger, as selectable text.
- A PDF queued during a storage outage is rendered when the queue stores it, so it includes entries logged while it waited.

**Inspector links.**
- A link's expiry must be in the future and at most 30 days away.
- A token is at least 32 random URL-safe characters.
- A link's status is decided by the server clock at each request: it answers 410 `link_expired` from its expiry instant onwards. It answers 410 `link_revoked` once it is revoked, and its old token answers 410 `link_revoked` once it is regenerated. A link that is both revoked and expired answers `link_revoked`. The browser's clock and zone never decide a link's status or its labels.
- Regenerating keeps the link's id, expiry and access history, and issues a new token. Revoking keeps the access history.
- Regenerations of one link are settled one at a time. Each answers 200 with its own new token and sends one invitation. Afterwards, only the token from the last regeneration to complete opens the link. Every other token answers 410 `link_revoked`.
- A token opens only the inspector endpoints of its own kitchen:
  - sanitation entries from the last 90 kitchen-local days;
  - stored monthly PDFs;
  - the member certificates current at the moment of each request: each member's current document of each type, in `approved`, `expiring` or `expired` status.
- Certificates are judged afresh at every request, never fixed when the link is made. A document that has stopped being current since the link was created is no longer listed, and its inspector download answers 404 with no access record; the newly current document is listed on the next view. Submitted, superseded and never-approved documents are never listed, and their inspector downloads answer 404. For example, with the seed data: after the operator approves a card of Rina's expiring later than her seeded 40-day card, the seeded card disappears from the inspector's list and its inspector download answers 404.
- A document or month from elsewhere answers 404.
- A token is never a session. Other endpoints treat its holder as unauthenticated.

**Inspector access records.**
- Every inspector request that answers 200 adds exactly one access record to its link, stamped with the server time and shown with the kitchen's offset:
  - `GET /api/inspect/{token}` adds a `view` record with `target` null;
  - a certificate download adds a `document` record whose `target` is the document id;
  - a sanitation PDF download adds a `report` record whose `target` is the month.
- Requests that answer 403, 404, 405, 410 or 503 add no record.
- Concurrent requests each add exactly one record. `views`, `downloads` and `lastAccessAt` always equal the values recomputed from the link's records.
- No request can change or remove an access record.
- Only the operator of the link's kitchen sees the records.

### Services (DP-07, DP-11, DP-20, DP-21, DP-32, DP-36, DP-39, DP-46, DP-47, DP-50, DP-51, DP-52, DP-53, DP-61, DP-63, DP-70, DP-71, DP-79, DP-82, DP-83, DP-86)

**PostgreSQL** (`DATABASE_URL`) is the system of record. It holds:
- kitchens, people, sessions and sign-in failure counts;
- the first-start date of the install;
- stations with their shelf capacities, rate versions, peak windows and the kitchen rules version;
- bookings, the hour ledger and idempotency records;
- documents with their versions, sanitation entries and reports;
- inspector links and inspector access records;
- close-time business names and frozen closed-month figures;
- the record of expiry notices already sent;
- the outbox of pending Kill Bill, mail and storage work.

These are all settled here:
- the one-winner and shelf-capacity rules, including the instant a released hold frees its time;
- out-of-service turns per station;
- the per-member-month hour turns, taken in ascending month order;
- the per-booking action order;
- document upload and approval order per member and type;
- concurrent rate versions and kitchen-rule saves;
- the month-close order;
- inspector access counts;
- sign-in counts.

The schema is applied idempotently every time the server starts.

**Kill Bill.**
- **Accounts.** Each member is a Kill Bill account with `externalKey` equal to the member id, `name` equal to the member's current business name, and currency USD. Lineboard creates any missing accounts at start.
- **Account names.** Every saved business name is sent to the member's Kill Bill account name through the outbox.
  - Kill Bill stores only characters of the Basic Multilingual Plane, so each character above U+FFFF (an emoji, for example) is sent as U+FFFD (�). Every other character is sent unchanged.
  - These updates are delivered in the order they were saved, so the account ends with the last saved name.
  - They are retried like other outbox work, and complete within 30 seconds of billing being reachable.
- **Items.** Each charge or credit goes on that member's single draft (uncommitted) invoice for the month set out in Business rules. Amounts are in dollars with two decimals. The descriptions are:
  - `Booking <booking id> <block label>`: an external charge for the booking's charge, on confirm and on the new side of a move, using that block's label;
  - `Moved <booking id>`: a credit for the old charge, on the old side of a move;
  - `Late cancellation <booking id>`: an external charge for the fee;
  - `Cancelled <booking id>`: a credit for the current charge, on any cancellation of a confirmed booking or release;
  - `Waived late cancellation <booking id>`: a credit for the fee, in the fee's open month;
  - `Adjustment: waived late cancellation <booking id> (<Month YYYY>)`: a credit for the fee, on the adjustment month's draft invoice, where `<Month YYYY>` is the fee's closed month.
- **Kill Bill amount.** An invoice's Kill Bill amount is the sum of the amounts of all its items except `CBA_ADJ` items. So external charges count as positive, `CREDIT_ADJ` credits count as negative, and any item added in Kill Bill by someone else counts too. Kill Bill's own `balance` field is never used: it reads zero while an invoice is a draft.
- A booking counts as `billed`, and an invoice line as Billed, only once Kill Bill has recorded all its items.
- **Month close** reads every member's invoice back and then commits each draft invoice for the month once, as set out in Business rules. The committed invoice's Kill Bill amount equals Lineboard's `totalCents`. A committed invoice is never changed afterwards by any route.

**Mail** (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`).
- Every message's From header is exactly the value of `MAIL_FROM`, which the environment sets to `Lineboard <no-reply@lineboard.example>`.
- Every message has exactly one To address and no Cc or Bcc. It contains only that recipient's own data, and uses the business name in force when it is sent.
- Bodies are UTF-8 plain text.
- A subject containing any non-ASCII character is RFC 2047-encoded in UTF-8, so that it decodes to exactly the published subject text. Quotes, angle brackets and a leading `=` from a business name appear literally in the decoded subject.
- A business name reaches a header only through the statement subject.

The messages:
- **Confirm:** one per booking, so one per week of a series, to the member. Subject `Booking confirmed: <block label>`. The body carries:
  - `<business>`, the block label and the booking id;
  - "Charge: $<amount> for your <Month YYYY> statement", with the confirmed charge;
  - for hourly blocks, "<hours> hours left in <Month YYYY>".
- **Cancellation or release** of a confirmed booking: to the member. Subject `Booking cancelled: <block label>`. The body carries "Late cancellation fee: $<amount>" or "No cancellation fee". A hold that ends unconfirmed sends nothing.
- **Fee waived:** to the member. Subject `Late cancellation fee waived: <block label>`. The body reads "Credit $<amount> on your <Month YYYY> statement", naming the month where the credit is filed.
- **Move:** to the member. Subject `Booking moved: <new block label>`. The body has the old and new labels and the new charge.
- **Expiry notices:** to the member. Subjects `14-day notice: your <document type> expires on <date>` and `3-day notice: your <document type> expires on <date>`.
- **Inspector invitation:** on create and on regenerate, to the inspector. Subject `Read-only kitchen records: <kitchen name>`. The body has the absolute link URL and the expiry in kitchen time.
- **Statement:** on month close, to each member with lines that month. Subject `Statement for <Month YYYY>: <business>`, using the close-time name. The body is exactly these lines joined by CRLF, with nothing before or after:
  1. `Statement for <Month YYYY>`
  2. `<business>`, the close-time name
  3. an empty line
  4. one `<description> $<amount>` line per invoice line, in invoice order, using the line's description; credits, adjustments included, are written with `-$`
  5. an empty line
  6. `Total $<amount>`, which equals the committed Kill Bill amount (`-$` when negative)

  It names no other member, booking or amount, and carries no greeting, footer or kitchen totals. A member whose lines total $0.00 receives one, ending `Total $0.00`.
- Automatic no-shows send no email.

**Commit rules.**
- A change to a booking, its ledger entries, its Kill Bill items and its email are written in the same database transaction; the items and the email go to the outbox. Either all of them commit or none do.
- A month close's statements are written to the outbox in the transaction that marks the month closed.
- Delivery is retried until it succeeds, and each item is delivered exactly once.
- Confirm waits up to 5 seconds for Kill Bill before answering 202.

**Object storage** (`S3_*`).
- The bucket is private. Objects are stored at:
  - `kitchens/<kitchenId>/members/<memberId>/documents/<documentId>` for certificates and cards, seed documents included;
  - `kitchens/<kitchenId>/sanitation/<YYYY-MM>.pdf` for monthly sanitation PDFs, rendered as set out in Business rules › Sanitation. Saving a month again replaces its PDF.
- The browser never gets direct storage URLs. The server streams every file.
- A document's record and its object exist together or not at all:
  - Every check on an upload finishes before anything is written to storage: session, role, request and file size, file type, the published parts, `type` and `expiryDate`. A refused upload writes no object.
  - The stored object's bytes are identical to the uploaded file part, and its content type is the detected type.
  - If storing the object fails, no record is saved. If saving the record fails, the object is deleted.
  - Outside a request that is still running, the objects under a member's `kitchens/<kitchenId>/members/<memberId>/documents/` prefix are exactly that member's document ids, one object each.
  - Two uploads by one member at the same moment both succeed, with distinct ids and objects.
  - The only exception is seed documents whose objects are still waiting after a first start with storage unreachable, as set out in Seed data.

**When a service is down.** Every refusal below carries exactly its published copy, and nothing in it or in `GET /api/service-status` reveals the provider, under Server boundary › Opaque errors.
- **Kill Bill unreachable:**
  - Confirms answer 202 with `pending_billing` and queue their items.
  - Cancellations, moves, releases and waivers succeed and queue their items.
  - Business-name changes succeed, and their account-name updates wait in the outbox.
  - Invoices show those lines as `pending_billing`.
  - Month close answers 503 `billing_unavailable`.
  - Booking emails still go out.
  - The banner shows the billing copy from Feedback states.
- **Storage unreachable:**
  - Uploads answer 503 `storage_unavailable` and save no record and no object.
  - Document and PDF downloads answer 503 `storage_unavailable`, inspector downloads included.
  - Approvals, holds, confirms and check-ins still work.
  - Sanitation PDF requests answer 202 and are queued.
  - The banner shows the storage copy.

**Queued counts.** These are the numbers in `queued` from `GET /api/service-status` and on the banner's waiting line.
- `queued.billing` is the number of Kill Bill charge and credit items (the six kinds listed under Kill Bill) not yet recorded, across the kitchen. While Kill Bill is down:
  - confirming one booking adds 1, and confirming a series adds 1 per week;
  - a free cancellation of a confirmed booking, or a release, adds 1;
  - a late cancellation adds 2;
  - a move adds 2;
  - a waiver adds 1, whether it is a waiver credit or an adjustment;
  - a replayed or refused request, and a hold that ends unconfirmed, add nothing.
- `queued.storage` is the number of months whose sanitation PDF is queued and not yet stored, across the kitchen. Requesting a month that is already queued does not add another.
- Seed document objects, Kill Bill account creation, account-name updates and emails are never counted.
- On a fresh outage instance, both counts are 0 until someone does one of the actions above. Each count returns to 0 once its queued work completes.
- The counts include an action's items as soon as that action has answered.

**Recovery.**
- Lineboard starts, answers health and serves every other feature while Kill Bill or storage is unreachable.
- A service counts as returned when its configured address starts answering. Lineboard retries that same configured address every time and never treats a failed connection as permanent, so it recovers without a restart or a configuration change.
- In grading, an outage instance starts with the service address pointed at a local port where nothing listens. Recovery is exercised by making that port forward to the real service while the instance keeps running. The harness creates each instance's own database and bucket, empty, before that instance starts, so no two instances share records or stored objects and Lineboard does not need to create either one.
- Queued work is retried at least every 10 seconds. Within 30 seconds of the service returning:
  - all queued work completes, in the order it was queued for each member;
  - `GET /api/service-status` reports `up`;
  - pending bookings and invoice lines become `billed`;
  - each member's Kill Bill draft invoice for each month has a Kill Bill amount equal to Lineboard's `totalCents` for that month.
- An open invoice already on screen shows those lines as Billed at its next refresh, without being reloaded.
- Seed document objects and Kill Bill accounts that could not be created at start are created the same way, without appearing in the queued counts.

### Seed data (DP-01, DP-02, DP-09, DP-10, DP-35, DP-78, DP-82)

Every seeded person, kitchen and business is invented. The seed is applied idempotently at start: a later start never adds, re-dates or rewrites a seeded record or object. The app ships with exactly this seed and nothing else: no demo bookings and no test records.

Every seeded person's password is `lineboard-demo`.

**Kitchens:**

| Kitchen id | Name | Slug | Time zone | Peak windows | Required documents | Rules version |
|---|---|---|---|---|---|---|
| `kit_northside` | Northside Commissary | northside | America/New_York | Mon–Fri 16:00–19:00; Sat–Sun 08:00–13:00 | insurance certificate, food-handler card | 1 |
| `kit_harbor` | Harbor Street Kitchen | harbor-street | America/Chicago | Mon–Fri 15:00–18:00 | insurance certificate, food-handler card | 1 |

**People:**

| Email | Name | Role | Kitchen | Member id | Business | Plan hours per month |
|---|---|---|---|---|---|---|
| ops@northside.example | Marisol Vega | operator | kit_northside | | | |
| lead@northside.example | Theo Lindqvist | shift_lead | kit_northside | | | |
| ada@bellobakes.example | Ada Bello | member | kit_northside | mem_ada | Bello Bakes | 40 |
| kofi@smokestack.example | Kofi Mensah | member | kit_northside | mem_kofi | Smokestack Truck | 20 |
| rina@satopickle.example | Rina Sato | member | kit_northside | mem_rina | Sato Pickle Co. | 8 |
| nadia@okorospice.example | Nadia Okoro | member | kit_northside | mem_nadia | Okoro Spice Kitchen | 12 |
| ops@harbor.example | Jonah Pierce | operator | kit_harbor | | | |
| lead@harbor.example | Lena Cho | shift_lead | kit_harbor | | | |
| omar@haddadhummus.example | Omar Haddad | member | kit_harbor | mem_omar | Haddad Hummus | 30 |

**Stations:**

| Station id | Kitchen | Name | Kind | Capacity | Standard per hour | Peak per hour | Per shelf-day |
|---|---|---|---|---|---|---|---|
| stn_prep1 | kit_northside | Prep Station 1 | hourly | | $18.75 | $26.10 | |
| stn_prep2 | kit_northside | Prep Station 2 | hourly | | $18.75 | $26.10 | |
| stn_oven1 | kit_northside | Oven 1 | hourly | | $37.50 | $52.25 | |
| stn_oven2 | kit_northside | Oven 2 | hourly | | $37.50 | $52.25 | |
| stn_shelfA | kit_northside | Walk-in Shelf A | shelf | 3 | | | $6.40 |
| stn_shelfB | kit_northside | Walk-in Shelf B | shelf | 2 | | | $6.40 |
| stn_line1 | kit_harbor | Line 1 | hourly | | $22.00 | $30.00 | |
| stn_ovenA | kit_harbor | Oven A | hourly | | $40.00 | $55.00 | |
| stn_shelf1 | kit_harbor | Walk-in Shelf 1 | shelf | 4 | | | $5.00 |

Every rate takes effect from 2026-01-01 00:00 kitchen time, so each station starts with exactly one rate version, `current`. Lanes appear in the order listed.

**First-start date.** On the first start against an empty database, Lineboard stores in PostgreSQL the kitchen-local date of that start for each kitchen, and the instant of that start. Seed expiry dates are counted from this stored date and are never recomputed on a later start.

**Documents.** There are exactly 9 seed documents: 7 at Northside and 2 at Harbor Street. In this order (which is also their listing order, since they share one upload instant):

| Member | Type | File name | Expiry date | Status at first start |
|---|---|---|---|---|
| Ada Bello | insurance certificate | seed-insurance-certificate.pdf | first-start date + 365 days | approved |
| Ada Bello | food-handler card | seed-food-handler-card.pdf | first-start date + 365 days | approved |
| Kofi Mensah | insurance certificate | seed-insurance-certificate.pdf | first-start date + 365 days | approved |
| Kofi Mensah | food-handler card | seed-food-handler-card.pdf | first-start date + 365 days | approved |
| Rina Sato | insurance certificate | seed-insurance-certificate.pdf | first-start date + 365 days | approved |
| Rina Sato | food-handler card | seed-food-handler-card.pdf | first-start date + 40 days | approved |
| Nadia Okoro | insurance certificate | seed-insurance-certificate.pdf | first-start date − 1 day | expired |
| Omar Haddad | insurance certificate | seed-insurance-certificate.pdf | first-start date + 365 days | approved |
| Omar Haddad | food-handler card | seed-food-handler-card.pdf | first-start date + 365 days | approved |

Every seed document:
- has `version` 2, `current` true, `contentType` `application/pdf`, and `uploadedAt` and `approvedAt` equal to the stored first-start instant;
- is a one-page PDF whose stored object begins with `%PDF-`, sits at its published key, and has a byte length equal to its `sizeBytes`.

Consequences at first start, with nothing else done:
- `GET /api/documents` as Marisol returns exactly the 7 Northside documents, and as Jonah exactly Omar's 2.
- Each member's documents prefix in storage holds exactly that member's seed document ids.
- No expiry notice is sent: no seed document has 0 to 14 days remaining, and Nadia's certificate has already expired.
- Nadia Okoro has no food-handler card. Until she has a current, unexpired document of each required type that covers a block, the document rule refuses her holds and confirms. Her expired certificate stays her current insurance certificate until a later-expiring one is approved, so it is listed for inspectors and is the document the check-in rule reads.

When storage is unreachable at first start:
- the seed document records are still saved as approved;
- their objects are written later, as set out under Recovery in Services, outside the queued counts. This is the only exception to the together-or-not-at-all rule;
- until an object is stored, holds, confirms and check-ins treat its document as approved, and its downloads answer the storage 503 from Services.

**Empty at start.** At start there are no bookings, out-of-service windows, sanitation entries, sanitation PDFs, inspector links, access records, sessions or sign-in failures, and no month is closed.

## Technical requirements

### Deployment (DP-54)

- The runtime is TypeScript on Node.js 22 LTS with npm.
- `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:
  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```
- The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or on 4173 when that variable is unset.
- It serves the API and the browser app from that one origin. Every screen address in Screens and layout, with its query string, loads the browser app directly.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` as soon as the database schema is ready, whether or not Kill Bill, mail or storage is reachable.

### Configuration and secrets (DP-60)

These are read from the environment at start:

| Area | Variables |
|---|---|
| Database | `DATABASE_URL` |
| Kill Bill | `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| Storage | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Server | `APP_PUBLIC_PORT` |
| Timing | `LINEBOARD_HOLD_TTL_SECONDS` (default 600), `LINEBOARD_NO_SHOW_GRACE_SECONDS` (default 1800), `LINEBOARD_SWEEP_SECONDS` (default 300), `LINEBOARD_SIGNIN_WINDOW_SECONDS` (default 900), all in whole seconds |

No credential, service URL or key is written into source, bundled into browser code or returned in any response. The browser talks only to the Lineboard server.

### Server boundary (DP-48, DP-55, DP-83, DP-90, DP-94, DP-96)

**Cross-site requests.**
- The rule covers every state-changing request: every method other than GET and HEAD, on any path under `/api`, whether the path is published or not. This includes `POST /api/session` and `DELETE /api/session`.
- The request's own origin is `http://` followed by the request's `Host` header, compared exactly, port included.
- A state-changing request is cross-site, and answers `403 {"error":"cross_origin","message":"Requests from other sites are refused."}`, when any of these holds:
  - `Origin` is present and differs from the request's own origin. `Origin: null` counts as different;
  - `Origin` is absent and `Sec-Fetch-Site` is `cross-site` or `same-site`;
  - `Origin` and `Sec-Fetch-Site` are both absent and `Referer` is present and names another origin.
- A request carrying none of these three headers is allowed, so that non-browser clients work. So is a request with no `Origin` and a `Sec-Fetch-Site` of `same-origin` or `none`.
- This decision is the first step of the precedence rule. A refused request is therefore never counted as a sign-in failure and never answers 429, never ends or creates a session, never stores or consumes an Idempotency-Key, never adds an inspector access record, and never answers 404 on an unlisted path.
- No response carries any `Access-Control-Allow-*` header.

**Limits and caching.**
- Body limits are those in API.
- Unlisted `/api` methods and paths follow API › Only the published surface.
- Every `/api` response, success or error, and every screen document (the HTML served for `/` and for each screen address, including `/inspect/*`) carries `Cache-Control: no-store`.

**Request-scoped identity.** Every request reads its person and kitchen from its own session row, and nothing about a caller is kept between requests or shared between requests in flight. Under 40 interleaved requests from sessions of different kitchens, each response carries only its own session's person and kitchen data.

**Opaque errors.** This rule covers three kinds of text, and nothing else:
- the whole body of every error response (any status of 400 or above);
- the value of every header on an error response, except `Set-Cookie` and `Content-Disposition`. Header names are not covered;
- every value in a `GET /api/service-status` body.

Success responses, their headers, `Set-Cookie` values and `Content-Disposition` values are outside this rule. Matching is a plain substring match. None of the covered texts ever contains any of these:
- matched exactly as set, case-sensitive, and only for a value that is at least 12 characters long: the full value of `KILLBILL_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `DATABASE_URL`, `SMTP_HOST`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, and the `host:port` part of each of the URL values among them. A value shorter than 12 characters is not checked, and neither is a value that equals or appears inside any copy, code or field name published in this brief;
- matched case-sensitive: `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`, `getaddrinfo`, `AggregateError`, `127.0.0.1`, `localhost`, `node_modules`, `SELECT `, `INSERT INTO`, `UPDATE `, and a line beginning with four spaces followed by `at ` (a stack frame);
- matched case-insensitive: `postgres`, `minio`, `killbill` and `kitchens/` (the start of every object key).

An error's `message` is only its published copy, as set out in API › Error shape.

**What the server never serves.**
- The server never serves source files, the run manifest, package manifests, lockfiles, environment files or anything else outside the built browser app. Such paths answer 404.
- Stored documents are served with:
  - `Content-Type` set to the detected type: `application/pdf`, `image/png` or `image/jpeg`;
  - `Content-Disposition: attachment; filename="<sanitised name>"`. The sanitised name keeps only letters, digits, spaces, dots, hyphens and underscores, drops any path, and is at most 100 characters;
  - `X-Content-Type-Options: nosniff`;
  - `Content-Security-Policy: sandbox; default-src 'none'`.
- Every response on `/inspect/*` and `/api/inspect/*` also carries `Referrer-Policy: no-referrer`. This includes the HTML page, JSON, downloads and error responses.
- File type is judged only by the file's first bytes: `%PDF-`, the PNG signature or the JPEG start marker. The file name and the declared type are ignored, so SVG, HTML and anything else answer 415.

**Boot.** At boot, the server waits and retries until PostgreSQL is reachable. An unreachable Kill Bill, mail service or storage never stops it from starting.

### Browser support and performance (DP-58, DP-69, DP-81, DP-87, DP-88, DP-92, DP-97, DP-98)

- Supported browsers are current Chromium, Firefox and Safari, at 375x812, 768x1024 and 1280x800, with mouse, keyboard and touch input.
- The device clock and time zone may be wrong; every screen relies on the server's dates, times, statuses and offered actions.
- With the seed data, the board is usable within three seconds of navigation, on a phone as on a desktop.
- Every action shows its pending state within a tenth of a second.
- A refused board action or move redraws its block within one second of the response.
- The member picker sends its query no more than 250 milliseconds after the last keystroke.
- The banner's waiting counts update within one second of the person's own action answering while a service is down.
- The Documents layout switch completes within one second of the viewport crossing 768 pixels.
- A board, invoice, settings or inspector-link refresh never moves keyboard focus or a block in hand.

## Working rules

- IF-01: `/app/run.json` exists and contains exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package by name, version and licence, plus every bundled font. Shipped packages means the production dependency tree as reported by `npm ls --omit=dev --all --json`, or the lockfile's non-dev group.
- IF-03: Every shipped package and font is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or OFL-1.1.
- IF-04: State lives only in the provided PostgreSQL, Kill Bill and object storage. No other datastore is a source of truth: no SQLite, Redis, local files or in-memory stores. This includes sessions, sign-in failure counts, idempotency records and the first-start date.
- IF-05: The provided service definitions, dev credentials and seeded service configuration are left unmodified.
- IF-06: Server and browser source is written in TypeScript.
- IF-07: The browser loads scripts, styles and fonts only from the Lineboard origin, never from third-party hosts.

## Engineering standards

- The code is idiomatic TypeScript with strict type checking on, and it uses no `any` escapes where a domain type exists.
- Names match the domain terms in this brief: hold, released hold, ticket, block, current block, station, lane, shelf slot, capacity, hour bank, hour ledger, peak window, rate version, rate status, effective instant, rules version, late cancellation, adjustment credit, adjustment month, adjustment row, grace instant, offered actions, out-of-service window, block in hand, ghost, board dialog, member picker, superseded document, first-start date, inspector link, access record, statement, close-time name, frozen figures, sign-in failure, return address, Kill Bill amount, cross-site request.
- Each domain rule is decided in exactly one place in the source:
  - the cross-site decision on state-changing requests;
  - the booking state transitions, including the automatic hold lapse and no-show;
  - the offered actions of a booking for its caller at an instant;
  - the order in which state checks refuse a request;
  - the published route table, outside which every `/api` request answers 404;
  - the published copy of each error code;
  - the occupancy rule for hourly stations and shelf capacity, including when a released hold stops occupying;
  - which bookings a list, board or report shows, with released holds left out;
  - the end-of-day 24:00 rule for local times and instants;
  - the per-member-month order of hour-bank claims, with its ascending month order and the hour-bank balance;
  - the 48-hour cutoff;
  - resolving a rate version's effective instant, its status at an instant, and choosing the version for a block;
  - block pricing and rounding;
  - the pairing of each hour-ledger entry with its Kill Bill item;
  - the Kill Bill amount and its comparison with Lineboard's total before a close;
  - the adjustment month for a post-close waiver;
  - which document is current, its expiry status, the notice ladder and the check-in document rule;
  - which certificates an inspector link opens at a request, and a link's status;
  - the seed and its first-start date;
  - the role shape of member records;
  - the accepted keys of each write body;
  - comparing idempotent requests;
  - text normalisation, counting and the refused business-name characters;
  - the sign-in throttle;
  - which screens each role reaches and which return addresses are honoured;
  - which business name and figures a surface shows (live or frozen at close);
  - the statement body layout;
  - the usage CSV rows, its numeric cells and text-cell neutralisation;
  - the keyboard handling of a block in hand: which keys act, where focus goes and what each key announces;
  - the member picker's opening, active-option and selection rules;
  - how a board dialog opens over the board and restores focus and scroll position when it closes;
  - which response a screen draws for the address, typed text, session and latest own action it shows.
- No abstraction has only one implementation. There is no dead, commented-out or unreachable code.
- There are no defensive checks for states that the database constraints and state rules already make impossible.
- Every API error is produced through one error shape, using the codes listed in API, and no handler builds a message from a caught error's own text.
- Money is handled as integer cents from end to end, with no floating-point arithmetic on amounts.
- No features, endpoints or screens go beyond this brief.
