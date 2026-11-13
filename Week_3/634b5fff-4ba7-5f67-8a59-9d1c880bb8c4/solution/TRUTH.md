# TRUTH — Svovlstik Press: The Last Bundle

The golden's ground truth. Every value says where it came from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (start state → actions → visible and provider-recorded end state)

### J1 Read and strike (brief: Journeys 1; DP-48, DP-49, DP-50)
* Start: no prior state, `/`. The `dialog "Sound"` takes focus; `Sound on`, `Sound off` and `Continue without sound` close it; the choice persists in the browser and the question never returns (brief: Interactions "Sound question").
* The story is one narrow centred column over the fixed canvas; `region "Captions"` shows one lit sentence of the tale at a time (brief: Visual design "one sentence lit at a time"); progress is scroll position 0..1 (brief: DP-48). Chapters: alley 0, stove 0.12, goose 0.30, tree 0.46, falling star 0.62, grandmother 0.72, shelf 0.86 to 1 (brief: Motion "The Held Match, story").
* In stove, goose, tree, star, grandmother, `button "Strike a match"` is enabled; a tap, a drag of at least 80 px along it, or Space/Enter on focus strikes. A spark of about 180 ms and a flare of about 320 ms raise the point light to exactly 1 (2 for the bundle with 12 matches in the grandmother chapter), the vision rises in about 900 ms, the match goes out 12 s after the strike (±0.5 s), `lightIntensity` and `litMatches` fall to 0 at once, the vision sinks in about 900 ms and `status "Story status"` reads `The match went out. Strike another.` (`The bundle went out.` for the bundle) (brief: Motion, Feedback states).
* In alley and shelf the button is disabled (brief: Interactions "Strike"). At the shelf it stays in the accessibility tree as disabled but is clipped out of sight, so it does not cover the grid (decided: "every shelf target" and "each transparent DOM cell lies over its box" need the room).
* End: scrolling to the shelf chapter turns the camera to the dark shelf of 240 boxes with the grid `grid "Box shelf"` over it (brief: Journeys 1).

### J2 Hold a number (brief: Journeys 2; DP-01 to DP-06)
* Start: `/shelf`, box 117 available. Choosing 117 (`gridcell "Box 117, Goose, available"`): `status "Hold status"` reads `Reaching for box 117...` then `Box 117 is yours while this match burns.`; `POST /api/holds` answers 201 with `holdToken`, `holdMs` 600000, `remainingMs`; the hold exists in Valkey as `hold:117` = token with a 600 s TTL; the camera turns to the box in under a second; a standing lit match is on it; `region "Hold bar"` shows `timer "Time left"` (`10:00`, then `09:59`…, the server's remaining time asked once per second), `status "Boxes held"` = `1`, focus moves to `button "Go to checkout"` (brief: Interactions "Choosing a box"; Hold bar row).
* A second collector reaching for 117 gets 409 `box_held` and the words `Someone else is holding box 117. Choose another number.`; their shelf shows the cell as `held` within 2 s of the grant over the SSE stream (brief: API Holds, DP-01).
* When the grid's own scroller moves, the 3D shelf slides with it and the camera stays on its path; under hold focus the slide fades out, so the camera's place depends only on progress and the held box (brief: Interactions "Scroll"; decided: how the grid and boxes stay in step).
* `Put it back` deletes the hold (204), text `Box 117 is back on the shelf.`, `Boxes held` = `0`, focus returns to the box's cell, every open shelf shows it `available`.
* If the collector does nothing, the Valkey key expires at its edge, `GET /api/holds/117` answers 410 `hold_ended`, the flame dies, `Your match went out. Box 117 is back on the shelf.` appears, the box darkens/reappears on every open shelf within 2 s (brief: Motion "The Held Match, shelf"; Feedback states).
* A reload keeps the token in `sessionStorage` and asks the server for the time left; the device clock is never read (brief: Interactions "Reload", "Countdown").

### J3 Pay by card (brief: Journeys 3; DP-07, DP-08, DP-09, DP-10)
* From a live hold: `/checkout` form `Checkout` with name, email, street, postcode, city, optional gift, `radio "Card"`, card fields and `button "Authorise DKK 1,584.00"`.
* Card `4000000000003220`: `POST /api/checkout` answers 202 with `challenge {id, expiresInMs}`; `dialog "Bank check"` shows the last four digits `3220` and `1,584.00`; code `1234` + `Approve` → 200 authorised; the order page `/order/<reference>?token=…` shows `Your card is authorised. You have not been charged yet.`; Kill Bill has account (externalKey = lowercased email), one committed invoice with four items (`maker share` 81,926 øre, `charity share` 37,674, `VAT` 29,900, `courier` 8,900 at the 31.5 % seed rate) and one `AUTHORIZE` of 158,400 øre; the box is `claimed` (public `taken`); Mailpit holds `Box 117 is reserved: card authorised (<reference>)` (brief: Business rules "Split", Services "Kill Bill", "Mailpit").
* A decline (any other card) returns 402 with the published copy, the hold keeps its time, the same order reference is reused on the second try with a new `Idempotency-Key` (brief: Business rules "Attempts"). Escape in the dialog acts as Cancel (`challenge_cancelled` copy), focus returns to the Authorise button.
* One attempt key = one gateway authorisation and one Kill Bill transaction under double submits; the key is sent to the gateway as `Idempotency-Key`.

### J4 Pay by bank transfer (brief: Journeys 4; DP-11 to DP-13)
* `radio "Bank transfer"` + `button "Reserve for bank transfer"`: 201 with `transfer {iban, paymentReference, amountOre 158400, deadlineAt}`, `deadlineAt` at 23:59:59 Copenhagen time on the third banking day after the order (skipping weekends and 24, 25, 26, 31 December and 1 January); `holdRemainingMs` null; box `awaiting_transfer`, public `taken`; Mailpit holds `Bank transfer instructions for box <n> (<reference>)`; payment `pending`; no Kill Bill record yet.
* `transfer.received` for 158,400 within the deadline: payment `settled`, box `claimed`, Kill Bill invoice + `PURCHASE` 158,400, `order.paid` event, receipt mail.
* Lapse (deadline passed, swept within 5 s): payment `lapsed`, box `available`, notice mail `Your transfer deadline passed: box <n> (<reference>)`. A late transfer is refunded in full through the gateway and never reattached; a wrong amount is returned (`/return`) and the deadline keeps running (brief: Business rules "Transfer arrival").

### J5 Send a gift on a phone (brief: Journeys 5; DP-24, DP-52)
* 375×812, sound off, discrete or scrubbed story with tap-to-strike, shelf at 6 columns, `checkbox "This is a gift"` reveals recipient fields stacked in one column, card payment; the recipient later gets exactly one `A numbered box is on its way to you` mail (name, box number, plate, message, no price, amount, currency or reference); the buyer gets the receipt.

### J6 Pack and ship (brief: Journeys 6; DP-18 to DP-23, DP-27 to DP-29)
* Packer signs in through Keycloak, finds the order by recipient (`searchbox "Search boxes"`), presses `Pack`: status `Packing box <n>...`; gateway capture (immediate: 200, callback: 202 pending, `pay_capfail_`: 402 → `capture_refused` copy, payment `capture_failed`, box stays `claimed`, ntfy `Capture failed`); Kill Bill `CAPTURE`; only then payment `captured`, box `packed`, and `order.paid` + `box.packed` are written in the same transaction as the paid state and published afterwards.
* `order.paid` effects, each once per event: certificate PDF (Gotenberg) stored at `certificates/<reference>.pdf`, receipt mail, gift notice, Svix `order.paid`. `box.packed`: courier booking → `trackingCode` → box `shipped` → `Box <n> is shipped.`.
* A failing effect is retried 5 s then 20 s later; after the third failed delivery the event is dead-lettered (queue `press.fulfilment.dead`), the maker's ntfy topic gets `Event dead-lettered`, and `/staff/dead-letters` lists it; `Retry` re-queues with three fresh deliveries, `Dismiss` needs a note and keeps it (brief: Business rules "Fulfilment").

### J7 Refund and restock (brief: Journeys 7; DP-30 to DP-34)
* Treasurer, `/staff/refunds`: partial refund R: net = round(R / 1.25), VAT = R − net, charity = round(net × locked rate), maker = net − charity, each capped at what remains; the refund that empties the box takes the exact remainders so ledger totals are exactly 0; shown settled only when the gateway confirmed and Kill Bill has the `REFUND` and the item adjustments; the buyer gets `Refund for box <n> (<reference>)`; Svix `refund.settled`; a full refund moves the box to `returned` and cancels the certificate (`certificate_cancelled`, 410). The courier fee is never refunded.
* The box returns to sale and to public search only when the packer presses `Back on the shelf`.

### J8 Close the month (brief: Journeys 8; DP-35 to DP-42)
* Treasurer schedules a rate only from a future instant (`rate_must_be_future` otherwise); earlier orders keep their locked rate. `Issue statement` for a Copenhagen month that has started renders a PDF with a text layer (`Charity statement <YYYY-MM>`, `Revision <n>`, charity name, one line per sale or refund, `Total charity share: DKK <amount>`), stores `statements/<month>-r<revision>.pdf`, emits a signed `statement.issued` event with a tokened `downloadUrl`; refunds post as negative lines in the month they settled. The deliveries table reads Svix on each request.
* A returning collector's lookup (`/lookup`, reference + email, case-insensitive) answers 200 with the order token; 5 refused tries in the window then 429 with `Retry-After`; the order page's `link "Download certificate"` serves the same bytes each time.

## Palette (hex values the build uses) — brief: Visual design (Colour roles) for the roles; hexes `decided: DESIGN.md`
ground `#070B14` (scene, hold bar), ink `#0A101C` (sheet text), snow `#E6EDF7` (story text), sheet `#EAF0F8`, field `#F6F9FD` (decided: inputs read as wells on the sheet), ash `#8B95A8`, ash-ink `#4A5568` (decided: AA on sheets), rule `#6B7588` (decided: 3:1 borders), sulphur `#F2C641` (flames, the one primary action), ember `#E0562B` (dying match), ember-on-sheet `#A8340F`, ember-on-ground `#F2704A` (decided: AA error text).

## Type — brief: Visual design (Type)
Gloock 400 for chapter titles and headings; Newsreader 400/600 and 400 italic for everything else; both bundled woff2 (SIL OFL), each heading step one third larger (1.5, 2, 2.667, 3.556 rem over a 1.125 rem body) (decided: ratio 1.333 from "about a third larger").

## Space and layout per viewport — brief: Frontend (Screens and layout, Width bands)
* ≤ 767 px (375×812): shelf 6 columns, staff lists stacked `article` cards, checkout one column, no horizontal overflow, every target ≥ 44×44.
* 768–1279 px (768×1024): shelf 12 columns, staff `table`, centred checkout sheet.
* ≥ 1280 px (1280×800): shelf 20 columns, staff `table`, centred checkout sheet.
* Hold bar docked to the bottom edge at every width (brief: Screens and layout).

## Motion table — brief: Motion and effects (Interface motion); easing `cubic-bezier(0.16, 1, 0.3, 1)` is decided: "starts fast and settles softly"
| data-motion | Element, trigger | Duration | Reduced motion |
|---|---|---|---|
| press | any button, on press | 120 ms (scale 1 → 0.97 → 1) | 0 |
| focus | text input, on focus | 160 ms | 0 |
| shake | checkout form, a submit that fails validation | 240 ms (3 cycles of 4 px) | 0 |
| count | `status "Boxes held"` numeral, on change | 320 ms | 0 |
| step | checkout payment panel, on method change and when the sheet opens | 420 ms | 0 |
| payment-state | `status "Payment status"` content, on state change | 320 ms | 0 |
| receipt | order confirmation block, on mount | 480 ms | 0 |
| row | staff row/card on enter, 30 ms apart, at most 10 | 180 ms | 0 |
| route | every routed sheet, on route change | 480 ms | 0 |
Every motion runs through `element.animate()` so it starts with its action or the element's arrival, not on the next painted frame (decided: readable through `getAnimations()`, as the brief asks). Under reduced motion the scene draws only on a change: no flame flicker (brief: Reduced motion "still camera pose"). Behind a sheet the flame does not flicker either and the scene redraws when the hold updates (decided: the flicker cannot be seen through the dimming).
Strike spark 180 ms, flare 320 ms, vision rise/sink 900 ms, burn 12 s; snow flakes cross the viewport in 8–20 s; no other idle loop (brief: Motion). Reduced motion and no WebGL: discrete chapters, a struck vision stays lit until the chapter changes, `lightIntensity` 1 / `litMatches` 1 (2 / 12 at the grandmother), the hold match steps every 10 s (brief: Reduced motion).

## States per async action — brief: Feedback states
* Hold: pending `Reaching for box <n>...`, granted, released, ended, `box_held`, `box_taken`, `hold_not_yours`.
* Checkout: field errors beside each field and in `alert "Checkout errors"`; declines; challenge failed/cancelled/expired; `gateway_unreachable`, `ledger_unreachable`, `sales_paused` (banner and 503).
* Payment status: one published line per state (started, challenge, authorised, captured, partially_refunded, refunded, voided, authorised_too_late, capture_failed, authorisation_expired, pending, settled, lapsed).
* Staff: Packing / Packed / Shipped / `capture_refused` / Back on shelf / refund pending and settled / rate scheduled / statement issued / art saved / dead-letter lines / waiting notices; every outage has its published copy.

## Services and records — brief: Services, Business rules
Valkey `hold:<n>` token + TTL; Postgres: boxes, orders, payment events, split lines, refunds, rate changes, statements, outbox events, jobs, sessions, passages; Kill Bill account/invoice/payment as above; RabbitMQ exchange `press.events`, queues `press.fulfilment`, `.retry`, `.dead`; Meilisearch `press_public` (passages + unsold boxes, no recipient field) and `press_staff`; MinIO `plates/<plate>/<random>.<ext>`, `certificates/<reference>.pdf`, `statements/<month>-r<revision>.pdf`; Svix application `svovlstik-charity`; ntfy topic `svovlstik-maker`; Mailpit messages from `MAIL_FROM`. With `PRESS_NAMESPACE` set every one of those names takes the `<namespace>-` prefix (brief: Services "Namespace").

## Media and licences
All 3D geometry, textures, snow, flames, chapter stills and icons are generated in code (`original`). Fonts: Gloock and Newsreader, SIL OFL 1.1, self-hosted (`client/public/fonts`). Narration: one Ogg Vorbis file per chapter in `narration/`, offline eSpeak NG synthesis of the public-domain Paull translation, licence `original`, recorded in `THIRD_PARTY_NOTICES.md` (brief: IF-06). Packages: MIT, ISC, Apache-2.0, BSD only (brief: IF-03).

## Decisions where the brief is silent
* Order page copy for a voided order that never held the box (the API reports `boxState: "held"` for it) uses the `authorised_too_late` line (decided: the order view's key set is fixed by the brief).
* `Go to checkout` is sulphur only where it is the view's one primary action: it takes the secondary style on `/checkout` and in the chapters where a match can be struck (decided: brief "the one primary action"; its name and behaviour do not change).
* With no live hold, `status "Hold status"` reads `No box held.` until the first published line replaces it (decided: an empty docked bar says nothing to a stranger; the brief gives the region no copy for this moment).
* In the alley the disabled matchbox is ink and ash, not sulphur (decided: brief "Warm colour appears only where a match lights it or on the one primary action"; a control that cannot be pressed is neither).
* Below 1280 px `button "Sound"` shows only its icon and keeps the word as its accessible name (decided: the search's placeholder is the name of a published control and should not truncate).
* An empty staff list keeps its table or card group and adds one sentence under it: `No statements have been issued yet.`, `No events have been sent to the charity yet.`, `No orders are waiting.`, `Nothing on the shelf matches that.`, `No orders yet.` (decided: the brief prints no empty copy for these lists except `No events are waiting for you.`; a header with nothing under it says nothing to a stranger).
* Staff "waiting" notices come from the `x-press-waiting` response header (decided: every response body's key set is fixed by the brief).
* A shelf cell is 64 px at its largest and otherwise fills the width, at every band, and the grid scrolls inside its own area when its rows do not fit; at 1280x800 the last rows are reached by scrolling the grid (decided: the camera draws a cell at about three quarters of that size at the far end of the shelf range, and "every shelf target measures at least 44 by 44 px" must hold there too; a cell sized to fit all rows falls below it).
* Choosing another number while holding one releases the first hold first (decided: a cart holds one box, "out of scope: a cart holding more than one box").
