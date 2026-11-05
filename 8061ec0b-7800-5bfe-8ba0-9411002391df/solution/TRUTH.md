# TRUTH — Keel & Bell Bellroll (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

1. **Reservation** (brief: Journeys 1). Parent F-04 signs in → `/family` (totals line, one region per child) →
   Reserve an instrument → `/reserve?student=S-06`. Picks Cello; the Size group selects the first available size
   (1/2, "1/2, 1 available"); ticks the waiver. Delivery line for Ferncliff: "Reserve before <cutoff date-time> for
   delivery day <date>." computed from the school listing and the server-offset clock; it flips to the next day
   within 2 s after the cutoff on the server clock (decided: check every 250 ms, never before cutoff + 150 ms).
   A rival takes the last 1/2 cello: within 5 s (poll; brief: 6 s) the radio reads "1/2, none available" and is
   disabled, 3/4 is selected, focus follows if it was on 1/2, status "The last 1/2 Cello was just reserved. 3/4
   Cello is selected instead." Reserve → 201: "Reserved 3/4 Cello <serial> for <name>. Hold until <dt>. Delivery
   day <date>." Provider state: `contracts` row `reserved`, history `null → reserved · parent`.
2. **Signing** (brief: Journeys 2). Owner → sheet → Send signing link → status "Signing link queued for <parent
   email>. It works until <dt>." Mailpit holds "Sign your rental agreement — <student>, <label>". Parent opens
   `/sign/<token>` signed out; Tab: Agreement text → Full legal name → checkbox → Sign agreement; success copy
   replaces the form, focus to status. MinIO `contracts/<id>/agreement-signed.pdf`. Owner presses Activate contract
   (disabled while pending; double press safe): Kill Bill account `<id>` (USD, external payment method) and one
   subscription `<id>-rental` on `bellroll-rental-monthly` ($0 plan uploaded with `catalog/simplePlan` when
   missing). Sheet shows Active, "Due <date>", history with actors.
3. **Payment and reversal** (brief: Journeys 3). Record payment dialog (dollars) → Kill Bill PURCHASE
   `<id>-pay-<key>` → ledger `payment` of the base part → receipt email with `<origin>/contracts/<id>?month=<contract month after the payment>`;
   the sheet refetches and the rail's handle returns to the new current month. Retries
   reuse the dialog's key. Reverse <payment id> → dialog with reason → Kill Bill REFUND `<id>-reversal-<pid>` →
   `reversal` entry of minus the base part; row shows "(reversed)"; rail refetches.
4. **Exchange** (brief: Journeys 4). Tech records an exchange check; a refused photo is named, "Not saved", focus
   on its Remove. Owner Exchange size → 1/2 → lands on the successor sheet with "Exchanged to <label> <serial>.
   $<equity> equity moved from <old id>." Old: exchanged, subscription CANCELLED (read back); new: active,
   anchor kept, agreement copied.
5. **Buyout** (brief: Journeys 5). The model turns by finger drag or Left/Right; rail by drag, touch or keys; fill rises, numerals roll, tier label swaps;
   release announces "Month N payoff $X. Quote valid until <date>." and sets `?month=N`. Buy out for $<total> →
   confirm → bill of sale stored first, Kill Bill PURCHASE `<id>-buyout`, cancellation read back, commit; "Owned"
   stamp, Bill of sale (PDF) link, ownership letter email.
6. **Price lists** (brief: Journeys 6). Publish, field errors on their fields with focus on the first, withdraw a
   scheduled version after confirming; standings recomputed.
7. **Delivery day** (brief: Journeys 7). Director on a phone: Menu button, roster summary, narrow columns, CSV.
   Owner Schools: picker refreshes in place at the first cutoff; only a passed selection is cleared with the
   cutoff-passed copy; notice email lists "<student> — <label> — <serial>" only.
8. **Condition and return** (brief: Journeys 8). Check-out with three photos → re-encoded JPEGs at
   `contracts/<id>/condition/<event>/<photo>.jpg`; Mark returned → Kill Bill cancellation confirmed first.

## Decisions where the brief is silent

- Concurrency: Postgres session advisory lock per contract (activation, payments, reversals, buyouts, exchanges,
  returns, write-offs) and a fleet lock for unit choice. decided: brief "One action at a time per contract", "One
  winner"; works across instances sharing a database.
- Hold expiry is materialised by one UPDATE…RETURNING before every API request and by a 1 s sweep; the history
  entry's `at` is `hold_expires_at`. decided: brief Holds ("no request needed").
- Emails go through an outbox table in the action's transaction; a dispatcher (1 s, `SKIP LOCKED`) sends via SMTP
  and retries. decided: brief Mailpit "queued in the same step … retried until delivered".
- Equity ledger entries for payments also carry `payment_amount_cents` (null elsewhere). decided: the brief's
  reversal dialog copy ("Refund $<amount> …") needs the payment amount and no published body carries it.
- Price list IDs `PL-<effective year>-<nn>` from a sequence; payment/reversal/ledger/event/transfer IDs
  `P-`/`R-`/`L-`/`E-`/`T-` + 12 hex; photo IDs 144-bit base64url. decided: "server-chosen strings".
- Field messages for codes the brief does not name use `invalid` / `required`. decided.
- Equity ledger rows: "Reversal lines in the ledger sit directly under the hairline of the row they reverse, in ink
  with a brick-red minus amount." (brief: Visual design, Composition). Each reversal row is placed immediately below
  its payment row with no top rule; every other row keeps the API's oldest-first order, and each row's "Equity after"
  is the equity once that entry was posted. decided: the brief fixes the reversal's position but not the order of
  the remaining rows, so they follow the API's oldest-first order.
- The browser's server-clock estimate is the latest `server_now` plus `performance.now()` elapsed since that answer
  arrived; Reserve, signing and Schools re-ask every 60 s (brief: Server time in the browser).
- Stored timestamps are truncated to the second; `server_now` keeps milliseconds. brief: Conventions.
- Kill Bill tenant: at boot (and lazily before the first Kill Bill call if it was unreachable) the app reads
  `GET /1.0/kb/tenants?apiKey=<KILLBILL_API_KEY>` with `KILLBILL_USERNAME`/`KILLBILL_PASSWORD`; on anything but 200
  it creates the tenant once with that key and secret, then reads it back. brief: Deployment ("If Kill Bill has no
  tenant for the given key at boot, the app creates it once"); decided: any non-200 counts as missing because Kill
  Bill answers an unknown key with a 500 from its tenant cache.
- Request signing for S3 uses the machine clock (`protocolTime`), never the controlled clock. decided: MinIO
  rejects signatures outside its own clock skew.

## Palette (brief: Visual design; hex decided)

| Role | Hex |
|---|---|
| paper | #F5EEDF |
| paper-deep / paper-deeper (tier bands, wells) | #ECE3CF / #E6DBC3 |
| ink | #1A2233 (13.77:1 on paper) |
| ink-muted | #4D5466 (6.55:1) |
| rule (never text) | #C9B99A |
| brass fill (hatch) | #C69A35 |
| brass text | #7A5712 (5.68:1 paper, 4.78:1 paper-deeper) |
| brick | #9E3324 (6.16:1) |

## Type (brief: Type)

Fraunces 600 headings h1 31.25 / h2 25 / h3 20 px (×1.25 steps above 16 px body); IBM Plex Sans 16/1.6 body;
IBM Plex Sans Condensed 500 in `all-small-caps` for labels, column heads and tier bands; IBM Plex Mono with
tabular figures for serials, money, months and dates. All fonts self-hosted woff2 (latin).

## Space and layout per viewport (brief: Width bands)

8 px grid; controls ≥ 44 × 44; register rows ≥ 52 px pitch. Narrow 0–639: single column, register No./Serial/
Instrument/Status as two-line entries, roster Student/Instrument/Serial/Status, drawing at 33vh above the terms,
ledger/invoice/roster/price lists as stacked label-value rows, Menu button holding the links and Sign out. Medium 640–1023: register without
Model, roster without Grade, sheet 5fr/7fr. Wide ≥ 1024: all columns, sheet 1fr/1fr. Hidden columns are not
rendered (band from `matchMedia`).

## Motion (brief: Motion and effects)

Every animation is a Motion tween on Motion's frame loop (`app/src/client/motion.ts`); the model is drawn by three.js
only when its angle or fill changes. Easing `cubic-bezier(0, 0, 0.58, 1)` (decided: "start quickly and slow gently
into place", and it settles late enough that each item comes to rest inside its published window).

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| button / row background darken, button press inward 1 px | hover / press | 180 ms | ease | instant |
| status message (opacity, 3 px rise) | new text | 180 ms | ease | instant |
| menu panel (opacity, 6 px drop) | open / close | 180 ms | ease | instant, inert at once |
| dialog | open: from 12 px below and transparent; close: fade out, inert at once | 420 ms / 180 ms | ease | instant |
| register row into contract header (translate + scale from the chosen entry's box) | serial link clicked or Enter on it in the register | 420 ms | ease | none: header at rest |
| contract header on a direct load or reload | — | none: at rest at once (brief: Choreography 3) | — | — |
| brass band in the model and the gauge | rail month / equity change after a refetch | 700 ms | ease | instant |
| figures "Equity" and "Payoff" (each digit's strip rolls up or down) | rail month change | 420 ms, starting 120 ms after the brass | ease | plain text, swapped at once |
| tier label (fade in) and boundary rule (ink back to rule) | tier boundary crossed | 180 ms, after 560 ms | ease | none |
| rail handle spring: 5 px past the notch at 55 % of the time, back onto it at 700 ms | key step, tap, drag release | 700 ms | ease out, then ease in-out | native range, lands at once |
| model turn | key turn or drag end | 420 ms | ease | jumps to the angle |

No idle or looping animation (brief: No other motion exists). Reduced motion: native `<input type="range">` plus
`table "Buyout schedule"`.

## Instrument model (brief: Visual design, Instrument model; Interactions, Instrument model)

three.js, built in the page from simple shapes (extruded violin-family outline, lathes, cylinders, boxes, tori), one
per instrument; orthographic camera, canvas cleared to paper; flat tints #BEBBB4 and #87898E (a quarter and about a
half of ink on paper, decided) with ink #1A2233 edge lines; `preserveDrawingBuffer` on. The brass band is the same
meshes in flat brass #C69A35 clipped below a world-space plane at base + equity fraction × height, the ink tints
clipped above it; at 0 % the brass is hidden. String models scale 1/4 0.7, 1/2 0.8, 3/4 0.9, 4/4 1 of a 1.08-unit
view (decided: the smallest still stands at least 60 % of the canvas). Turn: Left/Right ±15°, drag 0.9° per pixel
(90° per 100 px, decided inside the brief's 15-180), drag end eases to the nearest 15°. Without WebGL: the flat SVG
drawing with the brass hatch as the gauge. The canvas is 0.7 × the stage height wide and centred, with the gauge 28 px beside it
(decided: the gauge reads as part of the drawing group, not a scrollbar); the gauge track carries rule ticks at 25/50/75 %.

## States per async action

As brief: Feedback states, verbatim copy; button disabled while pending; pending copy in the named status;
network or 500 → "Couldn't reach Bellroll. Nothing was changed; check your connection and try again."

## Breakpoints

639 / 640 and 1023 / 1024 px only (brief: Width bands).

## Media and licences

Five procedural three.js instrument models and five flat SVG fallback drawings (original, in code); three (MIT) and
motion (MIT) bundled; Lucide icons via lucide-react (ISC); fonts Fraunces,
IBM Plex Sans, IBM Plex Sans Condensed, IBM Plex Mono (SIL OFL 1.1, Fontsource 5.3.0), listed in `app/assets.json`
and `app/THIRD_PARTY_NOTICES.md`.
