# Pilot Light Kitchen Commons Pilotlight

Pilotlight is a booking and compliance ledger for regional kitchen incubators. These are nonprofits and cooperatives that run a few licensed shared kitchens and rent ovens, mixers, blast chillers and prep tables by the hour to caterers, bakers and food-truck operators.

- **Members** claim station time on a radial "Burner Dial". They spend prepaid hour packs from an exact ledger in which each pack's hours expire on their own date, and they keep their insurance and certificates current.
- **Kitchen managers** run the site day: check-ins, no-shows, check-outs, cancellations on a member's behalf and the food-truck commissary visit log.
- **Network finance leads** set effective-dated rates and reconcile billing.
- **Health inspectors** open a read-only, time-limited link to one truck's visit log.

Build it as one TypeScript web app backed by four services:

- PostgreSQL, the system of record for everything the app owns, including sessions and the audit trail;
- Kill Bill, for pack purchases and overage invoices;
- S3-compatible object storage (MinIO), for compliance documents and visit-log PDFs;
- SMTP (Mailpit), for every email.

Several incubators share one deployment as separate tenants.

Out of scope:

- self sign-up and password reset (every account is seeded);
- recurring billing subscriptions;
- refundable deposits;
- card entry screens;
- SMS;
- currencies other than US dollars;
- an audit screen (the audit trail is read through its API only);
- any datastore beyond these four services.

## Problem and users

A regional incubator runs two to five licensed shared kitchens and rents equipment by the hour. Each member must keep three things current:

- a certificate of insurance with at least $1,000,000 of cover per occurrence that names the incubator as additional insured;
- a food-handler certificate;
- a business licence.

Most members buy prepaid hour packs whose hours lapse if they are not used in time. Late check-outs beyond the pack are billed hourly, and a late cancellation forfeits some or all of the booked hours. Health codes require food trucks to return to their commissary at least every 24 hours. The commissary and the truck both keep a signed visit log that inspectors ask to see.

Today managers juggle a generic calendar, a separate billing tool, a folder of PDF certificates and a clipboard log. The costs show up every week:

- Two members turn up for the only blast chiller, or one member's double-tap books it twice.
- A member's ten-minute hold runs out, but the window stays blocked for a few more seconds, so the next member is told it is taken.
- A member whose insurance lapses next Friday books a slot for the Saturday after.
- Hour balances drift away from invoices. Nobody can say which pack an hour came from, when it lapses, or who changed it. An invoice sits half-finished in billing and nobody notices it was never issued.
- A member phones in sick and the manager has no clean way to cancel for them on the right terms. The terms also change by the hour as the start gets closer, and the member may be cancelling the same booking at the same moment.
- A certificate scan gets altered on its way into the filing system, or a record says "uploaded" when storage never kept the file.
- A truck loses a trading day because nobody noticed it was overdue, or nobody could produce its log for an inspector. Sometimes the copy handed over exposes another member's details.
- The office tablet stays signed in all week, a shared password gets guessed, and nobody can tell afterwards who tried what.

Kitchen office tablets and members' phones often show the wrong time or time zone. Pilotlight trusts only its own server clock.

The four users:

- **Member maker** (weekly): claims station time against prepaid hour packs that expire, keeps insurance and certificates current, and sees an exact balance per pack.
- **Kitchen manager** (daily): runs one site's stations, sanitation buffers, member check-in and check-out, cancellations on a member's behalf and the commissary visit log, with no double-bookings, often entirely from the keyboard on the office tablet.
- **Network finance lead** (weekly): sets effective-dated rates across the incubator's sites, reconciles hour packs and overage invoices with billing, exports per-site reports and reviews who did what.
- **Health inspector** (occasional): opens a read-only, time-limited link to one truck's commissary visit log, often on a phone, and checks its daily returns.

## Journeys

1. **Claim the blast chiller.** Rosa Lindqvist is signed in on her phone and sees the Book screen for Copperline Eastside, with the date set to the site's next open date.
   - She flicks Next day twice and then picks "Blast chillers". The earlier date's slow answer lands last, but the screen shows only the chosen date's Blast Chiller dial.
   - She drags around the Blast Chiller dial from 05:00 with her finger, and the page does not scroll. Partway through the drag, the dials reload and another member's new booking appears. Rosa's arc keeps following her finger.
   - The arc grows in quarter-hour steps and stops short of another member's later booking. It leaves exactly enough room for the chiller's own sanitation buffer, and the centre counts her pack hours down as it grows.
   - She releases, and her finger bounces, releasing twice. The arc pulses with one hold countdown and one Held ticket.
   - She presses Confirm booking. While the request is out the ticket still reads Held. Then the arc turns solid green with a check and "Confirmed", the centre settles on her new balance, the ticket reads Confirmed on top of her spike, and a confirmation email arrives.
2. **Lose the last window, then win it at the expiry instant.** Rosa and Ade Okonjo claim the last open Blast Chiller window at the same moment, and Ade's claim wins. Rosa's arc snaps back to nothing, and the Booking status region tells her someone else took the window. Her pack hours show the same number as before she dragged. Ade never confirms. At the exact instant his hold runs out, Rosa claims the window again and gets it, Ade's ledger shows his hours returned by Pilotlight, and his late confirm is refused as expired.
3. **Cancel across the notice edge, and a cancel that lost.** Rosa opens a ticket for a booking that starts a little over three days from now and presses Cancel booking.
   - The dialog says every pack hour will be refunded.
   - She leaves the dialog open. As the notice slips under three days, the sentence changes in place to a refund plus a forfeit. The dialog stays open and her focus stays where it was.
   - She confirms. The ticket reads Cancelled. The hour ledger shows a cancellation refund line and a forfeit line, both by Rosa, and the refunded hours are back in the Packs line they came from.
   - A cancellation email states both amounts.
   - Later she opens Cancel booking on another ticket, not knowing Dana has just cancelled that booking for her. She confirms. The ticket keeps reading Confirmed while the request is out, then redraws as Cancelled with "Cancelled by Dana Okafor", her pack hours show the server's figure, and Booking status says the ticket now shows the current state.
4. **Weekly bake slot across the clock change.** Rosa sets an early Sunday window on the Deck Oven 1 dial for the weekend the clocks go back and opens Repeat weekly. The preview for the starting four weeks is already there when the dialog opens. As she presses the arrow keys on Number of weeks, the list of occurrences and the total update instantly: the week of the clock change costs one hour more than the others, even though her phone is set to Tokyo time. Two weeks too many, the total turns into a "Not enough pack hours" line and Book series stops responding. She steps back, books the series, and the dials reload behind the open dialog without disturbing it. One ticket appears per week, every one at the same site-local start and end.
5. **Top up, stay compliant, watch hours lapse.** Hana Sato's certificate of insurance has expired, so her claims are refused.
   - She buys the Production 30 pack. Her available pack hours rise, and Packs lists the new pack's hours with their valid-through date above her opening balance. A receipt email shows the same date, and the ledger shows a pack-purchase line.
   - She uploads a new certificate scan. Nothing appears in her documents table until the server answers; then it shows "Pending review".
   - Her kitchen manager, Luis Arrieta, opens the file, which is byte for byte the scan she sent, and verifies it. Hana's coverage list now shows the new valid-through date.
   - Her claims for dates up to that date succeed, and a claim for a later date is refused.
   - Rosa has Starter 10 hours that lapse tonight, and Packs marks that line with a flame. She opens Buy Production 30 and presses Pay, but her connection drops. She leaves the dialog open on her phone, whose clock is a day off, past her home site's midnight. Within a minute the Starter 10 line goes, her available hours drop, and a "Pack hours expired" line by Pilotlight tops her ledger, while her dialog, its message and her focus stay exactly where they were. She presses Pay again and is charged once.
6. **Run the site day by keyboard.** Dana Okafor opens Site day for Copperline Eastside, which starts on the site's current date. She works only with the keyboard.
   - She tabs from the rail to the first row and checks in Rosa; focus lands on Rosa's new Check out button. She tabs on and marks a member who never arrived as a no-show; focus lands on that row's status.
   - Ade phones to say his mixer order fell through. Dana moves to the date of his confirmed booking and starts cancelling it for him. While she types the reason, the board reloads itself and a booking another member made from home appears. Her dialog, her half-typed reason and her last status message all stay. The dialog's outcome sentence changes as the notice crosses an edge. She confirms. Ade's ticket then reads "Cancelled by Dana Okafor", and his email gives the reason.
   - Every Site day status message reads exactly as published, nothing on Site day shows a member's email address or balance, and the no-show member's ledger shows a Forfeit line by Dana Okafor.
7. **Late check-out, truck return and inspection.**
   - Dana checks Theo out after he overstays. The check-out dialog shows the lateness and stays open through a board reload. She presses Confirm check-out twice by accident. The row then shows the late hours, the pack hours applied, the overage total and "by Dana Okafor". Kill Bill holds exactly one committed invoice for that amount.
   - On Trucks she finds Mbeki Smoke Truck through member search. The Smoke Signal log shows the Overdue notice, because more than a day has passed since the truck last left. She records the truck's arrival, then its departure with services and Theo Mbeki's typed signature. The new visit tops the log, earlier gaps over 24 hours are flagged, and the Overdue notice disappears.
   - The next day she leaves the log open on the office tablet, whose clock is set to the wrong zone. Once a full day has passed on the server since that departure, the Overdue notice appears by itself, without a reload.
   - An inspector asks for the log, and Dana issues a link to the inspector's email. The inspector opens it on a phone and sees one labelled card per visit, the same overdue verdict and a full-width PDF button, and downloads the PDF. Neither the email, the page nor the PDF shows any email address, balance, booking reference or internal id. After Dana revokes the link, the page shows the revoked heading.
8. **Rates, reports and a careful sign-in.** Priya Raman mistypes her password on her phone; the answer does not say whether the email exists. She opens Menu to reach Rates, then moves to her desk.
   - She flicks the Site picker from Copperline Eastside to Copperline Highline. Eastside's slow answer arrives last, but the table and the Effective from field show Highline, and Effective from shows that site's next local date.
   - She schedules a new hourly rate starting next month and sees it marked Upcoming.
   - She opens Reports, chooses a month, narrows the report to one member picked from search, and downloads the CSV. Its numbers match the on-screen table, and nothing from another incubator appears. She presses Back twice quickly; the screen ends exactly on the month the address names.
   - She copies the address and opens it in a new signed-out window. After signing in she sees the same month, member and table.
   - Later the audit trail shows her failed sign-in, every write she made, and a refused attempt from someone else's stale tab.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Station availability** GET /api/sites/{site_id}/availability returns every station of the site for one site-local date with its booked, buffer, own and not-on-the-clock sectors, each buffer sized by the station's kind, as defined in API and Business rules.
- **DP-02 — Burner Dial drag claim** Dragging clockwise by pointer or touch from an open point on a station's dial draws a claim arc that snaps to the booking step and stops where its own sanitation buffer would meet the next occupied sector, at the end of the day or at the member's available pack hours, shows the start, end and pack hours after this claim in the centre, never scrolls the page while a touch claim is in progress, and creates a hold on release under a fresh idempotency key, as qualified in Interactions.
- **DP-03 — Keyboard dial control** Each dial's Start time and End time spinbuttons move the window by a quarter hour with arrow keys and by an hour with Shift and an arrow key, drive the same arc, and let the member hold, confirm and release a window without a pointer, as qualified in Interactions.
- **DP-04 — Server hold** POST /api/bookings with an Idempotency-Key creates a held booking that moves its hours from available to committed and carries a server-set expiry instant, and refuses a member's fourth live hold with 422 hold_limit, as defined in API and Business rules.
- **DP-05 — Next-day cutoff** The server refuses a booking for the site's current or an earlier date, or for the site's next date once the site's own clock reaches the cutoff in Business rules, whatever time zone the browser uses.
- **DP-06 — Claim-to-ticket journey** A member drags a window on a dial while the dials keep reloading, confirms the hold, and sees the arc turn to the confirmed state, the centre numeral settle to the server balance and a new ticket on top of the spike.
- **DP-07 — One winner per window** Of several simultaneous claims that overlap one station's window or its sanitation buffer exactly one succeeds and every other answers 409 slot_taken with no ledger movement, and one member's simultaneous claims on different stations are judged one after another against that member's balance and hold limit.
- **DP-08 — Hold expiry** A held booking that reaches its hold_expires_at unconfirmed is expired on the server, returns its hours to the lots it drew from in one hold_release by Pilotlight, frees its window, and refuses a later confirm with 409 hold_expired, as defined in Business rules.
- **DP-09 — Hold and rejection display** A held window shows a pulsing outline and a countdown measured to the server's hold expiry on the server clock, never the browser's, and a rejected or expired claim snaps the arc back to zero length while the Booking status region announces the reason copy from Feedback states.
- **DP-10 — Lost-race journey** When two members claim the same last blast-chiller window, the loser's arc snaps back, the conflict is announced, and the loser's displayed pack hours equal their balance before the drag.
- **DP-11 — Booking state machine** Booking status changes only along the legal transitions in Business rules, exactly one of several simultaneous transitions on one booking commits, and every other transition is refused with the 409 the state machine gives without changing the booking or the ledger.
- **DP-12 — Cancellation forfeit window** Cancelling a held booking returns its hours, and cancelling a confirmed booking, by its member or by a kitchen manager of its site, refunds all, splits or forfeits its quarter hours by elapsed notice as defined in Business rules, with the refunded and forfeited hours stated in the response.
- **DP-13 — Cancel journey** From a ticket the member opens the cancel dialog, sees the hours that will be refunded and forfeited before confirming, keeps the dialog open while that outcome changes in place as the notice crosses an edge, and once the server answers sees the ticket marked Cancelled and the balance updated, or, when the booking was already cancelled elsewhere, the ticket redrawn as cancelled by that person.
- **DP-14 — Weekly series** POST /api/recurring-series books every occurrence of a weekly slot as a confirmed booking in one all-or-nothing step, or books nothing and names the conflicting or uncovered dates.
- **DP-15 — Wall-clock anchoring** Every occurrence of a weekly series keeps the same site-local start and end times across daylight-saving changes, costs its elapsed hours, and follows the published rule for missing and repeated local times.
- **DP-16 — Weekly slot journey** From a dial the member opens Repeat weekly, chooses the number of weeks while the preview follows, books the series, and sees one ticket per occurrence in the spike.
- **DP-17 — Paired hour ledger** Every change to a member's pack hours is one ledger movement of two entries that cancel out, a partial cancellation is one refund movement and one forfeit movement whose hours add up to the booking, entries are never edited or deleted, and the reported balances always equal the sums of their entries.
- **DP-18 — Atomic pack purchase** Buying a pack records the Kill Bill purchase, the ledger credit and one receipt email together, and while billing is unreachable it answers 503 and records none of them.
- **DP-19 — Purchase replay safety** A repeated pack purchase with the same Idempotency-Key and body returns the original response without a second charge, and the same key with a different body answers 409 idempotency_conflict.
- **DP-20 — Buy-pack journey** A member opens a pack's dialog, pays, and sees the available pack hours rise, the new pack's line in the pack hours by expiry list and a pack-purchase line at the top of the hour ledger table, as qualified in Interactions.
- **DP-21 — Upload type and size limits** Compliance uploads are accepted only as PDF, PNG or JPEG files within the file size limit in Server boundary, and every other file, SVG included, is refused with the statuses in API.
- **DP-22 — Document and stored file together** A document record exists exactly when its stored object exists, no later upload or review removes or replaces an earlier document's object, and while storage is unreachable an upload answers 503 and leaves neither.
- **DP-23 — Own records only** A member can open only their own documents, document files, bookings and truck log, and another member's id answers 404 exactly as an unknown id does.
- **DP-24 — Document review** A kitchen manager verifies or rejects each pending document of members homed at their site, and verifying sets that member's valid-through date for the document's type as defined in Business rules.
- **DP-25 — Insurance valid-through edge** The server accepts holds, confirmations and series occurrences only while the member's certificate of insurance is valid now in the booking site's time zone and its valid-through date is on or after every booked date, and refuses the rest with certificate_expired whatever the client sends.
- **DP-26 — Expiry notices** Each member's document type with a valid-through date receives at most one 14-day notice and one 3-day notice email per valid-through date, judged on the member's home site's calendar as defined in Business rules.
- **DP-27 — Compliance journey** A member uploads a certificate of insurance and sees it waiting for review only once the server has answered, a kitchen manager opens and verifies it, and the member's coverage list then shows the new valid-through date.
- **DP-28 — Check-in window** A kitchen manager can check in a confirmed booking only inside the check-in window and while the member's certificate of insurance is valid, and otherwise gets 409 too_early, 409 too_late or 422 certificate_expired as defined in Business rules.
- **DP-29 — No-show marking** A kitchen manager can mark a confirmed booking as a no-show only from the time set in Business rules, which forfeits its committed hours in one ledger movement.
- **DP-30 — Manager site scope** A kitchen manager sees and acts on the bookings, documents, members and trucks of their own site only, and another site's ids answer 404.
- **DP-31 — Site day journey** A kitchen manager opens the site day board, checks in an arriving member, marks a missing one as a no-show while the board keeps reloading itself, and sees each row's status and actions change and the Site day status copy exactly as published in Feedback states.
- **DP-32 — Late check-out hours** At check-out, the whole minutes past the booked end at the commit instant are rounded to quarter hours as defined in Business rules, drawn from the member's available pack hours first in the lot order of DP-69, and any remainder becomes overage.
- **DP-33 — Overage amount** The overage subtotal, sales tax and total are computed once at check-out in whole cents with the rounding rule in Business rules, then stored and returned unchanged.
- **DP-34 — Overage billing record** A check-out whose overage total is above zero creates exactly one Kill Bill invoice on the member's account whose amount equals the overage total to the cent, committed as DP-79 requires, and while billing is unreachable a first check-out answers 503 and the booking stays checked in.
- **DP-35 — Late check-out journey** A kitchen manager checks out a late member through the check-out dialog and then sees the late hours, pack hours applied, overage total and their own name on that booking's row.
- **DP-36 — Truck visit recording** A kitchen manager records a truck's arrival and then its departure with the services performed and the operator's typed signature, with at most one open visit per truck.
- **DP-37 — Return gap flag** Each visit is flagged when its departure comes more than the return interval in Business rules after the previous departure, and every visits response states whether the truck is overdue, judged only on the server clock at the moment of that request.
- **DP-38 — Visit log journey** A kitchen manager finds an overdue truck through member search, records its arrival and departure, and sees the new visit at the top of the visit log with any gap flag and the Overdue notice gone.
- **DP-39 — Inspector link issue** Issuing an inspector link stores a PDF snapshot of the truck's log, emails the link to the inspector and returns a link that expires after the configured period, or answers 503 and does none of these while storage is unreachable.
- **DP-40 — Read-only scoped view** An inspector link exposes only the named truck's visit-log fields listed in API, never another member's data, and refuses every request other than GET with 405.
- **DP-41 — Revoke and reissue** Revoking a link stops it at once, reissuing replaces it with a new link and stops the old one, and revoked or expired links answer 410.
- **DP-42 — Inspector journey** An inspector opens the emailed link, sees the truck's visits with flagged gaps, downloads the PDF, and sees the expired or revoked heading exactly as published once the link is dead.
- **DP-43 — Effective-dated rates** A network finance lead schedules a site rate from a date after that site's own current date, rates are never edited, and a second rate for the same site and date answers 409 rate_exists.
- **DP-44 — Rate at booking start** A check-out's overage uses the rate whose effective date is the latest on or before the booking's site-local start date, even when a newer rate has taken effect since, and never a rate effective after that date.
- **DP-45 — Rate schedule journey** The finance lead picks a site, sees the Effective from field start on that site's next local date, schedules a new hourly rate and sales tax rate, and sees it in the rate schedule table marked Upcoming alongside the Current rate, with the table always showing the site picked last.
- **DP-46 — Utilisation report and export** The finance lead's monthly report and its CSV export give identical per-site hours and overage totals, counted by site-local month with pack expiry left out of forfeited hours, as defined in API.
- **DP-47 — Tenant-scoped search and totals** Member search, report totals, exports and the audit trail include only the signed-in user's incubator, so another incubator's members, hours, revenue and events never appear.
- **DP-48 — Tenant boundary on ids** Every route answers 404 to a caller whose role may use it for another incubator's site, station, pack, booking, document, member, truck, visit or inspector link id.
- **DP-49 — Reports journey** The finance lead chooses a month, optionally narrows the report to one member picked from search, reads the per-site table, and downloads the CSV.
- **DP-50 — Run manifest and health** The app installs, builds and serves from /app/run.json on the port set in Deployment, and GET /api/health answers as defined in Deployment.
- **DP-51 — Sign-in and sessions** Seeded users sign in with email and password, receive the session and CSRF cookies defined in Business rules, land on the address they opened when their role has that screen and otherwise on their role's home, see their role's navigation (behind a Menu button at phone widths), sign out, and are returned to the sign-in form at the same address when their session ends, as qualified in Interactions.
- **DP-52 — Error shape and precedence** Every error response except the health check's 503 uses the single error body, and every API error follows the single precedence order defined in API.
- **DP-53 — Server boundary** The server accepts writes only from its own origin, enforces the content-type and body-size limits, and never serves source files or credentials, as defined in Server boundary.
- **DP-54 — Notification emails** Each event in the email list in Services sends exactly one message with the stated recipient and subject from the configured sender, even when a request is replayed, two reissues race or several server processes share the database.
- **DP-55 — Responsive layout** Every screen follows its layout band from Screens and layout at 375x812, 768x1024 and 1280x800 with no horizontal scrolling and every control at least 44 px in both directions as measured in Visual design.
- **DP-56 — Dialog focus and Escape** Every dialog moves focus inside when it opens, keeps Tab and Shift+Tab within it, closes on Escape and returns focus to the control that opened it, except where Interactions names another target.
- **DP-57 — Motion and reduced motion** Each motion completes within the durations in Motion and effects, and with reduced motion requested arcs, numerals and tickets jump to their final values, the hold outline stays steady and the hold countdown shows whole minutes only.
- **DP-58 — Stainless ticket look** The screens use the stainless palette, condensed display type, hairline steel rules between station rows and order-ticket cards with a torn edge and mono numerals described in Visual design.
- **DP-59 — Burner Dial craft** Each dial reads as a 24-hour ring whose hatched, dotted, flame and green sectors, centre readout and hold outline are legible and distinct from one another on a still screenshot.
- **DP-60 — Provider wiring from environment** Source reads every service URL and credential from the environment variables in Configuration and secrets and makes real Kill Bill, S3 and SMTP calls rather than local stand-ins.
- **DP-61 — Attributed ledger movements** Every ledger movement and every check-in, no-show, check-out and cancellation records at write time the person who caused it, or the server for hold expiry, pack expiry and opening balances, that attribution never changes, and the hour ledger shows it.
- **DP-62 — Check-out replay safety** POST /api/bookings/{id}/check-out requires an Idempotency-Key, a replay returns the stored result without calling Kill Bill even while billing is unreachable, and each booking has at most one overage invoice, as defined in API and Business rules.
- **DP-63 — Only published fields are accepted** Every JSON and multipart request body accepts only the fields its endpoint lists for the caller's role, and any other field is refused with 422 validation naming it, with nothing stored.
- **DP-64 — Private data never reaches copies** Inspector link emails, visit-log PDFs and the inspector view carry only the published truck-log fields, never user emails, balances, booking references, internal ids or another truck's or member's data, and the inspector page requests only its own API paths, as defined in Business rules and Interactions.
- **DP-65 — Report URL is state** The report month and member filter live in the /reports address, so opening it directly or through sign-in, reloading it, or going Back and Forward restores the same fields, table and CSV link, as qualified in Interactions.
- **DP-66 — Hold replay safety** A repeated hold with the same Idempotency-Key and body returns the stored 201 before any rule or contention check, writes no booking or movement and never counts toward the hold limit, and the same key with a different body or while still in flight answers 409, as defined in Business rules.
- **DP-67 — Manager cancellation** A kitchen manager of the booking's site can cancel a confirmed booking on the member's behalf with a required reason, under the normal forfeit split judged on the notice when the cancellation commits and attributed to that manager, while a member sending a reason, a finance lead and another site's manager are refused as defined in API, and a booking already cancelled elsewhere answers 409 invalid_transition.
- **DP-68 — Pack hour lots and expiry** Each purchase's hours form a lot valid through its home-site local purchase date plus 60 days, available hours always equal the sum of lot remainders, each lot carries a server-decided expiring_soon flag, and expired hours leave in exactly one pack-expiry movement from the home site's midnight, as defined in Business rules.
- **DP-69 — Lot drawing and return order** Debits draw lots earliest valid-through first with the opening balance last, releases and refunds return hours to the lots the booking drew latest valid-through first, and each movement and the Packs list, refreshed as stated in Interactions, show the lot allocation.
- **DP-70 — Role-shaped projections** Every JSON response carries exactly its published keys at every depth, so actor objects, member search, booking lists and other members' dial sectors carry no identifying or private fields beyond their shapes, and no response other than GET /api/me and the POST /api/session success carries a user's email address.
- **DP-71 — Rate resolution by site-local start date** The overage rate is resolved when the check-out commits, from the rate schedule as it stands then, so a rate scheduled after the booking but effective on or before its start date applies, and rate dates and states are judged on each site's own local date.
- **DP-72 — Server-decided overdue notice** While Trucks with a truck loaded, Truck log or the inspector view stays open, its Overdue notice follows only the overdue field of that screen's own visits request, repeated on the schedule in Interactions and never derived from the browser clock or time zone.
- **DP-73 — Live cancellation outcome** An open Cancel booking dialog, the member's or the kitchen manager's, rewrites its refund and forfeit sentence in its Cancellation outcome status in place within the delay stated in Interactions when the notice crosses the 72-hour or 48-hour edge, writing it only when the outcome changes and keeping the dialog open, focus and the typed reason.
- **DP-74 — Dial state survives reloads** The dial's regular and post-action reloads replace sectors only and keep the claim arc, spinbutton values, an in-progress drag, an open dialog with its values, focus, the Booking status text and the hold countdown, except that a window the reload shows as blocked snaps back and announces the slot_taken copy, as qualified in Interactions.
- **DP-75 — Tickets and rows follow the server** No ticket, Site day row or displayed balance changes before the server answers an action on it, and a 409 invalid_transition or hold_expired answer re-requests that booking, and for a member the ledger, and redraws only that ticket or row from the server, as qualified in Interactions.
- **DP-76 — Server-decided pack expiry on Packs** While Packs stays open it re-requests the ledger once a minute and redraws its numerals, pack hours by expiry list and hour ledger table from the response, so an expired lot's line leaves within 61 seconds after the home site's midnight and never before, and each line's flame marker comes only from the lot's expiring_soon field, never from the browser clock.
- **DP-77 — Documents stored as submitted** Each document response carries the sha256 of the exact uploaded bytes, and its file download, ETag and stored object match the uploaded file byte for byte in every status, rejected included, as defined in API and Server boundary.
- **DP-78 — Site day state survives reloads** Site day reloads its bookings for the shown date every 30 seconds and after each action, bringing in bookings made elsewhere, while keeping an open Check out dialog with its idempotency key, an open Cancel booking dialog with its typed reason and caret, focus and the Site day status text, as qualified in Interactions.
- **DP-79 — Committed overage invoice** An overage invoice is recorded only once Kill Bill reports it COMMITTED with exactly one external charge item carrying the published description and amount, it is never left as a draft, and any invoice created before a Kill Bill failure is voided before the 503, as defined in Services.
- **DP-80 — Latest site wins on Rates** On Rates the rate schedule table and the Effective from field always show the site chosen last, and a late answer for an earlier site, whether a schedule load or a Schedule rate response, never redraws them, as qualified in Interactions.
- **DP-81 — Exact layout bands** Each screen uses the phone layout below 640 px wide, the tablet layout from 640 to 1023 px and the desktop layout from 1024 px, exactly at those edges, as defined in Screens and layout.
- **DP-82 — Collapsed navigation is unavailable** Below 640 px wide the Main navigation sits behind a header Menu button whose aria-expanded tracks it, and while collapsed its links are absent from the accessibility tree, unfocusable, unclickable and take no space, as qualified in Interactions.
- **DP-83 — Latest rail choice wins on Book** On Book each change of site, date or station type makes every earlier availability request stale, so only the latest rail subject's dials are ever drawn, the dials are busy and unclaimable while its request is pending, and an outstanding claim attempt still completes, as qualified in Interactions.
- **DP-84 — Hold expiry takes effect at its instant** A held booking is expired from exactly its millisecond hold_expires_at on every server process, so from that instant its window is free, it no longer counts toward the hold limit, confirm answers 409 hold_expired and its single hold_release is committed before any response depends on it, while one millisecond earlier it is still live and confirmable.
- **DP-85 — Live series preview** The Repeat weekly dialog lists every occurrence with its elapsed hours in the site's time zone and shows the series total and remaining pack hours, updated in place within 100 ms of every Number of weeks change without any request, as qualified in Interactions.
- **DP-86 — Buy dialog survives Packs refresh** An open Buy dialog keeps one idempotency key until it closes or succeeds, including across a 401 resumed through Sign in again, the once-a-minute ledger refresh never closes it, moves focus, re-enables its pending button or writes Pack status, and a ledger answer requested before the latest balance-carrying response never rolls the balances back, as qualified in Interactions.
- **DP-87 — Storage-confirmed documents** A document row is committed only after storage acknowledges its object and a HEAD confirms its length, content type and sha256 and document-id metadata, any mismatch or storage error deletes the object and answers 503, and the Documents screen shows no row until the server answers and keeps the chosen file after a 503, as defined in Services and Interactions.
- **DP-88 — Keyboard site day** A kitchen manager runs Site day entirely by keyboard, with the published Tab order, pending row buttons that stay focused and aria-disabled, and focus moving after each answer as qualified in Interactions.
- **DP-89 — Inspector view layout bands** The inspector view uses its published desktop, tablet and phone arrangement exactly at the 640 px and 1024 px edges, with labelled visit cards on phones, no horizontal scrolling and a Download PDF link at least 44 by 44 px, as defined in Screens and layout.
- **DP-90 — Latest report query wins** On Reports the Member listbox only ever shows matches for the current text and a report answer for anything but the latest load never redraws the table, Report status, Month, Member or Download CSV link, so quick Back and Forward steps end matching the final address, as qualified in Interactions.
- **DP-91 — Session rotation, expiry and revocation** Sign-in issues a fresh session value that replaces the one the request carried, sessions expire after the idle and absolute limits, sign-out destroys the session idempotently, a fourth live session destroys the oldest, and dead values answer 401 with the codes in Business rules.
- **DP-92 — Indistinguishable credentials and throttled sign-in** An unknown email and a wrong password answer identically, repeated failures per email or per client address answer 429 too_many_attempts with Retry-After even for the correct password, and passwords are stored only as salted argon2id or bcrypt cost ≥10 hashes, as defined in Business rules.
- **DP-93 — Double-submit CSRF token** Every state-changing request from a signed-in session must carry an X-CSRF-Token header equal to that session's pl_csrf cookie or it answers 403 csrf_failed and changes nothing, judged after the origin and session checks and before the role check, as defined in Server boundary.
- **DP-94 — Inert stored text and security headers** Stored reasons, signatures, inspector emails and file names render as literal text everywhere, every response carries the published security headers, and every HTML page carries the published content security policy and no inline script, as defined in Server boundary.
- **DP-95 — Injection-safe ids, queries and search** Ids not in the published shape answer 404, malformed fields answer 422 naming them, injection payloads in any id, query or body field are treated as plain text with no 500 and no change, and member search matches percent, underscore and backslash characters literally, as defined in API.
- **DP-96 — Verified upload content** A file part is accepted only when its declared type is PDF, PNG or JPEG and its leading bytes match that declared type, and it is stored under a server-chosen key that never uses the submitted file name, as defined in Server boundary.
- **DP-97 — Append-only audit trail** Every write request to the API appends exactly one audit event with its actor and outcome, refusals included, which kitchen managers and finance leads read through GET /api/audit within their scope and which is never edited or deleted, as defined in API and Business rules.
- **DP-98 — Secrets stay server-side** No response, asset, error or audit event contains a configured secret, unexpected failures answer the exact opaque 500 body, and every endpoint enforces its roles on the server whatever the navigation shows, as defined in API and Server boundary.

## Frontend

### Screens and layout (DP-06, DP-10, DP-13, DP-16, DP-20, DP-27, DP-31, DP-35, DP-38, DP-42, DP-45, DP-49, DP-51, DP-55, DP-65, DP-69, DP-72, DP-74, DP-76, DP-78, DP-81, DP-82, DP-83, DP-85, DP-89)

Pilotlight is a single-page app. Every screen shows times and dates in the relevant site's time zone, never the browser's.

On every signed-in screen, a header carries the product name, a `navigation "Main"` whose links depend on the role, and a Sign out button. At phone widths the navigation sits behind a Menu button (Interactions). The signed-out sign-in form and the inspector view show only the product name in their header, with no navigation and no Menu button.

Screens by route:

- `/`: sign-in when signed out. Once signed in, members go to `/book`, kitchen managers to `/site`, and finance leads to `/rates`.
- `/book` (member): the Book screen.
  - A sticky station-and-date rail spans the top: site picker, previous and next day buttons, a date field, station-type filter and a "Site time" readout.
  - The date field starts on the site's next open date. That is the site's next date when its clock is before the cutoff, otherwise the date after.
  - Below the rail sits a stacked list of Burner Dials, one per station of the chosen type, separated by hairline rules.
  - Beside or below the dials sits the ticket spike: the member's tickets, newest on top.
- `/packs` (member): available and committed pack hours as large mono numerals, the pack hours by expiry list (one line per lot in drawing order), one card per pack with a buy button, and the hour ledger table, newest first.
- `/documents` (member): the coverage list (one line per document type with its valid-through date), the upload form, and the member's documents table.
- `/truck` (member with a truck): the truck's visit log, read-only, with the Overdue notice when the server says the truck is overdue.
- `/site` (kitchen manager): the same sticky rail without the station filter, showing the manager's site name as text instead of the site picker, above the bookings table for the chosen date with per-row actions.
  - The date field starts on the site's current local date: its `local_date` from `GET /api/sites`, never the browser's date. It starts there on every visit to `/site`, including after sign-in.
- `/compliance` (kitchen manager): documents awaiting review from members homed at the site.
- `/trucks` (kitchen manager): member search, the chosen truck's arrival and departure actions, its Overdue notice, its visit log, and its inspector access panel.
- `/rates` (finance lead): site picker, the rate schedule table and the schedule-rate form.
- `/reports` (finance lead): month field, member filter, the utilisation table and the CSV download. Its state comes from the address as described in Interactions.
- `/inspect/<token>` (no sign-in): the inspector view, with:
  - the heading block: the truck's heading, the "Commissary: …" line and the "Operator: …" line;
  - the Overdue notice when the server says the truck is overdue;
  - the Download PDF link;
  - the commissary visits table.

  A dead or unknown link shows only its notice heading.

**Layout bands.** The layout depends only on the viewport width, and the bands are exact:

| Band | Width | Published viewport |
|---|---|---|
| Phone | below 640 px | 375x812 |
| Tablet | 640 px to 1023 px, both included | 768x1024 |
| Desktop | 1024 px and wider | 1280x800 |

So 639 px gets the phone layout, 640 px and 1023 px get the tablet layout, and 1024 px gets the desktop layout. No other width changes which layout applies. Every screen fits every width in every band with no horizontal scrolling.

- **Desktop**: a rigid 12-column grid.
  - The header shows the navigation links inline, with no Menu button.
  - On `/book` the dial list takes the left eight columns and the spike the right four, beside it. The spike stays in view as the dials scroll. This is the only band where the spike sits to the right of the dials.
  - Each dial row shows the dial on the left, with its station name, kind, legend and time inputs beside it.
  - On `/packs` the numerals and the pack hours by expiry list take the left eight columns, and the pack cards stack one per row in the right four, above the full-width ledger table.
  - Tables take the full content width and keep their rows laid out as table rows.
  - Forms on `/documents` and `/rates` take the right four columns, next to an eight-column table.
  - On `/inspect/<token>` the heading block takes the left eight columns. The Overdue notice and Download PDF take the right four, with the top of that column level with the top of the heading. The visits table spans the full width below both, as table rows.
- **Tablet**:
  - The header shows the navigation links inline, with no Menu button.
  - The rail wraps to two rows.
  - Dials stack one per row at full width, with the time inputs below each dial.
  - The spike moves below the dial list as a two-column grid of tickets.
  - Pack cards sit two to a row below the expiry list. This is the only band with two pack cards to a row.
  - Tables keep every column as table rows, and long text wraps.
  - Forms sit below their table at full width.
  - On `/inspect/<token>` the heading block, then the Overdue notice, then Download PDF stack in one column above the visits table, which keeps its table rows.
- **Phone**:
  - The header shows the product name, `button "Menu"` and Sign out. The navigation is collapsed until Menu opens it (Interactions).
  - The rail shows the site picker (on `/site`, the site name) and date controls on its first row, with the station-type radios wrapping beneath.
  - Each dial fills at least three quarters of the screen width, with its time inputs and buttons stacked below.
  - The spike follows the dials as a single column.
  - Pack cards and expiry lines stack in one column.
  - Tables reflow so each row becomes a stacked card that labels every value with its column name. This is the only band where table rows become cards: no row keeps the table-row layout.
  - On `/inspect/<token>` the heading block, Overdue notice and Download PDF stack as on tablet, Download PDF spans the full content width, and each visit is a card labelling Arrived, Departed, Services, Operator signature, Manager and Gap, each followed by its value.

In every band, every table keeps its table, row, column header and cell roles in the accessibility tree, even where its rows are drawn as cards, so `table "<name>"` is found at every width.

The Sign in again dialog (Interactions) sits centred over the Cancel booking, Check out or Buy dialog it interrupts. That dialog stays in place beneath it, dimmed and inert, with its typed values (such as the Reason) still readable. At phone widths both dialogs span the content width.

### Public screens and controls (DP-02, DP-03, DP-09, DP-13, DP-16, DP-20, DP-27, DP-31, DP-35, DP-38, DP-42, DP-45, DP-49, DP-51, DP-56, DP-61, DP-65, DP-67, DP-69, DP-72, DP-73, DP-74, DP-75, DP-76, DP-78, DP-80, DP-82, DP-83, DP-85, DP-86, DP-87, DP-88, DP-90)

Only the controls and regions below are public. Placeholders such as `<station>` follow the formats in Feedback states.

| Screen | Role and accessible name | Visible copy and notes |
|---|---|---|
| Sign-in | `textbox "Email"` | label "Email" |
| Sign-in | password field labelled "Password" | label "Password" |
| Sign-in | `button "Sign in"` | "Sign in" |
| Sign-in | `status "Sign-in status"` | sign-in and session feedback |
| Header | `navigation "Main"` | Member links: "Book", "Packs", "Documents", plus "Truck log" for members with a truck. Manager links: "Site day", "Compliance", "Trucks". Finance links: "Rates", "Reports". Each role's links appear in the order listed here, and the navigation holds no other link. The product name sits outside it |
| Header (phone band only) | `button "Menu"` | "Menu" with a menu icon; carries `aria-expanded` "false" while the navigation is collapsed and "true" while it is open. Absent at tablet and desktop widths |
| Header | `button "Sign out"` | "Sign out" |
| Any screen with an open Cancel booking, Check out or Buy dialog | `dialog "Sign in again"` | Opens only as described in Interactions. Holds the text "Signed in as `<email>`", a password field labelled "Password", `button "Sign in and continue"` and `button "Sign out"` in that order, and its own `status "Sign-in status"` |
| Rail (`/book`) | `combobox "Site"` | site names in the tenant |
| Rail (`/site`) | text "Site: `<site name>`" | not a control |
| Rail | `button "Previous day"`, `button "Next day"` | chevron icons with these names |
| Rail | date field labelled "Date" | site-local date |
| Rail (`/book`) | `radiogroup "Station type"` with `radio` "All", "Ovens", "Mixers", "Blast chillers", "Prep tables" | filters the dial list |
| Rail | text "Site time `<HH:MM>`" | the site clock (Refresh rules) |
| Book | `group "<station> dial"` | one per station, for example `group "Blast Chiller dial"`. Carries `aria-busy` "true" exactly while the newest availability request is pending (Interactions), "false" otherwise |
| Book, inside a dial | one `img` per sector in the availability response, named by its sector kind | `booked` → "Booked `<start>` to `<end>`"; `buffer` → "Sanitation `<start>` to `<end>`"; `own_held` → "Your hold `<start>` to `<end>`"; `own_confirmed` → "Your booking `<start>` to `<end>`"; `nonexistent` → "Not on the clock `<start>` to `<end>`". No sector shows a business name, member name or reference |
| Book, inside a dial | exactly one claim arc `img` "Claim `<start>` to `<end>`" | It always follows the Start time and End time spinbuttons. At zero length its start equals its end |
| Book, inside a dial | `data-start-deg` and `data-end-deg` attributes on every sector element and on the claim arc | They hold the angles under the dial geometry in Business rules. Once a hold is accepted, the held window is the "Your hold …" sector; once it is confirmed, it is the "Your booking …" sector. These names come from the sector kinds, so they survive every reload |
| Book, dial centre | text "`<start>`–`<end>`" above "Pack hours after this claim `<hours>`"; when idle, "Drag to claim" above "Pack hours `<hours>`" | the numeral element carries `data-pack-hours` with the same number |
| Book, inside a dial | `spinbutton "Start time"`, `spinbutton "End time"` | value text `<HH:MM>` in site time, for example `12:00` and `13:00` |
| Book, inside a dial | `button "Hold window"`, `button "Repeat weekly"` | Always present and always Tab stops. While the claim window has zero length each carries `aria-disabled` "true" and ignores presses; while the window has length each carries `aria-disabled` "false". Neither ever uses the disabled attribute |
| Book, inside a dial | `button "Confirm booking"`, `button "Release hold"` | shown while the member holds a window on this dial |
| Book, dial centre while held | "Held · `<m:ss>` left" (reduced motion: "Held · `<m>` min left") | countdown to the server's hold expiry |
| Book, dial centre after confirm | check glyph and text "Confirmed" above "Pack hours `<hours>`" | `<hours>` is the balance the server returned, and the numeral element carries `data-pack-hours` with the same number. The centre keeps this state through every reload until the member starts another claim on that dial or the rail subject changes |
| Book | `list "Tickets"` of `listitem` tickets | Each shows the reference, station, site, date, start–end, hours "`<hours>` h" and a status word: "Held", "Confirmed", "Checked in", "Checked out", "No-show", "Cancelled" or "Expired". A cancelled ticket whose `cancelled_by` is someone other than the member also shows "Cancelled by `<canceller name>`" under the status word. Each ticket can receive focus. The status word changes only from a server answer (Interactions) |
| Book, ticket | `button "Cancel booking"` | on held and confirmed tickets only |
| Book | `dialog "Cancel booking <reference>"` | Holds `status "Cancellation outcome"` with the refund or forfeit sentence, kept current while open (Interactions). Contains `button "Confirm cancellation"` and `button "Keep booking"`, in that order |
| Book | `dialog "Repeat weekly"` | "Every `<weekday>` `<start>`–`<end>`"; `spinbutton "Number of weeks"` (2 to 12, starts at 4); `list "Occurrences"`; `status "Series total"`; `button "Book series"`, `button "Close"`. A refused series lists its dates inside the dialog |
| Book, Repeat weekly | `list "Occurrences"` of `listitem` | one item per week in date order: "`<date>` `<start>`–`<end>` · `<hours>` h" |
| Book, Repeat weekly | `status "Series total"` | "Uses `<hours>` pack hours" above "Pack hours after this series `<hours>`", or "Uses `<hours>` pack hours" above "Not enough pack hours for `<n>` weeks." (Interactions) |
| Book | `status "Booking status"` | booking feedback |
| Packs | text "Available pack hours `<hours>`", "Committed pack hours `<hours>`" | mono numerals |
| Packs | `list "Pack hours by expiry"` of `listitem` lines | One line per lot in `balances.lots` order: "`<pack name>`: `<hours>` h, valid through `<date>`", or "Opening balance: `<hours>` h, no expiry". A line whose lot has `expiring_soon` true in the latest drawn response carries a flame marker beside the text, with the accessible name "Expiring soon"; no other line carries it. The text itself stays in ink |
| Packs | `button "Buy <pack name>"` | one per pack, with hours and "$`<price>`" |
| Packs | `dialog "Buy <pack name>"` | `button "Pay and add hours"`, `button "Close"`, in that order |
| Packs | `table "Hour ledger"` | Columns: When, Movement, Booking, By, Available, Committed. Movement labels are in Business rules. By shows the actor's name, or "Pilotlight" when the server made the change |
| Packs | `status "Pack status"` | purchase feedback |
| Documents | `list "Coverage"` | one item per type: "`<type label>`: valid through `<date>`", "`<type label>`: expired `<date>`" or "`<type label>`: none on file" |
| Documents | `combobox "Document type"` | "Certificate of insurance", "Food handler certificate", "Business licence" |
| Documents | date field labelled "Expiry date" | |
| Documents | `textbox "Coverage per occurrence (USD)"` and `checkbox "Names <tenant legal name> as additional insured"` | shown only for a certificate of insurance |
| Documents | file field labelled "File" | hint "PDF, PNG or JPEG, up to 5,000,000 bytes" |
| Documents | `button "Upload document"` | |
| Documents | `table "Your documents"` | Columns: Type, Expiry (the document's expiry date as `<date>`), Status ("Pending review", "Verified", "Rejected: `<reason>`"), and File with `link "Open"`. Every row, rejected ones included, has its Open link. Rows come only from server responses |
| Documents | `status "Document status"` | upload feedback |
| Truck log, Trucks | `table "Visit log"` | Columns: Arrived, Departed, Services, Operator signature, Manager, Gap. The Gap cell reads "Gap `<gap hours>` h — over 24 hours" on a flagged row, "`<gap hours>` h" on an unflagged row with a gap, and "—" when `gap_hours` is null |
| Truck log, Trucks, Inspect | text "Overdue: last return `<date>` `<HH:MM>`" | Shown exactly while the latest visits response on that screen has `overdue` true (Interactions) |
| Site day | `table "Bookings"` | Columns: Time, Station, Member (the business name only), Status (the same status word as a Book ticket), Actions. Rows follow the order of the bookings response (API). Every `confirmed` row shows `button "Check in"`, `button "Mark no-show"` and `button "Cancel booking"`, in that order, whatever the time. Every `checked_in` row shows `button "Check out"`. Rows in any other status show no buttons. Only the server judges the check-in and no-show time windows, when a button is pressed. Each Status cell can receive focus from script only and is not a Tab stop |
| Site day | `dialog "Cancel booking <reference>"` | `status "Cancellation outcome"` with the same outcome sentence as the member's dialog, kept current the same way; `textbox "Reason"`; `button "Confirm cancellation"`, `button "Keep booking"`, in that order |
| Site day | `dialog "Check out <business>"` | "Booked until `<end>`. Late by `<minutes>` min."; `button "Confirm check-out"`, `button "Keep checked in"`, in that order |
| Site day | row result text on each `checked_out` row | "Late `<late hours>` h · `<pack hours applied>` pack h · Overage $`<total>` · by `<manager name>`", or "On time · by `<manager name>`" |
| Site day | `status "Site day status"` | site day feedback |
| Compliance | `table "Documents awaiting review"` | Columns: Member (the business name only), Type, Expiry (the document's expiry date as `<date>`), Uploaded, Actions. Each row has `link "Open file"`, `button "Verify"` and `button "Reject"` |
| Compliance | `dialog "Reject document"` | `textbox "Reason"`, `button "Reject document"`, `button "Close"` |
| Compliance | `status "Compliance status"` | review feedback |
| Trucks | `combobox "Find a member"` | autocomplete by business or contact name |
| Trucks | `button "Truck arrived"`, `button "Truck departed"` | whichever is legal is enabled |
| Trucks | `dialog "Record departure"` | `group "Services"` of checkboxes "Potable water", "Grey water", "Grease", "Food storage", "Cleaning", "Restock"; `textbox "Operator signature"`; `button "Save departure"`, `button "Close"` |
| Trucks | `textbox "Inspector email"`, `button "Issue inspector link"` | |
| Trucks | `list "Inspector links"` | Each item shows the inspector email, the expiry in site time, and the state "Live", "Expired" or "Revoked". Live items have `button "Revoke"` and `button "Reissue"` |
| Trucks | `status "Visit log status"` | visit and link feedback |
| Rates | `combobox "Site"` | |
| Rates | `table "Rate schedule"` | Columns: Effective from, Hourly rate, Sales tax, State ("Current", "Upcoming", "Past"). Always the schedule of the site chosen last (Interactions) |
| Rates | date field labelled "Effective from", `textbox "Hourly rate (USD)"`, `textbox "Sales tax (%)"`, `button "Schedule rate"` | Effective from starts as described in Interactions |
| Rates | `status "Rates status"` | rate feedback |
| Reports | `textbox "Month"` | format YYYY-MM |
| Reports | `combobox "Member"` with its `listbox` | optional autocomplete filter; shows the chosen member's business name |
| Reports | `button "Show report"` | |
| Reports | `table "Utilisation by site"` | columns Site, Scheduled hours, Used hours, Forfeited hours, Overage, plus a Total row |
| Reports | `link "Download CSV"` | its address is the CSV for the shown month and filter (Interactions) |
| Reports | `status "Report status"` | report feedback |
| Every form | field error element | Placed directly after its field, holding the published field copy, linked as described in Field errors (Feedback states) |
| Inspect | `heading "<truck name> commissary visits"` | followed by "Commissary: `<site name>`, `<address>`" and "Operator: `<business>`" |
| Inspect | `table "Commissary visits"` | same columns and Gap cell text as "Visit log"; cards on phones (Screens and layout) |
| Inspect | `link "Download PDF"` | at least 44 by 44 px in every band |
| Inspect | `heading "This link has expired"`, `heading "This link was revoked"`, `heading "Link not found"` | dead-link notices |

### Interactions (DP-02, DP-03, DP-06, DP-09, DP-10, DP-13, DP-16, DP-20, DP-31, DP-35, DP-38, DP-45, DP-51, DP-56, DP-62, DP-64, DP-65, DP-66, DP-67, DP-69, DP-71, DP-72, DP-73, DP-74, DP-75, DP-76, DP-78, DP-80, DP-82, DP-83, DP-85, DP-86, DP-87, DP-88, DP-90, DP-91, DP-93)

**Sign-in and deep links.**

- When signed out, any app route other than `/inspect/<token>` shows the sign-in form without changing the address.
- After a successful sign-in, the user stays on the address they opened, query included, when their role has that screen. Otherwise they go to their role's home.
- Sign out returns to `/` and shows the sign-in form.
- When any API request made by a signed-in screen answers `401` (`unauthenticated`, `session_invalid` or `session_expired`) while no Cancel booking, Check out or Buy dialog is open, the page shows the sign-in form at the same address, with the session-ended copy from Feedback states in Sign-in status and focus on Email. Signing in again returns to that address.
- When such a `401` arrives while a Cancel booking, Check out or Buy dialog is open, Expired session during a dialog below applies instead.
- Every POST, PUT, PATCH and DELETE the app sends while signed in carries the `X-CSRF-Token` header with the current value of the `pl_csrf` cookie at the moment it is sent (Server boundary).

**Expired session during a dialog.** When any request answers `401` while a Cancel booking dialog (the member's or the kitchen manager's), a Check out dialog or a Buy dialog is open, whether that request is the dialog's own Confirm cancellation, Confirm check-out or Pay and add hours, a dial or board reload, the Packs refresh or any other request, the page stays at its address and:

- opens `dialog "Sign in again"` over the open dialog, which stays open, unchanged and inert beneath it, with its typed values still visible;
- shows "Signed in as `<email>`", where `<email>` is the address from the last `/api/me`;
- writes the session-ended copy into that dialog's Sign-in status;
- moves focus to Password.

However many `401` answers arrive together, or arrive while Sign in again is already open, exactly one Sign in again dialog opens, and each press of Sign in and continue sends exactly one `POST /api/session`.

While Sign in again is open:

- every periodic reload on the screen pauses: dials, Site day board, Packs ledger and visits;
- an underlying Cancel booking dialog keeps recalculating its outcome from the server-now estimate, and its Cancellation outcome region still changes at a notice edge;
- an underlying Check out dialog's lateness line keeps updating each minute.

Sign in and continue sends `POST /api/session` with that email and the typed password, and follows the Pending buttons rule.

- `invalid_credentials`, `too_many_attempts` and validation answers show their copy in that dialog's Sign-in status and keep it open.
- Success closes Sign in again and returns focus to the control in the underlying dialog that had it, with every typed value, its caret and its selection unchanged. The periodic reloads resume.
  - If the `401` answered Confirm cancellation, Confirm check-out or Pay and add hours, the page then resends that request exactly once, with the same body (the same Reason for a manager's cancellation), the same `Idempotency-Key` for a check-out or purchase, and the new `pl_csrf` value in `X-CSRF-Token`. Its answer is handled like any answer to that action, and the server judges it afresh at its own commit (Business rules).
  - If the `401` answered any other request, nothing is resent.

Sign out and Escape both close Sign in again and discard the pending action and its idempotency key. They destroy the session as `DELETE /api/session` does and show the normal sign-in form at the same address with the session-ended copy in Sign-in status and focus on Email. This is the one named exception to Escape returning focus to the opener.

Tab and Shift+Tab cycle inside Sign in again while it is open.

**Main navigation at phone widths.**

- In the phone band the header shows `button "Menu"` with `aria-expanded` "false", and the navigation is collapsed. Collapsed means hidden entirely: none of its links is in the accessibility tree, none can take focus by Tab or by script, none can be clicked or tapped, and the collapsed navigation takes no space on the page. Moving it off-screen or making it transparent is not collapsing it.
- Pressing Menu sets `aria-expanded` to "true", shows the navigation as a panel directly below the header over the page content, and moves focus to its first link.
- Escape, while focus is in the open navigation or on Menu, collapses it and returns focus to Menu. Pressing Menu again also collapses it.
- Choosing a link navigates to its screen and collapses the navigation.
- Widening the window into the tablet or desktop band shows the links inline and removes Menu. Narrowing back into the phone band starts collapsed.

**Server clock in the browser.** The device's clock and time zone may be wrong, so the browser never uses them to decide anything.

- Every API response carries the server clock in its `Date` header (API).
- The page keeps the offset between the latest such header and the browser clock at the moment that response arrived. Its *server-now estimate* is the browser clock plus that offset.
- Only three things use the estimate:
  - the hold countdown;
  - an open Cancel booking dialog's outcome sentence;
  - the check-out dialog's lateness.
- Wall times shown always use the site's time zone, from `GET /api/sites`.
- The Overdue notice and the pack-line flame markers never use the estimate. They come only from server fields (Refresh rules).

**Pending buttons.** While an action's request is pending, the button that started it carries `aria-disabled` "true", keeps focus and ignores presses. It never uses the disabled attribute, which would drop focus. When the answer arrives it becomes active again, unless the answer removes it. Hold window and Confirm check-out are the only exceptions: each stays pressable while pending and follows its own resend rule below.

**Rail and its subject (Book).** On `/book` the chosen site, date and station type together are the rail's *subject*.

- Previous day and Next day move the date by one site-local day. The Site time readout and the default date come from the site clock the server reports.
- Each change of subject (Previous day, Next day, the Date field, the Site picker or a Station type radio) sends a new availability request for the new subject at once. That request makes every earlier availability request stale, including a regular 15-second reload or a post-action reload sent for an earlier subject.
- A stale answer is never drawn, even when it lands after the newest one: it draws no sectors, no `data-start-deg` or `data-end-deg`, no dial list and no centre readout, and it never writes to Booking status.
- While the newest request is pending, the dial list keeps showing the previous subject's dials, each `group "<station> dial"` carries `aria-busy` "true", and no claim can start: presses on a ring, spinbutton keys, Hold window and Repeat weekly do nothing.
- When the newest answer arrives, every shown dial's claim arc and spinbuttons reset to the new date's earliest open step at zero length, and every centre returns to its idle readout.
- A subject change never cancels an outstanding claim attempt. That attempt's answer still updates the spike and Booking status. Its held sector is drawn only when its date and station are on the shown subject.

**Occupied sectors.**

- On a dial, every sector of kind `booked`, `buffer`, `own_held`, `own_confirmed` and `nonexistent` is occupied. Not-on-the-clock time is occupied exactly like a booking.
- A quarter-hour step is open when a zero-length window starting there has a footprint that is not blocked (Claim footprint below).
- A window overlaps an occupied sector when the two share any stretch of time. A window that only touches a sector's start or end does not overlap it.

**Claim footprint.** A claim needs room for its own sanitation buffer, because the server adds that buffer to the new booking's span (Business rules). The station's buffer is the length Business rules gives for its kind, the same length as that station's `buffer` sectors in the availability response.

- A window's footprint is the window itself plus the station's buffer straight after its End. At zero length, the footprint is the quarter-hour step that begins at Start, plus the buffer after that step.
- A footprint is blocked when either of these is true:
  - its window part overlaps any occupied sector;
  - its buffer part overlaps a `booked`, `buffer`, `own_held` or `own_confirmed` sector.

  Not-on-the-clock time does not block the buffer part.
- The dial checks only the shown date. A buffer that would run past 24:00 into a booking on the next date is refused by the server, and the `slot_taken` copy is announced.
- For example, on the Blast Chiller with another member's booking at 08:00–09:00, a window before that booking can end at 07:15 at the latest.

**Dragging a claim (pointer and touch).**

- A press on an open step starts a claim. A press anywhere else does nothing.
- The start snaps to the nearest booking step. Dragging clockwise grows a flame-coloured arc whose end also snaps to the nearest step.
- The arc never grows past any of these:
  - the last End whose footprint is not blocked;
  - 24:00;
  - the point where pack hours after this claim would fall below zero.

  So it stops one station buffer before the next booking or hold, and right at the start of the next not-on-the-clock sector.
- Dragging back toward the start shortens the arc, down to zero length.
- While dragging, the centre shows the start and end times and counts "Pack hours after this claim" down by 0.25 for each quarter hour added. On a clock-change day it counts elapsed hours (Business rules).
- The Start time and End time spinbuttons follow the arc.
- Releasing with a non-zero arc starts a claim attempt (Claim attempts below) and sends the hold request at once. Releasing at zero length clears the claim.
- Touch dragging works the same way. From the press that starts a claim until its release, the ring keeps the touch and the page does not scroll. This holds at 375x812.

**Keyboard claim.** Tab moves through the rail, then into each dial in order: Start time, End time, Hold window, Repeat weekly, then Confirm booking and Release hold when present. Hold window and Repeat weekly are Tab stops at every window length, including zero length, where they are aria-disabled and ignore presses (Public screens and controls). After the dials, Tab moves to the spike's tickets and their Cancel booking buttons.

The spinbuttons start on the dial's earliest open quarter-hour step at zero length: Start and End both equal that step's start.

On either spinbutton:

- Up or Right moves later by 15 minutes;
- Down or Left moves earlier by 15 minutes;
- holding Shift with those keys moves 1 hour.

Start time keys move the whole window: End moves by the same amount, so the window keeps its length. For a Start press, the moved window's footprint must not be blocked. A Start press resolves as follows:

1. The press does nothing when the moved window would begin before 00:00 or end after 24:00, or, at zero length, would put Start at 24:00.
2. If the moved footprint is not blocked and the moved window costs no more than the member's available pack hours, Start and End take the moved values.
3. If the moved footprint is blocked, find the run of occupied sectors in the way:
   - The run's first sector is, for a later move, the blocking sector that starts earliest. For an earlier move, it is the blocking sector that ends latest.
   - The run also includes every occupied sector joined to that first one by touching or overlapping.
   - A later move lands Start on the end of that run. An earlier move lands Start the station's buffer plus 15 minutes before the start of that run, so its zero-length footprint ends exactly where the run starts.
   - Either way, End is reset to Start, giving zero length.
   - If the zero-length footprint at the landing Start is blocked, the run grows to include the blocking sector and every occupied sector joined to it. The landing is then worked out again in the same direction.
   - If the landing Start would be 24:00 or earlier than 00:00, the press does nothing.
4. A move whose footprint is not blocked but would cost more than the available pack hours does nothing.

For example, on Deck Oven 1 another member has a booking at 08:00–09:00. With the oven's sanitation buffer from Business rules, the run in the way is 08:00–09:30, and a window before it can end at 07:30 at the latest.

- From a zero-length window at 07:15, pressing Up lands Start and End on 09:30.
- From a zero-length window at 09:30, pressing Down lands Start and End on 07:15.
- From a window 06:00–07:30, pressing Shift+Up lands Start and End on 09:30.
- From a window 06:00–07:30, pressing Up on End time does nothing.

End time keys change End only. End never goes below Start; when they are equal the window has zero length. An End press does nothing when it would do any of these:

- take End below Start or past 24:00;
- make the window's footprint blocked;
- make the window cost more than the member's available pack hours.

The arc and centre readout follow every key press exactly as they follow a drag. Enter or Space on Hold window, while the window has length, starts a claim attempt and sends the hold.

**Claim attempts.** Each claim attempt carries one fresh idempotency key. The key is created when a non-zero arc is released, or Hold window is pressed with a non-zero window, while no attempt is outstanding.

- Until the attempt gets a final answer, these all resend the same request with the same key:
  - another release;
  - another press of Hold window;
  - a retry after a network error.

  The window does not change while an attempt is outstanding.
- An answer of `idempotency_in_progress` to a resend is not final while an earlier request with that key is still awaited; the page keeps waiting for that earlier answer. When no other request with the key is awaited, the in-progress copy is shown and the next press resends with the same key.
- Any other answer is final. The next release or press after it starts a new attempt with a new key.
- So a double press or double release ends with exactly one hold, one Held ticket and one hold sector.

**Hold, confirm, release.**

- **While the hold request is out**, the arc keeps its shape and Booking status shows the pending copy.
- **When the hold succeeds:**
  - the claimed window becomes the member's hold sector with a pulsing flame outline;
  - the claim arc and both spinbuttons return to the dial's earliest open step at zero length;
  - the centre shows the countdown from the server-now estimate to the booking's `hold_expires_at`;
  - Confirm booking and Release hold appear, and focus moves to Confirm booking;
  - a new "Held" ticket goes to the top of the spike.
- **Confirm booking**, once the server answers with success:
  - turns the arc solid green with a check glyph and the word "Confirmed";
  - tweens the centre numeral to the balance the server returns;
  - changes the ticket to "Confirmed";
  - moves focus to that ticket.
- **Release hold**, once the server answers with success, clears the arc, and the ticket changes to "Cancelled".
- **When the countdown reaches zero**, the dial reloads, the arc snaps back and the expiry copy is announced. The page re-requests that booking at once and, while it still reads held, again every 5 seconds, and redraws its ticket from the answer.
- **A rejected claim** (any refusal in Business rules) snaps the claim arc back to zero length at its start time and announces its reason. Focus stays on Hold window, or on the dial for a pointer claim. The centre numeral then shows the server balance again.

**Answers from the server (tickets and rows).** No ticket, Site day row, balance numeral, `data-pack-hours` value or pack hours by expiry line changes before the server answers the action that would change it.

- While a confirm, release or cancel is pending, the ticket keeps its previous status word and buttons, the dial centre and balances keep their values, and Booking status shows only the pending copy. The same holds for a Site day row while its check-in, no-show, check-out or cancel is pending, with Site day status.
- A success answer redraws the ticket or row, and the balances, from the response.
- A `409 invalid_transition` or `409 hold_expired` answer means another person or the server changed the booking first. The page then, at once:
  - re-requests `GET /api/bookings/{id}` for that booking and, for a member, also `GET /api/me/ledger`;
  - redraws only that ticket or row from the returned booking: its status word, its "Cancelled by `<canceller name>`" line when the booking now has one, and its buttons;
  - for a member, redraws the balance numerals, every dial centre's `data-pack-hours` and, where shown, the pack hours by expiry list from the ledger response's balances;
  - closes an open Cancel booking or Check out dialog for that booking;
  - moves focus to the redrawn ticket (member) or to that row's Status cell (manager);
  - shows the matching copy from Feedback states in Booking status or Site day status.
- No other ticket or row is redrawn by this.

**Dial reloads.** A dial reload is the regular reload in Refresh rules or the one after each of the member's own actions, for the current rail subject. It replaces the sectors of each dial and nothing else:

- the claim arc, the Start time and End time values and the centre readout stay as they were, including the Confirmed centre;
- a pointer or touch drag in progress keeps going: the ring keeps the pointer or touch, the arc keeps following it, and the new sectors become its stop points from the next move;
- an open Repeat weekly or Cancel booking dialog stays open with every value in it, including Number of weeks and a typed Reason;
- focus stays on the element that had it;
- the hold countdown keeps counting to the same `hold_expires_at` and is never restarted or reset;
- Booking status keeps its text, and a reload never writes to it except as below.

There is one exception. It applies when a reload finishes and all of these are true:

- no drag is in progress;
- no claim attempt is outstanding;
- the dial's claim window has length;
- that window's footprint is now blocked by the new sectors.

Then the arc and both spinbuttons snap back to the dial's earliest open step at zero length, and Booking status announces the `slot_taken` copy.

**Repeat weekly.**

- With a window set, Repeat weekly opens its dialog for the dial's date and window, with focus on Number of weeks. On open, the preview below is drawn for the starting 4 weeks, written under the Series total rule in Status regions (Feedback states).
- **Live preview.** On every value change of Number of weeks, by arrow keys or by typing, the dialog redraws `list "Occurrences"` and `status "Series total"` in place within 100 ms, without sending any request:
  - one Occurrences item per week, in date order, as published in Public screens and controls. Each `<hours>` is that occurrence's elapsed hours under the missing-and-repeated rule in Business rules, worked out in the site's IANA time zone and never the browser's. For example, an Eastside Sunday 01:00–03:00 occurrence on 2026-11-01 is 3.00 h;
  - "Uses `<hours>` pack hours" is the sum of the occurrence hours;
  - "Pack hours after this series `<hours>`" is the member's latest server `available_hours` minus that sum;
  - when the sum exceeds that balance, the second line reads "Not enough pack hours for `<n>` weeks." with `<n>` the current Number of weeks, and Book series carries `aria-disabled` "true" and ignores presses until the sum fits again.
- Number of weeks clamps at 2 and 12: a key that would leave that range does nothing, and a typed value outside it is replaced by the nearest bound. Focus stays on the spinbutton throughout.
- Book series sends the series.
- On success the dialog closes, one ticket per occurrence goes onto the spike (the earliest occurrence on top), and focus returns to Repeat weekly.
- On a conflict or uncovered dates, the dialog stays open and lists the dates it was refused for.

**Cancelling (member).** Cancel booking on a ticket opens its dialog. Its `status "Cancellation outcome"` region states the outcome under the forfeit window in Business rules, from the notice between the server-now estimate and the booking's `start_at`:

- full refund: "Cancelling refunds `<refunded hours>` pack hours.";
- split: "Cancelling now refunds `<refunded hours>` pack hours and forfeits `<forfeited hours>` pack hours.", with the forfeit part in the flame colour;
- full forfeit: "Cancelling now forfeits `<forfeited hours>` pack hours.", in the flame colour.

While the dialog is open, it works the outcome out again at least once a second. So when the server clock crosses the 72-hour or 48-hour notice edge, the sentence changes in place within 2 seconds, written under the Cancellation outcome rule in Status regions (Feedback states). Only the sentence's text and its flame forfeit part change. The dialog stays open, focus stays on whatever control had it, and nothing else in the dialog is redrawn.

The server's answer is final, and Booking status reports what actually happened. Confirm cancellation sends the request with no body. Until the answer arrives, the dialog stays open and the ticket keeps its status (Answers from the server). On success the dialog closes, the ticket reads "Cancelled" and focus moves to it. Keep booking or Escape closes the dialog.

**Cancelling (kitchen manager).**

- Cancel booking on a confirmed Site day row opens that booking's dialog with focus in Reason. It has the same Cancellation outcome region and sentence, kept current the same way, and its typed Reason text and caret survive every change of the sentence and every board reload.
- Confirm cancellation sends the reason as typed.
- A reason error leaves the dialog open with the error linked to Reason under Field errors (Feedback states), and its copy in Site day status.
- On success the dialog closes, the row shows "Cancelled" with no buttons, and focus moves to the row's Status cell. Site day status reports what actually happened.

**Dialogs (every dialog).**

- On open, focus moves to the first interactive control, unless this section names another starting control.
- Tab and Shift+Tab cycle inside the dialog, including Tab past its last control and Shift+Tab before its first.
- Escape and the Close or Keep button close it and return focus to the control that opened it, or, when a reload has removed that control, to its row's Status cell. Sign in again is the one exception (Expired session during a dialog).
- Content behind the dialog is inert while it is open.

**Packs.**

- Buy `<pack name>` opens its dialog. Opening the dialog creates one idempotency key for this purchase. The key lasts until the dialog closes or the purchase succeeds: every press of Pay and add hours in between, including after a `503`, a dropped connection, a refresh or a `401` resumed through Sign in again, reuses it.
- Pay and add hours follows the Pending buttons rule.
- On success the dialog closes, the numerals and the pack hours by expiry list update from the response, and the new ledger line tops the table.
- While `/packs` is open it re-requests `GET /api/me/ledger` once a minute, and redraws the numerals, the pack hours by expiry list and the hour ledger table from each answer. So a lot that expires leaves the list within 61 seconds after its home site's midnight, and never before it, and its "Pack hours expired" line, By "Pilotlight", tops the table.
- While the Buy dialog is open, whether its purchase is pending or has failed, the periodic redraw (including the one that removes an expired lot) never closes the dialog, never moves focus, never re-enables a pending Pay and add hours button and never writes to Pack status. Pack status keeps "Charging $`<price>`…" or the error or outage copy until the next action's own copy.
- **Latest balances win.** A `GET /api/me/ledger` answer whose request started before the most recent balance-carrying response arrived (a purchase, hold, confirm, release, cancel or series answer) is discarded: it never redraws the numerals, the lots or the table. So a refresh sent just before a purchase never rolls the balances back.
- Each line's flame marker follows only that lot's `expiring_soon` field in the latest drawn answer. The browser clock and time zone never decide a marker, a line's presence or a numeral.

**Documents.**

- Choosing "Certificate of insurance" reveals the coverage field and the additional-insured checkbox. Choosing any other type hides them, and the form does not send them.
- Upload document sends the form.
- Until the upload answers, no row is added to `table "Your documents"` and Coverage does not change; Document status shows only the pending copy.
- On success the new row from the response tops the table and the form clears.
- After any error or `503`, no row appears, and the chosen file, type, expiry date, coverage and checkbox keep their values, so pressing Upload document again re-sends them.
- Field errors appear under Field errors (Feedback states) and in Document status.
- Open downloads the file. Compliance's queue shows only documents from the server list.

**Site day (keyboard-complete).**

- The board opens on the site's current local date (Screens and layout). Previous day, Next day and the Date field move it.
- **Tab order:** the header (navigation links or Menu, then Sign out), then the rail (Previous day, Date, Next day), then each Bookings row in the order of the bookings response (by `start_at`, then by `reference`, as in API), and within a row its buttons in the published order. Nothing else on the board is a Tab stop. Status cells take focus only from script.
- Check in and Mark no-show act at once and follow the Pending buttons rule.
- **Focus after each answer:**

| Answer | Focus moves to |
|---|---|
| Check in success | that row's Check out button |
| Mark no-show success | that row's Status cell |
| Check out success | that row's Status cell |
| Cancel success | that row's Status cell |
| `too_early`, `too_late` or `certificate_expired` | stays on the pressed button, which becomes active again |
| `invalid_transition` | that row's Status cell |

- Check out opens its dialog with focus on Confirm check-out. Opening the dialog creates one idempotency key for that check-out, kept until the dialog closes or the check-out succeeds.
- The lateness shown in the dialog comes from the server-now estimate and updates each minute.
- Confirm check-out sends the request with that key. While it is pending it stays pressable: a second press, or a retry after a network error or a `503`, resends with the same key. A `401` follows Expired session during a dialog, whose single resend also uses that key. An `idempotency_in_progress` answer while an earlier request with the key is still awaited is not final; the page keeps waiting for the earlier answer.
- On success the dialog closes and the row shows its result text.
- After each action, the row's status and buttons refresh from the server response.

**Site day reloads.** The board reloads its bookings on the schedule in Refresh rules. A reload replaces row contents only:

- it adds rows for bookings made elsewhere on the shown date, in the order of the bookings response, and rewrites every row's cells and buttons from the response;
- an open Check out dialog stays open with the same idempotency key and its lateness line;
- an open Cancel booking dialog stays open with its typed Reason, its caret and selection;
- focus stays on the element that had it; when a reload removes the focused button, focus moves to that row's Status cell;
- Site day status keeps its text, because a reload never writes to it.

If a reload shows that an open dialog's booking has changed state, the dialog stays open. Confirming it then gets the server's answer, handled as in Answers from the server.

**Trucks.**

- Typing two or more characters in Find a member offers up to ten matches. Up and Down move through them, Enter picks one, and Escape closes the list.
- Picking a member who owns a truck loads that truck.
- Truck arrived records the arrival at once. Truck departed opens Record departure.
- Issue inspector link sends the email address.
- Revoke and Reissue act at once and update the list.

**Rates.**

- The Effective from field starts on the chosen site's next local date: the day after that site's `local_date` from `GET /api/sites`.
- It resets to that date whenever the site changes, so two sites in different time zones can start on different dates.
- Each change of the Site picker requests that site's schedule and makes every earlier request stale. A stale answer, even one that arrives after the newest answer, is discarded: it never redraws the rate schedule table, its State cells or Effective from, and never writes Rates status. While the newest request is pending, the table shows no rows.
- After Schedule rate succeeds, while the site it was scheduled for is still chosen, every row of the rate schedule table, states included, is redrawn from the `rates` list in the response. When the site has changed before the answer arrives, Rates status still shows the answer's copy, but the table and Effective from keep showing the site chosen now.

**Reports and the address.**

- **Show report** always adds a new history entry, then loads the report:
  - with a member chosen: `/reports?month=<month>&member=<member id>`;
  - otherwise: `/reports?month=<month>`.
- **The address restores the screen.** Opening or reloading the address (including after sign-in from a deep link), Back and Forward all restore the screen from it:
  - the Month field takes the `month` value, or stays empty when there is none;
  - the Member combobox shows the business name of the `member` id, which the report response supplies, or is empty when the address has no `member`;
  - the table and Report status match that query;
  - `link "Download CSV"` points at `/api/reports/utilisation.csv?month=<month>`, plus `&member_id=<member id>` when filtered.
- **Latest load wins.** Each report load (Show report, an opened or reloaded address, Back or Forward) makes every earlier report request stale. A stale answer never redraws the table, Report status, the Month field, the Member combobox or the Download CSV link. So after quick Back and Forward steps the screen and the CSV link match the final address.
- **Member search.** Every change of the Member text makes every earlier `GET /api/members` request stale. The listbox only ever shows matches for the current text, even when an earlier query answers later. Text shorter than 2 characters closes the listbox and sends nothing.
- **Bad values in the address.**
  - With no `month`, no table is shown and Report status is empty.
  - An invalid `month` shows the `month` validation copy and no table.
  - A `member` id that the report API answers with 404 shows the unfiltered table for the month and empties the Member combobox. It announces the not-in-incubator copy from Feedback states, which stays in Report status while that unfiltered table loads and is not replaced by its own loading or success copy.
- **Clearing the filter.** Clearing the Member combobox and pressing Show report removes the filter.

**Inspector view.**

- The `/inspect/<token>` page requests only:
  - `GET /api/inspect/<token>`, when it loads and again on the schedule in Refresh rules;
  - `GET /api/inspect/<token>/log.pdf`, when Download PDF is pressed.
- It requests no other API path, including `/api/me` and `/api/sites`, and shows no navigation, Menu or sign-in controls.
- If a repeat request answers 404 or 410, the page replaces its content with only the matching dead-link heading.

**Refresh rules.**

- **Dials** reload after each of the member's own actions and every 15 seconds, so another member's claim appears within 15 seconds. Every reload follows Dial reloads and the rail subject rule.
- **Site day** reloads its bookings table after each action and every 30 seconds while `/site` is open, so a booking made elsewhere appears within 30 seconds. Every reload follows Site day reloads.
- **Packs** re-requests the ledger once a minute while open, as described in Packs.
- **Balances**, the numerals and the pack hours by expiry list also update from each response that carries balances, and on page load.
- **The hold countdown** updates every second, or every minute under reduced motion.
- **Site time** updates every minute.
- **The Overdue notice** on Trucks (with a truck loaded), Truck log and the inspector view comes only from the `overdue` field of that screen's own visits request: `GET /api/trucks/{truck_id}/visits`, or `GET /api/inspect/<token>` on the inspector view.
  - The screen repeats that request once a minute while it is open. On Trucks it also repeats it at once after each arrival or departure is recorded.
  - So the notice appears no later than 61 seconds after the server's overdue edge and never before it, and it disappears as soon as a response says the truck is not overdue.
  - The visit table refreshes from the same response.
- **An open Cancel booking dialog** recalculates its outcome sentence as described in Cancelling.
- **Every periodic reload pauses** while that screen's Sign in again dialog is open.
- **The review queue, rate states and reports** update on load and after each action on that screen.

### Visual design (DP-55, DP-58, DP-59)

**Colour roles.**

- The page sits on a cool paper-grey ground, like brushed steel under kitchen light, with near-black ink for text.
- One flame orange-red is the only accent. It is used only for:
  - the in-progress claim arc;
  - live hold outlines and countdowns;
  - forfeit warnings;
  - certificates that are expiring or expired;
  - the Overdue notice's marker;
  - the marker on pack-hour lines close to expiry.
- A deep bottle green marks confirmed bookings and verified documents.
- A mid steel grey draws the hatching on other members' bookings, the dotted sanitation buffers and the hairline rules.
- Text never depends on the accent alone. Small text stays in ink or green, apart from the Cancel booking dialog's published forfeit sentence, and the accent carries strokes, fills, markers and large numerals.
- All text meets WCAG 2.2 AA contrast, and graphic marks meet at least 3:1 against the ground.

**Type.**

- Headings, station names and ticket headers use Archivo at its condensed width: tall, narrow and workmanlike, like stencilled equipment labels.
- Body text uses IBM Plex Sans.
- Every numeral that counts something uses IBM Plex Mono, so columns line up like an order printer. That covers hours, times, money, references, countdowns and valid-through dates.
- Each heading level is about a quarter larger than the one below it, and body text is the base step.
- The app serves the fonts itself.

**Density.** Compact. Station rows are tight and separated by single hairline steel rules, and spacing stays on one consistent small step.

**Control size.** Every control is at least 44 px tall and at least 44 px wide, so it can be tapped comfortably.

- "Control" means every button, link, text or date field, file field, combobox, spinbutton, checkbox and radio the app renders, including those not listed in Public screens and controls. That covers header navigation links, the Menu button, a product name that links home, and inline text links such as "Open", "Open file", "Download CSV" and "Download PDF".
- Each dimension is measured on whichever box is larger in that dimension: the control's own box, or the box of its associated label. The label can be a `<label>` element or an element named by `aria-labelledby`. So a checkbox or radio can pass through its label, and a link passes through its own padded box.

**Composition.** A rigid 12-column grid sits under a sticky rail. Station dials stack on the left like burners on a range. The ticket spike on the right stacks tickets like order slips on a kitchen spike, newest on top. The phone navigation panel drops from the header like a steel shelf, ruled between links. The inspector page uses the same grid with no app chrome: a clipboard-like heading block, the verdict and PDF button to its right, the log beneath.

**Sign in again.** The dialog is a compact steel-edged panel centred over the dialog it interrupts. That dialog is dimmed by a grey veil but stays in place, so its booking reference or pack name and its typed values can still be read through the veil.

**Tickets.** Each ticket looks like a kitchen order ticket:

- off-white paper slightly lighter than the ground;
- a mono reference number at the top;
- station and time in condensed capitals;
- hours in mono;
- a status stamp, with the "Cancelled by" line in small ink text beneath it when present;
- a torn, zig-zag bottom edge drawn as a vector shape.

**Pack hours by expiry.** Each lot line reads like a stock tag on a shelf: mono hours, a mono date, and a thin steel rule between lines. The flame marker is a small filled notch at the left edge.

**Dials.** Each dial is a thick ring marked with 24 hour ticks and minor ticks every quarter hour. Major ticks come every 3 hours and are labelled 00, 03, 06, 09, 12, 15, 18 and 21 around the ring.

- Other members' bookings are filled with diagonal steel hatching.
- Sanitation buffers are filled with steel dots, and longer buffers show visibly longer dotted runs.
- The in-progress claim is solid flame.
- The member's own confirmed bookings are solid green.
- The not-on-the-clock hour uses crossed hatching.
- The centre holds the time range and the large mono balance numeral.
- A busy dial (rail subject pending) dims its sectors slightly, with no spinner.
- An aria-disabled Hold window or Repeat weekly button shows in muted ink with a dashed steel outline, so it reads as not yet usable.

**Icons.** Lucide line icons only: chevrons, check, flame, file, truck, link, menu and x.

### Motion and effects (DP-02, DP-09, DP-57)

All motion starts briskly and settles gently, with no bounce or overshoot.

- **Press and hover feedback.** Buttons, radios and ticket buttons darken or lift in about a tenth of a second. Keyboard focus shows a two-tone ring at once.
- **Claim arc while dragging or keying.** The arc follows the pointer directly, jumping a quarter-hour step at a time with no lag. The centre numeral changes in step.
- **Snap-back on rejection, expiry or a reload that finds the window taken.** The arc retracts to its start point in about a quarter of a second.
- **Hold outline.** The flame outline pulses slowly, about one cycle per second, for as long as the hold lasts. A dial reload never restarts the pulse. This is the only repeating animation in the product.
- **Confirm.** The arc changes from flame to green and the check glyph fades in, in about a quarter of a second. The centre numeral counts to the server balance over about a quarter of a second.
- **New ticket.** It drops onto the top of the spike from slightly above while the others shift down, finishing in under half a second.
- **Dialogs**, Sign in again included, fade and rise into place in about a quarter of a second, and leave in about a tenth of a second. The veil over an interrupted dialog fades in with Sign in again. A cancel dialog's outcome sentence and a Repeat weekly preview change their text in place with no movement.
- **Phone navigation.** The panel appears and collapses at once, with no slide.
- **Row status change** on Site day, Compliance and Trucks, and a redrawn ticket. The status cell or stamp briefly tints and settles back in about a quarter of a second.
- **Overdue notice.** It appears and disappears at once, with no movement.
- **Pack hours by expiry.** A line whose hours change briefly tints and settles back in about a quarter of a second. A line that reaches zero or expires disappears at once.
- **Banned:** any decorative loop or ambient animation beyond the hold pulse, loading spinners, parallax, and motion tied to scrolling.

**Burner Dial signature, step by step.**

1. **Idle.** The ring shows hatched, dotted and green sectors, and the centre reads "Drag to claim".
2. **Press.** Pressing an open point drops a flame dot at the snapped start angle.
3. **Drag.** Dragging clockwise extends the flame arc from that angle toward the pointer in quarter-hour jumps. The centre's time range and "Pack hours after this claim" numeral change with every jump. A dial reload during the drag changes only the sectors around it.
4. **Stop.** The arc stops dead, however far the pointer travels, at either of these points:
   - where the claim's own sanitation buffer would meet the next booking or hold, leaving a gap exactly as long as that station's buffer;
   - where it reaches a not-on-the-clock sector.
5. **Drag back.** The arc retracts step by step, and the numeral counts back up the same way.
6. **Release.** The arc freezes. The pulsing outline and countdown begin when the hold is accepted.
7. **Confirm or reject.** Confirming turns the arc green with the check once the server answers. A rejection retracts the arc to its start point, and the dot disappears.

**Reduced motion** (when the user's system asks for less motion):

- Nothing tweens or animates. That covers the arc, the snap-back, the pulse, numeral counting, the ticket drop, line and row tints, veils and dialog movement. The arc, numerals, tickets, lines and dialogs appear in their final state at once.
- The hold outline is a steady flame outline that does not change between frames, and the countdown uses the minutes-only form, updated once a minute.
- Focus rings and colour changes stay instant.
- Every dial keeps its Start time and End time spinbuttons in both modes, so keyboard and screen-reader users have the same function.
- Touch dragging works the same as without reduced motion.

### Feedback states (DP-09, DP-10, DP-13, DP-18, DP-20, DP-21, DP-22, DP-25, DP-27, DP-28, DP-31, DP-35, DP-38, DP-39, DP-42, DP-45, DP-49, DP-51, DP-62, DP-65, DP-66, DP-67, DP-74, DP-75, DP-78, DP-80, DP-85, DP-86, DP-87, DP-91, DP-92, DP-93)

Every asynchronous action shows its pending copy in the named live region as soon as it starts. It then replaces that copy with exactly one success, error or outage copy, under Status regions below. Field errors also appear beside their field, under Field errors below.

A later repaint or reload never overwrites a success, error or outage copy that an action has just shown. Only the next action's own copy, or a copy this section assigns to a reload, replaces it.

**Status regions.** Every status region named in Public screens and controls (Sign-in status, including Sign in again's, Booking status, Series total, Pack status, Document status, Compliance status, Site day status, Visit log status, Rates status, Report status and Cancellation outcome) follows these rules:

- It is a status element with polite live announcements and whole-region (atomic) reading, already present and empty in the first rendered frame of its screen or dialog.
- Each write replaces the region's whole text in one DOM update; text never grows piece by piece, and the region never passes through an empty or partial text between two copies, except as below.
- An action writes its pending copy, then exactly one final copy.
- When a write's copy equals the region's current text, the region is emptied and set to the copy again on the next animation frame. That is the only empty frame between two copies.
- Dial reloads, Site day reloads, the Packs refresh and the visits refresh never write to any region, except the dial reload's `slot_taken` copy below.
- **Cancellation outcome.** When a Cancel booking dialog opens, its region is written once with the current outcome sentence. The once-a-second recalculation writes to it only when the outcome kind or its hours change, so between edges it receives no DOM change at all, and at each 72-hour or 48-hour crossing it receives exactly one text change.
- **Series total.** When Repeat weekly opens, `list "Occurrences"` is drawn for the starting 4 weeks and Series total is written once with the preview for those 4 weeks, straight after the region's empty first frame. After that, it is written on every Number of weeks change whose result differs from the shown text, and never otherwise.
- Table Status cells are never live regions; row changes are announced only through Site day status.

**Field errors.** Every field error is an element placed directly after its field and holding the published copy from this section. While it is shown, its field carries `aria-invalid` "true" and an `aria-describedby` that includes that element's id. On the field's next value change, by typing, picking a file, ticking or changing a date, the error element is removed and both attributes are taken off the field; the status-region copy written for the error stays. A field without an error never carries `aria-invalid` "true". When a server answer names a field in `fields`, its copy is shown this way beside that field and also in the screen's status region. This covers:

- Sign-in: Email and Password, in the sign-in form and in Sign in again;
- Documents: Expiry date, Coverage per occurrence (USD), the additional-insured checkbox and File;
- Rates: Effective from, Hourly rate (USD) and Sales tax (%);
- Reports: Month;
- Site day Cancel booking and Compliance Reject document: Reason;
- Record departure: the Services group and Operator signature;
- Trucks: Inspector email.

**Exact copy.** Every copy string this brief prints in quotes or backticks renders character for character:

- straight apostrophes and quotes;
- the exact dashes, middle dots and ellipsis characters as printed;
- the same case, digits and spacing;
- money with its thousands comma.

Live-region announcements built from these strings carry the same characters.

**Placeholders.**

- **Names and references.**
  - `<station>` is the station name.
  - `<reference>` is the booking reference.
  - `<site name>` is the site's name.
  - `<business>` is the member's business name.
  - `<manager name>` is the name in the booking's `checked_out_by`.
  - `<canceller name>` is the name in the booking's `cancelled_by`.
  - `<reason>` is the stored `cancellation_reason` or document `rejection_reason` exactly as entered.
  - `<email>` is an email address.
  - `<pack name>` is the pack's name.
- **Dates and times.**
  - `<date>` is a site-local date as YYYY-MM-DD.
  - `<month>` is YYYY-MM.
  - `<start>`, `<end>` and `<HH:MM>` are site-local 24-hour times.
  - `<weekday>` is the English weekday name.
  - In the Overdue notice, `<date>` and `<HH:MM>` give the response's `last_departed_at` in the commissary site's time zone.
- **Countdowns and lateness.**
  - `<m:ss>` is the time from the server-now estimate to `hold_expires_at`, written as whole minutes, a colon and two-digit seconds, with any fraction of a second dropped and never below 0:00.
  - `<m>` is that same time in whole minutes, rounded up.
  - `<minutes>` is the whole minutes from the booking's end to the server-now estimate, with seconds dropped, never below 0, and with no leading zeros.
  - `<retry minutes>` is the `Retry-After` seconds divided by 60, rounded up, and at least 1.
- **Hour amounts** have two decimals. This covers `<hours>`, `<refunded hours>`, `<forfeited hours>`, `<late hours>`, `<pack hours applied>` and `<gap hours>`.
  - `<refunded hours>` and `<forfeited hours>` are the cancellation's `refunded_hours` and `forfeited_hours`, or, in an open dialog, the values the dialog has worked out.
  - `<late hours>` is `late_quarter_hours` × 0.25.
  - `<pack hours applied>` is `pack_hours_applied`.
- **Money** (`<price>`, `<total>`, `<hourly rate>` and every money cell) is dollars with two decimals and a comma between thousands, for example 1,234.50. On a check-out, `<total>` is the overage `total_cents` in that format, or 0.00 when `overage` is null.
- **Lists and counts.**
  - `<dates, comma-separated>` is the conflicting or uncovered dates as YYYY-MM-DD in ascending order, joined by a comma and a space.
  - `<n>` is a count.

**Cell formats.**

- A check-out row shows "On time" when `late_quarter_hours` is 0, and the "Late …" text otherwise.
- Hours cells (Scheduled hours, Used hours, Forfeited hours, Gap and ticket hours) use two decimals.
- The Overage and Hourly rate cells show "$" followed by the money format.
- The Sales tax cell shows the stored `tax_rate_percent` string followed by "%", for example "8.875%".
- The hour ledger's Booking cell shows the booking's `reference`, or "—" when the movement has no booking.

**Copy for every region.**

- Any 500 response shows "Something went wrong. Refresh to see the current state."
- A dropped connection shows "Can't reach Pilotlight. Check your connection and try again."
- `403 csrf_failed` shows "Your session changed in another tab. Refresh and try again."
- The *ticket changed copy* is "This booking changed elsewhere. Its ticket now shows the current state."
- The *row changed copy* is "This booking changed elsewhere. Its row now shows the current state."
- The *session-ended copy*, shown in Sign-in status (the sign-in form's, or Sign in again's) when a signed-in screen gets a `401`, is "Your session has ended. Sign in again."

| Action | Region | Pending | Success | Errors and outage (API code → copy) |
|---|---|---|---|---|
| Sign in (form or Sign in and continue) | Sign-in status | "Signing in…" | (navigates as in Interactions, or closes Sign in again) | `invalid_credentials` → "That email and password don't match."<br>`too_many_attempts` → "Too many sign-in attempts. Try again in `<retry minutes>` minutes."<br>validation `email` → "Enter a valid email address."<br>validation `password` → "Enter your password." |
| Hold | Booking status | "Holding `<start>`–`<end>`…" | "Held `<station>` `<start>`–`<end>`. Confirm before `<HH:MM>` site time." (`<HH:MM>` is the hold expiry; a replayed hold shows the same copy) | `slot_taken` → "Someone else just claimed that window. Your pack hours are unchanged."<br>`certificate_expired` → "Your certificate of insurance doesn't cover `<date>`. Upload a current one to book." (`<date>` is the requested date)<br>`cutoff` → "That date is closed for booking. Bookings for tomorrow close at 18:00 site time."<br>`hold_limit` → "You already hold 3 windows. Confirm or release one first."<br>`insufficient_hours` → "Not enough pack hours for this window. Buy a pack to continue."<br>`idempotency_in_progress` → "Your hold is still being placed. Wait a moment."<br>`idempotency_conflict` → "That hold request was already used for another window. Drag the window again."<br>`validation` → "That window isn't valid. Pick quarter-hour times within one day." |
| Dial reload finds the window taken | Booking status | — | — | the `slot_taken` copy above |
| Confirm | Booking status | "Confirming…" | "Confirmed `<station>` `<date>` `<start>`–`<end>`. `<hours>` pack hours left." | `hold_expired` → "Your hold expired and the window was released."<br>`certificate_expired` → the hold copy above, with the booking's date<br>`invalid_transition` → the ticket changed copy |
| Hold expires on screen | Booking status | — | — | the `hold_expired` copy |
| Release hold | Booking status | "Releasing…" | "Hold released. `<hours>` pack hours returned." | `invalid_transition` → the ticket changed copy |
| Cancel booking (member) | Booking status | "Cancelling…" | full refund: "Booking cancelled. `<refunded hours>` pack hours refunded."<br>split: "Booking cancelled. `<refunded hours>` pack hours refunded, `<forfeited hours>` forfeited."<br>full forfeit: "Booking cancelled. `<forfeited hours>` pack hours forfeited." | `invalid_transition` → the ticket changed copy |
| Cancel booking (kitchen manager) | Site day status | "Cancelling…" | full refund: "Cancelled `<reference>` for `<business>`. `<refunded hours>` pack hours refunded."<br>split: "Cancelled `<reference>` for `<business>`. `<refunded hours>` pack hours refunded, `<forfeited hours>` forfeited."<br>full forfeit: "Cancelled `<reference>` for `<business>`. `<forfeited hours>` pack hours forfeited." | validation `reason` → "Give a reason the member can act on."<br>`invalid_transition` → the row changed copy |
| Book series | Booking status | "Booking `<n>` weeks…" | "Booked `<n>` weekly slots. `<hours>` pack hours left." | `series_conflict` → "Some weeks are taken: `<dates, comma-separated>`. Nothing was booked."<br>`certificate_expired` → "Your insurance doesn't cover: `<dates, comma-separated>`. Nothing was booked."<br>`cutoff`, `insufficient_hours`, `validation` → the hold copies above |
| Buy pack | Pack status | "Charging $`<price>`…" | "Added `<hours>` pack hours, valid through `<date>`. A receipt is on its way to `<email>`." (`<date>` is the new lot's valid-through date) | `billing_unavailable` → "Billing is unreachable right now. You have not been charged and no hours were added."<br>`idempotency_in_progress` → "Your payment is still being processed. Wait a moment."<br>`idempotency_conflict` → "This purchase was already used for a different pack. Close the dialog and try again." |
| Upload document | Document status | "Uploading…" | "Uploaded `<type label>`. It is waiting for review." | `unsupported_type` → "Upload a PDF, PNG or JPEG file."<br>`file_too_large` → "Files can be at most 5,000,000 bytes."<br>validation `per_occurrence_limit` → "Coverage must be at least $1,000,000 per occurrence."<br>validation `names_additional_insured` → "The certificate must name `<tenant legal name>` as additional insured."<br>validation `expiry_date` → "Enter the expiry date shown on the document."<br>validation `file` → "Choose a file to upload."<br>`storage_unavailable` → "Document storage is unreachable. Nothing was uploaded; try again shortly." |
| Open a document file | Document status or Compliance status | — | (file downloads) | `storage_unavailable` → "This file can't be opened right now. Try again shortly." |
| Verify | Compliance status | "Saving…" | "Verified. `<business>` is covered through `<date>`." | `invalid_transition` → "This document was already reviewed."<br>`document_expired` → "This document's expiry date has passed. Reject it instead." |
| Reject | Compliance status | "Saving…" | "Rejected `<type label>` for `<business>`." | `invalid_transition` → "This document was already reviewed."<br>validation `reason` → "Give a reason the member can act on." |
| Check in | Site day status | "Checking in…" | "Checked in `<business>` on `<station>`." | `too_early` → "Too early to check in. Check-in opens 15 minutes before the start."<br>`too_late` → "This booking has ended and can no longer be checked in."<br>`certificate_expired` → "`<business>`'s certificate of insurance has expired. They can't use the kitchen until a current one is verified."<br>`invalid_transition` → the row changed copy |
| Mark no-show | Site day status | "Saving…" | "Marked `<business>` as a no-show. `<hours>` pack hours forfeited." | `too_early` → "A no-show can be marked from `<HH:MM>`, 30 minutes after the start."<br>`invalid_transition` → the row changed copy |
| Check out | Site day status | "Checking out…" | late: "Checked out `<business>`. Late `<late hours>` h; `<pack hours applied>` pack hours applied; overage $`<total>`."<br>not late: "Checked out `<business>` on time." | `billing_unavailable` → "Billing is unreachable, so this check-out was not recorded. Try again in a moment."<br>`idempotency_in_progress` → "This check-out is still being processed. Wait a moment."<br>`idempotency_conflict` → "This check-out request was already used for another booking. Close the dialog and try again."<br>`invalid_transition` → the row changed copy |
| Truck arrived | Visit log status | "Saving…" | "Truck arrived at `<HH:MM>`." | `visit_open` → "This truck is already checked in. Record its departure first." |
| Save departure | Visit log status | "Saving…" | "Departure recorded at `<HH:MM>`." | validation `services` → "Choose at least one service."<br>validation `operator_signature` → "Type the operator's name to sign."<br>`invalid_transition` → "This visit already has a departure." |
| Issue inspector link | Visit log status | "Issuing link…" | "Link sent to `<email>`. It works until `<date>` `<HH:MM>` site time." | validation `inspector_email` → "Enter a valid email address."<br>`storage_unavailable` → "Document storage is unreachable, so no link was issued." |
| Revoke | Visit log status | "Revoking…" | "Link revoked. It stops working now." | `invalid_transition` → "This link is no longer live." |
| Reissue | Visit log status | "Reissuing…" | "New link sent to `<email>`. The old link no longer works." | `invalid_transition` → "This link is no longer live."<br>`storage_unavailable` → "Document storage is unreachable, so no link was issued." |
| Schedule rate | Rates status | "Saving…" | "Rate scheduled from `<date>`." (shown even when the site changed before the answer arrived) | validation `effective_from` → "The effective date must be after today in site time."<br>validation `hourly_rate_cents` → "Enter an hourly rate between $0.01 and $1,000.00."<br>validation `tax_rate_percent` → "Enter a tax rate between 0 and 25 percent with up to three decimals."<br>`rate_exists` → "A rate already starts on `<date>`." (shown in Rates status and as the Effective from field error) |
| Show report (by button or from the address) | Report status | "Loading report…" | "Showing `<month>`." | validation `month` → "Enter a month as YYYY-MM."<br>`not_found` for the member → "That member isn't in your incubator." (then the unfiltered report loads) |
| Inspector PDF | (on the inspect page, under the link) | — | (file downloads) | `storage_unavailable` → "The PDF can't be downloaded right now. The table above is current." |

## Backend

### API (DP-01, DP-04, DP-07, DP-08, DP-11, DP-12, DP-14, DP-18, DP-19, DP-21, DP-22, DP-23, DP-24, DP-28, DP-29, DP-30, DP-32, DP-33, DP-34, DP-36, DP-37, DP-39, DP-40, DP-41, DP-43, DP-46, DP-47, DP-48, DP-51, DP-52, DP-61, DP-62, DP-63, DP-65, DP-66, DP-67, DP-68, DP-69, DP-70, DP-72, DP-76, DP-77, DP-84, DP-91, DP-92, DP-93, DP-95, DP-97, DP-98)

**Conventions.**

- All endpoints live under `/api`. Requests and responses are `application/json; charset=utf-8` unless a row says otherwise.
- Every `*_at` field is an ISO-8601 UTC instant with exactly three fractional-second digits, ending in `Z`, for example `2026-11-10T13:45:00.000Z`. `hold_expires_at` is exact to the millisecond.
- `date` and `valid_through` fields are site-local `YYYY-MM-DD`.
- Wall times are site-local `HH:MM`, and `end` may be `24:00`.
- Hours are JSON numbers that are exact multiples of 0.25, apart from a visit's `gap_hours`, which comes from real departure times and is rounded as Business rules states. Money is integer cents. Ids are lowercase hyphenated UUIDs.
- A booking `reference` is `PL-` followed by six uppercase letters or digits, unique within the tenant.
- The `pl_session` cookie authenticates every endpoint except health, sign-in, sign-out and `/api/inspect/*`; its attributes, lifetime and refusal codes are in Sessions and sign-in (Business rules).
- An `Idempotency-Key` header value is 1 to 100 characters, drawn from letters, digits, `-` and `_`. Its replay and conflict rules are in Business rules.
- Every API response, errors and replays included, carries an HTTP `Date` header giving the server clock (Business rules) to the second, never the host's system clock when the two differ.

**Closed bodies.** Every JSON body accepts exactly the fields its row lists for the caller's role, and every multipart body accepts exactly its listed form fields.

- Any other top-level key or form field is refused with `422 validation`, with `fields` naming each unknown key with the message "Unknown field." Nothing is stored.
- A known field is never silently stripped or ignored.
- This covers keys such as `id`, `state`, `status`, `site_id`, `member_id`, `tenant_id`, `hours`, `price_cents`, `created_at`, `departed_at`, `sha256`, `reason` and `actor` wherever the row does not list them for that caller. For example, `"site_id"` in a rate body is refused even when it equals the path's site, and `"reason"` in a member's cancel is refused.
- A row whose request is "—" takes no body or the empty object `{}`, and any key in it is unknown.
- No endpoint accepts an actor, status, owner, price or checksum from the client.

**Values are only values.** Every id, query parameter and body field is treated as plain data, never as query text, a template, a path or an operator.

- An id in a path, query or body that is not a lowercase hyphenated UUID is unknown and answers `404 not_found` (precedence step 8). A malformed non-id field answers `422 validation` naming it.
- Inputs such as `' OR 1=1 --`, `'; DROP TABLE bookings;--`, `${jndi:ldap://x/y}`, `{"$ne":null}` and `../../etc/passwd`, given as an id, as `date`, `month`, `since` or `q`, or in any body field, get the published refusal for that shape (or, for `q`, an ordinary search), and every stored row is unchanged afterwards.
- No such request answers `500`, and no response body or header ever contains SQL text, a driver message, a stack frame or a file path.
- In `GET /api/members?q=`, every character of `q` matches itself, including `%`, `_` and `\`. For example, `q=%_` matches only names containing those two characters in that order, which no seeded name does, so it answers an empty list. The 2-character minimum and 10-result cap still apply.

**Bounded work.** A pathological input answers its published refusal and never a `500`, a hang or a truncated body.

- A `q` of more than 100 characters answers `422 validation` (`q`). Exactly 100 is accepted.
- A JSON body nested more than 20 levels deep answers `422 validation` (`body`). Exactly 20 is accepted.
- A `month` outside `2000-01` to `2099-12` answers `422 validation` (`month`), as does a `since` above 2147483647.

**Exact response shapes.** Every JSON response carries exactly the keys its row or shared shape lists, at every depth, and no others. That rules out `email`, `tenant_id`, password data, session or CSRF values, Kill Bill account ids, storage keys and any other stored column beyond the shape.

- The only user email address any response carries is the caller's own, in `/api/me` and the sign-in response.
- The one other email address in any response is an inspector link's `inspector_email`, returned only to the kitchen managers of that truck's site.
- Member balances, lots and valid-through dates appear only in responses to that member.

**Error body.** Every error response, on API and non-API paths alike, is `{"error":{"code":"<code>","message":"<human-readable text>"}}` with content type `application/json; charset=utf-8`, and `error` is the body's only top-level key.

- The one exception is the health check's 503 body in the endpoint table. It is written on its own and is the only response outside this body.
- Validation errors add `"fields":{"<field>":"<message>"}` inside the `error` object.
- A series conflict and a series `certificate_expired` add `"dates":["<date>",…]` inside it too, in ascending date order.
- An unexpected server failure answers `500` with exactly `{"error":{"code":"internal","message":"Something went wrong."}}`.

**Error precedence (the whole API).** The first matching check decides the answer:

1. `405 read_only` with header `Allow: GET`: any method other than GET on `/api/inspect/{token}` or a path below it, whatever its token, headers or body.
2. Transport checks, in this order: `413 body_too_large`, `413 file_too_large`, `415 unsupported_media_type`, `403 cross_origin` (Server boundary).
3. Unknown surface, signed in or out:
   - a path under `/api` that matches no path pattern of the endpoint table answers `404 not_found`;
   - a path that matches a pattern, with a method that no row lists for that pattern, answers `405 method_not_allowed` with header `Allow` listing the methods the table gives that pattern, comma-separated in table order. For example, `PUT /api/session` answers `Allow: POST, DELETE`, and `PATCH /api/bookings` answers `Allow: POST, GET`.
4. `POST /api/session` only, which needs no session and no CSRF token: `422 validation`, then `429 too_many_attempts`, then `401 invalid_credentials` (Sessions and sign-in).
5. `401` on an endpoint that needs a session: no `pl_session` cookie answers `unauthenticated`; a cookie whose session has passed its idle or absolute limit answers `session_expired`; any other cookie value that is not a live session answers `session_invalid`. `session_expired` wins over `session_invalid` when both apply.
6. `403 csrf_failed`: a POST, PUT, PATCH or DELETE carrying a live session without the matching `X-CSRF-Token` (Server boundary). This includes `DELETE /api/session`.
7. `403 forbidden`: the caller's role may not use the endpoint at all (the Roles column).
   - This is judged on the role alone, before any id is looked up, so it comes before the scope check in step 8.
   - For example, a kitchen manager calling `POST /api/bookings/{id}/confirm` on a booking at their own site gets `403 forbidden`. A finance lead calling `GET /api/documents/{id}` or `POST /api/bookings/{id}/cancel` gets `403 forbidden` for any id, and a member calling `GET /api/audit` gets `403 forbidden`.
8. `404 not_found`: an id in the path, query or body that is unknown, malformed, belongs to another tenant, or is outside the caller's scope on an endpoint their role may use (another member's record, or another site's record for a manager). For an inspector token:
   - an unknown token answers `404 not_found`;
   - a revoked token answers `410 link_revoked`;
   - an expired token that was never revoked answers `410 link_expired`.
9. Idempotent replay for holds, pack purchases and check-outs:
   - a stored response for the same key and the same request is returned as stored;
   - a key in flight or bound to a different request answers `409 idempotency_in_progress` or `409 idempotency_conflict` (Business rules).
10. `409` state conflicts on the target record: `invalid_transition`, `hold_expired`, `too_early`, `too_late`, `visit_open`.
11. `415 unsupported_type`: a non-empty uploaded file that fails the upload type rule (Server boundary).
12. `422 validation`: missing, malformed, out-of-range or unknown fields, and a missing or malformed `Idempotency-Key` header. This includes a manager's missing cancellation reason and a member's sent one.
13. `422` business-rule refusals, in the order the endpoint lists them.
14. `409` contention with other records: `slot_taken`, `series_conflict`, `rate_exists`.
15. `503` provider outages (`billing_unavailable`, `storage_unavailable`), which leave no change behind.

**Shared shapes.**

- **Booking**: `{"id","reference","site_id","station_id","station_name","member_id","business_name","date","start","end","start_at","end_at","hours","status","hold_expires_at","series_id","refunded_hours","forfeited_hours","cancelled_by","cancellation_reason","checked_in_at","checked_in_by","no_show_by","checked_out_at","checked_out_by","late_quarter_hours","pack_hours_applied","overage","created_at"}`.
  - `status` is one of `held`, `confirmed`, `checked_in`, `checked_out`, `no_show`, `cancelled`, `expired`. A held booking whose `hold_expires_at` has been reached is always reported as `expired`.
  - `cancelled_by`, `checked_in_by`, `no_show_by` and `checked_out_by` are each `null`, or exactly `{"user_id","name"}` of the person who acted.
  - `cancellation_reason` is the manager's reason, and `null` for a member's cancellation.
  - Fields that do not apply yet are `null`.
  - `overage` is `null` or `{"quarter_hours","hourly_rate_cents","tax_rate_percent","subtotal_cents","tax_cents","total_cents","killbill_invoice_id"}`, where `tax_rate_percent` is a string such as `"8.875"`.
- **Balances**: `{"available_hours","committed_hours","lots":[{"purchase_id","pack_name","hours","valid_through","expiring_soon"}]}`.
  - `lots` lists every lot with hours above 0, in drawing order (Business rules).
  - The opening lot has `purchase_id` `null`, `pack_name` `"Opening balance"`, `valid_through` `null` and `expiring_soon` `false`.
  - `expiring_soon` is a boolean decided by the server when the response is made (Business rules).
- **Ledger movement**: `{"id","kind","booking_id","purchase_id","hours","created_at","actor","lots":[{"purchase_id","hours"}],"entries":[{"account","hours"},{"account","hours"}]}`.
  - `actor` is exactly `{"user_id","name","role"}` for a person, where `role` is `member` or `kitchen_manager`. It is `null` when the server made the change.
  - `lots` gives the lots the movement took hours from or put hours into, each with positive `hours`, in the order they were drawn or returned. It is `[]` for a movement that does not touch `available`.
- **Document**: `{"id","member_id","type","expiry_date","status","file_name","content_type","size_bytes","sha256","rejection_reason","created_at"}`.
  - `status` is `pending`, `verified` or `rejected`; `rejection_reason` is `null` unless rejected.
  - `file_name` is the display name from Server boundary.
  - `size_bytes` is the exact byte length of the uploaded file, and `sha256` is the lowercase 64-character hex SHA-256 of exactly those bytes.
- **Visit**: `{"id","truck_id","site_id","arrived_at","departed_at","services":[…],"operator_signature","manager_name","gap_hours","gap_flagged"}`. `gap_hours` is a number with two decimals, or `null` for a truck's first visit and for an open visit.
- **Inspector link**: `{"id","truck_id","inspector_email","url","expires_at","revoked_at","created_at","state"}`.
  - `url` is `<origin>/inspect/<token>`. `<origin>` is the server's own origin for the issuing request (Server boundary).
  - `<token>` is at least 128 random bits, URL-safe base64 encoded with no `=` padding, so it is made of letters, digits, `-` and `_` only.
  - `state` is `live`, `expired` or `revoked`.
- **Rate**: `{"id","effective_from","hourly_rate_cents","tax_rate_percent","state","created_at"}`. `state` is `current`, `upcoming` or `past`, judged on that site's own date.
- **Audit event**: `{"id","at","actor","action","target_type","target_id","outcome","address_prefix"}`, with every value as defined in Audit trail (Business rules).

**Endpoints.** The Roles column lists who may call each one. Everyone else gets 403.

| Method and path | Roles | Request | Success | Endpoint-specific errors |
|---|---|---|---|---|
| `GET /api/health` | public | — | `200 {"status":"ok"}` | `503 {"status":"starting"}` while the database is unreachable or the schema and seed are not yet in place |
| `POST /api/session` | public | `{"email","password"}`. `email` follows the email rule in Business rules; `password` is a string of 1 to 200 characters | `200` with the `/api/me` body, plus `Set-Cookie` for `pl_session` and `pl_csrf` | `422 validation` (`email`, `password`), `429 too_many_attempts` with `Retry-After`, `401 invalid_credentials` |
| `DELETE /api/session` | public | — | `204`, clearing both cookies; with a live session it also destroys that session | — |
| `GET /api/me` | any signed-in user | — | `200 {"user":{"id","name","email","role","tenant":{"id","name","legal_name"},"site_id"},"member":null or {"id","business_name","home_site_id","available_hours","committed_hours","valid_through":{"certificate_of_insurance","food_handler_certificate","business_licence"},"truck":null or {"id","name","permit_number"}}}`. `role` is `member`, `kitchen_manager` or `finance_lead`. `site_id` is the manager's site or the member's home site, and `null` for finance leads | — |
| `GET /api/sites` | all roles | — | `200 {"sites":[{"id","name","time_zone","address","local_now","local_date"}]}` covering the tenant's sites (only their own site for a manager). `local_now` is the site's wall time as `YYYY-MM-DDTHH:MM:SS` | — |
| `GET /api/sites/{site_id}/availability?date=` | member, kitchen_manager | — | `200 {"site_id","date","stations":[{"id","name","kind","sectors":[{"kind","start","end","booking_id"}]}]}`; see Availability rules below this table | `422 validation` (`date`) |
| `POST /api/bookings` | member | header `Idempotency-Key`; body `{"station_id","date","start","end"}` | `201 {"booking":<Booking held>,"balances":<Balances>}`. A replay returns the stored status and body with header `Idempotent-Replay: true` | `422 validation` (`Idempotency-Key` or a field), `409 idempotency_conflict`, `409 idempotency_in_progress`; rule refusals in this order: `422 certificate_expired`, `422 cutoff`, `422 hold_limit`, `422 insufficient_hours`; then `409 slot_taken` |
| `POST /api/bookings/{id}/confirm` | member (owner) | — | `200 {"booking":<Booking confirmed>,"balances"}` | `409 hold_expired`, `409 invalid_transition`, `422 certificate_expired` |
| `POST /api/bookings/{id}/cancel` | member (owner), kitchen_manager (booking's site) | member: —. kitchen_manager: `{"reason"}`, required, 3 to 300 characters after trimming | member: `200 {"booking":<Booking cancelled>,"refunded_hours","forfeited_hours","balances"}`. kitchen_manager: `200 {"booking":<Booking cancelled>,"refunded_hours","forfeited_hours"}` | `409 invalid_transition` (including a manager on a held booking and any cancel of an already cancelled booking), `422 validation` (`reason`) |
| `GET /api/bookings` | member | — | `200 {"bookings":[<Booking>…]}` with the caller's bookings, newest `created_at` first | — |
| `GET /api/bookings/{id}` | member (owner), kitchen_manager (own site) | — | `200 {"booking":<Booking>}` (this is the receipt) | — |
| `GET /api/sites/{site_id}/bookings?date=` | kitchen_manager (own site), finance_lead | — | `200 {"bookings":[<Booking>…]}` for that site-local date in every status, ordered by `start_at`, and bookings with the same `start_at` by `reference` ascending | `422 validation` (`date`) |
| `POST /api/recurring-series` | member | `{"station_id","first_date","start","end","weeks"}` with `weeks` an integer from 2 to 12 | `201 {"series":{"id","station_id","weekday","start","end","weeks"},"bookings":[<Booking confirmed>…],"balances"}`, bookings in date order | rule refusals in this order: `422 certificate_expired` with `dates`, `422 cutoff` (judged on `first_date`), `422 insufficient_hours` (judged on the total); then `409 series_conflict` with `dates` |
| `POST /api/bookings/{id}/check-in` | kitchen_manager (own site) | — | `200 {"booking":<Booking checked_in>}` | `409 too_early`, `409 too_late`, `409 invalid_transition`, `422 certificate_expired` |
| `POST /api/bookings/{id}/no-show` | kitchen_manager (own site) | — | `200 {"booking":<Booking no_show>}` | `409 too_early`, `409 invalid_transition` |
| `POST /api/bookings/{id}/check-out` | kitchen_manager (own site) | header `Idempotency-Key`; no body | `200 {"booking":<Booking checked_out>}` with `late_quarter_hours`, `pack_hours_applied`, `overage` and `checked_out_by` as defined in Business rules. A replay returns the stored body with header `Idempotent-Replay: true` | `422 validation` (`Idempotency-Key`), `409 idempotency_conflict`, `409 idempotency_in_progress`, `409 invalid_transition`, `503 billing_unavailable` |
| `GET /api/packs` | member, finance_lead | — | `200 {"packs":[{"id","name","hours","price_cents"}]}` | — |
| `POST /api/pack-purchases` | member | header `Idempotency-Key`; body `{"pack_id"}` | `201 {"purchase":{"id","pack_id","pack_name","hours","price_cents","valid_through","killbill_payment_id","created_at"},"balances"}`. A replay returns the same status and body with header `Idempotent-Replay: true` | `422 validation` (`Idempotency-Key`), `409 idempotency_conflict`, `409 idempotency_in_progress`, `503 billing_unavailable` |
| `GET /api/me/ledger` | member | — | `200 {"balances","movements":[<Ledger movement>…]}`, newest first | — |
| `POST /api/documents` | member | `multipart/form-data` with fields `type` (`certificate_of_insurance`, `food_handler_certificate` or `business_licence`), `expiry_date` and `file`. A certificate of insurance also requires `per_occurrence_limit` (whole dollars) and `names_additional_insured` (`true`). These two fields are listed only when `type` is `certificate_of_insurance`; sent with any other `type`, each is an unknown field under Closed bodies and answers `422 validation`, and nothing is stored | `201 {"document":<Document pending>}` | `415 unsupported_type`, `413 file_too_large`, `422 validation` (`type`, `expiry_date`, `file`, `per_occurrence_limit`, `names_additional_insured`, or an unknown form field), `503 storage_unavailable` |
| `GET /api/documents` | member (own), kitchen_manager (members homed at the site) | optional `?status=pending` | `200 {"documents":[<Document plus "business_name">…]}`, newest first, every status included unless filtered | — |
| `GET /api/documents/{id}` | member (owner), kitchen_manager (own site) | — | `200 {"document":<Document>}` | — |
| `GET /api/documents/{id}/file` | member (owner), kitchen_manager (own site) | — | `200` with the file's exact bytes and the headers in Server boundary, in every document status | `503 storage_unavailable` |
| `POST /api/documents/{id}/verify` | kitchen_manager (own site) | — | `200 {"document":<Document verified>,"valid_through":"<date>"}` | `409 invalid_transition`, `422 document_expired` |
| `POST /api/documents/{id}/reject` | kitchen_manager (own site) | `{"reason"}` with 3 to 300 characters | `200 {"document":<Document rejected>}` | `409 invalid_transition`, `422 validation` (`reason`) |
| `GET /api/members?q=` | kitchen_manager, finance_lead | `q` with at least 2 characters | `200 {"members":[{"id","business_name","contact_name","home_site_id","truck":null or {"id","name"}}]}`. At most 10 results, ordered by business name, from a case-insensitive literal substring match on business or contact name within the caller's tenant (and the manager's site) | `422 validation` (`q`) |
| `GET /api/trucks/{truck_id}/visits` | member (owner), kitchen_manager (truck's home site) | — | `200 {"truck":{"id","name","permit_number","member_id","business_name"},"visits":[<Visit>…],"last_departed_at","overdue"}`, visits newest first. `last_departed_at` and `overdue` follow Truck visits and gaps in Business rules | — |
| `POST /api/trucks/{truck_id}/visits` | kitchen_manager (truck's home site) | `{}` | `201 {"visit":<Visit open>}` with `arrived_at` set to now | `409 visit_open` |
| `POST /api/visits/{id}/depart` | kitchen_manager (visit's site) | `{"services":[…],"operator_signature"}`. `services` is a non-empty subset of `potable_water`, `grey_water`, `grease`, `food_storage`, `cleaning`, `restock`. `operator_signature` is 2 to 80 characters | `200 {"visit":<Visit>}` with `departed_at` set to now and the gap fields computed | `409 invalid_transition`, `422 validation` (`services`, `operator_signature`) |
| `GET /api/trucks/{truck_id}/inspector-links` | kitchen_manager (truck's home site) | — | `200 {"links":[<Inspector link>…]}`, newest first | — |
| `POST /api/trucks/{truck_id}/inspector-links` | kitchen_manager (truck's home site) | `{"inspector_email"}`, following the email rule in Business rules | `201 {"link":<Inspector link live>}` | `422 validation` (`inspector_email`), `503 storage_unavailable` |
| `POST /api/inspector-links/{id}/revoke` | kitchen_manager (truck's home site) | — | `200 {"link":<Inspector link revoked>}` | `409 invalid_transition` |
| `POST /api/inspector-links/{id}/reissue` | kitchen_manager (truck's home site) | — | `201 {"link":<new Inspector link live>,"replaced":<old link revoked>}` | `409 invalid_transition`, `503 storage_unavailable` |
| `GET /api/inspect/{token}` | public (token) | — | `200 {"truck":{"name","permit_number"},"operator":{"business_name"},"commissary":{"site_name","address","time_zone"},"expires_at","overdue","last_departed_at","visits":[{"arrived_at","departed_at","services","operator_signature","manager_name","gap_hours","gap_flagged"}]}`, visits newest first. Nothing else is included at any depth | `404 not_found` (unknown token), `410 link_expired`, `410 link_revoked` |
| `GET /api/inspect/{token}/log.pdf` | public (token) | — | `200 application/pdf`: the snapshot stored when this link was issued | `404` and `410` as above, `503 storage_unavailable` |
| any method other than GET on `/api/inspect/{token}` or below | public | — | — | `405 read_only` with header `Allow: GET` |
| `GET /api/sites/{site_id}/rates` | finance_lead | — | `200 {"rates":[<Rate>…]}`, ordered by `effective_from` | — |
| `POST /api/sites/{site_id}/rates` | finance_lead | `{"effective_from","hourly_rate_cents","tax_rate_percent"}`. `hourly_rate_cents` is an integer from 1 to 100000 inclusive. `tax_rate_percent` is a string from `"0"` to `"25"` inclusive with at most three decimals | `201 {"rate":<Rate>,"rates":[<Rate>…]}`, where `rates` is the site's whole schedule after the write, ordered by `effective_from` | `422 validation` (`effective_from`, `hourly_rate_cents`, `tax_rate_percent`, or an unknown field), `409 rate_exists` |
| `GET /api/reports/utilisation?month=&member_id=` | finance_lead | `month` as `YYYY-MM`; `member_id` optional, a member of the caller's tenant | `200 {"month","member":null or {"id","business_name"},"sites":[{"site_id","site_name","scheduled_hours","used_hours","forfeited_hours","overage_cents"}],"totals":{"scheduled_hours","used_hours","forfeited_hours","overage_cents"}}`, one row per tenant site, ordered by site name | `404 not_found` (`member_id` not a member of the tenant), `422 validation` (`month`) |
| `GET /api/reports/utilisation.csv?month=&member_id=` | finance_lead | as above | `200 text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="utilisation-<month>.csv"`. The header line is exactly `site_name,month,scheduled_hours,used_hours,forfeited_hours,overage_cents`. One row per site follows in the JSON order, then a final row whose `site_name` is `TOTAL`. Hours have two decimals and cents are integers | `404 not_found`, `422 validation` (`month`) as above |
| `GET /api/audit?since=` | kitchen_manager, finance_lead | `since` optional, a positive integer | `200 {"events":[<Audit event>…]}` within the caller's audit scope, with `id` greater than `since` when given, newest `id` first, at most 200 | `422 validation` (`since`) |

**Availability rules.**

- Stations come in seed display order. Station `kind` is `oven`, `mixer`, `blast_chiller` or `prep_table`.
- Sector `kind` is `booked`, `buffer`, `own_held`, `own_confirmed` or `nonexistent`.
  - For a member, their own live `held` booking is `own_held`, and their own `confirmed` or `checked_in` booking is `own_confirmed`. Every other member's live `held`, `confirmed` or `checked_in` booking is `booked`.
  - For a manager, every such booking is `booked`.
  - A held booking whose `hold_expires_at` has been reached appears in no sector.
  - Each of these bookings also has one `buffer` sector, including the member's own bookings. Its length is the sanitation buffer for the station's kind (Business rules).
- `booking_id` holds the booking's id on a member's own booking and buffer sectors, and, for a manager, on every booking and buffer sector. It is `null` on every other sector, including `nonexistent`. So for a member, another member's `booked` and `buffer` sectors are exactly `{"kind","start","end","booking_id":null}`.
- Sectors are ordered by `start`, then by `end`.

**Report definitions.**

- A booking belongs to the month that contains its site-local start date.
- `scheduled_hours` is the sum of the hours of bookings now `confirmed` or `checked_in`.
- `used_hours` is the sum of the `usage` and `late_checkout` ledger movements for bookings in the month.
- `forfeited_hours` is the sum of their `forfeit` movements, partial cancellation forfeits included. `pack_expiry` movements are never counted.
- `overage_cents` is the sum of their stored overage `total_cents`, tax included.
- With `member_id`, every figure covers only that member.
- The CSV and the JSON for the same query hold identical numbers.

### Business rules (DP-02, DP-04, DP-05, DP-07, DP-08, DP-11, DP-12, DP-14, DP-15, DP-17, DP-18, DP-19, DP-22, DP-24, DP-25, DP-26, DP-28, DP-29, DP-30, DP-32, DP-33, DP-37, DP-39, DP-41, DP-43, DP-44, DP-47, DP-48, DP-61, DP-62, DP-64, DP-66, DP-67, DP-68, DP-69, DP-71, DP-72, DP-73, DP-76, DP-77, DP-84, DP-91, DP-92, DP-97, DP-98)

**Server clock.**

- Every time rule reads the server clock, which `PILOTLIGHT_CLOCK_START` can set (Configuration and secrets). It has millisecond precision.
- "Site-local" means the wall clock in the site's IANA time zone.
- Client-supplied times, time zones and validity claims are ignored.
- The browser may show estimates of this clock, but every verdict is the server's.

**Sessions and sign-in.**

- **Credentials.** Sign-in matches the email case-insensitively. An unknown email and a wrong password for a known email answer the identical `401 invalid_credentials`: same status, same body byte for byte and the same header set apart from `Date`. No response reveals whether an email is registered.
- **Email rule** (sign-in and `inspector_email`): 3 to 254 characters, no whitespace, exactly one `@` with at least one character before it, and a part after it that contains a dot that is neither its first nor its last character.
- **Passwords** are stored only as salted hashes from argon2id or from bcrypt at cost 10 or more, in their standard encoded string form. No endpoint, body, log line or audit event carries a password or its hash.
- **Issuing a session.** A successful sign-in creates a new session with a fresh opaque `pl_session` value of at least 32 characters from a cryptographically secure source, and a fresh `pl_csrf` value of at least 32 characters. If the request carried a `pl_session` value, that value is dead from that instant, whoever it belonged to, and the new value is never equal to it.
- **Cookies.** `pl_session` carries `HttpOnly`, `Path=/` and `SameSite=Strict`. `pl_csrf` carries `Path=/` and `SameSite=Strict` and is readable by script (no `HttpOnly`). Both carry `Secure` exactly when the request arrived over TLS, and never otherwise. Cookie attribute names are case-insensitive on the wire, so a `Set-Cookie` header read in lower case carries `httponly`, `path=/`, `samesite=strict` and, over TLS, `secure`.
- **Idle limit.** A session whose last use was more than `SESSION_IDLE_SECONDS` earlier is expired. Every request on which the session is live counts as a use and refreshes that instant, including periodic reloads.
- **Absolute limit.** A session is expired `SESSION_ABSOLUTE_SECONDS` after its sign-in, however active it has been.
- **Sign-out.** `DELETE /api/session` with a live session destroys it server-side and clears both cookies. Without a live session it still answers `204` and clears the cookies, so sign-out is idempotent. A destroyed value answers `401 session_invalid` afterwards.
- **Cap.** A user has at most 3 live sessions. A sign-in that would make a fourth destroys that user's oldest live session, whose value then answers `401 session_invalid`.
- **Throttle.** A *failure* is a sign-in answered `401 invalid_credentials`; only failures are counted, and a refused `429` is not a failure. The window is `SIGN_IN_THROTTLE_WINDOW_SECONDS`.
  - When 5 failures for one email (case-insensitive) fall within the window, every further sign-in for that email answers `429 too_many_attempts`, even with the correct password, until the oldest of those failures leaves the window.
  - When 20 failures from one client address fall within the window, every further sign-in from that address answers `429 too_many_attempts`, for any email and any password, until the oldest of those failures leaves the window. The client address is the connection's peer address, with an IPv4-mapped IPv6 address counted as its IPv4 address; forwarding headers are ignored.
  - `Retry-After` gives the whole seconds, rounded up, until the throttle that applies ends, or the later end when both apply.
  - A successful sign-in clears that email's failures.
- **A refused write changes nothing.** A cancellation, check-out or pack purchase (or any write) answered `401` changes nothing, stores no idempotency record and is audited `refused_session`. The same request sent again after a new sign-in, with the new session and CSRF values (and, for a check-out or purchase, the same `Idempotency-Key`), is a new request: it is judged afresh on the state and the notice at its own commit, and produces at most the one email, invoice or charge its commit allows.
- No session or CSRF value appears in any response body, URL, served HTML or audit event.

**Booking windows.**

- A window lies on one site-local date.
- `start` and `end` fall on 15-minute boundaries (the booking step), `start` is before `end`, and `end` is at most `24:00`. Otherwise the answer is `422 validation`.
- The date must be at most 90 days after the site's current date, otherwise `422 validation` with field `date`.
- A booking's `hours` are the elapsed time from `start_at` to `end_at`.

**Missing and repeated local times.**

- A local time that does not exist on its date, because the clocks jump forward, moves forward by the length of the jump. In the seeded zones, 02:30 becomes 03:30.
- A local time that occurs twice, because the clocks fall back, means its first occurrence, in daylight time. For example, at Copperline Eastside on 2026-11-01 a 01:00–03:00 window runs from 05:00Z to 08:00Z and costs 3.00 hours.
- Availability reports a spring-forward day's missing hour as a `nonexistent` sector, and the dial does not let it be claimed.

**Sanitation buffer and overlap.** Each booking in status `confirmed` or `checked_in`, and each live held booking, occupies its station from `start_at` to `end_at` plus the sanitation buffer for that station's kind:

| Station kind | Sanitation buffer |
|---|---|
| `blast_chiller` | 45 minutes (defrost and sanitise) |
| `oven` | 30 minutes |
| `mixer` | 30 minutes |
| `prep_table` | 15 minutes |

- A new booking conflicts when its own occupied span overlaps any occupied span on the same station. Spans that only touch at an endpoint do not overlap.
- A buffer that runs past midnight appears on the next date's dial as a `buffer` sector starting at `00:00`.
- For example, take another member's Blast Chiller booking at 08:00–09:00. The chiller is occupied 08:00–09:45, so a hold for 09:30–10:00 answers `409 slot_taken` and a hold from 09:45 is accepted. The same booking on Prep Table A occupies 08:00–09:15, so a hold from 09:15 there is accepted.
- A new booking's own buffer counts too. Before that Blast Chiller booking, a hold for 06:00–07:15 is accepted, because its span ends at 08:00 and only touches the booking. A hold for 06:00–07:30 answers `409 slot_taken`, because its span runs to 08:15.

**Concurrency.**

- **Conflicting claims.** Of any set of conflicting claims or series on one station that arrive at the same time, exactly one is stored. Every other gets `409 slot_taken`, or `409 series_conflict` for a series, and leaves no booking and no ledger movement.
- **One member's requests** are decided one at a time, wherever they arrive. This covers holds, confirmations, cancellations, series and purchases. Each is judged against that member's balance, lots and live holds after every request that committed before it. So simultaneous claims by one member on different stations never take `available_hours` below zero and never leave more than 3 live holds.
- **One booking's transitions.** Two transitions on one booking that arrive at the same time, from the same person or different people, are decided the same way. One commits, and the other is judged against the new state by the booking state machine. So a booking's closing ledger movements and its cancellation email are written at most once.
- No endpoint edits an existing booking, rate, document, ledger entry or audit event in place, so requests carry no version numbers.

**Dial geometry.** The dial is a 24-hour ring of site-local wall time:

- 0° is 00:00, at the top;
- angles grow clockwise at 0.25° per minute;
- a booking step is 3.75°;
- 24:00 is 360°.

A sector's `data-start-deg` and `data-end-deg` are its start and end wall times converted this way. For example, 09:45 is 146.25°.

**Next-day cutoff.**

- A booking or series whose first date is on or before the site's current date is refused with `422 cutoff`.
- A booking for the site's next date is accepted only while the site's wall clock reads before 18:00:00. From 18:00:00 onward it is refused with `422 cutoff`.

**Insurance validity.** A member's certificate of insurance is valid through 23:59:59 on its valid-through date, in the time zone of the site being booked. A member with no valid-through date has no valid certificate.

- **Holds and confirmations** are accepted only when both of these hold, otherwise `422 certificate_expired`:
  - the certificate is valid now;
  - its valid-through date is on or after the booking's site-local date.
- **A series** is accepted only when the certificate is valid now and its valid-through date is on or after every occurrence date. Otherwise it answers `422 certificate_expired`, with `dates` listing every uncovered occurrence date (all of them when the certificate is not valid now), and nothing is booked.
- **Check-in** requires the certificate to be valid at the moment of check-in, otherwise `422 certificate_expired`.
- Food-handler and licence dates are shown and notified, but they do not block booking.
- For example, when Hana's valid-through date is 20 days after Copperline Highline's current date, a Highline hold on that 20th date is accepted, and a hold on the 21st date is refused.

**Rule order for a claim.** After validation, a claim is judged in this order:

1. certificate;
2. cutoff;
3. hold limit: a member may have at most 3 live holds across all sites. A fourth answers `422 hold_limit`;
4. pack hours: the claim's hours must not exceed `available_hours`, otherwise `422 insufficient_hours`;
5. overlap.

Series bookings are confirmed directly and do not count toward the hold limit. An idempotent replay is answered before any of these rules (Idempotency keys).

**Hold expiry instant.** A held booking's `hold_expires_at` is the instant its hold committed plus `HOLD_TTL_SECONDS`, to the millisecond. It is *live* while server now is before `hold_expires_at`, and *expired* from exactly that instant (server now at or after `hold_expires_at`); there is no grace band. From that instant, on every server process:

- its window is free: a claim on it by anyone is judged as if the hold did not exist;
- it no longer counts toward the hold limit, so a fourth hold placed at that instant is judged against the other holds only;
- confirm answers `409 hold_expired`, while one millisecond earlier it succeeds;
- its single `hold_release` movement (actor `null`, lots returned under the return order below) and its status `expired` are committed before any response reports that booking, that member's balances or ledger, that station's availability, or a claim decision that depends on the hold. It is written exactly once across all processes, whichever request or process notices it first.

**Booking state machine.**

| From | To | Who and when | Ledger movement and actor |
|---|---|---|---|
| (new) | `held` | member hold; `hold_expires_at` as in Hold expiry instant | `booking_debit`, the member |
| (new) | `confirmed` | member series occurrence | `booking_debit`, the member |
| `held` | `confirmed` | member, while the hold is live and the insurance rule passes | none |
| `held` | `cancelled` | the member only (Release hold), while the hold is live; full refund; sets `cancelled_by` to the member | `hold_release`, the member |
| `held` | `expired` | server, at `hold_expires_at` (Hold expiry instant) | `hold_release`, actor `null` |
| `confirmed` | `cancelled` | the member, or a kitchen manager of the booking's site with a reason; split by the forfeit window; sets `cancelled_by` and `cancellation_reason` | `cancel_refund` and/or `forfeit`, whoever cancelled |
| `confirmed` | `checked_in` | kitchen manager, from 15 minutes before `start_at` (inclusive) until `end_at` (exclusive), while the certificate is valid; sets `checked_in_by` | none |
| `confirmed` | `no_show` | kitchen manager, from 30 minutes after `start_at` (inclusive); sets `no_show_by` | `forfeit`, that manager |
| `checked_in` | `checked_out` | kitchen manager, any time; sets `checked_out_by` | `usage`, plus `late_checkout` when it applies, both by that manager |

- Confirming a held booking at or after its `hold_expires_at` answers `409 hold_expired`.
- Check-in before its window answers `409 too_early`, and check-in at or after `end_at` answers `409 too_late`. Inside the window, a lapsed certificate answers `422 certificate_expired`.
- A no-show before its time answers `409 too_early`.
- Every other transition answers `409 invalid_transition` and changes nothing. That includes:
  - any action on a booking in `checked_out`, `no_show` or `cancelled`, such as a member's cancel of a booking a manager has already cancelled;
  - a kitchen manager's cancel of a `held` booking;
  - a release of an expired hold;
  - a second check-out with a different key.
- On a booking already in `expired`, a confirm answers `409 hold_expired` (as above) and every other action answers `409 invalid_transition`.

**Who may cancel.**

- The member who owns a booking cancels with no body.
- A kitchen manager of the booking's site cancels only confirmed bookings and must give a reason.
- A manager's cancellation uses the same forfeit window as the member's and never waives a forfeit. It is attributed to that manager in both movements and in `cancelled_by`.
- The cancellation email names the site's staff, never the manager's email (Services).

**Forfeit window.** When a confirmed booking is cancelled, the notice is the elapsed real time from the moment the cancellation commits to `start_at`. The outcome is judged then, whatever a dialog last showed. Wall-clock differences are not used: across the autumn clock change, a booking whose start is 72 hours away on the wall clock is 73 elapsed hours away and is refunded in full.

| Notice | Outcome |
|---|---|
| 72 hours or more | Every quarter hour is refunded |
| 48 hours or more and under 72 hours | Half the booking's quarter hours, rounded up, are forfeited; the rest are refunded |
| Under 48 hours | Every quarter hour is forfeited |

- A held booking is always refunded in full.
- `refunded_hours` + `forfeited_hours` always equals the booking's `hours` exactly.
- A split writes two movements: one `cancel_refund` for the refunded hours and one `forfeit` for the forfeited hours.
- A movement of zero hours is never written. So a full refund writes only `cancel_refund`, and a full forfeit, or a split of a one-quarter-hour booking, writes only `forfeit`.
- For example, a 1.75-hour booking (7 quarter hours) cancelled 60 hours ahead forfeits 1.00 hour and refunds 0.75 hours. A 2.00-hour booking cancelled 60 hours ahead forfeits 1.00 and refunds 1.00.

**Hour ledger.**

- Each member has three accounts: `available`, `committed` and `expired`. The incubator has `pack_sales`, `opening_balance`, `used` and `forfeited`.
- Every change to a member's hours is one movement with exactly two entries. The source account gets `-hours` and the destination gets `+hours`, so each movement sums to zero.
- Movements and entries are never edited or deleted. A correction is always a further movement.
- `available_hours` and `committed_hours` are always the sums of the member's entries on those accounts, and are never negative.

| Kind | From → To | Ledger table label |
|---|---|---|
| `opening_balance` | opening_balance → available | "Opening balance" |
| `pack_purchase` | pack_sales → available | "Pack purchase" |
| `booking_debit` | available → committed | "Booking" |
| `hold_release` | committed → available | "Hold released" |
| `cancel_refund` | committed → available | "Cancellation refund" |
| `forfeit` | committed → forfeited | "Forfeit" |
| `usage` | committed → used | "Station time used" |
| `late_checkout` | available → used | "Late check-out" |
| `pack_expiry` | available → expired | "Pack hours expired" |

**Pack hour lots.**

- **Purchase lots.** Each pack purchase creates one lot holding the pack's hours. Its `valid_through` is the member's home site's local date when the purchase commits, plus 60 days. Its hours are usable through 23:59:59 home-site local on that date, whichever site they are spent at.
- **Opening lot.** Each member's opening balance is one lot with no valid-through date that never expires.
- **Sum.** `available_hours` always equals the sum of the member's lot remainders, and `balances.lots` lists the lots in drawing order.
- **Expiring soon.** A lot's `expiring_soon` is true exactly when its `valid_through` minus the member's home site's current date, at the moment the response is made, is from 0 to 14 days inclusive. It is always false for the opening lot. For example, a lot valid through 2026-11-10 is expiring soon from home-site date 2026-10-27 through 2026-11-10, and is not listed from 2026-11-11.
- **Drawing order.** Earliest `valid_through` first, ties by earlier purchase, the opening lot last. Every movement that takes hours out of `available` draws in this order: `booking_debit` (each series occurrence in date order) and `late_checkout`.
- **Return order.** Every movement that puts hours back into `available` (`hold_release` and `cancel_refund`) returns them only to the lots that booking drew from, up to what it drew from each, latest `valid_through` first. So the opening lot is refilled first of all. In a split cancellation, the refunded quarter hours are the ones returned this way, and the forfeited ones are the rest of what the booking drew.
- **Expiry.** From 00:00:00 home-site local on the day after a lot's `valid_through`, its remaining hours are expired, and no claim, check-out or response counts them as available from that instant.
  - Exactly one `pack_expiry` movement, actor `null`, takes them from `available` to `expired`, even with several server processes running.
  - It is in place before any response reports that member's balances or ledger, and in any case within 5 seconds of the expiry instant, so reported balances always equal the entry sums.
- **Returns into an expired lot.** Hours returned into a lot that has already expired, by a cancellation refund or a hold release (including a hold's own expiry), are followed in the same commit by one `pack_expiry` movement of those hours. So `available_hours` ends unchanged.
- **Committed hours** never expire. Hours a booking drew stay committed until they are used, forfeited, released or refunded.
- Pack expiry sends no email.

For example, Rosa buys Production 30 on home-site date D, so `lots` is Production 30 with 30.00 hours valid through D+60, then Opening balance with 12.00 hours. A 2.00-hour hold then draws all 2.00 hours from Production 30, because that lot expires first; `lots` on its `booking_debit` is Production 30, 2.00.

Later, for example, her Production 30 lot has only 1.00 hour left and her opening lot still holds 12.00 hours. A 4.00-hour booking draws 1.00 from Production 30 and 3.00 from the opening lot. Cancelled 60 hours ahead, it refunds 2.00 hours, all into the opening lot (which it drew 3.00 from and which is refilled first), and forfeits the other 2.00.

**Attribution.** Each movement's `actor` is fixed when the movement is written and never changes.

- It is the member for holds, confirmations, their own cancellations, releases, series and purchases.
- It is the acting kitchen manager for that manager's cancellations, for no-show forfeits, and for the check-out `usage` and `late_checkout` movements.
- It is `null` for opening balances, hold expiry and pack expiry, even when the expiry is noticed while serving another user's request.

The booking's `cancelled_by`, `cancellation_reason`, `checked_in_by`, `no_show_by` and `checked_out_by` are likewise fixed when the transition commits.

**Weekly series.**

- Occurrence *k* (0 to `weeks`−1) falls on `first_date` plus 7×*k* days, at the same `start` and `end` wall times, resolved by the missing-and-repeated rule. Each occurrence costs its own elapsed hours.
- For example, at Copperline Eastside a Tuesday 05:00–09:00 series starting 2026-10-27 runs from 09:00Z before the autumn change and from 10:00Z after it, at 4.00 hours every week.
- Every occurrence must pass validation and the 90-day horizon. A `first_date` past the horizon answers `422 validation` with field `first_date`, and any later occurrence past it answers `422 validation` with field `weeks`.
- The insurance rule is judged on every occurrence. The cutoff is judged as for a hold on `first_date`, and the total hours must not exceed `available_hours`.
- If any occurrence overlaps an occupied span, nothing is booked and the dates of the conflicting occurrences are returned.

**Idempotency keys** (holds, pack purchases and check-outs).

- **Scope.** Keys are scoped to the caller: the member for holds and purchases, and the kitchen manager for check-outs. The same key from two callers never interacts.
- **Binding.** A key is bound to its request's method and path, plus:
  - for a hold, the body's `station_id`, `date`, `start` and `end`;
  - for a purchase, the `pack_id`;
  - for a check-out, the booking in the path.
- **In flight.** From the moment a request with a key starts until it answers, another request with that key answers `409 idempotency_in_progress` when it is the same request, and `409 idempotency_conflict` when it is a different one.
- **What is stored.** Only a success is stored for replay: `201` for a hold or purchase, `200` for a check-out. Every refusal leaves the key free, so the next request with it is judged afresh as a new request. Refusals include `slot_taken`, `hold_limit`, `cutoff`, `certificate_expired`, `insufficient_hours`, `validation`, a state conflict and a `503`.
- **Replay.** Repeating the same request with a stored key returns the stored status and body with `Idempotent-Replay: true`, before any state, rule or contention check.
  - A replay writes no booking, movement, charge, invoice or email, never calls Kill Bill and never counts toward the hold limit.
  - Its body stays exactly as stored. That holds even after the hold has been confirmed, released or expired, while the member holds 3 other windows, while billing is unreachable, and on another server process sharing the database.
- **Conflict.** The same key on a different request after a stored success answers `409 idempotency_conflict` and changes nothing.
- **Parallel requests.** N simultaneous requests with one key produce at most one effect. Each answers with the success, its replay or `409 idempotency_in_progress`, never `slot_taken` or `hold_limit`.
- In every case, each key yields at most one booking and one `booking_debit`, one charge, one credit, one receipt and one invoice.

**Pack purchase.** Purchases are all-or-nothing.

- A purchase completes only when Kill Bill has accepted the charge. The lot, the ledger credit and the receipt email are then recorded together.
- If the charge is refused or Kill Bill is unreachable, nothing is stored and the answer is `503 billing_unavailable`.
- If the credit cannot be stored after the charge is accepted, the charge is refunded in Kill Bill before the request answers.

**Late check-out and overage.**

- **Lateness** is the whole minutes from `end_at` to check-out, with seconds dropped. Zero or fewer minutes means no lateness.
  - With no lateness, `late_quarter_hours` and `pack_hours_applied` are both 0, and `overage` is `null`.
  - Otherwise `late_quarter_hours` is the lateness divided by 15, rounded up.
- **Pack hours applied.** The late hours (`late_quarter_hours` × 0.25) are drawn from `available_hours` first, up to the balance, in lot drawing order. The hours drawn become `pack_hours_applied`. When `pack_hours_applied` is more than 0, it is recorded as one `late_checkout` movement. When it is 0, no `late_checkout` movement is written.
- **Overage.** Any remaining quarter hours are overage. With no overage quarter hours, `overage` is `null`.
- **Rate resolution.** The rate is looked up when the check-out commits, never earlier, from the site's rate schedule as it stands at that moment.
  - It is the rate with the latest `effective_from` on or before the booking's site-local start date.
  - So a rate scheduled after the booking was held, but effective on or before its start date, applies.
  - A rate effective after the start date never applies, even when the check-out happens after that rate takes effect.
  - Nothing about the rate is fixed at hold or confirm time.
- **Amount.**
  - The exact subtotal is `quarter_hours × hourly_rate_cents ÷ 4`.
  - The exact tax is that exact subtotal × `tax_rate_percent` ÷ 100.
  - Rounding happens once, at the line stage: the subtotal and the tax are each rounded half up to whole cents from their exact values.
  - `total_cents` is the rounded subtotal plus the rounded tax.
- **Stored once.** The overage is computed once at check-out and stored with the rate it used (`hourly_rate_cents` and `tax_rate_percent`). It is never recomputed, whatever rates are scheduled later.
- **Invoice id.**
  - When `total_cents` is 0 (possible only at very low rates), the overage is still stored, Kill Bill is not called, and `killbill_invoice_id` is `null`.
  - Otherwise `killbill_invoice_id` holds the id of the committed invoice from Services, and the check-out commits only after Kill Bill reports that invoice committed.
  - Each booking has at most one overage invoice, whatever keys are used.
- **Usage.** The `usage` movement always moves all of the booking's committed hours to `used`, however early the member leaves.

For example, with the base seed rates:

| Member's available hours | Booking site | Overage quarter hours | Subtotal | Tax | Total |
|---|---|---|---|---|---|
| 0.00, checked out 72 minutes late | Copperline Eastside | 5 | 5,313 cents | 471 cents | 5,784 cents ($57.84) |
| 0.00 | Copperline Highline | 1 | 950 cents | 73 cents | 1,023 cents ($10.23) |

Two more examples:

- A Copperline Eastside booking starts on date S. Afterwards, two rates are scheduled: 5000 cents with tax "10" from S−1, and 6000 cents with tax "12" from S+1. Checked out with 3 overage quarter hours, it uses 5000 and "10": subtotal 3,750 cents, tax 375 cents, total 4,125 cents.
- A booking from 23:00 to 24:00 on the day before a new rate's `effective_from`, checked out after midnight, uses the old rate.

**Rates.**

- Each site's dates are judged on that site's own local date, never UTC or another site's date. For example, at 06:00Z on a winter day, Copperline Eastside's date is already X while Copperline Highline's is still the day before. So `effective_from` X is refused at Eastside and accepted at Highline, where it is `upcoming`.
- `effective_from` must be after the site's current date, otherwise `422 validation`.
- A site cannot have two rates with the same `effective_from` (`409 rate_exists`).
- Rates are never edited or deleted.
- A rate's state is one of these:
  - `current`: it is the latest rate with `effective_from` on or before the site's date;
  - `upcoming`: it starts later than the site's date;
  - `past`: any other rate.

**Documents and valid-through dates.**

- Uploads start as `pending`. A manager can move `pending` to `verified` or `rejected`, and any other review answers `409 invalid_transition`.
- Verifying a document whose `expiry_date` is before its member's home site's current date answers `422 document_expired`.
- For each document type, a member's valid-through date is the latest `expiry_date` among their verified documents of that type, or the seeded date if that is later.
- A certificate of insurance upload requires `per_occurrence_limit` of at least 1,000,000 and `names_additional_insured` equal to `true`.
- **Stored as submitted.** A document's file is kept exactly as the member uploaded it: no re-encoding, text decoding, line-ending change, image processing, metadata stripping, trimming or padding. Its `sha256` and `size_bytes` are computed from those exact bytes. The stored object, every download and the `ETag` match them for as long as the document exists.
- A document row is committed only after storage has confirmed its object as described in Services.
- A review changes only a document's `status` and `rejection_reason`. No later upload, by the same member or anyone else, changes an earlier document's row or object, and documents are never deleted. Rejected and superseded documents stay openable by their member and by the kitchen managers of the member's home site.

**Expiry notices.** At least every 30 seconds, the server takes each member's home site's current date. For each document type with a valid-through date, it works out the days left: the valid-through date minus that date.

- When 4 to 14 days are left, it sends the 14-day notice, unless that notice has already been sent for that member, type and valid-through date.
- When 0 to 3 days are left, it sends the 3-day notice under the same once-only rule.
- A later valid-through date, once verified, makes both notices due again for the new date.

**Truck visits and gaps.**

- A truck has at most one open visit, meaning a visit without `departed_at` (`409 visit_open`). Departing an already departed visit answers `409 invalid_transition`.
- A visit's `gap_hours` is the time from the previous visit's `departed_at` to its own `departed_at`, in hours, rounded half up to two decimals from the two `departed_at` values this API returns.
- `gap_flagged` is true only when that gap is more than 24 hours, so exactly 24.00 is not flagged.
- `last_departed_at` is the latest `departed_at` among the truck's visits, or `null` when it has none.
- **Overdue.** `overdue` is worked out afresh on every visits request (`GET /api/trucks/{truck_id}/visits` and `GET /api/inspect/{token}`) from the server clock at that moment. It is true only when server now minus `last_departed_at` is strictly more than 24 hours. So it is false at exactly 24:00:00 after the departure, and true from one second later.
  - It is false when `last_departed_at` is `null`.
  - An arrival alone does not clear it. The next recorded departure makes it false, because that departure becomes `last_departed_at`.
  - No stored flag, scheduled job or client claim decides it.

**Inspector links.**

- A link is live while now is before `expires_at` (issue time + `INSPECTOR_LINK_TTL_SECONDS`) and `revoked_at` is null.
- From `expires_at` onward the token answers `410 link_expired`. Once revoked, it answers `410 link_revoked` at once.
- Reissuing revokes the old link and creates a new one for the same inspector email, with a fresh token, a fresh expiry and a fresh snapshot.
- Revoking or reissuing a link that is not live answers `409 invalid_transition`.
- Issuing and reissuing are all-or-nothing across the PDF snapshot, the link record and the email.
- The snapshot holds every visit of the truck as of issue time. The JSON view always shows the current visits.

**What inspector copies may carry.** The inspector view, the visit-log PDF and the inspector email are copies that leave the incubator.

They carry only these fields:

- the truck name and permit number;
- the operator's business name;
- the commissary site name, address and time zone;
- for each visit, its site-local arrival and departure, services, operator signature, manager name and gap flag;
- for the view only, the overdue verdict and last departure;
- for the email only, the link URL and its expiry.

They never carry any of these:

- any user's email address, the manager's and the member's included;
- the member's contact name, except where it is the typed operator signature;
- pack hours, balances or the words "pack hours";
- booking references;
- document data;
- internal ids or anything shaped like a UUID;
- any other truck's or member's data;
- any other inspector link's token or email.

**Roles and tenant scope.**

- Every query, total, search, export, file and audit read is limited to the caller's tenant.
- A kitchen manager is further limited to their site: bookings at that site, and the members, documents and trucks of members homed there.
- A member is limited to their own bookings, ledger, documents and truck.
- A finance lead sees every site of their tenant, but not documents, files or member balances.
- A caller whose role may use an endpoint, but whose scope excludes the id, gets the same `404 not_found` as for an unknown id. A caller whose role may not use the endpoint gets `403 forbidden` first, whatever the id. Both steps are in the API precedence.
- Every role and scope rule is enforced by the server on every request; the navigation a role sees never decides access.

**Audit trail.**

- **One event per attempt.** Every POST, PUT, PATCH or DELETE request to a path under `/api` appends exactly one audit event, in the same commit as its effect when it has one, whatever its answer. A replay served from the idempotency store appends one event whose outcome is `allowed`. GET requests append nothing.
- **`id`** is a positive integer; ids strictly increase in the order events are written. **`at`** is the server clock when the request was answered.
- **`actor`** is exactly `{"user_id","name","role"}` of the signed-in caller, with `role` `member`, `kitchen_manager` or `finance_lead`. It is `null` for a sign-in attempt that did not succeed, a request without a live session, and a request under an inspector token.
- **`action`** is the request method, a space and the endpoint's path pattern exactly as written in the endpoint table, for example `POST /api/bookings/{id}/cancel` or `POST /api/inspect/{token}`. A path that matches no pattern gives `<METHOD> unknown`.
- **`target_type` and `target_id`.** On a success that creates a record, they name it: `booking`, `series`, `purchase`, `document`, `visit`, `inspector_link` (the new link on a reissue) or `rate`, with its id. Otherwise they name the record of the path's last id parameter (`booking`, `document`, `truck`, `visit`, `inspector_link` or `site`), with `target_id` equal to that path value when it has the id shape and `null` otherwise. Sign-in and sign-out give `session` with `target_id` `null`. Inspector token paths give `inspector_link` with `target_id` `null`. Anything else gives `null` for both.
- **`outcome`** follows the answer: a 2xx answer is `allowed`; `401` is `refused_session`; `403 csrf_failed` and `403 cross_origin` are `refused_csrf`; `429` is `refused_rate`; `403 forbidden` and `405` are `refused_role`; `404` and `410` are `refused_scope`; `413`, `415` and `422` are `refused_validation`; `409` is `refused_conflict`; and a 5xx answer is `failed_dependency`.
- **`address_prefix`** is the client's IPv4 address (as defined for the throttle) with its last octet replaced by `0`, for example `127.0.0.0`, or `null` for a peer that is IPv6 only. No full address is stored.
- **Scope.** An event belongs to a tenant through its *subject user*: the signed-in caller; for a refused sign-in, the user with that email when one exists; for a refused session, the user the presented session belonged to. Events under an inspector token belong to the token's tenant and the truck's home site. An event with no subject user and no token tenant belongs to no tenant and is never listed.
  - A finance lead reads every event of their tenant.
  - A kitchen manager reads the events whose subject user is a kitchen manager of their site or a member homed there, plus token events for trucks homed at their site.
- **Append-only.** No endpoint edits or deletes an event, and a later read never shows a different `at`, `actor`, `action`, target or `outcome` for the same id.
- No event carries a password, password hash, session value, CSRF value, inspector token or configured secret.

### Services (DP-18, DP-22, DP-26, DP-34, DP-39, DP-54, DP-60, DP-62, DP-64, DP-67, DP-68, DP-77, DP-79, DP-87)

**PostgreSQL** (`DATABASE_URL`) is the only store for sites, stations, users, sessions, sign-in failures, bookings, the ledger and its lot allocations, rates, document metadata, visits, links, idempotency records, audit events and the email outbox.

- On every start, the app creates any missing schema. When the database holds no tenants, it also inserts the base seed data and, when `PILOTLIGHT_SEED_SET` names a seed set, that set's records (Seed data), all in one transaction.
- When several server processes start on one empty database at the same time, exactly one of them inserts the seed, and every process then serves the same records.
- Several server processes may share one database at once, the outage instances included. Every rule here holds across them: concurrency, idempotent replays, exactly-once emails, the hold expiry instant, pack expiry, sessions and throttles, the audit trail and the notice scan.

**Kill Bill** (`KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`).

- **Accounts.** Each member who buys a pack or incurs overage has one Kill Bill account. The app looks the account up by its external key before creating one and reuses the account Kill Bill already holds, creating it only when that lookup finds none, so a member Kill Bill already knows is never refused a second account and a first check-out or purchase for that member still succeeds. The account has:
  - external key equal to the member's `id`;
  - name equal to the business name;
  - the member's email;
  - currency USD;
  - Kill Bill's built-in external payment method as its default.
- **Pack purchases.** A pack purchase is one payment on that account, with a PURCHASE transaction for the pack's price in USD (cents ÷ 100).
  - The payment external key and the transaction external key both equal the purchase `id`.
  - `killbill_payment_id` is that payment's id.
- **Overage invoices.** An overage whose `total_cents` is above 0 is one invoice on that account.
  - It holds exactly one item, of type `EXTERNAL_CHARGE`, whose amount equals `total_cents` ÷ 100 in USD, so the invoice's amount equals the total to the cent.
  - The item's description is `Overage <reference>: <quarter_hours> quarter hours at $<hourly rate>/h plus <tax_rate_percent>% tax`. Here `<reference>` is the booking reference, `<quarter_hours>` is the overage quarter hours as an integer, `<hourly rate>` uses the money format from Feedback states, and `<tax_rate_percent>` is the stored string.
  - **Committed, never draft.** Kill Bill creates external-charge invoices as drafts unless told otherwise. The overage counts only once Kill Bill reports the invoice with status `COMMITTED`: a draft is committed before the check-out commits, and the check-out never stores or returns the id of a draft.
  - After a successful check-out, Kill Bill holds for that account exactly one invoice for the booking that is not void, with status `COMMITTED`, the amount above and the one item above. `killbill_invoice_id` is that invoice's id.
  - **Failure after creation.** If any Kill Bill step fails after an invoice for the check-out was created, the app voids that invoice in Kill Bill before answering `503 billing_unavailable`. So no draft, committed or extra invoice for the booking survives a failed check-out.
  - A booking never has more than one non-void overage invoice.
- **Outage.** When Kill Bill is unreachable or returns an error:
  - a pack purchase answers `503 billing_unavailable` and records nothing;
  - a first check-out with overage money answers `503 billing_unavailable`, and the booking stays `checked_in` with no movements and no stored key;
  - a check-out without overage money never calls Kill Bill and succeeds;
  - a replay of a stored check-out or purchase succeeds.

  UI copy is in Feedback states.

**MinIO / S3** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). The bucket already exists and stays private. The app creates no other buckets.

- **Documents.** Document objects use the key `documents/<tenant_id>/<member_id>/<document_id>`, where every part is server-generated. Each object holds exactly the uploaded bytes and is written with:
  - `Content-Type` equal to the detected type;
  - user metadata `sha256` (sent as `x-amz-meta-sha256`) equal to the document's lowercase hex `sha256`;
  - user metadata `document-id` (sent as `x-amz-meta-document-id`) equal to the document's id.
- **Storage confirmation.** A document row is committed only after storage acknowledges the PUT and a HEAD of the object's key reports `Content-Length` equal to `size_bytes`, `Content-Type` equal to the detected type, and `sha256` and `document-id` metadata equal to the row's. On any mismatch or storage error the app deletes the object and answers `503 storage_unavailable`, leaving no row and no object.
- An object is written once and never overwritten or deleted while its row exists.
- **Visit-log snapshots.** Snapshots use the key `visit-logs/<tenant_id>/<truck_id>/<link_id>.pdf`, with content type `application/pdf`. Each is a valid PDF whose text is drawn in a standard PDF font, so it can be extracted, never as an image. It lists, in this order:
  1. the truck name and permit number;
  2. the operator business;
  3. the commissary site, address and time zone;
  4. every visit, newest first, one per line or block, with its site-local arrival and departure, service labels, operator signature, manager name and the Gap cell text from Public screens and controls.

  It carries nothing else, under the rule in Business rules.
- **Row and object together.** A document row and its object exist together or not at all, and the same holds for a link and its snapshot. If the metadata write fails after the object is stored, the object is deleted before the request answers.
- **Outage.** When storage is unreachable:
  - uploads, link issues and reissues answer `503 storage_unavailable` and leave nothing behind;
  - file and PDF downloads answer `503 storage_unavailable`;
  - everything else keeps working.

  UI copy is in Feedback states.

**Mailpit / SMTP** (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`).

- **Headers.** Every message carries no header other than `From`, `To`, `Subject`, `Date`, `Message-ID`, `MIME-Version`, `Content-Type` and `Content-Transfer-Encoding`, and no header value contains a stored cancellation reason, rejection reason or operator signature. So a stored reason or signature that holds a carriage return, a line feed or a line shaped like `Subject: …` adds or changes no header: the delivered `Subject` is exactly the published one for that notice, and the value appears only in the body, with its line breaks kept.
- Every message is sent from `MAIL_FROM`, which is `Pilotlight <tickets@pilotlight.example>` in every environment. Each carries a plain-text body holding the lines its row below lists.
- Each message is written to an outbox in the same database transaction as its event, and delivered within 10 seconds. If SMTP is briefly unreachable, delivery retries until it succeeds.
- Each event produces exactly one message, never two, even on request replays, simultaneous cancellations or with several server processes running.

Every event that sends a message is in this table:

| Event | To | Subject | Body includes |
|---|---|---|---|
| A held booking is confirmed | member | `Booking confirmed: <station>, <date> <start>-<end>` | site, reference, hours, available hours after |
| A weekly series is booked | member | `Weekly booking confirmed: <station>, <weekday>s <start>-<end>, <n> weeks` | every occurrence date, total hours |
| A confirmed booking is cancelled, by the member or a kitchen manager | member | `Booking cancelled: <station>, <date> <start>-<end>` | `Refunded pack hours: <refunded hours>` and `Forfeited pack hours: <forfeited hours>`. A kitchen manager's cancellation also has the line `Cancelled by <site name> staff. Reason: <reason>`, and never any staff email address |
| A pack purchase completes | member | `Receipt: <pack name> (<hours> pack hours)` | amount `$<price>`, purchase id, `Valid through <date>` (the lot's valid-through date), available hours after |
| An expiry notice is due | member | `<type label> expires <date> (14-day notice)` or `<type label> expires <date> (3-day notice)` | valid-through date, upload reminder |
| An inspector link is issued or reissued | the inspector email | `Commissary visit log: <truck name>` | only the truck name, the commissary site name, the link URL, and its expiry as site-local date and time with the site's time zone |

Every other event sends no email, including releasing a hold, hold expiry, pack expiry, check-in, check-out, no-show, document review, visits, a truck turning overdue, revoking a link, rate changes, sign-in throttling and session events. `<type label>` is "Certificate of insurance", "Food handler certificate" or "Business licence".

### Seed data (DP-51, DP-48, DP-47, DP-15, DP-25, DP-28, DP-29, DP-32, DP-33, DP-34, DP-44, DP-62, DP-68, DP-71, DP-72, DP-73, DP-75, DP-76, DP-78, DP-79, DP-83, DP-85, DP-86, DP-88, DP-90, DP-92)

Every seeded person, business, truck, address and incubator is invented. Every seeded user's password is `pilot-light-demo`, stored under the password rule in Business rules.

The base seed below is always inserted. In the base seed there are no bookings, documents, purchases, inspector links, sessions or audit events, no Kill Bill accounts and no stored objects. The seed sets at the end of this section add bookings, rates and one purchase only when `PILOTLIGHT_SEED_SET` chooses them.

**Tenant 1: Copperline Kitchen Collective** (legal name "Copperline Kitchen Collective, Inc.")

| Site | Time zone | Address | Stations in display order (kind) | Rate from 2026-01-01 |
|---|---|---|---|---|
| Copperline Eastside | America/New_York | 410 Foundry Row, Port Avery | Deck Oven 1 (oven), Convection Oven 2 (oven), Spiral Mixer 60 qt (mixer), Blast Chiller (blast_chiller), Prep Table A (prep_table) | 4250 cents/h, tax "8.875" |
| Copperline Highline | America/Denver | 88 Mesa Spur, Highline Junction | Rack Oven (oven), Planetary Mixer 40 qt (mixer), Blast Chiller H1 (blast_chiller), Prep Table H (prep_table) | 3800 cents/h, tax "7.65" |

Packs: "Starter 10" (10 hours, 25000 cents) and "Production 30" (30 hours, 66000 cents).

| Name | Email | Role | Site / home site | Business | Opening hours | Insurance / food handler / licence valid through | Truck |
|---|---|---|---|---|---|---|---|
| Dana Okafor | dana@copperline.example | kitchen_manager | Copperline Eastside | — | — | — | — |
| Luis Arrieta | luis@copperline.example | kitchen_manager | Copperline Highline | — | — | — | — |
| Priya Raman | priya@copperline.example | finance_lead | — | — | — | — | — |
| Rosa Lindqvist | rosa@lindqvist.example | member | Copperline Eastside | Lindqvist Hearth Bakery | 12.00 | 2027-06-30 / 2027-08-31 / 2027-12-31 | — |
| Ade Okonjo | ade@okonjo.example | member | Copperline Eastside | Okonjo Small Batch | 10.00 | 2027-05-31 / 2027-05-31 / 2027-12-31 | — |
| Theo Mbeki | theo@mbekismoke.example | member | Copperline Eastside | Mbeki Smoke Truck | 6.00 | 2027-04-30 / 2027-04-30 / 2027-12-31 | "Smoke Signal", permit "MFU-2291" |
| Hana Sato | hana@satopatisserie.example | member | Copperline Highline | Sato Patisserie | 8.00 | 2026-09-30 / 2027-03-31 / 2027-12-31 | — |

Each member's opening hours are one `opening_balance` movement with actor `null`, filling that member's opening lot. A member's contact name is that member's Name in this table.

For example, with the seed data at start:

- Rosa's 12.00 opening hours cover a six-week Tuesday 05:00–06:30 series on Deck Oven 1 (9.00 hours, 1.50 each week), and a four-week one (6.00 hours).
- With the server clock at 2026-10-23T14:00:00Z, Rosa's Repeat weekly preview for a Deck Oven 1 window 01:00–03:00 on 2026-10-25 shows "2026-10-25 01:00–03:00 · 2.00 h" and "2026-11-01 01:00–03:00 · 3.00 h" for 2 weeks with "Uses 5.00 pack hours" and "Pack hours after this series 7.00"; 4 weeks, the preview shown as soon as the dialog opens, show "Uses 9.00 pack hours" and "Pack hours after this series 3.00"; and 6 weeks show "Uses 13.00 pack hours" and "Not enough pack hours for 6 weeks.". Booking 4 weeks stores bookings of 2.00, 3.00, 2.00 and 2.00 hours.
- Member search by Priya for "sa" returns Lindqvist Hearth Bakery (contact name "Rosa Lindqvist") and Sato Patisserie, in that order; "sat" returns only Sato Patisserie; "sm" returns Mbeki Smoke Truck and Okonjo Small Batch.

Smoke Signal's visits at Copperline Eastside, in site-local times, all with manager Dana Okafor and operator signature "Theo Mbeki":

1. Arrived 2026-10-20 19:30, departed 2026-10-20 22:00. Services: potable_water, grey_water, cleaning. First visit, no gap.
2. Arrived 2026-10-21 20:00, departed 2026-10-21 21:30. Services: grey_water, restock. Gap 23.50 h, not flagged.
3. Arrived 2026-10-23 06:00, departed 2026-10-23 07:00. Services: potable_water, food_storage. Gap 33.50 h, flagged.

For example, with the seed data at start, Smoke Signal's `last_departed_at` is `2026-10-23T11:00:00.000Z`. Its `overdue` is false while the server clock is at or before 2026-10-24T11:00:00Z, and true after that, and the notice then reads "Overdue: last return 2026-10-23 07:00".

**Tenant 2: Fernhollow Food Works** (legal name "Fernhollow Food Works Cooperative")

| Site | Time zone | Address | Stations in display order (kind) | Rate from 2026-01-01 |
|---|---|---|---|---|
| Fernhollow Commissary | America/Los_Angeles | 7 Cedar Siding, Fernhollow | Hearth Oven F1 (oven), Mixer F2 (mixer), Blast Chiller F3 (blast_chiller), Prep Table F4 (prep_table) | 4500 cents/h, tax "9.25" |

Pack: "Bake 20" (20 hours, 46000 cents).

| Name | Email | Role | Site / home site | Business | Opening hours | Insurance / food handler / licence valid through | Truck |
|---|---|---|---|---|---|---|---|
| Ines Calder | ines@fernhollow.example | kitchen_manager | Fernhollow Commissary | — | — | — | — |
| Marco Vitale | marco@fernhollow.example | finance_lead | — | — | — | — | — |
| Rosalind Park | rosalind@parkstreetpies.example | member | Fernhollow Commissary | Park Street Pies | 9.00 | 2027-06-30 / 2027-06-30 / 2027-12-31 | — |
| Rory Delacroix | rory@delacroix.example | member | Fernhollow Commissary | Delacroix Dumpling Truck | 5.00 | 2027-06-30 / 2027-06-30 / 2027-12-31 | "Steam Engine", permit "MFU-8820" |

Steam Engine has one visit at Fernhollow Commissary: arrived 2026-10-22 08:00, departed 2026-10-22 09:15. Services: potable_water, grey_water. Manager Ines Calder, operator signature "Rory Delacroix".

For example, with the base seed and the server clock started at 2026-10-26T21:58:30Z (17:58:30 at Copperline Eastside, 15:58:30 at Copperline Highline):

- an Eastside hold for 2026-10-27 is accepted before 2026-10-26T22:00:00Z and refused with `cutoff` from that instant, while a Highline hold for 2026-10-27 is still accepted until 2026-10-27T00:00:00Z;
- an Eastside weekly series of Tuesdays 05:00–09:00 starting 2026-11-03 or later stays at 05:00–09:00 site time and 4.00 hours every week, and a series starting 2026-10-27 (while still before the cutoff) crosses the 2026-11-01 clock change as in Business rules.

**Seed sets.** `PILOTLIGHT_SEED_SET` may name one of the two sets below. Each adds its records to Copperline Kitchen Collective when the seed is inserted, and changes nothing else in the base seed except where a set says so. The examples for each set describe a server started fresh under Fresh starts in Deployment, so every listed booking, lot and edge is still in its seeded state when a check begins.

- Every added booking has `series_id` `null`. Its `booking_debit` movement is written at the booking's `created_at` with the member as actor, and draws from the member's lots under the lot rules in Business rules.
- Times in the tables are site-local.
- An added booking in status `checked_in` has `checked_in_at` and `checked_in_by` as listed.

**Seed set `site-day`.**

Rates added at Copperline Eastside, after the base rate:

| Effective from | Hourly rate | Sales tax | `created_at` |
|---|---|---|---|
| 2026-11-09 | 5000 cents | "10" | 2026-11-07T15:00:00Z |
| 2026-11-11 | 6000 cents | "12" | 2026-11-07T15:05:00Z |

Bookings added, each with `created_at` 2026-11-05T14:00:00Z:

| Reference | Member | Site | Station | Date | Window | Hours | Status |
|---|---|---|---|---|---|---|---|
| PL-SD0001 | Rosa Lindqvist | Copperline Eastside | Deck Oven 1 | 2026-11-10 | 09:00–11:00 | 2.00 | confirmed |
| PL-SD0002 | Ade Okonjo | Copperline Eastside | Spiral Mixer 60 qt | 2026-11-10 | 08:15–09:15 | 1.00 | confirmed |
| PL-SD0003 | Ade Okonjo | Copperline Eastside | Prep Table A | 2026-11-10 | 06:00–07:00 | 1.00 | confirmed |
| PL-SD0004 | Theo Mbeki | Copperline Eastside | Blast Chiller | 2026-11-10 | 06:00–07:30 | 1.50 | checked_in at 2026-11-10T10:50:00Z by Dana Okafor |
| PL-SD0005 | Theo Mbeki | Copperline Eastside | Prep Table A | 2026-11-12 | 10:00–14:30 | 4.50 | confirmed |
| PL-SD0006 | Rosa Lindqvist | Copperline Eastside | Convection Oven 2 | 2026-11-08 | 21:00–22:00 | 1.00 | checked_in at 2026-11-09T01:50:00Z by Dana Okafor |
| PL-SD0007 | Hana Sato | Copperline Highline | Rack Oven | 2026-11-10 | 07:00–09:00 | 2.00 | confirmed |
| PL-SD0008 | Rosa Lindqvist | Copperline Eastside | Deck Oven 1 | 2026-11-13 | 08:45–10:30 | 1.75 | confirmed |
| PL-SD0009 | Ade Okonjo | Copperline Eastside | Blast Chiller | 2026-11-12 | 08:45–10:30 | 1.75 | confirmed |

For example, with this set and the server clock started at 2026-11-10T13:43:30Z (08:43:30 at Copperline Eastside, 06:43:30 at Copperline Highline):

- Dana's Site day opens on 2026-11-10, showing four rows in this order: PL-SD0003 and PL-SD0004 (both at 06:00, so ordered by reference), then PL-SD0002, then PL-SD0001. PL-SD0006 is on 2026-11-08, reached with Previous day.
- Rosa's Book screen opens on 2026-11-11. On 2026-11-12 Prep Table A shows "Booked 10:00 to 14:30" and the Blast Chiller shows "Booked 08:45 to 10:30"; on 2026-11-13 Deck Oven 1 shows "Your booking 08:45 to 10:30".
- Available and committed hours start at 7.25 and 4.75 for Rosa, 6.25 and 3.75 for Ade, 0.00 and 6.00 for Theo, and 6.00 and 2.00 for Hana, each held in the opening lot.
- Eastside's rate schedule shows 2026-11-09 as Current, 2026-11-11 as Upcoming and 2026-01-01 as Past. Highline's shows only its base rate, 3800 cents and "7.65", as Current.
- At 2026-11-10T13:45:00Z (08:45 Eastside, 06:45 Highline):
  - PL-SD0001's check-in changes from `too_early` to accepted, with the copy "Checked in Lindqvist Hearth Bakery on Deck Oven 1.";
  - PL-SD0002's no-show changes from `too_early` (with `<HH:MM>` 08:45) to accepted, writing one `forfeit` of 1.00 hours by Dana Okafor;
  - PL-SD0007's check-in by Luis Arrieta changes from `too_early` to `certificate_expired`.
- PL-SD0003's check-in answers `too_late`, and its no-show is accepted.
- Checking out PL-SD0004 before 2026-11-10T13:46:00Z gives 5 late quarter hours, 0.00 pack hours applied and an overage of 5 quarter hours at 5000 cents and "10": subtotal 6,250 cents, tax 625 cents, total 6,875 cents ($68.75). Kill Bill then holds one non-void invoice for Theo's account, status `COMMITTED`, amount 68.75, with one `EXTERNAL_CHARGE` item reading `Overage PL-SD0004: 5 quarter hours at $50.00/h plus 10% tax`. From 13:46:00Z it gives 6 quarter hours and 8,250 cents.
- Checking out PL-SD0006 before 2026-11-10T13:46:00Z, while Rosa's available hours are 7.25, gives 139 late quarter hours, 7.25 pack hours applied and 110 overage quarter hours at the base 4250 cents and "8.875": subtotal 116,875 cents, tax 10,373 cents, total 127,248 cents, shown as "$1,272.48", with one committed Kill Bill invoice of 1272.48.
- PL-SD0008's notice is exactly 72 hours at 2026-11-10T13:45:00Z, so its cancel outcome is a full refund of 1.75 hours until that instant and a split of 0.75 refunded and 1.00 forfeited after it. If Dana cancels it first with a reason, a later cancel by Rosa answers `409 invalid_transition` and her ticket redraws as "Cancelled" with "Cancelled by Dana Okafor".
- PL-SD0009's notice is exactly 48 hours at the same instant, so its outcome is a split of 0.75 and 1.00 until then and a full forfeit of 1.75 after it.

**Seed set `pack-expiry`.** This set changes Ade Okonjo's certificate of insurance valid-through date to 2026-11-10, and adds:

- one purchase by Rosa Lindqvist of "Starter 10", committed at 2026-09-11T16:00:00Z (home-site date 2026-09-11), so its lot of 10.00 hours is valid through 2026-11-10. Its `pack_purchase` movement has Rosa as actor, its `killbill_payment_id` is `null`, and no receipt email is sent for it;
- these bookings:

| Reference | Member | Site | Station | Date | Window | Hours | Status | `created_at` |
|---|---|---|---|---|---|---|---|---|
| PL-PE0001 | Rosa Lindqvist | Copperline Eastside | Prep Table A | 2026-11-20 | 09:00–11:00 | 2.00 | confirmed | 2026-11-01T14:00:00Z |
| PL-PE0002 | Ade Okonjo | Copperline Eastside | Spiral Mixer 60 qt | 2026-11-11 | 00:00–01:00 | 1.00 | confirmed | 2026-11-01T14:00:00Z |
| PL-PE0003 | Ade Okonjo | Copperline Eastside | Prep Table A | 2026-11-11 | 00:00–01:00 | 1.00 | confirmed | 2026-11-01T14:00:00Z |

For example, with this set and the server clock started at 2026-11-11T04:58:30Z (23:58:30 on 2026-11-10 at Copperline Eastside):

- Rosa's `lots` start as Starter 10 with 8.00 hours valid through 2026-11-10 and `expiring_soon` true, then Opening balance with 12.00 hours and `expiring_soon` false, so her available hours are 20.00 and committed hours 2.00. PL-PE0001 drew its 2.00 hours from Starter 10. Her Packs screen shows the line "Starter 10: 8.00 h, valid through 2026-11-10" with the flame marker.
- From 2026-11-11T05:00:00Z exactly one `pack_expiry` movement of 8.00 hours with actor `null` is written, and Rosa's available hours are 12.00. A Packs screen left open shows that within 61 seconds: the Starter 10 line gone, "Available pack hours 12.00", and a top ledger row "Pack hours expired" by "Pilotlight". A Production 30 purchase after that instant leaves "Available pack hours 42.00".
- Cancelling PL-PE0001 after that instant refunds 2.00 hours into the expired Starter 10 lot and writes one `pack_expiry` of 2.00 hours in the same commit, so her available hours stay 12.00 and her committed hours become 0.00.
- Checking in PL-PE0002 is accepted before 2026-11-11T05:00:00Z, and checking in PL-PE0003 from that instant answers `certificate_expired`.
- The expiry notice scan sends Ade's 3-day notice for the 2026-11-10 certificate of insurance once.

## Technical requirements

### Deployment (DP-50)

- Node.js 22 LTS with npm is available. Write the app in TypeScript.
- `/app/run.json` holds the string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

- The serve command binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set. It serves both the API and the built frontend from that one origin.
- `GET /api/health` returns HTTP 200 with JSON `{"status":"ok"}` once the database is reachable and the schema and seed (Services) are in place, whatever the state of Kill Bill, storage or mail.
- **Extra instances.** Graders also run further serve processes on the following ports with one dependency pointed at an unreachable address (Kill Bill or storage), or with short hold, link, session and throttle lifetimes on their own empty database and bucket. Each behaves exactly as this brief says for that configuration.
- **Fresh starts.** Graders start the app many times. Every check or journey that relies on `PILOTLIGHT_CLOCK_START` or `PILOTLIGHT_SEED_SET` runs against servers started fresh for that one check, through the serve command:
  - each fresh start has a new empty database and an empty bucket;
  - its clock restarts at its `PILOTLIGHT_CLOCK_START` instant;
  - nothing carries over from any other check;
  - one check may start two server processes together on its database, for example one with Kill Bill unreachable.

  So the app must reach a seeded, healthy state on an empty database within 20 seconds of the serve command starting.

### Configuration and secrets (DP-60, DP-08, DP-39, DP-05, DP-15, DP-25, DP-28, DP-29, DP-34, DP-44, DP-62, DP-68, DP-72, DP-73, DP-76, DP-79, DP-84, DP-91, DP-92, DP-98)

The app reads these variables at start, never hard-codes them, and never sends any credential to the browser:

- `DATABASE_URL`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `APP_PUBLIC_PORT`: optional; defaults to 4173.
- `HOLD_TTL_SECONDS`: optional; the whole seconds a hold lasts. Defaults to 600, which is 10 minutes.
- `INSPECTOR_LINK_TTL_SECONDS`: optional; the whole seconds an inspector link lasts. Defaults to 259200, which is 72 hours.
- `SESSION_IDLE_SECONDS`: optional; the idle limit of a session in whole seconds. Defaults to 1800, which is 30 minutes.
- `SESSION_ABSOLUTE_SECONDS`: optional; the absolute limit of a session in whole seconds. Defaults to 43200, which is 12 hours.
- `SIGN_IN_THROTTLE_WINDOW_SECONDS`: optional; the sign-in throttle window in whole seconds. Defaults to 900, which is 15 minutes.
- `PILOTLIGHT_CLOCK_START`: optional; an ISO-8601 UTC instant. When it is set, the server clock reads that instant at the moment the serve process starts, before it connects to anything, and then advances in real time. When it is unset, the server clock is the system clock. Every server-side date and time rule follows this clock, including hold expiry, pack expiry, `expiring_soon`, the overdue verdict, session limits, throttle windows, audit `at` and the `Date` header.
- `PILOTLIGHT_SEED_SET`: optional; `site-day` or `pack-expiry`. When it is set, the seed inserted into an empty database also includes that seed set's records (Seed data). When it is unset, only the base seed is inserted. Any other value stops the server at start with an error naming the variable.

The session signing key, if the app uses one, is generated at start or stored in the database; it is never served. Ignore any variable whose name contains `_OBSERVER_`.

### Server boundary (DP-53, DP-21, DP-77, DP-93, DP-94, DP-96, DP-98)

**Same origin only.** The server sends no CORS headers.

- The server's own origin for a request is the scheme that request arrived on (`http`, or `https` over TLS), then `://`, then the request's `Host` header exactly as sent. It is never a fixed host or port, so outage instances and any host the app is reached at all work the same way.
- A POST, PUT, PATCH or DELETE whose `Origin` header is present and differs from that origin answers `403 cross_origin`, even when its CSRF token is right.

**Only the published surface.** The API is exactly the endpoint table in API, and nothing else answers under `/api`.

- An `/api/` path or method the table does not list is answered by precedence step 3 in API, signed in or out, and changes nothing. That covers paths such as `/api/metrics`, `/api/debug`, `/api/.env`, `/api/status` and `/api/__debug__`. A page path outside the API keeps the published client routing.
- No debug, metrics, test, seeding, reset or clock endpoint exists, and no endpoint exists only in one environment: the published surface is identical on every instance.

**CSRF token.** Every POST, PUT, PATCH and DELETE that carries a live session must send header `X-CSRF-Token` equal to that session's `pl_csrf` value. A missing, empty, stale or mismatched token answers `403 csrf_failed` and changes nothing.

- The token is rotated with the session at sign-in and destroyed with it.
- `POST /api/session` needs no token but is still Origin-checked. Safe methods need no token. Token-authenticated inspector requests are unaffected.
- Where this check falls in the order is in the API precedence.

**Response headers.** Every response carries `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Every HTML response also carries exactly:

`Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`

The served HTML contains no `<script>` element with a body, no inline event handler attribute, no `<style` element and no inline `style=` attribute, so the policy needs no inline allowance.

**Inert stored text.** Every stored value that the app shows, including a manager's cancellation `reason`, a document `rejection_reason`, `operator_signature`, `inspector_email` and a document's display file name, is rendered as literal text on every screen, in the PDF and in email. Storing `<img src=x onerror="document.title='xss'">` or `</script><script>document.title='xss'</script>` where a field accepts it leaves `document.title` unchanged, adds no element from the value, and puts the characters in the accessibility tree exactly as stored.

**JSON bodies.**

- JSON endpoints require `Content-Type: application/json` on requests with a body, otherwise `415 unsupported_media_type`.
- A JSON body may be at most 65,536 bytes. Exactly 65,536 is allowed, and more answers `413 body_too_large`.

**Uploads.** `POST /api/documents` accepts only `multipart/form-data`, otherwise `415 unsupported_media_type`.

- The whole request may be at most 5,500,000 bytes. Above that, it answers `413 body_too_large`.
- The file part may be at most 5,000,000 bytes. Exactly 5,000,000 is allowed, and 5,000,001 or more answers `413 file_too_large`.
- A missing or empty file part answers `422 validation` (`file`). The type check below applies only to a non-empty file part.
- The file part is read as raw bytes. Every byte value, NUL, CR and LF included, is kept exactly, and the multipart framing around it is never kept.

**Upload type.** A non-empty file part is accepted only when its declared part type and its leading bytes agree on one of these:

| Declared type | Leading bytes |
|---|---|
| `application/pdf` | `%PDF-` |
| `image/png` | the 8-byte PNG signature |
| `image/jpeg` | `FF D8 FF` |

A part whose declared type is none of these (SVG included), or whose leading bytes do not match its declared type, answers `415 unsupported_type` and nothing is stored. The file name extension is ignored. The detected type is the agreed type.

**File names.** The submitted file name is kept only as display text, `file_name`: it is reduced to its last path segment, every character outside `A-Za-z0-9._-` is replaced by `_`, it is cut to 120 characters, and an empty result becomes `file`. The storage key is chosen by the server and never contains any part of the submitted name, so names such as `../../etc/passwd`, one holding a NUL, or one 300 characters long store the bytes under a safe key and write nothing elsewhere.

**Serving files.** Document files are served as the exact stored bytes with these headers:

- `Content-Type` set to the detected type;
- `Content-Length` equal to the document's `size_bytes`;
- `ETag` equal to the document's `sha256` in double quotes, for example `ETag: "9f86d0…"` with all 64 hex characters;
- `Content-Disposition: attachment; filename="<file_name>"`;
- `Cache-Control: private, no-store`.

Visit-log PDFs are served the same way, with `application/pdf` and without the `ETag` rule. The CSV export keeps the disposition in API.

**What is served.** The server serves only the built frontend assets and the API. It never serves source files, the run manifest, package manifests, environment files or credentials. A request for any of these, or for any path that tries to climb out of the asset folder, answers `404` with the error body from API and code `not_found`.

**Secrets.** No response body, response header, served asset, client bundle, error body or audit event contains any value of a configured secret: the database password, the Kill Bill credentials, the SMTP credentials, the object-storage keys or a session signing key. Error bodies carry no host, port, driver text, SQL, stack frame or file path.

**Unreachable dependencies at boot.**

- If the database is unreachable at boot, the server starts anyway, answers health with the 503 body in API and nothing else, and retries the connection every 2 seconds.
- If Kill Bill, storage or SMTP is unreachable at boot, the server starts normally. Only the features listed in Services are affected.

### Browser support and performance (DP-55, DP-57, DP-81)

- Support current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, and every width in between under the layout bands, with mouse, keyboard and touch input.
- The browser's clock and time zone may be wrong by hours or days. Every screen still shows the server's verdicts and site-local times.
- The Book screen shows its dials and can be dragged within three seconds of navigation with the seed data.
- A dial follows a drag or key press within a tenth of a second.
- Every API call answers within one second on the seed data, except a pack purchase or a check-out that reaches Kill Bill.

## Working rules

- IF-01: `/app/run.json` exists, is valid JSON with exactly the string fields `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`, and the app is started only through it.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its version and licence. Shipped packages are the production dependency tree reported by `npm ls --omit=dev --all --json`, plus the bundled fonts.
- IF-03: Every shipped package (as defined in IF-02) is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0, and every font under OFL-1.1.
- IF-04: The app stores data only in PostgreSQL, Kill Bill and the S3 bucket. It uses no SQLite, no Redis, no in-memory store standing in for the database (sessions, throttles and idempotency records included), and no files on disk as a datastore.
- IF-05: The provided development service configuration and its seeded credentials are left unchanged.
- IF-06: Fonts and icons are bundled and served by the app, and the built pages load nothing from third-party hosts.
- IF-07: Application source, server and client, is written in TypeScript. The only JavaScript files are build output and tool configuration.

## Engineering standards

- The code is idiomatic TypeScript compiled in strict mode, with no `any` and no `@ts-ignore` or `@ts-expect-error` anywhere. Domain values such as booking status, ledger movement kind, actor, lot, hours, cents and audit outcome have explicit types, never loose strings.
- Names in the source match this brief's terms: booking, hold, sanitation buffer, pack hours, lot, valid-through date, expiring soon, ledger movement, actor, forfeit, overage, rate, visit, gap, overdue, inspector link, session, audit event.
- Each domain rule is decided in exactly one place in the source. That covers:
  - the booking transition table and the hold expiry instant;
  - who may cancel, and with which body;
  - the per-kind sanitation buffer and the overlap check;
  - the next-day cutoff;
  - insurance coverage;
  - the hold limit;
  - idempotency replay and conflict;
  - the forfeit split;
  - lot drawing and return order, lot expiry and the expiring-soon verdict;
  - lateness rounding;
  - rate resolution and overage pricing;
  - committing an overage invoice and voiding it on failure;
  - storage confirmation of a document object;
  - gap flagging and the overdue verdict;
  - link liveness;
  - session liveness, the sign-in throttle and the CSRF check;
  - the audit outcome for an answer;
  - each response shape and the inspector copy field list;
  - in the browser: the server-now estimate, the layout bands, the occurrence-hours preview, status-region writes, field-error linking, the handling of a 401 including the Sign in again resume, and the rule that only the latest request for a screen's subject is drawn.
- Money is held as integer cents and hours as whole quarter hours in every calculation, and no floating-point arithmetic touches money, lots or the forfeit split. The only conversions out of those units are the ones this brief asks for at its boundaries: cents ÷ 100 for a Kill Bill amount, and quarter hours as JSON numbers.
- There is no behaviour abstraction with only one implementation, meaning an interface or base class that declares behaviour. A type or interface that only names the fields of a data shape is a type, not an abstraction. There is no dead, commented-out or unreachable code.
- Input is validated once, where it enters the server, against closed schemas, and database access uses parameterised queries only. There are no defensive checks for states the rules make impossible.
- All errors go out through one path that produces the single error body defined in API. The health check's own 503 body is that body's one stated exception, so the health handler writes it itself.
- The product contains no features, endpoints or screens beyond this brief.
