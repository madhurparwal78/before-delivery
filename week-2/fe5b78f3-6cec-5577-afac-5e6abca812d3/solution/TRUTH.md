# TRUTH — Pakka Rail golden

The brief made concrete. `brief: <section>` is copied from instruction.md; `decided: <why>` fills a silence.

## Journeys (ideal flow)

1. **Solo booking from a phone** (brief: Journeys 1). Start: signed in at `/`, 375 px. Pick From/To (`<code> <name>`
   options), type the date, General, Search trains → `/trains?from&to&date&quota=GN&class=SL`; `status "Search result"`
   reads `1 trains from <From> to <To> on <Wed 2 Dec 2026>`. Show details opens the coach plan preview under the card.
   Filters opens the bottom sheet (focus on the first radio); 3A then SL faster than the network: only the reply for
   SL paints, `status "Availability"` ends on `<n> SL General: <label>`; the URL is replaced, never pushed. Escape
   closes, focus returns to Filters; the closed sheet has no DOM radios. Book → `/book?...`; enter one passenger and
   the mobile number; Review and pay → `dialog "Confirm and pay"` focused on `Pay ₹645.00`; Pay → `/bookings/<pnr>`
   with `PNR <pnr>` and the `CNF S1 25 LB` style chip. Provider end state: Kill Bill account `pakka-<id>`, payment
   `<pnr>` with SUCCESS PURCHASE `<pnr>-fare`; MinIO `tickets/<pnr>/v1-booked.pdf`; Mailpit `E-ticket for PNR <pnr>`.
2. **Family booking** (brief: Journeys 2). Six passengers aged 5+, two seniors, one child; berth preferences by
   keyboard (one Tab stop, arrows bay by bay) or tap; Keep party in one coach; fare lines update within 0.5 s. End: all
   CNF in one coach with seniors on Senior-pool lowers, child NOSB — or `alert "Booking problem"` with the party-split /
   waiting-list-full copy, kept through the availability refresh; nothing charged.
3. **Session ends while paying** (brief: Journeys 3). Pay with an ended session → 401 → `/signin?next=<encoded booking
   path>` with the session-ended alert. Sign in → back on the same URL with every field, option, mobile number and
   `preferred by passenger <n>` tag restored from this tab's sessionStorage, focus on Review and pay; Pay → one PNR,
   one charge.
4. **Racing for the last berth** (brief: Journeys 4). Allotment and payment run one booking at a time per run and
   class under a Postgres row lock; non-overlapping stretches can both win; others get `409 availability_changed` with
   `offer` and `charged:false`; `Book at <offer>` resends in one step with a new key. A double Pay replays.
5. **Following a waitlisted PNR** (brief: Journeys 5). `/bookings/<pnr>` signed out → sign-in with `next`, back on it.
   Polls every 20 s; only a higher `version` paints; each change plays the Chart drop; `status "PNR updates"` holds
   one line per changed passenger; one `Your status moved` mail per cancellation event that moved them.
6. **Chart prepared** (brief: Journeys 6). From `chart_at` on the business clock: bookings 409 `chart_prepared`,
   waiting-list passengers read `NOT CNF`, version already counts the chart. Within 5 s the chart job records the
   `chart_full` cancellation entry, the refund row (reason chart), v<n> `chart` e-ticket and the chart mail; the
   refund becomes issued after Kill Bill's SUCCESS and the label reads `Not confirmed — refund issued`.
7. **Cancellation** (brief: Journeys 7). Dialog ticks fetch a quote; preview lines from the quote; a poll while open
   keeps ticks and focus and re-quotes; confirm → 201, chips struck, `Refund pending` then `Refund issued`, refund mail,
   `after cancellation` e-ticket, freed berths promoted in the same change.
8. **Public PNR check** (brief: Journeys 8). `/pnr` → `table "PNR status"` (ARIA table roles) with Passenger, Booking
   status, Current status; no names, ages, genders, phone or email anywhere; stacked blocks with column names below
   768 px.

## Palette (decided values, brief roles)

| Role | Hex | Source |
|---|---|---|
| ground (warm unbleached paper) | #F2EADB | brief: Ground and colour; hex decided |
| grid lines, 8 px | #E3D7C2 | brief: faint square grid 8 px apart |
| panel (lighter paper, 92 % so the grid shows) | #FBF7EF | brief: panels slightly lighter paper |
| ink | #231C14 (14.1:1 on ground) | brief: near-black warm ink |
| maroon (buttons, links, focus, tabs) | #7B1E2C (8.5:1) | brief: deep maroon |
| bottle green (CNF) | #1E5B3B (panel text 7.5:1) | brief: deep bottle green |
| ochre fill (RAC) | #D19A3E (ink text 6.7:1) | brief: burnt ochre |
| ochre text | #8A560F (5.1:1 on ground) | brief: ochre deepened to 4.5:1 |
| muted text | #5A4F42 (6.7:1) | decided: secondary text at AA |

## Type, space and layout

- Archivo 700 headings, IBM Plex Sans body 15 px, JetBrains Mono for chips, berth numbers, times and money; h3 18.75,
  h2 23.4, h1 29.3 px (1.25 steps, title ≈ 2× body) (brief: Type). Self-hosted woff2, latin + latin-ext (₹).
- Spacing 4/8/12/16/24/32 px; radius 2 px; hairline 1 px; chip border 1.5 px (decided: compact density).
- Breakpoints exactly 768 and 1200 (brief: Screens and layout): below 768 one column (Filters sheet, details under the
  card, vertical coach plan, pinned Review and pay bar, stacked PNR rows); 768–1199 two columns (filters a third,
  details inside the card, horizontal plan scrolling in its frame); 1200+ three panes with sticky Train details.
- Tap targets ≥ 44 px; berth cells 48 × 48 (brief: Touch).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| buttons, berth cells | hover / press | 100 ms (background, border, stroke-width) | ease-out | none |
| dialogs, Filters sheet | open / close | 250 ms opacity + translateY 16 px | cubic-bezier(0.2,0,0,1) | instant |
| fare total | total changes | underline fades over 500 ms | ease-out | none |
| Chart drop: count | queue number changes | 330 ms total; step i of n shows when the eased progress reaches i/n | cubic-bezier(0.45,0,0.25,1) (starts slowly, settles gently) | final state at once |
| Chart drop: lane | WL → RAC | 320 ms, copy narrows to half width | cubic-bezier(0.45,0,0.25,1) | final state at once |
| Chart drop: berth morph | → CNF | 420 ms, copy travels to the berth cell | cubic-bezier(0.45,0,0.25,1) | final state at once |
| stagger | between passengers | 120 ms | — | — |
| strike | CAN / NOT CNF | 200 ms rule scaleX | ease-out | drawn at once |

Reduced motion adds `region "What changed"` above the coach plan with the latest batch's lines (brief: Reduced motion).

## States per async action

Exact copies from brief: Feedback states, in the named regions: `Checking trains`, search success / none found,
`<train> <class> <quota>: <label>`, `Total <total>`, `Processing payment`, `Booked. PNR <pnr>. E-ticket saved. Email copy
queued.`, every Booking problem copy, the session-ended copy, poll failure `Can't reach Pakka right now. Showing status
from <time> IST.`, `Chart prepared` + `Statuses are final. Berths no longer move.`, `Chart at <time> IST, <date>`,
`Cancelling`, `Cancelled. Refund of <refund> recorded.`, `Cancelled. No refund is due.`, the ticket and sign-in problems
and `No booking has PNR <pnr>.`.

## Decisions where the brief is silent

- Spill to "the next coach in number order": higher-numbered coaches first, then lower (decided: party coach is the
  lowest with room).
- Children auto-cancelled with the last adult are CAN but not listed in that cancellation entry (decided: the entry
  lists the selected passengers, like the quote).
- After the chart instant a cancellation frees its berth or RAC place, which stays empty: nobody is promoted into it
  and no queue is renumbered (brief: Chart instant, "a berth or RAC place freed after that instant stays empty";
  Cancellation deductions, `rac_after_chart` "frees an RAC place that stays empty"; renumbering decided from "Every PNR
  on the run is frozen").
- E-ticket PDFs render from a snapshot stored in Postgres at the event (decided: "Stored as issued"); the PDF writes
  money in the brief's money format, `₹1,790.25` (brief: Money format), the ₹ drawn by a one-glyph font whose text
  extracts as U+20B9.
- A provider failure makes that instance wait 15 s before its next attempt while the row lease is 5 s (decided: an
  instance that can reach the provider takes the work; retries still come at least every 30 s).

## Media and licences

Fonts: Archivo, IBM Plex Sans, JetBrains Mono, OFL-1.1, from Fontsource npm packages (app/assets.json). Icons: Lucide
(lucide-react, ISC). Coach plan, ribbon, stamps and the empty-state ticket stub: drawn in code (original).
