# TRUTH — Boltrope

The brief made concrete. Every value says where it came from: `brief: <section>` (copied verbatim) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys

### 1. Setting up an owner (DP-13, DP-67, DP-68, DP-12)
- Start: the sailmaker is signed out on `/`. They choose `link "Open the loft"` (brief: Public screens) and sign in at `/signin` with `morwenna@tabling.example` (brief: Seed data · Accounts). They land on `/loft` (brief: Routes).
- On `/accounts` they open `dialog "New account"`, fill Display name, Email, Password, choose `Yacht owner`, press `Create account`. Status announces `Account created for <email>.` (brief: Feedback states · Success copy). Provider record: a Keycloak user with the normalised email, enabled, a permanent password and the realm role `yacht-owner`; one `account.create` audit row.
- On `/loft` they open `dialog "New boat"` and create the boat; the address becomes `/boats/B-<n>` and focus is on `heading "<code> · <name>"` (brief: Interactions · Landing routes).
- They record I, J, P, E, LL, LP with `dialog "Record measurement"`. The first entry of a dimension is not checked by the unit-slip guard (brief: Business rules · Unit-slip guard). A second I typed `488` is refused under the field with `That looks like inches. Enter millimetres.`; `12400` is recorded and leaves I Measured (brief: Journeys 1).
- A tape photograph attached to P is uploaded after the measurement is saved; a PNG sent as JPEG is refused with `That content type is not accepted here.` in the alert region and nothing is written to MinIO (brief: Business rules · Tape photographs).
- On `/stock` they press `Receive roll`, choose `C-18 · Cruising crosscut 8.6 oz`, lot `L-2614`, a length and a shelf location; status announces `Roll R-17 received.`; the dialog closes and focus lands on `button "Count R-17"` (brief: Landing routes).
- End: the boat page lists six Measured dimensions in mm and inches with the foretriangle area at poster size; the shelf grid has a card for R-17 with its lot; the ledger holds the receipt pair (`R-17` +, `supplier-receipt` −, reason `Received, full roll`).

### 2. An owner sends figures (DP-18, DP-53, DP-80, DP-14, DP-15)
- The owner signs in and lands on `/owner`. `dialog "Submit measurement"`: Dimension P, Unit `in`, Measured length `38’ 1 1/2”` (phone-curled marks), Measured on, Note, `Send to the loft`. Pending copy `Sending to the loft...`, success `Submission sent to the loft.`
- `table "My submissions"` shows `38’ 1 1/2” · 11 621 mm (457.52 in)`: the text exactly as typed, then the conversion (brief: Fields and table cells).
- In the console the sailmaker checks several pending rows and presses `Accept selected`; one request goes to `POST /api/admin/submissions/decisions`; status announces `<applied> applied, <refused> refused.`; refused rows stay with their `Result` copy.
- End: P reads Remeasure with a due date counted in loft working days; a settling figure inside the band clears the flag.

### 3. Drawing a sail (DP-24, DP-95, DP-96)
- On `/drawings/<code>/draw` the empty state `This sail has not been drawn yet.` sits on cobalt. `Draw sail` posts, announces `Sail drawn: <count> panels.`, goes to `/drawings/<code>/nest` and focuses `heading "Nest <code>"`.
- A changed P recorded on the Measure step steps the drawing back to Measuring: the rail shows Nest and Confirm as plain text and the area and panels clear.
- End: numbered crosscut panels on the cobalt canvas; the sail area at poster size in m² and ft² with its basis (rule set, formula, tolerance) beneath.

### 4. The race for the last length (DP-30, DP-31, DP-34, DP-66)
- The loft hand opens `/floor`, follows the card for BR-0141, and claims R-14's 3 200 mm. If the sailmaker's claim committed first, the alert shows `<winner display name> claimed this length first. Choose another roll or offcut.` and nothing is held; otherwise the countdown shows `Hold ends in mm:ss` from the server's `seconds_remaining`.
- The drawing pins lot `L-2614`; a claim on stock of another lot or another cloth is refused with the field copy under the stock field.

### 5. Nesting and cutting across two rolls (DP-26, DP-27, DP-28, DP-33, DP-36, DP-84, DP-87)
- Each ghost starts at the server's first-fit `next_positions` entry; keys L, R, U and arrows work anywhere in `region "Nesting"` except in a text field or an open dialog; on tablet and phone a panel is dragged onto the black strip and lands where the finger is (rounded to whole mm).
- Thread Lay: lift (120 ms), travel (420 ms, 0 or 180 degrees only), land with the panel number, then the figures and the meter count to the server value (320 ms).
- `combobox "Active hold"` lists every Held claim of the drawing, newest first, whoever holds it (brief: Option labels). `timer "Hold"` reads `Hold ends in <mm:ss>` for the selected hold, or the chip `Lapsed` (brief: Public screens · Nesting); it starts from the server's `seconds_remaining` and counts down by elapsed time (brief: Hold countdown). The page asks the server for the active hold every 5 s and reacts only when it is no longer held (decided: a release, cut or lapse by someone else must reach an open screen; a hold still held never resets the elapsed-time countdown).
- `Confirm cut` posts with an `Idempotency-Key` kept per hold in the tab; a 401 refreshes the session once and repeats with the same key; the answer is `Cut confirmed on <kind> <code>. <mm> mm (<in> in) remaining.` plus ` Offcut <code> added to the shelf.` when a tail of at least the pinned minimum becomes an offcut.

### 6. Issuing, paying, sharing (DP-45, DP-46, DP-49, DP-50, DP-93, DP-98, DP-99)
- Store down: `Issue cut sheet` answers 202; the chip reads Pending store and `region "Store outage"` carries `The cut-sheet store is not answering. This cut sheet will be issued as soon as the store is back.` in a tomato banner. The open page polls every 5 s, turns Issued in place and announces `Cut sheet issued.` once; focus stays.
- `Record payment` and `Issue credit note` show exact pence; the account lines are Cloth charge, Tax at 20%, Total, Deposit, Paid, Credit notes, Balance.
- `Grant sight` creates a grant; the owner's viewer at `/sheets/<grant id>` re-checks the grant every 5 s and shows `That cut sheet is not shared with you.` on a black field within 10 s of a withdrawal or end instant.

### 7. Running the loft (DP-54, DP-56, DP-58, DP-59, DP-40, DP-41, DP-75)
- Console tabs live in the address (`?tab=&season=`). Standing refetches on every show and announces `<n> owners in season <yyyy>.`. `Reverse <id>` opens `dialog "Reverse submission"`.
- `Count <code>` records a shelf count; a reason is required when the count differs. `/ledger?stock=<code>&cursor=<opaque>` keeps filter and page across reload, Back and Forward; a cursor from another filter is dropped with `This page belongs to another filter.`.

## Palette (brief: Visual design · Palette; hex decided)

| Role | Hex | Source |
|---|---|---|
| ground (warm off-white) | #F5F0E6 | brief: Palette; decided: hex, ink on it 16.49:1 |
| surface (pure white) | #FFFFFF | brief: Palette |
| ink (near-black) | #121212 | brief: Palette; decided: hex |
| muted (warm mid-grey) | #5C554A | brief: Palette; 6.48:1 on ground |
| cobalt (accent field, white type) | #1B3EDB | brief: Palette; white on cobalt 7.61:1 |
| tomato (the one action colour, black type) | #FF5A36 | brief: Palette; ink on tomato 6.04:1 |
| black field (strip, rail, errors) | #0A0A0B | brief: Working screens; off-white on black 17.42:1 |

## Type (brief: Visual design · Typefaces and Size steps)

- Red Hat Display 900, uppercase, for headlines and poster figures; Red Hat Text 400/500/700 for the rest; all figures tabular. Heading steps about one third larger each: h3 22.5 px, h2 30 px, h1 40 px (decided: scale 1.333); body 17 px (brief: slightly larger than a typical default).
- Poster figures about a tenth of the screen width: `clamp(48px, 10vw, 168px)` (brief: Poster figures). Hero headline about an eighth of the screen width on desktop, tightly leaded, and cropped by the right edge: 12.5vw, line-height 0.86, right-anchored so its last letter runs past the right edge (brief: Visual design · Hero; decided: 12.5vw is one eighth, and tablet keeps the desktop size because the brief names no other). On the phone the headline grows to almost a fifth of the screen width over three lines, with the label and button beneath it: 19vw, line-height 0.9 (brief: Visual design · Hero; decided: 19vw is just under one fifth).

## Space and layout per viewport (brief: Layouts by width)

| Width | Layout |
|---|---|
| 1024 and wider (desktop) | draw step: canvas about three fifths left, Sail area, status chip and controls right; nesting: canvas left (3fr/2fr), `list "Panels"` and controls right, strip full width below; shelf grid 4 columns, queue grid 3; tables keep rows on one line |
| 600 to 1023 (tablet) | canvas above strip, controls in a row under the strip, panel list a wrapping row under the controls and always open; grids 2 columns; table columns narrow and wrap |
| 599 and narrower (phone) | one column: canvas, strip, `Panels (<n> unlaid)` button with its collapsible list, controls; grids 1 column; every table row becomes a stacked card |
| all | outer margin 16 px, card gap exactly 16 px, controls at least 44 px, square corners, no hairline rules, nothing scrolls sideways except inside the roll strip |

## Motion (brief: Motion and effects; reduced-motion substitute zero seconds)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| panel outline lift | L, Lay or drop | 120 ms (scale 1.03) | cubic-bezier(0.16,1,0.3,1) | none, appears at once |
| panel travel to the strip, 0 or 180 degrees only | after the lift | 420 ms | same | none |
| remaining figures count, meter shrinks | on landing | 320 ms | same | set at once |
| refused lay | server refusal | reverses the same 420 ms path | same | none |
| step content fade out, fade in | step link or Back inside the app | 160 ms each, never both laid out | same | swap at once |
| rail marker slide | same | 320 ms | same | jumps |
| ledger rows | page load | 200 ms each, row n starts n x 30 ms after the page arrives, rows past 10 share row 10's delay | same | opacity 1, no animation |
| shelf cards that move | a cut or count reorders them | 320 ms | same | none |
| card lift | hover | 120 ms, translateY(-2px) | same | instant |
| button press | pointer down | 100 ms, background darkens | same | instant |

## States per async action (brief: Feedback states)

| Action | Pending (status) | Success (status) | Refusal (alert, black field) |
|---|---|---|---|
| Claim | `Claiming length...` | `Holding <mm> mm on <code> until <HH:MM> UTC.` | conflict, lot, cloth, length copy; 422 copy under the field |
| Lay | `Laying panel <n>...` | `Panel <n> laid on <kind> <code>. <mm> mm (<in> in) remaining.` | `Panel <n> overlaps panel <m>. Nothing was laid.` or `Panel <n> runs off the cloth. Nothing was laid.` |
| Confirm cut | `Confirming cut...` | `Cut confirmed on ...` | `Lay a panel on this hold before cutting it.`, `This hold has lapsed...` and the other cut copy |
| Issue | `Issuing cut sheet...` | `Cut sheet issued.` or the outage banner | `This cut sheet has already been issued.` |
| Owner submission | `Sending to the loft...` | `Submission sent to the loft.` | field copy under `Measured length` |
| Any save | `Saving...` | `Saved.` or the specific copy | the published refusal copy |

## Breakpoints

1024 (desktop begins), 600 (tablet begins), 599 (phone). Check sizes 1280x800, 768x1024, 375x812 and edge widths 1024, 1023, 600, 599 (brief: Layouts by width).

## Media and licences

- No image, audio, video or model file ships. Every picture (hero sail, sail canvas, roll strip, empty-state outline, favicon) is inline SVG drawn in code; the cut sheet is an SVG rendered by the server; tape photographs are the owner's own uploads streamed from MinIO (decided: no stock imagery, the brief's subject is the user's own sailcloth).
- Fonts: Red Hat Display 900 and Red Hat Text 400/500/700, latin subset, self-hosted woff2 from Fontsource 5.1.0, SIL OFL 1.1 (brief: Visual design · Typefaces; listed in `assets.json` and `THIRD_PARTY_NOTICES.md`).
- Packages: react 19.0.0, react-dom 19.0.0, pg 8.13.1 and their dependencies, all MIT or ISC.
