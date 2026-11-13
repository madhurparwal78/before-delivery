# TRUTH — Roam House Atelier

The ground truth of the golden app. Every value says where it came from: `brief: <section>` (copied from the brief)
or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## 1. Journeys (brief: Journeys)

### J1 Find and fit a bag (brief: Journeys 1; DP-01 to DP-07)
- Start: Luggage collection `/collections/luggage`, seed data at start.
- Actions: with the keyboard tick Cabin and Graphite, sort `Price: low to high`, reload.
- Visible end: `Luggage filtered to Cabin and Graphite shows `2 products`, and sorted by price from low to high Meridian Spinner comes first` (brief: Seed data, Examples); the address holds `?size=cabin&colour=graphite&sort=price-asc` (brief: Interactions, Filters and sort); reload returns the same filters, count, order and address.
- Open the first product, step through the gallery, pick Sage in Check-in Medium: `status "Selected variant"` reads `SKU MER-SAG-M · ₹15,999 · Only 2 left` (brief: Seed data, Examples), the address holds `sku=MER-SAG-M`.
- Gate Gauge: choose an airline; `status "Fit verdict"` reads the API `verdict` (`Over by 13 cm for the Skyline Indus cabin frame.` for MER-SAG-M); the address holds `airline=<code>`.
- Provider end state: Meilisearch answers the search and the counts (`GET /api/search`, mode `search`); no write happens.

### J2 Compare, save and switch devices (brief: Journeys 2; DP-08 to DP-10)
- A guest marks three bags for comparison, a fourth is refused with `You can compare up to <max> products.`, the comparison table opens, one is removed.
- Two bags are saved to the wishlist, the page is reloaded (`Wishlist, 2 items`), then the guest signs in; the wishlist joins the account with no duplicates (`wishlist_items` keyed by owner and product).
- A second browser signed in to the same account shows `Wishlist, <n> items` change live through the `wishlist` event.

### J3 Buy the last unit (brief: Journeys 3; DP-11, DP-12)
- Two shoppers each have the last Meridian Spinner in Signal Red, Cabin size (`MER-RED-C`, 1 available) in their bag and press Pay together; `POST /api/checkout/<id>/reserve` and `POST /api/orders` decide under row locks on the variant.
- Exactly one sees `Thank you — order <number> is placed.`; the other sees an `alert` `Sorry, the last <variant> was just taken.` focused, the line marked out of stock, and the product page in both browsers turns to `Out of stock` through the `stock` event.
- Provider end state: stock ledger has `hold_placed` and `order_committed` movements of two entries each; one order exists.

### J4 Check out with codes and a gift card (brief: Journeys 4; DP-14 to DP-22)
- Quantity edits, remove and Undo; refusals `code_invalid`, `code_expired`, `code_exhausted`, `code_not_applicable`, `minimum_not_met` each with its own message at the code field; four steps with server-saved progress; a declined card keeps the shopper on Payment with no order; a good card places exactly one order for one Idempotency-Key; a gift card payment shows `Gift card balance after this order: ₹<remainder>`.
- Provider end state: PostgreSQL holds one order, one payment, a gift ledger group of two entries; Mailpit holds one `Your Roam House order <number> is placed`.

### J5 Follow, cancel, return or exchange (brief: Journeys 5; DP-28 to DP-36)
- The order timeline updates live as staff pack and ship. Cancel while `placed` or `packed` through `alertdialog "Cancel this order?"`: refund, one `Order <number> is cancelled` email, stock back (`order_cancelled`).
- A delivered order: `Request return` or exchange for another colour; support moves it `requested → approved → in_transit → received → inspected → refunded | exchanged`; the exchange creates a zero-value order.

### J6 Trial return and warranty claim (brief: Journeys 6; DP-37 to DP-42)
- A trial return inside the window is approved by support (`Trial return approved`); a warranty registration shows `Covered until <date>`; a claim with a photo is followed `submitted → under_review → approved → replacement → resolved`.
- Provider end state: MinIO holds `evidence/<customer id>/<evidence id>` with the exact bytes after the size read-back.

### J7 Run the catalogue and stock (brief: Journeys 7; DP-23, DP-25, DP-43 to DP-45, DP-49, DP-51)
- A manager changes a variant's price and stock; open product pages update without reload (`price`, `stock` events). A second manager's stale save answers `stale_version` with `Reload latest`.
- Two managers ship an order line by line; every staff write adds an `audit_log` entry. An image upload with storage down publishes nothing; the same upload with the same key succeeds later and creates one image.

### J8 Shop on a phone (brief: Journeys 8; DP-46 to DP-48)
- 375×812: Menu dialog, Filters bottom sheet closed by a downward swipe, gallery swipe, Gate Gauge drag by finger, full checkout; no horizontal scroll at 375, 768 and 1280.

## 2. Palette (brief: Visual design; hex decided: the brief names roles, not hex values)

| Role | Hex | Source |
|---|---|---|
| ground (near-black charcoal) | #141414 | brief: `Ground: near-black charcoal`; decided: lightness 8%, under the 15% bound |
| surface | #1f1f1f | brief: `Surface: a slightly lighter charcoal` |
| ink | #ffffff | brief: `Ink: pure white` |
| muted | #a8a8a8 | brief: `Muted: a mid grey`; decided: 6.7:1 on surface |
| accent teal | #008573 | brief: `Accent: a deep teal, used for the navigation tab, the primary button and the focus ring.`; decided: white on teal 4.6:1 |
| focus ring | #008573 | brief: the accent is used for the focus ring; decided: 4.0:1 on ground and 3.6:1 on surface, so it meets the 3:1 rule; white ring on teal controls and red or blue pages |
| poster red | #d6281c | brief: `Flat poster red`; white text 5.0:1 |
| poster blue | #1c3fcb | brief: `cobalt blue`; white text 8.0:1 |
| poster yellow | #f5b700 | brief: `warm yellow`; charcoal text 10.2:1 |

## 3. Type, space and layout (brief: Visual design, Screens and layout)

- Type: Schibsted Grotesk for everything, self-hosted variable woff2 (brief: Type). Each heading level is a quarter larger than the one below it (brief); body 17px with 1.6 line height (decided: comfortable reading size).
- Axis: 42% of the window width; headings and body start on it; the left zone holds small side notes, specs, counts and filters (brief: Screens and layout). 537.6 px at 1280.
- Breakpoints: `Layout changes at exactly two widths: 640 px and 1024 px` (brief). Collection grid 3 / 2 / 1 columns (desktop / tablet / phone); filters in the left zone on desktop, behind the `Filters` button as a dialog from the bottom on tablet and phone.
- Corners: square everywhere except the round handle of the Gate Gauge bag; every tappable control at least 44 by 44 px (brief: Corners and targets).
- Hero: six columns by two rows, gutterless; four greyscale vector bag studies and flat red, blue and yellow tiles; one study spans two columns and the blue tile spans both rows (brief: Hero). Title scale `max(48px, 10vw)` (decided: `from about the width of a thumb on a phone up to about a tenth of the screen width on desktop`).

## 4. Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Gallery | view change | 280 ms; `data-state` `sliding` then `idle` | fast start, soft finish (decided: cubic-bezier(0.16, 1, 0.3, 1)) | swap with no slide; `data-motion-ms` 0; `data-state` stays `idle` |
| Drawers and sheets (`Your bag`, `Filters`, `Menu`) | open, close | 320 ms; `opening`/`open`, `closing`/`closed` | same | appear and disappear at once; `open`/`closed` |
| Bag totals | a figure changes | 180 ms | same | instant |
| Toast | `status "Cart updates"` message | fade in 200 ms; hides after the toast time or the undo time | same | instant |
| Hover | pointer over button or link | within 200 ms (decided: 180 ms) | same | none |
| Gate Gauge | drag, Enter, variant change | `data-motion-ms` 420; settle within 700 ms with one small overshoot; numerals count in about 0.4 s | spring | bag jumps to rest; `data-state` goes to `settled` |

## 5. Business rules the build follows (brief: Business rules; copied, not restated)

- Totals in the published order: line subtotal, discount on eligible lines (percentage rounded half up per line; fixed amount shared by line subtotal with leftover rupees in bag order), shipping (`Standard is ₹0 when the discounted subtotal is at or above FREE_SHIPPING_MINIMUM (the minimum itself is free) and ₹249 below it. Express is ₹499 always.`), tax per line plus shipping tax, grand total, gift card, amount to pay. Worked example in the brief: ₹14,596, and ₹12,596 with `RHGC-2000-ALFA`.
- Holds: `A hold is active while server now is before reserved_at + RESERVATION_TTL_SECONDS.` Lapsed holds are released with `hold_lapsed` on every read of the variant's stock, product, bag or checkout, on every reserve, and by a sweep every 5 seconds (at least every 30 seconds required).
- Errors: one JSON shape; precedence as published (401, 404, 403, idempotent replay, 412, 409, 422, 402, 503).
- Windows: a delivered line can be returned `while server now is before delivered_at + RETURN_WINDOW_DAYS days`; trial likewise with `TRIAL_WINDOW_DAYS`.
- Audit entries are immutable by a database trigger; stock movements and gift ledger groups are two entries that sum to zero by deferred constraint triggers.

## 6. Decided where the brief is silent

- Seeded product art is generated by the app (`/media/studies/<product>/<colour>/<view>.svg`), never stored in MinIO; an uploaded image is a `product_images` row with a MinIO object, shown first (position 1, newest first). decided: the brief says seeded images ship with the app and still show when image storage is down.
- brief: Holds: "A line is held from the location with the most available, with ties going to `bhiwandi`." The whole line comes from that one location; if it has fewer available than the line's quantity, nothing is held and reserve answers `out_of_stock` for that line (brief: `If any line has fewer available than its quantity, nothing is held`). Exchange and replacement units are committed from one location by the same rule.
- `GET /api/search` carries `options` (every filter option with its label) and each result carries `skus`, `first_skus` and `price_varies`. decided: the filter checkboxes need the option list even when `facets` is null (search down) and the card needs the first size of each colour.
- Compare state lives in the address; the header `Compare` link carries the set last seen in this tab (session storage). decided: the brief puts the set in the address and gives the header link no target set.
- The gift amount last shown on a checkout is kept on the checkout, and placement answers `already_redeemed` when the live balance is below it. brief: Gift cards (`If it is now below the amount the checkout shows`).
- Every page shell carries the live sequence current when it was served (`meta name="live-after"`), and the tab's stream opens with `?after=<seq>`; events that land while the product is still loading are announced in `status "Product updates"` once it arrives. decided: the brief says a client resumes from its last sequence with nothing missing, and an open page must show changes made after it was opened.
- Setup orders draw their units from the `external` account into `committed` (placed, packed) or `dispatched` (shipped, out for delivery, delivered). brief: Grading setup.

## 7. States per async action (brief: Feedback states)

| Action | Pending | Success | Error |
|---|---|---|---|
| Add to bag, Quick add | `Adding` | `Added <variant> to your bag. Bag total ₹<total>.` | alert with the API message |
| Apply code | `Applying` | `Code <CODE> applied.` | alert at the code field, `aria-describedby` |
| Checkout Continue | `Checking` | focus on the next step's heading | `There is a problem` summary, focus on the first invalid field |
| Pay | `Paying` | `Thank you — order <number> is placed.` focused | alert focused (sold out, declined, expired) |
| Cancel | `Cancelling` | status `Cancelled`, focus on `Order <number>` | alert |
| Return, trial, claim submit | `Submitting` | `Return <number> requested.`, `Trial return <number> requested.`, `Claim <number> submitted.` | field errors, alert |
| Staff save | `Saving` | `Saved <sku>.`, `Saved <slug>.`, `<number> is now <status word>.`, `Image added to <product> in <colour>.`, `Code <CODE> created.` | alert, `Reload latest` on `stale_version`, `Try again` on `storage_unavailable` |
| Live stream | — | empty `status "Connection"` | `Reconnecting to live updates.` |

## 8. Media and licences

- Bag studies: SVG drawn by `src/server/studies.ts` (licence `original`). Masthead studies: inline SVG drawn in code (`original`).
- Font: Schibsted Grotesk variable woff2, SIL OFL 1.1, `public/fonts/`, listed in `assets.json` and `THIRD_PARTY_NOTICES.md`.
- No photographs, no people, no external fonts, images or scripts (brief: Imagery; Working rules IF-05).
