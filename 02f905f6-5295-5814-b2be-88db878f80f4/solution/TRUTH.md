# TRUTH — Brickfield Lane Clayhouse Shelfmark (golden, iteration 3)

The brief made concrete. `brief: <section>` = copied from `instruction.md`; `decided: <why>` = the brief
is silent and the choice follows its intent.

## Journeys, end to end

### 1. Member logs a piece (DP-12..21)
- Start: Priya Halvorsen (`priya@brickfieldlane.example`, M104) signed in, no pieces. brief: Journeys 1
- `/intake` shows `heading "Log a piece"`, form with Rectangular and `in` preselected (decided: Rectangular
  is the most common bench piece; brief: Units "Inches selected at start"), Fee panel reading
  `Fee appears when every size is filled in`. Accept and charge is disabled.
- Types 4 / 3.2 / 4.9: 250 ms after the last keystroke (decided: within the 1 s budget) the panel reads
  `Working out the fee…` then `Fee $4.41 for 70.000 cubic inches`; the panel lists `4.0 in × 3.5 in × 5.0 in`,
  `70.000 in³`, `$0.0700 per in³`, `10%`, `$3.00 not needed`, `$4.41`. brief: Business rules — Fee example
- Switches to cm: fields become 10.16 / 8.13 / 12.45; back to in: 4.00 / 3.20 / 4.90; the fee stays $4.41.
  brief: Interactions — Intake form
- Chooses Brickfield Buff Stoneware, Bisque and glaze, Cone 6; takes a photo (`capture="environment"`).
  `status "Photo upload"`: `Uploading photo…` → `Photo attached` only after the server read back the stored
  object's size; the stored photo is shown from `/api/photos/<id>`. brief: DP-15
- Accept and charge (enabled once photo attached and fee shown) → `Saving photo, charge and receipt…` →
  `Piece 0401 accepted. Receipt sent to priya@brickfieldlane.example.` The form resets.
- Provider end state: piece 0401 `queued` (`Waiting for kiln`), fee frozen at 441 cents with rate set 1;
  MinIO `photos/<id>` = exact bytes and content type; Kill Bill `member-M104` has one invoice with external
  charge `Firing Piece 0401` $4.41; Mailpit has `Intake receipt: Piece 0401` from `MAIL_FROM` listing sides,
  70.000 in³, rate 0.0700, 10%, minimum, `Fee $4.41`.
- Failures: 422 → linked `alert` `Check these fields`, messages beside fields; 503 → the step copy in
  `Intake result`; a retry reuses the Idempotency-Key until the form changes. brief: Feedback states

### 2. Owner changes rates (DP-22..24)
- `/rates` form prefilled with the rate set in effect and today's studio date (decided: today comes from
  the server's `Date` header, never the device clock). Save → `Rates saved. They apply to pieces accepted
  from <date>.`; history row added (newest effective date first), `In effect` badge on the current set.
- A past date → `Choose today or a later date` beside the field; the same date twice → `Rates already set
  for <date>.` Quotes and intakes use the newest set with effective date ≤ studio date; accepted pieces keep
  their frozen sides, cubic inches, fee and `rate_set_id`.

### 3. Kiln tech packs and fires a load (DP-25..42)
- `/board?kiln=annie`: rail (Big Annie / Little Ned with status label + cone glyph), centre (layer tabs,
  `Layer height <h> in` / `Layer empty`, `meter "Load fill"` `Load <fill>% full`), shelf drawing, placement
  panel slot, firing strip; ticket column of stubs, oldest first.
- New firing → dialog `New firing`, Profile `Bisque cone 04` → `Firing created with Bisque cone 04.`
- Pick a stub → footprint lifts (160 ms) at the first clear half-inch position; panel `Placing Piece n`
  opens (rises 12 px, 260 ms) and takes focus. Arrows / Move buttons glide ½ in (140 ms); R / Rotate turn
  90°; X, Y, Rotation fields move it. Each position shows solid ink + `Position clear`, or hatched oxblood +
  the refusal copy beside the footprint and in the panel (checks from `src/shared/rules.ts`, the same module
  the server uses).
- Enter / Place → server decides; success announces `Placed Piece n on layer l. Load f% full.`, the
  footprint settles (260 ms), the stub collapses out (260 ms), the fill counts through whole percents (600 ms).
  Refusal → `Not placed: <reason>.`; network → `Not saved — the studio server is unreachable.`
- Start firing → `Firing started. Unload opens <label>.`; `status "Firing status"` shows `Firing`,
  `Firing ends <label>`, `Unload opens <label>`; Unload stays `aria-disabled` with `Kiln still firing` /
  `Kiln still cooling · Unload opens <label>` beside it until a refresh (every 5 s) reports `unloadable`.

### 4. Unload and pickup (DP-43..45, DP-53)
- Unload firing dialog: `Pickup shelf` (uppercased as typed), per piece `Report damage on Piece n`, then
  Glaze run / Crack, `Damage photo for Piece n`, `Damage note`. Confirm → `Firing unloaded. Pickup notices
  are on their way.`
- Pieces whose plan ends here → `ready` with shelf and `ready_at`; bisque-and-glaze pieces after bisque →
  `queued`, stage `glaze`. Ready notices (`Ready on pickup shelf: Piece n`, first heading `Your piece is ready
  on the pickup shelf`, `Pickup shelf B3`, tracking URL for guests) leave through the outbox.
- `/pickup` table (Piece, Owner, Shelf, Days waiting, Status); `Mark Piece n collected` →
  `Piece n marked collected.` Reminder at 14 studio days, `uncollected` at 21 (sweeper every 4 s).

### 5. Guest drops off and pays (DP-46..48)
- `/counter` `form "Guest drop-off"`: Guest name, Guest email + intake fields; guest pricing (no discount).
  Log drop-off → `Piece n logged for <name>. Amount due $4.73.`; card `article "Drop-off Piece n"` with
  `Amount due $4.73`, `Owed`, Take payment.
- Kill Bill: account `guest-<n>` (name, email, USD), invoice with `Firing Piece n`; receipt with
  `Amount due $4.73` and `Track your piece: <APP_PUBLIC_URL>/track/<token>` (192-bit URL-safe token).
- Take payment → `Recording payment…` (button disabled) → invoice PURCHASE with `externalPayment=true` →
  `Paid $4.73 — Piece n is in the queue.`, badge `Paid`, piece `queued`. Billing down →
  `Payment not recorded — billing is unreachable. The piece stays Owed.`

### 6. Guest follows the piece (DP-49..52)
- `/track/<token>`: one centred ticket, `heading "Piece n"`, status label + cone glyph, `Pickup shelf <s>`
  once ready; no header navigation, no names. Revoked, replaced, collected or unknown →
  `This tracking link is no longer active.` Any non-GET → 405.

### 7. Owner settles a glaze run (DP-55, DP-56)
- `/studio` Damage reports → `Review Piece n` → dialog with intake and unload photos side by side (stacked
  below 600 px), uncropped on the mat with mono captions; `Shelf charge ($)` → Confirm and charge →
  `Shelf charge of $60.00 posted to Priya Halvorsen.`; Kill Bill external charge `Shelf damage Piece n`;
  report `Charged`. Waive → `Damage waived for Piece n.` Settled → `This report is already settled.`

### 8. Owner's weekly review (DP-57..60)
- `/studio`: Amounts owed (members always, guests while owing, read live from Kill Bill), Kilns
  (`Load f% full` / `No load`), Awaiting pickup (count of `ready`), Damage reports.
- `Record payment from Priya Halvorsen` → `Recording payment…` → one account PURCHASE for the whole balance
  plus the same amount as account credit (decided: Kill Bill's pay-all makes one payment per invoice; this
  is the only way one PURCHASE settles every open invoice) → `Recorded $x from Priya Halvorsen.` → `$0.00`.
- Billing down: `alert` `Billing is down — we can't show what's owed right now.`, no amounts; fill and
  pickup figures still show; My balance reads `Balance unavailable while billing is down.`

## Palette (brief: Visual design — Colour roles; values decided)

| Role | Hex |
|---|---|
| ground (bisque) | `#F3E6D3` |
| surface (inputs, cards, dialogs) | `#F8EEDF` |
| sunk (rail, table heads, shelf face) | `#EADAC2` |
| photo mat | `#E6D3B8` |
| ink (umber) | `#3B2A1E` |
| muted ink | `#6B5444` |
| hairline | ink at 24 % |
| control edge | `#8A6F5A` |
| accent (terracotta) / pressed | `#9E4321` / `#85371A` |
| celadon (fired, done, paid) | `#375E4C`, tint `#D5E0CF` |
| hazard (oxblood) | `#7A1F23`, tint `#EFD5CC` |

## Type, space and layout

- Fraunces 600 headings, h1 39.06 / h2 31.25 / h3 25 / h4 20 px (each a quarter larger); IBM Plex Sans 16 px
  body; IBM Plex Mono tabular for every number, always with its unit. brief: Visual design — Type
- 4 px spacing grid, 44 px minimum targets (placed footprints exempt), 1 px hairlines, 3 px radius, no
  shadows except the lifted footprint. brief: Density, Rules
- Board ≥ 1024: rail 176 px | shelf + 256 px panel | tickets 272 px; 600–1023: kiln link row, shelf full
  width, panel below, tickets below; < 600: `combobox "Kiln"`, `Previous layer` / `Layer n of N` /
  `Next layer`, one layer, panel below, tickets below. brief: Screens — Load board
- Intake ≥ 1024: form 2/3, Fee stub 1/3 (sticky); 600–1023: Fee panel under the header; < 600: Fee panel
  pinned to the bottom with scroll padding so the focused field stays visible. brief: Screens — Intake
- Studio ≥ 1024: Amounts owed left; Kilns, Awaiting pickup, Damage reports right; stacked below.

## Motion (brief: Motion and effects; easing decided: easeOutQuad "set a pot down")

| Element | Trigger | Duration | Reduced motion |
|---|---|---|---|
| lifted footprint scale 1→1.04 + shadow | pick | 160 ms | end state at once |
| lifted footprint translate | each ½ in step | 140 ms | jump |
| placed footprint scale 1.04→1, shadow out | place success | 260 ms | end state at once |
| stub height/opacity/translateX collapse (and reverse on return) | stub leaves / returns | 260 ms | removed / shown at once |
| `Load <fill>% full` numeral | fill changes | 600 ms, linear through whole percents | final value at once |
| shelf layer translateX ±48 px → 0 | layer change below 600 px | 260 ms | no slide |
| placement panel and dialogs rise 12 px + fade | open (dialogs reverse on close) | 260 ms | no movement |
| button background darken | press | 100 ms (stubs, footprints: instant) | none |

All tweens run on `requestAnimationFrame` against `performance.now()`. Nothing loops or idles.

## States per async action

Copy is exactly the brief's Feedback states table; pending copy is written into the same region; a region
keeps its message until the user acts again in that area (board refresh never touches it).

## Breakpoints

375 × 812 (touch), 768 × 1024, 1280 × 800; CSS breakpoints at 600 and 1024 px. No horizontal scrolling.

## Media and licences

- Fonts: Fraunces 400/600, IBM Plex Sans 400/500/600, IBM Plex Mono 400/500 — latin woff2 in
  `app/src/client/fonts/`, OFL-1.1, listed in `app/assets.json` and `THIRD_PARTY_NOTICES.md`.
- Drawn SVG (original): cone glyph, shelf drawing, empty-state shelf, line icons, favicon (inline data URI).
- No other images, audio or video ship. Photos are user uploads served from MinIO.
