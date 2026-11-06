# TRUTH — Vesper & Rowe Talent Rungboard (golden)

The brief made concrete. `brief:` values are copied verbatim from `instruction.md`; `decided:` values fill a
silence in the brief's intent.

## Journeys (ideal end-to-end flow)

1. **Hold, defend, book a day** (brief: Journeys 1). Start: Priya Shah signed in on `/workspace/board?office=toronto&talent=ines-okoro`.
   Tab reaches the grid once; arrows move days; Enter opens `dialog "Ines Okoro, <date>"`; Client + Job title →
   Place option → `Placed 1st option for Northbound Outfitters on <date>.` in Board announcements, focus back on the
   day. Jonah places the 2nd for Lakeshore Beauty and presses Challenge: the 1st chip prints Challenged and the
   dialog shows `Challenged until <time>`. Priya opens Confirm on the 1st (dialog above the day dialog), picks Full
   day, types 50 overtime minutes, Add usage → Digital / North America / 6 months, Confirm booking
   (pending `Confirming booking…`). End: day fills ink with `Booked Northbound Outfitters`, the 2nd leaves the
   ladder (released, `day_booked`), focus on `View booking VR-YYYY-NNNN`, announcement
   `Booked Ines Okoro for Northbound Outfitters on <date>. The confirmation email is on its way.`; Mailpit holds one
   `Option update: Ines Okoro on <date>` per client (`Your 1st option is confirmed.` / `This day is now booked.`)
   and `Booking confirmed: <job> on <date>` with `booking-<ref>.ics`; Kill Bill holds one DRAFT invoice with one
   item per fee line (example: 250,000 + 37,600 + 67,500 talent fees, 71,020 service fee, 55,396 HST, total
   481,516 cents — brief: Fees example). Rosa opens the booking, Issue invoice (`Issuing invoice…`) → Kill Bill
   status COMMITTED, focus on `Invoiced`, announcement `Invoice issued in billing.`
2. **Cast and ask** (brief: Journeys 2). `/boards` → Women → Toronto → Sort by Height → ft and in → Next page;
   every step is one history entry with all five params (`office, q, sort, unit, page`); Back/Forward restore
   controls and cards. Add three talent (portrait flies to `Tray 3`, digit rolls), reorder on `/tray`, four steps
   by keyboard (server checks per step, h2 focus), Send → `Cast request CR-NNNNNN sent. A booker in Toronto will
   reply by email.`; Mailpit: exactly one `Cast request from <company>: 3 talent` to toronto-desk.
3. **Package and phone shortlist** (brief: Journeys 3). New package of four → email `Casting package: <title>`
   with `/p/<token>`; on 375×812 Shortlist ×2, Pass ×1 show at once; `2 shortlisted`; Download photos → ZIP with
   `<slug>/<nn>.jpg` and `manifest.json` (name, bytes, sha256); staff view shows the choices; Regenerate → old
   link shows `This package link no longer opens`.
4. **New face, guardian, scout** (brief: Journeys 4). `/apply` on a phone, four steps for a 16-year-old, draft
   survives reload, four photos, guardian email → `Consent needed for <first name>'s application to Vesper & Rowe`;
   guardian approves once (second visit: `This consent link no longer works`); Theo approves and signs → talent on
   New Faces.
5. **Licences and statements** (brief: Journeys 5). Record licence ending within 30 days → counted Expiring, one
   `Usage licence ending <date>: <talent>` reminder; Extend 3 months → one committed Kill Bill invoice
   `Usage licence renewal: <talent>, Digital, Canada, 3 months`; advance, reversal, Export CSV → statement balance
   equals the sum of its lines; formula-like client names start with `'`.
6. **Roster** (brief: Journeys 6). Import CSV → row-by-row report; same file again → nothing created; Withdraw →
   profile 410 gone page, out of packages and feeds; Restore → same board place, packages, choices, feed link.
7. **Talent calendar and money** (brief: Journeys 7). Ines lands on My calendar, copies the feed link,
   Regenerate → old link 404; opens own statement; another talent's statement answers 404.

## Palette (hex values the build uses)

| Role | Hex | Source |
|---|---|---|
| paper ground | #F3EDE2 | brief: Visual design; decided: hue 39°, L 92% |
| paper-deep (rail, table heads) | #EBE3D5 | decided |
| ink (text, booked fill) | #1F1A15 | brief: Visual design |
| muted text | #625A50 (5.8:1 on paper) | brief: Visual design |
| oxblood accent (rank-1 outline, focus) | #7A1F2B (8.8:1 on paper) | brief: Visual design |
| hairline sand | #D9CCB6 | brief: Visual design |
| text on ink | #F3EDE2 (14.5:1) | decided |

## Type, space, layout

- Fraunces (display, variable) and Hanken Grotesk (text, variable), both bundled woff2 (brief: IF-05).
- Body 14px; scale ratio 1.333: 18.7, 24.9, 33.2, 44.2, 58.9, 78.6. Every public page title (h1, including the
  gone, dead-link and consent pages) is Fraunces 78.6px, 5.6× the 14px body, at every viewport (brief: Visual design,
  "about six times the body size"). At ≤767 a word wider than the column breaks with hyphens instead of scrolling
  sideways (decided: keeps the brief's no-sideways-scroll rule without shrinking the title). Labels 13px, eyebrows 12px uppercase. Tabular figures on every number.
- Twelve-column grid, 24px gutters (16px phone), public max 1240px; workspace main full width.
- Viewports (brief: Screens and layout): 1280×800 rail (232px) + 14 columns in one row; 768×1024 rail as top
  bar, strip in two rows of 7; 375×812 days as rows, day sheet with sticky action bar, filter sheet with
  `Show <n> talent`, licence cards with sticky Extend bar, pinned first column in statement and import tables.
- Targets ≥ 44×44px; no horizontal scroll at the three viewports.
- Board day columns at 1280: chip companies sit on one line with an ellipsis (the button's text keeps the full
  name); a booked day fills the whole cell in ink, "Booked" in Fraunces 14px on one line, its View booking link
  in paper on the ink (decided: a 52px column cannot hold a company word without splitting it).
- A card portrait always shows the drawn silhouette under its photo, so a photo still loading never leaves an
  empty box; a talent with no reach count shows "Not listed", like a missing height (decided).

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Route cover panel | public path change | 300 up over + 300 off the top; Back runs downward | cubic-bezier(0.16,1,0.3,1) | 140ms cross-fade |
| Heading lines | page arrival | 560 per line, +140 per line | same | at once |
| Board cover preview | mouse pointer over a board row | 140 fade, 140 transform trail | same | no fade |
| Tray fly / count roll | Add to tray | 300 / 300 | same | 140 cross-fade on the count |
| Ladder chip slide | rank change | 300 (after a 140 exit fade) | same | swap at once |
| Rank numeral roll | promoted chip | 560 after the slide | same | 140 cross-fade |
| Booked fill | day booked | 140 | same | instant |
| Released chip exit | option released | 140 fade | same | removed at once |
| Dialogs / sheets | open | 140 fade + scale / 300 rise | same | 140 cross-fade |
| Press | press | 140 colour | same | same |

## States per async action

Pending copy, success and rare-state copy are exactly the brief's Feedback states tables (brief: Feedback
states); each screen announces in its named live region (`<X> announcements`), an in-flow status line under the
page title (decided: in flow so it never covers a control). Validation: Problems region at the top of the form
or dialog + inline `Error: <copy>` with an icon; live region `Please fix <n> problems.`

## Breakpoints

375 (≤767), 768 (768–1023), 1280 (≥1024) — brief: Screens and layout.

## Media and licences

- 64 portrait illustrations (`app/seed/portraits`), drawn as SVG for this app and rasterised to JPEG — licence `original`.
- Fraunces and Hanken Grotesk woff2 from Fontsource 5.3.0 — OFL-1.1.
- Five Lucide icons inlined — ISC.
