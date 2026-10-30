# TRUTH — Northfold Language Access Teamseat

The brief made concrete. Every value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (ideal end-to-end flow)

### 1. Request an interpreter
- Start: Tomas Herrera (RVH scheduler) signs in at `/` → lands on `/requests` (brief: Screens and layout).
  The list shows the empty note "No requests yet. Use the form to request an interpreter." (decided: Journey 1
  says the list is empty) and the form `Request an interpreter` sits left (4/12 columns at 1280).
- Actions: choose ASL, Hospital, a `YYYY-MM-DD` date next week, `09:00`, `90`, street, city, initials, note;
  double-click `Submit request`.
- Visible end: the button disables on the first press; `status "Request status"` reads `Submitting…` then
  `Request A-1001 submitted. Awaiting release by dispatch.`; one new row pinned at the top with `Awaiting release`,
  two hatched lanes labelled `open`, `0 of 2 covered` (brief: Interactions, Feedback states).
- Provider end: one `assignments` row (status `draft`), two `seats` rows `open`, one `idempotency_keys` row
  holding the 201 body. A second scheduler at CPSD searching `A-1001` gets an empty list; `GET` answers 404
  `not_found` identical to an unknown number (brief: DP-34).

### 2. Release and watch the gap close
- Start: Dana Whitcombe signs in → `/board`, current Central week, heading `Week of Mon 26 Oct 2026`.
- Actions: open the ASL capsule (two hatched lanes `open`, gutter `3:00` for one 90-minute team: 90 × 2 open seats) → drawer slides
  in from the right over a third of the width → `Release to interpreters`.
- Visible end: `Released. Offers going out to 3 qualified interpreters.`; status `Open`; lanes still hatched.
  When Rosa claims seat 1 elsewhere, within one 2-second poll the lane fill sweeps left→right (480 ms), label
  becomes `R.M.`, the ASL numeral counts `3:00 → 1:30` (340 ms), the count reads `1 of 2 covered`, and
  `status "Board updates"` announces `ASL, Thu 5 Nov: seat 1 covered by R.M., 1 h 30 m uncovered this week`.
  After seat 2, the check glyph `All seats covered` appears.
- Provider end: assignment `released` → `partially_covered` → `covered`; Mailpit holds one `Open seat A-1001:
  ASL, Thu 5 Nov 09:00` to each of rosa, samuel, jordan; one `Seat n confirmed on A-1001` per claimer; one
  `A-1001 is fully covered` to tomas.herrera.

### 3. Claim a seat, or lose it
- Start: Samuel and Jordan on `/offers`; the card shows language, setting, city, time and lanes, never the
  address, initials, notes or scheduler phone (brief: DP-07).
- Actions: both press `Claim seat 2` in the same second.
- Visible end: the winner's lane sweeps to `S.O.`, `Seat 2 on A-1001 is yours. Details are in My seats.`, the card
  leaves for My seats where street, initials, notes and the scheduler's phone show. The loser sees
  `Seat already taken` in `status "Claim status"` and beside the lane, which stays hatched.
- Provider end: exactly one hold; one confirmation email; one coverage receipt to the scheduler.

### 4. Change or cancel with clear fee consequences
- Cancel: drawer → `Cancel request` → `dialog "Cancel A-1001"` shows `Checking fee…` then (Friday 15:00 for
  Monday 09:00) `Cancelling now gives 18 h 00 m of business-hour notice, under 48 business hours. A
  late-cancellation fee of $343.00 applies.`; `Confirm cancellation` enables only after the preview. Confirm →
  `Request A-1001 cancelled. Fee: $343.00.`, the drawer shows `Cancelled` and the decision. Mailpit: one
  `A-1001 cancelled — fee applies` each to the scheduler and both holders, body `A late-cancellation fee of
  $343.00 applies.`
- Change: `Change time` → `dialog "Change time for A-1002"` prefilled in Central → `Save new time` →
  `Request A-1002 moved. Seats reopened, no fee.`; every seat reopens, status back to `Open`, Mailpit: one
  `A-1002 changed — no fee` to scheduler and each freed holder, fresh `Open seat` offers to qualified
  interpreters. Under 48 business hours the dialog stays open with `Less than 48 business hours' notice. This
  request can only be cancelled now.`

### 5. Verify after the job
- My seats → `Verify` opens `form "Verify seat 1 on A-1001"` in place; a text file declared as PDF answers
  `Upload a PDF, JPEG or PNG file.` and stores nothing; a JPEG answers `Verification for seat 1 received.`; the
  card shows the verified mark, `Seat 1 verified` and `View signed form` (60-second link opened in a new tab).
- Provider end: MinIO object `verifications/A-1001/seat-1/<random>.jpg`; seat `served`; assignment `served`, then
  `verified` with billing `ready` when every seat is served.

### 6. Rates and invoices
- Billing lead adds an RVH ASL rate effective from a future date → `Rate from Thu 12 Nov 2026 saved.`; a duplicate
  date → `A rate already starts on that date.`; today → field error under Effective from.
- Queue rows show number, organisation, `Service`/`Late cancellation`, Central date, total `$351.40`, status word
  and invoice id. `Post invoice for A-1001` → `Posting…` → `Posted to Kill Bill as invoice <id>.`; row `Posted`.
- Kill Bill outage: `Queued. Kill Bill is unreachable, and this will post automatically when it returns.`; the
  retry (every `BILLING_RETRY_SECONDS`, default 10) posts it once; the row turns `Posted` by polling.
- Provider end: Kill Bill account `teamseat-RVH` (name `Riverbend Valley Hospital`, USD) with exactly one
  `EXTERNAL_CHARGE` `A-1001 service` of `351.40`; the assignment stores the invoice id and the charge snapshot.

### 7. Manage schedulers and export the statement
- `/org`: add scheduler → `<name> can now request interpreters.`; remove → `<name> no longer has access.`; their
  sessions end and sign-in answers 401. Duplicate email → `That email is already in use.`
- Monthly statement `YYYY-MM` downloads `teamseat-statement-YYYY-MM.csv` with header
  `number,date,kind,language,setting,seats,billable_minutes,mileage_cents,total_cents,invoice_id` and one row per
  posted RVH assignment that month, totals equal to the Kill Bill items.

## Palette (hex values the build uses)

| Role | Hex | Source |
|---|---|---|
| paper ground | `#F6F0E2` | brief: Visual design (warm paper) |
| paper raised | `#FBF8F0` | decided: layers by paper tone |
| paper sunk | `#ECE4D2` | decided: frame recedes one tone |
| ink | `#1C1915` | brief: near-black ink |
| ink muted | `#5B5145` | decided: secondary text ≥ 4.5:1 |
| rule | `#B8AD99` | brief: warm mid-grey hairline |
| control border | `#7A6F60` | brief: control borders ≥ 3:1 |
| gap (hatch) | `#B23B14` | brief: burnt orange-red, ≥ 3:1 |
| gap ink (error text) | `#9E3311` | decided: errors readable at 6.3:1 |
| covered | `#1E4A31` | brief: deep forest green |

No gradients or shadows; the only gradient is the 45° hatch on open lanes (brief: Visual design).

## Type, space and layout

- Archivo 700/600 headings, ×1.2 scale 35.3 / 29.4 / 24.5 / 20.4 px; Atkinson Hyperlegible 17px/1.5 body;
  Atkinson Hyperlegible Mono with `tabular-nums` for every number and its unit (brief: Visual design).
- Spacing step 4px (4, 8, 12, 16, 24, 32, 48) (brief: steady small step).
- 1280: board gutter 2/12, seven day columns over 10/12, each 06:00–22:00; capsule left =
  (start − 06:00)/960 and width = duration/960 of the day column; requests form 4/12 + list 8/12; offers two
  columns; drawer docked right at 33.333vw (brief: Screens and layout).
- 768: one day with `tablist "Days"`, gutter 2/12 (names at 17px body size); drawer a full-width sheet; tables become stacked cards;
  cards one column (brief + decided: the request table does not fit 768 as a table).
- 375: as 768; the gutter stays at the first two of the twelve columns (brief: Screens and layout). Inside it
  (about 56px) the 17px names are set regular weight and hyphenate where they cannot fit (`Viet-namese`), the
  numeral drops to 17px tabular mono so `12:45` fits, and the gutter head shows only `h:mm` (decided: keeps the
  brief's 2/12 gutter and 17px minimum without horizontal scrolling).

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Drawer | open / close | 320 ms translateX | `cubic-bezier(0.2,0.8,0.2,1)` | appears / disappears at once |
| Dialog | open | 200 ms opacity | same | appears at once |
| Button press | `:active` | 0 ms | — | same |
| Hover | pointer over | 120 ms colour | ease-out | none |
| Hatch Seam sweep | server-confirmed open→held | 480 ms scaleX from the start edge | same | instant fill |
| Lane label | after the sweep | instant | — | instant |
| Gutter numeral | after the label | 340 ms count (rAF) | ease-out cubic | instant final value |
| Check glyph + covered count | after the numeral | instant | — | instant |
| Reverse seam | held→open | check goes, numeral up, label `open`, fill draws back 480 ms | same | instant |

(brief: Motion and effects; the board announcement is made in both modes.)

## States per async action

As in the brief's Feedback states table, verbatim; each in its named polite `status` region. Decided additions:
`Statement status` (`Preparing statement…`, `Statement for YYYY-MM downloaded.`, field error) and the network
copy `Couldn't reach Teamseat. Try again.` for actions the brief gives no outage copy.

## Breakpoints

375, 768 (< 1024: day view, full-width drawer, stacked tables), 1024+ (full week, docked drawer), 1280
(two-column offers), 1440+ (agency name shown in the top bar) — decided around the brief's three viewports.

## Media and licences

Fonts: Archivo, Atkinson Hyperlegible, Atkinson Hyperlegible Mono latin woff2 from Fontsource npm tarballs,
SIL OFL 1.1, self-hosted under `/fonts/`. Icons, brand mark and empty-state slip: inline SVG drawn for the app
(`original`). No photographs.
