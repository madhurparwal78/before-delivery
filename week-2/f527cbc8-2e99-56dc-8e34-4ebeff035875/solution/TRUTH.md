# TRUTH — Rasp & Rein Clinchline (golden)

The brief made concrete. Every value says where it comes from: `brief: <section>` (verbatim) or `decided: <why>`
(the brief is silent; the reason ties the choice to its intent). DESIGN.md holds the full design contract; this file
is the ground truth the golden was built and checked against.

## Ground facts

| Fact | Value | Source |
|---|---|---|
| Practice | Rasp & Rein, time zone `America/Denver` (IANA name printed as-is wherever `<time zone>` appears) | brief: Seed data; Practice time |
| Password of every seeded account | `hoofcare-2026` | brief: Seed data |
| Barns | Cedar Hollow Stables 4500 ¢, Larkspur Farm 6000 ¢ | brief: Seed data |
| Price list effective 2026-01-01 | deposit 2500, trim 5500, front_reset 12000, full_reset 19000, front_new 15000, full_new 24000 | brief: Seed data |
| Test cards | `tok_approve_4242` approves (4242), `tok_decline_0002` hard `do_not_honor` (0002), `tok_funds_9995` soft `insufficient_funds` (9995); 12+ digits → 422 | brief: Test cards |
| Dunning | retries at first decline + 3, 5, 7 × `DUNNING_DAY_SECONDS`; past_due → retry_1 → retry_2 → blocked; hard → blocked | brief: Dunning |
| Allowances (capacity / refill per min) | sign_in 10/2 user, 240/120 address; hold 60/12, 300/120; payment 20/6, 100/30; upload 200/60, 400/120; vet 60/30 address | brief: Request allowances |
| Vet guess limit | 10 misses per address in a rolling 60 s, counted in Postgres | brief: Vet-link guess limit |
| Upload | chunk 1,000,000 B, session 86,400 s, visit quota 48,000,000 B | brief: Resumable uploads; Photo quota |
| Jobs | lease 30 s, backoff 5 s × 2^(n−1) up to 300 s, dead at 5 attempts; offer pass every 5 s; reminders every 300 s | brief: Jobs; Waitlist |
| Streams | `retry: 2000`, heartbeat 15 s, 1000 retained events per stream, ids contiguous per stream | brief: Live streams |
| Seeded days | Cedar Hollow `<seed date>`+14 07:30, 4×45 min, 4500, published; Larkspur `<seed date>`+21 08:00, 2×60 min, 6000, draft | brief: Seed data |
| Seed readout, Juniper LF | `Hoof wall 51.5° → 54.0° (+2.5°)`, `Pastern 56.0° → 55.0° (−1.0°)`, `Alignment broken-back → aligned` | brief: Readout lines |
| Seed readout, Juniper RF | `Hoof wall 49.6° → 50.8° (+1.2°)`, `Pastern 53.0° → 50.8° (−2.2°)`, `Alignment broken-back → aligned` | brief: Readout lines |
| Due status at start | Juniper due, Pilot overdue, Saffron and Maple current, the rest unknown | brief: Seed data |
| Hold length | `BOOKING_HOLD_SECONDS`, default 300, rounded up to the whole second, stored at hold time | brief: Bookings, Holds |
| Cutoff | exactly 24 elapsed hours before `starts_at` | brief: Practice time |
| Retry hold-off / retry interval / deadline | 20 s / ≤ 15 s (billing pass every 2 s, retry 5 s after a later failure; outbox pass every 1 s) / 45 s | brief: Billing outage; Email outage; decided: passes well inside 15 s |
| Kill Bill calls | account per owner (external key = email) with a non-default `__EXTERNAL_PAYMENT__` method; charges with ` [<invoice id>]`; purchases via account payments + `__INVOICE_PAYMENT_CONTROL_PLUGIN__` keyed `<payment id>:capture`, `<invoice id>:deposit-in`; refunds via `POST /1.0/kb/invoicePayments/{paymentId}/refunds` with `externalPayment=true`, an item adjustment for the refunded amount, and `transactionExternalKey` `<refund id>` (deposit-out leg: `<invoice id>:deposit-out`) | brief: Services, Kill Bill; decided: the external payment method is not the account default, because a default method makes Kill Bill auto-pay new invoices; read-back counts an external refund from the invoice's `refundAdj` and, per payment, from the CREDIT transactions carrying its refund keys, which is where Kill Bill records `externalPayment=true` refunds |
| Refresh | every 30 s, every 10 s while a pending row is on screen, and after every action | brief: Rail and refresh |
| Body limits | JSON 65,536 B; multipart 8,500,000 B; photo 8,000,000 B | brief: Server boundary; Hoof photos |
| Signed paths | `/media/<photo id>`, `/media/<photo id>/thumb` and `/media/<job id>/csv`, each `?k=<key id>&exp=<unix>&sig=<hex>`, plus `&v=<vet link id>` for a vet path; HMAC-SHA256 over path, key id, exp and link id; keys in `signing_keys`, a new generation once the newest is `PHOTO_URL_KEY_ROTATE_SECONDS` old, a retired key deleted once its latest signed `exp` has passed | brief: Photo URLs; decided: the export download uses the same signed `/media/` form, because the server serves only signed paths under `/media/` |
| Vet live pair | the horse's two most recent visits not `open` (business date, then creation), read at every vet read, list, view row and photo-path check | brief: Vet links, Live pair |
| Session lifetime | until sign-out on any instance; the cookie asks the browser to keep it 30 days | decided: the brief names no session lifetime, and an instance with a large `CLOCK_OFFSET_SECONDS` must still honour another instance's session |
| Cancellation instant | `decided_at` is the request's instant, stored on the booking; verdict, deposit outcome, refunded amount and the refund ledger instant all read it | brief: Bookings, Cancelling; DP-105 |
| Allowance lead | Retry-After and RateLimit-Reset add max(0, stored instant − this instance's now) | brief: Request allowances, Across clocks |

## Journeys (ideal end-to-end flow)

### 1. Farrier publishes a barn day (incl. a clock-change weekend)
- Start: farrier signed in at `/`; the rail lists every non-cancelled day as `<date> <barn> <booked>/<slots>`, oldest first. (brief: Screens and layout)
- Presses **New barn day** (header) → `dialog "New barn day"`, focus on **Barn**. Trip fee prefilled from the barn (`45.00`), Slots 6, Minutes per slot 45. (brief: Interactions, Other dialogs; decided: sensible prefill, the farrier still types date and time)
- Enters the spring-forward date and `02:30` → **Save draft** → `Saving…`, then the 422 copy `That time does not exist on that date in America/Denver.` under **Start time**, tied as its description, focus on Start time. (brief: Feedback states)
- Fixes to `07:30` → `Draft saved.`; dialog closes, focus back on **New barn day**; rail shows the draft (marked "· draft"). (brief: Feedback states; decided: the draft marker)
- Opens the day → **Publish day** → `Day published.`; rail entry `<date> Cedar Hollow Stables 0/<slots>` with `aria-current="page"`; header `Cancel by <cutoff>` an hour off the start's clock time across the change. (brief: Journey 1)
- Provider end state: Postgres `barn_days.status = published`; the API prints `starts_at` with `-06:00` and the cutoff with `-07:00`. (brief: Practice time table)

### 2. Owner books by keyboard, lets a hold lapse, races for the last slot
- Owner day view: **Horse** and **Card** selects (Card options `Test card 4242 (approves)`, `Test card 0002 (declines)`, `Test card 9995 (insufficient funds)`, first preselected) above `table "Slots"`; rows show `Book <time>`, `Taken`, own horse + `Cancel booking for <horse>`, or `Confirm offer for <horse>`. (brief: Owner day view; Card picker)
- A hold authorises the price list's deposit (2500 ¢) on the card; confirm captures it (`disposition` held) and records it in Kill Bill as a deposit invoice + keyed purchase; a decline answers 402 with one declined payment row and no booking. (brief: Deposits)
- The dialog body adds `Deposit $25.00. ` after the hold sentence. Confirm plays `slot-won` on the row, shows the toast and announces once. (brief: Public screens; State-change sequences)
- Waitlist: join with the card (positions 1..n); when a slot frees (also by a lapse no job saw) position 1 gets a held offer for `WAITLIST_OFFER_SECONDS`, its deposit authorised on the card on file; a declined card removes the entry and emails `Slot offer lapsed: …`; Notices shows `A slot opened for <horse>. Hold ends at <HH:MM:SS> (America/Denver).` once per offer per page. (brief: Waitlist; Feedback states)
- Tab to **Book 07:30**, Enter → `Holding slot…` → `dialog "Confirm booking"` with focus on **Confirm booking** and the body `Hold 07:30 on <date> at Cedar Hollow Stables for Juniper. Cancel by <cutoff> or the trip share still applies. Hold ends at <HH:MM:SS> (America/Denver).` — the hold end is the server's `hold_expires_at`, never a device countdown. (brief: Public screens; Interactions)
- Tab/Shift+Tab stay in the dialog. Escape → `Releasing hold…` → `Hold released.`, focus back on **Book 07:30**. (brief: Interactions)
- Enter on **Confirm booking** → `Confirming booking…` → `Booked Juniper for 07:30 on <date>. A confirmation email is on its way.`, focus on **Cancel booking for Juniper**. Mailpit holds one `Booked: Juniper at Cedar Hollow Stables on <date>`. (brief: Feedback states; Services)
- Lapsed hold: confirm after `hold_expires_at` → dialog closes, `Your hold on <time> ran out. Pick a time again.`, focus on **Horse**, slot reads open. (brief: Interactions)
- Full day: hold answers `day_full` → no dialog, `This barn day is full. You can join the waitlist.`, focus on **Join waitlist** → `<horse> is on the waitlist, position <n>.`. (brief: Interactions; Feedback states)
- Provider end state: exactly one live booking per slot (partial unique index), waitlist positions 1..n in join order. (brief: One barn day at a time)

### 3. Barn manager prepares horses from a bookmark
- Signed-out tablet opens `/days/<id>` → Sign in form; after sign-in the browser is back at `/days/<id>` (return target kept only if it is a same-site path starting with one `/`). (brief: URLs and history)
- `table "Ready sheet"`: Time, Horse, Stall of confirmed, worked and no-show bookings only; no owner, contact or money. Another barn's day URL shows only `This barn day isn't available.` with the rail kept. (brief: Screens; Not available)

### 4. Owner cancels the evening before
- **Cancel booking for <horse>** → `dialog "Cancel booking"`, focus on **Keep booking**; body from the server preview: `Cancelling now is before the cutoff. No trip share applies.` or `The cutoff passed at <cutoff>. <horse> will still carry a trip share.` (brief: Feedback states)
- **Confirm cancellation** → `Cancelling booking…` → `Booking cancelled. No trip share applies.` or `Booking cancelled. <horse> still carries a trip share for this day.`; focus on the freed slot's **Book <time>**. Mailpit: one `Cancelled: …` with exactly one of `No trip share applies.` / `A trip share still applies.` (brief: Feedback states; Services)
- Refused (`day_started`): dialog closes, `This day has started. Ask the farrier about this booking.`, focus back on the opener, booking unchanged. (brief: Interactions)

### 5. Working the barn day
- **Start day** → `Saving…` → `Day started. Trip shares are fixed.`; a second device's press → `That change is not allowed for a in_progress day.` and its header refreshes. Shares stored once (largest remainder, ascending booking number). (brief: Feedback states; Trip-fee split)
- **Open visit for <horse>** → `Opening visit…` → `Visit opened for <horse>.` and the horse panel opens. (decided: the farrier's next step is the photos; copy names the result)
- Upload (Hoof select, Phase radios, `Photo file`, **Upload photo**) → `Uploading photo…` → `Photo saved for Left fore (after).`; 415/413/503 copies from the brief. Stored in MinIO at `visits/<visit>/<hoof>/<phase>/<photo>.<jpg|png>`, metadata stripped, orientation applied. (brief: Feedback states; Hoof photos)
- Marks: **Mark hoof wall**/**Mark pastern** arm the after photo (two clicks set start and end in photo pixels), or type the spinbuttons; **Save marks** → `Saving marks…` → `Marks saved: hoof wall 51.5°, pastern 56.0°, broken-back.`; stale → `Someone else saved marks for Left fore first. Their lines are now shown; check them and save again.`, fields switch to the stored marks, focus on Hoof wall **Start x**. (brief: Interactions, Marking)
- **Delete <hoof name> <phase> photo** deletes at once → `Deleting photo…` → `Photo deleted for <hoof name> (<phase>).`, focus on Photo file; the object, thumbnail (also one a running thumbnail job writes) and quota bytes go, and its signed paths answer 404. Closing a visit ends its live upload sessions (reservations released in the close's transaction, chunks removed before the answer; the sessions then answer `visit_closed`). (brief: Deleting a photo; Resumable uploads)
- **Close visit** (Work done checkboxes, Visit note) → `Closing visit…`, button busy → `Visit closed and invoiced: $<amount>.` or `Visit closed — invoice pending. It will be invoiced when billing is back.`. One idempotency key per close body, reused on a resend after a lost answer. (brief: Feedback states; Idempotency)
- Day sheet Visit column: `Invoice pending` → after the 20 s hold-off and once billing is back `Invoiced $<amount>`; Notices announces `Invoice for <horse> is now in billing: $<amount>.` once per page. Kill Bill holds exactly one invoice; Mailpit one `Visit summary: <horse> on <date>`. (brief: Journey 5; Reconciliation notices)

### 5b. Excusing a horse
- On an in-progress day each confirmed row on the farrier's sheet has **Excuse <horse>** beside Open visit and No-show → `dialog "Excuse horse"`, focus on **Keep horse**; body `Excuse <horse> from this day. Its trip share of $<share> moves to the horses not yet invoiced.` plus ` Its $<deposit> deposit will be refunded.` when the server's preview reports a captured deposit. (brief: Interactions, Excusing; Feedback states)
- **Excuse horse** → `Excusing horse…` → `<horse> excused. Trip shares adjusted for <n> horses.`; the row's status reads Excused in place, the changed Share cells count to their new values, the new rows appear in `table "Trip share adjustments"` (Horse, Change `+$x`/`−$x` with U+2212, Share after it, At `HH:MM:SS`), focus on the row's `link "<horse>"`. Refusals: `Every other counting horse is already invoiced. Mark <horse> no-show instead.`, `This horse can no longer be excused.`, `Start the day before excusing a horse.`; dialog closes, focus back on the opener. (brief: Feedback states)
- Provider end state: one appended `trip_share_adjustments` row per changed share in ascending booking number (`seq` 1, 2, 3 … per day, append-only by trigger); billed shares unchanged; shares sum to the fee; deposit refunded in Kill Bill before the answer; one `Excused: <horse> at <barn> on <date>` email; farrier stream: one `booking_moved` per changed row then `allocation_adjusted`; apprentice: one `booking_moved`; barn manager: one `booking_removed`. (brief: Excusing a horse; Live streams)
- A visit close reads the booking's share under the barn day's lock, so its trip item is the share at the moment the close commits. (brief: Excuse against close)

### 6. Closing the day
- **Close day** with a confirmed booking left → `Some horses are still open. Close each visit or mark the horse no-show before closing the day.`; **Mark <horse> no-show** → `<horse> marked no-show.` (decided copy); **Close day** → `Day closed.` Each late-cancelled or no-show horse with a share > 0 gets one trip-only invoice `Trip share — <barn> <date> (<horse>, no-show|cancelled late)`. (brief: Closing a day)

### 7. Owner compares and pays
- `/horses/<id>?hoof=LF`: stage on top (previous photo under, current wiped in from the left to the divider), 2×2 hoof picker beside the readout, then the visit pickers and the visit list. Divider starts at 50; keys step ±1/±10/0/100; picking another hoof or pair glides it to 50 in 440 ms while the readout numbers count; choosing a hoof replaces the URL's `hoof` without a new history entry. (brief: Interactions, Divider; Motion)
- Invoices: **Pay <horse> <date>** → `Recording payment…`, button busy+disabled, row stays `Unpaid` → 201 `Payment of $<amount> recorded.` and the row reads `Paid`; outage → `Billing is unreachable. Your payment was not recorded; try again shortly.`, row unchanged, button re-enabled with focus. Kill Bill: one external payment. (brief: Interactions, Paying)

### 7b. Dunning, dashboard, tokens
- A declined invoice payment stamps three retries; soft → `past_due` (`Payment failed: …` email and copy with `<next try>`), each failed retry steps `retry_1`, `retry_2`, `blocked`; hard → `blocked` at once (`Account on hold: …`). A blocked owner's holds and joins answer `account_blocked`; any payment clears it (`cleared`, `Payment received: …`). (brief: Dunning)
- Dashboard: Month picker and Export CSV on one line at 1280, totals left of the `Billed and collected` chart, `Daily figures` below; figures come from the append-only ledger by practice-zone month; the export job writes `exports/<YYYY-MM>/<job id>.csv` and the page shows `Export ready.` and `Download export` (a same-origin signed path). (brief: Dashboard; Ledger and dashboard)
- Paying an owner's last blocked invoice runs the offer pass in that payment's transaction on each published day where the owner waits, so the offer is in `GET /api/my/bookings` when the payment answers 201. (brief: Dunning, Unblocking)
- Prices page also lists `API tokens`: `New API token` shows the token once with `Copy this token now. It won't be shown again.`; read_only and billing scopes; revoked tokens answer 401 on every instance. (brief: API tokens)

### 8. Vet comparison link
- Farrier **Send vet link** → dialog (Vet name, Vet email) → `Sending link…` → `Comparison link sent to <email>.`; Mailpit `Hoof comparison for <horse>` with the full link and `This link works until <YYYY-MM-DD HH:MM> (America/Denver).` (brief: Services)
- `/vet/<token>`: no rail, no changing control; horse name, both dates, the stage with hoof picker and readout. Revoked/regenerated/expired → `This comparison link is no longer available.`; 429 → `Too many attempts. Try again in <n> seconds.` (brief: Feedback states)

## Palette (hex values the build uses)

| Role | Hex | Source |
|---|---|---|
| ground (bone) | `#F3ECDD` | brief: Colour roles |
| surface (sheet) | `#FBF7EE` | decided: lighter paper for ruled tables |
| sunk (rail, table head) | `#EBE2CF` | decided: the rail sits under the sheet |
| ink (text, rules, focus) | `#2A1F17` | brief: Colour roles |
| muted text | `#5C4B3D` | decided: ≥ 6.4:1 on every ground |
| tan (rules) | `#D8C8AC` | brief: Colour roles |
| control border | `#8C7660` | brief: Contrast (3:1 control borders) |
| forge (actions, current lines, active rail bar) | `#C2410C` | brief: Colour roles |
| forge text | `#A3360A` | decided: forge at text size needs 4.5:1 |
| steel (previous lines and readout) | `#3E6283` | brief: Colour roles |

## Type, space and layout

| Item | Value | Source |
|---|---|---|
| Headings, wordmark, table heads | Archivo variable (self-hosted) — h1 1.953rem, h2 1.5625rem, h3 1.25rem | brief: Type (1.25 scale) |
| Body, controls | Public Sans variable, 1rem | brief: Type (one step below the smallest heading) |
| Numerals | `font-variant-numeric: tabular-nums lining-nums` on times, dates, cycles, angles, amounts, rail counts | brief: Type |
| Spacing | 4, 8, 12, 16, 24, 32 px | brief: Density |
| Tap targets | every button, radio tile, checkbox tile and the divider handle ≥ 44×44 px | brief: Touch |
| Notices | a fixed 44 px strip under the header: a quiet `Notices` label, then the polite live region; failures get a forge left bar and `Error:` | brief: Public screens (`status "Notices"`); decided: fixed height so a message never shifts the page |
| 1280×800 | header strip; Notices strip; rail `minmax(220px, 20%)` scrolling on its own; main column scrolls on its own; the stage is the top half of the main column (width (100vh − 112 px) ÷ 2 × 4 ÷ 3), with the hoof picker and readout under it on screen | brief: Viewports; Screens and layout, Horse panel |
| 768×1024 | rail 25 %; tables keep their columns; stage spans the main column | brief: Viewports |
| 375×812 | `button "Barn days"` (aria-expanded) opens the rail as a full-width panel; table rows become stacked ruled blocks with labels; stage full width, hoof picker then readout | brief: Viewports |

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| Buttons, rail entries, choice tiles | hover / press | 240 ms tone (`background-color`, `color`, `border-color`; primary gradient `background-position`) | settling `cubic-bezier(.2,.8,.2,1)` | instant | brief: Hover and press |
| First six rows and panels | page or panel change | 240 ms rise 8 px + fade, 40 ms stagger | settling | none | brief: Page and panel change |
| Dialogs | open / close | 320 ms grow from 96 % (springy `cubic-bezier(.34,1.56,.64,1)`) / 240 ms settling close | as stated | instant | brief: Dialogs |
| Divider | key step / pointer / new pair | 240 ms settling / 0 ms / 440 ms springy glide to 50 | as stated | jump; `Divider position` radios | brief: Keyboard steps; Axis wipe |
| Readout and money numerals | value change | 440 ms count (rAF), accessible text final at once | ease-out | switch at once | brief: Numerals |
| Live rows | added / removed / moved | 240 ms fade / 240 ms fade + 120 ms collapse / 240 ms glide (FLIP) | settling | instant | brief: Live rows |
| Skeleton | load > 120 ms | 1400 ms linear shimmer, infinite | linear | still block | brief: Skeletons |
| Pending and live chips | while pending / stream open | 2400 ms gradient slide, infinite | linear | still | brief: Gradient surfaces |
| Sequences | slot-won, payment-captured, invoice-reconciled, visit-closed, dunning-cleared | 360 / 440 / 440 / 440 / 480 ms, `data-anim` while playing | settling | `data-anim` never set | brief: State-change sequences |
| Toast | each sequence | visible 4000 ms (paused on hover / focus), rise 240 ms | springy | appears without motion | brief: State-change sequences |
| Dashboard bars | month change / new data | 440 ms `scaleY` | settling | instant | brief: State-change sequences |

Gradients (palette only): rail bone→tan top to bottom; header bone→tan at 60 %→bone; primary buttons forge→60 % toward
ink with bone text; stage backing steel→ink→forge; chips bone→tan with ink text. (brief: Gradient surfaces)

## States per async action

Pending copy appears in `status "Notices"` at once and the button is busy (`aria-busy`, disabled); then the success
or failure copy replaces it. Failures carry a forge left bar and an `Error:` prefix. All copy is the brief's
Feedback states table, plus these decided lines where the brief is silent:

| Action | Decided copy | Why |
|---|---|---|
| Hold placed | `Holding <time> for <horse>.` | the brief's success is "dialog opens"; Notices should not keep saying "Holding slot…" |
| Open visit | `Opening visit…` / `Visit opened for <horse>.` | names the result before the panel opens |
| No-show | `<horse> marked no-show.` | confirms the row change |
| Start too early / publish past date | `This barn day can't start before <date>.` / `<date> has passed, so this barn day can't be published.` | guard 409s the brief names without copy |
| photo_exists | `<Hoof> already has a <phase> photo. Delete it first to replace it.` | the API's 409 needs a way forward |
| photos_required | `Upload an after photo before closing this visit.` | the API's 409 without brief copy |
| 422 summary in Notices | `Check the highlighted fields.` / `Check the highlighted lines.` | the field errors sit under each field |
| Unknown server failure | `Clinchline could not finish that. Try again.` | a 5xx is not a network failure |
| Delete photo | `Deleting photo…` / `Photo deleted for <hoof name> (<phase>).`, focus to Photo file | brief: Feedback states, Delete photo |
| Error prefix | the visible `Error:` sits beside the `status "Notices"` region, not inside it, so Notices holds exactly the brief's copy | brief: Colour roles (a text prefix, colour never the only cue) with Feedback states (the copy) |
| No-user-action notices | offers, marks saved elsewhere, the outstanding alert and reconciliations join (never replace) a message an action put in Notices within the last 10 s; a stale refusal already shows the other person's marks, so that version is not announced again | brief: Rail and refresh |
| Marks restored history focus | the restored version's history row takes focus | brief: Restoring ("focus stays on the history table's new last row") |
| Import body too large | `That file is over 1,000,000 bytes.` | the 413 the brief's import limit produces |
| Reconciliation announced within 10 s of an action's message | appended after that message (`Day closed. Trip-share invoice for <horse> is now in billing: $<amount>.`) instead of replacing it | brief: Rail and refresh ("no refresh … replaces a message the last action just put in Notices") together with Reconciliation notices (each invoice announced once) |
| Visit-closed sequence on the day sheet | the close copy (`Visit closed and invoiced: $<amount>.` or the pending copy) | the brief names the sequence on the day sheet row; it reuses the close copy |

## Breakpoints

`max-width: 1023px` (rail 25 %), `max-width: 639px` (rail panel, stacked rows). (decided: between the brief's three sizes)

## Media and licences

| File | Licence | Source |
|---|---|---|
| `app/seed/juniper-{lf,rf}-{early,late}.jpg` (1200×900) | original | drawn for this app: a side-view fore hoof whose dorsal wall and pastern axis sit on the seeded marks (`media/draw-hoof.py`) |
| `app/public/favicon.svg`, inline wordmark and horseshoe SVGs | original | drawn for this app |
| Archivo, Public Sans (latin woff2) | OFL-1.1 | Fontsource 5.3.0 packages, full OFL text in `THIRD_PARTY_NOTICES.md` |
