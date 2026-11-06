# Northlight Works Hangline

Hangline is a shared planner, used in the browser, for hanging temporary exhibitions in small and mid-size museums. Curators, registrars and preparators all work in one 3D model of the galleries:
- Curators place loaned and collection works on walls.
- Registrars keep the loan register: each work's conservation light limits, dimensions, lender, insurance value and condition photos.
- Preparators claim works and nudge them into final position on install day.
- Each lender gets a read-only preview of their own works in place. It is sent by email at a time the server decides.

Every change one person makes shows up in everyone else's open workspace within seconds, with no reload. Hangline uses three services:
- Postgres stores everything.
- A MinIO object store keeps condition photos and frozen preview snapshots.
- An SMTP relay (Mailpit) delivers lender emails.

Out of scope:
- user accounts and passwords. Staff pick who they are working as from a list of seeded staff. This is a trusted internal tool, not authentication.
- free-standing plinth works
- lighting design beyond one planned lux level per wall
- more than one exhibition
- any datastore other than the three services named here

## Problem and users

Small and mid-size museums assemble each temporary exhibition from three separate sources: the curator's checklist, the registrar's loan spreadsheet and the preparator's printed wall elevations. The 3D exhibition planners on the market are desktop tools in which one person drives one model. They leave three gaps:
- None lets the registrar's conservation limits restrict where the curator can place a work. Typical limits are 50 lux for works on paper and textiles, plus a lux-hour allowance per object across the run.
- None stops two installers from both taking the same work on install day.
- None sends each lender a preview at an agreed time without exposing other lenders' insurance values.

The museum absorbs the cost:
- works re-hung during install week at crew overtime rates
- light exposure that has to be reported back to lenders
- loan agreements put at risk when a preview goes out early or carries the wrong figures

The users:
- **Curator** (daily, at a desk monitor, a tablet or a phone). Places works on walls in the 3D gallery. Moves between plan, eye-line and light views to check sightlines. Schedules and withdraws the lender preview. Some curators work entirely by keyboard.
- **Registrar** (daily). Keeps the loan register: each object's lux limit, lux-hour budget, dimensions, lender, insurance value and notes. Attaches condition photos and signs off hung works.
- **Preparator** (daily, often on a tablet in the gallery). Claims works to install, nudges them to the centimetre, and marks them hung.
- **Lender** (occasional). Opens the preview link from the scheduled email and sees only their own works in place.

## Journeys

1. **Curator plans the hang by keyboard.**
   - Start: the seeded exhibition, working as the curator at a desk with no mouse.
   - The curator tabs past the skip link into the object rail and reaches "Tide Chart Quilt". They press Place, choose the South wall in the Wall list and save. The error summary takes focus and says the wall is too bright. They follow its link to the Wall field, choose the North wall and save.
   - Focus lands on the work's handle in the Scene ledger, and the work settles onto the hang line. A second curator session on a tablet shows the new work within seconds and announces who placed it.
   - End: the ledger row carries the server's offset, centre height, lux and lux-hours.
2. **Curator nudges, removes and changes their mind.**
   - Start: "Herring Girls at the Gutting Station" proposed on the North wall.
   - The curator nudges it 10 cm left with Shift and the left arrow. They open Placement details with Enter, type an exact offset, save, and are back on the handle.
   - They press Remove from wall. Focus moves to Undo, and the toast counts down while they switch from Plan to Wall and open and close the object rail.
   - End: they press Control+Z before the window closes, the work is back, and focus is on its handle. The other session showed the removal and then the return. Had they waited past the window, Undo would have been refused.
3. **Install day: two preparators, one work.**
   - Start: "Ganseys Drying" proposed on the South wall, and two preparators, each on a phone with the Objects sheet open.
   - Both press Claim at the same moment, and one presses it twice. Exactly one claim request leaves each device.
   - End: one preparator hears "You claimed Ganseys Drying." with focus on Mark hung. The other sees the card change in place to the winner's name, hears the lost-claim sentence, and finds focus on the card's title. The winner's laptop session shows the claim within seconds.
4. **Preparator and registrar finish a work.**
   - Start: "Lighthouse Log, Skerrin Point" hung, with no condition photo.
   - The registrar tries to sign it off and is told to add a condition photo first. They attach a photo. The card says it is uploading, and shows the photo as attached only once the image store confirms it.
   - End: they sign it off and the ledger reads Signed off. If the image store is down, its banner shows, the photo is never shown as attached, and every other action keeps working.
5. **Registrar registers a loan in inches.**
   - Start: the Loan register.
   - The registrar opens Add object by keyboard and submits it half filled. The error summary takes focus, and its links lead to each field. They fill in a 30 in by 24 in work with a 50 lux limit and a 30,000 lux-hour budget, and save.
   - They land on the new record's page with focus on its title. Switching Units to cm shows 76.2 × 61.0 cm, and switching back shows 30.0 × 24.0 in.
   - Back on the register they search, filter by lender and sort by title. Reloading the page and pressing Back both restore what they had. At 768 px the register is a list of cards.
   - End: the new record is in the register, and the other open workspaces show its card in the rail.
6. **Light budget check.**
   - Start: a curator in Light view with the North wall works placed.
   - The registrar lowers the lux-hour budget of "Herring Girls at the Gutting Station" below its planned lux-hours. Within seconds, the curator's Light view outlines that work in deep red with a hatched fill, the ledger reads Over budget, the count reads 1 over budget, and the change is announced.
   - The curator arrows to the work, opens Lux details with Enter, reads the figures and closes it with Escape. Focus is back on the handle.
   - End: the curator raises the East wall's lux several times in quick succession, and only the last value saved stands, on screen and on the server.
7. **Curator walks the eye line.**
   - Start: Plan view with a North wall work selected.
   - The curator presses 2. The plan picture dissolves into the wall view as the camera falls to eye height and turns to face the North wall, and the accent hang line fades in at 145 cm. They press 3, and the wall shading cross-fades into the lux map.
   - Reloading the page brings back Light view with the camera at eye height and the same work selected, with no animation.
   - End: with reduced motion on, each change is an instant cut to the same end state, and the view name is announced.
8. **Lender preview, from schedule to withdrawal.**
   - Start: preview in Draft.
   - The curator, on a phone, opens the Lender preview sheet, types a date and schedules it. The sheet shows Scheduled, the publish time the server returned and a countdown, even though the phone's clock is wrong. The address now opens the preview panel.
   - At the publish time the server publishes the preview by itself. The status turns to Live in place, the publish sentence is announced, and each lender with placed works gets one email. A lender opens their link and sees only their own works in place, with no insurance figures.
   - End: the curator withdraws the preview, every link says the preview has been withdrawn, and each lender gets a withdrawal notice.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Place a work on a wall** A curator places an unplaced object on a wall with `POST /api/placements` and gets `201` with the stored placement in millimetres, its planned lux, planned lux-hours and lux status, as defined in API.
- **DP-02 — Hang geometry rules** A placement or move is saved only when it passes the hang rules in Business rules (whole work on the wall, on the centre line or marked as an exception, clear of neighbours), and each rejection returns its published reason.
- **DP-03 — Light limit gates placement** A curator cannot place or move a work onto a wall lit above the work's lux limit; the server rejects it with the too-bright reason.
- **DP-04 — Place from the object rail** A curator places a work by keyboard alone from its rail card through the "Place work" dialog and its Wall combobox (at 375 px from inside the opened Objects sheet). Focus lands on the new work's handle, the placed sentence is announced, and other open workspaces show the work within the live-update delay with its team update.
- **DP-05 — Placement rejections in the dialog** A rejected placement keeps the "Place work" dialog open and moves focus to its error summary, whose link moves focus to the field concerned. The published reason is announced.
- **DP-06 — Work settles onto the hang line** A newly placed work settles onto its saved position within the timing in Motion and effects. With reduced motion it appears there at once, both on screen and in its scene marker's state.
- **DP-07 — Keyboard nudges along the wall** With a work's handle focused in the Scene ledger in Plan or Wall view, the arrow keys move the work along its wall by 1 cm (10 cm with Shift), and the move is saved once the keys rest, as described in Interactions.
- **DP-08 — Placement details dialog** Enter on a handle in Plan or Wall view opens the "Placement details" dialog. Tab and Shift+Tab stay inside it, Escape closes it, and focus returns to the same handle.
- **DP-09 — Rejected nudges snap back** When the server rejects a nudge, the work returns to its last saved position in the scene and ledger, and the published reason is announced.
- **DP-10 — Stale moves show the latest position** When a move is refused with `412`, the scene and ledger switch to the position the server returned and the stale-version sentence is announced.
- **DP-11 — Nudge from the keyboard** A curator tabs to a work's handle, nudges it and sets an exact offset in Placement details by keyboard alone, at 1280 px and in the phone ledger at 375 px. The saved offset shows in the ledger, in the API and in other open workspaces within the live-update delay.
- **DP-12 — Remove with a server-timed undo** Removing a proposed work returns an undo window that the server decides. Undo inside the window restores the work, and Undo after it is refused, as set out in Business rules.
- **DP-13 — Undo a move** Every move also returns an undo window. Undoing restores the previous position, unless the placement has changed since, in which case the undo is refused.
- **DP-14 — Undo toast survives the workspace** The undo toast keeps counting down from the server's remaining time, without resetting or closing early, through view changes, panel and dialog opens and closes, and data refreshes. Only a newer removal or move replaces it.
- **DP-15 — Undo by keyboard** Undo is reachable by Tab and by the published undo shortcut. Focus lands on the published target after Remove, after Undo and when the toast closes, as set out in Interactions.
- **DP-16 — Removal and undo seen by others** A curator's removal and its undo each show in other open workspaces within the live-update delay with their team updates, at 768 px as at 1280 px.
- **DP-17 — One claim wins** When several preparators claim the same proposed work at once, exactly one claim succeeds and every other gets `409` naming the winner.
- **DP-18 — No lost updates** Claims never change a work's position, and a move sent with an out-of-date version is refused with `412` instead of overwriting the newer position.
- **DP-19 — Lost claim updates in place** When a preparator's claim loses, that work's card changes in place to the winner's name, the published lost-claim sentence is announced, and focus moves to that card's title heading.
- **DP-20 — One request per claim press** While a claim is pending, further presses on that Claim button send nothing, so one press, or a rapid double press, yields exactly one claim request.
- **DP-21 — Claims reach every open session** A won claim shows within the live-update delay, with its team update, in every other open workspace, including the winner's own other sessions. At 375 px the Claim control is reached inside the opened Objects sheet.
- **DP-22 — Placement lifecycle** Placements move only along proposed, claimed, hung and signed off, plus release back to proposed and removal of proposed works. Every other transition is refused with `409`.
- **DP-23 — Role permissions** Each action is open only to the role Business rules gives it, and anyone else gets `403`.
- **DP-24 — Sign-off guards** A registrar can sign off a hung work only when it has a recorded condition photo and is within its light budget, and each refusal has its published sentence.
- **DP-25 — Install day from the rail** By keyboard alone, at 1280 px and from the Objects drawer at 768 px, a preparator claims a work and marks it hung, then a registrar signs it off. After each step the card and ledger show the new status, focus is on the published target, and other open workspaces update within the live-update delay.
- **DP-26 — Condition photo upload** A registrar attaches JPEG or PNG condition photos to an object. The server answers `201` only after the image store confirms the stored object, within the size and type limits in API.
- **DP-27 — Photos kept as uploaded** Every stored condition photo, and the bytes served back for it, are identical to the bytes uploaded.
- **DP-28 — Photo upload replay** Repeating a photo upload with the same idempotency key returns the original response and stores no second photo. Reusing the key for a different upload is refused.
- **DP-29 — Image store outage** While the image store is unreachable, photo uploads answer `503` and record nothing. The workspace shows the image store banner, and every other action keeps working.
- **DP-30 — Attached only after confirmation** A card shows the uploading message while it waits, shows a condition photo as attached only after the server's `201`, and never shows a failed upload as attached.
- **DP-31 — Record condition from the rail** A registrar attaches a photo by keyboard from a rail card (at 375 px inside the opened Objects sheet). The attached sentence is announced, and the new photo count shows in other open workspaces within the live-update delay.
- **DP-32 — Register an object** A registrar registers a work with its lender, dimensions, lux limit, lux-hour budget, insurance value and note, and gets `201` with the stored record.
- **DP-33 — Dimensions in cm or inches** Dimensions entered in centimetres or inches are stored once as whole millimetres by the conversion rule in Business rules.
- **DP-34 — Unit toggle without drift** The Units toggle redisplays every length from the stored millimetres, so a 30 in work always reads 76.2 cm and 30.0 in however often it is switched.
- **DP-35 — Object field errors** An invalid object form returns `422` with per-field messages. The form shows each message beside its field and moves focus to an error summary whose links move focus to each field.
- **DP-36 — Loan register in the address** The Loan register's search, lender filter, sort and order live in its URL, so a reload or Back restores the same list in the same order, as set out in Interactions.
- **DP-37 — Loan register layouts** At 1280 px the Loan register is a table with the published columns. Below 1024 px, including 768 px and 375 px, it is the published card list, with no horizontal overflow.
- **DP-38 — Search shows the latest query** Typing in the Loan register search shows only the results of the latest query, never an earlier query's results arriving late.
- **DP-39 — Add an object by keyboard** A registrar adds an object by keyboard alone from the Loan register and lands on the new record's URL with focus on its heading. Other open workspaces show the new card within the live-update delay.
- **DP-40 — Tighter limits re-flag placements** Lowering an object's lux limit or lux-hour budget below its planned values keeps the placement but marks it over budget in the API, scene and ledger.
- **DP-41 — Planned lux-hours on the server** The server computes each placement's planned lux-hours once, from its wall's lux and the exhibition's open hours, and returns it with the lux status.
- **DP-42 — Wall lighting changes** When a curator changes a wall's lux, every placement on that wall is recomputed in the same response. A level above a placed work's limit is accepted but flags that work over budget.
- **DP-43 — Light view status** In Light view, works within budget are outlined in ink and works over budget are outlined in deep red with a hatched fill, so status never depends on colour alone. Each work's scene marker reports the same status and overlay.
- **DP-44 — One over-budget count** After a placement or limit change, the scene, the Scene ledger's lux status column and the over-budget count all show the same server values.
- **DP-45 — Light view by keyboard** In Light view the arrow keys move focus between work handles, and Enter opens the "Lux details" dialog. The dialog keeps Tab inside, closes with Escape and returns focus to the same handle.
- **DP-46 — Lux legend disclosure** In Light view the lux legend shows in full at 1280 px. Below 1024 px it collapses behind the "Lux legend" button and is hidden and unreachable while collapsed.
- **DP-47 — Last lux entry wins** When a curator saves a wall's lux several times in quick succession, the wall ends at the last value saved, on the server and on screen. No earlier save's result is shown or announced after it.
- **DP-48 — Limit changes reach the Light view** A registrar's change to an object's limits shows in a curator's open Light view within the live-update delay, in the scene marker, ledger and count, with its team update.
- **DP-49 — View switch and shortcuts** The View group's Plan, Wall and Light buttons show which view is pressed. The keys 1, 2 and 3 switch views from any workspace control except text fields, and each settled change announces its view sentence.
- **DP-50 — Eye-line drop** Choosing Wall from Plan dissolves between the views while the camera falls to eye height facing the selected wall, then the hang line fades in, within the timing in Motion and effects.
- **DP-51 — Light cross-fade** Choosing Light cross-fades the current view into the lux map within the timing in Motion and effects, and the camera stays where it was.
- **DP-52 — Reduced-motion cuts** With reduced motion requested, every view change is an instant cut to the same final camera, hang line and overlay, and nudges move with no tween.
- **DP-53 — Flat drawing without WebGL** Without WebGL, the scene region shows a still flat drawing of the current view with the published notice, and the ledger, views and nudges still work.
- **DP-54 — View and selection in the address** The workspace URL carries the current view and selected work, and loading it restores both at once with no transition, as set out in Interactions.
- **DP-55 — Walk the eye line** A curator moves through Plan, Wall and Light by keyboard at 1280 px and at 375 px, where the View group sits above the scene. Each settled view matches the scene state table.
- **DP-56 — Touch drag** On a touch screen, dragging a work with one finger moves it along its wall in 1 cm steps, and lifting the finger saves it as one move.
- **DP-57 — Two-finger orbit** Dragging with two fingers orbits the camera within the limits in Interactions, also with reduced motion.
- **DP-58 — Tablet two-pane layout** At 768x1024 the scene and inspector sit side by side. The object rail opens only from the Objects button, as a drawer that is hidden and unreachable while closed.
- **DP-59 — Phone bottom sheet** At 375x812 the scene takes the full width. The object rail is a bottom sheet whose contents cannot be seen, focused or reached by Tab until the Objects button opens it.
- **DP-60 — Adjust on the tablet** At 768 px with touch, a preparator opens the Objects drawer, claims a work, closes the drawer, drags the work 3 cm and marks it hung. Each saved step is announced and shows in other open workspaces within the live-update delay.
- **DP-61 — Schedule the lender preview** A curator schedules the preview for a date. The server fixes the publish time at 09:00 museum time on that date and refuses dates that are too soon, as qualified in Business rules.
- **DP-62 — Preview schedule transitions** The preview moves only along draft, scheduled, published and withdrawn, plus cancelling back to draft and rescheduling after withdrawal. Every other transition is refused with `409`.
- **DP-63 — Preview status from the server** The preview status, publish time and countdown shown come only from the server's response, and they are correct even when the device clock is wrong.
- **DP-64 — Publish countdown keeps time** The publish countdown continues from the server's remaining time through re-renders, view changes, panel opens and a tab switch, and never restarts, as set out in Interactions.
- **DP-65 — Status goes Live in place** When the server publishes the preview, the open workspace's preview status changes from Scheduled to Live in place, with no reload, within the delay in Business rules, and the publish sentence is announced.
- **DP-66 — Preview sheet on the phone** At 375x812 the Lender preview panel is a bottom sheet opened by the Lender preview button. It keeps Tab inside while open and is hidden and unreachable while closed.
- **DP-67 — Preview panel in the address** Scheduling, cancelling or withdrawing the preview leaves the workspace on the published preview URL with focus on the Lender preview heading, and loading that URL opens the panel again.
- **DP-68 — Publish on time** When the publish time passes, the server itself flips the preview to published, freezes one snapshot per lender with placed works, and sends each such lender one email.
- **DP-69 — Lender preview email** Each lender receives one preview email from the published sender with the published subject, naming only their own works and carrying their own preview link.
- **DP-70 — Lender preview page** A lender who follows the link sees a read-only page with the exhibition title, their own name, and only their own works in place, in the published layouts at each viewport, with a keyboard-operable view switch kept in the URL.
- **DP-71 — Nothing private reaches lenders** No preview email, page, preview API response or snapshot contains an insurance value, a registrar note, or any other lender's name or works.
- **DP-72 — Snapshots kept as frozen** Each lender's snapshot JSON and PNG are stored at publish time and served back byte for byte, unchanged by later edits.
- **DP-73 — Capability links** Each preview link is unguessable, scoped to one lender and read-only (`405` for any write). Rescheduling after withdrawal replaces it with a new link.
- **DP-74 — Withdraw the preview** Withdrawing a published preview makes every link answer `410` at once and sends a withdrawal notice to each lender who received the preview.
- **DP-75 — Mail relay outage** While the mail relay is unreachable, the preview still publishes on time, each recipient's email waits as queued, and the Recipients list and the mail banner show it, as set out in Services.
- **DP-76 — Recipients update in place** The Recipients list follows each email's delivery state from the server and updates in place without a reload, within the delay in Interactions.
- **DP-77 — Health and run manifest** The app installs, builds and serves from `/app/run.json` and answers its health check, as set out in Deployment.
- **DP-78 — Database outage** While the database is unreachable, the app starts and stays up, answers its health check, and answers data requests with `503`.
- **DP-79 — Database banner holds the page** While the database reads down, every staff page shows the database banner, moves focus to its Try again button and keeps the rest of the page unreachable. On recovery it releases the page and moves focus to the page's main heading.
- **DP-80 — Services recover without reload** The workspace learns service state only from the server's status, which re-probes every service on the interval in Services. Each banner shows exactly while its service reads down, without a page reload or a server restart.
- **DP-81 — Team updates** Every state change made in another session is announced in the Team updates region with its published sentence. Changes made in the same browser tab are never announced there.
- **DP-82 — Desk three-column layout** At 1280x800 the object rail, the scene with its ledger, and the inspector sit in three columns divided by thin ink rules, with no horizontal overflow at any published viewport.
- **DP-83 — Skip link first** On every page the first Tab stop is the "Skip to main content" link, which moves focus to the main landmark.
- **DP-84 — Reduced motion everywhere** With reduced motion requested, no animation or transition on any page lasts longer than the reduced limit in Motion and effects, and nothing repeats.
- **DP-85 — Published copy verbatim** Every string this brief prints in backticks renders and is announced character for character.
- **DP-86 — Server boundary** The server is same-origin only, enforces the request size limits, and never serves source files or credentials, as set out in Server boundary.
- **DP-87 — Credentials from the environment** Every service URL and credential is read from the environment at start and is never hard-coded or sent to the browser.
- **DP-88 — Hushed exhibition look** The staff pages and lender page follow Visual design: a warm plaster ground, ink text, no surface shadows, serif type only for the exhibition and gallery titles and the Loan register heading, and tabular figures with units.
- **DP-89 — Gallery scene craft** The 3D gallery is built from procedural geometry, with lit walls, works shown at their true proportions, and the accent hang line in Wall view.

## Frontend

### Screens and layout (DP-04, DP-11, DP-21, DP-37, DP-55, DP-58, DP-59, DP-66, DP-70, DP-82)

**Breakpoints.** These are the published layouts on every page. Width is the browser viewport width.

| Layout | Widths | Published size |
|---|---|---|
| desk | 1024 px and up | 1280x800 |
| tablet | 600 to 1023 px | 768x1024 |
| phone | below 600 px | 375x812 |

No other breakpoint changes which layout a published size gets. No page scrolls sideways at any published size.

**Staff header** (workspace, Loan register and record pages), in Tab order:
1. the skip link
2. the product name `Hangline`
3. the Sections navigation (Gallery, Loan register)
4. the "Working as" picker
5. the Units toggle
6. on the workspace at desk and tablet, the View group

At phone the header wraps onto two lines and the navigation stays visible.

**Staff workspace (`/`).** The page has these parts:
- **Exhibition titles:** the exhibition title as the main heading and the gallery name under it.
- **Object rail:** one card per object. Each card has a title heading and shows:
  - object number
  - lender name (or `Ashgrove collection`)
  - dimensions
  - lux limit
  - placement status
  - condition photo count
  - the actions the current role may take now
  - a link to the object's record
- **Scene column:** the 3D gallery, then the over-budget count, then the Scene ledger with its heading. In Light view the lux legend sits directly above the scene.
- **Inspector:** the selected work's details, the Walls section (one lux level per wall) and, at desk and tablet, the Lender preview section.
- **Undo toast:** anchored to the bottom of the scene column, above the phone bar.

Workspace layouts:
- **Desk:** three columns, left to right:
  - object rail, about 280 px
  - scene column, the remaining middle, about 60%
  - inspector, about 320 px

  Thin one-pixel ink rules divide the columns. The Objects and Lender preview buttons are not shown. The lux legend shows in full.
- **Tablet:** two panes, the scene column on the left and the inspector (about 320 px) on the right. The rail is closed by default. The Objects button in the header opens it as a drawer over the left side of the scene. The Lender preview section stays in the inspector. The lux legend collapses behind its disclosure button.
- **Phone:** a single column in this order:
  1. header
  2. View group (full width, three equal buttons)
  3. scene at full width
  4. over-budget count
  5. Scene ledger
  6. inspector without its Lender preview section

  A bar fixed to the bottom edge holds the Objects button and the Lender preview button. Each opens its own bottom sheet: the rail, or the Lender preview section. Opening one sheet closes the other. At phone the Scene ledger shows only the Work, Offset, Lux status and Status columns; the other four columns are not rendered. The lux legend collapses behind its disclosure button.

**Closed means unavailable.** A closed drawer, sheet or collapsed legend is hidden and inert at every viewport: nothing inside it is visible, focusable or in the accessibility tree. Moving it off-screen does not count as closing it. The rail at desk and the Lender preview section at desk and tablet are never closed.

**Loan register (`/records`).** The page contains, in order:
1. the main heading `Loan register`
2. the controls: search, lender filter, sort and order, and, for registrars, Add object
3. the result count
4. the records

Desk shows the records as a table with these columns, in this order: Object number, Title, Lender, Dimensions, Lux limit, Lux-hour budget, Insurance value, Condition, Placement. The Title cell links to the record. Tablet and phone show the records as a list of cards. Each card shows the same nine values with their column names as labels, and its title links to the record. At phone the controls stack one per line.

**Object record (`/records/<object id>`).** The page contains:
- the object title as the main heading
- object number, lender, medium, dimensions, lux limit, lux-hour budget, insurance value, registrar note, condition photo count and placement status, as labelled lines
- Edit record (registrars only)
- a link back to the Loan register

At desk the labelled lines sit in two columns. At tablet and phone they sit in one column. An unknown id shows the not-found heading from Feedback states.

**Lender preview page (`/p/<token>`).** Contents, top to bottom:
1. the exhibition title as the main heading
2. the line `Prepared for <lender name>`
3. `Published <published display>`
4. a preview scene with a Plan and Wall view switch, showing the gallery walls and only this lender's works
5. the heading `Your works in place` and a list of the lender's works

The list is ordered by wall (North, East, South, West), then by offset. Each item shows:
- title
- object number
- wall name
- `Offset <length> from the left end`
- `Centre <length> from the floor`
- dimensions, all in centimetres

The page has no editing controls. At phone the parts stack in that order. At tablet and desk the scene (about 60%) and the list sit side by side under the heading lines. `<lender name>` is the lender's seeded name. `<length>` follows the length format in Business rules.

### Public screens and controls (DP-04, DP-08, DP-15, DP-19, DP-30, DP-35, DP-45, DP-46, DP-49, DP-58, DP-59, DP-66, DP-70, DP-79, DP-81, DP-83)

Only these roles and names are public. Everything else is free.

| Region or control | Role and accessible name | Visible copy and notes |
|---|---|---|
| Skip link | `link "Skip to main content"` | first Tab stop on every page. It is visible while focused and moves focus to the `main` landmark. |
| Sections | `navigation "Sections"` with `link "Gallery"` (`/`) and `link "Loan register"` (`/records`) | the current page's link has `aria-current="page"` |
| Exhibition title | heading level 1 on the workspace | the exhibition title (seed) |
| Gallery name | heading level 2 on the workspace | the gallery name (seed) |
| Staff picker | `combobox "Working as"` | options read `<staff name> (<role>)`. The choice is remembered on the device. |
| Units toggle | `radiogroup "Units"` with `radio "cm"`, `radio "in"` | default cm |
| View switch | `group "View"` with `button "Plan"`, `button "Wall"`, `button "Light"` | exactly one has `aria-pressed="true"` |
| Rail toggle | `button "Objects"` | tablet and phone only. `aria-expanded` reflects the drawer or sheet. |
| Preview sheet toggle | `button "Lender preview"` | phone only. `aria-expanded` reflects the sheet. |
| Object rail | `region "Objects"` containing `list "Objects"` | each card is a `listitem` whose accessible name is the object title, with a heading level 3 holding the title |
| Card status | text in the card | `Not placed`, `Proposed`, `Claimed by <staff name>`, `Hung`, `Signed off` |
| Card photo count | text in the card | `No condition photo`, `1 condition photo`, `<n> condition photos` |
| Card actions | `button "Place"`, `button "Claim"`, `button "Release"`, `button "Mark hung"`, `button "Sign off"` | each shown only when the current role may take that action now |
| Card record link | `link "Open record"` | goes to `/records/<object id>` |
| Photo input | file input labelled `Condition photo for <title>` | registrar only. Accepts JPEG and PNG. |
| Place dialog | `dialog "Place work"` with `combobox "Wall"`, `textbox "Offset from left end"`, `textbox "Centre height"`, `checkbox "Off the centre line (exception)"`, `button "Save placement"`, `button "Cancel"` | Centre height is prefilled with 145 cm in the current unit |
| Error summary | `alert` at the top of a dialog or form, headed by its summary line, with one `link` per field error | copy in Feedback states. The link text is the field's message. |
| Scene | `region "Gallery scene"` containing the 3D canvas | carries `data-view` (`plan`, `wall`, `light`), `data-transitioning` (`true` or `false`), `data-camera-height-cm` (whole centimetres), `data-camera-yaw-deg` (whole degrees, 0 to 359) and `data-hang-line` (`visible` or `hidden`). Motion and effects defines these values. |
| Eye height readout | text in the scene | `Eye height 145 cm` when the camera is at eye height. `Plan view` when the camera is at plan height. |
| Work markers | one element per placed work inside `region "Gallery scene"`, laid over that work, in the 3D scene and the flat drawing alike | carries `data-placement-id` (the placement id), `data-lux-status` (`within` or `over`, the server's `luxStatus`), `data-settling` (`true` or `false`), and `data-overlay`: `ink-outline` for `within` and `red-hatch` for `over` in Light view, `none` in Plan and Wall view |
| Lux legend | `region "Lux legend"` | shown only in Light view. Holds `Within limit: ink outline` and `Over budget: red outline with hatching`. |
| Legend toggle | `button "Lux legend"` | tablet and phone only, in Light view. `aria-expanded` reflects the legend. Collapsed by default. |
| Scene ledger | heading level 2 `Scene ledger`, then `table "Scene ledger"` | columns: Work, Wall, Offset, Centre height, Lux, Lux-hours, Lux status, Status (four of them at phone, as in Screens and layout) |
| Work handle | `button "<title>"` in the Work cell of each ledger row | selects the work. Keys as in Interactions. |
| Lux status cell | text | `Within limit` or `Over budget` |
| Over-budget count | text above the ledger | `<n> over budget` |
| Inspector | `region "Inspector"` | the selected work's details, with `button "Remove from wall"` (curator, proposed works) and `button "Details"` |
| Placement details | `dialog "Placement details"` with `textbox "Offset from left end"`, `textbox "Centre height"`, `checkbox "Off the centre line (exception)"`, `button "Save"`, `button "Close"` | curators also get `combobox "Wall"` |
| Lux details | `dialog "Lux details"` with `button "Close"` | lines `Planned lux <lux> lux`, `Lux limit <limit> lux`, `Planned lux-hours <lux-hours>`, `Lux-hour budget <budget>`, `Status <Within limit or Over budget>` |
| Walls | `region "Walls"` with, per wall, `textbox "Lux on <wall name>"` and `button "Save lux for <wall name>"` | editable by curators. Read-only text for others. |
| Lender preview | `region "Lender preview"` with heading level 2 `Lender preview` | status word `Draft`, `Scheduled`, `Live` or `Withdrawn`. Also `Publishes <publish display>` and `Publishes in <countdown>` (or `Publishing now`) when scheduled, `Published <published display>` when live, and `Withdrawn <withdrawn display>` when withdrawn. |
| Preview controls | `textbox "Preview date"` (format YYYY-MM-DD) with the hint `Publishes at 09:00 Europe/London time on the date you choose.`, `button "Schedule preview"`, `button "Cancel schedule"`, `button "Withdraw preview"` | curator only. Each is shown only in the states that allow it. |
| Recipients | `list "Recipients"` | `<lender name>: Sent`, `<lender name>: Waiting for mail relay`, or `<lender name>: Not sent` |
| Undo toast | `region "Undo"` with `button "Undo"` | `<title> removed.` or `<title> moved.`, and `<seconds> s left` |
| Announcements | `status "Announcements"` (polite live region) | results of this tab's own actions, as in Feedback states |
| Team updates | `status "Team updates"` (polite live region) | changes made in other sessions, as in Feedback states |
| Service banners | `alert` elements at the top of every staff page | the banner copy in Feedback states, one per service that is down. The database banner holds `button "Try again"`. |
| Register search | `searchbox "Search records"` | matches title or object number |
| Lender filter | `combobox "Lender filter"` | options `All lenders`, `Ashgrove collection`, then each lender name |
| Sort | `combobox "Sort by"` with options `Object number`, `Title`, `Lender`, `Lux limit`; `radiogroup "Order"` with `radio "Ascending"`, `radio "Descending"` | defaults Object number, Ascending |
| Result count | `status "Records count"` | `1 record` or `<n> records` |
| Register table | `table "Loan register"` (desk) or `list "Loan register"` (tablet and phone) | columns or labels as in Screens and layout |
| Add object | `button "Add object"` on the Loan register, opening `dialog "Add object"` | registrar only |
| Edit record | `button "Edit record"` on a record page, opening `dialog "Edit object"` with the same fields | registrar only |
| Object form fields | `textbox "Title"`, `textbox "Object number"`, `combobox "Lender"`, `textbox "Medium"`, `textbox "Width"`, `textbox "Height"`, `textbox "Lux limit"`, `textbox "Lux-hour budget"`, `textbox "Insurance value"`, `textbox "Registrar note"`, `button "Save object"`, `button "Cancel"` | Width and Height use the current Units choice, shown as a unit label next to each field |
| Record heading | heading level 1 | the object title |
| Lender page | heading level 1 (exhibition title), heading level 2 `Your works in place`, `list "Your works"`, `region "Preview scene"` with `group "View"` holding `button "Plan"` and `button "Wall"` | read-only |
| Lender page errors | heading level 1 | copy in Feedback states |

`<staff name>` and `<title>` are seeded or entered names, shown exactly as stored. `<seconds>` is a whole number of seconds remaining. `<countdown>` is described in Interactions. In Lux details:
- `<lux>` and `<limit>` are whole lux, written in the format in Visual design.
- `<lux-hours>` and `<budget>` are lux-hour figures in the format in Visual design, followed by ` lux-hours`.

### Interactions (DP-04, DP-05, DP-07, DP-08, DP-09, DP-10, DP-14, DP-15, DP-19, DP-20, DP-36, DP-38, DP-45, DP-46, DP-47, DP-54, DP-56, DP-57, DP-64, DP-67, DP-70, DP-76, DP-79, DP-81)

**Working as.** Choosing a staff member sends that staff id with every API request and redraws the card actions for that role. There is no sign-in.

**Keyboard everywhere.** Every action on every page can be done by keyboard alone, with pointer and touch as extra paths. Tab order follows the visual order of the current layout.

**Dialogs.** These rules apply to Place work, Placement details, Lux details, Add object and Edit object:
- Each opens as a modal.
- Focus starts on its first field. In Lux details, focus starts on Close.
- Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last.
- Escape or Cancel/Close closes the dialog, and focus returns to the control that opened it.

**Drawer and sheets.**
- The Objects button opens the rail. The Lender preview button (phone) opens the preview sheet.
- On opening, focus moves to the first card, or to the `heading "Lender preview"`.
- Tab and Shift+Tab wrap inside the open drawer or sheet.
- Escape, pressing its button again, or tapping outside closes it, and focus returns to its button.

**Placing.**
- Place on a card opens the Place work dialog. Save placement sends the placement.
- On success, the dialog closes, and so does the drawer or sheet it came from. The work appears in the scene, a ledger row appears, and the placed sentence is announced.
- On a rejection, the dialog stays open and the reason appears under the field it concerns. The error summary takes focus and the reason is announced. The field each reason concerns:
  - wall: too bright
  - offset: off the wall, too close
  - centre height: off the centre line
- Following a summary link moves focus to its field.

**Selecting.** Clicking or tapping a work in the scene, or pressing its handle, selects it. A selection outline fades in around the work, and the inspector shows the work. Selecting never moves the camera.

**Keyboard nudges (Plan and Wall view).**
- With a handle focused, Left and Right move the work along its wall by 1 cm per press, or 10 cm with Shift held.
- Up and Down do the same for centre height, but only for works marked as an exception.
- The scene and ledger follow each press at once.
- The presses are saved together as one move half a second after the last press.
- If the server rejects the save, the work returns to its last saved position and the reason is announced.
- If the server answers `412`, the scene and ledger show the placement it returned, and the stale-version sentence is announced.
- A work the current person may not move does not budge, and the not-movable sentence is announced.

**Placement details.** Enter on a handle (or Details in the inspector) opens the Placement details dialog. Save behaves like a nudge save, then closes the dialog.

**Light view keys.** In Light view, nudging is off:
- Left and Up on a handle move focus to the previous handle in the ledger.
- Right and Down move focus to the next handle in the ledger.
- Focus stops at the first and last handle.
- Enter opens the Lux details dialog for that work.

**Lux legend.** Below 1024 px, the Lux legend button expands and collapses the legend. The legend starts collapsed each time Light view opens.

**Wall lux.** Saving a wall's lux sends the value. If the curator saves again before the earlier save has answered, the saves are sent one after another in the order made, and the wall ends at the last value saved. The screen and the announcement show only the result of the last save. An earlier save's result or error is never shown after a later save has been made.

**View shortcuts.** The keys 1, 2 and 3 choose Plan, Wall and Light. They work whichever workspace control has focus (a card button, a handle, the scene), except while typing in a text field or while a dialog is open.

**Workspace URL.** The workspace URL is `/` with these optional query parameters:
- `view`: `plan` (the default, omitted), `wall`, `light` (Light with the camera at plan height) or `light-eye` (Light with the camera at eye height).
- `work`: the selected placement id.
- `panel=preview`: set by the preview actions below.

Every view change and selection replaces the current address without a reload and without adding a history entry. Loading a workspace URL restores the view, camera and selection as an instant cut with no transition. An unknown `work` id leaves nothing selected and is dropped from the address.

**Orbit limits.** Orbiting changes only the camera yaw, never its height.
- At plan height (Plan view, and Light view entered from Plan), the orbit is free all the way round.
- At eye height (Wall view, and Light view entered from Wall), the yaw is held to 30 degrees either side of the facing yaw of the wall the camera faces, as defined in Motion and effects.

**Mouse.**
- Dragging a work moves it along its wall in 1 cm steps and saves it as one move on release.
- Dragging empty space orbits within the orbit limits.
- The wheel zooms between half and double the default distance.

**Touch.**
- One finger on a work drags it along its wall in 1 cm steps. Lifting the finger saves it as one move.
- Two fingers dragging sideways orbits within the orbit limits.
- Pinching zooms between half and double the default distance.
- Orbit and zoom work the same with reduced motion.

**Undo.**
- Undo in the toast, or Control+Z or Command+Z while the toast is shown, sends the undo. The shortcut works from any workspace control except text fields, and not while a dialog is open.
- The toast sits in Tab order directly after the scene region.
- The toast stays through view changes, dialog, drawer and sheet opens and closes, selection changes and data refreshes. A newer removal or move replaces it.
- Its countdown starts from the server's `remainingMs`, rounded up to whole seconds. It counts down by the time elapsed on the device since that response, and never restarts. When it reaches zero, the toast disappears.

**Claims.**
- While a claim is pending, its Claim button ignores further presses and shows the pending mark.
- A won claim replaces Claim with Release and Mark hung.
- A lost claim changes the card in place to `Claimed by <winner name>`, removes its Claim button, and announces the lost-claim sentence.

**Loan register URL.** The register URL is `/records`, with these query parameters, each omitted at its default:
- `q`: the search text
- `lender`: a lender id or `collection`
- `sort`: `number`, `title`, `lender` or `lux`
- `dir`: `asc` or `desc`

Choosing a lender filter, sort or order adds a history entry. Typing in the search replaces the current entry. Loading or going Back to a register URL restores the controls and shows the list the server returns for them.

**Search as you type.** The register asks the server for results at most 300 ms after the last keystroke. Only the response to the latest query is ever shown. A response to an earlier query that arrives later is dropped. The result count updates with each shown result.

**Preview countdown.**
- While the preview is scheduled, the panel shows `Publishes in <countdown>`. `<countdown>` is hours (no padding), minutes and seconds, as `H:MM:SS`. It counts down from the server's `remainingMs`, rounded up to whole seconds, by the time elapsed on the device since that response.
- Each preview response re-syncs it. When the tab becomes visible again it re-syncs from a fresh preview response. Re-renders, view changes and panel opens never restart it.
- At zero it shows `Publishing now` until the server reports the preview published. The device clock never decides the status.

**Live data.**
- Every open staff page asks the server for new events at least every 2 seconds and refreshes the data each event concerns.
- Each page also refreshes the preview and its recipients at least every 5 seconds. Service status follows Services.
- The live-update delay is 5 seconds: a change made in one session shows in every other open session within 5 seconds of the server's response to the action, with no reload.
- A refresh never replaces an error or status message that this tab's own action has just shown. The message stays until the person's next action, or for at least 5 seconds.

**Focus after each action.**

| After | Focus lands on |
|---|---|
| Place saved | the new work's handle in the Scene ledger |
| Place, object form or Placement details rejected | the error summary of that dialog |
| Placement details saved, closed or escaped | the handle that opened it |
| Nudge or drag saved, rejected or stale | stays where it was |
| Remove from wall | `button "Undo"` |
| Undo accepted | the restored or moved work's handle |
| Undo refused, or the toast closes by countdown while focus is inside it | `heading "Scene ledger"` |
| Claim won | `button "Mark hung"` on that card |
| Claim lost | that card's title heading |
| Release | `button "Claim"` on that card |
| Mark hung, Sign off (accepted or refused) | that card's title heading |
| Condition photo attached or failed | stays on the photo input |
| Wall lux saved or rejected | stays on that wall's Save lux button |
| Add object saved | the record page's main heading, at `/records/<new object id>` |
| Edit object saved | the record page's main heading |
| Schedule, Cancel schedule, Withdraw preview accepted | `heading "Lender preview"`, with the address set to `panel=preview` (other parameters kept); at phone the preview sheet stays open |
| Schedule refused for the date | `textbox "Preview date"` |
| Loading a URL with `panel=preview` | `heading "Lender preview"`; at phone the preview sheet opens |
| View change | stays where it was |
| Database recovery | the page's main heading |

If a refresh removes the control that has focus, focus moves to the nearest published heading:
- the card's title heading for a rail control
- `heading "Scene ledger"` for a ledger handle
- `heading "Lender preview"` for a preview control

Focus is never left on a removed element.

**Lender page.**
- Plan and Wall switch the preview scene. The URL carries `?view=wall` for Wall and omits it for Plan, and loading the URL restores the view.
- Wall view faces the wall of the first work in the list.
- Dragging orbits the preview scene within the same limits as the workspace. The lender's works cannot be moved.

**Database banner.** While the database reads down, focus moves to the banner's Try again button, and everything on the page outside the banners is inert. Tab and Shift+Tab stay on Try again. Try again re-reads the server status at once and refreshes the page data. When the database reads up again, the banner disappears, the page becomes usable again, focus moves to the page's main heading, and the recovery sentence is announced.

### Visual design (DP-88)

- **Colour:**
  - **Ground:** warm plaster white across every page.
  - **Ink:** a near-black ink for text, rules and outlines.
  - **Walls:** a warm stone grey for gallery walls in the scene.
  - **Accent:** a burnt orange, used only for the hang line, focus rings, the pressed view button's marker and the progress mark on busy buttons. Small text is never set in the accent.
  - **Over budget:** a deep brick red, reserved for over-budget works, always together with a diagonal hatch and the words `Over budget`.
  - **Primary buttons:** ink fill with plaster-white text.
- **Surfaces:** panels have no surface shadows and no gradients. They are separated only by thin one-pixel ink rules.
- **Type:**
  - A slender, high-contrast display serif (Instrument Serif), used only for the exhibition and gallery titles and the Loan register heading.
  - A plain, open neo-grotesk (Hanken Grotesk) for everything else.
  - Each heading step is a quarter larger than the one below it.
  - Every number appears in tabular figures with its unit (`145.0 cm`, `50 lux`, `34,300`).
  - Lengths and whole lux carry no thousands separator, even at 1000 or more: for example, 10,500 mm reads `1050.0 cm` and a wall lit at 1000 lux reads `1000 lux`. Lux-hour figures (planned lux-hours and lux-hour budgets in the ledger and Lux details) carry comma thousands separators, for example `34,300`.
  - Fonts are served from the app's own origin.
- **Density:** comfortable, with generous space around the canvas.
- **Accessibility:** every tap target is at least 44 by 44 px. Text and controls meet WCAG 2.2 AA contrast. Focus rings are clearly visible, at least 3:1 against what is next to them.

### Motion and effects (DP-06, DP-43, DP-50, DP-51, DP-52, DP-53, DP-84, DP-89)

**The scene.** The 3D gallery is built entirely in code, with no imported models or textures:
- floor and four walls at their seeded lengths and heights, with soft, even light on the walls
- each placed work as a thin panel at its true width and height, at its stored offset and centre height
- a plain bordered frame per work, with no imagery

When nobody is touching it, the scene is completely still: no auto-rotation, no drifting light, no decorative loops of any kind on any page.

**Camera yaw.** `data-camera-yaw-deg` is the compass direction the camera faces, seen from above, in whole degrees from 0 to 359. 0 faces the North wall, and the value grows clockwise seen from above. Each wall's facing yaw:

| Wall | Facing yaw |
|---|---|
| North wall | 0 |
| East wall | 90 |
| South wall | 180 |
| West wall | 270 |

The workspace opens in Plan view with camera height 1800, yaw 0, the hang line hidden and `data-transitioning="false"`, unless its URL says otherwise. The wall a view change faces is fixed when the change starts: the wall of the selected work, or the North wall if nothing is selected.

**Motion:**
- **Selection:** the outline fades in over 150 to 250 ms.
- **Panels:** the drawer, the sheets and the legend slide or unfold in quickly and settle softly, in under 300 ms.
- **Settling onto the hang line:** a newly placed work first appears 10 cm above its saved centre. It settles down onto its saved position over 200 to 300 ms. Its marker reports `data-settling="true"` while it moves and `false` at all other times.
- **Feel:** every large move starts quickly and eases into a long, gentle stop.

**Signature: the eye-line drop.** Choosing Wall from Plan happens in this order:
1. The plan picture breaks up in a fine, irregular grain, and the wall view shows through as the grain clears.
2. At the same time, the camera falls from 1800 cm above the floor to 145 cm and turns to the facing yaw of the wall it faces. The dissolve and camera fall take 600 to 900 ms.
3. Then a one-pixel accent hang line fades in across the wall at 145 cm, over 150 to 250 ms.

Choosing Plan from Wall plays the same sequence in reverse: the hang line fades out, the camera rises back to 1800 cm and turns back to yaw 0, and the grain dissolves back to the plan.

**Light view.** Choosing Light from Plan or Wall cross-fades the wall shading into a false-colour lux map over 400 to 600 ms, and the camera keeps its height and yaw:
- Walls are tinted from pale (low lux) to warm (high lux).
- Works within their limit are outlined in ink.
- Works over budget are outlined in deep red with a diagonal hatched fill.

The Scene ledger's lux status column and the work markers update at the same moment, with the values the server returned.

**Scene state for every view change.**
- `data-transitioning` is `true` from the moment a view button or shortcut is chosen until every part of that change has settled, including the hang-line fade. It is `false` at all other times.
- Choosing the view that is already pressed does nothing.
- In the table, "facing yaw" means the facing yaw of the wall fixed at the start of the change, and "unchanged" means the value the scene reported when the change started.

After each change settles, the scene reports these values:

| Change | What plays | Camera height | Camera yaw | Hang line | Readout |
|---|---|---|---|---|---|
| Plan to Wall | the eye-line drop | 145 | facing yaw | `visible` | `Eye height 145 cm` |
| Wall to Plan | the eye-line drop in reverse | 1800 | 0 | `hidden` | `Plan view` |
| Plan to Light | the lux cross-fade; the camera stays above | 1800 | unchanged | `hidden` | `Plan view` |
| Wall to Light | the lux cross-fade; the camera stays at eye height, and the hang line stays drawn over the lux map | 145 | unchanged | `visible` | `Eye height 145 cm` |
| Light (from Plan) to Plan | the lux map fades out over 400 to 600 ms; the camera stays | 1800 | unchanged | `hidden` | `Plan view` |
| Light (from Plan) to Wall | the lux map fades out while the eye-line drop plays | 145 | facing yaw | `visible` | `Eye height 145 cm` |
| Light (from Wall) to Wall | the lux map fades out over 400 to 600 ms; the camera stays | 145 | unchanged | `visible` | `Eye height 145 cm` |
| Light (from Wall) to Plan | the lux map fades out while the reverse eye-line drop plays | 1800 | 0 | `hidden` | `Plan view` |

Loading a workspace URL lands on that view's final state from the table, as an instant cut. `light` lands on the Plan-to-Light state, and `light-eye` lands on the Wall-to-Light state, facing the selected work's wall.

**Reduced motion.** When the device asks for reduced motion:
- Every view change is an instant cut to the final camera height, yaw, hang line and overlay given in the table. `data-transitioning` never becomes `true`.
- A newly placed work appears at its saved position at once, and `data-settling` never becomes `true`.
- Nudges and drags move the work with no tween.
- The drawer, sheets, legend, toast and selection outline appear and disappear without sliding or fading.
- No animation or transition on any page lasts longer than 50 ms.
- Orbit and zoom still work.

**Without WebGL.** The scene region shows a still, flat line drawing of the current view: the plan as a top-down outline of walls and works, or Wall and Light as an elevation of the selected wall. It carries the notice from Feedback states. The work markers lie over the drawn works. The ledger, view buttons, selection and keyboard nudges keep working.

### Feedback states (DP-05, DP-09, DP-10, DP-12, DP-19, DP-24, DP-29, DP-30, DP-35, DP-49, DP-52, DP-65, DP-75, DP-78, DP-79, DP-80, DP-81, DP-85)

Every async action is shown in four states:
- **Pending:** the triggering button shows a small accent progress mark and ignores further presses. Nothing is announced.
- **Success:** the screen updates, and the success sentence is announced in `status "Announcements"`.
- **Field error:** the message sits under the field and in the error summary, and is announced.
- **Outage:** the service banner shows, and the failure sentence is announced.

Announcements never move focus. Every string below renders and is announced character for character, with straight apostrophes.

Placeholders:
- `<title>` is the object title.
- `<wall name>` is the seeded wall name.
- `<winner name>` is the claim holder's staff name.
- `<actor>` is the staff name of the person who made the change.
- `<length>` follows the length format in Business rules, in the current unit.
- `<lux>` and `<limit>` are whole lux, written in the format in Visual design.
- `<n>` is a whole number. In the publish sentence it is the number of recipients, meaning lenders given a link, whatever their delivery state.
- `<publish display>` is the server's `publishAtDisplay`.

**This tab's own actions** (`status "Announcements"`):

| Action | Success announcement | Failure announcement or message |
|---|---|---|
| Place | `<title> placed on <wall name>.` | rejection reasons below |
| Move (nudge, drag, dialog save) | `<title> moved to <length> from the left end.` | rejection reasons below; stale version: `Someone else moved <title>. Showing the latest position.`; not movable: `You can't move <title> in its current state.` |
| Remove | `<title> removed from <wall name>.` | — |
| Undo | `Undone: <title> is back where it was.` | expired: `Too late to undo: the 10-second window has closed.`; changed since or already undone: `Can't undo: <title> has changed since.` |
| Claim | `You claimed <title>.` | lost: `<winner name> claimed <title> first.` |
| Release | `You released <title>.` | — |
| Mark hung | `<title> marked hung.` | — |
| Sign off | `<title> signed off.` | no photo: `Add a condition photo before signing off <title>.`; over budget: `<title> is over its light budget and can't be signed off.` |
| Condition photo | `Condition photo attached to <title>.` | image store down: `Condition photo not attached to <title>. The image store is unavailable.`; too large: `That photo is over 10,000,000 bytes.`; wrong type: `Use a JPEG or PNG photo.` |
| Save object | `<title> saved.` | field errors below |
| Wall lux | `<wall name> lighting set to <lux> lux.` | field error below |
| Schedule preview | `Preview scheduled for <publish display>.` | field errors below |
| Cancel schedule | `Preview schedule cancelled.` | — |
| Withdraw preview | `Preview withdrawn. Lender links no longer work.` | — |
| View change (after it settles, or at once with reduced motion) | `Plan view.`, `Wall view.`, `Light view.` | — |
| Database back | `Database connection restored.` | — |

**Changes from other sessions** (`status "Team updates"`):
- Each event that reaches a tab and that tab did not cause is announced with the sentence for its kind.
- When one refresh brings several events, the region shows their sentences in event order, separated by one space.
- A newly opened page announces nothing from before it opened.

| Event kind | Sentence |
|---|---|
| `placement.placed` | `<actor> placed <title> on <wall name>.` |
| `placement.moved` | `<actor> moved <title> to <length> from the left end.` |
| `placement.removed` | `<actor> removed <title> from <wall name>.` |
| `placement.restored` | `<actor> put <title> back on <wall name>.` |
| `placement.claimed` | `<actor> claimed <title>.` |
| `placement.released` | `<actor> released <title>.` |
| `placement.hung` | `<actor> marked <title> hung.` |
| `placement.signed_off` | `<actor> signed off <title>.` |
| `object.created` | `<actor> added <title> to the loan register.` |
| `object.updated` | `<actor> updated the record for <title>.` |
| `photo.attached` | `<actor> attached a condition photo to <title>.` |
| `wall.lux_changed` | `<actor> set <wall name> lighting to <lux> lux.` |
| `preview.scheduled` | `<actor> scheduled the lender preview for <publish display>.` |
| `preview.cancelled` | `<actor> cancelled the lender preview schedule.` |
| `preview.published` | `Preview published. Lenders notified: <n>.` |
| `preview.withdrawn` | `<actor> withdrew the lender preview.` |

`preview.published` is made by the server, so it is announced in every open tab.

**Condition photo upload.** While a condition photo uploads, the card shows `Uploading condition photo...` and the photo count does not change. Only the server's `201` adds the photo to the count. A failed upload leaves the count as it was.

**Placement rejection reasons.** These are shown in the dialog or announced, and returned as the API `message`:
- off the wall: `Runs off the wall: keep the whole work on <wall name>.`
- off the centre line: `Off the 145 cm centre line: set the centre height to 145 cm or mark it as an exception.`
- too close: `Too close to <neighbour title>: keep at least 20 cm between works.` `<neighbour title>` is the title of the neighbour whose gap is smallest; on a tie, the one with the lower offset.
- too bright: `Too bright for this work: <wall name> is lit at <lux> lux and the limit is <limit> lux.`

**Error summary.** The summary line is `Fix these to continue:`, followed by one link per field error, in form order.

**Field errors:**

| Field | Message |
|---|---|
| title | `Enter a title.` |
| objectNumber, empty | `Enter an object number.` |
| objectNumber, duplicate | `That object number is already in use.` |
| lenderId | `Choose a lender or the Ashgrove collection.` |
| medium | `Keep the medium to 120 characters or fewer.` |
| width | `Enter a width above 0 and up to 20 metres, with at most 1 decimal in cm or 2 in inches.` |
| height | `Enter a height above 0 and up to 20 metres, with at most 1 decimal in cm or 2 in inches.` |
| unit | `Choose cm or in.` |
| luxLimit | `Enter a lux limit from 1 to 1000.` |
| luxHourBudget | `Enter a lux-hour budget from 1 to 10,000,000.` |
| insuranceValueGbp | `Enter an insurance value in whole pounds.` |
| registrarNote | `Keep the note to 2000 characters or fewer.` |
| plannedLux | `Enter a lux level from 1 to 1000.` |
| offsetMm, centreHeightMm | `Enter a whole number of millimetres.` |
| date, badly formed | `Enter a date as YYYY-MM-DD.` |
| date, too soon | `Choose a later date: 09:00 museum time on that date is less than 2 hours away.` |

**Service banners** (`alert`, one per service that is down):
- database: `Hangline can't reach its database. Changes are paused until it's back.`, with `button "Try again"`
- image store: `Image store unavailable. Condition photos can't be attached right now.`
- mail relay: `Mail relay unavailable. Preview emails will be sent when it's back.`

**Other copy:**
- no WebGL notice: `3D view isn't available on this device. Showing a flat drawing instead.`
- Loan register with no matches: `No records match.`
- record page, unknown id (heading): `That record doesn't exist.`
- lender page, unknown link (heading): `This preview link isn't valid.`
- lender page, withdrawn link (heading): `This preview has been withdrawn by the museum.`
- lender page, database unreachable (heading): `This preview can't be shown right now. Please try again later.`

## Backend

### API (DP-01, DP-12, DP-13, DP-17, DP-18, DP-26, DP-28, DP-32, DP-38, DP-61, DP-62, DP-70, DP-73, DP-74, DP-81)

**Conventions:**
- **Bodies:** requests and responses are `application/json; charset=utf-8`, except photo uploads, photo and PNG downloads, and HTML pages.
- **Staff identity:** every `/api` route except `/api/health`, `/api/status`, `/api/staff` and `/api/p/...` needs the header `X-Staff-Id` carrying a seeded staff id.
- **Timestamps:** ISO 8601 with offset.
- **Lengths:** whole millimetres.
- **Event numbers:** every successful state-changing response (`200` or `201` on POST, PATCH or DELETE) carries a top-level `"seq"`, the number of the event that change wrote.

**Error shape.** Every error uses one shape: `{"error":{"code":"<code>","message":"<text>"}}`. Some codes add one extra key:
- `validation_failed` adds `"fields":{"<field>":"<message>"}`, with the messages from Feedback states. Query-parameter fields have free-text messages.
- `placement_rejected` adds `"reason":"off_wall"|"off_centre_line"|"too_close"|"too_bright"`, and its `message` is the matching reason sentence from Feedback states.
- `already_claimed` adds `"claimedBy":{"id","name"}`.
- `stale_version` adds `"placement":<current placement>`.

`message` is free text wherever this brief prints no copy for it.

**Error precedence** (the same for every route, with the one exception named after the list):
1. `413 body_too_large`
2. `503 database_unavailable`
3. `401 unknown_staff`: `X-Staff-Id` is missing or is not a seeded staff id
4. an idempotent replay returns its stored response
5. `404 not_found`
6. `403 forbidden` (wrong role, not the claim holder, or not the person who did the action being undone)
7. state conflicts: `409` codes and `410 undo_expired`
8. `412 stale_version`
9. `415 unsupported_media_type` and `422` (`validation_failed` before `placement_rejected`)
10. `503 image_store_unavailable`

Exception: on `PATCH /api/placements/{id}`, when a curator or preparator moves a hung, signed-off or removed placement, `409 placement_locked` comes before every `403 forbidden` mover check in step 6. A registrar sending that PATCH still gets `403 forbidden`. For example, a preparator who is not the holder moving a hung work gets `409 placement_locked`.

Unknown `/api` paths answer `404 not_found`.

**Shapes:**
- **Placement:** `{"id","objectId","objectTitle","objectNumber","lenderId","wallId","wallName","offsetMm","centreHeightMm","widthMm","heightMm","heightOverride","plannedLux","plannedLuxHours","luxLimit","luxHourBudget","luxStatus":"within"|"over","status":"proposed"|"claimed"|"hung"|"signed_off"|"removed","claimedBy":{"id","name"}|null,"version"}`. `offsetMm` is the distance from the wall's left end (as seen facing the wall) to the work's centre.
- **Undo:** `{"actionId","kind":"remove"|"move","undoUntil","remainingMs"}`. `remainingMs` is the server's remaining time when it responded.
- **Object:** `{"id","objectNumber","title","medium","lenderId"|null,"lenderName"|null,"widthMm","heightMm","luxLimit","luxHourBudget","insuranceValueGbp","registrarNote","conditionRecorded","photos":[photo],"placementId"|null,"placementStatus"|null}`.
- **Photo:** `{"id","objectId","key","bytes","sha256","contentType","attachedAt"}`. `sha256` is lowercase hex of the stored bytes.
- **Preview:** `{"id"|null,"status":"draft"|"scheduled"|"published"|"withdrawn","date"|null,"publishAt"|null,"publishAtDisplay"|null,"remainingMs"|null,"publishedAt"|null,"publishedAtDisplay"|null,"withdrawnAt"|null,"withdrawnAtDisplay"|null,"recipients":[{"lenderId","lenderName","email","delivery":"queued"|"sent"|"cancelled","sentAt"|null}]}`. `remainingMs` is set only while scheduled: the server's milliseconds until `publishAt` when it responded, never below 0.
- **Event:** `{"seq","kind","at","actor":{"id","name"}|null,"placementId","objectId","wallId","previewId","title","wallName","offsetMm","plannedLux","publishAtDisplay","recipientCount"}`. Fields that do not concern the kind are `null`:
  - placement kinds set `placementId`, `objectId`, `wallId`, `title` and `wallName`
  - `placement.moved` also sets `offsetMm`, the offset after the move
  - object kinds and `photo.attached` set `objectId` and `title`
  - `wall.lux_changed` sets `wallId`, `wallName` and `plannedLux`
  - preview kinds set `previewId`
  - `preview.scheduled` also sets `publishAtDisplay`
  - `preview.published` also sets `recipientCount`, and its `actor` is `null`
- **Display strings:** every `...Display` field is the weekday, day number, month name and four-digit year, then a comma, the 24-hour time HH:MM, and ` museum time`, all in the museum's time zone. For example: `Tuesday 2 March 2027, 09:00 museum time`.

| Method and path | Who | Request | Success | Route-specific errors |
|---|---|---|---|---|
| GET `/api/health` | anyone | — | `200 {"status":"ok"}` | none; answers even while services are down |
| GET `/api/status` | anyone | — | `200 {"services":{"database":"up"|"down","imageStore":"up"|"down","mailRelay":"up"|"down"},"checkedAt"}` | — |
| GET `/api/staff` | anyone | — | `200 {"staff":[{"id","name","role"}]}` | — |
| GET `/api/exhibition` | staff | — | `200 {"exhibition":{"id","title","museum","timeZone","runStart","runEnd","openHoursPerDay","closedWeekdays","openDays","openHours"},"gallery":{"id","name","walls":[{"id","name","lengthMm","heightMm","plannedLux"}]},"lenders":[{"id","name","email"}]}` | — |
| GET `/api/events?after=<seq>` | staff | — | `200 {"events":[event],"latestSeq"}`: the events with `seq` above `after`, oldest first, at most 200; without `after`, no events and the latest seq | `422` (field `after`, when it is not a whole number of 0 or more) |
| PATCH `/api/walls/{id}` | curator | `{"plannedLux":int}` | `200 {"wall","placements":[every placement on that wall],"seq"}` | 422 |
| GET `/api/objects` | staff | optional query `q` (up to 100 characters, matched case-insensitively against title or object number), `lender` (lender id or `collection`), `sort` (`number`, `title`, `lender`, `lux`; default `number`), `dir` (`asc`, `desc`; default `asc`) | `200 {"objects":[object]}`, filtered and sorted. Ties are broken by object number ascending. `lender` sorts by lender name, with collection works as `Ashgrove collection`. `lux` sorts by lux limit. | `422` (fields `q`, `lender`, `sort`, `dir`) |
| GET `/api/objects/{id}` | staff | — | `200 {"object"}` | — |
| POST `/api/objects` | registrar | `{"objectNumber","title","medium","lenderId"|null,"width":number,"height":number,"unit":"cm"|"in","luxLimit","luxHourBudget","insuranceValueGbp","registrarNote"}` | `201 {"object","seq"}` | 422 |
| PATCH `/api/objects/{id}` | registrar | any subset of the POST fields; `width` or `height` needs `unit` | `200 {"object","placements":[its placement, if any],"seq"}` | `409 object_placed` when width or height changes while the object is placed; 422 |
| POST `/api/objects/{id}/photos` | registrar | raw body, `Content-Type: image/jpeg` or `image/png`; optional `Idempotency-Key` | `201 {"photo","seq"}` | `413 body_too_large` over 10,000,000 bytes (exactly 10,000,000 is allowed); `415 unsupported_media_type`; `422 validation_failed` for an empty body; `409 idempotency_conflict`; `503 image_store_unavailable` |
| GET `/api/objects/{id}/photos/{photoId}` | staff | — | `200`, the stored bytes with the stored content type | `503 image_store_unavailable` |
| GET `/api/placements` | staff | — | `200 {"placements":[placement],"overBudgetCount":int}`; removed placements are left out | — |
| POST `/api/placements` | curator | `{"objectId","wallId","offsetMm","centreHeightMm","heightOverride":bool}`; optional `Idempotency-Key` | `201 {"placement","seq"}` | `409 already_placed`; `409 idempotency_conflict`; 422 |
| PATCH `/api/placements/{id}` | curator or preparator, as qualified in Business rules | `{"version", "offsetMm"?, "centreHeightMm"?, "heightOverride"?, "wallId"?}` | `200 {"placement","undo","seq"}` | `409 placement_locked`; `412 stale_version`; 422 |
| DELETE `/api/placements/{id}` | curator | — | `200 {"placement"(status removed),"undo","seq"}` | `409 illegal_transition` |
| POST `/api/undo/{actionId}` | the person who did the action | — | `200 {"placement","seq"}` | `410 undo_expired`; `409 already_undone`; `409 undo_conflict`; `422 placement_rejected` |
| POST `/api/placements/{id}/claim` | preparator | — | `200 {"placement","seq"}` | `409 already_claimed`; `409 illegal_transition` |
| POST `/api/placements/{id}/release` | claim holder | — | `200 {"placement","seq"}` | `409 illegal_transition` |
| POST `/api/placements/{id}/hang` | claim holder | — | `200 {"placement","seq"}` | `409 illegal_transition` |
| POST `/api/placements/{id}/sign-off` | registrar | — | `200 {"placement","seq"}` | `409 condition_not_recorded`; `409 over_budget`; `409 illegal_transition` |
| GET `/api/preview` | staff | — | `200 {"preview"}` | — |
| POST `/api/preview/schedule` | curator | `{"date":"YYYY-MM-DD"}` | `200 {"preview","seq"}` | `409 preview_conflict`; 422 (field `date`) |
| POST `/api/preview/cancel` | curator | — | `200 {"preview","seq"}` | `409 preview_conflict` |
| POST `/api/preview/withdraw` | curator | — | `200 {"preview","seq"}` | `409 preview_conflict` |
| GET `/api/p/{token}` | anyone with the link | — | `200`, the lender's frozen snapshot JSON bytes exactly as stored | `404 not_found`; `410 link_withdrawn` |
| GET `/api/p/{token}/snapshot.png` | anyone with the link | — | `200 image/png`, the frozen PNG bytes exactly as stored | `404`; `410` |
| GET `/p/{token}` | anyone with the link | — | `200` HTML lender page | `404`, `410` and `503` HTML pages with the headings from Feedback states |
| any other method on `/p/...` or `/api/p/...` | — | — | — | `405 read_only` |

**Idempotency.**
- `Idempotency-Key` is 1 to 64 characters from letters, digits, `-` and `_`.
- Keys are scoped to the staff id and the route, and are kept for as long as the database lasts.
- Only `2xx` and `4xx` responses are stored. A `503` is not, so the same key can be retried after an outage.
- A replay with the same key and an identical request (same path and body bytes) returns the stored status and body, including its `seq`, changes nothing and writes no event.
- The same key with a different request answers `409 idempotency_conflict`.

### Business rules (DP-02, DP-03, DP-12, DP-13, DP-17, DP-18, DP-22, DP-23, DP-24, DP-33, DP-34, DP-40, DP-41, DP-42, DP-44, DP-61, DP-62, DP-63, DP-65, DP-68, DP-73, DP-74, DP-81)

**Roles:**
- **Curator:** places, moves and removes proposed works; changes wall lux; undoes their own actions; schedules, cancels and withdraws the preview.
- **Registrar:** registers and edits objects; attaches photos; signs off hung works.
- **Preparator:** claims proposed works; releases, nudges and marks hung the works they hold; undoes their own moves. Preparators may change offset and centre height, never the wall.

All staff may read. Any other actor gets `403 forbidden`.

**Placement lifecycle.** Each placement records its status, its holder and an integer `version` that starts at 1 and goes up by one on every change. Legal transitions:
- proposed → claimed (claim)
- claimed → proposed (release by the holder)
- claimed → hung (hang by the holder)
- hung → signed_off (sign-off)
- proposed → removed (delete)
- removed → proposed (undo)

Any other transition answers `409 illegal_transition`, with one exception: claiming a work you already hold answers `200` unchanged and writes no event.

**Who may move a placement.**
- A curator moves proposed placements, and the claim holder moves claimed ones.
- Each of these gets `403 forbidden`:
  - a preparator moving a proposed placement
  - a curator, or a preparator who is not the holder, moving a claimed placement
  - a preparator sending a `wallId` other than the current wall
- A curator or preparator moving a hung, signed-off or removed placement gets `409 placement_locked`, ahead of the mover checks above, as set out in the exception to the error precedence in API.

**Hang rules.** Every placement, move and undo-restore is checked in this order, and the first failure answers `422 placement_rejected` with its reason. The 145 cm line is 1450 mm and the 20 cm gap is 200 mm.
1. **off_wall:** the work's left edge must be at or right of the wall's left end, its right edge at or left of the wall's right end, its bottom at or above the floor, and its top at or below the wall's height.
2. **off_centre_line:** unless `heightOverride` is true, the centre height must be exactly 1450 mm.
3. **too_close:** the horizontal gap between the work's edges and each other non-removed placement on the same wall must be at least 200 mm. Exactly 200 mm is allowed.
4. **too_bright:** the wall's planned lux must not exceed the object's lux limit. Equal is allowed.

An object may have only one non-removed placement (`409 already_placed`).

**Undo windows.** Every removal and move returns an undo window that closes 10 seconds after the action, by the server's clock (`undoUntil`). The server alone decides whether the window is open.
- An undo at or after `undoUntil` answers `410 undo_expired`.
- A second undo of the same action answers `409 already_undone`.
- Undoing a move after the placement has changed again answers `409 undo_conflict`.
- Undoing a removal restores the same placement id as proposed at its old position, checked against the hang rules.
- A successful undo raises the version.

**Concurrency.** Claims are decided by the order in which the database commits them. Of any number of simultaneous claims on one proposed placement, exactly one gets `200`. Every other gets `409 already_claimed` naming the winner. A claim never changes position fields. A PATCH whose `version` is not the current version answers `412 stale_version` with the current placement, so a newer position is never overwritten.

**Events.** Every state change writes exactly one event, in the same transaction as the change:

| Change | Event kind |
|---|---|
| place | `placement.placed` |
| move, and undo of a move | `placement.moved` |
| remove | `placement.removed` |
| undo of a removal | `placement.restored` |
| claim | `placement.claimed` |
| release | `placement.released` |
| hang | `placement.hung` |
| sign-off | `placement.signed_off` |
| register an object | `object.created` |
| edit an object | `object.updated` |
| photo | `photo.attached` |
| wall lux | `wall.lux_changed` |
| schedule | `preview.scheduled` |
| cancel | `preview.cancelled` |
| server publish | `preview.published` |
| withdraw | `preview.withdrawn` |

Refused requests and replays write none. `seq` values strictly increase in the order the changes commit, so a reader asking for events after a `seq` never misses one.

**Lengths and units.** The server stores every length once, in whole millimetres:
- Centimetre input takes at most 1 decimal: mm = cm × 10.
- Inch input takes at most 2 decimals: mm = inches × 25.4, rounded half up to a whole millimetre.
- After conversion, widths and heights must be from 1 to 20,000 mm inclusive.

Every displayed length is computed from the stored millimetres, never from a previously displayed value:
- cm = mm ÷ 10 with one decimal, written `<number> cm`, with no thousands separator as set out in Visual design
- in = mm ÷ 25.4 rounded half up to one decimal, written `<number> in`, with no thousands separator as set out in Visual design

Switching units back and forth never drifts. For example, 30 in is stored as 762 mm and always reads `76.2 cm` and `30.0 in`.

**Light budget.**
- `openHours` is 7 multiplied by the number of days from `runStart` to `runEnd` inclusive that are not Mondays, counted in the museum's time zone.
- `plannedLux` of a placement is its wall's planned lux.
- `plannedLuxHours` is `plannedLux × openHours`.
- `luxStatus` is `over` when `plannedLux` is above the object's lux limit or `plannedLuxHours` is above its lux-hour budget. Otherwise it is `within`.
- `overBudgetCount` is the number of non-removed placements whose status is `over`.

The server computes these values once, whenever a placement, its wall's lux or its object's limits change. The scene, ledger, Lux details and count show only these server values. The too-bright check applies only when placing or moving a work. Raising a wall's lux, or lowering an object's lux limit or lux-hour budget, is accepted and keeps the placement, which then reads `over`. Wall lux saves are applied in the order they arrive, and the latest committed value stands.

**Sign-off.** A registrar can sign off only a hung placement. Two guards apply, in this order:
1. The object must have at least one condition photo confirmed by the image store. Otherwise `409 condition_not_recorded`.
2. The placement's `luxStatus` must be `within`. Otherwise `409 over_budget`.

**Condition recorded.** An object's `conditionRecorded` is true when it has at least one photo row. A photo row exists only after the image store has confirmed the stored object.

**Lender preview.** The exhibition has one current preview. Legal transitions:
- draft → scheduled (schedule)
- scheduled → draft (cancel)
- scheduled → published (by the server only)
- published → withdrawn (withdraw)
- withdrawn → scheduled (schedule again; this starts a new preview with a new id and new links, and the old links stay dead)

Any other request answers `409 preview_conflict`, including scheduling while already scheduled or published.

**Publish time.**
- `publishAt` is 09:00 in the museum's time zone on the chosen date.
- It must be at least 2 hours after the server's current time. Exactly 2 hours is allowed. An earlier date is refused with the too-soon field error.
- When the environment variable `PREVIEW_PUBLISH_DELAY_SECONDS` is set, `publishAt` is instead the scheduling time plus that many seconds, and the 2-hour check is skipped. Its display string still uses the museum's time zone.

**Publishing.**
- The server checks for due previews at least every 5 seconds, and publishes each one within 10 seconds after `publishAt`.
- At that moment it freezes one snapshot per lender who has at least one non-removed placement, creates one link per such lender, queues one email per such lender, and writes the `preview.published` event.
- Collection works, and lenders with no placed works, get nothing.
- If the image store is down at that moment, the preview stays scheduled until the store is back, then publishes.
- Every open workspace shows the new status, `Live`, within 10 seconds of the server's change.

**Server time only.** The device clock may be wrong. Preview status, publish times and both countdowns are shown only from server fields: the status, the display strings and `remainingMs`. The browser never decides from its own clock whether something is scheduled, published or expired.

**Withdrawal.**
- Withdrawal takes effect at once: every link of that preview answers `410`.
- Each lender whose preview email was already `sent` gets one withdrawal notice.
- Preview emails still `queued` become `cancelled` and are never sent, and their lenders get no notice.

**Snapshots.**
- Each lender's snapshot JSON is `{"exhibition":{"title","runStart","runEnd"},"lender":{"name"},"publishedAt","publishedAtDisplay","walls":[{"id","name","lengthMm","heightMm"}],"works":[{"title","objectNumber","wallName","offsetMm","centreHeightMm","widthMm","heightMm"}]}`. It lists only that lender's works.
- Each lender's snapshot PNG is a flat elevation drawing. Every wall is a warm grey band drawn to scale, the lender's works are ink-outlined rectangles at their positions, and the 145 cm line is drawn in accent.
- The lender page renders from its frozen snapshot. Edits made after publishing never change a snapshot.
- Snapshots, emails, the lender page and lender API responses never carry insurance values, registrar notes, other lenders' names or other lenders' works.

**Links.** Each link token carries at least 128 bits of randomness, in URL-safe characters. It grants read-only access to one lender's snapshot in one preview.

### Services (DP-26, DP-27, DP-29, DP-68, DP-69, DP-72, DP-74, DP-75, DP-78, DP-80)

**Postgres** is the source of truth for:
- staff, lenders, the exhibition, the gallery and walls
- objects, placements (wall, offset and centre height in mm), versions and claims
- undo actions with `undoUntil`
- events with their `seq`
- photo rows, previews, recipients, delivery status and link tokens
- idempotency records

Every position the scene shows is a committed row. The database named in `DATABASE_URL` always exists when the app starts, possibly empty. The app never creates or drops databases. It creates its schema and seed idempotently each time it serves, so an empty database is filled on start.

When the database is unreachable:
- every route that needs it answers `503 database_unavailable`
- the staff pages show the database banner
- the app retries in the background at least every 5 seconds, and carries on once the database answers, applying schema and seed if needed

**MinIO (image store)** holds:
- condition photos at `condition/<object id>/<photo id>.jpg` or `.png`, stored with exactly the uploaded bytes: no re-encoding, no metadata stripping, no resizing
- snapshots at `previews/<preview id>/<lender id>/snapshot.json` and `previews/<preview id>/<lender id>/snapshot.png`

The bucket named in `S3_BUCKET` always exists when the app starts, possibly empty. The app never creates or deletes buckets. A photo upload answers `201` only after the store has confirmed the write, and the photo row is written after that confirmation. When the store is unreachable:
- uploads answer `503 image_store_unavailable` and write no row
- photo downloads answer `503 image_store_unavailable`
- the staff pages show the image store banner
- every other action keeps working

**Mailpit (mail relay).** Mail goes out over SMTP to `SMTP_HOST`:`SMTP_PORT`, from the address in `MAIL_FROM` (`Ashgrove Museum previews <previews@ashgrove-museum.example>`). Each message has a plain-text part and an HTML part.
- **Preview email:** one per lender per preview, to the lender's seeded email. Subject: `Preview of <exhibition title>: your loans in place`.
  - The body greets the lender by name and states `<publish display>`.
  - It lists only that lender's work titles, with their wall names.
  - It gives the link `<public base>/p/<token>`. `<public base>` is `APP_PUBLIC_URL` when set, otherwise `http://localhost:<port>`.
- **Withdrawal notice:** subject `Preview withdrawn: <exhibition title>`. The body says the earlier link no longer works.

When the relay is unreachable:
- publishing still happens, and each email waits with delivery `queued`
- the server retries at least every 10 seconds, and each email is delivered exactly once when the relay returns
- the staff pages show the mail banner

**Service status.**
- The server probes every service at least every 5 seconds, whether or not anyone asks: a database query, a check that the bucket exists, and an SMTP connection.
- `GET /api/status` reports the latest probes, so its `checkedAt` is never more than 5 seconds old, including while a service is down.
- Every staff page polls it at least every 5 seconds and shows each banner exactly while its service reads `down`.
- A banner appears within 10 seconds of its service reading `down`, and disappears within 15 seconds of it reading `up` again, without a page reload or a server restart.
- A service that returns is picked up by the next probe. Nothing needs a restart.

### Seed data (DP-01, DP-04, DP-25, DP-44, DP-68, DP-70)

Every seeded person, lender, museum and business is invented.

- **Museum:** Ashgrove Museum of Art, time zone `Europe/London`.
- **Exhibition:** id `exh-salt`, title `Salt and Thread`, run 2027-03-06 to 2027-06-27, 7 open hours a day, closed Mondays. That gives 98 open days and 686 open hours.
- **Gallery:** id `gal-east`, name `East Gallery`.
- **Preview:** starts in Draft. No condition photos and no events exist at start.
- **Over-budget count:** with the seed data at start, the count reads `0 over budget`.

**Walls:**

| id | name | length mm | height mm | planned lux |
|---|---|---|---|---|
| `wall-north` | North wall | 12000 | 4000 | 50 |
| `wall-east` | East wall | 6000 | 4000 | 50 |
| `wall-south` | South wall | 12000 | 4000 | 150 |
| `wall-west` | West wall | 6000 | 4000 | 150 |

**Staff:**

| id | name | role |
|---|---|---|
| `cur-ines` | Ines Calloway | curator |
| `reg-tomasz` | Tomasz Adeyemi | registrar |
| `prep-ruth` | Ruth Okonkwo-Hale | preparator |
| `prep-dev` | Dev Malhotra | preparator |

**Lenders:**

| id | name | email |
|---|---|---|
| `lender-harbourside` | Harbourside Historical Society | loans@harbourside-history.example |
| `lender-oduya` | Mirela Oduya | mirela.oduya@example.net |
| `lender-fenwick` | Fenwick Maritime Trust | registrar@fenwick-trust.example |

**Objects:**

| id | number | title | lender | medium | W × H mm | lux limit | lux-hour budget | insurance £ | registrar note |
|---|---|---|---|---|---|---|---|---|---|
| `obj-herring` | L-2027-001 | Herring Girls at the Gutting Station | Harbourside | Watercolour on paper | 560 × 380 | 50 | 50000 | 18000 | Slight foxing lower left; glazing replaced 2019. |
| `obj-sampler` | L-2027-002 | Net Mending Sampler | Harbourside | Wool on linen | 450 × 600 | 50 | 30000 | 9500 | Loose stitching at upper edge; do not pin. |
| `obj-ganseys` | L-2027-003 | Ganseys Drying | Oduya | Oil on canvas | 762 × 610 | 200 | 150000 | 42000 | Lender requires two-person handling. |
| `obj-quilt` | L-2027-004 | Tide Chart Quilt | Oduya | Cotton patchwork | 1400 × 1800 | 50 | 50000 | 26000 | Hang on fabric batten only. |
| `obj-signal` | L-2027-005 | Signal Flag Pattern Book | Fenwick | Ink and watercolour on paper | 280 × 360 | 50 | 50000 | 7200 | Open at plate 7 only. |
| `obj-logbook` | AS-1961-14 | Lighthouse Log, Skerrin Point | Ashgrove collection | Ink on paper | 300 × 420 | 50 | 50000 | 4000 | (empty) |
| `obj-shore` | AS-1974-02 | Shore Light, Evening | Ashgrove collection | Oil on board | 900 × 700 | 200 | 150000 | 31000 | (empty) |

**Placements** (all at version 1, centre height 1450 mm, no height override):

| id | object | wall | offset mm | status | holder |
|---|---|---|---|---|---|
| `pl-herring` | `obj-herring` | `wall-north` | 2000 | proposed | — |
| `pl-ganseys` | `obj-ganseys` | `wall-south` | 3000 | proposed | — |
| `pl-shore` | `obj-shore` | `wall-south` | 6000 | claimed | `prep-ruth` |
| `pl-logbook` | `obj-logbook` | `wall-east` | 1500 | hung | `prep-dev` |

## Technical requirements

### Deployment (DP-77)

- **Runtime:** Node.js 22 LTS with npm. The app is TypeScript.
- **Manifest:** `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- **Port:** the server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- **Health check:** `GET /api/health` answers HTTP 200 `{"status":"ok"}` as soon as the server is listening, whatever the state of the other services.

### Configuration and secrets (DP-87)

All of these are read from the environment at start:
- **Postgres:** `DATABASE_URL`
- **MinIO:** `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- **Mail:** `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- **Links and timing:** `APP_PUBLIC_URL`, `APP_PUBLIC_PORT`, `PREVIEW_PUBLISH_DELAY_SECONDS` (optional)

None of them is hard-coded, logged in full or sent to the browser. The browser talks only to the app's own `/api`.

### Server boundary (DP-78, DP-86)

- **Origin:** the app serves its pages, scripts, fonts and API from one origin, and sends no cross-origin permission headers.
- **Request size:** JSON bodies may be up to 65,536 bytes inclusive, and photo bodies up to 10,000,000 bytes inclusive. Anything larger answers `413 body_too_large` before any other check.
- **Never served:** source files, `.env` files, the run manifest, package manifests, lockfiles and credentials. Requests for them answer `404`.
- **Page routes:** `/`, `/records`, `/records/<object id>` and `/p/<token>` are served as pages on direct load and on reload.
- **Dependencies down at boot:** if any dependency is unreachable at boot, the server still starts and answers the health check. It recovers each dependency on its own when it returns, as set out in Services.

### Browser support and performance (DP-37, DP-58, DP-59, DP-82)

- **Browsers:** current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, with mouse, keyboard and touch input.
- **Load time:** with the seed data, the workspace is usable within three seconds on a local connection, meaning the ledger is filled and the scene drawn. The Loan register shows its first results within two seconds.
- **Responsiveness:** a nudge shows on screen within 100 ms of the key press.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` names every shipped package and font with its licence. Shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: every shipped package uses MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0, and the fonts use OFL-1.1.
- IF-04: the app uses no datastore other than the provided Postgres, MinIO and Mailpit: no SQLite, no Redis, and no files used as a database.
- IF-05: the provided service definitions and seeded development credentials are left unchanged.
- IF-06: fonts and icons ship inside the app and are served from its own origin, with no runtime requests to font or script CDNs.
- IF-07: the npm lockfile is committed and `install` uses it.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` casts that bypass the domain types.
- Names match this brief's domain terms: placement, wall, offset, centre height, claim, hang, sign-off, lux-hours, loan register, preview, lender, condition photo, event, team update.
- Each domain rule is decided in exactly one place in the source: the placement and preview transitions, the hang rules, the unit conversion, the lux-hour and lux-status computation, the undo window, the publish time, event writing, and the focus target after each action.
- No abstraction has only one implementation, and there are no defensive checks for states that the types or the database already rule out.
- There is no dead, commented-out or unreachable code.
- Every API error is produced through the one error shape in API.
- The product has no features, endpoints or settings beyond this brief.
