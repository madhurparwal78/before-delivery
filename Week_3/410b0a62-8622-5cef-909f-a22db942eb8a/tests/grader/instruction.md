# Ottermere Sport Tempoline

Tempoline is a web app for planning endurance training. It serves self-coached amateur cyclists, runners and triathletes, and the small independent coaches who manage ten to forty athletes. Athletes plan their week, build structured workouts, upload or hand-enter completed sessions, and see planned-versus-completed compliance, weekly stress totals and a fitness, fatigue and form model whose arithmetic is published in this brief. Coaches link to athletes with a coach code, plan for several athletes, apply plan templates from a start date or count them back from an event date, copy weeks between athletes, comment on workouts and watch uploads arrive live. The server is written in TypeScript and also serves the UI. It uses two backing services: PostgreSQL is the system of record, and S3-compatible object storage (MinIO) keeps the original activity files byte for byte. The following are out of scope: self sign-up and outside sign-in providers, email of any kind, payments and paid plans, device sync, the FIT format, maps, AI coaching, and any datastore or service beyond those two.

## Problem and users

Amateur endurance athletes plan by a training-stress budget. A workout counts as done only when its completed stress lands close to what was planned. Fitness and fatigue are exponentially weighted from daily stress, and every number depends on the threshold power or pace in force on that day. Today's tools hide that arithmetic. When a coach backdates a new FTP, nobody knows which workouts get re-scored. A plan counted back from a race drifts by a day around a clock change. A late-evening run in one time zone lands on the wrong calendar day for a coach elsewhere. Missed-workout colours flip on whatever clock the browser has. Coaches spend Sunday evenings reconciling spreadsheets against the calendar. Athletes who can't trust their form number before a key event either over-taper or arrive fatigued.

- **Athlete** (daily use): plans the week, builds structured workouts, uploads files or hand-enters sessions, and reads compliance, weekly totals and fitness/fatigue/form they can verify by hand.
- **Coach** (daily use): plans for several linked athletes, applies plan templates or counts them back from event dates, copies weeks between athletes, comments on workouts and watches uploads arrive live.

## Journeys

1. **Build a session by keyboard.** An athlete starts on their calendar. They open the builder for a day and use only the keyboard to add a warm-up, an interval block set to 5 × (4 minutes at 110% / 3 minutes at 55%) and a cool-down. They watch the totals and the announced text change on every key. They save the workout to the calendar, or save it to the library and place it on a day. In the end state the day shows the workout with its planned stress, and the workout is still there after a reload.
2. **Upload and read the numbers.** An athlete has a planned ride on a past day. They upload a ride file to that day and see its normalised power, intensity factor and stress. The day turns to its compliance state with a legend label, and the week totals, the today form banner and the fitness chart all change to agree.
3. **Coach moves and plans live.** A coach and an athlete each have the athlete's calendar open. The coach drags one planned workout to another day and moves a second one by keyboard. The coach then counts a 12-week plan back from the athlete's race date. The athlete's open calendar shows every change within 3 seconds without a reload. The confirmation says how many planned workouts were skipped because their days had already passed.
4. **Upload seen by the coach, comment seen by the athlete.** An athlete uploads a run while the coach's dashboard is open. The coach's athlete row, notice and calendar show the run's stress and compliance within 3 seconds. The coach comments, and the athlete sees the comment and a notice appear within 3 seconds.
5. **Threshold change.** A coach records a new FTP effective from a past date. Only the athlete's completed rides on or after that date change their stress. Earlier rides keep theirs, and the series is recomputed from that date onward.
6. **Linking and unlinking.** An athlete enters a coach code in the footer form. The coach accepts the request from the inbox, and the athlete's calendar appears in the coach's switcher. Later the athlete removes the coach. The coach's open view of that athlete becomes the not-found view within 3 seconds, and every later request for that athlete answers 404.
7. **On a phone.** On a 375-px-wide phone an athlete swipes the week rail to next week, hand-logs a run from the calendar with field errors announced, and sees the run's stress and the day's compliance state. With reduced motion on, the week swaps instantly, and the totals and the address still update.
8. **Storage outage.** Object storage is down. An athlete's upload is refused with the outage message, and the chosen file stays selected. No workout, stress or chart change appears. A hand-entered session still saves.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Builder steps and mirror** The workout builder offers the five step kinds with the published defaults and limits, and it shows every step both in the drawn graph and in a Steps list that exposes each part's kind, duration and target as text and attributes.
- **DP-02 — Builder keyboard editing** With the Steps list focused, the published keys select, resize, retarget, repeat, reorder and delete steps, and each change is announced with the published text.
- **DP-03 — Planned stress totals** The builder's duration, planned TSS and planned IF follow the published formula and display rules, and they update on every change.
- **DP-04 — Saving and placing built workouts** A built workout saves to a calendar day or to the library, a library workout can be placed on a day by drag or keyboard, and the result is still there after a reload.
- **DP-05 — Builder graph dragging** With a mouse or touch, dragging a step's right edge changes its duration and dragging its top edge changes its target, each snapped and clamped as published.
- **DP-06 — Moving planned workouts** A planned workout moves to another day by drag or by keyboard pick-up and drop with the published announcements, and the server refuses the illegal moves with the published statuses.
- **DP-07 — Week totals and tally** Each week shows planned and completed TSS totals, the six-state compliance tally and the week's form, computed by the published rules.
- **DP-08 — Live calendar updates** Any change to an athlete's workouts, thresholds or links appears in every other open view of that athlete within 3 seconds without a reload.
- **DP-09 — Activity file format** Uploads accept the published CSV and JSON activity formats, with 1-Hz samples starting at t = 0.
- **DP-10 — Power stress scoring** A ride file is scored with the published normalised power, IF and TSS formulas against the FTP in force on its day.
- **DP-11 — Storage-confirmed uploads** An upload becomes a completed workout only after storage confirms the stored object's size and SHA-256, as qualified in Services.
- **DP-12 — Planned versus completed** Every calendar item carries one of the six published compliance states, decided by the published ratio bands and same-day matching rule.
- **DP-13 — Effective-dated thresholds** A threshold applies from its effective date, and adding one re-scores exactly the completed workouts in its span and recomputes the series from its first day.
- **DP-14 — Run stress scoring** A run file or manual run is scored with the published normalised speed, IF and rTSS formulas against the threshold pace in force on its day.
- **DP-15 — Athlete-local dates** Workout dates, week boundaries, totals and the stress series always follow the athlete's own time zone, whoever is viewing.
- **DP-16 — Server-decided missed state** Planned and missed states come only from the server's configured today, and a wrong device clock changes nothing on screen.
- **DP-17 — Daily fitness series** The server stores one daily fitness, fatigue and form series per athlete, computed by the published formulas and recomputed whenever its inputs change.
- **DP-18 — Fitness chart and table** The fitness chart card draws the stored series with the centred week highlighted, mirrors it in a table, and lets the keyboard step a focus marker day by day with the published announcement.
- **DP-19 — Chart animation timing** Chart changes animate for the configured chart duration with motion, and apply at once with reduced motion.
- **DP-20 — Deleting workouts** Deleting a workout removes its row, its stored file and its stress in one step, or nothing at all.
- **DP-21 — Numbers agree everywhere** After any upload, entry, move, delete or re-score, the calendar, week rail, tiles, banner, chart and table show the same values as the API, also after a reload.
- **DP-22 — Activity file checks** A refused file is checked in the published order, answers the published status and message, and creates nothing.
- **DP-23 — Upload error display** A refused upload shows the server's message in an alert that receives focus, and it keeps the dialog open with the file still selected.
- **DP-24 — Plan templates and rest weeks** A plan template is a numbered run of days, and every fourth week is applied as a rest week at the published share of duration.
- **DP-25 — Applying plans** A coach applies a plan from a start date or counts it back from an event date, days that have passed are skipped, and the published confirmation reports what was created, skipped and kept.
- **DP-26 — Wall-clock start times** Planned start times are stored as local wall-clock times, so a clock change keeps 06:30 at 06:30 under the published gap and overlap rule.
- **DP-27 — Copy week dialog** The Copy week dialog supports keyboard multi-select, keeps Tab and Shift+Tab inside itself, closes on Escape and returns focus to its opener.
- **DP-28 — Copying to another athlete** Copying planned workouts to another linked athlete keeps their weekdays and start times, scores them with the target athlete's thresholds and skips days that have passed.
- **DP-29 — Coach dashboard** The coach's athlete list shows each linked athlete's week totals and latest session, and a new session updates it in place within 3 seconds.
- **DP-30 — Workout comments and notices** Comments on a workout appear for both parties within 3 seconds, with the published in-app notice.
- **DP-31 — Original file download** Downloading a completed workout's original returns exactly the uploaded bytes, with the SHA-256 the workout detail shows.
- **DP-32 — Coach link requests** A coach code creates a link request that the coach accepts or declines before it expires, following the published state machine.
- **DP-33 — Not found for unshared data** Anything a user may not open answers 404 as a page and in the API, never 403, and the published error-check order applies everywhere.
- **DP-34 — Removing a coach** When an athlete removes a coach, the coach loses access on their next request, and the coach's open views switch to the not-found view within 3 seconds.
- **DP-35 — Manual session entry** A hand-entered session is validated with the published messages and scored with the published average-based formulas.
- **DP-36 — Phone calendar** At phone width the calendar, its week rail and Log a session work by touch, with no horizontal overflow.
- **DP-37 — Storage outage** With storage unreachable, health reports unavailable, uploads and downloads refuse with the published outage message, and manual entry still works.
- **DP-38 — Grading route** A key-protected seed and reset route creates and clears the published records and returns their ids and one-time sign-in links.
- **DP-39 — Health and boot** The health endpoint and boot behaviour follow the published responses and schema-on-serve rule.
- **DP-40 — Sign-in and sessions** Users sign in with email and password or a one-time link, and they hold a session until they sign out.
- **DP-41 — Week peek rail** The week peek rail advances by button, arrow key, swipe or dot with the published motion, address update, chart band move and announcement, and it swaps instantly with reduced motion.
- **DP-42 — Home sections** The today form banner, weekly sport total tiles, compliance ring rows, recent uploads drift wall and event countdown band show the published values.
- **DP-43 — Look and feel** Every screen carries the published visual direction: the solid cobalt today band, navy pills, near-white ground, white rounded tiles and wide extra-bold numerals.
- **DP-44 — Responsive layouts** Every screen works at 375x812, 768x1024 and 1280x800 with no horizontal overflow and tap targets at least 44 px.
- **DP-45 — Configuration from environment** Every service URL, credential, limit, timer and clock setting is read from the published environment variables, never hard-coded and never sent to the browser.

## Frontend

### Screens and layout (DP-01, DP-18, DP-29, DP-36, DP-41, DP-42, DP-44)

All screens share the **athlete switcher header**. It is a white bar fixed to the top of the window. The product wordmark sits on the left and the navigation in the middle. For athletes the navigation is Calendar, Builder and Coaches. For coaches it is Athletes, Plans and Inbox, and Athletes opens a dropdown of linked athletes. On the right are the athlete switcher (coaches only), the Notices live region and a Sign out pill. At 375 px wide the navigation folds into a Menu button that opens a drawer. At every viewport (375×812, 768×1024, 1280×800) no page scrolls horizontally, except that the week peek rail clips its neighbours at the viewport edge.

- **Sign in** (`/sign-in`): a centred white card with the email and password fields, a Sign in pill and the error alert.
- **Athlete calendar home** (`/athletes/<athlete id>`, optional `?week=YYYY-Www`). From top to bottom:
  1. The **today form banner**, a full-width cobalt band.
  2. The **fitness chart card**, which overlaps the band's lower edge.
  3. The **week peek rail**, which runs full-bleed.
  4. The **weekly sport total tiles**, a row of five white tiles.
  5. The **compliance ring rows**, three alternating rows.
  6. The **recent uploads drift wall**.
  7. The **event countdown band**.
  8. The **navy footer coach-code form**.

  A Workout library panel sits beside the rail at 1280 and below it at 768 and 375. Athletes reach their own home from `/`. Coaches reach any linked athlete's home through the switcher.
- **Builder** (`/athletes/<athlete id>/builder`, optional `?date=YYYY-MM-DD` or `?workout=<workout id>`). At 1280 the drawn graph sits on the left two-thirds and the Steps list with its totals on the right third. At 768 and 375 they stack: graph, totals, then Steps list. The add-step pills and the save pills sit under the totals.
- **Workout detail** (`/workouts/<workout id>`): the title, date and start time, the Session numbers group, the planned steps with their target watts or pace, the compliance label, the original file's name, size and SHA-256 with a Download original link, the Comments list with its form, and the Delete workout pill.
- **Coach dashboard** (`/coach`, coaches' `/`): the Athletes table with one row per linked athlete.
- **Plans** (`/plans`, coaches): a list of plan template tiles, each with an apply pill.
- **Inbox** (`/inbox`, coaches): the Link requests list.
- **Coaches** (`/coaches`, athletes): linked and pending coaches. Only linked coaches have a remove pill; pending coaches have none.
- **Not-found view**: the response for any page the user may not open, and the live replacement for an open view whose access was removed. It has a large display line, one sentence and one pill back home.

At 375 px the rail's centred week is about 85% of the viewport wide, with slivers of its neighbours at the edges. The previous/next arrows and the dots sit below the track. The five tiles become a two-column grid, the ring rows stack with the ring above its text, and dialogs fill the screen as sheets.

### Public screens and controls (DP-01, DP-02, DP-04, DP-06, DP-18, DP-23, DP-25, DP-27, DP-29, DP-30, DP-32, DP-34, DP-35, DP-40, DP-41, DP-42)

Only the roles, names and attributes below are public. Text in angle brackets is a placeholder. `<Day>` is a date written `Thu 5 Nov`, `<Long day>` is `Thu 5 Nov 2026`, and `<Monday>` is the week's Monday written `2 Nov 2026`. Numbers and dates follow the display rules in Business rules.

| Where | Role and accessible name | Visible copy and public attributes |
|---|---|---|
| Sign in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `alert` | Pill reads "Sign in" |
| Header | `banner`; `combobox "Athlete"` (coaches); `button "Menu"` (375 px) opening `dialog "Menu"`; `button "Sign out"`; `status "Notices"` | Notices texts in Feedback states |
| Today form banner | `region "Today"`; `button "Plan a workout"`; `button "Log a session"` | Display line `Form <tsb>.` with `data-tsb`; line `Fitness <ctl> · fatigue <atl> coming into today` with `data-ctl`, `data-atl` |
| Fitness chart card | `group "Fitness chart"` (focusable); `status "Chart readout"`; `table "Fitness table"` | Group has `data-focus-date`, `data-animating` (`true`/`false`) and `data-animation-ms`; each day point has `data-date`, `data-ctl`, `data-atl`, `data-tsb`; the highlight band has `data-week`; table columns Date, TSS, Fitness, Fatigue, Form, and each row has `data-date`, `data-tss`, `data-ctl`, `data-atl`, `data-tsb` |
| Week peek rail | `region "Week rail"` (focusable); `button "Previous week"`, `button "Next week"`; `button "Week of <Monday>"` dots (`aria-current="true"` on the centred one); `button "Load earlier weeks"`, `button "Load later weeks"`; `status "Week announcements"`; `status "Calendar announcements"` | The rail has `data-week` (centred ISO week) and `data-moving` (`true` while the track moves) |
| Week tile | `group "Week of <Monday>"` | `data-week`, `data-active`, `data-planned-tss`, `data-completed-tss`, `data-tsb`; text `Planned <x> TSS`, `Completed <x> TSS`, `Form <tsb>`; tally line `On target <n> · Close <n> · Off target <n> · Missed <n> · Unplanned <n> · Planned <n>` with `data-count-on-target`, `data-count-close`, `data-count-off-target`, `data-count-missed`, `data-count-unplanned`, `data-count-planned` |
| Day chip | `group "<Day>"`; `button "Log session on <Day>"`; `button "Plan on <Day>"` | `data-date` |
| Calendar item | `listitem` in its day chip; `link "<title>"`; `button "Move <title>"` (planned items with no match only) | `data-compliance` (one of the six states), `data-planned-tss`, `data-completed-tss`, `data-tss`, `data-duration-s`, `data-sport`; legend label text (Business rules) |
| Workout library | `region "Workout library"`; per item `button "Place <name>"` | Item text `<name> · <duration> · <planned TSS> TSS` |
| Weekly sport total tiles | `group "Bike stress"`, `group "Run stress"`, `group "Bike time"`, `group "Run time"`, `group "Sessions"` | Each has `data-value` |
| Compliance ring rows | `group "This week"`, `group "Last 4 weeks"`, `group "Last 12 weeks"` | Text `<p>% on target` or `No planned sessions`, with `data-percent` |
| Recent uploads drift wall | `region "Recent uploads"` | Tiles `<title> · <Day> · <tss> TSS` |
| Event countdown band | `region "Next event"` | Countdown text (Business rules) with `data-days` |
| Footer (athlete) | `contentinfo`; `textbox "Coach code"`; `button "Send request"` | Footer text for coaches: `Your coach code: <code>` |
| Log a session | `dialog "Log a session"`; `tab "Upload a file"`, `tab "Enter by hand"`; `textbox "Day"`; `radiogroup "Sport"` with `radio "Bike"`, `radio "Run"`; `textbox "Title"`; upload tab: file input labelled "Activity file", `button "Upload session"`, `alert` region; manual tab: `textbox "Duration"` (H:MM:SS), `textbox "Average power"` (bike), `textbox "Average pace"` (run, M:SS per km), `button "Save session"`; `status "Session status"` | Field errors are attached to their fields |
| Builder | `radiogroup "Sport"`; `textbox "Workout name"`; `textbox "Day"`; `button "Add warm-up"`, `button "Add steady"`, `button "Add interval"`, `button "Add recovery"`, `button "Add cool-down"`; `group "Workout graph"`; `listbox "Steps"` with one `option` per part; `group "Workout totals"`; `button "Save to calendar"`; `button "Save to library"`; `status "Builder announcements"` | Graph has `data-seconds-per-px` and `data-percent-per-px`; each bar has `data-step-index` and `data-part` (`work`, `recovery` or empty), with handles `data-handle="duration"` and `data-handle="target"`; each option has `data-kind`, `data-duration-s`, `data-target-pct`, `data-step-index` and, for interval parts, `data-repeat`; totals text `Duration <H:MM:SS>`, `Planned <x> TSS`, `IF <x.xx>` with `data-duration-s`, `data-planned-tss`, `data-if` |
| Workout detail | `heading` (title); `group "Session numbers"`; `link "Download original"`; `list "Comments"`; `textbox "Comment"`; `button "Post comment"`; `button "Delete workout"` opening `dialog "Delete workout?"` with `button "Delete"`, `button "Keep it"` | Numbers group text `Normalised power <n> W` (bike file) or `Normalised pace <M:SS> /km` (run file), `IF <x.xx>`, `<x> TSS`, `Duration <H:MM:SS>`; attributes `data-np`, `data-if`, `data-tss`, `data-duration-s`; text `SHA-256 <64 hex>` with `data-sha256` |
| Thresholds (athlete home, below the tiles) | `region "Thresholds"`; `textbox "FTP"`; `textbox "Threshold pace"`; `textbox "Effective from"`; `button "Save threshold"`; `status "Threshold status"` | History list `FTP <n> W from <Long day>` and `Threshold pace <M:SS> /km from <Long day>` |
| Coach dashboard | `table "Athletes"` with columns Athlete, Planned, Completed, Latest session, Compliance | Each row has `data-athlete-id`; cells carry `data-planned-tss`, `data-completed-tss`, `data-tss` and `data-compliance` |
| Copy week (coach, athlete home) | `button "Copy week"` opening `dialog "Copy week"`; `checkbox "<title> · <Day>"` per planned workout; `button "Select all"`; `combobox "Copy to athlete"`; `textbox "Target week"`; `button "Copy workouts"`; `button "Cancel"`; `status "Copy status"` | |
| Plans | `button "Apply <plan name>"` opening `dialog "Apply plan"`; `combobox "Athlete"`; `radio "Start on"`, `radio "Count back from event"`; `textbox "Date"`; `textbox "Event name"`; `button "Apply plan"`; `status "Plan status"` | |
| Inbox | `list "Link requests"`; `button "Accept <athlete name>"`, `button "Decline <athlete name>"` | Item text `<athlete name> wants to join` or `<athlete name> — Expired` |
| Coaches | `list "Your coaches"`; `button "Remove <coach name>"` opening `dialog "Remove coach?"` with `button "Remove"`, `button "Keep"` | Pending items read `<coach name> — Pending` and have no Remove button; the Remove button appears only for accepted links |
| Not-found view | `heading "Not found"`; `link "Back to home"` | Sentence `This page isn't available to you.` |

### Interactions (DP-02, DP-04, DP-05, DP-06, DP-18, DP-23, DP-27, DP-36, DP-41)

- **Builder keys.** These keys work while the Steps list has focus. Each one changes the selected part and announces the matching Builder text from Feedback states.
  - Up / Down: select the previous / next option. Selection does not wrap.
  - Left / Right: shorten / lengthen the selected part by 30 seconds.
  - Shift+Up / Shift+Down: raise / lower its target by 1 percent.
  - `+` / `-`: add / remove one interval repeat. This works on either interval part.
  - Alt+Up / Alt+Down: move the whole step one position up / down.
  - Delete or Backspace: remove the whole step. Selection moves to the next step, or to the previous one if the removed step was last.
  - Changes beyond a limit leave the value unchanged and announce it again.
  - The add buttons insert the new step after the step that holds the selection, or at the end if nothing is selected. They select the new step's first part and return focus to the Steps list.
- **Builder drag.** Pointer and touch dragging work alike. Grabbing a bar's right-edge handle and moving horizontally changes that part's duration. Grabbing its top-edge handle and moving vertically changes its target, and moving up raises it. Interval parts are edited on any repetition and apply to all repetitions. Totals update during the drag, and the change is announced on release. The graph's `data-seconds-per-px` and `data-percent-per-px` give the scale, which is fixed for the whole drag.
- **Moving a planned workout.**
  - With a mouse or touch, drag the calendar item onto another day chip. The target chip shows an accent outline while hovered.
  - With the keyboard, focus `Move <title>` and press Enter or Space to pick it up. Left / Right choose the previous / next day within the centred week, and they stop at Monday and Sunday. Enter or Space drops the workout, and Escape cancels. Focus stays on the Move button throughout. Each step is announced in "Calendar announcements".
  - `Place <name>` in the Workout library works the same way and creates a planned workout on the chosen day.
- **Week rail.** The following move the rail by one week: `Previous week` / `Next week`; ArrowLeft / ArrowRight while the rail region has focus; a horizontal swipe longer than 40 px across the track; or a week dot. Focus stays on the control used. At the first or last loaded week the matching arrow is disabled, and the keys and swipes in that direction do nothing. `Load earlier weeks` / `Load later weeks` add four weeks at that end without moving the centre. The address's `?week=` changes in place, without a history entry.
- **Chart.** With the chart group focused, ArrowLeft / ArrowRight move the focus marker one day, Home / End jump to the first / last drawn day, and each move announces the Chart readout text. The marker starts on today, the last drawn day, so `data-focus-date` is today's date when the chart first appears.
- **Dialogs and drawers.** Every dialog and the Menu drawer opens with focus on its first field or control. Tab and Shift+Tab wrap inside it. Escape closes it, and focus returns to the control that opened it. In the Copy week dialog, Space toggles the focused checkbox, and `Select all` checks every box.
- **Upload errors.** When an upload is refused, focus moves to the dialog's alert. The dialog stays open and the chosen file stays selected.
- **Hover and press.** Pills and tiles respond as described in Motion and effects. All actions also work by keyboard, with a visible focus ring.

### Visual design (DP-43, DP-44)

The direction is **seed**: a sporty training platform recast under the brand Ottermere Sport.

- **Typefaces.** The display face is **Encode Sans Expanded** in ExtraBold. It is wide and heavy and is used for headlines and every training numeral: form, weekly totals, tiles and countdowns. The body face is **Inter** Regular and Medium, with tabular figures in tables. Both fonts are bundled with the app.
- **Type scale.** Each heading step is one third larger than the step below. The banner's form line is the largest text in the product, and the week tiles' totals are the next largest.
- **Palette roles.**
  - Ground: a cool near-white behind every section.
  - Surface: pure white for the header, tiles, cards, forms and dialogs.
  - Ink: deep navy for headings, body text, primary pills and the footer ground.
  - Muted ink: slate for secondary text.
  - Muted ink on dark: a light blue-grey for footer links.
  - Accent: saturated cobalt for the today band, secondary pills, focus rings and the fitness line.
  - Second accent: violet for the band's single hard-edged parallelogram, the fatigue line and the storage-outage bar.
  - Glow: a soft pink halo behind the compliance rings.
  - On-accent: white for text on cobalt.
- **Contrast.** All text meets WCAG 2.2 AA contrast.
- **Density** is comfortable: a generous rhythm between home sections and steady small gaps inside working screens.
- **Composition.** A content column about 1280 px wide is centred on the near-white ground with wide side margins. The white header sticks at the top. Below it, the solid cobalt **today form banner** fills edge to edge. It carries one hard-edged violet parallelogram and three thin translucent white slanted outlines, with no gradient. The centred form line reads, for example, "Form −8.4." in white display type. Under it sit the fitness and fatigue line and two navy pills. The navy-framed **fitness chart card** rises over the band's bottom edge, with rounded top corners only. The full-bleed **week peek rail** follows. Its centred week fills about two-thirds of a wide screen, and the neighbouring weeks are cut off at the viewport edges.
- **Working screens.**
  - All actions are fully rounded pills, and all tiles and cards have one consistent rounded corner.
  - The calendar and library are white tiles on the ground.
  - Compliance shows as a thin coloured strip on the item's left edge plus its text label, never colour alone.
  - The builder and chart sit on white surfaces, each with its list or table mirror directly below.
  - Form fields are tall, white and Inter, with a thick cobalt focus ring.
  - Empty states are one large display line plus one pill.
  - The storage-outage message is an inline navy-on-white panel with a violet left bar, never a toast.
  - The footer is navy with light blue-grey links and a white coach-code field beside a cobalt pill.
- **Tap targets.** Every control is at least 44 px in both directions on touch layouts.
- **Media.** There are no photos and no third-party logos. Rings, the countdown band and the chart are drawn in SVG.

### Motion and effects (DP-19, DP-41, DP-42)

- **Pills and tiles.** On hover a pill lightens slightly and gains a soft shadow over about a quarter of a second. On press it dips a hair. Tiles gain a soft shadow on hover over the same time. Colour changes take about a sixth of a second.
- **Header.** A dropdown's chevron flips over about a fifth of a second, and the panel fades in within a third of a second.
- **Section entrances.** On the athlete home, section headings and ring rows fade up a short distance, once, when about a fifth of the section is in view. Each takes under half a second.
- **Week peek advance (signature).** At rest the centred week tile shows its Monday date, planned and completed totals, the tally and seven day chips, and its neighbours peek in at both edges. Any advance control sets these steps in motion:
  1. The track slides by one tile plus its gap in a little under half a second. It starts briskly and settles softly, and the rail's `data-moving` is `true` for that time.
  2. In the same frame as the track starts, the chart card's highlighted band begins sliding to the new week's seven days over the same time.
  3. About a sixth of a second after the track starts, the new week's totals line and pill fade in while rising a short distance into place, over about a third of a second.
  4. The new active dot fills with navy in about a sixth of a second.
  5. The address's `?week=` updates, and "Week announcements" announces the week text from Feedback states.

  Moving back plays the same steps in reverse direction.
- **Chart.** When the series changes (after an upload, entry, delete or re-score), the lines morph to their new values over `CHART_ANIMATION_MS` milliseconds. While they morph, the chart group's `data-animating` is `true`, and `data-animation-ms` shows the configured duration.
- **Recent uploads drift wall.** The two rows of tiles drift sideways in opposite directions as the section passes through the viewport. Each moves by about half a tile width in total. The drift stops when scrolling stops and plays backwards when the user scrolls back.
- **No loops.** There is no autoplay, no looping marquee, no spinner that runs without a pending request, and no decorative animation not named here.
- **Reduced motion.** When the user prefers reduced motion:
  - The rail swaps weeks instantly with no slide and no rise, and `data-moving` never becomes `true`.
  - The chart band jumps, and the chart applies new values at once with `data-animating` staying `false` and `data-animation-ms` reading `0`.
  - The drift wall and section entrances are static.
  - Dots, the address, totals and every announcement update exactly as they do with motion.

### Feedback states (DP-02, DP-06, DP-07, DP-18, DP-23, DP-25, DP-28, DP-29, DP-30, DP-32, DP-34, DP-35, DP-37, DP-41)

Every async action has the four states below. Pending: the action's pill shows the pending text, is disabled, and its status region announces it. Success: the status region announces the success text. Field errors: they appear under their field, are linked to it, and the first invalid field receives focus. Outage: the outage panel or the server's message appears in the section's alert.

| Action | Pending | Success (in its status region) |
|---|---|---|
| Sign in | `Signing in…` | (navigates home) |
| Upload session | `Uploading <file name>…` | `Saved <title>: <tss> TSS.` |
| Save session (manual) | `Saving…` | `Saved <title>: <tss> TSS.` |
| Save to calendar | `Saving…` | `Saved <name> on <Day>.` |
| Save to library | `Saving…` | `Saved <name> to your library.` |
| Save threshold | `Saving…` | `FTP <n> W from <Long day>. Re-scored <n> workouts.` or `Threshold pace <M:SS> /km from <Long day>. Re-scored <n> workouts.` (`workout` when the count is 1) |
| Apply plan | `Applying…` | `Added <created> workouts to <athlete name>'s calendar. Skipped <skipped> on days that have already passed.` If `<kept>` is above 0, this second sentence follows: `<kept> days already had workouts; they were kept alongside the plan.` (`workout`/`day` when the count is 1) |
| Copy workouts | `Copying…` | `Copied <created> workouts to <athlete name>. Skipped <skipped> on days that have already passed.` (`workout` when 1) |
| Send request (coach code) | `Sending…` | The form is replaced by `Request sent to <coach name>. They'll appear under Coaches once they accept.` |
| Accept / Decline | — | The item is replaced by `<athlete name> is linked.` / `<athlete name> was declined.` |
| Post comment | `Posting…` | The comment appears at the end of the Comments list |
| Delete workout | `Deleting…` | Navigates to the athlete home, and Notices announces `Deleted <title>.` |

Announcements:

- **Builder announcements**:
  - Duration or target change: `<label> <H:MM:SS> at <target>%.`, where `<label>` is Warm-up, Steady, Interval work, Interval recovery, Recovery or Cool-down.
  - Repeat change: `Interval repeats <n>.`
  - Add: `<step label> added.`
  - Remove: `<step label> removed.`
  - Reorder: `<step label> moved to position <p> of <count>.`

  `<step label>` is the kind label, with an interval step called `Interval`.
- **Calendar announcements**:
  - Pick up: `Picked up <title>. Use the arrow keys to choose a day, then press Enter to drop or Escape to cancel.`
  - Each arrow press: `<Day>`
  - Drop: `Moved <title> to <Day>.` (or `Placed <name> on <Day>.` from the library)
  - Escape: `Move of <title> cancelled.`
  - Refused move: the server's message, and the item returns to its day.
- **Week announcements**: `Week of <Monday>: planned <x>, completed <x>, form <tsb>`
- **Chart readout**: `<Long day>: <tss> TSS, fitness <ctl>, fatigue <atl>, form <tsb>`
- **Notices** (header; all within 3 seconds of the server change):
  - To linked coaches when an athlete's completed workout is created: `<athlete name> logged <title>: <tss> TSS.`
  - To the other party when a comment is posted: `<author name> commented on <title>.`
  - To the coach when a link request arrives: `<athlete name> sent a link request.`
- **Field errors** show the server's validation messages from Business rules. File errors show the server's message in the upload alert. A sign-in failure shows its server message in the sign-in alert.
- **Storage outage**: the upload panel's alert shows the outage panel with the 503 message from Services. The file stays selected and no other part of the page changes.
- **Not-found view**: shown in place, with the copy in Public screens, whenever an open view's athlete or workout stops being visible.

## Backend

### API (DP-04, DP-06, DP-11, DP-13, DP-20, DP-22, DP-25, DP-28, DP-29, DP-30, DP-31, DP-32, DP-33, DP-35, DP-37, DP-38, DP-39, DP-40)

**General conventions.**

- All `/api` requests and responses are JSON (`application/json; charset=utf-8`), except uploads (`multipart/form-data`), originals (the stored type) and the live stream (`text/event-stream`).
- A JSON request body may be up to 1,000,000 bytes, and a body of exactly that size is accepted. Larger bodies answer `413 {"error":"payload_too_large","message":"The request is too large."}`. The grading seed route accepts up to 20,000,000 bytes.
- Errors take one of two shapes. Validation errors are `422 {"errors":{"<field>":"<message>"}}`, listing every invalid field. Everything else is `{"error":"<code>","message":"<text>"}`.
- Unauthenticated `/api` calls answer `401 {"error":"unauthenticated","message":"Sign in to continue."}`.
- Anything that doesn't exist or isn't visible to the caller answers `404 {"error":"not_found","message":"Not found."}`. This includes another athlete's records, an unlinked athlete's records, and an endpoint reserved for the other role.
- The order of error checks is stated once, in Business rules.
- API numbers are unrounded. Dates are `YYYY-MM-DD` local dates. Weeks are ISO weeks `YYYY-Www`.

**Objects.**

- **Workout**:

  ```json
  {"id","athlete_id","kind":"planned"|"completed","sport":"bike"|"run","title",
   "date","start_local":"HH:MM"|null,"start_utc":"<ISO instant>"|null,
   "duration_s","steps":[Step]|null,"planned_tss":number|null,"planned_if":number|null,
   "tss":number|null,"if":number|null,"np_w":number|null,"ns_mps":number|null,
   "source":"builder"|"library"|"plan"|"copy"|"manual"|"file","version":int,
   "file":{"name","size","sha256","content_type"}|null}
  ```

- **Step**: `{"kind":"warmup"|"steady"|"recovery"|"cooldown","duration_s":int,"target_pct":int}` or `{"kind":"interval","repeat":int,"work":{"duration_s","target_pct"},"recovery":{"duration_s","target_pct"}}`.
- **Item** (a calendar entry): `{"planned":Workout|null,"completed":Workout|null,"compliance":"on-target"|"close"|"off-target"|"missed"|"unplanned"|"planned","ratio":number|null}`.

**Endpoints.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | — | `200 {"status":"ok"}` or `200 {"status":"unavailable"}` (storage unreachable) | `503 {"status":"starting"}` only until the database is first reached |
| `POST /api/grading/seed` | Header `X-Grading-Key`; body in Seed data | `200` response in Seed data | wrong or missing key `404`; `422` field path errors |
| `POST /api/grading/reset` | Header `X-Grading-Key` | `200 {"status":"reset"}` | wrong or missing key `404` |
| `GET /auth/one-time/<token>` | — | `303` to `/` with the session cookie | used or unknown token: not-found page, `404` |
| `POST /api/auth/sign-in` | `{"email","password"}` | `200 {"user":Me}` plus session cookie | `401 {"error":"invalid_credentials","message":"Email or password is incorrect."}` |
| `POST /api/auth/sign-out` | — | `204` | |
| `GET /api/me` | — | `200 {"id","role":"athlete"|"coach","name","email","tz","coach_code":string|null,"today":"YYYY-MM-DD"}` | |
| `GET /api/athletes` | — | `200 {"athletes":[{"id","name","tz","week":{"week","planned_tss","completed_tss"},"latest":Item|null}]}` (coach: accepted links; athlete: self) | |
| `GET /api/athletes/<id>` | — | `200 {"id","name","tz","series_start","thresholds":[{"kind":"ftp"|"pace","value","effective_from"}],"events":[{"name","date"}]}` | |
| `POST /api/athletes/<id>/thresholds` | `{"kind":"ftp"|"pace","value":int,"effective_from":"YYYY-MM-DD"}` | `201` new date or `200` same date replaced: `{"threshold":{...},"rescored":int,"series_from":"YYYY-MM-DD"}` | |
| `GET /api/athletes/<id>/weeks?week=&before=&after=` | `week` defaults to today's week; `before`/`after` 0–12, default 4 | `200 {"today","weeks":[{"week","monday","planned_tss","completed_tss","tsb","tally":{"on-target","close","off-target","missed","unplanned","planned"},"sports":{"bike_tss","run_tss","bike_s","run_s","sessions"},"days":[{"date","items":[Item]}]}]}` | |
| `GET /api/athletes/<id>/series?from=&to=` | dates; default series start to today | `200 {"days":[{"date","tss","ctl","atl","tsb"}]}` | |
| `POST /api/athletes/<id>/workouts` | `{"date","start_local"?,"sport","title","steps"?|"duration_s"?|"library_id"?}` (exactly one of the last three) | `201 {"workout":Workout}` | unknown library id `404` |
| `GET /api/workouts/<id>` | — | `200 {"workout":Workout,"item":Item,"comments":[Comment]}` | |
| `PATCH /api/workouts/<id>` | `{"version":int,"date"?,"start_local"?,"title"?,"steps"?}` | `200 {"workout":Workout}` | `409 stale`; `409 locked` |
| `DELETE /api/workouts/<id>` | — | `204` | `503 storage_unavailable` |
| `POST /api/athletes/<id>/manual` | `{"date","sport","title","duration_s","avg_power_w"?|"avg_pace_s_per_km"?}` | `201 {"workout":Workout}` | |
| `POST /api/athletes/<id>/uploads` | multipart parts `file`, `sport` (CSV), `date` (CSV, or JSON without `start`), `title` (optional; default `Ride` or `Run`) | `201 {"workout":Workout}` | `413`, `415`, `422` per file checks; `503 storage_unavailable` |
| `GET /api/workouts/<id>/original` | — | `200` the stored bytes, the stored content type, `Content-Disposition: attachment; filename="<name>"`, `X-Content-SHA256: <hex>` | workout without a file `404`; `503 storage_unavailable` |
| `GET /api/workouts/<id>/comments` | — | `200 {"comments":[{"id","author_id","author_name","body","created_at"}]}` | |
| `POST /api/workouts/<id>/comments` | `{"body"}` | `201 {"comment":Comment}` | |
| `GET /api/library` | — | `200 {"library":[{"id","name","sport","steps","duration_s","planned_tss","planned_if"}]}` (caller's own) | |
| `POST /api/library` | `{"name","sport","steps"}` | `201 {"item":...}` | |
| `DELETE /api/library/<id>` | — | `204` | |
| `GET /api/plans` | — (coach) | `200 {"plans":[{"id","name","weeks","entries":[{"day","start_local","sport","title","steps"|null,"duration_s"}]}]}` | |
| `POST /api/plans` | `{"name","weeks","entries":[...]}` (coach) | `201 {"plan":...}` | |
| `POST /api/plans/<id>/apply` | `{"athlete_id","mode":"start"|"event","date","event_name"?}` | `201 {"created","skipped","kept","first_day","last_day","workouts":[Workout]}` | |
| `POST /api/athletes/<id>/copy-week` | `{"week","workout_ids":[...],"to_athlete_id","to_week"}` (coach) | `201 {"created","skipped","workouts":[Workout]}` | unlinked target `404` |
| `POST /api/links` | `{"coach_code"}` (athlete) | `201 {"link":{"id","coach_id","coach_name","status":"requested","expires_at"}}` | `409 already_linked`; `409 already_requested` |
| `GET /api/links` | — | `200 {"links":[{"id","coach_id","coach_name","athlete_id","athlete_name","status","expires_at"}]}`, with `status` reported as `expired` when past `expires_at` | |
| `POST /api/links/<id>/accept`, `/decline` | — (coach) | `200 {"link":...}` | `409 expired`; `409 not_pending` |
| `DELETE /api/links/<id>` | — (either party) | `204` (status becomes `removed`) | `409 not_pending` if not accepted |
| `GET /api/live` | — | Event stream (see Business rules) | |

The `409` bodies are:

- `stale`: `This workout changed since you opened it. Reload to see the latest.`
- `locked`: `Completed sessions stay on their day.`
- `already_linked`: `You are already linked with this coach.`
- `already_requested`: `You already have a pending request with this coach.`
- `expired`: `This request has expired. Ask the athlete to send a new one.`
- `not_pending`: `This request is no longer pending.`

Each is returned as `{"error":"<code>","message":"<text>"}`.

**Pages.** Page routes follow the same visibility rule. A page the user may not open answers HTTP 404 with the not-found view. An unauthenticated page request answers `303` to `/sign-in`.

### Business rules (DP-03, DP-06, DP-07, DP-08, DP-09, DP-10, DP-12, DP-13, DP-14, DP-15, DP-16, DP-17, DP-21, DP-22, DP-24, DP-25, DP-26, DP-28, DP-32, DP-33, DP-34, DP-35, DP-42)

**Error-check order (whole API).** Checks run in this order:

1. Authentication: `401`.
2. Existence and visibility: `404`.
3. Validation: `413`, then `415`, then `422`. For uploads, request fields are checked before file contents, and file contents in the file-check order below.
4. State conflict: `409`.
5. Provider failure: `503`.

The first failing check answers.

**Who sees what.** An athlete sees only their own records. A coach sees, edits, plans, copies and comments for athletes with an accepted link, and no others. Plans, copy-week, accept and decline are coach-only. Sending a coach code is athlete-only. Every other case answers 404. Removing a link takes effect on the coach's next request.

**Today and time zones.** The device clock may be wrong, so the server owns "today".

- Today is `APP_TODAY`, or the seed's `today` override until the next reset, on every athlete's calendar. The page reads it from `/api/me`, never from the browser.
- Every athlete has an IANA time zone, which defaults to `APP_TZ`. Workout dates, Monday-start ISO weeks, totals, compliance and the series all use the athlete's local calendar, whoever is viewing.
- A file's `start` is converted to the athlete's zone to get its date and start time. A `start` without an offset is read as the athlete's local time. For example, a run starting `2026-11-04T17:10:00Z` for an athlete in Pacific/Auckland is dated Thu 5 Nov 2026, starts 06:10, and shows on 5 Nov for a coach in Europe/London too.
- A completed workout dated after today is refused (validation messages below).

**Display rules.** Rounding is for display only, and every computation uses unrounded values. Rounding is half away from zero. A value within 0.000000001 of a half counts as the half.

- Normalised power: whole watts, written `216 W`.
- IF: 2 decimals, `0.86`.
- TSS, planned TSS, CTL, ATL and totals: 1 decimal. TSS is written `87.4 TSS`.
- Form (TSB): 1 decimal with a sign: `+3.2`, `−6.1` (true minus sign), and exactly `0.0` for zero after rounding.
- Durations: `H:MM:SS`, for example `0:55:00`.
- Paces: `M:SS /km`, rounded to whole seconds.
- Percentages: whole numbers.
- Every displayed number carries a `data-*` attribute holding the same rounded value, without unit or plus sign and with an ASCII minus. Durations are held in whole seconds.

**Stress formulas.**

- **Power files.** Samples are 1 Hz, and `duration_s` is the sample count.
  - Normalised power (NP): take the 30-sample trailing mean, with the first value at the 30th sample. Raise each mean to the 4th power, average them, and take the 4th root. Files with fewer than 30 samples use the mean power.
  - IF = NP / FTP.
  - TSS = duration_s × NP × IF / (FTP × 3600) × 100.
  - Example: 3,600 samples at 200 W with FTP 250 give NP 200 W, IF 0.80, 64.0 TSS.
  - Example: 30 samples at 200 W then 30 at 230 W give rolling means 200, 201, …, 230 (31 values). NP is 215.556… (shown 216 W), and with FTP 250 IF is 0.86 and TSS is 1.2.
- **Run files.** Normalised speed (NS) uses the same 30-sample, 4th-power method on speed in m/s.
  - Threshold speed = 1000 / threshold pace (seconds per km).
  - IF = NS / threshold speed.
  - rTSS = (duration_s / 3600) × IF² × 100.
  - Normalised pace = 1000 / NS seconds per km.
  - Example: 3,600 samples at 3.0 m/s with threshold pace 5:00 /km give IF 0.90 and 81.0 TSS.
- **Manual entries.** The average stands in for NP or NS.
  - Bike: IF = average power / FTP.
  - Run: IF = threshold pace / average pace.
  - TSS = hours × IF² × 100.
  - Example: 1:00:00 at 200 W with FTP 250 gives 64.0 TSS.
  - Example: 0:45:00 at 5:30 /km with threshold 5:00 /km gives IF 0.91 and 62.0 TSS.
- **Planned workouts.**
  - Planned TSS = the sum over steps of duration_s × (target% / 100)² / 3600 × 100. An interval counts repeat × (work + recovery).
  - Planned IF = √(planned TSS / (duration hours × 100)).
  - Example: warm-up 0:10:00 at 60%, 5 × (0:04:00 at 110% / 0:03:00 at 55%), cool-down 0:10:00 at 50% gives Duration 0:55:00, Planned 58.1 TSS, IF 0.80.
  - Planned stress does not depend on thresholds. Step targets are shown with watts (bike) or pace (run) worked out from the athlete's threshold in force on the workout's day, for example `110% · 275 W`.

**Thresholds.**

- Each athlete has a history of FTP (watts, 50–600) and threshold pace (seconds per km, 150–900), each dated by local effective-from date.
- A completed workout is scored with the latest entry of its kind (FTP for bike, pace for run) whose effective-from date is on or before the workout's date.
- Adding an entry re-scores exactly the completed workouts of that sport dated from its effective date up to the day before the next later entry. The series is recomputed from that date. Earlier workouts keep their stress on every surface.
- Posting an entry with the same kind and date replaces it.
- Example: an athlete at FTP 250 since 2026-09-01 has 1:00:00 rides at NP 200 W on 2026-09-30 and 2026-10-01, both 64.0 TSS. Adding FTP 265 effective 2026-10-01 changes the 1 Oct ride to IF 0.75 and 57.0 TSS. The 30 Sep ride stays 64.0.

**Daily series.**

- For each athlete, from `series_start` to today, TSS(d) is the sum of unrounded completed TSS on local date d.
- CTL(d) = CTL(d−1) + (TSS(d) − CTL(d−1)) / 42.
- ATL(d) = ATL(d−1) + (TSS(d) − ATL(d−1)) / 7.
- The values for the day before `series_start` are the athlete's start values, 0 unless seeded.
- **Form on day d uses yesterday's values:** TSB(d) = CTL(d−1) − ATL(d−1).
- Example from 0: one day at 64 TSS gives CTL 1.5, ATL 9.1 and form 0.0 that day. Form is −7.6 the next day. With no session that next day, CTL is 1.5, ATL is 7.8, and form is −6.3 the day after.
- The series is stored and recomputed in the same transaction as any workout or threshold change, from the first affected day. Every surface reads that one stored series.
- A week's form is the TSB of the earlier of the following Monday and today.
- **Drawn range.** The fitness chart and its table draw every day from `series_start` through today, both inclusive, one point and one row per day. Days after today are never drawn and have no row, and the range does not depend on which weeks the rail has loaded or on `Load earlier weeks` / `Load later weeks`. Home jumps the focus marker to `series_start` and End to today. The highlighted week band covers the centred week's seven days, clipped to the drawn days when part of that week lies after today.

**Compliance.**

- **Matching.** On each local day and sport, planned workouts are paired with completed workouts in order. Each list is sorted by start time (workouts without a start time last), then by creation.
- **Ratio.** For a pair, r = completed / planned. TSS is used when the planned workout has a planned TSS; otherwise duration is used.
- **States.**

  | State | When |
  |---|---|
  | `on-target` | 0.80 ≤ r ≤ 1.20 |
  | `close` | 0.50 ≤ r < 0.80 or 1.20 < r ≤ 1.50 |
  | `off-target` | r < 0.50 or r > 1.50 |
  | `missed` | an unpaired planned workout dated before today |
  | `unplanned` | an unpaired completed workout |
  | `planned` | an unpaired planned workout dated today or later |

- **Legend labels**, in the same order: On target, Close, Off target, Missed, Unplanned, Planned.
- **Week totals.** Planned is the sum of planned TSS of every planned workout in the week; duration-only plans add 0. Completed is the sum of completed TSS. The tally counts items by state.
- **Weekly sport tiles** show the centred week's completed bike TSS, completed run TSS, bike and run completed time, and the completed session count.
- **Compliance rings** show the share of on-target items among paired items plus missed items, as a whole percent. They cover the centred week, the 4 weeks ending with it, and the 12 weeks ending with it. A zero denominator reads `No planned sessions`.

**Moving and editing planned workouts.**

- Every change increments `version`, and a PATCH with an older version answers `409 stale`.
- A completed workout, or a planned workout that is paired, cannot change its date (`409 locked`).
- A planned workout can only be created, moved or placed on today or a later day. Earlier days get the `date` message "Pick today or a later day."

**Builder steps.**

- Default durations and targets:

  | Step | Default |
  |---|---|
  | Warm-up | 0:10:00 at 60% |
  | Steady | 0:20:00 at 75% |
  | Interval | repeat 4, work 0:03:00 at 105%, recovery 0:03:00 at 55% |
  | Recovery | 0:05:00 at 50% |
  | Cool-down | 0:10:00 at 50% |

- Durations are whole multiples of 30 seconds from 0:00:30 to 4:00:00. Targets are whole percents from 30 to 200. Repeats run from 1 to 20. A workout has at most 50 steps.
- A drag snaps the duration to the nearest 30 seconds (halves round up) and rounds the target to the nearest whole percent (halves away from zero), then clamps both.

**Activity file format.** A file is CSV (`.csv`) or JSON (`.json`), recognised by file-name extension, in any letter case.

- **CSV.** Line 1 is exactly `t,power,heart_rate,speed`. Each further line is one sample with four comma-separated fields: `t` (integer), `power` (empty or an integer 0–2500 W), `heart_rate` (empty or an integer 0–250), and `speed` (empty or a decimal 0–30 m/s). Lines may end in CRLF, and one trailing empty line is allowed. CSV files take their sport from the `sport` part and their date from the `date` part.
- **JSON.** The file is `{"sport":"bike"|"run","start":"<ISO-8601 date-time, optional>","samples":[{"t":0,"power":..,"heart_rate":..,"speed":..}]}`. Absent channels may be omitted or null.
- In both formats, `t` starts at 0 and increases by exactly 1 per sample. Bike files need `power` in every sample, and run files need `speed`.

**File checks, in order.** The first failure answers, and a refused file creates nothing.

| # | Check | Status | Body |
|---|---|---|---|
| 1 | File larger than `ACTIVITY_MAX_BYTES` (equal is allowed) | 413 | `{"error":"file_too_large","message":"This file is larger than <max> bytes."}` |
| 2 | Not `.csv` or `.json` | 415 | `{"error":"unsupported_type","message":"Upload a .csv or .json activity file."}` |
| 3 | Request fields invalid | 422 | Field messages below |
| 4 | Unreadable header or JSON | 422 | `{"errors":{"file":"Line 1 must be t,power,heart_rate,speed."}}`; or `{"errors":{"file":"The file is not valid activity JSON."}}`; or, with no samples, `{"errors":{"file":"The file has no samples."}}` |
| 5 | First bad row | 422 | `{"errors":{"file":"Line <n> is not a valid sample."}}` (CSV, with the header as line 1) or `{"errors":{"file":"Sample <n> is not a valid sample."}}` (JSON, 1-based) |
| 6 | Sport missing its required channel | 422 | `{"errors":{"file":"Every sample needs power for a bike file."}}` or `{"errors":{"file":"Every sample needs speed for a run file."}}` |
| 7 | More than `ACTIVITY_MAX_SAMPLES` samples (equal is allowed) | 422 | `{"errors":{"file":"This file has more than <max> samples."}}` |
| 8 | No threshold in force | 422 | `{"errors":{"threshold":"No FTP is set on or before this day."}}` or `{"errors":{"threshold":"No threshold pace is set on or before this day."}}` |

`<max>` is the configured limit written as a plain integer. A whole upload request larger than `ACTIVITY_MAX_BYTES` + 65,536 bytes answers check 1's body.

**Validation messages.** Each field has exactly one message.

| Field | Message |
|---|---|
| `date`, `effective_from` | `Enter a date as YYYY-MM-DD.` |
| `date` (completed, after today) | `Completed sessions cannot be in the future.` |
| `date` (before `series_start`) | `This day is before the athlete's training history starts.` |
| `date` (planned, before today) | `Pick today or a later day.` |
| `title`, `name` | `Enter a title of 1 to 80 characters.` |
| `start_local` | `Enter a time as HH:MM.` |
| `sport` | `Choose bike or run.` |
| `steps` | `Add at least one step.`, `Each step needs a duration from 0:00:30 to 4:00:00 in 30-second steps.`, `Each target must be a whole percent from 30 to 200.`, `Repeats must be from 1 to 20.` or `A workout has at most 50 steps.` (the first that applies) |
| `duration_s` | `Enter a duration from 0:01:00 to 24:00:00.` |
| `avg_power_w` | `Enter an average power from 1 to 2000 W.` |
| `avg_pace_s_per_km` | `Enter a pace from 2:00 to 20:00 per km.` |
| `value` (FTP) | `Enter an FTP from 50 to 600 W.` |
| `value` (pace) | `Enter a threshold pace from 2:30 to 15:00 per km.` |
| `coach_code` | `No coach uses that code.` |
| `body` | `Write a comment of 1 to 1000 characters.` |
| `weeks` | `A plan runs 1 to 24 weeks.` |
| `event_name` | `Enter an event name of 1 to 60 characters.` |
| `mode` | `Choose start or event.` |
| `week`, `to_week` | `Enter a week as YYYY-Www.` |
| `workout_ids` | `Choose planned workouts from that week.` |

**Plans.**

- A plan template has `weeks` (1–24) and entries. Each entry has a day index 1 to 7 × weeks, a start time and either steps or a duration.
- Weeks 4, 8, 12, 16, 20 and 24 are rest weeks. Every step duration, or plain duration, in them is multiplied by 0.6 and snapped to the nearest 30 seconds, with a minimum of 0:00:30. Targets and repeats stay the same.
- Start mode: day k falls on start date + (k − 1). Event mode: day 1 falls on event date − (7 × weeks − 1), so the last plan day is the event date, and the event (name and date) is recorded for the athlete.
- Entries on days before today are not created and count as skipped.
- Existing workouts are never changed. `created` counts the plan entries added. `skipped` counts plan entries (not days) that fall before today. `kept` counts the days that received at least one new entry and already held any planned or completed workout; days without an entry and days before today are never counted.
- Example: with the demo set, Mara applies "Twelve to race day" to Tavi in start mode from 2026-11-02. Week 1's entries fall on 3, 5 and 7 Nov, and 3 Nov is before today. The result is created 35, skipped 1, kept 2 (5 Nov and 7 Nov already held Tavi's planned workouts), and the confirmation reads `Added 35 workouts to Tavi Rennick's calendar. Skipped 1 on days that have already passed. 2 days already had workouts; they were kept alongside the plan.`
- Example: a 12-week plan counted back from Sun 20 Dec 2026 starts Mon 28 Sep 2026. Its rest weeks are 19–25 Oct, 16–22 Nov and 14–20 Dec.

**Wall-clock start times.**

- Planned start times are stored as local dates and local `HH:MM`. `start_utc` is derived from the athlete's zone on that date.
- A local time that does not exist (in a spring-forward gap) moves later by the gap's length. A repeated local time uses its first, earlier occurrence.
- Example: a 12-week plan counted back from Sun 12 Apr 2026 for an athlete in Europe/Berlin starts Mon 19 Jan 2026. A 06:30 workout is 05:30Z before 29 Mar 2026 and 04:30Z after it, and it reads 06:30 throughout.

**Copying.**

- The selected planned workouts are copied to the target athlete's `to_week` on the same weekdays with the same start times and steps. Targets are shown against the target athlete's thresholds.
- Days before today are skipped. The source is unchanged.

**Coach links.**

- An athlete's coach code creates a `requested` link that expires `LINK_REQUEST_TTL_HOURS` after creation.
- Transitions: `requested` → `accepted` | `declined` | `expired` (expiry is decided by the server's clock); `accepted` → `removed`. Every other transition answers `409` as listed in API.
- A new request is allowed after `declined`, `expired` or `removed`.
- Of two simultaneous accept or decline calls, exactly one succeeds and the other answers `409 not_pending`.

**Live updates.**

- `GET /api/live` streams only the events the user may see:
  - `event: change` with data `{"athlete_id","what":"workouts"|"series"|"comments"|"links"|"thresholds"|"events","workout_id"?}`
  - `event: notice` with data `{"text"}`
- A comment line is sent every `LIVE_HEARTBEAT_MS` milliseconds.
- Open views refresh affected regions in place within 3 seconds of a committed change. When access ends, the open view switches to the not-found view.

**Countdown.** The band reads `<n> days to <event name>`, `1 day to <event name>` or `Race day: <event name>` for the athlete's earliest event dated today or later. With no such event it reads `No event on the calendar`. Here n is the event date minus today.

**Recent uploads.** The drift wall shows the athlete's 10 most recent completed workouts, whether they came from a file or a hand entry. They are sorted by date, newest first, then by creation time, newest first. Tiles at odd positions (1st, 3rd, …) go to row 1 and tiles at even positions go to row 2, each row keeping that order. With no completed workouts the wall shows the line `No sessions yet`. The wall refreshes with the other live updates.

### Services (DP-11, DP-20, DP-31, DP-37)

- **PostgreSQL** (`DATABASE_URL`) holds users and sessions, links, threshold history, the library, plans, planned and completed workouts, comments, events and the stored daily series. Schema setup runs idempotently on every serve.
- **Object storage** (`S3_*`) keeps every uploaded original.
  - **Object key:** `activities/<athlete id>/<workout id>.csv` or `.json`, with content type `text/csv` or `application/json` and metadata `sha256` (lowercase hex of the bytes) and `filename`.
  - **Upload sequence:** an upload validates, scores, stores the object, then reads its metadata back. The workout row and the series change are committed only when the stored size and `sha256` match the upload. If the database commit fails afterwards, the object is deleted.
  - **Download:** returns the stored bytes unchanged.
  - **Delete:** deleting a file workout deletes the object first. The row and series change are committed only after the deletion is confirmed.
- **When storage is unreachable** (or a storage call exceeds `UPLOAD_TIMEOUT_MS`):
  - Uploads answer `503 {"error":"storage_unavailable","message":"Activity storage is unavailable. Your file was not saved; try again in a few minutes."}`.
  - Downloads and deletes of file workouts answer `503 {"error":"storage_unavailable","message":"Original files are unavailable right now; try again in a few minutes."}`.
  - Nothing is created or changed.
  - `GET /api/health` answers `200 {"status":"unavailable"}`, never 503.
  - Manual entries, planning and every read keep working.
  - Graders run a second instance whose storage endpoint points at a dead port.

### Seed data (DP-38, DP-42)

Every person, coach code and event below is invented. The app loads the demo set below once, on the first serve of a database that has never been seeded or reset. After `POST /api/grading/reset` the database stays empty, including after a restart, until the next seed. A seed call on a database that still holds the demo set first removes the demo set as a reset would, so the demo's emails never collide with the seed's, and then loads its own records.

**Grading seed request** (`POST /api/grading/seed`, header `X-Grading-Key: <GRADING_KEY>`). Every record has a caller-chosen `key`, and references use keys.

```json
{
  "today": "2026-11-05",
  "users": [
    {"key":"c1","role":"coach","name":"Mara Quill","email":"mara@ottermere.test","password":"tempoline-demo","tz":"Europe/London","coach_code":"MQ7K2P"},
    {"key":"a1","role":"athlete","name":"Tavi Rennick","email":"tavi@ottermere.test","password":"tempoline-demo","tz":"Pacific/Auckland",
     "series_start":"2026-09-01","start_ctl":0,"start_atl":0,
     "thresholds":[{"kind":"ftp","value":250,"effective_from":"2026-09-01"},{"kind":"pace","value":300,"effective_from":"2026-09-01"}]}
  ],
  "links": [{"key":"l1","coach":"c1","athlete":"a1","status":"accepted"}],
  "files": [{"key":"f1","name":"ride.csv","content_base64":"<base64 of the file bytes>"}],
  "library": [{"key":"lib1","owner":"a1","name":"Fives at 110","sport":"bike","steps":[{"kind":"warmup","duration_s":600,"target_pct":60},{"kind":"interval","repeat":5,"work":{"duration_s":240,"target_pct":110},"recovery":{"duration_s":180,"target_pct":55}},{"kind":"cooldown","duration_s":600,"target_pct":50}]}],
  "workouts": [
    {"key":"w1","athlete":"a1","kind":"planned","date":"2026-11-02","start_local":"06:30","sport":"bike","title":"Endurance hour","steps":[{"kind":"steady","duration_s":3600,"target_pct":80}]},
    {"key":"w2","athlete":"a1","kind":"completed","date":"2026-11-02","sport":"bike","title":"Endurance hour","manual":{"duration_s":3600,"avg_power_w":200}},
    {"key":"w3","athlete":"a1","kind":"completed","date":"2026-11-03","sport":"bike","title":"Ride","file":"f1"}
  ],
  "comments": [{"key":"m1","workout":"w2","author":"c1","body":"Steady and even."}],
  "plans": [{"key":"p1","owner":"c1","name":"Twelve to race day","weeks":12,"entries":[{"day":2,"start_local":"06:30","sport":"bike","title":"Fives at 110","steps":[{"kind":"warmup","duration_s":600,"target_pct":60},{"kind":"interval","repeat":5,"work":{"duration_s":240,"target_pct":110},"recovery":{"duration_s":180,"target_pct":55}},{"kind":"cooldown","duration_s":600,"target_pct":50}]}]}],
  "events": [{"athlete":"a1","name":"Harbour Half","date":"2026-12-20"}]
}
```

**Field rules.**

- `today` is optional and overrides `APP_TODAY` until reset.
- `tz` defaults to `APP_TZ`. `coach_code` is six uppercase letters and digits, generated if absent. `series_start` defaults to the earliest workout date, and the start values default to 0.
- Planned workouts carry `steps` or `duration_s`. Completed workouts carry `manual` (`duration_s` plus `avg_power_w` or `avg_pace_s_per_km`) or `file`. A JSON file with `start` takes its date from it. Seeded files pass the same checks and are stored in object storage like uploads.
- Link `status` is `requested`, `accepted`, `declined` or `removed`. Requested links may carry `expires_at`; otherwise they expire after the configured TTL from seeding.
- Seeded workouts, library items and plan entries pass the same validation as the API, so an empty `steps` array is refused with `422` and an error keyed by its path, for example `{"errors":{"library[0].steps":"Add at least one step."}}`, and nothing is seeded.
- Seeding upserts by key. The same body returns the same ids and creates no duplicates. Each call issues fresh one-time sign-in links, each valid once.

**Response** `200`:

```json
{"today":"2026-11-05","ids":{"c1":"<id>","a1":"<id>","l1":"<id>","lib1":"<id>","w1":"<id>","w2":"<id>","w3":"<id>","m1":"<id>","p1":"<id>"},"sign_in":{"c1":"/auth/one-time/<token>","a1":"/auth/one-time/<token>"}}
```

**Demo set** (loaded at first serve). All passwords are `tempoline-demo`, and the demo uses today = `APP_TODAY`.

- **Coaches.** Mara Quill (`mara@ottermere.test`, Europe/London, code `MQ7K2P`). Idris Fenn (`idris@ottermere.test`, Europe/Berlin, code `IF4R9T`).
- **Athletes.**
  - Tavi Rennick (`tavi@ottermere.test`, Pacific/Auckland): FTP 250 W and threshold pace 5:00 /km, both from 2026-09-01; series start 2026-09-01 from 0; linked to Mara; event "Harbour Half" on 2026-12-20.
  - Noor Halvorsen (`noor@ottermere.test`, Europe/London): FTP 210 W and pace 5:30 /km from 2026-09-01; linked to Mara.
  - Ezra Blom (`ezra@ottermere.test`, Europe/Berlin): FTP 280 W and pace 4:45 /km from 2026-09-01; a pending request to Mara.
- **Tavi's library.** "Fives at 110" (bike): warm-up 0:10:00 at 60%, 5 × (0:04:00 at 110% / 0:03:00 at 55%), cool-down 0:10:00 at 50%.
- **Tavi's week of 2 Nov 2026.**

  | Day | Workout | Detail |
  |---|---|---|
  | Mon 2 Nov | Planned bike "Endurance hour" | 06:30, steady 1:00:00 at 80% |
  | Mon 2 Nov | Completed manual bike "Endurance hour" | 1:00:00 at 200 W |
  | Tue 3 Nov | Planned run "Easy 45" | 06:30, steady 0:45:00 at 75% |
  | Wed 4 Nov | Completed manual run "Lunch run" | 0:45:00 at 5:30 /km |
  | Thu 5 Nov | Planned bike "Fives at 110" | 06:30 |
  | Sat 7 Nov | Planned bike "Long ride" | 07:00, steady 3:00:00 at 70% |

- **Noor.** Planned bike "Tempo ride" on Mon 2 Nov, 06:30, steady 0:40:00 at 88%.
- **Mara's plan "Twelve to race day"** (12 weeks). In every week w it has entries on day 7(w−1)+2: bike "Fives at 110" at 06:30; day 7(w−1)+4: run steady 0:45:00 at 75% "Easy 45" at 06:30; and day 7(w−1)+6: bike steady 2:00:00 at 70% "Long ride" at 07:00.

For example, with the demo set and `APP_TODAY` 2026-11-05, Tavi's week of 2 Nov 2026 shows:

- `Planned 311.3 TSS` and `Completed 126.0 TSS`.
- The tally On target 1, Close 0, Off target 0, Missed 1, Unplanned 1, Planned 2.
- Sport tiles Bike stress 64.0, Run stress 62.0, Bike time 1:00:00, Run time 0:45:00, Sessions 2.
- The countdown `45 days to Harbour Half`.

## Technical requirements

### Deployment (DP-39)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build` step and served by the same server.

The app root contains `/app/run.json` with string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when set. `GET /api/health` answers as published in API. Schema and bucket setup run idempotently on every serve, not only at build.

### Configuration and secrets (DP-45)

These are read at start, never hard-coded, and never sent to the browser:

- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `GRADING_KEY`: when unset, the grading routes always answer 404.
- `APP_TODAY`: ISO date; defaults to the current date in `APP_TZ`.
- `APP_TZ`: IANA zone; default `UTC`.
- `LIVE_HEARTBEAT_MS`: default 15000.
- `ACTIVITY_MAX_BYTES`: default 1048576.
- `ACTIVITY_MAX_SAMPLES`: default 21600.
- `LINK_REQUEST_TTL_HOURS`: decimal; default 72.
- `UPLOAD_TIMEOUT_MS`: default 5000.
- `CHART_ANIMATION_MS`: default 450.
- `APP_PUBLIC_PORT`.

The app sets no timer or limit that lacks one of these variables.

### Server boundary (DP-33, DP-39)

- The server is same-origin only. It sends no cross-origin allowance headers, and the session cookie is HttpOnly and SameSite=Lax.
- Body limits are as stated in API.
- The server never serves source files, environment files, dependency folders or credentials. Unknown `/api` paths answer the 404 body.
- Pages make no request to any other origin. Fonts and scripts are served locally.
- If the database is unreachable at boot, the server keeps retrying every second and health answers its `starting` 503. If storage is unreachable at boot, the server starts normally and behaves as described in Services.

### Browser support and performance (DP-08, DP-44)

- Supported browsers are current Chromium, Firefox and WebKit at 375×812, 768×1024 and 1280×800, with touch input on phones.
- The athlete home is usable within three seconds of navigation with the demo set.
- Live changes appear within 3 seconds.
- The app never relies on real elapsed time in the browser beyond the published timers.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its licence.
- IF-03: Shipped packages and fonts use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1 licences.
- IF-04: `package-lock.json` is committed and matches `package.json`.
- IF-05: No datastore or service is used beyond the provided PostgreSQL and object storage (no SQLite, no file-based database, no in-memory cache standing in for the database).
- IF-06: The provided development service configuration and credentials are left unchanged.
- IF-07: The source contains no other product's name, logo, photo or copied marketing text, and pages load no external fonts, images or scripts.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes. Names match this brief's domain terms: planned workout, completed workout, threshold, normalised power, compliance, series, link request, plan template.
- Each domain rule is decided in exactly one place in the source, and every surface and endpoint uses that one decision. This covers the stress formulas, the series recurrence, compliance states and matching, file checks, rest-week scaling, wall-clock start conversion, link transitions and display rounding.
- No abstraction has a single implementation.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the types or rules already exclude.
- Every API error is produced through one consistent error shape: `{"errors":{...}}` for validation and `{"error","message"}` otherwise.
- Database changes that belong together (a workout and its series, a threshold and its re-scores) are committed in one transaction.
- No feature, endpoint or screen exists beyond this brief.
