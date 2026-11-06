# TRUTH — Stackfire Kiln Desk golden

The brief made concrete. Every value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (ideal end-to-end flow)

### 1. Joining and logging a piece
- Start: owner Rowan (ember-lane) sends an invite from Settings ("Invite email", Role "Member").
  Settings status: "Invite created for <email>; the email is on its way." Mailpit holds
  `Join Ember Lane Clay on Kiln Desk` from `desk@kilndesk.example` with
  `http://<host>/invite/<token>`. (brief: Services — Mailpit; Feedback states)
- The member opens the link: panel shows "JOIN EMBER LANE CLAY" and the invited email; fills
  "Your name", "Studio handle", "Choose a password", presses Join studio ("Joining…") and lands on
  `/pieces` signed in. (brief: Public screens and controls)
- Log a piece: Title, Clay body, Length/Width/Height (in). 330 ms after the last dimension change
  the Quote region shows e.g. "173.25 CU IN", "BISQUE $5.20", "GLAZE $10.40" for 5.2 × 4.1 × 7.0
  (brief: Fee quote; Interactions — Quote while typing). Empty or invalid → "Quote unavailable —
  check the dimensions."
- Attach a photo, Log piece ("Logging piece…"): POST /api/pieces, then PUT photo, then the
  passport. End: My pieces lists it "Logged"; passport shows the photo and the frozen quote;
  MinIO holds `studios/<studio>/pieces/<piece>/<uuid>.png`. (brief: Journeys 1; Services — MinIO)

### 2. Intake check-in
- Tech Ines opens Intake; "Check in <title>" ("Checking in…") → "<title> is on the waiting for
  bisque rack."; the row leaves Logged and the ticket appears on the planner rail for a bisque
  load. No photo → "<title> needs an intake photo before check-in." (brief: Feedback states)

### 3. Building a bisque load
- Planner → New load dialog (Kiln, Firing radios, Create load) → load "North Kiln · Bisque ·
  Planning" with one empty deck (headroom 26.375 IN). (brief: Loads and decks)
- Drag a ticket (> 4 px) onto a deck, or select it and use Place piece → Deck listbox → Confirm
  placement. Tall Vase alone on deck 1 of North Kiln: POST 12.0 IN, deck height 12.625 IN,
  HEADROOM 14.375 IN, FOOTPRINT D1 7.2%, LOAD VALUE $9.49. (brief: Loads and decks example)
- Too tall → hatched orange overlay on the deck with "Too tall for this stack: headroom would be
  <x.xxx> in.", ghost springs back, Planner status announces it. Taken by another tech →
  "Taken: <title> is already in another load.", TAKEN tag, ticket leaves the rail 3.4 s later.
- Mark loaded → "Load is now Loaded."; a reload shows the same decks. (brief: Journeys 3)

### 4. Firing and unloading
- Start firing → "Load is now Firing." (static orange FIRING tag); Start cooling → "Load is now
  Cooling."; Unload dialog with an outcome radiogroup per piece preset Intact; Confirm unload
  sends one request with the key made when the dialog opened.
- End: "Unloaded. <n> charges settled; receipts follow by email." Each intact or cracked piece
  has one Kill Bill PURCHASE `kd-charge-<charge id>`, one ledger pair and one
  `Firing receipt: <title>` email; damaged pieces are not charged. Kill Bill down → "Unloaded. <n>
  charges are waiting for billing and will settle automatically."; the settler retries every
  `BILLING_RETRY_SECONDS`. (brief: Unload; Pending charges)

### 5. Glaze round and pickup
- Intake "Check in for glaze <title>" → "<title> is on the waiting for glaze rack."; build, fire,
  unload a glaze load → each piece `waiting_glaze → glazed → ready_for_pickup`, pickup deadline =
  unload date + pickup window (14). One `Ready for pickup at <studio>` email per member listing
  "Collect by <Weekday D Month YYYY>"; `Pickup reminder: <title>` from 3 studio days before the
  deadline. Intake "Mark collected <title>" → "<title> collected."; passport history reads
  Collected. (brief: Pickup)

### 6. Buying credit
- Priya (card on file, opening $20.00) opens Credit: "BALANCE $20.00", Buy Credit 20 → dialog
  "Buy credit" showing $20.00 → Confirm purchase ("Processing payment…") → "Credit added. Balance
  $40.00."; Ledger shows the `member_credit +2000 / card_receipts −2000` pair; Kill Bill holds
  PURCHASE `kd-pack-<purchase id>`. No card → "Add a card at the front desk before buying
  credit." Kill Bill down → "Billing is unavailable. Try again in a few minutes; this purchase is
  never charged twice." (brief: Credit packs; Ledger)

### 7. Rate change and correction
- Rates: Effective from, four ¢/cu in spinbuttons, Schedule rates → "Rates scheduled from
  <Weekday D Month YYYY>." and the table lists it (newest start first). Earlier pieces keep their
  frozen quote everywhere. Members: search, select, Refund <title> → reason → "Refund issued.
  Balance $x.xx." (Kill Bill REFUND `kd-refund-<charge id>`, reversing pair); Adjust credit →
  "Adjustment posted. Balance $x.xx." (one pair, no Kill Bill). (brief: Refunds and adjustments)

### 8. Month-end review
- Dashboard tiles LOGGED / WAITING FOR BISQUE / BISQUED / WAITING FOR GLAZE / READY FOR PICKUP with
  counts, Longest waiting table (≤ 10, oldest first, days in studio days), PENDING CHARGES n,
  MONTH REVENUE $net. Reports: Month field → Monthly revenue; Export statement →
  `statement-YYYY-MM.csv` ("Preparing statement…" → "Statement downloaded."), formula-leading
  cells prefixed with `'`; Day field → Daily firing log cut at studio midnight. Everything is
  scoped to the owner's studio. (brief: Journeys 8; Statement CSV; Time)

## Palette (hex values the build uses)

| Role | Hex | Source |
|---|---|---|
| ground | `#14100E` | brief: Visual design — near-black, faint warm brown cast |
| ink / shelf band | `#F2ECE4` (16.1:1 on ground) | brief: Visual design — warm off-white; shelf band in the text colour |
| muted / silhouettes / dashed headroom | `#9A8F85` (6.0:1 on ground) | brief: Visual design — warm mid-grey |
| hairline / kiln outline / posts | `#3A3230` | brief: Visual design — very dark warm grey |
| accent | `#FF6A1A` (6.6:1 on ground; ground label on it 6.6:1) | brief: Visual design — one kiln orange |

## Type

| Use | Family | Source |
|---|---|---|
| headings, labels, captions, nav, buttons | Barlow Condensed 600, uppercase, slightly open tracking | brief: Visual design — Type |
| body | IBM Plex Sans 15px / 1.4 | brief: Visual design — Type; decided: 15px for compact density |
| every number | IBM Plex Mono, tabular-nums, with unit ("14.375 IN", "7.2%", "$5.20", "173.25 CU IN") | brief: Visual design — Type |
| heading scale | h3 15px (= body) → h2 20px → h1 27px | brief: "about a third larger … starting from body size" |

## Space and layout per viewport

- Grid: 12 columns, panels split by 1px hairlines, square corners, no shadows. Every control ≥
  44 × 44 px. (brief: Visual design — Density, Surfaces)
- 1280: planner rail 3 / elevation 6 / figures 3, pinned to the viewport height (rail and figures
  scroll inside themselves); My pieces 3-col; 5 tiles; Rates and Reports side by side; Members
  detail right. (brief: Screens and layout)
- 768: rail strip on top (two ticket rows, scrolls inside), elevation 8 + figures 4; 2-col cards;
  3 tiles; Members detail below. (brief)
- 375: top-bar links on a second row scrolling sideways; WAITING collapsible rail, elevation full
  width 420 px tall, figures, Decks; 1-col cards; 2 tiles; ledger as stacked label/value rows;
  passport photo first. (brief)
- Sign in / Join: a 400 px centred panel with a hairline border and the Kiln Desk wordmark.
  (brief: "narrow centred panel"; decided: wordmark)

## Motion

Easing for all: `cubic-bezier(0.16, 0.8, 0.3, 1)` (brief: "starts briskly and settles softly …
no overshoot").

| Element | Trigger | Duration | Reduced-motion substitute | Source |
|---|---|---|---|---|
| control hairline / fill | hover, press | 250 ms | none (instant) | brief: Hover and press |
| dialog | open / close | 250 ms fade + 6 px rise / fall | appears and leaves at once | brief: Dialogs |
| silhouette | placement succeeds | 330 ms from drop point (or rail ticket) to its slot; row narrows in the same motion | jumps to final | brief: Placement 1 |
| shelf lines of the deck and every deck above | taller piece lands | 330 ms, starting as the silhouette lands | jump | brief: Placement 2 |
| headroom, deck footprint, load value numerals | after the silhouette lands and the shelves slide | 480 ms count; meters set at once | change at once | brief: Placement 3 |
| removed silhouette | removal | 330 ms shrink toward the rail; decks above slide down; figures count back | jump | brief: Removal |
| refused ghost | refused or abandoned drop, Escape | 330 ms spring back to its ticket | returns at once; overlay and announcement stay | brief: Refused drop |
| TAKEN tag | piece_taken or another tech's placement | shown, dimmed, then the ticket leaves the rail after 3.4 s | same | brief: Taken — "leaves the rail 3 to 4 seconds later" |

No loops, no idle or scroll-linked motion; no single motion over 500 ms. (brief: Motion)

## States per async action

Every action disables its button and writes its pending copy to its polite live region; network
failure "No connection. Check the studio wifi and try again."; other 5xx "Something went wrong.
Try again."; 422 → field errors under their fields + "Fix the highlighted fields.". Success and
error copy is exactly the brief's Feedback states table (Sign-in, Join, Piece, Intake, Planner,
Credit, Rates, Members, Settings, Reports status). Passport photo: "Photo unavailable right now"
on `storage_unavailable`, "No photo yet" without a photo; charges read "Pending billing", "Paid
from credit", "Paid by card", "Refunded". (brief: Feedback states)

Empty lists say what will appear there in one muted line: My pieces "No pieces yet. Log a piece to
get its quote, then bring it to the intake shelf.", each Intake column (e.g. "No logged pieces.
Pieces members log appear here for check-in."), Planner figures "No load selected.".
(decided: designed empty states, workshop-plain)

## Breakpoints

`max-width: 1279px` (768 layout) and `max-width: 767px` (375 layout); 320 behaves as 375.
(brief: Screens and layout; decided: the two breakpoints sit just under the brief's widths)

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Barlow Condensed 500/600/700, IBM Plex Mono 400/600, IBM Plex Sans variable (woff2, latin + latin-ext) | OFL-1.1 | Fontsource 5.3.0 packages; hashes in `app/assets.json` |
| seeded intake photos (480 × 360 PNG: the piece's front profile to scale, in its clay colour, on a gridded measuring board; brief: "at least 64 by 64 pixels that the app draws itself") | original | drawn by the app at seed time (`src/server/db/seed-photo.ts`) |
| kiln elevation | original | SVG drawn from each load body |

## Provider records

- Kill Bill: account `kd-<member id>` (USD, name, email); payment methods `kd-<member id>-card`
  and `kd-<member id>-credit` on `__EXTERNAL_PAYMENT__`; PURCHASE `kd-pack-<purchase id>`, PURCHASE
  `kd-charge-<charge id>`, REFUND `kd-refund-<charge id>`; amounts written from integer cents.
- MinIO: private bucket, server-chosen keys, old object deleted on replacement.
- Mailpit: invite, receipt, ready, reminder, all from `MAIL_FROM`.
