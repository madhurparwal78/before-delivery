# Marrow & Lark Motor House Lacquer

Lacquer is the operations app of Marrow & Lark Motor House, a care house in Zurich that stores, maintains, repairs and repaints collector cars for private owners. Staff use it to:
- check cars in and out with a signed condition report;
- assign climate-controlled bays and keep the belongings log;
- work the care round;
- estimate and run paint jobs, with film-build readings for each panel;
- invoice the work and record owners' bank transfers;
- book releases.

Owners use the portal to see their own cars, photos, paint progress and invoices, to approve estimates and to request a release.

Lacquer uses four backend services:
- Postgres, its system of record;
- MinIO, for photos and signed condition reports;
- Kill Bill, for monthly bay subscriptions and one-off workshop invoices with their balances;
- Mailpit, as the outgoing mail service.

Out of scope: self-registration, password reset, payment card capture, refunds inside the app, multi-house support, any datastore besides those four services, and any external service called from the browser.

## Problem and users

A collector-car care house keeps anywhere from a few dozen to a few hundred valuable cars in climate-controlled bays. Every few weeks staff run care rounds: battery maintainer checks, tyre pressures and start-ups. The house also takes on workshop and paint jobs that can run for months. Most houses run all of this on:
- self-storage software built for padlocked units;
- a spreadsheet of bays;
- a paper key log;
- progress photos sent over a messaging app.

Owners are often abroad and see none of it until the invoice arrives.

At release an owner may point at a stone chip or a panel that looks different. The house then has no signed intake report, no paint-thickness history for each panel and no record of who started the car and when. So it pays for the respray or writes off the goodwill.

Swiss law lets a garage keep a car until that car's workshop invoice is paid, but the right covers only claims tied to that car. Without a live view of what the billing system has actually received, the house makes one of two mistakes:
- it releases cars with unpaid work;
- it holds owners who have already paid by bank transfer.

Owners often pay one QR-bill in several bank transfers that carry the same reference, and a bounced transfer can reopen a balance that looked settled. Owners abroad read dates on devices set to their own time zone, and a paid-through date that shifts by a day starts a billing dispute. Two people often touch the same record at once: the house manager corrects an estimate the workshop lead has open, or a key set is handed back at the door while the car is being released. Insurers increasingly ask for dated condition evidence as well.

Existing tools each cover only part of this. Restoration-shop tools add a photo portal but know nothing about bays, belongings or storage billing. Self-storage suites know bays but nothing about the stages of a paint job.

Users:

- **Concierge** (daily): checks cars in and out with a signed condition report, assigns bays, keeps the belongings log and books releases. Uploads often happen on a tablet at the door, where the signal is weak. Searches for cars many times a day and shares filtered Bays links with colleagues.
- **Care technician** (daily, mostly on a phone while walking the bays, often on weak signal): works through the care round. They log battery voltage, tyre pressures and start-ups, and flag anything that is off. The house limits every staff session to one shift, so a session can end while they are mid-entry.
- **Workshop lead** (daily): estimates jobs, logs paint stages with film-build readings for each panel, and turns finished work into an invoice. They wait on owners' answers to plan the paint bay, and another lead or the house manager may act on the same job at the same time.
- **House manager** (weekly, on a laptop and often by keyboard): sees bay occupancy, overdue care, unpaid balances and staff access in one place, records owners' bank transfers, and revokes access for people who leave.
- **Owner** (weekly, often abroad): sees their own cars, photos, paint progress and invoices, approves or declines estimates and requests a release.

## Journeys

1. **Intake.** Kenji Arlow's 1971 Lancia Fulvia Coupé arrives and is listed as awaiting intake.
   1. On Bays, the concierge types "fulv" into Search cars. The Cars table narrows to the Fulvia as they type, the result count is announced once, and the address now carries the search. A colleague who opens the same address sees the same filtered table.
   2. They open the car page and then the bay picker. They move across the floor plan with the arrow keys, and occupied or too-small bays are announced as unavailable. They pick bay A4 with Enter.
   3. The bay-billing line reads pending. The concierge opens "Add item" and starts typing the car's second key set.
   4. While the dialog is open, Kill Bill invoices the new bay subscription. The bay-billing line changes in place to the paid-through date Kill Bill reports. The dialog, the typed text and the focus stay exactly where they were.
   5. The concierge saves the item. They start uploading the condition report PDF that the owner's driver and the concierge signed at the door; the tablet loses signal halfway through. Nothing is left behind, and the retry is stored once. Then they upload an intake photo.

   End state: the car page shows bay A4, the belongings counts, the stored report with its fingerprint, and the attached photo.
2. **Care round on a phone.** The care technician signs in on a phone 375 pixels wide. The navigation stays folded behind Menu. The round lists the cars in bays with overdue start-ups first, and the 1967 Jaguar E-Type is marked overdue.
   1. The technician taps the E-Type and enters a start-up, a battery voltage and four tyre pressures.
   2. They press Save entry just as the signal drops. The dialog stays open with the values and says no answer came back.
   3. Meanwhile the round's re-read moves another car into the overdue group behind the dialog. The technician's place in the dialog does not change.
   4. By the time the signal returns, the shift session has ended, and the round's next re-read meets the ended session. The screen does not navigate away: a Sign in again dialog asks for the password, with the round-entry dialog and its values still behind it.
   5. The technician signs in again. The round-entry dialog still holds its values and the key from the lost answer. The technician presses Save entry again, and the entry goes to the server with that same key.

   End state: exactly one entry is logged. The confirmation appears on screen and is announced once with the next due date, and the E-Type leaves the overdue group. Had the E-Type been released while its dialog was open, the dialog would have kept its values until Save entry, which would then have explained that the car is no longer in a bay.
3. **Estimate and approval.**
   1. The workshop lead drafts an estimate with parts, labour hours and paint materials, and checks the VAT and the rounded total.
   2. While the lead's Estimate dialog is open, the house manager corrects a line on the same job. When the lead saves, the save is refused because the estimate changed; the dialog stays open with the lead's edits, and the lead reloads, re-applies them and sends the estimate. The job page stays open.
   3. The owner gets the approval email. They follow its link while signed out, sign in, and land on that exact portal job page.
   4. The owner opens Decline estimate, thinks again, keeps the estimate and approves it.

   End state: within seconds and without a reload, the workshop lead's open job page shows the job approved, announces it once and offers Log stage. Had the estimate expired while the owner's Decline dialog was open, the dialog would have stayed open and pressing Decline would have explained the expiry.
4. **Paint stages and the coat stack.** On an approved or running job, the workshop lead logs a stage with film-build readings, using only the keyboard. A second lead logging the same stage from another workstation at the same moment is told it is already logged. The lead steps the stage scrubber back to intake and forward to the latest stage. Each step:
   - re-tints the car plan by reading band;
   - rebuilds the selected panel's cross-section;
   - counts the total film build up or down.

   The lead copies the address and sends it to the owner.

   End state: the owner opens it on a laptop and lands on the portal view of the job at the same stage and panel, laid out in the same three panes. On the portal, every reading is credited to the house, not to a staff member.
5. **Invoice and partial payment.**
   1. The workshop lead marks a job finished. The workshop lead and the house manager both press Issue invoice at the same moment. Exactly one invoice results, with one charge on the owner's Kill Bill account, and the owner gets one invoice email.
   2. The owner keeps the portal invoice page open. It shows the invoice as awaiting payment, with its full outstanding balance.
   3. The owner pays part of the invoice by bank transfer. The house manager records that amount from the board. The outstanding balance drops to the figure Kill Bill reports, and the owner's open page updates and announces it once.
   4. The owner pays the rest under the same bank reference, and the house manager records it.
   5. Later the bank returns that transfer, and the bookkeeper refunds the payment in Kill Bill.

   End state: the invoice is first paid everywhere. After the refund, it shows awaiting payment again on the board, the portal and the job ledger.
6. **Release, held for an unpaid invoice.**
   1. Henrietta Calloway, travelling with her laptop set to a Pacific time zone, requests a release of her 1973 Porsche 911 for a slot at least two days ahead. She keeps the portal release page open in one tab and My cars in another. Every date and time she sees is Zurich's.
   2. The concierge books the slot. Without a reload, the owner's heading changes to booked and the change is announced once. The owner also gets the booking email with the slot and bay.
   3. On the day, the concierge stages the car. The owner's heading changes to ready for handover.
   4. The car's workshop invoice still has a balance in Kill Bill:
      - the Releases row shows the hold;
      - the portal shows which invoice holds the car;
      - Complete release is refused with the invoice named.

      Invoices on Henrietta's other car do not count.
   5. The house manager records the transfer. The concierge checks out every key set, cover and document. As the concierge presses Complete release, a porter checks one key set back in at the door; whichever lands first wins, and a released car never keeps a key set "in". The concierge completes the release.

   End state: the owner gets the release email, the bay shows as free on the floor plan, and on Henrietta's still-open My cars page the 911's card turns to Released with the day Kill Bill will stop billing, announced once and the same day on her device as in Zurich.
7. **Weekly review and a leaver.** The house manager opens the board on a laptop and reads occupancy, overdue start-ups and unpaid balances side by side; occupied and free bays, the unpaid line and hold labels read clearly by text and pattern, not by tint. On Staff access, using only the keyboard, they ask to revoke a care technician who has left, confirm in the dialog, and land on that row's Restore access button. The technician's round screen is still open on a phone.

   End state: on its next re-read, the phone shows the sign-in page with the revoked message. Restoring the person's access later does not bring the old session back; they must sign in again.
8. **Outages without false success.**
   1. Photo storage goes down, and every staff screen shows the storage notice. The concierge can still assign bays, log belongings and see the care round.
   2. An upload attempt never shows a thumbnail or a finished progress bar. It fails with the published copy, which stays in place across re-reads, and nothing is left half-attached.
   3. With email down, the concierge presses Complete release. The row stays staged and the bay stays occupied throughout.
   4. With billing down, the board shows each balance with the date it was last confirmed.

   End state: once the services are back, the same upload and the same release each succeed exactly once, and nobody has restarted the app.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sessions and roles** Seeded staff and owners sign in with email and password, every other API route except health and service status answers 401 without a live session, and each role reaches only the actions the role table in Business rules grants, with 403 otherwise.
- **DP-02 — One error shape and order** Every API error uses the single error shape and the single precedence order defined in API, so the same fault always yields the same status and body.
- **DP-03 — Owners reach only their own cars** An owner reaches only their own cars and those cars' bay billing, condition reports, photos, sent jobs, invoices and releases on every page, endpoint, search result, total and email, and any other id, including one inside a request body or edited into a URL, answers 404.
- **DP-04 — Idempotent submissions** Release requests, invoice issues, care-round entries and bank transfers carry an idempotency key whose record lives in Postgres, so a replay on any app process returns the original response without a second effect, a failed attempt may be retried with the same key on any process, and a reused key with a different body answers 409.
- **DP-05 — Bays fit with clearance** A car is assigned only to a bay whose length and width each exceed the car's by at least the published clearance, and a bay that is too small answers 409.
- **DP-06 — One car per bay** A bay holds at most one car at a time, and when several assignments to the same free bay arrive together exactly one succeeds and the rest answer 409.
- **DP-07 — Moves stay in bay class** A stored car moves only to a free, fitting bay of the same bay class, so its bay subscription plan never changes mid-stay.
- **DP-08 — Condition report kept as signed** The signed intake condition report PDF is stored in object storage byte for byte as uploaded, at most once per stay, and every download returns exactly those bytes with the recorded SHA-256.
- **DP-09 — Photos count once stored** An intake or stage photo is listed as attached only after object storage confirms the upload, and a failed upload leaves no photo record.
- **DP-10 — Bay picking by keyboard and touch** The concierge picks a bay on the floor plan with arrow keys and Enter or by tap, and bays that are occupied, too small or in another class cannot be chosen and say why.
- **DP-11 — Car intake journey** A concierge registers a car, assigns it a fitting bay from the floor plan, logs its belongings, uploads the signed condition report and an intake photo, and the car page then shows the bay, the belongings counts, the report and the photo, with bay billing turning from pending to paid-through in place.
- **DP-12 — Belongings ledger** Each belonging's checked-in count always equals its check-in minus check-out movements and never goes below zero, and completing a release while any of the car's items is still checked in is refused in the completion order stated in Business rules.
- **DP-13 — Care entries and flags** A care-round entry records a start-up, battery voltage or four tyre pressures with who logged it and when, and the server flags a low battery or a tyre off its specified pressure as defined in Business rules.
- **DP-14 — Server-decided start-up status** Whether a scheduled car's start-up is overdue and when the next one is due come only from the server, using the overdue period set by environment, and the screen shows that status whatever the device clock says.
- **DP-15 — Care round journey** A care technician on a phone opens the round, sees overdue cars first, logs a start-up and battery reading for a car, and hears and sees the confirmation with the next due date while that car leaves the overdue group.
- **DP-16 — Readings stored once** Film build, tyre pressure and odometer readings are stored once in micrometres, bar and kilometres, and every display in mil, psi or miles is derived from that stored value with the published conversion and precision.
- **DP-17 — Workshop job states** A workshop job moves only along draft, sent, approved, declined or expired, in progress, finished, invoiced and paid, and back from paid to invoiced, as defined in Business rules, and every other move answers 409 with the job unchanged.
- **DP-18 — Estimate expiry** A sent estimate expires when the expiry period set by environment has passed since it was sent, after which the server shows it as expired and refuses approval or decline with 409.
- **DP-19 — Estimate approval journey** The workshop lead drafts and sends an estimate, the owner receives the approval email, opens the estimate in the portal and approves it, and the workshop lead's open job page then shows it approved.
- **DP-20 — Paint stages and panel readings** The workshop lead logs paint stages in the published order, each once per job, with film-build readings for named panels, and the job's reading history keeps every reading with who logged it and when.
- **DP-21 — Keyboard stage logging** The workshop lead opens, fills and saves the stage and reading dialogs using only the keyboard, with focus kept inside each open dialog and returned to the opener on close.
- **DP-22 — Exact invoice money** Estimate and invoice totals combine parts, labour hours at the published rate and paint materials with VAT using exact decimal arithmetic, rounding half up per line and then the total to the nearest five centimes.
- **DP-23 — Invoice balance from Kill Bill** Issuing an invoice records a matching charge in Kill Bill before the invoice exists in the app, an invoice's balance and paid status come only from Kill Bill, and a recorded bank transfer is a Kill Bill external payment of exactly the entered amount, at most the live balance.
- **DP-24 — Bay billing in Kill Bill** Each stored car gets a monthly bay subscription in Kill Bill on its owner's account on the plan for its bay class, and on release that subscription is cancelled at the end of its paid term with the dates Kill Bill confirms.
- **DP-25 — Release notice rule** The server accepts a release slot only on the published half-hour grid and at least 48 hours ahead in Zurich time, and publishes the earliest slot the form offers.
- **DP-26 — Release states and slots** A release moves only along requested, booked, car staged, released or cancelled as defined in Business rules, a car has at most one open release, and of several simultaneous requests for one slot exactly one succeeds.
- **DP-27 — Release completes all or nothing** Completing a release records it, frees the bay and sends the owner's release email together, and if any guard refuses or the email is not accepted none of them happens.
- **DP-28 — Release journey** An owner requests a release slot, the concierge books it, stages the car, finds it held until the car's unpaid invoice is paid, checks out every belonging and completes the release, and the owner sees each heading, receives the emails and the bay shows free.
- **DP-29 — Owner emails** The estimate, release-booked, invoice-issued and released emails each reach only the car's owner exactly once with the published subject, even when sent after a mail outage, and carry no other owner's data.
- **DP-30 — Owner portal journey** An owner signs in, sees only their own cars with bays, care status, photos and bay billing, opens a paint job's coat stack and an invoice, and sees the invoice's outstanding balance drop and then turn paid as transfers are recorded.
- **DP-31 — Manager board and staff access** The house manager's weekly review shows bay occupancy, overdue start-ups and unpaid balances summed from Kill Bill on one board, records a partial bank transfer that leaves exactly the balance Kill Bill reports, and revokes a leaver's access.
- **DP-32 — Published breakpoints** The house manager's board and the job page show one pane below 768 pixels wide, two panes from 768 and three panes from 1200, in the published order with no horizontal scrolling.
- **DP-33 — Outages and recovery** When object storage, Kill Bill or the mail service is unreachable, at boot or later, the app still serves bays, belongings and care rounds, answers the affected actions as stated in Services, and every effect it queued during the outage is applied once within 30 seconds by a process that can reach the service, without a restart.
- **DP-34 — Outage notices** While a service is unreachable every staff screen shows its published notice within 15 seconds, and no notice shows while every service answers.
- **DP-35 — Coat stack data** The server derives each panel's film build, reading band and cross-section layers at every logged stage, and the browser draws exactly those values.
- **DP-36 — Coat stack view and shared state** The job page shows the 12-panel car plan with band tint, hatch and label, a stage scrubber, the selected panel's cross-section and total film build, and the stage and panel live in the address so a reload or shared portal link shows the same state.
- **DP-37 — Panel map and scrubber by keyboard and touch** Arrow keys move between panels, Enter opens the panel's reading history, the stage scrubber steps with arrow keys, Home and End, and on a phone panels and stages work by tap and drag.
- **DP-38 — Coat stack motion** Moving the scrubber one step wipes the panel fills front to rear with a short stagger, then changes the cross-section layers from the bottom up, then counts the total film build to the server value, all within about 1.2 seconds.
- **DP-39 — Reduced motion and stage announcements** With reduced motion on, every coat-stack change shows its end state at once with the same function, and a polite live region announces the stage, its position and the selected panel's reading and band after every step.
- **DP-40 — Announced results** Every async action's pending, success and error results appear on screen and in its named live region with the exact copy from Feedback states, and a failed form shows an error summary linking to each field.
- **DP-41 — Touch at phone width** At 375 by 812 every screen fits without horizontal scrolling and every control, bay and panel offers a touch target of at least 44 by 44 pixels.
- **DP-42 — Build-sheet look** The app reads as a calm workshop build sheet: putty ground, hairline rules on a 12-column grid, an expanded display face for car identity, readings in monospaced numerals with units, and masking-tape yellow on only the one thing in progress.
- **DP-43 — Coat stack craft** The procedural top-down car plan, its band tints and hatches and the stage cross-section read clearly as one instrument that shows where a car is original, refinished or suspected of filler.
- **DP-44 — Real providers and secrets from environment** All state that the brief assigns to Postgres, MinIO, Kill Bill and Mailpit lives in and is read from those services, and every credential and service URL comes from the environment and never reaches the browser.
- **DP-45 — Run manifest and health** The app installs, builds and serves from the run manifest, listens on the published port and answers the health check.
- **DP-46 — Server boundary** The server answers only same-origin API calls, enforces the published body limits and never serves source files, credentials or environment values.
- **DP-47 — Release held for an unpaid invoice** A release cannot complete while any invoice for that car has a Kill Bill balance above zero, checked live at completion and against the last confirmed balance when Kill Bill does not answer, while invoices for the owner's other cars never block.
- **DP-48 — One invoice per finished job** Of concurrent invoice issues on one finished job exactly one succeeds with exactly one Kill Bill charge, and concurrent issues on different jobs get distinct gapless invoice numbers that a failed issue never consumes.
- **DP-49 — Open screens survive their re-reads** Every periodic re-read updates values in place and never closes an open dialog, clears typed values, moves focus, resets scroll, restarts an upload or re-announces an earlier result.
- **DP-50 — Release status updates live** The portal release page and the Releases table pick up status changes made elsewhere within one re-read, update the heading or row in place, announce the owner's change once and keep focus inside a changed row.
- **DP-51 — No success before the server answers** No screen shows an action's success state before the server answers, and when an outage refuses an action the row, floor plan, photo list and invoice keep their prior state throughout.
- **DP-52 — Revoked access ends every session** Revoking a staff member ends every session they hold, their open screen reaches sign-in with the revoked copy on its next re-read or action, and restoring access revives none of those sessions.
- **DP-53 — Round rows move without losing place** When a re-read moves a car between the overdue group and the rest of the care round, its row moves to its published position while an open round-entry dialog, its typed values, focus and scroll stay unchanged, as qualified in Interactions.
- **DP-54 — Lost answers retry safely** Round entry, Issue invoice, Request release and Record bank transfer each hold one idempotency key until the server answers, so after a lost answer the form keeps its values, shows the no-answer copy, and pressing again records exactly one effect.
- **DP-55 — Collapsed menu is unavailable** Below 768 pixels wide the main navigation stays hidden from view, keyboard and assistive technology until Menu opens it, and Escape or following a link closes it again.
- **DP-56 — Bank transfers apply once, in turn** Bank transfers on one invoice carry an idempotency key and run one at a time across every app process, each checked against the balance Kill Bill reports after the previous one, and a repeated bank reference records a separate transfer.
- **DP-57 — Paid is never latched** When Kill Bill reports a balance above zero again on a paid invoice, the next read that reaches Kill Bill shows it awaiting payment, returns its job to invoiced and restores the board total and the release hold.
- **DP-58 — Transfer dialog outlives its row** A board re-read that changes or removes an invoice leaves an open Record bank transfer dialog and its typed values untouched, and a later submit answers with the invoice's current state.
- **DP-59 — Owner invoice updates live** The portal invoice page updates its balance and status in place within one re-read of a change and announces each change once, with nothing announced on first load or on an unchanged re-read.
- **DP-60 — Owners see the house, not staff** Every response and portal page an owner receives shows staff actors only as the house and carries no Kill Bill invoice id, Kill Bill payment id or transfer recorder, while staff responses keep the real actors.
- **DP-61 — Sign-in returns to the linked page** A page opened without a session sends the user to sign-in with its address as the return address, sign-in returns there when it is a single-slash path to an app page, and any other return address sends the user to their role's home.
- **DP-62 — Cross-system effects land together and in order** Bay billing for a car stored and released during a Kill Bill outage reaches Kill Bill as account, subscription, first invoice and then cancellation ending at the paid-through date, a refused completion queues nothing, and concurrent completions or condition-report uploads yield exactly one effect.
- **DP-63 — Stale balances say so** Wherever Kill Bill did not answer for an invoice, the board, portal invoice and job ledger show its balance with the date it was last confirmed, and every read that reaches Kill Bill updates that stored balance.
- **DP-64 — A refusal stays on screen** An error result stays in its status region, with focus on the pressed control while it exists, until the user's next action on that screen, and re-reads and service-notice checks never clear or repeat it.
- **DP-65 — Car search shows the latest input** Search cars filters the Cars table as the concierge types, and an earlier query's late answer never replaces the results or announcement for the latest input.
- **DP-66 — Expired session resumes in place** A session ends at its fixed lifetime whatever the re-reads, and an open screen that meets the expiry opens Sign in again in place, keeps every open dialog and value, and after sign-in resends an interrupted idempotent action once with the same key and body while other interrupted actions are not resent, as qualified in Interactions.
- **DP-67 — Estimate answers reach the job page live** The workshop lead's job page and Jobs table pick up an owner's approval or decline or an expiry within one re-read, update the label and legal buttons in place, and announce the change once on the job page while focus and scroll stay put.
- **DP-68 — Decline dialog survives expiry** An owner's open Decline estimate dialog stays open with its focus when a re-read finds the estimate expired, and pressing Decline then answers estimate_expired, closes the dialog, focuses the Job ledger heading and keeps the error copy across re-reads.
- **DP-69 — Zurich dates everywhere** Every date and slot label on every screen and email is the Zurich calendar date or time whatever the device time zone, Kill Bill dates show exactly the day Kill Bill returns, and owner accounts in Kill Bill use the Europe/Zurich time zone.
- **DP-70 — Revoke asks first, by keyboard** Revoking access asks for confirmation in an alert dialog that opens on Keep access, wraps Tab and Shift+Tab, closes on Escape with focus back on the opener, and after a revoke moves focus to that row's Restore access button.
- **DP-71 — Abandoned uploads leave nothing behind** A condition-report upload claims its stay as it starts, so a second upload during the stream answers report_already_signed within 1 second, and an upload cut off by the client leaves no object, incomplete multipart upload, claim, record, lock or busy database session within 5 seconds.
- **DP-72 — Contrast and not tint alone** On the board, Staff access and the Record bank transfer dialog at every published viewport, text meets 4.5:1 (3:1 when large), every bay, panel and control outline and the focus indicator meet 3:1 against the ground, and occupied versus free bays and hold or unpaid states are told apart by text and pattern, never by tint alone.
- **DP-73 — Owner pages keep the published breakpoints** My cars shows its cards one, two and three to a row below 768, from 768 and from 1200 pixels wide in the published order, and the portal job page follows the staff job page's pane rule, with no horizontal scrolling.
- **DP-74 — My cars shows a release live** An owner's open My cars page shows a car released elsewhere as Released with Kill Bill's billing end date in place within one re-read after Kill Bill confirms, announces it once in Car updates, and keeps focus and scroll, as qualified by the re-read schedule in Business rules.
- **DP-75 — Paint stages land one at a time** Log stage, Add reading and Mark finished on one job run one at a time across every app process, so of concurrent logs of one stage exactly one succeeds, stages in stage order never have decreasing log times, and a finished job never gains a stage or reading.
- **DP-76 — Round entry outlives its car** When a care-round re-read removes a car, that car's open round-entry dialog keeps its values and focus, and Save entry then answers car_not_stored, closes the dialog, focuses the Care round heading and keeps the error copy across re-reads with no entry recorded.
- **DP-77 — One car, one change at a time** Belongings movements, bay assignments and release completion for one car run one at a time across every app process, so a movement after a completion answers car_released, and of a racing completion and check-in either the completion answers belongings_checked_in or it succeeds and the check-in answers car_released, never leaving a released car with an item checked in.
- **DP-78 — Car search lives in the address** Search cars keeps its settled text in the Bays address by replacing the current history entry, so a reload or shared link shows the same filtered table without an announcement, and an earlier query's late answer never writes the address, table or announcement.
- **DP-79 — Estimate edits refuse lost updates** Every job carries a version that rises on every stored change, estimate edits and sends must name the version they were made from, a stale version answers 412 estimate_changed with the job unchanged and no email, and the open Estimate dialog keeps its values on that answer.

## Frontend

### Screens and layout (DP-11, DP-15, DP-19, DP-28, DP-30, DP-31, DP-32, DP-36, DP-41, DP-55, DP-73, DP-78)

There are three published viewports: 375x812 (phone), 768x1024 (tablet) and 1280x800 (laptop). No screen scrolls horizontally at any of them.

Three screens have panes or card rows that change with width: the board, the job page (staff and portal) and My cars. They use exactly two breakpoints:
- below 768 pixels wide: one pane, or one card per row;
- from 768 up to 1199: two panes, or two cards per row;
- from 1200 up: three panes, or three cards per row.

No other width changes their pane or column count.

**App shell.** A top bar holds:
- the house name "Marrow & Lark Motor House" in small caps, and the product name "Lacquer";
- the navigation for the signed-in role;
- the units control;
- sign-out.

Below 768 pixels the navigation folds behind a menu button, and the units control and sign-out stay in the top bar. From 768 up, the navigation always shows in the top bar and there is no menu button.

On staff screens, the service notice (when there is one) sits directly under the top bar. Section headers inside long panes stay pinned to the top of their pane while it scrolls.

**Sign in** (`/sign-in`). A single centred form takes email and password. After sign-in each role lands on the address set by the return-address rule in Business rules, or otherwise on its home:

| Role | Home |
|---|---|
| Concierge | Bays (`/bays`) |
| Care technician | Care round (`/round`) |
| Workshop lead | Jobs (`/jobs`) |
| House manager | Board (`/board`) |
| Owner | My cars (`/portal`) |

**Bays** (`/bays?q=<search text>`, the concierge's home; `q` is optional). This screen holds:
- the floor plan of all bays;
- a searchable table of cars with their status and bay;
- a "Register car" form, which opens in a dialog.

At 1280 the floor plan spans eight columns and the car table four. At 768 and 375 the floor plan comes first and the table sits below it.

**Floor plan** (on Bays, inside the bay-picker dialog, and on the Board). A top-down drawing of the bays, laid out by row and column and drawn to their relative length and width. Each bay shows:
- its code;
- its class;
- either the name of the car in it or "Free".

At 375 the plan scales to the screen width, and each bay keeps a tap area of at least 44 by 44 pixels.

**Car page** (`/cars/<car id>`). A full-width header shows the car identity (year, make, model) in the expanded display face, with registration and colour beneath it. The sections are:
1. Bay and bay billing
2. Belongings: a table of items, with counts and check-in and check-out buttons
3. Condition report
4. Photos
5. Care history: the latest 20 entries
6. Releases

At 1280 they sit in two columns: bay, belongings and condition report on the left; photos, care history and releases on the right. At 768 and 375 they stack in the listed order.

**Care round** (`/round`, the care technician's home). Under a level-1 heading "Care round", the screen lists every car in a bay, in the order the care-round endpoint in API publishes. Each car shows:
- its name and bay code;
- its start-up status;
- its last battery voltage;
- its flags;
- a button that logs a round entry.

At 375 the round is a list of full-width cards. At 768 and 1280 it is a table with the same columns.

**Jobs** (`/jobs`, the workshop lead's home). A table of jobs showing number, car, title, status and total, with a "New estimate" button.

**Job page** (`/jobs/<job id>?stage=<index>&panel=<panel id>`). The car identity runs across the top in the expanded display face. Three panes follow:

| Pane | Contents |
|---|---|
| Car plan | The top-down plan with its 12 panels, and the stage scrubber under it |
| Cross-section | The selected panel's cross-section, the total film-build numeral, and the reading table for every panel at the current stage |
| Job ledger | A level-2 heading "Job ledger", then the job status, estimate lines and totals, the stage log, stage photos and the job actions. Once an invoice is issued, it also shows the invoice number, status and outstanding line |

At 1280 the three panes sit side by side in that order. At 768, Car plan and Cross-section sit side by side, with Job ledger full width below. At 375 they stack as Car plan, then Cross-section, then Job ledger.

**Releases** (`/releases`, concierge). A table of open and recent releases. Each row shows car, owner, slot, status, bay and the hold label, with that row's actions.

**Board** (`/board`, the house manager's home). Three panes, each with a level-2 heading that matches its name:
1. **Occupancy**: the occupied-of-total line above the floor plan.
2. **Overdue care**: cars whose start-up is overdue.
3. **Unpaid invoices**: each invoice with a balance, its outstanding line, and the unpaid line.

At 1280 the three panes sit side by side. At 768, Occupancy and Overdue care sit side by side, with Unpaid invoices full width below. At 375 they stack in that order.

**Staff access** (`/staff`, house manager). A table of staff showing name, email, role, last sign-in and access state, with a revoke or restore button on each row.

**Owner portal.**

| Page | Address | Shows |
|---|---|---|
| My cars | `/portal` | One card per car the owner owns, in the card order in Business rules: a link with the car name, the card's bay line, start-up status, latest photo and bay-billing line |
| Car | `/portal/cars/<car id>` | Photos, condition report, care history, jobs, invoices, releases and a "Request release" button |
| Job | `/portal/jobs/<job id>?stage=&panel=` | The staff job page's three-pane coat stack, read-only, with the same "Job ledger" heading and exactly the staff job page's pane arrangement at every width. While the server reports the estimate as sent, the Job ledger shows it with approve and decline buttons |
| Invoice | `/portal/invoices/<invoice id>` | Lines, totals, payment status and the outstanding line |
| Request release | `/portal/cars/<car id>/release` | A date field, a time picker and the earliest allowed slot |
| Release | `/portal/releases/<release id>` | A status heading, the hold line while it applies, slot, bay and history |

My cars lays its cards in a grid of equal-width columns: one per row below 768, two from 768 up to 1199, three from 1200 up. Every card in a row starts at the same top edge, and the grid never runs past the screen edge.

A portal page whose record is missing, or belongs to someone else, shows the not-found heading from Feedback states.

**Shared job addresses.** These redirects always keep the query string:

| Who | Opens | Goes to |
|---|---|---|
| Owner | `/jobs/<job id>` | `/portal/jobs/<job id>` |
| Staff member | `/portal/jobs/<job id>` | `/jobs/<job id>` |
| Owner | Any other staff page | `/portal` |
| Staff member | Any other portal page | Their role's home |

So a link the workshop lead copies opens for the owner at the same stage and panel, or on the not-found heading if the job is not theirs.

### Public screens and controls (DP-01, DP-10, DP-21, DP-36, DP-37, DP-40, DP-50, DP-55, DP-58, DP-65, DP-66, DP-67, DP-68, DP-70, DP-73, DP-74, DP-76, DP-78, DP-79)

Only the roles and names below are public. Placeholders in angle brackets come from the record:
- `<car name>` is "<year> <make> <model>", for example "1971 Lancia Fulvia Coupé".
- `<panel name>` comes from the panel table in Business rules.
- `<name>` is a staff member's name.
- The other placeholders are defined in Feedback states.

**Shell, sign-in, units and shared regions**

| Where | Role and accessible name | Visible copy or notes |
|---|---|---|
| Sign in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | Heading `Sign in to Lacquer` |
| Shell | `navigation "Main"` | |
| Shell | `button "Menu"` | Below 768 only. Carries `aria-expanded` |
| Shell | `button "Units"`, `button "Sign out"` | Always in the top bar |
| Units | `dialog "Units"` holding `radiogroup "Film build"` (`radio "µm"`, `radio "mil"`), `radiogroup "Tyre pressure"` (`radio "bar"`, `radio "psi"`), `radiogroup "Distance"` (`radio "km"`, `radio "mi"`) and `button "Save units"` | |
| Units | `status "Settings updates"` | |
| Staff screens | `status "Service notice"` | |
| Any form | `alert "There is a problem"` | The error summary. It holds one link per field error, and each link moves focus to its field. On sign-in it also carries the revoked copy |
| Any signed-in screen | `dialog "Sign in again"` with the session-ended text, the session user's email as plain text, `textbox "Password"` and `button "Sign in again"` | Opens only as stated in Interactions. Copy in Feedback states |

**Bays and car page**

| Where | Role and accessible name | Visible copy or notes |
|---|---|---|
| Bays | `group "Floor plan"`, with one `button` per bay named `Bay <code>, <class label>, <state>` | `<state>` is `free` or `occupied by <car name>`. In the picker it can also be `too small` or `other class`. Each bay shows exactly one state, chosen by the reason order in Business rules |
| Bays | `searchbox "Search cars"`, `table "Cars"`, `button "Register car"` | |
| Bays, car page | `status "Bay updates"` | |
| Register car | `dialog "Register car"` with `combobox "Owner"`, `spinbutton "Year"`, `textbox "Make"`, `textbox "Model"`, `textbox "Registration"`, `textbox "Colour"`, `spinbutton "Length (mm)"`, `spinbutton "Width (mm)"`, `textbox "Odometer (<distance unit>)"`, `textbox "Tyre pressure (<pressure unit>)"`, `checkbox "Start-up schedule"` and `button "Register"` | |
| Car page | `button "Choose bay"` opens `dialog "Choose bay"`, which holds the floor plan and `button "Assign bay <code>"` | Also used for moves |
| Car page | Text labelled `Bay billing` | A bay-billing label from Feedback states |
| Car page | `table "Belongings"`, with `button "Check in <label>"` and `button "Check out <label>"` on each row | |
| Car page | `button "Add item"` opens `dialog "Add item"` with `combobox "Item kind"`, `textbox "Item label"`, `spinbutton "Count"` and `button "Add"` | |
| Car page | `status "Belongings updates"` | |
| Car page | File input labelled `Signed condition report (PDF)`, `button "Upload report"`, `link "Download signed report"` | The SHA-256 shows in monospace under the link |
| Car page | File input labelled `Intake photo`, `button "Upload photo"`, `progressbar "Upload progress"`, `list "Photos"` | |
| Car page, job ledger | `status "Upload updates"` | |

**Care round**

| Where | Role and accessible name | Visible copy or notes |
|---|---|---|
| Care round | `heading "Care round"` (level 1) | Can take focus programmatically |
| Care round | `list "Care round"` below 768, or `table "Care round"` from 768 | Only one of the two is present at a time |
| Care round | `button "Log round entry for <car name>"` on each car | |
| Care round | `dialog "Round entry: <car name>"` with `checkbox "Started the engine"`, `textbox "Battery voltage (V)"`, `textbox "Front left tyre (<pressure unit>)"`, `textbox "Front right tyre (<pressure unit>)"`, `textbox "Rear left tyre (<pressure unit>)"`, `textbox "Rear right tyre (<pressure unit>)"`, `textbox "Note"`, `button "Save entry"` and `button "Cancel"` | |
| Care round | `status "Round updates"` | |

**Jobs and job page**

| Where | Role and accessible name | Visible copy or notes |
|---|---|---|
| Jobs | `table "Jobs"`, `button "New estimate"` | |
| Estimate | `dialog "Estimate"` with `combobox "Car"`, `textbox "Job title"`, `button "Add line"` and `button "Save estimate"` | Opened by `New estimate` or `Edit estimate` |
| Estimate line | `combobox "Line kind"`, `textbox "Description"`, `textbox "Quantity"`, `textbox "Unit price (CHF)"`, `button "Remove line <n>"` | Unit price is hidden for labour lines |
| Job page, portal job | `region "Car plan"`, `region "Cross-section"`, `region "Job ledger"` | The three panes |
| Job page, portal job | `heading "Job ledger"` (level 2) inside `region "Job ledger"` | Can take focus programmatically |
| Job page | `group "Panel map"`, with one `button` per panel | A panel with a reading at the current stage is named `<panel name>, <reading> <unit>, <band label>`, otherwise `<panel name>, No reading`. The selected panel is marked pressed. Examples: `Bonnet, 158 µm, Factory`, `Bonnet, 6.2 mil, Factory` |
| Job page | `slider "Stage"` | Value text `<stage name>, stage <position> of <count>` |
| Job page | `button "Reading history"` opens `dialog "Reading history: <panel name>"` | |
| Job page | Text labelled `Total film build` | Monospace, with its unit |
| Job page | `table "Panel readings"` | One row per panel at the current stage: panel, reading, band |
| Job page | `status "Stage announcer"` | |
| Job ledger | `button "Edit estimate"`, `button "Send to owner"`, `button "Revise estimate"`, `button "Log stage"`, `button "Add reading"`, `button "Mark finished"`, `button "Issue invoice"`, file input labelled `Stage photo`, `button "Upload stage photo"` | Each shows only while its action is legal for the job's current server status |
| Job ledger | Text labelled `Estimate` | An estimate label from Feedback states |
| Job page | `dialog "Log stage"` with `combobox "Stage"`, one `textbox "<panel name> reading"` per panel, `button "Save stage"` and `button "Cancel"` | |
| Job page | `dialog "Add reading"` with `combobox "Logged stage"`, `combobox "Panel"`, `textbox "Reading"`, `button "Save reading"` and `button "Cancel"` | |
| Job page, portal job | `status "Job updates"` | |
| Portal job | `button "Approve estimate"`, `button "Decline estimate"` | |
| Portal job | `button "Decline estimate"` opens `dialog "Decline estimate?"` with `button "Decline"` and `button "Keep estimate"` | |

**Owner portal**

| Where | Role and accessible name | Visible copy or notes |
|---|---|---|
| My cars | `list "My cars"`, with one `listitem` card per car holding `link "<car name>"` | The card's bay line and bay-billing line from Feedback states |
| My cars | `status "Car updates"` | |

**Releases**

| Where | Role and accessible name | Visible copy or notes |
|---|---|---|
| Releases | `table "Releases"`, with `button "Book release"`, `button "Car staged"`, `button "Complete release"` and `button "Cancel release"` on each row | Each button shows only while its action is legal. The hold label shows in the row while it applies |
| Releases, portal release, request release | `status "Release updates"` | |
| Request release | `textbox "Date"`, `combobox "Time"`, text `Earliest slot: <slot label>`, `button "Request release"` | |
| Portal release | Level-1 `heading` with the release heading, then the hold line while it applies, then `button "Cancel release"` | The button shows while the owner may cancel |

**Board, invoices and staff access**

| Where | Role and accessible name | Visible copy or notes |
|---|---|---|
| Board | `region "Occupancy"`, `region "Overdue care"`, `region "Unpaid invoices"`, each headed by a level-2 heading of the same name | The occupancy line and unpaid line from Feedback states |
| Board | `button "Record bank transfer for <invoice number>"` on each unpaid invoice opens `dialog "Record bank transfer"` | |
| Record bank transfer | `textbox "Bank reference"`, `textbox "Amount (CHF)"` and `button "Record transfer"` | Amount is pre-filled with the balance when the dialog opens |
| Board, portal invoice, job ledger | Text labelled `Outstanding` | The outstanding line |
| Board, portal invoice, job ledger | `status "Invoice updates"` | |
| Staff access | `table "Staff access"`, with `button "Revoke access for <name>"` or `button "Restore access for <name>"` on each row | |
| Staff access | `button "Revoke access for <name>"` opens `alertdialog "Revoke access for <name>?"` holding the revoke confirmation text, `button "Revoke access"` and `button "Keep access"` | Copy in Feedback states |
| Staff access | `status "Access updates"` | |

**Combobox options and entry formats.** Each combobox offers exactly these options, and each `option` is named by its visible text.

| Control | Options or format |
|---|---|
| `combobox "Owner"` | One option per owner, named by name (for example `Kenji Arlow`), in the order `GET /api/owners` returns |
| `combobox "Car"` (estimate) | One option per `stored` car, named `<car name>`, ordered by bay code |
| `combobox "Item kind"` | `Key set`, `Cover`, `Spare wheel`, `Document`, for `key_set`, `cover`, `spare_wheel` and `document` |
| `combobox "Line kind"` | `Part`, `Labour`, `Paint materials`, for `part`, `labour` and `paint_materials` |
| `combobox "Stage"` | The published stage names, in their published order |
| `combobox "Logged stage"` | The job's logged stages, by name, in stage order |
| `combobox "Panel"` | The 12 panel names, in front-to-rear order |
| `combobox "Time"` | Every half hour from `08:00` to `17:30` inclusive, written `HH:MM` in 24-hour time: 20 options |
| `textbox "Date"` | Typed as `YYYY-MM-DD`, for example `2026-11-03`: the Zurich calendar date of the slot |

The request form joins Date and Time into the slot format the API expects. To pre-fill the earliest slot, the form puts its date in Date and selects its time in Time.

### Interactions (DP-10, DP-21, DP-36, DP-37, DP-41, DP-49, DP-50, DP-51, DP-52, DP-53, DP-54, DP-55, DP-58, DP-61, DP-64, DP-65, DP-66, DP-67, DP-68, DP-70, DP-74, DP-76, DP-78, DP-79)

**Dialogs.**
- A dialog opens with focus on its first field. The revoke alert dialog is the one exception: it opens with focus on `Keep access`.
- Tab and Shift+Tab cycle inside it: Tab from the last control goes to the first, and Shift+Tab from the first goes to the last. Focus never leaves an open dialog for the page behind or the browser's own controls.
- Escape or the cancel button closes it and returns focus to the control that opened it.
- While a dialog is open, the page behind it cannot be reached by keyboard or pointer. The screen's status region still reaches assistive technology.
- After a successful save, the dialog closes, focus returns to the opener, and the result is announced in that screen's status region.
- If the opener no longer exists when a dialog closes, focus moves to the heading of the pane or screen that held it. On the job pages that is `heading "Job ledger"`; on the care round it is `heading "Care round"`; on the board it is the heading of `region "Unpaid invoices"`.

**Menu (below 768 pixels).**
- While closed:
  - `button "Menu"` has `aria-expanded="false"`;
  - no link inside `navigation "Main"` is visible, focusable or in the accessibility tree. Moving the navigation off-screen does not count as closed.
- Opening it sets `aria-expanded="true"` and moves focus to the first link.
- Escape closes it and returns focus to Menu.
- Following a link closes it.

**Search cars.**
- Typing in `searchbox "Search cars"` filters `table "Cars"`, with no submit button and no reload.
- A search is sent 300 milliseconds after the latest keystroke.
- The table always shows the answer for the latest text in the box. An answer for earlier text that arrives later is discarded: it never changes the table, the address or Bay updates.
- When the table shows the answer for the latest text, the address is updated to `/bays?q=<that text, percent-encoded>` by replacing the current history entry, never by adding one. When the box is cleared, `q` is removed from the address and every car shows.
- Opening `/bays?q=<text>`, by reload or a shared link, puts the text in the box and shows the filtered table on first load, with no announcement.
- Bay updates announces the count once per settled search. The first load announces nothing.

**Floor plan.**
- The floor plan is a single Tab stop. Tab lands on the selected bay, or on the first bay when none is selected.
- Arrow keys move between bays by row and column, and stop at the edges.
- Enter or Space activates the focused bay:
  - on Bays and the Board, it opens that bay's car;
  - inside "Choose bay", it selects an eligible bay and moves focus to "Assign bay <code>".
- An ineligible bay can still take focus and keeps its reason in its name, but activating it does nothing.
- By touch, a tap does what Enter does.

**Panel map.**
- The panel map is a single Tab stop, landing on the selected panel.
- ArrowRight and ArrowDown move to the next panel, and ArrowLeft and ArrowUp to the previous one. They follow the published front-to-rear order and stop at both ends.
- Moving focus also selects the panel, which updates the cross-section, the numeral and the address.
- Enter or Space opens the panel's reading history.
- By touch, a tap selects a panel, and the "Reading history" button opens the selected panel's history.

**Stage scrubber.**
- ArrowRight and ArrowUp step one stage forward. ArrowLeft and ArrowDown step one stage back.
- Home jumps to the first stage and End to the last.
- Dragging with a pointer or finger snaps to the nearest stage. Tapping a stage tick jumps to that stage.
- A jump across several stages plays as one step, straight to the target.

**Address state.**
- Selecting a panel or stage replaces the current history entry with the new `stage` (a zero-based index into the job's logged stages) and `panel` (a panel id).
- A missing or invalid value falls back to the latest logged stage and the bonnet.
- A job with no logged stage shows every panel at "No reading", with the scrubber disabled.

**Units.** Saving the units dialog changes every reading on every screen at once, including the field labels of open dialogs. The choice is stored with the user's account.

**Care round entry.**
- Pressure fields take the user's pressure unit.
- Leaving all four tyre fields empty records no pressures.
- Filling only some of them is a field error.

**Estimate versions.**
- The job page holds the version of the job as it last read it. `Send to owner` sends that version.
- `Edit estimate` opens `dialog "Estimate"` holding the version shown when it opened. Re-reads never change the version the dialog holds.
- When saving or sending answers `estimate_changed`, the Estimate dialog (if open) stays open with every typed value and focus on `Save estimate`, and Job updates shows the estimate-changed copy. Nothing on the page changes until the lead reloads.

**Request release.**
- The form shows the server's earliest slot and pre-fills it.
- The browser never decides on its own whether a slot is allowed. It submits the slot and shows the server's answer.

**Server time decides.** The device clock may be wrong by days. Screens show start-up status, estimate expiry and slot eligibility only as the server reports them. In particular, `Approve estimate` and `Decline estimate` stay visible while the server reports the job as sent, whatever the device clock says, and the browser sends the press and shows the answer.

**Lost answers.** Four actions hold one idempotency key from their first press until the server answers:
- Round entry;
- Issue invoice on an open job page;
- Request release;
- Record bank transfer.

If a request ends with no HTTP answer at all (the connection drops or the request is cut off):
1. The form stays as it is, with every value.
2. Its status region shows the no-answer copy.
3. Pressing again resends with the same key. If the user edited a value in between, the edited values go with that same key, and the server answers as stated in API.

Any server answer other than `401 session_expired`, or closing the form, discards the key. The next press then uses a new one. A `session_expired` answer keeps the key and marks the action as interrupted (see Session end).

**Error results stay.**
- An error result stays in its status region until the user's next press or submission on that screen.
- Re-reads and service-notice checks never clear, replace or repeat it.
- Focus stays on the control that was pressed for as long as that control exists.
- Pressing again shows the pending copy, then the new answer.

**Re-reads.** Open screens re-read the server on the schedule in Business rules. Each re-read updates only the values that changed, in place. A re-read never:
- closes, re-opens or re-renders an open dialog;
- rewrites a value the user is typing, has edited or was given when the dialog opened;
- moves focus or resets the scroll position of the page or of a pane;
- restarts, hides or advances an upload progress bar;
- repeats an announcement.

A re-read that finds nothing changed changes nothing on screen.

For example, the concierge has "Add item" open with a typed label and focus in Count when a re-read turns `Bay billing pending` into the paid-through label. The dialog, the label and the focus stay as they were, and Belongings updates says nothing new.

**Rows and cards that move.** A re-read can move a car's row or card to a new position: on the care round, between the overdue group and the rest; on My cars, when a released car loses its bay and its card moves to the end. When it does:
- the row or card moves to its published position;
- a control inside it that had focus keeps focus after the move;
- an open dialog stays open, with its values and focus unchanged;
- the scroll position stays where it was, and nothing is announced for the move itself;
- cancelling a round-entry dialog returns focus to that car's `Log round entry for <car name>` button in its new position.

The round keeps re-reading behind an open dialog; it never pauses.

**A car that leaves the round.** A care-round re-read can remove a car entirely, for example because it was released elsewhere. Its row or card disappears, and the masking-tape mark goes with it. If that car's `Round entry: <car name>` dialog is open, it stays open with every value and focus unchanged. Pressing Save entry then gets `car_not_stored`:
1. the dialog closes;
2. focus moves to `heading "Care round"`, because the opener no longer exists;
3. Round updates shows the car-not-stored copy from Feedback states, which stays across later re-reads until the technician's next press.

No entry is recorded and the key is discarded.

**Dialogs whose record changes.** A re-read can change or remove the record behind an open dialog, for example an invoice in Unpaid invoices behind Record bank transfer, or a sent estimate behind Decline estimate. The dialog stays open with every value and its focus as they were, and only the screen behind it updates. Submitting then gets the server's answer for the record's current state.

**Estimate answers on the job page.** When a re-read of the job page finds the job approved, declined or expired:
- the estimate label changes in place;
- the Job ledger's buttons appear or disappear in place to match the legal actions (for example `Log stage` after approval, `Revise estimate` after a decline or expiry);
- `status "Job updates"` announces the change once, with the copy in Feedback states. The first load and unchanged re-reads announce nothing, and a change made by the lead's own action is announced by that action only;
- focus and scroll stay put. If the focused control is one the change removes, focus moves to `heading "Job ledger"`, never to the page body.

The Jobs table updates the job's Status cell in place on its re-read and announces nothing.

**Estimate expiry on the portal job page.** When a re-read finds the estimate expired, the Job ledger behind any open dialog updates in place (it shows `Expired` and removes the approve and decline buttons), and nothing is announced. An open `dialog "Decline estimate?"` stays open with focus where it was. Pressing `Decline` then gets `estimate_expired`:
1. the dialog closes;
2. focus moves to `heading "Job ledger"`, because the opener no longer exists;
3. Job updates shows the decline-expired copy from Feedback states, which stays across later re-reads until the owner's next action.

**My cars and the car page.** When a re-read finds a car changed, its card or bay section updates in place: the bay line, start-up status and bay-billing line. When a car's bay billing first shows its end date, My cars announces it once in `status "Car updates"`. The first load, unchanged re-reads and the car page announce nothing.

**Releases table focus.** A re-read can remove the focused action in a row because the release changed elsewhere. Focus then moves to the first remaining action in that row, or to the row's car cell if no action remains. It never falls to the page body.

**Portal release page.** When a re-read finds a new status, the heading changes in place and Release updates announces the change once. The first load announces nothing. A status produced by the owner's own action is announced by that action only.

**Portal invoice page.** When a re-read finds a changed balance or status, the lines update in place without navigation, and Invoice updates announces the change once. The first load and an unchanged re-read announce nothing. Focus and scroll never move.

**Success waits for the server.** Pressing an action shows only its pending state. Rows, labels, floor-plan bays, photo lists and invoice lines keep their values until the server answers:
- on success, they show the server's values;
- on an error, they stay as they were and the error copy appears.

No thumbnail, local preview, "Released", "Free", "Paid" or new row ever appears before the answer.

**Revoke confirmation.**
1. `Revoke access for <name>` opens the alert dialog with focus on `Keep access`. Tab and Shift+Tab wrap inside it and the page behind is inert.
2. Escape or `Keep access` closes it, changes nothing and returns focus to the opener.
3. `Revoke access` sends the revoke. On success, the dialog closes, the row updates in place to its revoked label, Access updates announces the result once, and focus moves to that row's new `Restore access for <name>` button, never to the page body.
4. Restore needs no confirmation. After a restore, focus moves to the row's new `Revoke access for <name>` button.

**Session end.**
- **On a screen's first load,** any 401 sends the user to `/sign-in?next=<its path and query>` as stated in Business rules. If the code was `access_revoked`, the sign-in page also shows the error summary with the revoked copy.
- **After first load,** a 401 on a re-read or action:
  - `access_revoked`: goes to `/sign-in` with no return address, and the sign-in page shows the error summary with the revoked copy;
  - `unauthenticated`: goes to `/sign-in` with no return address and no summary;
  - `session_expired`: the screen stays where it is (no navigation, no reload) and opens `dialog "Sign in again"`.

**Sign in again.**
- It opens on top of everything, including any dialog already open, with focus on `textbox "Password"`. Several requests that meet `session_expired` together open one dialog.
- Every dialog that was already open stays mounted behind it with every typed value. The rest of the screen is inert while it is open. Re-reads pause until it closes.
- Tab and Shift+Tab wrap inside it. Escape does not close it; signing in is the only way on from it in place.
- `Sign in again` posts the session user's email and the typed password to the sign-in endpoint. A refusal shows the sign-in-again error copy under Password and keeps the dialog open.
- After a successful sign-in, the dialog closes, re-reads resume, and focus returns to the control that had it before the dialog opened. Then:
  - if one of the four idempotent actions met `session_expired`, the screen resends it once, automatically, with the same `Idempotency-Key` and the same body. Its region shows the pending copy and then the server's answer;
  - any other action that met `session_expired` is not resent. Its region shows the signed-in-again copy;
  - a form that holds a key from a lost answer still holds it, so pressing it again replays with that key.

### Visual design (DP-42, DP-43, DP-72)

**Character.** The app looks like a workshop build sheet: calm, exact and tactile.
- The page is a flat, warm putty-grey.
- Ink is a near-black with a slightly cool cast.
- Thin warm-grey hairline rules divide a rigid 12-column grid.
- Nothing has depth beyond a single hairline. No panel floats on a soft shadow; rules separate them.

**Colour roles.**
- Actions and the primary button use a lacquer red-orange.
- Masking-tape yellow marks only the single thing in progress on a screen:
  - the current stage tick on the scrubber;
  - the care-round row whose entry dialog is open (the mark follows the row if it moves);
  - the release currently staged on the Releases table.
- The fading tape edge on a newly saved row is yellow's only other use.
- Errors and the hold label use red-orange together with an icon and text, never colour alone.

**Type.**
- The display face is Archivo stretched to its expanded width. It sets car identity, screen titles and the labels of big numerals.
- The body face is IBM Plex Sans.
- Every reading, amount, code and fingerprint is set in IBM Plex Mono with its unit, for example "158 µm", "12.62 V" or "CHF 4470.70".
- Each heading level is about a third larger than the one below it, and the car identity headline sits about four such steps above body text.
- The fonts ship with the app.

**Density.** Comfortable: rows have room to breathe and tables keep a generous line height. Every control, bay and panel has a touch target of at least 44 by 44 pixels.

**Reading bands.** Each band is shown three ways at once — tint, pattern and a short text label — so it never depends on colour alone:

| Band | Tint | Pattern |
|---|---|---|
| Thin | Cool blue-grey | Fine dots |
| Factory | Pale sage | Horizontal lines |
| Refinished | Warm ochre | Diagonal lines |
| Filler suspected | Light red-orange | Cross-hatching |

Panels with no reading are plain putty with a dashed outline.

**Car plan.** The car is drawn from shapes in code, never from a photograph: a top-down outline with the front at the top and 12 separately outlined panels. Panel names show on hover and in the table.

**Contrast.** Everything meets WCAG 2.2 AA at every published viewport, and the board, Staff access and the Record bank transfer dialog are measured exactly:
- Every piece of text has a contrast ratio of at least 4.5:1 against the surface it sits on. Large text — at least 24 pixels, or bold and at least 18.66 pixels — needs at least 3:1.
- The outline of every floor-plan bay, every coat-stack panel and every button or field, and the keyboard focus indicator, has at least 3:1 against the putty ground.
- Hairline dividers between panes and sections are decorative and exempt. Outlines of bays, panels and controls are not.
- The colour roles above are starting points, not finished shades. The lacquer red-orange as first described sits just under the small-text ratio on putty, and the warm-grey hairline is far too light for an outline. Any shade used for text, an error, an essential outline or the focus ring is deepened until it meets its ratio; the near-black ink meets both.
- Occupied and free bays differ by text and by pattern: an occupied bay names its car and carries a solid ink corner tab, while a free bay reads "Free" and has no tab.
- The board's unpaid line and every `Held: unpaid invoice` label carry an icon as well as text.

### Motion and effects (DP-38, DP-39)

**General motion.** Motion starts quickly and settles with a long, soft tail. Nothing bounces.
- There is no decorative or looping animation: no idle pulses, no shimmer, no spinning loaders.
- Upload progress uses a determinate bar.
- Dialogs fade in and rise a few pixels in about a fifth of a second, and close in about half that time.
- Buttons darken on hover and press within about a tenth of a second.
- A newly saved row gets a yellow tape edge that fades out over about half a second.
- Changes from a re-read swap text with no motion, and a row or card that moves position moves without animation.

**Signature: the coat stack step.** Moving the scrubber one step, or jumping to a stage, plays three phases in order:

1. **Panel wipe.** Each panel's fill changes to its band at the new stage. A straight edge sweeps across the panel from front to rear, revealing the new tint and hatch, in about half a second per panel. The panels start in the published front-to-rear order, about thirty milliseconds apart: the front valance first, and the boot lid about a third of a second later.
2. **Cross-section.** About a fifth of a second after the step, the selected panel's cross-section changes:
   - stepping forward, new layers grow upward from the bottom one at a time, each in about a fifth of a second;
   - stepping back, layers leave from the top down.
3. **Numeral.** As the cross-section starts, the "Total film build" numeral counts from its old value to the server value in the chosen unit. The count takes about seven tenths of a second, in monospaced digits so its width never jitters.

The whole step settles within about 1.2 seconds. A new step that arrives mid-step snaps the running one to its end state and starts at once. Stepping back plays the same phases toward the earlier stage.

**Reduced motion.** When the device asks for reduced motion:
- fills, layers and the numeral change instantly to the new stage, with no wipe, growth or count;
- dialogs appear and disappear instantly;
- the saved-row tape edge appears without fading.

The scrubber, the panel map and every action work exactly as with motion. The stage announcement follows every step either way.

### Feedback states (DP-34, DP-39, DP-40, DP-47, DP-50, DP-51, DP-52, DP-54, DP-59, DP-63, DP-64, DP-65, DP-66, DP-67, DP-68, DP-69, DP-70, DP-74, DP-76, DP-79)

**General rules.**
- Every async action shows its pending text on screen and in its status region at once. The answer replaces it with success or error text.
- Each result is announced once.
- Field errors appear under their fields, using the API's messages, and in the error summary.
- Every string below uses straight apostrophes and renders character for character.

**Placeholders.** Every date and time follows the Dates and times rule in Business rules.

| Placeholder | Meaning |
|---|---|
| `<date>` | A Zurich calendar date written day, short month, year, for example `3 Nov 2026` |
| `<slot label>` | A Zurich slot, for example `Tue 3 Nov 2026, 10:30` |
| `<moment label>` | A Zurich date and time in the slot-label form, for example `Tue 3 Nov 2026, 10:42` |
| `<total>` | A CHF amount with two decimals and no thousands separator |
| `<amount>` | The amount entered, in the same CHF format |
| `<balance>` | The invoice's balance as Kill Bill reports it, or its last confirmed balance, in the same CHF format |
| `<unpaid total>` | The board's unpaid total, in the same CHF format |
| `<invoice numbers>` | The holding invoices' numbers, joined by `, ` |
| `<owner name>` | The car owner's name, for example `Kenji Arlow` |
| `<reading> <unit>` | Always written together: `<reading>` is whole micrometres, or mil to one decimal, and `<unit>` is `µm` or `mil`. For example `158 µm` or `6.2 mil` |
| `<n>` | A whole number |

**Service notices.** These go in `status "Service notice"`, one line for each unreachable service. The notice area checks service status every 5 seconds.

| Service | Notice |
|---|---|
| Storage | `Photo storage is unreachable. Photos and condition reports can't be uploaded right now; bays, belongings and care rounds still work.` |
| Billing | `Billing is unreachable. Invoices can't be issued or paid right now; bay billing will catch up when it's back.` |
| Mail | `Email is unreachable. Owner emails are queued, and releases can't be completed until it's back.` |

**Not found.** Any page whose record is missing or not visible to the user shows the heading `We couldn't find that page`.

**Upload progress.** While an upload is pending, `progressbar "Upload progress"` follows the bytes sent but stops at 95 until the server answers.
- On a 201 answer it shows 100 and is then removed.
- On any error, or when the connection drops, it is removed at its current value, never at 100.

**Search.** Bay updates announces `<n> cars found.` once per settled search, or `1 car found.` when exactly one car matches.

**No-answer copy.** This shows in the form's status region when a request gets no HTTP answer:

| Form | Region | Copy |
|---|---|---|
| Round entry | Round updates | `No answer from the server. Press Save entry again; it won't be logged twice.` |
| Issue invoice | Job updates | `No answer from the server. Press Issue invoice again; it won't be issued twice.` |
| Request release | Release updates | `No answer from the server. Press Request release again; it won't be requested twice.` |
| Record bank transfer | Invoice updates | `No answer from the server. Press Record transfer again; it won't be recorded twice.` |

When any of these four forms gets `idempotency_conflict`, its region shows `This was already sent with different values. Close this form and check the latest record.`

**Sign in again.**
- Dialog text: `Your session has ended. Sign in again to carry on.`
- Pending, under Password: `Signing in...`
- Refusal, under Password: `Email or password is wrong.`
- An action that met the expiry and is not resent shows, in its own region: `Signed in again. Nothing was saved; press again.`

**Revoke confirmation.** The alert dialog's text is `<name> will be signed out on every device.`

**Sign-in, units, cars and files**

| Action | Region | Pending | Success | Errors |
|---|---|---|---|---|
| Sign in | Error summary | `Signing in...` | Goes to the address from Business rules | `Email or password is wrong.` After a revoked session: `Your access has been revoked.` |
| Save units | Settings updates | `Saving units...` | `Units updated.` | |
| Register car | Bay updates | `Registering car...` | `<car name> registered.` | Field errors |
| Assign or move bay | Bay updates | `Assigning bay <code>...` | `<car name> assigned to bay <code>.` | bay_occupied: `Bay <code> was just taken. Choose another bay.` bay_too_small: `Bay <code> is too small for this car.` bay_class_change: `Bay <code> is a different bay class. Moves stay within the same class.` car_released: `This car has been released.` |
| Add item, check in, check out | Belongings updates | `Saving...` | `<label>: <count> checked in.` | insufficient_items: `Nothing left to check out for <label>.` car_released: `This car has been released.` |
| Upload condition report | Upload updates | `Uploading signed condition report...` | `Signed condition report stored for <car name>.` | report_already_signed: `A signed condition report is already stored for this stay.` 413: `That file is too large to upload.` Storage down: `Photo storage is unreachable. Nothing was uploaded; try again when the notice clears.` No answer: `The upload was cut off. Nothing was stored; upload it again.` |
| Upload photo (intake or stage) | Upload updates | `Uploading <file name>...` | `Photo attached to <car name>.` | The 413, storage-down and cut-off copy as for the report |

**Care round and workshop**

| Action | Region | Pending | Success | Errors |
|---|---|---|---|---|
| Round entry | Round updates | `Saving round entry...` | With a start-up: `Start-up logged for <car name>. Next start-up due <date>.` Without one: `Round entry saved for <car name>.` A flagged entry appends ` Flagged: <flag labels joined by ", ">.` | car_not_stored: `This car is no longer in a bay.` |
| Save, send or revise estimate | Job updates | `Saving...` | Save: `Estimate <job number> saved.` Send: `Estimate <job number> sent to <owner name>.` Revise: `Estimate <job number> is a draft again.` | invalid_transition: `This job has moved on. Reload to see its current state.` estimate_changed (save or send): `Estimate <job number> was changed by someone else. Your edits are kept; reload to see the latest.` |
| Log stage | Job updates | `Saving stage...` | `<stage name> logged with <n> readings.` | stage_already_logged: `<stage name> is already logged for this job.` stage_out_of_order: `<stage name> can't be logged after a later stage.` invalid_transition: the copy above |
| Add reading | Job updates | `Saving reading...` | `Reading saved: <panel name> <reading> <unit>.` | invalid_transition: the copy above |
| Mark finished | Job updates | `Saving...` | `Job <job number> marked finished.` | invalid_transition: the copy above |
| Issue invoice | Job updates | `Issuing invoice...` | `Invoice <invoice number> issued for CHF <total>.` | invalid_transition: the copy above. Billing down: `Billing is unreachable. The invoice was not issued; try again when the notice clears.` |
| Approve estimate (owner) | Job updates | `Sending your answer...` | `Estimate approved. Work on your <car name> can begin.` | estimate_expired: `This estimate expired on <date> and can no longer be approved.` |
| Decline estimate (owner) | Job updates | `Sending your answer...` | `Estimate declined.` | estimate_expired: `This estimate expired on <date> and can no longer be answered.` |

In both estimate_expired copies, `<date>` is the Zurich date of the job's `expires_at`.

**Releases, payments and access**

| Action | Region | Pending | Success | Errors |
|---|---|---|---|---|
| Request release (owner) | Release updates | `Requesting release...` | Heading `We've received your release request` and the text `We'll confirm <slot label> by email once the concierge books it.` | slot_taken: `That slot was just taken. Choose another.` release_already_open: `This car already has an open release.` car_in_workshop: `This car is in the workshop and can't be released yet.` car_not_stored: `This car is not in a bay.` Slot field errors |
| Book, stage, complete or cancel release | Release updates | `Saving...` | Book: `Release booked for <car name>, <slot label>. The owner will be emailed.` Stage: `<car name> staged for handover.` Complete: `<car name> released. Bay <code> is free.` Cancel: `Release cancelled.` | invoice_unpaid: `Invoice <invoice numbers> is unpaid. Record the payment before release.` belongings_checked_in: `Check out every item first: <labels joined by ", ">.` Mail down: `Email is unreachable, so the release was not completed. Nothing has changed.` |
| Record bank transfer | Invoice updates | `Recording transfer...` | When the balance is now zero: `Invoice <invoice number> is paid.` Otherwise: `Payment of CHF <amount> recorded. CHF <balance> outstanding.` | already_paid: `This invoice is already paid.` The dialog closes and focus moves as in Interactions. Field errors keep the dialog open. Billing down: `Billing is unreachable. Nothing was recorded; try again when the notice clears.` |
| Revoke or restore access | Access updates | `Saving...` | `Access revoked for <name>.` or `Access restored for <name>.` | cannot_change_own_access: `You can't change your own access.` |

**Live copy found by re-reads.**

| Screen and region | Change found | Announcement |
|---|---|---|
| Portal release, Release updates | Booked | `Your release is booked for <slot label>.` |
| Portal release, Release updates | Staged | `Your car is ready for handover.` |
| Portal release, Release updates | Released | `Your car has been released.` |
| Portal release, Release updates | Cancelled | `Release cancelled.` |
| Portal invoice, Invoice updates | Balance fell and is still above zero | `Payment received. CHF <balance> outstanding.` |
| Portal invoice, Invoice updates | Balance reached zero | `Invoice <invoice number> is paid.` |
| Portal invoice, Invoice updates | A paid invoice has a balance again | `Invoice <invoice number> is awaiting payment again. CHF <balance> outstanding.` |
| Job page, Job updates | Approved | `<owner name> approved estimate <job number>.` |
| Job page, Job updates | Declined | `<owner name> declined estimate <job number>.` |
| Job page, Job updates | Expired | `Estimate <job number> expired on <date>.` |
| My cars, Car updates | A car's bay billing first shows its end date | `Bay billing for <car name> ends <date>.` |

The portal job page and the car page announce nothing for a change found by a re-read.

**Stage announcer.** After every scrubber step or panel change, `status "Stage announcer"` announces `<stage name>, stage <position> of <count>. <panel name>: <reading> <unit>, <band label>.` For a panel with no reading, it ends `<panel name>: no reading.` instead.

**Status labels.** These show on screen and are not announced.

| Subject | Labels |
|---|---|
| Start-up | `Start-up overdue`, `Next start-up due <date>`, `No start-up schedule` |
| My cars card bay line | `Bay <code>` while stored, `Awaiting intake` before intake, `Released` once released |
| Invoice status | `Awaiting payment`, `Paid`. When the balance is not live: `Paid, last confirmed <date>` |
| Outstanding line (while awaiting payment) | `Outstanding: CHF <balance>`. When not live: `Outstanding: CHF <balance>, last confirmed <date>` |
| Board unpaid line | `Unpaid: CHF <unpaid total>`. If any invoice in it is not live: `Unpaid: CHF <unpaid total>, last confirmed <date>`, where `<date>` is the earliest last-confirmed date among those invoices |
| Occupancy line | `<n> of <n> bays occupied` (occupied, then total) |
| Bay billing | `Bay billing pending`, `Billed monthly, paid through <date>`, `Bay billing ends <date>` |
| Estimate | `Draft`, `Sent, approve by <date>`, `Approved`, `Declined`, `Expired`, `In progress`, `Finished`, `Invoiced`, `Paid` |
| Portal release heading | `Release requested`, `Your release is booked`, `Your car is ready for handover`, `Released`, `Release cancelled` |
| Releases row hold | `Held: unpaid invoice` while the release is open and held |
| Portal release hold line | `Your car is held until invoice <invoice numbers> is paid.` while the release is staged and held |
| Staff access row | `Active` or `Access revoked <date>` |

An invoice is "not live" when its `balance_live` is false. `Sent, approve by <date>` uses the Zurich date of `expires_at`; `paid through` uses `charged_through_date`; `ends` uses `billing_end_date` and shows whenever it is set; `last confirmed` uses `status_confirmed_at`; `Access revoked` uses `revoked_at`.

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-23, DP-46, DP-47, DP-52, DP-56, DP-60, DP-63, DP-66, DP-75, DP-77, DP-79)

All endpoints sit under `/api`. Request and response bodies are `application/json; charset=utf-8`, except uploads (`multipart/form-data`) and file downloads.

**Formats.**
- Money is a string with exactly two decimals, for example `"4470.70"`.
- `quantity` is a decimal string. Requests may send up to two decimals; responses always carry two.
- A labour line's `unit_price` is omitted or `null` in requests, and is `"145.00"` in responses.
- A payment `amount` is a decimal string with at most two decimals.
- Timestamps are ISO 8601 UTC with `Z`.
- Dates are `YYYY-MM-DD`: Zurich calendar dates, or for Kill Bill dates exactly the date Kill Bill returns.
- Release slots are Zurich local `YYYY-MM-DDTHH:MM`, with no offset.
- Readings come back in stored units:
  - `film_um`: integer micrometres;
  - pressures: bar strings with two decimals;
  - `odometer_km`: integer kilometres;
  - `battery_v`: a string with two decimals.

**Error shape.** Every error body is `{"error":"<code>"}`, with three exceptions:
- validation answers `422 {"errors":{"<field>":"<message>"}}`, using paths such as `lines[0].quantity` for nested fields;
- `belongings_checked_in` adds an `items` member;
- `invoice_unpaid` adds an `invoices` member.

Statuses and codes:

| Status | Codes |
|---|---|
| 401 | `unauthenticated`, `access_revoked`, `session_expired`, `invalid_credentials` (sign-in only) |
| 403 | `forbidden` |
| 404 | `not_found` |
| 409 | One of the conflict codes below |
| 412 | `estimate_changed` |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type` |
| 503 | `storage_unavailable`, `billing_unavailable`, `mail_unavailable` |

**Precedence.** Checks run in this order, and the first failure answers:
1. Size and content type (413, 415).
2. A state-changing request from another origin (403).
3. Session (401): `access_revoked` for a session ended by a revoke, then `session_expired` for a session past its lifetime, then `unauthenticated` for no cookie, an unknown cookie or a signed-out session.
4. Idempotent replay, which returns its stored response.
5. An unknown or not-visible resource, including any id in the path or body (404).
6. Role (403).
7. State conflict (409), in the conflict order from Business rules.
8. Stale version (412).
9. Validation (422), including a missing `Idempotency-Key` or `If-Match`.
10. Provider failure (503).

Endpoint rows below list only their own success bodies and extra codes.

**Idempotency.** Four endpoints require an `Idempotency-Key` header of 1 to 100 characters:
- `POST /api/releases`
- `POST /api/jobs/{id}/invoice`
- `POST /api/cars/{id}/care-entries`
- `POST /api/invoices/{id}/payments`

Rules:
- A missing key answers `422 {"errors":{"idempotency_key":"Send an Idempotency-Key header."}}`.
- Keys are scoped to the signed-in user (not the session) and the route, so a new session of the same user replays the same key.
- Records live in Postgres and are shared by every app process serving that database.
- A 2xx response is kept for at least 24 hours. A replay with the same body, on any process, returns that status and body with no second effect.
- The same key with a different body answers `409 {"error":"idempotency_conflict"}`.
- Failed attempts are not stored, so a request that met a 503 on one process may be retried with the same key on any process.
- Concurrent requests with one key and one body produce one effect and all receive the same response.

**Job versions.**
- `GET /api/jobs/{id}`, and every response that returns one job, carries the header `ETag: "<version>"`: the job's `version` in double quotes.
- `PATCH /api/jobs/{id}` and `POST /api/jobs/{id}/send` require `If-Match: "<version>"`, the version the edit or send was made from, in the same quoted form.
- A missing `If-Match` answers `422 {"errors":{"if_match":"Send the estimate version you edited."}}`.
- An `If-Match` that differs from the job's current version answers `412 {"error":"estimate_changed"}`. The job is unchanged and no email is sent or queued.

**Objects.**
- **User:** `{"id","name","email","role"}`. `role` is one of `concierge`, `care_technician`, `workshop_lead`, `house_manager` or `owner`.
- **Actor:** `{"id","name"}`.
- **Car:**
  - identity and owner: `"id"`, `"name"`, `"year"`, `"make"`, `"model"`, `"registration"`, `"colour"`, `"owner":{"id","name"}`;
  - size and specification: `"length_mm"`, `"width_mm"`, `"odometer_km"`, `"tyre_spec_bar"`;
  - stay: `"status"` (`"awaiting_intake"`, `"stored"` or `"released"`) and `"bay"`, which is `{"id","code","class"}` or `null`;
  - `"startup"`: `{"scheduled":bool,"last_at":ts|null,"next_due":date|null,"status":"ok"|"overdue"|"not_scheduled"}`;
  - `"bay_billing"`: `{"status":"none"|"pending"|"active"|"ending","plan":str|null,"monthly_price":money|null,"charged_through_date":date|null,"billing_end_date":date|null,"cancel_requested":bool}`;
  - `"open_release":bool`.
- **Car detail:** a Car plus `"belongings":[Item]`, `"condition_report":Report|null`, `"photos":[Photo]`, `"care_entries":[Entry]` (the latest 20, newest first), `"jobs":[{"id","number","title","status"}]` and `"releases":[Release]`.
- **Bay:** `{"id","code","class":"standard"|"covered_lift"|"sealed_capsule","length_mm","width_mm","row","column","car":{"id","name"}|null}`. With `?fits=<car id>`, each bay adds `"eligible":bool` and `"reason":"occupied"|"too_small"|"class_change"|null`.
- **Item:** `{"id","kind":"key_set"|"cover"|"spare_wheel"|"document","label","count_in"}`.
- **Movement:** `{"id","direction":"in"|"out","count","at","by":Actor}`.
- **Report:** `{"id","car_id","sha256","size_bytes","uploaded_at","uploaded_by":Actor}`.
- **Photo:** `{"id","car_id","kind":"intake"|"stage","job_id"|null,"content_type","size_bytes","attached":true,"created_at"}`.
- **Entry:** `{"id","at","by":Actor,"started":bool,"battery_v"|null,"tyres_bar":{"fl","fr","rl","rr"}|null,"note","flags":["battery_low"|"tyre_pressure"]}`.
- **Line:** `{"id","kind":"part"|"labour"|"paint_materials","description","quantity","unit_price","net","vat"}`.
- **Job:** `{"id","number","version","car":{"id","name"},"owner":{"id","name"},"title","status":"draft"|"sent"|"approved"|"declined"|"expired"|"in_progress"|"finished"|"invoiced"|"paid","lines":[Line],"net_total","vat_total","rounding","total","currency":"CHF","sent_at","expires_at","approved_at","declined_at","finished_at","stages":[{"id","index","name","logged_at","readings_count"}],"invoice_id"}`. `version` is an integer. Unset values are `null`.
- **Invoice:**
  - identity: `"id"`, `"number"`, `"job_id"`, `"car":{"id","name"}`, `"owner":{"id","name"}`;
  - lines and totals: `"lines":[Line]`, `"net_total"`, `"vat_total"`, `"rounding"`, `"total"`, `"currency":"CHF"`;
  - payment state: `"balance"`, `"balance_live":bool`, `"status":"awaiting_payment"|"paid"`, `"issued_at"`, `"paid_at"|null`, `"status_confirmed_at"`;
  - `"payments"`: `[{"killbill_payment_id","amount","refunded","reference"|null,"at","recorded_by":Actor|null}]`, oldest first;
  - `"killbill_invoice_id"`.
- **Release:** `{"id","car":{"id","name"},"owner":{"id","name"},"slot","slot_label","status":"requested"|"booked"|"staged"|"released"|"cancelled","bay_code","held_by":[{"id","number","balance"}],"events":[{"status","at","by":Actor}]}`.
- **Member:** `{"id","name","email","role","active","revoked_at"|null,"last_sign_in_at"|null}`.

**Payment fields.**
- `payments` lists every Kill Bill payment against the invoice, including any made outside the app.
- `killbill_payment_id`, `amount`, `refunded` and `at` come from Kill Bill. `refunded` is `"0.00"` when nothing has been refunded.
- `reference` and `recorded_by` come from the house's record of who entered each bank transfer. They are `null` for a payment entered elsewhere.

**Owner projection.** Every response to an owner differs from the staff response in three ways:
1. Any actor who is a staff member appears as exactly `{"id":"house","name":"Marrow & Lark Motor House"}`. This covers `by` on entries, movements and release events, `uploaded_by` on reports, and `logged_by` on readings, including inside nested objects. The owner's own actions show the owner.
2. Invoices omit `killbill_invoice_id`.
3. Each payment omits `killbill_payment_id` and `recorded_by`.

Staff responses always show the real actors. Portal pages render the same projected values.

**Session, status and settings**

| Method and path | Request | Success and extra errors |
|---|---|---|
| `POST /api/session` | `{"email","password","next"}`. `next` is optional | `200 {"user":User,"redirect":"<path>"}`, where `redirect` follows the return-address rule. Starts a new session and sets an HttpOnly, SameSite=Lax session cookie. Also used by Sign in again. 401 invalid_credentials |
| `DELETE /api/session` | | `204` |
| `GET /api/me` | | `200 {"user":User,"units":{"film":"um"|"mil","pressure":"bar"|"psi","distance":"km"|"mi"}}` |
| `PUT /api/me/units` | `{"film","pressure","distance"}` | `200 {"units":{...}}` |
| `GET /api/health` | No session needed | `200 {"status":"ok"}` |
| `GET /api/status` | No session needed | `200 {"storage":"up"|"down","billing":"up"|"down","mail":"up"|"down"}` |
| `GET /api/house` | | `200 {"name","time_zone":"Europe/Zurich","currency":"CHF","vat_rate":"8.1","labour_rate":"145.00","clearance_mm":500}` |

**Cars, bays, belongings and files**

| Method and path | Request | Success and extra errors |
|---|---|---|
| `GET /api/owners` | | `200 {"owners":[{"id","name","email"}]}` |
| `GET /api/cars?q=<text>` | `q` matches name, registration or owner name, ignoring case | `200 {"cars":[Car],"total":n}`. For an owner, cars come in the card order from Business rules |
| `POST /api/cars` | `{"owner_id","year","make","model","registration","colour","length_mm","width_mm","odometer":{"value","unit":"km"|"mi"},"tyre_spec":{"value","unit":"bar"|"psi"},"startup_schedule":bool}` | `201 {"car":Car}`, as `awaiting_intake`. An unknown `owner_id` answers 404 |
| `GET /api/cars/{id}` | | `200 {"car":Car detail}` |
| `GET /api/bays?fits=<car id>` | `fits` is optional | `200 {"bays":[Bay]}`, ordered by row and then column |
| `POST /api/cars/{id}/bay` | `{"bay_id"}` | `200 {"car":Car}`. 409 `bay_occupied`, `bay_too_small`, `bay_class_change`, `car_released` |
| `POST /api/cars/{id}/belongings` | `{"kind","label","count"}` | `201 {"item":Item}`. Records an `in` movement of `count`; 0 is allowed. 409 `car_released` |
| `POST /api/belongings/{id}/movements` | `{"direction":"in"|"out","count"}` | `201 {"item":Item,"movement":Movement}`. 409 `insufficient_items`, `car_released` |
| `GET /api/belongings/{id}/movements` | | `200 {"movements":[Movement]}`, oldest first |
| `POST /api/cars/{id}/condition-report` | Multipart field `file` | `201 {"report":Report}`. 409 `report_already_signed`. 503 storage_unavailable |
| `GET /api/condition-reports/{id}/file` | | `200` with `Content-Type: application/pdf` and the exact stored bytes. 503 storage_unavailable |
| `POST /api/cars/{id}/photos` | Multipart fields `kind` and, for stage photos, `job_id`, sent before `file` | `201 {"photo":Photo}`. A `job_id` that is not one of this car's jobs answers 404. 503 storage_unavailable |
| `GET /api/photos/{id}/content` | | `200` with the image bytes and their content type. 503 storage_unavailable |

**Care**

| Method and path | Request | Success and extra errors |
|---|---|---|
| `GET /api/care-round` | | `200 {"cars":[{"car":{"id","name"},"bay_code","startup":{...},"last_entry":Entry|null}]}`. Only `stored` cars. Overdue cars come first, then the rest; each group is ordered by bay code |
| `POST /api/cars/{id}/care-entries` | `{"started":bool,"battery_v":str|null,"tyres":{"unit":"bar"|"psi","fl","fr","rl","rr"}|null,"note":str}` with an Idempotency-Key | `201 {"entry":Entry,"startup":{...},"message":"<round success copy>"}`. 409 `car_not_stored` |

**Workshop and invoices**

| Method and path | Request | Success and extra errors |
|---|---|---|
| `GET /api/jobs` | | `200 {"jobs":[Job]}` |
| `POST /api/jobs` | `{"car_id","title","lines":[{"kind","description","quantity","unit_price"}]}` | `201 {"job":Job}`, as `draft` with `version` 1. 409 `job_already_open`, `car_not_stored` |
| `GET /api/jobs/{id}` | | `200 {"job":Job}` with ETag |
| `PATCH /api/jobs/{id}` | `{"title","lines"}` with If-Match | `200 {"job":Job}`. 409 `invalid_transition`. 412 `estimate_changed` |
| `POST /api/jobs/{id}/send` | If-Match | `200 {"job":Job}`. 409 `invalid_transition`. 412 `estimate_changed` |
| `POST /api/jobs/{id}/revise` | | `200 {"job":Job}`. 409 `invalid_transition` |
| `POST /api/jobs/{id}/approve` | | `200 {"job":Job}`. 409 `estimate_expired`, `invalid_transition` |
| `POST /api/jobs/{id}/decline` | | `200 {"job":Job}`. 409 `estimate_expired`, `invalid_transition` |
| `POST /api/jobs/{id}/stages` | `{"name","readings":[{"panel","value","unit":"um"|"mil"}]}` | `201 {"stage":{...},"job":Job}`. 409 `invalid_transition`, `stage_already_logged`, `stage_out_of_order` |
| `POST /api/jobs/{id}/stages/{stage id}/readings` | `{"panel","value","unit"}` | `201 {"reading":{"id","panel","stage","film_um","logged_at","logged_by":Actor}}`. 409 `invalid_transition` |
| `GET /api/jobs/{id}/coat-stack` | | `200 {"job_id","panels":[{"id","name","order"}],"stages":[{"index","name","logged_at","panels":[{"panel","film_um":int|null,"band":"thin"|"factory"|"refinished"|"filler_suspected"|null,"layers":[{"stage","um"}]}]}]}` |
| `GET /api/jobs/{id}/panels/{panel}/readings` | | `200 {"panel","readings":[{"id","stage","film_um","logged_at","logged_by":Actor}]}`, oldest first |
| `POST /api/jobs/{id}/finish` | | `200 {"job":Job}`. 409 `invalid_transition` |
| `POST /api/jobs/{id}/invoice` | Idempotency-Key | `201 {"invoice":Invoice,"job":Job}`. 409 `invalid_transition`. 503 billing_unavailable |
| `GET /api/invoices` | | `200 {"invoices":[Invoice],"unpaid_total"}` |
| `GET /api/invoices/{id}` | | `200 {"invoice":Invoice}` |
| `POST /api/invoices/{id}/payments` | `{"reference","amount"}` with an Idempotency-Key | `200 {"invoice":Invoice}`, read back from Kill Bill after the payment. 409 `already_paid`. 503 billing_unavailable |

**Releases, board and staff**

| Method and path | Request | Success and extra errors |
|---|---|---|
| `GET /api/releases/earliest-slot` | | `200 {"earliest":slot,"earliest_label","time_zone":"Europe/Zurich"}` |
| `GET /api/releases` | | `200 {"releases":[Release]}` |
| `GET /api/releases/{id}` | | `200 {"release":Release}` |
| `POST /api/releases` | `{"car_id","slot"}` with an Idempotency-Key | `201 {"release":Release}`, as `requested`. 409 `car_not_stored`, `car_in_workshop`, `release_already_open`, `slot_taken` |
| `POST /api/releases/{id}/book` | | `200 {"release":Release}`. 409 `invalid_transition` |
| `POST /api/releases/{id}/stage` | | `200 {"release":Release}`. 409 `invalid_transition` |
| `POST /api/releases/{id}/complete` | | `200 {"release":Release,"car":Car}`. 409 `invalid_transition`. `409 {"error":"invoice_unpaid","invoices":[{"id","number","balance"}]}`. `409 {"error":"belongings_checked_in","items":[Item]}`. 503 mail_unavailable |
| `POST /api/releases/{id}/cancel` | | `200 {"release":Release}`. 409 `invalid_transition` |
| `GET /api/board` | | `200 {"occupancy":{"occupied","total"},"bays":[Bay],"overdue":[{"car":{"id","name"},"bay_code","startup":{...}}],"unpaid":{"invoices":[Invoice],"total","live":bool}}`. `overdue` is ordered by bay code. `live` is false when any listed invoice is not live |
| `GET /api/staff` | | `200 {"staff":[Member]}` |
| `PATCH /api/staff/{id}` | `{"active":bool}` | `200 {"member":Member}`. An owner's id answers 404. 409 `cannot_change_own_access` |

Unknown `/api` paths answer `404 {"error":"not_found"}`.

**Validation messages** (422, keyed by field):

| Field | Message |
|---|---|
| `email`, `password` | `Enter your email and password.` |
| `year` | `Enter a year from 1886 to <current year>.` |
| `make`, `model`, `colour` | `Enter 1 to 60 characters.` |
| `registration` | `Enter 1 to 20 characters.` |
| `length_mm` | `Enter a length from 2000 to 7000 mm.` |
| `width_mm` | `Enter a width from 1200 to 2600 mm.` |
| `odometer.value` | `Enter a whole odometer reading from 0 to 9999999.` |
| `tyre_spec.value` | `Enter a pressure from 0.50 to 5.00 bar.` |
| `label` | `Enter 1 to 60 characters.` |
| `count` | `Enter a whole number from 0 to 20.` For movements: `Enter a whole number from 1 to 20.` |
| `file` (report) | `Upload a PDF.` |
| `file` (photo) | `Upload a JPEG or PNG image.` |
| `entry` | `Record a start-up, a battery voltage or tyre pressures.` |
| `battery_v` | `Enter a voltage from 0.00 to 16.00 V.` |
| `tyres` | `Enter all four tyres from 0.50 to 5.00 bar.` |
| `note` | `Keep the note under 500 characters.` |
| `title` | `Enter 1 to 120 characters.` |
| `lines` | `Add at least one line.` |
| `lines[n].description` | `Enter 1 to 120 characters.` |
| `lines[n].quantity` | Part: `Enter a whole number of parts from 1 to 999.` Labour: `Enter hours in quarter-hour steps from 0.25 to 200.00.` Paint materials: `Enter a quantity greater than zero with up to two decimals.` |
| `lines[n].unit_price` | `Enter a price in CHF from 0.01 to 99999.99.` For a labour line that carries a price: `Labour is billed at the house rate.` |
| `if_match` | `Send the estimate version you edited.` |
| `name` (stage) | `Choose a stage from the list.` |
| `readings` | For Intake: `Intake needs a reading for every panel.` For other stages: `Add at least one reading.` |
| `readings[n].panel`, `panel` | `Choose a panel from the list.` The same message applies to a panel repeated within one stage |
| `readings[n].value`, `value` | `Enter a reading from 0 to 2000 µm.` In mil: `Enter a reading from 0.0 to 78.7 mil.` |
| `reference` | `Enter 1 to 60 characters.` |
| `amount` | `Enter an amount from 0.01 to <balance>.` |
| `slot` | Bad format: `Use a date and time like 2026-11-03T10:30.` Off the grid: `Choose a half-hour slot between 08:00 and 17:30, Monday to Saturday.` Too soon: `Releases need at least 48 hours' notice.` |
| `film`, `pressure`, `distance` | `Choose one of the listed units.` |

### Business rules (DP-01, DP-03, DP-05, DP-06, DP-07, DP-08, DP-09, DP-12, DP-13, DP-14, DP-16, DP-17, DP-18, DP-20, DP-22, DP-23, DP-25, DP-26, DP-27, DP-35, DP-47, DP-48, DP-49, DP-52, DP-53, DP-56, DP-57, DP-61, DP-62, DP-63, DP-66, DP-67, DP-69, DP-71, DP-73, DP-74, DP-75, DP-77, DP-79)

**Roles.** Any role not listed for an action answers 403.

| Actions | Roles |
|---|---|
| Read cars, bays, owners, the care round, jobs, the coat stack, panel reading history, condition-report and photo downloads, releases and the earliest slot | All staff |
| Register a car; assign or move a bay; belongings; condition report; intake photos; book, stage, complete or cancel a release | Concierge, house manager |
| Care entries | Care technician, house manager |
| Create, edit, send or revise an estimate; log stages and readings; stage photos; finish a job; issue an invoice | Workshop lead, house manager |
| Read invoices | Workshop lead, house manager, owner (own invoices only) |
| Record a bank transfer; the board; staff access | House manager |
| Read their own cars, own condition-report and photo downloads, own sent jobs with their coat stack and reading history, own invoices and releases, and the earliest slot; approve or decline own estimates; request own release; cancel own release while it is requested or booked | Owner |
| House settings, units, `GET /api/me`, sign-out | Everyone signed in |

**Owner visibility.** Every read, search, total, list and email for an owner covers only the cars they own. That includes `GET /api/cars` with its `total`, `GET /api/jobs`, `GET /api/invoices` with its `unpaid_total`, and `GET /api/releases`.

Any id belonging to another owner's car, or to a record hanging off that car, answers 404. This holds for ids inside request bodies as well. An owner's own draft job also answers 404, and drafts never appear in an owner's lists.

**My cars order.** An owner's cars, on My cars and in `GET /api/cars`, are ordered by bay code, then cars without a bay by name.

**Sessions and staff access.**
- Sessions live in Postgres, so every process serving the database honours them.
- Every session, staff or owner, has a fixed lifetime of `SESSION_LIFETIME_SECONDS` after its sign-in, default 43200 (12 hours). From that instant on it answers `session_expired`. No request, re-read or action extends it.
- Revoking a member does three things: sets `active` to false, records `revoked_at`, and ends every session that member holds.
- An ended session's cookie then answers `401 access_revoked` on every request, including replays, and this outranks expiry. This stays true after access is restored.
- Restoring access sets `active` to true and clears `revoked_at`. It revives no session, so the member must sign in again.
- A member without access gets `invalid_credentials` at sign-in.
- A session ended by sign-out answers `unauthenticated`.
- Nobody can change their own access.

**Return address.**
- A page opened without a live session goes to `/sign-in?next=<its path and query, percent-encoded>`.
- `next` is honoured only when all of these hold once it has been decoded:
  - it starts with exactly one `/`, followed by a character that is neither `/` nor `\`;
  - it contains no backslash and no control character;
  - it is not `/api` and not under `/api/` or `/sign-in`.
- An honoured `next` becomes `redirect` in the sign-in answer, and the shared-address table then applies when the page opens. Otherwise `redirect` is the role's home.
- So `//evil.test`, `/\evil.test`, `https://evil.test/` and `/api/me` all lead to the role's home, and a job link keeps its `?stage=&panel=`.

**Dates and times.**
- Every date and time a person sees, on any screen or in any email, is in Europe/Zurich, whatever the device's time zone.
- Date-only values (`charged_through_date`, `billing_end_date`, `next_due`, and the API's other `YYYY-MM-DD` values) show exactly the calendar day given; no time zone ever shifts them.
- Timestamps (`expires_at`, `revoked_at`, `status_confirmed_at`, event times, the release time) are converted to their Zurich date or time.
- `charged_through_date` and `billing_end_date` are exactly the subscription's `chargedThroughDate` and `billingEndDate` from Kill Bill.

**One change at a time per car.** For each car, belongings movements (including adding an item), bay assignments and moves, and release completion take hold of that car, across every process serving the database, for the whole change. Each one checks against the state the previous one left:
- a movement or assignment that runs after a completion answers `car_released` and records nothing;
- of a completion and a check-in that race, whichever takes hold of the car first wins: either the check-in lands first and the completion then answers `belongings_checked_in`, or the completion lands first and the check-in then answers `car_released` and records nothing;
- a completion that starts while a check-in is committing waits for it, then answers `belongings_checked_in`;
- a released car never has an item with `count_in` above 0.

**Bays.**
- The clearance is 500 mm. A car fits a bay when car length plus 500 is at most the bay length, and car width plus 500 is at most the bay width. An exact fit is allowed.
- One car per bay. Of concurrent assignments to one free bay, exactly one succeeds and the rest answer `bay_occupied`.
- A bay that fails several checks reports one reason, in this order:
  1. `bay_occupied` (`occupied by <car name>`). The car's current bay counts as occupied by that car.
  2. `bay_class_change` (`other class`). This check applies only when a stored car is moved.
  3. `bay_too_small` (`too small`).
- A released car answers `car_released` before any bay check.
- Assigning a bay to an `awaiting_intake` car makes the car `stored`, records the intake time and starts bay billing.
- A bay frees only when its car's release completes.

**Belongings.**
- `count_in` always equals the item's `in` movements minus its `out` movements.
- An `out` larger than `count_in` answers `insufficient_items` and records nothing.
- A movement on an item of a released car, or a new item for a released car, answers `car_released` and records nothing.

**Condition report.**
- There is one report per stay.
- The stay is claimed when the upload starts: after the size and request content-type checks and before the file body is read. A report upload for a stay that is already claimed or signed answers `report_already_signed` within 1 second, without waiting for any upload still streaming. So of concurrent uploads for one stay, exactly one answers 201, and exactly one object exists under the car's report prefix.
- The file must begin with `%PDF-`.
- The stored object, the download and the SHA-256 all match the uploaded bytes exactly. Nothing is added, re-rendered, re-compressed or stamped.
- A refused or failed upload writes no object and releases its claim.

**Photos.**
- The file must be a JPEG or PNG, judged by its leading bytes.
- The photo record exists, with `attached: true`, only after object storage confirms the write.
- The stored bytes are the uploaded bytes.

**Abandoned uploads.** When the client disconnects before a report or photo body is complete, the server stops reading and aborts its storage write. Within 5 seconds:
- no object and no incomplete multipart upload from it remains under `cars/<car id>/`;
- its stay claim is released and no record is kept;
- no database session of the app stays active or idle in transaction for it, and no lock it took is held.

An upload sent right after answers as normal and stores exactly one object. Thirty abandoned uploads in a row leave every API read answering within the time in Browser support and performance.

**Units.** Film build is stored as integer µm, tyre pressure as bar with two decimals, and the odometer as integer km. Every display derives from the stored value, rounding half up:

| Conversion | Rule | Shown as |
|---|---|---|
| µm to mil | ÷ 25.4, to one decimal | `6.2 mil` |
| mil input to µm | × 25.4, to a whole µm | stored |
| µm | whole number | `158 µm` |
| bar | two decimals | `2.20 bar` |
| bar to psi | × 14.5038, to one decimal | `31.9 psi` |
| psi input to bar | ÷ 14.5038, to two decimals | stored |
| km | whole number, no separator | `48210 km` |
| km to mi | ÷ 1.609344, to a whole number | `29957 mi` |
| mi input to km | × 1.609344, to a whole number | stored |

Voltage is shown as `12.62 V`. A new user's units are µm, bar and km.

**Care entries and flags.**
- An entry needs at least one of: a start-up, a battery voltage, or all four tyre pressures.
- It records the signed-in user and the server time.
- Entries are accepted only for `stored` cars; any other car answers `car_not_stored`.
- `battery_low` (label `battery low`) applies when the voltage is below 12.40 V.
- `tyre_pressure` (label `tyre pressure off`) applies when any tyre differs from the car's specified pressure by more than 0.20 bar.

**Start-up status.**
- An unscheduled car is `not_scheduled`.
- For a scheduled car, take the last start-up, or the intake time if there has been none. `next_due` is the Zurich date of that moment plus `STARTUP_OVERDUE_SECONDS`, which defaults to 2592000 (30 days).
- The status is `overdue` from that instant on, and `ok` before it.

**Workshop job states.**

| From | Action | To | Who |
|---|---|---|---|
| draft | edit | draft | workshop |
| draft, with at least one line | send | sent | workshop |
| sent | `expires_at` passes | expired | server time |
| sent | approve | approved | owner |
| sent | decline | declined | owner |
| declined or expired | revise | draft | workshop |
| approved or in progress | log stage | in progress | workshop |
| in progress | add reading | in progress | workshop |
| in progress, with at least one stage | finish | finished | workshop |
| finished | issue invoice | invoiced | workshop |
| invoiced | Kill Bill reports the invoice balance as zero | paid | provider |
| paid | Kill Bill reports the invoice balance above zero | invoiced | provider |

- Any other action answers `invalid_transition`. Approving or declining an expired estimate answers `estimate_expired` instead.
- Sending sets `sent_at`, and sets `expires_at` to `sent_at` plus `ESTIMATE_EXPIRY_SECONDS`, which defaults to 1209600 (14 days). Every read reports the job as `expired` from `expires_at` on, and an answer is accepted only strictly before that instant. Revising clears both times.
- A car has at most one job in draft through finished; another answers `job_already_open`.
- Jobs are created only for `stored` cars.

**Job versions.**
- Every job has an integer `version`, starting at 1. It rises by exactly one on every stored change to the job: edit, send, revise, approve, decline, log stage, add reading, finish, invoice issue, and each provider-confirmed change between `invoiced` and `paid`. Expiry is derived from time and changes nothing.
- An edit or send takes hold of the job, across every process serving the database, for the whole change. While it holds the job it checks the job's state first and then its version: a state that does not allow the action answers `invalid_transition`, and a version that differs from `If-Match` answers `estimate_changed`.
- So of concurrent edits made from one version, exactly one answers 200 and the rest answer `estimate_changed`. Of concurrent sends from one version, exactly one answers 200 and one email is queued; every other send answers `409 invalid_transition`, because the job is already sent when it gets its turn.
- After a revise, an edit made from the pre-revise version answers `estimate_changed`.

**Paint stages.**
- The stages, in order: `Intake`, `Stripped`, `Epoxy primer`, `Guide coat`, `2K primer`, `Base`, `Clear`, `Cut and polish`.
- Each stage can be logged once per job (`stage_already_logged`). Stages may be skipped, but none may be logged after a later one (`stage_out_of_order`).
- Intake needs readings for all 12 panels; any other stage needs at least one reading.
- Readings run from 0 to 2000 µm. Each reading records who logged it and when, and readings are never edited or deleted.

**Stages one at a time.** Log stage, Add reading and Mark finished on one job take hold of that job, across every process serving the database, for the whole change. Each checks against the state the previous one left, and a stage's `logged_at` is taken while the job is held. So:
- of concurrent logs of one stage, exactly one answers 201 and the rest answer `stage_already_logged`;
- the job's stages, read in stage order, always have non-decreasing `logged_at`; when an earlier and a later stage are logged concurrently and the later one lands first, the earlier one answers `stage_out_of_order`;
- a Mark finished that races a Log stage either finishes with that stage included, or the stage answers `invalid_transition`; no stage or reading of a finished job has a `logged_at` later than its `finished_at`.

**Panels**, in front-to-rear order:

| Order | Id | Name |
|---|---|---|
| 1 | `front_valance` | Front valance |
| 2 | `bonnet` | Bonnet |
| 3 | `front_wing_l` | Front wing L |
| 4 | `front_wing_r` | Front wing R |
| 5 | `door_l` | Door L |
| 6 | `door_r` | Door R |
| 7 | `sill_l` | Sill L |
| 8 | `sill_r` | Sill R |
| 9 | `roof` | Roof |
| 10 | `rear_quarter_l` | Rear quarter L |
| 11 | `rear_quarter_r` | Rear quarter R |
| 12 | `boot_lid` | Boot lid |

**Coat stack derivation.** The server derives these values; the browser only draws them. A stage index is the zero-based position among the job's logged stages, in stage order.
- **Film build.** A panel's `film_um` at stage k is its latest reading at stage k. With no reading at k, it is the latest earlier value, or `null` if the panel has never been read.
- **Bands:**

  | Band | Range | Label |
  |---|---|---|
  | `thin` | below 80 µm | `Thin` |
  | `factory` | 80 to 180 µm | `Factory` |
  | `refinished` | 181 to 300 µm | `Refinished` |
  | `filler_suspected` | above 300 µm | `Filler suspected` |

- **Layers.** Walk the panel's stage values from the first stage through k:
  - a value below 20 µm empties the stack;
  - the first value, or a rise, adds a layer named after that stage, as thick as the rise;
  - a fall to a value of 20 µm or more thins the stack from the top by the difference, removing any layer that reaches zero;
  - an equal value, or no reading, changes nothing.
- **Total film build** is the selected panel's `film_um`.

**Money.** Amounts are in CHF, using exact decimals and never binary floating point.
1. Line net is quantity × unit price, rounded half up to 0.01.
2. Line VAT is line net × 8.1%, rounded half up to 0.01.
3. `net_total` and `vat_total` are the sums of those line values.
4. `total` is their sum rounded half up to the nearest 0.05.
5. `rounding` is the signed difference between `total` and the unrounded sum.

An issued invoice keeps a frozen copy of the lines and totals. For example, with the seed data at start, J-1001 has `net_total` 4135.70, `vat_total` 334.99, `rounding` 0.01 and `total` 4470.70.

**Invoice issue.**
- An issue takes hold of the job for the whole attempt, including the Kill Bill call. Any other issue for the same job waits for it, then answers from the job's state: `invalid_transition` after a success, or its own attempt after a 503.
- So of concurrent issues on one finished job, exactly one answers 201 and Kill Bill holds exactly one charge.
- Numbers run `INV-<year>-<4-digit sequence>`, starting at `INV-2026-0001`. A number is taken only when an issue succeeds, so concurrent issues on different jobs get distinct, gapless numbers, and a 503 consumes none.

**Invoice balance and status.**
- An invoice exists only after Kill Bill has accepted its charge and returned the Kill Bill invoice.
- `balance` is Kill Bill's balance for that invoice.
- `status` is `paid` exactly when the balance is zero, and `paid_at` is the date of the Kill Bill payment that brought it to zero.
- Paid is never final. When a later read finds a balance above zero again (for example after a refund in Kill Bill), the invoice is `awaiting_payment` with `paid_at` `null` and its job returns to `invoiced`. It is back in the unpaid totals, and it holds that car's open release again.
- Every invoice read, list, board total and release-hold check asks Kill Bill. Each answer it gets updates the stored last confirmed balance and status, and `status_confirmed_at`, even when the change was made outside the app.
- When Kill Bill does not answer for an invoice, the stored last confirmed values are used, with `balance_live` false. An unconfirmed balance is never treated as zero.
- `unpaid_total` and the board's `unpaid.total` are the sum of the balances above zero that the caller may see, and `unpaid.invoices` lists exactly those invoices.

**Bank transfers.**
- A transfer records one Kill Bill external payment of exactly `amount` against that Kill Bill invoice.
- The house also keeps an append-only record of the reference and the house manager who entered it. That record is never edited or deleted.
- Transfers on one invoice run one at a time across every process serving the database. Each one holds the invoice through its Kill Bill call, and the next one is checked against the balance Kill Bill reports after the previous one.
- `amount` must be from 0.01 up to that live balance; the balance itself is allowed.
- A request that no longer fits answers the `amount` field error at the current balance. Once the balance is zero, it answers `already_paid`.
- When Kill Bill does not answer, the last confirmed balance stands in for the check, and a request that passes it then answers 503.
- A bank reference may repeat: two transfers with the same reference both record.
- The app never computes a balance or sets paid itself.

For example, with the seed data, once J-1001 is invoiced at 4470.70:
- a transfer of 1000.00 leaves `balance` at `"3470.70"` with status `awaiting_payment`, and the board total drops by exactly 1000.00;
- an amount of 3470.71 is then a field error;
- five concurrent transfers of 1000.00 on a balance of 3470.70 give three successes and two field errors naming 470.70.

**Release states.**

| From | Action | To | Who |
|---|---|---|---|
| (none) | request | requested | owner |
| requested | book | booked | concierge, house manager |
| booked | stage | staged | concierge, house manager |
| staged | complete | released | concierge, house manager |
| requested or booked | cancel | cancelled | owner |
| requested, booked or staged | cancel | cancelled | concierge, house manager |

- Any other action answers `invalid_transition`.
- A car has at most one open release (requested, booked or staged); another answers `release_already_open`.
- Only `stored` cars can be released (`car_not_stored`), and not while their job is in progress (`car_in_workshop`).
- Every transition appends an event with its actor and time.
- A staged release can be completed at any time.
- Requesting, booking, staging and cancelling are never blocked by invoices.

**Release hold.**
- A car is held while any invoice for that car has a balance above zero. Invoices on the owner's other cars never count.
- `held_by` lists the holding invoices with their balances, ordered by number.
- `held_by` is always empty for a released or cancelled release.

**Release slots.**
- Slots are on the half hour, in Zurich local time, from 08:00 to 17:30, Monday to Saturday.
- A slot must be at least 48 hours after the server's current time; exactly 48 hours is allowed.
- Only one open release may hold a slot, house-wide. Of simultaneous requests for one slot, exactly one succeeds and the rest answer `slot_taken`.
- The earliest slot is the first slot on the grid that meets the notice.

**Release completion.** A completion takes hold of the release and of its car (see One change at a time per car) for the whole attempt and checks, in order:
1. `invalid_transition`: the release is not staged.
2. `invoice_unpaid`: Kill Bill reports a live balance above zero for an invoice on this car. Any invoice Kill Bill does not answer for is checked against its last confirmed balance.
3. `belongings_checked_in`: an item has `count_in` above 0.

When all checks pass, the following happen as one unit:
- the release is recorded as `released`;
- the bay is freed;
- the car becomes `released`;
- the mail service accepts the released email.

If mail does not accept the email, nothing is recorded, nothing is queued (no email and no subscription cancellation), and the answer is 503 mail_unavailable.

Of concurrent completions on any processes, exactly one answers 200, the rest answer `invalid_transition`, and one email is sent. The bay subscription cancellation follows the success, as described in Services.

**Conflict order.** The first conflict that applies answers. Endpoints not listed have at most one conflict.

| Endpoint | Order |
|---|---|
| `POST /api/cars/{id}/bay` | `car_released`, then the bay reason order |
| `POST /api/belongings/{id}/movements` | `car_released`, `insufficient_items` |
| `POST /api/jobs` | `car_not_stored`, `job_already_open` |
| `POST /api/jobs/{id}/approve`, `POST /api/jobs/{id}/decline` | `estimate_expired`, `invalid_transition` |
| `POST /api/jobs/{id}/stages` | `invalid_transition`, `stage_already_logged`, `stage_out_of_order` |
| `POST /api/releases` | `car_not_stored`, `car_in_workshop`, `release_already_open`, `slot_taken` |
| `POST /api/invoices/{id}/payments` | `already_paid` |
| `POST /api/releases/{id}/complete` | The order in Release completion |

**Re-reads.** Screens re-read the server on this schedule, following the in-place rules in Interactions:

| Screen | What it re-reads | When |
|---|---|---|
| Car page, My cars | The car or cars and their bay billing | On open. Then every 10 seconds while any car shown has an open release, bay billing `pending`, or `cancel_requested` true with status not yet `ending` |
| Care round | The round | On open, after each save, and every 15 seconds, including while a round-entry dialog is open |
| Board | Everything on it | On open and every 10 seconds |
| Portal invoice page; job ledger of an invoiced or paid job | The invoice | On open and every 10 seconds |
| Portal release page, Releases table | The release or releases | On open and every 10 seconds |
| Job page, Jobs table | The job or jobs | On open. Then every 10 seconds while any job shown is `sent` |
| Portal job page | The job | On open. Then every 10 seconds while it is `sent` |
| Request-release form | The earliest slot | On open and every 60 seconds |

Re-reads pause only while Sign in again is open. A revoked member's open screen reaches sign-in on its next re-read or action.

### Services (DP-04, DP-23, DP-24, DP-29, DP-33, DP-44, DP-48, DP-56, DP-57, DP-62, DP-69, DP-71)

**Postgres** is the system of record. It holds:
- users, sessions with their sign-in time and end, and units settings;
- cars, bays, belongings and movements;
- report and photo metadata, and stay claims;
- care entries;
- jobs with their versions, lines, stages and readings;
- invoices with their last confirmed balance and status;
- the append-only transfer record;
- releases and their events;
- idempotency records;
- the queue of pending provider effects.

Schema and seed are applied on every serve start without duplicating anything, and the seed is written only into an empty database.

**Provisioning.** The database named by `DATABASE_URL`, the bucket named by `S3_BUCKET` and the Kill Bill tenant named by the Kill Bill keys always exist at start, possibly empty. The app creates none of them.

Several app processes may serve one database at the same time. They share these through it:
- sessions;
- idempotency records;
- invoice numbering;
- the order of transfers;
- the hold on a job for edit, send, stage, reading, finish and issue;
- the hold on a car for movements, assignments and completion;
- the claims on releases and stays;
- the queue.

**MinIO** stores objects in the private bucket from `S3_BUCKET`:

| Object | Key | Content type |
|---|---|---|
| Condition report | `cars/<car id>/condition-reports/<report id>.pdf` | `application/pdf` |
| Photo | `cars/<car id>/photos/<photo id>.jpg` or `.png` | The photo's own type |

- Objects are written once, as uploaded, and never rewritten. A write that does not complete is aborted, so no incomplete multipart upload is left behind.
- The browser receives files only through the app's own routes.
- When storage is unreachable:
  - uploads answer 503 storage_unavailable and leave no record, no claim and no object;
  - downloads answer 503 storage_unavailable;
  - everything else works.

**Kill Bill** is used through the tenant set in the environment.

*Catalog.* On start, and until it succeeds, the app makes sure the tenant has a catalog of three monthly evergreen plans in CHF, billed in advance, with no trial:

| Product | Plan | Price (CHF) |
|---|---|---|
| `bay-standard` | `bay-standard-monthly` | 480.00 |
| `bay-covered-lift` | `bay-covered-lift-monthly` | 690.00 |
| `bay-sealed-capsule` | `bay-sealed-capsule-monthly` | 950.00 |

*Key prefix.* `<key prefix>` is empty when `KILLBILL_KEY_PREFIX` is unset or empty. Otherwise it is that value followed by `-`, for example `short-owner-u-kenji`. Processes that share a database use the same prefix.

*Accounts.* One per owner, with:
- external key `<key prefix>owner-<owner id>`;
- the owner's name and email;
- currency CHF and time zone `Europe/Zurich`.

The account is created when first needed and reused if it already exists. It never pays automatically.

*Bay subscriptions.*
1. When a car becomes `stored`, the app creates the subscription `<key prefix>car-<car id>` on the owner's account, on the plan for the bay's class. It reuses the subscription if it already exists.
2. `bay_billing` is `pending` until Kill Bill shows a charged-through date. It is then `active`, with that date and the plan price.
3. After a release completes, `cancel_requested` becomes true. The cancellation is sent only after Kill Bill shows the subscription's charged-through date. Entitlement ends at once and billing ends at the end of the term, so the billing end date equals that charged-through date, never the release day.
4. Once Kill Bill confirms the cancellation, the car shows `ending` with Kill Bill's billing end date.

The effects for each car reach Kill Bill in this order: account, subscription, its first invoice, cancellation. This holds even when the car was stored and released while Kill Bill was unreachable.

*Workshop invoices.* Issuing records one external charge on the owner's account for the invoice total, with description `Workshop job <job number>`. Kill Bill commits it as an invoice of that amount. Only then does the app store the invoice, with the Kill Bill invoice id and its number.

*Bank transfers.* Each transfer is a Kill Bill external payment against that invoice:
- external key `<key prefix>transfer-<transfer id>`, where the transfer id is new for every transfer;
- a custom field `bank_reference` holding the reference.

*Refunds.* Refunds of returned transfers are made in Kill Bill by the house's bookkeeper. The app only reads their effect.

*Outage.* When Kill Bill is unreachable:
- issuing and recording a transfer answer 503 billing_unavailable and change nothing;
- subscription effects wait in the queue;
- reads, totals and hold checks use the last confirmed balances;
- everything else works.

**Mailpit (SMTP).** Mail goes through `SMTP_HOST`:`SMTP_PORT`.
- The From line is `MAIL_FROM`, which the environment sets to `Marrow & Lark Motor House <house@marrowlark.test>`.
- Each message goes only to the car owner's email, names only that owner and their car, and links through `APP_PUBLIC_URL`.
- Each event sends exactly one message.
- Dates and times in messages follow the Feedback states placeholders.

| Event | Subject | Body includes |
|---|---|---|
| Estimate sent | `Estimate <job number> for your <car name> is ready` | The job title, `CHF <total>`, the approve-by `<date>`, and a portal job link |
| Release booked | `Release booked: <car name>, <slot label>` | The slot label, the bay code, and a portal release link |
| Invoice issued | `Invoice <invoice number> for your <car name>` | `CHF <total>` and a portal invoice link |
| Release completed | `Your <car name> has been released` | The release time as a `<moment label>` and the bay code |

The estimate, booking and invoice emails are queued in Postgres. Their actions succeed while mail is down, and the email is sent once mail returns. The released email is sent inside the completion unit.

**Queue and recovery.**
- Every queued effect (subscription create, subscription cancel, email) is retried at least every 10 seconds.
- Each is applied exactly once, within 30 seconds of its service becoming reachable, without a restart.
- Each effect is claimed through Postgres by one process at a time, and a failed attempt releases its claim. So whichever process can reach the service applies the effect, and only once.

**Service status.** `GET /api/status` probes each service with a 2-second timeout and caches the result for at most 5 seconds:
- storage: the bucket answers;
- billing: Kill Bill's health check answers;
- mail: an SMTP connection opens.

### Seed data (DP-01, DP-05, DP-12, DP-14, DP-18, DP-20, DP-22)

Every person, business and car below is invented. All seeded users have the password `lacquer-demo-2026`. "First start" is the moment the app seeds an empty database, and relative times are applied at that moment.

**House:** Marrow & Lark Motor House, in time zone Europe/Zurich. Currency CHF, VAT 8.1%, labour CHF 145.00 per hour, bay clearance 500 mm.

**Users**

| Id | Name | Email | Role |
|---|---|---|---|
| u-ines | Ines Varga | ines@marrowlark.test | concierge |
| u-tomas | Tomas Riedl | tomas@marrowlark.test | care_technician |
| u-luca | Luca Marent | luca@marrowlark.test | care_technician |
| u-odile | Odile Fenner | odile@marrowlark.test | workshop_lead |
| u-rafael | Rafael Amsel | rafael@marrowlark.test | house_manager |
| u-henrietta | Henrietta Calloway | henrietta@owners.test | owner |
| u-kenji | Kenji Arlow | kenji@owners.test | owner |

**Bays.** Each bay's id is its code.

| Code | Class | L × W (mm) | Row, column | Car |
|---|---|---|---|---|
| A1 | standard | 5200 × 2500 | 1, 1 | c-911rs |
| A2 | standard | 5200 × 2500 | 1, 2 | — |
| A3 | standard | 5200 × 2500 | 1, 3 | — |
| A4 | standard | 4600 × 2300 | 1, 4 | — |
| B1 | covered_lift | 5600 × 2700 | 2, 1 | c-etype |
| B2 | covered_lift | 5600 × 2700 | 2, 2 | c-300sl |
| C1 | sealed_capsule | 5800 × 2800 | 3, 1 | c-testarossa |
| C2 | sealed_capsule | 5000 × 2400 | 3, 2 | — |

The class labels shown are `Standard`, `Covered lift` and `Sealed capsule`.

**Cars**

| Id | Car | Owner | Reg. | Colour | L × W (mm) | Odometer (km) | Tyre spec (bar) | Start-up schedule | Status, bay |
|---|---|---|---|---|---|---|---|---|---|
| c-etype | 1967 Jaguar E-Type | u-henrietta | ZH 41967 | Opalescent Silver Grey | 4450 × 1660 | 48210 | 2.20 | yes; last 31 days before first start | stored, B1 |
| c-911rs | 1973 Porsche 911 Carrera RS 2.7 | u-henrietta | ZH 27373 | Grand Prix White | 4147 × 1652 | 61377 | 2.00 | yes; last 3 days before | stored, A1 |
| c-testarossa | 1989 Ferrari Testarossa | u-kenji | GE 19890 | Rosso Corsa | 4485 × 1976 | 23904 | 2.40 | yes; last 10 days before | stored, C1 |
| c-300sl | 1962 Mercedes-Benz 300 SL Roadster | u-kenji | BE 30062 | Silver Blue | 4570 × 1790 | 87650 | 2.10 | no | stored, B2 |
| c-fulvia | 1971 Lancia Fulvia Coupé | u-kenji | TI 19710 | Blu Lancia | 3975 × 1555 | 112045 | 1.80 | yes; never | awaiting_intake, none |

The stored cars were taken in 60 days before first start. On first start the app creates their Kill Bill accounts and subscriptions. At start there are no condition reports, photos, releases or invoices.

**Belongings.** Each item is seeded with one `in` movement of its count.

| Id | Car | Kind | Label | Count |
|---|---|---|---|---|
| b-etype-keys | c-etype | key_set | Key sets | 2 |
| b-etype-cover | c-etype | cover | Indoor cover | 1 |
| b-etype-wheel | c-etype | spare_wheel | Wire spare wheel | 1 |
| b-etype-cert | c-etype | document | Heritage certificate | 1 |
| b-911rs-keys | c-911rs | key_set | Key sets | 2 |
| b-911rs-cover | c-911rs | cover | Indoor cover | 1 |
| b-testarossa-keys | c-testarossa | key_set | Key sets | 2 |
| b-testarossa-cover | c-testarossa | cover | Indoor cover | 1 |
| b-testarossa-book | c-testarossa | document | Service book | 1 |
| b-300sl-keys | c-300sl | key_set | Key sets | 1 |
| b-300sl-cover | c-300sl | cover | Indoor cover | 1 |

**Jobs.** Every seeded job starts at `version` 1.

| Id | Number | Car | Title | Status |
|---|---|---|---|---|
| j-1001 | J-1001 | c-911rs | Bonnet and front wings respray | in_progress, approved 20 days before first start |
| j-1002 | J-1002 | c-testarossa | Front valance stone-chip repair | sent 2 days before first start |
| j-1003 | J-1003 | c-300sl | Sill touch-in | finished |
| j-1004 | J-1004 | c-etype | Boot floor inspection | draft |

New jobs continue the numbering from J-1005.

**Job lines**

| Job | Kind | Description | Quantity | Unit price |
|---|---|---|---|---|
| J-1001 | part | Bonnet hinge bushes | 2 | 37.45 |
| J-1001 | labour | Strip, prime and paint bonnet and front wings | 26.50 | 145.00 |
| J-1001 | paint_materials | Primer, base and clear | 1 | 218.30 |
| J-1002 | labour | Fill, flat and blend front valance chips | 3.25 | 145.00 |
| J-1002 | paint_materials | Touch-up primer and base | 1 | 64.80 |
| J-1003 | part | Touch-in kit | 1 | 12.90 |
| J-1003 | labour | Flat and touch in sill chips | 1.75 | 145.00 |
| J-1003 | paint_materials | Base and clear | 1 | 38.40 |
| J-1004 | labour | Lift boot floor mat and inspect for corrosion | 2.00 | 145.00 |

For example, with the seed data at start: J-1002 totals 579.45 (rounding -0.02), J-1003 totals 329.75 (rounding 0.00), and J-1004 totals 313.50 (rounding 0.01).

**J-1001 readings (µm).** All were logged by u-odile, one stage a day, with the last stage 2 days before first start. A blank cell means no reading at that stage.

| Panel | Intake | Stripped | Epoxy primer | 2K primer | Base |
|---|---|---|---|---|---|
| front_valance | 112 | | | | |
| bonnet | 142 | 0 | 48 | 132 | 158 |
| front_wing_l | 268 | 0 | 51 | 140 | 166 |
| front_wing_r | 335 | 0 | 50 | 138 | 163 |
| door_l | 118 | | | | |
| door_r | 121 | | | | |
| sill_l | 96 | | | | |
| sill_r | 74 | | | | |
| roof | 131 | | | | |
| rear_quarter_l | 127 | | | | |
| rear_quarter_r | 124 | | | | |
| boot_lid | 138 | | | | |

For example, with the seed data at start, the bonnet at Base (stage index 4) reads 158 µm (6.2 mil), band `factory`, with layers Epoxy primer 48, 2K primer 84 and Base 26.

**J-1003 readings (µm).** Logged by u-odile, with Intake 12 days and Clear 5 days before first start, and the job finished 4 days before first start.

| Stage | Panel | Reading |
|---|---|---|
| Intake | front_valance | 104 |
| Intake | bonnet | 118 |
| Intake | front_wing_l | 121 |
| Intake | front_wing_r | 117 |
| Intake | door_l | 112 |
| Intake | door_r | 115 |
| Intake | sill_l | 212 |
| Intake | sill_r | 109 |
| Intake | roof | 120 |
| Intake | rear_quarter_l | 116 |
| Intake | rear_quarter_r | 119 |
| Intake | boot_lid | 122 |
| Clear | sill_l | 236 |

## Technical requirements

### Deployment (DP-45)

The runtime is Node.js 22 with npm, and the app root is `/app`. `/app/run.json` holds string `install`, `build` and `serve` commands, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set. `GET /api/health` answers HTTP 200 `{"status":"ok"}` as soon as the server accepts connections, whatever state the providers are in. Serving applies the schema and the seed as stated in Services.

### Configuration and secrets (DP-44)

The app reads these environment variables at start:

| Group | Variables |
|---|---|
| Postgres | `DATABASE_URL` |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Kill Bill | `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`, `KILLBILL_KEY_PREFIX` (optional) |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| Timers | `SESSION_LIFETIME_SECONDS`, `STARTUP_OVERDUE_SECONDS`, `ESTIMATE_EXPIRY_SECONDS` |
| Links and port | `APP_PUBLIC_URL`, `APP_PUBLIC_PORT` |

Each timer is a whole number of seconds with the default stated in Business rules. None of these values is hard-coded in source, sent to the browser, logged or included in a response.

### Server boundary (DP-33, DP-46, DP-51, DP-62, DP-71)

**Origin.** The browser talks only to the app's own origin. Responses carry no cross-origin permission headers. A state-changing request whose `Origin` names another origin answers `403 {"error":"forbidden"}`.

**Body limits.**

| Body | Limit |
|---|---|
| JSON | Up to 100,000 bytes, inclusive |
| Upload | Up to 10,000,000 bytes, inclusive |

A larger body answers 413: at once when its declared length is over the limit, otherwise as soon as the limit is passed, with the same clean-up as an abandoned upload. A JSON route given another content type answers 415.

**Client disconnects.** A request whose client goes away is stopped: the server stops reading, rolls back its work and returns its database connection, as stated in Abandoned uploads. A disconnect never leaves a pooled connection busy or a lock held.

**Never served:** source files, server source maps, environment files, lockfiles, the run manifest, or anything outside the built browser assets and the API.

**Outages.** A request refused because of an outage changes nothing in Postgres, MinIO, Kill Bill or Mailpit.

**Boot.** If MinIO, Kill Bill or mail is unreachable at boot, the server still starts. It serves health, sign-in, bays, belongings, cars, care rounds and every read that needs no provider. In the background it keeps retrying the catalog, accounts, subscriptions and queued email, and it recovers as stated in Services without a restart.

### Browser support and performance (DP-41)

- Current Chromium, Firefox and WebKit, at the three published viewports, with mouse, keyboard and touch, in any device time zone.
- With the seed data, each screen is usable within three seconds of navigation.
- API reads answer within half a second, plus the time a provider takes on reads that ask it.
- The coat stack responds to a scrubber step within a tenth of a second.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and those commands alone install, build and serve the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its licence.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1.
- IF-04: The app uses no datastore other than the provided Postgres, MinIO, Kill Bill and Mailpit: no SQLite, Redis, embedded databases, in-process caches standing in for shared state, or data files used as storage.
- IF-05: All server and browser source you write is TypeScript, and the type check passes with no errors.
- IF-06: Fonts, scripts, styles and images are served from the app's own origin; the browser loads nothing from a third-party host.
- IF-07: The provided service definitions and their dev credentials are left unchanged; the app adapts to them through the environment.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript with no `any` escapes and no disabled type or lint checks.
- Names in code match the domain terms in this brief: bay, bay class, belongings, condition report, care entry, start-up, stage, reading, band, coat stack, estimate, version, invoice, balance, bank transfer, release, hold, session.
- Each domain rule is decided in exactly one place in the source, and every caller uses that decision. This covers the job and release transitions, job versions, bay fit, start-up status, estimate expiry, session lifetime, the release hold, the return address, the owner projection, Zurich date formatting, reading bands and layers, unit conversion and money rounding.
- Money and readings use exact decimal or integer arithmetic. No binary floating-point value is stored or summed for an amount, and no balance is computed locally instead of read from Kill Bill.
- Every API error goes through the single error shape and precedence order, from one place.
- Rules that must hold across processes — one change at a time per car, per job and per invoice — are enforced through the shared database, never through in-process locks.
- Periodic re-reads update existing screen state rather than rebuilding it, and no screen sets a success state before the server answers.
- There is no abstraction with only one implementation, no dead, commented-out or unreachable code, no defensive checks for states the rules make impossible, and no features beyond this brief.
