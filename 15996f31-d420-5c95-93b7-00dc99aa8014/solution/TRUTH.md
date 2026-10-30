# TRUTH — Swarmline Bloom Desk (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys: ideal end-to-end flow

### 1. Broker sets up a season order (brief: Journeys 1; DP-11, DP-12, DP-13, DP-15)
- Start: broker signed in at `/desk` (seeded `dana@kettleman-pollination.example` / `bloom-desk-2027`, brief: Seed data).
- "New orchard" → dialog "New orchard": Grower, Orchard name, County, Block name + Acres rows ("Add block"). An invalid
  submit (empty name) shows "Orchard name must be 1 to 80 characters" beside the field and in "There is a problem",
  focus on the summary (brief: Interactions, API). "Save orchard" → "Saving orchard…" then "Orchard <name> saved."
  (brief: Feedback states); the desk switches to the new orchard in the left rail (decided: the journey ends there).
- "New order" → Orchard, Bloom start/end, Delivery deadline (Pacific dates typed `2027-02-05` or `Feb 5, 2027`;
  decided: both forms parse, ISO is sent), "Hives, <block>" per block → "Save draft" → "Draft order BD-1xxx saved.";
  the desk shows that order (status Draft). Rule set = latest `effective_from` ≤ bloom start (brief: Pay rules).
- "Open order" → "Opening <ref>…" → "<ref> is open to beekeepers. Deposit invoice recorded." End: plat map blocks
  "Not inspected", ledger Ordered = hives, "Order status: Open". Provider: Kill Bill account (external key = grower id,
  business name, USD, contact email) with one invoice holding one external charge "Deposit · <ref>" =
  hives × deposit per hive (brief: Services). Kill Bill down: 503, "Billing is unreachable, so <ref> is still a draft.
  Try again in a minute.", status stays Draft.

### 2. Beekeepers fill the order (brief: Journeys 2; DP-16..DP-22)
- Both beekeepers see HS-2027 under "Open orders" with pay per hive by tier (price × (10,000 − bps)/10,000, half up;
  2027: None $0.00, Reduced $131.27, Standard $189.30, Bonus $211.76) and never the grower price.
- "Commit truckload to HS-2027": Yard name, Hives (starts at, and capped by, the still-open count read when the dialog
  opens). Commit 80 → "80 hives committed to HS-2027.", Still open 160.
- Second dialog with 100 open while the other beekeeper commits 80 → submit → 409: "Only 80 hives are still open on
  HS-2027." beside Hives, in the summary and in "Desk problems"; Hives max becomes 80; Open orders and the ledger's
  Still open show 80. Commit 80 → order Filled. The server decides commits one at a time under the order row lock.
- "Log drop" per committed drop: Block, Delivery date and time (both Pacific; default the current Pacific wall clock
  whatever the browser zone). Sent as an ISO time with the Pacific offset; `delivered_on` = Pacific date. Success
  "Drop logged: 80 hives in Block 1, delivered Feb 5, 2027."; row shows Delivered. Late → "Delivered after the delivery
  deadline (<date>)"; full block → "<block> has room for <n> more hives".

### 3. Broker places the order and calls the inspector (brief: Journeys 3; DP-23..DP-27)
- "Mark placed" (filled, all delivered) → "<ref> placed. The grower's placement confirmation is on its way." Mailpit:
  one "Hives placed: <orchard> · <ref>" to the grower contact, one line per block "<block>: <hives> hives, delivered
  <latest date>", no "$", no beekeeper names. Otherwise "Every drop on <ref> must be delivered first."
- "Send inspection link" → Inspector email → "Inspection link for <ref> is on its way to <email>. Any earlier link has
  stopped working." Ledger: "Inspection link: Issued". Email "Inspection sheet: <orchard> · <ref>" with
  `<APP_BASE_URL>/inspect/<token>` and the expiry sentence. Token stored hashed, never in a response.

### 4. Inspector samples and signs (brief: Journeys 4; DP-28..DP-37)
- `/inspect/<token>` on a phone, no sign-in: header (orchard, county, ref, "Link expires <Pacific date-time>"),
  compact plat map, a section per block (readout, tier, samples needed, yards, samples with photos), "Add sample",
  docked "Payable" row and "Sign report". First read moves the link Issued → Used.
- Add sample → digits roll toward the browser's provisional average (dimmed), settle on the server's figures; tier
  pattern and label swap; Payable rolls; "Strength readout" announces "<block>: <avg> frames, <tier>. Orchard payable
  $<amount>." A chosen photo uploads right after ("Photo added to sample C1."). Refusals roll back within 0.8 s.
- "Sign report" → Full name, attestation checkbox → "Sign and send" → "Report signed. The grower's notice is on its
  way."; the sheet shows "Signed"; reloading shows "This inspection link no longer works" / "The report for <orchard>
  has been signed." Provider: PDF at `inspections/<order>/report-<link>.pdf`; one balance invoice with one charge per
  non-zero block "<ref> · <block> · <tier> · <hives> hives"; one credit "Deposit applied · <ref>"; order and drops
  Inspected; one "Inspection signed: <orchard> · <ref>" notice. All or nothing; replay by Idempotency-Key.

### 5. Beekeeper reviews a drop (brief: Journeys 5; DP-38, DP-39)
- `/desk/drops/<id>`: yard, hives, block, delivered date, status, frame photos (links "Photo, colony <label>"), block
  tier, pay per hive and expected pay (allocation payout). "Accept inspection" → "Inspection accepted for <yard>." or
  "Dispute inspection" (reason 10–500) → "Dispute sent to the broker."; the broker's "Resolve dispute" (note 1–500) →
  "Dispute resolved. <yard> is accepted."; both then see Accepted.

### 6. Broker settles the orchard (brief: Journeys 6; DP-40..DP-43)
- "Settle orchard" loads the split first, then the dialog shows table "Settlement split" (beekeepers, broker commission,
  orchard payable) and "Payment received" (Pacific date, default today) → "Settle". 200 → "<orchard> settled." and
  "Order status: Settled"; Kill Bill: one external payment for the payable against the balance invoice, external key
  `settle-<order id>`, balance back to zero. Billing down → 202 "Settlement queued: billing is unreachable. It will finish
  on its own when billing returns.", "Order status: Settlement queued"; every instance retries every 10 s with row locks;
  the desk announces "<orchard> settled." within 5 s of completion. Example (brief): payable $20,577.50 → commission
  $2,417.86, Ridgeback $9,689.41, Prairie Lantern $8,470.23.

### 7. Grower reviews the orchard (brief: Journeys 7; DP-25, DP-44, DP-45)
- Grower desk: own orchards only; blocks named "<block>, <tier>, <avg> frames" with label and pattern; legend; selecting
  a block shows "Placements, <block>" (Yard, Hives, Delivered, Strength); ledger Ordered, Delivered, Deposit, Payable;
  "Inspection report (PDF)" once signed. No beekeeper names, pay or commission anywhere in the grower's JSON or page.

## Palette (brief: Visual design → Colour roles; hex decided within the direction)

| Role | Hex |
|---|---|
| paper ground | #F6F1E6 |
| ink (text, hairlines, borders, primary fill) | #1B2A21 (13.32:1 on paper) |
| soft grey olive (secondary, scale note, empty) | #59604E (5.81:1) |
| honey amber (tier patterns, chip border) — tiers only | #9A6510 (4.39:1, ≥3:1 non-text) |
| amber chip / wash | #F2CF7A / #FBF3DD |
| almond-blossom pink (selected block, bloom dates) | #F8DCE0 |

## Type (brief: Type)
Young Serif (headings, wordmark), Public Sans (body, controls; block names in all-small-caps), IBM Plex Mono with
tabular figures for every number. Scale 1.2 (h4 1.2rem, h3 1.44, h2 1.728, h1 2.074), body 16px. Self-hosted woff2.

## Space and layout per viewport (brief: Screens and layout)
- 8 px rhythm; ledger rows 48 px; map frame double hairline with 24 px paper margin (16 px phone) (decided).
- 1280×800: rail 20 fr / canvas 55 fr / ledger 25 fr; sheet: centred 68 rem with the map beside the sections.
- 768×1024 (≤1199 px): "Orchards" drawer over the canvas; canvas full width; ledger below the legend.
- 375×812 (≤699 px): one column in the brief's order; tables become labelled cards; the sheet docks Payable + Sign report.
- Plat map: 1 row for ≤2 blocks, 2 rows for 3–6, 3 rows for 7–12, listed order, balanced counts; parcel flex-grow =
  acres (area ∝ acres), minimum 96/76/66 px wide so nothing crops and every block is ≥ 44 px (decided).
- Plat frame: ink survey ticks every 1/16 along the inner rule, row section numbers in the left margin (hidden ≤699 px),
  40 px north arrow with "N" and a hairline scale bar (alternating ink/paper segments, "0 — 10 ac") beside the scale note; the map grows (min-height) so 3 rows never overflow (decided: survey
  plat look, DP-07). An orchard with no order shows its parcels in dashed outline, not interactive, noted "No order yet".
- Selected / hovered / focused block: 3 px solid ink stroke drawn above the blossom wash; dashed only for Not inspected.
- Broker ledger: the order status line and every broker action button (the order's current actions, then
  "New orchard" and "New order" side by side after a hairline) sit under the ledger rows, followed by the
  inspection link status (brief: Screens and layout, "The order status line and the role's action buttons sit
  under the ledger rows. The broker also sees the inspection link's status there."). With no order yet, the
  empty-ledger note comes first and the buttons follow it.
- Status labels (rail, ledger "Order status:", drop detail) are text chips: 1 px ink hairline, 2 px radius, Public Sans 600
  at 0.8125rem, 4×8 px padding (decided: DESIGN.md feedback-badge row). The broker's ledger buttons appear once the
  order has loaded, so they never jump down under a pointer (decided: no layout shift).
- A blank tens column in a readout takes no width, so the digits centre on the plate (decided).
- County shown as stored with " County" added only when the value doesn't already end in it (decided).
- Field messages sit under their input; editing a field clears its message and summary link until the next submit.

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| readout digit strips | accepted sample change | 300 ms + 62.5 ms per extra digit (≤ 800), right column first, +40 ms per column | cubic-bezier(0.16,1,0.3,1) | change at once + "Strength changes" note |
| provisional roll | "Add sample" pressed | same, dimmed to muted ink | same | skipped |
| rollback | server refusal | ≤ 800 ms | same | at once |
| tier pattern + label | 300 ms after digits settle, if tier changed | 300 ms cross-fade | ease-in-out | at once |
| Payable roll | after the tier fade | same rule, scaled to end ≤ 1950 ms after the answer | same | at once |
| dialogs | open / close | 250 ms in (fade + 8 px rise), 170 ms out | (0.2,0.8,0.2,1) / ease-in | instant |
| drawer | open / close | 250 ms in from 24 px left + fade, 170 ms out (closed = inert, transparent, no pointer events; decided: one steady closed state) | same | instant |
| buttons | hover / press | 90 ms background darken | linear | none |
| busy dots | request in flight | 1 s loop | ease-in-out | "Working…" |

## States per async action
Exactly the brief's Feedback states table: pending and success in status "Desk updates" (a toast that never takes a
click), refusals and outages in alert "Desk problems" (banner with a dismiss button), 422 messages beside fields and in
"There is a problem", busy buttons disabled with `aria-busy`. Other copy (network, 401, 404, other 409, 5xx) verbatim.

## Breakpoints
1200 px (three columns ↔ drawer), 700 px (one column, cards, docked sheet bar) (decided to land the brief's three
named viewports in distinct layouts).

## Media and licences
Fonts: Young Serif, Public Sans, IBM Plex Mono (OFL-1.1, Fontsource 5.3.0 woff2, listed in `app/assets.json`). Icons:
Lucide via lucide-react (ISC). Tier patterns, north arrow, plat drawing and favicon: original SVG. No photos in the UI
except inspectors' frame photos (user content in MinIO).
