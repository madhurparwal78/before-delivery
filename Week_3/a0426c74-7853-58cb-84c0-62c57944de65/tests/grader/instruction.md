# Plotfold Works Plotfold

Plotfold is a drafting and review desk that runs in the browser. It is for small teams that draw anything to scale, such as a garden plan, a shelf or a stage layout. Drafters draw exact geometry from a typed command line or with the pointer. They work live with each other, and each person has their own undo. They use layers, blocks, dimensions, hatches and constraints, attach other drawings as references, and lay out paper sheets with scaled viewports. They publish numbered sheet versions. Reviewers compare two versions with Delta swipe, mark them up, approve or reject them, and follow up with pinned issues and linked RFIs, including from a phone. Build one TypeScript web app, a Node server and a browser client, on two services. PostgreSQL holds the server-ordered operation log and every record. MinIO holds every byte that must survive as a file: underlay images, imported drawing files, published sheet files and exports. This brief prints every rule and formula, so you need no drafting knowledge.

The following are out of scope:
- AI features
- 3D and solid modelling, BIM, clash detection and rendering
- scripting and plug-ins
- scheduling, cost and bidding
- licences and paid plans
- sound
- outside integrations and native mobile apps
- email, outside sign-in and password reset
- the DWG, DXF, RVT, IFC and PDF formats

Exports are the Plotfold drawing text format and standalone SVG only. Use no other datastore, queue, cache, mail or search service.

## Problem and users

A small team that draws to scale usually has one person on a desktop drafting seat. That person copies files named like final_v3_REAL by hand and sends flat pictures out for review. Comments come back as photos and reply-all threads. Nobody can say which version a comment was about, and questions from the field live in text messages. Plotfold puts the drawing, its published versions, the markups, the issues and the questions in one place. Every comment belongs to a numbered version, and every change is visible live.

- **Drafter** (daily): draws from the command line or with the pointer, uses blocks, dimensions and constraints live with others, lays out sheets and publishes versions. This person works mostly from the keyboard.
- **Reviewer** (weekly): compares two published versions, marks them up, approves or rejects them, and follows pinned issues and RFIs.
- **Field reviewer on a phone** (occasional): opens a published sheet, pins an issue at a spot, raises an RFI linked to it and sees it answered live.

## Journeys

1. **Draft from the keyboard.** A drafter opens an empty drawing. They type `L`, Space, `0,0`, Enter, `@10,0`, Enter, `@10<90`, Enter, then press U once and Enter. They repeat the line command with an empty Enter and cancel it with Escape. The drawing then holds one line from 0,0 to 10,0. The entity list reads it back in words, and focus is in the command line after every step.
2. **Draw with a colleague.** Two drafters open the same drawing. One moves the pointer near a line end with Snap on and sees an endpoint candidate win over a nearby midpoint. They draw with Ortho, select with a window, then drag a grip. The other sees their named crosshair and the new geometry within one live message, without reloading.
3. **Shape and annotate.** A drafter trims, extends, fillets, offsets, mirrors and arrays geometry. Each command is one undo step. Dimensions and hatch areas update on both people's screens. Deleting a hatch's boundary breaks the hatch's link to its edges, and one undo brings the link back.
4. **Lay out and publish.** A drafter adds an A3 sheet with two viewports at 1:50 and 1:20 and fills the title block. They publish version 1, and the version shows as Published only once both of its files are stored. A storage outage refuses a second publish with the outage text. After storage returns, a retry succeeds without restarting the app.
5. **Edit apart, merge in order.** Two drafters switch to working offline, edit the same entities, and reconnect one after the other. The server order decides each conflict by a published rule. Each person sees the exact number of conflicts, and nothing is lost silently. A per-person undo skips a change that a colleague has since overridden.
6. **Compare and review.** A reviewer opens version 2 against version 1 with Delta swipe and moves the swipe slider with the arrow keys. They read exact added, removed and changed counts, which include an xref reload, and see markups that carried forward with a flag where geometry changed. They approve their review step. When version 3 is published, the pending review on version 2 is voided.
7. **Field question.** A field reviewer on a phone pinches and pans a published sheet and taps to pin an issue. They raise an RFI addressed to the drafter, and the drafter's desktop shows it live. The drafter answers, and the ball moves back to the reviewer. A manager then revokes the reviewer's role, and the phone loses access live.
8. **Bring in and find.** A drafter imports a Plotfold text file. Errors list their line numbers. A corrected file shows a merge preview and merges as one undo step. In a drawing of thousands of lines the page keeps a bounded number of entity elements, while snaps and Find still reach entities that are off screen.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** /app/run.json installs, builds and serves the app on the published port, and the health path answers HTTP 200 with the status published in Deployment for a normal instance and for a file-storage outage.
- **DP-02 — Grading routes** When PLOT_GRADING is 1, the seed, session, view, clock, operation batch and storage routes behave exactly as published in API and answer 404 when it is unset.
- **DP-03 — Local accounts** People register and sign in with a local username and password, get the plot_session cookie, and sign-in attempts are rate limited per username as published.
- **DP-04 — One error order and shape** Every API error uses the one published body shape and code list, and when several errors apply the response follows the one published error order.
- **DP-05 — Live drawing channel** Each open drawing has one live socket whose messages carry a per-drawing sequence number, a reconnecting page receives exactly what it missed, and the page applies each message to the screen when it arrives.
- **DP-06 — Published breakpoints** At 375x812, 768x1024 and 1280x800 the folders list, drawing screen and review screen show their published layout and pane order with no horizontal page overflow.
- **DP-07 — Published motion and reduced motion** The four published animations run with their published ids and durations, and under reduced motion none runs while results, data attributes, announcements and focus stay identical.
- **DP-08 — Contact-sheet look** The landing hero and folders list read as dense runs of small procedural sheet frames on a near-black ground, following Visual design.
- **DP-09 — Drafting and review screens look** Working screens use one small text size, white-line geometry on charcoal, flat corner chips instead of toolbars, square corners and sage only for the active tool and the one primary button.
- **DP-10 — Configuration from the environment** Every service credential, URL and published setting is read from its environment variable at start, and none is hard-coded or sent to the browser.
- **DP-11 — Server boundary** The server serves one origin and refuses writes from other origins with the published code, enforces the published body limits, answers 404 for source files, credentials and every other unserved path, and boots and serves drawings while file storage is unreachable.
- **DP-12 — Command line, prompts and input forms** Every command and alias runs from textbox Command with its exact stage prompts, the three point forms, repeat, step back and cancel, as published in Business rules.
- **DP-13 — Keyboard map and focus** Every action in the published keyboard table works from the keyboard, F6 cycles the published regions, and focus lands at the published place after each step.
- **DP-14 — Entity list** grid Entities gives one row per entity in the whole drawing with the published label wording, and arrow keys, Space and Enter select and pan as published.
- **DP-15 — Command-line drafting journey** A drafter creates, repeats, steps back and cancels geometry using only the keyboard and reads every prompt, result and entity label exactly.
- **DP-16 — Snaps and drafting aids** Pointer points resolve through the published snap priority, aperture and tie rule, then Ortho or Polar, then Grid, with the current candidate exposed on the drawing root.
- **DP-17 — Selection, grips and properties** Window and crossing selection, click toggling, grips, keyboard nudges and the Properties values behave as published, and each grip drag or nudge is one undo step.
- **DP-18 — Presence and follow** Everyone in a drawing appears in list People here with a published colour index and a live crosshair, is removed after the published timeout, and can be followed until the follower pans or zooms.
- **DP-19 — Pointer drafting journey** Two drafters in one drawing see pointer drafting, snapping, selection and grip edits from each other live, with exact announcements.
- **DP-20 — Trim and extend** TRIM and EXTEND produce exactly the published geometry and handles, refuse with the published messages and are one undo step each.
- **DP-21 — Fillet and chamfer** FILLET and CHAMFER produce exactly the published geometry for every radius and distance, including zero, and refuse with the published messages.
- **DP-22 — Offset, mirror and array** OFFSET, MIRROR and ARRAY produce exactly the published geometry, arc direction and handle order, with each run one undo step.
- **DP-23 — Modify chain journey** A drafter runs a chain of modify commands from the keyboard while a second person watches every result arrive live and the undo steps unwind it exactly.
- **DP-24 — Layers, inheritance and saved states** Layer properties, ByLayer inheritance, the off and frozen differences, current-layer rules, saved layer states and layer errors behave as published, each change one undo step.
- **DP-25 — Layer locks against live selections** Locking or freezing a layer removes its entities from every other person's live selection with the published notice, and edits on a locked layer are refused.
- **DP-26 — Layers journey** Two drafters change layer state while one holds a selection and see visibility, inheritance, selections and errors change live on both screens.
- **DP-27 — Blocks, inserts and attributes** BLOCK and INSERT place blocks by the published transform with ByBlock colour, nesting and per-insert attribute values.
- **DP-28 — Block redefinition, explode and purge** Redefining a block updates every insert live and keeps matching attribute values, a self-containing block is refused with its chain, and EXPLODE and PURGE work as published.
- **DP-29 — Blocks journey** Two drafters build nested blocks with attributes, redefine one live on both screens, hit the self-reference error and explode an insert.
- **DP-30 — Associative dimensions** Dimension values always equal their published formulas over current geometry, follow moves, undo and redefinition live, and lose and regain their association as published.
- **DP-31 — Associative hatch** HATCH finds the published boundary with islands, its area always equals the published formula, and a broken boundary and its undo behave as published.
- **DP-32 — Dimensions and hatch journey** Two drafters move geometry by keyboard and see dimension values and hatch areas recalculate on both screens, then break and restore an association.
- **DP-33 — Constraints and parameters** Geometric and dimensional constraints with named expressions solve by the published rules and tolerance, keep fixed entities in place and refuse over-constraint, cycles, unknown names and division by zero exactly.
- **DP-34 — Constraints journey** Two drafters edit parameters and drag a grip on constrained geometry and see every constraint hold and refusals roll back on screen.
- **DP-35 — Xrefs** XATTACH shows another drawing's last published version transformed, clipped, snappable and read-only, offers a live reload when it publishes again, binds with XBIND and refuses a circular chain by naming it.
- **DP-36 — Xrefs journey** One drafter publishes a source drawing and another sees the reload notice live, reloads, reads the source's layers and handles with the xref name in front, and hits the circular-reference error.
- **DP-37 — Sheets and viewports** Sheets in A3 or A4 place viewports by the published paper mapping and scale, with viewport-only layer freeze, annotation scale and the auto-filled title block.
- **DP-38 — Publish confirmed by storage** A sheet version shows as published, and takes its number, only after MinIO confirms both of its objects.
- **DP-39 — Export jobs** An export runs as a background job with published states and progress, and its download is offered only after its MinIO object exists.
- **DP-40 — File storage outage and recovery** While file storage is down, drawing and editing keep working and every storage action shows its published outage text, and each recovers without a restart once storage returns.
- **DP-41 — Sheet publish journey** A drafter lays out a scaled sheet, publishes it, exports it with live progress, meets a storage outage and retries successfully.
- **DP-42 — Server-ordered operations** Every change is an operation with an id, base revision and group, applied in server order, all or nothing per group, with stale bases refused and replays idempotent.
- **DP-43 — Conflict rules** Concurrent moves, edits to deleted entities, drawing on deleted layers and inserts during a redefinition resolve by the published rules with exact notices, and the losing person's optimistic geometry rolls back on screen.
- **DP-44 — Working offline** switch Work offline queues operations in the browser across reloads, then sends them in order with their original ids and base revisions and reports exact counts.
- **DP-45 — Per-person undo and redo** Undo and redo reverse only the requesting person's own operation groups, skip superseded ones with the published text, survive reload and restore deleted entities with their associations.
- **DP-46 — Offline merge journey** Two drafters edit offline and reconnect in a known order, and they see exact conflict notices and counts and a per-person undo that skips an overridden change.
- **DP-47 — Delta swipe** Comparing two published versions gives the published added, removed and changed counts and per-entity marks, with a keyboard-operable swipe slider and an overlay switch.
- **DP-48 — Restore a version** Restoring a published version is one new undoable operation group that brings back exactly that version's geometry and keeps all history.
- **DP-49 — Markups carried forward** Cloud, arrow and text markups carry to the next version and are flagged exactly when the compare rule finds a change under them.
- **DP-50 — Review steps and approvals** Reviews follow the published steps, order, expiry and voiding, with stamps and the exact rejection for each illegal action.
- **DP-51 — Compare and review journey** A reviewer compares versions by keyboard with and without reduced motion, reads counts that include an xref reload, sees flagged markups and has a pending review voided by a newer version.
- **DP-52 — Phone review gestures** On a phone, pinch, two-finger pan, tap and long press follow the published formulas and timings, and drawing commands are refused with the published notice.
- **DP-53 — Issues and RFIs** Issues and RFIs follow their published state machines with ball-in-court ownership, two-way links and an exact rejection for each illegal transition, live for everyone.
- **DP-54 — Folder roles applied live** Folder roles with inheritance and sheet locks decide every action, and a role change or revoke applies in open sessions live as published.
- **DP-55 — View links** A view link shows one published version without an account, grants nothing else, and stops working live when it expires or is revoked.
- **DP-56 — Field review journey** A field reviewer on a phone pins an issue, raises an RFI answered live from a desktop, hits an illegal transition and loses access live when revoked.
- **DP-57 — Drawing text format** Import parses the published Plotfold text format with exact line-numbered errors and a merge preview, and export followed by import is an exact round trip for canonical input.
- **DP-58 — Upload checks** Underlay images and drawing text files are checked for size, type and quota in the published order before they are stored, and are stored under the published keys.
- **DP-59 — Large drawings and Find** Only the published number of nearest entity elements stays in the page while snaps, selection and Find work on the whole drawing.
- **DP-60 — Import and large drawing journey** A drafter fixes a failing import, merges it as one undo step, exports a round trip, and navigates a large drawing with Find, snaps and the entity list.

## Frontend

### Screens and layout (DP-06, DP-08, DP-09, DP-52)

Breakpoints: **phone** under 768 px wide, **tablet** 768 to 1279 px, **desk** 1280 px and up. The published viewports are 375x812 (phone), 768x1024 (tablet) and 1280x800 (desk). Phone checks may also use 390x844. No other breakpoint changes which layout these sizes get. No screen scrolls sideways at any of them, apart from the published sideways strips inside a page.

Pages:

- **Landing** (`/`). A near-black field across the whole viewport, with something in each of the four corners:
  - top left: the name `Plotfold` at display size
  - top right: `link "Sign in"`
  - bottom left: the sentence `Draw to scale, publish, then review.`
  - bottom right: one text link, `link "Start drawing"`, which opens the register page

  The middle strip, `region "Sheet strip"`, holds at least eleven sheet frames drawn as SVG by the app at their natural widths, with small gaps between them. The frames are invented: a garden plan, a shelf elevation, a stage layout, a sheet with only a title block, and others. The centred frame is lit and the rest are dimmed to about half brightness. The lit frame's sheet title sits beneath it. The strip scrolls sideways, settles with one frame centred, and never takes over vertical scrolling. On a phone the strip stays one row high.
- **Register** (`/register`) and **Sign in** (`/signin`). Each is a small form in a surface block on the same ground.
- **Folders** (`/folders`). This page is the contact sheet:
  - The page name `Folders` is at display size.
  - Each folder shows its name in the body size, then one row per drawing: the drawing name, then a run of sheet-version frames, oldest first. Each frame is a scaled thumbnail of that version's SVG, labelled `<sheet name> v<number>` with its state.
  - `button "New drawing"` sits at the end of each folder.
  - On a phone, each run scrolls sideways inside its row.
  - A folder with no drawings shows one empty frame and the sentence `No drawings yet.`
- **Drawing** (`/drawings/<id>`). A full-bleed charcoal drawing pane, `region "Drawing"`, with white-line SVG geometry:
  - **Bottom:** the one-line command bar, holding `textbox "Command"` with `status "Command prompt"` beside it, and `group "Drafting aids"` at its right end.
  - **Corners of the drawing pane:** flat chips instead of toolbars. Top left: the drawing name and `tablist "Layouts"`. Top right: `list "People here"`, `button "Publish sheet"`, `button "Compare"`, `button "Export"` and `button "Import"`. Bottom left: `switch "Work offline"` and `status "Connection"`. Bottom right: zoom text.
  - **Panels**, in this DOM and visual order:
    1. `grid "Entities"`
    2. `region "Layers"`
    3. `region "Properties"`
    4. `region "Parameters"`
    5. `region "Xrefs"`
    6. `region "Versions"`
    7. `region "Issues"`
    8. `region "Markups"`
  - **Desk:** three panes. On the left, a column holding the Entities grid above Layers. In the centre, the drawing with the command bar under it. On the right, a column holding Properties, Parameters, Xrefs, Versions, Issues and Markups as collapsible sections, in that order. Every panel is open at start. Each panel has a header `button "<panel name>"` with `aria-expanded` that collapses or opens it. The panel names are `Entities`, `Layers`, `Properties`, `Parameters`, `Xrefs`, `Versions`, `Issues` and `Markups`.
  - **Tablet:** the drawing on top across the full width, with the command bar under it. Below that is one panel strip with `tablist "Panels"` and a tab per panel, in the panel order. At start the `Entities` tab is active, and only the active tab's panel is open.
  - **Phone:** the review view. The drawing fills the viewport and `textbox "Command"` sits in one line along the bottom. `button "Panels"` sits top right and opens `dialog "Panel"`. This is a bottom sheet covering no more than the lower 60 percent of the screen, holding `tab "Issues"`, `tab "Markups"` and `tab "Versions"`. Drawing panels other than these three are not offered on a phone. No panel is open at start, and `dialog "Panel"` opens on `tab "Issues"`.
- **Review** (`/versions/<id>`). The same arrangement as Drawing, showing one published version read-only, with the review stamp and review step controls in `region "Versions"`. Delta swipe opens here and on Drawing.
- **View link** (`/v/<token>`). The Review screen without account controls, issues or markups. It shows only the linked version.
- **Not available.** Plain sentences in a surface block on the ground, used for 404 pages, expired links and revoked access.

### Public screens and controls (DP-06, DP-12, DP-13, DP-14, DP-16, DP-17, DP-18, DP-24, DP-35, DP-37, DP-44, DP-47, DP-50, DP-52, DP-53, DP-55, DP-57, DP-59)

Only the controls and regions in this table are public. Everything else is free. Wording in the Visible copy column refers to its owning section and is not repeated here.

| Role and accessible name | Where | Visible copy and notes |
|---|---|---|
| `link "Sign in"`, `link "Start drawing"`, `region "Sheet strip"` | Landing | as in Screens and layout |
| `textbox "Username"`, password field labelled `Password`, `button "Sign in"`, `button "Create account"` | Sign in, Register | form copy in Feedback states |
| `button "New drawing"`, `button "New folder"` | Folders | |
| `region "Drawing"` | Drawing, Review, View link | holds the drawing root attributes in Business rules |
| `textbox "Command"` | command bar | |
| `status "Command prompt"` | beside Command | prompts and command results in Business rules |
| `group "Drafting aids"` with toggle buttons `Snap`, `Ortho`, `Grid`, `Polar` | command bar | `aria-pressed` |
| `status "Drawing announcements"` | visually hidden | polite; sentences in Feedback states |
| `status "Notices"` | toast stack, top centre | polite; toasts |
| `status "Connection"` | bottom left chip | offline banner |
| `status "Storage notice"` | surface block above the command bar | outage texts |
| `switch "Work offline"` | bottom left chip | |
| `grid "Entities"` | panel | `aria-rowcount` is the whole entity count |
| `region "Layers"` with `grid "Layer list"`; per row toggle buttons `On`, `Frozen`, `Locked` and comboboxes `Colour`, `Linetype`, `Lineweight`; `combobox "Current layer"`; `button "New layer"`; `button "Save layer state"`; `list "Layer states"` with `button "Restore"` per state | panel | `Colour` options are the colour names in the Layers rule, `Linetype` options the linetype names, and `Lineweight` options `<mm> mm`, such as `0.25 mm`. `Current layer` options are every layer name except xref layers, frozen ones included, in name order. |
| `region "Properties"` | panel | `Length`, `Area`, attribute fields named by tag, dimension style fields |
| `region "Parameters"` with `grid "Parameter list"` (columns Name, Expression, Value) | panel | |
| `region "Xrefs"` with per xref `button "Reload"`, `button "Clip"`, `button "Remove clip"` | panel | |
| `status "Xref notice"` | top of drawing | |
| `tablist "Layouts"` with `tab "Model"` and one tab per sheet; `button "New sheet"` | drawing corner | |
| `region "Versions"` with `button "Start review"`, `button "Approve"`, `button "Reject"`, `button "Restore this version"`, `button "Create view link"`, `button "Turn off link"` | panel | |
| `button "Publish sheet"`, `button "Compare"`, `button "Export"`, `button "Import"`, `button "Add underlay"` | drawing corner | |
| `progressbar "Export"`, `button "Retry export"`, `link "Download export"` | inside `dialog "Export"` | |
| `dialog "Export"` with `radio "Plotfold text"`, `radio "SVG"`, `button "Start export"` | | |
| `dialog "Import preview"` with `list "Import errors"`, `button "Merge"`, `button "Cancel"` | | |
| `dialog "Add underlay"` with file field `Image file`, `textbox "First corner"`, `textbox "Opposite corner"`, `button "Attach"` | | |
| Delta swipe: `combobox "Earlier version"`, `combobox "Later version"`, `slider "Compare swipe"`, `switch "Overlay"`, `status "Compare counts"`, `region "Entity history"` | Review and Drawing | version options read `v<number>`, oldest first |
| `region "Issues"` with `list "Issue list"`; each issue `listitem` holds `button "Create RFI"`, `button "Answer issue"`, `button "Close issue"` and `button "Reopen issue"` | panel, and `tab "Issues"` on a phone | Every transition button shows in every state. A refused click shows its rejection text as a toast. |
| `article "RFI: <question>"` inside its issue's list item, showing its state and `With <user>` for the ball-in-court owner, with `textbox "RFI answer"`, `button "Send RFI"`, `button "Answer RFI"`, `button "Close RFI"` and `button "Reopen RFI"` | `list "Issue list"` | Every transition button shows in every state. A refused click shows its rejection text as a toast. |
| `dialog "New issue"` with `textbox "Issue title"`, `button "Pin issue"` | | |
| `dialog "New RFI"` with `textbox "Question"`, `combobox "Addressee"`, `button "Save RFI"` | opened by `button "Create RFI"` | `Addressee` options are the usernames with a role on the folder, other than the asker, in name order |
| `region "Markups"` with `button "Cloud"`, `button "Arrow"`, `button "Text"` | panel | |
| `menu "Sheet actions"` with `menuitem "Pin issue here"`, `menuitem "Measure from here"`, `menuitem "Show versions"` | phone long press | |
| `button "Panels"`, `dialog "Panel"` with `tab "Issues"`, `tab "Markups"`, `tab "Versions"` | phone | |
| `list "People here"` with per person `button "Follow <user>"` | drawing corner | |
| `search "Find"` with `searchbox "Find text"`, `status "Find count"`, `button "Next match"` | opens over the drawing's top edge | |

### Interactions (DP-12, DP-13, DP-14, DP-16, DP-17, DP-18, DP-47, DP-52, DP-59)

**Keyboard table.** These keys work wherever the Region column says, including when a button in that region has focus.

| Key | Region | Action | Focus afterwards |
|---|---|---|---|
| Printable keys | anywhere on Drawing except a text field | go into `textbox "Command"` | Command |
| Enter, Space | Command | run, or end the stage, by the command line rules | Command |
| Escape | Command | cancel the command | Command |
| Escape | any panel, `search "Find"` | close or leave it | Command |
| Escape | a dialog or `menu "Sheet actions"` | close it | its opener |
| F3, F8, F9, F10 | Drawing screen | toggle Snap, Ortho, Grid, Polar | unchanged |
| Ctrl+Z, Ctrl+Shift+Z | Drawing screen, except text fields other than an empty Command | undo, redo | unchanged |
| U | empty Command at the Ready prompt | undo | Command |
| Delete | Drawing screen with a selection, except text fields | erase the selection | Command |
| ArrowUp, ArrowDown, ArrowLeft, ArrowRight | `region "Drawing"` with a selection | nudge by 1 world unit, or 10 with Shift | unchanged |
| ArrowUp, ArrowDown | `grid "Entities"` | move a row and select that entity alone | unchanged |
| Space | `grid "Entities"` | toggle the row's entity in the selection | unchanged |
| Enter | `grid "Entities"` | pan to the entity by the Find pan rule | unchanged |
| ArrowLeft, ArrowRight, PageUp, PageDown, Home, End | `slider "Compare swipe"` | move the swipe by the published steps | unchanged |
| F6, Shift+F6 | Drawing screen | next or previous stop: Command, `region "Drawing"`, then each open panel in panel order, wrapping. Entities is the first panel, and a collapsed panel is not a stop. On a phone, the open bottom sheet is the only panel stop. | the next stop |
| Tab, Shift+Tab | inside an open dialog or the phone bottom sheet | move between its controls, wrapping from last to first and back | stays inside |

Focus after other steps:
- When a command ends, is cancelled or is refused, focus is in Command.
- A toast never takes focus.
- After an optimistic rollback, focus is in Command.
- After a role change, focus is on `region "Drawing"`.
- The LAYER, PARAM and FIND commands move focus into `grid "Layer list"`, `grid "Parameter list"` and `searchbox "Find text"` respectively.

**Pointer on the drawing.**
- Moving the pointer updates the snap attributes on every move.
- A click during a point stage enters the resolved point. During a pick stage, a click picks the entity under the pointer within the snap aperture. At Ready, a click toggles that entity into the selection.
- Dragging on empty space draws a selection window. Shift with a click or a window removes entities from the selection instead.
- Dragging a grip and releasing it applies one edit.
- The wheel zooms about the pointer, each step multiplying or dividing zoom by 1.2.
- Dragging with the middle button, or with Space held, pans.

**Touch on a phone.** Every timer below runs on page timers.
- Pinch zooms by the gesture rule in Business rules.
- Two fingers moving together pan by the change in their midpoint.
- A tap is one touch that moves under 8 px and lifts within 500 ms. It opens `dialog "New issue"` at that world point.
- A long press is one touch held 500 ms that moves under 8 px. It opens `menu "Sheet actions"`:
  - `Pin issue here` opens `dialog "New issue"` at the press point.
  - `Measure from here` starts a two-point distance from the press point. The next tap ends it, and the result shows in the DIST result format.
  - `Show versions` opens the bottom sheet on `tab "Versions"`.
- On submit, `dialog "New issue"` places a pin, `data-issue-pin`, at its world point.

**Delta swipe.**
- `button "Compare"` opens the compare view with the two version comboboxes, defaulting to the two newest versions.
- The swipe divider (`data-swipe-divider`) splits the sheet: the later version on its left, the earlier on its right. The slider starts at 50.
- Dragging the divider or the slider moves it with the pointer.
- Turning on `switch "Overlay"` hides the divider and draws both versions, each entity marked by its diff state.
- Clicking or pressing Enter on an entity fills `region "Entity history"`.

**Following.** `button "Follow <user>"` makes this viewport copy that person's zoom and pan whenever their view changes. The follow stops as soon as the follower pans or zooms.

### Visual design (DP-08, DP-09)

The direction is **contact sheet**: dense like a plan drawer, calm like a proof table, exact like a printed sheet.

- **Typefaces.** Funnel Display for the product name and display-size page names. Funnel Sans for everything else. Both are bundled with the app.
- **Colour roles.**
  - Ground: near-black charcoal.
  - Surface: a slightly lighter charcoal, for panels, chips and notice blocks.
  - Ink: a warm off-white, used for geometry lines and text. Titles use the brightest ink.
  - Muted: a soft grey-green, for secondary text and dimmed frames.
  - Accent: a soft sage green. It is used only for the active tool, a pressed drafting aid and the one primary button on a screen.
  - On-accent: near-black text on sage.
- **Type scale.** Each heading step is one fifth larger than the step below. On working screens everything is one small text size, with titles in brighter ink rather than a bigger size. Only the landing name and the folders page name use display size, several steps up.
- **Density and composition.** The layout is compact. Every job is a run of small procedural sheet frames in strict rows under a display-size name. The drawing canvas, version list and issue lists reuse the same one-size text, small even gaps and square corners. Corners are square everywhere.
- **Working screens.**
  - The drawing pane is full-bleed charcoal with white-line geometry, and flat chips sit in its corners. There are no toolbars and no display headings.
  - Tables, forms and lists use the single text size.
  - An empty state is an empty frame row with one sentence.
  - Errors and the storage outage texts are plain sentences in a surface block.
  - On phones, panels become the bottom sheet.
- **Diff marks.** Added entities draw in sage. Removed entities draw in muted grey with dashes. Changed entities draw in full-brightness ink with a heavier line.
- **Presence colours.** The eight presence colours, by index from 1 to 8, are sage, amber, sky, rose, violet, lime, coral and sand. Each is a soft tone that stays readable on charcoal.
- **Tap targets and contrast.** Every control is at least 44 px high and wide on touch layouts. Text and essential lines meet WCAG 2.2 AA contrast on their background.

### Motion and effects (DP-07, DP-47, DP-52)

Motion is brief and functional. It shows that a view moved, a pin arrived or a notice appeared. Nothing loops or decorates. The four animations below run through the browser's Web Animations interface on the document timeline. Each has its own id and a curve that starts quickly and eases to rest. A test can read each one from the element's list of running animations:

| id | Element | Duration | What it shows |
|---|---|---|---|
| `zoom-all` | the drawing's view group inside `region "Drawing"` | 320 ms | ZOOMALL moving the view from the old zoom and pan to the fitted zoom and pan |
| `compare-swipe` | the swipe divider | 120 ms | the divider sliding from the old to the new swipe position after a key press |
| `sheet-pin` | a new issue pin | 200 ms | the pin growing from four fifths of its size to full size |
| `toast-enter` | a new toast | 120 ms | the toast fading in while sliding a few pixels down into place |

The data attributes hold their final values the moment each action applies, before its animation ends. Announcements and focus do not wait for animations.

Under reduced motion, none of the four animations runs. The listed elements have no running animations. Each change shows its end state at once, with the same data attributes, announcements and focus.

Other effects: dimmed landing frames light up when they reach the centre, a hovered chip brightens, and a pressed button darkens. Each changes at once with no animation.

### Feedback states (DP-03, DP-12, DP-38, DP-39, DP-40, DP-44, DP-55, DP-57, DP-58, DP-59)

Live regions are polite. A toast appears in `status "Notices"`, stays for `PLOT_TOAST_MS` on page timers, then leaves. Business rules print each rule's rejection text and notice once. Every sentence below is printed only here.

**Sign in and register** (shown under the form):

| Event | Text |
|---|---|
| Wrong username or password | `Wrong username or password.` |
| Sign-in rate limit | `Too many sign-ins. Wait a minute and try again.` |
| Bad username | `Use 3 to 24 lower-case letters, digits or underscores.` |
| Short password | `Use at least 8 characters.` |
| Username taken | `That username is taken.` |

**Storage actions** (in `status "Storage notice"` and repeated in `status "Drawing announcements"`):

| Action | Pending | Success | Field error | Outage |
|---|---|---|---|---|
| Publish | `Publishing…` | `Published version <n>.` | — | `File storage is unavailable. Nothing was published. Try again in a moment.` |
| Underlay | `Uploading…` | `Underlay attached.` | `That image is larger than <max> bytes.`, `Underlays must be PNG or JPEG images.`, `This drawing's underlays would pass <quota> bytes.` | `File storage is unavailable. Nothing was added. Try again in a moment.` |
| Import | `Reading file…` | `Imported <n> entities.` after Merge | `That file is larger than <max> bytes.`, `That isn't a Plotfold drawing text file.`, line errors in `list "Import errors"` | the underlay outage text |
| Export | `Export started.` and `progressbar "Export"` | `Export ready.` with `link "Download export"` | — | `Export failed: file storage is unavailable.` with `button "Retry export"` |

Placeholders in the table:
- `<n>` is the version number, or the merged entity count.
- `<max>` and `<quota>` are the configured byte limits, written in digits without separators.

**Import preview.** The preview reads `Adds <n> entities, <l> layers, <b> blocks.`. Each rename is listed below it as `<old> renamed <new>`.

**Connection.** `status "Connection"` reads `Live` while the socket is open. While the page is reconnecting by itself it reads `Reconnecting…`. While working offline it reads `You're working offline. <n> changes waiting.`. When the queue is sent it reads `Back online: <n> changes sent, <k> conflicts.`. `1 change` and `1 conflict` are the singular forms.

**Drawing announcements.** These go to `status "Drawing announcements"`. `<Kind>` is `Line`, `Polyline`, `Circle`, `Arc`, `Hatch`, `Dimension` or `Block`. Counts use `1 entity` and `<n> entities`.
- `<Kind> <handle> added`
- `<n> entities added`
- `Moved <n> entities`, `Copied <n> entities`, `Rotated <n> entities`, `Scaled <n> entities`, `Mirrored <n> entities`, `Erased <n> entities`
- `Arrayed: <n> copies added`
- `Trim: <n> entities changed`, `Extend: <n> entities changed`, `Fillet: <n> entities changed`, `Chamfer: <n> entities changed`, `Offset: <n> entities added`
- `Exploded <handle>: <n> entities added`
- `Block <name> defined`, `Block <name> redefined`
- `Undo: <command>`, `Redo: <command>`, `Nothing to undo.`, `Nothing to redo.`
- When another person changes things: `<user> moved <handle>` for a move of one entity, otherwise `<user> changed <n> entities`
- `Snap on`, `Snap off`, `Ortho on`, `Ortho off`, `Grid on`, `Grid off`, `Polar on`, `Polar off`

**Find.** `status "Find count"` reads `<k> of <n>`, or `No matches.`.

**Phone.** A drawing command typed on a phone gives `Drawing commands aren't available on a phone. Open this drawing on a desktop to edit.` in `status "Command prompt"`.

**Not found page.** It reads `We couldn't find that page.`.

## Backend

### API (DP-02, DP-03, DP-04, DP-05, DP-37, DP-38, DP-39, DP-42, DP-45, DP-47, DP-48, DP-50, DP-53, DP-54, DP-55, DP-57, DP-58)

**Basics.**
- Every request and response body is JSON (`application/json`, UTF-8), except where a row below says the body is raw bytes or text.
- `<id>` values are opaque strings.
- Times are UTC ISO 8601 strings on the server clock.
- Signed-in requests carry the `plot_session` cookie.

**Error body.** Every error uses one body shape: `{"error":"<code>","message":"<sentence>"}`. Validation errors add `"fields":{"<field>":"<sentence>"}`. Import parse errors add `"lines":["<line error>", …]`. Where a rule in Business rules prints a sentence for an error, `message` carries that sentence exactly. Error codes:

| Code | Status | When |
|---|---|---|
| `too_large` | 413 | the body is over its limit |
| `cross_origin` | 403 | a write or live-channel upgrade from another origin, as defined in Server boundary |
| `unauthenticated` | 401 | no valid session where one is needed |
| `rate_limited` | 429 | over an operation or sign-in limit |
| `not_found` | 404 | unknown id, an id outside the caller's folders, or a grading route while grading is off |
| `forbidden` | 403 | the role is too low |
| `read_only` | 403 | an edit by `view` or `markup` |
| `sheet_locked` | 403 | a sheet edit while its lock is on |
| `layer_locked` | 403 | an operation touching an entity on a locked layer, or adding to one |
| `not_ball_in_court` | 403 | an RFI transition by someone other than the ball-in-court owner |
| `stale_base` | 409 | the base revision is too old |
| `illegal_transition` | 409 | a transition the state machine does not allow |
| `rfi_open` | 409 | closing an issue that has an RFI not yet closed |
| `out_of_order` | 409 | approving a step before the previous one |
| `review_voided`, `review_expired` | 409 | acting on a voided or expired review |
| `undo_superseded`, `nothing_to_undo`, `nothing_to_redo` | 409 | undo and redo outcomes |
| `username_taken` | 409 | registering a name already in use |
| `quota_exceeded` | 409 | an underlay that would pass the quota |
| `not_ready` | 409 | downloading an export that is not ready |
| `link_expired`, `link_revoked` | 410 | an old view link |
| `wrong_type` | 422 | an underlay that is not PNG or JPEG, or a text file that is not the format |
| `parse_failed` | 422 | an import with line errors |
| `invalid` | 422 | any other validation, including geometry refusals |
| `storage_unavailable` | 503 | MinIO did not confirm |

**Error order.** When several errors apply, the response is the first that applies, in this order, for the whole API:
1. `too_large`
2. `cross_origin`
3. `unauthenticated`
4. `rate_limited`
5. `not_found`. A drawing, sheet, version, issue, RFI or export outside the caller's folders, including ids nested in paths or bodies, is `not_found` and never 403.
6. the other 403 codes, in table order
7. `stale_base`, then other 409 state conflicts
8. `wrong_type`
9. `quota_exceeded`
10. `invalid`
11. `storage_unavailable`
12. `parse_failed`. An import's line errors are found only after its file is stored. So while file storage is down, an import with line errors answers `storage_unavailable`.

An operation replayed by its `op_id` returns its stored result before any state check.

**Accounts**

| Method and path | Request | Success |
|---|---|---|
| `POST /api/auth/register` | `{"username","password"}` | 201 `{"username"}`, signed in |
| `POST /api/auth/login` | `{"username","password"}` | 200 `{"username"}` and `Set-Cookie: plot_session=…; HttpOnly; SameSite=Lax; Path=/` |
| `POST /api/auth/logout` | — | 204 |
| `GET /api/me` | — | 200 `{"username"}` |

A failed login answers 401 `unauthenticated` with the wrong-credentials text.

**Folders and drawings**

| Method and path | Request | Success |
|---|---|---|
| `GET /api/folders` | — | 200 `{"folders":[{"id","name","parent_id","role"}]}`, only folders where the caller has a role |
| `POST /api/folders` | `{"name","parent_id"}` (null for a top folder) | 201 folder; the creator gets `manage` |
| `PUT /api/folders/<id>/roles/<username>` | `{"role":"view"\|"markup"\|"edit"\|"manage"}` | 200 `{"username","role","inherited":false}`; needs `manage` |
| `DELETE /api/folders/<id>/roles/<username>` | — | 204; needs `manage` |
| `GET /api/folders/<id>/drawings` | — | 200 `{"drawings":[{"id","name","sheets":[{"id","name","versions":[{"id","number","state"}]}]}]}` |
| `POST /api/folders/<id>/drawings` | `{"name"}` | 201 `{"id","name","revision":0}`; needs `edit` |
| `GET /api/drawings/<id>` | — | 200 `{"id","name","folder_id","role","revision","next_handle","layers","entities","blocks","dim_styles","parameters","constraints","xrefs","layer_states","underlays","sheets"}`, with entities in the operation entity form |
| `GET /api/drawings/<id>/entities/<handle>/history` | — | 200 `{"history":[{"revision","username","command","at"}]}`, newest first |
| `GET /api/drawings/<id>/live` | WebSocket upgrade | see Live channel |

**Operations, undo and redo**

`POST /api/drawings/<id>/ops` takes `{"base_revision":n,"group_id":"…","command":"MOVE","ops":[{"op_id":"…","type":"…",…}]}`. It answers 200 `{"revision":n,"results":[{"op_id","status":"applied"|"rebased"|"dropped"|"redirected","handles":["L12"],"message":null|"<notice>"}]}`. Its errors are `read_only`, `layer_locked`, `stale_base`, `invalid` and `rate_limited`. The `command` is the typed command name, or `GRIP`, `NUDGE`, `LAYER`, `PROPERTIES`, `PARAM`, `XRELOAD`, `XCLIP`, `LAYERSTATE`, `RESTORE` or `IMPORT`.

The entity form uses the geometry field names from the Coordinates rule plus `type` and `layer`, and optionally `colour`, `linetype` and `lineweight`:
- `line` has `x1 y1 x2 y2`.
- `circle` has `cx cy r`.
- `arc` has `cx cy r start end`.
- `pline` has `points` as `[[x,y],…]` and `closed`.
- `insert` has `block x y scale rotation` and `attributes` as `{"TAG":"value"}`.
- `hatch` has `seed_x seed_y`; the server finds the boundary.
- `dimension` has `kind`, `style`, `refs` as `[{"handle","point":"start"|"end"|"centre"}]`, `override`, and `text_x text_y` for the text position.

Operation types and their fields:

| `type` | Fields |
|---|---|
| `add` | `entity` (a new handle is assigned) |
| `modify` | `handle`, `set` (fields to change) |
| `move` | `handles`, `dx`, `dy` |
| `delete` | `handles` |
| `layer_add` | `name`, `colour`, `linetype`, `lineweight` |
| `layer_set` | `name`, `set` (`on`, `frozen`, `locked`, `colour`, `linetype`, `lineweight`, `rename`) |
| `layer_delete` | `name` |
| `layer_state_save`, `layer_state_restore` | `name` |
| `block_define` | `name`, `base` `[x,y]`, `handles` (entities moved into the block), `attributes` `[{"tag","default"}]`; redefines when the name exists |
| `explode` | `handle` |
| `purge` | — |
| `dim_style_set` | `name`, `precision`, `prefix`, `suffix`, `scale`, `text_height_mm` |
| `constraint_add` | `kind`, `refs` `[{"handle","point":null\|"start"\|"end"}]`, `expression` for `length` and `radius` |
| `constraint_delete` | `id` |
| `parameter_set` | `name`, `expression` |
| `parameter_delete` | `name` |
| `xref_attach` | `name`, `source` (drawing id), `x`, `y`, `scale`, `rotation` |
| `xref_clip` | `name`, `rect` `[x1,y1,x2,y2]` or null |
| `xref_reload`, `xref_bind` | `name` |
| `version_restore` | `version` (version id) |
| `import_merge` | `import_id` |

The undo routes:
- `POST /api/drawings/<id>/undo` with `{}` answers 200 `{"revision","command"}`. Its errors are `undo_superseded`, whose message is the skip text, and `nothing_to_undo`.
- `POST /api/drawings/<id>/redo` answers in the same way, with `nothing_to_redo`.

**Uploads and exports**

| Method and path | Request | Success |
|---|---|---|
| `POST /api/drawings/<id>/underlays?x1=&y1=&x2=&y2=` | raw image bytes | 201 `{"id","key","bytes","x1","y1","x2","y2"}`; an identical image already on this drawing answers 200 with that underlay and changes nothing |
| `POST /api/drawings/<id>/imports` | raw text bytes | 201 `{"import_id","key","adds":{"entities","layers","blocks"},"renames":[{"from","to"}]}`; line errors give `parse_failed` after the file is stored |
| `POST /api/drawings/<id>/exports` | `{"format":"plot.txt"\|"svg"}` | 202 `{"id","state":"queued","progress":0}` |
| `GET /api/exports/<id>` | — | 200 `{"id","format","state","progress","download_url":null\|"/api/exports/<id>/download"}` |
| `POST /api/exports/<id>/retry` | — | 202 the job in `running` with progress 0; `illegal_transition` unless it is `failed` |
| `GET /api/exports/<id>/download` | — | 200 the file bytes; `not_ready` before `ready` |

**Sheets, versions and review**

| Method and path | Request | Success |
|---|---|---|
| `POST /api/drawings/<id>/sheets` | `{"name","size":"A3"\|"A4"}` | 201 `{"id","name","size","number","locked":false}` |
| `PATCH /api/sheets/<id>` | `{"attributes":{"TAG":"value"}}` and/or `{"locked":bool}` (`locked` needs `manage`) | 200 the sheet |
| `POST /api/sheets/<id>/viewports` | `{"x","y","width","height","scale":"1:n","view_x","view_y","frozen_layers":[]}` | 201 viewport with `id` |
| `PATCH /api/viewports/<id>` | any of those fields | 200 viewport |
| `POST /api/sheets/<id>/versions` | `{}` | 201 `{"id","number","state":"published","keys":["…json","…svg"]}` |
| `GET /api/sheets/<id>/versions` | — | 200 `{"versions":[{"id","number","state","replaced_by","stamps":[…]}]}` |
| `GET /api/versions/<id>` | — | 200 `{"id","sheet_id","number","state","snapshot":{…}}` |
| `GET /api/sheets/<id>/compare?from=<n>&to=<m>` | — | 200 `{"added","removed","changed","entities":[{"id","diff":"added"\|"removed"\|"changed"\|"same"}]}` |
| `POST /api/versions/<id>/markups` | `{"kind":"cloud"\|"arrow"\|"text","x1","y1","x2","y2","text"}` | 201 markup `{"id","kind",…,"flag":null}`; needs `markup` |
| `GET /api/versions/<id>/markups` | — | 200 `{"markups":[…]}` with `flag` null or `"geometry-changed"` |
| `POST /api/versions/<id>/review` | `{}` | 201 `{"state":"in_review","steps":[{"role":"markup","state":"pending","due_at"},{"role":"manage","state":"waiting"}]}`; needs `edit` |
| `POST /api/versions/<id>/review/<step>/approve`, `…/reject` | `{"comment"}` | 200 version with stamps; `<step>` is `markup` or `manage` |
| `POST /api/versions/<id>/links` | `{}` | 201 `{"id","url":"/v/<token>","expires_at"}`; needs `manage` |
| `DELETE /api/links/<id>` | — | 204 |
| `GET /api/links/<token>` | — | 200 the version as `GET /api/versions/<id>`, no session needed |

**Issues and RFIs**

| Method and path | Request | Success |
|---|---|---|
| `POST /api/versions/<id>/issues` | `{"title","x","y"}` | 201 `{"id","title","x","y","state":"open","creator"}`; needs `markup` |
| `GET /api/drawings/<id>/issues` | — | 200 `{"issues":[{…,"rfi_ids":[…]}]}` |
| `POST /api/issues/<id>/transitions` | `{"to":"answered"\|"closed"\|"open"}` | 200 issue |
| `POST /api/issues/<id>/rfis` | `{"question","addressee"}` | 201 `{"id","issue_id","state":"draft","asker","addressee","ball_in_court":"<asker>"}` |
| `POST /api/rfis/<id>/transitions` | `{"to":"sent"\|"answered"\|"closed","answer"}` | 200 RFI |

**Grading routes.** These answer `not_found` unless `PLOT_GRADING` is `1`.

`POST /api/grading/seed` creates everything in one call and adds to what exists. Its request, with the fields each record takes:

```
{"users":[{"username","password"}],
 "folders":[{"key","name","parent":null|"<folder key>","roles":{"<username>":"<role>"}}],
 "drawings":[{"key","folder","name",
   "layers":[{"name","colour","linetype","lineweight","on","frozen","locked"}],
   "entities":[<entity form with "handle">],
   "generate":{"lines":n,"spacing":s},
   "blocks":[{"name","base":[x,y],"entities":[…],"attributes":[{"tag","default"}]}],
   "dim_styles":[…],"parameters":[{"name","expression"}],
   "constraints":[{"kind","refs","expression"}],
   "xrefs":[{"name","source":"<drawing key>","x","y","scale","rotation","clip"}],
   "layer_states":[{"name"}],
   "sheets":[{"key","name","size","locked","attributes":{},
     "viewports":[…],"publish":k,
     "markups":[{"version":v,…}],"issues":[{"version":v,"key",…}],
     "rfis":[{"issue":"<issue key>","key","question","asker","addressee","state"}],
     "reviews":[{"version":v,"state","steps":[…]}],
     "links":[{"version":v,"key"}]}]}]}
```

More on the seed request:
- `generate` adds `n` horizontal lines of length 1 on layer `0`, placed on a square grid at spacing `s`, starting at 0,0 and filling rows of 100.
- `publish` publishes `k` versions in turn through the normal storage path.
- Handles you give are kept, and `next_handle` is one more than the highest number used.

The seed answers 201 `{"users":[…],"folders":{"<key>":"<id>"},"drawings":{…},"sheets":{…},"versions":{"<sheet key>:<number>":"<id>"},"issues":{…},"rfis":{…},"links":{"<key>":"/v/<token>"}}`. An existing username gives `username_taken`.

The other grading routes:
- `POST /api/grading/session` with `{"username"}` signs that person in for the calling browser context and answers 200 `{"username"}` with the cookie.
- `POST /api/grading/view` with `{"drawing","zoom","pan_x","pan_y"}` sets the starting viewport of that drawing for the calling context and answers 204.
- `POST /api/grading/clock` with `{"advance_ms":n}` moves the server clock forward and answers 200 `{"now"}`. Deadlines that pass apply at once and are broadcast.
- `POST /api/grading/drawings/<id>/ops` with `{"as":"<username>","base_revision":n,"ops":[…],"command":"EDIT","group_id":"…"}` applies the batch exactly like the operations route, as that person, and broadcasts it. `command` and `group_id` are optional; their defaults are `EDIT` and a new id. It answers like the operations route.
- `POST /api/grading/storage` with `{"down":true|false}` makes every MinIO call fail, or work again, without a restart, and answers 200 `{"down"}`.

**Live channel.** `GET /api/drawings/<id>/live` upgrades to a WebSocket for anyone with a role on the drawing.
- The page's first message is `{"type":"hello","since":<last seq or 0>}`.
- The server replies with every message after `since`, then live messages. Each message is `{"seq":n,"type":"<type>","data":{…}}`, and `seq` counts up by one per drawing.
- The types used are:
  - `ops`: applied groups with their results
  - `presence`
  - `xref_version`
  - `version`
  - `markup`
  - `issue`
  - `rfi`
  - `review`
  - `role`
  - `export`
  - `notice`: a toast aimed at one person
  - `link`
- The server keeps the socket alive with protocol pings and never closes it for client silence.

A view-link page opens `GET /api/links/<token>/live` instead. It receives only `link` messages for that link.

### Business rules (DP-02, DP-03, DP-05, DP-12 to DP-14, DP-16 to DP-18, DP-20 to DP-22, DP-24, DP-25, DP-27, DP-28, DP-30, DP-31, DP-33, DP-35, DP-37 to DP-40, DP-42 to DP-45, DP-47 to DP-50, DP-52 to DP-55, DP-57 to DP-59)

**Accounts.** A username is 3 to 24 characters from `a` to `z`, `0` to `9` and `_`, stored in lower case. A password is at least 8 characters. Mentions and notices use usernames.

**Command line.** `textbox "Command"` takes every command. At rest, `status "Command prompt"` reads `Ready. Type a command.`.

- **Running.** A command name or alias runs on Enter or Space, in any letter case.
- **Space.** Space acts as Enter, except at stages whose input is a name, an expression or text (block, drawing and xref names, attribute values, PARAM and CONSTRAIN expressions). There it is a character.
- **Unknown names.** An unknown name shows `Unknown command: <TEXT>. Nothing happened.`, where `<TEXT>` is the typed text in upper case.
- **Repeat and end.** An empty Enter or Space at Ready repeats the last command from its first stage. Inside a command, an empty Enter ends the stage as its prompt says.
- **Escape.** Escape cancels the command and drops its uncommitted work. The prompt reads `Cancelled.` until the next key press, then the Ready prompt.
- **U.** Inside a command, U steps back one point and shows that stage's prompt again.
- **Errors and results.** A refusal or numeric result replaces the prompt text until the next key press, and the command stays at the same stage.
- **Undo steps.** One command run is one operation group, so one undo step. That includes COPY with many targets and OFFSET with many picks.
- **Picking.** A pick stage accepts a typed handle, or a typed or clicked point. A point picks the nearest entity within the snap aperture, and the point is the pick point. A typed handle's pick point is the entity's midpoint, or its centre for circles. A pick that finds nothing shows `Nothing there to pick.`.

| Command | Alias | Stage prompts in order |
|---|---|---|
| LINE | L | `LINE: from point`, `LINE: to point (Enter ends, U steps back)` (repeats; with three or more points, `CL` closes back to the first point and ends) |
| PLINE | PL | `PLINE: from point`, `PLINE: to point (Enter ends, U steps back, CL closes)` (repeats) |
| RECT | REC | `RECT: first corner`, `RECT: opposite corner` (makes a closed four-point polyline, starting at the first corner and going counter-clockwise) |
| CIRCLE | C | `CIRCLE: centre`, `CIRCLE: radius` (a number, or a point whose distance is the radius) |
| ARC | A | `ARC: centre`, `ARC: start point`, `ARC: end point` (radius is the centre-to-start distance; counter-clockwise from start to the direction of the end point) |
| MOVE | M | `MOVE: pick entities (Enter ends picking)`, `MOVE: from point`, `MOVE: to point` |
| COPY | CO | `COPY: pick entities (Enter ends picking)`, `COPY: from point`, `COPY: to point (Enter ends)` (repeats) |
| ROTATE | RO | `ROTATE: pick entities (Enter ends picking)`, `ROTATE: about point`, `ROTATE: angle in degrees` |
| SCALE | SC | `SCALE: pick entities (Enter ends picking)`, `SCALE: about point`, `SCALE: factor` |
| MIRROR | MI | `MIRROR: pick entities (Enter ends picking)`, `MIRROR: axis first point`, `MIRROR: axis second point`, `MIRROR: keep originals? Y or N (Enter is Y)` |
| OFFSET | O | `OFFSET: distance`, `OFFSET: pick entity`, `OFFSET: pick side` (returns to pick entity until Enter) |
| TRIM | TR | `TRIM: pick cutting edges (Enter for every entity)`, `TRIM: pick the part to remove (Enter ends)` (Enter with no edges picked uses every entity) |
| EXTEND | EX | `EXTEND: pick boundaries (Enter for every entity)`, `EXTEND: pick the end to extend (Enter ends)` |
| FILLET | F | `FILLET: radius`, `FILLET: first line`, `FILLET: second line` |
| CHAMFER | CHA | `CHAMFER: first distance`, `CHAMFER: second distance`, `CHAMFER: first line`, `CHAMFER: second line` |
| ARRAY | AR | `ARRAY: pick entities (Enter ends picking)`, `ARRAY: R for rows or P for polar`; rows: `ARRAY: rows`, `ARRAY: columns`, `ARRAY: row gap`, `ARRAY: column gap`; polar: `ARRAY: centre`, `ARRAY: count`, `ARRAY: total angle` |
| HATCH | H | `HATCH: pick a point inside` |
| DIST | DI | `DIST: first point`, `DIST: second point`, then the result `DIST: <d> units, angle <a> degrees` |
| AREA | AA | `AREA: pick a closed entity or a point inside`, then the result `AREA: <area>` |
| ERASE | E | `ERASE: pick entities (Enter ends picking)` (with a selection, erases it at once) |
| EXPLODE | X | `EXPLODE: pick block inserts (Enter ends picking)` |
| LAYER | LA | moves focus to `grid "Layer list"` |
| BLOCK | B | `BLOCK: name`, `BLOCK: base point`, `BLOCK: pick entities (Enter ends picking)`, `BLOCK: attribute TAG=default (Enter for none)` (repeats until Enter) |
| INSERT | I | `INSERT: block name`, `INSERT: insertion point`, `INSERT: scale (Enter is 1)`, `INSERT: rotation in degrees (Enter is 0)` |
| PURGE | PU | runs at once |
| DIMLINEAR | DL | `DIMLINEAR: first point`, `DIMLINEAR: second point`, `DIMLINEAR: line position` |
| DIMALIGNED | DA | `DIMALIGNED: first point`, `DIMALIGNED: second point`, `DIMALIGNED: line position` |
| DIMANGLE | DG | `DIMANGLE: first line`, `DIMANGLE: second line`, `DIMANGLE: arc position` |
| DIMRADIUS | DR | `DIMRADIUS: pick circle or arc`, `DIMRADIUS: text position` |
| CONSTRAIN | CN | `CONSTRAIN: kind (coincident, horizontal, vertical, parallel, perpendicular, equal, fixed, length, radius)`, then `CONSTRAIN: pick first entity` and `CONSTRAIN: pick second entity` for kinds needing two, or `CONSTRAIN: pick first point` and `CONSTRAIN: pick second point` for coincident, then `CONSTRAIN: expression` for length and radius |
| PARAM | PM | `PARAM: name = expression` (sets or creates; an empty Enter moves focus to `grid "Parameter list"`) |
| XATTACH | XA | `XATTACH: drawing name`, `XATTACH: xref name`, `XATTACH: insertion point`, `XATTACH: scale (Enter is 1)`, `XATTACH: rotation in degrees (Enter is 0)` |
| XBIND | XB | `XBIND: xref name` |
| FIND | FD | opens `search "Find"` |
| ZOOMALL | ZA | runs at once |

Value refusals, shown in `status "Command prompt"` at the same stage:

| Situation | Text |
|---|---|
| Not a point | `That isn't a point. Try 10,20 or @5,0 or @10<45.` |
| Not a number | `That isn't a number.` |
| A radius, scale factor, count, row or column count that is zero or less | `Enter a number greater than 0.` |
| Unknown block | `No block named <name>.` |
| Unknown drawing in this folder | `No drawing named <name> in this folder.` |
| Unknown xref | `No xref named <name>.` |

Unknown drawing names are matched exactly.

**Point input forms.**
- Absolute: `10,20`.
- Relative: `@5,0`, from the last point entered in any command. The last point starts at 0,0.
- Polar: `@10<45`, a distance and an angle in degrees counter-clockwise from +X.

**Coordinates and display.**
- World units have Y up. `region "Drawing"` exposes `data-zoom`, `data-pan-x` and `data-pan-y`. Screen position, in px from the drawing pane's top-left corner, is screen X = world X × zoom + pan X and screen Y = −world Y × zoom + pan Y.
- Stored numbers are rounded to 6 decimals, half away from zero. Data attributes print stored numbers with trailing zeros trimmed.
- Visible text and entity labels use 3 decimals with trailing zeros trimmed. A `-0` shows as `0`. Angles in DIST results use 2 decimals, trimmed. `<d>` and `<area>` use 3 decimals.
- Exception for dimensions: a dimension's `data-value`, its visible text and its entity-list value use the dimension style's precision, rounded half away from zero, with trailing zeros kept. For example, with `Standard` a value of 10 shows as `10.00`.
- The tolerance for every comparison is 0.001.

**Drawing root.** `region "Drawing"` exposes:
- `data-revision`: the server revision this page has seen
- `data-pending-ops`: operations sent or queued but not yet confirmed. `0` means settled.
- `data-total-entities`
- `data-snap-kind`, `data-snap-x` and `data-snap-y`
- `data-zoom`, `data-pan-x` and `data-pan-y`

**Entity elements.** Each visible entity is one SVG element. It has:
- `data-entity-id`: the handle, a letter then the drawing's next number. The letters are `L` line, `P` polyline, `C` circle, `A` arc, `H` hatch, `D` dimension and `I` block insert. One counter serves all types, and a number is never reused.
- `data-type`: `line`, `pline`, `circle`, `arc`, `hatch`, `dimension` or `insert`
- `data-layer`
- the geometry:
  - line: `data-x1 data-y1 data-x2 data-y2`
  - circle: `data-cx data-cy data-r`
  - arc: `data-cx data-cy data-r data-start data-end`, in degrees from 0 up to but not including 360
  - polyline: `data-points="x,y x,y …"` and `data-closed`
  - insert: `data-block data-x data-y data-scale data-rotation`
  - hatch: `data-area data-associative`
  - dimension: `data-kind data-value data-associative`
- the effective `data-colour`, `data-linetype` and `data-lineweight`, after inheritance

An optimistic new entity has `data-entity-id="new-<n>"` until the server confirms its handle.

**Entity list.** `grid "Entities"` lists every entity in the drawing, not only those whose elements are on the page.
- Model entities come first, in handle number order, then xref entities by their full id `<xref name>|<handle>` in text order.
- Rows may be rendered on demand. `aria-rowcount` is always the whole count, and each row's `aria-rowindex` is its place in the whole list.
- Each row has role `row`, and its accessible name is exactly its label from this table:

| Type | Row label |
|---|---|
| line | `Line <handle>, layer <layer>, from <x1>,<y1> to <x2>,<y2>, length <length>` |
| circle | `Circle <handle>, layer <layer>, centre <cx>,<cy>, radius <r>, area <area>` |
| arc | `Arc <handle>, layer <layer>, centre <cx>,<cy>, radius <r>, from <start> to <end> degrees, length <length>` |
| open polyline | `Polyline <handle>, layer <layer>, <k> points, open, length <length>` |
| closed polyline | `Polyline <handle>, layer <layer>, <k> points, closed, length <length>, area <area>` |
| hatch | `Hatch <handle>, layer <layer>, area <area>` |
| dimension | `Dimension <handle>, layer <layer>, <kind>, value <value>` |
| block insert | `Block <handle>, layer <layer>, <block> at <x>,<y>, scale <scale>, rotation <rotation>` |

Placeholders in the row labels:
- `<handle>` is the full entity id.
- Every number except a dimension's `<value>` uses the display precision in Coordinates and display. A point is written as `x,y` with no space.
- `<k>` is the point count.
- A closed polyline's length includes its closing segment.
- `<kind>` is `linear`, `aligned`, `angular` or `radial`.
- `<value>` is the dimension's `data-value`.

For example, the line L12 from 0,0 to 10,0 on layer `Walls` reads `Line L12, layer Walls, from 0,0 to 10,0, length 10`. The circle C3 centred 5,5 with radius 2 on layer `Walls` reads `Circle C3, layer Walls, centre 5,5, radius 2, area 12.566`.

Rows for entities on locked, off or frozen layers are listed, but the selection rules still apply to them.

**Snaps.** Snaps apply when Snap is on.

| Kind, highest priority first | Candidates |
|---|---|
| `endpoint` | line and arc ends, polyline vertices |
| `midpoint` | line, polyline segment and arc midpoints |
| `centre` | circle and arc centres |
| `intersection` | real crossings of lines, arcs, circles and polyline segments |
| `perpendicular` | the foot of the perpendicular from the last point to a line or segment, when it lies on it |
| `tangent` | from the last point to a circle or arc, the one of the two tangent points nearer the pointer |
| `nearest` | the closest point on any entity to the pointer |

- **Choosing a candidate.** The aperture is 10 screen px. Of the candidates inside it, the highest priority wins. A tie goes to the smaller screen distance, then the lower handle number. `data-snap-kind` is the winning kind, or `none`.
- **Building a pointer point.** An object snap inside the aperture wins outright. Otherwise Polar or Ortho applies from the last point. Then Grid, when it is on, rounds to the nearest whole world unit as follows:
  - **No shaping.** With neither Ortho nor Polar on, or with Polar on but the direction more than 5 degrees from every multiple of 45 degrees, Grid rounds both coordinates.
  - **Axis directions.** After Ortho, or after Polar turned the direction onto 0, 90, 180 or 270 degrees, Grid rounds only the coordinate that differs from the last point's. The other coordinate stays equal to the last point's.
  - **Diagonal directions.** After Polar turned the direction onto 45, 135, 225 or 315 degrees, Grid rounds the distance from the last point and keeps the angle. The resulting coordinates are then stored rounded to 6 decimals.
- **Ortho** keeps the larger of |dx| and |dy| and zeroes the other.
- **Polar** turns a direction within 5 degrees of a multiple of 45 degrees onto that multiple, keeping the pointer's distance.
- **Ortho and Polar exclude each other.** Turning one on turns the other off.
- Snaps, picks, selection and FIND skip entities on off or frozen layers and use the whole drawing, not just the elements on the page.

**Selection, grips and properties.**
- A window dragged left to right selects entities wholly inside it and draws with `data-window="window"`. One dragged right to left selects whatever it touches and draws with `data-window="crossing"`.
- Entities on locked or frozen layers cannot be selected or picked. Selected entities carry `aria-selected="true"`.
- Each selected entity shows grips as `data-grip="<kind>"` elements with `data-x data-y`:
  - line: `end` at each end, which stretches that end, and `mid`, which moves the whole line
  - circle: `centre`, which moves it, and four `quadrant` grips, which set the radius
  - arc: `centre`, and `end` at each end, which change that end's angle
  - polyline: `vertex` per point
- A grip drag is one operation group with command `GRIP`.
- The Properties region shows `Length` for lines, polylines and arcs and `Area` for closed entities, in display precision. Where selected entities differ in a value, it shows `*VARIES*`.
- Delete erases the selection.
- An arrow-key nudge moves the selection by 1 world unit, or 10 with Shift. Each key press is one group with command `NUDGE`.

**Geometry commands.** Each produces exactly these results.
- **TRIM** works on lines, arcs and circles. Any other target gives `TRIM works on lines, arcs and circles. Explode a polyline first.`
  - The picked entity is split at every crossing with the cutting edges, and the piece holding the pick point goes.
  - If two pieces remain, the piece holding the original first point (for arcs, the start) keeps the handle and the other gets a new handle.
  - A circle needs at least two crossings. It is replaced by the arc that remains, and that arc gets a new `A` handle. The circle's `C` handle is retired and never reused.
  - The trim announcement's `<n>` counts each picked entity once, plus each new entity that a split adds. A circle replaced by its arc counts once. For example, splitting one line into two pieces counts 2.
  - With too few crossings: `Nothing to trim: that entity doesn't cross a cutting edge.`
  - For example, with the cutting edge from 5,-5 to 5,5, trimming the line L1 from 0,0 to 10,0 picked at 8,0 leaves L1 from 0,0 to 5,0.
- **EXTEND** works on lines and arcs. It moves the end nearest the pick, along the entity's direction (for an arc, along its circle), to the first boundary crossed. If none is crossed: `Nothing to extend: no boundary in that direction.`
- **FILLET** works on two lines.
  - X is their crossing, extended if needed. The kept part of each line is the side of X holding its pick point.
  - For a radius r above 0, the tangent points lie at t = r / tan(θ / 2) from X, where θ is the angle between the kept parts. Each line ends at its tangent point, and a new arc of radius r joins them, centred r from both lines.
  - A radius of 0 trims or extends both lines to X and adds no arc.
  - Parallel lines: `These lines are parallel. Nothing to fillet.` When t is longer than a kept part: `Radius too large for these lines.`
  - For example, the lines 0,0 to 10,0 and 0,0 to 0,10, picked near 8,0 and 0,8, with r = 2, end at 2,0 and 0,2, joined by an arc centred 2,2 from 180 to 270 degrees.
- **CHAMFER** works on two lines. It cuts the kept parts back to d1 and d2 from X and joins those points with a new line. d1 = d2 = 0 acts like a fillet of radius 0.
  - Parallel lines: `These lines are parallel. Nothing to chamfer.`
  - A distance longer than its kept part: `Distance too large for these lines.`
- **OFFSET**
  - A line becomes a new line moved d at right angles towards the picked side.
  - A circle or arc becomes a new one, same centre, with radius r + d when the side is outside and r − d when inside.
  - A radius reaching 0 or below gives `Offset would make a radius of zero or less.`
  - A polyline offsets each segment and joins neighbours at the crossing of their offset lines.
- **MIRROR** reflects across the axis. An arc's start and end swap so that it stays counter-clockwise. Y or Enter keeps the originals; N erases them.
- **ARRAY** keeps the original.
  - A rectangular array adds copies row by row, with the original's cell first: rows go up by the row gap and columns go right by the column gap.
  - A polar array adds copies rotated about the centre by steps of total angle / count when the total is 360, otherwise total angle / (count − 1). Each copy is rotated with its position.
  - Copy handles increase in creation order.
- **DIST** reports the distance and the direction angle from the first point to the second, from 0 up to 360 degrees.
- **AREA** reports a closed entity's area, or the hatch-rule area around a point.

**Layers.**
- Each layer has `On`, `Frozen` and `Locked`, plus a colour, linetype and lineweight. Each change is one group with command `LAYER`.
  - Colours: `white`, `red`, `yellow`, `green`, `cyan`, `blue`, `magenta`, `grey`.
  - Linetypes: `Continuous`, `Dashed`, `Dotted`, `Centre`.
  - Lineweights, in mm: `0.13`, `0.18`, `0.25`, `0.35`, `0.5`, `0.7`.
- An entity's colour, linetype and lineweight default to `ByLayer`, which takes the layer's value.
- Layer `0` always exists. It cannot be deleted or renamed: `Layer 0 can't be deleted.`
- A layer with entities cannot be deleted: `Layer <name> has <n> entities. Move them first.`
- Entities on an off or frozen layer are not drawn, and snaps, selection and FIND skip them. There is one difference: the hatch boundary search ignores a frozen layer's entities but still uses an off layer's.
- `combobox "Current layer"` sets the layer for new entities. A frozen layer cannot be current: `Frozen layers can't be current.`
- `button "Save layer state"` saves every layer's On, Frozen, Locked, colour, linetype and lineweight under a name. `button "Restore"` puts them back as one group with command `LAYERSTATE`.

**Layer locks against live selections.** When someone locks or freezes a layer while another person has entities on it selected, those entities leave that person's selection at once. That person gets the toast `<user> locked <layer>. <n> entities left your selection.`, where `<user>` is the person who locked or froze it. An operation touching a locked layer is refused with `layer_locked` and the message `Layer <layer> is locked.`.

**Blocks.**
- BLOCK makes a definition from entities, a base point and a name. The picked entities become one insert of it at the base point.
- INSERT places an insert at a point, scale and rotation. A definition entity point p is drawn at insert point + rotate(rotation, scale × (p − base)).
- A definition entity on layer `0` with colour `ByBlock` takes the insert's effective colour. Other values stay as defined.
- Blocks may nest.
- Each tag's default fills new inserts. Each insert keeps its own values, edited in Properties as one group with command `PROPERTIES`.
- Redefining a block updates every insert on every screen live and keeps the values of tags that still exist.
- A definition that contains itself, directly or through other blocks, is refused: `Block <name> can't contain itself: <chain>.`, where `<chain>` lists the names joined by ` -> `, starting and ending with `<name>`.
- EXPLODE replaces one insert with its definition's entities at their drawn positions, with new handles, and drops the attributes.
- PURGE removes unused block definitions and empty layers other than `0`, and prints `Purged <b> blocks, <l> layers.` in the command prompt.

**Dimensions.**
- A dimension point that lies within 0.001 of an entity's start, end or centre links to that entity point.
- Values:
  - linear: |dx| if the points' horizontal span is at least their vertical span, otherwise |dy|
  - aligned: the distance between the points
  - angular: the smaller angle between two lines, in degrees
  - radial: the radius
- The dimension style `Standard` has precision 2, no prefix or suffix, scale 1 and text height 2.5 mm. Each style has a precision (decimals), prefix, suffix, scale (multiplies the value) and text height. `data-value` is the scaled value at the style's precision, with trailing zeros kept, by the dimension exception in Coordinates and display.
- The visible text is prefix + value + suffix. An override replaces it, with `<>` standing for that text.
- Values follow every geometry change, undo, redo, block redefinition and remote change, on every screen live.
- Deleting a linked entity leaves the dimension at its last value with `data-associative="false"`, and its author gets the toast `Dimension <handle> lost its geometry.`. Undoing that delete restores `data-associative="true"` and the live value.

**Hatch.**
- HATCH finds the smallest closed loop around the picked point. A loop is a closed polyline, a circle, or a chain of lines and arcs whose ends meet within 0.001. Closed loops wholly inside it are islands; only islands one level deep count.
- `data-area` = the outer area − the sum of island areas.
  - A polygon's area uses the shoelace formula.
  - For each arc in a loop, the segment r²/2 × (θ − sin θ) is added when the arc bulges outward and subtracted when inward, with θ in radians.
  - A circle's area is π r².
- With no loop around the point: `No closed boundary around that point.`
- The area recalculates whenever a boundary or island entity changes, from any person.
- If the boundary stops being closed, the hatch keeps its last shape and area with `data-associative="false"`, and its author gets the toast `Hatch <handle>: boundary broken. It no longer follows its edges.`. Undoing the change that broke it restores `data-associative="true"` and the area.

**Constraints and parameters.**
- Geometric constraints:
  - `coincident`: two line end points
  - `horizontal` and `vertical`: one line
  - `parallel`, `perpendicular` and `equal`: two lines
  - `fixed`: a line or a line end point
- Dimensional constraints:
  - `length`: a line's length equals an expression
  - `radius`: a circle's radius equals an expression
- Parameters are named `d` plus digits. An expression uses numbers, parameter names, `+ - * /` and parentheses. `region "Parameters"` lists each parameter's name, expression and current value. Each edit is one group with command `PARAM`.
- Constraint labels read `<kind> <handles>`, for example `horizontal L1` and `length L1 = d1`.
- Solving keeps every constraint within 0.0001. Fixed entities never move. A dragged point stays where it is dragged unless it is fixed. Every other entity moves as little as it must. Constraints are applied in the order they were created, repeating for at most 50 passes.
- A new constraint, or an edit that leaves any constraint unsatisfied after 50 passes, is refused and changes nothing: `Over-constrained: <new> conflicts with <existing>.`, where `<existing>` is the first unsatisfied constraint in creation order.
- Expression errors:
  - `Expression cycle: <chain>.`, with the names joined by ` -> `, for example `d1 -> d2 -> d1`
  - `Unknown parameter: <name>.`
  - `Expression divides by zero: <name>.`
- A refused optimistic edit rolls back on screen.

**Xrefs.**
- XATTACH places another drawing from the same folder at a point, scale and rotation. It shows that drawing's model from its last published version, with points drawn by the block insert transform.
- The xref's layers appear in Layers as `<xref name>|<layer>`. Its entities carry `data-entity-id="<xref name>|<handle>"`. They are read-only, but snaps use them.
- Nested xrefs apply each transform in turn.
- A clip is a world rectangle. Only entities wholly or partly inside it are drawn, and parts outside are cut at its edge. Each clip change is one group with command `XCLIP`.
- When the source publishes a new version, everyone viewing the host sees `status "Xref notice"` read `<xref name> has a new version. Reload?` with `button "Reload"`. A reload is one group with command `XRELOAD` and updates the entities for everyone live.
- An attachment that would make a chain loop back is refused: `Circular reference: <chain>.`, with drawing names joined by ` -> `.
- XBIND turns one xref level into a block named after the xref, and its layers into `<xref name>$<layer>`.

**Sheets.**
- A sheet is a paper layout in millimetres with Y down: A3 is 420 × 297 and A4 is 297 × 210. Sheets are numbered in creation order within a drawing.
- A viewport has a paper rectangle (x, y, width, height), a scale `1:n` and a view centre in world units. A world point maps to paper as follows:
  - paper X = vp X + (world X − view centre X) / n + width / 2
  - paper Y = vp Y + height / 2 − (world Y − view centre Y) / n
- Viewport elements expose `data-scale` (`1:n`), `data-view-x` and `data-view-y`. Each draws its own copy of every entity, with `data-paper-x` and `data-paper-y` at the entity's first point.
- A layer in a viewport's frozen list is hidden only in that viewport.
- Annotation scale: dimension text in a viewport has the style's millimetre height on paper, so world text height = paper height × n. Each dimension's copy in a viewport has a text element carrying two attributes:
  - `data-text-height-mm`: its height on paper in mm, which is the style's text height
  - `data-world-text-height`: that paper height × n, in world units
- Every sheet carries the built-in title block for its size. These attributes fill themselves and cannot be edited:
  - `Sheet no`: the sheet's number
  - `Title`: the sheet name
  - `Drawn by`: the sheet's creator
  - `Scale`: the first viewport's `1:n`, or `Varies` when viewports differ
  
  Other tags are edited per sheet.

**Operations.**
- Every change is an operation with an `op_id`, the `base_revision` it was made from and a group id. The server applies operations one at a time in arrival order, and each one adds 1 to the drawing's `revision`.
- A base revision more than `PLOT_OP_WINDOW` behind the current revision is refused with `stale_base` and the message `This change is too old. Reload the drawing and try again.`.
- Resending an `op_id` returns its first result and changes nothing.
- A group applies all or nothing.
- More than `PLOT_OP_RATE` operations by one person in one minute are refused with `rate_limited`.

**Conflict rules.** These apply when an operation's base revision is older than another person's change to the same target. The second sentence in each row is a toast sent to the person named.

| Case | Result and status | Toast |
|---|---|---|
| Two people move or modify one entity | The later in server order wins, as the geometry at its base revision plus its own move or set fields (`rebased`) | to the earlier author: `<user> moved <handle> after you.` for a move, `<user> changed <handle> after you.` for a modify |
| An edit to an entity someone deleted | The delete wins and the edit is `dropped` | to its author: `<user> deleted <handle>. Your change was dropped.` |
| An entity added on a layer someone deleted | The entity goes to layer `0` (`redirected`) | to its author: `<user> deleted layer <layer>. Your entity is on layer 0.` |
| An insert made while someone redefined its block | The insert uses the newest definition (`redirected`) | to its author: `<user> redefined <block>. Your insert uses the new one.` |

In every toast, `<user>` is the other person. When a person's optimistic geometry loses, it rolls back on screen to the server's result before the toast shows, and focus goes to Command.

**Offline.**
- `switch "Work offline"` closes the socket and queues each operation in the browser's local storage, per drawing. The queue survives a reload, and entities update on screen at once.
- Switching back sends the queue in order, each operation with its original base revision and `op_id`.
- A conflict is a queued operation whose result is `rebased`, `dropped` or `redirected`.

**Per-person undo.**
- Ctrl+Z reverses my own last operation group with a new inverse group. Ctrl+Shift+Z redoes it. Undo never touches anyone else's operations.
- The stack holds `PLOT_UNDO_DEPTH` groups per person per drawing. It is stored on the server and survives a reload. Any new operation of mine clears my redo list.
- If anyone else has changed a target of that group since, the undo is skipped with `Can't undo: <user> changed <handle> after you.`. The entry is dropped, and the next Ctrl+Z takes the one before it.
- Undoing a delete restores the entity with the same handle, together with its constraints, the dimensions linked to it and its hatch link.
- Offline, an undo removes the last queued group instead.

**Presence.**
- `list "People here"` lists each person with the drawing open. Each gets the lowest presence colour index from 1 to 8 that is free, in join order. The index is freed when their presence ends.
- Each remote crosshair has a username label and carries `data-colour` (the index), `data-x` and `data-y` in world units. Their selection rings use the same colour.
- A person whose socket closes is removed `PLOT_PRESENCE_TIMEOUT_MS` later on the server clock.
- Following stops with the announcement `Stopped following <user>.`.

**Sheet versions.**
- States:
  - `publishing` → `published` → `in_review` → `approved` or `rejected`
  - `in_review` → `published` when a step expires
  - `published` or `in_review` → `voided` when a newer version of the sheet is published
- Approved and rejected versions stay as they are, with `replaced_by`, and show `Replaced by version <n>`. Any other change is `illegal_transition` with `A version can't go from <from> to <to>.`.
- Publishing snapshots the drawing's model and the sheet. It writes the snapshot JSON and the sheet SVG, and the version becomes `published` with the next number only when MinIO confirms both. On failure, the record is removed and the number is not used.
- Published versions never change.
- **Restore.** `button "Restore this version"` makes the model equal to that version's model as one new group with command `RESTORE`:
  - entities deleted since come back with their handles
  - entities added since are removed
  - changed entities go back
  
  Every version and the operation history stay.

**Delta swipe (compare).**
- Entities match by id across the two versions:
  - only in the later: `added`
  - only in the earlier: `removed`
  - in both but differing in any number by more than 0.001, or in any other field: `changed`
- An insert whose block definition differs between the versions is `changed`. Xref entities compare by `<xref name>|<handle>`, so a reload counts.
- `status "Compare counts"` reads `Added <a>, removed <r>, changed <c>`. Each entity on the compare view carries `data-diff`.
- `slider "Compare swipe"` runs from 0 to 100 in whole percent:
  - ArrowLeft and ArrowRight move it by 1, PageUp and PageDown by 10, and Home and End go to 0 and 100
  - `aria-valuetext` reads `<p>% newer version`
- `region "Entity history"` lists `<user> <command> at <YYYY-MM-DD HH:MM> UTC` for the chosen entity, newest first.

**Markups.**
- `Cloud`, `Arrow` and `Text` markups hold world coordinates and a bounding box.
- When a version of the sheet is published, every markup on the version before it is copied to the new version.
- A copied markup gets `data-flag="geometry-changed"` and the label `Geometry changed under this markup` if the compare rule finds any added, removed or changed entity whose bounding box meets the markup's box, touching included. This includes block redefinitions and xref reloads. Otherwise it has no flag.

**Issues.**
- An issue is pinned to a version at a world point.
- Allowed transitions: `open` → `answered`, `answered` → `closed`, and `closed` → `open`. Only `manage` or the issue's creator may reopen. Anything else is `illegal_transition` with `An issue can't go from <from> to <to>.`.
- An issue with an RFI that is not closed cannot close: `Close its RFI first.`

**RFIs.**
- `button "Create RFI"` makes an RFI linked both ways with its issue, in `draft`, with the ball with the asker.
- Allowed transitions: `draft` → `sent`, `sent` → `answered` (needs an answer), `answered` → `closed`, and `answered` → `sent` (reopen).
- Sending moves the ball to the addressee, and answering moves it back to the asker. Only the person holding the ball may make a transition; anyone else is refused with `not_ball_in_court` and `This RFI is with <user>.`.
- Other transitions are refused with `An RFI can't go from <from> to <to>.`.
- Every issue and RFI change shows live for everyone with the drawing open.

**Reviews.**
- `button "Start review"` opens two steps in order: `markup`, which needs at least `markup`, then `manage`, which needs `manage`.
- Each pending step is due `PLOT_REVIEW_TTL_MS` after it opens, on the server clock.
- Approving the last step makes the version `approved`. A reject at any step makes it `rejected`.
- Each approval or rejection adds a stamp reading `Approved by <user> at <YYYY-MM-DD HH:MM> UTC`, or `Rejected by …` likewise.
- Refusals:
  - approving `manage` before `markup`: `Waiting on the step before.`
  - acting on a voided review: `Review voided: version <n> replaced this one.`
  - acting after a step passes its due time: `This review expired.`
  
  Each of these texts also shows in the version's review area when it happens, live.

**Roles.**
- The roles are `view` < `markup` < `edit` < `manage`. Each is set per folder and inherited from the parent folder unless set there.
  - `view` reads.
  - `markup` adds markups, issues and RFIs and approves `markup` steps.
  - `edit` changes drawings and sheets and publishes.
  - `manage` sets roles, locks sheets, creates and turns off links, and approves `manage` steps.
- A drawing with no role for the caller does not exist for them.
- A `view` or `markup` person typing a drawing command gets `You can view this drawing but not edit it.`
- A sheet lock by `manage` refuses sheet edits with `This sheet is locked by <user>.`
- A role change applies in the open session live: controls the new role cannot use leave the page, focus moves to `region "Drawing"` and the toast reads `Your role is now <role>.`.
- A revoked person's page clears the drawing and shows `You no longer have access to this drawing.`

**View links.**
- A link opens one published version with no account. It reaches only that version: every other id through it is `not_found`, and it has no write route.
- It expires `PLOT_LINK_TTL_MS` after creation on the server clock. Expired, it shows `This link has expired.`; turned off, `This link was turned off.`. An open link page changes to that text live.

**Phone gestures.**
- **Values at gesture start.** When the second finger touches, the page records the finger distance d0, the midpoint p0, and the zoom0 and pan0 in effect at that moment, all in screen px.
- **Each move.** Every move computes the view afresh from those start values and the current finger distance d and midpoint p. Values are never compounded from the previous move:
  - zoom' = zoom0 × d / d0, held between 0.05 and 50 and rounded to 4 decimals
  - pan' = p − (p0 − pan0) × zoom' / zoom0, per axis, rounded to 4 decimals
  
  This pans by the midpoint's change and zooms about it in one step.
- **Worked example.** Start: zoom 1 and pan 0,0, with fingers at 100,100 and 200,100, so d0 = 100 and p0 = 150,100.
  - Move 1 puts the fingers at 50,100 and 250,100, so d = 200 and p = 150,100. The view becomes zoom 2 with pan −150,−100.
  - Move 2 puts the fingers at 50,150 and 350,150, so d = 300 and p = 200,150. The view becomes zoom 3 with pan −250,−150.

**ZOOMALL** sets zoom and pan so the bounds of every visible entity fit the pane with 24 px on each side, centred.

**Large drawings and Find.**
- The page keeps an element only for entities whose bounding box meets the view grown by `PLOT_DOM_MARGIN_PX` on every side. That is never more than `PLOT_DOM_CEILING` elements, nearest bounding-box centre to view centre first, plus every selected entity.
- Pan and zoom never change `data-total-entities`.
- Find matches a handle exactly, or a layer or block name, ignoring letter case. Matches go in handle order.
- `button "Next match"` selects the next match and pans by the least amount that puts its box at least 48 px inside each pane edge. With no matches it does nothing.

**Plotfold drawing text format.**

The file layout:
- UTF-8 with `\n` line ends. The first line is exactly `plotfold 1`.
- One record per line. Fields are separated by single spaces. Names and texts are in double quotes, with `\"` for a quote.
- Blank lines and lines starting with `#` are ignored.

The records:

| Record | Fields |
|---|---|
| `layer` | `"name" colour linetype lineweight on\|off thawed\|frozen unlocked\|locked` |
| `line` | `handle "layer" x1 y1 x2 y2` (4 numbers) |
| `circle` | `handle "layer" cx cy r` (3) |
| `arc` | `handle "layer" cx cy r start end` (5) |
| `pline` | `handle "layer" open\|closed x y x y …` (an even count, at least 4) |
| `block` | `"name" bx by` (2); the following records up to `end` form its definition |
| `end` | closes the open block |
| `insert` | `handle "layer" "block" x y scale rotation` (4) |
| `attr` | `TAG "value"`; after `block`, a tag default; after `insert`, that insert's value |
| `dim` | `handle "layer" linear\|aligned\|angular\|radial "style" ref [ref]`, a ref being `handle:start`, `handle:end`, `handle:centre` or `handle` |
| `hatch` | `handle "layer" x y` (2, the seed point) |

Layers and blocks must be defined above their first use. Layer `0` is always defined.

Import errors:
- Errors use 1-based line numbers and run top to bottom, one error per line, at most 20.
- The texts are:
  - `Line <n>: unknown record "<word>"`
  - `Line <n>: <record> needs <k> numbers, got <m>`
  - `Line <n>: pline needs an even count of at least 4 numbers, got <m>`
  - `Line <n>: "<text>" is not a number`
  - `Line <n>: layer "<name>" is not defined`
  - `Line <n>: block "<name>" is not defined`
  - `Line <n>: end has no block`
  - `Line <n>: block "<name>" has no end`, reported at the block's own line
  - `Line <n>: attr has nothing to attach to`
  - `Line <n>: handle <handle> is used twice`

Merge:
- A merge renames each imported layer or block whose name already exists to `<name> (k)`, with the lowest free k from 2. It gives every imported entity a new handle in file order.
- A merge is one group with command `IMPORT`.

Canonical form and export:
- The header comes first.
- Then layers other than `0` in name order.
- Then each block in name order, with its records in handle order, its `attr` lines in tag order, and `end`.
- Then model entities in handle number order, each insert followed by its `attr` lines in tag order.
- Numbers are printed as stored, and the file ends with one `\n`.
- Exporting a drawing imported from canonical text gives the same bytes.
- The SVG export is a standalone file holding every entity as one element, with the same `data-*` attributes as the screen.

**Exports.**
- An export job goes `queued` → `running` → `ready` or `failed`, and `failed` → `running` on retry. Other moves are `illegal_transition`.
- A running job advances one step of 20 percent every `PLOT_EXPORT_STEP_MS` on the server clock. It writes its object after the fourth step, and reaches 100 and `ready` only when MinIO confirms the object.
- If the write fails, the job becomes `failed` at 80.
- Retrying restarts at 0.
- `progressbar "Export"` shows 0, 20, 40, 60, 80 and 100 live.

**Uploads.**
- **Checks.** These run before anything is stored, in this order:
  1. Size: an underlay may be at most `PLOT_UNDERLAY_MAX_BYTES` and a text file at most `PLOT_TEXT_MAX_BYTES`. The limit itself is allowed.
  2. Type, judged by content only:
     - an underlay must start with the PNG signature or the JPEG start-of-image bytes
     - a text file must be valid UTF-8 whose first line is `plotfold 1`
  3. Underlay quota: the drawing's stored underlay bytes plus the new image may total at most `PLOT_DRAWING_QUOTA_BYTES`. Exactly the quota is allowed.
- **Storage.** A text file is then stored byte for byte before it is parsed. An underlay counts as attached only after MinIO confirms it.
- **Placement.** Underlays are placed by two world corners and drawn below the geometry as one image element with `data-underlay-id`.

**Time.** Every deadline runs on the server clock: link expiry, review steps, presence removal and export steps. The server clock is real time plus whatever the grading clock route has added. When a deadline passes, it applies at once and is broadcast.

### Services (DP-38, DP-39, DP-40, DP-42, DP-57, DP-58)

**PostgreSQL** (`DATABASE_URL`) holds:
- users and sessions
- folders and roles
- each drawing's operation log in server order, with `op_id`, base revision, group, author and command
- per-person undo and redo stacks
- layers, layer states, blocks, dimension styles, constraints, parameters, xrefs and underlay records
- sheets, viewports, version records, markups, issues, RFIs, review steps, stamps, link records and export jobs

The app applies its schema idempotently every time it serves, not only at build.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) holds these objects in the one bucket:

| Object | Key |
|---|---|
| Underlay image | `underlays/<drawing id>/<sha256 of bytes>.png` or `.jpg` |
| Imported text file, stored byte for byte before parsing | `imports/<drawing id>/<sha256 of bytes>.plot.txt` |
| Published version snapshot | `versions/<sheet id>/<number>.json` |
| Published version sheet drawing | `versions/<sheet id>/<number>.svg` |
| Export | `exports/<drawing id>/<job id>.plot.txt` or `.svg` |

The version snapshot JSON is `{"sheet":{…},"model":{"layers","entities","blocks","xrefs"}}`.

**When MinIO is unreachable:**
- The app boots and serves.
- Opening and editing drawings, operations, the live channel, issues, RFIs, markups and reviews keep working.
- Publish, underlay and import answer `storage_unavailable` with their outage texts, and exports fail. Each works again on the next try once MinIO answers, without a restart.
- Opening an existing version's files is unaffected, because version snapshots are cached in PostgreSQL after publish.

### Seed data (DP-02, DP-08, DP-24, DP-30, DP-37)

The app starts empty: no users, folders or drawings. Tests build their world through the grading seed route.

Built-in records:
- Every drawing has layer `0` (`white`, `Continuous`, `0.25`, on, thawed, unlocked) and the dimension style `Standard`, as defined in Dimensions.
- The built-in title blocks are `Title A3` and `Title A4`, with the tags `Sheet no`, `Title`, `Drawn by`, `Scale`, `Project` and `Checked by`. `Project` and `Checked by` start empty.

The landing strip's sheet frames are invented and drawn by the app. In order, their titles are:
1. `Garden plan, Larch Row`
2. `Shelf elevation, Unit 4`
3. `Stage layout, Hall B`
4. `Title block only`
5. `Shed footing, Plot 9`
6. `Bench section, Workshop`
7. `Seating plan, Quay Room`
8. `Raised beds, North Yard`
9. `Counter detail, Kiosk 2`
10. `Lighting grid, Hall B`
11. `Fence run, Larch Row`

The centred frame at load is `Stage layout, Hall B`.

Example names in this brief are invented, for example the users `asha` and `bram` and the drawing `Plot plan`. Every seeded person, folder, drawing, block library, title block and project is invented.

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same build.

`/app/run.json` holds string `install`, `build` and `serve` commands. For example:

```
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

Serve on `0.0.0.0`, on port 4173 or on `APP_PUBLIC_PORT` when set. `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` when MinIO answers, and `{"status":"unavailable"}` when it does not; it never answers 503. Health checks MinIO afresh on each request, with a two-second limit. Bundle Funnel Display and Funnel Sans as font files the app serves itself. Commit the lockfile.

### Configuration and secrets (DP-10)

Read these at start:
- `DATABASE_URL`
- the six `S3_*` variables
- `PLOT_GRADING`, `PLOT_PRESENCE_TIMEOUT_MS`, `PLOT_LINK_TTL_MS`, `PLOT_REVIEW_TTL_MS`, `PLOT_OP_WINDOW`, `PLOT_DOM_MARGIN_PX`, `PLOT_DOM_CEILING`, `PLOT_UNDERLAY_MAX_BYTES`, `PLOT_DRAWING_QUOTA_BYTES`, `PLOT_TEXT_MAX_BYTES`, `PLOT_EXPORT_STEP_MS`, `PLOT_OP_RATE`, `PLOT_LOGIN_RATE`, `PLOT_TOAST_MS` and `PLOT_UNDO_DEPTH`

| Variable | Default when unset |
|---|---|
| `PLOT_GRADING` | off |
| `PLOT_PRESENCE_TIMEOUT_MS` | 15000 ms |
| `PLOT_LINK_TTL_MS` | 604800000 ms |
| `PLOT_REVIEW_TTL_MS` | 604800000 ms |
| `PLOT_OP_WINDOW` | 1000 revisions |
| `PLOT_DOM_MARGIN_PX` | 200 px |
| `PLOT_DOM_CEILING` | 500 elements |
| `PLOT_UNDERLAY_MAX_BYTES` | 2000000 bytes |
| `PLOT_DRAWING_QUOTA_BYTES` | 20000000 bytes |
| `PLOT_TEXT_MAX_BYTES` | 1000000 bytes |
| `PLOT_EXPORT_STEP_MS` | 400 ms |
| `PLOT_OP_RATE` | 600 per person per minute |
| `PLOT_LOGIN_RATE` | 10 per username per minute |
| `PLOT_TOAST_MS` | 5000 ms |
| `PLOT_UNDO_DEPTH` | 100 groups |

The page receives only the client-side settings it needs: toast lifetime, margin and ceiling. Credentials and service URLs never reach the browser and are never hard-coded.

### Server boundary (DP-04, DP-11)

- **Origin.** One origin serves the pages, the API and the live channel. The server sends no cross-origin headers. Some requests carry an `Origin` header that differs from the scheme, host and port of the request's own `Host`. When such a request is a POST, PUT, PATCH or DELETE, or a live-channel upgrade, it answers 403 `cross_origin` with the message `Requests from other sites are refused.` and changes nothing.
- **Body limits.** JSON bodies may be at most 1000000 bytes; the limit is allowed. Upload limits are in Business rules. Over-limit bodies get `too_large` before any other check.
- **What is never served.** The server serves only built client files and fonts, never source files, configuration, environment or credentials.
- **Unserved paths.** Every path the server does not serve answers 404. This includes source, configuration and credential paths such as `/.env`, `/package.json` or `/src/server.ts`. Under `/api/` the 404 carries the `not_found` error body. Elsewhere it renders the not-found page.
- **Boot.** If PostgreSQL is unreachable at boot, the server retries every second and answers health only once connected. If MinIO is unreachable at boot, the server still serves as in Services.
- **Service workers.** No service worker is registered.
- **Page timers.** Every client timer (toasts, long press, reconnect) uses page timers, and animations use the document timeline.

### Browser support and performance (DP-06, DP-59)

Current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, and on a phone at 390x844 with touch. A drawing of 10000 entities is usable within three seconds of opening. A pan or zoom on it shows the new view within a quarter of a second. A live message from another person shows on screen within one second.

## Working rules

- IF-01: `/app/run.json` exists with `"_schema":"run-manifest-v1"` and string `install`, `build` and `serve` commands, and serve starts the app on the published port.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package, meaning the production dependency tree (`npm ls --omit=dev --all --json`), with its licence, plus the two bundled fonts.
- IF-03: Every shipped package and bundled font is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The app uses only PostgreSQL and MinIO as backing services: no other datastore, queue, cache, mail or search service, and no embedded database file.
- IF-05: The provided development compose files and service seed configuration are left unchanged.
- IF-06: The page loads no external origin at run time: no CDN scripts, web fonts or images from elsewhere.
- IF-07: The npm lockfile is committed and `install` uses it.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, without `any` on domain values and without type assertions that hide a mismatch.
- Names in code match this brief's domain terms: operation, base revision, group, handle, layer state, block insert, xref, viewport, version, markup, issue, RFI, ball in court, review step.
- Each domain rule is decided in exactly one place in the source, and the browser and server share it rather than copy it. That covers each state transition, each geometry formula, each conflict rule, the error order and each derived value such as dimension values, hatch areas and compare counts.
- There is no abstraction with a single implementation, and no defensive checks for states the rules make impossible.
- There is no dead, commented-out or unreachable code.
- Every API error is built through one error shape carrying the published codes.
- There are no features beyond this brief.
