# Northfold Language Access Teamseat

Teamseat is the dispatch and billing desk for Northfold Language Access, a regional agency that sends freelance ASL and spoken-language interpreters to on-site appointments at hospitals, clinics and school districts. Clinic schedulers request interpreters for patient appointments. Agency dispatchers watch weekly coverage by language and hour and release requests to qualified interpreters. Freelance interpreters claim open seats and later submit a signed verification-of-service form. The agency billing lead keeps dated rate cards and turns verified work and late cancellations into exact invoices. Client org admins decide who at their organisation can make requests, and they export a monthly statement. Postgres is the system of record. Mailpit receives every email the product sends. Kill Bill holds one billing account per client organisation and every invoice item. MinIO stores signed verification forms in a private bucket. Out of scope: self-registration, password reset, video or remote interpreting, interpreter payroll, payments, holidays, and any datastore besides Postgres and MinIO. Every person signs in with an account that is either seeded or created by an org admin.

## Problem and users

Regional interpreting agencies still dispatch from a spreadsheet, a shared inbox and a phone tree. When an ASL appointment runs longer than an hour, it needs a team of two interpreters. Agencies confirm one interpreter, lose track of the second seat, and find out when the appointment starts. If two freelancers answer the same group text, the agency books one seat twice and has to cancel one of them. Billing is rebuilt by hand from paper verification forms against contract rules: a two-hour minimum, quarter-hour increments after that, team billing for both seats, mileage beyond a free radius, and a full minimum for cancellations made inside 48 business hours. Each rule is easy to get wrong. The agency under-bills late cancellations, then spends weeks disputing them with hospital payers on net-60 terms. It also pays interpreters for seats that were never really confirmed. Meanwhile the hospital carries the federal civil-rights exposure (ACA Section 1557) whenever a Deaf or limited-English patient ends up without an interpreter.

Users:

- **Clinic scheduler** (daily) at a hospital, clinic or school district. Requests an interpreter for a patient appointment, sees that every seat is covered, and can change or cancel the request with a clear statement of any fee first.
- **Agency dispatcher** (daily). Watches coverage across languages for the coming week, releases requests to qualified interpreters, and closes gaps before they become no-shows.
- **Freelance interpreter** (daily). Claims open seats that fit their languages and calendar, gets confirmed details, and submits the signed verification form after the job.
- **Agency billing lead** (weekly). Turns verified assignments and late cancellations into exact invoices for each client organisation, and maintains dated rate cards.
- **Client org admin** (occasional). Manages which schedulers at their hospital or district can request and see assignments, and exports the monthly statement.

## Journeys

1. **Request an interpreter.** A clinic scheduler at Riverbend Valley Hospital signs in. The request list is empty and the request form is open beside it. They pick ASL, hospital, a date next week, 09:00 and 90 minutes, then type the street address, city, patient initials and a medical note. On a slow network they double-click Submit request. One request appears in the list with a new assignment number, two seats and the status "Awaiting release". A second scheduler at another organisation types that number into their own search and finds nothing.
2. **Release and watch the gap close.** The dispatcher signs in to the coverage board for the current week. The new ASL request sits in the ASL row as a capsule with two hatched lanes labelled "open", and the ASL gutter shows the uncovered time. They open the capsule, the drawer slides in from the right with the board still visible, and they release the request. Offer emails go to every ASL interpreter. Shortly after, one interpreter claims seat 1. On the dispatcher's board, without a reload, seat 1's hatch fills solid from the capsule's start edge to its end edge, the label changes to that interpreter's initials, and the ASL numeral counts down. When seat 2 is claimed, the capsule shows a check.
3. **Claim a seat, or lose it.** Two ASL interpreters both see the same request in Open seats. It shows language, setting, city and time, with no address and no patient details. Seat 1 is taken and seat 2 is the last open one. Both press Claim within the same second. One sees the seat become theirs, with the street address, patient initials, medical notes and the scheduler's phone now visible in My seats, and gets a confirmation email. The other sees "Seat already taken" and the lane stays hatched. The scheduler receives one coverage receipt.
4. **Change or cancel with clear fee consequences.** A scheduler opens a covered request for Monday 09:00 on a Friday afternoon and chooses Cancel request. Before confirming, they are told whether a late-cancellation fee applies and how much it is, worked out in Central time with the weekend skipped. They confirm. The request shows as cancelled with that fee, and the scheduler and both interpreters each get one notice saying whether a fee applies. Earlier, for a different request well ahead of time, the scheduler moved the start time. Both interpreters were freed and told no fee applies, and the request went back out as an offer.
5. **Verify after the job.** An interpreter who held a seat opens My seats and chooses Verify. They enter the actual minutes and round-trip miles and attach a photo of the signed verification form. A text file renamed as a PDF is refused. The real JPEG is accepted, and the seat shows as verified. Only they, the organisation's schedulers and agency staff can open the stored form, and only through a link that expires within a minute.
6. **Rates and invoices.** The billing lead adds a new ASL hourly rate for Riverbend Valley Hospital starting from a future date. Two verified requests sit in the billing queue: one on the day before the new rate starts and one on the first day it applies. Each shows a total computed at the rate in force on its own date. The billing lead posts both, and each turns to "Posted" with a Kill Bill invoice id. A late cancellation from Journey 4 is also in the queue and posts as one item. During a Kill Bill outage, a post shows "Queued". It changes to "Posted" by itself once Kill Bill answers again, and Kill Bill holds exactly one item for it.
7. **Manage schedulers and export the statement.** The Riverbend Valley Hospital org admin opens Schedulers, adds a new scheduler with an initial password, and removes one who has left. The removed scheduler's next sign-in fails. The admin downloads the month's statement as a CSV. It lists only Riverbend Valley Hospital's posted charges, and every total matches the Kill Bill invoice item.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Request an interpreter** A clinic scheduler fills the request form and submits it, and sees exactly one new assignment in their organisation's request list with the status label for a draft, even after a double-click or a retry after a timeout.
- **DP-02 — Request validation** POST /api/assignments creates a draft assignment with the next assignment number and rejects each invalid field with the validation error listed in API.
- **DP-03 — Team seats for long ASL requests** An ASL assignment longer than 60 minutes has two seats and every other assignment has one, both at creation and after any time change.
- **DP-04 — One request per submission** Repeating a request with the same idempotency key returns the original assignment and never creates a second one, as qualified in Business rules.
- **DP-05 — Release a request** The agency dispatcher opens a draft capsule on the coverage board, releases it from the drawer, and sees it become open for claims without leaving the board.
- **DP-06 — Seat offers on release** Releasing a draft moves it to released and sends exactly one offer email to each active interpreter qualified in its language, carrying only offer-safe fields.
- **DP-07 — Offer-safe fields** An interpreter who does not hold a seat on an assignment receives only the offer field list, and the street address, patient initials, medical notes and scheduler contact appear only while they hold or have served a seat.
- **DP-08 — Claim a seat** A freelance interpreter claims an open seat from Open seats and, only after the server confirms, sees the full appointment details under My seats.
- **DP-09 — One holder per seat** Of any number of simultaneous claims on the same open seat, exactly one succeeds and every other receives the seat-taken conflict.
- **DP-10 — Claim guards** An interpreter cannot hold two seats on one assignment or two seats that overlap in time, and cannot see or claim assignments outside their languages.
- **DP-11 — Give a seat back** A holder can give back a seat before the assignment is served, which reopens the seat and moves the assignment to the matching coverage status.
- **DP-12 — Confirmation and coverage emails** Each successful claim sends one seat-confirmation email to the claimer, and each time an assignment becomes fully covered one coverage receipt goes to its scheduler, neither carrying patient initials or medical notes.
- **DP-13 — Weekly uncovered minutes** The coverage API reports uncovered minutes per language and agency-zone week as the sum of open-seat minutes, and the board's gutter numerals show exactly those values.
- **DP-14 — Hatch Seam** Open seat lanes are hatched and labelled "open", and only after a server-confirmed claim does the lane fill, the label switch to initials, the gutter numeral count down and the check glyph appear, as qualified in Motion and effects.
- **DP-15 — Reduced motion** When the user asks for reduced motion, every motion becomes an instant change to its final state, with the same text labels and announcements.
- **DP-16 — Open seats not by colour alone** Open and covered seats differ by hatch pattern, lane label and a covered-count text on each capsule, so the board reads the same without colour.
- **DP-17 — Watch a gap close** With the board open, the dispatcher sees a seat claimed elsewhere close its gap without reloading, within the delay stated in Business rules, and a losing claimant sees the seat-taken copy with the lane still hatched.
- **DP-18 — Cancel with a fee preview** A clinic scheduler sees whether a late-cancellation fee would apply, and its amount, before confirming a cancellation, and afterwards sees the fee that was decided on the request.
- **DP-19 — Business-hour notice** Cancellation and change notice is counted in business minutes in the agency zone, Monday to Friday only, whatever the browser or server zone, and a fee applies only below 48 business hours.
- **DP-20 — Cancellation decision and notices** Cancelling fixes the fee decision at the moment of cancellation and sends one notice to the scheduler and to each seat holder stating whether a fee applies.
- **DP-21 — Change a request's time** A scheduler can move or resize a request only with at least 48 business hours of notice, and the change frees every held seat, re-offers released requests and notifies everyone affected once, with no fee.
- **DP-22 — Verify a seat** After the job, the seat's interpreter submits actual minutes, round-trip miles and the signed form from My seats, and sees the verification-received copy and the seat's verified mark from Public screens and controls.
- **DP-23 — Verification form checks** The signed-form upload accepts only PDF, JPEG or PNG content that matches its declared type and stays within the published size limit, and stores it privately in MinIO.
- **DP-24 — Private form links** A stored form is reachable only through a link that expires within 60 seconds, issued only to the seat's interpreter, the organisation's schedulers and org admin, and agency staff.
- **DP-25 — Served and verified** Verifications move an assignment to served and then to verified once every seat has one, and an assignment cannot be invoiced before it is verified.
- **DP-26 — Billable amounts** Each seat bills the greater of two hours and its actual minutes rounded up to the quarter hour, at the hourly rate in force, rounded half-up to the cent per seat line, plus mileage beyond the free radius, all in integer cents.
- **DP-27 — One invoice item per assignment** Posting a billable assignment creates exactly one Kill Bill external charge on its organisation's account for the computed total, stores the invoice id, and returns that same invoice on every repeat post.
- **DP-28 — Late-cancellation charges** A cancellation that carries a fee is billable for the two-hour minimum on every seat with no mileage, and posts like any assignment.
- **DP-29 — Queued while Kill Bill is down** When Kill Bill is unreachable, posting answers queued and the item shows as queued, then posts exactly once by itself when Kill Bill returns, with no restart.
- **DP-30 — Post invoices from the billing screen** The billing lead sees ready, queued and posted items with their totals, posts one, and sees its status and invoice id update on screen.
- **DP-31 — Dated rate cards** The billing lead adds rate entries per organisation and service line that take effect from a future date, and duplicate or non-future dates are rejected.
- **DP-32 — Rate in force on the appointment date** Every charge uses the rate entry in force on the assignment's start date in the agency zone, however late it is posted.
- **DP-33 — Manage schedulers** A client org admin adds and removes schedulers for their own organisation, and a removed scheduler can no longer sign in.
- **DP-34 — Organisation scoping** Every read, search and export is limited to the caller's organisation, and another organisation's assignment number answers exactly as a number that does not exist.
- **DP-35 — Monthly statement** A client org admin downloads a CSV of their organisation's posted charges for one month, with totals equal to the Kill Bill amounts.
- **DP-36 — Run manifest and health** The app installs, builds and serves from /app/run.json on the published port and answers the health check.
- **DP-37 — Sign-in and roles** People sign in with email and password, hold a session cookie, and reach only the screens and actions of their role.
- **DP-38 — One error shape and order** Every API error uses one JSON shape and follows the single precedence order stated in API.
- **DP-39 — Server boundary** The server accepts only same-origin writes, enforces body limits, never serves source or credentials, and boots and stays healthy while Kill Bill, Mailpit or MinIO is unreachable.
- **DP-40 — Agency time on every screen** Every date and time shown or entered is Central time (America/Chicago), whatever zone the browser is in.
- **DP-41 — Responsive layouts** Every screen works at 375x812, 768x1024 and 1280x800 with no horizontal page scrolling.
- **DP-42 — Keyboard and focus** Every control is reachable in a logical Tab order with a visible focus ring, and the drawer and dialogs close with Escape and return focus to the control that opened them.
- **DP-43 — Contrast and tap targets** Text, indicators and controls meet the contrast and size rules in Visual design.
- **DP-44 — Visual design** The product looks like a calm, accountable paper dispatch sheet as described in Visual design.
- **DP-45 — Credentials from environment** Every service URL and credential is read from the environment at start, and none is written into source or sent to the browser.

## Frontend

### Screens and layout (DP-01, DP-05, DP-08, DP-22, DP-30, DP-33, DP-40, DP-41)

Every screen except sign-in has a top bar. It shows the product name, the signed-in person's name and role, the fixed note "All times Central (Chicago)", the main navigation for that role, and a sign-out button. Every date and time on screen is shown in America/Chicago, using the form `Thu 12 Nov 09:00`, or `Thu 12 Nov 09:00–10:30` for a range, in a 24-hour clock. Date and time inputs are read as Central time whatever the browser's zone. Each role lands on its first screen after sign-in. Typed date fields (Date, Effective from) take `YYYY-MM-DD` and typed time fields take `HH:MM`.

| Path | Role | Screen |
|---|---|---|
| `/` | anyone signed out | Sign in |
| `/requests` | clinic scheduler, client org admin | Requests: request form (schedulers only) and the organisation's request list |
| `/board` | agency dispatcher | Coverage board |
| `/offers` | freelance interpreter | Open seats |
| `/my-seats` | freelance interpreter | My seats, with verification forms |
| `/billing` | agency billing lead | Billing queue and rate cards |
| `/org` | client org admin | Schedulers and monthly statement |

A signed-out visit to any path except `/` shows Sign in. A signed-in visit to a path outside the role's list redirects to that role's landing screen.

**Coverage board.** The board is a rigid 12-column dispatch sheet ruled with hairlines. Above it sit the week heading (`Week of Mon 9 Nov 2026`) and the previous-week and next-week controls. When opened, it shows the current Central-time week. The left gutter takes the first two columns and holds one row per seeded language, in seed order. Each row shows the language name and its uncovered-time numeral in `h:mm` form (for example `1:30`, `0:00`, `12:45`). To the right are seven day columns, Monday to Sunday, each running from 06:00 at its left edge to 22:00 at its right edge, with faint hour rules. Each non-cancelled assignment in the week is a horizontal capsule in its language row and day column. The capsule's left edge sits at (start minutes after 06:00) ÷ 960 of the day column's width, and its width is the duration in minutes ÷ 960 of that width, to within 2 pixels. The capsule is split horizontally into one seat lane per seat. Under the lanes it shows the assignment number and the covered-count text. Detail opens in a right-hand drawer that takes about a third of the width at 1280x800, so the board stays visible behind it. At 768x1024 and 375x812 the board shows one day at a time, chosen from a row of day tabs, and the gutter stays on the left. There the drawer becomes a full-width sheet over the board.

**Requests.** At 1280x800 the request form sits in a left column (four of twelve columns) and the request list fills the rest. At 768 and 375 the form comes first and the list below it, both full width. Each list row shows the number, language, setting, Central time range, seat lanes as small hatched or filled bars with labels, covered-count text and status label. Opening a row shows the assignment drawer: all scheduler-view fields, the seats with interpreter initials, the cancellation decision if any, and the change-time and cancel actions when they are allowed. The request list reflects server changes within 5 seconds without a reload.

**Open seats and My seats.** Each offer card shows language, setting, city, Central time range and the seat lanes with their labels. Each open lane has its own claim button. My seats lists the interpreter's held and served seats with the full holder view. Each held seat has a give-back button and a verify link, which opens the verification form in place. Once a seat's verification is stored, that seat shows the verified mark from Public screens and controls in place of the give-back button and verify link. Cards are a single column at 375 and 768, and two columns at 1280.

**Billing.** The billing queue table lists items whose billing status is ready, queued or posted: number, organisation, kind (`Service` or `Late cancellation`), Central date, total in dollars, status cell and invoice id. Below it is the rate card for a chosen organisation: a table of entries and the add-rate form. At 375 the table rows become stacked cards. The queue reflects server changes within 5 seconds without a reload.

**Schedulers and statement.** A schedulers table (name, email, phone) with a remove button per row, the add-scheduler form, and the monthly-statement form.

No screen scrolls horizontally at 375x812, 768x1024 or 1280x800.

### Public screens and controls (DP-01, DP-05, DP-08, DP-14, DP-16, DP-18, DP-22, DP-30, DP-33, DP-37, DP-42)

Only these roles and names are public. Everything else is free. `<number>` is an assignment number such as `A-1001`. `<n>` is a seat number (1 or 2). `<Language>` is the seeded language name.

| Region or control | Role and accessible name | Visible copy |
|---|---|---|
| Sign-in form | `form "Sign in"` with `textbox "Email"`, `textbox "Password"` (password field), `button "Sign in"` | Sign in |
| Main navigation | `navigation "Main"` with links `Requests`, `Board`, `Open seats`, `My seats`, `Billing`, `Schedulers` (only the role's own) | as named |
| Sign out | `button "Sign out"` | Sign out |
| Request form | `form "Request an interpreter"` with `combobox "Language"`, `combobox "Setting"`, `textbox "Date"`, `textbox "Start time"`, `spinbutton "Duration (minutes)"`, `textbox "Street address"`, `textbox "City"`, `textbox "Patient initials"`, `textbox "Medical notes"`, `button "Submit request"` | Submit request |
| Request list | `table "Requests"`; search `searchbox "Search requests"`; each row has `button "Open <number>"` | status labels below |
| Assignment drawer | `dialog "Assignment <number>"` with `button "Close"` | Close |
| Release | `button "Release to interpreters"` (dispatcher, draft only) | Release to interpreters |
| Change time | `button "Change time"`, opening `dialog "Change time for <number>"` with Date, Start time, Duration (minutes) fields and `button "Save new time"` | Change time / Save new time |
| Cancel | `button "Cancel request"`, opening `dialog "Cancel <number>"` with the fee preview text, `button "Confirm cancellation"` and `button "Keep request"` | as named |
| Coverage board | `region "Coverage board"`; week heading `heading "Week of <Ddd D Mon YYYY>"`; `button "Previous week"`, `button "Next week"`; below 1024 pixels wide `tablist "Days"` with one `tab` per day (`Mon 9`) | as named |
| Language row | `group "<Language>"` containing `group "<Language> uncovered"`, whose text is the `h:mm` numeral | `<Language>`, `h:mm` |
| Capsule | `button` whose name starts with `<number>`, followed by the time range and covered-count text | `<covered> of <seats> covered` |
| Seat lane | `group "Seat <n>"` inside a capsule or offer card | `open`, or the holder's initials such as `R.M.` |
| Full-coverage mark | `img "All seats covered"` inside a capsule | check glyph |
| Open seats | `list "Open seats"`; per open lane `button "Claim seat <n> on <number>"` | Claim seat <n> |
| My seats | `list "My seats"`; per held seat `button "Give back seat <n> on <number>"` and `link "Verify seat <n> on <number>"`; per served seat the verified mark, the text `Seat <n> verified`, with `link "View signed form"` | Give back / Verify / Seat <n> verified |
| Verification form | `form "Verify seat <n> on <number>"` with `spinbutton "Actual minutes"`, `spinbutton "Round-trip miles"`, file input labelled `Signed verification form`, `button "Submit verification"`; once stored, `link "View signed form"` | as named |
| Billing queue | `table "Billing queue"`; per ready row `button "Post invoice for <number>"` | status cell `Ready`, `Queued` or `Posted` |
| Rate card | `combobox "Organisation"`, `table "Rate card"`, `form "Add rate"` with `combobox "Service line"`, `textbox "Effective from"`, `textbox "Hourly rate (dollars)"`, `textbox "Mileage (cents per mile)"`, `button "Add rate"` | as named |
| Schedulers | `table "Schedulers"`; per row `button "Remove <name>"`; `form "Add scheduler"` with `textbox "Name"`, `textbox "Email"`, `textbox "Phone"`, `textbox "Initial password"`, `button "Add scheduler"` | as named |
| Statement | `form "Monthly statement"` with `textbox "Month"` (YYYY-MM) and `button "Download statement"` | as named |
| Live regions | `status` regions named in Feedback states | — |

Status labels shown for assignment statuses: draft `Awaiting release`, released `Open`, partially_covered `Partly covered`, covered `Covered`, served `Served`, verified `Verified`, invoiced `Invoiced`, cancelled `Cancelled`.

### Interactions (DP-05, DP-08, DP-17, DP-18, DP-21, DP-22, DP-40, DP-42)

- **Sign in.** Enter submits the form. On success the person lands on their role's first screen.
- **Submit request.** The first press disables Submit request until the server answers, so a double-click sends one request. The form keeps the same idempotency key across retries until a success arrives. Resubmitting after a timeout or network error therefore returns the original request. After success the form clears, a fresh key is made for the next request, and the new row appears at the top of the list.
- **Open a capsule or row.** Click, tap, Enter or Space opens the assignment drawer. Focus moves to the drawer heading. The board or list stays visible and scrollable behind it at 1280 wide. Escape or Close closes the drawer and returns focus to the capsule or row button that opened it. Opening another capsule while the drawer is open swaps the drawer's content.
- **Release.** In the drawer, Release to interpreters sends the release. The capsule's lanes stay hatched and labelled `open`, and the status label becomes `Open`.
- **Week and day navigation.** Previous week and Next week load the adjacent week. Day tabs follow the usual tab pattern: arrow keys move between days, and Home and End jump to Monday and Sunday.
- **Claim.** Pressing Claim seat <n> disables that button and shows the pending copy. The lane is not filled until the server confirms the claim. On success the lane fills (see Motion and effects), the card moves to My seats, and the full details appear. On a seat-taken answer the lane stays hatched and labelled `open` until the next refresh shows the winner's initials, and the loss copy appears on the card.
- **Board refresh.** The board, request list, open-seat list and billing queue pick up server changes within the refresh delay stated in Business rules, with no reload. A change found this way plays the same Hatch Seam sequence as one the viewer caused. Screens learn of these changes by polling the API, never through a held-open stream or socket.
- **Change time.** Change time opens its dialog prefilled in Central time. Save new time sends the change. On a late-change refusal, the dialog stays open and shows that copy.
- **Cancel.** Cancel request opens the cancel dialog. It fetches the fee preview from the server and shows it before Confirm cancellation is enabled. Confirm sends the cancellation. The drawer then shows the decision the server returned, which may differ from the preview if the boundary passed in between. Keep request or Escape closes the dialog with no change.
- **Verify.** Choosing a file does not upload it. Submit verification sends the minutes, miles and file together. View signed form asks for a fresh short-lived link and opens it in a new tab.
- **Post invoice.** Post invoice for <number> disables itself while pending. Afterwards the status cell shows `Posted` and the invoice id, or `Queued`.
- **Keyboard order.** Top bar, then navigation, then the screen's main controls in reading order, then the drawer while it is open. Every control shows a clearly visible focus ring, an ink-coloured outline with a gap so it stands off the control. Dialogs keep focus inside until they are closed.
- **Touch.** Every control is tappable. No action depends on hover, and hover only darkens rules and controls slightly.

### Visual design (DP-16, DP-43, DP-44)

- **Mood.** Accountable, calm and legible, like a well-kept paper dispatch sheet. Every number is set in tabular monospace figures with its unit beside it (`1:30 h`, `$343.00`, `52 mi`, `120 min`), so columns of figures line up.
- **Colour roles.** The page ground is warm paper, a slightly creamy off-white. Text and controls are a near-black ink. Grid lines and dividers are a warm mid-grey rule colour, hairline thin. Open, uncovered seats use a deep burnt orange-red gap colour. Covered seats use a deep forest green. Colour never carries meaning alone. Open lanes also carry diagonal hatching and the word `open`. Covered lanes are solid and carry initials. Every capsule carries its covered-count text. Status cells always carry their word. There are no gradients and no shadows anywhere. Layers are separated by rules and paper tone.
- **Type.** Headings use Archivo, a sturdy, slightly condensed grotesque, set firmly. Body text uses Atkinson Hyperlegible, a typeface designed for low-vision readers, at a comfortably large size (about 17 pixels, never smaller) with one-and-a-half line spacing. Each heading level is about one-fifth larger than the level below it. Both families are served from the app's own origin.
- **Density.** Comfortable: generous row height on the board so a two-lane capsule is easy to read and tap. Spacing follows a steady small step throughout.
- **Composition.** A rigid 12-column sheet with hairline rules. The language gutter on the left holds names and large uncovered-time numerals. Day columns run 06:00 to 22:00. Capsules are horizontal bars split into seat lanes. Detail opens in a right-hand drawer over the sheet.
- **Hatching.** Open lanes are drawn with stripes at 45 degrees in the gap colour on paper. The stripes are clearly visible at every viewport. The `open` label sits on a small paper-coloured chip so it stays readable over the stripes.
- **Contrast and size.** Body and label text meet WCAG 2.2 AA: at least 4.5:1 against what is directly behind it (3:1 for text at 24 pixels or larger, or bold at 19 pixels or larger). The gap and covered fills, focus rings and control borders reach at least 3:1 against the paper. Every interactive control is at least 44 by 44 pixels.

### Motion and effects (DP-14, DP-15, DP-17)

Motion only ever reports a confirmed change. It starts quickly and settles softly. No motion runs before the server has answered, and nothing loops or animates for decoration.

- **Drawer and dialogs.** The drawer slides in from the right edge and settles in about a third of a second, and slides back out in the same time when closed. Dialogs fade in over about a fifth of a second.
- **Press feedback.** Buttons darken immediately on press, with no delay.
- **Hatch Seam (signature).** When the board, an offer card or the request list learns from the server that a seat moved from open to held, it plays these steps in order:
  1. The seat lane's hatching is replaced by solid covered fill. The fill sweeps from the capsule's start-time edge (left) to its end-time edge (right), growing from 0% to 100% of the lane's width over just under half a second (between 0.4 and 0.6 seconds).
  2. When the sweep completes, the lane label changes from `open` to the holder's initials.
  3. Then the row's gutter numeral counts from its previous value to the server's new uncovered value over about a third of a second (between 0.25 and 0.45 seconds). It ends exactly on the server value.
  4. If every seat is now held, the capsule's check glyph appears and its covered-count text updates.
  The sequence never starts on the claim press itself, only on the server's success answer or on a refresh that shows the change. A losing claim plays nothing. When a seat goes the other way (given back, or freed by a time change), the steps run in reverse order: the check glyph goes, the numeral counts up, the label returns to `open`, and the fill draws back from the end-time edge to the start-time edge to show the hatching again, over the same durations.
- **Reduced motion.** When the operating system asks for reduced motion, the drawer and dialogs appear and disappear at once. In the Hatch Seam, the fill, label, numeral, count text and check glyph all change at once to their final values. The hatching and text labels are the same as with motion on, so the state reads the same either way. The board-update announcement in Feedback states is made in both modes.

### Feedback states (DP-01, DP-08, DP-14, DP-17, DP-18, DP-20, DP-22, DP-29, DP-30, DP-31, DP-33)

Every async action shows its pending, success, error and outage state as visible text inside the named polite `status` region next to it. Field errors also appear under the field they belong to, linked to it as its description. `<fee>` and `<total>` are amounts in dollars with two decimals and comma thousands separators, for example `$1,343.00`. `<h> h <mm> m` writes minutes as whole hours and two-digit minutes.

| Action | Live region | Pending | Success | Errors and outage |
|---|---|---|---|---|
| Sign in | `status "Sign-in status"` | `Signing in…` | (lands on role screen) | wrong email or password: `Email or password is wrong.` |
| Submit request | `status "Request status"` | `Submitting…` | `Request <number> submitted. Awaiting release by dispatch.` | validation: `Check the highlighted fields.` plus each field's message from the API; key conflict: `This request was already submitted with different details. Reload to see it.`; network failure or timeout: `Couldn't reach Teamseat. Your request is safe to submit again.` |
| Release | `status "Release status"` | `Releasing…` | `Released. Offers going out to <count> qualified interpreters.` | conflict: `This request has already been released or closed.` |
| Claim | `status "Claim status"` | `Claiming…` | `Seat <n> on <number> is yours. Details are in My seats.` | seat taken: `Seat already taken`; already holding: `You already hold a seat on this request.`; overlap: `This overlaps a seat you already hold.` |
| Give back | `status "Claim status"` | `Giving back…` | `Seat <n> on <number> given back.` | conflict: `This seat can no longer be given back.` |
| Board update | `status "Board updates"` | — | per seat that becomes covered: `<Language>, <Ddd D Mon>: seat <n> covered by <initials>, <h> h <mm> m uncovered this week`; per seat that reopens: `<Language>, <Ddd D Mon>: seat <n> open, <h> h <mm> m uncovered this week` | refresh failure: `Board not updating. Retrying…` (shown until a refresh succeeds) |
| Cancel preview | `status "Cancellation status"` | `Checking fee…` | fee: `Cancelling now gives <h> h <mm> m of business-hour notice, under 48 business hours. A late-cancellation fee of <fee> applies.`; no fee: `Cancelling now gives at least 48 business hours of notice. No fee applies.` | — |
| Confirm cancellation | `status "Cancellation status"` | `Cancelling…` | `Request <number> cancelled. Fee: <fee>.` or `Request <number> cancelled. No fee.` | conflict: `This request can no longer be cancelled.` |
| Change time | `status "Change status"` | `Saving…` | `Request <number> moved. Seats reopened, no fee.` | late: `Less than 48 business hours' notice. This request can only be cancelled now.`; validation as for Submit request |
| Submit verification | `status "Upload status"` | `Uploading…` | `Verification for seat <n> received.` | wrong type: `Upload a PDF, JPEG or PNG file.`; too large: `The file is larger than 5,000,000 bytes.`; MinIO down: `File storage is unavailable. Your form was not saved. Try again shortly.` |
| Post invoice | `status "Billing status"` | `Posting…` | posted: `Posted to Kill Bill as invoice <invoice id>.`; queued: `Queued. Kill Bill is unreachable, and this will post automatically when it returns.` | not billable: `This item is not ready to invoice.` |
| Add rate | `status "Rate status"` | `Saving…` | `Rate from <Ddd D Mon YYYY> saved.` | duplicate: `A rate already starts on that date.`; validation as returned |
| Add or remove scheduler | `status "Scheduler status"` | `Saving…` | `<name> can now request interpreters.` / `<name> no longer has access.` | email taken: `That email is already in use.`; validation as returned |

The loss copy for a claim also appears as text on the offer card itself, beside the lane that stayed hatched.

## Backend

### API (DP-02, DP-07, DP-09, DP-10, DP-11, DP-13, DP-18, DP-20, DP-21, DP-23, DP-24, DP-26, DP-27, DP-29, DP-31, DP-33, DP-34, DP-35, DP-37, DP-38)

All endpoints live under the app's origin. Request bodies are `application/json` (any other type on a JSON endpoint answers `415`), except the verification upload, which is `multipart/form-data`. JSON bodies may be at most 65,536 bytes. Exactly 65,536 is allowed, and anything larger answers `413`. Responses are JSON unless stated. Money is always integer cents. Times are ISO 8601 with the Central-time offset (`2026-11-12T09:00:00-06:00`). Input times may carry any offset and are converted.

**Error shape.** Every error is `{"error":{"code":"<code>","message":"<text>","fields":{"<field>":"<text>"}}}`. `fields` is present only for `422`. Codes: `cross_origin` 403, `payload_too_large` 413, `unsupported_media_type` 415, `unauthenticated` 401, `invalid_credentials` 401, `not_found` 404, `forbidden` 403, `idempotency_key_required` 400, `idempotency_conflict` 409, `invalid_transition` 409, `seat_taken` 409, `already_holding` 409, `calendar_conflict` 409, `late_change` 409, `already_verified` 409, `not_billable` 409, `duplicate_rate` 409, `email_taken` 409, `validation` 422, `storage_unavailable` 503.

**Precedence (whole API).** Checks run in this order, and the first failure answers:
1. a state-changing request from a foreign origin (403 `cross_origin`);
2. body size (413), then content type (415);
3. no valid session (401);
4. a resource that is unknown, belongs to another organisation, or is invisible to the caller's role (404);
5. a role not allowed to perform this action on a resource it can see (403);
6. a missing or malformed idempotency key (400), then an idempotent replay, which returns its stored response before any later check, or a key conflict (409);
7. state conflicts (409);
8. validation (422).

Endpoint rows below list only their own extra errors.

**Roles.** `scheduler`, `org_admin`, `dispatcher`, `billing_lead`, `interpreter`. "Agency staff" means dispatcher and billing lead.

**Assignment views (field lists, exact keys).**
- Offer view (interpreter without a seat on it): `number, status, language, setting, city, start_at, end_at, duration_minutes, seats[{seat, status}]`.
- Holder view (interpreter holding or having served a seat on it): the offer view plus `street_address, patient_initials, medical_notes, scheduler{name, phone}`, with seats as `seats[{seat, status, interpreter_initials}]`.
- Organisation view (scheduler and org admin of the owning organisation): `number, status, language, setting, city, start_at, end_at, duration_minutes, street_address, patient_initials, medical_notes, scheduler{name, phone}, seats[{seat, status, interpreter_initials}], cancellation, billing`.
- Staff view (agency staff): the organisation view plus `org{code, name}`, with seats as `seats[{seat, status, interpreter_initials, interpreter_name}]`.

`language` is the seeded code. `seats[].status` is `open`, `held` or `served`. `interpreter_initials` is null for an open seat. `cancellation` is null or `{"cancelled_at","fee_applies","business_minutes_notice","fee_cents"}`. `billing` is `{"status":"none"|"ready"|"queued"|"posted","invoice_id":null|"<id>","total_cents":null|<int>}`.

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `POST /api/session` | anyone | `{"email","password"}` | `200 {"user":{"id","name","role","initials","org":{"code","name"}\|null}}`; sets HttpOnly, SameSite=Lax cookie `teamseat_session` | `401 invalid_credentials` (also for removed schedulers) |
| `DELETE /api/session` | signed in | — | `204` | — |
| `GET /api/me` | signed in | — | `200` same body as sign-in | — |
| `POST /api/assignments` | scheduler | header `Idempotency-Key` (1–100 printable ASCII characters, space through tilde); body `{"language","setting","start_at","duration_minutes","street_address","city","patient_initials","medical_notes"}` | `201` organisation view, status `draft`; a replay answers `201` with the stored body and header `Idempotent-Replay: true` | `400 idempotency_key_required` when the header is missing, empty, over 100 characters, or contains any character outside printable ASCII; `409 idempotency_conflict`; `422` field errors: `language` not a seeded code; `setting` not `hospital`, `clinic` or `school`; `start_at` not a valid time, less than 60 minutes after now, more than 365 days after now, or not on a quarter hour in Central time; `duration_minutes` not an integer from 30 to 480 in steps of 15; `start_at` before 06:00 or end after 22:00 on the same Central-time day; `street_address` empty or over 200 characters; `city` empty or over 80; `patient_initials` not 2 or 3 capital letters A–Z; `medical_notes` over 1,000 characters (optional, default empty) |
| `GET /api/assignments?q=<text>` | scheduler, org admin, agency staff | optional `q` matches number or city, case-insensitive | `200 {"assignments":[…]}` in the caller's view, soonest start first; schedulers and org admins see only their organisation | — |
| `GET /api/assignments/{number}` | any role that can see it | — | `200` caller's view | — |
| `PATCH /api/assignments/{number}` | scheduler | any of `{"start_at","duration_minutes","street_address","city","medical_notes"}` | `200` organisation view | `409 invalid_transition`; `409 late_change`; `422` as for creation |
| `POST /api/assignments/{number}/release` | dispatcher | `{}` | `200 {"assignment":<staff view>,"offers_sent":<count>}` | `409 invalid_transition` |
| `GET /api/offers` | interpreter | — | `200 {"offers":[…]}` offer views of released and partially covered assignments in the caller's languages that start in the future, soonest first | — |
| `GET /api/my-seats` | interpreter | — | `200 {"assignments":[…]}` holder views of assignments where the caller holds or served a seat, including ones cancelled while held | — |
| `POST /api/assignments/{number}/seats/{seat}/claim` | interpreter | `{}` | `200` holder view | unknown seat `404`; `409 seat_taken`; `409 already_holding`; `409 calendar_conflict` (checked in that order) |
| `POST /api/assignments/{number}/seats/{seat}/give-back` | interpreter | `{}` | `200` offer view | not the caller's seat `403`; `409 invalid_transition` |
| `GET /api/assignments/{number}/cancellation-quote` | scheduler | — | `200 {"fee_applies":bool,"business_minutes_notice":<int>,"fee_cents":<int>}` (`fee_cents` 0 when no fee) | `409 invalid_transition` |
| `POST /api/assignments/{number}/cancel` | scheduler | `{}` | `200` organisation view with `cancellation` filled | `409 invalid_transition` |
| `POST /api/assignments/{number}/seats/{seat}/verification` | interpreter holding that seat | multipart fields `actual_minutes` (integer 1–960), `round_trip_miles` (integer 0–1,000), `form` (one file) | `201` holder view, seat `served` | not the caller's seat `403`; `409 already_verified`; `409 invalid_transition`; `413 payload_too_large` when `form` exceeds 5,000,000 bytes (exactly 5,000,000 is allowed) or the whole body exceeds 5,100,000 bytes; `422` fields `actual_minutes`, `round_trip_miles`, `form`; `503 storage_unavailable` |
| `GET /api/assignments/{number}/seats/{seat}/verification-link` | that seat's interpreter, the organisation's schedulers and org admin, agency staff | — | `200 {"url":"/files/<token>","expires_in_seconds":60}` | no form stored yet `404` |
| `GET /files/{token}` | the session that asked for the link | — | `200` the file bytes with its stored content type, `Content-Disposition: attachment`, `Cache-Control: no-store` | expired, unknown, or another session's token: `404` |
| `GET /api/coverage?week=<YYYY-MM-DD>` | dispatcher | `week` is a Monday | `200 {"week_start","languages":[{"code","name","uncovered_minutes","assignments":[{"number","status","org_code","setting","start_at","end_at","duration_minutes","seats":[{"seat","status","interpreter_initials"}]}]}]}`, with every seeded language in seed order, even when empty | `422` field `week` |
| `GET /api/assignments/{number}/charges` | billing lead | — | `200 {"number","kind":"service"\|"late_cancellation","rate":{"effective_from","hourly_rate_cents","mileage_cents_per_mile"},"lines":[{"seat","actual_minutes","billable_minutes","amount_cents","round_trip_miles","billable_miles","mileage_cents"}],"total_cents"}` | `409 not_billable` |
| `POST /api/assignments/{number}/invoice` | billing lead | `{}` | `201 {"billing":{…}}` when posted now; `200` same body when it was already posted; `202 {"billing":{"status":"queued",…}}` when queued now or already queued | `409 not_billable` |
| `GET /api/billing/queue` | billing lead | — | `200 {"items":[{"number","org_code","kind","start_at","total_cents","billing":{…}}]}` for every assignment whose billing status is ready, queued or posted, soonest start first | — |
| `GET /api/rate-cards?org=<code>` | billing lead | — | `200 {"entries":[{"org","service_line","effective_from","hourly_rate_cents","mileage_cents_per_mile"}]}` oldest first | unknown org `404` |
| `POST /api/rate-cards` | billing lead | `{"org","service_line":"asl"\|"spoken","effective_from":"YYYY-MM-DD","hourly_rate_cents","mileage_cents_per_mile"}` | `201` the entry | unknown org `404`; `409 duplicate_rate`; `422`: `effective_from` not later than today in Central time; `hourly_rate_cents` not an integer from 1 to 1,000,000; `mileage_cents_per_mile` not an integer from 0 to 1,000 |
| `GET /api/org/schedulers` | org admin | — | `200 {"schedulers":[{"id","name","email","phone"}]}` active schedulers of the caller's organisation | — |
| `POST /api/org/schedulers` | org admin | `{"name","email","phone","password"}` | `201` the scheduler | `409 email_taken`; `422`: name 1–80 characters, valid email, phone 7–20 characters, password at least 12 characters |
| `DELETE /api/org/schedulers/{id}` | org admin | — | `204` | another organisation's id `404` |
| `GET /api/org/statement?month=<YYYY-MM>` | org admin | — | `200 text/csv` described in Business rules | `422` field `month` |
| `GET /api/health` | anyone | — | `200 {"status":"ok"}` | — |

### Business rules (DP-03, DP-04, DP-06, DP-09, DP-10, DP-11, DP-13, DP-17, DP-19, DP-20, DP-21, DP-25, DP-26, DP-27, DP-28, DP-29, DP-32, DP-34, DP-35, DP-37)

**Agency zone.** Every business-time rule uses America/Chicago: week boundaries, dates, rate effective dates, day columns and notice counting.

**Assignment numbers.** Numbers are `A-` followed by a sequence shared across all organisations, starting at `A-1001`. They are deliberately guessable, and scoping must not depend on them being secret.

**Seats.** An assignment in language `asl` with `duration_minutes` over 60 has two seats (a team). Every other assignment, including ASL at exactly 60 minutes, has one. Seat count is set at creation and recomputed whenever the time changes.

**Assignment states.** `draft → released → partially_covered → covered → served → verified → invoiced`, plus `cancelled`.
- Create: makes a `draft`, with all seats `open`.
- Release (dispatcher): `draft → released` only. Any other status answers 409 `invalid_transition`.
- Claim (interpreter): allowed only on `released` or `partially_covered`. The status becomes `covered` when no seat is left open, otherwise `partially_covered`. A claim on a held or served seat, or on an assignment in any other status, answers 409 `seat_taken`.
- Give back (holder): allowed only while the assignment is `partially_covered` or `covered` and the seat is `held`. The seat becomes `open`, its history records a `released_back` hold, and the status becomes `released` when no seat is held, otherwise `partially_covered`. Otherwise 409 `invalid_transition`.
- Time change: allowed only while the assignment is `draft`, `released`, `partially_covered` or `covered`, and only with at least 48 business hours of notice before the current start, measured when the change arrives. Otherwise 409 `late_change` (or 409 `invalid_transition` for other statuses). Every held seat becomes `open`, and the seat count is recomputed. A `draft` stays `draft`. Any other allowed status returns to `released` and is offered again. Edits to address, city or notes alone are allowed in the same statuses with no notice rule, keep the holders, and send no email.
- Verification (holder): allowed only while the assignment is `covered` or `served` and the caller's seat is `held`. A second verification for a seat answers 409 `already_verified`. Any other case answers 409 `invalid_transition`. The seat becomes `served`. The assignment becomes `verified` when every seat is served, otherwise `served`. The server does not compare the verification time with the appointment clock.
- Invoice: allowed for `verified` assignments and for cancelled assignments that carry a fee. A posted invoice moves `verified → invoiced`. A cancelled one stays `cancelled`. Anything else answers 409 `not_billable`.
- Cancel (scheduler): allowed from `draft`, `released`, `partially_covered` and `covered`. Otherwise 409 `invalid_transition`.

Billing status is `none`, then `ready` once billable, then `queued` or `posted`.

**Visibility.** Schedulers and org admins see only their own organisation's assignments. Agency staff see all. An interpreter sees an assignment in the offer view when it is `released`, `partially_covered` or `covered` and its language is one of theirs, and in the holder view while they hold or have served a seat on it. Anything else is 404 to them. A losing claimant on a just-covered assignment therefore gets 409 `seat_taken`, not 404.

**Idempotent requests.** Idempotency keys are scoped to the scheduler who sent them and kept for at least 24 hours. A repeat of a stored key with the same body returns the stored 201 response and creates nothing. A repeat with a different body answers 409 `idempotency_conflict`. Any number of concurrent requests with the same key and body create exactly one assignment. Each of them answers with the original 201 or its replay.

**Concurrency.** Of any number of simultaneous claims on the same open seat, exactly one succeeds and every other answers 409 `seat_taken`. An interpreter may hold at most one seat on an assignment (409 `already_holding`). They may not hold seats on two non-cancelled assignments whose time ranges overlap, where touching end and start times do not count as overlap (409 `calendar_conflict`). Two simultaneous claims by one interpreter that would break either rule leave exactly one hold. A give-back racing a cancellation ends in exactly one of the two outcomes.

**Refresh delay.** Every screen that shows server state (board, request list, open seats, my seats, billing queue) reflects a server change within 5 seconds without a reload.

**Business-minute notice.** Notice is the number of whole elapsed minutes between the moment the server receives the cancel or change and the assignment's start, counting only minutes that fall on a Monday, Tuesday, Wednesday, Thursday or Friday in Central time. Saturday and Sunday minutes do not count, and no holidays are skipped. A notice under 2,880 business minutes (48 business hours) is late. Exactly 2,880 is not late.

**Cancellation fee.** Cancelling a `draft` never carries a fee. Cancelling a `released`, `partially_covered` or `covered` assignment with late notice carries a fee. The fee is the two-hour minimum for every seat on the assignment, at the hourly rate in force on its start date. The decision, the notice in business minutes and the fee are fixed at the moment the cancellation is recorded and never change afterwards. The quote endpoint makes the same calculation for "now" without recording anything. For example, with Central time, a cancellation received at 15:00 on a Friday for a Monday 09:00 start has 18 h (1,080 business minutes) of notice: 540 minutes from Friday 15:00 to midnight plus 540 minutes from Monday 00:00 to 09:00. That is under 2,880, so it carries the fee even though it is 66 hours ahead.

**Charges.** Every billable item is computed from the rate card entry for the assignment's organisation and service line (`asl` for ASL, `spoken` for every other language) with the latest `effective_from` on or before the assignment's start date in Central time. The time it is posted makes no difference.
- Service seat line: `billable_minutes` = the greater of 120 and `actual_minutes` rounded up to the next multiple of 15. `amount_cents` = `hourly_rate_cents` × `billable_minutes` ÷ 60, rounded half-up to a whole cent, once per seat line.
- Mileage per seat: the free radius is 20 miles, so the first 40 round-trip miles are free. `billable_miles` = the greater of 0 and `round_trip_miles` − 40. `mileage_cents` = `billable_miles` × `mileage_cents_per_mile`.
- Late cancellation: one line per seat with `actual_minutes` null, `billable_minutes` 120, `amount_cents` as above, and miles and mileage 0.
- `total_cents` = the sum of every line's `amount_cents` and `mileage_cents`. The stored total, the API total, the Kill Bill amount and the statement total are the same number.

For example, with the seed data at start: a Riverbend Valley Hospital ASL team assignment served for 47 minutes, with 52 and 30 round-trip miles, bills 120 minutes per seat at 8,575 cents an hour. That gives 17,150 + 17,150 cents, plus 12 billable miles × 70 = 840 cents, for a total of 35,140 cents. A spoken assignment served 133 minutes bills 135 minutes: 6,550 × 135 ÷ 60 = 14,737.5, rounded half-up to 14,738 cents.

**Rate cards.** Entries are added, never edited or deleted. The pair (organisation, service line, effective date) is unique (409 `duplicate_rate`). A new entry's effective date must be later than today in Central time.

**Posting.** Each billable assignment produces exactly one Kill Bill invoice item, whatever the number of post requests, retries, concurrent posts or outages. Once Kill Bill accepts the item, the billing status becomes `posted` and the Kill Bill invoice id is stored on the assignment.

**Queued posting.** If Kill Bill cannot be reached when a post is requested, the billing status becomes `queued` and the post answers 202. The server retries queued items in the background every `BILLING_RETRY_SECONDS` seconds (default 10) until they post. No restart and no second click is needed, and no second item is created.

**Uncovered minutes.** For a language and a Central-time week (Monday 00:00 to the next Monday 00:00), `uncovered_minutes` is the sum of `duration_minutes` × (number of `open` seats) over that language's assignments in status `draft`, `released` or `partially_covered` that start in that week. Cancelled assignments are never counted. The board's gutter numeral shows the same value as `h:mm`.

**Statement.** The CSV has the header line `number,date,kind,language,setting,seats,billable_minutes,mileage_cents,total_cents,invoice_id`, followed by one row per assignment of the caller's organisation whose start date in Central time falls in the month and whose billing status is `posted`, soonest first. `date` is `YYYY-MM-DD`. `kind` is `service` or `late_cancellation`. `language` is the seeded name. `billable_minutes` and `mileage_cents` are summed over seats. No patient initials, notes or addresses appear.

**Sessions and roles.** A session lasts `SESSION_TTL_SECONDS` seconds (default 43,200). Removing a scheduler ends their sessions at once, and their next sign-in answers 401. Their past assignments stay visible to their organisation.

### Services (DP-06, DP-12, DP-20, DP-21, DP-23, DP-24, DP-27, DP-29, DP-39)

**Postgres** holds organisations, people and roles, interpreter languages, assignments, seats and holds, idempotency records, dated rate cards, cancellation decisions, verification metadata, billing status and invoice ids, the email outbox, and an audit row for every fee-bearing change (cancellation decisions, rate entries, posts). The app applies its schema and seed data idempotently every time it starts serving.

**Mailpit.** Every email is sent from `MAIL_FROM` and goes once per event, even when requests are retried or replayed. No email ever contains patient initials or medical notes. Offer emails also leave out the street address and scheduler phone. Language and times are written as on screen.

| Event | Recipient | Subject |
|---|---|---|
| Release, and re-offer after a time change of a released request | each active interpreter qualified in the language, one email each | `Open seat <number>: <Language>, <Ddd D Mon HH:MM>` |
| Successful claim | the claiming interpreter | `Seat <n> confirmed on <number>` (body includes street address, city, time range and the scheduler's name and phone) |
| Assignment becomes covered (each time) | the scheduler who created it | `<number> is fully covered` (body lists each seat's interpreter initials) |
| Cancellation | the creating scheduler and each interpreter holding a seat at that moment | `<number> cancelled — fee applies` or `<number> cancelled — no fee`; the body states `A late-cancellation fee of <fee> applies.` or `No fee applies.` |
| Time change | the creating scheduler and each interpreter whose seat was freed | `<number> changed — no fee`; the body states the new Central time range and `No fee applies.` |

If SMTP is unreachable, the action still succeeds. The email waits in the outbox and is sent within 30 seconds after SMTP answers again, still exactly once.

**Kill Bill.** One account per client organisation in the configured tenant, with external key `teamseat-<org code>` (for example `teamseat-RVH`), the organisation name and currency USD. It is created the first time it is needed. Each billable assignment becomes exactly one external charge on that account, of `total_cents` ÷ 100 USD, with description `<number> service` or `<number> late cancellation`. The returned invoice id is stored on the assignment. When Kill Bill is unreachable, posting behaves as stated under queued posting, and the billing queue shows the queued copy from Feedback states.

**MinIO.** Each accepted verification form is stored in the private bucket `S3_BUCKET` under `verifications/<number>/seat-<n>/<random>.<pdf|jpg|png>`. The uploaded file name is never used in the key. A rejected upload stores nothing. The type is judged by content: a PDF starts with `%PDF-`, a JPEG with the bytes FF D8 FF, and a PNG with the standard 8-byte PNG signature. The part's declared content type must be `application/pdf`, `image/jpeg` or `image/png`, and it must match the content, otherwise 422 on `form`. SVG, HTML and every other type are refused. Objects are never publicly readable and are reached only through `/files/<token>` links. When MinIO is unreachable, the upload answers 503 `storage_unavailable` and nothing changes. Links for stored forms answer the same 503 while it is down.

### Seed data (DP-34, DP-37)

Every person, organisation, address, phone number and email address below is invented. Every seeded account's password is `Teamseat-demo-2026`. At start there are no assignments, no invoices and no stored forms, and the next assignment number is `A-1001`.

Languages, in board order: `asl` ASL, `es` Spanish, `vi` Vietnamese, `so` Somali, `ar` Arabic.

Client organisations:

| Code | Name |
|---|---|
| RVH | Riverbend Valley Hospital |
| CPSD | Cedar Prairie School District |
| LFC | Lakeview Family Clinic |

People:

| Name | Email | Role | Organisation | Phone | Languages |
|---|---|---|---|---|---|
| Dana Whitcombe | dana.whitcombe@northfold.example | dispatcher | — | — | — |
| Marguerite Ellison | marguerite.ellison@northfold.example | billing_lead | — | — | — |
| Tomas Herrera | tomas.herrera@rvh.example | scheduler | RVH | 312-555-0141 | — |
| Alina Brooks | alina.brooks@rvh.example | scheduler | RVH | 312-555-0142 | — |
| Helen Marsh | helen.marsh@rvh.example | org_admin | RVH | 312-555-0140 | — |
| Grace Lindqvist | grace.lindqvist@cpsd.example | scheduler | CPSD | 847-555-0163 | — |
| Victor Ames | victor.ames@cpsd.example | org_admin | CPSD | 847-555-0160 | — |
| Owen Pakulski | owen.pakulski@lfc.example | scheduler | LFC | 773-555-0175 | — |
| Nora Quist | nora.quist@lfc.example | org_admin | LFC | 773-555-0170 | — |
| Rosa Mendez (R.M.) | rosa.mendez@interp.example | interpreter | — | — | asl, es |
| Samuel Okoye (S.O.) | samuel.okoye@interp.example | interpreter | — | — | asl |
| Jordan Fairweather (J.F.) | jordan.fairweather@interp.example | interpreter | — | — | asl |
| Linh Tran (L.T.) | linh.tran@interp.example | interpreter | — | — | vi, es |
| Abdi Warsame (A.W.) | abdi.warsame@interp.example | interpreter | — | — | so, ar |

Initials are the first letter of the given name and of the family name, each followed by a full stop.

Rate cards, all effective from 2026-01-01:

| Org | Service line | Hourly rate (cents) | Mileage (cents per mile) |
|---|---|---|---|
| RVH | asl | 8575 | 70 |
| RVH | spoken | 6550 | 70 |
| CPSD | asl | 7800 | 65 |
| CPSD | spoken | 6000 | 65 |
| LFC | asl | 8575 | 70 |
| LFC | spoken | 6550 | 70 |

## Technical requirements

### Deployment (DP-36)

The runtime is Node.js 22 with npm, and the app is written in TypeScript. At the root of `/app`, ship `run.json` with string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` once the server listens and Postgres is reachable, whatever the state of Kill Bill, Mailpit or MinIO. Schema and seed data are applied idempotently on every serve, because the database may be emptied between runs.

### Configuration and secrets (DP-45)

The app reads all of these at start and never hard-codes them or sends them to the browser: `DATABASE_URL`; `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`; `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `APP_PUBLIC_PORT`; `BILLING_RETRY_SECONDS`; `SESSION_TTL_SECONDS`. `MAIL_FROM` is `Northfold Language Access <dispatch@northfold.example>`. Variables ending in `_OBSERVER_*` are not for the app and are never read.

### Server boundary (DP-39)

The app is same-origin only. It sends no CORS headers. A state-changing request (POST, PATCH, DELETE) whose `Origin` header names another origin is refused as stated in API. Body limits are as stated in API. The server serves only the built client assets, the fonts and the API. Source files, `run.json`, package manifests, lockfiles, dependency folders, environment files and anything carrying credentials answer 404. The app starts and answers health while Kill Bill, Mailpit or MinIO is unreachable. Each one's features degrade as stated in Services and recover by themselves when it returns, without a restart.

### Browser support and performance (DP-41)

Current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800. Each screen is usable within three seconds of navigation on the seeded data. A press always shows its pending state within a tenth of a second.

## Working rules

- IF-01: `/app/run.json` is valid JSON with string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build and serve.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` names every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its licence.
- IF-03: Every shipped package (the same production tree) and font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or SIL OFL 1.1.
- IF-04: No datastore besides the provided Postgres and MinIO: no SQLite, Redis, embedded databases or files used as a database.
- IF-05: The provided service compose files and their dev credentials stay unchanged.
- IF-06: `package-lock.json` is committed and `install` uses it.
- IF-07: No script, style or font is loaded from another origin at runtime.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` used to silence the type checker.
- Names in the code match the domain terms in this brief: assignment, seat, hold, release, claim, give back, verification, rate card, business minutes, uncovered minutes, late cancellation.
- Each domain rule (each state transition, the seat count, business-minute notice, the fee decision, billable minutes, mileage, the rate in force, uncovered minutes and role visibility) is decided in exactly one place in the source.
- No abstraction has only a single implementation, and there are no wrappers that only forward calls.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the rules make impossible.
- Every API error is produced through the one error shape in API.
- Money is held as integer cents from input to Kill Bill, with no floating-point arithmetic on amounts.
- There are no features, endpoints or screens beyond this brief.
