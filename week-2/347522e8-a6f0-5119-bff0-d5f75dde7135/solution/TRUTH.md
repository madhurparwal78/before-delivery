# TRUTH — Brigade & Bench Railside (golden ground truth)

Every value says where it comes from: `brief: <section>` (verbatim from `instruction.md`) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (start state → actions → visible and provider-recorded end state)

### 1. Apply and get approved (DP-01, DP-03, DP-04, DP-48)
- Start: visitor on `/apply`; seeded database. brief: Journeys 1.
- Fills `form "Apply"` (Business name, Your name, Email, Phone, Password) and presses `Submit application`;
  status `Application status` reads `Sending application…` while pending. brief: Feedback states.
- A duplicate email shows `That email already has an account.` beside Email and the address stays `/apply`. brief: API (applications).
- Success: `201`, `rs_session` cookie (HttpOnly, SameSite=Lax, Path=/); lands on `/kitchen`, focus on
  `heading "My kitchen"`, `status "Application status"` reads `Application received. Upload your three documents to move to review.` brief: Landing routes.
- Uploads COI, food-handler card and licence (Document type, Expiry date, Scan file, Upload document); each shows
  `<label> uploaded. It's waiting for review.` and its row reads `Waiting for review`; after the third the renter is
  `documents_review`. Objects land at `renters/<id>/documents/<doc id>.<pdf|png|jpg>` in the private bucket. brief: Services · MinIO.
- Operator signs in → `/operator`; `Review <business>` opens `dialog "Review <business>"`; `Approve <label>` ×3 (status
  `<label> approved.`), `Activate renter` (`Renter activated.`). brief: Public screens (Operator).
- Renter's next sign-in lands on `/board?date=<today>`; docket shows `Compliance: current`. brief: Journeys 1.

### 2. Buy hours (DP-06–DP-11, DP-52)
- Start: active renter on `/kitchen`; `GET /api/packs` re-asked every 15 s and on window focus. brief: My kitchen packs.
- `Buy 20-hour pack`: all Buy buttons disable, `Purchase status` reads `Processing purchase…`; `POST /api/purchases`
  with a fresh `Idempotency-Key`. brief: Feedback states.
- Server: advisory lock on renter+key → replay check → Kill Bill account `renter-<id>` (USD, default
  `__EXTERNAL_PAYMENT__`) → payment lookup/creation with external key `purchase-<renter>-<key>` (PURCHASE, 540.00 USD)
  → one transaction: purchase row, `pack_purchase` movement (`kitchen:sold` → available), queued `receipt`. brief: Purchases, Services.
- Screen: `Paid. 20.00 hours added to your balance. Your receipt is on its way.`; a `Pack purchase` row at the bottom of
  `table "Hour ledger"` with Balance = new `balance_minutes ÷ 60`; `status "Hour balance"` the same; button enabled again.
- Mailpit receives `Receipt for your 20-hour pack` from `bookings@railside.example` with amount, hours, Kill Bill payment id and new balance.
- Billing down: buttons disabled, outage copy above them and in `Purchase status`; purchase answers `503 billing_unavailable`
  within 5 s and stores nothing. When billing returns, the next check re-enables them and speaks `Pack purchases are available again.`

### 3. Claim a production day (DP-12–DP-20, DP-47, DP-53, DP-57)
- Start: active renter on `/board?date=<future day>`. Rails region: sticky ruler 00:00–24:00, five rails of 96 gridcells.
- Press on an empty point → 15-minute stub snapped to the nearest mark; drag right → end edge snaps to the nearest mark,
  ticket height 12px per 15 minutes (288px cap), hatched green buffer tail, hours = series price under the shared
  `priceBetween` definition, docket shows `(balance_minutes − price) ÷ 60`, announcer speaks
  `<station>, <start> to <end>, <hours> hours, buffer until <buffer end>.` brief: Pointer sweep.
- Stops: neighbour's range (notch + `Can't extend past <end>: another booking starts at <HH:MM>.`), six hours, 24:00, balance. brief: Pointer sweep step 4.
- Release: draft stays paper, announcer `Placing hold…`, no timer/HOLD/Pending/enabled Confirm. Accepted: orange hold under a
  paper label strip, `Hold placed on <station> <start> to <end>. Confirm before the countdown ends.`, docket live-hold line
  `Hold <station> <date> <HH:MM>–<HH:MM>`, `Pending −<held> h`, `timer "Hold countdown"` MM:SS from `hold_expires_at − server_now`.
- Lost claim: shrinks to `legal_end` (paper, waiting; press or Enter holds it) or is removed; copy per Feedback states; docket shows `balance_minutes ÷ 60`.
- Confirm booking: ticket fades to paper, focus to `button "Booking <station> …"`, `Booking confirmed. A confirmation email is on its way.`;
  one `Booking confirmed: <station> on <date>` email listing each week `<date> <start>–<end> <zone>` and `Sanitation buffer: <n> minutes, until <HH:MM>`.
- Keyboard: Tab to a grid (active cell 06:00), arrows/Home/End/Up/Down, Shift+Right/Left draft, Enter holds (focus → Confirm booking), Escape discards.
- Repeat weekly for 2–12: draft relabels `× <n> weeks`, reprices, shrinks to what the balance covers with the balance stop copy.
- Server: one transaction per claim; the `station_occupancy` exclusion constraint (btree_gist) makes concurrent overlapping claims produce exactly one winner; the losers get `409 slot_conflict` computed after the winner commits.

### 4. Cancel or be displaced (DP-21, DP-22, DP-29, DP-50, DP-51)
- Own confirmed ticket → selected in the docket → `Cancel booking` → `alertdialog "Cancel booking"` with
  `Cancelling now returns <hours> hours.` (before `cancellation_cutoff_at` by the server clock) or `… forfeits …`.
- `Yes, cancel`: ticket leaves, `Booking cancelled. <hours> hours returned to your balance.` (or the forfeit copy), focus to the rail cell at its start.
- 15-second refresh never closes the dialog, moves focus, clears a draft or selection, or changes the outcome line.
- Shift lead blocks the station: every overlapping hold/confirmed booking → `displaced`, `displacement_credit`, one
  `Booking displaced: <station> on <date>` email each; the renter's open board shows within 15 s
  `Your booking on <station> <HH:MM>–<HH:MM> was displaced by maintenance. <hours> hours returned to your balance.`

### 5. Run the shift (DP-25–DP-27, DP-49, DP-55)
- Shift lead lands on `/shift?date=<today>`; `heading "Usage sheet for <weekday> <d> <Month> <yyyy>"`; Sheet date edits push a history entry.
- Check in (Actual start prefilled with server time rounded down to 15) → `Checked in at <HH:MM>.`; Check out →
  `Checked out. Overage: <units> × 15 minutes, $<usd>.` with a Kill Bill external charge `Overage: <station> <date>, <units> × 15 min`, or `Checked out. No overage.` (no billing call).
- Block station dialog → `Station blocked. <n> bookings displaced. Affected renters are being emailed.` or `Someone is checked in on that station during that time.`
- Phone: links behind `button "Menu"` (aria-expanded), hidden and unfocusable while closed.

### 6. Keep compliance current (DP-31–DP-33)
- Scan at start and every `COMPLIANCE_SCAN_SECONDS`: expiring notice once per document (≤ 14 days, day 14 included), expired
  notice once per document, `active` → `suspended` when the COI or card is not current. Seed: Fennel suspended + expired notice; Paz and Jory expiring notices.
- A lapsed renter's `POST /api/bookings` answers `409 compliance_lapsed`; upload + approval reinstates (`suspended` → `active`).

### 7. Share compliance (DP-34–DP-36, DP-39)
- Operator creates a link (Link label, Expires after `1 day`) → `Link created. It works until <date time>.`, row `Live until <date time>`, `Copy link` writes the full URL and shows `Copied` for 2 s.
- Inspector opens `/share/<token>`: kitchen name and address, `heading "Current compliance documents"`, one heading per renter, `Expires <date>`, `Open <label> for <business>` → 302 to a 60-second presigned URL.
- Revoke → `Link revoked.`; the page reloads to `This link is no longer active` / `Ask the kitchen operator for a new link.`

### 8. Close the month (DP-37, DP-38)
- `Create statement` → `Statement for <YYYY-MM> is ready.`; PDF at `renters/<id>/statements/<YYYY-MM>-<id>.pdf`; `Download <YYYY-MM> statement`.
- Operator starts a shelf subscription (`shelf-<renter>-<n>`, plan `walk-in-shelf-monthly`, catalog uploaded when missing: product `WalkInShelf`, monthly evergreen 45.00 USD in advance) → `Shelf: <label> · billing active`; a cancellation made in Kill Bill ends it on the next renter read.

## Palette (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| Ground | `#E8E5DE` | brief: Colour roles (warm pale paper grey); decided: hex inside B1's range |
| Ink | `#1A1B1D` | brief: Colour roles (near-black) |
| Ink soft (secondary text) | `#4B4F55` | decided: AA secondary text (6.6:1 on ground) |
| Heat orange | `#E8590C` | brief: Colour roles (live holds and the now-line only) |
| Buffer green | `#1E5A3C` | brief: Colour roles (deep bottle green, hatching only) |
| Rules (steel) | `#8A9096` | brief: Colour roles (mid steel grey, 1px) |
| Steel text | `#5E646B` | decided: ruler labels at AA |
| Tickets (paper) | `#F7F5EF` | brief: Colour roles (off-white, lighter than ground) |
| Maintenance | ink cross-hatching on paper | brief: Colour roles |
| Errors | ink + 4px ink rule + Lucide `octagon-alert` | brief: Colour roles (never a new colour) |

## Type

| Use | Face | Size | Source |
|---|---|---|---|
| Product name, headings, station names | Archivo Black 400 | h1 35.5px, h2 26.6px, h3 20px | brief: Type; scale ×4/3 per level, h1 ≈ 2⅓ × body |
| Body and controls | Public Sans 400/600/700 | 15px / 1.45 | brief: Type; decided: compact |
| Numbers (hours, times, countdown, amounts, balances) | JetBrains Mono 400/700 (fixed-width, every digit the same advance) | 10–40px | brief: Type (mono under an open font licence) |

## Space and layout per band

| Band | Board | My kitchen | Operator | Source |
|---|---|---|---|---|
| Desktop ≥ 1200 | 12 columns: rails 9, docket 3; whole day fits | 3 columns (packs; ledger; documents + statements) | 2 columns | brief: Layout bands |
| Tablet 768–1199 | rails full width, whole day fits; docket below as a 2-column panel | 2 columns | stacked in order | brief: Layout bands |
| Phone < 768 | rails scroll horizontally, 44px cells, open at 06:00 (sticky 88px name column); docket below | 1 column (packs, ledger, documents, statements) | stacked; tables become cards | brief: Layout bands |

Controls ≥ 44×44px; rail cells ≥ 44px tall; ticket buttons exempt. Spacing unit 4px, gutter 16px (12px on phone). decided: compact density.

## Motion

| Element | Trigger | Duration | Easing | Reduced motion | Source |
|---|---|---|---|---|---|
| Draft width / height / buffer tail | each sweep step | 125ms | cubic-bezier(0.2, 0.8, 0.2, 1) | final size at once | brief: Sweep step |
| Hours figure, docket balance roll | value change | 125ms | same | instant | brief: Sweep step |
| Notch cut | conflict stop | 125ms | same | appears at once | brief: Conflict stop |
| Hold settle (lift 6px→0, paper→orange) | hold accepted | 250ms | same | instant | brief: Hold settle |
| Confirm fade (orange→paper) | confirm | 250ms | same | instant | brief: Confirm |
| Retract (slide up, fade) | lost claim, own ticket gone | 400ms | same | removed at once | brief: Retract |
| Button rule darken / press sink; rail hover tick | hover / press | 125ms | same | none | brief: Hover and press |
| Dialog settle | open | 250ms | same | none | decided: settle timing |
| Countdown | every second (reduced: `<n> min left` each minute) | — | — | text per minute | brief: Live elements |
| Now-line | every minute | — | — | same | brief: Live elements |

## States per async action

As the Feedback states table in the brief, word for word (`client/copy.ts` holds every string): pending copy in
the action's live region with the trigger disabled; success copy; error copy (ink, rule, icon). Unexpected
failures read `Something went wrong. Try again.` decided where the brief is silent: `slot_conflict` on Block station
reads `That station already has maintenance during that time.`; operator `invalid_transition` / `has_future_bookings`
/ shelf `already_subscribed` / `not_subscribed` have plain sentences in `Operator status`.

## Breakpoints

`< 768` phone, `768–1199` tablet, `≥ 1200` desktop; the band applies at its edges (767, 768, 1199, 1200). brief: Layout bands.

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Archivo Black, Public Sans, JetBrains Mono (woff2) | OFL-1.1 | Fontsource 5.3.0 (`app/assets.json`) |
| Lucide icons (lucide-react) | ISC | brief: Icons come from Lucide |
| Empty-state ticket spike, favicon, rails and tickets | original | drawn in code |
