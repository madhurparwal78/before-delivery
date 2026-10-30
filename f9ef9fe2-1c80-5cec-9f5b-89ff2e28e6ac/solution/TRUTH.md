# TRUTH — Night Shift Commons Pilotlight

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` values fill
silences in the brief's intent. Money is integer cents; times are kitchen wall-clock in the kitchen's zone.

## Journeys (ideal end-to-end flow)

### 1. Brush and confirm a production run (brief: Journeys 1; DP-13..DP-16, DP-22, DP-24..DP-30)
- Start: Priya (`ember@pilotlight.test`) signed in on `/loom`; Ember & Rye has no bookings this month; papers cover to today+300.
- Priya picks a date next week (date field "Kitchen date" or Next day), presses Deck oven 1 at 04:00 and drags to Blast chiller 06:00 (end 06:15 exclusive).
- decided: a rectangle from Deck oven 1 down to Blast chiller covers every row between them in loom order, so with all stations shown it includes Convection oven; the brief's four-station example (Deck oven 1, Deck oven 2, 60-quart mixer, Blast chiller) is the brush with Convection oven hidden through Stations, and that is the flow below.
- While painting: the 36 cells show SELECTED (amber + paintbrush); each brushed station's contour lights amber 40 ms apart in row order; the rail asks `POST /api/quotes` (60 ms after the brush last changed) and counts to the server total in 330 ms.
- For the brief's four stations at 04:00–06:15 the quote is: Deck oven 1 tier 1 8 q $76.00 + tier 2 1 q $8.88; Deck oven 2 the same; 60-quart mixer $71.50 + $8.31; Blast chiller $75.00 + $8.75; total **$333.32**, `tier_steps_crossed` `[2]`; announcement "Total $333.32 for 9.00 hours. Crosses into tier 2." (brief: Monthly tiers and prices).
- Release: one `POST /api/holds`; status "Held 36 cells until HH:MM kitchen time."; cells HELD (amber frame + clock, 200 ms fade); progressbar "Hold time left" counts down from 600 s with "held until HH:MM"; the address becomes `/loom?date=…&hold=<id>`.
- Confirm booking → dialog "Confirm booking" (focus on Confirm) with date, stations and times, lines, total and cancellation window (72 hours) → Confirm → `POST /api/holds/:id/confirm` with an `Idempotency-Key` and `quoted_total_cents` 33332.
- End: status "Booking PL-000003 confirmed. Confirmation sent to ember@pilotlight.test."; cells BOOKED (ink + check, 560 ms settle); Kill Bill account `mem-ember` holds one invoice of 8 external charges `PL-000003 · Deck oven 1 · tier 1 · 2.00 h` … totalling $333.32; Mailpit holds one message "Booking PL-000003 confirmed — Night Shift Commons" to ember@pilotlight.test; Bookings lists PL-000003 and Billing lists INV-000001 with Billing amount $333.32.

### 2. Two members race for the blast chiller (brief: Journeys 2; DP-20, DP-22)
- Saltline and Wren both brush Blast chiller 05:00–07:00 on the same date and release within the same second.
- Server: each hold claim takes `pg_advisory_xact_lock(hashtext('kit-nsc:<date>'))`, so exactly one `POST /api/holds` gets 201; the other gets 409 `cells_taken` with all 8 cells in `taken`.
- Winner: "Held 8 cells until HH:MM kitchen time." Loser: the 8 cells flip to TAKEN (hatch + lock, 200 ms), the Blast chiller contour dims to steel, the total counts down to $0.00, status "Those cells were just taken. Nothing was held."

### 3. Pay with pack hours, then cancel in window (brief: Journeys 3; DP-31..DP-37)
- Ember has the seed purchase (80 quarters, 20.00 hours). On Billing, Buy 20-hour pack → `POST /api/members/mem-ember/packs` → status "20-hour pack added. Balance 40.00 hours."; movement purchase (`member_pack` +80, `pack_sales` −80); invoice kind `pack` $560.00; Kill Bill charge `INV-… · 20-hour pack`.
- Priya brushes a block, ticks Use pack hours (rail and dialog share it), places the hold and confirms; the hold's pack price comes from `GET /api/holds/:id?use_pack=true` (decided: the confirm needs a quoted total for the box ticked). Pack lines read "pack"; a draw movement (`member_pack` −n, `hours_used` +n) appears and the balance falls.
- A week before the date, on Bookings → the booking's detail panel → Cancel booking → dialog "Cancelling now refunds <hours> pack hours and $<amount>." → Yes, cancel.
- End: state `cancelled_in_window`; refund movement reversing the draw; Kill Bill account credit "<ref> cancelled in window" when the cash total is above zero; Mailpit "Booking <ref> cancelled — <hours> pack hours refunded" (body says "cancelled in window"); status "Booking <ref> cancelled. <hours> pack hours and $<amount> refunded."; the cells are free.

### 4. Raise the rates from a date (brief: Journeys 4; DP-38..DP-40)
- Dana on Rates fills New rate card (dollars typed, e.g. "40.00"; each station's surcharge; window hours; pack price) and presses Add rate card → "Rate card added. It applies from <date>." The Rate cards table lists both, newest effective date first, with In force on the card whose `effective_from` is the latest on or before today.
- Bookings store `rate_card_id` and `cancellation_window_hours` at confirm; their lines, totals, invoices, cancel preview and outcome keep those terms. Quotes always price with the card in force today.

### 5. Weekly Tuesday 04:30 bake slot (brief: Journeys 5; DP-41..DP-43)
- Priya brushes Deck oven 1–2 04:30–06:30, presses Repeat weekly, sets Weeks 4 → `POST /api/series/quote` lists each week's date and total and the series total → Book series → `POST /api/series` (Idempotency-Key).
- End: four bookings, each starting 04:30 kitchen time (the UTC instant shifts by an hour across the March change; quarters equal); one invoice kind `series`; one Kill Bill invoice; one email "Weekly series PL-a to PL-d confirmed — Night Shift Commons" listing all four; status "Booked 4 weekly slots, <first date> to <last date>."
- decided: the member's own live hold on the series cells does not block the series and is released in the same unit (brief: "If the block is held, the hold is released once the series is booked").

### 6. Keep papers current (brief: Journeys 6; DP-44..DP-50)
- Tidewater's insurance expired yesterday → `covered_until` null → every loom cell is PAPERS (dots + warning-file); brushing shows "Your papers do not cover <date>. Upload a current insurance certificate and food-handler card to book this day." (brief: Feedback states, brush covering papers cells); releasing or Enter removes the papers cells, leaves none, sends nothing and shows "Nothing free to hold in that brush." (brief: Interactions, pointer step 3).
- Aoife uploads a PDF on Papers (Document type, Expiry date, File) → "Uploaded Insurance certificate. It counts once the kitchen verifies it."; object `documents/kit-nsc/mem-tidewater/<doc id>` in MinIO.
- Dana: Papers → Documents to review → Verify → "Verified Insurance certificate for Tidewater Granola." Covered dates now show free cells.
- Wren's certificate (today+10) reads expiring; within 60 s of boot (scan every 20 s, and right after any verify) one email "Insurance certificate for Wren Street Dumplings expires <date>" goes to wren@pilotlight.test and one to operator@nightshift.test; a `reminders` row per recipient keeps it to once.

### 7. Run the day with billing down (brief: Journeys 7; DP-51, DP-52, DP-59, DP-60)
- Billing unreachable: banner "Billing is unreachable. Confirming, cancelling, recurring slots and pack purchases are paused. Brushing and holds still work."; `GET /api/status` → `paused` = confirm_booking, create_series, cancel_booking, buy_pack; Confirm booking, Repeat weekly, Cancel booking and Buy 20-hour pack are disabled; a confirm through the API answers 503 `billing_unavailable` and releases the hold.
- Dana: Bookings → Date today → a booking → Check in ("Checked in Saltline Catering.") → Mark completed ("Marked PL-… completed.") → another → Mark no-show ("Marked PL-… as a no-show.").
- Billing back: within 10 s the probe marks it up; banner "Billing is back. Paused actions are available again." for 10 s; controls re-enable; no restart.

### 8. Reconcile a month (brief: Journeys 8; DP-55, DP-57, DP-58)
- Ines signs in and lands on Reports; Month defaults to the current kitchen month and loads Usage by member, Station occupancy and Invoices (with Billing invoice id and the live Billing amount); Download CSV fetches `pilotlight-usage-kit-nsc-<YYYY-MM>.csv` with header `invoice_ref,kind,member,booking_ref,date,station,tier,paid_by,hours,amount`.
- `GET /api/kitchens/kit-lark/reports/usage` answers 404 `not_found`; nothing of Larkspur appears.

## Palette (brief: Visual design; hex decided)

| Role | Hex | Use |
|---|---|---|
| ground | `#15120F` | page ground (R 21 > B 15) |
| ink | `#EEE7DB` | text, booked fills, focus ring |
| steel | `#8FA19A` | rules, contours, secondary text, taken hatch, papers dots |
| steel-rule | 65 % steel in ground (≈ `#616A65`) | grid and control boundaries (3.3:1) |
| amber | `#F4AE3F` | selected, held frame, countdown, lit contour, quote total, owed totals, primary button |
| coral | `#FF7D68` | conflict cross-hatch, errors, invalid fields, outage rule |

Contrast on ground: ink 15.2, steel 6.9, amber 9.75, coral 7.45; ground on amber 9.75.

## Type (brief: Type)

Instrument Serif 400 for titles, quote total (45.8 px, the largest text) and pack balance; Inter 400/600 body
15/22 px; JetBrains Mono 400/500 with lining tabular figures for every price, time, hour count and reference;
ratio 1.25 (12 → 15 → 18.75 → 23.4 → 29.3 → 36.6 → 45.8 px). Run labels and legend: 12 px mono uppercase.

## Space and layout per viewport (brief: Screens and layout)

| Viewport | Layout |
|---|---|
| 1280×800 | floor-plan band 20 vh; loom left, rail 25 % right; secondary screens one 72 rem column |
| 768×1024 | band 16.7 vh; rail full width below the loom; tables keep all columns; nav wraps beside the brand |
| 375×812 | band 12.5 vh strip (contours only, names in accessible names); Menu button opens the nav; rail is a fixed bottom bar (total + Show quote) that opens as a sheet; tables become stacked label/value cards |

Loom rows 44 px and columns 44 px under `pointer: coarse`, 32 × 30 px on fine pointers; station labels sticky at the left inside the scrolling frame.

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| brush cells | pointer / Shift+arrows | 0 (same frame) | — | same |
| contour lighting | station joins / leaves the brush, refused | 200 ms, 40 ms stagger (reverse order when dimming) | `cubic-bezier(0.45,0,0.55,1)` | instant, no stagger |
| quote total | new server quote | 330 ms count | same ease | jumps to the figure |
| held frame | hold placed | 200 ms fade | same ease | instant |
| countdown bar | every second | 1 s linear steps to expiry | linear | hidden; "held until HH:MM" |
| lost cells | refused by the server | 200 ms | same ease | instant |
| confirm settle | booked | 560 ms | same ease | instant |
| dialogs, sheet | open / close | 200 ms in, 100 ms out (fade + 6 px rise) | same ease | instant |
| service banner | outage / recovery | 200 ms slide | same ease | instant |
| press | button down | 0 | — | same |

## States per async action (brief: Feedback states)

Every pending action disables its button and keeps its name. Copy exactly as the brief's table; the
regions are `status "Loom status"` (loom), `status "Form status"` (other screens), `alert` (sign-in),
`group "Quote total"` + `status "Quote announcement"` (quote) and `status "Service status"` (banner).
decided: a failed `GET` of a hold during expiry drops the hold silently (the brief says the bar is gone and the cells free).

## API decisions (brief silent)

- decided: own live hold cells count as taken for quotes and holds (brief: Holds "including the requester's own").
- brief: Booking horizon and cell checks "Duplicate or off-grid cells, or stations of another kitchen, are answered `validation` on `cells`." A series `station_ids` entry outside the kitchen is the same cell check, answered `validation` on `station_ids` (decided: the series body names its stations in that field). A `member_id` of another kitchen or member answers 404 `not_found` (brief: Roles).
- decided: quotes apply horizon and grid checks only; same-day and in-past refusals belong to holds and series (endpoint table).
- decided: cancellation emails are staged before billing and accepted last; if SMTP refuses the final accept after an in-window credit, a compensating charge "<ref> cancellation reversed" restores the balance (Kill Bill credits cannot be voided).
- decided: CSV pack rows use `paid_by` cash and `hours` 20.00; `refunded_cents` is cash refunded on in-window cancels of bookings dated in the month.
- decided: `GET /api/bookings?date=` is the day sheet: bookings on that date except in-window cancellations (they freed their cells and owe nothing); without `date` the list holds every booking, cancellations included, so a member sees a cancelled booking's state.
- decided: `billing_amount_cents` is the Kill Bill invoice `amount` (credits applied to an invoice do not change its amount).

## Breakpoints

`max-width: 1023px` (rail below), `max-width: 767px` (strip band, Menu, bottom sheet, card tables).

## Media and licences

No images, photographs or illustrations; the floor plan is drawn by the app. Fonts self-hosted woff2
(OFL-1.1, `app/assets.json`), Lucide icons (ISC) inline and as CSS masks. Notices in `app/THIRD_PARTY_NOTICES.md`.
