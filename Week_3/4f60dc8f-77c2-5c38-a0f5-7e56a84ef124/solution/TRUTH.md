# TRUTH — Gloamwork Shot Rig (golden)

The brief made concrete. Each value says `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys

### 1. Explore and start
- Start: no session, `/` (brief: Journeys 1).
- Phone: `Menu` opens the drawer (focus on `01 Work`, Tab wraps, Escape returns to Menu); the case study deck
  advances by fling > 0.5 px/ms, drag ≥ 120 px or arrow keys, `data-deck-index` 1-based (brief: Interactions).
- Wider: hero `data-scrub-progress` = clamp(scrollY / 2400) to 3 decimals, parts separate outward; Services row
  objects tilt up to 12° toward the pointer (`data-tilt`); Process `data-process-step` = 1 + floor(progress × 5),
  capped at 5 (brief: Motion and effects).
- Search `kettle` (debounce 250 ms, Enter immediate) → Meilisearch `studio_content` → `Brant & Vale Arc kettle`
  → `/work/brant-vale-arc-kettle`; `Search status` reads `Matches: <n>` (brief: Interactions › Studio search).
- Tile → case study in place (no page load), shared-element morph 600 ms (`data-transition` morphing → done);
  `Clay view` switch morphs 600 ms (`data-morph` 0.000 → 1.000); Back reverses into the tile (brief).
- `05 Start a project` → `/start`, choose JPY → 201 → `/rig/<id>` signed in (`gw_session`) (brief).
- Provider state: Postgres brand + 3 contacts + quoted engagement `GW-1005`+ (brief: Business rules).

### 2. Upload and check scale
- Rows appear at once and upload one after another (XHR progress, `Uploading <name>: <n>%` once per 10 %),
  `<name> received.` after MinIO HEAD confirms size; record created only then (brief: Feedback states, Business rules).
- GLB judged before storing (magic, version 2, length, JSON/BIN chunks, asset 2.0, extensions, matrix/TRS,
  POSITION types); published 422 copies otherwise (brief: Intake files).
- One persistent message `{"intake_file_id"}` on durable `intake.measure`; worker reads header + JSON chunk from
  MinIO by range, dequantizes, carries corners through world transforms; millimetre export measures 180 × 210 × 85 m
  → needs unit → `Check the export unit for mm.glb.` + dialog auto-opens; `Millimetres` → `180.0 × 210.0 × 85.0 mm`
  / `7.09 × 8.27 × 3.35 in` (brief: Measurement).
- Quantized GLB (short normalized, node scale) measures 0.18 × 0.21 × 0.085 m directly (brief: example).
- PDF downloads byte for byte with `Content-Disposition: attachment; filename="<fallback>"; filename*=UTF-8''<enc>` (brief).
- End: rows `Received`, model `Measured`, GLB fetched from the content route stands on the plinth at true size
  beside an 85.6 × 54 mm card outline (brief: Visual design › The plinth).

### 3. Shot list and deposit
- Select: `flying` 600 ms (1.6R → 1.0R), `focusing` 320 ms (ink → ember), `cut` (`data-pip-shot`), `counting`
  500 ms after an applied reply; deselect reverses (brief: Motion › Shot Rig selection sequence; decided: durations
  inside the published ranges).
- Colourway burst: per-shot queue, only the latest waiting value is sent; replies applied only when `revision`
  is higher than `data-quote-revision` (brief: Interactions › Quote updates).
- Pay deposit (keyboard): `Idempotency-Key` per card body; preconditions in order; SMTP probed before Kill Bill;
  Kill Bill account (external key = brand id, AUTO_PAY_OFF, external payment method default), charge invoice
  `Deposit GW-…`, PURCHASE, balance 0; receipt PDF (Gotenberg) sent in-request; ledger `deposit`; push queued
  (brief: Deposit; decided: AUTO_PAY_OFF so Kill Bill never pays an issued invoice by itself).
- End: `Deposit received`, `A receipt for this deposit goes to <finance email>.`, `Locked at 205.4175 per £1 on
  <date>.`, milestones in whole yen; one receipt email with `<ref>-deposit.pdf`; one `Deposit paid` push (brief).

### 4. Look-dev review
- Founder posts one still per line (`stills/<eid>/look_dev/<id>.png`), Send for review → link (32 random bytes,
  base64url, hash stored) emailed once (brief: Review links).
- Reviewer: `/review/<token>` shows reference, brand, milestone, stills streamed through the app, no amounts,
  `Referrer-Policy: no-referrer`; revision key created per dialog opening; replay returns the stored round
  (brief: Review routes, Revision rounds).
- Round 3 adds `Change order, Look-dev round 3, <ref>` = convert(£180) + 20 % VAT at the locked rate (brief).
- End: `final_review`, draft look-dev invoice with one change-order line (brief).

### 5. Pay a milestone invoice
- Issue → Kill Bill invoice (adopted by share-line description on retry), one email with `<ref>-<number>.pdf` (brief).
- Sign-in codes: 3 per rolling window per email; 4th → 429 + `Retry-After`; landing = safe `next` else `/account` (brief).
- Decline → `payment_failed`, `failed_attempts`+1, `overdue_at` = first failure + OVERDUE_AFTER_SECONDS, one notice
  per decline, pay-by line `Pay by <date>, <time> UTC to avoid an overdue notice.` (brief).
- Approve → PURCHASE, balance 0 → `paid`, ledger `invoice_payment`, receipt queued (brief).
- Overdue decided by the server on read and every 5 s, only once Kill Bill records `OVERDUE` for
  `gloamwork-billing`; one notice + one push (brief; decided: 5 s sweep ≤ 30 s).

### 6. Finals and delivery
- Finals need the look-dev invoice paid (`look_dev_unpaid`) then a final still per line (`stills_missing`);
  accept → `delivered`, final invoice = remainder share + change orders; deposit + look-dev + final = total + change orders (brief).

### 7. Cancel with refund
- Row lock (`FOR NO KEY UPDATE`) serialises cancels: one 200, others `invalid_state` (brief; decided: NO KEY so
  refund ledger rows committed on their own connections never wait on the lock).
- Allocation newest payment first; one REFUND per payment with key `<eid>:refund:<payment id>`; each confirmed part
  committed at once; resume reads existing keys; voids issued/failed/overdue invoices in Kill Bill, drafts locally;
  block cleared; link revoked; one refund email (brief).

### 8. Ride out an outage
- `/api/status` every 10 s (fake-clock safe `setInterval`); banner lines in brief order shown/cleared in place;
  dialogs, typed values and focus untouched; Pay keeps the dialog open with the message above Pay (brief).
- Queue down: upload 201 `measurement: delayed`; delayed jobs republished every 5 s once the queue accepts (brief).
- Documents down: deposit completes, receipt waits in the outbox until Gotenberg renders it (brief).

## Palette (decided values from DESIGN.md, brief roles)

| Role | Hex | Source |
|---|---|---|
| ground | `#0B0D12` | brief: Visual design (near-black, blue cast); decided: hex |
| ground-raised | `#12151C` | decided: overlays one step up |
| ink | `#F3EEE6` | brief: warm off-white; decided: hex |
| muted | `#B9B2A7` | decided: 9.3:1 on ground |
| dim (Void, Not saved, Superseded) | `#A8A196` | brief: dimmed off-white; decided: hex (7.6:1) |
| ember (rings, primary, focused frustum, markers) | `#FF6A1F` | brief: hot orange; decided: hex |
| ember-text (Overdue, Payment failed) | `#FF742E` | decided: 7.21:1 for body-size status words |
| cobalt / violet (3D light only) | `#2F5BFF` / `#9B3BFF` | brief: Cobalt and violet; decided: hex |
| plinth | `#1A1C22` | brief: matte dark cylinder; decided: hex |

## Type, space, layout

- Bricolage Grotesque (display, numerals, tabular figures) and Manrope (body), self-hosted woff2 (brief: Type).
- Body 16 px / 1.6; display-1 `min(9.5rem, 25cqi)` in its 4-column container; steps ×≈0.66 (brief: Type; decided: container sizing so headlines fit the left four columns).
- 12-column grid, gutter 24 px, margins `clamp(20px, 5vw, 72px)` (brief: Screens and layout; decided: values).
- Desktop ≥ 1200: headline left 4 columns, subject right 8; rig shot list/quote/pay/uploads left 4, canvas right 8,
  scale/positions/intake under the canvas. Tablet 768–1199: headline above full-width panel; rig canvas on top.
  Phone < 768: one column, Menu drawer, deck, rig canvas ≤ 46vh, fixed quote bar (brief).
- Invoices: 5 columns ≥ 1200, 3 columns 768–1199, cards < 768; studio grid 1/2/3 columns (brief).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Hero assembly | scroll 0–2400 px | scroll-driven | linear in progress | end frame, `1.000` |
| Case study idle turn | time | 30 s per turn | linear | still |
| Clay morph | switch | 600 ms | cubic-bezier(0.16,1,0.3,1) | instant |
| Shared-element morph | tile link / Back | 600 ms | same | `done` throughout |
| Services object turn | time | 30 s per turn | linear | still |
| Services tilt | pointer / focus | 300 ms in, 450 ms out | quadratic ease-out | tilt 0 |
| Process camera | scroll | scroll-driven | — | list of 5 stills, `all` |
| Deck advance / spring | drag, fling, keys | 450 ms | cubic-bezier(0.16,1,0.3,1) | instant |
| Marquee | time | 36 s per cycle | linear (CSS) | static wrapped list |
| Drawer | Menu | 320 ms | ease-out-long | instant |
| Rig flying / focusing / counting | selection | 600 / 320 / 500 ms | ease-out-long | in place, swap, `idle` |
| Orbit reset (R) | key | 600 ms | ease-out-long | instant |
| Hover lift | pointer | 480 ms | ease-out-long | none |

All graded motion reads `performance.now()` in `requestAnimationFrame` (or CSS for the marquee); each `data-*`
value is written every frame and is the source of truth (brief: Motion and effects).

## States per async action

| Action | Pending | Success | Field error | Outage |
|---|---|---|---|---|
| Start project | `Starting` | → `/rig/<id>` | summary + field copy | — |
| Send code | `Sending` | `If that email belongs…` | `Email` + summary (incl. 429 copy) | — |
| Upload | row `Uploading <n>%` | `Received` / `<name> received.` | row `Rejected` + copy | row `Not saved`, storage banner |
| Quote change | region `aria-busy` | `Quote updated: total …, deposit ….` | refusal copy, rig restored | content copy |
| Pay deposit / invoice | `Processing payment` | `Deposit received` / `Invoice paid` | field copy in dialog | copy above Pay, banner |
| Request revision | `Sending` | `Revision requested` + round line | `Describe what to change.` | — |
| Founder actions | — | published success copy | field copy | message |

## Breakpoints

`< 768` phone, `768–1199` tablet, `≥ 1200` desktop; no other layout breakpoint (brief: Screens and layout).

## Media and licences

- Fonts: Bricolage Grotesque, Manrope (OFL-1.1, Fontsource), listed in `app/assets.json` (decided).
- Posters, icons, empty-state drawing: original inline SVG; 3D scenes procedural Three.js (MIT) (brief: DP-60).
- No photographs, video or fetched images (brief: no pre-rendered stand-ins).
