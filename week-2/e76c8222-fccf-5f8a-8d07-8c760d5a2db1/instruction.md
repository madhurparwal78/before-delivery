# Fernhollow Access Seatweaver

Seatweaver is the dispatch desk for Fernhollow Access, a regional agency that books freelance American Sign Language (ASL) interpreters into medical, legal, education and community assignments. Clinics, courts and school districts use it to submit requests. Dispatch coordinators use it to fill interpreter seats by drawing a thread from an interpreter to a request. Interpreters use it to answer offers from an emailed link, keep their credentials current and submit timesheets. Deaf consumers use it to record which interpreters they prefer and which they have blocked. The agency billing lead uses it to approve timesheets and issue invoices. Seatweaver keeps all of its own records in PostgreSQL. It sends email through an SMTP server whose messages land in Mailpit, posts charges and reads invoices in Kill Bill, and stores files in MinIO (S3-compatible). Out of scope: self-service sign-up, password reset, remote or video interpreting, spoken-language interpreting, payroll for interpreters, payments collection, and any datastore other than those four services. Every user account is seeded, and users sign in with an email and a shared demo passcode.

## Problem and users

Regional ASL agencies still dispatch with spreadsheets, phone trees and group texts. They also use general interpretation platforms, but those are built for remote and spoken-language work. On every match a coordinator checks four things by hand:

- the interpreter holds the credential the setting needs
- that credential is still valid on the assignment date
- the interpreter has no overlapping job and has a 30-minute travel buffer
- the Deaf consumer has not blocked the interpreter

Mistakes are expensive. A lapsed legal credential in a courtroom can void a hearing. Two coordinators working at once can double-book one interpreter. Long jobs and court jobs need a second, team interpreter, and that seat often goes unfilled. Cancellation charges cause repeated disputes because staff apply the 48-hour and 72-hour windows from memory. The requesting organisation pays the invoice. The agency absorbs unbilled late cancellations. Deaf consumers bear the cost of no-shows.

Users:

- **Dispatch coordinator** (daily): fills every request with an interpreter who is credentialed, available and approved by the consumer, and fills team seats before the cancellation window closes.
- **Freelance interpreter** (daily): accepts or declines offers from an emailed link, keeps credentials and scans current, and submits a signed timesheet after each job.
- **Requester** (a clinic scheduler, court clerk or school coordinator; weekly): submits requests with prep material, watches seat status, and cancels after seeing the charge.
- **Deaf consumer** (occasional): records preferred and blocked interpreters, which dispatch must respect.
- **Agency billing lead** (weekly): approves timesheets, maintains hourly rates, and issues correct invoices per requesting organisation, including minimums and late-cancellation charges.

## Journeys

1. **Requester submits a request with prep material.** Start: Joel Haverty of Birchmere Community Clinic is signed out. Joel signs in and opens New request. Joel enters a medical appointment for tomorrow afternoon lasting one hour, picks the Deaf consumer Marcus Tull, and saves a draft. Joel attaches a PDF agenda and presses Submit request. End: the request detail shows status "submitted", seats "0/1" and the agenda under Prep materials. The new request also appears on the coordinators' board.
2. **Coordinator matches by thread.** Start: Rowan Ilsley is on the dispatch board. Rowan presses on Noor Haddad's chip and drags onto FA-1001. The Consumer pip turns vermilion. Rowan releases. The thread recoils and the card shows the consumer-block reason. Rowan then drags Imani Brooks onto FA-1001. All four pips turn teal. Rowan releases. End: the thread pins to the seat socket, the counter rolls from "0/1" to "1/1", and the detail pane shows the seat as offered to Imani Brooks and held by Rowan Ilsley. An offer email reaches Imani.
3. **Interpreter answers an offer from email.** Start: Imani Brooks has an offer email for FA-1001. Imani opens the link, reads the assignment, and presses Accept offer. End: the offer page says the job is on Imani's schedule. FA-1001 shows status "staffed". Joel receives a staffed confirmation. When Imani signs in, the job appears under My assignments with its prep files.
4. **Coordinator fills a team legal request.** Start: FA-1002, a court arraignment, has two open seats. Rowan threads Dana Okafor to seat 1 and Theo Marchetti to seat 2. Both interpreters accept from their emails. In between, the request reads "partially_staffed". End: the request reads "staffed" on the board and on the requester's view, and the court clerk receives one confirmation email.
5. **Requester cancels and sees the charge first.** Start: Anita Ruiz views FA-1002 after both seats are accepted. Anita presses Cancel request. The dialog says the cancellation is late and shows the dollar charge. Anita confirms. End: the request reads "cancelled_late" with that charge. Kill Bill holds exactly one matching charge on the court's account. Both interpreters receive one cancellation email each.
6. **Billing lead approves a timesheet and checks the invoice.** Start: FA-1005 has a submitted timesheet from Sam Whitlock. Marguerite Osei opens Billing and presses approve on that row. End: the status region shows the approved amount, the row leaves the queue, and Birchmere's invoice list shows a line for FA-1005 whose amount and invoice total equal Kill Bill's. Joel receives a timesheet-approved email.
7. **Deaf consumer blocks an interpreter.** Start: Marcus Tull has no preferences. Marcus signs in, marks Dana Okafor as Blocked, and saves. End: "Preferences saved." is announced. When a coordinator next drags Dana onto any request for Marcus, the Consumer pip fails and pinning is refused.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest, health and server boundary** The app installs, builds and serves from `/app/run.json`, answers the health check, and serves only its own client and API on one origin, as qualified in Technical requirements.
- **DP-02 — Sign-in and roles** Seeded users sign in with email and passcode, and every API call is allowed or refused by role as listed in API.
- **DP-03 — Seed data** A fresh database starts with exactly the organisations, people, credentials, requests, rates and Kill Bill accounts listed in Seed data.
- **DP-04 — Request drafting and validation** Requesters create, edit and submit requests, and invalid fields come back as field errors without saving anything.
- **DP-05 — Prep material upload** Requesters attach prep files to their own draft or submitted requests, and each file is stored in MinIO under the key pattern in Services.
- **DP-06 — Requester journey: submit a request with prep** In the browser, a requester fills the New request form, attaches a prep file with Add prep file and presses Submit request, and the request detail screen then shows the submitted status, the seat count and the file under Prep materials; stored records and objects are scored under DP-04 and DP-05.
- **DP-07 — Team seat rule** Each request gets one or two seats from its setting and length by the team rule in Business rules, and is staffed only when every seat is accepted.
- **DP-08 — Four dispatch gates** Matching an interpreter to a seat checks setting credential, credential valid on date, schedule with travel buffer, and consumer preference, exactly as defined in Business rules.
- **DP-09 — Gate dry-run** A dry-run returns all four gate results for an interpreter and seat and changes nothing.
- **DP-10 — Commit re-runs the gates** Pinning re-runs all four gates on the server and refuses with the first failing gate's reason, whatever an earlier dry-run said.
- **DP-11 — One winner per seat** When two coordinators pin the same seat at the same time, exactly one offer is created and the other gets a refusal that names the holder.
- **DP-12 — No overlapping assignments** An interpreter never holds accepted seats or active offers that overlap or break the travel buffer, even when pins for them race.
- **DP-13 — Coordinator journey: match by thread** In the browser, a coordinator drags a thread from an interpreter chip onto a request card, the card's four pips show the gate results, and the release either pins with the counter and detail pane showing the seat offered or recoils with the failing reason on the card; gate logic and offer records are scored under DP-08 to DP-12.
- **DP-14 — Offer email with single-use link** Every new offer sends the interpreter an email whose link opens the offer page and answers it once only.
- **DP-15 — Offer expiry** Each offer carries an expiry time set by the rule in Business rules, after which it cannot be accepted and its seat reopens.
- **DP-16 — Accept and decline** Accepting fills the seat and moves the request along its state machine, and declining reopens the seat.
- **DP-17 — Interpreter journey: answer an offer** In the browser, an interpreter opens the offer page from the emailed link, presses Accept offer, sees the accepted copy, and finds the job with its prep file links under My assignments; email delivery and seat state are scored under DP-14 and DP-16.
- **DP-18 — Request state machine** Requests and seats move only along the legal transitions in Business rules, and every illegal transition is refused with the documented error.
- **DP-19 — Staffed confirmation email** When the last seat of a request is accepted, every requester user in that organisation gets one confirmation email.
- **DP-20 — Coordinator journey: fill a team request** In the browser, a coordinator threads two qualified interpreters onto a legal request's two seats, both accept on their offer pages, and the board and the requester's request detail then both read staffed; seat rules and the confirmation email are scored under DP-07, DP-18 and DP-19.
- **DP-21 — Cancellation quote** Before cancelling, the requester sees whether the cancellation is late and the exact charge, computed by the window rules in Business rules.
- **DP-22 — Late-cancellation charge** A late cancellation with a fee above zero posts its charge to the organisation's Kill Bill account exactly once, and an on-time or zero-fee cancellation posts nothing.
- **DP-23 — Cancellation notices** Cancelling withdraws active offers and emails every seated interpreter once with the outcome and per-interpreter charge.
- **DP-24 — Requester journey: cancel with the fee shown** In the browser, a requester presses Cancel request, reads the late or on-time charge in the Cancel request dialog, confirms, and the request detail then shows the cancelled status with that charge; the quote, Kill Bill charge and notices are scored under DP-21 to DP-23.
- **DP-25 — Idempotency keys** Timesheet submission, timesheet approval and cancellation require an idempotency key, replay identical results for a repeated key, and refuse a reused key with a different body.
- **DP-26 — Timesheet submission and billed hours** A seated interpreter submits one signed timesheet after the scheduled end, and the server computes billed hours by the rule in Business rules.
- **DP-27 — Atomic timesheet approval** Approval records the Kill Bill charge, stores the signed PDF in MinIO and queues the requester notice together, or does none of them, as qualified by the failure model in Services.
- **DP-28 — Billed amount frozen at approval** The amount for an approved timesheet is computed once from the rate at approval and never changes when rates are edited later.
- **DP-29 — Invoices match Kill Bill** The invoices screen and API show each organisation's Kill Bill invoices with totals equal to Kill Bill's own.
- **DP-30 — Billing journey: approve and invoice** In the browser, the billing lead presses approve on a row of the timesheet queue, sees the approved amount in the Billing status region, and finds a matching line on that organisation's Invoices screen; the charge, PDF and amount rules are scored under DP-27 to DP-29.
- **DP-31 — Credentials with scans** Interpreters add credentials with type, number, expiry date and a scan stored in MinIO, and the latest-expiring credential of a type is the one the gates use.
- **DP-32 — Credential expiry warning** An interpreter gets exactly one warning email per credential once its expiry date is within the warning period in Business rules.
- **DP-33 — Consumer preferences** Deaf consumers record preferred and blocked interpreters, and blocks take effect on the very next dry-run and pin.
- **DP-34 — Consumer journey: block an interpreter** In the browser, a Deaf consumer marks an interpreter Blocked and presses Save preferences, and a coordinator then sees the Consumer pip fail when threading that interpreter onto that consumer's request; stored preferences and the gate rule are scored under DP-08 and DP-33.
- **DP-35 — Tenant isolation** A requester can never list, read, change or cancel another organisation's requests, timesheets or invoices, and gets the not-found error when trying.
- **DP-36 — Prep files for seated interpreters only** Prep files download only for the request's organisation, agency staff and interpreters with an accepted seat on that request while it is not cancelled.
- **DP-37 — Audit log** Every state change writes audit entries with actor, action, before and after state and time, counted and named as in Business rules, readable by agency staff.
- **DP-38 — Billing outage** When Kill Bill is unreachable, approvals, late cancellations with a fee above zero and invoice reads fail with the billing error and change nothing in the app, while everything else, including late cancellations with nobody seated, keeps working, as qualified by the failure model in Services.
- **DP-39 — Mail outage** When mail is unreachable, actions still succeed, their emails wait in a queue, and each queued email is delivered exactly once after mail returns, as qualified by the failure model in Services.
- **DP-40 — Dispatch board layout** The board shows three columns on wide screens and a tabbed stack with a bottom interpreter strip on narrow screens as described in Screens and layout, with no horizontal overflow at any tested size.
- **DP-41 — Gate thread motion** Dragging from a chip draws a following thread, gate pips resolve left to right in a stagger, and pins and recoils settle within the times in Motion and effects.
- **DP-42 — Keyboard and reduced-motion path** The whole matching flow works from the keyboard with each gate result announced, and reduced-motion users get the static substitutes in Motion and effects.
- **DP-43 — Feedback live regions** Every async action shows and announces its pending, success, error and outage copy in its named live region.
- **DP-44 — Visual identity** Screens use the warm paper ground, ink text, serif headings, monospaced times, flat surfaces and vermilion only for failed gates and in-window requests.
- **DP-45 — Credentials from the environment** Every protected value defined in Configuration and secrets is read from the environment at start and never appears in source, the client bundle, any response or any email.

## Frontend

### Screens and layout (DP-06, DP-13, DP-17, DP-24, DP-30, DP-34, DP-40)

Every screen has a top bar with the product name, a `navigation "Main"` showing only the links the signed-in role may use, the user's name, and a Sign out button. The `status "Service status"` banner sits directly under the top bar. All times are shown in agency time, Eastern Time (America/New_York), on a 24-hour clock. Date-and-time textboxes (Start, End, Actual start, Actual end) accept typed values of the form `YYYY-MM-DDTHH:MM` in agency time, for example `2026-10-27T14:00`, and date textboxes (Expires on) accept `YYYY-MM-DD`; any other text is a field error. Dates use the form "Tue 27 Oct" on cards and "Tuesday 27 October" in day headings.

At 375x812, 768x1024 and 1280x800, no screen ever scrolls sideways. Wide tables become stacked label/value rows below 768 pixels wide.

| Path | Who | What it shows |
|---|---|---|
| `/signin` | anyone | Email and passcode form. Every other path redirects here when signed out, except `/offers/<token>`. |
| `/board` | coordinator | The dispatch board (below). Coordinators land here after sign-in. |
| `/requests` | requester | Table of the organisation's requests: ref, title, setting, start, status and seats as accepted/total. Requesters land here. |
| `/requests/new` | requester | The new-request form. |
| `/requests/<id>` | requester, coordinator, billing lead | Request detail: fields, status, a list of seats with status and interpreter name, prep materials with download links, the cancellation window line, and actions allowed in the current state. |
| `/invoices` | requester, billing lead | Kill Bill invoices for an organisation. The billing lead first picks the organisation. |
| `/me` | interpreter | My offers (active offers with expiry), My assignments (accepted seats on requests that are not cancelled, with prep file links and a timesheet button once the scheduled end has passed), and My credentials. Interpreters land here. |
| `/offers/<token>` | anyone holding the link | One offer: organisation, setting, title, location, date and times, seat "n of k", expiry, and Accept and Decline buttons while the offer is open. |
| `/preferences` | Deaf consumer | Every interpreter with a three-way choice: Preferred, No preference, Blocked. Consumers land here. |
| `/billing` | billing lead | Timesheets awaiting approval, hourly rates per setting, and a link to invoices. The billing lead lands here. |

**Dispatch board, 1280x800.** The board has three columns side by side under the top bar.

- **Left rail** (about a sixth of the width): a vertical list of interpreter chips. Each chip shows the interpreter's name and credential codes. Expired codes are struck through.
- **Centre column**: requests that start in the next 72 hours and are not cancelled, earliest first. They are grouped under serif day headings, and each group sits above a hairline rule. Each request card shows:
  - the ref and start–end times in monospaced type
  - title, setting, organisation and consumer name
  - a row of four gate pips labelled Credential, Valid on date, Schedule and Consumer
  - one seat socket per seat
  - the seat counter "<claimed>/<total>"
  - "In cancellation window" when it applies
- **Right detail pane** (about a third of the width): the selected request in full. It shows the consumer's preferred interpreters, each seat's status, interpreter, holder and offer expiry, the prep files, and the latest gate results.

**Dispatch board, under 900 pixels wide (768x1024 and 375x812).** The board becomes a tabbed stack. A tab bar holds Requests and Detail, and one panel shows at a time. The interpreter rail becomes a strip pinned to the bottom of the viewport. The strip scrolls sideways inside itself, and the page never does. Selecting a card switches to the Detail tab. The thread can still be dragged from a chip in the strip up into a card in the Requests panel.

Every other screen is a single centred column at all three sizes, with line length kept to about 70 characters.

### Public screens and controls (DP-02, DP-04, DP-05, DP-13, DP-16, DP-21, DP-26, DP-29, DP-31, DP-33, DP-40, DP-42, DP-43)

Only the roles and names below are public. Tests and judges use nothing else. `<ref>`, `<name>` and the other placeholders follow the formats in API.

| Where | Role and accessible name | Visible copy |
|---|---|---|
| Sign-in | `textbox "Email"`, `textbox "Passcode"`, `button "Sign in"`, `status "Sign-in status"` | "Sign in" heading |
| Every screen | `navigation "Main"`, `button "Sign out"`, `status "Service status"` | "Sign out" |
| Board | `link "Skip to requests"` | "Skip to requests" (visible on focus) |
| Board | `list "Interpreters"` containing one `button "<interpreter name>"` per chip; a chip picked up by keyboard has `aria-pressed="true"` | name and credential codes |
| Board | `region "Requests, next 72 hours"` containing `heading` (level 2) per day and one `article "<ref> <title>"` per request | for example "Tuesday 27 October" |
| Request card | `list "Gates for <ref>"` with four `listitem`s named "Credential: <state>", "Valid on date: <state>", "Schedule: <state>", "Consumer: <state>", where `<state>` is `pass`, `fail` or `unchecked` | pip labels "Credential", "Valid on date", "Schedule", "Consumer" |
| Request card | `button "Seat <i> of <k> for <ref>"` per seat socket | seat counter "<claimed>/<total>" |
| Request card | inline gate-failure or seat-taken text | copy from Feedback states |
| Request card | in-window marker | "In cancellation window" |
| Board | `img "Match thread"` (present only while a thread is drawn or animating) | none |
| Board | `region "Request detail"` | ref and title heading |
| Board, under 900 px | `tablist "Board views"` with `tab "Requests"` and `tab "Detail"` | "Requests", "Detail" |
| Board | `status "Gate results"`, `status "Board status"` | Feedback states |
| Requests list | `table "Requests"`, `link "<ref>"` per row, `link "New request"` | "New request" |
| New request | `form "New request"` with `textbox "Title"`, `combobox "Setting"` (options Medical, Legal, Education, Community), `textbox "Location"`, `textbox "Start"`, `textbox "End"`, `combobox "Deaf consumer"`, `textbox "Notes"`, `button "Save draft"` | field labels as named |
| Request detail | `list "Seats"`, `list "Prep materials"`, `button "Add prep file"` (opens a file picker), `button "Submit request"` (draft only), `button "Cancel request"` (pre-start states only), `status "Request status"` | as named |
| Cancel dialog | `dialog "Cancel request"`, `button "Confirm cancellation"`, `button "Keep request"`, `status "Cancellation status"` | quote copy from Feedback states |
| Offer page | `heading "Offer for <ref>"`, `button "Accept offer"`, `button "Decline offer"`, `status "Offer status"` | as named |
| My page | `region "My offers"`, `region "My assignments"`, `region "My credentials"`, `button "Submit timesheet for <ref>"`, `button "Add credential"` | as named |
| Timesheet dialog | `dialog "Timesheet for <ref>"` with `textbox "Actual start"`, `textbox "Actual end"`, `textbox "Signature name"`, `button "Sign and submit"`, `status "Timesheet status"` | as named |
| Credential dialog | `dialog "Add credential"` with `combobox "Credential type"`, `textbox "Credential number"`, `textbox "Expires on"`, `button "Choose scan"`, `button "Save credential"`, `status "Credential status"` | as named |
| Preferences | `table "Interpreter preferences"`; per row `radiogroup "<interpreter name>"` with `radio "Preferred"`, `radio "No preference"`, `radio "Blocked"`; `button "Save preferences"`, `status "Preferences status"` | as named |
| Billing | `table "Timesheets awaiting approval"` with `button "Approve <ref> for <interpreter name>"` per row; `region "Rates"` with `textbox "Medical hourly rate"`, `textbox "Legal hourly rate"`, `textbox "Education hourly rate"`, `textbox "Community hourly rate"`, `button "Save rates"`; `status "Billing status"` | as named |
| Invoices | `combobox "Organisation"` (billing lead only), `table "Invoices"` with one row per invoice (number, date, amount, balance) and its items listed under it, `status "Invoice status"` | as named |

### Interactions (DP-13, DP-16, DP-21, DP-24, DP-33, DP-41, DP-42)

**Thread matching with pointer or touch.** The same steps work with mouse, pen and touch.

1. Pressing on an interpreter chip starts a thread anchored at the chip, and the thread follows the pointer. Page scrolling is suspended only while the thread is held.
2. When the pointer enters a request card, the card gets a hairline ink outline. The board asks the server for a dry-run of that interpreter on the card's target seat. The target seat is the card's lowest-numbered open seat, or its highest-numbered seat when no seat is open. The four pips then resolve left to right as described in Motion and effects.
3. If the pointer leaves the card before release, the pips return to unchecked, and any answer still on its way for that card is discarded.
4. Releasing over a card whose four gates all pass sends the pin. On success the thread pins to the seat socket, the counter rolls up by one, and the detail pane selects that request and shows the seat as offered.
5. Releasing over a card with any failing gate sends nothing. The thread recoils, and the first failing gate's reason appears as inline text on the card.
6. Releasing anywhere else also recoils with no message.
7. If the server refuses the pin (a gate failed on re-check, or another coordinator took the seat), the thread recoils and the card shows the refusal copy.
8. Releasing over a card with no open seat recoils and shows the seat-taken copy naming the holder of the card's target seat.

**Release before the gates settle.**

- Every dry-run answer belongs to one interpreter and one seat. The board applies an answer only while that interpreter is still held and that seat is still the target. Any other answer is discarded and never changes a pip or a message.
- Releasing over the target card while its dry-run is pending holds the thread at the card until the answer arrives. The release then continues as in steps 4 to 8, using that answer.
- If no answer arrives within 5 seconds, or the dry-run fails, the thread recoils and nothing is sent. `status "Gate results"` shows the dry-run failure copy from Feedback states.
- Releasing while the pips are still resolving uses the answer already received. The remaining pips settle at once and the release continues.
- In the keyboard path, Enter on a focused card follows the same rules.

**Keyboard matching.**

1. Tab reaches the chips. Enter or Space on a chip picks it up (pressed state) and moves focus to the first request card.
2. Up and Down arrows move focus between request cards in time order. Each focused card triggers the dry-run, and the result is announced in `status "Gate results"`.
3. Enter on the focused card commits, exactly as a pointer release does.
4. Escape drops the chip without committing and returns focus to that chip. After a commit, success or refusal, focus also returns to the chip.

**Other keyboard behaviour.**

- Tab order on the board: skip link, main navigation, Sign out, interpreter chips, request cards in time order, then the detail pane's controls.
- Clicking a card, or pressing Enter on it with no chip picked up, selects it into the detail pane.
- Dialogs trap focus. Escape closes them, and focus returns to the button that opened them.
- Under 900 pixels, arrow keys move between the two tabs, which follow standard tab behaviour.

**Cancel.**

1. Cancel request first fetches the quote and opens the dialog with the quote copy.
2. Confirm cancellation sends the cancel with the quoted fee and a fresh idempotency key. The client keeps that key for retries of the same click.
3. If the server reports the fee changed, the dialog shows the new quote, and the user must confirm again. The new confirmation sends the new fee with the same key. This is allowed because refusals are never stored against a key (see Idempotency in Business rules).

**Other screens.**

- **Preferences:** the radios change only local state, and Save preferences sends everything at once.
- **Offer page:** Accept and Decline disable both buttons while pending. After an answer, the buttons are replaced by the outcome text.
- **Board refresh:** the board reloads its data at least every 5 seconds. Another coordinator's offers, and accepts or declines from email links, show within that time without a page reload.

### Visual design (DP-44)

- **Ground and text.** The page is warm paper, a soft off-white with a hint of cream. Text and hairlines are a warm near-black ink. Secondary rules and unchecked pips use a warm mid-grey.
- **Pass colour.** A deep teal marks every passing gate and accepted seat.
- **Signal colour.** A vermilion signal colour appears only in two places: a failing gate pip, with its inline reason, and the "In cancellation window" marker with the left edge of that card. It is never used for buttons, links, focus rings or decoration.
- **Surfaces.** All surfaces are flat. There are no drop shadows, no gradients and no blurred backdrops anywhere. Depth comes only from hairline rules and spacing.
- **Type.** Display type is Instrument Serif, used for screen titles and day headings. Body type is IBM Plex Sans. Times, refs, seat counters and amounts use a monospaced face (IBM Plex Mono) so their digits line up. Each heading step is a quarter larger than the step below it, so the largest day heading is roughly twice body size. Rows of times and counters sit on a shared small baseline rhythm, so mono figures line up across cards.
- **Density.** Density is comfortable: cards have generous inner space, and about four cards fit in the centre column at 1280x800.
- **Composition.** The board reads like a printed dispatch sheet: names on the left, the day's timetable down the middle, and the selected job's file on the right.
- **Controls and contrast.** Every control is at least 44 pixels in both directions. All text and pip states meet WCAG 2.2 AA contrast against paper. Gate state is never shown by colour alone: pips also carry a tick or a cross mark, and their accessible names state pass or fail.
- **Focus.** The focus indicator is a solid ink outline at least two pixels thick, offset from the control.

### Motion and effects (DP-41, DP-42)

Every motion means something. Unless stated below, it starts fast and eases into place.

- **Board first load.** Day groups fade up one after another, and the whole board settles within about two-thirds of a second. This plays once per page load and never repeats on refresh.
- **Hover and press.** A hairline ink outline appears on a chip or card within about a tenth of a second. A pressed button darkens immediately.
- **Thread follow.** While held, the thread is a gently curved line from the chip's edge to the pointer, and it redraws on every frame with no lag trail.
- **Gate resolve.** When the dry-run answer arrives, the pips change left to right, each about a tenth of a second after the one to its left. All four are settled within about half a second of the answer. While the answer is pending, the pips show hollow grey rings.
- **Pin.** On a successful commit, the thread springs taut to the seat socket with one barely visible overshoot and settles within a quarter second. The counter's changing numeral rolls: the old figure slides up and out while the new one slides in, within a quarter second. The seat socket fills with teal.
- **Recoil.** On a failure or refusal, the thread springs back along its own path to the chip, overshoots once slightly, and is settled and removed in under half a second. The inline reason fades in as the recoil starts.
- **Tab switch** (under 900 pixels). The incoming panel cross-fades in under a quarter second.
- **Dialogs.** Dialogs fade in within a quarter second and fade out faster.
- **Banned.** No decorative loops, ambient animation, parallax or scroll-linked effects of any kind. Nothing pulses, including in-window cards.

**Reduced motion.** When the operating system asks for reduced motion, each motion is replaced as follows, and outcome text, announcements and timing of state changes stay the same:

- First load, hover outlines, tab switches and dialogs: they appear instantly.
- Thread: a static straight line from chip to pointer with no spring.
- Pips: all four change at once.
- Counter: the numeral swaps without rolling.
- Pin: the line snaps to the socket.
- Recoil: the line disappears at once.

### Feedback states (DP-43)

Every async action shows its copy visibly and announces it through its named live region. `<ref>` is a request ref, `<name>` an interpreter's full name, `<i>` and `<k>` a seat position and seat total, `<fee>` and `<amount>` dollars with two decimals, `<n>` a count of seated interpreters, `<hours>` hours with two decimals, and `<date>` an agency date as YYYY-MM-DD.

| Action | Region | Pending | Success | Error and outage |
|---|---|---|---|---|
| Sign in | Sign-in status | "Signing in…" | (navigates to landing page) | `invalid_credentials`: "That email and passcode do not match." |
| Dry-run | Gate results | "Checking gates for <ref> seat <i>…" | "<ref> seat <i>: Credential <pass\|fail>, Valid on date <pass\|fail>, Schedule <pass\|fail>, Consumer <pass\|fail>." | `seat_taken`: "Seat taken by <coordinator name>."; no answer within 5 seconds, or any other error: "Could not check gates for <ref>. Nothing was offered." |
| Pin | Board status, plus card inline text for failures | "Offering <ref> seat <i> to <name>…" | "Offered <ref> seat <i> to <name>." | `gate_failed`: "Not offered. <gate reason>"; `seat_taken`: "Seat taken by <coordinator name>."; `offer_window_closed`: "Too late to send an offer for this seat." |
| Save draft | Request status | "Saving…" | "Draft <ref> saved." | `validation`: "Check the highlighted fields.", plus each field's message under its field |
| Submit request | Request status | "Submitting…" | "<ref> submitted to dispatch." | `validation` as above; `invalid_transition`: "This request can no longer be submitted." |
| Upload prep file | Request status | "Uploading <filename>…" | "<filename> attached." | `payload_too_large`: "<filename> is too large."; `unsupported_media_type`: "<filename> is not a supported file type."; `storage_unavailable`: "File storage is unreachable. Nothing was uploaded." |
| Cancellation quote (dialog body) | Cancellation status | "Working out the charge…" | late: "Late cancellation. $<fee> will be charged for <n> seated interpreter(s)."; on time: "On-time cancellation. No charge." | `already_started`: "This assignment has started and can no longer be cancelled." |
| Confirm cancellation | Cancellation status | "Cancelling <ref>…" | "<ref> cancelled. Charge: $<fee>." | `fee_changed`: "The charge is now $<fee>. Review it and confirm again."; `billing_unavailable`: "Billing is unreachable. The request is not cancelled. Try again in a few minutes." |
| Accept offer | Offer status | "Sending your answer…" | "Accepted. <ref> is on your schedule." | `offer_closed`: "This offer is no longer open (<offer status>)." |
| Decline offer | Offer status | "Sending your answer…" | "Declined. The seat goes back to dispatch." | `offer_closed` as above |
| Submit timesheet | Timesheet status | "Submitting timesheet…" | "Timesheet for <ref> submitted: <hours> billed hours." | `not_yet_ended`: "You can submit after the assignment ends."; `validation`: "Check the highlighted fields." |
| Approve timesheet | Billing status | "Approving…" | "Approved <ref> for <name>: $<amount>." | `billing_unavailable`: "Billing is unreachable. The timesheet is not approved. Try again in a few minutes."; `storage_unavailable`: "File storage is unreachable. The timesheet is not approved." |
| Save rates | Billing status | "Saving rates…" | "Rates saved. They apply to approvals and cancellations from now on." | `validation`: "Check the highlighted fields." |
| Load invoices | Invoice status | "Loading invoices…" | "<count> invoice(s), total $<amount>." | `billing_unavailable`: "Billing is unreachable, so invoices cannot be shown right now." |
| Save credential | Credential status | "Saving credential…" | "<type> saved, valid through <date>." | `validation`: "Check the highlighted fields."; `storage_unavailable`: "File storage is unreachable. Nothing was saved." |
| Save preferences | Preferences status | "Saving preferences…" | "Preferences saved." | `validation`: "An interpreter cannot be both preferred and blocked." |
| Dependency watch | Service status | — | (empty while all services are up) | mail down: "Mail is unreachable. Emails are queued and send automatically when it returns."; Kill Bill down: "Billing is unreachable. Approvals, charged cancellations and invoices are paused." |

The service-status banner reads the dependency status endpoint on page load and at least every 30 seconds after that.

Gate reasons, used as `<gate reason>` and as card inline text:

- Credential: "No <setting> credential. Needs one of <accepted types>."
- Valid on date: "<type> expires <date>, before this assignment ends."
- Schedule: "Too close to <other ref>; jobs need a travel buffer."
- Consumer: "<consumer name> has blocked this interpreter."

`<accepted types>` is the setting's list from Business rules, joined with ", ". `<setting>` is the lower-case setting name.

## Backend

### API (DP-02, DP-04, DP-05, DP-09, DP-10, DP-11, DP-14, DP-16, DP-21, DP-25, DP-26, DP-27, DP-29, DP-31, DP-33, DP-35, DP-36, DP-37)

**Format.** All API paths start with `/api`. Request and response bodies are `application/json; charset=utf-8`, except multipart uploads and file downloads. JSON bodies over 64 KB are refused, and so are uploads over 10 MB. Money is a string in dollars with two decimals, for example `"160.00"`. Times are ISO 8601 with offset. Dates are `YYYY-MM-DD` agency dates.

**Authentication.** Sessions use an HttpOnly, SameSite=Lax cookie named `sw_session`, set by sign-in. A missing or invalid session gives `unauthenticated`. A signed-in user calling a route their role may not use gets `forbidden`. A requester asking for another organisation's records gets `not_found`.

**Error shape.** Every error uses one shape: `{"error":{"code":"<code>","message":"<human text>"}}`. Extra keys appear only where noted.

| Code | Status | Extra keys |
|---|---|---|
| `bad_json` | 400 | — |
| `idempotency_key_required` | 400 | — |
| `unauthenticated` | 401 | — |
| `invalid_credentials` | 401 | — |
| `forbidden` | 403 | — |
| `cross_origin` | 403 | — |
| `not_found` | 404 | — |
| `invalid_transition` | 409 | `"from":"<current status>"` |
| `already_started` | 409 | — |
| `seat_taken` | 409 | `"holder":{"id","name"}` (the coordinator holding the seat) |
| `offer_window_closed` | 409 | — |
| `not_yet_ended` | 409 | — |
| `already_submitted` | 409 | — |
| `fee_changed` | 409 | `"quote":<quote object>` |
| `idempotency_conflict` | 409 | — |
| `offer_closed` | 410 | `"offer_status":"accepted\|declined\|expired\|withdrawn"` |
| `payload_too_large` | 413 | — |
| `unsupported_media_type` | 415 | — |
| `validation` | 422 | `"fields":{"<field>":"<message>"}` |
| `gate_failed` | 422 | `"gate":"credential\|validity\|schedule\|consumer"`, `"gates":[<gate result>…]` |
| `billing_unavailable` | 503 | — |
| `storage_unavailable` | 503 | — |

**Shared objects.**

User: `{"id","name","email","role":"coordinator|interpreter|requester|consumer|billing","org_id":"<slug>|null"}`.

Request object:

```json
{"id":"…","ref":"FA-1001","org_id":"birchmere-clinic","org_name":"Birchmere Community Clinic",
 "title":"…","setting":"medical|legal|education|community","location":"…",
 "start":"…","end":"…","duration_hours":"1.00","consumer":{"id":"…","name":"…"},
 "notes":"…","status":"draft|submitted|partially_staffed|staffed|completed|invoiced|cancelled_on_time|cancelled_late",
 "logged_after":false,"seats_total":1,"seats_claimed":0,"seats_accepted":0,
 "in_cancellation_window":true,"cancellation_fee":null,
 "seats":[{"id":"…","position":1,"status":"open|offered|accepted",
   "interpreter":{"id","name"}|null,"held_by":{"id","name"}|null,
   "offer":{"id","status":"active|accepted|declined|expired|withdrawn","sent_at","expires_at","email":"sent|queued"}|null,
   "timesheet":{"id","status":"submitted|approved","billed_hours","amount"|null}|null}],
 "prep_files":[{"id","filename","size","content_type"}]}
```

- `seats_claimed` counts offered and accepted seats.
- `held_by` is the coordinator who pinned the seat's active or accepted offer. It is null on an open seat.
- `cancellation_fee` is set only on cancelled requests.
- `ref` is `FA-` followed by a sequence number. New requests continue after the highest seeded ref.

Gate result: `{"gate":"credential|validity|schedule|consumer","label":"Credential|Valid on date|Schedule|Consumer","pass":true,"reason":null|"<gate reason>"}`. Gates always appear in that order.

Quote: `{"late":true,"window_hours":48|72,"hours_before_start":"30.50","seated":2,"charge_hours_per_interpreter":"2.00","hourly_rate":"105.00","fee_per_interpreter":"210.00","fee":"420.00"}`. The values shown are an example: FA-1002 with both seats accepted, 30.5 hours before start.

Every quote has every field, set as follows:

- `late`: whether cancelling at that moment is late under the Cancellation rules. It is always false for a draft.
- `window_hours`: 48 for a request of 2 hours or less, and 72 otherwise. This applies to every request, including drafts.
- `hours_before_start`: hours from now to the scheduled start, with two decimals. It is negative when the start has passed, which is possible only for a draft.
- `seated`: the number of accepted seats. It is 0 for a draft.
- `charge_hours_per_interpreter`: when late, `"2.00"` for a request of 2 hours or less and the scheduled hours otherwise. It is `"0.00"` when not late.
- `hourly_rate`: the setting's current rate, always present.
- `fee_per_interpreter`: `charge_hours_per_interpreter` × `hourly_rate`. It is `"0.00"` when not late, and is filled in when late even with nobody seated.
- `fee`: `fee_per_interpreter` × `seated`.

The one exception is a cancellation that reconciles a charge already in Kill Bill: its quote carries the reconciled values defined in the failure model under Services.

For example, with the seed data at start, where `<h>` is `hours_before_start`:

- FA-1001, nobody seated: `{"late":true,"window_hours":48,"hours_before_start":"<h>","seated":0,"charge_hours_per_interpreter":"2.00","hourly_rate":"80.00","fee_per_interpreter":"160.00","fee":"0.00"}`.
- FA-1006, on time: `{"late":false,"window_hours":72,"hours_before_start":"<h>","seated":0,"charge_hours_per_interpreter":"0.00","hourly_rate":"105.00","fee_per_interpreter":"0.00","fee":"0.00"}`.
- A new one-hour medical draft: `{"late":false,"window_hours":48,"hours_before_start":"<h>","seated":0,"charge_hours_per_interpreter":"0.00","hourly_rate":"80.00","fee_per_interpreter":"0.00","fee":"0.00"}`.

**Endpoints.**

| Method and path | Who | Request | Success | Errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | — | `200 {"status":"ok"}` | `503 {"status":"starting"}` until Postgres is reachable and the schema is applied |
| `GET /api/system/status` | anyone | — | `200 {"postgres":"up","killbill":"up\|down","mail":"up\|down","storage":"up\|down"}`, probed with a timeout of at most 2 seconds | — |
| `POST /api/session` | anyone | `{"email","passcode"}` | `200 {"user":<user>}` and sets the cookie | 401 `invalid_credentials`, 422 `validation` |
| `DELETE /api/session` | signed in | — | `204` | 401 |
| `GET /api/me` | signed in | — | `200 {"user":<user>}` | 401 |
| `GET /api/board` | coordinator | — | `200 {"interpreters":[{"id","name","credentials":[{"id","type","expires_on","expired":bool}]}],"requests":[<request>…]}`. Requests start within the next 72 hours, are not cancelled, and are sorted by start. Interpreters are sorted by name. | 401, 403 |
| `GET /api/requests` | requester (own org), coordinator, billing | optional `?status=` | `200 {"requests":[<request>…]}`, newest start first | 401, 403 |
| `POST /api/requests` | requester; coordinator for `logged_after` | `{"title","setting","location","start","end","consumer_id","notes"}`. A coordinator also sends `"org_id"` and `"logged_after":true`. | `201 {"request":<request>}`. Status is `draft`, or `submitted` when `logged_after`. | 401, 403, 413, 415, 422 |
| `GET /api/requests/<id>` | requester (own org), coordinator, billing | — | `200 {"request":<request>}` | 401, 404 |
| `PATCH /api/requests/<id>` | requester (own org) | any subset of the create fields | `200 {"request":<request>}` | 404, 409 `invalid_transition`, 422 |
| `POST /api/requests/<id>/submit` | requester (own org) | `{}` | `200 {"request":<request>}` | 404, 409 `invalid_transition`, 422 (`start` in the past) |
| `POST /api/requests/<id>/prep` | requester (own org) | multipart, one part named `file` | `201 {"file":{"id","filename","size","content_type"}}` | 404, 409 `invalid_transition`, 413, 415, 503 `storage_unavailable` |
| `GET /api/prep/<file_id>` | see Business rules | — | `200` with the file bytes, its content type and `Content-Disposition: attachment` | 401, 404 |
| `GET /api/requests/<id>/cancellation-quote` | requester (own org), coordinator | — | `200 {"quote":<quote>}` | 404, 409 `invalid_transition`, 409 `already_started` |
| `POST /api/requests/<id>/cancel` | requester (own org), coordinator | header `Idempotency-Key`; `{"expected_fee":"<fee>","reason":"…"}` | `200 {"request":<request>,"quote":<quote>}` | 400, 404, 409 `invalid_transition` / `already_started` / `fee_changed` / `idempotency_conflict`, 503 `billing_unavailable` |
| `POST /api/seats/<seat_id>/dry-run` | coordinator | `{"interpreter_id"}` | `200 {"seat_id","interpreter_id","gates":[<gate result>×4],"all_pass":bool}` | 404, 409 `seat_taken`, 409 `invalid_transition` |
| `POST /api/seats/<seat_id>/offers` | coordinator | `{"interpreter_id"}` | `201 {"offer":{…},"seat":{…},"request":<request>}` | 404, 409 `seat_taken` / `offer_window_closed` / `invalid_transition`, 422 `gate_failed` |
| `GET /api/offers/<token>` | anyone with the token | — | `200 {"offer":{"status","expires_at"},"request":{"ref","title","setting","location","start","end","org_name"},"seat":{"position","total"},"interpreter":{"name"}}` | 404 |
| `POST /api/offers/<token>/accept` | anyone with the token | `{}` | `200 {"offer":{"status":"accepted"},"request":{"ref","status"}}` | 404, 410 `offer_closed` |
| `POST /api/offers/<token>/decline` | anyone with the token | `{}` | `200 {"offer":{"status":"declined"},"request":{"ref","status"}}` | 404, 410 `offer_closed` |
| `GET /api/interpreters/me/assignments` | interpreter | — | `200 {"offers":[<my offer>…],"assignments":[<request>…]}`. `offers` lists the interpreter's active offers, soonest expiry first. Each `<my offer>` is `{"id","token","status":"active","sent_at","expires_at","request":{"id","ref","title","setting","location","start","end","org_name"},"seat":{"position","total"}}`. `assignments` lists requests where the interpreter holds an accepted seat and that are not cancelled, earliest start first, with their prep files. | 401, 403 |
| `POST /api/seats/<seat_id>/timesheet` | interpreter on that accepted seat | header `Idempotency-Key`; `{"actual_start","actual_end","signature_name"}` | `201 {"timesheet":{"id","status":"submitted","actual_start","actual_end","billed_hours"}}` | 400, 403, 404, 409 `not_yet_ended` / `already_submitted` / `invalid_transition` / `idempotency_conflict`, 422 |
| `GET /api/timesheets?status=submitted` | billing | — | `200 {"timesheets":[{"id","ref","request_id","org_id","interpreter":{"id","name"},"actual_start","actual_end","billed_hours","status"}]}` | 401, 403 |
| `POST /api/timesheets/<id>/approve` | billing | header `Idempotency-Key`; `{}` | `200 {"timesheet":{"id","status":"approved","billed_hours","hourly_rate","amount","killbill_invoice_id"},"request":{"ref","status"}}` | 400, 404, 409 `invalid_transition` / `idempotency_conflict`, 503 `billing_unavailable` / `storage_unavailable` |
| `GET /api/timesheets/<id>/pdf` | billing; requester (own org); the interpreter | — | `200 application/pdf` | 404 |
| `GET /api/rates` | billing, coordinator | — | `200 {"rates":{"medical","legal","education","community"}}` | 401, 403 |
| `PUT /api/rates` | billing | any subset of the four settings, each a money string above 0 and no more than 1000.00 | `200 {"rates":{…}}` | 403, 422 |
| `GET /api/orgs/<org_id>/invoices` | requester (own org), billing | — | `200 {"org_id","killbill_account_id","invoices":[{"invoice_id","invoice_number","invoice_date","amount","balance","currency":"USD","items":[{"description","amount"}]}],"total"}`. Invoices are newest first; `total` is the sum of invoice amounts. | 404, 503 `billing_unavailable` |
| `GET /api/interpreters/me/credentials` | interpreter | — | `200 {"credentials":[{"id","type","number","expires_on","status":"valid\|expiring\|expired"}]}` | 401, 403 |
| `POST /api/interpreters/me/credentials` | interpreter | multipart fields `type`, `number`, `expires_on`, and file part `scan` | `201 {"credential":{…}}` | 413, 415, 422, 503 `storage_unavailable` |
| `GET /api/credentials/<id>/scan` | the owning interpreter, coordinators | — | `200` with the file bytes | 404 |
| `GET /api/consumers/me/preferences` | consumer | — | `200 {"preferred":[ids],"blocked":[ids],"interpreters":[{"id","name"}]}` | 401, 403 |
| `PUT /api/consumers/me/preferences` | consumer | `{"preferred":[ids],"blocked":[ids]}` | `200 {"preferred":[ids],"blocked":[ids]}` | 422 (same id in both lists, or unknown id) |
| `GET /api/consumers` | requester, coordinator | — | `200 {"consumers":[{"id","name"}]}`, every seeded Deaf consumer sorted by name. The New request form's Deaf consumer list shows these. | 401, 403 |
| `GET /api/consumers/<id>/preferences` | coordinator | — | `200 {"consumer":{"id","name"},"preferred":[ids],"blocked":[ids]}` | 404 |
| `GET /api/audit?request_id=<id>` | coordinator, billing | — | `200 {"entries":[{"at","actor":{"id","name","role"}\|null,"action","entity","entity_id","from","to","detail"}]}`, oldest first | 403 |

In every preferences body, `ids` means an array of interpreter id strings.

**Validation.**

- Create and patch: `title` is 1–120 characters and `location` is 1–200. `setting` must be one of the four settings. `start` and `end` must be valid times with `end` after `start`. The length must be from 30 minutes to 10 hours. `consumer_id` must be a seeded consumer. `notes` is at most 2000 characters.
- Requests not marked `logged_after` need `start` in the future.
- A `logged_after` request needs `start` in the past and no more than 14 days ago.
- Timesheet: `actual_end` after `actual_start`, at most 12 hours apart, and `signature_name` 2–120 characters.
- Credentials: `type` must be one of the credential types in Business rules, `number` 1–40 characters, and `expires_on` a valid date.
- Prep files must be PDF, DOCX, PPTX, plain text, PNG or JPEG. Credential scans must be PDF, PNG or JPEG. A wrong type gives `unsupported_media_type`. The server decides the type from the file's own bytes and the declared type together.

Every validation error lists every failing field in `fields`.

### Business rules (DP-07, DP-08, DP-10, DP-11, DP-12, DP-15, DP-16, DP-18, DP-21, DP-22, DP-25, DP-26, DP-28, DP-31, DP-32, DP-33, DP-35, DP-36, DP-37)

**Seats (team rule).** A request longer than 2 hours, or any legal request, has two seats. Every other request has one. Seats are created when the request is created and recomputed when a draft is edited.

**Request state machine.** A request's status is always derived from its seats, its times and its timesheets.

- `draft` → `submitted` through submit. Requests created with `logged_after` begin at `submitted`.
- `submitted` → `partially_staffed` when at least one seat is accepted but not all.
- → `staffed` when every seat is accepted.
- `staffed` → `completed` once the scheduled end has passed. The change is persisted the first time a read or the background sweep observes it. The sweep runs at least once a minute.
- `completed` → `invoiced` once every seat's timesheet is approved.
- From `draft`, `submitted`, `partially_staffed` or `staffed`, a cancel moves the request to `cancelled_on_time` or `cancelled_late` (see Cancellation). Cancelling a draft is always on time.

Illegal transitions:

- Submit or edit when not `draft` gives `invalid_transition`.
- Cancel from `completed`, `invoiced` or either cancelled state gives `invalid_transition`.
- Cancel a non-draft request whose start has passed gives `already_started`.
- Upload prep to a request that is not `draft`, `submitted`, `partially_staffed` or `staffed` gives `invalid_transition`.
- Dry-run and pin run their checks in this order, and the first that applies is returned:
  1. `not_found` for an unknown seat or interpreter.
  2. `seat_taken` when the seat in the path is offered or accepted, whatever the request's status. It names that seat's holder.
  3. `invalid_transition` when the request is not `submitted` or `partially_staffed`.
  4. For a pin only, `offer_window_closed`, then `gate_failed`.

**Seat and offer states.**

- A seat goes from `open` to `offered` through a pin, then to `accepted` through accept.
- A declined, expired or withdrawn offer returns its seat to `open` at once and keeps its own final status.
- A seat has at most one active offer, and nothing else can claim it while that offer is active or accepted.
- Answering an offer that is not active gives `offer_closed` with its current status.
- A token that was superseded because the seat reopened and was offered again also gives `offer_closed`, with that offer's own status.

**Offer expiry.** `expires_at` is the earlier of 12 hours after the pin and 2 hours before the request's start. For `logged_after` requests it is 12 hours after the pin. A pin whose computed `expires_at` is already past gives `offer_window_closed` and creates nothing. An offer past its `expires_at` is expired:

- any accept or decline of it gives `offer_closed`
- its seat reads as open on every response from then on
- a background sweep marks expired offers at least once a minute, so the board shows the reopened seat within one minute

**The four dispatch gates.** The gates are evaluated in this order, for one interpreter against one seat's request.

1. **Credential.** The interpreter holds at least one credential type accepted for the setting:
   - medical: NIC, CDI
   - legal: SC:L
   - education: EIPA-4.0, NIC
   - community: NIC, CDI

   The credential types are NIC, CDI, SC:L and EIPA-4.0.
2. **Valid on date.** Among the interpreter's accepted-type credentials, the one with the latest expiry date must expire on or after the request's end date. An expiry date is the last valid day. If gate 1 fails, gate 2 also fails with the reason "No credential to check.".
3. **Schedule.** Take every accepted seat and active offer the interpreter has on other non-cancelled requests, or on another seat of the same request. Each must end at least 30 minutes before this request starts, or start at least 30 minutes after it ends. A gap of exactly 30 minutes passes. The first conflicting request by start time names `<other ref>`.
4. **Consumer.** The request's Deaf consumer has not blocked the interpreter. Preferred interpreters are shown to coordinators but never gate anything.

**Dry-run and pin.**

- A dry-run reports all four results and writes nothing, not even an audit entry.
- A pin re-runs the four gates against the state current at the moment the offer would be created, whatever an earlier dry-run said, so no offer ever exists that failed a gate at its creation. If a gate fails, it refuses with `gate_failed` naming the first failing gate and creates nothing.
- The pin targets the seat in the path. Coordinators' boards always target the lowest-numbered open seat.

**Concurrency.**

- When two pins race for the same seat, exactly one wins. Every other pin gets `seat_taken` with the winner as holder, even with identical bodies.
- When pins for the same interpreter race onto requests that would break gate 3, exactly one succeeds and the others get `gate_failed` on the schedule gate.
- When an accept and an expiry or cancellation race, exactly one outcome stands.

**Cancellation.**

- `hours_before_start` is the time from the cancel moment to the scheduled start.
- For a request of 2 hours or less, a cancellation less than 48 hours before start is late. Each seated interpreter is charged 2 hours at the setting's current rate.
- For a request over 2 hours, a cancellation less than 72 hours before start is late. Each seated interpreter is charged the full scheduled hours at the current rate.
- Exactly 48 or 72 hours before start is on time.
- Seated means an accepted seat. `fee = fee_per_interpreter × seated`.
- A late cancellation with nobody seated becomes `cancelled_late` with fee `0.00`, and nothing is posted to Kill Bill.
- `in_cancellation_window` is true when cancelling at that moment would be late.
- Cancel compares the client's `expected_fee` with the fee the cancellation would charge at that moment: the freshly computed fee, or the reconciled fee when the failure model under Services applies. A mismatch gives `fee_changed` with the quote for that fee and changes nothing.
- On success, active offers on the request become `withdrawn`, and their seats read `open`.
- Accepted seats stay `accepted` with their interpreter and holder, so `seats_claimed` and `seats_accepted` both equal the number of accepted seats.
- The fee is stored on the request.
- The cancelled request leaves its interpreters' My assignments, and their prep access ends (see Tenant isolation and prep access).
- No timesheet can be submitted for a cancelled request.

**Billed hours and amounts.**

- Billed hours for a timesheet are the larger of 2 and the actual worked time rounded up to the next quarter hour. For example, 1 h 10 min bills 2.00, 2 h 05 min bills 2.25 and 3 h 00 min bills 3.00.
- Billed hours are shown at submission.
- The amount is billed hours × the setting's hourly rate at the moment of approval, rounded to cents half up. For an approval that reconciles a timed-out attempt, the moment of approval is that first attempt, whose rate and amount the Kill Bill item records (see the failure model under Services). The amount is stored once, and later rate edits never change it.
- A timesheet can be submitted only by the seat's interpreter, only for an accepted seat on a non-cancelled request whose scheduled end has passed, and only once per seat. Any second submission with a different key gives `already_submitted`.
- Approval moves a timesheet from `submitted` to `approved`. Approving a timesheet in any other state gives `invalid_transition`.

**Atomic approval.** A successful approval does all of the following, and a failed approval does none of them, as qualified by the failure model under Services:

- posts the Kill Bill charge
- stores the signed timesheet PDF
- queues the requester notice email
- marks the timesheet approved, with its amount and rate frozen

**Idempotency.**

- Cancel, timesheet submission and timesheet approval require an `Idempotency-Key` header of 1–128 visible ASCII characters. Without it they give `idempotency_key_required`.
- Keys are scoped to the user, the action and the target, and are kept for at least 24 hours.
- Only a success (2xx) response is stored against its key.
- No error response is ever stored. This includes `validation`, `fee_changed`, `invalid_transition`, `already_started`, `already_submitted`, `not_yet_ended`, `billing_unavailable` and `storage_unavailable`. After an error the key stays free, and a retry with that key runs the action afresh against current state.
- Two bodies are the same when they parse to equal JSON values. Key order and whitespace do not matter, a missing body counts as `{}`, and string values compare exactly.
- After a stored success, the same key with the same body returns the stored status and body byte for byte, with the header `Idempotent-Replayed: true`. It produces no new Kill Bill charge, email, object or audit entry.
- After a stored success, the same key with a different body gives `idempotency_conflict`.
- While an action with a key is running, other requests with that key wait for it to finish. If it succeeds, a waiting request with the same body receives the replay, and one with a different body gets `idempotency_conflict`. If it fails, each waiting request runs afresh.
- Separately from keys, no action is charged twice: a second cancel or approval with a new key is an illegal transition, and each charge has one charge key in Kill Bill (see Services).

**Credential expiry warning.** When a credential's expiry date is 30 days or fewer away and has not yet passed, the interpreter gets exactly one warning email for that credential. The check runs at server start, at least hourly, and within one minute of a credential being saved. A credential's `status` is `expired` after its expiry date, `expiring` within the 30-day period, and `valid` otherwise. Adding a newer credential of the same type does not remove the old one, and gate 2 always uses the latest expiry.

**Preferences.** Saving replaces both lists. An interpreter in both lists is a `validation` error. Blocks apply to every later dry-run and pin and do not withdraw existing offers or acceptances.

**Tenant isolation and prep access.** Requesters see only their own organisation's requests, timesheets, PDFs, prep files and invoices. Any other id gives `not_found`, never `forbidden`. A prep file downloads only for:

- requester users of the request's organisation
- coordinators and the billing lead
- interpreters whose seat on that request is accepted, while the request is not cancelled

Everyone else gets `not_found`. This includes an interpreter with only an active offer, and an interpreter whose accepted seat is on a cancelled request.

**Audit.** A successful action's audit entries are readable exactly when its change is: a change is never visible without its entries, and an entry never exists for a change that did not happen. There is one entry per changed entity, and never one entry covering several. The entries are:

- `request.created`, `request.updated`, `request.submitted`, `request.cancelled`: one entry on the request.
- `offer.withdrawn`: one entry per offer a cancellation withdraws, written after that cancellation's `request.cancelled` entry.
- `seat.offered`: one entry on the seat for each pin.
- `offer.accepted`, `offer.declined`, `offer.expired`: one entry on the offer. Expiry entries have a null actor.
- `timesheet.submitted`, `timesheet.approved`: one entry on the timesheet.
- `request.status_changed`: one entry on the request whenever its derived status changes because of something other than a request action. These changes are: to `partially_staffed` or `staffed` after an accept, to `completed` when the scheduled end passes, and to `invoiced` after the last approval. The entry follows the entry that caused it and has that entry's actor. The change to `completed` has a null actor and is written exactly once, when the change is first persisted.
- `rates.updated`, `credential.added`, `preferences.updated`: one entry per save.

Each entry carries `from` and `to` status where one applies. Offer answers via link have a null actor and the interpreter in `detail`. Refused actions, failed actions, dry-runs, replays and seeding write nothing.

For example, accepting the only seat of FA-1001 writes `offer.accepted` and then `request.status_changed` from `submitted` to `staffed`. Cancelling a request that has one active offer writes `request.cancelled` and then one `offer.withdrawn`.

### Services (DP-05, DP-14, DP-19, DP-22, DP-23, DP-27, DP-29, DP-31, DP-32, DP-38, DP-39)

**PostgreSQL.** PostgreSQL is the system of record. The schema is applied idempotently every time the server starts. Seed data is inserted only into an empty database.

**Email (SMTP, observed in Mailpit).** Every email is sent from `Fernhollow Access Dispatch <dispatch@fernhollow.test>` to the recipient user's seeded email. Every email first goes into an outbox stored in Postgres. The server attempts delivery immediately and retries at least every 30 seconds until accepted. With mail up, delivery happens within 10 seconds. Each outbox message is delivered exactly once, as qualified in the failure model below. Every message carries the header `Message-ID: <outbox-<outbox id>@fernhollow.test>`, which stays the same on every delivery attempt. An offer's `email` field reads `sent` once delivered and `queued` before that.

| Trigger | To | Subject | Body must contain |
|---|---|---|---|
| Offer created | the interpreter | `Offer for <ref> on <date>` | setting, times, location, the expiry time, and one absolute link ending `/offers/<token>`, where `<token>` is at least 32 URL-safe random characters, unique per offer |
| Last seat accepted | every requester user of the organisation | `Staffed: <ref> on <date>` | each seated interpreter's name |
| Cancellation | every interpreter with an accepted seat at the moment of cancellation | `Cancelled: <ref> on <date>` | "Late cancellation. Charge per interpreter: $<fee per interpreter>" or "On-time cancellation. No charge." |
| Credential warning | the interpreter | `Credential expiring: <type> on <date>` | the credential number |
| Timesheet approved | every requester user of the organisation | `Timesheet approved: <ref>` | interpreter name, billed hours and amount |

Here `<date>` is the request's start date, or the credential's expiry date for the warning. `<fee per interpreter>` is the stored cancellation quote's `fee_per_interpreter`.

**Kill Bill.**

- The server talks to Kill Bill's REST API, rooted at `/1.0/kb` under `KILLBILL_URL`, with basic auth from `KILLBILL_USERNAME` and `KILLBILL_PASSWORD` and the tenant headers `X-Killbill-ApiKey` and `X-Killbill-ApiSecret`.
- Each requester organisation has one Kill Bill account with external key `fernhollow-<org id>`, its organisation name as name, and currency USD.
- The account is created at server start if missing, or on first need if Kill Bill was down at start. It is never duplicated.
- Charges are external charges posted to that account and committed on a new invoice right away.
- Every charge has a charge key that never changes, whatever happens to rates or seats: `ts-<timesheet id>` for a timesheet approval and `cx-<request id>` for a late cancellation. Every item description starts with its charge key in square brackets. For each charge key, Kill Bill holds at most one item at any time, and exactly one once the action has succeeded.
- An approved timesheet's item has the frozen amount as its amount and the description `[ts-<timesheet id>] <ref> interpreting: <interpreter name>, <billed hours> h at $<rate>/h`, where `<rate>` is the frozen rate.
- A late cancellation with a fee above zero has an item whose amount is the stored fee and whose description is `[cx-<request id>] <ref> late cancellation: <seated> x <charge hours per interpreter> h at $<rate>/h`, with the stored quote's values.
- In-app invoice amounts, balances, items and totals are read from Kill Bill on each request and must equal Kill Bill's.

**MinIO (S3).** All objects go in the private bucket from `S3_BUCKET` and are only ever served through the app.

- Prep files are stored at `prep/<org id>/<request id>/<file id>/<original filename>`.
- Credential scans are stored at `credentials/<interpreter id>/<credential id>/<original filename>`.
- Signed timesheets are stored at `timesheets/<request id>/<timesheet id>.pdf`. This is a real PDF, starting with `%PDF-`, that contains the ref, interpreter name, actual times, billed hours, signature name, and "Approved by <billing lead name>" with the approval time.

**When a service is down.**

- **Kill Bill.** Approval, a late cancellation with a fee above zero, and invoice reads give `billing_unavailable` within 5 seconds and change nothing in the app, with the copy from Feedback states. What Kill Bill itself may hold afterwards is set out in the failure model below. On-time cancellations, late cancellations with nobody seated, dispatch, offers and timesheet submission keep working.
- **Mail.** Every action still succeeds with its normal response and success copy. Its emails stay queued and are delivered exactly once after mail returns, as qualified in the failure model below. `GET /api/system/status` reports `"mail":"down"` and the Service status banner shows the mail copy.
- **File storage.** Uploads and approval give `storage_unavailable`.

**Failure model and recovery.** These rules describe what an observer sees. How the app orders or groups its internal work is up to the builder.

- **Supported failures.** The app must handle a dependency that refuses connections, or does not answer, for the whole of an action. Checks create only these failures. PostgreSQL is assumed available during every action.
- **Successful approval or late cancellation.** When the response is a success, every effect of the action exists: for an approval, the four effects listed under Atomic approval in Business rules; for a late cancellation, the new status, stored fee, withdrawn offers, audit entries, queued emails and, when the fee is above zero, the Kill Bill item.
- **Charges left by earlier attempts.** A failed attempt never removes, changes or duplicates a Kill Bill item that an earlier uncertain attempt of the same action left behind. That item stays exactly as it was, for a later successful attempt to adopt under Reconciliation on retry. The failure guarantees below therefore promise only that the failed attempt itself adds no charge.
- **Failed approval.** When approval answers `billing_unavailable` or `storage_unavailable`, the following all hold as soon as the response arrives: the timesheet is still `submitted` with no amount; no object exists at its PDF key; no requester notice is queued or delivered; no audit entry was written. When storage failed, or Kill Bill refused the connection, the Kill Bill items with the timesheet's charge key are exactly those present before the attempt: none if no earlier attempt left one, or the single item an earlier uncertain attempt left, unchanged.
- **Failed cancellation.** When a cancellation answers `billing_unavailable`, the request's status, seats, offers and audit entries are unchanged and no email is queued or delivered. When Kill Bill refused the connection, the Kill Bill items with the request's charge key are exactly those present before the attempt: none if no earlier attempt left one, or the single item an earlier uncertain attempt left, unchanged.
- **Uncertain Kill Bill outcome.** When Kill Bill does not answer, the app cannot know whether the charge landed. It answers `billing_unavailable` with the app-side state above. Kill Bill may then hold one item with the action's charge key that the app has not yet recorded, and never more than one, however many attempts time out.
- **Reconciliation on retry.** On every later attempt of the same action that reaches Kill Bill, with any idempotency key, if Kill Bill already holds an item with the action's charge key, the app posts nothing new and adopts that item as the action's charge, even if rates or accepted seats have changed since:
  - An approval stores the item's amount as the frozen amount and the rate in its description as the frozen rate. The response, the requester notice and the PDF show those values.
  - A cancellation takes the item's amount as its fee, and the seated count, charge hours and rate in its description as the quote's `seated`, `charge_hours_per_interpreter` and `hourly_rate`, with `fee_per_interpreter` equal to the amount divided by that seated count. `expected_fee` is compared with this fee, so the first confirm after a timed-out attempt may answer `fee_changed` with the reconciled quote. The cancellation quote endpoint does not read Kill Bill and keeps showing freshly computed values.
  - After the retry succeeds, Kill Bill holds exactly one item for the charge key, and its amount equals the app's stored amount or fee.
- **Unretried uncertain charges.** If a timed-out action is never retried, or its request starts before a retry succeeds, the item stays in Kill Bill and appears on invoices. Checks may edit rates or accept seats before retrying, but always retry a timed-out action before its request starts.
- **Email delivery.** An email counts as delivered when the mail server accepts the end of the message, and only then is it marked `sent`. A connection that breaks before that acceptance leads to a retry. That retry may produce a second copy with the same `Message-ID`, which does not count as a second delivery. Checks count deliveries by distinct `Message-ID` and never create this case. No two serve instances deliver the same outbox message.

### Seed data (DP-03)

Every person and organisation below is invented. All users share the passcode `weave-demo-2026`. Organisation ids are the slugs shown. Every other id is opaque.

**Seed clock.**

- **T** is the moment the empty database was seeded, rounded down to the start of the hour in agency time.
- **D** is T's agency date.
- Request times are fixed offsets from T, in hours and minutes.
- Credential expiry dates are fixed offsets from D, in days.
- The seed examples below, and Journeys 2 to 6, hold when they run within 20 hours of T.
- Seeded offers and acceptances send no emails and write no audit entries.

Organisations and users:

| Organisation (id) | Users (role) |
|---|---|
| Fernhollow Access (agency, no org id on users) | Rowan Ilsley `rowan@fernhollow.test` (coordinator), Priya Castellanos `priya@fernhollow.test` (coordinator), Marguerite Osei `marguerite@fernhollow.test` (billing) |
| Birchmere Community Clinic (`birchmere-clinic`) | Joel Haverty `joel@birchmere.test` (requester) |
| Kestrel County Circuit Court (`kestrel-court`) | Anita Ruiz `anita@kestrelcourt.test` (requester) |
| Larchfield School District (`larchfield-schools`) | Tomasz Wren `tomasz@larchfield.test` (requester) |

Deaf consumers:

- Bea Lindqvist `bea@consumers.test`: prefers Dana Okafor, blocks Noor Haddad.
- Marcus Tull `marcus@consumers.test`: no preferences.

Interpreters (role interpreter), with credentials as type, number and expiry date:

| Interpreter | Email | Credentials |
|---|---|---|
| Dana Okafor | `dana@interpreters.test` | NIC N-40211 (D+400), SC:L L-1187 (D+400) |
| Theo Marchetti | `theo@interpreters.test` | NIC N-38870 (D+600), SC:L L-1203 (D+600) |
| Imani Brooks | `imani@interpreters.test` | CDI C-5521 (D+700) |
| Lior Feld | `lior@interpreters.test` | EIPA-4.0 E-7730 (D+300) |
| Sam Whitlock | `sam@interpreters.test` | NIC N-41902 (D+20) |
| Callum Reyes | `callum@interpreters.test` | NIC N-39954 (D+500), SC:L L-1150 (D−2) |
| Noor Haddad | `noor@interpreters.test` | NIC N-42617 (D+900) |

Every seeded credential has a one-page PDF scan.

Hourly rates: medical `80.00`, legal `105.00`, education `70.00`, community `75.00`.

Requests:

| Ref | Org | Setting | Title | Location | When | Consumer | Status and seats |
|---|---|---|---|---|---|---|---|
| FA-1001 | birchmere-clinic | medical | Cardiology follow-up | 14 Alder Row, Suite 2 | T+26 h to T+27 h | Bea Lindqvist | submitted, 1 seat open |
| FA-1002 | kestrel-court | legal | Arraignment, Courtroom 3B | Kestrel County Courthouse | T+30 h to T+31 h 30 min | Marcus Tull | submitted, 2 seats open |
| FA-1003 | larchfield-schools | education | IEP annual review | Larchfield Middle, Room 112 | T+44 h to T+47 h | Marcus Tull | partially_staffed; seat 1 accepted by Lior Feld (offered by Rowan Ilsley), seat 2 open |
| FA-1004 | birchmere-clinic | community | Diabetes support group | Birchmere Library hall | T+52 h to T+53 h 30 min | Bea Lindqvist | staffed; seat 1 accepted by Dana Okafor (offered by Rowan Ilsley) |
| FA-1005 | birchmere-clinic | medical | Emergency department visit | Birchmere Community Clinic, ED | T−24 h to T−23 h, `logged_after` | Bea Lindqvist | completed; seat 1 accepted by Sam Whitlock (offered by Rowan Ilsley); timesheet submitted, actual T−24 h to T−22 h 40 min, signed "Sam Whitlock", billed hours 2.00 |
| FA-1006 | kestrel-court | legal | Bench trial, day one | Kestrel County Courthouse | T+120 h to T+123 h | Marcus Tull | submitted, 2 seats open |

Seeded prep file: `fa-1003-agenda.pdf` on FA-1003. Kill Bill: one account per requester organisation and no charges.

For example, with the seed data at start:

- On FA-1002 seat 1, Dana Okafor passes all four gates, Noor Haddad fails Credential, and Callum Reyes fails Valid on date.
- On FA-1001, Noor Haddad fails Consumer, Lior Feld fails Credential, and Imani Brooks passes all four.
- On FA-1003 seat 2, Lior Feld fails Schedule.
- Approving the FA-1005 timesheet posts `160.00`.
- Cancelling FA-1001 is late with fee `0.00`, and cancelling FA-1006 is on time.

## Technical requirements

### Deployment (DP-01)

**Runtime.** The runtime is Node.js 22 LTS with npm, and the code is written in TypeScript.

**Run manifest.** `/app/run.json` holds string commands run from `/app`, plus the schema marker. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

**Serving.** The serve command binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or on 4173 when it is unset. It serves the client and the API from that one port. `GET /api/health` behaves as listed in API. Several serve instances may run at once against the same services on different ports. Each must behave correctly, and background work (expiry sweep, outbox, warnings) must never double-send across instances.

### Configuration and secrets (DP-45)

The server reads these at start:

- PostgreSQL: `DATABASE_URL`
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL` (used only to probe mail status)
- Kill Bill: `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- File storage: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `APP_PUBLIC_URL`: the origin used in emailed links; when unset, it defaults to `http://localhost:<port>`

**Protected values** are the infrastructure secrets and dependency endpoints in this list. That means every variable above except `APP_PUBLIC_URL`, plus any value built from them, such as a connection string. No protected value is written in source, and none appears in the client bundle, in any response or in any email.

Two kinds of value are deliberately public and are not protected:

- the shared demo passcode and the seeded accounts from Seed data, which the seeding code may contain
- the app's own public origin from `APP_PUBLIC_URL`, which appears in emailed offer links

### Server boundary (DP-01)

**What it serves.** The server serves the built client assets and `/api`. It never serves source files, `run.json`, package manifests, environment files or anything outside the built assets. Those paths get 404. Unknown non-API paths get the client shell so client routes work.

**Same origin.** There are no CORS headers. A mutating API request with an `Origin` header from a different origin gives `cross_origin`.

**Malformed requests.** Malformed JSON gives `bad_json`, and oversized bodies get `payload_too_large` per the limits in API.

**Dependencies at boot.** If Postgres is unreachable at boot, the server keeps retrying and reports `starting` on health. If Kill Bill, mail or storage is unreachable at boot, the server still starts and serves, and only the dependent features fail as described in Services.

### Browser support and performance (DP-40, DP-41)

**Browsers.** Current Chromium, Firefox and Safari, at 375x812, 768x1024 and 1280x800, with touch on the two narrower sizes. Fonts are self-hosted, and the app makes no runtime requests to third-party origins.

**Speed.**

- The board is usable within three seconds of navigation with the seed data.
- A dry-run answers within half a second, and a pin within one second, when services are up.
- The thread follows the pointer without visible stutter on a mid-range laptop.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and the app is started only through it.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every runtime dependency and bundled font with its licence.
- IF-03: Every dependency and font uses one of MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD or OFL-1.1.
- IF-04: The app uses no datastore beyond PostgreSQL, Kill Bill and MinIO: no SQLite, Redis, embedded key-value store or data files written to disk.
- IF-05: The provided service configuration and its seeded credentials are left unmodified.
- IF-06: No protected value from Configuration and secrets is committed to the repository or written into client assets.

## Engineering standards

Only the quality review grades these lines, by reading the source. They add no behaviour, and no other check depends on them.

- The code is idiomatic, strictly typed TypeScript with no `any` escapes. Names match this brief's domain terms: request, seat, offer, gate, credential, timesheet, billed hours, cancellation window, charge key and consumer preference.
- Each of these domain rules is decided by a single definition that every caller uses: the four gates, the team rule, the request and seat state machines, offer expiry, the cancellation window and fee, billed hours and charge reconciliation. The dry-run and the pin use the same gate definition, and the quote and the cancel use the same fee definition.
- Every API error is produced through one consistent error shape and one table of codes to statuses.
- No interface, base type or generic wrapper has exactly one implementation. There is no dead, commented-out or unreachable code, and there are no defensive checks for states the state machine makes impossible.
- Money is handled as integer cents or exact decimals, never binary floating point.
- There are no features, routes, settings or screens beyond this brief.
