# TRUTH — Chauraha Bazaar golden

The brief made concrete. Every value says where it came from: `brief: <section>` (copied verbatim) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (ideal end-to-end flow)

### 1. Sign in and come back (brief: Journeys 1; DP-01, DP-02, DP-07, DP-24)
- Start: signed-out shopper on `/p/<product>`, guest cart in the browser (brief: Interactions / Guest cart).
- Actions: header `link "Sign in"` (`/signin?next=<full current address, query included>`, brief: Screens and layout) → `textbox "Email or phone"` + `textbox "Password"` + `button "Continue"` → `POST /api/auth/signin` answers 202 and sets only `chauraha_pending`; `status "Sign-in status"` reads `Enter the 6-digit code we sent to your phone.`; `/signin/code` shows `timer "Resend countdown"` and `button "Resend code"` reading `resend in <seconds>s` while disabled → `textbox "6-digit code"` + `button "Verify"` → `POST /api/auth/signin/verify` issues `chauraha_session` and `chauraha_access` (different values from the pending one) (brief: Business rules / Sessions).
- Visible end: browser at the same product address, signed in (header shows `button "Account"`), guest lines sent to `POST /api/cart/merge`, outcomes announced in `region "Cart merge"` on the cart page.
- Provider-recorded: WireMock journal holds one `POST /sms/v1/messages` with `template: signin_code`, a 6-digit `code`, `sender: CHRAHA`; Postgres holds the session row; no Kill Bill, MinIO or Meilisearch effect.

### 2. Find it (brief: Journeys 2; DP-08..14)
- Start: `/`. Search box takes a misspelt query (`dhwnai`), `button "Search"` → `/search?q=dhwnai`; ticks `Kitchen`/`Electronics`, sets price, rating, pincode 560034 in `dialog "Delivery pincode"` (`Check pincode`), `checkbox "Only items that deliver to 560034"`, `button "Load more"`.
- Visible end: address `/search?q=&category=&brand=&seller=&price_min=&price_max=&rating=&pin=&deliverable=&sort=` (empty parameters omitted) reproduces the list exactly after reload, back, forward and copy; every card shows `arrives by <date>` or that it does not deliver; `status "Search results"` reads `<n> results`.
- Provider-recorded: Meilisearch index `listings` (or `SEARCH_INDEX`) answers; when it is unreachable the black banner `Search is running in basic mode. Typo matching and filters are off for now.` shows and a Postgres title match answers.

### 3. Compare before buying (brief: Journeys 3; DP-18..21)
- Start: search results. Tick up to four `checkbox "Compare <title>"` of one category → `link "Compare (<n>)"` → `/compare?ids=<id>,<id>&diff=0|1` → `switch "Highlight differences"` writes `diff=1` → `link "See all <n> offers"` → `/p/<id>/offers?pin=<pincode>` → `button "Choose <seller>"` adds the listing to the cart → `table "EMI plans"` compares 3, 6, 9 and 12 months.
- Visible end: offer in the cart; offers ranked by landed price, then promise date, then seller rating (brief: Business rules / Offers).

### 4. Fill the cart (brief: Journeys 4; DP-22..27, DP-57)
- Start: empty cart (full pink panel `your cart is empty. the bazaar isn't.`). Add from three sellers, `FLAT150` coupon, gift wrap on one line, `One day` delivery for one parcel, save a line for later.
- Visible end: one coloured panel per parcel with `arrives by <date>` and fee; `group "Payable total"` rolled digit by digit to the server's `payable_paise`; `status "Cart updates"` says `Total <amount>, <n> parcels.`.

### 5. Pay once (brief: Journeys 5; DP-28..37)
- Start: full cart. `/checkout/address` → `/checkout/payment` (UPI, Card, Net banking, EMI, Cash on delivery, optional `Use Chauraha balance`) → `/checkout/review` generates one `Idempotency-Key` → `button "Pay <amount>"` pressed twice.
- Visible end: `/orders/<order id>/placed` with h1 `order placed.` and `<n> parcels on the way.`; UPI/net banking shows `waiting for your payment.` and `timer "UPI request expires in"` until confirmed.
- Provider-recorded: Kill Bill holds one PURCHASE per leg, payment external key `<order id>-<leg>`; one order, one charge; stock decremented by one conditional update per line; WireMock got `POST /upi/v1/collect` or `/netbanking/v1/payments` only for those methods; MinIO gets `invoices/<order>/<shipment>.pdf` and `labels/<order>/<shipment>.pdf`.

### 6. Return a line (brief: Journeys 6; DP-38..41)
- Start: `/orders`. Open the delivered shipment, `link "Download invoice"` (stored PDF), `button "Return <title>"` → `dialog "Return item"` (quantity 1, reason) → `Request return`; seller `Approve pickup`.
- Visible end: `status "Order updates"` `Return requested. Refund on pickup: <amount>.`, then on the shipment `Refunded <amount> to <method label>.`.
- Provider-recorded: Kill Bill REFUND on the order's non-balance leg first, then the balance leg; refunds to the balance leg and of cash collected on delivery credit Chauraha balance after Kill Bill records them.

### 7. Share with family (brief: Journeys 7; DP-42, DP-43)
- Start: `/wishlist`. `button "Share wishlist"` → `dialog "Share wishlist"` → `textbox "Name to show"` → `Create link`; later `Make a new link`.
- Visible end: the old `/s/<token>` shows the black panel `This link has expired or been replaced.`; the new one shows h1 `<name>'s wishlist` with product, price and the chosen name only.

### 8. Run the shop (brief: Journeys 8; DP-44..52)
- Start: `/seller/listings`. Create a listing with photos, fix stock from `table "Low stock"`, `Mark packed`, `Print label` once stored, `Mark shipped`, `Mark delivered`, answer a return.
- Visible end: `/seller/statement` rolls gross to net with commission, GST on commission, tax collected at source and tax deducted at source visible; `group "Net payout"` equals the server's `totals.net_paise`.
- Provider-recorded: MinIO objects `listings/<listing id>/<photo id>.<ext>`, `labels/...`; Meilisearch document for the listing within 5 s; Kill Bill cash PURCHASE `<order id>-cod-<shipment id>` on delivery for cash on delivery.

## Palette (roles and hex used by the build)

| Role | Hex | Source |
|---|---|---|
| ground | `#1f2fff` | brief: Visual design / Colour (saturated cobalt-ultramarine); hex decided so hue 236, saturation 100%, lightness 56% pass the judged ranges |
| raised | `#1722c9` | brief: "raised surfaces are a slightly deeper ultramarine" |
| ink | `#ffffff` | brief: "Ink is white" |
| muted | `#d0d5ff` | brief: "secondary text is a pale periwinkle" |
| muted on light panels | `#14142a` | decided: periwinkle fails AA on yellow and pink |
| accent | `#00e58a` (text `#06070d`) | brief: "bright emerald green, used only to fill primary buttons, with near-black text" |
| black | `#07070f` | brief: "black ... panels" |
| yellow | `#ffd60a` (hero button text `#1a2bd8`) | brief: "yellow carries the facets rail and the hero's chunky button" |
| pink | `#ff2d95` | brief: "Black and pink panels carry empty and error states" |
| steel (art only) | `#aeb6c4`, `#eef1f6`, `#6c7589` | decided: a steel tiffin needs metal tones |
| focus ring | `#ffffff` (on yellow/pink `#07070f`), 3 px, offset 3 px | decided: AA 3:1 on every panel; brief: visible focus ring on every focusable control |

## Type

Headlines, prices, totals and bill lines: Darker Grotesque 900, lowercase (brief: Visual design / Type); body, labels, fields: Lexend (brief). Rupee sign comes from Lexend 900 because Darker Grotesque has no glyph (decided). Body 1.125rem/1.6 (brief: comfortable at arm's length; decided). Heading steps ratio 4/3 (brief: "about a third larger"): h4 2rem, h3 clamp(1.5rem, 3.4vw, 2.667rem), h2 clamp(2rem, 4.5vw, 3.55rem), h1 clamp(2.75rem, 6vw, 4.75rem); hero h1 about 12.5vw (brief: "an eighth of the screen width per letter height").

## Space, shape, layout per viewport

- Radius: 28 px on inset cards, dialogs and sheets; 999 px on inputs, buttons and chips (brief: "one generous corner rounding (about 28 px)", "fully rounded inputs"). No borders, no shadows (brief: "no hairline rules", flat).
- Checkboxes and radios: a 44 px disc in the panel's control colour (white on ultramarine and black, `#07070f` on yellow and pink) with a 26 px hole of the panel colour, so unticked reads as a ring; ticked boxes fill solid with a Lucide check in the opposite ink; a chosen radio shows a dot in the ring (decided: the brief keeps emerald for primary buttons only, and a ring with no border stays flat).
- Disabled buttons: `raised` fill with `muted` text on ultramarine (black fill on raised surfaces); black fill with `#6c7589` text on yellow and pink; no opacity (decided: every disabled colour stays a palette token).
- Search panels sit on a 24-column grid with spans of at least 7 columns on desktop, and the card art is a fixed 200 px box so brand, title and price line up across a row (decided: mixed widths without squeezing a price).
- Touch targets at least 44 x 44 px (brief: Accessibility and sizing). Panel padding `clamp(16px, 4vw, 48px)` (decided).
- Phone 375x812 (up to and including 767), tablet 768x1024 (768 through 1199), desktop 1280x800 (from 1200): the Screens and layout table of the brief, row by row; no horizontal scrolling except the deals rail (brief).

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| press feedback | pointer down | 100 ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` | none | brief: Motion and effects |
| state change | any state change | 300 ms | same | instant | brief |
| panel and strip slide | quote change | 600 ms | same | strips stand still | brief |
| Rupee Reel column | new quote or scroll | 300 ms, columns 40 ms apart from the right | same | digits swap instantly | brief: Signature |
| image ripple | pointer over a card image | settles 550 ms after leave | ease-out | no movement; no WebGL: 3% scale | brief: Effects |
| 3D viewer | idle; drag | one turn per 30 s; drag orbits | linear | idle turn stops, drag still orbits | brief |
| particle wordmark | pointer within 120 px | re-form 1.6 s | spring | solid wordmark | brief |
| tiffin | scroll 0-900 px | linear in scroll | linear | closed stack | brief |
| deals rail | vertical scroll | sticky travel | linear | plain list | brief |
| marquee | continuous | 40 s loop, paused on hover/focus | linear | still | brief |
| cursor trail | pointer move | fades in 400 ms | linear | system cursor | brief |
| cart icon morph | add to cart reply | 150 in, 250 hold, 200 out (600 ms total) | same | instant swap | brief: "within 600 ms" |
| wishlist heart | save | 300 ms | same | instant swap | brief |
| falling chips | add to cart | settle within 1.5 s | gravity | already settled | brief |
| order-placed burst | placed heading appears | once | n/a | none | brief |
| noise backdrop | page load | continuous drift | linear | still frame | brief |
| card-to-page | open product | View Transition | default | instant | brief |

## States per async action (brief: Pending states, Feedback states)

Every button that calls the server shows a spinner inside and is disabled until the reply. Cart controls stay usable while a quote is in flight; only the newest quote is painted. A later repaint never overwrites an error or status message the last action showed. Search loading shows static skeleton blocks; empty shows the pink panel `no match. loosen a filter.`; degraded shows the black banner. Checkout failures render in `alert "Checkout problems"` with the server's published message. Uploads and saves render in `status "Save status"`. Unknown routes and 404s render the black panel `nothing here. wrong turn at the chauraha.`.

## Breakpoints

375 (phone, 1 column, facets behind `button "Filters"`, cart strip pinned), 768 (tablet, facets rail about a quarter wide, 2 columns), 1200 (desktop, 3 columns, summary in the right third) (brief: Screens and layout); 320 reflow safety (kit override).

## Media and licences

Fonts Darker Grotesque 900 and Lexend 400/500/700/900 as self-hosted woff2 from `@fontsource/*` 5.3.0, OFL-1.1. Icons: `lucide-react` 1.67.0, ISC, inline SVG. Product art, hero tiffin, empty-state signs, 3D models, wave field, particles and confetti: original, drawn in code (licence `original`). No photographs, no third-party media, no network request to another origin (brief: Rules 8; IF-07).
