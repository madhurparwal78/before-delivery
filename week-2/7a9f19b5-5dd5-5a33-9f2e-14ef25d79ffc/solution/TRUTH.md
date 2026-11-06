# TRUTH — Southerly Light Works Lightfall (golden)

The brief made concrete. `brief: <section>` = copied verbatim from `instruction.md`; `decided: <why>` = the brief
is silent and the value follows its intent. Visual tokens are detailed in `DESIGN.md`; this file is the ground truth
the golden implements.

## Journeys (ideal end-to-end flow)

### 1. Retail browse and buy (DP-06, DP-13) — brief: Journeys 1
- Start: signed-in retail customer on `/catalogue`; status `Results count` reads `5 fittings`.
- Types `downlight` in `searchbox "Search fittings"`; 250 ms after the last keystroke the URL becomes `?q=downlight`
  without a reload and `2 fittings` show (Kauri Downlight, Rimu Gimbal Downlight). brief: Interactions.
- Clears the search (`5 fittings`), ticks `Matte Black` in `group "Finish"`: `3 fittings` (Kauri Downlight,
  Tōtara Track Spot, Harbour Surface Cylinder), URL `?finish=BK`.
- Presses `Compare <name>` on the three cards: tray holds KDL-WH-36-3000, TTS-BK-24-3000, HSC-WH-24-3000 (each card's
  shown variant is its default); tray status `Added to comparison.`; toggle reads `Compare (3)`.
- Opens the tray, follows `Open comparison` to `/compare`: `table "Comparison"`, one column per fitting, rows Code,
  Finish, Beam, Colour temperature, Lumens, Candela, Watts, CRI, IP rating, Price, Pool diameter at 2.7 m, Centre lux
  at 2.7 m (e.g. 36° → `1755 mm`; TTS-BK-24-3000 → `1199 lux`).
- Back on the catalogue presses `Save Kauri Downlight` (pressed); `PUT /api/favourites/KDL-WH-36-3000`.
- Opens the product page, picks `24°`: URL `?variant=KDL-WH-24-3000`, readout `$95.00 + GST`, `900 lm`, `1148 mm`,
  `898 lux`; status `Product updates` reads `Kauri Downlight, Matte White, 24° beam, 3000K: 900 lumens, $95.00 + GST.`
- Quantity 2, `Add to cart`: `Added 2 to cart. Cart total $190.00 + GST.`
- `/checkout`: enters delivery and card `4000 0000 0000 0002` → alert `Card declined` / `Your bank declined this card.
  No money has been taken. Try another card or contact your bank.`; order status `declined`, no Kill Bill payment,
  stock (if clearance) gets a `sale` then a `release` movement.
- Changes the card to `4242 4242 4242 4242` (a new Idempotency-Key) and presses `Pay $218.50`: Kill Bill account
  `lf-user-<id>` (NZD, default `__EXTERNAL_PAYMENT__` method, AUTO_PAY_OFF tag), payment key `<orderKey>`, one
  `AUTHORIZE` of 218.50 with transaction key `<orderKey>-auth`; order `authorised`; navigates to
  `/orders/<orderKey>` with h1 `Order confirmed` and `Order <orderKey> is confirmed. A receipt is on its way to
  <email>.`
- Mailpit: one message from `MAIL_FROM`, subject `Your Lightfall order <orderKey>`, lines `KDL-WH-24-3000 x 2  $190.00`,
  `Subtotal (excl. GST)  $190.00`, `GST (15%)  $28.50`, `Total (incl. GST)  $218.50`.

### 2. Clearance last units (DP-14, DP-15) — brief: Journeys 2
- Start: HSC-CH-24-3000 has 1 unit; its card under `?family=clearance` shows `$79.00 + GST`, struck `$131.00` and
  `Only 1 left`.
- Two buyers pay at once. Each authorise locks the order row, then the variant row (`FOR UPDATE`), sums the movements
  and inserts a `sale` movement in the same transaction before calling Kill Bill. The first commit wins; the second
  sees 0 and answers `409 {"error":"insufficient_stock","available":0}` with no Kill Bill call.
- Loser's checkout: alert `Sold out while you were checking out` / `Someone else bought the last units of Harbour
  Surface Cylinder. Your card has not been charged.`
- End: card, product page (`?variant=HSC-CH-24-3000`) and admin `Clearance stock` all read `Sold out` / `0`; the
  movements sum to 0.

### 3. Trade approval (DP-18–DP-21) — brief: Journeys 3
- Signup as `Trade` with business name, NZBN `94` + 11 digits, occupation `Wholesaler` → `/account`, status
  `Trade application` reads `Your trade application is with our team. You'll see trade prices once it's approved.`;
  product pages show retail prices only; no trade_price_cents in any API response.
- Admin → Applications → `Approve <business>` → `Approved <business>.`; Mailpit `Your Lightfall trade account is
  approved` to the applicant.
- After signing in again: product page price reads `Trade $64.00 + GST` over `RRP $89.00 + GST`; header shows
  `Projects`.
- Decline path: `Decline <business>` → dialog `Decline application` → reason → `Declined <business>.`; email `About your
  Lightfall trade application` containing the reason; banner `Your trade application was declined. You can still shop
  at retail prices.`

### 4. Specify a project in the light-pool room (DP-27–DP-35) — brief: Journeys 4
- `/projects` → `New project` → name, client, `Ceiling height (mm)` 2700 → `Project created.`
- Product page: Matte Black, 24°, 2700K (`variant=KDL-BK-24-2700`), `Add to project` → dialog, project, quantity 6,
  `Add` → status `Project updates` reads `Added 6 × KDL-BK-24-2700 to <project name>.`
- Project page: `slider "Ceiling height"` → 3000 (`aria-valuetext` `3.0 m`), saved with PATCH on each step.
- `Place KDL-BK-24-2700` puts the fitting at 3000 mm, 2300 mm (room centre rounded to 100 mm, halves up); focus moves to
  `KDL-BK-24-2700 #1 at 3000 mm, 2300 mm`; data-phase runs cone → pool → tint → count → settled in 1300 ms;
  `Room updates` reads `KDL-BK-24-2700 placed at 3000 mm, 2300 mm. Pool 1275 mm, 696 lux.` (h = 3000 mm).
- Arrow keys move 100 mm, Shift+arrow 500 mm, clamped to the room; Delete removes and focus returns to the matching
  `Place` button; Escape focuses the slider; Tab leaves the room after the last fitting button.
- `Light pools` table mirrors every placement (Code, X (mm), Y (mm), Beam, Pool diameter (mm), Centre lux).
- Reopening the project restores every placement (Postgres).

### 5. Collaborate live (DP-36–DP-39) — brief: Journeys 5
- Owner invites an approved trade buyer by email → `<name> can now work on this project.`; anyone else → `That email
  is not an approved trade account.`
- Both open the project: each page's `GET /api/projects/<id>/live` stream writes an `lf_presence` record (refreshed
  every 10 s) and relays PocketBase changes; avatars appear under `Viewing now` within 3 s and leave within 30 s.
- A move by one collaborator saves to Postgres, then an `lf_placements` record; the server's PocketBase subscription
  relays it as a `placement` event and the other room and table follow within 3 s.
- Comments are `lf_comments` records; a new one is relayed as a `comment` event. `Comment posted.` for the poster.
- PocketBase down: placements save with `"live":false`, comment endpoints answer `503 collaboration_unavailable`,
  pages read `Live collaboration paused. Your changes are saved and will sync when it reconnects.`; the server retries
  every 5 s and pages read `Live collaboration is back.` once it reconnects.

### 6. Share a quote (DP-40–DP-43) — brief: Journeys 6
- `Share quote` → recipients (comma-separated, 1–10), `No prices` → `Quote queued for 2 recipients. Emails go out as
  soon as the PDF is ready.`; then a wholesaler at `Trade prices`.
- Each instance's worker (every 10 s, plus immediately on create) locks open shares with `FOR UPDATE SKIP LOCKED`,
  writes `quotes/<projectId>/<shareId>.pdf`, confirms it with HEAD, marks the share `ready`, then emails each recipient
  (subject `<sender name> shared a Lightfall quote: <project name>`, attachment `lightfall-quote-<shareId>.pdf`).
- `No prices` email and PDF carry codes, names, finishes, beams, colour temperatures and quantities only: no `$`, no
  amount, no `GST`. `Trade prices` copies show `$241.50`, `$36.23`, `$277.73` for one PHP-BZ-60-2700.
- MinIO down: share reads `Waiting for file storage`, no email, retried every 10 s from stored state.

### 7. Monthly account order (DP-48–DP-51) — brief: Journeys 7
- Approved trade checkout: `radio "Monthly account"`, delivery, `Purchase order (optional)` → `Place order on
  account` → `/orders/<orderKey>` h1 `Order placed`, `Order <orderKey> is on your monthly account. A confirmation is on
  its way to <email>.`; email with the PO and totals; no Kill Bill call.
- Admin `Dispatch <orderKey>` → one Kill Bill invoice of external charges in one request (`<code> x <qty>` per line at
  the line total, plus `GST 15%`), invoice date = server NZ date, due date = 20th of next month → `Invoice <number>
  raised for <orderKey>.`
- From the 21st the order reads `Overdue`; `Record payment` with the exact total pays the invoice as an external
  payment keyed `<orderKey>-payment` → `Payment recorded. Order <orderKey> is Paid.`

### 8. Admin day (DP-44–DP-47, DP-55) — brief: Journeys 8
- Health tab: `Service health` rows Postgres, Kill Bill, Mailpit, MinIO, PocketBase read `Up`/`Down` (each probe ≤ 2 s,
  refresh every 10 s).
- `Dispatch` on an authorised card order: status cell `Capturing`, Kill Bill `CAPTURE` keyed `<orderKey>-capture` →
  `Payment captured. Order <orderKey> is Paid.`
- `Refund` 50.00 → `Refunded $50.00 on <orderKey>.` and `Partly refunded`; the rest → `Refunded`; a larger amount →
  `More than the $<refundable> still refundable.` Refund transactions keyed `<orderKey>-refund-<n>`.

## Business rules as built

| Rule | Value | Source |
|---|---|---|
| GST | `floor((subtotal × 15 + 50) / 100)` once per order, `src/shared/money.ts` | brief: Business rules → GST |
| Pool diameter | `round_half_up(2 × h × tan(beam/2))` | brief: Light-pool geometry |
| own_lux / centre_lux | `candela / h_m²`; sum of `candela × cos³θ / h_m²` over spots with `d ≤ pool radius`, rounded once | brief |
| Order key | `LF-` + 8 of `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` | brief |
| Idempotency | scope = caller + method + path; stores 200/201/402; running → `request_in_progress`; other body → `idempotency_conflict` | brief |
| Due date | 20th of the month after the invoice date; overdue when server date > due date | brief |
| Server date | `LIGHTFALL_TODAY` or today in Pacific/Auckland | brief |
| Dial bands | Morning 05–10, Day 11–16, Evening 17–20, Night 21–04; re-checked every 60 s | brief |
| Error body for 422 | `{"error":"validation_failed","errors":{…}}` | decided: the brief names the `errors` map, not the top-level code |
| Admin carts | priced `retail` | brief: a cart is trade only for an approved trade buyer |
| Comments | stored only in PocketBase `lf_comments` | brief: Services → PocketBase |
| Entity ids | UUIDs (users, projects, placements, shares, applications, refunds) | decided: several app instances share one PocketBase and one Kill Bill tenant; UUIDs keep their records apart |
| Kill Bill account tag | `AUTO_PAY_OFF` | decided: otherwise the external plugin pays invoices at once and "Record payment" would have nothing to pay |

## Palette roles (hex used by the build)

| Role | Night | Evening | Morning | Day | Gallery | Source |
|---|---|---|---|---|---|---|
| ground | #0A0E16 | #1D1915 | #ECEEF0 | #F4EEE3 | #EFEDE9 | brief: Lighting states |
| surface | #111722 | #26211C | #F5F6F7 | #FBF7EF | #F8F7F4 | decided |
| ink | #F2ECE0 | #F2ECE0 | #11151C | #13161C | #111111 | brief |
| muted | #949CAA | #A4AAB4 | #545B66 | #575D67 | #555555 | brief: cool mid-grey |
| rule | #2E3644 | #3A3F48 | #C3C8CB | #C9CCD1 | #C8C5BF | brief: hairlines |
| accent | #F5A83E | #F5A83E | #9C5A00 | #9A5700 | #995700 | brief: 2700K amber, only saturated colour |
| focus | #FFB54D | #FFB54D | #A85F00 | #A85F00 | #A85F00 | brief: Focus |
| cool tint / 4000K | #DCE9FF | | | | | brief: Cool tint |
| 2700K / 3000K light | #FFB45E / #FFE2B8 | | | | | brief: tint |

## Type

| Use | Face | Size (1280 / 375) | Source |
|---|---|---|---|
| h1 / h2 / h3 / h4 | Instrument Serif 400 | 50.5 / 37.9 / 28.4 / 21.3 px; 40 / 29.6 / 23.2 / 19.2 px | brief: each level one third larger |
| body | Inter Tight 400/500/600 | 16 px / 1.55 | brief |
| numerals, codes, prices | JetBrains Mono 400/500, tabular | 15–18 px readout, 13–15 px tables | brief |
| home overlay title | Instrument Serif | 28 px | brief: overlay type small |

## Space and layout per viewport

| Width | Layout | Source |
|---|---|---|
| 1280 | margins 32, gutters 24; catalogue rail 3 cols + cards 3 across in 9; product canvas 7 / spec 5; checkout form 7 / summary 5; project room 8 / side 4; sign-in forms 5 cols | brief: Screens and layout |
| 768 | margins 24; cards 2 across; Filters sheet; product canvas full width, spec below; summary before form | brief |
| 375 | margins 16; one column; Menu dialog; Filters sheet; quick-add bar fixed bottom; room 60 vh; admin actions stack | brief |
| dial | bottom-left: 16 px above the page bottom, or 12 px above the tray bar (and the quick-add bar on phone product pages) | brief: Lighting dial |

## Motion

| Element | Trigger | Duration | Easing | Reduced motion | Source |
|---|---|---|---|---|---|
| sheets, dialogs, mega-menu | open / close | 320 in / 240 out | cubic-bezier(.2,.8,.2,1) / (.4,0,1,1) | appear / disappear at once | brief: Panels |
| spec drawers | toggle | 340 open (overshoot 4 %) / 240 close | spring keyframes / ease-in | at once | brief |
| numerals | value change | 400 | easeOutCubic (rAF) | final value at once | brief |
| button press | :active | 80 | linear opacity .82 | none | brief |
| viewer idle turn | idle | 36 s per turn | linear | stops, `data-idle="off"` | brief |
| viewer re-light | variant change | 330 | easeOutCubic | at once | brief |
| room cone | place | 0–330 | easeOutCubic | full size, `settled` | brief: Signature |
| room pool | place | 330–730 | spring (≈4 % overshoot) | full size | brief |
| room tint | place | 570–900 | linear | full | brief |
| room count | place | 900–1300 | easeOutCubic | final values | brief |
| pool resize | ceiling change | 400 | easeOutCubic | at once | brief |
| pool remove | delete | 250 | linear shrink | at once | brief |

## States per async action

Every copy string is the brief's Feedback states table verbatim; placements and live regions as named there.
Decided additions where the brief is silent: postcode format error `Enter a 4-digit postcode.`; empty project name
`This field is required.`; signed-out Add to cart goes to `/signin?next=…`; newsletter confirmation sentences
`The Lightfall newsletter will come to <email>.` / `Subscribe again from the form below and we'll send you a fresh
link.`

## Breakpoints

`max-width: 767px` (phone), `768–1279px` (tablet), `min-width: 1280px` (desktop). brief: published viewports.

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Instrument Serif, Inter Tight, JetBrains Mono woff2 (Latin + Latin Extended) | OFL-1.1 | Fontsource 5.3.0 builds (`assets.json`) |
| favicon.svg | original | drawn for this app |
| fitting models, cones, pools, room, line drawings | original | built in code (IF-08) |
| icons | ISC | lucide-react 1.66.0 |
