# TRUTH — Nachtwit Gevelwerk

The golden's ground truth. Every value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys

### 1. Survey a new wall (DP-01 – DP-06)
- Start: `/sites` shows `<n> WALLS ON FILE` (`1 WALL ON FILE`) and `form "New site"` (brief: Screens and layout).
- Fill `Site name`, `Wall width`, `Wall height`, `Length unit` (`m`/`ft`), `Show time` (`YYYY-MM-DDTHH:mm`), press `Save site`. The call is `POST /api/sites` with an Idempotency-Key; the page stays on the list and the new wall appears as `link "<site name>"` in `table "Walls"` going to `/sites/<id>/survey` while it is unrectified (brief: Public screens). Field errors use the published copy beside the field.
- Open the survey: `NO WALL YET` with an empty slot frame. `Choose wall photo` uploads the bytes (`POST /api/sites/<id>/photo`); MinIO holds `photos/<siteId>/<sha256>` unchanged and the record is written only after size and checksum are read back. If the wall store fails the answer is `wall_store_unavailable` (503) in `alert "Outage"` and no photo is on record (brief: Photos, Services).
- `img "Upright wall photo"` shows the EXIF-oriented working copy; clicking it fills the pixels of the focused point group. Four points and a check point, `Rectify wall`: `POST .../rectification`; success writes tiles at 40 px/m and `status "Rectify"` says `Rectified to <residual> m.`; the sentence becomes `THIS WALL IS MEASURED TO <residual> M`. A refusal (`residual_too_high`, `points_degenerate`) stores nothing.
- The wall list open on another screen shows the site at once (`layout.changed` on the SSE stream).

### 2. Walk the wall without signal (DP-07 – DP-12)
- The service worker keeps the shell and survey screen; `Save reading` always queues an operation (UUID `operationId`, entered text, unit, `capturedAt`) in IndexedDB, with or without signal. `status "Sync"` reads `Waiting to sync <n>` (plus `Needs fixing <n>` and `Sending readings`). The count falls only when the server answers each operation (`applied`, `duplicate`, `rejected`, `conflict`).
- Each reading appears once in `table "Readings"` with cell, entered text and unit, canonical lux (six decimals, exact decimal arithmetic, half-even once) and captured time; open screens add it from `reading.accepted`.
- The newest `countedAt` counts (`capturedAt`, or acceptance time if the device clock is ahead). A reading set is stale at newest `countedAt` + `READING_STALE_SECONDS`; cells still compute and the stale sentence shows under the heading.

### 3. Manage the shelf (DP-13 – DP-17)
- `/kit`: `THE SHELF HOLDS <free> FREE BODIES` (`1 FREE BODY`). `Record a movement`: Bought (needs Model, optional Starting hours), Sent to site, Returned, Retired. Each movement writes one pair of entries (−1, +1); `Reverse <movementId>` posts a reversing movement; `Older movements` appends the next keyset page. `Log show hours` adds hours (above 0 up to 1000) and derates the body linearly to 50% at its rated hours.
- Shelf, layout picker and the shelf sentence read the same fold of the journal and sheet bindings, on every process, and refresh on `kit.moved`.

### 4. Lay out and prove the wall (DP-28 – DP-37)
- `/sites/<id>/layouts/<id>?cell=<cell>`: `grid "Wall cells"` (APG grid, true row and column counts, edges stop, Shift+arrow steps five, Home/End/Ctrl+Home/Ctrl+End), `img "Show-night loupe"` glides to each cell in 125 ms, relights, rolls the sentence numerals in 200 ms, `replaceState`s `?cell=` and announces in `status "Cell reading"` (brief: Interactions, Motion).
- `P` opens `dialog "Place a body"` for the current cell (aim = centre rounded up to the half metre); `F` opens `dialog "Full wall"` growing from the slot in 330 ms. Escape closes; focus returns to the opener, or to the grid after a shortcut. Dialogs wrap Tab (APG).
- Placements save with `If-Match` the layout's strong tag; a stale tag answers `layout_changed` (412) and the page shows the band. Aim markers drag on half-metre steps; the spinbuttons are the keyboard alternative (SC 2.5.7).
- On touch (under 768 px) the loupe stays at the middle of the wall region and one-finger drags pan the wall beneath it; the page does not scroll for a drag begun on the wall.

### 5. Hire the shortfall (DP-18 – DP-21, DP-25 – DP-27)
- `/hire`: `<n> BODIES ON HOLD`. `Check stock` asks the desk; `Ask for a hold` creates an Asked hold, calls the desk with a server-held key and, on 201, becomes Held until `expiresAt` = arrival + `expiresInSeconds`. A held row says `Held for <mm:ss>` counting on monotonic time from the server's last answer, re-read every 30 s and on `hold.changed`.
- `Quote <holdId>` computes net (half-even once), VAT 21% (half-even once) and total in integer cents and compares with the desk. `Confirm <holdId>` refuses without a matching quote (`quote_required`, `quote_total_mismatch`) and makes no desk call; otherwise the hold turns Hired in and the body posts `hired_in` in the same transaction as the placement turning Bodied.
- If the hold lapses, the sweep (every process, claimed row, lease and fence) commits Lapsed once, returns placements to `Needs a body` as a committed layout write and sends `release` until the desk answers.

### 6. Hire through an outage (DP-23, DP-24)
- Refused connection on an ask's first send: Released, `hire_desk_unavailable` (503). Any other failure of an ask: stays Asked, same answer; replays with the same key at least every 5 s converge on the desk (a granted hold is handed back with one release and reads Released; 409 reads Released). A confirm with any failure keeps the hold Held (pending) and answers `hire_desk_pending` until the desk answers (200 Hired in, 409 `hold_expired` Lapsed).

### 7. Issue and rig (DP-38 – DP-47)
- `Issue rig sheet`: checks every placement Bodied, serials still on shelf/site, no overloaded circuit, then binds serials (database-enforced, one winner), calls Gotenberg, stores `sheets/<sheetId>/rig-sheet.pdf`, reads size and checksum back and only then commits Issued with a link and the event. A press or store failure leaves nothing (no binding, record, link, event or stray object).
- `Open the sheet` links to `/sheets/<sheetId>` (`THIS SHEET IS <STATUS>`); the technician opens `/rig/<token>`: `THIS RIG HAS <n> CIRCUITS TO PROVE`, `checkbox "<circuit> is live"`, `Open the PDF`. Ticks publish `circuit.confirmed`; the artist sees them live. A later layout write marks the sheet Out of step on both screens (technician band and `status "Rig"` carry the published copy); the stored PDF is unchanged.
- The link ends at `issuedAt + TECH_LINK_SECONDS`, on revocation, regeneration or withdrawal; at most 30 requests per link per rolling 60 s across processes.

### 8. Export masks (DP-49 – DP-51)
- `Build masks` starts a job (one step per placement plus a storing step, from the layout at start); `progressbar "Mask bundle"` and `status "Masks"` read `<phase>: <done> of <total>`. `Cancel masks` stops after the current step. A MinIO outage sets `waiting_for_store` and the job resumes on any process; the bundle is a stored ZIP with fixed 1980-01-01 times, byte-identical per layout hash.

## Palette roles (brief: Visual design, Colour)
| Role | Hex | Source |
|---|---|---|
| ground (warm blush) | `#f7e8e5` | decided: a warm blush, ink on it 14.15:1 |
| surface (deeper blush) | `#efd7d3` | decided: slightly deeper than ground, ink on it 12.31:1 |
| ink = accent (deep aubergine) | `#2b1430` | decided: same colour for ink and accent as the brief states |
| muted (aubergine-mauve) | `#6b4a6e` | decided: softer aubergine, 6.23:1 on ground, 5.42:1 on surface |
| text on accent | `#f7e8e5` | brief: "text on an accent block is the ground blush" |

## Type (brief: Type)
Imbue for display (weights 300–700, hero weight follows Output; 600 elsewhere), Albert Sans for everything else with tabular figures (400, 500, 700). Heading steps ×1.25: 1, 1.25, 1.5625, 1.9531, 2.4414, 3.0518, 3.8147, 4.7684 rem. Density comfortable.

## Space and layout per viewport (brief: Screens and layout)
- 375×812: workspace `region "Wall"` full width; a bottom-anchored sheet carries the band and `button "Readings"` (APG disclosure, `aria-expanded`); expanded it holds `region "Readings"` and `region "Bodies"`. Hero: slot on its own band between the lines, chips in a row below.
- 768×1024: two columns, Wall left, Readings above Bodies right.
- 1280×800: three columns Wall, Readings, Bodies; other screens put evidence in the right six of twelve columns.
- No published viewport scrolls sideways; every target is at least 44×44.

## Motion (brief: Motion and effects)
| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| loupe frame | new cell | 125 ms | quick start, soft settle (ease-out cubic, frame clock) | jumps |
| sentence numerals | new cell | 200 ms | `cubic-bezier(0.2,0.8,0.2,1)` | swap |
| full wall stage | slot / `F` | 330 ms, same path back | ease-out cubic (frame clock) | opens at once |
| bands, phone sheet body | appear / expand | 250 ms / 200 ms | ease-out | appear at once |
| hero title spacing | chip change | 200 ms | ease-out | at once |
No idle or decorative loops anywhere.

## States per async action
| Action | Pending | Success | Failure |
|---|---|---|---|
| Save site / reading | – (`Sending readings` while syncing) | list row; `Waiting to sync <n>` falls on acknowledgement | field copy beside the field; `Needs fixing <n>` |
| Upload photo | – | upright photo | `wall_store_unavailable`, `photo_not_image`, `photo_too_large` bands |
| Rectify | – | `Rectified to <residual> m.` | `residual_too_high`, `points_degenerate` |
| Ask / confirm / release | `Asking the hire desk` | `Held for <mm:ss>`, `Hired in. <serial> is on your shelf.`, `Released.` | `hire_desk_unavailable`, `hire_desk_pending`, `hire_release_unavailable`, `no_stock`, `hold_lapsed`, `quote_total_mismatch` |
| Issue | `Issuing the rig sheet` | `Issued.` | `layout_needs_bodies`, `circuit_overloaded`, `body_in_issued_rig`, `press_unavailable`, `sheet_store_unavailable` |
| Mask job | `<phase>: <done> of <total>` | `Download masks` | `The sheet store isn't answering. The mask bundle will carry on when it returns.` |

## Breakpoints (brief: Screens and layout)
under 768 (phone), 768–1279 (two columns), 1280 and wider (three columns / twelve-column evidence).

## Media and licences
| File | Source | Licence |
|---|---|---|
| `public/fonts/imbue-{300,400,500,600,700}.woff2` | `@fontsource/imbue` 5.3.0, latin subset | OFL-1.1 |
| `public/fonts/albert-sans-{400,500,700}.woff2` | `@fontsource/albert-sans` 5.3.0, latin subset | OFL-1.1 |
| `/icons.svg` (scan-line, package, handshake, triangle-alert) | `lucide-static` 1.68.0, build time | ISC |
| Zuiderhal demo wall, wall fragments, body crops | drawn in code (canvas) | original |
