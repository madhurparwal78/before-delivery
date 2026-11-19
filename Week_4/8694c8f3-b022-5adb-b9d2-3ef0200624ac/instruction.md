# Quillbeam Works Afterglass

Afterglass is a browser studio where one independent VJ builds a real-time 3D shader set. A set has a layer tree, transform gizmos, GLSL layers, a node graph, a beat-locked timeline, sandboxed scripts and uploaded GLB models and textures. The owner can invite a guest VJ to co-edit live before a back-to-back night. The owner publishes an immutable show version, and the venue's house computer opens it as a show link. If a late edit breaks the look, the owner rolls the show back in one action. The server uses PostgreSQL for accounts, sets, the op log, version history, show versions and the activity log. It uses MinIO object storage for uploaded models and textures, frozen show bundles and export zips. It uses Valkey for live collaboration: presence, layer lock leases and the fan-out of committed ops. Out of scope: payments, email delivery, password reset, video or audio file playback, MIDI or OSC hardware input, multi-screen projection mapping, and any datastore besides these three services.

## Problem and users

Working VJs build sets in desktop tools that are licensed per computer, so the whole show lives on one laptop. The usual answer to "what is my plan B" is a second laptop running the identical show, and most VJs cannot afford one or carry it. Failures happen at the venue. Bass vibration crashes the laptop. The house PC has the wrong version installed. The venue Wi-Fi drops during a back-to-back set with a guest VJ. A shader tweak 20 minutes before doors ruins the look, and the previous version is gone. Browser live-coding tools solve the install problem, but they have no scene, timeline, assets, versions or publishing. Afterglass keeps the set in the browser, keeps every version, and lets any screen in the room play a pinned show.

- **VJ (set owner)**, daily. Builds and rehearses a beat-locked 3D shader set, publishes a pinned show version for tonight's venue, and rolls back if a late edit breaks the look. Often works from the keyboard in a dark booth.
- **Guest VJ (editor)**, weekly. Co-edits the owner's set live before a back-to-back night. Takes layer locks without overwriting the owner's work, even on bad venue Wi-Fi.
- **Venue tech (viewer)**, occasional. Opens the published show link on the house computer, confirms which version is live, and reads the set without being able to change it.

## Journeys

1. **First rehearsal.** A new visitor lands on the public page, where the booth dialog sits over the demo set. They press Play on the beat transport and watch the demo run, then create an account. They land in an empty workspace and create a set from the 'Blank stage' starter, which shows the starting layer tree. They add a tube and two cubes, parent the cubes under a group, and move, rotate and scale them with the gizmos under grid and angle snap. They select the tube, drag its Twist scrub field while the stage twists live, release to save, and press the keyframe dot to place a key on the nearest quarter beat. End state: the Autosave region reads the saved copy and the timeline shows the key diamond with its bars:beats readout.
2. **Assets and shaders.** Starting from that set, the owner uploads a GLB model and a PNG texture and waits until both rows read ready. They bind the model to a model layer and the texture to the tube's albedo slot, and the asset shelf shows each asset's dependents count. They write a GLSL layer with a typo, read the line-numbered error in the gutter and the live region, fix it and save three versions. Then they restore version 1. End state: the history lists the new latest version marked as restored from version 1, and the stage draws it.
3. **Beat-driven motion.** In the node graph the owner wires Beat clock to LFO to Remap to a Layer property node targeting the tube's twist, connecting the last wire from the keyboard through the port picker. They press Play and the tube twists on every frame. They write a script with onBeat(ctx) that pulses a cube's scale, and register a custom plugin node from a second script. A third script throws, and the error appears in the Console while the stage keeps drawing. They change the BPM from 120 to 140. End state: every key stays on its bar:beat and only the seconds change.
4. **Back-to-back prep.** The owner invites a guest VJ through an editor invite link. The guest joins, and both see each other in the presence list with cursor colours and selected layers. The guest takes the lock on the tube, and the owner's tree shows the lock icon. The owner then tries to take the same lock and is told who holds it. The guest edits a value with a stale base version and gets the conflict dialog. They choose Reapply mine. End state: both viewports show the same committed value, and the lock frees when released or 30 seconds after the guest's browser stops renewing it.
5. **Venue Wi-Fi drops.** The guest loses the connection mid-edit. A banner shows the live count of changes waiting to sync while they keep editing. When the connection returns, the queue replays in order and the guest catches up on the owner's edits. End state: every queued change is applied exactly once and the reconnect toast appears.
6. **Show night.** The owner publishes version 1. On the house computer the venue tech opens the show link, which plays the set and shows version 1 with its sha256. The owner keeps editing, publishes a broken version 2, and the open show tab switches to it. The owner presses Roll back. End state: the show link serves version 1 again, byte for byte.
7. **Moving to another machine.** The owner exports the set, downloads the zip, and checks its sha256 against the stored export. They import the zip as a new set. End state: the new set opens with the same layer tree, keys, graph, scripts, shaders and assets.
8. **A bad night for services.** With object storage unreachable, uploads, publishing and exports pause behind an honest banner while editing goes on, and the live show keeps its version. With live collaboration offline, no new lock can be taken, but edits still commit and reach the other editor. Afterwards the owner reads the activity log of who changed, published and rolled back what.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Account sign-up and sign-in** Visitors create an account with email, password and display name, sign in and out with a session cookie, and get the exact validation and credential errors listed in API.
- **DP-02 — Blank stage starter** A new account lands in an empty workspace, and creating a set from the 'Blank stage' starter shows the starting layer tree listed in Seed data.
- **DP-03 — Public demo stage** The public '/' shows the booth dialog over the shell running the 'Low Tide Tunnel' demo, which plays from the beat transport without an account.
- **DP-04 — Gapless op log** Every committed edit to a set is one op that gets the next gapless sequence number and its target's version bump, committed together, and the ops can be read back in order.
- **DP-05 — Build the stage with gizmos** The VJ adds primitives and moves, rotates and scales them with gizmos under grid and angle snapping, and every committed change survives a reload.
- **DP-06 — Layer parenting** Layers can be reparented in the layer tree by drag or keyboard, and a move that would make a layer its own ancestor is refused with 422.
- **DP-07 — Cameras and the active camera** Camera layers carry field of view and near and far planes within the ranges in Business rules, and the stage draws through the set's active camera.
- **DP-08 — Keyboard layer tree** Arrow keys walk, expand and collapse the layer tree, and the focused row is the selected layer, so no pointer is needed.
- **DP-09 — Provider-confirmed asset upload** An uploaded GLB or texture becomes 'ready' only after object storage confirms its bytes, and a failed store leaves it 'upload failed' and unusable.
- **DP-10 — Bind models and textures** The VJ uploads a GLB and a texture, binds them to a model layer and a material texture slot, and sees the model drawn and the texture name in the slot.
- **DP-11 — Dependents count** Each asset's dependents count equals the number of live layers, materials and scripts that reference it, recomputed after every committed edit.
- **DP-12 — Guarded asset delete** Deleting an asset that has dependents or appears in a published show version is refused with 409 listing the dependents or the show versions, and any other asset, including one whose upload failed, is removed from the shelf and from object storage.
- **DP-13 — Assets stored as uploaded** Asset bytes in object storage and from the content endpoint are byte-identical to the uploaded file and match the sha256 the API reports.
- **DP-14 — Shader compile feedback** Saving a GLSL layer compiles it in the browser, marks error lines in the editor gutter and announces 'Compiled' or the first error line, while the stage keeps the last good program.
- **DP-15 — Shader version history** Every shader save creates the next numbered version with its sha256, author and time, listed newest first in the shader history.
- **DP-16 — Byte-exact shader restore** Restoring shader version N creates a new latest version whose source is byte-identical to N and leaves earlier history unchanged.
- **DP-17 — Shader editing journey** The VJ writes a broken shader, reads the line-numbered error, fixes it, saves several versions and restores an older one onto the stage.
- **DP-18 — Live node graph** A Beat clock to LFO to Remap to Layer property chain drives that property on every drawn frame while the transport plays.
- **DP-19 — Keyboard wire picker** A node-graph wire can be connected entirely from the keyboard through the 'Connect wire' dialog's port lists.
- **DP-20 — Graph wiring rules** The server refuses wires that start from an input or end at an output, fill an occupied input or close a cycle, with the 422 codes in Business rules.
- **DP-21 — Beat-locked keys** Keys are stored in ticks of 96 per beat, snap to the nearest quarter beat at the playhead, and show bars:beats with seconds at the set BPM.
- **DP-22 — BPM change keeps bars and beats** Changing the set's BPM keeps every key on the same bar:beat and recomputes only the seconds shown.
- **DP-23 — Scrub to the beat** The VJ selects a layer, drags a scrub field while the stage redraws each frame, commits on release, and keys the value onto the beat timeline.
- **DP-24 — Scrub field input** Scrub fields change by 0.1 per pixel dragged or per arrow press, and by 0.01 with Shift, except the BPM field as qualified in Interactions; Enter commits and Escape reverts.
- **DP-25 — Sandboxed beat scripts** A script's onBeat(ctx) runs once per beat while the transport plays, isolated from the page and the network, and can set layer properties on the stage.
- **DP-26 — Script errors keep the stage running** A script that throws or runs too long is stopped and reported in the Console tab and a live region while the stage keeps drawing.
- **DP-27 — Custom plugin nodes** A script that registers a node makes it appear in the node graph's Add node list, and wiring it drives a layer just like a built-in node.
- **DP-28 — Capability invite links** The owner creates a single-use editor or viewer invite link, and the signed-in guest who accepts it joins the set with that role.
- **DP-29 — Role permissions** Editors may edit, viewers reach no write endpoint (403), and only the owner invites, publishes, rolls back, deletes assets and force-releases locks.
- **DP-30 — Presence and selection** Every editor open in a set sees each other editor's name, cursor colour and selected layer, updated within two seconds.
- **DP-31 — Server-clock lock leases** Layer locks are granted, renewed and expired by the server clock with a 30-second lease, and the lock icon follows only server lock events, whatever the device clock says.
- **DP-32 — Co-editing under locks** The guest VJ takes a layer lock and edits that layer while the owner sees the lock icon and the committed values, then releases the lock.
- **DP-33 — One lock winner** When several lock requests for one layer arrive at once, exactly one is granted and every other gets 409 naming the holder.
- **DP-34 — Stale writes refused** A write whose base version is older than its target's current version is refused with 409 and never merged.
- **DP-35 — Conflict dialog** A refused stale edit opens the 'Someone changed this layer first' dialog, where Keep theirs discards the edit and Reapply mine commits it on the current version.
- **DP-36 — Exactly-once ops** A replayed client op id returns the original response without applying the op again, and reusing an id for a different op is refused.
- **DP-37 — Offline queue banner** While offline, edits queue in the browser and the banner shows the live count of changes waiting to sync.
- **DP-38 — Reconnect and replay** When the connection returns, the browser replays its queue in order and catches up on missed ops, and every queued op is applied exactly once.
- **DP-39 — Immutable show versions** Publishing freezes the working set into a bundle in object storage and makes it live only after storage confirms it, and the bundle's bytes and sha256 never change.
- **DP-40 — Venue show link** The show link plays the live version without sign-in, shows its version number and sha256, serves the exact stored bundle, and exposes no members, emails or unpublished versions.
- **DP-41 — One-action rollback** Rolling back atomically re-points the show link to the previous published version, which serves the same bytes it served when first published.
- **DP-42 — Publish and roll back at the venue** The owner publishes, the venue tech's open show link switches to the new version, a broken publish is rolled back, and the show link returns to the good version.
- **DP-43 — Byte-identical export** Exporting a set stores a zip in object storage whose download is byte-identical to the stored object and matches the reported sha256.
- **DP-44 — Import as a new set** Importing an exported zip stores the upload byte for byte and creates a new set with the same layer tree, keys, graph, scripts, shaders and assets.
- **DP-45 — Export and import journey** The VJ exports a set, downloads the zip, imports it, and opens the new set with the same scene.
- **DP-46 — Asset storage outage** With object storage unreachable, uploads, publishing and export return 503 with the storage banner, the live show keeps its version, and editing continues.
- **DP-47 — Live collaboration outage** With Valkey unreachable, lock requests return 503 with the collaboration banner, edits still commit to the op log, and other editors catch up within five seconds.
- **DP-48 — Activity log** Every committed op, publish, rollback, activation, asset upload or delete, member join, lock force-release, export and import appears in the set's activity log with who, what and when.
- **DP-49 — Degraded night journey** The VJ works through a storage outage and a collaboration outage, sees honest banners and refusals, and reviews the activity log afterwards.
- **DP-50 — Run manifest and health** The app installs, builds and serves from /app/run.json on port 4173 (or APP_PUBLIC_PORT) and answers the health check.
- **DP-51 — Credentials from the environment** Every service URL and credential is read from the environment at start and is never hard-coded or sent to the browser.
- **DP-52 — Server boundary** The server is same-origin, enforces the body size limits, never serves source files or credentials, and follows the stated order of errors.
- **DP-53 — Responsive shell** At 1024 pixels wide and above, the fixed shell fills the window with no document scroll; below that it collapses to a drawer and a bottom icon row, with no horizontal overflow at any width.
- **DP-54 — Keyboard dialogs and shortcuts** Every dialog keeps Tab inside itself, closes on Escape and returns focus to its opener, and the published shortcuts work whichever control in their region has focus.
- **DP-55 — Autosave announcements** Edits commit on release, on blur or after two seconds idle, and the Autosave live region announces the save state with the exact copy.
- **DP-56 — Booth-dark look** Every screen uses the booth-dark palette, the Arimo and PT Sans typefaces, dense rows and the blue value numerals described in Visual design.
- **DP-57 — Shell composition** The workbench dock, set menubar, stage viewport, rig panel and beat timeline dock are arranged as Visual design describes, with the booth dialog on the public page.
- **DP-58 — Motion and reduced motion** Hover fills, drawer collapse and the stage loop follow the timings in Motion and effects, nothing moves while idle, and reduced motion gives the instant substitute.
- **DP-59 — Real stage rendering** Real WebGL draws the stage, shaders, node-graph output and timeline playback from the committed set state, not images or faked values.

## Frontend

### Screens and layout (DP-02, DP-03, DP-40, DP-53, DP-57)

- **Public page '/'.** The full editor shell runs the procedural demo set 'Low Tide Tunnel': a tube ringed by shader bands, with a field of 24 cubes orbiting it, at 120 BPM. The booth dialog sits centred over it with the sign-in and create-account links. Closing the dialog leaves the demo shell usable: the visitor can play, select layers and scrub. Demo edits stay in the page and are never saved.
- **Sign-in and create-account.** These are forms inside the booth dialog, built from inspector rows. The dialog does not navigate away from the demo shell.
- **Workspace.** The editor shell with no set open. The rig panel lists the user's sets as tree-style rows, including sets they joined as a guest, each with their role. The stage shows the empty-state headline and a single New set row button.
- **Set editor.** The working screen, with these regions:
  - **Workbench dock** on the left: a column of seven icon tiles with captions (Layers, Assets, Shaders, Graph, Scripts, Shows, Activity). Layers, Assets, Shows and Activity switch the rig panel's content. Shaders, Graph and Scripts open the matching tab in the beat timeline dock.
  - **Set menubar** along the top: text menus on the left, the beat transport in the right area, and the presence list and account menu at the far right.
  - **Stage viewport** in the centre: the black WebGL canvas, the gizmo strip down its left edge, the snap strip along its top, and the active camera's name in the top-right corner.
  - **Rig panel** on the right: a title bar and a search row. With Layers chosen, the layer tree sits above the inspector. Other choices show the asset shelf, the show versions plus Members, or the activity log. The panel scrolls internally.
  - **Beat timeline dock** along the bottom, under the stage: tabs for Timeline, Shader editor, Node graph, Script editor and Console.
  - **Banner strip** directly under the menubar. It appears only during an outage or while offline.
- **Join page '/join/<token>'.** The booth dialog names the set and the offered role and has one button to join. A visitor who is not signed in is asked to sign in first and then returns to this page.
- **Show page '/show/<token>'.** The live version plays full-window on a black ground, through its active camera, with no editing chrome. A Show info button toggles a small panel in one corner that shows the set name, the version number, the sha256 and the publish time. The page never shows members, emails or unpublished versions.

Arrangement by viewport, with no horizontal overflow at any of them:
- **1280x800 and wider (from 1024 pixels up).** A fixed shell exactly the size of the window, with no document scroll. The workbench dock is about 64 pixels wide on the left, full height. The set menubar is about 30 pixels tall and spans from the dock to the rig panel. The rig panel is about 300 pixels wide on the right, full height. The beat timeline dock takes roughly the bottom 29% of the height between the dock and the rig panel. The stage fills the rest. Panels are separated by narrow gutters of the ground colour.
- **768x1024 and 375x812 (below 1024 pixels).** The menubar stays on top and may wrap the transport onto a second line. The stage takes the upper part and the beat timeline dock sits below it. The workbench dock becomes a row of icon tiles along the bottom edge. The rig panel becomes a full-width drawer that slides over the stage and is opened and closed with the Rig panel button. Every control is at least 44 pixels in both directions at these widths. The document never scrolls; panels scroll internally.

### Public screens and controls (DP-01, DP-03, DP-08, DP-10, DP-14, DP-19, DP-23, DP-24, DP-28, DP-30, DP-35, DP-37, DP-40, DP-41)

Only these roles and names are public; everything else is free. `<…>` is filled from the record shown.

| Region or control | Role and accessible name | Visible copy or content |
|---|---|---|
| Booth dialog | `dialog "Afterglass"` | Title 'Afterglass', body 'Build the set in a browser. Play it on any screen in the room.', links 'Sign in' and 'Create account', `button "Close"` |
| Sign-in form | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| Create-account form | `textbox "Email"`, `textbox "Password"`, `textbox "Display name"`, `button "Create account"` | |
| Set menubar | `menubar "Set menu"` with `menuitem` entries 'Set', 'Edit', 'Add', 'Stage', 'Timeline', 'Share', 'Help' | The Add menu has items 'Group', 'Cube', 'Sphere', 'Plane', 'Torus', 'Tube', 'Camera', 'Light', 'Model', 'Shader layer' |
| Beat transport | `group "Beat transport"` with `button "Play"`, `button "Pause"`, `button "Step beat"`, `button "Stop"` | While playing, Play has `aria-pressed="true"` |
| Account | `button "Account"` opening a menu with `menuitem "Sign out"` | Shows the display name |
| Workbench dock | `navigation "Workbench"` with buttons 'Layers', 'Assets', 'Shaders', 'Graph', 'Scripts', 'Shows', 'Activity' | The active tile has `aria-current="true"` |
| New set | `button "New set"`, then `dialog "New set"` with `textbox "Set name"`, `radio "Blank stage"`, `button "Create set"` | |
| Stage viewport | `img "Stage viewport"` on the canvas, carrying a `data-frame` attribute and the `data-gizmo-x`, `data-gizmo-y` and `data-gizmo-z` attributes described in Interactions | `data-frame` is the count of frames drawn so far |
| Gizmo strip | `toolbar "Gizmos"` with `radio "Move"`, `radio "Rotate"`, `radio "Scale"` | |
| Snap strip | `toolbar "Snapping"` with toggle buttons `button "Grid snap"` and `button "Angle snap"` (`aria-pressed`) | |
| Active camera | `combobox "Stage camera"` | Lists camera layer names |
| Rig panel | `complementary "Rig panel"`; below 1024 pixels, `button "Rig panel"` toggles it (`aria-expanded`) | |
| Layer tree | `tree "Layers"`, rows `treeitem "<layer name>"` (`aria-selected`, `aria-expanded` on parents) | A held lock shows `img "Locked by <display name>"` in the row |
| Inspector | `region "Inspector"` with `heading` level 2 '<layer name>' | |
| Lock control | `button "Take lock"` or `button "Release lock"` in the inspector header | |
| Component drawers | `button` named 'Transform', 'Camera', 'Material', 'Shape', 'Model', 'Light', 'Outputs' with `aria-expanded` | |
| Scrub fields | `spinbutton` named by its row label: 'Position X', 'Position Y', 'Position Z', 'Rotation X', 'Rotation Y', 'Rotation Z', 'Scale X', 'Scale Y', 'Scale Z', 'Field of view', 'Near plane', 'Far plane', 'Twist', 'Radius', 'Intensity', 'Tint alpha', 'BPM' | Numerals with two or three decimals |
| Keyframe dots | `button "Keyframe <row label>"` with `aria-pressed` | |
| Tint swatch | `button "Tint"` opening `dialog "Tint"` with spinbuttons 'Red', 'Green', 'Blue' | |
| Texture slot | `group "Albedo texture"` and `group "Emissive texture"`, each with `button "Browse texture for <slot>"` and `button "Clear <slot>"`, where `<slot>` is 'Albedo' or 'Emissive'. Browse opens `dialog "Choose texture"` with `listbox "Textures"`, holding one `option` per ready texture asset named by the asset's name, and `button "Use texture"` | Placeholder 'Texture', or the bound texture's name |
| Model binding | `combobox "Model asset"` | Lists ready model assets |
| Output bus picker | `button "Choose output buses"` opening `dialog "Output buses"` with `checkbox` entries 'Main', 'Side screens', 'LED strip' | The field lists the ticked bus names, separated by commas |
| Beat timeline dock | `tablist "Workbench tabs"` with tabs 'Timeline', 'Shader editor', 'Node graph', 'Script editor', 'Console' | |
| Timeline | `region "Beat timeline"`, key diamonds `button "Key <row label> at <bar:beat>"`, playhead readout `timer "Playhead position"` | Readout '<bar:beat> <seconds> s' |
| Shader editor | `textbox "GLSL source"`, `button "Save shader"`, `list "Shader history"` whose items carry `button "Restore version <n>"` | Error lines marked in the gutter. Each history item shows 'Version <n>', the author's display name, the save time in hours and minutes in the browser's time zone, and 'Restored from version <m>' when the version's `restored_from` is `<m>` |
| Node graph | `button "Add node"` opening `menu "Node types"`; each node `button "<node title> node"`; `dialog "Connect wire"` with `listbox "From port"`, `listbox "To port"` and `button "Connect"` | |
| Script editor | `list "Scripts"`, `button "New script"`, `textbox "Script source"`, `button "Save script"`, `button "Uses assets"` opening `dialog "Script assets"` with one `checkbox "<asset name>"` per ready texture asset (models are never listed) and `button "Done"` | Done saves the script with the ticked assets as its asset list |
| Console | `log "Console"` | One line per script message |
| Asset shelf | `button "Upload asset"` with a file input named 'Choose GLB or texture file', `list "Asset shelf"`, each row '<name>', '<status>', '<n> dependents', with `button "Delete <asset name>"` | |
| Asset in use | `alertdialog "Asset still in use"` | Lists the dependents or the show versions; `button "OK"` |
| Shows | `button "Publish show"`, `list "Show versions"`, `button "Roll back"`, `button "Make version <n> live"`, `link "Show link"`, `button "Copy show link"` | The live row carries the word 'live' |
| Members | `button "Invite guest VJ"`, `dialog "Invite to this set"` with `radio "Editor"`, `radio "Viewer"`, `button "Create link"`, `textbox "Invite link"` (read-only), `button "Copy link"` | |
| Presence | `list "In this set"`; each item's colour dot is `img "Cursor colour <colour>"` | Items show '<display name>', the colour dot, and '<layer name>' or 'nothing selected' | |
| Join page | `dialog "Join <set name>"` with `button "Join as <role>"` | |
| Conflict | `alertdialog "Someone changed this layer first"` with `button "Keep theirs"` and `button "Reapply mine"` | |
| Activity log | `list "Activity"` | One row per entry |
| Show page | `img "Show stage"`, `button "Show info"`, `region "Show info"` | 'Version <n>', 'SHA-256 <sha256>', 'Published <publish time>' |
| Live regions | `status "Autosave"`, `status "Shader compile"`, `status "Asset upload"`, `status "Show status"`, `status "Script status"`, `status "Export status"`, `status "Connection"`, `status "Service status"`, `status "Notifications"` | Copy in Feedback states |

### Interactions (DP-05, DP-06, DP-08, DP-19, DP-23, DP-24, DP-35, DP-37, DP-54, DP-55)

- **Layer tree.** Clicking a row selects it. The inspector retitles to that layer, and each component drawer keeps the open or collapsed state the user last gave it. Up and Down arrows move focus and selection to the previous or next visible row. Right opens a collapsed parent, or moves to its first child if already open. Left closes an open parent, or moves to the parent row. Home and End go to the first and last visible rows. Dragging a row onto another row makes it that row's child, and dropping between rows reorders it. From the keyboard, Alt+Up and Alt+Down reorder the focused layer among its siblings, Alt+Right makes it a child of the sibling above it, and Alt+Left moves it out to its parent's level.
- **Gizmos.** With a layer selected, the stage draws three handles from the layer's origin, one per axis: X in deep red, Y in bright green and Z in sky blue.
  - **Handle shape.** Each handle is a line about 80 pixels long on screen, whatever the zoom. It points along its axis's on-screen direction and ends in a square grip about 12 pixels across.
  - **Grip positions.** The canvas carries `data-gizmo-x`, `data-gizmo-y` and `data-gizmo-z` attributes. Each holds that grip's centre as 'x,y' in whole CSS pixels from the canvas's top-left corner. The attributes are absent when nothing is selected.
  - **Dragging.** Pressing within 8 pixels of a grip's centre grabs it. The pointer's movement is measured along the handle's on-screen direction, from the origin towards the grip. Each pixel along it changes:
    - With Move, the position on that axis by 0.01 units.
    - With Rotate, the rotation about that axis by 1 degree.
    - With Scale, the scale on that axis by 0.01.
  - The transform changes live on the stage and commits as one op on release. With Grid snap on, positions land on multiples of 0.5 units. With Angle snap on, rotations land on multiples of 15 degrees. Dragging empty stage space orbits the camera, and the mouse wheel zooms.
- **Scrub fields.** Pressing on a field and dragging sideways changes its value by 0.1 per pixel, or 0.01 per pixel while Shift is held. The pointer shows a sideways-resize cursor. The stage redraws on every animation frame during the drag, and the value commits as one op on release. A click without a drag puts the field into text editing. With focus on the field, Up or Right adds 0.1 and Down or Left subtracts 0.1; with Shift held, the step is 0.01. Each step redraws the stage. Enter commits the pending value. Escape reverts to the value the field had when it gained focus and commits nothing. Moving focus away commits. The BPM field is the one exception to these step sizes:
  - Dragging changes it by 0.1 per pixel, with or without Shift.
  - The arrow keys change it by 0.1 per press, with or without Shift.
  - A typed value with more than one decimal place is rounded to one decimal place before it is sent, with an exact half rounding up.

  Values are clamped to the ranges in Business rules. If the server refuses a value, the field error appears under the field.
- **Keyframes.** Clicking a row's keyframe dot, or pressing K while focus is in that row, places a key for the property at the playhead, snapped to the nearest quarter beat. The dot turns blue and a diamond appears on that property's timeline lane. Clicking a diamond moves the playhead to it, and Delete on a focused diamond removes the key.
- **Beat transport.** Play runs the stage clock from the playhead, Pause stops it where it is, Step beat moves the playhead one beat forward, and Stop pauses and returns the playhead to 1:1.
- **Node graph.** Add node opens the list of node types: the built-ins plus any registered plugin nodes. Nodes can be dragged on the graph canvas, and a wire is drawn by dragging from an output port to an input port. From the keyboard, Tab reaches each node button, and Enter or C on a focused node opens the 'Connect wire' dialog. Its From port list offers the focused node's output ports and its To port list offers the input ports of every other node. Arrow keys move within a list, Tab moves between the lists, and Enter or the Connect button connects the selected pair. Delete on a focused node removes it along with its wires.
- **Shader and script editors.** Typing edits the working copy. Ctrl+S (Cmd+S on Mac), or the Save button, saves a new version. A shader save compiles at once in the browser. Selecting a history row shows that version read-only, and Restore version <n> restores it.
- **Locks.** Take lock asks the server for the lease. The browser renews it every 10 seconds while the layer is selected, and Release lock frees it. Changing the selection releases the lock on the previously selected layer.
- **Conflict dialog.** When an edit is refused as stale, the dialog opens with focus on Keep theirs. Keep theirs discards the local edit and shows the server's value. Reapply mine sends the same change again against the current version, with a new client op id. Escape acts as Keep theirs.
- **Dialogs.** Every dialog and alert dialog moves focus to its first control when it opens. Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last. Escape closes it. Focus then returns to the control that opened it.
- **Shortcuts.** Each shortcut works whichever control in its region has focus, except while typing in a text box or code editor.

  | Shortcut | Action | Region |
  |---|---|---|
  | Space | Play or Pause | Anywhere in the shell |
  | K | Key the focused row's property | Inspector |
  | W, E, R | Choose Move, Rotate, Scale | Stage, layer tree or gizmo strip |
  | Ctrl+S or Cmd+S | Save | Inside the shader or script editor |
  | Enter or C | Open 'Connect wire' | On a focused graph node |
- **Offline.** When requests fail or the browser reports it is offline, edits keep applying locally and queue in the browser, and the connection banner appears. Edits made offline survive a page reload in that browser.
- **Show page.** The Show info button, or the I key, toggles the info panel. The page needs no other input.

### Visual design (DP-56, DP-57)

The direction is the seed's booth-dark pro-tool language, recast for a VJ studio.

- **Typefaces.** Arimo is used for everything a person reads: dialog titles, menus, labels and the numerals in fields, with numerals set at even widths. PT Sans is used for the small labels on row buttons. JetBrains Mono appears only inside the GLSL and script editors. Every typeface is served from the app itself.
- **Scale.** Body text is small and steady, with labels at the small end. Display text (the booth dialog title and the inspector's layer title) is about one and a half to two times the body size. Labels are in sentence case and never in capitals.
- **Palette roles, in words.**
  - A deep charcoal ground runs everywhere, including the gutters between panels.
  - Title bars and section headers are a slightly lighter graphite. Raised buttons are mid-grey and darken when pressed.
  - Fields are near-black, and the stage's clear colour is pure black.
  - Ink is pale grey, the selected tab's text is white, and secondary labels and placeholders are a mid-grey.
  - Numerals in value fields are a clear sky blue and turn a lighter blue while being scrubbed. The inspector's layer title is a softer steel blue.
  - Toggles that are on fill bright green. The stage grid's axis lines are sea green.
  - Links in the booth dialog are pale straw yellow. Record marks and error text are deep red.
  - The selected tree row has a vivid green square bullet on a black band.
  - The booth dialog's concentric-hexagon emblem is lavender-grey.
  - No panel is brighter than mid-grey, so the chrome never lights up a dark booth.
- **Density.** Rows are compact: tree and inspector rows are a little over 20 pixels tall with small gaps between them. Inspector forms use a two-column grid, with the label in roughly 40% of the width and the value in 60%. Vector rows split their value into three equal fields. Paired rows, such as near and far, split the width in half. Corners are barely rounded, and borders are thin and black. Only the booth dialog has a shadow.
- **Composition and hero.** The shell is the composition described in Screens and layout. The public page is that same shell running the 'Low Tide Tunnel' demo, with the booth dialog centred over it and no dimming behind it. The dialog shows the emblem, the large title, the centred body line and the yellow links.
- **Working screens in the same language.**
  - The asset shelf, shader history, script list, activity log, show versions and set list are tree-style rows with the black selection band and green bullet.
  - Forms are inspector rows built from blue-numeral scrub fields, dark selects with a small caret, compact row buttons and small on/off pills.
  - Empty states show a large, barely visible embossed headline on the ground and a single row button.
  - Errors are deep-red text directly under the field. Outages and reconnects appear in the banner strip under the menubar.
  - The shader editor is a near-black code field whose gutter marks error lines in deep red.
  - The node graph shows near-square graphite node boxes joined by sky-blue wires.
- **Icons.** Monochrome line icons from Lucide, in light grey.
- **Accessibility.** All text and all control boundaries meet WCAG 2.2 AA contrast against their own background. The embossed empty-state headline is decorative, and the empty-state copy itself is also shown in readable ink. Focused controls show a visible sky-blue outline. Below 1024 pixels, every control is at least 44 pixels in both directions. At 1024 pixels and up, dense rows are at least 22 pixels tall with gaps between them.

### Motion and effects (DP-03, DP-23, DP-58, DP-59)

- **Hover and press feedback.** Rows, tiles, menu items and buttons fade to their hover or pressed fill in about a tenth of a second.
- **Drawers and panels.** Component drawers collapse and expand in about a third of a second. The rig panel drawer slides in and out in under half a second.
- **Popovers.** The node types menu and select lists fade in within about a tenth of a second.
- **Booth dialog.** Fades in once, in no more than one second.
- **The stage loop.**
  - The stage canvas draws frames only while the transport plays, while a scrub, gizmo drag or orbit is in progress, or once after any committed change. When paused and idle, `data-frame` stays the same for any 2-second window.
  - While playing, `data-frame` rises at the display's frame rate, at least 30 frames per second on a desktop browser.
  - In the demo, the cube field completes one orbit every 8 beats, which is once every 3.5 to 4.5 seconds at 120 BPM. The tunnel's bands advance one ring per beat.
  - Dragging orbits the camera, also with reduced motion. Without reduced motion, the orbit coasts to a stop within half a second of release.
- **Signature: Scrub to the beat.**
  1. Clicking a layer row moves the black selection band to it immediately, and the hover fill on the previously hovered row fades out in about a tenth of a second.
  2. The inspector heading retitles to the layer's name, and drawers keep their collapsed or open state.
  3. Dragging a scrub field (for example the tube's Twist or a camera's Field of view) changes the value at the rates in Interactions. The numerals turn the lighter blue while dragging, and the stage redraws on every animation frame, so the tunnel visibly twists or the grid perspective widens. Dragging back reverses the change frame by frame.
  4. On release the value commits as one op, and Autosave announces the saved copy from Feedback states. Another open editor's stage and inspector show the value within two seconds.
  5. Clicking the keyframe dot turns it blue and places a key diamond at the playhead, snapped to the nearest quarter beat. The playhead readout shows its bars:beats and seconds.
- **No decorative loops.** Nothing in the chrome loops or animates on its own. The only continuous motion is the stage while playing or being interacted with.
- **Reduced motion.** Under the system's reduced-motion setting, the steps and final states are the same, but every fade, slide and colour change happens instantly. During a scrub drag the stage redraws once on release instead of every frame, so `data-frame` rises by exactly one per release. Orbit inertia is off. Playback still runs, because the show is the content.
- **Without WebGL.** The stage area shows the still message from Feedback states on the ground colour. Panels, editing and saving keep working.

### Feedback states (DP-09, DP-14, DP-26, DP-35, DP-37, DP-38, DP-39, DP-41, DP-43, DP-46, DP-47, DP-55)

All copy below is exact: straight apostrophes, ordinary hyphens, the case shown. The one exception is the collaboration banner, whose "can’t" uses the typographic right single quotation mark exactly as printed. Placeholders: `<n>` is an integer, `<name>` is the record's name as stored, and `<live>` is the live version number. Every region is polite unless stated otherwise.

- **Autosave** (`status "Autosave"`):
  - 'Saving' while an op is in flight.
  - 'Saved' once the server acknowledges every pending op.
  - 'Waiting to sync' while ops are queued offline. 'Saved' is never shown while anything is queued.
  - 'Save failed' when the server refuses an op with 422. The field's own message then appears under the field.
- **Field errors.** Shown under the field in deep red, using the `fields` messages from the API.
- **Shader compile** (`status "Shader compile"`):
  - 'Compiling' immediately on save.
  - 'Compiled' on success.
  - Otherwise 'Line <n>: <message>' for the first error, where `<n>` is the line number in the editor and `<message>` is the driver's text after the line number. Every error line is marked in the gutter. The stage keeps drawing the last program that compiled.
- **Asset upload** (`status "Asset upload"`):
  - 'Uploading <name>' while sending.
  - '<name> is ready' after the 201.
  - '<name> upload failed' after a failure. The row then shows the status 'upload failed'.
  - The shelf's empty state is 'No assets yet'.
- **Show status** (`status "Show status"`):
  - 'Publishing version <n>' while storing.
  - 'Version <n> is live' after publish or activation.
  - 'Rolled back. Version <n> is live' after a rollback.
  - 'Publish failed. Version <live> is still live.' when a store fails, or 'Publish failed. Nothing is live yet.' when no version was live.
  - The empty versions list shows 'No show versions yet'.
- **Show page.** Before anything is published, the page shows 'Nothing is live yet'. When the live version changes, it switches to the new version within five seconds and 'Version <n>' updates.
- **Script status** (`status "Script status"`, mirrored in `log "Console"`):
  - '<name>: line <n>: <message>' when a script throws.
  - '<name> stopped: onBeat took longer than 50 ms' when a script runs too long.
  - '<name> stopped: network access is not allowed' when a script tries to reach the network.
  - The script list's empty state is 'No scripts yet'.
- **Export status** (`status "Export status"`): 'Preparing export', then 'Export ready'. On a storage failure it shows the storage banner copy.
- **Connection** (`status "Connection"`, shown in the banner strip):
  - 'Connection lost. <n> changes waiting to sync.' while offline, with `<n>` the live queue count, updated on every queued edit. When `<n>` is 1 it reads 'Connection lost. 1 change waiting to sync.'
  - When the queue has drained with every op acknowledged, the banner disappears and `status "Notifications"` shows 'Back online. All changes synced.' If replay produces a conflict, the toast waits until the conflict dialog is resolved.
- **Conflict.** `alertdialog "Someone changed this layer first"` with the body '<display name> changed <layer name> before your edit arrived.'
- **Locks** (`status "Notifications"`):
  - 'Locked by <display name>' when a lock request is refused.
  - 'Your lock on <layer name> expired' when the server reports the expiry of the user's own lease.
  - 'This layer is locked by <display name>' when an edit hits another person's lock.
- **Outage banners** (`status "Service status"`, in the banner strip):
  - Object storage down: 'Asset storage is unreachable. Uploads and publishing are paused.'
  - Valkey down: 'Live collaboration is offline. Locks can’t be taken right now.'
  - Each banner appears within ten seconds of the dependency failing and disappears within ten seconds of it returning, without a reload.
- **Asset in use.** `alertdialog "Asset still in use"`.
  - For `asset_in_use`, the body is '<name> is used by:' followed by the dependents grouped under 'Layers', 'Materials' and 'Scripts'.
  - For `asset_in_shows`, the body is '<name> is part of published show versions <list>.' Here `<list>` is the version numbers in ascending order, separated by a comma and a space.
- **Auth errors** (shown under the field):
  - 'Enter a valid email address'
  - 'Password must be at least 10 characters'
  - 'Display name must be 1 to 40 characters'
  - 'An account with this email already exists'
  - 'Email or password is incorrect'
- **Empty states.**
  - Workspace: 'No sets yet'.
  - Activity log: 'No activity yet'.
  - A join link that was already used: 'This invite link has already been used'.
- **No WebGL.** 'This browser can't draw the stage. Your set still saves.'

## Backend

### API (DP-01, DP-04, DP-06, DP-09, DP-11, DP-12, DP-13, DP-15, DP-16, DP-20, DP-28, DP-29, DP-30, DP-31, DP-33, DP-34, DP-36, DP-39, DP-40, DP-41, DP-43, DP-44, DP-46, DP-47, DP-48, DP-50)

Bodies are JSON (`application/json; charset=utf-8`) unless stated. The session is an HttpOnly, SameSite=Lax cookie named `ag_session`, valid for 30 days. Ids are UUID strings. Times are ISO 8601 UTC strings from the server clock.

**Error shape.** Every error has the body `{"error":{"code":"<code>","message":"<text>"}}`, and some codes add the extra fields named below. Validation errors are `422 {"error":{"code":"validation","message":"<text>","fields":{"<field>":"<message>"}}}`.

**Error precedence** (the one order for the whole API):
1. 413 `too_large` and 415 `unsupported_media_type`, decided at the boundary before anything else.
2. 401 `unauthenticated`.
3. 404 `not_found`, for an unknown resource or a set the caller is not a member of.
4. 403 `forbidden`, for a role that may not do this.
5. An op replay returns its stored response.
6. 503 for an unreachable dependency.
7. 423 `layer_locked`. A stale op on a layer that another user has locked therefore gets 423, not 409.
8. Other state conflicts: 409 and 410.
9. 422 validation.

Endpoint rows list only their own extra errors.

**Accounts**

Every `fields` message, the top-level `message` of an account 422 (which is the first field's message), and the `message` of 409 `email_taken` and 401 `invalid_credentials` is the matching Auth errors line from Feedback states, character for character.

Before checking `email` and `display_name`, the server trims whitespace from both ends of each and stores the trimmed value, with the email in lowercase. The password is never trimmed.

- **Email.** Valid when it is at most 254 characters and contains no whitespace. It must have exactly one '@' with at least one character before it, and the part after the '@' must contain a '.' that is neither that part's first character nor its last.
- **Display name.** Valid at 1 to 40 characters after trimming.
- **Password.** Valid at 10 or more characters.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST /api/auth/signup | `{"email","password","display_name"}` | 201 `{"user":{"id","email","display_name"}}`, sets the cookie | 409 `email_taken`; 422 fields `email`, `password`, `display_name` |
| POST /api/auth/login | `{"email","password"}` | 200 `{"user":{...}}`, sets the cookie | 401 `invalid_credentials` |
| POST /api/auth/logout | none | 204, clears the session | |
| GET /api/me | none | 200 `{"user":{...}}` | 401 |

**Sets and the op log**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET /api/sets | none | 200 `{"sets":[{"id","name","role","bpm","head","live_number"}]}` | |
| POST /api/sets | `{"name","starter":"blank-stage"}` | 201, the full set document as returned by GET /api/sets/{id} | 422 fields `name`, `starter` |
| GET /api/sets/{id} | none | 200 `{"set":{"id","name","bpm","head","settings_version","graph_version","active_camera_id","show_token","role"},"layers":[...],"keys":[...],"graph":{"version","nodes":[...],"wires":[...]},"scripts":[...]}` | |
| POST /api/sets/{id}/ops | `{"client_op_id","target","base_version","type","payload"}` | 200 `{"seq","target","version","replayed":false}`; a replay returns the stored body with `"replayed":true` | 409 `stale_version` + `"current_version"` and `"current"` (the target's current state) + `"changed_by":{"user_id","display_name"}`; 409 `op_id_reused`; 409 `id_taken`; 423 `layer_locked` + `"holder":{"user_id","display_name"}` and `"expires_at"`; 422 |
| GET /api/sets/{id}/ops?after={seq}&limit={n} | none | 200 `{"ops":[{"seq","client_op_id","actor":{"user_id","display_name"},"target","type","payload","committed_at"}],"head"}`; `limit` is 1 to 500, default 500 | 422 field `after` |
| GET /api/sets/{id}/events?after={seq} | none | 200 `text/event-stream`, described below | |

- **Layer documents.** Each layer is `{"id","parent_id","index","name","kind","version","visible","position":[x,y,z],"rotation":[x,y,z],"scale":[x,y,z],"props":{...},"material":{"tint":[r,g,b],"tint_alpha","albedo_texture_id","emissive_texture_id"}|null,"model_asset_id"|null,"output_buses":[...],"shader_version"|null}`.
- **Key and script documents.** A key is `{"layer_id","property","tick","value"}`. A script is `{"id","name","version","source","asset_ids":[...]}`.
- **Op targets.** An op's `target` is a layer id, the string `"set"`, the string `"graph"` or a script id. `base_version` is required except for `layer.add`, `script.add`, `graph.node.add` and `graph.wire.add`.
- **Op types and payloads:**
  - `layer.add`. Target is the new layer id. Payload `{"parent_id","index","name","kind"}`.
  - `layer.set`. Target is a layer. Payload `{"path","value"}`.
  - `layer.reparent`. Payload `{"parent_id","index"}`.
  - `layer.remove`. Payload `{}`.
  - `shader.save`. Payload `{"source"}`.
  - `shader.restore`. Payload `{"from_version"}`.
  - `key.set`. Payload `{"property","tick","value"}`.
  - `key.remove`. Payload `{"property","tick"}`.
  - `set.update`. Target `"set"`. Payload with any of `"name"`, `"bpm"`, `"active_camera_id"`.
  - `graph.node.add`. Payload `{"node_id","type","params","x","y"}`.
  - `graph.node.update`. Payload `{"node_id", optional "params", "x", "y"}`.
  - `graph.node.remove`. Payload `{"node_id"}`.
  - `graph.wire.add`. Payload `{"wire_id","from":{"node_id","port"},"to":{"node_id","port"}}`.
  - `graph.wire.remove`. Payload `{"wire_id"}`.
  - `script.add`. Target is the new script id. Payload `{"name","source"}`.
  - `script.save`. Payload `{"source","asset_ids"}`.
  - `script.remove`. Payload `{}`.
- **`layer.set` paths:**
  - `name`, `visible`
  - `position`, `rotation`, `scale` (each a three-number array)
  - `position.x|y|z`, `rotation.x|y|z`, `scale.x|y|z`
  - `props.<prop>`
  - `material.tint`, `material.tint_alpha`, `material.albedo_texture_id`, `material.emissive_texture_id`
  - `model_asset_id`, `output_buses`
- **Event stream.** It first sends every committed op after `after` (or after the `Last-Event-ID` header). It then streams live events:
  - `event: op` with the op document, its `id:` being the seq.
  - `event: lock` with `{"layer_id","holder"|null,"expires_at"|null,"reason":"granted"|"renewed"|"released"|"expired"}`.
  - `event: presence` with `{"members":[...]}`.
  - `event: status` with the status body.
  - `event: show` with `{"live_number"}`.

**Locks and presence**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST /api/sets/{id}/layers/{layerId}/lock | none | 201 `{"layer_id","holder":{"user_id","display_name"},"expires_at","server_time","ttl_seconds":30}`; 200 with the same body when the caller already holds it, which renews it | 409 `lock_held` + `"holder"`, `"expires_at"`; 503 `collab_offline` |
| POST /api/sets/{id}/layers/{layerId}/lock/heartbeat | none | 200 `{"layer_id","expires_at","server_time"}` | 409 `lock_not_held`; 503 `collab_offline` |
| DELETE /api/sets/{id}/layers/{layerId}/lock | none | 204 | 403 when neither the holder nor the owner; 409 `lock_not_held` when free; 503 `collab_offline` |
| GET /api/sets/{id}/locks | none | 200 `{"server_time","locks":[{"layer_id","holder","expires_at"}]}` | 503 `collab_offline` |
| POST /api/sets/{id}/presence | `{"selection": "<layer id>"|null}` | 200 `{"members":[{"user_id","display_name","colour","selection"}]}` | 503 `collab_offline`; 422 field `selection` |
| GET /api/sets/{id}/presence | none | 200 `{"members":[...]}` | 503 `collab_offline` |

**Members and invites**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET /api/sets/{id}/members | none | 200 `{"members":[{"user_id","display_name","email","role"}]}` | |
| POST /api/sets/{id}/invites | `{"role":"editor"|"viewer"}` | 201 `{"token","url":"/join/<token>","role"}` | 422 field `role` |
| GET /api/invites/{token} | none | 200 `{"set_name","role","owner_display_name","used":bool}` | 404 |
| POST /api/invites/{token}/accept | none | 200 `{"set_id","role"}`; the same user accepting again, or an existing member accepting, gets 200 with their current role | 410 `invite_used` when another user already accepted it |

**Assets**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST /api/sets/{id}/assets | `multipart/form-data` with fields `kind` (`model` or `texture`) and `file` | 201 `{"asset":{"id","name","kind","size","sha256","status":"ready","dependents":{"count":0,"layers":[],"materials":[],"scripts":[]}}}` | 503 `storage_unavailable` + `"asset"` with `"status":"upload failed"`; 422 fields `kind`, `file` |
| GET /api/sets/{id}/assets | none | 200 `{"assets":[{"id","name","kind","size","sha256","status","created_at","dependents":{"count","layers":[{"id","name"}],"materials":[{"layer_id","name"}],"scripts":[{"id","name"}]}}]}` | |
| GET /api/assets/{assetId}/content | none | 200 with the stored bytes, `Content-Type` `model/gltf-binary`, `image/png` or `image/jpeg`, and header `X-Content-SHA256` | 404 unless the caller is a member of the asset's set; 409 `asset_not_ready`; 503 `storage_unavailable` |
| DELETE /api/sets/{id}/assets/{assetId} | none | 204 | 409 `asset_in_use` + `"dependents"` with the same shape as above; 409 `asset_in_shows` + `"show_versions":[<number>, ...]`; 503 `storage_unavailable` |

**Shader history**

| Method and path | Success |
|---|---|
| GET /api/sets/{id}/layers/{layerId}/shader/versions | 200 `{"versions":[{"number","sha256","size","author":{"user_id","display_name"},"created_at","restored_from"|null}]}`, newest first |
| GET /api/sets/{id}/layers/{layerId}/shader/versions/{n} | 200 `{"number","source","sha256"}`; 404 for an unknown number |

**Shows**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST /api/sets/{id}/shows | `{"note"}` (optional, 0 to 200 characters) | 201 `{"show_version":{"number","status":"published","live":true,"sha256","size","published_at","published_by":{"user_id","display_name"},"note"}}` | 503 `storage_unavailable` + `"show_version"` with `"status":"store failed"` and `"live":false`; 409 `asset_not_ready` when the working set references an asset that is not ready |
| GET /api/sets/{id}/shows | none | 200 `{"show_url":"/show/<token>","live_number"|null,"versions":[...]}`, newest first | |
| POST /api/sets/{id}/shows/rollback | none | 200 `{"live_number","previous_live_number"}` | 409 `no_previous_version` |
| POST /api/sets/{id}/shows/{n}/activate | none | 200 `{"live_number","previous_live_number"}` | 409 `not_published` |
| GET /api/show/{token} | none, no sign-in | 200 `{"set_name","bpm","version":{"number","sha256","size","published_at"}}` | 404 `not_published` before the first publish |
| GET /api/show/{token}/bundle | none | 200 with the stored bundle bytes, `Content-Type` `application/json`, header `X-Bundle-SHA256` and header `X-Show-Version` | 404 `not_published`; 503 `storage_unavailable` |
| GET /api/show/{token}/assets/{assetId} | none | 200 with the asset's stored bytes | 404 unless the asset is in the live version's manifest; 503 `storage_unavailable` |
| GET /api/show/{token}/events | none | 200 `text/event-stream` of `event: show` `{"live_number"}` | |

**Export, import, activity and status**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST /api/sets/{id}/exports | none | 201 `{"export":{"id","sha256","size","download_url":"/api/exports/<id>/download"}}` | 503 `storage_unavailable` |
| GET /api/exports/{exportId}/download | none | 200 with the stored zip bytes, `Content-Type` `application/zip`, `Content-Disposition: attachment; filename="<set name in lowercase with runs of other characters replaced by a hyphen>.afterglass.zip"`, header `X-Content-SHA256` | 404 unless the caller is a member; 503 `storage_unavailable` |
| POST /api/sets/import | `multipart/form-data` with field `file` | 201 with the new set's full document | 503 `storage_unavailable`; 422 `validation` with field `file` and message 'Not an Afterglass export' |
| GET /api/sets/{id}/activity?before={entry id} | none | 200 `{"entries":[{"id","at","actor":{"user_id","display_name"},"action","target","summary"}]}`, newest first, 50 per page | |
| GET /api/status | none | 200 `{"storage":"ok"|"unreachable","collab":"ok"|"unreachable","checked_at"}` | |
| GET /api/health | none | 200 `{"status":"ok"}` | |

### Business rules (DP-04, DP-06, DP-07, DP-09, DP-11, DP-12, DP-16, DP-20, DP-21, DP-22, DP-25, DP-26, DP-29, DP-31, DP-33, DP-34, DP-36, DP-38, DP-39, DP-41, DP-44, DP-48)

- **Roles.**
  - The creator of a set is its owner.
  - Owners and editors may send ops, take, renew and release their own locks, post presence, upload assets and create exports.
  - Only the owner may create invites, publish, roll back, activate a version, delete assets and release someone else's lock.
  - Viewers may read the set, its assets, history, activity and show versions. Every write endpoint, including presence and locks, answers a viewer with 403 `forbidden`.
  - Importing creates a new set owned by the importer.
- **Op log.**
  - Each committed op gets the set's next sequence number, starting at 1 with no gaps.
  - It bumps its target's version by 1. A new layer or script starts at version 1. The set settings and the graph each start at version 1 when the set is created.
  - The op row, the sequence number and the version bump commit in one transaction, so no reader ever sees one without the others.
  - `head` is the highest committed sequence number.
  - Ops that are refused do not consume a sequence number.
- **Exactly once.**
  - `client_op_id` is 8 to 64 characters and is unique within a set.
  - Sending an id that is already committed, with the same target, type, payload and base version, returns the original response body with `"replayed": true`. It applies nothing, writes no activity entry and sends no event.
  - The same id with any difference in target, type, payload or base version is refused with 409 `op_id_reused`.
  - A `layer.add` or `script.add` whose new id already exists under a different client op id gets 409 `id_taken`.
- **Stale writes.** An op whose `base_version` is lower than its target's current version is refused with 409 `stale_version`, carrying the current version and state and the person who made the latest change. It is never merged. A `base_version` higher than the current version is a 422 on `base_version`.
- **Lock and write.** An op on a layer whose lock another user holds is refused with 423 `layer_locked`. The holder, and anyone writing to a free layer, may write without further checks. While Valkey is unreachable, lock checks are skipped and the base-version check alone guards writes.
- **Lock leases, decided by the server clock.**
  - A lock is either free or held by one user until an `expires_at`.
  - A grant sets `expires_at` to the server's current time plus 30 seconds, and each heartbeat from the holder extends it to 30 seconds from that heartbeat. Browsers send heartbeats every 10 seconds.
  - Release makes the lock free, as does reaching `expires_at` without a heartbeat. Within two seconds of an expiry, the server sends `event: lock` with reason `expired`.
  - Of any number of simultaneous requests for a free lock, exactly one gets 201 and every other gets 409 `lock_held`.
  - Removing a layer frees its lock.
  - The device clock may be wrong by hours. Browsers show lock state only from lock events and lock responses, never from their own clock.
- **Presence.**
  - Each editor or owner with the set open posts presence every 10 seconds and on every selection change. A member who has not posted for 30 seconds drops out of the list.
  - Colours come from the fixed order blue, green, yellow, violet, orange, red. They are assigned by the order of joining the set, with the owner first, and repeat after six.
  - `colour` in presence responses and in Valkey is that lowercase word, for example `"blue"`. The `<colour>` in the presence dot's accessible name is the same word.
  - Presence changes reach other open editors within two seconds.
- **Value ranges** (inclusive limits; out-of-range values are a 422 with a message naming the range):
  - Position and rotation components are finite numbers from −10,000 to 10,000. Rotation is in degrees.
  - Scale components run from 0.001 to 1,000.
  - Field of view runs from 10 to 120 degrees. The near plane runs from 0.01 to 10. The far plane must be greater than the near plane and at most 10,000.
  - Intensity runs from 0 to 10. Twist runs from −10 to 10. Radius runs from 0.1 to 100.
  - Tint components and tint alpha run from 0 to 1.
  - BPM runs from 40 to 240 with at most one decimal place.
  - Layer, script and set names are 1 to 60 characters (sets 1 to 80).
  - Shader and script source is at most 100,000 bytes of UTF-8.
- **Layer kinds and defaults.**
  - `group` has no props.
  - `cube`, `sphere`, `plane`, `torus` and `tube` have a material with white tint and alpha 1. `tube` also has `props.twist` (0) and `props.radius` (1).
  - `camera` has `props.fov` 50, `props.near` 0.1 and `props.far` 200.
  - `light` has `props.intensity` 1.
  - `model` has a material and `model_asset_id`.
  - `shader` draws a full-stage pass with the layer's latest shader version.
    - The source is the complete GLSL ES 3.00 fragment shader exactly as typed in the editor. The app adds nothing before or after it.
    - Line 1 must be `#version 300 es`. The source must declare a float precision and exactly one `out vec4` output.
    - The source declares whichever of these uniforms it uses, and the app sets every one it declares: `uniform float u_time;` (seconds), `uniform float u_beat;` (beats since 1:1), `uniform vec2 u_resolution;` and `uniform float u_intensity;`.
    - The `<n>` in a compile error's 'Line <n>' counts lines of the editor text, starting at 1.
    - Version 1 of every new shader layer is this starter source, which ends with a newline:

      ```glsl
      #version 300 es
      precision highp float;
      uniform float u_beat;
      uniform vec2 u_resolution;
      out vec4 fragColor;
      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution;
        float pulse = 0.5 + 0.5 * sin(u_beat * 6.2831853);
        fragColor = vec4(uv * pulse, 0.5, 1.0);
      }
      ```
  - Layers of kind `cube`, `sphere`, `plane`, `torus`, `tube`, `model` and `shader` carry `output_buses`, a non-empty subset of `main`, `side` and `led`, shown as 'Main', 'Side screens' and 'LED strip'. The default is `["main"]`. Only these kinds show the Outputs drawer.
  - Layers of kind `group`, `camera` and `light` always have `output_buses` equal to `[]`. A `layer.set` of `output_buses` on one of them is a 422 on `path`.
- **Parenting.** `layer.reparent` to the layer itself or to any of its descendants is refused with 422 on `parent_id`, message 'A layer cannot be its own ancestor'.
- **Sibling order.** `index` is a layer's 0-based position among the children of its parent. Top-level layers have `parent_id` null and are ordered the same way.
  - In `layer.add` and `layer.reparent`, `index` must be an integer from 0 up to the number of siblings at the destination, not counting the moving layer. That number itself is allowed and appends the layer. Any other value is a 422 on `index`.
  - Siblings at or after the insertion point move up by one.
  - When a layer moves away or is removed, the siblings it leaves behind close the gap, so siblings always hold the indexes 0 to n−1.
  - These index shifts change no other layer's version. Removing a layer removes its descendants, their keys and their graph Layer property nodes.
- **Active camera.** `set.update` with an `active_camera_id` that is not a camera layer in the set is a 422. When the active camera is removed, the first remaining camera in tree order becomes active, and if none remain the stage uses a default view.
- **Assets.**
  - An asset moves from `uploading` to `ready` or to `upload failed`, and from `ready` or `upload failed` to deleted. No other transition exists.
  - An `upload failed` asset can never be bound, so it has no dependents and no show version lists it. Deleting it answers 204, removes the asset and removes any partial object from storage.
  - It becomes `ready` only after object storage accepts the write and a follow-up read of the object's metadata shows the uploaded size and checksum.
  - Models must be binary glTF 2.0 (`.glb`); textures must be PNG or JPEG. Both are recognised by their leading bytes, and anything else is a 422 on `file`.
  - Model ids bind only to `model_asset_id`. Texture ids bind only to the two texture slots and to script `asset_ids`.
  - In `layer.set`, binding an asset that is unknown, not `ready` or of the wrong kind is a 422 on `value`.
  - In `script.save`, an `asset_ids` entry that is unknown, not `ready` or a model is a 422 on `asset_ids`, and nothing in the save is applied.
- **Dependents.**
  - An asset's count is the number of live layers whose `model_asset_id` is that asset, plus live layer materials with that asset in either texture slot (one per material), plus live scripts listing it in `asset_ids`.
  - The count is recomputed in the same transaction as every op that changes any of these. Removed layers and scripts stop counting at once.
  - Delete is refused with 409 `asset_in_use` while the count is above 0.
  - When the count is 0, delete is still refused with 409 `asset_in_shows` while any `published` or `storing` show version lists the asset in its bundle's `assets` manifest. This keeps the show asset endpoint and rollback able to serve that version. Published show versions are never counted as dependents.
  - Otherwise the object storage object and the asset are removed.
- **Shader versions.**
  - Each `shader.save` creates the next version number (consecutive integers starting at 1, with no gaps) with the source stored byte for byte.
  - `shader.restore` with `from_version` N creates the next version with source byte-identical to N and `restored_from` N. Earlier versions never change and are never removed.
  - A shader that does not compile still saves. The compile result is a browser concern.
- **Beat time.**
  - Keys are stored in ticks, 96 per beat, with four beats per bar. A key's tick is an integer from 0 up to but not including 24,576 (64 bars).
  - The editor snaps new keys to the nearest multiple of 24 ticks, a quarter beat, with an exact half rounding later.
  - bar = floor(tick / 384) + 1. Beat in bar = (tick mod 384) / 96 + 1, written without trailing zeros, so 3, 3.25, 3.5 or 3.75. For example, tick 6,336 is '17:3'.
  - seconds = (tick / 96) × 60 / BPM, shown with three decimals and a space before 's'. For example, tick 6,336 at 120 BPM is '17:3 33.000 s'.
  - Changing BPM changes no tick. It only changes the seconds.
  - The Beat clock node, the timeline playhead, `u_beat` and script `onBeat` share one clock.
- **Property value at a time.** A Layer property node in the graph overrides keys, keys override the stored value, and between two keys the value is linear in ticks. Graph and key values drive only the drawn stage and are never committed as ops.
- **Node graph.**
  - Built-in node types:
    - Beat clock: outputs `beat` and `phase` (0 to 1 within each beat).
    - LFO: input `beat`; params `shape` (`sine`, `triangle`, `square`, `saw`) and `rate_beats` (0.25 to 16); output `value` from −1 to 1, completing one cycle per `rate_beats`.
    - Remap: input `in`; params `in_min`, `in_max`, `out_min`, `out_max`; output `out`, linear and unclamped.
    - Layer property: params `layer_id` and `property` (any keyable path); input `value`.
  - A wire runs from an output port to an input port of a different node. Otherwise the server answers 422 `validation` on `to`, message 'Wires run from an output to an input'.
  - An input takes at most one wire, and a second one is refused with 422 on `to`, message 'This input already has a wire'.
  - A wire that would close a cycle is refused with 422 on `to`, message 'This wire would make a loop'.
  - The graph is evaluated once per drawn frame while the transport plays.
- **Keyable properties.** `position.x|y|z`, `rotation.x|y|z`, `scale.x|y|z`, `props.fov`, `props.near`, `props.far`, `props.twist`, `props.radius`, `props.intensity` and `material.tint_alpha`.
- **Scripts.**
  - A script is plain JavaScript run in the browser, isolated from the page, storage and the network.
  - It may define `onBeat(ctx)`, called once per beat while playing, with `ctx` = `{ beat, bar, bpm, set(layerName, property, value) }`. `beat` counts from 0, `bar` from 1, and `set` drives a keyable property on the drawn stage only.
  - A script's top level runs when the set opens in the editor or on the show page, and again after each save of that script. Its `onBeat` and `registerNode` calls take effect from that run.
  - Besides standard JavaScript built-ins, scripts get only `registerNode` and `console.log`.
  - Each `console.log(...values)` call adds one line '<script name>: <values>' to `log "Console"`, where `<values>` is each value converted to text and joined with single spaces. These lines are not announced in Script status.
    - For example, a script named 'Pulse script' containing `function onBeat(ctx) { console.log("beat", ctx.beat); }` adds one Console line per beat while playing, the first being 'Pulse script: beat 0'.
  - It may call `registerNode(typeName, definition)`.
    - `typeName` is 1 to 40 characters and is also the node's title. Its Add node entry reads `<typeName>`, its graph node is `button "<typeName> node"`, and in `graph.node.add` its `type` is `typeName`.
    - `definition.inputs` and `definition.outputs` are arrays of port-name strings, and every port carries one number.
    - `run(inputs)` is called once per drawn frame while the transport plays, as part of graph evaluation. It receives an object holding one number per input port name, with 0 for an unwired input.
    - `run` returns an object with one number per output port name. A missing or non-numeric output reads as 0.
    - The node type stays in Add node until the script is removed.
    - A complete example: wiring Beat clock `beat` to its `beat` input and its `value` output to a Layer property node pulses that property once per beat.

      ```js
      registerNode("Pulse", {
        inputs: ["beat"],
        outputs: ["value"],
        run(inputs) {
          return { value: Math.abs(Math.sin(inputs.beat * Math.PI)) };
        }
      });
      ```
  - A call that throws, takes longer than 50 milliseconds or touches the network stops that script until it is next saved, and the stage keeps drawing.
- **Show versions.**
  - Publishing creates the next version number with status `storing` and writes the bundle.
  - Only after object storage confirms the write (metadata read back showing the same size and checksum) does the version become `published`. The live pointer moves to it in the same transaction.
  - If the store fails, the version becomes `store failed`, the live pointer stays where it was, and the response is 503.
  - The bundle is UTF-8 JSON of the working set at that moment: `{"format":"afterglass-show/1","set":{"name","bpm","active_camera_id"},"layers","keys","graph","shaders":[{"layer_id","version","source"}],"scripts":[{"id","name","version","source","asset_ids"}],"assets":[{"id","name","kind","size","sha256"}]}`. Each shader carries its latest saved version.
  - Its bytes and sha256 never change after publish, whatever later edits happen.
  - Rollback moves the live pointer to the highest-numbered `published` version below the current live one, and with none it answers 409 `no_previous_version`.
  - Activate moves the pointer to any `published` version; `storing` and `store failed` versions get 409 `not_published`.
  - Superseded versions stay `published` and can be activated again.
  - Every pointer change is one transaction, sends `event: show`, and open show pages switch within five seconds.
  - The show page plays the `main` bus. Adding `?bus=side` or `?bus=led` plays that bus.
- **Export and import.**
  - An export zip holds `set.json`, laid out like a show bundle with every shader's full version history and with `"format":"afterglass-export/1"`, plus each ready asset as `assets/<asset id>`.
  - The zip is stored before its 201, and download streams exactly the stored bytes.
  - Import stores the uploaded zip byte for byte before reading it. It creates a new set named '<original name> (imported)', with new ids and the same tree, transforms, props, keys, graph, scripts, shader histories (same numbers and sources) and assets, each asset becoming `ready` by the same confirmation rule.
- **Activity.**
  - Every committed op writes one entry with `action` equal to its op type.
  - Publish writes `show.publish`, rollback `show.rollback`, activation `show.activate`, a store failure `show.store_failed`, an upload `asset.upload`, a delete `asset.delete`, an invite acceptance `member.join`, an owner releasing someone else's lock `lock.force_release`, an export `set.export` and an import `set.import`.
  - `summary` is a short human sentence naming the target, for example 'Set Twist on Tunnel to 0.350'.

### Services (DP-09, DP-13, DP-30, DP-31, DP-39, DP-43, DP-44, DP-46, DP-47)

- **PostgreSQL.** Holds accounts and sessions, sets, members and roles, invites, layers, keys, graph, scripts, the gapless op log with client op ids, shader versions, show versions and the live pointer, asset metadata with dependency references, and the activity log. The app applies its schema idempotently every time it starts.
- **MinIO (bucket `S3_BUCKET`).** Every object is written with its exact bytes:
  - Assets at `sets/<set id>/assets/<asset id>`.
  - Show bundles at `sets/<set id>/shows/<version number>/bundle.json`.
  - Exports at `sets/<set id>/exports/<export id>.zip`.
  - Imported uploads at `imports/<import id>.zip`.

  The sha256 the API reports for each is the lowercase hex sha256 of exactly those bytes.
- **Valkey.**
  - Lock leases live at `afterglass:lock:<set id>:<layer id>`. The value is the holder's user id, with an expiry of 30,000 milliseconds that each heartbeat resets.
  - Presence lives at `afterglass:presence:<set id>:<user id>`, as JSON `{"display_name","colour","selection"}` with a 30-second expiry.
  - Committed ops, lock changes, presence changes and show pointer changes are published on the channel `afterglass:set:<set id>`, and the server relays them to every open event stream for that set.
- **When MinIO is unreachable.**
  - Uploads, publish, export, import, asset content, the show bundle and asset delete answer 503 `storage_unavailable`, with the storage banner from Feedback states as the message.
  - A failed upload leaves the asset `upload failed`, and a failed publish leaves the version `store failed` with the live pointer unchanged.
  - Edits, shader saves, locks and presence keep working.
  - Open show pages keep playing what they already loaded.
- **When Valkey is unreachable.**
  - Lock and presence endpoints answer 503 `collab_offline`, with the collaboration banner from Feedback states as the message.
  - Ops still commit to PostgreSQL. Because the relay is down, open editors fetch ops after their last sequence number every five seconds, so every committed op still reaches them within five seconds.
- **Status.** `/api/status` reflects each dependency, rechecked at least every five seconds. Recovery needs no restart.

### Seed data (DP-02, DP-03)

The database starts empty: there are no accounts, sets or assets. Every person and venue in examples is invented.

- **'Blank stage' starter.** A new set at 120 BPM whose layers each start at version 1, with op sequence 0 and graph and settings versions 1. Its tree, in order:
  - 'Stage' (group, top level, index 0, at the origin, output buses `[]`)
    - 'Main camera' (camera, index 0, position 0, 2, 8, field of view 50, near 0.1, far 200, output buses `[]`)
    - 'Key light' (light, index 1, position 4, 6, 4, intensity 1, output buses `[]`)
    - 'Floor' (plane, index 2, scale 10, 1, 10, output buses `["main"]`)

  'Main camera' is the active camera. The graph holds one 'Beat clock' node and no wires. There are no keys, scripts or assets.
- **'Low Tide Tunnel' demo on '/'.** Built in the browser and never stored. It runs at 120 BPM, with layers:
  - 'Tunnel' (tube, twist 0.35, radius 2, with shader rings)
  - 'Cube field' (group of 24 cubes)
  - 'Demo camera' (camera, field of view 60)

## Technical requirements

### Deployment (DP-50)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22.

Node 22 and npm are available. `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` returns HTTP 200 with `{"status":"ok"}` once PostgreSQL is connected and the schema is applied. The lockfile is committed.

### Configuration and secrets (DP-51)

The server reads these at start: `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `VALKEY_URL`. None is hard-coded, and none is ever sent to the browser, written to a page or included in a log line. The browser talks only to the app's own origin. It never reaches MinIO, Valkey or PostgreSQL directly.

### Server boundary (DP-52)

- **Same origin only.** No CORS headers are sent. A write request whose `Origin` header names another origin gets 403 `forbidden`.
- **Body limits** (each limit itself is allowed; one byte more gets 413 `too_large`):
  - JSON bodies: 1,000,000 bytes.
  - Model uploads: 20,000,000 bytes.
  - Texture uploads: 8,000,000 bytes.
  - Import zips: 50,000,000 bytes.
- **Content types.** A JSON endpoint sent another content type answers 415 `unsupported_media_type`.
- **What is served.** Only the built frontend, the fonts and the API. Source files, `run.json`, environment files, lockfiles and dependency folders are never served, and paths outside the build answer 404.
- **Unreachable dependencies at boot.** If PostgreSQL is unreachable, the server retries every two seconds and the health path does not answer 200 until it connects. If MinIO or Valkey is unreachable, or its URL cannot be parsed, the server starts anyway, reports the dependency as unreachable in `/api/status`, and recovers by itself within ten seconds once the dependency answers.

### Browser support and performance (DP-53, DP-59)

The app supports current Chromium, Firefox and Safari at the viewports 375x812, 768x1024, 1280x800 and 1440x900. The stage requires WebGL2, and without it the still fallback is shown. On a local server, a set with the 'Blank stage' starter is usable, with its first stage frame drawn, within three seconds of navigation. A committed op reaches other open editors within two seconds while Valkey is up.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and those commands alone install, build and serve the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its name, version and licence.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or Zlib, and the fonts are under OFL-1.1.
- IF-04: The app stores state only in PostgreSQL, MinIO and Valkey. It uses no other database, no SQLite and no state files on disk.
- IF-05: The running app makes no request to any third-party origin. Fonts, icons and scripts are served from the app itself.
- IF-06: The provided service configuration and its seeded credentials are left unchanged.
- IF-07: The npm lockfile is committed, and `install` uses it without modifying it.

## Engineering standards

- The code is idiomatic TypeScript in strict mode, with no `any` in domain code and no unchecked casts of request bodies.
- Names in the source match this brief's domain terms: set, layer, op, client op id, base version, lock lease, presence, asset, dependents, shader version, show version, live pointer, bundle, export and import.
- Each domain rule is decided in exactly one place in the source. Examples: the asset state transitions, the dependents count, the stale-version check, the lock lease grant, the bars:beats conversion and the live-pointer move.
- Every API error is produced through one error shape. No handler builds its own variant.
- There are no abstractions with a single implementation, and no defensive checks for states the types or the database constraints already rule out.
- There is no dead, commented-out or unreachable code, and no feature beyond this brief.
- Every transaction that commits an op, its sequence number and its version bump is written once and reused by every op type.
