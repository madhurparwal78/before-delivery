# TRUTH — Halyard Hall Seatwise golden

The brief made concrete. Every value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (ideal end-to-end flow)

### 1. Choosing seats by keyboard (brief: Journeys 1; Interactions)
- Start: `/` shows `heading "Programme"`, one `article "<title>"` per performance in start order, each with its
  venue-time label, one line per tier (`<name> <face> <remaining> left` or `Sold out`) and `link "Choose seats for <title>"`.
- The link opens `/p/<id>?section=ST&seat=ST-A-15&tier=all` (brief: Address defaults).
- Tab reaches the single tabbable seat (ST-A-15, `tabindex="0"`); arrows move within the Stalls; Page Down switches
  to the Circle (tab changes, CI-A-15 active); the `radiogroup "Price tier"` is one Tab stop and arrows select.
- Each active or hovered seat draws the brass Sightline wedge and the readout `<angle>° off centre`, `<distance> m to stage`.
- Space selects two seats (`2 selected`); Hold selected seats sends one request.
- End: the Cart lists both seats (label, tier, face, seat fee, Release), `Face value`, `Seat fees`, `Order fee`,
  `Total`, the `timer "Hold time left"` (`m:ss`) and Checkout; the status region announces `Held <labels>.` once.
- Provider state: seats `held` in Postgres with one cart expiry instant (now + `HOLD_SECONDS`, whole second; decided: so the API shows the exact instant).

### 2. Paying (brief: Journeys 2; Business rules: Orders and payments)
- Checkout opens `dialog "Checkout"` with focus on Full name; Pay shows `Pay <total>`.
- Pay: button reads `Confirming payment` (disabled); the server creates a `pending_payment` order with
  `payment_pending` tickets, asks Kill Bill for one PURCHASE (payment key `<order id>`, transaction key
  `<order id>-purchase`, amount = total in dollars), then in one transaction marks the order `paid`, seats `sold`,
  tickets `issued`, receipt `queued`.
- End: the dialog shows `You're in`, `Order <id>`, `region "Receipt"` (the charged ledger) and
  `A receipt is on its way to <email>.`; announced `Payment confirmed. Your tickets are issued.` once.
- Kill Bill: account with external key = email in lower case, USD, name from the first purchase, default
  `__EXTERNAL_PAYMENT__` method; one payment for the exact total. Mailpit: one receipt
  `Your Halyard Hall tickets: order <id>` from `MAIL_FROM`.

### 3. The last seat (brief: Journeys 3; Seat states)
- Two buyers hold the same seat together: the seat row lock gives one winner. The winner's response lists it in
  `held`; the loser gets `409 seats_taken` (or `200` with it in `taken` when another seat was held).
- Loser's page: announcement `Taken by another buyer: <label>.` (or `Held <labels>. Taken by another buyer: <labels>.`),
  Notice `Someone else got there first. We kept the rest of your selection.`, the seat drawn as Taken, other seat kept.
- Every open map turns the seat to Taken through the live channel (same-origin WebSocket fed by Postgres NOTIFY) within 2 s.

### 4. When things go wrong (brief: Journeys 4)
- Kill Bill unreachable at Pay: `503 {"error":"payments_unavailable"}`; order `cancelled`; seats stay held with the
  unchanged expiry; Payment notice and announcement
  `Payments are paused right now. Your seats stay held until your hold ends. Please try again shortly.`
- Declined: `402 payment_declined`; order `cancelled`; seats freed; `Your payment was declined. Your seats were released.`
- Walk away: the hold ends at its expiry instant (every request first sweeps ended holds; every copy also sweeps each
  second); seats go back on sale or to the next waiting fan; every open seat map of that performance in the browser
  shows the Notice and announces `Your hold ended and the seats were released.` once.
- Seats remaining is always the count of `on_sale` seats, read from seat states.

### 5. The waitlist (brief: Journeys 5; Waitlist and offers)
- With remaining 0 the seat map shows `button "Join the waitlist for <tier>"`; the dialog joins and announces
  `You're on the waitlist for <tier>. Your place is <n>.`
- A freed seat goes to the earliest waiting entry: offer `open` for `OFFER_SECONDS`, seat `offered`, one e-mail
  `A seat is offered to you: <title>` with the seat, title, start label, `Total <amount>`,
  `Accept by <h:mm:ss AM/PM TZ> on <date>` and `<APP_PUBLIC_URL>/offers/<token>`; every open page of the browser
  announces `A seat is offered to you: <label>.`
- `/offers/<token>`: `A seat for you`, ledger, `timer "Offer time left"`, `Accept and pay <total>`, `Decline offer`.
  Accept pays exactly as a checkout; decline announces `Offer declined. The seat goes to the next person waiting.`
  and the heading becomes `This offer has ended`.

### 6. Exchanging and refunding (brief: Journeys 6; Exchanges; Refunds)
- Exchange `<label>` opens exchange mode (`?exchange=<ticketId>`), the Notice prompts for a seat, `Exchange to this seat`
  opens `dialog "Confirm exchange"` with the old seat, the new seat and `You pay` / `We refund` / `No price difference`.
- Positive difference: a new Kill Bill payment `<order id>-exchange-<n>`; negative: REFUND transactions newest payment
  first; zero: no Kill Bill call. Then the ticket moves, the new seat is sold, the old seat freed; one e-mail
  `Your seat exchange: order <id>`; announced `Exchange confirmed. Your new seat is <label>.`
- Refund `<label>` opens `dialog "Refund ticket"` with `Refund <amount>` (+ `Includes the order fee` when no issued
  ticket would be left); tickets `refund_pending` until Kill Bill confirms, then `refunded`, seats freed, order
  `partially_refunded` or `refunded`; one e-mail `Your refund: order <id>`; announced `Refund confirmed: <amount>.`
- Every other open My tickets tab of the browser updates through the live channel without a reload.

### 7. Running the hall (brief: Journeys 7)
- `/owner` sign-in with `brass-rail-1897` sets the HttpOnly `seatwise_owner` cookie; a wrong passcode announces
  `That passcode is not right.`
- Publish: `2027-11-07T01:30` resolves to `2027-11-07T06:30:00Z`, `Sun 7 Nov 2027, 1:30 AM CDT` (first occurrence);
  `2027-03-14T02:30` is refused `That time does not occur in Chicago on that date.`; announced `Published <title>.`
- Dashboard: one `table "<title>"` per performance with Tier, On sale, Held, Sold, Offered, Waitlist, live.
- `table "Orders"`: every order with status, totals, Kill Bill payment ids and receipt status; `table "Outbox"`:
  recipient, subject, kind, `Queued` / `Sent`.

## Palette (brief: Visual design; hex decided in the design direction)

| Role | Hex | Source |
|---|---|---|
| paper (ground) | `#F7F1E3` | brief: warm ivory; decided hex |
| ink (all text) | `#2E1713` | brief: one deep oxblood-brown ink; decided hex (15.6:1 on paper) |
| oxblood (action, emphasis, selected, outline of a seat that is yours, focus ring, errors) | `#7A1E22` | brief; decided hex (9.9:1) |
| brass (wedge, stage band, hatch; nothing else, the readout rule is ink) | `#A8813A` | brief: "used only for the Sightline wedge and the stage band"; decided hex |
| fawn (hairlines, not-on-sale dots) | `#C9B48F` | brief; decided hex |
| tints | `color-mix()` of the above with paper | decided: no new hue |

No gradients, no shadows (brief). Dialog scrim: ink at 25 % (decided: a native backdrop must not add a grey hue).

## Type (brief: Visual design)

Fraunces (headings, self-hosted variable woff2, family name `Fraunces`) over Public Sans (body, family name
`Public Sans`); 16 px body; scale 1.25: 20, 25, 31.25, 39 px (page title ≈ 2.44× body); performance title set
wide (letter-spacing 0.06em, opsz 144, SOFT 100); tabular lining figures on every price, countdown, seat number,
order number, angle and distance.

## Space and layout per viewport (brief: Screens and layout; decided where silent)

| Viewport | Seat map arrangement | Seat target |
|---|---|---|
| 375×812 (< 768) | one column: header, tabs, tier choice, notice, map frame (full width, pans sideways in its frame), readout, selection line, Cart | 46 px |
| 768×1024 (768–1279) | map full width; Cart a fixed bottom sheet, full width, ≤ 40 vh, scrolling; 42 vh space kept below the content | 24 px |
| 1280×800 (≥ 1280) | header full width; tabs with the hall key and the tier choice on one line (decided: so the first screen reaches the stage, the front rows and the active seat's wedge); notice full width; then map + readout + selection (left) and a 360 px sticky Cart rail (right) whose top lines up with the map frame | 26 px |

Spacing scale 4/8/12/16/24/32/48/64 px; 1 px fawn hairlines; 2 px radius on controls; every control ≥ 44×44 px.
My tickets ≤ 760 px centred; dialogs fill the viewport below 768 px, else ≤ 560 px centred.

## Seat plan geometry (brief: Sightline geometry; decided drawing)

- One coordinate system in cells, origin at the centre of the stage lip, y towards the seats. Row r of a section is an
  arc of radius 11 + r cells; seats sit one cell apart along it; seat n is at angle (n − 15.5)/(11 + r) rad.
- `offCentreDeg` = that angle in whole degrees (negative for seats 1–15). `stageDistanceM` = distance in metres
  (0.6 m per cell; the Circle and Balcony set 17 and 26 cells further back along the same ray, 10 m and 17 m up)
  to the nearest point of the 9.6 m stage lip, to one decimal: Stalls 2.3–15.6, Circle 15.8–23.3, Balcony 24.5–30.4.
- The wedge runs from the seat's centre to the lip corners (±8 cells, y = 0), the `data-stage` rect's lower edge.

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| wedge left edge (`stroke-dashoffset`, WAAPI) | first seat shown | 0–170 ms | cubic-bezier(0.22, 1, 0.36, 1) | drawn in one frame |
| wedge right edge | same | 170–340 ms | same | one frame |
| wedge fill (`opacity`) | same | 340–510 ms | same | one frame |
| wedge apex glide (frame loop) | active or hovered seat changes | 170 ms | ease-out cubic | jumps |
| readout numerals count (frame loop) | seat changes; from 0 for the first | 250 ms | ease-out cubic | final value at once |
| dialog fade (`opacity`) | dialog opens | 180 ms | ease-out | none |
| tablet Cart sheet `max-height` | content changes | 180 ms | ease-out | none |
| hover / press | pointer | instant colour change | — | same |

Nothing loops or moves on its own. Countdowns change text once a second and never read the device's date.

## States per async action (brief: Feedback states)

Every row's copy is used verbatim from the brief's Feedback states table: pending text on the acting control
(`Holding seats`, `Confirming payment`, `Joining`, `Confirming exchange`, `Confirming refund`, disabled Decline,
disabled Sign in / Publish), one announcement per result in `status "Box office updates"` on the page that acted,
Notice / Payment notice text where the row names it. Live views update silently; offers announce on every page of
the browser; hold-ended announces on every seat map page of that performance in the browser, once per hold.

## Breakpoints

768 px and 1280 px only (brief: Screens and layout).

## Media and licences

| Asset | Source | Licence |
|---|---|---|
| Fraunces variable latin (normal, italic) woff2 | Fontsource `@fontsource-variable/fraunces` 5.3.0 | OFL-1.1 |
| Public Sans variable latin woff2 | Fontsource `@fontsource-variable/public-sans` 5.3.0 | OFL-1.1 |
| seat plan, stage band, hall key, fleuron, hatch | drawn in SVG by the app | original |
