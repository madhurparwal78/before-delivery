# Ferrule & Pell Linewell

Linewell is a browser diagram editor for small groups who draw together. Typical users are a volunteer committee mapping a sign-up process, two friends planning a renovation layout, two teachers drawing a course map, or a freelancer sketching a system for a client. Several people edit one diagram at once and see each other's cursors. Connectors stay attached to the shapes they join, route around other shapes with as few bends as possible and keep apart from each other. Edits made while the connection drops, or after the session ends, are kept and replayed. Role changes take effect at once. PNG and SVG exports show only what was visible on the page at the moment of the request.

Build it as one TypeScript web app: a Node server and a browser client. It uses three services:

- Postgres stores everything.
- MinIO object storage keeps the rendered exports.
- The Mailpit mail catcher receives the invitation and mention email.

People sign in with an email and password that the app manages itself.

Out of scope: any other datastore, cache, queue, CDN, analytics or error tracker; third-party or single sign-on; image shapes and uploads; templates; freehand drawing; custom shape libraries; plugins; presentation mode; PDF export; import from other tools; billing; teams or workspaces beyond the members of each diagram; service workers.

## Problem and users

Small groups pay for diagrams in redraw time, lost edits and leaked notes. Heavyweight suites charge per seat, and their free tiers stop at a few editable documents and a few dozen objects. Free editors offer live co-editing only when everyone uses the same third-party cloud drive. People report the same problems with both:

- Connectors stay at fixed points and have to be fixed by hand after a shape moves.
- Collaborators find a chart locked to view only, and nobody tells them why.
- Exports carry hidden layers and comment clutter into images that get passed around.
- A dropped connection quietly loses work.
- People who use a keyboard or a screen reader mostly cannot connect two shapes at all.

Linewell has four kinds of user:

- **Diagram owner** (daily): creates diagrams with pages and layers, invites people by email as editors or viewers, changes or revokes their roles, restores an earlier version and exports clean images.
- **Editor** (daily): draws shapes, connectors and groups while others work alongside with live cursors. Keeps working through a flaky connection or an ended session without losing changes, and resolves comments.
- **Viewer** (weekly): opens a shared diagram on a phone or laptop, moves between pages, reads and leaves comments on shapes, and downloads the latest export.
- **Keyboard-only editor** (weekly): builds and rewires a flowchart without a pointer and hears what was connected to what.

## Journeys

1. **Start and share.** This journey runs on the invite-lifetime copy of the app (Configuration), so the invite lifetime is short.
   - Ada signs in and sees the empty diagram list.
   - She tries a title with a line break in it and gets a field error. She then creates "Pipeline", lands on its first page and sees the empty-page text.
   - She draws three rectangles and connects them. She opens Share and invites Bea as an editor and Cy as a viewer. The member list shows both invites as Invited, and Mailpit holds exactly one message for each, addressed to that person alone.
   - Bea opens the link in her email, is sent to sign-in, follows "Create an account", signs up with the invited address and lands on Pipeline as an editor.
   - Cy signs up only after the invite lifetime has passed. Cy's new account gets the not-found page for Pipeline, and Ada's member list shows Cy's row as Expired. Ada presses Resend. Cy signs in again and lands on Pipeline with the view-only banner and no tools.
   - Later Ada downgrades Bea to viewer while Bea is dragging a shape. Within 2 seconds Bea's tools disappear and the view-only banner appears. Bea's in-flight change is refused and rolled back with the role notice. Ada makes Bea an editor again and the tools come back.
2. **Rearrange with live wiring.**
   - Pipeline has Intake connected to Review with Archive between them, Archive connected to Store, and Log connected to Store off to one side. Bea has Intake selected and has typed half of a new Width.
   - Ada drags Intake. Vermilion port dots appear, and every connector the move affects redraws on every frame, keeping clear of Archive and apart from the other connectors. Ada's inspector X and Y follow every frame.
   - On drop the connector settles onto its final route, which is exactly the last route Ada saw while dragging. Ada hears the moved notice, whose count equals the number of connectors the server says it rerouted.
   - Within a second, Bea's X and Y show the dropped position without reselecting. Bea's half-typed Width stays until she presses Enter, and then her value wins. When she types 10 into Width and presses Enter, the field refuses it in place with the range message and nothing is sent.
   - Ada drags Archive into the corridor of the Log-to-Store connector, which is not bound to Archive, and the count includes that connector.
   - Ada selects Intake, Review and Log and presses ArrowRight once. The three shapes move as one change and she hears one moved notice for three shapes. One Ctrl+Z puts all three back.
   - Ada and Bea commit a new X for Intake at the same instant from two laptops, while Bea also renames it. The later change wins on both screens and the new label survives.
   - Bea deletes Archive. Archive and its connector to Store leave Ada's screen and the Outline within a second. The Intake-to-Review connector that wrapped around Archive straightens and is counted in Bea's moved-free notice count. An edit Ada sent to Archive at the same moment rolls back with the deleted notice. Bea presses Ctrl+Z and Archive comes back with the same shape, connector and group ids, and its comment pin returns.
   - A reload and an SVG export show the same paths.
3. **Build without a pointer.**
   - A keyboard-only editor tabs into an empty page and inserts two rectangles from the toolbar, naming them "Start" and "Check".
   - They press C on Start. The target highlight starts on Check, the only other shape, and pressing an arrow key leaves it there. They pick Check's west port with 4 and press Enter. They hear the connected notice.
   - They nudge Check with the arrow keys and the connector follows. Ctrl+Z undoes the nudge.
   - They open the Outline and hear "Start, rectangle, connected to Check".
   - Bea walls Check in with shapes on a "Walls" layer and locks that layer. The Outline now names the connector as blocked, and sighted collaborators see it dashed. Each wall shape carries a lock icon and is described as being on a locked layer. When Bea hides Walls, the blocked wording and the dashes go away within a second.
4. **Arrange pages and layers.**
   - Bea presses Ctrl+Alt+N to add "Page 2", renames it "Floor plan" with F2, and moves it first with Alt+ArrowUp. She hears the reorder notice while focus stays on the page item. Ada sees the new order without reloading.
   - Bea reorders the layers the same way.
   - Ctrl+PageDown and Ctrl+PageUp switch pages. The address tracks the open page across reload, Back and Forward. The new empty page shows the empty-page text.
   - At tablet width Bea opens and then collapses the layers rail. While it is collapsed, its hide and lock toggles are out of the tab order.
5. **Work through a dropped connection.**
   - Bea is editing when the connection drops. After a short wait the offline banner shows how many changes are waiting.
   - She keeps editing and reloads once, and the count is unchanged.
   - Meanwhile Ada deletes a shape that Bea edited offline. When Bea reconnects, her other change saves once. The edit to the deleted shape rolls back on screen with the deleted notice, and the saved banner shows.
   - Later Bea signs out in another tab. Her workspace stays put, shows the session-ended banner and opens the in-place sign-in dialog. She keeps nudging shapes and the waiting count grows.
   - She signs in. Each queued change replays once, and she never leaves the diagram.
6. **Comment from a phone.**
   - Cy opens Pipeline on a phone, pinches to zoom and swipes the page strip to the second page.
   - Cy long-presses a shape at the bottom-right corner of the canvas. The Shape actions menu opens fully on screen, above the bottom toolbar. Cy taps Comment and writes a comment that mentions Ada's email.
   - The pin appears on Ada's laptop without a reload, and Ada gets exactly one mention email.
   - Ada moves the shape and the pin follows. Ada resolves the thread, the pin leaves both screens, and Cy's Comments sheet shows "Resolved (1)".
7. **Undo a restructure.**
   - Bea restructures the diagram. She moves shapes to another layer, ungroups a group, deletes a connector and deletes a shape that has a comment, then stops editing. The server cuts an automatic version on its own timer.
   - Ada opens History and sees it listed without a reload. She previews the version from before Bea's changes. The address now carries that version, and reloading lands in the same read-only preview. Back returns to the latest document and Forward to the preview.
   - She restores it. Every page, layer, group, port binding and comment anchor comes back, and the comment's pin returns. A "Restored ..." version is listed. Bea's screen updates and announces the restore.
   - Ada presses Ctrl+Z. The restore is undone and the comment's pin disappears again on both screens.
8. **Export only what is visible.**
   - Ada hides the "Notes" layer, opens Export, chooses SVG and double-presses Export. She closes the dialog at once and keeps drawing.
   - Exactly one export is created. She hears "Export ready." exactly once. Reopening Export shows the Download SVG link. The file shows the page as it was when she pressed, without the shapes she drew afterwards, and labels containing markup characters read exactly as typed.
   - Cy, viewing on another laptop, sees Download latest export appear without reloading. The file has no hidden-layer shapes, comment pins or cursors.
   - When storage is down, the export ends with the paused banner and a Try again button, even after a reload, and editing still saves. Two quick presses of Try again start only one retry.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Snap to grid** With Snap to grid on, a move lands the moved selection's left and top edges on multiples of 8 and a corner resize lands the dragged edges on multiples of 8 while the opposite corner stays fixed, as qualified in Geometry rules, Alt skips snapping for that drag, and the document JSON agrees.
- **DP-02 — Multi-select** Click, Shift+click, marquee and Ctrl+A select shapes, and the inspector heading shows the label, '<n> selected' or 'Nothing selected'.
- **DP-03 — Align and distribute** The Align menu and Alt+Shift shortcuts align or distribute the selection by the published formulas within 1 px, moving each selected group as one rigid box, as one operation that announces the aligned or distributed notice.
- **DP-04 — Keyboard nudge** Arrow nudges the selection or focused shape by 8 and Shift+Arrow by 1, never snapped, as one operation with one undo entry for the whole selection, and the move persists across reload.
- **DP-05 — Port bindings** Every connector end is bound to a shape and one of the ports n, e, s, w at its edge midpoints, and stays on that port as the shape moves.
- **DP-06 — Orthogonal routing** Every route obeys router rules 1 to 7, including the fewest bends among routes meeting rules 1 to 4, 12-unit clearance around visible shapes, 8-unit separation between connectors, and data-blocked when no clear route exists.
- **DP-07 — Server-derived routes** The server derives every route from shape geometry, port bindings and the page's lower-id routes, and canvas data-points, a reload, another session, the SVG export and the last preview of an unsnapped drag match the document route within 1 px.
- **DP-08 — Tethered reroute** Dragging a shape shows port dots, redraws every affected connector each frame with its preview route in data-points, settles on drop with data-settling for 200 ms while data-points hold the committed route, places each connector label at its longest segment's midpoint, and announces a moved notice whose count equals the acknowledgement's rerouted list.
- **DP-09 — Reduced-motion reroute** Under reduced motion a drop or nudge never sets data-settling, port dots show without fade, and final geometry and announcement are identical.
- **DP-10 — Groups** Ctrl+G groups 2 or more shapes on one layer as 'Group of <n> shapes', Ctrl+Shift+G ungroups, groups select and move as one operation, and cross-layer grouping is refused with the published notice.
- **DP-11 — Hidden layers** Hiding a layer removes its shapes and connectors from the canvas DOM, outline and exports, stops them being obstacles, and reroutes affected connectors.
- **DP-12 — Locked layers** Locked-layer shapes stay visible, are obstacles and carry a lock icon and the locked-layer description, but cannot be selected, nudged or edited; attempts announce the locked notice and the operations listed in Business rules, add_shape, add_connector and delete_connector included, answer 409 layer_locked.
- **DP-13 — Layer order and assignment** Add layer, F2 rename and Alt+ArrowUp/Down reorder work by keyboard, a reorder announces the reorder notice with focus kept on the item and reaches other sessions within 1 second, and the inspector Layer select moves shapes or whole groups.
- **DP-14 — Collapsed layers rail** From 768 to 1279 px the layers rail is collapsed by default and, whenever collapsed, its toggles are not visible, focusable or in the accessibility tree until opened.
- **DP-15 — Pages** Pages are added (Ctrl+Alt+N, 'Page <n>'), renamed (F2), reordered (Alt+ArrowUp/Down, with the reorder notice), deleted via the Delete page dialog and switched (Ctrl+PageDown/PageUp).
- **DP-16 — Page addresses** The URL /d/<diagramId>?page=<pageId> tracks the open page, and reload and back/forward restore it.
- **DP-17 — Empty page text** A page with no visible shapes shows the published empty-page text verbatim.
- **DP-18 — Page strip** The page strip shows '<page name> · <n> of <total>', and a swipe or Previous/Next page buttons switch page.
- **DP-19 — Canvas focus order** The canvas is one tab stop with roving focus over shapes in reading order, moved with Alt+Arrow keys.
- **DP-20 — Keyboard insert and labels** Toolbar shape buttons and R insert a 160x80 shape at the published insertion position and focus its label editor; Enter commits and Escape cancels.
- **DP-21 — Keyboard connect** C, Arrow keys, 1-4 and Enter create a connector without a pointer and announce the connected notice; Escape creates nothing.
- **DP-22 — Visible focus** Focus is always visibly outlined and never lands on the body after any action.
- **DP-23 — Personal undo and redo** Ctrl+Z and Ctrl+Shift+Z undo and redo only the person's own operations, each as a new broadcast operation, and one Ctrl+Z reverts every shape of a multi-shape action.
- **DP-24 — Accessible diagram markup** The canvas, shapes, connectors and groups carry the published roles, accessible names, ids and data attributes, and a blocked connector is drawn dashed and carries the blocked connector name.
- **DP-25 — Diagram outline** The Outline tree reads the published item texts, including blocked connectors and locked layers, follows the ARIA tree keys, selects and focuses a shape on Enter, and updates within 1 second without reload.
- **DP-26 — Server-ordered operations** Operations, including the all-or-nothing update_shapes, get server seq numbers in arrival order, are broadcast, and are acknowledged with one sorted list of connectors whose stored route changed; a repeated opId returns the stored response without reapplying and a different body answers 409 op_conflict.
- **DP-27 — Presence** The top bar shows one '<name>, editing' or '<name>, viewing' avatar per other connected person, and others hear the joined notice once per person.
- **DP-28 — Live cursors** Remote cursors with names appear within 1 second, glide over 240 ms (instant under reduced motion), and disappear on close or presence timeout.
- **DP-29 — Same-field conflicts** The later seq wins on every screen and the overwritten author sees the replaced notice.
- **DP-30 — Collaborative undo** An undo whose field was changed later by someone else is skipped and shows the can't-undo notice.
- **DP-31 — Offline banner and queue** After 3 s of page time without the socket the offline banner shows the pending count, edits keep working, and the queue and count survive a reload.
- **DP-32 — Replay on reconnect** Queued changes replay in order with their original opIds, each saved exactly once or rolled back with its notice, then 'All changes saved.' shows.
- **DP-33 — Comment pins** Any member comments on a shape; the pin sits at its top-right, follows moves and reaches other sessions without reload.
- **DP-34 — Mentions** An @mention of a current member's exact email sends that member exactly one Mailpit message addressed to them alone with the published mention subject.
- **DP-35 — Resolve threads** Resolving removes the pin on every open session and lists the thread under 'Resolved (<n>)'.
- **DP-36 — Version history** The server's own timer cuts an automatic version once the version interval has passed after the first uncovered operation, even with no later edit, Save version and restore also cut versions, and open History lists show them newest first in the published format within 2 seconds.
- **DP-37 — Version preview addresses** Choosing a version pushes an address carrying its version id that opens the same read-only preview with the preview banner on reload, direct visit and back/forward, and a version id from elsewhere gives the not-found page.
- **DP-38 — Exact restore** Restore makes the document equal the version's document except seq, sets comment anchoring from the restored document, and records 'Restored <version name>'.
- **DP-39 — Restore reaches everyone** A restore updates other sessions within 2 seconds with the restored notice, and the restorer's Ctrl+Z undoes it, comment anchoring and pins included.
- **DP-40 — Accounts** Email and password sign-up and sign-in with lw_session and published field errors; pages needing a session redirect to /signin?next=, and sign-in and sign-up both return to next.
- **DP-41 — Invites** The owner invites by email and role, Mailpit gets one message addressed to the invitee alone with the published invite subject and no diagram contents, and signing in or up with that email while the invite is open makes an active member.
- **DP-42 — Immediate role change** A role change applies to the next operation (403 after downgrade) and on the open screen within 2 seconds.
- **DP-43 — View-only mode** Viewers see the view-only banner and no tools, can comment, and every edit they send answers 403 forbidden_role.
- **DP-44 — Uniform not-found** Another person's diagram id, or a version id that does not belong to the diagram, gives the same 404 page, the same not_found body on every API route under it, and socket close 4404, as a missing id.
- **DP-45 — Mail outage invites** With mail unreachable the invite is saved as Email not sent with Resend and the mail outage banner; resend works once mail returns without restart.
- **DP-46 — Storage-confirmed export** An export becomes ready, with download link and 'Export ready.', only after its object exists at exports/<diagramId>/<exportId>.<ext> in MinIO.
- **DP-47 — Clean SVG export** The SVG export has exactly the published SVG properties and nothing from hidden layers, comments, cursors or selection.
- **DP-48 — PNG export size** The PNG export has the published PNG properties, with dimensions equal to the SVG viewBox times scale within 1 px.
- **DP-49 — Storage outage exports** With storage unreachable exports end storage_unavailable with the paused banner and Try again, editing still saves, and health stays 200.
- **DP-50 — Published layouts** Three panes at 1280 (248/296 px rails), canvas plus inspector rail at 768, one pane with bottom sheets at 375, no sideways scroll, 44 px targets below 768.
- **DP-51 — Touch gestures and zoom** Tap, one-finger drag, pinch and 500 ms long press select, pan, move, zoom and open Shape actions; #zoom-readout tracks zoom and Ctrl+0 resets to 100%.
- **DP-52 — Reversing inspector rail** The inspector rail exposes data-motion and data-progress, reverses mid-motion from its current progress over progress x 200 ms, and jumps to the end state under reduced motion.
- **DP-53 — Polite announcer** #announcer is the one polite live region and carries every announcement with the exact published copy.
- **DP-54 — Dialogs and menus** Every dialog, sheet and menu wraps Tab and Shift+Tab, closes on Escape and returns focus to its opener, and every menu opens fully inside the viewport, uncovered and unclipped, with every item hit-testable.
- **DP-55 — API error contract** All API errors use the one error shape and the precedence 401, 404, 403, 503, 409, 422, with replay before state checks.
- **DP-56 — Health and resilient boot** GET /api/health answers 200 {"status":"ok"} on every instance and sign-in and editing work with MinIO or Mailpit unreachable at boot.
- **DP-57 — Server boundary** Cross-origin state changes answer 403 cross_origin, bodies over 1,000,000 bytes 413, non-JSON 415, and source, env and manifest paths 404.
- **DP-58 — Grading routes** POST /api/grading/seed and /api/grading/save-outage behave as published when GRADING_ROUTES=on and answer 404 otherwise.
- **DP-59 — Credentials from environment** Every service address and credential is read from the published env vars at start, never hard-coded or shipped to the browser bundle.
- **DP-60 — Drafting look** Warm graph-paper canvas, navy ink, a single vermilion accent for selection and ports, teal presence, serif title, mono measurements, hairline pane rules, no gradients or shadows.
- **DP-61 — Live inspector** X, Y, Width and Height follow every frame of the person's own drag, resize or nudge and show another person's accepted change within 1 second, while a focused field's uncommitted draft is kept until Enter, Tab or Escape.
- **DP-62 — Export state survives the dialog** An export keeps rendering when the Export dialog closes or the workspace reloads, reopening shows its current state, 'Export ready.' is announced exactly once, and other sessions show Download latest export within 2 seconds without reload.
- **DP-63 — Session ends mid-edit** Signing out closes that session's sockets with 4401 within 1 second, and the open workspace keeps editing and queuing under the session-ended banner and the Sign in to continue dialog, then replays each queued change once after sign-in without leaving the diagram.
- **DP-64 — Header-safe titles and names** Diagram titles and display names containing line breaks or other control characters answer 422 invalid with a field error at the value's dotted path on every route that takes them, the grading seed included.
- **DP-65 — Invite expiry** An invite expires INVITE_TTL_MS after it was last created or resent, judged on the server clock, grants no access when used late, shows Expired with Resend, and opens again on resend.
- **DP-66 — Only published fields** Shape operations accept only their published keys, any other key answers 422 invalid naming its dotted path with nothing changed, and an out-of-range or non-whole inspector value is refused in place with the range message and nothing sent.
- **DP-67 — Deleted means gone** Deleting a shape removes it and its connectors from every session within 1 second, from the outline and from later exports, counts the connectors that reroute, answers 409 to later edits naming them, and the deleter's Ctrl+Z brings back the same shape, connector and group ids with comment anchoring.
- **DP-68 — Concurrent operations** Simultaneous operations on one diagram get distinct consecutive seqs, changes to different fields of one shape both survive, the highest seq wins a shared field, and concurrent copies of one opId apply once with identical responses or 409 op_conflict for a different body.
- **DP-69 — One export per request** A repeated export request with the same settings at the same seq while one renders returns that export, of simultaneous retries exactly one starts, and each file is well-formed, escaped and drawn from the document at its requested seq.

## Frontend

### Screens and layout (DP-14, DP-17, DP-18, DP-40, DP-50)

**Screens.**

- **Sign in** at `/signin`: email, password, a sign-in button and a "Create an account" link.
- **Sign up** at `/signup`: name, email, password, a create button and a "Sign in instead" link.
- **Where people land after signing in or up.**
  - If someone without a session opens any other app page, send them to `/signin?next=<path>`. `<path>` is the page they asked for, including its query.
  - Both cross-links carry `next` over unchanged: "Create an account" goes to `/signup?next=<path>`, and "Sign in instead" goes to `/signin?next=<path>`.
  - After a successful sign-in or sign-up, send the person to `<path>`. If `next` is missing, or is not a path starting with a single `/`, send them to `/`.
  - The exception is an open workspace whose session ends. It stays in place and follows DP-63 (Business rules, Sessions).
- **Diagram list** at `/`: the heading, a "New diagram" button that asks for a title, and one link per diagram the person belongs to, with the most recently changed first. When the list is empty, show the empty-list text.
- **Diagram workspace** at `/d/<diagramId>?page=<pageId>`. A version preview adds `&version=<versionId>` (Business rules, Versions). The workspace has these parts:
  - **Top bar**, 44 px tall. It holds the diagram title in the serif display face, the presence avatars, and the Share (owner only), Export (owners and editors), Outline and Download latest export controls.
  - **Toolbar** `Tools`, for owners and editors at 768 px and wider. It runs across the top of the canvas pane and holds the shape buttons, Snap to grid, Align, Undo and Redo.
  - **View controls** `View`, for every role at every width. They sit over the bottom-right corner of the canvas, just above the page strip. They hold Zoom out, the zoom readout, Zoom in and Reset zoom. They also hold the Layers button (768 to 1279 px only) and Toggle inspector (768 px and wider).
  - **Left rail**: a Pages list above a Layers list.
  - **Canvas**.
  - **Page strip**, directly under the canvas.
  - **Inspector rail** on the right, with three tabs: Inspector, Comments and History.
  - **Banner row**, under the top bar. It holds the view-only, preview, connection and paused-export banners. The mail outage banner never appears here; it shows only inside `dialog "Share"`.
- **Not-found page**: served at `/d/<id>` with HTTP status 404 and the not-found copy from Feedback states, for every case the not-found rule in API covers.

Every role sees the left rail (or the Layers sheet), the inspector rail (or its sheets), the page strip and the view controls. Viewers see the Layers list and its rows, but no Add layer button and no hide or lock toggles. Nothing a viewer does there changes the document.

**Layouts.** The workspace has three layouts. Each covers a width range, and nothing else changes which layout applies:

| Width | Layout |
|---|---|
| 1280 px and wider (checked at 1280x800) | Three panes, left to right: the left rail at 248 px, the canvas filling the rest, and the inspector rail at 296 px. Hairline rules separate the panes. |
| 768 to 1279 px (checked at 768x1024) | Canvas plus one rail: the canvas and the 296 px inspector rail. The left rail is collapsed by default behind the Layers button in the view controls. When opened, it lies over the left of the canvas at 248 px wide. Pressing Layers again, or Escape, collapses it. |
| 767 px and narrower (checked at 375x812) | One pane: the top bar, the canvas at full width with the view controls over its corner, the page strip, and a bottom toolbar. The `Tools` toolbar, the left rail and the inspector rail are not shown. The bottom toolbar holds Layers, Inspector, Comments, History and Shape actions for every role, plus Insert for owners and editors. Layers (which also lists the pages), Inspector, Comments and History open as bottom sheets, one at a time. |

No layout scrolls sideways at 375, 768 or 1280 px. Below 768 px, every control is at least 44 by 44 px.

**Closed panels.** A collapsed rail or closed bottom sheet is hidden and unavailable at every width. Nothing inside it can be seen, focused or reached in the accessibility tree. This applies from the moment it starts closing until it is opened again. Moving a panel off-screen does not count as closing it.

**Empty page.** The canvas shows one page at a time. If the page has no shape on a visible layer, show the empty-page text centred on the canvas. This text is not part of the diagram.

**Page strip.** It shows `<page name> · <n> of <total>`, where `<n>` is the open page's position in page order (starting at 1) and `<total>` is the number of pages. It also has Previous page and Next page buttons, and it is visible at every width.

### Public screens and controls (DP-02, DP-08, DP-11, DP-12, DP-14, DP-18, DP-24, DP-27, DP-28, DP-33, DP-51, DP-52, DP-53, DP-61, DP-62, DP-63, DP-66)

Only the controls and regions in this section are public. Everything else is up to you.

**Canvas markup.** The diagram is SVG in the page. It is never drawn on a bitmap canvas and uses no WebGL.

- **Canvas.** One `<svg id="canvas">` with `role="graphics-document"`, `aria-roledescription="diagram"` and `aria-label="<page name> canvas"`.
- **Shapes.** Every shape is one `<g id="shape-<shapeId>" role="graphics-symbol" aria-roledescription="<kind>" aria-label="<label>">`.
  - It carries the integer attributes `data-x`, `data-y`, `data-w` and `data-h` (document units) and `data-layer="<layerId>"`.
  - `<kind>` is `rectangle`, `ellipse`, `diamond` or `text`.
  - A shape with an empty label is named `Untitled <kind>`. That name is the shape's `<label>` everywhere in this brief.
  - A shape in the current selection carries `data-selected="true"`.
  - A shape on a locked layer also carries `aria-description` set to the locked-layer description from Feedback states.
- **Connectors.** Every connector is one `<g id="connector-<connectorId>" role="graphics-symbol" aria-roledescription="connector">` containing one `<path>`.
  - Its `aria-label` is the connector name from Feedback states. A blocked connector uses the blocked connector name.
  - `data-points` holds a route as `x,y x,y ...` in integer document units. During a drag it holds the connector's preview route; at every other moment, including the drop settle, it holds the committed route (Motion and effects).
  - `data-from` and `data-to` are each `<shapeId>:<port>`.
  - `data-blocked="true"` is present only when router rule 6 applies, and a blocked connector is drawn dashed (Visual design).
  - `data-settling="true"` is present only during the drop settle.
  - A connector with a non-empty label contains one `<text class="connector-label">` holding the label, placed by the label rule in Geometry rules.
- **Groups.** Every group is a `<g id="group-<groupId>" role="group" aria-label="Group of <n> shapes">` that wraps its member shapes.
- **Overlay elements.** These are separate elements and never sit inside a shape's `<g>`:
  - port dots, `<circle class="port-dot">`;
  - remote cursors, `<g id="cursor-<userId>" data-cursor-of="<userId>" aria-hidden="true">` with a text label showing the person's name;
  - comment pins, `<button id="pin-<commentId>" aria-label="Comment by <author name> on <label>">`;
  - selection handles;
  - lock icons, one line-drawn padlock at the top-left corner of each shape on a locked layer, hidden from the accessibility tree.
- **What is left out.** Shapes on hidden layers, deleted shapes, and connectors that DP-11 hides or that were deleted, are not in the canvas markup at all.
- **Ids.** Every element id uses the server's id for the object. That id never changes, across reloads, other people's sessions, restores, undo of a delete and exports.

**Workspace controls:**

| Role and accessible name | Visible copy and notes |
|---|---|
| `heading` level 1, the diagram title | Serif display face |
| `button "<name>, editing"` / `button "<name>, viewing"` | Presence avatar, one per other connected person (never one per tab); shows initials |
| `button "Share"` | Owner only; opens `dialog "Share"` |
| `button "Export"` | Owners and editors; opens `dialog "Export"` |
| `button "Outline"` | Every role; opens the outline panel |
| `link "Download latest export"` | Shown to every member while the diagram has a ready export; downloads the newest ready one |
| `toolbar "Tools"` | Owners and editors only, 768 px and wider |
| `button "Rectangle"`, `button "Ellipse"`, `button "Diamond"`, `button "Text"` | In `Tools`; each inserts a shape |
| `button "Snap to grid"` | In `Tools`; toggle with `aria-pressed`; on when the workspace opens |
| `button "Align"` opens `menu "Align"` | In `Tools`. Menu items: `Align left`, `Align centre`, `Align right`, `Align top`, `Align middle`, `Align bottom`, `Distribute horizontally`, `Distribute vertically` |
| `button "Undo"`, `button "Redo"` | In `Tools` |
| `group "View"` | Every role, every width |
| `button "Zoom out"`, `button "Zoom in"`, `button "Reset zoom"` | In `View` |
| `#zoom-readout` (`status`, name "Zoom") | In `View`; mono text such as `100%` |
| `button "Layers"` | In `View`, 768 to 1279 px only, every role; uses `aria-expanded` |
| `button "Toggle inspector"` | In `View`, 768 px and wider, every role; uses `aria-expanded` |
| `region "Pages"` with a `list` of page items | Each item is a `button "<page name>"`, with `aria-current="page"` on the open page. Owners and editors also get `button "Add page"` |
| `alertdialog "Delete page"` | Buttons `Delete page` and `Cancel`; the Delete key on a page item opens it |
| `region "Layers"` with one item per layer, top layer first | Each item shows the layer name. Owners and editors also get two toggles with `aria-pressed`: `button "Hide layer <name>"` (or `button "Show layer <name>"` when hidden) and `button "Lock layer <name>"` (or `button "Unlock layer <name>"` when locked), plus `button "Add layer"` |
| `#left-rail` | Wraps the Pages and Layers regions at 768 px and wider |
| `#inspector-rail` with a `tablist`: `tab "Inspector"`, `tab "Comments"`, `tab "History"` | Carries `data-motion` and `data-progress` (Motion and effects) |
| `#inspector-heading` | The selected shape's label, `<n> selected` when 2 or more shapes are selected (group members counted), or `Nothing selected` |
| `spinbutton "X"`, `spinbutton "Y"`, `spinbutton "Width"`, `spinbutton "Height"`, `textbox "Label"`, `combobox "Layer"` | Inspector fields, with numbers in mono. Read-only for viewers. Width and Height are also read-only for a multi-selection. A refused value sets `aria-invalid="true"` on its field and shows the range message under it |
| `textbox "Comment"`, `button "Post comment"`, `button "Reply"`, `button "Resolve"` | Comments tab |
| `heading "Resolved (<n>)"` | Above the resolved threads |
| `button "Save version"`, a `list` of versions, `button "Restore this version"` (owner only), `button "Back to latest"` | History tab; each version is a `link` whose name is its history list text |
| `menu "Shape actions"` | Owners and editors get the items `Comment`, `Duplicate`, `Delete`, `Bring forward` and `Send backward`; viewers get only `Comment` |
| `#page-strip` with `button "Previous page"` and `button "Next page"` | |
| `#bottom-toolbar` | Below 768 px. `button "Layers"`, `button "Inspector"`, `button "Comments"` and `button "History"` open `dialog "Layers"`, `dialog "Inspector"`, `dialog "Comments"` and `dialog "History"`. `button "Shape actions"` opens `menu "Shape actions"` for the selection. `button "Insert"` (owners and editors) opens `menu "Insert"` with the items `Rectangle`, `Ellipse`, `Diamond` and `Text` |
| `tree "Diagram outline"` | Inside the outline panel; every item is a `treeitem` named with its outline text from Feedback states |
| `#announcer` | `aria-live="polite"`; the only announcement region |
| `status "Connection"` | In the banner row; holds the offline, saved and session-ended banners. While the session-ended banner shows, `button "Sign in again"` sits beside it and reopens `dialog "Sign in to continue"` |
| `dialog "Sign in to continue"` | A read-only `textbox "Email"` holding the signed-in person's email, `textbox "Password"` and `button "Sign in"` |
| `dialog "Share"` | `textbox "Email"`, `combobox "Role"` (options `Editor` and `Viewer`), `button "Send invite"` and `list "Members"`. Each row shows the person's name or email, `combobox "Role for <email>"`, a status text (the invite status texts from Feedback states), `button "Resend invite to <email>"` (Email not sent and Expired rows only) and `button "Remove <email>"`. The mail outage banner shows at the top of this dialog |
| `dialog "Export"` | `radiogroup "Format"` (`PNG`, `SVG`), `radiogroup "Scale"` (`1x`, `2x`; disabled for SVG), `combobox "Page"`, `radiogroup "Background"` (`White`, `Transparent`), `button "Export"`, `link "Download PNG"` or `link "Download SVG"`, and `button "Try again"` |
| `dialog "Save version"` | `textbox "Version name"` (optional) and `button "Save"` |
| Sign-in and sign-up forms | `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `button "Create account"`, `link "Create an account"` (sign-in page) and `link "Sign in instead"` (sign-up page) |
| Diagram list | `heading "Your diagrams"`, `button "New diagram"` and one `link "<title>"` per diagram |

### Interactions (DP-01, DP-02, DP-03, DP-04, DP-10, DP-12, DP-13, DP-15, DP-16, DP-19, DP-20, DP-21, DP-22, DP-23, DP-25, DP-33, DP-35, DP-37, DP-51, DP-54, DP-61, DP-62, DP-63, DP-66, DP-67, DP-69)

**Pointer.**

- **Selecting.** Click a shape to select it. Shift+click adds a shape to the selection or removes it. Dragging on empty canvas draws a marquee that selects every shape fully inside it. Clicking empty canvas clears the selection.
- **Moving.** Drag a selected shape, or any shape in a multi-selection, to move the whole selection. Snapping follows Geometry rules. Holding Alt during a drag turns snapping off for that drag.
- **Resizing.** Every selected shape shows square corner handles. When exactly one ungrouped shape is selected, dragging a corner handle resizes it with the opposite corner fixed, under the resize rule in Geometry rules. In a multi-selection or a group the handles only mark the selection, and dragging one moves the selection.
- **During any drag**, the shapes are drawn at the values the drop would commit, and their `data-x`, `data-y`, `data-w` and `data-h` hold those values. On drop, the operation commits exactly those values.
- **One action, one operation.** These actions are each sent as one `update_shapes` operation and kept as one undo entry: a drag or nudge of a multi-selection or a group, align, distribute, and an X or Y commit for a multi-selection. Deleting a multi-selection is likewise one operation and one undo entry.
- **Connecting.** Drag from a port dot on a hovered shape to a port on another shape to create a connector.
- **Panning and zooming.** The mouse wheel pans the view and Ctrl+wheel zooms.
- **Groups.** Clicking a member of a group selects the whole group.
- **Locked layers.** Shapes on a locked layer cannot be selected. Clicking one announces the locked notice.

**Inspector.** `spinbutton "X"`, `"Y"`, `"Width"` and `"Height"` show the selected shape's `x`, `y`, `w` and `h`. For two or more shapes they show the selection's bounding box.

- During the person's own drag, resize or keyboard nudge, the fields change on every animation frame to the values the canvas shows: the snapped value the drop would commit, or the raw value while Alt is held.
- When another person's accepted operation changes a selected shape, the fields show the new values within 1 second, with no reselecting.
- **Drafts.** A field that has focus and holds a value the person has typed but not committed keeps that draft, whatever arrives from others.
  - Enter or Tab commits the draft as a new operation. It gets a later `seq`, so it wins.
  - Escape drops the draft and shows the latest value.
  - Fields without a draft keep updating.
- **Range check.** Committing Width or Height outside 24 to 2000, X or Y outside −20000 to 20000, or any value that is not a whole number, sends nothing. The field gets `aria-invalid="true"`, the range message from Feedback states shows under it and is announced, and the draft stays. Escape clears the draft, the message and `aria-invalid`, and shows the stored value.
- **Multi-selection.** Committing X or Y moves the whole selection so the bounding box's left or top edge equals the value.

**Keyboard.** In this table, Ctrl also works as Command on macOS. There are two kinds of shortcut:

- **Canvas shortcuts** work when focus is on the canvas or on any shape in it.
- **Workspace shortcuts** work whichever workspace control has focus, toolbar buttons included, unless the person is typing in a text field.

Shortcuts that change the document do nothing for viewers. Every pointer action has a keyboard path in this table.

| Keys | Where | Effect |
|---|---|---|
| Tab / Shift+Tab | workspace | Moves between the top bar, toolbar, left rail, canvas, view controls, page strip and inspector rail. The whole canvas is one tab stop. |
| Tab into the canvas | canvas | Focuses the shape that last had focus, or else the first shape in reading order. On an empty page the canvas itself takes focus. Reading order is by top edge, then left edge, then id. |
| Alt+ArrowRight or Alt+ArrowDown / Alt+ArrowLeft or Alt+ArrowUp | canvas | Moves focus to the next / previous shape in reading order. Only focus moves; the selection stays as it is. |
| Space or Enter | focused shape that is not selected | Selects it, replacing the selection |
| Shift+Space | focused shape | Adds the shape to the selection or removes it |
| Enter | selected shape | Opens `textbox "Label"` over the shape. Enter commits the label; Escape cancels and restores the old label. |
| Enter | selected group | Selects the group's first member in z order. Escape returns to the group. |
| Arrow / Shift+Arrow | canvas | Nudges the selection, or the focused shape when nothing is selected (Geometry rules) |
| R | canvas | Inserts a rectangle, the same way as the Rectangle button |
| Rectangle, Ellipse, Diamond and Text buttons, and the Insert menu items | toolbar | Insert a 160 by 80 shape at the insertion position from Geometry rules, then focus its label editor |
| C | focused shape | Starts connect mode from that shape (steps below) |
| Delete or Backspace | canvas | Deletes the selection. Focus moves to the next shape in reading order, or to the canvas. |
| Ctrl+D | canvas | Duplicates the selection, offset 24 right and 24 down |
| Ctrl+] / Ctrl+[ | canvas | Brings forward / sends backward one step in z order within the layer |
| Ctrl+A | canvas | Selects every shape on the page's visible, unlocked layers |
| Ctrl+G / Ctrl+Shift+G | canvas | Groups / ungroups |
| Alt+Shift+L, C, R, T, M, B | workspace | Aligns left, centre, right, top, middle, bottom |
| Alt+Shift+H / Alt+Shift+V | workspace | Distributes horizontally / vertically |
| M | selected shape | Opens the Comments tab (the Comments sheet below 768 px) with the composer focused for that shape |
| Shift+F10 | selected shape | Opens `menu "Shape actions"` |
| Escape | canvas | Steps back one level: closes an open menu or dialog; otherwise leaves connect mode; otherwise returns from a group member to its group; otherwise clears the selection |
| Ctrl+Z / Ctrl+Shift+Z | workspace | Undoes / redoes your own operations |
| Ctrl+Alt+N | workspace | Adds a page named `Page <n>`, where `<n>` is the new page count, and opens it |
| Ctrl+PageDown / Ctrl+PageUp | workspace | Opens the next / previous page |
| F2 | page or layer item | Renames in place. Enter commits; Escape cancels. |
| Alt+ArrowUp / Alt+ArrowDown | page or layer item | Moves the item up / down one place and announces the reorder notice. Focus stays on the item. At either end nothing moves and nothing is announced. |
| Delete | page item | Opens `alertdialog "Delete page"`. On the last remaining page nothing happens. |
| Ctrl+Alt+O | workspace | Opens the outline panel and focuses the tree |
| Ctrl+Alt+H | workspace | Opens the History tab (the History sheet below 768 px) |
| Ctrl+Alt+S | workspace | Opens `dialog "Save version"` |
| Ctrl+Shift+E | workspace | Opens `dialog "Export"` |
| Ctrl+= / Ctrl+- / Ctrl+0 | workspace | Zooms in a step / zooms out a step / resets to 100%. The steps are 25, 50, 75, 100, 150, 200, 300 and 400. |

**Connect mode.**

1. Pressing C on a focused shape starts connect mode. The **candidates** are every other shape on a visible, unlocked layer of the page, in reading order. The source shape is never a candidate. Port dots show on every candidate. When there are no candidates, C does nothing.
2. The target highlight starts on the first candidate after the source in reading order, or, when the source comes after every candidate, on the first candidate.
3. Right and Down move the highlight to the next candidate, and from the last candidate wrap to the first. Left and Up move it to the previous candidate, and from the first wrap to the last. The highlight never lands on the source. With only one candidate, every arrow key keeps the highlight on it.
4. Keys 1, 2, 3 and 4 pick the target port `n`, `e`, `s` or `w`. Without a pick, the default port pair from Geometry rules applies. The source port always comes from the default port pair.
5. Enter creates the connector to the highlighted candidate and announces the connected notice. Focus returns to the source shape.
6. Escape leaves connect mode and creates nothing.

**Focus.** Focus is always visible as a 2 px ink outline with a 2 px gap around the focused control or shape. After any action, focus lands on a sensible control and never falls to the page body.

**Dialogs, sheets and menus.** These rules apply to Share, Export, Save version, Delete page, Sign in to continue, the Shape actions, Align and Insert menus, the outline panel and every bottom sheet:

- Opening one moves focus inside it.
- Tab past the last control wraps to the first, and Shift+Tab on the first wraps to the last.
- Escape closes it.
- Focus returns to the control that opened it. For the Sign in to continue dialog, that is the control that had focus when the session ended.

**Menu placement.** `menu "Shape actions"`, `menu "Insert"` and `menu "Align"` always open fully inside the viewport, at every published size.

- When there is not enough room below or to the right of the anchor, the menu flips above it or to its left.
- `#bottom-toolbar`, the page strip and the view controls never cover it, and the canvas's edges never clip it. Every item's centre point hits that item.
- The anchor is the press point for a long press, the selected shape for Shift+F10, and the opening button otherwise.
- For example, a long press on a shape within 60 px of the bottom-right corner of the canvas at 375x812 opens the menu above the press point, and all its items are tappable.

**Outline tree.** The tree's structure and item texts are in Feedback states. It follows the standard tree keyboard pattern:

- Up and Down move between visible items.
- Right expands an item or moves to its first child. Left collapses an item or moves to its parent.
- Home and End go to the first and last items.
- Enter on a shape item opens that shape's page, selects the shape and moves focus to it on the canvas.

**Touch.** These apply below 768 px and on any touch screen:

- Tap selects a shape.
- A one-finger drag on empty canvas pans. A one-finger drag on a selected shape moves it.
- A two-finger pinch zooms around the pinch's midpoint, within the zoom range.
- A long press held for 500 milliseconds on a shape selects it and opens `menu "Shape actions"`.
- A horizontal swipe on the page strip switches page: a swipe left opens the next page and a swipe right the previous one.

Each touch action also has a visible button for every role: the zoom buttons in the view controls, Previous page, Next page and Shape actions.

**History.**

- Choosing a version in the History list opens its preview at the version address (Business rules, Versions).
- "Back to latest" pushes the address without `version`.
- A successful "Restore this version" replaces the address with one that has no `version`.

**Comments.** Tapping or clicking a pin opens its thread in the Comments tab or sheet.

**Export dialog.**

- Pressing Export sends one export request. Further presses while that request is unanswered send nothing.
- Closing the dialog never cancels an export.
- Each time the dialog opens, it shows the newest export this person requested for the page selected in its Page box (the open page by default), in its current state: the pending text, the ready text with the download link, or the paused banner with Try again.
- The dialog shows its blank form only when no such export exists.
- Pressing Try again shows the pending text. A Try again that the server answers with 409 `export_not_retryable` shows no error; the dialog keeps showing the export's current state.

### Visual design (DP-24, DP-60)

- **Colour.** The canvas is warm off-white graph paper. Fine sand-coloured lines run every 24 units, with a slightly stronger line every 120 units, at 100% zoom. Text, shape outlines and connectors are deep navy ink. The rails and top bar sit on the same warm off-white and are separated by single sand-coloured hairline rules.
- **Accents.** A single vermilion accent is used only for selection outlines, selection handles and port dots. A deep teal marks presence: avatars, remote cursors and their name labels. No other accent colours appear.
- **Status is never colour alone.**
  - A blocked connector is drawn with a dashed navy line, not only a different colour.
  - A selected shape shows both the vermilion outline and square corner handles.
  - A shape on a locked layer carries its small line padlock.
  - A refused inspector value shows its message as text under the field, not only a coloured border.
- **Type.**
  - The diagram title and the panel headings use Instrument Serif, a narrow, high-contrast serif like a drafting book.
  - Everything else uses IBM Plex Sans.
  - Every coordinate, size, zoom percentage and count in the inspector, zoom readout and page strip uses IBM Plex Mono.
  - Each heading level is about a fifth larger than the level below, and the diagram title is the largest text on screen.
- **Density.** The layout is compact. Rows in the rails sit close together, with labels on the left and mono numbers on the right.
- **Composition.** The look is flat, like a technical drawing on paper: no gradients and no drop shadows anywhere. The view controls sit on a paper-coloured plate edged with a hairline rule. Icons are thin line icons.
- **Accessibility.** Below 768 px, controls are at least 44 by 44 px. All text and controls meet WCAG 2.2 AA contrast against the warm paper.

### Motion and effects (DP-07, DP-08, DP-09, DP-28, DP-52)

All motion starts quickly and settles softly into place. Nothing animates unless someone has just acted. There are no looping or decorative animations anywhere, and pending states are shown as text, never as spinners.

**The signature: "Tethered reroute."** This shows the user that a connector is wired to shapes, not to fixed points.

1. When a drag of a shape starts, port dots appear at both ends of every connector bound to the dragged shapes. They fade in over 120 milliseconds.
2. On every animation frame of the drag, the client routes the whole page with the dragged shapes at their drawn positions, using the same router the server uses. Every connector whose route comes out different from its committed route redraws to that preview, whether or not it is bound to a dragged shape, and its `data-points` hold the preview. Each connector label rides the midpoint of its preview's longest segment.
3. On drop, `data-points` switch at once to the route the drop commits, which is the last preview. Over the next 200 milliseconds only the drawn line eases from the preview into that route. The connector carries `data-settling="true"` during the settle, and the attribute is removed when the settle ends. The port dots fade out at the same time.
4. When the server acknowledges the move, the person who moved the shape hears the moved notice. The acknowledged routes equal the committed routes within the tolerances in Geometry rules.

A keyboard nudge plays steps 3 and 4 and gives the same final geometry and notice.

**Remote moves.** When someone else moves a shape, every other open session shows that person's cursor and the shape gliding to the new place over 240 milliseconds. The connectors reroute along with the shape. During the glide, the shape's `data-*` attributes and the connectors' `data-points` already hold the committed values, and the drawing catches up within 240 milliseconds. Remote cursors also glide to each new position over 240 milliseconds.

**Inspector rail.** `#inspector-rail` slides open or closed over 200 milliseconds, driven frame by frame. It exposes two attributes:

- `data-motion`: one of `opening`, `open`, `closing` or `closed`.
- `data-progress`: from `0.00` to `1.00` with two decimals, where `1.00` means fully open.

Toggling it mid-motion reverses from the current progress. A close that starts at progress p takes p × 200 milliseconds. An open that starts at progress p takes (1 − p) × 200 milliseconds. The progress never jumps to an end state mid-motion.

The layers rail and the bottom sheets also slide in and out over 200 milliseconds, but expose no motion state.

**Reduced motion.** Whenever the system asks for reduced motion:

- The inspector rail goes straight to `open` with `1.00`, or `closed` with `0.00`, in the same frame. Rails and sheets appear and disappear at once.
- Connectors jump straight to the committed route on drop, and `data-settling` never appears.
- Port dots show at full strength with no fade.
- Remote moves and remote cursors apply at once.
- Drag previews, final geometry, announcements and text stay identical to full motion.

### Feedback states (DP-17, DP-25, DP-29, DP-30, DP-31, DP-32, DP-41, DP-43, DP-44, DP-45, DP-46, DP-49, DP-53, DP-62, DP-63, DP-65, DP-66, DP-67)

**Where messages appear.** Every announcement goes to `#announcer`. Banners also update their own region:

- the offline, saved and session-ended banners in `status "Connection"`;
- the mail outage banner inside `dialog "Share"` only;
- the export pending, ready and paused texts inside `dialog "Export"`;
- the view-only, preview and export paused banners in the banner row;
- the range message under its inspector field.

Every string below renders character for character, with straight apostrophes, straight double quotes and the ASCII hyphen-minus for negative numbers. This section, together with its copy table and its outline table, is the complete set of published copy.

**Placeholders.**

- `<label>` is the shape's label as defined in Public screens and controls. When several shapes are involved, it is `<k> shapes`, where `<k>` counts the shapes, group members included.
- `<name>` is the acting person's display name.
- `<n>`, `<m>`, `<k>` and `<total>` are counts written as digits.
- `<min>` and `<max>` are the field's limits written as digits with no separators: 24 and 2000 for Width and Height, -20000 and 20000 for X and Y.
- `<version name>` is the version's display name from Business rules.
- `<email>` is the address as typed, in lowercase.

| Where | Exact text |
|---|---|
| moved notice (announcer) | `Moved <label>. 1 connector rerouted.` when the rerouted list has one entry; otherwise `Moved <label>. <n> connectors rerouted.`, where `<n>` is the list's length (including 0) |
| reorder notice | `Moved <name> to position <n> of <total>.`, where `<name>` is the page or layer name and `<n>` is its new position counted from 1 in the order the list shows (pages in page order, layers top first) |
| aligned notice | `Aligned <n> shapes <side>.`, where `<n>` counts every selected shape, group members included, and `<side>` is `left`, `centre`, `right`, `top`, `middle` or `bottom` |
| distributed notice | `Distributed <n> shapes.`, where `<n>` counts as for the aligned notice |
| grouped / ungrouped notice | `Grouped <n> shapes.` / `Ungrouped <n> shapes.` |
| cross-layer group refusal | `Shapes on different layers can't be grouped.` |
| locked notice | `Layer <layer name> is locked.` |
| locked-layer description (shape `aria-description`) | `On locked layer <layer name>` |
| range message (under the field and announced) | `Enter a whole number from <min> to <max>.` |
| connector name | `Connector from <source label> to <target label>` |
| blocked connector name | `Connector from <source label> to <target label>, blocked` |
| connected notice | `Connected <source label> to <target label>.` |
| joined notice | `<name> joined.` |
| replaced notice | `<name> changed <label> at the same time. Their edit was kept.` |
| deleted notice | `<label> was deleted by <name>. Your change was not saved.` |
| role notice | `You're now a viewer. Your last change was not saved.` |
| can't-undo notice | `Can't undo: <name> changed <label> after you.` |
| offline banner | `Offline. 1 change waiting to save.` when one change is waiting; otherwise `Offline. <n> changes waiting to save.` |
| session-ended banner | `Your session ended. Sign in to keep your changes.` when nothing is waiting; otherwise that sentence, one space, then `1 change waiting to save.` or `<n> changes waiting to save.` |
| saved banner | `All changes saved.` |
| view-only banner | `View only. Ask <owner name> for edit access.` |
| preview banner | `Previewing <version name>. Restore it or go back to the latest.` |
| version saved notice | `Saved <version name>.` |
| restore pending | `Restoring <version name>...` |
| restored notice | `<name> restored <version name>.` |
| export pending (dialog and announcer) | `Exporting <page name>...` |
| export ready (dialog and announcer) | `Export ready.` |
| export paused banner (dialog and banner row) | `Exports are paused: storage is unavailable. Editing still works.` |
| invite pending | `Sending invite...` |
| invite emailed notice | `Invite emailed to <email>.` |
| invite status texts (Share dialog rows) | `Active`, `Invited`, `Email not sent`, `Expired` |
| mail outage banner (Share dialog only) | `Email is unavailable. The invite is saved; use Resend when email is back.` |
| empty page text | `This page is empty. Add a shape from the toolbar or press R.` |
| empty diagram list | `No diagrams yet. Create one to start drawing.` |
| not-found page | heading `Diagram not found`, text `This diagram doesn't exist or you don't have access to it.` |
| sign-in error (sign-in page and Sign in to continue dialog) | `Email or password is incorrect.` |
| field errors | name: `Enter your name.`; email: `Enter an email address.`; password: `Use at least 10 characters.`; taken email: `An account with this email already exists.`; title: `Enter a title.`; control characters in a title or name: `Remove line breaks and control characters.` |
| invite email subject | `<inviter name> shared "<diagram title>" with you as an editor` or `<inviter name> shared "<diagram title>" with you as a viewer` |
| mention email subject | `<name> mentioned you on "<diagram title>"` |

**When announcements fire.**

- The moved notice is announced to the mover once per move operation, when its acknowledgement arrives, with the count taken from that acknowledgement. A multi-shape move, align or distribute gives one acknowledgement and so at most one moved notice; align and distribute announce their own notice instead of the moved notice.
- A delete that reroutes connectors announces the moved notice to the deleter with the deleted shape's `<label>`, counted from that acknowledgement's rerouted list.
- Moves that are queued and then replayed are not announced. The saved banner covers them.
- `Export ready.` is announced exactly once per export, in the browser tab that requested it. A reload of that tab counts as the same tab, so an export that becomes ready while the dialog is closed, or while the tab reloads, is still announced once through `#announcer`. A deduplicated second request for the same export announces nothing more.

**Outline tree.** The tree has up to four levels: pages, then layers, then shapes and groups, then the members of each group. Connector items sit under their layer, after its shapes and groups.

- **Pages** are the top-level items, in page order. The open page starts expanded and the others start collapsed.
- **Layers** are the children of a page, top layer first. Only visible layers appear; hidden layers and everything on them are left out. Layer items start expanded.
- **Under a layer** come one item per ungrouped shape and one item per group on that layer, together in reading order. A group is placed by the top-left corner of its members' bounding box. After them comes one item per connector that belongs to the layer and is shown on the canvas, ordered by the source shape's reading order, then the target shape's reading order, then id.
- **Under a group** comes one item per member shape, in reading order. Group items start expanded.

Item texts are below. In the counts, use `1 shape` and `1 connector` when the count is one, and the plural otherwise.

| Item | Exact text |
|---|---|
| page | `<page name>, <n> shapes, <m> connectors`, where `<n>` counts the page's shapes on visible layers and `<m>` counts the connectors shown on its canvas |
| layer, unlocked | `<layer name> layer, <k> shapes`, where `<k>` counts that layer's shapes |
| layer, locked | `<layer name> layer, locked, <k> shapes` |
| group | `Group of <n> shapes` |
| shape with no shown connector | `<label>, <kind>, not connected` |
| shape that is only a source | `<label>, <kind>, connected to <targets>` |
| shape that is only a target | `<label>, <kind>, connected from <sources>` |
| shape that is both | `<label>, <kind>, connected to <targets>, connected from <sources>` |
| connector | the connector name, or the blocked connector name when it is blocked |

- `<targets>` lists the labels of the shapes this shape's shown connectors point to.
- `<sources>` lists the labels of the shapes whose shown connectors point to it.
- Each list names every shape once, in reading order. One label stands alone; two are joined as `<a> and <b>`; three or more read `<a>, <b> and <c>`, with no comma before `and`.

For example, in Journey 3 Start reads `Start, rectangle, connected to Check`, and Check reads `Check, rectangle, connected from Start`.

The outline reflects every accepted operation, other people's included, within 1 second and without a reload.

**Pending, success, error and outage for each async action:**

| Action | Pending | Success | Errors and outages |
|---|---|---|---|
| Edits | none (edits show at once) | none | Refusals roll back on screen with the deleted, role or replaced notice. Connection loss shows the offline banner. An ended session shows the session-ended banner and the Sign in to continue dialog. |
| Inspector commit | none | none | An out-of-range or non-whole value shows the range message and sends nothing |
| Restore | restore pending text | restored notice | none |
| Save version | none | version saved notice | none |
| Export | export pending text | export ready text, then the download link | Storage unreachable: the export paused banner and the Try again button |
| Invite and resend | invite pending text | invite emailed notice | Mail unreachable: the mail outage banner in the Share dialog, and the row shows `Email not sent` |
| Sign-in, sign-up, new diagram and the Sign in to continue dialog | none | none | The field errors and sign-in error from the table, shown under each field and announced. On the sign-in and sign-up pages, a summary at the top links to each field. |

## Backend

### API (DP-24, DP-26, DP-34, DP-36, DP-37, DP-38, DP-40, DP-41, DP-42, DP-44, DP-46, DP-47, DP-48, DP-55, DP-58, DP-62, DP-63, DP-64, DP-65, DP-66, DP-67, DP-69)

**General.**

- All endpoints live under `/api` and send and receive `application/json`. The export file route is the only exception.
- A request body may be at most 1,000,000 bytes; exactly 1,000,000 bytes is allowed. A larger body answers 413 `too_large`. A body that is not JSON answers 415 `unsupported_media_type`.
- The session cookie is `lw_session`, HttpOnly and SameSite=Lax.
- Every error has the shape `{"error":{"code":"<code>","message":"<sentence>"}}`. Validation errors add `"fields":{"<path>":"<sentence>"}`, where `<path>` is the dotted path of the offending value from the root of the request body, with list positions written as numbers, for example `title`, `name`, `op.set.route` or `op.shapes.0.set.seq`. Only `code` and the `fields` keys are fixed, except for the not-found message below.

**Error precedence.** Every route checks in this order, and each endpoint row lists only its own extra codes:

1. Unauthenticated: 401 `unauthenticated`.
2. Not found: 404 `not_found` with the exact body `{"error":{"code":"not_found","message":"Diagram not found."}}`. This **not-found rule** covers:
   - a missing diagram;
   - a diagram the requester is not a member of;
   - any page, layer, shape, connector, comment, version, export, invite, member or object id, in the path, in the body or in the workspace address's `version`, that has never belonged to that diagram;
   - an export of a diagram the requester cannot read.
3. Role: 403 `forbidden_role`.
4. Temporary outage: 503 `save_unavailable`, only during a grading save outage.
5. State conflict: 409, with the codes listed per endpoint.
6. Validation: 422 `invalid`.

An operation replay (same `opId`) returns its stored response before any check from step 4 onward.

**Document format.** This object is the current document, and it is also the content of every version.

```json
{
  "id": "d_a1b2c3d4e5f6", "title": "Pipeline", "seq": 42,
  "pages": [
    {
      "id": "p_…", "name": "Main", "order": 0,
      "layers": [ {"id": "l_…", "name": "Base", "order": 0, "visible": true, "locked": false} ],
      "shapes": [ {"id": "s_…", "kind": "rectangle", "layer": "l_…", "x": 96, "y": 48, "w": 160, "h": 80,
                   "label": "Intake", "z": 3, "group": null} ],
      "connectors": [ {"id": "c_…", "layer": "l_…", "from": {"shape": "s_…", "port": "e"},
                       "to": {"shape": "s_…", "port": "w"}, "label": "", "route": [[256, 88], [296, 88]]} ],
      "groups": [ {"id": "g_…", "members": ["s_…", "s_…"]} ]
    }
  ]
}
```

- **Ids.** Each id is a prefix followed by 12 lowercase letters or digits. The prefixes are `d_` (diagram), `p_` (page), `l_` (layer), `s_` (shape), `c_` (connector), `g_` (group), `m_` (comment), `v_` (version), `x_` (export), `i_` (invite) and `u_` (user). Only the server makes ids. A client sends a `clientRef` and receives the id in the acknowledgement. No new object ever receives an id that was used before.
- **`seq`** is the sequence number of the last accepted operation.
- **Order.**
  - Layer `order` 0 is the bottom layer; the layers rail lists layers top first.
  - Page `order` 0 is the first page.
  - Shape `z` orders shapes within a layer, with higher values drawn on top.
  - A shape's `group` is its group id or `null`.
- **Routes.** `route` is a list of `[x, y]` integer points that the server derives (Geometry rules).
- **Limits.** Breaking any of these answers 422 `invalid`.
  - Coordinates are integers from −20,000 to 20,000, inclusive.
  - Shapes are 24 to 2,000 units wide and tall, inclusive.
  - A page holds at most 500 shapes and at most 500 connectors. A diagram holds at most 20 pages, and each page at most 10 layers.
  - Labels are 0 to 200 characters. Page and layer names are 1 to 60 characters.
  - Titles are 1 to 120 characters, and display names are 1 to 80 characters. Both follow the text safety rule in Business rules.

**Endpoints.** Every `<diagramId>` route is open to every member unless its row says otherwise.

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/auth/signup` | `{"name","email","password"}` | 201 `{"user":{"id","email","name"}}`; sets the cookie and accepts open invites (Business rules) | 409 `email_taken`; 422 with `fields` |
| `POST /api/auth/signin` | `{"email","password"}` | 200 `{"user":{...}}`; sets the cookie and accepts open invites | 401 `bad_credentials` |
| `POST /api/auth/signout` | none | 204; ends the session (Business rules, Sessions) | none |
| `GET /api/me` | none | 200 `{"user":{"id","email","name"}}` | none |
| `GET /api/diagrams` | none | 200 `{"diagrams":[{"id","title","role","updatedAt"}]}` | none |
| `POST /api/diagrams` | `{"title"}` | 201 `{"diagram":{"id","title"},"document":<document>}`; the document has one page `Page 1` with one layer `Layer 1` | 422 with `fields.title` |
| `GET /api/diagrams/<diagramId>/document` | none | 200, the document | none |
| `POST /api/diagrams/<diagramId>/operations` | `{"opId","baseSeq","op"}` (below) | 200 `{"opId","seq","ids":{"<clientRef>":"<id>"},"rerouted":["<connectorId>"]}`. `ids` is `{}` when nothing was created; `rerouted` is defined under Rerouting | 403 for viewers; 409 `shape_deleted`, `connector_deleted`, `layer_locked`, `op_conflict`; 422 |
| `GET /api/diagrams/<diagramId>/members` | none | 200 `{"members":[{"userId","email","name","role","status"}],"invites":[{"id","email","role","status","expiresAt"}]}`. Member `status` is `active`. Invite `status` is `emailed`, `email_not_sent` or `expired`. `expiresAt` is an ISO 8601 UTC time | none |
| `POST /api/diagrams/<diagramId>/invites` | `{"email","role"}`, where role is `editor` or `viewer` | 201 `{"invite":{"id","email","role","status","expiresAt"}}` | 403 for non-owners; 409 `already_member`, `already_invited`; 422 |
| `POST /api/diagrams/<diagramId>/invites/<inviteId>/resend` | none | 200 `{"invite":{...}}` | 403; 409 `invite_closed` |
| `DELETE /api/diagrams/<diagramId>/invites/<inviteId>` | none | 204 (revoked) | 403; 409 `invite_closed` |
| `PATCH /api/diagrams/<diagramId>/members/<userId>` | `{"role"}` | 200 `{"member":{...}}` | 403; 409 `owner_role`; 422 |
| `DELETE /api/diagrams/<diagramId>/members/<userId>` | none | 204 | 403; 409 `owner_role` |
| `GET /api/diagrams/<diagramId>/comments` | none | 200 `{"comments":[{"id","shape","page","author":{"id","name"},"text","resolved","anchored","parent","createdAt"}]}` | none |
| `POST /api/diagrams/<diagramId>/comments` | `{"shape","text","parent"}`; `parent` is optional; `text` is 1 to 2,000 characters | 201 `{"comment":{...}}` | 409 `shape_deleted`; 422 |
| `POST /api/diagrams/<diagramId>/comments/<commentId>/resolve` | none | 200 `{"comment":{...}}` | 403 unless owner, editor or the comment's author; 409 `already_resolved` |
| `GET /api/diagrams/<diagramId>/versions` | none | 200 `{"versions":[{"id","number","name","displayName","author":{"id","name"},"createdAt","seq"}]}`, newest first | none |
| `POST /api/diagrams/<diagramId>/versions` | `{"name"}`; `name` is optional, 0 to 80 characters | 201 `{"version":{...}}` | 403 for viewers; 422 |
| `GET /api/diagrams/<diagramId>/versions/<versionId>` | none | 200 `{"version":{...},"document":<document>}` | none |
| `POST /api/diagrams/<diagramId>/versions/<versionId>/restore` | none | 200 `{"version":<the new restored version>,"seq"}` | 403 for non-owners |
| `GET /api/diagrams/<diagramId>/exports` | none | 200 `{"exports":[{"id","status","format","page","seq","requestedBy","width","height","createdAt"}]}`, newest first; `requestedBy` is a user id | none |
| `POST /api/diagrams/<diagramId>/exports` | `{"page","format","scale","background"}`. `format` is `png` or `svg`; `scale` is `1` or `2` (SVG takes only `1`); `background` is `white` or `transparent` | 202 `{"id","status":"rendering","format","page","seq","width":null,"height":null}`. A repeat answers 200 with the existing export's current body (Business rules, Exports) | 403 for viewers; 422, including a page with no visible shape |
| `GET /api/exports/<exportId>` | none | 200 `{"id","status","format","page","seq","width","height"}`; `width` and `height` are integers once the export is ready | none |
| `GET /api/exports/<exportId>/file` | none | 200, the stored file streamed from object storage | 409 `export_not_ready` |
| `POST /api/exports/<exportId>/retry` | none | 202 `{"id","status":"rendering",...}` with the same fields as the GET body | 403 for viewers; 409 `export_not_retryable` |
| `GET /api/health` | none | 200 `{"status":"ok"}` | never 503 |

**Operations over HTTP.** The live socket and this endpoint accept operations under the same rules.

- `opId` is 1 to 64 letters, digits, `_` or `-`, and is unique per person per diagram.
- `baseSeq` is the last `seq` the sender had seen.
- `op` is one of:
  - `{"kind":"add_shape","page","layer","shape":{"kind","x","y","w","h","label"},"clientRef"}`
  - `{"kind":"update_shape","shape","set":{"x","y","w","h","label","layer"}}`, where `set` names one or more of these fields.
  - `{"kind":"update_shapes","shapes":[{"shape","set"}]}`, with 1 to 500 entries. Each `set` follows the `update_shape` rules. A shape id may appear only once, and every shape must be on one page; otherwise 422 `invalid`.
  - `{"kind":"delete_shape","shape"}`. This also deletes the shape's connectors and removes the shape from its group. A group left with fewer than two members dissolves.
  - `{"kind":"add_connector","page","from":{"shape","port"},"to":{"shape","port"},"label","clientRef"}`. Both shapes must be on that page and must be different shapes.
  - `{"kind":"delete_connector","connector"}`
- **Published keys.** The request body accepts only `opId`, `baseSeq` and `op`. Each op accepts only the keys shown for its kind. `add_shape.shape` accepts only `kind`, `x`, `y`, `w`, `h` and `label`; every `set` accepts only `x`, `y`, `w`, `h`, `label` and `layer`; each `update_shapes` entry accepts only `shape` and `set`; `from` and `to` accept only `shape` and `port`.
  - Any other key answers 422 `invalid` with `fields` naming its dotted path, for example `op.set.route`, `op.shape.id`, `op.set.z`, `op.set.group` or `op.shapes.0.set.seq`.
  - Nothing changes, the document `seq` stays the same and nothing is broadcast.
- **Layer moves.** A `set.layer` naming a layer on another page of the same diagram answers 422 with `fields` key `op.set.layer` (or `op.shapes.<i>.set.layer`). A layer id that never belonged to the diagram falls under the not-found rule.
- **All or nothing.** `update_shapes` entries are checked in list order. The first entry naming a deleted shape answers 409 `shape_deleted`; the first entry that the locked-layer rule in Business rules (Layers) refuses answers 409 `layer_locked`. In either case no shape changes, `seq` stays the same and nothing is broadcast. A single `update_shape` follows the same two rules.
- An accepted `update_shapes` takes exactly one `seq` and has one rerouted list, computed from the routes before and after the whole operation.
- Pages, layers, groups, z order, multi-shape delete and undo travel over the live socket only. That protocol is yours to design, apart from the address, the close codes and the rules in Business rules.
- Every socket acknowledgement of an accepted operation carries the same `seq`, `ids` and `rerouted` as the HTTP response would.

**Live socket.**

- The socket is at `/ws?diagram=<diagramId>` and is authenticated by the session cookie.
- Close codes:
  - 4401: no session, or the session ended;
  - 4404: the not-found rule applies;
  - 4503: a grading save outage closed it.
- A person removed from a diagram is closed with 4404, and their open page shows the not-found page.

**Workspace address.** `GET /d/<diagramId>` answers 200 with the client, or 404 with the not-found page under the not-found rule, including when the `version` query parameter is a version that does not belong to the diagram.

**Grading routes.** These exist only when `GRADING_ROUTES` is `on`, and they need no session. With any other value they answer 404.

`POST /api/grading/seed` creates everything in one call. The request:

```json
{"users":[{"email","name","password"}],
 "diagrams":[{"title","owner":"<email>","members":[{"email","role"}],
   "document":{"pages":[{"name",
     "layers":[{"name","visible","locked"}],
     "shapes":[{"kind","layer":"<layer name>","x","y","w","h","label"}],
     "connectors":[{"from":{"shape":"<label>","port"},"to":{"shape":"<label>","port"},"label"}],
     "groups":[{"members":["<label>"]}],
     "comments":[{"shape":"<label>","author":"<email>","text"}]}]}}]}
```

- Layers are listed bottom first, and shapes in z order.
- Labels must be unique within a page.
- Members become `active` at once.
- Routes are derived. Connectors get ids in the order they are listed, so the first listed connector has the lowest id.
- The response is 201 `{"users":[{"id","email"}],"diagrams":[{"id","pages":[{"id","name","layers":{"<name>":"<id>"},"shapes":{"<label>":"<id>"},"connectors":{"<source label>-><target label>":"<id>"},"comments":{"<shape label>":["<commentId>"]}}]}]}`.
- Errors: 409 `email_taken` if a user's email already exists; 422 for anything else that is invalid, including titles and names that break the text safety rule, with `fields` keys as stated there. Nothing is created on error.

`POST /api/grading/save-outage` takes `{"diagramId","ms"}`, with `ms` from 1 to 60,000 inclusive.

- It closes every socket on that diagram with 4503.
- For `ms` milliseconds of server time, it refuses new sockets for that diagram and answers its operations with 503 `save_unavailable`.
- It responds 200 `{"until":"<ISO 8601 UTC time>"}`.

### Business rules (DP-01, DP-03, DP-04, DP-05, DP-06, DP-07, DP-08, DP-10, DP-11, DP-12, DP-13, DP-15, DP-20, DP-23, DP-26, DP-27, DP-28, DP-29, DP-30, DP-31, DP-32, DP-33, DP-34, DP-35, DP-36, DP-37, DP-38, DP-39, DP-41, DP-42, DP-43, DP-45, DP-46, DP-49, DP-62, DP-63, DP-64, DP-65, DP-67, DP-68, DP-69)

**Server time.** The device clock may be wrong. Every time-dependent status the screen shows comes from the server's published status, and the browser never works it out from its own clock. This covers invite expiry, the version list and its times, export state and presence.

**Geometry rules.**

*Canvas coordinates.*

- The **view origin** is the document point drawn at the top-left corner of `#canvas`'s on-screen box. The **zoom factor** is the zoom percentage divided by 100.
- A point (dx, dy) CSS pixels right of and below that corner is the document point (view origin x + dx ÷ zoom factor, view origin y + dy ÷ zoom factor).
- Panning changes the view origin. Zooming changes the zoom factor; pinch and wheel zoom also change the view origin so the zoom centre stays put.
- At 100% zoom with no pan, the view origin is (0, 0). One document unit is then one CSS pixel, and the document origin is the top-left corner of `#canvas`.
- `#canvas`'s on-screen box is its box as the browser lays it out, whatever toolbars, view controls or banners are drawn over it.

*Snapping and nudges.* Rounding to the nearest multiple of 8 sends halves upward. Without snapping, values round to the nearest integer.

- **Move.** With Snap to grid on, a drag moves every selected shape by one shared offset, chosen so the selection's bounding box lands with its left and top edges on the nearest multiples of 8. For one shape that means its `x` and `y`. Sizes do not change.
- **Resize.** With Snap to grid on, dragging a corner handle keeps the opposite corner fixed and rounds the dragged corner's two edges to the nearest multiples of 8. `w` and `h` follow from the edges and are never rounded on their own, so an off-grid fixed edge stays where it was. When a dragged edge would make a size smaller than 24 or larger than 2,000, it stops exactly 24 or 2,000 units from the fixed edge, unsnapped.
- Holding Alt during a drag turns snapping off for that drag only, for moves and resizes alike.
- Keyboard nudges are never snapped: Arrow moves 8 units and Shift+Arrow moves 1 unit.

*Insertion position.* A shape inserted from a shape button, the Insert menu or R is 160 by 80 units. It goes on the top visible, unlocked layer of the open page. When the page has no visible, unlocked layer, those controls are disabled and R does nothing.

1. Take the centre of `#canvas`'s on-screen box and convert it to the document point (cx, cy) at the current pan and zoom, using the canvas coordinates rule. Controls drawn over the canvas (the `Tools` toolbar, the view controls, banners and the empty-page text) are ignored and never shift this point.
2. The new box starts at `x` = cx − 80 and `y` = cy − 40, each rounded down to an integer. Insertion is never snapped.
3. While the new box overlaps the box of any shape on a visible layer of the page, move it 208 units to the right. Boxes that only touch at an edge do not overlap.

For example, two rectangles inserted one after the other on an empty page sit side by side at the same `y`, with a 48-unit gap between them.

*Ports.* Every shape has four ports at the midpoints of its edges, rounded down to integers:

- `n` at (x + w/2, y)
- `e` at (x + w, y + h/2)
- `s` at (x + w/2, y + h)
- `w` at (x, y + h/2)

*Default port pair.* Centres are x + w/2 and y + h/2, compared without rounding.

- The target **lies to the right** when its centre x is greater than or equal to the source's centre x. It **lies below** when its centre y is greater than or equal to the source's centre y.
- The **horizontal gap** is the target's left edge minus the source's right edge when the target lies to the right; otherwise it is the source's left edge minus the target's right edge.
- The **vertical gap** is the target's top edge minus the source's bottom edge when the target lies below; otherwise it is the source's top edge minus the target's bottom edge.
- A gap is negative when the boxes overlap along that axis.
- If the horizontal gap is greater than or equal to the vertical gap, the pair is horizontal: source `e` and target `w` when the target lies to the right, otherwise source `w` and target `e`.
- Otherwise the pair is vertical: source `s` and target `n` when the target lies below, otherwise source `n` and target `s`.

*Router rules.* The server and the browser use the same routing logic, for drag previews and committed routes alike, and their results agree within the tolerances below.

1. The first point is the source port and the last point is the target port.
2. Every segment is horizontal or vertical.
3. The first and last segments leave and enter their port at right angles to that port's edge, pointing outward, for at least 12 units.
4. No segment passes within 12 units of the box of any other shape on a visible layer of the same page, and no segment crosses the inside of its own end shapes. Shapes on hidden layers are not obstacles. Shapes on locked layers that are visible are obstacles.
5. Among routes that satisfy rules 1 to 4, the router chooses one with the fewest bends, then the shortest total length. The fewest is a true minimum: no orthogonal route with integer points that satisfies rules 1 to 4 has fewer bends. For example, facing ports with a clear straight line between them give a 2-point route, and facing ports offset sideways with a clear corridor give a 4-point route.
6. If no route satisfies rule 4, the router uses the route with the fewest bends that satisfies rules 1 to 3, and the connector is **blocked**.
7. No segment of one connector lies on top of a segment of another connector on the same page for any length. Two parallel segments of different connectors whose spans overlap sit at least 8 units apart.
   - Exception: segments that start or end at the same port of the same shape may share their first or last 12 units.
   - The page's connectors are routed in id order. Each one treats the routes already fixed as extra constraints, so a connector's route depends on shape geometry, its port bindings and the routes of lower-id connectors on the page. Rule 7 is applied after rules 1 to 5 and may shift segments sideways.
   - If rule 7 cannot be met while rule 4 holds, rule 4 wins and the connector is not blocked.

*Connector labels.* A connector's label sits with its centre within 1 unit of the midpoint of its route's longest segment. When two or more segments tie for longest, the first of them along the route is used. The same placement holds on the canvas and in the SVG export.

*Rerouting.*

- After every accepted operation, the server recomputes the routes on each page the operation touched, in the same operation. Clients never send routes; a `route` key in an operation is refused under the published keys rule in API.
- The operation's **rerouted list** names every connector whose stored `route` differs before and after the operation, each id once, sorted by id. It includes:
  - connectors not bound to the moved shape whose route changed because of clearance;
  - connectors whose route changed only through separation, including higher-id connectors shifted because a lower-id one moved;
  - connectors whose route changed because a layer was hidden or shown, or because a shape and its connectors were deleted and stopped being obstacles and separation constraints.
- The list leaves out bound connectors whose route came out identical, and connectors deleted by the operation. It is `[]` when nothing changed.

*Tolerances.* These are the only geometry that checks compare:

- each route end is within 1 px of its port;
- each segment is within 0.5 px of horizontal or vertical;
- clearance from obstacles is at least 11 px;
- two parallel segments of different connectors whose spans overlap by more than 1 px are at least 7 px apart, except within the shared-port allowance;
- the bend count equals the rule 5 minimum, checked only on pages with a single connector;
- the canvas `data-points` equal the document `route`, point for point, within 1 px;
- the routes acknowledged for an unsnapped drop equal the last drag preview within 1 px, point for point;
- a connector label's position equals the label rule within 1 px;
- at 100% zoom, a shape's on-screen box equals its `data-*` box, offset by the view origin, within 1 px;
- an inserted shape's `x` and `y` equal the insertion position within 1 unit.

Exact bend positions are never checked.

*Align.* Align treats each selected group as one rigid box, the bounding box of its members, and each ungrouped selected shape as its own box. These are the **units**. Align uses the bounding box of all units, and results round down:

- left: every unit's left edge becomes the selection box's left edge;
- centre: every unit's horizontal centre becomes the selection box's centre;
- right: every unit's right edge becomes the selection box's right edge;
- top, middle and bottom: the same, applied vertically.

A group's members all move by the unit's offset, so their positions relative to each other never change. Align needs two or more units. With fewer, the menu items are disabled and the shortcuts do nothing.

*Distribute.* Distribute uses the same units and needs three or more of them.

1. Sort the units by centre (horizontal or vertical, without rounding), breaking ties by the lowest shape id in the unit.
2. The first and last units stay where they are.
3. Place the others in that order so that every gap between neighbouring unit boxes is equal. A gap is the next box's left (or top) edge minus the previous box's right (or bottom) edge, and it is negative when they overlap.
4. Each gap rounds down, with a 1 px tolerance.

*Groups.*

- A group has two or more members, all on one layer.
- A shape belongs to at most one group, and groups do not nest.
- Moving a group moves every member.
- Grouping shapes from more than one layer is refused with the cross-layer group refusal, and nothing changes.

*Layers.*

- A connector belongs to its source shape's layer at the time it is created. It is shown, routed against and exported only when its own layer and both end shapes' layers are visible.
- Shapes on a locked layer cannot be selected, moved, edited, deleted or used as a connect target, by any input. Each attempt announces the locked notice. Focus can still reach a locked shape so its name can be read.
- These operations answer 409 `layer_locked`, and nothing changes:
  - `add_shape` whose `layer` is locked;
  - `update_shape`, or any `update_shapes` entry, that names a shape on a locked layer or sets `layer` to a locked layer;
  - `delete_shape` of a shape on a locked layer;
  - `add_connector` whose `from` or `to` shape is on a locked layer;
  - `delete_connector` of a connector whose own layer is locked, or whose `from` or `to` shape is on a locked layer.
- A `delete_shape` of an unlocked shape still removes every connector bound to it, including connectors whose other end is on a locked layer.
- Changing a shape's layer moves its whole group with it.

*Reordering pages and layers.* Moving a page or layer one place renumbers `order` for every page, or every layer on that page. The new order reaches other open sessions within 1 second. When two people reorder at once, both moves apply in `seq` order.

**Text safety.** Diagram titles and display names are stored exactly as entered. They may not contain CR, LF, any other character from U+0000 to U+001F, or U+007F.

- Such a value answers 422 `invalid`, and nothing is saved. The `fields` key is the value's dotted path from the root of the request body, as for every validation error:
  - `title` for a new diagram;
  - `name` for sign-up;
  - `diagrams.<i>.title` and `users.<i>.name` for the grading seed, where `<i>` is the item's position in its list counted from 0. For example, `diagrams.0.title` or `users.0.name`.
- This applies to sign-up, new diagram and the grading seed.
- Email headers (From, To and Subject) are built only from validated values.

**Working together.**

*Operations and order.*

- Operations on one diagram that arrive at the same time, over HTTP or the socket, are applied one at a time. Each accepted operation gets the next `seq`. Accepted operations have distinct, consecutive `seq` values with no gaps and no repeats: after k operations are accepted, the document `seq` equals its earlier value plus k. A refused operation takes no `seq`.
- The server broadcasts each accepted operation to every open session on the diagram. Sessions receive them in `seq` order, show them within 1 second and end with identical document state.
- **Field-level merge.** An operation changes only the fields it names. Concurrent operations that set different fields of one shape both survive; for example, one person's `x` and another's `label` sent with the same `baseSeq` give a shape with both.

*Repeated operation ids.*

- `opId` uniqueness is per person per diagram. Two people using the same `opId` both apply.
- Two copies are the same when their `op` objects are equal; `baseSeq` is not compared.
- If the server has already accepted an `opId` from the same person, a copy returns the original response (200, same `seq`, same `ids`, same `rerouted`) and is never applied twice. This holds when the copies arrive at the same time: exactly one applies, and every copy answers with an identical body.
- A copy with a different `op` answers 409 `op_conflict`. When copies with different bodies arrive at the same time, exactly one is accepted and every other answers 409 `op_conflict`.

*Same field changed by two people.* The highest `seq` wins on every screen. When an accepted operation sets a field and a later operation by another person sets the same field, the earlier operation's author sees the replaced notice once, naming the author of the next operation that set that field.

*Refusals.*

- An edit to a deleted shape or connector is refused with 409 `shape_deleted` or `connector_deleted`. The sender's screen rolls it back and shows the deleted notice.
- An edit sent by someone who no longer has edit rights is refused with 403. Their screen rolls it back and shows the role notice.
- A refused change never appears as saved.

*Deleting.*

- `delete_shape`, or a multi-selection delete over the socket, removes the shapes and every connector bound to them in one operation. Within 1 second of the broadcast, every session's canvas, outline and page counts lose the shape, its connectors, its pins and any port dots. Exports requested after the delete leave them out.
- Connectors that had kept clear of the deleted shape, or had been separated from its connectors, reroute in the same operation and are in its rerouted list.
- After deletion, `update_shape`, `update_shapes` and `add_connector` naming the shape, and new comments on it, answer 409 `shape_deleted`. `delete_connector` on a connector removed this way answers 409 `connector_deleted`.
- The deleted shape's comments stay, with `anchored: false` and no pin.

*Undo.*

- Each person has their own undo and redo stack, holding only their own operations. One user action is one entry, so one Ctrl+Z reverts every shape of a multi-shape move, nudge, align, distribute or multi-selection commit.
- An undo or redo is sent as a new operation that everyone sees.
- If someone else changed a field that the undo would restore after the operation being undone, the undo is skipped: the entry is dropped from the stack, nothing changes, and the can't-undo notice names that person and the first such shape.
- **Undo of a delete** brings back each shape with its original id, `z`, layer and label; every connector the delete removed, with its original id and port bindings (routes are derived again); and its group membership. A group that dissolved because of the delete comes back with its original `g_` id. The shape's comments become `anchored: true` and their pins return on every session. If someone else has since locked the shape's layer, the undo is skipped under the rule above.

*Presence.* Presence counts people, not sockets.

- A person is connected while they have at least one open socket on the diagram. Every other connected person sees exactly one avatar and at most one cursor for them, however many tabs they have open. The cursor follows whichever of their tabs moved most recently.
- The avatar reads `<name>, editing` for an owner or editor and `<name>, viewing` for a viewer. It follows a role change within 2 seconds.
- Others hear the joined notice once, when the person's first socket on the diagram opens. More tabs announce nothing.
- Cursor updates are sent at most once every 50 milliseconds of page time and appear on other screens within 1 second.
- When a person's last socket on the diagram closes, their cursor and avatar leave every other screen within 2 seconds.
- The server checks liveness with WebSocket-level pings, never with page timers. It drops a socket that has not answered for `PRESENCE_TIMEOUT_MS`. When that was the person's last socket, every client removes their cursor and avatar.

*Offline.*

- Once the socket has been unreachable for 3 seconds of page time, the offline banner appears. It shows the live count of changes waiting in the local queue.
- Edits keep working on the canvas and are queued in the browser's local storage. The queue and the count survive a reload during the outage.
- The client retries every 2 seconds of page time.
- On reconnect, the client replays the queue in order with the original `opId`s. Each change is accepted exactly once, or refused and rolled back with its notice.
- Once the queue is empty, the saved banner shows for 3 seconds of page time and then goes away.

**Sessions.**

- `POST /api/auth/signout`, sent from any tab, deletes that session. Every socket opened with it closes with 4401 within 1 second. Other sessions of the same person are untouched.
- When a workspace's socket closes with 4401, or any of its API calls answers 401:
  - it stays on the diagram and keeps the local queue;
  - `status "Connection"` shows the session-ended banner instead of the offline banner;
  - it opens `dialog "Sign in to continue"`;
  - it stops retrying the socket until the person signs in.
- Edits made while the session is ended keep working on the canvas and are queued and counted the same way as offline edits.
- A comment being posted at that moment stays in the composer unchanged.
- A wrong password shows the sign-in error inside the dialog.
- After a successful sign-in, the dialog closes and focus returns as described in Interactions. The socket reconnects, and the queue replays under the offline replay rule, followed by the saved banner.

**Roles and invites.**

*Roles.* Each diagram has one `owner` and any number of `editor` and `viewer` members.

- Only the owner can invite, resend, revoke, change roles, remove members and restore versions.
- Owners and editors can edit, save versions and export.
- Every member can read, preview versions, comment and download exports.
- Viewers can focus and select shapes, but nothing they do changes the document.
- The owner's own role cannot change and the owner cannot be removed; both attempts answer 409 `owner_role`.

*Role changes.* A role change applies on the server to the person's very next operation. Their open session reflects it within 2 seconds: tools appear or disappear, the view-only banner appears or disappears, and focus stays on the canvas.

*Invite states.* An invite moves `saved` → `emailed` or `email_not_sent` → `accepted`, `revoked` or `expired`.

- Creating an invite saves it and then tries to send the email. The invite becomes `emailed` when the mail server accepts the message, and `email_not_sent` otherwise.
- **Open and expired.** An invite is open while less than `INVITE_TTL_MS` milliseconds have passed since it was last created or resent. Once exactly `INVITE_TTL_MS` has passed, it is `expired`. The server judges this on its own clock at every read and every acceptance attempt.
- **Acceptance.** An open invite becomes `accepted` when a person signs up or signs in with the invited email (compared without case). They become an `active` member with the invite's role.
  - Signing up or in with an expired invite's email creates the account or the session, but adds no membership, so the diagram answers 404 for that person.
- **Resend** is allowed from `emailed`, `email_not_sent` and `expired`. It sets a fresh expiry and sends again, setting the status the same way as creation does.
- **Delete** from `emailed`, `email_not_sent` or `expired` makes the invite `revoked`. Revoked invites leave the members response.
- Resend or delete on an `accepted` or `revoked` invite answers 409 `invite_closed`.
- Inviting an existing member answers 409 `already_member`.
- Inviting an email that has an open invite answers 409 `already_invited`. Inviting an email whose invite has expired answers 201, and the new invite replaces the expired one.
- **Member list display.** `active` shows as `Active`, `emailed` as `Invited`, `email_not_sent` as `Email not sent` and `expired` as `Expired`. An open Share dialog shows an invite turning `Expired` within 2 seconds of the server's expiry.

**Comments.**

- A comment anchors to a shape. Its pin sits at the shape's top-right corner and moves with the shape. Only top-level threads have pins.
- New comments, replies and resolves reach other open sessions within 1 second.
- Deleting a shape keeps its comments unanchored, as described under Deleting. Any operation that brings the shape back sets `anchored: true`, and the pin returns. Restores follow the anchoring rule under Versions.
- **Mentions.** A mention is `@` followed by the longest run of letters, digits and the characters `.`, `_`, `%`, `+`, `-` and `@`, with a trailing `.` dropped. Any other character, such as a comma or a space, ends it. It mentions a member only when it equals that member's email, compared without case. For example, `@ada@linewell.test,bea@x.test` mentions only Ada.
- Each mentioned member other than the author gets exactly one mention email per comment. Text that is not a member's mention stays plain text.
- Resolving a thread removes its pin from every screen and moves the thread under the resolved heading. Resolving it again answers 409 `already_resolved`.

**Versions.**

*Display name.* Versions are numbered from 1 upward per diagram. The display name is the version's name, or `Version <number>` when it has none.

*When versions are cut:*

- **Automatically**, by the server's own timer, `VERSION_INTERVAL_MS` after the first accepted operation not yet covered by a version (within 1 second after), even if no later operation arrives.
  - An automatic version has `name: null`. Its author is the person whose operation started the interval, and its `seq` is the document `seq` at the moment of the cut.
  - An idle diagram gets no version.
- **On Save version**, with an optional name.
- **On every restore**, named `Restored <display name of the restored version>`.

A version covers every operation up to its `seq`. A version cut by Save version or by a restore therefore resets the interval.

*History list.* Open History lists show a new version within 2 seconds, without a reload. Each item reads `<display name> · <author name> · <d Mon yyyy, HH:mm> UTC`, for example `Version 3 · Ada Lindqvist · 31 Oct 2026, 14:05 UTC`.

*Preview.*

- Choosing a version pushes `/d/<diagramId>?page=<pageId>&version=<versionId>`.
- A reload of that address, or a direct visit to it, opens the same read-only preview with the preview banner. Editing tools are disabled and the canvas shows that version's document.
- Browser Back and Forward move between the preview and the latest document.
- If the `page` is not in the previewed version, the client falls back to that version's first page and replaces the address with one that names it.
- A `version` that does not belong to the diagram gives the not-found rule.

*Restore.*

- A restore makes the current document equal the version's document in everything except `seq`: pages, layers, groups, z order, ids, port bindings and labels. Routes come out identical because they are derived.
- **Anchoring rule.** A restore sets each comment's `anchored` from the restored document: `true` when its shape exists there and `false` otherwise.
- The restorer's Ctrl+Z undoes the restore as one operation, under the undo rule. The undo puts back the earlier document and the earlier `anchored` values.
- A restore and its undo never delete comments and never change `resolved`. Pins appear or disappear to match on every session within 2 seconds.
- The restore reaches every open session within 2 seconds, and each one announces the restored notice. The undo of a restore cuts no version itself.

**Exports.**

*States.* An export moves `rendering` → `ready` or `storage_unavailable`, and back to `rendering` on retry.

- An export starts as `rendering`.
- It becomes `ready` only after the server has written the file and object storage confirms that the object exists.
- If storage cannot be reached within 10 seconds, it becomes `storage_unavailable`.
- Retry moves `storage_unavailable` back to `rendering`. The move is guarded: of any number of retries arriving at the same time, exactly one answers 202 and the others answer 409 `export_not_retryable`, because the export is then `rendering`.
- `ready` is final. Retry from any state other than `storage_unavailable` answers 409 `export_not_retryable`.

*One export per request.* A request from a person who already has a `rendering` export with the same `page`, `format`, `scale` and `background`, requested at the current document `seq`, answers 200 with that export instead of creating another. Only one record exists, only one object is written, and `Export ready.` is announced once.

*Snapshot.* Every export records the document `seq` at the moment it was requested. The file renders the document as it was at that `seq`: anything accepted after the request never appears in it, however late the render finishes, and a retry renders the same snapshot.

*What sessions see.*

- Rendering runs on the server and never depends on the dialog or the requesting tab staying open.
- The requesting session shows the ready text and the download link only when the status is `ready`, within 2 seconds of the object existing.
- Every other open session on the diagram, viewers included, shows or refreshes `link "Download latest export"` within 2 seconds of `ready`, with no reload.
- Sessions learn of status changes over the socket.

*Required SVG properties:*

- `Content-Type: image/svg+xml`, and the file is well-formed XML.
- The root `<svg>` carries `data-seq="<seq>"`, the export's recorded `seq`, and a `viewBox` equal to the bounding box of the page's visible shapes and connector routes at that `seq`, expanded by 24 on every side.
- It contains one `<g id="shape-<id>">` per shape on a visible layer, and one `<g id="connector-<id>">` per connector shown under the layer rule, with routes equal to the document's routes at that `seq`.
- Each non-empty shape label appears as a `<text>` inside its shape's group, and each non-empty connector label as a `<text class="connector-label">` inside its connector's group, placed by the label rule.
- Every label is the exact text content of its `<text>`, including the characters `<`, `>`, `&` and `"`. No element or attribute ever comes from label text.
- It contains nothing from hidden layers, and no comment pins or comment text, cursors, selection handles, port dots or lock icons.

*Required PNG properties:*

- `Content-Type: image/png` and a valid PNG signature.
- Width and height equal the viewBox width and height times the scale, within 1 px.
- An alpha channel when the background is Transparent.
- Only what the SVG of the same snapshot would contain.

### Services (DP-34, DP-41, DP-45, DP-46, DP-49, DP-56, DP-62, DP-69)

**Postgres** holds the source of truth: accounts, sessions, diagrams, documents, every accepted operation with its `seq` and `opId`, members, invites with their last create or resend time, comments, versions and export records with their snapshot `seq`. Reconnecting clients replay against this order.

**MinIO** (object storage) holds rendered exports under the key `exports/<diagramId>/<exportId>.<png|svg>`, one object per export, with the matching content type.

- When storage is unreachable, exports end `storage_unavailable` with the export paused banner. Every other feature keeps working: editing, comments, versions and invites.
- Each export and each retry opens a fresh attempt, so exports work again as soon as storage is back, with no restart.

**Mailpit** (mail catcher) receives mail over SMTP from the `MAIL_FROM` address. Every message has exactly one recipient and a single-line subject.

- **Invites.** Each invite or resend sends one message, to the invitee only, with the invite email subject.
  - The body names the inviter, the diagram title and the role, and links to `<APP_PUBLIC_URL>/d/<diagramId>`.
  - There is no token link. The invitee signs in or signs up with the invited address, and the sign-in redirect from Screens and layout brings them back to the diagram.
  - The invite email never contains shape labels, layer or page names, comment text or any picture of the diagram.
- **Mentions.** Each mention sends one message, to the mentioned member only, with the mention email subject. It contains the commenter's name, the diagram title, the shape label, the comment text and the same link.
- **When mail is unreachable**, invites are saved as `email_not_sent` and the Share dialog shows the mail outage banner. Mention emails are skipped, and the comment is still posted.
- Each send and resend opens a fresh connection, so resend works as soon as mail is back, with no restart.

### Seed data (DP-58)

Linewell starts with no people and no diagrams. Every check creates its own records through the grading seed route. The examples in this brief use these invented people:

| Name | Email | Password |
|---|---|---|
| Ada Lindqvist | `ada@linewell.test` | `drafting-ada-01` |
| Bea Okafor | `bea@linewell.test` | `drafting-bea-02` |
| Cy Moreau | `cy@linewell.test` | `drafting-cy-03` |

The examples also use an invented diagram, "Pipeline":

- page "Main", with layers "Base", "Notes" and "Walls";
- rectangles "Intake", "Review", "Archive", "Log" and "Store".

Every seeded person and diagram is invented.

## Technical requirements

### Deployment (DP-56)

A current Node.js LTS runtime with npm is available. Put `/app/run.json` at the app root, with the string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. HTTP and the live socket share that port.
- `GET /api/health` is the health route.
- On every serve, the server applies its database schema idempotently, so it starts against either an empty or an existing database. Two instances starting against the same database at once must both succeed.
- The server's version and invite timers survive a restart: any version that is due gets cut once the server is back.

### Configuration and secrets (DP-59)

Read these variables at start:

- Postgres: `DATABASE_URL`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Mailpit: `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`.
- `MAIL_FROM`: the From line, `Linewell <hello@linewell.test>`.
- `APP_PUBLIC_URL`: the base of links in emails.
- `GRADING_ROUTES`: `on` enables the grading routes. Anything else, including unset, disables them.
- `PRESENCE_TIMEOUT_MS`: milliseconds; default 30000. The checker sets 4000.
- `VERSION_INTERVAL_MS`: milliseconds; default 300000. The checker sets 6000.
- `INVITE_TTL_MS`: milliseconds; default 604800000 (7 days). The checker keeps the default on its main instance. It also starts a separate **invite-lifetime copy** of the app with `INVITE_TTL_MS` set to 8000, its own empty database and its own empty bucket, and checks invite expiry and Journey 1 there.

Never hard-code a credential or a service address, and never send any of these values to the browser.

### Server boundary (DP-56, DP-57)

- **Same origin only.** A state-changing request whose `Origin` header is present and differs from the app's own origin answers 403 `cross_origin`. A socket upgrade from another origin is refused.
- **Body limits** are stated in API.
- **What the server never serves.** Source files, source maps of server code, environment files, package manifests, lockfiles and credentials all answer 404. The server serves only the built client, the self-hosted fonts and the routes in this brief.
- **Unreachable services.** If MinIO or Mailpit is unreachable when the server starts, it still starts. Health answers ok, and people can sign up, sign in and edit. Exports and email recover when the service returns, as described in Services.

### Browser support and performance (DP-50, DP-51)

- Linewell supports current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, with mouse, keyboard and touch.
- A diagram page with 200 shapes and 200 connectors is usable within 3 seconds of navigation.
- While a shape with 20 connectors is dragged, the preview reroute keeps up with every animation frame.
- The fonts (Instrument Serif, IBM Plex Sans and IBM Plex Mono) are self-hosted files. Icons are inline line icons from the Lucide icon set. Nothing loads from another origin at runtime.

### How Linewell is checked

- **Clock and timers.** The checker pauses the page clock and blocks service workers. Every client timer, animation and delay must run on page timers and animation frames, so advancing the page clock drives them. Motion that checks read is driven frame by frame and never depends on a CSS animation finishing. After each pointer or keyboard action, checks advance the page clock by 50 milliseconds, or by the stated duration, before reading the page. During a drag, checks hold the pointer still and advance the clock by one frame before reading previews.
- **Server timers.** Server-side durations (presence, version interval and invite lifetime) run on the server's real clock at the checker's values from Configuration.
- **Concurrency.** Checks send operations, export requests and retries in parallel from several people, and compare the resulting `seq` values, documents and responses.
- **Routing.** Checks compare bend counts with their own minimum on small published-style fixtures, and diff the document routes before and after an operation against its rerouted list.
- **Saved state** is read only through the published API and the document format, never through the database.
- **Export files** are checked only for the required properties in Business rules, never byte for byte or pixel by pixel.
- **Extra copies.** The checker also runs one copy of the app with object storage unreachable, one with mail unreachable, and the invite-lifetime copy described in Configuration.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and running those three commands in order from `/app` starts the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at the app root lists every shipped package and every bundled font with its licence. Shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- IF-03: Every shipped package and bundled asset is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, or OFL-1.1 for fonts.
- IF-04: The app uses only Postgres, MinIO and Mailpit as services: no other datastore, cache, queue or external API.
- IF-05: All app source is TypeScript, for both the server and the browser client.
- IF-06: The page loads no script, style, font or image from another origin, and the app registers no service worker.
- IF-07: The provided development service configuration (the compose files and their credentials) is left unchanged.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, and its names match the domain terms in this brief: shape, connector, port, route, layer, page, group, operation, rerouted list, version, invite, export, snapshot and session.
- Each domain rule is decided in exactly one place in the source, and the server and the browser share that one decision. This covers the router rules (separation included), drag previews, label placement, the rerouted list, snapping and resize anchoring, port positions, the insertion position, align and distribute units, the published keys of each operation, the text safety rule, the invite, export and session state transitions, export deduplication, invite expiry, the version timer, role checks and the error precedence.
- Sequence allocation, operation-id deduplication and the export retry transition are each decided atomically in one place, so concurrent requests cannot interleave them.
- Every API error is built through one consistent error shape; no route makes up its own.
- There is no abstraction with only one implementation, and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the types already rule out.
- Service credentials and addresses come only from the environment and stay on the server.
- There are no features beyond this brief.
