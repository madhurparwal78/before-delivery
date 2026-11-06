# Sorrel & Pike Learning Credwell

Credwell is the course platform of Sorrel & Pike Learning, a provider of accredited continuing education for licensed nurses. The provider publishes self-paced and live-cohort courses. Hospitals buy prepaid seat packs and cover part of their nurses' tuition under a coverage policy they can reschedule. Nurses finish modules and a post-evaluation to earn one contact-hour certificate per course, which a licensing board or employer can check through a shared link. Build it as one web app with an HTTP API in TypeScript. Postgres is the system of record. Kill Bill records every payment and refund and attributes each one to the Credwell user who caused it. MinIO stores every certificate PDF and compliance export. Mailpit receives every email the app sends. The following are out of scope: self sign-up, password reset, real card capture (Kill Bill's built-in external payment method stands in for the card), live video, waitlist auto-promotion, and any datastore beyond these four services.

## Problem and users

In most US states a registered nurse has to log a set number of approved continuing-education contact hours in each renewal cycle, for example 30 hours every two years. An accredited provider awards one contact hour per 60 minutes of learning, and time spent on the post-evaluation counts. Hours are awarded only once the whole activity and its evaluation are finished, and the provider keeps the records for about six years. Hospitals pay for much of this through bulk seat purchases, and their education coordinators track those in spreadsheets that are separate from the provider's site. Three things go wrong as a result. Nurses fail renewal audits because a certificate was never issued, was issued twice with different hours, or cannot be checked by the board. Hospitals lose prepaid seats they cannot reconcile. Providers spend staff time re-issuing certificates by hand and refunding double charges.

- **Learner nurse** (weekly): enrols with a sponsor seat or their own card, finishes the modules and the post-evaluation, and gets exactly one correct certificate they can share with a licensing board.
- **Sponsor coordinator** (weekly): a hospital education coordinator who buys seat packs, assigns seats to their own nurses, schedules how much tuition the hospital covers, and exports completion and hour totals for the annual compliance review.
- **Nurse planner** (daily): the provider's accreditation lead. They publish courses with their contact-hour values, run cohorts with a seat cap, decide refunds, and reissue or revoke certificates.
- **Course author** (occasional): faculty who draft modules and post-evaluations and submit them to the nurse planner for review.
- **Verifier** (occasional): a licensing-board auditor or a new employer who opens a shared certificate link, without signing in, to confirm the hours, course and issue date.

## Journeys

1. **Co-paid self-paced course.** Ana Ruiz is signed in, their hospital covers half of their tuition, and they have no enrolments. They open "Sepsis Recognition in the First Hour" and press Enrol. The Checkout dialog shows the list price, the hospital's share and their share. While the dialog is open, Grace Tamura changes Harbourview's coverage effective today. Ana presses Pay and the dialog stays open, shows the new share and says the price changed, and nothing is charged. Ana pays the new share. The dialog closes, the course page shows "Continue learning", one receipt arrives in their inbox, and Kill Bill holds exactly the payments the final quote called for.
2. **Last seat in a live cohort.** "Safe Opioid Stewardship" has a cohort with one seat left that closes at the end of its close date in Chicago time, as shown on each cohort choice. Cara Lindqvist and Dev Patel both pay for it at the same moment. One of them is enrolled and sees the seats remaining drop to zero. The other sees that the seat was just taken and joins the waitlist at position 1. The nurse planner sees both of them on the cohort's roster and waitlist.
3. **Seat pack to certificate.** Grace Tamura, the coordinator at Harbourview, buys a three-seat pack for the sepsis course. The pack ledger shows three seats in. Grace assigns one seat to Ben Osei, who gets an invitation email. Ben works through every lesson, answers each knowledge check, submits the post-evaluation, and watches the Seal press fill the seal and settle on the awarded hours and serial. The certificate email arrives with a download link.
4. **Verifier check.** Ben opens the transcript, presses "Share" and copies the link. A verifier opens it in a fresh browser and sees only Ben's name, the course, the hours, the serial, the issue date and the status, plus a PDF download. Ben revokes the link, and the verifier's next load says the link is not valid. A later link that Ben leaves alone stops working at its expiry instant and is listed as expired.
5. **Refund.** Dev Patel paid for a course by card and finished one lesson. Dev requests a refund with a reason. The nurse planner opens the refund queue, sees the refund the rules allow, and approves it. Kill Bill records the refund against Dev's payment under the planner's name with the request as its comment, the refund row reads "Approved by Odette Marsh on <date>", and Dev's enrolment reads as refunded.
6. **Compliance review.** Grace opens Hospital seats. Grace sees the hospital's totals, searches its nurses (a stray percent sign finds nobody), reads the monthly hours report for this year, exports a completions CSV for a date range of up to a year and downloads it. Nothing from Linden Valley appears anywhere.
7. **Course release.** Felix Amari edits the "Wound Care Documentation Essentials" draft and submits it for review. The nurse planner returns it with a note. Felix reloads, fixes it and submits again, and the planner approves and publishes it with its contact hours. Each step raises the course version, and a step sent from an out-of-date screen is refused. Later the planner withdraws an older course, and certificates already issued for that course still verify.
8. **Name correction.** A nurse changes their display name after marriage. Their transcript, verification page, PDF and the hospital's export keep the name on the certificate until the nurse planner reissues it. The serial, hours and issue date stay the same, the new PDF carries the new name, the old PDF is kept, the version history still shows the earlier name, and the nurse gets one reissue email. Their transcript total does not change at any point, including while the new PDF is being stored.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** The app installs, builds and serves from /app/run.json and answers the health check as specified in Deployment.
- **DP-02 — Seeded sign-in and roles** Every seeded person signs in with their email and the shared seed password and reaches only the screens and endpoints their role allows, as qualified in API.
- **DP-03 — One error shape and order** Every API error uses the one error shape and the one precedence order stated in API, with validation reporting every invalid field at once.
- **DP-04 — Server boundary** The server rejects cross-origin writes, oversized and non-JSON bodies, and never serves source files or credentials, as qualified in Server boundary.
- **DP-05 — Credentials from the environment** Every service URL and credential is read from the environment variables in Configuration and secrets and never appears in source or in anything sent to the browser.
- **DP-06 — Three viewports without overflow** Every screen lays out as described in Screens and layout at 375x812, 768x1024 and 1280x800 with no horizontal scrolling.
- **DP-07 — Warm clinical look** Pages use the warm off-white ground, hairline-ruled data rows, the serif and sans pairing, right-aligned tabular figures and terracotta only on the seal, as described in Visual design.
- **DP-08 — Calm motion** Nothing on any screen moves except the motions listed in Motion and effects, and none of them loops.
- **DP-09 — Keyboard focus** Every control is reachable with Tab in visual order and shows a visible focus ring, and every dialog traps focus, closes on Escape and returns focus to its opener.
- **DP-10 — Reduced motion** With reduced motion requested, each motion is replaced by the substitute stated in Motion and effects.
- **DP-11 — Contrast and tap targets** All text meets WCAG 2.2 AA contrast on its background and every control is at least 44 by 44 pixels at 375x812.
- **DP-12 — Buy a self-paced course** A learner nurse opens a published self-paced course, pays their share in the Checkout dialog, and lands back on the course with a receipt in their inbox.
- **DP-13 — Employer and learner shares** Checkout splits the list price between the nurse's hospital and the nurse under the coverage policy in effect at the checkout instant, so the two shares add up to the list price to the cent, by the rule in Business rules.
- **DP-14 — Checkout retries charge once** Repeating a checkout with the same idempotency key and body returns the original success without a second charge, reusing the key with a different body is rejected, and a failed checkout leaves its key unused, as stated in Business rules.
- **DP-15 — Payment, enrolment and receipt together** A checkout either records its Kill Bill payments, confirms the enrolment and sends one receipt, or leaves no enrolment, no payment and no email, including while Kill Bill is down.
- **DP-16 — Keyboard checkout** A learner nurse can open the Checkout dialog, choose a cohort, pay and dismiss the dialog using only the keyboard.
- **DP-17 — Enrol in a live cohort** A learner nurse picks an open cohort of a cohort course, pays, and sees that cohort's seats remaining drop by one.
- **DP-18 — Last cohort seat** When several learner nurses check out the last seat of a capped cohort at the same moment, exactly one is enrolled and every other one is told the cohort is full and offered the waitlist.
- **DP-19 — Cohort waitlist** A learner nurse can join and leave the waitlist of a full cohort and sees their position, and learners who join at the same moment get distinct positions, as qualified in Business rules.
- **DP-20 — Cohort enrolment closes** Checkout and waitlist joins on a cohort are refused from the cohort's close instant onward, as stated in Business rules.
- **DP-21 — Run a capped cohort** The nurse planner creates a cohort with a seat cap and close date, changes its cap, and follows its roster, seats remaining and waitlist.
- **DP-22 — Seats remaining recomputed** A cohort's seats remaining always equals its seat cap minus its active enrolments, after enrolments, refunds and seat-cap changes.
- **DP-23 — Cohort rosters stay with the provider** Only the nurse planner sees a cohort's roster and waitlist names, and any other user reading a cohort gets only its public summary.
- **DP-24 — Buy a seat pack** A sponsor coordinator buys a pack of seats for a published self-paced course and sees it in their pack list with its balance and expiry date.
- **DP-25 — Pack purchase charged once** A pack purchase records one Kill Bill payment on the hospital's account, a replay with the same idempotency key makes no second charge, and no pack is created while Kill Bill is down.
- **DP-26 — Paired seat ledger** Every seat movement in a pack is two ledger entries that cancel out, and the pack balance always equals the sum of its pack entries and never drops below zero.
- **DP-27 — Assign a seat to a nurse** A sponsor coordinator assigns a seat from a pack to one of their hospital's nurses, who gets an invitation email and a confirmed enrolment.
- **DP-28 — Last seat in a pack** When two assignments race for a pack's last seat, exactly one succeeds and the other is told the pack is empty.
- **DP-29 — Return an unused seat** A sponsor coordinator can return a seat whose nurse has not verified any module, which withdraws that enrolment and puts the seat back in the pack.
- **DP-30 — Unassigned seats expire** Seats still unassigned when a pack expires leave the pack through exactly one expiry movement, even when several requests first touch the pack at once, and cannot be assigned afterwards, as timed in Business rules.
- **DP-31 — Study the modules** A learner nurse works through each lesson, answers its knowledge check, and sees each verified module's glyph and their progress update.
- **DP-32 — Module verification** A lesson becomes verified only when its knowledge-check answer is correct, and the post-evaluation opens only after every lesson is verified.
- **DP-33 — Learner records stay private** A learner nurse can read only their own enrolments, modules, certificates, transcript and PDFs, and any other id answers as not found.
- **DP-34 — Keyboard module player** A learner nurse can move between modules, answer each knowledge check and submit the post-evaluation using only the keyboard.
- **DP-35 — Finish a course and get a certificate** Submitting the post-evaluation takes a learner nurse to the completion screen, where the Seal press shows their sealed certificate with its hours and serial.
- **DP-36 — Awarded contact hours** A certificate's contact hours are the course's verified learning minutes divided by 60, rounded down to the nearest quarter hour and fixed at issue.
- **DP-37 — One certificate per course run** Double-submitting the post-evaluation or refreshing the completion screen always yields the same single certificate and serial.
- **DP-38 — Certificate, PDF and email together** A certificate counts as sealed only after its PDF is stored, its email goes out exactly once after that, and while storage is down it waits in the pending state described in Services.
- **DP-39 — Seal press** On the completion screen the verified module chips fly into proportional wedges of the seal, the numeral counts up to the awarded hours and the ring text appears, as specified in Motion and effects.
- **DP-40 — Pending seal** While the certificate PDF is pending, the seal stays open at the top with its pending label, the Share with a verifier button stays disabled, and the screen updates as stated in Feedback states.
- **DP-41 — Seal craft** The seal reads as a pressed terracotta mark whose wedges, hatched unverified segments, centre numeral and ring text are legible and balanced at every viewport.
- **DP-42 — Share a certificate with a verifier** A learner nurse creates a verification link from their transcript, a verifier opens it without signing in, and the nurse can revoke it.
- **DP-43 — Verification links** Verification links are unguessable, limited to one active link per certificate, stop working when revoked or replaced, and expire, as qualified in Business rules.
- **DP-44 — Public verification page** A verification link shows that one certificate's summary and PDF and nothing else, and every attempt to change anything through it is refused.
- **DP-45 — Private fields stay private** Certificate emails, certificate PDFs and verification pages never contain the nurse's licence number, date of birth, email address, or any price or payment split.
- **DP-46 — Request and approve a refund** A learner nurse requests a refund for a paid enrolment, and the nurse planner approves or declines it from the refund queue, whose row then names who decided it and when.
- **DP-47 — Refund amount** An approved refund is full, prorated by unfinished minutes, or refused, according to the refund rule in Business rules.
- **DP-48 — Refund split** An approved refund is split between the hospital and the nurse in the ratio of their original shares, adds up to the refund total to the cent, and is recorded as Kill Bill refunds keyed to the request so a retried approval never refunds twice, while Credwell changes nothing when Kill Bill is down.
- **DP-49 — Reissue or revoke a certificate** The nurse planner reissues a certificate after a name correction or revokes it, and the nurse's transcript and verification link reflect the change once the reissue is sealed or the revoke is recorded.
- **DP-50 — Reissue keeps the serial** A reissue keeps the certificate's serial and hours, stores a new PDF version while keeping the old one, emails the nurse once, and of concurrent reissue or revoke requests on one certificate exactly one is accepted when the first accepted is a revoke or a still-sealing reissue, as qualified in Business rules.
- **DP-51 — Transcript totals recomputed** A learner nurse's total earned hours always equals the sum of their sealed certificates, counting each certificate once, including while a reissue is pending and after a rename.
- **DP-52 — Review hospital compliance** A sponsor coordinator reviews their totals, searches their nurses, reads the monthly hours report and downloads a completions CSV.
- **DP-53 — Hospital-only totals and search** Dashboard totals, nurse search, the monthly report and exports include only the coordinator's own hospital's nurses and seats, grouped and filtered by each certificate's provider-time issue date.
- **DP-54 — Safe completions export** The completions CSV is stored under the hospital's folder in object storage and neutralises every cell that a spreadsheet would read as a formula.
- **DP-55 — Coordinator record access** A sponsor coordinator can open certificates and nurse records only for enrolments their hospital funded, and any other id answers as not found.
- **DP-56 — Draft, review and publish a course** A course author drafts a course and submits it, and the nurse planner returns it with a note or publishes it, then later withdraws it.
- **DP-57 — Course lifecycle** Courses move only along the legal edges in Business rules, each edge only by its permitted role, every accepted move raises the version by one, and withdrawn courses keep their certificates valid.
- **DP-58 — Stale course edits** Saving or moving a course with a version someone else has already changed is rejected with the current version number, and nothing changes.
- **DP-59 — Effective-dated coverage** A sponsor coordinator sets a tuition-coverage percentage effective today or from a later date, and a checkout whose quoted learner share no longer matches the policy in effect is refused with the new quote and nothing charged.
- **DP-60 — Close instant in provider time** Every cohort publishes its close instant as 23:59:59.999 on its close date in the provider's time zone, correct across daylight-saving changes, and shows it in Central Time.
- **DP-61 — Unaccepted fields refused** A request body carrying a field its endpoint does not name answers 422 naming each such field and changes nothing, as qualified in API.
- **DP-62 — Exact link expiry** Verification links and emailed download links stop working at exactly their server-side expiry instant, an expired verification link is listed as expired rather than revoked, and every capability response is served uncached and without a referrer.
- **DP-63 — Attributed refund decisions** Each refund decision is written once with the deciding planner, time and note and never changes, and every Kill Bill write names the acting Credwell user, as stated in Services.
- **DP-64 — Copies carry the version's name** Every certificate copy carries the nurse name of the certificate's current version rather than the live display name, and the version history keeps every earlier name.
- **DP-65 — Bounded literal search** Nurse and certificate searches match text literally and accept at most 100 characters, and a completions export spans at most 366 days, as stated in API.

## Frontend

### Screens and layout (DP-06, DP-12, DP-17, DP-21, DP-24, DP-31, DP-35, DP-42, DP-52, DP-56, DP-59, DP-60)

Every signed-in screen has a top bar with the Credwell wordmark, the main navigation (its links depend on role, see the controls table) and Sign out. The page sits on a 12-column grid with comfortable gutters. Content is never wider than the viewport, and nothing scrolls sideways at 375x812, 768x1024 or 1280x800. At 375 wide the navigation collapses behind a "Menu" button that opens a full-width list.

Every screen fetches its data on load and again after every action taken on that screen. No screen refreshes on its own, except the completion screen while a certificate is sealing (Feedback states).

- **Sign in** (`/signin`): a single centred card with email, password and the Sign in button. Unauthenticated visits to any other screen except `/verify/<token>` redirect here.
- **Courses** (`/courses`): the catalogue of published courses, one hairline-ruled row per course. Each row shows the title in the display serif, the format ("Self-paced" or "Live cohort"), total minutes, contact hours and list price. Figures sit in one right-aligned column. At 375 each row stacks title over a line of figures.
- **Course page** (`/courses/<id>`): at 1280 a wide left column (eight grid columns) holds the summary and the module rows (title, minutes, status glyph, hairline rule), and a sticky right column (four grid columns) holds the learner's seal, the price and the Enrol or Continue learning action. For a cohort course, the right column also lists cohorts as radio choices, each with its start date, its close line and its seats remaining. At 768 and 375 the seal and the action sit above the module list in one column. A withdrawn course shows the line "This course has been withdrawn and is no longer open for enrolment." in place of Enrol; a nurse already enrolled still sees Continue learning.
- **Checkout dialog**: a modal over the course page with three right-aligned money rows (list price, the hospital's share and your share) and the Pay button.
- **My learning** (`/learning`): the nurse's enrolments as rows, each with course, state, a progress bar with its percentage, funding ("Your card", "Card + <hospital name>", "<hospital name> seat") and the actions open to that enrolment (Continue, Your seal, Request refund).
- **Module player** (`/learn/<enrolment id>/<module id>`): a left module navigation listing every module with its status glyph, and a main column with the lesson heading, minutes, lesson text and the knowledge check. At 375 and 768 the module navigation becomes a collapsed "Modules" disclosure above the lesson.
- **Post-evaluation** (`/learn/<enrolment id>/evaluation`): the rating, the outcomes question, an optional comment and the Submit evaluation button, in the main column of the same frame.
- **Completion screen** (`/learn/<enrolment id>/seal`): the large seal (centred at 375, left two thirds at 1280), the module list beside or below it with verified and unverified glyphs, and the Share with a verifier and Download certificate PDF actions under the seal. Before a certificate exists it shows the open seal with hatched wedges for unverified modules.
- **Transcript** (`/transcript`): a table of certificates (course, serial, issued, hours, status) with the total earned hours in a summary row under a heavier rule. Hours sit in a right-aligned tabular column. At 375 the table becomes stacked rows that keep the same labels. A certificate whose first PDF is still pending shows "Pending" in the Issued and Status cells. Each sealed row opens the Share dialog.
- **Verification page** (`/verify/<token>`): public, with no navigation. A centred certificate card shows the provider name, the accreditation statement, nurse name, course, contact hours, serial, issue date and status, plus a PDF download.
- **Hospital seats** (`/sponsor`, coordinator): a totals strip of six figures (seats purchased, assigned, available, expired, completions, hours awarded), the seat packs table with each pack's ledger expandable beneath its row, the coverage setting (percentage, effective date, and the scheduled line when a change is scheduled), the nurse search with its results table (each nurse row expands to that nurse's enrolments funded by this hospital), the monthly hours table for a chosen year, and the export form. At 1280 the totals strip is one row of six. At 768 it is two rows of three, and at 375 three rows of two.
- **Planner** (`/planner`, nurse planner): four regions stacked in this order: Review queue, Cohorts, Refund requests, Certificates. Each is a ruled table with its row actions. A decided refund row shows its decision line in place of the Approve and Decline buttons. The cohort detail (`/planner/cohorts/<id>`) shows seat cap, seats remaining, the close line, the roster table and the numbered waitlist.
- **Authoring** (`/author`, course author and nurse planner): the author's courses with their state, and a course editor with course fields and a repeatable module block (title, minutes, kind, lesson text, question, options, correct option). The editor holds the version it loaded and sends it with every save and transition, then takes the version from the response. The review history sits under the editor and names who made each move.

### Public screens and controls (DP-02, DP-09, DP-12, DP-16, DP-31, DP-34, DP-35, DP-42, DP-46, DP-52, DP-56, DP-59, DP-60, DP-63)

Only the controls and regions in this table are public. Everything else is up to you. `<…>` marks a value that is filled in from the record. `<Mon D, YYYY>` is a date in the provider's time zone written as, for example, Apr 3, 2030.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| Sign in | `textbox "Email"`, password field labelled `Password`, `button "Sign in"` | "Sign in to Credwell" |
| Every signed-in screen | `navigation "Main"` with links `Courses`, `My learning`, `Transcript` (learner), `Hospital seats` (coordinator), `Planner` (planner), `Authoring` (author, planner); `button "Sign out"`; at 375 `button "Menu"` | |
| Every screen | `status "Activity status"` (polite), `alert` for outage and conflict messages | copy from Feedback states |
| Courses | `heading "Courses"` level 1, `list "Course catalogue"`, one `link "<course title>"` per item | |
| Course page | `heading "<course title>"` level 1, `list "Modules"`, `img "Contact-hour seal"`, `radiogroup "Cohort"` with one radio per cohort named `<cohort name>`, `button "Enrol"` or `link "Continue learning"` | per cohort "<n> seats remaining" and "Enrolment closes <Mon D, YYYY> at 11:59 PM CT", where the date is the cohort's close date |
| Checkout | `dialog "Checkout"`, `button "Pay $<learner share>"` (or `button "Confirm enrolment"` when the learner share is 0.00), `button "Cancel"`, `button "Join waitlist"` (only after a full-cohort answer) | rows "List price", "Paid by <hospital name>", "Your share" |
| My learning | `heading "My learning"`, one `link "Continue"`, `link "Your seal"` and `button "Request refund"` per eligible enrolment, `progressbar "<course title> progress"` | |
| Request refund | `dialog "Request a refund"`, `textbox "Reason"`, `button "Send request"`, `button "Cancel"` | |
| Module player | `navigation "Course modules"`, `heading "<module title>"`, `region "Lesson"`, `radiogroup "<question prompt>"`, `button "Check answer"`, `link "Next module"`, `link "Go to post-evaluation"` (shown once every lesson is verified) | each module row has the text "Verified" or "Not yet verified" |
| Post-evaluation | `heading "Post-evaluation"`, `radiogroup "Overall rating"` with radios `1` to `5`, `radiogroup "Did this activity meet its stated outcomes?"` with radios `Yes` and `No`, `textbox "Comments (optional)"`, `button "Submit evaluation"` | |
| Completion | `heading "Your contact-hour seal"`, `img "Contact-hour seal"`, `status "Seal status"` (polite), `button "Show result now"` (only while the Seal press plays), `button "Share with a verifier"`, `link "Download certificate PDF"`, `list "Modules"` | "Certificate PDF pending" label while pending |
| Share | `dialog "Share with a verifier"`, read-only `textbox "Verification link"`, `button "Copy link"`, `button "Create new link"`, `button "Revoke link"`, `button "Close"` | |
| Transcript | `heading "Transcript"`, `table "Certificates"` with columns Course, Serial, Issued, Hours, Status, one `button "Share"` per sealed row, `link "View seal"` per row | summary row "Total earned hours" |
| Verification | `heading "Certificate verification"`, `link "Download PDF"`; invalid or expired link: `heading "Link not valid"` | labels "Nurse", "Course", "Contact hours", "Serial", "Issued", "Status" |
| Hospital seats | `heading "Hospital seats"`, `region "Totals"`, `table "Seat packs"`, `button "Buy seats"`, one `button "Assign seat"` and `button "Show ledger"` per pack, `table "Ledger"`, `textbox "Tuition covered (%)"`, `textbox "Effective from"`, `button "Save coverage"`, `searchbox "Search nurses"`, `table "Nurses"`, one `button "Show enrolments"` per nurse row, `table "Nurse enrolments"`, `button "Return seat"` on each seat-funded enrolment in state confirmed, `combobox "Report year"`, `table "Monthly hours"`, `textbox "From"`, `textbox "To"`, `button "Export completions CSV"`, `link "Download CSV"` | totals labels "Seats purchased", "Assigned", "Available", "Expired", "Completions", "Hours awarded"; when a change is scheduled, "Scheduled: <percent>% from <Mon D, YYYY>" with the scheduled percentage and date |
| Buy seats | `dialog "Buy seats"`, `combobox "Course"`, `spinbutton "Seats"`, `button "Buy <n> seats for $<total>"`, `button "Cancel"` | |
| Assign seat | `dialog "Assign seat"`, `combobox "Nurse"`, `button "Assign"`, `button "Cancel"` | |
| Planner | `heading "Planner"`, `region "Review queue"`, `region "Cohorts"`, `region "Refund requests"`, `region "Certificates"`, `button "Approve and publish"`, `button "Return to author"`, `textbox "Note to author"`, `button "Withdraw course"`, `button "New cohort"`, `button "Approve refund"`, `button "Decline refund"`, `searchbox "Search certificates"`, `button "Reissue"`, `button "Revoke"` | each refund row shows "Refund due $<refund total>"; a decided row shows "Approved by <decider name> on <Mon D, YYYY>" or "Declined by <decider name> on <Mon D, YYYY>", from `decided_by` and `decided_at` |
| New cohort | `dialog "New cohort"`, `textbox "Cohort name"`, `spinbutton "Seat cap"`, `textbox "Starts on"`, `textbox "Enrolment closes on"`, `button "Create cohort"` | |
| Cohort detail | `heading "<cohort name>"`, `table "Roster"`, `list "Waitlist"`, `spinbutton "Seat cap"`, `button "Save seat cap"` | "Seats remaining <n>" and the close line from Course page |
| Reissue or revoke | `dialog "Reissue certificate"` or `dialog "Revoke certificate"`, `textbox "Reason"`, `button "Confirm reissue"` or `button "Confirm revoke"` | |
| Authoring | `heading "Authoring"`, `button "New course"`, `textbox "Course title"`, `textbox "Summary"`, `combobox "Format"`, `textbox "List price (USD)"`, per module `textbox "Module title"`, `spinbutton "Minutes"`, `combobox "Module kind"`, `textbox "Lesson text"`, `textbox "Question"`, `textbox "Option 1"` to `textbox "Option 5"`, `combobox "Correct option"`; `button "Add module"`, `button "Save draft"`, `button "Submit for review"`, `list "Review history"` | each history item names its `by` display name |

Seal test hooks: the seal `img` carries `data-seal-state` with one of `open` (no certificate yet), `pending` (first PDF pending), `sealed` or `revoked`. Each wedge inside it carries `data-module-id`, `data-state` (`verified` or `unverified`) and `data-sweep`, which is its final sweep in degrees with one decimal. The centre numeral carries `data-seal-numeral`, and its text is the hours with two decimals. The ring text carries `data-seal-ring` and holds the serial and issue date.

### Interactions (DP-09, DP-14, DP-16, DP-18, DP-29, DP-31, DP-34, DP-35, DP-39, DP-42, DP-59)

- **Tab order** follows reading order on every screen: top bar, main column, then right column. Every focusable element shows a two-tone focus ring (a deep green ring with an off-white halo) that is visible on every background.
- **Dialogs** (Checkout, Request a refund, Share with a verifier, Buy seats, Assign seat, New cohort, Reissue certificate, Revoke certificate) open with focus on their first field, or on their primary button if they have no field. Tab and Shift+Tab cycle inside the dialog. Escape and Cancel or Close shut the dialog and return focus to the control that opened it. The page behind is inert while a dialog is open.
- **Enrol**: Enter or Space on Enrol opens Checkout, which fetches the quote and fills its money rows from it. For a cohort course, arrow keys move between cohort radios, and a cohort that is closed or full is disabled with its reason as text. Enter on Pay submits with the learner share shown as the quoted share. The dialog makes a new idempotency key when it opens and each time its quote changes, and reuses the current key when Pay is pressed again after a network failure, so a retry on a flaky connection charges once. During the request, Pay is disabled and shows the pending copy. A second press while pending does nothing. On success the dialog closes and focus lands on "Continue learning". On a full-cohort answer the dialog stays open, shows the full message and offers Join waitlist. On a changed-quote answer the dialog stays open, replaces its money rows and Pay label with the quote from the response, shows the changed-quote alert and moves focus to Pay.
- **Module player**: arrow keys move within the answer radiogroup, and Enter on Check answer submits. A correct answer turns that module's glyph to verified, updates the progress bar and moves focus to "Next module", or to "Go to post-evaluation" when every lesson is verified. A wrong answer leaves focus on the radiogroup with the field error linked to it. The module navigation links work with Enter.
- **Post-evaluation**: Submit evaluation is disabled until a rating and the outcomes answer are chosen. Enter submits. The button disables while pending, so double presses send at most one request from this page, and the server still guarantees one certificate. Success navigates to the completion screen.
- **Completion screen**: while the Seal press plays, focus sits on the "Your contact-hour seal" heading and a "Show result now" button is the next Tab stop. Enter or Space on it jumps the seal to its final state at once. When the press finishes, the button is removed and focus moves to "Share with a verifier" if it is enabled, or to "Download certificate PDF" if not. Refreshing or revisiting shows the final state with no motion.
- **Share**: "Share" on a transcript row, or "Share with a verifier" on the completion screen, opens the dialog. If the certificate has no active link (none yet, or only revoked or expired ones), one is created on opening. Copy link copies the URL and announces the copied copy. Create new link replaces the link. Revoke link kills it, and the textbox then reads "No active link".
- **Hospital seats**: typing in Search nurses filters on the server after a pause of a quarter second or on Enter. Show enrolments expands that nurse's enrolment table under the row and toggles to "Hide enrolments". Return seat asks for no confirmation. It acts at once, announces its result and refreshes the totals, the pack list and that nurse's enrolments. Buy seats recalculates the button total as Seats changes. Show ledger expands the ledger table under its pack and toggles to "Hide ledger". "Effective from" starts at today's date in the provider's time zone; Save coverage sends the percentage and that date, then refreshes the coverage setting and its scheduled line.
- **Touch**: every row action is a full-size button. Nothing depends on hover, and there are no swipe gestures.

### Visual design (DP-07, DP-11, DP-41)

- **Colour roles**: a warm off-white ground, like unbleached paper, on every page. Near-black ink with a hint of green for text and hairline rules. A deep pine green for every action, link, focus ring and selected state. A soft grey-green muted tone for secondary labels. Terracotta, a burnt orange-brown, is the only saturated colour anywhere and is used only for the seal and its wedges. If the muted tone falls below AA contrast for small text on the ground, darken it until it passes. All text and essential graphics meet WCAG 2.2 AA contrast.
- **Type**: Newsreader, a bookish serif, for page titles, course titles and the seal numeral. Public Sans, a plain humanist sans, for everything else. Each heading level is one fifth larger than the level below it, starting from body text. Every money and hour figure uses tabular numerals and right-aligns in one column, so decimal points line up.
- **Density and rules**: comfortable spacing with generous row height. Every data row is separated by a one-pixel hairline rule in a light ink tone, with no zebra striping and no card shadows. Totals sit under a slightly heavier rule.
- **Composition**: the 12-column grid described in Screens and layout. On course pages the seal holds the right column the way a stamp sits in the corner of a document.
- **The seal**: a circle with a thin terracotta outer ring. Verified wedges are filled terracotta. Unverified wedges are terracotta outlines filled with diagonal hatching and labelled by their module title, so colour is never the only signal. The centre numeral is in the serif, and the serial and issue date run around the inside of the ring in small caps. Status glyphs in module rows are a filled disc with a check for verified and an open dashed circle for not yet verified, each with its text label.
- **Tap targets**: every control is at least 44 by 44 pixels at every viewport.

### Motion and effects (DP-08, DP-10, DP-39, DP-40)

Calm is the rule: nothing moves unless the learner just finished something. There are no decorative loops, spinners that turn forever, parallax, auto-advancing carousels or hover motion anywhere. Pending states use text and a static progress bar. All motion starts quickly and settles softly.

| Motion | Meaning | Feel and timing | Reduced-motion substitute |
|---|---|---|---|
| Dialog and alert appear | a dialog opened or a message arrived | fades in place with no sliding, in under a third of a second; closing fades out in about a fifth of a second | appears and disappears at once |
| Module verified | the learner just passed a knowledge check | the row's glyph fills from open circle to checked disc with a slight press, in about a quarter of a second, and the progress bar extends over about a third of a second | glyph and bar change at once |
| Hover and press | pointer over or pressing a control | colour deepens only; no movement | same (no movement involved) |
| Seal press | the learner just sealed a certificate | see the steps below; the whole press takes no more than about two and a half seconds for the seed courses | see below |

**Seal press**, played once, the first time the completion screen renders after this browser submitted the post-evaluation:

1. The seal starts as an empty ring. In list order, each verified module row's status chip lifts out of its row and travels to the seal. As it lands it becomes a filled wedge that sweeps clockwise from the top. Each wedge's final sweep equals that module's minutes divided by the course's total minutes, times 360 degrees, and the number of wedges equals the server's verified-module count. Each flight and sweep takes a little under half a second, and the next chip leaves about a sixteenth of a second after the previous one.
2. Unverified modules, if any, show as hatched outline wedges from the start and do not move.
3. Once the last wedge lands, the centre numeral counts from 0.00 up to the awarded hours in quarter-hour steps over just under a second, and stops exactly on the server's value.
4. The ring text, holding serial and issue date, fades in over about a quarter of a second.
5. If the certificate is sealed, "Share with a verifier" becomes enabled at that moment. If it is pending, the top of the ring stays open (no wedge or ring line across the top twelve o'clock gap), the "Certificate PDF pending" label sits in that gap, no ring text appears, and the button stays disabled.

The press is time-driven, not tied to scrolling, and it never replays on refresh. "Show result now" jumps straight to the final state. When a pending certificate becomes sealed while the screen is open, the gap closes in about a third of a second, the ring text fades in as in step 4, and the button enables. A pending reissue never changes the seal.

**Reduced motion**: when the user asks for reduced motion, the seal renders in its final state at once: wedges drawn, numeral static at the awarded hours, ring text shown or the pending label shown. The "Seal status" region makes the sealed or pending announcement from Feedback states. The module list keeps the same verified and unverified glyphs and labels, so no information depends on animation.

### Feedback states (DP-12, DP-15, DP-18, DP-19, DP-20, DP-27, DP-29, DP-38, DP-40, DP-43, DP-46, DP-48, DP-49, DP-52, DP-56, DP-58, DP-59, DP-65)

Pending and success copy goes to `status "Activity status"`. Outage and conflict copy goes to an `alert`. Field errors appear under their field, linked to it, using the message from the API's 422 body. Pending copy replaces the action button's label, and the button disables until the request ends. `<placeholders>` take their values from the response.

| Action | Pending | Success | Conflict or outage |
|---|---|---|---|
| Sign in | "Signing in…" | navigates to Courses | field error from API |
| Checkout | "Recording your payment…" | "You're enrolled in <course title>." | withdrawn: "This course is no longer open for enrolment." · full cohort: "The last seat was just taken. Join the waitlist to hold your place in line." · closed: "Enrolment for this cohort has closed." · already enrolled: "You're already enrolled in this course." · quote changed: "The price changed while you were checking out. Your share is now $<learner share>." with the learner share of the returned quote · Kill Bill down: "Payments are unavailable right now. You have not been charged. Try again in a few minutes." |
| Join waitlist | "Joining the waitlist…" | "You're number <position> on the waitlist." | seats open again: "A seat is open again. Choose Enrol to take it." · closed and already enrolled: the checkout copy for those cases |
| Leave waitlist | "Leaving the waitlist…" | "You've left the waitlist." | |
| Check answer | "Checking…" | "Module verified." | field error from API |
| Submit evaluation | "Submitting your evaluation…" | sealed: navigates to the completion screen · pending: navigates to the completion screen and announces "Your evaluation is recorded. The certificate PDF is still being stored. Your hours appear on your transcript once it is sealed, and we'll email you then." | lessons unverified: "Finish every lesson before the post-evaluation." |
| Seal status region | | sealed: "Certificate sealed: <hours> contact hours, serial <serial>" · pending: "Certificate PDF pending" | |
| Pending certificate | the completion screen re-reads the certificate every 5 seconds while it is sealing | turns sealed as in Motion and effects and announces the sealed copy | |
| Share link | "Creating a link…" | "Verification link ready. Anyone with this link can see this one certificate." · copy: "Link copied." · revoke: "Link revoked. It no longer opens the certificate." | not sealed: "This certificate can be shared once its PDF is sealed." |
| Request refund | "Sending your request…" | "Refund requested. The nurse planner will review it." | "This enrolment can't be refunded." for every refund-request 409 |
| Approve refund | "Recording the refund…" | "Refund of $<refund total> recorded." | Kill Bill down: "Payments are unavailable right now. Nothing was refunded. Try again in a few minutes." · already certified: "This nurse has finished the course, so no refund is due." · already decided: "This refund request has already been decided." |
| Decline refund | "Saving…" | "Refund declined." | already decided: the Approve refund copy for that case |
| Buy seats | "Recording the purchase…" | "<n> seats added to your hospital's packs." | withdrawn: the checkout withdrawn copy · Kill Bill down: "Payments are unavailable right now. Your hospital has not been charged. Try again in a few minutes." |
| Assign seat | "Assigning…" | "Seat assigned to <nurse name>. We've emailed them an invitation." | withdrawn: the checkout withdrawn copy · expired: "This pack has expired." · already enrolled: "This nurse is already enrolled in this course." · pack empty: "No seats left in this pack." |
| Return seat | "Returning…" | "Seat returned to the pack." | in use: "This nurse has started the course, so the seat can't be returned." · already returned: "This seat has already been returned." |
| Save coverage | "Saving…" | effective today: "Tuition coverage saved." · later date: "Tuition coverage of <percent>% scheduled from <Mon D, YYYY>." | field error from API |
| Nurse or certificate search | | results table replaces the previous one | field error from API under the searchbox |
| Export | "Preparing your CSV…" | "Export ready: <rows> rows." | field error from API · storage down: "File storage is unavailable right now. Try the export again in a few minutes." |
| Download certificate PDF | | file downloads | pending: "The certificate PDF is still being stored." |
| Course save | "Saving…" | "Draft saved." | stale: "Someone else saved this course a moment ago. Reload to see their changes before saving again." · not editable: "This course can't be edited in its current state." |
| Course transition | "Saving…" | "Course moved to <state label>." | stale: the Course save stale copy · illegal edge: "This course can't move from <from label> to <to label>." |
| New cohort or seat cap | "Saving…" | "Cohort saved." | cap too low: "The seat cap can't be lower than the nurses already enrolled." |
| Reissue | "Reissuing…" | "Certificate reissued as version <version>." · pending: "Reissue recorded. The new PDF is still being stored." | not sealed: "Only a sealed certificate can be reissued or revoked." · reissue pending: "A reissue for this certificate is still being stored." |
| Revoke | "Revoking…" | "Certificate revoked." | the same two conflict copies as Reissue |
| Any request | | | network failure: "We couldn't reach Credwell. Check your connection and try again." |

State labels: draft "Draft", in_review "In review", published "Published", withdrawn "Withdrawn".

## Backend

### API (DP-02, DP-03, DP-13, DP-14, DP-19, DP-21, DP-23, DP-24, DP-25, DP-27, DP-29, DP-32, DP-33, DP-37, DP-43, DP-44, DP-46, DP-50, DP-52, DP-53, DP-55, DP-56, DP-58, DP-59, DP-60, DP-61, DP-63, DP-65)

**Conventions.**
- Every endpoint is under `/api`. Request and response bodies are `application/json; charset=utf-8` unless a row says otherwise.
- Request bodies may be at most 65,536 bytes, and exactly 65,536 is allowed. Larger bodies get `413 {"error":"payload_too_large"}`. A body with any other content type gets `415 {"error":"unsupported_media_type"}`, and malformed JSON gets `400 {"error":"invalid_json"}`.
- Money is a string with two decimals in US dollars (`"45.50"`). Hours and percentages are strings with two decimals (`"1.25"`, `"50.00"`). Dates are `YYYY-MM-DD` in the provider's time zone. Instants are ISO 8601 UTC with milliseconds (`"2030-04-04T04:59:59.999Z"`). Ids are opaque random UUIDs.
- Sign-in sets an HttpOnly, SameSite=Lax session cookie named `credwell_session`.
- **Accepted fields.** A JSON body may carry only the top-level fields its row names. Every other top-level field is a validation error with the message "This field is not accepted." under that field's name, reported in the same 422 `errors` object as every other invalid field. A row that names no body accepts no body, an empty body or `{}`, and any field sent to it is unaccepted. A field a row marks optional may be omitted or null. For example, `PATCH /api/me {"display_name":"Ana R","role":"planner"}` answers `422 {"errors":{"role":"This field is not accepted."}}` and changes nothing, and a wrong answer sent as `{"option_index":1,"status":"verified"}` answers 422 with both an `option_index` and a `status` error and leaves the module unverified.

**Error shape.** Every error is either `{"error":"<code>"}`, with the extra fields a row names, or, for validation only, `422 {"errors":{"<field>":"<message>"}}` listing every invalid and unaccepted field at once.

**Precedence (whole API).** Checks run in this order, and the first failure wins:
1. `405 {"error":"method_not_allowed"}` for a method the path does not support.
2. Boundary checks: 413, 415, 400 invalid_json, then the cross-origin 403 from Server boundary.
3. `401 {"error":"unauthenticated"}` when there is no valid session. Four kinds of request are exempt and never answer 401: health, sign-in (`POST /api/session`), the public verification paths (`/api/verify/<token>` and `/api/verify/<token>/pdf`), and the token-bearing certificate PDF download (`GET /api/certificates/<id>/pdf` with a `token` query parameter). On the token-bearing download, a missing session is never checked; an unknown, invalid or expired token answers 404 under step 4 instead.
4. `404 {"error":"not_found"}` for an unknown id, another tenant's record, a record the caller may not read, or a token that does not open the record it names. Ids in a request body (`course_id`, `cohort_id`, `nurse_id`) count here exactly like ids in the path.
5. `403 {"error":"forbidden"}` when the caller's role may not use the endpoint, or the row's own permission rule refuses this caller.
6. Request preconditions and short-circuits, in this order: `428 {"error":"version_required"}` missing `If-Match`, `400` missing or malformed idempotency key, a stored idempotent replay (returned as is, before any later check), `409` idempotency key reused, `412 {"error":"stale_version","current_version":<n>}` stale `If-Match`, then the existing-certificate 200 of the evaluation row.
7. `409` state conflicts, in the order the endpoint row lists them.
8. `422` validation, including unaccepted fields. A row's own 200 short-circuit for a no-op (an already verified module) runs before this step.
9. `503` from an unavailable dependency.

**Objects.**
- `User`: `{"id","email","display_name","role":"learner"|"coordinator"|"planner"|"author","organisation":{"id","name","kind":"provider"|"hospital"}|null}`. `/api/me` alone adds `"licence_number"` and `"date_of_birth"` for learners.
- `Course`: `{"id","title","summary","format":"self_paced"|"cohort","state":"draft"|"in_review"|"published"|"withdrawn","list_price","total_minutes","contact_hours","version","author":{"id","display_name"},"modules":[{"id","position","title","minutes","kind":"lesson"|"evaluation"}],"cohorts":[Cohort]}`. Its author and the planner also get `"body"` and `"question":{"prompt","options":[...],"answer_index"}` on each lesson.
- `Cohort`: `{"id","course_id","name","starts_on","close_date","closes_at","seat_cap","seats_remaining","open":true|false}`. For the planner only, it adds `"roster":[{"enrolment_id","nurse_name","state"}]` and `"waitlist":[{"position","nurse_name","joined_at"}]`.
- `Quote`: `{"list_price","employer_share","learner_share","coverage_percent","sponsor":"<hospital name>"|null}`.
- `Enrolment`: `{"id","course_id","course_title","cohort_id"|null,"state":"held"|"confirmed"|"completed"|"certified"|"refunded"|"withdrawn","funding":"card"|"co_pay"|"seat","assignment_id"|null,"list_price","employer_share","learner_share","enrolled_at","verified_minutes","total_minutes","progress_percent","certificate_id"|null,"modules":[{"id","title","minutes","kind","status":"verified"|"unverified"}]}`. `assignment_id` is the seat assignment that created a seat enrolment, and null for every other funding. `progress_percent` is verified minutes × 100 / total minutes, rounded down to a whole number.
- `Certificate`: `{"id","serial","state":"sealing"|"sealed"|"revoked","version","reissue_pending":true|false,"nurse_name","course_title","contact_hours","issued_on"|null,"enrolment_id","verified_module_count","versions":[{"version","state":"sealing"|"sealed"|"reissued"|"revoked","sealed_on"|null,"nurse_name"}]}`. `version` and `nurse_name` are those of the current version as defined in Business rules. `versions` lists every version, oldest first. `issued_on` is null while the certificate is sealing.
- `Pack`: `{"id","course_id","course_title","seats_purchased","balance","price_total","purchased_at","expires_at","state":"active"|"expired"}`.
- `RefundRequest`: `{"id","enrolment_id","nurse_name","course_title","state":"pending"|"approved"|"declined","reason","requested_at","refund_total","employer_refund","learner_refund","decided_by":{"id","display_name"}|null,"decided_at"|null,"decision_note"|null}`. While a request is pending, the three amounts are what approving now would pay, unless Business rules has already fixed them. Once it is decided they are fixed.
- `Coverage`: `{"coverage_percent":"<percent in effect now>","scheduled":{"coverage_percent","effective_on"}|null}`.

**Session and profile.**
- `POST /api/session` `{"email","password"}` → `200 {"user":User}`. Wrong credentials → `422 {"errors":{"password":"Email or password is incorrect."}}`.
- `DELETE /api/session` → `204`.
- `GET /api/me` → `200 {"user":User}`.
- `PATCH /api/me` `{"display_name"}` → `200 {"user":User}`. The name is trimmed, and any characters are allowed. Empty or longer than 80 characters → `422 {"errors":{"display_name":"Enter a display name of 1 to 80 characters."}}`.

**Courses** (any signed-in role unless noted).
- `GET /api/courses` → `200 {"courses":[Course without modules or cohorts]}`. Learners and coordinators get published courses. Authors get published courses plus their own in any state. The planner gets every course.
- `GET /api/courses/<id>` → `200 {"course":Course}`. Published and withdrawn courses are readable by every signed-in user. Draft and in-review courses are readable only by their author and the planner.
- `POST /api/courses` (author) `{"title","summary","format","list_price","modules":[{"title","minutes","kind","body","question":{"prompt","options","answer_index"}}]}` → `201 {"course":Course}` in state draft with version 1. Validation messages:
  - title: "Enter a course title of 1 to 120 characters."
  - list_price: "Enter a price from 0.00 to 5000.00 with two decimals."
  - minutes: "Minutes must be a whole number from 5 to 240."
  - modules: "Add at least one lesson and exactly one post-evaluation, placed last."
  - question: "Give each lesson a question with 2 to 5 options and one correct option."
  - Evaluation modules carry no body or question.
- `PATCH /api/courses/<id>` with header `If-Match: "<version>"` and any subset of the POST fields → `200 {"course":Course}`. Only the course's author and the planner may use it; anyone else who can read the course gets 403. A course whose state does not allow edits by this caller (Business rules) → `409 {"error":"course_not_editable"}`. Validation is as for POST.
- `POST /api/courses/<id>/transitions` with header `If-Match: "<version>"` `{"to","note"}` (`note` optional) → `200 {"course":Course}`. Permission: an author may only send `to: "in_review"` on their own course; the planner may only send `to` of `"published"`, `"draft"` or `"withdrawn"`. Any other caller or `to` value (including an unknown state) → 403. For a permitted `to`, a from-state that is not a legal edge to it → `409 {"error":"invalid_transition","from":"<state>","to":"<state>"}`. A return to draft without a note → `422 {"errors":{"note":"Tell the author what to change."}}`.
- `GET /api/courses/<id>/history` (its author, planner) → `200 {"history":[{"from","to","by":{"id","display_name"},"note","at"}]}`, oldest first.

**Cohorts.**
- `POST /api/courses/<id>/cohorts` (planner) `{"name","seat_cap","starts_on","close_date"}` → `201 {"cohort":Cohort}`. A course that is not a cohort course, or is not published → `409 {"error":"course_not_open"}`. Validation messages:
  - seat_cap: "Seat cap must be a whole number from 1 to 500."
  - close_date: "Enrolment must close on or before the start date."
  - name: "Enter a cohort name of 1 to 80 characters."
- `GET /api/cohorts/<id>` → `200 {"cohort":Cohort}`. Readable by whoever can read its course.
- `PATCH /api/cohorts/<id>` (planner) `{"seat_cap"}` → `200 {"cohort":Cohort}`. A cap below the active enrolments → `409 {"error":"cap_below_enrolled"}`. Validation is as for creation.
- `POST /api/cohorts/<id>/waitlist` (learner, no body) → `201 {"waitlist_entry":{"position","joined_at"}}`. A learner already on it gets `200` with the same entry, checked before the conflicts. Conflicts, in this order: `409 {"error":"already_enrolled"}`, `409 {"error":"enrolment_closed"}`, `409 {"error":"seats_available"}`.
- `DELETE /api/cohorts/<id>/waitlist` (learner) → `204`. Not on the list → `404`.

**Checkout and enrolments** (learner unless noted).
- `GET /api/checkout/quote?course_id=<id>` → `200 Quote`, computed under the coverage policy in effect at the request instant.
- `POST /api/checkout` with header `Idempotency-Key` (8 to 128 printable ASCII characters) `{"course_id","cohort_id","quoted_learner_share"}` → `201 {"enrolment":Enrolment}` in state confirmed. `cohort_id` is null for self-paced courses; a `cohort_id` that is unknown or belongs to another course is a 404 under precedence step 4. `quoted_learner_share` is the learner share the nurse was shown. Errors:
  - `400 {"error":"idempotency_key_required"}` when the key is missing or malformed.
  - `409 {"error":"idempotency_key_reused"}`.
  - Conflicts, in this order: `409 {"error":"course_not_open"}` (course withdrawn), `409 {"error":"already_enrolled"}`, `409 {"error":"enrolment_closed"}`, `409 {"error":"cohort_full","waitlist":true}`, `409 {"error":"quote_changed","quote":Quote}` when `quoted_learner_share` is a well-formed money string that differs from the learner share computed for this request; `quote` is computed at this request's instant.
  - Validation: `cohort_id` "Choose a cohort for this course." when null for a cohort course; `quoted_learner_share` "Refresh the quote and try again." when missing or not a money string.
  - `503 {"error":"payments_unavailable"}`.
- `GET /api/me/enrolments` → `200 {"enrolments":[Enrolment]}`.
- `GET /api/enrolments/<id>` (its learner, planner, the funding hospital's coordinator) → `200 {"enrolment":Enrolment}`.
- `GET /api/enrolments/<id>/modules/<module id>` (its learner) → `200 {"module":{"id","title","minutes","kind","body","question":{"prompt","options"}},"status"}`. There is no `answer_index`.
- `POST /api/enrolments/<id>/modules/<module id>/answer` (its learner) `{"option_index"}` (0-based) → `200 {"enrolment":Enrolment}`. Checks, in this order:
  - `409 {"error":"enrolment_inactive"}` for an enrolment that is held, refunded or withdrawn.
  - `409 {"error":"not_a_lesson"}` for the evaluation module.
  - An already verified module → `200` with nothing changed.
  - A wrong answer → `422 {"errors":{"option_index":"That is not the best answer. Review the lesson and try again."}}`.
- `POST /api/enrolments/<id>/evaluation` (its learner) `{"rating":1-5,"met_outcomes":true|false,"comment":"<0 to 1000 characters>"}` (`comment` optional) → `201 {"certificate":Certificate}` when sealed, or `202 {"certificate":Certificate}` when sealing. Once the enrolment has a certificate, every later submit, concurrent or not, returns `200 {"certificate":<the same certificate>}` at precedence step 6 and ignores its body. Otherwise:
  - Conflicts, in this order: `409 {"error":"enrolment_inactive"}` (held, refunded or withdrawn), `409 {"error":"lessons_unverified"}`.
  - Validation: rating "Choose a rating from 1 to 5.", met_outcomes "Answer yes or no.", comment "Keep comments under 1000 characters."
- `POST /api/enrolments/<id>/refund-request` (its learner) `{"reason"}` → `201 {"refund_request":RefundRequest}`. Errors:
  - Conflicts, in this order: `409 {"error":"already_certified"}` (enrolment completed or certified), `409 {"error":"not_refundable"}` (seat funding, or state held, refunded or withdrawn), `409 {"error":"refund_pending"}`.
  - `422 {"errors":{"reason":"Tell the planner why you are asking for a refund."}}` when the reason is empty or longer than 500 characters.

**Certificates and transcript.**
- `GET /api/me/transcript` (learner) → `200 {"certificates":[Certificate],"total_hours"}`.
- `GET /api/certificates/<id>` (its learner, planner, the funding hospital's coordinator) → `200 {"certificate":Certificate}`.
- `GET /api/certificates/<id>/pdf` without a `token` query parameter (same readers, session required) → `200 application/pdf` for the current version. A certificate in state sealing → `409 {"error":"pdf_pending"}`. Storage unreachable → `503 {"error":"storage_unavailable"}`.
- `GET /api/certificates/<id>/pdf?token=<token>` is the signed download link from the certificate emails. It needs no session, and a session cookie, if sent, is ignored. A valid, unexpired token made for this certificate → `200 application/pdf` of the version the emailed link was made for. A token that is unknown, malformed, expired or made for another certificate → `404 {"error":"not_found"}`, never 401. Storage unreachable → the storage 503 above.
- `POST /api/certificates/<id>/share-links` (its learner, no body) → `201 {"link":{"id","url":"/verify/<token>","state":"active","created_at","expires_at"}}`. A state other than sealed → `409 {"error":"certificate_not_sealed"}`.
- `GET /api/certificates/<id>/share-links` (its learner) → `200 {"links":[{"id","url","state":"active"|"revoked"|"expired","created_at","expires_at"}]}`.
- `DELETE /api/certificates/<id>/share-links/<link id>` (its learner) → `204`.
- `GET /api/planner/certificates?q=<text>` (planner) → `200 {"certificates":[Certificate]}`, matched as Business rules describes. An empty `q` lists every certificate.
- `POST /api/certificates/<id>/reissue` (planner) `{"reason"}` → `201 {"certificate":Certificate}` when the new version is sealed, or `202` when it is sealing. Conflicts, in this order: `409 {"error":"invalid_transition","from":"<state>","to":"reissued"}` when the state is not sealed, `409 {"error":"reissue_pending"}`.
- `POST /api/certificates/<id>/revoke` (planner) `{"reason"}` → `200 {"certificate":Certificate}`. Conflicts, in this order: `409 {"error":"invalid_transition","from":"<state>","to":"revoked"}` when the state is not sealed, `409 {"error":"reissue_pending"}`.
- Both reissue and revoke reject an empty reason, or one longer than 500 characters, with `422 {"errors":{"reason":"Give a reason of 1 to 500 characters."}}`.

**Public verification** (no session).
- `GET /api/verify/<token>` → `200 {"certificate":{"serial","nurse_name","course_title","contact_hours","issued_on","state":"sealed"|"revoked","provider","accreditation_statement"}}`. An unknown, revoked, replaced or expired link → `404`.
- `GET /api/verify/<token>/pdf` → `200 application/pdf` of the current version for an active link to a sealed certificate. Otherwise → `404`.
- Both paths support only GET and HEAD; every other method gets the 405, even with a valid token and a session cookie.

**Refund queue** (planner).
- `GET /api/refund-requests` → `200 {"refund_requests":[RefundRequest]}`, pending first.
- `POST /api/refund-requests/<id>/approve` `{"note"}` (`note` optional) → `200 {"refund_request":RefundRequest,"enrolment":Enrolment}`. Conflicts, in this order: `409 {"error":"request_closed"}` (not pending), `409 {"error":"already_certified"}` (the enrolment became completed or certified after the request; the request stays pending). Kill Bill down → `503 {"error":"payments_unavailable"}`.
- `POST /api/refund-requests/<id>/decline` `{"note"}` (`note` optional) → `200 {"refund_request":RefundRequest}`. A request that is not pending → `409 {"error":"request_closed"}`.
- Both reject a note longer than 500 characters with `422 {"errors":{"note":"Keep the note to 500 characters or fewer."}}`.

**Sponsor** (coordinator; every read is limited to the coordinator's own hospital).
- `GET /api/sponsor/dashboard` → `200 {"seats_purchased","seats_assigned","seats_available","seats_expired","completions","hours_awarded","coverage":Coverage}`, each figure defined in Business rules.
- `PATCH /api/sponsor/coverage` `{"coverage_percent","effective_on"}`, both required → `200 Coverage`. Validation:
  - coverage_percent: "Enter a percentage from 0 to 100 with at most two decimals."
  - effective_on: "Choose today or a later date." when missing, malformed or before today in the provider's time zone.
- `GET /api/sponsor/packs` → `200 {"packs":[Pack]}`.
- `POST /api/sponsor/packs` with header `Idempotency-Key` `{"course_id","seats"}` → `201 {"pack":Pack}`. Errors:
  - Key errors as for checkout.
  - `409 {"error":"course_not_open"}` for a withdrawn course.
  - `422 {"errors":{"course_id":"Seat packs are sold for self-paced courses only."}}` for a cohort course.
  - `422 {"errors":{"seats":"Buy from 1 to 500 seats."}}`.
  - `503 {"error":"payments_unavailable"}`.
- `GET /api/sponsor/packs/<id>/ledger` → `200 {"pack_id","balance","entries":[{"movement_id","kind":"purchase"|"assignment"|"return"|"expiry","account","seats","assignment_id"|null,"posted_at"}]}`. `account` is `"pack"`, `"purchases"`, `"nurse:<user id>"` or `"expired"`, `seats` is a signed whole number, and `assignment_id` is set on both entries of assignment and return movements and null otherwise.
- `POST /api/sponsor/packs/<id>/assignments` `{"nurse_id"}` → `201 {"assignment":{"id","pack_id","nurse_id","enrolment_id","state":"assigned"},"enrolment":Enrolment}`. A nurse not employed by this hospital is a 404 under precedence step 4. Conflicts, in this order: `409 {"error":"course_not_open"}`, `409 {"error":"pack_expired"}`, `409 {"error":"already_enrolled"}`, `409 {"error":"pack_empty"}`.
- `DELETE /api/sponsor/assignments/<id>` → `200 {"assignment":{"id","pack_id","nurse_id","enrolment_id","state":"returned"},"enrolment":Enrolment}`. Conflicts, in this order: `409 {"error":"already_returned"}`, `409 {"error":"seat_in_use"}`.
- `GET /api/sponsor/learners?q=<text>` → `200 {"learners":[{"id","display_name","email","seats_held","hours_completed"}]}`. These are the hospital's employed nurses whose display name or email contains the text, matched as Business rules describes. An empty `q` lists them all.
- `GET /api/sponsor/learners/<id>` → `200 {"learner":{"id","display_name","email"},"enrolments":[Enrolment],"certificates":[Certificate]}`, limited to enrolments this hospital funded. A nurse with none → `404`.
- `GET /api/sponsor/reports/monthly?year=<YYYY>` → `200 {"year","months":[{"month":"YYYY-MM","completions","hours"}]}`, always twelve entries. A year outside 2000 to 2100 → `422 {"errors":{"year":"Choose a year from 2000 to 2100."}}`.
- `POST /api/sponsor/exports` `{"from","to"}` → `201 {"export":{"id","rows","download_url":"/api/sponsor/exports/<id>.csv"}}`. Validation:
  - from: "Enter a start date as YYYY-MM-DD." when missing or malformed.
  - to: "Enter an end date as YYYY-MM-DD." when missing or malformed; otherwise "The end date must be on or after the start date." when `from` is after `to`; otherwise "Export at most 366 days at a time." when the range from `from` to `to`, both counted, is longer than 366 days. A range of exactly 366 days is allowed.
  - Storage down → `503 {"error":"storage_unavailable"}`.
- `GET /api/sponsor/exports/<id>.csv` → `200 text/csv; charset=utf-8`, read back from object storage. Storage down → `503 {"error":"storage_unavailable"}`.
- Both searches (`/api/sponsor/learners` and `/api/planner/certificates`) reject a `q` longer than 100 characters with `422 {"errors":{"q":"Search with at most 100 characters."}}`. Exactly 100 characters is allowed.

**Health.** `GET /api/health` → `200 {"status":"ok"}`. It needs no session.

### Business rules (DP-13, DP-14, DP-15, DP-18, DP-19, DP-20, DP-22, DP-26, DP-28, DP-29, DP-30, DP-32, DP-36, DP-37, DP-43, DP-47, DP-48, DP-50, DP-51, DP-53, DP-54, DP-55, DP-57, DP-58, DP-59, DP-60, DP-62, DP-63, DP-64, DP-65)

**Course lifecycle.** The legal edges are:
- draft → in_review, by the course's author.
- in_review → published, by the planner.
- in_review → draft, by the planner with a note. This is "returned".
- published → withdrawn, by the planner.

Every other pair, including a repeat of the edge just taken, is an invalid transition. Every save and every transition must name the version it was based on, and one sent with an older version is refused as stale with the current version number, before the edge itself is judged. Every accepted save and every accepted transition raises the version by exactly one and writes nothing else on refusal. Each accepted transition writes one history entry naming who made it. So a double-clicked "Submit for review" sent twice with the same version records one history entry, and the second request gets the stale 412. For example, with the seed data at start, submitting "Wound Care Documentation Essentials" with version 1 moves it to version 2, and a planner return sent with version 2 moves it to version 3.

The author edits their own course while it is draft. The planner edits any course in draft or in review. Published and withdrawn courses are not editable by anyone, and an author's course in review is not editable by its author.

A course's contact hours are its total minutes, including the post-evaluation, divided by 60 and rounded down to the nearest 0.25.

Withdrawn courses stay readable but cannot be bought, assigned, packed or given new cohorts. Existing enrolments may still finish. Certificates already issued for a withdrawn course stay valid and verifiable.

**Enrolment lifecycle.**
- held → confirmed: every payment for it is recorded, or a seat is assigned.
- confirmed → completed: the post-evaluation is accepted.
- completed → certified: the first PDF is stored.
- confirmed → refunded: a refund request is approved for a card or co-pay enrolment.
- confirmed → withdrawn: the seat is returned for a seat enrolment with zero verified minutes.

Every other move is refused with the conflict code in API. A learner may hold at most one enrolment per course that is not refunded or withdrawn.

**Coverage policy.**
- Each hospital has exactly one coverage percent in effect at any instant and at most one scheduled change.
- A change whose `effective_on` is today in the provider's time zone is in effect from the request instant and leaves any scheduled change in place.
- A change with a later `effective_on` becomes the scheduled change, replacing any earlier scheduled one. It takes effect at 00:00 provider time on that date with no request needed; from that instant every read reports it as the percent in effect and `scheduled` as null.
- Every quote and every checkout uses the policy in effect at the instant of that request.

**Shares (co-pay).**
- The nurse's employer share is the list price times the coverage percent in effect for their hospital, divided by 100 and rounded down to the cent. The learner share is the list price minus the employer share, so the two always add up to the list price exactly.
- A nurse with no employer, or whose hospital covers 0%, pays everything. A share of 0.00 creates no payment.
- Funding is `card` when the employer share is 0.00 and `co_pay` otherwise.
- Shares are fixed on the enrolment at checkout. Later coverage changes never touch existing enrolments, their receipts or their refund amounts.
- For example, with the seed data at start, Ana Ruiz buying "Sepsis Recognition in the First Hour" is quoted 45.00 for themselves and 45.00 for Harbourview, and Cara Lindqvist buying "Delirium Screening at the Bedside" pays 30.34 and Linden Valley pays 15.16.
- A checkout whose quoted learner share no longer matches is refused with quote_changed before anything is held or charged: no Kill Bill payment, no enrolment row, no seat claim and no email.

**Idempotency** (checkout and pack purchase).
- Keys are scoped to the signed-in user and kept for as long as the record they created exists.
- A repeat with the same key and the same JSON body (every field, including `quoted_learner_share`) returns the stored status and body and makes no new payment, record or email.
- The same key with a different body gets the key-reused 409.
- Only success responses are stored. A request that failed (for example with 503 or quote_changed) leaves the key unused, so a retry with that key runs again from the start.
- Concurrent requests with one key wait for the first and get its response.

**Checkout as one unit.**
1. A checkout first holds the enrolment, and for cohorts claims the seat, in one serialisable transaction.
2. It then records the employer payment and the learner payment in Kill Bill.
3. It then confirms the enrolment and queues the receipt in the same database transaction.

If any payment fails, every payment already made for this checkout is refunded in full in Kill Bill, the hold and seat are released, no enrolment remains in any state, no email is sent, and the response is the payments 503.

**Cohort seats.**
- Seats remaining is the seat cap minus the cohort's enrolments in held, confirmed, completed or certified. It is computed from those rows on every read, never kept as a stored counter. Refunded and withdrawn enrolments free their seat.
- When N checkouts race for the last seat, exactly one succeeds. Every other one gets the full-cohort 409, and no seat is ever held twice.
- The waitlist is ordered by `joined_at`, with ties broken by the order the entries were written, and positions are 1-based among current entries. Learners who join at the same moment always get distinct, consecutive positions. Leaving renumbers the entries behind. Joining is allowed only while the cohort is open and seats remaining is zero. A learner who later enrols is removed from that cohort's waitlist.
- Nobody is promoted automatically.

**Cohort close instant.**
- `closes_at` is the UTC instant of 23:59:59.999 on the cohort's `close_date` in the provider's time zone (seed: America/Chicago), using that date's daylight-saving rules, never a fixed offset.
- `open` is true only while the request instant is before `closes_at`. Checkout and waitlist joins compare against that same instant, and from `closes_at` onward both get the closed 409.
- Examples for America/Chicago: close date 2030-03-09 → `2030-03-10T05:59:59.999Z`; 2030-03-10 → `2030-03-11T04:59:59.999Z`; 2030-11-03 → `2030-11-04T05:59:59.999Z`; 2026-01-15 → `2026-01-16T05:59:59.999Z`.

**Seat ledger.**
- Each pack has a pack account. Every movement writes exactly two entries whose seats add up to zero:
  - purchase: +N to pack, −N to purchases.
  - assignment: −1 to pack, +1 to `nurse:<id>`.
  - return: +1 to pack, −1 to `nurse:<id>`.
  - expiry: −remaining to pack, +remaining to expired.
- Entries are never edited or deleted. Corrections are new reversing movements.
- The balance is the sum of the pack-account entries, computed from the ledger, and is never negative.
- Concurrent assignments on the last seat: exactly one wins and the rest get pack_empty.
- A seat can be returned only while its enrolment is confirmed with zero verified minutes. Otherwise the seat is in use.

**Pack expiry.**
- A pack's `expires_at` is 12 calendar months after purchase, or, when `CREDWELL_SEAT_EXPIRY_SECONDS` is set, exactly that many seconds after purchase.
- At or after that instant, the first request that reads or writes the pack, its ledger, the pack list or the dashboard posts one expiry movement for any remaining balance, if there is one, and marks the pack expired.
- When several requests are the first to touch a pack at or after its expiry instant, together they post exactly one expiry movement (two entries). An assignment racing that expiry either completes before the expiry instant or gets pack_expired; it never produces a negative balance or a second expiry movement.
- Expired seats return to no one. Assigned seats keep their enrolments.

**Sponsor totals.** Every figure is computed on each read from the ledger and certificate rows of the coordinator's own hospital:
- `seats_purchased`: the seats of every purchase movement (the negated sum of the purchases-account entries).
- `seats_assigned`: the net sum of every `nurse:<id>` account entry, so seats currently held by nurses (assignments minus returns).
- `seats_available`: the sum of the pack balances.
- `seats_expired`: the sum of the expired-account entries.
- These always satisfy seats purchased = assigned + available + expired.
- `completions` and `hours_awarded`: the count and the summed hours of certificates in state sealed whose enrolment the hospital funded.
- In nurse search, `seats_held` is the net sum of that nurse's `nurse:<id>` entries across the hospital's packs, and `hours_completed` is the summed hours of that nurse's sealed certificates whose enrolment the hospital funded.

**Module verification.**
- A lesson is verified when its knowledge-check answer matches the correct option.
- The post-evaluation module is verified when the evaluation is accepted, which requires every lesson verified.
- Verified minutes are the sum of verified modules' minutes. No request field can set a module's status, verified minutes, hours or a certificate.

**Certificates.**
- There is one certificate per (learner, enrolment).
- Submitting the evaluation creates the certificate, version 1 in state sealing, in the same serialisable transaction that completes the enrolment. Concurrent and repeat submits get that same certificate.
- Awarded hours are the verified minutes divided by 60, rounded down to 0.25, computed once at that moment and stored. They never change, not even on reissue. For example, with the seed data at start, "Wound Care Documentation Essentials" awards 1.00 and "Delirium Screening at the Bedside" awards 0.75.
- The serial is `SPL-<issue year>-<6-digit sequence>`. The sequence runs across all certificates from 000001 and is never reused.
- Each version records the nurse name it was made with: version 1 takes the nurse's display name when the evaluation is accepted, and each reissue takes the display name at the time of the reissue. A version's name never changes.
- Version states move sealing → sealed → reissued (superseded by a newer sealed version) or revoked. A version becomes sealed only after its PDF object exists; its `sealed_on` is that date in the provider's time zone.
- The current version is the newest sealed or revoked version, or version 1 while no version has been sealed yet.
- The certificate's state is sealing until version 1 is sealed; then the enrolment becomes certified, the email is queued, and the state is sealed; after a revoke it is revoked.
- `issued_on` is the `sealed_on` of version 1 and never changes, including on reissue.
- A reissue keeps the serial, hours and `issued_on` and adds a new version in sealing. While it is sealing, `reissue_pending` is true and the certificate stays sealed on its previous version: the transcript, PDF endpoints and verification links all show and serve that previous version. Once the new PDF is stored, the new version becomes sealed and current, the previous one becomes reissued, and the reissue email is queued. Older PDF objects are kept.
- Reissue and revoke requests on one certificate are decided one at a time in arrival order, each against the state the previous decision left. A reissue is pending from the moment it is accepted until its new version is sealed. Any reissue or revoke decided while a reissue is pending gets reissue_pending, and any decided after an accepted revoke gets invalid_transition from revoked.
- So of N concurrent reissue or revoke requests on one sealed certificate, exactly one is accepted whenever the first accepted request is a revoke, or a reissue whose new version is still sealing. For example, while storage is unreachable, the first accepted reissue answers 202 and every other request gets one of those two 409s.
- With storage healthy, a reissue can seal within its own request and answer 201. A request decided after that is judged against the newly sealed certificate and may itself be accepted, so the exactly-one guarantee does not cover two reissues that each seal in turn.
- A pending reissue does not change the completion screen's seal.
- A revoked certificate stays on the transcript with status Revoked.

**Name on certificate copies.** The transcript row, the planner certificate list, `GET /api/certificates/<id>`, the coordinator's nurse record, `/api/verify/<token>`, the verification page, the PDF, the certificate emails and the completions CSV `nurse_name` column all carry the current version's `nurse_name`, never the nurse's live display name. A rename therefore changes no certificate copy until a reissue is sealed, and then every copy changes together while `versions` keeps the earlier names.

**Transcript total.** `total_hours` is the sum of hours of the learner's certificates in state sealed, computed from the certificate rows on every read. Sealing and revoked certificates add nothing, and each certificate counts once whatever its number of versions or a pending reissue.

**Refunds.**
- Only card and co-pay enrolments in confirmed state can be refunded; once the post-evaluation is accepted no refund is due.
- The amount is decided at approval:
  - Full list price, when the approval instant is before `enrolled_at` plus the full-refund window and verified minutes are less than 25% of total minutes.
  - Otherwise prorated: the list price times unfinished minutes divided by total minutes, rounded down to the cent.
- The full-refund window is 7 days, or `CREDWELL_FULL_REFUND_WINDOW_SECONDS` seconds when that variable is set.
- The employer refund is the refund total times the original employer share divided by the list price, rounded down to the cent. The learner refund is the remainder, so the two always add up to the refund total.
- Approval records the employer refund, then the learner refund, each only if non-zero, then marks the request approved and the enrolment refunded. Before recording each refund it looks for a transaction with that refund's external key (Services) on the original payment and records nothing new if one exists, so a retried approval never refunds twice.
- Once any refund for a request has been recorded in Kill Bill, the request's three amounts are fixed and every later approval attempt uses them.
- If Kill Bill fails during approval, Credwell changes nothing: the request stays pending with null decision fields and the enrolment keeps its state. Any refund Kill Bill already recorded is kept and reused by its key on the next approval.
- **Decisions are written once.** Approving or declining sets `decided_by` (the planner), `decided_at` (the decision instant) and `decision_note` (the note, or null) in the same transaction that changes the request's state. No endpoint changes them afterwards, and a later approve or decline gets request_closed with the decision fields unchanged.
- For example, with the seed data at start, if Cara bought the delirium course, verified 25 of its 55 minutes, and the refund is approved after the window, the refund total is 24.81, of which Linden Valley gets 8.26 and Cara gets 16.55. (Within the window the same progress also gives the prorated amount, because 25 minutes is not less than 25% of 55.)

**Verification links.**
- A link token carries at least 128 random bits in URL-safe form.
- A certificate has at most one active link. Creating a link revokes the currently active link, if any; revoked and expired links keep their state.
- A link's `expires_at` is exactly its `created_at` plus the link lifetime, with milliseconds kept. The lifetime is 90 days, or `CREDWELL_SHARE_LINK_TTL_SECONDS` seconds when that variable is set.
- A request at or after `expires_at` treats the link as expired (the edge itself is expired). A link that was not revoked before its `expires_at` is listed as `"expired"` from then on, never as `"revoked"`.
- A revoked, replaced or expired link stops working on the very next request.
- A link to a certificate that was revoked later still opens and shows status revoked, but its PDF answers 404. A link to a reissued certificate shows the current version.
- A link is read-only.

**Emailed download links** carry a signed token bound to one certificate and one version, made when the email is queued. It expires exactly 7 days later, or `CREDWELL_DOWNLOAD_LINK_TTL_SECONDS` seconds later when that variable is set; a request at or after that instant gets 404. After a reissue, an earlier email's token keeps serving the version it was made for until it expires.

**Private fields.** Certificate emails, certificate PDFs, the verification API and the verification page carry only nurse name, course, hours, serial, issue date, status, version, provider name and accreditation statement. They never include the licence number, date of birth, nurse email, list price, either share, or coverage percent.

**Record access.**
- A learner reads only their own enrolments, modules, certificates, PDFs, share links and transcript.
- A coordinator reads an enrolment, certificate or PDF only when that enrolment's funding is `seat` or `co_pay` from their own hospital.
- Every other id, including real ids from another user or hospital, answers 404.

**Search.**
- Nurse search and planner certificate search match their text literally and case-insensitively as a substring: `%`, `_` and `\` are ordinary characters and never widen a match.
- Nurse search matches a nurse's current display name or email.
- Planner certificate search matches the serial, the `nurse_name` of any version, or the nurse's current display name, so a renamed nurse's certificate is found under both names.

**Hospital isolation.** Every sponsor list, search, count, total, monthly report and export is computed only from the coordinator's own hospital:
- Totals and reports count only enrolments funded by that hospital (seat or co-pay).
- Search covers only nurses employed by that hospital.
- The monthly report counts certificates in state sealed, grouped by the month of `issued_on`, never by the UTC date of the sealing instant.

**Completions export.**
- The export has one row per sealed certificate funded by the hospital with `issued_on` between `from` and `to` inclusive. The header is exactly `nurse_name,nurse_email,course_title,serial,issued_on,contact_hours,funding`, and rows end with a line feed.
- Any cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a single leading apostrophe.
- Cells containing a comma, a double quote or a line break are wrapped in double quotes, with inner quotes doubled.

### Services (DP-15, DP-25, DP-27, DP-38, DP-48, DP-50, DP-54, DP-63)

**Postgres** holds every record: tenants, users, courses, versions and history, cohorts, waitlists, coverage policies and scheduled changes, enrolments, module verifications, evaluations, certificates and versions, share links, download tokens, packs and ledger entries, seat assignments, refund requests and decisions, idempotency keys and the email outbox. Seat claims, pack assignments and expiry movements, and certificate creation, reissue and revoke run in serialisable transactions. Apply the schema and seed idempotently every time the app starts.

**Kill Bill.**
- Create payer accounts on first use, in USD, with Kill Bill's built-in external payment method as their default:
  - one per nurse, with external key `credwell-nurse-<user id>`;
  - one per hospital, with external key `credwell-hospital-<hospital slug>`.
- Every charge is a PURCHASE transaction:
  - The learner share goes on the nurse's account, with payment external key `enrol-<enrolment id>-learner`.
  - The employer share goes on the hospital's account, with payment external key `enrol-<enrolment id>-employer`.
  - A pack goes on the hospital's account, with payment external key `pack-<pack id>`, for the seat count times the list price.
- Every refund is a REFUND transaction on the original payment for the refunded amount:
  - An approved refund request uses transaction external key `refund-<refund request id>-employer` or `refund-<refund request id>-learner`, reason code `refund_request` and comment `<refund request id>`.
  - A checkout rollback uses transaction external key `rollback-<enrolment id>-employer` or `rollback-<enrolment id>-learner`, reason code `checkout_rollback` and comment `<enrolment id>`.
- Every Kill Bill write, including account creation, is made as `credwell:<acting user id>`, so Kill Bill's own audit log names that user as the author of each change. The acting user is the learner for checkout and its rollback, the coordinator for packs, and the planner for refund approval.
- Amounts in Kill Bill equal the amounts in the API exactly.
- When Kill Bill is unreachable:
  - Checkout, pack purchase and refund approval answer the payments 503 and change nothing in Credwell.
  - Everything else, including seat assignment and refund decline, works.

**MinIO.**
- Certificate PDFs live at `certificates/sorrel-pike/<serial>/v<version>.pdf` with content type `application/pdf`, and are never overwritten or deleted. Each PDF prints its own version's nurse name.
- Exports live at `exports/<hospital slug>/<export id>.csv` with content type `text/csv`.
- When MinIO is unreachable:
  - The evaluation answers 202 and the certificate stays in sealing, with no email and the enrolment still completed.
  - A reissue answers 202 with the new version in sealing and `reissue_pending` true.
  - The PDF and export endpoints answer as stated in API.
  - The app retries storing every sealing version every 15 seconds, or every `CREDWELL_SEAL_RETRY_SECONDS` seconds when that variable is set, and seals it, then queues its email, as soon as the store succeeds.

**Mailpit** (SMTP).
- Every message uses the From line `Credwell Certificates <certificates@credwell.test>`. The environment provides this exact value as `MAIL_FROM`; read it from there. Every message goes to the nurse's email.
- Messages are sent from the outbox, which retries until delivered. Each event sends exactly one message, and replays and refused requests send none. The messages are:
  - **Enrolment receipt**, after a checkout is confirmed. Subject `Credwell receipt: <course title>`. The body holds the nurse's display name, course title, cohort name if any, "You paid $<learner share>", and the enrolment id.
  - **Seat invitation**, after a seat is assigned. Subject `Your Credwell seat: <course title>`. The body holds the hospital name, course title and a link to the course page.
  - **Certificate issued**, after version 1 is sealed. Subject `Your Credwell certificate: <course title>`. The body holds the version's nurse name, course title, contact hours, serial, issue date and the signed download link (`/api/certificates/<id>/pdf?token=<token>`).
  - **Certificate reissued**, after a later version is sealed. Subject `Your reissued Credwell certificate: <course title>`. The body is the same as Certificate issued, with the new version's nurse name, plus the version number, and its download link is made for the new version.
- Links in emails are absolute, built from the origin of the request that caused the email.
- No email ever links to a PDF object that does not exist yet.

### Seed data (DP-02, DP-13, DP-18, DP-20, DP-32, DP-36, DP-56, DP-59, DP-60)

Every seeded person, hospital, provider and accreditor is invented. Every seeded user's password is `credwell-demo-1`.

**Provider:** Sorrel & Pike Learning (slug `sorrel-pike`), time zone America/Chicago. Accreditation statement: "Sorrel & Pike Learning is approved as a provider of nursing continuing professional development by the Meridian Council for Nursing Education."

**Hospitals** (coverage in effect at start; neither has a scheduled change):

| Name | Slug | Coverage |
|---|---|---|
| Harbourview Regional Hospital | `harbourview` | 50.00% |
| Linden Valley Medical Center | `linden-valley` | 33.33% |

**Users:**

| Email | Name | Role | Organisation | Licence | Date of birth |
|---|---|---|---|---|---|
| planner@sorrelpike.test | Odette Marsh | planner | Sorrel & Pike Learning | | |
| author@sorrelpike.test | Felix Amari | author | Sorrel & Pike Learning | | |
| author2@sorrelpike.test | Priya Holloway | author | Sorrel & Pike Learning | | |
| coord@harbourview.test | Grace Tamura | coordinator | Harbourview Regional Hospital | | |
| coord@lindenvalley.test | Marcus Eide | coordinator | Linden Valley Medical Center | | |
| ana.ruiz@harbourview.test | Ana Ruiz | learner | Harbourview Regional Hospital | RN-4410293 | 1988-03-14 |
| ben.osei@harbourview.test | Ben Osei | learner | Harbourview Regional Hospital | RN-5520874 | 1991-07-02 |
| cara.lind@lindenvalley.test | Cara Lindqvist | learner | Linden Valley Medical Center | RN-6631055 | 1985-11-23 |
| eli.brandt@lindenvalley.test | Eli Brandt | learner | Linden Valley Medical Center | RN-8853277 | 1979-05-09 |
| dev.patel@mail.test | Dev Patel | learner | none | RN-7742166 | 1993-01-30 |

**Courses.** Every seeded course is at version 1. Lesson bodies are short invented paragraphs whose wording is up to you. Options are listed in order. The correct option's 0-based index follows the arrow.

1. **Sepsis Recognition in the First Hour**: self-paced, published, by Felix Amari, $90.00.
   - Early warning signs (20 min). "Which finding should prompt a sepsis screen?" Options: "Suspected infection with a new heart rate above 90" / "A blood pressure at the patient's usual baseline" / "A request for an extra blanket" → 0.
   - Lactate and cultures (25 min). "When are blood cultures drawn relative to antibiotics?" Options: "After the first antibiotic dose" / "Before the first antibiotic dose, without delaying it" / "Only if the lactate is normal" → 1.
   - Hour-one bundle (15 min). "What does the hour-one bundle aim to start within the first hour?" Options: "A routine chest X-ray only" / "Discharge planning" / "Antibiotics and fluid resuscitation where indicated" → 2.
   - Post-evaluation (15 min).
2. **Safe Opioid Stewardship**: cohort, published, by Priya Holloway, $140.00.
   - Pain assessment (30 min). "Which tool fits a patient who cannot self-report pain?" Options: "A behavioural pain scale" / "A 0 to 10 numeric scale" / "A sleep diary" → 0.
   - Dosing and monitoring (40 min). "Which sign is the most important warning of opioid-induced respiratory depression?" Options: "Itching" / "Increasing sedation" / "Constipation" → 1.
   - Naloxone and handoffs (30 min). "What should a handoff include for a patient on opioids?" Options: "Only the next dose time" / "The diet order" / "Last dose, sedation level and naloxone plan" → 2.
   - Post-evaluation (20 min).
   - Cohorts:
     - "Spring evening cohort": seat cap 1, starts 2030-04-06, closes 2030-04-03 (so `closes_at` is `2030-04-04T04:59:59.999Z`), no enrolments.
     - "Winter archive cohort": seat cap 20, starts 2026-01-20, closes 2026-01-15 (so `closes_at` is `2026-01-16T05:59:59.999Z` and `open` is false), no enrolments.
3. **Delirium Screening at the Bedside**: self-paced, published, by Felix Amari, $45.50.
   - Screening tools (25 min). "What does a delirium screen look for first?" Options: "An acute change or fluctuation in mental status" / "A long-standing memory complaint" / "A family history of dementia" → 0.
   - Acting on a positive screen (20 min). "After a positive delirium screen, what comes first?" Options: "Restrain the patient" / "Notify the provider and look for causes" / "Wait for the next shift's screen" → 1.
   - Post-evaluation (10 min).
4. **Wound Care Documentation Essentials**: self-paced, draft, by Felix Amari, $75.00.
   - Describing the wound bed (30 min). "Which term describes red, granular, healthy tissue?" Options: "Slough" / "Eschar" / "Granulation tissue" → 2.
   - Measuring and photographing (30 min). "How is wound length measured?" Options: "In the head-to-toe direction" / "At the widest point side to side" / "At the deepest point" → 0.
   - Post-evaluation (10 min).
5. **Pediatric Fever Triage**: self-paced, in review, by Priya Holloway, $60.00.
   - Fever thresholds by age (25 min). "Which infant with fever needs urgent evaluation?" Options: "Any infant under 28 days old" / "A 4-year-old who is drinking well" / "A 10-year-old after exercise" → 0.
   - Red flags (20 min). "Which is a red flag in a febrile child?" Options: "Playing between doses" / "A non-blanching rash" / "A runny nose" → 1.
   - Post-evaluation (5 min).

The seed has no enrolments, packs, assignments, certificates, share links, refund requests, waitlist entries or course history entries.

## Technical requirements

### Deployment (DP-01)

- The runtime is Node.js 22 with npm. The app lives at `/app`, and `/app/run.json` is its run manifest: a JSON object with the string fields `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`. For example:
  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```
- `serve` starts a single process that serves the API and the built frontend from the same origin. It binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- `GET /api/health` answers `200 {"status":"ok"}` as soon as the server listens.
- Grading also starts extra instances on other ports with one dependency pointed at an unreachable address. Each must still start and behave as Services describes.
- Grading also starts an instance with the optional time settings set to a few seconds; every expiry, window and retry must follow them exactly.

### Configuration and secrets (DP-05)

Read every value below from the environment at start:
- Postgres: `DATABASE_URL`.
- Kill Bill: `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- Port: `APP_PUBLIC_PORT`.
- Optional time settings, each in whole seconds: `CREDWELL_SEAT_EXPIRY_SECONDS`, `CREDWELL_FULL_REFUND_WINDOW_SECONDS`, `CREDWELL_SHARE_LINK_TTL_SECONDS`, `CREDWELL_DOWNLOAD_LINK_TTL_SECONDS`, `CREDWELL_SEAL_RETRY_SECONDS`.

No credential or service URL is hard-coded in source, written to the frontend bundle, or included in any API response, page or log line sent to the browser.

### Server boundary (DP-04, DP-62)

- The API is same-origin only. It sends no permissive cross-origin headers.
- A state-changing request (POST, PATCH, PUT or DELETE) whose `Origin` header is present and differs from the server's own origin gets `403 {"error":"cross_origin"}`.
- Body size and content type limits are those in API conventions.
- Every response on `/verify/<token>`, `/api/verify/<token>`, `/api/verify/<token>/pdf` and `GET /api/certificates/<id>/pdf?token=<token>`, including 404s, carries `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- The server serves only the built frontend assets and the API. It never serves source files, `run.json`, `package.json`, lockfiles, environment files or anything under the project's dependency folder; those paths answer 404.
- If Kill Bill or MinIO is unreachable at boot, the app still starts and handles the outage per request as Services describes. If Postgres is unreachable at boot, the app retries the connection every 2 seconds and does not listen until it connects.

### Browser support and performance (DP-06, DP-11)

- Support current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800.
- With healthy services, every screen is usable within three seconds of navigation, and every API call answers within two seconds.
- With a dependency unreachable, the affected call answers its 503 or 202 within ten seconds.
- Fonts are self-hosted and served by the app.

## Working rules

- IF-01: `/app/run.json` exists and holds exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, with its licence.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) uses MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or CC0-1.0, and bundled fonts use OFL-1.1.
- IF-04: The app stores data only in the provided Postgres, Kill Bill, MinIO and Mailpit services. It uses no SQLite, Redis, in-process persistent store or local files as a record store.
- IF-05: The provided service definitions and their credential values stay unchanged.
- IF-06: All application source is TypeScript. Plain JavaScript appears only in tool configuration files.
- IF-07: The running app makes no browser requests to third-party origins (no font, script or analytics CDNs).

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` escaping into domain logic and no non-null assertions papering over possible absences.
- Names in the code match the domain terms in this brief: enrolment, cohort, close instant, seat pack, seat assignment, ledger movement, coverage policy, quoted share, contact hours, certificate version, sealing, verification link, refund decision.
- Each domain rule is decided in exactly one place in the source. Examples are the coverage policy in effect at an instant, the share split, the refund amount, awarded-hours rounding, seats remaining, the cohort close instant, pack balance, expiry and sponsor totals, each state transition, the current-version rule and the name it carries, every expiry comparison, the accepted fields of each request body, and the private-field allow-list for certificate copies.
- There is no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Every API error goes through the one error shape and precedence order in API.
- Money is handled in whole cents end to end. There is no floating-point arithmetic on amounts, percentages or hours.
- There are no features, endpoints, screens or settings beyond this brief.
