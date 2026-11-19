# Larchmere Veterinary Systems Roundbook

Roundbook is the day-to-day workspace for a mid-size small-animal clinic (four to eight vets, twelve kennels, three consult rooms). It puts the appointment calendar, the waiting room, the ward board, consult notes with files, invoices, batch-tracked stock and vaccination reminders on one set of screens that share one clinic clock and one live feed. Its users are the front desk coordinator, the ward nurse, the veterinarian and the practice manager. Pet owners use a public booking page. The system of record is Postgres. Mailpit receives every outbound email. MinIO holds every patient file and every exported PDF. Out of scope: payment cards, refunds, discharge paperwork, owner accounts, any other datastore, and any third-party service.

## Problem and users

Clinics run the day on three surfaces that disagree: a booking calendar, a dry-erase ward board with paper treatment sheets, and an end-of-day notes screen. Treatments are given late because nobody noticed a four-hourly dose fall due during a busy consult block. Stock leaks because a dispensed item is never charged, or is charged twice and never put back when the invoice is voided, and short-dated batches expire on the shelf while newer stock is used first. A clinic can hold enough of a drug in total and still be short of stock that is in date. X-rays, wound photos and signed consent forms sit on a shared drive or a phone. Reminders go out late. Part-paid invoices are chased from memory. "Overdue" is often decided on a tablet's own clock and is minutes stale. Roundbook decides every time-dependent state on one server clock and pushes every change to every open window.

- **Front desk coordinator** (daily): books, moves, resizes and cancels appointments by mouse, keyboard or touch, checks patients in to the waiting room and sees who arrived late, takes part payments, voids invoices with a recorded reason.
- **Ward nurse** (daily): sees every in-patient's due and overdue treatments on the ward board, marks each given or reopens it, alongside another nurse on a second screen.
- **Veterinarian** (daily): writes consult notes live with a colleague, attaches X-rays, wound photos and the signed consent form to the patient, and turns the consult into invoice lines from in-date stock.
- **Practice manager** (weekly): invites staff, sets and changes their roles or removes their access, receives stock by batch and expiry date, keeps usable stock above reorder points, reviews balances, exports patient histories and invoices to PDF.
- **Pet owner** (occasional): books a consult from a phone on the public booking page and receives confirmations and vaccination reminders by email.

## Journeys

1. **Keyboard booking that loses a race.** Two front desk windows show `Today` at 1280 px with a free slot. The first coordinator arrows to the slot and presses Enter, which opens `Book appointment`. They press `Book` with no patient chosen, get the error summary, follow its link to `Patient`, and choose a patient. Meanwhile the second coordinator books that slot first. The first presses `Book` again and the summary in the dialog shows the slot-taken copy with focus on it. Both calendars show the slot as booked without reload. Escape closes the dialog and focus returns to the slot.
2. **Move, resize, cancel twice, undo, then drag on a tablet.** With a booked appointment focused, Alt+Down moves it one slot and Shift+Alt+Down lengthens it. Delete cancels it and an `Undo` toast appears. Cancelling a second appointment replaces the toast, and Undo or Ctrl+Z restores only the newest one. A second window follows every step. On a 768 px touch tablet the coordinator long-presses a block, drags it to another slot and releases. At 375 px the same day shows as an agenda behind a menu drawer that is truly absent while closed.
3. **Check-in, late arrival, consult and shared note.** The coordinator presses `I` on a booked appointment that is already late. The patient arrives in the vet's `Waiting room` list in another window with a late-arrival chip, and the minutes count up with the server clock. Two vets press `Start consult for <Patient>` at once. One wins, the loser sees the invalid-transition copy and no success announcement, and the row leaves both lists. The empty state shows. Two vets then write the consult note together: different paragraphs both apply, the same paragraph conflicts and the later save becomes a draft.
4. **Ward round.** A nurse admits a patient on an eight-hourly treatment across the October clock change and reads the dose times. The nurse leaves the ward board open while the server clock passes a treatment's time, then its time plus the grace. The cell turns `Due`, then `Overdue`, and only the changed digits of the `Overdue` tally roll. The nurse opens a note, types, tries a blank skip reason, and the dialog survives every refresh. Space marks the treatment given and the result is announced. The second nurse's board matches.
5. **Invoice, retry, void and stock batches.** The vet adds stock lines to an invoice by keyboard, applies a percentage discount and issues it. A line that needs more than the earliest-expiring batch holds is drawn across two batches. The coordinator takes a part payment whose first response is lost, and the retry pays once. An overpayment is refused. The manager's window shows `Low stock` live when usable stock reaches the reorder point. Voiding an unpaid invoice needs a reason, returns each draw to its own batch and records who voided it. When the clinic clock passes midnight after a batch's expiry date, the batch stops counting as usable and the low-stock alert is announced once.
6. **Pet owner books on a phone, then the reminder.** At 375 px the owner opens the public booking page, switches day and reason, picks a time by touch, enters details and sees the confirmation. Mailpit holds the confirmation email, whose subject carries the typed pet name exactly and whose body greets the typed owner name exactly, and the staff calendar shows the new block live. Later the clinic clock reaches the reminder hour on the reminder day and exactly one vaccination reminder arrives, whose link opens the booking page for that pet until the end of the vaccine's due date.
7. **Files, outage, PDFs, invitations, roles and tenancy.** The manager uploads an X-ray on the patient's `Files` tab and it is listed with a preview, its exact name and its checksum. On a storage-outage instance the upload fails with the banner and nothing is listed. The history PDF omits files unless asked. The manager invites a nurse, who opens a record link, signs in, lands on that page, cannot open invoices, and cannot reach another clinic's records by id. The manager then changes a coordinator's role and removes the nurse's access, and both people's open windows obey within two seconds.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest** The app installs, builds and serves from `/app/run.json` on port 4173, and `GET /api/health` answers as qualified in Server boundary.
- **DP-02 — Grading seed and clock routes** `POST /api/grading/seed` creates a whole scenario in one call and `POST /api/grading/clock` sets and reads the server clock, both behind the grading token as published in API.
- **DP-03 — One error order and shape** Every API answers errors in the one published order, with the one published status per code and the one published body shape.
- **DP-04 — Roles and permissions** Each role can do only what the permission table allows, and a forbidden action answers with the published code and shows the published copy on screen.
- **DP-05 — Live updates without reload** Every change to the calendar, waiting room, ward board, Kennel beacon, consult note, stock, staff roles and online bookings reaches every other open window of the same clinic within the live-update limit, with no reload.
- **DP-06 — Published animations and reduced motion** Every published animation exposes its `data-motion`, `data-motion-ms` and `data-motion-easing`, and under reduced motion each reads `none` and `0` with the final state shown at once.
- **DP-07 — Responsive layouts at three viewports** Every screen shows its published layout at 375x812, 768x1024 and 1280x800 with no horizontal overflow and tap targets of at least 44 px.
- **DP-08 — Published names and live regions** Every control and region in the public table is reachable by its exact role and accessible name, and the `Announcements` region and the `alert` regions carry the published copy.
- **DP-09 — Look: palette, type and shapes** The product uses the published palette roles, the two named typefaces, the flat tinted-card language, the corner shapes and the very large Kennel beacon numerals, with WCAG 2.2 AA contrast.
- **DP-10 — Composition, split band and public page** The clinic header, screen split band, pill buttons, patient cards, history layout, invoice footnote block, empty and outage cards, workspace footer, and the public page's hero, chooser cards, services tiles and meet the vets band look as described in Screens and layout and Visual design.
- **DP-11 — Server clock decides time in source** No browser code decides due, overdue, late, waiting minutes, booking windows, batch expiry, reminder sending, undo lifetime or the clinic date from the browser's own clock or zone.
- **DP-12 — Configuration from env** Every service URL, credential and setting is read from the environment at start and is never hard-coded or sent to the browser.
- **DP-13 — Day calendar structure, slot names and clinic date** The `Day calendar` grid shows one column per consult room and one gridcell per slot with its published name, each appointment is a button with its published name, and the calendar opens on the clinic's own date with every time in clinic time whatever zone or clock the browser has.
- **DP-14 — Keyboard booking and the error summary** The calendar and `Book appointment` are fully operable by keyboard with focus kept inside and returned on close, and an incomplete or rejected booking shows the in-dialog error summary as published in Feedback states.
- **DP-15 — One winner per slot** Simultaneous claims of the same vet or room slot have exactly one winner by server order, and the loser gets the slot-taken code and copy.
- **DP-16 — Keyboard booking journey** A coordinator books by keyboard, meets the error summary, loses the race to a second window and sees the conflict, the live `booked` state and the focus return.
- **DP-17 — Move, resize, cancel and undo rules** Appointments move, resize, cancel and restore through the published endpoints under the published state rules, and a restore works only within `UNDO_SECONDS` of the server clock.
- **DP-18 — Keyboard move, resize, cancel and undo** The published key commands move, resize, check in, cancel and undo a focused appointment with focus staying on the moved block, and only one undo toast exists, retargeted by the newest cancel.
- **DP-19 — Move and undo journey** A coordinator moves, lengthens, cancels twice and restores by keyboard while a second window follows each step without reload.
- **DP-20 — Phone and tablet calendar layouts and closed menu** At 768 px only the `Day calendar` grid exists with the published panel order, at 375 px only the `Day agenda` exists, and a closed `Menu` drawer or closed `Manage` panel is absent from the accessibility tree and the Tab order.
- **DP-21 — Long-press drag on touch** On a touch viewport a 500 ms long-press picks an appointment up, dragging moves it and releasing drops it on the slot under the finger.
- **DP-22 — Phone and tablet calendar journey** A coordinator moves an appointment by long-press and drag on a tablet while a desktop window shows the move, the phone shows the agenda, and reduced motion removes every animation.
- **DP-23 — Appointment lifecycle and check-in rules** Appointments move through booked, checked-in, in-consult, completed, cancelled and no-show only along the published edges, and every other edge is rejected with the published code.
- **DP-24 — Waiting room list, minutes and honest start** The `Waiting room` list orders checked-in patients by check-in time, shows server-computed waiting minutes that advance on the published tick, shows the published empty state, and removes a row on `Start consult for <Patient>` only on the server's answer or the live push.
- **DP-25 — Late arrivals written as text** A booked appointment becomes late by the server clock after the published late minutes, and lateness and late arrivals are written as text chips and in names with AA contrast, never as colour alone.
- **DP-26 — Check-in journey** A coordinator checks a late patient in, the vet's window shows the arrival and the minutes advance, two vets start the same consult, and the row leaves both windows with one winner.
- **DP-27 — Consult note paragraphs and versions** A consult note is a list of versioned paragraphs where the first save of a version wins, a stale save is rejected with the published code, and edits to different paragraphs both apply.
- **DP-28 — Live co-editing, saves and draft box** Two vets see each other's paragraph text live, a window never conflicts with itself or loses text typed during a save, a stale save shows the published message with the loser's text in a `Draft` box, and both windows converge, also after reload.
- **DP-29 — Co-edit journey** Two vets type in different paragraphs, then collide on one paragraph, and both end on the same text after reload.
- **DP-30 — Treatment schedules and due, overdue rules** Treatment doses are scheduled in elapsed hours from a first dose typed in clinic time, with the published rules for times that do not exist or occur twice, and each dose is upcoming, due or overdue by the server clock and the published grace.
- **DP-31 — Ward board names and Kennel beacon digits** The `Ward board` shows each treatment as a cell with its published name and group, and the three Kennel beacon cards carry server counts in `data-value` built from per-digit elements that roll only when changed.
- **DP-32 — Marking given, reopening and skipping** Marking a treatment given, reopening or skipping it follows the published rules, and each server result or rejection is announced with the patient and treatment name.
- **DP-33 — Ward journey** The clock advances so a cell turns `Due` then `Overdue`, the `Overdue` tally rolls its changed digits, a nurse marks the cell given and the second nurse's board matches.
- **DP-34 — Ward board keyboard** Arrow keys, Space, Shift+Space, N and S operate the ward board by the published movement rules, and Escape closes any ward dialog and returns focus to its cell.
- **DP-35 — Ward dialogs and refreshes keep UI state** `Skip treatment` and `Add note` validate in place with an error summary, and an open dialog, its summary, its text, the focus and any shown message survive every timed or pushed refresh.
- **DP-36 — Ward timers journey** A nurse opens a note, types, lets the clock cross due and overdue, finishes the note, and reopens a given cell by keyboard, also under reduced motion.
- **DP-37 — Invoice money in integer pence** Invoice lines, discounts, VAT and totals are integer pence with the published per-line half-up rounding, and the invoice screen, footnotes and PDF show the same amounts.
- **DP-38 — Invoice lifecycle, payments and replayed keys** Invoices move through draft, issued, part-paid, paid and voided only along the published edges, a payment above the balance is rejected, and a replayed `Idempotency-Key` returns the stored result.
- **DP-39 — Invoice screen by keyboard and lost responses** The invoice screen adds stock lines, applies a discount, issues and takes payment entirely by keyboard, validates the payment amount in place, and sends one key per attempt so a lost response never pays or draws twice.
- **DP-40 — Attributed void** Voiding an invoice needs a reason, and the void, its stock returns and every payment record who did it and when, on screen and in the invoice PDF.
- **DP-41 — Invoice journey** A vet builds and issues an invoice by keyboard, a coordinator takes a part payment through a lost response and an overpayment attempt, and an unpaid invoice is voided with a reason, ending on the published balances, statuses and attribution.
- **DP-42 — Stock ledger, batches and first-expiry-first-out** Stock is held in batches with expiry dates, each invoice line draws from usable batches first-expiry-first-out exactly once, removal or void returns each draw to its own batch through a paired movement, every movement carries its running balance, and concurrent claims on the last usable units have exactly as many winners as units.
- **DP-43 — Low-stock alert, expiry edge and live count** When usable stock drops to or below an item's reorder point by a movement or by a batch expiring at clinic midnight, `Low stock` and exactly one announcement appear live in every manager window, and the low-stock count always equals the server's.
- **DP-44 — Stock journey** A line drawn across two batches drops stock once per batch, the manager sees the live low-stock badge, a void returns each draw, the movement list's running balances end on on-hand, and a batch expiring at clinic midnight changes usable stock and alerts once.
- **DP-45 — Online booking window, confirmation and rate limit** Online booking offers only free slots from the lead time to the horizon in clinic time, rejects any other start with the published code, shows a confirmation readable only by its unguessable code, and answers as published once the attempt limit is reached.
- **DP-46 — Owner text in email** The owner's typed names are accepted only as 1 to 80 characters without control characters, the pet name reaches the confirmation email subject and the owner name the first line of its body exactly with non-ASCII text intact, and a name carrying a line break is refused and sends nothing.
- **DP-47 — Public booking page on a phone** At 375 px the public booking page is touch-operable in the published order, always shows times for the latest chosen day and reason, keeps the chosen time and typed details across the 15-second refresh, and creates one booking per confirm.
- **DP-48 — Online booking journey** A pet owner on a phone books by touch with a non-London browser zone and sees the exact confirmation and email, and the staff calendar shows the new block live.
- **DP-49 — Reminder schedule** A vaccination reminder is sent at the published hour of clinic time on the calendar day the published number of days before the due date, once per vaccine per due date, with the published rules for jumped, late-recorded and missed reminders.
- **DP-50 — Reminder email and Sent status** The reminder email has the published subject and link, and the patient's reminder reads `Sent` only after SMTP accepts it.
- **DP-51 — Reminder link scope** A reminder's pet token pre-fills the booking page only under its own clinic and only until the end of the vaccine's due date in clinic time, and otherwise answers 404 and shows the plain booking page.
- **DP-52 — Reminder journey** Advancing the clock to the send moment delivers exactly one reminder, the patient shows `Sent`, a second advance sends no duplicate, and the link opens the booking page for that pet.
- **DP-53 — File upload and listing** Uploads go through the app to MinIO byte for byte with their submitted name and checksum, never overwrite a same-named file, and are listed on `Files` with a preview only after the put is confirmed.
- **DP-54 — Safe file serving** File type is judged only by the full signature at byte 0, and every stored file is served with its sniffed type, the no-sniff header and the sandbox policy so an HTML file named as an X-ray can never be stored or run.
- **DP-55 — Storage outage** With storage down the health route reports `unavailable`, uploads and exports fail with the published copy, and nothing half-made is listed or stored.
- **DP-56 — PDF exports** The history and invoice PDFs are produced in the app with the published text layer, one page per 25 lines, attachments only with `?include=files`, and the bytes returned equal the exported object.
- **DP-57 — Files journey** A manager uploads an X-ray and sees it listed and announced, the outage instance shows the exact alert with nothing listed, and the history PDF lists the file only when asked.
- **DP-58 — Staff invitations, sign-in and landing** The manager invites staff through Mailpit, the invitee sets a password and lands on `Today`, and sign-in lands on a safe same-origin `next` path or on `Today` and sign-out on the sign-in page, as published.
- **DP-59 — Role change and removal** The manager changes a staff member's role or removes their access, and that person's very next request and open windows obey the new role or end the session within two seconds, while a manager cannot change or remove their own access.
- **DP-60 — Clinic tenancy** A clinic's records, files, PDFs, staff and search results are reachable only inside that clinic, and another clinic's id answers as a missing record.
- **DP-61 — Invite and tenancy journey** The manager invites a nurse who signs in through a record link and lands on it, sees the forbidden copy on invoices, gets a missing-record answer for another clinic's id, and the manager's invoice PDF text layer and page count are exact.

## Frontend

### Screens and layout (DP-07, DP-09, DP-10, DP-13, DP-20, DP-24, DP-25, DP-31, DP-40, DP-47, DP-59)

Viewports are 375x812 (phone), 768x1024 (tablet) and 1280x800 (desktop). No screen scrolls sideways at any of them. Every button, tab, slot, chip link and form control is at least 44 px tall and wide. Whenever a layout below is "at 768 px", it is the layout for that width exactly; no intermediate width changes which layout 375, 768 or 1280 gets.

**Screen routes.** `/login`, `/invite/<token>`, `/today`, `/ward`, `/patients`, `/patients/<patient id>` (an optional `?tab=overview|history|files|vaccinations` opens that tab), `/consult/<appointment id>`, `/invoices`, `/invoices/<invoice id>`, `/stock`, `/staff`, `/book/<clinic slug>` and `/book/<clinic slug>/confirmation/<code>`. `/` goes to `/today`. A staff screen opened without a session goes to `/login?next=<the path and query that was asked for, percent-encoded>`. Reloading or opening any of these addresses shows the same screen. A screen whose role is not allowed shows one tinted card with the forbidden copy from Feedback states. Unknown routes, unknown records and records outside the caller's clinic all show the not-found page from Feedback states, one tinted card with a pill `Back to today`. None of them uses the `not_found` API copy as its title. Controls and navigation links the signed-in role cannot use are absent rather than disabled: nurses see no `Invoices` link or `Billing` footer link, and only managers see the `Staff` menu item, the `Team access` footer link and the stock movement form.

**Shell (all staff screens).** The clinic header with section menus is a white bar that stays at the top; a soft line appears under it once the page has scrolled. At left is the link `Roundbook home`. Then the navigation `Clinic sections` with links `Today`, `Ward`, `Patients`, `Invoices` and a menu button `Manage` that opens a panel of two menu items, `Stock` and `Staff`. The panel and its items exist only while `Manage` is expanded; Escape closes it and returns focus to `Manage`. At right are the signed-in person (`<Name>, <Role label>`), the button `Sign out` and a mint pill `Go to today`. At 375 px everything except `Roundbook home` and a round button `Open menu` is inside a drawer, a dialog named `Menu` holding the same links, `Stock`, `Staff`, `Go to today`, `Sign out` and a button `Close menu`. While the drawer is closed it is hidden entirely: none of its links or buttons is visible, focusable or in the accessibility tree, so Tab from `Roundbook home` reaches `Open menu` and then the page content. While it is open, the page behind it is inert, Tab wraps inside it, and `Close menu` or Escape closes it and returns focus to `Open menu`. At 768 px and 1280 px the full bar shows. Each working screen's page content sits in one centred column.

**Workspace footer link grid.** It closes every staff screen. It is a `contentinfo` with the navigation `Workspace links`, four columns of headings with links, and a line `Roundbook by Larchmere Veterinary Systems`. The links deliberately use different words from the header so the closed drawer can be checked by name: under `Front desk`, `Day view` and `Online booking`; under `Clinical`, `Kennel round` and `Animal records`; under `Money and supplies`, `Billing` and `Supplies`; under `Practice`, `Team access`. They go to `Today`, the public booking page, `Ward`, `Patients`, `Invoices`, `Stock` and `Staff`. It has four columns at 1280 px, two at 768 px and one at 375 px. The public page's footer holds only the `Online booking` link and the line.

**Screen split band.** Every working screen opens with an even 50/50 band at 1280 px. The left half is a flat deep-navy panel holding the screen's headline (white, heavy, sentence case) and its pill actions. The right half is a live content panel. A thin two-tone strip (light sky blue left, bright blue right) closes the band. At 768 px and 375 px the band stacks, navy panel first, live panel second. The right half holds: on `Today` and `Ward` the three Kennel beacon cards; on `Patients` the count of matching patients; on `Invoices` the text `Outstanding <amount>` (the sum of balance due on issued and part-paid invoices); on `Stock` a status `Low stock count` showing the number of low-stock items; on `Staff` the count of active staff. The `Today` band has no pill.

**Today** (heading `Today`; the clinic date as `<Day DD Mon YYYY>` beside it). At 1280 px the left two thirds hold the day calendar and the right third holds the `Waiting room` panel. At 768 px the `Waiting room` panel comes first, above the calendar, with its rows in a horizontal wrap; the calendar below shows the three rooms as columns. At 375 px the order is band, `Waiting room`, then the agenda: a list named `Day agenda` with the day's appointments in time order (no room columns), each appointment a button with the published name, and a button `Book a time`. At 375 px the `Day calendar` grid does not exist at all; at 768 px and 1280 px the `Day agenda` does not exist at all. The calendar is a warm off-white surface with one column per consult room (three), a time axis on the left, and one slot per `SLOT_MINUTES`. Slots are at least 44 px tall. Clinic hours are 08:00 to 18:00 and the grid scrolls vertically. Day controls above the grid are buttons `Previous day` and `Next day`. Appointments are tinted cards with a text label for the reason: mint for `Consult`, sky for `Vaccination`, rose for `Surgery`. Each card shows the patient's profile photo or initials, patient, vet and times. Status is also written as text, so colour never carries it alone. A late booked appointment carries the text chip from Feedback states inside its card.

**Waiting room panel.** The `Waiting room` list holds patient cards with arrow chip: a round avatar (profile photo or initials), the patient name in bold at a size larger than body text, species and status chips, the vet's name, the text `waiting <N> min`, the late-arrival chip when the patient arrived late, a button `Start consult for <Patient>` (shown to vets and managers) and a dark circular arrow chip, the link `Open <Patient>`, that opens the patient record. When empty the panel shows one tinted card with the title and a pill `Go to calendar` that moves focus to the day calendar (at 375 px, to the `Day agenda`).

**Ward** (heading `Ward, today`; the clinic date beside it, with a pill `Admit patient`). The right half of the band holds the Ward tally cards, three stacked cards (mint `Waiting`, rose `Overdue`, sky `Due within the hour`) at 1280 px and at 375 px. At 768 px they sit in a single row of three. `Today` shows the same three cards the same way. Below the band the `Ward board` shows four groups in this order: `Overdue`, `Due`, `Upcoming`, `Done`. Each treatment is a card (a cell) showing patient avatar, kennel, treatment, scheduled time, status text and its notes. A group lays its cells out in three columns at 1280 px, two at 768 px and one at 375 px. The empty state is a single tinted card with a title and the pill `Admit a patient`, which opens the same `Admit patient` dialog as the button beside the heading.

**Patients** (heading `Patients`). A search box above a list of patient cards with arrow chip, three across at 1280 px, two at 768 px, one at 375 px. **Patient record**: patient name as the heading, species and status chips, a weight line, then a tab list with panels `Overview`, `History`, `Files`, `Vaccinations`. `History` uses the patient history feature and list layout: the latest completed consult is one large feature card (date, reason, vet, first lines of the note, tag chips) and earlier consults are row cards, each with a square weight sparkline tile on the left (a small line chart of the patient's weights up to that visit), the date and reason. At 1280 px the feature card is left and the row cards stack right; at 768 px and 375 px they stack with the feature card first. `Files` lists each file with a preview thumbnail for images and a document tile for PDFs.

**Consult** (heading `Consult: <Patient>`). The consult note as stacked paragraph boxes with `Add paragraph` beneath, a status line, the files panel and the button `Create invoice`. At 1280 px the note is left and the side panel (files, invoice button) right; at 768 px and 375 px the side panel follows the note.

**Invoices.** List screen with a table of invoices. Detail screen: header with number and status, the `Invoice lines` table, a side group with `Total`, `Paid`, `Balance due`, the `Payments` list, the void record once voided, the line form and the payment form. At 375 px the table becomes stacked line cards and the forms sit below. The detail screen ends in the invoice footnote block: plain small text on the white ground, no card, with markers that tie the discount and VAT notes to the lines they apply to.

**Stock** (a table of items with on-hand, usable, reorder point and unit price; at 375 px stacked cards; `Movements, <Item>` opens that item's batches and movements below its row), **Staff** (invite form and staff table with a `Change role` and a `Remove access` button on each active or invited row; at 375 px stacked cards), **Sign in** (centred card), **Invitation** (centred card).

**Public booking page** (`/book/<slug>`, no staff header; a white sticky header holds the clinic name and a mint pill `Book a visit`). It is built as a screen split band hero: the left navy half holds the clinic name, the headline `Book a visit for your animal` and the mint pill `Choose a time`. The right half is a flat illustration of rounded rectangles, pill tags and a simple animal silhouette in mint, sky and rose. The strip closes it. Below, in this order: the visit reason chooser cards (a row of four at 1280 px, two by two at 768 px, one column at 375 px), the booking form (day field, per-vet time buttons, the `Chosen time` status, then owner and pet fields), the clinic services tiles (four warm off-white tiles, each with a small flat illustration, a bold title and a short paragraph; two across at 768 px, one at 375 px) and the meet the vets band. At 375 px the hero stacks navy panel first, illustration second, and the pill spans the full width. The confirmation page is a single tinted card with the published heading and sentences.

**Visit reason chooser cards.** Four whole-card radio choices in the radiogroup `Reason for visit`. Each is a warm off-white card with a small line icon, a bold label and a short line. Hover tints the card; the chosen card has a deep-green outline and a text mark `Chosen`.

**Clinic services tiles.** The region `Our services`, static warm off-white tiles with no controls.

**Meet the vets band.** The region `Meet the vets`: a full-width pale blue band with an illustrated panel of vet initials circles on the left and, on the right, one large navy statement attributed to a vet from the seed data, plus one line per vet naming their name and interest. Static: no video and no play control. At 375 px the illustration comes first.

### Public screens and controls (DP-08, DP-13, DP-14, DP-18, DP-24, DP-25, DP-31, DP-34, DP-35, DP-39, DP-40, DP-42, DP-47, DP-51, DP-53, DP-59)

Only the controls below are public; everything else is free. Names are exact and spelled the same everywhere, and are matched whole, not as substrings. `<Status>` labels for appointments are `Booked`, `Checked in`, `In consult`, `Completed`, `Cancelled` and `No-show` (the last two appear only in messages, because those appointments leave the calendar). `<HH:MM>` is 24-hour clinic time. Role labels are `Front desk`, `Nurse`, `Vet`, `Manager`. Single-choice lists below are operated by the arrow keys or by typing the start of an option.

| Role and name | Where and copy |
|---|---|
| `banner` with link `Roundbook home`, `navigation` `Clinic sections`, links `Today` `Ward` `Patients` `Invoices`, button `Manage` (expanded state published) with menuitems `Stock` `Staff`, button `Go to today`, button `Sign out`, button `Open menu` (375 px), `dialog` `Menu` with button `Close menu` | the clinic header with section menus |
| `contentinfo` containing `navigation` `Workspace links` with links `Day view` `Online booking` `Kennel round` `Animal records` `Billing` `Supplies` `Team access` | the workspace footer link grid |
| `status` `Announcements` (polite) | one per page; carries every success announcement in Feedback states |
| `alert` | in-flow navy banner or inline message carrying every error in Feedback states; inside a dialog, that dialog's own `alert` error summary |
| `status` `Notice` with button `Undo` | the one undo toast: `Appointment cancelled.` |
| heading `Sign in`, textbox `Email`, textbox `Password`, button `Sign in` | `/login` |
| heading `Join <Clinic>`, textbox `Password`, button `Set password` | `/invite/<token>` |
| heading `Today` | the Today screen |
| `grid` `Day calendar` | slots are `gridcell` named `<Room>, <HH:MM>, free` or `<Room>, <HH:MM>, booked` |
| appointment `button` named `<Patient> with <Vet>, <HH:MM> to <HH:MM>, <Status>` with the suffix `, late` while late, `data-testid="appt-<id>"` and `data-picked="true"` while held by touch | child of its first slot's gridcell |
| `list` `Day agenda` | 375 px only; replaces the grid; items are the same appointment buttons |
| buttons `Previous day`, `Next day`, `Book a time` (375 px only) | calendar controls |
| `dialog` `Book appointment` with comboboxes `Client` `Patient` `Vet` `Reason`, buttons `Book` `Cancel`, and an `alert` error summary whose items are links | `Reason` options are `Consult`, `Vaccination`, `Surgery` |
| `dialog` `Appointment details` with buttons `Check in` `Start consult` `Complete consult` `Mark no-show` `Cancel appointment` `Close`, links `Open consult` `Open patient` | buttons appear only for edges legal from the current status and allowed for the role |
| `list` `Waiting room`; `listitem` named `<Patient>, waiting <N> min`; chip text `Arrived <N> min late` on a late arrival; button `Start consult for <Patient>` (busy state published); link `Open <Patient>` | empty card title `No one is waiting.` with pill button `Go to calendar` |
| `status` named `Waiting`, `Overdue`, `Due within the hour`, each with `data-value` and `data-motion`, made of one element per digit carrying `data-digit` (and `data-rolling="true"` while that digit rolls) | Kennel beacon, on `Today` and `Ward` |
| heading `Ward, today`, button `Admit patient` (beside the heading, always shown), button `Admit a patient` (only in the empty-ward card) | the Ward screen |
| `dialog` `Admit patient` with comboboxes `Patient` `Kennel`, textbox `Treatment`, textbox `First dose` (typed as `YYYY-MM-DD HH:MM`, 24-hour clinic time, for example `2026-11-17 08:00`), spinbuttons `Every (hours)` `Doses`, buttons `Admit` `Cancel`, and an `alert` error summary | one treatment per admission through the UI |
| `grid` `Ward board` with `rowgroup` named `Overdue` `Due` `Upcoming` `Done` and `gridcell` named `<Patient>, <Treatment>, <HH:MM>, <Upcoming\|Due\|Overdue\|Given\|Skipped>` with `data-testid="dose-<treatment id>"` | `Given` and `Skipped` cells sit in `Done`; names may repeat when two doses of one treatment share a clock time on different days, so a check locates a cell by its `data-testid` (the ids come from the ward board API) |
| in each cell: buttons `Mark given, <Patient>, <Treatment>` (`Reopen, <Patient>, <Treatment>` once given or skipped), `Add note, <Patient>, <Treatment>`, `Skip, <Patient>, <Treatment>` | mouse and touch controls; their names repeat across doses of the same treatment, so a check scopes them to the cell located by its `data-testid` |
| `dialog` `Add note` with textbox `Note`, buttons `Save note` `Cancel`, and an `alert` error summary | opened by key `N` or the cell button |
| `dialog` `Skip treatment` with textbox `Reason`, buttons `Skip treatment` `Cancel`, and an `alert` error summary | opened by key `S` or the cell button |
| heading `Patients`, searchbox `Search patients`, `list` `Patient list` with `listitem` named `<Patient>, <Species>`, link `Open <Patient>` | species label is `Dog`, `Cat`, `Rabbit` or `Other` |
| `tablist` `Patient record` with `tab` `Overview` `History` `Files` `Vaccinations` | patient record |
| spinbutton `Weight in grams`, button `Save weight` | `Overview` |
| `tabpanel` `Files` with a file input labelled `Add file`, combobox `File type` (`X-ray`, `Wound photo`, `Lab report`, `Consent form`, `Profile photo`), `list` `Patient files` with `listitem` named `<File name>, <File type>` and link `Open <File name>` | `Files` |
| `list` `Vaccinations`, textbox `Vaccine`, date field `Due date`, button `Add vaccination` | each `listitem` named `<Vaccine>, due <DD Mon YYYY>` shows the chip `Reminder: Scheduled`, `Reminder: Sent` or `Reminder: Missed` |
| link `Export history PDF` | `History` |
| heading `Consult: <Patient>`, `textbox` `Consult note` (one per paragraph, each with `data-paragraph="<n>"`), button `Add paragraph`, `status` `Note status` (`Saving` or `Saved`), `textbox` `Draft`, buttons `Apply draft` `Discard draft`, `region` `Files for this consult`, button `Create invoice` | the Consult screen |
| heading `Invoices`, `table` `Invoices` | list screen; empty card title `No invoices yet.` |
| heading `Invoice <number>`, `group` `Status` (text `Draft`, `Unpaid`, `Part paid`, `Paid` or `Voided`), `table` `Invoice lines`, combobox `Stock item`, spinbutton `Quantity`, button `Add line`, buttons `Remove line, <Item>`, spinbutton `Discount percent`, button `Apply discount`, buttons `Issue invoice` `Void invoice`, textbox `Payment amount`, button `Take payment`, link `Export invoice PDF`, `note` `Invoice footnotes` | invoice detail |
| `group` `Total`, `group` `Paid`, `group` `Balance due`, each with the text `<Label> £1,234.56` | the label, a space, then the amount |
| `list` `Payments` with `listitem` named `£x.xx taken by <Name> at <HH:MM>`; `note` `Void record` with the text `Voided by <Name> at <HH:MM>: <Reason>` once voided | invoice detail |
| `dialog` `Void invoice` with textbox `Reason`, buttons `Confirm void` `Cancel`, and an `alert` error summary | opened by the button `Void invoice` |
| heading `Stock`, `status` `Low stock count` with `data-value`, `table` `Stock` with `row` named `<Item>, <N> on hand` containing the text `Usable <N>`, badge text `Low stock`, button `Movements, <Item>`, `list` `Batches` with `listitem` named `<Batch>, <N> left, expires <DD Mon YYYY>` (with the text `Expired` once expired), `list` `Movements` with `listitem` named `<signed quantity>, <Reason label>, batch <Batch>, balance <N>`, combobox `Item`, spinbutton `Quantity`, combobox `Reason` (`Received`, `Expired`), button `Record movement` | stock screen; movement `<Reason label>` is `Received`, `Expired`, `Invoice line` or `Returned` |
| textbox `Batch` and date field `Expires on` while `Reason` is `Received`; combobox `Batch` (the chosen item's batches) while `Reason` is `Expired` | stock movement form |
| heading `Staff`, textboxes `Name` `Email`, combobox `Role`, button `Send invitation`, `table` `Staff` with `row` named `<Name>, <Role label>, <Active\|Invited\|Removed>` | staff screen |
| buttons `Change role, <Name>` and `Remove access, <Name>` inside each active or invited staff row | staff screen |
| `dialog` `Change role` with combobox `Role` (starts unchosen), buttons `Save role` `Cancel`, and an `alert` error summary | opened by `Change role, <Name>` |
| heading `Book a visit for your animal`, button `Book a visit` (sticky header), button `Choose a time` (hero) | public page |
| `radiogroup` `Reason for visit` with `radio` `Check-up` `Vaccination` `Limping or injury` `Off their food` | the visit reason chooser cards |
| date field `Day`, `group` named `<Vet>` holding buttons `<HH:MM> with <Vet>` (pressed state reflects the choice), `status` `Chosen time` | public booking |
| textboxes `Your name` `Email` `Pet name`, combobox `Species` (`Dog`, `Cat`, `Rabbit`, `Other`), button `Confirm booking` | public booking |
| heading `Your visit is booked` | confirmation page |
| text `Booking for <Pet>` | public page opened from a valid reminder link |
| region `Our services`, region `Meet the vets` | public page tiles and band |

### Interactions (DP-14, DP-18, DP-20, DP-21, DP-24, DP-34, DP-39, DP-42, DP-47, DP-59)

**Dialogs and focus (every dialog and drawer).** Opening a dialog moves focus into it, onto its first field. Tab and Shift+Tab wrap inside it, so focus never reaches the page behind: in `Book appointment` the Tab order is the summary links (while a summary shows), `Client`, `Patient`, `Vet`, `Reason`, `Book`, `Cancel`, and Tab from `Cancel` goes to the first of those while Shift+Tab from the first goes to `Cancel`. Escape closes the dialog and focus returns to the control or slot that opened it. A native dialog element alone is not enough; Tab must be kept inside, also from the last control.

**Day calendar keyboard.** The grid is one Tab stop. Arrow Up and Down move focus one slot in time, Left and Right move between rooms. Enter on a free slot opens `Book appointment` with that room and time. Enter on a booked slot opens `Appointment details` for the appointment covering it. The first slot of an appointment holds its button, and the commands below work with focus on that button or on that slot. On a focused appointment:
- Alt+Up and Alt+Down move it one slot earlier or later in the same room and with the same vet; Alt+Left and Alt+Right move it to the neighbouring room.
- Shift+Alt+Up shortens it by one slot and Shift+Alt+Down lengthens it by one slot (never below one slot).
- `I` checks the patient in.
- Delete cancels it. The appointment button disappears and focus moves to the gridcell of the first slot it occupied (now `free`). The `Notice` toast appears with `Undo`. Ctrl+Z does the same as `Undo` while focus is anywhere inside the calendar region (the grid, its day controls or the toast); elsewhere on the page it does nothing. After a restore focus moves to the restored appointment's button.
- `T`, with focus anywhere in the calendar region, jumps to the clinic's today.
- After a move, resize or undo, focus stays on (or returns to) the appointment's button, and after a successful booking it moves to the new appointment's button. A rejected move or resize leaves the block where it was and shows the rejection in the alert region.

**Booking dialog.** `Client` lists the clinic's clients and starts unchosen. `Patient` lists the chosen client's patients, starts unchosen and refreshes when the client changes. `Vet` defaults to the first vet by name who is free for that slot. `Reason` defaults to `Consult`. `Book` creates one slot-long appointment (`SLOT_MINUTES`). The in-dialog checks, the error summary and the focus moves are in Feedback states.

**Phone booking from the agenda.** `Book a time` opens `Book appointment` for the earliest slot, at or after the next slot boundary of the server clock, that is free for the first free vet and a free room.

**Mouse and touch on the calendar.** Mouse drag moves a block to the slot under the pointer, snapping to slots. Touch: a tap opens the appointment, a press held for 500 ms picks it up (the block shows `data-picked="true"` while held), dragging moves it, releasing drops it on the slot under the finger. A drop on a taken slot returns the block and shows the slot-taken copy. Dropping outside the grid returns the block silently.

**Waiting room.** A new check-in slides in from the end of the list. `Start consult for <Patient>` and the pending, winner and loser behaviour are in Feedback states.

**Ward board.** The grid is one Tab stop. Arrow keys never wrap and do nothing at the first or last cell. Right and Left move to the next or previous cell in reading order: along the row inside a group, then to the next row, and from a group's last cell to the first cell of the next non-empty group (Left mirrors this backwards). Down moves to the cell directly below in the same column of the same group. If the next row of the same group has no cell in that column, Down moves to that row's last cell. For example, with five cells in three columns, Down from the third cell of row 1 moves to the fifth cell, the last cell of row 2. From a group's last row, Down moves to the first row of the next non-empty group, in the same column, or to that row's last cell if the row is shorter. Up moves to the cell directly above in the same column of the same group; rows above the current row in a group are always full, so that cell always exists. From a group's first row, Up moves to the last row of the previous non-empty group, in the same column, or to that row's last cell if the row is shorter. In a one-column layout (375 px) Down equals Right and Up equals Left. Space marks the focused treatment given. Shift+Space reopens a given or skipped treatment. `N` opens `Add note` and `S` opens `Skip treatment`, each for the focused treatment; Escape closes either and returns focus to the cell. Typing Space inside a dialog types a space. When a pushed update moves a cell to another group, focus follows the same treatment.

**Consult note.** Each paragraph is its own textbox. A paragraph saves about half a second after typing stops and when focus leaves it. Another window's change to a paragraph appears in place within the live-update limit; it never moves the caret or replaces text in the paragraph the user is currently editing. `Add paragraph` appends an empty paragraph and focuses it. `Apply draft` saves the draft text over the current paragraph using its latest version (it can conflict again), `Discard draft` removes the draft box.

**Patients and search.** Typing in `Search patients` filters the list in place after each keystroke (no submit) and announces the result count.

**Invoice screen.** Tab order is: lines table, `Stock item`, `Quantity`, `Add line`, `Discount percent`, `Apply discount`, `Issue invoice`, `Payment amount`, `Take payment`, `Void invoice`. Enter in `Quantity` presses `Add line`, Enter in `Payment amount` presses `Take payment`. `Payment amount` is in pounds. `Void invoice` opens the `Void invoice` dialog; Escape closes it and focus returns to the `Void invoice` button.

**Stock screen.** `Quantity` on the movement form takes a positive whole number only; `Reason` sets the sign (`Received` adds, `Expired` removes) and decides whether `Batch` is a textbox with `Expires on` beside it or a combobox of the item's batches.

**Staff screen.** `Change role, <Name>` opens `Change role`; closing it returns focus to that button. `Remove access, <Name>` acts at once without a further question and moves focus to the heading `Staff`.

**Public booking page.** The pills `Book a visit` and `Choose a time` each move focus to `Day`. Changing `Day` or the visit reason reloads that day's times in place. Tapping a time button chooses it and shows the owner and pet fields. The times also refresh every 15 seconds and after any conflict.

**Hover and press.** Pill buttons change fill in about a quarter of a second. The arrow chip's arrow shifts a few pixels right in about a quarter of a second and its fill darkens. Reduced motion keeps the colour change and drops the shift.

### Visual design (DP-09, DP-10, DP-25)

The look is calm and clinical-friendly: the ground is flat, the cards are pastel and the numbers are large. The page ground is flat white. Cards and the calendar sit on a warm off-white surface. Form inputs sit on a slightly darker stone-grey pill track. There are no gradients, no glass, no textured backgrounds and no decorative rules; separation comes from tinted cards and white space.

- **Type.** Headlines use Plus Jakarta Sans in bold or extra-bold, sentence case, tightly leaded and with slightly tight letter spacing. Body text uses DM Sans in regular and medium with tabular figures for every numeral. The main headline on a screen is at least three times the size of body text. Card titles sit between body and headline size. Fonts are bundled with the app and licensed under the SIL Open Font License; nothing loads from another origin.
- **Palette roles.** Near-black ink for headings, a dark grey body ink, a mid grey for dates and secondary text. A deep hero navy fills the left half of each screen split band, the quote statement and the outage banners; a slightly brighter navy is used for quote text. A bright mint is the accent of primary pill buttons with dark text. A bright secondary blue and a light sky-blue make the closing strip. A solid royal blue is the fill of solid buttons with white text. Deep green is the colour of card titles and arrow chips on mint cards, with a slightly lighter link green for links. Pastel tints carry content: pale mint (consult, `Waiting`), pale rose with plum ink (surgery, `Overdue`, the late chips), pale sky with deep teal-blue ink (vaccination, `Due within the hour`), and a pale band blue for the meet the vets band.
- **Shape.** Pills and chips are fully rounded. Cards, calendar blocks and tiles have gently rounded corners. Tally cards and banners are rounded slightly more. Row cards and thumbnails are rounded least.
- **Composition.** One content column with generous side margins (wide on desktop, a little narrower on the phone). The staff header and the public header are tall white bars with a mint pill action. Every working screen opens with the screen split band, then tinted rounded cards carry the work.
- **Pill action buttons.** Fully rounded, at least 44 px tall. The primary is mint with dark text, the solid variant is royal blue with white text, the secondary is transparent with a thin light-blue outline on navy. States: hover and press shift the fill, focus shows a visible two-pixel ring, disabled is paler and busy keeps the label.
- **Density.** Comfortable: generous padding on cards, 44 px or larger controls, generous space between cards.
- **Ward tally cards (the Kennel beacon) are loud on purpose.** The numerals are the largest text on `Ward` apart from the headline, at least two and a half times body size, in tabular figures, so a nurse across the room can read `3` on the `Overdue` card. Each card is a flat tinted card with a caption beneath the numeral.
- **Appointment cards** carry the reason as text and a tint. Status is a text chip. The `Late` chip and the `Arrived <N> min late` chip are rose-tinted pills with plum ink whose text meets WCAG AA contrast (at least 4.5 to 1 against their fill) and which stay readable with all colour removed.
- **Forms** use the stone-grey pill tracks, visible labels, and inline messages under the field. **Tables** have a bold header row, plain rows and no heavy borders. **Empty states** are a single tinted card with a bold title and one pill. **Errors and outages** are a navy banner in the page flow (never a toast) with light-blue title text, placed where the failed action happened, with the message as its title.
- **Patient cards with arrow chip** show the round initials avatar, the bold name, species and status chips and a dark arrow chip. **Species and status chips** are small pills with a warm off-white fill and no border; they are not interactive.
- **Patient history feature and list** is described in Screens and layout; its row cards are rounded least and have a thin light border.
- **Invoice footnote block** is plain text on the white ground, no card or divider, one paragraph per footnote, with markers matching the lines they annotate.
- **Public page.** The hero, reason chooser cards, services tiles and meet the vets band follow Screens and layout, in the same palette, type and shapes.
- **Imagery** is procedural: rounded rectangles, pill tags, simple silhouettes and initials, in mint, sky and rose. No photographs are required and no external image is loaded.
- WCAG 2.2 AA contrast for all text and controls; a visible two-pixel focus ring on every control.

### Motion and effects (DP-06, DP-31)

Motion is limited to the items below. There are no looping or decorative animations, no parallax and no scroll-linked effects. Each item publishes `data-motion` (its name), `data-motion-ms` and `data-motion-easing` on the element named below. `data-motion-easing` holds either a keyword (`ease-out`, `ease-in-out`) or, for the custom curves, four control numbers separated by a comma and a space, exactly as listed in the table (for example `0.2, 0, 0, 1`). The attributes are present from the moment the motion starts until at least one second after it ends. A check may read them at any time within that window.

| Name | Element | Meaning and feel | ms | easing |
|---|---|---|---|---|
| `appointment-move` | the appointment button | glides to its new slot or size, also when the change comes from another window | 250 | `0.2, 0, 0, 1` |
| `queue-arrive` | the new waiting-room `listitem` | slides in at the end of the list | 400 | `ease-out` |
| `board-status` | the ward `gridcell` | a treatment changes colour and moves into its new group | 300 | `ease-in-out` |
| `beacon-count` | each Kennel beacon card | on first view the numeral counts from 0 to the server total, cards starting 150 ms apart | 1600 | `0.16, 1, 0.3, 1` |
| `beacon-roll` | the Kennel beacon card that changed | on a server-pushed change only the digits that changed roll to the new value | 600 | `0.16, 1, 0.3, 1` |
| `toast` | the `Notice` toast | slides in | 200 | `ease-out` |
| `chip-nudge` | the arrow chip while hovered or focused | arrow shifts right | 250 | `ease-in-out` |

**Signature: Kennel beacon.** On first view of `Today` or `Ward` the three cards (top to bottom `Waiting`, `Overdue`, `Due within the hour`) show their numerals counting from 0 up to the server totals over about one and a half seconds, ending together within about two seconds. If the server total changes during that count, it finishes on the new total. During this first count no digit carries `data-rolling`.

Each numeral is built of one element per digit, each with `data-digit` holding the digit it finally shows. After the first view, every server-pushed change rolls only the digits that changed, over the `beacon-roll` time. During that time exactly the changed digits carry `data-rolling="true"` and unchanged digits never do. A change in the number of digits rolls every digit (9 to 10, 10 to 9); 12 to 13 rolls only the last digit. When several doses turn overdue in one refresh the numeral rolls once, to the new total. In the same frame the ward cell that caused the change moves into or out of the `Overdue` group (`board-status`). The polite `Announcements` region announces it as given in Feedback states.

At rest a card reads `data-motion="idle"`; it reads `beacon-count` or `beacon-roll` from the start of that motion until one second after it ends. `data-value` always holds the server count, even while digits are rolling. The digits are hidden from assistive technology and the card carries the server count as a plain number in visually hidden text, never the in-between digits. A card does not announce on its own.

**Reduced motion** (`prefers-reduced-motion: reduce`). Every item above reads `data-motion="none"` and `data-motion-ms="0"`. Final values and final positions appear at once: the beacons show the final counts with no rolling and no digit ever carries `data-rolling`, cells change group without moving, blocks jump to their slot, rows appear in place, the toast appears without sliding, and the arrow chip changes colour only. Announcement text is identical in both modes.

### Feedback states (DP-08, DP-14, DP-15, DP-17, DP-18, DP-24, DP-25, DP-28, DP-32, DP-35, DP-38, DP-39, DP-40, DP-43, DP-45, DP-46, DP-47, DP-55, DP-57, DP-59)

Every async button is disabled and marked busy while its request is pending and keeps its label. Every success is announced in the polite `Announcements` region with the copy below, in the window of the person who did the action, except the two server-started announcements (a treatment turned overdue, announced in every open window showing the Kennel beacon, and low stock, announced in every open manager window). Other windows update silently. Every error is shown in an in-flow banner or inline message with the `alert` role carrying exactly the message below. Apostrophes and dashes below are the plain keyboard characters; `<...>` are placeholders: `<HH:MM>` is 24-hour clinic time, `<Day DD Mon>` is a three-letter weekday, a two-digit day and a three-letter month (for example `Tue 17 Nov`), `<DD Mon YYYY>` is two-digit day, three-letter month and four-digit year, amounts are `£1,234.56`, `<Status>` is the label of the appointment's status, `<Name>` is the display name of the person who won or acted, `<Kennel>` is the kennel name, `<UPLOAD_MAX_MB>` is the setting value, `<P>` is the invoice's discount percent as a whole number, `<N>` in a late chip is the whole minutes late. A treatment pair `<Patient>, <Treatment>` is the patient name, a comma, a space and the treatment name. `<signed quantity>` is the movement's delta with a leading `+` for a receipt or the plain keyboard hyphen-minus `-` for a removal, no space and no thousands separator, for example `Recorded +12 for Sterile saline 500 ml.` and `Recorded -2 for Cefalexin 250 mg tablets (10).`

**Error copy by code** (this is the `message` in the API body):

| Code | Copy |
|---|---|
| `unauthenticated` | `Sign in to continue.` |
| `not_found` | `We couldn't find that.` (the API body and in-flow alerts only; never the title of a screen, which uses the not-found page below) |
| `forbidden` | `Your role cannot do that.` |
| `invalid_credentials` | `Email or password is not right.` |
| `slot_taken` | `That slot was just taken. Pick another time.` |
| `outside_hours` | `Appointments must be between 08:00 and 18:00.` |
| `invalid_transition` | `This appointment is <Status> and cannot be changed that way.` |
| `too_early` | `That appointment has not started yet.` |
| `undo_expired` | `Undo is no longer available.` |
| `stale_paragraph` | `<Name> changed this paragraph first. Your text is kept below as a draft.` |
| `paragraph_too_long` | `Keep each paragraph under 5,000 characters.` |
| `already_given` | `<Patient>, <Treatment> was already given.` |
| `not_due` | `<Patient>, <Treatment> is not due yet.` |
| `already_skipped` | `<Patient>, <Treatment> was skipped.` |
| `not_closed` | `<Patient>, <Treatment> is not given or skipped.` |
| `kennel_taken` | `Kennel <Kennel> is already occupied.` |
| `insufficient_stock` | `Only <N> of <Item> in stock.` with `<N>` the usable quantity at the moment of rejection (for a write-off, the remaining quantity of the named batch) |
| `invoice_not_draft` | `Only a draft invoice can be changed.` |
| `invoice_exists` | `This consult already has an invoice.` |
| `no_lines` | `Add at least one line before issuing.` |
| `invoice_not_issued` | `Issue the invoice before taking payment.` |
| `invoice_closed` | `This invoice is closed.` |
| `invoice_has_payments` | `An invoice with payments cannot be voided.` |
| `payment_too_large` | `Payment is more than the balance due.` |
| `idempotency_key_reused` | `That key was already used for a different request.` |
| `duplicate_vaccination` | `That vaccination is already recorded.` |
| `email_taken` | `That email already has access.` |
| `own_access` | `You cannot change your own access.` |
| `weak_password` | `Use at least 10 characters.` |
| `out_of_window` | `That time is not available for online booking.` |
| `rate_limited` | `Too many booking attempts. Try again in a minute.` |
| `unsupported_type` | `Only JPEG, PNG or PDF files are allowed.` |
| `file_too_large` | `That file is larger than <UPLOAD_MAX_MB> MB.` |
| `payload_too_large` | `That request is too large.` |
| `storage_unavailable` on upload | `File storage is unavailable. Your file was not saved.` |
| `storage_unavailable` on download or export | `File storage is unavailable.` |
| `database_unavailable` | `The clinic database is unavailable. Try again shortly.` |
| `validation_failed` | for a missing required field `<Field label> is required.`, for a wrongly shaped value `<Field label> is not valid.`, where `<Field label>` follows the field rule in Business rules; the public booking form instead uses `Enter your name.`, `Enter an email address like name@example.com.` and `Enter your pet's name.`; an invalid payment amount reads `Enter an amount like 12.50.` |

**Error summary (Book appointment, Skip treatment, Add note, Change role, Void invoice).** Pressing the confirm button of one of these dialogs first checks its fields in the browser: `Book appointment` needs `Client` and `Patient` chosen (labels `Client` and `Patient`), `Skip treatment` needs `Reason`, `Add note` needs `Note`, `Change role` needs `Role` chosen, `Void invoice` needs `Reason` (blank or spaces only counts as empty). If a field fails, nothing is sent. The dialog shows an `alert` error summary at its top listing each message (`Patient is required.`, `Reason is required.`, `Note is required.`, `Role is required.`) as a link that focuses that field, and the same text beside the field, linked to it as its description. Focus moves to the summary. The dialog stays open and keeps every other value, such as the chosen `Vet` and `Reason`. Every dialog, `Admit patient` included, shows a server rejection of its own request (the slot conflict, a skipped treatment, `own_access`, a 422) in the same summary with its copy from the table above and focus moves to the summary; for a 422 with a `field`, its link focuses the control of that field. A pushed refresh never clears, rewrites or moves focus from a summary. A success closes the dialog and is announced once in `Announcements`, never in an alert.

**Pending, retry and refresh rules.**
- `Start consult for <Patient>` is disabled and marked busy while its request is pending and keeps its label. The row leaves only when the server answers success or when the live push shows it gone. The window that loses a simultaneous start gets the `invalid_transition` copy in its alert (reading `In consult` as the status), never announces the success text, and its row leaves through the push.
- A consult paragraph has at most one save in flight per window. Text typed meanwhile stays in the box and is saved next, using the version returned by the save in flight, so a window never conflicts with itself. A save answer never replaces text typed after that save was sent. `Note status` reads `Saving` until the last queued save of any paragraph has completed, then `Saved`.
- The `Notice` toast is the only toast. A newer cancel replaces it, restarts its lifetime and retargets `Undo` and Ctrl+Z to the newest cancel; an older toast's timer never hides a newer toast. A toast stays for the time between the cancel's `undoUntil` and the `now` returned with that same cancel, measured in the page and never from the browser's wall clock. A successful restore removes the toast. If `Undo` is answered with `undo_expired` or `slot_taken`, the alert shows that copy, the toast closes and the block does not reappear.
- A ward dialog, its summary, its typed text and its focus survive every timed or pushed refresh, and a message the user's own action just showed stays until their next action. A ward rejection raised from a dialog (for example `already_skipped` when the other nurse acted first) is shown in that dialog's summary and the dialog stays open while the cell shows the server's state.
- The invoice screen makes one `Idempotency-Key` per attempt. A payment attempt is one value submitted from `Payment amount`; a line attempt is one `Stock item` and `Quantity` pair. If a request ends with no response at all, the screen resends it once at once with the same key and body. A second Enter or click while the attempt is pending sends nothing. An attempt ends when any response arrives or the user changes its value; if both sends got no response, pressing again with the unchanged value reuses the key. The success announcement is made once however many sends it took.
- `Payment amount` accepts, after trimming spaces, only one or more digits optionally followed by a point and one or two digits; `12.5` means `£12.50`. Anything else (`£12.50`, `1,234.56`, `0`, `0.00`, `-1`, an empty box) shows `Enter an amount like 12.50.` beside the field as an alert and sends nothing.
- On the public booking page the time buttons always belong to the `Day` and visit reason currently chosen; an answer for an earlier choice that arrives late is discarded. The 15-second refresh keeps the chosen time and typed owner and pet fields. If the chosen time is no longer offered, or the booking is answered with `slot_taken`, the choice is cleared, `Chosen time` reads the `slot_taken` copy and the typed fields are kept. `Confirm booking` is disabled and busy while pending, and a second tap sends nothing.
- A change in one open window reaches the others as the live-update limit in Browser support and performance says; those windows update in place, keep their open dialogs and focus, and make no success announcement.
- When a manager changes another person's role, that person's open windows re-render within the live-update limit: the header shows the new role label, a screen the new role cannot use shows the forbidden card, and controls it cannot use disappear. When access is removed, their windows go to the sign-in page as set in Business rules.

**Slot conflict placement.** When it comes from `Book appointment` it is shown in that dialog's summary; otherwise in the page's alert banner. The ward rejections `already_given`, `not_due`, `already_skipped` and `not_closed` raised without a dialog appear in the alert region of the ward board and nothing changes on the cell. `stale_paragraph` appears under the paragraph, and the editor's unsaved text moves into the `Draft` box under that paragraph while the paragraph shows the winner's text.

**Late chips.** While a booked appointment is late its calendar card (and agenda row) shows the text chip `Late`. A waiting-room row whose patient was checked in late shows the text chip `Arrived <N> min late`. Both chips appear in the window within the live-update limit of the moment the server decides it.

**How `Announcements` holds messages.** The region appends one child element per message, oldest first, and keeps every message of the page session; it never rewrites an earlier child. "Exactly one announcement" means exactly one new child. When one manager action both records a movement and crosses the reorder point, two children are appended in this order: first `Recorded <signed quantity> for <Item>.`, then `<Item> is low: <N> left.`. The same two-child order applies to an invoice line that crosses the reorder point: `Added <Item> x<quantity> to <Number>.` first, then the low-stock message.

**Success announcements** (polite `Announcements`):

| Action | Copy |
|---|---|
| appointment booked | `Booked <Patient> with <Vet> at <HH:MM>.` |
| appointment moved | `Moved <Patient> to <Room>, <HH:MM>.` |
| appointment resized | `<Patient> now runs <HH:MM> to <HH:MM>.` |
| check-in | `<Patient> checked in.` |
| consult started | `<Patient> is now in consult.` |
| consult completed | `Consult completed for <Patient>.` |
| no-show | `<Patient> marked no-show.` |
| cancel | toast text `Appointment cancelled.` (same text announced) |
| restore | `Appointment restored.` |
| treatment given | `<Patient>, <Treatment> marked given.` |
| treatment reopened | `<Patient>, <Treatment> reopened.` |
| treatment skipped | `<Patient>, <Treatment> skipped.` |
| treatment note saved | `Note saved for <Patient>, <Treatment>.` |
| a treatment turned overdue | `Overdue now <N>. <Patient>, <Treatment> due <HH:MM>.` with `<N>` the new overdue total; when one refresh turns several overdue at once, one announcement names the earliest scheduled of them |
| patient admitted | `<Patient> admitted to <Kennel>.` |
| invoice line added | `Added <Item> x<quantity> to <Number>.` |
| invoice issued | `<Number> issued.` |
| payment taken | `Payment of £x.xx taken. Balance due £x.xx.` |
| invoice voided | `<Number> voided.` |
| usable stock fell to or below its reorder point | `<Item> is low: <N> left.` with `<N>` the usable quantity after the movement or expiry that crossed |
| stock movement recorded | `Recorded <signed quantity> for <Item>.` |
| file stored | `<File name> saved to Files.` |
| weight saved | `Weight saved.` |
| vaccination added | `Vaccination added.` |
| invitation created | `Invitation created for <Email>.` |
| role changed | `<Name> is now <Role label>.` |
| access removed | `Access removed for <Name>.` |
| search results | `<N> patients found.` |

The Kennel beacon cards do not announce on their own; `Announcements` carries the text above. The pending file upload line reads `Uploading <File name>`.

**Invoice footnotes.** The `Invoice footnotes` note holds, in this order, `* Discount of <P>% applied to this line.` only while the discount is above 0, and `** VAT at <VAT_PERCENT>% on the line after discount.` always, where `<VAT_PERCENT>` is the setting's number. In the `Invoice lines` table every line's description cell ends with the markers that apply: a space and `*` when the discount is above 0, then a space and `**`.

**Empty states** (title text): `No one is waiting.` (with pill `Go to calendar`), `No patients are in the ward.` (pill `Admit a patient`), `No patients match your search.` (pill `Clear search`), `No invoices yet.`, `No times are available on this day.` (also the alert shown if `Book a time` finds no free slot left today). **Not-found page.** This covers every unknown route, every unknown record and every record outside the caller's clinic, including one reached through a sign-in `next` path. It is one tinted card whose title is exactly `We couldn't find that page.`, with the pill `Back to today`, which goes to `/today`.

**Public confirmation.** Heading `Your visit is booked`, then `<Pet> is booked with <Vet> on <Day DD Mon> at <HH:MM>.`, then `A confirmation email is on its way to <Email>.` (true even when SMTP is slow, because delivery is retried). The `Chosen time` status reads `No time chosen yet.` before a choice and `You chose <HH:MM> with <Vet> on <Day DD Mon>.` after it. A reminder link that is valid shows `Booking for <Pet>` and fills the owner and pet fields; one that is not valid shows the plain page with no error and no such text.

**Storage outage banner** is the upload failure copy above, shown in the navy in-flow banner on `Files` while nothing is listed.

## Backend

### API (DP-02, DP-03, DP-17, DP-23, DP-27, DP-37, DP-38, DP-40, DP-42, DP-45, DP-46, DP-51, DP-53, DP-54, DP-56, DP-58, DP-59, DP-60)

Requests and responses are JSON (`application/json`, request bodies at most 100,000 bytes, a body of exactly that size is allowed) except uploads (multipart, see Server boundary) and PDFs (`application/pdf`). Success bodies below name only the fields tests rely on; ids are strings. Instants are ISO-8601 UTC strings ending in `Z`; the browser formats them in clinic time. Roles are `front-desk`, `nurse`, `vet`, `manager`; the staff session is a cookie set at sign-in. `species` is always one of the lowercase values `dog`, `cat`, `rabbit`, `other`, in every request and every response; any other string, including `Dog`, is 422. The UI shows them as `Dog`, `Cat`, `Rabbit`, `Other`. Error codes, their statuses, their order and their body shape are in Business rules and their copy in Feedback states; endpoint rows name only their own extra error codes.

**Time, health, session**
- `GET /api/health` (public): 200 `{"status":"ok"}` as qualified in Server boundary.
- `GET /api/time` (public): 200 `{"now":"<instant>","clinicDate":"YYYY-MM-DD","timeZone":"Europe/London"}`.
- `POST /api/session` `{"email","password","next"}` (`next` optional): 200 `{"user":{...},"landing":"<path>"}` and sets the session cookie. `landing` is `next` when it is a safe path (Business rules), otherwise `/today`. Extra: `invalid_credentials`.
- `DELETE /api/session`: 204.
- `GET /api/me`: 200 `{"id","name","role","clinic":{"id","name","slug"}}`, with the role read from Postgres on this request.
- `GET /auth/link/<token>[?next=<path>]` (page route): consumes a one-time login token, sets the session cookie, answers 302 to the same `landing` rule. An unknown or used token answers 302 to `/login`.
- `GET /api/live`: server-sent event stream of the caller's clinic changes (calendar, queue, ward, notes, stock, beacons, staff roles). The browser reconnects automatically and refetches state after a reconnect. Tests do not read it.

**Grading routes** (header `X-Grading-Token` must equal `GRADING_TOKEN`; a missing or wrong token is 401; when `GRADING_TOKEN` is unset both routes answer 404)
- `POST /api/grading/clock` `{"now":"<ISO-8601>"}`: 200 `{"now":"<instant>"}`. Sets the server clock; it then runs forward in real time from that value. Before the first call the server uses real time. By the time it answers, every pending reminder, status transition, late flag, batch expiry and tick that the new time causes has been processed and pushed. An unparseable value is 422. `GET /api/grading/clock` answers 200 `{"now"}`.
- `POST /api/grading/seed`: creates one scenario and answers 201. The body is an object with these optional arrays; each item has a `ref` string that other items use to point at it; refs are local to the call. Nothing is deleted.
  - `clinics`: `{"ref","name","slug"}`.
  - `users`: `{"ref","clinic","name","email","role"}`; each also gets the password in Seed data.
  - `rooms`: `{"ref","clinic","name"}`.
  - `clients`: `{"ref","clinic","name","email"}`.
  - `patients`: `{"ref","clinic","client","name","species","weightGrams","photo":false,"vaccinations":[{"vaccine","dueDate":"YYYY-MM-DD"}],"weights":[{"recordedOn":"YYYY-MM-DD","grams"}]}`. With `"photo":true` the patient gets a small generated profile photo.
  - `appointments`: `{"ref","clinic","patient","vet","room","start","minutes","reason","status","checkedInAt"}` where `status` is `booked`, `checked-in`, `in-consult`, `completed` or `no-show` and `checkedInAt` is optional.
  - `hospitalised`: `{"ref","patient","kennel","treatments":[{"name","firstAt","intervalHours","count","givenDoses":[0]}]}` where `firstAt` is an instant ending in `Z` and `givenDoses` lists zero-based dose indexes already given.
  - `stock`: `{"ref","clinic","name","onHand","reorderPoint","unitPricePence","batches":[{"batch","expiresOn":"YYYY-MM-DD","quantity"}]}`. With `batches`, each batch gets one `receive` movement in the order listed and `onHand` is their sum; without it, `onHand` becomes one batch `OPENING` expiring `2099-12-31`.
  - `invoices`: `{"ref","clinic","patient","status":"draft|issued","discountPercent","lines":[{"stock","quantity"}],"payments":[{"pence","by"}]}`; lines draw stock as normal and payments move the status as normal. `by` is a user ref and is optional; without it the payment is taken by the first `front-desk` or `manager` user of that clinic.
  - Response 201: `{"clinics":{"<ref>":"<id>"},"users":{"<ref>":{"id","login_url"}},"rooms":{...},"clients":{...},"patients":{...},"appointments":{...},"hospitalised":{...},"treatments":{"<hospitalised ref>":["<id>"]},"stock":{...},"invoices":{...}}`. Each `login_url` is absolute (built from `APP_PUBLIC_URL`, else the request origin), is used once, signs that user in and accepts the `next` rule of `/auth/link`. A bad reference is 422.

**Invitations and staff** (manager)
- `POST /api/staff/invitations` `{"email","name","role"}`: 201 `{"id","email","role","status":"Invited"}` and one Mailpit email. Extra: `email_taken` for an active member of any clinic. A new invitation to an email that already has a pending one replaces it and the earlier link stops working. Inviting a removed member's email makes that member `Invited` again.
- `GET /api/staff`: 200 `{"staff":[{"id","name","email","role","status":"Active|Invited|Removed"}]}`.
- `PATCH /api/staff/<id>` `{"role"}`: 200 with the staff member. Extra: `own_access`. A removed member's id is 404.
- `DELETE /api/staff/<id>`: 200 `{"id","status":"Removed"}`. Extra: `own_access`. A removed member's id is 404.
- `GET /api/invitations/<token>` (public): 200 `{"clinicName","email","name"}`; unknown or used token is 404.
- `POST /api/invitations/<token>/accept` `{"password"}` (public): 200 `{"user":{...}}` and sets the session cookie; the page then goes to `/today`. Extra: 404 for an unknown or used token; `weak_password`.

**Reference data**
- `GET /api/rooms` (`{"rooms":[{"id","name"}]}`), `GET /api/vets` (`{"vets":[{"id","name"}]}`), `GET /api/clients` (`{"clients":[{"id","name","patients":[{"id","name"}]}]}`).

**Appointments**
- `GET /api/appointments?date=YYYY-MM-DD` (date is a clinic date; default today): 200 `{"appointments":[{"id","patientId","patientName","species","vetId","vetName","roomId","roomName","start","end","reason","status","late"}]}` with statuses `booked`, `checked-in`, `in-consult`, `completed`; `cancelled` and `no-show` are omitted.
- `POST /api/appointments` `{"patientId","vetId","roomId","start","minutes","reason"}` (`minutes` optional, a multiple of `SLOT_MINUTES` from one slot to 120 minutes, default one slot; `reason` is `Consult`, `Vaccination` or `Surgery`): 201 with the appointment. Extra: `slot_taken`, `outside_hours`.
- `PATCH /api/appointments/<id>` any of `{"start","roomId","vetId","minutes"}`: 200 with the appointment. Extra: `slot_taken`, `invalid_transition`, `outside_hours`.
- `POST /api/appointments/<id>/check-in`, `/start`, `/complete`, `/no-show`: 200 with the appointment. Extra: `invalid_transition`; `/no-show` also `too_early`.
- `DELETE /api/appointments/<id>`: 200 `{"id","status":"cancelled","undoUntil":"<instant>","now":"<instant>"}` where `now` is the server clock at the cancel. Extra: `invalid_transition`.
- `POST /api/appointments/<id>/restore`: 200 with the appointment back in the status it had before the cancel. Extra: `invalid_transition`, `undo_expired`, `slot_taken`.
- `GET /api/queue`: 200 `{"queue":[{"appointmentId","patientId","patientName","species","vetName","checkedInAt","waitingMinutes","lateByMinutes"}]}` ordered by check-in time, ties by id; `lateByMinutes` is an integer or null.

**Consult note**
- `GET /api/appointments/<id>/note`: 200 `{"appointmentId","paragraphs":[{"n","text","version","editedBy"}]}`; a note that does not exist yet starts with one empty paragraph `n` 1 at version 1.
- `PUT /api/appointments/<id>/note/paragraphs/<n>` `{"text","version"}`: 200 with the saved paragraph (version increased by one). Extra: `stale_paragraph`; 404 for an unknown paragraph; `paragraph_too_long` for text over 5,000 characters.
- `POST /api/appointments/<id>/note/paragraphs` `{"text"}`: 201 with the new paragraph appended at `n` one higher than the highest.

**Patients, files, PDFs**
- `GET /api/patients?q=<text>`: 200 `{"patients":[{"id","name","species","clientName","weightGrams","photoFileId","status"}]}`; `q` matches patient or client names, case-insensitively, as a substring; `status` is `In ward`, `Waiting`, `In consult` or null.
- `GET /api/patients/<id>`: 200 with the patient, `"weights":[{"recordedOn","grams"}]`, `"vaccinations":[{"id","vaccine","dueDate","reminder":"Scheduled|Sent|Missed"}]` and `"history":[{"appointmentId","start","reason","vetName","notePreview"}]` (completed consults, newest first).
- `POST /api/patients/<id>/weights` `{"grams"}` (integer from 1 to 200000): 201.
- `POST /api/patients/<id>/vaccinations` `{"vaccine","dueDate"}`: 201. Extra: `duplicate_vaccination` for the same vaccine and due date.
- `POST /api/patients/<id>/files` multipart with `file` and `kind` (`xray`, `wound`, `lab`, `consent`, `profile`) and an optional `appointmentId`: 201 `{"id","name","kind","contentType","sizeBytes","sha256","url"}`. `name` is the submitted file name exactly. `sha256` is the lowercase hex SHA-256 of the stored bytes. `contentType` is the sniffed type. Extra: `storage_unavailable`, `unsupported_type`, `file_too_large`.
- `GET /api/patients/<id>/files`: 200 `{"files":[...same fields]}` in upload order.
- `GET /api/files/<id>/content`: 200 the stored bytes, identical to the upload, with the headers set in Business rules. Extra: `storage_unavailable`.
- `GET /api/patients/<id>/history.pdf[?include=files]` and `GET /api/invoices/<id>.pdf`: 200 `application/pdf`. Extra: `storage_unavailable`.

**Ward**
- `GET /api/ward/board`: 200 `{"beacons":{"waiting","overdue","dueWithinHour"},"treatments":[{"id","patientId","patientName","kennel","name","scheduledAt","status":"upcoming|due|overdue|given|skipped","givenAt","givenBy","skipReason","notes":[{"id","text","author","createdAt"}]}]}` in group order (overdue, due, upcoming, then given and skipped), each group by scheduled time.
- `GET /api/beacons`: 200 the same `beacons` object.
- `POST /api/ward/admissions` `{"patientId","kennel","treatments":[{"name","firstAt","intervalHours","count"}]}`: 201 `{"id","treatmentIds":[...]}`. `firstAt` is the clinic-time text `YYYY-MM-DD HH:MM` exactly as typed in `First dose`; `intervalHours` is a whole number from 1 to 24; `count` is a whole number from 1 to 28. Each returned treatment has `scheduledAt` as a UTC instant on the board. Extra: `kennel_taken`; 422 for a kennel name outside `K1` to `K12`.
- `POST /api/treatments/<id>/given`, `/reopen`: 200 with the treatment. `POST /api/treatments/<id>/skip` `{"reason"}`: 200. `POST /api/treatments/<id>/notes` `{"text"}`: 201 with the note. Extra by endpoint: given: `already_given`, `not_due`, `already_skipped`; skip: `not_due`, `already_given`, `already_skipped`, and 422 for a blank reason; reopen: `not_closed`.

**Invoices**
- `GET /api/invoices[?status=<draft|issued|part-paid|paid|voided>]`: 200 `{"invoices":[{"id","number","patientName","status","totalPence","balancePence"}]}`.
- `POST /api/invoices` `{"patientId","appointmentId"}` (`appointmentId` optional): 201 invoice `draft`. Extra: `invoice_exists` when that consult already has a non-voided invoice.
- `GET /api/invoices/<id>`: 200 `{"id","number","patientId","patientName","status","discountPercent","lines":[{"id","stockItemId","description","quantity","unitPricePence","netPence","discountPence","vatPence","totalPence"}],"totalPence","paidPence","balancePence","payments":[{"id","pence","at","takenBy":{"id","name"}}],"voidedBy":{"id","name"},"voidedAt","voidReason"}` where the three void fields are null until voided.
- `POST /api/invoices/<id>/lines` `{"stockItemId","quantity"}` (integer 1 to 999): 201 with the invoice. Optional header `Idempotency-Key`. Extra: `invoice_not_draft`, `insufficient_stock`, `idempotency_key_reused`.
- `DELETE /api/invoices/<id>/lines/<lineId>`: 200 with the invoice. Extra: `invoice_not_draft`.
- `PATCH /api/invoices/<id>` `{"discountPercent"}` (integer 0 to 100): 200. Extra: `invoice_not_draft`.
- `POST /api/invoices/<id>/issue`: 200. Extra: `invoice_not_draft`, `no_lines`.
- `POST /api/invoices/<id>/payments` `{"pence"}` (integer, at least 1; anything else is `validation_failed` on `pence`) with optional `Idempotency-Key`: 201 with the invoice. Extra: `invoice_not_issued`, `invoice_closed`, `idempotency_key_reused`, `payment_too_large`.
- `POST /api/invoices/<id>/void` `{"reason"}`: 200 with the invoice. Extra: `invoice_has_payments`, `invoice_closed`; a blank or over-long `reason` is `validation_failed` on `reason`.

**Stock**
- `GET /api/stock`: 200 `{"items":[{"id","name","onHand","usable","reorderPoint","unitPricePence","low","batches":[{"batch","expiresOn","remaining","expired"}]}]}`.
- `GET /api/stock/<id>/movements`: 200 `{"onHand","usable","movements":[{"id","delta","reason","batch","invoiceLineId","pairedMovementId","balanceAfter","by","at"}]}` in server order, oldest first. `reason` is `receive`, `expired`, `invoice-line` or `return`; `by` is the staff id or null for seeded receipts.
- `POST /api/stock/<id>/movements` `{"delta","reason","batch","expiresOn"}` (`reason` `receive` with a positive `delta`, a `batch` and an `expiresOn`, or `expired` with a negative `delta` and a `batch`; `expiresOn` is ignored for `expired`): 201 with the movement. Extra: `insufficient_stock`.

**Public booking** (no sign-in)
- `GET /api/public/clinics/<slug>`: 200 `{"name","slug","vets":[{"id","name"}]}`; unknown slug 404.
- `GET /api/public/clinics/<slug>/slots?date=YYYY-MM-DD[&reason=<public reason>]`: 200 `{"date","slots":[{"start","vetId","vetName"}]}` as defined in Business rules. An invalid `date` or unknown `reason` is 422.
- `GET /api/public/clinics/<slug>/pets/<token>`: 200 `{"petName","species","ownerName","ownerEmail"}`; 404 under the token rule in Business rules.
- `POST /api/public/clinics/<slug>/bookings` `{"start","vetId","reason","ownerName","ownerEmail","petName","species","petToken"}` (`reason` is one of the four public reasons exactly as shown on the cards, `petToken` optional): 201 `{"code","petName","vetName","start","ownerEmail"}`. Extra: `slot_taken`, `out_of_window`, `rate_limited`, and the public field errors on `ownerName`, `ownerEmail` and `petName`. An invalid `petToken` is 404.
- `GET /api/public/bookings/<code>`: 200 `{"clinicName","petName","vetName","start","ownerEmail"}`; unknown code 404.

### Business rules (DP-02, DP-03, DP-04, DP-11, DP-13, DP-15, DP-17, DP-23, DP-25, DP-27, DP-30, DP-32, DP-37, DP-38, DP-40, DP-42, DP-43, DP-45, DP-46, DP-49, DP-51, DP-54, DP-58, DP-59, DP-60)

**Clock and settings.** The clinic's time zone is `Europe/London`. Every date and time the UI shows is clinic time, whatever the browser's zone, and the browser's clock decides nothing. The server decides every time-dependent state from the server clock, which the grading clock route can set. Settings are read from the environment with these defaults:

| Setting | Default | Meaning |
|---|---|---|
| `SLOT_MINUTES` | 15 | slot length |
| `LATE_MINUTES` | 10 | minutes after a booked appointment's start before it is late |
| `TREATMENT_GRACE_MINUTES` | 15 | minutes after the scheduled time before a treatment is overdue |
| `ADMISSION_LINGER_HOURS` | 12 | hours an admission stays on the board after its last dose was given or skipped |
| `BOOKING_LEAD_MINUTES` | 30 | earliest online start, minutes ahead of the server clock |
| `BOOKING_HORIZON_DAYS` | 28 | latest online start, days ahead |
| `REMINDER_LEAD_DAYS` | 28 | calendar days before the due date a reminder is sent |
| `REMINDER_HOUR` | 9 | clinic-time hour the reminder is sent |
| `UNDO_SECONDS` | 10 | how long a cancel can be undone |
| `WAIT_TICK_SECONDS` | 60 | how often waiting minutes are pushed |
| `UPLOAD_MAX_MB` | 10 | largest upload, in MB of 1,048,576 bytes; a file of exactly that size is allowed |
| `BOOKING_RATE_PER_MINUTE` | 10 | online booking attempts per client address per rolling 60 seconds |
| `VAT_PERCENT` | 20 | VAT rate |
| `IDEMPOTENCY_KEY_HOURS` | 24 | how long an `Idempotency-Key` is remembered, per clinic |

**Error order (every API).** Check in this order and answer the first that applies: 401 unauthenticated; then 404 when the record or any referenced id (nested ids and ids inside request bodies included) is unknown or outside the caller's clinic (never 403 and never 422 for another clinic's id); then 403 when the role may not do it; then a replay of a remembered `Idempotency-Key`, which returns its stored response; then 409 for state conflicts; then 422 for validation; then 503 when a needed dependency fails (for uploads and exports this means after validation). On the public booking route a 429 comes before everything else. A request body over the size limit is 413.

| Status | Codes |
|---|---|
| 401 | `unauthenticated`, `invalid_credentials` |
| 403 | `forbidden` |
| 404 | `not_found` |
| 409 | `slot_taken`, `invalid_transition`, `too_early`, `undo_expired`, `stale_paragraph`, `already_given`, `not_due`, `already_skipped`, `not_closed`, `kennel_taken`, `insufficient_stock`, `invoice_not_draft`, `invoice_exists`, `invoice_not_issued`, `invoice_closed`, `invoice_has_payments`, `idempotency_key_reused`, `duplicate_vaccination`, `email_taken`, `own_access` |
| 413 | `payload_too_large` |
| 422 | `validation_failed`, `outside_hours`, `paragraph_too_long`, `payment_too_large`, `no_lines`, `weak_password`, `out_of_window`, `unsupported_type`, `file_too_large` |
| 429 | `rate_limited` |
| 503 | `storage_unavailable`, `database_unavailable` |

Error bodies are `{"error":"<code>","message":"<copy>"}`, with an extra `"field":"<name>"` on every 422. The copy is the one listed for that code in Feedback states.

**Field rule for 422.** `field` holds the request key the failure is about, exactly as sent: a top-level JSON key (`start`), a dotted path for nested keys (`treatments.0.firstAt`; for a bad grading-seed reference the path of the referring key, for example `patients.2.client`), or the multipart part name (`file`). Codes not about one typed value name the key they judge: `outside_hours` and `out_of_window` name `start`, `payment_too_large` names `pence`, `no_lines` names `lines`, `paragraph_too_long` names `text`, `unsupported_type` and `file_too_large` name `file`, `weak_password` names `password`, and an unparseable grading clock names `now`. One response carries one error; when several keys fail, the first in the order the endpoint row lists its body keys is reported (for an upload: `kind`, then the file name, then size, then type). For `validation_failed`, `<Field label>` is: `patientId` `Patient`, `vetId` `Vet`, `reason` `Reason`, `kennel` `Kennel`, `treatments.<i>.name` `Treatment`, `treatments.<i>.firstAt` `First dose`, `treatments.<i>.intervalHours` `Every (hours)`, `treatments.<i>.count` `Doses`, `text` on a ward note `Note`, `grams` `Weight in grams`, `vaccine` `Vaccine`, `dueDate` `Due date`, `email` `Email`, `name` `Name`, `role` `Role`, `stockItemId` `Stock item`, `quantity` `Quantity`, `discountPercent` `Discount percent`, `delta` `Quantity`, `batch` `Batch`, `expiresOn` `Expires on`, `date` `Day`. Every other key uses the key itself as the label, for example `minutes is not valid.` and `file is not valid.` The payment amount and the public booking form use their own copy from Feedback states. A `reason` (skip or void) is required, and trimmed it is 1 to 200 characters.

**Permissions.** Reading appointments, the queue, the ward board, beacons, patients, notes, files, stock and reference data is allowed to every role.

| Action | Roles |
|---|---|
| create, move, resize, cancel, restore, check in, mark no-show | front-desk, vet, manager |
| start and complete a consult; write consult note paragraphs; add vaccinations; history PDF | vet, manager |
| ward actions (given, reopen, skip, notes, admit) | nurse, vet, manager |
| upload files; record weights | vet, nurse, manager |
| read invoices and invoice PDFs | front-desk, vet, manager |
| create invoices, add or remove lines, set discount, issue | vet, manager |
| take payments, void | front-desk, manager |
| stock movements; invitations, staff list, role changes and removal | manager |

**Role is read on every request.** A staff member's role is read from Postgres on every request, never kept in the cookie. A role change applies to that person's very next request and is pushed to their open windows. Removal sets their status to `Removed`, deletes all their sessions, so their next request is 401 `unauthenticated`, closes their live stream, and sends their open windows within two seconds to `/login?next=<their current path and query, percent-encoded>`. A removed member cannot sign in: `POST /api/session` with their correct credentials answers 401 `invalid_credentials` with the copy `Email or password is not right.`, and the sign-in page shows that copy. A manager cannot change or remove their own access (`own_access`). The push after either change reaches the affected person's windows within two seconds.

**Safe landing path.** After sign-in or a one-time login link, `landing` is `next` only when it starts with exactly one `/`, its second character is not `/` or `\`, and it contains no backslash, no control character and no scheme. So `/patients/<id>?tab=files` is kept, while `//evil.test`, `https://evil.test` and `/\evil` land on `/today`. Invitation acceptance always lands on `/today` and sign-out on `/login`. A kept path that is a forbidden screen shows the forbidden card; one outside the clinic shows the not-found page from Feedback states.

**Tenancy.** A clinic's patients, invoices, attachments, PDFs, staff and search results are reachable only inside that clinic. Another clinic's id, in a path, query or body, answers 404 on every route, and search never returns another clinic's records.

**Appointments.** One appointment per vet per slot and one patient per room per slot: an appointment in `booked`, `checked-in`, `in-consult` or `completed` occupies its vet and its room for every slot it covers, and a second one overlapping either the vet or the room is rejected with `slot_taken`. `cancelled` and `no-show` free their slots. Appointments start on a slot boundary, last a whole number of slots, and must fall within 08:00 to 18:00 clinic time, otherwise `outside_hours`. Simultaneous claims, from two windows or from a window and the public page, have exactly one winner: the first to reach the server; every other claim is `slot_taken`. The calendar shows a slot as `booked` when any occupying appointment covers it in that room; a slot can read `free` while the vet is busy elsewhere, and booking it then still answers `slot_taken`.

| From | To | Action | Notes |
|---|---|---|---|
| booked | checked-in | check-in | |
| booked | cancelled | cancel | |
| booked | no-show | no-show | only when the start time has passed on the server clock, else `too_early` |
| checked-in | in-consult | start | |
| checked-in | cancelled | cancel | |
| in-consult | completed | complete | |

Every other transition is `invalid_transition`, including a second start of the same consult, whose status label is the appointment's current one. Move and resize are allowed only from `booked`. A restore requires a cancelled appointment (else `invalid_transition`) cancelled at most `UNDO_SECONDS` ago by the server clock (else `undo_expired`) whose slots are still free (else `slot_taken`), and returns it to the status it had before the cancel. A cancel's `undoUntil` is the cancel instant plus `UNDO_SECONDS`. Cancelling a checked-in appointment removes it from the waiting room. Check-in records the check-in instant. Starting a consult removes the patient from the waiting room, and of two simultaneous starts the first to reach the server wins.

**Late arrivals.** A `booked` appointment is late from its start plus `LATE_MINUTES`, that moment included, on the server clock; for example an appointment starting at 09:00 clinic time is not late at 09:09:59 and is late at 09:10:00. `late` on the appointment is true only while it is `booked` and late. A check-in recorded at or after start plus `LATE_MINUTES` keeps `lateByMinutes`, the whole minutes from the start to the check-in (a check-in at 09:17 gives 17); an earlier check-in keeps null. The server pushes the late change within two seconds of the moment and at once after the grading clock is set.

**Waiting room.** Waiting minutes are the whole minutes (rounded down) from check-in to the server clock. The server pushes fresh values every `WAIT_TICK_SECONDS` and immediately after the grading clock is set. The `Waiting` beacon is the number of checked-in appointments.

**Consult note.** Each paragraph carries a version, starting at 1 and increasing by one on every accepted save. A save carries the version the editor last saw. If it equals the current version the save wins; otherwise it is `stale_paragraph`, naming the editor whose save is current. Different paragraphs never conflict. Every accepted save is stored as an operation in server order. All windows and a reload show the same text.

**Treatments.** An admission has one or more treatments, each with a name, a first dose time, an interval in whole hours and a number of doses. Dose number k (from 0) is scheduled at the first dose plus k times the interval, counted in elapsed hours, so an eight-hourly treatment stays exactly eight elapsed hours apart across a clock change. The first dose is typed in clinic time. A clinic time that does not exist (skipped when the clocks go forward) is `validation_failed` on `treatments.<i>.firstAt`; a clinic time that occurs twice means its first occurrence. For example, a first dose of `2026-10-24 20:00` every 8 hours for 4 doses is listed at 20:00, 03:00, 11:00 and 19:00 (the instants 19:00Z, 03:00Z, 11:00Z and 19:00Z, since the clocks go back on 2026-10-25); `2027-03-28 01:30` does not exist; `2026-10-25 01:30` means 00:30Z. A dose is `upcoming` before its scheduled time, `due` from its scheduled time up to but excluding scheduled time plus `TREATMENT_GRACE_MINUTES`, and `overdue` from that moment on (a dose at exactly that moment is `overdue`), counted in elapsed minutes. The server evaluates this on its own clock, pushes each change within two seconds of the moment it occurs, and pushes at once after the grading clock is set.

| From | To | Action |
|---|---|---|
| due or overdue | given | given (records time and person) |
| due, overdue or upcoming | skipped | skip with a reason (upcoming is rejected with `not_due`) |
| given or skipped | upcoming, due or overdue as the clock says | reopen |

Giving an upcoming dose is `not_due`. Giving a given dose is `already_given` (two nurses acting at once: the first wins, the other gets this); a skipped dose is `already_skipped`. Skipping a given dose is `already_given`. Reopening anything else is `not_closed`. The board lists every dose of every active admission; an admission is active while any of its doses is open and for `ADMISSION_LINGER_HOURS` after its last dose was given or skipped, by the server clock. A kennel is occupied while its admission has any open dose; kennels are `K1` to `K12`. Beacons: `waiting` is the waiting-room count; `overdue` counts overdue doses; `dueWithinHour` counts open doses that are `due` or `upcoming` and scheduled no later than 60 minutes after the server clock.

**Money.** All money is integer pence, shown as `£1,234.56`. Per line: net is quantity times unit price; discount is the invoice's `discountPercent` of the net, rounded half up to a whole penny; VAT is `VAT_PERCENT` of (net minus discount), rounded half up; line total is net minus discount plus VAT. The invoice total is the sum of line totals; nothing is rounded again at invoice level. For example, with the seed data: one `Nobivac DHPPi vaccine dose` at £12.95 with a 10% discount has net 1295 pence, discount 130 pence, VAT 233 pence and a line total of 1398 pence (£13.98). As a second example, three separate lines each with net 5 pence at 10% discount each have discount 1 penny, VAT 1 penny and a line total of 5 pence, so the invoice total is 15 pence (not the 16 pence that rounding the whole invoice once would give). As a third example, at 15% discount, a line of 1 at 5 pence totals 5 pence, a line of 3 at 1295 pence totals 3962 pence and a line of 7 at 640 pence totals 4570 pence, so the invoice total is 8537 pence (£85.37). Balance due is the total minus payments. The invoice number is `INV-` and a four-digit sequence per clinic, assigned at creation.

| From | To | Action |
|---|---|---|
| draft | issued (label `Unpaid`) | issue; needs at least one line |
| issued | part-paid (`Part paid`) | a payment below the balance |
| issued or part-paid | paid (`Paid`) | a payment equal to the balance |
| draft or issued | voided (`Voided`) | void with a reason; only when no payment exists |

Lines and discount can change only in draft (`invoice_not_draft`). A payment on a draft is `invoice_not_issued`; on a paid or voided invoice `invoice_closed`; above the balance it is `payment_too_large`. Voiding with any payment is `invoice_has_payments`; voiding a voided invoice is `invoice_closed`; both are checked before the reason, so a paid invoice voided with a blank reason answers `invoice_has_payments`.

**Attribution.** Every payment records who took it and when; a void records who voided it, when, and the reason; every return movement written by a void carries the voider in `by`, and every other movement carries the staff member whose action wrote it. The invoice screen and the invoice PDF both show these in clinic time.

**Idempotency keys.** A request to add a line or take a payment may carry `Idempotency-Key`. The first successful response is stored under the key for `IDEMPOTENCY_KEY_HOURS`, per clinic. Replaying the same key with the same method, path and body returns the stored status and body and changes nothing (no second payment, no second stock draw, no second announcement source). The same key with a different method, path or body is `idempotency_key_reused`. Failed requests are not stored.

**Stock batches and the ledger.** Every unit of stock sits in a batch with a name and an `expiresOn` clinic date. A batch is usable through the end of its `expiresOn` clinic date and is expired from 00:00 clinic time on the next clinic date, judged on the server clock; for example `expiresOn` 2026-10-24 expires at 2026-10-24T23:00Z and `expiresOn` 2026-11-24 at 2026-11-25T00:00Z. An item's `onHand` is the sum of all its movements, expired batches included until they are written off; `usable` is the sum of the remaining quantities of its unexpired batches; a batch's remaining quantity is the sum of its movements. Every movement stores `balanceAfter`, the item's on-hand quantity right after it in server order; the last movement's `balanceAfter` equals `onHand`. Movements are never edited or deleted.
- `receive` needs a positive `delta`, a `batch` of 1 to 40 characters and an `expiresOn` that is a valid clinic date not before today, else 422 on `batch` or `expiresOn`. Receiving into an existing batch name adds to it, and a different `expiresOn` for that name is 422 on `expiresOn`.
- Adding an invoice line draws first-expiry-first-out: earliest `expiresOn` first, ties by the order batches were first received, skipping expired batches, one `invoice-line` movement per batch drawn in draw order, each carrying its `batch`. A line larger than `usable` is `insufficient_stock` and draws nothing.
- Removing a draft line or voiding an invoice writes one `return` movement for each draw, to the same batch, with `pairedMovementId` pointing at the movement it reverses (the original movement is never edited, so its own `pairedMovementId` stays null).
- `expired` writes off part or all of one named batch, expired or not; it may not exceed that batch's remaining quantity (`insufficient_stock`), and an unknown batch name is 422 on `batch`. A write-off of an expired batch is the only way to take it out of `onHand`.
- Concurrent claims on the last usable units have exactly as many winners as units; the rest get `insufficient_stock`.
- An item is `low` when `usable` is at or below its reorder point. The low alert fires once per crossing from above to at or below, whether the crossing is made by a movement or by a batch expiring with no movement at all; it is announced to every open manager window at the crossing, or when the grading clock is set past an expiry, and a later clock set or later movement while the item stays low does not announce again. Receiving stock that lifts `usable` above the reorder point clears `Low stock`. The `Stock` count of low items is the number of items with `low` true and updates live.

**Online booking.** The page offers slots with a start from `BOOKING_LEAD_MINUTES` after the server clock up to `BOOKING_HORIZON_DAYS` days after it (both ends allowed), on slot boundaries within clinic hours, for each vet who is free and for whom a room is free. The visit reason `Vaccination` is offered only for starts before 12:00 clinic time; the other reasons any time in clinic hours. A start outside that window or rule is `out_of_window`. Each online booking is one slot long and takes the first free room. Reasons `Check-up`, `Limping or injury` and `Off their food` book a `Consult`; `Vaccination` books a `Vaccination`. A booking matches the owner's email within the clinic or creates the client, and the pet by name within that client or creates it; a valid `petToken` instead books for the token's own pet and client. The confirmation `code` is a random value that cannot be guessed; only it opens a confirmation.

**Owner text.** `ownerName` and `petName` are trimmed and must be 1 to 80 Unicode characters with no control character (U+0000 to U+001F and U+007F); otherwise the response is 422 `validation_failed` with the public copy for that field and `field` `ownerName` or `petName`, and no appointment, client, pet or email is created. Non-ASCII text, emoji included, is kept exactly, so `Zoë 🐾` is valid as either name: a pet name appears unchanged in the confirmation email subject and an owner name appears unchanged in the first line of the body, when a mail reader decodes them. Every email the app sends has exactly one recipient.

**Booking rate limit.** Only `POST /api/public/clinics/<slug>/bookings` counts toward `BOOKING_RATE_PER_MINUTE`. Every such request from one client address (the connection's peer address; forwarded headers are ignored) counts, whatever its outcome (201, 404, 409 or 422), except requests answered `rate_limited`, which do not count. The window is the rolling 60 seconds before the server clock (the grading clock when set). Setting the grading clock clears every rate-limit window, so a test can start from zero by setting it.

**Vaccination reminders.** For each vaccination the send moment is `REMINDER_HOUR`:00 clinic time on the calendar day `REMINDER_LEAD_DAYS` calendar days before its due date, worked out in clinic dates and not as a fixed number of hours. For example, a due date of 2026-11-05 sends at 08:00Z on 2026-10-08 (09:00 summer time), and a due date of 2027-04-20 sends at 09:00Z on 2027-03-23 (09:00 winter time). When the server clock reaches the send moment and the clinic date is still before the due date, one email is sent for that vaccine and due date and the reminder becomes `Sent` once SMTP has accepted it; until accepted it stays `Scheduled` and is retried every 5 seconds. A send moment that the clock jumps past (the grading clock moves beyond it) while the clinic date is still before the due date is sent once, when the clock is set. A vaccination recorded after its send moment has already passed, or still unsent when the clinic date reaches its due date, becomes `Missed` and is never sent. A reminder is never sent twice.

**Reminder links.** Each reminder email carries a random pet token of at least 128 bits, issued for that reminder when it is sent, belonging to one clinic and one vaccination due date. `GET /api/public/clinics/<slug>/pets/<token>` answers 200 only when the slug is the token's own clinic and the server's clinic date is on or before that due date, so the token stops working at 00:00 clinic time on the next clinic date. Otherwise it is 404. An earlier reminder's token for the same pet keeps working until its own due date ends. The booking page opened with an invalid or expired token shows the plain booking page with empty fields and no error. A booking carrying an invalid or expired `petToken` is 404 and books nothing.

**Files.** The type of an upload is judged only by its bytes at offset 0: JPEG starts `FF D8 FF`, PNG starts `89 50 4E 47 0D 0A 1A 0A`, PDF starts `%PDF-`. A signature found anywhere later, an empty file, an SVG, or an HTML file sent with an image type is `unsupported_type`. A file name that is empty or longer than 255 UTF-8 bytes is `validation_failed` on `file`. Every `GET /api/files/<id>/content` response carries the sniffed type (`image/jpeg`, `image/png` or `application/pdf`) and never a type the client declared, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, and `Content-Disposition: attachment; filename*=UTF-8''<name, percent-encoded>`. Profile photos and previews load from this same route.

### Services (DP-46, DP-49, DP-50, DP-53, DP-54, DP-55, DP-56, DP-58)

**Postgres** is the system of record for everything above, including the consult note operations, the reminder queue, idempotency records, batches and the ledger. The schema is created idempotently at every start. No other store holds state.

**Mailpit** receives every email by SMTP, with `From` equal to `MAIL_FROM` (default `Roundbook <no-reply@roundbook.test>`). Delivery failures are retried every 5 seconds and never fail the request that caused them. One booking sends one message with one recipient. Subjects carry typed text exactly: non-ASCII characters are encoded so that Mailpit decodes them to the typed text, and no typed text can add a header.
- Invitation: to the invitee, subject `You're invited to <Clinic> on Roundbook`, a body with the role and a link to `/invite/<token>`.
- Booking confirmation: to the owner, subject `Booking confirmed: <Pet> on <Day DD Mon> at <HH:MM>`, a body that starts `Hello <Owner name>,` followed by the clinic, vet and time in clinic time. The subject carries only the pet name; the owner name appears only in the body.
- Reminder: to the client, subject `<Pet> is due for <Vaccine> on <DD Mon YYYY>`, a body with a link to `/book/<slug>?pet=<token>`.

**MinIO** holds every file under the key `clinics/<clinicId>/patients/<patientId>/<fileId>-<file name>` where `/`, `\` and control characters in the file name are replaced by `_` in the key only (the record keeps the exact name), and every exported PDF under `clinics/<clinicId>/exports/<history|invoice>-<id>-<epoch seconds>.pdf`. A file's record exists in Postgres only after the put is confirmed; nothing half-made is linked and a failed put leaves no row and no object. Content is stored byte for byte. The type is judged by the bytes under the Files rule, so a PNG named `scan.pdf` is stored as a PNG. Two uploads with the same name are two files and two objects; nothing is overwritten. Each exported PDF is put to MinIO before it is returned, and the bytes returned equal the stored object. When MinIO is unreachable: uploads, downloads and PDF exports answer `storage_unavailable`, the health route reports `unavailable`, and the rest of the app keeps working.

**PDF.** `history.pdf` and invoice PDFs are made inside the app with an open-licensed library. The text layer contains: `Patient: <name>` (history) or `Invoice <number>` (invoice) on every page; the body one line per history entry (`<DD Mon YYYY> <Reason> with <Vet>`, completed consults, newest first) or per invoice line (`<Description> x<quantity> £<line total>`); `Page <i> of <n>` on every page; for invoices also, on the last page, `Total £x.xx`, `Paid £x.xx`, `Balance due £x.xx`, one line `Payment £x.xx taken by <Name> at <HH:MM>` per payment, and for a voided invoice `Voided by <Name> at <HH:MM>: <Reason>`; with `?include=files` also one line `File: <name> (<kind>)` per file after the history entries. There is one page per 25 body lines (history entries, invoice lines and file lines count; the last-page totals, payment and void lines do not), and an empty body still makes one page. Files are not listed unless `?include=files` is given.

### Seed data (DP-02, DP-49, DP-42, DP-60)

Every seeded person and business is invented. On first start (when no clinic exists) the app creates the records below. Staff sign in with the email and the password `roundbook-demo-1`; users created by the grading seed get the same password.

- Clinic `Halberton Road Animal Hospital`, slug `halberton-road`, rooms `Consult 1`, `Consult 2`, `Consult 3`. Staff: Maya Brennan (`maya.brennan@halberton.test`, front-desk), Tomasz Wren (`tomasz.wren@halberton.test`, nurse), Dr Imani Okafor (`imani.okafor@halberton.test`, vet), Dr Callum Reyes (`callum.reyes@halberton.test`, vet), Priya Nandakumar (`priya.nandakumar@halberton.test`, manager).
- Halberton clients and patients: Nia Ashworth (`nia.ashworth@example.test`) with Biscuit (dog, 12,400 g, weights 12,000 g, 12,150 g and 12,400 g on dates 90, 60 and 30 days before first start) and Juniper (cat, 4,100 g); Owen Pritchard (`owen.pritchard@example.test`) with Mochi (rabbit, 1,900 g), Saffron (dog, 8,300 g) and Pickle (cat, 3,600 g).
- Halberton vaccinations: Biscuit `DHPPi` due 35 days after the first start date; Juniper `FVRCP` due 40 days after it. Both send moments are therefore days after first start, so no seed reminder is sent or missed at boot. Reminder checks should set the grading clock, then create their own vaccinations through the grading seed and read Mailpit by recipient.
- Halberton stock: `Meloxicam 1.5 mg/ml oral suspension 10 ml` (reorder point 6, £18.50) in two batches, `MX-2411` with 6 units expiring 20 days after the first start date and `MX-2502` with 18 units expiring 200 days after it; `Cefalexin 250 mg tablets (10)` (18 on hand, reorder point 5, £14.40), `Nobivac DHPPi vaccine dose` (40, 10, £12.95) and `Sterile saline 500 ml` (12, 4, £6.40), each in one batch `OPENING` expiring `2099-12-31`.
- On the clinic date of that first start: Biscuit booked 09:00 with Dr Imani Okafor in `Consult 1` as `Consult`; Juniper 09:30 with Dr Callum Reyes in `Consult 2` as `Vaccination`; Mochi 10:00 with Dr Imani Okafor in `Consult 1` as `Consult`. Biscuit is in kennel `K3` on `meloxicam` every 8 hours from 08:00, 4 doses; Saffron is in `K5` on `cefalexin` every 12 hours from 09:00, 4 doses. One completed consult for Biscuit 30 days before, with a two-paragraph note.
- Clinic `Marlow Court Veterinary Centre`, slug `marlow-court`, rooms `Consult A`, `Consult B`, `Consult C`. Staff: Dr Hester Vale (`hester.vale@marlow.test`, vet), Lewis Ocampo (`lewis.ocampo@marlow.test`, manager). Client Rhys Halloran (`rhys.halloran@example.test`) with Quill (cat, 3,900 g). Marlow stock: `Wound dressing pack` (20 on hand, reorder point 5, £4.50, batch `OPENING`). One issued invoice `INV-0001` for Quill with one line of 2 wound dressing packs (total £10.80).

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 and served by the backend. `/app/run.json` has string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`; a literal example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm start"}
```

The app binds `0.0.0.0` on port 4173 and honours `APP_PUBLIC_PORT` when set. `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}` when Postgres is reachable and storage is reachable. The package lockfile is committed. No system library beyond the base build tools is needed. The storage-outage instance runs the same build with the storage endpoint unreachable and its own separate, initially empty database, so it seeds itself on its first start, keeps its own grading clock and reminders, and shares no state with the main instance; checks against it prepare data through its own grading seed route. First-start seeding and reminder sending must still be safe if two processes share one database: each runs under a database lock, so the seed is created once and no reminder is sent twice.

### Configuration and secrets (DP-12)

Read at start from the environment and never sent to the browser: `DATABASE_URL`; `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `GRADING_TOKEN`; `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`; and every setting in the settings table in Business rules. The bucket already exists; the app never creates one.

### Server boundary (DP-01, DP-54, DP-55)

Same-origin only: no cross-origin access is granted and the browser loads nothing from another origin. JSON request bodies are limited to 100,000 bytes and a larger body is 413; multipart uploads to `UPLOAD_MAX_MB` MB plus a small allowance for the form envelope, and a larger file is `file_too_large`. Uploaded names are read as UTF-8 exactly as sent. The server never serves source files, environment values or credentials. Session cookies are HTTP-only. Staff screens redirect to `/login?next=...` when there is no session. If Postgres is unreachable at boot the server keeps retrying every two seconds and answers `/api/health` with 503 `{"status":"down"}` until it connects. If Mailpit is unreachable at boot the app starts and retries delivery. If MinIO is unreachable (at boot or later) the app starts, `GET /api/health` answers 200 `{"status":"unavailable"}` (never 503), and storage calls fail as described in Services. Storage calls time out after two seconds. A database failure on any other request answers `database_unavailable`.

### Browser support and performance (DP-05, DP-07)

Current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800. The Ward and Today screens are usable within three seconds of load on a clinic-sized dataset (twelve kennels, a hundred appointments). A change made in one window appears in every other open window of the clinic within two seconds; this is the live-update limit. A PDF of up to 100 lines is produced within five seconds.

## Working rules

- IF-01: `/app/run.json` has string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and `serve` starts the app on port 4173 on `0.0.0.0`.
- IF-02: A `THIRD_PARTY_NOTICES.md` at the project root lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`), plus the two fonts, each with name, version and licence.
- IF-03: Every shipped package (the production dependency tree) and font has an open licence (MIT, Apache-2.0, BSD, ISC or SIL Open Font License); none is copyleft or proprietary.
- IF-04: The app uses no datastore beyond Postgres, Mailpit and MinIO: no Redis, SQLite, local file storage for patient files, or in-memory state that survives only a process.
- IF-05: The provided service definitions and their dev credentials are left untouched.
- IF-06: The package lockfile is committed and fonts and images are bundled; nothing loads from another origin at runtime.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with names that match this brief's domain terms (appointment, slot, waiting room, treatment, overdue, kennel beacon, invoice line, stock batch, stock movement, reminder).
- Each domain rule is decided in exactly one place: the appointment transitions and lateness, the treatment schedule and due and overdue evaluation, the money rounding, the stock ledger with batch expiry and first-expiry-first-out, the reminder schedule and link scope, the online booking window, the role check and the safe landing path are never re-implemented elsewhere, and the browser only renders what the server returns.
- No abstraction with a single implementation; no speculative options, layers or settings beyond this brief.
- One consistent error shape and one permission check path for every endpoint, with the published error order applied in a single place.
- No dead, commented-out or unreachable code and no defensive checks for states that cannot occur.
- Every request path writes Postgres first and sends to Mailpit and MinIO through one small client each, so provider-confirmed state is derived only after the provider answers.
- The live feed has one publisher that every state change goes through, and the browser keeps one record of each pending request so a late answer for an older choice is dropped.
- No features beyond this brief.
