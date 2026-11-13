# Halfsheet Works Stationhouse

Stationhouse is a booking desk for one shared commercial kitchen. The kitchen rents ranges, prep tables, mixers and walk-in cooler shelves by the hour to caterers, food-truck owners and cottage bakers.

Tenant cooks:
- buy prepaid hour packs, confirming their password again before any larger pack is charged
- upload their certificate of insurance and food-handler card
- claim stations from an isometric floor plan by dropping a slab onto the station they want, by mouse, finger or keyboard
- pair a walk-in cooler shelf with a station for the same span from that station's dialog
- move a confirmed booking once, the same way they claimed it, without giving up the old slot first

An hour rail under the plan shows how many cooler shelves stay free through the day. Each booking receipt and each pack shows whether its email has actually reached the mail server. Each document shows whether it still covers the tenant, as the server judges it in kitchen time, and a fingerprint that proves the stored file is the one uploaded.

The kitchen owner:
- approves tenants and reviews their documents, including superseded ones kept as evidence
- sees whether each expiry reminder actually reached its tenant
- refunds the unused hours of a pack after confirming their password
- keeps a bookmarkable daily usage report open, drawn as isometric bars over its tables, while it updates itself

The shift lead works the door from a shared tablet or a phone, by touch or keyboard. They see who is booked today and who is cleared to cook, and they hear changes other staff make. They check tenants in and out; each door card turns over to show its new state, and a cleanup log records who did each action.

Build it as one web app with its own server. It uses four backend services:
- **Postgres** is the only system of record. It also holds the mail queue and every piece of state that app processes share.
- **Kill Bill** bills hour packs and issues refunds.
- **MinIO** (S3-compatible object storage) holds document files.
- **Mailpit** is the SMTP server for email.

Out of scope:
- card capture (the kitchen takes payment at the counter, and the app records it in Kill Bill against an external payment method)
- the monthly minimum-rental fee
- multiple kitchens
- sign-in through a third-party identity provider
- password reset
- any datastore, cache or queue other than the four services named here

## Problem and users

A shared kitchen is usually run by one owner. Today bookings arrive by text message and a shared calendar. Hour-pack balances live in a spreadsheet. Certificates of insurance and food-handler cards sit in an email inbox. Each gap costs the owner money or risk:
- Two tenants turn up for the same range at six in the morning.
- A tenant's liability certificate lapsed last week and they keep cooking. That puts the kitchen's own health permit and insurance at risk. When an inspector or insurer asks later, the owner cannot produce the exact certificate that was on file on a given day, because the renewal overwrote it.
- Two bookings go in at once and a tenant books more hours than their pack holds. Balances drift, and at month end there is an argument about how much of a half-used pack to refund. Sometimes the amount changes while the owner is looking at it, or a tenant books against the pack at the very moment it is refunded.
- A tenant at the counter presses Buy twice, or presses it again after the shop's wifi drops or the page reloads, and is charged twice. A second register tab retries the same purchase. Afterwards nobody can tell from the screen whether the purchase went through.
- A tablet left signed in at the counter lets anyone who walks up buy a forty-hour pack on someone else's account. An unattended office computer lets anyone refund a pack.
- A stuck finger or a runaway script fires claim after claim and floods the floor with holds.
- The counter tablet's clock drifts, sometimes by days. Countdowns, "today", which mornings can still be booked, whether a cancellation still returns hours and whether a certificate still counts all read wrong. The door tablet's clock is off too, so its buttons open at the wrong time, and the office computer opens the report on the wrong day.
- The counter tablet passes from tenant to tenant, and the next tenant sees the previous one's tickets, even by pressing Back. A tenant who browses to a hostile page on that tablet must never have it cancel their booking or buy a pack.
- A session ends halfway through a document upload, and everything typed is lost.
- The walk-in cooler is often the real bottleneck. A production run needs a range and a cooler shelf at the same time, and a room calendar cannot hold both together or show how full the cooler is through the day.
- Plans change. A tenant who needs another morning has to cancel and hope the slot is still there.
- A hold nobody confirmed keeps a range blocked long after it should have lapsed.
- Reminder emails about expiring certificates arrive twice or not at all. Nobody can tell whether an expiry reminder, a booking confirmation or a pack receipt actually went out, and a mis-addressed email can show one tenant another tenant's name.
- When something goes wrong at the door, nobody can say which staff member checked a tenant in. On slow shop wifi the door list refreshes mid-tap and shows a check-in before it is confirmed. A shift lead working by keyboard loses their place after every action and never hears that the owner has checked someone in from the office.
- Error messages that read like a vague "invalid request" leave the tenant guessing what to fix, and the reason a claim was refused blinks off before they can read it.

Every station also needs a cleanup buffer after each use. No tenant should ever see who else is cooking.

- **Kitchen owner** (daily) wants every station and cooler shelf earning without double-bookings, and only tenants with valid insurance and food-safety documents cooking. They approve tenants, open tenants' documents (current and superseded), check notice delivery, refund the unused hours of packs and read the daily usage report.
- **Tenant cook** (weekly) claims the station hours and cooler shelf a production run needs and pays from a prepaid hour pack. They move a booking when plans change, get an email and an on-screen receipt as proof, and keep their own documents current. They often work from the shared counter tablet.
- **Shift lead** (daily) checks tenants in and out at the door, logs cleanup, and sees who is allowed on the floor right now. They often work from a phone or the door tablet. They have no access to money, documents or tenant records.

## Journeys

1. **Apply and get approved.**
   - **Start:** a new business has no account.
   - The cook opens Apply and enters business name, contact name, email and password. If two fields fail, they hear how many need attention, follow each link to its field, fix it and send again with everything they typed still in place.
   - They land on Documents with focus on "Your documents" and status "Applied". Back does not reopen the filled form.
   - They start uploading a certificate of insurance while the page refreshes itself in the background. The half-filled form stays exactly as it was. If the session ends halfway through, they sign back in on the same tablet and find the form restored, waiting for them to press Upload.
   - They upload the certificate and a food-handler card. Each row shows its cover ("Valid") and a short fingerprint of the stored file. Their status changes to "Waiting for review".
   - The owner signs in, opens Tenants, opens the business, opens both documents and presses Approve. The owner stays on the tenant's page with focus on its heading.
   - **End:** the owner's Tenants table shows "Approved". Within a few seconds the tenant's Documents page also shows "Approved" and announces the change, and the tenant's form is untouched.
2. **Buy an hour pack at the counter.**
   - **Start:** an approved tenant with no packs is on the counter tablet.
   - On Hour packs they press "Buy 20-hour pack". Because it is a larger pack, the page asks them to confirm their password in a small dialog; once they do, the same purchase continues by itself.
   - They may press twice, or the network may drop the answer. They hear exactly one outcome per press. They press again, perhaps after reloading the page, which tells them once that the last purchase didn't finish. Either way the page resends the same purchase instead of starting a new one, and the failure message stays on screen through the page's refreshes. A retry from a second register tab gets back the same pack.
   - The new pack's panel reads "Receipt email: Queued" until the mail server has the receipt, then changes in place to "Sent" with its time.
   - They sign out. A second tenant signs in on the same tablet without reloading.
   - **End:** the first tenant has exactly one new pack showing its full balance, with one Purchase line in its ledger table. One receipt email, addressed to that tenant by name, arrives, and their Kill Bill account holds one paid invoice for the pack price. The second tenant never sees any of the first tenant's tickets, packs or pending purchase: not from a late answer, and not by pressing Back.
3. **Claim a station, with or without a cooler shelf.**
   - **Start:** an approved tenant with a pack is on the Board. It opens on the kitchen's today even if the tablet clock is wrong.
   - They drag across the hour rail to pick a span. Every station block rises or falls to show how full it is in that span, and the cooler strip shows how many shelves are free. If the server says the span has already started, or is more than 60 days out, the slab and claim buttons are disabled with a hint, whatever the tablet clock says.
   - **Station alone.** They drag the slab from the ticket column onto a free range by mouse or finger (a finger drag never scrolls the page), or lift it with the keyboard and step it across the station grid. The slab drops onto the block.
   - **Station with a shelf.** They tap a range to open its dialog, choose a walk-in shelf and press the claim button. Both the range block and the shelf block rise, and the cooler strip drops.
   - Once the server holds the booking, the free-minutes numeral counts down. A ticket card appears marked Held, counting down from the server's hold time. The pack shows those hours on hold; a paired booking holds twice the span's hours.
   - They press "Confirm booking", even in the last second of the hold. The card reads "Confirming…" until the server answers.
   - **End:** the card reads Confirmed with the line "Free cancellation until" and the cutoff, and a confirmation email arrives. The receipt reads "Confirmation email: Queued" until the mail server has the email, then "Sent" with its time, changing in place. Other outcomes:
     - If another cook won the same window a moment earlier, the slab lifts back off and the block shows "just taken".
     - If the claim is refused for any other reason, for example documents that don't cover the date, a span that started while the slab was lifted, or too many claims in the last minute, the slab returns and the server's exact reason is shown and announced. It stays on screen through every refresh until they try again or change the span.
     - If a hold they were racing against has already run out, their claim is held at once.
   - Later they open a bookmarked receipt link while signed out. They sign in and land back on that receipt.
4. **Move a booking.**
   - **Start:** a tenant has a confirmed booking more than a day away that has never been moved.
   - They pick another date and span on the rail; the booking's card stays in the column whatever date they pick. They press "Move booking" on the card, step the drop target to a station and press Enter, or drag the card onto a station by mouse or finger.
   - **End:** the old block falls and the new block rises together. The card takes its new name and keeps focus, and any change in hours shows in the pack's ledger. A booking-moved email arrives, and the receipt gains a "Move email" line below the confirmation line. If another tenant won that window, the card stays as it was, the old slot is still theirs and the target station shows "just taken".
5. **Cancel and get hours back.**
   - **Start:** a tenant on the counter tablet, whose clock is days off, has a confirmed booking more than a day away. Its card reads "Free cancellation until" with the server's cutoff.
   - They press "Cancel booking". The inline step opens with focus on "Keep it" and says how many hours they'll get back. They move to "Yes, cancel" and press it.
   - **End:** the card reads Cancelled and keeps focus, the status line reports the hours returned, the pack balance is back where it was, and the station is free again on the floor plan. If the shift lead checked them in a moment before, the card shows "Checked in" and says the booking can no longer be cancelled. For a booking already past its cutoff, the card and the step say no hours will be returned.
6. **Work the door.**
   - **Start:** the shift lead signs in on a phone, or on the door tablet whose clock runs hours off, on a day with bookings.
   - The door list opens on the kitchen's today and announces how many bookings there are and how many are cleared. Each booking shows its status, "Cleared" or "Not cleared" with the reason, and exactly the door buttons the server allows right now, or "Check-in opens" with the opening time.
   - Working by keyboard over slow wifi, they check a cleared tenant in. The card reads "Checking in…" through any background refresh until the server answers. Then it turns over to show its new face, focus lands on that door card, and it shows the time and their name.
   - When the owner checks another tenant in from the office, the shift lead's list shows it within a few seconds and announces it once.
   - Later they open Check out, tab around inside the dialog, press the submit button without ticking the cleanup box and hear the error linked to the box. They tick it and start a note. The list refreshes in the background without losing what they typed, and they check the tenant out.
   - **End:** focus rests on the card, which has turned over again, reads Completed and shows both log lines. A tenant whose certificate lapsed shows "Not cleared" and cannot be checked in.
7. **Run the owner's day.**
   - **Start:** the owner opens Report on an office computer whose clock and time zone are days off, and it lands on the kitchen's today. Then they open a bookmarked Report link for tomorrow's kitchen date.
   - Isometric bars grow to show each station's booked minutes, above minutes per station and per tenant for exactly that date, and they hear its total once. As tenants confirm and cancel bookings for that day, the bars, tables and total change in place within a few seconds, each total change is announced once, and their focus and scroll stay put. They press Next day, then Back, and return to the first date's report, hearing each settled date once.
   - They open a tenant and keep the page open. Cover states, notice lines, balances and refundable amounts update in place. They find a partly used pack with nothing booked on it and press Refund against the amount on screen, confirming their password when asked. If a late cancellation has just changed that amount, they are told the new amount and press again. If the tenant is claiming against that pack at the same moment, either the refund is refused because the pack is in use, or the claims are refused.
   - **End:** the pack reads Refunded with zero balance and the prorated amount, focus is on that pack's heading, and Kill Bill shows one refund of that amount.
8. **Renew after a lapse.**
   - **Start:** a suspended tenant whose certificate lapsed is on Documents. The page shows "Suspended — certificate of insurance lapsed" and the old certificate's cover reads "Lapsed". They have already had one "expires today" email for the old certificate.
   - They upload a renewed certificate.
   - **End:** status returns to "Approved", the old certificate reads "Superseded" and the new one "Valid", and they can claim stations again. The old certificate sends no further notices. When the owner opens the superseded certificate, it opens with exactly the bytes the tenant uploaded and the same fingerprint it has shown since upload.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** The app installs, builds and serves from /app/run.json on the primary port and answers the health check, as qualified in Deployment.
- **DP-02 — Server boundary** The server accepts state changes from its own origin only, enforces the request size limits, never serves source files or credentials, and keeps serving when Kill Bill, object storage or mail are unreachable, as stated in Server boundary. Every response except the document file route carries the published security headers, no response allows another origin to read it, and the door list and report refuse a foreign Origin, as stated in Server boundary.
- **DP-03 — One error shape and order** Every API error uses the single error body, the published messages and the single precedence order stated in API and Server boundary.
- **DP-04 — Responsive ticket-rail layout** Every screen uses the ticket-rail layout from 1024 px wide, stacked two-column cards from 600 to 1023 px and a single column below 600 px, with no horizontal overflow at any width, as described in Screens and layout.
- **DP-05 — Accessible controls and keyboard** Every control in Public screens and controls carries its listed role and accessible name, sits in the stated Tab order, and works with the keys described in Interactions.
- **DP-06 — Order-ticket visual identity** Screens use the paper ground, charcoal ink, grey hairline rules, the tomato accent reserved for claims and conflicts, the ochre held colour, and the condensed display face over the plain body face, as described in Visual design.
- **DP-07 — Procedural floor plan** Station blocks, shelf blocks, the cooler outline, the cooler strip, hatching, cleanup bands, slabs and the Report's usage bars are vector drawings generated from data in the browser at runtime, not images or pre-drawn artwork.
- **DP-08 — Configuration from environment** Every service URL and credential is read from the environment variables named in Configuration and secrets and never appears in source or in code delivered to the browser.
- **DP-09 — Reduced-motion path** With reduced motion requested, heights, numerals, slabs, door cards and usage bars jump to their final state, and every claim and move result is still shown as text and announced, as described in Motion and effects.
- **DP-10 — Sign-in and sessions** Seeded and newly applied accounts sign in with email and password, subject to the sign-in limit in Business rules, receive a session cookie that every app process sharing the database accepts, and see only the navigation for their role.
- **DP-11 — Tenant application** A new business applies with business name, contact name, email and password and becomes a signed-in tenant in the applied state, while names containing control characters are refused as stated in Business rules.
- **DP-12 — Tenant onboarding states** Tenant status moves between applied, documents_pending, approved and suspended only along the edges in Business rules, and every other edge is refused with the conflict stated there.
- **DP-13 — Owner approval journey** The kitchen owner opens Tenants, reviews a pending tenant's documents and approves them, and the status reads Approved in the owner's table and on the tenant's own Documents page.
- **DP-14 — Document upload checks** Uploads accept only PDF, PNG or JPEG content within the size limit, judged by the file's bytes rather than its name, with the insurance fields and expiry checks stated in API and Business rules.
- **DP-15 — Private document files** Each document file is stored as a private object under the published key and served back only to its tenant and the owner, with headers that stop the browser running it.
- **DP-16 — Storage outage and recovery** While object storage is unreachable, uploads answer 503 with the published message and save nothing and file reads answer 503, and both work again once storage returns, without restarting the app.
- **DP-17 — Documents page journey** A tenant cook uploads a certificate of insurance and a food-handler card on the Documents page and sees both listed with their expiry dates and an Open link.
- **DP-18 — Pack purchase billed in Kill Bill** Buying an hour pack creates and pays one Kill Bill invoice on the tenant's account before any hours are credited, and leaves no charge, credit or email behind when billing fails, as qualified in Services. Buying a 20- or 40-hour pack and refunding a pack need a password confirmed within the step-up window, are refused with 403 reauth_required otherwise, and the page asks for the password in a dialog and resends the same request, as stated in Business rules and Interactions.
- **DP-19 — Retried purchase charges once** Repeating a pack purchase with the same idempotency key returns the original response and produces one invoice, one credit and one receipt. A same-user same-key equal-body purchase repeat returns the stored 201 byte for byte with Idempotent-Replay on every app process before any Kill Bill call, simultaneous same-key purchases make one invoice and one payment, and a different body answers 409 idempotency_conflict with no Kill Bill call, as stated in Business rules.
- **DP-20 — Hour ledger balances** Every pack movement is written as two equal and opposite ledger entries, and each pack's balance always equals the sum of its pack-side entries.
- **DP-21 — Pack receipt email** Each paid pack queues one receipt email to the buying tenant with the hours, amount and invoice reference, addressed and worded as described in Services.
- **DP-22 — Buy a pack journey** On Hour packs a tenant cook buys a pack, confirming their password when the page asks, and sees the new balance and a Purchase line in that pack's ledger table.
- **DP-23 — Hour rail span** The hour rail selects a kitchen-local span within operating hours in half-hour steps, by pointer or touch drag or arrow keys, and the page never scrolls during a finger drag on the rail.
- **DP-24 — Station stack heights** Each station block's extrusion, cleanup band, hatch and label follow the selected span, as defined in Motion and effects and Feedback states.
- **DP-25 — Claim by dropping a slab** A tenant cook drags the span slab onto a free station by pointer or finger, with the page never scrolling during a finger drag and a light tap on a station opening its dialog instead, sees the slab land, then once the server holds it sees the free numeral count down and a ticket card go from Held to Confirmed after confirming.
- **DP-26 — Just-taken retract** When the server gives the window to someone else, the slab lifts off and fades, the block and numeral move to their true values, and a just-taken label appears that names no tenant.
- **DP-27 — Claim holds a station** A valid claim creates a held booking that blocks its station, and its paired walk-in shelf when one is chosen, for the span plus the cleanup buffer for everyone.
- **DP-28 — One winner per window** Of any number of simultaneous claims that overlap on any station they would occupy, exactly one is held and every other one answers 409 slot_taken, never 5xx.
- **DP-29 — Hold expiry** A held booking that is not confirmed within the hold time is cancelled by the server with reason hold_expired, and its stations and its reserved pack minutes free up without any further request.
- **DP-30 — Confirm debits the reserved pack** Confirming a live hold debits the booking's minutes from the pack it reserved as one paired ledger movement, with only the hold expiry and document checks re-run, as qualified in Business rules.
- **DP-31 — Booking confirmation email** Each confirmed booking queues one email to its tenant with the station, shelf, kitchen-local date, start and end, and hours debited, and each move queues one booking-moved email, as described in Services.
- **DP-32 — Booking shape rules** Claims and moves whose station, shelf, length, alignment, start time, booking horizon or operating hours break the booking shape rules in Business rules, including an unknown station or shelf id, are refused with 422.
- **DP-33 — Kitchen time zone** Operating hours, the cancellation cutoff, door dates, report dates and every displayed or emailed time use the kitchen's configured time zone, whatever the browser's zone.
- **DP-34 — Document cover edge** A tenant can book spans on or before the expiry date of each of their current documents and is refused for any span on a later kitchen-local date.
- **DP-35 — Cancellation cutoff and refund** Cancelling a confirmed booking at or before its current cutoff credits its current debited minutes back as a paired movement, cancelling after the cutoff returns nothing, and simultaneous cancels of one booking succeed once and credit at most once, as qualified in Business rules.
- **DP-36 — Cancel from a ticket** A tenant cook cancels a booking from its ticket card and sees the card read Cancelled, the hours result in the status line, and the station free again on the floor plan.
- **DP-37 — Door list clearance** The door list shows every booking for the chosen kitchen date with its tenant and whether that tenant is cleared for the floor on that date under the server's document rule.
- **DP-38 — Check-in, check-out and no-show** Staff move bookings to checked_in, completed and no_show only along the edges and inside the windows stated in Business rules, and of simultaneous door actions on one booking exactly one succeeds.
- **DP-39 — Shift lead door journey** A shift lead checks a cleared tenant in from the door list, later checks them out with a cleanup log, and sees the card read Completed with who checked the tenant in and out.
- **DP-40 — Role-shaped responses** Floor, booking, door and account responses carry exactly the field list published for the caller's role, so a tenant never receives another tenant's name, email, booking id or the door log.
- **DP-41 — Other tenants' records stay hidden** A tenant who asks for another tenant's document, document file, booking, pack or tenant record by id gets 404.
- **DP-42 — Booking receipt** A tenant cook opens Receipt from a ticket card and sees a receipt with the station, shelf, kitchen-local date and times, hours debited and status.
- **DP-43 — Pack refund through Kill Bill** The owner refunds an active pack with hours left and no hold or upcoming booking on it, which records exactly one Kill Bill refund keyed to the pack and a paired reversal that brings the balance to zero, even when refunds are pressed simultaneously, as qualified by the amount check in DP-82 and the password check in DP-18.
- **DP-44 — Daily usage report** The owner's daily usage report totals booked minutes per station and per tenant for one kitchen-local date, counting a paired booking on both its stations, on the Report screen and through the API. An open Report re-reads its date every 10 seconds, updates changed tables and total in place within 12 seconds without moving focus or scroll, and announces each change of the total once. The Report draws one isometric 3D bar per station whose height follows the published scale, grows into place for each settled date, and always matches the date in the URL, as described in Screens and layout and Motion and effects.
- **DP-45 — Expiry notices** Each current document of an approved or suspended tenant gets a notice email with the published subject and lines at each notice point in Business rules, sent only to its own tenant.
- **DP-46 — Keyboard slab claim** With the keyboard alone a tenant lifts the slab, moves a drop target across the station grid hearing each station's label, claims with Enter or Space and returns it with Escape, as described in Interactions.
- **DP-47 — Holds reserve pack hours** A held booking reserves its minutes on one pack, each pack reports held and available minutes derived from its live holds, simultaneous claims never reserve more than a pack's balance, and claims and a refund of the same pack are judged one after another so a refunded pack never carries a hold or upcoming booking.
- **DP-48 — Only published body fields** Every JSON and multipart request body accepts only its published fields, and any other field fails with 422 naming it while nothing is written.
- **DP-49 — Honest ticket cards** Ticket and door cards and the floor stack change only after the server answers 2xx, and a refused action re-reads the booking and shows its true status with the rule copy from Feedback states.
- **DP-50 — Role table on every route** Each API route answers only the roles in the role table in API, with unknown and other tenants' ids answering 404 before the role check answers 403.
- **DP-51 — Keys belong to the caller** An Idempotency-Key belongs to the signed-in user and the endpoint, so another user's identical key runs fresh and never replays someone else's response, while a user's own replays still work after signing in again.
- **DP-52 — Screens live in the URL** Board, Report, Tenants, tenant detail, Hour packs, Documents and Receipt screens live at the published URLs, so reload, deep links, Back and Forward restore the same view, invalid parameters fall back to defaults, and sign-in returns to the requested screen under the DP-67 rule.
- **DP-53 — Each notice sent once** Each document notice point is claimed once in Postgres, so several app processes sweeping one database and app restarts still queue exactly one email per point, and superseded documents and past dates queue none.
- **DP-54 — Mail queued with its action** Every email is queued in Postgres together with the action that caused it and delivered by one app process at a time until the mail server acknowledges it, so the action succeeds while mail is unreachable and its email arrives once any process reaches mail, as qualified in Services.
- **DP-55 — Station and shelf claimed together** A tenant pairs a walk-in shelf with a station from the station dialog, and the paired booking occupies, reserves and debits both stations' minutes or neither.
- **DP-56 — One debit per confirmation** Any number of simultaneous confirms of one live hold all answer 200 and leave one booking_debit movement and one queued email, and a confirm of a never-confirmed hold that starts after its expiry by the database clock answers hold_expired and writes nothing, while an already confirmed booking answers 200 at any time, as qualified in Business rules.
- **DP-57 — Prorated refund of unused hours** A pack refund returns floor(priceCents × balanceMinutes ÷ purchasedMinutes) cents, and that amount appears in the pack's refundableCents beforehand and in its refundedCents, the Kill Bill refund and the success copy.
- **DP-58 — Sign-in attempts are limited** After five failed sign-ins for one email within the sign-in window, every app process answers 429 with Retry-After for that email, whether or not an account uses it, as stated in Business rules.
- **DP-59 — Errors reveal nothing internal** No error body or header carries a service host, bucket, object key, credential, stack frame or driver text, and outage, unreadable-body and unexpected errors use the messages published in Server boundary.
- **DP-60 — Claim refusals are shown and announced** A claim refused for approval, documents, hours, shape or the claim limit returns the slab, leaves the station unchanged, adds no card and shows and announces its refusal copy, as described in Interactions. Claim and move refusal copy stays verbatim beside the slab, the dialog claim button or inside the ticket card through every floor refresh, countdown tick and span-status flip until the next claim or move, a span or date change, or leaving the Board, and a refused dialog stays open with its shelf and focus.
- **DP-61 — Door actions are logged once, by name** Each successful door action appends one door-log entry naming the staff member and time in the same step as its transition, entries are never edited, and staff see the log on the booking and the door card. After a successful Check in, Check out or Mark no-show the door card turns over in 3D as described in Motion and effects, never before the server answers or on a refusal, and with reduced motion its new face shows at once.
- **DP-62 — Emails address the tenant safely** Every email has exactly one To recipient whose display name is the tenant's contact name exactly, safely encoded, with no Cc, no Bcc and no Reply-To other than the sender.
- **DP-63 — Emails carry only their tenant's own facts** No email contains a link, storage key, presigned parameter, storage endpoint, bucket, attachment, or another tenant's name or email.
- **DP-64 — One purchase per press** Each press of a buy button is one purchase attempt with one Idempotency-Key, further presses while it is pending send nothing, and the next press after a network failure, purchase_pending or idempotency_in_progress resends the same key and body, as described in Interactions.
- **DP-65 — Expired holds free their stations at the edge** A hold whose expiry is at or before the start of a claim's own database transaction never blocks that claim or counts against its pack, even before any sweep, while a claim starting before the expiry still gets slot_taken, as stated in Business rules.
- **DP-66 — Keyboard cancel with a safe default** The inline cancel step opens with focus on Keep it, Escape or Keep it sends nothing and returns focus to Cancel booking, and Yes, cancel sends exactly one request and leaves focus on the ticket card showing the server's status.
- **DP-67 — Sign-in returns only inside the app** After sign-in the app follows next only when it passes every check in Interactions, and otherwise lands on the Board without requesting another origin or writing the rejected value into the page.
- **DP-68 — Published landing after each action** Sending an application, signing in, signing out, approving a tenant and a request answered 401 each land on the screen with the history effect and focus stated in Interactions, and Back never re-shows a signed-out user's records.
- **DP-69 — Documents keeps the upload form through refreshes** The Documents page refreshes its status and table every 10 seconds and announces each status change once, without resetting any form value, chosen file, field error, focus, caret or pending upload.
- **DP-70 — Door actions decided by the server clock** Each door entry carries the server-computed check-in opening time and open actions, and door cards show exactly those buttons and the check-in opening line whatever the device's clock or time zone. A door card with an action pending keeps its pending copy and disabled buttons through every door refresh, changes only on that action's own answer, and never announces its own action as a door change, as described in Interactions.
- **DP-71 — Nothing outlives its user** Every response is computed for its own request's session, and signing out or in discards every in-page record of the previous user, including an open purchase attempt and its key, before anything is shown for the next user, with only the same-user exceptions in DP-78 and DP-79.
- **DP-72 — Notice status follows the mail server** Each document lists its claimed notice points as queued until the mail server has acknowledged the email and only then as sent with its time, and the owner's tenant detail shows the same lines.
- **DP-73 — Latest span wins** The station stack, labels, station hooks, cooler strip, ticket or door column and URL always reflect the last span and date chosen, whatever order floor responses arrive in, and a superseded response never shows failure copy.
- **DP-74 — Refreshes keep what the user is doing** The floor, door, packs and countdown refreshes never drop a lifted slab or lifted Move booking, drop target, drag, open station dialog, open cancel step, open Check out dialog or open password dialog, never reset their values and never move focus.
- **DP-75 — Held countdown follows the server clock** Held countdowns, the Board's default date, the Today button and the kitchen clock text follow the server's clock as estimated from its responses, whatever the browser's clock or zone, as qualified in Interactions.
- **DP-76 — Collapsed navigation is unavailable** Below 600 px wide the navigation and Sign out sit behind a Menu disclosure, and while it is collapsed they are not focusable, not announced and not clickable.
- **DP-77 — Failures point to their fields** Sign in and Apply announce their failures in Kitchen updates, Apply lists each failing field as a link that moves focus without changing the URL or history and keeps everything typed, and a failed sign-in keeps its next value, as described in Interactions.
- **DP-78 — Interrupted upload resumes** An upload form interrupted by a 401 is restored with its values and chosen file when the same account signs in without a reload, is never sent without a press, and is gone for anyone else, as described in Interactions.
- **DP-79 — Purchase attempt survives refreshes and reloads** Buy outcome copy and the Retry purchase tag survive every packs refresh, an open purchase attempt survives a reload in the same tab for the same user and resends its key on the next press, and the other buy buttons stay disabled while it is open.
- **DP-80 — Pending actions outrank timers and late reads** A card with a confirm pending reads Confirming… even at countdown zero, a confirm that ended in a network failure re-reads the booking at zero, and a floor or booking response sent before the user's latest claim, confirm, move or cancel was answered never changes a card, block, numeral or the column.
- **DP-81 — Late answers from an earlier sign-in are ignored** A response to a request sent under a previous sign-in is ignored entirely, including a late 401, and every /api response except the file route carries Cache-Control: no-store.
- **DP-82 — Refund matches the amount on screen** A refund states the amount the owner saw, a difference from the amount computed under the pack's lock answers 412 refund_amount_changed with nothing sent to Kill Bill, and the screen then shows the new amount and refunds only after another press.
- **DP-83 — Report matches its URL** After any sequence of Previous day, Next day, Today, Back and Forward, the Report bars, tables and total show only the date in the URL, and a superseded response never changes the screen or shows failure copy. Report's default date, its fallback for a missing or invalid date and the date Today goes to are the kitchen's today by the server clock, and Previous day and Next day step kitchen calendar dates, whatever the browser's clock or zone.
- **DP-84 — Tenant detail updates in place** The owner's open tenant detail shows notice lines, status, balances and refundable amounts changing in place within 12 seconds, announces each Queued to Sent change once, and never moves focus or scroll or re-requests a document file on a refresh. Each document carries the server's coverState and daysLeft in kitchen time, and Documents and tenant detail show only those values as the published cover labels, whatever the device's clock or zone.
- **DP-85 — One move per booking** A tenant moves a confirmed booking once at or before its current cutoff, with its occupancy, minutes, ledger movement and booking-moved email changing in one step, extra minutes coming only from its own pack, and no moment when a rival can take the old slot, as stated in Business rules.
- **DP-86 — Move from the ticket card** A tenant presses or drags Move booking and drops it on a station by pointer, touch or keyboard for the rail's chosen span and date, and on success the old block falls, the new block rises, and the renamed card keeps focus, as described in Interactions.
- **DP-87 — Cooler strip** The hour rail draws 36 half-hour cooler cells and a shelves-free line from the same occupancy as the floor, buffers included and expired holds excluded, so they change with every claim, move, cancellation and span change.
- **DP-88 — Booking emails show delivery** Each booking lists its confirmation email, and after a move its booking-moved email, as queued until the mail server has acknowledged it and only then as sent with its time, and the receipt shows the same lines and updates them in place, as described in Interactions.
- **DP-89 — Server decides whether a span can be booked** Each floor answer carries the server's spanStatus for the chosen span, and while it is not open the slab, the dialog claim button and Move booking are disabled with the published hint, whatever the device's clock or time zone.
- **DP-90 — Door work by keyboard** Door cards are focusable, focus lands on the door card after Check in, Mark no-show and Check out, and the Check out dialog keeps Tab inside it and links the server's cleanup-box error to its checkbox, as described in Interactions.
- **DP-91 — Cross-site requests refused** A state-changing request whose Origin is foreign or null, or whose Origin is absent while its Sec-Fetch-Site is anything other than same-origin, answers 403 cross_origin before authentication and changes nothing, as stated in Server boundary.
- **DP-92 — Report and refund results announced once** Report announces its daily total exactly once for each date that settles in the URL and never for a superseded one, and each refund outcome is announced once with focus landing as described in Interactions.
- **DP-93 — Pack receipt delivery shown** Each pack reports its receipt email as queued until the mail server has acknowledged it and only then as sent with its time, and its panel's receipt line updates in place on the packs refresh without clearing the buy outcome copy.
- **DP-94 — Documents kept as submitted** Each stored document file is byte-identical to the uploaded file, is never overwritten or reused, stays openable with exactly those bytes after it is superseded, and its SHA-256 fingerprint is published and shown, as stated in Services.
- **DP-95 — Purchase outcomes announced once** Each buy press announces exactly one outcome in Kitchen updates, a packs refresh never rewrites the live region, and each load of Hour packs that finds an open purchase attempt shows and announces the resume copy once.
- **DP-96 — Booking shape messages verbatim** Every 422 on a claim or move names each failing field with the published sentence of the first booking-shape rule it breaks, and the Board's shape refusal copy is the sentence of the first failing field in the order stationId, shelfId, start, end. Each tenant may make at most 10 counted claims in any rolling 60 seconds across every app process, and further claims answer 429 rate_limited with Retry-After and write nothing, as stated in Business rules.
- **DP-97 — Server decides whether a cancel returns hours** Each booking carries the server's cancelCreditMinutes, and the ticket card's cancellation line and the cancel step's description show only that value, updating in place whatever the device's clock or zone.
- **DP-98 — Door results announced** The door list announces its summary once for each date that settles and each status change made by someone else once, worded as in Feedback states.
- **DP-99 — Back after a tenant switch shows only the current tenant** After any sign-in, Back and Forward into the previous user's history entries re-read as the current user, and an entry naming a record the current user may not see is replaced with the Board before anything from that record is drawn.

## Frontend

### Screens and layout (DP-04, DP-10, DP-13, DP-17, DP-22, DP-42, DP-44, DP-52, DP-61, DP-76, DP-84, DP-87, DP-88, DP-93, DP-94)

The app is a single page with the screens below, each at its own path. Signed-out visitors see only Sign in and Apply. Where each action lands is stated in Interactions under "Landing after each action" and "Returning after sign-in".

| Screen | Path | Who sees it | Level-one heading |
|---|---|---|---|
| Sign in | `/signin` (optionally `?next=<path>`) | signed out | "Sign in to Stationhouse" |
| Apply | `/apply` | signed out | "Apply for a station" |
| Board | `/board?date=YYYY-MM-DD&from=HH:MM&to=HH:MM` | every role | "Board" |
| Hour packs | `/packs` | tenant | "Hour packs" |
| Documents | `/documents` | tenant | "Your documents" |
| Tenants | `/tenants` | owner | "Tenants" |
| Tenant detail | `/tenants/<tenant id>` | owner | "`<business>`" |
| Report | `/report?date=YYYY-MM-DD` | owner | "Daily usage" |
| Booking receipt | `/receipt/<booking id>` | tenant (own bookings), owner | "Booking receipt" |

`/` goes to `/board` when signed in and to `/signin` otherwise. Every screen re-reads its data from the server each time it is shown, including through Back and Forward. Tenant detail and Booking receipt draw nothing of their record, not even the receipt card's frame, until the server has returned that record for the current user.

**Sign in and Apply.** Each is a narrow centred form on the paper ground. Sign in has the product name above it and a link to Apply. Apply asks for business name, contact name, email and password. A failed Apply shows the "Check these fields" group above the form.

**Board** (every role) uses the ticket-rail composition:
- **Header.** It carries the main navigation, Sign out, the kitchen name, the kitchen clock text and the Kitchen date group.
- **Ticket column.** It holds clipped order-ticket cards: hairline-ruled cards with a notched top edge and a torn-looking bottom edge.
  - For tenants the column is "Your tickets". The span slab sits at the top, with the span hint beside it whenever one applies.
  - Whenever the Board is shown or the shown date changes, the column is listed afresh, earliest start first. It holds one card for each of the tenant's bookings that either starts on or after the shown kitchen date, or has `movable` true, whatever date is shown. So a movable booking's card, with its "Move booking" button, stays in the column while the tenant picks a later date to move it to. A card for a claim made on this Board joins the column as soon as the server holds it.
  - Once a card is in the column it stays there through every floor reload until the shown date next changes or the Board is left, even when a re-read means it would no longer be listed under the rule above. This covers a card just cancelled, a card whose move was refused or succeeded, and a card whose `movable` turned false for any other reason, such as its cutoff passing. Such a card shows its current status and buttons, and keeps focus if it had it.
  - The one exception is a hold that ran out. Its card shows "Hold expired" until the next floor reload, then leaves the column. If that card held focus, focus moves to the slab.
  - For the owner and the shift lead the column is "Door list": one card per booking on the shown date, in start order. Each door card shows its door status text, clearance text, door-log lines and door buttons. Each door card has a front face and a back face; exactly one of them is showing and carries the card's content, and the card turns over after each of this page's own successful door actions, as described in Motion and effects.
- **Floor plan.** It fills the remaining space: an isometric drawing of every station, laid out by the station grid positions in Seed data. The walk-in shelves are grouped in their own row behind a drawn cooler outline.
- **Hour rail.** It runs full width, pinned under the floor plan. It has tick marks every half hour and a monospaced numeral for every hour from 05 to 23, with the selected span shaded. Directly under the numerals is the cooler strip: 36 half-hour cells, each aligned under its half hour, with the shelves-free line beside or below them.

**Other screens:**
- **Hour packs** (tenant): a row of three buy buttons, then one panel per pack. Each panel has its pack heading and shows hours, price, status, balance and the receipt email line, with the pack's ledger table.
- **Documents** (tenant): the tenant status line, the upload form, and the "Documents on file" table. Each row shows the document's type, expiry date, cover label, upload date, fingerprint and file link.
- **Tenants** (owner): the "Tenants" table. Each business name links to its tenant detail screen.
- **Tenant detail** (owner):
  - the tenant's status
  - a Documents region with one row per document, current and superseded. Each row has its cover label, fingerprint, an Open link and its notice lines. Image files show a small inline preview; PDFs open in a new tab.
  - a Packs region with one panel per pack under its pack heading, showing the pack's balance, status, refundable or refunded amount and refund button
- **Report** (owner): a Kitchen date group, then the "Usage by station" figure of isometric bars, then the "Usage by station" table, the "Usage by tenant" table and a total line.
  - The figure draws one bar per station in seed order, left to right, each a three-faced isometric block (top, left and right faces) standing on a shared hairline floor line, with the station name under it.
  - A bar's extruded height is round(160 × the station's `bookedMinutes` ÷ the largest `bookedMinutes` among all stations) drawing units, with an exact half rounded up. Every bar is 0 tall (a flat tile) when every station has 0. For example, stations with 360, 120 and 0 minutes get heights 160, 53 and 0.
  - The figure is drawn at its natural size, one drawing unit per CSS pixel, at viewport widths of 600 and above; below 600 it scales down uniformly to fit the width. Heights are always stated in drawing units.
- **Booking receipt** (tenant and owner): a printable order-ticket card for one booking, ending with one email line per entry in the booking's `emails`.

**Layout bands.** Widths are viewport widths in CSS pixels, and each band includes both of its stated ends. No screen ever scrolls sideways at any width.

- **1024 and wider** (includes 1280x800): the ticket-rail layout.
  - The ticket column is a fixed left column about a quarter of the width and scrolls on its own. Its right edge is at or left of the floor plan's left edge.
  - The floor plan fills the rest of the width above the hour rail.
  - The rail, cooler strip included, spans the full width under the plan and is visible without scrolling the page.
  - Navigation and Sign out show in the header. There is no Menu button.
- **600 to 1023** (includes 768x1024): stacked two-column cards.
  - The ticket or door column sits above the floor plan as a two-column grid of cards. Cards in the same grid row share one top edge.
  - The plan fills the width, with the rail directly under it.
  - Navigation and Sign out show in the header. There is no Menu button.
- **Below 600** (includes 375x812): a single column.
  - The header shows the kitchen name and a "Menu" button. Navigation and Sign out sit behind it, as described in Interactions.
  - The floor plan scales down to fit the width. The rail sits under it and keeps all nineteen hour numerals, at a small size, and all 36 cooler cells, narrowed to fit.
  - The slab sits just above the plan. Ticket or door cards stack one per row under the rail.
  - Tables on other screens become stacked label-and-value rows.
  - The station dialog, the Check out dialog and the password dialog fill the width, with their controls stacked.

### Public screens and controls (DP-05, DP-10, DP-11, DP-17, DP-18, DP-22, DP-23, DP-25, DP-39, DP-42, DP-44, DP-46, DP-55, DP-61, DP-64, DP-66, DP-68, DP-70, DP-72, DP-76, DP-77, DP-82, DP-84, DP-86, DP-87, DP-88, DP-89, DP-90, DP-92, DP-93, DP-94, DP-97)

Only the controls and regions below are public. Tests and judges may touch them; everything else is free. Placeholders inside names are defined in Feedback states. Each screen also shows the level-one `heading` named in the screens table.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| Sign in | `form "Sign in"`, `textbox "Email"`, `textbox "Password"` (password input), `button "Sign in"`, `link "Apply for a station"` | — |
| Apply | `form "Apply"`, `textbox "Business name"`, `textbox "Contact name"`, `textbox "Email"`, `textbox "Password"`, `button "Send application"` | — |
| Apply, after a failed send | `group "Check these fields"` above the form, holding one `link "<field label>: <message>"` per failing field, in form order | `<field label>` is the field's label from the row above; `<message>` is the field's error from Feedback states |
| Every signed-in screen | `navigation "Main"` with links. Tenant: "Board", "Hour packs", "Documents". Owner: "Board", "Tenants", "Report". Shift lead: "Board". Also `button "Sign out"` | Kitchen clock text "Kitchen time `<HH:MM>` · `<time zone>`" |
| Every signed-in screen, below 600 px | `button "Menu"` with `aria-expanded`, and `aria-controls` naming the panel that holds `navigation "Main"` and `button "Sign out"` | "Menu" |
| Every screen, Sign in and Apply included | `status "Kitchen updates"` (polite live region) | All announced copy from Feedback states |
| Hour packs, Tenant detail | `dialog "Confirm your password"` (modal) holding, in this order, `textbox "Password"` (password input), `button "Confirm"`, `button "Close"` | "Confirm your password to continue." above the field; the dialog's field error under the field |
| Board, Report | `group "Kitchen date"` holding `button "Previous day"`, `button "Next day"`, `button "Today"` and the shown date as text | Date shown as `<date>` |
| Board | `group "Hour rail"` holding `slider "Span start"` and `slider "Span end"`, each with value text `<HH:MM>` | Numerals 05 to 23, and the shelves-free line from Feedback states |
| Board, cooler hooks | Inside `group "Hour rail"`, 36 cooler cells in time order. Each carries `data-cooler-free="<n>"` (that half hour's `freeShelves`) and `data-cooler-time="<HH:MM>"` (that half hour's `time`) | One hairline tick per free shelf; a fine hatch at zero |
| Board | `region "Floor plan"` holding one `button` per station, shelves included, named "`<station>`, `<station label>`" | Station name and label drawn on each block |
| Board, station hooks | Each station button carries `data-station-id="<station id>"`, `data-state` (`free`, `partial`, `full` or `taken`) and `data-extrusion` (the target extrusion in whole pixels, rounded as stated in Motion and effects). The station under the keyboard drop target also carries `data-drop-target="true"`; no other station carries it | (not visible) |
| Board, tenant | `button "Slab <start>–<end>"` at the top of the ticket column. It can be dragged and lifted by keyboard. It carries `aria-pressed="true"` while lifted by keyboard and `aria-pressed="false"` otherwise, and is disabled while a span hint applies | Slab shows `<start>–<end>` and `<duration>`. The span hint from Feedback states shows beside it when one applies, and claim refusal copy shows beside it, on its own line, after a refused claim |
| Board | `dialog "<station>"` holding `list "Bookings in span"` and `button "Close"`. For tenants on a station that is not a cooler shelf, it also holds `combobox "Walk-in shelf"` and the claim button | List rows "Booked `<start>–<end>`" and "Cleanup `<end>–<buffer end>`". A tenant's own rows add "Yours"; owner and shift lead rows add the business name |
| Station dialog, tenant | `combobox "Walk-in shelf"`. First option "No shelf", then one option per shelf in seed order, named "`<shelf>`, `<station label>`". A shelf option is disabled when that shelf's free minutes in the span are fewer than the span's minutes | Default "No shelf" |
| Station dialog, tenant | With "No shelf" chosen: `button "Claim <station> <start>–<end>"`. With a shelf chosen: `button "Claim <station> and <shelf> <start>–<end>"`. On a cooler shelf's own dialog it is always the first form. Disabled while a span hint applies | The span hint shows beside it when one applies, and claim refusal copy shows beside it on its own line after a refused claim |
| Board, tenant | `region "Your tickets"` holding one focusable `article "<station> <date> <start>–<end>"` per booking. Each article holds its status text, its cancellation line (confirmed only) and, in this order: `button "Confirm booking"` (held only, while the countdown is above zero), `button "Move booking"` (only while `movable` is true; disabled while a span hint applies), `button "Cancel booking"` (held or confirmed only), `link "Receipt"` (confirmed and later). "Move booking" carries `aria-pressed="true"` while lifted and `aria-pressed="false"` otherwise | Status texts and cancellation lines in Feedback states. A paired booking's card adds the line "+ `<shelf>`". Move refusal copy shows inside the article on its own line |
| Ticket card, cancel step | `group "Cancel this booking?"` holding `button "Keep it"` and then `button "Yes, cancel"`, in that order in the page and in Tab order. For a confirmed booking, the group's accessible description is its cancel-step description. While open, the step replaces the card's other buttons | "Cancel this booking?" and, for a confirmed booking, the cancel-step description from Feedback states |
| Board, owner and shift lead | `region "Door list"` holding one `article "<business> <station> <start>–<end>"` per booking. Each article is focusable and in Tab order, carries `data-face` (`front` or `back`, naming the face showing; every card starts on `front`), and holds its door status text, clearance text, door-log lines and exactly the buttons the entry's `actions` name: `button "Check in"`, `button "Check out"`, `button "Mark no-show"`. Only the showing face is visible and in the accessibility tree | Door status, clearance, door-log and check-in-opens texts in Feedback states. A paired booking adds "+ `<shelf>`" |
| Check-out | `dialog "Check out"` (modal) holding, in this order, `checkbox "Station cleaned and sanitised"`, `textbox "Cleanup note"`, `button "Log cleanup and check out"`, `button "Close"`. After a refused unticked submit, the checkbox's description is the cleanup-box error | The cleanup-box error from Feedback states, under the checkbox |
| Hour packs | `region "Hour packs"`, `button "Buy 10-hour pack"`, `button "Buy 20-hour pack"`, `button "Buy 40-hour pack"`. Each pack panel has `heading "<hours>-hour pack #<pack number>"` and one `table "Ledger <hours>-hour pack #<pack number> <purchase date>"` with columns When, Movement, Hours, Booking | Balance text "`<balance>` left of `<purchased>`", followed by " · `<held>` on hold" only while `heldMinutes` is above zero. The pack receipt line from Feedback states. While a purchase attempt is open after a failure, the tag "Retry purchase" shows beside that attempt's button and copy, and the button keeps its accessible name |
| Documents | Tenant status text "Status: `<status label>`" | Status labels in Feedback states |
| Documents | `form "Upload document"` holding: `radiogroup "Document type"` with `radio "Certificate of insurance"` and `radio "Food-handler card"`; a date field labelled "Expires on"; for insurance only, `textbox "Per-occurrence limit (dollars)"` and `checkbox "Names Halfsheet Commissary as additional insured"`; a file field labelled "File"; `button "Upload"` | Help text "PDF, PNG or JPEG" |
| Documents | `table "Documents on file"` with columns Type, Expires, Cover, Uploaded, Fingerprint, File. Each row with a file has a `link "Open"` | Cover labels and fingerprint text from Feedback states. Rows without a file read "On paper" in File |
| Tenants | `table "Tenants"` with columns Business, Contact, Status, Insurance expires, Food-handler card expires. Each business is a `link "<business>"` | — |
| Tenant detail | `button "Approve <business>"` (documents_pending only). `region "Documents"`: each document row shows its type, expiry, cover label, fingerprint, `link "Open"` (rows with a file) and notice lines. `region "Packs"`: one panel per pack under `heading "<hours>-hour pack #<pack number>"`, with the text "Refundable now $`<amount>`" and `button "Refund <hours>-hour pack"` on every active pack with balance above zero | Cover labels, fingerprint text and notice lines in Feedback states. `<amount>` in "Refundable now" is the pack's `refundableCents`. Refunded packs show "Refunded $`<amount>`" |
| Report | `figure "Usage by station"` holding one bar per station in seed order. Each bar carries `data-station-id="<station id>"`, `data-minutes` (that station's `bookedMinutes`) and `data-height` (its target height in drawing units). The figure's accessible description is each station's "`<station>`: `<duration>`" in seed order, joined by "; ", with `<duration>` being that station's `bookedMinutes` | Station names under the bars |
| Report | `table "Usage by station"` (Station, Booked, Bookings) and `table "Usage by tenant"` (Business, Booked, Bookings, No-shows) | Total line "Total booked `<duration>`" |
| Receipt | Receipt card | Lines: Station, Shelf (the shelf name or "None"), Date, Starts, Ends, Hours debited, Status, Booking reference, then the email lines from Feedback states |

### Interactions (DP-05, DP-18, DP-23, DP-25, DP-26, DP-36, DP-39, DP-44, DP-46, DP-49, DP-52, DP-55, DP-60, DP-64, DP-66, DP-67, DP-68, DP-69, DP-70, DP-71, DP-73, DP-74, DP-75, DP-76, DP-77, DP-78, DP-79, DP-80, DP-81, DP-82, DP-83, DP-84, DP-86, DP-88, DP-89, DP-90, DP-92, DP-93, DP-95, DP-96, DP-97, DP-98, DP-99)

**Picking a span.**
- Pressing on an empty part of the hour rail starts a new span at the nearest half hour. Dragging extends it; releasing sets it. Dragging either end of a shaded span moves that end.
- A finger works the same way, and the page does not scroll while a finger drags on the rail.
- With a slider focused, Left or Down moves that end back half an hour, Right or Up moves it forward half an hour, and Home or End jumps to opening or closing time.
- The start always stays at least half an hour before the end. The default span is 09:00–12:00.
- Every change re-runs the station stack, updates the shelves-free line and moves the slab label to the new span.

**Whether the span can be booked.**
- Each floor answer carries `spanStatus` for the span it was asked about, decided by the server as stated in Business rules.
- A span hint applies in two cases:
  - the span is shorter than the minimum booking (the length hint)
  - otherwise, the shown span's `spanStatus` is `started` or `beyond_horizon` (the started or horizon hint)

  The length hint takes precedence.
- While a span hint applies:
  - the slab is disabled: Space and Enter on it do nothing, and a pointer or finger drag does not start
  - "Move booking" is disabled and cannot be lifted
  - the station dialog's claim button is disabled
  - the hint from Feedback states shows beside the slab and beside the dialog claim button
  - no claim or move request is sent
- The browser's clock and time zone never decide `spanStatus`. When a span starts while the Board is open, the next floor reload (within 12 seconds) applies the started hint. A slab or Move booking already lifted when the hint applies stays lifted; if it is then dropped, the server's refusal returns it as usual.

**Changing day.** "Previous day" and "Next day" move the shown kitchen date by one day. "Today" moves it back to the kitchen's today, which is also the default date. The floor plan, cooler strip and ticket or door column reload for the new date.

**Server clock in the browser.**
- The browser estimates the server's current time from the `now` field of its latest response from `/api/kitchen`, `/api/floor` or `/api/door`, plus the time that has passed since that response arrived. Report, which reads no floor or door answers, estimates from `/api/kitchen`, which it reads when it opens.
- That estimate, read in the kitchen's time zone, drives the held countdown, the Board's, door list's and Report's default date, the date the Today button goes to on Board and Report, and the kitchen clock text.
- The browser's own clock reading and time zone never decide any button, default date, countdown, span hint, cancellation line, cover label, report date or clock text.
- The held countdown is ceil((`holdExpiresAt` − estimated server now) ÷ 1 second), kept between 0 and `holdSeconds`. When it reaches 0 with no confirm pending, the card reads "Hold expired" and "Confirm booking" is removed at that moment.

**Latest choice wins.**
- After any sequence of span or date changes, the screen reflects only the last span and date chosen, whatever order the floor responses arrive in. This covers the stack, labels, `data-state`, `data-extrusion`, cooler cells, the shelves-free line, the span hint, the ticket or door column and the URL.
- A floor or door response for a span or date that is no longer chosen never changes the screen, and never shows the refresh-failure copy, including when the app abandons that request.

**Late reads never undo an action.**
- A floor or booking response whose request was sent before the user's latest claim, confirm, move or cancel was answered never changes a card, block or numeral or the column.
- While a confirm is pending, the card reads the Confirm pending copy from Feedback states, even once the countdown reaches zero. The server's answer decides what the card shows next.
- After a confirm ends in a network failure, the card keeps its status and shows the generic copy. When the countdown reaches zero, or at once if it already has, the card re-reads that booking and shows the server's status. So a confirm the server accepted but whose answer was lost ends as Confirmed.

**Claiming by drag (tenant).**
- Press and hold the slab and drag it over the plan. The station under the pointer gets a tomato outline.
- Releasing over a station claims that station alone for the span; a slab drop never pairs a shelf. Releasing anywhere else, or pressing Escape mid-drag, sends the slab back to the ticket column and claims nothing.
- A finger works the same way:
  - The page does not scroll while a finger drags the slab.
  - A touch that moves less than 8 pixels before release is a tap, not a drag. A tap on the slab does nothing; a tap on a station opens its dialog.
  - Touch claims behave the same with reduced motion.

**Claiming by keyboard (tenant).**
1. With the slab focused, Space or Enter lifts it. Its `aria-pressed` becomes `"true"` and the lift announcement from Feedback states plays.
2. A tomato drop-target outline appears on the first station in seed order whose state is `free`, marked with `data-drop-target="true"`. If no station is free, it appears on the first station in seed order.
3. Arrow keys move the target:
   - Right and Left move it one column over in the same row.
   - Up and Down move it to the row above or below, onto the station in that row whose column is nearest the current one (on a tie, the lower column).
   - Nothing wraps; at an edge the key does nothing.
4. Each move announces the move copy from Feedback states. Arrow keys never scroll the page while the slab is lifted.
5. Enter or Space claims the targeted station alone, exactly as a pointer drop does.
6. Escape returns the slab, removes the outline and announces the return copy. Moving focus away while lifted does the same. Nothing is claimed.
7. After a successful claim, focus moves to the new ticket card. After a "just taken" refusal, focus moves to that station's button.

**Opening a station.**
- Clicking or tapping a station block, or pressing Enter or Space on it, opens its dialog with the bookings in the span. The dialog's bookings list and shelf options are worked out when it opens and do not change while it stays open.
- The tenant's claim button:
  - with "No shelf" chosen, it does exactly what a drop does
  - with a shelf chosen in "Walk-in shelf", it takes the paired name, and pressing it claims the station and that shelf together as one booking
- Escape or "Close" closes the dialog and returns focus to the station block.
- A successful claim from the dialog closes it and moves focus to the new ticket card.

**Refused claims other than "just taken".** When a drop, keyboard claim or dialog claim is refused with 409 `tenant_not_approved`, `documents_not_valid` or `insufficient_hours`, with 429 `rate_limited`, or with 422:
- The slab returns to the ticket column with `aria-pressed="false"`. No ticket card is added and no "just taken" label appears.
- Every station's `data-state`, `data-extrusion`, height and label stay as they were before the claim.
- The claim's refusal copy from Feedback states appears next to the slab (or next to the claim button for a dialog claim) and is announced in "Kitchen updates". For a 422, that copy is the server's own sentence, chosen as the Shape row of Feedback states says.
- Focus returns to the slab after a pointer or keyboard claim. After a dialog claim, focus returns to the claim button and the dialog stays open.

**Refusal copy stays until the user acts again.**
- Claim and move refusal copy is the published sentence, verbatim, on its own line: beside the slab, beside the dialog's claim button, or inside the ticket article for a move.
- It stays unchanged through every 10-second floor refresh, every countdown tick and every `spanStatus` flip. Only these remove it: the start of the next claim or move, a change of span or date, or leaving the Board.
- A span hint that starts to apply while refusal copy is shown appears on its own separate line and never replaces or merges with the refusal copy.
- A refresh never writes to "Kitchen updates", so each refusal is announced exactly once.
- An open station dialog that refused a claim stays open through refreshes, keeps its chosen shelf, and keeps focus on the claim button.
- A move refusal's card re-read (see "Honest cards") happens once. Later floor refreshes update that card's status and buttons but leave the move refusal copy in place.

**Moving a booking (tenant).** A move targets the rail's chosen span and date, so the tenant picks those first. A movable booking's card stays in the column whatever date is shown.
- **Lifting.** Pressing "Move booking" (click, tap, Enter or Space) lifts it. So does dragging it more than 8 pixels by pointer or finger; the page does not scroll during a finger drag. While a span hint applies, it cannot be lifted and the hint shows.
- **While lifted.** It behaves exactly as the slab does: the same drop target, arrow keys and move announcement, and Escape or moving focus away returns it with the return copy and sends nothing. Only the lift announcement differs. A press-lifted Move booking also accepts a click or tap on a station as the drop for that station; this does not count as moving focus away.
- **Dropping.** Enter or Space on the target, or releasing a drag over a station, sends one move with its own new `Idempotency-Key`. The body names that station, the rail's span on the shown date, and the booking's current shelf, so a paired booking keeps its shelf. Releasing a drag anywhere else sends nothing.
- **Success.** On 200, the old block falls and the new block rises together. The article takes its new name and place in the column, and focus rests on it.
- **"Just taken".** On 409 `slot_taken`, only the target station reads "just taken", the card is unchanged, and focus moves to that station's button.
- **Other refusals.** The lifted control returns to the card, no block or label changes, and the copy from Feedback states shows. On a 409, the card first re-reads as stated in "Honest cards". Focus then returns to "Move booking" when the card still shows it. Otherwise (for example after `invalid_transition`, `past_cutoff` or `move_limit_reached`) focus moves to the ticket article, which shows the server's status.

**Buying a pack (tenant).**
- Each press of a "Buy `<hours>`-hour pack" button that is not resuming an open attempt starts a new purchase attempt in the page, with its own new `Idempotency-Key` and the body for that pack size.
- From the press until that request settles, all three buy buttons are disabled. Throughout this section, a disabled buy button carries `aria-disabled="true"`, ignores presses and keeps focus, as the Refund button does. It is never natively disabled, so the pressed button keeps focus while its request is pending. Any further press of any buy button in that time sends no request. That includes a second press delivered in the same instant as the first, before the page has redrawn.
- The attempt stays open, and the "Retry purchase" tag shows, when the request fails with a network failure (no HTTP response), 503 `purchase_pending` or 409 `idempotency_in_progress`. The next press of that same button resends the same `Idempotency-Key` and the same body. While an attempt is open, the other two buy buttons stay disabled.
- **Password confirmation.** When a purchase answers 403 `reauth_required`, the attempt stays open and counts as pending, and `dialog "Confirm your password"` opens, as described under "Confirming the password". Once the password is confirmed, the page at once resends the same `Idempotency-Key` and the same body, and that answer is this press's outcome. If the dialog is closed without confirming, nothing more is sent, the attempt closes, and the closed-dialog copy from the Buy pack row of Feedback states is this press's outcome.
- After a 2xx answer, or any other error, the attempt closes and the next press starts a new attempt with a new key. When the server answers a resend as a replay (201 with `Idempotent-Replay: true`), the page shows the normal success copy and the pack appears once.
- **Surviving a reload.** At the moment of the press, the attempt's key and hours are stored in the tab's `sessionStorage` under the user's id. After the same user reloads Hour packs, the tag shows and the next press of that button resends the same key and body.
- **Ending an attempt from outside.** Sign out discards the stored attempt. A 401 keeps it for the same account; a different account's sign-in discards it.
- **Outcome copy.** Buy outcome copy and the tag are never cleared or overwritten by a packs refresh, including one that changes a pack's receipt email line or on-hold text. The copy changes only on the next press of a buy button, or on leaving the screen. The tag stays for as long as the attempt is open after a failure.
- **Announcements.**
  - Each buy press announces exactly one outcome in "Kitchen updates": the success, network-failure, billing-down, paid-but-not-recorded, still-in-progress or closed-dialog copy from the Buy pack row of Feedback states. A replay counts as success. A press resent after a password confirmation still announces only its final outcome.
  - The Buy pending copy is shown and never announced.
  - A packs refresh never writes to "Kitchen updates".
  - Each load of Hour packs (opening, reloading, or arriving after the same user signs in again) that finds an open purchase attempt for the signed-in user shows the resume copy from Feedback states beside that attempt's button, next to the tag, in place of any earlier outcome copy, and announces it once.

**Confirming the password (tenant purchase, owner refund).**
1. `dialog "Confirm your password"` opens with focus on its Password field. Tab moves through Password, "Confirm" and "Close" in that order; Tab from "Close" wraps to Password and Shift+Tab from Password wraps to "Close". The page behind is inert.
2. "Confirm", or Enter in the field, sends one password confirmation. While it is pending, both buttons are disabled and the dialog's pending copy shows.
3. On success the dialog closes and focus returns to the button that started the action. That button stays disabled while the resent request runs: it carries `aria-disabled="true"`, ignores presses and keeps focus.
4. On a wrong password or the sign-in limit, the dialog stays open, the field is cleared, its error from Feedback states shows under it as its description, it is announced once, and focus moves to the field.
5. Escape or "Close" closes the dialog, sends nothing and returns focus to the button that started the action.
6. No periodic refresh closes the dialog, clears its field or moves focus.

**Ticket actions.**
- "Confirm booking" confirms a hold. Once the server answers, focus moves to the ticket article.
- "Receipt" opens the receipt screen.
- A confirmed card's cancellation line, and the cancel step's description, come only from the booking's `cancelCreditMinutes` in its latest read. They update in place on every floor reload, without closing the step or moving focus.
- **Cancel step:**
  1. "Cancel booking" opens the cancel step group in place of the card's buttons, and focus moves to "Keep it", the least destructive choice.
  2. Escape, or "Keep it", closes the step, sends no request and returns focus to "Cancel booking". So pressing Enter on "Cancel booking" and then Enter again never cancels anything.
  3. "Yes, cancel" sends exactly one cancel request and disables both buttons while it is pending.
  4. Once the server answers (200, or 409 followed by the re-read in "Honest cards"), focus moves to the ticket article itself. It stays in the column and shows its new status text. The server's answer decides the success copy, so a cancel sent after the cutoff passed while the step was open shows the Late copy.
  5. On a network failure, focus also moves to the article, which keeps its previous status.

**Honest cards.**
- A ticket or door card changes its status text, log lines and buttons only after the server answers 2xx. The floor stack follows the same rule.
- When an action is refused with 409, the card re-reads that booking at once and shows the server's status text and buttons, plus the refusal copy from Feedback states. For example, a cancel refused because the shift lead checked the tenant in shows "Checked in" with no Cancel button.
- On a network failure, the card keeps its previous status text and buttons and shows the generic copy.

**Door actions.**
- Each door card shows exactly the buttons named in its entry's `actions`, in that order.
- A confirmed entry whose server-side current time is before `checkInOpensAt` shows the check-in-opens line from Feedback states.
- Each door article is focusable and in Tab order, before its own buttons.
- "Check in" and "Mark no-show" act at once. After the server answers 200 (or 409 followed by the re-read), the buttons follow the server's `actions`, and focus moves to that door article, which shows its new status text and door-log line. A 200 also turns the card over, as described in Motion and effects; a 409 never does.
- **Pending through refreshes.** While a door action is pending, its card keeps that action's pending copy ("Checking in…", "Checking out…" or "Marking no-show…") and all its door buttons stay disabled through every 15-second refresh, even when the refresh already returns the committed result. The refresh still updates every other card. The card changes only when the action's own answer arrives: 200, or 409 followed by the re-read.
- **Check out dialog:**
  1. "Check out" opens the modal `dialog "Check out"`, with focus on "Station cleaned and sanitised".
  2. Tab moves through the checkbox, "Cleanup note", "Log cleanup and check out" and "Close" in that order. Tab from "Close" wraps to the checkbox, and Shift+Tab from the checkbox wraps to "Close". The page behind is inert while the dialog is open.
  3. Escape or "Close" closes the dialog and returns focus to the "Check out" button.
  4. "Log cleanup and check out" always sends the request, ticked or not; the browser never blocks it.
  5. When the server answers 422 on `cleanupDone`, the dialog stays open, the note keeps its text, the cleanup-box error shows under the checkbox as its description, and focus moves to the checkbox.
  6. On 200, the dialog closes, the card turns over, and focus moves to the door article, which reads Completed. On 409, the dialog closes, the card re-reads, and focus moves to the door article showing the server's status.
- **Announcements.**
  - Each time a door list for the URL's date is drawn after opening the Board, Previous day, Next day, Today, Back, Forward or reload, "Kitchen updates" announces the door list summary from Feedback states once for that date. A superseded door response draws and announces nothing. A periodic refresh never repeats the summary.
  - When a 15-second refresh finds an entry whose status differs from the one drawn, and the change did not come from an action this page sent, it announces the door change copy once for that change. A change caused by this page's own pending or answered action is never announced as a door change.
  - The user's own door actions announce only their own success or refusal copy, once.
  - A door card's outcome copy stays beside the card through refreshes until that card's next action or a date change; a door change announcement for another card never removes it.
- The 15-second door refresh never moves focus off a door article or out of the dialog.

**Refunding a pack (owner).**
- Pressing "Refund `<hours>`-hour pack" sends the amount shown in that pack's "Refundable now" at that moment as `expectedCents`.
- While the refund is pending, through any refresh, the button carries `aria-disabled="true"`, ignores presses and keeps focus.
- On 403 `reauth_required`, the password dialog opens as described under "Confirming the password". Once confirmed, the page resends the refund with the same `expectedCents` as the original press. If the dialog is closed without confirming, nothing is refunded and the closed-dialog copy from the Refund pack row of Feedback states is announced once.
- On 412, the pack re-reads, and the button stays as while pending until the re-read pack is drawn. Then "Refundable now" shows the new amount, the amount-changed copy shows beside the button and is announced once, and focus stays on the button. Nothing is refunded until the owner presses again.
- On 200, the success copy is announced once and focus moves to that pack's panel heading, "`<hours>`-hour pack #`<pack number>`", which shows the pack as refunded.
- Every other refusal re-reads the pack and announces its copy once. Focus stays on the button if it is still shown, and otherwise moves to the pack heading.

**Report dates.**
- Report's default date, its fallback for a missing or invalid `date` (the URL is rewritten without adding a history entry) and the date its Today button goes to are the kitchen's today by the estimated server clock, never the browser's own date.
- Previous day and Next day step from the shown date as kitchen calendar dates, never by adding 24 hours in the browser's zone.
- Report follows "Latest choice wins". After any sequence of Previous day, Next day, Today, Back and Forward, the bars, tables and total line show only the date in the URL. A superseded report response never changes the screen and never shows failure copy.
- While a report for a newly chosen date is loading, the Report pending copy shows beside the Kitchen date group, without being announced. A periodic refresh never shows it.
- Each time the tables for the URL's date are drawn on opening, Previous day, Next day, Today, Back, Forward or reload, "Kitchen updates" announces the Report success copy exactly once for that date.
- **Live report.** An open Report re-reads its URL's date every 10 seconds:
  - Changed values in the bars, "Usage by station", "Usage by tenant" and the total line update in place within 12 seconds, without reload, focus change or scroll change.
  - A refresh that changes `totalBookedMinutes` announces the Report update copy once. A refresh that changes only bars or table rows updates them without announcing. An unchanged refresh draws and announces nothing.
  - A refresh superseded by a date change draws nothing. A failed refresh keeps the last data and shows nothing.

**Menu below 600 pixels wide.**
- While collapsed, the panel holding `navigation "Main"` and `button "Sign out"` is fully unavailable: its links and Sign out are not shown, cannot be focused, are not in the accessibility tree and cannot be clicked. Moving it off-screen is not collapsing it.
- "Menu" carries `aria-expanded="false"` while collapsed and `"true"` while open.
- Opening the menu moves focus to its first link. Escape closes it and returns focus to "Menu". Following a link navigates and closes the menu.
- At 600 pixels and wider there is no Menu button, and navigation and Sign out always show.

**Tab order on the Board:**
1. the main navigation links
2. Sign out
3. the Kitchen date buttons
4. Span start, then Span end
5. the slab (tenant)
6. the station blocks, in seed order
7. the ticket or door cards in display order, each article followed by its own controls in the order given in the controls table

Below 600 pixels wide, "Menu" takes the place of items 1 and 2.

Inside the station dialog the order is the bookings list, "Walk-in shelf", the claim button, then "Close". Tab and Shift+Tab stay inside an open dialog; the Check out dialog works as described under "Door actions", and the password dialog as described under "Confirming the password".

Every focused control shows a two-pixel ink focus ring with a paper-coloured gap, and hover styling never hides it.

**Failures on Apply and Sign in.**
- The browser's own validation bubbles never appear on Apply; every check is answered by the server.
- On 422, or 409 `email_taken`, the "Check these fields" group appears above the form with one link per failing field, in form order. Focus moves to the group, and "Kitchen updates" announces the count copy from Feedback states once.
- Activating a link moves focus to that field. The URL does not change, no history entry is added and nothing reloads.
- Every field keeps its value, the password included. Each failing field also keeps its own error under it, linked as its description.
- The group is removed when the next send starts.
- On Sign in, a 401 `invalid_credentials` or a 429 keeps the current `?next=` in the URL, and the next successful sign-in still follows it under "Returning after sign-in".

**Landing after each action.** Each action lands as the table says, and its focus target receives focus once the screen has drawn.

| Action | Lands on | History | Focus |
|---|---|---|---|
| Send application (201) | `/documents` | replaces the `/apply` entry | `heading "Your documents"` |
| Sign in (200) | the screen chosen under "Returning after sign-in" | replaces the Sign in entry | that screen's level-one heading |
| Sign out (204) | `/signin`, with no `next` | replaces the current entry | `textbox "Email"` |
| Approve `<business>` (200) | stays on `/tenants/<id>` | no new entry | `heading "<business>"` |
| Any request answered 401 `unauthenticated` | `/signin?next=<current path and query>` | replaces the current entry | `textbox "Email"` |

- A signed-in user who opens `/signin` or `/apply` has the URL replaced with `/board`, and the form is never drawn.
- A signed-out user who reaches a screen through Back or Forward sees Sign in, under "Returning after sign-in". No record from before sign-out is drawn, not even for a moment.
- After Approve, Back to `/tenants` re-reads the table and shows "Approved".

**One user at a time in the page.**
- Signing out, and any sign-in, discard every in-page record of the previous user before anything is drawn for the next one:
  - tickets, floor intervals and "Yours" marks
  - packs, documents, receipts and tenant rows
  - an open purchase attempt, its `Idempotency-Key` and its "Retry purchase" tag
  - a lifted slab or Move booking, an open cancel step and any open dialog
  - the "Kitchen updates" text
  - any earlier `next` value
- The next user's first buy press starts a new attempt with a new key.
- A request answered 401 is not a sign-out. There are exactly two same-user exceptions, each kept only when the same account signs in next: the open purchase attempt in "Buying a pack", and the upload draft below.
- **Late answers.** A response to any request sent under a previous sign-in, arriving after sign-out or any sign-in, is ignored completely: no drawing, announcement, tag or redirect. That includes a late 401, which never sends the next user to Sign in.
- **History after a sign-in.** After any sign-in, Back or Forward into a history entry made under an earlier sign-in shows that screen re-read as the current user. For example, `/packs` shows the current tenant's packs and `/board?date=…` the current tenant's tickets.
  - An entry for `/signin` or `/apply` has the URL replaced with `/board`.
  - So does an entry for a screen path outside the current role's row, or one naming a record the server does not return to the current user, such as another tenant's `/receipt/<id>`. Focus then moves to `heading "Board"`. Nothing from that record (station, times, business name or pack heading) is ever drawn, not even for a moment.

**Interrupted upload (tenant).**
- When a request on Documents answers 401 while the upload form has any non-default value, the page keeps a draft in page memory, bound to the signed-in user's id. The request may be Upload or a background refresh. The draft holds the type, expiry, limit, additional-insured choice and chosen file. The 401 landing stays as published.
- If the same account then signs in without a reload, it lands on `/documents` with every value restored and the same file still chosen. The upload-restored copy from Feedback states shows beside Upload and in "Kitchen updates".
- Nothing is sent automatically. One press of Upload sends one upload, with the original file's bytes.
- If a different account signs in, the user pressed Sign out, or the page reloaded, the draft is gone and the form is blank. No earlier file name stays on the page.

**Addresses and history.**
- Previous day, Next day and Today add a browser history entry with the new `date`. Changing the span replaces the current entry with the new `from` and `to`.
- Reloading or opening a screen URL directly shows exactly that date and span. Back and Forward restore the previous URL's date, span, bars, tables and stack.
- A missing or invalid parameter falls back to its default, and the URL is rewritten to the defaults without adding a history entry. Date and span fall back independently.
  - A date is invalid when it is not a real calendar date.
  - A span is invalid when only one of `from` and `to` is given, either is off the half hour or outside 05:00–23:00, or `from` is not before `to`.
- A signed-in user who opens a screen path not in their role's row of the screens table lands on the Board with the URL replaced by `/board`. So does a tenant who opens a receipt the server does not show them, whether it is another tenant's booking or does not exist.
- For the owner, a tenant detail or receipt whose record does not exist shows the missing-record copy from Feedback states.

**Returning after sign-in.**
- A signed-out visit to any screen path except Sign in and Apply shows Sign in at `/signin?next=<the requested path and query>`.
- After sign-in, the app follows `next` only when all of these hold:
  1. The raw value starts with `/` followed by a lowercase letter from a to z.
  2. It contains no backslash and no whitespace or control character. It also contains none of `%2f`, `%5c`, `%09`, `%0a` or `%0d`, in any letter case.
  3. Resolving it with the browser's own URL parser against the app's origin gives that same origin.
  4. The resolved path is a screen path in the signed-in role's row of the screens table.
  5. For `/receipt/<id>` or `/tenants/<id>`, the server returns that record to the signed-in user.
- Otherwise, including when `next` is absent, the app goes to `/board`. It never makes a request to another origin because of `next`, and never writes a rejected value into the page (as text, in a link or in any attribute).
- For example, `next=/\evil.test` and `next=/%2F%2Fevil.test` both land on `/board`. A tenant whose `next` names another tenant's receipt also lands on `/board`, and that booking's station and times are never shown.

**Freshness.**

| What | Re-read when | Visible within |
|---|---|---|
| Floor plan and ticket column | span or date changes; after each of the user's own claims, confirmations, moves and cancellations; every 10 seconds | 12 seconds: another tenant's claim on blocks and cooler strip, the started hint, "Move booking" leaving a card whose `movable` turned false, a cancellation line changing at the cutoff. A reload updates the status, lines and buttons of cards already listed; which cards are listed follows Screens and layout |
| Door list | after each door action; every 15 seconds | 17 seconds: another staff member's door action |
| Hour packs | opened; after each purchase; every 10 seconds | 12 seconds: a hold's reservation, a receipt email going from Queued to Sent |
| Documents | tenant's status and documents: opened; after each upload; every 10 seconds | 12 seconds: a status change (announced once), cover labels |
| Tenant detail | opened; after each of the owner's actions; every 10 seconds | 12 seconds, in place with no reload: cover labels, notice lines, tenant status, balances, "Refundable now". Each Queued to Sent notice change is announced once |
| Booking receipt | opened; every 10 seconds | 12 seconds after delivery: each email line goes from Queued to Sent in place, with no reload and no focus move, announced once with the receipt email announcement |
| Report | as stated in "Report dates" | — |
| Kitchen clock text | each kitchen-local minute | — |
| Held countdown | every second | a hold that reaches zero leaves the column at the next floor reload |

A failed periodic re-read of Hour packs, Documents, tenant detail, the receipt or Report keeps the last data and shows nothing.

**Refreshes keep what the user is doing.** A refresh changes only the data it re-read. It never re-creates or resets the controls the user is working in, and never moves focus, the caret or the scroll position. In particular, no periodic refresh or countdown tick ever:
- returns a lifted slab or lifted Move booking, changes its `aria-pressed`, or moves or clears `data-drop-target`
- interrupts a pointer or touch drag
- closes or resets an open station dialog, or changes its chosen shelf
- removes or changes shown claim or move refusal copy
- closes the cancel step or moves focus off its button
- closes the Check out dialog, clears its checkbox, note or shown error, or moves focus inside or out of it
- closes the password dialog or clears its field or shown error
- changes a door card whose action is pending, or removes a door card's outcome copy
- on Documents, resets the chosen document type, the "Expires on" value, the limit value, the additional-insured checkbox, the chosen file, a shown field error and its link to its field, or a pending upload's disabled button and pending copy
- on tenant detail, re-enables a pending Refund button, re-requests a document file or replaces an image preview (so a refresh never makes a preview flicker or shows storage-down copy)
- on Hour packs, clears buy outcome copy or the "Retry purchase" tag
- on Report, moves focus off a Kitchen date button

The insurance-only fields switch only when the tenant changes the document type, never because of a refresh. A drop target whose station became full stays where it is; pressing Enter there sends the claim or move, and the server's 409 `slot_taken` retracts it as usual.

### Visual design (DP-06, DP-44, DP-87)

**Colour roles, in words:**
- **Ground:** a warm order-ticket paper off-white, never pure white.
- **Ink:** a deep charcoal with a slight blue cast.
- **Hairlines:** thin stainless-steel grey lines draw every panel, card, table row, station block edge and usage bar edge.
- **Tomato red:** reserved for claims and conflicts only: the slab, the drop-target outline, the claim buttons, the "just taken" label, and conflict and refusal messages. Nothing else uses it.
- **Dark ochre:** marks held and queued things: held ticket cards, held intervals in the station dialog, the "on hold" text on packs, the word "Queued" on email and notice lines, and the "Expires in" and "Expires today" cover labels.
- **Station blocks and usage bars:** paper with ink hairline edges, their three faces shaded by tone steps of the grey.
  - Fully booked blocks, and cooler cells with no free shelf, carry a fine diagonal ink hatch.
  - Cleanup bands are a lighter tint of the block's top face.
- **Cooler outline:** a dashed grey hairline around the shelf row.
- **Lapsed and superseded labels:** ink with a strike-free grey underline; "Lapsed" never uses tomato.
- **Disabled controls:** including a slab under a span hint, drawn in grey hairline outline with the hint in ink beside them, never in tomato.
- **Door card faces:** both faces use the same paper card; the back face differs only by a thin grey double rule along its top edge, so a turned card is recognisable without colour.

**Type:**
- Headings, station names and ticket titles use Archivo Narrow, a condensed grotesque that reads like a printed ticket header.
- Body text, tables and forms use IBM Plex Sans.
- Hour numerals, countdowns, door-log times, email sent times and document fingerprints use IBM Plex Mono.
- Each heading level is a quarter larger than the level below it, counting up from body size.
- The fonts are bundled with the app.

**Density:** compact. Table and card rows are tightly spaced, with hairline separators instead of large gaps. Every button, link, slider thumb, combobox, checkbox, Menu button and station block is still at least 44 by 44 pixels to tap.

**Composition:** the left ticket rail holds clipped cards. The isometric plan is the hero. The hour rail is a ruled strip under it, with the cooler strip along its lower edge. On Report, the isometric bars sit above the tables like a small model of the floor. Icons are Lucide line icons at hairline weight.

**Contrast:** all text and every control state meet WCAG 2.2 AA contrast on the paper ground, including tomato text, ochre labels and disabled-state hints. Colour never carries state alone; every state also has a text label.

### Motion and effects (DP-09, DP-24, DP-25, DP-26, DP-44, DP-46, DP-55, DP-60, DP-61, DP-86, DP-87)

Every motion starts quickly and settles softly, with no bounce. Apart from the Report bars' growth, nothing takes longer than half a second:
- about a fifth of a second for hover and press feedback
- about a quarter of a second for numerals, card entry, and the slab lifting off or sliding home
- about a third of a second for heights and the slab drop
- 420 milliseconds for a door card turning over
- 600 milliseconds for each Report bar growing

**Station stack (signature).**
- Each station block's extrusion (the height of its raised sides) is the station's occupied minutes in the span ÷ the span's minutes × 96 pixels. Zero occupied minutes draws a flat tile; a fully occupied span draws the full 96 pixels.
- `data-extrusion` is that extrusion rounded to the nearest whole pixel, with an exact half rounded up. For example, 60 occupied minutes of a 150-minute span gives 38.4 pixels and a `data-extrusion` of 38. 45 of 120 minutes gives exactly 36.
- Inside that height, a lighter top band shows the share that is cleanup buffer.
- When the span changes:
  - `data-extrusion` jumps at once to the new target, and the drawn height tweens to it over about a third of a second.
  - The free-minutes numeral counts to its new value over about a quarter of a second.
  - A block that becomes full fades its hatch in, and its label reads "full".
- Moving the span back reverses heights and numerals the same way, step by step.

**Cooler strip.** Cells redraw their ticks and hatch at once with each floor answer, with no animation.

**Claim drop.**
1. When a tenant drops a slab by pointer, touch or keyboard, a tomato slab appears 120 pixels above the block's top face and falls onto it over about a third of a second. It rests there while the claim is pending. A dialog claim drops the slab onto the station; a paired claim also drops a second slab onto the shelf at the same moment.
2. The block's height, `data-extrusion`, numeral and the ticket column do not change until the server answers.
3. On success, height and numeral move to their claimed values, and a ticket card marked Held slides down into the top of the ticket column over about a quarter of a second. A paired claim raises the station block and the shelf block together.
4. When the server confirms the booking, the card's mark changes from Held to Confirmed with a quarter-second colour cross-fade.

**Move drop.**
1. A dropped Move booking falls onto the target as a slab, as in the claim drop, and rests there while the move is pending. Nothing else changes yet.
2. On success, over the same third of a second, the old block falls and the new block rises (for a paired booking, both old blocks fall and both new ones rise together). The card slides to its new place over about a quarter of a second.

**Just taken.**
- When the server refuses a claim or move as already taken, each dropped slab lifts back up to 120 pixels above its block while fading out over about a quarter of a second.
- The floor re-reads. Each block moves to its true height, including the winner, and the numeral counts to its true value.
- The label of each station in the refused claim, or of the move's target, reads "just taken" in tomato. No ticket card is added or changed.

**Other refusals.** The dropped slab slides back to the ticket column over about a quarter of a second. No block, numeral or label moves.

**Keyboard drop target.** The tomato outline jumps from station to station with each arrow key, with no travel animation. The slab stays in the ticket column until a station is claimed.

**Door card turning over.**
- Only after this page's own Check in, Check out or Mark no-show answers 2xx, the door article turns over in 3D: one animation on the article, run through the browser's Web Animations interface so it appears in the article's list of running animations, rotating it about its vertical axis from 0 to 180 degrees with a perspective depth of 800 pixels, over 420 milliseconds, starting quickly and settling softly, and holding nothing once it ends.
- The face that comes into view carries the new status text, door-log line and buttons. Each face hides its own back, so only one face is ever readable, and the hidden face is out of the accessibility tree.
- `data-face` changes from `front` to `back` (or back to `front`, on the next action) exactly when the animation finishes.
- A refused action, a network failure, a refresh, and a change made by someone else never turn the card. Focus stays on the article throughout.

**Report bars growing.**
- On opening Report and on every settled date change, each bar grows from a flat tile to its height over 600 milliseconds, one animation per bar through the browser's Web Animations interface, each bar starting 40 milliseconds after the bar before it in seed order.
- `data-minutes` and `data-height` change at once to the new date's values when that date's report is drawn; a superseded date draws nothing, so after quick date changes only the last date's values and heights show.
- A live refresh that changes a station's minutes moves that bar from its current height to the new one over the same 600 milliseconds; unchanged bars do not move.

**Status lines.** Email, notice and cover lines change their text with a quarter-second colour cross-fade and no movement.

**Feedback.**
- Buttons darken on hover and press in about a fifth of a second.
- Station blocks lift their hairline outline on hover.
- Pending actions disable their button and show the pending copy. There are no spinners.

**Banned:** looping or decorative motion of any kind, including idle bobbing, pulsing, shimmer and animated backgrounds.

**Reduced motion.** When the system asks for reduced motion:
- Heights and numerals jump straight to their final values.
- Slabs appear in place on the block with no drop, and vanish or return to the column with no lift or slide.
- Cards appear without sliding, hatches without fading, and status lines change without cross-fading.
- Door cards run no animation: the new face shows at once and `data-face` changes at once.
- Report bars run no animation and show their final heights at once.

Labels, `data-extrusion`, `data-drop-target`, `data-face`, `data-height`, the cooler cells and the "Kitchen updates" announcements are unchanged, so nothing depends on motion or colour.

### Feedback states (DP-09, DP-18, DP-24, DP-26, DP-36, DP-44, DP-46, DP-48, DP-49, DP-52, DP-58, DP-60, DP-61, DP-64, DP-69, DP-70, DP-72, DP-77, DP-78, DP-80, DP-82, DP-84, DP-86, DP-87, DP-88, DP-89, DP-90, DP-92, DP-93, DP-94, DP-95, DP-96, DP-97, DP-98)

**Placeholders**, defined once here:
- **Names:**
  - `<station>`: a station name.
  - `<shelf>`: a walk-in shelf's name.
  - `<stations>`: `<station>` for a single booking, or "`<station>` and `<shelf>`" for a paired one.
  - `<business>`: the tenant's business name.
  - `<staff>`: the acting staff member's display name.
- **Dates and times:**
  - `<date>`: a kitchen-local date written like "Wed 28 Oct 2026".
  - `<start>`, `<end>`, `<buffer end>`, `<HH:MM>`: kitchen-local 24-hour times like "05:00".
  - `<time zone>`: the kitchen's IANA zone name.
- **Amounts of time:** `<duration>`, `<balance>`, `<purchased>`, `<held>`, `<free>` and `<span>` are written as "3 h" for whole hours, "2 h 30" with minutes, "30 min" under an hour and "0 min" for zero. A booking's `<duration>` is its minutes as defined in Business rules, unless a copy line says otherwise.
- **Packs:**
  - `<hours>`: a pack's whole number of hours.
  - `<pack number>`: the pack's 1-based position among its tenant's packs, oldest first (the order of `GET /api/packs`), so a tenant's first pack is 1. The owner sees the same number for the same pack.
  - `<purchase date>`: the pack's `purchasedAt` written as `<date>`.
- **Other values:**
  - `<seconds>`: whole seconds left on a hold, computed as in Interactions.
  - `<retry seconds>`: the whole number in the refusal's `Retry-After` header.
  - `<amount>`: dollars with two decimals.
  - `<email>`: the signed-in tenant's email.
  - `<document type>`: "Certificate of insurance" or "Food-handler card".
  - `<fingerprint>`: the first 12 characters of the document's `sha256`.

**Station labels.**
- Free or partly free: "`<free>` free of `<span>`".
- No free minutes: "full".
- After a claim or move refused as taken, each station in that claim, or the move's target, reads "just taken" for 5 seconds, then returns to its computed label.

These labels are part of each station button's accessible name.

**Shelves-free line:** "Cooler: `<n>` of `<total>` shelves free all span". `<total>` is the number of cooler shelves, and `<n>` is how many of them have `freeMinutes` equal to the span's minutes.

**Span hints** (shown beside the slab and the dialog claim button, not announced):
- length: "Pick a span of at least 2 h"
- started: "That span has already started. Pick a later span."
- horizon: "Bookings open up to 60 days ahead. Pick an earlier date."

**Ticket card status texts:**

| Booking state | Text |
|---|---|
| held | "Held · `<seconds>` s left" |
| held with a confirm pending | "Confirming…" |
| held at zero, or cancelled with reason `hold_expired` | "Hold expired" |
| confirmed | "Confirmed" |
| checked_in | "Checked in" |
| completed | "Completed" |
| cancelled with reason `tenant` | "Cancelled" |
| no_show | "No-show" |

**Cancellation line** (confirmed cards only):
- "Free cancellation until `<date>` `<HH:MM>`" when `cancelCreditMinutes` is above 0, with the date and time from `cutoffAt`.
- "Past cutoff — cancelling returns no hours" when it is 0.

**Cancel-step description** (confirmed bookings only; a held booking's step has none):
- "You'll get `<duration>` back." when `cancelCreditMinutes` is above 0, with `<duration>` being `cancelCreditMinutes`.
- "No hours will be returned." when it is 0.

**Door status texts:**

| Booking state | Text |
|---|---|
| held | "Held" |
| confirmed | "Booked" |
| checked_in | "Checked in" |
| completed | "Completed" |
| cancelled | "Cancelled" |
| no_show | "No-show" |

**Door clearance:** "Cleared", or "Not cleared — `<reason text>`". The reason texts are "certificate of insurance lapsed", "food-handler card lapsed" and "not approved yet".

**Check-in opening line:** "Check-in opens `<HH:MM>`", from the entry's `checkInOpensAt`.

**Door-log lines**, one per entry, oldest first, at the entry's kitchen-local time:
- check-in: "In `<HH:MM>` · `<staff>`"
- check-out: "Out `<HH:MM>` · `<staff>` · cleaned"
- no-show: "No-show `<HH:MM>` · `<staff>`"

**Door list summary:**
- "Door list for `<date>`: `<n>` bookings, `<m>` cleared."
- When `<n>` is 1, it reads "Door list for `<date>`: 1 booking, `<m>` cleared."
- `<date>` is the list's date, `<n>` its number of entries, and `<m>` the number with `cleared` true.

**Door change:** "`<business>` `<station>` `<start>`–`<end>`: `<door status text>`.", with that entry's new door status text.

**Notice lines on tenant detail**, one per claimed notice point, with the time from `sentAt`:
- "7-day notice: Queued" or "7-day notice: Sent `<date>` `<HH:MM>`"
- "Expires-today notice: Queued" or "Expires-today notice: Sent `<date>` `<HH:MM>`"

**Notice announcement**, once per Queued to Sent change: "Notice sent: `<document type>`, 7-day notice." or "Notice sent: `<document type>`, Expires-today notice."

**Cover labels**, from `coverState` and `daysLeft`:

| `coverState` | Label |
|---|---|
| `ok` | "Valid" |
| `expires_soon` | "Expires in `<n>` days", or "Expires in 1 day" when `daysLeft` is 1 (`<n>` is `daysLeft`) |
| `expires_today` | "Expires today" |
| `lapsed` | "Lapsed" |
| `superseded` | "Superseded" |

**Fingerprint text:** `<fingerprint>` in the monospaced face, or "—" for a document with no file.

**Receipt email lines**, one per entry in `emails`, in order, with the time from `sentAt`:
- `booking_confirmed`: "Confirmation email: Queued" or "Confirmation email: Sent `<date>` `<HH:MM>`"
- `booking_moved`: "Move email: Queued" or "Move email: Sent `<date>` `<HH:MM>`"

**Receipt email announcement**, once per Queued to Sent change: "Confirmation email sent." or "Move email sent."

**Pack receipt line** (not announced): "Receipt email: Queued" or "Receipt email: Sent `<date>` `<HH:MM>`", with the time from `receiptEmail.sentAt`.

**Buy resume copy:** "Your last purchase didn't finish. Press Buy `<hours>`-hour pack again to finish it; you won't be charged twice.", where `<hours>` is the open attempt's pack size.

**Tenant status labels:**

| Status | Label |
|---|---|
| applied | "Applied — upload your documents" |
| documents_pending | "Waiting for review" |
| approved | "Approved" |
| suspended | "Suspended — `<reason text>`" |

**Status change on Documents:** "Status changed: `<status label>`.", announced once per change found by a refresh.

**Ledger movement labels:** "Purchase", "Booking", "Cancellation credit", "Move", "Refund".

**Keyboard slab announcements:**
- Lift: "Slab lifted. Arrow keys pick a station, Enter claims, Escape puts it back."
- Move booking lift: "Moving `<station>` `<start>`–`<end>`. Arrow keys pick a station, Enter moves, Escape puts it back."
- Move: "`<station>`: `<station label>`"
- Return: "Slab returned. Nothing claimed."

**Apply count announcement:** "1 field needs attention." or "`<n>` fields need attention.", where `<n>` is the number of failing fields.

**Report update:** "Daily usage for `<date>` updated: Total booked `<duration>`.", where `<date>` is the URL's date and `<duration>` is the new `totalBookedMinutes`.

**Missing record** (tenant detail or receipt): "That record isn't available."

**Generic copy:** "Couldn't reach the kitchen. Nothing changed; try again."

**Where messages appear.**
- Every message in the action table below is announced once in `status "Kitchen updates"` and shown next to the control that caused it. Exceptions:
  - On Apply, "Kitchen updates" carries only the count announcement for field errors.
  - The Report pending copy and the Buy pending copy are shown but never announced.
- Field errors also appear under their field, linked to it as its description. That includes the Check out cleanup-box error under its checkbox and the password dialog's errors under its field.
- A refused ticket action shows the copy for the status the re-read returns: the Confirm "Expired" copy if that status is cancelled with reason `hold_expired`, otherwise that action's rule copy.
- After a failed door or refund action, the card or pack re-reads before the copy shows.
- A periodic refresh writes to "Kitchen updates" only these change announcements, each once per change:
  - the Documents status change
  - the notice announcement
  - the receipt email announcement
  - the door change
  - the Report update

| Action | Pending | Success | Field or rule error | Outage or network failure |
|---|---|---|---|---|
| Sign in | "Signing in…" | (lands on the next screen) | Wrong credentials: "That email and password don't match an account." Limit: "Too many sign-in attempts for that email. Try again in a few minutes." | generic copy |
| Confirm password (dialog) | "Checking password…" | (dialog closes; the action it guards is resent) | Wrong password: "That password doesn't match your account." Limit: the Sign in limit copy | generic copy |
| Apply | "Sending application…" | "Application received. Upload your certificate of insurance and food-handler card next." | Email in use: "An account already uses that email." Control characters in a name: "Use letters, numbers and punctuation only." Not an email address: "Enter a valid email address." Business name or contact name over 80 characters: "Use at most 80 characters." Password over 200 characters: "Use at most 200 characters." Other fields: "Fill in this field." or "Use at least 10 characters." | generic copy |
| Claim | "Claiming `<stations>`…" | "Held `<stations>` `<start>`–`<end>`. Confirm within `<seconds>` seconds." | Taken: "Just taken. Someone else claimed `<stations>` for that span." Not approved: "Your account can't book yet: `<status label>`." Documents: "Your documents don't cover `<date>`. Upload a renewal to book that day.", where `<date>` is the span's kitchen date. Hours: "No single pack has `<duration>` available. Buy a pack or release a hold to book this span." Claim limit (429): "Too many claims in the last minute. Try again in `<retry seconds>` seconds." Shape (422): the `fields` sentence of the first failing field in the order `stationId`, `shelfId`, `start`, `end`, exactly as the server sent it | "Couldn't reach the kitchen. Nothing was booked; try again." |
| Confirm | "Confirming…" | "Booked `<stations>` `<date>` `<start>`–`<end>`. `<duration>` debited; confirmation email on its way." | Expired: "Your hold ran out and `<station>` was released." Documents: as for Claim. Other conflicts: "This booking can no longer be confirmed." | generic copy |
| Move | "Moving `<stations>`…" | "Moved to `<stations>` `<date>` `<start>`–`<end>`." followed by "No hours changed.", "`<duration>` debited." or "`<duration>` returned to your pack.", where `<duration>` is the change in the booking's minutes | `invalid_transition`, `past_cutoff` or `move_limit_reached`: "This booking can no longer be moved." Hours: "This booking's pack doesn't have `<duration>` more available, so it can't move to that span.", where `<duration>` is the increase the move would need. Every other refusal, 422 included: the Claim copy for that refusal, with `<stations>` and `<date>` being the move's target | generic copy |
| Cancel | "Cancelling…" | Hold: "Hold released." Refunded: "Cancelled. `<duration>` returned to your pack." Late: "Cancelled. It was past the cutoff, so no hours were returned." | "This booking can no longer be cancelled." | generic copy |
| Buy pack | "Recording payment…" | "Pack added: `<hours>` hours. Receipt on its way to `<email>`." | Still in progress: "Your earlier press is still being recorded. Press the same button again in a moment; you won't be charged twice." Password dialog closed: "Purchase not sent. Confirm your password to buy a `<hours>`-hour pack." | Network failure: "Couldn't reach the kitchen. Press the same button again to finish this purchase; you won't be charged twice." Billing down: "Billing is unreachable. You were not charged and no hours were added." Paid but not recorded: "Payment taken, but your hours aren't on file yet. Press the same button again to finish; you won't be charged again." |
| Upload | "Uploading…" | "Uploaded. `<document type>` on file through `<date>`." | Type: "Upload a PDF, PNG or JPEG file." Size: "That file is too large." Date: "That date has already passed." Limit: "Coverage is below the kitchen's minimum per occurrence." Additional insured: "The certificate must name Halfsheet Commissary as additional insured." Restored after sign-in: "Your upload wasn't sent. Check it and press Upload." | Storage down: "Document storage is unreachable. Nothing was saved; try again shortly." |
| Open document | — | (file opens) | — | Storage down: "Previews are unavailable while document storage is unreachable." |
| Approve | "Approving…" | "`<business>` approved." | "`<business>` has a lapsed document and can't be approved." | generic copy |
| Check in | "Checking in…" | "`<business>` checked in at `<station>`." | Not cleared: "Not cleared for the floor: `<reason text>`." Window: "Too early or too late to check in this booking." Other conflicts: "This booking can't be checked in now." | generic copy |
| Check out | "Checking out…" | "Checked out. Cleanup logged." | Cleanup box: "Confirm the station was cleaned and sanitised." Other conflicts: "This booking can't be checked out now." | generic copy |
| No-show | "Marking no-show…" | "Marked no-show." | Too early: "The booking hasn't started yet." Other conflicts: "This booking can't be marked no-show now." | generic copy |
| Refund pack | "Refunding…" | "Refunded $`<amount>` to `<business>`." | In use: "This pack has a booking or hold on it, so it can't be refunded." Empty: "This pack has no hours left to refund." Already refunded: "This pack has already been refunded." Amount changed: "The refundable amount changed to $`<amount>`. Check it and press Refund again.", where `<amount>` is the re-read `refundableCents`. Password dialog closed: "Refund not sent. Confirm your password to refund this pack." | Billing down: "Billing is unreachable. No refund was issued." |
| Floor or door reload | (no text; the last stack stays) | — | — | "Floor plan couldn't refresh. Showing the last known stack." |
| Report | "Loading report…" (beside the Kitchen date group, not announced) | "Daily usage for `<date>`: Total booked `<duration>`.", where `<date>` is the URL's date and `<duration>` is `totalBookedMinutes` | — | generic copy |
| Any request answered 401 `unauthenticated` | — | — | "Your session ended. Sign in again." (then Sign in is shown) | — |

## Backend

### API (DP-03, DP-10, DP-11, DP-14, DP-18, DP-27, DP-40, DP-41, DP-44, DP-48, DP-50, DP-55, DP-61, DP-70, DP-72, DP-82, DP-84, DP-85, DP-87, DP-88, DP-89, DP-93, DP-94, DP-96, DP-97)

**Formats.**
- All endpoints live under `/api`.
- Requests with a body send `application/json`. The one exception is the document upload, which sends `multipart/form-data`.
- Responses are `application/json` unless stated otherwise.
- Times in responses are ISO 8601 with the kitchen's UTC offset, for example `2026-10-28T05:00:00-05:00`.
- Times in requests must be ISO 8601 with an explicit offset or `Z`.
- Dates are `YYYY-MM-DD`, kitchen-local. Durations and balances are whole minutes. Money is whole cents.

**Error body.**
- Every error is `{"error":"<code>","message":"<sentence>"}`.
- Validation failures use `validation_failed` and add `"fields":{"<field>":"<sentence>"}`, naming every failing field at once.
- Server boundary states the messages for cross-site, outage, idempotency, unreadable-body and unexpected errors, and what no error may contain. Business rules states the messages for `reauth_required` and `rate_limited`.

**Published body fields.**
- Each JSON body accepts exactly the keys in its row of the endpoint table. Routes with no request column accept no body, an empty body or `{}`.
- The upload accepts exactly the multipart parts in its row. `perOccurrenceLimit` and `additionalInsured` are accepted only when `kind` is `insurance_certificate`.
- Any other key or part fails validation under its own name with "This field is not accepted.", listed together with every other failing field. Such a request writes nothing: no account, session, booking, pack, document, object, sign-in attempt or email.
- For example, a claim body carrying `status`, `tenantId` and `packId` gets 422 with exactly those three keys among its `fields`. An application carrying `role` gets 422 on `role` and creates no account.

**Error precedence (whole API).** The first failing check decides the response:
1. 413 `payload_too_large`, then 415 `unsupported_media_type`.
2. 403 `cross_origin`, under the rule in Server boundary.
3. 401 `unauthenticated`.
4. 400 `malformed_body` or `idempotency_key_required`.
5. A key this caller already used on this endpoint: a matching body returns the stored response; a different body gets 409 `idempotency_conflict`; a key whose first request is still running gets 409 `idempotency_in_progress`. This lookup runs before any Kill Bill, storage or mail call.
6. 429 `rate_limited`, on claims only, under the claim limit in Business rules.
7. 404 `not_found` for an unknown id in the path or query string, and, for a tenant caller, another tenant's booking, pack, document, document file or tenant record named there. An id inside a request body that names no record is not a 404; it fails validation at step 10. The only such body ids are `stationId` and `shelfId` on claims and moves.
8. 403 `forbidden` when the role table does not open the route to the caller's role. A tenant naming their own record on a route closed to tenants gets 403.
9. 403 `reauth_required`, on money actions only, under the step-up password check in Business rules.
10. 422 `validation_failed`, including unaccepted fields.
11. Rule refusals, in the order each rule in Business rules lists them. This covers the 409 state conflicts, 412 `refund_amount_changed`, and on sign-in and password confirmation 429 `too_many_attempts` before 401 `invalid_credentials`.
12. 503 provider unavailable.

Endpoint rows name only their own extra errors.

**Roles.** Callers are `owner`, `shift_lead` or `tenant`; "staff" means owner or shift lead.

**Role table.** This is the complete list of routes. "own" means only the calling tenant's records; "—" means 403 `forbidden`, subject to the precedence above.

| Route | owner | shift_lead | tenant |
|---|---|---|---|
| `GET /api/health`, `POST /api/session`, `POST /api/tenants/apply`, `GET /api/kitchen` | open (also signed out) | open | open |
| `DELETE /api/session`, `POST /api/session/confirm`, `GET /api/me`, `GET /api/floor`, `GET /api/bookings` | yes | yes | yes |
| `GET /api/bookings/:id` | yes | yes | own |
| `POST /api/bookings`, `POST /api/bookings/:id/confirm`, `POST /api/bookings/:id/move`, `POST /api/bookings/:id/cancel` | — | — | own |
| `POST /api/bookings/:id/check-in`, `/check-out`, `/no-show`, `GET /api/door` | yes | yes | — |
| `GET /api/packs`, `POST /api/packs` | — | — | own |
| `GET /api/packs/:id` | yes | — | own |
| `POST /api/packs/:id/refund` | yes | — | — |
| `POST /api/documents` | — | — | own |
| `GET /api/documents`, `GET /api/documents/:id`, `GET /api/documents/:id/file` | yes | — | own |
| `GET /api/tenants`, `GET /api/tenants/:id`, `POST /api/tenants/:id/approve`, `GET /api/reports/daily` | yes | — | — |

For example, a tenant checking in their own booking gets 403, and checking in another tenant's booking gets 404. A shift lead asking for a pack id that does not exist gets 404, and for a real pack gets 403.

**Published field lists.** These are exact; nothing more is sent.

**Me:** `id, role, email, displayName, tenant`. `tenant` is `null` or `{id, businessName, status, suspendedReason}`.

**Station:** `id, name, kind, cleanupMinutes, col, row, intervals`.
- When a span is requested, it adds `occupiedMinutes, bufferMinutes, freeMinutes`.
- `kind` is `range`, `prep_table`, `mixer` or `cooler_shelf`.

**Interval:**
- Tenant caller: `start, end, bufferEnd, mine`.
- Staff caller: `start, end, bufferEnd, bookingId, status, tenantId, tenantName`.
- A paired booking appears as an interval on both its stations.

**Email status:**
- A booking email is `{kind, status, sentAt}`; a pack receipt is `{status, sentAt}`.
- `kind` is `booking_confirmed` or `booking_moved`.
- `status` is `queued` or `sent`, and `sentAt` is the delivery time with the kitchen offset, or `null`. Both follow the delivery-status rule under Mail in Services.

**Booking:**
- Tenant caller: `id, stationId, stationName, shelfId, shelfName, start, end, bufferEnd, status, holdExpiresAt, packId, debitedMinutes, refundedMinutes, cancelReason, createdAt, cutoffAt, cancelCreditMinutes, moveCount, movable, emails`.
- Staff caller: the same keys plus `tenantId, tenantName, doorLog, cleanupNote`.
- Field values:
  - `shelfId` and `shelfName` are `null` without a shelf.
  - `status` is `held`, `confirmed`, `checked_in`, `completed`, `cancelled` or `no_show`.
  - `cancelReason` is `null`, `tenant` or `hold_expired`.
  - `packId` is the reserved pack, from the moment the booking is held.
  - `cutoffAt`, `cancelCreditMinutes` and `movable` are defined in Business rules.
  - `moveCount` is 0 or 1.
- `emails` lists booking email statuses, oldest first: one `booking_confirmed` entry once confirmed, then one `booking_moved` entry after a move. A never-confirmed booking has `[]`, and entries stay after a later cancel, check-in or completion.
- `doorLog` is `[{action, at, by}]`, oldest first. `action` is `check_in`, `check_out` or `no_show`; `at` has the kitchen offset; `by` is the acting staff member's `displayName`.
- `cleanupNote` is the check-out note, or `null`.
- Absent values are `null`.

**Door entry:** `bookingId, tenantId, tenantName, stationId, stationName, shelfId, shelfName, start, end, status, cleared, reason, checkInOpensAt, actions, doorLog, cleanupNote`.
- `reason` is `null`, `not_approved`, `insurance_lapsed` or `food_handler_lapsed`.
- `checkInOpensAt` is 30 minutes before `start`, with the kitchen offset.
- `actions` is defined under Door in Business rules.

**Pack:** `id, hours, purchasedMinutes, balanceMinutes, heldMinutes, availableMinutes, priceCents, status, invoiceId, purchasedAt, receiptEmail`.
- `status` is `active` or `refunded`.
- `invoiceId` is the Kill Bill invoice id.
- `receiptEmail` is the pack receipt's email status.
- The pack detail adds:
  - `refundableCents`: the refund amount from Packs in Business rules for the current balance, and 0 once refunded
  - `refundedCents`: `null` until refunded
  - `entries: [{id, movementId, movement, side, minutes, bookingId, createdAt}]`. `movement` is `purchase`, `booking_debit`, `cancellation_credit`, `move_adjustment` or `refund`. `side` is `pack` or `kitchen`. `minutes` is signed.

**Document:** `id, tenantId, kind, expiresOn, perOccurrenceLimit, additionalInsured, contentType, sizeBytes, sha256, hasFile, current, coverState, daysLeft, uploadedAt, notices`.
- `kind` is `insurance_certificate` or `food_handler_card`.
- `perOccurrenceLimit` is whole dollars and `additionalInsured` a boolean; both are `null` for food-handler cards.
- `sizeBytes` is the exact byte length of the stored file.
- `sha256` is the 64-character lowercase hex SHA-256 of the stored file's bytes, or `null` when `hasFile` is false.
- `coverState` and `daysLeft` are defined under Documents in Business rules.
- `notices` is `[{point, status, sentAt}]`, oldest claim first. `point` is `seven_days` or `today`. `status` and `sentAt` follow the delivery-status rule.

**Tenant (owner only):** `id, businessName, contactName, email, status, suspendedReason, insuranceExpiresOn, foodHandlerExpiresOn, createdAt`. The tenant detail adds `packs` (pack details) and `documents` (Documents, current and superseded, newest first).

**Endpoints.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | — | 200 `{"status":"ok"}` | — |
| `POST /api/session` | `{"email","password"}` | 200 `{"user":<Me>}`; sets cookie `sh_session` | 401 `invalid_credentials`; 429 `too_many_attempts` with `Retry-After`; 422 empty fields |
| `DELETE /api/session` | — | 204; cookie cleared | — |
| `POST /api/session/confirm` | `{"password"}` | 204; the session's password check is fresh | 401 `invalid_credentials` with message "That password doesn't match your account."; 429 `too_many_attempts` with `Retry-After`; 422 empty password |
| `GET /api/me` | — | 200 `<Me>` | — |
| `POST /api/tenants/apply` | `{"businessName"` 1–80 chars, `"contactName"` 1–80 chars, `"email"`, `"password"` 10–200 chars`}` | 201 `{"user":<Me>}` with status `applied`; sets `sh_session` | 409 `email_taken`; 422 control characters in a name, a name over 80 characters, or a password under 10 or over 200 characters, with the Apply messages from Feedback states |
| `GET /api/kitchen` | — | 200 `{"name","timeZone","opensAt","closesAt","cleanupMinutes","minimumBookingMinutes","holdSeconds","today","now"}` | — |
| `GET /api/floor?date=&from=&to=` | `date` required; `from` and `to` optional `HH:MM`, both or neither | 200 `{"date","from","to","now","spanStatus","coolerFree":[{"time":"HH:MM","freeShelves":<n>}],"stations":[<Station>]}` for that kitchen date, intervals shaped for the caller's role. `spanStatus` is `null` without a span, otherwise `open`, `started` or `beyond_horizon` under Span status in Business rules. `coolerFree` always holds all 36 half hours of the date, 05:00 to 22:30, in time order, whatever the span | 422 bad date, or a span off the half hour, outside operating hours, or with `from` not before `to` |
| `POST /api/bookings` | header `Idempotency-Key`; `{"stationId","start","end","shelfId"}`, `shelfId` optional | 201 `<Booking>` with status `held` | 429 `rate_limited` with `Retry-After`; rule errors under Claims |
| `GET /api/bookings?date=` | tenant: `date` optional; staff: `date` required | 200 `{"bookings":[<Booking>]}`. A tenant gets only their own bookings, earliest start first: all of them without `date`, or those whose start falls on or after `date`. Staff get every booking whose start falls on `date`, in start order | 422 bad date, or missing date for staff |
| `GET /api/bookings/:id` | — | 200 `<Booking>` | — |
| `POST /api/bookings/:id/confirm` | — | 200 `<Booking>` | rule errors under Confirming |
| `POST /api/bookings/:id/move` | header `Idempotency-Key`; `{"stationId","start","end","shelfId"}`, `shelfId` optional, stating the whole new occupancy | 200 `<Booking>` | rule errors under Moving |
| `POST /api/bookings/:id/cancel` | — | 200 `<Booking>` | rule errors under Cancelling |
| `POST /api/bookings/:id/check-in` | — | 200 `<Booking>` | rule errors under Door |
| `POST /api/bookings/:id/check-out` | `{"cleanupDone","note"}`; `cleanupDone` a boolean, note 0–500 chars | 200 `<Booking>` | 422 `cleanupDone` missing or not true (message: the Check out cleanup-box copy from Feedback states), or note too long; rule errors under Door |
| `POST /api/bookings/:id/no-show` | — | 200 `<Booking>` | rule errors under Door |
| `GET /api/door?date=` | `date` optional, default the kitchen's today | 200 `{"date","now","entries":[<Door entry>]}`, in start order | 422 bad date |
| `GET /api/packs` | — | 200 `{"packs":[<Pack>]}`, oldest first | — |
| `POST /api/packs` | header `Idempotency-Key`; `{"hours":10\|20\|40}` | 201 `<Pack>` | 403 `reauth_required` for 20 or 40 hours; 422 other hours; 503 `billing_unavailable` or `purchase_pending` |
| `GET /api/packs/:id` | — | 200 pack detail | — |
| `POST /api/packs/:id/refund` | `{"expectedCents":<whole number, 0 or more>}`, required | 200 pack detail | 403 `reauth_required`; 422 `expectedCents` missing or not a whole number; rule errors under Packs; 503 `billing_unavailable` |
| `POST /api/documents` | multipart parts `kind`, `expiresOn`, `file`; insurance also needs `perOccurrenceLimit` (whole dollars) and `additionalInsured` (`true` or `false`) | 201 `<Document>` | 422 on `kind`, `expiresOn`, `file`, `perOccurrenceLimit`, `additionalInsured`; 503 `storage_unavailable` |
| `GET /api/documents?tenantId=` | owner: `tenantId` required; tenant: `tenantId` optional and, if given, their own | 200 `{"documents":[<Document>]}`, newest first | 422 owner without `tenantId` |
| `GET /api/documents/:id` | — | 200 `<Document>` | — |
| `GET /api/documents/:id/file` | — | 200 the stored bytes, with the headers in Services | 404 `file_not_found` when `hasFile` is false; 503 `storage_unavailable` |
| `GET /api/tenants` | — | 200 `{"tenants":[<Tenant>]}`, sorted by business name | — |
| `GET /api/tenants/:id` | — | 200 tenant detail | — |
| `POST /api/tenants/:id/approve` | — | 200 `<Tenant>` | rule errors under Tenant onboarding |
| `GET /api/reports/daily?date=` | `date` required | 200 `{"date","timeZone","totalBookedMinutes","stations":[{"stationId","stationName","bookedMinutes","bookingCount"}],"tenants":[{"tenantId","businessName","bookedMinutes","bookingCount","noShowCount"}]}` | 422 bad date |

`now` in `/api/kitchen`, `/api/floor` and `/api/door` is the server's clock at the start of that request's database transaction, with the kitchen offset.

**Upload limits.**
- **Size.** The file part may be at most 5,000,000 bytes; exactly 5,000,000 is allowed. A larger file fails validation on `file`.
- **Type**, judged only from the file's leading bytes:
  - PDF: the first five bytes are the ASCII characters `%PDF-`.
  - PNG: the first eight bytes are exactly `0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A`.
  - JPEG: the first three bytes are exactly `0xFF 0xD8 0xFF`. Later bytes may be anything.
  - A file shorter than its signature, or matching none of these, fails validation on `file`. That includes SVG and HTML, whatever their name or declared type.
- **Content.** The file part may contain any bytes. That includes NUL bytes, every value from 0x80 to 0xFF, sequences that look like a multipart boundary, and trailing line breaks. All of them belong to the file.
- **File name.** The original file name is never stored, reflected or used in any key.

### Business rules (DP-11, DP-12, DP-18, DP-19, DP-20, DP-27, DP-28, DP-29, DP-30, DP-32, DP-33, DP-34, DP-35, DP-37, DP-38, DP-43, DP-44, DP-45, DP-47, DP-48, DP-51, DP-53, DP-55, DP-56, DP-57, DP-58, DP-61, DP-65, DP-70, DP-72, DP-82, DP-84, DP-85, DP-87, DP-89, DP-96, DP-97)

**Kitchen clock.**
- The kitchen's time zone is the IANA zone in `KITCHEN_TIME_ZONE`. It may be any zone, including zones with half-hour offsets such as `Asia/Kolkata`.
- Every date and time rule below uses kitchen-local wall-clock time in that zone, never the browser's zone and never UTC. That covers "today", operating hours, half-hour alignment, cutoffs, cover states, notice points, door dates, span status and report dates.
- Operating hours run from 05:00 to 23:00.
- Booked minutes are real elapsed minutes.
- "Now" for holds, windows, door actions, span status, cover states, cutoffs, the password check and the claim limit is the Postgres server's clock at the start of the database transaction of the request being judged.

**Sign-in attempts.**
- A failed sign-in is a `POST /api/session` that passes validation but does not match an account's email and password. That includes any attempt for an email no account uses. Emails are compared trimmed and lower-cased. A wrong password on `POST /api/session/confirm` also counts as a failed sign-in for the signed-in user's email.
- When an email has 5 or more failed sign-ins within the last `SIGNIN_WINDOW_SECONDS` seconds (default 900), counting only those since its last successful sign-in, every further sign-in or password confirmation for that email answers 429 `too_many_attempts`:
  - This holds even with the right password, which is not checked.
  - `Retry-After` gives whole seconds, rounded up, from 1 to the window length, until the oldest counted failure leaves the window.
  - The message is the sign-in limit copy.
- Refused 429 attempts and requests refused as cross-site are not counted.
- A successful sign-in or password confirmation clears that email's count. Other emails are unaffected.
- Unknown emails are counted and refused exactly like known ones, with identical status codes and bodies.
- The count lives in Postgres and is shared by every app process.

**Step-up password check.**
- The money actions are `POST /api/packs` whose body `hours` is 20 or 40, and `POST /api/packs/:id/refund`. A 10-hour purchase, and a purchase body whose `hours` is anything other than 20 or 40, needs no check.
- `POST /api/session/confirm` with the signed-in user's correct password records the confirmation time on the session and answers 204. Signing in does not count as a confirmation.
- A money action is allowed while its transaction-start now is before the session's confirmation time plus `REAUTH_SECONDS` seconds (default 300); exactly at that moment it is no longer allowed. Otherwise it answers 403 `{"error":"reauth_required","message":"Confirm your password to continue."}` at step 9 of the precedence, and writes nothing and calls nothing: no Kill Bill call, ledger entry, email or idempotency record.
- The confirmation time lives on the session in Postgres, so every app process honours it, and it ends with the session at sign-out.
- A purchase answered from a stored response at step 5 never needs the check.

**Claim limit.**
- A tenant's claim (`POST /api/bookings`) is counted when it reaches step 6 of the precedence, that is, when it was not answered by a cross-site, authentication, body, key or replay check. A counted claim stays counted whatever its later outcome (422, 409 or 201). Replays, conflicts and in-progress answers at step 5 are not counted, and neither are refused 429 claims. Moves are not claims.
- A claim is refused with 429 `{"error":"rate_limited","message":"Too many claims in the last minute. Try again shortly."}` when that tenant already has 10 counted claims within the last 60 seconds (a rolling window). The refusal writes nothing and carries `Retry-After`: whole seconds, rounded up, from 1 to 60, until the oldest counted claim is 60 seconds old.
- Counting and the check are decided together in Postgres across every app process, so however many claims one tenant sends at once, at most 10 are counted within any 60 seconds and every other one gets 429.
- Other tenants are unaffected.

**Application names.** A `businessName` or `contactName` containing any control character (U+0000 to U+001F, or U+007F to U+009F, including carriage return, line feed and tab) fails validation on that field with the Apply control-character copy. No account is written.

**Booking shape.** A claim or move is validated against the rules below, in order. Each field fails with the sentence of the first rule it breaks; a field breaking no rule is not listed. Every failing field is reported in one 422.

| # | Field | Fails when | Sentence |
|---|---|---|---|
| 1 | `stationId` | missing, or names no station | "Pick a station on the floor plan." |
| 2 | `shelfId` | present and not `null`, and either names no station of kind `cooler_shelf`, or `stationId` names a cooler shelf | "Pick a walk-in shelf to pair with a range, prep table or mixer." |
| 3 | `start`, `end` (each) | missing, not a string, or not an ISO 8601 date-time with an explicit offset or `Z` | "Use an ISO 8601 time with a UTC offset." |
| 4 | `start`, `end` (each) | its kitchen-local time is not on the hour or half hour with zero seconds | "Use a time on the hour or half hour." |
| 5 | `end` | both times passed rule 3, and `end` is less than 120 minutes after `start` (exactly 120 is allowed) | "Bookings last at least 2 h." |
| 6 | `start` | its kitchen-local time is before 05:00, or at or after 23:00 | "Book between 05:00 and 23:00 on one day." |
| 6 | `end` | it is on a different kitchen date from `start`, or its kitchen-local time is after 23:00 | "Book between 05:00 and 23:00 on one day." |
| 7 | `start` | the span is `started` under Span status | the started span hint from Feedback states |
| 8 | `start` | the span is `beyond_horizon` under Span status | the horizon span hint from Feedback states |
| 9 | `start` (moves only) | the move names the booking's current station, shelf, start and end | "Pick a different station or span." |

An absent `shelfId` and `null` both mean no shelf. Unaccepted fields keep their own sentence from Published body fields.

**Span status.** One rule decides whether a span on a kitchen date can still be booked. The floor's `spanStatus` and the claim and move start checks both use it, each judged at its own request's now:
- `started` when the span's kitchen-local start is at or before now
- otherwise `beyond_horizon` when its date is later than the kitchen's today plus 60 days (today plus exactly 60 is allowed)
- otherwise `open`

**Booking minutes.**
- A booking occupies its station, plus its shelf when it has one.
- Its minutes are its span minutes times the number of stations it occupies (1 or 2). For example, a paired 2-hour booking is 240 minutes.
- Holds, `heldMinutes`, the `insufficient_hours` check, `debitedMinutes`, move adjustments, cancellation credits, `cancelCreditMinutes`, the hours-debited lines and the tenant report all use this figure.

**Station occupancy.**
- Every booking that is neither `cancelled` nor an expired hold occupies each of its stations from its start until 30 minutes after its end. `bufferEnd` is that later moment, and the buffer may run past closing.
- Two bookings never have overlapping occupied periods on one station. Back-to-back is fine: a booking ending 08:00 allows the next to start at 08:30.
- A paired booking always occupies both of its stations, and once cancelled or expired it occupies neither. No booking is ever held on only one station of its pair.

**Live holds.**
- The hold time is `HOLD_SECONDS` seconds (default 90).
- A held booking is live only while now is before its `holdExpiresAt`.
- From that moment, with no further request needed, the hold counts as `cancelled` with `cancelReason` `hold_expired` in every response, claim check and pack figure, and every station it occupied frees up.
- A hold never writes ledger entries.

**Hold edge for claims and moves.**
- A hold whose `holdExpiresAt` is at or before the start of a claim's own database transaction never causes `slot_taken` for that claim and never counts toward its `insufficient_hours`. This holds even while the hold's stored status still reads `held` and no sweep has run.
- A claim whose transaction starts before `holdExpiresAt` treats that hold as occupied and gets 409 `slot_taken` when it overlaps.
- When a claim overlaps an expired hold, the claim's transaction stores that hold as `cancelled` with `hold_expired`. The no-overlap rule stays enforced inside Postgres for every stored row.
- Of simultaneous claims that arrive after a hold's edge and overlap it, exactly one is held and the rest get 409 `slot_taken`, never 5xx.
- A move treats holds exactly as a claim does.

**Pack reservation.**
- A pack's `heldMinutes` is the sum of the minutes of its live held bookings. `availableMinutes` is `balanceMinutes − heldMinutes`. Both are worked out from the bookings on every read.
- A claim reserves its minutes on the tenant's earliest-purchased active pack whose `availableMinutes` is at least the booking's minutes, and sets `packId` to that pack. A booking is never split across packs.
- However many claims one tenant sends at once, no pack's `heldMinutes` ever exceeds its `balanceMinutes`; a claim that would exceed it gets 409 `insufficient_hours`.
- A claim's reservation on a pack and a refund of that pack are judged one after the other under that pack's lock, the same lock both take. Of one refund and any number of simultaneous claims by the pack's tenant, the result is always one of these:
  - the refund answers 200, and every claim got 409 `insufficient_hours` or reserved a different active pack
  - the refund answers 409 `pack_in_use`, and the claims held before it name the pack
- A refunded pack never has a live hold, or a confirmed or checked-in booking, naming it as `packId`, and it is never reserved, debited or moved against.

**Claims (tenant).** A claim is validated first, then checked for these conflicts in order:
1. 409 `tenant_not_approved` when the tenant's current status is not `approved`.
2. 409 `documents_not_valid` when either current document's cover ends before the booking's kitchen date.
3. 409 `insufficient_hours` when no active pack has `availableMinutes` covering the booking's minutes.
4. 409 `slot_taken` when the occupied period overlaps another booking on any station the claim would occupy.

A claim passing all of them creates a `held` booking with `holdExpiresAt` set to now plus the hold time. Of any number of simultaneous claims that overlap on any one station, single or paired, across requests and app processes, exactly one is held and every other one gets 409 `slot_taken`. Contention never answers 5xx: a lock wait, deadlock or serialization failure inside Postgres ends as a retry or as 409 `slot_taken`.

**Confirming.** `held → confirmed`, by the owning tenant while the hold is live. The checks run in this order:
1. 409 `hold_expired`, only for a hold that was never confirmed (stored status `held`, or `cancelled` with `hold_expired`), when the confirm's transaction starts at or after `holdExpiresAt`. It writes nothing.
2. A booking already `confirmed` returns 200 with the confirmed booking at any time, with no second debit or email. Every other status gets 409 `invalid_transition`.
3. 409 `documents_not_valid`, re-checked as for Claims.

In one step, confirming debits the booking's minutes from its reserved pack as one `booking_debit` movement, sets `debitedMinutes` and queues the confirmation email. Any number of simultaneous confirms of one live hold, on any app processes, all answer 200 with the same confirmed booking, leaving exactly one `booking_debit` movement and one queued confirmation email.

**Cutoff and cancel credit.**
- A booking's cutoff (`cutoffAt`) is the same kitchen-local wall-clock time on the calendar day before its start. Across a daylight-saving change, that can be 23 or 25 elapsed hours before the start. It always follows the booking's current start.
- `cancelCreditMinutes`, computed at the start of the request's transaction:
  - confirmed booking at or before its cutoff: `debitedMinutes`, exactly at the cutoff included
  - confirmed booking after its cutoff: 0
  - every other status: `null`
- The cancel route credits by this same rule, judged at its own transaction start.

**Moving.** `confirmed → confirmed`, by the owning tenant, at most once per booking. A move is validated under Booking shape, then checked for these conflicts in order:
1. 409 `invalid_transition` unless the booking is `confirmed`.
2. 409 `past_cutoff` when now is after the current cutoff. Exactly at the cutoff is allowed.
3. 409 `move_limit_reached` when `moveCount` is 1.
4. 409 `tenant_not_approved`, as for Claims.
5. 409 `documents_not_valid`, judged for the new date.
6. 409 `insufficient_hours` when the booking's own pack has `availableMinutes` below the increase in minutes. Extra minutes never come from another pack, and a move with no increase skips this check.
7. 409 `slot_taken` when the new occupied period overlaps another booking on any station the move would occupy. The booking's own current occupancy never conflicts, so a 30-minute shift overlapping itself succeeds.

`movable` is true exactly when checks 1, 2 and 3 would all pass at the start of that request's transaction, by the same rule the route applies.

A successful move does all of this in one step:
- replaces the booking's occupancy on every station, along with its start, end, `bufferEnd`, station and shelf
- writes one `move_adjustment` movement for a non-zero change in minutes: an increase takes the difference from the pack side, a decrease adds it
- sets `debitedMinutes` to the new minutes and `moveCount` to 1
- queues the booking-moved email

A refused move changes nothing. At no moment is the old occupancy free for a rival.

Of a move and any number of overlapping claims at the same moment, the result is never two occupants of one period, and contention never answers 5xx. Of simultaneous moves of one booking, one answers 200, and each other one gets the refusal the rules give for the state it left. After a move, the door list, report and floor show the booking on its new date, span and stations.

**Cancelling.**
- The owning tenant may cancel `held` or `confirmed`; any other status gets 409 `invalid_transition`.
- Cancelling a hold releases every station and the reservation, with no ledger entries.
- Cancelling a confirmed booking credits its `cancelCreditMinutes` (judged at the cancel's transaction start) back to the same pack as one `cancellation_credit` movement when above 0, and sets `refundedMinutes` to that value. `cancelReason` becomes `tenant`, and every station frees up.
- Of simultaneous cancels of one booking, exactly one answers 200 and the others get 409 `invalid_transition`, so at most one `cancellation_credit` exists per booking.
- A confirm racing a cancel on one held booking ends one of two ways: cancelled with `debitedMinutes` null and no ledger entries, or confirmed and then cancelled under the credit rule.

**Hour ledger.**
- Each pack movement writes exactly two entries in one step that cannot half-succeed: a `pack`-side entry and a `kitchen`-side entry, with equal and opposite minutes and one shared `movementId`.

| Movement | Effect on the pack side |
|---|---|
| `purchase` | adds the purchased minutes |
| `booking_debit` | takes the booking's minutes |
| `move_adjustment` | takes or adds the change |
| `cancellation_credit` | adds the credited minutes |
| `refund` | takes the whole remaining balance |

- Entries are never edited or deleted; corrections are only new movements.
- `balanceMinutes` always equals the sum of the pack's `pack`-side entries and is never negative.

**Packs.**
- Pack sizes and prices are in Seed data. A pack's purchase credit exists only after its Kill Bill invoice is paid.
- The refund amount in cents is `floor(priceCents × balanceMinutes ÷ purchasedMinutes)`, in whole-number arithmetic with the remainder dropped. For example, a $260.00 10-hour pack with 450 minutes left refunds 19500 cents.
- `active → refunded`, by the owner, with these checks in order under a lock on the pack:
  1. 409 `invalid_transition` when already `refunded`.
  2. 409 `pack_empty` when `balanceMinutes` is 0.
  3. 409 `pack_in_use` when `heldMinutes` is above 0, or any booking with this `packId` is `confirmed` or `checked_in`.
  4. 412 `refund_amount_changed` when `expectedCents` differs from the amount computed under that lock. Nothing reaches Kill Bill.
- A successful refund records the Kill Bill refund in Services, then writes one `refund` movement and sets `refundedCents`.
- Of simultaneous refunds of one pack, exactly one answers 200 and the others get 409 `invalid_transition`, with one Kill Bill refund.

**Retried requests.**
- **Key header.** `POST /api/bookings`, `POST /api/bookings/:id/move` and `POST /api/packs` require an `Idempotency-Key` header of 1 to 100 visible ASCII characters; without one they get 400 `idempotency_key_required`.
- **Key scope.** A key belongs to the signed-in user and the endpoint (method plus route pattern, so every move is one endpoint). It is kept in Postgres for at least 24 hours, the same across that user's sessions and every app process.
- **Replay.** A repeat by the same user on the same endpoint with the same key and an equal body returns the first 2xx's stored status and body:
  - It carries the extra header `Idempotent-Replay: true`.
  - It has no new effects, and it is answered at step 5 of the precedence, before any Kill Bill, storage or mail call. So it is answered on every app process, including one that cannot reach Kill Bill.
  - "Equal body" ignores key order and whitespace, an absent `shelfId` equals `null`, and on a move the path's booking id counts as part of the body.
  - The stored body is returned byte for byte exactly as first sent, even after the record has since changed. For example, a purchase replayed after the owner refunded that pack still shows `"status":"active"` and the original balance.
- **Conflicts.** The same key with a different body gets 409 `idempotency_conflict` and calls no provider. A repeat while the first is still running gets 409 `idempotency_in_progress`.
- **One first run per key.** Of any number of simultaneous same-user, same-endpoint, same-key requests with equal bodies, on any app processes, exactly one runs; every other one answers the stored response (once the first has stored it) or 409 `idempotency_in_progress`, never 5xx. For purchases this means exactly one Kill Bill invoice and one PURCHASE payment exist.
- **What is stored.** Only 2xx responses are stored, so after any error the same key runs fresh. The one exception is a purchase answered 503 `purchase_pending`, which is finished as stated in Services.
- **Other users and endpoints.** A different user's identical key, or the same user's key on another endpoint, runs fresh. It never receives the other run's stored response or the replay header.

**Tenant onboarding.**
- `applied` on application.
- `applied → documents_pending` automatically, once the tenant has a current document of each kind.
- `documents_pending → approved` by the owner's approve. Both current documents must have `expiresOn` on or after today; otherwise 409 `documents_not_valid`.
- `approved → suspended` automatically as soon as today is later than either current document's `expiresOn`. This is judged on every request, so it takes effect from kitchen-local midnight. `suspendedReason` is `insurance_lapsed` or `food_handler_lapsed`, insurance first.
- `suspended → approved` automatically when an upload leaves both current documents with `expiresOn` on or after today.

Approving any status other than `documents_pending` gets 409 `invalid_transition`. A suspended tenant's existing bookings stay, but the door rule refuses check-in.

**Documents.**
- **Current document.** A tenant's current document of a kind is the one uploaded most recently. Older ones of that kind are superseded.
- **Upload checks:**
  - An `expiresOn` before today fails validation; today is allowed.
  - A certificate of insurance needs a `perOccurrenceLimit` of at least 1,000,000 dollars (exactly 1,000,000 is allowed) and `additionalInsured` true. Otherwise it fails on that field.
- **Cover rule.** One rule decides cover for bookings, clearance, onboarding and display. A document is valid through 23:59:59 kitchen-local on its `expiresOn`. It covers a booking or door date on or before that date, and nothing later.
- **`coverState`**, computed at the request's transaction start from the kitchen's today, by the first matching line:
  1. `superseded` for a superseded document
  2. `lapsed` when today is later than `expiresOn`
  3. `expires_today` when today is `expiresOn`
  4. `expires_soon` when `expiresOn` is 1 to 7 kitchen days ahead
  5. `ok` otherwise
- **`daysLeft`** is the number of kitchen days from today to `expiresOn` for `ok`, `expires_soon` and `expires_today` (0 on the day itself), and `null` otherwise.
- `lapsed` therefore begins at the next kitchen-local midnight after `expiresOn`.

**Door.**
- **Clearance.** A tenant is cleared for kitchen date D when their status is `approved` or `suspended` and both current documents cover D. Otherwise `reason` is `not_approved`, then `insurance_lapsed`, then `food_handler_lapsed`, in that precedence. The door list judges each entry for its own date; check-in judges for today.
- **Edges:**
  - `confirmed → checked_in` by staff, inside the window from `checkInOpensAt` (allowed) until end (not allowed). Checks in order: 409 `invalid_transition` for any other status, 409 `outside_check_in_window`, then 409 `not_cleared` when not cleared today.
  - `checked_in → completed` by staff check-out with `cleanupDone` true. A `cleanupDone` that is not true fails validation before any state check. Any other status gets 409 `invalid_transition`. The note becomes `cleanupNote`.
  - `confirmed → no_show` by staff at or after start. Checks: 409 `invalid_transition` for any other status, then 409 `too_early` before start.
- **Published actions.** Each door entry's `actions` lists, in this order, the door actions that would succeed now, computed at the request's transaction start by the same rules the door routes apply:
  - `"check_in"` when check-in would pass every check
  - `"check_out"` when the status is `checked_in`
  - `"no_show"` when the status is `confirmed` and now is at or after start

  If nothing changes in between, every listed action succeeds and every unlisted one gets its 409, on every app process.
- **After the door.** `completed` and `no_show` keep their station occupancy and never change the ledger.

**Door log.**
- Each successful check-in, check-out or no-show appends exactly one `doorLog` entry, in the same step as its transition, naming the action, time and acting staff member.
- A refused action appends nothing. Entries are never edited or deleted.
- Of simultaneous door actions on one booking, from any mix of staff and processes, exactly one answers 200, and the others get the conflict the rules give for the status it left. For example, five check-ins from the shift lead and five from the owner at once yield one 200, nine 409 `invalid_transition` and one `check_in` entry by the winner.

**Station metrics.** For a requested span:
- `occupiedMinutes` is the span minutes covered by any booking's occupied period on that station
- `bufferMinutes` is the part of those minutes falling only in cleanup buffers
- `freeMinutes` is the span minus `occupiedMinutes`

**Cooler free shelves.**
- Each `coolerFree` row counts the cooler shelves free for that half hour.
- A shelf is free in a row only when no occupied period, cleanup buffer included, overlaps that half hour by any length. A period ending exactly when the half hour starts does not overlap it.
- It reads the same occupancy as the station metrics, with the same hold edge as a claim, at that request's `now`.

**Daily usage.**
- The report covers bookings whose start falls on the requested kitchen date and whose status is `confirmed`, `checked_in`, `completed` or `no_show`.
- **Per station:** `bookedMinutes` sums the span lengths of those bookings that occupy it, buffers excluded, so a paired booking counts on its station and its shelf. `bookingCount` counts them.
- **Per tenant:** `bookedMinutes` sums their bookings' minutes.
- **Total:** `totalBookedMinutes` is the sum over stations, which equals the sum over tenants.
- **Lists:** `stations` holds every station in seed order, including those with zero. `tenants` holds only tenants with at least one such booking. `noShowCount` counts each tenant's `no_show` bookings.

**Expiry notice points.**
- Each current document of an `approved` or `suspended` tenant has two notice points: `seven_days` on the kitchen date seven days before `expiresOn`, and `today` on `expiresOn`.
- Every running app process sweeps at start and then every `EXPIRY_SWEEP_SECONDS` seconds (default 3600). A sweep sends a point only when today is that point's date.
- Before queueing a notice, the sweep claims that document's point in Postgres. A claimed point is never claimed again, by any process or after any restart.
- A superseded document gets no further notices. A point whose date passed is never sent late; for example, a certificate uploaded expiring three days ahead never gets a `seven_days` notice.
- Each claimed point appears in its document's `notices`, and superseded documents keep theirs. Status follows the delivery-status rule.

### Services (DP-15, DP-16, DP-18, DP-19, DP-21, DP-31, DP-43, DP-45, DP-54, DP-57, DP-62, DP-63, DP-72, DP-82, DP-88, DP-93, DP-94)

**Postgres** (`DATABASE_URL`) holds every record:
- users, sessions with their password confirmation times, sign-in attempts and counted claims
- tenants and stations
- bookings, their station occupancies and holds
- the door log
- documents' metadata and fingerprints
- packs and ledger entries
- idempotency keys with stored responses
- purchase attempts and their Kill Bill payment references
- notice point claims
- the mail queue with each email's delivery state

The no-overlap rule for occupied periods is enforced inside Postgres, for single and paired bookings, under simultaneous requests from several processes and during a move. The app applies its schema and seed data idempotently every time it starts; a second process starting against a seeded database adds nothing. Tenant, pack and purchase attempt ids are random UUIDs, so external keys never collide between app instances on separate databases that share one Kill Bill.

**Kill Bill** (`KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`):
- **Order.** Every Kill Bill call for a purchase, the account lookup or creation included, happens only after the replay lookup and the key claim at step 5 of the precedence. A replay never contacts Kill Bill.
- **Account.** On a tenant's first purchase, the app creates their Kill Bill account: external key `stationhouse-<tenantId>`, name `<business>`, the tenant's email, currency USD, and Kill Bill's external payment method as default.
- **Purchase.**
  - Each purchase makes one committed invoice on that account with one external charge item, described `Stationhouse <hours>-hour pack`, for the pack price in dollars.
  - One PURCHASE payment transaction against the external payment method pays it, leaving its balance at 0.00.
  - Only then does the app write the pack, its purchase movement and its queued receipt email, in one step.
- **Billing failure.** If any Kill Bill step fails after the invoice exists, the app voids that invoice (account balance back to 0.00). It answers 503 `billing_unavailable` and writes no pack, entries or email.
- **Purchase attempt.** Before its first Kill Bill call, a purchase records an attempt in Postgres under the caller, endpoint and `Idempotency-Key`. The PURCHASE payment carries the external key `stationhouse-attempt-<attempt id>`.
- **Paid but not recorded.** If Kill Bill has taken the payment but the pack is not yet on file, the app keeps the payment and answers 503 `purchase_pending`. The browser handles that answer as stated in Interactions under "Buying a pack": the attempt stays open and the next press resends the same key and body. A retry with the same key and body finishes the purchase from the existing invoice and payment and answers 201 with the pack, without a second invoice or payment.
- **One purchase per key.** Each key yields at most one invoice, one PURCHASE payment, one pack, one purchase movement and one receipt.
- **Refund.** One REFUND transaction on the pack's PURCHASE payment for the prorated amount in dollars, with transaction external key `stationhouse-refund-<packId>`, so a retry never refunds twice. Only once Kill Bill has recorded it does the app write the refund movement and `refundedCents`.
- **Kill Bill unreachable.** Purchases that are not replays, and refunds, answer 503 `billing_unavailable` with no other effect. Everything else keeps working.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`):
- **Objects.**
  - Document files are private objects in the existing bucket `S3_BUCKET`, stored with the detected content type.
  - The key is `tenants/<tenantId>/documents/<documentId>.<ext>`, where `ext` is `pdf`, `png` or `jpg`.
  - The app never makes the bucket or an object public and never creates presigned URLs for the browser. The browser never talks to MinIO.
- **Stored as submitted.**
  - Each object is byte-identical to the uploaded `file` part: no decoding, re-encoding, trimming or normalising. `sizeBytes` is its exact length, and `sha256` is computed over exactly those bytes.
  - Each upload writes a new key, so no key is ever reused or overwritten, and no route deletes an object.
  - A superseded document keeps its object and opens byte-identical, for as long as the data exists.
- **Upload order.** An upload stores the object first and writes the document row only once the object is stored. If storage fails, the app writes no row and answers 503 `storage_unavailable`.
- **Serving files.** The file route reads the object on each authorised request and returns exactly its bytes, with:
  - `Content-Type`: the detected type
  - `Content-Length`: equal to `sizeBytes`
  - `Content-Disposition: inline; filename="<kind>-<documentId>.<ext>"`
  - `X-Content-Type-Options: nosniff`
  - `Content-Security-Policy: sandbox`
  - `Cache-Control: private, no-store`
- **Storage unreachable.** Uploads and file reads answer 503 `storage_unavailable`, and everything else keeps working. Each storage call connects fresh, so the next request after storage returns succeeds with no restart.

**Mail** (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`):
- **Queueing.** Every email is first written to the mail queue in Postgres, in the same step as the action that caused it, with that action's kind and record id. A refused or rolled-back action never has an email.
- **Delivery.**
  - Any running app process delivers pending queued emails: at start, at least every 30 seconds, and right after its own actions.
  - Each queued email is claimed in Postgres by one process at a time.
  - It is marked delivered, with the delivery time, only when the mail server answers the end of the message with a success reply. A delivered email is never sent again.
  - An email queued by a process that cannot reach mail is delivered by any process that can.
- **Delivery status.** One rule gives the status of every queued email, and it is the only source for document `notices`, booking `emails` and a pack's `receiptEmail`: `queued` with `sentAt` `null` until marked delivered, then `sent` with `sentAt` the delivery time. Nothing reads `sent` when an email has only been claimed, queued or attempted.
- **Unacknowledged sends.**
  - If the connection fails or an error reply arrives before the success reply, the email stays queued and is retried at least every 30 seconds.
  - Every copy of one queued email carries the same `Message-ID`, `<queue-<queued email id>@stationhouse.test>`.
- **Mail unreachable.** The action that caused an email still succeeds at once with its normal response and success copy. Its email stays queued, and its line reads Queued, until a process delivers it.
- **Addressing.**
  - `From` is the value of `MAIL_FROM` (`Stationhouse <frontdesk@stationhouse.test>` in development and grading), read from the environment.
  - `To` holds exactly one recipient: the tenant's contact name as an RFC 5322 display name, quoted, or RFC 2047-encoded when it has non-ASCII characters, followed by the tenant's email in angle brackets. A mail client parses exactly one recipient whose name equals the contact name character for character.
  - There is no Cc, no Bcc and no Reply-To other than the `MAIL_FROM` address. The SMTP envelope has that one recipient.
- **Content.** Bodies are plain text and carry only their own tenant's facts. They contain:
  - no URL or link
  - no object key, `tenants/` path, presigned parameter, storage endpoint or bucket name
  - no document id, and no id other than the booking reference and invoice lines below
  - no other tenant's name or email
  - no attachment

The app sends exactly these five kinds of email:

| Email | Sent | Subject | Body lines |
|---|---|---|---|
| Booking confirmed | on each confirmation | `Booking confirmed: <station> on <date>` | `Station: <station>`; `Shelf: <shelf>` (or `Shelf: none`); `Starts: <date> <start> <time zone>`; `Ends: <date> <end> <time zone>`; `Hours debited: <duration>`; `Pack balance: <balance>`; `Booking reference: <booking id>` |
| Booking moved | on each move | `Booking moved: <station> on <date>`, with the new station and date | the same seven lines for the booking after the move, then `Was: <date> <start>–<end> <stations>` for the booking before it |
| Pack receipt | on each paid pack | `Receipt: <hours>-hour pack` | `Hours added: <hours> h`; `Amount: $<amount>`; `Invoice: <Kill Bill invoice id>`; `Purchased: <date> <HH:MM> <time zone>` |
| Expiry notice, seven days | at each `seven_days` point | `Your <kind label> expires in 7 days` | `Expires: <date> at 23:59 <time zone>`; `Bookings after <date> will be refused until a renewed document is on file.` |
| Expiry notice, today | at each `today` point | `Your <kind label> expires today` | the same two lines as the seven-day notice |

`<kind label>` is "certificate of insurance" or "food-handler card".

### Seed data (DP-10, DP-34, DP-37, DP-53, DP-84)

Every person, business and email address below is invented. `<today>` is the kitchen-local date on which the app first writes the seed into an empty database. `<today+N>` and `<today−N>` are that many days later or earlier.

**Kitchen:** "Halfsheet Commissary", in the time zone from `KITCHEN_TIME_ZONE`.

**Stations**, in seed order. Every station's `cleanupMinutes` is 30.

| id | name | kind | col | row |
|---|---|---|---|---|
| `range-1` | Range 1 | range | 0 | 0 |
| `range-2` | Range 2 | range | 1 | 0 |
| `range-3` | Range 3 | range | 2 | 0 |
| `prep-a` | Prep Table A | prep_table | 0 | 1 |
| `prep-b` | Prep Table B | prep_table | 1 | 1 |
| `mixer-60` | Mixer 60 qt | mixer | 2 | 1 |
| `mixer-20` | Mixer 20 qt | mixer | 3 | 1 |
| `shelf-1` | Walk-in Shelf 1 | cooler_shelf | 0 | 2 |
| `shelf-2` | Walk-in Shelf 2 | cooler_shelf | 1 | 2 |
| `shelf-3` | Walk-in Shelf 3 | cooler_shelf | 2 | 2 |

**Pack catalogue:**

| Hours | Price |
|---|---|
| 10 | $260.00 |
| 20 | $480.00 |
| 40 | $880.00 |

**Staff:**
- Owner Imani Ferro: `owner@stationhouse.test`, password `owner-pass-2026`.
- Shift lead Theo Park: `lead@stationhouse.test`, password `lead-pass-2026`.

**Tenants.**
- Every tenant's password is `tenant-pass-2026`, and their display name is their contact name.
- Every seeded certificate of insurance has `perOccurrenceLimit` 1000000 and `additionalInsured` true.
- Every seeded document has `hasFile` false and `sha256` null, and shows "On paper".

| Business | Contact | Email | Status | Insurance expires | Food-handler card expires |
|---|---|---|---|---|---|
| Bright Fork Catering | Dana Okafor | `dana@brightfork.test` | approved | `<today+200>` | `<today+200>` |
| Tío Lalo's Tacos | Lalo Medina | `lalo@tiolalo.test` | approved | `<today+200>` | `<today+200>` |
| Crumb & Kettle Bakery | Pearl Asante | `pearl@crumbkettle.test` | approved | `<today+2>` | `<today+200>` |
| Saltbox Provisions | June Harrow | `june@saltbox.test` | approved | `<today>` | `<today+200>` |
| Night Market Dumplings | Wei Lindqvist | `wei@nightmarket.test` | suspended (insurance_lapsed) | `<today−1>` | `<today+200>` |
| Copper Pot Jams | Sam Whitlock | `sam@copperpot.test` | documents_pending | `<today+200>` | `<today+200>` |
| Fennel & Fig | Ari Castellanos | `ari@fennelfig.test` | applied | none | none |

The seed has no packs, bookings, door-log entries, ledger entries, sign-in attempts, counted claims, password confirmations, notice claims or queued emails.

For example, with the seed data at start:
- Saltbox's certificate of insurance reads "Expires today" and is due one `today` notice.
- Crumb & Kettle's certificate reads "Expires in 2 days" and gets no `seven_days` notice, because that date has passed.
- Night Market's certificate reads "Lapsed".
- Bright Fork's documents read "Valid".

## Technical requirements

### Deployment (DP-01)

The runtime is Node.js 22 LTS with npm. Server and browser code are TypeScript. The app root holds `/app/run.json` with the string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

`serve` starts one process that serves the browser app and the API on `0.0.0.0`. It uses port 4173, or the port in `APP_PUBLIC_PORT` when that is set. `GET /api/health` answers HTTP 200 with `{"status":"ok"}` once the server is listening and its schema is applied.

The verifier may run several `serve` processes at once against the same `DATABASE_URL`, each with its own port, service settings and kitchen time zone, and may restart any of them. It may also run processes against their own empty databases and buckets, including one whose kitchen zone has a half-hour offset. Every rule in this brief holds across all of them.

### Configuration and secrets (DP-08)

The server reads these at start. None is hard-coded or sent to the browser.

| Group | Variables |
|---|---|
| Postgres | `DATABASE_URL` |
| Kill Bill | `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` |
| Object storage | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| App | `APP_PUBLIC_PORT`, `KITCHEN_TIME_ZONE` (default `America/Chicago`), `HOLD_SECONDS` (default 90), `EXPIRY_SWEEP_SECONDS` (default 3600), `SIGNIN_WINDOW_SECONDS` (default 900), `REAUTH_SECONDS` (default 300) |

The verifier may set any of these, including another kitchen zone and shorter hold, sweep, sign-in window and password-confirmation times.

### Server boundary (DP-02, DP-16, DP-59, DP-71, DP-81, DP-91)

**Origin.**
- The app serves pages and API from one origin, and the browser requests nothing from any other origin, so fonts and icons are bundled.
- The app's own origin is formed from the app's scheme and the request's `Host` header.
- A `POST`, `PUT`, `PATCH` or `DELETE` gets 403 `{"error":"cross_origin","message":"This request came from another site."}` in either case:
  - `Origin` is present and is not the app's own origin, the literal `null` included
  - `Origin` is absent and `Sec-Fetch-Site` is present with any value other than `same-origin`, including `same-site`, `cross-site` and `none`
- `GET /api/door` and `GET /api/reports/daily` also get that 403 when `Origin` is present and is not the app's own origin, the literal `null` included.
- A request with neither header is judged on its other checks.
- This check runs before authentication. A refused request writes nothing: no session change, no counted sign-in attempt, no counted claim, no booking or pack change, no Kill Bill call and no queued email. Sign in, Apply, Sign out and password confirmation are covered.
- No response carries `Access-Control-Allow-Origin` or any other CORS permission header.

**Security headers.** Every response except the document file route (which keeps its own headers from Services) carries, errors and the app page included:
- `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: same-origin`
- `Cross-Origin-Opener-Policy: same-origin`

The app page contains no inline script, no inline style block and no style attribute in its markup, so the policy never blocks the app and the browser reports no policy violations while it runs, animations and drawings included.

**Sessions and state.**
- The `sh_session` cookie is HttpOnly and SameSite=Lax and holds only a random opaque token. Sessions live in Postgres, so every process accepts them, and signing out ends the session everywhere.
- Every response is computed from the session of that request alone. Nothing about the current user, tenant, pack or booking is kept in process-wide or module-wide memory across requests or awaits.
- None of the following lives only in one process's memory: bookings, holds, sessions, password confirmations, sign-in counts, claim counts, idempotency keys, purchase attempts, door-log entries, notice claims, queued emails and their delivery state.

**Caching.** Every `/api` response carries `Cache-Control: no-store`, errors included. The one exception is the file route, as stated in Services.

**Size limits.** JSON bodies may be at most 65,536 bytes, and upload requests at most 6,000,000 bytes; each limit itself is allowed. Larger requests get 413 `payload_too_large`. An unaccepted body type gets 415 `unsupported_media_type`.

**Published error messages.**

| Situation | Response |
|---|---|
| Storage down on an upload | `storage_unavailable` with the Upload storage-down copy |
| Storage down on a file read | `storage_unavailable` with the Open document storage-down copy |
| Billing down on a purchase | `billing_unavailable` with "Billing is unreachable. Nothing was charged." |
| Billing down on a refund | `billing_unavailable` with the Refund billing-down copy |
| Same key, different body | 409 `idempotency_conflict` with "This Idempotency-Key was already used with a different request." |
| Same key, first request still running | 409 `idempotency_in_progress` with "An earlier request with this Idempotency-Key is still running." |
| JSON or multipart body that cannot be parsed, including a broken multipart boundary | 400 `malformed_body` with "The request body could not be read." |
| Any unexpected failure | 500 `{"error":"internal_error","message":"Something went wrong on our side."}` |

**Nothing internal leaks.** No error body or response header contains, in any letter case:
- a service host, port or URL
- the bucket name, an object key or a `tenants/` path
- a credential
- a stack frame or source path
- driver or library text such as `ECONNREFUSED`, `ENOTFOUND`, `NoSuchKey`, `S3`, `AWS`, `killbill`, `postgres` or `SQL`

**What is served.**
- Only the built browser assets, the screen paths in Screens and layout (each answering with the app page) and the API.
- Every other path gets 404, including source files, source maps, `.env`, `run.json`, `package.json`, lockfiles and `node_modules`.
- No response contains a service credential.

**Dependencies at boot.** Kill Bill, object storage or mail being unreachable at start never stops the app from starting or the health check from answering 200. Each affected feature fails as stated in Services and recovers by itself once the service returns, without a restart.

### Browser support and performance (DP-04)

- The app works in current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, and at every width between.
- It works with any browser time zone and any browser clock setting, days off included.
- Touch input works on touch-capable devices.
- The Board is usable within three seconds of loading, with the floor plan drawn and the rail draggable.
- Station heights start moving within a tenth of a second of a span change.
- A claim's or move's result shows within two seconds of the drop.

## Working rules

- IF-01: `/app/run.json` exists and holds exactly the string fields `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `THIRD_PARTY_NOTICES.md` at the app root lists every shipped package and every bundled font and icon set with its licence, where shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (the production tree from `npm ls --omit=dev --all --json`) and every bundled asset is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or SIL OFL 1.1.
- IF-04: The app uses no datastore, cache or queue besides Postgres, Kill Bill and MinIO: no SQLite, no Redis, no in-process job queue and no local-disk document storage.
- IF-05: The provided service compose files and their seeded credentials are left unchanged.
- IF-06: All app source, server and browser alike, is TypeScript checked in strict mode.

## Engineering standards

- The code is idiomatic strict TypeScript with no `any` escapes and no disabled type checks.
- Names in code match the terms in this brief: station, shelf, slab, hold, reservation, booking minutes, booking, move, pack, ledger entry, movement, cleanup buffer, cooler strip, span status, cutoff, cancel credit, cover state, fingerprint, door list, door log, door actions, cleared, notice point, delivery status, sign-in attempt, password confirmation, claim limit, purchase attempt, upload draft, usage bar.
- Each domain rule is decided in exactly one place in the source and used by every caller:
  - each booking and pack state transition
  - the occupancy read shared by floor, cooler strip, claims and moves, with the overlap, the hold edge and booking minutes
  - the span status
  - the booking-shape rules and their sentences
  - the move's minutes change and `movable`
  - the cutoff and `cancelCreditMinutes`
  - the document cover rule shared by bookings, clearance, onboarding and `coverState`
  - the door actions, and the browser's focus landing after each door action
  - the pack choice, held and available minutes, and the pack lock shared by claims and refunds
  - the prorated refund amount
  - the sign-in limit, the password-confirmation freshness check and the claim limit
  - the cross-site rule and the security headers
  - the role table
  - the station metrics, extrusion rounding and usage bar heights
  - email addressing
  - the email delivery status shared by notices, booking emails and pack receipts
  - the browser's estimate of server time
  - the check on where sign-in may return to
  - the check that discards a late response
  - the rule for which async result is announced
- Every API error is built through one error shape; the precedence order is applied once, and the published body fields are checked once for every route.
- Shared state is read from and written to Postgres, never cached in process memory as a source of truth, and no request's data is kept in module scope.
- All browser requests pass through one path that tags each with the sign-in it was sent under, and every screen with a periodic refresh, Report and the receipt included, uses one refresh mechanism.
- There is no abstraction with a single implementation and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, no defensive check for states the rules make impossible, and no feature, endpoint, setting or screen beyond this brief.
