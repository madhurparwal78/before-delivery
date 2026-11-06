# TRUTH — Pilot Light Co. Hearthshift (golden, iteration 1)

Every value names its source: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

### 1. Claim time on the dial (brief: Journeys 1, Interactions)
- Start: Tamsin Okoro (`tamsin@junipercrumb.test`) signs in, lands on `/board`, picks `Ember Row — Halsted`
  in `combobox "Site"`, presses `button "Next day"`. Deck oven 1 shows `Your booking 04:00–08:00`
  (seeded `bk-seed-juniper-1`) as a solid tomato segment with its label.
- She presses a free tick on the Deck oven 1 ring (outermost) and sweeps clockwise. The arc grows in
  15-minute snaps; `region "Selection summary"` counts `<hours> h`, `$<amount>` (card at $38.00/h for
  hours beyond her pack), `Pack <hours> h`, `Card <hours> h`, `Pack balance 10.00 h`.
- Reaching 04:00 the arc stops at the boundary with a spring-back (≤ 6°), a boxed callout
  `Your booking 04:00` appears on the ring, `status "Dial status"` reads
  `Stopped at Your booking 04:00–08:00`.
- She releases: `Placing hold…`, then `Held until <HH:MM>. Finish checkout to keep it.`; the arc
  fills solid tomato in 450 ms, the countdown ring traces the outer edge, `timer "Hold time left"`
  counts `MM:SS`, and the Checkout panel opens at the right of the dial.
- Provider: Postgres `holds` row `held` with `expires_at = created_at + HOLD_TTL_SECONDS`.

### 2. Check out and pay (brief: Journeys 2)
- `/pack` → `button "Buy 20-hour pack"` (`Buy 20-hour pack · $560.00`) → `Buying pack…` →
  `20 hours added. <hours> h available.`; Kill Bill PURCHASE `hs-pack-<pack id>` $560.00; ledger
  `purchase` movement (purchased −1200 / available +1200).
- Board → `button "Checkout"` → tick `Use pack hours`, `radio "Pay now"`, `Confirm booking` →
  `Confirming…` → `Booking confirmed. Confirmation email queued.`
- A printed ticket slides onto the rail from the right (250 ms) stamped `Confirmed`, payment label
  `Paid` (or `Pack` when fully pack-paid); pack balance drops by the reserved hours.
- Kill Bill: account `hs-renter-<id>` on `__EXTERNAL_PAYMENT__`, PURCHASE `hs-deposit-<booking>`
  $75.00 and `hs-booking-<booking>` for the card minutes; Mailpit: one `Booking confirmed: …` email.

### 3. Recurring overnight shift (brief: Journeys 3, Clock-change rule)
- Hold Deck oven 2 01:00–05:00 on a Sunday, `repeat_weeks` 4, spanning the autumn change
  (2026-11-01 at Halsted). Four occurrences, one expiry. The change-day occurrence is 300 minutes
  (01:00 CDT → 05:00 CST), the others 240.
- After confirmation four tickets show `5.00 h` / `4.00 h`; the invoice line carries `minutes: 300`;
  the email subject `Booking confirmed: Deck oven 2, 4 dates from <first date>`.
- The 2026-11-01 dial shows 25 hour ticks with the repeated hour labelled `01 CDT` and `01 CST`.

### 4. Run the counter (brief: Journeys 4)
- Priya Lindqvist lands on `/counter`. On Board she picks the renter in `combobox "Renter"`, sweeps a
  walk-up slot, confirms with Pay now.
- Counter row: `Check in` → `Checked in: <business>.`; `Charge overrun` opens `dialog "Charge overrun"`;
  40 minutes on a $38.00 station quotes `$25.33`; `Charge` sends one request with a key made when the
  dialog opened (a second press while pending is ignored; a retry reuses the key) →
  `Overrun of 40 min charged: $25.33.`; `Check out` → `Checked out: <business>.`;
  `Add cleaning fee` → `Cleaning fee charged: $35.00.`; `Settle` → `Settled. Deposit refunded: $75.00.`
- Kill Bill: exactly one `hs-overrun-` PURCHASE, one `hs-cleaning-` PURCHASE, a REFUND on `hs-deposit-`.

### 5. Cancel under the booking's own terms (brief: Journeys 5, Cancellation terms)
- Booking A confirmed under the 24-hour version, booking B after a 72-hour version became effective.
- At the same distance from start (say 48 h): A's cancel dialog says `You'll get a full refund.`,
  B's says `You're inside the 72-hour notice. Nothing will be refunded.`; each quotes its own terms
  line. A → `cancelled_refunded` (time and deposit REFUNDs, pack `release`); B → `cancelled_forfeit`
  (pack `forfeit`, nothing refunded). Tickets keep their place and gain the stamp.

### 6. Manager's morning report (brief: Journeys 6)
- Odile Marchetti lands on `/manage`: `region "Site totals"` lists Ember Row — Halsted and Corktown
  plus an All sites row; never Cedar Commons. Renter search updates 300 ms after typing pauses.
- Utilisation for a site and day reads booked hours, day hours (23/24/25), percent half-up to one
  decimal; `link "Download CSV"` downloads `station,booked_minutes,day_minutes,utilisation_percent`.
- `Schedule policy` → `<notice>-hour policy scheduled from <date>.`; the row shows `Odile Marchetti`.
- Override: in Booking details `textbox "Override reason"` + `Cancel with full refund` →
  `Cancelled with full refund. Reason recorded.`; audit event carries her name and reason.

### 7. Keep documents current (brief: Journeys 7)
- June Abernathy has no certificate; Confirm answers
  `Upload a liability certificate that covers <dates> before confirming.`
- `/documents`: Liability certificate, Valid from, Expires on, a PDF → `Uploading…` → `Document saved.`;
  the row reads `Current`. MinIO object `renters/rn-ledger/documents/<doc id>`, content type from the
  file's bytes. Her next confirmation succeeds. A document expiring within 14 days queues one reminder.

### 8. Inspector visit (brief: Journeys 8)
- Manager creates a Halsted link for a week → `Binder link ready.`; the PDF is written to
  `sites/site-halsted/binders/<link id>.pdf`.
- `/binder/<token>`: site name, range, generated time, `table "Compliance binder"`
  (Date, Renter, Business, Station and time, Liability certificate, Food handler card) with
  `Current until …` / `Expired …` / `Missing`, `link "Download PDF"`; no phone, email or money.
- Regenerate → `New link ready. The old link no longer works.`; the old address shows only the heading
  `This binder link is no longer valid` (HTTP 404). Revoke → `Link revoked.`; the new address dies too.

## Palette (decided values; roles from brief: Visual design)

| Role | Hex | Use |
|---|---|---|
| ground (paper) | `#F6F0E4` | page ground, free ring bands (hue 40°, L 93%) |
| slip | `#FCF9F2` | tickets, panels, dialogs, inputs |
| ink | `#1B1A17` | text, rules, primary buttons, focus outline (15.3:1 on ground) |
| steel | `#5B6B7A` | other renters' booked time (hatched), secondary text (4.8:1) |
| sand | `#A3814A` | held time with dotted ink edge (3.1:1 fill) |
| tomato accent | `#C4371B` | your arc, your holds and bookings, countdown ring, card-overflow numerals (4.7:1) |
| rule-soft | `#D8CCB4` | 8 px rail grid, quiet rules |
| sand-wash | `#EFE3CB` | outage banner, error strips |

The accent is never used for buttons, links, headings or other renters' time (brief: Visual design).

## Type (brief: Visual design; sizes decided at ×1.333 steps)

| Token | Family | Weight | Size |
|---|---|---|---|
| display | Archivo (self-hosted variable, wdth 87.5%) | 800 / 700 | 38 / 28 / 21 px |
| body | Public Sans | 400 / 600 | 16 px / 1.5, small 14 px, caption 12 px |
| numerals | JetBrains Mono, tabular | 400–800 | every time, amount and hour count |

## Space and layout (brief: Screens and layout; values decided on the 8 px grid)

- Grid: 8 px steps; ground shows 8 px minor and 64 px major rule lines; controls ≥ 44 × 44 px.
- Desktop 1280×800: 208 px station column (order-rail slips) · dial ≤ 480 px centred with controls
  above · 344 px side column (hold timer + Checkout button, Checkout panel, legend, "On the dial"
  callouts) · ticket rail full width beneath, scrolling sideways inside itself.
- Tablet 768×1024: station buttons wrap in a row above the dial, dial up to 680 px, Checkout panel
  below the dial, Manage one column.
- Phone 375×812: controls stack, station buttons wrap, dial fills the width inside 16 px margins,
  rail is a vertical stack, Checkout is a fixed bottom sheet, Counter rows are stacked cards.
- Manage: two columns ≥ 1100 px (totals | search, utilisation | policy, binder links full width).

## Motion (brief: Motion and effects; driven by requestAnimationFrame, decided so the page clock drives it)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| arc moving end | each 15-minute snap | 90 ms | ease-out expo | jumps |
| spring-back | arc meets a blocker | overshoot ≤ 6°, settles in 450 ms | ease-out expo | jumps to the boundary |
| summary numerals | value change | 250 ms | ease-out expo | instant |
| hold fill | hold placed | 450 ms (`fill-opacity` .16 → 1) | ease-out expo | instant |
| countdown ring | every second | step | none | replaced by `Held until HH:MM` |
| lost claim retract | 409 slot_taken / 422 | 450 ms, both ends to the pressed tick | ease-out expo | instant |
| ticket slide | new ticket | 250 ms, translateX 56 → 0, opacity 0 → 1 | ease-out expo | instant |
| dialog in / out | open / close | 250 ms rise 12 px + fade / immediate (decided: a modal must not hold the page beneath it after it is dismissed; immediate is within the brief's tenth of a second) | ease-out expo | instant |
| press | :active | immediate 1–2 px press | — | none |

No idle loops, no CSS transitions or keyframes; the countdown ring is the only continuously changing element.

## States per async action (brief: Feedback states, copied verbatim)

| Action | Region | Pending | Success | Errors |
|---|---|---|---|---|
| Sign in | Sign-in status | Signing in… | lands on Board / Counter / Manage | Email or password is wrong. |
| Place hold | Dial status | Placing hold… | Held until <HH:MM>. Finish checkout to keep it. | Another renter just took this time. <blocker label> · That time can't be held: <first field message> |
| Drag blocked | Dial status | — | — | Stopped at <blocker label> |
| Hold expired | Dial status | — | Your hold ran out and the time was released. | — |
| Let hold go | Checkout status | Releasing… | Hold released. | — |
| Confirm | Checkout status | Confirming… | Booking confirmed. Confirmation email queued. | 410 / certificate_required / pay_now_required / pack_insufficient / 503 copy |
| Pay balance | Dial status | Paying… | Balance paid: $<amount>. | the confirm 503 copy |
| Buy pack | Pack status | Buying pack… | 20 hours added. <hours> h available. | the confirm 503 copy |
| Cancel | Dial status | Cancelling… | full / forfeit copy | Refunds are delayed while billing is unreachable. Your booking is unchanged. |
| Counter actions | Counter status | Saving… / Charging… / Settling… | Checked in / Checked out / Overrun / Cleaning fee / Settled copy | window and 503 copy |
| Upload | Documents status | Uploading… | Document saved. | 415 / 413 / field message |
| Policy | Manager status | Scheduling… | <notice>-hour policy scheduled from <local date>. | field message · A policy already starts on that date. |
| Binder links | Manager status | Saving… | Binder link ready. / New link ready. The old link no longer works. / Link revoked. | field message |
| Override | Manager status (inside Booking details) | Cancelling… | Cancelled with full refund. Reason recorded. | Give a reason of at least 5 characters. · the cancel 503 copy |

Outage banner (`status "Service status"`, polled every 5 s): billing and mail lines verbatim from the
brief; while billing is delayed the six card controls show a visible `(delayed)` suffix and keep
their accessible names.

## Decisions where the brief is silent

- decided: hold `occurrences[].start/end` are the local wall times of the resolved instants.
- decided: extra response fields the UI needs, each computed by the server's single rule:
  `hold.terms`, `hold.occurrences[].due_by`, `hold.occurrences[].local_start/local_end`,
  `booking.cancel_tier`, `booking.local_date`, `booking.refund`, `document.status`, `document.days_left`.
- decided: Board rail shows a renter's bookings; staff see the selected site's bookings for the day.
- decided: Counter shows a site picker for managers (they act on every site).
- decided: invoice lines: station time (minutes = elapsed minutes, amount = card cents), deposit,
  overrun, cleaning fee; totals sum the lines.
- decided: same-origin check compares `Origin` with the request's own `Host`.

## Breakpoints

`≥ 1100` desktop, `700–1099` tablet, `< 700` phone (decided: brief viewports 1280 / 768 / 375).

## Media and licences

| File | Licence | Source |
|---|---|---|
| `src/client/fonts/archivo-latin-standard.woff2` | OFL-1.1 | Fontsource `@fontsource-variable/archivo@5.3.0` |
| `src/client/fonts/public-sans-latin-wght.woff2` | OFL-1.1 | Fontsource `@fontsource-variable/public-sans@5.3.0` |
| `src/client/fonts/jetbrains-mono-latin-wght.woff2` | OFL-1.1 | Fontsource `@fontsource-variable/jetbrains-mono@5.3.0` |
| `src/client/public/favicon.svg` | original | drawn for this app |
| Lucide icons via `lucide-react` | ISC | npm |
| dial, patterns, ticket perforation, empty-state spike | original | inline SVG / CSS |
