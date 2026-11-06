# Rasp & Rein Clinchline

Clinchline is a web app for Rasp & Rein, a one-person travelling farrier practice that trims and shoes horses on five- to eight-week cycles at boarding barns. The farrier imports the client list and publishes barn days. Owners book their horses into the slots with a card deposit, and a waitlist offers freed slots in order. Each barn-call trip fee is split by a published rule across the horses that count toward it. When a horse cannot be worked on the day, the farrier excuses it, and its share moves onto the horses not yet invoiced through appended cent adjustments. The farrier and the apprentice photograph and mark every hoof during a visit. Closing a visit sends the horse's owner exactly one correct invoice with their deposit credited. Owners and their vets can compare a hoof's angles between two visits side by side, and the farrier reads the month's money against the ledger. Several stateless instances of the app can serve at once. The server uses four services:
- Postgres is the system of record and the coordination layer every instance shares.
- A private MinIO bucket holds hoof photos, upload chunks, thumbnails and CSV exports.
- Mailpit receives every email the app sends.
- Kill Bill holds one billing account per horse owner and records invoices, payments and refunds.

Out of scope: self-registration, password reset, SMS, multi-farrier practices, barn boarding fees, real card networks (cards are the three published test cards) and any datastore other than Postgres and MinIO. Every person signs in with a seeded or imported account.

## Problem and users

A working farrier sees 25 to 40 horses a week across about a dozen barns. Each horse has a different owner and a different trim or reset cycle. Today the practice runs on a paper day book, group texts and a phone camera roll. The trip charge pays for getting to the barn, and it is usually shared among the owners booked that day. When one owner cancels the night before, or a horse can't be worked on the day, the farrier either absorbs the missing share or argues about it, because nobody wrote the terms down and no deposit was held. Before-and-after hoof photos sit unlabelled on the phone. When an owner or a vet asks whether the hoof-pastern axis has improved since the last reset, nobody can show it side by side. Existing farrier tools bill one client at a time. None of them treats a barn day as a shared booking with a published split, deposit and cancellation rule. The farrier pays for this in unpaid trip fees, chased invoices and lost evenings.

- **Farrier** (daily): imports the client list, publishes barn days, works through the horses on site, excuses a horse that cannot be worked, closes each visit with photos, angle marks and charges, gets every owner invoiced exactly once, and reads the month's money against the ledger. Often works from a phone on a weak barn connection, and sometimes has the same day open on a laptop too.
- **Apprentice** (daily): uploads hoof photos on a weak connection, deletes a blurred one, and marks the hoof-wall and pastern lines during a visit, sometimes at the same moment as the farrier. The apprentice can never change prices, splits, payments, visit charges or invoices.
- **Horse owner** (weekly): books horses into a published barn day before it fills with a card deposit, takes a waitlist offer when a slot frees, sees what is due, compares this visit's hoof with the last one, and pays a correct invoice.
- **Barn manager** (weekly): sees which horses and stalls the farrier will visit on a barn day at their barn, updating live, so horses are caught and ready. The barn manager uses a bookmarked page on the barn's tablet and never sees owners' contact details or any money amounts.
- **Vet** (occasional, no account): opens a read-only comparison link the farrier sent for one horse.

## Journeys

1. **Farrier imports clients and publishes a barn day, including on a clock-change weekend.** Start: the farrier is signed in, and the left rail lists the seeded barn days. The farrier opens "Import CSV" on Horses and uploads the client list. A bad file writes nothing and lists each bad row by line, column and code. A good file creates or matches owners and horses, and importing it again creates nothing. The farrier opens "New barn day", picks Cedar Hollow Stables, enters a date, a start time, the number of slots and the minutes per slot, and saves a draft. Then the farrier presses "Publish day". A start time that does not exist on that date because the clocks jump forward is refused under the Start time field. End: the rail shows the new day with its date, barn and "0/<slots>" count. The day header shows the cancel-by time, which is exactly 24 elapsed hours before the start, so on a clock-change weekend it reads an hour off the start's clock time. Notices announces the publish.
2. **Owner books by keyboard, lets a hold run out, and owners race for the last slot.** Start: an owner is signed in and has a horse at a barn with a published day. Using only the keyboard, the owner picks the horse and a test card, presses the button for an open time and confirms in the "Confirm booking" dialog, which shows the deposit and when the hold ends. Focus returns to the new "Cancel booking for <horse>" button, the deposit is captured and a confirmation email arrives. If the owner leaves the dialog open past the hold's end, the slot is free at that instant, the deposit reads voided, and a late confirm says the hold ran out. When several owners press the last open time at the same instant, exactly one gets the hold and the next booking number. The others are told the day is full and offered "Join waitlist", and their failed claims leave no booking number, card hold, payment, audit entry or email behind. When a slot frees, position 1 gets a timed offer before anybody else can take the slot, even if no job has run. End: the rail count, the full status and the waitlist positions 1 to n agree with the bookings actually held while slots are released, lapse and are offered again.
3. **Barn manager prepares horses from a bookmark.** Start: the barn manager is signed out on the barn's tablet and opens a bookmarked barn day URL. The manager signs in and lands on that same day's ready sheet. Reloading keeps it. As bookings change on any instance, rows change in place. When the farrier's import moves a horse to another stall, its row shows the new stall without a reload. A dropped connection resumes with nothing lost or repeated. End: a table shows slot times, horse names and stall numbers only. A URL for another barn's day shows only the not-available copy.
4. **Owner cancels the evening before.** Start: an owner has a confirmed booking on a published day. The owner presses "Cancel booking for <horse>". The dialog says whether the cutoff has passed, judged in the practice time zone whatever the owner's device clock says, and what happens to the deposit. The owner confirms. End: the booking is cancelled in time with the deposit refunded in Kill Bill before the answer arrives, or cancelled late with the deposit kept. One stored decision instant settles the verdict, the deposit and the ledger. Notices says whether a trip share still applies, the cancellation email says the same, and the first waitlisted horse already holds the freed slot.
5. **Working the barn day.** Start: the farrier has a published day with confirmed bookings. The farrier presses "Start day" on the phone while the laptop also has it open, and an owner may be cancelling at the same moment. Exactly one start takes effect and fixes the trip-fee shares. For each horse the farrier presses "Open visit for <horse>". The apprentice uploads before and after photos for each hoof. An upload interrupted by a weak connection resumes where it stopped, even on another instance. A blurred photo can be deleted, and nothing of it stays behind. The apprentice places the hoof-wall and pastern lines on the after photos. If the farrier saved marks on the same hoof first, the apprentice is told and shown the farrier's lines, and the farrier can restore an earlier version from the attributed history. When a horse can't be worked, the farrier excuses it. Its share moves onto the horses not yet invoiced as appended adjustments, shown in "Trip share adjustments", and its deposit is refunded. The farrier ticks the work done and presses "Close visit". The phone may resend the close on a flaky connection, or the instance may die part way. End: each row reads "Invoiced" with its total after the deposit credit, and the owner gets exactly one invoice and one visit summary email. If billing is unreachable, rows read "Invoice pending". After the retry hold-off in Business rules, and once billing is back, they change to "Invoiced" on their own, and Notices announces each one once.
6. **Closing the day and reading the month.** Start: every horse on an in-progress day has a closed visit, is excused or is marked no-show. The farrier presses "Close day". The day closes. Every late-cancelled or no-show horse's owner has one trip-only invoice with their kept deposit credited, and all trip shares on the day add up exactly to the fee. The farrier opens Dashboard, picks the month, and exports the ledger as CSV. End: the figures equal the ledger and Kill Bill to the cent, applied deposits count as neither new money nor refunds, and an owner name beginning with a formula character is neutralised in the file.
7. **Owner compares and pays, and recovers from a decline.** Start: an owner opens their horse at its own URL. The comparison stage shows the previous visit's photo with this visit's photo wiped in from the left, plus the readout of both stored angles. The owner moves the divider with the arrow keys and switches hooves and visits. A live update keeps the divider, the pair and focus where they were. Reload keeps the horse and hoof. Then the owner opens Invoices, picks a card and pays. End: the row reads "Paid" only once Kill Bill has recorded the payment against that invoice. If billing is unreachable the row stays "Unpaid", the card is not charged and the button can be pressed again. If the card declines, the invoice enters dunning with retries on a published schedule, a published email at each step, and a booking block if it reaches the end. Paying clears it at once, and a waitlist the owner was skipped on offers them the slot in the same moment.
8. **Vet comparison link.** Start: the farrier opens a horse with at least two closed visits and sends a vet link. End: the vet's email holds a link that opens a read-only comparison of that horse's two most recent closed visits. When the farrier closes a new reset, the vet's next read shows the new pair, and photo paths for the visit that left the pair stop working. The farrier reads who opened the link, when, and which pair each view saw. After the farrier revokes or regenerates the link, or the link expires, the old link shows "This comparison link is no longer available." on every instance, and photo paths signed before the revoke stop working. Someone guessing links is shut out after ten misses a minute, on every instance of the app.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-in and roles** Seeded and imported farrier, apprentice, owner and barn-manager accounts sign in with email and password, get a session cookie, and are refused with 401 when signed out.
- **DP-02 — Effective-dated price list** The farrier creates immutable price lists with an effective date and a booking deposit, and the list in force on a date is the one with the latest effective date on or before it.
- **DP-03 — Barn days in business time** A barn day's date and start time are read as wall-clock time in the practice time zone, and the API reports its start and its cancellation cutoff, exactly 24 elapsed hours earlier, as instants carrying the practice-zone offset in force at each.
- **DP-04 — Barn day state machine** Barn days move only along the published edges between draft, published, full, in progress, closed and cancelled, with full and published derived from live bookings, and every other edge is refused with the illegal-transition 409.
- **DP-05 — Farrier day sheet** The farrier creates, publishes and starts a barn day from the left rail and day sheet, and the rail count and row list reflect each change.
- **DP-06 — Owner barn day view** Owners see published, full and in-progress barn days only at barns where they keep a horse, with each slot shown as open or taken and no other boarder's horse or owner named, and any other barn day id answers 404.
- **DP-07 — Slot hold and confirmation** Pressing a slot authorises the deposit and places a hold that the owner confirms or releases, and an unconfirmed hold lapses at its stored expiry instant and frees the slot, as qualified in Business rules.
- **DP-08 — Booking confirmation email** Confirming a booking sends the owner one email with the slot, barn, date and cancellation cutoff, and repeating the confirmation sends nothing more.
- **DP-09 — Keyboard booking dialog** An owner can choose a horse, hold a slot and confirm or release it with the keyboard alone, with focus trapped in the dialog and returned as described in Interactions.
- **DP-10 — Last open slot race and waitlist** When several owners claim the last open slot at once, exactly one hold succeeds, every other claim gets the day-full 409, and those owners can join the waitlist with a card.
- **DP-11 — Role-shaped booking list** A barn day's booking list returns exactly the published field set for the caller's role, and a barn manager's rows carry only slot time, horse name and stall.
- **DP-12 — Barn manager ready sheet** A barn manager sees only their own barn's days in the rail and opens a ready sheet listing slot time, horse and stall for horses to be caught.
- **DP-13 — Cancellation cutoff in business time** An owner's cancellation is cancelled in time or cancelled late according to the 24-hour cutoff measured from the start in the practice time zone, whatever the browser or server clock zone.
- **DP-14 — Cancellation notice email** Every cancellation sends the owner one email that says whether a trip share still applies and what happens to the deposit.
- **DP-15 — Cancel dialog states the trip share** Before an owner confirms a cancellation, the dialog states the server's verdict on whether the cutoff has passed and what that means for the trip share and the deposit.
- **DP-16 — Day start fixes the counting horses** Starting a barn day removes open holds and voids their deposits, fixes the set of horses that count toward the trip fee, and stores each one's share.
- **DP-17 — Largest-remainder trip split** Trip shares are whole cents that add up exactly to the day's fee, with leftover cents placed by the published largest-remainder rule in ascending booking number.
- **DP-18 — Opening a visit** On a started day the farrier opens a visit for a confirmed booking, and the booking becomes worked.
- **DP-19 — Safe hoof photo uploads** Only real JPEG, PNG or HEIC images within the size limit are stored, under the published key pattern and with all location and other metadata removed.
- **DP-20 — Apprentice limits** The apprentice can open the day sheet, upload photos and save marks, and is refused with 403 on prices, day transitions, visit closing, allocations, invoices, payments and vet links.
- **DP-21 — Server-computed angles and alignment** Saving hoof-wall and pastern lines stores both angles to 0.1°, the alignment label and a new marks version, computed once on the server by the published formula.
- **DP-22 — Marking lines on a photo** The farrier or apprentice places both lines by clicking points on the after photo or typing coordinates, saves them, and sees the stored angles announced.
- **DP-23 — Visit charges at the effective price** Closing a visit charges each ticked work item at the price in force on the barn day's business date, plus the horse's stored trip share.
- **DP-24 — One invoice per visit close** Closing a visit creates exactly one Kill Bill invoice on the owner's account, however many times the close request is sent.
- **DP-25 — Visit summary email** When a visit is invoiced, its owner gets one summary email listing that horse's work, trip share, deposit credit, invoice total and next-due date, and nothing about any other owner.
- **DP-26 — Next-due status** Each horse shows its next-due date and a current, due, overdue or unknown status derived from its last worked visit and cycle as stated in Business rules.
- **DP-27 — Invoice pending when billing is down** With Kill Bill unreachable, closing a visit still succeeds and leaves the visit and its invoice pending, with the pending copy shown, for at least the retry hold-off stated in Business rules.
- **DP-28 — Reconcile once when billing returns** Pending invoices are created in Kill Bill exactly once after the retry hold-off and within the stated delay once billing is reachable, without an app restart, as qualified in Business rules.
- **DP-29 — No-shows and closing the day** The farrier marks unworked bookings as no-show, and a day closes only when no confirmed booking or open visit remains.
- **DP-30 — Trip-only invoices** Closing a day gives every late-cancelled or no-show horse with a non-zero share exactly one trip-only invoice on its owner's Kill Bill account, with any kept deposit credited up to the share.
- **DP-31 — Owner record isolation** Owners, barn managers and vet links reach only their own horses, visits, photos, payments and invoices, and any other id answers 404 even when guessed.
- **DP-32 — Comparison data** The comparison endpoint returns, for one horse and hoof, two marked visits with their stored lines, angles, labels, signed differences and exact readout lines.
- **DP-33 — Axis wipe stage** The comparison stage puts the previous photo underneath and wipes the current photo in from the left up to the divider, and draws previous lines dashed and current lines solid in each visit's colour.
- **DP-34 — Divider keyboard and pair-change motion** The divider slider steps by keyboard and pointer, and changing the visit pair or hoof glides it to the middle while the readout numerals count to their new values.
- **DP-35 — Reduced-motion axis wipe** With reduced motion requested, the divider jumps, the numerals switch with no count, and a three-way Previous, Split, Current control sets the divider.
- **DP-36 — Vet link issue** The farrier issues a vet link for a horse's two most recent closed visits, and the vet receives it by email.
- **DP-37 — Vet link scope, expiry and revocation** A vet link reads only its horse's comparison, refuses every write, and stops working once it expires, is revoked or is regenerated.
- **DP-38 — Vet comparison page** The vet link opens a read-only page with the axis wipe for each marked hoof and no owner, price or invoice details.
- **DP-39 — Owner invoices and payment** Owners see their own invoices and pay an unpaid one's full balance by card, which records one payment against that invoice in Kill Bill before the card is captured, as qualified in Business rules.
- **DP-40 — Run manifest and health** The app installs, builds and serves from the run manifest on the stated port and answers the health check.
- **DP-41 — Server boundary** The server refuses cross-origin writes and oversized or mistyped bodies, and never serves source, configuration or credentials.
- **DP-42 — Dependency outages** The app starts and serves with Kill Bill or Mailpit unreachable, and emails that could not be sent are delivered once each after Mailpit returns, without a restart, as qualified in Services.
- **DP-43 — Credentials from environment** Every service URL and credential comes from the named environment variables at start, and none is hard-coded or sent to the browser.
- **DP-44 — Responsive layout** Every screen works at 375x812, 768x1024 and 1280x800 with no horizontal scrolling and with tap targets at least 44 px.
- **DP-45 — Visual identity** Screens use the bone-ground, ruled-table look with forge-orange current and steel-blue previous roles, the named typefaces and aligned numerals described in Visual design.
- **DP-46 — Clock-change barn days** Across a daylight-saving change the cutoff stays exactly 24 elapsed hours before the start, a start time that does not exist on that date is refused with 422, and a repeated time resolves to its earlier occurrence.
- **DP-47 — Hold lapse at the stored instant** A hold is lapsed at and after its stored expiry instant on every read, so the slot reopens, the day stops reading full, the deposit reads voided and a late confirm answers hold_expired, without waiting for any background job.
- **DP-48 — Consistent counts and waitlist positions** Under any mix of simultaneous holds, releases, confirmations, cancellations, offers and waitlist joins, the booked count, the full status, the rail count and the contiguous waitlist positions agree with the bookings actually held.
- **DP-49 — Barn day and horse URLs** Day and horse URLs restore the same sheet or panel on load, reload, Back, Forward and after sign-in, and a URL the caller may not see shows only the not-available copy.
- **DP-50 — One day start under races** Simultaneous starts, cancellations and holds on one barn day are serialised so exactly one start wins and stores one set of shares, and each cancel or hold either lands before it or is refused.
- **DP-51 — Versioned hoof marks** Each save of a hoof's marks must name the current version, and a save over a newer version, including the loser of two simultaneous first saves, answers 412 with the stored marks, which the marks form then shows.
- **DP-52 — Concurrent visit close** Simultaneous close requests on one visit, with the same or different idempotency keys, give one close, one Kill Bill invoice and one summary email, and an in-flight key answers idempotency_in_progress.
- **DP-53 — Announced reconciliation** Open pages refresh pending invoice rows at least every 10 seconds and, for the farrier and owners, announce each invoice that reaches billing exactly once in Notices.
- **DP-54 — Vet-link guess limit** Once 10 vet-link misses from one client address fall within a rolling 60 seconds, counted across all instances, every further vet-link read from that address answers 429 with Retry-After until the window clears.
- **DP-55 — Honest single payment** Simultaneous pays on one invoice record exactly one Kill Bill card payment, and the Invoices row reads Paid only after the payment is recorded and stays Unpaid with its button re-enabled when billing is unreachable.
- **DP-56 — All-or-nothing client import** The farrier imports the client list as a CSV that is applied whole, and any bad row writes nothing and is named by physical line, column and code.
- **DP-57 — Import matching** Import matches existing owners and horses by the published rules, so replays and re-imports, including two simultaneous imports, create no duplicate owner or horse.
- **DP-58 — Request allowances** Sign-in, booking, payment, upload and vet routes enforce per-user and per-address allowances shared by every instance, answering 429 with Retry-After and reporting the allowance in RateLimit headers.
- **DP-59 — Waitlist offers** When a slot frees, including by a lapse no job has seen, the lowest-position eligible waitlisted horse gets a timed hold before any other owner's hold can succeed, and a lapsed or declined offer passes to the next position.
- **DP-60 — Live barn day stream** A barn day's event stream gives each role exactly its own fields, delivers a change made on any instance within 2 seconds, and ends when the session ends.
- **DP-61 — Stream resume and in-place rows** Resuming a stream with Last-Event-ID on any instance replays contiguous ids with nothing lost or repeated, and open day and ready sheets change rows in place without a reload.
- **DP-62 — Resumable photo upload** A hoof photo can be uploaded in chunks that continue on any instance from the stored offset and land as one validated photo.
- **DP-63 — Per-visit photo quota** Stored plus reserved photo bytes on a visit never exceed the quota, including under simultaneous upload sessions.
- **DP-64 — Photo thumbnails** Each stored photo gets a metadata-free thumbnail through a background job, and the visit list and hoof picker show it.
- **DP-65 — Marks history and restore** The farrier and apprentice read a hoof's attributed marks history, and restoring a version creates a new version that copies its stored lines, angles and label and honours the stale-marks 412.
- **DP-66 — Deposit lifecycle** A booking's deposit is authorised at hold, captured at confirmation, voided, refunded or forfeited by the published outcome of the booking, and recorded in Kill Bill, as qualified in Business rules.
- **DP-67 — Payment state machine** Payments move only along the published edges, every other edge is refused with the illegal-transition 409, and refunds never exceed what remains of the captured amount.
- **DP-68 — Test cards and card numbers** The three published test card tokens decide approval and decline, and a real-looking card number is refused and never stored or logged.
- **DP-69 — Deposit credit on invoices** A horse's captured deposit appears as a credit on that horse's invoice alone, moved as one paired refund and payment in Kill Bill, with Kill Bill's balance equal to the app's to the cent.
- **DP-70 — Crash-safe close** A close interrupted by a killed instance or a partial Kill Bill failure finishes with one invoice, one transfer, one ledger set and one summary email, by lease takeover or the background reconciler.
- **DP-71 — Kill Bill read-back** Read-back routes compare the app's amounts with a live Kill Bill read and flag any mismatch to the farrier, and a card is captured only after Kill Bill records the invoice payment.
- **DP-72 — Live comparison updates** When marks or visits change on another device, the stage's lines and numerals update in place while the divider, selected pair, hoof, focus, open dialogs and typed text stay exactly as they were.
- **DP-73 — Immediate vet revocation** After a vet link is revoked, the next read on any instance fails, including photo paths signed for that link before the revoke.
- **DP-74 — Vet link view log** The farrier reads who opened a vet link, when, from which address and with what outcome.
- **DP-75 — Dunning schedule** A declined invoice payment enters dunning, retries the card on file at the published offsets, moves through the published states, and clears on any successful payment.
- **DP-76 — Dunning emails and account block** Each dunning state sends one published email, and an owner with a blocked invoice cannot hold or join a waitlist until it is paid.
- **DP-77 — Durable job queue** Background jobs are claimed by one live lease across instances, back off on failure, go dead at the attempt limit, and a superseded worker's result is discarded.
- **DP-78 — Job inspection and due reminders** The farrier reads jobs and retries dead ones, and each horse in due status gets one reminder email per next-due date across all instances.
- **DP-79 — Practice dashboard** The dashboard's month figures equal the ledger and Kill Bill to the cent, assign months in the practice time zone, and count applied deposits as neither new money nor refunds.
- **DP-80 — Ledger export** The farrier exports a month's ledger as CSV to MinIO through a job, with formula-leading cells neutralised.
- **DP-81 — Outstanding balance alert** The farrier gets one alert when outstanding money crosses above the threshold, and it re-arms only after falling back to or below it.
- **DP-82 — Scoped API tokens** The farrier issues read-only or billing tokens that are stored hashed, refused with insufficient_scope outside their scope, and refused with 401 on every instance once revoked.
- **DP-83 — Stateless instances and clock** Every instance serves any session and request from shared Postgres state, honours instants stamped by other instances, and applies its own clock offset and limit overrides.
- **DP-84 — Health and readiness** A liveness path needs no dependency, and a readiness path reports each dependency within a bounded time and names the ones that are down.
- **DP-85 — Graceful shutdown** On SIGTERM an instance stops accepting work, finishes in-flight requests, ends its streams, returns unstarted job claims and exits with code 0 within the grace period.
- **DP-86 — Versioned migrations** Schema changes are versioned files applied exactly once under concurrent boots, and seed data is written once.
- **DP-87 — Structured logs and request ids** Each request writes one JSON log line with its request id, and no secret, card token or vet token appears in any log.
- **DP-88 — Append-only audit log** Every state change writes exactly one attributed audit entry in the same transaction, and the database refuses any edit to the log.
- **DP-89 — Choreographed motion** Page, dialog, divider, live row, numeral and skeleton motion runs at the published timings, never delays input, and shifts the layout no more than the published limit.
- **DP-90 — Gradient surfaces** The rail, header, primary buttons, stage backing and status chips use the published palette gradients, and pending and live chips animate while meeting contrast at every frame.
- **DP-91 — State-change sequences** Each of the five named state changes plays its published sequence, marks the element while it runs, shows a visual toast and announces once in Notices.
- **DP-92 — Motion parity** Every animated control works by keyboard and touch, reduced motion gives instant states with identical copy, focus and end states, and a closed panel or dismissed toast cannot be reached at any viewport.
- **DP-93 — Refused claims leave no trace** A hold refused with a 409 or 422 takes no booking number and writes no card authorisation, payment, audit entry, stream event or email, a declined card writes only its declined payment row, and successful holds get consecutive booking numbers, as qualified in Business rules.
- **DP-94 — Cancellation reverses the deposit** An in-time cancellation refunds the captured deposit and records the refund in Kill Bill before answering when billing is reachable, adds one refund ledger entry beside the untouched capture entry, and runs the offer pass in the same transaction.
- **DP-95 — Excusing a horse** On an in-progress day the farrier excuses a confirmed horse that cannot be worked, which takes it out of the trip split, refunds its captured deposit and tells its owner by email.
- **DP-96 — Trip-share adjustments** Excusing a horse moves its share only onto counting horses not yet billed by the published pool rule, posting one appended cent adjustment per changed share, so billed shares never change and the shares always add up to the fee.
- **DP-97 — Deleted photos are gone** Deleting a photo removes its stored object, its thumbnail even when its thumbnail job is running, its signed paths and its quota bytes, as qualified in Business rules.
- **DP-98 — Close ends upload sessions** Closing a visit ends its live upload sessions, releases their reservations at once and removes their chunks within 10 seconds.
- **DP-99 — Rotating photo signing keys** Photo paths are signed with a key ring in Postgres that rotates on the published schedule, and each path verifies with the key it names until its own expiry.
- **DP-100 — Vet link follows the latest visits** A vet link shows the horse's two most recent closed visits at each read, its photo paths work only for that live pair, and each view row records the pair it served.
- **DP-101 — Marks fit the stored photo** Mark points are checked against the stored upright photo's width and height after any declared orientation is applied.
- **DP-102 — Restore and close in one order** Saves, restores and closes on one visit are serialised, so the close response, the closed visit and the owner's comparison carry the same final marks version.
- **DP-103 — Allowances across instance clocks** Allowance refill never runs backward across instances with different clocks, stored tokens are capped at the handling instance's capacity, Retry-After includes any lead of the stored instant, and allowance state survives restarts.
- **DP-104 — Drain keeps chains whole** A request accepted before SIGTERM completes its whole chain of writes, Kill Bill calls and emails or leaves its Kill Bill legs pending, and a request refused while draining writes nothing.
- **DP-105 — One instant decides a cancellation** A cancellation's late verdict, deposit outcome, refunded amount and refund ledger instant all come from one stored decision instant, including across clock changes.
- **DP-106 — Stall changes reach open sheets** Booking rows always show the horse's current stall, and an import that changes a listed horse's stall sends one row change to each role's open stream for that day.
- **DP-107 — Paying off a block resumes the waitlist** Paying an owner's last blocked invoice runs the offer pass in the same transaction on every open day where that owner waits.
- **DP-108 — Request-scoped identity** Simultaneous requests from different sessions and API tokens on one instance each get only their own caller's identity, records and role-shaped fields.

## Frontend

### Screens and layout (DP-05, DP-06, DP-12, DP-33, DP-38, DP-44, DP-49, DP-56, DP-74, DP-79, DP-82, DP-96, DP-100)

- **Sign in** (`/sign-in`). A single centred form on the bone ground, with the Rasp & Rein wordmark above it and `status "Notices"` under it.
- **App shell (all signed-in roles).** A fixed left rail lists barn days by date, oldest first. Each entry shows the date, the barn name and a slot count in the form `<booked>/<slots>`, where `<booked>` is the day's `booked_count` and `<slots>` is its `slot_count`, both as defined in API. Below the barn days, the rail lists "Horses" for the farrier and owners, "Invoices" for the farrier and owners, and "Prices" and "Dashboard" for the farrier. A header strip holds the signed-in name, the role and "Sign out". Which days the rail lists:
  - farrier and apprentice: every non-cancelled day;
  - owner: published, full and in-progress days at barns where they keep a horse;
  - barn manager: their own barn's published, full, in-progress and closed days.
- **App URLs.** Each screen has its own path: `/` (the first rail day, or an empty main column when there is none), `/days/<barn day id>`, `/horses`, `/horses/<horse id>?hoof=<LF|RF|LH|RH>`, `/invoices`, `/prices`, `/dashboard` and `/vet/<token>`. What `/days/<barn day id>` shows depends on the role: the day sheet for the farrier and apprentice, the ready sheet for a barn manager, and the owner day view for an owner.
- **Day sheet (farrier, apprentice).** The main column holds a ruled table with one row per booking in slot order. The header above it shows the barn, date, start time, cutoff, status and trip fee (the fee is shown to the farrier only). Columns for the farrier: Time, Horse, Stall, Owner, Cycle (weeks), Status, Share, Visit. The Share column shows the booking's current share. The apprentice sees no Owner or Share column. For the farrier, the Visit column shows the visit status text and, once invoiced, the invoice total from the row's `invoice_total_cents`. On a cancelled-late or no-show row it shows that horse's trip-only invoice from the row's `invoice_status` and `invoice_total_cents`: `Invoice pending` while the status is `pending`, and `Invoiced` with the total once it is `unpaid` or `paid`. The cell is empty until a trip-only invoice exists, and always empty on an excused row. For the apprentice, the Visit column shows only the visit status text, never an invoice total or a trip-only invoice status, and is empty on a row with no visit. The day controls sit in the header. For the farrier, a "Waitlist" sub-table follows the rows, listing position, horse and join time, and then the "Trip share adjustments" table, listing every adjustment in `seq` order.
- **Ready sheet (barn manager).** The same ruled table with only Time, Horse and Stall.
- **Owner day view.** "Horse" and "Card" pickers above a ruled "Slots" table. Each row shows a time and one of four things: a book button, the word "Taken", the owner's own horse name with a cancel button, or an offered hold's confirm button.
- **Horses.** A ruled list of horses with next-due status. The farrier also has "Import CSV" here.
- **Horse panel (farrier, apprentice, owner).** Opening a horse puts the comparison stage across the top half of the main column, with the photos in a 4:3 frame. Under the stage, the 2×2 hoof picker (fore hooves on top, left on the left, each showing its thumbnail when one is ready) sits beside the readout. Below them are the visit pickers and the visit list. For an open visit, the farrier and apprentice also see the photo upload panel with a delete button beside each stored photo, the marks form and the marks history, and the farrier also sees the work checklist and "Close visit". The farrier also sees the "Vet links" table, whose rows show the link's live pair.
- **Not available.** A day or horse URL the caller cannot see keeps the rail and shows only the matching not-available copy from Feedback states in the main column.
- **Invoices.** A ruled table with date, horse, kind, total, balance, status and dunning, plus a pay button on each unpaid row and a "Card" picker above the table (owner). The farrier's rows also show a Reconciliation column.
- **Prices (farrier).** A ruled table of price lists by effective date with a "New price list" dialog, then the "API tokens" table.
- **Dashboard (farrier).** A "Month" picker and "Export CSV", the "Month totals" ruled table, the "Billed and collected" bar chart and the focusable "Daily figures" table.
- **Vet page** (`/vet/<token>`, no sign-in). The horse name, the two visit dates of the live pair, and one comparison stage with the hoof picker and readout. There is no rail and no control that changes anything.

Viewports:
- **1280x800:** the rail is fixed, about one fifth of the width, and scrolls on its own. The main column takes the rest. On Dashboard the "Month" picker and "Export CSV" share one line, with "Month totals" on the left and the chart on the right, and "Daily figures" full width below.
- **768x1024:** the rail narrows to about a quarter of the width. Tables keep their columns, and the stage spans the main column. Dashboard is one column: pickers line, chart, "Month totals", "Daily figures".
- **375x812:** the rail collapses into a "Barn days" button at the top that opens the list as a full-width panel. Each table row becomes a stacked ruled block with labelled values, including the rows of "Trip share adjustments". The stage spans the full width, with the 2×2 hoof picker and then the readout underneath. Dashboard is one column in this order: "Month", "Export CSV" at full width, chart, "Month totals", "Daily figures".

No screen scrolls sideways at any of the three sizes. Each published size gets exactly the layout listed for it.

### Public screens and controls (DP-01, DP-05, DP-06, DP-09, DP-12, DP-15, DP-20, DP-22, DP-33, DP-34, DP-35, DP-36, DP-38, DP-39, DP-49, DP-51, DP-55, DP-56, DP-59, DP-65, DP-68, DP-71, DP-74, DP-75, DP-79, DP-82, DP-91, DP-95, DP-96, DP-97, DP-100)

Only these roles and names are public. Everything else is free. Placeholders:
- `<time>` is a slot time as `HH:MM` (24-hour, practice time zone).
- `<date>` is a business date as `YYYY-MM-DD`.
- `<horse>` is the horse name.
- `<vet email>` is the address entered.
- `<cutoff>` is the cutoff format defined in Feedback states.
- `<hold end>` is the booking's `hold_expires_at` printed as `HH:MM:SS` in the practice time zone.
- `<deposit>` is the booking's deposit in dollars with two decimals.
- `<time zone>` is defined in Business rules (Practice time).
- `<hoof name>` and `<phase>` are defined in Feedback states.

| Where | Role and accessible name | Visible copy / notes |
|---|---|---|
| Sign in | `form "Sign in"`, `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| Shell | `navigation "Barn days"`, each entry `link "<date> <barn name> <booked>/<slots>"` | Count in aligned numerals. The entry for the day on screen carries `aria-current="page"` |
| Shell, 375 wide | `button "Barn days"` with expanded state | Opens the rail panel |
| Shell | `button "Sign out"` | |
| Shell | `status "Notices"` (polite live region) | All feedback copy. The only live region for feedback |
| Shell | `button "Dismiss notice"` | Inside the visual toast described in Motion |
| Farrier | `button "New barn day"` → `dialog "New barn day"` with `combobox "Barn"`, `textbox "Date"`, `textbox "Start time"`, `spinbutton "Slots"`, `spinbutton "Minutes per slot"`, `textbox "Trip fee"`, `button "Save draft"` | Trip fee in dollars |
| Horses | `button "Import CSV"` → `dialog "Import CSV"` with file input labelled `CSV file`, `button "Import"`, `table "Import errors"` (Line, Column, Code) | Farrier |
| Day header | `button "Publish day"`, `button "Start day"`, `button "Close day"`, `button "Cancel day"` | Shown only when that edge is legal |
| Day header | text `Cancel by <cutoff>` | |
| Day sheet | `table "Day sheet"` | Farrier and apprentice |
| Day sheet row | `button "Open visit for <horse>"`, `button "Mark <horse> no-show"`, `button "Excuse <horse>"` | Farrier, day in progress, confirmed rows |
| Day sheet row | `link "<horse>"` | Opens the horse panel |
| Excusing | `dialog "Excuse horse"` with `button "Keep horse"`, `button "Excuse horse"` | Body copy in Feedback states |
| Waitlist | `table "Waitlist"` | Farrier |
| Adjustments | `table "Trip share adjustments"` | Farrier. Columns Horse, Change, Share, At. Change is `+$<amount>` or `−$<amount>` (minus sign U+2212), Share is the booking's share after the adjustment as `$<amount>`, At is the adjustment instant as `HH:MM:SS` in the practice time zone |
| Ready sheet | `table "Ready sheet"` | Barn manager |
| Owner day | `combobox "Horse"`, `combobox "Card"`, `table "Slots"`, `button "Book <time>"`, `button "Cancel booking for <horse>"`, `button "Join waitlist"`, `button "Confirm offer for <horse>"` | "Taken" text for others' slots |
| Card picker | `combobox "Card"` options `Test card 4242 (approves)`, `Test card 0002 (declines)`, `Test card 9995 (insufficient funds)` | First option preselected; same picker on Invoices |
| Booking | `dialog "Confirm booking"` with `button "Confirm booking"`, `button "Release hold"` | Body: `Hold <time> on <date> at <barn name> for <horse>. Deposit $<deposit>. Cancel by <cutoff> or the trip share still applies. Hold ends at <hold end> (<time zone>).` The `Deposit $<deposit>. ` sentence is left out when the deposit is 0 |
| Cancelling | `dialog "Cancel booking"` with `button "Confirm cancellation"`, `button "Keep booking"` | Body copy in Feedback states |
| Horse panel | `region "Hoof comparison"` containing the stage | |
| Stage | `slider "Comparison divider"`, value 0 to 100, value text `<n>% current` | |
| Stage | `radiogroup "Hoof"` with `radio "Left fore"`, `radio "Right fore"`, `radio "Left hind"`, `radio "Right hind"` | 2×2 |
| Stage | `combobox "Previous visit"`, `combobox "Current visit"` | Options are dates of visits marked on this hoof |
| Stage, reduced motion only | `radiogroup "Divider position"` with `radio "Previous"`, `radio "Split"`, `radio "Current"` | |
| Readout | `status "Angle readout"` | The three readout lines from Business rules |
| Horse panel | text `Next due <date>` (status current), `Due <date>` (status due), `Overdue, was due <date>` (status overdue) or `No visits yet` (status unknown) | `<date>` is always the horse's `next_due_date` |
| Open visit | `combobox "Hoof"`, `radiogroup "Phase"` (`radio "Before"`, `radio "After"`), file input labelled `Photo file`, `button "Upload photo"`, `button "Resume upload"`, `button "Delete <hoof name> <phase> photo"` | Farrier, apprentice. "Resume upload" appears only when a session for that hoof and phase exists and the file is chosen again. A delete button sits beside each stored photo |
| Marks | `group "Hoof wall line"` and `group "Pastern line"`, each with `spinbutton "Start x"`, `spinbutton "Start y"`, `spinbutton "End x"`, `spinbutton "End y"`; `button "Mark hoof wall"`, `button "Mark pastern"`, `button "Save marks"` | Farrier, apprentice |
| Marks history | `table "Marks history"` with `button "Restore version <n>"` | Farrier, apprentice. Columns: Version, Hoof wall, Pastern, Alignment, Saved by, Saved at |
| Close | `group "Work done"` with `checkbox "Trim"`, `checkbox "Front shoes, reset"`, `checkbox "Full set, reset"`, `checkbox "Front shoes, new"`, `checkbox "Full set, new"`; `textbox "Visit note"`; `button "Close visit"` | Farrier only |
| Vet links | `button "Send vet link"` → `dialog "Send vet link"` with `textbox "Vet name"`, `textbox "Vet email"`, `button "Send link"`, `button "Cancel"`; `table "Vet links"` with Pair and Views columns, `button "Revoke link to <vet email>"`, `button "Regenerate link to <vet email>"`, `button "Views for <vet email>"` | Farrier. Pair prints `<previous date> → <current date>` |
| Link views | `table "Link views"` | Opens by "Views for <vet email>". Columns: At, Address, Outcome, Pair, User agent. Pair prints `<previous date> → <current date>` for a `viewed` row and is empty otherwise |
| Invoices | `table "Invoices"`, `button "Pay <horse> <date>"` | Status text `Pending`, `Unpaid`, `Paid`. Dunning text `Past due`, `Retry 1`, `Retry 2`, `Blocked`, `Cleared`, or empty. Reconciliation text `Matched`, `Mismatch`, `Unavailable` (farrier) |
| Visit status | text `Invoice pending`, `Invoiced`, `Billed before Clinchline` | Day sheet and visit list |
| Prices | `button "New price list"` → `dialog "New price list"` with `textbox "Effective from"`, `textbox "Deposit"`, one `textbox` per service named as in Work done, `button "Save price list"` | Farrier |
| API tokens | `table "API tokens"`, `button "New API token"` → `dialog "New API token"` with `textbox "Name"`, `combobox "Scope"` (options `Read only`, `Billing`), `button "Create token"`, `button "Revoke token <name>"` | Farrier, on Prices. One-time display copy in Feedback states |
| Dashboard | `combobox "Month"`, `table "Month totals"`, `figure "Billed and collected"`, `table "Daily figures"`, `button "Export CSV"`, `link "Download export"` | The figure holds a bar chart with a text alternative `Billed $<amount>, collected $<amount> in <YYYY-MM>.` "Daily figures" is focusable and holds Date, Billed, Collected and Refunded. "Download export" appears when the export job has finished |

### Interactions (DP-05, DP-09, DP-15, DP-22, DP-34, DP-35, DP-49, DP-51, DP-53, DP-55, DP-56, DP-59, DP-61, DP-62, DP-65, DP-72, DP-89, DP-92, DP-95, DP-97)

- **Keyboard everywhere.** Every action works with the keyboard alone. Tab order follows reading order: header, rail, day header controls, table rows, then panels. Enter or Space activates buttons. Every focusable element shows a visible focus ring: a two-pixel line in the ink colour with a gap.
- **The device clock may be wrong.** Whether something is open, due, late, lapsed or expired always comes from the server's answer. The browser renders that answer and never works it out from its own clock.
- **Booking.** The owner picks a horse in "Horse". Only that owner's horses at this barn are listed, and the first is preselected. The owner picks a card in "Card". Pressing "Book <time>" places the hold with that card. On success the "Confirm booking" dialog opens with focus on "Confirm booking". Tab and Shift+Tab cycle only inside the dialog. The hold end it shows is the server's stored value. The dialog never counts down from the device clock.
  - Enter on "Confirm booking" confirms. The dialog closes, and focus moves to the new "Cancel booking for <horse>" button in that row.
  - "Release hold" or Escape releases the hold, closes the dialog and returns focus to the "Book <time>" button that opened it.
  - If the hold has lapsed when the owner confirms, the dialog closes, focus goes to "Horse", the slot shows as open again, and Notices shows the lapsed-hold copy.
  - If the hold attempt fails because the day is full, no dialog opens. Focus moves to "Join waitlist".
  - "Join waitlist" sends the selected horse and card.
- **Offers.** An offered hold appears on the owner's day row as "Confirm offer for <horse>" after any action or refresh, so within 30 seconds at most. Notices shows the offer copy once per offer per page. The button opens "Confirm booking" with the same behaviour as above, and focus returns to it if the dialog is closed with the offer still live.
- **Cancelling.** "Cancel booking for <horse>" opens the "Cancel booking" dialog with focus on "Keep booking". The body copy comes from the server's cancellation preview, fetched when the dialog opens. Escape or "Keep booking" closes the dialog and returns focus to the opener. "Confirm cancellation" cancels and returns focus to the "Book <time>" button of the freed slot, or to "Horse" when an offer has taken the slot. If the server refuses the cancellation, the dialog closes, focus returns to the opener and the booking row is unchanged.
- **Excusing.** "Excuse <horse>" opens the "Excuse horse" dialog with focus on "Keep horse". The body states the horse's current share and, when one was captured, its deposit. Escape or "Keep horse" closes the dialog and returns focus to the opener. "Excuse horse" sends the excuse. On success the dialog closes, the row's status changes in place, the changed Share cells count to their new values, the new rows appear in "Trip share adjustments", and focus moves to the row's `link "<horse>"`. On a refusal the dialog closes, focus returns to the opener, nothing on the sheet changes, and Notices shows the refusal copy.
- **Other dialogs.** "New barn day", "Import CSV", "Send vet link", "New API token" and "New price list" follow the same rules: focus starts on the first field, Tab is trapped from the first frame, and Escape closes and returns focus to the opener. A successful save closes the dialog and returns focus to the opener, except that a refused import keeps "Import CSV" open with its errors, and a new token keeps "New API token" open with the one-time display.
- **Divider.** The "Comparison divider" slider starts at 50 when a horse opens.
  - Arrow Left or Arrow Down subtracts 1. Arrow Right or Arrow Up adds 1. Page Down subtracts 10. Page Up adds 10. Home sets 0. End sets 100. Values stay within 0 to 100.
  - Dragging the handle, or pressing and dragging anywhere on the stage, moves the divider under the pointer or finger. Clicking or tapping the stage jumps the divider to that point.
  - Choosing another hoof, previous visit or current visit sends the divider to 50 as described in Motion.
- **Marking.** "Mark hoof wall" or "Mark pastern" arms the photo. The next two clicks or taps on the after photo set the start and end point, in the stored photo's own pixel coordinates, and fill that group's four spinbuttons. Typing in the spinbuttons moves the drawn line live. "Save marks" sends both lines with the marks version the form last loaded. Escape disarms marking without changing the values. When the save is refused as stale, the spinbuttons and drawn lines switch to the marks the server returned (all empty when it returned none), the form takes their version, and focus moves to "Start x" in "Hoof wall line".
- **Restoring.** "Restore version <n>" sends the version the form last loaded. On success, the form, lines and history show the new version, and focus stays on the history table's new last row. On a stale refusal the form behaves as for a stale save.
- **Uploading.** "Upload photo" creates an upload session and sends the chosen file in chunks, updating Notices after each. If the connection fails, Notices shows the interrupted copy. When the same hoof and phase are chosen and the file is picked again, "Resume upload" continues from the server's stored offset. If the visit closes while an upload is running, the upload stops and Notices shows the closed-visit copy.
- **Deleting a photo.** "Delete <hoof name> <phase> photo" deletes at once, with no dialog. The photo and its thumbnail leave the panel, the hoof's marks and history leave too when it was the after photo, and focus moves to "Photo file".
- **URLs and history.** Choosing a rail day pushes `/days/<barn day id>`, and opening a horse pushes `/horses/<horse id>?hoof=<hoof>`. Each is a new history entry. Choosing another hoof replaces the current entry's `hoof` value and does not add an entry. Loading or reloading either URL restores the same sheet or panel with the same hoof selected. A missing or unknown `hoof` value selects Left fore. Back and Forward restore the previous or next day or horse, and the matching rail entry. Opening any app URL while signed out shows the Sign in form. After signing in, the browser is at the originally requested path and query. A return target that is not a path on this site starting with a single `/` goes to `/` instead.
- **Live rows.** An open day sheet or ready sheet follows its barn day's event stream. Rows are added, changed and removed in place, with no reload, and the stream reconnects by itself with its last event id. The farrier's "Trip share adjustments" table follows the same stream. On a reset event the sheet fetches its rows again. Focus stays on the control that holds it unless that control's row was removed, in which case focus moves to the table.
- **Live comparison.** An open horse panel follows its horse's event stream. When an event touches the selected hoof and pair, the stage fetches the pair again and redraws its lines, and the readout counts to the new values. The divider value, selected pair, selected hoof and keyboard focus stay exactly as they were. A new visit adds to the option lists without changing the selection.
- **Rail and refresh.** The rail counts, day sheet rows, Invoices rows and statuses refresh after every action the user takes, and at least every 30 seconds while the page is open. While any row on screen reads `Invoice pending` or `Pending`, that screen refreshes at least every 10 seconds. After a refresh the rail text equals the API's counts. Due status and next-due dates are fetched each time a horse or the horse list is opened. No refresh or live fetch resets the divider, closes an open dialog, clears typed text or an unsaved marks form, or replaces a message the last action just put in Notices.
- **Reconciliation notices.** The day sheet, the horse panel's visit list and the Invoices table each remember which invoices they last showed as pending. When a refresh shows one of them as invoiced, the row changes and Notices announces it once with the copy from Feedback states. The same invoice is never announced twice on the same page, even when later refreshes see it again. The apprentice's day sheet and visit list hold no invoice data: a row leaving `Invoice pending` reads `Invoiced` with no total, plays no sequence, shows no toast and announces nothing.
- **Paying.** Activating "Pay <horse> <date>" sends one payment request with the card chosen in "Card" and a fresh idempotency key, and marks the button busy and disabled until the answer arrives, so pressing it again sends nothing. The row's status text stays `Unpaid` until the server answers 201. On a refusal or outage, the row keeps its status and balance, the button re-enables and focus returns to it.
- **Read-back.** Opening or refreshing the farrier's Invoices page runs the read-back for every listed invoice and shows the result in the Reconciliation column.
- **Rate limits.** On a 429 the action's button stays focused and re-enabled, and Notices shows the 429 copy from Feedback states.
- **Input during motion.** Focus moves before an animation starts. A key press or tap during any animation acts at once.
- **Touch.** Every button, radio, checkbox and slider handle is at least 44 px in both directions. On touch screens the divider follows the finger.

### Visual design (DP-45)

- **Colour roles.** The page ground is a warm bone colour, like unbleached paper, rather than white. Text and rules are a near-black warm brown ink. Forge orange is the accent. It marks primary actions, the current visit's lines, the current side of the readout and the active rail entry. A muted steel blue marks the previous visit's lines and the previous side of the readout. Table rules and dividers are a pale tan. Errors use the ink colour with a forge-orange left bar and a text prefix, so colour is never the only cue. In "Trip share adjustments", positive changes print in ink and negative changes in ink with the minus sign, so the sign, not colour, carries the meaning.
- **Contrast.** All text meets WCAG 2.2 AA against its background (4.5:1 for body text, 3:1 for large text and for focus rings, lines and control borders).
- **Type.** Archivo, a sturdy grotesque, sets headings, the wordmark and table headers. Public Sans sets body text and controls. Times, dates, cycle weeks, angles and amounts use aligned figures of equal width, so digits line up down a column. Each heading level is a quarter larger than the level below it, and body text sits one step below the smallest heading.
- **Units and precision.** Every angle prints with one decimal and a degree sign. Every amount prints with a dollar sign and two decimals.
- **Density and composition.** The layout is compact: rows are tight and ruled top and bottom, spaced in steps of four and eight pixels. The day sheet reads like a farrier's day book laid out as a ledger: the fixed rail of dates on the left, ruled rows on the right in arrival order, followed by the waitlist and the adjustments ledger, and the comparison stage on top when a horse is open. The dashboard pairs a ruled totals table with a bar chart in the same two inks, billed in steel blue and collected in forge orange.
- **Lines on the stage.** The previous visit's lines are steel blue and dashed. The current visit's lines are forge orange and solid. Each line is at least three pixels thick, with a thin ink outline so it stays visible over light and dark hoof photos.

### Motion and effects (DP-33, DP-34, DP-35, DP-89, DP-90, DP-91, DP-92)

Two published feels are used throughout. "Settling" motion starts quickly and slows softly into its end. "Springy" motion does the same with a slight overshoot before it rests.

- **Hover and press.** Buttons and rail entries change tone over about a quarter of a second (240 ms), settling.
- **Page and panel change.** The first 6 rows and panels fade in and rise 8 pixels over 240 ms, settling, each starting 40 ms after the one before.
- **Dialogs.** A dialog grows from 96% of its size into place over about a third of a second (320 ms), springy, and closes over 240 ms, settling.
- **Keyboard steps of the divider.** Each step glides over about a quarter of a second (240 ms), settling. Pointer dragging follows the pointer with no delay.
- **Axis wipe (the signature).**
  1. The previous visit's after photo is the base layer filling the stage.
  2. The current visit's after photo sits on top, visible only to the left of a vertical divider line. At 0 the stage shows only the previous photo. At 100 it shows only the current photo. At `<n>` the left `<n>`% of the stage width shows the current photo.
  3. Both visits' lines are drawn over the whole stage at every divider position: previous dashed in steel blue, current solid in forge orange.
  4. When the user chooses a different hoof, previous visit or current visit, the divider glides, springy, from wherever it is to 50 over just under half a second (440 ms). At the same time, each readout number counts from its old value to its new one over the same 440 ms. Each number lands exactly on the stored value, and the "Angle readout" region's text is the final text from the start.
  5. Choosing the earlier pair again plays the same motion back toward 50 and counts back to the earlier values.
  6. When marks change elsewhere, the lines redraw and the numbers count to the new values over 440 ms. The divider does not move.
- **Live rows.** A new row fades in over 240 ms. A row changing position glides there over 240 ms, settling. A removed row fades over 240 ms, then its space collapses over 120 ms.
- **Numerals.** Money and angles that change on screen count over 440 ms and land on the exact value. Their accessible text is final from the start.
- **Skeletons.** A load that lasts more than 120 ms shows skeleton rows of the same height as real rows, with a shimmer crossing every 1400 ms at constant speed. They are removed when the load ends. Cumulative layout shift from skeleton to content is at most 0.02.
- **Gradient surfaces.** Every gradient uses only the palette colours:
  - the rail runs top to bottom from bone into pale tan;
  - the header strip runs left to right from bone to pale tan about three-fifths of the way across, then back to bone;
  - primary buttons run diagonally from forge orange at the top-left corner toward ink, reaching only about three-fifths of the way to ink at the far corner, with bone text;
  - the stage backing runs left to right from steel blue through ink at the centre to forge orange;
  - status chips run left to right from bone to pale tan with ink text.

  Pending and live chips show a gradient twice the chip's width sliding across it once every 2400 ms at constant speed, without end. Text and focus rings meet the Contrast rule at every frame of that movement.
- **State-change sequences.** An element playing a sequence carries `data-anim="<name>"` for exactly as long as it plays.

  | `<name>` | Where | What plays |
  |---|---|---|
  | `slot-won` | the owner's row after a confirmed booking | row flash for 240 ms, then a tick draws over 240 ms, starting 120 ms after the flash begins |
  | `payment-captured` | the Invoices row after a payment | chip swap over 240 ms, amount counts over 440 ms |
  | `invoice-reconciled` | the row that left pending | chip gradient settles over 440 ms |
  | `visit-closed` | the day sheet row after a close | a rule sweeps across the row over 440 ms |
  | `dunning-cleared` | the Invoices row whose dunning cleared | chip swap over 240 ms, then row flash for 240 ms |

  Each sequence also shows a visual toast with the same copy as Notices, for 4000 ms, pausing while the pointer rests on it or focus is on its "Dismiss notice" button. The toast's text carries `aria-hidden="true"`, so Notices stays the only live region and nothing is announced twice. Dashboard bars and totals move to their new values over 440 ms, settling, on a month change or new data.
- **No other loops.** The pending and live chips and the skeleton shimmer are the only animations that repeat. There are no other looping, idle or ambient animations anywhere.
- **Reduced motion.** When the device asks for reduced motion:
  - no animation or transition runs, so every fade, rise, glide, tone change and sequence shows its end state at once;
  - the skeleton is a still block, and gradients stay still;
  - the divider jumps straight to each new value;
  - numerals switch to their new values with no counting;
  - `data-anim` is set for no time at all, or not set;
  - toasts appear with no motion;
  - the "Divider position" radiogroup appears under the stage, and its options set the divider to 0 (Previous), 50 (Split) or 100 (Current), with the matching radio checked whenever the divider is at one of those values;
  - the arrow keys, Page Up, Page Down, Home and End still work as in Interactions;
  - all copy, labels, focus and end states are identical to the full-motion version.
- **Parity.** Every animated control works by keyboard and touch. A closed rail panel, a closed drawer and a dismissed toast are removed from the tab order and the accessibility tree at every size. Moving them off-screen does not count as closing them.

### Feedback states (DP-09, DP-10, DP-13, DP-15, DP-19, DP-22, DP-27, DP-36, DP-37, DP-39, DP-42, DP-46, DP-48, DP-49, DP-51, DP-52, DP-53, DP-54, DP-55, DP-56, DP-58, DP-59, DP-62, DP-63, DP-65, DP-66, DP-68, DP-72, DP-76, DP-80, DP-81, DP-82, DP-95, DP-97, DP-98)

Every async action shows its pending copy in `status "Notices"` within a tenth of a second and marks its button busy and disabled. It then replaces the pending copy with the success or failure copy. Field errors appear under the field, are tied to it as its description, and receive focus on the first invalid field. Placeholders:
- `$<amount>` is dollars with two decimals and thousands commas.
- `<cutoff>` is `YYYY-MM-DD HH:MM (<time zone>)`, the wall-clock time of `cancellation_cutoff_at` in the practice time zone.
- `<n>`, `<m>` and the counts in the import line are integers.
- `<hoof name>` is Left fore, Right fore, Left hind or Right hind.
- `<phase>` is before or after.
- `<a>` and `<b>` are angles with one decimal.
- `<label>` is an alignment label.
- `<status>` is a barn day status as the API prints it.
- `<name>` is a person's name.
- `<next try>` is the business date in the practice zone of the invoice's next dunning retry, and of its last one when none remain.

| Action | Pending | Success | Failure |
|---|---|---|---|
| Sign in | `Signing in…` | (the requested page loads) | 401: `Email or password is wrong.` |
| Hold slot | `Holding slot…` | dialog opens | day_full: `This barn day is full. You can join the waitlist.`; slot_taken: `That slot was just taken. Pick another time.`; not_open_for_booking: `This barn day is not taking bookings.`; horse_already_booked: `<horse> already has a booking on this day.`; card_declined: `Your card was declined. No slot was held.`; account_blocked: `Your account has an unpaid invoice. Pay it to book again.` |
| Confirm booking | `Confirming booking…` | `Booked <horse> for <time> on <date>. A confirmation email is on its way.` | hold_expired: `Your hold on <time> ran out. Pick a time again.` |
| Release hold | `Releasing hold…` | `Hold released.` | |
| Join waitlist | `Joining waitlist…` | `<horse> is on the waitlist, position <n>.` | already_on_waitlist: `<horse> is already on the waitlist.`; horse_already_booked: the copy from Hold slot; account_blocked: the copy from Hold slot; day_not_full: `This barn day has open slots. Book one instead.` |
| Waitlist offer (no user action) | | `A slot opened for <horse>. Hold ends at <hold end> (<time zone>).` | |
| Cancel dialog body | | before cutoff: `Cancelling now is before the cutoff. No trip share applies.` then, when a deposit was captured, ` Your $<amount> deposit will be refunded.`; after cutoff: `The cutoff passed at <cutoff>. <horse> will still carry a trip share.` then, when a deposit was captured, ` Your $<amount> deposit is kept and set against the trip share.` | |
| Confirm cancellation | `Cancelling booking…` | in time: `Booking cancelled. No trip share applies.`; late: `Booking cancelled. <horse> still carries a trip share for this day.` | day_started: `This day has started. Ask the farrier about this booking.` |
| Excuse dialog body | | `Excuse <horse> from this day. Its trip share of $<amount> moves to the horses not yet invoiced.` then, when a deposit was captured, ` Its $<amount> deposit will be refunded.` | |
| Excuse horse | `Excusing horse…` | `<horse> excused. Trip shares adjusted for <n> horses.`, where `<n>` counts the other bookings whose share changed | no_share_recipient: `Every other counting horse is already invoiced. Mark <horse> no-show instead.`; illegal transition: `This horse can no longer be excused.`; day_not_in_progress: `Start the day before excusing a horse.` |
| Day transitions | `Saving…` | `Day published.`, `Day started. Trip shares are fixed.`, `Day closed.`, `Day cancelled.` | unresolved_bookings: `Some horses are still open. Close each visit or mark the horse no-show before closing the day.`; illegal transition: `That change is not allowed for a <status> day.` and the header and controls refresh to the current status |
| Save draft day | `Saving…` | `Draft saved.` | 422: field errors |
| Import CSV | `Importing…` | `Import finished: <n> owners created, <n> matched, <n> horses created, <n> updated.` | import_invalid: `Nothing was imported. Fix the rows listed and try again.` and the "Import errors" table fills; idempotency_in_progress: `This import is still running.` |
| Upload photo | `Uploading photo… <n>%` | `Photo saved for <hoof name> (<phase>).` | 415: `That file is not a JPEG, PNG or HEIC photo.`; 413: `That photo is over 8,000,000 bytes.`; 503: `Photo storage is unreachable. The photo was not saved; try again shortly.`; visit_quota_exceeded: `This visit is out of photo storage: <n> bytes left.`; upload_expired: `That upload ran out of time. Start it again.`; visit_closed: `This visit is closed. Its photos can no longer change.`; network failure mid-file: `Upload interrupted at <n>%. Choose the file again to resume.` |
| Delete photo | `Deleting photo…` | `Photo deleted for <hoof name> (<phase>).` | visit_closed: the Upload photo copy |
| Save marks | `Saving marks…` | `Marks saved: hoof wall <a>°, pastern <b>°, <label>.` | 412 stale_marks: `Someone else saved marks for <hoof name> first. Their lines are now shown; check them and save again.`; photo_required: `Upload the after photo for this hoof first.`; 422: field errors |
| Restore marks | `Restoring marks…` | `Restored version <n> as version <m>.` | 412 stale_marks: the Save marks copy; visit_closed: the Upload photo copy |
| Marks saved elsewhere (no user action) | | `Marks updated by <name>: hoof wall <a>°, pastern <b>°.` | |
| Close visit | `Closing visit…` | invoiced: `Visit closed and invoiced: $<amount>.`; pending: `Visit closed — invoice pending. It will be invoiced when billing is back.` | idempotency_in_progress: `This visit is still closing. Its row will update shortly.`; illegal transition: `This visit is already closed.` |
| Invoice reaches billing (no user action) | | visit invoice: `Invoice for <horse> is now in billing: $<amount>.`; trip-only invoice: `Trip-share invoice for <horse> is now in billing: $<amount>.` | |
| Pay invoice | `Recording payment…` | `Payment of $<amount> recorded.` | already_paid: `This invoice is already paid.` and the row refreshes to `Paid`; invoice_pending: `This invoice is still pending. Try again once it shows as unpaid.`; 503: `Billing is unreachable. Your payment was not recorded; try again shortly.`; soft decline: `Payment failed: <horse> on <date>. We will try again on <next try>.`; hard decline: `Account on hold: <horse> on <date>. New bookings are on hold until this invoice is paid.`; any decline while the invoice is already blocked: `Your card was declined. This invoice is still unpaid.` |
| Send vet link | `Sending link…` | `Comparison link sent to <vet email>.` | 409: `This horse needs two closed visits before a vet link can be sent.`; 422: field errors |
| Revoke link | `Revoking…` | `Link revoked.` | |
| Regenerate link | `Sending new link…` | `New link sent to <vet email>. The old link no longer works.` | |
| Save price list | `Saving…` | `Price list saved.` | 409: `A price list already starts on that date.`; 422: field errors |
| New API token | `Saving…` | `Copy this token now. It won't be shown again.` beside the token text | 422: field errors |
| Revoke token | `Revoking…` | `Token revoked.` | |
| Export CSV | `Preparing export…` | `Export ready.` | job dead: `The export failed. It can be retried from the job list.` |
| Outstanding alert (no user action) | | `Outstanding balance over $<amount>`, shown on the farrier's next refresh | |
| Any 429 from an allowance | | | `Too many attempts. Try again in <n> seconds.` where `<n>` is the Retry-After value |
| Any request, network failure | | | `Clinchline can't reach the server. Check your connection and try again.` |
| Vet page, unknown, expired or revoked | | | `This comparison link is no longer available.` |
| Vet page, 429 | | | the 429 copy above |
| Day URL not visible to the caller | | | `This barn day isn't available.` |
| Horse URL not visible to the caller | | | `This horse isn't available.` |

The two not-available screens show no horse, owner, stall or time from the requested record.

Field error copy, which is also the text of each `errors` value in 422 bodies:
- email: `Enter a valid email address.`
- a required field: `This is required.`
- a date in the past: `Pick today or a later date.`
- amounts: `Enter an amount in dollars, like 45.00.`
- coordinates: `Keep both points inside the photo and apart from each other.`
- a start time that does not exist on that date in the practice zone: `That time does not exist on that date in <time zone>.`
- a `card_token` holding 12 or more digits in a row: `Enter a test card token, never a card number.`
- any other unknown `card_token`: `Choose one of the test cards.`
- an unknown restore version: `That version is not in this hoof's history.`
- an upload chunk of the wrong length: `Send exactly <chunk_bytes> bytes, or the rest of the file.`
- any other out-of-range number: `Enter a number from <min> to <max>.`, with the range from API.

Every success line stays true when Mailpit or Kill Bill is down: emails are queued and never claimed as delivered, a refund still pending in Kill Bill is promised ("will be refunded"), never claimed as done, and an invoice still pending is never called invoiced.

## Backend

### API (DP-01, DP-02, DP-03, DP-06, DP-07, DP-10, DP-11, DP-18, DP-19, DP-21, DP-23, DP-24, DP-29, DP-31, DP-32, DP-36, DP-37, DP-39, DP-41, DP-48, DP-51, DP-52, DP-54, DP-55, DP-56, DP-58, DP-60, DP-61, DP-62, DP-65, DP-66, DP-67, DP-68, DP-71, DP-72, DP-74, DP-78, DP-79, DP-80, DP-82, DP-88, DP-95, DP-96, DP-97, DP-98, DP-100, DP-105)

**General rules.**
- All endpoints live under `/api`, except `/healthz`, `/readyz` and signed paths under `/media/`. Request and response bodies are JSON (`application/json; charset=utf-8`), except photo upload (`multipart/form-data`), chunk upload (`application/octet-stream`), import (`text/csv`), event streams (`text/event-stream`) and photo content.
- Body limits and the error for exceeding them are owned by Server boundary. An endpoint called with another content type answers `415 {"error":"unsupported_media_type"}`.
- Every error body is `{"error":"<code>"}`, plus any extra keys named on that error. A 422 is `{"error":"validation","errors":{"<field>":"<message>"}}`, except the import error.
- Ids are opaque strings. Amounts are integer cents.
- Every timestamp is printed as `YYYY-MM-DDTHH:MM:SS±HH:MM`, using the practice-zone offset in force at that instant.

**Error precedence**, applied to every endpoint:
1. The cross-origin 403 from Server boundary, on any non-GET request.
2. The read-only 405 on vet paths (Vet links below), on any method other than GET.
3. The vet-link guess limit 429 from Business rules, on vet paths, then the address allowance 429.
4. Body shape: 413, then 415. On `POST /api/visits/{id}/photos` and when an upload session is created, a `photo_too_large` or `unsupported_image` judged from the request itself comes before the route's 409s. On `PATCH /api/uploads/{id}`, `visit_closed`, then `offset_mismatch`, then `upload_expired` come before an `unsupported_image` judged on the assembled file. Then the `sign_in` user allowance 429.
5. 401 `{"error":"unauthenticated"}` when there is no valid session or API token. Vet paths need neither and skip this step and the next.
6. 403 `{"error":"forbidden"}` when the caller's role may never call this route, or `403 {"error":"insufficient_scope"}` when an API token's scope does not cover it. This check happens before any lookup.
7. The other user allowances 429.
8. 404 `{"error":"not_found"}` when an id in the path or body is unknown or not visible to the caller, or a vet token is unknown, expired or revoked. The one exception is the hold_expired rule in Business rules.
9. 400 `{"error":"idempotency_key_required"}` on routes that need an `Idempotency-Key` header.
10. Idempotency: replay of a stored response, then `idempotency_in_progress`, then `idempotency_conflict` (Business rules).
11. 412 stale marks.
12. 409 and 410 state conflicts, ordered as stated under Illegal transitions below and on each route.
13. 422 validation.
14. 402 card declined.
15. 503 from a provider.

**Visibility (who can see which id).**
- The farrier and apprentice see everything in the practice, except that payments and invoices are the farrier's alone.
- An owner sees only their own horses, those horses' bookings, visits other than open ones, photos of those visits, and their own invoices and payments.
- An owner can read a barn day by id only when it is published, full or in progress and at a barn where they keep a horse. These are the days the owner's rail lists. Every other barn day id answers 404 to an owner. This includes draft, closed and cancelled days and any day at another barn.
- A barn manager can read a barn day by id only when it is published, full, in progress or closed and at their own barn. These are the days the barn manager's rail lists. Every other barn day id answers 404 to a barn manager.

**Session.** `POST /api/session` `{"email","password"}` answers `200 {"user":{"id","name","email","role"}}` and sets an HttpOnly, SameSite=Lax session cookie. Role is `farrier`, `apprentice`, `owner` or `barn_manager`. Wrong credentials answer `401 {"error":"invalid_credentials"}`. `DELETE /api/session` answers 204. `GET /api/me` answers `200 {"id","name","email","role"}`.

**Practice and barns.**
- `GET /api/practice` (any signed-in role) answers `200 {"name","time_zone","today"}`, where `today` is the business date in the practice time zone.
- `GET /api/barns` (farrier, apprentice) answers `200 [{"id","name","trip_fee_cents"}]`.

**Objects.**
- **Horse:** `{"id","name","barn":{"id","name"},"stall","cycle_weeks","last_worked_date","next_due_date","due_status"}`. Dates are `YYYY-MM-DD` or null. `due_status` is `current`, `due`, `overdue` or `unknown`. For the farrier only, the horse also carries `"owner":{"id","name","email","phone"}`.
- **Barn day:** `{"id","barn":{"id","name"},"business_date","start_time","time_zone","starts_at","cancellation_cutoff_at","slot_count","slot_minutes","booked_count","trip_fee_cents","status","slots":[{"id","time","state","my_booking_id"}]}`.
  - `status` is `draft`, `published`, `full`, `in_progress`, `closed` or `cancelled`.
  - `state` is `open` or `taken`.
  - `booked_count` is the number of the day's slots taken by a live booking (Business rules), so it always equals the number of slots whose `state` is `taken`.
  - `my_booking_id` is the caller's own live booking on that slot or null.
  - Barn managers receive the same object without `trip_fee_cents` and without `my_booking_id`.
- **Booking:** `{"id","number","status","barn_day_id","slot_id","slot_time","horse":{"id","name"},"hold_expires_at","trip_share_cents","offer","deposit_cents","payment_id"}`. `status` is `held`, `confirmed`, `cancelled_in_time`, `cancelled_late`, `worked`, `no_show` or `excused`. `hold_expires_at` is set only while held. `trip_share_cents` is the booking's current share, null until the day starts. `offer` is true for a hold made by a waitlist offer. `payment_id` is null when the deposit is 0.
- **Photo:** `{"id","visit_id","hoof","phase","content_type","width","height","url","url_expires_at","thumbnail_status","thumbnail_url"}`. `hoof` is `LF`, `RF`, `LH` or `RH`. `phase` is `before` or `after`. `url` is a signed path (Photo URLs in Business rules). `thumbnail_status` is `pending`, `ready` or `failed`. `thumbnail_url` is a signed path, or null unless ready.
- **Hoof marks:** `{"hoof","version","hoof_wall":{"x1","y1","x2","y2","angle"},"pastern":{"x1","y1","x2","y2","angle"},"alignment"}`. Coordinates are stored-photo pixels. Angles are numbers with one decimal. `version` is an integer. For the farrier and apprentice it also carries `"saved_by":{"id","name","role"},"saved_at","restored_from"`, where `restored_from` is a version or null.
- **Invoice:** `{"id","kind","status","horse":{"id","name"},"business_date","items":[{"description","amount_cents"}],"total_cents","balance_cents","killbill_invoice_id","dunning_state","reconciliation"}`. `kind` is `visit` or `trip`. `status` is `pending`, `unpaid` or `paid`. `killbill_invoice_id` is null while pending. `dunning_state` is `none`, `past_due`, `retry_1`, `retry_2`, `blocked` or `cleared`. `reconciliation` is `unchecked`, `matched`, `mismatch` or `unavailable`.
- **Visit:** `{"id","status","horse":{"id","name"},"booking_id","business_date","note","photos":[Photo],"marks":[Hoof marks],"invoice":Invoice|null}`. `status` is `open`, `closed`, `invoice_pending` or `invoiced`. `invoice` is the visit's invoice or null. The apprentice receives the same keys with `invoice` always null, on every route that returns a Visit.
- **Payment:** `{"id","kind","status","amount_cents","captured_cents","refunded_cents","applied_cents","disposition","booking_id","invoice_id","card_last4","decline_code","killbill_status"}`. `kind` is `deposit` or `invoice`. `status` is `authorized`, `captured`, `partially_refunded`, `refunded`, `voided` or `declined`. `disposition` is `held`, `forfeited`, `applied` or null. `killbill_status` is `not_recorded`, `pending` or `recorded`.
- **Job:** `{"id","kind","status","attempts","max_attempts","run_at","last_error","result"}`. `kind` is `thumbnail`, `dunning_retry`, `due_reminder`, `offer_pass` or `csv_export`. `status` is `queued`, `running`, `succeeded` or `dead`. A `due_reminder` job's `result` is `{"horse_id","next_due_date"}` from the moment it is queued.
- **Allocation:** `{"barn_day_id","trip_fee_cents","shares":[{"booking_id","number","horse":{"id","name"},"status","initial_cents","share_cents"}],"adjustments":[{"seq","booking_id","number","delta_cents","cause_booking_id","at"}]}`. `shares` is in ascending `number` and `adjustments` in ascending `seq`. `initial_cents` is the share fixed at start, and `share_cents` the current share. An excused booking stays in `shares` with status `excused` and `share_cents` 0.

**Price lists (farrier only; others 403).**
- `GET /api/price-lists` answers `200 [{"id","effective_from","deposit_cents","prices":{"trim","front_reset","full_reset","front_new","full_new"}}]`, newest first.
- `POST /api/price-lists` `{"effective_from":"YYYY-MM-DD","deposit_cents","prices":{…all five codes, positive integer cents…}}` answers `201` with the list. `deposit_cents` is 0 to 100000 inclusive. Errors: `409 {"error":"price_list_exists"}`, 422.

**Horses.**
- `GET /api/horses` (farrier, apprentice: all; owner: own; barn manager: 403) answers `200 [Horse]`. A barn manager's role list leaves out every horse, visit, photo, comparison, invoice and payment route, list or id (including `GET /api/invoices` and `GET /api/payments`), so each answers them `403 {"error":"forbidden"}` by step 6 before any lookup; for a barn manager, DP-31's 404 for an id outside their reach applies on the barn-day routes their role may call.
- `GET /api/horses/{id}` answers `200 Horse`.
- `GET /api/horses/{id}/visits` answers `200 [Visit]`, newest first. Owners do not see open visits.
- `GET /api/horses/{id}/events` (farrier, apprentice, the owner of that horse) is an event stream (Live streams in Business rules).

**Imports.** `POST /api/imports` (farrier), `Content-Type: text/csv`, needs an `Idempotency-Key` header. Answers `201 {"id","created_owners","matched_owners","created_horses","updated_horses","rows"}`. A refused file answers `422 {"error":"import_invalid","errors":[{"line","column","code"}]}`, sorted by line, then by the column's position in the published header, with every failing cell on a row reported as its own error, with nothing written.

**Barn days.**
- `GET /api/barn-days` answers `200 [Barn day]` for the days the caller's rail lists (Screens and layout).
- `GET /api/barn-days/{id}` answers `200 Barn day`.
- `POST /api/barn-days` (farrier) `{"barn_id","business_date":"YYYY-MM-DD","start_time":"HH:MM","slot_count","slot_minutes","trip_fee_cents"?}` answers `201` with a draft. `trip_fee_cents` defaults to the barn's fee. Ranges:
  - `slot_count` 1 to 12 inclusive;
  - `slot_minutes` 15 to 120 inclusive;
  - `trip_fee_cents` 0 to 100000 inclusive;
  - `business_date` on or after practice `today`;
  - `start_time` must exist on `business_date` in the practice zone (Business rules, Practice time).

  Errors: 422.
- `PATCH /api/barn-days/{id}` (farrier) takes the same fields, draft only, with the same validation. Answers 200, or the illegal-transition 409.
- `POST /api/barn-days/{id}/publish`, `/start`, `/close` and `/cancel` (farrier) answer `200 Barn day`. Rejections are in Business rules.
- `GET /api/barn-days/{id}/bookings` (farrier, apprentice, barn manager; owner 403) answers `200 [row]` in slot order, with exactly these keys per role:
  - farrier: `booking_id, number, slot_time, horse_id, horse_name, stall, status, owner_name, owner_email, owner_phone, trip_share_cents, visit_id, visit_status, invoice_status, invoice_total_cents`
  - apprentice: `booking_id, slot_time, horse_id, horse_name, stall, status, visit_id, visit_status`
  - barn manager: `slot_time, horse_name, stall`, listing only bookings that are confirmed, worked or no-show.

  Farrier and apprentice rows cover every booking except held ones. `stall` is always the horse's current stall. `visit_id` and `visit_status` are null when the booking has no visit. `invoice_status` (`pending`, `unpaid` or `paid`) and `invoice_total_cents` describe the booking's visit invoice, or on a `cancelled_late` or `no_show` row its trip-only invoice, and both are null while no such invoice exists.
- `GET /api/barn-days/{id}/allocation` (farrier) answers `200 Allocation`. Before the day starts it answers `409 {"error":"not_started"}`.
- `GET /api/barn-days/{id}/waitlist` (farrier) answers `200 [{"id","position","horse":{"id","name"},"joined_at"}]` in ascending `position`.
- `GET /api/barn-days/{id}/events` (farrier, apprentice, barn manager; owner 403) is an event stream.

**Bookings.**
- `POST /api/barn-days/{id}/bookings` (owner) `{"slot_id","horse_id","card_token"}` answers `201 Booking` with status `held`. `card_token` is required when the deposit is above 0. Errors, in this order:
  - `409 {"error":"account_blocked"}`;
  - `409 {"error":"horse_already_booked"}`;
  - `409 {"error":"not_open_for_booking"}`;
  - `409 {"error":"day_full"}`;
  - `409 {"error":"slot_taken"}`;
  - `422` when the horse is not at that barn (`errors.horse_id`), or for `card_token`;
  - `402 {"error":"card_declined","decline_code"}`.
- `POST /api/bookings/{id}/confirm` (owner) answers `200 Booking`. Error: `409 {"error":"hold_expired"}`.
- `DELETE /api/bookings/{id}` (owner) releases a hold and answers 204.
- `GET /api/bookings/{id}/cancellation-preview` (owner, farrier) answers `200 {"late":true|false,"cutoff_at","deposit_cents","deposit_outcome":"refund"|"keep"|"none"}`. `deposit_outcome` is `none` when no deposit was captured.
- `POST /api/bookings/{id}/cancel` (owner, farrier) answers `200 {"booking":Booking,"trip_share_applies":true|false,"decided_at","deposit_outcome":"refund"|"keep"|"none","refunded_cents"}`. `trip_share_applies` is true exactly when the resulting status is `cancelled_late`. `refunded_cents` is the captured amount when `deposit_outcome` is `refund`, and 0 otherwise. Error: `409 {"error":"day_started"}`.
- `POST /api/bookings/{id}/excuse` (farrier; apprentice, owner and barn manager 403) takes an empty JSON object and answers `200 {"booking":Booking,"allocation":Allocation}`. Errors, in this order: the illegal-transition 409, `409 {"error":"day_not_in_progress"}`, `409 {"error":"no_share_recipient"}`.
- `GET /api/my/bookings` (owner) answers `200 [Booking]`.
- `POST /api/barn-days/{id}/waitlist` (owner) `{"horse_id","card_token"}` answers `201 {"id","position","horse":{"id","name"}}`. Errors, in this order: `409 {"error":"account_blocked"}`, `409 {"error":"horse_already_booked"}`, `409 {"error":"already_on_waitlist"}`, `409 {"error":"day_not_full"}`; `422` when the horse is not at that barn (`errors.horse_id`), or for `card_token`.

**Cards.** `PUT /api/my/card` (owner) `{"card_token"}` answers `200 {"last4"}`. Error: 422.

**Payments.**
- `GET /api/payments?booking_id=&invoice_id=` (owner: own; farrier: all) answers `200 [Payment]`. Both filters are optional.
- `GET /api/payments/{id}` answers `200 Payment`.
- `POST /api/payments/{id}/capture` and `POST /api/payments/{id}/void` (farrier) take an empty JSON object and answer `200 Payment`.
- `POST /api/payments/{id}/refund` (farrier) `{"amount_cents"}`, a positive integer, answers `200 Payment`. Error: `409 {"error":"refund_exceeds_captured","refundable_cents":<n>}`.

All three POSTs need an `Idempotency-Key` header.

**Reconciliation.** `GET /api/invoices/{id}/reconciliation` and `GET /api/payments/{id}/reconciliation` (farrier) answer `200 {"status":"matched"|"mismatch"|"unavailable","app":{"total","paid","refunded","balance"},"killbill":{"total","paid","refunded","balance"}|null,"differences":[{"field","app_cents","killbill_cents"}]}`. Every value inside `app` and `killbill` is integer cents. `field` is `total`, `paid`, `refunded` or `balance`.

**Visits and photos.**
- `POST /api/bookings/{id}/visit` (farrier) answers `201 Visit` (open). Error: `409 {"error":"day_not_in_progress"}`.
- `POST /api/bookings/{id}/no-show` (farrier) answers `200 Booking`.
- `GET /api/visits/{id}` answers `200 Visit`.
- `POST /api/visits/{id}/photos` (farrier, apprentice) takes multipart fields `hoof`, `phase` and `file`, and answers `201 Photo`. Errors:
  - `409 {"error":"visit_closed"}`;
  - `409 {"error":"photo_exists"}` when that hoof and phase already has a photo;
  - `409 {"error":"visit_quota_exceeded","remaining_bytes":<n>}`;
  - `413 {"error":"photo_too_large"}`;
  - `415 {"error":"unsupported_image"}`;
  - `422` for a bad `hoof` or `phase`;
  - `503 {"error":"storage_unavailable"}`.
- `POST /api/visits/{id}/uploads` (farrier, apprentice) `{"hoof","phase","size_bytes"}` answers `201 {"id","chunk_bytes","offset":0,"expires_at"}`. Errors: the same `visit_closed`, `photo_exists`, `visit_quota_exceeded`, `photo_too_large` and 422.
- `GET /api/visits/{id}/uploads` (farrier, apprentice) answers `200 [{"id","hoof","phase","size_bytes","chunk_bytes","offset","expires_at"}]` for the visit's live sessions.
- `GET /api/uploads/{id}` (farrier, apprentice) answers `200` with one such object.
- `PATCH /api/uploads/{id}` (farrier, apprentice), `Content-Type: application/octet-stream`, `Upload-Offset: <n>`, answers `200 {"offset"}` while bytes remain, and `201 Photo` on the last chunk. Errors:
  - `409 {"error":"visit_closed"}`, also on GET and DELETE of a session the close ended, and ahead of every other session error;
  - `409 {"error":"offset_mismatch","offset":<stored>}`;
  - `410 {"error":"upload_expired"}`, also on GET;
  - `415 {"error":"unsupported_image"}`;
  - `422` with `errors.chunk` for a wrong chunk length;
  - `503 {"error":"storage_unavailable"}`.
- `DELETE /api/uploads/{id}` (farrier, apprentice) answers 204 and removes the chunks.
- `GET /api/photos/{id}` answers `200 Photo` with a fresh signed `url`. A deleted photo answers 404.
- `DELETE /api/photos/{id}` (farrier, apprentice) answers 204. Error: `409 {"error":"visit_closed"}`. Deleting an after photo also deletes that hoof's marks and history.
- `GET <url>` (the signed path) returns the stored image bytes with its image content type. An expired, altered or wrongly keyed signature, or a vet photo path that no longer verifies (Vet links in Business rules), answers `403 {"error":"url_invalid"}`. A correctly signed path for a deleted photo answers `404 {"error":"not_found"}`.
- `PUT /api/visits/{id}/hooves/{hoof}/marks` (farrier, apprentice) `{"version":<integer>|null,"hoof_wall":{"x1","y1","x2","y2"},"pastern":{"x1","y1","x2","y2"}}` answers `200 Hoof marks`. A body without `version` counts as `null`. Errors:
  - `412 {"error":"stale_marks","current":Hoof marks|null}`, where `current` is the hoof's stored marks at the moment of refusal;
  - `409 {"error":"visit_closed"}`;
  - `409 {"error":"photo_required"}`;
  - 422.
- `GET /api/visits/{id}/hooves/{hoof}/marks/history` (farrier, apprentice; owner and barn manager 403) answers `200 [{"version","hoof_wall","pastern","alignment","saved_by":{"id","name","role"},"saved_at","restored_from"}]` in ascending `version`.
- `POST /api/visits/{id}/hooves/{hoof}/marks/restore` (farrier, apprentice; owner and barn manager 403) `{"version":<current>,"restore_version":<n>}` answers `200 Hoof marks` with version current + 1, `restored_from` n, and `saved_by` the restorer. Errors: the same 412 `stale_marks`, `409 {"error":"visit_closed"}`, and 422 `errors.restore_version` for a version not in the history.
- `POST /api/visits/{id}/close` (farrier) needs an `Idempotency-Key` header. Body `{"work":["trim",…],"note":"…"}`: at least one distinct code from the five, and a note of at most 500 characters. Answers `200 Visit` with status `invoiced` or `invoice_pending`. Errors: `409 {"error":"idempotency_in_progress"}`, `409 {"error":"idempotency_conflict"}`, `409 {"error":"photos_required"}` when the visit has no after photo, the illegal-transition 409, 422.

**Comparison.** `GET /api/horses/{id}/comparison?hoof=<LF|RF|LH|RH>&previous=<visit id>&current=<visit id>` (farrier, apprentice, owner) answers `200`:

```
{"horse":{"id","name"},"hoof",
 "previous":{"visit_id","business_date","photo":Photo,"hoof_wall":{…,"angle"},"pastern":{…,"angle"},"alignment"},
 "current":{…same…},
 "difference":{"hoof_wall","pastern"},
 "readout":["<line 1>","<line 2>","<line 3>"],
 "marked_visits":[{"visit_id","business_date"}]}
```

`previous` and `current` are optional and default to the two most recent visits marked on that hoof. For an owner, open visits never count. Errors:
- `409 {"error":"not_enough_marked_visits"}` when fewer than two such visits exist;
- `422` when `previous` is not earlier than `current` or either visit has no marks on that hoof.

**Vet links (farrier, except the vet read).**
- `POST /api/horses/{id}/vet-links` `{"vet_name","vet_email"}` answers `201 {"id","url","expires_at","previous_visit_id","current_visit_id"}`, the visit ids being the live pair at that moment. Error: `409 {"error":"not_enough_visits"}`.
- `GET /api/horses/{id}/vet-links` answers `200 [{"id","vet_name","vet_email","status","expires_at","view_count","previous_date","current_date"}]`. `status` is `active`, `revoked` or `expired`. `previous_date` and `current_date` are the live pair's business dates at the moment of the read. The list never includes the token.
- `POST /api/vet-links/{id}/revoke` answers `200` with the list entry.
- `POST /api/vet-links/{id}/regenerate` answers `200 {"id","url","expires_at","previous_visit_id","current_visit_id"}`.
- `GET /api/vet-links/{id}/views` answers `200 [{"at","address","outcome":"viewed"|"expired"|"revoked","user_agent","previous_date","current_date"}]`, newest first. The two dates are the pair served for a `viewed` row and null otherwise.
- `GET /api/vet/{token}` (no session needed) answers `200 {"horse":{"name"},"previous_date","current_date","expires_at","hooves":{"LF":Comparison|null,"RF":…,"LH":…,"RH":…}}`. Each non-null hoof entry has exactly these keys:

```
{"hoof",
 "previous":{"business_date","photo":{"hoof","phase","content_type","width","height","url","url_expires_at"},
             "hoof_wall":{"x1","y1","x2","y2","angle"},"pastern":{"x1","y1","x2","y2","angle"},"alignment"},
 "current":{…same keys as previous…},
 "difference":{"hoof_wall","pastern"},
 "readout":["<line 1>","<line 2>","<line 3>"]}
```

It carries no `horse` id, `visit_id`, photo `id`, photo `visit_id`, marks `version` or `marked_visits`. A hoof is null when either visit of the live pair lacks marks on that hoof. An unknown, expired or revoked token answers `404 {"error":"not_found"}`. Any method other than GET on `/api/vet/{token}` or a path under it answers `405 {"error":"read_only"}`. When the guess limit applies, any GET under `/api/vet/` answers exactly `429 {"error":"rate_limited"}` with a `Retry-After` header.

**Invoices.**
- `GET /api/invoices` (owner: own; farrier: all) answers `200 [Invoice]`. Deposit invoices are never listed.
- `POST /api/invoices/{id}/payments` (owner) needs an `Idempotency-Key` header and `{"card_token"}`. Answers `201 Invoice` with status `paid`. Errors: `409 {"error":"idempotency_in_progress"}`, `409 {"error":"idempotency_conflict"}`, `409 {"error":"invoice_pending"}`, `409 {"error":"already_paid"}`, 422, `402 {"error":"card_declined","decline_code"}`, `503 {"error":"billing_unavailable"}`.

**Dashboard.**
- `GET /api/dashboard?month=YYYY-MM` (farrier) answers `200 {"month","billed_cents","collected_cents","refunded_cents","outstanding_cents","overdue_horses","rows":[{"date","billed_cents","collected_cents","refunded_cents"}]}`. `month` defaults to the practice's current month. `rows` holds one row per date with an entry, ascending. A malformed month answers 422 on `month`.
- `POST /api/dashboard/exports` (farrier) `{"month"}` answers `202 {"job_id"}`.

**Jobs (farrier, session only).**
- `GET /api/jobs/{id}` answers `200 Job`.
- `GET /api/jobs?status=&kind=` answers `200 [Job]`, newest first, at most 200; `status` and `kind` are optional filters.
- `POST /api/jobs/{id}/retry` answers `200 Job`. Only a `dead` job can be retried.

**API tokens (farrier, session only).**
- `POST /api/tokens` `{"name","scope":"read_only"|"billing"}` answers `201 {"id","name","scope","token","created_at"}`. `name` is 1 to 80 characters. `token` is `cl_` followed by at least 32 URL-safe random bytes and is shown only in this response.
- `GET /api/tokens` answers `200 [{"id","name","scope","created_at"}]`.
- `DELETE /api/tokens/{id}` answers 204.

**Audit.** `GET /api/audit?entity_type=&entity_id=&limit=` (farrier, session only) answers `200 [{"id","at","actor":{"type","id"},"action","entity_type","entity_id","from","to","request_id"}]`, newest first. `limit` is 1 to 500 and defaults to 100.
- `actor.type` is `user`, `token` or `system`. A token's actor is `{"type":"token","id":"<token id>"}`, which stands for `token:<id>`. `system` has a null `id`.
- `entity_type` is `barn_day`, `booking`, `visit`, `invoice`, `payment`, `vet_link`, `price_list`, `api_token`, `import` or `dunning`. A `dunning` entry's `entity_id` is the invoice id.

**Illegal transitions** on any day, booking, visit, payment or job action answer `409 {"error":"illegal_transition","from":"<current status>","action":"<action>"}`. `<current status>` is the acted-on record's `status` exactly as the API prints it at the moment of refusal. `<action>` is fixed per route:
- `PATCH /api/barn-days/{id}`: `edit`; `POST /api/barn-days/{id}/publish`: `publish`; `/start`: `start`; `/close`: `close`; `/cancel`: `cancel`;
- `POST /api/bookings/{id}/confirm`: `confirm`; `DELETE /api/bookings/{id}`: `release`; `POST /api/bookings/{id}/cancel`: `cancel`; `POST /api/bookings/{id}/visit`: `open_visit`; `POST /api/bookings/{id}/no-show`: `no_show`; `POST /api/bookings/{id}/excuse`: `excuse`;
- `POST /api/visits/{id}/close`: `close`;
- `POST /api/payments/{id}/capture`: `capture`; `/void`: `void`; `/refund`: `refund`;
- `POST /api/jobs/{id}/retry`: `retry`.

When the record's own status makes the action illegal, this 409 comes before that action's guard 409s in Business rules.

### Business rules (DP-02, DP-03, DP-04, DP-07, DP-10, DP-13, DP-16, DP-17, DP-18, DP-19, DP-20, DP-21, DP-23, DP-24, DP-26, DP-27, DP-28, DP-29, DP-30, DP-31, DP-37, DP-39, DP-46, DP-47, DP-48, DP-50, DP-51, DP-52, DP-54, DP-55, DP-56, DP-57, DP-58, DP-59, DP-60, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-67, DP-68, DP-69, DP-70, DP-71, DP-72, DP-73, DP-74, DP-75, DP-76, DP-77, DP-78, DP-79, DP-80, DP-81, DP-82, DP-83, DP-88, DP-93, DP-94, DP-95, DP-96, DP-97, DP-98, DP-99, DP-100, DP-101, DP-102, DP-103, DP-105, DP-106, DP-107)

**Instances and the clock.** Every instance applies the same defaults unless its environment lists a change. Every time rule reads the current instant as the instance's clock plus `CLOCK_OFFSET_SECONDS` (default 0), including the rules that run inside the database. A duration is fixed by the instance that stamps it (`hold_expires_at`, `run_at`, `lease_expires_at`, `first_declined_at` and the retry instants stamped with it, a cancellation's `decided_at`), and every other instance honours the stored value. An allowance's capacity and refill come from the environment of the instance handling the request, while its tokens live in one shared Postgres row.

**Practice time.** The practice time zone is the seeded IANA zone. Wherever copy or email prints `<time zone>`, it is that zone's IANA name exactly as `time_zone` from `GET /api/practice` (for example, with the seed data at start, `America/Denver`), never an abbreviation such as MDT or an offset. Each barn day stores its business date and its start as wall-clock time in that zone:
- `starts_at` is the instant at which the practice zone's clock reads `business_date start_time`.
- A `start_time` that never occurs on that date in the practice zone, because the clocks jump forward past it, is refused on create and edit with 422 on `start_time`.
- A `start_time` that occurs twice on that date, because the clocks fall back over it, means its earlier occurrence.
- `cancellation_cutoff_at` is exactly 24 elapsed hours before `starts_at`. It is not "the day before at the same clock time": when a clock change falls between the two, the cutoff's clock time differs from the start's by an hour.
- "Today" is the current date in the practice zone.

The browser's zone and the server's clock zone never change any of these. For example, in `America/Denver`:

| Day | `starts_at` | `cancellation_cutoff_at` | Header |
|---|---|---|---|
| `2027-03-14` at `07:30` | `2027-03-14T07:30:00-06:00` | `2027-03-13T06:30:00-07:00` | `Cancel by 2027-03-13 06:30 (America/Denver)` |
| `2027-11-07` at `01:30` | `2027-11-07T01:30:00-06:00` (earlier occurrence) | `2027-11-06T01:30:00-06:00` | `Cancel by 2027-11-06 01:30 (America/Denver)` |
| `2027-11-07` at `07:30` | `2027-11-07T07:30:00-07:00` | `2027-11-06T08:30:00-06:00` | `Cancel by 2027-11-06 08:30 (America/Denver)` |
| `2027-03-14` at `02:30` | refused with 422 on `start_time` | | |

**Barn day states.** The stored status is `draft`, `published`, `in_progress`, `closed` or `cancelled`. The API reads a published day as `full` exactly when `booked_count` equals `slot_count`, judged at the moment of the read.

| From | Action | To | Guard and rejection |
|---|---|---|---|
| draft | publish | published | Business date before today: `409 {"error":"date_passed"}` |
| published | (every slot taken by a live booking) | full | derived on every read |
| full | (a slot frees by release, hold lapse or cancellation) | published | derived on every read |
| published, full | start | in_progress | Business date after today: `409 {"error":"too_early"}` |
| in_progress | close | closed | Any booking still confirmed, or any visit still open: `409 {"error":"unresolved_bookings"}` |
| draft, published, full | cancel | cancelled | |

Every other action answers the illegal-transition 409. Draft days are editable. Cancelling a day removes its holds, makes each confirmed booking `cancelled_in_time`, and settles deposits as in Deposits below.

**Bookings.**
- **Live booking.** A booking is live while it is held (not lapsed), confirmed, worked or no-show. Cancelled and excused bookings, and released, lapsed or removed holds, are not live.
- **Booking number.** Each successful hold, including a hold made by a waitlist offer, gets the next integer in one practice-wide sequence. Only successful holds take numbers, so the numbers of successful holds are consecutive with no gaps, also under simultaneous holds on one or several days. A number stays with its booking after release or lapse. "Ascending booking order" means ascending booking number.
- **Refused claims leave no trace.** A hold refused with any 409 or 422 takes no booking number, authorises no card, and writes no payment row, audit entry, stream event or email. A hold refused with the 402 decline takes no number and writes only its one `declined` payment row with that row's audit entry, and records the submitted token as the card on file.
  - **What counts as the claim's own writes.** Before a hold is judged, the same request may first record a hold lapse that no request or job has yet recorded (Audit log) and run the offer pass (Waitlist). Those writes belong to the lapse and to the offer, not to the claim. They include the lapse's two `system` audit entries, the offer's booking number, deposit authorisation, payment row, audit entries and stream events, and the offer email. They stay in place even when the claim is then refused. This rule counts only the writes the claim itself would make.
  - The consecutive booking numbers cover every successful hold, offers included. For example, a stranger refused with `day_full` just after a lapse leaves behind only the lapse record and position 1's offer, and that offer holds the next number.
- **Who can book.** A horse can have at most one live booking per day (`horse_already_booked`). Holds are accepted only while the stored status is published and the current instant is before `starts_at`. Otherwise the hold answers `not_open_for_booking`, or `day_full` when the day reads full. An owner with a blocked invoice answers `account_blocked` (Dunning).
- **Holds.** `hold_expires_at` is the hold instant plus `BOOKING_HOLD_SECONDS` seconds (default 300), rounded up to the whole second. It is fixed and stored when the hold is made. A hold is lapsed at and after that instant, on every read and every write, whether or not any background job has run. From that instant:
  - its slot reads `open`, unless an offer has taken it;
  - `booked_count` no longer counts it;
  - a day it had made full reads `published`, unless an offer has filled it again;
  - another owner's hold on the slot succeeds, subject to the waitlist;
  - its deposit payment reads `voided`;
  - it never counts toward a trip split.
- **Gone holds.** A released, lapsed or removed hold leaves no booking in any list. Confirming the caller's own hold that lapsed, or that a day start or day cancellation removed, answers `409 {"error":"hold_expired"}`. Every other request naming a released, lapsed or removed hold, including `DELETE`, answers 404.
- **Confirming.** Confirming a confirmed booking answers 200 with no change and no email.
- **Cancelling.** A cancellation stores one decision instant, `decided_at`, the current instant when it commits. The booking is `cancelled_late` exactly when `decided_at` is at or after `cancellation_cutoff_at`, and `cancelled_in_time` otherwise. The deposit outcome, the refunded amount and the refund ledger entry's instant all come from that same `decided_at`.
- **In-time cancellation reverses the deposit.** An in-time cancellation of a booking with a captured deposit refunds it in full before answering. When Kill Bill is reachable, the refund is recorded there before the response, so the payment answers `killbill_status` `recorded` at once; otherwise it follows Billing outage. It adds one `refund` ledger entry and leaves the `deposit_captured` entry untouched. It writes one audit entry for the booking and one for the payment. It runs the offer pass in the same transaction, so the response already finds the first eligible waitlisted horse holding the freed slot.

| From | Action | To | Guard |
|---|---|---|---|
| (none) | hold | held | see above |
| held | confirm | confirmed | At or after `hold_expires_at`: hold_expired 409 |
| held | release | (removed) | |
| confirmed | cancel with `decided_at` before `cancellation_cutoff_at` | cancelled_in_time | Day in progress or later: day_started 409 |
| confirmed | cancel with `decided_at` at or after `cancellation_cutoff_at` | cancelled_late | same |
| confirmed | open visit | worked | Day must be in progress: day_not_in_progress 409 |
| confirmed | no-show | no_show | Day must be in progress: day_not_in_progress 409 |
| confirmed | excuse (farrier) | excused | Day must be in progress: day_not_in_progress 409; then no_share_recipient 409 (Excusing a horse) |

Every other action answers the illegal-transition 409. The cancellation preview uses the same cutoff test at the moment it is asked.

**One barn day at a time.** Every change to a barn day and its bookings is serialised in Postgres on that barn day: holds, releases, confirmations, cancellations, excusals, waitlist joins, offers, start, close, cancel, the trip-share read inside a visit close, and any import that changes the stall of a horse with a booking on the day. The outcomes are as follows.
- **Last open slot.** Of several simultaneous holds on one day, as many succeed as there are open slots, and no slot ever has two live bookings. When the claims that lose find no open slot left, they answer `day_full`. When they lose a slot while other slots are still open, they answer `slot_taken`. No rejection body names the winning horse or owner.
- **Counts.** At every moment `booked_count` equals the number of slots with a live booking, and the day reads full exactly when that number equals `slot_count`.
- **Start races.** Of several simultaneous starts, on one or several instances, exactly one answers 200. The others answer the illegal-transition 409 with `from` `in_progress`. Exactly one set of shares is stored.
  - A cancellation racing the start either completes first, as `cancelled_in_time` with no share or `cancelled_late` with a share, or answers `day_started` and stays `confirmed`, in which case it counts toward the split.
  - A hold racing the start either answers `not_open_for_booking`, or is made first and then removed by the start, with its deposit voided.
  - No held booking ever exists on an in-progress day.
  - The cancellation email and the deposit outcome always match the booking's final status.
- **Excuse against close.** An excuse, a visit close and a day close on one day never interleave. A close that commits first bills the share as it stood. An excuse that commits first changes the share the close then bills. A visit invoice's trip item always equals that booking's `share_cents` at the moment the close committed.

**Waitlist.**
- An owner may join the waitlist only while the day reads full. Joining books nothing, charges nothing, and stores the join's `card_token` as the owner's card on file.
- Positions are always the contiguous integers 1 to n in join order, including when joins arrive simultaneously.
- **Offer pass.** When a slot is free on a day whose stored status is published, before `starts_at`, the lowest-position horse whose owner is not blocked gets a `held` booking on the earliest open slot, with `offer` true and `hold_expires_at` set to the current instant plus `WAITLIST_OFFER_SECONDS` seconds (default 900). Its entry leaves the waitlist and the positions behind it close up. When the deposit is above 0, the offer authorises it on the owner's card on file. The pass repeats until no slot is free or nobody eligible waits.
- **A decline** removes that entry and moves on to the next position. The removed owner gets the offer-lapsed email.
- **No job needed.** Before answering any request that reads or changes a barn day, the server runs the offer pass under the day's serialisation whenever a slot is free and the waitlist is not empty. So a stranger's hold just after a lapse cannot beat position 1: it answers `day_full` or `slot_taken`. A background job also runs the pass every 5 seconds, so a day nobody reads still sends its offer email.
- **A lapsed or released offer** frees the slot for the next position in the same way. A horse whose offer lapsed does not come back onto the waitlist. An offer otherwise behaves as a hold.
- A waitlisted horse that gets a live booking on that day by any route leaves the waitlist, and the positions behind it close up.

**Trip-fee split.**
- When the day starts, the open holds are removed. The counting horses are fixed as every booking that is confirmed or `cancelled_late` at the moment the start takes effect. Confirmed bookings stay counting when they later become worked or no-show. An excused booking stops counting.
- Each counting horse's exact share is fee ÷ count. Each horse gets the whole-cent floor of that share.
- The leftover cents go one each to the horses with the largest fractional remainder. Shares are equal, so every remainder ties, and ties go to the lower booking number first.
- The shares fixed at start are each booking's `initial_cents`. They are never recomputed: they change only through appended adjustments (Excusing a horse). At every moment each share equals its `initial_cents` plus the sum of its adjustments' `delta_cents`, and the shares add up exactly to the fee. With no counting horses there are no shares.

For example, 4500 cents across 7 horses gives 643 cents to the six lowest booking numbers and 642 to the seventh. 1000 cents across 3 horses gives 334, 333 and 333.

**Excusing a horse.** The farrier excuses a confirmed horse on an in-progress day when it cannot be worked for a reason that is not the owner's, such as a vet hold.
- A counting booking's share is **billed** once its visit has left `open`. Every other counting booking apart from the one being excused is an **open recipient**: confirmed, worked with an open visit, `cancelled_late` or `no_show`.
- **Pool rule.** Let s be the excused booking's current share.
  - If s is 0, no share changes and no adjustment is written.
  - Otherwise, with no open recipient, the excuse answers `no_share_recipient` and nothing changes.
  - Otherwise billed shares stay as they are, the excused share becomes 0, and the pool P = fee − the sum of billed shares is split over the open recipients in ascending booking number: each gets the floor of P ÷ n, and the leftover cents go one each to the lowest booking numbers.
- **Adjustments.** Every booking whose share changed, the excused one included, gets one adjustment, appended in ascending booking number. `delta_cents` is the new share minus the old one, `cause_booking_id` is the excused booking, `at` is the excuse instant, and `seq` runs 1, 2, 3 … per barn day. Adjustments are never edited or removed.
- **Deposit.** A captured deposit is refunded in full exactly as for an in-time cancellation, and the owner gets the excused email.
- **Example**, fee 4500, seven confirmed bookings b1 … b7 in ascending number, starting at 643 each and 642 for b7:
  - Nothing billed, excuse b2: b1 and b3 to b7 each become 750. Adjustments: b2 −643; b1, b3, b4, b5 and b6 +107; b7 +108.
  - Instead, with b1 billed at 643, excuse b2: P = 3857 over b3 to b7 gives 772, 772, 771, 771, 771. Adjustments 1 to 6: b2 −643, b3 +129, b4 +129, b5 +128, b6 +128, b7 +129. Then with b3 billed at 772, excuse b5: P = 3085 over b4, b6 and b7 gives 1029, 1028, 1028. Adjustments 7 to 10: b4 +257, b5 −771, b6 +257, b7 +257. Final shares 643, 0, 772, 1029, 0, 1028, 1028.

**Visits.**
- States: `open` → (close) → `closed` → `invoiced`, or `closed` → `invoice_pending` → `invoiced` when billing is unreachable. `closed` lasts only while the invoice is being created, or until a takeover or the reconciler finishes it after a crash.
- Photos and marks change only while the visit is open (`visit_closed` 409).
- Closing a visit needs at least one after photo and moves only from `open`. Any other state answers the illegal-transition 409.
- Saves, restores, photo deletions and closes on one visit are serialised on that visit. Of several simultaneous closes with different keys, exactly one answers 200. The others answer the illegal-transition 409 with `from` set to the status the winner left. A close's response carries the marks stored when the close commits, and a save or restore after that answers `visit_closed`. The closed visit, the close response and the owner's comparison therefore carry the same final marks version.
- Closing a visit ends its live upload sessions (Resumable uploads).

**Prices and invoices.**
- The price for a work code and the deposit are taken from the price list in force on the barn day's business date: the list with the latest `effective_from` on or before that date. The date the booking was made never matters.
- Service names: `trim` Trim, `front_reset` Front shoes, reset, `full_reset` Full set, reset, `front_new` Front shoes, new, `full_new` Full set, new.
- A visit invoice holds one item per ticked code, described `<service name> — <horse name>`. If the horse's share is above 0, it also holds one item `Trip share — <barn name> <business date>` for the share at the close.
- When the booking has a deposit left to apply, the invoice then adds one item `Deposit credit — <horse name> <business date>`, with a negative amount of the smaller of that deposit and the gross (the sum of the positive items). `total_cents` is the sum of all items including this credit, and `balance_cents` starts at `total_cents`.
- An invoice whose balance is 0 reads `paid` and is never dunned.

**Idempotency** (visit close, invoice payments, payment capture, void and refund, and import).
- A key is scoped to the caller and the route, so the same key on another route or from another user is independent. A key is kept for at least 24 hours.
- The key is claimed atomically before any call to Kill Bill or any email is queued. A claim carries a lease of `IDEMPOTENCY_LEASE_SECONDS` seconds (default 30).
- While the first request with a key is still in flight and its lease is live, another request with the same key and body, on any instance, answers `409 {"error":"idempotency_in_progress"}` and creates nothing.
- After the lease expires with no stored response, a same-key retry takes over and finishes the work.
- Once a request has finished, the same key with the same body replays its status and body exactly and creates nothing new. This covers refusals such as a 402 or 503 too.
- The same key with a different body answers `409 {"error":"idempotency_conflict"}`, in flight or not. Bodies are compared as parsed JSON, and import bodies as raw bytes.
- A new key on an already-closed visit answers the illegal-transition 409.

In every interleaving, a visit gets at most one invoice, one Kill Bill invoice, one deposit transfer, one ledger set and one visit summary email.

**Crash-safe close.**
- Every Kill Bill step first reads Kill Bill and adopts what already exists, finding invoices by the marker in their item descriptions and transactions by their external key (Services).
- A background reconciler resumes any invoice left in `closed` once its lease has expired, under the pending retry timing below.
- In every interleaving, including an instance killed at any point, the retry answers 200 with status `invoiced`.
- A Kill Bill failure after the charges and before the transfer leaves the visit `invoice_pending`, and only the remaining legs are retried.

**Billing outage.**
- Kill Bill counts as unreachable when a call fails to connect, takes longer than 5 seconds, or answers a 5xx status.
- If the invoice cannot be finished, the visit closes as `invoice_pending` and the invoice as `pending`. The close still answers 200.
- **Retry hold-off.** No instance attempts a pending invoice again until 20 seconds after it became pending. This holds even when another instance sharing the database can reach Kill Bill. For those first 20 seconds after the close or day-close response, all of the following stay true for that invoice:
  - its visit reads `invoice_pending`;
  - the invoice reads `pending` with `killbill_invoice_id` null;
  - a payment on it answers `invoice_pending`;
  - the UI shows "Invoice pending" for it;
  - Kill Bill holds no invoice for it, unless its charges landed before the failure;
  - no visit summary email has been sent for it.
- After the hold-off, the server retries pending invoices at least every 15 seconds without a restart. Kill Bill may be reachable from any running instance that shares the database (Server boundary). Within 45 seconds of the invoice becoming pending, or of Kill Bill becoming reachable from such an instance, whichever is later, all of the following are true:
  - each pending invoice exists in Kill Bill exactly once with every leg recorded;
  - its visit reads `invoiced`;
  - its invoice reads `unpaid`, or `paid` at a zero balance;
  - its visit summary email is sent, as a background-queued message (Email outage in Services), while Mailpit is reachable from a running instance.
- A visit reads `invoiced` only after every leg is in Kill Bill.
- Deposit captures and refunds that cannot reach Kill Bill leave the booking action successful and `killbill_status` `pending`, with the same 20-second hold-off and 45-second delivery. Work for one payment runs in the order it happened.

**Closing a day.** For each `cancelled_late` or `no_show` booking with a share above 0, closing the day creates one trip-only invoice. Its first item is described `Trip share — <barn name> <business date> (<horse name>, cancelled late)` or `… (<horse name>, no-show)`. A kept deposit adds the Deposit credit item up to the share, and any forfeited excess stays with the practice. A trip-only invoice follows the same pending and retry rule. Excused bookings get no invoice.

**Test cards.** The in-app card gateway needs no network and decides by token alone:

| `card_token` | Outcome | `decline_code` | Last four |
|---|---|---|---|
| `tok_approve_4242` | approved | | 4242 |
| `tok_decline_0002` | hard decline | `do_not_honor` | 0002 |
| `tok_funds_9995` | soft decline | `insufficient_funds` | 9995 |

- A `card_token` holding 12 or more digits in a row answers 422 on `card_token` and never reaches a log or a row. Any other unknown token answers 422 on `card_token`.
- The latest published token an owner submits to a hold, a waitlist join, an invoice payment or `PUT /api/my/card`, declined or not, is their card on file, except that a hold refused with a 409 or 422 leaves the card on file unchanged. Only the token and last four are stored.
- A decline answers the 402 and stores one `declined` payment row.

**Payment states.**

| From | Action | To |
|---|---|---|
| (none) | authorise, approved | authorized |
| (none) | authorise, declined | declined |
| authorized | capture | captured |
| authorized | void | voided |
| captured | partial refund | partially_refunded |
| captured | refund of all that remains | refunded |
| partially_refunded | partial refund | partially_refunded |
| partially_refunded | refund of all that remains | refunded |

Every other action answers the illegal-transition 409. Refunds on one payment are serialised. The refundable amount is `captured_cents` less `refunded_cents` less `applied_cents`, and any request above it answers `refund_exceeds_captured` with `refundable_cents`, however many refunds run at once. A farrier's capture of a held booking's deposit leaves the hold in place, and the later confirmation does not capture again. A farrier's void of a held booking's deposit also releases the hold. A refund on an invoice-kind payment leaves that invoice's `status` and `balance_cents` unchanged.

**Deposits.** The deposit is 0 to 100000 cents, read from the price list in force. At 0, no payment exists and no card is needed.

| Booking event | Payment outcome |
|---|---|
| hold | authorised for the deposit; a decline leaves no booking and the slot open |
| confirm | captured, `disposition` `held` |
| release, lapse, day start or day cancel on a hold | voided |
| cancel in time, excuse | refunded in full, status `refunded`, `disposition` null |
| cancel late, no-show | `disposition` `forfeited`, status stays `captured` |
| day cancelled | every captured deposit on the day is refunded, forfeited ones included |
| visit invoiced | `applied_cents` is the credit, `disposition` `applied`; any part of the deposit above the gross is refunded, status `partially_refunded` |
| trip-only invoice | `applied_cents` is the credit, `disposition` stays `forfeited`, and no part is refunded |

The credit appears on that horse's invoice alone, even when one owner has several horses and deposits on one day.

**Paying an invoice.**
- An owner pays an unpaid invoice's full balance. The order is fixed: authorise on the card, record the external payment in Kill Bill, then capture. The invoice's balance becomes 0 and its status `paid`, and the request answers 201.
- Payments on one invoice are serialised on that invoice, together with dunning retries. Of several simultaneous pays with different keys, exactly one answers 201 and the others answer `already_paid`. Kill Bill holds exactly one card payment for the invoice.
- If billing is unreachable, the authorisation is voided: one `voided` payment row exists, nothing is captured, the invoice stays `unpaid` with its balance, Kill Bill has no payment, and the request answers `billing_unavailable`. A later pay with a new key may succeed.

**Dunning.**
- A declined invoice payment on an invoice in `none` sets `first_declined_at` and stamps three retry instants: `first_declined_at` plus N × `DUNNING_DAY_SECONDS` (default 86400), for each N in `DUNNING_RETRY_DAYS` (default `3,5,7`). A soft decline moves the invoice to `past_due`.
- At each retry instant a durable `dunning_retry` job charges the card on file. A soft decline moves `past_due` → `retry_1` → `retry_2` → `blocked`, one step per retry.
- A hard decline at any point, including the first, goes straight to `blocked` and cancels the remaining retries.
- A later manual decline changes nothing, unless it is hard.
- A retry that cannot reach Kill Bill voids its authorisation, backs off as a job failure, and changes no state.
- Any successful payment, automatic or manual, moves the invoice to `paid` and, if it was in dunning, `cleared`. A manual pay racing a retry records exactly one capture.
- An owner with any `blocked` invoice answers `account_blocked`, first among the hold and waitlist 409s. The offer pass skips them, keeping their position.
- **Unblocking.** Paying an owner's last blocked invoice unblocks them at once and, inside that payment's transaction, runs the offer pass on each published day before its start where that owner waits. An offer made there is stamped at the payment's instant, so its `hold_expires_at` is that instant plus `WAITLIST_OFFER_SECONDS`, and it is visible in the owner's bookings as soon as the payment answers 201.

**Request allowances.** Each allowance holds up to its capacity in tokens and refills continuously, with fractional tokens stored. Defaults, as capacity / refill per minute:

| Allowance | Routes | Per user | Per address |
|---|---|---|---|
| `sign_in` | `POST /api/session` | 10 / 2, keyed by the lower-cased submitted email | 240 / 120 |
| `hold` | `POST /api/barn-days/{id}/bookings`, `POST /api/bookings/{id}/confirm` | 60 / 12 | 300 / 120 |
| `payment` | `POST /api/invoices/{id}/payments`, `PUT /api/my/card` | 20 / 6 | 100 / 30 |
| `upload` | `POST /api/visits/{id}/photos`, `POST /api/visits/{id}/uploads`, `PATCH /api/uploads/{id}` | 200 / 60 | 400 / 120 |
| `vet` | every GET under `/api/vet/` | none | 60 / 30 |

- A request takes 1 token from each allowance it reaches. A request refused by an allowance takes no token from that allowance, and a token already taken is not returned when a later step refuses.
- Address is the connection's peer address. Forwarding headers are ignored.
- **Across clocks.** Each allowance row stores its tokens and the instant they were last updated. Refill adds tokens only for max(0, now − stored instant), now being the handling instance's current instant, and the stored instant is then set to the later of itself and now, so it never moves backward. Before a token is taken, the stored count is capped at the handling instance's capacity, and the capped count is stored. Allowance state lives only in Postgres and survives any instance restart.
- A refusal answers `429 {"error":"rate_limited","bucket":"<name>","scope":"user"|"address"}` with `Retry-After` equal to (1 − tokens) × 60 ÷ refill per minute, plus max(0, stored instant − now), in whole seconds rounded up and at least 1.
- Every response on these routes that reached the address step, including a 429, carries `RateLimit-Limit` (the handling instance's capacity), `RateLimit-Remaining` (the floor of the tokens left) and `RateLimit-Reset` ((capacity − tokens) × 60 ÷ refill per minute plus the same lead, in whole seconds rounded up). They describe whichever reached allowance has fewer remaining, and a tie reports the user allowance. On a 429 they describe the refusing allowance.
- The overrides are `RATE_<BUCKET>_<SCOPE>_CAPACITY` and `RATE_<BUCKET>_<SCOPE>_REFILL_PER_MINUTE`, where `<BUCKET>` is `SIGN_IN`, `HOLD`, `PAYMENT`, `UPLOAD` or `VET` and `<SCOPE>` is `USER` or `ADDRESS`.

**Vet-link guess limit.**
- A miss is a `GET /api/vet/{token}` that answers 404. The vet page loads its data through that request, so opening `/vet/<token>` with an unknown, expired or revoked token is one miss.
- Misses are counted per client address, which is the connection's peer address. Forwarding headers are ignored.
- The count is kept in Postgres and shared by every instance on the database.
- A miss counts for the 60 seconds after it was answered.
- While 10 misses from an address count, every GET under `/api/vet/` from that address, valid tokens included, answers the 429 from API. Its `Retry-After` header is the whole number of seconds, rounded up and at least 1, until the oldest counting miss stops counting.
- A 429 is not a miss, and valid-token reads never count.

**Client import.**
- The header must be exactly `owner_name,owner_email,owner_phone,horse_name,barn_name,stall,cycle_weeks`. Any other header answers `import_invalid` with one error: line 1, column `header`, code `bad_header`.
- The file is standard CSV: a UTF-8 byte-order mark, CRLF or LF line ends, and quoted commas and newlines are all accepted.
- A file may hold up to 5,000 data rows inclusive. More answers `import_invalid` with one error: line 1, column `header`, code `too_many_rows`.
- `line` is the physical line where the record starts in the file, with the header as line 1, so a quoted newline in an earlier record moves later line numbers.
- `column` is the header name. Codes:

| Code | Column | Meaning |
|---|---|---|
| `missing_value` | the empty column | a cell is empty |
| `invalid_email` | `owner_email` | not an email address |
| `unknown_barn` | `barn_name` | matches no barn, compared without regard to case |
| `cycle_out_of_range` | `cycle_weeks` | not a whole number from 5 to 8 inclusive |
| `duplicate_row` | `horse_name` | a later row with the same owner email and horse name as an earlier row |
| `stall_taken` | `stall` | another horse at that barn holds the stall, in the database or on an earlier row |
| `owner_name_mismatch` | `owner_name` | the email matches an owner, in the database or on an earlier row, with a different name |

- Owners match on lower-cased email. A matched owner is left unchanged. Horses match on owner plus case-insensitive name.
- A matched horse takes the row's barn, stall and cycle, and counts in `updated_horses`. An unchanged one counts in neither `created_horses` nor `updated_horses`.
- New owners get a sign-in with the password `IMPORT_DEFAULT_PASSWORD` (default `hoofcare-2026`).
- Two simultaneous imports of one file with different keys both answer 201. One reports the rows as matched, and no duplicate owner or horse exists.
- Names are stored exactly as imported.
- A stall change reaches open barn day streams as stated in Live streams.

**Hoof photos.**
- A file is accepted only when its bytes begin with a JPEG, PNG or HEIC signature (an `ftyp` box with brand `heic`, `heix` or `mif1`) and decode as a complete image. The file name and declared type are ignored. SVG, GIF, WebP, PDF and anything else answer `unsupported_image`.
- A file of exactly 8,000,000 bytes is accepted. One byte more answers `photo_too_large`.
- Any orientation the upload declares (the EXIF Orientation tag, or a HEIC rotation or mirror) is applied to the pixels before metadata is removed, so the stored image displays upright exactly as the upload did. The Photo's `width` and `height` are the stored image's pixel size: the upload's pixel size for orientation 1 or no tag, and that size with width and height swapped for orientations 5 to 8. The image is never otherwise scaled or cropped.
- The stored image carries no EXIF, GPS, XMP, IPTC or comment data, and no PNG text or eXIf chunks. HEIC is stored converted to JPEG, and its `content_type` is `image/jpeg`.
- Owners and vets only ever receive the stored copy.
- **Deleting a photo.** Photos are deleted only from an open visit. Deleting one removes its stored object and its thumbnail object from MinIO and releases its stored bytes (the stored image's size, not the upload's) from the quota at once. `GET /api/photos/{id}` and its signed paths then answer 404. A thumbnail job for it that has not yet written its object ends `succeeded` with result `{"photo_id"}` and writes nothing. A thumbnail job already running when the photo is deleted removes the object it wrote once it finds the photo gone. Either way, no object remains under `visits/<visit id>/<hoof>/<phase>/<photo id>` within 10 seconds of the delete response.

**Resumable uploads.**
- `chunk_bytes` is `UPLOAD_CHUNK_BYTES` (default 1000000). Each chunk is exactly `chunk_bytes` long except the last, which holds what remains.
- `expires_at` is the session's creation plus `UPLOAD_SESSION_SECONDS` seconds (default 86400).
- `Upload-Offset` must equal the stored offset, or the PATCH answers `offset_mismatch`. Of two PATCHes at one offset, exactly one advances.
- Any instance continues a session. The offset lives in Postgres and the chunks in MinIO.
- When the last chunk lands, the assembled file passes every Hoof photos rule, the chunks are removed, and the Photo is stored. A refusal deletes the chunks.
- At and after `expires_at` a session answers `upload_expired`, and its reservation is released on that instant without any job.
- **Close ends sessions.** Closing a visit ends its live sessions: their reservations are released in the close's transaction, and their chunk objects are removed within 10 seconds of the close response, so nothing remains under `uploads/<upload id>/`. Afterwards GET, PATCH and DELETE on such a session answer `visit_closed`, and the visit's session list is empty. Objects under `visits/` are never deleted by a close.

**Photo quota.** Stored plus reserved bytes on one visit never exceed `VISIT_PHOTO_QUOTA_BYTES` (default 48000000). A session reserves its `size_bytes` at create, and a single-shot upload reserves its file's size, under a lock on the visit. Excess answers `visit_quota_exceeded` with `remaining_bytes`. A reservation is replaced by the stored image's bytes on success, and released on refusal, session deletion, expiry or visit close. Deleting a photo releases its stored bytes. For example, seven simultaneous 8,000,000-byte sessions on an empty visit at the default quota give six 201s and one 409.

**Thumbnails.** Each stored photo enqueues a `thumbnail` job that writes a 320-pixel-wide JPEG with no metadata. The photo's `thumbnail_status` starts `pending` and becomes `ready`, or `failed` if the job goes dead. The stored photo is never altered.

**Angles.** For a line from (x1, y1) to (x2, y2) in stored-photo pixels:
- the angle in degrees is the arctangent of |y2 − y1| ÷ |x2 − x1|, so a vertical line is 90.0;
- the angle is rounded to one decimal, halves away from zero;
- both points must lie within the stored photo, 0 to its `width` and 0 to its `height` inclusive, after any declared orientation has been applied, and be distinct, or the request answers 422.

For example, a JPEG uploaded at 1200 × 900 pixels with Orientation 6 is stored at 900 × 1200. Hoof wall (100, 1100)→(800, 300) and pastern (100, 1150)→(700, 350) save as 48.8°, 53.1° and broken-back. Hoof wall (100, 1100)→(1100, 300) answers 422 with the coordinates copy.

Saving marks computes both angles and the label once and stores them. Every reader, including the browser, shows the stored values. The difference d is the hoof-wall angle minus the pastern angle:
- `aligned` when |d| ≤ 3.0;
- `broken-back` when d < −3.0 (hoof wall lower than the pastern);
- `broken-forward` when d > 3.0.

**Marks versions and restore.**
- A hoof's first save stores version 1, and each later save or restore stores the current version plus 1.
- A save or restore must send `version` `null` when the hoof has no marks, and the current version otherwise. Any other value answers the 412 `stale_marks` with the stored marks (or null) and changes nothing.
- Of two simultaneous saves or restores sending the same version, including two first saves sending `null`, exactly one answers 200. The other answers 412 with `current` equal to the winner's response body.
- A restore copies the stored lines, angles and label of `restore_version` and never recomputes them.
- Deleting the after photo deletes the marks and their history, so the next save sends `null` and stores version 1. The audit log keeps the record.

**Readout lines.** Each signed difference is current minus previous, with one decimal. The sign is `+` when positive and a minus sign (Unicode U+2212, `−`) when negative, and a zero difference prints `±0.0`. The three lines, using → (U+2192), are:
1. `Hoof wall <previous>° → <current>° (<signed difference>°)`
2. `Pastern <previous>° → <current>° (<signed difference>°)`
3. `Alignment <previous label> → <current label>`

For example, with the seed data at start, Juniper's left fore reads `Hoof wall 51.5° → 54.0° (+2.5°)`, `Pastern 56.0° → 55.0° (−1.0°)` and `Alignment broken-back → aligned`, and its right fore reads `Hoof wall 49.6° → 50.8° (+1.2°)`, `Pastern 53.0° → 50.8° (−2.2°)` and `Alignment broken-back → aligned`.

**Next due.**
- The next-due date is the business date of the horse's last visit in any state other than open, plus 7 × `cycle_weeks` days.
- With today in the practice zone, the horse is `current` before next-due minus 7 days, `due` from next-due minus 7 days through the next-due date, and `overdue` after it.
- A horse with no such visit is `unknown` with null dates.

**Vet links.**
- **Live pair.** A link always shows its horse's two most recent visits that are not open, judged at each read. `previous_date`, `current_date` and every hoof entry come from that pair. Issuing with fewer than two such visits answers `not_enough_visits`. The issue and regenerate responses carry the pair as it stood at that moment and never change afterwards.
- The token has at least 128 bits of randomness and is URL-safe. The link's path is `/vet/<token>`.
- A link expires `VET_LINK_TTL_SECONDS` seconds after issue (default 1209600, which is 14 days). The expiry is fixed and stored as `expires_at` at issue or regeneration. At the expiry instant it is already expired.
- Revoking kills the token at once on every instance, with no token cached in any process. Regenerating issues a new token and a new expiry for the same record, and the old token dies at once.
- **Vet photo paths** are checked at each read: a path verifies only while its link is live and the photo is an after photo of one of the link's current two visits. A path issued before a revoke, or for a visit that has since left the pair, answers `url_invalid` even inside its lifetime.
- A token reads only its own horse. It is never accepted as a session anywhere else.
- **View log.** Each `GET /api/vet/{token}` answered 200 or 404 for a token the practice issued, including a regenerated-away one, adds one view row with outcome `viewed`, `expired` or `revoked`. A `viewed` row records the pair it served. Unknown tokens and 429s add none. Logging changes nothing about misses.

**Photo URLs.**
- Signed photo paths are issued only after the visibility check. Each lasts `PHOTO_URL_TTL_SECONDS` seconds (default 300): it verifies before its `exp` and not at or after it.
- A photo path is `/media/<photo id>?k=<key id>&exp=<unix seconds>&sig=<hex>`, and a thumbnail path is `/media/<photo id>/thumb?k=<key id>&exp=<unix seconds>&sig=<hex>`. A path signed for a vet link also carries `&v=<vet link id>`, covered by the signature.
- **Key ring.** Signing keys live in Postgres. When a path is about to be signed and the newest key is at least `PHOTO_URL_KEY_ROTATE_SECONDS` seconds old (default 86400), a new key is created first, exactly once across instances, and new paths use it. A path verifies with the key its `k` names until its own `exp`. A path whose `k` names an unknown key, or a key other than the one that signed it, answers `url_invalid`. A retired key is removed only after every path it signed has expired.

**Live streams.**
- Each barn day has one event stream per role (farrier, apprentice, barn manager), and each horse has one for staff and one for its owner. Events are stored in Postgres. Within one stream, `id:` is a contiguous integer from 1, allocated under that day's or horse's serialisation. A sequence shared across the database is not acceptable, because commit order can skip numbers.
- A stream starts with `retry: 2000` and sends a comment heartbeat every `SSE_HEARTBEAT_SECONDS` seconds (default 15).
- A connection with no `Last-Event-ID` receives new events only. `Last-Event-ID: <n>` replays n + 1 onward in order, on any instance, with no gap or repeat, then continues live. If n + 1 has fallen out of the newest `SSE_RETENTION_EVENTS` events (default 1000) or lies beyond the newest, the server sends one `event: reset` with data `{}`, then live events.
- An event reaches open streams on every instance within 2 seconds of commit.
- A stream ends within one heartbeat after its session is deleted on any instance.
- API tokens cannot open a stream.

Barn day events:

| Event | Sent when | Data |
|---|---|---|
| `booking_added` | a booking enters that role's row list | that role's row keys from the booking list |
| `booking_removed` | a booking leaves that role's row list | that role's row keys |
| `booking_moved` | a listed row changes without entering or leaving | that role's row keys, after the change |
| `day_status` | the stored status changes, or a request moves the day between `published` and `full` | `{"status"}` |
| `allocation_fixed` | the day starts; farrier stream only | the Allocation body |
| `allocation_adjusted` | a horse is excused and at least one share changed; farrier stream only | the Allocation body |

- Held bookings produce no event for any role.
- **Excuse events.** The farrier stream gets one `booking_moved` per row whose keys changed (the excused row and each row whose share changed), in ascending booking number, then one `allocation_adjusted`. The apprentice stream gets one `booking_moved` for the excused row. The barn manager stream gets one `booking_removed` for the excused row.
- **Stall changes.** Booking rows always show the horse's current stall. When an import changes the stall of a horse whose booking is listed on a published, full or in-progress day, each of that day's role streams that lists the booking gets exactly one `booking_moved` with that role's keys. An import that leaves the stall unchanged sends nothing.
- Horse events are `marks_saved` with exactly `{"visit_id","hoof","version"}`, whose `version` is null when deleting an after photo removed the marks, and `visit_closed` with exactly `{"visit_id"}`. The owner's stream never carries an event about an open visit, and carries `visit_closed` when the visit stops being open.

**Jobs.**
- A due job is claimed through Postgres by one instance, with `lease_expires_at` set to the current instant plus `JOB_LEASE_SECONDS` seconds (default 30), and starts within 2 seconds of its `run_at`.
- A running job whose lease has expired is reclaimed by any instance, and that counts as an attempt. A result from a worker whose lease was taken over is discarded.
- After failed attempt n, `run_at` is the current instant plus the smaller of `JOB_BACKOFF_BASE_SECONDS` (default 5) × 2^(n−1) and `JOB_BACKOFF_MAX_SECONDS` (default 300). At `JOB_MAX_ATTEMPTS` attempts (default 5) the job becomes `dead`.
- States: `queued` → `running` → `succeeded`, `running` → `queued` with backoff, `running` → `dead` at the attempt limit, `dead` → `queued` on retry with attempts back at 0. Retrying any other status answers the illegal-transition 409.
- A job's `result` is `{"key","url","url_expires_at"}` for `csv_export`, `{"photo_id"}` for `thumbnail`, `{"horse_id","next_due_date"}` for `due_reminder` (set when it is queued), and null for `dunning_retry` and `offer_pass`.
- Pending invoices and the email outbox keep their own published timings and use the same claiming.
- **Due reminders.** Every `REMINDER_SCAN_SECONDS` seconds (default 300), each horse in `due` status gets one `due_reminder` job per `next_due_date`, which sends one reminder email to its owner, once across all instances.

**Ledger and dashboard.**
- The ledger is append-only. Each entry has a kind, an amount in cents, an instant, and its owner, horse and date. A correction is a new entry, never an edit. Kinds:

| Kind | When | Dashboard figure |
|---|---|---|
| `billed` | a visit or trip invoice's charges are in Kill Bill, for the gross positive items | billed |
| `deposit_captured` | Kill Bill holds a deposit capture, at the capture's instant | collected |
| `invoice_payment` | Kill Bill holds a card payment on an invoice | collected |
| `refund` | Kill Bill holds a refund to the owner; a cancellation's refund carries its `decided_at`, any other refund the instant of the action that caused it | refunded |
| `deposit_transfer_out`, `deposit_transfer_in` | one pair of equal amounts per deposit credit | none |

- A refund adds its own entry; the `deposit_captured` entry it reverses stays untouched. A forfeited deposit stays in collected. Deposit invoices are not billed.
- A figure is assigned to a month and a date in the practice zone at the entry's instant, not in UTC.
- `outstanding_cents` is the balance of `unpaid` invoices whose business date is in the month. `overdue_horses` counts horses overdue now whose `next_due_date` is in the month.
- `collected_cents` less `refunded_cents` always equals the net of Kill Bill's payments and refunds for the month, once the deposit transfer legs cancel out.
- **Export.** The `csv_export` job writes one row per ledger entry in the month, ordered by instant, with header `date,kind,owner,horse,amount`. `date` is the practice-zone date, and `amount` is unsigned dollars with two decimals. A cell starting with `=`, `+`, `-` or `@` gets a leading `'`. Names are neutralised only in this file.
- **Alert.** When the sum of `balance_cents` across all `unpaid` invoices moves from at or below `ALERT_OUTSTANDING_CENTS` (default 50000) to above it, the farrier gets one alert email and one Notices line. It re-arms only after the sum falls back to or below the threshold. Simultaneous crossings give one alert. The armed state is kept in Postgres per threshold value, so instances started with different `ALERT_OUTSTANDING_CENTS` values arm and alert independently. A threshold value with no stored state starts armed; the sum is evaluated after every change to an unpaid balance, and an armed threshold whose sum is then above it sends the alert and disarms.

**API tokens.** Only a hash of a token is stored, and the plaintext appears in no Postgres column. A token is used as `Authorization: Bearer <token>` and acts as the farrier.
- `read_only` allows every GET the farrier may call, except tokens, audit, jobs, event streams, and everything under `/api/invoices` and `/api/payments`.
- `billing` allows everything `read_only` does, plus those invoice and payment GETs, the reconciliation routes and `POST /api/payments/{id}/refund`.
- Everything else answers `insufficient_scope`.
- A deleted token answers 401 on the next request on every instance.

**Read-back.**
- Each reconciliation call reads Kill Bill live.
- For an invoice, `total` is the charges after adjustments, `paid` is the sum of purchases against it (deposit credit and card), `refunded` is the sum of refunds against those purchases, and `balance` is the balance. For a payment, `total` and `paid` are the captured amount, `refunded` is `refunded_cents` plus `applied_cents`, and `balance` is what remains.
- A record that is still pending, or a Kill Bill that cannot be read, answers `status` `unavailable` with `killbill` null and empty `differences`.
- Any difference answers `mismatch` and sets the invoice's `reconciliation` to `mismatch`. The first mismatch for an invoice writes one audit entry. A later `matched` read sets it back.

**Audit log.** The table `audit_log` is append-only, enforced by a database trigger that raises on UPDATE or DELETE. Each state change on a barn day, booking, visit, invoice, payment, vet link, price list, API token, import or dunning state writes exactly one entry in the same transaction. A hold lapse writes one booking entry and one payment entry (its voided deposit), both with a `system` actor, once, by the next request or job that touches the day. Holds removed by a start or a day cancel likewise write one booking entry and one payment entry each, attributed to that request's actor. That entry belongs to the lapse, not to the request that happened to record it, as stated under Refused claims leave no trace in Bookings.

### Services (DP-08, DP-14, DP-19, DP-24, DP-25, DP-30, DP-36, DP-39, DP-42, DP-52, DP-55, DP-59, DP-64, DP-66, DP-69, DP-70, DP-76, DP-78, DP-80, DP-81, DP-86, DP-94, DP-95, DP-97, DP-98)

- **Postgres** holds every record: users, sessions, barns, horses, owners, barn days, slots, the booking-number counter, bookings, waitlist, visits, photo metadata, upload sessions and reservations, marks and their versions and history, price lists, allocations and their adjustments, invoices, payments, refunds, ledger entries, dunning state, idempotency claims, allowance rows, stream events, jobs, API token hashes, photo signing keys, vet links, view logs, vet-link miss counts, the email outbox and the audit log.
  - **Migrations.** Schema changes are versioned files, applied once on serve under a Postgres advisory lock and recorded in the table `schema_migrations(version, applied_at)`. Each applied version writes one `{"event":"migration_applied","version"}` line to the log.
- **MinIO** (bucket `S3_BUCKET`, private) keys:
  - photo: `visits/<visit id>/<hoof>/<phase>/<photo id>.<jpg|png>`;
  - thumbnail: `visits/<visit id>/<hoof>/<phase>/<photo id>.thumb.jpg`;
  - upload chunks: `uploads/<upload id>/`, as separate objects removed once the final object exists, on refusal, on session deletion or expiry, and on visit close;
  - export: `exports/<YYYY-MM>/<job id>.csv`.

  Objects of visits that are no longer open are never deleted. A photo deleted from an open visit leaves no object or thumbnail behind (Hoof photos). Browsers never talk to MinIO. When MinIO is unreachable, uploads answer the storage 503 from API.
- **Kill Bill.**
  - Each owner has one account with external key equal to the owner's email, name equal to the owner's name and currency USD. The account is created the first time it is needed, and exactly once even under simultaneous requests.
  - **Visit and trip invoices.** Each is one Kill Bill invoice on that owner's account, made of external charges for the positive items only, with dollar amounts equal to the items. Each charge's description is the app's item description followed by ` [<invoice id>]`.
  - **Deposit capture.** A deposit invoice with one external charge described `Booking deposit — <horse> <date> [<payment id>]`, plus one external payment with `transactionExternalKey` `<payment id>:capture`.
  - **Refund** (in-time cancellation, excusal, day cancellation, farrier refund, excess over the gross). `POST /1.0/kb/invoicePayments/{paymentId}/refunds` with `externalPayment=true`, an item adjustment for the refunded amount, and `transactionExternalKey` `<refund id>`, where `<refund id>` is the app's own id for that refund. Kill Bill records each such refund as one payment transaction of type CREDIT carrying that key. When Kill Bill is reachable, the action that causes the refund answers only after Kill Bill has recorded it.
  - **Deposit credit.** One transfer of two legs: a refund on the deposit payment, as above, with key `<invoice id>:deposit-out`, and an external payment on the new invoice with key `<invoice id>:deposit-in`. Account credit is never used, because it would drift onto a sibling horse's invoice. The Kill Bill invoice balance equals the app's `balance_cents`. A paid invoice with a deposit credit therefore holds two Kill Bill payments: the deposit-in leg and the card payment.
  - **Card payments** are external payments against that Kill Bill invoice for its full balance, with key `<payment id>:capture`.
  - Seeded history visits have no Kill Bill invoice. When billing is unreachable, the app follows Billing outage in Business rules.
- **Mailpit (SMTP).** Every email's From line is the value of `MAIL_FROM`, which the environment sets to `Rasp & Rein <bookings@raspandrein.test>`. Each event sends exactly one message, even under concurrent or retried requests:

| Event | To | Subject | Body includes |
|---|---|---|---|
| Booking confirmed | owner | `Booked: <horse> at <barn name> on <date>` | slot time, `Cancel by <cutoff>`, and that cancelling after the cutoff keeps the trip share |
| Booking cancelled (by owner, by farrier, or by cancelling the day) | owner | `Cancelled: <horse> at <barn name> on <date>` | exactly one of `No trip share applies.` or `A trip share still applies.`, and when a deposit was captured, the matching deposit sentence from the Cancel dialog body |
| Horse excused | owner | `Excused: <horse> at <barn name> on <date>` | `No trip share applies.`, and when a deposit was captured, ` Your $<amount> deposit will be refunded.` |
| Waitlist offer | owner | `Slot offered: <horse> at <barn name> on <date>` | `Hold ends at <hold end> (<time zone>).` |
| Offer declined by the card | owner | `Slot offer lapsed: <horse> at <barn name> on <date>` | |
| Visit invoiced | owner | `Visit summary: <horse> on <date>` | each item with `$<amount>`, including the deposit credit line, `Invoice total $<amount>`, `Next due <date>` |
| Due reminder | owner | `Due soon: <horse> by <date>` | |
| Enters `past_due` | owner | `Payment failed: <horse> on <date>` | `We will try again on <next try>.` |
| Enters `retry_1` | owner | `Second payment attempt failed: <horse> on <date>` | `We will try again on <next try>.` |
| Enters `retry_2` | owner | `Third payment attempt failed: <horse> on <date>` | `We will try again on <next try>.` |
| Enters `blocked` | owner | `Account on hold: <horse> on <date>` | `New bookings are on hold until this invoice is paid.` |
| Enters `cleared` | owner | `Payment received: <horse> on <date>` | |
| Outstanding alert | farrier | `Outstanding balance over $<amount>`, the threshold | |
| Vet link issued or regenerated | vet email | `Hoof comparison for <horse>` | the full link and `This link works until <YYYY-MM-DD HH:MM> (<time zone>).` |

  In the dunning rows `<horse>` and `<date>` are the invoice's horse and business date. A hard decline sends only the `blocked` email. An email never names another owner, horse or amount. A refused hold sends no email.
- **Email outage.** Emails go through a Postgres outbox. When SMTP fails, the action that caused the email still succeeds. A message is request-queued when the transaction of an incoming request queues it, and background-queued when the reconciler or a job queues it.
  - **First attempt of a request-queued message.** The instance whose transaction queues the message claims it in that same transaction, with a lease of `JOB_LEASE_SECONDS` seconds, and makes the first send attempt as soon as the transaction commits. No other instance may claim the message until that attempt has failed, until the lease has expired with no attempt made, or until a draining instance releases it (Deployment). So a message queued on an instance that cannot reach Mailpit fails there first, even while other instances can reach Mailpit.
  - **Hold-off of a request-queued message.** No instance attempts the message again until 20 seconds after a failed send. For those 20 seconds, Mailpit holds no copy of it.
  - **Delivery of a request-queued message.** After the hold-off, the outbox retries at least every 15 seconds without a restart. Mailpit may be reachable from any running instance that shares the database (Server boundary). The message is delivered exactly once within 45 seconds of the failed send, or of Mailpit becoming reachable from such an instance, whichever is later.
  - **Background-queued messages.** Any instance may claim one. An instance whose send fails releases the claim at once and does not try that message itself for 20 seconds, while any other instance may claim it straight away. No hold-off applies across instances. While any running instance can reach Mailpit, the message is delivered exactly once within 5 seconds of being queued. When none can, it is delivered exactly once within 45 seconds of Mailpit becoming reachable from one.

### Seed data (DP-01, DP-02, DP-26, DP-32, DP-36, DP-86)

Every seeded person, horse, barn and business is invented. An empty database is migrated and seeded when the app serves, so a reset database is seeded again. Migration and seeding are safe when several instances start against the same database at once, and the seed is written exactly once. `<seed date>` is the practice-zone business date on which seeding ran.

- **Practice:** Rasp & Rein, time zone `America/Denver`.
- **Passwords:** every seeded account uses the password `hoofcare-2026`.
- **Users:**

| Name | Email | Role | Notes |
|---|---|---|---|
| Marlow Tesk | `farrier@clinchline.test` | farrier | |
| Ike Ferreira | `apprentice@clinchline.test` | apprentice | |
| Rosa Vint | `manager.cedar@clinchline.test` | barn manager | Cedar Hollow Stables |
| Hollis Breen | `manager.larkspur@clinchline.test` | barn manager | Larkspur Farm |
| Ada Quill | `owner.ada@clinchline.test` | owner | phone `+1 303 555 0141` |
| Bram Lowe | `owner.bram@clinchline.test` | owner | phone `+1 303 555 0142` |
| Cleo Marsh | `owner.cleo@clinchline.test` | owner | phone `+1 303 555 0143` |
| Dev Ansel | `owner.dev@clinchline.test` | owner | phone `+1 303 555 0144` |

- **Barns:** Cedar Hollow Stables with a trip fee of 4500 cents, and Larkspur Farm with a trip fee of 6000 cents.
- **Horses:**

| Horse | Owner | Barn | Stall | Cycle (weeks) |
|---|---|---|---|---|
| Juniper | Ada | Cedar Hollow | 4 | 6 |
| Pilot | Ada | Cedar Hollow | 7 | 8 |
| Saffron | Bram | Cedar Hollow | 5 | 5 |
| Quarry | Bram | Cedar Hollow | 9 | 6 |
| Tamarack | Cleo | Cedar Hollow | 12 | 7 |
| Wicket | Cleo | Cedar Hollow | 11 | 8 |
| Fern | Dev | Cedar Hollow | 14 | 6 |
| Maple | Dev | Larkspur | 2 | 6 |

- **Price list** effective `2026-01-01`: deposit 2500, trim 5500, front_reset 12000, full_reset 19000, front_new 15000, full_new 24000.
- **History visits.** All have status `invoiced`, `invoice` null and no booking, and the UI shows "Billed before Clinchline":
  - Juniper at `<seed date>` − 84 days and − 42 days;
  - Pilot at − 63 days;
  - Saffron at − 10 days;
  - Maple at − 30 days.

  Quarry, Tamarack, Wicket and Fern have no visits. At start Juniper is `due`, Pilot `overdue`, Saffron and Maple `current`, and the others `unknown`.
- **Juniper's fore after photos.** Both of Juniper's visits have a left fore and a right fore after photo of 1200 × 900 pixels. Any invented, non-identifying hoof image or drawing bundled with the app may be used. Each photo is stored in MinIO under the key pattern during seeding. Marks, each at version 1, saved by Marlow Tesk:
  - − 84 days: left fore hoof wall (300, 800)→(700, 297), pastern (700, 700)→(1100, 107), which gives 51.5°, 56.0° and broken-back; right fore hoof wall (300, 800)→(700, 330), pastern (700, 700)→(1100, 170), which gives 49.6°, 53.0° and broken-back;
  - − 42 days: left fore hoof wall (300, 820)→(700, 269), pastern (700, 700)→(1100, 129), which gives 54.0°, 55.0° and aligned; right fore hoof wall (300, 800)→(700, 310), pastern (700, 700)→(1100, 210), which gives 50.8°, 50.8° and aligned.
- **Barn days:**
  - Cedar Hollow Stables, `<seed date>` + 14 days, start 07:30, 4 slots of 45 minutes, trip fee 4500, published, no bookings;
  - Larkspur Farm, `<seed date>` + 21 days, start 08:00, 2 slots of 60 minutes, trip fee 6000, draft.

## Technical requirements

### Deployment (DP-40, DP-84, DP-85, DP-87, DP-104)

- **Runtime.** The app is TypeScript on Node.js 22 with npm.
- **Run manifest.** `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

  ```
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
  ```

- **Port.** The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- **Health.** `GET /api/health` and `GET /healthz` answer HTTP 200 with JSON `{"status":"ok"}` as soon as the server accepts requests, with no dependency check, including while Kill Bill or Mailpit is unreachable.
- **Readiness.** `GET /readyz` answers `200 {"status":"ready","dependencies":{"postgres":"up","minio":"up","killbill":"up","mailpit":"up"}}`. With any dependency down it answers `503 {"status":"not_ready","dependencies":{…},"down":["<name>"]}`, each value being `up` or `down`. Each check is bounded by `READY_CHECK_TIMEOUT_MS` milliseconds (default 2000). While draining it answers 503 with `"draining":true`.
- **SIGTERM.** The signal reaches the server when it runs through the manifest's `serve` command.
  - At once `/readyz` answers 503 as draining, and every other new request answers `503 {"error":"shutting_down"}` and writes nothing: no row, Kill Bill call or email.
  - A request accepted before the signal finishes every write, Kill Bill call and email it causes, or leaves its Kill Bill legs `pending` for another instance to finish under Billing outage.
  - Request-queued emails this instance claimed but has not yet attempted are released before exit, so any instance can send them at once.
  - A job already executing finishes and records its outcome. A job this instance claimed but has not started returns to `queued` with no attempt counted.
  - Event streams end. The process exits with code 0 within `SHUTDOWN_GRACE_SECONDS` seconds (default 10).
  - Afterwards the ledger, the audit log and Kill Bill agree: for example, of several confirmations cut by the signal, exactly the ones that answered 200 have a captured deposit, a `confirmed` audit entry, a `deposit_captured` ledger entry, a Kill Bill deposit payment within 45 seconds and one `Booked:` email; the others stay held and lapse with their deposits voided.
- **Logs.** One JSON line on stdout per request, with `ts, level, msg, request_id, instance, method, path, status, duration_ms`. `instance` is `INSTANCE_LABEL`. Vet tokens in paths are written as `[token]`. Cookies, passwords, Bearer tokens and card tokens never appear in any log line.
- **Request ids.** An incoming `X-Request-Id` matching `^[A-Za-z0-9-]{8,64}$` is echoed on the response. Otherwise a new UUID is generated and echoed. Job log lines and audit entries carry the id of the request that caused them.
- **Assets.** The fonts and every asset are bundled and served by the app.

### Configuration and secrets (DP-43, DP-83, DP-99)

The app reads these at start. Defaults are stated in the section that owns each rule:
- `DATABASE_URL`;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`;
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`;
- `APP_PUBLIC_PORT`, `INSTANCE_LABEL` (default `primary`), `CLOCK_OFFSET_SECONDS`;
- `BOOKING_HOLD_SECONDS`, `WAITLIST_OFFER_SECONDS`, `VET_LINK_TTL_SECONDS`, `PHOTO_URL_TTL_SECONDS`, `PHOTO_URL_KEY_ROTATE_SECONDS`;
- `UPLOAD_CHUNK_BYTES`, `UPLOAD_SESSION_SECONDS`, `VISIT_PHOTO_QUOTA_BYTES`;
- `DUNNING_RETRY_DAYS`, `DUNNING_DAY_SECONDS`;
- `JOB_LEASE_SECONDS`, `JOB_MAX_ATTEMPTS`, `JOB_BACKOFF_BASE_SECONDS`, `JOB_BACKOFF_MAX_SECONDS`, `REMINDER_SCAN_SECONDS`;
- `ALERT_OUTSTANDING_CENTS`, `IDEMPOTENCY_LEASE_SECONDS`, `SHUTDOWN_GRACE_SECONDS`;
- `SSE_HEARTBEAT_SECONDS`, `SSE_RETENTION_EVENTS`, `READY_CHECK_TIMEOUT_MS`, `IMPORT_DEFAULT_PASSWORD`;
- the `RATE_*` overrides from Business rules.

None is hard-coded, logged or sent to the browser, apart from the published defaults of the limits. Photo signing keys are generated by the app and kept only in Postgres (Photo URLs in Business rules).

### Server boundary (DP-41, DP-42, DP-83, DP-85, DP-108)

- **Same origin only.** Any non-GET request whose `Origin` header names a different origin answers `403 {"error":"cross_origin"}`. No CORS headers are sent.
- **Size limits.** A JSON body of exactly 65,536 bytes is accepted, and one byte more answers `413 {"error":"payload_too_large"}`. A multipart request of up to 8,500,000 bytes inclusive is accepted. An import body of up to 1,000,000 bytes inclusive is accepted. A chunk of up to `UPLOAD_CHUNK_BYTES` bytes inclusive is accepted. More than any of these answers the same 413. The per-photo limit is owned by Business rules.
- **What is served.** The server serves only its built browser assets, the API, the signed paths under `/media/`, `/healthz`, `/readyz` and the app's page at each app URL from Screens and layout. Source files, `run.json`, `package.json`, lockfiles, environment files and any path with `..` answer 404.
- **Dependencies at boot.** If Kill Bill or Mailpit is unreachable at boot, the app still starts. It recovers on its own as stated in Business rules and Services.
- **Stateless instances.** No instance keeps a source of truth in process. A cookie from one instance works on all, and signing out on one ends the session on all. Idempotency claims, locks, allowances, upload state, signing keys, jobs, stream events and vet-link state all work from any instance.
- **Request-scoped identity.** Simultaneous requests from different sessions and API tokens on one instance never share caller state. Each response carries only its own caller's identity, records and role-shaped fields: for example, with the seed data at start, Ada's horse list holds only Juniper and Pilot and Bram's only Saffron and Quarry, however their requests interleave with each other and with the farrier's.
- **Grading instances.** Besides the primary instance, grading serves the same build as extra instances on later ports. Each shares the primary's database, bucket and every other setting, and changes only the environment listed here:
  - `killbill-down`: `KILLBILL_URL` points at a closed port, `VET_LINK_TTL_SECONDS` is `20` and `BOOKING_HOLD_SECONDS` is `15`;
  - `mailpit-down`: `SMTP_HOST` and `SMTP_PORT` point at a closed port;
  - `peer`: `INSTANCE_LABEL` is `peer`;
  - `fast-clock`: `DUNNING_DAY_SECONDS` is `2`, `JOB_BACKOFF_BASE_SECONDS` is `1`, `JOB_LEASE_SECONDS` is `3`, `WAITLIST_OFFER_SECONDS` is `6`, `REMINDER_SCAN_SECONDS` is `2`, `IDEMPOTENCY_LEASE_SECONDS` is `3` and `BOOKING_HOLD_SECONDS` is `15`.

  Grading may also start the manifest's `serve` command as its own process with changed environment, including `CLOCK_OFFSET_SECONDS`, `PHOTO_URL_KEY_ROTATE_SECONDS`, `PHOTO_URL_TTL_SECONDS`, `RATE_*` overrides and a `KILLBILL_URL` that points at a test proxy, and optionally a fresh database and bucket. Pending invoices, queued emails, jobs and vet-link miss counts live in Postgres. Every running instance that can reach a service works through the pending items, claiming each one so it is delivered exactly once across all instances. A request-queued email's first attempt stays with the instance that queued it, and a background-queued email can be claimed by any instance (Services). This is how billing or mail coming back is observed. Work left pending on an outage instance completes without any restart. It completes only after any retry hold-off that applies to it, and within the delays in Business rules and Services.

### Browser support and performance (DP-44)

- **Browsers.** Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800.
- **Responsiveness.** A day sheet, horse panel or dashboard is usable within three seconds of navigation or reload on the seeded data. A divider key press visibly moves the divider within a tenth of a second.

## Working rules

- **IF-01** `/app/run.json` exists with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- **IF-02** `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its name, version and licence. Shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- **IF-03** Every shipped package and bundled font uses one of these licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense, OFL-1.1, LGPL-3.0-only or LGPL-3.0-or-later.
- **IF-04** The app stores data only in Postgres and the MinIO bucket: no SQLite, Redis, other databases, in-process stores shared across requests as a source of truth, or app data written to local files.
- **IF-05** The provided service configuration and compose files stay unchanged.
- **IF-06** `/app/package-lock.json` is committed and matches `package.json`.
- **IF-07** The browser loads no fonts, scripts or styles from any third-party host.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` on domain data. Names use the domain terms in this brief: barn day, slot, booking, booking number, hold, live booking, offer, trip share, adjustment, excuse, deposit, waitlist, visit, hoof marks, marks version, alignment, vet link, live pair, signing key, dunning, ledger.
- Each domain rule is decided in exactly one place in the source:
  - each state transition, for barn days, bookings, visits, payments, dunning and jobs;
  - the derived full status and booked count;
  - hold lapse and the offer pass;
  - the start instant, the cancellation cutoff and the decision instant;
  - the trip-split rule and the excuse pool rule;
  - the deposit outcome and deposit credit;
  - the angle and alignment rule, and the stored-photo bounds;
  - the marks version check;
  - next-due status;
  - the effective price lookup;
  - role field projection;
  - the allowances and the vet-link guess limit;
  - the vet link's live pair;
  - the ledger's mapping to dashboard figures.
- Every error response is built through one consistent error shape, and the error precedence is applied the same way on every route.
- Every race this brief names is settled by Postgres locks or constraints, never by in-process locks, timers or check-then-write sequences.
- There is no abstraction with a single implementation and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Calls to Kill Bill, SMTP and MinIO carry explicit timeouts. Failures are handled by the documented pending, outbox, job or 503 paths, never swallowed.
- There are no features, routes, screens or settings beyond this brief.
