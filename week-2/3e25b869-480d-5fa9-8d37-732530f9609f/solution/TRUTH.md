# TRUTH — Pain de Lune Loafline

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` fills silence in
the brief's intent. Copy strings, codes, statuses and formulas not repeated here are exactly as printed in
the brief (Feedback states, API, Business rules, Services) and live in `app/src/shared/copy.ts`.

## Journeys (ideal end-to-end flow)

1. **Catch a drop** (brief: Journeys 1).
   - Start: no session, `/` (or `/?batch=B-0412`), seed batch B-0412 live with 12 available bars.
   - Actions: scroll (wheel, keys or touch) moves the wire; `data-cut-step` = floor(s×N÷2400); choose a scent
     chip; "Hold a bar" → "Cart updates" reads "Bar 1 is held for you. Time left: 10:00. Total is now $23.00."
     and "Go to checkout (1)" appears; on `/checkout` enter email → "Send code" → code from the email →
     "Verify" (collapses to "Signed in as <email>", focus to "Full name") → address → "Pay $23.00".
   - End: `/checkout/placed/PDL-xxxxxx`, heading "Order PDL-xxxxxx placed", "We'll email your confirmation to
     <email>."; Kill Bill: account (external key = email, CAD, America/Toronto, external payment method),
     one committed invoice (bar charges, Shipping, GST/QST tax items) paid by one purchase keyed by the
     order number; PostgreSQL: order, lines, holds `converted`, one `sale` movement per batch, one notice
     `order.<number>`; Mailpit: one bilingual "Order PDL-xxxxxx confirmed". Sold out / hold-ended paths
     show the published copy and charge nothing.
2. **Start a Trio** (brief: Journeys 2): `/subscribe` → scent radio → Cadence menu → email code → address →
   "Start subscription" → `/account/subscriptions/SUB-xxxxxx` with "Subscription started. Charged today:
   $33.39." in "Account updates"; Kill Bill subscription on `trio-monthly`, first invoice $29.04 + tax
   items = $33.39, payment keyed `SUB-xxxxxx-<started_on>` (none when credit covers it); Mailpit: one
   "Subscription SUB-xxxxxx started". A second start answers 409 `subscription_exists`.
3. **Run a Trio** (brief: Journeys 3): sign in by code on `/account`, open the subscription; skip / undo,
   swap scent, change cadence (sent on choosing), pause / resume, cancel through the dialog. Kill Bill:
   `TRIO_SKIP`/`TRIO_PAUSE`/`TRIO_CLEAR` blocking states (service `loafline`) at 00:00 Toronto, dated plan
   change, dated cancel. Inside the lock window: "This cycle is locked. Changes open again after <date>."
4. **Log, cut and drop a loaf** (brief: Journeys 4): `/studio` sign in (maker) → Batches → "Log a loaf"
   (scent, pour date, cure days) → "Loaf B-0415 logged." → "Cut B-0415" dialog → "B-0415 cut into 6 bars."
   → "Open now B-0415" (or Schedule in Toronto time) → the row reads Live; counts follow holds within 7 s.
5. **Pack today's orders** (brief: Journeys 5): packing role sees only Packing; "Pack today" lists unshipped,
   not fully refunded orders with `ship_on` ≤ today, no money; "Mark PDL-x shipped" → "PDL-x marked shipped."
6. **Refund, credit and reconcile** (brief: Journeys 6): Finance → search → record opens directly when
   one matches → refund bar 1 with restock ("Refund RF-x issued: $12.65."), add a $25.00 credit; the audit
   lists both; Reconciliation → month → "Only mismatches" → "Accept Kill Bill figure for <key>" →
   "Kill Bill's figure of <amount> is now the shop record for <key>."; orphan payments refunded from their
   `payment:<id>` line.
7. **Write to the shop** (brief: Journeys 7): `/contact` → "Thanks. Your reference is CT-x. We'll reply by
   email."; the acknowledgement is queued and sent (retried 5 s, 15 s, 45 s; failed after 4 attempts;
   staff "Resend NT-x").

## Palette (decided hex for the brief's roles; brief: Colour roles)

| Role | Hex | Source |
|---|---|---|
| ground (pale warm oat) | `#EFE7D6` | decided: HSL 41° 44% 89% — warm, lightness > 85% |
| ink (warm near-black) | `#2A2420` | decided: 12.45:1 on ground |
| ink-muted | `#5C5046` | decided: secondary text, 6.34:1 |
| control outline | `#7D6C5A` | decided: 4.1:1 (≥ 3:1) |
| accent (burnt rust) | `#9E421D`, hover `#843617` | decided: oat on rust 5.25:1 |
| sage (marks) | `#5F7259` | decided: 4.23:1 for marks only |
| rule (light tan) | `#CDBB9A` | decided |
| kraft / fold | `#9A7044` / `#C29A68` | decided: clearly darker than ground |
| danger text | `#8A3216` | decided: 6.70:1, rust family |
| tints | lilac `#8B76A6`, ash `#6E6863`, mint `#5A8F74`, rose `#B06F78` | brief: Seed data tint names; hex decided |

## Type, space, layout

- Fraunces headings (h1 31.25px, h2 25px, h3 20px), Instrument Sans body 16px, ratio 1.25 (brief: Type);
  `tabular-nums` on every number (brief: Mood). Both bundled woff2 (OFL).
- 12-column grid, gap 24px (16px < 1024), padding 32px (16px < 768); controls ≥ 44×44px; radius 3px; no
  shadows or gradients (decided from brief: Visual design).
- ≥ 1024px: loaf sticky in columns 1–7 under a 64px sticky header; label card 8–12; checkout/subscribe
  forms 1–7 with the total sticky in 8–12. < 1024px: stacked, loaf pinned at `56svh` under the header,
  "Show bar list" disclosure. < 768px: header 96px (brand + toggle row, nav row), fixed in both languages
  so switching language never moves the loaf (brief: Screens and layout; header heights decided).
- Drop section height = the viewport height measured once at page load + 2,400px, never re-measured on resize
  or toolbar changes (brief: Screens and layout).
- Keyboard scrolling on the drop page lands on a 40px grid: arrows 40px, Page Down/Space the largest multiple of
  40 within 87.5% of the viewport (decided: every published position, 200 × k and 2,400, is reachable by keys).
- A control scrolled into view is never left under the sticky header or the pinned loaf: `html`
  `scroll-padding-top` = header height (+ 56svh on the stacked drop page), controls add a 12px
  `scroll-margin-top` (decided: brief "no text or control is clipped"; chips wrap to more rows as drops grow).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| button deepen / 1px press, chip fill, switch thumb | hover, press, select | 180ms | cubic-bezier(0.22,1,0.36,1) | instant |
| wire snap | scent change | 320ms | ease-out quart (rAF) | instant |
| yaw return | pointer leaves | 320ms | ease-out quart | yaw fixed 0 |
| disclosure open, dialog fade-and-rise | toggle, open | 320ms | WAAPI, same bezier | instant |
| slice tip / stand | each boundary crossed | 600ms | ease-out quart (rAF) | jump to step |
| paper wrap / unwrap, sold bar sinking away | poll change | 600ms | ease-out quart | instant |
| hold row slide-in / fold-away | hold appears / ends | 600ms | WAAPI | instant |

The loaf's top crowns along its length by 0.26 bar widths (10% of its 2.6 height) and across its depth by
0.2; faint score lines mark every bar boundary on the front and top; light from the upper left and front
(decided: brief "slightly domed, hand-textured top", "soft and directional"). The camera frames the loaf
at every yaw so it fills about 91% of the figure width (52% of the main width at 1280px), its band about a third
of the way down, with the fallen slices below it and the caption "Cut c of N" 16px under them, aligned with the
loaf's left end, in mixed case (decided: brief "a large still-life on the left"). The wire and its handles reach
past the loaf's depth on both sides so it stands apart from the loaf's edge (decided: brief "a thin, taut rust line
spanning the loaf's depth, with a small handle at each end").
Slices tip over sideways about their lower outer edge and lie fanned like toppled dominoes within the loaf's
own length, in front of the loaf, below its band, cut
face up (decided: shows the swirl, per brief "showing its swirl"). The preference is followed live; nothing
loops while idle (a frame callback only reads the scroll offset).

## States per async action

Pending labels and busy/disabled marks exactly as brief: Feedback states ("Holding…", "Sending…",
"Checking…", "Paying…", "Starting…", "Saving…", "Refunding…"). Results go to the named polite region,
replacing its whole text. Field errors: "Check these fields" alert + messages + `aria-invalid`.
Outages: "Service status" banner copy, pay/start controls named "Checkout paused" / "Subscriptions paused".

## Breakpoints

1024px (stack vs columns; disclosure), 768px (header rows, padding) — brief: Screens and layout.

## Media and licences

No photographs, icons or audio. Fonts: Fraunces and Instrument Sans woff2 from Fontsource 5.3.0, OFL-1.1
(`app/assets.json`, `app/THIRD_PARTY_NOTICES.md`). Loaf scene, loaf diagram, bar marks and empty-state
mark are drawn in code (original).
