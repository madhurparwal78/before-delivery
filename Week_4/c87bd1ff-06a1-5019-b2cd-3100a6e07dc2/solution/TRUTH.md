# TRUTH — Gavelhouse golden

Ground truth of the reference app. Every value says where it comes from: `brief: <section>` (verbatim from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## 1. Journeys, end to end

### J1 Register to bid (brief: Journeys 1)
1. Signed-out visitor on `/` presses **Sign in** → `GET /auth/login?next=/` (brief: Server boundary: `next` of `/` is no return path). Server makes a fresh attempt (state ≥ 128 bits, PKCE S256, nonce), binds it to the browser with an HttpOnly SameSite=Lax cookie and answers 302 to `AUTH_ISSUER_URL/protocol/openid-connect/auth`.
2. Visitor creates an account on the Keycloak page; Keycloak sends the browser to `/auth/callback?code&state`. The callback checks state + cookie, marks the attempt used, exchanges the code with the verifier and the client secret, stores a session in PostgreSQL and answers 302 to `/register` (person with no registration and no staff role).
3. `/register`: choose **Bid**, enter Full name, Phone, Address, press **Register** (pending copy `Registering…`). `POST /api/register` records a `pending` registration, adds the realm role `bidder` in Keycloak (503 `sign_in_unavailable` if Keycloak cannot) and answers 201 with `landing: "/bidder"`.
4. `/bidder` shows heading `YOUR SALEROOM` and `Limit pending approval`; reload shows the same.
5. Admin approves with €3,000 (`POST /api/admin/registrations/<id>/approve`): next paddle (from 101, never reused), status `active`, one notice `limit_approved`. The open dashboard shows `PADDLE <n>` and `Spending limit €3,000 · €0 committed` without reload (socket notice → refetch) and the status region announces the notice once.

### J2 Consign a lot (brief: Journeys 2)
Consignor with no lots sees `NOTHING CONSIGNED YET` + sentence on `/consign`. **Offer a lot** → `/consign/new`: Category radio, Title, Description, **Submit for estimate** (`Sending to the specialist…`). 201 → `/consign`, lot listed with State `Intake`. Specialist estimates (state `estimated`), places it in a draft sale (`placed`, consignor sees `In sale`), publishes (`open`, consignor sees `Open`).

### J3 Bid with a maximum (brief: Journeys 3)
Approved bidder opens `/catalogue`, moves with arrow keys, Enter opens `/lots/<id>`. Chooses **Maximum bid**, types a maximum, **Place bid** opens the Confirm dialog (`Bid <euros> as your maximum on lot <n>?`), **Confirm bid** sends `POST /api/lots/<id>/bids` with a fresh `Idempotency-Key`. 201 → board shows the confirmed price, `You lead`, new history row; message `Bid accepted. You lead at <euros>.` A rival's higher maximum arrives over the socket: price rolls, `Paddle <p> leads`, announcement is the `outbid` notice text.

### J4 Close with an extension (brief: Journeys 4)
A bid accepted with less than `SOFT_CLOSE_SECONDS` left moves only that lot's close to bid time + window (`extended`). Catalogue reorders by close, focus stays on the same lot. At the close (within a second, database time) the lot turns `closed_sold`/`closed_unsold`; winner gets `won` notice, lot appears under Won.

### J5 Second chance (brief: Journeys 5)
Closed unsold lot with bids: consignor lot page shows **Second chance** (Offer amount, Offer to the top bidder, Leave unsold). Amount from final price to the top bidder's maximum. Top bidder gets the `second_chance` notice and an Offers row with **Accept offer on lot <n>**; accepting before expiry issues an invoice (`INV-…`), lot `sold_by_offer`, consignor sees `Sold by offer`.

### J6 Invoice, payment, default (brief: Journeys 6)
When the sale's last lot closes each winner gets one invoice (premium 25 %/20 % tiers, VAT 21 % of premium, each rounded half up once). Cashier records payment (`Payment of <amount> recorded. …`); full payment → `paid`. Unpaid at due time → `defaulted` within a second, lots `defaulted`, underbidder gets a default offer at their maximum and accepts it; the lot is invoiced to them. Cashier sees the default under **Defaults**.

### J7 Bid removal (brief: Journeys 7)
Admin picks the lot, **Remove bid**, dialog `Remove this bid?` with Reason. Server recomputes price/leader from the remaining bids (same one `resolve` function), never moves the close back, writes one `bid_removed` notice, emits one event; every open view of the lot repaints within a second.

### J8 Seller statement (brief: Journeys 8)
After the sale closes each consignor has a draft statement (recomputed on every read). Admin **Issue** freezes lines/totals and locks it (`statement_issued` notice). `/consign/statements/<id>` is set like a printed result. **Correct** issues a new statement (version + 1, `supersedes`), marks the old `superseded` with `superseded_by`; both stay readable and link to each other.

## 2. Palette (brief: Visual design; hex values decided where the brief gives a name)

| Role | Hex | Source |
|---|---|---|
| ground (warm near-black) | `#15110E` | brief: Colour; decided: hex for "warm near-black" |
| surface (lifted warm charcoal) | `#221D18` | brief: Colour; decided: hex |
| ink | `#FFFFFF` | brief: Colour (pure white) |
| muted text | `#A89F93` | brief: Colour (warm mid-grey, AA on ground and surface: 7.0:1 / 6.4:1) |
| gold (the one action, Reserve met, links in banners) | `#C9A24B` | brief: Colour (antique gold; text on gold is the warm black, 7.8:1) |
| lot band over the portrait | `rgba(21,17,14,0.82)` | brief: Lot page (darkened band, AA on all six grounds); decided: 0.82 |
| grounds | oxblood `#6E1F2A`, bottle green `#1E4D36`, slate blue `#3F5973`, tobacco brown `#6B4628`, graphite `#3E4044`, ochre `#B58A2E` | brief: Composition (order oxblood, green, slate, tobacco, graphite, ochre = chronograph, rangefinder, diver, twin_lens, dress, bellows) |
| focus ring | 2px solid `#FFFFFF`, offset 2px | brief: Corners and focus |

## 3. Type, space, layout

| Item | Value | Source |
|---|---|---|
| Display face | Anton 400: sale title, lot price, document headings, empty-state lines | brief: Type |
| Text face | Work Sans variable 100–900; amounts use `font-variant-numeric: tabular-nums lining-nums` | brief: Type |
| Scale | 16, 21.3, 28.4, 37.9, 50.5 (× 1.333) | brief: Type (each step about a third larger) |
| Home title | `clamp(48px, 10vw, 144px)` white capitals; the sticky pin itself carries `mix-blend-mode: difference` so it inverts the portraits beneath it; captions and the line + action band paint above it |  brief: Composition (about a tenth of the screen width, between a minimum and maximum) |
| Lot price | `clamp(56px, 12.5vw, 144px)` (wide: `clamp(56px, 9.5vw, 120px)` so seven digits fit the half-width column), characters in fixed cells (digit 0.52em, comma 0.26em, euro 0.5em) | brief: Lot page (about an eighth of the screen width); decided: fixed cells keep digits lined up |
| Corners / strips | radius 2px; 3px strips of ground between rows; no hairlines, no shadow, no glass | brief: Working screens |
| Touch | every button, link, textbox and combobox at least 44 × 44px | brief: Touch |
| Breakpoints | phone < 768, tablet 768–1199, wide ≥ 1200 (`min-width: 768px`, `min-width: 1200px`) | brief: Screens and layout |
| Home | phone: portraits one at a time (width `min(100%, 44svh)` so the six portraits pin the title for at most three screen heights), line and action stacked under the first portrait; tablet 2 across; wide 3 across, line left and gold action right at the bottom of the first screen; tablet/wide: the line + action sit in a solid ground band 96px tall at the bottom of the first screen; then a narrow grid of the twelve soonest-closing lots (2/4/6 columns) | brief: Home poster |
| Catalogue | phone 1 column, tablet 2, wide 3 tiles (wide captions 14/20 and wrap instead of truncating, so the time left is always readable); title band pinned above (phone/tablet), pinned left column of 40 % with the title and the large focused/hovered portrait (wide) | brief: Catalogue |
| Lot page | phone/tablet: one column, band (title + price) sticky at the top; wide: board pinned in the left half, portrait (full column width, 2:3)/details/history scroll on the right; the darkened band covers the whole backdrop portrait |  brief: Lot page |
| Bidder dashboard | PADDLE heading, then Spending limit, Leading, Watching, Won, Offers, Invoices, Notices in 1 / 2 / 3 columns | brief: Bidder dashboard |
| Documents | invoice and statement: one centred column, `max-width: 70ch` | brief: Invoice and statement |
| Specialist desk | phone: Intake, Estimate, Sale order stacked; tablet: Intake + Estimate side by side, Sale order full width below; wide: three side by side | brief: Specialist desk |
| Cashier desk | phone stacked; tablet/wide: invoices left, detail right, Defaults below the table | brief: Cashier desk |
| Admin desk | phone one column; tablet/wide: registrations and statements left, bid removal right | brief: Admin desk |

## 4. Motion

| Element | Trigger | Duration / easing | Reduced-motion substitute | Source |
|---|---|---|---|---|
| Changed price digit | confirmed new price (bid response or socket) | one `Element.animate` per changed digit, 560 ms, `cubic-bezier(.16,1,.3,1)`, 25 ms stagger right to left, rising: old out upward / new in from below, falling (removal): reverse | digits swap instantly, no animation | brief: Hammer Numeral |
| Reserve met line | reserve first met on the lot on screen | opacity fade 200 ms | appears at once | brief: Hammer Numeral (under a quarter second) |
| Time left | extension moves the close | count up to the new server value over 330 ms (`requestAnimationFrame`) | jumps | brief: Hammer Numeral (about a third of a second) |
| Poster swap | focus/hover on a tile, wide catalogue | cross-fade 250 ms | instant | brief: Motion and effects |
| Dialogs | open/close | opacity 150 ms | instant | brief: Dialogs (under a fifth of a second) |
| Hover/press | pointer | colour only, 120 ms; none inside `region "Lot board"` | none | decided: keeps the board's animation list to the numeral and the reserve fade |
| Everything else | — | none | — | brief: No other motion |

## 5. States per async action (brief: Feedback states)

Every submit disables its control (Place bid keeps focus with `aria-disabled`), shows the brief's pending copy, then the result copy under the control, mirrored once in `Saleroom updates`; a later repaint never replaces it. Network failure or ten seconds without an answer: `Your bid did not reach the saleroom. Try again — it will only count once.`, the retry reuses the same idempotency key. Socket down: banner `Live connection lost — reconnecting` with gold `Retry now`; reconnect after 1 s then every 2 s, resume `since` the last applied seq. Unexpected failure: `Something went wrong in the saleroom. Try again.`

## 6. Decisions where the brief leaves room

| Decision | Why |
|---|---|
| Public `status` is the hammer result and never changes after the close; `sold_by_offer`/`invoiced`/… appear only in the consignor/staff `state` | brief: Lot fields |
| Frames are rebuilt per viewer from current state; notices are written before the lot frame in the same transaction | lets the page tell that a notice already covers a price or close sentence (brief: only the notice is announced) |
| Extra read endpoint `GET /api/admin/lots` (open lots) and `GET /api/admin/statements` without `sale_id` | the brief lists no other source for the Bid removal combobox and the Statements panel |
| Correct opens a small dialog asking for the note the API requires | brief: API (`note` 1–300 chars) names no other control |
| No footer navigation; a signed-in person reaches their desk from the sign-in landing or its address | brief: the header holds only the wordmark and Sign in/out, and the public-controls table lists no other navigation |
| Draft maximum kept in `localStorage` per lot with the bid type | brief: Draft maximum (same browser, second tab) |
| Cashier Show filter lives in the address: `/desk/cashier` (Unpaid), `?show=paid`, `?show=all`; any other value reads as Unpaid; a change pushes a history entry and Back restores it | brief: Screens and layout (Cashier desk), DP-60 |
| Watch and unwatch write a `watch` event; its frame goes only to the watching bidder's own sockets (their bidder projection, `watching` = new state) | brief: Live socket (`watch` frame), Change feed |
| An open socket is closed within one tick (500 ms) of its session ending | brief: Sign-in and session (sign-out closes every socket within one second) |

## 7. Media and licences

| Asset | Source | Licence |
|---|---|---|
| Six lot portraits | drawn in code (`web/src/portraits.tsx`) | original |
| Anton 400 latin woff2 | Fontsource `@fontsource/anton` 5.3.0 | OFL-1.1 |
| Work Sans variable latin woff2 | Fontsource `@fontsource-variable/work-sans` 5.3.0 | OFL-1.1 |
| lib/pq, gorilla/websocket, preact | Go modules / npm | MIT, BSD-2-Clause, MIT |

No icons, photographs, audio or video are used (brief: every control is named in words).
