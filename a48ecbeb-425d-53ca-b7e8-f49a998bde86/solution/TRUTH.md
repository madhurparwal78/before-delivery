# TRUTH — Ceibo Shop & Cellar (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

1. **Build a crate** (brief: Journeys 1). Start: home `/`, empty crate, province Ontario (brief: Business rules — default province). The shopper scrolls the four scenes (Canopy, River, Orchard, Night sky); the pinned can turns a quarter turn per scene and its label colour follows the scene in view. "Build your crate" → `/box`. Each Add: a can token lifts (120 ms), flies an arc (420 ms) to the lowest empty slot, the slot shows a dashed pending outline (`Slot k: <flavour>, pending`), fills with the flavour colour and one overshoot (160 ms) when `POST /api/cart/items` answers 201, the counter rolls `00`→`12`, the meter fills (380 ms), the card's `<n> left` drops to the server figure, and `Crate updates` announces `Added <flavour>. <count> of 12 cans in your crate. <stock> left. <shipping phrase>`. Province → Quebec (`PATCH /api/cart`), switch on: rows show `Subscribe & save (10%)` as `-$4.00`, `Deposit $1.20`, `Shipping Free`, `GST (5%) $1.80`, `QST (9.975%) $3.59`, `Total $42.55`; `Total updates` says `Total $42.55 with shipping to Quebec.` (brief: worked examples). Provider state: 12 `reserved` ledger events, one active hold.
2. **Pay once** (brief: Journeys 2). Signed-in customer, full crate → drawer → Checkout → Step 1 address → Step 2 review (order summary for that province, subscribe choice) → Step 3 card → `Pay $<total>` → `POST /api/checkout` with one `Idempotency-Key`. Slow (no answer in 20 s): `This is taking longer than usual. Press Pay again; you won't be charged twice.`; Pay again sends the same key and body; the server waits for the first attempt and returns its stored 201. Browser lands on `/orders/CB-1000NN/thanks`. Provider end state: one Kill Bill PURCHASE (or invoice payment for a subscription) with external key `<database>/<order number>`; `orders/<n>/invoice.pdf` and `orders/<n>/packing-slip.pdf` in the bucket; one `Your Ceibo order <n> is confirmed` email.
3. **Race for the limited drop** (brief: Journeys 3). Adds lock the flavour row; the first committed add wins, later adds get `409 sold_out` with `stock_left` 0; the loser's token flies back (300 ms), the card shows the `Sold out` badge (icon + word) and `Couldn't add Cacao Orange: sold out. …`. Holds end at `expires_at` (server clock); a worker releases within 2 s (500 ms tick, claimed per crate); the drawer and checkout keep focus, typed fields and step until `GET /api/cart` reports `expired`, then show `Your hold ended and the cans went back on the shelf.` and `Back to your crate`.
4. **Manage auto-delivery** (brief: Journeys 4). Change requests are recorded `pending_provider`; a worker writes the change into Kill Bill once (blocking states `CEIBO_PAUSED`/`CEIBO_SKIPPED`/`CEIBO_ACTIVE` on service `ceibo`, plan change, end-of-term cancel), reads Kill Bill back and marks the change `applied` only when Kill Bill shows it, then sends one email. The page polls every 2 s and disables every change control while pending.
5. **Recover a failed renewal** (brief: Journeys 5). A poller (one lease holder across processes, every 3 s) finds new renewal invoices (DRAFT, because accounts carry `AUTO_INVOICING_DRAFT`), adds deposit/shipping/tax external charges, commits, and charges the card on file. Decline → dunning day 0 (server clock), steps at days 1, 3, 7 (retries), 8 (`CEIBO_OVERDUE` on `ceibo-dunning`, shipments held), 14 (immediate Kill Bill cancel); one email per step. Card update while past due charges the open invoice in the same request; success pays it, sets `CEIBO_CLEAR`, drops remaining steps and sends the renewal email.
6. **Work the queue** (brief: Journeys 6). `/office/queue` cards below 1024 px, table at ≥1024 px; transitions paid→picking→packed→shipped through the one transition table; the queue refreshes every 5 s; outage banners from `/api/staff/status` every 5 s.
7. **Refund an order** (brief: Journeys 7). Refund rows lock the order, split by largest remainder over remaining parts (lines' discounted goods and deposits, shipping, tax lines), start `pending_provider`, become `applied` when Kill Bill's refund transaction reads back SUCCESS; a full refund of an unshipped order writes `returned` ledger events.
8. **Run the business and grow stockists** (brief: Journeys 8). Owner settings write provinces and the drop; the next quote reads them. Applications store the licence in MinIO (`licences/<id>/licence.<pdf|png|jpg>`, type sniffed from the first bytes) before the row is recorded; one decision email.

## Palette (decided hex, roles from brief: Visual design)

| Role | Hex | Source |
|---|---|---|
| canopy ground | `#0F1D14` | brief: deep canopy green, almost black; decided hex |
| scene grounds | river `#0D1D1A`, orchard `#16200F`, night `#0B1511`; entered tints `#132617`, `#10272A`, `#1D2A12` | decided: scene colour shifts on entry |
| paper | `#F6EEDC` (deep `#EBDFC4`) | brief: warm paper cream |
| ink | `#1E1A14` (muted `#5A5040`) | brief: near-black ink |
| ceibo red | `#A8122C` on paper; `#EC5A6E` on green | brief: ceibo-blossom red |
| leaf green | `#386E2E` on paper; `#8CC47A` on green | brief: soft leaf green |
| focus | ink `#14110D` ring + glow `#FFD666` | brief: two-tone focus ring |
| flavours | guava `#E8678A` + lime `#A9D23F`; yuzu `#F2B705`; passionfruit `#6E2E80`; cacao `#4A2A1E` + orange `#E8762B` | brief: Flavour colours |

## Type

Fraunces (variable, 600) for headings, Atkinson Hyperlegible 400/700 body at 17 px, IBM Plex Mono 500 with tabular numerals for every price, count, timer and meter figure (brief: Type). Scale 1.333: h4 1.333rem, h3 1.777rem, h2 2.369rem, h1 3.157rem; scene headings clamp(2.369rem…4.209rem) (decided: hero step).

## Layout per viewport (brief: Screens and layout)

| Width | Storefront | Box / flavour | Office |
|---|---|---|---|
| < 700 | Menu button + dropping panel; can pinned top right above each message, turn buttons under it | cards in one column; bottom sheet 290 px (≤ 45 vh) with counter, 4×3 slots (48 px), meter; totals in the full-screen drawer | queue cards |
| 700–1199 | can pinned top right at ~⅓ width | cards in one column; 40 % side panel with the whole crate and totals | queue cards below 1024, table from 1024 |
| ≥ 1200 | can pinned in the right half, messages left | carousel with Previous/Next; fixed 400 px paper rail | 12-column grid |

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| card | hover | 100 ms rise 3 px | settle | none |
| button | press | 80 ms dip | settle | none |
| scene ground | ⅓ visible | 1000 ms | settle | instant |
| scene message | ⅓ visible / reverses below | 450 ms rise 24 px | settle | visible at once |
| drawer | open / close | 250 / 200 ms slide | settle / ease-in | appears instantly |
| menu | open | 250 ms drop | settle | instant |
| can turn | buttons / arrows | 333 ms, 45° | ease-out cubic | instant 45° |
| can idle | on screen, no input for 5 s | 360° per 24 s (page clock) | linear | stopped |
| can scroll | scroll | 90° per scene, scroll-linked | — | none |
| token lift / flight | Add | 120 ms ×1.08 / 420 ms arc | settle / (.3,.7,.2,1) | none; pending outline at once |
| slot fill | confirmation (after landing) | 160 ms overshoot | settle | 100 ms opacity fade |
| counter / meter | crate change | 300 / 380 ms | settle | jump |
| token return | refusal | 300 ms | (.4,0,.2,1) | none |

## States per async action (brief: Feedback states, verbatim copy)

Crate (`Crate updates`), totals (`Total updates`), checkout (`Checkout status`), accounts (`Account status`), subscription (`Subscription status` + badge), reviews, stockists, applications, queue, refunds, settings and outage banners use the brief's copy exactly; pending states disable the control (`Paying...`).

## Decisions where the brief is silent

- Kill Bill accounts use time zone UTC so a blocking state requested for a date lands on that date (decided: the brief compares calendar dates); "today" and cutoffs use Kill Bill's clock in America/Toronto (brief: Two clocks).
- Subscription box invoices are drafts completed with deposit, shipping and tax charges, then paid once (decided: brief requires one payment equal to the box total and a zero cycle balance).
- Each catalogue upload carries its own effective date (a random second within 2020) (decided: brief: Services says processes share one tenant and upload only when plans are missing; simultaneous first starts must not leave two versions on one date, which Kill Bill can't load).
- PocketBase receives a SHA-256 digest of the password (decided: PocketBase caps passwords at 72 bytes; the brief allows 128 characters).
- The cart reports `subscribe_eligible` so the browser never re-decides eligibility (decided: one place per rule).
- The `Sold out` badge sits over the card's can art, top right, so a live stock change never moves the card's Add and Fill buttons (decided: brief: Interactions keeps focus and controls where they are through live updates).
- The 3D can's label carries the CEIBO wordmark on its front and back, with `ORGANIC · 355 ML` in the band on the sides (decided: brief: Motion and effects asks the can to show its wordmark, and the idle turn shows every side).
- Nav "Flavours" opens the first flavour page; "Subscribe" opens the box page's totals (decided: no extra pages).

## Media and licences

All imagery is drawn in code (`original`): WebGL can (three.js lathe + canvas label), layered SVG can, seeded leaf/blossom borders (mulberry32), empty-state drawings, favicon. Fonts: Fraunces, Atkinson Hyperlegible, IBM Plex Mono (OFL-1.1, vendored woff2). Icons: Lucide (ISC). Packages: see `app/THIRD_PARTY_NOTICES.md`.
