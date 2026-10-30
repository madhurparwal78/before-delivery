# TRUTH: Tern Foils (deku/efoil-build-checkout-vb)

The golden's ground truth. Every value is marked `brief: <section>` (stated in `instruction.md`) or
`decided: <why>` (chosen where the brief is silent). The brief always wins: where this file and the brief
ever differ, follow the brief. Numbers, codes, copy and timings not repeated here are in the brief section
named.

## State of `solution/app`

Rebuilt in iteration 1 as strict TypeScript (the old JavaScript scaffold and its old catalog are gone):

- `run.json`: `{"_schema":"run-manifest-v1","install":"npm ci --no-audit --no-fund","build":"npm run build","serve":"node dist/server.js"}`
  (brief: Deployment, IF-01). `npm run build` runs `tsc` on both halves in strict mode, then esbuild bundles
  `dist/server.js` and `dist/public/` (decided: a type error fails the build).
- Server: `node:http` with one route table (`src/server/routes.ts`) and one boundary (`src/server/http.ts`: 404,
  405 + `Allow`, 413 at 65,536 bytes, 415, 400, 401, 403 in the brief's order); one error builder
  (`src/server/errors.ts`); one config module (`src/server/config.ts`, only `APP_PUBLIC_PORT` defaults, to 4173);
  rule modules under `src/server/domain/`.
- Shipped packages (`dependencies`, so they are the `npm ls --omit=dev` tree that IF-03 and IF-04 name; esbuild bundles them into `dist/`): `pg` 8.3.3 (decided: later 8.x releases declare the optional peer `pg-native`, which
  `npm ls --omit=dev` reports with no licence and would fail IF-04), its MIT/ISC tree with `semver` overridden to
  7.7.3 (decided: semver 4.3.2 declares the licence "BSD", which IF-04 does not list), and `three` 0.180.0 (MIT).
  SMTP is a small client over `node:net` (decided: nodemailer is MIT-0, not on the IF-04 list).
- Browser: vanilla TypeScript, client-side router over the History API; the server answers the page shell for
  every page address (404 for any other) with server-owned boot data: the country table, the Canadian province
  table, the Canadian postal code pattern, the cart caps, each component's price delta per board package (`optionDeltas`), the lowest-priced package of
  each board (`lineupFrom`), quiz copy,
  callback zones and topics, protection prices and trade-in brands, so no rule table is copied into the browser
  (decided: brief Engineering standards, single source for each rule; the success bodies keep exactly the keys
  of Shapes, so these tables cannot ride on the API answers).
- `USER_README.md`, `THIRD_PARTY_NOTICES.md` (generated from `npm ls --all --json --long`, fonts with the OFL 1.1
  text), `assets.json` (three Fontsource woff2 files, OFL-1.1; the favicon, `original`), and empty
  `.browser_screenshots/` and `.downloads/` (brief: IF-02 to IF-06).

Iteration 2 follows the revised brief (rider weight and speed gear, financing, Canadian tax by postal code,
packed and standalone dangerous goods, ship-by and arrival dates, the itemised Kill Bill invoice, attributed
order events, cursor pages, registration and warranty, header-safe fields, the new viewer contract).

## Journeys: the ideal flow

### 1. Match to a shared build (DP-01 to DP-14)

1. `/` hero: eyebrow "Hand-built by a family workshop since 2018", heading "Lift off quietly", the line "Three
   boards, one snap-fit parts system, and a set-up for every kind of water." and `link "Find my board"` to
   `/match` (brief: Home).
2. `/match` shows `heading "Question N of 5"`, a radio group named by the question text with the brief's exact
   option labels, "Back" and "Next"; "Next" is disabled until an answer is chosen; on the fifth it reads "See my
   match" (brief: Match, Match quiz). The address is `/match?step=<N>&answers=<key1>,...`: choosing an answer
   replaces the entry, "Next" pushes one, so back, forward, reload and a new browser show the same step and
   answers (brief: Interactions, Quiz).
3. "See my match" posts `POST /api/match { answers }`; the highest total wins, a tie goes to Drift, then Crest,
   then Swift; `reasons` are the two questions that gave the winner most points, ordered by points, equal points
   to the lower number first (`powered, mixed, range, any, 70-90` → Crest, `[3, 1]`) (brief: Match quiz). The
   address becomes `/match?result=<id>`; the result shows "Your match: <board>", the three point lines, two
   "Question N: <question text>" lines in `reasons` order, "Build this board" and "Retake" (brief: Match).
4. "Build this board" opens `/build?board=<DR-49|CR-52|SW-43>&rider=<65|80|95>` from the fifth answer; the Board
   viewer opens in the three-quarter view (brief: Interactions, Quiz).
5. The configurator shows the "Board" group (seven "<board> <size>" radios, `SW-52` disabled with "Out of
   Stock"), the five slot groups (incompatible parts disabled with "Not compatible with <board name>" and the
   not-allowed mark; hovering or focusing ghosts them), "Spare batteries", `slider "Rider weight"` (50 to 120
   step 5, "<kg> kg") and `slider "Speed gear"` (1 to 10, "Gear <n>"). Each change calls
   `POST /api/builds/quote`; only the newest answer is applied. Default `DR-49` at 80 kg, gear 5 reads
   "$10,999.00", "As low as $354.86/mo" (the 36-month term) and "Up to 70 min", gauge 1 of 4 (brief: Builds, Financing).
6. Dragging the sliders re-quotes; "Up to N min" counts to each new value over 0.4 s and the gauge and the
   viewer's charge bar settle when the count ends. Swapping the wing plays the part swap. "Side view" sets
   `data-preset` `side`; one Right arrow on the focused viewer from the three-quarter view gives `orbit=60,25,340`
   (brief: Motion and effects, Board viewer contract).
7. "Save build" (201 first, 200 identical) pushes `/build/<code>` keeping the view parameter. Opening that link
   in a second browser restores parts, colours (`data-colours`), mast length (`data-mast-m`), total, monthly
   payment, ride time, battery fill (`data-battery-fill`) and camera pose. An unknown code shows "We could not
   find that build." and "Start a new build" (brief: Configurator, Interactions).

### 2. Cart to one order (DP-16 to DP-31)

1. "Add to cart" posts `{ type: "build", quantity, code }` or `{ type: "accessory", quantity, sku }`;
   `dialog "Item added to your cart"` slides in from the right; `link "Cart, N items"` and its badge follow
   `item_count` (brief: Public screens and controls, Interactions).
2. `/cart`: steppers with "Limit N per order." beneath at a cap (2 per build line, 3 across build lines, 5 per
   accessory line; caps from boot data); the financing line for "Total before shipping and tax" (brief: Cart,
   Financing).
3. `FLYFIRST` and `CHARGE25` ignoring case, at most two, on the accessory subtotal only (brief: Cart).
4. "Check out" sends a visitor to `/login?next=/checkout`; signing up or in merges the guest lines and the guest
   codes (appended while the account cart holds fewer than two), then empties the guest cart (brief: Cart).
5. `/checkout` with Canada and `M5V 2T6` shows, without a reload: Shipping $399.00, "Dangerous goods handling"
   with "1 packed with a board, 0 shipped alone", "HST (13%)", "Tax", "Total", "Delivery" "Ships <ship date>,
   arrives <arrival date>" and the Canadian financing line; before a country every one of these reads "Choose a
   country", and for Canada "Enter your postal code" until the code is valid. `progressbar "Checkout progress"`
   counts the Address, Country and Place order steps (brief: Checkout, Interactions).
6. One `Idempotency-Key` per page load; a double click sends one request; 409 `idempotency_in_progress` retries
   once a second (brief: Interactions).
7. Success opens `/account/orders/TF-NNNNNN` with "Order <number> placed."; the email "Order confirmed:
   <number>" lists each tax component and "Arrives <arrival date>"; the stored order, the Kill Bill invoice
   items (`<number> merchandise`, `shipping`, `dangerous goods`, `tax`, the non-zero ones), the email and the
   checkout screen agree to the cent (brief: Checkout and orders, Kill Bill, Mailpit).
8. Cancelling adjusts every invoice item by its full amount (reason `order_cancelled`, comment the order number),
   so the account balance returns to the customer's non-cancelled totals; then stock and credits return; no
   email (brief: Order lifecycle, Kill Bill).

### 3. The last unit, the paged list and the warranty (DP-41 to DP-47)

Two customers race for the last `CR-58`: one 201, the other 409 `out_of_stock` "CR-58 is out of stock." with
"Sorry, <line name> just sold out. Your cart has been updated." and `/boards` shows "Out of Stock". The admin
pages Orders with "Load more orders" (cursor after the last number, newest number first, so new orders never
repeat or skip an older one), ships and delivers; the customer's timeline names the admin. The customer
registers a Luhn-checked serial; `/account` shows "Board warranty: <N> days left" and "Battery warranty: <N>
days left" in the order country's zone; "Transfer <serial>" moves it with its end dates (brief: Journeys 3,
Order list pages, Board registration and warranty).

### 4. Trade-in under the clock (DP-48 to DP-51)

The customer submits on `/trade-in`; support quote it on `/staff`; "Trade-in quoted: <amount>" is queued.
Accepting at `quote_expires_at` − 1 s succeeds; at the instant it answers 409 `quote_expired`, and from that
instant every list reads `expired`, with "This quote expired on <date>." and no "Accept quote". The accepted
credit comes off the Crest build line with the highest line total; the trade-in then shows "Applied to order
<number>" (brief: Trade-in, Trade-ins).

### 5. Demo day across time zones (DP-52 to DP-57)

`/locations` finds Elbe Foil Station by coordinates; slots 22 and 23 read "Sat 26 Oct 2030, 10:00 to 12:00 local
time" and "Sun 27 Oct 2030, 10:00 to 12:00 local time" in any browser zone. A lost race reads "Fully booked" with
the slot_full alert. A dealer sees `r***@example.com`; once the slot has started "Mark attended <booking id>"
grants the 20000 cent demo credit (brief: Demo locator and events, Locations, demo days and demo credit).

### 6. Callback about a build while mail is down (DP-58 to DP-62)

"Talk to an advisor about this build" opens `/callback?build=<code>` plus the view parameter; `region "Build to
discuss"` shows the viewer at that pose and "<board> <size>, <total>". A Name with a line break is refused
beneath the field; a time outside 9:00 to 16:30 starts in the caller's zone is refused. Success shows "Thanks,
<first name>. Your reference is CB-NNNNN." at once; the notice waits `pending` while only the mail-down instance
runs and is delivered once, to the one recipient, with "We will call you on <day> at <HH:MM> <zone> (<HH:MM>
UTC)." and "Build <code>" (brief: Book a call, Expert callbacks, Header-safe fields, Mailpit).

### 7. Tracking with a guarded lookup (DP-63 to DP-65)

`/track` shows a status timeline (status and instant only) or only "We could not find an order with those
details."; after five misses for one email within 900 seconds every lookup for that email shows "Too many
attempts. Try again later." with `Retry-After`; other emails still work (brief: Tracking, cases and the lookup
limit).

### 8. Account security and staff roles (DP-66 to DP-69)

A password change keeps the calling session and ends the others; a reset request always answers "If an account
exists for that email, a reset link is on its way."; a reset link works once, while now < issued + 1,800 s.
`/staff`: admin sees "Trade-ins", "Demo days", "Orders" and "Outbox"; dealer only "Demo days"; support
"Trade-ins" and "Outbox"; a customer sees "You do not have access to this page." (brief: Staff console).

## Rules decided in one place

| Rule | Where | Source |
|---|---|---|
| compatibility table, price, ride time, battery bars, build code | `domain/builds.ts` with the seed in `catalog.ts` | brief: Engineering standards, Builds |
| exact ride time | `5 × floor(wh × 60000 / (draw_w × (1000 + 4 × max(0, kg − 80))) / 5)` as one integer division | brief: Builds |
| financing terms | `domain/financing.ts`: BigInt fractions, `ceil` to the cent, last payment by the published balance walk | brief: Financing |
| country table, province table, postal code pattern, ship-by calendar, tax components, dangerous goods | `domain/checkout.ts` | brief: Checkout and orders |
| cart caps and code amounts | `domain/cart.ts` | brief: Cart |
| warranty terms and zones | `domain/registrations.ts` | brief: Board registration and warranty |
| state transition tables and time edges | one module per table; offsets in seconds in `clock.ts` | brief: Engineering standards, Business rules |
| half up rounding | integer only: `round_half_up(n / d) = floor((2n + d) / 2d)` | brief: Checkout and orders |
| order placement | one transaction: stock by conditional updates in SKU order, credits, the counter row, then the Kill Bill account and the itemised charge before commit; every item adjusted to zero if the commit then fails | brief: Checkout and orders, Kill Bill |
| order number allocation | `TF-` number from a counter row locked inside the placement transaction | decided: a database sequence leaves gaps on rollback, and the brief forbids gaps |
| Kill Bill writes | `X-Killbill-CreatedBy: tern-foils`, `X-Killbill-Reason` `order_placed` or `order_cancelled`, `X-Killbill-Comment` the order number | brief: Kill Bill |
| Kill Bill cancellation | reads the invoice and adjusts only items without a linked `ITEM_ADJ`, one adjustment per item | decided: the provider's own record shows what a retried cancellation already adjusted (brief: Kill Bill, Cancellation) |
| order list cursor | base64url of the last number and an HMAC of it under a random key kept in PostgreSQL (`settings`), so every instance accepts it and an altered one is refused | decided: brief Order list pages (opaque, position after the last order, refused when altered) |
| notices | outbox row in the action's transaction; sender every second; retry min(60, 5 × 2^(n−1)) s on real time | brief: Mailpit (SMTP) |
| clock | one server clock truncated to the second; `/api/_clock` only when `CLOCK_CONTROL` is `enabled` | brief: Time and the clock |
| errors | one builder for `{ error, message, fields? }` | brief: Conventions |

## Palette

The brief gives roles in words only (brief: Visual design, Palette roles); the hex values are decided.

| Role | Value | Source |
|---|---|---|
| paper | `#fcfcfc` (page, text on dark fills) | decided: near-white |
| ink | `#111111` (text, headings, primary button fill) | decided: a hair off pure black |
| deep ink | `#0a0a0a` (announcement bar, footer) | decided: a deeper near-black |
| muted | `#6b6b6b` (secondary text, muted comparison column) | decided: neutral grey that still holds AA on paper and surface |
| accent | `#2b9a95` (selected options, focus ring) | decided: mid soft teal, 3:1 on white for the ring |
| deep accent | `#1e6f6c` (accent text on white, link hover, comparison left headings) | decided: brief says accent text on white uses the deep accent |
| surface | `#f4f6f6` (cards, panels, Build summary) | decided: white with the faintest cool tint |
| rule | `#dddddd` (borders, rule above the total) | decided: pale grey |
| danger | `#d82c0d` (field errors, error icon) | decided: vivid red, AA on white |
| success | `#108043` (confirmation banners) | decided: deep soft green |
| studio backdrop | paper at the top fading to `#e3e8ea` at the bottom | decided: brief Configurator look names paper to a pale cool grey |

The "Out of Stock" badge is ink text on surface with a rule border (decided: the brief names no colour role
for it and the look is almost monochrome).

## Type

| Token | Family | Weight | Size / line height | Source |
|---|---|---|---|---|
| display h1 | Montserrat, system sans fallback | 600 | 48px / 56px desktop, 32px / 40px phone | brief: Type (about three times body on desktop, twice on phone); decided: exact sizes |
| h2 | Montserrat | 600 | 32px / 40px (26px / 34px phone) | decided |
| h3 | Montserrat | 600 | 22px / 30px | decided |
| eyebrow | Montserrat | 400 | 13px / 20px, 0.12em tracking, upper case | decided |
| body | Open Sans, system sans fallback | 400 | 16px / 28px | brief: Type (comfortable size, roomy spacing); decided: exact size |
| lead (hero line) | Open Sans | 400 | 18px / 28px | decided |
| button | Open Sans | 600 | 16px / 24px | decided |
| caption | Open Sans | 500 | 14px / 20px | brief: Type (slightly smaller, medium weight) |

Fonts are self-hosted woff2 files under `public/fonts/` with `font-display: swap`, listed in
`THIRD_PARTY_NOTICES.md` under the SIL Open Font License 1.1 (brief: Type, Server boundary, IF-03, IF-04).
Decided: Open Sans ships as its variable woff2 so regular, medium and semi-bold all render from one file.

## Shape and focus

| Token | Value | Source |
|---|---|---|
| button radius | `9999px` (fully rounded pill), primary filled ink | brief: Shape and icons; decided: value |
| card radius | 24px | brief: generously rounded; decided: value |
| badge radius | `9999px` lozenge | brief: Shape and icons |
| view buttons | a row of small pills along the viewer's top edge | brief: Configurator look |
| focus ring | 2px solid accent, 2px offset, on every focusable control | brief: Browser support (visible accent focus ring); decided: width and offset |
| tap size | every control at least 44 px in each direction | brief: Sizing and contrast |
| line icons | thin stroked SVG in the text colour: arrow, caret, cross, plus/minus, tick | brief: Shape and icons |
| error icon | red ring with an exclamation mark beside each field error | brief: Shape and icons |
| battery gauge | `img "Battery gauge, N of 4 bars"` filling the server's `battery_bars` = `min(4, 1 + floor(total_ride_min / 90))`; default Drift (70 min) fills 1, `DR-49` with `BAT-22` at 70 kg, gear 1, two spares (435 min) fills 4 | brief: Builds, Public screens and controls |

## Layout per viewport

| Viewport | Layout | Source |
|---|---|---|
| desktop 1280x800 | content max width 1200px; header with the four menu buttons; hero text left of the drawing; benefit tiles in a row of four; lineup cards three across; configurator options in the left third, viewer (2:1) plus a compact summary in the right two-thirds, the column sticky while it fits the viewport; cart lines left, totals right; checkout form left, summary right; match panel centred at most two-thirds wide | brief: Screens and layout; decided: 1200px measure |
| tablet 768x1024 | two columns; tiles two by two; lineup cards two across; configurator viewer above the options at full width | brief: Screens and layout |
| phone 375x812 | the four header menus fold into `button "Menu"` opening `dialog "Menu"`; one column; hero drawing above the text; viewer full width about a third of the screen high, then the options; the whole `region "Build summary"` (Build total, financing line, "Up to N min", "Add to cart", "Save build", "Copy link") is fixed to the bottom, its slot lines hidden as the options above show them; checkout stacked with "Place order" after the summary | brief: Screens and layout; decided: one fixed region keeps names unique |

No page scrolls sideways at any of the three; wide tables scroll inside their own box (brief: Screens and
layout).

## Motion

Curves (decided): decelerating `cubic-bezier(0, 0, 0.2, 1)`, accelerating `cubic-bezier(0.4, 0, 1, 1)`, in and
out `cubic-bezier(0.4, 0, 0.2, 1)`. Durations and checkpoints are the brief's (brief: Motion and effects). The
moments with a checkpoint (quiz step, ride-time count, part swap, camera, checkout progress, cart drawer) are
tweened frame by frame on `requestAnimationFrame` and `performance.now` through one `tween()` in `dom.ts`
(decided: they follow the page clock, so a frame is never skipped on a slow machine).

| Moment | Duration | Curve | Properties | Source |
|---|---|---|---|---|
| hero reveal: eyebrow, heading, line, button in order | 0.6 s each, 0.15 s apart, at rest by 1.05 s | decelerating | `opacity` 0 to 1, `transform` translateY(16px) to none; at 0.3 s eyebrow opacity 0.3 to 0.95, button 0 | brief: Motion and effects; decided: 16px rise |
| section reveal, once, when a fifth is in view | 0.6 s; lineup cards 0.1 s apart | decelerating | `opacity`, `transform` | brief: Motion and effects |
| header menus and question rows | open 0.3 s, close 0.2 s | open decelerating, close accelerating | unfold downward / fold up | brief: Motion and effects |
| cart drawer | enter 0.3 s, leave 0.2 s | enter decelerating, leave accelerating | `transform` from the right edge, page dims; at 0.15 s 30% to 90% of its width on screen; the cart count updates as the drawer settles | brief: Motion and effects; decided: count timing |
| other dialogs | 0.2 s each | decided: decelerating in, accelerating out | fade in and grow very slightly; leave by fading | brief: Motion and effects |
| quiz step | outgoing 0.2 s, then incoming 0.3 s, at rest by 0.5 s | outgoing accelerating, incoming a gentler decelerating `cubic-bezier(0, 0, 0.58, 1)` (decided: keeps the 0.35 s checkpoint mid-fade) | slide about a third of the width and fade; "Back" mirrors; at 0.35 s incoming opacity 0.2 to 0.9 and right of rest | brief: Motion and effects |
| part swap | old 0.25 s; new 0.35 s starting at 0.1 s; at rest by 0.45 s | old accelerating, new decelerating | old sinks and fades, new rises and fades in; `data-swap` set during it | brief: Motion and effects |
| camera view or reset | 0.6 s; arrow and zoom keys 0.2 s; drag follows the pointer | in and out | orbit glide; at 0.3 s `data-camera-yaw` or `data-camera-pitch` strictly between start and end | brief: Motion and effects |
| ride-time count | 0.4 s from when the answer is applied | decelerating | "Up to N min" counts in whole minutes; `data-ride-min` holds the new value at once; the gauge, the viewer's charge bar and `data-battery-fill` change when the count ends | brief: Motion and effects |
| checkout progress | 0.4 s | decelerating | fill grows or shrinks; at 0.2 s 40% to 95% of the way | brief: Motion and effects |
| hover and press | within 0.15 s | decided: in and out | buttons darken slightly and sink a hair; announcement link underlines and softens | brief: Motion and effects |

Nothing loops: no spinners, shimmer, auto-playing carousel or idle viewer motion; two viewer frames a second
apart without input are identical; prices and totals never animate. Under reduced motion the reveals render at
rest, drawer and dialogs appear and leave instantly, quiz steps and part swaps are instant (`data-swap` stays
empty), camera views, reset and key steps jump, the ride-time readout and gauge jump, the progress fill jumps;
dragging and zooming still orbit;
state, focus, announcements and address updates are unchanged (brief: Motion and effects).

## States

| State | Treatment | Source |
|---|---|---|
| empty cart | "Your cart is empty" with "Continue shopping" | brief: Feedback states |
| empty locator | "No demo stations within N km." in the results area | decided: the brief gives no copy |
| field error | API field message beneath the field with the red ring icon, tied as its error message, focus to the first refused field, other values kept | brief: Feedback states |
| form-level refusal | the API `message` in the form's `alert` region | brief: Feedback states |
| cap reached | plus disabled, "Limit N per order." beneath the stepper | brief: Cart, Feedback states |
| pending | the action's pending label, e.g. "Placing order...", "Saving...", "Adding...", "Booking..." | brief: Feedback states |
| success | banner with a tick ("Order <number> placed.") or the status text listed in Feedback states | brief: Feedback states |
| sold out at checkout | "Sorry, <line name> just sold out. Your cart has been updated." | brief: Feedback states |
| billing outage | alert "Billing is unavailable. Your order was not placed." | brief: Error catalogue |
| denied | "You do not have access to this page." for a customer on `/staff`; visitor to `/login?next=/staff` | brief: Staff console |
| not found | build "We could not find that build."; match "We could not find that match."; page "Page not found" with 404 and "Back to home"; tracking the single not-found sentence | brief: Feedback states, Information pages |
| no WebGL | a labelled still side drawing naming each part, camera buttons hidden, `data-renderer` `fallback` | brief: Board viewer contract |
| any 500 | alert "Something went wrong. Please try again." | brief: Feedback states |

## Breakpoints

| Width | What changes | Source |
|---|---|---|
| below 640px | phone layout: Menu button, one column, fixed Build summary row | decided: cut points; brief: Screens and layout for what changes |
| 640px to 1023px | tablet layout: two columns, header menus visible, viewer above options | decided |
| 1024px and up | desktop layout: three-card lineup, options left third, viewer and summary right two-thirds | decided |

## Markup decided for the verifier

| Element | Markup | Source |
|---|---|---|
| question rows | eight `button "<question>"` rows with `aria-expanded`, each opening its own panel independently | brief: Public screens and controls |
| lineup anchors | `#drift`, `#crest`, `#swift` on `/boards` | brief: Lineup |
| wings band | `#wings` on `/parts` | brief: Shop pages |
| slot groups | `radiogroup` "Board", "Wing", "Mast", "Propulsion", "Battery", "Controller", "Spare batteries" with native radios; a disabled option's reason is its description; `slider "Rider weight"` and `slider "Speed gear"` | brief: Public screens and controls, Browser support |
| board choice | radios labelled "<board> <size>", for example "Crest 5'8" | brief: Configurator |
| Board viewer | focusable `region "Board viewer"` carrying every attribute of the contract (`data-ready`, `data-renderer`, `data-parts`, `data-colours`, `data-mast-m`, `data-spares`, `data-finish`, `data-battery-fill`, `data-ghost`, `data-swap`, `data-preset`, `data-camera`, `data-target`, `data-camera-yaw`, `data-camera-pitch`, `data-camera-zoom`, `data-fov`); `group "Camera views"` with the four views (`aria-pressed`) and "Reset view" | brief: Board viewer contract |
| 3D renderer | WebGL through the `three` package bundled and served same-origin | decided: MIT licence, allowed by IF-04 |
| cart drawer | `dialog "Item added to your cart"` | brief: Public screens and controls |
| cart link | `link "Cart, N items"` | brief: Public screens and controls |
| carousel | `button "Previous quote"`, `button "Next quote"`, counter "N of 4" wrapping both ways | brief: Home |
| quantity stepper | `spinbutton "Quantity for <line name>"`, `button "Increase <line name>"`, `button "Decrease <line name>"`, `button "Remove <line name>"` | brief: Public screens and controls |
| locator search | `button "Search"` (the brief publishes the same name for the header search button) | brief: Public screens and controls |
| sign up and sign in | `button "Create account"` on `/signup`, `button "Sign in"` on `/login` | brief: Accounts |
| callback phone input | `name="phone"` | decided: the verifier reads the focused field's name |
| country select | native `<select>` labelled "Country", option text the country name, option value the code | brief: Checkout; decided: values |
| guest cart cookie | `tf_cart`, HttpOnly, SameSite=Lax, path `/` | brief: Configuration and secrets (HttpOnly, SameSite=Lax); decided: name and path |
| session cookie | `tf_session`, HttpOnly, SameSite=Lax, path `/`, Max-Age 400 days; the token's SHA-256 is stored | brief: Configuration and secrets (survives restarts until sign-out); decided: name and age |
| idempotency key | inserted (autocommit) as `in_progress` before placement; deleted on any refusal; marked `done` with the order number inside the placement transaction | brief: Idempotency |
| outbox sender | every instance checks every second under a session advisory lock (one sender at a time, oldest due first); an instance whose SMTP failed defers while another instance with working mail has a heartbeat younger than 5 s | brief: Outbox and delivery (pending while the mail-down instance is the only one running; otherwise sent at the next check) |
| reset link | never stored in the outbox row; the sender reads the token from `reset_tokens.mail_token` and clears it once sent | brief: Mailpit (no outbox row or staff screen shows it) |
| allowed moves | the browser offers the action the brief names for each status (staff Orders: placed → "Mark shipped", shipped → "Mark delivered"; order page: placed → "Cancel order"); no transition table is copied into the browser, and the server refuses any other move | decided: each transition table stays defined once, on the server (Engineering standards); the bodies keep exactly the keys of Shapes |
| option deltas and "From" | boot data `optionDeltas` (board SKU → component SKU → cents, from the server's own `slotDelta`) and `lineupFrom` (board name → the SKU of its lowest-priced package); the browser only formats them | decided: brief Engineering standards (the browser shows server-quoted values), and the catalog shape carries no delta |
| cart line cap | boot data `cartLimits` from the server's cap table; the page disables the plus and shows "Limit N per order." | decided: the cart caps stay defined once, on the server, and cart lines keep exactly their published keys |
| account page data | the `/account` shell for a signed-in customer holds `<script id="account-data">` with the customer's callbacks (`{ reference, label, topic }`, soonest first, `label` "<Weekday short> <D> <Month short> <YYYY>, <HH:MM> <timezone>") and each booking's slot label and location name; the browser loads `/account` as a document so the shell is fresh | brief: Accounts (`/account` lists callbacks; "Cancel booking, <slot label>"); decided: no published endpoint lists callbacks or past slots, and `GET /api/me` is exactly `{ user, demo_credit }` |
| Outbox status copy | "Pending (attempt N)" with N the attempt now due (attempts made + 1), or "Sent" | decided: "attempt 0" would read as never tried |
| checkout credits | "Use trade-in credit" / "Use demo credit" appear when a quote with that flag set is accepted by the server | decided: the browser asks the server's rules instead of copying them |
| country select placeholder | a hidden, disabled "Select a country" option | decided: the select lists exactly the six countries; the summary rows read "Choose a country" |
| quiz option labels | the brief's exact labels ("I have foiled without a motor", "Ocean swell", "Whatever it takes", ...) | brief: Match quiz, Labels |
| quote refusal order | `POST /api/checkout/quote` answers `unsupported_country`, then `credit_unavailable`, then `empty_cart` | decided: the brief pins the refusal order for `POST /api/orders` only; a quote answers a credit flag without its credit before reading the cart |
| registration warranty | start = the date of the last `delivered` event in the order country's zone; `board_name` is the board package's name ("Crest") | brief: Board registration and warranty; decided: the name, as `board_name` is on builds |
| demo booking body | `POST /api/demo-bookings` answers the full Booking shape `{ id, slot_id, status, customer_email }` | brief: Endpoints (201 booking), Shapes |
| phone menu close | the Menu dialog's close button is `button "Close"` | decided: "Close menu" would also match the name "Menu" |
| footer foil link | the footer link to `/foil-boards` reads "Unpowered foil boards" | decided: the home "Build from parts" tile already names a link "Foil boards", and names are unique per page |
| part shapes | the viewer draws each wing as one flat swept planform (straight leading edge, curved trailing edge) joined across the fuselage, with a smaller stabiliser of the same planform; the battery fills the deck cavity under the window; the controller floats beside the near rail toward the nose at deck height; spares rest beside the near rail below deck level, so the side view shows the wing, a spare and the controller; it draws each SKU's Shape column (broad, swept, wider span, narrow; round, blade, blade longer; pod with three or two folding blades; block, longer block, short block; trigger grip, grip with a teal ring) from a drawing table keyed by SKU; colours and mast length come from the catalog | brief: Seed data (Shape is not in the Component shape) |
| lineup ride time | the "Ride time" spec quotes the board's standard build at 80 kg, gear 5 through `POST /api/builds/quote` | decided: the catalog no longer carries a ride time and the browser never computes one |
| phone camera views | the five view pills stay one row along the viewer's top edge at every viewport; at phone width the row scrolls sideways inside its own box | brief: Configurator look (a row of small pills along the viewer's top edge), Screens and layout (wide content scrolls inside its own box); decided: one 44 px row is wider than 343 px |

## Judged criteria mapping

| Criterion | Satisfied by |
|---|---|
| B1 drawn hero | inline SVG hero: horizon, water band, board on a mast and wing in silhouette |
| B2 comparison colours | left headings in accent teal (hue within 160 to 200 degrees), right headings muted grey |
| B3 calm palette | neutrals, near-white surfaces and the one teal family |
| B4, B5 type | lineup heading in loaded Montserrat, card description in loaded Open Sans, both same-origin |
| B6 pill button | newsletter "Sign up" radius at least half its height |
| B7 dark bars | deep ink announcement bar and footer with paper text |
| B8 saved side view | side view shows the deep-teal wing, the orange spare beside the board below deck level and the white controller at deck height against the carbon-black deck |
| B9 studio backdrop | paper at the top fading to a pale cool grey, soft contact shadow |
| B10 view buttons | five 44 px pills in one row along the viewer's top edge |
| B11 summary panel | one surface panel distinct from the page background |
| B12 slider values | each slider's value text sits beside its thumb |
| S1, S2 configuration | every URL and credential from `process.env` in `config.ts`; nothing reaches the browser |
| S3 server-quoted amounts | the browser only formats server values; option deltas and lineup "From" prices come from server boot data |
| S4 no browser rule tables | fits and stock from the catalog; the offered order action is the one the brief names for the status |
| Q1 strict TypeScript | `strict` on, no `any` or suppression, async and await for all I/O |
| Q2 exact numbers | integer cents, BigInt fractions for ride time and financing |
| Q3 one error builder | every error body from `errors.ts` |
| Q4 explicit bodies | every success body names its published keys, nested order lines, address, discounts and credits included |
| Q5 atomic placement | one transaction: stock in SKU order, credits, the counter row, the itemised charge |
| Q6 no dead code | no commented-out code, unused exports or single-implementation abstractions |
| Q7 rules once | each rule of Engineering standards defined in one module |

## Pinned literals

| Name | Value | Source |
|---|---|---|
| company | `Tern Foils`; footer "(C) 2026 Tern Foils" | brief: Problem and users, Header and footer |
| boards | Drift (`DR-49`, `DR-54`), Crest (`CR-52`, `CR-58`), Swift (`SW-43`, `SW-48`, `SW-52`) | brief: Seed data |
| staff logins | `staff@ternfoils.com` / `StaffPass2026` admin; `dealer@ternfoils.com` / `DealerPass2026` dealer; `support@ternfoils.com` / `SupportPass2026` support | brief: Seed data |
| first order / callback / case | `TF-100001` / `CB-10001` / `SC-50001` | brief: Seed data |
| codes | `FLYFIRST`, `CHARGE25` | brief: Cart |
| discount refusals | 422 `invalid_code`, 422 `too_many_codes`, 409 `code_already_applied` | brief: Error catalogue |
| field validation code | 422 `validation_error` "Check the highlighted fields." | brief: Error catalogue |
| catalog arrays | 7 `boards`, 14 `components`, 6 `accessories`; components sold as accessory lines under their own SKU, not repeated in `accessories` | brief: Shapes, Cart |
| shop cards | "Price <price>", "Fits: <board names>" on every component card (`/parts` masts and `#wings`) and in the product dialog; "Out of Stock" on `SFB-40-18` on `/foil-boards` and `SW-52` on `/boards` | brief: Shop pages, Lineup, Seed data |
| lineup card eyebrows | "First flights" (Drift), "Longest range" (Crest), "Lightest carry" (Swift) | brief: Home |
| idempotency header | `Idempotency-Key`, 8 to 64 letters, digits, `-` and `_` | brief: Checkout and orders |
| time offsets | quote 1,209,600 s; booking close 3,600 s; cancel 86,400 s; demo credit 7,776,000 s; protection 2,592,000 s; callback lead 7,200 s and horizon 2,592,000 s; lookup 900 s; reset 1,800 s | brief: Business rules |
| Kill Bill | `externalKey` `tern-<email>`, `X-Killbill-CreatedBy: tern-foils`, `X-Killbill-Reason` `order_placed`/`order_cancelled`, `X-Killbill-Comment` the order number, items `<number> merchandise`/`shipping`/`dangerous goods`/`tax`, currency `USD` | brief: Kill Bill |
| mail sender | `MAIL_FROM`, which is "Tern Foils <orders@ternfoils.com>" | brief: Mailpit (SMTP) |
| notices | six: `order_confirmed`, `trade_in_quoted`, `demo_booked`, `callback_requested`, `case_opened`, `password_reset` | brief: Mailpit (SMTP) |
| body limit | 65,536 bytes allowed, larger 413 | brief: Server boundary |
| port | `APP_PUBLIC_PORT`, 4173 when unset, bound on `0.0.0.0` | brief: Deployment |
| financing | 6 and 12 months at 0, 24 and 36 at 999 bp (Canada 12 at 0, 24 at 999); none under 50000 cents | brief: Financing |
| warehouses | San Juan (America/Puerto_Rico) for US, PR, CA, AU; Madrid (Europe/Madrid) for DE, FR; 14:00 cut-off | brief: Ship-by and arrival |
| serial | `TF` + 8 digits + Luhn check digit, e.g. `TF123456782` | brief: Board registration and warranty |
