# TRUTH — Longseat

The intended behaviour of the app, made concrete from `instruction.md`. Every value says where it
came from: `brief: <section>` (copied verbatim) or `decided: <why>` (the brief is silent).

## Journeys

### 1. Publish a ride (brief: Journeys 1)
- Start (brief: Journeys 1): "a driver with verified ID is signed in and has a car".
- Actions (brief: Journeys 1): "They open `Offer a ride`, choose Kestrevel and Tollemarch, add Oakhythe and Brisanne as stopovers, reorder them, remove one and undo the removal, pick a date and a time, set the seats and a price inside the range shown, and publish."
- Each action by keyboard (brief: DP-01): city comboboxes, stopovers "that can be moved, removed and restored with Undo", the date grid, departure time, seat and price steppers and booking mode, with every announcement given in Interactions.
- Provider-recorded end state (brief: DP-03): "Publishing stores a ride in state `published` with its legs, stop times and numbered seats" in PostgreSQL; version 1 (brief: Business rules, Publishing).
- Visible end state (brief: Journeys 1): "the ride page shows four stops with their times and an empty Leg Span."

### 2. Search and book a segment (brief: Journeys 2)
- Start: "a signed-in passenger on the home page."
- Actions: "They search Brisanne to Tollemarch for one seat on a date, open a result, set the Leg Span from Brisanne to Tollemarch, press `Book`, and confirm."
- Server (brief: DP-09): "In instant mode `Book` places a seat hold that lasts `SEAT_HOLD_SECONDS` and `Confirm and pay` confirms it, charging the wallet once with one wallet line and one booking email even when the same `Idempotency-Key` is sent twice."
- Visible end state: "the ride page shows `Seat booked`. The wallet has a new line. The driver's open ride page shows the seat filled, with no reload."
- Provider-recorded: hold keys `longseat:hold:<ride id>:<leg index>:<seat>` in Valkey with expiry `SEAT_HOLD_SECONDS` (brief: Services); a Mailpit email `Seat booked: <From> to <To>, <date>` whose body contains `<price> was paid from your Longseat wallet.` (brief: Services).

### 3. Request and wait (brief: Journeys 3)
- Start: "a passenger on a ride in request mode."
- Actions: "They send a request and see when it expires. The driver accepts it, or it expires because nobody answered."
- Server (brief: DP-11, DP-13): `Request to book` holds the seats, charges the wallet and shows the expiry time computed by the server; a request unanswered at "the earlier of `REQUEST_EXPIRY_HOURS` after it was made or `REQUEST_CUTOFF_MINUTES` before boarding expires on the server, refunds 100% and frees its seats, and a late accept answers 409 `request_expired`".
- Visible end state: "the passenger's open page shows that the request was accepted, or shows that it expired and the money is back in the wallet."
- Provider-recorded: the sorted set `longseat:request-deadlines` holds the booking id with its deadline (brief: Services).

### 4. Lose the last seat cleanly (brief: Journeys 4)
- Start: "two passengers on the same ride, with one seat left on the overlapping stretch. Both press `Book` at the same moment."
- Server (brief: DP-14): "exactly one succeeds and every other answers 409 `seat_taken`".
- End: "one has a booking. The other stays on the page with a message that the seat is gone, and their Leg Span shows the seat as taken."

### 5. Driver changes the plan (brief: Journeys 5)
- Start: "a ride with two booked passengers. The driver moves the departure by 90 minutes."
- End: "each passenger's open page shows the change banner and the free-cancel deadline. Each passenger gets exactly one email. The driver's notice list shows each email as queued and then sent."
- Server (brief: DP-23): a departure moved by more than `FREE_CANCEL_SHIFT_MINUTES` gives every booked passenger a full-refund cancellation until the new departure minus 2 hours.
- Mail down (brief: Services): "every save still succeeds; emails stay `queued` in the outbox and are retried on each sweep until Mailpit accepts them".

### 6. Cancel and see the rule (brief: Journeys 6)
- Start: "a passenger with a confirmed seat 20 hours before boarding."
- Actions: "They open the cancel dialog, read the exact refund, and confirm."
- End: "the wallet shows the refund line. The driver's open page shows how much they keep. The earnings statement matches."
- Tier rules (brief: Business rules, Passenger cancellation tiers): "more than `REFUND_FULL_HOURS`: 100% back"; "`REFUND_FULL_HOURS` or less, down to and including `REFUND_HALF_HOURS`: floor(paid × `REFUND_HALF_PERCENT` ÷ 100) cents back, and the driver keeps the rest"; "less than `REFUND_HALF_HOURS`: nothing back, and the driver keeps everything."

### 7. Rate after arrival (brief: Journeys 7)
- Start: "a trip has arrived. The passenger rates by keyboard and sees that ratings stay hidden until both sides are in. The driver rates."
- End: "both pages reveal both ratings together, and the driver's average updates."
- Server (brief: DP-28): "A rating stays out of every response and every page for the other side until both have rated or the window closes; then both are revealed together and live, and a member's average counts only revealed ratings."

### 8. Get verified (brief: Journeys 8)
- Start: "a new driver signs in with an emailed code and uploads an ID document."
- Actions: "The founder approves it in the review queue."
- End: "the driver's open profile announces that the ID is verified, and `Offer a ride` becomes usable."
- Provider-recorded (brief: Business rules, Uploads): "A file counts as stored only after MinIO confirms the object exists with the uploaded size." Objects at `photos/<member id>/<file id>` and `id-documents/<member id>/<file id>` (brief: Services).

## Palette roles (hex the build uses)

| Role | Hex | Source |
|---|---|---|
| page ground, "a warm putty grey" | #DAD4C8 | brief: Visual design (Colour roles); decided: hex |
| fields, banners and the bands under tables, "a slightly deeper putty surface" | #CBC4B6 | brief: Visual design (Colour roles); decided: hex |
| ink, "near-black" | #1B1915 | brief: Visual design (Colour roles); decided: hex |
| secondary text (captions, stop times, the muted half of a label), "a warm grey-brown" | #5A4F42 | brief: Visual design (Colour roles); decided: hex |
| accent, "a deep sea teal, with white text on it" | #0B5D63 | brief: Visual design (Colour roles); decided: hex |
| selected span tint | accent mixed 40% into the ground (about #87A4A0) | brief: Visual design (Leg Span) "a teal tint across the strip and the bands"; decided: strength |
| focus | thick 3px ink outline, 3px offset | brief: Interactions "a thick black outline set slightly away from the control" |

Teal appears only on "`Find a seat`, `Book` or `Request to book`, `Publish ride`, `Confirm and pay`, `Cancel booking`, `Submit rating`, `Save new time`" and on the selected span of the Leg Span (brief: Visual design). All text meets WCAG 2.2 AA (brief: Visual design).

## Type

- "Everything is set in STIX Two Text, a Times-style roman serif, falling back to Georgia and then Times New Roman. There is no second face." (brief: Visual design)
- "Headings step up by a quarter for each level. The hero headline is the largest, about three times body size." Body 18px (decided), hero 54px, h1 about 35px, h2 about 28px, h3 about 22px.
- "Figures are tabular, so times, seats and prices line up down a list. Weight is the only emphasis: the earnings totals line alone is semi-bold, and everything else is regular." (brief: Visual design)

## Space and layout

- "Comfortable and unhurried. Sections are separated by very large vertical gaps, roughly a sixth to a third of a desktop screen's height, and that includes the gaps between results groups. Every control and tap target is at least 44 pixels in both directions." (brief: Visual design)
- "A 12-column grid with side margins of about a sixteenth of the screen width." (brief: Visual design)
- Every corner square; no cards, shadows, rounded buttons, icons beyond the swap arrows and the Leg Span handles, no hairline dividers (brief: Visual design).
- Hero (brief: Visual design): headline "`Empty seats,` starts at the second column, and `long roads.` is indented to the sixth column"; a 16:10 plate "hangs from the top right"; a 4:5 plate "sits under the first line and runs off the edge of the viewport"; the only action is `Find a seat` "a teal split button made of a square label part and a square arrow part with a narrow gap between them".
- 375: the navigation collapses behind `button "Menu"`; plate widths "repeat in the pattern full width, about three quarters aligned left, about three fifths aligned right"; the `Book bar` is fixed to the bottom of the viewport (brief: Screens and layout).
- 768 and 1280: the `Book bar` sits inline beside the Leg Span; the ride plate is side by side with the Leg Span at 1280 and stacked at 768 and 375 (brief: Screens and layout).
- Results groups `Morning`, `Afternoon`, `Evening`; plate spans "alternate from group to group: a tall plate on the left third, then a very wide plate on the right half" (brief: Screens and layout).

## Motion table (brief: Motion and effects)

| Element | Name | Duration (ms) | Trigger | Reduced-motion substitute |
|---|---|---|---|---|
| Leg Span handle | `handle-snap` | 160 | any handle move: key, Home, End, drag release | handles jump to the stop; `data-motion-ms` reads 0 |
| price digits and km figure | `price-roll` | 280 | the span or seat count changes the price | changes in one step; 0 |
| overlay from the group plate to the ride plate | `shutter-reveal` | 420 | opening a ride from the results | instant swap, focus still moved to the ride heading; 0 |
| swap arrows | `swap-rotate` | 280 | `Swap cities` | the towns exchange at once; 0 |
| results | `result-reveal` | 240 | results arrive | no movement; 0 |
| seat band | `seat-fill` | 280 | a seat is taken or freed | jumps to the end; 0 |
| selected band and heading | `booking-confirm` | 420 | `Confirm and pay` succeeds | jumps to the end; 0 |
| bottom sheet | `sheet` | 280 | a sheet opens or closes | appears and disappears without moving; 0 |
| rating values | `rating-reveal` | 420 | both ratings revealed | jumps to the end; 0 |
| toast | `toast` | 200 | toast appears or leaves | appears and disappears without moving; 0 |

`data-state` reads `running` while the motion plays and `done` when it ends, or `opening` → `open` and `closing` → `closed` for sheets; it changes after the published duration on the page clock. `<html>` carries `data-motion-pref="reduced"` when the system asks for reduced motion and `full` otherwise. There is no motion on hover; hover and press only darken a control's fill (brief: Motion and effects).

## States per async action (brief: Feedback states)

- Pending: "The control that sent the request shows `Working` in place of its label and ignores presses until the answer comes back."
- Field error (422): "The message appears in the `alert`. For `validation_failed`, each field's own message also appears under that field."
- Outage (503, or a queued email): the copy "appears in a full-width banner with the `alert` role."
- Success copy is announced in `status "Announcements"` and also shown on the page; the strings are those of the brief's Feedback states section.
- Empty states, one small square plate and one sentence: `No upcoming trips.`, `No past trips yet.`, `No wallet movements yet.`, `No bookings on rides in this month.`, `No documents are waiting for review.`, `No rides match. Try another date.` (brief: Feedback states).
- Not found: heading `We could not find that page` and `link "Back to search"` (brief: Feedback states).

## Breakpoints

- 375 by 812 (touch), 768 by 1024, 1280 by 800 (brief: Browser support and performance). Decided: phone layout at 640px and below, tablet 641 to 1023, desktop 1024 and up.

## Media and licences

- "Every image is drawn in the browser by a seeded scene renderer with fine film grain." (brief: Visual design, Plates) No image file ships; licence `original`.
- Font: STIX Two Text Regular and SemiBold, latin subset, from Fontsource 5.3.0, licence OFL-1.1, self-hosted in `public/fonts/` and listed in `assets.json` (brief: Visual design, Type).
- Packages: every shipped package is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or, for a bundled font, OFL-1.1 (brief: IF-03); all packages are development dependencies bundled at build time, so the production dependency tree is empty.
