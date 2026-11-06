# TRUTH — Common Shed Co. Shedline (golden)

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` values fill silence
in the brief's intent. Implementation lives in `app/`; design tokens in `DESIGN.md`.

## Journeys (ideal end-to-end flow)

### 1. Hold a tile saw (DP-09, DP-10, DP-14, DP-15, DP-53)
- Start: Hal (member, nothing overdue, under the limit) signed in on `/catalogue` (brief: Journeys 1).
- Opens "7-inch wet tile saw" → `/items/tile-saw`: two lanes "Unit TS-1", "Unit TS-2", 28 day cells from today (library time), closed days narrow grey with sr-only "closed" (brief: Screens › Item).
- Fills Pickup date and Return date (open days; a closed or out-of-window date shows the field copy and keeps Hold a unit disabled — decided: native date input cannot disable single days). Lanes re-read with `start`/`end`; the Availability numeral jumps to `units_free` "… of 2 units free for these dates".
- Presses Hold a unit (or Enter in a date field): pending copy "Finding a free unit…", one `POST /api/holds` with a fresh Idempotency-Key (one retry with the same key on a network drop); the orange claim bar waits above lane 1.
- 201: the bar steps 140 ms per busy lane, settles 260 ms into the assigned lane, the numeral counts down over 420 ms, Claim result reads "Held unit 1 of 2, 1 units still free for these dates"; lanes re-read and the span shows "Held … · back … · yours".
- Provider state: one `hold` row `requested` on the lowest free lane; nothing in Kill Bill, MinIO or mail.
- Racing: per-item and per-member advisory locks; winners report K−1…0 (`units_free` = free units for the range before the claim minus one).

### 2. Prepare and collect (DP-16 – DP-19)
- Dev opens `/counter` → Holds to prepare lists Hal's hold → Mark ready → Counter result "Marked ready. Pickup notice queued for Hal Brennan."; the row moves to Ready for pickup with an underline sweep.
- Provider: hold `ready`, `ready_at` = now, `pickup_deadline` = now + `SHEDLINE_PICKUP_WINDOW_SECONDS` (180 s in grading); one email "Ready for pickup: 7-inch wet tile saw, unit TS-1" / "Pick up by <local time>." queued in the same transaction.
- My loans shows the hold Ready with "Pick up by <local time>" (refresh every 15 s).
- Not collected: from the deadline the hold counts as expired in every response; the worker (every 2 s, every copy, row-locked update) stores `expired` and queues "Hold lapsed: …" once; the lane frees.

### 3. Lend at the counter from two devices (DP-20 – DP-22, DP-25 – DP-28, DP-46, DP-54)
- Dev and Ines press Check out together: the hold row is locked first (`SELECT … FOR UPDATE`), then the item lock; the winner writes collected hold + loan + `deposit_hold` ledger entry and makes the Kill Bill purchase inside the transaction; the loser waits, sees `collected` and answers "This hold is collected and can't do that." with no Kill Bill call.
- Winner sees "Lent to Hal Brennan. Due Sun 1 Nov 2026, 18:00 EST." (format brief: Library calendar › Formats); focus moves to the new link under Out on loan.
- Kill Bill: account `shedline-mem-hal` (USD, name, email, default `__EXTERNAL_PAYMENT__` method); payment `shedline-<loan>-deposit` with one PURCHASE `shedline-<loan>-deposit-hold` for 50.00.
- Photos: staff choose a file in Condition photo → Add photo → "Photo saved."; type sniffed from first bytes, ≤ 5,000,000 bytes, stage from the loan's state, at most 4 per stage under the loan row lock; key `loans/<loan>/<stage>/<uuid>.<ext>`; a refused upload leaves no object and no record.

### 4. Paper-sheet loan and one renewal (DP-23, DP-24, DP-61, DP-62)
- Ines fills Walk-in loan (Member, Unit, Due date, optional Checked out at in library time) → Lend now → "Lent to Wren Kowalski. Due …"; focus to the new Out on loan link.
- Reminder: the worker inserts `(loan, due_at)` into `due_reminder` once now ≥ due_at − lead and now < due_at, queueing "Due back <local time>: …" / "Please return it by <local time>, washed out and with batteries charged."
- Wren renews on `/loans/<id>` (New due date → Renew): "Renewed. Due …"; due shows "renewed"; controls disappear; a new reminder for the new due time; a second renewal → "This loan has already been renewed once."; a blocking hold → "That unit is busy on some of those days."

### 5. Paused and at the limit (DP-50, DP-52)
- Sol with an overdue loan: hold → claim bar drops through and fades, Claim result "Borrowing is paused while an item is overdue."; walk-in refused with the same copy; check-in lifts the pause at once.
- Tobi with 4 active: "You can have at most 4 items held or out at once."; cancelling a hold, a check-in or a passed pickup deadline frees a slot instantly.

### 6. Check in, inspect and settle (DP-29 – DP-37, DP-47, DP-55 – DP-58)
- Check in with Returned at (defaults to now in library time) → "Checked in on time." or "Checked in late: N late days."; racing check-ins: one 200, others "This loan is returned and can't do that."; the loser's page re-reads and shows the inspection controls.
- Inspection: Condition OK/Damaged + Inspection note → "Inspection saved.".
- Rosa: Checkout photos and Return photos side by side; Settle → dialog "Settle loan" (Deposit held, Replacement, Damage charge "0.00") → Confirm settlement → dialog closes, focus to Receipt, "Settled. Receipt queued for <name>."
- Settlement: per-loan session advisory lock; damage charge fixed on the first valid attempt on an inspected loan; billing first (refund `…-deposit-release`, purchase `…-extra-damage`, purchase `…-late-fee`, each checked before written); then settlement row, ledger entries, status settled and the receipt email together.
- Floor sander, damage 12,000: released 0, kept 7,500, extra 4,500 (brief: Settlement › Split).

### 7. Billing goes down mid-shift (DP-40, DP-41, DP-49, DP-60)
- Counter services: "Billing offline — deposit items are blocked. Items without a deposit still lend." (probe ≤ 5 s old); deposit rows "Blocked: billing offline", Check out disabled; a sent checkout → 503 with the lend copy; the transaction rolls back (hold stays ready with its deadline).
- Settlement → 503 with the settle copy; the loan stays inspected; the same key or amount succeeds once billing returns (keys of 503 answers are released; the browser keeps the key per button and values).

### 8. Look back over my borrowing (DP-38, DP-39, DP-48, DP-59)
- `/my-loans`: first 20 holds and loans; Show more appends the next cursor page, focuses the first new row, "Showing N loans."; cursors are HMAC-signed with a secret stored in PostgreSQL.
- Another member's ids answer 404 "Not found." exactly like missing ids; the Not found page is identical.
- Cancel hold: pending "Cancelling…", row unchanged until 200; on refusal the row is re-read (e.g. Collected) and My loans status shows the refusal copy.

## Palette (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| ground | `#F3EEE3` | brief: Colour roles (warm off-white); hex decided |
| panel | `#FBF8F1` | decided: opaque boxes over the grid |
| ink | `#1A1814` | brief: Colour roles › Ink; hex decided |
| ink-soft | `#5C564C` | decided: secondary text ≥ 4.5:1 |
| accent | `#E8590C` | brief: Colour roles › Accent (safety orange); hex decided |
| free | `#1F6B3A` | brief: Colour roles › Free and available; hex decided |
| rule-grey | `#8C857A` | brief: Colour roles › Secondary; hex decided |
| dot | `#B9B1A3` | brief: Mood (faint warm-grey dots); hex decided |
| cell | `#F1ECE2` | decided: empty lane cells (3:1 with accent hatch and grey rules) |

## Type

Archivo Black 400 headings (h1 2.369rem, h2 1.777rem, h3 1.333rem — ×1.333 per level, brief: Type); IBM Plex Sans 400/600 body 16 px; IBM Plex Mono 400/600 for numerals, dates, money, unit labels and every uppercase label (13 px, +0.06em); Availability numeral 4.5rem (3.5rem under 700 px), the largest figure on Item (brief: Type).

## Space and layout per viewport

8 px rhythm; 2 px ink box rules, 1 px grey row rules, radius 0, no shadows or gradients on boxes (brief: Rules and boxes).

| Viewport | Layout | Source |
|---|---|---|
| 1280×800 | 12-column grid; catalogue 3 per row (≥ 6 cards above the fold); Item card column 4 / lanes 8; Counter three sections + Walk-in full width; My loans 5 / 7; Loan details 5 / actions 7; photo panels 6 / 6 | brief: Viewports |
| 768×1024 | catalogue 2 per row; Item card above full-width lanes; Counter two columns; My loans stacked; photo panels side by side | brief: Viewports |
| 375×812 | single column; navigation behind Menu (aria-expanded, Escape closes and focuses Menu); lanes full width with 28 narrow cells, label above strip; photo panels stacked; dialog full width with 16 px margin | brief: Viewports |

Breakpoints: < 700 px narrow, 700–1099 px medium, ≥ 1100 px wide (decided: between the brief's three widths).

## Motion

One easing `cubic-bezier(0.16, 1, 0.3, 1)` (brief: Motion — leaves fast, settles softly).

| Element | Trigger | Duration | Reduced-motion substitute | Source |
|---|---|---|---|---|
| Claim bar, pending | Hold a unit pressed | static above lane 1 | not shown | brief: Lane drop 1 |
| Claim bar, steps | 201 answer | 140 ms per lane (100 ms move + rest) | appears in its lane at once | brief: Lane drop 2 |
| Claim bar, settle | after the steps | 260 ms | appears in its lane at once | brief: Lane drop 3 |
| Availability numeral | after settle | 420 ms, one integer per step | jumps | brief: Lane drop 4 |
| Claim bar, refusal | 4xx/5xx/network | 140 ms per lane, drop below, fade 240 ms | never shown | brief: Lane drop 5 |
| Settle dialog | open / close | 180 ms rise+fade / 90 ms fade | no rise or fade | brief: Dialog |
| Buttons | press | 70 ms, sink 2 px | colour only | brief: Press feedback |
| Cards, buttons | hover (pointer only) | 90 ms rule → orange | instant | brief: Hover feedback |
| Arrived row | Counter move / Show more | 420 ms underline sweep, once | static underline | brief: Row arrival |

Nothing loops; no spinners; timers drive the drop (never scroll).

## States per async action

Pending copy and success copy exactly as brief: Feedback states (Signing in…, Finding a free unit…, Cancelling…, Loading more…, Marking ready…, Lending…, Renewing…, Uploading photo…, Checking in…, Saving…, Settling…). Errors show the API `message` in the named region; field errors sit under their fields (`aria-describedby`) and the region reads "Check the highlighted fields.". Outage banner, blocked rows and "Photo unavailable" as brief: Outage and blocked-state copy.

Decided copy (brief silent): 422 on lanes `from` — "Choose a date as YYYY-MM-DD."; unknown list `status` filter — "Choose requested, ready, collected, expired or cancelled." / "Choose out, overdue, returned, inspected or settled."; unexpected server failure — 500 `internal` "Something went wrong on our side. Try again."; empty lists "No holds yet", "No loans yet", "Nothing to prepare", "Nothing waiting for pickup", "Nothing out on loan".

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Archivo Black 400, IBM Plex Sans 400/600, IBM Plex Mono 400/600 (latin woff2) | OFL-1.1 | Fontsource 5.3.0 packages (`app/assets.json`) |
| Menu, sign-out, camera icons | ISC | Lucide path data, inline SVG |
| Empty-state pegboard hook | original | drawn inline for this app |
