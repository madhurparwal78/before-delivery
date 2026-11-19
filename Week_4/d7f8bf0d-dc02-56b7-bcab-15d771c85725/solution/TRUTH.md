# TRUTH — Fishplate Layout Works Gandyboard

The golden's ground truth. Every value says where it came from: `brief: <section>` (verbatim from `instruction.md`) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent). Reality is the running app in `app/`.

## 1. Journeys: start state, actions, visible end state, provider-recorded end state

All journeys start with the cold start from `run.json`: `npm ci`, `npm run build`, `npm run serve` (brief: Technical requirements,
Deployment). Postgres, Valkey and Gotenberg are the provided services; the schema and seed apply idempotently on boot.

### J1 New client (DP-01, DP-02, DP-04)
1. Start: the founder is signed in with two clubs (brief: Journeys). Someone with no sign-in first gets the white sign-in sheet with `Email`, `Password` and `Sign in` over the bare stage ground (brief: Screens and layout).
2. Signing in as `founder@fishplate.example` with `gandyboard-demo-1` reads `Signing in.` then `Signed in.`. The loading screen shows the wordmark and the pill, then fades into the stage (700 ms). Visible: two clubs in `Workspace`.
3. `New workspace`: dialog with `Workspace name`, `Template` (`Reference layout` = reference, `Empty` = empty), `Create workspace`. Provider: workspace, founder membership only, one layout, version 1 Published (reference template), no sessions. The dialog closes; `workspace` is in the URL.
4. Sheets > Members > `Add member`: `Display name`, `Email`, `Password`, `Role` (Manager/Member/Operator), `Save member`. Status `Adding member.` then `Member added.`. Provider: three new membership rows (manager, member, operator) beside the founder's.
5. Two tabs open two clubs; each shows only its own session, counters and packets while ticks stream (`tick.committed` through each instance's Valkey Stream).

### J2 Building a module together (DP-05..DP-09, DP-12)
1. A member opens Build mode, `Add module`, selects its open end, presses a tile. Status `Adding piece.`; nothing is drawn until the server answers; then `Piece added.` and the piece slides in (300 ms) with the camera easing (400 ms).
2. A `mainline` curve under the radius limit is refused: status `Curve radius <measured> is under the <limit> minimum.`; no revision, hash or count changes.
3. A second member on another instance sees `piece.added` through the layout Valkey Stream. If both extend one open end: one 201, the other 409 `open_end_taken` (`Open end <label> was just extended by <display name>. Nothing was changed.`).
4. A double tap sends one append command (pending presses reuse it); the same key across instances makes one piece.

### J3 Publishing and correcting (DP-11, DP-13..DP-18)
1. Manager `Check layout` (`Layout passes every rule.` or `Layout has <n> findings.`), `Save version`, Validate, Publish (Versions sheet). Rows read Draft, Validated, Published.
2. Rename a block: `Renamed to <new name>.`; the working copy, every non-Ended session, the timetable and the packet preview show it; earlier versions, Ended sessions and issued PDFs keep the old name; history records actor, from, to.
3. Restore a version: new Draft, same canonical hash, working copy replaced. Trash, Undo (exact working hash), Trash, Purge (history reads `Purged module`).

### J4 Rehearsing a meet (DP-19, DP-23..DP-27, DP-55)
1. Operator opens a session pinned to a Published version, `Start` (`Session running.`). Selects Train 101, destination, reads `Route: 3, 4`, presses Highball.
2. Status `Requesting the road for Train 101.`; after the commit `Train 101 has the road to <block>, <n> blocks.`. The blue chevron ribbon extends block by block (180 ms each), the schematic rows and reserved counter change in the same step; the limit flag rises (240 ms). The train glides to each committed position (640 ms); blocks come back from the tail.
3. Train 202 takes the loop at Fernhill and the two pass.

### J5 Rescuing a deadlock (DP-34..DP-36)
1. Two operators each ask for the road over the other's train: both get `route_conflict`; the Conflict sheet names the other train (note, `Withdraw request`, `Back to loop`, `Recall train`).
2. On the next committed tick the server raises the deadlock; status `Deadlock: Trains 101, 202 are waiting on each other.`; the Deadlock sheet lists members with Back to loop / Recall train. Founder presses Back to loop on one train: `Train <number> is in <block>.`, the nearest free loop; the deadlock is Cleared and the other train gets the road.

### J6 Resuming an interrupted evening (DP-38, DP-39)
1. Every instance stops; with no lease holder for 5,000 ms the first instance able to act records Interrupted at the last committed tick. The screen reads `Interrupted`.
2. `Resume`: `Session resumed at tick <tick>.`; positions, authorities, timetable progress, carry and fast clock are intact; the next tick has the next number; ticks stay gapless in `session_ticks`.

### J7 Crew paperwork (DP-41..DP-44)
1. `Issue packet`: `Issuing crew packet.`; Queued, Rendering, Ready (`Crew packet ready.`). Gotenberg renders one HTML document with `Timetable`, `Train orders`, `Block table`, `Track diagram` and prints `Session version <n> | Content hash <hash>` on every page. Provider: `crew_packets` row with PDF bytes, one `packet.changed` event per state.
2. An extra train or rename leaves the PDF unchanged and the packet reads Superseded.

### J8 Service outage (DP-47, DP-48)
1. Valkey unreachable at boot: the app opens; seeded Running sessions read Held (hold_reason valkey) within 3 s; `outage-banner` shows `Live updates are paused. Sessions are held at their last committed tick.`; session commands answer 503 `valkey_unavailable`, except Issue packet, which is accepted and ends Failed (`Crew packet failed: live updates are paused. Nothing was issued.`); layout writes still commit and their events wait in the outbox. On return: `Live updates are back.`, outbox delivered in order, sessions Running at the next tick, no restart.
2. Gotenberg unreachable: Crew packets sheet shows `The PDF service is not answering. New packets will fail until it returns.`; Issue ends Failed (`Crew packet failed: the PDF service did not answer. Nothing was issued.`) with no bytes and no Ready event; after return a new Issue succeeds with no restart.

## 2. Palette roles (brief: Colour roles names each role in words; every hex but pure white is decided: the value DESIGN.md picks for those words)

| Role | Hex | Source |
|---|---|---|
| ground | `#FFFFFF` | brief: Colour roles (pure white) |
| surface | `#E8ECF4` | decided: a pale periwinkle grey (brief: Colour roles) |
| ink | `#2B3145` | decided: a soft blue-black (brief: Colour roles) that meets AA on every surface |
| accent | `#0FA6EE` | decided: a bright sky blue (brief: Colour roles) |
| accent deep | `#0158B4` | decided: a strong cobalt (brief: Colour roles) |
| action | `#FF9F0F` | decided: a warm saturated orange (brief: Colour roles) |
| field | `#3FB56B` | decided: a saturated green (brief: Colour roles) |
| lip blue-grey | `#AEB8D0` | decided: the blue-grey lip of the track piece tile rail (brief: Named components) |
| action lip | `#C46A00` | decided: darker orange for the lip the brief requires |
| muted text | `#5A6178` | decided: AA on ground and surface |

## 3. Type, space and layout

- Fredoka 600 24 px sheet and card titles; Fredoka 500 tabular numerals; Karla 16 px forms and body text (brief: Type). Karla weights 400 and 700 (decided: regular text and the bold labels the brief asks for). Skip is 14 px bold (brief: Named components). Both faces bundled (OFL-1.1).
- Corners 20 px sheets and cards, 10 px controls, full pills for toggles and loaders (brief: Corners).
- Lip about 5 px; press moves 4 px (brief: Visual design); focus ring 3 px in the deep accent blue (brief: Hover and press). List rows carry the lip with no stroke (brief: Working screens); version and block state tags use the 10 px control corner, since pills are for toggles and loaders (brief: Corners).
- Right-edge sheets float 16 px from the top, right and bottom, so their corners and lip stay on screen, and cover the dock (decided: brief: Sheets slide over the live stage; the 20 px corners and lip are the brief's).
- The tile rail and commands centre on the visible stage; the dial and switch sit outside them (brief: Bottom edge). Below 1200, and on desktop while a sheet is open, tiles are 46 px wide at 6 px gaps (decided: clears the switch at 768 and keeps 24 px between the rail and the switch beside a sheet; the brief says about 50, grown to the tap size).
- Tap size 44 px minimum on every interactive element (brief: Colour roles).
- Phone (<=767): rail scrolls from a small left margin with the last tile clipped, readout on a second line under the bar, Schematic button opens a bottom sheet, sheets are bottom sheets, tables become stacked rows, walkthrough card keeps about 20 px side margins (brief: Screens and layout). The small margin is 16 px, a 12 px edge inset plus 4 px of rail padding (decided: clears the screen edge without hiding the first tile).
- Tablet (768-1199): right-edge sheets, schematic table on the right edge at 300 px below the readout. Desktop (>=1200): schematic dock 340 px from the top edge, with the session bar and readout left of it (decided: keeps the centre clear). The schematic is one 44 px line a block at every width; a row's actions wait past its right edge, come in below the row once it is selected, and scroll into view on a swipe or keyboard focus; the block number stays pinned while a row is swiped, pressing an action selects its row, and the selected row with its action line is brought wholly into view (decided: at least eight rows read at 800 px tall without scrolling, and no click lands on a button that cannot be seen). On desktop an open sheet reframes the stage and the bottom edge recentres in the width left (decided: the brief wants trains visible around a sheet).
- In Operate mode the readout group sits beside the session bar on desktop and tablet, and phones place it on a second line under the bar (brief: Sticker-outline session bar). Beside it, the bar wraps inside its own column: about half the width left of the dock on desktop; on tablet the readout takes the dock's 300 px at the right edge and the dock starts under it (decided: both must fit in the width left at 1280 and 768).
- The page never scrolls and never overflows sideways at 375x812, 768x1024, 1280x800 (brief: Screens and layout).

## 4. Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| any control | press | 100 ms | symmetrical gentle S-curve `cubic-bezier(0.65,0,0.35,1)` (decided: brief names the shape) | none (0 ms) |
| ribbon block | grant / tail release | 180 ms per block, max 1,440 ms | same | all blocks in one frame |
| switch knob | mode change | 200 ms | same | at once |
| limit flag | end of authority | 240 ms | same | appears without rising |
| sheets, walkthrough step cross-fade, dots, tile piece slide | enter, exit, step change | 300 ms | same | at once |
| sign-in sheet | shown under the loading fade | 300 ms opacity only | same | at once (decided: it holds still so its button can be pressed the moment it shows) |
| heading dial, camera turn | 45 degree press, Q, E | 400 ms | same | cut |
| camera return | Reset view | 400 ms (decided: the brief gives no duration for Reset view, so it uses the camera turn's) | same | cut |
| stage reframe | sheet opens or closes on desktop, Operate dock appears | 300 ms (decided: it moves with the sheet slide) | same | cut |
| status line fade | 6 s after the newest status line | 500 ms (decided: an old result must not sit on the stage; the text stays in the region) | same | at once |
| walkthrough card and scrim | close | 500 ms | same | at once |
| train glide | each committed tick | 640 ms within the 1 s tick | same | jump |
| loading screen | stage ready | 700 ms fade | same | at once |
| pigeon | once per stage load | about 3 s | same | removed |

(brief: Motion and effects, except rows marked decided.)

## 5. States per async action

Pending, success and failure copy for every action is the table in brief: Feedback states, implemented verbatim in `web/src/copy.ts` and announced in
`status "Gandyboard status"`, the only named live region; error and outage copy also shows in `error-sheet` and `outage-banner`. No success appears before the server answers. Errors outside a field open `alert` `error-sheet` with `Dismiss`.
Decided copy where the brief is silent: `Creating workspace.` / `Workspace created.`, `Adding module.` / `Module added.`, `Creating layout.` / `Layout created.`,
`Select an open end first.`, `Nothing to undo.`, `Select a train and a destination first.`, `Select a train first.`, `Select a train` (route panel caption), `Choose block` (destination prompt).
When the selected train's authority ends, the route panel clears its destination, via and preview, and Cancel authority is enabled only while that train holds a Granted authority (decided: a finished road must not read as live).

## 6. API truths worth keeping

- Error order (brief: API): 401, 403, 404, 422 key, 409 stale revision, 503 Valkey, 422 rules. One pipeline (`server/http/pipeline.ts`) and one error builder (`server/http/errors.ts`).
- Idempotency: the stored first result (including a 422 refusal and a 409) is replayed for the same key and body; the same key with a different body is `idempotency_key_reused`. Concurrent duplicates serialise on the row lock and the advisory key lock.
- Layout stream seq equals `layout.revision`; session stream seq equals session `revision`; every committed change writes one outbox row, published in order with ID `<seq>-0`, streams kept at 2,000 to 2,100 entries.
- Names: a session is pinned at creation to one Published version and its timetable version, so its track, blocks, trains, timetable and block and station names start as that version saved them. Later edits, versions and restores never touch them; only a rename reaches it: a rename updates the working copy and every non-Ended session of that layout in one commit (brief: Session states; Rename). A rename made before a session existed is not applied to it (decided: the brief pins a session to a saved version, and saved versions keep their names). Ended sessions keep the names they ended with.

- Reference layout shape (decided: the brief leaves the pieces free and asks for curves): the line folds back twice, Wren Quay, a 180 degree curve of radius 1150 mm in block 4, Fernhill, the same in block 9, Tarn Head. At Fernhill the main road and the loop bow apart symmetrically and meet at the east throat, so T3 is drawn joined; block lengths are the brief's and the layout passes every default rule.
- Parked stock: outside a session the stage draws each train in `content.trains` at its start block and head offset (decided: the brief's stage holds freight stock in every mode; this is drawing, no occupancy). Parked trains cannot be selected; a switch of source cuts, it does not glide.
- Seed (brief: Services, an empty database receives the seed): the seed applies in one transaction under the schema lock, so an instance stopped mid-seed leaves the database empty and the next boot seeds it whole (decided).
- Client counters (brief: Browser state derives from server events): the readout shows the server's counters, less the blocks the ribbon has yet to reach or give back; the recount itself is decided only in `server/domain/session/state.ts`.

## 7. Media and licences

| Asset | Licence | Source |
|---|---|---|
| Fredoka 500, 600 woff2 | OFL-1.1 | Fontsource `@fontsource/fredoka` 5.3.0 |
| Karla 400, 700 woff2 | OFL-1.1 | Fontsource `@fontsource/karla` 5.3.0 |
| Wordmark, glyphs, walkthrough art, empty-state art | original | drawn in code or as new SVG |
| Club-hall scene (floor, trestles, modules, track, signals, boards, freight stock, roof, pigeon) and textures | original | procedural three.js geometry and canvas textures; no model or image file is loaded |

No raster image, audio or video ships.
