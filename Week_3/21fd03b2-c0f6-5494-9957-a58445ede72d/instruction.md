# Tarn & Tally Bench Works Rampwright

Rampwright is a browser workspace for independent physics tutors, homeschool co-op teachers and after-school science teachers. They build 3D physics scenes in real SI units: ramps with carts, pendulums, launchers, crates and imported models. Each scene runs on a deterministic fixed-step bench, and the tutor saves checkpoints and publishes the scene as a playable lab at a public address that students open without an account. A co-tutor can edit the same scene at the same time, with presence, live cursors and object locks. A parent or reviewer can read scenes and the activity log without edit rights.

The server uses four services:
- Postgres for accounts, workspaces, roles, projects, scenes, revisions, checkpoints, activity, share links, published labs and the mail outbox.
- MinIO for uploaded assets, checkpoint snapshots and published lab bundles.
- Valkey for presence, live cursors and object-lock leases.
- Mailpit (SMTP) for invite, role-change, share and publish emails.

Out of scope: student accounts, grading, chat, video, payments, single sign-on, any datastore beyond these four services, and any third-party API.

## Problem and users

Small-practice physics tutors explain ramps, pendulums, collisions and projectile motion with static slides or with fixed simulations they cannot change. A tutor with an off-script question, such as "what if the cart is 0.5 kg heavier on this slope?", has nowhere to ask it. General 3D editors can build the scene but know nothing about units, and that causes three problems:
- Imported models arrive at arbitrary scale.
- A physics step tied to frame rate gives every student a different run.
- A "published" link can show a different result from the preview.

Tutors pay for several tools and still re-explain each scene over screen-share. Rampwright gives them one bench. Scenes are authored in metres, kilograms and seconds, run identically on every device and return exactly as left after each run. A tutor can share a scene with a co-tutor without either person overwriting the other.

- **Tutor-owner** (daily during term): builds, runs, checkpoints and publishes scenes in real units, invites a co-tutor, and administers the workspace, its share links and its labs.
- **Co-tutor-editor** (weekly): edits scenes next to the owner, sees who is present and who holds which object, and never loses work to a simultaneous edit.
- **Student-player** (weekly, no account): opens a published lab link, often on a phone, changes only the parameters the tutor exposed, runs the lab and gets the same result as every classmate.
- **Workspace-viewer** (occasional): a parent or reviewer who reads scenes and the activity log and can run scenes, but cannot change anything.

## Journeys

1. **Set up a bench.**
   1. The tutor-owner starts signed out on the landing page, chooses Start a bench and creates an account.
   2. They land on the new-workspace screen, create a workspace and land on its project list, which shows the empty-projects copy.
   3. They create a project, then a scene from the Ramp template.
   4. The editor opens with the ramp in the outline, on the stage and in the inspector.
2. **Ask the what-if question.**
   1. In the seeded scene Slope trial, the owner reaches Ramp A in the outline by keyboard and types `2.5 kg` into Mass (kg).
   2. While they type, the Derived readouts update in place. On blur the field reads `2.5`, and the Save status live region goes from saving to saved.
   3. They press R. The panels vanish, the green RUNNING pill appears and the cart runs down the ramp.
   4. They pause, step a few times and read the state hash.
   5. They press R again. The panels return where they were, and the stats card shows the same hash as before the run.
3. **Bring in a co-tutor.**
   1. The owner invites a co-tutor as Editor from workspace settings. They notice a typo in the role and re-invite. Only the newer invite email is live.
   2. The co-tutor opens the newest link, signs up with the invited address, accepts and lands on the workspace.
   3. Both open Slope trial and see each other in People here and as live cursors.
   4. The co-tutor selects Ramp A, which the owner holds, and sees the lock-held notice. When the owner moves on, the co-tutor hears that the ramp is free and edits it.
   5. When both change gravity at once, one of them gets the Scene changed elsewhere dialog and chooses which version to keep.
   6. Later the owner makes the co-tutor a viewer. The co-tutor's open editor turns view-only within seconds, without a reload.
4. **Import a model.**
   1. The owner uploads a GLB measured in centimetres and chooses cm as its unit.
   2. It appears in the Models folder with its size in metres, measured through the model's own node transforms.
   3. They drag it from Props onto the stage, where it stands at its true size next to the ramp.
5. **Checkpoint and publish.**
   1. The owner saves a checkpoint named Before class.
   2. They open Publish lab, tick Ramp A: Mass (kg) and Ramp A: Angle (degrees) as student controls, and publish.
   3. The notice shows the public lab address, and a confirmation email with that address arrives.
   4. Later they restore Before class. A co-tutor's stale save meets the conflict dialog instead of undoing the restore.
6. **Play the lab on a phone.**
   1. A student opens the lab address on a 390-pixel-wide phone with reduced motion on.
   2. The stage fills the top of the screen and the parameters sit in a bottom sheet.
   3. They drag the mass slider, see the readouts change, tap Run, pause and read the hash.
   4. A classmate on a laptop with the same values reads the same hash.
7. **Share and revoke.**
   1. The owner opens Share project, creates a read-only link and emails it to a parent.
   2. The parent opens the link and leaves Slope trial open.
   3. When the owner moves Cart 1 and it saves, the parent's open view shows the new position within seconds.
   4. The owner revokes the link, and the parent's open view switches to the dead-link copy without a reload.
8. **Review as a viewer.**
   1. The viewer signs in and lands on the workspace.
   2. They open Slope trial and see the View only pill with no editable fields, then run the scene.
   3. They read the activity log page by page with Show older, and see the invite, the checkpoint and the publish.
   4. If their session ends in another tab, the log sends them to sign in and brings them back to the same page.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Account sign-up and sign-in** Visitors create an account with display name, email and password and sign in with email and password, with exactly one account per address whatever its letter case or surrounding spaces, even under simultaneous sign-ups, as qualified in Business rules.
- **DP-02 — Sign-in landing route** When no safe return path is given, after sign-in the address bar shows `/w/<workspace id>` of the account's last opened workspace, its earliest-joined workspace when it has never opened one, or `/workspaces/new` when it belongs to none, and reloading shows the same screen.
- **DP-03 — Workspace creation and switching** Creating a workspace lands on `/w/<new workspace id>` and choosing another workspace in the account menu lands on `/w/<that workspace id>`, each surviving a reload and a direct visit.
- **DP-04 — Workspace isolation** A signed-in person who is not a member of a workspace gets 404 for that workspace and everything in it, exactly as for an id that does not exist.
- **DP-05 — Co-tutor invite email** An owner's invite leaves exactly one pending invite per workspace and address, superseding any older pending one, and delivers one Mailpit message to the invitee with the subject and link given in Services.
- **DP-06 — Invite lifecycle** An invite moves from pending to accepted, expired or revoked (by the owner or by supersession) only along the legal edges in Business rules, expires on the server clock at its stated time, and every illegal edge answers its stated status.
- **DP-07 — Invite acceptance journey** An invited co-tutor opens the emailed link, signs in or signs up with the invited address, accepts, and lands on `/w/<workspace id>` as a member with the invited role.
- **DP-08 — Mail outage queueing** When mail cannot be sent the invite, share and publish actions still succeed and report the email as queued with the Feedback states copy, and once mail returns each queued message is delivered exactly once in queue order without a restart, except that a message whose invite or link is no longer live is never sent.
- **DP-09 — Workspace roles** Owners, editors and viewers can do exactly what the role table in Business rules allows, and anything else answers 403.
- **DP-10 — Role changes on the next request** An owner's role change applies to the member's very next request on every endpoint, and sends one role-change email to that member.
- **DP-11 — Activity log** Every successful write that names an activity action writes exactly one activity event that owners, editors and viewers can read, newest first.
- **DP-12 — Viewer review journey** A workspace viewer signs in, lands on the workspace, opens a scene in view-only mode with no edit controls, runs it, and reads the activity log.
- **DP-13 — Projects and scenes** Owners and editors create projects and scenes from the four templates, and empty project lists, scene lists and outlines show the Feedback states copy.
- **DP-14 — Placing props** The tutor places rigs and models from the Props panel by click, by Enter or by dragging a tile onto the stage, and the new object appears in the outline, the stage and the saved scene.
- **DP-15 — Keyboard editing on the stage** With the stage focused, arrow and page keys nudge the selected object by the steps in Interactions, Snap rounds the result to the grid, Delete removes it, and undo and redo reverse and reapply each change.
- **DP-16 — Command palette** Ctrl+K or Cmd+K opens the command palette, which filters commands as you type and runs the chosen one with Enter.
- **DP-17 — Inline rename** F2 or a double-click opens an inline rename on an outline row that Enter commits and Escape cancels, and autosave, lock-renewal and presence updates never close or reset it while it is open.
- **DP-18 — Parameter units, ranges and field errors** Parameter fields accept the published unit suffixes and show the SI value on blur, and an unknown unit or an out-of-range value shows its field error, is never saved, and blanks the affected readouts.
- **DP-19 — Live derived readouts** The Derived readouts region recomputes potential energy, speed at the bottom, period, time of flight, range and peak height from the published formulas on every keystroke and after a co-tutor's saved change, without a submit or reload, never overwriting the text in a field being typed in, and announces the new values.
- **DP-20 — Material popover** The Material popover sets a ramp's friction from four named surfaces, keeps focus inside until Escape or a choice, and stays open while autosave, lock and presence timers fire.
- **DP-21 — Bench-to-run cut** Run, or the R key, switches the editor to run mode in one frame: dock panels and the camera view widget hide, the mode pill and centre mark appear, and Pause and Step become available.
- **DP-22 — Fixed-step run telemetry** A run advances a fixed-step simulation at 1/120 second per step regardless of frame rate, and the Run telemetry card shows fps with its colour band, frame time, step count and state hash.
- **DP-23 — Stop restores the bench** Stop, or the R key again, returns every object to its pre-run transform, restores each dock panel to its previous position, and shows the same state hash as before the run, without saving anything.
- **DP-24 — Server verifier agreement** For any saved scene and step count the server verifier returns the same state hash that the editor shows after pausing at that step.
- **DP-25 — Same run on every device** The same scene and parameters give the same state hash after the same number of steps on a phone-sized touch browser, a desktop browser and the server.
- **DP-26 — Revision-checked autosave** Autosave sends each change once, in order, with its change id and the revision it was based on, applies a replayed change id only once, and rejects with 412 any save whose fields changed in a newer revision or that predates a restore, as qualified in Business rules.
- **DP-27 — Save status announcements** The Save status live region announces saving, saved, offline and each kind of failed save with the exact Feedback states copy.
- **DP-28 — Conflict dialog journey** When autosave meets a newer revision the editor opens the Scene changed elsewhere dialog, which offers Keep my changes or Use their version and stays open until the person chooses.
- **DP-29 — Object lock leases** Selecting an object takes a lease on it that renews while held, expires on the server clock and is released within five seconds when its tab closes, and of any number of simultaneous requests for a free object exactly one wins while the rest get 409 naming the holder.
- **DP-30 — Fenced object writes** Every object change carries the lease number it was made under, and a change made under an expired or superseded lease is rejected with 409 and never written.
- **DP-31 — Lock-held journey** A co-tutor who selects an object the owner holds sees the lock-held notice with the holder's name, read-only fields, and an announcement when the object becomes free.
- **DP-32 — Presence and live cursors** Everyone with a scene open appears in the People here list and as a labelled live cursor on the other screens within two seconds, and joins, leaves and lock changes are announced in the Collaboration live region.
- **DP-33 — Lock service outage** While the lock service is unreachable the editor shows the lock outage banner, refuses shared edits with 503, keeps Run working, and resumes editing within ten seconds of the service returning without a restart.
- **DP-34 — Upload type and size checks** Uploads are accepted only as GLB, glTF, PNG or JPEG judged by their bytes, up to 10,000,000 bytes, and anything else answers with the stated rejection.
- **DP-35 — Self-contained models and safe names** Models that reference external files and uploads whose names contain slashes, backslashes or two dots in a row are rejected before anything is stored.
- **DP-36 — Scale normalised to metres** Each model's size is measured through the node transforms of its default scene and converted to metres using the unit chosen at upload by the published extent rule, and models outside 0.01 m to 100 m are rejected.
- **DP-37 — Assets stored as submitted** An accepted upload is stored in MinIO byte for byte as submitted under its content hash, counted in the project only after storage confirms it, and replaying the same bytes returns the existing asset.
- **DP-38 — Asset browser journey** The tutor uploads a model and an image through the Assets panel, sees each in its folder with its size in metres, filters the list, and drags the model into the scene at its converted scale.
- **DP-39 — File storage outage** While file storage is unreachable uploads, checkpoints, restores and publishing answer 503 with the storage outage copy, record nothing, and work again on the first request after storage returns.
- **DP-40 — Checkpoint snapshots** A checkpoint stores the scene document as a MinIO snapshot and moves a draft scene to checkpointed.
- **DP-41 — Byte-exact checkpoint restore** Restoring a checkpoint writes a new revision, one above the current one, whose document is byte-identical to the snapshot, including after a Run and Stop cycle, and is refused while someone else holds a lease in the scene.
- **DP-42 — Checkpoint journey** The tutor saves a named checkpoint from the Checkpoints tab, changes the scene, restores the checkpoint through its confirmation dialog, and sees the outline, inspector and state hash return to the checkpoint.
- **DP-43 — Scene publish states** A scene moves through draft, checkpointed, published and unpublished only along the legal edges in Business rules, and publishing a draft or unpublishing an unpublished scene answers 409.
- **DP-44 — Immutable lab bundles** Each publish writes an immutable lab bundle to MinIO whose SHA-256 is the recorded bundle hash and which names every model by the hash of its stored bytes.
- **DP-45 — Publish confirmation email** Each publish sends one confirmation email with the public lab address to the publishing owner.
- **DP-46 — Student lab journey** A student opens a lab link without an account, changes only the exposed parameters, runs the lab, and sees the same state hash that the lab verifier returns for those values.
- **DP-47 — Exposed parameters only** The lab shows controls only for the parameters the owner exposed, and the lab verifier rejects any other parameter with 422.
- **DP-48 — Lab on phones and touch** At phone width the lab keeps the stage on at least 40% of the screen with a tabbed bottom sheet, touch dragging orbits the camera, every control is at least 44 px tall, and reduced motion changes only animations.
- **DP-49 — Missing lab page** An unknown, regenerated-away or unpublished lab link shows the missing-lab page with the exact copy, and its API answers 404.
- **DP-50 — Read-only project links** An owner's read-only project link lets anyone read the project and run its scenes, shows each newly saved revision of an open scene within five seconds without a reload, and answers 405 to any attempt to change something.
- **DP-51 — Link revocation, regeneration and expiry** Revoking or regenerating a read-only or lab link, or reaching its expiry, stops the old link on the very next request and replaces an open read-only view with the dead-link copy within five seconds.
- **DP-52 — Share dialog journey** The owner creates, copies, emails, regenerates and revokes read-only links in the Share project dialog and sees each change announced.
- **DP-53 — Landing scroll story** The landing page scrubs its ramp, pendulum and cart scene and camera with scroll position across the first 3000 pixels of scroll, reverses exactly when scrolled back, and reports its progress on the stage.
- **DP-54 — Landing reduced motion and fallback** Under reduced motion the landing shows still key frames at the four section anchors, and without WebGL it shows a still picture, with every heading and link working in both.
- **DP-55 — Landing stage look** The landing stage shows the product name in large type at the stage edge over a flat sky-and-grass bench with an original procedural ramp, pendulum and capsule cart, ending in the bench toolbar.
- **DP-56 — Editor layouts at published widths** From 1000 pixels wide and up the editor floats its dock panels, from 600 to 999 it docks them in one right-hand column, and below 600 it shows a tabbed bottom sheet with the stage on at least 40% of the height, never overflowing sideways.
- **DP-57 — Dialogs, sheets and shortcuts by keyboard** Every dialog keeps Tab and Shift+Tab inside it, closes on Escape and returns focus to its opener, and every editor shortcut works whichever non-text control has focus.
- **DP-58 — Bench chrome visual language** The editor, lists, settings and dialogs share the compact navy-and-lavender bench chrome with chip buttons, uppercase blue panel titles and pastel state colours that alone carry meaning.
- **DP-59 — Run manifest and health** The app ships `/app/run.json` with install, build and serve commands, serves on port 4173 or `APP_PUBLIC_PORT`, answers `/api/health` with 200, and boots even when a dependency is down.
- **DP-60 — Configuration from the environment** Every service URL and credential is read from the environment at start and never hard-coded in source or sent to the browser.
- **DP-61 — Safe return after sign-in** A screen whose session has ended sends the person to sign in with that screen's address as the return path, and after sign-in the app follows a return path only when it passes the safe-return rule in Business rules.
- **DP-62 — Live demotion of an open editor** When an owner makes an editor a viewer while that editor has a scene open, within five seconds and without a reload the open editor turns view-only, the demoted person's leases are released and announced, and their further writes answer 403.
- **DP-63 — Stable activity paging** The activity log pages newest first by cursor with a capped page size, never repeats or skips an event while new events are written between pages, and the Activity screen adds older pages with Show older.
- **DP-64 — Restore wins over stale saves** After a restore, open co-tutor editors show the restored scene within the live-update time in Business rules, any save based on a pre-restore revision opens the conflict dialog instead of overwriting the restore, and checkpoint names are unique per scene ignoring letter case.

## Frontend

### Screens and layout (DP-02, DP-03, DP-12, DP-13, DP-48, DP-56)

**Routes.** Each route below is the canonical address of its screen. Reloading it or opening it directly shows the same screen, and it needs the session the screen needs.

| Route | Screen |
|---|---|
| `/` | landing page, open to everyone |
| `/sign-in` | sign-in; accepts optional `?invite=<invite token>` and `?return=<path>` |
| `/sign-up` | sign-up; accepts optional `?invite=<invite token>` |
| `/workspaces/new` | the new-workspace form |
| `/w/<workspace id>` | the workspace project list, with links to Settings and Activity |
| `/w/<workspace id>/p/<project id>` | the project page: its scene list with each scene's state |
| `/w/<workspace id>/s/<scene id>` | the scene editor |
| `/w/<workspace id>/settings` | the members table, the invite form and pending invites |
| `/w/<workspace id>/activity` | the activity log |
| `/invite/<invite token>` | the invite screen |
| `/lab/<lab token>` | the public lab |
| `/view/<share token>` | the read-only project |
| `/view/<share token>/s/<scene id>` | the read-only scene |

Any other path shows the not-found page.

**Working screens.** The project list, project page, settings, activity, invite, sign-in and sign-up screens all have the toolbar at the top. Below it, one or two dock-styled panels sit centred on the plain ground colour:
- At 1280x800, each panel is at most about 760 pixels wide.
- At 768x1024, panels fill the width with a small margin.
- At 375x812, panels fill the width, and table rows stack their cells.

**The editor** puts one full-bleed stage behind everything.
- **Toolbar.** A slim toolbar runs across the top. The Run telemetry card sits top-left on the stage just under the toolbar. The camera view widget sits top-right.
- **Breakpoints.** There are exactly three layouts. Every published viewport gets the one named here, and no other breakpoint exists.

  | Layout | Widths | Published viewports | Arrangement |
  |---|---|---|---|
  | Floating | 1000 pixels and up | 1440x900, 1280x800, 1024x768 | Outline floats on the left below the telemetry card, with Props below it. Inspector floats on the right below the camera view widget. Assets floats along the bottom between them. Each panel can be dragged by its header, maximised to fill the stage, or closed. The Windows menu brings a closed panel back. |
  | Docked | 600 to 999 pixels | 768x1024 | The panels dock in one right-hand column about two fifths of the width, as collapsible sections in the order Outline, Inspector, Props, Assets. The stage fills the rest. |
  | Phone | below 600 pixels | 375x812, 390x844 | The panels become one bottom sheet with the tab list Panels (Outline, Inspector, Props, Assets). The sheet is never taller than 60% of the viewport, so the stage always keeps at least 40% of the height above it. |

- **Toolbar overflow.** At every width the toolbar is a single row. When it is wider than the screen, the toolbar scrolls sideways on its own. The page itself never scrolls sideways at any width.

**The public lab** uses the same stage, toolbar and telemetry card. Its toolbar holds only Run, Pause and Step, plus the wordmark. It has two panels, Lab parameters and Derived readouts:
- From 1000 pixels up, they float on the right.
- From 600 to 999 pixels, they dock in a right-hand column.
- Below 600 pixels, they become a bottom sheet with the tab list Lab panels (Parameters, Readouts), and the stage keeps at least 40% of the height.

**The read-only scene** at `/view/...` uses the lab layout. Its panels are the Outline and an Inspector that shows the selected object's values as plain text.

**The landing page** has one stage that stays fixed behind the content while the page scrolls through four sections.
- Sections 1 to 3 are each exactly 1000 pixels tall, so the section anchors (each section's top) sit at scroll distances 0, 1000, 2000 and 3000 pixels.
- Section 4 is at least one viewport tall, so the page can always scroll at least 3000 pixels.
- Each section's text block sits as follows:
  - At 1280x800, in the left third.
  - At 768x1024, across the width in the lower half of the viewport.
  - At 375x812, across the full width in the bottom third.

### Public screens and controls (DP-01, DP-03, DP-07, DP-12–DP-17, DP-20–DP-23, DP-28, DP-31, DP-32, DP-38, DP-42, DP-46–DP-48, DP-52–DP-54, DP-63)

Only these roles and names are public. Panel titles appear in capitals on screen, but their accessible names are written as below.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Landing | `heading "Rampwright"` (level 1) | the product name at the stage edge |
| Landing | `heading "Every number in metres, kilograms and seconds"`, `heading "The same run on every student's screen"`, `heading "Stop, and the bench is exactly as you left it"` (level 2) | section anchors 2, 3 and 4 |
| Landing | `img "Bench preview"` | the landing stage; carries `data-progress` (see Motion and effects) |
| Landing | `link "Start a bench"`, `link "Sign in"` | go to `/sign-up` and `/sign-in` |
| Sign-up | `textbox "Display name"`, `textbox "Email"`, `Password` field, `button "Create account"` | |
| Sign-in | `textbox "Email"`, `Password` field, `button "Sign in"` | |
| Forms | `alert` error summary | heading `There is a problem`, then one link per invalid field that moves focus to it |
| New workspace | `textbox "Workspace name"`, `button "Create workspace"` | |
| Toolbar | `toolbar "Bench tools"` | one Tab stop; arrow keys move between chips |
| Toolbar | `button "Run"` | label reads `Run` in edit mode and `Stop` in run mode |
| Toolbar | `button "Pause"`, `button "Step"` | disabled in edit mode; Pause reads `Resume` while paused |
| Toolbar | `button "Move"`, `button "Rotate"`, `button "Scale"` | pressed state shows the active tool |
| Toolbar | `button "Snap"`, `button "Grid"`, `button "Colliders"` | toggles with a pressed state |
| Toolbar | `link "Labs"`, `button "Assets"`, `button "Share"`, `button "Publish"`, `button "Windows"`, `button "Shortcuts"` | Labs goes to the project page; Assets toggles the Assets panel; Share and Publish are owner-only (see Interactions) |
| Toolbar | `list "People here"` | one item per person present, showing their display name |
| Toolbar | `button "Account"` | the account and workspace pill, showing display name and workspace name |
| Toolbar | wordmark | the plain text `Rampwright`, far right, not a link |
| Toolbar | `status "View only"` pill | text `View only`, shown to viewers and on read-only links |
| Account menu | `menu "Account"` | `menuitemradio` per workspace name, `menuitem "New workspace"`, `menuitem "Sign out"` |
| Windows menu | `menu "Windows"` | `menuitemcheckbox` `Outline`, `Inspector`, `Props`, `Assets`; `menuitem "Reset layout"` |
| Stage | `application "Stage"` | focusable; receives nudge keys |
| Stage | `group "Run telemetry"` | four lines: `fps <n>`, `ms <n.n>`, `step <n>`, `hash <first 12 hash characters>`; `button "More telemetry"` adds a line with the full hash |
| Stage | `status "Mode"` | `RUNNING` or `PAUSED`; shown only in run mode |
| Stage | `img "Centre mark"` | a small plus sign at the exact viewport centre, shown only in run mode |
| Stage | `img "Cursor: <display name>"` | One per other person present whose presence `cursor` is not null. Drawn over the stage in every layout, at the screen position of that person's cursor point, with a visible tag showing their display name. Your own cursor is never shown. A cursor is hidden while its point is off screen. |
| Stage | `group "Camera view"` | `button` `Top`, `Bottom`, `Front`, `Back`, `Right`, `Left`, `Iso` |
| Panels | `region "Outline"`, `region "Inspector"`, `region "Props"`, `region "Assets"` | each with `button "Maximise <title>"` and `button "Close <title>"` |
| Outline | `tree "Scene outline"` | one `treeitem` per object, named by object name; each row shows a `Hide <name>` or `Show <name>` button; a held row shows the holder's initial |
| Outline | object count text | `<n> objects` |
| Outline | `searchbox "Find objects"` | filters rows as you type |
| Outline | `textbox "Rename <name>"` | the inline rename field |
| Inspector, no selection | `textbox "Scene name"`, `spinbutton "Gravity (m/s²)"` | |
| Inspector, any object | `spinbutton "Position X (m)"`, `spinbutton "Position Y (m)"`, `spinbutton "Position Z (m)"` | |
| Inspector, ramp | `spinbutton "Mass (kg)"`, `spinbutton "Angle (degrees)"`, `spinbutton "Length (m)"`, `spinbutton "Friction"`, `button "Material"` | |
| Inspector, pendulum | `spinbutton "Mass (kg)"`, `spinbutton "Length (m)"`, `spinbutton "Release angle (degrees)"` | |
| Inspector, launcher | `spinbutton "Mass (kg)"`, `spinbutton "Launch speed (m/s)"`, `spinbutton "Launch angle (degrees)"`, `spinbutton "Launch height (m)"` | |
| Inspector, crate | `spinbutton "Mass (kg)"` | |
| Inspector | parameter fields | every `spinbutton` above is a text entry that accepts a number with an optional unit (Business rules, Parameter entry); Up and Down change it by its step |
| Inspector, read-only | value rows | one row per field, reading `<field label>: <value>`, where `<value>` is the number exactly as the scene document writes it |
| Inspector | `region "Derived readouts"` | a polite live region; rows read `<label>: <value> <unit>` |
| Inspector | `status "Lock notice"` | the lock-held notice |
| Material | `dialog "Material"` | `radio` `Frictionless`, `Ice`, `Polished wood`, `Rubber mat` |
| Props | `tablist "Prop types"` | tabs `Rigs` and `Models` |
| Props | tiles | Rigs tab: `button "Add ramp"`, `button "Add pendulum"`, `button "Add launcher"`, `button "Add crate"`; Models tab: `button "Add <asset name>"` |
| Assets | `tablist "Asset views"` | tabs `Files` and `Checkpoints` |
| Assets, Files | `tree "Folders"` | items `Models` and `Images` |
| Assets, Files | `list "Folder contents"` | each item shows the file name and, for models, `<extent> m` with the extent in metres to two decimals |
| Assets, Files | `button "Upload"`, `combobox "Model units"`, `searchbox "Filter assets"` | Model units options `m`, `cm`, `mm`, `in`, `ft`; default `m` |
| Assets, Files | footer | breadcrumb `Assets / <folder>`, `slider "Thumbnail size"`, `button "List view"` (pressed state) |
| Assets, Checkpoints | `button "New checkpoint"`, `textbox "Checkpoint name"`, `button "Save checkpoint"` | |
| Assets, Checkpoints | checkpoint rows | each with `button "Restore <label>"` |
| Restore | `alertdialog "Restore checkpoint"` | `button "Restore"`, `button "Cancel"` |
| Conflict | `alertdialog "Scene changed elsewhere"` | `button "Keep my changes"`, `button "Use their version"` |
| Commands | `dialog "Commands"` | `combobox "Command"` and `listbox "Matching commands"` |
| Shortcuts | `dialog "Keyboard shortcuts"` | lists every shortcut in Interactions |
| Publish | `dialog "Publish lab"` | `combobox "Checkpoint"`; `checkbox "<object name>: <parameter label>"` per rig parameter; `button "Publish lab"`; once published: the lab address as text, `button "Copy lab link"`, `button "Regenerate lab link"`, `button "Unpublish"` |
| Share | `dialog "Share project"` | `button "Create read-only link"`, `textbox "Email the link to"`, `button "Create and email link"`; `list "Active links"` with rows showing `Expires <date>`, `button "Copy link"`, `button "Regenerate link"` and `button "Revoke link"` |
| Project list | `region "Projects"` | `button "New project"`, `textbox "Project name"`, `button "Create project"`; one link per project |
| Project page | `region "Scenes"` | one link per scene with a state chip `Draft`, `Checkpointed`, `Published` or `Unpublished`; `button "New scene"` |
| New scene | `dialog "New scene"` | `textbox "Scene name"`; `radio` `Blank`, `Ramp`, `Pendulum`, `Launcher`; `button "Create scene"` |
| Settings | `table "Members"` | `combobox "Role for <display name>"` (options `Editor`, `Viewer`); the owner's row shows `Owner` |
| Settings | invite form | `textbox "Invite email"`, `combobox "Invite role"` (`Editor`, `Viewer`), `button "Send invite"` |
| Settings | `table "Pending invites"` | `button "Revoke invite to <email>"` |
| Activity | `list "Activity"` | one `listitem` per event, newest first, with the text and time format in Business rules (Activity) |
| Activity | `button "Show older"` | shown while older events remain |
| Invite | `button "Accept invite"` | screen heading `Join <workspace name>` |
| Lab | `heading` level 1 | the scene name |
| Lab | `region "Lab parameters"` | `slider "<object name>: <parameter label>"` per exposed parameter, with its value and unit beside it |
| Lab, phone | `tablist "Lab panels"` | tabs `Parameters` and `Readouts` |
| Editor, phone | `tablist "Panels"` | tabs `Outline`, `Inspector`, `Props`, `Assets` |
| Live regions | `status "Save status"`, `status "Collaboration"`, `status "Notices"`, `status "Upload status"` | copy in Feedback states |
| Banner | `alert` at the top of the stage or page | service outage copy |

### Interactions (DP-14–DP-17, DP-19, DP-20–DP-23, DP-28, DP-31, DP-38, DP-42, DP-46, DP-48, DP-52, DP-57, DP-61, DP-63)

**Keyboard everywhere.**
- Tab order in the editor:
  1. the toolbar (one stop; Left and Right move between chips, Home and End jump to the ends)
  2. the stage
  3. the outline tree (one stop; Up and Down move, Right and Left do nothing because the tree is flat, Enter selects)
  4. inspector fields
  5. Props tiles (one stop; arrow keys move through the grid, Enter adds)
  6. Assets
- Every dialog and alert dialog keeps Tab and Shift+Tab inside itself: Tab on the last control wraps to the first, and Shift+Tab on the first wraps to the last.
- Escape closes a dialog, or chooses Cancel in an alert dialog that has one. Focus then returns to the control that opened it. A dialog the system opens, such as the conflict dialog, returns focus to whatever was focused before it appeared.
- The phone bottom sheet is not modal. Its tab list takes arrow keys, and Escape moves focus back to its tab.

**Editor shortcuts.** These work whichever control has focus, including any toolbar button, tile or tree row. They are suspended only while focus is in a text, number or search field, or while a dialog is open.

| Key | Action |
|---|---|
| R | Run, or Stop while running |
| P | Pause or Resume |
| N | Step |
| Escape | Stop, while running and no dialog is open |
| W, E, T | Move, Rotate, Scale |
| S | Snap |
| G | Grid |
| F | frame the selected object |
| Delete or Backspace | remove the selected object |
| F2 | rename the selected object |
| Ctrl+Z or Cmd+Z | undo |
| Ctrl+Shift+Z, Cmd+Shift+Z or Ctrl+Y | redo |
| Ctrl+K or Cmd+K | open the command palette |
| `?` | open Keyboard shortcuts |

**Selecting.** Any of these selects an object:
- clicking it on the stage
- choosing its outline row with Enter or a click
- choosing its match in the command palette

Selecting also requests that object's lease (see Business rules). Clicking empty stage, or pressing Escape in edit mode, clears the selection, and the inspector then shows the scene fields.

**Nudging with the stage focused.**
- In Move mode:
  - Left and Right move the selected object along X by 0.1 m.
  - Up and Down move it along Z by 0.1 m. Up moves away from the default camera, toward negative Z.
  - Page Up and Page Down move it along Y by 0.1 m.
  - Holding Shift makes each step 0.01 m.
  - With Snap on, each step is 0.25 m and the resulting coordinate is rounded to the nearest multiple of 0.25 m.
- In Rotate mode, Left and Right turn the object about the vertical axis by 5 degrees, or by 15 degrees with Snap on.
- In Scale mode, Up and Down change all three scale factors together by 0.1.
- Dragging the gizmo with the pointer does the same, and Snap applies the same rounding.
- Every resulting coordinate and scale factor is rounded to the nearest millionth before it is saved.
- Each key press or finished drag is one change and one undo step.

**Parameter fields.**
- Typing in a field updates the Derived readouts on every keystroke.
- The field's value is committed as one change once it is valid and half a second has passed since the last keystroke, or at once on Enter or blur.
- On blur the field shows the SI value by the Parameter entry rule.
- An invalid value shows its field error under the field, makes the Save status show the field-error copy at once (Feedback states), and is never committed.

**Remote changes.** When a co-tutor's saved revision arrives (see Business rules, Live updates):
- The outline, the stage, the readouts and every inspector field that does not have focus show the new values.
- A field that has focus keeps exactly the text and caret position the person typed.
- The readouts then use that typed value together with the remote values of the other fields.

**Undo and redo.**
- Each person has their own undo history for the open scene, kept in that tab.
- Undo and redo apply as ordinary changes and are saved like any other.
- If an undo targets an object someone else now holds, the lock-held notice appears and the history entry stays in place.

**Placing props.**
- Clicking a tile, or pressing Enter on it, adds that rig at the stage centre on the ground (position 0, 0, 0).
- Dragging a tile onto the stage adds it at the drop point on the ground, rounded when Snap is on.
- A new object gets the next free name: `Ramp <n>`, `Pendulum <n>`, `Launcher <n>`, `Crate <n>`, or the asset's file name without its extension.
- Its id is its kind followed by a short random suffix.
- Its parameters start at the template defaults in Business rules. A model is placed at its converted scale.
- The new object becomes selected.

**Command palette.**
- Typing filters the listbox to commands whose label contains the typed text, ignoring case.
- Up and Down move the active option, and Enter runs it.
- The commands are `Run`, `Stop`, `Pause`, `Step`, `Add ramp`, `Add pendulum`, `Add launcher`, `Add crate`, `Toggle snap`, `Toggle grid`, `Undo`, `Redo`, `New checkpoint`, `Open publish`, `Open share`, `Reset layout`, plus `Select <object name>` for each object.

**Inline rename.**
- F2 or a double-click on a row replaces the row's name with the rename field, with the current name selected.
- Enter commits, and Escape restores the old name. Either way, focus returns to the row.
- While the field is open, a presence update, a lease renewal, an incoming revision or an autosave from another field never closes it, clears its text or moves its caret.

**Material popover.**
- Material opens the popover anchored to the button, with the current surface checked.
- Arrow keys move between surfaces. Enter or a click applies one and closes the popover. Escape closes it without change.
- Like rename, it stays open and keeps its focused option through timers and incoming updates.

**Run cycle.** The signature steps are in Motion and effects.
- Pause freezes the simulation and shows `PAUSED`.
- Step, while running or paused, pauses if needed and advances exactly one step.
- Once started, a run takes no input. A run in the editor never edits or saves the scene.
- While running, inspector fields, nudges, placing and rename are disabled.

**Camera.**
- With a pointer: dragging empty stage orbits the camera, the wheel zooms, and right-drag pans.
- On touch: one finger orbits, two fingers pinch to zoom, and a two-finger drag pans. This also works with reduced motion.
- Each camera view button turns the camera to that view.

**Conflict dialog.**
- Keep my changes reapplies your unsaved changes on top of the newer revision and saves them. Any of your changes to an object that the newer revision removed is dropped.
- Use their version discards your unsaved changes and loads the newer revision.
- While the dialog is open, autosave holds your changes and does not retry. Presence, lease and live-update timers keep running without closing or redrawing the dialog.

**Lock-held selection.** If the lease request is refused, the object stays selected with its inspector values shown as read-only, and the lock notice names the holder. When the holder lets go, the editor takes the lease automatically if the object is still selected, and the fields become editable.

**Owner-only toolbar actions.**
- For editors and viewers, Share and Publish show a small lock glyph, are disabled, and carry the description `Only the workspace owner can share or publish.`
- Viewers see every inspector value as text, and placing, nudging and rename are disabled for them. Run, Pause, Step and Stop stay available.
- When the person's role changes while the editor is open, the editor switches between these two states within the time in Business rules (Roles), without a reload. An open rename or Material popover closes without saving when the role becomes viewer.

**Assets panel.**
- Upload opens the file picker and uses the unit chosen in Model units. Dropping files on the panel does the same.
- A finished upload appears in its folder (Models for GLB and glTF, Images for PNG and JPEG), and that folder becomes selected.
- The filter narrows the folder contents as you type.
- The thumbnail slider resizes tiles, and List view switches tiles to rows.
- Models also appear as tiles in the Props Models tab, ready to drag onto the stage.

**Checkpoints tab.**
- New checkpoint shows the name field and Save checkpoint.
- Restore `<label>` opens the Restore checkpoint dialog.
- After a restore, the outline, inspector and telemetry hash show the restored scene.

**Activity screen.**
- The list shows the newest 50 events.
- Show older fetches the next 50 older events and appends them below the rows already shown. Rows already shown are never removed or reordered.
- Focus stays on Show older, which disappears once no older events remain.

**Session ending.** When any request from a signed-in screen answers `401 unauthenticated`, the browser goes to `/sign-in?return=<encoded>`. `<encoded>` is that screen's path and query, with every character other than letters, digits and `-_.!~*'()` percent-encoded (so `/` becomes `%2F`). For example, `/w/<id>/activity` gives `/sign-in?return=%2Fw%2F<id>%2Factivity`. A signed-out visit to any `/w/...` route goes there the same way.

**Navigation after actions.** Business rules (Landing routes) owns where each action lands.

**Lab.**
- Dragging a parameter slider, or using its arrow keys, changes the value by the step in Business rules and updates the readouts in place.
- Sliders are disabled while running.
- Run, Pause, Step and Stop behave as in the editor.
- Stop returns the lab to its start state for the current slider values.

**Read-only scene.**
- Clicking an object or pressing Enter on its outline row selects it. No lease is requested.
- The selection and the open panel survive incoming revisions.

### Visual design (DP-55, DP-58)

Rampwright keeps the seeded bench look: a dense, unornamented instrument chrome floating over a deliberately flat stage.

**Type.**
- Inter is the interface face for labels, rows, buttons, panel titles and the landing name.
- JetBrains Mono is used for every number on the telemetry card, the state hash, readout values and the glyph icons.
- Body text, rows and buttons are small and close in size, each step about a tenth larger than the one below.
- Panel titles and tab labels are small, bold, uppercase, slightly letter-spaced and set in the accent blue.
- The mode pill is small, bold and uppercase.
- The one exception is the landing name, set in heavy Inter and very large (roughly a quarter of the viewport width on desktop).

**Colour roles.**

| Role | Colour | Used for |
|---|---|---|
| Ground | a very dark navy | behind the toolbar and panel bodies |
| Surface | a lighter slate-navy | chip buttons, rows and inputs |
| Border | a muted slate | dividers, panel edges and chip outlines |
| Ink | a pale lavender-white | text |
| Muted ink | a grey-lavender | empty states, counts and the wordmark |
| Accent | a soft periwinkle blue, with dark navy text on accent fills | active toggles, panel titles, the selected tab and slider thumbs |
| Go | a pastel green | the Stop chip while running, the mode pill text, and fps of 50 or more |
| Publish | a pastel lilac on a faint lilac-tinted fill | the text of the Labs, Assets and Publish buttons; Publish also has a faint lilac outline and stands a little taller than the other chips |
| Warning | a pale butter yellow | fps of 30 to 49, and the outage banner |
| Danger | a pastel rose | fps below 30, field errors and the X-axis stripe |
| Viewport sky | a flat sky blue | only inside the stage |
| Viewport ground | a flat grass-green ground plane | only inside the stage |

**Components.**
- **Toolbar chip buttons**:
  - shape: small rectangles with slightly rounded corners, a surface fill and a thin border
  - toggled chips fill with the accent, and the running Stop chip fills with the go green
  - hover brightens the border and the text
  - disabled chips are drawn at half strength
- **Toolbar cluster dividers** are short, thin vertical lines in the border colour. They split the toolbar, left to right, into:
  1. playback
  2. transform tool
  3. toggles
  4. workspace (Labs, Assets, Share, Publish, Windows, Shortcuts)
  5. People here and the account pill
  6. the wordmark, flush right in muted ink
- **The account and workspace pill** is a darker rounded pill holding a small round avatar disc, the bold display name, the workspace name and a down caret.
- **The run telemetry and hash card** is a small, nearly opaque, dark slate-teal card with rounded corners. It holds four monospace lines, the fps line in bold, and has a tiny muted expander at its top-right corner.
- **The run-mode status pill** is a dark rounded pill with green uppercase text, centred at the top of the stage.
- **The run-mode centre reticle** is a small semi-transparent white plus sign that ignores the pointer.
- **Draggable dock panels**:
  - header: slim, with the uppercase blue title on the left and small maximise and close glyph buttons on the right
  - body: the ground colour, with a thin border, rounded corners and a soft dark drop shadow
- **The scene outline list**:
  - a small sub-toolbar (count, add chip, find field) sits above compact rows
  - each row shows a type glyph, the name, and eye and lock toggles on the right
  - hover fills the row with the surface colour
  - a selected row gets a faint accent tint and an accent bar on its left edge
  - a hidden object's row is drawn at half strength
- **The project asset browser**:
  - a tabbed panel whose active tab is underlined
  - a sub-toolbar of small chips and a filter field
  - a body split into a folder tree on the left (the selected folder in a surface fill with blue text) and the contents on the right
  - a slim footer holding the breadcrumb, the size slider and the list toggle
- **The prop palette**:
  - two uppercase tabs, the active one in accent with an accent underline
  - below them, a two-column grid of small tiles, each with an original monospace glyph above a tiny label
  - hover turns a tile's border accent blue
- **The camera view widget** is a small translucent slate box:
  - a two-by-three grid of tiny buttons, plus a full-width Iso button
  - each paired button has a thin colour stripe on its left: green for the vertical pair, blue for the depth pair, rose for the horizontal pair

**Working screens.** The project list, project page, asset library, settings, activity log, share dialog and publish dialog use the same dock-panel styling, compact rows, chip buttons and uppercase blue titles.
- Empty, loading and error states are short muted lines centred in the panel.
- Icons are an original set of typed glyphs or small inline line drawings.
- Meaning never depends on colour alone. Each state colour also comes with a word (`RUNNING`, `PAUSED`, `fps`, a banner sentence).

**Size and contrast.**
- On desktop pointers, rows and chips are compact but never smaller than 24 px in either direction.
- At phone width, and whenever the primary pointer is coarse (touch), every control and row is at least 44 px tall and at least 44 px wide.
- Text and essential control boundaries meet WCAG 2.2 AA contrast against their backgrounds, including muted ink on the ground colour.

**Landing hero.**
- The stage is a full-viewport WebGL scene built only from primitives:
  - a flat sky
  - a flat green ground with a faint grid
  - a wooden-toned ramp
  - a pendulum on a thin frame
  - a small cart made of rounded capsules, in its own proportions and colours
- The name Rampwright sits in heavy Inter at the stage's lower-left edge.
- Section copy sits in small dock-styled panels over the stage.
- The page ends with the bench toolbar across the top of the stage.

### Motion and effects (DP-21–DP-23, DP-48, DP-53, DP-54)

- Chip buttons, tabs and rows change only colour, border and fill, over about a tenth of a second. Chrome never animates position or size.
- A panel opening or closing fades over at most a tenth of a second.
- Camera view buttons turn the camera to the chosen view in about a quarter of a second.
- Telemetry values refresh about twice a second in steps and are never tweened. Step and hash always refresh together, so they describe the same step, and they update at once on Pause and Step.
- In edit mode the stage does not move by itself: no idle spin, no bobbing, no pulsing.
- There are no looping animations anywhere in the product besides the running simulation.

**Signature: Bench-to-run cut.**
1. In edit mode the tutor clicks Run or presses R.
2. In the same frame:
   - every dock panel and the camera view widget disappear, with no fade
   - the Run chip's label becomes `Stop` and the chip fills with go green; this is the only change with a colour transition, of about a tenth of a second
   - Pause and Step become enabled
   - the `RUNNING` mode pill appears centred at the top of the stage
   - the centre mark appears at the exact viewport centre
   - the telemetry card stays where it is
3. The simulation starts at step 0 and advances by fixed steps of 1/120 second each. The fps line changes colour live as the measured frame rate crosses the bands in Visual design.
4. Stop, R or Escape returns to edit mode in one frame:
   - the panels and the widget reappear exactly where they were, including any dragged or closed state
   - every object snaps back to its pre-run position, rotation and scale
   - telemetry `step` returns to `0`, and `hash` shows the same characters it showed before Run
   - the chip returns to `Run`, again with only the colour transition

**Landing scroll story.** The stage's scene and camera are a pure function of how far the page has scrolled over its first 3000 pixels. Progress is the scroll distance divided by 3000, held between 0 and 1. The `img "Bench preview"` element's `data-progress` attribute always shows that progress with three decimals (for example `0.000`, `0.500`, `1.000`).

| Scroll distance | What happens |
|---|---|
| 0 to 1000 | the capsule cart rolls from the top of the ramp to its foot, while the camera moves from a wide three-quarter shot to the ramp's side |
| 1000 to 2000 | the pendulum swings from its release point to the opposite side, while the camera orbits about a quarter turn |
| 2000 to 3000 | the camera rises to a high three-quarter view, and the bench toolbar fades in across the top, fully present from progress 0.900 |

Scrolling back reverses every change step for step. Stopping the scroll stops all motion.

**Reduced motion** (the visitor's reduced-motion setting):
- Chrome colour transitions, panel fades and camera turns happen instantly.
- The landing shows still key frames only, one per section. The key frame is chosen by absolute scroll distance, with thresholds exactly at the section anchors, and `data-progress` shows that value:

  | Scroll distance | Section | `data-progress` | Still shown |
  |---|---|---|---|
  | below 1000 | 1 | `0.000` | the opening state: the cart at the top of the ramp, the pendulum held at its release point, the wide three-quarter shot, and no toolbar |
  | 1000 to below 2000 | 2 | `0.333` | the cart at the foot of the ramp and the camera at the ramp's side (the end of the first stretch) |
  | 2000 to below 3000 | 3 | `0.667` | the pendulum at the opposite side and the camera a quarter turn round (the end of the second stretch) |
  | 3000 or more | 4 | `1.000` | the high three-quarter view with the bench toolbar fully present (the end of the third stretch) |

  Each still is what the motion version shows at its section's anchor, so each scroll stretch's end state appears at once.
- Run, Pause, Step, Stop, the hash and the telemetry work exactly as with motion. The simulation itself still moves, because it is the content.
- Touch and pointer camera orbit still work.

**Without WebGL.**
- The landing stage becomes a still drawn picture `img "Bench preview"` of the ramp, pendulum and cart. Headings and links are unchanged, and `data-progress` still reports progress.
- The editor and lab show the no-WebGL copy from Feedback states where the stage would be. Panels still work, and Run is disabled.

### Feedback states (DP-08, DP-13, DP-18, DP-19, DP-27, DP-31–DP-33, DP-39, DP-49, DP-51, DP-52, DP-54, DP-62, DP-63)

Every async action shows its state in the named live region below, with exactly this copy:
- Apostrophes and quotation marks are straight, an ellipsis is three plain dots, and `<placeholders>` are filled in.
- A newer message replaces the old one and is never overwritten by a later repaint of the same screen.
- A message stays until the next action in that region.

**Field errors.** Each appears under its field, which is marked invalid. The form's `alert` summary links to each one. On the API side, each is the value under `fields` at the key shown. `<objectId>`, `<param>` and `<key>` follow the field keys in API.

| Field | Key under `fields` | Copy |
|---|---|---|
| display name missing or over 60 characters | `displayName` | `Enter a name of 1 to 60 characters.` |
| email (sign-up, sign-in, invite, share link) | `email` | `Enter a valid email address.` |
| email already used at sign-up | `email` | `An account already uses this email.` |
| password | `password` | `Use 10 to 128 characters.` |
| workspace, project, scene, object or checkpoint name | `name` (workspace, project, new scene); `label` (checkpoint); `scene.name` or `<objectId>.name` (in a scene PATCH) | `Names need 1 to 60 characters.` |
| checkpoint name already used in this scene | `label` | `A checkpoint with this name already exists.` |
| parameter text that does not start with a number | none (editor only) | `Enter a number.` |
| unknown unit on a mass field | none (editor only) | `Use kg, g or lb.` |
| unknown unit on a length, height or position field | none (editor only) | `Use m, cm, mm, in or ft.` |
| unknown unit on an angle field | none (editor only) | `Use deg or rad.` |
| any numeric parameter, gravity or slider value out of range | `scene.gravity` or `<objectId>.params.<param>` (in a PATCH); `<objectId>.<param>` (in a verify request) | `Enter a value from <min> to <max>.` (`<min>` and `<max>` are the range ends from Business rules, written as there) |
| transform out of bounds | `<objectId>.position`, `<objectId>.rotation` or `<objectId>.scale` | `Keep objects within 500 m of the origin and scale between 0.01 and 100.` |
| upload type | `file` | `Upload a GLB, glTF, PNG or JPEG file.` |
| upload damaged | `file` | `This model file is damaged or is not glTF 2.0.` |
| upload external references | `file` | `Models must be self-contained: embed every buffer and texture.` |
| upload name | `name` | `Use a file name of 1 to 120 characters without slashes, backslashes or "..".` |
| upload unit | `unit` | `Choose m, cm, mm, in or ft.` |
| upload extent | `file` | `After converting to metres the model must measure from 0.01 m to 100 m across.` |
| upload too large | none: the 413 response carries this copy in `error.message` and has no `fields` | `Files must be 10,000,000 bytes or smaller.` |
| steps | `steps` | `Steps must be from 1 to 12000.` |
| unexposed lab parameter | `<key>`, the `<objectId>.<param>` key as sent | `<key> is not adjustable in this lab.` |
| exposed choice | `exposed` | `Choose up to 8 parameters from this scene.` |
| invite role or member role | `role` | `Choose Editor or Viewer.` |

**Form error** (in the `alert` summary): a failed sign-in shows `Email or password is incorrect.`

**Save status** (`status "Save status"`, editor):

| State | Copy |
|---|---|
| pending | `Saving...` |
| success | `All changes saved` |
| offline, changes queued | `Offline: changes will save when you reconnect.` |
| revision conflict | `Not saved: this scene changed elsewhere` |
| lease lost | `Not saved: your hold on <object name> ran out` |
| lock outage | `Not saved: live editing is paused` |
| demoted or removed | `Not saved: you can no longer edit this scene.` |
| field error | `Not saved: check the highlighted value` |
| restore done | `Restored checkpoint <label>` |
| restore refused | `Restore blocked while others are editing objects` |

The demoted copy appears as soon as the editor learns of the demotion, whether or not a save was pending.

The field-error copy appears on the keystroke that makes a parameter field hold an invalid value (an unparseable number, an unknown unit or an out-of-range value), without waiting for blur or for the half-second commit delay. It also appears when a PATCH answers `422 validation`. It stays while any parameter field is invalid. Once every parameter field is valid again, the Save status returns to the state it showed before the error, or to `Saving...` and then `All changes saved` if a change is committed.

**Collaboration** (`status "Collaboration"`, editor):
- `<name> joined the scene`
- `<name> left the scene`
- `<name> is now editing <object name>`
- `<object name> is free to edit`
- `<name> is now Viewer`, or `<name> is now Editor`, announced on every open editor of the scene when that person's role changes

**Lock notice** (`status "Lock notice"`): `<name> is editing <object name>. You can view it but cannot change it until they finish.`

**Derived readouts** (`region "Derived readouts"`):
- Rows read `<label>: <value> <unit>`, with `<value>` rounded to two decimals.
- A row whose inputs are invalid reads `<label>: n/a`.
- A ramp whose cart does not slide reads `Speed at bottom: 0.00 m/s`.

**Notices** (`status "Notices"`, every page and dialog):

| Action | Pending | Success | Other |
|---|---|---|---|
| Invite (new or re-invite) | `Sending invite...` | mail delivered: `Invite sent to <email>`; mail queued: `Invite saved for <email>. The email will go out when mail is back.` | |
| Revoke invite | | `Invite to <email> revoked` | |
| Role change | | `<name> is now <Editor or Viewer>` | |
| Project or scene creation | | `<name> created` | |
| Checkpoint | `Saving checkpoint...` | `Checkpoint <label> saved` | |
| Publish | `Publishing...` | mail delivered: `Lab published at <lab address>`; mail queued: `Lab published at <lab address>. The confirmation email will go out when mail is back.` | refused because no checkpoint exists: `Save a checkpoint before publishing.` |
| Unpublish | | `Lab unpublished. Its link no longer works.` | |
| Regenerate lab link | | `New lab link created. The old link no longer works.` | |
| Create read-only link | | `Link created` | |
| Create and email link | | mail delivered: `Link emailed to <email>`; mail queued: `Link created. The email to <email> will go out when mail is back.` | |
| Regenerate read-only link | | `New link created. The old link no longer works.` | |
| Revoke read-only link | | `Link revoked` | |
| Copy | | `Copied` | |
| Activity page load (initial or Show older) | `Loading...` | `Showing <n> events`, where `<n>` is the number of rows now shown | none when the log is empty |

`<lab address>` is `<APP_PUBLIC_URL>/lab/<lab token>`.

**Upload status** (`status "Upload status"`):
- pending: `Uploading <file name>...`
- success: `<file name> added to <Models or Images>`
- replay of identical bytes: `<file name> is already in this project`
- field error: the upload field copy above
- storage outage: `File storage is unreachable. Nothing was uploaded.`

**Outage banners** (`alert`, top of the stage or page). Each appears within five seconds of the editor learning of the outage and clears within five seconds of recovery.
- Lock service: `Live editing is paused because the lock service is unreachable. You can still run the scene.`
- File storage: `File storage is unreachable. Uploads, checkpoints and publishing are paused.`

**Empty states** (muted, centred in the panel):
- project list: `No projects yet. Create one to start a bench.`
- scene list: `This project has no scenes yet.`
- outline: `No objects. Add one from Props.`
- asset folder: `This folder is empty. Drop a GLB, glTF, PNG or JPEG file here.`
- Models tab in Props: `No models yet. Upload one in Assets.`
- checkpoints: `No checkpoints yet.`
- activity list: `No activity yet.`
- active links: `No active links.`
- People here when the lock service is down: `Presence unavailable`

**Pages.**
- Missing lab: heading `We couldn't find this lab`, then `The link may have been withdrawn or replaced. Ask your tutor for a new one.`
- Lab with storage down: heading `This lab cannot load right now`, then `Try again in a minute.`
- Dead read-only link: a level-1 heading reading exactly `This link no longer works. Ask the owner for a new one.` It is shown on a fresh visit, and it also replaces an open read-only project or scene.
- Not found: heading `We couldn't find that page`

**Invite screen states:**

| State | Copy |
|---|---|
| expired | `This invite has expired. Ask for a new one.` |
| revoked by the owner | `This invite was withdrawn.` |
| superseded | `This invite was replaced by a newer one. Use the latest email.` |
| used | `This invite has already been used.` |
| address mismatch | `This invite is for <email>. Sign in with that address to accept it.` |

**No WebGL:** `The 3D stage needs WebGL, which this browser cannot provide. Panels still work; Run is unavailable.`

**Loading:** any panel waiting for data shows `Loading...`.

## Backend

### API (DP-01, DP-04–DP-06, DP-09–DP-11, DP-13, DP-24, DP-26, DP-29, DP-30, DP-34–DP-37, DP-40, DP-41, DP-43–DP-47, DP-50, DP-51, DP-59, DP-61, DP-63, DP-64)

**Conventions.**
- All endpoints live under `/api`.
- Requests and responses are `application/json; charset=utf-8` unless a row says otherwise.
- Ids and tokens are opaque random strings. Tokens carry at least 128 bits of randomness and are URL-safe.
- Timestamps are ISO 8601 UTC strings with milliseconds, ending in `Z`.
- The session is an HttpOnly, SameSite=Lax cookie set by sign-up and sign-in.
- Every endpoint except those marked public needs a session.

**Error shape.** Every error has one shape:

```
{"error":{"code":"<code>","message":"<sentence>","fields":{"<field>":"<message>"},"details":{}}}
```

- `fields` is present only on `422 validation`, `409 email_taken` and `409 checkpoint_name_taken`, and its values are the field copy from Feedback states.
- `details` is present only where a row lists it.

**Error precedence.** One rule covers every endpoint:
1. `405 read_only` (read-only link paths)
2. `413 payload_too_large`, then `415 unsupported_media_type` (Server boundary)
3. `403 cross_origin`
4. `401 unauthenticated`
5. `404 not_found` for an unknown resource or one in a workspace the caller is not a member of (and `404 link_not_found` for dead link tokens)
6. `403 forbidden` for a role that may not do this, and `403 invite_email_mismatch`
7. an idempotent replay, which returns its stored result; the same key with a different body answers `409 change_id_reused`
8. `503 lock_store_unavailable` or `503 storage_unavailable` when a service the action needs is unreachable
9. state conflicts (`409`, `410`, `412`), in the order a row lists them
10. `422 validation` and `422 invalid_cursor`

Rows list only their own extra errors.

**Auth and workspaces**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/auth/sign-up` (public) | `{"displayName","email","password","invite"?}` | `201 {"user":{"id","email","displayName"},"landing":"/workspaces/new" \| "/invite/<token>"}` | `409 email_taken` |
| `POST /api/auth/sign-in` (public) | `{"email","password","invite"?,"return"?}` | `200 {"user":{...},"landing":"<route>"}`, with landing per Business rules (Landing routes) | `401 bad_credentials` |
| `POST /api/auth/sign-out` | | `204` | |
| `GET /api/me` | | `200 {"user":{...},"workspaces":[{"id","name","role"}],"lastWorkspaceId":"<id>"\|null}` | |
| `POST /api/workspaces` | `{"name"}` | `201 {"workspace":{"id","name","role":"owner"}}` | |
| `GET /api/workspaces/<wid>` | | `200 {"workspace":{"id","name","role"},"members":[{"userId","displayName","email","role"}],"invites":[...]}` | |
| `PATCH /api/workspaces/<wid>/members/<userId>` | `{"role":"editor"\|"viewer"}` | `200 {"member":{...}}` | `409 owner_role_fixed` when the target is the owner |

- `POST /api/workspaces` writes activity `workspace.created` and records the new workspace as the caller's last opened.
- In `GET /api/workspaces/<wid>`, `invites` is the list of pending invites for the owner and `[]` for everyone else. The call also records this workspace as the caller's last opened.
- The member role change writes activity `member.role_changed`.

**Invites**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/workspaces/<wid>/invites` | `{"email","role":"editor"\|"viewer"}` | `201 {"invite":{"id","email","role","status":"pending","expiresAt"},"delivery":"sent"\|"queued","superseded":"<old invite id>"\|null}` | `409 already_member` |
| `DELETE /api/workspaces/<wid>/invites/<inviteId>` | | `200 {"invite":{...,"status":"revoked","reason":"owner"}}` | `409 invite_used`, `410 invite_superseded`, `410 invite_revoked`, `410 invite_expired` |
| `GET /api/invites/<token>` (public) | | `200 {"invite":{"workspaceName","email","role","status","reason","expiresAt"}}` | `410 invite_superseded` |
| `POST /api/invites/<token>/accept` | | `200 {"workspaceId","role","landing":"/w/<wid>"}` | `403 invite_email_mismatch`, `409 invite_used`, `410 invite_superseded`, `410 invite_revoked`, `410 invite_expired` |

- Creating an invite writes activity `invite.created`, revoking writes `invite.revoked`, and accepting writes `invite.accepted`.
- `reason` is `"owner"` or `"superseded"` on revoked invites and `null` otherwise.
- Accepting also records the workspace as the caller's last opened.

**Activity**

| Method and path | Success | Extra errors |
|---|---|---|
| `GET /api/workspaces/<wid>/activity?limit=<1..100>&before=<event id>` | `200 {"events":[{"id","at","actor":{"userId","displayName"},"action","targetName"}],"nextBefore":"<event id>"\|null}` | `422 invalid_cursor` (no `fields`) |

`limit` defaults to 50, and `before` is optional. Business rules (Activity) owns the ordering and cursor rules.

**Projects and scenes**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/workspaces/<wid>/projects` | | `200 {"projects":[{"id","name","sceneCount","assetCount","updatedAt"}]}` | |
| `POST /api/workspaces/<wid>/projects` | `{"name"}` | `201 {"project":{...}}` | |
| `GET /api/projects/<pid>` | | `200 {"project":{...},"scenes":[{"id","name","status","revision"}],"assets":[<asset>]}` | |
| `POST /api/projects/<pid>/scenes` | `{"name","template":"blank"\|"ramp"\|"pendulum"\|"launcher"}` | `201 {"scene":{"id","name","status":"draft","revision":1,"stateHash"}}` | |
| `GET /api/scenes/<sid>` | | `200 {"scene":{"id","projectId","name","status","revision","stateHash","lab":null\|{"token","url","bundleHash","publishedAt","checkpointId","exposed":[...]}},"document":{...}}` | |
| `GET /api/scenes/<sid>/document` | | `200`, body the exact canonical document bytes (`application/json`), header `X-Revision: <n>` | |
| `PATCH /api/scenes/<sid>` | `{"baseRevision":<n>,"changeId":"<uuid>","ops":[<op>,...]}` | `200 {"revision":<n>,"stateHash"}` | in order: `409 stale_lock`, details `{"objectId"}`; then `412 revision_conflict`, details `{"currentRevision":<n>,"conflicts":["<field key>",...]}` |
| `POST /api/scenes/<sid>/verify` | `{"steps":<1..12000>,"params"?:{"<objectId>.<param>":<number>}}` | `200 {"step":<n>,"stateHash"}` | |
| `GET /api/scenes/<sid>/live?tab=<tab id>` | | `200`, `text/event-stream` (see Live channel) | |

- Creating a project writes activity `project.created`, and creating a scene writes `scene.created`.
- In `GET /api/scenes/<sid>`, `stateHash` is the state hash at step 0 of the current revision.
- A PATCH applies all of its ops or none, and an applied PATCH writes activity `scene.edited`. An op that names an object absent from the current revision follows the removed-object rule in Business rules (Autosave and revisions).
- Verify computes on the server from the current revision, with any params replaced.

**Ops** (inside a PATCH):
- `{"op":"add","object":<object>}` adds a new object with a new `id`.
- `{"op":"set","objectId","fence":<n>,"field":"name"|"position"|"rotation"|"scale"|"params.<param>","value":<value>}`
- `{"op":"remove","objectId","fence":<n>}`
- `{"op":"scene","field":"name"|"gravity","value":<value>}`

The field keys used in `conflicts` are `scene.name`, `scene.gravity` and `<objectId>.<field>`, for example `ramp-1.params.mass_kg`.

**Live channel.** `GET /api/scenes/<sid>/live?tab=<tab id>` is a server-sent event stream for one open editor tab. `<tab id>` is 8 to 64 letters, digits and hyphens, chosen by the tab. Each event has one `event:` name and one `data:` line of JSON:

| Event | Data | Sent when |
|---|---|---|
| `revision` | `{"revision","stateHash"}` | a new revision of the scene is written |
| `presence` | the `GET /api/scenes/<sid>/presence` body | people, cursors or leases change |
| `role` | `{"role":"owner"\|"editor"\|"viewer"}` | the caller's role in the workspace changes |
| `status` | the `GET /api/status` body | a service status changes |

The server sends a comment line at least every 15 seconds. Opening the stream counts as presence for that tab.

**Locks and presence**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/scenes/<sid>/locks/<objectId>` | `{"tab"?:"<tab id>"}` | `200 {"lock":{"objectId","holder":{"userId","displayName"},"fence":<n>,"expiresAt"}}` | `409 lock_held`, details `{"holder":{"userId","displayName"},"expiresAt"}`; `404 not_found` for an object not in the current revision |
| `DELETE /api/scenes/<sid>/locks/<objectId>` | | `204` when the caller held it or it was free | `409 lock_held` when someone else holds it |
| `PUT /api/scenes/<sid>/presence` | `{"tab","cursor":[x,y,z]\|null,"selected":"<objectId>"\|null}` | `204` | |
| `DELETE /api/scenes/<sid>/presence?tab=<tab id>` | | `204` | |
| `GET /api/scenes/<sid>/presence` | | `200 {"people":[{"userId","displayName","cursor","selected"}],"locks":[{"objectId","holder":{...},"fence","expiresAt"}]}` | |

Presence is open to every role, including viewers.

**Assets**

| Method and path | Request | Success |
|---|---|---|
| `POST /api/projects/<pid>/assets?name=<file name>&unit=<m\|cm\|mm\|in\|ft>` | the raw file bytes, `Content-Type: application/octet-stream` | `201 {"asset":<asset>}`, or `200 {"asset":<existing asset>}` on an identical-bytes replay |
| `GET /api/assets/<aid>/original` | | `200`, body the stored bytes, `Content-Type` `model/gltf-binary`, `model/gltf+json`, `image/png` or `image/jpeg`, and `ETag: "<sha256>"` |

- `unit` defaults to `m` and is ignored for images.
- An upload writes activity `asset.uploaded`, on 201 only.
- `<asset>` is `{"id","name","kind":"glb"|"gltf"|"png"|"jpeg","bytes","sha256","unit","scaleToMetres","extentMetres","createdAt"}`. `unit`, `scaleToMetres` and `extentMetres` are `null` for images.

**Checkpoints**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/scenes/<sid>/checkpoints` | `{"label"}` | `201 {"checkpoint":{"id","label","revision","stateHash","documentSha256","createdAt"}}` | `409 checkpoint_name_taken` |
| `GET /api/scenes/<sid>/checkpoints` | | `200 {"checkpoints":[...]}`, newest first | |
| `GET /api/scenes/<sid>/checkpoints/<cid>/document` | | `200`, body the snapshot bytes | |
| `POST /api/scenes/<sid>/checkpoints/<cid>/restore` | `{}` | `200 {"revision":<n>,"stateHash"}` | `409 locks_held`, details `{"holders":[{"userId","displayName"}]}` |

Creating a checkpoint writes activity `checkpoint.created`, and restoring writes `checkpoint.restored`.

**Publishing and labs**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/scenes/<sid>/publish` | `{"checkpointId","exposed":["<objectId>.<param>",...]}` | `201 {"lab":{"token","url","bundleHash","publishedAt","checkpointId","exposed"},"delivery":"sent"\|"queued"}` | `409 no_checkpoint` |
| `POST /api/scenes/<sid>/unpublish` | | `200 {"scene":{...,"status":"unpublished"}}` | `409 not_published` |
| `POST /api/scenes/<sid>/lab-link/regenerate` | | `200 {"lab":{...new token...}}` | `409 not_published` |
| `GET /api/labs/<token>` (public) | | `200 {"lab":{"sceneName","bundleHash","publishedAt","exposed":[{"key","label","min","max","step","unit","value"}]},"bundle":{...}}` | |
| `GET /api/labs/<token>/bundle` (public) | | `200`, body the exact bundle bytes | |
| `GET /api/labs/<token>/assets/<sha256>` (public) | | `200`, body the stored asset bytes | `404` for a hash the bundle does not name |
| `POST /api/labs/<token>/verify` (public) | `{"steps","params"?}` | `200 {"step","stateHash"}` | `422 validation` for unexposed keys, values out of range or steps out of range |

Publishing writes activity `scene.published`, unpublishing writes `scene.unpublished`, and regenerating the lab link writes `lab_link.regenerated`.

**Read-only links**

| Method and path | Request | Success |
|---|---|---|
| `POST /api/projects/<pid>/share-links` | `{"email"?}` | `201 {"link":{"id","token","url","expiresAt"},"delivery":"sent"\|"queued"\|null}` |
| `GET /api/projects/<pid>/share-links` | | `200 {"links":[...]}`, active links only |
| `POST /api/share-links/<id>/regenerate` | | `201 {"link":{...new token...}}` |
| `DELETE /api/share-links/<id>` | | `204` |
| `GET /api/view/<token>` (public) | | `200 {"project":{"name"},"scenes":[{"id","name","stateHash"}]}` |
| `GET /api/view/<token>/scenes/<sid>` (public) | | `200 {"scene":{...},"document":{...},"assets":[<asset>]}`, where `assets` lists every model asset the document uses |
| `GET /api/view/<token>/scenes/<sid>/live` (public) | | `200`, `text/event-stream` with `revision` events as in Live channel, plus a final `link_dead` event (data `{}`) before the server closes the stream once the link stops working |
| `GET /api/view/<token>/assets/<sha256>` (public) | | `200`, body the stored asset bytes, with the same `Content-Type` and `ETag` as the asset's original download |
| `POST /api/view/<token>/scenes/<sid>/verify` (public) | as scene verify | as scene verify |

- Creating a link writes activity `share_link.created`, regenerating writes `share_link.regenerated`, and revoking writes `share_link.revoked`.
- A view asset hash that is not a model asset of the link's project answers `404 link_not_found`.
- `HEAD` on any `GET` path under `/api/view/<token>` answers exactly like `GET`, without a body.
- Any other method on any `/api/view/<token>...` path, except the verify `POST` above, answers `405 read_only` with the header `Allow: GET, HEAD`.
- An unknown, revoked, regenerated-away or expired token answers `404 link_not_found` to `GET` and `HEAD` on every `/api/view` path. A dead lab token does the same on every `/api/labs` path.

**Status**

| Method and path | Success |
|---|---|
| `GET /api/health` (public) | always `200 {"status":"ok"}` while the process serves |
| `GET /api/status` (public) | `200 {"locks":"ok"\|"down","storage":"ok"\|"down","mail":"ok"\|"down"}`, checked at most five seconds earlier |

### Business rules (DP-01–DP-03, DP-05, DP-06, DP-08–DP-11, DP-15, DP-18, DP-19, DP-22–DP-26, DP-29, DP-30, DP-34–DP-37, DP-40, DP-41, DP-43, DP-44, DP-47, DP-50, DP-51, DP-61–DP-64)

**Accounts.**
- An email is trimmed, then compared ASCII-case-insensitively for uniqueness and for sign-in. It is stored and shown as typed at sign-up, minus the trimmed spaces.
- Of any number of simultaneous sign-ups for the same address in any letter case, exactly one answers 201. Every other one answers `409 email_taken`, and none answers a 5xx.
- Display names are 1 to 60 characters. Passwords are 10 to 128 characters, inclusive, and are stored only as a slow salted hash.
- Sign-up signs the person in.

**Landing routes.** After each action the address bar shows exactly the route below. Reloading it or opening it directly shows the same screen.

| Action | Route |
|---|---|
| sign-in or sign-up with `?invite=<token>` | `/invite/<token>` |
| sign-in with a safe `return` | that `return` value |
| sign-in otherwise | `/w/<last opened workspace id>`; when the account has never opened a workspace, `/w/<id of the workspace it joined earliest>`; `/workspaces/new` when the account belongs to no workspace |
| sign-up without an invite | `/workspaces/new` |
| creating a workspace | `/w/<new id>` |
| choosing a workspace in the account menu | `/w/<that id>` |
| accepting an invite | `/w/<workspace id>` |
| creating a project | `/w/<wid>/p/<new pid>` |
| creating a scene | `/w/<wid>/s/<new sid>` |

- **Safe return.** Take the `return` value as the query string carries it once decoded, which is the normal reading of the parameter, and percent-decode it once more. The value is safe only when that result meets all of these:
  1. It starts with exactly one `/`.
  2. Its second character is neither `/` nor `\`.
  3. It contains no control character (U+0000 to U+001F, or U+007F).
  4. It does not start with `/api/`.

  A safe value is followed as first read. Any other value is ignored. The server decides this in the sign-in response's `landing`, so the browser never leaves the app's origin.
- **Last opened workspace.** This is the workspace whose `/w/<workspace id>` screen the account most recently loaded, through each `GET /api/workspaces/<wid>`. Creating a workspace and accepting an invite each also set it to that workspace.
- **Earliest joined.** The join time is when the membership was created: workspace creation for the owner, and acceptance for an invitee.
- A signed-out visit to `/invite/<token>` shows the invite's workspace name with `link "Sign in"` and `link "Create account"`, both carrying the invite token.

**Roles.**
- Roles are read from Postgres on every request, so a change applies to the member's next request on every endpoint.
- Only the owner's role is `owner`, and it cannot change.
- Every role may read the workspace, projects, scenes, documents, checkpoints, assets and activity, may run the server verifier, and may send presence.

| Action | Owner | Editor | Viewer |
|---|---|---|---|
| Create projects and scenes, edit scenes (PATCH, locks), upload assets, create and restore checkpoints | yes | yes | 403 |
| Publish, unpublish, regenerate the lab link | yes | 403 | 403 |
| Read-only links | yes | 403 | 403 |
| Invites and role changes | yes | 403 | 403 |

- A role change to `editor` or `viewer` sends the role-change email (Services).
- **Demotion.** When a member becomes a viewer, the server at once releases every lease they hold, so each object is free for others and announced as free. It then sends a `role` event on every live channel the member has open.
  - Within five seconds of the change, and without a reload, the member's open editor shows the `View only` pill, turns every field read-only and shows the demoted Save status.
  - Every lock request or scene PATCH from that member then answers `403 forbidden`, including the replay of a queued change. Their presence and cursor keep working.
- A promotion from viewer to editor makes the open editor editable within five seconds in the same way.

**Invite state machine.**
- Legal edges:

  | From | To | Trigger |
  |---|---|---|
  | `pending` | `accepted` | acceptance |
  | `pending` | `revoked` with reason `owner` | the owner revokes it |
  | `pending` | `revoked` with reason `superseded` | the owner invites the same address in the same workspace again |
  | `pending` | `expired` | the server clock reaches `expiresAt` |

- An invite is expired once the server clock is at or past `expiresAt`, so the instant `expiresAt` itself is already expired. An expired invite reads as `expired` in every response.
- `expiresAt` is the creation time plus `INVITE_TTL_SECONDS`, default 604800 seconds.
- Each workspace has at most one pending invite per case-folded address, even when several invites for the same address arrive at once.
  - A re-invite creates a new invite with a new token and its own `expiresAt`, and moves the older pending invite to `revoked` with reason `superseded`.
  - The superseded token answers `410 invite_superseded` on `GET` and on accept.
- Illegal edges:

  | Attempt | Answer |
  |---|---|
  | accepting an accepted invite | `409 invite_used` |
  | accepting a superseded invite | `410 invite_superseded` |
  | accepting an invite revoked by the owner | `410 invite_revoked` |
  | accepting an expired invite | `410 invite_expired` |
  | revoking an accepted invite | `409 invite_used` |
  | revoking an expired invite | `410 invite_expired` |
  | revoking a superseded invite | `410 invite_superseded` |
  | revoking an invite the owner already revoked | `410 invite_revoked` |
  | accepting with an account whose email, case-folded, is not the invited one | `403 invite_email_mismatch` |
  | inviting a current member | `409 already_member`, and no mail is sent |

- Accepting adds the member with the invited role.

**Activity.**
- Every request that succeeds on a row naming an activity action writes exactly one event with that action, its actor and its `targetName`. An idempotent replay writes nothing, and no other request writes events.
- Events are ordered by `at` descending, then by `id` descending.
- A page returns up to `limit` events that come strictly after the `before` event in that order. Without `before`, it starts at the newest event.
- `nextBefore` is the id of the page's last event, or `null` when no older event exists.
- A page never repeats or skips an event, even when new events are written between page reads, including several events with the same `at`.
- A `limit` outside 1 to 100, or a `before` that names no event in this workspace, answers `422 invalid_cursor`.
- Each `listitem` reads `<actor display name> <phrase> <targetName>`, followed by a `time` element.
  - The `time` element shows the event time in the browser's local time zone as `YYYY-MM-DD HH:MM` (24-hour, zero-padded).
  - Its `datetime` attribute is the event's `at`.

| Action | `targetName` | Phrase |
|---|---|---|
| `workspace.created` | the workspace name | `created workspace` |
| `member.role_changed` | the member's display name | `changed the role of` |
| `invite.created` | the invited email | `invited` |
| `invite.revoked` | the invited email | `withdrew the invite to` |
| `invite.accepted` | the invited email | `accepted the invite for` |
| `project.created` | the project name | `created project` |
| `scene.created` | the scene name | `created scene` |
| `scene.edited` | the scene name | `edited scene` |
| `asset.uploaded` | the asset's file name | `uploaded` |
| `checkpoint.created` | the checkpoint label | `saved checkpoint` |
| `checkpoint.restored` | the checkpoint label | `restored checkpoint` |
| `scene.published` | the scene name | `published the lab for` |
| `scene.unpublished` | the scene name | `unpublished the lab for` |
| `lab_link.regenerated` | the scene name | `replaced the lab link for` |
| `share_link.created` | the project name | `created a read-only link to` |
| `share_link.regenerated` | the project name | `replaced a read-only link to` |
| `share_link.revoked` | the project name | `revoked a read-only link to` |

For example, the owner saving checkpoint Before class shows `Ines Okafor saved checkpoint Before class`.

**Scene document.** The scene document is the canonical JSON of a scene.
- Its keys are:
  - `gravity`, in m/s²
  - `name`
  - `objects`, sorted by `id`
  - `solver`, which is `{"iterations":4,"step":"1/120"}`
- Each object has the keys:
  - `assetId`, null unless the kind is `model`
  - `id`, `kind`, `name` and `params`
  - `position`, in metres as `[x,y,z]`, with Y up
  - `rotation`, a unit quaternion `[x,y,z,w]`
  - `scale`, as `[x,y,z]`
- Canonical JSON means:
  - object keys sorted by code point at every level
  - no whitespace
  - strings escaped minimally
  - numbers written in the shortest form that reads back to the same double, as JavaScript prints them, with negative zero written as `0`
  - UTF-8 with no trailing newline
- Each successful PATCH or restore creates the next revision. Revisions are numbered upward from 1 and never go back.

**Objects.**
- Ids are 1 to 40 lowercase letters, digits and hyphens, unique in the scene.
- Kinds are `ramp`, `pendulum`, `launcher`, `crate` and `model`.
- Position components are within ±500 m. Scale components are from 0.01 to 100. Rotation is normalised to within one millionth.
- A `model` needs `assetId` to be a model asset of the same project, and has empty `params`.

Parameter ranges are inclusive. Templates and placing use the default, and lab sliders use the step.

| Kind | Param key | Label | Range | Default | Step | Entry units |
|---|---|---|---|---|---|---|
| scene | `gravity` | Gravity (m/s²) | 0.1 to 30 | 9.81 | 0.01 | none |
| ramp | `mass_kg` | Mass (kg) | 0.1 to 100 | 1 | 0.1 | mass |
| ramp | `angle_deg` | Angle (degrees) | 1 to 60 | 30 | 1 | angle |
| ramp | `length_m` | Length (m) | 0.5 to 20 | 3 | 0.1 | length |
| ramp | `friction` | Friction | 0 to 1 | 0 | 0.01 | none |
| pendulum | `mass_kg` | Mass (kg) | 0.1 to 100 | 0.5 | 0.1 | mass |
| pendulum | `length_m` | Length (m) | 0.1 to 10 | 1 | 0.1 | length |
| pendulum | `release_deg` | Release angle (degrees) | 1 to 80 | 20 | 1 | angle |
| launcher | `mass_kg` | Mass (kg) | 0.1 to 100 | 0.2 | 0.1 | mass |
| launcher | `speed_mps` | Launch speed (m/s) | 0.1 to 50 | 5 | 0.1 | none |
| launcher | `launch_angle_deg` | Launch angle (degrees) | 0 to 89 | 45 | 1 | angle |
| launcher | `height_m` | Launch height (m) | 0 to 20 | 1 | 0.1 | length |
| crate | `mass_kg` | Mass (kg) | 0.1 to 100 | 1 | 0.1 | mass |

The three Position fields use length units, with the transform bounds above.

**Parameter entry.**
- A field's text is a decimal number (optional leading minus, digits, optional decimal point and digits), then optional spaces, then an optional unit written exactly in lowercase. Leading and trailing spaces are ignored.
- The units are:

  | Group | Units |
  |---|---|
  | Mass | `kg` (the default), `g`, `lb` (1 lb = 0.45359237 kg) |
  | Length | `m` (the default), `cm`, `mm`, `in` (0.0254 m), `ft` (0.3048 m) |
  | Angle | `deg` (the default), `rad` |

- Fields marked none accept only a plain number.
- Text that does not start with a number shows `Enter a number.` A number followed by any other unit shows that group's unit copy.
- The range check applies to the converted SI value, and the readouts use the converted value.
- On blur, the field shows the SI value rounded to at most 6 decimals with trailing zeros dropped.
- An invalid or out-of-range field is never sent, so no save fails because of it. The readout rows that depend on it read `n/a`, and the Save status follows the field-error trigger in Feedback states. An out-of-range value sent anyway is `422 validation`, keyed by the field key.
- For example, typing `1 lb` into Mass on a ramp at 30 degrees and 3 m long gives `Potential energy: 6.67 J`, and after blur the field reads `0.453592`. Typing `5 st` shows `Use kg, g or lb.`

The Material surfaces set ramp `friction`:

| Surface | Friction |
|---|---|
| `Frictionless` | 0 |
| `Ice` | 0.05 |
| `Polished wood` | 0.2 |
| `Rubber mat` | 0.8 |

**Templates.**
- `blank` has no objects.
- `ramp` has `ramp-1` named `Ramp 1`, `pendulum` has `pendulum-1` named `Pendulum 1`, and `launcher` has `launcher-1` named `Launcher 1`.
- Each template object has default parameters, position `[0,0,0]`, rotation `[0,0,0,1]` and scale `[1,1,1]`.
- Every template uses gravity 9.81.

**Derived readouts.** The browser computes these from the parameter values in effect on screen. `g` is the scene gravity, and angles are converted to radians.

- **Ramp** (an ideal cart released from rest at the top). Let `h = length_m × sin(angle)` and `a = g × (sin(angle) − friction × cos(angle))`.
  - `Potential energy` = `mass_kg × g × h`, in J.
  - `Speed at bottom` = `√(2 × a × length_m)` in m/s when `a > 0`, otherwise 0.
  - `Time to bottom` = `√(2 × length_m ÷ a)` in s when `a > 0`, otherwise n/a.
- **Pendulum.**
  - `Period` = `2π × √(length_m ÷ g)`, in s.
  - `Speed at bottom` = `√(2 × g × length_m × (1 − cos(release)))`, in m/s.
- **Launcher.** Let `vy = speed_mps × sin(launch angle)` and `vx = speed_mps × cos(launch angle)`.
  - `Time of flight` = `(vy + √(vy² + 2 × g × height_m)) ÷ g`, in s.
  - `Range` = `vx × time of flight`, in m.
  - `Peak height` = `height_m + vy² ÷ (2 × g)`, in m.
- Crates and models have no readouts.
- Readouts are rounded to two decimals, half away from zero.

For example, with the seed data at start:
- Ramp A reads `Potential energy: 39.24 J`, `Speed at bottom: 6.26 m/s` and `Time to bottom: 1.28 s`. Changing its mass to 2.5 makes `Potential energy: 49.05 J`, with the other two unchanged.
- Clock bob reads `Period: 2.01 s` and `Speed at bottom: 1.09 m/s`.
- Launcher reads `Time of flight: 0.94 s`, `Range: 3.32 m` and `Peak height: 1.64 m`.

**Simulation and state hash.**
- A run starts from the scene document plus any parameter overrides and takes no other input.
- Each step advances exactly 1/120 second, with four solver iterations.
- Frame rate never changes the step. A display frame runs as many whole steps as real time allows, at most 8, so a slow device falls behind real time instead of changing the result.
- The outcome after `n` steps must be identical on every browser engine and on the server, so the step must not depend on the platform's own floating-point maths library.
- Each object has one body:

  | Kind | Body |
  |---|---|
  | ramp | its cart, starting at rest at the top of the ramp its params describe |
  | pendulum | its bob, starting at the release angle |
  | launcher | its ball, starting at the launch height with the launch velocity |
  | crate | itself, dynamic, with its mass |
  | model | itself, static, colliding as its scaled box |

- The state hash is the lowercase hexadecimal SHA-256 of the canonical JSON of `{"objects":[{"id","position","rotation","velocity"}...],"step":<n>}`. Objects are sorted by id, each entry describes that object's body, and `velocity` is the body's linear velocity in m/s.
- Step 0 is the pre-run state. The telemetry `hash` line shows its first 12 characters.
- The editor's paused state at step `n` and `POST /api/scenes/<sid>/verify` with `steps: n` give the same hash for the same saved revision and params.
- Stop discards the run state and returns to step 0, which by construction has the pre-run hash.

**Autosave and revisions.**
- **One change, one PATCH.** Each change is one PATCH with its own new `changeId` (a UUID). A change is one nudge, one finished drag, one committed field, one placement, one removal, one rename, one Material choice, or one undo or redo.
  - The editor sends its changes one at a time, in the order they were made, each within one second of being made or of the connection returning.
  - Each PATCH carries the revision its change was made on.
- **Replay.** A PATCH whose `changeId` the scene has already applied returns that first response, `200` with the same revision and `stateHash`, and writes nothing. The same `changeId` with a different body answers `409 change_id_reused`.
- **Offline.** While the network is down, the editor keeps unsent changes queued in order and shows the offline Save status. On reconnect it sends them in order, so the revision rises by exactly the number of distinct changes, unless one is rejected.
- **Base revision.**
  - A PATCH whose `baseRevision` is current is applied.
  - A PATCH whose `baseRevision` is older is still applied when no revision after `baseRevision` changed any field key that this PATCH sets or removes. Adds never conflict.
- **Field keys a revision changes:**
  - a `set` op: its one key
  - a `scene` op: `scene.name` or `scene.gravity`
  - an `add` or `remove` op: every field key of that object (`<objectId>.name`, `<objectId>.position`, `<objectId>.rotation`, `<objectId>.scale`, and `<objectId>.params.<param>` for each of its params)

  For the comparison, a PATCH's own `remove` op touches every field key of its object.
- **Restore barrier.** A PATCH whose `baseRevision` is older than the scene's latest restore revision always answers `412 revision_conflict`, with `conflicts` listing every field key that the PATCH's ops set, remove or add, and nothing is written.
- **Removed objects.** A `set` or `remove` op that names an object absent from the current revision is judged before its lease. When a revision after `baseRevision` removed that object, the PATCH answers `412 revision_conflict` listing that object's keys. Otherwise it answers `404 not_found`.
- Removing an object also frees its lease.
- Any other overlap answers `412 revision_conflict` listing the overlapping field keys, and nothing is written.
- Running, paused or stopped runs never create revisions.

**Live updates.**
- Every open editor of a scene shows each new revision (outline, stage, unfocused fields, readouts and telemetry hash) within two seconds of it being written, without a reload. This covers a co-tutor's edit and a restore.
- An open read-only scene does the same within five seconds.

**Object leases.**
- A lease is free, held or expired. It belongs to one person's one tab, named by `tab`, or to the person alone when no `tab` is given. The same person's other tab is refused like anyone else.
- Granting a free or expired lease makes the caller the holder and increases that object's fence number by one. Fence numbers never decrease.
- The holder's repeated request renews the lease with the same fence number.
- While someone else holds a live lease, a request is `409 lock_held`. Of any number of simultaneous requests for a free object, exactly one is granted.
- Leases expire on the server clock `LOCK_TTL_SECONDS` after their last grant or renewal, default 30 seconds.
- The editor renews every third of that time while the object stays selected, and releases the lease when the selection moves.
- When a tab's live channel ends (the tab closes, navigates away or loses its connection), every lease held under that tab is released within five seconds and announced as free. The TTL is only the fallback for a client that vanished without its connection ending.
- `set` and `remove` ops must name the caller's current fence for a live lease. Otherwise the whole PATCH is `409 stale_lock`, and nothing is written.
- `add` and `scene` ops need no lease.
- While the lock service is unreachable, lease requests and every PATCH answer `503 lock_store_unavailable`.

**Presence.**
- Each open editor tab holds its live channel open and sends presence at least every two seconds while visible. It sends a leave when it closes.
- `cursor` is the point on the ground plane under that person's pointer, in metres, or null while the pointer is off the stage.
- A tab's presence entry expires `PRESENCE_TTL_SECONDS` after its last update, default 20 seconds. It is removed within five seconds when the tab's live channel ends.
- A person is listed in People here while any of their tabs is present.
- Every open editor shows people, cursors and leases no more than two seconds stale.

**Uploads.**
- The body size limit is 10,000,000 bytes, and that size itself is allowed. Larger bodies are `413 payload_too_large`, with the too-large copy in `error.message` and no `fields`.
- The kind is decided only by content, never by the name's extension:

  | Kind | Content test |
  |---|---|
  | GLB | starts with the bytes `glTF`, then version 2, and a declared total length equal to the body length |
  | glTF | a UTF-8 JSON object with `asset.version` equal to `"2.0"` |
  | PNG | the eight-byte PNG signature |
  | JPEG | starts with the three bytes FF D8 FF |

- Anything else, including SVG, is `422` with the type copy. A malformed GLB or glTF is `422` with the damaged copy.
- A glTF or GLB is self-contained when every `buffers[].uri` and `images[].uri` that is present starts with `data:`. Any other uri is `422` with the external-reference copy.
- Names are 1 to 120 characters and must not contain `/`, `\`, `..` or control characters. Otherwise the upload is `422` with the name copy.
- `unit` must be `m`, `cm`, `mm`, `in` or `ft`. The matching `scaleToMetres` is 1, 0.01, 0.001, 0.0254 or 0.3048.
- **Extent rule.** Measure the model in its default scene: the scene named by `scene`, otherwise scene 0.
  1. Walk every node reachable from that scene's root nodes.
  2. Each node's local transform is its `matrix` when present. Otherwise it is translation × rotation × scale, built from its `translation`, `rotation` and `scale`, each defaulting to identity.
  3. Its world transform is its parent's world transform × its local transform.
  4. For every mesh primitive on a node, take the eight corners of the box formed by its `POSITION` accessor's `min` and `max`, and apply the node's world transform.
  5. The extent is the largest of the x, y and z spans of the box that bounds all of those transformed corners.
  6. `extentMetres` is the extent × `scaleToMetres`.

  For example, a 1 m cube under a parent node scaled by 0.5, on a child node turned 45 degrees about y, measures 0.5 × √2 = 0.707107 m, shown as `0.71 m`.
- A model with no scene, no mesh in its default scene, or a `POSITION` accessor without `min` and `max` is damaged.
- An `extentMetres` below 0.01 or above 100 is `422` with the extent copy. Both limits themselves are allowed.
- The stored original is never modified. Scale applies only to placed objects.
- Uploading bytes whose SHA-256 matches an asset already in the same project returns that asset with `200`, unchanged, even with a different name or unit.
- An asset row and the project's `assetCount` exist only after storage confirms the object.

**Checkpoints and restore.**
- A checkpoint snapshots the current revision's document bytes. `documentSha256` is their SHA-256, and `stateHash` is their step-0 hash.
- Checkpoint labels are unique within a scene, compared after trimming and ignoring letter case. A duplicate is `409 checkpoint_name_taken`.
- Restore needs no live lease in the scene held by anyone other than the caller. Otherwise it is `409 locks_held`.
- Restore writes the snapshot bytes as a new revision, one above the current revision. After that:
  - `GET /api/scenes/<sid>/document` returns bytes identical to the snapshot.
  - `X-Revision` is the new number.
  - The scene's `stateHash` equals the checkpoint's.
- Running and stopping before or after a restore changes nothing.
- Other editors' saves then follow the restore barrier in Autosave and revisions.

**Scene state machine.**
- Legal edges:
  - `draft → checkpointed` on the first checkpoint
  - `checkpointed → published`, `unpublished → published` and `published → published` (republish) on publish
  - `published → unpublished` on unpublish
- Publishing a draft is `409 no_checkpoint`. Unpublishing a scene that is not published is `409 not_published`, and so is regenerating its lab link.
- Checkpoints and restores never change the state, except for `draft → checkpointed`.
- A publish names a checkpoint of this scene and at most 8 exposed keys `<objectId>.<param>` that exist in that checkpoint. Otherwise it is `422` with the exposed copy.
- The first publish creates the lab token. A republish keeps the token and records a new bundle hash and time.
- Unpublish kills the token, and a later publish creates a new one.
- Regenerating the lab link replaces the token, and the old one is dead.
- Editing a published scene never changes its lab until the next publish.

**Lab bundles.**
- A bundle is the canonical JSON of `{"assets":[{"assetId","kind","scaleToMetres","sha256"}],"bundleVersion":1,"checkpointId","document":<checkpoint document>,"exposed":[keys],"solver":{"iterations":4,"step":"1/120"}}`. `assets` lists every model the document uses, sorted by sha256.
- `bundleHash` is the SHA-256 of the bundle bytes.
- Bundles are written once and are never overwritten or deleted by a republish.
- The lab runs only from its bundle and its asset bytes, fetched by hash.
- Lab verification overrides only exposed keys, within their ranges.

**Read-only links.**
- A link reads one project and its scenes and can run them. It can never change anything.
- A read-only scene runs from its document and its model asset bytes, fetched by hash through the link, exactly as a lab does. Its colliders and state hash therefore match the editor and the server verifier.
- Links expire on the server clock `SHARE_LINK_TTL_SECONDS` after creation, default 2592000 seconds. A link is dead once the clock is at or past `expiresAt`.
- Regenerating issues a new token with a fresh expiry, and the old token is dead.
- Revoked, regenerated-away and expired tokens fail on the very next request, from any browser or cache.
- Within five seconds, an open read-only project or scene of a dead link replaces its content with the dead-link page from Feedback states, without a reload.

### Services (DP-05, DP-08, DP-10, DP-29, DP-32, DP-33, DP-37, DP-39, DP-40, DP-44, DP-45)

**Postgres** (`DATABASE_URL`) holds:
- accounts, sessions, workspaces, memberships and roles
- invites
- projects, and scenes with every revision's document, op list and `changeId`
- checkpoints, assets and activity events
- share links
- published-lab records (token, bundle hash, time, checkpoint)
- the mail outbox

The schema is applied idempotently every time the app serves.

**MinIO** (bucket `S3_BUCKET`):

| Object | Key | Content |
|---|---|---|
| Asset original | `assets/<projectId>/<sha256>` | exactly the uploaded bytes |
| Checkpoint snapshot | `checkpoints/<sceneId>/<checkpointId>.json` | exactly the document bytes |
| Lab bundle | `labs/<sceneId>/<bundleHash>.json` | exactly the bundle bytes |

- The browser never talks to MinIO. Every byte reaches the browser through the app, after a permission check.
- When MinIO is unreachable:
  - Uploads, checkpoints, restores and publishes answer `503 storage_unavailable` and record nothing.
  - `GET /api/labs/<token>` and asset and original downloads answer `503 storage_unavailable`, and the lab page shows its storage copy.
  - `/api/status` reports `storage` as `down`, and the editor shows the storage banner.
- The first request after MinIO returns succeeds.

**Valkey** (`VALKEY_URL`):

| Key | Content | Expiry |
|---|---|---|
| `rw:lock:<sceneId>:<objectId>` | JSON `{"userId","displayName","tab","fence"}` | `LOCK_TTL_SECONDS` |
| `rw:fence:<sceneId>:<objectId>` | integer fence counter | none |
| `rw:presence:<sceneId>:<userId>:<tab>` | JSON `{"displayName","cursor","selected"}` | `PRESENCE_TTL_SECONDS` |

- Every app instance and tab shares these keys.
- When Valkey is unreachable:
  - Shared edits answer `503 lock_store_unavailable`.
  - The editor turns every edit control read-only, shows the lock banner and the lock-outage Save status, and empties People here to its unavailable copy.
  - Run, Pause, Step and Stop keep working.
- The app reconnects on its own. Within ten seconds of Valkey returning, `/api/status` reports `locks` as `ok` and edits are accepted again, without a restart.

**Mailpit** (SMTP at `SMTP_HOST`:`SMTP_PORT`). Every message is plain text with one recipient. Its From is the `MAIL_FROM` value, which the environment sets to `Rampwright <bench@tarnandtally.example>`.

| Message | To | Subject | Body includes |
|---|---|---|---|
| Invite | the invited email | `<inviter display name> invited you to <workspace name> on Rampwright` | the role, `<APP_PUBLIC_URL>/invite/<token>` and the expiry time |
| Role change | the member | `Your role in <workspace name> is now <Editor or Viewer>` | |
| Share | the given email | `<sharer display name> shared <project name> with you` | `<APP_PUBLIC_URL>/view/<token>` and its expiry time |
| Publish confirmation | the publishing owner | `Lab published: <scene name>` | the lab address and the bundle hash |

- Each message is written to the outbox in the same step as the action, then sent at once. The response says `delivery: "sent"` when SMTP accepted the message during the request, and `"queued"` otherwise.
- Queued messages are retried at least every ten seconds. Once mail returns, each is delivered within 30 seconds, without a restart.
- **Exactly once.** Each message is delivered exactly once and never twice, even when retries overlap or several app instances serve the same database. Any of those instances may deliver it. Queued messages to the same recipient go out in the order they were queued.
- **Dead messages.** At send time, an invite message whose invite is no longer pending, or a share message whose link is no longer active, is dropped and never sent.
- Mail failure never fails the action that caused it.

### Seed data (DP-02, DP-03, DP-04, DP-12, DP-19)

On every serve, the app creates these records only if the seeded accounts are missing. Several instances starting at once against the same database still produce exactly one copy. Every seeded person and business is invented.

**Accounts.** Passwords are in backticks.

| Name | Email | Password |
|---|---|---|
| Ines Okafor | `ines@okafor-physics.example` | `ines-bench-2026` |
| Tomas Reyes | `tomas@okafor-physics.example` | `tomas-bench-2026` |
| Priya Lund | `priya@lund-family.example` | `priya-bench-2026` |
| Dana Whitcombe | `dana@whitcombe-tutoring.example` | `dana-bench-2026` |

**Workspaces.**

| Workspace | Members | Contents |
|---|---|---|
| `Okafor Physics Bench` | Ines (owner), Tomas (editor), Priya (viewer) | project `Forces and Motion` |
| `Saturday Co-op Lab` | Ines (owner) | no projects |
| `Whitcombe Tutoring` | Dana (owner) | project `Private notes`, with one blank draft scene `Incline notes` |

- Ines joined `Okafor Physics Bench` before `Saturday Co-op Lab`, and her last opened workspace is `Okafor Physics Bench`.
- Tomas, Priya and Dana have never opened a workspace, so at first sign-in each lands on their earliest-joined one: Tomas and Priya on `Okafor Physics Bench`, Dana on `Whitcombe Tutoring`.
- The seed writes no activity events.

**Scenes in `Forces and Motion`.** Every scene is a draft at revision 1, with gravity 9.81 and rotation `[0,0,0,1]` on every object. There are no checkpoints, assets, invites or links.

| Scene | Object | Name | Kind | Params | Position | Scale |
|---|---|---|---|---|---|---|
| `Slope trial` | `ramp-1` | Ramp A | ramp | mass_kg 2, angle_deg 30, length_m 4, friction 0 | `[0,0,0]` | `[1,1,1]` |
| `Slope trial` | `crate-1` | Stop block | crate | mass_kg 5 | `[4,0,0]` | `[0.5,0.5,0.5]` |
| `Slope trial` | `cart-1` | Cart 1 | crate | mass_kg 1 | `[-2,0,0]` | `[0.4,0.3,0.25]` |
| `Pendulum clock` | `pendulum-1` | Clock bob | pendulum | mass_kg 0.5, length_m 1, release_deg 20 | `[0,2,0]` | `[1,1,1]` |
| `Ball launcher` | `launcher-1` | Launcher | launcher | mass_kg 0.2, speed_mps 5, launch_angle_deg 45, height_m 1 | `[0,0,0]` | `[1,1,1]` |

## Technical requirements

### Deployment (DP-59)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build`.

- `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

- `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- `GET /api/health` answers HTTP 200 `{"status":"ok"}` within 30 seconds of `serve` starting, whatever the state of Valkey, MinIO and mail.
- One process serves the API, the built frontend and the public pages.

### Configuration and secrets (DP-60)

These values are read from the environment at start. They are never hard-coded or logged, and never sent to the browser:

- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `VALKEY_URL`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `APP_PUBLIC_URL`, the origin used in every emailed and displayed link
- `APP_PUBLIC_PORT`
- the time settings `LOCK_TTL_SECONDS`, `PRESENCE_TTL_SECONDS`, `INVITE_TTL_SECONDS` and `SHARE_LINK_TTL_SECONDS`, whose defaults are in Business rules

### Server boundary (DP-04, DP-50, DP-59, DP-61)

- **Same origin.** The browser talks only to the app's own origin. No page loads scripts, fonts, styles or images from any other origin, and no redirect the app issues leaves its origin.
- **Cross-origin writes.** A state-changing request whose `Origin` header names another origin answers `403 cross_origin`.
- **Body limits.** JSON request bodies may be up to 1,000,000 bytes, and that size itself is allowed. Larger bodies answer `413 payload_too_large`. Upload bodies are limited as stated in Business rules. A JSON endpoint given another content type answers `415 unsupported_media_type`.
- **Never served.** The server never serves source files, `run.json`, package manifests, lockfiles, environment files, dependency folders or credentials. Those paths, unknown `/api` paths and unknown pages answer 404, as JSON under `/api` and as the not-found page otherwise.
- **Tenant isolation.** A resource outside the caller's workspaces is indistinguishable from a missing one.
- **Abandoned requests.** When a client abandons a live channel, a download or any request mid-way, the server frees that request's database work at once. After repeated abandoned streams, no app database session is left active or idle in a transaction because of them, and the next request is served normally.
- **Dependencies at boot.** If Valkey, MinIO or the mail service is unreachable at boot, the app still starts and serves. It reports the dependency in `/api/status` and recovers when it returns, as stated in Services.

### Browser support and performance (DP-25, DP-48, DP-56)

- **Browsers:** current Chromium, Firefox and WebKit on desktop, plus mobile Chrome and Safari.
- **Viewports:** 1440x900, 1280x800, 1024x768, 768x1024, 390x844 and 375x812.
- **Load time:**
  - The editor and the lab are usable (stage drawn, panels interactive) within three seconds of navigation on a desktop with a local server.
  - The landing's first section is readable within two seconds.
- **Responsiveness:** readouts update within a tenth of a second of a keystroke. The other live timings are stated once in Business rules.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build or serve.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree, `npm ls --omit=dev --all --json`) with its version and licence, plus the bundled Inter and JetBrains Mono fonts.
- IF-03: Every shipped package (the same production dependency tree) and every font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Zlib or OFL-1.1.
- IF-04: The app stores state only in the provided Postgres, MinIO and Valkey. There is no other database, embedded store, or file on disk holding app data.
- IF-05: The provided service configuration and its dev credentials are left unchanged.
- IF-06: `package-lock.json` is committed, and `install` uses it without changing it.
- IF-07: Fonts and all other static files are served from the app's own origin, and no CDN or external URL appears in the built frontend.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` and no implicit type escapes in domain code.
- Names in code match the domain terms in this brief: scene document, revision, op, change id, lease, fence, tab, checkpoint, restore barrier, bundle hash, state hash, exposed parameter, derived readout, superseded invite, activity cursor.
- Each domain rule is decided in exactly one place in the source, and is shared by browser and server wherever both need it. This covers each state machine's transitions, the canonical JSON and state-hash rules, the parameter ranges and unit conversion, the readout formulas, the fixed step, the lease and fence check, the autosave conflict and restore-barrier rule, the safe-return rule, the extent rule and the upload checks.
- Every error leaves the server in the one error shape from API, built in one place.
- There is no abstraction with a single implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states that the types and rules already rule out. Every boundary input (request bodies, query strings, uploaded bytes, environment) is validated once, where it enters.
- There are no features, endpoints, screens or settings beyond this brief.
