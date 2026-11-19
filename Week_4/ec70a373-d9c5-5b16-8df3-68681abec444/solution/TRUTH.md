# TRUTH — Pilotlight golden

The brief made concrete. `brief: <section>` values are copied from `instruction.md`; `decided: <why>` values fill
silence in the brief's intent. Design values come from `DESIGN.md`, which carries the same provenance per row.

## Journeys (ideal end-to-end flow)

### 1. Claim the blast chiller (DP-02, DP-04, DP-06, DP-09, DP-66)
- Start: Rosa signed in on `/book`; Site = Copperline Eastside (her home site); Date = the site's next open date
  (`local_date`+1 before 18:00 site time, +2 from 18:00). brief: Screens and layout.
- Another member holds Blast Chiller 08:00–09:00, so the chiller is occupied 08:00–09:45 (45 min buffer). brief: Business rules.
- Press at 05:00 on the Blast Chiller ring: a flame dot drops at 75°; drag clockwise: the flame arc grows in 3.75° steps and
  stops dead at 07:15 (its own 45 min buffer would touch 08:00). Centre reads `05:00–07:15` / `Pack hours after this claim`
  and the balance minus 2.25. brief: Interactions; Dial geometry.
- Release (twice, from a finger bounce): one claim attempt, one Idempotency-Key; the second release resends the same request
  with the same key, so the server holds once (201 then 201 replay or 409 `idempotency_in_progress`). brief: Claim attempts.
- Held: sector `Your hold 05:00 to 07:15` with a pulsing flame outline, centre `Held · 9:59 left`, Confirm booking focused,
  a Held ticket on top of the spike, Booking status `Held Blast Chiller 05:00–07:15. Confirm before HH:MM site time.`
- Confirm booking: sector turns solid green with a check and `Confirmed`; numeral counts to the server balance; ticket reads
  Confirmed; email `Booking confirmed: Blast Chiller, <date> 05:00-07:15` from `Pilotlight <tickets@pilotlight.example>`.
- Provider state: one booking (confirmed), one `booking_debit` movement (actor Rosa) drawing lots earliest valid-through
  first, one outbox row delivered to Mailpit.

### 2. Lose the last window (DP-07, DP-10)
- Rosa and Ade hold the same window at once: the station row lock decides; one 201, the other 409 `slot_taken`, no movement.
- Rosa's arc snaps back to zero length at its start (for a 10:00 start, aria name `Claim 10:00 to 10:00`), Booking status reads exactly
  `Someone else just claimed that window. Your pack hours are unchanged.`, centre shows the unchanged balance.

### 3. Cancel with mid-range notice (DP-12, DP-13, DP-17, DP-69)
- Ticket → Cancel booking → dialog `Cancel booking PL-XXXXXX` states the split computed with the server clock offset, e.g.
  7 quarter hours 60 h ahead: `Cancelling now refunds 0.75 pack hours and forfeits 1.00 pack hours.` (forfeit in flame).
- Confirm cancellation (no body) → `cancel_refund` 0.75 (returned latest valid-through first, opening lot first) and
  `forfeit` 1.00, both actor Rosa; ticket Cancelled; status `Booking cancelled. 0.75 pack hours refunded, 1.00 forfeited.`;
  email `Booking cancelled: …` with `Refunded pack hours: 0.75` and `Forfeited pack hours: 1.00`.

### 4. Weekly bake slot across the clock change (DP-14, DP-15, DP-16, DP-85)
- Server clock 2026-10-23T14:00:00Z, phone set to Tokyo. Rosa (12.00 h) sets Deck Oven 1 01:00–03:00 on Sunday 2026-10-25 → Repeat weekly →
  `Every Sunday 01:00–03:00`, Number of weeks starts at 4 with the preview already drawn: `Uses 9.00 pack hours` /
  `Pack hours after this series 3.00`; 2026-11-01 reads `2026-11-01 01:00–03:00 · 3.00 h`, the others 2.00 h. brief: Seed data.
- Arrow keys to 6 weeks: `Uses 13.00 pack hours` / `Not enough pack hours for 6 weeks.`, Book series aria-disabled, no request sent.
- Back to 4 → Book series → four Confirmed tickets (earliest on top) at 01:00–03:00 site time, 2.00, 3.00, 2.00, 2.00 h; the dials reload
  behind the open dialog without disturbing it. One `Weekly booking confirmed: …` email. All-or-nothing: a conflict answers 409
  `series_conflict` with `dates` and books nothing.

### 5. Top up and stay compliant (DP-18, DP-20, DP-21, DP-22, DP-24, DP-25, DP-27, DP-68)
- Hana (insurance through 2026-09-30) is refused holds with 422 `certificate_expired`.
- Packs → Buy Production 30 → dialog key created on open → Pay and add hours (disabled while pending) → Kill Bill account
  (external key = member id, name Sato Patisserie, USD, external payment method default) and one PURCHASE payment
  (external keys = purchase id) → lot of 30.00 h valid through home-site date + 60 → `pack_purchase` movement →
  receipt email `Receipt: Production 30 (30.00 pack hours)` with `$660.00`, the purchase id and `Valid through <date>`.
- Documents → certificate of insurance, expiry, coverage ≥ 1,000,000, additional-insured checkbox, PDF → object
  `documents/<tenant>/<member>/<document>` then row `pending`; Luis verifies on Compliance → coverage list shows the new date.

### 6. Run the site day (DP-28, DP-29, DP-31, DP-32..35, DP-61, DP-62, DP-67)
- Dana on `/site` (rail fixed to Copperline Eastside, default date = site today). Check in (15 min before start until end),
  Mark no-show (from start + 30 min; `forfeit` movement by Dana), Cancel booking with a required Reason (manager attribution,
  `Cancelled by Copperline Eastside staff. Reason: …` in the email), Check out with a per-dialog Idempotency-Key.
- Check-out 72 min late with 0 pack hours at Eastside: 5 late quarters → subtotal 5,313, tax 471, total 5,784 cents;
  one Kill Bill invoice with one EXTERNAL_CHARGE `Overage PL-…: 5 quarter hours at $42.50/h plus 8.875% tax`;
  row `Late 1.25 h · 0.00 pack h · Overage $57.84 · by Dana Okafor`.

### 7. Truck return and inspection (DP-36..42, DP-64)
- Trucks → Find a member `Mbeki` → Smoke Signal log (seed gap 33.50 h flagged) → Truck arrived → Truck departed →
  Record departure (services, operator signature) → new visit on top with its gap.
- Issue inspector link → PDF snapshot `visit-logs/<tenant>/<truck>/<link>.pdf` (Helvetica text), link row, outbox email
  `Commissary visit log: Smoke Signal` with only truck, site, URL and expiry (site time + zone). The inspector page calls only
  `GET /api/inspect/<token>` and `/log.pdf`. Revoke → 410 `link_revoked` → `This link was revoked`.

### 8. Rates and reports (DP-43..49, DP-65, DP-71)
- Rates: Effective from = picked site's `local_date` + 1, reset on site change; Schedule rate → table redrawn from the
  response `rates`, new row Upcoming, one Current.
- Audit: every write answers with one append-only event in its commit; `GET /api/audit` lists it within scope. brief: Audit trail.
- Reports: Month + Member (autocomplete) → Show report pushes `/reports?month=…&member=…`; the table and
  `Download CSV` (`/api/reports/utilisation.csv?month=…&member_id=…`) come from the address on open, reload, Back, Forward.

## Rules decided where the brief is silent

| Rule | Value | Source |
|---|---|---|
| Server clock resolution | milliseconds; every `*_at` is `YYYY-MM-DDTHH:MM:SS.mmmZ` | brief: API conventions, Server clock |
| Client clock | the page keeps the offset between the latest `Date` header and the browser clock at the moment that response arrived; each API response replaces it, and server-now is the browser clock plus that offset | brief: Server clock in the browser |
| Cancellation outcome check | every 250 ms, writing only when the outcome changes | brief: Cancelling (at least once a second, in place within 2 seconds); decided: the whole-second `Date` header can leave the estimate up to 1 s behind, so a 1 s check alone would use up the 2 seconds |
| Availability busy state | `aria-busy` is true only while a new rail subject's request is pending; a regular or post-action reload does not make a dial busy or unclaimable | brief: Rail and its subject, Visual design (a busy dial: rail subject pending); decided: a reload must not swallow a key press |
| Concurrency | member row lock first, then station row (holds, series) or booking row (transitions) | decided: one lock order, cross-process via PostgreSQL |
| Idempotency claim | key row inserted before the effect, completed in the effect's transaction, deleted on any refusal; in-flight rows older than 5 min are abandoned | decided: brief Idempotency keys |
| Dial reload timer | the next 15 s reload is scheduled from the latest dial load (own action, rail change or timer) | brief: Refresh rules (reload after own actions and every 15 seconds); decided: no redundant reload right after an action |
| Expiry sweep | every 1 s (holds and lots), notice scan every 10 s, outbox every 1 s | decided: within 5 s / 30 s / 10 s limits in the brief |
| Visit `manager_name` | the manager who recorded the departure (the arrival recorder while open) | decided: the signed log names who closed the visit |
| Ledger "newest first" | commit order (movement sequence), newest commit on top | decided: brief Packs (the new ledger line tops the table after a purchase); servers sharing the database may run different `PILOTLIGHT_CLOCK_START` clocks, so `created_at` alone can put an older commit above a newer one |
| Ledger table Available / Committed columns | running balances after each movement | decided: a ledger reads like a bank statement |
| Gap flag | on the rounded `gap_hours` (> 24.00) | brief: Truck visits and gaps (exactly 24.00 is not flagged) |
| Sessions | session rows are kept with `destroyed_at` so a dead value still names its owner in the audit trail; only sha256 digests of the session and CSRF values are stored | decided: brief Audit trail (a refused session's subject user), Sessions and sign-in |
| Opening balance `created_at` | the seed instant; under a seed set, before every record of that set | decided: the ledger reads newest first |
| Password hashing | bcrypt cost 10 via `bcryptjs` (bundled build input) | brief: Sessions and sign-in; decided: pure JS, no native build |
| Packaging | `react`, `react-dom`, `lucide-react` are `dependencies`; `pg` is a build input esbuild copies into the server bundle; notices list every bundled package plus the production tree | decided: IF-02 counts the `npm ls --omit=dev` tree, and `pg` there would bring its unmet optional peer `pg-native`, which has no package or licence |
| Spike order | tickets made on the screen (holds, series) stay on top in the order they were spiked; the rest newest `created_at` first, a series earliest occurrence first | brief: Screens and layout (newest on top), Interactions (a new Held ticket goes to the top; series earliest on top) |
| Dialog position | every dialog but Sign in again opens 24 px from the top; Sign in again stays centred | brief: Screens and layout (the interrupted dialog stays in place and its reference, pack name and typed values stay readable); decided: a centred dialog would sit behind the panel |
| Status word case | status stamps and table cells render the brief's printed case, in the condensed face | brief: Exact copy |
| Inspector email | the brief's email rule; a local part that is not a dot-atom is quoted on the SMTP wire | brief: Sessions and sign-in; decided: RFC 5321 allows quoted local parts |

## Palette (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| ground | `#E4E8EB` | brief: Visual design (cool paper-grey); decided: hex |
| rail | `#D7DCE0` | decided |
| paper | `#F7F7F3` | brief: Tickets (off-white, lighter than ground) |
| ink | `#14181C` | brief: near-black ink |
| muted | `#465059` | decided: AA secondary text |
| steel | `#717B84` | brief: mid steel grey (hatching, dots, rules) |
| flame | `#C93816` | brief: one flame accent (claim arc, live hold outline, forfeit warnings, expiring certificates, near-expiry lots) |
| green | `#1D5A3B` | brief: deep bottle green (confirmed, verified) |

## Type, space and layout

- Archivo variable at `font-stretch: 68%` 700–800 for headings, station names, ticket headers; IBM Plex Sans 400/600 body
  15 px; IBM Plex Mono 400/600 for every counting numeral. Steps 15 / 18.75 / 23.44 / 29.3 / 36.6 px (×1.25). brief: Type.
- Space on a 4 px step (4, 8, 12, 16, 24, 32). Controls ≥ 44 × 44 px (own box or label). brief: Density, Control size.
- Desktop: 12-column grid, max 1240 px; Book dials 8 cols (280 px dial left, name/kind/legend/inputs right), spike 4 cols sticky;
  Packs numerals + lots 8 / cards 4; Documents and Rates table 8 / form 4. 768: rail wraps, dials one per row with inputs below,
  spike a 2-column grid below, pack cards two per row. Phone: rail site + date first, radios beneath; dial at least ¾ of the width;
  single-column spike and cards; tables become labelled stacked cards. brief: Screens and layout.

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Buttons, radios, tickets | hover / press | 100 ms bg + 1 px lift | cubic-bezier(.2,0,0,1) | colour instant, no lift |
| Claim arc | drag / key | none (steps instantly) | — | same |
| Snap-back ghost arc | refusal | 250 ms `stroke-dashoffset` | brisk-settle | no ghost |
| Hold outline | live hold | 1 s loop stroke-width 3→5.5, opacity ≥ 0.72 | ease-in-out | steady outline |
| Confirm | confirm response | 250 ms flame→green fill, check fade, numeral count (rAF) | brisk-settle | final state at once |
| New ticket / others | spike update | 400 ms drop (translateY −12 → 0, opacity) and FLIP shift | brisk-settle | none |
| Dialog | open / close | 250 ms in, 100 ms out | brisk-settle | none |
| Status cell, lot line | value change | 250 ms tint (green 16 % in paper) | brisk-settle | none |

## States per async action

Every action writes its pending copy to its named `status` region, then exactly one success, error or outage copy from
brief: Feedback states (verbatim, in `src/client/copy.ts` and each screen). 500 → `Something went wrong. Refresh to see the
current state.`; dropped connection → `Can't reach Pilotlight. Check your connection and try again.`

## Breakpoints

`≥ 1024` desktop 12-column; `640–1023` tablet stacked; `< 640` phone single column with stacked table cards. brief: Layout bands.

## Media and licences

Fonts: Archivo (wdth+wght variable), IBM Plex Sans 400/600, IBM Plex Mono 400/600 from Fontsource 5.3.0, OFL-1.1, self-hosted
under `/fonts`. Icons: lucide-react (ISC), bundled. Favicon, dial, ticket edge, spike and empty-state drawings: original SVG.
