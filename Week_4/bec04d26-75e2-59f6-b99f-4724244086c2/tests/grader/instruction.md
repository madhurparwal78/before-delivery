# Penwick Row Duefield

Duefield is a sales tax filing calendar for a one-person bookkeeping practice that files returns for a handful of small online sellers. The bookkeeper registers each client in the states where it collects tax, gives each registration a filing frequency, and sees every return's real deadline in that state's own time zone. They move returns from not started to filed, file extensions and amendments, send reminders and produce a PDF filing packet for each filed return. Each client's owner signs in, usually on a phone, to approve the figures the bookkeeper prepared. Duefield uses three backend services: Postgres for every record, including packet bytes; Mailpit, over SMTP, for every reminder and notice; and Gotenberg to render filing packets to PDF. Out of scope: tax calculation, ledgers, invoicing, payments, payroll, any live link to a tax authority, and any datastore besides Postgres. The bookkeeper enters every amount, and Duefield never calculates one. Every state rule, rate, holiday list, person and business in Duefield is invented.

## Problem and users

Since economic nexus thresholds arrived, a small online seller can be registered in six or eight states. Each registration has its own filing frequency and its own due day. Each state also has its own rule for a due day that lands on a weekend or state holiday: most move it to the next business day, some keep the date fixed, and every state's holiday list is different. Practices that file for five to fifteen sellers keep this in a spreadsheet and a desktop calendar. That calendar runs on the bookkeeper's own time zone, so an Arizona or Hawaii deadline drifts by an hour after each daylight saving change. Reminders drift too. A rate or due-day change typed over the old row quietly rewrites past periods. Client approval lives in email threads, with no record of who approved which figure. A missed return brings late and non-filing penalties that often run from a tenth to half of the tax, plus interest, and the bookkeeper usually pays that to keep the client.

- **Bookkeeper** (daily): runs the whole practice alone. Registers clients in states with a frequency, reads every return's true deadline in its state's zone, moves returns through their statuses, files extensions and amendments, gets reminders and produces filing packets.
- **Client owner** (weekly): signs in, sees only their own business's returns, and approves or sends back the amounts the bookkeeper prepared, usually on a phone between other jobs.

## Journeys

1. **Setting up a practice.** Start: no account. The bookkeeper signs up at `/sign-up` and gets a practice with the six-state catalogue. They add the client Marrow Tin Co. with its owner's sign-in, then register it in New York, monthly from `2026-05`, using only the keyboard. End: the month grid shows the new returns on their carried due dates in New York's zone, and the owner's open home screen lists them without a reload.
2. **Reading a deadline day.** Start: a practice with returns due on the same date in several states. The bookkeeper arrows through `grid "Due dates"` to that day and presses Enter. End: the Midnight meridian band opens under the week, showing each state's deadline against Central time, with strips past the practice clock marked Overdue. Escape closes it and puts focus back on the same day.
3. **Approving on the phone.** Start: two prepared returns and the owner signed in on a 375-pixel phone. The owner taps Approve on one return and sends another back with a reason through the bottom sheet. End: the approved return shows Client approved, the sent-back return stays Prepared but leaves the owner's waiting list and the Awaiting approval count, the bookkeeper's open screen announces each one, and the owner's list shows `Nothing is waiting for your approval.`
4. **Filing and the packet.** Start: a client-approved return. The bookkeeper opens Mark filed by keyboard and confirms. End: the return shows Filed with `Packet pending`, then `link "Filing packet"` appears and the PDF opens with the return's facts.
5. **A last-minute extension.** Start: the practice clock at a return's exact deadline. The bookkeeper files an extension. End: it is granted and the due date moves. A second return, one millisecond past its deadline, is refused with the published copy and stays unchanged.
6. **A rule change.** Start: a state's edition with rate `4.000`. The bookkeeper publishes a new edition effective `2026-06-01` at rate `4.500`. End: the May return still shows `4.000` everywhere, including the CSV and the packet, and the not-started June return shows `4.500` on a second open screen.
7. **Reminders across the clock change, and an outage.** Start: a reminder hour of 9 and returns due around the March and November daylight saving changes. The practice clock steps past each scheduled instant. End: Mailpit holds each reminder once, sent at 9 am Central. On an instance with mail unreachable, the banner shows, reminders stay pending, and they go out once mail answers again, without a restart.
8. **Year review and two tabs.** Start: a year of returns. The bookkeeper filters the year view by status and state, reloads, and downloads the CSV. In two tabs on one return, the first save wins. End: the filters survive the reload, the CSV matches the table, and the losing tab keeps its draft, announces the conflict line and shows the winning values live.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Practice sign-up and sign-in.** A bookkeeper creates a practice at `/sign-up`, which starts with the six-state catalogue from Seed data, and anyone with an account signs in at `/sign-in` and lands on their role's home screen.
- **DP-02 — Clients and owner accounts.** The bookkeeper adds a client with its owner's sign-in from the Clients screen, and that owner can then sign in and reach that client only.
- **DP-03 — State registration with a filing frequency.** Registering a client in a state by keyboard creates that registration's returns with due dates in the state's own zone, and an open owner screen lists them within the live band.
- **DP-04 — Registration validation.** A registration without a state, a frequency or a matching first period is refused with the published field messages, shown beside the field and announced.
- **DP-05 — Month grid of due dates.** `/month/<yyyy>-<mm>` shows `grid "Due dates"` whose day cells carry the published names, dates and counts, with one chip per return that names its state and status in words.
- **DP-06 — Keyboard-complete month grid.** The grid has one tab stop and works fully by arrows, Home, End, PageUp, PageDown, Enter and Escape as published, with focus returning to the same cell.
- **DP-07 — Midnight meridian band.** Opening a day shows the band under its week with one strip per return due that day, placed by its state's offset from Central at that deadline, with the now line and past marks from the practice clock, growing and sliding within the published durations.
- **DP-08 — Midnight meridian under reduced motion.** With reduced motion the band appears at full height with every strip already in its final place and nothing moving, and `table "Deadlines"` lists the same deadlines.
- **DP-09 — Due dates from the period and edition.** Each return's nominal due date comes from its frequency, its period and the edition in effect at the state-local period start, with the due day clamped to the end of the month.
- **DP-10 — Weekend and holiday carry-forward.** A `next_business` due date moves forward past weekends and the state's holidays, a `fixed` date never moves, and the deadline is the last millisecond of the carried date in the state's zone.
- **DP-11 — Carried dates on the grid and phone day list.** A carried return sits on its carried day with the `Carried from` line in the grid, in the 375-pixel day list and on the return screen.
- **DP-12 — Holiday list updates.** Saving a state's holiday list recalculates the due dates of its `not_started` returns at once and leaves every other return unchanged.
- **DP-13 — Reminder schedule in the practice zone.** Each unfiled return has 7-day and 1-day reminders scheduled at the bookkeeper's reminder hour in Central time, holding that wall-clock hour across both daylight saving changes.
- **DP-14 — Reminder delivery confirmed by mail.** A reminder becomes Sent, exactly once, only after Mailpit accepted it, and the bookkeeper's open screen shows and announces it within the live band.
- **DP-15 — Approval, approved, sent back and filed notices.** Each published notice goes once per event to the published recipient with the published subject, and waits through a mail outage as reminders do.
- **DP-16 — Publish a rule change.** The bookkeeper publishes a state rule edition by keyboard from the States screen, and open screens show the recalculated returns within the live band.
- **DP-17 — Earlier periods keep their edition.** Returns for periods that start before an edition, and every return already past `not_started`, keep their stored due date, due day, rate and edition on the grid, the year view, the CSV and the packet.
- **DP-18 — Editions start at state-local midnight.** An edition applies to a period that starts on its effective date in the state's zone and not to the period before, whatever the viewer's zone.
- **DP-19 — Overdue decided by the practice clock.** A return is overdue only when it is unfiled and the practice's current instant is after its deadline: never at the deadline itself, and never because of the browser's clock or zone.
- **DP-20 — Overdue reaches open screens live.** When the practice clock passes a deadline, every open bookkeeper and owner screen showing that return marks it Overdue and announces it within the live band, with no reload.
- **DP-21 — Counts match the returns.** Day counts, the Overdue and Awaiting approval counts and the year view result count always equal the number of matching returns, after every status change and clock change.
- **DP-22 — File an extension by keyboard.** The bookkeeper files an extension from the return screen by keyboard, and the granted extension is announced and shown on every open screen within the live band.
- **DP-23 — Extension deadline edge.** An extension is granted at the deadline instant itself and refused one millisecond later with `deadline_passed` and the published copy, changing nothing.
- **DP-24 — Extended due date and one extension.** A granted extension moves the due date by the edition's extension days from the unextended nominal date and carries it forward again, and a second extension is refused.
- **DP-25 — Phone approval for the client owner.** On a 375-pixel touch screen the owner approves their own prepared return with a pinned full-width button at least 44 pixels tall, and the bookkeeper's open screen announces it within the live band.
- **DP-26 — Send back through the bottom sheet.** The owner sends a return back with a required reason through the `Send back` bottom sheet, which slides up within the published time, appears at once under reduced motion and returns focus to its opener.
- **DP-27 — Owners reach only their own client.** Another client's return, packet, reminders or approval action answers the same 404 and not-found screen as a return that does not exist.
- **DP-28 — Owner actions refused by the server.** An owner session is refused with 403 for filing, extensions, amendments, amounts, registrations, holidays and rule editions, and the matching controls are absent from owner screens.
- **DP-29 — Mark filed.** The bookkeeper marks a client-approved return filed through `dialog "Mark filed"` by keyboard, focus returns to the return screen, and `Packet pending` shows until the packet is ready.
- **DP-30 — Packeted only after the PDF.** A return becomes Packeted and offers `link "Filing packet"` only after Gotenberg returned its PDF, and a held or failed render leaves it Filed with `Packet pending`.
- **DP-31 — Filing packet contents.** The packet PDF served to the bookkeeper and the owner carries the published facts about the return, its edition, approval, extension and amendments.
- **DP-32 — Record an amendment.** The bookkeeper records an amendment on a filed or packeted return by keyboard, and every open screen shows Amended and announces it within the live band.
- **DP-33 — Originals kept and packet revisions.** An amendment keeps the original amounts beside the new ones, the earlier packet stays served until the new revision is ready, and the return goes back to Packeted only after the new PDF.
- **DP-34 — Amended returns in lists and exports.** Amended returns show the Amended status and the amended amounts in the grid, the year view, its filters and the CSV, and are never overdue.
- **DP-35 — Service outage banners.** When mail or the PDF service cannot be reached, `region "Service notice"` shows the published banner within two retry periods and clears it within two retry periods of recovery.
- **DP-36 — Waiting work goes out without restart.** Reminders, notices and packets stay pending through an outage, then go out or render once the service returns, with no restart, and open screens update within the live band.
- **DP-37 — Health reports service reachability.** `GET /api/health` always answers 200, with `{"status":"ok"}`, or with `{"status":"unavailable"}` while mail or PDF is unreachable.
- **DP-38 — Year view filters in the URL.** `/year/<yyyy>` lists returns in `table "Returns"`, its status and state filter chips work by keyboard and live in the URL query, and a reload keeps them.
- **DP-39 — Result count matches the table.** `status "Result count"` always equals the rows in the filtered table and the rows in the matching CSV.
- **DP-40 — CSV export.** `link "Export CSV"` downloads the filtered year as CSV with the published header, columns, order and quoting.
- **DP-41 — Version-checked saves.** Every write carries the version the caller last saw, a stale one answers 409 `conflict` and changes nothing, and every persisted change adds one to the version.
- **DP-42 — Stale-tab conflict on screen.** A tab whose save loses keeps its typed draft and its focus, announces the published conflict line and shows the winning values in `region "Latest saved return"` within the live band.
- **DP-43 — One error order for the API.** Every route answers errors in the published order, so a stale save with invalid amounts answers 409, and another client's id answers 404 before any role or validation check.
- **DP-44 — Today specimen screen.** The bookkeeper's `/today` shows the wordmark, the published sentence, the week's name list, one large specimen tile for the selected return, its due line and one orange next-step action, as described in Visual design.
- **DP-45 — Specimen catalogue drag rows.** `/catalogue` shows one horizontally draggable tile row per client with Previous and Next buttons and arrow-key scrolling, gliding in under half a second and jumping at once under reduced motion.
- **DP-46 — Specimen visual language.** Every screen and the packet carry the specimen-catalogue direction: flat coloured tiles in a steady per-state rotation, Tilt Warp only for the wordmark and the next deadline, Plus Jakarta Sans for everything else, square working surfaces and acid-yellow banners.
- **DP-47 — Responsive layouts and touch targets.** Every screen works at 375x812, 768x1024 and 1280x800 with no sideways page scroll, and every control on a phone is at least 44 pixels tall.
- **DP-48 — One announcement region and accessible screens.** Every screen has the single `status "Duefield announcements"` region carrying the published lines and passes automated WCAG 2.2 AA checks, with no spinner or looping animation.
- **DP-49 — Run manifest and boot.** `/app/run.json` installs, builds and serves the app on port 4173, honouring `APP_PUBLIC_PORT`, and the app serves even when mail or PDF is unreachable at boot.
- **DP-50 — Server boundary.** The server is same-origin only, enforces the published body limits and never serves source, credentials, `.env` or `.git` files.
- **DP-51 — Grading fixture and practice clock.** The published grading routes build a practice and set its current instant behind `GRADING_KEY`, and answer 404 without the right key.
- **DP-52 — Credentials from the environment.** Every service URL and credential is read from the published environment variables at start, and is never hard-coded or sent to the browser.

## Frontend

### Screens and layout (DP-01, DP-02, DP-05, DP-11, DP-25, DP-38, DP-44, DP-45, DP-47)

Routes. Signed out, `/` goes to `/sign-in`. A bookkeeper lands on `/today` and a client owner on `/home`. An owner who opens a bookkeeper-only screen is sent to `/home`, and a bookkeeper who opens `/home` is sent to `/today`.

| Route | Who | Shows |
|---|---|---|
| `/sign-up` | anyone | Create-practice form |
| `/sign-in` | anyone | Sign-in form |
| `/today` | bookkeeper | The specimen hero for this week's returns (Monday to Sunday in Central time on the practice clock), plus the Overdue and Awaiting approval counts |
| `/catalogue` | bookkeeper | Every return as a specimen tile, in one draggable row per client |
| `/month/<yyyy>-<mm>` | bookkeeper | The counts, the month caption with Previous and Next month buttons, `grid "Due dates"` and the Midnight meridian band |
| `/year/<yyyy>` | bookkeeper | Filter chips, the result count, `table "Returns"` and the CSV link |
| `/clients` | bookkeeper | One region per client with its owner and registrations, plus Add client and Register in a state |
| `/states` | bookkeeper | One region per state with its zone, holidays and editions, plus holiday and rule-change controls |
| `/settings` | bookkeeper | Reminder hour |
| `/returns/<id>` | both | The return screen: tile, due line, edition, amounts, status, actions for the role, reminders (bookkeeper), approvals, extension, amendments, filing packet and latest saved values |
| `/home` | client owner | Returns awaiting the owner's approval, plus all of their returns |

Opening `/month` with no month uses the current month in Central time on the practice clock. `/year` with no year does the same with the year. Every bookkeeper screen has a top bar with the Duefield wordmark and `navigation "Main"` holding links to Today, Catalogue, Month, Year, Clients, States and Settings, plus `button "Sign out"`. Owner screens show the wordmark, the client's name and `button "Sign out"`.

Layout at the three viewports. No screen ever scrolls the page sideways.
- **1280x800.** Today follows the hero in Visual design. The month grid has seven columns of day cells, with the band opening full width under the open day's week. Forms are one column on white, with the affected return's tile pinned to the right. The year table shows every column. The owner home centres the tile with the actions directly below it.
- **768x1024.** The month grid keeps seven columns with smaller cells. Forms are one column with no pinned tile. Catalogue rows show two to three tiles at a time. Today puts the name list above the tile.
- **375x812.** Everything stacks in one column with even side margins. The month grid becomes a day list: the same `grid "Due dates"` and the same cells, one day per line, and the band opens directly under the open day. Each year table row stacks its cells as label and value lines, still inside `table "Returns"`. The owner home shows a full-width tile at four by five proportion, a sideways name row of returns that snaps one item at a time, and the Approve action pinned full width at the bottom with Send back just above it.

### Public screens and controls (DP-01 to DP-08, DP-16, DP-22, DP-25, DP-26, DP-29, DP-32, DP-35, DP-38 to DP-42, DP-44, DP-45, DP-48)

Only the roles, names and data attributes below are public. A control that a role may not use is absent from that role's screens, never just disabled.

| Where | Role and accessible name | Visible copy, notes |
|---|---|---|
| every screen | `status "Duefield announcements"` (polite) | Lines from Feedback states |
| bookkeeper screens | `region "Service notice"` | Present only during an outage; banner copy from Feedback states |
| `/sign-up` | `heading "Create your practice"`, `textbox "Your name"`, `textbox "Email"`, password field labelled `Password`, `button "Create practice"`, `link "Sign in"` | |
| `/sign-in` | `heading "Sign in"`, `textbox "Email"`, password field labelled `Password`, `button "Sign in"`, `link "Create a practice"` | |
| top bar | `navigation "Main"`, `button "Sign out"` | |
| `/today` | `heading "Duefield"` (the wordmark), `list "This week"` of `button "<client> · <State name> <period label>"`, the tile, the due line, one `link` to the return named for the next step, `status "Overdue count"`, `status "Awaiting approval count"` | Hero sentence `Every return, due in its own state's time.` Next-step link names by status: `Prepare return`, `Check approval`, `File return`, `Check packet` (filed), `Open return` (packeted or amended) |
| `/catalogue` | per client: `region "<client>"`, `list "Returns for <client>"` of tiles (`listitem`), `button "Previous returns for <client>"`, `button "Next returns for <client>"` | Each tile holds a `link "<client> <state> <period label>"` to the return |
| `/month/...` | `heading` level 2 `<Month> <yyyy>`, `button "Previous month"`, `button "Next month"`, `grid "Due dates"` of `gridcell "<Weekday> <Month> <day>"`, `status "Overdue count"`, `status "Awaiting approval count"` | Chips read `<state> · <status label>`, with ` · Overdue` added when overdue |
| band | `region "Deadlines on <Weekday> <Month> <day>"` holding a `list` of `listitem`, a now line with `data-now`, and `table "Deadlines"` with columns `State`, `Local deadline`, `Practice deadline`, `Status` | Strip copy in Motion and effects |
| `/year/<yyyy>` | `button "Status: <label>"` for `Not started`, `Prepared`, `Client approved`, `Filed`, `Packeted`, `Amended`, `Overdue`; `button "State: <code>"` for each practice state; `status "Result count"`; `table "Returns"`; `link "Export CSV"` | Chips are toggle buttons (pressed or not). Table columns: `Client`, `State`, `Period`, `Status`, `Due`, `Zone`, `Gross sales`, `Tax due`, `Rate`, `Edition` |
| `/clients` | `button "Add client"` → `dialog "Add client"`: `textbox "Business name"`, `textbox "Owner name"`, `textbox "Owner email"`, password field labelled `Owner password`, `button "Save client"`, `button "Cancel"` | |
| `/clients`, per client | `region "<client>"`, `button "Register <client> in a state"` → `dialog "Register in a state"`: `combobox "State"` (options `<State name> (<code>)`), `radiogroup "Filing frequency"` with `radio "Monthly"`, `radio "Quarterly"`, `radio "Yearly"` (none chosen at first), `textbox "First period"` (hint `2026-05, 2026-Q2 or 2026`), `button "Register"`, `button "Cancel"` | |
| `/states`, per state | `region "<State name>"`, `button "Edit holidays for <code>"` → `dialog "Holidays for <code>"`: `textbox "Holiday dates"` (one date per line), `button "Save holidays"`, `button "Cancel"` | |
| `/states`, per state | `button "Publish rule change for <code>"` → `dialog "Publish rule change"`: `textbox "Effective date"`, `spinbutton "Due day"`, `radiogroup "Carry-forward"` with `radio "Next business day"`, `radio "Fixed date"`, `textbox "Reference rate"`, `spinbutton "Extension days"`, `button "Publish"`, `button "Cancel"` | |
| `/settings` | `combobox "Reminder hour"` (options `6:00 am` to `9:00 pm` on the hour), `button "Save reminder hour"` | |
| `/returns/<id>` | `heading` level 1 `<client> · <State name> <period label>`; the due line; the edition line `Rule edition effective <date> · due day <n> · <Next business day or Fixed date> · reference rate <rate>%` | Shown to both roles |
| return, bookkeeper | `textbox "Gross sales"`, `textbox "Tax due"`, `button "Save amounts"` (not started or prepared), `button "Mark prepared"` (not started) | |
| return, bookkeeper | `button "Mark filed"` (client approved) → `dialog "Mark filed"`: `button "Confirm filing"`, `button "Cancel"` | |
| return, bookkeeper | `button "File extension"` (unfiled, not yet extended) → `dialog "File extension"`: `button "Confirm extension"`, `button "Cancel"` | |
| return, bookkeeper | `button "Record amendment"` (filed or packeted) → `dialog "Record amendment"`: `textbox "Amended gross sales"`, `textbox "Amended tax due"`, `textbox "Note"`, `button "Save amendment"`, `button "Cancel"` | |
| return, bookkeeper | `region "Reminders"`, one `listitem` per reminder: `<7 days or 1 day> before · <Weekday> <Month> <day>, <h:mm am/pm> Central · <Pending or Sent>` | |
| return, both | `region "Approvals"`, `region "Amendments"` (each original next to its amended figures), `region "Filing packet"` (text `Packet pending`, or `link "Filing packet"`), `region "Latest saved return"` reading `Saved: gross sales <g>, tax due <t>, version <n>, <status label>` | |
| return, owner | `button "Approve <state> <period label>"`, `button "Send back <state> <period label>"` (Approve when the return awaits approval; Send back when it awaits approval or is client approved) | |
| `/home` | `heading "Awaiting your approval"`, `list "Your returns"` of `button "<state> <period label>"` (pressed when selected), the tile, `button "Approve <state> <period label>"`, `button "Send back <state> <period label>"`, `region "All your returns"` | |
| owner | `dialog "Send back"`: `textbox "Reason"`, `button "Send back"`, `button "Cancel"` | Bottom sheet on phones |
| any | not-found screen | Copy in Feedback states |

Data attributes (tests read these, never pixels or colours). Every return shown anywhere carries `data-return-id`, `data-status` (API value), `data-overdue` (`true` or `false`), `data-due-at` (the deadline instant), `data-state` (code), `data-version`, `data-rate` and `data-edition` (the edition's effective date). That covers tiles, chips, year rows, band strips, `/home` items and the return screen's main element. Every month day cell carries `data-date` (`YYYY-MM-DD`) and `data-count`: the number of returns whose current state-local due date is that day. Leading and trailing blank cells have neither attribute. A carried return also leaves an outlined ghost on its nominal day cell, with `data-ghost-for="<return id>"` and the `Carried from` words. A ghost is not a return and is not counted. Band strips also carry `data-offset-hours` and `data-past`.

Field errors show beside the field whose API key matches: `email`, `password`, `display_name` (Your name, Owner name), `name` (Business name), `owner.email` (Owner email), `owner.password` (Owner password), `state`, `frequency`, `first_period`, `holidays`, `effective_date`, `due_day`, `carry`, `rate`, `extension_days`, `gross_sales` (also Amended gross sales), `tax_due` (also Amended tax due), `reason`, `note`, `reminder_hour`.

### Interactions (DP-03, DP-06, DP-07, DP-22, DP-25, DP-26, DP-29, DP-32, DP-38, DP-42, DP-45)

Month grid keys. `grid "Due dates"` has exactly one tab stop. When the month opens, that stop is today's cell (Central date on the practice clock) if today falls in the month, otherwise the 1st. Left and Right move one day. Up and Down move one week. Home and End go to the first and last day of the focused week within the month. PageUp and PageDown go to the previous or next month and land on the same day number, clamped to that month's last day: January 31 goes to February 28 in 2026. The route and the level 2 caption change with the month. Arrows past the first or last day of the month also change month. Keys mean the same at every width. Weeks run Monday to Sunday, so the first grid column is Monday and the last is Sunday, and Home and End go to the Monday and the Sunday of the focused week (or the month's first or last day where the month cuts the week). A band opens under the row holding its day. Enter, or a click, on a day with returns opens that day's band and announces the band line. Enter on an empty day opens nothing and announces nothing. Escape, or a second Enter on the same day, closes the band and returns focus to the same cell. Opening another day closes the first band. Viewing another month leaves the band closed.

Dialogs. Every dialog opens with focus on its first field, or on its confirm button when it has no fields. Tab and Shift+Tab wrap inside the dialog and never reach the page behind. Escape and Cancel close it. Closing returns focus to the control that opened it. `textbox "Holiday dates"` opens prefilled with the state's current holidays, one per line, and saving replaces the whole list with exactly its content. Confirming submits once. While the request is pending, the confirm button reads `Saving` and ignores further presses. On success the dialog closes and focus returns to the opener, which is the return screen's heading if the opener no longer exists (Mark filed and File extension disappear after use). A field error, a refused extension or a conflict keeps the dialog open and moves focus to the first message.

Forms outside dialogs (amounts, reminder hour, sign-in, sign-up) submit with Enter in any field. Focus stays on the control that submitted.

Return screen live behaviour. The amount inputs hold a draft. `Save amounts` and `Mark prepared` submit the draft's version: the version the tab loaded when the page opened, or the version it received from its own last save or its last 409. Live updates refresh the status, chips, `region "Latest saved return"`, the reminders, the packet region and the counts, but never overwrite a draft or the draft's version. Every other action (Approve, Send back, Mark filed, File extension, Record amendment) submits the latest version the tab has received, live updates included. After a 409 the tab takes the winning version and keeps the draft, so saving again applies the draft over the winner.

Today. Choosing a name in `list "This week"` (click, tap, Enter or Space) swaps the tile's specimen, its colour, the due line and the next-step link. Up and Down move between names.

Catalogue rows. Each row scrolls sideways by pointer drag or touch swipe, by Left and Right while the row has focus (one tile per press), and by its Previous and Next buttons (one tile per press). Dragging never opens a tile. A press and release without movement follows the tile's link. Previous is absent at the start of a row and Next at its end.

Owner home. Tapping a name in `list "Your returns"` selects it. Approve acts on the selected return. Send back opens `dialog "Send back"`. After approving, the next waiting return becomes selected. With none left, the empty state shows.

Year view. Pressing a status chip filters to that status and pressing it again clears the filter. One status and one state can be active at a time. The query (`?status=prepared&state=NY`) changes without a reload, and loading that URL restores the same chips and rows. Status query values are the API status values plus `overdue`. `link "Export CSV"` carries the same query.

Phone and touch. Every tappable control is at least 44 pixels tall. Taps act on release. The name row snaps to one item at a time.

### Visual design (DP-44, DP-46, DP-47)

The direction is a specimen catalogue: each return is shown alone on a flat colour tile, like an object in a museum catalogue, so that eight similar returns can be compared at a glance and the one black overdue tile stands out.

Type. Tilt Warp, a heavy rounded display face, is used only for the Duefield wordmark and for the next deadline's state and date. Everything else is Plus Jakarta Sans: every label is a full word in ordinary reading sizes, with no tracked capitals and no abbreviations in the interface copy. Each heading step is a quarter larger than the one below it.

Colour roles. The ground is plain white. Day cells and quiet surfaces are a very light grey. Text is black. Secondary text is a mid grey that still meets AA contrast on white. The accent is a warm orange, used for the one primary action on each screen, with black text on it. Tiles rotate through four flat colours by state (orange, sage green, acid yellow, black), assigned in a steady order by the state's position in the practice's states sorted by code, so one state always has one colour. Overdue chips are black with near-white text and always carry the word Overdue, so status never depends on colour. Error and outage banners are full-width acid-yellow bands with black text.

Tiles. Each tile is one flat colour with softly rounded corners. Tiles and due-date chips are the only rounded shapes in the product. Every other surface, cell, input and button is square-cornered. A tile holds one drawn "folded return": a sheet with one folded corner, stamped with the state's two-letter code and the period, drawn in black lines, or light lines on a black tile. The client name and one fact sit below the tile, left-aligned, never on it. All tiles share one size and one angle, in every row of the catalogue. Gaps between tiles are narrow and even. No tile ever lifts, tilts or casts a shadow.

Hero (Today, desktop). The wordmark sits top left in Tilt Warp, very large, on a generous margin. The sentence from Public screens and controls sits top right. In the centre stands one tall tile, a little taller than wide, with the selected return's folded-form specimen filling most of its height. To its left, a right-aligned list of this week's returns steps down in size and fades from full strength to faint over four steps. Below the tile are one fact (the due line) and one orange action about a third of the tile's width, labelled with the return's next step. The next deadline's state and date appear in Tilt Warp; nothing else on the screen is large type.

Phone home (owner). The same blueprint in phone form: a full-width tile at four by five proportion, the sideways name row beneath it, and Approve as a full-width orange bar pinned to the bottom.

Working screens. Month cells are light grey squares on white. A due date is a small rounded chip in its state's tile colour, holding the state code and status as words. Forms are one column on white with medium-weight labels, one orange submit, and the affected return's tile pinned at the right on wide screens. The year view is a plain table with numbers in even-width figures. Each empty state shows one empty sage tile with its sentence beneath. The PDF packet repeats the tile, the wordmark and the two typefaces at print sizes.

Density is comfortable, with room around every group. Contrast meets WCAG 2.2 AA everywhere, including chips and banners. Keyboard focus shows as a thick black outline offset from the control, visible on every colour.

### Motion and effects (DP-07, DP-08, DP-26, DP-45, DP-48)

Midnight meridian (the signature). The band shows the bookkeeper when each state's deadline on one day falls on their own Central clock. It opens on Enter or a click on a day cell with returns:
1. The band grows from nothing to its full height in 200 to 300 milliseconds, starting quickly and settling softly.
2. It holds one strip per return due that day, in deadline order. Equal deadlines are ordered by state code, then client name, then return id. Each strip is a 24-hour bar in its state's tile colour and reads `<client> <state> · <local deadline> · <practice-zone deadline>`, for example `Marrow Tin Co. WA · 11:59 pm Pacific · 1:59 am Central`. Its `data-offset-hours` is the state's UTC offset minus Central's UTC offset at that deadline, in hours (for example `1` for New York and `-5` for Hawaii in June).
3. The strips first appear stacked at the same left edge, aligned on local midnight at Central's position. Each then slides sideways to its true position on a 36-hour axis labelled in Central hours, running from 6 pm on the evening before to 6 am on the morning after. A strip moves by its offset multiplied by the width of one hour, in the opposite direction, so Eastern sits left of Central and Hawaii furthest right. Each slide takes 300 to 500 milliseconds and starts about 40 milliseconds after the previous strip's, in deadline order. Arizona's and Hawaii's positions differ between cells inside and outside Central's daylight saving period, while Eastern, Mountain and Pacific do not move relative to Central.
4. A thin vertical now line marks the practice's current instant and carries it in `data-now`. When that instant falls outside the axis, the line is hidden but the attribute is kept. A strip whose deadline is at or before the now line carries `data-past="true"`. A strip that is overdue turns black and shows the word `Overdue`.
5. A strip whose date was carried forward also shows `Carried from <Weekday> <Month> <day>`.
6. `table "Deadlines"` under the band lists the same strips as rows: state code, local deadline, practice deadline, status label (with `Overdue` when overdue).
7. Closing collapses the band in 200 to 300 milliseconds and returns focus to the day cell.

Under the reduced-motion setting, the band appears at full height at once, with every strip already in its final position, nothing growing or sliding, and the same content, now line, past marks and table.

Other motion:
- The send-back bottom sheet slides up from the bottom edge in 200 to 360 milliseconds and slides back down on close. Under reduced motion it appears and disappears at once.
- A catalogue row's Previous, Next or arrow key glides one tile in under half a second. Under reduced motion it jumps at once. Dragging follows the finger, with no momentum in reduced motion.
- Status and chip changes swap colour and words at once. The orange action darkens while pressed. Nothing animates on hover.
- Banners appear and disappear at once.

Duefield has no spinner, no shimmer, no looping or idle animation and no decorative motion anywhere. Pending work is shown by words (`Saving`, `Packet pending`, `Pending`).

### Feedback states (DP-04, DP-14, DP-20, DP-22, DP-23, DP-25, DP-30, DP-35, DP-42, DP-48)

The one announcement region, `status "Duefield announcements"`, carries every line below. It keeps the latest line until the next line replaces it, and nothing clears it on a timer. Placeholders: `<client>` is the client name. `<state>` is the state code. `<period>` is the period label (`May 2026`, `Q2 2026` or `2026`). `<name>` is a person's display name. `<status label>` is one of `Not started`, `Prepared`, `Client approved`, `Filed`, `Packeted`, `Amended`. Dates read `<Weekday> <Month> <day>` with the full weekday and month and no comma, for example `Monday June 22`.

| Event | Line |
|---|---|
| Status saved (own action; also on every other open screen showing the return, except owner approvals and send-backs) | `<client> <state> <period> is now <status label>.` |
| Amounts saved without a status change | `Amounts saved for <client> <state> <period>.` |
| Went overdue live | `<client> <state> <period> is overdue.` |
| Conflict | `<name> changed this return first. It is now <status label>.` |
| Extension granted | `Extended to <Weekday> <Month> <day>.` |
| Extension refused | `The deadline for this return has passed.` |
| Band opened | `<n> returns due <Weekday> <Month> <day>.` (`1 return due <Weekday> <Month> <day>.` when there is one) |
| Reminder sent (bookkeeper screens) | `Reminder sent for <client> <state> <period>.` |
| Packet ready (bookkeeper and owner screens showing it) | `Packet ready for <client> <state> <period>.` |
| Owner approval seen by the bookkeeper | `<name> approved <state> <period>.` |
| Owner send-back seen by the bookkeeper | `<name> sent back <state> <period>.` |
| Client added | `Client added: <client>.` |
| Registration | `<client> registered in <state>.` |
| Holidays saved | `Holidays saved for <state>.` |
| Rule change published | `Rule change published for <state>.` |
| Reminder hour saved | `Reminder hour saved.` |
| Field error | the field's message (the first, in form order) |
| Banner appears | the banner's copy |
| Unexpected server error | `That didn't save. Try again.` |

When one action causes several lines on one screen, the final line follows this order, highest first: conflict, field error, extension refused, status saved, amounts saved, extension granted, band opened, the remaining own-action lines, approval or send-back seen, went overdue, packet ready, reminder sent, banner. When several returns go overdue at once, one line per return is announced in deadline order (`due_at`, then state code, client name, return id, the same order as band strips), so the line of the return with the latest deadline is the last and stays.

Field messages, by API key:

| Key | Message |
|---|---|
| `display_name` | `Enter your name.` (sign-up), `Enter the owner's name.` (owner) |
| `name` | `Enter a business name.` |
| `email`, `owner.email` | `Enter a valid email address.` or `An account with this email already exists.` |
| `password`, `owner.password` | `Use at least 8 characters.` |
| sign-in `email` | `Email or password is wrong.` |
| `state` | `Choose a state.` or `This client is already registered in this state.` |
| `frequency` | `Choose a filing frequency.` |
| `first_period` | `Enter a period like 2026-05, 2026-Q2 or 2026 to match the frequency.` |
| `holidays` | `Enter dates as YYYY-MM-DD, one per line.` |
| `effective_date` | `Enter a date as YYYY-MM-DD.` or `An edition already starts on this date.` |
| `due_day` | `Enter a due day from 1 to 31.` |
| `carry` | `Choose a carry-forward rule.` |
| `rate` | `Enter a rate with three decimals.` |
| `extension_days` | `Enter whole days from 0 to 180.` |
| `gross_sales`, `tax_due` | `Enter an amount with two decimals.` |
| `reason` | `Give a reason for sending this back.` or `Keep the reason to 500 characters or fewer.` |
| `note` | `Keep the note to 500 characters or fewer.` |
| `reminder_hour` | `Choose a whole hour from 6 to 21.` |
| `version` | `Send the version you last saw.` |

Outage banners, in `region "Service notice"` on bookkeeper screens:
- Mail: `Reminders are waiting: mail can't be reached right now.`
- PDF: `Packets are waiting: the PDF service can't be reached right now.`

A banner appears within two retry periods of the service becoming unreachable and clears within two retry periods of it answering again, with no reload and no restart. Both show when both services are down. No action fails because of an outage, so success lines stay true: a filed return shows `Filed` and `Packet pending`, and a reminder shows `Pending`.

Empty states, each under one empty sage tile:
- Month with no returns, under the grid: `No returns due this month.`
- Today with nothing this week: `No returns due this week.`
- Catalogue with no returns: `No returns yet. Register a client in a state to start.`
- Owner home with nothing prepared: `Nothing is waiting for your approval.`

Not-found screen, shown for any return the caller cannot open and any unknown page: heading `Return not found`, text `This return doesn't exist, or you don't have access to it.` The page request itself answers HTTP 404.

Pending states: a submitting button reads `Saving` until the answer arrives. The packet region reads `Packet pending` until the PDF is ready. A reminder reads `Pending` until Mailpit accepted it.

## Backend

### API (DP-01 to DP-04, DP-12 to DP-16, DP-19, DP-22 to DP-33, DP-37 to DP-43, DP-51)

Conventions. Request and response bodies are JSON (`application/json; charset=utf-8`) unless stated otherwise. The session is the cookie `duefield_session` (HttpOnly, path `/`, SameSite Lax), valid for `SESSION_TTL_SECONDS` real seconds. Instants are UTC ISO 8601 with milliseconds and `Z`, for example `2026-06-24T03:59:59.999Z`. Dates are `YYYY-MM-DD`. Amounts are strings with exactly two decimals (1 to 12 digits before the point). Rates are strings with exactly three decimals. Periods are `YYYY-MM` (monthly), `YYYY-Qn` (quarterly) or `YYYY` (yearly). Error bodies follow the error order in Business rules. The rows below list only the success answer and each route's own extra errors.

Shapes:
- **User** `{"id","display_name","email","role":"bookkeeper"|"owner","client_id":null|"<id>"}`
- **Edition** `{"effective_date":"YYYY-MM-DD","due_day":int,"carry":"next_business"|"fixed","rate":"4.000","extension_days":int}`
- **State** `{"code","name","zone","zone_label","holidays":[date, ascending],"editions":[Edition, ascending by effective_date]}`
- **Registration** `{"id","state","frequency":"monthly"|"quarterly"|"yearly","first_period"}`
- **Client** `{"id","name","owner":{"id","display_name","email"},"registrations":[Registration]}`
- **Reminder** `{"lead_days":7|1,"scheduled_for":instant,"sent_at":instant|null,"status":"pending"|"sent"}`. `sent_at` is the practice clock's instant when Mailpit accepted the message.
- **Return**:
```
{"id","client":{"id","name"},"registration_id","state","state_name","zone","zone_label",
 "frequency","period","period_label","status","status_label","overdue":bool,"awaiting_approval":bool,"version":int,
 "gross_sales":string|null,"tax_due":string|null,
 "nominal_due_date","due_date","carried_from":date|null,"due_at","due_line",
 "local_deadline_label":"11:59 pm Pacific","practice_deadline_label":"1:59 am Central","offset_hours":int,
 "edition":Edition,
 "approvals":[{"action":"approved"|"sent_back","by","at","reason":string|null}],
 "extension":null|{"granted_at","extension_days","due_date_before","due_at_before"},
 "amendments":[{"at","by","note":string|null,"original":{"gross_sales","tax_due"},"amended":{"gross_sales","tax_due"}}],
 "filed_at":instant|null,"packet":"none"|"pending"|"ready","packet_revisions":int,"changed_by":string}
```
`nominal_due_date` is the extended nominal date (the date before carrying; see Business rules). `carried_from` equals it when carrying moved the date, otherwise null. `awaiting_approval` is true for a `prepared` return the owner has not sent back since it was last prepared or its amounts last saved, and false otherwise. `changed_by` is the display name of whoever made the latest persisted change. `packet_revisions` counts ready packet revisions.

| Method and path | Who | Request | Success | Own errors |
|---|---|---|---|---|
| `POST /api/auth/signup` | anyone | `{"display_name","email","password"}` | 201 `{"practice_id","user":User}`, sets the cookie | 422 `display_name`, `email`, `password` |
| `POST /api/auth/signin` | anyone | `{"email","password"}` | 200 `{"user":User}`, sets the cookie | 422 `email` |
| `POST /api/auth/signout` | signed in | none | 204, clears the cookie | |
| `GET /api/me` | signed in | | 200 `{"user":User,"practice_id","now":instant,"practice_zone":"America/Chicago","reminder_hour":int}` | |
| `PATCH /api/practice` | bookkeeper | `{"reminder_hour":int}` | 200 `{"reminder_hour":int}`, recomputing unsent reminders | 422 `reminder_hour` |
| `GET /api/states` | bookkeeper | | 200 `[State]` sorted by code | |
| `PUT /api/states/<code>/holidays` | bookkeeper | `{"holidays":[date]}` (replaces the list) | 200 State | 422 `holidays` |
| `POST /api/states/<code>/editions` | bookkeeper | Edition | 201 `{"edition":Edition,"recalculated":[return id]}` | 422 per field |
| `GET /api/clients` | bookkeeper | | 200 `[Client]` sorted by name | |
| `POST /api/clients` | bookkeeper | `{"name","owner":{"display_name","email","password"}}` | 201 Client | 422 `name`, `display_name`, `owner.email`, `owner.password` |
| `POST /api/clients/<id>/registrations` | bookkeeper | `{"state","frequency","first_period"}` | 201 `{"registration":Registration,"returns":[Return]}` | 422 `state`, `frequency`, `first_period` |
| `GET /api/returns` | both | optional `month=YYYY-MM` or `year=YYYY` (neither means the whole practice), optional `status`, `state`, `client` | 200 `{"returns":[Return],"counts":{"total","overdue","awaiting_approval"}}`, filtered | 422 `month`/`year` for a malformed value |
| `GET /api/returns/<id>` | both | | 200 Return | |
| `PATCH /api/returns/<id>` | bookkeeper | `{"version","gross_sales","tax_due"}` | 200 Return | 409 `illegal_status` unless not started or prepared |
| `POST /api/returns/<id>/prepare` | bookkeeper | `{"version","gross_sales","tax_due"}` | 200 Return | |
| `POST /api/returns/<id>/approve` | owner | `{"version"}` | 200 Return | |
| `POST /api/returns/<id>/send-back` | owner | `{"version","reason"}` | 200 Return | 422 `reason` |
| `POST /api/returns/<id>/file` | bookkeeper | `{"version"}` | 200 Return with `packet` `pending` | |
| `POST /api/returns/<id>/extension` | bookkeeper | `{"version"}` | 200 Return | 409 `deadline_passed` |
| `POST /api/returns/<id>/amend` | bookkeeper | `{"version","gross_sales","tax_due","note"?}` | 200 Return with `packet` `pending` | 422 `note` |
| `GET /api/returns/<id>/reminders` | bookkeeper | | 200 `[Reminder]` by `scheduled_for` | |
| `GET /api/returns/<id>/packet` | both | optional `?revision=<n>` | 200 `application/pdf`: the newest ready revision, or the one asked for | 409 `{"error":"packet_pending"}` when no revision is ready; unknown revision 404 |
| `GET /api/year/<yyyy>/export.csv` | bookkeeper | optional `status`, `state` | 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="duefield-<yyyy>.csv"` | |
| `GET /api/events` | both | | The app's own same-origin live channel (server-sent events). Its message format is free | |
| `GET /api/health` | anyone | | 200 `{"status":"ok"}` or 200 `{"status":"unavailable"}` | |

In `GET /api/returns`, owners only ever receive their own client's returns. Rows are sorted by `due_at`, then client name, then state code. `month` and `year` select by the current state-local due date. `status` takes an API status value or `overdue`. `counts` are over the filtered rows: `overdue` counts overdue returns and `awaiting_approval` counts returns whose `awaiting_approval` is true.

CSV export. The body is RFC 4180: lines end with CRLF, a field containing a comma, a double quote or a line break is wrapped in double quotes with inner quotes doubled, and the header row is always present, even with no rows. The header is exactly:
```
client,state,period,status,overdue,due_at,zone,gross_sales,tax_due,rate,edition_effective_date
```
`status` is the API status value, `overdue` is `true` or `false`, `due_at` is the deadline instant, `zone` is the IANA zone, a null amount is an empty field, amounts have two decimals, `rate` has three, and an amended return shows its amended amounts. Rows are the filtered returns of the year sorted by `due_at`, then client name, then state code. For example, with the fixture above:
```
Marrow Tin Co.,NY,2026-05,prepared,false,2026-06-23T03:59:59.999Z,America/New_York,1000.00,40.00,4.000,2020-01-01
```

Grading routes. Both need the header `X-Grading-Key: <GRADING_KEY>`. A missing or wrong key, or an unset `GRADING_KEY`, answers 404 `{"error":"not_found"}` whatever session is present.

`POST /api/grading/fixture` builds a new practice and answers 201. Example body:
```
{"bookkeeper": {"display_name": "Ada Finch", "email": "ada@example.test", "password": "pass-ada-1", "reminder_hour": 9},
 "now": "2026-06-22T15:00:00.000Z",
 "states": [{"code": "NY", "name": "New York", "zone": "America/New_York",
   "holidays": ["2026-06-19"],
   "editions": [{"effective_date": "2020-01-01", "due_day": 20, "carry": "next_business", "rate": "4.000", "extension_days": 30}]}],
 "clients": [{"key": "marrow", "name": "Marrow Tin Co.", "owner": {"display_name": "Ines Marrow", "email": "ines@example.test", "password": "pass-ines-1"},
   "registrations": [{"key": "ny", "state": "NY", "frequency": "monthly", "first_period": "2026-05",
     "returns": [{"period": "2026-05", "status": "prepared", "gross_sales": "1000.00", "tax_due": "40.00"}]}]}]}
```

| Field | Type | Required | Default |
|---|---|---|---|
| `bookkeeper.display_name`, `.email`, `.password` | string | yes | — |
| `bookkeeper.reminder_hour` | integer 6 to 21 | no | 9 |
| `now` | instant | no | absent: the practice follows real time |
| `states` | array | no | the six catalogue states in Seed data |
| `states[].code`, `.name`, `.zone` (IANA) | string | yes | — |
| `states[].holidays` | array of dates | no | `[]` |
| `states[].editions` | array of Edition, at least one | yes | — |
| `clients` | array | no | `[]` |
| `clients[].key`, `.name` | string | yes | — |
| `clients[].owner.display_name`, `.email`, `.password` | string | yes | — |
| `clients[].registrations` | array | no | `[]` |
| `registrations[].key`, `.state`, `.frequency`, `.first_period` | string | yes | — |
| `registrations[].returns` | array | no | `[]` |
| `returns[].period` | one of the generated periods | yes | — |
| `returns[].status` | `not_started`, `prepared`, `client_approved`, `filed`, `packeted` | no | `not_started` |
| `returns[].gross_sales`, `.tax_due` | amount | no | null when `not_started`, otherwise `"0.00"` |

A registration creates returns for its first 12 monthly, 4 quarterly or 1 yearly periods starting at `first_period`. `returns` only overrides status and amounts. `now` freezes the practice clock before any return, status or reminder is created. Each seeded status implies its history, stamped at the practice's instant. A seeded `prepared` return awaits approval. `client_approved` adds one `approved` approval by the owner. `filed` adds that approval and `filed_at`. `packeted` adds both, then renders the packet before answering: if the render fails, the return stays `filed` with `packet` `pending`. Every fixture return starts at version 1 whatever its status. Fixtures send no approval, approved or filed notices. They do create reminders, as in Business rules. Emails must be unique across all practices. Invalid fields answer 422 with dotted paths as keys, for example `{"errors":{"clients[0].registrations[0].frequency":"Choose a filing frequency."}}`.

201 body: `{"practice_id","session","clients":{"<key>":{"id","owner_session","registrations":{"<key>":{"id","returns":{"<period>":"<return id>"}}}}}}`. `session` and `owner_session` are values of the `duefield_session` cookie for the bookkeeper and that client's owner.

`POST /api/grading/clock` with `{"practice_id","now":instant}` answers 200 `{"now":instant}`. An unknown practice answers 404 `{"error":"not_found"}`. A malformed instant answers 422 `{"errors":{"now":"Send an instant like 2026-06-22T15:00:00.000Z."}}`.

### Business rules (DP-09, DP-10, DP-12, DP-13, DP-17 to DP-19, DP-21, DP-23, DP-24, DP-27, DP-28, DP-41, DP-43)

**Error order (whole API).** Body limits and bad JSON in Server boundary come first. Then:
1. Anything the caller cannot open answers 404 `{"error":"not_found"}`: an unknown id, another practice's record, or, for an owner, another client's return, packet, reminders or approval action. A signed-out caller can open no record, so a signed-out request that names a record id answers 404.
2. A signed-out request to a route that needs a session and names no record answers 401 `{"error":"sign_in_required"}`.
3. A write the caller's role may not make answers 403 `{"error":"forbidden"}`. That includes owner reads of reminders, states, clients and the CSV.
4. State conflicts answer 409, in this order:
   - a stale version: `{"error":"conflict","return":{"version":<n>,"status":"<status>"},"changed_by":"<display name>"}`
   - an illegal status move: `{"error":"illegal_status","status":"<current status>"}`
   - a late extension: `{"error":"deadline_passed"}`
5. Validation answers 422 `{"errors":{"<field>":"<message>"}}` with the messages from Feedback states.

No route answers 503: mail and packet work waits instead (Services).

**Roles.** A bookkeeper does everything in their own practice. A client owner reads their own client's returns and packets and approves or sends back. An owner has none of these controls: `Mark prepared`, `Save amounts`, `Mark filed`, `File extension`, `Record amendment`, `Add client`, `Register <client> in a state`, `Edit holidays for <code>`, `Publish rule change for <code>`.

**Status moves.** Every persisted change adds one to `version`, including a packet completing. A derived overdue flag never changes the version.

| From | Action | Who | To | Effects |
|---|---|---|---|---|
| `not_started` | prepare, with amounts | bookkeeper | `prepared` | the return awaits approval; approval request to the owner |
| `not_started`, `prepared` | save amounts | bookkeeper | unchanged | on `prepared`: the return awaits approval again and a fresh approval request goes out |
| `prepared` (awaiting approval) | approve | owner | `client_approved` | approval recorded; approved notice |
| `prepared` (awaiting approval), `client_approved` | send back, with reason | owner | `prepared` | `sent_back` recorded; the return no longer awaits approval, so it leaves the owner's waiting list and the Awaiting approval count until the bookkeeper saves its amounts again; sent back notice |
| `client_approved` | file | bookkeeper | `filed` | `filed_at`; filed notice; unsent reminders cancelled and removed; packet render queued |
| `filed` | PDF returned | system | `packeted` | packet revision stored |
| `filed`, `packeted` | amend, with amounts | bookkeeper | `amended` | amendment kept with the original figures; new packet render queued |
| `amended` | replacement PDF returned | system | `packeted` | new revision stored |
| `not_started`, `prepared`, `client_approved` | extension (once) | bookkeeper | unchanged | due date moves |

Every other move answers `illegal_status` with the current status. That covers, for example, approving a `not_started` return or a `prepared` one that was sent back, filing a `prepared` one, amending an `amended` one, preparing a `prepared` one, and a second extension. The only way out of `amended` is the system moving it to `packeted`.

**Version rule.** Every write to a return carries `version`. When it differs from the stored version, the write answers the conflict body and persists nothing, even if the request also had invalid fields. When two saves race, the first to commit wins.

**Due dates.** A return uses the edition in effect at its period's start: the edition with the latest `effective_date` not after the period's first day in the state's zone. An edition takes effect at 00:00 local on its date. The nominal due date is the edition's `due_day`:
- of the month after the period, for monthly returns;
- of the month after the quarter, for quarterly returns;
- of January after the year, for yearly returns.

A `due_day` past the month's end is clamped to the month's last day. That date is the unextended nominal date. A granted extension adds days to it to give the extended nominal date; without an extension the two are equal. Carry-forward then applies to the extended nominal date. `next_business` moves forward past Saturdays, Sundays and the state's listed holidays until it reaches a business day. `fixed` never moves. Worked examples, with due day 20 and period `2026-05` (June 20, 2026 is a Saturday): `next_business` gives Monday June 22. With `2026-06-22` also listed as a holiday, it gives Tuesday June 23. `fixed` stays on Saturday June 20.

The deadline instant (`due_at`) is 11:59:59.999 pm on the carried date in the state's zone. For example, Tuesday June 23, 2026 in `America/New_York` is `2026-06-24T03:59:59.999Z`. `America/Phoenix` has no daylight saving. The due date and deadline are computed when the return is created and stored. They change only through the recalculations below or an extension.

**Display strings (sent by the server).**
- `due_line`: `Due <Weekday> <Month> <day>, 11:59 pm <zone label>`, for example `Due Monday June 22, 11:59 pm Eastern`.
- Moved dates: `Carried from <Weekday> <Month> <day>`, naming the date before carrying, for example `Carried from Saturday June 20`.
- Zone labels: `America/New_York` is `Eastern`, `America/Chicago` is `Central`, `America/Denver` is `Mountain`, `America/Phoenix` is `Arizona`, `America/Los_Angeles` is `Pacific` and `Pacific/Honolulu` is `Hawaii`. Any other zone prints its IANA name.
- `practice_deadline_label`: the deadline as `<h:mm am/pm> Central`.
- `offset_hours`: the state's UTC offset minus Central's at the deadline.
- Period labels: `May 2026`, `Q2 2026`, `2026`.

**Recalculation.** Publishing an edition immediately recalculates only the `not_started` returns of that state whose periods start on or after its effective date. Each takes the edition then in effect, and the response lists their ids. For such a return that already has an extension, the unextended nominal date is recomputed from the new edition and the extension days recorded when it was granted are added again. Saving a holiday list recalculates every `not_started` return of that state: its extended nominal date (the unchanged unextended nominal date plus any recorded extension days) is carried forward again under the new list. Every other return keeps its stored due date, edition, due day and rate. Worked example: with an edition effective `2020-01-01` at rate `4.000`, publishing one effective `2026-06-01` at rate `4.500` leaves the `2026-05` return at `4.000`, and the `not_started` `2026-06` return shows `4.500`. After a due date changes, unsent reminders are recomputed from it.

**Overdue.** A return in `not_started`, `prepared` or `client_approved` is overdue when the practice's current instant is after its `due_at`. At the deadline instant itself it is not overdue; one millisecond later it is. `filed`, `packeted` and `amended` returns are never overdue. Every badge, count, API field and CSV value uses this edge. A band strip's past mark uses the current instant at or after `due_at`.

**Extensions.** A first extension on an unfiled return is accepted when the current instant is at or before `due_at`, and refused with `deadline_passed` one millisecond later or more, changing nothing. The new extended nominal date is the unextended nominal date plus the edition's `extension_days` calendar days (recorded on the return), then carried forward again. Worked example: the `2026-05` New York return due June 22 (nominal June 20), extended at `2026-06-23T03:59:59.999Z` with 30 extension days, moves to Monday July 20, 2026. `filed`, `packeted` and `amended` returns, and any return already extended, answer `illegal_status`.

**Reminders.** Each return in `not_started`, `prepared` or `client_approved` has two reminders, lead 7 and lead 1. The scheduled instant is the state-local due date minus the lead in calendar days, read at the bookkeeper's `reminder_hour` in `America/Chicago`, so the wall-clock hour holds across daylight saving. Worked examples with hour 9:
- Due March 12, 2026 (daylight saving starts March 8): lead 7 is `2026-03-05T15:00:00.000Z` and lead 1 is `2026-03-11T14:00:00.000Z`.
- Due November 5, 2026 (daylight saving ends November 1): lead 7 is `2026-10-29T14:00:00.000Z` and lead 1 is `2026-11-04T15:00:00.000Z`.

After a registration, a fixture, a reminder-hour change and every clock change, the server attempts at once every pending reminder with `scheduled_for` at or before the current instant, including leads already past. Nothing is sent one millisecond before `scheduled_for`. A reminder is `sent` only after Mailpit accepted it. A failed attempt stays `pending` and is retried every `SERVICE_RETRY_SECONDS` until it is sent or filing cancels it. No return and lead is ever sent twice. Sent records stay when a due date changes.

**The practice clock.** Each bookkeeper account is one practice, with its own current instant. A practice whose clock was never set follows real time. `POST /api/grading/clock`, or a fixture's `now`, freezes it at the given instant until it is set again. The clock may move backwards: overdue flags, counts and band marks recompute, but saved actions, sent reminders and versions never change because time moved. The practice clock governs business timestamps and eligibility only. Session expiry, retries, the live band and animations use real elapsed time and keep running while the practice clock is frozen. A clock request commits the instant, recomputes state, attempts due reminders and queues live events before it answers. When a practice follows real time, a deadline passing is pushed to open screens within the live band. The server alone decides everything that depends on time. The browser's clock and time zone never change a date, a status, a mark or a count on screen: pages render the strings and flags the server sends.

**Live band.** Every change reaches every open screen allowed to see it within 2 seconds, with no reload. Changes include status, amounts, version, overdue flags, counts, reminders, packet state, banners and new returns. Owners receive only their own client's changes. A clock change refreshes open screens without changing the month or year being viewed.

**Calendar windows.** Month and year views select returns by their current state-local due date. Today, the default month and the default year use Central's current date on the practice clock. "This week" is Monday to Sunday in Central time.

**Derived counts.** A day's `data-count` is the number of returns whose current state-local due date is that day. The Overdue count (`<n> overdue`) and the Awaiting approval count (`<n> awaiting approval`) count returns whose `awaiting_approval` is true. On `/today` they are practice-wide and equal `counts` from `GET /api/returns` with no `month` or `year`. On `/month/<yyyy>-<mm>` they are limited to the shown month and equal `counts` for that `month`. The year view count is the filtered rows and equals `counts.total` for that `year`, `status` and `state`.

### Services (DP-14, DP-15, DP-30, DP-31, DP-33, DP-35, DP-36, DP-37)

**Mailpit (SMTP at `SMTP_HOST`:`SMTP_PORT`, From `MAIL_FROM`).** Every message is plain text and sent once per event. Each counts as sent only when Mailpit accepts it. While mail is unreachable, messages wait and retry every `SERVICE_RETRY_SECONDS` real seconds.

| Message | Trigger | To | Subject | Body includes |
|---|---|---|---|---|
| Preparation reminder | its scheduled instant | bookkeeper | `<client> <state> <period> due in 7 days` or `<client> <state> <period> due in 1 day` | the due line and `/returns/<id>` |
| Approval request | prepare, or saving amounts on a prepared return | owner | `Please approve <client> <state> <period>` | `Gross sales <g>`, `Tax due <t>`, the due line, `/returns/<id>` |
| Approved notice | owner approves | bookkeeper | `<client> approved <state> <period>` | owner's name, both amounts |
| Sent back notice | owner sends back | bookkeeper | `<client> sent back <state> <period>` | owner's name, the reason |
| Filed notice | bookkeeper files | owner | `<client> <state> <period> was filed` | the due line, both amounts |

**Gotenberg (`GOTENBERG_URL`).** Filing or amending queues a render of the app's own packet HTML to PDF. The return becomes `packeted` only when Gotenberg returns the PDF bytes. The bytes are stored in Postgres as a numbered revision (1, 2, …) and served by the packet route. A render that is held or fails leaves `packet` `pending` (status `filed` or `amended`) and retries every `SERVICE_RETRY_SECONDS`. The earlier revision stays served meanwhile. The packet's text includes:
- `Duefield filing packet` and `Packet revision <n>`
- the client name, `<State name> (<code>)` and the period label
- the due line, plus `Carried from …` when the date moved
- `Rule edition effective <YYYY-MM-DD>`, `Due day <n>` and `Reference rate <rate>%`
- `Gross sales <g>` and `Tax due <t>`
- `Approved by <owner name> on <Weekday> <Month> <day>, <h:mm am/pm> Central`
- `Extended to <Weekday> <Month> <day>` when extended
- for each amendment, `Amended: gross sales <old> to <new>, tax due <old> to <new>`

**Outages.** The app checks SMTP and Gotenberg reachability every `SERVICE_RETRY_SECONDS` whether or not work is waiting. That check drives the banners in Feedback states and `GET /api/health`, which answers `{"status":"unavailable"}` while either service is unreachable and `{"status":"ok"}` when Postgres, mail and PDF all answer. When a service answers again, waiting reminders, notices and renders go out within two retry periods, with no restart. Each reminder sent and packet ready is announced on open screens.

**Postgres (`DATABASE_URL`).** Holds practices, users, sessions, clients, registrations, states, holidays, editions, returns with history and versions, approvals, extensions, amendments, reminder and notice jobs, packet revisions and each practice's clock. The schema is applied idempotently every time the app serves.

### Seed data (DP-01, DP-51)

The database starts empty. A practice made by sign-up, or by a fixture with no `states`, starts with this six-state catalogue. Every rule, rate and holiday is invented and has no link to any real tax authority. Each state has one edition effective `2020-01-01`.

| Code | Name | Zone | Due day | Carry | Rate | Extension days | Holidays |
|---|---|---|---|---|---|---|---|
| AZ | Arizona | America/Phoenix | 20 | fixed | 5.600 | 30 | 2026-01-01, 2026-07-03, 2026-11-26, 2026-12-25 |
| CO | Colorado | America/Denver | 20 | next_business | 2.900 | 30 | 2026-01-01, 2026-05-25, 2026-07-03, 2026-09-07, 2026-11-26, 2026-12-25, 2027-01-01 |
| HI | Hawaii | Pacific/Honolulu | 20 | next_business | 4.000 | 30 | 2026-01-01, 2026-03-26, 2026-06-11, 2026-07-03, 2026-08-21, 2026-09-07, 2026-11-26, 2026-12-25 |
| IL | Illinois | America/Chicago | 20 | next_business | 6.250 | 30 | 2026-01-01, 2026-01-19, 2026-02-12, 2026-05-25, 2026-07-03, 2026-09-07, 2026-11-11, 2026-11-26, 2026-11-27, 2026-12-25, 2027-01-01 |
| NY | New York | America/New_York | 20 | next_business | 4.000 | 30 | 2026-01-01, 2026-01-19, 2026-02-16, 2026-05-25, 2026-06-19, 2026-07-03, 2026-09-07, 2026-10-12, 2026-11-11, 2026-11-26, 2026-12-25, 2027-01-01 |
| WA | Washington | America/Los_Angeles | 25 | next_business | 6.500 | 30 | 2026-01-01, 2026-05-25, 2026-07-03, 2026-09-07, 2026-11-11, 2026-11-26, 2026-11-27, 2026-12-25 |

The people and businesses in examples (Ada Finch, Ines Marrow, Marrow Tin Co.) are invented. Worked examples with no year are 2026.

## Technical requirements

### Deployment (DP-49)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build` and served by the backend.

`/app/run.json` holds string `install`, `build` and `serve` commands plus `"_schema":"run-manifest-v1"`, for example:
```
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```
The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` answers as published in API. Outage copies run the same build with one dependency pointed at a closed local port, each with its own empty database.

### Configuration and secrets (DP-52)

Read at start from the environment, never hard-coded and never sent to the browser:

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection | — |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit SMTP | — |
| `MAIL_FROM` | From line for every message | `Duefield <reminders@duefield.test>` |
| `GOTENBERG_URL` | Gotenberg HTTP API | — |
| `GRADING_KEY` | Enables the grading routes | none (routes answer 404) |
| `SERVICE_RETRY_SECONDS` | Seconds between service checks and retries of waiting work | 30 |
| `SESSION_TTL_SECONDS` | Session lifetime in seconds | 604800 |
| `APP_PUBLIC_PORT` | Listening port | 4173 |

### Server boundary (DP-50)

- Same-origin only. The server sends no cross-origin sharing headers. A state-changing request whose `Origin` header names another origin answers 403 `{"error":"cross_origin"}`.
- JSON bodies are limited to 100,000 bytes; exactly 100,000 is allowed. A larger body answers 413 `{"error":"too_large"}`. A non-JSON content type on a JSON route answers 415 `{"error":"unsupported_media_type"}`. Malformed JSON answers 400 `{"error":"bad_json"}`. These checks come before the error order.
- The server serves only the built frontend assets, the API and the pages. It never serves source files, source maps of server code, `.env`, `/.git/config`, `run.json`, `package.json` or lockfiles. Paths with `..`, encoded traversal or a leading dot segment answer 404. Unknown `/api/` paths answer 404 `{"error":"not_found"}`. Unknown pages answer 404 with the not-found screen.
- If mail or PDF is unreachable at boot, the app starts, serves, shows the banners and recovers when the service returns, without a restart. If Postgres is unreachable at boot, the app keeps retrying the connection every 2 seconds and serves once it connects.

### Browser support and performance (DP-47, DP-48)

Current Chromium, Firefox and WebKit, at 375x812 (touch), 768x1024 and 1280x800. Every screen is usable within three seconds of navigation with a fixture of 100 returns. A day band opens within a quarter of a second of Enter, not counting its animation. Fonts are bundled with the app, and no page loads anything from another origin.

## Working rules

- IF-01: `/app/run.json` is a JSON object with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) with its licence, plus the bundled Tilt Warp and Plus Jakarta Sans font files (OFL-1.1) and Lucide icons.
- IF-03: Shipped packages use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1 (fonts) licences.
- IF-04: Postgres is the only datastore: no SQLite, Redis, file-based state or in-memory store that outlives a request beyond caches rebuilt from Postgres.
- IF-05: `package-lock.json` is committed and matches `package.json`.
- IF-06: The provided service configuration and compose files are left unchanged.
- IF-07: Fonts and icons are bundled in the app, and the built frontend makes no request to another origin.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript (no `any` in domain code), and names follow this brief's domain terms: return, registration, edition, carry-forward, due date, deadline, extension, amendment, packet, reminder, practice clock.
- Each domain rule is decided in exactly one place in the source: the status move table, the due date and carry-forward computation, the overdue edge, the extension edge, the reminder schedule and the error order.
- The browser never derives a date, status, overdue flag or count from its own clock. It renders what the server sends.
- Every error response uses the one published shape for its status, built in one place.
- There is no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive check for a state the types already rule out.
- Provider effects (sent, packeted) are recorded only from the provider's confirmed answer, never set ahead of it.
- There are no features beyond this brief.
