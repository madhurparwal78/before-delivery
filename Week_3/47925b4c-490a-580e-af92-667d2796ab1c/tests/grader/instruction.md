# Nachtwit Gevelwerk

Gevelwerk is a site survey and throw layout workspace for independent projection artists working on Belgian building fronts. One artist surveys a wall on foot, lays out real serial-numbered bodies and lenses on it, proves half-metre by half-metre whether the light reads after dark, hires any shortfall and issues the rig sheet a venue technician works from. It uses Postgres for all records, MinIO for wall photos and issued files, Gotenberg to render the rig sheet PDF, and a rental house HTTP API (played by WireMock, with invented data). Out of scope: artist accounts and login (one workspace per deployment; the technician needs no account either), payments, e-mail, content playback, warping and any datastore beyond those named.

## Problem and users

An independent projection artist in Belgium, often subcontracted by small creative-coding studios for brand launches and winter light festivals, has to promise that a film will read on a real building front before anyone has paid for projectors. Today the evidence is scattered: a phone throw calculator that knows lenses but not ambient readings or kit stock, a spreadsheet of lumens, a light meter that reads foot-candles on one job and lux on the next, a photo of the wall and a rig sheet redrawn by hand. The artist carries the cost personally. A too-short lens or an underlit cornice is discovered on the test night, after 20 000 lm bodies have been hired at roughly 165 euro a day each, and it means a second truck, a second night and a client who has seen a washed-out wall.

- **Projection artist** (weekly): surveys a wall on foot, lays out real bodies and lenses, proves every half-metre reads, hires the shortfall and issues the rig sheet.
- **Venue technician** (occasional): opens the issued rig sheet without an account and confirms that each power circuit it asks for is live.

The deployment runs several server processes on one database, and any of them may stop at any moment. The artist's and technician's device clocks may be wrong.

## Journeys

1. **Survey a new wall.** Starting from the wall list, the artist creates a site with measured width and height and uploads a phone photo. The wall store may fail on the first try, and then no photo is on record. The artist sets four reference points and a check point on the upright photo and sees the residual. The workspace moves from the empty wall sentence to the rectified wall, dim and flat, and the wall list open on another screen shows it.
2. **Walk the wall without signal.** On a phone that has lost signal, the app shell still loads. The artist enters readings cell by cell in whatever unit the meter shows, and the waiting count rises. When signal returns, however unreliably, the count falls only as the server acknowledges each one. Every reading appears once beside its entered text and canonical lux, including on a screen already open elsewhere.
3. **Manage the shelf.** The artist records a bought body, sends it to a site, reverses a mistaken move and logs show hours. The shelf, the layout picker and the shelf sentence all show the same free count after each move, on every open screen.
4. **Lay out and prove the wall.** Starting from a rectified wall with readings, the artist places bodies and aims lenses by pointer or by keyboard alone, then walks the loupe across the wall while a second window edits the same layout. Each cell shows its contrast, band, pixels per metre and blend state, and a reload at the same address shows the same figure.
5. **Hire the shortfall.** The layout has a shortfall, so the artist checks rental stock, asks for a hold and sees a server-timed countdown. The artist draws the held body into the layout to preview its light, quotes, and confirms when the totals agree. The body becomes Hired in and usable in a rig. If the hold lapses instead, the placement returns to Needs a body.
6. **Hire through an outage.** The hire desk stops answering partway through asking or confirming. The artist reads the published band, keeps working on shelf and layouts, and later sees the hold's true state with no reload.
7. **Issue and rig.** From a fully bodied layout, the artist issues the rig sheet, surviving a press or store failure with nothing half-issued, and passes the link on. The technician opens it on another device, sees only that sheet and its circuits, and ticks each circuit live while the artist watches the ticks arrive. A later layout edit marks the sheet Out of step on both open screens, while the stored PDF stays as issued.
8. **Export masks.** The artist starts a mask bundle job and watches its progress. The artist may cancel it, or see it carry on through a storage outage or a stopped process, and downloads a bundle whose bytes are identical every time for the same layout.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Site with a measured wall** Create a site whose measured wall divides into half-metre cells and whose show time is wall-clock in the Brussels zone, with gaps and folds resolved as qualified in Business rules.
- **DP-02 — Wall photo judged by content** Accept a wall photo only by its content and the published size limit, whatever its name or declared type says.
- **DP-03 — Original photo kept byte for byte** Store the submitted photo in MinIO unchanged and record it only after a confirmed checksum and size.
- **DP-04 — Upright working copy** Honour the EXIF Orientation tag in the working copy and in every pixel coordinate used for reference points, without touching the original.
- **DP-05 — Rectification with a check point** Rectify the wall through one homography from four reference points and refuse it when the check point residual exceeds the published limit.
- **DP-06 — Survey journey on screen** Take the artist from the empty wall sentence through upload and point setting to the rectified wall in the workspace, surviving a wall store failure partway through.
- **DP-07 — Offline survey with a waiting count** Load the app shell and queue readings durably on a phone without signal, with a visible count that falls only on server acknowledgement.
- **DP-08 — Each operation applies once** Make the reading sync an idempotent consumer of operation identifiers, across retries, lost acknowledgements and processes.
- **DP-09 — Newest capture counts** Keep every repeat reading of a cell and count the newest capture, never the latest arrival, with device clock errors contained as qualified in Business rules.
- **DP-10 — Readings keep what was entered** Return each reading's entered text and unit unaltered beside its exactly converted canonical lux.
- **DP-11 — Number forms refused** Accept the published number grammar with a decimal comma or point and refuse every form outside it with the published copy.
- **DP-12 — Stale reading sets** Mark a site's reading set Stale by the server clock at the published age, while its cells still compute and say so.
- **DP-13 — Paired movement entries** Post every kit movement as one balanced pair of entries, readable through keyset pagination stable under concurrent writes.
- **DP-14 — One location for one serial** Keep every serial in exactly one location, with linearizable one-winner moves of the same serial across processes.
- **DP-15 — Corrections by reversal** Correct a movement only by a reversing movement, never by editing or deleting an entry.
- **DP-16 — Free counts agree everywhere** Keep every free count on every open screen and process equal to what the movement journal and sheet bindings imply.
- **DP-17 — Show hours and age derating** Add logged show hours to a body's age and derate its output by the published rule in every later sum.
- **DP-18 — Stock lookup and asking a hold** Look up rental stock and ask for a one-body hold through the rental house API with the published parameters and key.
- **DP-19 — Quote in exact cents** Compute each hire quote in integer euro cents with half-even rounding at the published stages and the published factor.
- **DP-20 — Total mismatch blocks confirmation** Refuse to confirm a hold when the computed total differs from the rental house total, without calling the confirm endpoint.
- **DP-21 — Hired in only on confirmation** Show a rental body as Hired in, and allow it into an issued rig, only after the rental house confirms it.
- **DP-22 — Idempotency keys on actions** Give every keyed action one effect and one stored outcome under replay, parallel duplicates and retries across processes, as qualified in Business rules.
- **DP-23 — Hire desk outage** Keep shelf and layouts working with the published band and code while the rental house is unreachable, recovering without a restart.
- **DP-24 — Ambiguous answers reconciled** Converge every ambiguous rental house outcome on the provider's own state, on any process, never guessing and never telling the artist anything that state contradicts.
- **DP-25 — Hold lapses by the server clock** Decide lapse and every countdown from the server clock over a half-open hold window, whatever the device clock says.
- **DP-26 — Lapse acts once across processes** Run the lapse sweep on every process through row claims with leases and fencing tokens, recording one lapse and one answered release per hold.
- **DP-27 — Placements return to Needs a body** Return placements drawn on a lapsed or released hold to Needs a body as a committed layout write, visibly and without a reload.
- **DP-28 — Placement limits on the server** Enforce zoom range, lens shift, obliquity, half-metre aim and overlap limits on the server for every placement.
- **DP-29 — Conditional layout writes** Refuse lost updates to a layout through RFC 9110 conditional requests with strong entity tags, across processes.
- **DP-30 — Keyboard placing and aiming** Place a body and aim its lens by keyboard alone through the APG modal dialog and spinbutton patterns, on the same half-metre steps a pointer uses.
- **DP-31 — Published photometric sums** Compute every cell's illuminance, contrast, luminance and resolution once on the server, byte-identical on every process.
- **DP-32 — Blend zones** Sum two overlapping bodies in a cell under the published gamma 2.2 ramp and say the cell is blended.
- **DP-33 — Verdict bands** Word and draw each cell's published band, decided on the unrounded contrast.
- **DP-34 — Show-night loupe** Follow the pointer with a loupe that relights the cell at show level, rolls the verdict numerals and records the cell in the address, in the published order and matching the server after a reload.
- **DP-35 — Wall grid keyboard** Walk the wall by keyboard through the WAI-ARIA APG grid pattern with the published announcements.
- **DP-36 — Touch panning** Pan the wall under a fixed loupe by touch on a phone, with the same half-metre cells and readings.
- **DP-37 — Reduced motion** Remove follow lag, rolling numerals and the stage opening under the reduced-motion setting while keeping every reading and control.
- **DP-38 — Issue a rig sheet** Issue a rig sheet from a fully bodied layout and show Issued with its technician link.
- **DP-39 — Issue gates** Refuse issue for a layout with a placement lacking a confirmed available body or with an overloaded circuit, naming what blocks it.
- **DP-40 — All-or-nothing issue** Show Issued only once the PDF is rendered and its stored object confirmed, leaving nothing half-issued when a provider fails, lies or stalls partway.
- **DP-41 — One winner for a body** Let exactly one of several simultaneous issues that share a serial succeed, across processes.
- **DP-42 — Frozen sheets** Keep an issued PDF unchanged, mark the sheet Out of step on any committed layout write and follow the published sheet transitions.
- **DP-43 — Rig sheet PDF contents** Render a rig sheet carrying the published facts and never a hire price.
- **DP-44 — Technician link** Open the rig sheet and its circuit checklist through a capability URL without an account, revealing nothing else.
- **DP-45 — Link end, revocation and regeneration** End a technician link by the server clock, on revocation, on regeneration or on withdrawal, including streams and screens already open, as qualified in Business rules.
- **DP-46 — Checklist is the only write** Allow the technician link to change nothing but the live state of its own circuits.
- **DP-47 — Shared link limit** Hold the published rolling request limit per link across all processes.
- **DP-48 — Live updates across screens** Publish committed changes from a transactional outbox to open screens on any process within the stated bound, resuming from Last-Event-ID without gaps or duplicates, also after database sessions are lost.
- **DP-49 — Mask bundle job** Build per-projector mask bundles as a background job with true phases, progress and cancellation, from the layout as it stood at the start.
- **DP-50 — Byte-identical bundles** Regenerate a byte-identical mask bundle for an unchanged layout hash, on any process.
- **DP-51 — Job resumes on any process** Resume an interrupted or storage-blocked mask job from its last finished step on any healthy process, with fencing against a stopped worker.
- **DP-52 — Problem details and precedence** Answer every API error, including unmatched paths and server faults, in one RFC 9457 shape following one precedence rule.
- **DP-53 — Request origin and server boundary** Refuse foreign origins on state-changing requests, enforce body limits, never serve source or credentials, and stay up when a dependency is down.
- **DP-54 — Hero sentence** Open on the live sentence with working Output, Throw and Capitals controls that change its type and its lit wall slot.
- **DP-55 — Published layouts** Give the wall workspace its published arrangement at 375x812, 768x1024 and 1280x800 with no horizontal overflow.
- **DP-56 — Published copy** Render every string in Feedback states character for character on screen and in live regions.
- **DP-57 — Hero look** Present the hero as blush display capitals on a flat aubergine field with a lit wall in place of a word and tilted chips on the letters.
- **DP-58 — Working screens look** Open every working screen with its uppercase sentence and live fragment, proof below or to the right, in banded rule-free tables and solid unboxed forms.
- **DP-59 — Duotone light** Show all light, including low readings, in two colours only, with numerals and hatching and no heat map.
- **DP-60 — Configuration from the environment** Read every service address and credential from the environment and keep them out of the browser and the source.

## Frontend

### Screens and layout (DP-06, DP-54, DP-55)

Routes: `/` hero; `/sites` wall list; `/sites/<siteId>/survey` photo, points and readings; `/sites/<siteId>/layouts/<layoutId>` wall workspace, with optional `?cell=<cell>`; `/kit` shelf and movement history; `/hire` holds and quotes; `/sheets/<sheetId>` the artist's sheet page; `/rig/<token>` technician page. Every route is a real address that reloads to the same state. Apart from `/` and `/rig/<token>`, each screen carries a navigation landmark with links to Walls, Shelf and Hire.

Every screen opens with one short uppercase sentence stating its truth, built from server state, with one rounded slot on its baseline. Evidence sits below it on narrow screens and in the right six of twelve columns from 1280 pixels wide.

| Screen | Sentence (`heading` level 1) | Slot | Evidence |
|---|---|---|---|
| Hero | see the Visual design hero | live demo wall | none |
| Wall list | `<n> WALLS ON FILE` (`1 WALL ON FILE`) | wall fragment | sites table, new site form |
| Survey | `NO WALL YET` until rectified, then `THIS WALL IS MEASURED TO <residual> M` | empty frame, then wall | photo, points form, readings form |
| Workspace | `THIS WALL READS AT <contrast> TO 1` | loupe view, opens stage | readings, bodies |
| Shelf | `THE SHELF HOLDS <free> FREE BODIES` (`1 FREE BODY`) | body crop | kit table, movement form, history |
| Hire | `<n> BODIES ON HOLD` (`1 BODY ON HOLD`) | body crop | stock form, holds table |
| Sheet | `THIS SHEET IS <status in capitals>` | wall fragment | circuits, link, withdraw |
| Technician | `THIS RIG HAS <n> CIRCUITS TO PROVE` (`1 CIRCUIT`) | wall fragment | circuit checklist, PDF link |

`<contrast>` is the current cell's contrast, or the lowest among covered cells that have a reading when no cell is chosen. The heading's accessible name is exactly the sentence and leaves out the slot. A workspace cell with no reading uses `THIS WALL HAS NO READING HERE`. An address naming a cell off this wall counts as no cell chosen. Stale reading sets add the stale sentence from Feedback states directly below the heading. A workspace for a site with no rectified wall shows the `NO WALL YET` sentence and the empty frame. On Hire, `<n>` counts holds with status Held. On Sheet and Technician the circuits are all of the site's circuits, whether or not they carry a body, and the Technician `<n>` is that total and does not fall as circuits are ticked.

Wall workspace arrangement, which is the same on either side of each width below:

- **Under 768 pixels (375x812):** `region "Wall"` fills the full width. Below it a sheet anchored to the bottom edge holds `region "Readings"` and `region "Bodies"`, collapsed to one line carrying the band until `button "Readings"` expands it (APG disclosure).
- **768 to 1279 pixels (768x1024):** two columns. `region "Wall"` is on the left. The right column stacks `region "Readings"` above `region "Bodies"`.
- **1280 pixels and wider (1280x800):** three side-by-side columns in the order `region "Wall"`, `region "Readings"`, `region "Bodies"`.

No published viewport scrolls sideways. The wall pans inside its own region.

### Public screens and controls (DP-06, DP-07, DP-16, DP-30, DP-34, DP-35, DP-38, DP-44, DP-54)

Only these are public. Everything else is free.

| Where | Role and accessible name | Notes and visible copy |
|---|---|---|
| Hero | `link "Nachtwit"`, `link "Survey a wall"` | wordmark top left; underlined action top right, goes to `/sites` |
| Hero | `img "Zuiderhal demo wall"` | live canvas in place of the word WALL |
| Hero | `slider "Output"` | 5 000 to 40 000 lumens in steps of 1 000, starts at 20 000; readout `<n> lm` with a space as thousands mark |
| Hero | `slider "Throw"` | 0.8 to 3.0 in steps of 0.1, starts at 1.3; readout `<ratio> to 1` |
| Hero | `switch "Capitals"` | on at start |
| Wall list | `form "New site"`, `textbox "Site name"`, `textbox "Wall width"`, `textbox "Wall height"`, `combobox "Length unit"`, `textbox "Show time"`, `button "Save site"` | show time as `YYYY-MM-DDTHH:mm` |
| Wall list | `table "Walls"`, `link "<site name>"` | rows go to the site's first layout once rectified, otherwise to its survey |
| Survey | `button "Choose wall photo"` | file picker |
| Survey | `img "Upright wall photo"`, `group "Point <n>"` for 1 to 4 and `group "Check point"` | each group holds `spinbutton "Pixel across"`, `spinbutton "Pixel down"`, `textbox "Metres across"`, `textbox "Metres down"`; clicking the photo fills the pixels of the focused group |
| Survey | `button "Rectify wall"`, `status "Rectify"` | residual appears here |
| Survey | `form "Reading"`, `textbox "Cell"`, `textbox "Value"`, `combobox "Unit"`, `button "Save reading"` | unit options `lx`, `fc`, `cd/m2`, `fL` |
| Survey and workspace | `status "Sync"`, `button "Sync now"` | always shows the waiting copy from Feedback states |
| Survey | `table "Readings"` | each row: cell, entered text and unit, canonical lux, captured time |
| Workspace | `grid "Wall cells"` | `gridcell` names are cell names |
| Workspace | `img "Show-night loupe"` | the moving frame; its canvas contents are server data |
| Workspace | `button "Open the full wall"`, `dialog "Full wall"`, `button "Close the full wall"` | the slot in the sentence opens the stage |
| Workspace | `status "Cell reading"` | loupe announcement |
| Workspace | `button "Place body"` | opens the dialog for the current cell |
| Workspace | `dialog "Place a body"` and `dialog "Aim <serial>"` | same fields: `combobox "Body"`, `combobox "Lens"`, `spinbutton "Aim across"`, `spinbutton "Aim down"`, `spinbutton "Body across"`, `spinbutton "Body down"`, `textbox "Standoff"`, `combobox "Standoff unit"`, `textbox "Zoom ratio"`, `textbox "Shift across"`, `textbox "Shift down"`, `combobox "Circuit"`, `button "Save placement"`, `button "Cancel"` |
| Workspace | `list "Placements"`, `button "Aim <serial>"`, `button "Remove <serial>"` | a placement without a body shows `Needs a body` and uses `Aim placement <n>` and `Remove placement <n>` |
| Workspace | `button "Issue rig sheet"`, `status "Issue"`, `link "Open the sheet"` | the link appears when the layout's sheet status is not Draft and goes to `/sheets/<sheetId>` |
| Workspace and shelf | `list "Free bodies"` | one item per model: `<model> <free> free` |
| Shelf | `table "Kit"`, `form "Record a movement"`, `combobox "Movement"`, `textbox "Serial"`, `textbox "Model"` (needed for Bought), `textbox "Starting hours"` (optional, for Bought), `combobox "Destination site"`, `button "Record movement"`, `status "Kit"` | movement options `Bought`, `Sent to site`, `Returned`, `Retired` |
| Shelf | `table "Movement history"`, `button "Reverse <movementId>"`, `button "Older movements"`, `form "Log show hours"`, `combobox "Body serial"`, `textbox "Show hours"`, `button "Log hours"` | |
| Hire | `form "Check stock"`, `combobox "Model"`, `textbox "First day"`, `spinbutton "Days"`, `button "Check stock"`, `button "Ask for a hold"` | first day as `YYYY-MM-DD` |
| Hire | `table "Holds"`, `button "Quote <holdId>"`, `button "Confirm <holdId>"`, `button "Release <holdId>"`, `status "Hire"` | status words are the state names; a held row shows the countdown copy |
| Sheet | `link "Open the PDF"`, `textbox "Technician link"`, `button "New link"`, `button "End link"`, `button "Withdraw sheet"`, `button "Build masks"`, `button "Cancel masks"`, `progressbar "Mask bundle"`, `link "Download masks"`, `status "Masks"`, `list "Circuits"` | |
| Technician | `list "Circuits"`, `checkbox "<circuit name> is live"`, `link "Open the PDF"`, `status "Rig"` | |
| Any | `alert "Outage"` | outage and error band |

**Option labels and dialog defaults.** `combobox "Body"` options read `<serial> <model>` for a shelf or site body, `<serial> <model> on hold` for the body of a Held hold (choosing it draws the placement on that hold), and `Needs a body <model>` once per model for a shortfall placement. `combobox "Body serial"` options read `<serial>`. `combobox "Lens"` options read `<serial> <model>`. `combobox "Circuit"` options read the circuit name. `combobox "Destination site"` options read the site name. `dialog "Place a body"` opens with the first Body, Lens and Circuit option, Aim and Body position equal to the aim defaults, Standoff `18` in `m`, Zoom ratio `1,3` and both shifts `0`; `dialog "Aim <serial>"` opens with that placement's values.

### Interactions (DP-30, DP-34, DP-35, DP-36)

**Pointer on the wall.** Moving the pointer over the wall snaps to half-metre cells. Each new cell runs the signature sequence. Clicking a cell keeps the loupe there and moves grid focus to it.

**Grid.** `grid "Wall cells"` follows the WAI-ARIA APG grid pattern with the wall's true row and column counts exposed. Edges stop rather than wrap. Shift with an arrow steps five cells and stops on the edge cell if five would leave the wall. Every key step runs the same sequence as the pointer.

**Workspace shortcuts.** These work with focus anywhere inside `region "Wall"` except a text field, including on a button: `P` opens `dialog "Place a body"` for the current cell, with Aim across and Aim down set to that cell's centre rounded up to the next half-metre step. `F` opens the full wall.

**Dialogs and the stage.** They follow the APG modal dialog pattern. Escape closes without saving. Focus returns to the opener, or to the grid when opened by shortcut.

**Aiming.** The aim and body position spinbuttons follow the APG spinbutton pattern, with one arrow step being half a metre. Dragging a placed body's aim marker with the pointer moves it on the same half-metre steps.

**Touch.** On a touch screen the loupe stays fixed at the middle of the wall region. A one-finger drag pans the wall beneath it, and each cell that arrives under the loupe runs the sequence. The page does not scroll while the drag began on the wall. Scrolling elsewhere works normally.

**Hero chips.** They follow the APG slider and switch patterns. Output changes the headline's weight and the brightness of the wall in the slot. Throw changes the gaps between letters. Capitals switches the sentence between capitals and sentence case, and the heading's accessible name follows it.

**Offline.** `button "Save reading"` always places the reading on the device queue, with signal or without, and the server alone judges it. The queue survives closing the tab and holds any number of readings. The app sends it by itself when signal returns and on `button "Sync now"`. A rejected reading's field copy appears beside `textbox "Value"`.

### Visual design (DP-57, DP-58, DP-59)

**Direction.** The sentence is the layout. The mood is nocturnal, exact and theatrical. Aubergine fields run floor to ceiling like a wall waiting for dark, every figure is set in tabular Albert Sans to one stated decimal, and uppercase Imbue verdicts stand as tall as a venue fascia.

**Colour.** There are two working colours and tints of them. The ground is a warm blush; surface blocks are a slightly deeper blush. Ink and the accent are the same deep aubergine, muted text is a softer aubergine-mauve, and text on an accent block is the ground blush. Nothing else appears.

**Type.** Imbue for display, Albert Sans for everything else with tabular figures. Each heading step is 1.25 times the previous. Density is comfortable.

**Hero.** A flat aubergine field carries the sentence `MEASURE THE [wall] / BEFORE THE LIGHT` in blush Imbue, where the word WALL is shown as one letter-height live canvas of the procedural demo front, an invented hall called Zuiderhal, lit by the current chip values. The heading's accessible name is `MEASURE THE WALL BEFORE THE LIGHT`, or `Measure the wall before the light` with Capitals off. Three tilted, working chips sit on the letters. On phones the slot drops to its own band between the two lines and the chips come off the letters into a row below, still working.

**Working screens.**
- Tables are full-width blocks of one size of Albert Sans with tabular figures, generous row spacing and alternating blush and surface bands, with no rules.
- Forms are large unboxed fields on solid surface blocks.
- The only button style is a solid block of whichever colour is not the ground.
- Empty states are the sentence with an empty slot frame waiting.
- Loading holds the sentence with its slot unlit.
- Errors and outages are full-width aubergine bands with one plain sentence.
- Slots, chips, buttons and fields round their corners by about a fifth of their height, up to a small maximum. Tables and full-width fields stay square.

**Light.** There is no heat map and no third colour. All light, low readings included, is blush on aubergine with numerals. Cells under the lowest band are hatched and worded. The two colours are literally the wall and the throw.

**Accessibility.** Every interactive target is at least 44 px in both directions. Focus is drawn in the opposite palette colour and meets WCAG 2.2 SC 2.4.11, including beside the phone sheet. Every dragging action meets SC 2.5.7. All text meets WCAG 2.2 AA contrast.

### Motion and effects (DP-34, DP-37)

**Signature: the show-night loupe.** Outside the loupe the rectified wall sits dim and flat. A rounded frame with the same proportions as the sentence slot follows the pointer. Inside it the canvas draws that part of the wall at show level from the server's cell data, with hatching where the band is the lowest. On each new cell, in this order:

1. The frame glides to the cell in about an eighth of a second, starting quickly and settling softly.
2. Its contents relight.
3. The numerals in the sentence above roll to the new contrast in about a fifth of a second.
4. The address gains `?cell=<cell>` without adding a history entry.
5. `status "Cell reading"` announces the cell.

Activating the slot opens it to the full wall stage in about a third of a second, growing from the slot's position. Closing runs the same path back in the same time.

**Other motion.** Bands and sheets slide in within a quarter of a second, and a button darkens or lightens at once on press. There are no decorative or idle loops anywhere, and nothing moves on the hero unless a chip is being changed.

**Reduced motion.** The loupe jumps directly to each cell, digits swap without rolling and the stage opens at once. Arrow keys, Shift steps, touch panning, numbers and announcements are unchanged.

### Feedback states (DP-07, DP-23, DP-33, DP-56, plus every problem code)

Strings in backticks render character for character, with straight apostrophes. `<...>` is a placeholder. `detail` in a problem body carries the same text as the band or field error.

**Verdict bands.** Contrast under 3: `Washed out`. From 3 to under 5: `Reads as graphics`. 5 or more: `Reads as image`. A cell without a reading: `No reading`.

**Live region copy.**

| Region | When | Copy |
|---|---|---|
| `status "Cell reading"` | blended cell | `Cell <cell>, <contrast> to 1, <ppm> pixels per metre, blended.` |
| | other cell | `Cell <cell>, <contrast> to 1, <ppm> pixels per metre.` |
| | no reading | `Cell <cell>, no reading.` |
| `status "Sync"` | always | `Waiting to sync <n>` |
| | rejected operations exist, as a second line | `Needs fixing <n>` |
| | while sending | `Sending readings` |
| `status "Rectify"` | success | `Rectified to <residual> m.` |
| `status "Kit"` | success | `Movement recorded.` |
| `status "Hire"` | pending | `Asking the hire desk` |
| | held | `Held for <mm:ss>` |
| | asked, unsettled | `Asked; still checking with the hire desk` |
| | hired | `Hired in. <serial> is on your shelf.` |
| | lapsed | `This hold has lapsed. Bodies drawn on it need a body again.` |
| | released | `Released.` |
| | quote | `Quote <total> including 21% VAT.` |
| `status "Issue"` | pending | `Issuing the rig sheet` |
| | success | `Issued.` |
| `status "Masks"` | progress | `<phase>: <done> of <total>` |
| | store down | `The sheet store isn't answering. The mask bundle will carry on when it returns.` |
| `status "Rig"` | tick | `<circuit name> marked live.` |
| | untick | `<circuit name> marked not live.` |
| | out of step, also as a band | `This sheet is out of step with the layout. Ask the artist before rigging.` |

Placeholder formats: `<contrast>`, zoom `<min>` and `<max>`, and `<angle>` have one decimal with a point. `<ppm>`, shift `<max>`, `<load>` and `<capacity>` are whole numbers. `<residual>` has three decimals. `<mm:ss>` is the server's remaining time. `<total>`, `<provider total>` and `<computed total>` are written `€ <euros>,<cents>` with two cents digits and no thousands mark. `<phase>` is the job's phase word. `<field>` is the refused member's name as sent.

Stale sentence: `These readings are stale; street lighting and foliage change.`

**Problem copy.** Shown in `alert "Outage"` for outages and refused actions.

| Code | Copy |
|---|---|
| `hire_desk_unavailable` | `The hire desk isn't answering. Your shelf and layouts still work; nothing has been held.` |
| `hire_desk_pending` | `The hire desk isn't answering. Your hold stands and the confirmation is still being checked.` |
| `hire_release_unavailable` | `The hire desk isn't answering. Your hold stands until it lapses.` |
| `press_unavailable` | `The rig sheet press isn't answering. Your layout is unchanged; nothing has been issued.` |
| `sheet_store_unavailable` | `The sheet store isn't answering. Your layout is unchanged; nothing has been issued.` |
| `wall_store_unavailable` | `The wall store isn't answering. Your readings and layouts still work; the photo was not kept.` |
| `no_stock` | `The hire desk has no body free for those dates.` |
| `hold_lapsed` | `This hold has lapsed. Bodies drawn on it need a body again.` |
| `hold_not_held` | `This hold is no longer held.` |
| `quote_required` | `Quote this hold before confirming it.` |
| `quote_total_mismatch` | `The hire desk's total of <provider total> differs from ours of <computed total>. Nothing can be confirmed.` |
| `serial_already_in_kit` | `The hire desk offered a serial that's already in your kit.` |
| `serial_not_there` | `That serial isn't where this movement starts.` |
| `serial_unknown` | `That serial isn't in your kit.` |
| `serial_exists` | `That serial is already in your kit.` |
| `hired_in_by_hold_only` | `A hired body arrives through a confirmed hold.` |
| `reversal_not_possible` | `That serial has moved since, so this movement can't be reversed.` |
| `body_in_issued_rig` | `<serial> is already in an issued rig.` |
| `body_not_available` | `<serial> isn't on the shelf or at this site.` |
| `body_already_in_layout` | `<serial> is already in this layout.` |
| `layout_needs_bodies` | `<n> placements still need a confirmed body.` |
| `circuit_overloaded` | `Circuit <name> is overloaded: <load> W on <capacity> W.` |
| `sheet_already_issued` | `This layout already has an issued sheet.` |
| `sheet_withdrawn` | `This sheet has been withdrawn.` |
| `link_not_found` | `This rig sheet link doesn't exist.` |
| `link_ended` | `This rig sheet link has ended. Ask the projection artist for a new one.` |
| `link_window_over` | `This sheet's link window is over.` |
| `link_rate_limited` | `Too many requests on this link. Try again shortly.` |
| `photo_missing` | `Upload a wall photo first.` |
| `photo_not_image` | `That file isn't a JPEG or PNG photo, whatever its name says.` |
| `photo_too_large` | `That photo is over the 40,000,000 byte limit.` |
| `residual_too_high` | `Those points disagree by <residual> m; the limit is 0.050 m.` |
| `points_degenerate` | `Three of those points lie on one line, so they can't fix the wall.` |
| `job_finished` | `This mask job has already finished.` |
| `layout_changed` | `This layout changed in another window. Reload it to carry on.` |
| `precondition_required` | `This change needs the layout's current version.` |
| `idempotency_key_required` | `This action needs an Idempotency-Key header.` |
| `idempotency_key_reused` | `That Idempotency-Key was already used for a different request.` |
| `origin_refused` | `This request came from another site.` |
| `unknown_field` | `Unknown field: <field>.` |
| `validation_failed` | `Some fields need fixing.` |
| `malformed_body` | `That request body couldn't be read.` |
| `unsupported_media_type` | `This request must be JSON.` |
| `body_too_large` | `That request body is too large.` |
| `method_not_allowed` | `That method isn't allowed here.` |
| `not_found` | `Nothing here.` |
| `database_unavailable` | `The workspace can't reach its records right now. Try again shortly.` |
| `internal_error` | `Something went wrong on our side.` |

**Field error copy.** Shown beside the field, tied to it with `aria-describedby`.

| Error | Copy |
|---|---|
| thousands separator | `Write the number without thousands separators, for example 1200,5.` |
| any other bad number | `Enter a number such as 1,8.` |
| bad unit | `Choose one of the listed units.` |
| site name | `Give the site a name of 1 to 80 characters without hidden or line-break characters.` |
| wall size | `The wall must be from 1 to 100 metres wide and from 1 to 40 metres high.` |
| show time | `Enter a date and time as YYYY-MM-DDTHH:mm.` |
| reading time | `Give the capture time as an instant with its offset.` |
| cell | `That cell isn't on this wall.` |
| below zero | `A reading can't be below zero.` |
| reflectance | `Reflectance runs above 0 and up to 1.` |
| recess | `Recess runs from 0 to 2 metres.` |
| first day | `The first day can't be before today in Brussels.` |
| days | `A hire runs for 1 to 7 days.` |
| zoom | `This lens zooms from <min> to <max> to 1.` |
| shift | `This lens shifts up to <max>% that way.` |
| obliquity | `That throw hits the wall at <angle> degrees; the limit is 25.` |
| aim grid | `Aim on a half-metre step.` |
| overlap | `No cell can sit under more than two bodies.` |
| lens | `<serial> isn't on the shelf or at this site.` |
| hours | `Show hours must be above 0 and up to 1000.` |
| limit | `Ask for 1 to 200 at a time.` |
| pixel | `That point is outside the photo.` |
| point count | `Set exactly four points and one check point.` |
| live | `Say true or false.` |
| operations | `Send 1 to 500 readings at a time.` |
| required | `This is required.` |

## Backend

### API (DP-01 to DP-05, DP-08, DP-09, DP-13 to DP-22, DP-25, DP-28 to DP-31, DP-38 to DP-52)

All bodies are JSON with `application/json`, except the photo upload and file downloads. An endpoint listed with `{}` also accepts an empty body. Every error is RFC 9457 problem details with `type` `urn:gevelwerk:problem:<code>`, `title`, `status`, `detail` (the published copy), and the extensions `code` and, on `validation_failed`, `errors`, an object whose keys are RFC 6901 pointers into the request body and whose values are field copy. All instants are RFC 3339 with offset. Bodies refuse any member not listed, at any depth, including `__proto__` and `constructor`. A body whose root is not an object is `malformed_body`. Numeric measured inputs travel as strings; `{"text","unit"}` is called a Quantity, and a bare JSON number in its place is the bad-number copy at the Quantity's own pointer.

Statuses follow the RFC 9110 and RFC 6585 meaning of each code: an ended link is gone, a provider that cannot be reached is 503, and `layout_changed`, `precondition_required`, the two size codes, the two media-type codes, `link_rate_limited` and `method_not_allowed` carry the status and headers those RFCs define, `Retry-After` being whole seconds. Where the standards leave a choice: `origin_refused` is 403; `malformed_body` and `idempotency_key_required` are 400; `validation_failed`, `unknown_field`, `serial_unknown`, `residual_too_high` and `points_degenerate` are 422; every remaining refusal, `idempotency_key_reused` and `link_window_over` among them, is 409.

Pointer choices: a Quantity's number errors sit at `/<member>/text` and its unit error at `/<member>/unit`. Obliquity sits at `/standoff`, overlap at `/aimAcross`, lens at `/lensSerial`, point count at `/points`, pixel at `/points/<i>/pixel` or `/check/pixel`, and required at the missing member. A sync result's pointers are relative to its operation.

Endpoints marked **K** require an `Idempotency-Key` header. Endpoints marked **M** are conditional per RFC 9110 on the layout's strong entity tag; `If-Match: *` counts as missing, and comparison is the strong one. `GET` of a Layout honours `If-None-Match`.

**Sites and survey**

| Request | Success | Extra codes |
|---|---|---|
| `GET /api/health` | 200 `{"status":"ok"}` | `database_unavailable` |
| `GET /api/sites` | 200 `{"items":[Site]}` | |
| `POST /api/sites` `{"name","width":Quantity,"height":Quantity,"showAtLocal":"YYYY-MM-DDTHH:mm"}`, K | 201 Site | |
| `GET /api/sites/<siteId>` | 200 Site | |
| `POST /api/sites/<siteId>/photo` raw bytes, optional `X-File-Name` (percent-encoded), K | 201 `{"sha256","bytes","fileName","widthPx","heightPx","orientation","key"}`; pixels are after orientation; `orientation` is the tag's value, 1 when absent | `photo_not_image`, `photo_too_large`, `wall_store_unavailable` |
| `GET /api/sites/<siteId>/photo` | 200 the original bytes, strong `ETag` of its sha256 | |
| `GET /api/sites/<siteId>/photo/upright` | 200 upright working image | |
| `POST /api/sites/<siteId>/rectification` `{"points":[{"pixel":{"x","y"},"wall":{"across":Quantity,"down":Quantity}} × 4],"check":{same}}` | 200 `{"residualMetres","homography":[9 numbers, row-major, pixel to metres, last element 1],"tiles":[keys]}` | `photo_missing`, `points_degenerate`, `residual_too_high`, `wall_store_unavailable` |
| `GET /api/sites/<siteId>/cells` | 200 `{"columns","rows","stale","items":[{"cell","ambientLux","reflectance","recessMetres","readingCount"}]}` | |
| `PATCH /api/sites/<siteId>/cells/<cell>` `{"reflectance":"<number>","recess":Quantity}`, either | 200 cell | |
| `POST /api/sites/<siteId>/readings/sync` `{"operations":[{"operationId","cell","value":Quantity,"capturedAt"}]}` | 200 `{"results":[{"operationId","status":"applied"|"duplicate"|"rejected"|"conflict","code?","errors?","readingId?"}]}` | |
| `GET /api/sites/<siteId>/cells/<cell>/readings` | 200 `{"items":[Reading]}` newest counted first | |

Site: `{"id","name","widthMetres","heightMetres","columns","rows","showAt","rectified","residualMetres","demo","stale","staleAt","circuits":[Circuit],"layouts":[{"id","name","sheetStatus"}]}`. Reading: `{"id","operationId","cell","entered":{"text","unit"},"canonicalLux","capturedAt","countedAt","acceptedAt","counts"}`. Circuit: `{"id","name","kind","capacityWatts"}`. `residualMetres` is null until rectified and `"0.000"` for the demo site.

**Circuits and layouts**

| Request | Success | Extra codes |
|---|---|---|
| `POST /api/sites/<siteId>/circuits` `{"name","kind"}`, K | 201 Circuit | |
| `POST /api/sites/<siteId>/layouts` `{"name"}`, K | 201 Layout with `ETag` | |
| `GET /api/layouts/<layoutId>` | 200 Layout with `ETag` | |
| `GET /api/layouts/<layoutId>/picker` | 200 `{"models":[{"model","free"}],"bodies":[{"serial","model","location","free"}],"lenses":[{"serial","model","location","free"}],"holds":[{"id","model","serial","status"}]}` | |
| `POST /api/layouts/<layoutId>/placements` Placement input, K, M | 201 Layout | `body_not_available`, `body_already_in_layout`, `hold_not_held` |
| `PATCH /api/layouts/<layoutId>/placements/<placementId>` any Placement input, M | 200 Layout | same |
| `DELETE /api/layouts/<layoutId>/placements/<placementId>` M | 200 Layout | |
| `GET /api/layouts/<layoutId>/cells` | 200 `{"items":[Cell]}` in row then column order | |
| `GET /api/layouts/<layoutId>/cells/<cell>` | 200 Cell | |
| `GET /api/layouts/<layoutId>/circuits` | 200 `{"items":[{"id","name","kind","loadWatts","capacityWatts","overloaded"}]}` | |

Placement input: `{"bodySerial?","holdId?","lensSerial","aimAcross":Quantity,"aimDown":Quantity,"bodyAcross":Quantity,"bodyDown":Quantity,"standoff":Quantity,"ratio":"<number>","shiftAcrossPercent":"<number>","shiftDownPercent":"<number>","circuitId"}`. At most one of `bodySerial` and `holdId`; with neither, the placement is a shortfall naming `"model"` as an extra member and shows Needs a body. Layout: `{"id","siteId","name","version","sheetStatus","hash","placements":[{"id","status":"Bodied"|"On hold"|"Needs a body","bodySerial","holdId","model","lensSerial",...inputs as canonical metres...,"imageWidthMetres","imageHeightMetres","throwMetres","obliquityDegrees"}]}`. Cell: `{"cell","ambientLux","projectedLux","totalLux","luminanceCdM2","contrast","contrastText":"<contrast> to 1","band","pixelsPerMetre","blended","stale","litLevel","hatched","contributions":[{"placementId","effectiveLumens","throwMetres","obliquityDegrees","share","lux"}]}`. `litLevel` is 1 − 1 / contrast; `hatched` means the lowest band.

Exact decimals are JSON strings: `canonicalLux` and `ambientLux` (six decimals), `residualMetres` (three), `widthMetres`, `heightMetres`, `reflectance`, `recessMetres`, `loggedHours` and the metre inputs a Layout returns. Derived measured figures are JSON numbers rounded half-even to four decimals: `projectedLux`, `totalLux`, `luminanceCdM2`, `contrast`, `effectiveLumens`, `share`, `lux`, `throwMetres`, `obliquityDegrees`, `litLevel`, `imageWidthMetres`, `imageHeightMetres`. Counts, `pixelsPerMetre` and cents are integers.

**Kit and hire**

| Request | Success | Extra codes |
|---|---|---|
| `GET /api/kit/shelf` | 200 `{"models":[{"model","free","atShelf","onSite"}],"freeBodies","items":[{"serial","kind","model","location","free","loggedHours","effectiveLumens"}]}`, models sorted by code and items by serial | |
| `POST /api/kit/movements` `{"kind","serial","model?","loggedHours?","siteId?"}`, K | 201 Movement | `serial_not_there`, `serial_unknown`, `serial_exists`, `hired_in_by_hold_only`, `body_in_issued_rig` |
| `GET /api/kit/movements?limit=&after=` | 200 `{"items":[Movement],"nextCursor"}`; keyset pagination, newest first, `limit` a plain integer from 1 to 200 (default 50), opaque cursor (an unreadable one is `not_found`), `nextCursor` null at the end. `button "Older movements"` appends the next page | |
| `POST /api/kit/movements/<movementId>/reverse` K | 201 Movement | `reversal_not_possible`, `body_in_issued_rig` |
| `POST /api/kit/bodies/<serial>/hours` `{"hours":"<number>"}`, K | 200 `{"serial","loggedHours","effectiveLumens"}` | `serial_unknown` |
| `GET /api/hire/stock?model=&from=&days=` | 200 `{"model","available","dayRateCents"}` | `hire_desk_unavailable` |
| `POST /api/holds` `{"model","from","days"}`, K | 201 Hold | `no_stock`, `hire_desk_unavailable` (body adds `holdId`) |
| `GET /api/holds`, `GET /api/holds/<holdId>` | 200 `{"items":[Hold]}`, 200 Hold | |
| `POST /api/holds/<holdId>/quote` `{}` | 200 Quote | `hold_lapsed`, `hold_not_held`, `hire_release_unavailable` |
| `POST /api/holds/<holdId>/confirm` `{}`, K | 200 Hold | `hold_lapsed`, `hold_not_held`, `quote_required`, `quote_total_mismatch`, `serial_already_in_kit`, `hire_desk_pending` |
| `POST /api/holds/<holdId>/release` `{}`, K | 200 Hold | `hold_lapsed`, `hold_not_held`, `hire_release_unavailable` |

Movement: `{"id","kind","serial","at","reversesId","entries":[{"location","delta":-1},{"location","delta":1}]}`. Hold: `{"id","status","model","from","days","holdRef","serial","expiresAt","remainingSeconds","serverNow","quote"}`; `remainingSeconds` is a whole number rounded up, and 0 once the hold is not Held. Quote: `{"dayRateCents","days","factorPermille","netCents","vatCents","totalCents","providerTotalCents","matches"}`.

**Sheets, masks, link, events**

| Request | Success | Extra codes |
|---|---|---|
| `POST /api/layouts/<layoutId>/issue` `{}`, K | 201 Sheet | `layout_needs_bodies`, `body_not_available`, `circuit_overloaded`, `sheet_already_issued`, `body_in_issued_rig`, `press_unavailable`, `sheet_store_unavailable` |
| `GET /api/sheets/<sheetId>`, `GET /api/sheets/<sheetId>/pdf` | 200 Sheet, 200 `application/pdf` | |
| `POST /api/sheets/<sheetId>/withdraw` `{}` | 200 Sheet | `sheet_withdrawn` |
| `POST /api/sheets/<sheetId>/link` `{}` | 201 Sheet with a new link | `sheet_withdrawn`, `link_window_over` |
| `DELETE /api/sheets/<sheetId>/link` | 204 | |
| `POST /api/layouts/<layoutId>/mask-jobs` `{}`, K | 202 Job | `layout_needs_bodies` |
| `GET /api/mask-jobs/<jobId>` | 200 Job | |
| `DELETE /api/mask-jobs/<jobId>` | 200 Job | `job_finished` |
| `GET /api/mask-jobs/<jobId>/bundle` | 200 `application/zip` | `not_found` until done |
| `GET /api/rig/<token>` | 200 `{"siteName","layoutName","sheetStatus","issuedAt","linkEndsAt","showAt","lowestContrast","circuits":[{"id","name","kind","loadWatts","capacityWatts","live","confirmedAt"}]}` | `link_not_found`, `link_ended`, `link_window_over`, `link_rate_limited` |
| `GET /api/rig/<token>/sheet.pdf` | 200 `application/pdf`, the stored object | same |
| `POST /api/rig/<token>/circuits/<circuitId>/live` `{"live":<boolean>}` | 200 the circuit | same |
| `GET /api/rig/<token>/events` | 200 `text/event-stream`, this sheet only | same |
| `GET /api/events` | 200 `text/event-stream` | |

Sheet: `{"id","layoutId","version","status","issuedAt","layoutHash","sha256","bytes","key","techUrl":"/rig/<token>","linkEndsAt","linkActive","lowestContrast","circuits":[...as on the rig view...]}`. `techUrl` is null when no link is active. Job: `{"id","layoutId","layoutHash","phase":"queued"|"rendering"|"storing"|"waiting_for_store"|"done"|"cancelled","stepsDone","stepsTotal","sha256","key"}`.

Streams follow the WHATWG server-sent events format, with frames `id: <sequence>`, `event: <type>`, `data: {"type","aggregate","aggregateId","sequence","at","data"}`. `data` never carries a price. Each type's `aggregate` and `data` members:

| Type | `aggregate` | `data` members |
|---|---|---|
| `reading.accepted` | `site` | `readingId`, `cell`, `canonicalLux` |
| `kit.moved` | `kit` | `movementId`, `serial`, `from`, `to` |
| `hold.changed` | `hold` | `id`, `status` |
| `layout.changed` | `layout` | `id`, `version`, `hash` |
| `sheet.changed` | `sheet` | `id`, `status` |
| `circuit.confirmed` | `sheet` | `circuitId`, `live`, `confirmedAt` |
| `mask_job.changed` | `mask_job` | `id`, `phase`, `stepsDone`, `stepsTotal` |

`aggregateId` is the aggregate's id (the serial for `kit`). A link stream carries only `sheet.changed` and `circuit.confirmed` of its own sheet. A stream without a readable `Last-Event-ID` begins with events after connection. A comment line goes out at least every 15 seconds.

**Limits.** JSON bodies up to and including 1,000,000 bytes; photo bodies up to and including 40,000,000 bytes. `Idempotency-Key` is 1 to 128 printable ASCII characters; anything else is `idempotency_key_required`.

### Business rules (DP-01 to DP-53)

**Error precedence, for the whole API.** Foreign origin; method not allowed; body too large, unsupported type, malformed body, unknown members; missing or invalid idempotency key, then a replayed key (a replay returns its stored response here, before any state check); unknown resource or ended link; rate limit; missing or stale `If-Match`; state conflicts; field validation; provider calls.

**Idempotency.** A keyed action is scoped by method, path and key. A replay of the same body returns the stored status and body with `Idempotency-Replayed: true` and no second effect, on any process. A different body is `idempotency_key_reused`. Parallel requests with one key produce one effect and each receives the same outcome. A 5xx outcome is not stored, so the same key retries the action. A key held by a process that has stopped is free again within 60 seconds.

**Numbers.** An entered number follows the RFC 8259 number grammar without an exponent, with these exceptions: the decimal mark may be a comma or a point, it is at most 18 characters, and a leading `-` is allowed only for shift, body position and reading values (a negative reading gets the below-zero copy). Negative zero is refused as a bad number. One mark is always decimal. The thousands separator copy applies to two or more marks, a comma and a point together, or a space or apostrophe between digits; every other refusal gets the bad-number copy. Arithmetic on entered numbers is exact decimal from input to rounding, whatever the magnitude.

**Units.** 1 fc = 10.7639104167 lx; 1 ft = 0.3048 m; 1 fL = 3.4262591 cd/m2. Ambient readings accept `lx`, `fc`, `cd/m2`, `fL`. Lengths accept `m`, `ft`. A luminance reading converts to lux as cd/m2 × pi / the cell's reflectance at acceptance, with pi taken as 3.141592653589793. `canonicalLux` rounds half-even once, at the end, and never changes after acceptance.

**Sites.** Name is NFC-normalised and counted in grapheme clusters (UAX #29), 1 to 80, refusing control characters, U+2028, U+2029, U+200B to U+200D, U+2060 and U+FEFF. Width and height limits are in the wall size copy, inclusive after conversion. `columns` and `rows` are the size divided by half a metre, rounded up. A cell name is a bijective base-26 column letter sequence plus a 1-based row from the top. Its centre is at (column − 0.5) × 0.5 m across and (row − 0.5) × 0.5 m down. Cells start at reflectance 0.6 and recess 0. Creating a site also creates one layout named `Main layout` and one circuit named `Mains` of kind `400V-CEE-32A`.

**Show time.** `showAtLocal` is wall-clock in `Europe/Brussels`. The DST gap resolves to the first valid instant after it, and the fold resolves to the earlier offset.

**Photos.** The type comes from the file's content: a JPEG or PNG signature and an image header giving its dimensions. Anything else is refused, however it is named or declared. The file name is kept as data only and never forms a key. EXIF Orientation is honoured for JPEG; a PNG is taken as upright. A new photo clears the site's rectification. A MinIO failure leaves no photo record.

**Rectification.** Pixels are in the upright image. One homography maps the four points to wall metres. Any three points forming a triangle under 1 square pixel, or of zero area in metres, are `points_degenerate`. The check point never enters the fit. Its residual is the wall-plane distance between the homography's image of its pixel and its measured position, rounded half-even to three decimals; the limit in its copy is inclusive on that rounded value. A refused rectification stores nothing and the wall stays as it was. An accepted one writes rectified tiles at 40 pixels per metre.

**Readings.** Sync accepts 1 to 500 operations in order; the device sends a longer queue in several requests. Each `operationId` applies once for the deployment: across parallel sends on any process exactly one result is `applied`, the others `duplicate`. The same id with a different cell, value or time returns `conflict` with `code` `operation_id_reused` and leaves the first. A bad operation returns `rejected` with `code` `validation_failed` and `errors`, and does not affect the others. Any result is an acknowledgement and removes the operation from the waiting count; a rejected or conflicting one moves to the needs-fixing count. `countedAt` is `capturedAt`, or the server's acceptance instant when `capturedAt` is later than it. The reading with the latest `countedAt` counts, the later acceptance winning a tie.

**Stale.** A site's reading set is stale on and after `staleAt`, its newest `countedAt` plus `READING_STALE_SECONDS`.

**Kit.** Locations are `outside`, `shelf`, `site:<siteId>`, `rental_house` and `retired`.

| Movement | From to | Notes |
|---|---|---|
| `bought` | `outside` to `shelf` | `model` required; optional starting `loggedHours` is any unsigned number, default 0, with no upper limit; `serial_exists` when known |
| `hired_in` | `rental_house` to `shelf` | posted only by a confirmed hold; a request asking for it is `hired_in_by_hold_only` |
| `sent_to_site` | `shelf` to `site:<siteId>` | |
| `returned` | `site:<siteId>` to `shelf`; a hired serial on the shelf to `rental_house` | |
| `retired` | `shelf` to `retired` | |

Every movement writes one pair with deltas −1 and +1. A move from the wrong location is `serial_not_there`. A reversal posts a new pair with `reversesId` and needs the serial still at the reversed movement's destination. A serial bound to an active sheet can be sent only to that sheet's site, and cannot be returned to the rental house or retired.

**Free.** A unit is free when its ledger location is `shelf` and no Issued or Out of step sheet binds it. Shelf and picker are a read model of the journal: at any instant they equal a fold of every movement page plus the bindings, and two reads on different processes with no commit between them are byte-identical.

**Derating.** Effective output falls linearly from rated lumens to 50% at the model's rated hours and stays there. Each `hours` entry on the show-hours endpoint runs above 0 up to 1000 inclusive and takes effect in every sum at the next read.

**Hold state machine.** Asked > Held > Hired in | Lapsed | Released; Asked > Released. Hired in, Lapsed and Released are final. Only provider responses and the server clock move a hold, never a click. An action the machine does not allow gets `hold_not_held`, or `hold_lapsed` on a lapsed hold. Each hold covers one body of one model. The `days` range is in its copy; `from` is judged against today in `Europe/Brussels` by the server clock. The hire covers the half-open date range from `from` to `from` + `days`.

**Hold window.** `expiresAt` is the server instant the desk's 201 arrived plus its `expiresInSeconds`. Held covers the half-open interval ending at `expiresAt`, and every read from that instant says Lapsed, except a hold with an unsettled confirm. No device clock enters any decision. Countdown text derives from `remainingSeconds` as last returned, ticking on elapsed monotonic time, re-read at least every 30 seconds and on every `hold.changed`.

**Lapse sweep.** Every process sweeps at least every 5 seconds through `SKIP LOCKED` row claims with leases and fencing tokens, so a stopped claimant's work is taken over and its late writes refused. Within 10 seconds of `expiresAt` one sweep commits Lapsed, clears the hold from placements and writes one event, and the desk receives `release` for the `holdRef` until it answers, and never again after that. Released clears placements the same way.

**Hire desk truth.** The artist is never told anything the desk's state contradicts, every ambiguous outcome converges by itself on any process, surviving the stop of the process that began it, and nothing is guessed. Each desk call has a limit of 3,000 ms. A 5xx, a reset connection or silence inside that limit is ambiguous. A refused connection on an ask's first send is definite and moves the hold to Released, but on a replay it proves nothing. On a confirm every failure counts as ambiguous. Replays carry the same key, come at least every 5 seconds while unsettled, and the hold settles within 15 seconds of the desk's first answer. The desk returns the first outcome for a key. An ask with an ambiguous outcome stays Asked and answers `hire_desk_unavailable`; since that copy says nothing has been held, a hold the desk turns out to have granted is handed back with one `release` and reads Released, and a 409 reads Released. A confirm with an ambiguous outcome keeps the hold Held and answers `hire_desk_pending`, past `expiresAt` too with `remainingSeconds` 0, until the desk answers: 200 is Hired in and 409 `hold_expired` is Lapsed. A further confirm while one is unsettled answers the same and sends nothing under a new key. A hold that has read Lapsed never later reads Hired in.

**Quotes.** Factor permille by days: 1: 1000; 2: 1800; 3: 2500; 4: 3100; 5: 3600; 6: 4100; 7: 4600. Net cents = the desk's day rate × factor / 1000, rounded half-even once. VAT is 21% of net, rounded half-even once. Total = net + VAT. Computed and desk totals are compared at each quote. Confirm uses the latest stored quote and makes no desk call without one or when it does not match.

**Hired in.** The desk's 200 and the transaction that posts `hired_in` and turns a drawn placement into Bodied are one fact. If the serial's ledger location is anything but `rental_house`, confirm is refused with `serial_already_in_kit` before any desk call. A serial never seen before starts at `rental_house` with the hold's `loggedHours`.

**Layouts and placement limits.** Bodies and lenses must be on the shelf or at the layout's site, and a hold must be Held. A serial, body or lens, appears once in a layout (`body_already_in_layout`). Coordinates run across and down from the wall's top left, with the lens at body position plus standoff in front of the wall.

- Throw `d` is the straight-line distance from lens to aim point.
- Image width is `d` over the ratio; height follows the body's native aspect.
- Image centre is aim plus shift% of image size, positive right and down. A cell is covered when its centre is in the half-open image rectangle.
- Obliquity is the angle of the throw off the wall's normal, allowed up to and including 25 degrees.
- Ratio and shifts stay within the lens's range, inclusive.
- Aims are whole multiples of half a metre after conversion.
- No cell sits under a third body.

Every committed write, including a confirm turning a placement Bodied and a lapse or release returning it to Needs a body, increments `version`, changes the strong tag and writes `layout.changed`. `hash` is the sha256 of canonical placement data in placement order and returns to an old value if the data does; `version` does not.

**Photometrics, computed in one place on the server.** Illuminance on a cell is the body's effective lumens spread over its image area at throw `d`, carried to the cell by the inverse-square law relative to `d` and by Lambert's cosine law, then scaled by the recess share and blend share. The distance and angle are taken to the cell centre at depth standoff + recess `r`. Recess share = max(0, 1 − `r` × tan θ / 0.5). Ambient is the counted `canonicalLux`, floored at 0.1 lx. Contrast is (projected + ambient) / ambient. Luminance is total lux × reflectance / pi for a Lambertian wall. Pixels per metre is native width over image width, half-even to a whole number, the lower of two bodies in a blend, 0 when uncovered. A cell with no reading has null figures. Every figure reflects the latest commit on any process at the next read.

**Blend.** Where two images cover a cell, `t` = (cell across − overlap left) / overlap width. Light shares are complementary and linear across the overlap: the body whose image centre is further left (the earlier placement on a tie) has 1 − `t`. The mask signal is the share encoded at gamma 2.2.

**Bands.** Decided on unrounded contrast. Display rounds half-even to one decimal.

**Power.** Capacity: `230V-16A` 3680 W; `400V-CEE-16A` 11085 W; `400V-CEE-32A` 22170 W. Load is the sum of the rated watts of bodies on a circuit. Exactly at capacity is allowed. The first overloaded circuit by name blocks issue.

**Rig sheet state machine.** Draft > Issued only by a successful issue. Issued > Out of step on any committed layout write. Issued or Out of step > Withdrawn; Withdrawn is final. Issuing while Out of step stores the new sheet and withdraws the old one in the same commit. A layout's first sheet has `version` 1, and each later sheet has the previous sheet's `version` plus 1, withdrawn sheets included. Withdrawal frees the bound serials.

**Issue.** Checks run in order: every placement Bodied (`<n>` counts the others, and is 0 for an empty layout), every serial still on the shelf or at the site, no overload, then the binding. Each body and lens serial is bound to at most one active sheet, enforced by the database, so exactly one of N parallel issues sharing a serial reaches Issued; the others get `body_in_issued_rig`. Issued commits only after a PDF has come back and its stored object's size and checksum are read back and agree. A press answer that is not 2xx, not a PDF, or absent after 20,000 ms is `press_unavailable`; a store answer that fails, disagrees or is absent after 10,000 ms is `sheet_store_unavailable`. On failure no binding, sheet record, link, event or stray object remains and the sheet status stays as it was. A process that stops mid-issue leaves the same state within 60 seconds.

**Provider calls and transactions.** No database transaction stays open across a provider call, so a silent provider slows nothing but its own action.

**Mask jobs.** One step per placement plus one storing step, built from the layout as it stood at the job's start. Every process claims steps with row claims, a lease of 15 seconds renewed while working, and fencing tokens. When a process stops, another resumes at the next unfinished step after the lease lapses, and `stepsDone` never falls. A step that cannot reach MinIO releases its claim and sets `waiting_for_store`, and any process retries at least every 5 seconds. Each step waits `MASK_STEP_MILLISECONDS` first. Cancelling stops the job after the current step at `cancelled` with no bundle recorded. Bundle: a ZIP with one entry `masks/<serial>.png` per placement sorted by serial, stored uncompressed with a fixed entry time of 1980-01-01 00:00:00. Each PNG is an 8-bit grey image at the body's native size with no time or text chunks. Pixel centres map linearly across the image rectangle: 255 inside and outside any blend, the signal × 255 half-even in a blend, 0 off the wall. Equal `hash` always gives equal bytes.

**Technician link.** The link is a capability URL with an opaque, URL-safe token of at least 128 bits of randomness. A sheet has at most one active link. Its end is `issuedAt` + `TECH_LINK_SECONDS`, judged at each request on a half-open window. Regeneration kills the old link at once and keeps the same end. After the window every rig endpoint answers `link_window_over`, including for a token revoked or replaced earlier. Before it, a revoked, replaced or withdrawn sheet's token answers `link_ended`, and tokens never issued answer `link_not_found`. The technician page and every rig response carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and the page's own HTML holds no sheet data. The link answers only the listed rig endpoints and methods. A circuit of another sheet is `not_found`. The rig view carries no hire price, no quote, and no other site, layout, sheet or serial owner detail. An Out of step sheet still serves and can still be ticked. A tick that changes nothing writes no event. A stream open on a link that ends closes within 5 seconds, and the open page shows the ending's copy.

**Link limit.** At most 30 served requests per link in any rolling 60 seconds, counted across all processes, a stream connection counting as one. `Retry-After` is the seconds until a slot frees.

**Events.** A transactional outbox: every committed state change writes its event in the same transaction, and a refused or undone action writes none. `sequence` is dense and strictly increasing in commit order across all processes, so no committed event ever appears behind one already delivered. Delivery to any stream on any process happens within 2 seconds of commit. A stream resumed with `Last-Event-ID` on any process receives every later event once, in order. Screens consume these streams and show free counts, hold status, placements, sheet status and circuit ticks without a reload.

**Losing the database.** The database may restart or kill any session at any moment. No process needs a restart, requests during the loss answer `database_unavailable`, sweeps and jobs carry on, and open streams resume delivery within 10 seconds of the database returning, or close so that a resume loses nothing. Screens reconnect by themselves.

### Services (DP-03, DP-18, DP-21, DP-23, DP-24, DP-40, DP-43, DP-49, DP-50)

**Postgres.** All records. Schema and seed apply idempotently on each serve, and several processes may start at once.

**MinIO.** Private bucket `S3_BUCKET`. Object keys:

- `photos/<siteId>/<sha256>`: the original bytes.
- `tiles/<siteId>/<sha256>/<col>-<row>.png`: rectified tiles.
- `sheets/<sheetId>/rig-sheet.pdf`: the rig sheet PDF.
- `masks/<layoutId>/<hash>/<serial>.png`: per-body masks.
- `masks/<layoutId>/<hash>.zip`: the mask bundle.

A record is written only after the object's size and checksum are read back and confirmed. The browser never receives a MinIO address, and files come through the app. When unreachable: photo and rectification calls give `wall_store_unavailable`, issue gives `sheet_store_unavailable`, and mask jobs wait as stated.

**Gotenberg.** `POST $GOTENBERG_URL/forms/chromium/convert/html` with an `index.html` file renders the rig sheet. The PDF contains the words `Rig sheet`, the site name, the layout name, `Sheet version <version>`, `Show time <YYYY-MM-DD HH:mm>` (Brussels wall-clock), `Lowest reading <contrast> to 1` (or `Lowest reading none` when no covered cell has a reading), a true-scale elevation labelled `Scale 1:<n>`, and for each placement its body serial, lens serial, `Aim <across> / <down> m`, `Standoff <standoff> m`, `Ratio <ratio> to 1` and `Shift <across>% / <down>%`, each with one decimal and a point. `<n>` is the smallest of 20, 25, 50, 100, 200, 250, 500, 1000 at which the wall fits 0.27 m by 0.15 m on paper. For each of the site's circuits it has name, kind and `<load> W of <capacity> W`. It never contains a price or the word `VAT`.

**Rental house API (WireMock).** The rental house, Kaaiverhuur, and all its data are invented. The app calls it at `$WIREMOCK_URL` with JSON. Baseline answers:

| Request | Answer |
|---|---|
| `GET /v1/stock?model=VK-20&from=<YYYY-MM-DD>&days=<n>` | 200 `{"model":"VK-20","available":4,"dayRateCents":16500}` |
| `GET /v1/stock?model=VK-12&from=<YYYY-MM-DD>&days=<n>` | 200 `{"model":"VK-12","available":0,"dayRateCents":11000}` |
| `POST /v1/holds`, header `Idempotency-Key`, body `{"model","from","days"}` | 201 `{"holdRef":"H-20417","status":"held","expiresInSeconds":1800,"serial":"KV-20-0417","loggedHours":0}`; or 409 `{"error":"no_stock"}` |
| `POST /v1/quotes`, body `{"holdRef","days"}` | 200 `{"dayRateCents","days","factorPermille","netCents","vatCents","totalCents"}` |
| `POST /v1/holds/<holdRef>/confirm`, header `Idempotency-Key`, body `{"totalCents"}` | 200 `{"status":"hired"}`; or 409 `{"error":"hold_expired"}` |
| `POST /v1/holds/<holdRef>/release` | 200 `{"status":"released"}` |

The fixture answers every hold with the same reference and serial unless overridden, so identify holds by your own id, never by `holdRef` alone. The ask and confirm keys are generated by the server, are unique per hold and per action, and stay the same on every replay of that action.

### Seed data (DP-13, DP-16, DP-31)

All records are invented and apply once. Every process seeds the same fixed identifiers.

**Models.**

| Code | Kind | Facts |
|---|---|---|
| `VK-20` | body | 20 000 lm, rated 20 000 hours, 1920 by 1200 native, 1900 W |
| `VK-12` | body | 12 000 lm, rated 20 000 hours, 1920 by 1200 native, 1200 W |
| `LS-13` | lens | ratio 1.2 to 1.6, shift across ±30%, down ±50% |
| `LS-20` | lens | ratio 1.7 to 2.4, shift across ±20%, down ±40% |

A model a hold brings in that is not listed takes the facts of the code it names.

**Kit, all `bought` on the shelf.**

- Bodies: `NW-B01` (`VK-20`, 0 hours), `NW-B02` (`VK-20`, 4000), `NW-B03` (`VK-20`, 10000), `NW-B04` (`VK-20`, 20000), `NW-B05` (`VK-12`, 0).
- Lenses: `NW-L01`, `NW-L02`, `NW-L03` (`LS-13`), `NW-L04` (`LS-20`).

**Site.** `zuiderhal`, name `Zuiderhal`, `demo` true, wall 24 m by 12 m, rectified over a procedural canvas with no photo, `showAtLocal` `2027-02-12T19:30`.

**Cells and readings.** One reading per cell, captured one day before first boot. Columns A to F are entered as `8 fc`; all others as `30 lx`. Cells in columns J and K, rows 9 to 12 (a recessed window) have reflectance `0.1` and recess 0.4 m; all others keep the defaults.

**Circuits.** `Stage left` (`230V-16A`), `Stage right` (`230V-16A`), `Yard` (`400V-CEE-32A`).

**Layout.** `zuiderhal-launch`, name `Zuiderhal launch`, Draft, with two placements at standoff 18 m, ratio 1.3, no shift, with body position equal to aim:

- `NW-B01` with `NW-L01`, aim across 6.5 and down 6.0, on `Stage left`.
- `NW-B02` with `NW-L02`, aim across 17.5 and down 6.0, on `Stage right`.

No holds, sheets or jobs exist at start.

## Technical requirements

### Deployment (DP-53)

The runtime is Node.js with npm and TypeScript. `/app/run.json` is the run manifest:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

Bind `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT`. `GET /api/health` answers as published. Several serve processes run on one database at once and any may be stopped without warning, so no rule may depend on a single process's memory.

### Configuration and secrets (DP-60)

Read at start, never hard-coded and never sent to the browser: `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `GOTENBERG_URL`; `WIREMOCK_URL`.

Time and pace settings:

- `TECH_LINK_SECONDS`: unset means 1,209,600 (14 days).
- `READING_STALE_SECONDS`: unset means 10,368,000 (120 days).
- `MASK_STEP_MILLISECONDS`: unset means 0.

### Server boundary (DP-52, DP-53)

The app is same-origin only. A state-changing request whose `Origin` is present and is not the app's own RFC 6454 origin, `null` included, is `origin_refused`, on rig endpoints too. A request with no `Origin` passes. Unmatched `/api` paths, static 404s and server faults all answer in the same problem details shape, with `not_found` and `internal_error`. The server never serves source, dot-files, the manifest, dependency folders or credentials. When MinIO, Gotenberg or the rental house is unreachable at boot, the app still starts and serves everything that does not need them, and recovers without a restart as soon as they return. When Postgres is unreachable at boot, it keeps retrying and `GET /api/health` answers `database_unavailable` until connected. No fault message reveals a stack, address or credential.

### Browser support and performance (DP-07, DP-55)

The app supports current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800. The wall is usable within three seconds on the seed data. A new cell's reading appears within a quarter of a second of arriving at the cell. After one online visit, the shell, survey screen and reading form load with no network, through a service worker that never stores anything from a rig address.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`), font and icon set, with its licence.
- IF-03: Shipped packages carry only MIT, ISC, BSD, Apache-2.0 or OFL licences.
- IF-04: The only datastores are Postgres and MinIO; no Redis, SQLite, or file-based state on the server's disk.
- IF-05: Imbue, Albert Sans and Lucide icons are bundled with the app; the browser loads nothing from another origin.
- IF-06: Provided compose files and service configuration stay unchanged.

## Engineering standards

- The source is idiomatic strict TypeScript whose names use this brief's terms: wall, cell, reading, body, lens, hold, movement, placement, sheet, circuit.
- Each domain rule (a state transition, a band, a photometric sum, a free count, a lapse decision, a rounding) is decided in exactly one place in the source; the browser holds no copy of a server rule and renders server fields.
- Every error path, including 404s for static files and uncaught faults, goes through one error builder producing the single problem details shape.
- Configuration comes only from the environment; only the three published defaults exist as literals, and no address or credential has a fallback.
- No abstraction has a single implementation, and no wrapper merely forwards to a provider client.
- There is no dead, commented-out or unreachable code and no defensive check for a state the database constraints or earlier checks already rule out.
- Money is integer cents and entered measures are exact decimals from input to sum; no floating point touches a cent.
- There are no features, screens or endpoints beyond this brief.
