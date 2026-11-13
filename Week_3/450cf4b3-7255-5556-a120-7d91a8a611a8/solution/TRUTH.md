# TRUTH — Halfsheet Works Stationhouse (golden ground truth)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

### 1. Apply and get approved — brief: Journeys 1
- Start: no account. `/apply` shows heading "Apply for a station", `form "Apply"` (Business name, Contact name, Email,
  Password), `button "Send application"`.
- A failed send (two fields) → "Check these fields" group above the form with one link per failing field
  (`<label>: <message>`), focus on the group, "2 fields need attention." announced once; a link focuses its field without
  touching the URL; everything typed stays — brief: Failures on Apply and Sign in.
- Valid send → "Sending application…" → `POST /api/tenants/apply` 201, cookie `sh_session` → `/documents` (replaces `/apply`),
  focus `heading "Your documents"`, "Status: Applied — upload your documents", copy "Application received. Upload your
  certificate of insurance and food-handler card next." Back never reopens the filled form.
- Upload insurance (limit ≥ 1,000,000, additional insured ticked) and a food-handler card → "Uploaded. <document type> on
  file through <date>." → each row shows its cover ("Valid") and the first 12 characters of the file's SHA-256 →
  "Status: Waiting for review". Provider: two private objects `tenants/<tenantId>/documents/<documentId>.<pdf|png|jpg>` in MinIO.
- The Documents page re-reads every 10 s without touching the form; a 401 mid-upload keeps a draft bound to the user id and the
  same account signing back in finds it restored with "Your upload wasn't sent. Check it and press Upload."
- Owner: Tenants → business link → `/tenants/<id>` shows two `Open` links → `Approve <business>` → "<business> approved." with
  focus on the tenant heading. End: Tenants row "Approved"; tenant Documents "Status: Approved" announced once ("Status
  changed: Approved.").

### 2. Buy an hour pack — brief: Journeys 2, Services: Kill Bill, Business rules: Step-up password check
- `/packs` → "Buy 20-hour pack" → 403 `reauth_required` → `dialog "Confirm your password"` (focus on Password) → `POST
  /api/session/confirm` 204 → the same Idempotency-Key and body are resent at once → "Recording payment…" → "Pack added: 20
  hours. Receipt on its way to <email>." A 10-hour pack needs no confirmation.
- Panel `heading "20-hour pack #1"`: "20 h left of 20 h", "Receipt email: Queued" → "Receipt email: Sent <date> <HH:MM>" in
  place; `table "Ledger 20-hour pack #1 <date>"` has one Purchase line (+20 h).
- A press that loses its answer (network, 503 purchase_pending, 409 idempotency_in_progress) keeps the attempt open with the
  "Retry purchase" tag; the next press of that button resends the same key and body; the attempt survives a reload in
  `sessionStorage` under the user's id and the page then shows the resume copy once.
- Kill Bill: account `stationhouse-<tenantId>` (name, email, USD, external default payment method, AUTO_PAY_OFF tag — decided:
  so committing the invoice never auto-pays a second time), one committed invoice with one EXTERNAL_CHARGE "Stationhouse
  20-hour pack" 480.00, one PURCHASE payment with external key `stationhouse-attempt-<attempt id>`, invoice balance 0.00.
- Mail: "Receipt: 20-hour pack" with Hours added / Amount / Invoice / Purchased lines.

### 3. Claim a station, with or without a cooler shelf — brief: Journeys 3, Interactions, Motion
- Board opens on the kitchen's today (server clock), span 09:00–12:00. Dragging on the rail changes the span; blocks rise or
  fall at once (`data-extrusion` jumps, drawn height tweens 330 ms); the cooler strip's 36 cells and the shelves-free line
  follow.
- If the floor's `spanStatus` is `started` or `beyond_horizon`, or the span is shorter than 2 h, the slab, Move booking and the
  dialog claim button are disabled and the hint shows (length hint first).
- Drag the tomato slab onto a free block (or Space → arrows → Enter, or the dialog's claim button). "Claiming <station>…";
  a tomato slab falls 120 px onto the block and rests there. On 201: block rises to its claimed height, numeral counts down,
  ticket card slides in marked "Held · N s left" (ochre), pack shows " · 2 h on hold". "Confirm booking" → "Booked
  <station> <date> <start>–<end>. 2 h debited; confirmation email on its way." Card reads "Confirmed", "Free cancellation until
  <date> <HH:MM>", and the receipt shows "Confirmation email: Queued" → "Sent <date> <HH:MM>".
- Dialog path with `combobox "Walk-in shelf"`: both blocks rise, the card adds "+ <shelf>", the pack holds twice the span's
  minutes, and a second slab falls on the shelf.
- On 409 slot_taken: slab lifts 120 px and fades (250 ms), floor re-reads, label "just taken" (tomato) for 5 s, copy "Just
  taken. Someone else claimed <station> for that span." Other refusals (not approved, documents, hours, claim limit, shape)
  return the slab, change no block and keep their verbatim copy beside the slab until the start of the next claim or move, a
  change of span or date, or leaving the Board.

### 4. Move a booking — brief: Journeys 4, Interactions: Moving a booking
- A confirmed booking more than a day away, `movable` true. The tenant picks another date and span; its card stays in the
  column. "Move booking" (press, drag > 8 px, or keyboard target + Enter) → a slab falls on the target station → on 200 the old
  block falls and the new one rises together, the card takes its new name and keeps focus, "Moved to <stations> <date>
  <start>–<end>. <No hours changed.|<d> debited.|<d> returned to your pack.>" and the receipt gains "Move email: Queued".
- 409 slot_taken: only the target station reads "just taken", the card is unchanged, focus on that station.

### 5. Cancel — brief: Journeys 5, Business rules: Cancelling
- "Cancel booking" → inline group "Cancel this booking?" described by "You'll get 3 h back." with "Keep it" (focused) then "Yes,
  cancel" → "Cancelling…" → card "Cancelled" keeps focus, "Cancelled. 3 h returned to your pack." (or the past-cutoff copy);
  station free. The cancellation line and step description follow `cancelCreditMinutes`, never the device clock.
- If the lead checked in first: 409 → card re-reads → "Checked in" + "This booking can no longer be cancelled."

### 6. Work the door — brief: Journeys 6, Door
- Lead's Board shows `region "Door list"` cards "<business> <station> <start>–<end>" with "Cleared" / "Not cleared — <reason>"
  and exactly the entry's server-computed `actions`; a confirmed entry before `checkInOpensAt` shows "Check-in opens <HH:MM>".
  The summary "Door list for <date>: <n> bookings, <m> cleared." is announced once per settled date.
- Check in → "Checking in…" through refreshes → the card turns over (WAAPI, rotateY 0→180°, perspective 800 px, 420 ms),
  `data-face` flips when it finishes, focus lands on the card: "In <HH:MM> · <staff>". The face that comes into view
  carries the new status text, door-log line and buttons; the face turning away is hidden and out of the accessibility tree
  (brief: Motion and effects, Door card turning over). Check out dialog needs "Station cleaned
  and sanitised" ticked → "Checked out. Cleanup logged." → "Completed", log "Out <HH:MM> · <staff> · cleaned". Another
  staff member's change is announced once ("<business> <station> <start>–<end>: Checked in."). Provider: one `door_log` row
  per action.

### 7. Owner's day — brief: Journeys 7
- `/report?date=D` → "Daily usage", `figure "Usage by station"` with one isometric 3-face bar per station (height round(160 ×
  minutes ÷ largest), grows over 600 ms with a 40 ms stagger), "Usage by station", "Usage by tenant", "Total booked
  <duration>"; "Daily usage for <date>: Total booked <duration>." announced once per settled date; Next day pushes `?date=D+1`; Back restores D. A paired booking counts its span
  on its station and its shelf. Tenant detail → a partly used pack (e.g. 10-hour, 450 min left) → "Refundable now $195.00" →
  "Refund 10-hour pack" → password dialog → "Refunded $195.00 to <business>." (floor(26000 × 450 ÷ 600) = 19500 cents). A changed
  amount answers 412 `refund_amount_changed` and the page shows the new amount.
  Pack "Refunded $195.00", balance 0, `refundedCents` 19500; Kill Bill one REFUND 195.00 on the pack's PURCHASE payment with
  transaction external key `stationhouse-refund-<packId>` (with an invoice-item adjustment — decided: keeps the account
  balance at 0.00).

### 8. Renew after a lapse — brief: Journeys 8
- Suspended is derived on every request (approved + a current document expired before kitchen today) — decided: one rule, no
  stored copy to drift across processes and zones. Uploading a renewal makes it "Approved" at once; the old certificate reads
  "Superseded", gets no further notices and still opens with exactly the uploaded bytes and the same fingerprint.

## Palette (decided values in the brief's roles — DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| paper ground | `#F4EFE4` | brief: Visual design (warm off-white); decided: hue 41°, L 92.5% |
| ticket stock / top faces | `#FBF8F1` | decided |
| ink | `#1E2932` | brief: charcoal, slight blue cast |
| ink-soft | `#47525C` | decided (AA 7.0:1) |
| steel hairline | `#A7ADB2` | brief: stainless-steel grey hairlines |
| steel-strong (inputs, ticks) | `#7A838B` | decided (≥3:1 UI) |
| block / bar left / right faces | `#CDD1D4` / `#AEB4B9` | brief: tone steps of the grey |
| tomato (claims, conflicts only) | `#B8341F` | brief: single tomato red |
| ochre (held cards and intervals, "on hold", "Queued", "Expires in", "Expires today") | `#8A5A12` | brief: dark ochre |

## Type, space, layout

- Archivo Narrow 600 (headings, station names, ticket titles), IBM Plex Sans 400/500/600 (body 14px), IBM Plex Mono 400/500
  (numerals, countdowns, fingerprints, door-log times); scale ×1.25: 14 / 17.5 / 21.9 / 27.3 / 34.2 — brief: Type; decided: 14px
  body for compact density. Targets ≥ 44×44 — brief: Density.
- 1280×800: grid "slab plan / column plan / rail rail", left column ≈25% scrolling on its own, rail (numerals, cooler strip)
  pinned at the viewport bottom — brief: Layout bands.
- 768×1024: slab, two-column card grid that grows with its cards (decided: every card must sit above the plan; the page scrolls), plan, rail.
- 375×812: header with kitchen name and Menu (the collapsed panel is `display: none`), slab, plan (labels under blocks), rail
  with 19 numerals at 12px and 36 narrowed cooler cells, then cards; tables become label/value rows; dialogs fill the width with
  stacked controls; the Report figure scales to fit — brief: Layout bands.
- Floor geometry (decided): stations in a screen-aligned grid of col/row cells, each drawn as an isometric box (30° axes) with an
  equipment top (burners, board, bowl, shelf slats); walk-in shelves inside a drawn cooler outline; quarry-tile floor pattern.
  Extrusion = occupied/span × 96 px — brief.
- Report bars — brief: Screens and layout, Report: one bar per station in seed order, left to right, each a three-faced
  isometric block (top, left and right faces) on a shared hairline floor line with the station name under it; height
  round(160 × bookedMinutes ÷ largest), half up, all 0 when every station has 0; one drawing unit per CSS pixel at 600 px and
  wider, scaled down uniformly to fit below 600. Decided: the same block drawing as a station, 56 drawing units wide.

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| button hover/press | pointer | 200 ms | cubic-bezier(0.2,0.8,0.2,1) | instant |
| block top face / side faces / cleanup band (CSS transform on `--h`, `--b`) | span or data change | 330 ms | same | jump |
| free-minutes numeral (`@property --free` integer counter) | span or data change | 250 ms | same | jump |
| hatch opacity | block becomes full | 250 ms | same | appears |
| slab drop (WAAPI translateY −120→0) | claim or move sent | 330 ms | same | appears in place |
| slab lift (WAAPI translateY 0→−120, opacity 1→0) | 409 slot_taken | 250 ms | same | vanishes |
| slab return (WAAPI slide to the column) | other refusal | 250 ms | same | vanishes |
| ticket card entry (WAAPI translateY −12→0, opacity) | claim 201, move 200 | 250 ms | same | appears |
| status stamp / email line colour cross-fade | Held → Confirmed, Queued → Sent | 250 ms | same | instant |
| door card turn (WAAPI rotateY 0→180, perspective 800 px) | own Check in / Check out / No-show 2xx | 420 ms | same | none: `data-face` flips at once |
| Report bar growth from a flat tile (WAAPI height, each bar 40 ms after the one before in seed order) | open, settled date change | 600 ms | same | none |
| Report bar height change (WAAPI, changed bars only, no stagger) | live refresh changing a station's minutes | 600 ms | same | none |

## States per async action — brief: Feedback states

Pending / success / rule error / outage copy for Sign in, Confirm password, Apply, Claim, Confirm, Move, Cancel, Buy pack,
Upload, Open document, Approve, Check in, Check out, No-show, Refund, floor reload and Report is in
`app/src/client/copy.ts` and the screens, verbatim. Every message in the action table is announced once in the one `status
"Kitchen updates"` region and shown next to its control, except: on Apply only the count announcement is announced for field
errors, and the Report pending copy and the Buy pending copy are shown but never announced — brief: Where messages appear.
Refreshes announce only the Documents status change, notice sent, receipt email sent, door change
and Report update. Missing records show "That record isn't available." (not announced).

## Breakpoints

599/600 (Menu disclosure and one-column cards ↔ header navigation and two-column cards) and 1023/1024 (stacked ↔ ticket-rail
grid) — brief: Layout bands. 900 (labels under ↔ beside blocks; masthead brand stacks) — decided: the plan's cells need that
width for a label beside the block.

## Server decisions

- Paired bookings: one `booking_occupancies` row per occupied station; the exclusion constraint `occupancies_no_overlap` (live
  rows only, kept in step with the booking status by a trigger) is the no-overlap rule for single and paired claims and for
  moves (a move deletes and re-inserts the occupancy rows in one transaction) — brief: Services, Postgres; decided.
- Door log: append-only `door_log` rows (a trigger refuses edits), written in the transaction of the transition, `by` = the
  acting staff member's displayName — brief: Door log.
- Sign-in limit, claim limit and the password-confirmation window are judged against Postgres now at the transaction start,
  compared at whole-second resolution (`date_trunc('second', now())`) — decided: `Retry-After` is whole seconds and every
  published time has no fraction, so a client reading the published clock sees the same edges as the server. Sign-in and
  confirmation share one failure count per trimmed, lower-cased email under a per-email advisory lock — brief: Sign-in attempts.
- "Now" for hold expiry, check-in window, no-show, the cutoff, span status and `today` is Postgres `now()` at the start of the
  transaction, read in the process's kitchen zone; `now` in /api/kitchen, /api/floor and /api/door is the same reading — brief:
  Kitchen clock.
- Hold liveness has one definition, the `bookings_now` view: from `holdExpiresAt` on, a held booking reads as cancelled/
  hold_expired in every statement, with no write needed. Every 5 s a process stores lapsed holds, and a claim or move stores the
  lapsed holds it overlaps — brief: Live holds; Hold edge for claims.
- `holdExpiresAt` is now plus the hold time — brief: Claims; decided: written at whole-second resolution, so the stored edge the
  server judges confirms and claims by is exactly the published value the countdown and DP-65's hold edge are read from.
- Overlapping claims and moves queue on per-station advisory locks taken in sorted order, so they end in the exclusion
  constraint's 23P01, never a deadlock — brief: Claims ("never answers 5xx").
- A claim's reservation on a pack and a refund of that pack are judged one after the other under the same lock — brief: Pack
  reservation; decided: the lock is taken on the pack's tenant row, because a claim chooses among all that tenant's packs.
- Cooler strip, floor and claims read one occupancy (`bookings_now` + `booking_occupancies`); `coolerFreeRows` in
  `shared/metrics.ts` is the one rule the server answers with and the browser redraws from — brief: Cooler free shelves.
- The door list shows every booking for the chosen kitchen date, cancelled ones and expired holds included (door status
  "Cancelled", no door actions) — brief: Door list clearance (DP-37), Door status texts.
- `holdExpiresAt` stays on a booking after it is confirmed — decided: the value exists, so it is not an "absent value".
- A tenant's booking list is earliest start first; bookings with the same start list the newest first — decided.
- Mail To: `"<contact name>" <email>` with `\` and `"` escaped, or RFC 2047 UTF-8 B-words (≤ 45 bytes each) when non-ASCII; From
  and the envelope sender come from `MAIL_FROM` — brief: Services, Addressing. Booking emails are found by (action, record id)
  in the mail queue, so `emails`, `receiptEmail` and notices share the one delivery-status rule — brief: Delivery status.
- Idempotency fingerprint = canonical JSON of the body (absent and null `shelfId` alike) plus the path's booking id — brief:
  Retried requests.
- One process: `node dist/server/main.js`; schema + seed under an advisory lock; lapsed holds stored every 5 s; mail delivery
  every 10 s and after actions; purchase recovery every 10 s; expiry sweep at start and every EXPIRY_SWEEP_SECONDS.
- Paid but not recorded: an attempt whose PURCHASE payment Kill Bill holds keeps its invoice and payment, and a retry with the
  same key and body finishes the pack from them — brief: Services, Kill Bill; decided: the 10 s recovery also finishes an
  attempt whose process died, under the same one-purchase-per-key rule, so a later retry replays the stored 201. An attempt with no payment
  that stopped running is settled as a billing failure: the invoice it recorded is voided, or, when it stopped before recording
  one, the account's unpaid invoices are, provided no other attempt of that tenant is running — brief: Billing failure; decided
  for the no-recorded-invoice case.
- Preact is the one production dependency (bundled into the browser build). Postgres (wire protocol, SCRAM), SMTP, SigV4 S3 and
  Kill Bill REST clients use Node built-ins — decided: keeps the shipped tree small and every licence clean.

## Browser decisions

- The clock estimate reads the `now` of the latest /api/kitchen, /api/floor or /api/door response plus `performance.now()`
  elapsed since it arrived — brief: Server clock in the browser; decided: a monotonic timer, so a wrong or changed browser
  clock cannot move it.
- Every request is tagged with the sign-in epoch it was sent under; an answer from an earlier epoch never settles its caller
  (no drawing, announcement, tag or redirect, a late 401 included) — brief: Late answers.
- Every periodic re-read goes through one `useRefresh` hook (latest run wins) — brief: Engineering standards.
- Until the chosen date's floor arrives, the last stack stays and follows the span on its own date — brief: Latest choice wins.
- The ticket column re-reads with the floor's timed reload; a hold that ran out leaves at that reload — brief: Board.
- `next` follows the five checks of Returning after sign-in — brief. Decided: rule 2 is applied to the query-string text
  and to its decoded value, since "raw value" can be read as either; a value only the stricter reading refuses could never
  pass rules 4 and 5, so the landing is the same. The app writes its own `next` with slashes unescaped, so it never trips `%2f`.
- Purchase attempts live in `sessionStorage` under the user's id and are dropped by sign-out and by a different account's
  sign-in; the upload draft lives in page memory bound to the user id — brief: Buying a pack; Interrupted upload.

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Archivo Narrow 600 (latin woff2) | SIL OFL 1.1 (brief: Working rules IF-03) | Fontsource |
| IBM Plex Sans 400/500/600, IBM Plex Mono 400/500 (latin woff2) | SIL OFL 1.1 | Fontsource |
| Lucide icon paths (inlined) | ISC | lucide.dev |
| favicon.svg, empty-state ticket stub, floor drawing, report bars | original | drawn for this app |
| preact (bundled) | MIT | npm |
