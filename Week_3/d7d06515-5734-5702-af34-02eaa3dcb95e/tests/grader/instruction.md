# Corbel Works Corbel Draft

Corbel Draft is a browser-based 2D drafting and drawing-review app for freelance drafters, small architecture studios and independent engineers, and for the clients and consultants who review their sheets. A drafter draws floor plans, sections and details from a command line with aliases, typed coordinates, object snaps, layers, blocks, multiline text and dimensions. The drafter keeps drawings in a cloud file browser, issues PDF and DXF sheets, and shares capability links. A reviewer opens a link on a laptop or phone, measures the live drawing and marks it up on a trace overlay that never touches the base geometry. The app is one TypeScript service backed by four providers:

- **Postgres** stores accounts, drawings, objects, layers, versions, traces, issues, share links and templates.
- **MinIO** stores uploaded DXF files and every exported PDF and DXF, byte for byte.
- **Mailpit** carries confirmation, invite, quote and trace-submitted emails.
- **Valkey** carries live sync and presence.

Out of scope: payment of any kind, 3D modelling, scripting languages, proprietary binary drawing formats, third-party storage sources, external render or PDF services, and any datastore beyond these four.

## Problem and users

Drafters draw 2D plans every day and then lose hours to review. Desktop CAD seats are expensive and tied to one machine. Browser CAD tools cut down the command set and slow down on large drawings. Review comes back as scribbled PDF scans that the drafter has to redraw by hand, often against the wrong revision. Clients cannot safely open the live drawing to measure a wall or circle a problem, and nobody can tell whether the laptop copy matches the studio desktop. The cost is unbilled rework and missed issue dates.

- **Drafter (daily).**
  - Drafts and edits plans from a classic command line, with layers, blocks, text and dimensions.
  - Keeps drawings in My Drawings, with uploads and exports stored exactly as produced.
  - Confirms the account and sends share invites by email.
  - Sees edits from another tab or device arrive live, with a clear sync or conflict status.
- **Reviewer (occasional).**
  - Opens an emailed view, mark-up or edit link.
  - Pans, zooms and measures on a laptop or phone.
  - Draws revision clouds and comments on a trace, then submits it so the drafter is emailed.
  - Watches the drafter's live edits arrive.

## Journeys

1. **Start an account.**
   - *Start:* a visitor on the landing page.
   - *Actions:* chooses Start drafting, fills Create account by keyboard, and receives the confirmation email. Opens its link, signs in and lands on an empty My Drawings dashboard.
   - *End:* the header shows the trial countdown, and the upgrade dialog emails a Pro quote.
2. **Organise files.**
   - *Start:* a signed-in drafter on My Drawings.
   - *Actions:* creates a folder inline, uploads a DXF file, uploads it again as version 2, and restores version 1 from Version history.
   - *End:* a phone signed in to the same account shows the new folder and the Recent order without a reload.
3. **Draft an outline by keyboard.**
   - *Start:* a blank drawing.
   - *Actions:* draws a closed rectangle with LINE (for example `0,0`, `@6000,0`, `@0,4200`, `@-6000,0`, `C`). Offsets each wall inward and trims the corner tails, then adds a rectangle from the Ribbon.
   - *End:* Undo and Redo replay the work, Activity lists each command, and the API holds the exact inner outline.
4. **Organise and annotate the studio plan.**
   - *Start:* the seeded studio plan.
   - *Actions:* edits object properties and adds and renames layers in the Layers grid. Freezes, locks and unlocks layers, inserts a door on a snapped wall midpoint, and dimensions the walls.
   - *End:* Units switches to Meters and every value reformats in place.
5. **Issue a sheet.**
   - *Start:* the studio plan.
   - *Actions:* switches to Layout1, exports a PDF, and adds title-block Revision B effective tomorrow. On the next studio day, exports again.
   - *End:* the first sheet keeps Revision A byte for byte and the second shows Revision B.
6. **Review on a phone.**
   - *Start:* the drafter shares the plan with a mark-up link.
   - *Actions:* the reviewer opens the emailed link on a phone, starts a trace, taps out a revision cloud, adds a comment and submits.
   - *End:* the drafter's open tab announces the submission, the drafter gets the email, the trace plays back, and the base drawing is unchanged.
7. **Edit together.**
   - *Start:* the drafter and an edit-link collaborator both have the plan open.
   - *Actions:* one moves a wall and the other sees it redraw with grips. A stale edit gets the conflict dialog, and an idle collaborator turns Away.
8. **Control a link.**
   - *Start:* the drafter shares a view-only link that expires on a chosen day.
   - *Actions:* the recipient measures a wall on a phone and is refused every edit.
   - *End:* at the studio-zone end of that day the open tab turns into the expired page. Revoking another link turns its open tab into the revoked page.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Account sign-up and confirmation.** A visitor creates an account from the landing page with the Create account form, opens the confirmation email in Mailpit and, after its link confirms the address, signs in to an empty My Drawings dashboard.
- **DP-02 — Confirmation link lifetime.** A confirmation link works until its published lifetime ends on the server clock, an expired or replaced link shows its published page, and Send a new link emails a fresh link that becomes the only working one.
- **DP-03 — Sign-in refusals and lockout.** Sign in refuses a wrong email or password and an unconfirmed account with published copy and codes, and locks an address after the published number of failures for the published lock time.
- **DP-04 — Trial countdown and trial end.** The trial status counts studio-zone calendar days from the confirmation date, and when the trial ends every open tab of the account shows the ended state within the live-update limit while base writes are refused.
- **DP-05 — Pro quote by email.** The upgrade dialog emails a numbered Pro quote through Mailpit and shows its sent copy only after Mailpit accepts the message, and the product has no checkout or payment.
- **DP-06 — File browser.** The dashboard lists a folder in the Files table with folders first, sortable columns, a search that filters as the drafter types, a List and Grid switch and studio-zone dates, all operable by keyboard.
- **DP-07 — Folders.** New Folder creates a folder through an inline row under the published name rules, exactly one of several simultaneous same-name creations succeeds, a non-empty folder is never deleted, and creating inside a folder updates its Date Modified.
- **DP-08 — DXF upload and version history.** An uploaded DXF file reads Stored only after MinIO holds its exact bytes, a same-name upload adds a file version, size and type refusals use published copy, and Version history restores any version as a new one.
- **DP-09 — Live file list across devices.** New folders, files and Recent changes appear in the account's other open tabs and devices within the live-update limit without a reload.
- **DP-10 — Command line and coordinate entry.** The command line accepts every published alias, echoes the full command name, reads absolute, relative and polar coordinates in the drawing's units, and answers invalid points, unknown commands and Escape with published history lines.
- **DP-11 — Floor plan outline by keyboard.** Using only the keyboard, a drafter draws a closed outline with LINE, offsets each wall inward with OFFSET and trims the corner tails with TRIM, and the API then holds the exact trimmed inner outline.
- **DP-12 — Ribbon.** The Ribbon tablist moves between Draw, Annotate and Modify with the arrow keys, and each ribbon button starts its command exactly as its alias does and puts focus in the command line.
- **DP-13 — Undo, redo and activity.** UNDO and REDO reverse and replay the actor's last drawing change with published history lines and a new drawing version each, and every drawing change writes exactly one Activity entry that reaches every open tab live.
- **DP-14 — Object selection.** Objects are selected by handle, by a typed point or by a click within the published pick distances, and objects on frozen or turned-off layers and xref objects are never selected.
- **DP-15 — Properties panel edits in place.** The Properties panel shows the selected object's published fields, and editing a field or dragging a grip updates its derived values in place during the edit and again from the saved result, which the API returns.
- **DP-16 — Multiple selection.** With several objects selected the Properties panel names the count, marks differing values with the published varies marker and applies one change to every selected object in a single drawing version.
- **DP-17 — Version-checked base edits.** Every base edit carries the drawing version it was made on, exactly one of several edits on the same version wins, and every other is refused as a version conflict listing the changed handles.
- **DP-18 — External references.** A drafter attaches another drawing from the same workspace as an external reference that is drawn faded, can be snapped to but never selected, and shows its published status.
- **DP-19 — Layer Properties Manager by keyboard.** Using only the keyboard, a drafter adds, renames, recolours, retypes, sets current, freezes and thaws layers in the Layers grid, and each change is announced with published copy.
- **DP-20 — Layer names.** New layers take the published default names, and layer names follow the published character, length and case-insensitive uniqueness rules with published errors.
- **DP-21 — Frozen layers.** Objects on a frozen layer are not drawn, snapped to, selected, counted in the extents or written to exports until the layer is thawed.
- **DP-22 — Live per-layer object counts.** The Objects column of the Layers grid changes in place in every open tab of the drawing when an object is created, erased or moved to another layer.
- **DP-23 — Locked layers refuse edits.** Commands and Properties changes leave objects on locked layers untouched and say so with published copy, and the Properties fields of such objects are disabled.
- **DP-24 — Layer deletion refusals.** Deleting layer 0, the current layer, a locked layer or a layer that holds objects is refused with published copy and its conflict code, checked in the published order.
- **DP-25 — Unlock and edit by keyboard.** A drafter sees a lock made in another tab arrive live, unlocks the layer with Space in its Lock cell, hears the announcement and can then erase its object from the command line.
- **DP-26 — Object snap markers.** With OSNAP on, the winning Endpoint, Midpoint, Center or Intersection candidate inside the aperture shows its named marker centred on the snap point, Tab cycles candidates, and a pick takes the exact server-computed point.
- **DP-27 — Drafting aid toggles.** OSNAP, ORTHO, POLAR, SNAP & GRID and OTRACK toggle by button or function key with a pressed state and published history lines, and ORTHO, POLAR and grid snap constrain picked points as published.
- **DP-28 — Block library insertion.** The Blocks tab inserts any published block at its base point with the chosen scale and rotation and announces the insertion with its coordinates.
- **DP-29 — Snapped insertion by pointer and touch.** A drafter inserts a block on a snapped midpoint with the mouse, copies it with ORTHO on, and on a phone inserts another block by tapping a snapped point.
- **DP-30 — Dimension measurements.** DIMLINEAR, DIMALIGNED, DIMRADIUS and DIMANGULAR measure on the server by the published rules, and a text override shows the measurement wherever it holds the measurement placeholder.
- **DP-31 — Units switch in place.** Changing Units between Millimeters and Meters reformats every dimension text, Properties value and the coordinate readout in place in every open tab without changing stored geometry.
- **DP-32 — Dimension a plan by keyboard.** A drafter dimensions the studio plan by typed handles and points and by snapped pointer picks, and hears each new dimension announced.
- **DP-33 — Layouts and viewports.** The Layouts tablist switches between Model and paper layouts with the space and viewport scale shown, and New layout adds the next numbered layout and focuses its tab.
- **DP-34 — Exports stored before Ready.** A PDF or DXF export reads Ready with a download link only after MinIO confirms the object, its download serves the stored bytes, and a storage outage ends it as Failed.
- **DP-35 — PDF sheet title block.** A PDF export is an A3 landscape vector sheet that follows the plot style, leaves out frozen layers and prints the title block with the studio-zone issue date.
- **DP-36 — Title-block revisions by effective date.** A PDF export uses the title-block revision in effect on its studio-zone issue date, and exports issued earlier keep their stored bytes after a new revision takes effect.
- **DP-37 — DXF export and import.** DXF exports write the published header, layer table and entity subset with the drawing's values, and DXF import reads the same subset and reports what it skipped.
- **DP-38 — Issue a sheet by keyboard.** Using only the keyboard, a drafter opens the Export dialog with Ctrl+P, exports Layout1 as PDF and hears the ready announcement.
- **DP-39 — Traces leave base geometry untouched.** No trace edit, comment, submission or closure changes the drawing version or any base object the API returns.
- **DP-40 — Trace lifecycle, revision clouds and issues.** Traces move from open to submitted to closed with published refusals for every other move, revision clouds carry the published arc count, and each trace comment becomes a numbered issue when its trace is submitted.
- **DP-41 — Trace-submitted notice.** Submitting a trace emails the drafter through Mailpit, marks the trace Notice sent only after Mailpit accepts, and announces the submission in the drafter's open tabs live.
- **DP-42 — Review a drawing on a phone.** A reviewer with a mark-up link opens the emailed link on a phone, draws a revision cloud by tapping, adds a comment and submits the trace, and the drafter then plays the trace back.
- **DP-43 — Live change delivery.** A base change saved in one tab reaches every other open tab of the drawing through Valkey within the live-update limit without a reload, and every tab then shows the same synced version.
- **DP-44 — Remote change highlight.** A change that arrives from another tab or person redraws only the changed objects with the draw-in on overlay elements and holds their grips for the published hold before they fade, or shows them at once under reduced motion.
- **DP-45 — Edit conflict dialog.** A stale edit opens the Edit conflict alert dialog with the published counted copy and applies nothing, and Load latest loads the current drawing and returns focus to the command line.
- **DP-46 — Presence and idle.** The Collaborators list shows each other person with the drawing open as Editing, Viewing or Away, where Away is decided by the server clock after the published idle window and pushed live.
- **DP-47 — Two-tab editing session.** A drafter and an edit-link collaborator edit the studio plan together and each sees the other's changes and Activity entries live under the actor's name.
- **DP-48 — Share links and invites.** The Share dialog creates a view, mark-up or edit link and emails it, showing the sent copy only after Mailpit accepts the message, with the published cooldown on repeat invites to one address.
- **DP-49 — Link access levels.** A view-only link can open and measure but every write, exports included, is refused, a mark-up link can write only its holder's own trace objects, and an edit link can write base geometry.
- **DP-50 — Link expiry in studio time.** A link with an expiry date works until the published end-of-day second in the studio time zone and is expired from that second by the server clock, with the zone named on the link page.
- **DP-51 — Revocation takes effect live.** Revoking a link refuses its next request and turns every open tab on it into the revoked page within the live-update limit.
- **DP-52 — Measure through a shared link.** A recipient opens an emailed view-only link on a phone, measures a wall with DIST by tapping two snapped endpoints and hears the result read out with its units.
- **DP-53 — Grading route.** The grading endpoints create isolated seeded workspaces with ready sessions and set or clear a per-workspace server clock that every time rule reads, unless the grading switch is off.
- **DP-54 — Landing page components.** The landing page shows every published landing component in the Corbel Works black line-art language with original copy and drawings.
- **DP-55 — Hero draw-in and header handoff.** The hero wireframe draws in path by path with grips popping at endpoints, and the sticky account header slides in when the hero buttons scroll away and leaves when they return, with reduced motion showing each end state at once.
- **DP-56 — Editor and working screen look.** The dashboard, editor, dialogs, empty states and banners carry the same black ground, charcoal panels, thin grey lines and red grips with comfortable touch targets and AA contrast.
- **DP-57 — Responsive layouts.** Every screen fits phone, tablet and desktop widths without horizontal scrolling, and on phones the editor's Ribbon and panels move into the Tools and Panels sheets.
- **DP-58 — Keyboard dialogs and focus.** Every dialog and sheet keeps Tab and Shift+Tab inside itself, closes on Escape and returns focus to its opener, and editor shortcuts work whichever editor control has focus.
- **DP-59 — Outage at boot and recovery.** An instance started with Valkey, MinIO or Mailpit unreachable still serves pages, reports unavailable on health, shows the published banners and outage copy, and resumes without a restart when the service returns.
- **DP-60 — Server boundary.** The server serves only the built app and its API on one origin, enforces the published body limits, and never serves source files or sends credentials to the browser.

## Frontend

### Screens and layout (DP-01, DP-06, DP-33, DP-54, DP-57)

**Pages.**

| Page | Shows |
|---|---|
| `/` | The landing page. |
| `/signup` | The Create account form. |
| `/check-inbox` | Shown after sign-up. |
| `/verify/<token>` | The result of a confirmation link. |
| `/signin` | The Sign in form. |
| `/open` | A form with `textbox "Share link"` and `button "Open"`, which opens a pasted link. |
| `/drawings` | The dashboard (My Drawings). `/drawings?folder=<id>` shows a subfolder, and `/drawings?view=recent` and `/drawings?view=samples` show Recent and Sample Files. |
| `/d/<drawing id>` | The editor. |
| `/s/<token>` | The editor opened through a share link, or the expired, revoked or invalid link page. |

A signed-out visit to `/drawings` or `/d/<id>` redirects to `/signin`.

**Landing page.** The page is a run of sections, each about one viewport tall, over full-bleed line art. On desktop, content starts one tenth of the viewport width from the left, inside a container four fifths of the viewport wide. In order:

1. **First screen**, a 45/55 split. The **drafting hero lockup** fills the left column and the **three-device plan preview** the right. The **roof shell wireframe** sits behind both.
2. The **drafting capability band**.
3. The **drafting stroke demo split**, with a **selection grip constellation** fanning in from the left edge.
4. The **editor window preview** with its text, over the **graphite slab backdrop**, with a second constellation at the top left.
5. The **sheet set callout card**, centred over the roof shell wireframe.
6. The **studio footer**, with a third constellation on its right half.

The **sticky account header** appears once the hero buttons have scrolled away.

| Viewport | Landing layout |
|---|---|
| 1280×800 | As above. |
| 768×1024 | The hero stacks: lockup, then device preview at full container width. The band keeps three columns. The splits stack, media first. |
| 375×812 | One column with side margins of about one ninth of the viewport width. The hero stacks headline, subhead, then the two buttons full-width and stacked, fine print, and the device preview last. The band stacks into three rows, icon left and text right. Headlines wrap inside the margins. The header shows the icon only, without the word mark. |

**Dashboard.**

- **Header (full width):** the compact Corbel Works logo, `status "Trial"`, `button "Get Pro for $12/month"` and the account name with `button "Sign out"`.
- **Left sidebar:** `navigation "Files"`.
- **Centre:** the toolbar (Refresh, Manage Support Files, search, View switch) above `table "Files"` (or the grid of cards).
- **Right:** `complementary "Welcome"`.

| Viewport | Dashboard layout |
|---|---|
| 1280 | Sidebar, table and Welcome panel side by side. |
| 768 | The Welcome panel drops below the table. |
| 375 | The sidebar moves into `dialog "Files menu"`, a bottom sheet opened by `button "Files menu"`. The table shows only the Name and Date Modified columns, and the Welcome panel sits below the table. |

**Editor.** One black frame, top to bottom:

1. **Header:** breadcrumb, file actions, `status "Sync"`, `list "Collaborators"`, `status "Trial"`, `status "Access"` and `status "Link"` (share links only).
2. **Ribbon.**
3. **Main row:** the left icon sidebar with the active panel, then the blue-slate drawing canvas with the view controls at its top left.
4. **Layout bar.**
5. **Status bar:** `toolbar "Drafting aids"`, `status "Coordinates"`, `status "Zoom"` and `status "Space"`.
6. **Command line:** full width at the bottom, with the last lines of `log "Command history"` above `textbox "Command"`.

The outage, trial and trace banners sit between the Ribbon and the canvas.

| Viewport | Editor layout |
|---|---|
| 1280×800 | Panel about a fifth of the width, canvas fills the rest. |
| 768×1024 | The Ribbon wraps its buttons onto two rows. The active panel opens over the left edge of the canvas, and closes with Escape or a second click on its tab. |
| 375×812 | Panels collapse into bottom sheets. Header actions Save as, Print, Share and Learning material move into the `menu` opened by `button "File actions"`, as `menuitem`s with the same names; Undo and Redo stay as buttons. `button "Tools"` opens `dialog "Tools"`, a bottom sheet holding the Ribbon and the Drafting aids toolbar. `button "Panels"` opens `dialog "Panels"`, a bottom sheet holding the Editor panels tablist and its panel. The command line is a full-width input fixed above the on-screen keyboard. |

**Layouts.** A paper layout shows a white A3 landscape sheet on the black ground. It holds the title block in the lower right and one viewport frame showing model space at the viewport scale.

**Overflow.** No page scrolls sideways at 375, 768 or 1280 pixels wide.

### Public screens and controls (DP-01, DP-03, DP-05, DP-06, DP-07, DP-08, DP-10, DP-12, DP-15, DP-19, DP-26, DP-27, DP-28, DP-33, DP-34, DP-40, DP-45, DP-46, DP-48, DP-54)

Only these roles and names are public; everything else is free. Copy shown as `<…>` comes from Feedback states.

**Landing**

| Control or region | Where and visible copy |
|---|---|
| `banner` (sticky account header) | Top bar after scroll. Holds `img "Corbel Works"`, then `link "Create account"` (outline) and `link "Sign in"` (filled). Hidden and inert until shown. |
| `heading` level 1 (drafting hero lockup) | Two lines: `Draw the plan.` / `Review the live sheet.` |
| Hero subhead | `Command-line drafting and safe client markup in one browser tab.` |
| `link "Start drafting"` (primary draft button) | Filled. Goes to `/signup`. |
| `link "Open a shared drawing"` (secondary outline button) | Outline. Goes to `/open`. |
| Hero fine print | `Free trial, no card needed. Already drafting with us?` followed by `link "Sign in"`. |
| `img "Corbel Draft on a laptop, tablet and phone"` (three-device plan preview) | Hero right column. |
| `region "Drafting capability band"` (drafting capability band) | Three columns titled `Command line first`, `Markup that can't move a wall` and `The same sheet everywhere`. |
| `region "Drafting demo"` (drafting stroke demo split) | Heading `Every stroke lands where you typed it.` Holds `button "Play drafting demo"` and `img "Drafting demo"`. |
| `img "Corbel Draft editor preview"` (editor window preview) | Beside the heading `A full command set, in the browser you already have.` |
| `region "Sheet sets"` (sheet set callout card) | Heading `Issue the sheet set. Keep every markup on the right revision.` |
| `contentinfo` (studio footer) | `link "Command reference"`, `link "Open a shared drawing"` and `© 2026 Corbel Works`. |

**Account**

| Control or region | Where and visible copy |
|---|---|
| `form "Create account"` | Holds `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `combobox "Studio time zone"` and `button "Create account"`. |
| `form "Sign in"` | Holds `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, and `button "Resend link"` when the account is unconfirmed. |
| `button "Send a new link"` | Check-inbox and verify pages. |
| `alert` | Form-level error on each form. Field errors are tied to their field and shown below it. |

**Dashboard**

| Control or region | Where and visible copy |
|---|---|
| `status "Trial"` | Dashboard and editor header, owner only. |
| `button "Get Pro for $12/month"` | Opens `dialog "Corbel Draft Pro"`, which holds `button "Email me a quote"` and `button "Close"`. |
| `navigation "Files"` | Holds `button "New Drawing"`, `button "Upload..."`, `button "New Folder"`, `link "Recent"`, `link "Sample Files"` and `link "My Drawings"`. |
| `complementary "Welcome"` | `Welcome back, <first name>`. Holds `link "Command reference"`, `link "Keyboard shortcuts"` and `link "Sample files"`. |
| `table "Files"` | Column header buttons `File Type`, `Name`, `Date Modified`, `Size`, `Owner` and `Shared`. Each column header carries `aria-sort`. |
| `textbox "Folder name"` | Inline New Folder row. |
| Row actions | `link "<name>"` opens the item. `button "More actions for <name>"` opens a `menu` with `menuitem "Version history"` (drawings only) and `menuitem "Delete"`. |
| `alertdialog "Delete <name>?"` | Holds `button "Delete"` and `button "Cancel"`. |
| `button "Refresh"` | Toolbar. |
| `button "Manage Support Files"` | Opens `dialog "Support files"`. |
| `searchbox "Search this folder"` | Toolbar. |
| `radiogroup "View"` | Radios `List` and `Grid`. Grid shows `list "Files"` of cards. |
| `status "Files status"` | Polite. Holds the item count. |
| `dialog "Version history — <name>"` | `list "Versions"`, with `button "Restore version <n>"` on each item. |
| `status "Announcements"` | Polite. Present on every signed-in page and on link pages. |

**Editor: header, Ribbon and canvas**

| Control or region | Where and visible copy |
|---|---|
| `navigation "Breadcrumb"` | `My Drawings / <drawing name>`, with a link to the folder. |
| Header buttons | `button "Save as"` (opens `dialog "Save as"`, which holds `textbox "File name"` and `button "Save"`), `button "Print"`, `button "Undo"`, `button "Redo"`, `button "Learning material"`, and `button "Share"` (owner only). |
| `status "Sync"` | Header. |
| `list "Collaborators"` | Header. |
| `status "Access"` | Header. |
| `status "Link"` | Header, share links only. |
| `tablist "Ribbon"` | Tabs `Draw`, `Annotate` and `Modify`. |
| Draw buttons | `Line`, `Polyline`, `Circle`, `Arc`, `Rectangle`, `Polygon`, `Spline`. |
| Annotate buttons | `Text`, `Linear`, `Aligned`, `Radius`, `Angular`. |
| Modify buttons | `Move`, `Copy`, `Rotate`, `Mirror`, `Scale`, `Trim`, `Extend`, `Fillet`, `Offset`, `Erase`. |
| `button "Top"` and `button "2D Wireframe"` | Canvas top left. Each opens a `menu` holding one `menuitemradio` of the same name. |
| `application "Drawing canvas"` | The drawing area. |
| `group "Grips"` | Above the canvas. Holds one `img "Grip <handle>"` per vertex of each selected or just-changed object. |
| `group "Change highlight"` | Above the canvas. Holds one `img "Changed <handle>"` per object redrawing after a remote change, and one `img "Trace stroke <handle>"` per stroke during trace playback. |
| Snap marker | `img "Endpoint snap"`, `img "Midpoint snap"`, `img "Center snap"` or `img "Intersection snap"`. |

**Editor: panels**

| Control or region | Where and visible copy |
|---|---|
| `tablist "Editor panels"` | Left icon sidebar. Tabs `Properties` (visible label `Prop.`), `Layers`, `Blocks`, `Xrefs`, `Traces`, `Activity` and `Issues`. |
| `region "Object Properties"` | Properties tab. Its heading is the object type (`Line`, `Polyline`, `Circle`, `Arc`, `Spline`, `MText`, `Dimension`, `Block reference`), or the selection count. Fields are listed below this table. |
| `region "Model Properties"` | Properties tab with no selection. Holds `combobox "Units"` and `combobox "Plot style"`. |
| `region "Layer Properties Manager"` | Layers tab. Holds `grid "Layers"`, `button "New layer"`, `button "Delete layer"` and `button "Set current"`. |
| `list "Block library"` | Blocks tab. Each item holds `button "Insert <name>"`, `spinbutton "Scale"` (default 1) and `spinbutton "Rotation"` (default 0). |
| `list "External references"` | Xrefs tab. Holds `button "Attach drawing"`, which opens `dialog "Attach drawing"` with `radiogroup "Drawing"` and `button "Attach"`. Each item holds `button "Unload <name>"`, `button "Reload <name>"` and `button "Detach <name>"`. |
| `list "Traces"` | Traces tab. Holds `button "New trace"`, which opens `dialog "New trace"` with `textbox "Trace name"` and `button "Create trace"`. Each item holds `button "Open trace <name>"`, plus `button "Submit trace"` for its author while open, and `button "Close trace <name>"` for the owner while submitted. |
| `status "Trace"` | Shown while a trace is active. |
| `log "Activity"` | Activity tab. |
| `list "Issues"` | Issues tab. Holds `button "Resolve issue <n>"` for the owner. |

**Grid "Layers" columns.** Each row is one layer.

| Column | Cell content |
|---|---|
| Status | Shows `Current` on the current layer. |
| Name | Editable with F2. |
| On | `checkbox "On <name>"`. |
| Freeze | `checkbox "Freeze <name>"`. |
| Lock | `checkbox "Lock <name>"`. |
| Color | `combobox "Color <name>"`. |
| Linetype | `combobox "Linetype <name>"`. |
| Lineweight | `combobox "Lineweight <name>"`. |
| Objects | Read-only count. |

**Object Properties fields.**

- **Every object:**
  - `combobox "Layer"`.
  - `combobox "Color"`: `ByLayer`, `Red`, `Yellow`, `Green`, `Cyan`, `Blue`, `Magenta`, `White`.
  - `combobox "Linetype"`: `ByLayer`, `Continuous`, `Dashed`, `Hidden`, `Center`.
  - `spinbutton "Linetype scale"`.
  - `combobox "Lineweight"`: `ByLayer`, `0.13 mm`, `0.18 mm`, `0.25 mm`, `0.35 mm`, `0.50 mm`, `0.70 mm`, `1.00 mm`.
  - `combobox "Dimension style"`, `combobox "Text style"` and `combobox "Multileader style"`, each offering `Standard` and `Annotative`.
  - A read-only `Handle`.
- **Line:** editable `textbox "Start X"`, `textbox "Start Y"`, `textbox "End X"` and `textbox "End Y"`. Read-only `Length` and `Angle`.
- **Polyline:** read-only `Vertices`, `Closed` (`Yes` or `No`), `Length` and `Area`.
- **Circle:** editable `textbox "Center X"`, `textbox "Center Y"` and `textbox "Radius"`. Read-only `Diameter`, `Circumference` and `Area`.
- **Arc:** read-only `Radius`, `Start angle`, `End angle` and `Length`.
- **Block reference:** read-only `Block name`. Editable `textbox "Position X"`, `textbox "Position Y"`, `textbox "Scale"` and `textbox "Rotation"`.
- **Dimension:** read-only `Measurement`, and `textbox "Text override"`.
- **MText:** `textbox "Contents"`, `textbox "Text height"` and `textbox "Width"`.
- **Revision cloud:** read-only `Arcs`.
- **Paper-layout viewport:** `combobox "Viewport scale"`: `1:20`, `1:50`, `1:100`, `1:200`.

**Editor: layouts, status bar, command line and dialogs**

| Control or region | Where and visible copy |
|---|---|
| `tablist "Layouts"` | Tabs `Model`, `Layout1`, `Layout2` and any added layouts. Followed by `button "New layout"` (visible `+`). |
| `status "Space"` | Status bar. `MODEL` or `PAPER`. |
| `toolbar "Drafting aids"` | Status bar. `button "OSNAP"`, `button "ORTHO"`, `button "POLAR"`, `button "SNAP & GRID"` and `button "OTRACK"`, each with `aria-pressed`. |
| `status "Coordinates"` | Status bar. |
| `status "Zoom"` | Status bar. |
| `textbox "Command"` | Placeholder `Type a command`. |
| `log "Command history"` | Above the command textbox. |
| `status "Command prompt"` | Polite. The current prompt. |
| `status "Service status"` | Outage banners. |
| `dialog "Command reference"` | Opened by F1 or Learning material. Lists every alias, prompt and shortcut. |
| `dialog "Export"` | Opened by Print or Ctrl+P. Holds `radiogroup "Format"` (`PDF`, `DXF`), `combobox "Layout"` (disabled for DXF), `button "Export"`, `list "Exports"`, and `button "Title block revisions"`, which opens `dialog "Title block A3"`. Each Exports row has `link "Download <file>"` once Ready. |
| `dialog "Title block A3"` | Holds `list "Revisions"`, `textbox "Footer note"`, `textbox "Effective date"` and `button "Add revision"`. |
| `dialog "Share drawing"` | Holds `radiogroup "Access"` (`Can view`, `Can mark up`, `Can edit`), `textbox "Recipient email"`, `textbox "Recipient name"`, `textbox "Expiry date"`, `button "Send invite"`, `button "Copy link"`, and `list "Share links"`. Each Share links item holds `button "Revoke link for <recipient>"`. |
| `alertdialog "Edit conflict"` | Holds `button "Load latest"`. |

### Interactions (DP-06, DP-07, DP-10, DP-11, DP-12, DP-14, DP-15, DP-16, DP-19, DP-26, DP-27, DP-28, DP-29, DP-32, DP-38, DP-42, DP-52, DP-58)

**Command entry.**

- **Starting the editor.** Focus starts in `textbox "Command"`.
- **Typing elsewhere.** A printable key typed while focus is on the canvas, a ribbon button or the status bar goes into the command line.
- **Submitting.** Enter or Space submits the line. Space types a space only at the MTEXT `Enter text:` prompt.
- **Repeating and cancelling.** Enter on an empty line at the idle prompt repeats the last command. Escape cancels the running command.
- **Echo and prompts.** Each command echoes its full name into `log "Command history"`. Its prompts then appear in `status "Command prompt"` and the history.

**Aliases** (case-insensitive; the typed full name works too):

| Alias | Command | Alias | Command |
|---|---|---|---|
| L | LINE | E | ERASE |
| PL | PLINE | LA | LAYER (opens the Layers tab) |
| C | CIRCLE | I | INSERT (opens the Blocks tab) |
| A | ARC | DLI | DIMLINEAR |
| REC | RECTANG | DAL | DIMALIGNED |
| POL | POLYGON | DRA | DIMRADIUS |
| SPL | SPLINE | DAN | DIMANGULAR |
| M | MOVE | MT or T | MTEXT |
| CO | COPY | DI | DIST |
| RO | ROTATE | RC | REVCLOUD (inside a trace only) |
| SC | SCALE | U | UNDO |
| MI | MIRROR | REDO | REDO |
| O | OFFSET | Z | ZOOM (then `E` for extents) |
| TR | TRIM | EX | EXTEND |
| F | FILLET | | |

**Opening panels from the command line.**

- `LA` opens the Layers tab and moves focus into `grid "Layers"`.
- `I` opens the Blocks tab and moves focus to the first `Insert` button.
- `button "Insert <name>"` starts INSERT for that block with its Scale and Rotation, and moves focus back to `textbox "Command"`.

**Ribbon.**

- The arrow keys move between `Draw`, `Annotate` and `Modify` with roving focus. Tab moves into the active tab's buttons.
- A ribbon button starts its command exactly as typing its alias does, and moves focus to `textbox "Command"`.

**Editor shortcuts.** These work whichever editor control has focus, including a button:

| Key | Action |
|---|---|
| F1 | Command reference. |
| F3 | OSNAP. |
| F8 | ORTHO. |
| F9 | SNAP & GRID. |
| F10 | POLAR. |
| F11 | OTRACK. |
| Ctrl+P | Export dialog. |
| Ctrl+Z and Ctrl+Y | UNDO and REDO, except while focus is in a text field, where they edit the text. |
| `+` and `-` | Zoom while focus is on the canvas. |

**Selecting objects** at a `Select object…` prompt, or at the idle prompt to fill Properties:

- `#<handle>` (for example `#1A`) selects that object.
- A typed point selects the nearest selectable object within 10 millimetres of model space.
- A click or tap selects the nearest selectable object within 5 screen pixels. Ties go to the most recently created object.
- Shift+click adds to the selection, and Escape clears it.
- Objects on frozen or turned-off layers, xref objects and (outside a trace) trace objects are never selected.
- Selected objects show their grips.

**View and screen mapping.**

- **Axes.** The canvas is `application "Drawing canvas"`, with Y pointing up.
- **Fit to extents.** When a drawing opens, and after `ZOOM` then `E`, the view fits the extents of every base object on a layer that is neither frozen nor off.
  - The scale is `min(0.8 × canvas width ÷ extents width, 0.8 × canvas height ÷ extents height)`, in screen pixels per millimetre, where canvas width and height are the canvas element's box in CSS pixels.
  - The extents are centred in that box.
  - A drawing with no such objects fits the area 0,0 to 10000,7000.
- **Screen point.** A model point `x,y` appears at:
  - screen x = `canvas left + canvas width ÷ 2 + (x − extents centre x) × scale`
  - screen y = `canvas top + canvas height ÷ 2 − (y − extents centre y) × scale`
- **Zoom.** The fitted view is `Zoom 100%`. Zoom percentage is the current scale divided by the fitted scale, as a whole percent.
  - The mouse wheel zooms by 1.25 per notch about the pointer.
  - `+` and `-` zoom by 1.25 about the canvas centre.
  - A pinch zooms by the ratio of the finger distances.
- **Pan.** A middle-button drag pans, and so does a one-finger drag on touch.
- **Coordinates readout.** `status "Coordinates"` follows the pointer's model position, or the last tapped point on touch.

**Object snaps.**

- **Candidates.** All candidates come from the server (see API).
  - Endpoints of lines, polyline vertices and arc ends.
  - Midpoints of lines, polyline segments and arcs.
  - Centres of circles and arcs.
  - Intersections between drawn objects.
  - Block reference geometry and xref geometry count. Objects on frozen or turned-off layers never do. Locked layers do.
- **Aperture.** Its radius is 10 screen pixels around the mouse pointer, and 24 pixels around a touch point.
- **Marker.** When a candidate is inside the aperture and OSNAP is on, one marker shows: a square for Endpoint, a triangle for Midpoint, a circle for Center, an X for Intersection. It is 12 by 12 pixels, centred on the candidate's screen point within 1 pixel.
- **Winner.** The nearest candidate wins. Ties go in the order Endpoint, Midpoint, Center, Intersection.
- **Cycling.** Tab, pressed while a marker shows and the command line is waiting for a point, cycles to the next candidate in the aperture in that order.
- **Picking.** A click, a tap or Enter while a marker shows picks the exact candidate point.
- **Typed points** are never snapped.

**Other drafting aids.**

- **ORTHO** puts a picked point on the horizontal or vertical line through the last point, along the axis of the larger delta.
- **POLAR** snaps the direction from the last point to the nearest 45° increment, keeping the distance.
- ORTHO and POLAR turn each other off.
- **SNAP & GRID** shows a 100-millimetre grid and rounds picked points to it when no snap marker shows. A snap marker wins over the grid.
- **OTRACK** shows dotted horizontal and vertical alignment paths through the last picked snap point.
- **Defaults.** OSNAP starts on and the other aids start off. Each aid's state is kept per browser tab.

**Grips and in-place values.**

- Dragging a line's end grip moves that end.
- While dragging, the Properties values and the dimension measurements that depend on that line are shown from the pointer position as it moves.
- On release the change is saved, and the panel then shows the saved values from the server.
- Typing a new value into an editable field and pressing Enter or leaving the field saves it.
- Derived fields update in place without a reload.

**Layers grid.**

- The arrow keys move between cells. Space toggles On, Freeze and Lock.
- F2 on a Name cell starts renaming. Enter commits and Escape cancels.
- Enter on a Color, Linetype or Lineweight cell opens its combobox.
- `New layer` adds the row with its name selected for typing.
- `Set current` makes the focused row current.

**Touch.**

- A tap is a touch shorter than 0.3 seconds that moves less than 8 pixels. A tap picks a point or selects an object.
- One finger dragging pans, and two fingers pinch-zoom.
- At a point prompt on a phone, the tap point snaps by the touch aperture.
- Every touch control is at least 44 by 44 pixels.

**Dialogs and sheets.**

- Every dialog, alert dialog and bottom sheet keeps Tab and Shift+Tab inside itself: Tab on the last control wraps to the first.
- Escape closes the dialog or sheet, and focus returns to the control that opened it.
- A dialog opened by a command returns focus to `textbox "Command"`. Load latest also returns focus there.

**Dashboard.**

- **Column headers.** A header button sorts by that column. The first press sorts in the column's default direction (newest first for Date Modified, A to Z otherwise), and each further press flips it. `aria-sort` follows. Folders always stay above files.
- **Search.** `searchbox "Search this folder"` filters rows about 0.3 seconds after typing stops, matching any part of the name, ignoring case.
- **View.** The arrow keys move between List and Grid.
- **New Folder** inserts the inline row at the top with `New folder` selected. Enter or leaving the field commits, and Escape removes the row.
- **Upload...** opens the native file picker for `.dxf` files.
- **Sorting rules** are those under Business rules.

### Visual design (DP-54, DP-56)

**Direction: seed.** Exact, blunt and alive.

- **Exact:** every drawn element is a thin, one-pixel mid-grey stroke on pure black.
- **Blunt:** buttons are flat rectangles with barely softened corners, either filled white with black labels or outlined in white.
- **Alive:** small hot red-pink square grips appear only where geometry is selected or has just arrived.

**Type.** One family, Fira Sans, self-hosted:

| Use | Weight |
|---|---|
| Headlines | Bold |
| Body | Regular |
| Labels and buttons | Medium |
| Word mark | `CORBEL` in extra-bold capitals, followed by `Works` in regular |

- Each heading step is a quarter larger than the step below.
- The hero headline is the largest step, about four and a half times body size.
- Body text is compact, with one-and-a-half line spacing.
- Every number uses Fira Sans tabular figures.

**Colour roles.**

| Role | Colour and use |
|---|---|
| Ground | Pure black behind every page. |
| Surface | Flat charcoal for panels, table bands, the capability band, the callout card and the footer. |
| Ink | White for headlines and body. |
| Muted ink | Light grey for secondary text. |
| Line | Mid-grey for the one-pixel wireframes and rules. |
| Link accent | Light cyan-blue for links, the focus ring and the trace frame. |
| Vertex accent | Hot red-pink for grips, constellation nodes, the outage marker and the render's light streak. |
| Canvas | Dark blue-slate drawing canvas. |
| Glyph colours | A deep drafting blue and a signal yellow, used only on the callout card's document glyph. |

Drawing objects use their layer or object colours on the canvas. Text meets WCAG 2.2 AA contrast. Decorative grey line art is not text.

**Density** is comfortable: generous space between sections and steady padding in panels.

**Landing components** (all copy and art original):

- **sticky account header.** A slim black bar across the full width, with a thin white rule along its bottom and no shadow.
  - Left: the compact logo. Right: the outline `Create account` and filled `Sign in` links, close to the right edge.
  - Hidden at the top of the page. It enters and leaves as described in Motion and effects.
- **drafting hero lockup.** The two-weight word mark above the two-line headline, each line ending in a full stop, then the bold subhead.
  - Below that: the primary draft button above the secondary outline button, each about a third of the left column wide, then the fine print with its cyan-blue Sign in link.
  - White on black with no panel. Wireframe lines pass behind it.
- **primary draft button.** White fill with a black label and corners softened only slightly.
  - Hover: light grey fill. Pressed: darker grey. Focus: the cyan-blue ring. Disabled: faded.
- **secondary outline button.** Transparent with a one-pixel white border and a white label.
  - Hover: a faint white wash. Pressed: a stronger wash. Focus: the cyan-blue ring.
- **three-device plan preview.** A laptop, a tablet overlapping its lower right and a phone at the far right, built in HTML and vector art with thin rounded bezels.
  - Each black screen shows a different floor plan, generated in code, drawn in grey lines with a few red grips.
  - On phones it sits at the bottom of the hero, scaled to the container.
- **drafting capability band.** One charcoal band across the container with three equal columns.
  - Each column has a flat grey line icon and a text block to its right: a bold title above two or three lines of body text.
  - No border, corner rounding or shadow. On phones the columns stack into three rows.
- **drafting stroke demo split.** A dark media frame on the left with its own play control.
  - `Play drafting demo` plays an animation once and stops: a plan outline drawn line by line, then offset and trimmed.
  - On the right: a bold four-line heading and two lines of body text.
- **editor window preview.** A desktop app window drawn in HTML and vector art.
  - A thin light title strip with three dots, a dark toolbar row, and a narrow property panel with labelled rows and a tool grid.
  - A blue-slate canvas showing a dense contour site plan generated in code, in magenta lines with white contours, and a command line with status chips at the bottom.
  - Hard edges, no shadow.
- **graphite slab backdrop.** Full bleed behind the editor preview section.
  - A near-black field crossed by large diagonal bevelled slabs in dark graphite tones, with white highlights along the slab edges.
  - One saturated red-pink light streak runs from the top left to the centre right.
  - Static.
- **roof shell wireframe.** An invented architectural line drawing in one-pixel grey strokes with no fills, decorative and hidden from assistive technology.
  - Behind the hero: oblique planes and a ribbed roof shell of arcs and offset curves.
  - Behind the callout section: the shell at full viewport size, with ribs, arches and hatch strokes.
- **selection grip constellation.** Thin light-grey lines meeting at small red-pink square nodes, like grips on selected geometry.
  - Placed at the left edge of the demo section, the top left of the preview section and the right half of the footer.
- **sheet set callout card.** A wide charcoal rectangle centred in the section, holding the centred bold two-line heading.
  - An original two-colour document glyph overlaps its top-right corner: deep blue on top with thin white crosshair lines, signal yellow below, and a folded corner.
- **studio footer.** A charcoal block about a quarter of a viewport tall.
  - Left: two stacked cyan-blue links and the light-grey copyright line. Right: a constellation.
  - Links underline on hover.

**Working screens.**

- The dashboard, file table, dialogs, Layers grid, Share dialog, Traces and Issues lists keep the black ground.
- Panels and table bands are flat charcoal with square corners and no shadow. Headings are bold Fira Sans on the heading steps.
- Links are cyan-blue. Buttons are the same blunt filled and outline pair, with the cyan-blue focus ring on every focusable control.
- **Empty states** show a small one-pixel wireframe sketch and one line of copy.
- **Loading** shows a few grey strokes drawing in.
- **Errors and outage banners** are a charcoal band with a small red-pink square at the left and the exact copy.
- **Trace mode** frames the canvas in a cyan-blue border and dims the base drawing to 40 percent strength.
- **Icons** are thin line icons from the Lucide set.

### Motion and effects (DP-44, DP-55, DP-57)

Motion means one thing here: geometry being drawn or arriving. Every motion runs as a browser-native animation on its own overlay element: an SVG path, a grip element or the header. The page's animation list reports each one, and canvas pixels never carry motion alone. There are no decorative loops, no parallax and no section fade-ups.

**Hero draw-in (landing).**

1. On load, each path of the hero roof shell wireframe is revealed from its start to its end over 0.9 seconds. The reveal starts fast and settles gently into place. Each path starts 0.04 seconds after the one before.
2. As each path completes, a small red-pink square grip at its endpoint grows from nothing to full size over 0.16 seconds.
3. Constellations draw the same way, once, the first time they scroll into view.

**Header handoff.**

1. When the bottom edge of the hero buttons crosses the top of the viewport, the sticky account header fades in while sliding down about eight pixels into place, over 0.2 seconds, settling gently. It is a threshold, not scroll-scrubbed.
2. Scrolling back until the hero buttons are in view again reverses it: the header fades and slides back up over 0.15 seconds, accelerating away. Then it is hidden and inert.

**Editor signature: grip draw-in handoff.**

1. When a change from another tab or person arrives, each changed object gets one `img "Changed <handle>"` overlay stroke. The stroke is revealed from start to end over 0.9 seconds, staggered 0.04 seconds per object. Objects that did not change do not redraw.
2. Red-pink grips (`img "Grip <handle>"`) pop at the changed objects' vertices over 0.16 seconds. They hold for 1.2 seconds, then fade over 0.2 seconds and are removed.
3. `status "Sync"` changes as published in Feedback states, and the Properties values update in place.

**Trace playback.** When the drafter opens a submitted trace, the base dims. Each trace stroke then draws in on its own `img "Trace stroke <handle>"` overlay, in the order it was authored.

- Each stroke takes 0.5 seconds, staggered 0.04 seconds. With more than ten strokes the stagger shrinks so the last starts by 0.4 seconds, so the whole playback ends in under one second.
- A grip pops at each stroke's endpoints and fades after the playback.

**Feedback motion.**

- Button fills and link underlines change over about 0.15 seconds on hover and press.
- Loading strokes draw in once and repeat only while a request is still pending.

**Reduced motion** (`prefers-reduced-motion: reduce`):

- Every wireframe path, constellation and grip shows fully drawn on first paint.
- The header appears and disappears at once, with no transition.
- Remote changes show their grips at once for the same 1.2-second hold with no draw-in.
- Trace playback shows all strokes and grips at once.
- The demo shows its final frame.
- Status chips and announcements are unchanged.

### Feedback states (DP-02, DP-03, DP-04, DP-05, DP-07, DP-08, DP-10, DP-13, DP-19, DP-20, DP-23, DP-24, DP-28, DP-30, DP-34, DP-40, DP-41, DP-43, DP-45, DP-46, DP-48, DP-50, DP-51, DP-52, DP-59)

This section owns every visible copy string. `<…>` placeholders are defined where they appear.

**Counts rule.**

- Every count of objects reads `1 object`, or `<n> objects` for any other number including 0.
- Item counts read `1 item` or `<n> items`.
- Unsupported-object counts read `1 unsupported object` or `<k> unsupported objects`.

**Announcement rule.** Every success, failure and outage message below that is not inside a form also goes to `status "Announcements"`.

**Account**

| State | Copy |
|---|---|
| Create account pending | Button reads `Creating account…` |
| Name error | `Enter your name (1 to 80 characters).` |
| Email error | `Enter a valid email address.` |
| Email taken | `An account with this email already exists.` |
| Password error | `Use at least 10 characters.` |
| Time zone error | `Choose a studio time zone from the list.` |
| Check-inbox page | Heading `Check your inbox`, then `We sent a confirmation link to <email>.` |
| Confirmation mail not accepted (sign-up or resend) | `Confirmation email not sent. Mail is unavailable; try again shortly.` with `button "Send a new link"` |
| Resend accepted | `A new link is on its way to <email>.` |
| Verify: confirmed | `Your email is confirmed.` with `link "Sign in"` |
| Verify: expired | `This confirmation link has expired.` with `button "Send a new link"` |
| Verify: replaced | `This confirmation link was replaced by a newer one.` with `button "Send a new link"` |
| Verify: unknown | `This confirmation link is not valid.` |
| Sign in pending | Button reads `Signing in…` |
| Sign in: wrong email or password | `Email or password is incorrect.` |
| Sign in: unconfirmed | `Confirm your email address first. We sent a link to <email>.` with `button "Resend link"` |
| Sign in: locked | `Too many attempts. Try again in 1 minute.` or `Too many attempts. Try again in <m> minutes.`, where `<m>` is the remaining lock time in whole minutes rounded up |

All sign-in refusals show in the form's `alert`.

**Trial**

| State | Copy |
|---|---|
| Trial status | `<n> days left in your trial`, `1 day left in your trial`, or `Your trial has ended` |
| Ended banner, and the history line for any base command after the end | `Your trial has ended. Drawings are read-only.` |

**Pro quote**

| State | Copy |
|---|---|
| Dialog body | `$12.00 per month. We'll email you a quote; there is nothing to pay here.` |
| Pending | Button reads `Sending quote…` |
| Sent | `Quote sent to <email>` |
| Mail down | `Quote not sent. Mail is unavailable; try again shortly.` |

**Files**

| State | Copy |
|---|---|
| Files status | The item count of the visible rows, for example `3 items` |
| No search match | `No files match "<query>".` |
| Empty folder | `No drawings yet. Start one with New Drawing or Upload.` |
| Folder name error | `Folder names can't contain / \ : * ? " < > | (1 to 80 characters).` |
| Folder name taken | `A folder named "<name>" already exists.` |
| File name error | `File names can't contain / \ : * ? " < > | (1 to 80 characters).` |
| File name taken | `A drawing named "<name>" already exists.` |
| Folder not empty | `Folder "<name>" is not empty.` |
| Delete dialog body | `This can't be undone.` |
| Deleted | `<name> deleted.` |
| Upload row pending | `Uploading <name>…` |
| Upload row stored | `Stored` |
| Not a DXF file | `<name> is not a DXF drawing.` |
| File too large | `<name> is larger than <limit> bytes.`, where `<limit>` uses comma thousands separators, for example `5,000,000` |
| Storage down (upload) | `Upload failed: file storage is unavailable.` |
| Same-name upload | `<name> updated to version <n>.` |
| Import summary | `Imported <n> objects; skipped <k> unsupported objects.` (counts rule) |
| Version history item | `Version <n> · <date-time> · <actor> · <size>` |
| Version history empty | `No stored versions yet.` |
| Restored | `Version <n> restored as version <m>.` |
| Shared column | `Shared` or `—` |
| Owner column | `You` or `Corbel Works` |
| Folder Size cell | `—` |

**Command prompts** (each shown in `status "Command prompt"` and the history):

| Command | Prompts in order |
|---|---|
| Idle | `Command:` |
| LINE | `Specify first point:`, then `Specify next point or [Undo]:`, and from the third point on `Specify next point or [Close/Undo]:` |
| PLINE | `Specify start point:`, then `Specify next point or [Close/Undo]:` |
| RECTANG | `Specify first corner point:`, then `Specify other corner point:` |
| CIRCLE | `Specify center point:`, then `Specify radius:` |
| ARC | `Specify center point:`, `Specify radius:`, `Specify start angle:`, `Specify end angle:` |
| POLYGON | `Enter number of sides:`, `Specify center point:`, `Specify radius:` |
| SPLINE | `Specify first point:`, then `Specify next point or [Undo]:` |
| MOVE, COPY | `Select objects:`, `Specify base point:`, `Specify second point:` |
| ROTATE | `Select objects:`, `Specify base point:`, `Specify rotation angle:` |
| SCALE | `Select objects:`, `Specify base point:`, `Specify scale factor:` |
| MIRROR | `Select objects:`, `Specify first point of mirror line:`, `Specify second point of mirror line:`, `Erase source objects? [Yes/No]:` |
| ERASE | `Select objects:` |
| OFFSET | `Specify offset distance:`, `Select object to offset:`, `Specify point on side to offset:`, then back to `Select object to offset:` until Enter |
| TRIM | `Select object to trim:`, repeated until Enter |
| EXTEND | `Select object to extend:`, repeated until Enter |
| FILLET | `Specify fillet radius:`, `Select first object:`, `Select second object:` |
| INSERT | `Specify insertion point:` |
| DIMLINEAR, DIMALIGNED | `Specify first extension line origin:`, `Specify second extension line origin:`, `Specify dimension line location:` |
| DIMRADIUS | `Select arc or circle:`, `Specify dimension line location:` |
| DIMANGULAR | `Select first line:`, `Select second line:`, `Specify dimension arc line location:` |
| MTEXT | `Specify first corner:`, `Specify opposite corner:`, `Enter text:` |
| DIST | `Specify first point:`, `Specify second point:` |
| REVCLOUD | `Specify first corner:`, `Specify opposite corner:` |
| ZOOM | `Enter E for extents, or press + or -:` |

At `Select objects:` prompts, each pick adds to the set and Enter ends selection.

**Command history lines.**

| Event | Line |
|---|---|
| Command started | `Command: <FULL NAME>` |
| Unknown command | `Unknown command "<text>". Press F1 for the command reference.` |
| Invalid coordinate | `Invalid point.` (the prompt then repeats) |
| Distance, radius, scale or side count not a positive number | `Requires a positive number.` |
| Selection found nothing | `No object found.` |
| Cancelled | `*Cancel*` |
| Toggles | `<Osnap on>`, `<Osnap off>`, `<Ortho on>`, `<Ortho off>`, `<Polar on>`, `<Polar off>`, `<Snap on>`, `<Snap off>`, `<Otrack on>`, `<Otrack off>` |
| Locked objects left out | `1 object is on a locked layer.` or `<n> objects are on a locked layer.` |
| View-only link, any editing command | `This drawing is view-only.` |
| Mark-up link, base command outside a trace | `This drawing is mark-up only. Start a trace to add markups.` |
| Base object picked inside a trace | `Base drawing objects can't be changed in a trace.` |
| Undo and redo | `Undo: <COMMAND>`, `Redo: <COMMAND>`, `Nothing to undo.`, `Nothing to redo.` |
| TRIM or EXTEND with no edge | `No cutting edge found.` |
| DIST result | `Distance = <d>, Angle in XY Plane = <a>, Delta X = <dx>, Delta Y = <dy>` |

**Announcements** (`status "Announcements"`):

| Event | Copy |
|---|---|
| Measurement | The DIST line followed by ` (millimeters)` or ` (meters)` |
| Block placed | `Block <name> inserted at <x>, <y>.` |
| Dimension placed | `Dimension added: <text>` |
| Units changed | `Units set to Millimeters.` or `Units set to Meters.` |
| Layer created | `Layer <name> created.` |
| Layer renamed | `Layer <old> renamed to <new>.` |
| Layer set current | `Layer <name> is now current.` |
| Layer On toggled | `Layer <name> turned on.` or `Layer <name> turned off.` |
| Layer Freeze toggled | `Layer <name> frozen.` or `Layer <name> thawed.` |
| Layer Lock toggled | `Layer <name> locked.` or `Layer <name> unlocked.` |
| Layer colour | `Layer <name> color set to <color>.` |
| Layer linetype | `Layer <name> linetype set to <linetype>.` |
| Layer lineweight | `Layer <name> lineweight set to <lineweight>.` |
| Layer deleted | `Layer <name> deleted.` |
| Xref attached | `<name> attached.` |
| Link copied | `Link copied.` |
| Link revoked (drafter) | `Link for <recipient> revoked.` |
| Trace submitted (drafter's tabs) | `Trace "<name>" submitted by <reviewer>` |
| Title-block revision added | `Revision <letter> added, effective <YYYY-MM-DD>.` |

**Layer errors** (shown in an `alert` inside the Layers panel):

| Refusal | Copy |
|---|---|
| Invalid name | `Layer names can use letters, digits, spaces, - _ and $ (1 to 64 characters).` |
| Name taken | `A layer named "<name>" already exists.` |
| Delete layer 0 | `Layer 0 can't be deleted.` |
| Rename layer 0 | `Layer 0 can't be renamed.` |
| Delete current layer | `Layer <name> is current and can't be deleted.` |
| Freeze current layer | `Layer <name> is current and can't be frozen.` |
| Delete locked layer | `Layer <name> is locked and can't be deleted.` |
| Delete layer with objects | `Layer <name> has <n> objects and can't be deleted.` (counts rule) |

**Properties panel**

| State | Copy |
|---|---|
| Heading with several objects | `<n> objects selected` |
| Value that differs across the selection | `*VARIES*` |
| Nothing selected | `No selection` |
| Object on a locked layer | `On locked layer <name>` |
| Linetype scale out of range | `Enter a value from 0.01 to 1000.` |
| Value that is not a number | `Enter a number.` |

**Activity entry.** `<HH:mm> · <actor> · <COMMAND> · <n> objects <verb>`, following the counts rule, where `<verb>` is `created`, `modified` or `erased`.

**Sync and conflict**

| State | Copy |
|---|---|
| `status "Sync"` | `Synced · v<n>`, `Syncing…`, `Live sync paused`, or `Conflict · v<n>`, where `<n>` is the drawing version the server last reported |
| Edit conflict dialog | `Another tab changed <n> objects before your edit was saved. Your edit was not applied.` (counts rule, for example `changed 1 object`) |
| Collaborators items | `<name> · Editing`, `<name> · Viewing`, or `<name> · Away` |

**Access, links and sharing**

| State | Copy |
|---|---|
| `status "Access"` | `Can edit`, `Mark-up only`, or `View only` (owners see `Can edit`) |
| `status "Link"` | `Expires <MMM D, YYYY>, 11:59 PM (<IANA zone>)`, or `Does not expire` |
| Expired link page heading | `This link has expired.` |
| Revoked link page heading | `This link was revoked by the owner.` |
| Unknown link page heading | `This link is not valid.` |
| Invite pending | Button reads `Sending invite…` |
| Invite sent | `Invite sent to <email>` |
| Invite mail down | `Invite not sent. Mail is unavailable; try again shortly.` |
| Invite cooldown | `You invited <email> moments ago. Try again in <s> seconds.` |
| Expiry date format error | `Enter a date as YYYY-MM-DD.` |
| Expiry date in the past | `Choose today or a later date.` |
| Recipient email error | The email error from Account |
| Share links item | `<access label> · <recipient> · <status>`, where `<access label>` is `Can view`, `Can mark up` or `Can edit` (the Access radio copy) and `<status>` is `Active`, `Expired` or `Revoked` |

**Traces and issues**

| State | Copy |
|---|---|
| `status "Trace"` | `Tracing: <name>` |
| Traces item | `<name> · <Open|Submitted|Closed>`, plus `Notice sent` or `Notice not sent` once submitted |
| Empty traces | `No traces yet.` |
| Trace name error | `Enter a trace name (1 to 80 characters).` |
| Submit pending | Button reads `Submitting…` |
| Issues item | `#<n> <text> · <Open|Resolved>` |
| Empty issues | `No issues yet.` |
| Revision cloud Properties | `Arcs <n>` |

**Export and title block**

| State | Copy |
|---|---|
| Exports row | `<file> · Rendering…`, `<file> · Ready` with `link "Download <file>"`, or `<file> · Failed` |
| Ready announcement | `Export ready: <file>` |
| Storage down (export) | `Export failed: file storage is unavailable.` |
| Footer note error | `Enter a footer note of 1 to 120 characters.` |
| Effective date error | `Choose a date after the latest revision and not before today.` |

**Xref statuses.** `Loaded`, `Unloaded` or `Not found`.

**Outage banners** (`status "Service status"`):

| Outage | Copy |
|---|---|
| Valkey | `Live sync is paused. Your edits still save; reload to see changes from other tabs.` |
| MinIO | `File storage is unavailable. Uploads and exports are paused until it returns.` |

**Pending, success, error and outage per async action** (copy above):

| Action | Pending | Success | Field or state error | Outage |
|---|---|---|---|---|
| Create account | `Creating account…` | Check-inbox page | Account field errors | Confirmation mail not accepted |
| Sign in | `Signing in…` | Dashboard | Sign-in refusals | — |
| Send a new link | Button disabled | Resend accepted | — | Confirmation mail not accepted |
| Email me a quote | `Sending quote…` | Quote sent | — | Quote mail down |
| New Folder | Row dimmed | Row stays | Folder errors | — |
| Upload | `Uploading <name>…` | `Stored`, same-name upload copy, import summary | Type and size errors | Storage down (upload) |
| Restore version | Button disabled | Restored | — | Storage down (upload) |
| Base edit | `Syncing…` | `Synced · v<n>` | Edit conflict dialog | `Live sync paused` |
| Export | `Rendering…` | `Ready` | — | `Failed` with storage down (export) |
| Send invite | `Sending invite…` | Invite sent | Share field errors, cooldown | Invite mail down |
| Submit trace | `Submitting…` | `Submitted`, then `Notice sent` | — | `Notice not sent` |
| DIST | Prompt | DIST line and announcement | `Invalid point.` | Link pages on expiry or revocation |

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-05, DP-06, DP-07, DP-08, DP-09, DP-10, DP-13, DP-15, DP-16, DP-17, DP-18, DP-19, DP-24, DP-30, DP-33, DP-34, DP-36, DP-37, DP-39, DP-40, DP-41, DP-43, DP-46, DP-48, DP-49, DP-51, DP-53, DP-60)

#### Conventions

- **Content type.** Every request and response body is `application/json; charset=utf-8`, except uploads (`multipart/form-data`), downloads and event streams.
- **Units.** Coordinates and distances in requests and responses are millimetres, as numbers rounded to 6 decimals. Points are `[x, y]`. Angles are degrees from 0 up to but not including 360, counter-clockwise from +X. Times are ISO 8601 with offset.
- **Who is acting.** A request acts as one of two callers:
  - A signed-in account, through the `corbel_session` cookie (HttpOnly, SameSite=Lax, path `/`, 30 days).
  - A share-link holder, through the header `Authorization: Link <token>`.
  - Drawing endpoints accept either. Account endpoints accept only the cookie.
- **Access levels.** `owner`, `edit`, `markup` and `view`.

#### Errors

**Error shape.** Errors are `{"error":"<code>"}`, plus any extra fields named for that code. Validation errors are `{"errors":{"<field>":"<message>"}}`, where `<message>` is the Feedback states copy.

**Error precedence (one rule for the whole API).** Checks run in this order, and the first failure answers:

1. Body over its limit: 413.
2. Malformed JSON or wrong content type: 400 `bad_request`.
3. No valid session or link: 401 `unauthenticated`.
4. Unknown resource, or one from another workspace: 404 `not_found`.
5. Expired or revoked link or confirmation link: 410.
6. Access refusals, in the order `view_only`, `markup_only`, `trial_ended`, `forbidden`: 403.
7. State conflicts: 409.
8. Limits: 429.
9. The request's own outcome: 422 validation, then 401 `invalid_credentials`, then 403 `unverified`.
10. Provider unavailable: 503.

#### Error codes

| Code | Status | Extra fields | When |
|---|---|---|---|
| `body_too_large` | 413 | | JSON body over 1,000,000 bytes |
| `file_too_large` | 413 | `limit_bytes` | Uploaded file over `UPLOAD_MAX_BYTES` |
| `bad_request` | 400 | | Malformed JSON or wrong content type |
| `unauthenticated` | 401 | | No valid session or link |
| `invalid_credentials` | 401 | | Wrong email or password |
| `not_found` | 404 | | Unknown resource, or another workspace's |
| `link_expired` | 410 | | Share link past its expiry second |
| `link_revoked` | 410 | | Share link revoked |
| `verify_link_expired` | 410 | | Confirmation link past its lifetime |
| `verify_link_replaced` | 410 | | A newer confirmation link exists |
| `view_only` | 403 | | Write through a view link |
| `markup_only` | 403 | | Any write through a mark-up link other than the holder's own trace actions |
| `trial_ended` | 403 | | Base write on a drawing whose owner's trial has ended |
| `forbidden` | 403 | | Owner-only action, or another person's trace |
| `unverified` | 403 | `email` | Sign-in to an unconfirmed account |
| `version_conflict` | 409 | `current_version`, `changed` | Base edit on a stale version |
| `layer_zero` | 409 | | Delete or rename layer 0 |
| `layer_current` | 409 | | Delete or freeze the current layer |
| `layer_locked` | 409 | | Delete a locked layer |
| `layer_in_use` | 409 | `objects` | Delete a layer that holds objects |
| `folder_not_empty` | 409 | | Delete a folder that holds items |
| `trace_not_open` | 409 | | Add to, erase in or submit a trace that is not open |
| `trace_not_submitted` | 409 | | Close a trace that is not submitted |
| `issue_resolved` | 409 | | Resolve an issue that is already resolved |
| `export_not_ready` | 409 | | Download an export that is not stored |
| `signin_locked` | 429 | `retry_after_seconds` | Address locked |
| `invite_cooldown` | 429 | `retry_after_seconds` | Repeat invite within the cooldown |
| `mail_unavailable` | 503 | | SMTP did not accept the message |
| `storage_unavailable` | 503 | | MinIO did not confirm the object |

#### Health and grading

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | — | 200 `{"status":"ok"}` when Postgres, MinIO, Mailpit and Valkey all answer; 200 `{"status":"unavailable"}` otherwise. Never 503. | — |
| `POST /api/grading/workspaces` | `{"preset":"blank"|"studio-plan","time_zone":"<IANA zone>","units":"mm"|"m"}`. `time_zone` defaults to `UTC` and `units` to `mm`. | 201 `{"workspace_id","drafter":{"name","email","password"},"reviewer":{"name","email"},"session":{"name":"corbel_session","value"},"drawing":{"id","name","url","version"}}` | 422 for an unknown preset, zone or units |
| `PUT /api/grading/workspaces/<id>/clock` | `{"now":"<ISO time>"}` | 200 `{"now"}` | 422 `now` |
| `DELETE /api/grading/workspaces/<id>/clock` | — | 204 | — |

The grading endpoints need no session. When `CORBEL_GRADING` is `off`, each answers 404 `{"error":"not_found"}`.

#### Accounts

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/auth/signup` | `{"name","email","password","time_zone"}` | 201 `{"user":{"id","name","email","verified":false},"email_status":"sent"|"not_sent"}` | 422 `name`, `email`, `password`, `time_zone` |
| `POST /api/auth/verify` | `{"token"}` | 200 `{"verified":true,"email"}` | 410 `verify_link_expired` or `verify_link_replaced`, each with `email` |
| `POST /api/auth/verify/resend` | `{"email"}` or `{"token"}` | 202 `{"email_status":"sent"}`, also for an unknown address | 503 `mail_unavailable` |
| `POST /api/auth/signin` | `{"email","password"}` | 200 `{"user":{...}}`, and sets `corbel_session` | 429 `signin_locked`, 401 `invalid_credentials`, 403 `unverified` |
| `POST /api/auth/signout` | — | 204 | — |
| `GET /api/me` | — | 200 `{"user":{"id","name","email","time_zone","verified"},"trial":{"days_left","ended"},"now"}` | — |
| `POST /api/quotes` | `{}` | 201 `{"quote":{"number","amount":"12.00","currency":"USD","sent_to"}}` | 503 `mail_unavailable` |

#### Files

`<folder id>` may be `root` for My Drawings.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/folders/<folder id>?sort=type|name|modified|size|owner|shared&order=asc|desc&q=<text>` | — | 200 `{"folder":{"id","name","parent_id"},"items":[{"id","kind":"folder"|"drawing","name","modified_at","modified_label","size_bytes","size_label","owner","shared"}]}` | 422 `sort` or `order` |
| `POST /api/folders` | `{"parent_id","name"}` | 201 `{"folder":{...}}` | 422 `name` |
| `DELETE /api/folders/<id>` | — | 204 | 409 `folder_not_empty` |
| `POST /api/drawings` | `{"folder_id","name"?}` | 201 `{"drawing":<drawing>}` | 422 `name` |
| `POST /api/drawings/<id>/copy` | `{"name"}` | 201 `{"drawing":<drawing>}` | 422 `name` |
| `DELETE /api/drawings/<id>` | — | 204 | — |
| `POST /api/folders/<folder id>/uploads` | Multipart, field `file` | 201 `{"drawing":<drawing>,"file_version","imported","skipped"}` | 413 `file_too_large`, 422 `file`, 503 `storage_unavailable` |
| `GET /api/drawings/<id>/file-versions` | — | 200 `{"versions":[{"number","created_at","created_label","actor","size_bytes","object_key"}]}`, newest first | — |
| `GET /api/drawings/<id>/file-versions/<n>/download` | — | 200, the stored bytes as `application/dxf` with `Content-Disposition: attachment; filename="<name>"` | — |
| `POST /api/drawings/<id>/file-versions/<n>/restore` | `{"base_version"}` | 201 `{"file_version","version"}` | 409 `version_conflict`, 503 `storage_unavailable` |
| `POST /api/drawings/<id>/opened` | — | 204 | — |
| `GET /api/recent` | — | 200 `{"items":[<item>...]}`, at most 10 | — |
| `GET /api/support-files` | — | 200 `{"linetypes","plot_styles","blocks","templates","text_styles"}` | — |

`modified_label` and `created_label` use the date-time format. `size_label` uses the file-size format.

#### Drawing read

`GET /api/drawings/<id>` answers 200 with `<drawing>`:

```
{"id","name","folder_id","owner":{"name"},"units":"mm"|"m","plot_style":"Monochrome"|"Color"|"Grayscale",
 "version":<n>,"access":"owner"|"edit"|"markup"|"view",
 "layers":[{"name","color","linetype","lineweight","on","frozen","locked","current","objects"}],
 "objects":[<object>...],"intersections":[[x,y]...],
 "layouts":[{"name":"Model"},{"name":"Layout1","viewport_scale":"1:50"}],
 "xrefs":[{"id","drawing_id","name","status":"loaded"|"unloaded"|"not_found","objects":[<object>...]}],
 "traces":[{"id","name","state":"open"|"submitted"|"closed","author","notice":"sent"|"not_sent"|null}]}
```

- `objects` holds base objects only, including objects on frozen layers.
- `intersections` lists intersection snap points among base and loaded xref objects on layers that are neither frozen nor off.

**`<object>` fields.** Every object carries:

- `handle`, `type`, `layer`.
- `color`: `ByLayer` or a colour name.
- `linetype`: `ByLayer` or a linetype name.
- `linetype_scale`.
- `lineweight`: `ByLayer` or, for example, `0.50 mm`.
- `dimension_style`, `text_style` and `multileader_style`.
- `snaps`: `{"endpoint":[...],"midpoint":[...],"center":[...]}`.

Fields by `type`:

| `type` | Fields |
|---|---|
| `line` | `start`, `end`, `length`, `angle` |
| `polyline` | `vertices`, `closed`, `length`, `area` (null when open) |
| `circle` | `center`, `radius`, `diameter`, `circumference`, `area` |
| `arc` | `center`, `radius`, `start_angle`, `end_angle`, `length` |
| `spline` | `fit_points` |
| `mtext` | `position`, `width`, `height`, `contents` |
| `dimension` | `kind` (`linear`, `aligned`, `radius`, `angular`), `points`, `location`, `measurement` (millimetres, or degrees for angular), `text_override` (null when none), `text` (the shown text) |
| `insert` | `block`, `position`, `scale`, `rotation` |
| `revcloud` (traces only) | `first`, `opposite`, `arcs` |

#### Base edits

**`POST /api/drawings/<id>/commands`.**

- **Request:** `{"base_version":<n>,"command":"<FULL NAME>","args":{...}}`.
- **Success:** 200 `{"version","created":[h...],"modified":[h...],"erased":[h...],"locked":[h...],"objects":[<object>...],"history":<line or null>}`. `objects` holds the created and modified objects. `history` is the Feedback states line for the result, for example the locked line.
- **Extra errors:** 409 `version_conflict`, 409 layer codes, and 422 `{"errors":{"command"|"args"|"handles"|"<field>":"…"}}`.
- **Args** are in millimetres and degrees:

| Command | `args` |
|---|---|
| LINE | `{"points":[[x,y],…],"close":bool}`. One line per segment. |
| PLINE | `{"points":[…],"closed":bool}` |
| RECTANG | `{"first":[x,y],"other":[x,y]}`. One closed polyline with 4 vertices, starting at `first` and going counter-clockwise. |
| CIRCLE | `{"center","radius"}` |
| ARC | `{"center","radius","start_angle","end_angle"}` |
| POLYGON | `{"center","sides","radius"}`. Inscribed, with the first vertex on +X. |
| SPLINE | `{"fit_points":[…]}` |
| MOVE, COPY | `{"handles":[…],"from":[x,y],"to":[x,y]}` |
| ROTATE | `{"handles","base","angle"}` |
| SCALE | `{"handles","base","factor"}` |
| MIRROR | `{"handles","first","second","erase_source":bool}` |
| ERASE | `{"handles":[…]}` |
| OFFSET | `{"handle","distance","side":[x,y]}` |
| TRIM, EXTEND | `{"handle","pick":[x,y]}` |
| FILLET | `{"handles":[a,b],"radius"}` |
| INSERT | `{"block","position","scale","rotation"}` |
| DIMLINEAR, DIMALIGNED | `{"first","second","location"}` |
| DIMRADIUS | `{"handle","location"}` |
| DIMANGULAR | `{"first_handle","second_handle","location"}` |
| MTEXT | `{"position","width","height","contents"}` |
| PROPERTIES | `{"handles":[…],"set":{<any Properties field by API name>}}`, or `{"model":{"units"?,"plot_style"?}}` |
| LAYER | `{"op":"new"}`, `{"op":"rename","name","new_name"}`, `{"op":"set","name","on"?,"frozen"?,"locked"?,"color"?,"linetype"?,"lineweight"?}`, `{"op":"current","name"}`, `{"op":"delete","name"}` |
| LAYOUT | `{"op":"new"}`, or `{"op":"scale","name","viewport_scale"}` |
| XREF | `{"op":"attach","drawing_id"}`, or `{"op":"unload"|"reload"|"detach","xref_id"}` |
| UNDO, REDO | `{}` |

**Version conflict body:** `{"error":"version_conflict","current_version":<n>,"changed":["<handle>",…]}`.

**Measure.** `POST /api/drawings/<id>/measure` takes `{"first":[x,y],"second":[x,y]}`, is allowed for every access level, and answers 200 `{"distance","angle","delta_x","delta_y","text"}`, where `text` is the DIST line.

#### Events, activity and presence

| Method and path | Request | Success |
|---|---|---|
| `GET /api/drawings/<id>/events` | — | 200 `text/event-stream`. Events `change` `{"version","changed","actor","command"}`, `presence` `{"collaborators":[{"name","state"}]}`, `link` `{"status"}`, `trace` `{"trace"}`, `issues` `{"issues"}`, `activity` `{"entry"}`, `trial` `{"days_left","ended"}`, `sync` `{"state":"live"|"paused"}` |
| `GET /api/events` | — | 200 `text/event-stream`, account events `files` `{"folder_id"}`, `recent` `{}`, `trial` `{"days_left","ended"}` |
| `POST /api/drawings/<id>/presence` | `{"tab_id"}` | 204 |
| `GET /api/drawings/<id>/activity` | — | 200 `{"entries":[{"at","actor","command","count","verb","text"}]}`, newest first, at most 50 |

#### Traces and issues

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/drawings/<id>/traces` | `{"name"}` | 201 `{"trace":{"id","name","state":"open","author","objects":[]}}` | 403 `view_only`, 422 `name` |
| `GET /api/traces/<id>` | — | 200 `{"trace":{…,"objects":[<object>…]}}` | — |
| `POST /api/traces/<id>/commands` | `{"command":"LINE"|"PLINE"|"CIRCLE"|"REVCLOUD"|"MTEXT"|"ERASE","args":{…}}`. REVCLOUD args are `{"first","opposite"}`. ERASE handles must be this trace's. | 200 `{"trace":{…}}` | 403 `forbidden`, 409 `trace_not_open`, 422 |
| `POST /api/traces/<id>/submit` | — | 200 `{"trace":{"state":"submitted","notice":"sent"|"not_sent"}}` | 403 `forbidden`, 409 `trace_not_open` |
| `POST /api/traces/<id>/close` | — | 200 `{"trace":{"state":"closed"}}` | 403 `forbidden`, 409 `trace_not_submitted` |
| `GET /api/drawings/<id>/issues` | — | 200 `{"issues":[{"number","trace_id","text","status":"open"|"resolved"}]}` | — |
| `POST /api/drawings/<id>/issues/<n>/resolve` | — | 200 `{"issue":{…,"status":"resolved"}}` | 403 `forbidden`, 409 `issue_resolved` |

#### Shares and links

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/drawings/<id>/shares` | `{"access":"view"|"markup"|"edit","recipient_email","recipient_name"?,"expiry_date":"YYYY-MM-DD"|null}` | 201 `{"share":{"id","token","url","access","recipient_email","recipient_name","expires_at","time_zone","status":"active"}}` | 403 `forbidden`, 422 `access`, `recipient_email`, `expiry_date` |
| `GET /api/drawings/<id>/shares` | — | 200 `{"shares":[…]}`, with `status` `active`, `expired` or `revoked` | 403 `forbidden` |
| `POST /api/shares/<id>/invite` | — | 200 `{"invite":"sent","sent_to"}` | 403 `forbidden`, 429 `invite_cooldown`, 503 `mail_unavailable` |
| `POST /api/shares/<id>/revoke` | — | 200 `{"share":{…,"status":"revoked"}}`. Repeating it answers the same. | 403 `forbidden` |
| `GET /api/links/<token>` | — | 200 `{"drawing":{"id","name"},"access","status":"active","expires_at","time_zone","expiry_label"}` | 404, 410 `link_expired` or `link_revoked` |

`url` is `<public URL>/s/<token>`. `expiry_label` is the `status "Link"` copy.

#### Exports and title block

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/drawings/<id>/exports` | `{"format":"pdf"|"dxf","layout":"<layout name>"}`. DXF ignores `layout`. | 202 `{"export":{"id","state":"rendering","file"}}` | 403 `view_only` or `markup_only` by link access, 422 `format` or `layout` |
| `GET /api/drawings/<id>/exports` | — | 200 `{"exports":[…]}`, newest first | — |
| `GET /api/exports/<id>` | — | 200 `{"export":{"id","drawing_id","format","layout","file","state":"rendering"|"stored"|"failed","issued_at","issue_date","title_block_revision","object_key","size_bytes","download_url"}}` | — |
| `GET /api/exports/<id>/download` | — | 200, the stored bytes (`application/pdf` or `application/dxf`) with `Content-Disposition: attachment; filename="<file>"` | 409 `export_not_ready` |
| `GET /api/templates/title-block-a3/revisions` | — | 200 `{"revisions":[{"letter","footer_note","effective_date"}]}` | — |
| `POST /api/templates/title-block-a3/revisions` | `{"footer_note","effective_date"}` | 201 `{"revision":{…}}` | 403 `forbidden`, 422 `footer_note` or `effective_date` |

### Business rules (DP-02, DP-03, DP-04, DP-05, DP-07, DP-08, DP-11, DP-13, DP-14, DP-15, DP-16, DP-17, DP-20, DP-21, DP-22, DP-23, DP-24, DP-26, DP-27, DP-28, DP-30, DP-31, DP-33, DP-34, DP-35, DP-36, DP-37, DP-39, DP-40, DP-41, DP-43, DP-44, DP-46, DP-49, DP-50, DP-51, DP-53)

#### Formats

**Drawing values.**

- Stored geometry is always millimetres.
- With Units `Millimeters`, lengths, coordinates and areas show 2 decimals (`6000.00`). With `Meters` they show 3 decimals (`6.000`), and areas in square metres.
- Typed coordinates and distances are read in the current units.
- Angles show 2 decimals and a degree sign (`90.00°`).
- Rounding is half away from zero, with no thousands separators.

**Coordinate input.**

- Absolute `x,y`. Relative `@dx,dy`, from the last point. Polar `@d<a`, with `a` in degrees counter-clockwise from +X.
- Each number is an optional `-`, then digits, then an optional `.` fraction. Anything else is an invalid point.

**Dates and sizes.**

- Date-times show as `MMM D, YYYY, h:mm A` in the studio time zone, for example `Nov 4, 2026, 2:05 PM`.
- Title blocks and quote numbers use `YYYY-MM-DD` and `YYYYMMDD` in the studio zone.
- Activity times show as `HH:mm`, 24-hour, in the studio zone.
- File sizes use decimal units with one decimal: `512 B`, `12.4 KB`, `1.2 MB`.

#### Time and limits

**Server clock and live updates.**

- **Workspace clock.** Every time rule reads the workspace's server now. That is the real clock, unless the grading clock has been set; then time runs forward in real time from the set instant. The browser's clock may be wrong and never decides any status.
- **Re-evaluation.** The server re-evaluates every time-dependent status at least once a second, and at once when a workspace clock is set. This covers trial end, link expiry and presence.
- **Live-update limit.** Every live push reaches open tabs within 2 seconds of the change or time edge. This covers drawing changes, layer counts, activity, presence, link status, trial state, trace submissions, issues and file-list changes.

**Time limits and settings.** Each is read from its environment variable at start:

| Variable | Default | Rule |
|---|---|---|
| `VERIFY_LINK_SECONDS` | 86400 | A confirmation link is expired at or after its creation plus this many seconds. |
| `SIGNIN_MAX_FAILURES` | 5 | Failed sign-ins for one address in a row (since the last success or lock end) before it locks. The failure that reaches the count starts the lock. |
| `SIGNIN_LOCK_SECONDS` | 900 | During the lock every sign-in for that address is refused, even with the right password. |
| `INVITE_COOLDOWN_SECONDS` | 60 | A second invite for the same drawing and address is refused if fewer than this many seconds have passed since the last accepted one. Exactly this many seconds is allowed. |
| `PRESENCE_IDLE_SECONDS` | 120 | A collaborator with no input for at least this long is Away. |
| `UPLOAD_MAX_BYTES` | 5000000 | Largest uploaded file. Equal is allowed. |
| `TRIAL_DAYS` | 30 | Trial length in studio-zone calendar days. |

#### Accounts and trial

**Accounts.** An account moves `unverified -> verified` only through a valid confirmation link. Sign-in to an unverified account is refused.

**Confirmation links.**

- Sign-up sends the first link. Send a new link sends a fresh one and replaces every older link.
- An older link is then replaced, even if it is within its lifetime.
- Opening the link of an already verified account answers confirmed again.

**Trial.**

- Days left = `TRIAL_DAYS` minus the whole studio-zone calendar days between the confirmation date and today, never below 0.
- The trial has ended when days left is 0, that is, from studio midnight at the start of that day.
- After the end:
  - Base writes on the owner's drawings are refused (`trial_ended`), whoever makes them.
  - Drawings open with the ended banner.
  - Reading, measuring, traces, exports and shares keep working.

**Pro quote.**

- The Pro price is $12.00 per month.
- Quote numbers are `Q-<YYYYMMDD>-<4-digit sequence>`: the studio-zone date, then a per-workspace sequence that starts at `0001` each studio day.
- A number is used only when Mailpit accepts the message. There is no checkout, card form or plan change.

#### Files

**Names.**

- Folder and file names are 1 to 80 characters without `/ \ : * ? " < > |`, unique in their folder ignoring case.
- File names get `.dxf` appended when missing.
- New Drawing names default to `Drawing<n>.dxf`, with the smallest free `<n>` starting at 1.
- Save as defaults to `<name without .dxf> copy.dxf`. It copies objects, layers and layouts into a new drawing at version 1, with no file versions.

**Concurrent folder creation.** Of several simultaneous creations with the same name in one folder, exactly one answers 201 and the rest answer 422 with the duplicate error.

**Date Modified.**

- A folder's Date Modified is set to the server now when it is created, and whenever anything is created, uploaded or deleted directly inside it.
- A drawing's Date Modified is set to now on every base change, upload and restore.

**Listing.**

- Folders always come before files, then the requested sort applies.
- The default is Date Modified, newest first. Ties sort by name A to Z.
- Size is the latest stored file version's size, or `—` when there is none.
- Shared is `Shared` when the drawing has an active link.

**Recent.** The last 10 distinct drawings the account opened on any device, newest open first.

**Upload.**

- A file is a DXF drawing when it is ASCII text whose first group-code pair is `0` / `SECTION` and which contains `0` / `EOF`. Binary DXF is refused.
- Uploading a new name creates a drawing with file version 1.
- Uploading an existing name in the same folder adds the next file version. Either way the drawing's objects and layers are replaced by the import and the drawing version goes up by 1.
- An upload is a file replacement, not an edit, so it carries no base version.
- The row reads Stored only after MinIO confirms the object.

**Restore.**

- Restoring version `<n>` adds a new file version with identical bytes, replaces the objects with its import, and raises the drawing version.
- It carries `base_version`.
- Drawings created in the app have no file versions until an upload or restore.

**Deleting a drawing** removes its share links and file versions from use. Xrefs to it in other drawings become `not_found`.

#### Base edits and versions

- **Version check.** Every base edit carries `base_version`: the drawing version when the command started. The server applies it only when `base_version` equals the current version, in one transaction.
  - It then raises the version by exactly 1 and returns the result.
  - Of several edits with the same `base_version`, exactly one wins. Every other gets the version conflict, whose `changed` lists every handle created, modified or erased in versions after `base_version`, sorted ascending.
  - No update is ever lost or silently overwritten.
- **Unchanged version.** A command that changes nothing (every target locked) answers 200, keeps the version and writes no activity entry.
- **Base writes.** These are commands, restores and xref changes. Traces never raise the drawing version.
- **Handles.** Handles are uppercase hexadecimal strings. A new object gets the next value after the largest handle the drawing has used since its objects were last replaced by an upload or restore, including handles of erased objects. A drawing with no such history starts at `10`. Within that span a handle is never reused. An upload or restore replaces every object and restarts numbering at `10`, whatever handles the drawing used before.
- **Undo and redo.**
  - UNDO reverses the most recent command by the same actor on this drawing that has not been undone.
  - REDO replays the most recently undone one, until that actor runs a new command.
  - Each is a base edit with its own version and activity entry.
- **Activity.** Every base edit that changes the drawing writes exactly one activity entry.
  - `<count>` is the number of distinct handles created, modified or erased.
  - The verb is `created` when the command only created, `erased` when it only erased, and `modified` otherwise.
  - Layer, layout and model changes count 0 objects.
  - The `<actor>` is the account name or the share recipient name.

#### Geometry

Every rule below is computed once on the server, in millimetres. The editor, Properties panel and exports show these values.

- **LINE** creates one line per segment. `C` adds the closing segment back to the first point.
- **OFFSET** creates a copy of the line, polyline, circle or arc at the given distance, on the side of the side point. A circle or arc offset changes its radius.
- **TRIM.**
  - Every visible base object is a cutting edge.
  - TRIM removes the part of the picked object between the nearest intersections on each side of the pick point, measured along the object. Where one side has no intersection, it removes up to the object's end. An intersection exactly at an endpoint counts.
  - When the removed part lies inside the object, the object splits: the part nearer its start keeps the handle and the other part gets a new handle.
  - With no intersection at all, it answers `No cutting edge found.`
- **EXTEND** lengthens the picked end to the nearest edge it would meet.
- **FILLET** with radius 0 joins two lines at their intersection.
- **Selection by typed point** uses the pick distance in Interactions, measured to the object's geometry.
- **Derived values.**
  - Line `Length` and `Angle` (direction from start to end).
  - Polyline `Length` and closed `Area`.
  - Circle `Diameter`, `Circumference` (2πr) and `Area` (πr²).
  - Arc `Length`.
- **INSERT** places the block's base point at the position, then scales every coordinate by the scale and rotates about the base point by the rotation.
- **DIMLINEAR** measures `|Δx|` between the origins when the location is above or below both origins, `|Δy|` when it is left or right of both, and `|Δx|` otherwise.
- **DIMALIGNED** measures the true distance.
- **DIMRADIUS** measures the radius, and its text is `R<radius>`.
- **DIMANGULAR** measures the angle between the two lines, from 0° to 180°, in the quadrant that holds the location.
- **Dimension text** is the measurement in the current format. A text override replaces it, with every `<>` in the override standing for the measurement. For example, with Meters, `<> TYP.` shows `6.000 TYP.`
- **Units.** Changing Units changes only formatting. Stored geometry and measurements stay the same.
- **REVCLOUD** traces the rectangle from the first to the opposite corner. Each side carries `ceil(side length in millimetres ÷ 150)` equal arcs. `arcs` is the total over the four sides.
- **DIST** returns `distance`, `angle` (direction from first to second), `delta_x` and `delta_y` (second minus first).

#### Layers and properties

**Layers.**

- A new layer is named `Layer<n>`, with the smallest free `<n>` starting at 1. It starts White, Continuous, `0.25 mm` lineweight, on, thawed and unlocked.
- **Names.** 1 to 64 characters of letters, digits, space, `-`, `_` and `$`, unique ignoring case. Layer `0` can never be renamed or deleted.
- **Delete refusals**, checked in this order: layer 0, then the current layer, then a locked layer, then a layer that holds objects.
- The current layer can't be frozen. New objects go on the current layer.
- **Off or frozen.** Objects on a layer that is off or frozen are not drawn, not snap candidates, not selectable and not in the extents. Frozen layers are also left out of PDF output and DXF entities.
- **Locked layers.**
  - Objects on a locked layer are drawn and snapped to, but every command and Properties change leaves them out and returns them in `locked`.
  - Toggling Lock is always allowed.
  - Their Properties fields are disabled.
- **Objects column** = the count of base objects on that layer, including frozen ones.

**Properties.** A Properties change on several objects applies to all of them in one base edit and one version. Linetype scale is 0.01 to 1000 with 2 decimals, both ends allowed.

#### Access, links and traces

**Access.**

| Access | May do | Refusal |
|---|---|---|
| owner | Everything | — |
| edit | Base edits, traces, exports | Owner-only actions answer `forbidden` |
| markup | Read, measure, create and submit their own traces | Every other write, exports included, answers `markup_only` |
| view | Read and measure | Every write, exports included, answers `view_only` |

- **What counts as a write:** every POST, PUT and DELETE except measure, presence and a mark-up holder's own trace actions. Measure and presence are allowed at every level. Opening a drawing (`opened`) is an account action and is not a link write.
- **Owner-only actions:** shares, invites, revocation, title-block revisions, closing traces and resolving issues. A view or mark-up link holder who attempts one gets `view_only` or `markup_only`, by the error precedence; an edit link holder gets `forbidden`.
- **In the editor:**
  - With view access, the Draw, Annotate and Modify buttons are `aria-disabled`, and only DIST, ZOOM and viewing the Layers tab run.
  - With mark-up access, those buttons are `aria-disabled` until the person's own trace is active. Then Line, Polyline, Circle, Text and Erase are enabled, and REVCLOUD runs from the command line.

**Share links.**

- **State machine:** `active -> expired` (server clock) and `active -> revoked` (owner). Expired and revoked are final.
- A token is at least 32 random bytes, base64url-encoded.
- **Expiry.** An expiry date `D` means the link expires at 23:59:59 on `D` in the studio time zone. It works through 23:59:58 and is expired at or after 23:59:59. No date means the link never expires.
- An expiry date before today in the studio zone is refused.
- **Revocation** takes effect on the next request.
- On expiry or revocation, every open tab on that link replaces the editor with its link page within the live-update limit.
- **Invites.** Send invite creates the link if the dialog has none yet, then emails it. `Invite sent to` shows only after Mailpit accepts.

**Traces.**

- **State machine:** `open -> submitted -> closed`.
  - Only the author may add to, erase in or submit an open trace.
  - Only the owner may close a submitted trace.
  - Every other move is refused with `trace_not_open` or `trace_not_submitted`.
- A trace never changes the base drawing: the drawing version and every base object stay identical through any trace action.
- Trace object handles are `T` followed by an uppercase hexadecimal counter per drawing, starting at `T1`.
- **Issues.**
  - Each MTEXT in a trace becomes issue `#<n>` when its trace is submitted.
  - Issues are numbered per drawing in creation order from 1, with status `open`.
  - Resolving moves an issue `open -> resolved`, and resolving again is refused.
- **Submission notice.** Submitting emails the drafter.
  - `notice` is `sent` only after Mailpit accepts, and `not_sent` otherwise. It is not retried.
  - The drafter's open tabs get the submitted announcement, and the Issues list refreshes, within the live-update limit.

#### Presence

- Each open editor tab sends presence on keyboard or pointer input, at most once every 2 seconds.
- A person is Editing when their access is owner or edit, and Viewing when it is markup or view.
- They become Away once their newest tab input is at least `PRESENCE_IDLE_SECONDS` old on the server clock, and return on their next input.
- The Collaborators list shows every other person with the drawing open, one item per person.

#### Layouts and export

**Layouts.**

- Every drawing starts with `Model`, `Layout1` and `Layout2`. New layout adds `Layout<n>`, the next number after the largest.
- Each paper layout is A3 landscape (420 by 297 millimetres) with the title block and one viewport.
- The viewport scale defaults to `1:50`. The viewport is centred on the extents.

**Export state machine:** `requested -> rendering -> stored | failed`.

- `stored` is set only after MinIO confirms the object (a successful store followed by a matching size check).
- A failed store ends `failed` and is not retried.
- Exports are generated inside the app.

**Export file name.** `<drawing name without .dxf>-<layout>-<n>.<pdf|dxf>`, where `<n>` is the drawing's export count from 1. DXF uses `Model` as `<layout>`.

**PDF.**

- One A3 landscape page (420 by 297 millimetres) with vector paths, not images.
- **Content.** A layout export draws its viewport at the viewport scale. A Model export fits the extents into the drawing area. Frozen and turned-off layers are left out.
- **Plot styles.** `Monochrome` prints everything black. `Color` prints layer and object colours, with White printed black. `Grayscale` prints each colour as a grey of equal lightness.
- **Title block**, as extractable text lines:
  - `TITLE <drawing name without .dxf>`
  - `SHEET A-101`
  - `SCALE <viewport scale or FIT>`
  - `ISSUED <YYYY-MM-DD>`
  - `REVISION <letter>`
  - `NOTE <footer note>`
- `ISSUED` is the studio-zone date when the export was requested.

**Title-block revisions.**

- The `Title block A3` template is per workspace.
- A new revision takes the next letter and must have an effective date after the latest revision's date and not before studio today.
- An export uses the revision with the latest effective date on or before its issue date.
- Stored exports are never re-rendered: their MinIO bytes and downloads stay exactly as issued.

**DXF export.**

- Plain ASCII DXF.
- **HEADER:** `$INSUNITS` is 4 for Millimeters or 6 for Meters, and coordinates are written in the current units.
- **TABLES → LAYER:** every layer with its name, ACI colour (group 62: Red 1, Yellow 2, Green 3, Cyan 4, Blue 5, Magenta 6, White 7, negative when off), linetype name (group 6) and flags (group 70: 1 frozen, 4 locked, added together).
- **BLOCKS:** each block in use.
- **ENTITIES:** LINE, CIRCLE, ARC, LWPOLYLINE, MTEXT and INSERT, each with handle (group 5) and layer (group 8).
  - Entities on frozen layers are left out.
  - Dimensions are written as their lines plus an MTEXT carrying their text, and splines as LWPOLYLINE through their fit points.

**DXF import.**

- Reads the same subset and `$INSUNITS` (4 or 6; absent means millimetres).
- Layers keep their colour, linetype and flags.
- Every other entity type is skipped and counted.
- Imported objects get handles in file order, starting at `10`, on a new drawing and on an upload or restore onto an existing drawing alike (the Handles rule under Base edits and versions).

#### External references

- Only another drawing in the same workspace can be attached, at 0,0 with scale 1.
- Xref objects are drawn faded and can be snapped to. They are never selected, edited or counted in the extents.
- `unloaded` hides them. `not_found` applies when the source drawing is deleted.

### Services (DP-01, DP-02, DP-05, DP-08, DP-34, DP-41, DP-43, DP-46, DP-48, DP-59)

**Postgres** (`DATABASE_URL`) is the system of record: accounts, sessions, workspaces, folders, drawings, base objects, layers, layouts, versions and their change sets, activity, traces, trace objects, issues, share links, exports, quotes, title-block revisions and grading clocks.

- The app applies its schema idempotently every time it starts. Two instances may start against the same database at once.
- A drawing reopened on any device shows exactly the stored state.

**MinIO** (`S3_*`) keeps bytes exactly as produced, in bucket `S3_BUCKET`, with path-style addressing when `S3_FORCE_PATH_STYLE` is `true`.

- Uploads and restores go to `drawings/<drawing id>/v<n>.dxf`.
- Exports go to `exports/<drawing id>/<export id>.<pdf|dxf>`.
- Downloads stream those objects through the app. The browser never talks to MinIO.
- When MinIO does not confirm an object:
  - Uploads and restores answer 503 `storage_unavailable`, and nothing is stored in Postgres.
  - Exports end `failed`.
  - The MinIO banner shows.

**Mailpit** receives mail over SMTP at `SMTP_HOST`:`SMTP_PORT`, from `MAIL_FROM`. Every link uses the public URL.

| Email | To | Subject | Body holds |
|---|---|---|---|
| Confirmation | The new account's address | `Confirm your Corbel Draft account` | `<public URL>/verify/<token>` |
| Invite | The recipient | `<drafter name> shared "<drawing name>" with you` | `<public URL>/s/<token>`, then a line holding the access label (`Can view`, `Can mark up` or `Can edit`), then a line holding the expiry line, which is the `status "Link"` copy (`Expires <MMM D, YYYY>, 11:59 PM (<IANA zone>)` or `Does not expire`) |
| Pro quote | The account's address | `Your Corbel Draft Pro quote` | `$12.00 per month`, the quote number and the studio-zone date |
| Trace submitted | The drawing owner | `Trace "<trace name>" submitted on <drawing name>` | The reviewer name and the issue count |

- Every "sent" state in the app is set only after the SMTP server accepts the message.
- When it does not accept, the action answers as in API (503 `mail_unavailable`, or `email_status`/`notice` `not_sent`) and the UI shows its mail-down copy.

**Valkey** (`VALKEY_URL`) carries live sync and presence. It is never the system of record.

- **Channels.** `drawing:<drawing id>` carries JSON messages `{"type":"change"|"presence"|"link"|"trace"|"issues"|"activity"|"layer","…"}`. `account:<user id>` carries `files`, `recent` and `trial`.
- **Presence keys.**
  - Set `presence:<drawing id>` holds one member per open editor tab, its `tab_id`.
  - Hash `presence:<drawing id>:<tab id>` holds `name`, `access`, `state` and `last_input_at`. Its expiry is 30 seconds, refreshed at least every 10 seconds while the tab is open.
- **Delivery.** Every app instance relays these messages to its open event streams.
- **When Valkey is unreachable:**
  - Saves still land in Postgres.
  - Event streams send `sync` `paused`, and `status "Sync"` reads `Live sync paused` with the Valkey banner.
  - Presence shows nobody.
  - Once Valkey answers again, sync resumes within 10 seconds without a restart or reload, and tabs refetch the drawing.

### Seed data (DP-28, DP-53)

Every person, studio and drawing here is invented.

**Grading workspaces.**

- The drafter is named `Ines Halloran` and the reviewer contact `Tomas Wren`.
- Both get unique addresses `<random>@corbel-grading.test`. The drafter's password is random.
- The drafter is verified, with today's studio date as the confirmation date.
- Each workspace has folder `My Drawings` holding drawing `Plan A.dxf` at version 1, with no file versions.

**`blank` preset.** Units as given, layer `0` only (White, Continuous, current), and no objects.

**`studio-plan` preset.** Lineweights are `0.25 mm`, and every object has colour, linetype and lineweight `ByLayer`, linetype scale 1 and style `Standard`.

| Layer | Colour | Linetype | State |
|---|---|---|---|
| `0` | White | Continuous | on, current |
| `A-WALL` | Yellow | Continuous | on |
| `A-DOOR` | Cyan | Continuous | on |
| `A-ANNO` | Green | Continuous | on |
| `S-GRID` | Red | Center | locked |
| `A-FURN` | Magenta | Dashed | frozen |

| Handle | Object | Layer | Geometry |
|---|---|---|---|
| `1A` | line | `A-WALL` | 0,0 to 6000,0 |
| `1B` | line | `A-WALL` | 6000,0 to 6000,4200 |
| `1C` | line | `A-WALL` | 6000,4200 to 0,4200 |
| `1D` | line | `A-WALL` | 0,4200 to 0,0 |
| `3A` | line | `A-WALL` | 0,2400 to 2400,2400 |
| `2A` | line | `S-GRID` | 3000,-600 to 3000,4800 |
| `2B` | circle | `A-FURN` | centre 4500,2100, radius 450 |

For example, with the seed data at start, the next new object gets handle `3B`, and the extents are 0,-600 to 6000,4800.

**Block library** (published, in millimetres from each base point):

| Block | Base point | Geometry |
|---|---|---|
| `Door 900` | Hinge | Line 0,0 to 0,900, plus an arc centred 0,0 with radius 900 from 0° to 90° |
| `Window 1200` | Left end, centre of the wall | Lines 0,-50 to 1200,-50, 0,0 to 1200,0 and 0,50 to 1200,50 |
| `Chair 450` | Seat centre | Closed polyline -225,-225 / 225,-225 / 225,225 / -225,225 |
| `Table 1600x800` | Table centre | Closed polyline -800,-400 / 800,-400 / 800,400 / -800,400 |
| `North arrow` | Arrow tip | Closed polyline 0,0 / -150,-600 / 150,-600, plus MText `N` at 0,-800 with height 200 |

**Support set** (Manage Support Files):

- Linetypes: `Continuous`, `Dashed`, `Hidden`, `Center`.
- Plot styles: `Monochrome`, `Color`, `Grayscale`.
- The five blocks.
- Template: `Title block A3`.
- Text, dimension and multileader styles: `Standard` and `Annotative`.

**Title block.** Every workspace starts with `Revision A`, footer note `Issued for coordination.`, effective on the workspace's creation date.

**Sample Files.** Owner `Corbel Works`, opened with view access. Save as copies a sample into My Drawings.

- `Studio Plan Sample.dxf`: the studio-plan content.
- `Wall Detail Sample.dxf`: a closed polyline 0,0 / 1200,0 / 1200,300 / 0,300 on `A-WALL`, plus MText `WALL TYPE W1` at 0,500 with height 100 on `A-ANNO`.

**Studio time zones** (sign-up options, default `UTC`): `UTC`, `America/New_York`, `America/Chicago`, `America/Los_Angeles`, `Europe/London`, `Europe/Berlin`, `Asia/Kolkata`, `Asia/Tokyo`, `Australia/Sydney`.

**Defaults.** New text height is 250 millimetres, and the OFFSET distance has no default.

## Technical requirements

### Deployment (DP-53, DP-60)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22.

- **Runtime.** Node 22 and npm are available.
- **Run manifest.** `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

- **Serving.**
  - `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
  - `GET /api/health` answers as published in API.
  - Every page and the API come from that one process.

### Configuration and secrets (DP-59, DP-60)

Read at start from the environment, never hard-coded and never sent to the browser:

| Purpose | Variables |
|---|---|
| Postgres | `DATABASE_URL` |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| Valkey | `VALKEY_URL` |
| Public URL | `APP_PUBLIC_URL` for links in emails, falling back to `http://localhost:<port>` |
| Grading switch | `CORBEL_GRADING` |
| Timers and limits | The variables listed in Business rules |

Ignore any `*_OBSERVER_*` variable.

### Server boundary (DP-59, DP-60)

- **Origin.** Same origin only: no cross-origin resource sharing headers, and every state-changing request must come from the app's own origin.
- **Body limits.** JSON bodies are at most 1,000,000 bytes (equal allowed). The upload limit is in Business rules.
- **What is served.** The server serves only the built frontend, fonts and icons bundled with the app, the API and download streams.
  - It never serves source files, `run.json`, environment files, lockfiles or credentials.
  - Provider URLs and keys never appear in any page or response.
- **Unreachable dependency at boot.** When Valkey, MinIO or Mailpit is unreachable at boot, the app still starts and serves pages.
  - Health reports `unavailable`, and the affected features answer their published outage results.
  - The app retries each dependency at least every 5 seconds, and recovers within 10 seconds of the service returning, without a restart.

### Browser support and performance (DP-43, DP-57)

- **Browsers.** Current Chromium, Firefox and WebKit, at 375×812, 768×1024 and 1280×800, with mouse, keyboard and touch.
- **Load time.** The editor is interactive within three seconds of opening a drawing of up to 5,000 objects.
- **Responsiveness.** Panning and zooming keep up with the pointer on such a drawing. A typed command's result appears within one second.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font and icon set, with its licence.
- IF-03: Every shipped package, font and icon is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0 or OFL-1.1.
- IF-04: The app uses only Postgres, MinIO, Mailpit and Valkey: no SQLite, no other datastore, and no application state kept on the local file system.
- IF-05: The seeded service configuration and dev credentials the workspace provides are left unchanged.
- IF-06: Fonts, icons, block libraries and templates are bundled with the app, and no page loads anything from a CDN or third-party origin.
- IF-07: PDF and DXF exports are generated in-process, with no external render or conversion service.
- IF-08: `package-lock.json` is committed and `install` uses it.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, and every name matches this brief's domain terms (drawing, object, handle, layer, trace, issue, share link, export, title-block revision).
- Each domain rule is decided in exactly one place in the source. This covers the version check, link status, trace transitions, layer refusals, export state, trial days left and every geometry value. Every caller uses that one decision.
- Every error leaves the API in the one published error shape, and the frontend maps codes to the published copy in one place.
- There is no abstraction with a single implementation, and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the types or rules already rule out.
- Provider effects (stored object, accepted message, published sync message) are confirmed from the provider's answer, never assumed from the request.
- There are no features, endpoints or settings beyond this brief.
